-- 018: 상품 사진으로 장면 만들기 (1.5.1)
-- 표·데이터를 지우거나 다시 만들지 않음. 표·열·함수만 더하고, 검사 규칙은 넓히기만 함 (기존 값은 그대로). 다시 돌려도 같은 결과.
--  1. product_masks — 상품 사진에서 '남길 영역'(배경을 지운 마스크, PNG) 기록. 화면이 이 기기 안에서 만들어 올림 —
--                     외부 API를 쓰지 않아서 배경 지우기 비용은 0원으로 따로 남김 (모델별 생성 비용과 섞지 않음)
--  2. post_images   — 종류 'composite'(원본 보존 합성 결과)·공급자 'composite',
--                     composite_mode: 'layer'(원본 보존 합성) · 'reference'(상품 사진을 참고한 AI 실사 장면),
--                     product_image_id(원본 상품 사진) · background_image_id(AI 배경) · mask_id(마스크) · layer(위치·크기·회전·그림자·밝기 설정),
--                     product_check(상품 디테일 검수 — 사용자가 승인해야 '사용 가능'으로 바꿀 수 있음)
--  3. 함수: image_save(새 칸 저장), image_mask_save, image_product_check(검수 저장·승인), image_delete(합성에 쓴 원본·배경은 못 지움,
--           마스크 파일 경로도 돌려줌), image_usage(마스크 용량 포함). 승인 없이 '사용 가능'으로 바꾸면 DB가 막음(트리거)

-- 1 ───────── 상품 마스크 (원본 사진은 그대로 두고 마스크만 따로)
create table if not exists public.product_masks (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null references public.post_images(id) on delete cascade,   -- 원본 상품 사진 (직접 올림·Pexels)
  storage_path text not null default '',
  width int not null check (width between 1 and 4096),
  height int not null check (height between 1 and 4096),
  bytes int check (bytes is null or bytes >= 0),
  -- auto_u2netp: 이 기기에서 U²-Netp(작은 사물 분할 모델)로 · auto_simple: 테두리 색으로 간단히 · alpha: 사진에 원래 있던 투명 부분 그대로
  -- manual: 직접 칠함 (edited = 자동 결과를 손으로 고침)
  method text not null default 'auto_u2netp' check (method in ('auto_u2netp', 'auto_simple', 'alpha', 'manual')),
  edited boolean not null default false,
  params jsonb not null default '{}'::jsonb,       -- 가장자리 부드럽게·안쪽으로 등
  bbox jsonb,                                      -- 남길 영역의 상자 {x,y,w,h} (마스크 크기 기준)
  coverage numeric check (coverage is null or (coverage >= 0 and coverage <= 1)),
  cost_usd numeric not null default 0 check (cost_usd >= 0),   -- 이 기기에서 처리 → 0
  cost_status text not null default '청구 없음' check (cost_status in ('청구 없음', '예상', '사용량 기준', '확인 필요')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists product_masks_image_idx on public.product_masks (image_id, created_at desc);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'product_masks_v151_checks') then
    alter table public.product_masks add constraint product_masks_v151_checks check (
      jsonb_typeof(params) = 'object' and (bbox is null or jsonb_typeof(bbox) = 'object') and length(storage_path) <= 200);
  end if;
end $$;

-- 2 ───────── 이미지 보관함: 합성 기록·상품 검수
alter table public.post_images
  add column if not exists composite_mode text not null default '',
  add column if not exists product_image_id uuid references public.post_images(id) on delete set null,
  add column if not exists background_image_id uuid references public.post_images(id) on delete set null,
  add column if not exists mask_id uuid references public.product_masks(id) on delete set null,
  add column if not exists layer jsonb,
  add column if not exists product_check jsonb;
create index if not exists post_images_product_idx on public.post_images (product_image_id) where product_image_id is not null;
create index if not exists post_images_background_idx on public.post_images (background_image_id) where background_image_id is not null;
do $$ begin
  -- 원본 보존 합성 결과(composite)를 종류·공급자에 더함 — 같은 이름으로 다시 걺 (넓히기만, 데이터는 그대로)
  if exists (select 1 from pg_constraint where conname = 'post_images_kind_check'
             and pg_get_constraintdef(oid) not like '%composite%') then
    alter table public.post_images drop constraint post_images_kind_check;
    alter table public.post_images add constraint post_images_kind_check check (kind in ('ai', 'stock', 'upload', 'card', 'composite'));
  end if;
  if exists (select 1 from pg_constraint where conname = 'post_images_provider_check'
             and pg_get_constraintdef(oid) not like '%composite%') then
    alter table public.post_images drop constraint post_images_provider_check;
    alter table public.post_images add constraint post_images_provider_check
      check (provider in ('', 'openai', 'cloudflare', 'gemini', 'pexels', 'upload', 'cardnews', 'composite'));
  end if;
  -- 두 방식은 섞이지 않음: 원본 보존 합성(layer)은 늘 종류 composite, AI 실사 장면(reference)은 늘 종류 ai
  if not exists (select 1 from pg_constraint where conname = 'post_images_v151_checks') then
    alter table public.post_images add constraint post_images_v151_checks check (
      composite_mode in ('', 'layer', 'reference')
      and (kind <> 'composite' or composite_mode = 'layer') and (composite_mode <> 'layer' or kind = 'composite')
      and (composite_mode <> 'reference' or kind = 'ai')
      and (layer is null or jsonb_typeof(layer) = 'object') and (product_check is null or jsonb_typeof(product_check) = 'object')
      and (product_image_id is null or product_image_id <> id) and (background_image_id is null or background_image_id <> id));
  end if;
end $$;

-- 상품 장면 이미지(원본 보존 합성 결과 · AI 실사 장면)는 상품 디테일 검수를 승인하기 전에는 '사용 가능'이 될 수 없음 (어느 길로 바꿔도 DB가 막음).
-- 이미 '사용 가능'인 이미지의 다른 칸(설명 등)을 고치는 건 막지 않음. 1.5.1 전에 만든 이미지(composite_mode 빈 값)는 그대로
create or replace function public.post_images_product_gate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.review_status = '사용 가능'
     and (new.kind = 'composite' or new.composite_mode = 'reference')
     and coalesce((new.product_check->>'approved')::boolean, false) is not true
     and (tg_op = 'INSERT' or old.review_status is distinct from '사용 가능' or old.product_check is distinct from new.product_check) then
    raise exception 'product_check_needed';
  end if;
  return new;
end $$;
drop trigger if exists post_images_product_gate on public.post_images;
create trigger post_images_product_gate before insert or update on public.post_images for each row execute function public.post_images_product_gate();

-- 3 ───────── 함수
-- 이미지 저장 (017과 같음 + 1.5.1 칸: 합성 방식·원본 상품 사진·배경·마스크·레이어 설정). 상품 장면 이미지는 늘 '검수 전'으로 시작.
-- 상품 장면은 DB도 확인: 원본 상품 사진(직접 올림 — 쓸 권한 확인 · Pexels)이 살아 있어야 하고,
-- 원본 보존 합성(종류 composite)은 AI 배경·레이어 설정·그 상품 사진의 마스크가 있어야 함. 원본 상품 사진 줄은 바꾸지 않음
create or replace function public.image_save(img jsonb, link jsonb default null, gen uuid default null, fin jsonb default null) returns jsonb
language plpgsql set search_path = '' as $$
declare
  i public.post_images;
  sl jsonb;
  g public.image_generations;
  mode text := case when img->>'kind' = 'composite' then 'layer'
                    when img->>'kind' = 'ai' and img->>'composite_mode' = 'reference' then 'reference' else '' end;
  prod public.post_images;
  bg public.post_images;
  m public.product_masks;
begin
  if gen is not null then
    select * into g from public.image_generations where id = gen for update;
    if g.id is null or g.status <> '생성 중' then raise exception 'generation is not running'; end if;
  end if;
  if nullif(img->>'product_image_id', '') is not null then
    select * into prod from public.post_images where id = (img->>'product_image_id')::uuid and deleted_at is null;
    if prod.id is null or prod.kind not in ('upload', 'stock') then raise exception 'product_image_required'; end if;
    if prod.kind = 'upload' and not prod.rights_confirmed then raise exception 'rights_required'; end if;
  elsif mode <> '' then
    raise exception 'product_image_required';
  end if;
  if mode = 'layer' then
    select * into bg from public.post_images where id = nullif(img->>'background_image_id', '')::uuid and deleted_at is null;
    if bg.id is null or bg.kind <> 'ai' then raise exception 'background_image_required'; end if;
    if jsonb_typeof(img->'layer') is distinct from 'object' then raise exception 'layer_required'; end if;
    select * into m from public.product_masks where id = nullif(img->>'mask_id', '')::uuid and deleted_at is null;
    if m.id is null or m.image_id is distinct from prod.id then raise exception 'mask_mismatch'; end if;
  end if;
  insert into public.post_images (origin_post_id, origin_slot_index, origin_slot_key, kind, provider, model, prompt, user_prompt, style, purpose, ratio, description, alt_text,
      storage_path, mime, bytes, width, height, sha256, source_url, source_id, author_name, author_url, license, attribution_text, rights_confirmed, generation_id,
      parent_image_id, ref_images, composite, scene, preset,
      composite_mode, product_image_id, background_image_id, mask_id, layer)
    values (nullif(img->>'origin_post_id', '')::uuid, nullif(img->>'origin_slot_index', '')::int, left(coalesce(img->>'origin_slot_key', ''), 220),
      img->>'kind', coalesce(img->>'provider', ''),
      coalesce(img->>'model', ''), left(coalesce(img->>'prompt', ''), 32000), left(coalesce(img->>'user_prompt', ''), 2000), coalesce(img->>'style', ''),
      coalesce(img->>'purpose', ''), case when img->>'ratio' in ('16:9', '4:3', '1:1', '4:5', '9:16') then img->>'ratio' else '' end,
      left(coalesce(img->>'description', ''), 500), left(coalesce(img->>'alt_text', ''), 300),
      coalesce(img->>'storage_path', ''), coalesce(img->>'mime', ''), nullif(img->>'bytes', '')::int, nullif(img->>'width', '')::int, nullif(img->>'height', '')::int,
      coalesce(img->>'sha256', ''), left(coalesce(img->>'source_url', ''), 2000), left(coalesce(img->>'source_id', ''), 60),
      left(coalesce(img->>'author_name', ''), 200), left(coalesce(img->>'author_url', ''), 2000), left(coalesce(img->>'license', ''), 200),
      left(coalesce(img->>'attribution_text', ''), 300), coalesce((img->>'rights_confirmed')::boolean, false), gen,
      nullif(img->>'parent_image_id', '')::uuid,
      coalesce(case when jsonb_typeof(img->'ref_images') = 'array' then img->'ref_images' end, '[]'::jsonb),
      -- composite(1.5.0 뜻: 실제 사진을 참고한 AI 이미지): AI 실사 장면은 늘 참, 원본 보존 합성(픽셀을 그대로 얹음)은 AI가 다시 그린 게 아니라 거짓
      case when mode = 'reference' then true when mode = 'layer' then false else coalesce((img->>'composite')::boolean, false) end,
      case when jsonb_typeof(img->'scene') = 'object' then img->'scene' end,
      left(coalesce(img->>'preset', ''), 30),
      mode, prod.id, case when mode = 'layer' then bg.id end, case when mode = 'layer' then m.id end,
      case when mode = 'layer' then img->'layer' end)
    returning * into i;
  if link is not null and coalesce(link->>'post_id', '') <> '' then
    sl := public.image_slot_upsert((link->>'post_id')::uuid, link || jsonb_build_object('image_id', i.id));
  end if;
  if gen is not null then
    update public.image_generations set status = '성공', image_id = i.id, finished_at = now(),
        usage = fin->'usage', usage_usd = nullif(fin->>'usage_usd', '')::numeric,
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

-- 마스크 기록: 원본 상품 사진(직접 올림 — 쓸 권한 확인한 것 · Pexels)이 있어야 함. 원본 이미지 줄은 바꾸지 않음
create or replace function public.image_mask_save(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  img public.post_images;
  m public.product_masks;
begin
  select * into img from public.post_images where id = nullif(p->>'image_id', '')::uuid and deleted_at is null;
  if img.id is null then raise exception 'image not found'; end if;
  if img.kind not in ('upload', 'stock') then raise exception 'mask_real_only'; end if;
  if img.kind = 'upload' and not img.rights_confirmed then raise exception 'rights_required'; end if;
  if coalesce(p->>'storage_path', '') = '' then raise exception 'storage_path is required'; end if;
  insert into public.product_masks (image_id, storage_path, width, height, bytes, method, edited, params, bbox, coverage)
    values (img.id, p->>'storage_path', (p->>'width')::int, (p->>'height')::int, nullif(p->>'bytes', '')::int,
      case when p->>'method' in ('auto_u2netp', 'auto_simple', 'alpha', 'manual') then p->>'method' else 'manual' end,
      coalesce((p->>'edited')::boolean, false),
      coalesce(case when jsonb_typeof(p->'params') = 'object' then p->'params' end, '{}'::jsonb),
      case when jsonb_typeof(p->'bbox') = 'object' then p->'bbox' end,
      nullif(p->>'coverage', '')::numeric)
    returning * into m;
  return to_jsonb(m);
end $$;

-- 상품 디테일 검수 저장: 상품 장면 이미지만. 승인(approve)은 아홉 칸이 모두 '괜찮아'(ok)일 때만 → '사용 가능'.
-- 승인을 풀면(문제 있음·모르겠음) '사용 가능'이던 이미지는 '검수 전'으로 돌아감. AI 의견은 여기 섞지 않음 (image_reviews 에 따로)
create or replace function public.image_product_check(p_image uuid, p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  img public.post_images;
  keys text[] := array['shape', 'color', 'details', 'text', 'parts', 'scale', 'placement', 'artifacts', 'consistency'];
  items jsonb := '{}'::jsonb;
  k text;
  v text;
  all_ok boolean := true;
  approve boolean := coalesce((p->>'approve')::boolean, false);
  mode text;
begin
  select * into img from public.post_images where id = p_image and deleted_at is null for update;
  if img.id is null then raise exception 'image not found'; end if;
  mode := case when img.kind = 'composite' then 'layer' when img.kind = 'ai' and img.composite_mode = 'reference' then 'reference' else '' end;
  if mode = '' then raise exception 'not_product_scene'; end if;
  foreach k in array keys loop
    v := p->'items'->>k;
    if v in ('ok', 'issue', 'unsure') then items := items || jsonb_build_object(k, v); end if;
    if v is distinct from 'ok' then all_ok := false; end if;
  end loop;
  if approve and not all_ok then raise exception 'product_check_incomplete'; end if;
  update public.post_images set
      product_check = jsonb_build_object('mode', mode, 'items', items, 'note', left(coalesce(p->>'note', ''), 500),
        'approved', approve, 'approved_at', case when approve then to_jsonb(now()) else null end, 'updated_at', to_jsonb(now())),
      review_status = case when approve then '사용 가능' when review_status = '사용 가능' then '검수 전' else review_status end
    where id = img.id returning * into img;
  return to_jsonb(img);
end $$;

-- 이미지 지우기 (017과 같음 + 1.5.1): 상품 장면 결과(원본 보존 합성·AI 실사 장면)가 쓰는 원본 상품 사진과, 합성에 쓴 배경은 지우지 않음
-- (결과마다 원본 상품 사진을 남기고, 합성을 다시 고칠 때도 필요 — 결과를 먼저 지우면 됨).
-- 지운 사진의 마스크는 같이 '지움' 표시하고 파일 경로를 돌려줘서 서버가 파일도 지움
create or replace function public.image_delete(p_image uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  i public.post_images;
  uses int;
  paths jsonb;
begin
  select * into i from public.post_images where id = p_image and deleted_at is null for update;
  if i.id is null then raise exception 'image not found'; end if;
  select (select count(*) from public.post_image_slots where image_id = p_image)
       + (select count(*) from public.post_card_decks where bg_image_id = p_image)
       + (select count(*) from public.post_images r where r.deleted_at is null and r.id <> p_image
            and ((r.composite_mode in ('layer', 'reference') and r.product_image_id = p_image)
                 or (r.composite_mode = 'layer' and r.background_image_id = p_image))) into uses;
  if uses > 0 then raise exception 'image in use: %', uses; end if;
  update public.post_images set deleted_at = now() where id = p_image;
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into paths from public.product_masks where image_id = p_image and deleted_at is null and storage_path <> '';
  update public.product_masks set deleted_at = now() where image_id = p_image and deleted_at is null;
  return jsonb_build_object('storage_path', i.storage_path, 'ref_small_path', i.ref_small_path, 'mask_paths', paths);
end $$;

-- 지금 사용량 (017과 같음 + 마스크 파일 용량도 저장 공간에 셈)
create or replace function public.image_usage() returns jsonb
language sql stable set search_path = '' as $$
with s as (select * from public.settings where id = 1),
b as (select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as day_start,
             date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as month_start)
select jsonb_build_object(
  'today', (select count(*) from public.image_generations g, b where g.provider_called and g.created_at >= b.day_start),
  'daily_limit', (select image_daily_limit from s),
  'month_usd', public.image_month_spent(),
  'budget_usd', (select image_monthly_budget_usd from s),
  'request_cap_usd', (select image_request_cap_usd from s),
  'running', (select to_jsonb(x) from (select id, post_id, slot_key, started_at, batch_id from public.image_generations
                where status = '생성 중' and started_at > now() - interval '4 minutes' limit 1) x),
  'storage_bytes', (select coalesce(sum(bytes), 0) from public.post_images where deleted_at is null)
                 + (select coalesce(sum(bytes), 0) from public.product_masks where deleted_at is null),
  'image_count', (select count(*) from public.post_images where deleted_at is null),
  'pexels_hour', (select count(*) from public.api_calls where provider = 'pexels' and at > now() - interval '1 hour'),
  'pexels_month', (select count(*) from public.api_calls a, b where a.provider = 'pexels' and a.at >= b.month_start)
);
$$;

-- 4 ───────── 잠금: 새 표·함수도 서버 함수(서버 키)만
alter table public.product_masks enable row level security;
revoke all on public.product_masks from anon, authenticated;
revoke execute on function
  public.image_save(jsonb, jsonb, uuid, jsonb), public.image_mask_save(jsonb), public.image_product_check(uuid, jsonb),
  public.image_delete(uuid), public.image_usage(), public.post_images_product_gate()
  from public, anon, authenticated;
grant execute on function
  public.image_save(jsonb, jsonb, uuid, jsonb), public.image_mask_save(jsonb), public.image_product_check(uuid, jsonb),
  public.image_delete(uuid), public.image_usage()
  to service_role;
