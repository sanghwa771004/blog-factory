// 서버 1.5.0 이미지 스튜디오: 모델 고르기·참고 사진·작은 사본·AI 검수·사용자 평가·수정 이력·모델 비교 기록·연결 확인·키 안 새는지
// 서버 실제 코드를 Deno로 띄우고 가짜 DB API(harness.mjs)로 확인. 서버는 127.0.0.1 말고는 연결하지 못하게 띄움 → 실제 공급자 API는 부르지 않음
// 여기서 통과해도 '실제 생성 성공'이 아님 (점검용 가짜 모델 gf-test-fake 로 저장 흐름만 확인)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HAS_DENO, SKIP as skip, startServer, pg } from './harness.mjs';

const fx = (n) => new Uint8Array(readFileSync(new URL(`../fixtures/img/${n}`, import.meta.url)));
const JPG = fx('photo-4x3.jpg');      // 1280x960
const SMALL = fx('tiny.jpg');         // 64x48
const POST = '66666666-6666-4666-8666-666666666666';
const AI = '77777777-7777-4777-8777-777777777777';
const UP = '88888888-8888-4888-8888-888888888888';
const UP_NORIGHTS = '99999999-9999-4999-8999-999999999999';
const UP_SMALL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BODY = [
  '## 제습기 고르는 법',
  '원룸 책상에 두기 좋은 작은 제습기를 골라 봤어요.',
  '[이미지: 책상 위에 놓인 작은 흰색 제습기]',
  '물통은 하루에 한 번 비우면 돼요.',
  '[이미지: 물통을 비우는 손 (직접 찍기)]',
  '버튼은 두 개뿐이라 쉬워요.',
  '[이미지: 제습기 버튼 부분 (제품 사진)]',
  '원룸에서 쓰기 좋은 기준을 정리했어요. '.repeat(10),
].join('\n');
const SLOT = 'k:책상 위에 놓인 작은 흰색 제습기#1';
const SLOT_OWN = 'k:물통을 비우는 손 (직접 찍기)#1';
const SLOT_REAL = 'k:제습기 버튼 부분 (제품 사진)#1';
const post = { id: POST, stage: 'review', keyword: '원룸 제습기', titles: ['원룸 제습기 고르는 법'], body: BODY, channel_id: 'naver_blog', program_ids: [], variants: {}, refresh: {}, deleted_at: null };
const img = (id, o) => ({ id, kind: 'upload', provider: '', storage_path: `up/${id.slice(0, 4)}.jpg`, mime: 'image/jpeg', bytes: JPG.length, rights_confirmed: true, source_type: 'own', description: '진짜 제품 사진', ref_small_path: '', deleted_at: null, ref_images: [], scene: null, composite: false, ...o });
const images = {
  [AI]: img(AI, { kind: 'ai', provider: 'openai', model: 'gpt-image-2.5-flare', storage_path: 'ai/base.jpg', description: '책상 위 제습기', ref_images: [{ image_id: UP, role: 'subject', kind: 'upload' }], composite: true, scene: { v: 1, type: 'photo', goal: '제품 모습', platform: { purpose: 'blog_body', ratio: '4:3' } } }),
  [UP]: img(UP),
  [UP_NORIGHTS]: img(UP_NORIGHTS, { rights_confirmed: false }),
  [UP_SMALL]: img(UP_SMALL, { ref_small_path: 'small/2026/10/old.jpg' }),
  // AI 합성(AI)을 고친 이미지: 자기 기록에는 참고 사진이 없고 원본이 AI
  [CHILD]: img(CHILD, { kind: 'ai', provider: 'openai', model: 'gpt-image-2.5-sunburst', storage_path: 'ai/child.jpg', ref_images: [], composite: true, parent_image_id: AI }),
};
const SETTINGS = { id: 1, image_gen_model: 'cf-flux-2-klein-4b', image_edit_model: 'gpt-image-2.5-sunburst', image_quality: 'medium', image_daily_limit: 20, image_monthly_budget_usd: 5,
  image_fx_krw: null, image_fx_date: null, image_fx_source: '', image_prices: {}, image_modes: {}, image_review_model: '', image_request_cap_usd: 1, image_ratio_prefs: {} };
const idsOf = (q) => { const v = String(q || ''); const m = /^in\.\((.*)\)$/.exec(v); return m ? m[1].split(',').map((x) => x.replace(/"/g, '')) : v.startsWith('eq.') ? [v.slice(3)] : []; };

// 가짜 DB: 표·DB 함수·저장소 (state.pre017 = true 면 017 전 DB 흉내)
function fakeDb(state) {
  return ({ method, table, rpc, one, body, query, select }) => {
    const t = String(table || '');
    if (t === 'post_image_slots' && method === 'GET') {
      // 017 전 DB: post_images 에 composite 열이 없음 (PostgREST 가 내는 오류 모양)
      if (state.pre017 && /composite/.test(select)) return [400, { code: '42703', details: null, hint: null, message: 'column post_images_1.composite does not exist' }];
      return [200, [{ post_id: POST, slot_key: SLOT, slot_index: 0, image_id: AI, purpose: null, used_at: null, downloaded_at: null,
        post_images: { kind: 'ai', provider: 'openai', review_status: '검수 전', mime: 'image/jpeg', author_name: null, description: '', license: null, attribution_text: null, source_type: '', ...(state.pre017 ? {} : { composite: true }) } }]];
    }
    if (t.startsWith('/storage/v1/object/sign/')) return [200, (body?.paths || []).map((p) => ({ path: p, signedURL: `/object/sign/post-images/${p}?token=t`, error: null }))];
    if (t.startsWith('/storage/v1/object/post-images/') && method === 'GET') return [200, t.includes('small/') ? SMALL : JPG];
    if (t.startsWith('/storage/v1/object/post-images/') && method === 'POST') { state.uploads.push(t); return [200, { Key: t.replace('/storage/v1/object/', '') }]; }
    if (t.startsWith('/storage/v1/object/post-images') && method === 'DELETE') { state.removed.push(...(body?.prefixes || [])); return [200, []]; }
    if (rpc === 'image_usage') return [200, { storage_bytes: 0, today: 0, daily_limit: 20, month_usd: 0, budget_usd: 5, request_cap_usd: 1 }];
    // DB 함수가 raise 한 오류 흉내 (PostgREST 가 내는 모양) — 화면용 오류로 바뀌는지 확인
    if (rpc === 'image_gen_begin' && state.beginError) return [400, { code: 'P0001', details: null, hint: null, message: state.beginError }];
    if (rpc === 'image_review_begin' && state.reviewError) return [400, { code: 'P0001', details: null, hint: null, message: state.reviewError }];
    if (rpc === 'image_gen_begin') {
      state.begins.push(body.p);
      const row = { id: `gen-${state.begins.length}`, status: '생성 중', duplicate: false, ...body.p };
      if (state.pre017) { delete row.refs; row.provider = 'openai'; }
      return [200, row];
    }
    if (rpc === 'image_gen_fail') { state.fails.push(body); return [200, { id: body.gen, status: '실패' }]; }
    if (rpc === 'image_save') { state.saves.push(body); return [200, { image: { id: 'new-img', ...body.img }, generation: { id: body.gen, status: '성공' } }]; }
    if (rpc === 'image_eval_save') { state.evals.push(body.p); return [200, { id: 'ev-1', kind: 'user_eval', ...body.p }]; }
    if (rpc === 'image_lineage') return [200, { root_id: AI, items: [{ id: AI, parent_image_id: null, level: 0, deleted: false, model: 'gpt-image-2.5-flare' }, { id: CHILD, parent_image_id: AI, level: 1, deleted: true, user_prompt: '조명만' }] }];
    if (rpc === 'image_review_begin') { state.reviews.push(body.p); return [200, { id: 'rv-1', status: '진행 중', ...body.p }]; }
    if (rpc === 'image_review_finish') return [200, { id: body.p_review, ...body.fin }];
    if (t === 'posts') return [200, one ? post : [post]];
    if (t === 'settings') {
      if (method === 'PATCH') { state.settingsPatch.push(body); Object.assign(SETTINGS, body); }
      return [200, one ? SETTINGS : [SETTINGS]];
    }
    if (t === 'post_images') {
      if (method === 'PATCH') {
        state.imagePatch.push({ query, body });
        const id = idsOf(query.id)[0];
        if (images[id]) Object.assign(images[id], body);
        return [200, one ? images[id] : images[id] ? [images[id]] : []];
      }
      const rows = idsOf(query.id).map((id) => images[id]).filter(Boolean);
      return [200, one ? rows[0] || {} : rows];
    }
    if (t === 'image_reviews' && state.noReviewsTable) return pg.noTable('image_reviews'); // 017 전 DB (표가 없음)
    if (t === 'image_reviews' && method === 'GET') {
      return [200, [
        { image_id: AI, batch_id: BATCH, model: 'gpt-image-2.5-flare', preferred: true, scores: { fit: 3, ai_look: 2 } },
        { image_id: CHILD, batch_id: BATCH, model: 'gemini-3-pro-image', preferred: false, scores: { fit: 2, ai_look: 3 } },
        { image_id: UP, batch_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', model: 'cf-flux-2-klein-4b', preferred: true, scores: { fit: 1 } }, // 비교 묶음이 아님 (후보 고르기)
      ]];
    }
    if (t === 'image_generations' && method === 'GET' && (query.batch_kind || '') === 'eq.compare') return [200, [{ batch_id: BATCH, model: 'gpt-image-2.5-flare', image_id: AI }, { batch_id: BATCH, model: 'gemini-3-pro-image', image_id: CHILD }]];
    if (t === 'image_provider_checks' && method === 'POST') { state.checks.push(body); return [201, []]; }
    return undefined;
  };
}
const newState = () => ({ pre017: false, noReviewsTable: false, beginError: '', reviewError: '', begins: [], fails: [], saves: [], evals: [], reviews: [], checks: [], uploads: [], removed: [], settingsPatch: [], imagePatch: [] });
const gen = (o) => ({ request_key: 'req-' + Math.random().toString(36).slice(2, 12), post_id: POST, slot_key: SLOT, purpose: 'blog_body', ratio: '4:3', text: '책상 위에 놓인 작은 흰색 제습기', ...o });
const waitFor = async (fn, ms = 15000) => { const until = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > until) return null; await new Promise((ok) => setTimeout(ok, 100)); } };

// 시험용 가짜 키 (진짜 키 아님). 이 글자들이 응답·DB 요청 어디에도 나오면 안 됨
const FAKE = { OPENAI_API_KEY: 'sk-test-not-real-key-0000000000', GEMINI_API_KEY: 'AIzaTEST-not-a-real-key-000000000', CF_ACCOUNT_ID: 'acct-test-0000', CF_API_TOKEN: 'cf-test-token-not-real-0000' };
const ENV = { EDGE_WALL_SECONDS: '400' };

describe('키 없는 서버', () => {
  let srv, st;
  before(async () => { if (!HAS_DENO) return; st = newState(); srv = await startServer(fakeDb(st), { env: ENV }); });
  after(() => srv?.stop());

  test('설정 조회: 공급자마다 키 있음/없음·연결 확인 전 — 모델 이름만으로 연결됐다고 하지 않음', { skip }, async () => {
    const r = await srv.call('GET', 'images/config');
    assert.equal(r.status, 200);
    assert.deepEqual(r.j.keys, { openai: false, gemini: false, pexels: false, cloudflare: false });
    for (const p of ['cloudflare', 'openai', 'gemini']) assert.deepEqual(r.j.provider_status[p], { key: false, check: null, last_success: null, last_failure: null }, p);
  });
  test('백업: 1.5.0 새 표 image_reviews(AI 검수·내 평가)도 담음 — 017 전 DB면 빈 목록과 missing_tables, 연결 확인 기록은 운영 기록이라 안 담음', { skip }, async () => {
    const a = await srv.call('GET', 'export');
    assert.equal(a.status, 200);
    assert.equal(a.j.version, '1.5.0');
    assert.equal(a.j.counts.image_reviews, 3);
    assert.equal(a.j.image_reviews.length, 3);
    assert.ok(a.j.image_reviews.some((r) => r.preferred === true && r.scores.fit === 3), '내 평가가 그대로');
    assert.ok(!('image_provider_checks' in a.j) && !('image_provider_checks' in a.j.counts));
    assert.equal(a.j.missing_tables, undefined);
    assert.match(a.j.note, /AI 검수·내 평가/);
    st.noReviewsTable = true;
    try {
      const b = await srv.call('GET', 'export');
      assert.equal(b.status, 200, '표 하나가 없어도 나머지 백업은 받음');
      assert.deepEqual([b.j.image_reviews, b.j.counts.image_reviews, b.j.missing_tables], [[], null, ['image_reviews']]);
      assert.equal(b.j.counts.posts, 1);
    } finally { st.noReviewsTable = false; }
  });
  test('모르는 모델·종료된 모델·키 없는 공급자: 생성 기록도 만들지 않고 거절 (OpenAI로 보내지 않음)', { skip }, async () => {
    const n = st.begins.length;
    const a = await srv.call('POST', 'images/generate', gen({ model: 'my-new-model' }));
    assert.deepEqual([a.status, a.j.error], [400, 'model_unknown']);
    const b = await srv.call('POST', 'images/generate', gen({ model: 'gpt-image-1' }));
    assert.deepEqual([b.status, b.j.error, b.j.retired], [400, 'model_retired', '2026-10-23']);
    const c = await srv.call('POST', 'images/generate', gen({ model: 'gemini-3-pro-image', quality: 'high' }));
    assert.deepEqual([c.status, c.j.error], [503, 'gemini_key_missing']);
    const d = await srv.call('POST', 'images/generate', gen({ model: 'Bad Model!' }));
    assert.deepEqual([d.status, d.j.error], [400, 'bad_field']);
    assert.equal(st.begins.length, n, '생성 시작 함수를 부르지 않음');
  });
  test('연결 확인: 키가 없으면 공급자를 부르지 않고 그 결과를 기록 (키 값은 기록에 없음)', { skip }, async () => {
    const r = await srv.call('POST', 'images/providers/check', { provider: 'gemini' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.j.check.provider, r.j.check.model, r.j.check.ok, r.j.check.code], ['gemini', 'gemini-3-pro-image', false, 'gemini_key_missing']);
    assert.equal(st.checks.length, 1);
    assert.deepEqual([st.checks[0].provider, st.checks[0].ok], ['gemini', false]);
    const bad = await srv.call('POST', 'images/providers/check', { provider: 'midjourney' });
    assert.equal(bad.status, 400);
  });
  test('사용자 평가: 정해진 항목·1~3점만 저장, 제일 나은 것·묶음 번호, AI 검수와 따로', { skip }, async () => {
    const r = await srv.call('POST', `images/${AI}/evaluate`, { scores: { fit: 3, natural: 5, ai_look: 1, hacker: 3 }, preferred: true, batch_id: BATCH, note: '이게 제일 자연스러워' });
    assert.equal(r.status, 200);
    assert.deepEqual(st.evals.at(-1), { image_id: AI, scores: { fit: 3, ai_look: 1 }, preferred: true, batch_id: BATCH, note: '이게 제일 자연스러워' });
  });
  test('수정 이력: 원본부터 고친 것까지, 지운 이미지는 주소 없이 기록만', { skip }, async () => {
    const r = await srv.call('GET', `images/${AI}/lineage`);
    assert.equal(r.status, 200);
    assert.equal(r.j.root_id, AI);
    assert.equal(r.j.items.length, 2);
    assert.match(r.j.items[0].url, /\/object\/sign\/post-images\/ai\/base\.jpg/);
    assert.equal(r.j.items[1].url, '');
  });
  test('모델 비교 기록: 비교 묶음의 사용자 평가만 (후보 고르기·AI 평가는 섞지 않음), 표본 수와 같이', { skip }, async () => {
    const r = await srv.call('GET', 'images/compare-stats');
    assert.equal(r.status, 200);
    assert.equal(r.j.batches, 1);
    const by = Object.fromEntries(r.j.models.map((m) => [m.model, m]));
    assert.deepEqual(Object.keys(by).sort(), ['gemini-3-pro-image', 'gpt-image-2.5-flare']);
    assert.deepEqual([by['gpt-image-2.5-flare'].rated, by['gpt-image-2.5-flare'].preferred, by['gpt-image-2.5-flare'].avg.fit], [1, 1, 3]);
  });
  test('설정 저장: 모드·검수 모델·한 번 상한·용도별 비율 — 모르는·종료된 모델은 거절, 품질은 그 모델이 받는 것으로', { skip }, async () => {
    const bad = await srv.call('POST', 'settings', { image_modes: { fast_paid: { model: 'my-new-model', quality: 'medium' } } });
    assert.deepEqual([bad.status, bad.j.error], [400, 'model_unknown']);
    const old = await srv.call('POST', 'settings', { image_modes: { fast_paid: { model: 'gpt-image-1', quality: 'medium' } } });
    assert.deepEqual([old.status, old.j.error], [400, 'model_retired']);
    const rv = await srv.call('POST', 'settings', { image_review_model: 'gpt-5-mini' });
    assert.deepEqual([rv.status, rv.j.error], [400, 'review_model_unknown']);
    const ed = await srv.call('POST', 'settings', { image_edit_model: 'cf-flux-1-schnell' });
    assert.deepEqual([ed.status, ed.j.error], [400, 'edit_unsupported']);
    const n = st.settingsPatch.length;
    const ok = await srv.call('POST', 'settings', { image_modes: { gemini_hq: { model: 'gemini-nano-banana-2.1', quality: 'low' }, hq_paid: { model: 'gpt-image-2', quality: 'max' } },
      image_review_model: 'gemini-3.5-flash-lite', image_request_cap_usd: 0.5, image_ratio_prefs: { blog_body: '16:9', nope: '1:1' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.j));
    const p = st.settingsPatch.at(-1);
    assert.equal(st.settingsPatch.length, n + 1);
    assert.deepEqual(p.image_modes, { hq_paid: { model: 'gpt-image-2', quality: 'high' }, gemini_hq: { model: 'gemini-nano-banana-2.1', quality: 'medium' } });
    assert.deepEqual([p.image_review_model, p.image_request_cap_usd, p.image_ratio_prefs], ['gemini-3.5-flash-lite', 0.5, { blog_body: '16:9' }]);
    // Gemini 가격은 등록표의 모델 id 로만 (예전 id 는 저장하지 않음)
    const pr = await srv.call('POST', 'settings', { image_prices: { 'gemini-nano-banana-2.1': { per_image: { '2K': 0.06 }, checked_at: '2026-10-27' }, 'gemini-2.5-flash-image': { per_image: { '1K': 0.01 } } } });
    assert.equal(pr.status, 200);
    const pp = st.settingsPatch.at(-1).image_prices;
    assert.deepEqual([pp['gemini-nano-banana-2.1'].per_image, pp['gemini-nano-banana-2.1'].checked_at, 'gemini-2.5-flash-image' in pp], [{ '2K': 0.06 }, '2026-10-27', false]);
    Object.assign(SETTINGS, { image_modes: {}, image_review_model: '', image_request_cap_usd: 1, image_ratio_prefs: {}, image_prices: {} });
  });
  test('작은 사본 올리기: 512px보다 작은 그림만, 원본은 그대로·예전 사본은 지움', { skip }, async () => {
    const big = new FormData();
    big.append('file', new Blob([JPG], { type: 'image/jpeg' }), 'a.jpg');
    const r1 = await srv.form(`images/${UP_SMALL}/small`, big);
    assert.deepEqual([r1.status, r1.j.error, r1.j.field], [400, 'bad_field', 'file']);
    const fd = new FormData();
    fd.append('file', new Blob([SMALL], { type: 'image/jpeg' }), 'a.jpg');
    const r2 = await srv.form(`images/${UP_SMALL}/small`, fd);
    assert.equal(r2.status, 200, JSON.stringify(r2.j));
    assert.match(r2.j.image.ref_small_path, /^small\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    assert.equal(images[UP_SMALL].storage_path, 'up/aaaa.jpg', '원본 경로는 그대로');
    assert.ok(st.uploads.some((u) => u.includes(r2.j.image.ref_small_path)));
    assert.deepEqual(st.removed, ['small/2026/10/old.jpg']);
  });
  test('상태 조회: 사진 자리 요약에 실제 사진 참고 여부(composite), 017 전 DB면 그 칸만 빼고 한 번 더 읽음', { skip }, async () => {
    let n = srv.calls.length;
    const a = await srv.call('GET', 'state');
    assert.equal(a.status, 200);
    assert.equal(a.j.image_slots[0].post_images.composite, true);
    assert.equal(srv.since(n).filter((c) => c.table === 'post_image_slots').length, 1);
    st.pre017 = true;
    try {
      n = srv.calls.length;
      const b = await srv.call('GET', 'state');
      assert.equal(b.status, 200);
      assert.equal(b.j.image_slots.length, 1);
      const reads = srv.since(n).filter((c) => c.table === 'post_image_slots');
      assert.equal(reads.length, 2);
      assert.ok(reads[0].select.includes('composite') && !reads[1].select.includes('composite') && reads[1].select.includes('source_type'));
    } finally { st.pre017 = false; }
  });
  test('AI 검수: 꺼져 있으면·모르는 모델·AI 이미지가 아니면·키가 없으면 검수를 시작하지 않음', { skip }, async () => {
    const off = await srv.call('POST', `images/${AI}/review`, {});
    assert.deepEqual([off.status, off.j.error], [400, 'review_model_off']);
    const unk = await srv.call('POST', `images/${AI}/review`, { model: 'gpt-5-mini' });
    assert.deepEqual([unk.status, unk.j.error], [400, 'review_model_unknown']);
    const up = await srv.call('POST', `images/${UP}/review`, { model: 'cf-gemma-4-26b' });
    assert.deepEqual([up.status, up.j.error], [400, 'review_ai_only']);
    const nk = await srv.call('POST', `images/${AI}/review`, { model: 'cf-gemma-4-26b', confirm_usd: 0 });
    assert.deepEqual([nk.status, nk.j.error], [503, 'cf_key_missing']);
    assert.equal(st.reviews.length, 0);
  });
});

describe('키 있는 서버 (시험용 가짜 키 — 서버는 바깥에 연결 못 함)', () => {
  let srv, st;
  const bodies = [];
  const call = async (...a) => { const r = await srv.call(...a); bodies.push(JSON.stringify(r.j)); return r; };
  before(async () => { if (!HAS_DENO) return; st = newState(); srv = await startServer(fakeDb(st), { env: { ...ENV, ...FAKE } }); });
  after(() => srv?.stop());

  test('설정 조회: 키는 있음/없음만, 키 값은 어디에도 없음', { skip }, async () => {
    const r = await call('GET', 'images/config');
    assert.deepEqual(r.j.keys, { openai: true, gemini: true, pexels: false, cloudflare: true });
    assert.deepEqual([r.j.provider_status.gemini.key, r.j.provider_status.gemini.check], [true, null], '키가 있어도 연결 확인 전');
  });
  test('참고 사진 검사: 모델이 받는 장수까지만, 고르는 모델이 못 받으면 거절, 없는 사진·권한 확인 안 한 사진은 거절', { skip }, async () => {
    const n = st.begins.length;
    const seven = Array.from({ length: 7 }, (_, i) => ({ image_id: `0000000${i}-0000-4000-8000-00000000000${i}`, role: 'style' }));
    const a = await call('POST', 'images/generate', gen({ model: 'gemini-3-pro-image', quality: 'high', refs: seven }));
    assert.deepEqual([a.status, a.j.error, a.j.max], [400, 'too_many_refs', 6]);
    const b = await call('POST', 'images/generate', gen({ model: 'cf-flux-1-schnell', refs: [{ image_id: UP, role: 'subject' }] }));
    assert.deepEqual([b.status, b.j.error], [400, 'refs_unsupported']);
    const c = await call('POST', 'images/generate', gen({ model: 'gemini-3-pro-image', quality: 'high', refs: [{ image_id: '00000000-0000-4000-8000-0000000000ff', role: 'subject' }] }));
    assert.deepEqual([c.status, c.j.error], [404, 'ref_not_found']);
    const d = await call('POST', 'images/generate', gen({ model: 'gemini-3-pro-image', quality: 'high', refs: [{ image_id: UP_NORIGHTS, role: 'subject' }] }));
    assert.deepEqual([d.status, d.j.error], [400, 'rights_required']);
    const e = await call('POST', 'images/generate', gen({ model: 'gemini-3-pro-image', quality: 'high', refs: [{ image_id: UP, role: 'owner' }] }));
    assert.deepEqual([e.status, e.j.error], [400, 'bad_field']);
    assert.equal(st.begins.length, n);
  });
  test('자리 검사: 직접 찍기 자리는 막고, 제품 모양이 보여야 하는 자리는 진짜 사진(대상 모양 유지)이나 일반 장면 확인이 있어야 함', { skip }, async () => {
    const own = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', slot_key: SLOT_OWN, text: '물통을 비우는 손', refs: [{ image_id: UP, role: 'subject' }] }));
    assert.deepEqual([own.status, own.j.error], [400, 'own_photo_slot'], '참고 사진을 넣어도 직접 찍기 자리는 막음');
    const real = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', slot_key: SLOT_REAL, text: '제습기 버튼 부분' }));
    assert.deepEqual([real.status, real.j.error], [400, 'real_photo_needed']);
    const style = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', slot_key: SLOT_REAL, text: '제습기 버튼 부분', refs: [{ image_id: UP, role: 'style' }] }));
    assert.deepEqual([style.status, style.j.error], [400, 'real_photo_needed'], '구도 참고만으로는 안 됨');
  });
  test('무료 모델(FLUX.2 klein): 작은 사본이 없는 참고 사진이 있으면 409 로 그 id 를 알려줌 (돈 안 나감, 생성 기록 없음)', { skip }, async () => {
    const n = st.begins.length;
    const r = await call('POST', 'images/generate', gen({ model: 'cf-flux-2-klein-4b', refs: [{ image_id: UP, role: 'subject' }, { image_id: UP_SMALL, role: 'style' }] }));
    assert.deepEqual([r.status, r.j.error, r.j.ids], [409, 'ref_small_missing', [UP]]);
    assert.equal(st.begins.length, n);
  });
  test('유료 모델: 화면에서 확인한 예상 비용이 없으면 409 estimate_changed (예상 비용·모델을 돌려줌), 생성 기록 없음', { skip }, async () => {
    const n = st.begins.length;
    const r = await call('POST', 'images/generate', gen({ model: 'gemini-3-pro-image', quality: 'high' }));
    assert.equal(r.status, 409);
    assert.equal(r.j.error, 'estimate_changed');
    assert.equal(r.j.model, 'gemini-3-pro-image');
    assert.equal(r.j.size, '4:3@2K');
    assert.ok(r.j.est_usd >= 0.134 && r.j.est_usd < 0.2, String(r.j.est_usd));
    assert.equal(st.begins.length, n);
  });
  test('점검용 가짜 모델로 저장 흐름: 참고 사진(역할)·장면 설계서(고친 칸)·이미지 종류·묶음·남은 장 예약 → 저장에 참고 사진·실제 사진 참고 여부', { skip }, async () => {
    const r = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', slot_key: SLOT_REAL, text: '제습기 버튼 부분', preset: 'product_still',
      refs: [{ image_id: UP, role: 'subject' }], scene: { light: '창가의 부드러운 낮빛', camera: '눈높이에서 50mm', purpose: '고칠 수 없는 칸' },
      batch: { id: BATCH, kind: 'candidates', index: 0, total: 2 } }));
    assert.equal(r.status, 202, JSON.stringify(r.j));
    const p = st.begins.at(-1);
    assert.deepEqual(p.refs, [{ image_id: UP, role: 'subject' }]);
    assert.equal(p.preset, 'product_still');
    assert.equal(p.scene.preset, 'product_still');
    assert.equal(p.scene.light, '창가의 부드러운 낮빛');
    assert.equal(p.scene.camera, '눈높이에서 50mm');
    assert.notEqual(p.scene.purpose, '고칠 수 없는 칸');
    assert.deepEqual([p.batch_id, p.batch_kind, p.batch_index, p.batch_total, p.reserve_n], [BATCH, 'candidates', 0, 2, 2]);
    assert.match(p.risk_override, /진짜 제품 사진 참고/);
    assert.match(p.prompt, /Reference images/);
    assert.equal(p.provider, 'openai', '점검용 모델은 공급자를 부르지 않음 (기록상 openai)');
    const save = await waitFor(() => st.saves.at(-1));
    assert.ok(save, '저장 함수까지 감: ' + srv.log().slice(-500));
    assert.deepEqual(save.img.ref_images, [{ image_id: UP, role: 'subject', kind: 'upload' }]);
    assert.equal(save.img.composite, true);
    assert.equal(save.img.preset, 'product_still');
    assert.equal(save.img.parent_image_id, '');
    assert.equal(save.fin.provider_called, false);
    assert.equal(save.fin.cost_status, '청구 없음');
  });
  test('017 전 DB: 생성 시작 함수가 새 칸을 모르면 공급자를 부르기 전에 멈추고 409 db_update_needed (청구 없음)', { skip }, async () => {
    st.pre017 = true;
    try {
      const r = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', refs: [{ image_id: UP, role: 'style' }] }));
      assert.deepEqual([r.status, r.j.error, r.j.migration], [409, 'db_update_needed', '017']);
      const f = st.fails.at(-1);
      assert.deepEqual([f.fin.provider_called, f.fin.cost_status, f.fin.error_code], [false, '청구 없음', 'db_update_needed']);
    } finally { st.pre017 = false; }
  });
  test('AI 검수: 유료 검수 모델은 화면에서 확인한 예상 비용이 있어야 시작 (참고 사진 수만큼 이미지 토큰을 더해서)', { skip }, async () => {
    const r = await call('POST', `images/${AI}/review`, { model: 'gpt-5.6-luna' });
    assert.deepEqual([r.status, r.j.error, r.j.model], [409, 'estimate_changed', 'gpt-5.6-luna']);
    // 검수 이미지 1장 + 참고 사진 1장 = 2장 × 308토큰 + 지시문 900 → (1516 × $0.20 + 1000 × $1.20) / 100만
    assert.equal(r.j.est_usd, Math.round(((1516 * 0.2 + 1000 * 1.2) / 1e6) * 1e6) / 1e6);
    assert.equal(st.reviews.length, 0);
  });
  test('DB 함수 오류를 화면용 오류로: 한 번 상한 429 · 검수 중복 409 · 모르는 공급자 400 (그대로 500으로 새지 않음)', { skip }, async () => {
    st.beginError = 'image_request_cap';
    try {
      const a = await call('POST', 'images/generate', gen({ model: 'gf-test-fake' }));
      assert.deepEqual([a.status, a.j.error], [429, 'image_request_cap']);
      st.beginError = 'bad provider: midjourney';
      const b = await call('POST', 'images/generate', gen({ model: 'gf-test-fake' }));
      assert.deepEqual([b.status, b.j.error, b.j.field], [400, 'bad_field', 'provider']);
    } finally { st.beginError = ''; }
    st.reviewError = 'review_busy';
    try {
      const r = await call('POST', `images/${AI}/review`, { model: 'cf-gemma-4-26b', confirm_usd: 0 });
      assert.deepEqual([r.status, r.j.error], [409, 'review_busy']);
      st.reviewError = 'image_request_cap';
      const c = await call('POST', `images/${AI}/review`, { model: 'cf-gemma-4-26b', confirm_usd: 0 });
      assert.deepEqual([c.status, c.j.error], [429, 'image_request_cap']);
    } finally { st.reviewError = ''; }
  });
  test("고친 장면 칸: '넣지 말 것'의 로고·글자는 통과, 그려 달라는 칸(주 피사체·꼭 보일 것)의 로고 요청은 막음", { skip }, async () => {
    const n = st.begins.length;
    const ok = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', scene: { avoid: ['로고', '글자', '가격표'] } }));
    assert.equal(ok.status, 202, JSON.stringify(ok.j));
    assert.deepEqual(st.begins.at(-1).scene.avoid, ['로고', '글자', '가격표']);
    assert.match(st.begins.at(-1).prompt, /Avoid \(Korean\):\n- 로고\n- 글자\n- 가격표/);
    const bad = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', scene: { subject: '로고가 크게 보이는 제습기' } }));
    assert.deepEqual([bad.status, bad.j.error, bad.j.risks.map((r) => r.code)], [400, 'prompt_blocked', ['logo']]);
    const bad2 = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', scene: { must_show: ['제습기 앞면', '브랜드 로고'] } }));
    assert.deepEqual([bad2.status, bad2.j.error], [400, 'prompt_blocked']);
    assert.equal(st.begins.length, n + 1, '막은 요청은 생성 기록을 만들지 않음');
  });
  test('제품 모양 자리: AI 이미지를 대상 모양 유지로 넣어도 진짜 사진이 아니라서 막고, 고친 주 피사체 칸도 같이 봄', { skip }, async () => {
    const n = st.begins.length;
    const ai = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', slot_key: SLOT_REAL, text: '제습기 버튼 부분', refs: [{ image_id: AI, role: 'subject' }] }));
    assert.deepEqual([ai.status, ai.j.error], [400, 'real_photo_needed'], 'AI 이미지는 진짜 제품 사진이 아님');
    // 보통 자리라도 고친 주 피사체 칸이 실제 상품(버튼)을 보여 달라면 같은 판단
    const sc = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', scene: { subject: '제습기 버튼 부분 클로즈업' } }));
    assert.deepEqual([sc.status, sc.j.error], [400, 'real_photo_needed']);
    // '넣지 말 것'에만 있으면 그리라는 뜻이 아님
    const av = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', scene: { avoid: ['없는 버튼 만들기'] } }));
    assert.equal(av.status, 202, JSON.stringify(av.j));
    assert.equal(st.begins.length, n + 1);
  });
  test('AI 합성 이미지를 고치면: 진짜 사진을 다시 안 넣어도 제품 자리를 통과하고(이미 합성), 결과도 AI 합성·고친 원본으로 저장', { skip }, async () => {
    const r = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', mode: 'edit', base_image_id: AI, slot_key: SLOT_REAL, text: '조명만 조금 밝게' }));
    assert.equal(r.status, 202, JSON.stringify(r.j));
    const p = st.begins.at(-1);
    assert.deepEqual([p.mode, p.base_image_id], ['edit', AI]);
    assert.match(p.risk_override, /진짜 제품 사진 참고/);
    const save = await waitFor(() => st.saves.find((x) => x.gen === r.j.generation.id));
    assert.ok(save, '저장 함수까지 감: ' + srv.log().slice(-500));
    assert.deepEqual([save.img.composite, save.img.parent_image_id], [true, AI]);
    // 합성이 아닌 AI 이미지를 고치는 것은 그대로 막음 (진짜 사진 없이 제품 모양 자리를 채우지 않게)
    images[AI].composite = false;
    try {
      const no = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', mode: 'edit', base_image_id: AI, slot_key: SLOT_REAL, text: '조명만 조금 밝게' }));
      assert.deepEqual([no.status, no.j.error], [400, 'real_photo_needed']);
    } finally { images[AI].composite = true; }
  });
  test('묶음 예약: 후보(같은 모델)는 이번 장 × 남은 장 수, 모델 비교는 화면이 보낸 남은 합계 — 어느 쪽이든 이번 장 예상보다 적게 잡지 않음', { skip }, async () => {
    const NB = 'gemini-nano-banana-2.1';
    const probe = await call('POST', 'images/generate', gen({ model: NB, quality: 'high' }));
    assert.deepEqual([probe.status, probe.j.error], [409, 'estimate_changed']);
    const est = probe.j.est_usd;
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    const B2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', B3 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const a = await call('POST', 'images/generate', gen({ model: NB, quality: 'high', confirm_usd: est, reserve_usd: 0.0001, batch: { id: B2, kind: 'candidates', index: 0, total: 3 } }));
    assert.equal(a.status, 202, JSON.stringify(a.j));
    assert.ok(close(st.begins.at(-1).reserve_usd, est * 3) && st.begins.at(-1).reserve_n === 3, JSON.stringify(st.begins.at(-1)));
    const c1 = await call('POST', 'images/generate', gen({ model: NB, quality: 'high', confirm_usd: est, reserve_usd: 0.5, batch: { id: B3, kind: 'compare', index: 0, total: 2 } }));
    assert.equal(c1.status, 202, JSON.stringify(c1.j));
    assert.equal(st.begins.at(-1).reserve_usd, 0.5, '비교는 장마다 모델이 달라서 화면이 보낸 남은 합계');
    const c2 = await call('POST', 'images/generate', gen({ model: NB, quality: 'high', confirm_usd: est, reserve_usd: 0.0001, batch: { id: B3, kind: 'compare', index: 1, total: 2 } }));
    assert.equal(c2.status, 202, JSON.stringify(c2.j));
    assert.ok(close(st.begins.at(-1).reserve_usd, est), '화면이 적게 보내도 이번 장 예상보다 적게 잡지 않음');
    const one = await call('POST', 'images/generate', gen({ model: NB, quality: 'high', confirm_usd: est, reserve_usd: 9 }));
    assert.equal(one.status, 202, JSON.stringify(one.j));
    assert.ok(close(st.begins.at(-1).reserve_usd, est), '묶음이 아니면 이번 장 예상만 (화면 값은 안 씀)');
  });
  test('고친 장면 칸 중 장소·구도·빛은 제품 자리 판단에 안 씀 (화면 왼쪽·카페 내부·소프트박스) — 주 피사체·꼭 보일 것만', { skip }, async () => {
    const r = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', scene: { setting: '카페 내부', composition: '디퓨저는 화면 왼쪽', light: '소프트박스 같은 부드러운 빛' } }));
    assert.equal(r.status, 202, JSON.stringify(r.j));
    const m = await call('POST', 'images/generate', gen({ model: 'gf-test-fake', scene: { must_show: ['제품 라벨'] } }));
    assert.deepEqual([m.status, m.j.error], [400, 'real_photo_needed']);
  });
  test('AI 검수: 고친 AI 합성 이미지는 원본의 참고 사진까지 같이 보내서 예상도 그만큼 (자기 기록에 참고 사진이 없어도)', { skip }, async () => {
    const a = await call('POST', `images/${AI}/review`, { model: 'gpt-5.6-luna' });
    const c = await call('POST', `images/${CHILD}/review`, { model: 'gpt-5.6-luna' });
    assert.deepEqual([c.status, c.j.error], [409, 'estimate_changed']);
    assert.equal(c.j.est_usd, a.j.est_usd, '원본(참고 사진 1장)과 같은 장수');
    images[CHILD].composite = false;
    try {
      const n = await call('POST', `images/${CHILD}/review`, { model: 'gpt-5.6-luna' });
      assert.ok(n.j.est_usd < a.j.est_usd, '합성이 아니면 원본 쪽을 찾지 않음');
    } finally { images[CHILD].composite = true; }
    assert.equal(st.reviews.length, 0, '확인 전이라 검수는 시작하지 않음');
  });
  test('키 값은 응답에도, DB로 보낸 요청에도 없음', { skip }, async () => {
    const all = bodies.join('\n') + '\n' + JSON.stringify(srv.calls);
    for (const [k, v] of Object.entries(FAKE)) assert.ok(!all.includes(v), `${k} 값이 새어 나감`);
  });
});
