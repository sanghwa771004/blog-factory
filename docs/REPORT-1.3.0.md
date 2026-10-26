# 글공장 1.3.0 검색 노출 도우미 — 완료 보고서 (2026-10-26)

- 요청: "네이버에서 안 걸러지고 상단에 노출되는 방법을 다 넣어줘"
- 대상: 1.2.2(`f18f914`) → **1.3.0(`f1e9e0c`)**. 기존 코드에 더했고, DB는 열 하나만 더함(014).
- 지금 상태: **실서버 배포 완료.** 본 서버(`blog-app` v16)·이미지 생성 서버(`blog-gen` v8) 둘 다 1.3.0, 앱 화면(`gh-pages`) 1.3.0, DB 014 적용, 자동 작가 예약 작업 프롬프트 1.3.0, Claude 안 글공장 7.
- 기능 설명·근거: `docs/seo-helper.md` · 자동 작가 프롬프트: `docs/auto-writer-prompt.md`

## 1. 무엇을 넣었나

검사는 모두 **경고·확인할 것**이고 발행을 막지 않아. 검색 노출 검사는 블로그·웹사이트 채널 글에만 해.

| 방법 | 구현 | 파일 |
|---|---|---|
| 주제 하나를 깊게 | 설정 `focus_topic`(60자). 주제 밖 글 `off_focus` 경고, 홈에 최근 30개 중 비율(목표 70%), 자동 작가·주제 추천은 그 안에서만 | `014_focus_topic.sql`, `index.ts`, `checks.js`, `lib.js focusShare`, `app.js` |
| 경쟁 적은 3~5단어 키워드 | 1~2단어 키워드 `short_keyword` 경고, 자동 작가·주제 추천은 3~5어절 | `checks.js keywordWords`, 프롬프트 |
| 시즌 2~4주 앞 | 오늘+14일·+28일 달의 시즌 주제(앱에 적어 둔 달력) + 버튼으로 주제 추천 요청(hint에 시즌) | `lib.js SEASON_CALENDAR·seasonAhead`, `app.js seoPanel` |
| 하루 1편 | 지난 7일~다음 7일에 하루 2편 이상 잡힌 날 표시, 설정 안내 | `lib.js crowdedDays`, `app.js` |
| 내 경험 한 줄 | 자동 작가가 블로그 글 첫 부분에 `[내 경험: …]` 1곳(빈 칸은 기존 규칙대로 '발행 준비 완료'를 막음). 경험이 없으면 `no_own_experience` 경고. '내 경험 채우기'로 넣으면 원고의 경험 칸에도 기록 | `checks.js`, `app.js`, 프롬프트 |
| 직접 찍은 사진 한 장 | 자동 작가가 사진 자리 1곳을 `[이미지: (직접 찍기) …]`로 표시. 스튜디오는 그 자리에서 '파일 올리기'를 먼저, AI로 만들려면 체크(서버도 같은 검사). 연결한 이미지 중 직접 올린 사진이 없으면 `no_own_photo`, 그 자리에 AI 이미지면 `ai_in_own_slot`. 표시는 검색어·대체 텍스트·AI 프롬프트에서 뺌 | `images.js isOwnPhotoSlot·stripOwnMark·imageChecks`, `studio.js` |
| AI 이미지 표시 | AI 이미지가 있으면 네이버 'AI 활용' 표시 안내(`ai_label`, 블로그는 지금 자율) | `images.js` |
| 링크 중간 1개·끝 1개 | 3개 이상 `too_many_links`, 첫 소제목 앞(또는 글 앞 15%) `link_too_early` | `checks.js linkTooEarly` |
| 쇼핑 커넥트 | 미가입이면 홈에 공식 소개 링크 | `app.js` |
| AI 말투 줄이기 | 자동 작가·Claude 안 글공장 규칙 15번(틀에 박힌 말 피하기) | 프롬프트 |

## 2. 변경 파일 (f18f914 → f1e9e0c, 23개)
- 새 파일: `supabase/migrations/014_focus_topic.sql`, `docs/seo-helper.md`
- 앱: `app.js`(홈 '검색 노출 도우미', 설정 '주력 주제', 검사에 주력 주제 넘김, 경험 채우기 기록), `app.css`(.seo), `lib.js`, `studio.js`, `index.html`·`version.json`(버전)
- 앱·서버 같은 파일: `checks.js`, `images.js` (+ `supabase/functions/blog-app/` 사본)
- 서버: `supabase/functions/blog-app/index.ts`(설정 저장에 `focus_topic`, VERSION 1.3.0)
- 자동 작가: `docs/auto-writer-prompt.md`(1.3.0 — 예약 작업 '글공장 자동 글쓰기'에 같은 내용 반영)
- Claude 안 글공장: `claude-artifact/blog-factory.html`(7 — 원고·주제 프롬프트, 주력 주제를 카테고리 후보 맨 앞에)
- 테스트: `tests/checks.test.js`, `tests/images.test.js`, `tests/lib.test.js`, `tests/sql.test.js`, `tests/sql_images.test.js`, `tests/artifact.test.js`, `tests/ui/app_ui_test.py`

## 3. DB 014
```sql
alter table public.settings add column if not exists focus_topic text not null default '';
-- 검사 settings_focus_topic_len: length(focus_topic) <= 60 (없을 때만 추가)
```
표·데이터는 그대로. `writer_context()`는 설정 전체를 보내서 자동으로 들어감. 다시 돌려도 오류 없음(테스트로 확인).

## 4. 실제로 돌린 테스트 (2026-10-26)
| 무엇 | 결과 |
|---|---|
| `npm test` (규칙·계산·DB 001~014·Claude 안 글공장 계산) | 248개 통과 |
| `python3 tests/ui/app_ui_test.py` (휴대폰 크기 화면, 모의 서버) | 28/28 통과 — 새 시험: 주력 주제 정하기·비율, 내 경험 없는 글, 시즌 주제 추천 요청 |
| `python3 tests/artifact/run_check.py` (Claude 안 글공장 화면·흐름) | 42/42 통과 |
| `deno check` (서버 코드 형식 검사) | 통과 |
| 실서버 `/ping` | blog-app 1.3.0, blog-gen 1.3.0 |
| 실서버 설정 저장·불러오기 (임시 세션, 끝나고 로그아웃) | `focus_topic` 저장·`/state`에 나옴, 70자는 60자로 잘림 |
| 앱 화면 `version.json`·`app.js`·`checks.js` | 1.3.0, 새 기능 들어 있음 |

실서버 점검 중에 긴 시험 값(60자)이 주력 주제에 몇 초 저장됐다가 바로 '계절템·겨울 가전'으로 되돌렸어 (그 사이 자동 작가 실행 없음).

## 5. 솔직한 한계
- 70%·3~5단어·링크 2개·앞 15%는 **앱이 정한 기준**이야 (네이버가 숫자로 밝힌 기준 아님).
- 시즌 달력은 달별로 적어 둔 주제야. 실제 검색량을 조회하지 않아.
- 앱은 사진을 누가 찍었는지 몰라서 '파일 올리기'로 올린 사진을 직접 찍은 사진으로 셈.
- 주력 주제와 맞는지는 낱말 겹침·앞부분 일치로 봐 (예: '겨울철' ↔ '겨울'은 맞음, '난방'만 있는 카테고리는 '계절템·겨울 가전'과 안 맞음으로 나옴).
- 쇼핑 커넥트는 가입·공식 고지문 입력이 따로 필요해. 앱은 대신 가입하거나 링크를 바꾸지 않아.

## 6. 검토할 때 봐줬으면 하는 것
- `checks.js` 12번: 경고가 너무 많이 뜨거나(짧은 키워드·경험 없음은 지금 원고 대부분에 뜰 수 있음) 놓치는 경우
- `focusMatch` 판정 방식이 카테고리 이름 짓는 습관에 맞는지
- `linkTooEarly` 기준(첫 소제목 앞 또는 앞 15%)
- 자동 작가 프롬프트 1.3.0이 기존 규칙(써본 척 금지·가격 금지·고지문은 앱이 붙임)과 부딪히지 않는지

## 7. 보안
- 접속 코드·해시·API 키·서버 키·임시 세션 토큰·사용자 원고는 저장소와 ZIP에 없음 (묶은 뒤 다시 검사).
- 자동 작가 프롬프트의 쓰기 제한(함수 호출만, delete/drop/truncate/alter 직접 사용 금지) 그대로.
