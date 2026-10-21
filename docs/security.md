# 보안 점검 (1.1.2, 2026-10-21)

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

## 실서버 점검 결과 (2026-10-21, 임시 점검 세션으로 실행 후 로그아웃·정리)
- 로그인 없이 `/state` → 401, 가짜 세션 → 401, 틀린 코드 로그인 → 401
- 로그아웃한 세션으로 읽기·고치기·지우기·백업 → 모두 401 (원고는 안 바뀜)
- `javascript:` 주소 링크, 없는 날짜(2026-13-45), 음수 클릭, 빈 실적 → 400
- 애매한 고지문 저장 → 400 `vague_disclosure` (저장 안 됨)
- (1.1.2, 별도 임시 세션) 발행 전 검사에 걸리는 '발행 준비 완료' 원고를 예약·게시 완료로 바꾸기 → 409 `check_failed` (상태 안 바뀜) — 결과는 `docs/testing-2026-10-21.md` '1.1.2 실서버 점검'
- 고지문이 비었거나 애매하면 앱이 복사 버튼을 안 보여줌 (화면 테스트, 1.1.2)
