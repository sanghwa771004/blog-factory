// 서버 1.4.0 운영 기능: 다른 채널 기록 · 유입 검색어 · 예정일 다시 잡기 · 개선안 요청 · 쌓아둘 원고 한도
// 서버 실제 코드를 Deno로 띄우고 가짜 DB API(harness.mjs)로 확인. DB 016 전(pre016)·후 둘 다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { HAS_DENO, SKIP as skip, startServer, pg } from './harness.mjs';

const LIVE_POST = '33333333-3333-4333-8333-333333333333';
const DRAFT_POST = '44444444-4444-4444-8444-444444444444';
const PC_ID = '55555555-5555-4555-8555-555555555555';
const longBody = '## 소제목\n' + '원룸에서 쓰기 좋은 기준을 정리했어요. '.repeat(20);
const posts = {
  [LIVE_POST]: { id: LIVE_POST, stage: 'published', keyword: '원룸 전기요 고르는 법', titles: ['원룸 전기요 고르는 법'], body: longBody, channel_id: 'naver_blog', program_ids: [], money: '', platform: '네이버 블로그', variants: {}, refresh: { titles: ['x'] }, deleted_at: null },
  [DRAFT_POST]: { id: DRAFT_POST, stage: 'review', keyword: '검수 중', titles: ['검수 중'], body: longBody, channel_id: 'naver_blog', program_ids: [], variants: {}, refresh: {}, deleted_at: null },
};
const channels = ['naver_blog', 'tistory', 'website', 'threads', 'instagram'].map((id) => ({ id, name: id, kind: id === 'threads' || id === 'instagram' ? 'sns' : 'blog', active: true }));
const db = { pre016: true, pendingRefresh: false, settings: { id: 1, per_day: 1, focus_topic: '', focus_terms: '', auto_enabled: true }, saved: [], failChannels: false };
// PostgREST 가 DB 함수의 raise exception 을 돌려주는 모양
const raised = (message) => [400, { code: 'P0001', details: null, hint: null, message }];
let srv;

before(async () => {
  if (!HAS_DENO) return;
  srv = await startServer(({ method, table, rpc, one, body, query }) => {
    if (rpc === 'reschedule_overdue') return db.pre016 ? pg.noFunction('reschedule_overdue') : [200, [{ id: DRAFT_POST, from: '2026-10-20', to: '2026-10-27' }]];
    if (rpc === 'metric_post_ids') return db.pre016 ? pg.noFunction('metric_post_ids') : [200, [LIVE_POST]];
    if (rpc === 'stats_window') return db.pre016 ? pg.noFunction('stats_window') : [200, { from: body.d_from, to: body.d_to, within: true, partial: 1, totals: { rows: 0 }, by_post: [] }];
    if (rpc === 'save_search_terms') {
      if (db.pre016) return pg.noFunction('save_search_terms');
      db.saved = body;
      // 19일~25일 기록이 이미 있다고 치고: 20일~26일은 겹침
      if (body.p_start === '2026-10-20' && body.p_end === '2026-10-26' && body.items.some((x) => x.term === '겹침') && !body.replace_overlap) {
        return raised('period overlap: [{"period_end": "2026-10-25", "period_start": "2026-10-19"}]');
      }
      return [200, body.items.map((x, i) => ({ id: `t${i}`, post_id: body.target, ...x, period_start: body.p_start, period_end: body.p_end, channel_id: body.p_channel, source_label: body.p_label }))];
    }
    if (table === 'runs' && method === 'HEAD') return [200, [], { 'content-range': '*/21' }];
    if (table === 'posts' && method === 'GET') {
      const id = (query.id || '').replace(/^eq\./, '');
      return [200, posts[id] ? [posts[id]] : (id ? [] : [])];
    }
    if (table === 'posts' && method === 'PATCH') {
      if (db.pre016 && 'refresh' in body) return pg.noColumn('refresh', 'posts');
      const id = (query.id || '').replace(/^eq\./, '');
      return [200, one ? { ...posts[id], ...body } : [{ ...posts[id], ...body }]];
    }
    if (table === 'channels') return [200, channels];
    if (table === 'programs' || table === 'program_channels') return [200, []];
    if (table === 'settings') {
      if (method === 'PATCH') {
        if (db.pre016 && 'backlog_limit' in body) return pg.noColumn('backlog_limit', 'settings');
        Object.assign(db.settings, body);
      }
      return [200, one ? db.settings : [db.settings]];
    }
    if (table === 'post_channels') {
      if (db.pre016) return pg.noTable('post_channels');
      if (db.failChannels && method === 'GET') return [500, { code: 'XX000', details: null, hint: null, message: 'something broke' }];
      if (method === 'POST') return [200, one ? { id: PC_ID, ...body } : [{ id: PC_ID, ...body }]];
      if (method === 'DELETE') return [200, (query.id || '') === `eq.${PC_ID}` ? [{ id: PC_ID }] : []];
      return [200, [{ id: PC_ID, post_id: LIVE_POST, channel_id: 'threads', url: '', posted_on: '2026-10-26' }]];
    }
    if (table === 'search_terms') {
      if (db.pre016) return pg.noTable('search_terms');
      if (method === 'POST') { db.saved = Array.isArray(body) ? body : [body]; return [200, db.saved.map((r, i) => ({ id: `t${i}`, ...r }))]; }
      return [200, [{ id: 't0', post_id: LIVE_POST, term: '원룸 전기요', views: 3, period_start: '2026-10-20', period_end: '2026-10-26' }]];
    }
    if (table === 'requests' && method === 'GET') return [200, db.pendingRefresh ? [{ id: 'r1' }] : []];
    if (table === 'requests' && method === 'POST') {
      if (db.pre016 && body.kind === 'refresh') return pg.check('requests', 'requests_kind_check');
      return [201, one ? { id: 'r2', status: 'pending', ...body } : [{ id: 'r2', status: 'pending', ...body }]];
    }
    return undefined;
  });
});
after(() => srv?.stop());

test('016 전 DB: 새 기능은 db_update_needed(409)로 알리고, 상태 조회·백업·다른 설정 저장은 그대로', { skip }, async () => {
  db.pre016 = true;
  const exp = { error: 'db_update_needed', migration: '016' };
  const ch = await srv.call('POST', `posts/${LIVE_POST}/channels`, { channel_id: 'threads', posted_on: '2026-10-26' });
  assert.deepEqual([ch.status, ch.j], [409, exp]);
  const st = await srv.call('POST', `posts/${LIVE_POST}/search-terms`, { period_start: '2026-10-20', period_end: '2026-10-26', terms: [{ term: '원룸 전기요', views: 3 }] });
  assert.deepEqual([st.status, st.j], [409, exp]);
  const rs = await srv.call('POST', 'posts/reschedule-overdue', {});
  assert.deepEqual([rs.status, rs.j], [409, exp]);
  const rf = await srv.call('POST', 'jobs', { kind: 'refresh', post_id: LIVE_POST });
  assert.deepEqual([rf.status, rf.j], [409, exp]);
  const clear = await srv.call('POST', `posts/${LIVE_POST}`, { refresh: null });
  assert.deepEqual([clear.status, clear.j], [409, exp]);
  const s = await srv.call('POST', 'settings', { per_day: 2, backlog_limit: 10 });
  assert.equal(s.status, 200, JSON.stringify(s.j));
  assert.deepEqual(s.j.skipped, ['backlog_limit']);
  assert.equal(s.j.settings.per_day, 2);
  const state = await srv.call('GET', 'state');
  assert.equal(state.status, 200);
  assert.deepEqual([state.j.post_channels, state.j.search_terms, state.j.metric_post_ids], [[], [], []], '016 전이면 빈 목록');
  assert.deepEqual([...state.j.unavailable].sort(), ['metric_post_ids', 'post_channels', 'search_terms'], '못 읽은 것을 알려줌 → 화면은 0이 아니라 데이터 없음');
  const wk = await srv.call('GET', 'stats?from=2026-10-20&to=2026-10-26&within=1');
  assert.deepEqual([wk.status, wk.j], [409, exp], '주간 비교(기간 안 실적만)는 016 필요');
  const ex = await srv.call('GET', 'export');
  assert.equal(ex.status, 200);
  assert.deepEqual(ex.j.missing_tables, ['post_channels', 'search_terms']);
});

test('다른 채널 기록: 메인 채널·없는 채널·https 아닌 주소·날짜 없음은 거절, 같은 채널은 덮어씀(upsert)', { skip }, async () => {
  db.pre016 = false;
  const bad = async (body, field) => { const r = await srv.call('POST', `posts/${LIVE_POST}/channels`, body); assert.deepEqual([r.status, r.j], [400, { error: 'bad_field', field }], JSON.stringify(body)); };
  await bad({ channel_id: 'naver_blog', posted_on: '2026-10-26' }, 'channel_id');
  await bad({ channel_id: 'nope', posted_on: '2026-10-26' }, 'channel_id');
  await bad({ channel_id: 'threads', url: 'http://www.threads.net/x', posted_on: '2026-10-26' }, 'url');
  await bad({ channel_id: 'threads', url: 'javascript:alert(1)', posted_on: '2026-10-26' }, 'url');
  await bad({ channel_id: 'threads' }, 'posted_on');
  const n = srv.calls.length;
  const ok = await srv.call('POST', `posts/${LIVE_POST}/channels`, { channel_id: 'threads', url: 'https://www.threads.net/@me/post/1', posted_on: '2026-10-26', variant_key: 'threads', note: '오전에 올림' });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  const w = srv.since(n).find((c) => c.table === 'post_channels' && c.method === 'POST');
  assert.equal(w.query.on_conflict, 'post_id,channel_id');
  assert.match(w.prefer, /resolution=merge-duplicates/);
  assert.deepEqual(w.body, { post_id: LIVE_POST, channel_id: 'threads', url: 'https://www.threads.net/@me/post/1', posted_on: '2026-10-26', variant_key: 'threads', note: '오전에 올림' });
  const strange = await srv.call('POST', `posts/${LIVE_POST}/channels`, { channel_id: 'tistory', posted_on: '2026-10-26', variant_key: '<script>' });
  assert.equal(strange.status, 200);
  assert.equal(srv.calls.filter((c) => c.table === 'post_channels' && c.method === 'POST').at(-1).body.variant_key, '', '모르는 버전 이름은 빈칸');
  assert.equal((await srv.call('DELETE', `post-channels/${PC_ID}`)).status, 200);
  assert.equal((await srv.call('DELETE', 'post-channels/66666666-6666-4666-8666-666666666666')).status, 404);
});

test('유입 검색어: 같은 검색어는 더해서 한 줄, 빈 숫자는 데이터 없음(null), 이상한 값은 거절, 저장은 DB 함수 하나로', { skip }, async () => {
  db.pre016 = false;
  const n = srv.calls.length;
  const r = await srv.call('POST', `posts/${LIVE_POST}/search-terms`, { period_start: '2026-10-20', period_end: '2026-10-26', source_label: '네이버 블로그 통계',
    terms: [{ term: '원룸 전기요', views: 20 }, { term: ' 원룸   전기요 ', views: 5 }, { term: '전기요 세탁', views: null }] });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.saved, 2);
  const w = srv.since(n).find((c) => c.rpc === 'save_search_terms');
  assert.deepEqual(w.body, { target: LIVE_POST, p_start: '2026-10-20', p_end: '2026-10-26', items: [{ term: '원룸 전기요', views: 25 }, { term: '전기요 세탁', views: null }],
    replace_overlap: false, p_channel: 'naver_blog', p_label: '네이버 블로그 통계' });
  assert.ok(!srv.since(n).some((c) => c.table === 'search_terms' && c.method !== 'GET'), '표에 직접 쓰지 않음 (겹침 확인·저장을 한 번에)');
  const bad = async (body, code, field) => { const x = await srv.call('POST', `posts/${LIVE_POST}/search-terms`, { period_start: '2026-10-20', period_end: '2026-10-26', ...body }); assert.equal(x.status, code === 'too_many_rows' ? 413 : 400, JSON.stringify(x.j)); assert.equal(x.j.error, code); if (field) assert.equal(x.j.field, field); };
  await bad({ terms: [] }, 'empty');
  await bad({ terms: [{ term: '', views: 1 }] }, 'bad_field', 'terms');
  await bad({ terms: [{ term: 'x'.repeat(101), views: 1 }] }, 'bad_field', 'terms');
  await bad({ terms: [{ term: 'x', views: -1 }] }, 'bad_field', 'terms');
  await bad({ terms: [{ term: 'x', views: 1.5 }] }, 'bad_field', 'terms');
  await bad({ period_end: '2026-10-01', terms: [{ term: 'x', views: 1 }] }, 'bad_field', 'period_end');
  await bad({ terms: Array.from({ length: 301 }, (_, i) => ({ term: `t${i}`, views: 1 })) }, 'too_many_rows');
  const nf = await srv.call('POST', 'posts/77777777-7777-4777-8777-777777777777/search-terms', { period_start: '2026-10-20', terms: [{ term: 'x', views: 1 }] });
  assert.equal(nf.status, 404);
});

test('유입 검색어: 기간이 겹치면 409 period_overlap (겹치는 기간을 같이), 확인한 뒤 replace_overlap 이면 저장', { skip }, async () => {
  db.pre016 = false;
  const body = { period_start: '2026-10-20', period_end: '2026-10-26', terms: [{ term: '겹침', views: 4 }] };
  const ov = await srv.call('POST', `posts/${LIVE_POST}/search-terms`, body);
  assert.deepEqual([ov.status, ov.j], [409, { error: 'period_overlap', periods: [{ period_start: '2026-10-19', period_end: '2026-10-25' }] }]);
  const n = srv.calls.length;
  const ok = await srv.call('POST', `posts/${LIVE_POST}/search-terms`, { ...body, replace_overlap: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.equal(srv.since(n).find((c) => c.rpc === 'save_search_terms').body.replace_overlap, true);
  // true 가 아닌 값은 지우라는 뜻으로 안 봄
  await srv.call('POST', `posts/${LIVE_POST}/search-terms`, { ...body, replace_overlap: 'yes' });
  assert.equal(srv.calls.filter((c) => c.rpc === 'save_search_terms').at(-1).body.replace_overlap, false);
});

test('상태 조회: 실적이 있는 글은 DB 함수로, 최근 7일 자동 실행 수는 따로 셈, 못 읽은 표만 unavailable', { skip }, async () => {
  db.pre016 = false;
  const n = srv.calls.length;
  const st = await srv.call('GET', 'state');
  assert.equal(st.status, 200, JSON.stringify(st.j));
  assert.deepEqual([st.j.metric_post_ids, st.j.unavailable, st.j.runs_auto_7d], [[LIVE_POST], [], 21]);
  const cnt = srv.since(n).find((c) => c.table === 'runs' && c.method === 'HEAD');
  assert.equal(cnt.query.kind, 'eq.auto');
  assert.match(cnt.query.ran_at, /^gte\.\d{4}-\d{2}-\d{2}T15:00:00\.000Z$/, '한국 날짜 0시(= UTC 15시)부터');
  assert.match(cnt.prefer, /count=exact/);
  assert.ok(!srv.since(n).some((c) => c.table === 'metrics'), '실적 줄을 다 읽지 않음');
  db.failChannels = true;
  const bad = await srv.call('GET', 'state');
  db.failChannels = false;
  assert.equal(bad.status, 200);
  assert.deepEqual([bad.j.post_channels, bad.j.unavailable], [[], ['post_channels']], '읽다가 오류가 나도 상태 조회는 되고, 그 표는 데이터 없음으로');
});

test('통계: within=1 이면 기간 안에 다 들어가는 실적만 (stats_window), 아니면 지금처럼 stats', { skip }, async () => {
  db.pre016 = false;
  const n = srv.calls.length;
  const w = await srv.call('GET', 'stats?from=2026-10-20&to=2026-10-26&within=1');
  assert.equal(w.status, 200, JSON.stringify(w.j));
  assert.deepEqual([w.j.stats.within, w.j.stats.partial], [true, 1]);
  assert.deepEqual(srv.since(n).find((c) => c.rpc === 'stats_window').body, { d_from: '2026-10-20', d_to: '2026-10-26', within: true });
  const m = srv.calls.length;
  await srv.call('GET', 'stats?from=2026-10-01&to=2026-10-31');
  assert.ok(srv.since(m).some((c) => c.rpc === 'stats') && !srv.since(m).some((c) => c.rpc === 'stats_window'), '다른 통계는 예전 그대로');
});

test('예정일 다시 잡기: DB 함수 결과를 그대로 돌려줌', { skip }, async () => {
  db.pre016 = false;
  const r = await srv.call('POST', 'posts/reschedule-overdue', {});
  assert.deepEqual([r.status, r.j], [200, { moved: [{ id: DRAFT_POST, from: '2026-10-20', to: '2026-10-27' }] }]);
});

test('개선안 요청: 게시한 글만, 같은 글에 기다리는 개선안이 있으면 거절, 고칠 점(focus)은 정해진 것만', { skip }, async () => {
  db.pre016 = false;
  const draft = await srv.call('POST', 'jobs', { kind: 'refresh', post_id: DRAFT_POST });
  assert.deepEqual([draft.status, draft.j.error], [409, 'not_published']);
  db.pendingRefresh = true;
  const dup = await srv.call('POST', 'jobs', { kind: 'refresh', post_id: LIVE_POST });
  assert.deepEqual([dup.status, dup.j.error], [409, 'job_exists']);
  db.pendingRefresh = false;
  const n = srv.calls.length;
  const ok = await srv.call('POST', 'jobs', { kind: 'refresh', post_id: LIVE_POST, focus: 'title', note: '검색어 반영' });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  const ins = srv.since(n).find((c) => c.table === 'requests' && c.method === 'POST').body;
  assert.deepEqual([ins.kind, ins.post_id, ins.payload], ['refresh', LIVE_POST, { focus: 'title', note: '검색어 반영' }]);
  const odd = await srv.call('POST', 'jobs', { kind: 'refresh', post_id: LIVE_POST, focus: 'drop table' });
  assert.equal(odd.status, 200);
  assert.deepEqual(srv.calls.filter((c) => c.table === 'requests' && c.method === 'POST').at(-1).body.payload, { focus: 'all' });
  // 개선안 지우기는 null 만 (화면에서 개선안을 써 넣을 수는 없음)
  assert.equal((await srv.call('POST', `posts/${LIVE_POST}`, { refresh: { titles: ['내가 쓴 것'] } })).status, 400);
  const clear = await srv.call('POST', `posts/${LIVE_POST}`, { refresh: null });
  assert.equal(clear.status, 200, JSON.stringify(clear.j));
  assert.deepEqual(clear.j.post.refresh, {});
});

test('쌓아둘 원고 한도: 0~60만 (0 = 하루 발행 수 × 7), 016 뒤에는 그대로 저장', { skip }, async () => {
  db.pre016 = false;
  assert.equal((await srv.call('POST', 'settings', { backlog_limit: 61 })).status, 400);
  assert.equal((await srv.call('POST', 'settings', { backlog_limit: -1 })).status, 400);
  const ok = await srv.call('POST', 'settings', { backlog_limit: 10 });
  assert.equal(ok.status, 200);
  assert.equal(ok.j.skipped, undefined);
  assert.equal(ok.j.settings.backlog_limit, 10);
  const state = await srv.call('GET', 'state');
  assert.equal(state.j.post_channels.length, 1);
  assert.equal(state.j.search_terms[0].term, '원룸 전기요');
});
