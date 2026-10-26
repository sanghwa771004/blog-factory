-- 016: 글공장 1.4.0 운영 시스템 — 게시 → 다른 채널 → 실적 → 개선 흐름을 닫는 데 필요한 것만 더함
-- 표·열은 더하기만 하고 기존 데이터는 그대로 (다시 돌려도 같은 결과)
--
-- 1) post_channels: 글을 다른 채널(티스토리·쓰레드·인스타 등)에 실제로 올린 기록 (주소·날짜·쓴 버전). 메인 채널 게시는 지금처럼 posts.blog_url·published_on
-- 2) search_terms: 블로그 통계에서 옮겨 적은 '유입 검색어' (글별·기간별). 실제로 들어온 검색어로 제목을 고치고 다음 주제를 고르는 데 씀
-- 3) settings.backlog_limit: 검수·게시 안 한 원고가 이만큼 쌓이면 자동 작가가 새 자동 글을 안 씀 (0 = 하루 발행 수 × 7)
-- 4) posts.refresh + 작업 종류 refresh: 게시한 글의 개선안(제목·도입부·소제목·링크 위치)을 자동 작가가 써서 저장. 글 자체는 안 바꿈
-- 5) 함수: backlog_state(쌓인 원고), reschedule_overdue(예정일 지난 원고 날짜 다시 잡기), set_refresh(개선안 저장),
--    add_post(자동 글은 쌓인 원고가 한도 이상이면 거절), writer_context(쌓인 원고·유입 검색어·개선안 작업 정보 추가)

-- 1 ───────── 다른 채널에 올린 기록
create table if not exists public.post_channels (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  channel_id text not null references public.channels(id),
  url text not null default '',
  posted_on date not null,
  variant_key text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'post_channels_post_channel_key') then
    alter table public.post_channels add constraint post_channels_post_channel_key unique (post_id, channel_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'post_channels_checks') then
    alter table public.post_channels add constraint post_channels_checks check (
      (url = '' or url ~* '^https://[^\s"''<>]+$') and length(url) <= 500
      and length(variant_key) <= 30 and length(note) <= 300);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'post_channels_touch') then
    create trigger post_channels_touch before update on public.post_channels for each row execute function public.touch_updated_at();
  end if;
end $$;

-- 2 ───────── 유입 검색어 (블로그 통계에서 옮겨 적은 숫자 — 앱이 직접 모으지 않음)
create table if not exists public.search_terms (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  term text not null,
  views int,
  period_start date not null,
  period_end date not null,
  channel_id text references public.channels(id),
  source_label text not null default '',
  created_at timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'search_terms_post_term_period_key') then
    alter table public.search_terms add constraint search_terms_post_term_period_key unique (post_id, term, period_start, period_end);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'search_terms_checks') then
    alter table public.search_terms add constraint search_terms_checks check (
      length(btrim(term)) between 1 and 100 and term = btrim(term)
      and (views is null or views >= 0) and period_end >= period_start and length(source_label) <= 60);
  end if;
end $$;
create index if not exists search_terms_post_idx on public.search_terms (post_id);
create index if not exists search_terms_period_idx on public.search_terms (period_end);

-- 3 ───────── 쌓아둘 원고 한도
alter table public.settings add column if not exists backlog_limit int not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_backlog_limit_range') then
    alter table public.settings add constraint settings_backlog_limit_range check (backlog_limit between 0 and 60);
  end if;
end $$;

-- 4 ───────── 개선안 (게시한 글을 어떻게 고치면 좋을지 — 글 본문은 안 바꿈)
alter table public.posts add column if not exists refresh jsonb not null default '{}'::jsonb;
do $$ begin
  -- 작업 종류에 refresh 추가 (예전 종류는 그대로 허용)
  if exists (select 1 from pg_constraint where conname = 'requests_kind_check' and pg_get_constraintdef(oid) not like '%refresh%') then
    alter table public.requests drop constraint requests_kind_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'requests_kind_check') then
    alter table public.requests add constraint requests_kind_check check (kind in ('write', 'topics', 'reformat', 'refresh'));
  end if;
end $$;

-- 5 ───────── 함수
-- 쌓인 원고: 사람이 검수·게시해야 하는 원고(검수 필요·정보 필요·발행 준비·예약). 한도 0이면 하루 발행 수 × 7
create or replace function public.backlog_state() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'backlog', (select count(*) from public.posts p
                where p.deleted_at is null and p.stage in ('review', 'verify', 'ready', 'scheduled')),
    'limit', coalesce((select case when s.backlog_limit > 0 then s.backlog_limit else greatest(coalesce(s.per_day, 1), 1) * 7 end
                       from public.settings s where s.id = 1), 7),
    'overdue', (select count(*) from public.posts p
                where p.deleted_at is null and p.stage in ('review', 'verify', 'ready', 'scheduled')
                  and p.publish_date < (now() at time zone 'Asia/Seoul')::date)
  )
$$;

-- 예정일이 지났는데 아직 게시 안 한 원고를 내일부터 빈 날에 다시 배정 (하루 발행 수를 넘지 않게, 지난 날짜 순서대로). 단계는 그대로
create or replace function public.reschedule_overdue() returns jsonb
language plpgsql set search_path = '' as $$
declare
  kst_today date := (now() at time zone 'Asia/Seoul')::date;
  r record;
  d date;
  moved jsonb := '[]'::jsonb;
begin
  for r in
    select p.id, p.publish_date from public.posts p
    where p.deleted_at is null and p.stage in ('review', 'verify', 'ready', 'scheduled') and p.publish_date < kst_today
    order by p.publish_date, p.created_at
    for update
  loop
    d := public.next_free_date(kst_today + 1);
    update public.posts set publish_date = d where id = r.id;
    moved := moved || jsonb_build_array(jsonb_build_object('id', r.id, 'from', r.publish_date, 'to', d));
  end loop;
  return moved;
end $$;

-- 개선안 저장 (자동 작가가 부름). 그 글의 refresh 작업만 완료로 바꿈
create or replace function public.set_refresh(target uuid, job uuid, v jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'refresh must be an object'; end if;
  if length(v::text) > 30000 then raise exception 'refresh is too long'; end if;
  update public.posts set refresh = v || jsonb_build_object('_updated_at', now(), '_job', job)
    where id = target and deleted_at is null;
  if not found then raise exception 'post not found'; end if;
  if job is not null then
    update public.requests set status = 'done', done_at = now(), note = ''
      where id = job and kind = 'refresh' and post_id = target and status = 'pending';
  end if;
end $$;

-- 원고 저장 (011 add_post + 자동 글은 쌓인 원고가 한도 이상이면 거절 — 요청·Claude 안 글공장 원고는 그대로 받음)
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
  bs jsonb;
begin
  if length(coalesce(p ->> 'body', '')) < 50 then
    raise exception 'body is required';
  end if;
  if coalesce(nullif(p->>'source', ''), 'auto') = 'auto' then
    bs := public.backlog_state();
    if (bs->>'backlog')::int >= (bs->>'limit')::int then
      raise exception 'backlog full: % drafts waiting (limit %)', bs->>'backlog', bs->>'limit';
    end if;
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

-- 자동 작가 상황판 (006 + 쌓인 원고·유입 검색어·개선안 작업에 필요한 글 정보)
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
                   'body', case when r.kind in ('reformat', 'refresh') then p.body end,
                   'sources', case when r.kind in ('reformat', 'refresh') then p.sources end,
                   'products', (select coalesce(jsonb_agg(to_jsonb(pr) - 'created_at' - 'updated_at' order by pp.sort), '[]'::jsonb)
                                from public.post_products pp join public.products pr on pr.id = pp.product_id where pp.post_id = p.id))
                 || case when r.kind = 'refresh' then jsonb_build_object(
                      'keyword', p.keyword, 'titles', p.titles, 'published_on', p.published_on, 'blog_url', p.blog_url,
                      'metrics', (select jsonb_build_object('rows', count(*), 'views', sum(m.views), 'impressions', sum(m.impressions),
                                         'clicks', sum(m.clicks), 'orders', sum(m.orders), 'revenue_est', sum(m.revenue_est),
                                         'last_date', max(m.period_end))
                                  from public.metrics m where m.post_id = p.id),
                      'search_terms', (select coalesce(jsonb_agg(jsonb_build_object('term', t.term, 'views', t.views) order by t.views desc nulls last), '[]'::jsonb)
                                       from (select st.term, sum(st.views) as views from public.search_terms st
                                             where st.post_id = p.id group by st.term
                                             order by sum(st.views) desc nulls last limit 20) t),
                      'other_channels', (select coalesce(jsonb_agg(jsonb_build_object('channel_id', pc.channel_id, 'posted_on', pc.posted_on) order by pc.posted_on), '[]'::jsonb)
                                         from public.post_channels pc where pc.post_id = p.id))
                    else '{}'::jsonb end
                 from public.posts p where p.id = r.post_id) end as post
        from public.requests r
        where r.status = 'pending' and (r.started_at is null or r.started_at < now() - interval '30 minutes')
        order by r.created_at
        limit 8) j),
    'upcoming', (select count(*) from public.posts p
                 where p.deleted_at is null and p.stage not in ('failed','queued')
                   and p.publish_date between (now() at time zone 'Asia/Seoul')::date + 1 and (now() at time zone 'Asia/Seoul')::date + 7),
    'backlog', public.backlog_state(),
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
        limit 20) x),
    'search_terms_top', (select coalesce(jsonb_agg(x order by x.views desc nulls last), '[]'::jsonb) from (
        select st.term, sum(st.views) as views, count(distinct st.post_id) as posts,
               (array_agg(p.keyword order by st.views desc nulls last))[1] as post_keyword
        from public.search_terms st join public.posts p on p.id = st.post_id
        where st.period_end >= (now() at time zone 'Asia/Seoul')::date - 90 and p.deleted_at is null
        group by st.term
        order by sum(st.views) desc nulls last
        limit 30) x)
  );
$$;

-- 6 ───────── 잠금: 표는 서버 함수(서버 키)만 읽고 씀
alter table public.post_channels enable row level security;
alter table public.search_terms enable row level security;
revoke all on public.post_channels, public.search_terms from anon, authenticated;
revoke execute on function
  public.backlog_state(), public.reschedule_overdue(), public.set_refresh(uuid, uuid, jsonb), public.add_post(jsonb, int), public.writer_context()
  from public, anon, authenticated;
grant execute on function public.backlog_state(), public.reschedule_overdue() to service_role;
