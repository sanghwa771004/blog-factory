# 실서버 점검 하는 법 (pg_net)

이 작업 환경에서는 컨테이너가 `*.supabase.co`에 직접 못 붙어서, DB 안의 `pg_net`으로 서버 API를 불러서 점검했어.
진짜 접속 코드는 쓰지 않고, **임시 점검 세션**을 만들어 쓰고 끝나면 로그아웃시켜.

## 1. 임시 세션 만들기 (SQL)
```sql
-- <임시토큰> 은 매번 새로 만든 무작위 문자열(43자 정도). 저장소·문서에 남기지 마.
insert into public.app_sessions (token_hash, label, last_used_at)
values (encode(sha256(convert_to('<임시토큰>', 'UTF8')), 'hex'), '[테스트] 실서버 점검', now());
```

## 2. 요청 보내기 → 결과 보기
```sql
select net.http_get('https://<ref>.supabase.co/functions/v1/blog-app/state',
  headers => '{"x-app-session":"<임시토큰>"}'::jsonb, timeout_milliseconds => 20000);   -- 요청 번호가 나와
select id, status_code, left(content, 300) from net._http_response where id = <요청 번호>;
```
쓰기는 `net.http_post(url, body => '{...}'::jsonb, headers => '{"Content-Type":"application/json","x-app-session":"<임시토큰>"}'::jsonb, timeout_milliseconds => 20000)`.
처음 요청은 서버가 깨어나느라 5초를 넘길 수 있어서 `timeout_milliseconds => 20000`을 꼭 넣어.

## 3. 점검 항목 (2026-10-21에 한 것)
| 요청 | 기대 결과 |
|---|---|
| `GET /ping` | 200, version |
| `GET /state` (세션 없음 / 가짜 세션) | 401 |
| `POST /login` 틀린 코드 | 401 |
| `GET /state` (임시 세션, Origin=앱 주소) | 200 + `Access-Control-Allow-Origin` 붙음 |
| `GET /ping` (Origin=다른 주소) | 허용 머리글 안 붙음 |
| `POST /posts` 애드센스×쓰레드 | 400 incompatible |
| `POST /posts` 경험 없는 실제 경험 후기 | 400 needs_experience |
| `POST /posts` mode=manual (이미 올린 글) | 200, 게시 완료 |
| `POST /posts/{검수 글}` stage=ready (빈 경험 칸·링크 없음) | 409 check_failed |
| `POST /posts/{검수 글}` stage=published (검수 → 게시 바로) | 409 bad_transition |
| `POST /posts/{글}/links` 2번 | 200, sort 0·1 |
| `POST /posts/{글}/links` url=`javascript:…` | 400 |
| `POST /metrics` 링크 고름 | 200, 수익 모델·채널이 링크에서 채워짐 |
| `POST /metrics` 다른 글의 링크 / 없는 링크 | 400 link_id |
| `POST /metrics` 숫자 없음 / 음수 / 없는 날짜 | 400 |
| `POST /imports` 같은 줄 두 번 | 처음 ok 2, 두 번째 ok 0 · dup 3 |
| `GET /stats` | 빈 칸은 n=0 (데이터 없음), 0은 0 |
| `POST /imports/{id}/cancel` | 그 파일 줄만 지워짐 |
| `POST /programs/cpa` 애매한 고지문 | 400 vague_disclosure |
| `POST /logout` 뒤 읽기·고치기·지우기·백업 | 모두 401 |

## 4. 정리
```sql
-- 세션은 /logout 으로 끊고, 점검으로 만든 행은 [테스트] 표시와 ID로 골라서 정리해.
select net.http_post('https://<ref>.supabase.co/functions/v1/blog-app/logout', body => '{}'::jsonb,
  headers => '{"Content-Type":"application/json","x-app-session":"<임시토큰>"}'::jsonb);
```

## 5. 남는 행 없이 DB 함수만 확인하기 (1.1.2에서 씀)
실서버 DB 함수는 `do $$ … $$` 블록 안에서 시험하고 **마지막에 일부러 오류를 내서 전부 되돌려(롤백)**. 결과는 그 오류 메시지에 담아서 봐.
```sql
do $$ declare res text := ''; begin
  -- 시험할 것: 주제 만들기 → add_post 두 번(두 번째는 'topic already has a post'), 끝난 작업에 job_fail(무시돼야 함),
  -- 검수 필요 원고에 fill_post(거부), import_metrics 새로/이름만 바꾼 같은 파일/고친 리포트 → import_cancel
  ...
  raise exception 'RESULT(롤백됨): %', res;   -- 여기서 위의 모든 변경이 취소됨
end $$;
```
끝나고 표의 줄 수가 그대로인지(`select count(*) …`) 한 번 더 확인해.

## 6. 1.1.2에서 더 한 API 점검
| 요청 | 기대 결과 |
|---|---|
| 검사에 걸리는 '발행 준비 완료' 원고 → `stage=scheduled` / `stage=published` | 둘 다 409 check_failed, 상태 그대로 |
| `POST /programs/{그 원고의 수익 모델}` (값은 그대로 다시 저장) | 200 + `demoted_posts`에 그 원고 → '검수 필요'로 |
| `POST /imports` 같은 파일 → 이름만 바꿔서 → 숫자를 고쳐서 | ok·dup·changed 가 차례로 (2·0·0) → (0·2·0) → (0·0·2) |
| `POST /imports/{고친 파일}/cancel` → `{처음 파일}/cancel` | restored 1 (예전 숫자로) → removed 1 |
| `GET /export` | `counts` 가 DB 줄 수와 같음 |
| 원고 요청 → `DELETE /posts/{id}` → `restore` → `retry` | 지우면 '작업 실패'·요청 취소, 되살려서 다시 요청하면 같은 요청이 다시 대기로 |
| 30분 넘게 멈춘 작업(점검용으로 시작 시각을 31분 전으로) → `DELETE /jobs/{id}` → `retry` | 원고 '작업 실패' → 다시 대기로 |

## 7. 1.2.0 이미지 스튜디오 점검 (OpenAI·Pexels 키 없이)
진짜 OpenAI·Pexels를 부르지 않고 확인할 수 있는 것만 해. 쓰기 점검은 `[테스트]` 표시를 붙이고 끝나면 정리해.
| 요청 | 기대 결과 |
|---|---|
| `GET /ping` | `version` = 1.2.0 |
| `GET /images/config` · `GET /images` · `POST /images/generate` (세션 없음) | 모두 401 |
| `GET /images/config` (임시 세션) | `keys.openai`·`keys.pexels`가 키 넣은 상태와 같음, 키 값은 응답 어디에도 없음, 기본 설정(모델·품질·하루 5장·한 달 2달러) |
| `POST /images/generate` (키 없음, 실제 모델) | 503 `openai_key_missing`, 생성 기록 안 생김 |
| `GET /stock/search?q=청소기` (키 없음) | 503 `pexels_key_missing`, 호출 기록 안 생김 |
| `POST /images/upload` JSON(`b64`=작은 JPEG, `rights:true`, `description:"[테스트]"`) | 200, `image.url`이 서명 주소(`/object/sign/post-images/…`), `bytes`·`width`·`height`·`sha256` 채워짐 |
| 같은 파일 다시 올리기 | `reused: true` (파일을 또 저장하지 않음) |
| 서명 주소로 받기 (Origin=앱 주소) / 서명 없는 공개 주소로 받기 | 200 이미지 + 허용 머리글 / 400·404 (비공개) |
| 이름만 바꾼 가짜 파일(`b64`=HTML 글자, `mime=image/jpeg`) | 400 `bad_image` (`reason` 있음), 저장 안 됨 |
| `rights` 없이 올리기 | 400 `rights_required` |
| `POST /images/{id}` review_status=사용 가능 | 200 |
| (점검용 가짜 모델) 설정 `image_gen_model=gf-test-fake` → `POST /images/generate` → `GET /images/generations/{id}` | 202 → '성공', 비용 0, 회색 시험 이미지, OpenAI는 안 부름 → 끝나면 모델 이름을 원래대로 |
| 쓰는 이미지 `DELETE /images/{id}` / 연결을 뺀 뒤 다시 | 409 `image_in_use` / 200 `file_removed: true` |
| `GET /stats` | `image_costs` 따로 있음, 기존 숫자는 그대로 |
| `GET /export` | 새 표 4개(`post_images`·`post_image_slots`·`image_generations`·`post_card_decks`) 줄 수가 DB와 같음 |
DB 함수(자리 연결·맞바꾸기·옮기기·지우기 거절)는 5번처럼 `do $$ … raise exception … $$`로 실서버 DB 안에서 시험하고 되돌려.
