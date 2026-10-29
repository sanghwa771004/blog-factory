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
--  4. 발행 막기 (트리거 — 서버·화면과 같은 규칙을 DB도): 승인 안 한 상품 장면 이미지를 쓰고 있으면(자리 — 본문·본문 밖·본문에서 사라진 자리,
--     카드뉴스 배경, 그걸 배경으로 그린 카드뉴스 PNG) 발행 준비 완료·예약·게시 완료로 못 바꾸고, 그런 글의 자리·카드뉴스 배경에는 못 넣음.
--     승인을 풀면 그 이미지를 쓰는 발행 준비·예약 글(휴지통 포함)은 '검수 필요'로, 휴지통에서 되살린 발행 준비·예약 글이 걸리면 '검수 필요'로.
--     card_deck_save·image_slot_upsert·image_slot_swap 은 012와 같고 잠그는 순서(글 줄 → 이미지 줄)·맞바꾸기만 더함
--  5. 종류·공급자 검사에 composite 더하기 — 맨 끝에 따로 (Supabase가 확인을 묻는 부분. 따로 실행해도 됨)

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
create or replace trigger post_images_product_gate before insert or update on public.post_images for each row execute function public.post_images_product_gate();

-- 이 글이 쓰는 상품 장면 이미지 중 상품 디테일 검수를 승인하지 않은 것의 수 (같은 이미지는 한 번):
-- 자리(본문·본문 밖·본문에서 사라진 자리 모두)에 연결된 이미지 · 이 글의 카드뉴스 배경 · 자리에 연결된 카드뉴스 PNG를 그릴 때 쓴 배경 (1.5.1 재검토)
create or replace function public.post_product_unapproved(p_post uuid) returns int
language sql stable set search_path = '' as $$
  select count(*)::int from public.post_images i
   where (i.kind = 'composite' or i.composite_mode = 'reference')
     and coalesce((i.product_check->>'approved')::boolean, false) is not true
     and (i.id in (select s.image_id from public.post_image_slots s where s.post_id = p_post)
          or i.id in (select d.bg_image_id from public.post_card_decks d where d.post_id = p_post)
          or i.id in (select c.background_image_id from public.post_image_slots s join public.post_images c on c.id = s.image_id
                       where s.post_id = p_post and c.kind = 'card'))
$$;

-- 이 이미지(카드뉴스 PNG면 그 배경까지)가 승인 안 한 상품 장면인지
create or replace function public.image_product_unapproved(p_image uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.post_images i
    where i.id in (p_image, (select c.background_image_id from public.post_images c where c.id = p_image and c.kind = 'card'))
      and (i.kind = 'composite' or i.composite_mode = 'reference')
      and coalesce((i.product_check->>'approved')::boolean, false) is not true)
$$;

-- 발행 준비 완료·예약·게시(완료 뒤 단계 포함) 글의 자리에는 승인 안 한 상품 장면 이미지(와 그걸 배경으로 그린 카드뉴스 PNG)를 넣지 못함
-- (자리 연결·같은 파일 다시 올리기 등 어느 길로든). 이미 그 자리에 있던 이미지를 다시 연결하거나 두 자리를 맞바꾸는 건 새 이미지를 넣는 게 아니라서 그대로 둠.
-- 글 줄을 먼저 잠그고(for share) 단계를 본 뒤 이미지 줄을 잠그고 봄 — 같은 때 그 글을 발행 준비로 바꾸거나 승인을 푸는 요청과 겹쳐도
-- 둘 중 하나가 기다렸다가 바뀐 값을 봄 (승인 풀기도 글 줄부터 잠금 — 순서가 같아서 서로 기다리다 멈추지 않음)
create or replace function public.post_image_slots_product_gate() returns trigger
language plpgsql set search_path = '' as $$
declare
  st text;
begin
  if new.image_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.image_id is not distinct from old.image_id then return new; end if;
  if tg_op = 'INSERT' and exists (select 1 from public.post_image_slots x
                                   where x.post_id = new.post_id and x.slot_key = new.slot_key and x.image_id = new.image_id) then return new; end if;
  if current_setting('app.slot_swap_post', true) = new.post_id::text then return new; end if;
  select stage into st from public.posts where id = new.post_id for share;
  if st in ('ready', 'scheduled', 'published', 'collecting', 'analyzed') then
    perform 1 from public.post_images
     where id = new.image_id or id = (select c.background_image_id from public.post_images c where c.id = new.image_id and c.kind = 'card')
     order by id for share;
    if public.image_product_unapproved(new.image_id) then raise exception 'product_check_needed'; end if;
  end if;
  return new;
end $$;
create or replace trigger post_image_slots_product_gate before insert or update of image_id on public.post_image_slots
  for each row execute function public.post_image_slots_product_gate();

-- 카드뉴스 배경도 같은 규칙: 발행 준비 완료·예약·게시 글의 카드뉴스 배경으로 승인 안 한 상품 장면 이미지를 새로 고르지 못함 (배경을 그대로 두고 문구만 고치는 건 그대로)
create or replace function public.post_card_decks_product_gate() returns trigger
language plpgsql set search_path = '' as $$
declare
  st text;
begin
  if new.bg_image_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.bg_image_id is not distinct from old.bg_image_id then return new; end if;
  if tg_op = 'INSERT' and exists (select 1 from public.post_card_decks x where x.post_id = new.post_id and x.bg_image_id = new.bg_image_id) then return new; end if;
  select stage into st from public.posts where id = new.post_id for share;
  if st in ('ready', 'scheduled', 'published', 'collecting', 'analyzed') then
    perform 1 from public.post_images
     where id = new.bg_image_id or id = (select c.background_image_id from public.post_images c where c.id = new.bg_image_id and c.kind = 'card')
     order by id for share;
    if public.image_product_unapproved(new.bg_image_id) then raise exception 'product_check_needed'; end if;
  end if;
  return new;
end $$;
create or replace trigger post_card_decks_product_gate before insert or update of bg_image_id on public.post_card_decks
  for each row execute function public.post_card_decks_product_gate();

-- 카드뉴스 저장 (012와 같음 + 1.5.1): 글 줄을 먼저 잠그고(for share) 배경 이미지 줄을 잠금 — 위 트리거·승인 풀기와 잠그는 순서를 같게
create or replace function public.card_deck_save(p_post uuid, p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  d public.post_card_decks;
  bg uuid := nullif(p->>'bg_image_id', '')::uuid;
begin
  perform 1 from public.posts where id = p_post for share;
  if not found then raise exception 'post not found'; end if;
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

-- 사진 자리에 이미지 연결·빼기 (012와 같음 + 1.5.1): 글 줄을 먼저 잠그고(for share) 이미지 줄을 잠금 — 위 트리거·승인 풀기와 잠그는 순서를 같게
create or replace function public.image_slot_upsert(p_post uuid, p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  sl public.post_image_slots;
  img uuid := nullif(p->>'image_id', '')::uuid;
begin
  perform 1 from public.posts where id = p_post for share;
  if not found then raise exception 'post not found'; end if;
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

-- 두 자리의 이미지를 맞바꿈 (012와 같음 + 1.5.1): 이 글에 이미 있던 이미지끼리 자리만 바꾸는 거라서 위 자리 연결 막기를 건너뜀
-- (게시한 글에서 승인을 푼 이미지가 있어도 순서는 바꿀 수 있게 — 1.5.1 재검토). 건너뛰는 표시는 이 함수 안에서만 켰다가 끔
create or replace function public.image_slot_swap(p_post uuid, a jsonb, b jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  ra public.post_image_slots;
  rb public.post_image_slots;
begin
  if a->>'slot_key' = b->>'slot_key' then raise exception 'same slot'; end if;
  perform set_config('app.slot_swap_post', p_post::text, true);
  perform public.image_slot_upsert(p_post, a || jsonb_build_object('image_id', (select image_id from public.post_image_slots where post_id = p_post and slot_key = a->>'slot_key')));
  perform public.image_slot_upsert(p_post, b || jsonb_build_object('image_id', (select image_id from public.post_image_slots where post_id = p_post and slot_key = b->>'slot_key')));
  select * into ra from public.post_image_slots where post_id = p_post and slot_key = a->>'slot_key' for update;
  select * into rb from public.post_image_slots where post_id = p_post and slot_key = b->>'slot_key' for update;
  update public.post_image_slots set image_id = rb.image_id, crop = rb.crop, downloaded_at = null, used_at = null where id = ra.id;
  update public.post_image_slots set image_id = ra.image_id, crop = ra.crop, downloaded_at = null, used_at = null where id = rb.id;
  perform set_config('app.slot_swap_post', '', true);
  return jsonb_build_object('a', (select to_jsonb(x) from public.post_image_slots x where x.id = ra.id), 'b', (select to_jsonb(x) from public.post_image_slots x where x.id = rb.id));
end $$;

-- 글을 발행 준비 완료·예약·게시 완료로 바꿀 때 (어느 길로든) 승인 안 한 상품 장면 이미지를 쓰고 있으면 막음
-- (게시 뒤 단계(실적 모으는 중·분석 끝)에서 게시 완료로 돌아가는 건 서버처럼 다시 검사하지 않음 — 이미 올린 글이라서).
-- 휴지통에서 되살린 발행 준비·예약 글이 그사이 승인을 푼 이미지를 쓰고 있으면 '검수 필요'로
create or replace function public.posts_product_gate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stage in ('ready', 'scheduled', 'published') and new.stage is distinct from old.stage
     and not (new.stage = 'published' and old.stage in ('collecting', 'analyzed'))
     and public.post_product_unapproved(new.id) > 0 then
    raise exception 'product_check_needed';
  end if;
  if old.deleted_at is not null and new.deleted_at is null and new.stage in ('ready', 'scheduled')
     and public.post_product_unapproved(new.id) > 0 then
    new.stage := 'review';
  end if;
  return new;
end $$;
create or replace trigger posts_product_gate before update of stage, deleted_at on public.posts for each row execute function public.posts_product_gate();

-- 이 이미지를 쓰는 글: 자리에 연결 · 카드뉴스 배경 · 이 이미지를 배경으로 그린 카드뉴스 PNG를 자리에 연결 (1.5.1 재검토)
create or replace function public.posts_using_image(p_image uuid) returns setof uuid
language sql stable set search_path = '' as $$
  select s.post_id from public.post_image_slots s where s.image_id = p_image
  union select d.post_id from public.post_card_decks d where d.bg_image_id = p_image
  union select s.post_id from public.post_image_slots s join public.post_images c on c.id = s.image_id
         where c.kind = 'card' and c.background_image_id = p_image
$$;

-- 승인을 풀면 그 이미지를 쓰는 발행 준비 완료·예약 글을 '검수 필요'로 (휴지통에 있는 글도 — 되살렸을 때 그대로 발행 준비로 남지 않게)
create or replace function public.post_images_product_demote() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce((old.product_check->>'approved')::boolean, false) is true
     and coalesce((new.product_check->>'approved')::boolean, false) is not true then
    update public.posts set stage = 'review'
     where id in (select public.posts_using_image(new.id))
       and stage in ('ready', 'scheduled');
  end if;
  return null;
end $$;
create or replace trigger post_images_product_demote after update of product_check on public.post_images
  for each row execute function public.post_images_product_demote();

-- 3 ───────── 함수
-- 이미지 저장 (017과 같음 + 1.5.1 칸: 합성 방식·원본 상품 사진·배경·마스크·레이어 설정). 상품 장면 이미지는 늘 '검수 전'으로 시작.
-- 상품 장면은 DB도 확인: 원본 상품 사진(직접 올림 — 쓸 권한 확인 · Pexels)이 살아 있어야 하고,
-- 원본 보존 합성(종류 composite)은 이 상품용 빈 배경(pscene_layer)·레이어 설정·그 상품 사진의 마스크가 있어야 함. 원본 상품 사진 줄은 바꾸지 않음
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
  if mode <> '' then
    -- 상품 장면 결과: 원본 상품 사진이 살아 있어야 함. 같은 때 지우는 요청과 겹치지 않게 잠가 두고 확인 (for share)
    select * into prod from public.post_images where id = nullif(img->>'product_image_id', '')::uuid and deleted_at is null for share;
    if prod.id is null or prod.kind not in ('upload', 'stock') then raise exception 'product_image_required'; end if;
    if prod.kind = 'upload' and not prod.rights_confirmed then raise exception 'rights_required'; end if;
  elsif nullif(img->>'product_image_id', '') is not null then
    -- 원본 보존 합성용 빈 배경 등: 상품 사진을 가리키기만 함 (만드는 사이 상품 사진이 지워졌어도 이미 돈을 낸 결과는 버리지 않음)
    select * into prod from public.post_images where id = (img->>'product_image_id')::uuid;
  end if;
  if mode = 'layer' then
    -- 배경은 이 상품용으로 만든 '빈 배경'(원본 보존 합성 배경 · AI 실사 장면 아님)만 — AI가 상품을 다시 그린 이미지 위에 얹지 않게
    select * into bg from public.post_images where id = nullif(img->>'background_image_id', '')::uuid and deleted_at is null for share;
    if bg.id is null or bg.kind <> 'ai' then raise exception 'background_image_required'; end if;
    if bg.preset <> 'pscene_layer' or bg.composite_mode <> '' or bg.product_image_id is distinct from prod.id then raise exception 'background_mismatch'; end if;
    if jsonb_typeof(img->'layer') is distinct from 'object' then raise exception 'layer_required'; end if;
    select * into m from public.product_masks where id = nullif(img->>'mask_id', '')::uuid and deleted_at is null for share;
    if m.id is null or m.image_id is distinct from prod.id then raise exception 'mask_mismatch'; end if;
  end if;
  -- 카드뉴스 PNG: 그릴 때 쓴 배경 이미지를 가리키기만 함 — 배경이 상품 장면이면 발행 막기가 그 승인을 따라감 (1.5.1 재검토)
  if img->>'kind' = 'card' and nullif(img->>'background_image_id', '') is not null then
    select * into bg from public.post_images where id = (img->>'background_image_id')::uuid;
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
      mode, prod.id, case when mode = 'layer' or img->>'kind' = 'card' then bg.id end, case when mode = 'layer' then m.id end,
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
  -- 승인을 풀 수 있는 저장이면 이 이미지를 쓰는 글 줄부터 잠금 (자리 연결·카드뉴스 배경·발행 준비로 바꾸기와 같은 순서: 글 줄 → 이미지 줄)
  if not approve then
    perform 1 from public.posts where id in (select public.posts_using_image(p_image)) order by id for no key update;
  end if;
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
  -- 이 사진을 참고 사진·고칠 이미지로 지금 만드는 중이면 끝날 때까지 못 지움 (만든 결과를 저장하지 못해 돈만 나가지 않게)
  if exists (select 1 from public.image_generations g where g.status = '생성 중' and g.started_at > now() - interval '15 minutes'
               and (g.base_image_id = p_image or g.refs @> jsonb_build_array(jsonb_build_object('image_id', p_image::text)))) then
    raise exception 'image_generating';
  end if;
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
  public.image_delete(uuid), public.image_usage(), public.post_images_product_gate(), public.post_product_unapproved(uuid),
  public.image_product_unapproved(uuid), public.posts_using_image(uuid),
  public.post_image_slots_product_gate(), public.post_card_decks_product_gate(), public.posts_product_gate(), public.post_images_product_demote(),
  public.card_deck_save(uuid, jsonb), public.image_slot_swap(uuid, jsonb, jsonb), public.image_slot_upsert(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.image_save(jsonb, jsonb, uuid, jsonb), public.image_mask_save(jsonb), public.image_product_check(uuid, jsonb),
  public.image_delete(uuid), public.image_usage(), public.post_product_unapproved(uuid),
  public.image_product_unapproved(uuid), public.posts_using_image(uuid),
  public.card_deck_save(uuid, jsonb), public.image_slot_swap(uuid, jsonb, jsonb), public.image_slot_upsert(uuid, jsonb)
  to service_role;

-- 5 ───────── 종류·공급자 검사에 composite 더하기 (넓히기만 — 기존 값은 그대로, 데이터는 안 바뀜)
-- 같은 이름의 검사를 지우고 넓혀서 다시 거는 거라 Supabase가 확인을 물어보는 부분이야. 확인 창을 못 띄우는 화면에서는
-- 이 부분만 Supabase 대시보드 SQL Editor에서 따로 실행해도 돼 (위 1~4와 순서 상관없음, 다시 돌려도 같은 결과)
do $$ begin
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
end $$;
