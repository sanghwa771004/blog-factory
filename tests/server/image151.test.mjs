// 서버 1.5.1 상품 사진으로 장면 만들기: 마스크 저장·원본 보존 합성 저장·상품 장면 생성(두 방식)·상품 디테일 검수·승인 전 막기
// 서버 실제 코드를 Deno로 띄우고 가짜 DB API(harness.mjs)로 확인. 서버는 127.0.0.1 말고는 연결하지 못하게 띄움 → 실제 공급자 API는 부르지 않음
// 여기서 통과해도 '실제 생성 성공'·'실제 이미지 품질 확인'이 아님 (점검용 가짜 모델 gf-test-fake 로 기록 흐름만 확인)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { HAS_DENO, SKIP as skip, startServer, pg } from './harness.mjs';
import { PRODUCT_CHECKS } from '../../images.js';

const fx = (n) => new Uint8Array(readFileSync(new URL(`../fixtures/img/${n}`, import.meta.url)));
const JPG = fx('photo-4x3.jpg'); // 1280x960
// 작은 PNG 만들기 (RGBA, 한 색) — 마스크·합성 결과 파일 흉내
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgba = [255, 255, 255, 255]) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + w * 4); for (let x = 0; x < w; x++) row.set(rgba, 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const MASK_PNG = png(640, 480);       // 상품 사진(1280x960)과 같은 4:3
const MASK_BAD = png(640, 640);       // 비율이 다름
const COMP_PNG = png(400, 300, [120, 140, 160, 255]);

const POST = '11111111-1111-4111-8111-111111111111';
const READY = '22222222-2222-4222-8222-222222222222';
const PROD = '33333333-3333-4333-8333-333333333333';
const NORIGHTS = '44444444-4444-4444-8444-444444444444';
const STOCK = '55555555-5555-4555-8555-555555555555';
const AI = '66666666-6666-4666-8666-666666666666';
const BG = '77777777-7777-4777-8777-777777777777';
const COMP = '88888888-8888-4888-8888-888888888888';
const COMP_OK = '99999999-9999-4999-8999-999999999999';
const REF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MASK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BG_STOCK = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';   // Pexels 상품 사진용 빈 배경
const GONE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';       // 지운 상품 사진
const REF_GONE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';   // 지운 상품 사진으로 만든 AI 실사 장면
const CARD = 'abababab-abab-4bab-8bab-abababababab';       // AI 실사 장면(REF)을 배경으로 그린 카드뉴스 PNG
const BODY = [
  '## 원룸 전기요 고르는 기준', '원룸 전기요는 크기와 온도 조절 단계를 먼저 봐야 해요. 전자파 인증 표시도 확인하세요.',
  '- 크기가 침대와 맞는지', '- 온도 조절이 여러 단계인지', '[이미지: 침대 위에 깔린 전기요]', '[이미지: 전기요를 접는 손 (직접 찍기)]', '[이미지: 전기요 온도 조절기 버튼 (제품 사진)]',
  '## 전기요 관리', '세탁 가능한지 라벨을 확인하세요. 접어서 보관하면 열선이 상할 수 있어요.',
  '원룸 전기요를 고를 때는 내 생활 패턴을 먼저 떠올려 보세요. 잘 때만 쓰는지, 낮에도 쓰는지에 따라 맞는 제품이 달라요.',
].join('\n');
const SLOT = 'k:침대 위에 깔린 전기요#1';
const SLOT_OWN = 'k:전기요를 접는 손 (직접 찍기)#1';
const SLOT_REAL = 'k:전기요 온도 조절기 버튼 (제품 사진)#1';
const mkPost = (id, stage) => ({ id, stage, keyword: '원룸 전기요', titles: ['원룸 전기요 고르는 법'], body: BODY, channel_id: 'naver_blog', program_ids: [], content_type: 'buying_guide', experience: '', sources: [], variants: {}, refresh: {}, deleted_at: null, publish_date: '2026-11-01' });
const POSTS = { [POST]: mkPost(POST, 'review'), [READY]: mkPost(READY, 'ready') };
const LAYER = { x: 0.5, y: 0.86, h: 0.5, rot: 0, shadow: { o: 0.45, s: 0.5, dx: 0 }, tone: { b: 0, w: 0 }, bg: { b: 0, w: 0 }, mask: { feather: 1, shrink: 0 } };
const base = (id, o) => ({ id, kind: 'upload', provider: 'upload', storage_path: `upload/${id.slice(0, 4)}.jpg`, mime: 'image/jpeg', bytes: JPG.length, width: 1280, height: 960, rights_confirmed: true,
  source_type: 'own', description: '내 전기요 사진', license: '직접 올림 (사용 권한 확인함)', ref_small_path: '', deleted_at: null, ref_images: [], scene: null, composite: false, composite_mode: '',
  product_image_id: null, background_image_id: null, mask_id: null, layer: null, product_check: null, review_status: '검수 전', generation_id: null, preset: '', ...o });
const IMAGES = () => ({
  [PROD]: base(PROD),
  [NORIGHTS]: base(NORIGHTS, { rights_confirmed: false }),
  [STOCK]: base(STOCK, { kind: 'stock', provider: 'pexels', author_name: '김사진', author_url: 'https://www.pexels.com/@kim', source_url: 'https://www.pexels.com/photo/1', license: 'Pexels 라이선스 (https://www.pexels.com/license/)', source_type: '' }),
  [AI]: base(AI, { kind: 'ai', provider: 'openai', storage_path: 'ai/plain.jpg' }),
  [BG]: base(BG, { kind: 'ai', provider: 'cloudflare', storage_path: 'ai/bg.jpg', preset: 'pscene_layer', product_image_id: PROD, generation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
  [COMP]: base(COMP, { kind: 'composite', provider: 'composite', storage_path: 'composite/c.png', mime: 'image/png', composite_mode: 'layer', product_image_id: PROD, background_image_id: BG, mask_id: MASK, layer: LAYER }),
  [COMP_OK]: base(COMP_OK, { kind: 'composite', provider: 'composite', storage_path: 'composite/ok.png', mime: 'image/png', composite_mode: 'layer', product_image_id: PROD, background_image_id: BG, mask_id: MASK, layer: LAYER,
    product_check: { mode: 'layer', approved: true, items: Object.fromEntries(PRODUCT_CHECKS.map(([k]) => [k, 'ok'])) }, review_status: '사용 가능' }),
  [REF]: base(REF, { kind: 'ai', provider: 'openai', storage_path: 'ai/ref.jpg', composite: true, composite_mode: 'reference', product_image_id: PROD, preset: 'pscene_ref', ref_images: [{ image_id: PROD, role: 'subject', kind: 'upload' }] }),
  [BG_STOCK]: base(BG_STOCK, { kind: 'ai', provider: 'cloudflare', storage_path: 'ai/bg2.jpg', preset: 'pscene_layer', product_image_id: STOCK }),
  [GONE]: base(GONE, { deleted_at: '2026-10-28T00:00:00Z' }),
  [REF_GONE]: base(REF_GONE, { kind: 'ai', provider: 'openai', storage_path: 'ai/refg.jpg', composite: true, composite_mode: 'reference', product_image_id: GONE, preset: 'pscene_ref' }),
  [CARD]: base(CARD, { kind: 'card', provider: 'cardnews', storage_path: 'card/c.png', mime: 'image/png', background_image_id: REF, license: '카드뉴스 (앱에서 직접 만듦) · 배경: AI 합성 이미지 (실제 사진 참고)' }),
});
const SETTINGS = { id: 1, image_gen_model: 'cf-flux-2-klein-4b', image_edit_model: 'gpt-image-2.5-sunburst', image_quality: 'medium', image_daily_limit: 20, image_monthly_budget_usd: 5,
  image_fx_krw: null, image_fx_date: null, image_fx_source: '', image_prices: {}, image_modes: {}, image_review_model: '', image_request_cap_usd: 1, image_ratio_prefs: {} };
const idsOf = (q) => { const v = String(q || ''); const m = /^in\.\((.*)\)$/.exec(v); return m ? m[1].split(',').map((x) => x.replace(/"/g, '')) : v.startsWith('eq.') ? [v.slice(3)] : []; };

function fakeDb(st) {
  return ({ method, table, rpc, one, body, query, select }) => {
    const t = String(table || '');
    const images = st.images;
    if (t === 'product_masks') {
      if (st.no018) return pg.noTable('product_masks');
      return [200, one ? { id: MASK, image_id: PROD, storage_path: 'mask/2026/10/m1.png', method: 'auto_u2netp', cost_usd: 0, cost_status: '청구 없음', deleted_at: null }
        : [{ id: MASK, image_id: PROD, storage_path: 'mask/2026/10/m1.png', method: 'auto_u2netp', cost_usd: 0, cost_status: '청구 없음', deleted_at: null }]];
    }
    if (t.startsWith('/storage/v1/object/sign/')) return [200, (body?.paths || []).map((p) => ({ path: p, signedURL: `/object/sign/post-images/${p}?token=t`, error: null }))];
    if (t.startsWith('/storage/v1/object/post-images/') && method === 'GET') return [200, JPG];
    if (t.startsWith('/storage/v1/object/post-images/') && (method === 'POST' || method === 'PUT')) { st.uploads.push(t.replace('/storage/v1/object/post-images/', '')); return [200, { Key: t.replace('/storage/v1/object/', '') }]; }
    if (t.startsWith('/storage/v1/object/post-images') && method === 'DELETE') { st.removed.push(...(body?.prefixes || [])); return [200, []]; }
    if (rpc === 'image_usage') return [200, { storage_bytes: 0, today: 0, daily_limit: 20, month_usd: 0, budget_usd: 5, request_cap_usd: 1 }];
    if (rpc === 'image_mask_save') {
      st.maskSaves.push(body.p);
      if (st.maskError) return [400, { code: 'P0001', details: null, hint: null, message: st.maskError }];
      return [200, { id: MASK, cost_usd: 0, cost_status: '청구 없음', ...body.p }];
    }
    if (rpc === 'image_save') {
      st.saves.push(body);
      if (st.saveError) return [400, { code: 'P0001', details: null, hint: null, message: st.saveError }];
      return [200, { image: { id: 'new-img', ...body.img }, slot: body.link ? { post_id: body.link.post_id, slot_key: body.link.slot_key } : null, generation: body.gen ? { id: body.gen, status: '성공' } : null }];
    }
    if (rpc === 'image_product_check') {
      st.checks.push(body);
      const cur = images[body.p_image];
      if (!cur) return [400, { code: 'P0001', details: null, hint: null, message: 'image not found' }];
      if (!cur.composite_mode) return [400, { code: 'P0001', details: null, hint: null, message: 'not_product_scene' }];
      Object.assign(cur, { product_check: { mode: cur.composite_mode, items: body.p.items, approved: body.p.approve }, review_status: body.p.approve ? '사용 가능' : cur.review_status === '사용 가능' ? '검수 전' : cur.review_status });
      return [200, cur];
    }
    if (rpc === 'image_gen_begin') { st.begins.push(body.p); return [200, { id: `gen-${st.begins.length}`, status: '생성 중', duplicate: false, ...body.p }]; }
    if (rpc === 'image_gen_fail') { st.fails.push(body); return [200, { id: body.gen, status: '실패' }]; }
    if (rpc === 'image_delete') return [200, { storage_path: 'upload/3333.jpg', ref_small_path: '', mask_paths: ['mask/2026/10/m1.png'] }];
    if (t === 'post_image_slots' && method === 'GET') {
      if (select.replace(/\s/g, '').includes('post_images(kind,composite_mode,product_check')) return [200, (st.slotRows[idsOf(query.post_id)[0]] || [])];
      if (query.image_id) return [200, idsOf(query.image_id).flatMap((id) => st.usedBy[id] || [])];
      // 자리 하나 (지금 그 자리에 있는 이미지·용도)
      if (query.post_id && query.slot_key) {
        const key = String(query.slot_key).replace(/^eq\./, '');
        const r = (st.slotRows[idsOf(query.post_id)[0]] || []).find((x) => x.slot_key === key);
        return [200, r ? [{ purpose: 'blog_body', image_id: r.image_id }] : []];
      }
      return [200, []];
    }
    if (t === 'post_card_decks' && method === 'GET') {
      if (query.post_id) { const d = st.decks[idsOf(query.post_id)[0]]; return [200, d ? [d] : []]; }
      if (query.bg_image_id) { const id = idsOf(query.bg_image_id)[0]; return [200, Object.values(st.decks).filter((d) => d.bg_image_id === id).map((d) => ({ post_id: d.post_id }))]; }
      return [200, []];
    }
    if (rpc === 'card_deck_save') { st.deckSaves.push(body); return [200, { post_id: body.p_post, ...body.p }]; }
    if (t === 'posts') {
      if (method === 'PATCH') { st.postPatch.push({ query, body }); const ids = idsOf(query.id); return [200, ids.filter((id) => POSTS[id] && ['ready', 'scheduled'].includes(POSTS[id].stage)).map((id) => ({ id }))]; }
      if (query.stage) return [200, idsOf(query.id).map((id) => POSTS[id]).filter((x) => x && idsOf(query.stage).includes(x.stage)).map((x) => ({ id: x.id }))];
      const p = POSTS[idsOf(query.id)[0]];
      return [200, one ? p || {} : p ? [p] : []];
    }
    if (t === 'channels') return [200, [{ id: 'naver_blog', name: '네이버 블로그', kind: 'blog', clickable_links: true }]];
    if (t === 'settings') { if (method === 'PATCH') st.settingsPatch.push(body); return [200, one ? SETTINGS : [SETTINGS]]; }
    if (t === 'image_generations' && method === 'GET' && query.id) { const g = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', model: 'cf-flux-2-klein-4b', provider: 'cloudflare', est_usd: 0, usage_usd: 0, actual_usd: null, cost_status: '청구 없음' }; return [200, one ? g : [g]]; }
    if (t === 'post_images') {
      if (method === 'PATCH') {
        st.imagePatch.push({ query, body });
        const id = idsOf(query.id)[0];
        if (images[id]) Object.assign(images[id], body);
        return [200, one ? images[id] : images[id] ? [images[id]] : []];
      }
      if (select.includes('count') || query.product_image_id) return [200, [], { 'content-range': '0-0/2' }];
      if (query.background_image_id && query.kind) {
        const bid = idsOf(query.background_image_id)[0];
        return [200, Object.values(images).filter((r) => r.kind === 'card' && r.background_image_id === bid).map((r) => ({ id: r.id }))];
      }
      const rows = idsOf(query.id).map((id) => images[id]).filter(Boolean).filter((r) => query.deleted_at !== 'is.null' || !r.deleted_at);
      return [200, one ? rows[0] || (method === 'GET' && query.deleted_at === 'is.null' ? null : {}) : rows];
    }
    return undefined;
  };
}
const newState = () => ({ images: IMAGES(), no018: false, maskError: '', saveError: '', uploads: [], removed: [], maskSaves: [], saves: [], checks: [], begins: [], fails: [], imagePatch: [], postPatch: [], slotRows: {}, usedBy: {},
  decks: {}, deckSaves: [], settingsPatch: [] });
const ENV = { EDGE_WALL_SECONDS: '400' };
const waitFor = async (fn, ms = 15000) => { const until = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > until) return null; await new Promise((ok) => setTimeout(ok, 100)); } };
const form = (bytes, type, meta) => { const fd = new FormData(); fd.append('file', new Blob([bytes], { type }), 'f'); fd.append('meta', JSON.stringify(meta)); return fd; };
const pgen = (o) => ({ request_key: 'req-' + Math.random().toString(36).slice(2, 12), model: 'gf-test-fake', quality: 'medium', confirm_usd: 0, product_image_id: PROD,
  product: { mode: 'layer', template: 'table', purpose: 'blog_body', angle: 'front', place: 'center', custom: '', name: '포근 전기요 PK-200' }, ...o });

describe('1.5.1 상품 장면 — 서버', () => {
  let srv, st;
  before(async () => { if (!HAS_DENO) return; st = newState(); srv = await startServer(fakeDb(st), { env: ENV }); });
  after(() => srv?.stop());

  test('018 전 DB: 마스크·합성·상품 검수는 DB 업데이트가 필요하다고 알리고 아무것도 저장하지 않음', { skip }, async () => {
    st.no018 = true;
    try {
      const a = await srv.form(`images/${PROD}/mask`, form(MASK_PNG, 'image/png', { method: 'auto_u2netp' }));
      const b = await srv.form('images/composite', form(COMP_PNG, 'image/png', { product_image_id: PROD, background_image_id: BG, mask_id: MASK, layer: LAYER }));
      const c = await srv.call('POST', `images/${COMP}/product-check`, { items: {}, approve: false });
      for (const r of [a, b, c]) assert.deepEqual([r.status, r.j.error, r.j.migration], [409, 'db_update_needed', '018']);
      assert.deepEqual([st.uploads.length, st.maskSaves.length, st.saves.length, st.checks.length], [0, 0, 0, 0]);
    } finally { st.no018 = false; }
  });

  test('마스크 저장: PNG 만, 원본과 같은 비율, 원본 사진 파일·기록은 건드리지 않음 (배경 지우기 비용 0원 기록)', { skip }, async () => {
    const jpg = await srv.form(`images/${PROD}/mask`, form(JPG, 'image/jpeg', {}));
    assert.deepEqual([jpg.status, jpg.j.error], [400, 'bad_image']);
    const bad = await srv.form(`images/${PROD}/mask`, form(MASK_BAD, 'image/png', {}));
    assert.deepEqual([bad.status, bad.j.error], [400, 'mask_size_mismatch']);
    const ok = await srv.form(`images/${PROD}/mask`, form(MASK_PNG, 'image/png', { method: 'auto_u2netp', edited: true, params: { feather: 2, shrink: 1, threshold: 0.5, model: 'u2netp' }, bbox: { x: 10, y: 20, w: 300, h: 200 }, coverage: 0.4123 }));
    assert.equal(ok.status, 201, JSON.stringify(ok.j));
    const p = st.maskSaves.at(-1);
    assert.match(p.storage_path, /^mask\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    assert.deepEqual([p.image_id, p.width, p.height, p.method, p.edited, p.params, p.bbox, p.coverage], [PROD, 640, 480, 'auto_u2netp', true, { feather: 2, shrink: 1, threshold: 0.5, model: 'u2netp' }, { x: 10, y: 20, w: 300, h: 200 }, 0.412]);
    assert.deepEqual([ok.j.mask.cost_usd, ok.j.mask.cost_status], [0, '청구 없음']);
    assert.ok(!st.uploads.some((u) => u.startsWith('upload/')), '원본 상품 사진 경로에는 쓰지 않음');
    assert.equal(st.imagePatch.length, 0, '원본 이미지 기록을 고치지 않음');
    // DB가 거절하면(예: AI 이미지·권한 없는 사진) 올린 마스크 파일만 지움
    st.maskError = 'mask_real_only';
    try {
      const r = await srv.form(`images/${PROD}/mask`, form(MASK_PNG, 'image/png', {}));
      assert.deepEqual([r.status, r.j.error], [400, 'mask_real_only']);
      assert.ok(st.removed.some((x) => x.startsWith('mask/')) && !st.removed.some((x) => x.startsWith('upload/')));
    } finally { st.maskError = ''; }
  });

  test('합성 저장: 새 파일(composite/…)로만 저장하고 원본 상품·배경·마스크 id·레이어 설정·출처·라이선스를 기록', { skip }, async () => {
    const miss = await srv.form('images/composite', form(COMP_PNG, 'image/png', { product_image_id: PROD, background_image_id: BG }));
    assert.deepEqual([miss.status, miss.j.field], [400, 'mask_id']);
    const fake = await srv.form('images/composite', form(new Uint8Array([1, 2, 3, 4]), 'image/png', { product_image_id: PROD, background_image_id: BG, mask_id: MASK }));
    assert.deepEqual([fake.status, fake.j.error], [400, 'bad_image']);
    // 배경은 그 상품용 빈 배경만 (다른 상품의 배경·AI 실사 장면·일반 AI 이미지는 안 됨 — 1.5.1 검토)
    for (const bad of [BG, REF, AI]) {
      const x = await srv.form('images/composite', form(COMP_PNG, 'image/png', { product_image_id: STOCK, background_image_id: bad, mask_id: MASK }));
      assert.deepEqual([x.status, x.j.error], [400, 'background_mismatch'], bad);
    }
    const n = st.uploads.length;
    const r = await srv.form('images/composite', form(COMP_PNG, 'image/png', { product_image_id: STOCK, background_image_id: BG_STOCK, mask_id: MASK, purpose: 'ig_feed', ratio: '4:5',
      layer: { ...LAYER, x: 2, rot: 99, ratio: '21:9' }, description: '침대 위에 놓인 전기요', spec: { mode: 'layer', template: 'table', purpose: 'ig_feed' } }));
    assert.equal(r.status, 201, JSON.stringify(r.j));
    const img = st.saves.at(-1).img;
    assert.deepEqual([img.kind, img.provider, img.product_image_id, img.background_image_id, img.mask_id, img.preset, img.purpose, img.ratio],
      ['composite', 'composite', STOCK, BG_STOCK, MASK, 'pscene_layer', 'ig_feed', '4:5']);
    assert.deepEqual([img.layer.x, img.layer.rot, img.layer.ratio], [1, 45, '4:5'], '레이어 설정은 범위 안으로, 비율은 결과 비율');
    assert.match(img.storage_path, /^composite\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    assert.match(img.license, /^원본 보존 합성 \(앱이 합성\) · 상품: Pexels 라이선스/);
    assert.equal(img.attribution_text, '상품 사진: 김사진 (Pexels)', 'Pexels 사진가 출처가 사라지지 않음');
    assert.equal(img.author_name, '김사진');
    assert.deepEqual(st.uploads.slice(n), [img.storage_path], '새 파일 하나만 올림 (원본·배경 파일은 그대로)');
    assert.equal(st.imagePatch.length, 0);
    assert.equal(r.j.image.kind, 'composite');
  });

  test('합성 저장 실패(DB 거절): 새로 올린 합성 파일만 지우고 원본 상품 사진은 지우지 않음', { skip }, async () => {
    st.saveError = 'mask_mismatch';
    try {
      const n = st.removed.length;
      const r = await srv.form('images/composite', form(COMP_PNG, 'image/png', { product_image_id: PROD, background_image_id: BG, mask_id: MASK, layer: LAYER }));
      assert.deepEqual([r.status, r.j.error], [400, 'mask_mismatch']);
      const rm = st.removed.slice(n);
      assert.equal(rm.length, 1);
      assert.match(rm[0], /^composite\//);
      assert.equal(st.images[PROD].storage_path, 'upload/3333.jpg');
    } finally { st.saveError = ''; }
  });

  test("합성을 바로 넣기: 검토 중인 글에는 넣고, 발행 준비 완료 글에는 승인 전이라 막음", { skip }, async () => {
    const meta = { product_image_id: PROD, background_image_id: BG, mask_id: MASK, layer: LAYER, link: true };
    const no = await srv.form('images/composite', form(COMP_PNG, 'image/png', { ...meta, post_id: READY, slot_key: SLOT }));
    assert.deepEqual([no.status, no.j.error], [409, 'product_check_needed']);
    const ok = await srv.form('images/composite', form(COMP_PNG, 'image/png', { ...meta, post_id: POST, slot_key: SLOT }));
    assert.equal(ok.status, 201, JSON.stringify(ok.j));
    assert.deepEqual([st.saves.at(-1).link.post_id, st.saves.at(-1).link.slot_key], [POST, SLOT]);
  });

  test('원본 보존 합성의 배경 만들기: 상품 사진은 AI에 보내지 않고, 프롬프트는 빈 배경만 (상품 이름·제목도 안 보냄)', { skip }, async () => {
    const withRef = await srv.call('POST', 'images/generate', pgen({ refs: [{ image_id: STOCK, role: 'subject' }] }));
    assert.deepEqual([withRef.status, withRef.j.error], [400, 'layer_no_refs']);
    const r = await srv.call('POST', 'images/generate', pgen({ post_id: POST, slot_key: SLOT }));
    assert.equal(r.status, 202, JSON.stringify(r.j));
    const b = st.begins.at(-1);
    assert.deepEqual([b.preset, b.refs, b.post_id, b.slot_key, b.purpose], ['pscene_layer', [], POST, SLOT, 'blog_body']);
    assert.match(b.prompt, /Do NOT draw the product/);
    assert.ok(!/전기요|PK-200|원룸 전기요 고르는 법/.test(b.prompt), '상품 이름·원고 제목은 프롬프트에 없음');
    const save = await waitFor(() => st.saves.find((x) => x.gen === 'gen-' + st.begins.length));
    assert.ok(save, '저장까지 감 (점검용 가짜 모델 — 실제 생성 아님)');
    assert.deepEqual([save.img.kind, save.img.composite_mode, save.img.product_image_id, save.img.origin_slot_key, save.img.composite], ['ai', '', PROD, '', false],
      '배경은 상품 사진 id 만 남기고 사진 자리 후보로 안 보임');
    // 원고 없이(보관함에서) 시작해도 됨
    const lib = await srv.call('POST', 'images/generate', pgen());
    assert.equal(lib.status, 202, JSON.stringify(lib.j));
    assert.deepEqual([st.begins.at(-1).post_id, st.begins.at(-1).slot_key], ['', '']);
  });

  test('AI 실사 장면: 상품 사진을 첫 대상 참고 사진으로 보내고, 결과는 reference + 원본 상품 id 로 기록', { skip }, async () => {
    const r = await srv.call('POST', 'images/generate', pgen({ product: { mode: 'reference', template: 'window', purpose: 'ad_creative' }, refs: [{ image_id: STOCK, role: 'subject' }], ratio: '1:1' }));
    assert.equal(r.status, 202, JSON.stringify(r.j));
    const b = st.begins.at(-1);
    assert.deepEqual([b.preset, b.refs, b.purpose], ['pscene_ref', [{ image_id: PROD, role: 'subject' }, { image_id: STOCK, role: 'subject' }], 'ad_creative']);
    assert.match(b.prompt, /exact product/);
    assert.match(b.prompt, /Image 1: subject reference/);
    const save = await waitFor(() => st.saves.find((x) => x.gen === 'gen-' + st.begins.length));
    assert.deepEqual([save.img.composite_mode, save.img.product_image_id, save.img.composite, save.img.preset], ['reference', PROD, true, 'pscene_ref']);
  });

  test('상품 장면 요청 검사: 진짜 사진만 상품으로, 권한 확인, 합성 이미지는 참고 사진으로 안 받음, 직접 찍기 자리는 막음', { skip }, async () => {
    const cases = [
      [pgen({ product_image_id: AI }), 400, 'product_image_required'],
      [pgen({ product_image_id: NORIGHTS }), 400, 'rights_required'],
      [pgen({ product: { mode: 'reference' }, refs: [{ image_id: AI, role: 'subject' }] }), 400, 'product_image_required'],
      [pgen({ product: { mode: 'reference' }, refs: [{ image_id: COMP, role: 'subject' }] }), 400, 'ref_composite'],
      [pgen({ product: { mode: 'reference' }, refs: [{ image_id: STOCK, role: 'style' }] }), 400, 'bad_field'],
      [pgen({ post_id: POST, slot_key: SLOT_OWN }), 400, 'own_photo_slot'],
      [pgen({ product: { mode: 'layer', custom: '가격표 붙여줘 49,900원' } }), 400, 'prompt_blocked'],
    ];
    const n = st.begins.length;
    for (const [body, status, code] of cases) {
      const r = await srv.call('POST', 'images/generate', body);
      assert.deepEqual([r.status, r.j.error], [status, code], JSON.stringify(body.product) + ' ' + JSON.stringify(r.j));
    }
    assert.equal(st.begins.length, n, '어느 것도 생성을 시작하지 않음 (청구 없음)');
  });

  test('일반 만들기: 실제 상품이 보여야 하는 자리에 진짜 상품 사진을 대상으로 넣으면 AI 실사 장면(reference)으로 기록 → 상품 검수 필요', { skip }, async () => {
    const base1 = { request_key: 'req-' + Math.random().toString(36).slice(2, 12), model: 'gf-test-fake', quality: 'medium', confirm_usd: 0, post_id: POST, purpose: 'blog_body', ratio: '4:3' };
    const a = await srv.call('POST', 'images/generate', { ...base1, slot_key: SLOT_REAL, refs: [{ image_id: PROD, role: 'subject' }] });
    assert.equal(a.status, 202, JSON.stringify(a.j));
    const sa = await waitFor(() => st.saves.find((x) => x.gen === 'gen-' + st.begins.length));
    assert.deepEqual([sa.img.composite, sa.img.composite_mode, sa.img.product_image_id], [true, 'reference', PROD]);
    // 1.5.1 검토 뒤: 일반 자리여도 진짜 상품 사진을 '대상 모양 유지'로 넣으면 AI가 그 상품을 다시 그리는 거라 AI 실사 장면으로 기록 (검수 없이 쓰이지 않게)
    const b = await srv.call('POST', 'images/generate', { ...base1, request_key: 'req-' + Math.random().toString(36).slice(2, 12), slot_key: SLOT, refs: [{ image_id: PROD, role: 'subject' }] });
    assert.equal(b.status, 202, JSON.stringify(b.j));
    const sb2 = await waitFor(() => st.saves.find((x) => x.gen === 'gen-' + st.begins.length));
    assert.deepEqual([sb2.img.composite, sb2.img.composite_mode, sb2.img.product_image_id], [true, 'reference', PROD]);
    // 구도·배경 참고(대상 아님)는 상품을 다시 그리는 게 아니라서 그대로
    const c2 = await srv.call('POST', 'images/generate', { ...base1, request_key: 'req-' + Math.random().toString(36).slice(2, 12), slot_key: SLOT, refs: [{ image_id: PROD, role: 'style' }] });
    assert.equal(c2.status, 202, JSON.stringify(c2.j));
    const sc2 = await waitFor(() => st.saves.find((x) => x.gen === 'gen-' + st.begins.length));
    assert.equal(sc2.img.composite_mode, '');
  });

  test('AI 실사 장면을 고칠 때 원본 상품 사진이 지워졌으면 공급자를 부르기 전에 멈춤 (만든 뒤 저장을 못 해 돈만 나가지 않게)', { skip }, async () => {
    const n = st.begins.length;
    const r = await srv.call('POST', 'images/generate', { request_key: 'req-' + Math.random().toString(36).slice(2, 12), model: 'gf-test-fake', quality: 'medium', confirm_usd: 0,
      post_id: POST, slot_key: SLOT, purpose: 'blog_body', ratio: '4:3', mode: 'edit', base_image_id: REF_GONE, edit: '조명을 조금 더 따뜻하게' });
    assert.deepEqual([r.status, r.j.error], [400, 'product_image_required'], JSON.stringify(r.j));
    assert.equal(st.begins.length, n, '생성을 시작하지 않음');
  });

  test('카드뉴스 배경: 상품 디테일 검수를 승인하지 않은 상품 장면 이미지는 못 씀 (카드는 따로 검수하지 않아서)', { skip }, async () => {
    const slides = [{ title: '원룸 전기요', text: '고르는 기준' }];
    const r = await srv.call('POST', `posts/${POST}/cards`, { slides, bg_image_id: COMP });
    assert.deepEqual([r.status, r.j.error], [409, 'product_check_needed']);
    const r2 = await srv.call('POST', `posts/${POST}/cards`, { slides, bg_image_id: REF });
    assert.deepEqual([r2.status, r2.j.error], [409, 'product_check_needed']);
  });

  test("승인 전에는 '사용 가능'으로 못 바꿈 (서버가 먼저 막고 DB도 막음), 승인한 것은 됨", { skip }, async () => {
    for (const id of [COMP, REF]) {
      const r = await srv.call('POST', `images/${id}`, { review_status: '사용 가능' });
      assert.deepEqual([r.status, r.j.error], [409, 'product_check_needed']);
    }
    assert.equal(st.imagePatch.length, 0, 'DB에 보내지도 않음');
    const ok = await srv.call('POST', `images/${COMP_OK}`, { review_status: '사용 가능' });
    assert.equal(ok.status, 200);
    const plain = await srv.call('POST', `images/${AI}`, { review_status: '사용 가능' });
    assert.equal(plain.status, 200, '상품 장면이 아닌 이미지는 예전처럼');
  });

  test('상품 디테일 검수: 모르는 칸·값은 버리고 저장, 승인을 풀면 그 이미지를 쓰는 발행 준비·예약 글을 검수 필요로', { skip }, async () => {
    const items = { ...Object.fromEntries(PRODUCT_CHECKS.map(([k]) => [k, 'ok'])), bogus: 'ok', text: 'maybe' };
    const r = await srv.call('POST', `images/${COMP}/product-check`, { items, note: '로고 확인함', approve: false });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    const sent = st.checks.at(-1).p;
    assert.equal('bogus' in sent.items, false);
    assert.equal('text' in sent.items, false, "모르는 값('maybe')은 빈칸으로 → 승인 못 함");
    assert.deepEqual(r.j.demoted, []);
    // 승인한 이미지(COMP_OK)를 READY 글이 쓰는 중 → 승인을 풀면 READY 를 검수 필요로
    st.usedBy[COMP_OK] = [{ post_id: READY }, { post_id: POST }];
    const np0 = st.postPatch.length;
    const un = await srv.call('POST', `images/${COMP_OK}/product-check`, { items: { shape: 'issue' }, approve: false });
    assert.equal(un.status, 200, JSON.stringify(un.j));
    assert.deepEqual(un.j.demoted, [READY], '발행 준비·예약 글만 (게시 완료 글은 그대로)');
    // 실제로 '검수 필요'로 내리는 건 DB 트리거 (휴지통 글 포함, 한 번에 — sql_images_151 '승인을 풀면…'). 서버는 어느 글인지 찾아서 알려주기만
    assert.equal(st.postPatch.length, np0);
    const np = await srv.call('POST', `images/${AI}/product-check`, { items: {}, approve: true });
    assert.deepEqual([np.status, np.j.error], [400, 'not_product_scene']);
  });

  test('발행 준비 완료로 바꿀 때: 승인 안 한 상품 장면 이미지가 자리에 있으면 막음 (검사 오류로 알려줌)', { skip }, async () => {
    st.images = IMAGES();
    st.slotRows[POST] = [{ slot_key: SLOT, image_id: COMP, post_images: { kind: 'composite', composite_mode: 'layer', product_check: null } }];
    const r = await srv.call('POST', `posts/${POST}`, { stage: 'ready' });
    assert.deepEqual([r.status, r.j.error], [409, 'check_failed'], JSON.stringify(r.j));
    assert.equal(r.j.errors[0].code, 'product_check_needed');
    assert.match(r.j.errors[0].msg, /사진 1/);
    st.slotRows[POST] = [{ slot_key: SLOT, image_id: COMP_OK, post_images: { kind: 'composite', composite_mode: 'layer', product_check: { approved: true } } }];
    const ok = await srv.call('POST', `posts/${POST}`, { stage: 'ready' });
    assert.notEqual(ok.j.error, 'check_failed', JSON.stringify(ok.j));
    st.slotRows[POST] = [];
  });

  test('발행 준비 완료 글의 자리에는 승인한 상품 장면 이미지만 연결', { skip }, async () => {
    st.images = IMAGES();
    const no = await srv.call('POST', `posts/${READY}/images/link`, { image_id: REF, slot_key: SLOT });
    assert.deepEqual([no.status, no.j.error], [409, 'product_check_needed']);
    const ok = await srv.call('POST', `posts/${READY}/images/link`, { image_id: COMP_OK, slot_key: SLOT });
    assert.notEqual(ok.j.error, 'product_check_needed');
  });

  test('이미지 정보: 상품 장면은 원본 상품·배경·마스크와 비용(모델 생성 · 배경 지우기 따로), 진짜 사진은 마스크와 장면 수', { skip }, async () => {
    const r = await srv.call('GET', `images/${COMP}`);
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.product.mode, 'layer');
    assert.equal(r.j.product.product.id, PROD);
    assert.equal(r.j.product.background.id, BG);
    assert.equal(r.j.product.mask.id, MASK);
    assert.deepEqual([r.j.product.costs.model.model, r.j.product.costs.model.cost_status], ['cf-flux-2-klein-4b', '청구 없음']);
    assert.deepEqual([r.j.product.costs.cutout.cost_usd, r.j.product.costs.cutout.cost_status, r.j.product.costs.cutout.method], [0, '청구 없음', 'auto_u2netp']);
    const p = await srv.call('GET', `images/${PROD}`);
    assert.equal(p.status, 200);
    assert.equal(p.j.masks.length, 1);
    assert.equal(p.j.product, null);
  });

  test('지우기: 상품 사진의 마스크 파일도 같이 지움', { skip }, async () => {
    const n = st.removed.length;
    const r = await srv.call('DELETE', `images/${PROD}`);
    assert.equal(r.status, 200);
    assert.deepEqual(st.removed.slice(n).sort(), ['mask/2026/10/m1.png', 'upload/3333.jpg']);
  });

  // ── 1.5.1 재검토 뒤 ──
  test('재검토: 발행 준비로 바꿀 때 자리에 넣은 카드뉴스 PNG의 배경 · 이 글의 카드뉴스 배경도 봄 (DB와 같은 범위)', { skip }, async () => {
    st.images = IMAGES();
    st.slotRows[POST] = [{ slot_key: SLOT, image_id: CARD, post_images: { kind: 'card', composite_mode: '', product_check: null, background_image_id: REF } }];
    const r = await srv.call('POST', `posts/${POST}`, { stage: 'ready' });
    assert.deepEqual([r.status, r.j.error], [409, 'check_failed'], JSON.stringify(r.j));
    assert.match(r.j.errors[0].msg, /사진 1 \(카드뉴스\)/);
    st.slotRows[POST] = [];
    st.decks[POST] = { post_id: POST, bg_image_id: REF };
    const r2 = await srv.call('POST', `posts/${POST}`, { stage: 'ready' });
    assert.deepEqual([r2.status, r2.j.error], [409, 'check_failed'], JSON.stringify(r2.j));
    assert.match(r2.j.errors[0].msg, /카드뉴스 배경/);
    st.images[REF].product_check = { mode: 'reference', approved: true };
    const ok = await srv.call('POST', `posts/${POST}`, { stage: 'ready' });
    assert.notEqual(ok.j.error, 'check_failed', JSON.stringify(ok.j));
    st.decks = {};
    st.images = IMAGES();
  });
  test('재검토: 이미 그 자리에 있는 같은 이미지를 다시 연결(용도 바꾸기 등)하는 건 그대로, 카드뉴스 PNG는 배경의 승인까지 봄', { skip }, async () => {
    st.images = IMAGES();
    st.slotRows[READY] = [{ slot_key: SLOT, image_id: REF, post_images: { kind: 'ai', composite_mode: 'reference', product_check: null } }];
    const same = await srv.call('POST', `posts/${READY}/images/link`, { image_id: REF, slot_key: SLOT, purpose: 'blog_cover' });
    assert.notEqual(same.j.error, 'product_check_needed', JSON.stringify(same.j));
    const other = await srv.call('POST', `posts/${READY}/images/link`, { image_id: REF, slot_key: SLOT_REAL });
    assert.deepEqual([other.status, other.j.error], [409, 'product_check_needed']);
    const card = await srv.call('POST', `posts/${READY}/images/link`, { image_id: CARD, slot_key: SLOT_REAL });
    assert.deepEqual([card.status, card.j.error], [409, 'product_check_needed'], '승인 안 한 상품 장면으로 그린 카드');
    st.images[REF].product_check = { mode: 'reference', approved: true };
    const ok = await srv.call('POST', `posts/${READY}/images/link`, { image_id: CARD, slot_key: SLOT_REAL });
    assert.notEqual(ok.j.error, 'product_check_needed', JSON.stringify(ok.j));
    st.slotRows[READY] = [];
    st.images = IMAGES();
  });
  test('재검토: 카드뉴스 저장 — 같은 배경으로 문구만 고치는 건 됨(승인을 푼 배경이면 발행할 때 막음), 새로 고르는 배경은 승인한 것만', { skip }, async () => {
    st.images = IMAGES();
    const slides = [{ title: '원룸 전기요', text: '고르는 기준' }];
    st.decks[POST] = { post_id: POST, bg_image_id: REF };
    const n = st.deckSaves.length;
    const same = await srv.call('POST', `posts/${POST}/cards`, { slides, bg_image_id: REF });
    assert.equal(same.status, 200, JSON.stringify(same.j));
    assert.equal(st.deckSaves.length, n + 1);
    const nw = await srv.call('POST', `posts/${POST}/cards`, { slides, bg_image_id: COMP });
    assert.deepEqual([nw.status, nw.j.error], [409, 'product_check_needed']);
    assert.equal(st.deckSaves.length, n + 1, '막힌 저장은 DB에 보내지 않음');
    st.decks = {};
  });
  test('재검토: 카드뉴스 PNG를 올리면 그릴 때 쓴 배경 이미지 id 를 기록 (배경의 승인을 따라가게)', { skip }, async () => {
    st.images = IMAGES();
    const n = st.saves.length;
    const r = await srv.form('images/upload', form(COMP_PNG, 'image/png', { kind: 'card', bg_image_id: COMP_OK, post_id: POST }));
    assert.equal(r.status, 200, JSON.stringify(r.j));
    const sv = st.saves.slice(n).find((x) => x.img.kind === 'card');
    assert.ok(sv, JSON.stringify(st.saves.slice(n)));
    assert.equal(sv.img.background_image_id, COMP_OK);
    assert.match(sv.img.license, /배경: 원본 보존 합성/);
    const no = await srv.form('images/upload', form(COMP_PNG, 'image/png', { kind: 'card', bg_image_id: COMP, post_id: POST }));
    assert.deepEqual([no.status, no.j.error], [409, 'product_check_needed'], '승인 안 한 상품 장면으로는 카드를 못 그림');
  });
  test('재검토: 승인을 풀 때 알려주는 글에 카드뉴스 배경·그 이미지로 그린 카드를 쓰는 글도 들어감', { skip }, async () => {
    st.images = IMAGES();
    st.images[CARD].background_image_id = COMP_OK;
    st.usedBy = { [CARD]: [{ post_id: READY }] };
    const viaCard = await srv.call('POST', `images/${COMP_OK}/product-check`, { items: { shape: 'issue' }, approve: false });
    assert.equal(viaCard.status, 200, JSON.stringify(viaCard.j));
    assert.deepEqual(viaCard.j.demoted, [READY]);
    st.images = IMAGES();
    st.usedBy = {};
    st.decks[READY] = { post_id: READY, bg_image_id: COMP_OK };
    const viaDeck = await srv.call('POST', `images/${COMP_OK}/product-check`, { items: { shape: 'issue' }, approve: false });
    assert.deepEqual(viaDeck.j.demoted, [READY]);
    st.decks = {};
    st.images = IMAGES();
  });
  test("재검토: 일반 자리의 진짜 사진을 '상품 아님'으로 보내면 AI 합성 표시만(상품 검수 대상 아님), 실제 상품 자리에서는 무시하고 늘 상품으로", { skip }, async () => {
    st.images = IMAGES();
    const base1 = { model: 'gf-test-fake', quality: 'medium', confirm_usd: 0, post_id: POST, purpose: 'blog_body', ratio: '4:3', refs: [{ image_id: PROD, role: 'subject' }], subject_product: false };
    const a = await srv.call('POST', 'images/generate', { ...base1, request_key: 'req-' + Math.random().toString(36).slice(2, 12), slot_key: SLOT });
    assert.equal(a.status, 202, JSON.stringify(a.j));
    const sa = await waitFor(() => st.saves.find((x) => x.gen === 'gen-' + st.begins.length));
    assert.deepEqual([sa.img.composite, sa.img.composite_mode, sa.img.product_image_id], [true, '', '']);
    const b = await srv.call('POST', 'images/generate', { ...base1, request_key: 'req-' + Math.random().toString(36).slice(2, 12), slot_key: SLOT_REAL });
    assert.equal(b.status, 202, JSON.stringify(b.j));
    const sb3 = await waitFor(() => st.saves.find((x) => x.gen === 'gen-' + st.begins.length));
    assert.deepEqual([sb3.img.composite, sb3.img.composite_mode, sb3.img.product_image_id], [true, 'reference', PROD]);
  });
  test('재검토: 설정 저장은 사용자가 고른 값 표시(user)를 지킴 — 1.5.0 기본값과 같아도 고른 값이면 그대로 쓰게', { skip }, async () => {
    const n = st.settingsPatch.length;
    const r = await srv.call('POST', 'settings', { image_modes: { hq_paid: { model: 'gpt-image-2.5-flare', quality: 'high', user: true }, fast_paid: { model: 'gpt-image-2.5-flare', quality: 'medium', user: 'yes' } } });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(st.settingsPatch.length, n + 1);
    assert.deepEqual(st.settingsPatch.at(-1).image_modes, { hq_paid: { model: 'gpt-image-2.5-flare', quality: 'high', user: true }, fast_paid: { model: 'gpt-image-2.5-flare', quality: 'medium' } });
  });

  test('응답·DB 요청 어디에도 비밀값이 없음', { skip }, async () => {
    const all = JSON.stringify(srv.calls) + srv.log();
    assert.ok(!/sk-[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{10,}/.test(all));
  });
});
