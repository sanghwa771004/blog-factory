// 1.8.0 홈판 점검 (checks.js feedCheck · thumbText · uniqueSentence) — 원고만 보고 계산하는 참고 점수
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { feedCheck, thumbText, uniqueSentence, FEED_RULES, CLICKBAIT } from '../checks.js';

const CTX = { focus: '계절템·겨울 가전', focusTerms: '히터, 전기요, 탄소매트, 온수매트, 가습기, 제습기, 손난로, 난방, 결로', autoTopics: '계절템·겨울 가전, 디지털·전자기기' };
const good = [
  '[이미지: (썸네일) 거실 가습기 고르기]',
  '[프롬프트: 앱이 그리는 썸네일 — 제미나이 필요 없음]',
  '> 핵심: 거실이면 용량보다 세척 쉬운지부터 봐요.',
  '## 거실 가습기, 왜 세척이 먼저일까?',
  '[기준: 2026년 11월 6일 기준 · 참고: 한국소비자원]',
  '물때가 끼면 냄새가 먼저 올라오거든요. 그래서 통이 넓게 열리는 게 편해요.',
  '[이미지: 물통을 씻는 손]', '[이미지: 거실 창가 가습기]', '[이미지: 분리한 물통]', '[이미지: 필터 비교]', '[이미지: (정보 카드) 체크리스트]',
  '## 이런 분께는 안 맞아요',
  '방이 아주 넓으면 한 대로는 부족할 수 있어요.',
].join('\n');
const byKey = (r) => Object.fromEntries(r.items.map((x) => [x.key, x]));

describe('1.8.0 홈판 점검', () => {
  test('잘 갖춘 원고: 썸네일 첫 자리·문구가 제목과 같은 이야기·맨 위 핵심·주제·짧은 문단·사진 6장·기준 상자', () => {
    const r = feedCheck({ titles: ['거실 가습기 고르기, 세척 쉬운 제품 3가지 기준'], keyword: '거실 가습기 세척 쉬운 제품', body: good }, CTX);
    const k = byKey(r);
    for (const key of ['thumb', 'thumb_match', 'top_summary', 'title_len', 'title_hook', 'no_bait', 'topic', 'short_para', 'images', 'fresh']) assert.equal(k[key].ok, true, key);
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
    assert.equal(k.images.ok, false);
    assert.ok(r.score < 60 && r.verdict === '손볼 곳 있음', r.score);
  });
  test('제목 길이: 시리즈 이름은 빼고 셈, 25~40자 ✓ · 18~24/41~50 △ · 그 밖 ✗', () => {
    const t = (title) => byKey(feedCheck({ titles: [title], body: good }, {})).title_len.ok;
    assert.equal(t('[오늘의 증시 11/6] 코스피 마감, 외국인 순매도가 이어진 이유 3가지'), true);
    assert.equal(t('거실 가습기 세척 쉬운 제품 고르기'), null);
    assert.equal(t('가습기 고르기'), false);
    assert.equal(t('가'.repeat(41)), null);
    assert.equal(t('가'.repeat(51)), false);
    assert.equal(FEED_RULES.titleGoodMin, 25); assert.equal(FEED_RULES.titleGoodMax, 40);
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
