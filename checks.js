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
};

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
    if (/^#{1,4}\s/.test(l)) blocks.push({ t: 'h', text: l.replace(/^#+\s/, '') });
    // full: 줄 전체가 [이미지: …] 인 '사진 자리' (images.js 의 parseSlots·countImg 와 같은 기준 → 이미지 연결 순서가 맞음)
    else if (/^\[이미지/.test(l)) blocks.push({ t: 'img', text: l.replace(/^\[이미지:?\s*|\]$/g, ''), full: /^\[이미지[^\]]*\]$/.test(l) });
    else if (/^\[링크/.test(l)) blocks.push({ t: 'cta', text: l.replace(/^\[링크\s*\d*\s*:?\s*|\]$/g, '') });
    else blocks.push({ t: 'p', text: l.replace(/^>\s?/, '') });
  }
  flushList(); flushTbl();
  return blocks;
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
const stripMd = (s) => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1');
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

// ───────── 원고 검사 ─────────
// ctx: { programs: {id: program}, channels: {id: channel}, compat: [], links: [], products: [], others: [{id, title, body}], today: 'YYYY-MM-DD' }
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
  if (me) E('placeholder_experience', `빈 [내 경험] 칸이 ${me}곳 남아 있어. 그대로 올리면 글에 그대로 보여.`, "'내 경험 채우기'로 채우거나 '빈 칸 지우기'를 눌러줘.");
  const unfinished = sents.filter((s) => /(TODO|XXX|○○|OOO|\?\?\?)/.test(s.text)).map((s) => clip(s.text));
  if (unfinished.length) E('unfinished', '덜 쓴 표시(○○, TODO 등)가 남아 있어.', '본문에서 고쳐줘.', unfinished.slice(0, 3));
  const tableUnknown = (body.match(/확인 필요/g) || []).length;
  if (tableUnknown) W('table_unfilled', `본문에 '확인 필요'가 ${tableUnknown}곳 있어. 독자에게는 미완성으로 보여.`, '상품 정보를 확인해서 채우거나 그 칸을 빼줘.');
  const img = countImg(body);
  if (img) T('image_placeholders', `사진 자리 ${img}곳: 원고 아래 '이미지'에서 사진을 만들거나 찾거나 올려서 연결하고, 내려받아 블로그에 넣어줘.`);

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
  if (ctype && ctype.needsSources && !sources.length) E('news_no_sources', '최신 정보 요약인데 출처가 없어.', '출처 주소와 확인 날짜를 넣어줘.');
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

  return { errors, warnings, tips };
}

export const canBeReady = (result) => result.errors.length === 0;
