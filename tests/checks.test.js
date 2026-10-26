// 발행 전 검사(checks.js) 테스트 — 앱과 서버가 같은 파일을 씀
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkPost, disclosureFor, compatOf, parseBody, countMe, removeEmptyMe, similarity, CONTENT_TYPES, VAGUE_DISCLOSURE, isFakeExperience, focusMatch, focusFit, focusTerms, keywordWords, linkTooEarly, SEO_RULES, canBeReady } from '../checks.js';

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
  test('1.1.2: 애매한 고지 표현을 더 넓게 잡음 (지급될·발생할 수 있습니다, 띄어쓰기 달라도)', () => {
    for (const t of ['수수료가 지급될 수 있습니다', '수수료가 발생할 수 있습니다', '수수료를 받을 수 도 있어요', '수수료를 받을수도있어요', '소정의 수수료가 생길 수 있음']) {
      assert.ok(VAGUE_DISCLOSURE.test(t), t);
    }
    for (const t of [PROGRAMS.coupang_partners.disclosure_template, PROGRAMS.toss_sharelink.disclosure_template]) assert.ok(!VAGUE_DISCLOSURE.test(t), '공식 문구는 통과: ' + t);
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
  test('1.1.2: 안내·조건 문장은 써본 척이 아님 (정보 글을 막지 않음), 1인칭·겪은 일 표현이면 그대로 오류', () => {
    for (const s of ['매장에서 직접 사용해 보면서 소음을 비교해 보세요.', '일주일 사용 중 고장이 나면 교환을 요청하세요.', '직접 써보면서 무게를 확인해 보는 게 좋아요.']) {
      assert.ok(!isFakeExperience(s), s);
      assert.ok(!codes(checkPost(base({ body: BODY + '\n' + s }), ctx())).e.includes('fake_experience'), s);
    }
    for (const s of ['제가 한 달 동안 써보니 따뜻했어요.', '한 달 동안 써보니 좋았는데, 이런 경우 고려해 보세요.', '저는 직접 사용해 보면서 비교해 보라고 권해요.']) {
      assert.ok(isFakeExperience(s), s);
    }
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

describe('검색 노출 점검 (1.3.0 → 1.3.1) — 앱의 권장 기준이라 막지 않고 알려만 줌', () => {
  const SEO_W = ['off_focus', 'focus_unclear', 'too_many_links', 'link_too_early', 'no_own_experience'];
  const SEO_T = ['short_keyword', 'focus_match'];
  const seo = (r) => [...codes(r).w.filter((c) => SEO_W.includes(c)), ...codes(r).t.filter((c) => SEO_T.includes(c))];
  const LONG_KW = '원룸 전기요 고르는 법';
  const FOCUS = '계절템·겨울 가전';
  test('키워드가 1~2단어면 참고로만 알려줌 (경쟁도는 조회 안 했다고 밝힘), 3단어 이상이면 없음', () => {
    assert.ok(seo(checkPost(base({ keyword: '전기요' }), ctx())).includes('short_keyword'));
    assert.ok(seo(checkPost(base({ keyword: '원룸 전기요' }), ctx())).includes('short_keyword'));
    assert.ok(!seo(checkPost(base({ keyword: LONG_KW }), ctx())).includes('short_keyword'));
    const tip = checkPost(base({ keyword: '전기요' }), ctx()).tips.find((t) => t.code === 'short_keyword');
    assert.match(tip.msg, /1단어/);
    assert.match(tip.msg, /조회하지 않았어/, '짧다는 이유만으로 경쟁이 높다고 단정하지 않음');
    assert.doesNotMatch(tip.msg, /묻히/);
    assert.ok(!checkPost(base({ keyword: '전기요' }), ctx()).warnings.some((w) => w.code === 'short_keyword'), '경고가 아니라 참고');
    assert.equal(keywordWords('  원룸   겨울 결로 제습기 '), 4);
    assert.equal(keywordWords(''), 0);
    assert.equal(SEO_RULES.minKeywordWords, 3);
  });
  test('회귀: 주제와 무관한 글이 카테고리만 주력 주제로 적혀 있으면 통과하지 않음', () => {
    const job = base({ keyword: '20대 직업 고민 정리', titles: ['20대 직업 고민 정리하는 법'], category: FOCUS,
      body: '## 직업 고민이 생길 때\n회사를 옮길지 고민될 때 먼저 적어볼 것들이에요. 하고 싶은 일과 잘하는 일을 나눠 적어요.\n## 정리하는 순서\n- 지금 일에서 좋은 점\n- 바꾸고 싶은 점\n하나씩 적다 보면 다음 할 일이 보여요. 너무 서두르지 말고 한 주 정도 메모해 보세요. 주변 사람 이야기도 들어 보면 좋아요.' });
    const r = checkPost(job, ctx({ focus: FOCUS }));
    assert.ok(seo(r).includes('off_focus'), '카테고리만 같으면 주력 주제 밖');
    assert.ok(!seo(r).includes('focus_match'));
    const w = r.warnings.find((x) => x.code === 'off_focus');
    assert.match(w.msg, /근거:.*카테고리만 주력 주제와 같고/, '근거를 보여줌');
    const f = focusFit(job, FOCUS);
    assert.equal(f.verdict, 'off');
  });
  test('주력 주제 판정: 키워드·제목이 주된 근거, 소제목·본문만 있으면 판단 어려움, 근거를 같이 보여줌', () => {
    const m = checkPost(base({ keyword: '겨울 원룸 전기요 고르는 법', category: '' }), ctx({ focus: FOCUS }));
    assert.ok(seo(m).includes('focus_match') && !seo(m).includes('off_focus') && !seo(m).includes('focus_unclear'));
    assert.match(m.tips.find((t) => t.code === 'focus_match').msg, /근거: 키워드에 '겨울'/);
    const t = focusFit(base({ keyword: LONG_KW, titles: ['겨울에 쓰는 원룸 전기요 고르는 법'] }), FOCUS);
    assert.equal(t.verdict, 'match');
    assert.ok(t.evidence.some((e) => e.startsWith('제목에')));
    // 키워드·제목엔 없고 본문에만 있음 → 판단 어려움 (무조건 통과시키지 않음)
    const body = BODY + '\n겨울에는 전기요를 오래 켜 두니까 가전 안전 표시도 봐 주세요.';
    const u = checkPost(base({ keyword: LONG_KW, category: FOCUS, body }), ctx({ focus: FOCUS }));
    assert.ok(seo(u).includes('focus_unclear'));
    assert.match(u.warnings.find((x) => x.code === 'focus_unclear').msg, /판단하기 어려워 — 근거: .*본문에 '겨울', '가전'.*키워드·제목에는 주제 낱말이 없음/);
    assert.equal(focusFit(base({ keyword: LONG_KW, body }), FOCUS).label, '판단 어려움');
    // 주력 주제 낱말(설정)을 더하면 키워드로 확인됨
    assert.equal(focusFit(base({ keyword: LONG_KW }), FOCUS, '전기요, 온수매트').verdict, 'match');
    assert.ok(seo(checkPost(base({ keyword: LONG_KW }), ctx({ focus: FOCUS, focusTerms: '전기요' }))).includes('focus_match'));
    // 어디에도 없으면 주력 주제 밖
    assert.ok(seo(checkPost(base({ keyword: '디지털 카메라 메모리 카드 고르는 법', titles: ['메모리 카드 고르는 법'], category: '디지털·전자기기' }), ctx({ focus: FOCUS }))).includes('off_focus'));
    // 주력 주제를 안 정했으면 검사 안 함
    assert.deepEqual(seo(checkPost(base({ keyword: LONG_KW, category: '디지털·전자기기' }), ctx())).filter((c) => c.includes('focus')), []);
    assert.equal(focusFit(base({}), '').verdict, 'none');
  });
  test('주력 주제 낱말: 주제를 나눈 낱말 + 설정 낱말, 띄어쓰기가 달라도 찾음', () => {
    assert.deepEqual(focusTerms(FOCUS, '전기요, 온수매트,  , 히'), ['계절템', '겨울', '가전', '전기요', '온수매트']);
    assert.equal(focusFit({ keyword: '전기장판 고르기' }, '겨울', '전기 장판').verdict, 'match');
    assert.equal(focusFit({ keyword: '추가 전기 요금' }, '가전').verdict, 'off', "두 글자 낱말은 띄어쓰기를 넘어서 찾지 않음 ('추가 전기' ≠ '가전')");
  });
  test('focusMatch(카테고리 이름끼리): 같은 말·포함·낱말 겹침·낱말 앞부분이 같으면 맞음 — 약한 근거로만 씀', () => {
    assert.equal(focusMatch('아무거나', ''), true, '주력 주제가 없으면 다 맞음');
    assert.equal(focusMatch('', '겨울 가전'), false);
    assert.equal(focusMatch('겨울 가전', '계절템·겨울 가전'), true);
    assert.equal(focusMatch('계절템', '계절템·겨울 가전'), true);
    assert.equal(focusMatch('겨울철 난방', '계절템·겨울 가전'), true, "'겨울철' ↔ '겨울'");
    assert.equal(focusMatch('가전제품 리뷰', '겨울 가전'), true);
    assert.equal(focusMatch('디지털·전자기기', '계절템·겨울 가전'), false);
    assert.equal(focusMatch('요리', '계절템·겨울 가전'), false);
    assert.equal(focusMatch('겨', '겨울 가전'), false, '한 글자 낱말은 안 봄');
  });
  test('링크가 3개 이상이면 경고 (링크 자리·넣은 제휴 링크 중 많은 쪽), 2개까지는 괜찮음', () => {
    const two = checkPost(base({ keyword: LONG_KW, body: BODY + '\n[링크: 보기]\n[링크2: 하나 더]' }), ctx({ links: [LINK] }));
    assert.ok(!seo(two).includes('too_many_links'));
    const three = checkPost(base({ keyword: LONG_KW, body: BODY + '\n[링크: 보기]\n[링크2: 하나 더]\n[링크3: 또]' }), ctx({ links: [LINK] }));
    assert.ok(seo(three).includes('too_many_links'));
    assert.match(three.warnings.find((w) => w.code === 'too_many_links').msg, /앱 권장 2개까지/);
    const links = [LINK, { ...LINK, id: 'l2', sort: 1 }, { ...LINK, id: 'l3', sort: 2 }];
    assert.ok(seo(checkPost(base({ keyword: LONG_KW, body: BODY + '\n[링크: 보기]' }), ctx({ links }))).includes('too_many_links'));
  });
  test('첫 소제목 앞이나 글 맨 앞에 링크가 있으면 경고, 중간·끝이면 없음', () => {
    assert.ok(seo(checkPost(base({ keyword: LONG_KW, body: '[링크: 최저가 보기]\n' + BODY }), ctx({ links: [LINK] }))).includes('link_too_early'));
    assert.ok(!seo(checkPost(base({ keyword: LONG_KW, body: BODY + '\n[링크: 최저가 보기]' }), ctx({ links: [LINK] }))).includes('link_too_early'));
    assert.equal(linkTooEarly('들어가는 말\n[링크: 보기]\n## 소제목\n문단'), true, '첫 소제목 앞');
    assert.equal(linkTooEarly('## 소제목\n[링크: 보기]\n문단\n문단\n문단'), true, '맨 앞 두 줄 안');
    assert.equal(linkTooEarly('## 소제목\n문단\n문단\n[링크: 보기]\n## 둘\n문단'), false, '첫 문단들 뒤');
    assert.equal(linkTooEarly('## 소제목\n문단'), false, '링크 없음');
  });
  test('내 경험이 없는 정보 글은 경고만 (발행 막지 않음) — 실제 후기 글은 경험 없으면 그대로 막음', () => {
    const info = checkPost(base({ keyword: LONG_KW, body: BODY + '\n[링크: 최저가 보기]' }), ctx({ links: [LINK] }));
    assert.ok(seo(info).includes('no_own_experience'));
    assert.deepEqual(info.errors, [], '정보 글은 경험이 없어도 오류 0개');
    assert.match(info.warnings.find((w) => w.code === 'no_own_experience').msg, /발행은 막지 않아/);
    assert.ok(!seo(checkPost(base({ keyword: LONG_KW, experience: '6평 원룸에서 창틀 결로를 매일 닦음' }), ctx())).includes('no_own_experience'));
    const review = checkPost(base({ keyword: LONG_KW, content_type: 'experience_review' }), ctx());
    assert.ok(codes(review).e.includes('needs_experience'), '실제 경험 후기는 경험이 없으면 오류');
    const hole = checkPost(base({ keyword: LONG_KW, body: BODY + '\n[내 경험: 우리 집 창틀 상태]' }), ctx());
    assert.ok(codes(hole).e.includes('placeholder_experience'), '빈 [내 경험] 표시는 글에 그대로 보여서 오류');
    assert.match(hole.errors.find((e) => e.code === 'placeholder_experience').fix, /정보 글은 칸을 지우고 경험 없이 올려도 돼/);
    assert.ok(!seo(hole).includes('no_own_experience'));
    assert.equal(canBeReady(checkPost(base({ keyword: LONG_KW, body: removeEmptyMe(BODY + '\n[내 경험: 우리 집 창틀 상태]') + '\n[링크: 보기]' }), ctx({ links: [LINK] }))), true, '빈 칸을 지우면 경험 없이도 발행 준비 가능');
  });
  test('SNS 글에는 검색 노출 점검을 안 함, 그리고 어떤 경우에도 오류(발행 막기)가 아님', () => {
    const sns = checkPost(base({ keyword: '전기요', channel_id: 'threads', program_ids: [], content_type: 'sns_short', body: '[링크: 보기]\n짧은 글 '.repeat(3) }), ctx({ focus: '요리' }));
    assert.deepEqual(seo(sns), []);
    const bad = checkPost(base({ keyword: '전기요', category: '요리', body: '[링크: 보기]\n' + BODY + '\n[링크2: 둘]\n[링크3: 셋]' }), ctx({ links: [LINK], focus: FOCUS }));
    assert.deepEqual(seo(bad).sort(), ['link_too_early', 'no_own_experience', 'off_focus', 'short_keyword', 'too_many_links'].sort());
    assert.ok(!codes(bad).e.some((c) => [...SEO_W, ...SEO_T].includes(c)));
  });
});
