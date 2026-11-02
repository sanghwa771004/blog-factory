// 020 하루 계획 운영 (1.6.0): 계획 종류·보관·자동 원고 3일 정리·하루 편수 상한 — 진짜 Postgres(PGlite)에서 확인. 실행: npm test
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, one, all, val, kstToday, addDays, longBody, MIGRATIONS_DIR } from './helpers/db.js';

const M020 = readFileSync(join(MIGRATIONS_DIR, '020_daily_plan_1_6_0.sql'), 'utf8');
const addPost = (db, p, offset = 1) => one(db, `select post_id, publish_date::text as publish_date from public.add_post($1::jsonb, $2)`, [JSON.stringify({ body: longBody(), ...p }), offset]);
const errOf = async (p) => { try { await p; return 'ok'; } catch (e) { return String(e.message); } };
// 한국 날짜 d 의 hh:mm:ss (KST) 에 만든 원고
const at = (d, time = '12:00:00') => `${d}T${time}+09:00`;
const draftAt = (db, keyword, created, extra = {}) => val(db,
  `insert into public.posts (keyword, body, titles, stage, channel_id, source, keep, created_at) values ($1, $2, $3::jsonb, $4, 'naver_blog', $5, $6, $7::timestamptz) returning id`,
  [keyword, longBody(), JSON.stringify([keyword]), extra.stage ?? 'review', extra.source ?? 'auto', extra.keep ?? false, created]);

describe('020 적용: 열·기본값·검사 (예전 원고는 그대로)', () => {
  test('019 DB에 020을 두 번 올려도 같고, 예전 원고는 계획 종류 없음·보관 안 함, 설정은 하루 10편·3일', async () => {
    const db = await freshDb({ upTo: '019' });
    const old = await val(db, `insert into public.posts (keyword, body, titles, stage, channel_id, source) values ('예전 원고', $1, '["예전"]', 'review', 'naver_blog', 'auto') returning id`, [longBody()]);
    await db.exec(M020);
    await db.exec(M020);
    assert.deepEqual(await one(db, `select plan_kind, keep, deleted_at from public.posts where id = $1`, [old]), { plan_kind: '', keep: false, deleted_at: null }, '마이그레이션은 원고를 지우지 않음');
    assert.deepEqual(await one(db, `select daily_plan, keep_days from public.settings where id = 1`),
      { daily_plan: { affiliate: 2, adpost: 2, trending: 2, market: 2, stock: 2 }, keep_days: 3 });
    assert.equal(await val(db, `select public.plan_total()`), 10);
    assert.match(await errOf(db.query(`update public.posts set plan_kind = 'crypto' where id = $1`, [old])), /posts_plan_kind_check/);
    assert.match(await errOf(db.query(`update public.settings set keep_days = 0 where id = 1`)), /settings_keep_days_range/);
    assert.match(await errOf(db.query(`update public.settings set keep_days = 15 where id = 1`)), /settings_keep_days_range/);
    assert.match(await errOf(db.query(`update public.settings set daily_plan = '[1,2]' where id = 1`)), /settings_daily_plan_shape/);
  });

  test('잠금: 앱 열쇠(anon·authenticated)는 새 함수를 못 부르고, 서버는 정리·계획 함수를 부를 수 있음', async () => {
    const db = await freshDb();
    for (const fn of ['public.plan_total()', 'public.plan_today()', 'public.expire_auto_posts()', 'public.add_post(jsonb, int)', 'public.writer_context()', 'public.backlog_state()']) {
      for (const role of ['anon', 'authenticated']) assert.equal(await val(db, `select has_function_privilege($1, $2, 'execute')`, [role, fn]), false, `${role} ${fn}`);
    }
    for (const fn of ['public.plan_today()', 'public.expire_auto_posts()', 'public.backlog_state()']) {
      assert.equal(await val(db, `select has_function_privilege('service_role', $1, 'execute')`, [fn]), true, `서버는 ${fn}`);
    }
  });
});

describe('하루 계획 (add_post · plan_today · backlog_state)', () => {
  let db;
  before(async () => { db = await freshDb(); });

  test('계획 글은 오늘 날짜로 저장되고 종류별 하루 편수를 넘기면 거절 (휴지통으로 보낸 오늘 글도 셈)', async () => {
    const t = kstToday();
    const a1 = await addPost(db, { keyword: '쿠팡 글 1', source: 'auto', plan_kind: 'affiliate', program_ids: ['coupang_partners', 'toss_sharelink'] });
    assert.equal(a1.publish_date, t, '계획 글은 오늘 날짜 (사용자가 그날 직접 발행)');
    assert.equal(await val(db, `select plan_kind from public.posts where id = $1`, [a1.post_id]), 'affiliate');
    // 사용자가 올리고 지운 글도 오늘 쓴 글로 셈 → 같은 날 다시 채우지 않음
    await db.query(`update public.posts set deleted_at = now() where id = $1`, [a1.post_id]);
    await addPost(db, { keyword: '쿠팡 글 2', source: 'auto', plan_kind: 'affiliate' });
    assert.match(await errOf(addPost(db, { keyword: '쿠팡 글 3', source: 'auto', plan_kind: 'affiliate' })), /plan full: affiliate \(2 \/ 2\)/);
    const pt = await val(db, `select public.plan_today()`);
    assert.equal(pt.date, t);
    assert.deepEqual(pt.done, { affiliate: 2 });
    assert.equal(pt.plan.affiliate, 2);
    assert.equal(pt.keep_days, 3);
  });

  test('계획에서 0편인 종류·모르는 종류·자동 글이 아닌데 종류를 붙인 글은 거절', async () => {
    await db.query(`update public.settings set daily_plan = daily_plan || '{"trending": 0}'::jsonb where id = 1`);
    assert.match(await errOf(addPost(db, { keyword: '이슈', source: 'auto', plan_kind: 'trending' })), /plan full: trending \(0 \/ 0\)/);
    assert.match(await errOf(addPost(db, { keyword: '코인', source: 'auto', plan_kind: 'crypto' })), /bad plan_kind/);
    assert.match(await errOf(addPost(db, { keyword: '요청 글', source: 'request', plan_kind: 'stock' })), /plan_kind is only for auto posts/);
    await db.query(`update public.settings set daily_plan = daily_plan || '{"trending": 2}'::jsonb where id = 1`);
  });

  test('쌓인 원고 한도 = 계획 합계 × 보관일 (10 × 3 = 30), 계획을 비우면 예전 방식 (한도 칸 → 하루 발행 수 × 7)', async () => {
    assert.equal((await val(db, `select public.backlog_state()`)).limit, 30);
    await db.query(`update public.settings set keep_days = 2 where id = 1`);
    assert.equal((await val(db, `select public.backlog_state()`)).limit, 20);
    await db.query(`update public.settings set daily_plan = '{}'::jsonb, backlog_limit = 0, per_day = 2 where id = 1`);
    assert.equal(await val(db, `select public.plan_total()`), 0);
    assert.equal((await val(db, `select public.backlog_state()`)).limit, 14, '계획이 없으면 예전처럼 하루 발행 수 × 7');
    await db.query(`update public.settings set backlog_limit = 5 where id = 1`);
    assert.equal((await val(db, `select public.backlog_state()`)).limit, 5);
    // 이상한 값은 세지 않음 (모르는 종류·숫자 아닌 값), 한 종류는 4편까지만 셈
    await db.query(`update public.settings set daily_plan = '{"affiliate": 9, "crypto": 3, "adpost": "많이"}'::jsonb, keep_days = 3 where id = 1`);
    assert.equal(await val(db, `select public.plan_total()`), 4);
    await db.query(`update public.settings set daily_plan = '{"affiliate": 2, "adpost": 2, "trending": 2, "market": 2, "stock": 2}'::jsonb, backlog_limit = 0, per_day = 1 where id = 1`);
  });

  test('계획 종류 없는 자동 글은 예전처럼 쌓인 원고 한도로 막고 발행표의 빈 날로 (예전 자동 작가 프롬프트와 호환)', async () => {
    const d = await freshDb();
    await d.query(`update public.settings set daily_plan = '{}'::jsonb, backlog_limit = 1 where id = 1`);
    const r = await addPost(d, { keyword: '예전 자동 글', source: 'auto' });
    assert.equal(r.publish_date, addDays(kstToday(), 1), '예전처럼 내일부터 빈 날');
    assert.match(await errOf(addPost(d, { keyword: '예전 자동 글 2', source: 'auto' })), /backlog full/);
    const q = await addPost(d, { keyword: '앱 요청 글', source: 'request' }, 0);
    assert.ok(q.post_id, '요청 글은 한도와 상관없이 저장');
  });

  test('writer_context 에 오늘 계획과 설정(daily_plan·keep_days)이 들어감', async () => {
    const ctx = await val(db, `select public.writer_context()`);
    assert.deepEqual(ctx.settings.daily_plan, { affiliate: 2, adpost: 2, trending: 2, market: 2, stock: 2 });
    assert.equal(ctx.settings.keep_days, 3);
    assert.equal(ctx.plan_today.date, kstToday());
    assert.equal(ctx.plan_today.done.affiliate, 2);
    assert.equal(ctx.backlog.limit, 30);
  });
});

describe('자동 원고 정리 (expire_auto_posts)', () => {
  test('만든 날부터 3일 지난 자동 원고만 휴지통으로 — 보관·요청 글은 그대로, 지우지 않음, 다시 불러도 같음', async () => {
    const db = await freshDb();
    const t = kstToday();
    const keepFrom = addDays(t, -2); // 오늘·어제·그제 것만 남음
    const ids = {
      today: await draftAt(db, '오늘', at(t, '00:00:01')),
      twoDays: await draftAt(db, '그제 첫 초', at(keepFrom, '00:00:00')),
      threeDaysLast: await draftAt(db, '사흘 전 마지막 초', at(addDays(t, -3), '23:59:59')),
      old: await draftAt(db, '열흘 전', at(addDays(t, -10)), { stage: 'published' }),
      kept: await draftAt(db, '보관한 글', at(addDays(t, -5)), { keep: true }),
      request: await draftAt(db, '요청 글', at(addDays(t, -5)), { source: 'request' }),
      artifact: await draftAt(db, 'Claude 안 글공장 글', at(addDays(t, -5)), { source: 'artifact' }),
    };
    // 정리될 원고에 걸린, 아직 시작 안 한 개선안 작업은 취소
    const job = await val(db, `insert into public.requests (keyword, kind, post_id, payload) values ('개선안', 'refresh', $1, '{}') returning id`, [ids.old]);
    const r = await val(db, `select public.expire_auto_posts()`);
    assert.equal(r.expired, 2);
    assert.equal(r.keep_days, 3);
    assert.equal(r.kept_from, keepFrom);
    const live = (await all(db, `select keyword from public.posts where deleted_at is null order by keyword`)).map((x) => x.keyword);
    assert.deepEqual(live.sort(), ['Claude 안 글공장 글', '그제 첫 초', '보관한 글', '오늘', '요청 글'].sort());
    const trashed = await all(db, `select keyword, deleted_at is not null as trashed from public.posts where id in ($1, $2)`, [ids.threeDaysLast, ids.old]);
    assert.ok(trashed.every((x) => x.trashed), '지우지 않고 휴지통으로 (행은 그대로)');
    assert.deepEqual(await one(db, `select status, note from public.requests where id = $1`, [job]), { status: 'cancelled', note: '원고가 자동 정리(휴지통)돼서 취소' });
    assert.equal((await val(db, `select public.expire_auto_posts()`)).expired, 0, '다시 불러도 더 지우지 않음');
    // 보관일을 바꾸면 그 기준으로
    await db.query(`update public.settings set keep_days = 1 where id = 1`);
    assert.equal((await val(db, `select public.expire_auto_posts()`)).expired, 1, '그제 것도 정리 (오늘 것만 남음)');
    assert.equal(await val(db, `select deleted_at is null from public.posts where id = $1`, [ids.today]), true);
  });
});
