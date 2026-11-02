// 서버 1.7.0 전문성·사람 말투: 말투 카드·시리즈·투자 블로그 설정, 사람 말투로 다듬기 요청, 이전 본문·되돌리기,
// 잘 나가는 글 틀(원문 없이 구성·지문만), 숫자 확인표 공식 숫자 대조(ECOS), Pixabay·Unsplash 사진 검색 입구, 공공누리 사진 출처
// 서버 실제 코드를 Deno로 띄우고 가짜 DB API(harness.mjs)로 확인. DB 021 전(pre021)·후 둘 다. 바깥(한국은행·Pixabay·Unsplash)에는 연결 못 함
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HAS_DENO, SKIP as skip, startServer, pg } from './harness.mjs';

const POST = '77777777-7777-4777-8777-777777777777';
const MARKET = '88888888-8888-4888-8888-888888888888';
const SHORT = '99999999-9999-4999-8999-999999999999';
const REV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TPL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const body = '[이미지: (썸네일) 제목 카드]\n## 소제목\n' + '원룸에서 쓰기 좋은 기준을 정리했어요. '.repeat(20);
const mkState = () => ({
  pre021: false,
  posts: {
    [POST]: { id: POST, stage: 'ready', source: 'auto', plan_kind: 'adpost', keyword: '겨울 가습기 세척 방법', titles: ['겨울 가습기 세척'], body, channel_id: 'naver_blog', program_ids: [], variants: {}, refresh: {}, figures: [], deleted_at: null },
    [MARKET]: { id: MARKET, stage: 'review', source: 'auto', plan_kind: 'market', keyword: '오늘 코스피 마감 정리', titles: ['[오늘의 증시 11/2] 코스피'], body, channel_id: 'naver_blog_invest', program_ids: [],
      figures: [
        { label: '코스피 종가', value: '2,612.45', unit: '포인트', as_of: '2026-11-02', source_url: 'https://data.krx.co.kr/' },
        { label: '원/달러 환율', value: '1,385.2', unit: '원', as_of: '' },
        { label: '삼성전자 영업이익', value: '9.1', unit: '조원', as_of: '2026-10-31' },
      ], deleted_at: null },
    [SHORT]: { id: SHORT, stage: 'review', source: 'manual', plan_kind: '', keyword: 'x', titles: ['x'], body: '짧아요', channel_id: 'naver_blog', program_ids: [], deleted_at: null },
  },
  requests: [],
  settings: { id: 1, per_day: 1, auto_enabled: true, voice: {}, series: { market: '오늘의 증시', stock: '종목 한 장 정리' }, invest_channel: 'naver_blog_invest', brand_name: '' },
  templates: [],
  revertCalls: [],
});
let db = mkState();
let srv;
const idOf = (q) => String(q.id || '').replace(/^eq\./, '');

const handle = ({ method, table, rpc, one, body: b, query, select }) => {
  if (rpc === 'expire_auto_posts') return [200, { expired: 0, keep_days: 3 }];
  if (rpc === 'plan_today') return [200, { date: '2026-11-02', plan: {}, keep_days: 3, done: {}, series: db.settings.series, series_next: { market: 3 } }];
  if (rpc === 'metric_post_ids') return [200, []];
  if (rpc === 'revert_post') {
    db.revertCalls.push(b);
    if (b.rev !== REV) return [400, { code: 'P0001', message: 'revision not found' }];
    return [200, { post_id: POST, restored_from: '2026-11-02T10:00:00Z' }];
  }
  if (table === 'runs' && method === 'HEAD') return [200, [], { 'content-range': '*/0' }];
  if (table === 'posts' && method === 'GET') {
    const id = idOf(query);
    return id ? [200, one ? (db.posts[id] || null) : (db.posts[id] ? [db.posts[id]] : [])] : [200, Object.values(db.posts)];
  }
  if (table === 'requests') {
    if (method === 'HEAD') return [200, [], { 'content-range': '*/0' }];
    if (method === 'GET') {
      if (query.kind === 'eq.polish') return [200, db.requests.filter((r) => r.kind === 'polish' && r.post_id === String(query.post_id).replace(/^eq\./, '') && r.status === 'pending').map((r) => ({ id: r.id }))];
      return [200, db.requests];
    }
    if (method === 'POST') {
      if (db.pre021 && b.kind === 'polish') return pg.check('requests', 'requests_kind_check');
      const row = { id: 'cccccccc-cccc-4ccc-8ccc-' + String(db.requests.length).padStart(12, '0'), status: 'pending', attempts: 0, created_at: new Date().toISOString(), ...b };
      db.requests.push(row);
      return [201, one ? row : [row]];
    }
  }
  if (table === 'post_revisions') {
    if (db.pre021) return pg.noTable('post_revisions');
    return [200, [{ id: REV, reason: 'polish', job_id: null, body: '이전 본문', titles: ['이전 제목'], created_at: '2026-11-02T10:00:00Z' }]];
  }
  if (table === 'post_templates') {
    if (db.pre021) return pg.noTable('post_templates');
    if (method === 'HEAD') return [200, [], { 'content-range': `*/${db.templates.length}` }];
    if (method === 'GET') return [200, db.templates];
    if (method === 'POST') { const row = { id: TPL, active: true, created_at: new Date().toISOString(), ...b }; db.templates.push(row); return [201, one ? row : [row]]; }
    if (method === 'PATCH') { const t = db.templates.find((x) => x.id === idOf(query)); if (!t) return [200, one ? null : []]; Object.assign(t, b); return [200, one ? t : [t]]; }
    if (method === 'DELETE') { const n = db.templates.length; db.templates = db.templates.filter((x) => x.id !== idOf(query)); return [200, n === db.templates.length ? [] : [{ id: idOf(query) }]]; }
  }
  if (table === 'settings') {
    if (method === 'PATCH') {
      for (const c of ['voice', 'series', 'invest_channel', 'brand_name']) if (db.pre021 && c in b) return pg.noColumn(c, 'settings');
      Object.assign(db.settings, b);
    }
    return [200, one ? db.settings : [db.settings]];
  }
  if (table === 'channels') {
    const all = [{ id: 'naver_blog', name: '네이버 블로그', kind: 'blog', active: true }, { id: 'naver_blog_invest', name: '네이버 블로그 (투자)', kind: 'blog', active: true }, { id: 'threads', name: '쓰레드', kind: 'sns', active: true }];
    const id = idOf(query);
    if (id) { const ch = all.find((x) => x.id === id) || null; return [200, one ? ch : (ch ? [ch] : [])]; }
    return [200, all];
  }
  if (table === 'programs' || table === 'program_channels') return [200, []];
  if (table === 'api_calls') return method === 'HEAD' ? [200, [], { 'content-range': '*/0' }] : [201, []];
  if (table === 'api_cache') {
    // maybeSingle() 은 GET 을 배열로 받아서 화면 쪽(supabase-js)이 하나만 꺼냄
    const row = { body: { provider: 'pixabay', photos: [{ id: 1 }], total: 1, page: 1, has_next: false } };
    if (method === 'GET') return String(query.key || '') === 'eq.pixabay:창가 가습기||1' ? [200, one ? row : [row]] : [200, one ? null : []];
    return [201, []];
  }
  return undefined;
};

before(async () => { if (!HAS_DENO) return; srv = await startServer(handle); });
after(() => srv?.stop());

describe('021 전 DB', () => {
  test('화면은 열리고(틀 null), 말투·시리즈·투자 채널 저장은 건너뜀, 다듬기·틀은 DB 업데이트 필요, 이전 본문은 빈 목록', { skip }, async () => {
    db = mkState(); db.pre021 = true;
    const st = await srv.call('GET', 'state');
    assert.equal(st.status, 200, JSON.stringify(st.j).slice(0, 300));
    assert.equal(st.j.templates, null);
    const s = await srv.call('POST', 'settings', { per_day: 2, voice: { general: { preset: 'calm' } }, series: { market: '증시 한눈에' }, invest_channel: '', brand_name: '상화' });
    assert.equal(s.status, 200, JSON.stringify(s.j));
    assert.deepEqual(s.j.skipped.sort(), ['brand_name', 'invest_channel', 'series', 'voice']);
    const p = await srv.call('POST', 'jobs', { kind: 'polish', post_id: POST });
    assert.deepEqual([p.status, p.j], [409, { error: 'db_update_needed', migration: '021' }]);
    const r = await srv.call('GET', `posts/${POST}/revisions`);
    assert.deepEqual([r.status, r.j], [200, { revisions: [], unavailable: true }]);
    const t = await srv.call('POST', 'templates', { name: '틀', outline: [{ role: '방법' }], stats: {}, fp: [1, 2] });
    assert.deepEqual([t.status, t.j], [409, { error: 'db_update_needed', migration: '021' }]);
  });
});

describe('021 뒤', () => {
  before(() => { db = mkState(); });
  test('화면 상태에 틀 목록(구성·지문만)', { skip }, async () => {
    db.templates = [{ id: TPL, kind: '', name: '가습기 총정리', outline: [{ role: '개념' }], stats: { chars: 333 }, fp: [1, 2, 3], note: '', active: true }];
    const st = await srv.call('GET', 'state');
    assert.equal(st.status, 200);
    assert.equal(st.j.templates.length, 1);
    assert.equal(st.j.version, '1.7.0');
    db.templates = [];
  });
  test('말투 카드: 기본 말투 이름만 받고, 내 말투는 카드·예시 3개까지 (원문은 안 받음), 모르는 이름은 범위 기본값', { skip }, async () => {
    const card = '말투: 해요체 (해요체 88%). 문장 길이: 평균 22자.';
    const s = await srv.call('POST', 'settings', { voice: { general: { preset: 'nope', source: 'mine', card, examples: ['a', 'b', 'c', 'd', 5], stats: { style: '해요체' }, raw_text: '원문 전체' }, invest: { preset: 'calm' } } });
    assert.equal(s.status, 200, JSON.stringify(s.j));
    const v = db.settings.voice;
    assert.deepEqual([v.general.preset, v.general.source, v.general.card, v.general.examples], ['friendly', 'mine', card, ['a', 'b', 'c']]);
    assert.ok(!('raw_text' in v.general), '원문은 저장 안 함');
    assert.deepEqual([v.invest.preset, v.invest.source, v.invest.card], ['calm', 'preset', '']);
    const mineNoCard = await srv.call('POST', 'settings', { voice: { general: { source: 'mine', card: '' } } });
    assert.equal(mineNoCard.status, 200);
    assert.equal(db.settings.voice.general.source, 'preset', '카드가 비면 기본 말투로');
    for (const bad of [[1], 'x', { general: [1] }]) assert.equal((await srv.call('POST', 'settings', { voice: bad })).status, 400, JSON.stringify(bad));
  });
  test('시리즈 이름·투자 블로그 채널·브랜드 이름', { skip }, async () => {
    const s = await srv.call('POST', 'settings', { series: { market: ' 증시 한눈에 ', stock: '', nope: 'x' }, invest_channel: 'naver_blog_invest', brand_name: '  상화의 생활 노트  ' });
    assert.equal(s.status, 200, JSON.stringify(s.j));
    assert.deepEqual(db.settings.series, { market: '증시 한눈에' }, '빈 이름·모르는 종류는 버림');
    assert.equal(db.settings.invest_channel, 'naver_blog_invest');
    assert.equal(db.settings.brand_name, '상화의 생활 노트');
    for (const bad of [{ series: { market: '[증시]' } }, { series: { market: 'x'.repeat(21) } }, { series: [] }, { invest_channel: 'threads' }, { invest_channel: 'nope' }]) {
      const r = await srv.call('POST', 'settings', bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    const off = await srv.call('POST', 'settings', { invest_channel: '' });
    assert.equal(off.status, 200);
    assert.equal(db.settings.invest_channel, '', '비우면 같은 블로그');
  });
  test('사람 말투로 다듬기 요청: 본문 있는 글만, 투자 글은 투자 말투, 같은 글에 기다리는 요청이 있으면 다시 안 넣음', { skip }, async () => {
    db.requests = [];
    const a = await srv.call('POST', 'jobs', { kind: 'polish', post_id: POST, note: ' 더 짧게 ' });
    assert.equal(a.status, 200, JSON.stringify(a.j));
    assert.deepEqual([a.j.job.kind, a.j.job.post_id, a.j.job.payload], ['polish', POST, { voice: 'general', note: '더 짧게' }]);
    const dup = await srv.call('POST', 'jobs', { kind: 'polish', post_id: POST });
    assert.deepEqual([dup.status, dup.j.error], [409, 'job_exists']);
    const m = await srv.call('POST', 'jobs', { kind: 'polish', post_id: MARKET });
    assert.equal(m.j.job.payload.voice, 'invest', '증시 글은 투자 말투');
    assert.equal((await srv.call('POST', 'jobs', { kind: 'polish', post_id: SHORT })).j.error, 'no_body');
    assert.equal((await srv.call('POST', 'jobs', { kind: 'polish', post_id: 'nope' })).status, 400);
  });
  test('이전 본문 목록·되돌리기 (DB 함수 revert_post)', { skip }, async () => {
    const r = await srv.call('GET', `posts/${POST}/revisions`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.j.revisions.map((x) => x.reason), ['polish']);
    const ok = await srv.call('POST', `revisions/${REV}/revert`, {});
    assert.equal(ok.status, 200, JSON.stringify(ok.j));
    assert.equal(ok.j.post.id, POST);
    assert.equal(ok.j.restored_from, '2026-11-02T10:00:00Z');
    const missing = await srv.call('POST', 'revisions/cccccccc-cccc-4ccc-8ccc-cccccccccccc/revert', {});
    assert.equal(missing.status, 404);
    assert.deepEqual(db.revertCalls.map((x) => x.rev), [REV, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
  });
  test('잘 나가는 글 틀: 구성·통계·지문만 저장 (원문 칸은 버림), 모르는 역할·이상한 지문은 거절, 50개까지', { skip }, async () => {
    db.templates = [];
    const n0 = srv.calls.length;
    const c = await srv.call('POST', 'templates', { kind: 'adpost', name: '  가습기 총정리  ', outline: [{ role: '개념', size: '길게', list: true, extra: 1 }, { role: 'FAQ', size: '???' }], stats: { chars: 333.4, photos: 99, intro: '질문으로 시작', style: '사투리' }, fp: [1, -2, 2147483647], text: '원문 전체를 보내도', note: '메모' });
    assert.equal(c.status, 200, JSON.stringify(c.j));
    const ins = srv.since(n0).find((x) => x.table === 'post_templates' && x.method === 'POST').body;
    assert.deepEqual(Object.keys(ins).sort(), ['fp', 'kind', 'name', 'note', 'outline', 'stats']);
    assert.equal(ins.name, '가습기 총정리');
    assert.deepEqual(ins.outline, [{ role: '개념', size: '길게', list: true, question: false }, { role: 'FAQ', size: '보통', list: false, question: false }]);
    assert.deepEqual([ins.stats.chars, ins.stats.photos, ins.stats.intro, ins.stats.style], [333, 30, '질문으로 시작', '']);
    for (const bad of [{ outline: [{ role: '해킹' }], fp: [] }, { outline: 'x', fp: [] }, { outline: [], fp: [1.5] }, { outline: [], fp: [2 ** 31] }, { outline: [], fp: 'x' }, { kind: 'nope', outline: [], fp: [] }]) {
      assert.equal((await srv.call('POST', 'templates', bad)).status, 400, JSON.stringify(bad));
    }
    const p = await srv.call('POST', `templates/${TPL}`, { active: false, name: '' });
    assert.equal(p.status, 200, JSON.stringify(p.j));
    assert.deepEqual([db.templates[0].active, db.templates[0].name], [false, '참고 글']);
    assert.equal((await srv.call('POST', `templates/${TPL}`, {})).status, 400);
    assert.equal((await srv.call('DELETE', `templates/${TPL}`)).status, 200);
    assert.equal((await srv.call('DELETE', `templates/${TPL}`)).status, 404);
    db.templates = Array.from({ length: 50 }, (_, i) => ({ id: 'x' + i }));
    const full = await srv.call('POST', 'templates', { outline: [], fp: [] });
    assert.deepEqual([full.status, full.j.error, full.j.max], [409, 'too_many', 50]);
    db.templates = [];
  });
  test('숫자 확인표 대조: 키가 없으면 503, 키가 있어도 한국은행에 못 닿으면 "대조 못 함" (지어내지 않음), 한국은행에 없는 항목은 "대조 안 함"', { skip }, async () => {
    const none = await srv.call('POST', `posts/${MARKET}/verify-figures`, {});
    assert.deepEqual([none.status, none.j.error], [503, 'ecos_key_missing']);
  });
});

describe('ECOS 키가 있는 서버 (시험용 가짜 키 — 바깥에 연결 못 함)', () => {
  let srv2;
  before(async () => { if (!HAS_DENO) return; db = mkState(); srv2 = await startServer(handle, { env: { ECOS_API_KEY: 'test-ecos-not-a-key', PIXABAY_API_KEY: 'test-pixabay-not-a-key' } }); });
  after(() => srv2?.stop());
  test('대조 결과: 연결 실패는 "대조 못 함", 날짜 없는 줄·한국은행에 없는 항목도 솔직하게, 키는 응답에 없음', { skip }, async () => {
    const r = await srv2.call('POST', `posts/${MARKET}/verify-figures`, {});
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.deepEqual(r.j.results.map((x) => [x.label, x.status]), [['코스피 종가', '대조 못 함'], ['원/달러 환율', '대조 못 함'], ['삼성전자 영업이익', '대조 안 함']]);
    assert.equal(r.j.results[0].note, '한국은행에 연결하지 못했어');
    assert.equal(r.j.results[1].note, '기준 날짜가 없어');
    assert.equal(r.j.source, '한국은행 경제통계시스템(ECOS)');
    assert.ok(!JSON.stringify(r.j).includes('test-ecos-not-a-key'), '키가 응답에 없음');
    const cfg = await srv2.call('GET', 'images/config');
    assert.deepEqual([cfg.j.keys.ecos, cfg.j.keys.pixabay, cfg.j.keys.unsplash], [true, true, false]);
    assert.ok(!JSON.stringify(cfg.j).includes('not-a-key'));
  });
  test('사진 검색 입구: 공급자 이름 검사, 키 없는 공급자는 503, 바깥에 못 닿으면 502 (키는 오류에 없음)', { skip }, async () => {
    const un = await srv2.call('GET', 'stock/search?provider=unsplash&q=' + encodeURIComponent('가습기'));
    assert.deepEqual([un.status, un.j.error], [503, 'photo_key_missing']);
    const bad = await srv2.call('GET', 'stock/search?provider=shutterstock&q=a');
    assert.equal(bad.status, 400);
    const px = await srv2.call('GET', 'stock/search?provider=pixabay&q=' + encodeURIComponent('가습기'));
    assert.deepEqual([px.status, px.j.error], [502, 'pixabay_network']);
    assert.ok(!JSON.stringify(px.j).includes('not-a-key'));
    // 고르기: Pixabay 는 숫자 번호만 (Unsplash 는 아래 — 번호와 상관없이 고르기 자체를 안 받음)
    const s1 = await srv2.call('POST', 'stock/select', { provider: 'unsplash', photo_id: 123 });
    assert.deepEqual([s1.status, s1.j.error], [409, 'unsplash_link_only']);
    const s2 = await srv2.call('POST', 'stock/select', { provider: 'pixabay', photo_id: 'abc-DEF_123' });
    assert.deepEqual([s2.status, s2.j.error, s2.j.field], [400, 'bad_field', 'photo_id']);
    // Unsplash 는 검색만 — 고르기(서버 복사)는 거절 (키가 없어도, 바깥에 닿기 전에)
    const s3 = await srv2.call('POST', 'stock/select', { provider: 'unsplash', photo_id: 'Dwu85P9SOIk' });
    assert.deepEqual([s3.status, s3.j.error], [409, 'unsplash_link_only']);
    // Pixabay: 24시간 안에 같은 검색은 DB 에 저장한 결과로 (바깥에 안 감 — 이용 조건)
    const n0 = srv2.calls.length;
    const hit = await srv2.call('GET', 'stock/search?provider=pixabay&q=' + encodeURIComponent('창가 가습기'));
    assert.equal(hit.status, 200, JSON.stringify(hit.j));
    assert.deepEqual([hit.j.cached, hit.j.photos.length], [true, 1]);
    assert.ok(!srv2.since(n0).some((c) => c.table === 'api_calls'), '저장한 결과면 호출 기록도 안 남김');
  });
});
