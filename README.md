# 글공장

블로그 원고 발행표 앱. 휴대폰 홈 화면에 추가해서 쓰는 웹 앱이에요.

- **발행표**: 날짜별 원고, 오늘 할 일, 밀린 글
- **원고**: 내 경험 채우기, 티스토리·네이버용 서식 복사, HTML 복사, 쓰레드 바로 올리기
- **글 요청**: 키워드를 넣어두면 하루 세 번 자동으로 써서 발행표에 넣어줘요
- **자동 업데이트**: 이 저장소에 새 버전이 올라가면 앱을 열 때 자동으로 바뀌어요 (`version.json`)

## 구조

| 부분 | 위치 |
|---|---|
| 앱 화면 | `index.html` (GitHub Pages) |
| 서버 API | `supabase/functions/blog-app` (Supabase Edge Function) |
| 데이터 | Supabase `blog-factory` 프로젝트 (posts, requests, settings, runs) |
| 자동 글쓰기 | Claude 예약 작업 (하루 세 번) |

앱은 접속 코드가 있어야 열리고, 데이터와 접속 코드는 이 저장소에 없어요.

## 업데이트하는 법

1. `index.html`의 `APP_VER`와 `version.json`의 `version`을 같은 값으로 올리기
2. `version.json`의 `notes`에 바뀐 점 한 줄
3. 커밋하고 `main`과 `gh-pages` 둘 다 푸시 (`git push origin main main:gh-pages`)
4. 1~2분 뒤 GitHub Pages(`gh-pages` 가지)에 반영되고, 앱을 다시 열면 자동으로 새 버전이 떠요

아이콘은 `python3 tools/make_icons.py .`로 다시 만들 수 있어요.
