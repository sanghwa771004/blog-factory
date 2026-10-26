// DB 마이그레이션·함수 테스트 (PGlite = 진짜 Postgres 17). 실행: npm test
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, one, all, val, kstToday, addDays, longBody, MIGRATIONS_DIR } from './helpers/db.js';

describe('마이그레이션', () => {
  test('예전(1.0) 데이터가 있는 상태에서 001~011이 순서대로 적용되고 기존 원고가 새 열로 옮겨진다', async () => {
    const db = await freshDb({
      before: {
        '004': async (d) => {
          // 1.0 시절 원고 3개 (글자값 채널·수익 모델, 스타일, 상태)
          await d.exec(`
            insert into public.posts (keyword, money, platform, style, body, publish_date, status, link, blog_url)
            values ('원룸 전기요', '쿠팡파트너스', '네이버 블로그', '구매 가이드(고르는 법)형', 'x', current_date, 'planned', '', ''),
                   ('가습기 후기', '토스 쇼핑 제휴', '티스토리', '단일 상품 솔직 리뷰형', 'x', current_date, 'published', 'https://link.coupang.com/a/abc', 'https://x.tistory.com/1'),
                   ('정보 글', '애드센스(정보성 글)', '워드프레스 / 구글 블로그', '문제 해결 정보형', 'x', null, 'planned', '', '');`);
        },
      },
    });
    const rows = await all(db, `select keyword, channel_id, program_ids, content_type, stage, status from public.posts order by keyword`);
    const by = Object.fromEntries(rows.map((r) => [r.keyword, r]));
    assert.equal(by['원룸 전기요'].channel_id, 'naver_blog');
    assert.deepEqual(by['원룸 전기요'].program_ids, ['coupang_partners']);
    assert.equal(by['원룸 전기요'].content_type, 'buying_guide');
    assert.equal(by['원룸 전기요'].stage, 'review');
    assert.equal(by['가습기 후기'].channel_id, 'tistory');
    assert.deepEqual(by['가습기 후기'].program_ids, ['toss_sharelink']);
    assert.equal(by['가습기 후기'].content_type, 'experience_review');
    assert.equal(by['가습기 후기'].stage, 'published');
    assert.equal(by['정보 글'].channel_id, 'website');
    assert.deepEqual(by['정보 글'].program_ids, ['google_adsense']);
    // 예전 링크 한 칸은 links 표로 옮겨짐
    const links = await all(db, `select l.url, l.program_id from public.links l join public.posts p on p.id = l.post_id where p.keyword = '가습기 후기'`);
    assert.equal(links.length, 1);
    assert.equal(links[0].program_id, 'toss_sharelink');
    // 백업 표가 만들어지고 예전 행이 그대로 들어 있음
    assert.equal(await val(db, `select count(*)::int from backup.posts_20261021`), 3);
  });

  test('정책 정보: 확인된 판정만 가능/불가, 고지문은 공식 확인된 것만 들어 있음', async () => {
    const db = await freshDb();
    const cp = await one(db, `select disclosure_template, needs_disclosure, policy_url, policy_checked_at::text as d from public.programs where id = 'coupang_partners'`);
    assert.match(cp.disclosure_template, /쿠팡 파트너스 활동의 일환으로/);
    assert.equal(cp.needs_disclosure, '필요');
    assert.ok(cp.policy_url.startsWith('https://'));
    assert.equal(cp.d, '2026-10-21');
    const nsc = await one(db, `select disclosure_template from public.programs where id = 'naver_shopping_connect'`);
    assert.equal(nsc.disclosure_template, '', '공식 문구를 못 찾은 쇼핑 커넥트는 비워둬야 함');
    assert.equal(await val(db, `select verdict from public.program_channels where program_id = 'google_adsense' and channel_id = 'threads'`), '불가');
    assert.equal(await val(db, `select public.compat_verdict('cpa', 'instagram')`), '확인 필요');
    assert.equal(await val(db, `select public.compat_verdict('없는', 'naver_blog')`), '확인 필요', '표에 없는 조합은 확인 필요');
    // 모든 표에 RLS가 켜져 있어야 함 (011부터 backup 스키마 표도)
    const off = await all(db, `select n.nspname, relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'backup') and c.relkind = 'r' and not c.relrowsecurity`);
    assert.deepEqual(off, []);
    assert.ok(await val(db, `select count(*)::int from pg_tables where schemaname = 'backup'`) > 0, 'backup 표가 있어야 검사가 의미 있음');
  });

  test('010 정책 고침: 쿠팡 공식 가이드 문구로, 공식 근거가 생긴 조합만 가능으로', async () => {
    const db = await freshDb();
    const cp = await one(db, `select disclosure_template, policy_url from public.programs where id = 'coupang_partners'`);
    assert.equal(cp.disclosure_template, '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.');
    assert.match(cp.policy_url, /partners\.coupangcdn\.com/);
    const v = async (p, c) => val(db, `select verdict from public.program_channels where program_id = $1 and channel_id = $2`, [p, c]);
    assert.equal(await v('coupang_partners', 'tistory'), '가능');
    assert.equal(await v('coupang_partners', 'threads'), '가능');
    assert.equal(await v('toss_sharelink', 'tistory'), '가능');
    assert.equal(await v('coupang_partners', 'naver_blog'), '확인 필요', '네이버 쪽 규정은 못 확인해서 그대로');
    assert.equal(await v('google_adsense', 'threads'), '불가');
    const ads = await val(db, `select commission_note from public.programs where id = 'google_adsense'`);
    assert.ok(!ads.includes('전면'), '티스토리 공지에 없는 전면 광고 금지는 빠져야 함');
    assert.ok(!(await val(db, `select notes from public.channels where id = 'tistory'`)).includes('전면'));
  });

  test('010은 사용자가 이미 고친 칸을 덮어쓰지 않음', async () => {
    const db = await freshDb({
      before: {
        '010': async (d) => {
          await d.exec(`update public.programs set disclosure_template = '내가 고친 고지문' where id = 'coupang_partners';
                        update public.program_channels set verdict = '불가', reason = '내 판단' where program_id = 'coupang_partners' and channel_id = 'tistory';`);
        },
      },
    });
    assert.equal(await val(db, `select disclosure_template from public.programs where id = 'coupang_partners'`), '내가 고친 고지문');
    const r = await one(db, `select verdict, reason from public.program_channels where program_id = 'coupang_partners' and channel_id = 'tistory'`);
    assert.deepEqual({ ...r }, { verdict: '불가', reason: '내 판단' });
    // 고치지 않은 다른 칸은 정상적으로 바뀜
    assert.match(await val(db, `select policy_url from public.programs where id = 'coupang_partners'`), /coupangcdn/);
  });
});

describe('원고 저장 (add_post)', () => {
  let db;
  before(async () => { db = await freshDb(); });

  test('예전 화면이 보내는 글자값도 채널·수익 모델 id로 바꿔서 저장, 항상 검수 필요로', async () => {
    const r = await one(db, `select post_id, publish_date::text as d from public.add_post($1::jsonb, 0)`,
      [JSON.stringify({ keyword: '소금빵', money: '쿠팡파트너스', platform: '티스토리', titles: ['t'], body: longBody(), source: 'artifact' })]);
    const p = await one(db, `select channel_id, program_ids, stage, status, money, platform from public.posts where id = $1`, [r.post_id]);
    assert.equal(p.channel_id, 'tistory');
    assert.deepEqual(p.program_ids, ['coupang_partners']);
    assert.equal(p.stage, 'review');
    assert.equal(p.status, 'planned');
    assert.equal(p.money, '쿠팡파트너스');
    assert.equal(r.d, kstToday());
  });

  test('011: 이미 원고가 있는 주제로는 새 원고를 만들지 않음 (휴지통 원고는 셈하지 않음)', async () => {
    const topic = await val(db, `insert into public.topics (title, status) values ('주제 중복 방지', '채택') returning id`);
    const first = await one(db, `select post_id from public.add_post($1::jsonb, 1)`, [JSON.stringify({ keyword: '주제 첫 글', body: longBody(), topic_id: topic })]);
    assert.equal(await val(db, `select status from public.topics where id = $1`, [topic]), '제작 요청됨');
    await assert.rejects(db.query(`select * from public.add_post($1::jsonb, 1)`, [JSON.stringify({ keyword: '주제 두 번째', body: longBody(), topic_id: topic })]), /topic already has a post/);
    await db.query(`update public.posts set deleted_at = now() where id = $1`, [first.post_id]);
    await db.query(`select * from public.add_post($1::jsonb, 1)`, [JSON.stringify({ keyword: '지운 뒤 다시', body: longBody(), topic_id: topic })]);
  });

  test('쓸 수 없는 조합(애드센스 × 쓰레드)은 저장 거부', async () => {
    await assert.rejects(
      db.query(`select * from public.add_post($1::jsonb, 0)`, [JSON.stringify({ keyword: 'x', channel_id: 'threads', program_ids: ['google_adsense'], body: longBody() })]),
      /incompatible/);
  });

  test('본문이 너무 짧으면 거부', async () => {
    await assert.rejects(db.query(`select * from public.add_post($1::jsonb, 0)`, [JSON.stringify({ keyword: 'x', body: '짧음' })]), /body is required/);
  });

  test('하루 발행 개수(per_day)를 넘지 않게 날짜를 배정 (실패·대기 원고와 휴지통 원고는 세지 않음)', async () => {
    const d0 = addDays(kstToday(), 30);
    await db.query(`update public.settings set per_day = 2 where id = 1`);
    // d0에 이미 1개 + 휴지통 1개 + 실패 1개
    await db.query(`insert into public.posts (keyword, body, publish_date, stage) values ('a', 'x', $1, 'review'), ('b', 'x', $1, 'review'), ('c', 'x', $1, 'failed')`, [d0]);
    await db.query(`update public.posts set deleted_at = now() where keyword = 'b'`);
    const free = await val(db, `select public.next_free_date($1::date)::text`, [d0]);
    assert.equal(free, d0, '진짜로 잡힌 건 1개뿐이라 같은 날 하나 더 가능');
    await db.query(`insert into public.posts (keyword, body, publish_date, stage) values ('d', 'x', $1, 'ready')`, [d0]);
    assert.equal(await val(db, `select public.next_free_date($1::date)::text`, [d0]), addDays(d0, 1));
    await db.query(`update public.settings set per_day = 1 where id = 1`);
  });

  test('상품을 같이 넣으면 상품 표에 저장·연결되고, 출처가 있으면 출처 있음', async () => {
    const r = await one(db, `select post_id from public.add_post($1::jsonb, 0)`, [JSON.stringify({
      keyword: '전기요 비교', body: longBody(), products: [
        { name: '전기요 A', brand: 'B사', model: 'M-1', source_urls: ['https://b.example.com/m1'], specs: [{ name: '크기', value: '싱글' }] },
        { name: '전기요 B', brand: 'C사', model: '' },
      ] })]);
    const prods = await all(db, `select pr.name, pr.trust, pp.sort from public.post_products pp join public.products pr on pr.id = pp.product_id where pp.post_id = $1 order by pp.sort`, [r.post_id]);
    assert.equal(prods.length, 2);
    assert.equal(prods[0].trust, '출처 있음');
    assert.equal(prods[1].trust, '미검증');
    // 같은 상품을 다시 넣으면 새로 만들지 않고 합침
    await db.query(`select * from public.add_post($1::jsonb, 0)`, [JSON.stringify({ keyword: '전기요 2', body: longBody(), products: [{ name: '전기요 A', brand: 'B사', model: 'M-1' }] })]);
    assert.equal(await val(db, `select count(*)::int from public.products where model = 'M-1'`), 1);
  });

  test('AI가 넣은 가격은 확인 날짜가 없으면 버림', async () => {
    await db.query(`select * from public.add_post($1::jsonb, 0)`, [JSON.stringify({ keyword: 'p', body: longBody(), products: [{ name: '가격 테스트', price: 39900 }] })]);
    assert.equal(await val(db, `select price from public.products where name = '가격 테스트'`), null);
  });
});

describe('작업 흐름 (요청 → 작성 → 검수)', () => {
  let db;
  before(async () => { db = await freshDb(); });

  test('원고 요청 → 대기 → 작성 → 검수 필요, 요청은 완료', async () => {
    const r = await one(db, `select post_id, job_id from public.request_post($1::jsonb)`, [JSON.stringify({ keyword: '원룸 가습기', channel_id: 'naver_blog', program_ids: ['coupang_partners'], content_type: 'buying_guide' })]);
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [r.post_id]), 'queued');
    const ctx = await val(db, `select public.writer_context()`);
    assert.equal(ctx.jobs.length, 1);
    assert.equal(ctx.jobs[0].post.content_type, 'buying_guide');
    await db.query(`select public.job_start($1)`, [r.job_id]);
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [r.post_id]), 'writing');
    // 처리 중인 작업은 다시 잡을 수 없음
    await assert.rejects(db.query(`select public.job_start($1)`, [r.job_id]), /not pending/);
    const d = await val(db, `select public.fill_post($1, $2::jsonb)::text`, [r.post_id, JSON.stringify({ titles: ['원룸 가습기 고르는 법'], body: longBody(), content_type: 'buying_guide', sources: [] })]);
    assert.equal(d, kstToday());
    const p = await one(db, `select stage, body from public.posts where id = $1`, [r.post_id]);
    assert.equal(p.stage, 'review');
    assert.equal(await val(db, `select status from public.requests where id = $1`, [r.job_id]), 'done');
    // 다 쓴 원고에 다시 채우기는 거부
    await assert.rejects(db.query(`select public.fill_post($1, $2::jsonb)`, [r.post_id, JSON.stringify({ body: longBody() })]), /not waiting/);
  });

  test('경험이 필요해서 실패 → 자료 검증 필요 → 다시 요청하면 같은 작업이 대기로', async () => {
    const r = await one(db, `select post_id, job_id from public.request_post($1::jsonb)`, [JSON.stringify({ keyword: '후기', content_type: 'experience_review', experience: '' })]);
    await db.query(`select public.job_start($1)`, [r.job_id]);
    await db.query(`select public.job_fail($1, '경험이 필요해', true)`, [r.job_id]);
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [r.post_id]), 'verify');
    await db.query(`update public.posts set experience = '2주 써봄' where id = $1`, [r.post_id]);
    const j = await val(db, `select public.post_retry($1)`, [r.post_id]);
    assert.equal(j, r.job_id);
    assert.equal(await val(db, `select status from public.requests where id = $1`, [r.job_id]), 'pending');
    assert.equal(await val(db, `select exp from public.requests where id = $1`, [r.job_id]), '2주 써봄');
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [r.post_id]), 'queued');
  });

  test('쓸 수 없는 조합으로는 요청 자체가 거부', async () => {
    await assert.rejects(db.query(`select * from public.request_post($1::jsonb)`, [JSON.stringify({ keyword: 'x', channel_id: 'instagram', program_ids: ['naver_adpost'] })]), /incompatible/);
  });

  test('대기 중 작업 취소는 되고, 처리 중(30분 안)인 작업은 취소 안 됨', async () => {
    const a = await one(db, `select post_id, job_id from public.request_post($1::jsonb)`, [JSON.stringify({ keyword: '취소 A' })]);
    await db.query(`select public.job_cancel($1)`, [a.job_id]);
    assert.equal(await val(db, `select status from public.requests where id = $1`, [a.job_id]), 'cancelled');
    const b = await one(db, `select post_id, job_id from public.request_post($1::jsonb)`, [JSON.stringify({ keyword: '취소 B' })]);
    await db.query(`select public.job_start($1)`, [b.job_id]);
    await assert.rejects(db.query(`select public.job_cancel($1)`, [b.job_id]), /cannot be cancelled/);
  });

  test('011: 끝난 작업에 늦게 온 실패 기록은 무시 (완료를 실패로 뒤집지 않음)', async () => {
    const r = await one(db, `select post_id, job_id from public.request_post($1::jsonb)`, [JSON.stringify({ keyword: '늦은 실패', content_type: 'buying_guide' })]);
    await db.query(`select public.job_start($1)`, [r.job_id]);
    await db.query(`select public.fill_post($1, $2::jsonb)`, [r.post_id, JSON.stringify({ body: longBody() })]);
    await db.query(`select public.job_fail($1, '다른 작가가 늦게 보낸 실패', false)`, [r.job_id]);
    assert.equal(await val(db, `select status from public.requests where id = $1`, [r.job_id]), 'done');
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [r.post_id]), 'review');
  });

  test('011: 30분 넘게 멈춘 작업을 취소하면 원고가 실패로 바뀌고, 다시 요청하면 같은 작업이 대기로', async () => {
    const r = await one(db, `select post_id, job_id from public.request_post($1::jsonb)`, [JSON.stringify({ keyword: '멈춘 작업 취소' })]);
    await db.query(`select public.job_start($1)`, [r.job_id]);
    await db.query(`update public.requests set started_at = now() - interval '40 minutes' where id = $1`, [r.job_id]);
    await db.query(`select public.job_cancel($1)`, [r.job_id]);
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [r.post_id]), 'failed', "'작성 중'에 멈춰 있지 않음");
    assert.equal(await val(db, `select public.post_retry($1)::text`, [r.post_id]), r.job_id);
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [r.post_id]), 'queued');
  });

  test('011: 작성 중에 멈춘 원고는 30분이 지나면 다시 요청 가능, 30분 안이면 안 됨', async () => {
    const r = await one(db, `select post_id, job_id from public.request_post($1::jsonb)`, [JSON.stringify({ keyword: '작성 중 멈춤' })]);
    await db.query(`select public.job_start($1)`, [r.job_id]);
    await assert.rejects(db.query(`select public.post_retry($1)`, [r.post_id]), /not failed/);
    await db.query(`update public.requests set started_at = now() - interval '40 minutes' where id = $1`, [r.job_id]);
    assert.equal(await val(db, `select public.post_retry($1)::text`, [r.post_id]), r.job_id);
    const j = await one(db, `select status, started_at from public.requests where id = $1`, [r.job_id]);
    assert.equal(j.status, 'pending');
    assert.equal(j.started_at, null);
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [r.post_id]), 'queued');
  });

  test('011: 대기 중(원고 요청이 살아 있음)인 원고는 다시 요청으로 작업을 두 개 만들지 않음', async () => {
    const r = await one(db, `select post_id, job_id from public.request_post($1::jsonb)`, [JSON.stringify({ keyword: '이중 요청' })]);
    await assert.rejects(db.query(`select public.post_retry($1)`, [r.post_id]), /not failed/);
    assert.equal(await val(db, `select count(*)::int from public.requests where post_id = $1`, [r.post_id]), 1);
  });

  test('주제 추천 결과 저장과 실행 기록', async () => {
    const job = await val(db, `insert into public.requests (keyword, kind, payload) values ('겨울 가전', 'topics', '{"mode":"category"}') returning id`);
    const n = await val(db, `select public.add_topics($1, $2::jsonb)`, [job, JSON.stringify([
      { title: '전기요 고르는 법', keyword: '전기요 고르는 법', rec_channels: ['naver_blog', '없는채널'], rec_programs: ['coupang_partners'], scores: { demand: { score: 3, basis: '겨울 시즌', source: 'AI 추정', confidence: '낮음' } } },
      { title: '' },
    ])]);
    assert.equal(n, 1, '제목 없는 주제는 건너뜀');
    const t = await one(db, `select rec_channels, origin, status from public.topics`);
    assert.deepEqual(t.rec_channels, ['naver_blog'], '없는 채널 id는 빠짐');
    assert.equal(t.origin, 'ai');
    assert.equal(await val(db, `select note from public.requests where id = $1`, [job]), '1개 추천');
    await db.query(`select public.log_run('auto', '이상한값', 1, 0, 1, '메모', '')`);
    assert.equal(await val(db, `select status from public.runs order by id desc limit 1`), '성공');
  });

  test('채널별 버전 저장은 기존 버전에 합쳐짐', async () => {
    const r = await one(db, `select post_id from public.add_post($1::jsonb, 0)`, [JSON.stringify({ keyword: '변환', body: longBody() })]);
    await db.query(`select public.set_variants($1, null, $2::jsonb)`, [r.post_id, JSON.stringify({ threads: '쓰레드 글' })]);
    await db.query(`select public.set_variants($1, null, $2::jsonb)`, [r.post_id, JSON.stringify({ faq: [{ q: 'q', a: 'a' }] })]);
    const v = await val(db, `select variants from public.posts where id = $1`, [r.post_id]);
    assert.equal(v.threads, '쓰레드 글');
    assert.equal(v.faq.length, 1);
  });
});

describe('상태 동기화', () => {
  test('게시 완료로 바꾸면 예전 status도 published, 되돌리면 planned', async () => {
    const db = await freshDb();
    const id = await val(db, `insert into public.posts (keyword, body, stage) values ('s', 'x', 'review') returning id`);
    await db.query(`update public.posts set stage = 'published' where id = $1`, [id]);
    let p = await one(db, `select status, published_at from public.posts where id = $1`, [id]);
    assert.equal(p.status, 'published');
    assert.ok(p.published_at);
    await db.query(`update public.posts set stage = 'collecting' where id = $1`, [id]);
    assert.equal(await val(db, `select status from public.posts where id = $1`, [id]), 'published');
    await db.query(`update public.posts set stage = 'ready' where id = $1`, [id]);
    p = await one(db, `select status, published_at from public.posts where id = $1`, [id]);
    assert.equal(p.status, 'planned');
    assert.equal(p.published_at, null);
    await assert.rejects(db.query(`update public.posts set stage = '이상한' where id = $1`, [id]), /posts_stage_check/);
  });
});

describe('실적 (파일 올리기·통계)', () => {
  let db, postA, postB;
  before(async () => {
    db = await freshDb();
    postA = await val(db, `insert into public.posts (keyword, body, stage, channel_id, program_ids, category) values ('A', 'x', 'published', 'naver_blog', '{coupang_partners}', '겨울 가전') returning id`);
    postB = await val(db, `insert into public.posts (keyword, body, stage, channel_id, program_ids, category) values ('B', 'x', 'published', 'tistory', '{google_adsense}', '디지털') returning id`);
  });

  const importRows = async (rows) => {
    const imp = await val(db, `insert into public.imports (filename, source_label, program_id) values ('r.csv', '쿠팡 리포트', 'coupang_partners') returning id`);
    const res = await val(db, `select public.import_metrics($1, $2::jsonb)`, [imp, JSON.stringify(rows)]);
    return { imp, res };
  };

  test('같은 파일을 두 번 올리면 두 번째는 모두 중복으로 건너뜀', async () => {
    const rows = [
      { post_id: postA, period_start: '2026-10-01', period_end: '2026-10-01', views: 100, clicks: 5, orders: 1, revenue_est: 1200 },
      { post_id: postA, period_start: '2026-10-02', period_end: '2026-10-02', views: 80, clicks: 0, orders: 0, revenue_est: 0 },
      { match_text: '모르는 글', period_start: '2026-10-02', period_end: '2026-10-02', clicks: 3 },
    ];
    const first = await importRows(rows);
    assert.deepEqual(first.res, { ok: 3, dup: 0, changed: 0 });
    const second = await importRows(rows);
    assert.deepEqual(second.res, { ok: 0, dup: 3, changed: 0 });
    assert.equal(await val(db, `select stage from public.posts where id = $1`, [postA]), 'collecting', '실적이 들어오면 실적 수집 중');
    assert.equal(await val(db, `select note from public.metrics where post_id is null`), '글 연결 안 됨: 모르는 글');
    // 올리기 취소 = 그 파일로 넣은 줄만 지움 (두 번째 파일은 아무것도 안 넣어서 지울 게 없음)
    assert.deepEqual(await val(db, `select public.import_cancel($1)`, [second.imp]), { removed: 0, restored: 0 });
    assert.deepEqual(await val(db, `select public.import_cancel($1)`, [first.imp]), { removed: 3, restored: 0 });
    assert.equal(await val(db, `select count(*)::int from public.metrics`), 0);
    assert.equal(await val(db, `select status from public.imports where id = $1`, [first.imp]), '취소');
  });

  test('숫자가 고쳐진 리포트를 다시 올리면 두 번 세지 않고 새 숫자로, 파일 이름이 달라도 같은 줄이면 중복, 취소하면 예전 숫자로', async () => {
    await db.query(`delete from public.metrics`);
    const day = (d, o) => ({ post_id: postA, period_start: d, period_end: d, ...o });
    const a = await importRows([day('2026-10-01', { clicks: 5, revenue_est: 1200 })]);
    assert.deepEqual(a.res, { ok: 1, dup: 0, changed: 0 });
    const b = await importRows([day('2026-10-01', { clicks: 5, revenue_est: 900 }), day('2026-10-02', { revenue_est: 300 })]);
    assert.deepEqual(b.res, { ok: 1, dup: 0, changed: 1 });
    const s = await val(db, `select public.stats('2026-10-01', '2026-10-31')`);
    assert.equal(Number(s.totals.revenue_est.sum), 1200, '900 + 300 (예전 1200을 또 더하지 않음)');
    assert.equal(s.totals.rows, 2);
    const renamed = await val(db, `insert into public.imports (filename, source_label, program_id) values ('이름 바꾼 파일.csv', '다른 출처 이름', 'coupang_partners') returning id`);
    assert.deepEqual(await val(db, `select public.import_metrics($1, $2::jsonb)`, [renamed, JSON.stringify([day('2026-10-01', { clicks: 5, revenue_est: 900 })])]), { ok: 0, dup: 1, changed: 0 });
    assert.deepEqual(await val(db, `select public.import_cancel($1)`, [b.imp]), { removed: 1, restored: 1 });
    assert.equal(Number(await val(db, `select revenue_est from public.metrics where period_start = '2026-10-01'`)), 1200, '고친 줄은 예전 숫자로');
    assert.equal(await val(db, `select count(*)::int from public.metrics where period_start = '2026-10-02'`), 0, '새로 넣은 줄은 지움');
    assert.equal(await val(db, `select import_id::text from public.metrics where period_start = '2026-10-01'`), a.imp);
  });

  test('한 파일 안 같은 글·같은 날짜 줄(상품별 줄)은 더해서 한 줄로, 같은 파일을 다시 올리면 중복', async () => {
    await db.query(`delete from public.metrics`);
    const rows = [
      { post_id: postB, period_start: '2026-10-03', period_end: '2026-10-03', orders: 1, revenue_est: 500 },
      { post_id: postB, period_start: '2026-10-03', period_end: '2026-10-03', orders: 2, revenue_est: 700 },
    ];
    assert.deepEqual((await importRows(rows)).res, { ok: 2, dup: 0, changed: 0 });
    const m = await one(db, `select orders, revenue_est, clicks from public.metrics where post_id = $1`, [postB]);
    assert.equal(m.orders, 3);
    assert.equal(Number(m.revenue_est), 1200);
    assert.equal(m.clicks, null, '둘 다 비어 있으면 0이 아니라 데이터 없음');
    assert.deepEqual((await importRows(rows)).res, { ok: 0, dup: 2, changed: 0 });
  });

  test('여러 번 고친 뒤 중간 파일을 취소해도 숫자가 꼬이지 않음', async () => {
    await db.query(`delete from public.metrics`);
    const day = (v) => [{ post_id: postA, period_start: '2026-10-05', period_end: '2026-10-05', revenue_est: v }];
    const r1 = await importRows(day(100));
    const r2 = await importRows(day(200));
    const r3 = await importRows(day(300));
    assert.deepEqual(r3.res, { ok: 0, dup: 0, changed: 1 });
    const now = () => val(db, `select revenue_est::int from public.metrics where period_start = '2026-10-05'`);
    await db.query(`select public.import_cancel($1)`, [r2.imp]);
    assert.equal(await now(), 300, '지금 숫자는 그대로');
    await db.query(`select public.import_cancel($1)`, [r3.imp]);
    assert.equal(await now(), 100, '취소한 r2의 200이 되살아나지 않고 r1의 100으로');
    await db.query(`select public.import_cancel($1)`, [r1.imp]);
    assert.equal(await val(db, `select count(*)::int from public.metrics where period_start = '2026-10-05'`), 0);
  });

  test('통계: 빈 칸은 0이 아니라 데이터 없음(n=0), 0은 0으로', async () => {
    await db.query(`delete from public.metrics`);
    await db.query(`insert into public.metrics (post_id, period_start, period_end, views, clicks, revenue_est, source) values
      ($1, '2026-10-05', '2026-10-05', 200, 0, null, 'manual'),
      ($2, '2026-10-06', '2026-10-06', null, null, 3000, 'manual')`, [postA, postB]);
    const s = await val(db, `select public.stats('2026-10-01', '2026-10-31')`);
    assert.equal(s.totals.rows, 2);
    assert.equal(Number(s.totals.views.sum), 200);
    assert.equal(s.totals.views.n, 1);
    assert.equal(Number(s.totals.clicks.sum), 0);
    assert.equal(s.totals.clicks.n, 1, '0 클릭은 데이터 있음');
    assert.equal(s.totals.revenue_confirmed.n, 0, '확정 수익은 데이터 없음');
    const byProg = Object.fromEntries(s.by_program.map((x) => [x.key, x]));
    assert.equal(Number(byProg.google_adsense.revenue_est.sum), 3000);
    const byCat = Object.fromEntries(s.by_category.map((x) => [x.key, x]));
    assert.ok(byCat['겨울 가전'] && byCat['디지털']);
    // 기간 밖은 빠짐
    const s2 = await val(db, `select public.stats('2026-11-01', '2026-11-30')`);
    assert.equal(s2.totals.rows, 0);
  });

  test('음수 건수, 거꾸로 된 기간은 DB가 막음', async () => {
    await assert.rejects(db.query(`insert into public.metrics (period_start, period_end, clicks, source) values ('2026-10-01', '2026-10-01', -1, 'manual')`), /check/);
    await assert.rejects(db.query(`insert into public.metrics (period_start, period_end, clicks, source) values ('2026-10-02', '2026-10-01', 1, 'manual')`), /check/);
  });
});

describe('주력 주제 (014, 1.3.0)', () => {
  test('설정에 주력 주제 열이 생기고(기본은 빈칸), 자동 작가가 받는 설정에도 들어감', async () => {
    const db = await freshDb({ upTo: '013' });
    await db.query(`update public.settings set per_day = 1, auto_topics = '계절템·겨울 가전, 디지털' where id = 1`);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '014_focus_topic.sql'), 'utf8'));
    const st = await one(db, `select focus_topic, per_day, auto_topics from public.settings where id = 1`);
    assert.deepEqual(st, { focus_topic: '', per_day: 1, auto_topics: '계절템·겨울 가전, 디지털' }, '기존 설정은 그대로');
    await db.query(`update public.settings set focus_topic = '계절템·겨울 가전' where id = 1`);
    const ctx = await val(db, `select public.writer_context()`);
    assert.equal(ctx.settings.focus_topic, '계절템·겨울 가전');
  });
  test('60자 넘으면 거절, 다시 돌려도 오류 없이 검사는 하나만', async () => {
    const db = await freshDb();
    await assert.rejects(db.query(`update public.settings set focus_topic = repeat('가', 61) where id = 1`), /settings_focus_topic_len/);
    await db.query(`update public.settings set focus_topic = repeat('가', 60) where id = 1`);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '014_focus_topic.sql'), 'utf8'));
    assert.equal(await val(db, `select count(*)::int from pg_constraint where conname = 'settings_focus_topic_len'`), 1);
    assert.equal(await val(db, `select length(focus_topic) from public.settings where id = 1`), 60, '다시 돌려도 값은 그대로');
    await assert.rejects(db.query(`update public.settings set focus_topic = null where id = 1`), /null/);
  });
});

describe('자동 작가 원고는 항상 사람 검수가 필요한 상태로 (1.3.1 확인)', () => {
  test('자동(add_post source=auto)·요청 원고 모두 검수 필요로 저장되고, 하루 발행 설정(2편)을 바꾸지 않음', async () => {
    const db = await freshDb();
    await db.query(`update public.settings set per_day = 2 where id = 1`);
    const a = await one(db, `select post_id from public.add_post($1::jsonb, 1)`, [JSON.stringify({ keyword: '겨울 원룸 전기요 고르는 법', body: longBody(), source: 'auto', category: '전기요' })]);
    const b = await one(db, `select post_id from public.add_post($1::jsonb, 1)`, [JSON.stringify({ keyword: '겨울 온수매트 소음 줄이는 법', body: longBody(), source: 'auto', category: '온수매트' })]);
    const rows = await all(db, `select stage, source, category, publish_date::text as d from public.posts where id in ($1, $2) order by d`, [a.post_id, b.post_id]);
    assert.deepEqual(rows.map((r) => [r.stage, r.source, r.category]), [['review', 'auto', '전기요'], ['review', 'auto', '온수매트']], '카테고리는 글마다 따로, 상태는 검수 필요');
    assert.equal(rows[0].d, rows[1].d, '하루 2편 설정이면 같은 날에 2편까지 잡힘');
    assert.equal(await val(db, `select per_day from public.settings where id = 1`), 2, '설정은 그대로');
  });
});
