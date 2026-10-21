# 보안 점검 (1.1.2 → 1.2.0, 2026-10-22)

| 항목 | 지금 상태 | 근거·위치 | 남은 할 일 |
|---|---|---|---|
| 주소의 `?k=` 접속 코드 | 1.1부터 앱이 열리자마자 주소에서 지우고(`history.replaceState`), 그 코드로 이 기기 세션만 받음. 접속 코드는 기기에 저장 안 함. 화면 테스트로 확인 | `app.js` boot, `tests/ui/app_ui_test.py` 1·2·11번 | 예전 링크·홈 화면 바로가기에는 코드가 남아 있을 수 있어 → **설정 > 기기·접속 코드 > 새 접속 코드 만들기** 권장 (예전 링크는 그때부터 무효) |
| 기기 저장소 | 세션 토큰(무작위 32바이트)과 화면 사본만. 접속 코드·서버 키 없음 | `app.js` login/saveCache | 공용 기기에서는 '이 기기에서 로그아웃' |
| 비밀 키 | 서버 키는 Supabase가 Edge Function 환경변수로 넣어줌. 저장소·화면·문서에 없음 (저장소 전체 검색으로 확인) | `index.ts` serviceKey, `.env.example` | — |
| 서버 검사 | 모든 쓰기를 서버에서 다시 검사: 입력 형식·길이, 채널×수익 모델 조합, 상태 이동 규칙, '발행 준비 완료'·'예약'·'게시 완료'로 갈 때마다 발행 전 검사(1.1.2), 수익 모델·채널·조합표·상품이 바뀌면 준비된 원고 다시 검사(1.1.2), 애매한 고지문 거부, 링크별 실적의 링크·글 일치 | `index.ts` (optUrl/optDate/oneOf…, assertCompat, patchPost, recheckReadyPosts, addMetric, patchProgram) | — |
| DB 접근(RLS) | `public`·`backup` 스키마 모든 표 RLS 켜짐(`backup`은 1.1.2에서 켬), 정책 없음, anon·authenticated 권한 회수 → 공개 키로는 아무것도 못 읽음. 서버 함수만 서버 키로 접근 | `001`·`005`·`011`, `tests/sql.test.js` "모든 표에 RLS" | — |
| DB 함수 | `security definer` 없이 `search_path = ''`, 외부 역할 실행 권한 회수 (실서버에서 anon·authenticated 실행 권한 없음 확인) | `006`·`007`·`009`·`011` | — |
| 입력 검증 | 주소는 `http(s)://`만, 날짜는 실제 날짜만, 숫자 범위, 본문 6만 자, 파일 5,000줄·3MB, 요청 크기 제한 | `index.ts` readJson·metricValues·createImport | — |
| 화면 보안 | CSP(외부 스크립트 금지, 서버 주소만 연결), `referrer=no-referrer`, 검색엔진 색인 금지, 본문은 글자로만 출력(HTML 실행 안 됨 — 화면 테스트 4번) | `index.html`, `lib.js` esc | — |
| 속도 제한 | 틀린 코드 15분에 같은 곳 10번·전체 100번이면 잠시 막음. 작업 대기 30개·하루 60개 제한 | `index.ts` isLimited·jobLimits | 공격자가 일부러 100번 틀리면 15분 동안 **새 로그인**이 막힐 수 있음(이미 로그인한 기기는 영향 없음) |
| CORS | 허용 주소만 (기본 GitHub Pages) — 실서버 점검에서 다른 주소는 허용 머리글이 안 붙는 것 확인 | `index.ts` corsFor | 주소를 바꾸면 `ALLOWED_ORIGINS` 환경변수 |
| 로그 | 서버 오류 로그는 오류 코드와 32자 넘는 토큰 모양 문자열을 가린 메시지만 | `index.ts` handle | — |
| 삭제 | 원고는 휴지통(30일 되살리기). 실적은 직접 입력한 줄만 지울 수 있고, 파일로 올린 건 '올리기 취소'로 그 파일이 새로 넣은 줄만 지우고 그 파일이 고친 줄은 예전 숫자로 되돌림(1.1.2). 상품은 원고에 연결돼 있으면 못 지움. 자동 작가는 delete·drop·truncate·alter 금지 | `index.ts` deletePost·deleteMetric·cancelImport·deleteProduct, `011` import_cancel, 예약 작업 프롬프트 | — |
| 백업 | 앱에서 전체 백업(JSON) 내려받기 — 1.1.2부터 1,000줄씩 나눠서 끝까지 담고 표마다 줄 수(`counts`)를 적음. 1.1 직전 데이터는 서버 `backup` 스키마에 복사본 | `index.ts` getExport·fetchAll, `docs/backup-restore.md` | 무료 요금제라 자동 백업 없음 → 한 달에 한 번 받기 |
| 세션 | 기기별 토큰, 해시만 저장, 180일 안 쓰면 만료, 기기 목록에서 하나씩 로그아웃, 코드 교체 때 다른 기기 모두 로그아웃 가능 | `index.ts` authenticate·revokeSession·rotateCode | — |
| 예전 방식 로그인 | 1.0 화면용 `x-app-token`(접속 코드 원문) 로그인을 아직 받아줌. 1.1.2부터 이 방식으로 보낸 '발행 완료' 표시는 409 `update_app`으로 거부(상태 규칙·발행 전 검사를 건너뛰던 구멍) | `index.ts` authenticate·patchPost | 모든 기기가 1.1로 바뀐 뒤 꺼도 됨 (P2). 접속 코드 원문이 필요한 경로라 실서버에서는 일부러 시험하지 않음 |

## 1.2.0 이미지 스튜디오에서 더한 것 (2026-10-22)
| 항목 | 지금 상태 | 근거·위치 |
|---|---|---|
| OpenAI·Pexels 키 | Edge Function Secrets(`OPENAI_API_KEY`·`PEXELS_API_KEY`)에서 서버만 읽음. 화면에는 '있음/없음'만. 화면 파일·저장소·브라우저 저장소에 없음. 화면은 OpenAI·Pexels에 직접 연결하지 못함(CSP `connect-src`) | `index.ts` keyOpenAI·keysInfo, `tests/security_static.test.js` |
| 이미지 요청 인증 | 새 경로(`/images…`, `/stock…`, `/posts/:id/images…`, `/posts/:id/cards`) 모두 기존 세션 검사를 지나야 함 | `index.ts` ROUTES·authenticate |
| 파일 보관 | 비공개 버킷 `post-images` (public=false, storage 정책 없음 → anon·authenticated 접근 불가). 화면에는 서버가 만든 1시간 서명 주소만 | `012` 9번, `index.ts` signPaths |
| 올린 파일 검사 | 확장자 말고 파일 첫 바이트로 형식 확인(JPEG·PNG·WebP), 크기·가로세로 확인, 8MB 제한, 숨은 정보(EXIF·GPS·글 정보) 지우기, 같은 파일 중복 확인(SHA-256) | `images.js` sniffImage·checkImageFile·stripMetadata, `image_service.js` saveUploaded |
| 외부 이미지 내려받기 | 허용한 주소(`images.pexels.com`, https)만, 다른 곳으로 넘기는 주소는 안 따라감, 크기 제한 | `image_service.js` downloadImage |
| 비용·남용 | 한 번에 한 장(DB 유일 인덱스), 같은 요청 번호는 한 번만, 하루 한도·한 달 예산을 DB 함수가 잠금 안에서 검사, 자동 재시도 없음, 오래 멈춘 생성은 '확인 필요'로 정리 | `012` image_gen_begin, `index.ts` generateImage |
| DB | 새 표 5개 모두 RLS 켜짐·정책 없음·anon/authenticated 권한 회수, 새 함수 10개는 `search_path = ''`·service_role만 실행 | `012` 8번, `tests/sql_images.test.js` |
| 지우기 | 이미지는 어느 원고(휴지통 포함)·카드뉴스에서 쓰면 못 지움. 원고를 지워도 이미지는 남음. DB에서 먼저 지움 표시 후 파일 삭제 | `012` image_delete, `index.ts` deleteImage |
| 로그·오류 | OpenAI·Pexels 오류 문구에서 키처럼 생긴 글자를 가림. 생성 기록에 프롬프트는 남지만 키는 남지 않음 | `image_service.js` scrub |
| AI에 보내는 내용 | 사용자가 쓴 설명은 로고·가격(천원·만 단위 포함)·인증·순위·후기 사진·글자·연결 상품 브랜드(영문은 낱말로만)를 서버에서도 막음('없이·빼고·지운·글자나 로고 없이·no·without·-free' 같은 부정은 통과, 뒤에서 다시 넣어달라면 막음). 맥락(제목·소제목·앞뒤 문장)은 연결 상품 이름·브랜드·모델명·가격·인증 표현과 모델 번호처럼 생긴 것을 지우고 보냄. 실제 구성품·라벨·화면이 필요한 자리는 '일반 장면' 확인 없이는 거절하고, 확인하면 그 사실을 생성 기록(risk_override)에 남김 | `images.js` promptRisk·sanitizeContext·slotRisk, `index.ts` generateImage |
| 동시에 지우기·연결하기 | 연결할 때·카드뉴스 배경으로 저장할 때 이미지 줄을 잠그고(FOR SHARE) 다시 확인 → 지우는 중인 이미지에 연결·저장되지 않음 (지우기는 같은 줄을 잠그고 쓰는 곳을 셈 — 둘 중 하나만 이김) | `012` image_slot_upsert·card_deck_save·image_delete |
| 서버 일꾼 시간 | 무료 요금제 일꾼은 켜진 뒤 150초까지만 일함 → 품질별로 기다릴 시간이 남았을 때만 OpenAI를 부르고(모자라면 돈이 나가기 전에 '잠깐 뒤에'), 시간 제한은 부르기 직전에 남은 시간으로 다시 계산, 응답 본문을 읽는 동안에도 적용. 같은 요청 번호로 다시 오면 기다리게 하지 않고 그 기록을 바로 돌려줌 | `index.ts` DEADLINE·generateImage, `image_service.js` NEED_MS·busyRetryAfter·runGeneration·timed |
| 생성 전용 서버 `blog-gen` | `blog-app`과 같은 코드·같은 로그인 검사·같은 CORS. `POST /images/generate`와 `/ping`만 받고 나머지는 404. 앱은 `blog-gen`의 답이 우리 서버의 오류 코드 모양이 아니면서 404·401·403·405·5xx면(아직 없음·JWT 검사·켜지지 못함 — Supabase BOOT_ERROR 등) 로그아웃시키지 않고 같은 요청 번호로 본 서버에 다시 보냄 (서버가 같은 요청 번호를 먼저 찾아서 중복 생성 없음). 우리 서버의 401(`unauthorized`)은 그대로 로그아웃. 화면 보안 정책(CSP)은 같은 Supabase 주소라 바꿀 것 없음 | `index.ts` handle, `app.js` api, `studio.js` sendGenerate, `tests/security_static.test.js`, 화면 테스트 |

## 실서버 점검 결과 (2026-10-21, 임시 점검 세션으로 실행 후 로그아웃·정리)
- 로그인 없이 `/state` → 401, 가짜 세션 → 401, 틀린 코드 로그인 → 401
- 로그아웃한 세션으로 읽기·고치기·지우기·백업 → 모두 401 (원고는 안 바뀜)
- `javascript:` 주소 링크, 없는 날짜(2026-13-45), 음수 클릭, 빈 실적 → 400
- 애매한 고지문 저장 → 400 `vague_disclosure` (저장 안 됨)
- (1.1.2, 별도 임시 세션) 발행 전 검사에 걸리는 '발행 준비 완료' 원고를 예약·게시 완료로 바꾸기 → 409 `check_failed` (상태 안 바뀜) — 결과는 `docs/testing-2026-10-21.md` '1.1.2 실서버 점검'
- 고지문이 비었거나 애매하면 앱이 복사 버튼을 안 보여줌 (화면 테스트, 1.1.2)
