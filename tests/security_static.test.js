// 보안 정적 검사 — 화면 파일에 API 키·외부 이미지 API 호출이 없는지, 서버는 키를 환경변수(Secrets)에서만 읽는지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const CLIENT = ['index.html', 'app.js', 'studio.js', 'cards.js', 'images.js', 'lib.js', 'checks.js'];

test('화면 파일에는 키처럼 생긴 글자도, OpenAI·Pexels 직접 호출도 없음 (키는 서버에만)', () => {
  for (const f of CLIENT) {
    const t = read(f);
    assert.ok(!/sk-[A-Za-z0-9_-]{16,}/.test(t), f + ': 키처럼 생긴 글자가 있음');
    assert.ok(!/api\.openai\.com|api\.pexels\.com/.test(t), f + ': 화면이 OpenAI·Pexels API를 직접 부름');
    assert.ok(!/OPENAI_API_KEY\s*[:=]\s*['"`][^'"`]+|PEXELS_API_KEY\s*[:=]\s*['"`][^'"`]+/.test(t), f + ': 키 값을 넣는 코드');
    assert.ok(!/Authorization['"]?\s*:/.test(t), f + ': 화면에서 외부 인증 머리글을 씀');
  }
});

test('서버는 키를 환경변수(Supabase Secrets)에서만 읽고, 화면으로는 있음/없음만 보냄', () => {
  const ts = read('supabase/functions/blog-app/index.ts');
  assert.match(ts, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
  assert.match(ts, /Deno\.env\.get\("PEXELS_API_KEY"\)/);
  assert.match(ts, /const keysInfo = \(\) => \(\{ openai: !!keyOpenAI\(\), pexels: !!\(Deno\.env\.get\("PEXELS_API_KEY"\) \?\? ""\) \}\);/);
  // 키 값(keyOpenAI())은 OpenAI 호출(runGeneration)에만 넘김 — json 응답에 그대로 넣는 곳이 없음
  const uses = [...ts.matchAll(/keyOpenAI\(\)/g)].map((m) => ts.slice(Math.max(0, m.index - 60), m.index + 20));
  for (const u of uses) assert.ok(/!!keyOpenAI|!keyOpenAI|key: keyOpenAI|=> Deno\.env|const keyOpenAI/.test(u), '키를 다른 곳에 씀: ' + u);
  const svc = read('supabase/functions/blog-app/image_service.js');
  assert.ok(!/Deno\.env/.test(svc), 'image_service 는 키를 직접 읽지 않고 받아서만 씀');
  // 오류 문구에서 키 가리기
  assert.match(svc, /export const scrub/);
});

test('화면 보안 정책(CSP): 스크립트는 같은 곳만, 이미지는 Supabase(서명 주소)·Pexels·blob만', () => {
  const html = read('index.html');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /img-src 'self' data: blob: https:\/\/oxewhsqmdkiasckvnyua\.supabase\.co https:\/\/images\.pexels\.com;/);
  assert.match(csp, /connect-src 'self' https:\/\/oxewhsqmdkiasckvnyua\.supabase\.co;/);
  assert.ok(!/connect-src[^;]*(openai|pexels)/.test(csp), '화면이 OpenAI·Pexels로 직접 연결하지 못하게');
});

test('이미지 저장소는 비공개 버킷 + 정책 없음 (서버 키로만, 화면은 서명 주소로만)', () => {
  const sql = read('supabase/migrations/012_image_studio.sql');
  assert.match(sql, /values \('post-images', 'post-images', false,/);
  assert.ok(!/create policy/i.test(sql), 'storage 정책을 만들지 않음 (anon·authenticated 접근 없음)');
  assert.ok(!/drop table|truncate|delete from public\.(posts|metrics|links|products)/i.test(sql), '기존 표를 지우거나 비우지 않음');
});
