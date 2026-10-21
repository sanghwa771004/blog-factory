// 이미지 스튜디오 DB(012) 테스트 — PGlite(진짜 Postgres 17)에 001~012를 적용해서 확인. 실행: npm test
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, all, val, longBody } from './helpers/db.js';

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
    assert.equal(s.image_gen_model, 'gpt-image-2.5-flare');
    assert.equal(s.image_edit_model, 'gpt-image-2.5-sunburst');
    assert.equal(s.image_quality, 'medium');
    assert.equal(s.image_daily_limit, 5);
    assert.equal(s.budget, 2);
    assert.equal(s.image_fx_krw, null, '환율은 비워둠 (확인한 기준을 사용자가 넣음)');
    assert.equal(s.image_prices.image_output_per_m, 30);
    assert.equal(s.image_prices.checked_at, '2026-10-22');
  });

  test('설정 범위 검사: 품질·한도·예산·환율·모델 이름', async () => {
    for (const bad of [`image_quality = 'ultra'`, `image_daily_limit = 51`, `image_monthly_budget_usd = -1`, `image_fx_krw = 5`, `image_gen_model = 'Bad Model!'`]) {
      await assert.rejects(db.query(`update public.settings set ${bad} where id = 1`), /check/, bad);
    }
  });

  test('anon·authenticated 는 새 표·함수를 못 씀', async () => {
    const g = await all(db, `select table_name, privilege_type from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name in ('post_images','post_image_slots','image_generations','post_card_decks','api_calls')`);
    assert.deepEqual(g, []);
    assert.equal(await val(db, `select has_function_privilege('anon', 'public.image_gen_begin(jsonb)', 'execute')`), false);
    assert.equal(await val(db, `select has_function_privilege('service_role', 'public.image_gen_begin(jsonb)', 'execute')`), true);
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
