-- 015: 글공장 1.3.1 정확성·신뢰성 (열 두 개만 더함 — 기존 표·데이터는 그대로, 다시 돌려도 같은 결과)
--
-- 1) post_images.source_type: 직접 올린 사진의 출처를 사용자가 고른 값
--    'own'(직접 촬영) · 'official'(공식 제공) · 'external'(외부 제공) · ''(출처 확인 필요)
--    파일을 올렸다는 것만으로 직접 촬영으로 보지 않아서, 이미 올라와 있던 사진은 모두 ''(출처 확인 필요)로 남김 (소급해서 바꾸지 않음)
--    AI·Pexels·카드뉴스는 만든 방법(kind)으로 출처가 정해져서 이 칸을 쓰지 않음
alter table public.post_images add column if not exists source_type text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'post_images_source_type_check') then
    alter table public.post_images add constraint post_images_source_type_check check (source_type in ('', 'own', 'official', 'external'));
  end if;
end $$;

-- 2) settings.focus_terms: 주력 주제 낱말 (쉼표로). 글의 키워드·제목에 이 낱말이나 주력 주제의 낱말이 있으면 주제 글로 봄
--    writer_context() 는 설정 전체를 보내서 자동 작가에게도 자동으로 들어감
alter table public.settings add column if not exists focus_terms text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_focus_terms_len') then
    alter table public.settings add constraint settings_focus_terms_len check (length(focus_terms) <= 300);
  end if;
end $$;
