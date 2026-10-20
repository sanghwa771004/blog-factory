-- 006: 상태 동기화·원고 저장·작업 처리·통계 함수

create or replace function public.posts_sync_stage() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.status := case when new.stage in ('published','collecting','analyzed') then 'published' else 'planned' end;
  if new.status = 'published' and new.published_at is null then new.published_at := now(); end if;
  if new.status = 'planned' then new.published_at := null; end if;
  return new;
end $$;
create trigger posts_sync_stage before insert or update of stage on public.posts
  for each row execute function public.posts_sync_stage();

create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger topics_touch before update on public.topics for each row execute function public.touch_updated_at();
create trigger programs_touch before update on public.programs for each row execute function public.touch_updated_at();

create or replace function public.next_free_date(start_day date) returns date
language sql stable set search_path = '' as $$
  select d::date
  from generate_series(start_day::timestamp, (start_day + 730)::timestamp, interval '1 day') as d
  where (select count(*) from public.posts p
          where p.publish_date = d::date and p.deleted_at is null and p.stage not in ('failed','queued'))
        < (select coalesce(s.per_day, 1) from public.settings s where s.id = 1)
  order by d
  limit 1
$$;

create or replace function public.compat_verdict(prog text, ch text) returns text
language sql stable set search_path = '' as $$
  select coalesce((select pc.verdict from public.program_channels pc where pc.program_id = prog and pc.channel_id = ch), '확인 필요')
$$;

create or replace function public.assert_compat(progs text[], ch text) returns void
language plpgsql stable set search_path = '' as $$
declare bad text;
begin
  select string_agg(pr.name || ' × ' || c.name || coalesce(' (' || nullif(pc.reason, '') || ')', ''), ', ')
    into bad
  from unnest(coalesce(progs, '{}'::text[])) as x(pid)
  join public.programs pr on pr.id = x.pid
  join public.channels c on c.id = ch
  join public.program_channels pc on pc.program_id = x.pid and pc.channel_id = ch
  where pc.verdict = '불가';
  if bad is not null then
    raise exception 'incompatible: %', bad;
  end if;
end $$;

create or replace function public.upsert_product(p jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare
  pid uuid;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_brand text := btrim(coalesce(p->>'brand', ''));
  v_model text := btrim(coalesce(p->>'model', ''));
  v_urls text[];
  v_price numeric;
  v_price_at date;
  v_info_at date;
begin
  if coalesce(p->>'id', '') ~ '^[0-9a-f-]{36}$' then
    select id into pid from public.products where id = (p->>'id')::uuid;
    if pid is not null then return pid; end if;
  end if;
  if v_name = '' then raise exception 'product name is required'; end if;
  v_urls := case when jsonb_typeof(p->'source_urls') = 'array'
              then array(select u from jsonb_array_elements_text(p->'source_urls') u where u ~* '^https?://[^\s"''<>]+$')
              else '{}'::text[] end;
  v_price := case when jsonb_typeof(p->'price') = 'number' then (p->>'price')::numeric end;
  v_price_at := case when coalesce(p->>'price_checked_at', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'price_checked_at')::date end;
  v_info_at := case when coalesce(p->>'info_checked_at', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'info_checked_at')::date end;
  if v_price_at is null then v_price := null; end if;

  if v_model <> '' then
    select id into pid from public.products where lower(model) = lower(v_model) and lower(brand) = lower(v_brand) limit 1;
  end if;
  if pid is null then
    select id into pid from public.products where lower(name) = lower(v_name) and lower(brand) = lower(v_brand) limit 1;
  end if;

  if pid is null then
    insert into public.products (name, brand, model, category, price, price_checked_at, price_source_url, specs, pros, cons,
                                 compare_with, source_urls, info_checked_at, trust, notes)
    values (left(v_name, 200), left(v_brand, 100), left(v_model, 100), coalesce(p->>'category', ''), v_price, v_price_at,
            case when coalesce(p->>'price_source_url', '') ~* '^https?://[^\s"''<>]+$' then p->>'price_source_url' else '' end,
            case when jsonb_typeof(p->'specs') = 'array' then p->'specs' else '[]'::jsonb end,
            coalesce(p->>'pros', ''), coalesce(p->>'cons', ''), coalesce(p->>'compare_with', ''),
            v_urls, v_info_at,
            case when cardinality(v_urls) > 0 then '출처 있음' else '미검증' end,
            coalesce(p->>'notes', ''))
    returning id into pid;
  else
    update public.products set
      model = case when model = '' then left(v_model, 100) else model end,
      category = case when category = '' then coalesce(p->>'category', '') else category end,
      specs = case when trust <> '확인 완료' and specs = '[]'::jsonb and jsonb_typeof(p->'specs') = 'array' then p->'specs' else specs end,
      pros = case when pros = '' then coalesce(p->>'pros', '') else pros end,
      cons = case when cons = '' then coalesce(p->>'cons', '') else cons end,
      source_urls = case when trust = '확인 완료' then source_urls
                         else array(select distinct u from unnest(source_urls || v_urls) u) end,
      info_checked_at = case when trust = '확인 완료' then info_checked_at else greatest(info_checked_at, v_info_at) end,
      price = case when trust <> '확인 완료' and v_price_at is not null and (price_checked_at is null or v_price_at > price_checked_at) then v_price else price end,
      price_checked_at = case when trust <> '확인 완료' and v_price_at is not null and (price_checked_at is null or v_price_at > price_checked_at) then v_price_at else price_checked_at end,
      trust = case when trust = '미검증' and cardinality(v_urls) > 0 then '출처 있음' else trust end
    where id = pid;
  end if;
  return pid;
end $$;

create or replace function public.attach_products(target uuid, items jsonb) returns int
language plpgsql set search_path = '' as $$
declare it jsonb; pid uuid; n int := 0;
begin
  if items is null or jsonb_typeof(items) <> 'array' then return 0; end if;
  for it in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(it) = 'string' then
      pid := (it #>> '{}')::uuid;
    else
      pid := public.upsert_product(it);
    end if;
    insert into public.post_products (post_id, product_id, sort) values (target, pid, n) on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

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

create or replace function public.request_post(p jsonb)
returns table (post_id uuid, job_id uuid)
language plpgsql set search_path = '' as $$
declare
  ch text := coalesce(nullif(p->>'channel_id', ''), (select s.default_channel from public.settings s where s.id = 1), 'naver_blog');
  progs text[];
  kw text := left(btrim(coalesce(p->>'keyword', '')), 120);
  names text;
  new_post uuid;
  new_job uuid;
begin
  if kw = '' then raise exception 'keyword is required'; end if;
  if not exists (select 1 from public.channels c where c.id = ch and c.active) then raise exception 'unknown channel'; end if;
  progs := case when jsonb_typeof(p->'program_ids') = 'array'
             then array(select x from jsonb_array_elements_text(p->'program_ids') x
                        where exists (select 1 from public.programs pr where pr.id = x and pr.active))
             else coalesce((select s.default_programs from public.settings s where s.id = 1), '{}'::text[]) end;
  perform public.assert_compat(progs, ch);
  names := coalesce((select string_agg(pr.name, ', ') from public.programs pr where pr.id = any(progs)), '');

  insert into public.posts (keyword, money, platform, style, len, body, stage, channel_id, program_ids, content_type, category,
                            topic_id, experience, source, titles)
  values (kw, names, coalesce((select c.name from public.channels c where c.id = ch), ''), '',
          coalesce(nullif(p->>'len', ''), '2500'), '', 'queued', ch, progs,
          coalesce(p->>'content_type', ''), left(coalesce(p->>'category', ''), 60),
          case when coalesce(p->>'topic_id', '') ~ '^[0-9a-f-]{36}$' then (p->>'topic_id')::uuid end,
          left(coalesce(p->>'experience', ''), 3000), 'request',
          case when coalesce(p->>'title', '') <> '' then jsonb_build_array(left(p->>'title', 200)) else '[]'::jsonb end)
  returning id into new_post;

  perform public.attach_products(new_post, p->'products');
  if coalesce(p->>'link', '') ~* '^https?://[^\s"''<>]+$' then
    insert into public.links (post_id, url, program_id, channel_id) values (new_post, p->>'link', progs[1], ch);
  end if;

  insert into public.requests (keyword, style, money, platform, len, link, exp, ref, status, post_id, kind, payload)
  values (kw, coalesce(p->>'content_type', ''), names, coalesce((select c.name from public.channels c where c.id = ch), ''),
          coalesce(nullif(p->>'len', ''), '2500'),
          case when coalesce(p->>'link', '') ~* '^https?://[^\s"''<>]+$' then p->>'link' else '' end,
          left(coalesce(p->>'experience', ''), 3000), left(coalesce(p->>'ref', ''), 6000),
          'pending', new_post, 'write',
          jsonb_strip_nulls(jsonb_build_object('notes', nullif(left(coalesce(p->>'notes', ''), 1000), ''))))
  returning id into new_job;

  if coalesce(p->>'topic_id', '') ~ '^[0-9a-f-]{36}$' then
    update public.topics t set status = '제작 요청됨' where t.id = (p->>'topic_id')::uuid;
  end if;
  return query select new_post, new_job;
end $$;

create or replace function public.job_start(job uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare r public.requests;
begin
  update public.requests set started_at = now(), attempts = attempts + 1
    where id = job and status = 'pending' returning * into r;
  if r.id is null then raise exception 'job is not pending'; end if;
  if r.kind = 'write' and r.post_id is not null then
    update public.posts set stage = 'writing', error = '' where id = r.post_id and stage in ('queued','failed','verify','researching');
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.fill_post(target uuid, p jsonb) returns date
language plpgsql set search_path = '' as $$
declare
  kst_today date := (now() at time zone 'Asia/Seoul')::date;
  d date;
  st text;
begin
  if length(coalesce(p->>'body', '')) < 50 then raise exception 'body is required'; end if;
  select stage, publish_date into st, d from public.posts where id = target and deleted_at is null;
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
  where id = target;
  perform public.attach_products(target, p->'products');
  update public.requests set status = 'done', done_at = now(), note = ''
    where post_id = target and kind = 'write' and status = 'pending';
  return d;
end $$;

create or replace function public.job_fail(job uuid, msg text, needs_input boolean default false) returns void
language plpgsql set search_path = '' as $$
declare r public.requests;
begin
  update public.requests set status = 'failed', note = left(coalesce(msg, ''), 500), done_at = now()
    where id = job returning * into r;
  if r.id is not null and r.post_id is not null and r.kind = 'write' then
    update public.posts set stage = case when needs_input then 'verify' else 'failed' end, error = left(coalesce(msg, ''), 500)
      where id = r.post_id and stage in ('queued','researching','writing','verify','failed');
  end if;
end $$;

create or replace function public.add_topics(job uuid, items jsonb) returns int
language plpgsql set search_path = '' as $$
declare it jsonb; n int := 0; org text;
begin
  if jsonb_typeof(items) <> 'array' then raise exception 'items must be an array'; end if;
  org := coalesce((select r.payload->>'mode' from public.requests r where r.id = job), 'ai');
  for it in select value from jsonb_array_elements(items) loop
    continue when coalesce(btrim(it->>'title'), '') = '';
    insert into public.topics (title, keyword, category, search_intent, audience, problem, affiliate_fit, product_availability,
                               competition, differentiation, seasonality, research_needed, rec_channels, rec_programs,
                               rec_content_type, scores, basis, origin, job_id)
    values (left(btrim(it->>'title'), 200), coalesce(it->>'keyword', ''), coalesce(it->>'category', ''),
            coalesce(it->>'search_intent', ''), coalesce(it->>'audience', ''), coalesce(it->>'problem', ''),
            coalesce(it->>'affiliate_fit', ''), coalesce(it->>'product_availability', ''), coalesce(it->>'competition', ''),
            coalesce(it->>'differentiation', ''), coalesce(it->>'seasonality', ''), coalesce(it->>'research_needed', ''),
            case when jsonb_typeof(it->'rec_channels') = 'array'
              then array(select x from jsonb_array_elements_text(it->'rec_channels') x where exists (select 1 from public.channels c where c.id = x))
              else '{}'::text[] end,
            case when jsonb_typeof(it->'rec_programs') = 'array'
              then array(select x from jsonb_array_elements_text(it->'rec_programs') x where exists (select 1 from public.programs pr where pr.id = x))
              else '{}'::text[] end,
            coalesce(it->>'rec_content_type', ''),
            case when jsonb_typeof(it->'scores') = 'object' then it->'scores' else '{}'::jsonb end,
            coalesce(it->>'basis', ''),
            case when org = 'performance' then 'performance' else 'ai' end,
            job);
    n := n + 1;
  end loop;
  if job is not null then
    update public.requests set status = 'done', done_at = now(), note = n || '개 추천' where id = job;
  end if;
  return n;
end $$;

create or replace function public.set_variants(target uuid, job uuid, v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'variants must be an object'; end if;
  update public.posts set variants = variants || v || jsonb_build_object('_updated_at', now())
    where id = target and deleted_at is null;
  if not found then raise exception 'post not found'; end if;
  if job is not null then
    update public.requests set status = 'done', done_at = now(), note = '' where id = job;
  end if;
end $$;

create or replace function public.log_run(kind text, status text, done int, failed int, written int, note text, err text default '')
returns void
language sql set search_path = '' as $$
  insert into public.runs (kind, status, jobs_done, jobs_failed, written, note, error)
  values (coalesce(kind, 'auto'),
          case when status in ('성공','일부 실패','실패') then status else '성공' end,
          coalesce(done, 0), coalesce(failed, 0), coalesce(written, 0), left(coalesce(note, ''), 500), left(coalesce(err, ''), 1000));
$$;

create or replace function public.stats(d_from date default null, d_to date default null) returns jsonb
language sql stable set search_path = '' as $$
with m as (
  select m.*,
    coalesce(m.channel_id, p.channel_id) as ch,
    coalesce(m.program_id, case when cardinality(p.program_ids) = 1 then p.program_ids[1] end) as pr,
    nullif(p.category, '') as cat
  from public.metrics m
  left join public.posts p on p.id = m.post_id
  where (d_from is null or m.period_end >= d_from) and (d_to is null or m.period_start <= d_to)
), g as (
  select grouping(post_id) as g_post, grouping(ch) as g_ch, grouping(pr) as g_pr, grouping(cat) as g_cat,
    post_id, ch, pr, cat, count(*) as rows,
    jsonb_build_object(
      'views', jsonb_build_object('sum', sum(views), 'n', count(views)),
      'impressions', jsonb_build_object('sum', sum(impressions), 'n', count(impressions)),
      'clicks', jsonb_build_object('sum', sum(clicks), 'n', count(clicks)),
      'orders', jsonb_build_object('sum', sum(orders), 'n', count(orders)),
      'cancels', jsonb_build_object('sum', sum(cancels), 'n', count(cancels)),
      'revenue_est', jsonb_build_object('sum', sum(revenue_est), 'n', count(revenue_est)),
      'revenue_confirmed', jsonb_build_object('sum', sum(revenue_confirmed), 'n', count(revenue_confirmed)),
      'revenue_paid', jsonb_build_object('sum', sum(revenue_paid), 'n', count(revenue_paid)),
      'cost', jsonb_build_object('sum', sum(cost), 'n', count(cost)),
      'sources', to_jsonb(array_remove(array_agg(distinct nullif(source_label, '')), null)),
      'last_date', max(period_end)
    ) as v
  from m
  group by grouping sets ((), (post_id), (ch), (pr), (cat))
)
select jsonb_build_object(
  'from', d_from, 'to', d_to,
  'totals', coalesce((select v || jsonb_build_object('rows', rows) from g where g_post = 1 and g_ch = 1 and g_pr = 1 and g_cat = 1),
                     jsonb_build_object('rows', 0)),
  'by_post', coalesce((select jsonb_agg(v || jsonb_build_object('key', post_id, 'rows', rows)) from g where g_post = 0), '[]'::jsonb),
  'by_channel', coalesce((select jsonb_agg(v || jsonb_build_object('key', ch, 'rows', rows)) from g where g_ch = 0), '[]'::jsonb),
  'by_program', coalesce((select jsonb_agg(v || jsonb_build_object('key', pr, 'rows', rows)) from g where g_pr = 0), '[]'::jsonb),
  'by_category', coalesce((select jsonb_agg(v || jsonb_build_object('key', cat, 'rows', rows)) from g where g_cat = 0), '[]'::jsonb)
);
$$;

create or replace function public.writer_context() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'kst_now', (now() at time zone 'Asia/Seoul'),
    'settings', (select to_jsonb(s) - 'id' - 'money' - 'platform' from public.settings s where s.id = 1),
    'programs', (select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'kind', pr.kind, 'needs_link', pr.needs_link,
                    'needs_disclosure', pr.needs_disclosure, 'my_status', pr.my_status) order by pr.sort)
                 from public.programs pr where pr.active),
    'channels', (select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'max_chars', c.max_chars,
                    'clickable_links', c.clickable_links) order by c.sort)
                 from public.channels c where c.active),
    'compat', (select coalesce(jsonb_agg(jsonb_build_object('program', pc.program_id, 'channel', pc.channel_id, 'verdict', pc.verdict)), '[]'::jsonb)
               from public.program_channels pc),
    'jobs', (select coalesce(jsonb_agg(j order by j.created_at), '[]'::jsonb) from (
        select r.id, r.kind, r.keyword, r.style as content_type, r.link, r.exp as experience, r.ref, r.payload, r.attempts,
               r.post_id, r.created_at,
               case when r.post_id is not null then (
                 select jsonb_build_object(
                   'channel_id', p.channel_id, 'program_ids', p.program_ids, 'content_type', p.content_type,
                   'category', p.category, 'experience', p.experience, 'title', p.titles->>0, 'len', p.len,
                   'body', case when r.kind = 'reformat' then p.body end,
                   'sources', case when r.kind = 'reformat' then p.sources end,
                   'products', (select coalesce(jsonb_agg(to_jsonb(pr) - 'created_at' - 'updated_at' order by pp.sort), '[]'::jsonb)
                                from public.post_products pp join public.products pr on pr.id = pp.product_id where pp.post_id = p.id))
                 from public.posts p where p.id = r.post_id) end as post
        from public.requests r
        where r.status = 'pending' and (r.started_at is null or r.started_at < now() - interval '30 minutes')
        order by r.created_at
        limit 8) j),
    'upcoming', (select count(*) from public.posts p
                 where p.deleted_at is null and p.stage not in ('failed','queued')
                   and p.publish_date between (now() at time zone 'Asia/Seoul')::date + 1 and (now() at time zone 'Asia/Seoul')::date + 7),
    'recent_keywords', (select coalesce(jsonb_agg(distinct p.keyword), '[]'::jsonb) from public.posts p
                        where p.created_at > now() - interval '90 days' and p.keyword <> ''),
    'adopted_topics', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'keyword', t.keyword,
                          'category', t.category, 'rec_content_type', t.rec_content_type)), '[]'::jsonb)
                       from public.topics t where t.status = '채택'),
    'performance_90d', (select coalesce(jsonb_agg(x order by x.revenue_est desc nulls last, x.clicks desc nulls last), '[]'::jsonb) from (
        select p.keyword, p.category, p.content_type, p.channel_id,
               sum(m.views) as views, sum(m.clicks) as clicks, sum(m.orders) as orders,
               sum(m.revenue_est) as revenue_est, sum(m.revenue_confirmed) as revenue_confirmed
        from public.metrics m join public.posts p on p.id = m.post_id
        where m.period_end >= (now() at time zone 'Asia/Seoul')::date - 90
        group by p.id
        order by sum(m.revenue_est) desc nulls last, sum(m.clicks) desc nulls last
        limit 20) x)
  );
$$;

revoke execute on function
  public.posts_sync_stage(), public.compat_verdict(text, text), public.assert_compat(text[], text),
  public.upsert_product(jsonb), public.attach_products(uuid, jsonb), public.request_post(jsonb),
  public.job_start(uuid), public.fill_post(uuid, jsonb), public.job_fail(uuid, text, boolean),
  public.add_topics(uuid, jsonb), public.set_variants(uuid, uuid, jsonb),
  public.log_run(text, text, int, int, int, text, text), public.stats(date, date), public.writer_context()
  from public, anon, authenticated;
grant execute on function
  public.compat_verdict(text, text), public.assert_compat(text[], text), public.upsert_product(jsonb),
  public.attach_products(uuid, jsonb), public.request_post(jsonb), public.stats(date, date), public.next_free_date(date)
  to service_role;
