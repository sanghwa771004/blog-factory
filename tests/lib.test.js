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
  test('1.1.2: 고지문이 글 끝·중간에 있으면 맨 앞으로 옮김 (자를 때 잘리지 않게, 한 번만)', () => {
    const d = PROGRAMS.coupang_partners.disclosure_template;
    const t = L.withSnsDisclosure('본문 내용\n\n' + d, POST, PROGRAMS);
    assert.ok(t.startsWith(d));
    assert.equal(t.split(d).length - 1, 1);
    const s = L.threadsShare({ ...POST, threads: '가'.repeat(600) + '\n' + d, blog_url: 'https://x.com' }, { links: [], programs: PROGRAMS });
    assert.ok(s.text.startsWith(d) && s.text.length <= 480, '긴 글을 잘라도 고지문은 남음');
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
  test('파일 안 중복은 모든 칸이 같은 줄만: 안 고른 칸(상품명)이 다르면 다른 주문이라 둘 다 남김', () => {
    const mapping = { date: 0, post_match: 1, orders: 3, revenue_est: 4 }; // 2번 칸(상품명)은 안 고름
    const rows = [
      ['2026-10-01', '내 글', '전기요 A', '1', '500'],
      ['2026-10-01', '내 글', '전기요 B', '1', '500'], // 숫자는 같지만 다른 상품 → 중복 아님
      ['2026-10-01', '내 글', '전기요 A', '1', '500', ''], // 끝의 빈 칸만 다름 → 첫 줄과 같은 줄
    ];
    const r = L.normalizeRows(rows, mapping, {});
    assert.equal(r.ok.length, 2);
    assert.equal(r.dupInFile, 1);
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
    assert.equal(n.costMissing, false);
    const noCost = L.netProfit(agg({ revenue_confirmed: 5000, cost: null }));
    assert.equal(noCost.confirmed, 5000);
    assert.equal(noCost.costMissing, true, '비용을 안 넣었으면 화면에 비용 입력 없음 표시');
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

describe('1.2.0 이미지가 연결된 원고 내보내기', () => {
  const body = '## 보관\n[이미지: 작은 원룸 청소기 보관]\n문단\n[이미지: 줄 전체가 아님] 뒤에 글\n[이미지: 두 번째 자리]\n[이미지: 세 번째 자리]';
  const post = { id: 'p', keyword: '청소기', titles: ['t'], program_ids: [], body };
  const imgs = [
    { url: 'https://oxewhsqmdkiasckvnyua.supabase.co/storage/v1/object/sign/post-images/a.jpg?token=x', alt: '원룸 청소기', label: 'AI 생성', fileName: '청소기-01-blog_body.jpg', caption: '※ AI로 만든 예시 이미지' },
    null,
    { url: 'javascript:alert(1)', alt: 'x', fileName: '청소기-03-blog_body.jpg', caption: '사진: Kim (Pexels)' },
  ];
  test('미리보기: 사진 자리 순서대로 이미지, 안전한 주소만 그림, 연결 없는 자리는 그대로 자리 표시', () => {
    const html = L.viewHtml(post, [], imgs);
    assert.equal((html.match(/<img /g) || []).length, 1, '안전한 주소 하나만 그림');
    assert.match(html, /<figure class="img has"><img src="https:\/\/oxewhsqmdkiasckvnyua\.supabase\.co\/storage[^"]+" alt="원룸 청소기"/);
    assert.match(html, /사진 1 · 작은 원룸 청소기 보관 · AI 생성/);
    assert.match(html, /📷 사진 2 · 두 번째 자리<\/div>/);
    assert.match(html, /📷 사진 3 · 세 번째 자리 · 이미지 연결됨/, '주소가 안전하지 않으면 그림 대신 연결됨 표시');
    assert.ok(!html.includes('javascript:'));
    assert.match(html, /📷 줄 전체가 아님\] 뒤에 글<\/div>/, '줄 전체가 아닌 [이미지]는 번호 없이 (예전 그대로)');
  });
  test('복사용 HTML·텍스트: 내려받은 파일 이름과 캡션(AI 안내·사진 출처)을 그 자리에, 이미지 주소는 넣지 않음', () => {
    const html = L.exportHtml(post, { links: [], programs: {}, images: imgs });
    assert.match(html, /사진 1: 내려받은 「청소기-01-blog_body\.jpg」 파일을 여기에 넣어줘/);
    assert.match(html, /※ AI로 만든 예시 이미지/);
    assert.match(html, /사진 2: 두 번째 자리 \(여기에 사진 넣기\)/);
    assert.match(html, /사진: Kim \(Pexels\)/);
    assert.ok(!html.includes('supabase.co'), '1시간이면 끝나는 서명 주소를 블로그에 넣지 않음');
    const txt = L.exportPlain(post, { links: [], programs: {}, images: imgs });
    assert.match(txt, /\(사진 1: 청소기-01-blog_body\.jpg — 작은 원룸 청소기 보관\)\n※ AI로 만든 예시 이미지/);
    assert.match(txt, /\(사진 2: 두 번째 자리\)/);
    assert.equal(L.exportPlain(post, {}).includes('(사진 1: 작은 원룸 청소기 보관)'), true, '이미지 정보가 없으면 예전처럼');
  });
  test('ZIP: 압축 없이 묶기, 한글 이름, 같은 이름은 번호 붙임 (파이썬 zipfile 로 열어봄)', async () => {
    const { spawnSync } = await import('node:child_process');
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const a = new Uint8Array([1, 2, 3, 4, 5]), b = new TextEncoder().encode('안녕 zip');
    const zip = L.makeZip([{ name: '청소기-01.jpg', bytes: a }, { name: '청소기-01.jpg', bytes: b }, { name: 'x/../y.png', bytes: a }], new Date(2026, 9, 22, 10, 30, 0));
    assert.equal(L.crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'CRC32 표준 값');
    const f = join(mkdtempSync(join(tmpdir(), 'gf-zip-')), 't.zip');
    writeFileSync(f, zip);
    const r = spawnSync('python3', ['-c', 'import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([z.testzip(),z.namelist(),[list(z.read(n)) for n in z.namelist()]]))', f], { encoding: 'utf8' });
    if (r.error) return; // 파이썬이 없는 컴퓨터면 건너뜀
    const [bad, names, data] = JSON.parse(r.stdout);
    assert.equal(bad, null);
    assert.deepEqual(names, ['청소기-01.jpg', '청소기-01-2.jpg', 'x-..-y.png']);
    assert.deepEqual(data[0], [1, 2, 3, 4, 5]);
    assert.equal(new TextDecoder().decode(new Uint8Array(data[1])), '안녕 zip');
  });
  test('미리보기 이미지 주소 검사', () => {
    assert.equal(L.safeImgUrl('https://x.supabase.co/a.jpg'), 'https://x.supabase.co/a.jpg');
    assert.equal(L.safeImgUrl('blob:https://app/1234'), 'blob:https://app/1234');
    assert.equal(L.safeImgUrl('javascript:alert(1)'), '');
    assert.equal(L.safeImgUrl('data:image/svg+xml,<svg onload=alert(1)>'), '');
    assert.equal(L.safeImgUrl('http://evil.example/a.jpg'), '');
    assert.equal(L.safeImgUrl('https://a.jpg" onerror="x'), '');
    assert.equal(L.safeImgUrl('//evil.example/x.png'), '', '//로 시작하는 다른 곳 주소는 막음');
    assert.equal(L.safeImgUrl('/\\evil.example/x.png'), '', '/\\ 도 브라우저는 다른 곳 주소로 읽음 (검증 N16)');
    assert.equal(L.safeImgUrl('https://x.supabase.co/a\\b.jpg'), '', '역슬래시가 섞인 주소는 안 씀');
    assert.equal(L.safeImgUrl('/fixtures/a.jpg'), '/fixtures/a.jpg');
    assert.equal(L.safeImgUrl('http://127.0.0.1:8000/a.jpg'), '', '시험용 주소는 그 기기에서 열 때만');
    // ZIP 안 파일 이름은 겹치지 않게 (이미 -2 가 있으면 그다음 번호)
    const u = L.uniqueNames(['a.jpg', 'a.jpg', 'a-2.jpg', 'A.JPG']);
    assert.equal(new Set(u.map((x) => x.toLowerCase())).size, 4, u.join(','));
  });
});

describe('검색 노출 도우미 (1.3.0)', () => {
  test('시즌 달력: 2주 뒤·4주 뒤 달의 주제 (같은 달이면 한 번만)', () => {
    const a = L.seasonAhead('2026-10-25');
    assert.deepEqual(a.months, [11]);
    assert.deepEqual(a.themes, L.SEASON_CALENDAR[11]);
    const b = L.seasonAhead('2026-10-10');
    assert.deepEqual(b.months, [10, 11]);
    assert.equal(new Set(b.themes).size, b.themes.length, '겹치는 주제는 한 번만');
    assert.ok(b.themes.includes('김장 준비') && b.themes.includes('결로·외풍 막기'));
    assert.deepEqual(L.seasonAhead('2026-12-20').months, [1], '해가 바뀌어도');
    for (let m = 1; m <= 12; m++) assert.ok(L.SEASON_CALENDAR[m].length >= 3, m + '월');
  });
  test('주력 주제 비율: 게시를 마친 글만 (초안·지운 글·실패한 글 빼고), 키워드·제목으로 판정', () => {
    const F = '계절템·겨울 가전';
    const posts = [
      { keyword: '겨울 전기요 고르는 법', created_at: '2026-10-20', stage: 'review' },                       // 초안 — 안 셈
      { keyword: '겨울 온수매트 소음', created_at: '2026-10-19', stage: 'ready', publish_date: '2026-10-21' },  // 발행 준비 — 안 셈
      { keyword: '겨울 가습기 세척', created_at: '2026-10-18', stage: 'published', published_on: '2026-10-19' },
      { keyword: '노트북 배터리', created_at: '2026-10-17', stage: 'collecting', published_on: '2026-10-18' },
      { keyword: '겨울 히터 전기세', created_at: '2026-10-16', stage: 'failed' },
      { keyword: '겨울 결로', created_at: '2026-10-15', stage: 'published', deleted_at: '2026-10-17' },
      { keyword: '스마트폰 케이스', category: F, created_at: '2026-01-01', stage: 'analyzed', published_on: '2026-01-02' }, // 카테고리만 같음 — 주제 글로 안 셈
    ];
    const r = L.focusShare(posts, F);
    assert.deepEqual([r.total, r.hit, r.unclear, r.off], [3, 1, 0, 2], '게시한 3개 중 1개 (초안 2개·실패·지운 글은 안 셈)');
    assert.equal(r.ratio, 1 / 3);
    assert.equal(r.goal, 0.7);
    assert.deepEqual(L.focusShare(posts, F, 1), { total: 1, hit: 1, unclear: 0, off: 0, ratio: 1, goal: 0.7 }, '최근 1개만 (게시일 순)');
    const m = L.focusShare(posts, F, 30, (p) => /배터리/.test(p.keyword));
    assert.equal(m.hit, 1, '판정 방법을 넘길 수 있음 (true/false 도 됨)');
    assert.equal(L.focusShare(posts, F, 30, null, { terms: '스마트폰' }).hit, 2, '주력 주제 낱말을 더하면 키워드로 확인');
    assert.equal(L.focusShare(posts, F, 30, null, { channels: ['tistory'] }).total, 0, '채널을 나눠서 셀 수 있음 (채널 없는 글은 안 셈)');
  });
  test('회귀: 미발행 원고만 있으면 비율에 안 들어가고 데이터 없음(null) — 0%가 아님', () => {
    const drafts = [
      { keyword: '겨울 전기요', stage: 'review', created_at: '2026-10-20' },
      { keyword: '겨울 히터', stage: 'ready', publish_date: '2026-10-21', created_at: '2026-10-19' },
      { keyword: '겨울 가습기', stage: 'scheduled', publish_date: '2026-10-22', created_at: '2026-10-18' },
      { keyword: '겨울 결로', stage: 'queued', created_at: '2026-10-17' },
    ];
    const r = L.focusShare(drafts, '겨울 가전');
    assert.equal(r.total, 0);
    assert.equal(r.ratio, null, '게시한 글이 없으면 데이터 없음');
    assert.deepEqual(L.focusShare([], '겨울 가전').ratio, null);
  });
  test('최근 순서: 게시일 → 없으면 예정 발행일 → 그것도 없으면 만든 날', () => {
    assert.equal(L.postedOn({ published_on: '2026-10-20', publish_date: '2026-10-01', created_at: '2026-09-01T00:00:00Z' }), '2026-10-20');
    assert.equal(L.postedOn({ publish_date: '2026-10-01', created_at: '2026-09-01T00:00:00Z' }), '2026-10-01');
    assert.equal(L.postedOn({ created_at: '2026-09-01T00:00:00Z' }), '2026-09-01');
    const posts = [
      { keyword: '겨울 a', stage: 'published', created_at: '2026-10-25T00:00:00Z' },                       // 날짜는 만든 날뿐
      { keyword: 'b', stage: 'published', published_on: '2026-10-24', created_at: '2026-09-01T00:00:00Z' },
    ];
    assert.equal(L.focusShare(posts, '겨울', 1).hit, 1, '만든 날(10/25)이 게시일(10/24)보다 최근');
  });
  test('내 하루 발행 설정보다 많이 잡힌 날 (지난 7일~다음 7일, 발행 준비·예약·게시만)', () => {
    const t = '2026-10-25';
    const posts = [
      { stage: 'ready', publish_date: '2026-10-27' },
      { stage: 'scheduled', publish_date: '2026-10-27' },
      { stage: 'review', publish_date: '2026-10-27' },
      { stage: 'published', published_on: '2026-10-22', publish_date: '2026-10-21' },
      { stage: 'published', published_on: '2026-10-22' },
      { stage: 'published', published_on: '2026-10-22', deleted_at: '2026-10-23' },
      { stage: 'scheduled', publish_date: '2026-11-10' },
      { stage: 'scheduled', publish_date: '2026-11-10' },
      { stage: 'ready', publish_date: '2026-10-26' },
    ];
    assert.deepEqual(L.crowdedDays(posts, t), [{ day: '2026-10-22', n: 2 }, { day: '2026-10-27', n: 2 }], '기본(하루 1편)');
    assert.deepEqual(L.crowdedDays(posts, t, 2), [], '하루 2편을 고른 사람에게 2편인 날은 몰린 날이 아님');
    assert.deepEqual(L.crowdedDays([...posts, { stage: 'ready', publish_date: '2026-10-27' }], t, 2), [{ day: '2026-10-27', n: 3 }]);
    assert.deepEqual(L.crowdedDays([], t), []);
  });
  test('자동 작가 계획: 하루 발행 설정 그대로 목표를 잡고, 잡힌 원고와 새로 쓸 예정을 나눠서 셈', () => {
    const t = '2026-10-26';
    const posts = [
      { stage: 'review', publish_date: '2026-10-27' }, { stage: 'ready', publish_date: '2026-10-28' },
      { stage: 'queued', publish_date: '2026-10-29' },        // 아직 안 쓴 요청 — 자동 작가 기준(upcoming)과 같이 안 셈
      { stage: 'failed', publish_date: '2026-10-30' }, { stage: 'review', publish_date: '2026-10-31', deleted_at: '2026-10-26' },
      { stage: 'review', publish_date: '2026-10-26' },        // 오늘 — 내일부터 셈
      { stage: 'review', publish_date: '2026-11-02' }, { stage: 'review', publish_date: '2026-11-03' }, // 7일 뒤까지만
    ];
    const one = L.autoPlan({ posts, settings: { per_day: 1, auto_topics: '겨울 가전' }, today: t });
    assert.deepEqual([one.perDay, one.goal, one.scheduled, one.gap, one.autoNext, one.differs], [1, 7, 3, 4, 4, false]);
    const two = L.autoPlan({ posts, settings: { per_day: 2, focus_topic: '겨울 가전' }, today: t, pendingWrites: 3 });
    assert.deepEqual([two.perDay, two.goal, two.gap, two.autoNext, two.differs, two.recommended], [2, 14, 11, 3, true, 1], '고른 값(2편) 그대로 · 요청 3편 먼저라 자동은 최대 3편');
    assert.equal(L.autoPlan({ posts, settings: { per_day: 3, auto_topics: 'x', auto_enabled: false }, today: t }).autoNext, 0, '자동 채우기 꺼짐');
    assert.equal(L.autoPlan({ posts, settings: { per_day: 1 }, today: t }).enabled, false, '주제가 없으면 자동 글 없음');
    assert.equal(L.autoPlan({ posts: [], settings: {}, today: t }).perDay, 1, '기본은 하루 1편');
    assert.deepEqual(L.AUTO_RULES, { days: 7, maxAutoPerRun: 4, maxPerRun: 6, maxJobsPerRun: 5 });
  });
});
