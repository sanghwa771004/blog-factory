// 서버 1.5.2: 저장 한도 알려주기 · 합성 저장의 같은 요청 번호(두 장 안 생김·같은 경로 덮어쓰기) · 실패한 합성 파일만 정리 ·
// 장면 정보(scene.fit)·상품이 그려진 자리(layer.box) 기록 · 상품 장면 비교 평가 칸 · 같은 이미지를 본문 여러 자리에 넣지 않기
// 서버 실제 코드를 Deno로 띄우고 가짜 DB API(harness.mjs)로 확인. 127.0.0.1 말고는 연결하지 못하게 띄움 → 실제 공급자·실제 Supabase는 부르지 않음
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { HAS_DENO, SKIP as skip, startServer } from './harness.mjs';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgba = [120, 140, 160, 255]) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.alloc(1 + w * 4); for (let x = 0; x < w; x++) row.set(rgba, 1 + x * 4);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]));
}
const COMP_PNG = png(400, 300);
const POST = '11111111-1111-4111-8111-111111111111';
const PROD = '33333333-3333-4333-8333-333333333333';
const BG = '77777777-7777-4777-8777-777777777777';
const MASK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IMG_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const BODY = ['## 고르는 법', '전기요 크기와 온도 단계를 먼저 봐요.', '[이미지: 침대 위 전기요]', '[이미지: 온도 조절기 버튼 (제품 사진)]', '## 관리', '세탁 라벨을 확인해요.'].join('\n');
const S1 = 'k:침대 위 전기요#1', S2 = 'k:온도 조절기 버튼 (제품 사진)#1';
const POSTS = { [POST]: { id: POST, stage: 'review', keyword: '원룸 전기요', titles: ['원룸 전기요'], body: BODY, channel_id: 'naver_blog', program_ids: [], content_type: 'buying_guide', deleted_at: null } };
const LAYER = { x: 0.5, y: 0.86, h: 0.5, rot: 0, one: true, shadow: { o: 0.45, s: 0.5, dx: 0 }, tone: { b: 0, w: 0 }, bg: { b: 0, w: 0 }, mask: { feather: 1, shrink: 0 } };
const img = (id, o) => ({ id, kind: 'upload', provider: 'upload', storage_path: `upload/${id.slice(0, 4)}.jpg`, mime: 'image/jpeg', width: 1280, height: 960, rights_confirmed: true, source_type: 'own',
  description: '내 전기요', license: '직접 올림 (사용 권한 확인함)', deleted_at: null, composite_mode: '', product_image_id: null, preset: '', ...o });
const idsOf = (q) => { const v = String(q || ''); const m = /^in\.\((.*)\)$/.exec(v); return m ? m[1].split(',').map((x) => x.replace(/"/g, '')) : v.startsWith('eq.') ? [v.slice(3)] : []; };
// PostgREST like 값 → 정규식 (\ 로 막은 _·% 는 글자 그대로)
const likeRe = (q) => { const v = String(q || '').replace(/^like\./, ''); let re = ''; for (let i = 0; i < v.length; i++) { const ch = v[i]; if (ch === '\\' && i + 1 < v.length) { re += v[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; } re += ch === '%' ? '.*' : ch === '_' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); } return new RegExp('^' + re + '$'); };

function fakeDb(st) {
  return ({ method, table, rpc, one, body, query }) => {
    const t = String(table || '');
    if (t === 'product_masks') return [200, []];
    if (t === '/storage/v1/bucket/post-images' && method === 'GET') return st.noBucket ? [404, { statusCode: '404', error: 'not_found', message: 'Bucket not found' }] : [200, { id: 'post-images', name: 'post-images', public: false, file_size_limit: 26214400, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] }];
    if (t.startsWith('/storage/v1/object/sign/')) return [200, (body?.paths || []).map((p) => ({ path: p, signedURL: `/object/sign/post-images/${p}?token=t`, error: null }))];
    if (t.startsWith('/storage/v1/object/post-images/') && (method === 'POST' || method === 'PUT')) { const p = t.replace('/storage/v1/object/post-images/', ''); st.uploads.push(p); st.files.add(p); return [200, { Key: 'post-images/' + p }]; }
    // Storage 목록 (supabase-js list → POST /object/list/{bucket} { prefix, search }) — 올린 시각은 st.fileTimes 에서 (없으면 지금)
    if (t === '/storage/v1/object/list/post-images' && method === 'POST') {
      const pre = String(body?.prefix || '').replace(/\/$/, '') + '/';
      const found = [...st.files].filter((f) => f.startsWith(pre) && !f.slice(pre.length).includes('/') && f.slice(pre.length).includes(String(body?.search || '')));
      return [200, found.map((f) => { const at = st.fileTimes.get(f) || new Date().toISOString(); return { name: f.slice(pre.length), id: f, updated_at: at, created_at: at, last_accessed_at: at, metadata: {} }; })];
    }
    if (t.startsWith('/storage/v1/object/post-images') && method === 'DELETE') {
      const asked = body?.prefixes || [];
      st.removeCalls.push(asked);
      const gone = asked.filter((p) => st.files.has(p));
      for (const p of gone) st.files.delete(p);
      return [200, gone.map((name) => ({ name }))];
    }
    if (rpc === 'image_usage') return [200, { storage_bytes: 0, today: 0, daily_limit: 20, month_usd: 0, budget_usd: 5, request_cap_usd: 1 }];
    if (rpc === 'image_save') {
      st.saves.push(body);
      if (st.saveError) return [400, { code: 'P0001', details: null, hint: null, message: st.saveError }];
      // 019 고유 색인 흉내: 같은 경로의 살아 있는 합성이 이미 있으면 두 번째 줄은 막힘
      if (st.composites.some((r) => r.storage_path === body.img.storage_path && !r.deleted_at)) return [409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "post_images_composite_path_uniq"' }];
      const row = { id: 'c0c0c0c0-c0c0-4c0c-8c0c-' + String(st.saves.length).padStart(12, '0'), ...body.img };
      st.composites.push(row);
      return [200, { image: row, slot: null }];
    }
    if (rpc === 'image_eval_save') { st.evals.push(body.p); return [200, { id: 'e1', ...body.p }]; }
    if (rpc === 'image_slot_upsert') { st.upserts.push(body); return [200, { post_id: body.p_post, ...body.p }]; }
    if (t === 'settings') return [200, one ? { id: 1 } : [{ id: 1 }]];
    if (t === 'posts') { const p = POSTS[idsOf(query.id)[0]]; return [200, one ? p || null : p ? [p] : []]; }
    if (t === 'post_image_slots') {
      if (method === 'DELETE') { st.slotDeletes.push(query); return [200, []]; }
      const rows = st.slots.filter((r) => (!query.post_id || idsOf(query.post_id).includes(r.post_id)) && (!query.slot_key || r.slot_key === String(query.slot_key).replace(/^eq\./, '')) && (!query.image_id || idsOf(query.image_id).includes(r.image_id)));
      return [200, one ? rows[0] || null : rows];
    }
    if (t === 'post_images') {
      // raceHide: 다른 요청이 아직 기록 전이던 순간의 확인 흉내 (요청 번호 확인에는 안 보이고, 기록할 때는 이미 있음)
      if (query.storage_path && String(query.storage_path).startsWith('like.')) { if (st.raceHide) return [200, []]; const re = likeRe(query.storage_path); return [200, st.composites.filter((r) => re.test(r.storage_path) && (!query.kind || r.kind === String(query.kind).replace(/^eq\./, '')))]; }
      if (query.storage_path && String(query.storage_path).startsWith('eq.')) { const want = String(query.storage_path).slice(3); return [200, st.composites.filter((r) => r.storage_path === want && !r.deleted_at)]; }
      const rows = idsOf(query.id).map((id) => st.images[id]).filter(Boolean).filter((r) => query.deleted_at !== 'is.null' || !r.deleted_at);
      return [200, one ? rows[0] || null : rows];
    }
    return undefined;
  };
}
const newState = () => ({
  images: { [PROD]: img(PROD), [BG]: img(BG, { kind: 'ai', provider: 'cloudflare', storage_path: 'ai/bg.jpg', preset: 'pscene_layer', product_image_id: PROD }), [IMG_A]: img(IMG_A) },
  uploads: [], files: new Set(), fileTimes: new Map(), removeCalls: [], saves: [], composites: [], evals: [], upserts: [], slots: [], slotDeletes: [], saveError: '', noBucket: false,
});
const form = (bytes, meta) => { const fd = new FormData(); fd.append('file', new Blob([bytes], { type: 'image/png' }), 'composite.png'); fd.append('meta', JSON.stringify(meta)); return fd; };
const META = (o) => ({ product_image_id: PROD, background_image_id: BG, mask_id: MASK, layer: LAYER, purpose: 'blog_body', ratio: '4:3', spec: { mode: 'layer', template: 'table', light: 'left', warmth: 'warm' }, ...o });

describe('1.5.2 상품 장면 저장 안정성·장면 정보·자리 반복 — 서버', () => {
  let srv, st;
  before(async () => { if (!HAS_DENO) return; st = newState(); srv = await startServer(fakeDb(st), { env: { EDGE_WALL_SECONDS: '400' } }); });
  after(() => srv?.stop());

  test('이미지 설정: 저장 한도 = 코드 한도와 버킷 설정(25MiB) 중 작은 쪽', { skip }, async () => {
    const r = await srv.call('GET', 'images/config');
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.deepEqual(r.j.limits, { composite_bytes: 12 * 1024 * 1024, mask_bytes: 6 * 1024 * 1024, upload_bytes: 8 * 1024 * 1024, bucket_bytes: 26214400, max_side: 4096 });
  });

  test('합성 저장: 요청 번호로 경로를 정하고(같은 번호면 같은 경로에 덮어씀), 장면 정보는 정리해서 scene.fit 에, 상품이 그려진 자리는 layer.box 에', { skip }, async () => {
    const key = 'Ab_cd-0123456789xyz';
    const fit = { product: { light: { dir: 'left', confidence: 'medium' }, temp: { value: 'warm', confidence: 'low' }, aspect: 2.5, bright: { product: 0.71 }, secret: 'x' },
      background: { light: { dir: 'left', confidence: 'low' }, contrast: 'soft', bright: 0.6, spot: { x: 0.4, y: 0.82, confidence: 'medium' } }, applied: true, match: { light: 'same' }, url: 'https://evil.example/' };
    const r = await srv.form('images/composite', form(COMP_PNG, META({ request_key: key, fit, layer: { ...LAYER, box: { l: 0.3, t: 0.2, w: 0.4, h: 0.6 } } })));
    assert.equal(r.status, 201, JSON.stringify(r.j));
    const saved = st.saves.at(-1).img;
    assert.match(saved.storage_path, new RegExp(`^composite/\\d{4}/\\d{2}/${key}\\.png$`));
    assert.deepEqual(st.uploads, [saved.storage_path]);
    assert.deepEqual(saved.layer.box, { l: 0.3, t: 0.2, w: 0.4, h: 0.6 });
    assert.equal(saved.scene.fit.source, 'device_estimate', '이 기기에서 추정한 값이라고 남김');
    assert.deepEqual(saved.scene.fit.product.light, { value: 'left', confidence: 'medium' });
    assert.deepEqual([saved.scene.fit.product.aspect, saved.scene.fit.background.contrast, saved.scene.fit.applied, saved.scene.fit.match.light], [2.5, 'soft', true, 'same']);
    assert.ok(!JSON.stringify(saved.scene.fit).includes('evil') && !JSON.stringify(saved.scene.fit).includes('secret'), '모르는 칸은 버림');
    assert.deepEqual([saved.scene.light, saved.scene.warmth], ['left', 'warm'], '빛·색 설정도 장면 기록에');
    // 같은 요청을 다시 보내면 (응답을 못 받아 '다시 저장'): 새로 올리지 않고 저장된 그 이미지를 돌려줌 → 두 장이 생기지 않음
    const again = await srv.form('images/composite', form(COMP_PNG, META({ request_key: key })));
    assert.deepEqual([again.status, again.j.reused, again.j.image.storage_path], [200, true, saved.storage_path]);
    assert.equal(st.uploads.length, 1, '두 번째는 올리지 않음');
    assert.equal(st.saves.length, 1, '기록도 하나');
  });

  test("파일만 올라가고 기록이 실패했으면: 그 합성 파일만 지우고, 같은 번호로 다시 보내면 같은 경로에 다시 올림", { skip }, async () => {
    const key = 'retry_key_00000001';
    st.saveError = 'mask_mismatch';
    try {
      const r = await srv.form('images/composite', form(COMP_PNG, META({ request_key: key })));
      assert.equal(r.status, 400);
      const p = st.uploads.at(-1);
      assert.match(p, new RegExp(`/${key}\\.png$`));
      assert.ok(st.removeCalls.at(-1).includes(p) && !st.removeCalls.flat().some((x) => !x.startsWith('composite/')), '지우는 건 합성 파일뿐');
    } finally { st.saveError = ''; }
    const ok = await srv.form('images/composite', form(COMP_PNG, META({ request_key: key })));
    assert.equal(ok.status, 201);
    assert.equal(st.uploads.filter((u) => u.endsWith(`/${key}.png`)).length, 2, '같은 경로에 다시');
  });

  test('실패한 합성 파일 정리: 기록이 없고 올린 지 15분 넘은 그 번호의 composite/ 파일만 지우고, 저장된 합성·막 올린 파일(아직 저장 중일 수 있음)·잘못된 번호는 건드리지 않음', { skip }, async () => {
    const orphan = 'orphan_key_0000001', fresh = 'fresh_key_00000001';
    const now = new Date();
    const dir = `composite/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const path = `${dir}/${orphan}.png`, freshPath = `${dir}/${fresh}.png`;
    st.files.add(path); st.fileTimes.set(path, new Date(Date.now() - 20 * 60_000).toISOString());
    st.files.add(freshPath); st.fileTimes.set(freshPath, new Date(Date.now() - 60_000).toISOString());
    const kept = st.composites[0].storage_path; // 앞에서 저장된 합성
    const keptKey = kept.split('/').pop().replace(/\.png$/, '');
    const n = st.removeCalls.length;
    const r = await srv.call('POST', 'images/composite/cleanup', { request_keys: [orphan, fresh, keptKey, '../upload/3333', 'x'] });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.removed, 1);
    assert.deepEqual(r.j.recent, [fresh], '막 올린 파일은 다음에 다시');
    assert.ok(!st.files.has(path) && st.files.has(kept) && st.files.has(freshPath), '오래된 고아 파일만 지움');
    const asked = st.removeCalls.slice(n).flat();
    assert.deepEqual(asked, [path]);
    const none = await srv.call('POST', 'images/composite/cleanup', { request_keys: [] });
    assert.deepEqual([none.status, none.j.removed], [200, 0]);
  });

  test('같은 요청이 거의 동시에 두 번(다른 쪽이 먼저 기록): DB가 두 번째 줄을 막으면(23505) 먼저 저장된 줄을 돌려주고, 그 파일은 지우지 않음', { skip }, async () => {
    const key = 'race_key_000000001';
    const now = new Date();
    const path = `composite/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${key}.png`;
    // 첫 요청: 같은 번호의 기록이 아직 없는 순간에 시작 → 두 번째 요청이 확인을 지난 뒤에 기록됨 (흉내: 확인은 비어 있고 기록할 때 이미 있음)
    const first = { id: 'c0c0c0c0-c0c0-4c0c-8c0c-0000000000aa', kind: 'composite', storage_path: path, deleted_at: null };
    st.composites.push(first);
    st.raceHide = true;
    const n = st.removeCalls.length, nSaves = st.saves.length;
    try {
      const r = await srv.form('images/composite', form(COMP_PNG, META({ request_key: key })));
      assert.equal(r.status, 200, JSON.stringify(r.j));
      assert.deepEqual([r.j.reused, r.j.image.id], [true, first.id]);
      assert.equal(st.saves.length, nSaves + 1, '기록을 시도했다가 DB가 막음 (23505)');
      assert.ok(!st.removeCalls.slice(n).flat().includes(path), '먼저 저장된 줄의 파일은 지우지 않음');
      assert.equal(st.composites.filter((x) => x.storage_path === path).length, 1, '줄은 하나');
    } finally { st.raceHide = false; }
  });

  test('평가 저장: 상품 장면 비교 칸(외형 보존·조명·그림자·색감)도 받고, 모르는 칸·범위 밖 값은 버림', { skip }, async () => {
    const r = await srv.call('POST', `images/${IMG_A}/evaluate`, { scores: { preserve: 3, lighting: 2, shadow: 1, color: 3, natural: 2, usable: 3, ai_look: 1, bogus: 3, fit: 9 }, preferred: true, note: 'product_compare' });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.deepEqual(st.evals.at(-1).scores, { natural: 2, ai_look: 1, usable: 3, preserve: 3, lighting: 2, shadow: 1, color: 3 });
    assert.equal(st.evals.at(-1).note, 'product_compare');
  });

  test('같은 이미지를 본문 여러 자리에: 거절(image_in_other_slot), move: true 면 옮겨 옴. 대표 이미지 자리는 본문 사진을 그대로 써도 됨', { skip }, async () => {
    st.slots = [{ post_id: POST, slot_key: S1, image_id: IMG_A, purpose: 'blog_body' }];
    const dup = await srv.call('POST', `posts/${POST}/images/link`, { slot_key: S2, image_id: IMG_A, dup_check: true });
    assert.deepEqual([dup.status, dup.j.error, dup.j.slot_key, dup.j.slot_keys], [409, 'image_in_other_slot', S1, [S1]]);
    assert.equal(st.upserts.length, 0, '거절하면 연결을 바꾸지 않음');
    // 1.5.0·1.5.1 화면(dup_check 를 안 보냄)은 예전 그대로 연결 — 서버를 먼저 올려도 옛 화면이 새 오류를 받지 않게
    const old = await srv.call('POST', `posts/${POST}/images/link`, { slot_key: S2, image_id: IMG_A });
    assert.equal(old.status, 200, JSON.stringify(old.j));
    assert.deepEqual(old.j.moved_from, []);
    st.upserts = [];
    const cover = await srv.call('POST', `posts/${POST}/images/link`, { slot_key: 'x:cover', image_id: IMG_A, dup_check: true });
    assert.equal(cover.status, 200, JSON.stringify(cover.j));
    const mv = await srv.call('POST', `posts/${POST}/images/link`, { slot_key: S2, image_id: IMG_A, move: true });
    assert.equal(mv.status, 200, JSON.stringify(mv.j));
    assert.deepEqual(mv.j.moved_from, [S1]);
    assert.equal(st.upserts.at(-1).p.slot_key, S2);
    const del = st.slotDeletes.at(-1);
    assert.ok(String(del.slot_key).includes(encodeURIComponent(S1).slice(0, 4)) || String(del.slot_key).includes('침대'), JSON.stringify(del));
    // 본문에서 사라진 자리(옛 연결)에 있는 같은 이미지는 따지지 않음 (다른 자리로 옮기는 중일 수 있어서)
    st.slots = [{ post_id: POST, slot_key: 'k:예전 자리#1', image_id: IMG_A, purpose: 'blog_body' }];
    const orphan = await srv.call('POST', `posts/${POST}/images/link`, { slot_key: S1, image_id: IMG_A, dup_check: true });
    assert.equal(orphan.status, 200, JSON.stringify(orphan.j));
  });
});

describe('1.5.2 저장 한도 — 버킷 설정을 못 읽을 때', () => {
  let srv, st;
  before(async () => { if (!HAS_DENO) return; st = newState(); st.noBucket = true; srv = await startServer(fakeDb(st), { env: { EDGE_WALL_SECONDS: '400' } }); });
  after(() => srv?.stop());
  test('버킷 한도를 모르면 bucket_bytes: null 이고 코드 한도만 알려줌 (화면은 \'버킷 한도 확인 못 함\'으로 표시)', { skip }, async () => {
    const r = await srv.call('GET', 'images/config');
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.deepEqual([r.j.limits.bucket_bytes, r.j.limits.composite_bytes], [null, 12 * 1024 * 1024]);
  });
});
