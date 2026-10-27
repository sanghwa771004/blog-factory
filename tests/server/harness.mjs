// 서버(blog-app) 실제 코드를 Deno로 띄우고, 가짜 DB API(PostgREST 흉내)를 붙이는 시험 도구
// - 실서버·실DB는 쓰지 않아. 키·세션은 시험용 가짜 값
// - deno 가 없으면 HAS_DENO=false → 시험은 '건너뜀'으로 나옴 (통과로 세지 않음). 다른 곳의 deno 는 DENO=/경로/deno
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const DENO = process.env.DENO || 'deno';
export const HAS_DENO = (() => { try { return spawnSync(DENO, ['--version']).status === 0; } catch { return false; } })();
export const SKIP = HAS_DENO ? false : 'deno 가 없어서 건너뜀 (DENO=/경로/deno 로 지정)';
const FN_DIR = fileURLToPath(new URL('../../supabase/functions/blog-app/', import.meta.url));
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

// PostgREST 가 내는 오류 모양
export const pg = {
  noColumn: (col, tbl) => [400, { code: 'PGRST204', details: null, hint: null, message: `Could not find the '${col}' column of '${tbl}' in the schema cache` }],
  noTable: (tbl) => [404, { code: 'PGRST205', details: null, hint: null, message: `Could not find the table 'public.${tbl}' in the schema cache` }],
  noFunction: (fn) => [404, { code: 'PGRST202', details: null, hint: null, message: `Could not find the function public.${fn} without parameters in the schema cache` }],
  check: (tbl, con) => [400, { code: '23514', details: null, hint: null, message: `new row for relation "${tbl}" violates check constraint "${con}"` }],
};

// handle({ method, table, rpc, select, one, body, url, query, prefer }) → [status, data, headers?] 또는 undefined(빈 표로 답함)
// data 가 Uint8Array 면 그대로(이미지 파일 내려받기 흉내). opts.env: 서버 환경변수 덮어쓰기 (시험용 가짜 키 — 진짜 키를 넣지 마)
// 서버는 --allow-net=127.0.0.1 로 띄움 → 가짜 DB 말고는 어디에도 연결하지 못함 (실수로 OpenAI·Gemini·Cloudflare를 부르지 않게)
export async function startServer(handle, opts = {}) {
  const calls = [];
  const fake = http.createServer(async (req, res) => {
    let raw = '';
    for await (const ch of req) raw += ch;
    const url = new URL(req.url, 'http://fake');
    const path = url.pathname.replace(/^\/rest\/v1\//, '');
    const rpc = path.startsWith('rpc/') ? path.slice(4) : null;
    const table = rpc ? null : path;
    const select = url.searchParams.get('select') || '';
    const one = String(req.headers.accept || '').includes('vnd.pgrst.object');
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    const call = { method: req.method, table, rpc, select, body, query: Object.fromEntries(url.searchParams), prefer: String(req.headers.prefer || '') };
    calls.push(call);
    const send = (status, data, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(data)); };
    const now = new Date().toISOString();
    if (table === 'app_sessions' && req.method === 'GET') return send(200, [{ id: 'sess-1', revoked_at: null, last_used_at: now, created_at: now }]);
    const r = await handle({ ...call, one, url });
    if (r && r[1] instanceof Uint8Array) { res.writeHead(r[0], { 'content-type': 'application/octet-stream', ...(r[2] || {}) }); return res.end(Buffer.from(r[1])); }
    if (r) return send(r[0], r[1], r[2]); // r[2]: 응답 머리글 (예: 개수 세기의 content-range)
    return send(200, one ? {} : []);
  });
  const dbPort = await new Promise((ok) => fake.listen(0, '127.0.0.1', () => ok(fake.address().port)));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`, SUPABASE_URL: `http://127.0.0.1:${dbPort}`, SUPABASE_SERVICE_ROLE_KEY: 'test-only-not-a-key', SUPABASE_SECRET_KEYS: '', OPENAI_API_KEY: '', PEXELS_API_KEY: '', CF_ACCOUNT_ID: '', CF_API_TOKEN: '', GEMINI_API_KEY: '', ...(opts.env || {}) };
  const deno = spawn(DENO, ['run', '--allow-net=127.0.0.1', '--allow-env', '--allow-read', '--node-modules-dir=none', 'index.ts'], { cwd: FN_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  deno.stdout.on('data', (d) => { log += d; });
  deno.stderr.on('data', (d) => { log += d; });
  const until = Date.now() + 120_000;
  for (;;) {
    try { const r = await fetch(`${base}/blog-app/ping`); if (r.ok) break; } catch { /* 켜지는 중 */ }
    if (Date.now() > until || deno.exitCode != null) { deno.kill(); fake.close(); throw new Error('서버가 안 켜짐:\n' + log.slice(-2000)); }
    await new Promise((ok) => setTimeout(ok, 300));
  }
  const session = 'test-session-' + randomBytes(16).toString('hex'); // 가짜 DB는 아무 세션이나 받아줌
  const call = async (method, route, body) => {
    const r = await fetch(`${base}/blog-app/${route}`, { method, headers: { 'content-type': 'application/json', 'x-app-session': session }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, j: await r.json() };
  };
  // form: multipart 보내기 (FormData) — 작은 사본 올리기 같은 곳
  const form = async (route, fd) => {
    const r = await fetch(`${base}/blog-app/${route}`, { method: 'POST', headers: { 'x-app-session': session }, body: fd });
    return { status: r.status, j: await r.json() };
  };
  return { base, calls, call, form, since: (n) => calls.slice(n), stop: () => { deno.kill(); fake.close(); }, log: () => log };
}
