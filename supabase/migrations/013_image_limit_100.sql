-- 013: 하루 이미지 생성 한도의 최대값 50 → 100 (1.2.1)
-- 무료 모델(Cloudflare 무료 플랜)은 하루 약 70~100장이 실제 상한이라, 앱 한도가 먼저 막지 않게 넓힘. 나머지 검사는 그대로.
-- 표·데이터는 그대로. 같은 이름의 값 검사를 범위만 바꿔 다시 걺 (설정 값 자체는 바꾸지 않음 — 사용자가 설정에서 고름)
alter table public.settings drop constraint if exists settings_image_checks;
alter table public.settings add constraint settings_image_checks check (
  image_quality in ('low','medium','high','xhigh','max')
  and image_daily_limit between 0 and 100
  and image_monthly_budget_usd between 0 and 500
  and (image_fx_krw is null or image_fx_krw between 100 and 10000)
  and image_gen_model ~ '^[a-z0-9][a-z0-9._-]{1,60}$'
  and image_edit_model ~ '^[a-z0-9][a-z0-9._-]{1,60}$'
  and jsonb_typeof(image_prices) = 'object');
