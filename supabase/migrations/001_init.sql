create table public.posts (
  id uuid primary key default gen_random_uuid(),
  keyword text not null default '',
  money text not null default '쿠팡파트너스',
  platform text not null default '네이버 블로그',
  style text not null default '',
  len text not null default '2500',
  titles jsonb not null default '[]'::jsonb,
  body text not null default '',
  hashtags jsonb not null default '[]'::jsonb,
  threads text not null default '',
  instagram text not null default '',
  link text not null default '',
  blog_url text not null default '',
  publish_date date,
  status text not null default 'planned' check (status in ('planned', 'published')),
  published_at timestamptz,
  source text not null default 'auto',
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index posts_publish_date_idx on public.posts (publish_date);
create index posts_created_at_idx on public.posts (created_at desc);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  style text not null default '',
  money text not null default '쿠팡파트너스',
  platform text not null default '네이버 블로그',
  len text not null default '2500',
  link text not null default '',
  exp text not null default '',
  ref text not null default '',
  status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'cancelled')),
  post_id uuid references public.posts (id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index requests_status_idx on public.requests (status, created_at);

create table public.settings (
  id int primary key default 1 check (id = 1),
  per_day int not null default 1 check (per_day between 1 and 3),
  auto_topics text not null default '',
  auto_enabled boolean not null default true,
  money text not null default '쿠팡파트너스',
  platform text not null default '네이버 블로그',
  len text not null default '2500',
  updated_at timestamptz not null default now()
);
insert into public.settings (id, auto_topics) values (1, '계절템·겨울 가전, 디지털·전자기기');

create table public.app_access (
  id int primary key default 1 check (id = 1),
  token_hash text not null,
  created_at timestamptz not null default now()
);

create table public.runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  kind text not null default '',
  written int not null default 0,
  note text not null default ''
);

alter table public.posts enable row level security;
alter table public.requests enable row level security;
alter table public.settings enable row level security;
alter table public.app_access enable row level security;
alter table public.runs enable row level security;

revoke all on public.posts, public.requests, public.settings, public.app_access, public.runs from anon, authenticated;

create or replace function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;
create trigger posts_touch before update on public.posts for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();
