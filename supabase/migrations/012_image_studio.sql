-- 012: 이미지 스튜디오 (1.2.0)
-- 표를 지우거나 다시 만들지 않음. 새 표·열·함수만 더함. 기존 원고·실적 데이터는 건드리지 않음.
--  1. post_images       — 이미지 보관함 (파일은 Storage 'post-images' 비공개 버킷, 여기는 정보만)
--  2. post_image_slots  — 원고의 사진 자리 ↔ 이미지 연결 (같은 이미지를 여러 자리·여러 원고에 써도 됨)
--  3. image_generations — AI 생성 요청 한 번 = 한 줄 (프롬프트·결과·오류·예상/사용량/실제 비용·환율)
--  4. post_card_decks   — 카드뉴스 문구·템플릿 (원고마다 하나)
--  5. api_calls         — 외부 API 호출 기록 (Pexels 시간당 한도 보호)
--  6. settings          — 이미지 모델·품질·하루 한도·한 달 예산·환율·가격
--  7. 함수: 생성 시작(중복·동시·한도·예산 검사) / 저장 / 실패 / 자리 연결·바꾸기·옮기기 / 카드뉴스 저장 / 안전 삭제 / 이미지 비용 통계 / 사용량

-- 1 ───────── 이미지 보관함
create table if not exists public.post_images (
  id uuid primary key default gen_random_uuid(),
  origin_post_id uuid references public.posts(id) on delete set null,   -- 처음 만든 원고 (다른 원고에서도 쓸 수 있음)
  origin_slot_index int,
  origin_slot_key text not null default '',  -- 처음 만든 사진 자리 (그 자리의 '만든 이미지 후보'로 보여줌)
  kind text not null check (kind in ('ai','stock','upload','card')),
  provider text not null default '' check (provider in ('','openai','cloudflare','pexels','upload','cardnews')),
  model text not null default '',
  prompt text not null default '',          -- AI에 실제로 보낸 프롬프트
  user_prompt text not null default '',     -- 사용자가 고친 설명·추가 요청
  style text not null default '',
  purpose text not null default '',
  ratio text not null default '',           -- AI로 만들 때 고른 비율 (정해진 크기로만 만드는 모델은 내려받을 때 이 비율로 자름)
  description text not null default '',
  alt_text text not null default '',
  storage_path text not null default '',
  mime text not null default '' check (mime in ('', 'image/jpeg', 'image/png', 'image/webp')),
  bytes int check (bytes is null or bytes >= 0),
  width int check (width is null or width >= 0),
  height int check (height is null or height >= 0),
  sha256 text not null default '',
  source_url text not null default '',      -- 원본 출처 (Pexels 사진 페이지)
  source_id text not null default '',
  author_name text not null default '',
  author_url text not null default '',
  license text not null default '',
  attribution_text text not null default '',
  rights_confirmed boolean not null default false,  -- 직접 올린 사진: 쓸 권한이 있다고 확인했는지
  review_status text not null default '검수 전' check (review_status in ('검수 전','사용 가능','사용 안 함')),
  review_note text not null default '',
  generation_id uuid,                       -- image_generations.id (서로 참조하지 않게 외래 키는 안 걺)
  downloaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists post_images_origin_idx on public.post_images (origin_post_id, created_at desc);
create index if not exists post_images_created_idx on public.post_images (created_at desc);
create index if not exists post_images_sha_idx on public.post_images (sha256) where sha256 <> '';
create index if not exists post_images_source_idx on public.post_images (provider, source_id) where source_id <> '';
create or replace trigger post_images_touch before update on public.post_images for each row execute function public.touch_updated_at();

-- 2 ───────── 사진 자리 연결
-- slot_key: 본문 자리 = 'k:' + 설명(정리한 글자) + '#몇 번째', 본문 밖 자리 = 'x:cover' 같은 고정 이름
create table if not exists public.post_image_slots (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  slot_key text not null check (slot_key ~ '^(k|x):' and length(slot_key) <= 220),
  slot_index int not null default 0,
  slot_text text not null default '',
  slot_ctx text not null default '',         -- 자리 주변 글(소제목·앞뒤 문장): 같은 설명이 여러 번 있거나 설명을 고쳐도 같은 자리를 알아보려고
  image_id uuid references public.post_images(id) on delete set null,
  purpose text not null default 'blog_body',
  crop jsonb,                                -- {"ratio":"4:3","x":0.5,"y":0.5} 중심점 (0~1)
  downloaded_at timestamptz,
  used_at timestamptz,                       -- '사용 완료' 표시
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, slot_key)
);
create index if not exists post_image_slots_image_idx on public.post_image_slots (image_id);
create or replace trigger post_image_slots_touch before update on public.post_image_slots for each row execute function public.touch_updated_at();

-- 3 ───────── AI 생성 기록 (비용 포함)
create table if not exists public.image_generations (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique check (length(request_key) between 8 and 80),  -- 같은 버튼을 두 번 눌러도 한 번만
  post_id uuid references public.posts(id) on delete set null,
  slot_key text not null default '',
  slot_index int,
  slot_text text not null default '',
  mode text not null default 'generate' check (mode in ('generate','edit')),
  provider text not null default 'openai',
  model text not null,
  size text not null default '',
  quality text not null default '',
  output_format text not null default 'jpeg',
  purpose text not null default '',
  style text not null default '',
  user_prompt text not null default '',
  prompt text not null default '',
  base_image_id uuid references public.post_images(id) on delete set null,
  status text not null default '생성 중' check (status in ('생성 중','성공','실패')),
  -- OpenAI가 실제로 만들기를 시도했는지 (하루 한도는 이걸로 셈). 키·모델·잔액 오류처럼 만들기 전에 거절되면 false
  provider_called boolean not null default true,
  provider_request_id text not null default '',      -- OpenAI 요청 번호 (문의할 때 씀)
  risk_override text not null default '',            -- '실제 사진이 필요해 보이는 자리'인데 사용자가 일반 장면으로 만들겠다고 확인한 경우 그 말
  error_code text not null default '',
  error_message text not null default '',
  est_usd numeric not null default 0 check (est_usd >= 0),     -- 요청 전 예상 (공식 가격·계산기 기준)
  usage jsonb,                                                 -- OpenAI가 알려준 사용량
  usage_usd numeric check (usage_usd >= 0),                    -- 사용량 × 가격 (이것도 계산값, 청구액 아님)
  actual_usd numeric check (actual_usd >= 0),                  -- 사용자가 OpenAI 사용량 화면에서 확인해 넣은 실제 청구액
  actual_checked_at date,
  cost_status text not null default '예상' check (cost_status in ('예상','사용량 기준','청구액 확인','청구 없음','확인 필요')),
  -- 서버가 처음 매긴 비용 상태 (사용자가 넣은 청구액을 지우면 이걸로 되돌림). 값 검사는 아래 '보강'에서
  auto_cost_status text not null default '예상',
  fx_krw numeric check (fx_krw is null or fx_krw > 0),         -- 이 기록에 쓴 환율 (원/달러)
  fx_date date,
  fx_source text not null default '',
  image_id uuid references public.post_images(id) on delete set null,
  revised_prompt text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists image_generations_created_idx on public.image_generations (created_at desc);
create index if not exists image_generations_post_idx on public.image_generations (post_id, created_at desc);
-- 한 번에 하나만 생성 (DB가 막음)
create unique index if not exists image_generations_one_running on public.image_generations ((true)) where status = '생성 중';

-- 4 ───────── 카드뉴스
create table if not exists public.post_card_decks (
  post_id uuid primary key references public.posts(id) on delete cascade,
  template text not null default 'clean' check (template in ('clean','mark','dark')),
  ratio text not null default '4:5' check (ratio in ('4:5','1:1')),
  slides jsonb not null default '[]'::jsonb check (jsonb_typeof(slides) = 'array'),
  ad_label boolean not null default true,      -- 첫 장 광고 표시
  bg_image_id uuid references public.post_images(id) on delete set null,
  updated_at timestamptz not null default now()
);
create or replace trigger post_card_decks_touch before update on public.post_card_decks for each row execute function public.touch_updated_at();

-- 5 ───────── 외부 API 호출 기록
create table if not exists public.api_calls (
  id bigint generated always as identity primary key,
  provider text not null,
  kind text not null default '',
  status int,
  at timestamptz not null default now()
);
create index if not exists api_calls_at_idx on public.api_calls (provider, at);

-- 보강: 이 파일의 예전 초안을 먼저 돌린 DB에서도 같은 결과가 되게 (create table if not exists 는 이미 있는 표에 새 열을 더하지 않음)
alter table public.post_images add column if not exists ratio text not null default '';
alter table public.post_image_slots add column if not exists slot_ctx text not null default '';
alter table public.image_generations add column if not exists risk_override text not null default '';
alter table public.image_generations add column if not exists auto_cost_status text not null default '예상';
-- (예전 초안으로 이미 있던 생성 기록: 서버가 매긴 비용 상태를 처음 상태로 맞춤. 사용자가 넣은 값(확인일 있음)은 건드리지 않음. 새 DB에는 해당 줄이 없음)
update public.image_generations set auto_cost_status = cost_status
  where auto_cost_status = '예상' and cost_status in ('사용량 기준', '청구 없음', '확인 필요') and actual_checked_at is null;
do $$ begin
  -- 무료 이미지(Cloudflare Workers AI) 공급자를 더함 — 예전 초안의 검사에 없으면 같은 이름으로 다시 걺 (데이터는 그대로)
  if exists (select 1 from pg_constraint where conname = 'post_images_provider_check'
             and pg_get_constraintdef(oid) not like '%cloudflare%') then
    alter table public.post_images drop constraint post_images_provider_check;
    alter table public.post_images add constraint post_images_provider_check
      check (provider in ('','openai','cloudflare','pexels','upload','cardnews'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'post_images_ratio_check') then
    alter table public.post_images add constraint post_images_ratio_check check (ratio in ('', '16:9', '4:3', '1:1', '4:5', '9:16'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'image_generations_auto_cost_status_check') then
    alter table public.image_generations add constraint image_generations_auto_cost_status_check
      check (auto_cost_status in ('예상','사용량 기준','청구 없음','확인 필요'));
  end if;
end $$;

-- 6 ───────── 설정
-- 가격은 OpenAI 공식 가격표(2026-10-22 확인)로 시작하고, 바뀌면 설정에서 고침. 환율은 비워둠 (사용자가 기준과 날짜를 넣음)
alter table public.settings
  add column if not exists image_gen_model text not null default 'cf-flux-1-schnell',
  add column if not exists image_edit_model text not null default 'gpt-image-2.5-sunburst',
  add column if not exists image_quality text not null default 'medium',
  add column if not exists image_daily_limit int not null default 5,
  add column if not exists image_monthly_budget_usd numeric not null default 2,
  add column if not exists image_fx_krw numeric,
  add column if not exists image_fx_date date,
  add column if not exists image_fx_source text not null default '',
  add column if not exists image_prices jsonb not null default
    '{"image_output_per_m":30,"image_input_per_m":8,"text_input_per_m":5,"checked_at":"2026-10-22","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb;
-- 기본 생성 모델은 무료 모델 (예전 초안을 돌린 DB에도 같은 기본값 — 이미 저장된 설정 값은 건드리지 않음)
alter table public.settings alter column image_gen_model set default 'cf-flux-1-schnell';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_image_checks') then
    alter table public.settings add constraint settings_image_checks check (
      image_quality in ('low','medium','high','xhigh','max')
      and image_daily_limit between 0 and 50
      and image_monthly_budget_usd between 0 and 500
      and (image_fx_krw is null or image_fx_krw between 100 and 10000)
      and image_gen_model ~ '^[a-z0-9][a-z0-9._-]{1,60}$'
      and image_edit_model ~ '^[a-z0-9][a-z0-9._-]{1,60}$'
      and jsonb_typeof(image_prices) = 'object');
  end if;
end $$;

-- 7 ───────── 함수
-- 생성 시작: 같은 요청이면 그대로 돌려주고, 이미 만드는 중이면·하루 한도·한 달 예산을 넘으면 거절. 통과하면 '생성 중' 한 줄
create or replace function public.image_gen_begin(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  s public.settings;
  g public.image_generations;
  day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  est numeric := coalesce(nullif(p->>'est_usd', '')::numeric, 0);
  used_today int;
  spent numeric;
begin
  if coalesce(p->>'request_key', '') = '' then raise exception 'request_key is required'; end if;
  if coalesce(p->>'model', '') = '' then raise exception 'model is required'; end if;
  -- 예상 비용이 없으면 예산 검사를 건너뛰게 되므로 거절 (0은 점검용 가짜 모델만)
  if nullif(p->>'est_usd', '') is null or est < 0 then raise exception 'est_usd is required'; end if;
  perform pg_advisory_xact_lock(hashtext('gf_image_gen'));
  select * into g from public.image_generations where request_key = p->>'request_key';
  if g.id is not null then return to_jsonb(g) || jsonb_build_object('duplicate', true); end if;
  -- 4분 넘게 끝나지 않은 생성은 실패로 정리 (서버가 중간에 멈춘 경우 — 청구됐을 수 있어 확인 필요)
  update public.image_generations set status = '실패', error_code = 'timeout',
      error_message = '응답이 끝나지 않아 멈췄어. 청구됐을 수 있으니 OpenAI 사용량에서 확인해줘.',
      cost_status = '확인 필요', auto_cost_status = '확인 필요', finished_at = now()
    where status = '생성 중' and started_at < now() - interval '4 minutes';
  if exists (select 1 from public.image_generations where status = '생성 중') then raise exception 'image_busy'; end if;
  select * into s from public.settings where id = 1;
  select count(*) into used_today from public.image_generations where provider_called and created_at >= day_start;
  if used_today >= coalesce(s.image_daily_limit, 0) then raise exception 'image_daily_limit'; end if;
  select coalesce(sum(case when cost_status = '청구 없음' then 0 else coalesce(actual_usd, usage_usd, est_usd) end), 0) into spent
    from public.image_generations where created_at >= month_start;
  if spent + est > coalesce(s.image_monthly_budget_usd, 0) then raise exception 'image_budget'; end if;
  insert into public.image_generations (request_key, post_id, slot_key, slot_index, slot_text, mode, provider, model, size, quality,
      output_format, purpose, style, user_prompt, prompt, base_image_id, est_usd, fx_krw, fx_date, fx_source, risk_override)
    values (p->>'request_key', nullif(p->>'post_id', '')::uuid, coalesce(p->>'slot_key', ''), nullif(p->>'slot_index', '')::int,
      left(coalesce(p->>'slot_text', ''), 500), coalesce(nullif(p->>'mode', ''), 'generate'),
      case when p->>'provider' = 'cloudflare' then 'cloudflare' else 'openai' end, p->>'model',
      coalesce(p->>'size', ''), coalesce(p->>'quality', ''), coalesce(nullif(p->>'output_format', ''), 'jpeg'),
      coalesce(p->>'purpose', ''), coalesce(p->>'style', ''), left(coalesce(p->>'user_prompt', ''), 2000), left(coalesce(p->>'prompt', ''), 32000),
      nullif(p->>'base_image_id', '')::uuid, est, s.image_fx_krw, s.image_fx_date, coalesce(s.image_fx_source, ''), left(coalesce(p->>'risk_override', ''), 200))
    returning * into g;
  return to_jsonb(g) || jsonb_build_object('duplicate', false, 'used_today', used_today + 1, 'spent_usd', spent);
end $$;

-- 이미지 저장: 보관함에 한 줄 + (원하면) 사진 자리에 연결 + (AI면) 생성 기록을 '성공'으로 — 한 번에 (중간에 실패하면 전부 취소)
create or replace function public.image_save(img jsonb, link jsonb default null, gen uuid default null, fin jsonb default null) returns jsonb
language plpgsql set search_path = '' as $$
declare
  i public.post_images;
  sl jsonb;
  g public.image_generations;
begin
  if gen is not null then
    select * into g from public.image_generations where id = gen for update;
    if g.id is null or g.status <> '생성 중' then raise exception 'generation is not running'; end if;
  end if;
  insert into public.post_images (origin_post_id, origin_slot_index, origin_slot_key, kind, provider, model, prompt, user_prompt, style, purpose, ratio, description, alt_text,
      storage_path, mime, bytes, width, height, sha256, source_url, source_id, author_name, author_url, license, attribution_text, rights_confirmed, generation_id)
    values (nullif(img->>'origin_post_id', '')::uuid, nullif(img->>'origin_slot_index', '')::int, left(coalesce(img->>'origin_slot_key', ''), 220),
      img->>'kind', coalesce(img->>'provider', ''),
      coalesce(img->>'model', ''), left(coalesce(img->>'prompt', ''), 32000), left(coalesce(img->>'user_prompt', ''), 2000), coalesce(img->>'style', ''),
      coalesce(img->>'purpose', ''), case when img->>'ratio' in ('16:9', '4:3', '1:1', '4:5', '9:16') then img->>'ratio' else '' end,
      left(coalesce(img->>'description', ''), 500), left(coalesce(img->>'alt_text', ''), 300),
      coalesce(img->>'storage_path', ''), coalesce(img->>'mime', ''), nullif(img->>'bytes', '')::int, nullif(img->>'width', '')::int, nullif(img->>'height', '')::int,
      coalesce(img->>'sha256', ''), left(coalesce(img->>'source_url', ''), 2000), left(coalesce(img->>'source_id', ''), 60),
      left(coalesce(img->>'author_name', ''), 200), left(coalesce(img->>'author_url', ''), 2000), left(coalesce(img->>'license', ''), 200),
      left(coalesce(img->>'attribution_text', ''), 300), coalesce((img->>'rights_confirmed')::boolean, false), gen)
    returning * into i;
  if link is not null and coalesce(link->>'post_id', '') <> '' then
    sl := public.image_slot_upsert((link->>'post_id')::uuid, link || jsonb_build_object('image_id', i.id));
  end if;
  if gen is not null then
    update public.image_generations set status = '성공', image_id = i.id, finished_at = now(),
        usage = fin->'usage', usage_usd = nullif(fin->>'usage_usd', '')::numeric,
        -- 점검용 가짜 모델처럼 서버가 '청구 없음'·'OpenAI 안 부름'을 알려주면 그대로
        provider_called = coalesce((fin->>'provider_called')::boolean, provider_called),
        cost_status = case when fin->>'cost_status' in ('예상','사용량 기준','청구 없음','확인 필요') then fin->>'cost_status'
                           when nullif(fin->>'usage_usd', '') is not null then '사용량 기준' else '예상' end,
        auto_cost_status = case when fin->>'cost_status' in ('예상','사용량 기준','청구 없음','확인 필요') then fin->>'cost_status'
                           when nullif(fin->>'usage_usd', '') is not null then '사용량 기준' else '예상' end,
        revised_prompt = left(coalesce(fin->>'revised_prompt', ''), 4000),
        provider_request_id = left(coalesce(fin->>'request_id', ''), 120)
      where id = gen returning * into g;
  end if;
  return jsonb_build_object('image', to_jsonb(i), 'slot', sl,
                            'generation', case when g.id is null then null else to_jsonb(g) end);
end $$;

-- 생성 실패 기록 (OpenAI까지 갔는지, 청구 여부 추정)
create or replace function public.image_gen_fail(gen uuid, fin jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare g public.image_generations;
begin
  update public.image_generations set status = '실패', finished_at = now(),
      provider_called = coalesce((fin->>'provider_called')::boolean, provider_called),
      error_code = left(coalesce(fin->>'error_code', 'error'), 60),
      error_message = left(coalesce(fin->>'error_message', ''), 500),
      usage = coalesce(fin->'usage', usage), usage_usd = coalesce(nullif(fin->>'usage_usd', '')::numeric, usage_usd),
      cost_status = case when fin->>'cost_status' in ('예상','사용량 기준','청구 없음','확인 필요') then fin->>'cost_status' else '확인 필요' end,
      auto_cost_status = case when fin->>'cost_status' in ('예상','사용량 기준','청구 없음','확인 필요') then fin->>'cost_status' else '확인 필요' end,
      provider_request_id = left(coalesce(nullif(fin->>'request_id', ''), provider_request_id), 120)
    where id = gen and status = '생성 중' returning * into g;
  if g.id is null then raise exception 'generation is not running'; end if;
  return to_jsonb(g);
end $$;

-- 사진 자리에 이미지 연결·빼기 (image_id = null 이면 빼기). 다른 이미지로 바뀌면 자르기·내려받음·사용 완료 표시는 초기화
create or replace function public.image_slot_upsert(p_post uuid, p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  sl public.post_image_slots;
  img uuid := nullif(p->>'image_id', '')::uuid;
begin
  if not exists (select 1 from public.posts where id = p_post) then raise exception 'post not found'; end if;
  if img is not null then
    -- 같은 때 그 이미지를 지우는 요청이 있으면 끝날 때까지 기다렸다가 다시 확인 (지운 이미지에 연결되지 않게)
    perform 1 from public.post_images where id = img and deleted_at is null for share;
    if not found then raise exception 'image not found'; end if;
  end if;
  insert into public.post_image_slots (post_id, slot_key, slot_index, slot_text, slot_ctx, image_id, purpose)
    values (p_post, p->>'slot_key', coalesce(nullif(p->>'slot_index', '')::int, 0), left(coalesce(p->>'slot_text', ''), 500),
            left(coalesce(p->>'slot_ctx', ''), 300), img, coalesce(nullif(p->>'purpose', ''), 'blog_body'))
    on conflict (post_id, slot_key) do update set
      image_id = excluded.image_id,
      slot_index = excluded.slot_index,
      slot_text = excluded.slot_text,
      slot_ctx = coalesce(nullif(p->>'slot_ctx', ''), public.post_image_slots.slot_ctx),
      purpose = coalesce(nullif(p->>'purpose', ''), public.post_image_slots.purpose),
      crop = case when public.post_image_slots.image_id is distinct from excluded.image_id then null else public.post_image_slots.crop end,
      downloaded_at = case when public.post_image_slots.image_id is distinct from excluded.image_id then null else public.post_image_slots.downloaded_at end,
      used_at = case when public.post_image_slots.image_id is distinct from excluded.image_id then null else public.post_image_slots.used_at end
    returning * into sl;
  return to_jsonb(sl);
end $$;

-- 두 자리의 이미지를 맞바꿈 (순서 바꾸기)
create or replace function public.image_slot_swap(p_post uuid, a jsonb, b jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  ra public.post_image_slots;
  rb public.post_image_slots;
begin
  if a->>'slot_key' = b->>'slot_key' then raise exception 'same slot'; end if;
  perform public.image_slot_upsert(p_post, a || jsonb_build_object('image_id', (select image_id from public.post_image_slots where post_id = p_post and slot_key = a->>'slot_key')));
  perform public.image_slot_upsert(p_post, b || jsonb_build_object('image_id', (select image_id from public.post_image_slots where post_id = p_post and slot_key = b->>'slot_key')));
  select * into ra from public.post_image_slots where post_id = p_post and slot_key = a->>'slot_key' for update;
  select * into rb from public.post_image_slots where post_id = p_post and slot_key = b->>'slot_key' for update;
  update public.post_image_slots set image_id = rb.image_id, crop = rb.crop, downloaded_at = null, used_at = null where id = ra.id;
  update public.post_image_slots set image_id = ra.image_id, crop = ra.crop, downloaded_at = null, used_at = null where id = rb.id;
  return jsonb_build_object('a', (select to_jsonb(x) from public.post_image_slots x where x.id = ra.id), 'b', (select to_jsonb(x) from public.post_image_slots x where x.id = rb.id));
end $$;

-- 본문에서 설명이 바뀐 자리의 연결을 새 자리로 옮김 (새 자리에 이미 이미지가 있으면 거절)
create or replace function public.image_slot_rekey(p_post uuid, p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  src public.post_image_slots;
  dst public.post_image_slots;
begin
  select * into src from public.post_image_slots where post_id = p_post and slot_key = p->>'from' for update;
  if src.id is null then raise exception 'slot not found'; end if;
  if p->>'from' = p->>'to' then return to_jsonb(src); end if;
  select * into dst from public.post_image_slots where post_id = p_post and slot_key = p->>'to' for update;
  if dst.id is not null then
    if dst.image_id is not null then raise exception 'slot taken'; end if;
    delete from public.post_image_slots where id = dst.id;   -- 비어 있던 줄만 지움
  end if;
  update public.post_image_slots set slot_key = p->>'to', slot_index = coalesce(nullif(p->>'index', '')::int, slot_index),
      slot_text = left(coalesce(p->>'text', slot_text), 500), slot_ctx = left(coalesce(p->>'ctx', slot_ctx), 300)
    where id = src.id returning * into src;
  -- 그 자리용으로 만든 이미지 후보도 같이 옮김
  update public.post_images set origin_slot_key = p->>'to' where origin_post_id = p_post and origin_slot_key = p->>'from';
  return to_jsonb(src);
end $$;

-- 카드뉴스 저장 (원고마다 하나). 배경 이미지를 지우는 요청과 겹치면 끝날 때까지 기다렸다가 다시 확인 — 지운 이미지를 배경으로 저장하지 않게
-- (image_delete 가 같은 이미지 줄을 잠그고 카드뉴스에서 쓰는지 세므로, 둘 중 하나만 이김)
create or replace function public.card_deck_save(p_post uuid, p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  d public.post_card_decks;
  bg uuid := nullif(p->>'bg_image_id', '')::uuid;
begin
  if not exists (select 1 from public.posts where id = p_post) then raise exception 'post not found'; end if;
  if bg is not null then
    perform 1 from public.post_images where id = bg and deleted_at is null for share;
    if not found then raise exception 'image not found'; end if;
  end if;
  insert into public.post_card_decks (post_id, template, ratio, slides, ad_label, bg_image_id)
    values (p_post, coalesce(nullif(p->>'template', ''), 'clean'), coalesce(nullif(p->>'ratio', ''), '4:5'),
            coalesce(p->'slides', '[]'::jsonb), coalesce((p->>'ad_label')::boolean, true), bg)
    on conflict (post_id) do update set template = excluded.template, ratio = excluded.ratio, slides = excluded.slides,
      ad_label = excluded.ad_label, bg_image_id = excluded.bg_image_id
    returning * into d;
  return to_jsonb(d);
end $$;

-- 이미지 지우기: 어느 원고(휴지통 포함)나 카드뉴스에서라도 쓰고 있으면 거절. 지우면 파일 경로를 돌려줘서 서버가 파일도 지움
create or replace function public.image_delete(p_image uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  i public.post_images;
  uses int;
begin
  select * into i from public.post_images where id = p_image and deleted_at is null for update;
  if i.id is null then raise exception 'image not found'; end if;
  select (select count(*) from public.post_image_slots where image_id = p_image)
       + (select count(*) from public.post_card_decks where bg_image_id = p_image) into uses;
  if uses > 0 then raise exception 'image in use: %', uses; end if;
  update public.post_images set deleted_at = now() where id = p_image;
  return jsonb_build_object('storage_path', i.storage_path);
end $$;

-- 이미지 생성 비용 통계 (수익 통계와 따로 셈 → 실적의 '비용'과 두 번 더해지지 않음)
-- usd: 실제 청구액 > 사용량 기준 > 예상 순으로. krw: 그 기록의 환율, 없으면 지금 설정 환율. 하나라도 환율이 없으면 원화 합계는 비움
-- p_post 를 주면 그 원고만
create or replace function public.image_costs(d_from date default null, d_to date default null, p_post uuid default null) returns jsonb
language sql stable set search_path = '' as $$
with s as (select image_fx_krw from public.settings where id = 1),
g as (
  select g.*,
    case when g.cost_status = '청구 없음' then 0 else coalesce(g.actual_usd, g.usage_usd, g.est_usd) end as usd,
    coalesce(g.fx_krw, (select image_fx_krw from s)) as fx
  from public.image_generations g
  where (d_from is null or (g.created_at at time zone 'Asia/Seoul')::date >= d_from)
    and (d_to is null or (g.created_at at time zone 'Asia/Seoul')::date <= d_to)
    and (p_post is null or g.post_id = p_post)
)
select jsonb_build_object(
  'from', d_from, 'to', d_to,
  'totals', (select jsonb_build_object(
      'count', count(*), 'billed', count(*) filter (where cost_status <> '청구 없음'),
      'success', count(*) filter (where status = '성공'), 'failed', count(*) filter (where status = '실패'),
      'usd', coalesce(sum(usd), 0), 'usd_actual', sum(actual_usd), 'n_actual', count(actual_usd),
      'n_usage', count(*) filter (where actual_usd is null and usage_usd is not null),
      'uncertain', count(*) filter (where cost_status = '확인 필요'),
      'fx_missing', count(*) filter (where fx is null and usd > 0),
      'krw', case when count(*) filter (where fx is null and usd > 0) = 0 then coalesce(sum(usd * coalesce(fx, 0)), 0) end)
    from g),
  'by_post', coalesce((select jsonb_agg(x) from (
      select post_id as key, count(*) as count, count(*) filter (where cost_status <> '청구 없음') as billed,
        coalesce(sum(usd), 0) as usd,
        case when count(*) filter (where fx is null and usd > 0) = 0 then coalesce(sum(usd * coalesce(fx, 0)), 0) end as krw,
        count(*) filter (where cost_status = '확인 필요') as uncertain
      from g group by post_id) x), '[]'::jsonb)
);
$$;

-- 지금 사용량: 오늘 생성 횟수·이번 달 비용(예산과 같은 셈법)·만드는 중인 것·저장 공간·Pexels 호출 수
create or replace function public.image_usage() returns jsonb
language sql stable set search_path = '' as $$
with s as (select * from public.settings where id = 1),
b as (select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as day_start,
             date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as month_start)
select jsonb_build_object(
  'today', (select count(*) from public.image_generations g, b where g.provider_called and g.created_at >= b.day_start),
  'daily_limit', (select image_daily_limit from s),
  'month_usd', (select coalesce(sum(case when g.cost_status = '청구 없음' then 0 else coalesce(g.actual_usd, g.usage_usd, g.est_usd) end), 0)
                  from public.image_generations g, b where g.created_at >= b.month_start),
  'budget_usd', (select image_monthly_budget_usd from s),
  'running', (select to_jsonb(x) from (select id, post_id, slot_key, started_at from public.image_generations
                where status = '생성 중' and started_at > now() - interval '4 minutes' limit 1) x),
  'storage_bytes', (select coalesce(sum(bytes), 0) from public.post_images where deleted_at is null),
  'image_count', (select count(*) from public.post_images where deleted_at is null),
  'pexels_hour', (select count(*) from public.api_calls where provider = 'pexels' and at > now() - interval '1 hour'),
  'pexels_month', (select count(*) from public.api_calls a, b where a.provider = 'pexels' and a.at >= b.month_start)
);
$$;

-- 8 ───────── 잠금: 표는 서버 함수(서버 키)만 읽고 씀
alter table public.post_images enable row level security;
alter table public.post_image_slots enable row level security;
alter table public.image_generations enable row level security;
alter table public.post_card_decks enable row level security;
alter table public.api_calls enable row level security;
revoke all on public.post_images, public.post_image_slots, public.image_generations, public.post_card_decks, public.api_calls from anon, authenticated;
revoke execute on function
  public.image_gen_begin(jsonb), public.image_save(jsonb, jsonb, uuid, jsonb), public.image_gen_fail(uuid, jsonb),
  public.image_slot_upsert(uuid, jsonb), public.image_slot_swap(uuid, jsonb, jsonb), public.image_slot_rekey(uuid, jsonb),
  public.card_deck_save(uuid, jsonb), public.image_delete(uuid), public.image_costs(date, date, uuid), public.image_usage()
  from public, anon, authenticated;
grant execute on function
  public.image_gen_begin(jsonb), public.image_save(jsonb, jsonb, uuid, jsonb), public.image_gen_fail(uuid, jsonb),
  public.image_slot_upsert(uuid, jsonb), public.image_slot_swap(uuid, jsonb, jsonb), public.image_slot_rekey(uuid, jsonb),
  public.card_deck_save(uuid, jsonb), public.image_delete(uuid), public.image_costs(date, date, uuid), public.image_usage()
  to service_role;

-- 9 ───────── 비공개 버킷 (Supabase에만 있음. 테스트용 Postgres에는 storage 스키마가 없어서 건너뜀)
-- 공개 아님(public=false) + storage.objects 에 정책을 만들지 않음 → 서버 키로만 올리고, 보기는 서버가 만든 짧은 서명 주소로만
-- 같은 이름의 버킷이 이미 있으면 비공개·크기·형식 제한을 다시 걸어둠 (공개로 남지 않게)
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('post-images', 'post-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
