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
    // 1.7.0 전문가 틀: "[기준: 11월 3일 장 마감 · 참고: 한국거래소]" = 이 글의 기준 상자, "[용어: PER — 주가를 주당순이익으로 나눈 값]" = 용어 풀이 상자
    else if (BASIS_LINE.test(l)) blocks.push({ t: 'basis', text: l.replace(/^\[기준\s*:?\s*/, '').replace(/\]\s*$/, '').trim() });
    else if (TERM_LINE.test(l)) {
      const inner = l.replace(/^\[용어\s*:?\s*/, '').replace(/\]\s*$/, '').trim();
      const m = inner.match(/^(.{1,40}?)\s*(?:—|–|-|:)\s*(.+)$/);
      blocks.push({ t: 'term', term: m ? m[1].trim() : inner, text: m ? m[2].trim() : '' });
    }
    // 1.6.0: "> " 줄은 눈에 띄게 바탕색을 칠하는 핵심 상자 (예전엔 그냥 문단)
    else if (/^>\s?/.test(l)) blocks.push({ t: 'note', text: l.replace(/^>\s?/, '') });
    else blocks.push({ t: 'p', text: l });
  }
  flushList(); flushTbl();
  return blocks;
}
export const PROMPT_LINE = /^\s*\[프롬프트/;
export const BASIS_LINE = /^\[기준\s*:/;
export const TERM_LINE = /^\[용어\s*:/;
// 1.7.0: 출처 번호 "[^1]" — 글 끝 '참고 자료'의 그 번호 (sources 순서)
export const FOOTNOTE = /\[\^(\d{1,2})\]/g;
// 1.7.0: 앱이 그리는 이미지 자리 — "[이미지: (정보 카드) 지수 표]", "[이미지: (썸네일) 제목 카드]" (제미나이 필요 없음)
export const INFO_CARD_SLOT = /^\s*\(정보\s*카드\)/;
export const THUMB_SLOT = /^\s*\(썸네일\)/;
export const isAppDrawnSlot = (text) => INFO_CARD_SLOT.test(String(text || '')) || THUMB_SLOT.test(String(text || ''));
const promptTextOf = (l) => l.trim().replace(/^\[프롬프트\s*\d*\s*:?\s*/, '').replace(/\]\s*$/, '').trim();
// 사진 자리(줄 전체가 [이미지: …])마다 순서대로 { n, text: 사진 설명, prompt: 제미나이 프롬프트('' = 없음) }
export function promptsOf(body) {
  const out = [];
  for (const b of parseBody(body)) if (b.t === 'img' && b.full) out.push({ n: out.length + 1, text: b.text, prompt: b.prompt || '', app: isAppDrawnSlot(b.text) });
  return out;
}
// 본문 글자 수 (공백 포함) — 독자가 읽는 글만: 소제목·문단·목록·표 칸·핵심 상자. 사진 자리·프롬프트·링크 자리·강조 표시(**, ==)는 빼고 셈
export function bodyChars(body) {
  let n = 0;
  for (const b of parseBody(body)) {
    const parts = b.t === 'ul' ? b.items : b.t === 'table' ? b.rows.flat() : (b.t === 'img' || b.t === 'cta') ? [] : b.t === 'term' ? [b.term, b.text] : [b.text || ''];
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
const stripMd = (s) => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/==(.+?)==/g, '$1').replace(FOOTNOTE, '');
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
// 1.8.0: 사진 4~8장 (홈판·검색 조사 2026-11-06 — 사진이 많은 글이 더 읽힌다는 데이터 연구 1개·실무자 의견. 네이버가 밝힌 기준은 아님 — 맞는 사진이 모자라면 적어도 됨)
// 1.8.0: 메인 블로그 주력 주제 비율 목표 100% (조사 보고서 — '일관된 주제'가 네이버 공식 원칙, 오늘 이슈·생활 정보 글도 주제 안에서. 숫자는 우리 기준)
export const SEO_RULES = { minKeywordWords: 3, maxLinks: 2, earlyLinkShare: 0.15, focusShareGoal: 1, perDayRecommended: 1, imagesMin: 4, imagesMax: 8 };
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
//        focus: 설정의 주력 주제 (없으면 주제 검사 안 함), focusTerms: 설정의 주력 주제 낱말 (쉼표로),
//        mainChannel·investChannel: 메인 블로그·투자 블로그 채널 id (1.8.0 — 주면 증시·종목 글이 메인 블로그에 있는지 봄) }
// 결과: { errors, warnings, tips } — errors 가 하나라도 있으면 '발행 준비 완료' 불가

// ───────── 1.7.0 전문성·사람 말투 ─────────
// 기본 말투 카드 (설정 > 말투에서 고르거나, 내 글을 붙여넣어 '내 말투'로 바꿈). 자동 작가 프롬프트·Claude 안 글공장도 같은 글을 씀 (tests/sync.test.js)
export const VOICE_PRESETS = {
  friendly: { label: '친근한 해요체 블로거', card: '해요체(~해요, ~거든요, ~더라고요)로 옆 사람에게 말하듯 써. 짧은 문장과 긴 문장을 섞고 2~3문장마다 줄을 바꿔. 가끔 독자에게 물어봐("이런 적 있죠?"). 이모티콘은 거의 안 써. 의견은 "개인적으로는 ~가 낫다고 봐요"처럼 이유와 같이.' },
  calm: { label: '차분한 정보형', card: '해요체로 차분하게, 핵심부터 말하고 이유를 붙여. 감탄·과장 없이 숫자와 조건으로 설명해. 문단은 3~4문장, 문장 길이는 섞어서.' },
  invest: { label: '숫자로 말하는 투자 해설', card: '해요체로 차분하게, 숫자는 날짜·출처와 같이 써. 가끔 "~했습니다"를 섞어 무게를 줘. 전망은 단정하지 말고 "지켜볼 점"으로. 전문용어는 처음 나올 때 한 줄로 풀어줘.' },
};
export const VOICE_SCOPES = { general: { label: '일반 글 (쿠팡·토스·애드포스트·오늘 이슈)', def: 'friendly' }, invest: { label: '투자 글 (증시·종목)', def: 'invest' } };
// 말투 카드: 설정에 저장된 카드가 없으면 그 범위의 기본 말투
export function voiceCard(settings, scope = 'general') {
  const v = ((settings && settings.voice) || {})[scope] || {};
  const card = String(v.card || '').trim();
  if (card) return card;
  const preset = VOICE_PRESETS[v.preset] || VOICE_PRESETS[(VOICE_SCOPES[scope] || VOICE_SCOPES.general).def];
  return preset.card;
}

// AI 티 점검 — 기계가 쓴 것처럼 보이는 습관을 찾아서 점수로 알려줌 (발행은 막지 않음). '사람 말투로 다듬기'의 기준
export const AI_PHRASES = [
  { re: /알아\s*(보겠습니다|볼게요|보도록\s*하겠습니다|봅시다)/, label: '"알아보겠습니다" 같은 예고' },
  { re: /살펴\s*(보겠습니다|볼게요|보도록)/, label: '"살펴보겠습니다" 같은 예고' },
  { re: /(이번|오늘)\s*(포스팅|글)\s*에서(는)?/, label: '"이번 포스팅에서는"' },
  { re: /에\s*대해(서)?\s*(자세히|알아|살펴|정리해)/, label: '"~에 대해 자세히"' },
  { re: /결론적으로|요약하자면|종합하자면|종합해\s*보면/, label: '"결론적으로" 같은 정리 말' },
  { re: /(것이|게)\s*(중요합니다|중요해요|필수적입니다|필수입니다)/, label: '"~하는 것이 중요합니다"' },
  { re: /다양한/, label: '"다양한"' },
  { re: /효과적(인|으로)|효율적(인|으로)/, label: '"효과적인"' },
  { re: /도움이\s*(되셨기를|되었으면|되었기를|되길)/, label: '"도움이 되셨기를" 마무리' },
  { re: /^(마무리하며|마치며|끝으로)/, label: '"마치며" 같은 마무리' },
  { re: /많은\s*분들(이|께서)/, label: '"많은 분들이"' },
  { re: /(앞서|위에서)\s*(살펴본|알아본|말씀드린)\s*(바와\s*같이|것처럼)/, label: '"앞서 살펴본 바와 같이"' },
  { re: /꼭\s*기억(하세요|해\s*두세요|해\s*주세요)/, label: '"꼭 기억하세요"' },
];
const endingOf = (t) => {
  const s = String(t || '').replace(/[\s.!?…~^ㅎㅋ)\]"'”’]+$/u, '').replace(/\p{Extended_Pictographic}/gu, '');
  return s.slice(-2);
};
// 독자가 읽는 문장만 (문단·핵심 상자·목록). 소제목·사진 자리·표는 빼고. lists=false 면 목록 항목도 빼고 (짧은 명사 항목이 문장 통계를 흐리지 않게)
function readerSentences(body, lists = true) {
  const out = [];
  for (const b of parseBody(body)) {
    const parts = b.t === 'p' || b.t === 'note' ? [b.text] : b.t === 'ul' && lists ? b.items : [];
    for (const part of parts) for (const x of stripMd(part).replace(ME_RE, '').split(/(?<=[.!?。…])\s+/)) { const t = x.trim(); if (t.length >= 2) out.push(t); }
  }
  return out;
}
export const AI_TONE_GOOD = 85, AI_TONE_BAD = 70;
export function aiTone(body) {
  const hits = [];
  let score = 100;
  const sents = readerSentences(body);
  const prose = readerSentences(body, false); // 합니다체 비율·문장 길이는 문단 문장으로만
  const heads = parseBody(body).filter((b) => b.t === 'h').map((b) => stripMd(b.text));
  // 1) 틀에 박힌 말
  for (const ph of AI_PHRASES) {
    const ex = sents.filter((x) => ph.re.test(x));
    const hh = heads.filter((x) => ph.re.test(x));
    const n = ex.length + hh.length;
    if (!n) continue;
    score -= Math.min(12, 4 * n);
    hits.push({ kind: 'phrase', label: ph.label, n, examples: [...ex, ...hh].slice(0, 2).map((x) => clip(x)) });
  }
  // 2) 같은 어미가 4문장 넘게 줄줄이 (예: ~니다. ~니다. ~니다. ~니다.)
  let run = 1, runs = 0, runEx = '';
  for (let i = 1; i < sents.length; i++) {
    const same = endingOf(sents[i]) && endingOf(sents[i]) === endingOf(sents[i - 1]);
    run = same ? run + 1 : 1;
    if (run === 4) { runs++; if (!runEx) runEx = endingOf(sents[i]); }
  }
  if (runs) { score -= Math.min(15, 6 * runs); hits.push({ kind: 'endings', label: `같은 어미(~${runEx})가 4문장 넘게 이어짐`, n: runs, examples: [] }); }
  // 3) 딱딱한 합니다체 위주 (블로그는 해요체가 더 사람 같음)
  const formal = prose.filter((x) => /(니다|니까)$/.test(endingOf(x) + '') || /니다[.!?]?$/.test(x)).length;
  if (prose.length >= 8 && formal / prose.length > 0.6) { score -= 10; hits.push({ kind: 'formal', label: `합니다체가 ${Math.round((formal / prose.length) * 100)}% — 보고서처럼 딱딱해`, n: formal, examples: [] }); }
  // 4) 문장 길이가 다 비슷함 (사람 글은 짧은 문장·긴 문장이 섞임)
  if (prose.length >= 12) {
    const L = prose.map((x) => x.length);
    const mean = L.reduce((a, n) => a + n, 0) / L.length;
    const sd = Math.sqrt(L.reduce((a, n) => a + (n - mean) ** 2, 0) / L.length);
    if (mean > 0 && sd / mean < 0.3) { score -= 10; hits.push({ kind: 'uniform', label: `문장 길이가 다 비슷해 (평균 ${Math.round(mean)}자)`, n: 1, examples: [] }); }
  }
  // 5) 소제목이 전부 같은 모양 (모두 번호로 시작하거나 끝말이 같음)
  if (heads.length >= 4) {
    const numbered = heads.every((x) => /^\d+[.)]\s*/.test(x));
    const tails = new Set(heads.map((x) => x.replace(/[?!.\s]+$/, '').slice(-2)));
    if (numbered || tails.size === 1) { score -= 6; hits.push({ kind: 'heads', label: numbered ? '소제목이 전부 번호 목록 모양' : `소제목 끝이 전부 "${[...tails][0]}"`, n: heads.length, examples: heads.slice(0, 2).map((x) => clip(x, 40)) }); }
  }
  // 6) 3개짜리 목록을 계속 (AI가 자주 쓰는 틀)
  const three = parseBody(body).filter((b) => b.t === 'ul' && b.items.length === 3).length;
  if (three >= 3) { score -= 6; hits.push({ kind: 'lists', label: `항목 3개짜리 목록이 ${three}번`, n: three, examples: [] }); }
  score = Math.max(0, Math.round(score));
  const verdict = score >= AI_TONE_GOOD ? '사람 같음' : score >= AI_TONE_BAD ? '조금 딱딱함' : 'AI 티 남';
  return { score, verdict, hits, sentences: sents.length };
}

// ───────── 1.8.0 홈판 점검 (원고만 보고 계산하는 참고 점수 — 발행은 막지 않음) ─────────
// 근거 (조사 보고서 '네이버 홈판 상위노출 공략', 2026-11-06): 네이버 공식 — 홈판 카드에 대표 사진·제목이 보임, 일관된 주제·최신성·직접 경험·읽기 쉬운 구조,
// 관련 없는 이미지·과장 피하기 / 여러 실무자 — 첫 3줄에 결론, 제목에 사실형 호기심 장치 하나(과장 없이), 짧은 문단, 썸네일과 제목이 같은 대상, 핵심 낱말은 제목 앞쪽
// 시험 항목 (근거가 갈림) — 제목 길이 25~30자 vs 31자 넘게, 사진 수. 글자 수·발행 시각·키워드 반복 횟수는 근거가 없어서 안 봄
export const FEED_RULES = { titleMin: 18, titleGoodMin: 25, titleShortMax: 30, titleGoodMax: 40, titleMax: 50, frontChars: 25, paraMaxChars: 150, paraMaxSentences: 4, minImages: SEO_RULES.imagesMin, recentDays: 7 };
export const CLICKBAIT = /(충격|경악|소름|대박|역대급|헉|실화|난리|알고\s*보니|이것\s*하나로|무조건|100\s*%|절대\s*하지\s*마)/;
// 사실형 호기심 장치: 구체 숫자 · 질문 · 비교 · 독자 지정("원룸이라면", "자취생")
const TITLE_HOOK = /(\d|\?|？|왜|이유|차이|방법|비교|\bvs\b|총정리|체크리스트|한눈에|이라면|라면\b|라면[,\s]|인\s*분|하는\s*분|분들|초보|자취|원룸|신혼|아이\s*있는|부모님)/i;
const SUMMARY_LEAD = /^(핵심|결론|요약|한\s*줄\s*요약|3줄\s*요약|먼저\s*결론|바로\s*답)/;
// 제목의 군더더기: 시리즈 이름 말고 대괄호·꺾쇠, 장식 기호·이모지, 느낌표·물음표·물결 겹치기
const TITLE_BRACKET = /[[\]【】「」『』〈〉《》<>]/;
const TITLE_SPECIAL = /[★☆♥♡❤♪♬◆◇■□▶▷►●○◎※♣♠✔✅❗❓]|\p{Extended_Pictographic}|[!?！？]{2,}|~{2,}/u;
// 제목에 흔히 쓰는 말(본문에 그대로 없어도 되는 말) — '본문에 없는 낱말' 검사에서 뺌
const TITLE_STOP = new Set(['고르기', '고르는', '고르는법', '방법', '이유', '차이', '비교', '정리', '총정리', '기준', '가지', '체크리스트', '한눈에', '추천', '가이드', '꿀팁', '후기', '리뷰', '사용법', '장단점', '주의', '주의점', '핵심', '요약', '먼저', '지금', '오늘', '올해', '이번', '최신', '제품', '상품', '모델', '종류', '선택', '고민', '필요', '정보', '알아야', '하는', '하기', '있는', '없는', '좋은', '어떤', '무엇', '언제', '어디', '얼마', '이것', '그것', '진짜', '정말', '바로', '이라면', '라면']);
// "[이미지: (썸네일) 거실 가습기 고르기]" → '거실 가습기 고르기' (썸네일에 크게 쓸 짧은 문구). 비었거나 '제목 카드'면 '' (제목을 씀)
export function thumbText(slotText) {
  const t = String(slotText || '').replace(THUMB_SLOT, '').replace(/^[\s:·—-]+/, '').trim();
  return !t || /^제목\s*카드/.test(t) ? '' : t.slice(0, 40);
}
const nounsOf = (s) => (String(s || '').match(/[가-힣A-Za-z0-9]{2,}/g) || []).map((w) => w.replace(/(은|는|이|가|을|를|의|에|와|과|로|으로|도|만|부터|까지|에서)$/, '')).filter((w) => w.length >= 2);
const sameWord = (w, x) => w === x || (w.length >= 2 && x.includes(w)) || (x.length >= 2 && w.includes(x));
// 사진 자리 설명에서 표시 말을 뺀 장면 설명 ("(직접 찍기) 우리 집 보일러 화면 (제품 사진)" → "우리 집 보일러 화면")
const slotScene = (t) => String(t || '').replace(/^\s*\((썸네일|정보\s*카드|직접\s*찍기)\)\s*/, '').replace(/\((제품\s*사진|직접\s*찍기)\)/g, '').replace(/^[\s:·—-]+/, '').trim();
// 짧은 글 두 개가 얼마나 같은지 (띄어쓰기 뺀 두 글자 묶음 겹침, 0~1) — 사진 설명처럼 짧은 글용
const bigramDice = (a, b) => {
  const bg = (s) => { const t = String(s || '').replace(/\s+/g, ''); const m = new Map(); for (let i = 0; i + 2 <= t.length; i++) { const k = t.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b);
  let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
  return na + nb ? (2 * inter) / (na + nb) : 0;
};
const textOfBlock = (b) => (b.t === 'ul' ? b.items.join(' ') : b.t === 'table' ? b.rows.flat().join(' ') : b.t === 'term' ? `${b.term} ${b.text}` : b.text || '');
// 누락 확인에 쓸 문장: 이 글에만 있을 만한 문단 문장 (15~45자, 숫자·괄호·주소 없는 것 중 가장 긴 것)
export function uniqueSentence(body) {
  const c = readerSentences(body, false).filter((x) => x.length >= 15 && x.length <= 45 && !/[[\]()「」<>]|https?:|\d/.test(x) && !SUMMARY_LEAD.test(x));
  return c.sort((a, b) => b.length - a.length)[0] || '';
}
// 제목의 첫 낱말 (시리즈 이름 빼고) — 최근 제목과 시작이 같은지 볼 때
export const titleLead = (title) => nounsOf(stripMd(String(title || '')).replace(/^\s*\[[^\]]{1,30}\]\s*/, ''))[0] || '';
// 투자 글(증시 정리·종목 설명)인지
const isInvestPost = (p) => !!((PLAN_KINDS[p.plan_kind] && PLAN_KINDS[p.plan_kind].invest) || (CONTENT_TYPES[p.content_type] && CONTENT_TYPES[p.content_type].invest));
// ctx: focus·focusTerms·autoTopics (설정의 주력 주제·낱말·자동 주제), mainChannel·investChannel (메인 블로그·투자 블로그 채널 id),
//      ownPhoto (이 글 사진 자리에 직접 찍은 사진이 연결됨), recentTitles (최근 7일 다른 글 제목들 — 앱이 고름)
export function feedCheck(post, ctx = {}) {
  const p = post || {};
  const blocks = parseBody(p.body);
  const raw = (Array.isArray(p.titles) ? p.titles : []).find((t) => typeof t === 'string' && t.trim()) || '';
  const title = stripMd(raw).replace(/^\s*\[[^\]]{1,30}\]\s*/, '').trim(); // [시리즈 이름]은 빼고 셈
  const items = [];
  const add = (key, ok, label, hint, basis) => items.push({ key, ok, label, hint: ok === true ? '' : hint, basis });
  const own = ownTerms(ctx.focusTerms);
  const reader = blocks.filter((b) => !['img', 'cta', 'basis'].includes(b.t)).map((b) => stripMd(textOfBlock(b))).join(' ');
  // 1) 첫 사진 = 썸네일 (네이버는 첫 사진을 대표 사진으로 — 홈판·글 목록 카드에 보임)
  const imgs = blocks.filter((b) => b.t === 'img' && b.full);
  const first = imgs[0];
  const isThumb = !!first && THUMB_SLOT.test(first.text);
  add('thumb', isThumb, '첫 사진이 썸네일(대표 사진)', first ? "맨 위 첫 사진 자리를 '(썸네일)'로 — 홈판·글 목록 카드에 보이는 사진이야" : '사진 자리가 없어 — 홈판 카드에 사진 없이 글자만 나와', '네이버 공식');
  // 2) 썸네일 문구가 제목과 같은 대상 + 썸네일 속 숫자는 제목·본문에도 (이미지 속 글자는 검색이 못 읽음)
  const tt = isThumb ? thumbText(first.text) : '';
  if (tt) {
    const tw = nounsOf(title);
    const core = termsIn(title, own);  // 제목의 핵심 대상 (설정의 주력 주제 낱말 — 제품군)
    const shared = nounsOf(tt).some((w) => tw.some((x) => sameWord(w, x)));
    const hasCore = !core.length || core.some((w) => countIn(tt, w) > 0);
    const nums = (tt.match(/\d+(?:[.,]\d+)?/g) || []).filter((n) => !title.includes(n) && !reader.includes(n));
    const ok = !shared || nums.length ? false : hasCore ? true : null;
    add('thumb_match', ok, '썸네일 문구가 제목과 같은 대상',
      !shared ? `썸네일 문구 '${tt}'와 제목에 겹치는 낱말이 없어 — 다른 이야기처럼 보이면 안 돼`
        : nums.length ? `썸네일의 숫자 '${nums[0]}'가 제목·본문에 없어 — 사진 속 글자는 검색이 못 읽어서 본문에도 있어야 해`
          : `썸네일 문구에 '${core[0]}'가 없어 — 카드만 보고도 무엇에 대한 글인지 알게 (사진이 그 물건을 보여주면 괜찮아)`, '네이버 공식 · 여러 실무자');
  }
  // 3) 첫 3줄에 결론·핵심 (첫 소제목 전에 요약 상자·짧은 목록·'핵심:' 문단)
  const hi = blocks.findIndex((b) => b.t === 'h');
  const lead = (hi < 0 ? blocks.slice(0, 6) : blocks.slice(0, hi)).filter((b) => !['img', 'basis'].includes(b.t));
  const topSum = lead.some((b) => b.t === 'note' || (b.t === 'ul' && b.items.length >= 2 && b.items.length <= 5) || (b.t === 'p' && SUMMARY_LEAD.test(stripMd(b.text))));
  add('top_summary', topSum, '첫 3줄에 결론·핵심', "첫 소제목 앞에 '> 핵심: 답 + 누구에게 해당하는지' 상자나 2~4줄 요약을 둬 — 카드를 누른 사람이 바로 답을 봐", '여러 실무자');
  // 4) 제목 길이 (시리즈 이름 빼고) — 25~30자와 31자 넘게 중 어느 쪽이 나은지는 우리 글로 시험 중
  const n = [...title].length;
  const lenOk = n >= FEED_RULES.titleGoodMin && n <= FEED_RULES.titleGoodMax ? true : n >= FEED_RULES.titleMin && n <= FEED_RULES.titleMax ? null : false;
  const arm = n < FEED_RULES.titleGoodMin ? '25자보다 짧음' : n <= FEED_RULES.titleShortMax ? '짧은 제목(25~30자) 쪽' : '긴 제목(31자 넘게) 쪽';
  add('title_len', title ? lenOk : false, `제목 ${n}자 · ${arm} — 길이는 시험 중`, n < FEED_RULES.titleGoodMin ? '조금 짧아 — 무엇을·누가·언제 중 하나를 더해봐' : '길어 — 카드에서 잘릴 수 있어. 앞쪽에 핵심을', '실무자 1~2곳, 서로 반대 — 시험');
  // 5) 핵심 대상(제품군·키워드 낱말)이 제목 앞 25자 안에
  const fr = FEED_RULES.frontChars;
  const kwHits = nounsOf(p.keyword).filter((w) => !/^\d+$/.test(w) && title.includes(w));
  const coreHits = termsIn(title, own);
  const front = (ws) => ws.map((w) => ({ w, i: title.indexOf(w) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i)[0];
  const cf = front(coreHits) || front(kwHits);
  if (cf) add('title_front', cf.i + cf.w.length <= fr ? true : null, `핵심 낱말이 제목 앞 ${fr}자 안에`, `'${cf.w}'가 ${cf.i + 1}번째 글자부터 나와 — 카드에서 잘리지 않게 앞으로`, '여러 실무자');
  else if (String(p.keyword || '').trim() && title) add('title_front', false, `핵심 낱말이 제목 앞 ${fr}자 안에`, `제목에 키워드('${clip(String(p.keyword).trim(), 20)}')의 낱말이 없어 — 무엇에 대한 글인지 앞쪽에`, '여러 실무자');
  // 6) 제목에 군더더기 없음: 대괄호·특수문자·같은 낱말 두 번 (✗), 본문에서 못 찾은 낱말 (△ — 낱말로만 보는 거라 참고)
  if (title) {
    const probs = [];
    if (TITLE_BRACKET.test(title)) probs.push('대괄호·꺾쇠');
    if (TITLE_SPECIAL.test(title)) probs.push('특수문자·이모지');
    const toks = nounsOf(title).filter((w) => !/^\d/.test(w));
    const rep = toks.find((w, i) => toks.indexOf(w) !== i);
    if (rep) probs.push(`같은 낱말 두 번('${rep}')`);
    const missing = [...new Set(toks)].filter((w) => !TITLE_STOP.has(w) && !/(요|다|죠|까|네|운|은|는|한|할|된|인|던|데|고|며|면|서|게|지|야)$/.test(w)
      && !reader.includes(w) && !(w.length >= 3 && reader.includes(w.slice(0, -1)))).slice(0, 3);
    add('title_form', probs.length ? false : missing.length ? null : true, '제목에 군더더기 없음 (대괄호·특수문자·같은 낱말 반복·본문에 없는 말)',
      probs.length ? `${probs.join(' · ')} — 빼줘 (시리즈 이름 [ ]은 괜찮아)` : `본문에서 못 찾은 낱말: ${missing.map((w) => `'${w}'`).join(', ')} — 본문이 정말 다루는 말인지 봐줘`, '여러 실무자 · 네이버 공식(관련 없는 키워드 금지)');
  }
  // 7) 제목 호기심 장치 하나 (구체 숫자·질문·비교·독자 지정) — 과장 없이. 효과는 시험
  add('title_hook', TITLE_HOOK.test(title) ? true : null, '제목에 숫자·질문·독자 지정 하나', "숫자(3가지·11월)·질문(왜 …?)·독자 지정('원룸이라면') 중 하나를 시험해봐 — 과장 말은 빼고", '여러 실무자 (반대 2곳 — 시험)');
  // 8) 낚시·과장 말 없음
  const leadText = [title, ...lead.filter((b) => b.t === 'p' || b.t === 'note').map((b) => stripMd(b.text))].join(' ');
  const bait = leadText.match(CLICKBAIT);
  add('no_bait', !bait, '낚시·과장 말 없음', bait ? `'${bait[0]}' 같은 말은 빼 — 거짓 없는 글이 네이버 원칙이고, 낚시 제목은 홈판에서 빠진다는 말이 많아` : '', '네이버 공식');
  // 9) 최근 7일 제목과 시작이 다름 (같은 낱말로 시작하는 제목이 이어지면 비슷한 글처럼 보여)
  if (Array.isArray(ctx.recentTitles) && title) {
    const lw = titleLead(title);
    const same = lw ? ctx.recentTitles.filter((t) => titleLead(t) === lw).length : 0;
    add('title_recent', same ? null : true, `최근 ${FEED_RULES.recentDays}일 제목과 시작이 다름`, `최근 ${FEED_RULES.recentDays}일 안에 '${lw}'로 시작한 제목이 ${same}개 — 첫 낱말을 바꿔 봐`, '실무자 1~2곳');
  }
  // 10) 블로그 주제와 맞음 — 투자 글은 대신 '투자 블로그에 있는지'
  if (isInvestPost(p)) {
    if (ctx.investChannel !== undefined) {
      const onInvest = !!ctx.investChannel && ctx.investChannel !== ctx.mainChannel && p.channel_id === ctx.investChannel;
      add('invest_blog', onInvest, '투자 글은 투자 블로그로', "증시·종목 글이 메인 블로그에 있어 — 메인 블로그 주제가 흐려져. 설정 > 말투·전문성의 '투자 글을 올릴 블로그'를 정하고 그 블로그에 올려", '네이버 공식(일관된 주제) · 여러 실무자');
    }
  } else if (ctx.focus) {
    const f = focusFit(p, ctx.focus, ctx.focusTerms);
    const topics = String(ctx.autoTopics || '').split(/[,·\s]+/).map((x) => x.trim()).filter((x) => x.length >= 2);
    const hay = `${p.keyword || ''} ${title}`;
    const other = topics.some((w) => hay.includes(w));
    add('topic', f.verdict === 'match' || other ? true : f.verdict === 'unclear' ? null : false, '블로그 주제와 맞음',
      f.verdict === 'unclear' ? '주제 글인지 애매해 — 키워드·제목에 주제 낱말을 자연스럽게' : '블로그 주제 밖 글이야 — 메인 블로그는 주제 안 글만 올리는 게 목표야 (한 주제로 꾸준한 블로그가 홈판·검색 모두 유리)', '네이버 공식');
  }
  // 11) 짧은 문단 (휴대폰 3~4줄 — 4문장·150자 안쪽, 우리가 정한 근사치)
  const longP = blocks.filter((b) => (b.t === 'p' || b.t === 'note') && (stripMd(b.text).length > FEED_RULES.paraMaxChars
    || stripMd(b.text).split(/(?<=[.!?。…])\s+/).filter((x) => x.trim().length >= 2).length > FEED_RULES.paraMaxSentences)).length;
  add('short_para', longP === 0, '문단이 짧음 (휴대폰 3~4줄)', `긴 문단 ${longP}곳 — 2~3문장마다 끊어줘`, '여러 실무자');
  // 12) 사진이 옆 문단과 맞음 — 장식 사진·같은 장면 두 번 (낱말로만 보는 참고 — 네이버는 관련 없는 이미지를 피하라고 함)
  const scenes = [];
  blocks.forEach((b, bi) => {
    if (b.t !== 'img' || !b.full || THUMB_SLOT.test(b.text) || INFO_CARD_SLOT.test(b.text)) return;
    const scene = slotScene(b.text);
    const sw = nounsOf(scene);
    if (!sw.length) return;
    // 그 사진이 든 부분: 바로 위 소제목부터 다음 소제목 전까지의 글 (사진·링크 자리·기준 상자는 빼고)
    let a = bi; while (a > 0 && blocks[a - 1].t !== 'h') a--;
    if (a > 0) a--;
    let z = bi; while (z + 1 < blocks.length && blocks[z + 1].t !== 'h') z++;
    const near = blocks.slice(a, z + 1).filter((x) => !['img', 'cta', 'basis'].includes(x.t)).map(textOfBlock);
    const cw = nounsOf(stripMd(near.join(' ')));
    scenes.push({ scene, sw, fits: !cw.length || sw.some((w) => cw.some((x) => sameWord(w, x))) });
  });
  const deco = scenes.filter((s) => !s.fits);
  const dup = [];
  for (let i = 0; i < scenes.length; i++) for (let j = i + 1; j < scenes.length; j++) {
    const A = new Set(scenes[i].sw), B = new Set(scenes[j].sw);
    const inter = [...A].filter((w) => B.has(w)).length;
    if (scenes[i].scene === scenes[j].scene || bigramDice(scenes[i].scene, scenes[j].scene) >= 0.7 || (A.size >= 2 && B.size >= 2 && inter / (A.size + B.size - inter) >= 0.6)) dup.push([scenes[i].scene, scenes[j].scene]);
  }
  if (scenes.length) add('img_fit', deco.length || dup.length ? null : true, '사진이 옆 문단과 맞음 (장식 사진·같은 장면 없음)',
    [deco.length ? `장식 사진? '${clip(deco[0].scene, 24)}' — 옆 소제목·문단과 겹치는 낱말이 없어${deco.length > 1 ? ` (그 밖 ${deco.length - 1}곳)` : ''}` : '',
      dup.length ? `비슷한 사진 자리: '${clip(dup[0][0], 18)}' / '${clip(dup[0][1], 18)}'` : ''].filter(Boolean).join(' · ') + ' — 그 문단이 말하는 물건·화면·장면만, 맞는 게 없으면 자리를 줄여', '네이버 공식 · 실무자 3곳');
  // 13) 사진 수 — 맞는 사진이 먼저라 참고만 (사진 수 효과는 시험 중)
  const ni = imgs.length;
  add('images', ni >= FEED_RULES.minImages ? true : null, `사진 ${ni}장 (${SEO_RULES.imagesMin}~${SEO_RULES.imagesMax}장이 앱 기준 — 참고)`, '맞는 사진이 모자라면 적어도 괜찮아. 억지로 채우지 마 (사진 수 효과는 시험 중)', '실무자 1~2곳 — 시험');
  // 14) 직접 겪은 내용 (네이버가 첫째로 꼽는 것) — 경험 칸이나 직접 찍은 사진
  const exp = !!String(p.experience || '').trim() || ctx.ownPhoto === true;
  const shootSlot = imgs.some((b) => /^\s*\(직접\s*찍기\)/.test(b.text));
  add('experience', exp ? true : null, '직접 겪은 내용 (경험·직접 찍은 사진)', shootSlot ? "'(직접 찍기)' 자리에 네가 찍은 사진을 넣으면 그게 직접 경험이야 (못 찍으면 그 자리는 지워 — 없는 경험을 만들지는 마)" : '직접 찍은 사진이나 써본 한 줄이 있으면 더 좋아 (없는 경험을 만들지는 마)', '네이버 공식');
  // 15) 최신성 ([기준: 날짜] 상자)
  add('fresh', blocks.some((b) => b.t === 'basis') ? true : null, '언제 정보인지 보임 ([기준] 상자)', '[기준: 2026년 11월 6일 기준] 같은 상자를 넣으면 최신 글로 보여', '네이버 공식');
  const pts = items.reduce((s, x) => s + (x.ok === true ? 1 : x.ok === null ? 0.5 : 0), 0);
  const score = items.length ? Math.round((pts / items.length) * 100) : 0;
  const verdict = score >= 80 ? '홈판 준비 됨' : score >= 60 ? '거의 됨' : '손볼 곳 있음';
  return { score, verdict, items, title, titleLen: n, thumbText: tt, sentence: uniqueSentence(p.body) };
}

// ───────── 1.8.0 홈판 기록 (posts.feed_log — DB 022) ─────────
// 글마다: 누락 확인(날짜·결과), 7일째 숫자(홈피드·검색 비중 %, 조회, 평균 사용 시간), 썸네일 변형(A/B/C), 제목 글자 수
// 숫자는 사용자가 블로그 통계에서 보고 적은 것 — 앱이 네이버에서 가져오지 않음
export const THUMB_VARIANTS = { A: '색 카드', B: '사진 + 짧은 글자', C: '사진만' };
export const FEED_LOG_KEYS = ['checked_on', 'indexed', 'feed_pct', 'search_pct', 'views_1d', 'views_7d', 'avg_secs', 'stats_on', 'thumb', 'title_len', 'note'];
// 서버·앱이 같이 쓰는 검사: 알 수 없는 칸·이상한 값이면 그 칸 이름을 돌려줌 (null 이면 통과). 빈 값('', null)은 '데이터 없음'
export function feedLogError(log) {
  if (!log || typeof log !== 'object' || Array.isArray(log)) return 'feed_log';
  const ymdOk = (v) => v === null || v === '' || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')));
  const numOk = (v, max, int) => v === null || v === '' || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max && (!int || Number.isInteger(v)));
  for (const [k, v] of Object.entries(log)) {
    if (!FEED_LOG_KEYS.includes(k)) return k;
    if ((k === 'checked_on' || k === 'stats_on') && !ymdOk(v)) return k;
    if (k === 'indexed' && !['', 'yes', 'no', null].includes(v)) return k;
    if ((k === 'feed_pct' || k === 'search_pct') && !numOk(v, 100, false)) return k;
    if ((k === 'views_1d' || k === 'views_7d') && !numOk(v, 100000000, true)) return k;
    if (k === 'avg_secs' && !numOk(v, 86400, true)) return k;
    if (k === 'title_len' && !numOk(v, 300, true)) return k;
    if (k === 'thumb' && !['', 'A', 'B', 'C', null].includes(v)) return k;
    if (k === 'note' && !(v === null || (typeof v === 'string' && v.length <= 300))) return k;
  }
  return null;
}
// 홈판 시험 정리: 썸네일 변형(A/B/C)·제목 길이(25~30자 / 31자 넘게)별로 7일째 숫자 평균. 변형마다 5편이 넘어야 비교 (조사 보고서의 판정 규칙)
export const FEED_TEST_MIN = 5;
export function feedTestSummary(posts) {
  const rows = (posts || []).filter((p) => p && !p.deleted_at && p.feed_log && typeof p.feed_log === 'object');
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const group = (keyOf) => {
    const g = new Map();
    for (const p of rows) {
      const k = keyOf(p);
      if (!k) continue;
      const L = p.feed_log;
      const x = g.get(k) || { key: k, posts: 0, measured: 0, feed: [], views: [], secs: [], indexedNo: 0, checked: 0 };
      x.posts++;
      if (num(L.feed_pct) != null || num(L.views_7d) != null || num(L.avg_secs) != null) x.measured++;
      if (num(L.feed_pct) != null) x.feed.push(L.feed_pct);
      if (num(L.views_7d) != null) x.views.push(L.views_7d);
      if (num(L.avg_secs) != null) x.secs.push(L.avg_secs);
      if (L.indexed === 'yes' || L.indexed === 'no') x.checked++;
      if (L.indexed === 'no') x.indexedNo++;
      g.set(k, x);
    }
    return [...g.values()].map((x) => ({ key: x.key, posts: x.posts, measured: x.measured, enough: x.measured >= FEED_TEST_MIN, feedPct: avg(x.feed), views7d: avg(x.views), avgSecs: avg(x.secs), checked: x.checked, missing: x.indexedNo }));
  };
  const thumbs = group((p) => (THUMB_VARIANTS[p.feed_log.thumb] ? p.feed_log.thumb : '')).sort((a, b) => a.key.localeCompare(b.key));
  const lenOf = (p) => { const n = num(p.feed_log.title_len); return n == null ? '' : n <= FEED_RULES.titleShortMax ? 'short' : 'long'; };
  const titles = group(lenOf).sort((a, b) => (a.key === 'short' ? -1 : 1) - (b.key === 'short' ? -1 : 1));
  const checked = rows.filter((p) => p.feed_log.indexed === 'yes' || p.feed_log.indexed === 'no');
  return { posts: rows.length, thumbs, titles, checked: checked.length, missing: checked.filter((p) => p.feed_log.indexed === 'no').length };
}
// AI 브리핑 누적 인용 수 (settings.ai_citations — [{on: 'YYYY-MM-DD', total}], 블로그 프로필에서 본 누적 값을 주 1회)
export const CITATION_MAX = 104;
export function citationsError(list) {
  if (!Array.isArray(list) || list.length > CITATION_MAX) return 'ai_citations';
  for (const x of list) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return 'ai_citations';
    if (Object.keys(x).some((k) => !['on', 'total'].includes(k))) return 'ai_citations';
    if (typeof x.on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.on) || Number.isNaN(Date.parse(x.on + 'T00:00:00Z'))) return 'ai_citations';
    if (typeof x.total !== 'number' || !Number.isInteger(x.total) || x.total < 0 || x.total > 100000000) return 'ai_citations';
  }
  return null;
}

// 잘 나가는 글 '틀'의 지문: 띄어쓰기를 뺀 글을 8글자씩 한 칸씩 밀며 잘라 만든 해시(정수). 원문은 저장하지 않고 이 숫자만 저장
export const FP_WINDOW = 8, FP_MAX = 6000;
const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h | 0; };
const fpText = (t) => String(t || '').replace(/[\s\p{P}\p{S}]/gu, '');
export function fpOf(text) {
  const t = fpText(text);
  const out = [];
  for (let i = 0; i + FP_WINDOW <= t.length && out.length < FP_MAX; i++) out.push(fnv(t.slice(i, i + FP_WINDOW)));
  return out;
}
// 새 원고가 참고 글과 똑같은 문장을 가졌는지: 이어진 같은 조각 수(run)로 판단 — run 18 ≈ 25글자 넘게 똑같음
export const REF_COPY_RUN = 18;
export function refOverlap(body, templates) {
  const res = { maxRun: 0, share: 0, name: '', example: '' };
  const t = fpText(stripMd(String(body || '').split('\n').filter((l) => !/^\s*\[(이미지|프롬프트|링크)/.test(l)).join('\n')));
  if (t.length < FP_WINDOW) return res;
  for (const tp of templates || []) {
    const set = new Set(Array.isArray(tp && tp.fp) ? tp.fp : []);
    if (!set.size) continue;
    let run = 0, best = 0, bestEnd = 0, hit = 0, total = 0;
    for (let i = 0; i + FP_WINDOW <= t.length; i++) {
      total++;
      if (set.has(fnv(t.slice(i, i + FP_WINDOW)))) { hit++; run++; if (run > best) { best = run; bestEnd = i; } } else run = 0;
    }
    const share = total ? hit / total : 0;
    if (best > res.maxRun || (best === res.maxRun && share > res.share)) {
      res.maxRun = best; res.share = share; res.name = String(tp.name || '');
      res.example = best ? t.slice(Math.max(0, bestEnd - best + 1), bestEnd + FP_WINDOW).slice(0, 40) : '';
    }
  }
  return res;
}

// 숫자 확인표 (posts.figures): 투자 글의 숫자는 표의 값과 같아야 함 — 본문에만 있는 숫자를 찾아 알려줌
const BIG_NUM = /[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-+]?\d+\.\d+|[-+]?\d{3,}/g;
const numVal = (s) => Number(String(s).replace(/,/g, ''));
export function figureNumbers(figures) {
  const out = new Set();
  for (const f of Array.isArray(figures) ? figures : []) {
    if (!f || typeof f !== 'object') continue;
    for (const m of String(f.value ?? '').match(BIG_NUM) || []) { const v = numVal(m); if (Number.isFinite(v)) out.add(Math.abs(v)); }
    const n = Number(f.value);
    if (Number.isFinite(n)) out.add(Math.abs(n));
  }
  return out;
}
export function unlistedNumbers(body, figures) {
  const have = figureNumbers(figures);
  const out = [];
  for (const sentence of readerSentences(body)) {
    for (const m of sentence.matchAll(BIG_NUM)) {
      const after = sentence.slice(m.index + m[0].length, m.index + m[0].length + 3);
      if (/^\s*(년|월|일|분기|시|분|주|개월|위|번째|차|호|명|곳|개|장|가지|편)/.test(after)) continue; // 날짜·순서·개수
      const v = Math.abs(numVal(m[0]));
      if (!Number.isFinite(v) || (v >= 1900 && v <= 2100 && !/[.,]/.test(m[0]))) continue; // 연도
      if (![...have].some((x) => Math.abs(x - v) <= Math.max(1e-9, x * 1e-6))) out.push({ value: m[0], sentence: clip(sentence) });
    }
  }
  return out;
}

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
  // 1.6.0: 사진 장수 기준 (1.8.0부터 4~8장 — 네이버가 밝힌 기준이 아님). 블로그·사이트 글만
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
  // 1.7.0 숫자 확인표: 투자 글은 숫자마다 날짜·출처를 표로 (본문 숫자가 표와 같은지 확인)
  if ((ctype && ctype.invest) || (planKind && PLAN_KINDS[planKind].invest)) {
    const figs = Array.isArray(post.figures) ? post.figures.filter((f) => f && typeof f === 'object') : [];
    if (!figs.length) W('figures_missing', '투자 글인데 숫자 확인표가 비어 있어. 숫자마다 기준 날짜·출처가 있어야 믿을 수 있어.', '자동 작가가 다시 쓰거나, 본문 숫자의 출처를 확인해줘.');
    else {
      const un = unlistedNumbers(body, figs);
      if (un.length) T('figure_unlisted', `숫자 확인표에 없는 숫자가 ${un.length}개 있어. 출처에서 확인한 숫자인지 봐줘.`, '', un.slice(0, 3).map((x) => `${x.value} — ${x.sentence}`));
      const noSrc = figs.filter((f) => !String(f.source_url || '').trim() || !String(f.as_of || '').trim());
      if (noSrc.length) W('figure_no_source', `숫자 확인표 ${noSrc.length}줄에 기준 날짜나 출처가 없어.`, '출처 주소와 기준 날짜를 넣거나 그 숫자를 빼줘.', noSrc.slice(0, 3).map((f) => `${f.label || ''} ${f.value ?? ''}`.trim()));
    }
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
    // 1.8.0: 메인 블로그 글은 쿠팡·토스·애드포스트 유입 글·오늘 이슈 모두 주력 주제 안에서 (조사 보고서 — 한 주제가 홈판·검색 모두 유리). 증시·종목 글은 투자 블로그 글이라 주제 검사를 안 함
    const investPost = (ctype && ctype.invest) || (planKind && PLAN_KINDS[planKind].invest);
    if (investPost && ctx.investChannel !== undefined && !(ctx.investChannel && ctx.investChannel !== ctx.mainChannel && post.channel_id === ctx.investChannel)) {
      W('invest_on_main', '증시·종목 글이 메인 블로그 채널로 잡혀 있어. 생활·가전 블로그에 투자 글이 섞이면 블로그 주제가 흐려져.', "채널을 투자 블로그로 바꾸고, 설정 > 말투·전문성의 '투자 글을 올릴 블로그'를 정해줘.");
    }
    if (ctx.focus && !investPost) {
      const f = focusFit(post, ctx.focus, ctx.focusTerms);
      const name = clip(String(ctx.focus), 30);
      const ev = f.evidence.join(' · ');
      if (f.verdict === 'match') T('focus_match', `주력 주제(${name})와 맞아 — 근거: ${ev}`);
      else if (f.verdict === 'unclear') W('focus_unclear', `주력 주제(${name})와 맞는지 판단하기 어려워 — 근거: ${ev}.`, `주제 안의 글이면 키워드나 제목에 주제 낱말(${f.terms.slice(0, 4).join(', ')})을 넣거나, 설정 > 자동 글쓰기의 '주력 주제 낱말'에 이 글의 낱말을 더해줘.`);
      else if (f.verdict === 'off') W('off_focus', `주력 주제(${name}) 밖의 글로 보여${planKind === 'trending' || planKind === 'adpost' ? ` (${PLAN_KINDS[planKind].short} 글도 메인 블로그에서는 주제 안에서)` : ''} — 근거: ${ev}.`, '주력 주제 안의 글을 먼저 쓰거나, 주제 안의 글이면 설정에서 주력 주제 낱말을 더해줘.');
    }
    const nLinks = Math.max(cta, links.length);
    if (nLinks > SEO_RULES.maxLinks) W('too_many_links', `링크가 ${nLinks}개야. 링크가 많으면 광고 글로 보이기 쉬워 (앱 권장 ${SEO_RULES.maxLinks}개까지).`, '본문 중간 1곳, 끝 1곳으로 줄여줘.');
    if (cta && linkTooEarly(body)) W('link_too_early', '글 첫 부분에 링크가 있어 (앱 권장: 정보 먼저, 링크는 중간·끝).', '첫 소제목 앞에서는 링크 자리를 빼줘.');
    if (!hasExperience && !me && !planKind) W('no_own_experience', '직접 겪은 내용이 한 줄도 없어 (발행은 막지 않아). 안 써봤어도 내 상황 한 줄(내 방·내 물건·재 본 숫자·매장에서 본 것)이 있으면 다른 글과 달라져.', "원고 정보의 '내 경험' 칸에 적거나, 본문에 [내 경험] 자리를 넣고 '내 경험 채우기'로 채워줘.");
  }

  // 13) 1.7.0 AI 티·참고 글 베끼기 (블로그·사이트 글)
  if (searchCh && body.length >= 400) {
    const tone = aiTone(body);
    const ex = tone.hits.slice(0, 3).map((x) => x.label + (x.examples && x.examples[0] ? ` — "${x.examples[0]}"` : ''));
    if (tone.score < AI_TONE_BAD) W('ai_tone', `AI 말투 점수 ${tone.score}점 (${tone.verdict}). 기계가 쓴 것처럼 보이는 습관이 ${tone.hits.length}가지 있어.`, "원고 화면의 '사람 말투로 다듬기'를 누르거나 걸린 표현을 고쳐줘.", ex);
    else if (tone.score < AI_TONE_GOOD) T('ai_tone', `AI 말투 점수 ${tone.score}점 (${tone.verdict}).`, '걸린 표현을 조금만 고치면 더 사람 같아.', ex);
  }
  if (Array.isArray(ctx.templates) && ctx.templates.length && body.length >= 200) {
    const ov = refOverlap(body, ctx.templates);
    if (ov.maxRun >= REF_COPY_RUN) E('ref_copy', `참고 글 틀(${clip(ov.name || '이름 없음', 20)})의 원문과 ${ov.maxRun + FP_WINDOW - 1}글자 넘게 똑같은 부분이 있어. 그대로 올리면 베낀 글이 돼.`, '그 부분을 내 말로 다시 써줘.', ov.example ? [ov.example] : []);
    else if (ov.share >= 0.1) W('ref_similar', `참고 글 틀(${clip(ov.name || '이름 없음', 20)})과 표현이 ${Math.round(ov.share * 100)}% 겹쳐.`, '구성만 참고하고 문장은 새로 써줘.');
  }

  return { errors, warnings, tips };
}

export const canBeReady = (result) => result.errors.length === 0;
