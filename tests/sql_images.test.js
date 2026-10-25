// 이미지 스튜디오 DB(012) 테스트 — PGlite(진짜 Postgres 17)에 001~012를 적용해서 확인. 실행: npm test
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all, val, longBody, MIGRATIONS_DIR } from './helpers/db.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSlots, matchSlots, planSlotSync, ctxOf } from '../images.js';

const KEY = (n) => `req-key-${String(n).padStart(4, '0')}-abcdef`;
const begin = (db, p) => val(db, `select public.image_gen_begin($1::jsonb)`, [JSON.stringify({ model: 'gpt-image-2.5-flare', size: '1024x1024', quality: 'medium', est_usd: 0.0132, ...p })]);
const save = (db, img, link = null, gen = null, fin = null) => val(db, `select public.image_save($1::jsonb, $2::jsonb, $3::uuid, $4::jsonb)`,
  [JSON.stringify({ kind: 'upload', provider: 'upload', storage_path: 'up/x.jpg', mime: 'image/jpeg', ...img }), link && JSON.stringify(link), gen, fin && JSON.stringify(fin)]);
const slotRow = (db, post, key) => one(db, `select * from public.post_image_slots where post_id = $1 and slot_key = $2`, [post, key]);

describe('012 이미지 스튜디오 마이그레이션', () => {
  let db, postA, postB;
  before(async () => {
    db = await freshDb({
      before: {
        '012': async (d) => {
          // 012 전에 이미 있던 원고·실적은 그대로 남아야 함
          await d.exec(`insert into public.posts (keyword, titles, body, stage, channel_id, program_ids) values
            ('원룸 히터', '["원룸 히터 고르는 법"]', '본문 [이미지: 히터]', 'review', 'naver_blog', '{coupang_partners}');
            insert into public.metrics (period_start, period_end, clicks, source) values ('2026-10-01', '2026-10-01', 3, 'manual');`);
        },
      },
    });
    postA = await val(db, `insert into public.posts (keyword, titles, body, stage, channel_id) values ('a', '["가"]', $1, 'review', 'naver_blog') returning id`, [longBody('[이미지: 첫 사진]\n[이미지: 둘째 사진]')]);
    postB = await val(db, `insert into public.posts (keyword, titles, body, stage, channel_id) values ('b', '["나"]', $1, 'review', 'naver_blog') returning id`, [longBody('[이미지: 다른 글 사진]')]);
  });

  test('기존 데이터는 그대로, 새 표에는 모두 RLS, 설정 기본값', async () => {
    assert.equal(await val(db, `select count(*)::int from public.posts where keyword = '원룸 히터'`), 1);
    assert.equal(await val(db, `select clicks from public.metrics where period_start = '2026-10-01'`), 3);
    const off = await all(db, `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    assert.deepEqual(off, []);
    const s = await one(db, `select image_gen_model, image_edit_model, image_quality, image_daily_limit, image_monthly_budget_usd::float as budget, image_fx_krw, image_prices from public.settings where id = 1`);
    assert.equal(s.image_gen_model, 'cf-flux-1-schnell');
    assert.equal(s.image_edit_model, 'gpt-image-2.5-sunburst');
    assert.equal(s.image_quality, 'medium');
    assert.equal(s.image_daily_limit, 5);
    assert.equal(s.budget, 2);
    assert.equal(s.image_fx_krw, null, '환율은 비워둠 (확인한 기준을 사용자가 넣음)');
    assert.equal(s.image_prices.image_output_per_m, 30);
    assert.equal(s.image_prices.checked_at, '2026-10-22');
  });

  test('설정 범위 검사: 품질·한도·예산·환율·모델 이름', async () => {
    for (const bad of [`image_quality = 'ultra'`, `image_daily_limit = 101`, `image_monthly_budget_usd = -1`, `image_fx_krw = 5`, `image_gen_model = 'Bad Model!'`]) {
      await assert.rejects(db.query(`update public.settings set ${bad} where id = 1`), /check/, bad);
    }
    // 013: 하루 한도는 100까지 (무료 모델용)
    await db.query(`update public.settings set image_daily_limit = 100 where id = 1`);
    await db.query(`update public.settings set image_daily_limit = 5 where id = 1`);
  });

  test('anon·authenticated 는 새 표·함수를 못 씀', async () => {
    const g = await all(db, `select table_name, privilege_type from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name in ('post_images','post_image_slots','image_generations','post_card_decks','api_calls')`);
    assert.deepEqual(g, []);
    assert.equal(await val(db, `select has_function_privilege('anon', 'public.image_gen_begin(jsonb)', 'execute')`), false);
    assert.equal(await val(db, `select has_function_privilege('service_role', 'public.image_gen_begin(jsonb)', 'execute')`), true);
    assert.equal(await val(db, `select has_function_privilege('anon', 'public.card_deck_save(uuid, jsonb)', 'execute')`), false);
    assert.equal(await val(db, `select has_function_privilege('authenticated', 'public.card_deck_save(uuid, jsonb)', 'execute')`), false);
    assert.equal(await val(db, `select has_function_privilege('service_role', 'public.card_deck_save(uuid, jsonb)', 'execute')`), true);
  });

  describe('생성 시작 (중복·동시·하루 한도·예산)', () => {
    before(async () => { await db.query(`update public.settings set image_daily_limit = 3, image_monthly_budget_usd = 0.05 where id = 1`); });

    test('같은 요청 키는 한 번만, 만드는 중이면 다른 요청은 거절', async () => {
      const g1 = await begin(db, { request_key: KEY(1), post_id: postA, slot_key: 'k:첫 사진#1' });
      assert.equal(g1.status, '생성 중');
      assert.equal(g1.duplicate, false);
      assert.equal(g1.used_today, 1);
      const again = await begin(db, { request_key: KEY(1) });
      assert.equal(again.duplicate, true);
      assert.equal(again.id, g1.id);
      await assert.rejects(begin(db, { request_key: KEY(2) }), /image_busy/);
      assert.equal(await val(db, `select count(*)::int from public.image_generations`), 1);
      // 동시에 두 줄이 '생성 중'일 수 없음 (DB 인덱스)
      await assert.rejects(db.query(`insert into public.image_generations (request_key, model) values ($1, 'm')`, [KEY(99)]), /duplicate key|unique/);
      await val(db, `select public.image_gen_fail($1, '{"error_code":"moderation_blocked","cost_status":"청구 없음"}'::jsonb)`, [g1.id]);
      await assert.rejects(val(db, `select public.image_gen_fail($1, '{}'::jsonb)`, [g1.id]), /not running/, '끝난 기록은 다시 못 바꿈');
    });

    test('4분 넘게 멈춘 생성은 실패(확인 필요)로 정리하고 새 요청을 받음', async () => {
      const g = await begin(db, { request_key: KEY(3) });
      await db.query(`update public.image_generations set started_at = now() - interval '5 minutes' where id = $1`, [g.id]);
      const g2 = await begin(db, { request_key: KEY(4) });
      assert.equal(g2.status, '생성 중');
      const old = await one(db, `select status, error_code, cost_status from public.image_generations where id = $1`, [g.id]);
      assert.deepEqual(old, { status: '실패', error_code: 'timeout', cost_status: '확인 필요' });
      await val(db, `select public.image_gen_fail($1, '{"error_code":"server","cost_status":"청구 없음"}'::jsonb)`, [g2.id]);
    });

    test('하루 한도: OpenAI까지 간 요청만 셈, 한도에 닿으면 거절', async () => {
      // 지금까지 3번 (KEY1 실패, KEY3 타임아웃, KEY4 실패) → 한도 3
      await assert.rejects(begin(db, { request_key: KEY(5) }), /image_daily_limit/);
      await db.query(`update public.image_generations set provider_called = false where request_key = $1`, [KEY(4)]);
      const g = await begin(db, { request_key: KEY(5) });
      assert.equal(g.used_today, 3);
      await val(db, `select public.image_gen_fail($1, '{"error_code":"x","cost_status":"청구 없음"}'::jsonb)`, [g.id]);
    });

    test('한 달 예산: 청구 없음은 빼고, 실제 > 사용량 > 예상 순으로 더해서 넘으면 거절', async () => {
      await db.query(`update public.settings set image_daily_limit = 50 where id = 1`);
      // 지금까지: KEY3 타임아웃(확인 필요, 예상 0.0132)만 셈 → 0.0132
      const g = await begin(db, { request_key: KEY(6), est_usd: 0.03 });
      assert.equal(Number(g.spent_usd), 0.0132);
      await val(db, `select public.image_gen_fail($1, '{"error_code":"x","cost_status":"확인 필요"}'::jsonb)`, [g.id]);
      // 0.0132 + 0.03 = 0.0432 → 다음 0.01 은 0.0532 > 0.05
      await assert.rejects(begin(db, { request_key: KEY(7), est_usd: 0.01 }), /image_budget/);
      await db.query(`update public.image_generations set actual_usd = 0, cost_status = '청구액 확인' where request_key = $1`, [KEY(6)]);
      const ok = await begin(db, { request_key: KEY(7), est_usd: 0.01 });
      assert.equal(Number(ok.spent_usd), 0.0132, '실제 청구액 0원을 넣으면 그걸로 셈');
      await val(db, `select public.image_gen_fail($1, '{"cost_status":"청구 없음"}'::jsonb)`, [ok.id]);
      await assert.rejects(begin(db, { request_key: '' }), /request_key/);
    });

    test('예상 비용·모델이 빠진 요청은 거절 (예산 검사를 건너뛰지 않게), 사용자가 확인한 말은 기록', async () => {
      await assert.rejects(begin(db, { request_key: KEY(8), est_usd: undefined }), /est_usd is required/);
      await assert.rejects(begin(db, { request_key: KEY(8), est_usd: '' }), /est_usd is required/);
      await assert.rejects(begin(db, { request_key: KEY(8), model: '' }), /model is required/);
      const g = await begin(db, { request_key: KEY(8), est_usd: 0.001, risk_override: 'generic_ok:구성품' });
      assert.equal(g.risk_override, 'generic_ok:구성품');
      await val(db, `select public.image_gen_fail($1, '{"cost_status":"청구 없음","provider_called":false}'::jsonb)`, [g.id]);
    });
  });

  describe('저장·연결', () => {
    let gen;
    before(async () => {
      await db.query(`update public.settings set image_daily_limit = 50, image_monthly_budget_usd = 100 where id = 1`);
      gen = await begin(db, { request_key: KEY(20), post_id: postA, slot_key: 'k:첫 사진#1' });
    });

    test('AI 결과 저장 = 보관함 + 자리 연결 + 생성 기록 성공 (한 번에)', async () => {
      const r = await save(db, { kind: 'ai', provider: 'openai', model: 'gpt-image-2.5-flare', storage_path: 'ai/1.jpg', origin_post_id: postA, width: 1280, height: 960 },
        { post_id: postA, slot_key: 'k:첫 사진#1', slot_index: 0, slot_text: '첫 사진' }, gen.id, { usage: { output_tokens: 349 }, usage_usd: 0.01047, revised_prompt: 'x' });
      assert.equal(r.image.kind, 'ai');
      assert.equal(r.image.review_status, '검수 전', '처음엔 검수 전');
      assert.equal(r.slot.image_id, r.image.id);
      assert.equal(r.generation.status, '성공');
      assert.equal(r.generation.cost_status, '사용량 기준');
      assert.equal(r.generation.image_id, r.image.id);
      await assert.rejects(save(db, { kind: 'ai' }, null, gen.id, {}), /not running/, '이미 끝난 생성에 또 저장 못 함');
    });

    test('점검용 가짜 모델 결과: 청구 없음·하루 횟수에 안 셈 → 비용 통계의 청구 건수에도 안 들어감', async () => {
      const g = await begin(db, { request_key: KEY(21), model: 'gf-test-fake', est_usd: 0 });
      const r = await save(db, { kind: 'ai', provider: '', model: 'gf-test-fake', storage_path: 'ai/test.jpg' }, null, g.id,
        { usage: { output_tokens: 0 }, usage_usd: 0, cost_status: '청구 없음', provider_called: false });
      assert.deepEqual([r.generation.status, r.generation.cost_status, r.generation.provider_called], ['성공', '청구 없음', false]);
      const c = await val(db, `select public.image_costs(null, null, $1)`, [postA]);
      assert.equal(c.totals.billed, (c.totals.count - 1), '시험 생성은 청구 건수에서 빠짐');
    });

    test('자리 주변 글(slot_ctx)을 같이 저장하고, 옮길 때 새 자리의 주변 글로 바꿈', async () => {
      await val(db, `select public.image_slot_upsert($1, $2::jsonb)`, [postB, JSON.stringify({ slot_key: 'k:ctx#1', slot_index: 3, slot_text: 'ctx', slot_ctx: '소제목 | 앞 문장', image_id: null })]);
      assert.equal((await slotRow(db, postB, 'k:ctx#1')).slot_ctx, '소제목 | 앞 문장');
      await val(db, `select public.image_slot_upsert($1, $2::jsonb)`, [postB, JSON.stringify({ slot_key: 'k:ctx#1', slot_index: 3, slot_text: 'ctx' })]);
      assert.equal((await slotRow(db, postB, 'k:ctx#1')).slot_ctx, '소제목 | 앞 문장', '안 보내면 그대로');
      const i = (await save(db, { storage_path: 'up/ctx.jpg' }, { post_id: postB, slot_key: 'k:ctx#1', slot_index: 3, slot_text: 'ctx' })).image;
      const moved = await val(db, `select public.image_slot_rekey($1, $2::jsonb)`, [postB, JSON.stringify({ from: 'k:ctx#1', to: 'k:ctx2#1', index: 4, text: 'ctx2', ctx: '새 소제목' })]);
      assert.deepEqual([moved.slot_key, moved.slot_ctx, moved.image_id], ['k:ctx2#1', '새 소제목', i.id]);
    });

    test('다른 이미지로 바꾸면 자르기·내려받음·사용 완료 표시가 초기화, 빼도 자리 줄은 남음', async () => {
      const k = 'k:첫 사진#1';
      await db.query(`update public.post_image_slots set crop = '{"ratio":"4:3","x":0.2,"y":0.5}', downloaded_at = now(), used_at = now() where post_id = $1 and slot_key = $2`, [postA, k]);
      const same = await slotRow(db, postA, k);
      await val(db, `select public.image_slot_upsert($1, $2::jsonb)`, [postA, JSON.stringify({ slot_key: k, slot_index: 0, slot_text: '첫 사진', image_id: same.image_id })]);
      assert.ok((await slotRow(db, postA, k)).used_at, '같은 이미지면 그대로');
      const up = await save(db, { storage_path: 'up/2.jpg', rights_confirmed: true }, { post_id: postA, slot_key: k, slot_index: 0, slot_text: '첫 사진' });
      const row = await slotRow(db, postA, k);
      assert.equal(row.image_id, up.image.id);
      assert.equal(row.crop, null);
      assert.equal(row.used_at, null);
      assert.equal(row.downloaded_at, null);
      await val(db, `select public.image_slot_upsert($1, $2::jsonb)`, [postA, JSON.stringify({ slot_key: k, slot_index: 0, slot_text: '첫 사진', image_id: null })]);
      assert.equal((await slotRow(db, postA, k)).image_id, null);
      assert.equal(await val(db, `select count(*)::int from public.post_images where id = $1`, [up.image.id]), 1, '빼도 이미지는 보관함에 남음');
    });

    test('잘못된 자리 이름·없는 원고·지운 이미지는 거절', async () => {
      await assert.rejects(val(db, `select public.image_slot_upsert($1, '{"slot_key":"bad"}'::jsonb)`, [postA]), /check/);
      await assert.rejects(val(db, `select public.image_slot_upsert('00000000-0000-4000-8000-000000000000', '{"slot_key":"k:a#1"}'::jsonb)`), /post not found/);
      const x = await save(db, { storage_path: 'up/del.jpg' });
      await db.query(`update public.post_images set deleted_at = now() where id = $1`, [x.image.id]);
      await assert.rejects(val(db, `select public.image_slot_upsert($1, $2::jsonb)`, [postA, JSON.stringify({ slot_key: 'k:a#1', image_id: x.image.id })]), /image not found/);
    });

    test('같은 이미지를 다른 자리·다른 원고에 써도 되고, 두 자리를 맞바꿀 수 있음', async () => {
      const i1 = (await save(db, { storage_path: 'up/s1.jpg' }, { post_id: postA, slot_key: 'k:첫 사진#1', slot_index: 0, slot_text: '첫 사진' })).image;
      const i2 = (await save(db, { storage_path: 'up/s2.jpg' }, { post_id: postA, slot_key: 'k:둘째 사진#1', slot_index: 1, slot_text: '둘째 사진' })).image;
      await val(db, `select public.image_slot_upsert($1, $2::jsonb)`, [postB, JSON.stringify({ slot_key: 'k:다른 글 사진#1', slot_text: '다른 글 사진', image_id: i1.id })]);
      const r = await val(db, `select public.image_slot_swap($1, $2::jsonb, $3::jsonb)`, [postA, JSON.stringify({ slot_key: 'k:첫 사진#1', slot_index: 0, slot_text: '첫 사진' }), JSON.stringify({ slot_key: 'k:둘째 사진#1', slot_index: 1, slot_text: '둘째 사진' })]);
      assert.equal(r.a.image_id, i2.id);
      assert.equal(r.b.image_id, i1.id);
      assert.equal((await slotRow(db, postB, 'k:다른 글 사진#1')).image_id, i1.id, '다른 원고 연결은 그대로');
    });

    test('설명이 바뀐 자리로 연결 옮기기 (새 자리가 비어 있을 때만) + 그 자리용 후보 이미지도 같이', async () => {
      const cand = (await save(db, { storage_path: 'up/cand.jpg', origin_post_id: postA, origin_slot_key: 'k:둘째 사진#1' })).image;
      assert.equal(cand.origin_slot_key, 'k:둘째 사진#1');
      await val(db, `select public.image_slot_upsert($1, '{"slot_key":"k:셋째#1","slot_index":2,"slot_text":"셋째","image_id":null}'::jsonb)`, [postA]);
      const moved = await val(db, `select public.image_slot_rekey($1, $2::jsonb)`, [postA, JSON.stringify({ from: 'k:둘째 사진#1', to: 'k:셋째#1', index: 2, text: '셋째' })]);
      assert.equal(moved.slot_key, 'k:셋째#1');
      assert.ok(moved.image_id);
      assert.equal(await slotRow(db, postA, 'k:둘째 사진#1'), undefined);
      assert.equal(await val(db, `select origin_slot_key from public.post_images where id = $1`, [cand.id]), 'k:셋째#1', '후보도 새 자리로');
      await assert.rejects(val(db, `select public.image_slot_rekey($1, $2::jsonb)`, [postA, JSON.stringify({ from: 'k:첫 사진#1', to: 'k:셋째#1' })]), /slot taken/);
      await assert.rejects(val(db, `select public.image_slot_rekey($1, '{"from":"k:없음#1","to":"k:x#1"}'::jsonb)`, [postA]), /slot not found/);
    });

    test('안전 삭제: 쓰는 곳(휴지통 원고·카드뉴스 포함)이 있으면 거절, 없으면 지우고 파일 경로를 돌려줌', async () => {
      const used = await val(db, `select image_id from public.post_image_slots where post_id = $1 and slot_key = 'k:다른 글 사진#1'`, [postB]);
      await assert.rejects(val(db, `select public.image_delete($1)`, [used]), /image in use/);
      await db.query(`update public.posts set deleted_at = now() where id = $1`, [postB]);
      await assert.rejects(val(db, `select public.image_delete($1)`, [used]), /image in use/, '휴지통에 있는 원고가 쓰는 이미지도 못 지움');
      await db.query(`update public.posts set deleted_at = null where id = $1`, [postB]);
      const free = (await save(db, { storage_path: 'up/free.jpg' })).image;
      await db.query(`insert into public.post_card_decks (post_id, bg_image_id) values ($1, $2)`, [postA, free.id]);
      await assert.rejects(val(db, `select public.image_delete($1)`, [free.id]), /image in use/, '카드뉴스 배경으로 쓰는 중');
      await db.query(`update public.post_card_decks set bg_image_id = null where post_id = $1`, [postA]);
      assert.deepEqual(await val(db, `select public.image_delete($1)`, [free.id]), { storage_path: 'up/free.jpg' });
      assert.ok(await val(db, `select deleted_at from public.post_images where id = $1`, [free.id]));
      await assert.rejects(val(db, `select public.image_delete($1)`, [free.id]), /image not found/);
    });

    test('본문을 고쳐도 연결 유지: 서버와 같은 순서(planSlotSync)로 실제 DB 함수를 불러 옮김 — 같은 설명 두 자리·비켜 두기', async () => {
      // 서버 syncSlots 와 같은 실행: 맞추기 → 계획 → image_slot_rekey·줄 고치기 → 다시 맞추기
      const runSync = async (postId, body) => {
        const rows = await all(db, `select * from public.post_image_slots where post_id = $1`, [postId]);
        const done = new Set();
        for (const o of planSlotSync(matchSlots(parseSlots(body), rows))) {
          if (o.op === 'rekey') {
            if (o.after && !done.has(o.after)) continue;
            try { await val(db, `select public.image_slot_rekey($1, $2::jsonb)`, [postId, JSON.stringify(o.p)]); if (o.key) done.add(o.key); } catch { /* 서버도 실패한 건 건너뜀 */ }
          } else {
            const ks = Object.keys(o.patch);
            await db.query(`update public.post_image_slots set ${ks.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [o.id, ...ks.map((k) => o.patch[k])]);
          }
        }
        return matchSlots(parseSlots(body), await all(db, `select * from public.post_image_slots where post_id = $1`, [postId]));
      };
      const DUP = ['## 거실', '거실 창가에 두었어요.', '[이미지: 히터 사진]', '바람이 잘 퍼져요.', '## 침실', '침대 옆에 두었어요.', '[이미지: 히터 사진]', '조용해요.'].join('\n');
      const setup = async (kw) => {
        const p = await val(db, `insert into public.posts (keyword, titles, body, stage, channel_id) values ($2, '["중복"]', $1, 'review', 'naver_blog') returning id`, [DUP, kw]);
        const img = [];
        for (const [i, s] of parseSlots(DUP).entries()) {
          img.push((await save(db, { storage_path: `up/${kw}${i}.jpg` }, { post_id: p, slot_key: s.key, slot_index: s.index, slot_text: s.text, slot_ctx: ctxOf(s) })).image.id);
        }
        return { p, img };
      };
      // 1) 첫째 자리 설명만 고침 → 두 이미지가 서로 바뀌지 않고(임시 이름을 거쳐 두 번 옮김), 남은 옮길 일 없음
      const A = await setup('dup-a');
      const b1 = DUP.replace('[이미지: 히터 사진]', '[이미지: 히터 사진 두 개]');
      const m1 = await runSync(A.p, b1);
      assert.deepEqual(m1.slots.map((x) => x.link && x.link.image_id), A.img);
      assert.deepEqual([m1.rekeys.length, m1.orphans.length], [0, 0]);
      assert.deepEqual(planSlotSync(m1), [], '한 번 더 맞춰도 바뀌는 게 없음 (안정)');
      // 2) 같은 설명 두 자리 중 첫째를 지움 → 남은 자리는 둘째 이미지, 첫째 이미지는 '사라진 자리' 이름으로 비켜 둠 (지우지 않음)
      const B = await setup('dup-b');
      const m2 = await runSync(B.p, DUP.replace('[이미지: 히터 사진]', ''));
      assert.equal(m2.slots.length, 1);
      assert.equal(m2.slots[0].link.image_id, B.img[1]);
      assert.equal(m2.slots[0].link.slot_key, m2.slots[0].key, '남은 자리 열쇠로 옮겨짐');
      assert.deepEqual(m2.orphans.map((o) => o.image_id), [B.img[0]]);
      assert.match(m2.orphans[0].slot_key, /^k:~~/);
      assert.equal(m2.rekeys.length, 0);
      assert.equal(await val(db, `select count(*)::int from public.post_images where id = any($1::uuid[]) and deleted_at is null`, [[...A.img, ...B.img]]), 4, '이미지는 모두 보관함에 그대로');
    });

    test('검증 N10: 카드뉴스 저장은 DB 함수 하나에서 — 지운 배경 이미지는 거절, 저장된 배경은 지우기를 막음', async () => {
      const bg = (await save(db, { storage_path: 'up/deck-bg.jpg' })).image;
      const d = await val(db, `select public.card_deck_save($1, $2::jsonb)`, [postB, JSON.stringify({ template: 'mark', ratio: '1:1', slides: [{ title: '첫 장' }], ad_label: false, bg_image_id: bg.id })]);
      assert.deepEqual([d.template, d.ratio, d.ad_label, d.bg_image_id, d.slides.length], ['mark', '1:1', false, bg.id, 1]);
      await assert.rejects(val(db, `select public.image_delete($1)`, [bg.id]), /image in use/, '배경으로 쓰는 중');
      const again = await val(db, `select public.card_deck_save($1, $2::jsonb)`, [postB, JSON.stringify({ slides: [{ title: '고침' }], bg_image_id: null })]);
      assert.deepEqual([again.template, again.ratio, again.ad_label, again.bg_image_id], ['clean', '4:5', true, null], '안 보낸 값은 기본값, 원고마다 한 줄');
      assert.equal(await val(db, `select count(*)::int from public.post_card_decks where post_id = $1`, [postB]), 1);
      await val(db, `select public.image_delete($1)`, [bg.id]);
      await assert.rejects(val(db, `select public.card_deck_save($1, $2::jsonb)`, [postB, JSON.stringify({ slides: [], bg_image_id: bg.id })]), /image not found/, '지운 이미지는 배경으로 못 씀');
      await assert.rejects(val(db, `select public.card_deck_save('00000000-0000-4000-8000-000000000000', '{}'::jsonb)`), /post not found/);
    });

    test('검증 N5: AI로 만들 때 고른 비율을 이미지에 저장 (모르는 값은 빈 값)', async () => {
      const a = (await save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/r1.jpg', ratio: '16:9' })).image;
      const b = (await save(db, { kind: 'ai', provider: 'openai', storage_path: 'ai/r2.jpg', ratio: '3:2' })).image;
      const c = (await save(db, { storage_path: 'up/r3.jpg' })).image;
      assert.deepEqual([a.ratio, b.ratio, c.ratio], ['16:9', '', '']);
      await assert.rejects(db.query(`update public.post_images set ratio = '2:1' where id = $1`, [a.id]), /ratio_check/);
    });

    test('원고를 아예 지워도(드문 경우) 이미지는 보관함에 남고 연결만 사라짐', async () => {
      const p = await val(db, `insert into public.posts (keyword, titles, body, stage, channel_id) values ('c', '["다"]', 'x', 'review', 'naver_blog') returning id`);
      const r = await save(db, { storage_path: 'up/keep.jpg', origin_post_id: p }, { post_id: p, slot_key: 'k:a#1' });
      await db.query(`delete from public.posts where id = $1`, [p]);
      const img = await one(db, `select origin_post_id, deleted_at from public.post_images where id = $1`, [r.image.id]);
      assert.deepEqual(img, { origin_post_id: null, deleted_at: null });
      assert.equal(await val(db, `select count(*)::int from public.post_image_slots where post_id = $1`, [p]), 0);
    });
  });

  describe('이미지 비용 통계 (수익 통계와 따로)', () => {
    test('청구 없음은 0, 실제 > 사용량 > 예상, 환율 없으면 원화 비움, 글별 횟수', async () => {
      await db.query(`delete from public.image_generations`);
      await db.query(`update public.settings set image_fx_krw = null where id = 1`);
      const ins = (k, post, o) => db.query(`insert into public.image_generations (request_key, post_id, model, status, est_usd, usage_usd, actual_usd, cost_status, fx_krw, created_at)
        values ($1, $2, 'm', $3, $4, $5, $6, $7, $8, $9)`, [KEY(k), post, o.status || '성공', o.est ?? 0.01, o.usage ?? null, o.actual ?? null, o.cs || '예상', o.fx ?? null, o.at || '2026-10-10T03:00:00Z']);
      await ins(30, postA, { est: 0.01 });
      await ins(31, postA, { est: 0.01, usage: 0.02, cs: '사용량 기준' });
      await ins(32, postA, { est: 0.01, usage: 0.02, actual: 0.05, cs: '청구액 확인' });
      await ins(33, postB, { status: '실패', est: 0.5, cs: '청구 없음' });
      await ins(34, postB, { status: '실패', est: 0.02, cs: '확인 필요' });
      await ins(35, postA, { est: 9, at: '2026-11-02T03:00:00Z' });
      const c = await val(db, `select public.image_costs('2026-10-01', '2026-10-31')`);
      assert.equal(c.totals.count, 5);
      assert.equal(c.totals.billed, 4);
      assert.equal(Number(c.totals.usd), 0.1, '0.01 + 0.02 + 0.05 + 0 + 0.02');
      assert.equal(c.totals.uncertain, 1);
      assert.equal(c.totals.krw, null, '환율이 없으면 원화 합계를 만들지 않음');
      const by = Object.fromEntries(c.by_post.map((x) => [x.key, x]));
      assert.equal(by[postA].billed, 3, '이 원고에 비용이 3번 반영');
      assert.equal(Number(by[postA].usd), 0.08);
      assert.equal(Number(by[postB].usd), 0.02);
      await db.query(`update public.settings set image_fx_krw = 1400 where id = 1`);
      const c2 = await val(db, `select public.image_costs('2026-10-01', '2026-10-31')`);
      assert.equal(Number(c2.totals.krw), 140, '지금 설정 환율로');
      await db.query(`update public.image_generations set fx_krw = 1300 where request_key = $1`, [KEY(32)]);
      const c3 = await val(db, `select public.image_costs('2026-10-01', '2026-10-31')`);
      assert.equal(Number(c3.totals.krw), 0.05 * 1300 + 0.05 * 1400, '그 기록에 저장한 환율이 우선');
      // 실적 통계(stats)에는 이미지 비용이 들어가지 않음 (두 번 더해지지 않게)
      const s = await val(db, `select public.stats('2026-10-01', '2026-10-31')`);
      assert.equal(s.totals.cost ? s.totals.cost.n : 0, 0);
      // 원고 하나만
      const one_ = await val(db, `select public.image_costs(null, null, $1)`, [postB]);
      assert.equal(one_.totals.count, 2);
      assert.equal(one_.totals.billed, 1);
      assert.equal(one_.by_post.length, 1);
    });

    test('지금 사용량: 오늘 횟수·이번 달 비용(예산과 같은 셈)·만드는 중·저장 공간', async () => {
      await db.query(`delete from public.image_generations`);
      await db.query(`update public.settings set image_daily_limit = 7, image_monthly_budget_usd = 3 where id = 1`);
      const u0 = await val(db, `select public.image_usage()`);
      assert.equal(u0.today, 0);
      assert.equal(u0.daily_limit, 7);
      assert.equal(Number(u0.budget_usd), 3);
      assert.equal(u0.running, null);
      const g = await begin(db, { request_key: KEY(40), est_usd: 0.02 });
      const u1 = await val(db, `select public.image_usage()`);
      assert.equal(u1.today, 1);
      assert.equal(Number(u1.month_usd), 0.02, '만드는 중인 것도 예상 비용으로 셈');
      assert.equal(u1.running.id, g.id);
      await val(db, `select public.image_gen_fail($1, '{"error_code":"openai_quota","cost_status":"청구 없음","provider_called":false,"request_id":"req_abc"}'::jsonb)`, [g.id]);
      const u2 = await val(db, `select public.image_usage()`);
      assert.equal(u2.today, 0, '만들기 전에 거절된 요청은 하루 한도에 안 셈');
      assert.equal(Number(u2.month_usd), 0);
      assert.equal(u2.running, null);
      assert.equal(await val(db, `select provider_request_id from public.image_generations where id = $1`, [g.id]), 'req_abc');
      const bytes = await val(db, `select coalesce(sum(bytes), 0)::int from public.post_images where deleted_at is null`);
      assert.equal(Number(u2.storage_bytes), bytes);
      await db.query(`insert into public.api_calls (provider, kind, status) values ('pexels', 'search', 200), ('pexels', 'photo', 200)`);
      const u3 = await val(db, `select public.image_usage()`);
      assert.equal(u3.pexels_hour, 2);
      assert.equal(u3.pexels_month, 2);
      assert.equal(await val(db, `select has_function_privilege('anon', 'public.image_usage()', 'execute')`), false);
    });
  });
});

describe('012를 다시 돌리거나 예전 초안 위에 돌려도 같은 결과 (검증 N9)', () => {
  const SQL012 = readFileSync(join(MIGRATIONS_DIR, '012_image_studio.sql'), 'utf8');
  const DRAFT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', '012_draft_77c6d5f.sql'), 'utf8');
  const shape = (db) => all(db, `select table_name, column_name, data_type, column_default, is_nullable from information_schema.columns
    where table_schema = 'public' and table_name in ('post_images','post_image_slots','image_generations','post_card_decks','api_calls','settings') order by 1, 2`);
  const checks = (db) => all(db, `select conname from pg_constraint where conrelid in ('public.post_images'::regclass, 'public.image_generations'::regclass) and contype = 'c' order by 1`);
  test('같은 DB에 두 번 돌려도 오류 없이, 열·검사가 그대로 (겹치지 않음)', async () => {
    const db = await freshDb();
    const [s1, c1] = [await shape(db), await checks(db)];
    await db.exec(SQL012);
    assert.deepEqual(await shape(db), s1);
    assert.deepEqual(await checks(db), c1);
    assert.ok(c1.some((x) => x.conname === 'post_images_ratio_check') && c1.some((x) => x.conname === 'image_generations_auto_cost_status_check'));
  });
  test('예전 초안(77c6d5f)을 먼저 돌린 DB에 지금 012를 돌리면: 빠졌던 열·검사가 생기고 함수가 동작', async () => {
    const fresh = await freshDb({ upTo: '012' }); // 같은 단계(012까지)끼리 비교 — 뒤 마이그레이션(014 주력 주제 열 등)은 따로 검사
    const db = await freshDb({ upTo: '011' });
    await db.exec(DRAFT);
    // 초안 시절의 생성 기록: 서버가 매긴 '사용량 기준' / 사용자가 넣은 '청구 없음'(확인일 있음)
    await db.query(`insert into public.image_generations (request_key, model, status, est_usd, cost_status) values ('req-old-usage-01', 'm', '성공', 0.01, '사용량 기준')`);
    await db.query(`insert into public.image_generations (request_key, model, status, est_usd, cost_status, actual_checked_at) values ('req-old-user-001', 'm', '성공', 0.01, '청구 없음', '2026-10-20')`);
    const missing = await all(db, `select column_name from information_schema.columns where table_schema = 'public' and column_name in ('slot_ctx','risk_override','auto_cost_status','ratio') and table_name like '%image%'`);
    assert.deepEqual(missing, [], '초안에는 새 열이 없음');
    await db.exec(SQL012);
    assert.deepEqual(await shape(db), await shape(fresh), '새로 만든 DB와 열이 같음');
    assert.deepEqual(await checks(db), await checks(fresh), '값 검사도 같음');
    const post = await val(db, `insert into public.posts (keyword, titles, body, stage, channel_id) values ('k', '["t"]', 'x', 'review', 'naver_blog') returning id`);
    const sl = await val(db, `select public.image_slot_upsert($1, $2::jsonb)`, [post, JSON.stringify({ slot_key: 'k:a#1', slot_index: 0, slot_text: 'a', slot_ctx: '소제목 | 앞', image_id: null })]);
    assert.equal(sl.slot_ctx, '소제목 | 앞');
    const g = await val(db, `select public.image_gen_begin($1::jsonb)`, [JSON.stringify({ request_key: 'req-key-draft-0001', model: 'gpt-image-2.5-flare', est_usd: 0.01, risk_override: '일반 장면으로 만들기 확인: 박스' })]);
    assert.deepEqual([g.risk_override, g.auto_cost_status], ['일반 장면으로 만들기 확인: 박스', '예상']);
    await assert.rejects(db.query(`update public.image_generations set auto_cost_status = '모름' where id = $1`, [g.id]), /auto_cost_status_check/);
    const old = await all(db, `select request_key, auto_cost_status from public.image_generations where request_key like 'req-old-%' order by 1`);
    assert.deepEqual(old.map((x) => [x.request_key, x.auto_cost_status]), [['req-old-usage-01', '사용량 기준'], ['req-old-user-001', '예상']], '서버가 매긴 상태만 처음 상태로 (사용자가 넣은 건 그대로)');
    const d = await val(db, `select public.card_deck_save($1, '{"slides":[{"title":"a"}]}'::jsonb)`, [post]);
    assert.equal(d.template, 'clean');
    // 예전 초안의 공급자 검사에는 cloudflare(무료 이미지)가 없었음 → 다시 걸려서 무료 이미지도 저장됨
    await db.query(`update public.image_generations set status = '실패' where status = '생성 중'`);
    const g2 = await val(db, `select public.image_gen_begin($1::jsonb)`, [JSON.stringify({ request_key: 'req-key-draft-cf01', model: 'cf-flux-1-schnell', provider: 'cloudflare', est_usd: 0 })]);
    assert.equal(g2.provider, 'cloudflare');
    const sv = await val(db, `select public.image_save($1::jsonb, null, $2::uuid, '{"usage_usd":0,"cost_status":"청구 없음"}'::jsonb)`,
      [JSON.stringify({ kind: 'ai', provider: 'cloudflare', model: 'cf-flux-1-schnell', storage_path: 'ai/x.jpg', mime: 'image/jpeg' }), g2.id]);
    assert.equal(sv.image.provider, 'cloudflare');
    assert.equal(sv.generation.cost_status, '청구 없음');
    await assert.rejects(db.query(`insert into public.post_images (kind, provider) values ('ai', 'midjourney')`), /provider_check/);
  });
});
