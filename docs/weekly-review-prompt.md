# 주간 정리 예약 작업 프롬프트 (1.4.0, 선택)

- 예약 작업 이름: **글공장 주간 정리** (`CRON_TZ=Asia/Seoul 22 8 * * 1` — 매주 월요일 오전 8:22, 휴대폰 알림 켬)
- 하는 일: 지난 7일 글공장 숫자를 **읽기만 해서** 휴대폰 알림으로 짧게 정리해 보내. DB에 쓰지 않아.
- 이 파일은 저장소 사본이야. 예약 작업을 만들거나 바꿀 때 아래 전문을 넣고 이 파일의 '반영 상태'도 고쳐줘.
- **반영 상태 (2026-10-27)**: 사용자가 만들자고 해서 2026-10-27에 예약 작업을 만들었어 (아래 전문 그대로, 승인 없이 실행되는 설정). 실행 전에 아래 쿼리를 실서버에서 한 번 돌려 봤고 오류 없이 읽혔어. 첫 실제 실행은 2026-11-02 오전 8:22 — 아직 돌아 본 적 없어 (검증 안 됨).
- 앱 홈의 '최근 7일 정리'와 같은 기준: 최근 7일(오늘 포함), 원고·게시·다른 채널·검색어는 앱 기록(지운 글 빼고), 조회·클릭·수익은 입력한 실적 중 **그 7일 안에 다 들어가는 것만**(한 달치처럼 긴 기간 실적은 빼고 몇 줄 뺐는지 같이 — 없으면 '데이터 없음').
- 아래 쿼리는 016을 올린 DB(로컬 PGlite)에서 실제로 돌려 확인해 (`tests/sql_ops.test.js` '주간 정리 예약 작업 쿼리').

아래 `---` 사이가 프롬프트 전문이야.

---
[블로그 글공장 주간 정리 — 매주 월요일]

사용자(상화)의 '블로그 글공장' 숫자를 읽어서 지난 7일을 짧게 정리해 알려주는 작업이야. 사용자는 이 실행을 보고 있지 않으니 질문하지 마. 읽기만 하고 아무것도 바꾸지 마.

## 접근
- Supabase 커넥터의 execute_sql 로 project_id = "oxewhsqmdkiasckvnyua" 에만, select 문만 써. insert / update / delete / drop / truncate / alter 와 함수 호출(writer_context 제외)은 쓰지 마.

## 읽을 것 (쿼리 하나)
select jsonb_build_object(
  'today', (now() at time zone 'Asia/Seoul')::date,
  'ctx', public.writer_context() -> 'backlog',
  'new_posts', (select count(*) from public.posts where deleted_at is null and (created_at at time zone 'Asia/Seoul')::date > (now() at time zone 'Asia/Seoul')::date - 7),
  'published', (select count(*) from public.posts where deleted_at is null and stage in ('published','collecting','analyzed') and published_on > (now() at time zone 'Asia/Seoul')::date - 7),
  'spread', (select count(*) from public.post_channels pc join public.posts p on p.id = pc.post_id where p.deleted_at is null and pc.posted_on > (now() at time zone 'Asia/Seoul')::date - 7),
  'terms', (select count(*) from public.search_terms st join public.posts p on p.id = st.post_id where p.deleted_at is null and (st.created_at at time zone 'Asia/Seoul')::date > (now() at time zone 'Asia/Seoul')::date - 7),
  'metrics', (select jsonb_build_object('rows', count(*), 'views', sum(views), 'clicks', sum(clicks), 'revenue_est', sum(revenue_est)) from public.metrics where period_start >= (now() at time zone 'Asia/Seoul')::date - 6 and period_end <= (now() at time zone 'Asia/Seoul')::date),
  'metrics_partial', (select count(*) from public.metrics where period_end >= (now() at time zone 'Asia/Seoul')::date - 6 and period_start <= (now() at time zone 'Asia/Seoul')::date and not (period_start >= (now() at time zone 'Asia/Seoul')::date - 6 and period_end <= (now() at time zone 'Asia/Seoul')::date)),
  'programs_in_use', (select count(*) from public.programs where active and my_status = '사용 중')
) as week;

## 정리 규칙
- 숫자는 읽은 그대로. sum 이 null 이면 '데이터 없음'이라고 써 (0이라고 하지 마). metrics 는 그 7일 안에 다 들어가는 실적만이야 — metrics_partial 이 1 이상이면 "기간이 더 긴 실적 n줄은 뺐어"를 덧붙여.
- 막힌 곳 하나를 골라 다음 주에 할 일 한 줄로: ctx.backlog >= ctx.limit 이면 "검수·게시부터 (쌓인 원고 n/한도 m — 자동 작가 멈춤)", 게시 0이면 "1편이라도 게시", 게시는 있는데 spread 0이면 "다른 채널에 올리기", metrics.rows 0이면 "7일 지난 글에 실적·유입 검색어 넣기", 그 밖이면 "앱 홈 '개선 루프'에서 고칠 것 1개".
- programs_in_use 가 0이면 "수익 모델이 모두 미가입이라 수익이 안 잡혀"를 덧붙여.

## 알리기
- PushNotification 도구가 있으면 status "proactive"로 3줄 이내: "글공장 지난 7일: 새 원고 n · 게시 n · 다른 채널 n · 실적 rows줄(조회 x · 클릭 y · 발생 z원) / 다음 주: <할 일 한 줄>".
- SendUserMessage 도구가 있으면 같은 내용을 한국어 반말로 조금 더 자세히 (앱 주소 https://sanghwa771004.github.io/blog-factory/ 홈의 '최근 7일 정리'를 보라고).
- 둘 다 없으면 마지막에 같은 3줄만 적고 끝내.
---
