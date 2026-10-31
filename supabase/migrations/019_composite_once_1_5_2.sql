-- 019: 같은 합성이 두 줄로 저장되지 않게 (1.5.2)
-- 화면은 합성을 저장할 때 요청 번호를 보내고, 서버는 그 번호로 파일 경로를 정해 (같은 번호 = 같은 경로) 이미 저장된 게 있으면 그걸 돌려줘.
-- 그런데 응답을 못 받아 '다시 저장 (같은 요청)'을 누른 요청이 첫 요청과 거의 동시에 서버에 닿으면, 둘 다 '아직 없음'으로 보고
-- 같은 파일을 가리키는 두 줄을 만들 수 있어 (한 줄을 지우면 다른 줄의 파일까지 지워짐). 그래서 저장 경로가 같은 '살아 있는 합성'은
-- 한 줄만 되게 고유 색인을 더해 — 두 번째 줄은 DB가 막고(23505), 서버는 먼저 저장된 줄을 돌려줌.
-- 표·데이터를 바꾸거나 지우지 않음 — 색인만 더함. 다시 돌려도 같은 결과. 018 끝부분(종류 검사에 composite 더하기)과 순서 상관없음.
-- 이미 같은 경로의 살아 있는 합성이 두 줄 이상 있으면 (2026-10-31 실서비스는 합성 0장) 색인을 만들지 않고 알림만 남김 — 데이터는 고치지 않음.
do $$
begin
  if exists (select 1 from public.post_images where kind = 'composite' and deleted_at is null group by storage_path having count(*) > 1) then
    raise notice '019: 저장 경로가 같은 합성이 이미 있어서 고유 색인을 만들지 않았어 — 관리자 확인이 필요해';
  else
    create unique index if not exists post_images_composite_path_uniq
      on public.post_images (storage_path) where kind = 'composite' and deleted_at is null;
  end if;
end $$;
