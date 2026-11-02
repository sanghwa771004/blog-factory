-- 021: 전문성·사람 말투 (1.7.0)
-- 사용자 요청 (2026-11-02 21:29 "조금 더 전문성… AI가 쓴 티… 구어체… 사진·다른 블로그 아이디어" → 22:44 "싹다해줘")
--   1 말투 입히기(settings.voice) 2 AI 티 검사·사람 말투로 다듬기(작업 polish, 이전 본문 보관) 3 전문가 틀(기준·용어·출처 번호·시리즈)
--   4 투자 글은 투자 블로그로(settings.invest_channel) 5 숫자 확인표(posts.figures) 6·7 정보 카드·썸네일(앱이 그림 — DB 변경 없음)
--   8 써도 되는 사진(Pixabay·Unsplash·공공누리 — Pixabay 검색 결과는 api_cache 에 24시간) 9 제미나이 방향(프롬프트) 10 잘 나가는 글 '틀'(post_templates — 원문은 저장 안 함)
-- 추가형: 열·표·함수만 더하거나 바꿈. 이 파일은 데이터를 지우지 않음. 다시 돌려도 같은 결과.

-- 1 ───────── 열
alter table public.posts add column if not exists figures jsonb not null default '[]'::jsonb;
alter table public.settings add column if not exists voice jsonb not null default '{}'::jsonb;
alter table public.settings add column if not exists series jsonb not null
  default '{"market": "오늘의 증시", "stock": "종목 한 장 정리"}'::jsonb;
alter table public.settings add column if not exists invest_channel text not null default 'naver_blog_invest';
alter table public.settings add column if not exists brand_name text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'posts_figures_shape') then
    alter table public.posts add constraint posts_figures_shape check (jsonb_typeof(figures) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_voice_shape') then
    alter table public.settings add constraint settings_voice_shape check (jsonb_typeof(voice) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_series_shape') then
    alter table public.settings add constraint settings_series_shape check (jsonb_typeof(series) = 'object');
  end if;
end $$;

-- 2 ───────── 투자 블로그 채널 (증시·종목 글을 생활·가전 블로그와 나눔 — 블로그 주제가 섞이면 전문성이 흐려져서)
-- 수익 모델 판정은 네이버 블로그와 같게 복사 (같은 네이버 블로그라서). 이미 있으면 그대로
insert into public.channels (id, name, kind, html_paste, clickable_links, notes, builtin, active, sort)
values ('naver_blog_invest', '네이버 블로그 (투자)', 'blog', true, true, '증시·종목 글을 올리는 두 번째 네이버 블로그', true, true, 15)
on conflict (id) do nothing;
insert into public.program_channels (program_id, channel_id, verdict, reason, source_url, checked_at)
select pc.program_id, 'naver_blog_invest', pc.verdict, pc.reason, pc.source_url, pc.checked_at
from public.program_channels pc where pc.channel_id = 'naver_blog'
on conflict (program_id, channel_id) do nothing;

-- 3 ───────── 작업 종류 polish (사람 말투로 다듬기), 사진 공급자·출처 종류
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'requests_kind_check' and pg_get_constraintdef(oid) not like '%polish%') then
    alter table public.requests drop constraint requests_kind_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'requests_kind_check') then
    alter table public.requests add constraint requests_kind_check check (kind in ('write', 'topics', 'reformat', 'refresh', 'polish'));
  end if;
  if exists (select 1 from pg_constraint where conname = 'post_images_provider_check' and pg_get_constraintdef(oid) not like '%pixabay%') then
    alter table public.post_images drop constraint post_images_provider_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'post_images_provider_check') then
    alter table public.post_images add constraint post_images_provider_check
      check (provider in ('', 'openai', 'cloudflare', 'gemini', 'pexels', 'pixabay', 'unsplash', 'upload', 'cardnews', 'composite'));
  end if;
  -- kogl: 공공누리 제1유형(출처만 밝히면 상업적 이용 가능)으로 받은 공공기관 사진
  if exists (select 1 from pg_constraint where conname = 'post_images_source_type_check' and pg_get_constraintdef(oid) not like '%kogl%') then
    alter table public.post_images drop constraint post_images_source_type_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'post_images_source_type_check') then
    alter table public.post_images add constraint post_images_source_type_check check (source_type in ('', 'own', 'official', 'external', 'kogl'));
  end if;
end $$;

-- 4 ───────── 이전 본문 보관 (다듬기·되돌리기 전에 저장 — 되돌릴 수 있게)
create table if not exists public.post_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  body text not null,
  titles jsonb not null default '[]'::jsonb,
  reason text not null default '' check (reason in ('', 'polish', 'revert')),
  job_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists post_revisions_post_idx on public.post_revisions (post_id, created_at desc);

-- 5 ───────── 잘 나가는 글의 '틀' — 구성(소제목 역할 순서)·분량·사진 수·도입/마무리 방식·말투만. 원문은 저장하지 않음
-- fp: 원문을 8글자씩 잘라 만든 해시 (새 원고가 참고 글 문장을 그대로 가져왔는지 검사용 — 해시로는 원문을 되살릴 수 없음)
create table if not exists public.post_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null default '' check (kind in ('', 'affiliate', 'adpost', 'trending', 'market', 'stock')),
  name text not null default '' check (length(name) <= 60),
  outline jsonb not null default '[]'::jsonb check (jsonb_typeof(outline) = 'array'),
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  fp int[] not null default '{}',
  note text not null default '' check (length(note) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists post_templates_kind_idx on public.post_templates (kind, created_at desc);

alter table public.post_revisions enable row level security;
alter table public.post_templates enable row level security;
revoke all on public.post_revisions, public.post_templates from anon, authenticated;

-- 6 ───────── 사람 말투로 다듬기 저장 (자동 작가·Claude 안 글공장이 부름)
-- 사진 자리·링크 자리 줄은 한 글자도 바뀌면 안 됨 (이미지 연결·제휴 링크가 그 줄에 붙어 있어서) → 바뀌면 거절
-- 이전 본문은 post_revisions 에 남기고, '발행 준비'였으면 '검수 필요'로 (글이 바뀌었으니 다시 봐야 함)
create or replace function public.set_polish(target uuid, job uuid, p jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  cur record;
  nb text := p->>'body';
  old_marks text[];
  new_marks text[];
begin
  if job is null then raise exception 'polish job is required'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'polish must be an object'; end if;
  if length(coalesce(nb, '')) < 50 then raise exception 'body is required'; end if;
  if length(nb) > 60000 then raise exception 'body is too long'; end if;
  select x.id, x.body, x.titles, x.stage into cur from public.posts x where x.id = target and x.deleted_at is null for update;
  if not found then raise exception 'post not found'; end if;
  perform 1 from public.requests r where r.id = job and r.kind = 'polish' and r.post_id = target and r.status = 'pending';
  if not found then raise exception 'polish job is not pending for this post'; end if;
  select coalesce(array_agg(btrim(l.t) order by l.n), '{}') into old_marks
    from regexp_split_to_table(coalesce(cur.body, ''), E'\n') with ordinality as l(t, n) where btrim(l.t) ~ '^\[(이미지|링크)';
  select coalesce(array_agg(btrim(l.t) order by l.n), '{}') into new_marks
    from regexp_split_to_table(nb, E'\n') with ordinality as l(t, n) where btrim(l.t) ~ '^\[(이미지|링크)';
  if old_marks is distinct from new_marks then raise exception 'polish changed image or link lines'; end if;
  insert into public.post_revisions (post_id, body, titles, reason, job_id) values (target, coalesce(cur.body, ''), coalesce(cur.titles, '[]'::jsonb), 'polish', job);
  update public.posts x set
    body = nb,
    titles = case when jsonb_typeof(p->'titles') = 'array' and jsonb_array_length(p->'titles') between 1 and 5 then p->'titles' else x.titles end,
    stage = case when x.stage in ('ready', 'scheduled') then 'review' else x.stage end,
    ai_notes = coalesce(x.ai_notes, '{}'::jsonb) || jsonb_build_object('polished_at', now())
  where x.id = target;
  update public.requests r set status = 'done', done_at = now(), note = '' where r.id = job;
end $$;

-- 되돌리기: 보관한 이전 본문으로 (지금 본문도 보관하고 바꿈 → 되돌린 것도 다시 되돌릴 수 있음)
create or replace function public.revert_post(rev uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  r record;
  cur record;
begin
  select v.* into r from public.post_revisions v where v.id = rev;
  if not found then raise exception 'revision not found'; end if;
  select x.id, x.body, x.titles into cur from public.posts x where x.id = r.post_id and x.deleted_at is null for update;
  if not found then raise exception 'post not found'; end if;
  insert into public.post_revisions (post_id, body, titles, reason) values (cur.id, coalesce(cur.body, ''), coalesce(cur.titles, '[]'::jsonb), 'revert');
  update public.posts x set body = r.body, titles = case when jsonb_array_length(r.titles) > 0 then r.titles else x.titles end,
    stage = case when x.stage in ('ready', 'scheduled') then 'review' else x.stage end
  where x.id = cur.id;
  return jsonb_build_object('post_id', cur.id, 'restored_from', r.created_at);
end $$;

-- 6b ───────── 외부 API 검색 결과 저장 (Pixabay 이용 조건: 같은 요청은 24시간 저장해서 다시 묻지 않기). 서버 키로만
create table if not exists public.api_cache (
  key text primary key check (length(key) between 1 and 300),
  body jsonb not null,
  at timestamptz not null default now()
);
alter table public.api_cache enable row level security;
revoke all on public.api_cache from anon, authenticated;

-- 7 ───────── add_post: 020 + 숫자 확인표(figures) + 증시·종목 글은 투자 블로그 채널로
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
  pk text := coalesce(p->>'plan_kind', '');
  src text := coalesce(nullif(p->>'source', ''), 'auto');
  cap int;
  done int;
  inv text;
  figs jsonb := '[]'::jsonb;
begin
  if length(coalesce(p ->> 'body', '')) < 50 then
    raise exception 'body is required';
  end if;
  if pk not in ('', 'affiliate', 'adpost', 'trending', 'market', 'stock') then
    raise exception 'bad plan_kind: %', pk;
  end if;
  if pk <> '' and src <> 'auto' then
    raise exception 'plan_kind is only for auto posts';
  end if;
  if src = 'auto' and pk <> '' then
    cap := coalesce((select case when (s.daily_plan->>pk) ~ '^\d+$' then least((s.daily_plan->>pk)::int, 4) else 0 end
                     from public.settings s where s.id = 1), 0);
    select count(*) into done from public.posts x
    where x.source = 'auto' and x.plan_kind = pk
      and x.created_at >= (kst_today::timestamp at time zone 'Asia/Seoul');
    if done >= cap then
      raise exception 'plan full: % (% / %)', pk, done, cap;
    end if;
  elsif src = 'auto' then
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
  -- 1.7.0: 증시·종목 글은 투자 블로그로 (settings.invest_channel — 비우면 같은 블로그)
  if pk in ('market', 'stock') then
    inv := coalesce((select s.invest_channel from public.settings s where s.id = 1), '');
    if inv <> '' and exists (select 1 from public.channels c where c.id = inv and c.active) then ch := inv; end if;
  end if;
  -- 1.7.0: 숫자 확인표 (항목·값·단위·기준일·출처) — 객체만, 30개까지
  if jsonb_typeof(p->'figures') = 'array' then
    figs := coalesce((select jsonb_agg(f.x order by f.n) from jsonb_array_elements(p->'figures') with ordinality as f(x, n)
                      where jsonb_typeof(f.x) = 'object' and f.n <= 30), '[]'::jsonb);
  end if;
  if jsonb_typeof(p->'program_ids') = 'array' then
    progs := array(select x from jsonb_array_elements_text(p->'program_ids') x where exists (select 1 from public.programs pr where pr.id = x));
  elsif coalesce(p->>'money', '') <> '' then
    progs := case p->>'money' when '쿠팡파트너스' then array['coupang_partners'] when '토스 쇼핑 제휴' then array['toss_sharelink']
                              when '애드센스(정보성 글)' then array['google_adsense'] else '{}'::text[] end;
  else
    progs := coalesce((select s.default_programs from public.settings s where s.id = 1), '{}'::text[]);
  end if;
  perform public.assert_compat(progs, ch);

  -- 계획 글은 그날 올릴 글이라 오늘 날짜 (사용자가 직접 발행). 예전 방식은 발행표의 빈 날
  d := case when pk <> '' then kst_today else public.next_free_date(kst_today + greatest(coalesce(start_offset, 1), 0)) end;
  insert into public.posts (keyword, money, platform, style, len, titles, body, hashtags, threads, instagram, link, publish_date,
                            source, request_id, stage, channel_id, program_ids, content_type, category, topic_id, experience,
                            sources, summary, ai_notes, plan_kind, figures)
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
    src,
    req,
    'review', ch, progs,
    coalesce(p->>'content_type', ''),
    coalesce(p->>'category', ''),
    case when coalesce(p->>'topic_id', '') ~ '^[0-9a-f-]{36}$' then (p->>'topic_id')::uuid end,
    coalesce(p->>'experience', ''),
    case when jsonb_typeof(p->'sources') = 'array' then p->'sources' else '[]'::jsonb end,
    coalesce(p->>'summary', ''),
    jsonb_strip_nulls(jsonb_build_object('needs_fact_check', p->'needs_fact_check', 'notes', p->>'notes', 'written_at', now())),
    pk,
    figs
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

-- 8 ───────── 오늘 계획: 020 + 시리즈 이름·다음 번호
create or replace function public.plan_today() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'date', (now() at time zone 'Asia/Seoul')::date,
    'plan', coalesce((select s.daily_plan from public.settings s where s.id = 1), '{}'::jsonb),
    'keep_days', coalesce((select s.keep_days from public.settings s where s.id = 1), 3),
    'done', coalesce((
      select jsonb_object_agg(t.plan_kind, t.n) from (
        select p.plan_kind, count(*) as n from public.posts p
        where p.source = 'auto' and p.plan_kind <> ''
          and p.created_at >= ((now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul'
        group by p.plan_kind) t), '{}'::jsonb),
    -- 1.7.0: 시리즈 다음 번호 (그 종류로 쓴 계획 글 수 + 1, 휴지통 포함 — 번호가 되돌아가지 않게)
    'series', coalesce((select s.series from public.settings s where s.id = 1), '{}'::jsonb),
    'series_next', coalesce((
      select jsonb_object_agg(k.kind, (select count(*) from public.posts p where p.source = 'auto' and p.plan_kind = k.kind) + 1)
      from unnest(array['affiliate', 'adpost', 'trending', 'market', 'stock']) as k(kind)), '{}'::jsonb)
  )
$$;

-- 9 ───────── 자동 작가 상황판: 020 + 다듬기 작업의 본문 + 잘 나가는 글 '틀'
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
                   'body', case when r.kind in ('reformat', 'refresh', 'polish') then p.body end,
                   'sources', case when r.kind in ('reformat', 'refresh', 'polish') then p.sources end,
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
    'plan_today', public.plan_today(),
    -- 1.7.0: 잘 나가는 글에서 뽑은 '틀' (종류마다 가장 최근 것 — 구성·분량만, 원문 문장은 저장 안 함)
    'templates', (select coalesce(jsonb_agg(jsonb_build_object('kind', t.kind, 'name', t.name, 'outline', t.outline, 'stats', t.stats) order by t.kind), '[]'::jsonb)
                  from (select distinct on (x.kind) x.* from public.post_templates x where x.active order by x.kind, x.created_at desc) t),
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

-- 10 ───────── 잠금: 서버(서버 키)와 자동 작가(관리자 연결)만
revoke execute on function public.set_polish(uuid, uuid, jsonb), public.revert_post(uuid), public.plan_today(),
  public.add_post(jsonb, int), public.writer_context() from public, anon, authenticated;
grant execute on function public.set_polish(uuid, uuid, jsonb), public.revert_post(uuid), public.plan_today() to service_role;
