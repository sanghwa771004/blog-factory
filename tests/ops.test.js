// 1.4.0 운영 시스템 계산: 쌓인 원고 한도·흐름판·유입 검색어·추천 묶음·주간 정리
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../lib.js';

const T = '2026-10-26';
const D = (n) => L.addDays(T, n);
let seq = 0;
const P = (stage, extra = {}) => ({ id: `p${++seq}`, stage, keyword: extra.keyword || `글 ${seq}`, titles: extra.titles || [extra.keyword || `글 ${seq}`], ...extra });
const agg = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? { sum: null, n: 0 } : { sum: v, n: 1 }]));

describe('쌓인 원고 한도', () => {
  test('검수 필요·정보 필요·발행 준비·예약만 셈, 한도 0이면 하루 발행 수 × 7 (DB backlog_state 와 같음)', () => {
    const posts = [P('review', { publish_date: D(-2) }), P('verify'), P('ready', { publish_date: D(1) }), P('scheduled', { publish_date: D(-1) }),
      P('published'), P('failed'), P('queued'), P('review', { deleted_at: '2026-10-20' })];
    assert.deepEqual(L.backlogInfo(posts, { per_day: 1 }, T), { backlog: 4, limit: 7, auto: true, full: false, room: 3, overdue: 2, review: 2, ready: 2 });
    assert.equal(L.backlogInfo(posts, { per_day: 3 }, T).limit, 21);
    const own = L.backlogInfo(posts, { per_day: 1, backlog_limit: 4 }, T);
    assert.deepEqual([own.limit, own.auto, own.full, own.room], [4, false, true, 0]);
  });

  test('한도가 차면 자동 작가는 다음 실행에 새 자동 글을 안 쓰고, 남은 자리만큼만 씀', () => {
    const full = Array.from({ length: 7 }, (_, i) => P('review', { publish_date: D(-i) }));
    const plan = L.autoPlan({ posts: full, settings: { per_day: 1, auto_enabled: true, focus_topic: '겨울 가전' }, today: T });
    assert.deepEqual([plan.backlog, plan.backlogLimit, plan.backlogFull, plan.autoNext], [7, 7, true, 0]);
    const five = full.slice(0, 5);
    const p2 = L.autoPlan({ posts: five, settings: { per_day: 1, auto_enabled: true, focus_topic: '겨울 가전' }, today: T });
    assert.deepEqual([p2.room, p2.gap, p2.autoNext], [2, 7, 2], '발행표는 7편이 비었지만 쌓인 원고 한도까지 2편만');
    const p3 = L.autoPlan({ posts: five, settings: { per_day: 1, auto_enabled: true, focus_topic: '겨울 가전', backlog_limit: 20 }, today: T });
    assert.equal(p3.autoNext, 4, '한도를 늘리면 지금처럼 한 번에 최대 4편');
  });
});

describe('유입 검색어 붙여넣기', () => {
  test('여러 모양을 읽고, 숫자가 없으면 데이터 없음(null), 같은 검색어는 더하고 머리글은 건너뜀', () => {
    const r = L.parseSearchTerms([
      '검색어\t유입수\t비율',
      '1\t원룸 전기요\t23\t12.5%',
      '2\t전기요 전자파\t1,204\t8%',
      '3. 원룸 전기요 추천 7회 2.1%',
      '전기요 세탁 (4)',
      '탄소매트 전기요 차이 3',
      '전기요 고르는 법',
      '원룸 전기요 2',
      '  ',
      '123',
    ].join('\n'));
    assert.deepEqual(r.items, [
      { term: '원룸 전기요', views: 25 },
      { term: '전기요 전자파', views: 1204 },
      { term: '원룸 전기요 추천', views: 7 },
      { term: '전기요 세탁', views: 4 },
      { term: '탄소매트 전기요 차이', views: 3 },
      { term: '전기요 고르는 법', views: null },
    ]);
    assert.deepEqual(r.skipped.map((x) => x.why), ['숫자만 있어']);
    assert.equal(L.parseSearchTerms('x'.repeat(101)).skipped[0].why, '100자 넘어');
    assert.deepEqual(L.parseSearchTerms('').items, []);
  });

  test('글별 합계 → 제목에 없는 검색어, 어느 글도 안 다룬 검색어', () => {
    const posts = [P('published', { id: 'a', keyword: '원룸 전기요 고르는 법', titles: ['원룸 전기요 고르는 법, 전기세까지'] }),
      P('published', { id: 'b', keyword: '가습기 세척 쉬운 타입', titles: ['가습기 세척 쉬운 타입 추천'] })];
    const terms = [
      { post_id: 'a', term: '원룸 전기요', views: 20 }, { post_id: 'a', term: '원룸 전기요', views: 5 },
      { post_id: 'a', term: '전기요 전자파', views: 9 }, { post_id: 'a', term: '전기요 세탁', views: null },
      { post_id: 'b', term: '가습기 물때 제거 식초', views: 6 }, { post_id: 'b', term: '가습기 세척', views: 2 },
    ];
    const by = L.termsByPost(terms);
    assert.deepEqual(by.get('a').map((x) => [x.term, x.views]), [['원룸 전기요', 25], ['전기요 전자파', 9], ['전기요 세탁', null]]);
    assert.deepEqual(L.titleGaps(posts[0], by.get('a'), 3).map((x) => x.term), ['전기요 전자파'], '제목에 있는 말·숫자 없는 검색어는 빼고');
    assert.deepEqual(L.uncoveredTerms(posts, terms, 5).map((x) => [x.term, x.views]), [['가습기 물때 제거 식초', 6]],
      "'전기요 전자파'는 낱말 절반이 이미 글에 있어서 새 글 후보가 아님 (제목 고치기로 알려줌)");
  });
});

describe('운영 흐름판', () => {
  const programs = [{ id: 'coupang_partners', my_status: '미가입', active: true }, { id: 'naver_adpost', my_status: '가입 대기', active: true }];

  test('원고만 쌓이고 게시가 0이면 막힌 곳은 게시 (자동 작가가 멈춘 이유까지)', () => {
    const posts = [...Array.from({ length: 13 }, () => P('review', { publish_date: D(-1) })), P('ready', { publish_date: D(1) })];
    const f = L.opsFunnel({ posts, postChannels: [], metricPostIds: [], topics: [], programs, settings: { per_day: 1 }, today: T });
    assert.equal(f.bottleneck.key, 'live');
    assert.match(f.bottleneck.reason, /14개 쌓여서\(한도 7개\) 자동 작가가 새 글을 멈췄어/);
    assert.deepEqual(f.bottleneck.action, { type: 'go', path: 'content/f/you', label: '검수할 원고 보기' });
    const by = Object.fromEntries(f.stages.map((s) => [s.key, s]));
    assert.deepEqual([by.draft.count, by.ready.count, by.live.count, by.live.state], [13, 1, 0, 'block']);
    assert.deepEqual(f.money, { joined: 0, waiting: 1, total: 2 });
  });

  test('게시는 됐는데 다른 채널에 안 퍼뜨리면 → 다른 채널, 퍼뜨렸는데 실적이 없으면 → 실적, 다 되면 고칠 것 → 막힌 곳 없음', () => {
    const a = P('published', { published_on: D(-10) }), b = P('collecting', { published_on: D(-9) }), c = P('published', { published_on: D(-2) });
    const posts = [a, b, c];
    let f = L.opsFunnel({ posts, postChannels: [{ post_id: a.id }], metricPostIds: [], programs, settings: {}, today: T });
    assert.equal(f.bottleneck.key, 'spread');
    assert.deepEqual(f.bottleneck.action, { type: 'post', postId: b.id, label: '안 퍼뜨린 글 보기' });
    f = L.opsFunnel({ posts, postChannels: [{ post_id: a.id }, { post_id: b.id }], metricPostIds: [a.id], programs, settings: {}, today: T });
    assert.equal(f.bottleneck.key, 'data', '7일 지난 글 2개 중 1개만 실적 (게시 2일 된 글은 아직 안 셈)');
    assert.match(f.bottleneck.reason, /7일 지난 글 2개 중 실적\(조회·클릭·수익\)을 넣은 글이 1개/);
    f = L.opsFunnel({ posts, postChannels: [{ post_id: a.id }, { post_id: b.id }], metricPostIds: new Set([a.id, b.id]), programs, settings: {}, fixCount: 2, today: T });
    assert.equal(f.bottleneck.key, 'improve');
    f = L.opsFunnel({ posts, postChannels: [{ post_id: a.id }, { post_id: b.id }], metricPostIds: [a.id, b.id], programs, settings: {}, today: T });
    assert.equal(f.bottleneck.key, 'topic', '다 돌았는데 다음에 쓸 원고·주제가 하나도 없으면 주제부터');
    f = L.opsFunnel({ posts: [...posts, P('review')], postChannels: [{ post_id: a.id }, { post_id: b.id }], metricPostIds: [a.id, b.id], programs, settings: {}, today: T });
    assert.equal(f.bottleneck.key, 'ok');
    assert.ok(f.stages.every((s) => s.state !== 'block'));
  });

  test('아무것도 없으면 → 주제', () => {
    assert.equal(L.opsFunnel({ posts: [], today: T }).bottleneck.key, 'topic');
  });
});

describe('추천 묶음 (더 쓸 것 · 고칠 것 · 그만할 것 · 데이터 먼저)', () => {
  test('모든 추천에 묶음이 있고, 클릭률·전환·검색어 문제는 개선안 요청으로', () => {
    const a = P('published', { id: 'ra', published_on: D(-40), category: '전기요', keyword: '원룸 전기요 고르는 법' });
    const b = P('published', { id: 'rb', published_on: D(-40), category: '전기요' });
    const c = P('published', { id: 'rc', published_on: D(-40), category: '전기요' });
    const d = P('published', { id: 'rd', published_on: D(-10) });
    const e = ['re', 'rf', 'rg'].map((id) => P('published', { id, published_on: D(-45), category: '소금빵' }));
    const byPost = [
      { key: 'ra', ...agg({ views: 1000, clicks: 1, orders: 0, revenue_est: null }) },
      { key: 'rb', ...agg({ views: 200, clicks: 10, orders: 0 }) },
      { key: 'rc', ...agg({ views: 300, clicks: 9, orders: 0 }) },
      ...e.map((x) => ({ key: x.id, ...agg({ views: null, clicks: 0, orders: 0, revenue_est: 0 }) })),
    ];
    const recs = L.recommendations({ posts: [a, b, c, d, ...e], byPost, searchTerms: [{ post_id: 'ra', term: '전기요 전자파', views: 12 }, { post_id: 'ra', term: '가습기 물때 제거 식초', views: 8 }], postChannels: [{ post_id: 'rb' }, { post_id: 'rc' }], today: T });
    const kinds = recs.map((r) => [r.kind, r.group]);
    assert.ok(recs.every((r) => L.REC_GROUPS[r.group]), '묶음 이름이 다 있음');
    assert.deepEqual(kinds.filter(([k]) => k === 'need_metrics'), [['need_metrics', 'data']]);
    const low = recs.find((r) => r.kind === 'low_ctr');
    assert.deepEqual(low.action, { type: 'refresh', postId: 'ra', focus: 'ctr' });
    const title = recs.find((r) => r.kind === 'title_from_search');
    assert.equal(title.group, 'fix');
    assert.match(title.reason, /'전기요 전자파'\(12회\)/);
    const nw = recs.find((r) => r.kind === 'new_from_search');
    assert.equal(nw.group, 'more');
    assert.equal(nw.action.keyword, '가습기 물때 제거 식초');
    const stop = recs.filter((r) => r.kind === 'stop_category');
    assert.deepEqual(stop.map((r) => [r.group, r.title]), [['stop', "'소금빵' 글은 반응이 없어"]], '클릭이 있는 카테고리는 그만할 것이 아님');
    assert.deepEqual(recs.filter((r) => r.kind === 'spread').map((r) => r.postId), ['ra'], '반응 있는 글 중 아직 안 퍼뜨린 글만 (반응 없는 소금빵 글은 아님)');
  });

  test('반응이 있는데 다른 채널에 안 올린 글은 퍼뜨리기 (올렸으면 안 함)', () => {
    const a = P('published', { id: 'sa', published_on: D(-10) });
    const byPost = [{ key: 'sa', ...agg({ views: 300, clicks: 9 }) }];
    assert.ok(L.recommendations({ posts: [a], byPost, postChannels: [], today: T }).some((r) => r.kind === 'spread' && r.group === 'more'));
    assert.ok(!L.recommendations({ posts: [a], byPost, postChannels: [{ post_id: 'sa' }], today: T }).some((r) => r.kind === 'spread'));
  });
});

describe('주간 정리', () => {
  test('최근 7일(오늘 포함)과 그 전 7일: 원고·게시·다른 채널·검색어는 앱 기록, 조회·클릭·수익은 입력한 실적 (없으면 데이터 없음)', () => {
    const posts = [
      P('review', { created_at: `${D(-1)}T03:00:00`, source: 'auto' }),
      P('review', { created_at: `${D(-3)}T03:00:00`, source: 'request' }),
      P('published', { created_at: `${D(-10)}T03:00:00`, published_on: D(-2), source: 'auto' }),
      P('published', { created_at: `${D(-12)}T03:00:00`, published_on: D(-9), source: 'auto' }),
      P('review', { created_at: `${D(-2)}T03:00:00`, deleted_at: D(-1) }),
    ];
    const w = L.weeklySummary({
      posts, today: T,
      postChannels: [{ post_id: posts[2].id, posted_on: D(-1) }],
      searchTerms: [{ created_at: `${D(-1)}T05:00:00` }, { created_at: `${D(-8)}T05:00:00` }],
      runs: [{ kind: 'auto', ran_at: `${D(-1)}T00:00:00` }, { kind: 'auto', ran_at: `${D(-20)}T00:00:00` }],
      statsNow: { totals: agg({ views: 120, clicks: 4, revenue_est: null }), by_post: [{ key: posts[2].id, ...agg({ clicks: 4, views: 120 }) }] },
      statsPrev: { totals: agg({ views: null, clicks: null, revenue_est: null }) },
    });
    assert.deepEqual(w.range, { from: D(-6), to: T });
    const by = Object.fromEntries(w.rows.map((r) => [r.key, [r.now, r.prev]]));
    assert.deepEqual(by, { drafts: [2, 2], published: [1, 1], spread: [1, 0], terms: [1, 1], views: [120, null], clicks: [4, null], revenue: [null, null] });
    assert.equal(w.rows[0].sub, '자동 1');
    assert.deepEqual(w.top.map((x) => [x.postId, x.clicks]), [[posts[2].id, 4]]);
    assert.equal(w.ranAuto, 1);
  });
});
