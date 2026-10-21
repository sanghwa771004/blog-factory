-- 011: 독립 검토에서 찾은 문제 고침 (1.1.2)
-- 표를 지우거나 다시 만들지 않음. 열·인덱스를 더하고 함수만 바꿈.
--  1. job_fail: '대기 중' 작업에만 실패 기록 (끝난 작업을 실패로 뒤집지 않음)
--  2. fill_post: '쓰는 중' 원고에만, 동시에 두 번 채우지 않게 잠그고 조건부로 고침
--  3. job_cancel·post_retry: 멈춘 작업을 취소하거나 지운 원고를 되살린 뒤에도 다시 요청할 수 있게
--  4. 실적 파일: 같은 수익 모델·채널·글·기간이면 같은 줄로 봄 (파일 이름·숫자는 기준에서 뺌)
--     같은 파일 안 → 합침 / 예전 파일과 숫자가 같으면 → 중복 / 다르면 → 새 숫자로 바꾸고 예전 숫자는 보관
--     올리기 취소 → 이 파일이 새로 넣은 줄은 지우고, 이 파일이 고친 줄은 예전 숫자로 되돌림
--  5. add_post: 이미 원고가 있는 주제로는 새 원고를 만들지 않음 (같은 주제 중복 원고 방지)
--  6. backup 스키마 표에도 RLS

-- 1 ───────── 작업 실패 기록
create or replace function public.job_fail(job uuid, msg text, needs_input boolean default false) returns void
language plpgsql set search_path = '' as $$
declare r public.requests;
begin
  update public.requests set status = 'failed', note = left(coalesce(msg, ''), 500), done_at = now()
    where id = job and status = 'pending' returning * into r;
  if r.id is not null and r.post_id is not null and r.kind = 'write' then
    update public.posts set stage = case when needs_input then 'verify' else 'failed' end, error = left(coalesce(msg, ''), 500)
      where id = r.post_id and stage in ('queued','researching','writing','verify','failed');
  end if;
end $$;

-- 2 ───────── 원고 채우기
create or replace function public.fill_post(target uuid, p jsonb) returns date
language plpgsql set search_path = '' as $$
declare
  kst_today date := (now() at time zone 'Asia/Seoul')::date;
  d date;
  st text;
begin
  if length(coalesce(p->>'body', '')) < 50 then raise exception 'body is required'; end if;
  select stage, publish_date into st, d from public.posts where id = target and deleted_at is null for update;
  if st is null then raise exception 'post not found'; end if;
  if st not in ('queued','researching','writing','verify','failed') then
    raise exception 'post is not waiting for writing (stage %)', st;
  end if;
  if d is null then d := public.next_free_date(kst_today); end if;
  update public.posts set
    titles = case when jsonb_typeof(p->'titles') = 'array' then p->'titles' else titles end,
    body = p->>'body',
    hashtags = case when jsonb_typeof(p->'hashtags') = 'array' then p->'hashtags' else hashtags end,
    threads = coalesce(p->>'threads', threads),
    instagram = coalesce(p->>'instagram', instagram),
    content_type = coalesce(nullif(p->>'content_type', ''), content_type),
    category = coalesce(nullif(p->>'category', ''), category),
    summary = coalesce(p->>'summary', summary),
    sources = case when jsonb_typeof(p->'sources') = 'array' then p->'sources' else sources end,
    ai_notes = jsonb_strip_nulls(jsonb_build_object('needs_fact_check', p->'needs_fact_check', 'notes', p->>'notes', 'written_at', now())),
    stage = 'review',
    error = '',
    publish_date = d
  where id = target and deleted_at is null and stage in ('queued','researching','writing','verify','failed');
  if not found then raise exception 'post is not waiting for writing'; end if;
  perform public.attach_products(target, p->'products');
  update public.requests set status = 'done', done_at = now(), note = ''
    where post_id = target and kind = 'write' and status = 'pending';
  return d;
end $$;

-- 3 ───────── 취소·다시 요청
create or replace function public.job_cancel(job uuid) returns void
language plpgsql set search_path = '' as $$
declare r public.requests;
begin
  update public.requests set status = 'cancelled', done_at = now()
    where id = job and status = 'pending' and (started_at is null or started_at < now() - interval '30 minutes')
    returning * into r;
  if r.id is null then raise exception 'job cannot be cancelled'; end if;
  if r.kind = 'write' and r.post_id is not null then
    update public.posts set stage = 'failed', error = '요청을 취소했어'
      where id = r.post_id and stage in ('queued','researching','writing','verify','failed');
  end if;
end $$;

create or replace function public.post_retry(target uuid) returns uuid
language plpgsql set search_path = '' as $$
declare p public.posts; j uuid;
begin
  select * into p from public.posts where id = target and deleted_at is null for update;
  if p.id is null then raise exception 'post not found'; end if;
  if p.stage not in ('failed','verify','queued','researching','writing') then
    raise exception 'post is not failed (stage %)', p.stage;
  end if;
  -- 대기 중이거나 30분 안에 시작된 작업이 있으면 그대로 둠 (자동 작가가 처리 중)
  if exists (select 1 from public.requests r where r.post_id = target and r.kind = 'write' and r.status = 'pending'
               and (r.started_at is null or r.started_at > now() - interval '30 minutes')) then
    raise exception 'post is not failed (a job is waiting or running)';
  end if;
  -- 30분 넘게 멈춘 작업은 취소로 정리하고 다시 요청
  update public.requests set status = 'cancelled', done_at = now(), note = '멈춘 작업이라 다시 요청하면서 정리'
    where post_id = target and kind = 'write' and status = 'pending';
  select id into j from public.requests where post_id = target and kind = 'write' and status in ('failed','cancelled')
    order by created_at desc limit 1;
  if j is not null then
    update public.requests set status = 'pending', note = '', started_at = null, done_at = null, exp = p.experience, style = p.content_type
      where id = j;
  else
    insert into public.requests (keyword, style, money, platform, len, exp, status, post_id, kind)
      values (p.keyword, p.content_type, p.money, p.platform, p.len, p.experience, 'pending', target, 'write')
      returning id into j;
  end if;
  update public.posts set stage = 'queued', error = '' where id = target;
  return j;
end $$;

-- 4 ───────── 실적 파일
alter table public.metrics add column if not exists id_key text;
alter table public.metrics add column if not exists replaced jsonb;
alter table public.imports add column if not exists rows_changed int not null default 0;
create unique index if not exists metrics_id_key_uq on public.metrics (id_key) where id_key is not null;

-- 같은 줄인지 알아보는 열쇠: 수익 모델·채널·글(없으면 글 이름 글자)·기간. 숫자와 파일 이름은 안 넣음
create or replace function public.metric_id_key(prog text, ch text, post uuid, match text, d1 date, d2 date) returns text
language sql immutable set search_path = '' as $$
  select md5(concat_ws('|', 'v2', coalesce(prog, ''), coalesce(ch, ''),
    coalesce(post::text, 'm:' || lower(regexp_replace(btrim(left(coalesce(match, ''), 200)), '\s+', ' ', 'g'))),
    d1::text, d2::text))
$$;

-- 예전에 파일로 올린 줄에도 열쇠를 붙임 (같은 열쇠가 여러 줄이면 가장 최근 줄에만 — 나머지는 예전 방식으로 남음)
with k as (
  select m.id, m.created_at,
    public.metric_id_key(m.program_id, m.channel_id, m.post_id,
      case when m.post_id is null and m.note like '글 연결 안 됨: %' then substr(m.note, 11) else '' end,
      m.period_start, m.period_end) as key
  from public.metrics m
  where m.source = 'csv' and m.id_key is null and m.import_id is not null
), ranked as (
  select id, key, row_number() over (partition by key order by created_at desc, id desc) as rn from k
)
update public.metrics m set id_key = r.key
from ranked r
where r.id = m.id and r.rn = 1
  and not exists (select 1 from public.metrics x where x.id_key = r.key);

-- 보관해 둔 예전 숫자 기록에서 어떤 파일 층을 뺌 (그 파일을 취소했을 때)
create or replace function public.metrics_drop_layer(chain jsonb, imp uuid) returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if chain is null or jsonb_typeof(chain) <> 'object' then return null; end if;
  if chain->>'import_id' = imp::text then return public.metrics_drop_layer(chain->'prev', imp); end if;
  return jsonb_set(chain, '{prev}', coalesce(public.metrics_drop_layer(chain->'prev', imp), 'null'::jsonb));
end $$;

create or replace function public.import_metrics(p_import uuid, p_rows jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  imp public.imports;
  a record;
  n_ok int := 0;
  n_dup int := 0;
  n_changed int := 0;
  old public.metrics;
  note_txt text;
begin
  select * into imp from public.imports where id = p_import and status = '완료';
  if imp.id is null then raise exception 'import not found'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  -- 먼저 파일 안에서 같은 글·같은 기간 줄(상품·주문별 줄)을 더해서 한 줄로 만든 뒤, 이미 있는 줄과 비교
  for a in
    with src as (
      select t.ord,
        case when coalesce(t.e->>'post_id', '') ~ '^[0-9a-f-]{36}$'
              and exists (select 1 from public.posts p where p.id = (t.e->>'post_id')::uuid)
             then (t.e->>'post_id')::uuid end as pid,
        t.e->>'match_text' as match_text,
        (t.e->>'period_start')::date as d1, (t.e->>'period_end')::date as d2,
        (t.e->>'views')::int as views, (t.e->>'impressions')::int as impressions, (t.e->>'clicks')::int as clicks,
        (t.e->>'orders')::int as orders, (t.e->>'cancels')::int as cancels,
        (t.e->>'revenue_est')::numeric as revenue_est, (t.e->>'revenue_confirmed')::numeric as revenue_confirmed,
        (t.e->>'revenue_paid')::numeric as revenue_paid, (t.e->>'cost')::numeric as cost
      from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
    ), keyed as (
      select s.*, public.metric_id_key(imp.program_id, imp.channel_id, s.pid, case when s.pid is null then s.match_text end, s.d1, s.d2) as k
      from src s
    )
    select k.k as key, (array_agg(k.pid order by k.ord))[1] as pid, (array_agg(k.match_text order by k.ord))[1] as match_text,
      min(k.d1) as d1, min(k.d2) as d2, count(*)::int as lines,
      sum(k.views)::int as views, sum(k.impressions)::int as impressions, sum(k.clicks)::int as clicks,
      sum(k.orders)::int as orders, sum(k.cancels)::int as cancels,
      sum(k.revenue_est) as revenue_est, sum(k.revenue_confirmed) as revenue_confirmed,
      sum(k.revenue_paid) as revenue_paid, sum(k.cost) as cost, min(k.ord) as first_ord
    from keyed k
    group by k.k
    order by min(k.ord)
  loop
    note_txt := case when a.pid is null and coalesce(a.match_text, '') <> '' then '글 연결 안 됨: ' || left(a.match_text, 200) else '' end;
    select * into old from public.metrics where id_key = a.key for update;
    if old.id is null then
      insert into public.metrics (post_id, channel_id, program_id, period_start, period_end, views, impressions, clicks, orders,
                                  cancels, revenue_est, revenue_confirmed, revenue_paid, cost, source, source_label, import_id,
                                  id_key, note)
      values (a.pid, imp.channel_id, imp.program_id, a.d1, a.d2,
              a.views, a.impressions, a.clicks, a.orders, a.cancels, a.revenue_est, a.revenue_confirmed, a.revenue_paid, a.cost,
              'csv', imp.source_label, p_import, a.key, note_txt);
      n_ok := n_ok + a.lines;
      if a.pid is not null then
        update public.posts set stage = 'collecting' where id = a.pid and stage = 'published';
      end if;
    elsif old.views is not distinct from a.views and old.impressions is not distinct from a.impressions
      and old.clicks is not distinct from a.clicks and old.orders is not distinct from a.orders
      and old.cancels is not distinct from a.cancels and old.revenue_est is not distinct from a.revenue_est
      and old.revenue_confirmed is not distinct from a.revenue_confirmed and old.revenue_paid is not distinct from a.revenue_paid
      and old.cost is not distinct from a.cost then
      n_dup := n_dup + a.lines;
    else
      -- 예전 파일과 같은 줄인데 숫자가 바뀜 (제휴사가 고친 리포트) → 새 숫자로, 예전 숫자는 보관
      update public.metrics set
        views = a.views, impressions = a.impressions, clicks = a.clicks, orders = a.orders, cancels = a.cancels,
        revenue_est = a.revenue_est, revenue_confirmed = a.revenue_confirmed, revenue_paid = a.revenue_paid, cost = a.cost,
        replaced = jsonb_build_object('import_id', old.import_id, 'source_label', old.source_label, 'note', old.note,
          'values', jsonb_build_object('views', old.views, 'impressions', old.impressions, 'clicks', old.clicks, 'orders', old.orders,
            'cancels', old.cancels, 'revenue_est', old.revenue_est, 'revenue_confirmed', old.revenue_confirmed,
            'revenue_paid', old.revenue_paid, 'cost', old.cost),
          'prev', coalesce(old.replaced, 'null'::jsonb)),
        import_id = p_import, source_label = imp.source_label, note = note_txt
      where id = old.id;
      n_changed := n_changed + a.lines;
    end if;
  end loop;
  update public.imports set rows_ok = rows_ok + n_ok, rows_dup = rows_dup + n_dup, rows_changed = rows_changed + n_changed
    where id = p_import;
  return jsonb_build_object('ok', n_ok, 'dup', n_dup, 'changed', n_changed);
end $$;

create or replace function public.import_cancel(p_import uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  imp public.imports;
  m public.metrics;
  pv jsonb;
  n_del int := 0;
  n_back int := 0;
begin
  select * into imp from public.imports where id = p_import for update;
  if imp.id is null then raise exception 'import not found'; end if;
  if imp.status = '취소' then return jsonb_build_object('removed', 0, 'restored', 0); end if;
  for m in select * from public.metrics where import_id = p_import for update loop
    pv := public.metrics_drop_layer(m.replaced, p_import);
    if pv is null then
      delete from public.metrics where id = m.id;
      n_del := n_del + 1;
    else
      update public.metrics set
        views = (pv->'values'->>'views')::int, impressions = (pv->'values'->>'impressions')::int,
        clicks = (pv->'values'->>'clicks')::int, orders = (pv->'values'->>'orders')::int, cancels = (pv->'values'->>'cancels')::int,
        revenue_est = (pv->'values'->>'revenue_est')::numeric, revenue_confirmed = (pv->'values'->>'revenue_confirmed')::numeric,
        revenue_paid = (pv->'values'->>'revenue_paid')::numeric, cost = (pv->'values'->>'cost')::numeric,
        import_id = (pv->>'import_id')::uuid, source_label = coalesce(pv->>'source_label', ''), note = coalesce(pv->>'note', ''),
        replaced = case when jsonb_typeof(pv->'prev') = 'object' then pv->'prev' end
      where id = m.id;
      n_back := n_back + 1;
    end if;
  end loop;
  -- 다른 파일이 이 파일 숫자를 덮어쓴 줄: 보관 기록에서 이 파일 층을 뺌 (나중에 그 파일을 취소해도 이 파일 숫자가 되살아나지 않게)
  update public.metrics set replaced = public.metrics_drop_layer(replaced, p_import)
    where replaced is not null and position(p_import::text in replaced::text) > 0;
  update public.imports set status = '취소', cancelled_at = now() where id = p_import;
  return jsonb_build_object('removed', n_del, 'restored', n_back);
end $$;

-- 5 ───────── 원고 저장 (006 add_post + 주제 중복 방지)
create or replace function public.add_post(p jsonb, start_offset int default 1)
returns table (post_id uuid, publish_date date)
language plpgsql set search_path = '' as $$
declare
  kst_today date := (now() at time zone 'Asia/Seoul')::date;
  d date;
  new_id uuid;
  req uuid := nullif(p ->> 'request_id', '')::uuid;
  ch text;
  progs text[];
begin
  if length(coalesce(p ->> 'body', '')) < 50 then
    raise exception 'body is required';
  end if;
  if coalesce(p->>'topic_id', '') ~ '^[0-9a-f-]{36}$'
     and exists (select 1 from public.posts x where x.topic_id = (p->>'topic_id')::uuid and x.deleted_at is null) then
    raise exception 'topic already has a post';
  end if;
  ch := coalesce(nullif(p->>'channel_id', ''),
        case p->>'platform' when '티스토리' then 'tistory' when '워드프레스 / 구글 블로그' then 'website' when '네이버 블로그' then 'naver_blog' end,
        (select s.default_channel from public.settings s where s.id = 1), 'naver_blog');
  if not exists (select 1 from public.channels c where c.id = ch) then ch := 'naver_blog'; end if;
  if jsonb_typeof(p->'program_ids') = 'array' then
    progs := array(select x from jsonb_array_elements_text(p->'program_ids') x where exists (select 1 from public.programs pr where pr.id = x));
  elsif coalesce(p->>'money', '') <> '' then
    progs := case p->>'money' when '쿠팡파트너스' then array['coupang_partners'] when '토스 쇼핑 제휴' then array['toss_sharelink']
                              when '애드센스(정보성 글)' then array['google_adsense'] else '{}'::text[] end;
  else
    progs := coalesce((select s.default_programs from public.settings s where s.id = 1), '{}'::text[]);
  end if;
  perform public.assert_compat(progs, ch);

  d := public.next_free_date(kst_today + greatest(coalesce(start_offset, 1), 0));
  insert into public.posts (keyword, money, platform, style, len, titles, body, hashtags, threads, instagram, link, publish_date,
                            source, request_id, stage, channel_id, program_ids, content_type, category, topic_id, experience,
                            sources, summary, ai_notes)
  values (
    coalesce(p->>'keyword', ''),
    coalesce((select string_agg(pr.name, ', ') from public.programs pr where pr.id = any(progs)), ''),
    coalesce((select c.name from public.channels c where c.id = ch), ''),
    coalesce(p->>'style', ''),
    coalesce(nullif(p->>'len', ''), '2500'),
    case when jsonb_typeof(p->'titles') = 'array' then p->'titles' else '[]'::jsonb end,
    p->>'body',
    case when jsonb_typeof(p->'hashtags') = 'array' then p->'hashtags' else '[]'::jsonb end,
    coalesce(p->>'threads', ''),
    coalesce(p->>'instagram', ''),
    '',
    d,
    coalesce(nullif(p->>'source', ''), 'auto'),
    req,
    'review', ch, progs,
    coalesce(p->>'content_type', ''),
    coalesce(p->>'category', ''),
    case when coalesce(p->>'topic_id', '') ~ '^[0-9a-f-]{36}$' then (p->>'topic_id')::uuid end,
    coalesce(p->>'experience', ''),
    case when jsonb_typeof(p->'sources') = 'array' then p->'sources' else '[]'::jsonb end,
    coalesce(p->>'summary', ''),
    jsonb_strip_nulls(jsonb_build_object('needs_fact_check', p->'needs_fact_check', 'notes', p->>'notes', 'written_at', now()))
  )
  returning id into new_id;

  perform public.attach_products(new_id, p->'products');
  if coalesce(p->>'link', '') ~* '^https?://[^\s"''<>]+$' then
    insert into public.links (post_id, url, program_id, channel_id) values (new_id, p->>'link', progs[1], ch);
  end if;
  if req is not null then
    update public.requests r set status = 'done', post_id = new_id, done_at = now(), note = '' where r.id = req;
  end if;
  if coalesce(p->>'topic_id', '') ~ '^[0-9a-f-]{36}$' then
    update public.topics t set status = '제작 요청됨' where t.id = (p->>'topic_id')::uuid and t.status in ('후보','채택');
  end if;
  return query select new_id, d;
end $$;

-- 6 ───────── backup 스키마 표에도 RLS (권한은 004에서 이미 회수됨)
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'backup' loop
    execute format('alter table backup.%I enable row level security', t.tablename);
  end loop;
end $$;

revoke execute on function
  public.job_fail(uuid, text, boolean), public.fill_post(uuid, jsonb), public.job_cancel(uuid), public.post_retry(uuid),
  public.metric_id_key(text, text, uuid, text, date, date), public.metrics_drop_layer(jsonb, uuid),
  public.import_metrics(uuid, jsonb), public.import_cancel(uuid), public.add_post(jsonb, int)
  from public, anon, authenticated;
grant execute on function
  public.job_cancel(uuid), public.post_retry(uuid), public.import_metrics(uuid, jsonb), public.import_cancel(uuid)
  to service_role;
