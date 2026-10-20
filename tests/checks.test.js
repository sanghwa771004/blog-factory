// 발행 전 검사(checks.js) 테스트 — 앱과 서버가 같은 파일을 씀
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkPost, disclosureFor, compatOf, parseBody, countMe, removeEmptyMe, similarity, CONTENT_TYPES } from '../checks.js';

const PROGRAMS = {
  coupang_partners: { id: 'coupang_partners', name: '쿠팡파트너스', kind: 'affiliate', needs_link: true, needs_disclosure: '필요', disclosure_template: '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.', my_status: '사용 중' },
  toss_sharelink: { id: 'toss_sharelink', name: '토스쇼핑 쉐어링크', kind: 'affiliate', needs_link: true, needs_disclosure: '필요', disclosure_template: '이 콘텐츠는 토스쇼핑 쉐어링크 활동의 일환으로, 링크를 통한 구매가 발생하면 일정 수수료를 지급받습니다.', my_status: '미가입' },
  naver_shopping_connect: { id: 'naver_shopping_connect', name: '네이버 쇼핑 커넥트', kind: 'affiliate', needs_link: true, needs_disclosure: '필요', disclosure_template: '', my_status: '미가입' },
  naver_adpost: { id: 'naver_adpost', name: '네이버 애드포스트', kind: 'ads', needs_link: false, needs_disclosure: '확인 필요', disclosure_template: '', my_status: '사용 중' },
  google_adsense: { id: 'google_adsense', name: 'Google 애드센스', kind: 'ads', needs_link: false, needs_disclosure: '확인 필요', disclosure_template: '', my_status: '미가입' },
};
const CHANNELS = {
  naver_blog: { id: 'naver_blog', name: '네이버 블로그', kind: 'blog', clickable_links: true },
  tistory: { id: 'tistory', name: '티스토리', kind: 'blog', clickable_links: true },
  threads: { id: 'threads', name: '쓰레드', kind: 'sns', max_chars: 500, clickable_links: true },
  instagram: { id: 'instagram', name: '인스타그램', kind: 'sns', max_chars: 2200, clickable_links: false },
};
const COMPAT = [
  { program_id: 'coupang_partners', channel_id: 'naver_blog', verdict: '확인 필요', reason: '' },
  { program_id: 'coupang_partners', channel_id: 'tistory', verdict: '확인 필요', reason: '' },
  { program_id: 'google_adsense', channel_id: 'tistory', verdict: '가능', reason: '' },
  { program_id: 'google_adsense', channel_id: 'threads', verdict: '불가', reason: 'HTML 사이트만' },
  { program_id: 'naver_adpost', channel_id: 'naver_blog', verdict: '가능', reason: '' },
];
const TODAY = '2026-10-21';
const BODY = ['## 원룸 전기요 고르는 기준', '원룸 전기요는 크기와 온도 조절 단계를 먼저 봐야 해요. 전자파 인증 표시도 확인하세요.',
  '- 크기가 침대와 맞는지', '- 온도 조절이 여러 단계인지', '## 전기요 관리', '세탁 가능한지 라벨을 확인하세요. 접어서 보관하면 열선이 상할 수 있어요.',
  '원룸 전기요를 고를 때는 내 생활 패턴을 먼저 떠올려 보세요. 잘 때만 쓰는지, 낮에도 쓰는지에 따라 맞는 제품이 달라요.'].join('\n');
const base = (o = {}) => ({ id: 'p1', keyword: '원룸 전기요', titles: ['원룸 전기요 고르는 법'], body: BODY, channel_id: 'naver_blog', program_ids: ['coupang_partners'], content_type: 'buying_guide', experience: '', sources: [], variants: {}, ...o });
const ctx = (o = {}) => ({ programs: PROGRAMS, channels: CHANNELS, compat: COMPAT, links: [], products: [], today: TODAY, ...o });
const codes = (r) => ({ e: r.errors.map((x) => x.code), w: r.warnings.map((x) => x.code), t: r.tips.map((x) => x.code) });
const LINK = { id: 'l1', post_id: 'p1', url: 'https://link.coupang.com/a/abc', status: '정상', sort: 0 };

describe('호환성·필수 항목', () => {
  test('쓸 수 없는 조합(애드센스 × 쓰레드)은 오류', () => {
    const r = checkPost(base({ channel_id: 'threads', program_ids: ['google_adsense'], body: '짧은 SNS 글이야. 겨울엔 이것만 챙겨.' }), ctx());
    assert.ok(codes(r).e.includes('combo_blocked'));
  });
  test('확인 안 된 조합은 경고만 (발행은 가능)', () => {
    const r = checkPost(base({ body: BODY + '\n[링크: 최저가 보기]' }), ctx({ links: [LINK] }));
    assert.ok(codes(r).w.includes('combo_unknown'));
    assert.ok(!codes(r).e.includes('combo_blocked'));
  });
  test('제목·본문 없음은 오류', () => {
    const r = checkPost(base({ titles: [], body: '' }), ctx());
    assert.ok(codes(r).e.includes('no_title'));
    assert.ok(codes(r).e.includes('no_body'));
  });
});

describe('제휴 링크·고지문', () => {
  test('링크 자리가 있는데 제휴 링크가 없으면 오류', () => {
    const r = checkPost(base({ body: BODY + '\n[링크: 최저가 보기]' }), ctx());
    assert.ok(codes(r).e.includes('link_missing'));
  });
  test('링크를 넣으면 통과, 오류 표시 링크는 오류', () => {
    assert.ok(!codes(checkPost(base({ body: BODY + '\n[링크: 최저가 보기]' }), ctx({ links: [LINK] }))).e.includes('link_missing'));
    const r = checkPost(base({ body: BODY + '\n[링크: 최저가 보기]' }), ctx({ links: [{ ...LINK, status: '오류' }] }));
    assert.ok(codes(r).e.includes('link_error'));
  });
  test('공식 고지문이 비어 있는 제휴 프로그램(쇼핑 커넥트)은 오류', () => {
    const r = checkPost(base({ program_ids: ['naver_shopping_connect'], body: BODY + '\n[링크: 보기]' }), ctx({ links: [LINK] }));
    assert.ok(codes(r).e.includes('disclosure_missing'));
  });
  test('다른 프로그램 고지문이 본문에 있으면 오류 (쿠팡 글에 토스 문구)', () => {
    const r = checkPost(base({ body: BODY + '\n' + PROGRAMS.toss_sharelink.disclosure_template }), ctx());
    assert.ok(codes(r).e.includes('wrong_disclosure'));
  });
  test('고지문은 프로그램마다 다른 문구를 쓰고, 겹치면 한 번만', () => {
    const d = disclosureFor(['coupang_partners', 'toss_sharelink', 'coupang_partners'], PROGRAMS);
    assert.equal(d.text.split('\n').length, 2);
    assert.match(d.text, /쿠팡 파트너스/);
    assert.match(d.text, /쉐어링크/);
    const ads = disclosureFor(['naver_adpost'], PROGRAMS);
    assert.equal(ads.text, '');
    assert.equal(ads.unknown.length, 1);
  });
  test('SNS 버전: 고지문이 있는 프로그램이면 앱이 복사할 때 붙이니 경고 없음, 고지문이 없으면 첫 줄 표시를 확인', () => {
    const noMark = { threads: '겨울 전기요 이거 하나면 끝\n자세한 건 블로그에' };
    assert.ok(!codes(checkPost(base({ variants: noMark }), ctx())).w.includes('variant_disclosure'), '쿠팡은 고지문이 있어서 복사할 때 자동으로 붙음');
    const r = checkPost(base({ program_ids: ['naver_shopping_connect'], variants: noMark }), ctx());
    assert.ok(codes(r).w.includes('variant_disclosure'));
    const ok = checkPost(base({ program_ids: ['naver_shopping_connect'], variants: { threads: '#광고 겨울 전기요 이거 하나면 끝' } }), ctx());
    assert.ok(!codes(ok).w.includes('variant_disclosure'));
  });
  test("'받을 수 있음' 같은 애매한 고지문은 오류 (공정위 지침)", () => {
    const vague = { ...PROGRAMS, coupang_partners: { ...PROGRAMS.coupang_partners, disclosure_template: '이 글에는 쿠팡 파트너스 링크가 있어 소정의 수수료를 지급받을 수 있음' } };
    assert.ok(codes(checkPost(base(), ctx({ programs: vague }))).e.includes('disclosure_vague'));
    assert.ok(!codes(checkPost(base(), ctx())).e.includes('disclosure_vague'), '공식 문구(제공받습니다)는 통과');
  });
  test('쿠팡 상품 주소를 그대로 넣은 링크는 경고 (수익 집계 안 됨)', () => {
    const plain = { ...LINK, url: 'https://www.coupang.com/vp/products/12345' };
    const r = checkPost(base({ body: BODY + '\n[링크: 보기]' }), ctx({ links: [plain] }));
    assert.ok(codes(r).w.includes('coupang_plain_url'));
    assert.ok(!codes(checkPost(base({ body: BODY + '\n[링크: 보기]' }), ctx({ links: [LINK] }))).w.includes('coupang_plain_url'));
  });
  test('인스타그램은 본문 링크가 안 눌린다고 경고', () => {
    const r = checkPost(base({ channel_id: 'instagram', content_type: 'sns_short', body: '겨울 전기요 고르는 법 정리했어. 크기, 온도 단계, 세탁.' }), ctx({ links: [LINK] }));
    assert.ok(codes(r).w.includes('channel_links_dead'));
  });
});

describe('미완성·경험·사실', () => {
  test('빈 [내 경험] 칸은 오류, 지우기로 해결', () => {
    const body = BODY + '\n[내 경험: 써본 느낌]';
    const r = checkPost(base({ body }), ctx());
    assert.ok(codes(r).e.includes('placeholder_experience'));
    assert.equal(countMe(removeEmptyMe(body)), 0);
    assert.ok(!codes(checkPost(base({ body: removeEmptyMe(body) }), ctx())).e.includes('placeholder_experience'));
  });
  test('실제 경험 후기인데 경험이 없으면 오류, 경험을 넣으면 통과', () => {
    assert.ok(codes(checkPost(base({ content_type: 'experience_review' }), ctx())).e.includes('needs_experience'));
    assert.ok(!codes(checkPost(base({ content_type: 'experience_review', experience: '6평 원룸에서 2주 씀' }), ctx())).e.includes('needs_experience'));
  });
  test('정보 글은 경험이 없어도 막지 않음', () => {
    const r = checkPost(base({ content_type: 'problem_solving' }), ctx());
    assert.ok(!codes(r).e.includes('needs_experience'));
  });
  test('써본 척하는 문장은 경험이 없으면 오류', () => {
    const r = checkPost(base({ body: BODY + '\n제가 한 달 동안 써보니 정말 따뜻했어요.' }), ctx());
    assert.ok(codes(r).e.includes('fake_experience'));
    const others = checkPost(base({ body: BODY + '\n후기를 보면 사람들이 써보니 따뜻하다고 해요.' }), ctx());
    assert.ok(!codes(others).e.includes('fake_experience'), '남의 후기를 전하는 문장은 괜찮음');
  });
  test('정확한 가격은 7일 안에 확인한 상품 가격이 없으면 오류, 가격대는 경고', () => {
    const r = checkPost(base({ body: BODY + '\n이 제품은 39,900원이에요.' }), ctx());
    assert.ok(codes(r).e.includes('price_unverified'));
    const fresh = checkPost(base({ body: BODY + '\n이 제품은 39,900원이에요.' }), ctx({ products: [{ name: 'A', price: 39900, price_checked_at: '2026-10-19', trust: '확인 완료' }] }));
    assert.ok(!codes(fresh).e.includes('price_unverified'));
    const range = checkPost(base({ body: BODY + '\n3만원대 제품이 많아요.' }), ctx());
    assert.ok(codes(range).w.includes('price_range'));
    assert.ok(!codes(range).e.includes('price_unverified'));
  });
  test('숫자 주장에 출처가 없으면 경고, 최신 정보 요약은 출처 필수(오류)', () => {
    const r = checkPost(base({ body: BODY + '\n소비전력은 보통 100W 안팎이에요.' }), ctx());
    assert.ok(codes(r).w.includes('sources_missing'));
    assert.ok(codes(checkPost(base({ content_type: 'news_summary' }), ctx())).e.includes('news_no_sources'));
  });
  test("본문의 '확인 필요'는 미완성으로 경고", () => {
    const r = checkPost(base({ body: BODY + '\n| 항목 | A |\n|---|---|\n| 가격 | 확인 필요 |' }), ctx());
    assert.ok(codes(r).w.includes('table_unfilled'));
  });
  test('과장 표현, 반복 문장 경고', () => {
    const s = '원룸 전기요는 크기와 온도 조절 단계를 먼저 봐야 해요.';
    const r = checkPost(base({ body: BODY + '\n무조건 이걸 사세요.\n' + s }), ctx());
    assert.ok(codes(r).w.includes('hype'));
    assert.ok(codes(r).w.includes('duplicate_sentences'));
  });
  test('비슷한 다른 글이 있으면 경고', () => {
    const r = checkPost(base(), ctx({ others: [{ id: 'p2', title: '다른 글', body: BODY }] }));
    assert.ok(codes(r).w.includes('similar_post'));
    assert.ok(similarity('가나다라마바사', '완전히다른문장이야') < 0.2);
  });
  test('상품 비교 글은 상품이 2개 미만이면 경고, 출처 없는 상품도 경고', () => {
    const r = checkPost(base({ content_type: 'comparison' }), ctx({ products: [{ name: 'A', trust: '미검증' }] }));
    assert.ok(codes(r).w.includes('products_missing'));
    assert.ok(codes(r).w.includes('product_unverified'));
  });
  test('쓰레드 글자 수 제한(500자)을 넘으면 오류', () => {
    const r = checkPost(base({ channel_id: 'threads', program_ids: [], content_type: 'sns_short', body: '가'.repeat(501) }), ctx());
    assert.ok(codes(r).e.includes('channel_too_long'));
  });
  test('깨끗한 정보 글(링크·고지 갖춤)은 오류 0개', () => {
    const r = checkPost(base({ body: BODY + '\n[링크: 최저가 보기]' }), ctx({ links: [LINK] }));
    assert.deepEqual(r.errors, []);
  });
});

describe('본문 형식', () => {
  test('소제목·목록·표·사진·링크 자리를 나눠 읽음', () => {
    const b = parseBody('## 제목\n문단\n- 하나\n- 둘\n| a | b |\n|---|---|\n| 1 | 2 |\n[이미지: 사진]\n[링크: 보기]');
    assert.deepEqual(b.map((x) => x.t), ['h', 'p', 'ul', 'table', 'img', 'cta']);
    assert.equal(b[3].rows.length, 2);
    assert.equal(b[5].text, '보기');
  });
  test('번호 붙은 링크 자리([링크2: …])도 버튼 글자만 남김', () => {
    const b = parseBody('[링크2: 두 번째 상품 보기]\n[링크 3:세 번째]\n[링크]');
    assert.deepEqual(b.map((x) => x.text), ['두 번째 상품 보기', '세 번째', '']);
  });
  test('compatOf: 표에 없으면 확인 필요', () => {
    assert.equal(compatOf('x', 'y', COMPAT).verdict, '확인 필요');
    assert.equal(compatOf('google_adsense', 'threads', COMPAT).verdict, '불가');
  });
  test('글 유형 11가지', () => {
    assert.equal(Object.keys(CONTENT_TYPES).length, 11);
  });
});
