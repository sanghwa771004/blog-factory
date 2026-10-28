// 018 상품 사진으로 장면 만들기 (1.5.1) DB 테스트 — PGlite(진짜 Postgres)에 001~018을 적용해서 확인. 실행: npm test
// 지시서 9번 중 DB가 지키는 것: 1(원본 파일·기록이 안 바뀜) · 5(두 방식 구분) · 6(결과마다 원본 상품·비용 이력) · 8(실패해도 원본 보존) · 승인 전 '사용 가능' 금지
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, one, all, val, MIGRATIONS_DIR } from './helpers/db.js';
import { PRODUCT_CHECKS } from '../images.js';

const SQL018 = readFileSync(join(MIGRATIONS_DIR, '018_product_scene_1_5_1.sql'), 'utf8');
const save = async (db, img, link = null) => (await val(db, `select public.image_save($1::jsonb, $2::jsonb)`, [JSON.stringify({ mime: 'image/jpeg', ...img }), link && JSON.stringify(link)])).image;
const mask = (db, p) => val(db, `select public.image_mask_save($1::jsonb)`, [JSON.stringify({ storage_path: 'mask/2026/10/m.png', width: 800, height: 600, bytes: 1234, method: 'auto_u2netp', ...p })]);
const check = (db, id, p) => val(db, `select public.image_product_check($1, $2::jsonb)`, [id, JSON.stringify(p)]);
const ALL_OK = Object.fromEntries(PRODUCT_CHECKS.map(([k]) => [k, 'ok']));
const LAYER = { x: 0.5, y: 0.86, h: 0.5, rot: 0, shadow: { o: 0.45, s: 0.5, dx: 0 }, tone: { b: 0, w: 0 }, bg: { b: 0, w: 0 }, mask: { feather: 1, shrink: 0 }, ratio: '4:3' };

describe('018 — 기존 데이터·설정은 그대로, 더하기만', () => {
  let db, oldAi, oldUp;
  before(async () => {
    db = await freshDb({
      before: {
        '018': async (d) => {
          // 1.5.0 때 만든 'AI 합성(실제 사진 참고)' 이미지(이미 사용 가능)와 직접 올린 사진
          await d.exec(`insert into public.post_images (kind, provider, model, storage_path, mime, description, composite, review_status)
                        values ('ai', 'cloudflare', 'cf-flux-2-klein-4b', 'ai/old.jpg', 'image/jpeg', '예전 AI 합성', true, '사용 가능');`);
          await d.exec(`insert into public.post_images (kind, provider, storage_path, mime, description, rights_confirmed, sha256)
                        values ('upload', 'upload', 'upload/old.jpg', 'image/jpeg', '예전 상품 사진', true, 'abc');`);
        },
      },
    });
    oldAi = await one(db, `select * from public.post_images where description = '예전 AI 합성'`);
    oldUp = await one(db, `select * from public.post_images where description = '예전 상품 사진'`);
  });

  test('예전 이미지는 그대로 (새 칸은 빈 값, 검수 상태·합성 표시 그대로)', () => {
    assert.deepEqual([oldAi.composite_mode, oldAi.product_image_id, oldAi.background_image_id, oldAi.mask_id, oldAi.layer, oldAi.product_check, oldAi.review_status, oldAi.composite],
      ['', null, null, null, null, null, '사용 가능', true]);
    assert.deepEqual([oldUp.storage_path, oldUp.sha256, oldUp.composite_mode], ['upload/old.jpg', 'abc', '']);
  });
  test('1.5.0 때 만든 이미지는 상품 검수 없이도 예전처럼 상태를 바꿀 수 있음 (새 규칙을 소급하지 않음)', async () => {
    await db.query(`update public.post_images set review_status = '검수 전' where id = $1`, [oldAi.id]);
    await db.query(`update public.post_images set review_status = '사용 가능' where id = $1`, [oldAi.id]);
  });
  test('다시 돌려도 오류 없이 같은 결과 (검사·트리거가 겹치지 않음)', async () => {
    await db.exec(SQL018);
    await db.exec(SQL018);
    const n = await val(db, `select count(*)::int from pg_constraint where conname in ('post_images_kind_check', 'post_images_provider_check', 'post_images_v151_checks', 'product_masks_v151_checks')`);
    assert.equal(n, 4);
    assert.equal(await val(db, `select count(*)::int from pg_trigger where tgname = 'post_images_product_gate'`), 1);
    assert.equal(await val(db, `select count(*)::int from public.post_images`), 2);
  });
  test("종류 'composite'·공급자 'composite'가 더해지고, 모르는 값은 여전히 거절", async () => {
    await assert.rejects(db.query(`insert into public.post_images (kind, provider, storage_path) values ('collage', '', 'x.jpg')`), /check/);
    await assert.rejects(db.query(`insert into public.post_images (kind, provider, storage_path) values ('ai', 'midjourney', 'x.jpg')`), /check/);
  });
  test('두 방식은 섞이지 않음: composite 는 늘 layer, reference 는 늘 ai (직접 넣어도 DB가 막음)', async () => {
    await assert.rejects(db.query(`insert into public.post_images (kind, provider, storage_path) values ('composite', 'composite', 'c.jpg')`), /check/);
    await assert.rejects(db.query(`insert into public.post_images (kind, provider, storage_path, composite_mode) values ('ai', 'openai', 'a.jpg', 'layer')`), /check/);
    await assert.rejects(db.query(`insert into public.post_images (kind, provider, storage_path, composite_mode) values ('upload', 'upload', 'u.jpg', 'reference')`), /check/);
    await assert.rejects(db.query(`insert into public.post_images (kind, provider, storage_path, composite_mode) values ('ai', 'openai', 'a.jpg', 'mixed')`), /check/);
  });
  test('새 표에도 RLS, anon·authenticated 는 새 표·함수를 못 씀 (서버 키만)', async () => {
    const off = await all(db, `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    assert.deepEqual(off, []);
    const g = await all(db, `select privilege_type from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name = 'product_masks'`);
    assert.deepEqual(g, []);
    for (const fn of ['public.image_mask_save(jsonb)', 'public.image_product_check(uuid, jsonb)', 'public.image_save(jsonb, jsonb, uuid, jsonb)', 'public.image_delete(uuid)', 'public.image_usage()']) {
      assert.equal(await val(db, `select has_function_privilege('anon', '${fn}', 'execute')`), false, fn);
      assert.equal(await val(db, `select has_function_privilege('authenticated', '${fn}', 'execute')`), false, fn);
      assert.equal(await val(db, `select has_function_privilege('service_role', '${fn}', 'execute')`), true, fn);
    }
  });
});

describe('018 — 마스크·원본 보존 합성·AI 실사 장면 기록', () => {
  let db, prod, prodNoRights, stock, bg, ai, m, comp, ref;
  before(async () => {
    db = await freshDb();
    prod = await save(db, { kind: 'upload', provider: 'upload', storage_path: 'upload/p.jpg', rights_confirmed: true, sha256: 'p1', bytes: 5000, width: 800, height: 600, description: '내 상품' });
    prodNoRights = await save(db, { kind: 'upload', provider: 'upload', storage_path: 'upload/n.jpg', rights_confirmed: false, sha256: 'n1' });
    stock = await save(db, { kind: 'stock', provider: 'pexels', storage_path: 'stock/s.jpg', author_name: '사진가', license: 'Pexels 라이선스' });
    ai = await save(db, { kind: 'ai', provider: 'cloudflare', storage_path: 'ai/a.jpg' });
    bg = await save(db, { kind: 'ai', provider: 'cloudflare', storage_path: 'ai/bg.jpg', preset: 'pscene_layer', product_image_id: prod.id });
  });

  test('마스크: 진짜 사진(직접 올림 — 권한 확인 · Pexels)에만, 원본 이미지 줄은 그대로', async () => {
    await assert.rejects(mask(db, { image_id: ai.id }), /mask_real_only/, 'AI 이미지에는 마스크를 안 만듦');
    await assert.rejects(mask(db, { image_id: prodNoRights.id }), /rights_required/);
    await assert.rejects(mask(db, { image_id: prod.id, storage_path: '' }), /storage_path is required/);
    await assert.rejects(mask(db, { image_id: prod.id, width: 0 }), /check/);
    m = await mask(db, { image_id: prod.id, bbox: { x: 10, y: 20, w: 300, h: 400 }, coverage: 0.31, params: { feather: 1 } });
    assert.deepEqual([m.method, m.edited, m.cost_usd, m.cost_status, m.coverage], ['auto_u2netp', false, 0, '청구 없음', 0.31], '배경 지우기는 이 기기에서 — 비용 0, 청구 없음으로 따로 기록');
    const sm = await mask(db, { image_id: stock.id, method: 'alpha' });
    assert.equal(sm.method, 'alpha');
    assert.equal((await mask(db, { image_id: prod.id, method: '이상한값' })).method, 'manual', '모르는 방식은 직접 칠함으로');
    const p2 = await one(db, `select storage_path, sha256, bytes, review_status, composite_mode from public.post_images where id = $1`, [prod.id]);
    assert.deepEqual(p2, { storage_path: 'upload/p.jpg', sha256: 'p1', bytes: 5000, review_status: '검수 전', composite_mode: '' });
  });
  test('원본 보존 합성 저장: 원본 상품 사진·AI 배경·레이어 설정·그 상품의 마스크가 모두 있어야 함', async () => {
    const base = { kind: 'composite', provider: 'composite', storage_path: 'composite/c.jpg', layer: LAYER, product_image_id: prod.id, background_image_id: bg.id, mask_id: m.id };
    await assert.rejects(save(db, { ...base, product_image_id: '' }), /product_image_required/);
    await assert.rejects(save(db, { ...base, product_image_id: ai.id }), /product_image_required/, 'AI 이미지는 원본 상품이 아님');
    await assert.rejects(save(db, { ...base, product_image_id: prodNoRights.id }), /rights_required/);
    await assert.rejects(save(db, { ...base, background_image_id: stock.id }), /background_image_required/, '배경은 AI가 만든 것만');
    await assert.rejects(save(db, { ...base, background_image_id: '' }), /background_image_required/);
    await assert.rejects(save(db, { ...base, layer: null }), /layer_required/);
    await assert.rejects(save(db, { ...base, mask_id: '' }), /mask_mismatch/);
    const other = await mask(db, { image_id: stock.id });
    await assert.rejects(save(db, { ...base, mask_id: other.id }), /mask_mismatch/, '다른 사진의 마스크는 못 씀');
    comp = await save(db, { ...base, composite: true, model: '', description: '합성' });
    assert.deepEqual([comp.kind, comp.composite_mode, comp.product_image_id, comp.background_image_id, comp.mask_id, comp.layer.ratio, comp.composite, comp.review_status, comp.generation_id],
      ['composite', 'layer', prod.id, bg.id, m.id, '4:3', false, '검수 전', null],
      '합성 결과: 원본·배경·마스크·위치 설정을 기록. AI가 다시 그린 게 아니라 composite(실제 사진 참고 AI) 표시는 거짓, 생성 기록은 배경 쪽에');
  });
  test('합성에 실패해도(저장 거절) 원본 상품 사진 줄은 그대로이고 반쯤 만든 줄이 남지 않음', async () => {
    const n0 = await val(db, `select count(*)::int from public.post_images`);
    await assert.rejects(save(db, { kind: 'composite', provider: 'composite', storage_path: 'composite/x.jpg', layer: LAYER, product_image_id: prod.id, background_image_id: bg.id, mask_id: '00000000-0000-4000-8000-000000000009' }), /mask_mismatch/);
    assert.equal(await val(db, `select count(*)::int from public.post_images`), n0);
    assert.deepEqual(await one(db, `select storage_path, sha256, deleted_at from public.post_images where id = $1`, [prod.id]), { storage_path: 'upload/p.jpg', sha256: 'p1', deleted_at: null });
  });
  test('AI 실사 장면 저장: 원본 상품 사진이 있어야 하고, AI 합성 표시(composite)는 늘 참', async () => {
    await assert.rejects(save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/r.jpg', composite_mode: 'reference' }), /product_image_required/);
    ref = await save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/r.jpg', composite_mode: 'reference', product_image_id: stock.id, preset: 'pscene_ref', ref_images: [{ image_id: stock.id, role: 'subject', kind: 'stock' }] });
    assert.deepEqual([ref.composite_mode, ref.composite, ref.product_image_id, ref.background_image_id, ref.layer], ['reference', true, stock.id, null, null]);
    // 원본 보존 합성 칸(배경·마스크·레이어)은 AI 실사 장면에 붙지 않음 (두 방식을 섞지 않음)
    const x = await save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/r2.jpg', composite_mode: 'reference', product_image_id: prod.id, background_image_id: bg.id, mask_id: m.id, layer: LAYER });
    assert.deepEqual([x.background_image_id, x.mask_id, x.layer], [null, null, null]);
    // 다른 이미지는 예전과 같음 (모르는 합성 방식 값은 빈 값으로)
    const plain = await save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/p.jpg', composite_mode: 'layer' });
    assert.equal(plain.composite_mode, '');
  });
  test('결과마다 원본 상품 사진과 비용 이력을 따라갈 수 있음 (합성 → 배경 → 배경의 생성 기록)', async () => {
    const g = await val(db, `select public.image_gen_begin($1::jsonb)`, [JSON.stringify({ request_key: 'v151-bg-0001-abcdef', provider: 'cloudflare', model: 'cf-flux-2-klein-4b', size: '1024x768', quality: 'medium', est_usd: 0, preset: 'pscene_layer' })]);
    const r = await val(db, `select public.image_save($1::jsonb, null, $2::uuid, $3::jsonb)`, [JSON.stringify({ kind: 'ai', provider: 'cloudflare', storage_path: 'ai/bg2.jpg', mime: 'image/jpeg', preset: 'pscene_layer', product_image_id: prod.id }), g.id, JSON.stringify({ cost_status: '청구 없음', usage_usd: 0 })]);
    const c2 = await save(db, { kind: 'composite', provider: 'composite', storage_path: 'composite/c2.jpg', layer: LAYER, product_image_id: prod.id, background_image_id: r.image.id, mask_id: m.id, parent_image_id: comp.id });
    const trail = await one(db, `select p.storage_path as product, b.preset as bg_preset, gen.cost_status, gen.est_usd::float as est, mk.method, mk.cost_usd::float as cut_usd
      from public.post_images c join public.post_images p on p.id = c.product_image_id join public.post_images b on b.id = c.background_image_id
      join public.image_generations gen on gen.id = b.generation_id join public.product_masks mk on mk.id = c.mask_id where c.id = $1`, [c2.id]);
    assert.deepEqual(trail, { product: 'upload/p.jpg', bg_preset: 'pscene_layer', cost_status: '청구 없음', est: 0, method: 'auto_u2netp', cut_usd: 0 });
    assert.equal(c2.parent_image_id, comp.id, '다시 맞춘 합성은 새 이미지로 (예전 합성은 그대로)');
  });
});

describe("018 — 상품 디테일 검수: 승인 전에는 '사용 가능'이 될 수 없음", () => {
  let db, prod, bg, m, comp, ref, plainAi;
  before(async () => {
    db = await freshDb();
    prod = await save(db, { kind: 'upload', provider: 'upload', storage_path: 'upload/p.jpg', rights_confirmed: true, sha256: 'p1' });
    bg = await save(db, { kind: 'ai', provider: 'cloudflare', storage_path: 'ai/bg.jpg', preset: 'pscene_layer', product_image_id: prod.id });
    m = await mask(db, { image_id: prod.id });
    comp = await save(db, { kind: 'composite', provider: 'composite', storage_path: 'composite/c.jpg', layer: LAYER, product_image_id: prod.id, background_image_id: bg.id, mask_id: m.id });
    ref = await save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/r.jpg', composite_mode: 'reference', product_image_id: prod.id });
    plainAi = await save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/plain.jpg' });
  });

  test("어느 길로든 승인 없이 '사용 가능'으로 바꾸면 DB가 막음 (두 방식 모두)", async () => {
    for (const id of [comp.id, ref.id]) {
      await assert.rejects(db.query(`update public.post_images set review_status = '사용 가능' where id = $1`, [id]), /product_check_needed/);
      await assert.rejects(db.query(`update public.post_images set review_status = '사용 가능', product_check = '{"approved":false}' where id = $1`, [id]), /product_check_needed/);
    }
    await assert.rejects(db.query(`insert into public.post_images (kind, provider, storage_path, composite_mode, product_image_id, review_status) values ('ai', 'openai', 'x.jpg', 'reference', $1, '사용 가능')`, [prod.id]), /product_check_needed/, '넣을 때도');
    // 상품 장면이 아닌 이미지는 예전처럼
    await db.query(`update public.post_images set review_status = '사용 가능' where id = $1`, [plainAi.id]);
    await db.query(`update public.post_images set review_status = '사용 안 함' where id = $1`, [comp.id]);
    await db.query(`update public.post_images set review_status = '검수 전' where id = $1`, [comp.id]);
  });
  test('검수 저장: 상품 장면 이미지만, 아홉 칸이 모두 괜찮아야 승인', async () => {
    await assert.rejects(check(db, plainAi.id, { items: ALL_OK, approve: true }), /not_product_scene/);
    await assert.rejects(check(db, prod.id, { items: ALL_OK, approve: true }), /not_product_scene/, '원본 상품 사진 자체는 검수 대상이 아님');
    await assert.rejects(check(db, comp.id, { items: { ...ALL_OK, text: 'unsure' }, approve: true }), /product_check_incomplete/);
    await assert.rejects(check(db, comp.id, { items: { ...ALL_OK, consistency: undefined }, approve: true }), /product_check_incomplete/);
    // 승인 없이 저장(중간 저장)은 됨 — 상태는 그대로
    const mid = await check(db, comp.id, { items: { ...ALL_OK, placement: 'issue', bogus: 'ok' }, note: '그림자가 떠 보임' });
    assert.deepEqual([mid.review_status, mid.product_check.approved, mid.product_check.mode, mid.product_check.items.placement, 'bogus' in mid.product_check.items, mid.product_check.note],
      ['검수 전', false, 'layer', 'issue', false, '그림자가 떠 보임']);
    const okd = await check(db, comp.id, { items: ALL_OK, approve: true });
    assert.deepEqual([okd.review_status, okd.product_check.approved, typeof okd.product_check.approved_at], ['사용 가능', true, 'string']);
    const r = await check(db, ref.id, { items: ALL_OK, approve: true });
    assert.deepEqual([r.review_status, r.product_check.mode], ['사용 가능', 'reference']);
  });
  test('승인한 뒤 다른 칸을 고치는 건 됨, 승인을 풀면 다시 검수 전', async () => {
    await db.query(`update public.post_images set alt_text = '거실 탁자 위 상품' where id = $1`, [comp.id]);
    const un = await check(db, comp.id, { items: { ...ALL_OK, shape: 'issue' } });
    assert.deepEqual([un.review_status, un.product_check.approved], ['검수 전', false]);
    await assert.rejects(db.query(`update public.post_images set review_status = '사용 가능' where id = $1`, [comp.id]), /product_check_needed/);
  });
  test("지우기: 결과가 쓰는 원본 상품 사진·합성 배경은 못 지움, 결과를 지우면 지울 수 있고 마스크 파일 경로도 돌려줌", async () => {
    await assert.rejects(val(db, `select public.image_delete($1)`, [prod.id]), /image in use/, '원본 상품 사진은 결과가 있는 동안 남김');
    await assert.rejects(val(db, `select public.image_delete($1)`, [bg.id]), /image in use/, '합성에 쓴 배경');
    assert.deepEqual(await val(db, `select public.image_delete($1)`, [comp.id]), { storage_path: 'composite/c.jpg', ref_small_path: '', mask_paths: [] });
    await val(db, `select public.image_delete($1)`, [bg.id]);
    await assert.rejects(val(db, `select public.image_delete($1)`, [prod.id]), /image in use/, 'AI 실사 장면도 원본 상품 사진을 씀');
    await val(db, `select public.image_delete($1)`, [ref.id]);
    const del = await val(db, `select public.image_delete($1)`, [prod.id]);
    assert.deepEqual(del, { storage_path: 'upload/p.jpg', ref_small_path: '', mask_paths: ['mask/2026/10/m.png'] });
    assert.ok(await val(db, `select deleted_at from public.product_masks where id = $1`, [m.id]));
    // 배경만 남은(합성을 지운) AI 배경은 원본 상품 사진을 붙잡지 않음
    const p2 = await save(db, { kind: 'upload', provider: 'upload', storage_path: 'upload/p2.jpg', rights_confirmed: true, sha256: 'p2' });
    await save(db, { kind: 'ai', provider: 'cloudflare', storage_path: 'ai/bg3.jpg', preset: 'pscene_layer', product_image_id: p2.id });
    await val(db, `select public.image_delete($1)`, [p2.id]);
  });
  test('저장 공간에 마스크 파일 용량도 셈', async () => {
    const before = Number((await val(db, `select public.image_usage()`)).storage_bytes);
    const p3 = await save(db, { kind: 'upload', provider: 'upload', storage_path: 'upload/p3.jpg', rights_confirmed: true, sha256: 'p3', bytes: 100 });
    await mask(db, { image_id: p3.id, bytes: 2000 });
    assert.equal(Number((await val(db, `select public.image_usage()`)).storage_bytes), before + 2100);
  });
});

describe('018 — 검토 뒤: 원본 보존 합성의 배경은 이 상품용 빈 배경만, 발행 막기는 DB도, 지우기·되살리기', () => {
  let db, prod, prod2, plate, plate2, refImg, generic, m, comp;
  const slot = (post, key, image) => val(db, `select public.image_slot_upsert($1, $2::jsonb)`, [post, JSON.stringify({ slot_key: key, slot_index: 0, slot_text: '자리', image_id: image })]);
  const newPost = (stage = 'review', body = '본문\n[이미지: 거실 탁자 위 전기요]\n끝') => val(db, `insert into public.posts (keyword, body, stage) values ('상품', $1, $2) returning id`, [body, stage]);
  const KEY = 'k:거실 탁자 위 전기요#1';
  before(async () => {
    db = await freshDb();
    prod = await save(db, { kind: 'upload', provider: 'upload', storage_path: 'upload/p.jpg', rights_confirmed: true, sha256: 'p1' });
    prod2 = await save(db, { kind: 'upload', provider: 'upload', storage_path: 'upload/p2.jpg', rights_confirmed: true, sha256: 'p2' });
    plate = await save(db, { kind: 'ai', provider: 'cloudflare', storage_path: 'ai/plate.jpg', preset: 'pscene_layer', product_image_id: prod.id });
    plate2 = await save(db, { kind: 'ai', provider: 'cloudflare', storage_path: 'ai/plate2.jpg', preset: 'pscene_layer', product_image_id: prod2.id });
    refImg = await save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/ref.jpg', composite_mode: 'reference', product_image_id: prod.id, preset: 'pscene_layer' });
    generic = await save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/gen.jpg', preset: 'editorial' });
    m = await mask(db, { image_id: prod.id });
  });

  test('AI 실사 장면·일반 AI 이미지·다른 상품용 배경 위에는 원본 상품을 얹지 못함 (두 방식이 섞이지 않게)', async () => {
    const base = { kind: 'composite', provider: 'composite', storage_path: 'composite/c.png', layer: LAYER, product_image_id: prod.id, mask_id: m.id };
    await assert.rejects(save(db, { ...base, background_image_id: refImg.id }), /background_mismatch/, 'AI가 상품을 다시 그린 이미지');
    await assert.rejects(save(db, { ...base, background_image_id: generic.id }), /background_mismatch/, '빈 배경으로 만든 게 아닌 AI 이미지');
    await assert.rejects(save(db, { ...base, background_image_id: plate2.id }), /background_mismatch/, '다른 상품용으로 만든 배경');
    comp = await save(db, { ...base, background_image_id: plate.id });
    assert.equal(comp.composite_mode, 'layer');
  });
  test('빈 배경을 만드는 사이 상품 사진이 지워져도 이미 만든(돈을 낸) 배경은 저장됨 — 결과(합성·AI 실사 장면)는 여전히 살아 있는 상품 사진이 필요', async () => {
    const p3 = await save(db, { kind: 'upload', provider: 'upload', storage_path: 'upload/p3.jpg', rights_confirmed: true, sha256: 'p3' });
    await val(db, `select public.image_delete($1)`, [p3.id]);
    const pl = await save(db, { kind: 'ai', provider: 'cloudflare', storage_path: 'ai/plate3.jpg', preset: 'pscene_layer', product_image_id: p3.id });
    assert.equal(pl.product_image_id, p3.id);
    await assert.rejects(save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/r3.jpg', composite_mode: 'reference', product_image_id: p3.id }), /product_image_required/);
  });
  test('승인 안 한 상품 장면 이미지가 자리에 있으면 발행 준비 완료·예약·게시 완료로 못 바꿈 — 본문에서 사라진 자리도 (DB)', async () => {
    const post = await newPost();
    await slot(post, KEY, comp.id); // 검토 중인 글에는 넣을 수 있음
    for (const st of ['ready', 'scheduled', 'published']) {
      await assert.rejects(db.query(`update public.posts set stage = $2 where id = $1`, [post, st]), /product_check_needed/, st);
    }
    await db.query(`update public.post_image_slots set image_id = null where post_id = $1`, [post]);
    await slot(post, 'k:본문에서 지운 자리#1', comp.id);
    await assert.rejects(db.query(`update public.posts set stage = 'ready' where id = $1`, [post]), /product_check_needed/, '사라진 자리도 봄');
    assert.equal(await val(db, `select public.post_product_unapproved($1)`, [post]), 1);
    await check(db, comp.id, { items: ALL_OK, approve: true });
    await db.query(`update public.posts set stage = 'ready' where id = $1`, [post]);
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [post]), 'ready');
  });
  test('발행 준비 완료·게시 글의 자리에는 승인 안 한 상품 장면 이미지를 못 넣음 (자리 연결·맞바꾸기·같은 파일 다시 올리기 등 어느 길로든 — DB)', async () => {
    const post = await newPost('ready');
    const fresh = await save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/ref2.jpg', composite_mode: 'reference', product_image_id: prod.id });
    await assert.rejects(slot(post, KEY, fresh.id), /product_check_needed/);
    await assert.rejects(db.query(`insert into public.post_image_slots (post_id, slot_key, image_id) values ($1, 'x:cover', $2)`, [post, fresh.id]), /product_check_needed/);
    const live = await newPost('published');
    await assert.rejects(slot(live, KEY, fresh.id), /product_check_needed/);
    // 승인한 이미지·상품 장면이 아닌 이미지는 그대로
    await slot(post, KEY, comp.id);
    await slot(post, 'x:cover', generic.id);
  });
  test('승인을 풀면 그 이미지를 쓰는 발행 준비·예약 글은 휴지통에 있어도 검수 필요로, 게시 완료 글은 그대로', async () => {
    const ready = await newPost('review'), trashed = await newPost('review'), pub = await newPost('review');
    for (const p of [ready, trashed, pub]) await slot(p, KEY, comp.id);
    await db.query(`update public.posts set stage = 'ready' where id = $1`, [ready]);
    await db.query(`update public.posts set stage = 'scheduled', publish_date = current_date + 3 where id = $1`, [trashed]);
    await db.query(`update public.posts set stage = 'published', blog_url = 'https://blog.naver.com/x/1', published_on = current_date where id = $1`, [pub]);
    await db.query(`update public.posts set deleted_at = now() where id = $1`, [trashed]);
    await check(db, comp.id, { items: { ...ALL_OK, text: 'issue' } });
    const st = Object.fromEntries((await all(db, `select id, stage from public.posts where id in ($1, $2, $3)`, [ready, trashed, pub])).map((r) => [r.id, r.stage]));
    assert.deepEqual([st[ready], st[trashed], st[pub]], ['review', 'review', 'published']);
    await check(db, comp.id, { items: ALL_OK, approve: true });
  });
  test('휴지통에서 되살린 발행 준비 글이 승인 안 한 상품 이미지를 쓰고 있으면 검수 필요로 되살아남', async () => {
    const post = await newPost('review');
    await slot(post, KEY, comp.id);
    await db.query(`update public.posts set stage = 'ready' where id = $1`, [post]);
    await db.query(`update public.posts set deleted_at = now() where id = $1`, [post]);
    // (예전 흐름 흉내) 내려 두는 트리거를 잠깐 끄고 승인을 풂 → 휴지통의 글은 발행 준비 그대로
    await db.exec(`alter table public.post_images disable trigger post_images_product_demote`);
    await check(db, comp.id, { items: { ...ALL_OK, shape: 'issue' } });
    await db.exec(`alter table public.post_images enable trigger post_images_product_demote`);
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [post]), 'ready');
    await db.query(`update public.posts set deleted_at = null where id = $1`, [post]);
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [post]), 'review');
    await check(db, comp.id, { items: ALL_OK, approve: true });
  });
  test('그 사진을 참고 사진·고칠 이미지로 지금 만드는 중이면 못 지움 (결과를 저장 못 해 돈만 나가지 않게)', async () => {
    const p4 = await save(db, { kind: 'upload', provider: 'upload', storage_path: 'upload/p4.jpg', rights_confirmed: true, sha256: 'p4' });
    const g = await val(db, `select public.image_gen_begin($1::jsonb)`, [JSON.stringify({ request_key: 'v151-ref-0001-abcdef', provider: 'openai', model: 'gpt-image-2.5-flare', size: '1024x768', quality: 'medium', est_usd: 0.02,
      refs: [{ image_id: p4.id, role: 'subject' }] })]);
    await assert.rejects(val(db, `select public.image_delete($1)`, [p4.id]), /image_generating/);
    await db.query(`update public.image_generations set status = '실패' where id = $1`, [g.id]);
    await val(db, `select public.image_delete($1)`, [p4.id]);
  });
  test('새 함수도 서버 키만', async () => {
    assert.equal(await val(db, `select has_function_privilege('anon', 'public.post_product_unapproved(uuid)', 'execute')`), false);
    assert.equal(await val(db, `select has_function_privilege('authenticated', 'public.post_product_unapproved(uuid)', 'execute')`), false);
    assert.equal(await val(db, `select count(*)::int from pg_trigger where tgname in ('post_image_slots_product_gate', 'posts_product_gate', 'post_images_product_demote')`), 3);
  });
});

describe('018 — 재검토 뒤: 카드뉴스도 발행 막기, 게시한 글의 순서 바꾸기·같은 이미지 다시 연결은 그대로, 잠그는 순서', () => {
  let db, prod, plate, m, comp, refImg;
  const slot = (post, key, image, extra = {}) => val(db, `select public.image_slot_upsert($1, $2::jsonb)`, [post, JSON.stringify({ slot_key: key, slot_index: 0, slot_text: '자리', image_id: image, ...extra })]);
  const newPost = (stage = 'review') => val(db, `insert into public.posts (keyword, body, stage) values ('상품', '본문\n[이미지: 첫 사진]\n[이미지: 둘째 사진]\n끝', $1) returning id`, [stage]);
  const stageOf = (id) => val(db, `select stage from public.posts where id = $1`, [id]);
  const deck = (post, bg, title = '첫 장') => val(db, `select public.card_deck_save($1, $2::jsonb)`, [post, JSON.stringify({ slides: [{ title }], bg_image_id: bg })]);
  const toReady = (post) => db.query(`update public.posts set stage = 'ready' where id = $1`, [post]);
  const card = (bgId, sha) => save(db, { kind: 'card', provider: 'cardnews', mime: 'image/png', storage_path: `card/${sha}.png`, sha256: sha, background_image_id: bgId });
  before(async () => {
    db = await freshDb();
    prod = await save(db, { kind: 'upload', provider: 'upload', storage_path: 'upload/p.jpg', rights_confirmed: true, sha256: 'p1' });
    plate = await save(db, { kind: 'ai', provider: 'cloudflare', storage_path: 'ai/plate.jpg', preset: 'pscene_layer', product_image_id: prod.id });
    m = await mask(db, { image_id: prod.id });
    comp = await save(db, { kind: 'composite', provider: 'composite', storage_path: 'composite/c.png', layer: LAYER, product_image_id: prod.id, background_image_id: plate.id, mask_id: m.id });
    refImg = await save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/ref.jpg', composite_mode: 'reference', product_image_id: prod.id });
  });

  test('카드뉴스 배경: 승인 안 한 상품 장면이면 발행 준비로 못 바꾸고, 승인을 풀면 그 글이 검수 필요로 (휴지통 포함)', async () => {
    const post = await newPost();
    await deck(post, refImg.id);
    assert.equal(await val(db, `select public.post_product_unapproved($1)`, [post]), 1);
    await assert.rejects(toReady(post), /product_check_needed/);
    await check(db, refImg.id, { items: ALL_OK, approve: true });
    await toReady(post);
    const trashed = await newPost();
    await deck(trashed, refImg.id);
    await toReady(trashed);
    await db.query(`update public.posts set deleted_at = now() where id = $1`, [trashed]);
    await check(db, refImg.id, { items: { ...ALL_OK, text: 'issue' } }); // 승인 풀기
    assert.deepEqual([await stageOf(post), await stageOf(trashed)], ['review', 'review']);
    assert.deepEqual((await all(db, `select public.posts_using_image($1) as id`, [refImg.id])).map((r) => r.id).sort(), [post, trashed].sort());
  });
  test('카드뉴스 배경: 발행 준비 글에는 승인 안 한 상품 장면을 새 배경으로 못 고르지만, 같은 배경으로 문구만 고치는 건 됨', async () => {
    await check(db, refImg.id, { items: ALL_OK, approve: true });
    const post = await newPost();
    await deck(post, refImg.id);
    await toReady(post);
    // 승인을 풀면 검수 필요로 내려가니까, 다시 발행 준비 상태를 만들려고 내려 두는 트리거를 잠깐 끔 (다른 기기에서 겹친 경우 흉내)
    await db.exec(`alter table public.post_images disable trigger post_images_product_demote`);
    await check(db, refImg.id, { items: { ...ALL_OK, shape: 'unsure' } });
    await db.exec(`alter table public.post_images enable trigger post_images_product_demote`);
    assert.equal(await stageOf(post), 'ready');
    await deck(post, refImg.id, '문구만 고침'); // 같은 배경 — 새로 넣는 게 아님
    const other = await newPost('ready');
    await assert.rejects(deck(other, refImg.id), /product_check_needed/, '발행 준비 글에 새 배경으로');
    await deck(other, plate.id); // 상품 장면이 아닌 배경은 그대로
    await check(db, refImg.id, { items: ALL_OK, approve: true });
  });
  test('카드뉴스 PNG: 그릴 때 쓴 배경을 기록하고, 그 배경의 승인을 따라감 (발행 준비 글 자리에 못 넣음 · 발행 준비로 못 바꿈 · 승인을 풀면 검수 필요)', async () => {
    const c1 = await card(comp.id, 'card1');
    assert.equal(c1.background_image_id, comp.id);
    assert.equal(c1.composite_mode, '');
    const ready = await newPost('ready');
    await assert.rejects(slot(ready, 'k:첫 사진#1', c1.id), /product_check_needed/, '승인 안 한 합성으로 그린 카드');
    const post = await newPost();
    await slot(post, 'k:첫 사진#1', c1.id);
    await assert.rejects(toReady(post), /product_check_needed/);
    await check(db, comp.id, { items: ALL_OK, approve: true });
    await toReady(post);
    await slot(ready, 'k:첫 사진#1', c1.id);
    await check(db, comp.id, { items: { ...ALL_OK, artifacts: 'issue' } });
    assert.deepEqual([await stageOf(post), await stageOf(ready)], ['review', 'review']);
    // 카드는 따로 검수 대상이 아니고, 배경을 지워도 카드는 남음 (지운 배경을 가리키기만 — 그 승인 상태를 계속 따라감)
    await check(db, comp.id, { items: ALL_OK, approve: true });
  });
  test('게시한 글: 승인을 푼 이미지가 있어도 두 자리 맞바꾸기·같은 이미지 다시 연결·게시 뒤 단계에서 게시 완료로 돌아가기는 됨, 새 이미지는 여전히 막음', async () => {
    const pub = await newPost();
    await slot(pub, 'k:첫 사진#1', comp.id);
    await slot(pub, 'k:둘째 사진#1', plate.id);
    await db.query(`update public.posts set stage = 'published', blog_url = 'https://blog.naver.com/x/9', published_on = current_date where id = $1`, [pub]);
    await check(db, comp.id, { items: { ...ALL_OK, text: 'issue' } }); // 게시 완료 글은 내려가지 않음
    assert.equal(await stageOf(pub), 'published');
    await val(db, `select public.image_slot_swap($1, $2::jsonb, $3::jsonb)`, [pub, JSON.stringify({ slot_key: 'k:첫 사진#1', slot_index: 0, slot_text: '첫 사진' }), JSON.stringify({ slot_key: 'k:둘째 사진#1', slot_index: 1, slot_text: '둘째 사진' })]);
    assert.equal(await val(db, `select image_id from public.post_image_slots where post_id = $1 and slot_key = 'k:둘째 사진#1'`, [pub]), comp.id);
    assert.equal(await val(db, `select current_setting('app.slot_swap_post', true)`), '', '맞바꾸기 표시는 끝나면 꺼짐');
    await slot(pub, 'k:둘째 사진#1', comp.id, { purpose: 'blog_cover' }); // 같은 이미지 다시 연결 (용도 바꾸기)
    await db.query(`update public.posts set stage = 'collecting' where id = $1`, [pub]);
    await db.query(`update public.posts set stage = 'published' where id = $1`, [pub]);
    assert.equal(await stageOf(pub), 'published');
    const fresh = await save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/ref9.jpg', composite_mode: 'reference', product_image_id: prod.id });
    await assert.rejects(slot(pub, 'x:cover', fresh.id), /product_check_needed/, '게시 글에 승인 안 한 새 이미지');
    await assert.rejects(db.query(`update public.posts set stage = 'ready' where id = $1`, [pub]), /product_check_needed/, '게시 → 발행 준비는 다시 검사');
    await check(db, comp.id, { items: ALL_OK, approve: true });
  });
  test('서버 키(service_role)로도 같은 길이 돎 — 새 함수 권한 · 잠그는 함수들', async () => {
    for (const fn of ['public.image_product_unapproved(uuid)', 'public.posts_using_image(uuid)', 'public.card_deck_save(uuid, jsonb)', 'public.image_slot_swap(uuid, jsonb, jsonb)', 'public.image_slot_upsert(uuid, jsonb)']) {
      assert.equal(await val(db, `select has_function_privilege('anon', '${fn}', 'execute')`), false, fn);
      assert.equal(await val(db, `select has_function_privilege('authenticated', '${fn}', 'execute')`), false, fn);
      assert.equal(await val(db, `select has_function_privilege('service_role', '${fn}', 'execute')`), true, fn);
    }
    assert.equal(await val(db, `select count(*)::int from pg_trigger where tgname = 'post_card_decks_product_gate'`), 1);
    // Supabase 처럼 서버 키에 표 권한을 주고, 그 역할로 연결·발행 준비·카드뉴스·승인 풀기·맞바꾸기
    await db.exec(`grant all on all tables in schema public to service_role; grant usage on schema public to service_role; alter role service_role bypassrls;`);
    const post = await newPost();
    await db.exec(`set role service_role`);
    try {
      await slot(post, 'k:첫 사진#1', comp.id);
      await deck(post, refImg.id);
      await toReady(post);
      await check(db, refImg.id, { items: { ...ALL_OK, parts: 'unsure' } });
      assert.equal(await stageOf(post), 'review');
      await val(db, `select public.image_slot_swap($1, $2::jsonb, $3::jsonb)`, [post, JSON.stringify({ slot_key: 'k:첫 사진#1', slot_index: 0, slot_text: '첫 사진' }), JSON.stringify({ slot_key: 'k:둘째 사진#1', slot_index: 1, slot_text: '둘째 사진' })]);
      await assert.rejects(toReady(post), /product_check_needed/);
    } finally { await db.exec(`reset role`); }
    await check(db, refImg.id, { items: ALL_OK, approve: true });
  });
  test('다시 돌려도 같은 결과 (새 트리거도 하나씩)', async () => {
    await db.exec(SQL018);
    for (const t of ['post_image_slots_product_gate', 'post_card_decks_product_gate', 'posts_product_gate', 'post_images_product_demote', 'post_images_product_gate']) {
      assert.equal(await val(db, `select count(*)::int from pg_trigger where tgname = $1`, [t]), 1, t);
    }
  });
});
