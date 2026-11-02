// 서버 1.6.0 하루 계획 운영: 화면을 열 때 자동 원고 정리(expire_auto_posts)·오늘 계획(plan_today), 하루 계획·보관일 설정, 원고 보관(keep)
// 서버 실제 코드를 Deno로 띄우고 가짜 DB API(harness.mjs)로 확인. DB 020 전(pre020)·후 둘 다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { HAS_DENO, SKIP as skip, startServer, pg } from './harness.mjs';

const POST = '77777777-7777-4777-8777-777777777777';
const body = '[이미지: 창가 가습기]\n[프롬프트: 창가 선반 위 흰 가습기, 1:1, 글자 없이]\n## 소제목\n' + '원룸에서 쓰기 좋은 기준을 정리했어요. '.repeat(20);
const posts = { [POST]: { id: POST, stage: 'review', source: 'auto', plan_kind: 'adpost', keep: false, keyword: '겨울 가습기 세척 방법', titles: ['겨울 가습기 세척'], body, channel_id: 'naver_blog', program_ids: [], variants: {}, refresh: {}, deleted_at: null } };
const db = { pre020: true, expireCalls: 0, settings: { id: 1, per_day: 1, auto_enabled: true, daily_plan: { affiliate: 2, adpost: 2, trending: 2, market: 2, stock: 2 }, keep_days: 3 } };
let srv;

before(async () => {
  if (!HAS_DENO) return;
  srv = await startServer(({ method, table, rpc, one, body: b, query }) => {
    if (rpc === 'expire_auto_posts') { db.expireCalls++; return db.pre020 ? pg.noFunction('expire_auto_posts') : [200, { expired: 4, keep_days: 3, kept_from: '2026-10-31' }]; }
    if (rpc === 'plan_today') return db.pre020 ? pg.noFunction('plan_today') : [200, { date: '2026-11-02', plan: db.settings.daily_plan, keep_days: 3, done: { affiliate: 2, adpost: 1 } }];
    if (rpc === 'metric_post_ids') return [200, []];
    if (table === 'runs' && method === 'HEAD') return [200, [], { 'content-range': '*/0' }];
    if (table === 'posts' && method === 'GET') {
      const id = (query.id || '').replace(/^eq\./, '');
      return [200, id ? (posts[id] ? [posts[id]] : []) : Object.values(posts)];
    }
    if (table === 'posts' && method === 'PATCH') {
      if (db.pre020 && 'keep' in b) return pg.noColumn('keep', 'posts');
      const id = (query.id || '').replace(/^eq\./, '');
      Object.assign(posts[id], b);
      return [200, one ? posts[id] : [posts[id]]];
    }
    if (table === 'settings') {
      if (method === 'PATCH') {
        for (const c of ['daily_plan', 'keep_days']) if (db.pre020 && c in b) return pg.noColumn(c, 'settings');
        Object.assign(db.settings, b);
      }
      return [200, one ? db.settings : [db.settings]];
    }
    if (table === 'channels') return [200, [{ id: 'naver_blog', name: '네이버 블로그', kind: 'blog', active: true }]];
    if (table === 'programs' || table === 'program_channels') return [200, []];
    return undefined;
  });
});
after(() => srv?.stop());

test('020 전 DB: 화면은 그대로 열리고(정리·오늘 계획은 건너뜀), 보관·하루 계획 저장은 DB 업데이트 필요로 알림', { skip }, async () => {
  db.pre020 = true;
  const st = await srv.call('GET', 'state');
  assert.equal(st.status, 200, JSON.stringify(st.j).slice(0, 300));
  assert.equal(st.j.version, '1.6.0');
  assert.equal(st.j.expired, null);
  assert.equal(st.j.plan_today, null);
  const k = await srv.call('POST', `posts/${POST}`, { keep: true });
  assert.deepEqual([k.status, k.j], [409, { error: 'db_update_needed', migration: '020' }]);
  const s = await srv.call('POST', 'settings', { per_day: 2, daily_plan: { affiliate: 1 }, keep_days: 5 });
  assert.equal(s.status, 200, JSON.stringify(s.j));
  assert.deepEqual(s.j.skipped.sort(), ['daily_plan', 'keep_days'], '나머지(하루 발행 수)는 저장');
});

test('화면을 열 때마다 먼저 자동 원고 정리를 부르고(원고를 읽기 전에), 옮긴 수와 오늘 계획을 같이 돌려줌', { skip }, async () => {
  db.pre020 = false;
  const n = srv.calls.length;
  const before = db.expireCalls;
  const st = await srv.call('GET', 'state');
  assert.equal(st.status, 200);
  assert.equal(db.expireCalls, before + 1);
  const calls = srv.since(n);
  const iExp = calls.findIndex((c) => c.rpc === 'expire_auto_posts');
  const iPosts = calls.findIndex((c) => c.table === 'posts' && c.method === 'GET');
  assert.ok(iExp >= 0 && iExp < iPosts, '정리한 뒤에 원고 목록을 읽음 (목록에 정리된 원고가 안 섞이게)');
  assert.deepEqual(st.j.expired, { expired: 4, keep_days: 3, kept_from: '2026-10-31' });
  assert.deepEqual(st.j.plan_today.done, { affiliate: 2, adpost: 1 });
});

test('하루 계획·보관일 설정: 종류마다 0~4 정수만, 모르는 종류는 버림, 보관일 1~14', { skip }, async () => {
  db.pre020 = false;
  const bad = async (b, field) => { const r = await srv.call('POST', 'settings', b); assert.deepEqual([r.status, r.j], [400, { error: 'bad_field', field }], JSON.stringify(b)); };
  await bad({ daily_plan: [1, 2] }, 'daily_plan');
  await bad({ daily_plan: { affiliate: 5 } }, 'daily_plan');
  await bad({ daily_plan: { affiliate: 1.5 } }, 'daily_plan');
  await bad({ daily_plan: { affiliate: '2' } }, 'daily_plan');
  await bad({ keep_days: 0 }, 'keep_days');
  await bad({ keep_days: 15 }, 'keep_days');
  const n = srv.calls.length;
  const ok = await srv.call('POST', 'settings', { daily_plan: { affiliate: 1, adpost: 3, trending: 0, market: 2, stock: 2, crypto: 4 }, keep_days: 5 });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  const w = srv.since(n).find((c) => c.table === 'settings' && c.method === 'PATCH');
  assert.deepEqual(w.body, { daily_plan: { affiliate: 1, adpost: 3, trending: 0, market: 2, stock: 2 }, keep_days: 5 });
});

test('원고 보관: keep 만 바꾸고(참·거짓), 본문·상태는 그대로', { skip }, async () => {
  db.pre020 = false;
  const n = srv.calls.length;
  const r = await srv.call('POST', `posts/${POST}`, { keep: true });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const w = srv.since(n).find((c) => c.table === 'posts' && c.method === 'PATCH');
  assert.deepEqual(w.body, { keep: true });
  assert.equal(r.j.post.keep, true);
  const r2 = await srv.call('POST', `posts/${POST}`, { keep: 'yes' });
  assert.equal(r2.j.post.keep, false, 'true 가 아니면 보관 안 함');
});

test('휴지통에서 되살리기: 보관일이 지난 자동 원고는 보관으로 (다음에 화면을 열 때 다시 정리되지 않게), 아직 안 지난 글·020 전 DB 글은 되살리기만', { skip }, async () => {
  db.pre020 = false;
  const ago = (d) => new Date(Date.now() - d * 86400e3).toISOString();
  const OLD = '88888888-8888-4888-8888-888888888888';
  const FRESH = '99999999-9999-4999-8999-999999999999';
  const LEGACY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  posts[OLD] = { ...posts[POST], id: OLD, created_at: ago(10), deleted_at: ago(1), keep: false };
  posts[FRESH] = { ...posts[POST], id: FRESH, created_at: ago(0), deleted_at: ago(0), keep: false };
  let n = srv.calls.length;
  const a = await srv.call('POST', `posts/${OLD}/restore`, {});
  assert.equal(a.status, 200, JSON.stringify(a.j));
  assert.deepEqual([a.j.kept, a.j.post.keep, a.j.post.deleted_at], [true, true, null]);
  assert.ok(srv.since(n).some((c) => c.table === 'posts' && c.method === 'PATCH' && c.body && c.body.keep === true));
  n = srv.calls.length;
  const b = await srv.call('POST', `posts/${FRESH}/restore`, {});
  assert.equal(b.status, 200, JSON.stringify(b.j));
  assert.deepEqual([b.j.kept, b.j.post.keep, b.j.post.deleted_at], [false, false, null]);
  assert.ok(!srv.since(n).some((c) => c.method === 'PATCH' && c.body && 'keep' in c.body), '보관일이 안 지난 글은 보관으로 안 바꿈');
  // 020 전 DB: keep 열이 없으면 되살리기만 (오류 없이)
  db.pre020 = true;
  const { keep: _k, ...noKeep } = posts[OLD];
  posts[LEGACY] = { ...noKeep, id: LEGACY, deleted_at: ago(1) };
  n = srv.calls.length;
  const c = await srv.call('POST', `posts/${LEGACY}/restore`, {});
  assert.equal(c.status, 200, JSON.stringify(c.j));
  assert.equal(c.j.kept, false);
  assert.ok(!srv.since(n).some((x) => x.method === 'PATCH' && x.body && 'keep' in x.body));
  db.pre020 = false;
});
