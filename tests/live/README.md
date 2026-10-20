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
