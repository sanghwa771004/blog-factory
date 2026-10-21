# 글공장 1.2.0 이미지 스튜디오 — 완료 보고서 (2026-10-22)

「글공장 1.1.2 이미지 스튜디오 추가 개발 지시서」 12장 '제출' 9개 항목 순서대로 정리했어.

- 대상: 1.1.2(저장소 `812e10c`) → **1.2.0**. 기존 글공장을 다시 만들지 않고 실제 코드에 더했어 (기존 표·기능은 그대로, 새 마이그레이션 012만 더함).
- 지금 상태: <!--DEPLOY_STATUS-->
- 자세한 안내: 키·비용 한도·사용법 `docs/image-studio.md` · 보안 `docs/security.md` '1.2.0' · 테스트 `docs/testing-1.2.0.md` · 실서버 점검 방법 `tests/live/README.md` 7번

---

## 1. 수정된 프로젝트 전체 ZIP
`글공장-1.2.0-프로젝트-2026-10-22.zip` — 저장소 그대로 묶음 (접속 코드·키·서버 키·사용자 원고 없음, 묶은 뒤 다시 검사함).

## 2. 변경 파일 목록 (1.1.2 → 1.2.0)
| 파일 | 구분 | 내용 |
|---|---|---|
| `studio.js` | 새 파일 | 이미지 스튜디오 화면 전부: 원고의 '이미지' 칸(사진 자리 목록·상태·버튼), AI 만들기 창(용도·비율·스타일·설명·품질·예상 비용·한도·위험 요청 잠금·진행 상황·결과·실패 이유), 실제 사진 찾기(Pexels), 파일 올리기, 보관함에서 고르기, 미리보기·자르기(초점)·검수·대체 텍스트, 내려받기(아이폰 공유 창·PC 파일·ZIP), 카드뉴스 편집, 이미지 보관함, 설정 > 이미지, 수익 탭 이미지 비용 |
| `cards.js` | 새 파일 | 카드뉴스를 캔버스에 직접 그림 (템플릿 3개·4:5/1:1·아이콘·배경 사진·광고 표시) → PNG. 그리는 방식을 `RENDERERS`로 나눠서 나중에 Canva 같은 외부 렌더러를 붙일 자리만 만들어 둠 (연결은 안 함) |
| `images.js` | 새 파일 (앱·서버 같은 파일) | 사진 자리 찾기·연결 맞추기(원고를 고쳐도 연결 유지), 용도·비율·크기, 프롬프트 만들기(지울 수 없는 안전 규칙), 위험 요청 검사, 예상 비용·사용량 비용, 파일 형식 검사·숨은 정보 지우기, 출처 문구·대체 텍스트·파일 이름, 이미지 발행 전 검사, 카드뉴스 초안 |
| `supabase/functions/blog-app/image_service.js` | 새 파일 | OpenAI 만들기·고치기 호출, 오류 나누기(청구 여부·다시 해도 되는지·하루 횟수에 셀지), Pexels 검색·사진 정보·내려받기(허용 주소만), 저장 흐름(AI·실제 사진·직접 올리기) |
| `supabase/functions/blog-app/images.js` | 새 파일 | `images.js` 사본 (테스트가 똑같은지 확인) |
| `supabase/functions/blog-app/index.ts` | 고침 | 이미지 API 17개 경로, 키는 Secrets에서만, 생성 한도·중복·동시 실행 막기, 서버 일꾼 시간 보호, 서명 주소, 원고를 고치면 사진 자리 연결 맞추기, 백업에 새 표, 통계에 이미지 비용(따로), 설정에 이미지 항목 |
| `supabase/migrations/012_image_studio.sql` | 새 파일 | 아래 3번 |
| `app.js` | 고침 | 이미지 칸·카드뉴스·보관함 화면 연결, 원고 목록에 사진 연결 수, 발행 전 검사에 이미지 검사, 복사(HTML·글자)에 사진 파일 이름·설명, 설정·수익·사용 방법에 이미지 항목 |
| `lib.js` | 고침 | 미리보기·내보내기에 연결된 사진 표시(주소는 내보내지 않음), ZIP 만들기 |
| `checks.js` (+ 서버 사본) | 고침 | 사진 자리 줄 표시, 사진 자리 안내 문구 |
| `app.css` | 고침 | 이미지 칸·칩·미리보기·자르기·진행 표시·카드뉴스 화면 (가로 넘침 없음, 어두운 화면) |
| `index.html` | 고침 | 보안 정책(CSP)에 Supabase 서명 주소·Pexels 사진·blob 허용, 캐시 주소 1.2.0 |
| `version.json`, `tools/bump-version.mjs` | 고침 | 1.2.0, 새 파일들도 버전 주소 바꾸기 |
| `README.md`, `.env.example`, `docs/security.md`, `tests/live/README.md` | 고침 | 구조·Secrets 이름(빈 값)·보안 항목·실서버 점검 방법 |
| `docs/image-studio.md`, `docs/REPORT-1.2.0.md`, `docs/testing-1.2.0.md` | 새 파일 | 안내·보고서·테스트 결과 |
| `tests/images.test.js`, `tests/image_service.test.js`, `tests/sql_images.test.js`, `tests/security_static.test.js`, `tests/fixtures/img/*` | 새 파일 | 아래 7번 |
| `tests/lib.test.js`, `tests/ui/app_ui_test.py` | 고침 | 이미지 내보내기·ZIP 테스트, 화면 테스트 11개 추가 |

안 바꾼 것: `claude-artifact/blog-factory.html`(Claude 안 글공장 버전 6), 자동 작가 예약 작업 지시문, 기존 마이그레이션 001~011.

## 3. 데이터베이스 마이그레이션 — `supabase/migrations/012_image_studio.sql`
표를 지우거나 다시 만들지 않고 더하기만 해 (몇 번 다시 돌려도 같은 결과).
| 더한 것 | 내용 |
|---|---|
| `post_images` | 이미지 보관함 (정보만 — 파일은 Storage): 처음 만든 원고·자리, 종류(ai·stock·upload·card), 공급자·모델, 보낸 프롬프트·사용자 설명, 스타일·용도, 설명·대체 텍스트, 저장 경로, 형식·크기·가로세로·SHA-256, 원본 출처 주소·사진가·라이선스·출처 문구, 권한 확인, 검수 상태·메모, 생성 기록 번호, 내려받은 때, 지운 때 |
| `post_image_slots` | 원고의 사진 자리 ↔ 이미지 연결 (같은 이미지를 여러 자리·여러 원고에), 순서·설명·용도·자르기 초점·내려받음·사용 완료 |
| `image_generations` | AI 요청 한 번 = 한 줄: 요청 번호(중복 막기), 원고·자리, 모델·크기·품질·형식, 프롬프트, 상태, OpenAI까지 갔는지, OpenAI 요청 번호, 오류, **예상 USD · 사용량 기준 USD · 확인한 청구액 USD · 비용 확인 상태 · 환율·기준일·출처** |
| `post_card_decks` | 카드뉴스 문구·템플릿·비율·배경·광고 표시 |
| `api_calls` | Pexels 호출 기록 (시간당·월 한도 보호) |
| `settings` 열 | 만들기·고치기 모델 이름, 품질, 하루 한도(5), 한 달 예산(2달러), 환율·기준일·출처, 가격표 |
| 함수 9개 | 생성 시작(같은 요청 한 번만·동시에 하나·하루 한도·예산을 잠금 안에서 검사, 4분 넘게 멈춘 건 '확인 필요'로 정리) / 저장(보관함+연결+생성 기록을 한 번에) / 실패 기록 / 자리 연결·맞바꾸기·옮기기 / 안전 삭제(쓰는 중이면 거절) / 이미지 비용 통계 / 지금 사용량 |
| 잠금 | 새 표 모두 RLS 켜짐·정책 없음·anon/authenticated 권한 회수, 함수는 `search_path = ''`·서버만 실행 |
| Storage | 비공개 버킷 `post-images` (10MB, JPEG·PNG·WebP만, 정책 없음) |

## 4. 필요한 Supabase Secrets 변수명
| 이름 | 용도 | 없으면 |
|---|---|---|
| `OPENAI_API_KEY` | AI 이미지 만들기·고치기 | AI만 '키 없음'으로 잠김 |
| `PEXELS_API_KEY` | 실제 사진 검색 | 사진 검색만 잠기고 직접 올리기로 안내 |
| `EDGE_WALL_SECONDS` (선택) | 서버 일꾼 최대 시간(초) | 150 (무료 요금제). 유료 요금제면 400 |
기존 `SUPABASE_URL`·서버 키는 Supabase가 자동으로 넣어줌. `ALLOWED_ORIGINS`는 그대로.

## 5. API 키 발급 및 설정 방법
자세히는 `docs/image-studio.md` 3장. 요약:
1. **OpenAI**: https://platform.openai.com/api-keys → Create new secret key → 복사. 크레딧 필요, GPT Image 모델은 조직 인증이 필요할 수 있음. OpenAI Limits에서 한 달 hard limit도 걸어두기.
2. **Pexels**: 2026-10-22 확인 — Pexels API 페이지에 "New API key issuance is currently paused and cannot be requested." → 지금은 새 키를 못 받을 수 있어. 다시 열리면 https://www.pexels.com/api/ → Get Started.
3. **Supabase에 넣기**: https://supabase.com/dashboard/project/oxewhsqmdkiasckvnyua/functions/secrets → 이름 그대로 넣고 Save (다시 배포 필요 없음) → 앱 설정 > 이미지에서 '키 연결됨' 확인.
키는 채팅·앱 화면·GitHub·메모에 붙여넣지 마.

## 6. 비용 제한 설정 방법
앱 **설정 > 이미지 (AI·사진·비용 한도)** — 자세히는 `docs/image-studio.md` 4장.
- 하루 생성 한도 기본 5장(0~50, 0이면 끔), 한 달 예산 기본 2달러(0~500), 품질 기본 보통, 모델 이름 2개, 환율(기준일·출처), 가격표.
- 이번 달 쓴 돈 + 이번 예상 비용이 예산을 넘으면 만들기 전에 막아. 하루 한도는 OpenAI까지 간 요청만 셈.
- 마지막 안전장치로 OpenAI Limits의 hard spend limit을 같이 쓰기를 권장.
- 예상 비용(보통 품질): 장당 약 0.010~0.015달러. 예상 비용과 실제 청구액은 다를 수 있어서 '예상 / 사용량 기준 / 청구액 확인 / 청구 없음 / 확인 필요'로 나눠 보여줘.

## 7. 기능 테스트 결과
<!--TEST_RESULTS-->

## 8. 실제 API 연동 여부
| 대상 | 코드 | 실제 호출 테스트 |
|---|---|---|
| OpenAI 이미지 (`/v1/images/generations`, `/v1/images/edits`) | 공식 문서 형식대로 구현 (모델·크기·품질·형식·1장·moderation·safety_identifier, 사용량·오류 처리) | **미실행** — API 키가 없어서. 가짜 응답(공식 문서 모양)으로 형식·오류·저장 흐름만 확인 |
| Pexels (`/v1/search`, `/v1/photos/:id`) | 공식 문서 형식대로 구현 (Authorization 머리글, 방향·언어, 받은 주소 그대로, 출처 표시) | **미실행** — 키 없음 (지금 Pexels가 새 키 발급을 멈춤) |
| Supabase Storage (비공개 버킷·서명 주소) | 구현 | <!--STORAGE_LIVE--> |
| Canva | 연결 안 함 (지시서대로 자체 템플릿 우선, 렌더러 자리만 나눠 둠) | — |
| 네이버 블로그·티스토리 이미지 자동 올리기 | 만들지 않음 (공식 API·권한이 확인되지 않음) | — |

## 9. 아직 수동으로 해야 하는 작업
<!--MANUAL_TASKS-->

## 알려진 한계
- 실제 청구액은 OpenAI에서 자동으로 가져올 방법이 없어서, 앱이 아는 건 예상·사용량 기준까지야. 청구액은 OpenAI 사용량 화면에서 보고 직접 넣어야 '청구액 확인'이 돼.
- Supabase 무료 요금제 서버 함수는 한 번에 150초까지라, OpenAI가 아주 오래 걸리면(2분 넘게) 결과를 못 받고 '확인 필요'로 끝날 수 있어. 일꾼 남은 시간이 부족하면 돈이 나가기 전에 '서버가 바빠'로 다시 보내게 해뒀어.
- AI 이미지는 '예시 삽화'야. 실제 상품 비교 글에는 허용된 실제 사진을 직접 올려야 해 (앱이 그 자리에 실제 사진 필요를 표시함).
- 카드뉴스 글꼴은 Google Fonts에서 받아. 인터넷이 안 되면 기본 글꼴로 그려져.
- 저장 공간은 무료 요금제 1GB (앱은 900MB에서 멈춤).
