# 글공장

블로그·SNS 원고를 주제 고르기부터 실적 정리까지 한 흐름으로 관리하는 웹 앱이야. 휴대폰 홈 화면에 추가해서 써.

주제 고르기 → 원고 요청 → 자동 작가가 조사·작성 → 내가 검수 → 발행 전 검사 통과 → 직접 게시하고 주소 기록 → 실적 입력·파일 올리기 → 다음 주제 추천

- **홈**: 오늘 할 일(검수·링크 빠짐·출처 빠짐·실패), 발행 예정, 이번 달 발생·확정·지급 수익, 규칙 기반 추천
- **콘텐츠**: 상태별 원고 목록, 새 원고 요청(채널·수익 모델·글 유형·경험), 원고 상세(단계 표시, 발행 전 검사, 복사, 제휴 링크·상품·출처 관리, 채널별 버전, 게시 기록, 실적)
- **주제**: AI 주제 추천(근거·신뢰도 포함), 점수 가중치, 채택·보류·제외
- **수익**: 기간별 요약(데이터 없음과 0 구분), 글·채널·수익 모델·카테고리별, 직접 입력, CSV·엑셀 올리기(미리보기·열 맞추기·중복 건너뛰기·올리기 취소)
- **설정**: 자동 글쓰기, 수익 모델·채널 정책 정보, 조합표, 상품, 기기·접속 코드, 백업, 휴지통, 사용 방법

앱은 블로그에 **대신 게시하지 않아**. 네이버 블로그·티스토리는 글쓰기 API가 없어서 복사해서 붙여넣는 방식이야. 제휴사 실적도 **자동으로 가져오지 않아** (직접 입력이나 파일).

## 구조

| 부분 | 위치 |
|---|---|
| 앱 화면 | `index.html`, `app.css`, `app.js` (GitHub Pages) |
| 원고 규칙(발행 전 검사) | `checks.js` — 앱과 서버가 같은 파일을 씀 |
| 계산 도구(내보내기·CSV·엑셀·통계·추천) | `lib.js` |
| 서버 API | `supabase/functions/blog-app` (Supabase Edge Function, `index.ts` + `checks.js`) |
| DB 변경 기록 | `supabase/migrations/001~010` (표를 지우거나 새로 만들지 않고 더하기만) |
| 자동 작가 지시문 | `docs/auto-writer-prompt.md` (Claude 예약 작업, 하루 세 번) |
| 정책 조사 | `docs/policy-research-2026-10-21.md` |
| 점검 보고서 | `docs/audit-2026-10-21.md` |
| 보안 점검 | `docs/security.md` |
| 테스트 결과 | `docs/testing-2026-10-21.md` |
| 백업·복구 | `docs/backup-restore.md` |

데이터와 접속 코드는 이 저장소에 없어. 환경변수는 `.env.example` 참고.

## 테스트

```bash
npm install                           # 처음 한 번 (DB 테스트용 PGlite)
npm test                              # 규칙·계산 + DB(마이그레이션·함수) 테스트 (Node 20+)
python3 tests/ui/app_ui_test.py /tmp  # 휴대폰 크기 화면 테스트 (Playwright, 모의 서버)
```

실서버 점검 방법은 `tests/live/README.md`에 있어 (진짜 접속 코드 없이 임시 세션으로).

## 업데이트하는 법

1. `node tools/bump-version.mjs 1.1.2 "바뀐 점 한 줄"` — 앱 버전·캐시 주소·version.json을 한 번에 바꿈
2. 커밋하고 `main`과 `gh-pages` 둘 다 푸시 (`git push origin main main:gh-pages`)
3. 1~2분 뒤 GitHub Pages에 반영되고, 앱을 다시 열면 자동으로 새 버전이 떠

서버를 바꿨으면 `supabase/functions/blog-app/index.ts`와 저장소의 `checks.js`를 같이 Edge Function으로 올려줘 (`verify_jwt` 끔 — 자체 로그인 사용).
아이콘은 `python3 tools/make_icons.py .`로 다시 만들 수 있어.
