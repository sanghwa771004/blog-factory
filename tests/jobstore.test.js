// 1.5.2 작업 이어 하기 (jobstore.js): 저장 모양 정리 · 보존 기간 · 이어 하기 고르기 · 저장 공간 부족 · 저장소 없음
// 이 시험은 메모리 저장소로 규칙만 확인해 (실제 IndexedDB 저장·새로고침 뒤 복구는 화면 시험 tests/ui 에서 Chromium 으로 확인)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cleanJob, expiredJob, pickResumable, createJobStore, memoryBackend, stepLabel, KEEP_DAYS, DONE_KEEP_DAYS, MAX_JOBS } from '../jobstore.js';

const U = (n) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36).replace(/^.{8}/, String(n).padStart(8, '0'));
const DAY = 86400000;
const job = (o = {}) => ({ id: U(1), product_id: U(2), post_id: '', spec: { mode: 'layer', template: 'table', light: 'left' }, ...o });

describe('저장 모양 (cleanJob): 이미지 번호와 설정만 남기고 나머지는 버림', () => {
  test('서명 주소·세션·모르는 칸은 저장하지 않음, 번호 모양이 아니면 버림', () => {
    const j = cleanJob(job({
      url: 'https://x.supabase.co/storage/v1/object/sign/post-images/a.png?token=SECRET', session: 'gf-session-token', api_key: 'sk-proj-xxx',
      extra_ids: [U(3), 'not-an-id', U(4), U(5), U(6)], cands: [{ image_id: U(7), mode: 'layer', url: 'https://signed', gen_id: U(8) }, { image_id: 'bad' }],
      pick_id: U(7), result_id: 'bad', slot_key: 'k:침대 위 전기요#1', ratio: '4:3', count: 9, pending_keys: ['ok_key_123456', 'bad key', '../x'],
      mask: { saved_id: U(9), dirty: false, method: 'auto_u2netp', edited: true, w: 800, h: 600, url: 'https://signed' },
    }), 1000);
    const s = JSON.stringify(j);
    for (const bad of ['token', 'SECRET', 'gf-session', 'sk-proj', 'https://']) assert.ok(!s.includes(bad), bad);
    assert.deepEqual(j.extra_ids, [U(3), U(4), U(5)], '추가 사진은 3장까지, 번호 모양만');
    assert.deepEqual(j.cands, [{ image_id: U(7), mode: 'layer', gen_id: U(8) }]);
    assert.deepEqual([j.pick_id, j.result_id, j.count, j.ratio, j.slot_key], [U(7), '', 3, '4:3', 'k:침대 위 전기요#1']);
    assert.deepEqual(j.pending_keys, ['ok_key_123456']);
    assert.deepEqual(j.mask, { saved_id: U(9), dirty: false, method: 'auto_u2netp', model: '', edited: true, w: 800, h: 600 });
    assert.equal(j.spec.light, 'left', '빛 방향 설정도 같이');
  });
  test('작업 번호·상품 사진 번호가 없으면 저장하지 않음', () => {
    assert.equal(cleanJob({ id: 'x', product_id: U(2) }), null);
    assert.equal(cleanJob({ id: U(1) }), null);
  });
  test('고른 후보가 후보 목록에 없으면 비움, 마스크를 고쳤다면서 PNG 가 없으면 고친 것으로 보지 않음', () => {
    const j = cleanJob(job({ cands: [{ image_id: U(3) }], pick_id: U(4), mask: { dirty: true } }));
    assert.equal(j.pick_id, '');
    assert.equal(j.mask.dirty, false);
    assert.equal(j.mask_png, null);
  });
});

describe('보존 기간 · 이어 하기 고르기', () => {
  test(`끝내지 않은 작업은 ${KEEP_DAYS}일, 끝낸 작업은 ${DONE_KEEP_DAYS}일`, () => {
    const now = 100 * DAY;
    assert.equal(expiredJob({ updated_at: now - (KEEP_DAYS - 1) * DAY }, now), false);
    assert.equal(expiredJob({ updated_at: now - (KEEP_DAYS + 1) * DAY }, now), true);
    assert.equal(expiredJob({ updated_at: now - (DONE_KEEP_DAYS + 1) * DAY, done: true }, now), true);
  });
  test('그 원고(또는 원고 없이)에서 끝내지 않은 가장 최근 작업만', () => {
    const now = 50 * DAY;
    const list = [
      { id: 'a', post_id: '', updated_at: now - 3 * DAY, done: false },
      { id: 'b', post_id: '', updated_at: now - 1 * DAY, done: true },
      { id: 'c', post_id: 'P', updated_at: now - 1 * DAY, done: false },
      { id: 'd', post_id: '', updated_at: now - 2 * DAY, done: false },
    ];
    assert.equal(pickResumable(list, { postId: '' }, now).id, 'd');
    assert.equal(pickResumable(list, { postId: 'P' }, now).id, 'c');
    assert.equal(pickResumable(list, { postId: 'Q' }, now), null);
  });
  test('어디까지 했는지 한 줄', () => {
    assert.equal(stepLabel(1), '상품 사진 고름');
    assert.equal(stepLabel(9), '후보 고르는 중');
    assert.equal(stepLabel(11), '결과 저장함');
  });
});

describe('저장소 (메모리 저장소로 규칙 확인)', () => {
  test('저장 → 다시 읽기 → 이어 하기 → 지우기', async () => {
    let t = 10 * DAY;
    const S = createJobStore({ backend: memoryBackend(), now: () => t });
    assert.equal((await S.save(job({ name: '포근 전기요', step: 9 }))).ok, true);
    const g = await S.get(U(1));
    assert.equal(g.value.name, '포근 전기요');
    assert.equal((await S.latest({ postId: '' })).value.id, U(1));
    await S.remove(U(1));
    assert.equal((await S.get(U(1))).value, null);
  });
  test(`많아야 ${MAX_JOBS}개 — 오래된 것부터 지움, 보존 기간이 지난 것도 지움`, async () => {
    let t = 1000 * DAY;
    const be = memoryBackend();
    const S = createJobStore({ backend: be, now: () => t });
    for (let i = 0; i < MAX_JOBS + 3; i++) { t += 1000; await S.save(job({ id: U(100 + i) })); }
    await S.sweep();
    const all = await be.all();
    assert.equal(all.length, MAX_JOBS);
    assert.ok(!all.some((j) => j.id === U(100)), '가장 오래된 것부터');
    t += (KEEP_DAYS + 1) * DAY;
    await S.sweep();
    assert.equal((await be.all()).length, 0);
  });
  test('저장 공간이 모자라면 code: quota, 저장소가 없으면 code: unavailable (작업은 멈추지 않음)', async () => {
    const full = { ...memoryBackend(), put: async () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } };
    const r = await createJobStore({ backend: full }).save(job());
    assert.deepEqual(r, { ok: false, code: 'quota' });
    const none = createJobStore({ backend: null });
    assert.equal(none.available(), false);
    assert.deepEqual(await none.save(job()), { ok: false, code: 'unavailable' });
    assert.deepEqual(await none.latest({}), { ok: false, code: 'unavailable' });
  });
});
