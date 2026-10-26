// 016 운영 시스템 (1.4.0): 다른 채널 기록·유입 검색어·쌓인 원고 한도·날짜 다시 잡기·개선안 — 진짜 Postgres(PGlite)에서 확인
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, one, all, val, kstToday, addDays, longBody, MIGRATIONS_DIR } from './helpers/db.js';

const M016 = readFileSync(join(MIGRATIONS_DIR, '016_operations_1_4_0.sql'), 'utf8');
const draft = async (db, keyword, extra = {}) => val(db,
  `insert into public.posts (keyword, body, titles, stage, publish_date, channel_id, source) values ($1, $2, $3::jsonb, $4, $5, $6, $7) returning id`,
  [keyword, extra.body ?? longBody(), JSON.stringify(extra.titles ?? [keyword]), extra.stage ?? 'review', extra.date ?? null, extra.channel ?? 'naver_blog', extra.source ?? 'auto']);

describe('016 적용: 더하기만 하고 예전 데이터는 그대로', () => {
  test('015 DB에 016을 올리면 원고·설정은 그대로, 새 칸은 기본값, 두 번 돌려도 같은 결과', async () => {
    const db = await freshDb({ upTo: '015' });
    await db.query(`update public.settings set per_day = 2, focus_topic = '겨울 가전', focus_terms = '전기요' where id = 1`);
    const id = await draft(db, '예전 원고', { date: kstToday() });
    await db.query(`insert into public.requests (keyword, kind, payload) values ('예전 주제 요청', 'topics', '{"mode":"category","category":"겨울 가전"}')`);
    await db.exec(M016);
    await db.exec(M016);
    assert.deepEqual(await one(db, `select per_day, focus_topic, focus_terms, backlog_limit from public.settings where id = 1`),
      { per_day: 2, focus_topic: '겨울 가전', focus_terms: '전기요', backlog_limit: 0 });
    assert.deepEqual(await one(db, `select keyword, stage, refresh from public.posts where id = $1`, [id]), { keyword: '예전 원고', stage: 'review', refresh: {} });
    assert.equal(await val(db, `select count(*)::int from public.requests where kind = 'topics'`), 1, '예전 작업도 그대로');
    for (const c of ['post_channels_post_channel_key', 'post_channels_checks', 'search_terms_post_term_period_key', 'search_terms_checks', 'settings_backlog_limit_range', 'requests_kind_check']) {
      assert.equal(await val(db, `select count(*)::int from pg_constraint where conname = $1`, [c]), 1, c);
    }
    assert.match(await val(db, `select pg_get_constraintdef(oid) from pg_constraint where conname = 'requests_kind_check'`), /refresh/);
  });

  test('새 표는 RLS로 잠겨 있고 화면 쪽 역할(anon·authenticated)은 못 읽고, 함수도 못 부름', async () => {
    const db = await freshDb();
    for (const t of ['post_channels', 'search_terms']) {
      assert.equal(await val(db, `select relrowsecurity from pg_class where oid = $1::regclass`, [`public.${t}`]), true, t);
      for (const role of ['anon', 'authenticated']) {
        assert.equal(await val(db, `select has_table_privilege($1, $2, 'select')`, [role, `public.${t}`]), false, `${role} ${t}`);
      }
    }
    for (const fn of ['public.backlog_state()', 'public.reschedule_overdue()', 'public.set_refresh(uuid, uuid, jsonb)', 'public.add_post(jsonb, int)', 'public.writer_context()']) {
      for (const role of ['anon', 'authenticated']) assert.equal(await val(db, `select has_function_privilege($1, $2, 'execute')`, [role, fn]), false, `${role} ${fn}`);
    }
    assert.equal(await val(db, `select has_function_privilege('service_role', 'public.reschedule_overdue()', 'execute')`), true, '서버는 날짜 다시 잡기를 부를 수 있음');
  });
});

describe('쌓인 원고 한도 (backlog_state · add_post)', () => {
  let db;
  before(async () => { db = await freshDb(); });

  test('검수 필요·정보 필요·발행 준비·예약만 셈 (게시·실패·대기·휴지통은 안 셈), 한도 0이면 하루 발행 수 × 7', async () => {
    const t = kstToday();
    await draft(db, 'a', { stage: 'review', date: addDays(t, -2) });
    await draft(db, 'b', { stage: 'verify' });
    await draft(db, 'c', { stage: 'ready', date: addDays(t, 1) });
    await draft(db, 'd', { stage: 'scheduled', date: addDays(t, -1) });
    await draft(db, 'e', { stage: 'published', date: addDays(t, -3) });
    await draft(db, 'f', { stage: 'failed' });
    await draft(db, 'g', { stage: 'queued', body: '' });
    const x = await draft(db, 'h', { stage: 'review', date: addDays(t, -5) });
    await db.query(`update public.posts set deleted_at = now() where id = $1`, [x]);
    assert.deepEqual(await val(db, `select public.backlog_state()`), { backlog: 4, limit: 7, overdue: 2 });
    await db.query(`update public.settings set per_day = 3 where id = 1`);
    assert.equal((await val(db, `select public.backlog_state()`)).limit, 21);
    await db.query(`update public.settings set backlog_limit = 4 where id = 1`);
    assert.equal((await val(db, `select public.backlog_state()`)).limit, 4, '직접 정한 한도가 있으면 그것');
    await assert.rejects(db.query(`update public.settings set backlog_limit = 61 where id = 1`), /settings_backlog_limit_range/);
  });

  test('자동 글은 쌓인 원고가 한도 이상이면 거절, 요청·Claude 안 글공장 원고는 그대로 받음', async () => {
    // 위 테스트에서 쌓인 원고 4개, 한도 4
    await assert.rejects(db.query(`select * from public.add_post($1::jsonb, 1)`, [JSON.stringify({ keyword: '자동 글', body: longBody(), source: 'auto' })]), /backlog full: 4 drafts waiting \(limit 4\)/);
    await assert.rejects(db.query(`select * from public.add_post($1::jsonb, 1)`, [JSON.stringify({ keyword: 'source 없음 = 자동', body: longBody() })]), /backlog full/);
    const r = await one(db, `select post_id from public.add_post($1::jsonb, 0)`, [JSON.stringify({ keyword: '앱에서 요청한 글', body: longBody(), source: 'request' })]);
    assert.ok(r.post_id);
    const a = await one(db, `select post_id from public.add_post($1::jsonb, 0)`, [JSON.stringify({ keyword: 'Claude 안 글공장 글', body: longBody(), source: 'artifact' })]);
    assert.ok(a.post_id);
    await db.query(`update public.settings set backlog_limit = 10 where id = 1`);
    const auto = await one(db, `select post_id from public.add_post($1::jsonb, 1)`, [JSON.stringify({ keyword: '한도 늘린 뒤 자동 글', body: longBody(), source: 'auto' })]);
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [auto.post_id]), 'review', '한도 안이면 지금처럼 검수 필요로');
  });
});

describe('예정일 지난 원고 날짜 다시 잡기 (reschedule_overdue)', () => {
  test('지난 날짜 순서대로 내일부터 빈 날에 (하루 발행 수 안 넘게), 게시한 글·앞으로 잡힌 글·휴지통은 그대로, 단계도 그대로', async () => {
    const db = await freshDb();
    const t = kstToday();
    await db.query(`update public.settings set per_day = 1 where id = 1`);
    const old2 = await draft(db, '이틀 지남', { stage: 'review', date: addDays(t, -2) });
    const old1 = await draft(db, '하루 지남', { stage: 'scheduled', date: addDays(t, -1) });
    const old3 = await draft(db, '사흘 지남 (정보 필요)', { stage: 'verify', date: addDays(t, -3) });
    const fut = await draft(db, '내일 잡힘', { stage: 'ready', date: addDays(t, 1) });
    const pub = await draft(db, '게시함', { stage: 'published', date: addDays(t, -4) });
    const del = await draft(db, '휴지통', { stage: 'review', date: addDays(t, -2) });
    await db.query(`update public.posts set deleted_at = now() where id = $1`, [del]);
    const moved = await val(db, `select public.reschedule_overdue()`);
    assert.deepEqual(moved.map((m) => [m.id, m.from, m.to]), [
      [old3, addDays(t, -3), addDays(t, 2)],
      [old2, addDays(t, -2), addDays(t, 3)],
      [old1, addDays(t, -1), addDays(t, 4)],
    ], '내일(1일 뒤)은 이미 잡혀 있어서 2일 뒤부터');
    const rows = Object.fromEntries((await all(db, `select id, stage, publish_date::text as d from public.posts`)).map((r) => [r.id, r]));
    assert.equal(rows[old1].stage, 'scheduled', '단계는 그대로');
    assert.equal(rows[old3].stage, 'verify');
    assert.equal(rows[fut].d, addDays(t, 1));
    assert.equal(rows[pub].d, addDays(t, -4), '게시한 글은 안 건드림');
    assert.equal(rows[del].d, addDays(t, -2), '휴지통은 안 건드림');
    assert.deepEqual(await val(db, `select public.reschedule_overdue()`), [], '다시 부르면 옮길 게 없음');
    assert.equal((await val(db, `select public.backlog_state()`)).overdue, 0);
  });
});

describe('개선안 (refresh 작업 · set_refresh)', () => {
  let db, post, job;
  before(async () => {
    db = await freshDb();
    post = await draft(db, '원룸 전기요 고르는 법', { stage: 'published', date: addDays(kstToday(), -10) });
    await db.query(`update public.posts set blog_url = 'https://blog.naver.com/x/1', published_on = $2 where id = $1`, [post, addDays(kstToday(), -10)]);
    job = await val(db, `insert into public.requests (keyword, kind, post_id, payload) values ('원룸 전기요 고르는 법', 'refresh', $1, '{"focus":"title"}') returning id`, [post]);
  });

  test('refresh 작업을 만들 수 있고, 시작해도 글의 단계는 안 바뀜', async () => {
    await db.query(`select public.job_start($1)`, [job]);
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [post]), 'published');
    await assert.rejects(db.query(`insert into public.requests (keyword, kind) values ('x', 'nope')`), /requests_kind_check/);
  });

  test('개선안은 그 글에 저장되고 그 작업만 완료, 글 본문·제목은 안 바뀜', async () => {
    const other = await val(db, `insert into public.requests (keyword, kind, payload) values ('다른 작업', 'topics', '{}') returning id`);
    const before = await one(db, `select body, titles from public.posts where id = $1`, [post]);
    await db.query(`select public.set_refresh($1, $2, $3::jsonb)`, [post, job, JSON.stringify({ titles: ['원룸 전기요 고르는 법, 전기세까지'], intro: '도입부 개선안' })]);
    const p = await one(db, `select body, titles, refresh from public.posts where id = $1`, [post]);
    assert.deepEqual(p.refresh.titles, ['원룸 전기요 고르는 법, 전기세까지']);
    assert.ok(p.refresh._updated_at && p.refresh._job === job);
    assert.equal(p.body, before.body);
    assert.deepEqual(p.titles, before.titles);
    assert.equal(await val(db, `select status from public.requests where id = $1`, [job]), 'done');
    // 다른 작업 번호를 넘겨도 그 작업은 안 끝냄 (refresh 가 아니라서)
    await db.query(`select public.set_refresh($1, $2, $3::jsonb)`, [post, other, JSON.stringify({ intro: 'x' })]);
    assert.equal(await val(db, `select status from public.requests where id = $1`, [other]), 'pending');
  });

  test('이상한 값·없는 글은 거절', async () => {
    await assert.rejects(db.query(`select public.set_refresh($1, null, '[1]'::jsonb)`, [post]), /must be an object/);
    await assert.rejects(db.query(`select public.set_refresh($1, null, '{}'::jsonb)`, ['00000000-0000-4000-8000-000000000000']), /post not found/);
    await assert.rejects(db.query(`select public.set_refresh($1, null, $2::jsonb)`, [post, JSON.stringify({ intro: 'x'.repeat(30001) })]), /too long/);
  });
});

describe('다른 채널 기록 · 유입 검색어 표', () => {
  let db, post;
  before(async () => { db = await freshDb(); post = await draft(db, '겨울 가습기 세척', { stage: 'published' }); });

  test('다른 채널 기록: 글·채널마다 하나, https 주소만 (빈 주소는 허용)', async () => {
    await db.query(`insert into public.post_channels (post_id, channel_id, url, posted_on, variant_key) values ($1, 'threads', 'https://www.threads.net/@me/post/1', $2, 'threads')`, [post, kstToday()]);
    await assert.rejects(db.query(`insert into public.post_channels (post_id, channel_id, posted_on) values ($1, 'threads', $2)`, [post, kstToday()]), /post_channels_post_channel_key/);
    await assert.rejects(db.query(`insert into public.post_channels (post_id, channel_id, url, posted_on) values ($1, 'instagram', 'javascript:alert(1)', $2)`, [post, kstToday()]), /post_channels_checks/);
    await assert.rejects(db.query(`insert into public.post_channels (post_id, channel_id, posted_on) values ($1, 'nope', $2)`, [post, kstToday()]), /foreign key/);
    await db.query(`insert into public.post_channels (post_id, channel_id, posted_on) values ($1, 'instagram', $2)`, [post, kstToday()]);
    assert.equal(await val(db, `select count(*)::int from public.post_channels where post_id = $1`, [post]), 2);
  });

  test('유입 검색어: 같은 글·검색어·기간은 하나, 빈 값은 데이터 없음(null), 음수·거꾸로 기간·앞뒤 공백은 거절', async () => {
    const t = kstToday(), s = addDays(t, -6);
    await db.query(`insert into public.search_terms (post_id, term, views, period_start, period_end, channel_id, source_label) values ($1, '가습기 세척', 12, $2, $3, 'naver_blog', '네이버 블로그 통계')`, [post, s, t]);
    await db.query(`insert into public.search_terms (post_id, term, views, period_start, period_end) values ($1, '가습기 세척 쉬운', null, $2, $3)`, [post, s, t]);
    await assert.rejects(db.query(`insert into public.search_terms (post_id, term, views, period_start, period_end) values ($1, '가습기 세척', 3, $2, $3)`, [post, s, t]), /search_terms_post_term_period_key/);
    await assert.rejects(db.query(`insert into public.search_terms (post_id, term, views, period_start, period_end) values ($1, 'x', -1, $2, $3)`, [post, s, t]), /search_terms_checks/);
    await assert.rejects(db.query(`insert into public.search_terms (post_id, term, period_start, period_end) values ($1, 'x', $3, $2)`, [post, s, t]), /search_terms_checks/);
    await assert.rejects(db.query(`insert into public.search_terms (post_id, term, period_start, period_end) values ($1, ' 공백 ', $2, $3)`, [post, s, t]), /search_terms_checks/);
    assert.equal(await val(db, `select views from public.search_terms where term = '가습기 세척 쉬운'`), null);
  });
});

describe('자동 작가 상황판 (writer_context 1.4.0)', () => {
  test('쌓인 원고·최근 90일 유입 검색어(많은 순)·개선안 작업에 필요한 글 정보가 들어가고, 예전 항목은 그대로', async () => {
    const db = await freshDb();
    const t = kstToday();
    const a = await draft(db, '원룸 전기요 고르는 법', { stage: 'published' });
    const b = await draft(db, '온수매트 소음', { stage: 'published' });
    await draft(db, '검수 대기', { stage: 'review', date: addDays(t, 2) });
    const q = (post, term, views, end) => db.query(`insert into public.search_terms (post_id, term, views, period_start, period_end) values ($1, $2, $3, $4, $4)`, [post, term, views, end]);
    await q(a, '원룸 전기요', 20, t);
    await q(a, '원룸 전기요', 5, addDays(t, -7));
    await q(b, '원룸 전기요', 3, t);
    await q(b, '온수매트 소음', 9, t);
    await q(a, '오래된 검색어', 99, addDays(t, -120));
    await db.query(`insert into public.metrics (post_id, period_start, period_end, views, clicks, source) values ($1, $2, $2, 300, 6, 'manual')`, [a, t]);
    await db.query(`insert into public.post_channels (post_id, channel_id, posted_on) values ($1, 'threads', $2)`, [a, t]);
    await db.query(`insert into public.requests (keyword, kind, post_id, payload) values ('원룸 전기요 고르는 법', 'refresh', $1, '{"focus":"title"}')`, [a]);
    const ctx = await val(db, `select public.writer_context()`);
    assert.deepEqual(ctx.backlog, { backlog: 1, limit: 7, overdue: 0 });
    assert.deepEqual(ctx.search_terms_top.map((x) => [x.term, x.views, x.posts]), [['원룸 전기요', 28, 2], ['온수매트 소음', 9, 1]], '90일 넘은 검색어는 빼고 많은 순');
    assert.equal(ctx.search_terms_top[0].post_keyword, '원룸 전기요 고르는 법');
    const job = ctx.jobs.find((j) => j.kind === 'refresh');
    assert.ok(job.post.body.length > 50, '개선안 작업에는 본문이 들어감');
    assert.equal(job.post.keyword, '원룸 전기요 고르는 법');
    assert.deepEqual([job.post.metrics.views, job.post.metrics.clicks, job.post.metrics.rows], [300, 6, 1]);
    assert.deepEqual(job.post.search_terms.map((x) => [x.term, x.views]), [['오래된 검색어', 99], ['원룸 전기요', 25]], '그 글의 검색어 (기간 상관없이 합)');
    assert.deepEqual(job.post.other_channels.map((x) => x.channel_id), ['threads']);
    for (const k of ['kst_now', 'settings', 'programs', 'channels', 'compat', 'jobs', 'upcoming', 'recent_keywords', 'adopted_topics', 'performance_90d']) assert.ok(k in ctx, k);
    // 원고 작업에는 본문을 안 넣음 (지금처럼)
    await db.query(`insert into public.requests (keyword, kind, post_id) values ('쓰기', 'write', $1)`, [b]);
    const ctx2 = await val(db, `select public.writer_context()`);
    const w = ctx2.jobs.find((j) => j.kind === 'write');
    assert.equal(w.post.body, null);
    assert.equal(w.post.metrics, undefined);
  });
});
