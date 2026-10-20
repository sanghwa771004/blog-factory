-- 005: 운영 OS 확장 — 게시 채널·수익 모델 분리, 상품·링크·주제·실적·작업 상태, 기기 로그인
-- 기존 표·열은 지우지 않음. 기존 원고는 새 열로 옮겨 담음.

create table if not exists public.channels (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  kind text not null check (kind in ('blog','site','sns','other')),
  html_paste boolean not null default true,
  clickable_links boolean not null default true,
  max_chars int,
  notes text not null default '',
  source_url text not null default '',
  checked_at date,
  builtin boolean not null default false,
  active boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.programs (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  kind text not null check (kind in ('affiliate','ads','sponsor','product','cpa','other')),
  needs_signup text not null default '확인 필요' check (needs_signup in ('필요','불필요','확인 필요')),
  needs_link boolean not null default false,
  needs_disclosure text not null default '확인 필요' check (needs_disclosure in ('필요','불필요','확인 필요')),
  disclosure_template text not null default '',
  disclosure_where text not null default '',
  data_source text not null default '',
  commission_note text not null default '',
  my_status text not null default '미가입' check (my_status in ('사용 중','가입 대기','미가입','확인 필요')),
  unverified text not null default '',
  policy_url text not null default '',
  policy_checked_at date,
  builtin boolean not null default false,
  active boolean not null default true,
  sort int not null default 100,
  updated_at timestamptz not null default now()
);

create table if not exists public.program_channels (
  program_id text not null references public.programs(id) on delete cascade,
  channel_id text not null references public.channels(id) on delete cascade,
  verdict text not null check (verdict in ('가능','불가','확인 필요')),
  reason text not null default '',
  source_url text not null default '',
  checked_at date,
  primary key (program_id, channel_id)
);

insert into public.channels (id, name, kind, html_paste, clickable_links, builtin, sort) values
  ('naver_blog', '네이버 블로그', 'blog', true, true, true, 10),
  ('tistory', '티스토리', 'blog', true, true, true, 20),
  ('website', '워드프레스 등 독립 사이트', 'site', true, true, true, 30),
  ('threads', '쓰레드', 'sns', false, true, true, 40),
  ('instagram', '인스타그램', 'sns', false, false, true, 50)
on conflict (id) do nothing;

insert into public.programs (id, name, kind, needs_link, builtin, sort) values
  ('coupang_partners', '쿠팡파트너스', 'affiliate', true, true, 10),
  ('toss_sharelink', '토스쇼핑 쉐어링크', 'affiliate', true, true, 20),
  ('naver_shopping_connect', '네이버 쇼핑 커넥트', 'affiliate', true, true, 30),
  ('naver_adpost', '네이버 애드포스트', 'ads', false, true, 40),
  ('google_adsense', 'Google 애드센스', 'ads', false, true, 50),
  ('sponsorship', '브랜드 협찬·제작비', 'sponsor', false, true, 60),
  ('digital_product', '디지털 상품 판매', 'product', true, true, 70),
  ('cpa', 'CPA·리드 제휴', 'cpa', true, true, 80)
on conflict (id) do nothing;

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  keyword text not null default '',
  category text not null default '',
  search_intent text not null default '',
  audience text not null default '',
  problem text not null default '',
  affiliate_fit text not null default '',
  product_availability text not null default '',
  competition text not null default '',
  differentiation text not null default '',
  seasonality text not null default '',
  research_needed text not null default '',
  rec_channels text[] not null default '{}',
  rec_programs text[] not null default '{}',
  rec_content_type text not null default '',
  scores jsonb not null default '{}'::jsonb,
  basis text not null default '',
  status text not null default '후보' check (status in ('후보','채택','보류','제외','제작 요청됨')),
  origin text not null default 'ai' check (origin in ('ai','user','performance')),
  job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text not null default '',
  model text not null default '',
  category text not null default '',
  price numeric,
  price_checked_at date,
  price_source_url text not null default '',
  specs jsonb not null default '[]'::jsonb,
  pros text not null default '',
  cons text not null default '',
  compare_with text not null default '',
  source_urls text[] not null default '{}',
  info_checked_at date,
  trust text not null default '미검증' check (trust in ('미검증','출처 있음','확인 완료')),
  used_by_me boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.posts
  add column if not exists stage text not null default 'review',
  add column if not exists channel_id text references public.channels(id),
  add column if not exists program_ids text[] not null default '{}',
  add column if not exists content_type text not null default '',
  add column if not exists category text not null default '',
  add column if not exists topic_id uuid references public.topics(id) on delete set null,
  add column if not exists experience text not null default '',
  add column if not exists sources jsonb not null default '[]'::jsonb,
  add column if not exists summary text not null default '',
  add column if not exists variants jsonb not null default '{}'::jsonb,
  add column if not exists ai_notes jsonb not null default '{}'::jsonb,
  add column if not exists disclosure_text text not null default '',
  add column if not exists disclosure_at timestamptz,
  add column if not exists published_on date,
  add column if not exists effort_minutes int check (effort_minutes is null or effort_minutes >= 0),
  add column if not exists error text not null default '',
  add column if not exists deleted_at timestamptz;

alter table public.posts add constraint posts_stage_check check (stage in
  ('queued','researching','verify','writing','review','ready','scheduled','published','collecting','analyzed','failed'));

create table if not exists public.post_products (
  post_id uuid not null references public.posts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sort int not null default 0,
  primary key (post_id, product_id)
);

create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  program_id text references public.programs(id),
  channel_id text references public.channels(id),
  url text not null check (url ~* '^https?://[^\s"''<>]+$'),
  cta text not null default '',
  sort int not null default 0,
  status text not null default '미확인' check (status in ('미확인','정상','오류')),
  status_note text not null default '',
  checked_at date,
  created_at timestamptz not null default now()
);
create index if not exists links_post_idx on public.links (post_id, sort);

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  filename text not null default '',
  source_label text not null default '',
  program_id text references public.programs(id),
  channel_id text references public.channels(id),
  mapping jsonb not null default '{}'::jsonb,
  rows_total int not null default 0,
  rows_ok int not null default 0,
  rows_dup int not null default 0,
  rows_err int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  status text not null default '완료' check (status in ('완료','취소')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create table if not exists public.metrics (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete set null,
  link_id uuid references public.links(id) on delete set null,
  channel_id text references public.channels(id),
  program_id text references public.programs(id),
  period_start date not null,
  period_end date not null,
  views int check (views >= 0),
  impressions int check (impressions >= 0),
  clicks int check (clicks >= 0),
  orders int check (orders >= 0),
  cancels int check (cancels >= 0),
  revenue_est numeric,
  revenue_confirmed numeric,
  revenue_paid numeric,
  cost numeric check (cost >= 0),
  source text not null check (source in ('manual','csv','api')),
  source_label text not null default '',
  import_id uuid references public.imports(id) on delete cascade,
  row_key text,
  note text not null default '',
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index if not exists metrics_row_key_uq on public.metrics (row_key) where row_key is not null;
create index if not exists metrics_post_idx on public.metrics (post_id);
create index if not exists metrics_period_idx on public.metrics (period_start, period_end);

alter table public.requests
  add column if not exists kind text not null default 'write',
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists attempts int not null default 0,
  add column if not exists started_at timestamptz;
alter table public.requests add constraint requests_kind_check check (kind in ('write','topics','reformat'));

alter table public.runs
  add column if not exists status text not null default '성공',
  add column if not exists jobs_done int not null default 0,
  add column if not exists jobs_failed int not null default 0,
  add column if not exists error text not null default '';
alter table public.runs add constraint runs_status_check check (status in ('성공','일부 실패','실패'));

alter table public.settings
  add column if not exists default_channel text references public.channels(id),
  add column if not exists default_programs text[] not null default '{}',
  add column if not exists score_weights jsonb not null default
    '{"demand":2,"intent":2,"competition":1,"product_info":1,"differentiation":1,"monetization":2,"effort":1}'::jsonb;

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  label text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.auth_failures (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  at timestamptz not null default now()
);
create index if not exists auth_failures_at_idx on public.auth_failures (at);

update public.posts set channel_id = case platform
    when '티스토리' then 'tistory'
    when '워드프레스 / 구글 블로그' then 'website'
    else 'naver_blog' end
  where channel_id is null;

update public.posts set program_ids = case money
    when '쿠팡파트너스' then array['coupang_partners']
    when '토스 쇼핑 제휴' then array['toss_sharelink']
    when '애드센스(정보성 글)' then array['google_adsense']
    else '{}'::text[] end
  where program_ids = '{}';

update public.posts set content_type = case style
    when 'TOP N 비교 추천형' then 'comparison'
    when '구매 가이드(고르는 법)형' then 'buying_guide'
    when '문제 해결 정보형' then 'problem_solving'
    when '단일 상품 솔직 리뷰형' then 'experience_review'
    else '' end
  where content_type = '';

update public.posts set stage = case status when 'published' then 'published' else 'review' end where status in ('planned','published');

insert into public.links (post_id, url, program_id, channel_id)
  select id, link, program_ids[1], channel_id from public.posts where link ~* '^https?://[^\s"''<>]+$';

update public.settings set
  default_channel = coalesce(default_channel, case platform when '티스토리' then 'tistory' when '워드프레스 / 구글 블로그' then 'website' else 'naver_blog' end),
  default_programs = case when default_programs = '{}' then case money
      when '토스 쇼핑 제휴' then array['toss_sharelink']
      when '애드센스(정보성 글)' then array['google_adsense']
      else array['coupang_partners'] end
    else default_programs end
  where id = 1;

alter table public.channels enable row level security;
alter table public.programs enable row level security;
alter table public.program_channels enable row level security;
alter table public.topics enable row level security;
alter table public.products enable row level security;
alter table public.post_products enable row level security;
alter table public.links enable row level security;
alter table public.imports enable row level security;
alter table public.metrics enable row level security;
alter table public.app_sessions enable row level security;
alter table public.auth_failures enable row level security;
revoke all on public.channels, public.programs, public.program_channels, public.topics, public.products,
  public.post_products, public.links, public.imports, public.metrics, public.app_sessions, public.auth_failures
  from anon, authenticated;
