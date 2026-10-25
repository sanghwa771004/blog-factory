-- 014: 주력 주제 (1.3.0 검색 노출 도우미)
-- 블로그의 큰 주제 하나. 자동 작가가 자동 주제를 이 안에서만 고르고, 앱은 이 주제 밖의 글을 검사에서 알려줌.
-- 표·데이터는 그대로. 설정에 열 하나만 더함 (writer_context 는 설정 전체를 보내서 자동으로 포함됨)
alter table public.settings add column if not exists focus_topic text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_focus_topic_len') then
    alter table public.settings add constraint settings_focus_topic_len check (length(focus_topic) <= 60);
  end if;
end $$;
