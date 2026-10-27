-- 017: 이미지 스튜디오 고품질화 (1.5.0)
-- 표·데이터를 지우거나 다시 만들지 않음. 열·표·함수만 더하고, 기존 설정 값(생성·편집 모델, 품질, 하루 한도, 한 달 예산)은 그대로 둠.
-- 다시 돌려도 같은 결과.
--  1. post_images       — parent_image_id(고친 원본), ref_images(참고한 이미지와 역할), composite(실제 사진을 참고한 AI 이미지),
--                          scene(장면 설계서), preset(이미지 종류). 공급자 검사에 gemini 더함
--  2. image_generations — refs·scene·preset, 묶음(후보 여러 장·모델 비교: batch_id·batch_kind·batch_index·batch_total), parent_image_id
--  3. image_reviews     — AI 검수(멀티모달 모델의 의견, 비용 포함)와 사용자의 평가·선호를 따로 기록
--  4. image_provider_checks — '연결 확인' 결과 (키·모델을 실제로 물어본 결과. 설정에 이름만 넣은 것과 구분)
--  5. settings          — image_modes(모드별 모델·품질), image_review_model(AI 검수 모델, 빈칸 = 끔),
--                          image_request_cap_usd(한 번 누를 때 최대 예상 비용), image_ratio_prefs(용도별 기본 비율)
--  6. 함수: image_gen_begin(공급자 3곳만·묶음 예약·한 번 상한·검수 비용까지 예산에), image_save(새 열),
--           image_review_begin / image_review_finish / image_eval_save, image_lineage(수정 이력), image_usage·image_costs(검수 비용 포함)

-- 1 ───────── 이미지 보관함: 수정 이력·참고 이미지·장면 설계서
alter table public.post_images
  add column if not exists parent_image_id uuid references public.post_images(id) on delete set null,
  add column if not exists ref_images jsonb not null default '[]'::jsonb,
  add column if not exists composite boolean not null default false,
  add column if not exists scene jsonb,
  add column if not exists preset text not null default '',
  -- 무료 모델(FLUX.2 klein)에 참고 사진으로 보낼 작은 사본 (512px보다 작게, 화면이 만들어 올림). 원본은 그대로
  add column if not exists ref_small_path text not null default '';
create index if not exists post_images_parent_idx on public.post_images (parent_image_id) where parent_image_id is not null;
do $$ begin
  -- Gemini 공급자를 더함 — 같은 이름으로 다시 걺 (데이터는 그대로, 넓히기만 함)
  if exists (select 1 from pg_constraint where conname = 'post_images_provider_check'
             and pg_get_constraintdef(oid) not like '%gemini%') then
    alter table public.post_images drop constraint post_images_provider_check;
    alter table public.post_images add constraint post_images_provider_check
      check (provider in ('','openai','cloudflare','gemini','pexels','upload','cardnews'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'post_images_v150_checks') then
    alter table public.post_images add constraint post_images_v150_checks check (
      jsonb_typeof(ref_images) = 'array' and jsonb_array_length(ref_images) <= 16  -- OpenAI edits 가 받는 최대 장수 (앱의 모델 표 refsMax 와 같게)
      and (scene is null or jsonb_typeof(scene) = 'object') and length(preset) <= 30
      and (parent_image_id is null or parent_image_id <> id) and length(ref_small_path) <= 200);
  end if;
end $$;

-- 2 ───────── 생성 기록: 참고 이미지·장면 설계서·묶음
alter table public.image_generations
  add column if not exists refs jsonb not null default '[]'::jsonb,
  add column if not exists scene jsonb,
  add column if not exists preset text not null default '',
  add column if not exists batch_id uuid,
  add column if not exists batch_kind text not null default '',
  add column if not exists batch_index int,
  add column if not exists batch_total int;
create index if not exists image_generations_batch_idx on public.image_generations (batch_id) where batch_id is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'image_generations_v150_checks') then
    alter table public.image_generations add constraint image_generations_v150_checks check (
      jsonb_typeof(refs) = 'array' and jsonb_array_length(refs) <= 16
      and (scene is null or jsonb_typeof(scene) = 'object') and length(preset) <= 30
      and batch_kind in ('', 'candidates', 'compare')
      and (batch_index is null or batch_index between 0 and 2)
      and (batch_total is null or batch_total between 1 and 3));
  end if;
end $$;

-- 3 ───────── AI 검수·사용자 평가
-- kind = ai_review: 멀티모달 모델의 의견 (품질 보증이 아님 — 근거·확신 정도와 함께 보여줌, 비용 기록)
--        user_eval: 사용자가 직접 매긴 평가·선호 (모델 비교에서 'AI 평가'와 섞지 않음)
create table if not exists public.image_reviews (
  id uuid primary key default gen_random_uuid(),
  image_id uuid references public.post_images(id) on delete set null,
  generation_id uuid,
  post_id uuid references public.posts(id) on delete set null,
  batch_id uuid,
  kind text not null check (kind in ('ai_review', 'user_eval')),
  provider text not null default '',
  model text not null default '',
  status text not null default '완료' check (status in ('진행 중', '완료', '실패')),
  scores jsonb not null default '{}'::jsonb,        -- 항목별 {verdict, reason, confidence} (AI) 또는 {항목: 1~3} (사용자)
  summary text not null default '',
  suggestions jsonb not null default '[]'::jsonb,   -- AI가 제안한 수정 요청 (그대로 고치기에 넣을 수 있게)
  uncertainty text not null default '',
  preferred boolean,                                -- 사용자: 이 묶음에서 제일 나은 것
  est_usd numeric not null default 0 check (est_usd >= 0),
  usage jsonb,
  usage_usd numeric check (usage_usd >= 0),
  cost_status text not null default '예상' check (cost_status in ('예상', '사용량 기준', '청구 없음', '확인 필요')),
  error_code text not null default '',
  error_message text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'image_reviews_checks') then
    alter table public.image_reviews add constraint image_reviews_checks check (
      jsonb_typeof(scores) = 'object' and jsonb_typeof(suggestions) = 'array' and jsonb_array_length(suggestions) <= 6
      and length(summary) <= 1000 and length(uncertainty) <= 500 and length(model) <= 80 and length(error_message) <= 500);
  end if;
end $$;
create index if not exists image_reviews_image_idx on public.image_reviews (image_id, created_at desc);
create index if not exists image_reviews_created_idx on public.image_reviews (created_at desc);
create index if not exists image_reviews_batch_idx on public.image_reviews (batch_id) where batch_id is not null;
-- 같은 이미지의 사용자 평가는 하나 (고치면 덮어씀)
create unique index if not exists image_reviews_one_user_eval on public.image_reviews (image_id) where kind = 'user_eval';

-- 4 ───────── 연결 확인 기록 (키·모델을 실제로 물어본 결과)
create table if not exists public.image_provider_checks (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('openai', 'gemini', 'cloudflare')),
  model text not null default '',
  ok boolean not null,
  code text not null default '',
  message text not null default '',
  checked_at timestamptz not null default now()
);
create index if not exists image_provider_checks_idx on public.image_provider_checks (provider, checked_at desc);

-- 5 ───────── 설정 (기존 값은 건드리지 않음 — 새 칸은 비어 있거나 안전한 값으로 시작)
alter table public.settings
  add column if not exists image_modes jsonb not null default '{}'::jsonb,
  add column if not exists image_review_model text not null default '',
  add column if not exists image_request_cap_usd numeric not null default 1,
  add column if not exists image_ratio_prefs jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_image_v150_checks') then
    alter table public.settings add constraint settings_image_v150_checks check (
      jsonb_typeof(image_modes) = 'object' and jsonb_typeof(image_ratio_prefs) = 'object'
      and image_request_cap_usd between 0 and 20
      and (image_review_model = '' or image_review_model ~ '^[a-z0-9][a-z0-9._-]{1,60}$'));
  end if;
end $$;

-- 6 ───────── 함수
-- 이번 달 이미지 비용 (예산 셈): 생성 + AI 검수. 청구액 확인 > 사용량 기준 > 예상, '청구 없음'은 0
create or replace function public.image_month_spent() returns numeric
language sql stable set search_path = '' as $$
  with b as (select date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as month_start)
  select coalesce((select sum(case when g.cost_status = '청구 없음' then 0 else coalesce(g.actual_usd, g.usage_usd, g.est_usd) end)
                   from public.image_generations g, b where g.created_at >= b.month_start), 0)
       + coalesce((select sum(case when r.cost_status = '청구 없음' then 0 else coalesce(r.usage_usd, r.est_usd) end)
                   from public.image_reviews r, b where r.kind = 'ai_review' and r.created_at >= b.month_start), 0);
$$;

-- 생성 시작: 같은 요청이면 그대로 돌려주고, 이미 만드는 중이면·하루 한도·한 달 예산·한 번 상한을 넘으면 거절. 통과하면 '생성 중' 한 줄
-- 1.5.0: 공급자는 openai·cloudflare·gemini 만 (모르는 공급자를 openai 로 바꾸지 않음)
--        묶음(후보 2~3장·모델 비교)은 화면이 한 장씩 차례로 보냄. 남은 장(이번 포함)의 수·예상 비용(reserve_n·reserve_usd)으로
--        하루 한도·예산·한 번 상한을 미리 확인 → 중간에 한도에 걸려 반만 만들어지는 일을 줄임
create or replace function public.image_gen_begin(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  s public.settings;
  g public.image_generations;
  day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  est numeric := coalesce(nullif(p->>'est_usd', '')::numeric, 0);
  reserve_n int := greatest(1, least(3, coalesce(nullif(p->>'reserve_n', '')::int, 1)));
  reserve_usd numeric;
  used_today int;
  spent numeric;
  prov text := coalesce(p->>'provider', '');
begin
  if coalesce(p->>'request_key', '') = '' then raise exception 'request_key is required'; end if;
  if coalesce(p->>'model', '') = '' then raise exception 'model is required'; end if;
  -- 예상 비용이 없으면 예산 검사를 건너뛰게 되므로 거절 (0은 무료 모델·점검용 가짜 모델만)
  if nullif(p->>'est_usd', '') is null or est < 0 then raise exception 'est_usd is required'; end if;
  if prov not in ('openai', 'cloudflare', 'gemini') then raise exception 'bad provider: %', prov; end if;
  reserve_usd := greatest(est, coalesce(nullif(p->>'reserve_usd', '')::numeric, est));
  perform pg_advisory_xact_lock(hashtext('gf_image_gen'));
  select * into g from public.image_generations where request_key = p->>'request_key';
  if g.id is not null then return to_jsonb(g) || jsonb_build_object('duplicate', true); end if;
  -- 4분 넘게 끝나지 않은 생성은 실패로 정리 (서버가 중간에 멈춘 경우). 유료(OpenAI·Gemini)는 청구됐을 수 있어 확인 필요,
  -- 무료 플랜 Cloudflare 는 청구 없음 (1.5.0: 공급자별로 나눔 — 서버의 sweepStale 과 같은 기준)
  update public.image_generations set status = '실패', error_code = 'timeout',
      error_message = case when provider = 'cloudflare' then '응답이 끝나지 않아 멈췄어 (무료 모델이라 청구 없음).'
                           else '응답이 끝나지 않아 멈췄어. 청구됐을 수 있으니 공급자 사용량에서 확인해줘.' end,
      cost_status = case when provider = 'cloudflare' then '청구 없음' else '확인 필요' end,
      auto_cost_status = case when provider = 'cloudflare' then '청구 없음' else '확인 필요' end, finished_at = now()
    where status = '생성 중' and started_at < now() - interval '4 minutes';
  if exists (select 1 from public.image_generations where status = '생성 중') then raise exception 'image_busy'; end if;
  select * into s from public.settings where id = 1;
  select count(*) into used_today from public.image_generations where provider_called and created_at >= day_start;
  if used_today + reserve_n > coalesce(s.image_daily_limit, 0) then raise exception 'image_daily_limit'; end if;
  spent := public.image_month_spent();
  if spent + reserve_usd > coalesce(s.image_monthly_budget_usd, 0) then raise exception 'image_budget'; end if;
  if reserve_usd > coalesce(s.image_request_cap_usd, 1) then raise exception 'image_request_cap'; end if;
  insert into public.image_generations (request_key, post_id, slot_key, slot_index, slot_text, mode, provider, model, size, quality,
      output_format, purpose, style, user_prompt, prompt, base_image_id, est_usd, fx_krw, fx_date, fx_source, risk_override,
      refs, scene, preset, batch_id, batch_kind, batch_index, batch_total)
    values (p->>'request_key', nullif(p->>'post_id', '')::uuid, coalesce(p->>'slot_key', ''), nullif(p->>'slot_index', '')::int,
      left(coalesce(p->>'slot_text', ''), 500), coalesce(nullif(p->>'mode', ''), 'generate'), prov, p->>'model',
      coalesce(p->>'size', ''), coalesce(p->>'quality', ''), coalesce(nullif(p->>'output_format', ''), 'jpeg'),
      coalesce(p->>'purpose', ''), coalesce(p->>'style', ''), left(coalesce(p->>'user_prompt', ''), 2000), left(coalesce(p->>'prompt', ''), 32000),
      nullif(p->>'base_image_id', '')::uuid, est, s.image_fx_krw, s.image_fx_date, coalesce(s.image_fx_source, ''), left(coalesce(p->>'risk_override', ''), 200),
      coalesce(case when jsonb_typeof(p->'refs') = 'array' then p->'refs' end, '[]'::jsonb),
      case when jsonb_typeof(p->'scene') = 'object' then p->'scene' end,
      left(coalesce(p->>'preset', ''), 30), nullif(p->>'batch_id', '')::uuid, coalesce(nullif(p->>'batch_kind', ''), ''),
      nullif(p->>'batch_index', '')::int, nullif(p->>'batch_total', '')::int)
    returning * into g;
  return to_jsonb(g) || jsonb_build_object('duplicate', false, 'used_today', used_today + 1, 'spent_usd', spent);
end $$;

-- 이미지 저장: 보관함에 한 줄 + (원하면) 사진 자리에 연결 + (AI면) 생성 기록을 '성공'으로 — 한 번에 (중간에 실패하면 전부 취소)
-- 1.5.0: 고친 원본(parent_image_id)·참고 이미지(ref_images)·실제 사진 참고 여부(composite)·장면 설계서·이미지 종류도 저장
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
      storage_path, mime, bytes, width, height, sha256, source_url, source_id, author_name, author_url, license, attribution_text, rights_confirmed, generation_id,
      parent_image_id, ref_images, composite, scene, preset)
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
      coalesce((img->>'composite')::boolean, false),
      case when jsonb_typeof(img->'scene') = 'object' then img->'scene' end,
      left(coalesce(img->>'preset', ''), 30))
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

-- AI 검수 시작: 이미지가 있고, 이번 달 예산·한 번 상한 안이면 '진행 중' 한 줄 (같은 이미지를 동시에 두 번 검수하지 않음)
create or replace function public.image_review_begin(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  s public.settings;
  r public.image_reviews;
  img public.post_images;
  est numeric := coalesce(nullif(p->>'est_usd', '')::numeric, -1);
  spent numeric;
begin
  if est < 0 then raise exception 'est_usd is required'; end if;
  if coalesce(p->>'provider', '') not in ('openai', 'gemini', 'cloudflare') then raise exception 'bad provider: %', coalesce(p->>'provider', ''); end if;
  perform pg_advisory_xact_lock(hashtext('gf_image_review'));
  select * into img from public.post_images where id = nullif(p->>'image_id', '')::uuid and deleted_at is null;
  if img.id is null then raise exception 'image not found'; end if;
  update public.image_reviews set status = '실패', error_code = 'timeout', error_message = '응답이 끝나지 않아 멈췄어.',
      cost_status = case when provider = 'cloudflare' or est_usd = 0 then '청구 없음' else '확인 필요' end, finished_at = now()
    where status = '진행 중' and started_at < now() - interval '3 minutes';
  if exists (select 1 from public.image_reviews where image_id = img.id and status = '진행 중') then raise exception 'review_busy'; end if;
  select * into s from public.settings where id = 1;
  spent := public.image_month_spent();
  if spent + est > coalesce(s.image_monthly_budget_usd, 0) then raise exception 'image_budget'; end if;
  if est > coalesce(s.image_request_cap_usd, 1) then raise exception 'image_request_cap'; end if;
  insert into public.image_reviews (image_id, generation_id, post_id, batch_id, kind, provider, model, status, est_usd, cost_status)
    values (img.id, img.generation_id, coalesce(nullif(p->>'post_id', '')::uuid, img.origin_post_id), nullif(p->>'batch_id', '')::uuid,
            'ai_review', p->>'provider', left(coalesce(p->>'model', ''), 80), '진행 중', est,
            case when est = 0 then '청구 없음' else '예상' end)
    returning * into r;
  return to_jsonb(r) || jsonb_build_object('spent_usd', spent);
end $$;

-- AI 검수 끝: 결과(항목별 의견·요약·제안·불확실성)나 실패를 기록. 청구 상태는 서버가 알려준 대로
create or replace function public.image_review_finish(p_review uuid, fin jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare r public.image_reviews;
begin
  update public.image_reviews set
      status = case when coalesce((fin->>'ok')::boolean, false) then '완료' else '실패' end,
      scores = coalesce(case when jsonb_typeof(fin->'scores') = 'object' then fin->'scores' end, '{}'::jsonb),
      summary = left(coalesce(fin->>'summary', ''), 1000),
      suggestions = coalesce(case when jsonb_typeof(fin->'suggestions') = 'array' and jsonb_array_length(fin->'suggestions') <= 6 then fin->'suggestions' end, '[]'::jsonb),
      uncertainty = left(coalesce(fin->>'uncertainty', ''), 500),
      usage = fin->'usage', usage_usd = nullif(fin->>'usage_usd', '')::numeric,
      cost_status = case when fin->>'cost_status' in ('예상','사용량 기준','청구 없음','확인 필요') then fin->>'cost_status' else cost_status end,
      error_code = left(coalesce(fin->>'error_code', ''), 60), error_message = left(coalesce(fin->>'error_message', ''), 500),
      finished_at = now()
    where id = p_review and status = '진행 중' returning * into r;
  if r.id is null then raise exception 'review is not running'; end if;
  return to_jsonb(r);
end $$;

-- 사용자 평가 저장 (이미지마다 하나 — 다시 매기면 고침). preferred = 이 묶음에서 제일 나은 것 (같은 묶음의 다른 이미지는 풀림)
create or replace function public.image_eval_save(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  r public.image_reviews;
  img public.post_images;
  b uuid := nullif(p->>'batch_id', '')::uuid;
begin
  select * into img from public.post_images where id = nullif(p->>'image_id', '')::uuid and deleted_at is null;
  if img.id is null then raise exception 'image not found'; end if;
  if jsonb_typeof(p->'scores') is distinct from 'object' then raise exception 'scores must be an object'; end if;
  if coalesce((p->>'preferred')::boolean, false) and b is not null then
    update public.image_reviews set preferred = false where kind = 'user_eval' and batch_id = b and image_id <> img.id;
  end if;
  insert into public.image_reviews (image_id, generation_id, post_id, batch_id, kind, provider, model, status, scores, summary, preferred, cost_status, finished_at)
    values (img.id, img.generation_id, img.origin_post_id, b, 'user_eval', '', img.model, '완료', p->'scores',
            left(coalesce(p->>'note', ''), 1000), (p->>'preferred')::boolean, '청구 없음', now())
    on conflict (image_id) where kind = 'user_eval' do update set
      scores = excluded.scores, summary = excluded.summary, preferred = excluded.preferred,
      batch_id = coalesce(excluded.batch_id, public.image_reviews.batch_id), finished_at = now()
    returning * into r;
  return to_jsonb(r);
end $$;

-- 이미지 지우기 (012와 같음 + 작은 사본 경로도 돌려줘서 서버가 그 파일도 지움)
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
  return jsonb_build_object('storage_path', i.storage_path, 'ref_small_path', i.ref_small_path);
end $$;

-- 수정 이력: 이 이미지의 맨 처음 원본까지 올라간 뒤 그 아래 고친 이미지 전부 (원본은 지우거나 덮어쓰지 않음)
create or replace function public.image_lineage(p_image uuid) returns jsonb
language sql stable set search_path = '' as $$
with recursive up as (
  select i.id, i.parent_image_id, 0 as depth from public.post_images i where i.id = p_image
  union all
  select p.id, p.parent_image_id, up.depth + 1 from public.post_images p join up on p.id = up.parent_image_id where up.depth < 30
),
root as (select id from up order by depth desc limit 1),
down as (
  select i.id, i.parent_image_id, 0 as lvl from public.post_images i where i.id = (select id from root)
  union all
  select c.id, c.parent_image_id, down.lvl + 1 from public.post_images c join down on c.parent_image_id = down.id where down.lvl < 30
)
select jsonb_build_object(
  'root_id', (select id from root),
  'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'parent_image_id', i.parent_image_id, 'level', d.lvl, 'kind', i.kind, 'provider', i.provider, 'model', i.model,
      'user_prompt', i.user_prompt, 'description', i.description, 'created_at', i.created_at, 'deleted', i.deleted_at is not null,
      'generation_id', i.generation_id, 'composite', i.composite,
      'cost', (select jsonb_build_object('est_usd', g.est_usd, 'usage_usd', g.usage_usd, 'actual_usd', g.actual_usd, 'cost_status', g.cost_status, 'mode', g.mode, 'quality', g.quality, 'size', g.size)
               from public.image_generations g where g.id = i.generation_id))
      order by d.lvl, i.created_at)
    from down d join public.post_images i on i.id = d.id), '[]'::jsonb)
);
$$;

-- 이미지 비용 통계 (수익 통계와 따로 셈 → 실적의 '비용'과 두 번 더해지지 않음). 1.5.0: AI 검수 비용도 같이 (따로도 보여줌)
create or replace function public.image_costs(d_from date default null, d_to date default null, p_post uuid default null) returns jsonb
language sql stable set search_path = '' as $$
with s as (select image_fx_krw from public.settings where id = 1),
g as (
  select g.post_id, g.status, g.cost_status, g.actual_usd, g.usage_usd, 'gen'::text as src,
    case when g.cost_status = '청구 없음' then 0 else coalesce(g.actual_usd, g.usage_usd, g.est_usd) end as usd,
    coalesce(g.fx_krw, (select image_fx_krw from s)) as fx
  from public.image_generations g
  where (d_from is null or (g.created_at at time zone 'Asia/Seoul')::date >= d_from)
    and (d_to is null or (g.created_at at time zone 'Asia/Seoul')::date <= d_to)
    and (p_post is null or g.post_id = p_post)
  union all
  select r.post_id, case when r.status = '완료' then '성공' else r.status end, r.cost_status, null::numeric, r.usage_usd, 'review'::text,
    case when r.cost_status = '청구 없음' then 0 else coalesce(r.usage_usd, r.est_usd) end,
    (select image_fx_krw from s)
  from public.image_reviews r
  where r.kind = 'ai_review'
    and (d_from is null or (r.created_at at time zone 'Asia/Seoul')::date >= d_from)
    and (d_to is null or (r.created_at at time zone 'Asia/Seoul')::date <= d_to)
    and (p_post is null or r.post_id = p_post)
)
select jsonb_build_object(
  'from', d_from, 'to', d_to,
  'totals', (select jsonb_build_object(
      'count', count(*) filter (where src = 'gen'), 'billed', count(*) filter (where src = 'gen' and cost_status <> '청구 없음'),
      'success', count(*) filter (where src = 'gen' and status = '성공'), 'failed', count(*) filter (where src = 'gen' and status = '실패'),
      'usd', coalesce(sum(usd), 0), 'usd_actual', sum(actual_usd), 'n_actual', count(actual_usd),
      'n_usage', count(*) filter (where src = 'gen' and actual_usd is null and usage_usd is not null),
      -- 확인 필요: 청구액을 넣어 고칠 수 있는 생성 기록만 (검수는 따로 — 1.5.0 검토)
      'uncertain', count(*) filter (where src = 'gen' and cost_status = '확인 필요'),
      'review_uncertain', count(*) filter (where src = 'review' and cost_status = '확인 필요'),
      'fx_missing', count(*) filter (where fx is null and usd > 0),
      'krw', case when count(*) filter (where fx is null and usd > 0) = 0 then coalesce(sum(usd * coalesce(fx, 0)), 0) end,
      'reviews', count(*) filter (where src = 'review'),
      'review_usd', coalesce(sum(usd) filter (where src = 'review'), 0))
    from g),
  'by_post', coalesce((select jsonb_agg(x) from (
      select post_id as key, count(*) filter (where src = 'gen') as count, count(*) filter (where src = 'gen' and cost_status <> '청구 없음') as billed,
        coalesce(sum(usd), 0) as usd,
        case when count(*) filter (where fx is null and usd > 0) = 0 then coalesce(sum(usd * coalesce(fx, 0)), 0) end as krw,
        count(*) filter (where src = 'gen' and cost_status = '확인 필요') as uncertain,
        count(*) filter (where src = 'review') as reviews,
        coalesce(sum(usd) filter (where src = 'review'), 0) as review_usd
      from g group by post_id) x), '[]'::jsonb)
);
$$;

-- 지금 사용량: 오늘 생성 횟수·이번 달 비용(예산과 같은 셈법 — 검수 포함)·만드는 중인 것·저장 공간·Pexels 호출 수·한 번 상한
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
  'storage_bytes', (select coalesce(sum(bytes), 0) from public.post_images where deleted_at is null),
  'image_count', (select count(*) from public.post_images where deleted_at is null),
  'pexels_hour', (select count(*) from public.api_calls where provider = 'pexels' and at > now() - interval '1 hour'),
  'pexels_month', (select count(*) from public.api_calls a, b where a.provider = 'pexels' and a.at >= b.month_start)
);
$$;

-- 7 ───────── 잠금: 새 표·함수도 서버 함수(서버 키)만
alter table public.image_reviews enable row level security;
alter table public.image_provider_checks enable row level security;
revoke all on public.image_reviews, public.image_provider_checks from anon, authenticated;
revoke execute on function
  public.image_month_spent(), public.image_gen_begin(jsonb), public.image_save(jsonb, jsonb, uuid, jsonb),
  public.image_review_begin(jsonb), public.image_review_finish(uuid, jsonb), public.image_eval_save(jsonb), public.image_lineage(uuid),
  public.image_costs(date, date, uuid), public.image_usage()
  from public, anon, authenticated;
grant execute on function
  public.image_month_spent(), public.image_gen_begin(jsonb), public.image_save(jsonb, jsonb, uuid, jsonb),
  public.image_review_begin(jsonb), public.image_review_finish(uuid, jsonb), public.image_eval_save(jsonb), public.image_lineage(uuid),
  public.image_costs(date, date, uuid), public.image_usage()
  to service_role;

-- 8 ───────── 비공개 버킷: 한 파일 한도를 10MB → 25MB 로 넓힘 (Gemini 2K 결과가 PNG면 10MB를 넘을 수 있어서 — 1.5.0 검토)
-- 넓히기만 함: 한도가 없거나(null) 이미 25MB 이상이면 그대로. 공개 여부·허용 형식은 건드리지 않음.
-- 테스트용 Postgres(PGlite)에는 storage 스키마가 없어서 건너뜀
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    update storage.buckets set file_size_limit = 26214400
      where id = 'post-images' and file_size_limit is not null and file_size_limit < 26214400;
  end if;
end $$;
