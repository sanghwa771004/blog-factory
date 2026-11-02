// 1.6.0 하루 계획 운영: 원고 형식(제미나이 프롬프트 줄·==강조==·> 핵심 상자), 붙여넣기 서식, 검사, 계획 계산. 실행: npm test
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBody, promptsOf, bodyChars, checkPost, sentences, cleanPlan, planTotal, PLAN_KINDS, DEFAULT_PLAN, SEO_RULES, countImg, INVEST_DISCLAIMER, INVEST_ADVICE,
} from '../checks.js';
import * as L from '../lib.js';
import { parseSlots } from '../images.js';

const BODY = [
  '[이미지: 거실 창가에 놓인 흰색 가습기]',
  '[프롬프트: 햇살이 드는 거실 창가 원목 선반 위에 놓인 상표 없는 흰색 가습기, 정면 45도, 오전 자연광, 따뜻한 색감, 사실적인 사진, 1:1 정사각형, 이미지 안에 글자·로고 없이]',
  '## 가습기 고르기 전에 볼 것',
  '겨울엔 ==습도 40~60%==를 맞추는 게 먼저예요. 제가 써보니 같은 표현은 없어요.',
  '> 핵심: 방 크기보다 **세척 편한지**부터 봐',
  '',
  '[이미지: 분리한 물통을 씻는 손]',
  '',
  '[프롬프트: 주방 개수대에서 분리한 가습기 물통을 씻는 손, 위에서 본 구도, 4:3, 글자 없이]',
  '## 정리',
  '- 세척 쉬운 구조',
  '[프롬프트: 앞에 사진 자리가 없는 프롬프트 줄은 버림]',
  '[이미지: 침실 협탁 위 작은 가습기 (제품 사진)]',
].join('\n');

describe('원고 형식 (checks.js parseBody · promptsOf · bodyChars)', () => {
  test('사진 자리 바로 아래 [프롬프트: …] 는 그 사진의 프롬프트 (빈 줄은 건너뜀), 앞에 사진 자리가 없으면 버림', () => {
    const b = parseBody(BODY);
    assert.deepEqual(b.map((x) => x.t), ['img', 'h', 'p', 'note', 'img', 'h', 'ul', 'img']);
    assert.match(b[0].prompt, /^햇살이 드는 거실 창가/);
    assert.match(b[4].prompt, /^주방 개수대에서/);
    assert.equal(b[7].prompt, undefined, '프롬프트 없는 사진 자리');
    assert.ok(!JSON.stringify(b).includes('버림'), '사진 자리 뒤가 아닌 프롬프트 줄은 본문에도 안 남음');
    assert.deepEqual(promptsOf(BODY).map((x) => [x.n, !!x.prompt]), [[1, true], [2, true], [3, false]]);
    assert.equal(countImg(BODY), 3, '사진 자리 수는 그대로 (프롬프트 줄은 안 셈)');
  });

  test('> 줄은 핵심 상자(note), 본문 글자 수는 프롬프트·사진 자리·강조 표시를 빼고 셈', () => {
    const n = bodyChars(BODY);
    const expect = ['가습기 고르기 전에 볼 것', '겨울엔 습도 40~60%를 맞추는 게 먼저예요. 제가 써보니 같은 표현은 없어요.', '핵심: 방 크기보다 세척 편한지부터 봐', '정리', '세척 쉬운 구조']
      .reduce((a, s) => a + s.length, 0);
    assert.equal(n, expect);
    assert.ok(n < BODY.length / 2, '프롬프트가 길어도 글자 수에 안 들어감');
  });

  test('문장 검사에 프롬프트는 안 들어감 (프롬프트 속 표현으로 써본 척 오류가 나지 않게)', () => {
    const body = '## 소제목\n정보 문장이에요.\n[이미지: 손]\n[프롬프트: 제가 한 달 동안 써보니 좋았다는 느낌의 따뜻한 사진, 글자 없이]';
    assert.ok(!sentences(body).some((s) => s.text.includes('써보니')));
    const r = checkPost({ titles: ['제목'], body: body + '\n' + '내용 문장이에요. '.repeat(30), channel_id: 'naver_blog', program_ids: [] }, { channels: { naver_blog: { id: 'naver_blog', name: '네이버 블로그', kind: 'blog' } } });
    assert.ok(!r.errors.some((e) => e.code === 'fake_experience'));
  });
});

describe('네이버 붙여넣기 서식 (lib.js exportHtml · exportPlain · viewHtml)', () => {
  const post = { body: BODY, program_ids: [] };
  test('소제목은 24px 굵게(바깥 h2 와 안쪽 span 둘 다), ==강조== 는 노란 바탕, > 상자는 연두 바탕, 프롬프트는 안 들어감', () => {
    const html = L.exportHtml(post, {});
    assert.match(html, /<h2 style="font-size:24px;[^"]*"><span style="font-size:24px;"><b>가습기 고르기 전에 볼 것<\/b><\/span><\/h2>/);
    assert.match(html, /<span style="background-color:#fff0a0;"><b>습도 40~60%<\/b><\/span>/);
    assert.match(html, /<p style="[^"]*background-color:#e3f4ea;"><span style="background-color:#e3f4ea;">핵심: 방 크기보다 <b>세척 편한지<\/b>부터 봐<\/span><\/p>/);
    assert.ok(!html.includes('햇살이 드는') && !html.includes('[프롬프트'), '붙여넣는 글에는 프롬프트가 없음');
    assert.match(html, /📷 사진 1: 거실 창가에 놓인 흰색 가습기 \(여기에 사진 넣기\)/);
    assert.ok(!html.includes('=='));
  });
  test('텍스트만 복사도 강조 표시·프롬프트 없이, 핵심 상자는 ▶', () => {
    const plain = L.exportPlain(post, {});
    assert.ok(!plain.includes('==') && !plain.includes('햇살이 드는'));
    assert.ok(plain.includes('▶ 핵심: 방 크기보다 세척 편한지부터 봐'));
  });
  test('앱 미리보기: 사진 자리 아래에 프롬프트와 복사 버튼(data-prompt 번호), 강조는 mark, 상자는 note', () => {
    const v = L.viewHtml(post, [], null);
    assert.match(v, /<div class="gprompt"><div class="gp-h"><b>제미나이 프롬프트 · 사진 1<\/b><button type="button" class="copy" data-prompt="1">프롬프트 복사<\/button><\/div><p>햇살이 드는/);
    assert.match(v, /data-prompt="2"/);
    assert.ok(!v.includes('data-prompt="3"'), '프롬프트가 없는 자리는 버튼 없음');
    assert.match(v, /<mark>습도 40~60%<\/mark>/);
    assert.match(v, /<p class="note">/);
  });
  test('프롬프트 모두 복사: 사진 번호·설명·프롬프트', () => {
    const t = L.promptsText(post);
    assert.match(t, /^\[사진 1\] 거실 창가에 놓인 흰색 가습기\n햇살이 드는/);
    assert.match(t, /\n\n\[사진 2\] 분리한 물통을 씻는 손\n주방 개수대에서/);
    assert.ok(!t.includes('[사진 3]'));
  });
  test('프롬프트 안 HTML 은 글자로 (스크립트로 안 돎)', () => {
    const v = L.viewHtml({ body: '[이미지: a]\n[프롬프트: <img src=x onerror=alert(1)> 사진]' }, [], null);
    assert.ok(!v.includes('<img src=x') && v.includes('&lt;img src=x'));
  });
});

describe('검사 (checkPost) — 1.6.0', () => {
  const channels = { naver_blog: { id: 'naver_blog', name: '네이버 블로그', kind: 'blog' } };
  const filler = '\n' + '읽을 만한 정보 문장이에요. '.repeat(25);
  const run = (post, ctx = {}) => checkPost({ titles: ['제목 하나'], channel_id: 'naver_blog', program_ids: [], keyword: '겨울 가습기 세척 쉬운 제품', ...post }, { channels, ...ctx });
  const codes = (r) => [...r.errors, ...r.warnings, ...r.tips].map((x) => x.code);

  test('사진 자리 3~6곳 기준 (밖이면 알려만 줌), 계획 글은 프롬프트 빠진 자리를 알려줌', () => {
    const two = '[이미지: a]\n[프롬프트: a]\n[이미지: b]\n[프롬프트: b]' + filler;
    assert.ok(codes(run({ body: two })).includes('image_count'));
    assert.ok(!codes(run({ body: two + '\n[이미지: c]\n[프롬프트: c]' })).includes('image_count'));
    const seven = Array.from({ length: 7 }, (_, i) => `[이미지: ${i}]\n[프롬프트: ${i}]`).join('\n') + filler;
    assert.ok(codes(run({ body: seven })).includes('image_count'));
    assert.equal(SEO_RULES.imagesMin, 3); assert.equal(SEO_RULES.imagesMax, 6);
    const noPrompt = '[이미지: a]\n[프롬프트: a]\n[이미지: b]\n[이미지: c]' + filler;
    assert.ok(codes(run({ body: noPrompt, plan_kind: 'adpost' })).includes('image_prompt_missing'));
    assert.ok(!codes(run({ body: noPrompt })).includes('image_prompt_missing'), '계획 글이 아니면 안 따짐');
  });

  test('투자 글: 안내 문구가 없으면 확인, 사라·목표가 같은 권유 문장은 확인 (부정문·안내 문장은 빼고)', () => {
    const base = '## 오늘 코스피\n코스피는 하락 마감했어요.' + filler;
    assert.ok(codes(run({ body: base, plan_kind: 'market', content_type: 'market_summary', sources: [{ url: 'https://x.kr' }] })).includes('invest_disclaimer'));
    const ok = base + '\n이 글은 공개된 정보를 정리한 것이고 투자 권유가 아니에요. 투자 판단과 책임은 본인에게 있어요.';
    const r = run({ body: ok, plan_kind: 'market', content_type: 'market_summary', sources: [{ url: 'https://x.kr' }] });
    assert.ok(!codes(r).includes('invest_disclaimer') && !codes(r).includes('invest_advice'));
    const pushy = ok + '\n지금 사세요. 목표 주가 120000원까지 갈 거예요.\n매수 추천이 아니에요.';
    const w = run({ body: pushy, plan_kind: 'stock', content_type: 'stock_analysis', sources: [{ url: 'https://x.kr' }] }).warnings.find((x) => x.code === 'invest_advice');
    assert.ok(w && w.examples.length === 2, '권유 문장 두 개만 (부정문은 뺌)');
    assert.ok(codes(run({ body: base, content_type: 'stock_analysis' })).includes('news_no_sources'), '종목 설명은 출처 필수');
    assert.match(run({ body: base, content_type: 'stock_analysis' }).errors.find((e) => e.code === 'news_no_sources').msg, /^종목 설명인데/);
    assert.ok(!INVEST_DISCLAIMER.test('투자해 보세요'));
    assert.ok(INVEST_ADVICE.test('무조건 오른다') && !INVEST_ADVICE.test('주가가 올랐어요'));
  });

  test('계획 글(쿠팡·토스 말고)은 주력 주제·내 경험 없음 확인을 안 함', () => {
    const ctx = { focus: '계절템·겨울 가전', focusTerms: '가습기' };
    const body = '## 코스피 마감\n오늘 시장 정리예요.' + filler;
    const off = run({ body, keyword: '코스피 마감 외국인 순매도 이유' }, ctx);
    assert.ok(codes(off).includes('off_focus') || codes(off).includes('focus_unclear'));
    assert.ok(codes(off).includes('no_own_experience'));
    const plan = run({ body, keyword: '코스피 마감 외국인 순매도 이유', plan_kind: 'market' }, ctx);
    assert.ok(!['off_focus', 'focus_unclear', 'no_own_experience'].some((c) => codes(plan).includes(c)));
    const aff = run({ body, keyword: '코스피 마감 외국인 순매도 이유', plan_kind: 'affiliate' }, ctx);
    assert.ok(codes(aff).includes('off_focus') || codes(aff).includes('focus_unclear'), '쿠팡·토스 글은 주력 주제 검사');
  });
});

describe('하루 계획 계산 (lib.js)', () => {
  test('cleanPlan·planTotal: 알려진 종류만, 0~4 정수', () => {
    assert.deepEqual(cleanPlan({ affiliate: 9, crypto: 3, adpost: 2.5, trending: '2', market: -1 }), { affiliate: 4, adpost: 0, trending: 2, market: 0, stock: 0 });
    assert.equal(planTotal(DEFAULT_PLAN), 10);
    assert.equal(planTotal({}), 0);
    assert.deepEqual(Object.keys(PLAN_KINDS), Object.keys(DEFAULT_PLAN));
  });
  test('planProgress: 서버가 준 오늘 수(올리고 지운 글 포함)로 실행별 진행, 없으면 목록의 오늘 자동 원고로', () => {
    const settings = { daily_plan: DEFAULT_PLAN, keep_days: 3 };
    const p = L.planProgress({ settings, planToday: { plan: DEFAULT_PLAN, done: { affiliate: 3, adpost: 1 } } });
    assert.deepEqual(p.runs.map((r) => [r.run, r.done, r.target]), [['morning', 3, 4], ['midday', 0, 2], ['evening', 0, 4]], '목표보다 많이 쓴 건 목표까지만');
    assert.equal(p.total, 10); assert.equal(p.done, 3); assert.equal(p.active, true);
    const today = '2026-11-02';
    const posts = [
      { source: 'auto', plan_kind: 'market', created_at: '2026-11-02T10:00:00Z' },      // 한국 19시 → 오늘
      { source: 'auto', plan_kind: 'market', created_at: '2026-11-01T14:59:59Z' },      // 한국 11/1 23:59 → 어제
      { source: 'request', plan_kind: '', created_at: '2026-11-02T01:00:00Z' },
    ];
    const q = L.planProgress({ settings, planToday: null, posts, today });
    assert.equal(q.runs[2].kinds.find((k) => k.kind === 'market').done, 1);
    assert.equal(L.planProgress({ settings: { daily_plan: {} } }).active, false);
  });
  test('expiresOn: 자동 원고만 만든 한국 날짜 + 보관일, 보관·요청 글은 없음', () => {
    const st = { keep_days: 3 };
    assert.equal(L.expiresOn({ source: 'auto', created_at: '2026-11-01T15:30:00Z' }, st), '2026-11-05', '한국 11/2 00:30 에 만든 글 → 11/5 정리');
    assert.equal(L.expiresOn({ source: 'auto', keep: true, created_at: '2026-11-01T15:30:00Z' }, st), null);
    assert.equal(L.expiresOn({ source: 'request', created_at: '2026-11-01T15:30:00Z' }, st), null);
    assert.equal(L.keepDaysOf({ keep_days: 99 }), 3, '이상한 값은 기본 3일');
  });
  test('쌓인 원고 한도: 계획이 있으면 합계 × 보관일 (DB backlog_state 와 같음)', () => {
    assert.equal(L.backlogInfo([], { daily_plan: DEFAULT_PLAN, keep_days: 3 }).limit, 30);
    assert.equal(L.backlogInfo([], { daily_plan: DEFAULT_PLAN, keep_days: 2, backlog_limit: 5 }).limit, 20, '계획이 있으면 한도 칸보다 계획');
    assert.equal(L.backlogInfo([], { daily_plan: {}, backlog_limit: 5 }).limit, 5);
  });
});

describe('사진 자리 (images.js parseSlots) — 프롬프트 줄', () => {
  test('자리마다 prompt, 앞뒤 문맥에 프롬프트 줄은 안 들어감, 자리 열쇠는 설명으로만', () => {
    const s = parseSlots('## 소제목\n앞 문장\n[이미지: 창가 가습기]\n\n[프롬프트: 창가 선반 위 흰 가습기]\n뒤 문장\n[이미지: 손]');
    assert.equal(s[0].prompt, '창가 선반 위 흰 가습기');
    assert.equal(s[0].after, '뒤 문장');
    assert.equal(s[1].prompt, '');
    const again = parseSlots('## 소제목\n앞 문장\n[이미지: 창가 가습기]\n[프롬프트: 완전히 다른 프롬프트]\n뒤 문장');
    assert.equal(again[0].key, s[0].key, '프롬프트를 고쳐도 같은 자리 (이미지 연결 유지)');
  });
});
