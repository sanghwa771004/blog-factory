# 글공장

블로그·SNS 원고를 주제 고르기부터 실적 정리까지 한 흐름으로 관리하는 웹 앱이야. 휴대폰 홈 화면에 추가해서 써.

주제 고르기 → 원고 요청 → 자동 작가가 조사·작성 → 내가 검수 → 발행 전 검사 통과 → 직접 게시하고 주소 기록 → 실적 입력·파일 올리기 → 다음 주제 추천

- **홈**: 오늘 할 일(검수·링크 빠짐·출처 빠짐·실패), 발행 예정, 이번 달 발생·확정·지급 수익, 규칙 기반 추천
- **콘텐츠**: 상태별 원고 목록, 새 원고 요청(채널·수익 모델·글 유형·경험), 원고 상세(단계 표시, 발행 전 검사, 복사, 제휴 링크·상품·출처 관리, 채널별 버전, 게시 기록, 실적)
- **주제**: AI 주제 추천(근거·신뢰도 포함), 점수 가중치, 채택·보류·제외
- **수익**: 기간별 요약(데이터 없음과 0 구분), 글·채널·수익 모델·카테고리별, 직접 입력, CSV·엑셀 올리기(미리보기·열 맞추기·중복 건너뛰기·고친 리포트는 새 숫자로 바꾸기·올리기 취소)
- **설정**: 자동 글쓰기, 수익 모델·채널 정책 정보, 조합표, 상품, 기기·접속 코드, 백업, 휴지통, 사용 방법
- **검색 노출 점검 (1.3.0, 1.3.1에서 정확성 수정)**: 홈에 최근 **게시한** 글 기준 주력 주제 비율(없으면 '데이터 없음')·하루 발행 설정과 권장 기준·몰린 날·내 경험/직접 촬영 사진/사진 출처가 빠진 글·2~4주 뒤 시즌 주제 추천을 '앱 권장 기준·내 기록·실측 데이터 없음'으로 구분해 보여줌. 원고 검사는 주력 주제를 키워드·제목 근거로 판정(카테고리만으로는 통과 안 함, 근거 표시, '판단 어려움'), 짧은 키워드·링크 개수/위치·경험 없음은 알려만 줌. 직접 올린 사진은 출처를 골라야 '직접 촬영'으로 셈 — `docs/seo-helper.md`
- **이미지 스튜디오 (1.2.0)**: 원고의 `[이미지: 설명]` 자리마다 AI 이미지 만들기(기본 무료 — Cloudflare Workers AI, OpenAI는 선택)·실제 사진 찾기(Pexels)·파일 올리기 → 미리보기·자르기 → 검수 → 내려받기, 카드뉴스 PNG, 이미지 보관함, 생성 비용(수익 통계와 따로) — 설정·키·비용 한도는 `docs/image-studio.md`

앱은 블로그에 **대신 게시하지 않아** (이미지도 직접 올려). 네이버 블로그·티스토리는 글쓰기 API가 없어서 복사해서 붙여넣는 방식이야. 제휴사 실적도 **자동으로 가져오지 않아** (직접 입력이나 파일).

## 구조

| 부분 | 위치 |
|---|---|
| 앱 화면 | `index.html`, `app.css`, `app.js` (GitHub Pages) |
| 원고 규칙(발행 전 검사) | `checks.js` — 앱과 서버가 같은 파일을 씀 |
| 계산 도구(내보내기·CSV·엑셀·통계·추천) | `lib.js` |
| 이미지 스튜디오 화면 | `studio.js` (사진 자리·만들기·찾기·올리기·미리보기·내려받기·보관함·설정·비용), `cards.js` (카드뉴스 그리기) |
| 이미지 규칙 | `images.js` — 사진 자리 찾기·용도/비율·프롬프트·위험 요청 검사·비용 계산·파일 검사. 앱과 서버가 같은 파일을 씀 |
| 서버 API | `supabase/functions/blog-app` (Supabase Edge Function, `index.ts` + `checks.js` + `images.js` + `image_service.js`) + 같은 코드를 생성 요청만 받게 올리는 `supabase/functions/blog-gen` |
| DB 변경 기록 | `supabase/migrations/001~015` (표를 지우거나 새로 만들지 않고 더하기만. 012 = 이미지 스튜디오, 013 = 하루 이미지 한도 100, 014 = 주력 주제, 015 = 사진 출처·주력 주제 낱말) |
| 이미지 스튜디오 안내 (키·비용 한도·사용법) | `docs/image-studio.md` |
| 검색 노출 점검 (무엇을 점검하고 무엇이 앱 권장 기준인지, 주력 주제 판정·사진 출처, 근거) | `docs/seo-helper.md` |
| 1.3.1 보고서 (정확성·신뢰성 — 바뀐 파일·고친 문제·실제로 돌린 테스트·남은 한계) | `docs/REPORT-1.3.1.md` |
| 성과 데이터 구조 점검 (지금 들어오는 것 / 아직 없는 것) | `docs/data-structure-1.3.1.md` |
| 1.3.0 보고서 (검색 노출 도우미 — 바뀐 파일·실제로 돌린 테스트·배포 상태) | `docs/REPORT-1.3.0.md` |
| 1.2.0 보고서·테스트 | `docs/REPORT-1.2.0.md`, `docs/testing-1.2.0.md` |
| 자동 작가 지시문 | `docs/auto-writer-prompt.md` (Claude 예약 작업, 하루 세 번) |
| Claude 안 글공장 (바로 쓰기·주제 추천·요청 바로 처리) | `claude-artifact/blog-factory.html` (claude.ai 아티팩트 원본 — 고치면 Claude에서 같은 주소로 다시 게시) |
| 최종 완료 보고서 | `docs/REPORT-2026-10-21.md` |
| 정책 조사 | `docs/policy-research-2026-10-21.md` |
| 점검 보고서 | `docs/audit-2026-10-21.md` |
| 보안 점검 | `docs/security.md` |
| 테스트 결과 | `docs/testing-2026-10-21.md` |
| 백업·복구 | `docs/backup-restore.md` |

데이터와 접속 코드는 이 저장소에 없어. 환경변수는 `.env.example` 참고.

## 테스트

```bash
npm install                           # 처음 한 번 (DB 테스트용 PGlite)
npm test                              # 규칙·계산 + DB(마이그레이션·함수) + Claude 안 글공장 계산 테스트 (Node 20+)
python3 tests/ui/app_ui_test.py /tmp  # 휴대폰 크기 화면 테스트 (Playwright, 모의 서버)
python3 tests/artifact/run_check.py /tmp  # Claude 안 글공장 화면·흐름 테스트 (모의 Claude·Supabase)
npm run test:server                   # 서버 코드를 Deno로 띄워서 가짜 DB API로 확인 (DB 015 전·후). deno 필요 (DENO=/경로/deno), 없으면 건너뜀
```

실서버 점검 방법은 `tests/live/README.md`에 있어 (진짜 접속 코드 없이 임시 세션으로).

## 업데이트하는 법

1. `node tools/bump-version.mjs 1.1.3 "바뀐 점 한 줄"` — 앱 버전·캐시 주소·서버 버전·version.json을 한 번에 바꿈
2. 커밋하고 `main`과 `gh-pages` 둘 다 푸시 (`git push origin main main:gh-pages`)
3. 1~2분 뒤 GitHub Pages에 반영되고, 앱을 다시 열면 자동으로 새 버전이 떠

서버를 바꿨으면 `supabase/functions/blog-app/`의 `index.ts`·`checks.js`·`images.js`·`image_service.js`를 같이 Edge Function **`blog-app`과 `blog-gen` 두 이름으로** 올려줘 (둘 다 `verify_jwt` 끔 — 자체 로그인 사용). `blog-gen`은 같은 코드인데 'AI 이미지 만들기' 요청만 받아서, 생성이 다른 요청과 섞이지 않는 서버 일꾼에서 시작해 ('서버 준비 중' 대기·중간에 끊김이 줄어들게). CLI로는 `supabase functions deploy blog-app --no-verify-jwt` / `supabase functions deploy blog-gen --no-verify-jwt` (`supabase/functions/blog-gen/index.ts`가 blog-app 코드를 불러옴). `blog-gen`이 없거나(404) 켜지지 못하면(5xx 등 우리 서버의 답이 아닐 때) 앱이 같은 요청 번호로 본 서버에 보내서 그대로 돼 (두 번 만들지 않음). `checks.js`·`images.js`는 저장소 맨 위 파일과 글자 하나까지 같아야 해 (테스트가 확인함).
MCP·대시보드로 올릴 때(1.2.0부터 이 방법으로 올림)는 파일 네 개를 붙여넣는 대신 한 줄짜리 `index.ts`만 올려: `import "https://raw.githubusercontent.com/sanghwa771004/blog-factory/<커밋 전체 번호>/supabase/functions/blog-app/index.ts";` — 그 커밋의 서버 코드를 배포할 때 묶어 넣고(실행 중에는 GitHub를 안 부름), `blog-app`·`blog-gen` 두 이름 모두 같은 줄. 되돌릴 때는 예전 커밋 번호로 다시 올리면 돼. 커밋은 먼저 푸시해 둬야 해.
아이콘은 `python3 tools/make_icons.py .`로 다시 만들 수 있어.
