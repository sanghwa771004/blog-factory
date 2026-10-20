// 계산 도구(lib.js) 테스트: 내보내기, 쓰레드 공유, CSV·엑셀 읽기, 실적 정리, 통계, 주제 점수, 추천
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../lib.js';

const fx = (name) => readFileSync(new URL('./fixtures/' + name, import.meta.url));
const PROGRAMS = {
  coupang_partners: { id: 'coupang_partners', name: '쿠팡파트너스', kind: 'affiliate', needs_disclosure: '필요', disclosure_template: '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.' },
  naver_adpost: { id: 'naver_adpost', name: '네이버 애드포스트', kind: 'ads', needs_disclosure: '확인 필요', disclosure_template: '' },
};
const POST = { id: 'p1', keyword: '전기요', titles: ['t'], program_ids: ['coupang_partners'], body: '## 소제목\n문단 <script>x</script>\n[링크: 첫 번째 버튼]\n[링크: 두 번째]\n[링크: 마지막]', threads: '전기요 고를 때 이거 하나만 봐', instagram: '겨울 준비', hashtags: ['전기요', '겨울'] };
const LINKS = [
  { id: 'a', url: 'https://link.coupang.com/a/1', status: '정상', sort: 0 },
  { id: 'b', url: 'https://link.coupang.com/a/2', status: '미확인', sort: 1 },
  { id: 'c', url: 'https://link.coupang.com/a/3', status: '오류', sort: 2 },
];

describe('원고 내보내기', () => {
  test('고지문이 맨 위, 링크 자리마다 차례로 링크, 오류 링크는 빠지고, HTML은 이스케이프', () => {
    const html = L.exportHtml(POST, { links: LINKS, programs: PROGRAMS });
    assert.ok(html.indexOf('쿠팡 파트너스 활동의 일환') < html.indexOf('<h2'), '고지문이 본문보다 먼저');
    assert.ok(!html.includes('<script>'), '본문 HTML은 글자로');
    assert.ok(html.includes('&lt;script&gt;'));
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, ['https://link.coupang.com/a/1', 'https://link.coupang.com/a/2', 'https://link.coupang.com/a/2'], '세 번째 자리는 마지막 정상 링크');
    assert.ok(!html.includes('/a/3'), '오류 링크는 안 씀');
    assert.match(html, /rel="noopener nofollow sponsored"/);
  });
  test('링크가 없으면 버튼 대신 넣을 자리 표시', () => {
    const html = L.exportHtml(POST, { links: [], programs: PROGRAMS });
    assert.match(html, /여기에 제휴 링크 넣기/);
  });
  test('텍스트 내보내기도 고지문이 맨 앞', () => {
    const t = L.exportPlain(POST, { links: LINKS, programs: PROGRAMS });
    assert.ok(t.startsWith('이 포스팅은 쿠팡 파트너스'));
    assert.match(t, /https:\/\/link\.coupang\.com\/a\/1/);
  });
  test('광고형만 있는 글은 고지문 없음', () => {
    const t = L.exportPlain({ ...POST, program_ids: ['naver_adpost'] }, { links: [], programs: PROGRAMS });
    assert.ok(!t.includes('쿠팡'));
  });
});

describe('쓰레드·인스타', () => {
  test('블로그 주소가 있으면 블로그로 보내고 맨 앞에 수익 모델의 고지문', () => {
    const s = L.threadsShare({ ...POST, blog_url: 'https://blog.naver.com/me/1' }, { links: LINKS, programs: PROGRAMS });
    assert.match(s.url, /^https:\/\/www\.threads\.com\/intent\/post\?text=/);
    assert.ok(decodeURIComponent(s.url).includes('&url=https://blog.naver.com/me/1'));
    assert.ok(s.text.startsWith(PROGRAMS.coupang_partners.disclosure_template));
  });
  test('고지문이 이미 들어 있으면 두 번 붙이지 않고, 광고형만 있으면 안 붙임', () => {
    const d = PROGRAMS.coupang_partners.disclosure_template;
    assert.equal(L.withSnsDisclosure(d + '\n본문', POST, PROGRAMS), d + '\n본문');
    assert.equal(L.withSnsDisclosure('본문', { ...POST, program_ids: ['naver_adpost'] }, PROGRAMS), '본문');
    assert.equal(L.withSnsDisclosure('', POST, PROGRAMS), d, '글이 비어도 고지문은 남김');
    assert.equal(L.snsDisclosure({ ...POST, program_ids: ['cpa_x'] }, { cpa_x: { id: 'cpa_x', kind: 'cpa', needs_disclosure: '필요', disclosure_template: '' } }), L.SNS_FALLBACK_DISCLOSURE);
  });
  test('블로그 주소가 없으면 제휴 링크 + 고지문을 맨 앞에', () => {
    const s = L.threadsShare(POST, { links: LINKS, programs: PROGRAMS });
    assert.ok(s.text.startsWith('이 포스팅은 쿠팡 파트너스'));
    assert.ok(decodeURIComponent(s.url).includes('url=https://link.coupang.com/a/1'));
  });
  test('500자 제한 안으로 자름', () => {
    const s = L.threadsShare({ ...POST, threads: '가'.repeat(900), blog_url: 'https://x.com' }, { links: [], programs: PROGRAMS });
    assert.ok(s.text.length <= 480);
  });
  test('인스타 캡션: 제휴 글이면 고지문이 첫 부분 + 해시태그는 끝에', () => {
    const t = L.instagramText(POST, { programs: PROGRAMS });
    assert.ok(t.startsWith(PROGRAMS.coupang_partners.disclosure_template));
    assert.ok(t.endsWith('#전기요 #겨울'));
  });
});

describe('내 경험 채우기', () => {
  test('빈 칸만 차례로 채우고, 비워둔 칸은 그대로', () => {
    const body = '가 [내 경험: 하나] 나 [내 경험: 둘] 다';
    assert.equal(L.fillMe(body, ['첫째', '']), '가 첫째 나 [내 경험: 둘] 다');
    assert.deepEqual(L.meHints(body), ['하나', '둘']);
  });
});

describe('CSV·엑셀 읽기', () => {
  test('EUC-KR CSV, 따옴표 안 쉼표, 쉼표 숫자', () => {
    const t = L.parseCsv(L.decodeBytes(fx('coupang-report-euckr.csv')));
    assert.equal(t[0][0], '날짜');
    assert.equal(t[3][1], '제목, 쉼표 있음');
    assert.equal(t[1][4], '1,530');
  });
  test('엑셀(.xlsx): 제목 줄이 있어도 읽고, 날짜 숫자·여러 날짜 형식', async () => {
    const t = await L.readTable(fx('coupang-report.xlsx'));
    assert.equal(t.kind, 'xlsx');
    assert.equal(t.rows[0][0], '쿠팡 파트너스 실적 리포트');
    assert.deepEqual(t.rows[1].slice(0, 3), ['날짜', '게시물 URL', '클릭수']);
    assert.equal(t.rows.length, 7);
  });
  test('열 이름으로 자동 맞추기', () => {
    const m = L.guessMapping(['날짜', '게시물 URL', '클릭수', '주문수', '취소수', '예상 수익(원)', '확정 수익']);
    assert.deepEqual(m, { date: 0, post_match: 1, clicks: 2, orders: 3, cancels: 4, revenue_est: 5, revenue_confirmed: 6 });
    const m2 = L.guessMapping(['시작일', '종료일', '조회수', '주문금액', '수수료']);
    assert.equal(m2.period_start, 0);
    assert.equal(m2.period_end, 1);
    assert.equal(m2.views, 2);
    assert.equal(m2.orders, undefined, '주문금액은 주문 건수가 아님');
    assert.equal(m2.revenue_est, 4);
  });
  test('숫자·날짜 읽기', () => {
    assert.deepEqual(L.parseNum('1,530원'), { ok: true, value: 1530 });
    assert.deepEqual(L.parseNum('(500)'), { ok: true, value: -500 });
    assert.deepEqual(L.parseNum(''), { ok: true, value: null });
    assert.equal(L.parseNum('abc').ok, false);
    assert.equal(L.parseDateCell('2026.10.02'), '2026-10-02');
    assert.equal(L.parseDateCell('20261003'), '2026-10-03');
    assert.equal(L.parseDateCell('45934'), '2025-10-04');
    assert.equal(L.parseDateCell('2026년 10월 5일'), '2026-10-05');
    assert.equal(L.parseDateCell('모름'), null);
  });
  test('실적 정리: 오류 줄·파일 안 중복·글 못 찾은 줄을 구분, 빈 칸은 null(0 아님)', async () => {
    const t = await L.readTable(fx('coupang-report.xlsx'));
    const header = 1;
    const mapping = L.guessMapping(t.rows[header]);
    const posts = [{ id: 'p1', blog_url: 'https://blog.naver.com/me/1', titles: ['내 글'], keyword: '' }];
    const r = L.normalizeRows(t.rows.slice(header + 1), mapping, { source_label: '쿠팡', resolvePost: L.makePostResolver(posts), firstLine: header + 2 });
    assert.equal(r.ok.length, 4);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].msg, /날짜/);
    assert.equal(r.ok[0].post_id, 'p1');
    assert.equal(r.ok[1].post_id, 'p1', 'm. 주소와 끝 / 도 같은 글로');
    assert.equal(r.ok[1].revenue_confirmed, null, '빈 칸은 데이터 없음');
    assert.equal(r.ok[1].clicks, 8);
    assert.equal(r.ok[2].post_id, null);
    assert.deepEqual(r.unmatched, [5]);
    // CSV: 같은 줄 두 번 → 파일 안 중복 1
    const c = L.parseCsv(L.decodeBytes(fx('coupang-report-euckr.csv')));
    const r2 = L.normalizeRows(c.slice(1), L.guessMapping(c[0]), { resolvePost: L.makePostResolver(posts) });
    assert.equal(r2.dupInFile, 1);
    assert.equal(r2.ok.length, 2);
  });
  test('음수 건수는 오류', () => {
    const r = L.normalizeRows([['2026-10-01', '-3']], { date: 0, clicks: 1 });
    assert.equal(r.errors.length, 1);
  });
});

describe('통계·주제 점수·추천', () => {
  const agg = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? { sum: null, n: 0 } : { sum: v, n: 1 }]));
  test('데이터 없음과 0을 구분', () => {
    assert.equal(L.val(agg({ clicks: 0 }), 'clicks'), 0);
    assert.equal(L.val(agg({ clicks: null }), 'clicks'), null);
    assert.equal(L.ratio(5, 0), null);
    const n = L.netProfit(agg({ revenue_confirmed: 5000, cost: 1000, revenue_est: null }));
    assert.equal(n.confirmed, 4000);
    assert.equal(n.estimated, null);
  });
  test('클릭률·전환율·1,000회당 수익은 분자·분모가 둘 다 있는 글만', () => {
    const r = L.rates([
      { key: 'a', ...agg({ views: 1000, clicks: 20, orders: 1, revenue_est: 3000 }) },
      { key: 'b', ...agg({ views: 500, clicks: null, orders: null, revenue_est: null }) },
    ]);
    assert.equal(r.ctr, 0.02);
    assert.equal(r.ctrPosts, 1);
    assert.equal(r.conversion, 0.05);
    assert.equal(r.rpm, 3000);
  });
  test('주제 점수: 가중치, 빈 항목, 실측 없으면 신뢰도 낮음', () => {
    const s = L.topicScore({ scores: { demand: { score: 4, source: 'AI 추정' }, intent: { score: 2, source: 'AI 추정' } } }, { demand: 2, intent: 1, competition: 0, product_info: 0, differentiation: 0, monetization: 0, effort: 0 });
    assert.equal(s.total, Math.round(((2 * 4 + 1 * 2) / (3 * 5)) * 100));
    assert.match(s.confidence, /낮음/);
    assert.equal(L.topicScore({ scores: {} }, {}).total, null);
  });
  test('추천: 게시 후 7일 넘게 실적 없음, 조회 많고 클릭 적음, 구매 나온 글 후속, 데이터 없을 때 안내', () => {
    const today = '2026-10-21';
    const posts = [
      { id: 'a', stage: 'published', published_on: '2026-10-01', keyword: 'A', category: '겨울' },
      { id: 'b', stage: 'collecting', published_on: '2026-10-01', keyword: 'B', category: '겨울' },
      { id: 'c', stage: 'collecting', published_on: '2026-10-01', keyword: 'C', category: '겨울' },
    ];
    const byPost = [
      { key: 'b', ...agg({ views: 2000, clicks: 2, orders: 0, revenue_est: 0 }) },
      { key: 'c', ...agg({ views: 300, clicks: 30, orders: 2, revenue_est: 5000 }) },
    ];
    const recs = L.recommendations({ posts, byPost, products: [], postProducts: [], today });
    const kinds = recs.map((r) => r.kind);
    assert.ok(kinds.includes('need_metrics'));
    assert.ok(kinds.includes('low_ctr'));
    assert.ok(kinds.includes('follow_up'));
    for (const r of recs) assert.ok(r.reason && r.confidence, '추천마다 근거와 신뢰도');
    const none = L.recommendations({ posts: [posts[0]], byPost: [], products: [], postProducts: [], today });
    assert.ok(none.some((r) => r.kind === 'no_data'));
  });
  test('달 범위', () => {
    assert.deepEqual(L.monthRange(0, '2026-10-21'), { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual(L.monthRange(-1, '2026-01-15'), { from: '2025-12-01', to: '2025-12-31' });
  });
});
