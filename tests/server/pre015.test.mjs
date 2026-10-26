// 서버(blog-app)의 실제 코드를 Deno로 띄워서, DB에 015(주력 주제 낱말·사진 출처 열)가 아직 없을 때와 생긴 뒤의 동작을 확인 (1.3.1)
// - 실서버·실DB는 쓰지 않아: 가짜 DB API(PostgREST 흉내)를 이 파일이 직접 띄우고, 키·세션은 시험용 가짜 값
// - deno 가 있어야 돌아감. 없으면 '건너뜀'으로 나옴 (통과로 세지 않음). 다른 곳의 deno 는 DENO=/경로/deno 로
//   실행: npm run test:server
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const DENO = process.env.DENO || 'deno';
const HAS_DENO = (() => { try { return spawnSync(DENO, ['--version']).status === 0; } catch { return false; } })();
const FN_DIR = fileURLToPath(new URL('../../supabase/functions/blog-app/', import.meta.url));
const SESSION = 'test-session-' + randomBytes(16).toString('hex'); // 시험용 가짜 세션 (가짜 DB는 아무 세션이나 받아줌)
const IMG_UPLOAD = '11111111-1111-4111-8111-111111111111';
const IMG_AI = '22222222-2222-4222-8222-222222222222';
const skip = HAS_DENO ? false : 'deno 가 없어서 건너뜀 (DENO=/경로/deno 로 지정)';

// ── 가짜 DB API: 015 전(pre015 = true)이면 새 열을 모른다고 PostgREST 처럼 답함 ──
const fakeDb = { pre015: true, calls: [], settings: { id: 1, per_day: 1, focus_topic: '', auto_topics: '', auto_enabled: false } };
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
let fake, deno, base;

function startFake() {
  fake = http.createServer(async (req, res) => {
    let raw = '';
    for await (const ch of req) raw += ch;
    const url = new URL(req.url, 'http://fake');
    const table = url.pathname.replace(/^\/rest\/v1\//, '');
    const select = url.searchParams.get('select') || '';
    const one = String(req.headers.accept || '').includes('vnd.pgrst.object'); // .single()
    const body = raw ? JSON.parse(raw) : null;
    fakeDb.calls.push({ method: req.method, table, select, body });
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    const noColumn = (col, tbl) => send(400, { code: 'PGRST204', details: null, hint: null, message: `Could not find the '${col}' column of '${tbl}' in the schema cache` });
    const now = new Date().toISOString();
    if (table === 'app_sessions' && req.method === 'GET') return send(200, [{ id: 'sess-1', revoked_at: null, last_used_at: now, created_at: now }]);
    if (table === 'settings') {
      if (req.method === 'PATCH') {
        if (fakeDb.pre015 && 'focus_terms' in body) return noColumn('focus_terms', 'settings');
        Object.assign(fakeDb.settings, body);
      }
      return send(200, one ? fakeDb.settings : [fakeDb.settings]);
    }
    if (table === 'post_images' && req.method === 'GET') {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      return send(200, id === IMG_UPLOAD ? [{ kind: 'upload' }] : id === IMG_AI ? [{ kind: 'ai' }] : []);
    }
    if (table === 'post_images' && req.method === 'PATCH') {
      if (fakeDb.pre015 && 'source_type' in body) return noColumn('source_type', 'post_images');
      return send(200, [{ id: IMG_UPLOAD, kind: 'upload', storage_path: '', ...body }]);
    }
    if (table === 'post_image_slots' && req.method === 'GET') {
      if (fakeDb.pre015 && select.includes('source_type')) return send(400, { code: '42703', details: null, hint: null, message: 'column post_images_1.source_type does not exist' });
      const img = { kind: 'upload', provider: null, review_status: '검수 전', mime: 'image/jpeg', author_name: null, description: '', license: null, attribution_text: null };
      return send(200, [{ post_id: 'p1', slot_key: 's1', slot_index: 0, image_id: IMG_UPLOAD, purpose: null, used_at: null, downloaded_at: null, post_images: fakeDb.pre015 ? img : { ...img, source_type: '' } }]);
    }
    return send(200, one ? {} : []); // 나머지 표는 비어 있음
  });
  return new Promise((ok) => fake.listen(0, '127.0.0.1', () => ok(fake.address().port)));
}

const call = async (method, route, body) => {
  const r = await fetch(`${base}/blog-app/${route}`, { method, headers: { 'content-type': 'application/json', 'x-app-session': SESSION }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json() };
};
const since = (n) => fakeDb.calls.slice(n);

before(async () => {
  if (!HAS_DENO) return;
  const dbPort = await startFake();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  // 진짜 키는 넘기지 않음: 시험용 가짜 값으로 덮어씀
  const env = { ...process.env, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`, SUPABASE_URL: `http://127.0.0.1:${dbPort}`, SUPABASE_SERVICE_ROLE_KEY: 'test-only-not-a-key', SUPABASE_SECRET_KEYS: '', OPENAI_API_KEY: '', PEXELS_API_KEY: '', CF_ACCOUNT_ID: '', CF_API_TOKEN: '' };
  deno = spawn(DENO, ['run', '--allow-net', '--allow-env', '--allow-read', '--node-modules-dir=none', 'index.ts'], { cwd: FN_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  deno.stdout.on('data', (d) => { log += d; });
  deno.stderr.on('data', (d) => { log += d; });
  const until = Date.now() + 120_000;
  for (;;) {
    try { const r = await fetch(`${base}/blog-app/ping`); if (r.ok) break; } catch { /* 아직 켜지는 중 */ }
    if (Date.now() > until || deno.exitCode != null) throw new Error('서버가 안 켜짐:\n' + log.slice(-2000));
    await new Promise((ok) => setTimeout(ok, 300));
  }
});
after(() => { deno?.kill(); fake?.close(); });

test('015 전 DB: 설정 저장은 주력 주제 낱말만 빼고 나머지를 저장하고, 뺐다는 걸 알려줌', { skip }, async () => {
  fakeDb.pre015 = true;
  const n = fakeDb.calls.length;
  const { status, j } = await call('POST', 'settings', { focus_topic: '겨울 가전', focus_terms: '전기요', per_day: 2 });
  assert.equal(status, 200, JSON.stringify(j));
  assert.deepEqual(j.skipped, ['focus_terms']);
  assert.equal(j.settings.per_day, 2);
  assert.equal(j.settings.focus_topic, '겨울 가전');
  const patches = since(n).filter((c) => c.table === 'settings' && c.method === 'PATCH');
  assert.equal(patches.length, 2, '한 번 실패하고 그 칸만 빼고 다시 저장');
  assert.equal(patches[0].body.focus_terms, '전기요');
  assert.ok(!('focus_terms' in patches[1].body) && patches[1].body.per_day === 2);
});

test('015 전 DB: 주력 주제 낱말만 보냈으면 빈 저장을 보내지 않고 지금 설정을 돌려줌', { skip }, async () => {
  fakeDb.pre015 = true;
  const n = fakeDb.calls.length;
  const { status, j } = await call('POST', 'settings', { focus_terms: '전기요' });
  assert.equal(status, 200, JSON.stringify(j));
  assert.deepEqual(j.skipped, ['focus_terms']);
  assert.equal(j.settings.per_day, 2, '앞 시험에서 저장한 값 그대로');
  const mine = since(n).filter((c) => c.table === 'settings');
  assert.deepEqual(mine.map((c) => c.method), ['PATCH', 'GET']);
});

test('015 전 DB: 사진 출처 바꾸기는 db_update_needed(409)로 알려줌 — 서버 오류(500)가 아님', { skip }, async () => {
  fakeDb.pre015 = true;
  const { status, j } = await call('POST', `images/${IMG_UPLOAD}`, { source_type: 'own' });
  assert.equal(status, 409, JSON.stringify(j));
  assert.deepEqual(j, { error: 'db_update_needed', migration: '015' });
});

test('출처는 직접 올린 사진만 바꿀 수 있음: AI 이미지·이상한 값은 400, DB에 저장 요청을 안 보냄', { skip }, async () => {
  const n = fakeDb.calls.length;
  const a = await call('POST', `images/${IMG_AI}`, { source_type: 'own' });
  assert.equal(a.status, 400);
  assert.deepEqual(a.j, { error: 'bad_field', field: 'source_type' });
  const b = await call('POST', `images/${IMG_UPLOAD}`, { source_type: 'mine' });
  assert.equal(b.status, 400);
  assert.ok(!since(n).some((c) => c.table === 'post_images' && c.method === 'PATCH'));
});

test('015 전 DB: 상태 조회는 사진 자리 요약을 출처 없이 다시 읽어서 그대로 동작', { skip }, async () => {
  fakeDb.pre015 = true;
  const n = fakeDb.calls.length;
  const { status, j } = await call('GET', 'state');
  assert.equal(status, 200, JSON.stringify(j).slice(0, 300));
  assert.equal(j.version, '1.3.1');
  assert.equal(j.image_slots.length, 1);
  assert.equal(j.image_slots[0].post_images.kind, 'upload');
  const reads = since(n).filter((c) => c.table === 'post_image_slots');
  assert.equal(reads.length, 2);
  assert.ok(reads[0].select.includes('source_type') && !reads[1].select.includes('source_type'));
});

test('015 뒤 DB: 주력 주제 낱말도 저장하고(skipped 없음), 사진 출처도 바뀜, 상태 조회에 출처가 들어감', { skip }, async () => {
  fakeDb.pre015 = false;
  const s = await call('POST', 'settings', { focus_topic: '겨울 가전', focus_terms: '전기요, 온수매트', per_day: 1 });
  assert.equal(s.status, 200);
  assert.equal(s.j.skipped, undefined);
  assert.equal(s.j.settings.focus_terms, '전기요, 온수매트');
  const n = fakeDb.calls.length;
  const i = await call('POST', `images/${IMG_UPLOAD}`, { source_type: 'own' });
  assert.equal(i.status, 200, JSON.stringify(i.j));
  assert.equal(i.j.image.source_type, 'own');
  assert.deepEqual(since(n).find((c) => c.table === 'post_images' && c.method === 'PATCH').body, { source_type: 'own' });
  const st = await call('GET', 'state');
  assert.equal(st.j.image_slots[0].post_images.source_type, '');
});
