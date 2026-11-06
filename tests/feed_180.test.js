// 1.8.0 홈판 점검 (checks.js feedCheck · thumbText · uniqueSentence) — 원고만 보고 계산하는 참고 점수
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { feedCheck, thumbText, uniqueSentence, titleLead, FEED_RULES, CLICKBAIT, feedLogError, feedTestSummary, FEED_TEST_MIN, citationsError, THUMB_VARIANTS } from '../checks.js';

const CTX = { focus: '계절템·겨울 가전', focusTerms: '히터, 전기요, 탄소매트, 온수매트, 가습기, 제습기, 손난로, 난방, 결로', autoTopics: '계절템·겨울 가전, 디지털·전자기기' };
const good = [
  '[이미지: (썸네일) 거실 가습기 고르기]',
  '[프롬프트: 앱이 그리는 썸네일 — 제미나이 필요 없음]',
  '> 핵심: 거실이면 용량보다 세척 쉬운지부터 봐요.',
  '## 거실 가습기, 왜 세척이 먼저일까?',
  '[기준: 2026년 11월 6일 기준 · 참고: 한국소비자원]',
  '물때가 끼면 냄새가 먼저 올라오거든요. 그래서 통이 넓게 열리는 게 편해요.',
  '[이미지: 가습기 물때를 씻는 손]', '[이미지: 거실 창가 가습기]', '[이미지: 넓게 열린 가습기 통]', '[이미지: 세척 솔과 분리한 부품]', '[이미지: (정보 카드) 체크리스트]',
  '## 이런 분께는 안 맞아요',
  '방이 아주 넓으면 한 대로는 부족할 수 있어요.',
].join('\n');
const byKey = (r) => Object.fromEntries(r.items.map((x) => [x.key, x]));

describe('1.8.0 홈판 점검', () => {
  test('잘 갖춘 원고: 썸네일 첫 자리·문구가 제목과 같은 이야기·맨 위 핵심·주제·짧은 문단·사진 6장·기준 상자', () => {
    const r = feedCheck({ titles: ['거실 가습기 고르기, 세척 쉬운 제품 3가지 기준'], keyword: '거실 가습기 세척 쉬운 제품', body: good }, CTX);
    const k = byKey(r);
    for (const key of ['thumb', 'thumb_match', 'top_summary', 'title_len', 'title_front', 'title_form', 'title_hook', 'no_bait', 'topic', 'short_para', 'img_fit', 'images', 'fresh']) assert.equal(k[key].ok, true, key);
    assert.match(k.title_len.label, /짧은 제목\(25~30자\) 쪽/);
    assert.equal(k.experience.ok, null, '경험이 없으면 참고(△) — 지어내지 말라는 안내');
    assert.match(k.experience.hint, /없는 경험을 만들지는 마/);
    assert.ok(r.score >= 90 && r.verdict === '홈판 준비 됨', r.score);
    assert.equal(r.thumbText, '거실 가습기 고르기');
    assert.equal(r.items.every((x) => x.basis), true, '항목마다 근거 표시');
  });
  test('손볼 곳: 사진 없음·요약 끝에만·낚시 말·주제 밖·긴 문단', () => {
    const body = '## 요즘 난리\n' + '이 이야기는 정말 길게 이어지는 문단이라서 휴대폰 화면에서 몇 줄이 넘어가요. '.repeat(5) + '\n## 마무리\n> 핵심: 끝에만 있는 요약';
    const r = feedCheck({ titles: ['충격! 연예인 열애설 총정리'], keyword: '연예인 열애설', body }, CTX);
    const k = byKey(r);
    assert.equal(k.thumb.ok, false); assert.match(k.thumb.hint, /사진 자리가 없어/);
    assert.equal(k.top_summary.ok, false, '첫 소제목 앞에 요약이 없음');
    assert.equal(k.no_bait.ok, false); assert.match(k.no_bait.hint, /'충격'/);
    assert.equal(k.topic.ok, false);
    assert.equal(k.short_para.ok, false); assert.match(k.short_para.hint, /긴 문단 1곳/);
    assert.equal(k.images.ok, null, '사진 수는 참고 — 억지로 채우지 말라는 안내');
    assert.match(k.images.hint, /억지로 채우지 마/);
    assert.ok(r.score < 60 && r.verdict === '손볼 곳 있음', r.score);
  });
  test('제목 길이: 시리즈 이름은 빼고 셈, 25~40자 ✓ · 18~24/41~50 △ · 그 밖 ✗ — 짧은 제목·긴 제목 쪽을 표시 (시험)', () => {
    const t = (title) => byKey(feedCheck({ titles: [title], body: good }, {})).title_len.ok;
    assert.equal(t('[오늘의 증시 11/6] 코스피 마감, 외국인 순매도가 이어진 이유 3가지'), true);
    assert.equal(t('거실 가습기 세척 쉬운 제품 고르기'), null);
    assert.equal(t('가습기 고르기'), false);
    assert.equal(t('가'.repeat(41)), null);
    assert.equal(t('가'.repeat(51)), false);
    assert.equal(FEED_RULES.titleGoodMin, 25); assert.equal(FEED_RULES.titleGoodMax, 40);
    const lab = (title) => byKey(feedCheck({ titles: [title], body: good }, {})).title_len.label;
    assert.match(lab('가'.repeat(30)), /30자 · 짧은 제목/);
    assert.match(lab('가'.repeat(31)), /31자 · 긴 제목/);
  });
  test('썸네일 문구가 제목과 다른 이야기면 ✗, 주력 주제가 없으면 주제 항목은 안 셈', () => {
    const body = good.replace('(썸네일) 거실 가습기 고르기', '(썸네일) 코스피 반등 마감');
    const r = feedCheck({ titles: ['거실 가습기 고르기, 세척 쉬운 3가지 기준'], body }, {});
    assert.equal(byKey(r).thumb_match.ok, false);
    assert.ok(!byKey(r).topic, '주력 주제가 없으면 주제 항목 없음');
  });
  test('맨 위 요약: "> 핵심" 상자·2~5줄 목록·"결론:" 문단 모두 인정, 사진·기준 상자는 건너뜀', () => {
    const top = (lead) => byKey(feedCheck({ titles: ['t'], body: `[이미지: (썸네일) x]\n[기준: 2026년 11월 6일 기준]\n${lead}\n## 소제목\n본문` }, {})).top_summary.ok;
    assert.equal(top('> 핵심: 답부터'), true);
    assert.equal(top('- 하나\n- 둘\n- 셋'), true);
    assert.equal(top('결론: 세척부터 봐요.'), true);
    assert.equal(top('그냥 도입 문장이에요.'), false);
  });
  test('thumbText: 문구만 뽑고, 비었거나 "제목 카드"면 빈 값 (제목을 씀)', () => {
    assert.equal(thumbText('(썸네일) 거실 가습기 고르기'), '거실 가습기 고르기');
    assert.equal(thumbText('(썸네일) — 코스피 반등 마감'), '코스피 반등 마감');
    assert.equal(thumbText('(썸네일) 제목 카드'), '');
    assert.equal(thumbText('(썸네일)'), '');
  });
  test('누락 확인 문장: 15~45자 문단 문장, 숫자·괄호·요약 머리말 없는 것 중 가장 긴 것', () => {
    assert.equal(uniqueSentence(good), '방이 아주 넓으면 한 대로는 부족할 수 있어요.');
    assert.equal(uniqueSentence('> 핵심: 이건 요약이라서 검색 문장으로 안 써요.\n짧아요.'), '');
  });
  test('낚시 말 목록', () => {
    for (const w of ['충격', '경악', '소름', '역대급', '알고 보니', '무조건', '100%']) assert.ok(CLICKBAIT.test(`제목 ${w} 이야기`), w);
    assert.ok(!CLICKBAIT.test('거실 가습기 고르는 법 3가지'));
  });
});

// 보고서 결론 맞추기 (2026-11-06): 제목 앞쪽·군더더기·최근 제목, 사진 관련성, 문단 문장 수, 투자 글 위치, 썸네일 숫자, 직접 찍은 사진
describe('1.8.0 홈판 점검 — 보고서 결론', () => {
  const T = '거실 가습기 고르기, 세척 쉬운 제품 3가지 기준';
  test('핵심 낱말(제품군·키워드)이 제목 앞 25자 안에 — 뒤에 있으면 △, 제목에 키워드 낱말이 없으면 ✗', () => {
    const k = (title, keyword) => byKey(feedCheck({ titles: [title], keyword, body: good }, CTX)).title_front;
    assert.equal(k(T, '거실 가습기 세척').ok, true);
    const late = k('겨울철 거실에서 아이와 같이 오래 쓰려면 꼭 봐야 할 가습기 기준', '가습기 기준');
    assert.equal(late.ok, null); assert.match(late.hint, /'가습기'가 \d+번째 글자부터/);
    assert.equal(k('세척이 쉬운 것부터 고르면 실패가 적어요', '원룸 제습기 용량').ok, false);
    assert.ok(!byKey(feedCheck({ titles: ['아무 제목'], body: good }, {})).title_front, '키워드도 주력 주제 낱말도 없으면 안 셈');
  });
  test('제목 군더더기: 대괄호·이모지·같은 낱말 두 번은 ✗, 본문에 없는 낱말은 △, 시리즈 이름 [ ]은 괜찮아', () => {
    const f = (title) => byKey(feedCheck({ titles: [title], keyword: '거실 가습기', body: good }, CTX)).title_form;
    assert.equal(f(T).ok, true);
    assert.equal(f('[종목 한 장 정리 #8] 거실 가습기 세척 기준').ok, true, '맨 앞 시리즈 이름은 빼고 봄');
    assert.match(f('거실 가습기 [필독] 세척 기준').hint, /대괄호/);
    assert.equal(f('거실 가습기 세척 기준 ★').ok, false);
    assert.equal(f('거실 가습기 세척 기준 🔥').ok, false);
    assert.equal(f('거실 가습기 세척!! 기준').ok, false);
    const rep = f('가습기 세척, 가습기 고르기 기준');
    assert.equal(rep.ok, false); assert.match(rep.hint, /같은 낱말 두 번\('가습기'\)/);
    const miss = f('거실 가습기 세척 기준과 전기요금 절약');
    assert.equal(miss.ok, null); assert.match(miss.hint, /본문에서 못 찾은 낱말: '전기요금'/);
  });
  test('최근 7일 제목과 시작이 같으면 △ (앱이 고른 최근 제목을 줌)', () => {
    assert.equal(titleLead('[오늘의 증시 11/6] 코스피 마감 정리'), '코스피');
    const r = (recent) => byKey(feedCheck({ titles: [T], body: good }, { recentTitles: recent })).title_recent;
    assert.equal(r(['거실 제습기 용량 고르기']).ok, null);
    assert.match(r(['거실 제습기 용량 고르기', '거실 히터 안전']).hint, /'거실'로 시작한 제목이 2개/);
    assert.equal(r(['원룸 제습기 용량']).ok, true);
    assert.ok(!byKey(feedCheck({ titles: [T], body: good }, {})).title_recent, '최근 제목을 안 주면 안 셈');
  });
  test('사진 관련성: 소제목·문단과 겹치는 낱말이 없는 분위기 사진은 △ 장식 사진?, 같은 장면 두 번도 △', () => {
    const body = (extra) => ['[이미지: (썸네일) 거실 가습기 고르기]', '> 핵심: 세척부터 봐요.', '## 가습기 물통 세척', '물때가 끼면 냄새가 나요. 통이 넓게 열리면 편해요.', ...extra].join('\n');
    const fit = (extra) => byKey(feedCheck({ titles: [T], body: body(extra) }, {})).img_fit;
    assert.equal(fit(['[이미지: 물통을 솔로 닦는 손]']).ok, true);
    const mood = fit(['[이미지: 새벽 도시의 고층 빌딩 사이로 해가 뜨는 장면]']);
    assert.equal(mood.ok, null); assert.match(mood.hint, /장식 사진\? '새벽 도시/);
    const dup = fit(['[이미지: 물통을 솔로 닦는 손]', '[이미지: 물통을 솔로 닦는 두 손]']);
    assert.equal(dup.ok, null); assert.match(dup.hint, /비슷한 사진 자리/);
    assert.equal(fit(['[이미지: (정보 카드) 세척 순서]']), undefined, '앱이 그리는 정보 카드는 안 셈');
    assert.equal(fit(['[이미지: (직접 찍기) 우리 집 가습기 물통 (제품 사진)]']).ok, true, '표시 말을 빼고 장면만 봄');
  });
  test('실제 1.7.0 자동 원고에서 뽑은 소제목 부분 9개: 분위기 컷 4개는 장식 사진?, 문단과 맞는 사진 5개는 통과', () => {
  const cases = [
      ['팔란티어 — 주가 하락 부분 + 사무실 뒷모습', '## 그런데 주가는 왜 내렸을까\n실적 발표 당일 정규장에서 3.08% 내린 178.44달러로 마감했고, 시간외에서 171.52달러까지 3.82% 더 밀렸어요.\n기사에서 짚은 우려는 이래요.\n- 기업가치가 이미 높아 추가 상승 여지가 크지 않을 수 있다는 시각\n- 수요는 강하지만 모든 요청을 소화할 역량은 한정돼 있다는 점\n좋게 보는 근거도 분명해요. 미국 상업 매출이 전분기보다 29% 늘었고, 연간 전망도 올렸거든요.\n[이미지: 저녁 사무실 창가에서 노트북 화면을 바라보는 사람의 뒷모습]', 'deco'],
      ['뉴욕증시 — 선거 해석 부분 + 빌딩 해돋이', '## 왜 올랐을까: 선거 결과 해석\n보도된 이유는 중간선거 결과예요. 민주당이 상·하원을 가져가면서, 의회와 행정부가 서로 견제하는 구도가 오히려 불확실성을 줄인다는 해석이 우세했다고 합니다.\n> 핵심: 정책이 한쪽으로 크게 쏠리기 어려워졌다는 해석이 지수를 끌어올렸어요\n빅테크가 앞장섰어요.\n- 마이크로소프트 +6.68% (555.80달러)\n- 아마존 +6.12% (266.03달러)\n[이미지: 새벽 도시의 고층 빌딩 사이로 해가 떠오르는 장면]', 'deco'],
      ['근로장려금 — 금액 부분 + 식탁 위 머그잔', '## 얼마나 받을 수 있을까?\n근로장려금은 최소 3만 원부터예요. 최대 금액은 가구 형태마다 달라요.\n- 단독가구: 최대 165만 원\n- 홑벌이가구: 최대 285만 원\n> 핵심: 기한 후 신청은 심사 후 산정액의 95%를 받아요.\n예를 들어 산정액이 100만 원으로 나왔다면 95만 원을 받는 셈이에요. 지급일은 2027년 1월 15일이에요.\n[이미지: 겨울 오후 나무 식탁 위에 놓인 흰 우편 봉투와 스마트폰, 김이 나는 머그잔]', 'deco'],
      ['코스피 — 사이드카 부분 + 불 꺼진 사무실 모니터', '## 사이드카는 언제 걸렸나\n코스피는 오전 10시 16분, 코스피200 선물이 급락하면서 매도 사이드카가 발동됐어요. 코스닥은 오후 2시 27분에 같은 조치가 나왔고요.\n두 시장에 같은 날 매도 사이드카가 걸린 건 지난달 15일 이후 15거래일 만이라고 해요.\n[이미지: 저녁 무렵 불 꺼진 사무실 책상 위 모니터에 푸른빛이 비치는 차분한 장면]', 'deco'],
      ['강풍 — 베란다 물건 부분 + 건조대·화분 옮긴 모습', '## 베란다 물건, 묶을까 들일까?\n답은 들이는 쪽이에요.\n실내로 옮길 물건은 이 정도예요.\n- 화분과 빈 화분 받침\n- 빨래건조대(접어서)\n- 우산(접어서 눕히기)\n[이미지: 베란다 바닥에 접힌 빨래건조대와 작은 화분 몇 개를 실내 쪽으로 옮겨 둔 모습]', 'fit'],
      ['강풍 — 창문 잠금 부분 + 잠금장치 돌리는 손', '## 창문은 손으로 잠금 확인\n눈으로 보면 다 닫혀 있는 것 같거든요. 그런데 잠금장치가 반쯤 걸려 있는 경우가 꽤 있어요.\n- 잠금장치를 손으로 직접 돌려 확인하기\n- 미닫이 창은 레일 끝까지 들어갔는지 보기\n[이미지: 창문 잠금장치를 손으로 돌리는 모습을 보여주는 깔끔한 일러스트]', 'fit'],
      ['근로장려금 — 신청 방법 부분 + QR 순서 그림', '## 신청 방법은 세 가지\n안내문을 받았다면 간단해요.\n- 우편 안내문의 QR코드 찍기\n- 모바일 안내문의 신청하기 누르기\n- 자동응답서비스로 신청하기\n[이미지: 스마트폰으로 QR코드를 찍고 신청을 누르는 순서를 보여주는 아이콘형 인포그래픽]', 'fit'],
      ['에너지바우처 — 난방비 부분 + 고지서와 찻잔', '## 겨울 난방비, 받을 수 있는 지원부터 확인해요\n보일러 돌리기 시작하면 다음 달 고지서가 벌써 걱정되죠?\n에너지바우처는 저소득 취약계층의 냉난방비를 지원하는 이용권이에요. 전기, 도시가스, 지역난방 요금에서 깎거나 등유·LPG·연탄을 살 때 쓸 수 있어요.\n[이미지: 겨울 저녁 식탁 위에 놓인 난방 요금 고지서와 따뜻한 찻잔]', 'fit'],
      ['이불 — 꺼내기 전 세탁 부분 + 침대 위 겨울 이불', '## 겨울 이불, 꺼내기 전에 한 번 빨아야 할까?\n장롱에서 겨울 이불을 꺼냈는데 냄새가 살짝 나요. 바로 덮자니 찝찝하고, 통째로 빨자니 망가질까 걱정되죠.\n[이미지: 침대 위에 개어 놓인 두꺼운 겨울 이불과 창으로 들어오는 아침 햇살]', 'fit'],
    ];
    for (const [name, body, want] of cases) {
      const it = byKey(feedCheck({ titles: ['제목'], body: '[이미지: (썸네일) 제목 카드]\n' + body }, {})).img_fit;
      assert.equal(it.ok === true ? 'fit' : 'deco', want, name);
    }
  });
  test('짧은 문단: 150자 안이어도 4문장 넘게 이어지면 긴 문단', () => {
    const body = '[이미지: (썸네일) x]\n> 핵심: 답\n## 소제목\n물이 차요. 통이 넓어요. 솔이 있어요. 매일 닦아요. 말려요.';
    const k = byKey(feedCheck({ titles: [T], body }, {})).short_para;
    assert.equal(k.ok, false); assert.match(k.hint, /긴 문단 1곳/);
    assert.equal(FEED_RULES.paraMaxSentences, 4);
  });
  test('투자 글: 주제 항목 대신 투자 블로그에 있는지 — 메인 블로그면 ✗', () => {
    const inv = { titles: ['[오늘의 증시 11/6] 코스피 마감, 외국인 순매도 이어진 이유'], plan_kind: 'market', content_type: 'market_summary', body: good };
    const at = (ch, investChannel = 'naver_blog_invest') => byKey(feedCheck({ ...inv, channel_id: ch }, { ...CTX, mainChannel: 'naver_blog', investChannel }));
    assert.equal(at('naver_blog_invest').invest_blog.ok, true);
    assert.ok(!at('naver_blog_invest').topic, '투자 글은 생활·가전 주제로 보지 않음');
    const main = at('naver_blog').invest_blog;
    assert.equal(main.ok, false); assert.match(main.hint, /메인 블로그/);
    assert.equal(at('naver_blog', 'naver_blog').invest_blog.ok, false, '투자 블로그를 메인과 같게 정했으면 ✗');
  });
  test('썸네일: 문구의 숫자가 제목·본문에 없으면 ✗, 제목의 제품군이 문구에 없으면 △', () => {
    const tm = (thumb, title = T) => byKey(feedCheck({ titles: [title], body: good.replace('(썸네일) 거실 가습기 고르기', '(썸네일) ' + thumb) }, CTX)).thumb_match;
    assert.equal(tm('거실 가습기 3가지 기준').ok, true);
    const num = tm('거실 가습기 7가지 기준');
    assert.equal(num.ok, false); assert.match(num.hint, /숫자 '7'/);
    const core = tm('거실 세척부터 봐요');
    assert.equal(core.ok, null); assert.match(core.hint, /'가습기'가 없어/);
  });
  test('직접 경험: 경험 칸이나 직접 찍은 사진이 있으면 ✓, (직접 찍기) 자리만 있으면 그 자리를 채우라고 안내', () => {
    const shoot = good + '\n[이미지: (직접 찍기) 우리 집 가습기 물통]';
    assert.equal(byKey(feedCheck({ titles: [T], body: shoot }, { ownPhoto: true })).experience.ok, true);
    const e = byKey(feedCheck({ titles: [T], body: shoot }, {})).experience;
    assert.equal(e.ok, null); assert.match(e.hint, /'\(직접 찍기\)' 자리에 네가 찍은 사진/);
  });
});

describe('1.8.0 홈판 기록·시험 정리', () => {
  test('feedLogError: 알 수 없는 칸·이상한 값은 그 칸 이름, 빈 값은 데이터 없음으로 통과', () => {
    assert.equal(feedLogError({}), null);
    assert.equal(feedLogError({ checked_on: '2026-11-07', indexed: 'yes', feed_pct: 62.5, search_pct: 30, views_1d: 120, views_7d: 480, avg_secs: 95, stats_on: '2026-11-13', thumb: 'B', title_len: 27, note: '메모' }), null);
    assert.equal(feedLogError({ feed_pct: null, views_7d: '', thumb: '' }), null);
    for (const [k, v] of [['feed_pct', 101], ['search_pct', -1], ['views_7d', 1.5], ['avg_secs', -3], ['thumb', 'D'], ['indexed', 'maybe'], ['checked_on', '2026-13-01'], ['note', 'x'.repeat(301)], ['title_len', 'n'], ['secret', 1]]) assert.equal(feedLogError({ [k]: v }), k, k);
    assert.equal(feedLogError([]), 'feed_log');
    assert.deepEqual(Object.keys(THUMB_VARIANTS), ['A', 'B', 'C']);
  });
  test('feedTestSummary: 썸네일 변형·제목 길이별 7일째 평균, 변형마다 5편이 넘어야 비교', () => {
    const P = (thumb, title_len, feed_pct, views_7d, extra = {}) => ({ feed_log: { thumb, title_len, feed_pct, views_7d, ...extra } });
    const posts = [P('A', 27, 10, 100), P('A', 33, 30, 300, { indexed: 'no' }), P('B', 28, 50, 500, { indexed: 'yes' }), P('C', null, null, null), { feed_log: {} }, { deleted_at: 'x', feed_log: { thumb: 'A', feed_pct: 90 } }, { titles: ['기록 없음'] }];
    const s = feedTestSummary(posts);
    assert.equal(s.posts, 5);
    const A = s.thumbs.find((x) => x.key === 'A');
    assert.deepEqual([A.posts, A.measured, A.feedPct, A.views7d, A.enough, A.missing], [2, 2, 20, 200, false, 1]);
    assert.equal(s.thumbs.find((x) => x.key === 'C').measured, 0, '숫자를 안 적은 글은 비교에 안 셈');
    assert.deepEqual(s.titles.map((x) => [x.key, x.posts]), [['short', 2], ['long', 1]]);
    assert.deepEqual([s.checked, s.missing], [2, 1]);
    const many = Array.from({ length: FEED_TEST_MIN }, () => P('B', 26, 40, 400));
    assert.equal(feedTestSummary(many).thumbs[0].enough, true);
  });
  test('citationsError: [{on, total}] 만, 날짜·정수 확인', () => {
    assert.equal(citationsError([]), null);
    assert.equal(citationsError([{ on: '2026-11-09', total: 0 }, { on: '2026-11-16', total: 12 }]), null);
    for (const bad of [{}, [{ on: '2026-11-09' }], [{ on: '11/9', total: 1 }], [{ on: '2026-11-09', total: -1 }], [{ on: '2026-11-09', total: 1.5 }], [{ on: '2026-11-09', total: 1, x: 1 }]]) assert.equal(citationsError(bad), 'ai_citations');
  });
});
