// blog-gen: blog-app 과 같은 서버 코드를 'AI 이미지 만들기' 요청(POST /images/generate)만 받는 이름으로 하나 더 올림.
// 생성 요청이 다른 요청(목록·저장 등)이 쓰던 서버 일꾼에 섞이지 않아서 새 일꾼에서 시작할 때가 많음 → '서버 준비 중' 대기가 줄고,
// 다른 요청 때문에 일꾼이 멈춰 만들던 이미지를 잃는 일도 줄어듦. 나머지 요청은 blog-gen 이 404로 거절함 (blog-app 으로).
// Supabase CLI: supabase functions deploy blog-gen --no-verify-jwt   (blog-app 과 같이 verify_jwt 끔 — 자체 로그인)
// 대시보드·MCP로 올릴 때는 blog-app 폴더의 index.ts·checks.js·images.js·image_service.js 를 그대로 blog-gen 이름으로 올려도 같음.
// 앱은 blog-gen 이 아직 없으면(404) 같은 요청 번호로 blog-app 에 다시 보냄 (두 번 만들지 않음).
import "../blog-app/index.ts";
