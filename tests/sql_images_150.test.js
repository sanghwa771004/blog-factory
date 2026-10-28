// 017 이미지 스튜디오 고품질화 (1.5.0) DB 테스트 — PGlite(진짜 Postgres)에 001~017을 적용해서 확인. 실행: npm test
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, one, all, val, longBody, MIGRATIONS_DIR } from './helpers/db.js';
import { KNOWN_MODELS, modelCaps } from '../images.js';

const KEY = (n) => `v150-key-${String(n).padStart(4, '0')}-abcdef`;
const begin = (db, p) => val(db, `select public.image_gen_begin($1::jsonb)`, [JSON.stringify({ model: 'gpt-image-2.5-flare', size: '1024x1024', quality: 'medium', est_usd: 0.0132, provider: 'openai', ...p })]);
const failGen = (db, id, fin = { cost_status: '청구 없음', provider_called: false }) => val(db, `select public.image_gen_fail($1, $2::jsonb)`, [id, JSON.stringify(fin)]);
const save = (db, img, gen = null, fin = null) => val(db, `select public.image_save($1::jsonb, null, $2::uuid, $3::jsonb)`,
  [JSON.stringify({ kind: 'ai', provider: 'openai', storage_path: 'ai/x.jpg', mime: 'image/jpeg', ...img }), gen, fin && JSON.stringify(fin)]);
const SQL017 = readFileSync(join(MIGRATIONS_DIR, '017_image_studio_1_5_0.sql'), 'utf8');

describe('017 — 기존 데이터·설정은 그대로, 더하기만', () => {
  let db, oldImg, oldGen;
  before(async () => {
    db = await freshDb({
      before: {
        '017': async (d) => {
          // 017 전에 있던 설정·이미지·생성 기록 (실서비스와 같은 모양: 무료 klein 기본, 하루 100, 예산 2달러)
          await d.exec(`update public.settings set image_gen_model = 'cf-flux-2-klein-4b', image_edit_model = 'gpt-image-2.5-sunburst', image_daily_limit = 100, image_monthly_budget_usd = 2 where id = 1;`);
          await d.exec(`insert into public.image_generations (request_key, provider, model, size, quality, status, est_usd, cost_status, auto_cost_status, provider_called)
                        values ('old-key-0001-abcdef', 'cloudflare', 'cf-flux-2-klein-4b', '1024x768', 'medium', '성공', 0, '청구 없음', '청구 없음', true);`);
          await d.exec(`insert into public.post_images (kind, provider, model, storage_path, mime, description) values ('ai', 'cloudflare', 'cf-flux-2-klein-4b', 'ai/old.jpg', 'image/jpeg', '예전 이미지');`);
        },
      },
    });
    oldImg = await one(db, `select * from public.post_images where description = '예전 이미지'`);
    oldGen = await one(db, `select * from public.image_generations where request_key = 'old-key-0001-abcdef'`);
  });

  test('설정 값(모델·한도·예산)은 그대로, 새 칸은 빈 값·안전한 기본값', async () => {
    const s = await one(db, `select image_gen_model, image_edit_model, image_daily_limit, image_monthly_budget_usd::float as budget, image_modes, image_review_model, image_request_cap_usd::float as cap, image_ratio_prefs from public.settings where id = 1`);
    assert.deepEqual(s, { image_gen_model: 'cf-flux-2-klein-4b', image_edit_model: 'gpt-image-2.5-sunburst', image_daily_limit: 100, budget: 2,
      image_modes: {}, image_review_model: '', cap: 1, image_ratio_prefs: {} });
  });
  test('예전 이미지·생성 기록은 그대로 (새 칸은 빈 값)', async () => {
    assert.deepEqual([oldImg.parent_image_id, oldImg.ref_images, oldImg.composite, oldImg.scene, oldImg.preset], [null, [], false, null, '']);
    assert.deepEqual([oldGen.status, oldGen.cost_status, oldGen.refs, oldGen.batch_id, oldGen.batch_kind], ['성공', '청구 없음', [], null, '']);
  });
  test('다시 돌려도 오류 없이 같은 결과 (검사·열이 겹치지 않음)', async () => {
    await db.exec(SQL017);
    await db.exec(SQL017);
    const n = await val(db, `select count(*)::int from pg_constraint where conname in ('post_images_provider_check', 'post_images_v150_checks', 'image_generations_v150_checks', 'settings_image_v150_checks', 'image_reviews_checks')`);
    assert.equal(n, 5);
    assert.equal(await val(db, `select count(*)::int from public.post_images`), 1);
  });
  test('공급자 검사에 gemini 가 더해지고, 모르는 공급자는 여전히 거절', async () => {
    await db.query(`insert into public.post_images (kind, provider, storage_path) values ('ai', 'gemini', 'ai/g.jpg')`);
    await assert.rejects(db.query(`insert into public.post_images (kind, provider, storage_path) values ('ai', 'midjourney', 'ai/m.jpg')`), /check/);
  });
  test('새 표에도 RLS, anon·authenticated 는 새 표·함수를 못 씀', async () => {
    const off = await all(db, `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    assert.deepEqual(off, []);
    const g = await all(db, `select table_name from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name in ('image_reviews','image_provider_checks')`);
    assert.deepEqual(g, []);
    for (const fn of ['public.image_review_begin(jsonb)', 'public.image_review_finish(uuid, jsonb)', 'public.image_eval_save(jsonb)', 'public.image_lineage(uuid)', 'public.image_month_spent()', 'public.image_gen_begin(jsonb)']) {
      assert.equal(await val(db, `select has_function_privilege('anon', '${fn}', 'execute')`), false, fn);
      assert.equal(await val(db, `select has_function_privilege('authenticated', '${fn}', 'execute')`), false, fn);
      assert.equal(await val(db, `select has_function_privilege('service_role', '${fn}', 'execute')`), true, fn);
    }
  });
  test('설정 범위 검사: 모드·비율은 객체, 한 번 상한 0~20, 검수 모델 이름', async () => {
    for (const bad of [`image_modes = '[]'`, `image_ratio_prefs = '"x"'`, `image_request_cap_usd = 25`, `image_request_cap_usd = -1`, `image_review_model = 'Bad Model!'`]) {
      await assert.rejects(db.query(`update public.settings set ${bad} where id = 1`), /check/, bad);
    }
    await db.query(`update public.settings set image_review_model = 'gemini-3.5-flash-lite', image_request_cap_usd = 0.5 where id = 1`);
    await db.query(`update public.settings set image_review_model = '', image_request_cap_usd = 1 where id = 1`);
  });
});

describe('017 — 생성 시작: 공급자·참고 사진·장면 설계서·묶음 예약·한 번 상한', () => {
  let db, post;
  before(async () => {
    db = await freshDb();
    await db.query(`update public.settings set image_daily_limit = 5, image_monthly_budget_usd = 1, image_request_cap_usd = 0.5 where id = 1`);
    post = await val(db, `insert into public.posts (keyword, titles, body, stage, channel_id) values ('a', '["가"]', $1, 'review', 'naver_blog') returning id`, [longBody('[이미지: 첫 사진]')]);
  });
  test('공급자는 openai·cloudflare·gemini 만 — 빈칸·모르는 공급자를 openai 로 바꾸지 않고 거절', async () => {
    await assert.rejects(begin(db, { request_key: KEY(1), provider: '' }), /bad provider/);
    await assert.rejects(begin(db, { request_key: KEY(1), provider: 'midjourney' }), /bad provider/);
    const g = await begin(db, { request_key: KEY(1), provider: 'gemini', model: 'gemini-3-pro-image', size: '4:3@2K', quality: 'high', est_usd: 0.14 });
    assert.equal(g.provider, 'gemini');
    await failGen(db, g.id);
  });
  test('참고 사진·장면 설계서·이미지 종류·묶음을 기록', async () => {
    const refs = [{ image_id: '00000000-0000-4000-8000-000000000001', role: 'subject' }];
    const scene = { v: 1, preset: 'product_still', type: 'photo', subject: '제습기' };
    const b = '11111111-1111-4111-8111-111111111111';
    const g = await begin(db, { request_key: KEY(2), post_id: post, refs, scene, preset: 'product_still', batch_id: b, batch_kind: 'candidates', batch_index: 0, batch_total: 2, reserve_n: 2, reserve_usd: 0.0264 });
    assert.deepEqual([g.refs, g.scene, g.preset, g.batch_id, g.batch_kind, g.batch_index, g.batch_total], [refs, scene, 'product_still', b, 'candidates', 0, 2]);
    await failGen(db, g.id);
    await assert.rejects(begin(db, { request_key: KEY(3), batch_kind: 'everything' }), /check/);
    await assert.rejects(begin(db, { request_key: KEY(3), batch_total: 4, batch_index: 0, batch_kind: 'compare', batch_id: b }), /check/);
  });
  test('묶음: 남은 장 수로 하루 한도를 미리 확인 (반만 만들어지지 않게)', async () => {
    // 지금까지 셈에 들어간 생성 0번 (실패 기록은 provider_called=false). 한도 5
    for (let i = 0; i < 3; i++) { const g = await begin(db, { request_key: KEY(10 + i), est_usd: 0 }); await failGen(db, g.id, { cost_status: '청구 없음' }); }
    // 3번 썼음 → 3장 묶음은 6 > 5 라 거절, 2장 묶음은 5 이하라 됨
    await assert.rejects(begin(db, { request_key: KEY(20), est_usd: 0, reserve_n: 3 }), /image_daily_limit/);
    const g = await begin(db, { request_key: KEY(20), est_usd: 0, reserve_n: 2 });
    await failGen(db, g.id, { cost_status: '청구 없음', provider_called: false });
  });
  test('묶음: 남은 장의 예상 비용(reserve_usd)으로 예산·한 번 상한을 확인', async () => {
    await db.query(`update public.image_generations set provider_called = false`);
    // 예산 1달러, 한 번 상한 0.5달러: 장당 0.2 × 3장 = 0.6 → 상한에 걸림, 0.4 는 됨
    await assert.rejects(begin(db, { request_key: KEY(30), est_usd: 0.2, reserve_n: 3, reserve_usd: 0.6 }), /image_request_cap/);
    const g = await begin(db, { request_key: KEY(30), est_usd: 0.2, reserve_n: 2, reserve_usd: 0.4 });
    await failGen(db, g.id, { cost_status: '확인 필요' }); // 0.2 가 이번 달 비용으로 셈
    // reserve_usd 를 est 보다 작게 보내도 est 로 셈 (화면이 틀려도 덜 막지 않게)
    await db.query(`update public.settings set image_monthly_budget_usd = 0.3 where id = 1`);
    await assert.rejects(begin(db, { request_key: KEY(31), est_usd: 0.15, reserve_usd: 0.01 }), /image_budget/);
    await db.query(`update public.settings set image_monthly_budget_usd = 1 where id = 1`);
  });
  test('4분 넘게 멈춘 생성 정리: 무료 Cloudflare 는 청구 없음, 유료(OpenAI·Gemini)는 확인 필요', async () => {
    const cf = await begin(db, { request_key: KEY(40), provider: 'cloudflare', model: 'cf-flux-2-klein-4b', size: '1024x768', est_usd: 0 });
    await db.query(`update public.image_generations set started_at = now() - interval '5 minutes' where id = $1`, [cf.id]);
    const g = await begin(db, { request_key: KEY(41), provider: 'gemini', model: 'gemini-3-pro-image', size: '4:3@2K', quality: 'high', est_usd: 0.14 });
    await db.query(`update public.image_generations set started_at = now() - interval '5 minutes' where id = $1`, [g.id]);
    // 새 생성을 시작할 때 멈춘 앞의 것을 정리함 (gemini 시작이 cf 를, 그다음 시작이 gemini 를)
    const n = await begin(db, { request_key: KEY(42), est_usd: 0 });
    const rows = await all(db, `select provider, status, error_code, cost_status, auto_cost_status from public.image_generations where id in ($1, $2) order by provider`, [cf.id, g.id]);
    assert.deepEqual(rows, [
      { provider: 'cloudflare', status: '실패', error_code: 'timeout', cost_status: '청구 없음', auto_cost_status: '청구 없음' },
      { provider: 'gemini', status: '실패', error_code: 'timeout', cost_status: '확인 필요', auto_cost_status: '확인 필요' },
    ]);
    await failGen(db, n.id, { cost_status: '청구 없음', provider_called: false });
  });
  test('참고 사진 수: 앱 모델 표의 가장 큰 수(OpenAI 16장)까지 받고, 그보다 많으면 거절', async () => {
    await db.query(`update public.image_generations set provider_called = false`);
    const max = Math.max(...KNOWN_MODELS.map((m) => modelCaps(m).refsMax));
    assert.equal(max, 16, 'DB 검사(16)와 모델 표가 같아야 함');
    const refs = (n) => Array.from({ length: n }, (_, i) => ({ image_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, role: 'style' }));
    const g = await begin(db, { request_key: KEY(50), refs: refs(16) });
    assert.equal(g.refs.length, 16);
    await failGen(db, g.id);
    await assert.rejects(begin(db, { request_key: KEY(51), refs: refs(17) }), /check/);
  });
});

describe('017 — 저장·수정 이력·AI 검수·사용자 평가·비용 통계', () => {
  let db, post, root, child, grand, ref;
  before(async () => {
    db = await freshDb();
    await db.query(`update public.settings set image_daily_limit = 50, image_monthly_budget_usd = 1, image_request_cap_usd = 1 where id = 1`);
    post = await val(db, `insert into public.posts (keyword, titles, body, stage, channel_id) values ('a', '["가"]', $1, 'review', 'naver_blog') returning id`, [longBody('[이미지: 첫 사진]')]);
    ref = (await save(db, { kind: 'upload', provider: 'upload', storage_path: 'up/ref.jpg', description: '진짜 제품 사진', rights_confirmed: true })).image;
    const g1 = await begin(db, { request_key: KEY(1), post_id: post, est_usd: 0.02 });
    root = (await save(db, { origin_post_id: post, description: '원본', ref_images: [{ image_id: ref.id, role: 'subject', kind: 'upload' }], composite: true, scene: { v: 1, type: 'photo' }, preset: 'product_still' }, g1.id, { usage_usd: 0.019, cost_status: '사용량 기준' })).image;
    const g2 = await begin(db, { request_key: KEY(2), post_id: post, mode: 'edit', base_image_id: root.id, est_usd: 0.03 });
    child = (await save(db, { origin_post_id: post, description: '조명 고침', user_prompt: '조명만 더 자연스럽게', parent_image_id: root.id }, g2.id, { usage_usd: 0.028, cost_status: '사용량 기준' })).image;
    const g3 = await begin(db, { request_key: KEY(3), post_id: post, mode: 'edit', base_image_id: child.id, est_usd: 0.03 });
    grand = (await save(db, { origin_post_id: post, description: '각도 고침', user_prompt: '카메라를 조금 높게', parent_image_id: child.id }, g3.id, { cost_status: '예상' })).image;
  });
  test('저장: 참고 사진(역할)·실제 사진 참고 여부·장면 설계서·이미지 종류·고친 원본', async () => {
    assert.deepEqual(root.ref_images, [{ image_id: ref.id, role: 'subject', kind: 'upload' }]);
    assert.equal(root.composite, true);
    assert.deepEqual(root.scene, { v: 1, type: 'photo' });
    assert.equal(root.preset, 'product_still');
    assert.equal(child.parent_image_id, root.id);
    await assert.rejects(db.query(`update public.post_images set parent_image_id = id where id = $1`, [root.id]), /check/, '자기 자신을 원본으로 둘 수 없음');
  });
  test('수정 이력: 어느 이미지에서 물어봐도 맨 처음 원본부터 고친 것까지, 원본은 그대로 남음', async () => {
    for (const id of [root.id, child.id, grand.id]) {
      const l = await val(db, `select public.image_lineage($1)`, [id]);
      assert.equal(l.root_id, root.id);
      assert.deepEqual(l.items.map((x) => [x.id, x.level]), [[root.id, 0], [child.id, 1], [grand.id, 2]]);
    }
    const l = await val(db, `select public.image_lineage($1)`, [grand.id]);
    assert.equal(l.items[1].user_prompt, '조명만 더 자연스럽게');
    assert.equal(Number(l.items[1].cost.usage_usd), 0.028);
    assert.equal(l.items[1].cost.mode, 'edit');
    // 원본을 지워도 이력에는 '지운 이미지'로 남음 (고친 이미지는 그대로)
    await db.query(`update public.post_images set deleted_at = now() where id = $1`, [child.id]);
    const l2 = await val(db, `select public.image_lineage($1)`, [grand.id]);
    assert.deepEqual(l2.items.map((x) => x.deleted), [false, true, false]);
    await db.query(`update public.post_images set deleted_at = null where id = $1`, [child.id]);
  });
  test('AI 검수: 예산·한 번 상한 안에서만, 같은 이미지를 동시에 두 번 안 함, 결과·비용 기록', async () => {
    await assert.rejects(val(db, `select public.image_review_begin($1::jsonb)`, [JSON.stringify({ image_id: root.id, provider: 'gemini', model: 'gemini-3.5-flash-lite' })]), /est_usd is required/);
    await assert.rejects(val(db, `select public.image_review_begin($1::jsonb)`, [JSON.stringify({ image_id: root.id, provider: 'x', est_usd: 0 })]), /bad provider/);
    await assert.rejects(val(db, `select public.image_review_begin($1::jsonb)`, [JSON.stringify({ image_id: root.id, provider: 'gemini', est_usd: 2 })]), /image_budget/);
    const r = await val(db, `select public.image_review_begin($1::jsonb)`, [JSON.stringify({ image_id: root.id, provider: 'gemini', model: 'gemini-3.5-flash-lite', est_usd: 0.002, post_id: post })]);
    assert.equal(r.status, '진행 중');
    assert.equal(r.post_id, post);
    await assert.rejects(val(db, `select public.image_review_begin($1::jsonb)`, [JSON.stringify({ image_id: root.id, provider: 'gemini', est_usd: 0.002 })]), /review_busy/);
    const done = await val(db, `select public.image_review_finish($1, $2::jsonb)`, [r.id, JSON.stringify({ ok: true, scores: { checks: { match: { verdict: 'ok', reason: '맞음', confidence: 0.8 } } }, summary: '괜찮아', suggestions: ['글자만 지워줘'], usage_usd: 0.0018, cost_status: '사용량 기준' })]);
    assert.deepEqual([done.status, done.summary, done.suggestions, Number(done.usage_usd), done.cost_status], ['완료', '괜찮아', ['글자만 지워줘'], 0.0018, '사용량 기준']);
    await assert.rejects(val(db, `select public.image_review_finish($1, '{}'::jsonb)`, [r.id]), /not running/);
    // 무료 검수는 청구 없음으로 시작
    const free = await val(db, `select public.image_review_begin($1::jsonb)`, [JSON.stringify({ image_id: child.id, provider: 'cloudflare', est_usd: 0 })]);
    assert.equal(free.cost_status, '청구 없음');
    await val(db, `select public.image_review_finish($1, $2::jsonb)`, [free.id, JSON.stringify({ ok: false, error_code: 'cf_daily_free_used', cost_status: '청구 없음' })]);
  });
  test('이번 달 비용·예산: 생성 + AI 검수 (청구 없음은 0)', async () => {
    const spent = Number(await val(db, `select public.image_month_spent()`));
    assert.equal(Math.round(spent * 1e6) / 1e6, 0.019 + 0.028 + 0.03 + 0.0018);
    const u = await val(db, `select public.image_usage()`);
    assert.equal(Math.round(Number(u.month_usd) * 1e6) / 1e6, Math.round(spent * 1e6) / 1e6);
    assert.equal(Number(u.request_cap_usd), 1);
  });
  test('이미지 비용 통계: 검수 비용을 같이 더하고 따로도 보여줌 (생성 횟수에는 안 섞음)', async () => {
    const c = await val(db, `select public.image_costs(null, null, $1)`, [post]);
    assert.equal(c.totals.count, 3, '생성 3번');
    assert.equal(c.totals.reviews, 2, '검수 2번 (유료 1번 + 실패한 무료 1번 — 글은 이미지가 처음 만들어진 원고로)');
    assert.equal(Math.round(Number(c.totals.review_usd) * 1e6) / 1e6, 0.0018);
    assert.equal(Math.round(Number(c.totals.usd) * 1e6) / 1e6, Math.round((0.019 + 0.028 + 0.03 + 0.0018) * 1e6) / 1e6);
  });
  test('사용자 평가: 이미지마다 하나(다시 매기면 고침), 묶음에서 제일 나은 것은 하나만, AI 검수와 따로', async () => {
    const b = '22222222-2222-4222-8222-222222222222';
    await val(db, `select public.image_eval_save($1::jsonb)`, [JSON.stringify({ image_id: root.id, batch_id: b, scores: { fit: 3, ai_look: 2 }, preferred: true })]);
    await val(db, `select public.image_eval_save($1::jsonb)`, [JSON.stringify({ image_id: child.id, batch_id: b, scores: { fit: 2 }, preferred: true })]);
    const rows = await all(db, `select image_id, preferred, scores from public.image_reviews where kind = 'user_eval' order by created_at`);
    assert.deepEqual(rows.map((r) => [r.image_id, r.preferred]), [[root.id, false], [child.id, true]]);
    await val(db, `select public.image_eval_save($1::jsonb)`, [JSON.stringify({ image_id: child.id, batch_id: b, scores: { fit: 3, usable: 3 }, preferred: true })]);
    assert.equal(await val(db, `select count(*)::int from public.image_reviews where kind = 'user_eval' and image_id = $1`, [child.id]), 1);
    assert.deepEqual(await val(db, `select scores from public.image_reviews where kind = 'user_eval' and image_id = $1`, [child.id]), { fit: 3, usable: 3 });
    assert.equal(await val(db, `select count(*)::int from public.image_reviews where kind = 'ai_review'`), 2, 'AI 검수 기록은 그대로');
    await assert.rejects(val(db, `select public.image_eval_save($1::jsonb)`, [JSON.stringify({ image_id: root.id, scores: [] })]), /scores must be an object/);
  });
  test('안전 삭제: 작은 사본(FLUX.2 klein 참고용) 경로도 돌려줘서 서버가 같이 지움, 고친 이미지의 원본 표시는 남음', async () => {
    // 작은 사본은 저장한 뒤에 따로 올림 (서버 POST /images/{id}/small 이 이 칸만 고침) — image_save 로는 넣지 않음
    const r = (await save(db, { description: '작은 사본 있는 사진', kind: 'upload', provider: '', storage_path: 'up/big.jpg', ref_small_path: 'small/무시됨.jpg' })).image;
    assert.equal(r.ref_small_path, '', 'image_save 는 작은 사본 경로를 받지 않음');
    await db.query(`update public.post_images set ref_small_path = 'small/2026/10/s.jpg' where id = $1`, [r.id]);
    assert.deepEqual(await val(db, `select public.image_delete($1)`, [r.id]), { storage_path: 'up/big.jpg', ref_small_path: 'small/2026/10/s.jpg', mask_paths: [] });
    await assert.rejects(db.query(`update public.post_images set ref_small_path = $1 where id = $2`, ['x'.repeat(201), root.id]), /check/, '경로 길이 제한');
    // 원본(child)을 지우는 것은 소프트 삭제라 grand 의 원본 id 는 그대로 (수정 이력이 끊기지 않음)
    assert.deepEqual(await val(db, `select public.image_delete($1)`, [child.id]), { storage_path: 'ai/x.jpg', ref_small_path: '', mask_paths: [] });
    assert.equal(await val(db, `select parent_image_id from public.post_images where id = $1`, [grand.id]), child.id);
    await db.query(`update public.post_images set deleted_at = null where id = $1`, [child.id]);
  });
  test('연결 확인 기록: 공급자 3곳만', async () => {
    await db.query(`insert into public.image_provider_checks (provider, model, ok, code) values ('gemini', 'gemini-3-pro-image', true, 'ok')`);
    await assert.rejects(db.query(`insert into public.image_provider_checks (provider, ok) values ('pexels', true)`), /check/);
  });
  test("비용 통계의 '확인 필요': 생성(청구액을 넣어 고칠 수 있는 것)과 AI 검수를 따로 셈, 글마다 검수 비용도 (1.5.0 검토)", async () => {
    // 응답을 못 받은 유료 생성 → 확인 필요 (예상 비용으로 셈)
    const g = await begin(db, { request_key: KEY(9), post_id: post, est_usd: 0.05 });
    await failGen(db, g.id, { provider_called: true, error_code: 'timeout', error_message: '응답 없음', cost_status: '확인 필요' });
    // 결과를 못 받은 유료 검수 → 확인 필요 (예상 비용으로 셈)
    const r = await val(db, `select public.image_review_begin($1::jsonb)`, [JSON.stringify({ image_id: grand.id, provider: 'gemini', model: 'gemini-3.5-flash-lite', est_usd: 0.003, post_id: post })]);
    await val(db, `select public.image_review_finish($1, $2::jsonb)`, [r.id, JSON.stringify({ ok: false, error_code: 'timeout', cost_status: '확인 필요' })]);
    const c = await val(db, `select public.image_costs(null, null, $1)`, [post]);
    const r6 = (x) => Math.round(Number(x) * 1e6) / 1e6;
    assert.deepEqual([c.totals.count, c.totals.uncertain, c.totals.reviews, c.totals.review_uncertain], [4, 1, 3, 1], '확인 필요는 생성 1 · 검수 1 따로');
    assert.equal(r6(c.totals.review_usd), r6(0.0018 + 0.003), '확인 필요 검수는 예상 비용으로 더함');
    assert.equal(r6(c.totals.usd), r6(0.019 + 0.028 + 0.03 + 0.05 + 0.0018 + 0.003));
    const bp = c.by_post.find((x) => x.key === post);
    assert.deepEqual([bp.count, bp.uncertain, bp.reviews], [4, 1, 3]);
    assert.equal(r6(bp.review_usd), r6(0.0018 + 0.003));
  });
});

describe('017 — 검토 전 초안으로 만든 검사(참고 사진 14장)가 남은 DB도 16장으로', () => {
  test('예전 검사가 있으면 같은 이름으로 다시 걸어 넓히고, 다시 돌려도 그대로 (데이터는 안 건드림)', async () => {
    const db = await freshDb();
    // 검토 전 초안의 검사로 바꿔 둠 (14장) — 그 초안을 돌린 DB 흉내
    await db.exec(`alter table public.post_images drop constraint post_images_v150_checks;
      alter table public.post_images add constraint post_images_v150_checks check (jsonb_typeof(ref_images) = 'array' and jsonb_array_length(ref_images) <= 14
        and (scene is null or jsonb_typeof(scene) = 'object') and length(preset) <= 30 and (parent_image_id is null or parent_image_id <> id) and length(ref_small_path) <= 200);
      alter table public.image_generations drop constraint image_generations_v150_checks;
      alter table public.image_generations add constraint image_generations_v150_checks check (jsonb_typeof(refs) = 'array' and jsonb_array_length(refs) <= 14
        and (scene is null or jsonb_typeof(scene) = 'object') and length(preset) <= 30 and batch_kind in ('', 'candidates', 'compare')
        and (batch_index is null or batch_index between 0 and 2) and (batch_total is null or batch_total between 1 and 3));`);
    const def = (n) => val(db, `select pg_get_constraintdef(oid) from pg_constraint where conname = $1`, [n]);
    assert.match(await def('post_images_v150_checks'), /<= 14/);
    const before = await val(db, `select count(*)::int from public.post_images`);
    await db.exec(SQL017);
    for (const n of ['post_images_v150_checks', 'image_generations_v150_checks']) {
      assert.match(await def(n), /<= 16/, n);
      assert.ok(!/<= 14/.test(await def(n)), n);
    }
    await db.exec(SQL017);
    assert.match(await def('post_images_v150_checks'), /<= 16/, '다시 돌려도 그대로');
    assert.equal(await val(db, `select count(*)::int from public.post_images`), before, '데이터는 그대로');
  });
});

describe('017 — 비공개 버킷 한 파일 한도 (Supabase storage 흉내)', () => {
  test('10MB → 25MB 로 넓히기만: 비공개·허용 형식은 그대로, 한도가 없거나 이미 더 크면 안 건드림', async () => {
    // 테스트용 Postgres 에는 storage 스키마가 없어서, 012 직전에 Supabase 와 같은 이름의 표를 만들어 둠
    const mk = (d) => d.exec(`create schema if not exists storage;
      create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
    const db = await freshDb({ before: { '012': mk } });
    assert.deepEqual(await one(db, `select public, file_size_limit::int as lim, allowed_mime_types from storage.buckets where id = 'post-images'`),
      { public: false, lim: 26214400, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] });
    await db.exec(`update storage.buckets set file_size_limit = 52428800 where id = 'post-images'`);
    await db.exec(SQL017);
    assert.equal(await val(db, `select file_size_limit::int from storage.buckets where id = 'post-images'`), 52428800, '더 큰 한도는 줄이지 않음');
    await db.exec(`update storage.buckets set file_size_limit = null where id = 'post-images'`);
    await db.exec(SQL017);
    assert.equal(await val(db, `select file_size_limit from storage.buckets where id = 'post-images'`), null, '한도 없음은 그대로');
  });
});

describe('017 파일 자체', () => {
  test('표를 지우거나 비우지 않고, 기존 설정 값을 바꾸지 않음', () => {
    assert.ok(!/drop table|truncate|delete from public\.(posts|metrics|links|products|post_images|image_generations|settings)/i.test(SQL017));
    assert.ok(!/update public\.settings set/i.test(SQL017), '설정 값을 바꾸는 줄이 없음');
    assert.ok(!/create policy/i.test(SQL017));
  });
});
