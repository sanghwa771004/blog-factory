# 성과 데이터 구조 점검 (1.3.1, 2026-10-26)

글공장이 '게시 → 실적 → 다음 글'로 이어지려면 어떤 데이터가 있어야 하는지, **지금 실제로 들어오는 것**과 **아직 없는 것**을 나눠서 정리했어. 이번 작업에서는 구조만 확인했고 새 연결(API·수집)은 만들지 않았어.

## 1. 지금 실제로 들어오는 데이터
모두 앱에서 사용자가 넣거나, 사용자가 받은 리포트 파일을 올린 것이야. 외부 서비스에서 자동으로 가져오는 건 없어.

| 필요한 것 | 저장 위치 | 들어오는 방법 | 비고 |
|---|---|---|---|
| 게시 날짜 | `posts.published_on` (실제 게시일), `posts.publish_date` (예정일) | 게시 완료 기록 때 사용자가 넣음 / 예정일은 앱이 빈 날에 잡음 | 주력 주제 비율은 게시일 → 예정일 → 만든 날 순서로 '최근'을 정함 |
| 채널 | `posts.channel_id`, `metrics.channel_id`, `links.channel_id` | 원고 요청·링크·파일 올리기 | 네이버 블로그·티스토리·사이트·SNS 구분 가능 |
| 원고별 키워드·주제 | `posts.keyword`, `posts.titles`, `posts.category`, `posts.content_type`, `settings.focus_topic`·`focus_terms` | 원고 요청·자동 작가 | 주력 주제 판정은 저장하지 않고 화면에서 매번 계산 (근거 표시) |
| 조회수·노출수·클릭수 | `metrics.views`·`impressions`·`clicks` | 직접 입력, CSV·엑셀 파일 | 빈 칸은 `null`(데이터 없음), 0과 구분 |
| 주문·수익·비용 | `metrics.orders`·`cancels`·`revenue_est`(발생)·`revenue_confirmed`(확정)·`revenue_paid`(지급)·`cost` | 직접 입력, 파일 | 발생·확정·지급을 따로 저장 |
| 이미지 생성 비용 | `image_generations.est_usd`(예상)·`usage_usd`(사용량 기준)·`actual_usd`(청구액 확인)·`actual_checked_at`·`cost_status` | 생성할 때 서버가 기록, 청구액은 사용자가 확인해서 넣음 | 수익 통계와 따로 셈 (무료 모델은 '청구 없음') |
| 데이터 출처 | `metrics.source`(`manual`·`csv`)·`source_label`·`import_id` → `imports.filename`·`created_at` | 입력·파일 올리기 | `source`에 `api` 값이 허용돼 있지만 **연결된 API는 없음** |
| 마지막 확인일 | `links.checked_at`, `products.price_checked_at`·`info_checked_at`, `programs.policy_checked_at`, `program_channels.checked_at`, `image_generations.actual_checked_at` | 사용자가 확인한 날 | 실적(`metrics`)은 입력한 때(`created_at`)와 실적 기간(`period_start`~`period_end`)만 있고 따로 '확인일' 칸은 없음 |
| 이미지 출처 | `post_images.kind` + `source_type`(1.3.1) | 만든 방법 + 사용자가 고른 출처 | 예전 업로드는 '출처 확인 필요' |

## 2. 0으로 꾸미지 않는 곳 (확인함)
- 파일 올리기: 빈 칸·`-`는 `null` (`lib.js parseNum`) — 테스트 있음
- 통계: 기록이 하나도 없는 항목은 '데이터 없음' (`lib.js val` → `null`), 실제 0은 0
- 주력 주제 비율: 게시한 글이 없으면 '데이터 없음' (1.3.1에서 고침 — 전에는 초안까지 셌음)
- 순수익: 비용을 한 번도 안 넣었으면 비용 0원으로 계산하되 화면에 '비용 입력 없음 — 0원으로 계산'을 같이 보여줌 (기존 그대로, 숨기지 않음)
- 주제 점수: 검색량·경쟁도는 조회하지 않아서, 실측이 없으면 점수 옆에 'AI 추정'을 붙임 (1.3.1)

## 3. 연결되지 않은 것 (연결된 것처럼 만들지 않음)
- 네이버 블로그 통계·검색 유입 키워드·서치어드바이저: 공식 API 연결 없음 → 직접 입력만
- 쿠팡 파트너스 리포트 API: 파트너스 최종 승인 뒤 공식 API로 붙일 예정 (할 일 목록 '쿠팡 리포트 API로 실적 자동 가져오기')
- 토스 쉐어링크·네이버 쇼핑 커넥트 실적: 파일·직접 입력
- 검색량·경쟁도: 조회 안 함
- 외부 사이트를 긁어오는 수집, 약관을 우회하는 수집은 넣지 않음

## 4. 다음 단계에 필요한 것 (이번엔 만들지 않음 — 따로 작업)
1. 실적 행의 '확인일'과 '어디서 본 숫자인지'(블로그 통계 화면 / 리포트 파일 / 제휴사 화면) 칸
2. 검색 유입 키워드 입력 (네이버 블로그 통계에서 옮겨 적는 방식부터) — 키워드별로 다음 글을 고르려면 필요
3. 원고별 주력 주제 판정 기록 (지금은 화면 계산뿐이라 시간에 따른 변화를 못 봄)
4. 채널별 노출수 화면 정리 (`metrics.channel_id`로 저장은 이미 되고, 화면에서 네이버 블로그·티스토리·사이트를 나눠 보여주는 부분이 필요)
5. 쿠팡 리포트 API (승인 후)
