// checks.js — 앱(브라우저)과 서버(Edge Function)가 같이 쓰는 원고 규칙
// 화면 코드 없음. 같은 파일을 서버에도 그대로 올려서 '발행 준비 완료' 검사를 서버에서 한 번 더 함.

export const STAGES = {
  queued: { label: '원고 생성 대기', group: 'work' },
  researching: { label: '자료 조사 중', group: 'work' },
  verify: { label: '자료 검증 필요', group: 'you' },
  writing: { label: '원고 생성 중', group: 'work' },
  review: { label: '검수 필요', group: 'you' },
  ready: { label: '발행 준비 완료', group: 'ready' },
  scheduled: { label: '발행 예약', group: 'ready' },
  published: { label: '게시 완료', group: 'live' },
  collecting: { label: '실적 수집 중', group: 'live' },
  analyzed: { label: '성과 분석 완료', group: 'live' },
  failed: { label: '작업 실패', group: 'fail' },
};

// 사람이 직접 바꿀 수 있는 상태 (자동 작가가 바꾸는 대기·작성 중·검수 필요는 DB 함수가 처리)
export const USER_TRANSITIONS = {
  review: ['ready'],
  verify: ['queued'],
  failed: ['queued'],
  ready: ['review', 'scheduled', 'published'],
  scheduled: ['ready', 'published'],
  published: ['ready', 'collecting', 'analyzed'],
  collecting: ['published', 'analyzed'],
  analyzed: ['collecting'],
};

export const CONTENT_TYPES = {
  comparison: { label: '상품 비교', minProducts: 2 },
  buying_guide: { label: '구매 가이드' },
  problem_solving: { label: '문제 해결 정보' },
  how_to: { label: '사용 설명서' },
  experience_review: { label: '실제 경험 후기', needsExperience: true },
  pros_cons: { label: '장단점 분석', minProducts: 1 },
  checklist: { label: '체크리스트' },
  news_summary: { label: '최신 정보 요약', needsSources: true },
  faq: { label: '자주 묻는 질문' },
  tutorial: { label: '튜토리얼' },
  sns_short: { label: 'SNS용 짧은 글', short: true },
  // 1.6.0 하루 계획의 저녁 글 — 숫자는 확인한 출처로만, 투자 권유 아님 안내 필수 (checkPost 의 invest_* 검사)
  market_summary: { label: '증시 정리', needsSources: true, invest: true },
  stock_analysis: { label: '종목 설명', needsSources: true, invest: true },
};

// ───────── 하루 계획 (1.6.0) ─────────
// 자동 작가가 하루에 쓰는 종류와 실행 시각. 편수는 설정(settings.daily_plan, 종류마다 0~4), 시각은 예약 작업 (docs/auto-writer-prompt.md)
// DB 020 의 posts.plan_kind 검사·plan_total() 과 같은 종류 — tests/sync.test.js 가 서로 맞는지 확인
export const PLAN_RUNS = {
  morning: { label: '아침', time: '오전 8:51' },
  midday: { label: '점심', time: '오후 1:21' },
  evening: { label: '저녁', time: '저녁 6:51' },
};
export const PLAN_KINDS = {
  affiliate: { label: '쿠팡·토스 링크 글', short: '쿠팡·토스', run: 'morning', programs: ['coupang_partners', 'toss_sharelink'] },
  adpost: { label: '애드포스트 유입 글', short: '애드포스트', run: 'morning', programs: ['naver_adpost'] },
  trending: { label: '오늘 뜬 주제 (홈판)', short: '오늘 이슈', run: 'midday', programs: ['naver_adpost'] },
  market: { label: '미국·한국 증시 정리', short: '증시 정리', run: 'evening', programs: ['naver_adpost'], invest: true },
  stock: { label: '미국·한국 종목 설명', short: '종목 설명', run: 'evening', programs: ['naver_adpost'], invest: true },
};
export const DEFAULT_PLAN = { affiliate: 2, adpost: 2, trending: 2, market: 2, stock: 2 };
export const PLAN_MAX_PER_KIND = 4;
export const KEEP_DAYS = { def: 3, min: 1, max: 14 };
// 설정값 → 알려진 종류만, 0~4 정수로 (이상한 값은 0)
export function cleanPlan(plan) {
  const o = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : {};
  const out = {};
  for (const k of Object.keys(PLAN_KINDS)) {
    const n = Number(o[k]);
    out[k] = Number.isInteger(n) && n >= 0 ? Math.min(n, PLAN_MAX_PER_KIND) : 0;
  }
  return out;
}
export const planTotal = (plan) => Object.values(cleanPlan(plan)).reduce((a, n) => a + n, 0);

export const SCORE_FACTORS = {
  demand: '검색 수요',
  intent: '구매 의도',
  competition: '경쟁도 (낮을수록 높은 점수)',
  product_info: '상품 정보 확보 가능성',
  differentiation: '차별화 가능성',
  monetization: '예상 수익화 가능성',
  effort: '제작 시간·비용 (적게 들수록 높은 점수)',
};

// ───────── 본문 형식 ─────────
// "## " 소제목, "- " 목록, "| a | b |" 표, "[이미지: …]" 사진 자리, "[링크: …]" 제휴 링크 자리, "[내 경험: …]" 직접 채울 자리
export function parseBody(md) {
  const blocks = [];
  let list = null, tbl = null;
  const flushList = () => { if (list) { blocks.push({ t: 'ul', items: list }); list = null; } };
  const flushTbl = () => { if (tbl) { blocks.push({ t: 'table', rows: tbl }); tbl = null; } };
  for (const raw of String(md || '').split('\n')) {
    const l = raw.trim();
    if (/^\|.*\|$/.test(l)) {
      flushList();
      if (/^\|[\s\-|:]+\|$/.test(l)) continue;
      (tbl = tbl || []).push(l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      continue;
    }
    if (/^[-•*]\s+/.test(l)) { flushTbl(); (list = list || []).push(l.replace(/^[-•*]\s+/, '')); continue; }
    flushList(); flushTbl();
    if (!l) continue;
    // 1.6.0: 사진 자리 바로 아래 "[프롬프트: …]" 줄은 그 사진을 만들 제미나이 프롬프트 — 본문 글이 아니라서 따로 들고 다님 (내보낼 때 빠짐)
    if (PROMPT_LINE.test(l)) {
      const last = blocks[blocks.length - 1];
      if (last && last.t === 'img' && last.prompt == null) last.prompt = promptTextOf(l);
      continue;
    }
    if (/^#{1,4}\s/.test(l)) blocks.push({ t: 'h', text: l.replace(/^#+\s/, '') });
    // full: 줄 전체가 [이미지: …] 인 '사진 자리' (images.js 의 parseSlots·countImg 와 같은 기준 → 이미지 연결 순서가 맞음)
    else if (/^\[이미지/.test(l)) blocks.push({ t: 'img', text: l.replace(/^\[이미지:?\s*|\]$/g, ''), full: /^\[이미지[^\]]*\]$/.test(l) });
    else if (/^\[링크/.test(l)) blocks.push({ t: 'cta', text: l.replace(/^\[링크\s*\d*\s*:?\s*|\]$/g, '') });
    // 1.6.0: "> " 줄은 눈에 띄게 바탕색을 칠하는 핵심 상자 (예전엔 그냥 문단)
    else if (/^>\s?/.test(l)) blocks.push({ t: 'note', text: l.replace(/^>\s?/, '') });
    else blocks.push({ t: 'p', text: l });
  }
  flushList(); flushTbl();
  return blocks;
}
export const PROMPT_LINE = /^\s*\[프롬프트/;
const promptTextOf = (l) => l.trim().replace(/^\[프롬프트\s*\d*\s*:?\s*/, '').replace(/\]\s*$/, '').trim();
// 사진 자리(줄 전체가 [이미지: …])마다 순서대로 { n, text: 사진 설명, prompt: 제미나이 프롬프트('' = 없음) }
export function promptsOf(body) {
  const out = [];
  for (const b of parseBody(body)) if (b.t === 'img' && b.full) out.push({ n: out.length + 1, text: b.text, prompt: b.prompt || '' });
  return out;
}
// 본문 글자 수 (공백 포함) — 독자가 읽는 글만: 소제목·문단·목록·표 칸·핵심 상자. 사진 자리·프롬프트·링크 자리·강조 표시(**, ==)는 빼고 셈
export function bodyChars(body) {
  let n = 0;
  for (const b of parseBody(body)) {
    const parts = b.t === 'ul' ? b.items : b.t === 'table' ? b.rows.flat() : (b.t === 'img' || b.t === 'cta') ? [] : [b.text || ''];
    for (const s of parts) n += stripMd(s).replace(ME_RE, '').trim().length;
  }
  return n;
}

export const ME_RE = /\[내 경험[^\]]*\]/g;
export const countMe = (body) => (String(body || '').match(ME_RE) || []).length;
export const countImg = (body) => (String(body || '').match(/^\s*\[이미지[^\]]*\]\s*$/gm) || []).length;
export const countCta = (body) => (String(body || '').match(/^\s*\[링크[^\]]*\]\s*$/gm) || []).length;
export const removeEmptyMe = (body) => String(body || '').replace(/^\s*\[내 경험[^\]]*\]\s*$\n?/gm, '').replace(ME_RE, '');

// ───────── 고지문 ─────────
export function disclosureFor(programIds, programsById) {
  const texts = [];
  const missing = [];
  const unknown = [];
  for (const id of programIds || []) {
    const p = programsById && programsById[id];
    if (!p || p.needs_disclosure === '불필요') continue;
    const t = String(p.disclosure_template || '').trim();
    if (t) { if (!texts.includes(t)) texts.push(t); }
    else if (p.needs_disclosure === '필요') missing.push(p);
    else unknown.push(p);
  }
  return { text: texts.join('\n'), missing, unknown };
}

export function compatOf(programId, channelId, compat) {
  const row = (compat || []).find((c) => c.program_id === programId && c.channel_id === channelId);
  return row ? row : { program_id: programId, channel_id: channelId, verdict: '확인 필요', reason: '아직 확인하지 않은 조합', source_url: '' };
}

// ───────── 문장 도우미 ─────────
// **굵게** 와 ==바탕색 강조== (1.6.0) 표시를 뺀 글
const stripMd = (s) => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/==(.+?)==/g, '$1');
export function sentences(body) {
  const out = [];
  for (const b of parseBody(body)) {
    const parts = b.t === 'ul' ? b.items : b.t === 'table' ? b.rows.map((r) => r.join(' | ')) : [b.text || ''];
    for (const part of parts) {
      for (const s of stripMd(part).split(/(?<=[.!?。])\s+/)) {
        const t = s.trim();
        if (t) out.push({ text: t, kind: b.t });
      }
    }
  }
  return out;
}
const clip = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

const FAKE_EXPERIENCE = [
  /(직접|실제로|제가|저는|내가|나는|저희|우리)\s*[^.!?\n]{0,12}(써|사용해|이용해|입어|먹어|발라)\s*(보니|봤|보았|보면서)/,
  /(제가|저는|내가|나는)\s*[^.!?\n]{0,12}(써|사용해|이용해)\s*본/,
  /내돈내산/,
  /(한\s*달|일주일|보름|[0-9]+\s*(일|주|주일|개월|달|년))\s*(째|동안|간|정도)?\s*(써|사용|이용)(해)?\s*(보니|봤|보았|중)/,
  /(제가|저는|내가|나는|저희|우리)\s*[^.!?\n]{0,12}(샀|구매했|구입했|주문했)/,
];
const OTHERS_EXPERIENCE = /(사람들|분들|사용자들|후기를 보면|리뷰를 보면|후기들|리뷰들)/;
// "매장에서 직접 사용해 보면서 비교해 보세요", "일주일 사용 중 고장이 나면…" 같은 안내·조건 문장은 써본 척이 아님.
// 단, '제가·저는' 같은 1인칭이나 '써보니·샀는데' 같은 겪은 일 표현이 있으면 안내 문장이어도 그대로 검사해.
const ADVICE = /(보세요|하세요|해\s*보세요|십시오|보자|하자|해\s*봐|면\s|면,|다면|라면|려면|경우|할\s*때|일\s*때|는\s*게\s*좋|보는\s*게)/;
const FIRST_PERSON = /(제가|저는|저도|내가|나는|나도|저희|우리\s*집|제\s*방|제\s*경험)/;
const PAST_EXPERIENCE = /(보니|봤|보았|샀|구매했|구입했|주문했|내돈내산|써\s*본|사용해\s*본)/;
export const isFakeExperience = (text) => !OTHERS_EXPERIENCE.test(text)
  && !(ADVICE.test(text) && !FIRST_PERSON.test(text) && !PAST_EXPERIENCE.test(text))
  && FAKE_EXPERIENCE.some((re) => re.test(text));
const HYPE = ['무조건', '100%', '역대급', '최저가 보장', '부작용 없', '완벽한', '절대 후회', '인생템', '1등', '최고의 선택'];
const PRICE_EXACT = /(\d{1,3}(?:,\d{3})+|\d{4,})\s*원(?!\s*(대|이하|이상|안팎|선|미만|초과|부터|까지|정도|내외))|\d+(?:\.\d+)?\s*만\s*원(?!\s*(대|이하|이상|안팎|선|미만|초과|부터|까지|정도|내외))/;
const PRICE_RANGE = /\d+(?:\.\d+)?\s*만?\s*원\s*(대|이하|이상|안팎|선|미만|초과|정도|내외)/;
const NUM_CLAIM = /\d[\d,.]*\s*(%|퍼센트|배\b|kWh|kW|W\b|와트|mAh|dB|℃|시간|kg|리터)/;
const DISCLOSURE_MARK = /(광고|협찬|제휴|파트너스|수수료|소정의|대가)/;
// '받을 수 있음', '지급될 수 있습니다', '발생할 수도 있어요'처럼 조건을 붙인 표현 (띄어쓰기가 달라도)
export const VAGUE_DISCLOSURE = /(받을|제공받을|지급받을|받게\s*될|받으실|지급될|제공될|발생할|생길)\s*수\s*(도)?\s*있/;

function shingles(text, n = 4) {
  const s = String(text || '').replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i + n <= s.length; i += 2) set.add(s.slice(i, i + n));
  return set;
}
export function similarity(a, b) {
  const A = shingles(a), B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// ───────── 검색 노출 점검 (앱의 권장 기준 — 검색 순위 공식이 아님) ─────────
// 아래 숫자는 네이버가 밝힌 기준이 아니라 앱이 정한 권장 기준이야. 검색량·경쟁도는 조회하지 않아.
// 자동 작가 프롬프트(docs/auto-writer-prompt.md)도 같은 값을 써 — tests/sync.test.js 가 서로 맞는지 확인
export const SEO_RULES = { minKeywordWords: 3, maxLinks: 2, earlyLinkShare: 0.15, focusShareGoal: 0.7, perDayRecommended: 1, imagesMin: 3, imagesMax: 6 };
// 투자 글 (1.6.0): '투자 권유 아님' 안내와, 권유로 읽히는 표현
export const INVEST_DISCLAIMER = /투자\s*(를\s*)?(권유|권고|추천|조언)[^.!?\n]{0,12}(아니|아닙|아님|않)|투자\s*판단[^.!?\n]{0,20}(본인|스스로|책임)|투자의?\s*(책임|결과)[^.!?\n]{0,10}(본인|투자자)/;
export const INVEST_ADVICE = /(지금|당장|꼭|무조건)\s*(사|매수|담|팔|매도)(세요|야|자|하세요|해야)|매수\s*(추천|하세요|타이밍)|매도\s*(추천|하세요|타이밍)|목표\s*(주가|가)\s*[0-9]|수익\s*보장|무조건\s*(오른|상승|수익)|강력\s*추천\s*종목|급등\s*예상/;

// 낱말 나누기: 공백·가운뎃점·쉼표·빗금·괄호로 나누고 min 글자 이상만
const topicWords = (s, min = 2) => [...new Set(String(s || '').toLowerCase().split(/[\s·,/|&+()]+/).map((w) => w.trim()).filter((w) => w.length >= min))];
// 카테고리 이름이 주력 주제와 이어지는지 (같은 말·포함·낱말 앞부분이 같음). 카테고리는 약한 근거라서 이것만으로 주제 일치를 정하지 않아 (focusFit)
export function focusMatch(category, focus) {
  const f = String(focus || '').trim();
  if (!f) return true;
  const c = String(category || '').trim();
  if (!c) return false;
  if (c === f || (f.length >= 2 && c.includes(f)) || (c.length >= 2 && f.includes(c))) return true;
  const fw = topicWords(f);
  return topicWords(c).some((w) => fw.some((x) => w === x || w.startsWith(x) || x.startsWith(w)));
}
// 설정의 '주력 주제 낱말'(쉼표로 구분). 한 글자 낱말(책·술·옷)도 받음 — 한 글자는 낱말 그대로일 때만 찾음
const ownTerms = (extra) => [...new Set(String(extra || '').toLowerCase().split(/[,，、\n]+/).map((w) => w.replace(/\s+/g, ' ').trim()).filter((w) => w.length >= 1))].slice(0, 30);
// 주력 주제 이름의 낱말 (2글자 이상, 한 글자 주제면 그 글자)
const baseTerms = (focus) => { const w = topicWords(focus); return w.length ? w : topicWords(focus, 1); };
// 주력 주제 낱말 전체: 주력 주제 이름의 낱말 + 설정의 '주력 주제 낱말'
export function focusTerms(focus, extra) {
  const out = [];
  for (const w of [...baseTerms(focus), ...ownTerms(extra)]) if (!out.includes(w)) out.push(w);
  return out.slice(0, 40);
}
const normT = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const reEsc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EDGE = '(^|[\\s·,/|()\\[\\]"\'“”‘’!?.:;~-])', EDGE_END = '($|[\\s·,/|()\\[\\]"\'“”‘’!?.:;~-])';
const JOSA = '(은|는|이|가|을|를|의|에|에서|도|만|과|와|로|으로|용)?';
// 낱말 찾기 규칙
//  - 영어·숫자 낱말: 낱말 경계로만 ('it' 이 'limited' 안에서 걸리지 않게)
//  - 띄어 쓴 여러 낱말('전기 장판'): 띄어쓰기가 달라도 ('전기장판')
//  - 한 글자 낱말(책·술): 낱말 그대로(+조사)일 때만 ('책상'에서 안 걸리게)
//  - 그 밖의 한국어 낱말: 한 낱말 안에서만 (띄어쓰기를 넘지 않음 — '전기요'가 '전기 요금'에서 안 걸리게, '히터'는 '전기히터'에서 걸림)
const reCache = new Map();
function termRe(w) {
  if (reCache.has(w)) return reCache.get(w);
  const parts = w.split(' ').filter(Boolean).map(reEsc);
  let re;
  if (/^[a-z0-9][a-z0-9 .+#-]*$/i.test(w)) re = new RegExp(`(^|[^a-z0-9])${parts.join('\\s*')}($|[^a-z0-9])`, 'gi');
  else if (parts.length > 1) re = new RegExp(parts.join('\\s*'), 'g');
  else if (w.length === 1) re = new RegExp(`${EDGE}${parts[0]}${JOSA}${EDGE_END}`, 'g');
  else re = new RegExp(parts[0], 'g');
  if (reCache.size > 500) reCache.clear();
  reCache.set(w, re);
  return re;
}
const countIn = (text, w) => (normT(text).match(termRe(w)) || []).length;
const termsIn = (text, terms) => terms.filter((w) => countIn(text, w) > 0);
// 주력 주제와 맞는지 — 외부 AI 없이 낱말로만 봄. 근거를 같이 돌려줌
//   주된 근거: 키워드·제목 / 약한 근거: 카테고리 / 보조 근거: 소제목·본문
//   match = 키워드나 제목에 ① 설정의 '주력 주제 낱말', ② 주력 주제 이름 전체, ③ 주력 주제 이름의 낱말 두 개 이상 중 하나가 있음
//           (주력 주제가 한 낱말이면 그 낱말)
//   unclear(판단 어려움) = 키워드·제목에 주력 주제 이름의 낱말이 하나뿐('겨울'처럼 넓을 수 있음)이거나, 소제목·본문에만 있거나,
//                          본문이 없는 기록(게시 기록만 남긴 글)인데 카테고리만 맞음
//   off = 그 밖 — 본문이 있는 글에서 카테고리만 주력 주제로 적은 글도 여기 (카테고리만으로는 통과시키지 않음)
//   none = 주력 주제를 안 정함
export const FOCUS_VERDICT = { match: '주력 주제와 맞음', unclear: '판단 어려움', off: '주력 주제 밖', none: '주력 주제 없음' };
export function focusFit(post, focus, extra = '') {
  const f = String(focus || '').trim();
  const terms = focusTerms(f, extra);
  if (!f || !terms.length) return { verdict: 'none', label: FOCUS_VERDICT.none, evidence: [], terms };
  const own = ownTerms(extra), base = baseTerms(f);
  const main = base.length === 1 ? [...new Set([...own, ...base])] : own;   // 하나만 있어도 '맞음'이 되는 낱말
  const phrase = base.length > 1 ? base.join(' ') : '';                      // 주력 주제 이름 전체 ('계절템 겨울 가전')
  const p = post || {};
  const title = (Array.isArray(p.titles) ? p.titles : []).find((t) => typeof t === 'string' && t.trim()) || '';
  const lines = String(p.body || '').split('\n');
  const isHead = (l) => /^\s*#{1,4}\s/.test(l);
  const heads = lines.filter(isHead).join(' ');
  const rest = lines.filter((l) => !isHead(l) && !/^\s*\[(이미지|링크|내 경험|프롬프트)/.test(l)).join(' ');
  const noBody = !String(p.body || '').trim();
  const kw = termsIn(p.keyword, main), ti = termsIn(title, main);
  const whole = phrase && (countIn(p.keyword, phrase) + countIn(title, phrase)) > 0;
  const baseKT = base.length > 1 ? [...new Set([...termsIn(p.keyword, base), ...termsIn(title, base)])] : [];
  const ca = termsIn(p.category, terms), he = termsIn(heads, terms), bo = termsIn(rest, terms);
  const q = (ws) => ws.slice(0, 3).map((w) => `'${w}'`).join(', ');
  const evidence = [];
  if (kw.length) evidence.push(`키워드에 ${q(kw)}`);
  if (ti.length) evidence.push(`제목에 ${q(ti)}`);
  if (whole) evidence.push(`키워드·제목에 주력 주제 이름 '${f}'`);
  else if (baseKT.length >= 2) evidence.push(`키워드·제목에 주력 주제 낱말 ${q(baseKT)}`);
  else if (baseKT.length === 1) evidence.push(`키워드·제목에 주력 주제 낱말 ${q(baseKT)} 하나뿐 (넓은 낱말일 수 있어서 보조 근거)`);
  if (ca.length) evidence.push(`카테고리에 ${q(ca)}`);
  if (he.length) evidence.push(`소제목에 ${q(he)}`);
  if (bo.length) evidence.push(`본문에 ${q(bo)} ${bo.reduce((n, w) => n + countIn(rest, w), 0)}번`);
  let verdict = 'off';
  if (kw.length || ti.length || whole || baseKT.length >= 2) verdict = 'match';
  else if (baseKT.length || he.length || bo.length || (noBody && ca.length)) {
    verdict = 'unclear';
    if (noBody && !baseKT.length && !he.length && !bo.length) evidence.push('본문이 없는 기록이라 카테고리만으로는 판단하기 어려움');
    evidence.push(own.length ? "키워드·제목에 '주력 주제 낱말'(설정)이 없음" : "키워드·제목만으로는 확인 안 됨 — 설정에 '주력 주제 낱말'을 적으면 더 정확해");
  } else if (ca.length) evidence.push('카테고리만 주력 주제와 같고 키워드·제목·본문에는 주제 낱말이 없음 (카테고리만으로는 주제 글로 보지 않아)');
  else evidence.push('키워드·제목·카테고리·본문 어디에도 주제 낱말이 없음');
  return { verdict, label: FOCUS_VERDICT[verdict], evidence, terms };
}
export const keywordWords = (kw) => String(kw || '').trim().split(/\s+/).filter(Boolean).length;
// 첫 링크 자리가 글 앞부분(첫 소제목 앞, 또는 앞 15%)에 있는지
export function linkTooEarly(body) {
  const lines = String(body || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const li = lines.findIndex((l) => /^\[링크/.test(l));
  if (li < 0) return false;
  const hi = lines.findIndex((l) => /^#{1,4}\s/.test(l));
  return (hi > 0 && li < hi) || li < Math.max(2, Math.floor(lines.length * SEO_RULES.earlyLinkShare));
}

// ───────── 원고 검사 ─────────
// ctx: { programs: {id: program}, channels: {id: channel}, compat: [], links: [], products: [], others: [{id, title, body}], today: 'YYYY-MM-DD',
//        focus: 설정의 주력 주제 (없으면 주제 검사 안 함), focusTerms: 설정의 주력 주제 낱말 (쉼표로) }
// 결과: { errors, warnings, tips } — errors 가 하나라도 있으면 '발행 준비 완료' 불가
export function checkPost(post, ctx = {}) {
  const errors = [], warnings = [], tips = [];
  const E = (code, msg, fix, examples) => errors.push({ code, msg, fix: fix || '', examples: examples || [] });
  const W = (code, msg, fix, examples) => warnings.push({ code, msg, fix: fix || '', examples: examples || [] });
  const T = (code, msg, fix, examples) => tips.push({ code, msg, fix: fix || '', examples: examples || [] });

  const programs = ctx.programs || {};
  const channels = ctx.channels || {};
  const links = (ctx.links || []).filter((l) => !l.post_id || l.post_id === post.id);
  const products = ctx.products || [];
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const body = String(post.body || '');
  const title = String((post.titles || [])[0] || '').trim();
  const ctype = CONTENT_TYPES[post.content_type] || null;
  const channel = channels[post.channel_id] || null;
  const progIds = post.program_ids || [];
  const progs = progIds.map((id) => programs[id]).filter(Boolean);
  const hasExperience = String(post.experience || '').trim().length > 0;
  const sents = sentences(body);

  // 1) 기본
  if (!title) E('no_title', '제목이 없어.', '제목 후보를 하나 넣어줘.');
  const isShort = (ctype && ctype.short) || (channel && channel.kind === 'sns');
  if (body.trim().length < (isShort ? 20 : 200)) E('no_body', '본문이 비어 있거나 너무 짧아.', '원고를 다시 요청하거나 직접 써줘.');
  if (!post.channel_id) E('no_channel', '게시 채널이 정해지지 않았어.', '채널을 골라줘.');

  // 2) 채널 × 수익 모델
  for (const pid of progIds) {
    const pr = programs[pid];
    const c = compatOf(pid, post.channel_id, ctx.compat);
    const name = `${pr ? pr.name : pid} × ${channel ? channel.name : post.channel_id}`;
    if (c.verdict === '불가') E('combo_blocked', `${name}: 쓸 수 없는 조합이야.${c.reason ? ' ' + c.reason : ''}`, '채널이나 수익 모델을 바꿔줘.');
    else if (c.verdict === '확인 필요') W('combo_unknown', `${name}: 가능한지 아직 확인 안 됐어.${c.reason ? ' ' + c.reason : ''}`, '설정 > 수익 모델에서 공식 안내를 확인해줘.');
    if (pr && pr.my_status === '미가입') T('program_not_joined', `${pr.name}: 아직 '미가입'으로 돼 있어.`, '가입했으면 설정에서 상태를 바꿔줘.');
  }
  if (!progIds.length) T('no_program', '수익 모델이 없어. 정보 글이면 괜찮아.');

  // 3) 미완성 자리
  const me = countMe(body);
  if (me) E('placeholder_experience', `빈 [내 경험] 칸이 ${me}곳 남아 있어. 그대로 올리면 이 표시가 글에 보여.`, "'내 경험 채우기'로 채우거나 '빈 칸 지우기'를 눌러줘. 정보 글은 칸을 지우고 경험 없이 올려도 돼.");
  const unfinished = sents.filter((s) => /(TODO|XXX|○○|OOO|\?\?\?)/.test(s.text)).map((s) => clip(s.text));
  if (unfinished.length) E('unfinished', '덜 쓴 표시(○○, TODO 등)가 남아 있어.', '본문에서 고쳐줘.', unfinished.slice(0, 3));
  const tableUnknown = (body.match(/확인 필요/g) || []).length;
  if (tableUnknown) W('table_unfilled', `본문에 '확인 필요'가 ${tableUnknown}곳 있어. 독자에게는 미완성으로 보여.`, '상품 정보를 확인해서 채우거나 그 칸을 빼줘.');
  const img = countImg(body);
  const planKind = PLAN_KINDS[post.plan_kind] ? post.plan_kind : '';
  const prompts = promptsOf(body);
  const withPrompt = prompts.filter((x) => x.prompt).length;
  if (img) T('image_placeholders', withPrompt
    ? `사진 자리 ${img}곳 · 제미나이 프롬프트 ${withPrompt}개: 미리보기의 '프롬프트 복사'로 제미나이에서 만들고, 받은 사진을 블로그의 그 자리에 넣어줘.`
    : `사진 자리 ${img}곳: 원고 아래 '이미지'에서 사진을 만들거나 찾거나 올려서 연결하고, 내려받아 블로그에 넣어줘.`);
  // 1.6.0: 사진은 3~6장 (사용자 기준 — 네이버가 밝힌 기준이 아님). 블로그·사이트 글만
  if (!isShort && channel && channel.kind !== 'sns' && (img < SEO_RULES.imagesMin || img > SEO_RULES.imagesMax)) {
    T('image_count', `사진 자리가 ${img}곳이야 (정한 기준 ${SEO_RULES.imagesMin}~${SEO_RULES.imagesMax}곳).`, img < SEO_RULES.imagesMin ? "본문 고치기에서 '[이미지: 장면]' 줄과 그 아래 '[프롬프트: …]' 줄을 더해줘." : '비슷한 사진 자리를 합쳐줘.');
  }
  if (planKind && withPrompt < prompts.length) T('image_prompt_missing', `사진 자리 ${prompts.length - withPrompt}곳에 제미나이 프롬프트가 없어.`, "사진 자리 바로 아래 줄에 '[프롬프트: 무엇을 어떤 구도·빛·분위기로]'를 적어줘.");

  // 4) 경험
  if (ctype && ctype.needsExperience && !hasExperience) {
    E('needs_experience', '실제 경험 후기인데 경험 내용이 없어. 안 써본 걸 써본 것처럼 올리면 안 돼.', "직접 써본 내용을 적거나, 글 유형을 '장단점 분석'이나 '구매 가이드'로 바꿔줘.");
  }
  const fake = sents.filter((s) => isFakeExperience(s.text)).map((s) => clip(s.text));
  if (fake.length) {
    if (hasExperience) W('experience_check', `써본 경험을 말하는 문장이 ${fake.length}곳 있어. 적어준 실제 경험과 맞는지 봐줘.`, '', fake.slice(0, 3));
    else E('fake_experience', `써본 것처럼 쓴 문장이 ${fake.length}곳 있는데 실제 경험이 입력돼 있지 않아.`, '그 문장을 고치거나 실제 경험을 입력해줘.', fake.slice(0, 3));
  }

  // 5) 가격·숫자·출처
  const sources = Array.isArray(post.sources) ? post.sources.filter((s) => s && s.url) : [];
  const freshPrice = products.some((p) => p.price != null && p.price_checked_at && daysBetween(p.price_checked_at, today) <= 7);
  const exactPrices = sents.filter((s) => PRICE_EXACT.test(s.text)).map((s) => clip(s.text));
  if (exactPrices.length && !freshPrice) E('price_unverified', `정확한 가격이 ${exactPrices.length}곳 적혀 있는데, 최근 7일 안에 확인한 상품 가격이 없어. 가격은 자주 바뀌어.`, "가격을 빼고 '최신 가격은 링크에서 확인'으로 바꾸거나, 상품 가격을 확인해서 저장해줘.", exactPrices.slice(0, 3));
  const ranges = sents.filter((s) => PRICE_RANGE.test(s.text) && !PRICE_EXACT.test(s.text)).map((s) => clip(s.text));
  if (ranges.length && !freshPrice) W('price_range', `가격대 표현이 ${ranges.length}곳 있어. 지금 가격과 맞는지 확인해줘.`, '', ranges.slice(0, 3));
  const claims = sents.filter((s) => NUM_CLAIM.test(s.text) && s.kind !== 'table').map((s) => clip(s.text));
  if (claims.length && !sources.length) W('sources_missing', `숫자가 들어간 문장이 ${claims.length}곳 있는데 출처가 하나도 없어.`, '근거 자료 주소를 출처에 넣거나 숫자를 일반적인 설명으로 바꿔줘.', claims.slice(0, 3));
  if (ctype && ctype.needsSources && !sources.length) E('news_no_sources', `${ctype.label}인데 출처가 없어.`, '출처 주소와 확인 날짜를 넣어줘.');
  // 1.6.0 투자 글(증시 정리·종목 설명): 정보 정리라는 안내가 있어야 하고, 사라·팔라·목표가 같은 투자 권유 표현은 빼야 함
  if ((ctype && ctype.invest) || (planKind && PLAN_KINDS[planKind].invest)) {
    if (!INVEST_DISCLAIMER.test(stripMd(body))) W('invest_disclaimer', '투자 글인데 "투자 권유가 아니다"는 안내가 없어.', '끝에 "이 글은 공개된 정보를 정리한 것이고 투자 권유가 아니에요. 투자 판단과 책임은 본인에게 있어요." 같은 문장을 넣어줘.');
    const advice = sents.filter((s) => INVEST_ADVICE.test(s.text) && !INVEST_DISCLAIMER.test(s.text) && !/(아니|아닙|아님|않|말고|마세요)/.test(s.text)).map((s) => clip(s.text));
    if (advice.length) W('invest_advice', `사라·팔라·목표가처럼 투자를 권하는 문장이 ${advice.length}곳 있어.`, '사실(무슨 일이 있었고 숫자가 어땠는지)과 지켜볼 점으로 바꿔줘.', advice.slice(0, 3));
  }
  const oldSources = sources.filter((s) => s.checked_at && daysBetween(s.checked_at, today) > 180);
  if (oldSources.length) T('sources_old', `확인한 지 6개월이 넘은 출처가 ${oldSources.length}개 있어.`, '내용이 바뀌지 않았는지 다시 봐줘.');
  const factCheck = (post.ai_notes && Array.isArray(post.ai_notes.needs_fact_check)) ? post.ai_notes.needs_fact_check.filter(Boolean) : [];
  if (factCheck.length) W('ai_fact_check', `AI가 사실 확인이 필요하다고 표시한 문장이 ${factCheck.length}곳 있어.`, '맞는지 확인하고 틀리면 고쳐줘.', factCheck.slice(0, 3).map((s) => clip(String(s))));

  // 6) 상품
  if (ctype && ctype.minProducts && products.length < ctype.minProducts) W('products_missing', `${ctype.label} 글인데 연결된 상품이 ${products.length}개야 (최소 ${ctype.minProducts}개 권장).`, '상품을 연결해줘.');
  const unverified = products.filter((p) => p.trust === '미검증');
  if (unverified.length) W('product_unverified', `출처가 없는 상품 정보가 ${unverified.length}개 있어.`, '공식 상품 페이지 주소를 넣거나 직접 확인해줘.', unverified.slice(0, 3).map((p) => p.name));
  const sourced = products.filter((p) => p.trust === '출처 있음');
  if (sourced.length) T('product_sourced', `출처는 있지만 직접 확인하지 않은 상품이 ${sourced.length}개야.`, "확인했으면 '확인 완료'로 바꿔줘.");

  // 7) 링크
  const cta = countCta(body);
  const needsLink = progs.some((p) => p.needs_link && p.kind === 'affiliate');
  if (cta && !links.length && needsLink) E('link_missing', `링크 자리가 ${cta}곳인데 넣은 제휴 링크가 없어. 이대로면 수익이 안 생겨.`, '제휴 링크를 넣어줘.');
  else if (cta && !links.length) W('cta_without_link', `링크 자리가 ${cta}곳인데 연결할 링크가 없어.`, '링크를 넣거나 그 자리를 지워줘.');
  else if (cta > 1 && links.length && links.length < cta) T('link_fewer', `링크 자리 ${cta}곳, 링크 ${links.length}개야. 남는 자리에는 마지막 링크가 들어가.`);
  if (!cta && !links.length && needsLink) W('affiliate_no_link', '제휴 글인데 링크도, 링크 자리도 없어.', '링크를 넣어줘.');
  const badLinks = links.filter((l) => l.status === '오류');
  if (badLinks.length) E('link_error', `오류로 표시된 링크가 ${badLinks.length}개 있어.`, '새 링크로 바꾸거나 지워줘.');
  // 쿠팡 상품 주소를 그대로 넣으면 수익이 집계되지 않음 (쿠팡 파트너스 이용가이드)
  const plainCoupang = links.filter((l) => (l.program_id || (progIds.length === 1 ? progIds[0] : '')) === 'coupang_partners' && /^https?:\/\/(www\.|m\.)?coupang\.com\//i.test(String(l.url || '')));
  if (plainCoupang.length) W('coupang_plain_url', `쿠팡 상품 주소를 그대로 넣은 링크가 ${plainCoupang.length}개야. 이 주소로는 수익이 집계되지 않아 (쿠팡 파트너스 이용가이드).`, '파트너스 사이트에서 만든 링크(link.coupang.com/…)로 바꿔줘.');
  const unchecked = links.filter((l) => l.status === '미확인');
  if (unchecked.length) T('link_unchecked', `아직 눌러보지 않은 링크가 ${unchecked.length}개야.`, "한 번 눌러서 열리면 '정상'으로 바꿔줘.");
  if (channel && channel.clickable_links === false && links.length) W('channel_links_dead', `${channel.name}은(는) 본문 링크가 눌리지 않아.`, '프로필 링크 등 다른 방법으로 안내해줘.');

  // 8) 고지문
  const disc = disclosureFor(progIds, programs);
  for (const p of disc.missing) E('disclosure_missing', `${p.name} 고지문 문구가 비어 있어.`, '설정 > 수익 모델에서 공식 문구를 넣어줘.');
  // 공정위 지침: '수수료를 받을 수 있음'처럼 조건을 붙인 애매한 표현은 명확한 표시가 아님
  if (disc.text && VAGUE_DISCLOSURE.test(disc.text)) E('disclosure_vague', "고지문이 '수수료를 받을 수 있음'처럼 애매해. 공정위 지침은 이런 표현을 분명한 표시로 보지 않아.", "설정 > 수익 모델에서 '…수수료를 제공받습니다'처럼 분명하게 고쳐줘.");
  if (links.length || cta) for (const p of disc.unknown) W('disclosure_unknown', `${p.name}: 고지가 필요한지 아직 확인 안 됐어.`, '설정 > 수익 모델에서 확인해줘.');
  for (const p of Object.values(programs)) {
    const t = String(p.disclosure_template || '').trim();
    if (t && !progIds.includes(p.id) && body.includes(t)) E('wrong_disclosure', `본문에 이 글과 상관없는 ${p.name} 고지문이 들어 있어.`, '본문에서 그 문장을 지워줘. 맞는 고지문은 복사할 때 맨 위에 자동으로 붙어.');
  }

  // 9) 채널 형식
  if (channel && channel.max_chars && body.length > channel.max_chars) E('channel_too_long', `${channel.name} 글자 수 제한(${channel.max_chars}자)을 넘었어. 지금 ${body.length}자.`, '줄여줘.');
  if (channel && channel.kind === 'blog' && !isShort && body.length >= 200 && body.length < 1000) T('too_short', `본문이 ${body.length}자로 짧은 편이야.`, '독자에게 필요한 내용이 다 들어갔는지 봐줘.');

  // 10) 제목·본문 일치, 반복, 과장, 비슷한 글
  const kwTokens = String(post.keyword || title).split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter((t) => t.length >= 2);
  if (kwTokens.length && body.length >= 200) {
    const hit = kwTokens.filter((t) => body.includes(t)).length;
    if (hit / kwTokens.length < 0.5) W('title_mismatch', '제목·키워드의 핵심 단어가 본문에 거의 안 나와.', '제목과 본문이 같은 이야기를 하는지 봐줘.');
  }
  const seen = new Map();
  for (const s of sents) {
    const k = s.text.replace(/[\s\p{P}]/gu, '');
    if (k.length < 12) continue;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  if (dups.length) W('duplicate_sentences', `똑같은 문장이 반복돼 (${dups.length}종류).`, '반복되는 문장을 줄여줘.', sents.filter((s) => dups.some(([k]) => s.text.replace(/[\s\p{P}]/gu, '') === k)).slice(0, 2).map((s) => clip(s.text)));
  const hype = HYPE.filter((w) => body.includes(w));
  if (hype.length) W('hype', `과장 표현이 있어: ${hype.join(', ')}`, '근거 있는 표현으로 바꿔줘.');
  for (const o of ctx.others || []) {
    if (!o || o.id === post.id || !o.body) continue;
    const sim = similarity(body, o.body);
    if (sim >= 0.45) { W('similar_post', `다른 글과 내용이 많이 겹쳐 (${Math.round(sim * 100)}%): ${clip(String(o.title || o.keyword || ''), 40)}`, '같은 내용을 반복하지 말고 다른 정보를 담아줘.'); break; }
  }

  // 11) 채널별 버전의 고지 — 고지문이 있으면 앱이 SNS용으로 복사할 때 맨 앞에 붙이니, 고지문이 없을 때만 직접 확인
  const v = post.variants || {};
  const affiliate = progs.some((p) => p.kind === 'affiliate' || p.kind === 'sponsor' || p.kind === 'cpa');
  if (affiliate && !disc.text) {
    for (const key of ['threads', 'instagram']) {
      const txt = typeof v[key] === 'string' ? v[key] : '';
      const first = txt.split('\n').slice(0, 2).join(' ');
      if (txt && !DISCLOSURE_MARK.test(first)) W('variant_disclosure', `${key === 'threads' ? '쓰레드' : '인스타'} 버전 첫 부분에 광고·제휴 표시가 없어.`, '첫 줄에 #광고 또는 제휴 사실을 적어줘.');
    }
  }

  // 12) 검색 노출 점검 — 앱의 권장 기준이라 막지 않고 알려만 줌 (검색으로 들어오는 블로그·사이트 글만)
  //     검색량·경쟁도는 조회하지 않아서 '경쟁이 높다'고 단정하지 않음
  const searchCh = channel && (channel.kind === 'blog' || channel.kind === 'site') && !isShort;
  if (searchCh) {
    const kwN = keywordWords(post.keyword);
    if (kwN > 0 && kwN < SEO_RULES.minKeywordWords) T('short_keyword', `키워드가 ${kwN}단어야. 짧은 키워드는 같은 낱말로 쓴 글이 많을 수 있어 (검색량·경쟁도는 조회하지 않았어 · 앱 권장 ${SEO_RULES.minKeywordWords}단어 이상).`, '찾는 사람이 분명해지게 좁혀줘. 예: "제습기" → "원룸 겨울 결로 제습기 용량"');
    // 1.6.0: 하루 계획의 유입 글·오늘 이슈·증시·종목 글은 주력 주제 밖이 정상이라 주제 검사를 안 함 (쿠팡·토스 링크 글만)
    if (ctx.focus && (!planKind || planKind === 'affiliate')) {
      const f = focusFit(post, ctx.focus, ctx.focusTerms);
      const name = clip(String(ctx.focus), 30);
      const ev = f.evidence.join(' · ');
      if (f.verdict === 'match') T('focus_match', `주력 주제(${name})와 맞아 — 근거: ${ev}`);
      else if (f.verdict === 'unclear') W('focus_unclear', `주력 주제(${name})와 맞는지 판단하기 어려워 — 근거: ${ev}.`, `주제 안의 글이면 키워드나 제목에 주제 낱말(${f.terms.slice(0, 4).join(', ')})을 넣거나, 설정 > 자동 글쓰기의 '주력 주제 낱말'에 이 글의 낱말을 더해줘.`);
      else if (f.verdict === 'off') W('off_focus', `주력 주제(${name}) 밖의 글로 보여 — 근거: ${ev}.`, '주력 주제 안의 글을 먼저 쓰거나, 주제 안의 글이면 설정에서 주력 주제 낱말을 더해줘.');
    }
    const nLinks = Math.max(cta, links.length);
    if (nLinks > SEO_RULES.maxLinks) W('too_many_links', `링크가 ${nLinks}개야. 링크가 많으면 광고 글로 보이기 쉬워 (앱 권장 ${SEO_RULES.maxLinks}개까지).`, '본문 중간 1곳, 끝 1곳으로 줄여줘.');
    if (cta && linkTooEarly(body)) W('link_too_early', '글 첫 부분에 링크가 있어 (앱 권장: 정보 먼저, 링크는 중간·끝).', '첫 소제목 앞에서는 링크 자리를 빼줘.');
    if (!hasExperience && !me && !planKind) W('no_own_experience', '직접 겪은 내용이 한 줄도 없어 (발행은 막지 않아). 안 써봤어도 내 상황 한 줄(내 방·내 물건·재 본 숫자·매장에서 본 것)이 있으면 다른 글과 달라져.', "원고 정보의 '내 경험' 칸에 적거나, 본문에 [내 경험] 자리를 넣고 '내 경험 채우기'로 채워줘.");
  }

  return { errors, warnings, tips };
}

export const canBeReady = (result) => result.errors.length === 0;
