// 021 전문성·사람 말투 (1.7.0): 투자 블로그 채널·숫자 확인표·시리즈 번호·다듬기(이전 본문 보관)·되돌리기·잘 나가는 글 '틀' — 진짜 Postgres(PGlite). 실행: npm test
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, one, all, val, longBody, MIGRATIONS_DIR } from './helpers/db.js';

const M021 = readFileSync(join(MIGRATIONS_DIR, '021_pro_voice_1_7_0.sql'), 'utf8');
const addPost = (db, p, offset = 0) => one(db, `select post_id, publish_date::text as publish_date from public.add_post($1::jsonb, $2)`, [JSON.stringify({ body: longBody(), ...p }), offset]);
const errOf = async (p) => { try { await p; return 'ok'; } catch (e) { return String(e.message); } };
const BODY = '[이미지: 거실 창가 가습기]\n[프롬프트: 창가 선반 위 흰 가습기, 1:1]\n## 고르기 전에\n겨울엔 실내 습도를 먼저 보는 것이 중요합니다. 다양한 방법을 알아보겠습니다.\n[링크: 쿠팡에서 가격 보기]\n## 정리\n' + '세척이 쉬운 구조가 먼저입니다. '.repeat(8);

describe('021 적용: 열·기본값·채널 (예전 원고·설정은 그대로)', () => {
  test('020 DB에 021을 두 번 올려도 같고, 투자 블로그 채널과 수익 모델 판정이 생김 (네이버 블로그와 같게)', async () => {
    const db = await freshDb({ upTo: '020' });
    const old = await val(db, `insert into public.posts (keyword, body, titles, stage, channel_id, source) values ('예전 원고', $1, '["예전"]', 'review', 'naver_blog', 'auto') returning id`, [longBody()]);
    await db.exec(M021);
    await db.exec(M021);
    assert.deepEqual(await one(db, `select figures, deleted_at from public.posts where id = $1`, [old]), { figures: [], deleted_at: null }, '마이그레이션은 원고를 지우지 않음');
    assert.deepEqual(await one(db, `select voice, series, invest_channel, brand_name from public.settings where id = 1`),
      { voice: {}, series: { market: '오늘의 증시', stock: '종목 한 장 정리' }, invest_channel: 'naver_blog_invest', brand_name: '' });
    assert.deepEqual(await one(db, `select name, kind, active from public.channels where id = 'naver_blog_invest'`), { name: '네이버 블로그 (투자)', kind: 'blog', active: true });
    const a = await all(db, `select program_id, verdict from public.program_channels where channel_id = 'naver_blog' order by program_id`);
    const b = await all(db, `select program_id, verdict from public.program_channels where channel_id = 'naver_blog_invest' order by program_id`);
    assert.ok(a.length > 0);
    assert.deepEqual(b, a, '판정은 네이버 블로그와 같음');
    assert.match(await errOf(db.query(`update public.posts set figures = '{}' where id = $1`, [old])), /posts_figures_shape/);
    assert.match(await errOf(db.query(`update public.settings set voice = '[]' where id = 1`)), /settings_voice_shape/);
    // 작업 종류 polish, 사진 공급자 pixabay·unsplash, 공공누리 출처 kogl 이 허용됨
    await db.query(`insert into public.requests (keyword, kind, post_id, payload) values ('다듬기', 'polish', $1, '{}')`, [old]);
    assert.match(await errOf(db.query(`insert into public.requests (keyword, kind) values ('x', 'crypto')`)), /requests_kind_check/);
    for (const prov of ['pixabay', 'unsplash']) {
      await db.query(`insert into public.post_images (kind, provider, storage_path, mime, bytes, width, height, sha256) values ('stock', $1, $2, 'image/jpeg', 10, 1, 1, $3)`, [prov, `stock/${prov}.jpg`, prov.padEnd(64, '0')]);
    }
    await db.query(`insert into public.post_images (kind, provider, storage_path, mime, bytes, width, height, sha256, source_type) values ('upload', 'upload', 'up/k.jpg', 'image/jpeg', 10, 1, 1, $1, 'kogl')`, ['k'.padEnd(64, '0')]);
  });

  test('잠금: 앱 열쇠(anon·authenticated)는 새 함수·표에 못 닿고, 서버는 되돌리기·다듬기를 부를 수 있음', async () => {
    const db = await freshDb();
    for (const fn of ['public.set_polish(uuid, uuid, jsonb)', 'public.revert_post(uuid)', 'public.add_post(jsonb, int)', 'public.writer_context()', 'public.plan_today()']) {
      for (const role of ['anon', 'authenticated']) assert.equal(await val(db, `select has_function_privilege($1, $2, 'execute')`, [role, fn]), false, `${role} ${fn}`);
    }
    for (const fn of ['public.set_polish(uuid, uuid, jsonb)', 'public.revert_post(uuid)']) assert.equal(await val(db, `select has_function_privilege('service_role', $1, 'execute')`, [fn]), true);
    for (const t of ['public.post_revisions', 'public.post_templates', 'public.api_cache']) {
      for (const role of ['anon', 'authenticated']) assert.equal(await val(db, `select has_table_privilege($1, $2, 'select')`, [role, t]), false, `${role} ${t}`);
      assert.equal(await val(db, `select relrowsecurity from pg_class where oid = $1::regclass`, [t]), true, `RLS ${t}`);
    }
    // Pixabay 검색 결과 저장 (24시간 — 이용 조건): 같은 열쇠는 하나만, 빈 열쇠는 거절
    await db.query(`insert into public.api_cache (key, body) values ('pixabay:가습기||1', '{"photos":[]}')`);
    await db.query(`insert into public.api_cache (key, body) values ('pixabay:가습기||1', '{"photos":[1]}') on conflict (key) do update set body = excluded.body, at = now()`);
    assert.deepEqual(await one(db, `select count(*)::int as n, max(body::text) as b from public.api_cache`), { n: 1, b: '{"photos": [1]}' });
    assert.match(await errOf(db.query(`insert into public.api_cache (key, body) values ('', '{}')`)), /api_cache_key_check/);
  });
});

describe('투자 블로그·숫자 확인표·시리즈 (add_post · plan_today)', () => {
  let db;
  before(async () => { db = await freshDb(); });

  test('증시·종목 글은 투자 블로그 채널로, 다른 종류는 기본 채널 그대로. 투자 채널을 비우면 같은 블로그', async () => {
    const m = await addPost(db, { keyword: '코스피 마감 외국인 순매도 이유', source: 'auto', plan_kind: 'market', channel_id: 'naver_blog', program_ids: ['naver_adpost'] });
    assert.equal(await val(db, `select channel_id from public.posts where id = $1`, [m.post_id]), 'naver_blog_invest');
    const a = await addPost(db, { keyword: '원룸 전기요 고르는 기준', source: 'auto', plan_kind: 'adpost', channel_id: 'naver_blog', program_ids: ['naver_adpost'] });
    assert.equal(await val(db, `select channel_id from public.posts where id = $1`, [a.post_id]), 'naver_blog');
    await db.query(`update public.settings set invest_channel = '' where id = 1`);
    const s = await addPost(db, { keyword: '엔비디아 3분기 실적 데이터센터', source: 'auto', plan_kind: 'stock', channel_id: 'naver_blog', program_ids: ['naver_adpost'] });
    assert.equal(await val(db, `select channel_id from public.posts where id = $1`, [s.post_id]), 'naver_blog');
    // 투자 채널을 꺼 두면(비활성) 원래 채널
    await db.query(`update public.settings set invest_channel = 'naver_blog_invest' where id = 1`);
    await db.query(`update public.channels set active = false where id = 'naver_blog_invest'`);
    const s2 = await addPost(db, { keyword: '삼성전자 3분기 잠정 실적 정리', source: 'auto', plan_kind: 'stock', channel_id: 'naver_blog', program_ids: ['naver_adpost'] });
    assert.equal(await val(db, `select channel_id from public.posts where id = $1`, [s2.post_id]), 'naver_blog');
    await db.query(`update public.channels set active = true where id = 'naver_blog_invest'`);
  });

  test('숫자 확인표: 객체만 30개까지 저장, 배열이 아니면 빈 표', async () => {
    const figs = [{ label: '코스피 종가', value: '2,601.23', unit: '포인트', as_of: '2026-11-02', source_url: 'https://data.krx.co.kr/' }, 'x', 3,
      ...Array.from({ length: 40 }, (_, i) => ({ label: '항목' + i, value: String(i) }))];
    const r = await addPost(db, { keyword: '코스닥 마감 개인 순매수 업종', source: 'auto', plan_kind: 'market', program_ids: ['naver_adpost'], figures: figs });
    const saved = await val(db, `select figures from public.posts where id = $1`, [r.post_id]);
    assert.equal(saved[0].label, '코스피 종가');
    assert.ok(saved.every((f) => typeof f === 'object'), '글자·숫자는 버림');
    assert.ok(saved.length <= 30);
    const r2 = await addPost(db, { keyword: '요청 글 숫자 없음 확인', source: 'request', figures: 'abc' });
    assert.deepEqual(await val(db, `select figures from public.posts where id = $1`, [r2.post_id]), []);
  });

  test('오늘 계획에 시리즈 이름과 다음 번호 (그 종류로 쓴 계획 글 수 + 1 — 휴지통 글도 셈)', async () => {
    const pt = await val(db, `select public.plan_today()`);
    assert.deepEqual(pt.series, { market: '오늘의 증시', stock: '종목 한 장 정리' });
    const n = await val(db, `select count(*)::int from public.posts where source = 'auto' and plan_kind = 'stock'`);
    assert.equal(pt.series_next.stock, n + 1);
    assert.equal(pt.series_next.trending, 1);
    const any = await val(db, `select id from public.posts where plan_kind = 'stock' limit 1`);
    await db.query(`update public.posts set deleted_at = now() where id = $1`, [any]);
    assert.equal((await val(db, `select public.plan_today()`)).series_next.stock, n + 1, '지워도 번호가 되돌아가지 않음');
  });
});

describe('사람 말투로 다듬기 (set_polish) · 되돌리기 (revert_post)', () => {
  let db, post, job;
  before(async () => {
    db = await freshDb();
    post = await val(db, `insert into public.posts (keyword, body, titles, stage, channel_id, source) values ('가습기 고르는 법', $1, '["가습기 고르기"]', 'ready', 'naver_blog', 'auto') returning id`, [BODY]);
    job = await val(db, `insert into public.requests (keyword, kind, post_id, payload, status, started_at) values ('가습기', 'polish', $1, '{}', 'pending', now()) returning id`, [post]);
  });

  test('사진·링크 자리 줄을 바꾸면 거절 (이미지 연결·제휴 링크가 그 줄에 붙어 있음)', async () => {
    const bad = BODY.replace('[이미지: 거실 창가 가습기]', '[이미지: 침실 가습기]').replace('것이 중요합니다', '게 먼저예요');
    assert.match(await errOf(db.query(`select public.set_polish($1, $2, $3::jsonb)`, [post, job, JSON.stringify({ body: bad })])), /polish changed image or link lines/);
    const noLink = BODY.replace('[링크: 쿠팡에서 가격 보기]\n', '');
    assert.match(await errOf(db.query(`select public.set_polish($1, $2, $3::jsonb)`, [post, job, JSON.stringify({ body: noLink })])), /polish changed image or link lines/);
    assert.equal(await val(db, `select body from public.posts where id = $1`, [post]), BODY, '거절되면 그대로');
    assert.equal(await val(db, `select count(*)::int from public.post_revisions`), 0);
  });

  test('저장: 이전 본문은 보관, 발행 준비 → 검수 필요, 작업 끝. 같은 작업으로 두 번은 안 됨', async () => {
    const nb = BODY.replace('겨울엔 실내 습도를 먼저 보는 것이 중요합니다. 다양한 방법을 알아보겠습니다.', '겨울엔 습도부터 봐요. 40~60%면 충분하거든요.');
    await db.query(`select public.set_polish($1, $2, $3::jsonb)`, [post, job, JSON.stringify({ body: nb })]);
    assert.deepEqual(await one(db, `select body, stage, titles from public.posts where id = $1`, [post]), { body: nb, stage: 'review', titles: ['가습기 고르기'] });
    const rev = await one(db, `select body, reason, job_id from public.post_revisions where post_id = $1`, [post]);
    assert.deepEqual(rev, { body: BODY, reason: 'polish', job_id: job });
    assert.equal(await val(db, `select status from public.requests where id = $1`, [job]), 'done');
    assert.match(await errOf(db.query(`select public.set_polish($1, $2, $3::jsonb)`, [post, job, JSON.stringify({ body: nb })])), /not pending/);
    assert.ok((await val(db, `select ai_notes from public.posts where id = $1`, [post])).polished_at);
  });

  test('되돌리기: 보관한 본문으로 돌아가고, 바꾸기 전 본문도 다시 보관 (되돌린 것도 되돌릴 수 있음)', async () => {
    const rev = await val(db, `select id from public.post_revisions where post_id = $1 and reason = 'polish'`, [post]);
    const before = await val(db, `select body from public.posts where id = $1`, [post]);
    const r = await val(db, `select public.revert_post($1)`, [rev]);
    assert.equal(r.post_id, post);
    assert.equal(await val(db, `select body from public.posts where id = $1`, [post]), BODY);
    assert.equal(await val(db, `select body from public.post_revisions where post_id = $1 and reason = 'revert'`, [post]), before);
    assert.match(await errOf(db.query(`select public.revert_post(gen_random_uuid())`)), /revision not found/);
  });
});

describe('자동 작가 상황판 (writer_context)', () => {
  test('다듬기 작업에는 본문·출처가 들어가고, 종류마다 가장 최근 활성 틀만 들어감 (지문 fp 는 안 보냄)', async () => {
    const db = await freshDb();
    const post = await val(db, `insert into public.posts (keyword, body, titles, stage, channel_id, source, sources) values ('가습기', $1, '["가습기"]', 'review', 'naver_blog', 'auto', '[{"url":"https://www.kca.go.kr/"}]') returning id`, [BODY]);
    await db.query(`insert into public.requests (keyword, kind, post_id, payload) values ('가습기', 'polish', $1, '{"voice":"general"}')`, [post]);
    await db.query(`insert into public.post_templates (kind, name, outline, stats, fp, created_at) values
      ('adpost', '예전 틀', '[{"role":"방법"}]', '{"chars":2000}', '{1,2,3}', now() - interval '1 day'),
      ('adpost', '새 틀', '[{"role":"원인"},{"role":"방법"}]', '{"chars":2400}', '{4,5}', now()),
      ('market', '꺼둔 틀', '[]', '{}', '{}', now())`);
    await db.query(`update public.post_templates set active = false where name = '꺼둔 틀'`);
    const ctx = await val(db, `select public.writer_context()`);
    const j = ctx.jobs.find((x) => x.kind === 'polish');
    assert.equal(j.post.body, BODY);
    assert.deepEqual(j.post.sources, [{ url: 'https://www.kca.go.kr/' }]);
    assert.deepEqual(ctx.templates, [{ kind: 'adpost', name: '새 틀', outline: [{ role: '원인' }, { role: '방법' }], stats: { chars: 2400 } }]);
    assert.equal(ctx.settings.invest_channel, 'naver_blog_invest');
    assert.deepEqual(ctx.plan_today.series_next.market, 1);
  });
});
