-- 022: 홈판 기록 (1.8.0)
-- 사용자 요청 (2026-11-06 17:46 "상위노출·홈판에 올라간 글을 뒤져서 학습해… 내 웹에 이식해서 홈판용 글을 쓰자")
--   → 남의 글을 긁어 오지 않고, 조사 보고서 '네이버 홈판 상위노출 공략'의 결론대로 '우리 글로 시험'하는 측정 칸
--   posts.feed_log: 글마다 누락 확인(날짜·결과), 7일째 숫자(홈피드·검색 비중 %, 첫 24시간·7일 조회, 평균 사용 시간),
--                   썸네일 변형(A 색 카드 · B 사진 + 짧은 글자 · C 사진만), 제목 글자 수, 메모
--   settings.ai_citations: AI 브리핑 누적 인용 수 [{"on": "YYYY-MM-DD", "total": 정수}] (블로그 프로필에서 본 누적 값을 주 1회)
-- 숫자는 사용자가 블로그 통계에서 보고 적은 것 — 앱·서버가 네이버에서 가져오지 않음 (검색 결과를 긁거나 AI에 넣지 않음)
-- 칸 이름·값 검사는 checks.js feedLogError·citationsError (서버가 저장 전에 확인). DB는 모양(객체·배열)만 확인
-- 추가형: 열과 모양 검사만 더함. 이 파일은 데이터를 지우거나 바꾸지 않음. 다시 돌려도 같은 결과.

alter table public.posts add column if not exists feed_log jsonb not null default '{}'::jsonb;
alter table public.settings add column if not exists ai_citations jsonb not null default '[]'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'posts_feed_log_shape') then
    alter table public.posts add constraint posts_feed_log_shape check (jsonb_typeof(feed_log) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_ai_citations_shape') then
    alter table public.settings add constraint settings_ai_citations_shape check (jsonb_typeof(ai_citations) = 'array');
  end if;
end $$;

comment on column public.posts.feed_log is '1.8.0 홈판 기록 — 누락 확인·7일째 숫자·썸네일 변형(A/B/C)·제목 글자 수 (사용자가 블로그 통계에서 보고 적은 값)';
comment on column public.settings.ai_citations is '1.8.0 AI 브리핑 누적 인용 수 [{on, total}] — 블로그 프로필에서 본 값을 주 1회';
