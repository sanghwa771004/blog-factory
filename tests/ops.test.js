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
    assert.deepEqual(L.backlogInfo(posts, { per_day: 1 }, T), { backlog: 4, limit: 7, auto: true, full: false, room: 3, overdue: 1, overdueScheduled: 1, review: 2, ready: 2 },
      '예정일 지난 원고: 다시 잡을 수 있는 것(검수 필요 1)과 예약한 날이 지난 것(예약 1)을 따로');
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

  test('기다리는 요청 원고는 채우면 쌓인 원고가 돼서, 남은 자리에서 먼저 뺌 (프롬프트 3단계·DB add_post 와 같음)', () => {
    const five = Array.from({ length: 5 }, (_, i) => P('review', { publish_date: D(-i) }));
    const st = { per_day: 1, auto_enabled: true, focus_topic: '겨울 가전' };
    const two = L.autoPlan({ posts: five, settings: st, today: T, pendingWrites: 2 });
    assert.deepEqual([two.room, two.roomNext, two.autoNext], [2, 0, 0], '5개 + 요청 2편 = 7/7 → 자동 글은 DB가 거절하니 0');
    const one = L.autoPlan({ posts: five, settings: st, today: T, pendingWrites: 1 });
    assert.deepEqual([one.roomNext, one.autoNext], [1, 1]);
    const many = L.autoPlan({ posts: [], settings: { ...st, backlog_limit: 30 }, today: T, pendingWrites: 9 });
    assert.deepEqual([many.jobs, many.roomNext, many.autoNext], [5, 25, 1], '한 번에 작업 5개까지 — 요청 포함 최대 6편이라 자동은 1편');
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

  test('끝의 숫자가 검색어의 일부일 수 있으면 유입 수로 안 읽음 (없는 숫자를 만들지 않게)', () => {
    const one = (text) => L.parseSearchTerms(text).items.map((x) => [x.term, x.views]);
    // 비율만 있는 줄: 비율 앞 숫자는 검색어의 일부 (아이폰 16)
    assert.deepEqual(one('아이폰 16 12.5%'), [['아이폰 16', null]]);
    assert.deepEqual(one('아이폰 16 12.5%\n갤럭시 s24 10%'), [['아이폰 16', null], ['갤럭시 s24', null]], '비율 앞에 숫자가 있는 줄과 없는 줄이 섞이면 숫자 칸이 아님');
    // 표에서 칸 구분이 사라진 경우: 모든 줄이 '검색어 숫자 비율'이면 그 숫자는 유입 수
    assert.deepEqual(one('원룸 전기요 7 2.1%\n전기요 전자파 5 1.5%'), [['원룸 전기요', 7], ['전기요 전자파', 5]]);
    assert.deepEqual(one('원룸 전기요 7회 2.1%'), [['원룸 전기요', 7]], "'회'가 붙으면 한 줄이어도 유입 수");
    // 점 없는 맨 앞 순위: 여러 줄이 1, 2, 3…처럼 이어질 때만
    assert.deepEqual(one('1 원룸 전기요 12\n2 전기요 전자파 5\n3 3구 인덕션 2'), [['원룸 전기요', 12], ['전기요 전자파', 5], ['3구 인덕션', 2]]);
    assert.deepEqual(one('2026 달력 추천 12'), [['2026 달력 추천', 12]], '연도로 시작하는 검색어는 그대로');
    assert.deepEqual(one('10 평 원룸 난방 4'), [['10 평 원룸 난방', 4]], '한 줄뿐이면 맨 앞 숫자를 순위로 안 봄');
    // 머리글 줄은 칸 구분이 없어도 건너뜀
    assert.deepEqual(one('검색어 유입수 비율\n원룸 전기요 3'), [['원룸 전기요', 3]]);
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
    // 숫자 없이 들어온 검색어: 추천에는 안 쓰고, 원고 화면 알림(unknown)에는 보여줌
    assert.deepEqual(L.titleGaps(posts[0], by.get('a'), 1, { unknown: true }).map((x) => x.term), ['전기요 전자파', '전기요 세탁']);
    // 지운 글(posts 에 없는 글)의 검색어는 새 글 후보로 안 셈 (DB search_terms_top 과 같음)
    assert.deepEqual(L.uncoveredTerms(posts, [...terms, { post_id: 'gone', term: '제습기 전기세', views: 50 }], 5).map((x) => x.term), ['가습기 물때 제거 식초']);
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

  test('켜 둔 다른 채널이 없는 글은 다른 채널 단계에서 뺌 (풀 수 없는 막힘을 만들지 않게)', () => {
    const a = P('published', { published_on: D(-10), channel_id: 'naver_blog' }), b = P('published', { published_on: D(-9), channel_id: 'naver_blog' });
    const only = [{ id: 'naver_blog', active: true }, { id: 'threads', active: false }];
    const f = L.opsFunnel({ posts: [a, b], postChannels: [], metricPostIds: [], channels: only, programs, settings: {}, today: T });
    assert.equal(f.bottleneck.key, 'data', '퍼뜨릴 채널이 없으니 다음 단계(실적)로');
    const sp = f.stages.find((s) => s.key === 'spread');
    assert.deepEqual([sp.count, sp.of, sp.sub, sp.state], [0, 0, '올릴 다른 채널 없음', 'ok']);
    const two = [...only, { id: 'tistory', active: true }];
    assert.equal(L.opsFunnel({ posts: [a, b], postChannels: [], metricPostIds: [], channels: two, programs, settings: {}, today: T }).bottleneck.key, 'spread');
  });

  test('다른 채널 기록·실적을 못 읽었으면(null) 0으로 보지 않고 데이터 없음, 그걸로 막힌 곳을 정하지 않음', () => {
    const a = P('published', { published_on: D(-10) }), b = P('published', { published_on: D(-9) });
    const f = L.opsFunnel({ posts: [a, b], postChannels: null, metricPostIds: null, programs, settings: {}, fixCount: 1, today: T });
    const by = Object.fromEntries(f.stages.map((s) => [s.key, s]));
    assert.deepEqual([by.spread.count, by.spread.sub, by.spread.state], [null, '데이터 없음', 'none']);
    assert.deepEqual([by.data.count, by.data.sub, by.data.state], [null, '데이터 없음', 'none']);
    assert.equal(f.bottleneck.key, 'improve', "'다른 채널로 안 퍼지고 있어'·'실적 0개'라고 잘못 말하지 않음");
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
    // 기록을 못 읽었으면(null) 안 퍼뜨렸다고 하지 않음, 켜 둔 다른 채널이 없으면 추천 안 함
    assert.ok(!L.recommendations({ posts: [a], byPost, postChannels: null, today: T }).some((r) => r.kind === 'spread'));
    assert.ok(!L.recommendations({ posts: [{ ...a, channel_id: 'naver_blog' }], byPost, postChannels: [], channels: [{ id: 'naver_blog', active: true }], today: T }).some((r) => r.kind === 'spread'));
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
      searchTerms: [{ post_id: posts[2].id, created_at: `${D(-1)}T05:00:00` }, { post_id: posts[3].id, created_at: `${D(-8)}T05:00:00` }],
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
    assert.deepEqual([w.partial, w.partialPrev, w.statsMissing], [0, 0, false]);
  });

  test('지운 글의 기록은 안 셈, 못 읽은 기록(null)은 데이터 없음, 서버가 센 실행 수·뺀 실적 줄 수', () => {
    const live = P('published', { created_at: `${D(-10)}T03:00:00`, published_on: D(-2) });
    const w = L.weeklySummary({
      posts: [live], today: T,
      postChannels: [{ post_id: live.id, posted_on: D(-1) }, { post_id: 'deleted', posted_on: D(-1) }],
      searchTerms: null,
      runs: [{ kind: 'auto', ran_at: `${D(-1)}T00:00:00` }], runsAuto7d: 21,
      statsNow: { partial: 2, totals: agg({ views: 50 }), by_post: [{ key: 'deleted', ...agg({ views: 900 }) }, { key: live.id, ...agg({ views: 50 }) }] },
      statsPrev: null,
    });
    const by = Object.fromEntries(w.rows.map((r) => [r.key, [r.now, r.prev]]));
    assert.deepEqual(by.spread, [1, 0], '지운 글을 다른 채널에 올린 기록은 안 셈');
    assert.deepEqual(by.terms, [null, null], '검색어를 못 읽었으면 0이 아니라 데이터 없음');
    assert.deepEqual(by.views, [50, null]);
    assert.deepEqual(w.top.map((x) => x.postId), [live.id], '잘 된 글에도 지운 글은 안 넣음');
    assert.deepEqual([w.ranAuto, w.partial, w.partialPrev, w.statsMissing], [21, 2, 0, false]);
    assert.equal(L.weeklySummary({ posts: [], today: T }).statsMissing, true);
  });
});
