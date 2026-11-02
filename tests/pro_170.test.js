// 1.7.0 전문성·사람 말투 — 화면 없이 계산 부분만 (checks.js · lib.js · infocards.js)
// AI 말투 점수, 말투 카드, 참고 글 '틀'과 베끼기 검사, 숫자 확인표, 전문가 틀([기준]·[용어]·[^n]), 정보 카드 후보
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBody, promptsOf, checkPost, aiTone, AI_PHRASES, AI_TONE_GOOD, AI_TONE_BAD, VOICE_PRESETS, VOICE_SCOPES, voiceCard,
  fpOf, FP_WINDOW, refOverlap, REF_COPY_RUN, figureNumbers, unlistedNumbers, isAppDrawnSlot, bodyChars,
} from '../checks.js';
import { voiceProfile, analyzeReference, templateLine, exportHtml, exportPlain, viewHtml, promptsText, sourceList } from '../lib.js';
import { splitSeries, footnoteOf, cardCandidates, bestCandidate, themeOf, KIND_THEMES, CARD_SIZES } from '../infocards.js';
import { readFileSync } from 'node:fs';

const PROMPT_DOC = readFileSync(new URL('../docs/auto-writer-prompt.md', import.meta.url), 'utf8');

// 사람이 쓴 것 같은 해요체 글 (어미·길이 섞임, 틀에 박힌 말 없음)
const HUMAN = ['## 원룸 가습기, 뭐부터 볼까요?',
  '가습기 고를 때 제일 먼저 볼 건 소음이에요. 잘 때 켜두는 물건이라 생각보다 거슬리거든요.',
  '저도 처음엔 용량만 봤어요. 그런데 원룸이면 얘기가 달라요.',
  '방이 작으면 큰 용량이 오히려 부담이에요. 창문에 물이 맺히기 쉽거든요.',
  '## 세척이 쉬워야 오래 써요',
  '물통 입구가 손이 들어갈 만큼 넓은지 보세요. 좁으면 솔을 따로 사야 하고, 결국 귀찮아서 안 닦게 돼요.',
  '이런 적 있죠? 며칠 안 닦았더니 냄새가 올라오는 거요.',
  '그래서 저는 분리되는 부품이 적은 쪽을 추천해요.',
  '## 전기세는 방식마다 달라요',
  '가열식은 따뜻한 대신 전기를 더 써요. 초음파식은 조용하고 전기를 덜 쓰지만 자주 닦아야 해요.',
  '복합식은 그 중간이에요. 가격이 조금 더 나가요.',
  '## 이런 분께는 안 맞아요',
  '아이 방에 둘 거라면 뜨거운 수증기가 나오는 가열식은 피하는 게 좋아요.',
  '> 핵심: 원룸이면 용량보다 소음과 세척부터.',
].join('\n');
// AI가 쓴 티가 나는 글 (예고·정리 말, 합니다체, 같은 어미, 번호 소제목, 3개짜리 목록 반복)
const AI = ['## 1. 가습기 선택 방법',
  '이번 포스팅에서는 가습기 선택 방법에 대해 자세히 알아보겠습니다. 가습기는 겨울철 필수 가전제품입니다. 다양한 종류의 가습기가 있습니다. 각각의 장단점이 존재합니다.',
  '## 2. 가습기 종류',
  '가습기의 종류를 살펴보겠습니다. 초음파식 가습기가 있습니다. 가열식 가습기가 있습니다. 복합식 가습기가 있습니다.',
  '- 초음파식', '- 가열식', '- 복합식',
  '## 3. 세척 방법',
  '세척을 자주 하는 것이 중요합니다. 효과적인 세척 방법을 알아두면 좋습니다. 많은 분들이 세척을 소홀히 합니다. 꼭 기억하세요.',
  '- 물통', '- 필터', '- 진동자',
  '## 4. 결론',
  '결론적으로 가습기는 용도에 맞게 선택하는 것이 중요합니다. 다양한 제품을 비교해 보시기 바랍니다. 이 글이 도움이 되셨기를 바랍니다.',
  '- 용도', '- 크기', '- 가격',
].join('\n');

describe('AI 말투 점수 (aiTone)', () => {
  test('사람 같은 글은 높고, AI 티 나는 글은 낮음 — 걸린 습관을 종류별로 알려줌', () => {
    const h = aiTone(HUMAN);
    assert.ok(h.score >= AI_TONE_GOOD, '사람 같은 글 ' + h.score);
    assert.equal(h.verdict, '사람 같음');
    assert.deepEqual(h.hits, []);
    const a = aiTone(AI);
    assert.ok(a.score < AI_TONE_BAD, 'AI 글 ' + a.score);
    assert.equal(a.verdict, 'AI 티 남');
    const kinds = new Set(a.hits.map((x) => x.kind));
    for (const k of ['phrase', 'endings', 'formal', 'heads', 'lists']) assert.ok(kinds.has(k), k);
    const phrase = a.hits.find((x) => x.label.includes('알아보겠습니다'));
    assert.equal(phrase.examples[0], '이번 포스팅에서는 가습기 선택 방법에 대해 자세히 알아보겠습니다.', '걸린 문장을 그대로 보여줌');
  });
  test('같은 말이 여러 번이어도 한 표현은 12점까지만 깎음, 0점 아래로 안 내려감', () => {
    const ends = ['해봐요.', '하면 돼요.', '해도 괜찮아요?', '하거든요.', '하더라고요.', '해보세요.'];
    const many = ends.map((e, i) => `다양한 방법 중 ${i + 1}번째는 이렇게 ${e}`).join(' ');
    const r = aiTone(many);
    const hit = r.hits.find((x) => x.label === '"다양한"');
    assert.equal(hit.n, 6);
    assert.equal(r.score, 100 - 12);
    const worst = aiTone(Array.from({ length: 5 }, () => AI).join('\n'));
    assert.ok(worst.score >= 0);
  });
  test('합니다체 비율·문장 길이는 문단 문장으로만 셈 (짧은 목록 항목이 섞여도 딱딱한 글은 잡힘)', () => {
    const formal = ['가습기는 겨울에 많이 씁니다. 습도를 올려 줍니다. 방식이 여러 가지입니다. 초음파식은 조용합니다.',
      '가열식은 전기를 많이 씁니다. 복합식은 가격이 높습니다. 세척은 자주 해야 합니다. 물은 매일 갈아야 합니다.',
      ...Array.from({ length: 12 }, (_, i) => `- 항목${i}`)].join('\n');
    assert.ok(aiTone(formal).hits.some((x) => x.kind === 'formal'));
  });
  test('사진 자리·프롬프트·표는 문장으로 안 셈', () => {
    const body = '[이미지: 다양한 가습기]\n[프롬프트: 다양한 가습기가 놓인 선반, 깔끔한 일러스트, 글자 없이]\n| 다양한 | 항목 |\n|---|---|\n| a | b |\n가습기는 소음부터 봐요.';
    assert.deepEqual(aiTone(body).hits, []);
  });
  test('금지 목록: 자동 작가 프롬프트 규칙 15에 적힌 말을 앱 검사도 모두 잡음', () => {
    const rule = PROMPT_DOC.match(/15\. AI 티 금지[^:]*: ([^\n]+?)를 쓰지 마/)[1];
    const phrases = [...rule.matchAll(/"([^"]+)"/g)].flatMap((m) => m[1].split('/'));
    assert.ok(phrases.length >= 15, String(phrases.length));
    for (const ph of phrases) {
      const t = ph.replace(/^~/, '가습기');
      assert.ok(AI_PHRASES.some((x) => x.re.test(t)), '앱이 못 잡는 금지 표현: ' + ph);
    }
  });
});

describe('말투 카드', () => {
  test('범위마다 기본 말투, 저장한 카드가 있으면 그 카드, 모르는 이름이면 기본', () => {
    assert.equal(voiceCard({}, 'general'), VOICE_PRESETS.friendly.card);
    assert.equal(voiceCard({}, 'invest'), VOICE_PRESETS.invest.card);
    assert.equal(voiceCard({ voice: { general: { preset: 'calm' } } }, 'general'), VOICE_PRESETS.calm.card);
    assert.equal(voiceCard({ voice: { general: { preset: 'calm', card: '  반말로 짧게.  ' } } }, 'general'), '반말로 짧게.');
    assert.equal(voiceCard({ voice: { general: { preset: 'nope' } } }, 'general'), VOICE_PRESETS.friendly.card);
    assert.deepEqual(Object.keys(VOICE_SCOPES), ['general', 'invest']);
  });
  test('자동 작가 프롬프트(규칙 16)에 기본 말투 카드가 글자 그대로 들어 있음', () => {
    for (const [k, v] of Object.entries(VOICE_PRESETS)) assert.ok(PROMPT_DOC.includes(`${k} = "${v.card}"`), k);
  });
  test('내 글에서 말투 뽑기: 해요체·문장 길이·끝말, 써본 경험·구매 문장은 예시에서 뺌', () => {
    assert.equal(voiceProfile('짧아요. 네.').ok, false);
    const text = HUMAN.replace(/^## .*$/gm, '') + '\n제가 샀던 가습기는 소리가 꽤 컸어요. 한 달 써보니 물때가 생기더라고요.';
    const v = voiceProfile(text);
    assert.equal(v.ok, true);
    assert.equal(v.stats.style, '해요체');
    assert.ok(v.stats.haeyo > 0.8 && v.stats.hamnida === 0);
    assert.ok(v.card.startsWith('말투: 해요체') && v.card.includes('문장 길이: 평균') && v.card.includes('그대로 베끼지 말고 리듬만'));
    assert.ok(v.examples.length >= 1 && v.examples.every((x) => !/샀던|써보니/.test(x)), '써본 척 문장은 예시로 안 씀');
    const formal = voiceProfile('가습기는 겨울에 씁니다. 습도를 올립니다. 소음이 있습니다. 세척이 필요합니다. 전기를 씁니다. 가격이 다양합니다.');
    assert.equal(formal.stats.style, '합니다체');
  });
});

describe('잘 나가는 글 틀 · 베끼기 검사', () => {
  const REF = `겨울 가습기 고르는 법 총정리
겨울만 되면 코가 바짝 마르죠? 저도 매년 이맘때면 가습기를 꺼내요. 오늘은 원룸에 맞는 가습기 고르는 기준을 정리했어요.
가습기 종류부터 알아두세요
가습기는 크게 초음파식, 가열식, 복합식으로 나뉘어요. 방식마다 소음과 전기 요금, 세척 난이도가 꽤 달라요. 원룸이라면 소음이 적은 쪽이 편하답니다.
- 초음파식: 조용하고 전기를 적게 써요
- 가열식: 위생적이지만 전기를 많이 써요
- 복합식: 중간이지만 가격이 높아요
고를 때 꼭 볼 세 가지
첫째는 물통 입구 크기예요. 손이 들어가야 구석까지 닦을 수 있거든요. 둘째는 소음인데, 잠잘 때 켜두니 30데시벨 아래가 좋아요. 셋째는 분리되는 부품 수예요.
자주 묻는 질문
Q. 수돗물을 써도 되나요? 초음파식은 하얀 가루가 생길 수 있어서 정수된 물이 나아요.
정리하면 원룸은 소음과 세척부터 보시면 돼요.`;
  const T = analyzeReference(REF, { photos: 7 });
  test('틀만 뽑음: 소제목 역할 순서·목록·도입/마무리·말투, 원문 문장은 저장하지 않음', () => {
    assert.equal(T.ok, true);
    assert.deepEqual(T.outline.map((x) => x.role), ['개념', '추천·고르기', 'FAQ'], '첫 줄(제목)·목록 줄은 소제목으로 안 셈');
    assert.deepEqual(T.outline.map((x) => x.list), [true, false, false]);
    assert.equal(T.stats.headings, 3);
    assert.equal(T.stats.photos, 7);
    assert.equal(T.stats.intro, '질문으로 시작');
    assert.equal(T.stats.ending, '요약으로 끝');
    assert.equal(T.stats.style, '해요체');
    assert.ok(Array.isArray(T.fp) && T.fp.length > 200 && T.fp.every(Number.isInteger));
    const saved = JSON.stringify({ outline: T.outline, stats: T.stats });
    for (const s of ['물통 입구 크기예요', '코가 바짝 마르죠', '수돗물을 써도']) assert.ok(!saved.includes(s), '원문 문장이 저장되면 안 됨: ' + s);
    assert.equal(templateLine(T), '흐름: 개념 → 추천·고르기 → FAQ · 분량 333자 · 사진 7장 · 질문으로 시작 · 요약으로 끝 · 말투 해요체');
    assert.equal(analyzeReference('짧은 글').ok, false);
    assert.equal(analyzeReference(REF, { photos: 99 }).stats.photos, 30);
    assert.equal(analyzeReference(REF).stats.photos, null);
  });
  test('지문: 띄어쓰기·문장부호는 무시, 8글자 조각마다 정수 하나', () => {
    assert.deepEqual(fpOf('가나 다라, 마바사아자!'), fpOf('가나다라마바사아자'));
    assert.equal(fpOf('가나다라마바사아자').length, 9 - FP_WINDOW + 1);
    assert.deepEqual(fpOf('짧음'), []);
  });
  test('참고 글 문장을 25글자 넘게 그대로 쓰면 오류, 표현만 많이 겹치면 경고, 내 문장이면 통과', () => {
    const tpl = [{ name: '가습기 총정리', fp: T.fp }];
    const copied = '## 가습기 고르기\n원룸이면 이게 중요해요. 첫째는 물통 입구 크기예요. 손이 들어가야 구석까지 닦을 수 있거든요. 나머지는 제 말로 썼어요.\n' + '그리고 소음도 봐요. '.repeat(20);
    const ov = refOverlap(copied, tpl);
    assert.ok(ov.maxRun >= REF_COPY_RUN, String(ov.maxRun));
    assert.equal(ov.name, '가습기 총정리');
    assert.ok(ov.example.includes('물통입구크기'));
    const own = '## 가습기 고르기\n제 방은 6평이에요. 가습기를 처음 고를 땐 소리가 제일 신경 쓰였어요. 밤새 켜두면 작은 소리도 크게 들리더라고요. 그래서 조용한 쪽부터 찾아봤어요.';
    assert.deepEqual(refOverlap(own, tpl), { maxRun: 0, share: 0, name: '', example: '' });
    const plain = REF.replace(/\s/g, '');
    let mixed = '';
    for (let i = 0; i < plain.length; i++) mixed += i % 12 === 11 ? '쿵' : plain[i];
    const sim = refOverlap(mixed, tpl);
    assert.ok(sim.maxRun < REF_COPY_RUN && sim.share >= 0.1, JSON.stringify(sim));
    // 사진 자리·프롬프트·링크 자리 줄은 비교에서 뺌
    assert.equal(refOverlap('[이미지: 첫째는 물통 입구 크기예요. 손이 들어가야 구석까지 닦을 수 있거든요]\n짧은 내 문장이에요.', tpl).maxRun, 0);
    // checkPost: 블로그 글에 틀(ctx.templates)을 주면 베낀 글은 오류, 많이 겹치면 경고
    const ctx = { programs: {}, channels: { naver_blog: { id: 'naver_blog', kind: 'blog' } }, links: [], products: [], today: '2026-11-03', templates: tpl };
    const post = (body) => ({ id: 'p', titles: ['가습기 고르는 법'], keyword: '원룸 가습기 고르는 법', body, channel_id: 'naver_blog', program_ids: [], content_type: 'buying_guide', sources: [] });
    assert.ok(checkPost(post(copied), ctx).errors.some((x) => x.code === 'ref_copy'));
    assert.ok(checkPost(post(mixed + '\n' + own), ctx).warnings.some((x) => x.code === 'ref_similar'));
    const clean = checkPost(post(own.repeat(3)), ctx);
    assert.ok(!clean.errors.some((x) => x.code === 'ref_copy') && !clean.warnings.some((x) => x.code === 'ref_similar'));
  });
});

describe('숫자 확인표 (투자 글)', () => {
  const figs = [{ label: '코스피 종가', value: '2,612.45', unit: '포인트', as_of: '2026-11-02', source: '한국거래소', source_url: 'https://data.krx.co.kr/' }];
  test('본문 숫자 중 표에 없는 것만 찾음 (날짜·개수·연도는 빼고)', () => {
    const body = '## 오늘 코스피\n코스피는 2,612.45로 마감했어요. 외국인은 1,234억 원을 팔았어요. 11월 3일 기준이에요. 2026년 들어 3번째예요. 상승 종목은 512개였어요.';
    assert.deepEqual(unlistedNumbers(body, figs).map((x) => x.value), ['1,234']);
    assert.deepEqual([...figureNumbers([{ value: '+1.2%' }, { value: 1500 }, { value: '-3,000억' }, null, 'x'])], [1.2, 1500, 3000]);
  });
  test('checkPost: 표가 없으면 경고, 날짜·출처 빠진 줄 경고, 표에 없는 숫자는 참고', () => {
    const ctx = { programs: {}, channels: { naver_blog_invest: { id: 'naver_blog_invest', kind: 'blog' } }, links: [], products: [], today: '2026-11-03' };
    const body = '## 오늘 코스피\n[기준: 2026년 11월 2일 장 마감 · 참고: 한국거래소]\n코스피는 2,612.45로 마감했어요. 외국인은 1,234억 원을 팔았어요.\n이 글은 공개된 정보를 정리한 것이고 투자 권유가 아니에요. 투자 판단과 책임은 본인에게 있어요.';
    const post = (o) => ({ id: 'p', titles: ['[오늘의 증시 11/2] 코스피 정리'], keyword: '오늘 코스피 마감 정리', body, channel_id: 'naver_blog_invest', program_ids: [], plan_kind: 'market', sources: [{ url: 'https://data.krx.co.kr/', title: 'KRX' }], ...o });
    const c = (r) => [...r.errors, ...r.warnings, ...r.tips].map((x) => x.code);
    assert.ok(c(checkPost(post({ figures: [] }), ctx)).includes('figures_missing'));
    const withFigs = c(checkPost(post({ figures: figs }), ctx));
    assert.ok(withFigs.includes('figure_unlisted') && !withFigs.includes('figures_missing') && !withFigs.includes('figure_no_source'));
    assert.ok(c(checkPost(post({ figures: [{ label: '코스피', value: '2,612.45' }] }), ctx)).includes('figure_no_source'));
    // 투자 글이 아니면 표를 요구하지 않음
    assert.ok(!c(checkPost(post({ plan_kind: 'adpost', figures: [] }), ctx)).includes('figures_missing'));
  });
});

describe('전문가 틀: [기준]·[용어]·출처 번호·앱이 그리는 사진 자리', () => {
  const body = ['[이미지: (썸네일) 제목 카드]', '[프롬프트: 앱이 그리는 썸네일 — 제미나이 필요 없음]', '## 전기요 고를 때',
    '[기준: 2026년 11월 기준 · 참고: 국가기술표준원]', '[용어: KC 인증 — 국가가 안전 기준을 확인했다는 표시]', '[용어: 과열 방지]',
    '전기요는 ==KC 인증==부터 봐요[^1]. 온도 조절 단계도 봐요[^2].', '[이미지: 침대 위 전기요]', '[프롬프트: 침대 위에 펼친 전기요, 깔끔한 일러스트, 4:3, 글자 없이]',
    '[이미지: (정보 카드) 고르는 기준 표]', '[프롬프트: 앱이 그리는 정보 카드 — 제미나이 필요 없음]'].join('\n');
  const post = { id: 'p', body, program_ids: [], titles: ['전기요 고르는 법'], sources: [{ title: '국가기술표준원 제품안전정보', url: 'https://www.safetykorea.kr/', checked_at: '2026-11-02' }, { url: 'https://www.kats.go.kr/x' }, { url: 'ftp://bad' }] };
  test('본문 읽기: 기준 상자·용어 상자(풀이 없는 용어도), 앱이 그리는 자리 표시', () => {
    const b = parseBody(body);
    assert.deepEqual(b.filter((x) => x.t === 'basis').map((x) => x.text), ['2026년 11월 기준 · 참고: 국가기술표준원']);
    assert.deepEqual(b.filter((x) => x.t === 'term').map((x) => [x.term, x.text]), [['KC 인증', '국가가 안전 기준을 확인했다는 표시'], ['과열 방지', '']]);
    assert.deepEqual(promptsOf(body).map((x) => x.app), [true, false, true]);
    assert.ok(isAppDrawnSlot('(썸네일) 제목') && isAppDrawnSlot('(정보 카드) 표') && !isAppDrawnSlot('침대 위 전기요 (정보 카드)'));
    assert.ok(bodyChars(body) > 0);
  });
  test('붙여넣기(서식): 기준·용어 상자 바탕색, 출처 번호는 작은 [1], 글 끝 참고 자료 (안전한 주소만)', () => {
    const html = exportHtml(post, { links: [], programs: {} });
    assert.ok(html.includes('<b>📌 이 글의 기준</b> 2026년 11월 기준') && html.includes('<b>용어 풀이 · KC 인증</b>'));
    assert.ok(html.includes('<sup style="font-size:.72em;color:#888;">[1]</sup>') && html.includes('[2]</sup>'));
    assert.ok(html.includes('<b>참고 자료</b>') && html.includes('[1] 국가기술표준원 제품안전정보 (2026-11-02 확인)') && html.includes('[2] kats.go.kr') && !html.includes('ftp://'));
    assert.ok(!html.includes('제미나이 필요 없음') && !html.includes('[프롬프트'), '프롬프트 줄은 붙여넣기에서 빠짐');
    const plain = exportPlain(post, { links: [], programs: {} });
    assert.ok(plain.includes('📌 이 글의 기준: 2026년 11월 기준') && plain.includes('※ 용어 풀이 · KC 인증: 국가가') && plain.includes('봐요[1].'));
    assert.match(plain, /참고 자료\n\[1\] 국가기술표준원 제품안전정보 \(2026-11-02 확인\) https:\/\/www\.safetykorea\.kr\/\n\[2\] kats\.go\.kr https:\/\/www\.kats\.go\.kr\/x$/);
    assert.deepEqual(sourceList(post).map((x) => x.n), [1, 2]);
    assert.ok(!exportHtml({ ...post, sources: [] }, { links: [], programs: {} }).includes('참고 자료'));
  });
  test('미리보기: 앱이 그리는 자리는 "앱이 그려줘", 제미나이 프롬프트 모음에서는 빠짐', () => {
    const v = viewHtml(post, [], []);
    assert.ok(v.includes('앱이 그려줘') && v.includes('썸네일 만들기') && v.includes('정보 카드 만들기'));
    assert.ok(v.includes('class="basis"') && v.includes('class="term"') && v.includes('<sup class="fn">[1]</sup>'));
    const pt = promptsText(post);
    assert.ok(pt.includes('침대 위에 펼친 전기요') && !pt.includes('앱이 그리는'));
    assert.ok(pt.startsWith('[사진 2] 침대 위 전기요'), '사진 번호는 본문 순서 그대로');
  });
});

describe('정보 카드·썸네일 후보 (infocards.js)', () => {
  const post = {
    titles: ['[오늘의 증시 11/3] 코스피 **2,600** 회복'], plan_kind: 'market', summary: '코스피 상승\n외국인 순매수\n환율 하락',
    body: '[이미지: (썸네일) 제목 카드]\n## 오늘 지수\n[기준: 11월 3일 장 마감 · 참고: 한국거래소]\n| 지수 | 종가 | 등락 |\n|---|---|---|\n| 코스피 | 2,612.45 | +1.2% |\n| 코스닥 | 745.10 | -0.3% |\n[이미지: (정보 카드) 지수 표]\n## 체크할 것\n- 외국인 수급[^1]\n- 환율\n- ==미국 금리==\n[용어: PER — 주가를 주당순이익으로 나눈 값]',
    figures: [{ label: '코스피 종가', value: '2,612.45', unit: '포인트', as_of: '2026-11-03' }, { label: '', value: '1' }],
    sources: [{ url: 'https://data.krx.co.kr/x' }, { url: 'https://www.bok.or.kr/y' }],
  };
  test('시리즈 이름은 썸네일 위 띠로 따로', () => {
    assert.deepEqual(splitSeries('[오늘의 증시 11/3] 코스피 2,600 회복'), { series: '오늘의 증시 11/3', title: '코스피 2,600 회복' });
    assert.deepEqual(splitSeries('그냥 제목'), { series: '', title: '그냥 제목' });
  });
  test('후보: 썸네일·표·체크리스트·용어·3줄 요약·핵심 숫자 — 강조·출처 표시는 빼고 그림', () => {
    const c = cardCandidates(post);
    assert.deepEqual(c.map((x) => x.type), ['thumb', 'table', 'list', 'term', 'summary', 'figures']);
    assert.deepEqual([c[0].series, c[0].title], ['오늘의 증시 11/3', '코스피 2,600 회복']);
    assert.deepEqual(c[2].items, ['외국인 수급', '환율', '미국 금리']);
    assert.deepEqual(c[5].items, [{ label: '코스피 종가', value: '2,612.45', unit: '포인트', as_of: '2026-11-03' }], '이름 없는 숫자는 뺌');
    assert.deepEqual(cardCandidates({ titles: ['제목'], body: '- 하나\n- 둘' }).map((x) => x.type), ['thumb'], '항목 2개 목록은 카드로 안 만듦');
  });
  test('사진 자리 설명에 맞는 카드 고르기', () => {
    const c = cardCandidates(post);
    const pick = (s) => bestCandidate(c, s).type;
    assert.equal(pick('(썸네일) 제목 카드'), 'thumb');
    assert.equal(pick('(정보 카드) 지수 표'), 'table');
    assert.equal(pick('(정보 카드) 체크리스트'), 'list');
    assert.equal(pick('(정보 카드) 핵심 숫자'), 'figures');
    assert.equal(pick('(정보 카드) 3줄 요약'), 'summary');
    assert.equal(pick('(정보 카드) 용어 풀이'), 'term');
    assert.equal(bestCandidate([], '(정보 카드) 표'), null);
  });
  test('카드 아래 작은 글씨: 기준이 있으면 기준, 없으면 출처 사이트, 둘 다 없으면 비움 · 글 종류별 색', () => {
    assert.equal(footnoteOf(post), '기준 11월 3일 장 마감 · 참고: 한국거래소');
    assert.equal(footnoteOf({ ...post, body: '본문' }), '출처 data.krx.co.kr · bok.or.kr');
    assert.equal(footnoteOf({ body: 'x' }), '');
    assert.equal(themeOf(post), KIND_THEMES.market);
    assert.equal(themeOf({ plan_kind: 'zzz' }), KIND_THEMES['']);
    assert.deepEqual(CARD_SIZES.thumb, [1080, 1080]);
  });
});
