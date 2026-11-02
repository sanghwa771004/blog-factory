-- 020: 하루 계획 운영 (1.6.0)
-- 사용자 요청 (2026-11-02): 발행은 사용자가 직접 하고, 자동 작가는 하루 10편을 종류별로 씀
--   아침(08:51) 쿠팡·토스 링크 글 2 + 애드포스트 유입 글 2 / 점심(13:21) 오늘 뜬 주제(홈판) 2 / 저녁(18:51) 미국·한국 증시 정리 2 + 미국·한국 종목 설명 2
--   자동으로 쓴 원고는 만든 날부터 3일 지나면 휴지통으로 (최대 30개 쌓임). 사용자가 '보관'한 원고·직접 요청한 원고는 그대로
-- 추가형: 열·함수만 더하거나 바꿈. 이 파일은 데이터를 지우지 않음 — 정리는 expire_auto_posts() 를 부를 때만, 그것도 휴지통(deleted_at)으로만 (30일 동안 되살릴 수 있음)
-- 다시 돌려도 같은 결과.

-- 1 ───────── 열
alter table public.posts add column if not exists plan_kind text not null default '';
alter table public.posts add column if not exists keep boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'posts_plan_kind_check') then
    alter table public.posts add constraint posts_plan_kind_check
      check (plan_kind in ('', 'affiliate', 'adpost', 'trending', 'market', 'stock'));
  end if;
end $$;

-- 하루 계획: 종류별 하루 편수 (0~4). 비우면({}) 예전 방식(하루 발행 수 × 7 발행표)
alter table public.settings add column if not exists daily_plan jsonb not null
  default '{"affiliate": 2, "adpost": 2, "trending": 2, "market": 2, "stock": 2}'::jsonb;
-- 자동 원고를 며칠 두고 휴지통으로 보낼지 (만든 날 기준, 한국 날짜)
alter table public.settings add column if not exists keep_days int not null default 3;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_daily_plan_shape') then
    alter table public.settings add constraint settings_daily_plan_shape check (jsonb_typeof(daily_plan) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_keep_days_range') then
    alter table public.settings add constraint settings_keep_days_range check (keep_days between 1 and 14);
  end if;
end $$;

create index if not exists posts_auto_created_idx on public.posts (created_at) where source = 'auto';

-- 2 ───────── 하루 계획 도우미
-- 계획 합계 (알려진 종류만, 0~4 정수만 셈)
create or replace function public.plan_total() returns int
language sql stable set search_path = '' as $$
  select coalesce((
    select sum(least(greatest(e.value::int, 0), 4))::int
    from public.settings s, jsonb_each_text(s.daily_plan) e
    where s.id = 1 and e.key in ('affiliate', 'adpost', 'trending', 'market', 'stock') and e.value ~ '^\d+$'), 0)
$$;

-- 오늘(한국 날짜) 자동으로 쓴 원고 수 — 종류별. 사용자가 올리고 지운(휴지통) 원고도 셈 (같은 날 다시 쓰지 않게)
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
        group by p.plan_kind) t), '{}'::jsonb)
  )
$$;

-- 3 ───────── 자동 원고 정리: 만든 날(한국 날짜)부터 keep_days 일이 지난 자동 원고를 휴지통으로
-- 예: keep_days 3 → 11월 2일에 만든 원고는 11월 5일에 정리 (오늘·어제·그제 것만 남아서 하루 10편이면 최대 30개)
-- 사용자가 '보관'한 원고(keep)·직접 요청한 원고(source request·artifact·manual)는 건드리지 않음. 지우지 않고 휴지통으로만
create or replace function public.expire_auto_posts() returns jsonb
language plpgsql set search_path = '' as $$
declare
  kst_today date := (now() at time zone 'Asia/Seoul')::date;
  days int := coalesce((select s.keep_days from public.settings s where s.id = 1), 3);
  ids uuid[];
begin
  with x as (
    update public.posts p set deleted_at = now()
    where p.deleted_at is null and p.source = 'auto' and not p.keep
      and p.created_at < ((kst_today - days + 1)::timestamp at time zone 'Asia/Seoul')
    returning p.id)
  select coalesce(array_agg(x.id), '{}'::uuid[]) into ids from x;
  if coalesce(array_length(ids, 1), 0) > 0 then
    -- 그 원고에 걸려 있던, 아직 시작 안 한 작업(채널 변환·개선안)은 취소 (서버의 '휴지통으로 보내기'와 같게)
    update public.requests r set status = 'cancelled', done_at = now(), note = '원고가 자동 정리(휴지통)돼서 취소'
    where r.post_id = any(ids) and r.status = 'pending' and r.started_at is null;
  end if;
  return jsonb_build_object('expired', coalesce(array_length(ids, 1), 0), 'keep_days', days,
                            'kept_from', kst_today - days + 1);
end $$;

-- 4 ───────── 쌓인 원고 한도: 하루 계획이 있으면 계획 합계 × 보관일 (10편 × 3일 = 30). 없으면 예전 그대로
create or replace function public.backlog_state() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'backlog', (select count(*) from public.posts p
                where p.deleted_at is null and p.stage in ('review', 'verify', 'ready', 'scheduled')),
    'limit', coalesce((select case when public.plan_total() > 0 then public.plan_total() * greatest(coalesce(s.keep_days, 3), 1)
                                   when s.backlog_limit > 0 then s.backlog_limit
                                   else greatest(coalesce(s.per_day, 1), 1) * 7 end
                       from public.settings s where s.id = 1), 7),
    'overdue', (select count(*) from public.posts p
                where p.deleted_at is null and p.stage in ('review', 'verify', 'ready')
                  and p.publish_date < (now() at time zone 'Asia/Seoul')::date),
    'overdue_scheduled', (select count(*) from public.posts p
                where p.deleted_at is null and p.stage = 'scheduled'
                  and p.publish_date < (now() at time zone 'Asia/Seoul')::date)
  )
$$;

-- 5 ───────── add_post: plan_kind (하루 계획 종류) — 계획 글은 오늘 날짜로, 종류별 하루 편수를 넘기면 거절 (같은 실행이 두 번 돌아도 넘치지 않게)
-- plan_kind 가 없으면 016 과 똑같이 동작 (예전 자동 작가 프롬프트·앱 요청·Claude 안 글공장)
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
                            sources, summary, ai_notes, plan_kind)
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
    pk
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

-- 6 ───────── 자동 작가 상황판: 016 + 오늘 계획(plan_today)
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
    'plan_today', public.plan_today(),
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

-- 7 ───────── 잠금: 서버(서버 키)와 자동 작가(관리자 연결)만
revoke execute on function public.plan_total(), public.plan_today(), public.expire_auto_posts(),
  public.backlog_state(), public.add_post(jsonb, int), public.writer_context() from public, anon, authenticated;
grant execute on function public.plan_total(), public.plan_today(), public.expire_auto_posts(), public.backlog_state() to service_role;
