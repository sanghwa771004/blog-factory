// 글공장 앱 1.5.0 — 화면 코드 (원고 규칙은 checks.js, 계산은 lib.js, 이미지 규칙은 images.js, 이미지 화면은 studio.js, 저장은 서버 API)
import {
  STAGES, USER_TRANSITIONS, CONTENT_TYPES, SCORE_FACTORS, checkPost, disclosureFor, compatOf, countMe, countImg, removeEmptyMe, VAGUE_DISCLOSURE,
} from './checks.js?v=1.5.0';
import * as L from './lib.js?v=1.5.0';
import * as IMG from './images.js?v=1.5.0';
import { createStudio, IMAGE_ERR, IMAGE_FIELD, IMAGE_REASON } from './studio.js?v=1.5.0';

const APP_VER = '1.5.0';
const API = 'https://oxewhsqmdkiasckvnyua.supabase.co/functions/v1/blog-app';
const RUN_TIMES = [[8, 51], [12, 51], [18, 51]]; // 자동 작가 실행 시각(한국 시간). 예약 작업 시간과 같아야 함
const ARTIFACT_URL = 'https://claude.ai/artifact/Va1guCB2shG1Gm7rLXUNCX';
const LIVE = ['published', 'collecting', 'analyzed'];
const WORK = ['queued', 'researching', 'writing'];
const KIND_LABEL = { affiliate: '제휴 링크', ads: '광고 수익', sponsor: '협찬', product: '내 상품 판매', cpa: 'CPA·리드', other: '기타' };
const CH_KIND = { blog: '블로그', site: '웹사이트', sns: 'SNS', other: '기타' };
const JOB_KIND = { write: '원고', topics: '주제 추천', reformat: '채널별 버전', refresh: '개선안' };
const JOB_ST = { pending: '대기', done: '완료', failed: '실패', cancelled: '취소됨' };
const SNS_VARIANTS = ['threads', 'instagram', 'cards', 'shortform']; // 복사할 때 고지문을 맨 앞에 붙이는 버전
const VARIANT_LABEL = { threads: '쓰레드', instagram: '인스타그램', cards: '카드뉴스 문구', shortform: '숏폼 대본', summary: '요약', faq: '자주 묻는 질문', titles: '제목 후보', naver_blog: '네이버 블로그용', tistory: '티스토리용', website: '웹사이트용' };

// ───────── 도우미 ─────────
const $ = (s) => document.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 공간이 없어도 앱은 동작 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  let value;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'value') value = v;
      else if (['checked', 'disabled', 'selected', 'open', 'multiple', 'required'].includes(k)) e[k] = !!v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'style') e.style.cssText = v;
      else e.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== '') e.append(k instanceof Node ? k : String(k));
  if (value !== undefined) e.value = value;
  return e;
}
const btn = (text, cls, onclick, props) => h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick, ...props }, text);
const field = (label, input, hint) => h('label', { class: 'f' }, label, input, hint ? h('span', { class: 'hint' }, hint) : null);
const panel = (title, ...kids) => h('section', { class: 'panel' }, title ? h('h2', null, title) : null, ...kids);
const opt = (v, t, dis) => h('option', { value: v, disabled: dis }, t);
const todayS = () => L.todayStr();
const groupBy = (arr, k) => { const m = {}; for (const x of arr || []) (m[x[k]] = m[x[k]] || []).push(x); return m; };
const titleOf = (p) => (p.titles && p.titles[0]) || p.keyword || '제목 없음';
const stageOf = (p) => STAGES[p.stage] || { label: p.stage, group: 'work' };
const badge = (p) => h('span', { class: 'badge g-' + stageOf(p).group }, stageOf(p).label);
const verdictClass = (v) => (v === '가능' ? 'v-ok' : v === '불가' ? 'v-no' : 'v-unk');
const numOrDash = (n) => (n == null ? '–' : L.fmtNum(n));
const wonOrNone = (n) => (n == null ? null : L.won(n));
let dirty = false; // 고치는 중인 칸이 있으면 자동 새로고침이 화면을 다시 그리지 않음
const markDirty = () => { dirty = true; };
// 접었다 편 상태를 기억해서, 화면을 다시 그려도 그대로
const openState = {};
function det(key, summary, defOpen, cls = 'panel') {
  const d = h('details', { class: cls, open: key in openState ? openState[key] : !!defOpen }, h('summary', null, summary));
  d.addEventListener('toggle', () => { openState[key] = d.open; });
  return d;
}

let toastT = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}
// 수익 모델·채널·조합·상품을 바꿨더니 '발행 준비 완료'였던 원고가 검사에서 걸려 되돌아간 경우 알려줌
function noteDemoted(j) {
  const n = j && Array.isArray(j.demoted_posts) ? j.demoted_posts.length : 0;
  if (n) toast(`바꾼 정보 때문에 '발행 준비 완료'였던 원고 ${n}개가 다시 '검수 필요'로 돌아갔어. 검사를 다시 통과해야 해.`, 6000);
}

// 아래에서 올라오는 창
let sheetOnClose = null;
// 창 밖을 누르거나 Esc를 눌렀을 때 닫아도 되는지 (적던 내용·고른 파일이 있으면 안 닫고 알려줌). '닫기' 버튼은 늘 닫음
let sheetGuard = null;
function openSheet(title, ...kids) {
  sheetGuard = null;
  const box = $('#sheetIn');
  box.textContent = '';
  box.append(h('div', { class: 'split' }, h('h2', null, title), btn('닫기', 'sm ghost', closeSheet)), ...kids.flat(Infinity).filter((k) => k != null && k !== false && k !== ''));
  $('#sheet').hidden = false; $('#dim').hidden = false;
  $('#sheet').scrollTop = 0;
}
function closeSheet() {
  if ($('#sheet').hidden) return;
  $('#sheet').hidden = true; $('#dim').hidden = true; $('#sheetIn').textContent = '';
  const f = sheetOnClose; sheetOnClose = null; if (f) f();
  if (pendingRender) render(true); // 창이 열린 동안 미뤄둔 새 내용을 그림
}
const softClose = () => {
  if (sheetGuard && !$('#sheet').hidden && sheetGuard() === false) { toast("적던 내용이 있어서 안 닫았어. 닫으려면 '닫기'를 눌러줘."); return; }
  closeSheet();
};
$('#dim').addEventListener('click', softClose);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') softClose(); });

// ───────── 오류 문구 ─────────
const FIELD = {
  keyword: '키워드', title: '제목', blog_url: '게시 주소', published_on: '게시일', publish_date: '발행일', url: '링크 주소', link: '링크 주소',
  channel_id: '채널', program_ids: '수익 모델', content_type: '글 유형', sources: '출처', name: '이름', price: '가격', price_checked_at: '가격 확인일',
  source_urls: '출처 주소', period_start: '시작일', period_end: '종료일', category: '카테고리', max_chars: '글자 수 제한', policy_url: '정책 주소',
  policy_checked_at: '확인일', source_url: '출처 주소', checked_at: '확인일', default_channel: '기본 채널', default_programs: '기본 수익 모델', per_day: '하루 발행 수',
  posted_on: '올린 날', terms: '검색어', backlog_limit: '쌓아둘 원고 한도', refresh: '개선안', focus: '고칠 점',
};
const ERR = {
  network: '인터넷 연결이 안 돼. 연결을 확인하고 다시 해줘.',
  auth: '로그인이 풀렸어. 접속 코드를 다시 넣어줘.',
  rate_limited: '접속 코드를 여러 번 틀려서 잠시 막혔어. 15분 뒤에 다시 해줘.',
  incompatible: '이 채널에서는 쓸 수 없는 수익 모델이야. 채널이나 수익 모델을 바꿔줘.',
  needs_experience: "'실제 경험 후기'는 내 경험을 적어야 요청할 수 있어. 경험을 적거나 글 유형을 바꿔줘.",
  db_update_needed: 'DB 업데이트가 아직 안 돼서 이 기능은 쓸 수 없어. 배포를 마저 해줘.',
  not_published: '게시한 글만 개선안을 요청할 수 있어 (실적·검색어를 보고 고쳐).',
  period_overlap: '이 글에 기간이 겹치는 검색어 기록이 있어. 겹치면 같은 유입이 두 번 세져서, 겹치는 기간을 지우고 넣어줘.',
  job_exists: '이 글은 이미 개선안을 기다리고 있어. 자동 작가가 쓴 뒤에 다시 요청해줘.',
  too_many_jobs: '기다리는 작업이 30개라 더 넣을 수 없어. 자동 작가가 처리한 뒤에 넣어줘.',
  too_many_jobs_today: '오늘 넣을 수 있는 작업(60개)을 다 썼어. 내일 다시 넣어줘.',
  check_failed: '발행 전 검사에서 고칠 게 남았어.',
  bad_transition: '지금 상태에서는 그렇게 바꿀 수 없어.',
  busy: '자동 작가가 쓰는 중이라 지금은 고칠 수 없어. 끝나면 다시 해줘.',
  need_publish_date: '예약하려면 발행일을 먼저 넣어줘.',
  need_published_info: '게시 완료로 바꾸려면 게시 주소와 게시일을 넣어줘.',
  use_retry: "'다시 요청'을 눌러줘.",
  not_found: '찾을 수 없어. 지워졌을 수 있어. 새로고침해줘.',
  bad_state: '이미 처리됐거나 지금은 바꿀 수 없어. 새로고침해줘.',
  in_use: '원고에 연결된 상품이라 지울 수 없어. 원고에서 먼저 연결을 빼줘.',
  no_values: '숫자를 하나 이상 넣어줘.',
  empty: '바뀐 내용이 없어.',
  too_large: '내용이 너무 커. 나눠서 올려줘.',
  too_many_rows: '한 번에 5,000줄까지 올릴 수 있어. 파일을 나눠줘.',
  no_body: '본문이 200자 이상 있어야 해.',
  vague_disclosure: "고지문을 '…수수료를 제공받습니다'처럼 분명하게 써줘. '받을 수 있음'은 공정위가 애매한 표현으로 봐.",
  bad_ref: '연결하려는 항목이 없어. 새로고침해줘.',
  duplicate: '이미 있는 항목이야.',
  bad_body: '보낸 내용을 읽지 못했어. 다시 해줘.',
  update_app: '앱이 예전 버전이야. 앱을 닫았다가 다시 열어서 업데이트해줘.',
  topic_used: '이 주제로 쓴 원고가 이미 있어.',
  server: '서버에서 문제가 생겼어. 잠시 뒤에 다시 해줘.',
  ...IMAGE_ERR,
};
Object.assign(FIELD, IMAGE_FIELD);
function errText(e) {
  const code = (e && e.code) || 'server';
  if (code === 'bad_field') {
    const f = String(e.field || '').replace(/^rows\[(\d+)\]\./, '').replace(/^row\./, '');
    return `${FIELD[f] || '입력한 값'}을(를) 확인해줘.`;
  }
  if (code === 'incompatible' && e.detail) return `쓸 수 없는 조합이야: ${e.detail}`;
  if (code === 'bad_image' && e.reason && IMAGE_REASON[e.reason]) return IMAGE_REASON[e.reason];
  if (code === 'image_in_use' && e.uses) return `${e.uses}곳에서 쓰는 이미지라 지울 수 없어. 먼저 연결을 빼줘.`;
  if (code === 'db_update_needed' && e.migration) return `DB 업데이트(${e.migration})가 아직 안 돼서 이 기능은 쓸 수 없어. 배포를 마저 해줘.`;
  return ERR[code] || ERR.server;
}
function showError(e) {
  if (e && e.code === 'check_failed' && Array.isArray(e.errors)) {
    openSheet('발행 전에 고칠 것', h('p', { class: 'hint' }, '아래를 고치면 발행 준비 완료로 바꿀 수 있어.'), checkList({ errors: e.errors, warnings: [], tips: [] }));
    return;
  }
  if (e && e.code === 'auth') return;
  toast(errText(e), 4000);
}

// ───────── 서버 ─────────
let session = LS.get('gf-session', '');
// AI 이미지 만들기만 받는 같은 서버 코드 (생성이 다른 요청과 섞이지 않는 일꾼에서 시작하도록 따로 올림). 없으면 화면이 본 서버로 다시 보냄
const GEN_API = API.replace(/blog-app$/, 'blog-gen');
async function api(path, { method = 'GET', body, timeout, gen } = {}) {
  const headers = {};
  if (session) headers['x-app-session'] = session;
  const form = typeof FormData !== 'undefined' && body instanceof FormData; // 파일 올리기 (경계 표시는 브라우저가 붙임)
  if (body !== undefined && !form) headers['content-type'] = 'application/json';
  // timeout(ms)을 주면 그 안에 답이 없을 때 멈추고 'timeout'으로 알려줌 (응답 본문을 다 받을 때까지)
  const ctrl = timeout && typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  let r, j = {};
  try {
    try {
      r = await fetch((gen ? GEN_API : API) + path, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body), cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
    } catch { throw { code: ctrl && ctrl.signal.aborted ? 'timeout' : 'network' }; }
    try { j = await r.json(); } catch { if (ctrl && ctrl.signal.aborted) throw { code: 'timeout' }; /* 빈 응답 */ }
  } finally { if (timer) clearTimeout(timer); }
  // 생성 전용 서버가 아직 없거나(404), 우리 서버가 아닌 곳이 거절했거나(401·403·405), 켜지지 못했으면(5xx — Supabase의 BOOT_ERROR 등)
  // 우리 서버의 오류 코드 모양이 아닐 때 로그아웃시키지 않고 알려줌 → 화면이 같은 요청 번호로 본 서버에 다시 보냄 (두 번 만들지 않음)
  const ours = !!(j && typeof j.error === 'string' && /^[a-z_]+$/.test(j.error));
  if (gen && !ours && ([401, 403, 404, 405].includes(r.status) || r.status >= 500)) throw { code: 'gen_unavailable', status: r.status };
  if (r.status === 401 && path !== '/login') { authLost(j.reason === 'expired' ? '오래 안 써서 로그아웃됐어. 접속 코드를 다시 넣어줘.' : ERR.auth); throw { code: 'auth' }; }
  if (!r.ok) throw { ...j, code: j.error || 'server', status: r.status };
  return j;
}
async function run(button, fn, okMsg) {
  if (button) button.disabled = true;
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) { showError(e); return undefined; } finally { if (button && button.isConnected) button.disabled = false; }
}

// ───────── 상태 ─────────
const S = {
  loaded: false, posts: [], trash: [], jobs: [], settings: null, runs: [], channels: [], programs: [], compat: [], topics: [],
  products: [], post_products: [], links: [], imports: [], image_slots: [], stats: {}, postMetrics: {}, manualMetrics: null,
  post_channels: [], search_terms: [], metric_post_ids: [], unavailable: [], runs_auto_7d: null,
};
let M = { prog: {}, ch: {}, prod: {}, post: {}, linksBy: {}, ppBy: {}, jobsBy: {}, slotsBy: {}, pcBy: {}, terms: new Map() };
const STATE_KEYS = ['posts', 'trash', 'jobs', 'settings', 'runs', 'channels', 'programs', 'compat', 'topics', 'products', 'post_products', 'links', 'imports', 'image_slots', 'post_channels', 'search_terms', 'metric_post_ids', 'unavailable', 'runs_auto_7d'];
// 서버가 null 로 보낼 수 있는 값 (null = 모름 — 예전 값을 그대로 두지 않음)
const NULLABLE_KEYS = new Set(['runs_auto_7d']);
// 서버가 못 읽은 것(DB 016 전이거나 오류)은 null — 계산에서 0이 아니라 '데이터 없음'으로
const known = (k) => ((S.unavailable || []).includes(k) ? null : S[k]);
function index() {
  M = {
    prog: Object.fromEntries(S.programs.map((p) => [p.id, p])),
    ch: Object.fromEntries(S.channels.map((c) => [c.id, c])),
    prod: Object.fromEntries(S.products.map((p) => [p.id, p])),
    post: Object.fromEntries(S.posts.map((p) => [p.id, p])),
    linksBy: groupBy(S.links, 'post_id'),
    ppBy: groupBy(S.post_products, 'post_id'),
    jobsBy: groupBy(S.jobs.filter((j) => j.post_id), 'post_id'),
    slotsBy: groupBy(S.image_slots || [], 'post_id'),
    pcBy: groupBy(S.post_channels || [], 'post_id'),
    terms: L.termsByPost(S.search_terms || []),
  };
}
const linksOf = (id) => L.sortedLinks(M.linksBy[id] || []);
const productsOf = (id) => (M.ppBy[id] || []).slice().sort((a, b) => a.sort - b.sort).map((pp) => M.prod[pp.product_id]).filter(Boolean);
const progName = (id) => (M.prog[id] && M.prog[id].name) || id;
const chName = (id) => (M.ch[id] && M.ch[id].name) || id || '채널 없음';
function checksFor(p, withOthers) {
  const r = checkPost(p, {
    programs: M.prog, channels: M.ch, compat: S.compat, links: linksOf(p.id), products: productsOf(p.id), today: todayS(),
    focus: (S.settings || {}).focus_topic || '', focusTerms: (S.settings || {}).focus_terms || '',
    others: withOthers ? S.posts.filter((o) => o.id !== p.id && o.body).slice(0, 80).map((o) => ({ id: o.id, title: titleOf(o), body: o.body })) : [],
  });
  // 이미지 검사(검수 전·실제 사진이 필요한 자리의 AI 이미지 등)는 '확인할 것'으로만 더함 — 발행을 막지 않음
  const chKind = (M.ch[p.channel_id] || {}).kind;
  const ic = IMG.imageChecks(p, (M.slotsBy[p.id] || []).map((x) => ({ slot_key: x.slot_key, image: x.post_images })), { search: chKind === 'blog' || chKind === 'site', naver: p.channel_id === 'naver_blog' });
  r.warnings.push(...ic.warnings);
  if (ic.tips.length) r.tips = r.tips.filter((t) => t.code !== 'image_placeholders').concat(ic.tips);
  return r;
}
// 이미지 스튜디오 (studio.js) — 화면 도구를 넘겨줌
const ST = createStudio({
  h, btn, field, det, opt, L, api: (...a) => api(...a), run: (...a) => run(...a), toast: (...a) => toast(...a), openSheet: (...a) => openSheet(...a), closeSheet: () => closeSheet(),
  confirmBox: (...a) => confirmBox(...a), go: (x) => go(x), load: () => load(), markDirty, clearDirty: () => { dirty = false; },
  setSheetOnClose: (f) => { sheetOnClose = f; }, setSheetGuard: (f) => { sheetGuard = f; }, copyPlain: (t, b) => copyPlain(t, b), errText: (e) => errText(e), titleOf,
  get S() { return S; }, post: (id) => M.post[id], productsOf, slotsOf: (id) => M.slotsBy[id] || [], programs: () => M.prog,
  onImages: (id) => refreshPreview(id), clearStats: () => { S.stats = {}; },
});
let lastLoad = 0, loading = false, pendingRender = false, lastSig = '';
async function load() {
  if (loading || !session) return;
  loading = true;
  try {
    const j = await api('/state');
    const sig = JSON.stringify(STATE_KEYS.map((k) => j[k]));
    const changed = sig !== lastSig;
    lastSig = sig;
    for (const k of STATE_KEYS) S[k] = NULLABLE_KEYS.has(k) && k in j ? j[k] : (j[k] ?? S[k]);
    S.serverVersion = j.version || '';
    S.loaded = true; lastLoad = Date.now(); index();
    $('#errLine').hidden = true;
    if (!changed) return; // 바뀐 게 없으면 화면을 다시 그리지 않음
    saveCache();
    if (editing()) { pendingRender = true; $('#newData').hidden = false; } else render();
  } catch (e) {
    if (e.code !== 'auth') {
      $('#errLine').textContent = e.code === 'network' ? '서버에 연결이 안 돼. 인터넷을 확인하고 새로고침해줘.' : '불러오지 못했어. 잠시 뒤에 새로고침해줘.';
      $('#errLine').hidden = false;
      if (!S.loaded) render();
    }
  } finally { loading = false; }
}
function saveCache() {
  try {
    const data = JSON.stringify({ at: Date.now(), ...Object.fromEntries(STATE_KEYS.map((k) => [k, S[k]])) });
    if (data.length < 3_000_000) localStorage.setItem('gf-cache2', data);
  } catch { /* 저장 공간 부족 */ }
}
function loadCache() {
  const c = LS.get('gf-cache2', null);
  if (!c || !Array.isArray(c.posts)) return;
  for (const k of STATE_KEYS) if (c[k] !== undefined) S[k] = c[k];
  S.loaded = true; index();
}
// within: 기간 안에 다 들어가는 실적만 (홈 '최근 7일 정리')
async function getStats(from, to, force, { within = false } = {}) {
  const key = `${from || ''}~${to || ''}${within ? '~in' : ''}`;
  if (!force && S.stats[key] && Date.now() - S.stats[key].at < 60_000) return S.stats[key].data;
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (within) q.set('within', '1');
  const j = await api('/stats' + (q.toString() ? '?' + q : ''));
  S.stats[key] = { at: Date.now(), data: j.stats };
  return j.stats;
}
function editing() {
  const a = document.activeElement;
  if (!$('#sheet').hidden) return true;
  return dirty || !!(a && $('#view').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox');
}

// ───────── 로그인 ─────────
function deviceLabel() {
  const ua = navigator.userAgent || '';
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : '기기';
  let standalone = false;
  try { standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch { /* 무시 */ }
  return `${dev} · ${standalone ? '홈 화면 앱' : '브라우저'}`;
}
async function login(code) {
  const j = await api('/login', { method: 'POST', body: { code, label: deviceLabel() } });
  session = j.session; LS.set('gf-session', session);
  LS.del('gf-token'); LS.del('gf-cache');
}
function showGate(msg) {
  $('#app').hidden = true; $('#tabbar').hidden = true; $('#gate').hidden = false;
  if (msg) $('#gateMsg').textContent = msg;
}
function authLost(msg) {
  session = ''; LS.del('gf-session');
  showGate(msg);
}
$('#gateShow').addEventListener('change', (e) => { $('#gateInput').type = e.target.checked ? 'text' : 'password'; });
async function gateSubmit() {
  const v = $('#gateInput').value.trim();
  if (v.length < 16) { $('#gateMsg').textContent = '접속 코드가 너무 짧아. 받은 코드를 그대로 넣어줘.'; return; }
  const b = $('#gateBtn'); b.disabled = true; $('#gateMsg').textContent = '확인 중…';
  try {
    await login(v);
    $('#gateInput').value = '';
    startApp();
  } catch (e) {
    $('#gateMsg').textContent = e.code === 'auth' || e.code === 'unauthorized' ? '접속 코드가 맞지 않아. 다시 확인해줘.' : errText(e);
  } finally { b.disabled = false; }
}
$('#gateBtn').addEventListener('click', gateSubmit);
$('#gateInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') gateSubmit(); });

// ───────── 화면 전환 ─────────
const TABS = ['home', 'content', 'topics', 'money', 'settings'];
let route = { tab: 'home', parts: [] };
function parseHash() {
  const parts = decodeURIComponent(location.hash.slice(1)).split('/').filter(Boolean);
  return TABS.includes(parts[0]) ? { tab: parts[0], parts: parts.slice(1) } : { tab: 'home', parts: [] };
}
const go = (path) => { if (location.hash === '#' + path) render(true); else location.hash = path; };
window.addEventListener('hashchange', () => { route = parseHash(); dirty = false; closeSheet(); render(true); window.scrollTo(0, 0); });
document.querySelectorAll('#tabbar button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
$('#refreshBtn').addEventListener('click', async () => {
  const b = $('#refreshBtn'); b.disabled = true; dirty = false; S.stats = {}; S.postMetrics = {}; S.manualMetrics = null; ST.invalidate();
  await load(); render(true); b.disabled = false; toast('최신으로 불러왔어');
});
$('#newDataBtn').addEventListener('click', () => { dirty = false; $('#newData').hidden = true; pendingRender = false; render(true); });

function render(force) {
  if (!force && editing()) { pendingRender = true; return; }
  pendingRender = false; $('#newData').hidden = true;
  const view = $('#view');
  document.querySelectorAll('#tabbar button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === route.tab)));
  const t = todayS();
  const youCount = S.posts.filter((p) => p.stage === 'review' || p.stage === 'verify' || p.stage === 'failed').length;
  $('#homeDot').hidden = !youCount; $('#homeDot').textContent = String(youCount);
  $('#subline').textContent = `${L.fmtDate(t)} · 확인할 원고 ${youCount}개`;
  view.textContent = '';
  if (!S.loaded) { view.append(h('p', { class: 'hint' }, '불러오는 중…')); return; }
  try {
    const fn = { home: viewHome, content: viewContent, topics: viewTopics, money: viewMoney, settings: viewSettings }[route.tab];
    view.append(fn());
  } catch (e) {
    console.error(e);
    view.append(h('p', { class: 'err' }, '화면을 그리다가 문제가 생겼어. 새로고침해줘.'));
  }
}

// ───────── 자동 작가 시간 ─────────
function nextRun(now = new Date()) {
  for (let add = 0; add < 2; add++) {
    for (const [hh, mi] of RUN_TIMES) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, hh, mi);
      if (d > now) return d;
    }
  }
  return null;
}
function nextRunText() {
  const d = nextRun();
  if (!d) return '';
  const today = d.getDate() === new Date().getDate();
  const hh = d.getHours();
  return `${today ? '오늘' : '내일'} ${hh < 12 ? '오전' : '오후'} ${hh % 12 || 12}:${L.pad(d.getMinutes())}쯤`;
}
const pendingJobs = () => S.jobs.filter((j) => j.status === 'pending');

// ═════════ 홈 ═════════
function viewHome() {
  const box = h('div', { class: 'view' });
  const t = todayS();
  const posts = S.posts;
  const review = posts.filter((p) => p.stage === 'review');
  const verify = posts.filter((p) => p.stage === 'verify');
  const failed = posts.filter((p) => p.stage === 'failed');
  const notLive = posts.filter((p) => !LIVE.includes(p.stage) && !WORK.includes(p.stage) && p.stage !== 'failed');
  const dueToday = notLive.filter((p) => p.publish_date === t);
  const late = notLive.filter((p) => p.publish_date && p.publish_date < t);
  const checked = posts.filter((p) => ['review', 'ready', 'scheduled'].includes(p.stage)).map((p) => ({ p, r: checksFor(p, false) }));
  const noLink = checked.filter((x) => x.r.errors.some((e) => e.code === 'link_missing' || e.code === 'link_error') || x.r.warnings.some((w) => w.code === 'affiliate_no_link'));
  const noSrc = checked.filter((x) => x.r.warnings.some((w) => w.code === 'sources_missing') || x.r.errors.some((e) => e.code === 'news_no_sources'));
  const failedJobs = S.jobs.filter((j) => j.status === 'failed' && j.kind !== 'write' && L.daysSince(j.created_at, t) <= 14);

  // 운영 흐름 (1.4.0): 주제 → 원고 → 게시 → 다른 채널 → 실적 → 개선, 지금 막힌 곳
  const syncRecs = homeRecs(t, null); // 실적을 불러오기 전 (불러오면 아래에서 바꿈)
  let ops = opsPanel(t, syncRecs.filter((r) => r.group === 'fix').length);
  box.append(ops);

  // 오늘 할 일
  const todo = h('div', { class: 'todo' });
  const add = (n, label, path, err) => { if (n) todo.append(h('button', { type: 'button', class: err ? 'e' : '', onclick: () => go(path) }, h('span', null, label), h('b', null, String(n)))); };
  add(review.length, '검수할 원고', 'content/f/you');
  add(verify.length, '정보를 더 넣어야 하는 원고', 'content/f/you', true);
  add(dueToday.length, '오늘 발행할 원고', 'content/f/today');
  add(late.length, '발행일이 지난 원고', 'content/f/late', true);
  add(noLink.length, '제휴 링크가 빠진 원고', 'content/f/links', true);
  add(noSrc.length, '출처가 빠진 원고', 'content/f/sources');
  add(failed.length + failedJobs.length, '실패한 작업', failed.length ? 'content/f/fail' : 'settings/jobs', true);
  const needMetrics = posts.filter((p) => LIVE.includes(p.stage) && p.published_on && L.daysSince(p.published_on, t) >= 7).length;
  if (!todo.children.length) todo.append(h('p', { class: 'hint' }, '지금 바로 할 일은 없어.'));
  box.append(h('section', { class: 'panel hi' }, h('h2', null, '오늘 할 일'), todo,
    h('div', { class: 'go' }, btn('+ 새 원고 요청', 'sm', () => go('content/new')), btn('주제 추천 보기', 'sm ghost', () => go('topics')))));

  box.append(seoPanel(t, checked));

  // 자동 작가
  const pend = pendingJobs();
  const lr = S.runs[0];
  const plan = L.autoPlan({ posts: S.posts, settings: S.settings || {}, today: t, pendingWrites: pend.filter((j) => j.kind === 'write').length }); // 요청 원고가 채워지면 쌓인 원고가 그만큼 늘어 (프롬프트 3단계와 같음)
  const writer = panel('자동 작가',
    h('p', { class: 'hint' }, `다음 실행 ${nextRunText()} · 기다리는 작업 ${pend.length}개 (원고 ${pend.filter((j) => j.kind === 'write').length} · 주제 ${pend.filter((j) => j.kind === 'topics').length} · 변환 ${pend.filter((j) => j.kind === 'reformat').length} · 개선안 ${pend.filter((j) => j.kind === 'refresh').length})`),
    h('p', { class: 'hint' }, `앞으로 7일(내일부터) 발행일이 잡힌 원고 ${plan.scheduled}편 / 목표 ${plan.goal}편 (하루 ${plan.perDay}편 × 7일)`),
    h('p', { class: plan.backlogFull ? 'notice' : 'hint' }, plan.backlogFull
      ? `검수·게시 안 한 원고 ${plan.backlog}개 / 쌓아둘 한도 ${plan.backlogLimit}개 — 한도가 차서 자동 작가가 새 자동 글을 멈췄어 (요청한 원고는 써). 검수·게시해서 ${plan.backlogLimit}개 아래로 줄이면 다시 써.`
      : `검수·게시 안 한 원고 ${plan.backlog}개 / 쌓아둘 한도 ${plan.backlogLimit}개`),
    h('p', { class: 'hint' }, !plan.enabled ? '자동 채우기가 꺼져 있거나 주제가 없어서 자동 글은 안 만들어.' : plan.autoNext ? `다음 실행에 자동 작가가 새로 쓸 예정: 최대 ${plan.autoNext}편 (요청한 원고를 먼저 쓰고, 한 번에 최대 4편${plan.roomNext < AUTO_MAX ? `, 쌓아둘 한도까지 ${plan.roomNext}편` : ''}). 쓴 원고는 '검수 필요'로 들어와.` : plan.backlogFull || plan.gap ? `쌓인 원고가 한도라서${plan.jobs && !plan.backlogFull ? ' (기다리는 요청 원고를 채우면 한도가 차서)' : ''} 다음 실행에 새 자동 글은 없어.` : '발행표가 차 있어서 다음 실행에 새 자동 글은 없어.'),
    lr ? h('p', { class: lr.status === '성공' ? 'hint' : 'notice' }, `마지막 실행: ${L.fmtTime(lr.ran_at)} · ${lr.status} · ${lr.note || `${lr.written}개 저장`}${lr.error ? ' · ' + lr.error : ''}`) : h('p', { class: 'hint' }, '아직 실행 기록이 없어.'),
    h('p', { class: 'hint' }, '하루 세 번 네 Claude 구독으로 실행돼. 지금 바로 쓰고 싶으면 Claude 안 글공장에서 써도 돼.'),
    h('div', { class: 'go' }, h('a', { class: 'btn sm ghost', href: ARTIFACT_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Claude 안 글공장 열기 ↗'), btn('작업 기록', 'sm ghost', () => go('settings/jobs'))));
  box.append(writer);

  // 발행 예정
  const week = notLive.filter((p) => p.publish_date && p.publish_date >= t && p.publish_date <= L.addDays(t, 7)).sort(byDate);
  const up = panel('발행 예정 (7일)');
  if (!week.length) up.append(h('p', { class: 'hint' }, '7일 안에 발행일이 잡힌 원고가 없어.'));
  else up.append(postList(week, { showDate: true }));
  up.append(h('p', { class: 'hint' }, '앱이 블로그에 대신 올리지는 않아. 그날 직접 올리고 "게시 완료 기록"을 눌러줘.'));
  box.append(up);

  // 수익·실적 (서버 통계)
  const money = panel('이번 달 수익', h('p', { class: 'hint' }, '불러오는 중…'));
  const traffic = panel('최근 30일 조회·클릭', h('p', { class: 'hint' }, '불러오는 중…'));
  const recBox = loopPanel(syncRecs, true);
  const weekBox = panel('최근 7일 정리', h('p', { class: 'hint' }, '불러오는 중…'));
  box.append(money, traffic, recBox, weekBox);
  const mr = L.monthRange(0, t);
  // 하나가 실패해도 나머지는 보여줌. 실패한 칸은 '불러오는 중'으로 멈추지 않고 이유를 보여줌
  Promise.allSettled([getStats(mr.from, mr.to), getStats(L.addDays(t, -29), t), getStats(L.addDays(t, -89), t),
    getStats(L.addDays(t, -6), t, false, { within: true }), getStats(L.addDays(t, -13), L.addDays(t, -7), false, { within: true })]).then((rs) => {
    if (rs.some((r) => r.status === 'rejected' && r.reason && r.reason.code === 'auth')) return;
    const [ms, ts, qs, ws, wp] = rs.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const why = (i) => errText(rs[i].reason);
    money.replaceChildren(h('h2', null, '이번 달 수익'), ...(ms ? [revenueKpis(ms.totals), h('p', { class: 'hint' }, '직접 입력하거나 파일로 올린 실적 기준이야. 제휴사와 자동 연결된 숫자가 아니야.')] : [h('p', { class: 'hint' }, '실적을 못 불러왔어: ' + why(0))]),
      h('div', { class: 'go' }, btn('실적 입력', 'sm ghost', () => go('money'))));
    traffic.replaceChildren(h('h2', null, '최근 30일 조회·클릭'), ts ? trafficKpis(ts) : h('p', { class: 'hint' }, '실적을 못 불러왔어: ' + why(1)));
    const recs = qs ? homeRecs(t, qs.by_post) : syncRecs;
    recBox.replaceWith(loopPanel(recs, false, needMetrics, qs ? '' : why(2)));
    if (qs) { const fresh = opsPanel(t, recs.filter((r) => r.group === 'fix').length); ops.replaceWith(fresh); ops = fresh; }
    weekBox.replaceWith(weeklyPanel(L.weeklySummary({ posts: S.posts, postChannels: known('post_channels'), searchTerms: known('search_terms'), runs: S.runs, runsAuto7d: S.runs_auto_7d, statsNow: ws, statsPrev: wp, today: t }), recs, ws && wp ? '' : why(ws ? 4 : 3)));
  });
  return box;
}
const AUTO_MAX = L.AUTO_RULES.maxAutoPerRun;
// 실적(stats)을 불러오기 전에는 실적이 필요 없는 추천만 (실적이 있는 글을 '실적 없음'으로 잠깐 잘못 보여주지 않게)
const NO_STATS_KINDS = ['title_from_search', 'new_from_search', 'recheck'];
const homeRecs = (t, byPost) => {
  const recs = L.recommendations({ posts: S.posts, byPost: byPost || [], products: S.products, postProducts: S.post_products, searchTerms: known('search_terms'), postChannels: known('post_channels'), channels: S.channels, today: t });
  return byPost ? recs : recs.filter((r) => NO_STATS_KINDS.includes(r.kind));
};
// 개선안은 게시한 글 중 본문이 있는 글만 (서버 createJob 과 같은 기준 — 직접 입력한 게시 기록은 본문이 없어서 못 만듦)
const REFRESH_MIN_BODY = 200;
const refreshBlock = (p) => (!p ? 'no_post' : !LIVE.includes(p.stage) ? 'not_live' : String(p.body || '').length < REFRESH_MIN_BODY ? 'no_body' : '');
const REFRESH_BLOCK_TEXT = {
  not_live: '게시한 글만 개선안을 요청할 수 있어 (실적·검색어를 보고 고쳐).',
  no_body: '본문 없이 게시 기록만 넣은 글이라 자동 작가가 개선안을 쓸 수 없어. 블로그 글을 보면서 직접 고쳐줘.',
};
// 검색 노출 도우미: 주력 주제 비율·하루 발행·사람 손(내 경험·직접 찍은 사진)·다가올 시즌·쇼핑 커넥트
// 검색 노출 점검 — 앱의 권장 기준 · 내 기록 · 실측 데이터 없음을 줄마다 구분해서 보여줌 (검색 순위 보장 아님)
const SEO_TAG = { app: '앱 권장 기준', mine: '내 기록', none: '실측 데이터 없음' };
function seoPanel(t, checked) {
  const st = S.settings || {};
  const focus = String(st.focus_topic || '').trim();
  const terms = String(st.focus_terms || '');
  const box = panel('검색 노출 점검');
  box.append(h('p', { class: 'hint' }, '검색 순위를 보장하지 않아. 네이버가 순위 공식을 공개하지 않아서, 네이버가 밝힌 방향에 맞춰 앱이 정한 권장 기준으로 네 글을 점검해.'));
  const rows = h('ul', { class: 'seo' });
  const li = (state, text, tags, extra) => rows.append(h('li', { class: state },
    h('span', null, state === 'ok' ? '✓' : state === 'warn' ? '!' : '·'), h('span', null, text),
    h('span', { class: 'seo-tags' }, (tags || []).map((k) => h('small', { class: 'seo-tag t-' + k }, SEO_TAG[k]))), extra || null));
  // 주력 주제 비율: 게시를 마친 글만 (초안은 안 셈). 네이버 블로그와 다른 블로그·사이트는 따로
  if (!focus) li('warn', '주력 주제가 아직 없어. 한 주제로 꾸준히 쓰면 그 주제 검색에서 더 잘 보일 수 있어.', ['app'], btn('정하기', 'sm ghost', () => go('settings/auto')));
  else {
    const groups = [['네이버 블로그', ['naver_blog']], ['다른 블로그·사이트', S.channels.filter((c) => (c.kind === 'blog' || c.kind === 'site') && c.id !== 'naver_blog').map((c) => c.id)]];
    let shown = 0;
    for (const [name, chs] of groups) {
      const fs = L.focusShare(S.posts, focus, 30, null, { terms, channels: chs });
      if (!fs.total && chs[0] !== 'naver_blog') continue;
      shown++;
      if (!fs.total) li('none', `${name}: 주력 주제(${focus}) 비율 — 데이터 없음 (게시한 글이 아직 없어. 초안은 안 셈)`, ['mine']);
      else li(fs.ratio >= fs.goal ? 'ok' : 'warn', `${name} 최근 게시한 글 ${fs.total}개 중 주력 주제(${focus}) 글 ${fs.hit}개 (${Math.round(fs.ratio * 100)}%)${fs.unclear ? ` · 판단 어려움 ${fs.unclear}개` : ''} — 목표 ${Math.round(fs.goal * 100)}% 이상`, ['mine', 'app']);
    }
    if (!shown) li('none', '주력 주제 비율 — 데이터 없음', ['mine']);
  }
  // 하루 발행 수: 네가 고른 설정을 그대로 두고, 권장 기준과 다르면 알려만 줌
  const plan = L.autoPlan({ posts: S.posts, settings: st, today: t });
  li(plan.differs ? 'tip' : 'ok', plan.differs ? `하루 발행 설정 ${plan.perDay}편 (네가 고른 값 그대로 둬) — 앱 권장은 하루 ${plan.recommended}편이야` : `하루 발행 설정 ${plan.perDay}편 (앱 권장 기준과 같아)`, ['app'], plan.differs ? btn('설정 보기', 'sm ghost', () => go('settings/auto')) : null);
  const crowd = L.crowdedDays(S.posts, t, plan.perDay);
  li(crowd.length ? 'warn' : 'ok', crowd.length ? `설정한 하루 ${plan.perDay}편보다 많이 잡힌 날: ${crowd.map((d) => `${L.fmtDate(d.day)} ${d.n}편`).join(', ')}` : `설정한 하루 ${plan.perDay}편을 넘는 날 없음 (지난 7일~다음 7일)`, ['mine']);
  const count = (code) => checked.filter((x) => x.r.warnings.some((w) => w.code === code)).length;
  const noMe = count('no_own_experience'), noPhoto = count('no_own_photo'), unkSrc = count('image_source_unknown');
  const todo = [noMe && `내 경험이 없는 글 ${noMe}개`, noPhoto && `직접 촬영으로 확인한 사진이 없는 글 ${noPhoto}개`, unkSrc && `출처를 안 고른 사진이 있는 글 ${unkSrc}개`].filter(Boolean);
  li(todo.length ? 'warn' : 'ok', todo.length ? `검수·발행 대기 글 중 ${todo.join(', ')}` : '검수·발행 대기 글에 내 경험·직접 촬영 사진·사진 출처가 다 들어가 있어', ['mine'],
    todo.length ? btn('보기', 'sm ghost', () => go('content/f/you')) : null);
  const sa = L.seasonAhead(t);
  const seasonHint = `${sa.months.join('·')}월 시즌: ${sa.themes.join(', ')}`;
  li('tip', `2~4주 뒤 많이 찾을 만한 주제 (앱에 적어 둔 달력) — ${sa.themes.join(', ')}`, ['none'],
    btn('이 시즌으로 주제 추천', 'sm ghost', (ev) => requestTopics(ev.currentTarget, { mode: 'category', category: focus || String(st.auto_topics || '').split(',')[0].trim() || '생활', count: 6, hint: seasonHint + ' (시즌 2~4주 전에 미리 쓸 주제)' })));
  const sc = M.prog && M.prog.naver_shopping_connect;
  if (sc && sc.my_status === '미가입') li('tip', '네이버 쇼핑 커넥트(네이버 블로그용 공식 제휴)도 같이 써볼 만해. 가입하면 설정 > 수익 모델에서 상태와 공식 고지문을 넣어줘.', [],
    h('a', { class: 'btn sm ghost', href: 'https://navercorp.com/media/pressReleasesDetail?seq=33116', target: '_blank', rel: 'noopener noreferrer' }, '소개 ↗'));
  box.append(rows, h('p', { class: 'hint' }, "'앱 권장 기준'은 앱이 정한 숫자, '내 기록'은 네가 앱에 남긴 글·게시 기록, '실측 데이터 없음'은 검색량·경쟁도를 조회하지 않은 참고 정보야."));
  return box;
}
function kpi(label, value, sub) {
  return h('div', { class: 'kpi' }, h('span', null, label), value == null ? h('b', { class: 'none' }, '데이터 없음') : h('b', null, value), sub ? h('small', null, sub) : null);
}
function revenueKpis(tot) {
  const est = L.val(tot, 'revenue_est'), conf = L.val(tot, 'revenue_confirmed'), paid = L.val(tot, 'revenue_paid'), cost = L.val(tot, 'cost');
  const net = L.netProfit(tot);
  return h('div', { class: 'kpis' },
    kpi('발생 수익', wonOrNone(est), tot.revenue_est && tot.revenue_est.n ? `기록 ${tot.revenue_est.n}건` : null),
    kpi('확정 수익', wonOrNone(conf), tot.revenue_confirmed && tot.revenue_confirmed.n ? `기록 ${tot.revenue_confirmed.n}건` : null),
    kpi('지급액', wonOrNone(paid)),
    kpi('비용', wonOrNone(cost)),
    kpi('확정 기준 순수익', wonOrNone(net.confirmed), net.confirmed == null ? null : (net.costMissing ? '비용 입력 없음 — 0원으로 계산' : '확정 수익 − 비용')),
  );
}
function trafficKpis(st) {
  const tot = st.totals || {};
  const r = L.rates(st.by_post);
  return h('div', { class: 'kpis' },
    kpi('조회수', L.val(tot, 'views') == null ? null : L.fmtNum(L.val(tot, 'views'))),
    kpi('링크 클릭', L.val(tot, 'clicks') == null ? null : L.fmtNum(L.val(tot, 'clicks')), '제휴사·블로그 통계 기준'),
    kpi('구매', L.val(tot, 'orders') == null ? null : L.fmtNum(L.val(tot, 'orders'))),
    kpi('클릭률', r.ctr == null ? null : L.pct(r.ctr), r.ctr == null ? null : `조회·클릭이 둘 다 있는 글 ${r.ctrPosts}개`),
    kpi('구매 전환율', r.conversion == null ? null : L.pct(r.conversion), r.conversion == null ? null : `클릭·구매가 둘 다 있는 글 ${r.convPosts}개`),
    kpi('조회 1,000회당 수익', r.rpm == null ? null : L.won(r.rpm), r.rpm == null ? null : `조회·발생 수익이 둘 다 있는 글 ${r.rpmPosts}개`),
  );
}
// 기간 안에 게시한 글 수와 실적이 들어온 글 수 (글 수는 앱 기록, 실적은 입력한 숫자 기준)
function countKpis(st, range) {
  const live = S.posts.filter((p) => LIVE.includes(p.stage));
  const inRange = range.from ? live.filter((p) => p.published_on && p.published_on >= range.from && p.published_on <= range.to) : live;
  const withData = (st.by_post || []).filter((a) => a.key && M.post[a.key]).length;
  const est = L.val(st.totals || {}, 'revenue_est');
  return h('div', { class: 'kpis' },
    kpi(range.from ? '이 기간에 게시한 글' : '게시한 글', String(inRange.length)),
    kpi('실적이 들어온 글', String(withData)),
    kpi('글 1개당 발생 수익', est == null || !withData ? null : L.won(est / withData), est == null || !withData ? null : '실적이 들어온 글 기준'),
  );
}
const CLICK_NOTE = '클릭 수는 제휴사·블로그 통계에서 넣은 숫자야. 앱은 제휴 링크를 바꾸지 않으려고 자체 클릭 추적(중간 주소 거치기)을 쓰지 않아서, 앱이 직접 센 클릭은 없어.';
function recList(recs) {
  if (!recs.length) return h('p', { class: 'hint' }, '지금은 추천할 게 없어.');
  return h('div', { class: 'list' }, recs.map((r) => h('div', { class: 'rec' },
    h('div', { class: 'split' }, h('b', null, r.title), h('span', { class: 'chip' }, '신뢰도 ' + r.confidence)),
    h('span', { class: 'small' }, (r.postId && M.post[r.postId] ? `「${titleOf(M.post[r.postId])}」 ` : '') + r.reason),
    r.data && r.data.length ? h('div', { class: 'data' }, r.data.map((d) => h('span', null, `${d.label} ${d.value}`))) : null,
    recAction(r))));
}
function recAction(r) {
  const a = r.action || {};
  if (a.type === 'post' && a.postId) return h('div', { class: 'go' }, btn('원고 보기', 'sm ghost', () => go('content/post/' + a.postId)));
  if (a.type === 'metrics' && a.postId) return h('div', { class: 'go' }, btn('실적 입력', 'sm ghost', () => metricSheet({ postId: a.postId })));
  if (a.type === 'import') return h('div', { class: 'go' }, btn('실적 넣으러 가기', 'sm ghost', () => go('money')));
  if (a.type === 'topics') return h('div', { class: 'go' }, btn(a.hint ? '이 검색어로 주제 추천받기' : '비슷한 주제 추천받기', 'sm ghost', (ev) => requestTopics(ev.currentTarget, { mode: 'performance', category: a.category || '', seed_post_id: a.seedPostId, hint: a.hint || (a.keyword ? `"${a.keyword}" 후속 주제` : ''), count: 6 })));
  if (a.type === 'refresh' && a.postId && M.post[a.postId]) {
    const pend = (M.jobsBy[a.postId] || []).some((j) => j.kind === 'refresh' && j.status === 'pending');
    const view = btn('원고 보기', 'sm ghost', () => go('content/post/' + a.postId));
    if (refreshBlock(M.post[a.postId])) return h('div', { class: 'go' }, view); // 본문 없는 기록 등은 개선안을 못 만듦 — 원고에서 직접
    return h('div', { class: 'go' }, pend ? h('span', { class: 'chip' }, '개선안 기다리는 중') : btn('개선안 요청', 'sm ghost', () => refreshSheet(M.post[a.postId], a.focus)), view);
  }
  return null;
}

// ═════════ 운영 시스템 (1.4.0) ═════════
// 흐름판: 주제 → 원고 → 게시 준비 → 게시 → 다른 채널 → 실적 → 개선 — 지금 막힌 곳과 바로 할 일 하나
function opsPanel(t, fixCount) {
  const f = L.opsFunnel({ posts: S.posts, postChannels: known('post_channels'), metricPostIds: known('metric_post_ids'), topics: S.topics, programs: S.programs, settings: S.settings || {}, channels: S.channels, fixCount, today: t });
  const box = h('section', { class: 'panel hi ops' }, h('h2', null, '운영 흐름'));
  box.append(h('ol', { class: 'flow', 'aria-label': '주제부터 개선까지 흐름' }, f.stages.map((st) => h('li', { class: 'st-' + st.state },
    h('span', null, st.label), h('b', { class: 'num' }, st.count == null ? '–' : st.of != null ? `${st.count}/${st.of}` : String(st.count)), st.sub ? h('small', null, st.sub) : null))));
  const bn = f.bottleneck;
  box.append(h('div', { class: bn.key === 'ok' ? 'okline' : 'notice' }, h('b', null, bn.key === 'ok' ? bn.title : '지금 막힌 곳: ' + bn.title), h('p', null, bn.reason), opsAction(bn.action)));
  const bl = f.backlog;
  if (bl.overdueScheduled) box.append(h('div', { class: 'split' }, h('span', { class: 'small' }, `예약한 날이 지난 원고 ${bl.overdueScheduled}개 — 블로그에 올라갔으면 '게시 완료 기록'을 해줘. 안 올라갔으면 원고에서 발행일을 바꿔줘 (예약 원고는 '날짜 다시 잡기'로 안 옮겨).`),
    btn('보기', 'sm ghost', () => go('content/f/late'))));
  if (bl.overdue) {
    box.append(h('div', { class: 'split' }, h('span', { class: 'small' }, `예정일이 지난 원고 ${bl.overdue}개 — 아직 안 올렸으면 내일부터 빈 날로 다시 잡을 수 있어 (하루 발행 수 그대로, 단계는 그대로. 예약 원고는 빼고)`),
      btn('날짜 다시 잡기', 'sm ghost', async (ev) => {
        if (!confirmBox(ev.currentTarget, `${bl.overdue}개를 다시 잡을까?`)) return;
        const j = await run(ev.currentTarget, () => api('/posts/reschedule-overdue', { method: 'POST', body: {} }));
        if (!j) return;
        const m = j.moved || [];
        toast(m.length ? `${m.length}개를 ${L.fmtDate(m[0].to)}부터 ${L.fmtDate(m[m.length - 1].to)}까지 다시 잡았어.` : '다시 잡을 원고가 없어.', 5000);
        await load();
      })));
  }
  if (!f.money.joined) box.append(h('div', { class: 'split' }, h('span', { class: 'small' }, `수익: '사용 중'인 수익 모델이 아직 없어${f.money.waiting ? ` (가입 대기 ${f.money.waiting}개)` : ''}. 이대로는 게시해도 수익이 안 잡혀. 가입했으면 상태를 '사용 중'으로 바꿔줘.`),
    btn('수익 모델 보기', 'sm ghost', () => go('settings/programs'))));
  return box;
}
function opsAction(a) {
  if (!a) return null;
  if (a.type === 'go') return h('div', { class: 'go' }, btn(a.label, 'sm', () => go(a.path)));
  if (a.type === 'post' && a.postId) return h('div', { class: 'go' }, btn(a.label, 'sm', () => go('content/post/' + a.postId)));
  if (a.type === 'metrics' && a.postId) return h('div', { class: 'go' }, btn(a.label, 'sm', () => metricSheet({ postId: a.postId })));
  return null;
}
// 개선 루프: 실적·유입 검색어·게시 기록으로 고른 다음 할 일을 '고칠 것·더 쓸 것·그만할 것·데이터 먼저'로 묶어서
function loopPanel(recs, waiting, needMetrics, failed) {
  const box = panel('개선 루프');
  box.append(h('p', { class: 'hint' }, '입력한 실적·유입 검색어·게시 기록으로 정한 규칙 기반 추천이야. 근거 숫자를 같이 보여줘.' + (waiting ? ' (실적 불러오는 중…)' : '')));
  if (failed) box.append(h('p', { class: 'notice' }, `실적을 못 불러와서 실적이 필요 없는 추천만 보여줘: ${failed}`));
  let any = false;
  for (const g of ['fix', 'more', 'stop', 'data']) {
    const list = recs.filter((r) => r.group === g);
    if (!list.length) continue;
    any = true;
    box.append(h('h3', null, `${L.REC_GROUPS[g]} ${list.length}`), recList(list.slice(0, 5)));
  }
  if (!any && !waiting && !failed) box.append(h('p', { class: 'hint' }, needMetrics ? `게시한 지 7일 지난 글 ${needMetrics}개에 실적을 넣어줘.` : '아직 고를 근거가 없어. 게시하고 실적·유입 검색어를 넣으면 여기서 고칠 글과 다음 글을 골라줘.'));
  box.append(h('div', { class: 'go' }, btn('실적으로 다음 주제 추천받기', 'sm', (ev) => requestTopics(ev.currentTarget, { mode: 'performance', count: 6 }))));
  return box;
}
// 최근 7일 정리: 원고·게시·다른 채널·검색어는 앱 기록, 조회·클릭·수익은 입력한 실적 (그 전 7일과 비교)
function weeklyPanel(w, recs, failed) {
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const box = panel(`최근 7일 정리 (${md(w.range.from)}~${md(w.range.to)})`);
  const fmt = (r, v) => (v == null ? null : r.money ? L.won(v) : L.fmtNum(v));
  const cmp = (r) => (r.prev == null ? (r.now == null ? null : '그 전 7일 데이터 없음') : `그 전 7일 ${fmt(r, r.prev)}`);
  box.append(h('div', { class: 'kpis' }, w.rows.map((r) => kpi(r.label, fmt(r, r.now), [cmp(r), r.sub].filter(Boolean).join(' · ') || null))));
  // 조회·클릭·수익은 그 7일 안에 다 들어가는 실적만 셈 — 한 달치처럼 걸쳐 있는 실적은 빼고 몇 줄인지 알려줌
  if (failed) box.append(h('p', { class: 'notice' }, `조회·클릭·수익을 못 불러왔어: ${failed}`));
  else if (w.partial || w.partialPrev) box.append(h('p', { class: 'hint' }, `조회·클릭·수익은 그 7일 안에 다 들어가는 실적만 셌어. 기간이 더 긴 실적(예: 한 달치) ${[w.partial && `최근 7일에 걸친 ${w.partial}줄`, w.partialPrev && `그 전 7일에 걸친 ${w.partialPrev}줄`].filter(Boolean).join(', ')}은 빼서 두 주에 똑같이 잡히지 않게 했어.`));
  if (w.top.length) box.append(h('h3', null, '이번 주 잘 된 글'), h('div', { class: 'list' }, w.top.map((x) => h('button', { type: 'button', class: 'rowbtn', onclick: () => go('content/post/' + x.postId) },
    h('span', null, M.post[x.postId] ? titleOf(M.post[x.postId]) : '지워진 글'), h('small', null, [x.revenue != null && `발생 ${L.won(x.revenue)}`, x.clicks != null && `클릭 ${L.fmtNum(x.clicks)}`, x.views != null && `조회 ${L.fmtNum(x.views)}`].filter(Boolean).join(' · '))))));
  const next = (recs || []).filter((r) => r.group === 'fix' || r.group === 'data').slice(0, 2).map((r) => r.title);
  box.append(h('p', { class: 'hint' }, `자동 작가 실행 ${w.ranAuto}번.${next.length ? ' 다음에 할 것: ' + next.join(' / ') : ''}`));
  return box;
}

// 다른 채널에 올리기: 같은 글을 채널에 맞게 바꿔 올린 기록 (앱이 대신 올리지는 않음)
const VARIANT_OF_CHANNEL = { naver_blog: 'naver_blog', tistory: 'tistory', website: 'website', threads: 'threads', instagram: 'instagram' };
function spreadPanel(p) {
  const rows = M.pcBy[p.id] || [];
  const live = LIVE.includes(p.stage);
  const others = S.channels.filter((c) => c.active && c.id !== p.channel_id);
  const unknownPc = known('post_channels') === null;
  const box = det('spread:' + p.id, unknownPc ? '다른 채널에 올리기' : `다른 채널에 올리기 (${rows.length}/${others.length})`, live);
  const inner = h('div', { class: 'stack', style: 'margin-top:10px' });
  if (!live) inner.append(h('p', { class: 'hint' }, `먼저 ${chName(p.channel_id)}에 올리고 '게시 완료 기록'을 해줘. 그다음 같은 글을 다른 채널에 맞게 바꿔 올리면 여기서 기록해.`));
  else if (unknownPc) inner.append(h('p', { class: 'notice' }, '다른 채널 기록을 지금 못 읽었어 (DB 업데이트(016) 전이거나 잠깐 오류). 새로고침해보고, 계속 그러면 배포를 확인해줘.'));
  else if (!others.length) inner.append(h('p', { class: 'hint' }, "켜 둔 다른 채널이 없어. 설정 > 게시 채널에서 쓰는 채널을 켜면 여기서 기록할 수 있어."), h('div', { class: 'go' }, btn('게시 채널 보기', 'sm ghost', () => go('settings/channels'))));
  else {
    inner.append(h('p', { class: 'hint' }, '같은 글을 채널에 맞게 바꿔 올리면 들어오는 길이 늘어. 앱이 대신 올리지는 않으니, 직접 올린 다음 기록해줘. 실적을 넣을 때 채널을 고르면 채널별로 따로 볼 수 있어.'));
    const v = p.variants || {};
    for (const c of others) {
      const rec = rows.find((x) => x.channel_id === c.id);
      const vk = VARIANT_OF_CHANNEL[c.id];
      const hasV = vk && v[vk] != null && v[vk] !== '';
      inner.append(h('div', { class: 'mrow' },
        h('div', { class: 'split' }, h('b', null, c.name), h('span', { class: rec ? 'chip v-ok' : 'chip' }, rec ? `올림 ${L.fmtDate(rec.posted_on)}` : '아직')),
        rec && rec.url ? h('a', { class: 'small', href: rec.url, target: '_blank', rel: 'noopener noreferrer' }, rec.url) : null,
        rec && rec.note ? h('span', { class: 'small muted' }, rec.note) : null,
        h('div', { class: 'go' },
          hasV ? h('button', { type: 'button', class: 'copy', onclick: (ev) => copyPlain(variantCopy(p, vk), ev.currentTarget) }, `${VARIANT_LABEL[vk]} 버전 복사`) : null,
          btn(rec ? '기록 고치기' : '올렸어 — 기록', 'sm ghost', () => spreadSheet(p, c, rec)),
          rec ? btn('기록 지우기', 'sm ghost', async (ev) => { if (!confirmBox(ev.currentTarget, '지울까?')) return; const j = await run(ev.currentTarget, () => api('/post-channels/' + rec.id, { method: 'DELETE' }), '지웠어'); if (j) await load(); }) : null)));
    }
    if (!Object.keys(VARIANT_LABEL).some((k) => v[k] != null && v[k] !== '')) inner.append(h('p', { class: 'hint' }, "채널별 버전이 아직 없어. 위 '채널별 버전 만들기'로 쓰레드·인스타·티스토리용 글을 먼저 받아도 돼."));
  }
  box.append(inner);
  return box;
}
function spreadSheet(p, c, rec) {
  const url = h('input', { type: 'url', value: rec ? rec.url : '', placeholder: 'https://' });
  const on = h('input', { type: 'date', value: rec ? rec.posted_on : todayS() });
  const v = p.variants || {};
  const vk = h('select', { value: rec ? rec.variant_key : (v[VARIANT_OF_CHANNEL[c.id]] ? VARIANT_OF_CHANNEL[c.id] : '') }, opt('', '고르지 않음'), Object.entries(VARIANT_LABEL).filter(([k]) => v[k] != null && v[k] !== '').map(([k, l]) => opt(k, l)));
  const note = h('input', { type: 'text', value: rec ? rec.note : '', maxlength: '300', placeholder: '예: 오전 9시에 올림' });
  openSheet(`${c.name}에 올린 기록`,
    h('p', { class: 'hint' }, '직접 올린 다음 그 글 주소를 넣어줘 (주소를 모르면 비워도 돼).'),
    field('올린 글 주소 (https)', url), field('올린 날', on), field('쓴 버전', vk), field('메모 (선택)', note),
    btn('저장', 'wide', async (ev) => {
      const u = url.value.trim();
      if (u && !/^https:\/\/[^\s"'<>]+$/i.test(u)) { toast('주소는 https://로 시작해야 해'); return; }
      if (!on.value) { toast('올린 날을 넣어줘'); return; }
      const j = await run(ev.currentTarget, () => api(`/posts/${p.id}/channels`, { method: 'POST', body: { channel_id: c.id, url: u, posted_on: on.value, variant_key: vk.value, note: note.value.trim() } }), '기록했어');
      if (j) { closeSheet(); await load(); }
    }));
}

// 검색 유입 키워드: 블로그 통계의 '유입 검색어'를 붙여넣어서 글마다 저장 (앱이 직접 모으지 않음)
function searchTermsPanel(p) {
  const list = M.terms.get(p.id) || [];
  const rows = (S.search_terms || []).filter((x) => x.post_id === p.id);
  const unknownSt = known('search_terms') === null;
  const box = det('terms:' + p.id, unknownSt ? '검색 유입 키워드' : `검색 유입 키워드 (${list.length})`, true);
  const inner = h('div', { class: 'stack', style: 'margin-top:10px' });
  inner.append(h('p', { class: 'hint' }, '블로그 통계의 유입 검색어를 복사해서 붙여넣어줘. 실제로 이 글에 들어온 검색어로 제목을 고치고 다음 주제를 골라. 앱이 직접 모으지는 않아.'));
  if (unknownSt) inner.append(h('p', { class: 'notice' }, '저장한 검색어를 지금 못 읽었어 (DB 업데이트(016) 전이거나 잠깐 오류). 새로고침해봐.'));
  if (list.length) {
    inner.append(h('div', { class: 'list' }, list.slice(0, 20).map((x) => h('div', { class: 'split' }, h('span', null, x.term), h('b', { class: 'num' }, x.views == null ? '숫자 없음' : `${L.fmtNum(x.views)}회`)))));
    // 숫자 없이 들어온 검색어(비율만 있는 통계)도 제목에 없으면 알려줌 — 추천(홈)은 숫자가 있는 것만 씀
    const gaps = L.titleGaps(p, list, 1, { unknown: true });
    const rb = refreshBlock(p);
    if (gaps.length) inner.append(h('p', { class: 'notice' }, `제목·키워드에 없는 검색어: ${gaps.slice(0, 3).map((g) => `'${g.term}'(${g.views == null ? '숫자 없음' : L.fmtNum(g.views) + '회'})`).join(', ')} — 제목이나 소제목에 넣어볼 만해.`),
      rb ? h('p', { class: 'hint' }, REFRESH_BLOCK_TEXT[rb] || '') : h('div', { class: 'go' }, btn('이 검색어로 개선안 요청', 'sm', () => refreshSheet(p, 'search'))));
    const periods = new Map();
    for (const r of rows) { const k = `${r.period_start}~${r.period_end}`; (periods.get(k) || periods.set(k, []).get(k)).push(r); }
    inner.append(h('div', { class: 'list' }, [...periods.entries()].map(([k, rs]) => h('div', { class: 'split' },
      h('span', { class: 'small' }, `${k.split('~').map(L.fmtDate).join('~')} · ${rs.length}개${rs[0].source_label ? ' · ' + rs[0].source_label : ''}`),
      btn('이 기간 지우기', 'sm ghost', async (ev) => {
        if (!confirmBox(ev.currentTarget, `${rs.length}개를 지울까?`)) return;
        const ok = await run(ev.currentTarget, async () => { for (const r of rs) await api('/search-terms/' + r.id, { method: 'DELETE' }); return true; }, '지웠어');
        if (ok) await load();
      })))));
  }
  const ta = h('textarea', { placeholder: '한 줄에 검색어 하나\n예) 원룸 전기요 23\n전기요 전자파 12\n표에서 복사해도 돼', style: 'min-height:90px' });
  const start = h('input', { type: 'date', value: L.addDays(todayS(), -6) }), end = h('input', { type: 'date', value: todayS() });
  const label = h('input', { type: 'text', value: p.channel_id === 'naver_blog' ? '네이버 블로그 통계 · 유입 검색어' : '블로그 통계 · 유입 검색어', maxlength: '60' });
  const preview = h('p', { class: 'hint' });
  const draw = () => {
    const r = L.parseSearchTerms(ta.value);
    preview.textContent = r.items.length ? `읽은 검색어 ${r.items.length}개: ${r.items.slice(0, 4).map((x) => `${x.term}${x.views == null ? '(숫자 없음)' : ' ' + L.fmtNum(x.views)}`).join(', ')}${r.items.length > 4 ? ' …' : ''}${r.skipped.length ? ` · 못 읽은 줄 ${r.skipped.length}개` : ''}`
      : (ta.value.trim() ? '읽은 검색어가 없어. 한 줄에 "검색어 숫자"로 적어줘.' : '');
  };
  ta.addEventListener('input', () => { markDirty(); draw(); });
  // 같은 글에 기간이 겹치는 기록이 있으면 서버가 거절(period_overlap) → 겹치는 기간을 보여주고, 확인을 받은 뒤에만 지우고 저장
  const overlapBox = h('div', { class: 'stack', hidden: true });
  const save = async (button, replace) => {
    const r = L.parseSearchTerms(ta.value);
    if (!r.items.length) { toast('읽은 검색어가 없어'); return; }
    if (!start.value) { toast('시작일을 넣어줘'); return; }
    if (end.value && end.value < start.value) { toast('종료일이 시작일보다 빨라'); return; }
    const body = { period_start: start.value, period_end: end.value || start.value, source_label: label.value.trim(), terms: r.items, ...(replace ? { replace_overlap: true } : {}) };
    button.disabled = true;
    let j;
    try { j = await api(`/posts/${p.id}/search-terms`, { method: 'POST', body }); } catch (e) {
      if (e && e.code === 'period_overlap' && !replace) showOverlap(e.periods || []); else showError(e);
      return;
    } finally { if (button.isConnected) button.disabled = false; }
    overlapBox.hidden = true;
    toast(`검색어 ${j.saved}개를 저장했어${replace ? ' (겹치던 기간은 지웠어)' : ''}`); dirty = false; await load();
  };
  const showOverlap = (periods) => {
    const txt = periods.map((x) => `${L.fmtDate(x.period_start)}~${L.fmtDate(x.period_end)}`).join(', ');
    overlapBox.replaceChildren(
      h('p', { class: 'notice' }, `이 글에 기간이 겹치는 검색어 기록이 있어${txt ? ` (${txt})` : ''}. 겹친 채로 넣으면 같은 유입이 두 번 세져. 겹치는 기간의 검색어를 지우고 이번 것으로 저장할까? (같은 기간을 다시 넣는 건 겹치는 게 아니라 숫자만 새로 바뀌어)`),
      h('div', { class: 'go' },
        btn('겹치는 기간 지우고 저장', 'sm', (ev) => { if (confirmBox(ev.currentTarget, '지우고 저장할까?')) save(ev.currentTarget, true); }),
        btn('그만두기', 'sm ghost', () => { overlapBox.hidden = true; })));
    overlapBox.hidden = false;
  };
  inner.append(field('유입 검색어 붙여넣기', ta), preview, h('div', { class: 'row' }, field('시작일', start), field('종료일', end)), field('어디서 본 숫자야?', label),
    btn('검색어 저장', 'sm', (ev) => save(ev.currentTarget, false)), overlapBox);
  box.append(inner);
  return box;
}

// 개선안: 게시한 글을 실적·유입 검색어로 어떻게 고칠지 자동 작가가 써 둔 것 (블로그 글은 사용자가 직접 고침)
const REFRESH_FOCUS = { all: '전체적으로', title: '제목·소제목', ctr: '링크 클릭 (위치·버튼 문구)', conversion: '구매 (상품 고르기·설명)', search: '실제 유입 검색어 반영' };
function refreshPanel(p) {
  const rf = p.refresh || {};
  const has = Object.keys(rf).some((k) => !k.startsWith('_'));
  const pend = (M.jobsBy[p.id] || []).find((j) => j.kind === 'refresh' && j.status === 'pending');
  const box = det('refresh:' + p.id, '개선안', has || !!pend);
  const inner = h('div', { class: 'stack', style: 'margin-top:10px' });
  if (pend) inner.append(h('p', { class: 'hint' }, `개선안을 기다리는 중이야. 자동 작가가 다음 실행(${nextRunText()})에 써줘.`));
  if (has) {
    inner.append(h('p', { class: 'hint' }, `${rf._updated_at ? L.fmtTime(rf._updated_at) + '에 ' : ''}자동 작가가 쓴 개선안이야. 올라간 글은 앱이 바꾸지 않으니, 마음에 드는 것만 블로그에서 직접 고쳐줘.`));
    const sec = (title, kids) => (kids && kids.length ? inner.append(h('h3', null, title), ...kids) : null);
    const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? [x.heading || x.title, x.why || x.text].filter(Boolean).join(' — ') : String(x))).filter(Boolean).slice(0, 10);
    sec('제목 후보', asList(rf.titles).map((x) => h('div', { class: 'split' }, h('span', null, x), h('button', { type: 'button', class: 'copy', onclick: (ev) => copyPlain(x, ev.currentTarget) }, '복사'))));
    sec('도입부', rf.intro ? [h('p', { class: 'sns' }, String(rf.intro)), h('div', { class: 'go' }, h('button', { type: 'button', class: 'copy', onclick: (ev) => copyPlain(String(rf.intro), ev.currentTarget) }, '복사'))] : []);
    sec('소제목', asList(rf.headings).map((x) => h('p', { class: 'small' }, '· ' + x)));
    sec('더하면 좋은 부분', asList(rf.add_sections).map((x) => h('p', { class: 'small' }, '· ' + x)));
    sec('링크·버튼', [rf.cta && h('p', { class: 'small' }, '버튼 문구: ' + rf.cta), rf.link_positions && h('p', { class: 'small' }, '위치: ' + rf.link_positions)].filter(Boolean));
    sec('그대로 둘 것', asList(rf.keep).map((x) => h('p', { class: 'small' }, '· ' + x)));
    sec('근거', asList(rf.based_on).map((x) => h('p', { class: 'small muted' }, '· ' + x)));
    if (rf.notes) inner.append(h('p', { class: 'small muted' }, String(rf.notes)));
    inner.append(h('div', { class: 'go' }, btn('개선안 지우기', 'sm ghost', async (ev) => { if (!confirmBox(ev.currentTarget, '지울까?')) return; await patchPost(p, { refresh: null }, ev.currentTarget, '지웠어'); })));
  }
  if (!pend) {
    const rb = refreshBlock(p);
    inner.append(btn(has ? '개선안 다시 요청' : '개선안 요청', 'sm', () => refreshSheet(p), { disabled: !!rb }));
    inner.append(h('p', { class: 'hint' }, rb ? (REFRESH_BLOCK_TEXT[rb] || '') : '자동 작가가 이 글의 실적·유입 검색어·다른 채널 기록을 보고 제목·도입부·소제목·링크 위치를 어떻게 고치면 좋을지 써줘. 없는 숫자는 만들지 않아.'));
  }
  box.append(inner);
  return box;
}
function refreshSheet(p, focus = 'all') {
  if (!p) return;
  const rb = refreshBlock(p);
  if (rb) { toast(REFRESH_BLOCK_TEXT[rb] || ERR.server, 4000); return; }
  const sel = h('select', { value: REFRESH_FOCUS[focus] ? focus : 'all' }, Object.entries(REFRESH_FOCUS).map(([k, v]) => opt(k, v)));
  const note = h('input', { type: 'text', maxlength: '300', placeholder: '예: 제목에 전기세 얘기를 넣고 싶어' });
  openSheet('개선안 요청', h('p', { class: 'hint' }, `「${titleOf(p)}」 — 자동 작가가 다음 실행(${nextRunText()})에 이 글의 실적·유입 검색어·다른 채널 기록을 보고 고칠 점을 써줘. 글은 바꾸지 않고 개선안만 남겨.`),
    field('무엇을 고칠까?', sel), field('요청 사항 (선택)', note),
    btn('요청하기', 'wide', async (ev) => {
      const j = await run(ev.currentTarget, () => api('/jobs', { method: 'POST', body: { kind: 'refresh', post_id: p.id, focus: sel.value, note: note.value.trim() } }), `개선안을 요청했어. 다음 실행(${nextRunText()})에 써줘.`);
      if (j) { closeSheet(); await load(); }
    }));
}

// ═════════ 콘텐츠 ═════════
const byDate = (a, b) => String(a.publish_date || '9999').localeCompare(String(b.publish_date || '9999')) || String(a.created_at || '').localeCompare(String(b.created_at || ''));
function viewContent() {
  const [a, b] = route.parts;
  if (a === 'post' && b && route.parts[2] === 'cards') return M.post[b] ? ST.viewCards(M.post[b]) : viewPost(b);
  if (a === 'post' && b) return viewPost(b);
  if (a === 'images') return ST.viewLibrary();
  if (a === 'new') return viewNew(route.parts[1] === 'topic' ? route.parts[2] : null);
  return viewList(a === 'f' ? b : 'all');
}
let listQuery = '';
function filterPosts(f) {
  const t = todayS();
  const ps = S.posts;
  switch (f) {
    case 'you': return ps.filter((p) => p.stage === 'review' || p.stage === 'verify');
    case 'work': return ps.filter((p) => WORK.includes(p.stage));
    case 'ready': return ps.filter((p) => p.stage === 'ready' || p.stage === 'scheduled');
    case 'live': return ps.filter((p) => LIVE.includes(p.stage));
    case 'fail': return ps.filter((p) => p.stage === 'failed');
    case 'today': return ps.filter((p) => p.publish_date === t && !LIVE.includes(p.stage));
    case 'late': return ps.filter((p) => p.publish_date && p.publish_date < t && !LIVE.includes(p.stage) && !WORK.includes(p.stage) && p.stage !== 'failed');
    case 'links': return ps.filter((p) => ['review', 'ready', 'scheduled'].includes(p.stage)).filter((p) => { const r = checksFor(p, false); return r.errors.some((e) => e.code === 'link_missing' || e.code === 'link_error') || r.warnings.some((w) => w.code === 'affiliate_no_link'); });
    case 'sources': return ps.filter((p) => ['review', 'ready', 'scheduled'].includes(p.stage)).filter((p) => { const r = checksFor(p, false); return r.warnings.some((w) => w.code === 'sources_missing') || r.errors.some((e) => e.code === 'news_no_sources'); });
    default: return ps;
  }
}
const FILTERS = [['all', '전체'], ['you', '확인 필요'], ['work', '작업 중'], ['ready', '발행 준비'], ['live', '게시됨'], ['fail', '실패']];
const EXTRA_FILTER = { today: '오늘 발행', late: '발행일 지남', links: '링크 빠짐', sources: '출처 빠짐' };
function viewList(f) {
  const box = h('div', { class: 'view' });
  box.append(h('div', { class: 'go' }, btn('+ 새 원고 요청', '', () => go('content/new')), btn('이미 올린 글 기록', 'ghost', manualPostSheet), btn('이미지 보관함', 'ghost', () => go('content/images'))));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '상태별 보기' },
    FILTERS.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(k === f), onclick: () => go(k === 'all' ? 'content' : 'content/f/' + k) }, `${label} ${filterPosts(k).length}`)));
  if (EXTRA_FILTER[f]) seg.append(h('button', { type: 'button', 'aria-pressed': 'true' }, `${EXTRA_FILTER[f]} ${filterPosts(f).length}`));
  const search = h('input', { type: 'search', placeholder: '제목·키워드로 찾기', value: listQuery, 'aria-label': '원고 찾기' });
  const listBox = h('div');
  const draw = () => {
    const q = listQuery.trim().toLowerCase();
    let ps = filterPosts(f).filter((p) => !q || `${titleOf(p)} ${p.keyword}`.toLowerCase().includes(q));
    const live = ps.filter((p) => LIVE.includes(p.stage)).sort((x, y) => String(y.published_on || '').localeCompare(String(x.published_on || '')));
    ps = ps.filter((p) => !LIVE.includes(p.stage)).sort(byDate).concat(live);
    listBox.replaceChildren(ps.length ? postList(ps.slice(0, 200), { showDate: true, flags: true }) : h('p', { class: 'hint' }, '해당하는 원고가 없어.'));
  };
  search.addEventListener('input', () => { listQuery = search.value; draw(); });
  draw();
  box.append(seg, search, listBox);
  return box;
}
function postList(ps, { showDate, flags } = {}) {
  return h('div', { class: 'list' }, ps.map((p) => {
    const meta = [chName(p.channel_id)];
    if (showDate) meta.push(LIVE.includes(p.stage) ? (p.published_on ? '게시 ' + L.fmtDate(p.published_on) : '게시일 없음') : (p.publish_date ? L.fmtDate(p.publish_date) : '날짜 미정'));
    if (p.content_type && CONTENT_TYPES[p.content_type]) meta.push(CONTENT_TYPES[p.content_type].label);
    let fl = null;
    if (flags && !WORK.includes(p.stage) && p.body) {
      const r = checksFor(p, false);
      const me = countMe(p.body);
      const ic = ST.slotCount(p);
      fl = h('span', { class: 'flags' }, r.errors.length ? h('span', { class: 'flag e' }, `고칠 것 ${r.errors.length}`) : null, me ? h('span', { class: 'flag w' }, `✏️${me}`) : null,
        // 초록은 모든 자리에 '사용 가능'으로 검수한 이미지가 있을 때만 (검수 전·사용 안 함이 있으면 아직)
        ic ? h('span', { class: 'flag ' + (ic.usable === ic.total ? 'ok' : 'i'), title: `사진 자리 ${ic.total}곳 중 ${ic.linked}곳 연결 · 검수 완료 ${ic.usable}곳` }, `📷${ic.linked}/${ic.total}`) : null);
    }
    return h('div', { class: 'item' },
      h('button', { type: 'button', class: 'main', onclick: () => go('content/post/' + p.id) }, h('b', null, titleOf(p)), h('small', null, meta.join(' · '))),
      h('div', { class: 'side' }, fl, badge(p)));
  }));
}

// ── 새 원고 요청 ──
const draft = { keyword: '', title: '', category: '', topic_id: '', channel_id: '', program_ids: null, content_type: '', link: '', experience: '', ref: '', notes: '', len: '', products: [] };
function resetDraft() { Object.assign(draft, { keyword: '', title: '', category: '', topic_id: '', channel_id: '', program_ids: null, content_type: '', link: '', experience: '', ref: '', notes: '', len: '', products: [] }); }
// 주제의 카테고리를 원고 카테고리로 옮길 때: 주력 주제 이름 그대로면 옮기지 않음 (비워 두면 자동 작가가 글에 맞는 세부 분류로 정함)
function topicCategory(tp, st) {
  const c = String((tp && tp.category) || '').trim();
  return c && c !== String((st && st.focus_topic) || '').trim() ? c : '';
}
function viewNew(topicId) {
  const st = S.settings || {};
  if (!draft.channel_id) draft.channel_id = st.default_channel || 'naver_blog';
  if (!draft.program_ids) draft.program_ids = (st.default_programs || []).slice();
  if (topicId && draft.topic_id !== topicId) {
    const tp = S.topics.find((x) => x.id === topicId);
    if (tp) Object.assign(draft, { topic_id: tp.id, keyword: tp.keyword || tp.title, title: '', category: topicCategory(tp, st), content_type: CONTENT_TYPES[tp.rec_content_type] ? tp.rec_content_type : '' });
  }
  const box = h('div', { class: 'view' });
  box.append(btn('← 콘텐츠', 'sm ghost back', () => go('content')));
  const wrap = panel('새 원고 요청');
  const cats = String(st.auto_topics || '').split(',').map((s) => s.trim()).filter(Boolean);

  // 1. 무엇을
  const kw = h('input', { type: 'text', value: draft.keyword, placeholder: '예: 원룸 전기요 고르는 법', oninput: (e) => { draft.keyword = e.target.value; markDirty(); } });
  const adopted = S.topics.filter((x) => x.status === '채택' || x.status === '후보');
  const topicSel = h('select', { value: draft.topic_id, onchange: (e) => {
    const tp = S.topics.find((x) => x.id === e.target.value);
    if (tp) Object.assign(draft, { topic_id: tp.id, keyword: tp.keyword || tp.title, category: topicCategory(tp, st) || draft.category, content_type: CONTENT_TYPES[tp.rec_content_type] ? tp.rec_content_type : draft.content_type });
    else draft.topic_id = '';
    render(true);
  } }, opt('', '고르지 않음'), adopted.map((x) => opt(x.id, `${x.status === '채택' ? '★ ' : ''}${x.title}`)));
  const catIn = h('input', { type: 'text', value: draft.category, list: 'catlist', placeholder: cats[0] || '카테고리', oninput: (e) => { draft.category = e.target.value; markDirty(); } });
  wrap.append(h('p', { class: 'legend' }, '1. 무엇을 쓸까'),
    adopted.length ? field('주제 목록에서 고르기 (선택)', topicSel) : null,
    field('키워드', kw, '검색하는 사람이 칠 말 그대로 (3~5단어)'),
    field('카테고리', catIn), h('datalist', { id: 'catlist' }, cats.map((c) => opt(c, c))));

  // 2. 어디에
  const chSeg = h('div', { class: 'seg' }, S.channels.filter((c) => c.active).map((c) => h('button', { type: 'button', 'aria-pressed': String(draft.channel_id === c.id), onclick: () => { draft.channel_id = c.id; draft.program_ids = draft.program_ids.filter((pid) => compatOf(pid, c.id, S.compat).verdict !== '불가'); render(true); } }, c.name)));
  wrap.append(h('p', { class: 'legend' }, '2. 어디에 올릴까'), chSeg, M.ch[draft.channel_id] && M.ch[draft.channel_id].notes ? h('p', { class: 'hint' }, M.ch[draft.channel_id].notes) : null);

  // 3. 수익 모델
  wrap.append(h('p', { class: 'legend' }, '3. 어떻게 벌까 (여러 개 가능)'), programPicker(draft.channel_id, draft.program_ids, (ids) => { draft.program_ids = ids; render(true); }));

  // 4. 글 유형
  const ct = h('select', { value: draft.content_type, onchange: (e) => { draft.content_type = e.target.value; render(true); } }, opt('', '알아서 골라줘'), Object.entries(CONTENT_TYPES).map(([k, v]) => opt(k, v.label)));
  const exp = h('textarea', { value: draft.experience, placeholder: '예: 6평 원룸에서 2주 동안 씀. 따뜻한데 선 정리가 불편했어', oninput: (e) => { draft.experience = e.target.value; markDirty(); } });
  wrap.append(h('p', { class: 'legend' }, '4. 어떤 글로'), field('글 유형', ct),
    field(draft.content_type === 'experience_review' ? '내 실제 경험 (꼭 필요)' : '내 실제 경험 (있으면)', exp, '직접 써본 것만 적어줘. 없으면 비워두면 돼 — 써본 것처럼 쓰지 않아.'));

  // 5. 상품·정보
  const more = det('new:more', '5. 상품 링크·참고 글·요청 사항 (선택)', !!(draft.link || draft.ref || draft.notes || draft.products.length), '');
  const prodPick = h('div', { class: 'seg' }, S.products.slice(0, 40).map((pr) => h('button', { type: 'button', 'aria-pressed': String(draft.products.includes(pr.id)), onclick: () => { draft.products = draft.products.includes(pr.id) ? draft.products.filter((x) => x !== pr.id) : [...draft.products, pr.id]; render(true); } }, pr.name)));
  more.append(h('div', { class: 'stack', style: 'margin-top:10px' },
    field('제휴 링크', h('input', { type: 'url', value: draft.link, placeholder: 'https://link.coupang.com/...', oninput: (e) => { draft.link = e.target.value; markDirty(); } }), '받은 링크 그대로 넣어줘. 앱은 링크를 바꾸거나 줄이지 않아.'),
    S.products.length ? h('div', null, h('p', { class: 'legend' }, '연결할 상품'), prodPick) : null,
    field('참고할 글 (구성·말투만 참고, 문장은 새로 써)', h('textarea', { value: draft.ref, oninput: (e) => { draft.ref = e.target.value; markDirty(); } })),
    field('자동 작가에게 요청 사항', h('input', { type: 'text', value: draft.notes, placeholder: '예: 자취생 기준으로, 전기요금 부분 자세히', oninput: (e) => { draft.notes = e.target.value; markDirty(); } })),
    field('길이', h('select', { value: draft.len, onchange: (e) => { draft.len = e.target.value; } }, opt('', `기본값 (${st.len || 2500}자)`), opt('1500', '보통 (1,500자)'), opt('2500', '길게 (2,500자)'), opt('3500', '아주 길게 (3,500자)')))));
  wrap.append(more);

  // 요청
  const blocked = draft.program_ids.some((pid) => compatOf(pid, draft.channel_id, S.compat).verdict === '불가');
  const needExp = draft.content_type === 'experience_review' && !draft.experience.trim();
  const submit = btn('원고 요청하기', 'wide', async (ev) => {
    if (!draft.keyword.trim()) { toast('키워드를 넣어줘'); kw.focus(); return; }
    if (draft.link && !L.safeUrl(draft.link)) { toast('제휴 링크는 https://로 시작해야 해'); return; }
    const body = { keyword: draft.keyword.trim(), title: draft.title.trim(), category: draft.category.trim(), topic_id: draft.topic_id || undefined, channel_id: draft.channel_id, program_ids: draft.program_ids,
      content_type: draft.content_type, link: draft.link.trim(), experience: draft.experience.trim(), ref: draft.ref.trim(), notes: draft.notes.trim(), len: draft.len, products: draft.products };
    const j = await run(ev.currentTarget, () => api('/posts', { method: 'POST', body }));
    if (!j) return;
    resetDraft(); dirty = false;
    toast(`요청했어. 다음 자동 작성(${nextRunText()})에 써줘.`, 4000);
    await load();
    go('content/post/' + j.post_id);
  }, { disabled: blocked || needExp });
  wrap.append(h('p', { class: 'legend' }, '6. 요청'),
    blocked ? h('p', { class: 'badbox' }, '이 채널에서 쓸 수 없는 수익 모델이 골라져 있어.') : null,
    needExp ? h('p', { class: 'notice' }, '실제 경험 후기는 경험을 적어야 요청할 수 있어.') : null,
    submit, h('p', { class: 'hint' }, `자동 작가가 다음 실행(${nextRunText()})에 써서 '검수 필요'로 넣어줘. 바로 필요하면 Claude 안 글공장에서 써도 돼.`));
  box.append(wrap);
  return box;
}
function programPicker(channelId, selected, onChange) {
  const box = h('div', { class: 'stack' });
  for (const p of S.programs.filter((x) => x.active)) {
    const c = compatOf(p.id, channelId, S.compat);
    const on = selected.includes(p.id);
    const b = h('button', { type: 'button', 'aria-pressed': String(on), disabled: c.verdict === '불가' && !on,
      onclick: () => onChange(on ? selected.filter((x) => x !== p.id) : [...selected, p.id]) }, p.name);
    box.append(h('div', { class: 'prog' },
      h('div', { class: 'split' }, h('div', { class: 'seg' }, b), h('span', { class: 'badge ' + verdictClass(c.verdict) }, c.verdict)),
      h('small', { class: 'hint' }, [`${KIND_LABEL[p.kind] || ''} · 내 상태 ${p.my_status}`, c.reason].filter(Boolean).join(' · '))));
  }
  box.append(h('p', { class: 'hint' }, "'확인 필요'는 공식 안내로 아직 확인 못 한 조합이야. 설정 > 조합표에서 바꿀 수 있어."));
  return box;
}

// ── 이미 올린 글 기록 ──
function manualPostSheet() {
  const st = S.settings || {};
  const f = { title: h('input', { type: 'text' }), url: h('input', { type: 'url', placeholder: 'https://blog.naver.com/...' }), on: h('input', { type: 'date', value: todayS() }),
    ch: h('select', { value: st.default_channel || 'naver_blog' }, S.channels.map((c) => opt(c.id, c.name))), cat: h('input', { type: 'text' }) };
  let progs = (st.default_programs || []).slice();
  const pp = h('div');
  const drawPP = () => pp.replaceChildren(programPicker(f.ch.value, progs, (ids) => { progs = ids; drawPP(); }));
  f.ch.addEventListener('change', drawPP); drawPP();
  openSheet('이미 올린 글 기록',
    h('p', { class: 'hint' }, 'AI 없이 이미 올린 글을 등록해서 실적을 연결할 때 써.'),
    field('제목', f.title), field('게시 주소', f.url), field('게시일', f.on), field('채널', f.ch), field('카테고리', f.cat), pp,
    btn('기록하기', 'wide', async (ev) => {
      if (!f.title.value.trim()) { toast('제목을 넣어줘'); return; }
      if (!L.safeUrl(f.url.value)) { toast('게시 주소를 https://로 시작하게 넣어줘'); return; }
      if (!f.on.value) { toast('게시일을 넣어줘'); return; }
      const j = await run(ev.currentTarget, () => api('/posts', { method: 'POST', body: { mode: 'manual', title: f.title.value.trim(), blog_url: f.url.value.trim(), published_on: f.on.value || null, channel_id: f.ch.value, program_ids: progs, category: f.cat.value.trim() } }), '기록했어');
      if (j) { closeSheet(); await load(); go('content/post/' + j.post.id); }
    }));
}

// ── 원고 상세 ──
const STEPS = [['요청', ['queued']], ['원고 생성', ['researching', 'writing']], ['검수', ['review', 'verify']], ['발행 준비', ['ready', 'scheduled']], ['게시', ['published']], ['실적', ['collecting', 'analyzed']]];
function stepper(p) {
  let cur = STEPS.findIndex(([, st]) => st.includes(p.stage));
  const failed = p.stage === 'failed';
  if (failed) cur = 1;
  return h('ol', { class: 'stepper', 'aria-label': '진행 단계' }, STEPS.map(([label], i) => h('li', { class: i < cur ? 'done' : i === cur ? (failed ? 'bad' : 'cur') : '' }, h('i'), label)));
}
function checkList(r) {
  const li = (cls, x) => h('li', { class: cls }, h('span', null, x.msg), x.fix ? h('small', null, '→ ' + x.fix) : null, (x.examples || []).map((ex) => h('q', null, '“' + ex + '”')));
  const items = [...r.errors.map((x) => li('e', x)), ...r.warnings.map((x) => li('w', x)), ...r.tips.map((x) => li('t', x))];
  return items.length ? h('ul', { class: 'checks' }, items) : h('p', { class: 'okbox' }, '검사에서 걸린 게 없어.');
}
function viewPost(id) {
  const p = M.post[id];
  const box = h('div', { class: 'view' });
  box.append(btn('← 콘텐츠', 'sm ghost back', () => history.length > 1 ? history.back() : go('content')));
  if (!p) { box.append(h('p', { class: 'hint' }, '이 원고를 찾을 수 없어. 지워졌거나 아직 불러오는 중이야.')); return box; }
  const r = p.body ? checksFor(p, true) : { errors: [], warnings: [], tips: [] };
  const links = linksOf(p.id);
  const head = h('section', { class: 'panel hi' },
    h('div', { class: 'split' }, badge(p), h('span', { class: 'hint' }, chName(p.channel_id))),
    h('h2', null, titleOf(p)),
    h('p', { class: 'hint' }, [p.keyword && `키워드 ${p.keyword}`, (p.program_ids || []).map(progName).join(', ') || '수익 모델 없음', p.content_type && CONTENT_TYPES[p.content_type] ? CONTENT_TYPES[p.content_type].label : '글 유형 자동'].filter(Boolean).join(' · ')),
    stepper(p), stageActions(p, r));
  box.append(head);
  if (p.body) {
    box.append(panel(`발행 전 검사 (고칠 것 ${r.errors.length} · 확인 ${r.warnings.length})`, checkList(r)));
    box.append(copyPanel(p, r, links));
    box.append(bodyPanel(p));
    if (!WORK.includes(p.stage)) box.append(ST.postPanel(p));
    box.append(linksPanel(p, links));
    box.append(productsPanel(p));
    box.append(sourcesPanel(p));
    box.append(variantsPanel(p));
    box.append(spreadPanel(p));
  } else if (!WORK.includes(p.stage)) {
    box.append(panel('원고', h('p', { class: 'hint' }, '아직 본문이 없어.')));
  }
  box.append(settingsPanel(p));
  box.append(publishPanel(p));
  if (LIVE.includes(p.stage) || p.blog_url) box.append(postMetricsPanel(p));
  if (LIVE.includes(p.stage)) box.append(searchTermsPanel(p));
  if (p.body && (LIVE.includes(p.stage) || (p.refresh && Object.keys(p.refresh).length))) box.append(refreshPanel(p));
  box.append(jobsPanel(p));
  return box;
}
async function setStage(p, stage, extra, button, okMsg) {
  const j = await run(button, () => api('/posts/' + p.id, { method: 'POST', body: { stage, ...(extra || {}) } }), okMsg);
  if (j) { await load(); if (j.demoted) showError({ code: 'check_failed', errors: j.demoted }); }
  return j;
}
function stageActions(p, r) {
  const box = h('div', { class: 'stack' });
  const s = p.stage;
  const jobs = (M.jobsBy[p.id] || []).filter((j) => j.kind === 'write');
  const pend = jobs.find((j) => j.status === 'pending');
  if (s === 'queued') {
    box.append(h('p', { class: 'hint' }, `자동 작가가 다음 실행(${nextRunText()})에 써줘.`));
    if (pend && !pend.started_at) box.append(h('div', { class: 'go' }, btn('요청 취소', 'sm danger', (ev) => run(ev.currentTarget, async () => { await api('/jobs/' + pend.id, { method: 'DELETE' }); await load(); }, '요청을 취소했어'))));
  } else if (s === 'writing' || s === 'researching') {
    const stale = pend && pend.started_at && Date.now() - Date.parse(pend.started_at) > 30 * 60e3;
    box.append(h('p', { class: 'hint' }, stale ? '작성이 30분 넘게 끝나지 않았어. 다음 실행에서 다시 시도해.' : '자동 작가가 지금 쓰는 중이야.'));
  } else if (s === 'verify' || s === 'failed') {
    box.append(h('p', { class: s === 'verify' ? 'notice' : 'badbox' }, (s === 'verify' ? '정보가 더 필요해: ' : '작업이 실패했어: ') + (p.error || '이유가 기록되지 않았어.')));
    const exp = h('textarea', { value: p.experience || '', placeholder: '실제 경험이 필요하면 여기에 적어줘', oninput: markDirty });
    box.append(field('내 실제 경험', exp), h('div', { class: 'go' },
      btn('다시 요청', 'sm', (ev) => run(ev.currentTarget, async () => {
        if ((exp.value || '') !== (p.experience || '')) await api('/posts/' + p.id, { method: 'POST', body: { experience: exp.value } });
        await api('/posts/' + p.id + '/retry', { method: 'POST', body: {} });
        dirty = false; await load();
      }, `다시 넣었어. 다음 실행(${nextRunText()})에 써줘.`))));
  } else if (s === 'review') {
    const ok = r.errors.length === 0;
    box.append(h('div', { class: 'go' }, btn('발행 준비 완료로', 'sm', (ev) => setStage(p, 'ready', null, ev.currentTarget, '발행 준비 완료!'), { disabled: !ok })),
      h('p', { class: 'hint' }, ok ? '확인할 것(노란색)도 한 번 읽어보고 넘어가줘.' : `고칠 것 ${r.errors.length}개를 먼저 고쳐줘 (아래 '발행 전 검사').`));
  } else if (s === 'ready' || s === 'scheduled') {
    const d = h('input', { type: 'date', value: p.publish_date || '' });
    box.append(h('div', { class: 'row' }, field('발행 예정일', d)),
      h('div', { class: 'go' },
        btn(s === 'scheduled' ? '예정일 바꾸기' : '발행 예약', 'sm ghost', (ev) => { if (!d.value) { toast('날짜를 골라줘'); return; } setStage(p, 'scheduled', { publish_date: d.value }, ev.currentTarget, '예약했어'); }),
        btn('게시 완료 기록', 'sm', () => publishSheet(p)),
        s === 'scheduled' ? btn('예약 취소', 'sm ghost', (ev) => setStage(p, 'ready', null, ev.currentTarget, '예약을 취소했어')) : btn('검수로 되돌리기', 'sm ghost', (ev) => setStage(p, 'review', null, ev.currentTarget))),
      h('p', { class: 'hint' }, '예약은 날짜 표시만이야. 앱이 대신 올리지 않으니 그날 직접 올리고 게시 완료를 기록해줘.'));
  } else if (s === 'published' || s === 'collecting') {
    box.append(h('div', { class: 'go' }, btn('실적 입력', 'sm', () => metricSheet({ postId: p.id })),
      btn('성과 분석 완료로', 'sm ghost', (ev) => setStage(p, 'analyzed', null, ev.currentTarget, '분석 완료로 표시했어')),
      s === 'published' ? btn('게시 취소(준비 완료로)', 'sm ghost', (ev) => setStage(p, 'ready', null, ev.currentTarget)) : null));
  } else if (s === 'analyzed') {
    box.append(h('div', { class: 'go' }, btn('실적 입력', 'sm ghost', () => metricSheet({ postId: p.id })), btn('다시 실적 수집 중으로', 'sm ghost', (ev) => setStage(p, 'collecting', null, ev.currentTarget))));
  }
  return box;
}
function publishSheet(p) {
  const url = h('input', { type: 'url', value: p.blog_url || '', placeholder: 'https://blog.naver.com/...' });
  const on = h('input', { type: 'date', value: p.published_on || todayS() });
  const mins = h('input', { type: 'text', inputmode: 'numeric', value: p.effort_minutes ?? '', placeholder: '예: 40' });
  openSheet('게시 완료 기록',
    h('p', { class: 'hint' }, '블로그에 직접 올린 다음, 그 글 주소를 넣어줘.'),
    field('게시 주소', url), field('게시일', on), field('이 글에 쓴 시간(분, 선택)', mins, '나중에 시간 대비 수익을 계산할 때 써.'),
    btn('게시 완료로 바꾸기', 'wide', async (ev) => {
      if (!L.safeUrl(url.value)) { toast('게시 주소는 https://로 시작해야 해'); return; }
      const m = mins.value.trim() ? Number(mins.value.replace(/[^\d]/g, '')) : undefined;
      const j = await setStage(p, 'published', { blog_url: url.value.trim(), published_on: on.value, ...(m != null && !Number.isNaN(m) ? { effort_minutes: m } : {}) }, ev.currentTarget, '게시 완료로 기록했어');
      if (j) closeSheet();
    }));
}
async function patchPost(p, body, button, okMsg) {
  const j = await run(button, () => api('/posts/' + p.id, { method: 'POST', body }), okMsg);
  if (j) {
    dirty = false;
    if ('body' in body) ST.invalidate(p.id); // 사진 자리가 바뀌었을 수 있음
    await load();
    if (j.demoted) showError({ code: 'check_failed', errors: j.demoted });
    else if (j.image_sync && (j.image_sync.rekeyed || j.image_sync.orphans)) {
      toast([j.image_sync.rekeyed ? `설명이 바뀐 사진 자리 ${j.image_sync.rekeyed}곳은 이미지 연결을 옮겼어.` : '', j.image_sync.orphans ? `본문에서 사라진 자리 ${j.image_sync.orphans}곳의 이미지는 그대로 있어 (이미지 칸 아래에서 확인).` : ''].filter(Boolean).join(' '), 6000);
    }
  }
  return j;
}

// 복사
function copyPlain(text, button) {
  const fallback = () => {
    const ta = h('textarea', { readonly: true, style: 'position:fixed;left:-9999px;top:0' }); ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* 무시 */ }
    ta.remove();
    if (ok) flash(button); else copySheet(text);
  };
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(() => flash(button), fallback); return; } } catch { /* 아래로 */ }
  fallback();
}
function copyRich(html, plain, button) {
  let item = null;
  try {
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) item = new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) });
  } catch { item = null; }
  if (item) { navigator.clipboard.write([item]).then(() => flash(button), () => richFallback(html, plain, button)); return; }
  richFallback(html, plain, button);
}
function richFallback(html, plain, button) {
  let ok = false;
  try {
    const div = h('div', { contenteditable: 'true', style: 'position:fixed;left:-9999px;top:0' });
    div.innerHTML = html; document.body.append(div);
    const range = document.createRange(); range.selectNodeContents(div);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    ok = document.execCommand('copy'); sel.removeAllRanges(); div.remove();
  } catch { /* 무시 */ }
  if (ok) flash(button); else copyPlain(plain, button);
}
function copySheet(text) {
  const ta = h('textarea', { class: 'copybox', readonly: true }); ta.value = text;
  openSheet('직접 복사해줘', h('p', { class: 'hint' }, '자동 복사가 막혔어. 아래 칸을 길게 눌러 전체 선택한 뒤 복사해줘.'), ta);
  ta.focus(); ta.select();
}
function flash(button) {
  if (!button) { toast('복사했어'); return; }
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.textContent = '복사됨'; clearTimeout(button._t);
  button._t = setTimeout(() => { button.textContent = button.dataset.label; }, 1600);
}
function copyPanel(p, r, links) {
  const ctx = { links, programs: M.prog, images: ST.exportImages(p) };
  const disc = disclosureFor(p.program_ids, M.prog);
  const box = panel('블로그에 올리기');
  // 고지문이 없거나 애매하면 복사 자체를 막음 (고지 없이 제휴·협찬 글이 나가지 않게)
  const discBlock = disc.missing.length
    ? `${disc.missing.map((x) => x.name).join(', ')} 고지문이 비어 있어서 복사를 막아뒀어. 설정 > 수익 모델에서 공식 문구를 넣어줘.`
    : (disc.text && VAGUE_DISCLOSURE.test(disc.text) ? "고지문이 '수수료를 받을 수 있습니다'처럼 애매해서 복사를 막아뒀어. 설정 > 수익 모델에서 '…수수료를 제공받습니다'처럼 분명하게 고쳐줘." : '');
  if (discBlock) {
    box.append(h('p', { class: 'badbox' }, discBlock), h('div', { class: 'go' }, btn('수익 모델 설정 열기', 'sm ghost', () => go('settings/programs'))));
    return box;
  }
  if (r.errors.length) box.append(h('p', { class: 'notice' }, `고칠 것 ${r.errors.length}개가 남아 있어. 이대로 복사하면 그대로 올라가.`));
  box.append(h('div', { class: 'go' },
    btn('서식 그대로 복사', 'sm', (ev) => copyRich(L.exportHtml(p, ctx), L.exportPlain(p, ctx), ev.currentTarget)),
    btn('HTML 코드', 'sm ghost', (ev) => copyPlain(L.exportHtml(p, ctx), ev.currentTarget)),
    btn('텍스트만', 'sm ghost', (ev) => copyPlain(L.exportPlain(p, ctx), ev.currentTarget))));
  if (countImg(p.body)) box.append(h('p', { class: 'hint' }, "📷 사진은 앱이 블로그에 대신 올리지 않아. 복사한 글의 사진 자리마다 내려받을 파일 이름이 적혀 있으니, 원고 아래 '이미지'에서 '모두 내려받기'로 받은 파일을 그 자리에 넣어줘."));
  if (disc.text) box.append(h('p', { class: 'hint' }, '맨 위에 이 고지문이 자동으로 들어가:'), h('p', { class: 'sns' }, disc.text));
  else if ((p.program_ids || []).length) box.append(h('p', { class: 'hint' }, '이 글의 수익 모델에는 넣을 고지문이 없어 (설정 > 수익 모델에서 확인).'));
  const tags = p.hashtags || [];
  if (tags.length) box.append(h('div', { class: 'go' }, btn('#해시태그 복사', 'sm ghost', (ev) => copyPlain(tags.map((t) => '#' + t).join(' '), ev.currentTarget)), btn('쉼표 태그 복사', 'sm ghost', (ev) => copyPlain(tags.join(', '), ev.currentTarget))));
  const th = L.threadsShare(p, ctx);
  box.append(h('div', { class: 'go' },
    h('a', { class: 'btn sm ghost', href: th.url, target: '_blank', rel: 'noopener noreferrer' }, '쓰레드에 올리기 ↗'),
    btn('인스타 캡션 복사', 'sm ghost', (ev) => copyPlain(L.instagramText(p, ctx), ev.currentTarget))),
  h('p', { class: 'hint' }, th.hint + ' 제휴 링크는 받은 그대로 쓰고 바꾸지 않아.'));
  return box;
}
function bodyPanel(p) {
  const box = panel('원고');
  const titles = h('ul', { class: 'titles' }, (p.titles || []).map((t) => h('li', null, h('span', null, t), h('button', { type: 'button', class: 'copy', onclick: (ev) => copyPlain(t, ev.currentTarget) }, '복사'))));
  box.append(h('h3', null, '제목 후보'), titles);
  const holes = L.meHints(p.body);
  if (holes.length) {
    const inputs = holes.map((hint) => h('textarea', { style: 'min-height:64px', placeholder: '직접 겪은 그대로 적어줘', oninput: markDirty }));
    box.append(h('div', { class: 'fill' }, h('h3', null, `✏️ 내 경험 채우기 (${holes.length}곳)`),
      holes.map((hint, i) => h('label', { class: 'f' }, h('span', { class: 'hintline' }, hint || '경험 한두 줄'), inputs[i])),
      h('p', { class: 'hint' }, '진짜 경험만 적어줘. 비워둔 칸은 그대로 남아. 경험이 없으면 빈 칸을 지워.'),
      h('div', { class: 'go' },
        btn('본문에 넣기', 'sm', (ev) => {
          const a = inputs.map((t) => t.value);
          if (!a.some((x) => x.trim())) { toast('한 칸 이상 적어줘'); return; }
          // 채운 경험은 '내 경험' 칸에도 남김 → 검사가 '직접 겪은 내용 있음'으로 봄
          const added = a.map((x) => x.trim()).filter(Boolean).join('\n');
          const exp = [String(p.experience || '').trim(), added].filter(Boolean).join('\n').slice(0, 3000);
          patchPost(p, { body: L.fillMe(p.body, a), experience: exp }, ev.currentTarget, '본문에 넣었어');
        }),
        btn('빈 칸 모두 지우기', 'sm ghost', (ev) => patchPost(p, { body: removeEmptyMe(p.body) }, ev.currentTarget, '빈 칸을 지웠어')))));
  }
  const img = countImg(p.body);
  if (img) {
    const c = ST.slotCount(p);
    box.append(h('p', { class: 'notice' }, `📷 사진 자리 ${img}곳 · 이미지 연결 ${c ? c.linked : 0}곳 — 아래 '이미지'에서 만들거나 찾거나 올려서 연결하고, 블로그에는 내려받아서 직접 넣어줘.`));
  }
  const prev = h('div', { class: 'post', id: 'pv-' + p.id });
  fillPreview(prev, p);
  const editBox = h('div', { class: 'stack' });
  const startEdit = () => {
    const ta = h('textarea', { class: 'body-edit', value: p.body, oninput: markDirty });
    const tt = h('textarea', { value: (p.titles || []).join('\n'), style: 'min-height:90px', oninput: markDirty });
    editBox.replaceChildren(field('제목 (한 줄에 하나)', tt), field('본문', ta, '"## " 소제목, "- " 목록, "[링크: 문구]" 링크 자리, "[이미지: 설명]" 사진 자리'),
      h('div', { class: 'go' },
        btn('저장', 'sm', (ev) => patchPost(p, { body: ta.value, titles: tt.value.split('\n').map((s) => s.trim()).filter(Boolean) }, ev.currentTarget, '저장했어')),
        btn('취소', 'sm ghost', () => { dirty = false; render(true); })));
    prev.hidden = true; ta.focus();
  };
  editBox.append(h('div', { class: 'go' }, btn('본문 고치기', 'sm ghost', startEdit, { disabled: WORK.includes(p.stage) }), h('span', { class: 'hint num' }, `${p.body.length.toLocaleString()}자`)));
  box.append(h('h3', null, '미리보기'), editBox, prev);
  if (p.summary) box.append(h('h3', null, '요약'), h('p', { class: 'sns' }, p.summary));
  const fc = p.ai_notes && Array.isArray(p.ai_notes.needs_fact_check) ? p.ai_notes.needs_fact_check.filter(Boolean) : [];
  if (p.ai_notes && p.ai_notes.notes) box.append(h('p', { class: 'hint' }, '자동 작가 메모: ' + p.ai_notes.notes));
  if (fc.length) box.append(h('p', { class: 'notice' }, 'AI가 사실 확인이 필요하다고 표시한 문장: ' + fc.join(' / ')));
  return box;
}
// 원고 미리보기 (연결된 이미지는 서명 주소로 보여줌 — 이미지 정보를 받으면 다시 그림)
function fillPreview(el, p) {
  el.textContent = '';
  const disc = disclosureFor(p.program_ids, M.prog).text;
  if (disc) el.append(h('p', { class: 'disc' }, disc));
  el.insertAdjacentHTML('beforeend', L.viewHtml(p, linksOf(p.id), ST.previewImages(p)));
}
function refreshPreview(id) {
  const el = document.getElementById('pv-' + id);
  const p = M.post[id];
  if (el && p && !el.hidden) fillPreview(el, p);
}
function linksPanel(p, links) {
  const box = panel(`제휴 링크 (${links.length})`);
  const prods = productsOf(p.id);
  for (const l of links) {
    const stSeg = h('div', { class: 'seg' }, ['미확인', '정상', '오류'].map((s) => h('button', { type: 'button', 'aria-pressed': String(l.status === s), onclick: async (ev) => {
      const j = await run(ev.currentTarget, () => api('/links/' + l.id, { method: 'POST', body: { status: s } }));
      if (j) { await load(); if (j.demoted) showError({ code: 'check_failed', errors: j.demoted }); }
    } }, s)));
    box.append(h('div', { class: 'linkrow' },
      h('div', { class: 'split' }, h('b', null, l.cta || '버튼 문구 없음'), h('span', { class: 'chip' }, progName(l.program_id) || '수익 모델 없음')),
      h('span', { class: 'url' }, l.url),
      l.product_id && M.prod[l.product_id] ? h('span', { class: 'hint' }, '상품: ' + M.prod[l.product_id].name) : null,
      stSeg,
      h('div', { class: 'go' }, h('a', { class: 'copy', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, '열어서 확인 ↗'),
        h('button', { type: 'button', class: 'copy', onclick: (ev) => copyPlain(l.url, ev.currentTarget) }, '복사'),
        LIVE.includes(p.stage) ? h('button', { type: 'button', class: 'copy', onclick: () => metricSheet({ postId: p.id, linkId: l.id }) }, '이 링크 실적') : null,
        h('button', { type: 'button', class: 'copy', onclick: async (ev) => { if (!confirmBox(ev.currentTarget, '정말 지울까?')) return; const j = await run(ev.currentTarget, () => api('/links/' + l.id, { method: 'DELETE' }), '지웠어'); if (j) await load(); } }, '지우기'))));
  }
  const url = h('input', { type: 'url', placeholder: 'https://link.coupang.com/a/...', oninput: markDirty });
  const cta = h('input', { type: 'text', placeholder: '예: 최저가 확인하기', oninput: markDirty });
  const prog = h('select', null, (p.program_ids || []).map((id) => opt(id, progName(id))), opt('', '수익 모델 없음'));
  const prod = h('select', null, opt('', '상품 연결 안 함'), prods.map((x) => opt(x.id, x.name)));
  const addBox = det('links:add:' + p.id, '+ 링크 넣기', !links.length, '');
  box.append(addBox);
  addBox.append(h('div', { class: 'stack', style: 'margin-top:10px' },
    field('링크 주소', url, '제휴사에서 받은 링크를 그대로 넣어줘. 앱은 링크를 바꾸거나 줄이지 않아.'), field('버튼 문구', cta), h('div', { class: 'row' }, field('수익 모델', prog), field('상품', prod)),
    btn('넣기', 'sm', async (ev) => {
      if (!L.safeUrl(url.value)) { toast('https://로 시작하는 링크를 넣어줘'); return; }
      const j = await run(ev.currentTarget, () => api('/posts/' + p.id + '/links', { method: 'POST', body: { url: url.value.trim(), cta: cta.value.trim(), program_id: prog.value || undefined, product_id: prod.value || undefined } }), '링크를 넣었어');
      if (j) { dirty = false; await load(); }
    })));
  box.append(h('p', { class: 'hint' }, "본문의 [링크] 자리에 위에서부터 차례로 들어가고, 자리가 더 많으면 마지막 링크가 들어가. '오류' 링크는 빠져. 확인은 한 번 열어보는 걸로 충분해 — 내가 산 건 수익으로 인정 안 될 수 있어."));
  return box;
}
function confirmBox(button, msg) {
  if (button.dataset.armed === '1') return true;
  button.dataset.armed = '1'; button.dataset.label = button.textContent; button.textContent = msg + ' 한 번 더 눌러줘';
  setTimeout(() => { if (button.isConnected) { button.dataset.armed = ''; button.textContent = button.dataset.label; } }, 3500);
  return false;
}
function productCard(x, actions) {
  return h('div', { class: 'prod' },
    h('div', { class: 'split' }, h('b', null, x.name), h('span', { class: 'badge ' + (x.trust === '확인 완료' ? 'v-ok' : x.trust === '출처 있음' ? 'v-unk' : 'v-no') }, x.trust)),
    h('span', { class: 'hint' }, [x.brand, x.model, x.category].filter(Boolean).join(' · ') || '브랜드·모델 없음'),
    h('span', { class: 'hint' }, x.price != null ? `가격 ${L.won(x.price)} (${x.price_checked_at || '확인일 없음'} 확인)` : '가격 기록 없음'),
    (x.source_urls || []).length ? h('span', { class: 'hint' }, '출처 ' + x.source_urls.length + '개') : null,
    actions ? h('div', { class: 'go' }, actions) : null);
}
function productsPanel(p) {
  const prods = productsOf(p.id);
  const ct = CONTENT_TYPES[p.content_type];
  const box = panel(`상품 (${prods.length})`);
  if (ct && ct.minProducts) box.append(h('p', { class: 'hint' }, `${ct.label} 글은 상품을 ${ct.minProducts}개 이상 연결하는 게 좋아.`));
  for (const x of prods) {
    box.append(productCard(x, [btn('고치기', 'sm ghost', () => productSheet(x)), btn('연결 빼기', 'sm ghost', async (ev) => { const j = await run(ev.currentTarget, () => api(`/posts/${p.id}/products/${x.id}`, { method: 'DELETE' }), '연결을 뺐어'); if (j) { await load(); if (j.demoted) showError({ code: 'check_failed', errors: j.demoted }); } })]));
  }
  const others = S.products.filter((x) => !prods.includes(x));
  const pick = h('select', null, opt('', '저장된 상품에서 고르기'), others.map((x) => opt(x.id, x.name)));
  box.append(h('div', { class: 'go' },
    others.length ? pick : null,
    others.length ? btn('연결', 'sm ghost', async (ev) => { if (!pick.value) return; const j = await run(ev.currentTarget, () => api(`/posts/${p.id}/products`, { method: 'POST', body: { product_id: pick.value } }), '연결했어'); if (j) await load(); }) : null,
    btn('+ 새 상품', 'sm ghost', () => productSheet(null, p.id))));
  box.append(h('p', { class: 'hint' }, '가격은 자주 바뀌어. 가격을 본문에 쓰려면 7일 안에 확인한 가격을 넣어둬야 검사를 통과해.'));
  return box;
}
function productSheet(x, attachTo) {
  const v = x || {};
  const f = {
    name: h('input', { type: 'text', value: v.name || '' }), brand: h('input', { type: 'text', value: v.brand || '' }), model: h('input', { type: 'text', value: v.model || '' }),
    category: h('input', { type: 'text', value: v.category || '' }), price: h('input', { type: 'text', inputmode: 'numeric', value: v.price ?? '' }),
    priceAt: h('input', { type: 'date', value: v.price_checked_at || todayS() }), priceSrc: h('input', { type: 'url', value: v.price_source_url || '' }),
    srcs: h('textarea', { value: (v.source_urls || []).join('\n'), placeholder: '공식 상품 페이지 주소 (한 줄에 하나)' }),
    pros: h('textarea', { value: v.pros || '' }), cons: h('textarea', { value: v.cons || '' }),
    trust: h('select', { value: v.trust || '' }, opt('', '자동 (출처가 있으면 출처 있음)'), opt('미검증', '미검증'), opt('출처 있음', '출처 있음'), opt('확인 완료', '내가 직접 확인 완료')),
    used: h('input', { type: 'checkbox', checked: !!v.used_by_me }),
  };
  openSheet(x ? '상품 고치기' : '새 상품',
    field('상품명', f.name), h('div', { class: 'row' }, field('브랜드', f.brand), field('모델명', f.model)), field('분류', f.category),
    h('div', { class: 'row' }, field('가격 (원)', f.price), field('가격 확인일', f.priceAt)), field('가격 본 곳', f.priceSrc),
    field('출처 주소', f.srcs), field('장점', f.pros), field('단점·한계', f.cons), field('믿을 수 있는 정도', f.trust),
    h('label', { class: 'chk' }, f.used, '내가 실제로 써본 상품이야'),
    btn('저장', 'wide', async (ev) => {
      const price = f.price.value.trim() ? L.parseNum(f.price.value) : { ok: true, value: null };
      if (!price.ok) { toast('가격은 숫자로 넣어줘'); return; }
      const urls = f.srcs.value.split('\n').map((s) => s.trim()).filter(Boolean);
      if (urls.some((u) => !L.safeUrl(u)) || (f.priceSrc.value.trim() && !L.safeUrl(f.priceSrc.value))) { toast('주소는 https://로 시작해야 해'); return; }
      const body = { name: f.name.value.trim(), brand: f.brand.value.trim(), model: f.model.value.trim(), category: f.category.value.trim(), price: price.value,
        price_checked_at: price.value != null ? f.priceAt.value || todayS() : null, price_source_url: f.priceSrc.value.trim(), source_urls: urls,
        pros: f.pros.value, cons: f.cons.value, used_by_me: f.used.checked };
      if (f.trust.value) body.trust = f.trust.value;
      if (!body.name) { toast('상품명을 넣어줘'); return; }
      if (!x && attachTo) body.attach_to = attachTo;
      const j = await run(ev.currentTarget, () => api(x ? '/products/' + x.id : '/products', { method: 'POST', body }), '저장했어');
      if (j) { closeSheet(); await load(); noteDemoted(j); }
    }),
    x ? btn('상품 지우기', 'sm danger', async (ev) => { if (!confirmBox(ev.currentTarget, '정말 지울까?')) return; const j = await run(ev.currentTarget, () => api('/products/' + x.id, { method: 'DELETE' }), '지웠어'); if (j) { closeSheet(); await load(); } }) : null);
}
function sourcesPanel(p) {
  const rows = (p.sources || []).map((s) => ({ ...s }));
  const box = det('src:' + p.id, `출처 (${rows.length})`, false);
  const list = h('div', { class: 'stack', style: 'margin-top:10px' });
  const draw = () => {
    list.replaceChildren(...rows.map((s, i) => h('div', { class: 'src' },
      h('input', { type: 'url', value: s.url || '', placeholder: 'https://', 'aria-label': '출처 주소', oninput: (e) => { s.url = e.target.value; markDirty(); } }),
      h('input', { type: 'text', value: s.title || '', placeholder: '페이지 제목', 'aria-label': '제목', oninput: (e) => { s.title = e.target.value; markDirty(); } }),
      h('input', { type: 'text', value: s.claim || '', placeholder: '이 출처로 확인한 내용', 'aria-label': '확인한 내용', oninput: (e) => { s.claim = e.target.value; markDirty(); } }),
      h('div', { class: 'split' }, h('input', { type: 'date', value: s.checked_at || '', 'aria-label': '확인일', style: 'max-width:180px', oninput: (e) => { s.checked_at = e.target.value; markDirty(); } }),
        s.url && L.safeUrl(s.url) ? h('a', { class: 'copy', href: s.url, target: '_blank', rel: 'noopener noreferrer' }, '열기 ↗') : null,
        h('button', { type: 'button', class: 'copy', onclick: () => { rows.splice(i, 1); markDirty(); draw(); } }, '빼기')))),
    h('div', { class: 'go' }, btn('+ 출처 추가', 'sm ghost', () => { rows.push({ url: '', title: '', claim: '', checked_at: todayS() }); draw(); }),
      btn('출처 저장', 'sm', (ev) => {
        const clean = rows.filter((s) => (s.url || '').trim());
        if (clean.some((s) => !L.safeUrl(s.url))) { toast('출처 주소는 https://로 시작해야 해'); return; }
        patchPost(p, { sources: clean.map((s) => ({ url: s.url.trim(), title: s.title || '', claim: s.claim || '', checked_at: s.checked_at || '' })) }, ev.currentTarget, '출처를 저장했어');
      })),
    h('p', { class: 'hint' }, '숫자·스펙·정책 같은 주장에는 공식 출처와 확인 날짜를 남겨줘.'));
  };
  draw();
  box.append(list);
  return box;
}
function settingsPanel(p) {
  const box = det('set:' + p.id, '채널·수익 모델·글 유형', false);
  let progs = (p.program_ids || []).slice();
  const ch = h('select', { value: p.channel_id || '' }, S.channels.map((c) => opt(c.id, c.name)));
  const pp = h('div');
  const drawPP = () => pp.replaceChildren(programPicker(ch.value, progs, (ids) => { progs = ids; markDirty(); drawPP(); }));
  ch.addEventListener('change', () => { markDirty(); drawPP(); });
  drawPP();
  const ct = h('select', { value: p.content_type || '' }, opt('', '정하지 않음'), Object.entries(CONTENT_TYPES).map(([k, v]) => opt(k, v.label)));
  const exp = h('textarea', { value: p.experience || '', placeholder: '직접 써본 경험 (없으면 비워둬)', oninput: markDirty });
  const cat = h('input', { type: 'text', value: p.category || '', oninput: markDirty });
  box.append(h('div', { class: 'stack', style: 'margin-top:10px' }, field('채널', ch), pp, field('글 유형', ct), field('내 실제 경험', exp), field('카테고리', cat),
    btn('저장', 'sm', (ev) => patchPost(p, { channel_id: ch.value, program_ids: progs, content_type: ct.value, experience: exp.value, category: cat.value }, ev.currentTarget, '저장했어'), { disabled: WORK.includes(p.stage) })));
  return box;
}
function publishPanel(p) {
  const box = det('pub:' + p.id, '게시 기록', LIVE.includes(p.stage));
  const pd = h('input', { type: 'date', value: p.publish_date || '', oninput: markDirty });
  const url = h('input', { type: 'url', value: p.blog_url || '', placeholder: 'https://', oninput: markDirty });
  const on = h('input', { type: 'date', value: p.published_on || '', oninput: markDirty });
  const mins = h('input', { type: 'text', inputmode: 'numeric', value: p.effort_minutes ?? '', oninput: markDirty });
  box.append(h('div', { class: 'stack', style: 'margin-top:10px' },
    h('div', { class: 'row' }, field('발행 예정일', pd), field('실제 게시일', on)), field('게시 주소', url), field('쓴 시간(분)', mins),
    btn('저장', 'sm', (ev) => {
      if (url.value.trim() && !L.safeUrl(url.value)) { toast('게시 주소는 https://로 시작해야 해'); return; }
      const m = mins.value.trim() ? Number(mins.value.replace(/[^\d]/g, '')) : null;
      patchPost(p, { publish_date: pd.value || null, blog_url: url.value.trim(), published_on: on.value || null, effort_minutes: m }, ev.currentTarget, '저장했어');
    }),
    h('p', { class: 'hint' }, "날짜를 넣는다고 게시된 걸로 바뀌지 않아. 실제로 올린 뒤 '게시 완료 기록'을 눌러줘.")));
  return box;
}
// 채널별 버전 하나를 복사할 글로 (SNS 버전은 맨 앞에 이 글의 고지문)
function variantCopy(p, k) {
  const val = (p.variants || {})[k];
  let text = '';
  if (typeof val === 'string') text = val;
  else if (Array.isArray(val)) text = val.map((x, i) => (typeof x === 'string' ? x : x.q ? `Q. ${x.q}\nA. ${x.a}` : `${i + 1}. ${x.title || ''}\n${x.text || ''}`)).join('\n\n');
  else if (val && typeof val === 'object') text = Object.entries(val).map(([kk, vv]) => `[${kk}] ${vv}`).join('\n\n');
  return SNS_VARIANTS.includes(k) ? L.withSnsDisclosure(text, p, M.prog) : text;
}
function variantsPanel(p) {
  const v = p.variants || {};
  const keys = Object.keys(VARIANT_LABEL).filter((k) => v[k] != null && v[k] !== '');
  const pend = (M.jobsBy[p.id] || []).find((j) => j.kind === 'reformat' && j.status === 'pending');
  const box = det('var:' + p.id, `채널별 버전 (${keys.length})`, keys.length > 0);
  const inner = h('div', { class: 'stack', style: 'margin-top:10px' });
  for (const k of keys) {
    const val = v[k];
    let content, text;
    if (typeof val === 'string') { text = val; content = h('p', { class: 'sns' }, val); }
    else if (Array.isArray(val)) {
      text = val.map((x, i) => (typeof x === 'string' ? x : x.q ? `Q. ${x.q}\nA. ${x.a}` : `${i + 1}. ${x.title || ''}\n${x.text || ''}`)).join('\n\n');
      content = h('div', { class: 'cards-v' }, val.map((x, i) => h('div', null, typeof x === 'string' ? x : x.q ? [h('b', null, 'Q. ' + x.q), h('br'), 'A. ' + x.a] : [h('b', null, `${i + 1}. ${x.title || ''}`), h('br'), x.text || ''])));
    } else if (typeof val === 'object') {
      text = Object.entries(val).map(([kk, vv]) => `[${kk}] ${vv}`).join('\n\n');
      content = h('div', { class: 'cards-v' }, Object.entries(val).map(([kk, vv]) => h('div', null, h('b', null, { hook: '첫 장면', script: '대본', cta: '마무리' }[kk] || kk), h('br'), String(vv))));
    }
    const copyText = variantCopy(p, k);
    void text;
    inner.append(h('div', { class: 'stack' }, h('div', { class: 'split' }, h('h3', null, VARIANT_LABEL[k]), h('button', { type: 'button', class: 'copy', onclick: (ev) => copyPlain(copyText, ev.currentTarget) }, '복사')), content));
  }
  if (pend) inner.append(h('p', { class: 'hint' }, `채널별 버전을 만드는 중이야 (다음 실행 ${nextRunText()}).`));
  else inner.append(btn('채널별 버전 만들기', 'sm ghost', () => reformatSheet(p), { disabled: (p.body || '').length < 200 }));
  inner.append(h('p', { class: 'hint' }, L.snsDisclosure(p, M.prog) ? '원고와 출처에 있는 사실만으로 만들어. 쓰레드·인스타·카드뉴스·숏폼 버전은 복사할 때 맨 앞에 이 글의 고지문이 붙어.' : '원고와 출처에 있는 사실만으로 만들어.'));
  box.append(inner);
  return box;
}
function reformatSheet(p) {
  const picks = new Set(['threads', 'instagram', 'summary', 'faq', 'titles']);
  const list = h('div', { class: 'stack' }, Object.entries(VARIANT_LABEL).filter(([k]) => k !== p.channel_id).map(([k, label]) => {
    const cb = h('input', { type: 'checkbox', checked: picks.has(k), onchange: (e) => { if (e.target.checked) picks.add(k); else picks.delete(k); } });
    return h('label', { class: 'chk' }, cb, label);
  }));
  openSheet('채널별 버전 만들기', h('p', { class: 'hint' }, `자동 작가가 다음 실행(${nextRunText()})에 만들어줘.`), list,
    btn('요청하기', 'wide', async (ev) => {
      if (!picks.size) { toast('하나 이상 골라줘'); return; }
      const j = await run(ev.currentTarget, () => api('/jobs', { method: 'POST', body: { kind: 'reformat', post_id: p.id, targets: [...picks] } }), '요청했어');
      if (j) { closeSheet(); await load(); }
    }));
}
function metricRow(m, onDelete) {
  const vals = [['조회', m.views], ['노출', m.impressions], ['클릭', m.clicks], ['구매', m.orders], ['취소', m.cancels]].filter(([, x]) => x != null).map(([k, x]) => h('span', null, k + ' ', h('b', null, L.fmtNum(x))));
  const money = [['발생', m.revenue_est], ['확정', m.revenue_confirmed], ['지급', m.revenue_paid], ['비용', m.cost]].filter(([, x]) => x != null).map(([k, x]) => h('span', null, k + ' ', h('b', null, L.won(x))));
  return h('div', { class: 'mrow' },
    h('div', { class: 'split' }, h('span', { class: 'small num' }, m.period_start === m.period_end ? m.period_start : `${m.period_start} ~ ${m.period_end}`), h('span', { class: 'chip' }, (m.source === 'manual' ? '직접 입력' : '파일') + (m.source_label ? ' · ' + m.source_label : ''))),
    h('div', { class: 'vals' }, vals, money),
    m.post_id && M.post[m.post_id] && route.tab !== 'content' ? h('span', { class: 'small muted' }, titleOf(M.post[m.post_id])) : null,
    m.link_id ? (() => { const ls = m.post_id ? linksOf(m.post_id) : []; const i = ls.findIndex((l) => l.id === m.link_id); return h('span', { class: 'small muted' }, i >= 0 ? `링크 ${i + 1}: ${ls[i].cta || '버튼 문구 없음'}` : '링크 (지워진 링크)'); })() : null,
    m.note ? h('span', { class: 'small muted' }, m.note) : null,
    onDelete && m.source === 'manual' ? h('div', { class: 'go' }, h('button', { type: 'button', class: 'copy', onclick: onDelete }, '지우기')) : null);
}
function postMetricsPanel(p) {
  const box = panel('실적');
  const list = h('div', { class: 'list' }, h('p', { class: 'hint' }, '불러오는 중…'));
  box.append(h('div', { class: 'go' }, btn('실적 입력', 'sm', () => metricSheet({ postId: p.id }))), list);
  const show = (rows) => {
    if (!rows.length) { list.replaceChildren(h('p', { class: 'hint' }, '아직 실적이 없어. 블로그 통계나 제휴사 리포트의 숫자를 넣어줘.')); return; }
    list.replaceChildren(...[channelSums(p, rows), linkSums(p, rows)].filter(Boolean), ...rows.map((m) => metricRow(m, async (ev) => {
      if (!confirmBox(ev.currentTarget, '지울까?')) return;
      const j = await run(ev.currentTarget, () => api('/metrics/' + m.id, { method: 'DELETE' }), '지웠어');
      if (j) { delete S.postMetrics[p.id]; S.stats = {}; render(true); }
    })));
  };
  if (S.postMetrics[p.id]) show(S.postMetrics[p.id]);
  else api('/metrics?post_id=' + p.id).then((j) => { S.postMetrics[p.id] = j.metrics; show(j.metrics); }).catch((e) => list.replaceChildren(h('p', { class: 'hint' }, errText(e))));
  return box;
}
// 채널별 합계 (1.4.0): 채널을 고르지 않은 줄은 메인 채널로. 채널이 하나뿐이면 안 보여줌
function channelSums(p, rows) {
  const by = new Map();
  for (const m of rows) { const k = m.channel_id || p.channel_id; (by.get(k) || by.set(k, []).get(k)).push(m); }
  if (by.size < 2) return null;
  const sumOf = (rs, f) => { const xs = rs.map((m) => m[f]).filter((x) => x != null); return xs.length ? xs.reduce((a, b) => a + Number(b), 0) : null; };
  return h('div', { class: 'mrow' }, h('b', null, '채널별 합계'),
    [...by.entries()].map(([k, rs]) => h('div', { class: 'vals' }, h('span', null, chName(k) + (k === p.channel_id ? ' (메인)' : '')),
      h('span', null, '조회 ', h('b', null, numOrDash(sumOf(rs, 'views')))), h('span', null, '클릭 ', h('b', null, numOrDash(sumOf(rs, 'clicks')))),
      h('span', null, '발생 ', h('b', null, sumOf(rs, 'revenue_est') == null ? '–' : L.won(sumOf(rs, 'revenue_est')))))));
}
// 링크별 합계: 링크를 골라서 넣은 실적만 링크별로 더함 (빈 칸은 더하지 않고 '–')
function linkSums(p, rows) {
  const links = linksOf(p.id);
  const tagged = rows.filter((m) => m.link_id);
  if (!links.length || !tagged.length) return null;
  const sumOf = (rs, f) => { const xs = rs.map((m) => m[f]).filter((x) => x != null); return xs.length ? xs.reduce((a, b) => a + Number(b), 0) : null; };
  const groups = links.map((l, i) => ({ l, i, rs: tagged.filter((m) => m.link_id === l.id) })).filter((g) => g.rs.length);
  return h('div', { class: 'mrow' },
    h('b', null, '링크별 합계'),
    groups.map((g) => h('div', { class: 'vals' },
      h('span', null, `${g.i + 1}. ${g.l.cta || '버튼 문구 없음'}`),
      h('span', null, '클릭 ', h('b', null, numOrDash(sumOf(g.rs, 'clicks')))),
      h('span', null, '구매 ', h('b', null, numOrDash(sumOf(g.rs, 'orders')))),
      h('span', null, '발생 ', h('b', null, sumOf(g.rs, 'revenue_est') == null ? '–' : L.won(sumOf(g.rs, 'revenue_est')))))),
    rows.length > tagged.length ? h('span', { class: 'small muted' }, `링크를 고르지 않고 넣은 실적 ${rows.length - tagged.length}줄은 위 합계에 안 들어가.`) : null);
}
function metricSheet({ postId, linkId } = {}) {
  const t = todayS();
  const post = h('select', { value: postId || '' }, opt('', '글 연결 안 함 (전체 수익 등)'), S.posts.filter((p) => LIVE.includes(p.stage) || p.blog_url || p.id === postId).map((p) => opt(p.id, titleOf(p))));
  // 글에 링크가 여러 개면 어느 링크의 숫자인지 고를 수 있음 (링크별 실적)
  const link = h('select', { 'aria-label': '링크' });
  const linkField = field('링크 (선택)', link, '제휴사 리포트가 링크별로 나오면 골라줘. 글 전체 숫자면 비워둬.');
  const drawLinks = () => {
    const ls = post.value ? linksOf(post.value) : [];
    link.replaceChildren(opt('', '글 전체 (링크 구분 안 함)'), ...ls.map((l, i) => opt(l.id, `${i + 1}. ${l.cta || '버튼 문구 없음'} · ${progName(l.program_id) || '수익 모델 없음'}`)));
    link.value = ls.some((l) => l.id === linkId) ? linkId : '';
    linkField.hidden = !ls.length;
  };
  post.addEventListener('change', drawLinks);
  drawLinks();
  // 1.4.0: 어느 채널 숫자인지 (다른 채널에 올린 글이면 채널별 실적을 따로 볼 수 있게). 비우면 메인 채널(링크를 고르면 링크의 채널)
  const chSel = h('select', { 'aria-label': '채널' }, opt('', '메인 채널 (링크를 고르면 링크의 채널)'), S.channels.filter((c) => c.active).map((c) => opt(c.id, c.name)));
  const chField = field('채널 (선택)', chSel, '다른 채널(쓰레드·인스타·티스토리 등)에서 본 숫자면 골라줘.');
  const start = h('input', { type: 'date', value: t }), end = h('input', { type: 'date', value: t });
  const nums = {};
  const numIn = (k, money) => (nums[k] = h('input', { type: 'text', inputmode: money ? undefined : 'numeric', placeholder: money ? '예: 1,500 (취소면 -500)' : '' }));
  const prog = h('select', null, opt('', '정하지 않음'), S.programs.map((p) => opt(p.id, p.name)));
  const label = h('input', { type: 'text', placeholder: '예: 네이버 블로그 통계, 쿠팡 파트너스 리포트' });
  const note = h('input', { type: 'text' });
  openSheet('실적 입력',
    h('p', { class: 'hint' }, '아는 숫자만 넣어줘. 빈 칸은 0이 아니라 "데이터 없음"으로 남아.'),
    field('글', post), linkField, chField, h('div', { class: 'row' }, field('시작일', start), field('종료일', end)),
    h('div', { class: 'row' }, field('조회수', numIn('views')), field('링크 클릭', numIn('clicks')), field('구매(인정) 건수', numIn('orders')), field('취소 건수', numIn('cancels')), field('노출 수', numIn('impressions'))),
    h('div', { class: 'row' }, field('발생 수익(원)', numIn('revenue_est', true)), field('확정 수익(원)', numIn('revenue_confirmed', true)), field('지급액(원)', numIn('revenue_paid', true)), field('비용(원)', numIn('cost', true))),
    h('p', { class: 'hint' }, 'AI 이미지 생성 비용은 앱이 따로 셈해. 비용 칸에 또 넣으면 두 번 더해져.'),
    field('수익 모델', prog), field('어디서 본 숫자야?', label), field('메모', note),
    btn('저장', 'wide', async (ev) => {
      const body = { period_start: start.value, period_end: end.value || start.value, post_id: post.value || undefined, link_id: (post.value && link.value) || undefined, channel_id: chSel.value || undefined, program_id: prog.value || undefined, source_label: label.value.trim(), note: note.value.trim() };
      let any = false;
      for (const [k, input] of Object.entries(nums)) {
        const r = L.parseNum(input.value);
        if (!r.ok) { toast('숫자 칸을 확인해줘'); input.focus(); return; }
        if (r.value != null && ['views', 'clicks', 'orders', 'cancels', 'impressions'].includes(k) && (r.value < 0 || !Number.isInteger(r.value))) { toast('건수는 0 이상의 정수로 넣어줘'); input.focus(); return; }
        if (r.value != null && k === 'cost' && r.value < 0) { toast('비용은 음수일 수 없어'); input.focus(); return; }
        body[k] = r.value; if (r.value != null) any = true;
      }
      if (!any) { toast('숫자를 하나 이상 넣어줘'); return; }
      if (!body.period_start) { toast('시작일을 넣어줘'); return; }
      if (body.period_end < body.period_start) { toast('종료일이 시작일보다 빨라'); return; }
      const j = await run(ev.currentTarget, () => api('/metrics', { method: 'POST', body }), '저장했어');
      if (j) { closeSheet(); S.stats = {}; S.postMetrics = {}; S.manualMetrics = null; await load(); render(true); }
    }));
}
function jobsPanel(p) {
  const jobs = (M.jobsBy[p.id] || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const box = det('jobs:' + p.id, '작업 기록·지우기', false);
  const inner = h('div', { class: 'stack', style: 'margin-top:10px' });
  inner.append(jobs.length ? h('div', { class: 'list' }, jobs.map(jobRow)) : h('p', { class: 'hint' }, '이 원고의 작업 기록이 없어 (직접 기록했거나 예전 방식으로 만든 원고).'));
  inner.append(h('p', { class: 'hint' }, `만든 날: ${L.fmtTime(p.created_at)} · 출처: ${{ auto: '자동 채우기', request: '요청', artifact: 'Claude 안 글공장', manual: '직접 기록' }[p.source] || p.source}`));
  inner.append(h('div', { class: 'go' }, btn('휴지통으로 보내기', 'sm danger', async (ev) => {
    if (!confirmBox(ev.currentTarget, '휴지통으로 보낼까?')) return;
    const j = await run(ev.currentTarget, () => api('/posts/' + p.id, { method: 'DELETE' }), '휴지통으로 보냈어 (30일 동안 되살릴 수 있어)');
    if (j) { await load(); go('content'); }
  })));
  box.append(inner);
  return box;
}
function jobRow(j) {
  const actions = [];
  if (j.status === 'pending' && (!j.started_at || Date.now() - Date.parse(j.started_at) > 30 * 60e3)) actions.push(h('button', { type: 'button', class: 'copy', onclick: async (ev) => { const r = await run(ev.currentTarget, () => api('/jobs/' + j.id, { method: 'DELETE' }), '취소했어'); if (r) await load(); } }, '취소'));
  if (j.status === 'failed' || j.status === 'cancelled') {
    actions.push(h('button', { type: 'button', class: 'copy', onclick: async (ev) => {
      const r = await run(ev.currentTarget, () => (j.kind === 'write' && j.post_id ? api('/posts/' + j.post_id + '/retry', { method: 'POST', body: {} }) : api('/jobs/' + j.id + '/retry', { method: 'POST', body: {} })), '다시 넣었어');
      if (r) await load();
    } }, '다시'));
  }
  const running = j.status === 'pending' && j.started_at && Date.now() - Date.parse(j.started_at) <= 30 * 60e3;
  return h('div', { class: 'item' },
    h('div', { class: 'main', style: 'cursor:default' }, h('b', null, `${JOB_KIND[j.kind] || j.kind} · ${j.keyword || ''}`),
      h('small', null, [L.fmtTime(j.created_at), j.attempts ? `시도 ${j.attempts}번` : '', j.note].filter(Boolean).join(' · '))),
    h('div', { class: 'side' }, h('span', { class: 'badge ' + (j.status === 'failed' ? 'g-fail' : j.status === 'done' ? 'g-live' : j.status === 'cancelled' ? '' : 'g-work') }, running ? '처리 중' : JOB_ST[j.status] || j.status), actions));
}

// ═════════ 주제 ═════════
let topicFilter = '후보';
async function requestTopics(button, body) {
  const j = await run(button, () => api('/jobs', { method: 'POST', body: { kind: 'topics', ...body } }), `주제 추천을 요청했어. 다음 실행(${nextRunText()})에 채워줘.`);
  if (j) await load();
  return j;
}
function viewTopics() {
  const box = h('div', { class: 'view' });
  const st = S.settings || {};
  const cats = String(st.auto_topics || '').split(',').map((s) => s.trim()).filter(Boolean);
  const cat = h('input', { type: 'text', list: 'tcats', value: cats[0] || '', oninput: markDirty });
  const count = h('select', { value: '6' }, opt('3', '3개'), opt('6', '6개'), opt('10', '10개'));
  const hint = h('input', { type: 'text', placeholder: '예: 자취생, 5만원 이하', oninput: markDirty });
  const pend = pendingJobs().filter((j) => j.kind === 'topics');
  box.append(panel('주제 추천 받기',
    h('div', { class: 'row' }, field('카테고리', cat), field('개수', count)), h('datalist', { id: 'tcats' }, cats.map((c) => opt(c, c))), field('추가 조건 (선택)', hint),
    h('div', { class: 'go' },
      btn('카테고리로 추천받기', 'sm', (ev) => { if (!cat.value.trim()) { toast('카테고리를 넣어줘'); return; } dirty = false; requestTopics(ev.currentTarget, { mode: 'category', category: cat.value.trim(), count: Number(count.value), hint: hint.value.trim() }); }),
      btn('실적으로 추천받기', 'sm ghost', (ev) => { dirty = false; requestTopics(ev.currentTarget, { mode: 'performance', category: cat.value.trim(), count: Number(count.value), hint: hint.value.trim() }); })),
    pend.length ? h('p', { class: 'notice' }, `추천 작업 ${pend.length}개가 기다리는 중이야 (다음 실행 ${nextRunText()}).`) : null,
    h('p', { class: 'hint' }, '검색량·경쟁도 같은 실제 숫자는 조회하지 않아. 점수는 AI 추정이나 네 실적을 근거로 한 상대 평가이고, 근거와 신뢰도를 같이 보여줘.')));
  const statuses = ['후보', '채택', '보류', '제작 요청됨', '제외'];
  const shown = S.topics.filter((t) => t.status !== '제외' || L.daysSince(t.created_at, todayS()) <= 90); // 오래된 제외 주제는 숨김
  box.append(h('div', { class: 'seg' }, statuses.map((s) => h('button', { type: 'button', 'aria-pressed': String(topicFilter === s), onclick: () => { topicFilter = s; render(true); } }, `${s} ${shown.filter((t) => t.status === s).length}`))));
  const w = st.score_weights || {};
  const list = shown.filter((t) => t.status === topicFilter).map((t) => ({ t, s: L.topicScore(t, w) })).sort((a, b) => (b.s.total ?? -1) - (a.s.total ?? -1));
  if (!list.length) box.append(h('p', { class: 'hint' }, topicFilter === '후보' ? '추천받은 주제가 아직 없어. 위에서 추천을 받아봐.' : '해당하는 주제가 없어.'));
  for (const { t, s } of list) box.append(topicCard(t, s));
  box.append(weightsPanel(w), addTopicPanel());
  return box;
}
// 점수 중 실측·내 실적·직접 입력 근거가 하나라도 있는지 (없으면 'AI 추정'으로 표시)
const realScore = L.realScore; // 계산은 lib.js (테스트 있음)
function topicCard(t, s) {
  const rec = [t.rec_channels && t.rec_channels.length ? '채널 ' + t.rec_channels.map(chName).join('·') : '', t.rec_programs && t.rec_programs.length ? '수익 ' + t.rec_programs.map(progName).join('·') : '', CONTENT_TYPES[t.rec_content_type] ? CONTENT_TYPES[t.rec_content_type].label : ''].filter(Boolean).join(' · ');
  const setSt = (st) => async (ev) => { const j = await run(ev.currentTarget, () => api('/topics/' + t.id, { method: 'POST', body: { status: st } }), `'${st}'(으)로 바꿨어`); if (j) await load(); };
  const parts = h('div', { class: 'parts' }, s.parts.map((pt) => h('div', { class: 'part' },
    h('span', null, `${pt.label} ×${pt.weight}`), h('b', { class: 'num' }, pt.score == null ? '–' : `${pt.score}/5`),
    h('span', { class: 'bar' }, h('i', { style: `width:${pt.score == null ? 0 : pt.score * 20}%` })),
    h('small', { class: 'muted', style: 'grid-column:1/-1' }, [pt.basis, pt.source, pt.confidence && '신뢰도 ' + pt.confidence].filter(Boolean).join(' · ') || '근거 없음'))));
  return h('section', { class: 'panel' },
    h('div', { class: 'split' }, h('b', null, t.title), h('span', { class: 'score' }, s.total == null ? '–' : s.total, h('small', null, realScore(s) ? ' /100' : ' /100 · AI 추정'))),
    h('p', { class: 'hint' }, [t.keyword && '키워드 ' + t.keyword, t.category].filter(Boolean).join(' · ')),
    h('p', { class: 'hint' }, `신뢰도: ${s.confidence}${realScore(s) ? ' · 일부 항목은 실적·직접 확인 근거' : ' · 검색량·경쟁도는 조회하지 않은 추정이야'}`),
    rec ? h('p', { class: 'hint' }, '추천: ' + rec) : null,
    t.basis ? h('p', { class: 'small' }, t.basis) : null,
    (() => {
      const d = det('topic:' + t.id, '점수 근거·자세히', false, '');
      d.append(h('div', { class: 'stack', style: 'margin-top:8px' },
        [['검색 의도', t.search_intent], ['대상 독자', t.audience], ['해결할 문제', t.problem], ['제휴 적합성', t.affiliate_fit], ['상품 확보', t.product_availability], ['경쟁', t.competition], ['차별화', t.differentiation], ['시즌', t.seasonality], ['더 조사할 것', t.research_needed]]
          .filter(([, v]) => v).map(([k, v]) => h('p', { class: 'small', style: 'margin:0' }, h('b', null, k + ': '), v)),
        parts, btn('점수 고치기', 'sm ghost', () => scoreSheet(t))));
      return d;
    })(),
    h('div', { class: 'go' },
      t.status !== '제작 요청됨' ? btn('이 주제로 원고 요청', 'sm', () => go('content/new/topic/' + t.id)) : null,
      t.status !== '채택' ? btn('채택', 'sm ghost', setSt('채택')) : null,
      t.status !== '보류' ? btn('보류', 'sm ghost', setSt('보류')) : null,
      t.status !== '제외' ? btn('제외', 'sm ghost', setSt('제외')) : btn('후보로', 'sm ghost', setSt('후보'))));
}
function scoreSheet(t) {
  const rows = Object.entries(SCORE_FACTORS).map(([f, label]) => {
    const cur = (t.scores && t.scores[f]) || {};
    const sc = h('select', { value: cur.score == null ? '' : String(cur.score) }, opt('', '모름'), [0, 1, 2, 3, 4, 5].map((n) => opt(String(n), String(n))));
    const basis = h('input', { type: 'text', value: cur.basis || '', placeholder: '근거' });
    return { f, label, sc, basis, cur };
  });
  openSheet('점수 고치기', h('p', { class: 'hint' }, '내가 직접 확인한 근거가 있을 때 고쳐줘. 고친 항목은 출처가 "직접 입력"으로 바뀌어.'),
    rows.map((r) => h('div', { class: 'row' }, field(r.label, r.sc), field('근거', r.basis))),
    btn('저장', 'wide', async (ev) => {
      const scores = {};
      for (const r of rows) {
        const changed = (r.sc.value === '' ? null : Number(r.sc.value)) !== (r.cur.score ?? null) || r.basis.value !== (r.cur.basis || '');
        scores[r.f] = { score: r.sc.value === '' ? null : Number(r.sc.value), basis: r.basis.value, source: changed ? '직접 입력' : (r.cur.source || 'AI 추정'), confidence: changed ? '보통' : (r.cur.confidence || '') };
      }
      const j = await run(ev.currentTarget, () => api('/topics/' + t.id, { method: 'POST', body: { scores } }), '저장했어');
      if (j) { closeSheet(); await load(); }
    }));
}
function weightsPanel(w) {
  const vals = {};
  const box = det('weights', '점수 가중치', false);
  const list = h('div', { class: 'weights', style: 'margin-top:10px' }, Object.entries(SCORE_FACTORS).map(([f, label]) => {
    const out = h('b', { class: 'num' }, String(w[f] ?? 1));
    const r = h('input', { type: 'range', min: '0', max: '5', step: '1', value: String(w[f] ?? 1), oninput: (e) => { vals[f] = Number(e.target.value); out.textContent = e.target.value; markDirty(); } });
    vals[f] = Number(w[f] ?? 1);
    return h('label', null, h('span', null, label), r, out);
  }));
  box.append(list, h('p', { class: 'hint' }, '0이면 그 항목은 점수에서 빠져. 중요하게 볼 항목을 크게 해줘.'),
    btn('가중치 저장', 'sm', async (ev) => { const j = await run(ev.currentTarget, () => api('/settings', { method: 'POST', body: { score_weights: vals } }), '저장했어'); if (j) { dirty = false; await load(); } }));
  return box;
}
function addTopicPanel() {
  const title = h('input', { type: 'text', oninput: markDirty }), kw = h('input', { type: 'text', oninput: markDirty }), cat = h('input', { type: 'text', oninput: markDirty });
  const d = det('addtopic', '+ 주제 직접 추가', false);
  d.append(h('div', { class: 'stack', style: 'margin-top:10px' },
    field('주제', title), h('div', { class: 'row' }, field('키워드', kw), field('카테고리', cat)),
    btn('추가', 'sm', async (ev) => {
      if (!title.value.trim()) { toast('주제를 넣어줘'); return; }
      const j = await run(ev.currentTarget, () => api('/topics', { method: 'POST', body: { title: title.value.trim(), keyword: kw.value.trim(), category: cat.value.trim() } }), '추가했어');
      if (j) { dirty = false; topicFilter = '후보'; await load(); }
    })));
  return d;
}

// ═════════ 수익 ═════════
let moneyRange = 'month';
const up = { name: '', rows: [], kind: '', header: 0, mapping: {}, label: '', program: '', channel: '', postId: '', defaultDate: '', result: null };
function rangeOf(k) {
  const t = todayS();
  if (k === 'month') return L.monthRange(0, t);
  if (k === 'last') return L.monthRange(-1, t);
  if (k === '30') return { from: L.addDays(t, -29), to: t };
  return { from: null, to: null };
}
function viewMoney() {
  const box = h('div', { class: 'view' });
  box.append(h('div', { class: 'seg' }, [['month', '이번 달'], ['last', '지난달'], ['30', '최근 30일'], ['all', '전체']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(moneyRange === k), onclick: () => { moneyRange = k; render(true); } }, l))));
  const sum = panel('요약', h('p', { class: 'hint' }, '불러오는 중…'));
  const imgCost = panel('이미지 생성 비용', h('p', { class: 'hint' }, '불러오는 중…'));
  const brk = panel('어디서 벌었나', h('p', { class: 'hint' }, '불러오는 중…'));
  box.append(sum, imgCost, brk);
  const rg = rangeOf(moneyRange);
  getStats(rg.from, rg.to).then((st) => {
    const tot = st.totals || {};
    sum.replaceChildren(h('h2', null, '요약'), revenueKpis(tot), trafficKpis(st), countKpis(st, rg),
      h('p', { class: 'hint' }, `실적 기록 ${tot.rows || 0}줄 · 마지막 날짜 ${tot.last_date || '없음'}${tot.sources && tot.sources.length ? ' · 출처: ' + tot.sources.join(', ') : ''}`),
      h('p', { class: 'hint' }, '발생 수익은 아직 바뀔 수 있는 숫자, 확정 수익은 제휴사가 확정한 숫자, 지급액은 실제로 들어온 돈이야. 빈 칸은 0이 아니라 데이터가 없는 거야.'),
      h('p', { class: 'hint' }, CLICK_NOTE));
    imgCost.replaceChildren(h('h2', null, '이미지 생성 비용'), ST.moneyBlock(st.image_costs, L.netProfit(tot).confirmed));
    const icOf = (k) => { const c = ST.postCost(st.image_costs, k); return c && Number(c.count) ? h('span', null, '이미지 ', h('b', null, IMG.fmtUsd(Number(c.usd))), ` (${c.billed}번)`) : null; };
    brk.replaceChildren(h('h2', null, '어디서 벌었나'), breakdown('글별', st.by_post, (k) => (M.post[k] ? titleOf(M.post[k]) : k ? '지운 글' : '글 연결 안 됨'), (k) => (k && M.post[k] ? () => go('content/post/' + k) : null), icOf),
      breakdown('채널별', st.by_channel, (k) => (k ? chName(k) : '채널 없음')), breakdown('수익 모델별', st.by_program, (k) => (k ? progName(k) : '정하지 않음')), breakdown('카테고리별', st.by_category, (k) => k || '카테고리 없음'));
  }).catch((e) => { if (e.code !== 'auth') sum.replaceChildren(h('h2', null, '요약'), h('p', { class: 'hint' }, errText(e))); });
  box.append(panel('실적 넣기',
    h('p', { class: 'hint' }, '제휴사·블로그와 자동으로 연결돼 있지 않아. 숫자를 직접 넣거나, 리포트 파일(CSV·엑셀)을 올려줘.'),
    h('div', { class: 'go' }, btn('직접 입력', 'sm', () => metricSheet({})))));
  box.append(uploadPanel());
  box.append(importsPanel(), manualListPanel());
  return box;
}
function breakdown(title, rows, labelOf, onClickOf, extraOf) {
  const list = (rows || []).slice().sort((a, b) => (L.val(b, 'revenue_est') ?? -1) - (L.val(a, 'revenue_est') ?? -1) || (L.val(b, 'clicks') ?? -1) - (L.val(a, 'clicks') ?? -1)).slice(0, 15);
  const d = det('brk:' + title, `${title} (${(rows || []).length})`, title === '글별', '');
  if (!list.length) { d.append(h('p', { class: 'hint' }, '데이터 없음')); return d; }
  d.append(h('div', { class: 'list', style: 'margin-top:8px' }, list.map((a) => {
    const click = onClickOf ? onClickOf(a.key) : null;
    const views = L.val(a, 'views'), clicks = L.val(a, 'clicks'), orders = L.val(a, 'orders');
    const ctr = L.ratio(clicks, views), conv = L.ratio(orders, clicks);
    return h('div', { class: 'mrow' },
      click ? h('button', { type: 'button', class: 'copy', style: 'align-self:flex-start', onclick: click }, labelOf(a.key)) : h('b', null, labelOf(a.key)),
      h('div', { class: 'vals' },
        h('span', null, '조회 ', h('b', null, numOrDash(views))), h('span', null, '클릭 ', h('b', null, numOrDash(clicks))),
        h('span', null, '구매 ', h('b', null, numOrDash(orders))), h('span', null, '발생 ', h('b', null, L.val(a, 'revenue_est') == null ? '–' : L.won(L.val(a, 'revenue_est')))),
        h('span', null, '확정 ', h('b', null, L.val(a, 'revenue_confirmed') == null ? '–' : L.won(L.val(a, 'revenue_confirmed')))),
        ctr != null ? h('span', null, '클릭률 ', h('b', null, L.pct(ctr))) : null,
        conv != null ? h('span', null, '전환율 ', h('b', null, L.pct(conv))) : null,
        extraOf ? extraOf(a.key) : null));
  })));
  return d;
}
let upPanel = null;
function uploadPanel() {
  upPanel = h('section', { class: 'panel' });
  drawUpload();
  return upPanel;
}
function drawUpload() {
  const box = upPanel;
  if (!box) return;
  box.replaceChildren(h('h2', null, '파일로 올리기'));
  const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.xlsx,text/csv', 'aria-label': '실적 파일' });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast('10MB보다 큰 파일은 못 올려. 기간을 나눠서 내려받아줘.'); return; }
    try {
      const t = await L.readTable(await f.arrayBuffer());
      if (!t.rows.length) { toast('파일에서 표를 찾지 못했어'); return; }
      Object.assign(up, { name: f.name, rows: t.rows, kind: t.kind, result: null, postId: '', defaultDate: '' });
      up.header = Math.max(0, t.rows.findIndex((r) => r.filter((x) => x !== '').length >= 2));
      up.mapping = L.guessMapping(t.rows[up.header] || []);
      if (!up.label) up.label = /쿠팡|coupang/i.test(f.name) ? '쿠팡 파트너스 리포트' : /토스|toss/i.test(f.name) ? '토스 쉐어링크 리포트' : f.name.replace(/\.[^.]+$/, '');
      drawUpload();
    } catch (e) {
      console.error(e);
      toast(t_readErr(f.name), 5000);
    }
  });
  box.append(h('p', { class: 'hint' }, '제휴사 리포트나 블로그 통계를 CSV나 엑셀(.xlsx)로 내려받아서 올려줘. 첫 번째 시트만 읽어.'), file);
  if (up.result) {
    const r = up.result;
    box.append(h('p', { class: 'okbox' }, `올렸어: ${r.ok}줄 저장${r.changed ? `, ${r.changed}줄은 새 숫자로 고침` : ''}, ${r.dup}줄 중복이라 건너뜀, ${r.errors}줄 오류.`));
  }
  if (!up.rows.length) return;
  const headers = up.rows[up.header] || [];
  const hdrSel = h('select', { value: String(up.header), onchange: (e) => { up.header = Number(e.target.value); up.mapping = L.guessMapping(up.rows[up.header] || []); drawUpload(); } },
    up.rows.slice(0, 15).map((r, i) => opt(String(i), `${i + 1}번째 줄: ${r.filter(Boolean).slice(0, 3).join(', ').slice(0, 40)}`)));
  const colOpts = [opt('', '없음'), ...headers.map((x, i) => opt(String(i), `${x || '(빈 칸)'} — ${i + 1}번째 칸`))];
  const map = h('div', { class: 'map' }, Object.entries(L.METRIC_FIELDS).map(([f, label]) => field(label, h('select', { value: up.mapping[f] == null ? '' : String(up.mapping[f]), onchange: (e) => { if (e.target.value === '') delete up.mapping[f]; else up.mapping[f] = Number(e.target.value); drawUpload(); } }, colOpts.map((o) => o.cloneNode(true))))));
  const label = h('input', { type: 'text', value: up.label, onchange: (e) => { up.label = e.target.value; drawUpload(); } });
  const prog = h('select', { value: up.program, onchange: (e) => { up.program = e.target.value; drawUpload(); } }, opt('', '정하지 않음'), S.programs.map((p) => opt(p.id, p.name)));
  const ch = h('select', { value: up.channel, onchange: (e) => { up.channel = e.target.value; drawUpload(); } }, opt('', '정하지 않음'), S.channels.map((c) => opt(c.id, c.name)));
  const postSel = h('select', { value: up.postId, onchange: (e) => { up.postId = e.target.value; drawUpload(); } }, opt('', '각 줄의 게시 주소·제목으로 찾기'), S.posts.filter((p) => LIVE.includes(p.stage) || p.blog_url).map((p) => opt(p.id, '모두 이 글에: ' + titleOf(p))));
  const noDate = up.mapping.date == null && up.mapping.period_start == null;
  const dd = h('input', { type: 'date', value: up.defaultDate, onchange: (e) => { up.defaultDate = e.target.value; drawUpload(); } });
  box.append(h('p', { class: 'hint' }, `${up.name} · ${up.kind === 'xlsx' ? '엑셀' : 'CSV'} · ${up.rows.length}줄`),
    field('머리줄 (열 이름이 있는 줄)', hdrSel),
    (() => { const d = det('up:map', '열 맞추기 (자동으로 맞춰봤어)', true, ''); d.append(map); return d; })(),
    h('div', { class: 'row' }, field('출처 이름', label), field('수익 모델', prog), field('채널', ch)), field('글 연결', postSel),
    noDate ? field('날짜 칸이 없어. 모든 줄의 날짜', dd) : null);
  const res = L.normalizeRows(up.rows.slice(up.header + 1), up.mapping, { source_label: up.label, program_id: up.program, channel_id: up.channel, postId: up.postId || null, defaultDate: up.defaultDate || null, resolvePost: L.makePostResolver(S.posts), firstLine: up.header + 2 });
  box.append(h('div', { class: 'kpis' }, kpi('저장할 줄', String(res.ok.length)), kpi('파일 안 중복', String(res.dupInFile)), kpi('오류 줄', String(res.errors.length)), kpi('글을 못 찾은 줄', String(res.unmatched.length))));
  if (res.errors.length) box.append(h('details', null, h('summary', null, `오류 ${res.errors.length}줄 보기`), h('ul', { class: 'checks', style: 'margin-top:8px' }, res.errors.slice(0, 30).map((e) => h('li', { class: 'e' }, `${e.line}번째 줄: ${e.msg}`)))));
  if (res.unmatched.length) box.append(h('p', { class: 'notice' }, `${res.unmatched.length}줄은 어느 글인지 못 찾았어 (${res.unmatched.slice(0, 8).join(', ')}번째 줄). 그대로 올리면 '글 연결 안 됨'으로 저장돼.`));
  box.append(h('p', { class: 'hint' }, '같은 글·같은 기간·같은 수익 모델·채널 줄이 이미 있으면 새 숫자로 바꿔 (제휴사가 숫자를 고친 리포트를 다시 올려도 두 번 세지 않아). 예전 숫자는 \'올리기 취소\'로 되돌릴 수 있어. 한 파일 안에서 같은 글·같은 날짜 줄(상품·주문별 줄)은 더해서 한 줄로 저장하고, 모든 칸이 똑같은 줄만 \'파일 안 중복\'으로 빼.'));
  if (res.ok.length) {
    box.append(h('details', null, h('summary', null, '미리보기 (처음 8줄)'), h('div', { class: 'prev', style: 'margin-top:8px' }, res.ok.slice(0, 8).map((m) => metricRow({ ...m, source: 'csv', source_label: up.label })))));
  }
  box.append(h('div', { class: 'go' },
    btn(`${res.ok.length}줄 올리기`, '', async (ev) => {
      if (!res.ok.length) { toast('올릴 줄이 없어. 열 맞추기를 확인해줘.'); return; }
      if (res.ok.length > 5000) { toast(ERR.too_many_rows); return; }
      const mapping = Object.fromEntries(Object.entries(up.mapping).map(([f, i]) => [f, headers[i] || String(i)]));
      const j = await run(ev.currentTarget, () => api('/imports', { method: 'POST', body: { filename: up.name, source_label: up.label, program_id: up.program || undefined, channel_id: up.channel || undefined, mapping, rows: res.ok, errors: res.errors.slice(0, 50), error_count: res.errors.length, dup_in_file: res.dupInFile } }));
      if (j) {
        Object.assign(up, { rows: [], name: '', result: j });
        S.stats = {}; S.postMetrics = {}; S.manualMetrics = null;
        toast(`${j.ok}줄 저장했어`); await load(); render(true);
      }
    }, { disabled: !res.ok.length }),
    btn('취소', 'ghost', () => { Object.assign(up, { rows: [], name: '', result: null }); drawUpload(); })));
}
function t_readErr(name) {
  return /\.xls$/i.test(name) ? '예전 엑셀(.xls)은 못 읽어. 엑셀에서 .xlsx나 CSV로 저장해서 올려줘.' : '파일을 읽지 못했어. CSV나 .xlsx 파일인지 확인해줘.';
}
function importsPanel() {
  const list = S.imports.filter((i) => L.daysSince(i.created_at, todayS()) <= 120);
  const box = det('imports', `올린 파일 기록 (${list.length})`, false);
  const inner = h('div', { class: 'list', style: 'margin-top:10px' });
  if (!list.length) inner.append(h('p', { class: 'hint' }, '아직 올린 파일이 없어.'));
  for (const i of list) {
    inner.append(h('div', { class: 'item' },
      h('div', { class: 'main', style: 'cursor:default' }, h('b', null, `${i.source_label || i.filename}`), h('small', null, `${L.fmtTime(i.created_at)} · 저장 ${i.rows_ok}${i.rows_changed ? ` · 고침 ${i.rows_changed}` : ''} · 중복 ${i.rows_dup} · 오류 ${i.rows_err}${i.status === '취소' ? ' · 취소함' : ''}`)),
      i.status === '완료' ? h('div', { class: 'side' }, h('button', { type: 'button', class: 'copy', onclick: async (ev) => {
        if (!confirmBox(ev.currentTarget, '이 파일로 넣은 숫자를 모두 지울까? (이 파일이 고친 줄은 예전 숫자로 돌아가)')) return;
        const j = await run(ev.currentTarget, () => api(`/imports/${i.id}/cancel`, { method: 'POST', body: {} }));
        if (j) { toast(`${j.removed}줄을 지웠어${j.restored ? `, ${j.restored}줄은 예전 숫자로 되돌렸어` : ''}`); S.stats = {}; S.postMetrics = {}; await load(); render(true); }
      } }, '올리기 취소')) : null));
  }
  box.append(inner);
  return box;
}
function manualListPanel() {
  const box = det('manual', '직접 입력한 실적', false);
  const inner = h('div', { class: 'list', style: 'margin-top:10px' }, h('p', { class: 'hint' }, '열면 불러와.'));
  const fill = () => {
    if (!box.open) return;
    const show = (rows) => inner.replaceChildren(...(rows.length ? rows.map((m) => metricRow(m, async (ev) => {
      if (!confirmBox(ev.currentTarget, '지울까?')) return;
      const j = await run(ev.currentTarget, () => api('/metrics/' + m.id, { method: 'DELETE' }), '지웠어');
      if (j) { S.manualMetrics = null; S.stats = {}; S.postMetrics = {}; render(true); }
    })) : [h('p', { class: 'hint' }, '직접 입력한 실적이 없어.')]));
    if (S.manualMetrics) show(S.manualMetrics);
    else api('/metrics?source=manual').then((j) => { S.manualMetrics = j.metrics; show(j.metrics); }).catch((e) => inner.replaceChildren(h('p', { class: 'hint' }, errText(e))));
  };
  box.addEventListener('toggle', fill);
  box.append(inner);
  fill();
  return box;
}

// ═════════ 설정 ═════════
function viewSettings() {
  const box = h('div', { class: 'view' });
  const sec = route.parts[0] || '';
  const sections = [
    ['auto', '자동 글쓰기', secAuto], ['images', '이미지 (AI·사진·비용 한도)', () => ST.settingsSection()], ['jobs', '작업 기록', secJobs], ['programs', '수익 모델', secPrograms], ['channels', '게시 채널', secChannels],
    ['compat', '수익 모델 × 채널 조합표', secCompat], ['products', '상품 목록', secProducts], ['devices', '기기·접속 코드', secDevices],
    ['backup', '백업·복구', secBackup], ['trash', '휴지통', secTrash], ['guide', '사용 방법', secGuide], ['about', '앱 정보', secAbout],
  ];
  for (const [id, title, fn] of sections) {
    if (sec === id) openState['sec:' + id] = true;
    const d = det('sec:' + id, h('b', null, title), !sec && id === 'auto');
    d.id = 'sec-' + id;
    let built = false;
    const build = () => { if (built) return; built = true; try { d.append(h('div', { class: 'stack', style: 'margin-top:10px' }, fn())); } catch (e) { console.error(e); d.append(h('p', { class: 'err' }, '이 부분을 그리지 못했어.')); } };
    if (d.open) build();
    d.addEventListener('toggle', () => { if (d.open) build(); });
    box.append(d);
  }
  if (sec) setTimeout(() => { const el = document.getElementById('sec-' + sec); if (el) el.scrollIntoView({ block: 'start' }); }, 0);
  return box;
}
function secAuto() {
  const s = S.settings || {};
  let progs = (s.default_programs || []).slice();
  const auto = h('input', { type: 'checkbox', checked: s.auto_enabled !== false, onchange: markDirty });
  const topics = h('textarea', { value: s.auto_topics || '', style: 'min-height:64px', oninput: markDirty });
  const focus = h('input', { type: 'text', value: s.focus_topic || '', maxlength: '60', list: 'focuslist', placeholder: '예: 계절템·겨울 가전', oninput: markDirty });
  const fterms = h('input', { type: 'text', value: s.focus_terms || '', maxlength: '300', placeholder: '예: 전기요, 온수매트, 히터, 가습기, 결로', oninput: markDirty });
  const perHint = h('span', { class: 'hint' });
  const drawPer = () => { const n = Number(per.value) || 1; perHint.textContent = n === 1 ? '앱 권장 기준(하루 1편)이야. 사람이 손본 글을 꾸준히 올리는 쪽을 권해.' : `하루 ${n}편으로 골랐어 — 앱 권장(하루 1편)보다 많지만 네가 고른 값이라 그대로 둬. 자동 작가는 7일치 ${n * 7}편을 목표로 채워.`; };
  const per = h('select', { value: String(s.per_day || 1), onchange: () => { markDirty(); drawPer(); } }, opt('1', '하루 1개'), opt('2', '하루 2개'), opt('3', '하루 3개'));
  drawPer();
  const len = h('select', { value: String(s.len || '2500'), onchange: markDirty }, opt('1500', '보통 (1,500자)'), opt('2500', '길게 (2,500자)'), opt('3500', '아주 길게 (3,500자)'));
  // 1.4.0: 검수·게시 안 한 원고가 이만큼 쌓이면 자동 작가가 새 자동 글을 멈춤 (0 = 하루 발행 수 × 7)
  const blHint = h('span', { class: 'hint' });
  const blim = h('select', { value: String(s.backlog_limit || 0), onchange: () => { markDirty(); drawBl(); } }, opt('0', '자동 (하루 발행 수 × 7)'), ...[3, 5, 7, 10, 14, 21, 30, 60].map((n) => opt(String(n), `${n}개`)));
  const drawBl = () => { const own = Number(blim.value) || 0; const lim = own || (Number(per.value) || 1) * 7; const b = L.backlogInfo(S.posts, { per_day: Number(per.value) || 1, backlog_limit: own }, todayS()); blHint.textContent = `검수·게시 안 한 원고가 ${lim}개 쌓이면 자동 작가가 새 자동 글을 멈춰 (앱에서 요청한 원고는 계속 써). 지금 ${b.backlog}개${b.full ? ' — 한도가 차서 멈춘 상태야' : ''}.`; };
  per.addEventListener('change', () => drawBl());
  drawBl();
  const ch = h('select', { value: s.default_channel || 'naver_blog' }, S.channels.map((c) => opt(c.id, c.name)));
  const pp = h('div');
  const drawPP = () => pp.replaceChildren(programPicker(ch.value, progs, (ids) => { progs = ids; markDirty(); drawPP(); }));
  ch.addEventListener('change', () => { markDirty(); progs = progs.filter((id) => compatOf(id, ch.value, S.compat).verdict !== '불가'); drawPP(); });
  drawPP();
  return [
    h('label', { class: 'chk' }, auto, '발행표가 비면 자동 주제로 채우기'),
    field('자동 주제 카테고리 (쉼표로 구분)', topics),
    field('주력 주제 (블로그의 큰 주제 하나)', focus, '정해 두면 자동 작가가 이 주제 안에서만 자동 글을 쓰고, 검사에서 글마다 주제와 맞는지 근거를 보여줘. 비우면 안 씀.'),
    field('주력 주제 낱말 (선택, 쉼표로)', fterms, "글의 키워드나 제목에 이 낱말 중 하나가 있으면 주력 주제 글로 봐. 안 적으면 주력 주제 이름 전체나 그 낱말 두 개 이상이 있어야 해 ('겨울'처럼 하나만 있으면 넓은 낱말일 수 있어서 '판단 어려움'). 카테고리만 같으면 주제 글로 보지 않아."),
    h('datalist', { id: 'focuslist' }, String(s.auto_topics || '').split(',').map((x) => x.trim()).filter(Boolean).map((c) => opt(c, c))),
    h('div', { class: 'row' }, field('하루 발행 개수', per), field('기본 길이', len)), perHint,
    field('쌓아둘 원고 한도', blim), blHint,
    field('기본 채널', ch), h('p', { class: 'legend' }, '기본 수익 모델'), pp,
    btn('저장', 'sm', async (ev) => {
      const j = await run(ev.currentTarget, () => api('/settings', { method: 'POST', body: { auto_enabled: auto.checked, auto_topics: topics.value.trim(), focus_topic: focus.value.trim(), focus_terms: fterms.value.trim(), per_day: Number(per.value), backlog_limit: Number(blim.value) || 0, len: len.value, default_channel: ch.value, default_programs: progs } }), '저장했어');
      if (j) {
        dirty = false;
        const sk = (j.skipped || []).map((k) => ({ focus_terms: '주력 주제 낱말은 DB 업데이트(015)', backlog_limit: '쌓아둘 원고 한도는 DB 업데이트(016)' }[k])).filter(Boolean);
        if (sk.length) toast(`나머지는 저장했어. ${sk.join(', ')} 뒤에 저장돼.`, 5000);
        await load();
      }
    }),
    h('p', { class: 'hint' }, `자동 작가는 하루 세 번(오전 8:51, 오후 12:51, 오후 6:51쯤) 네 Claude 구독으로 실행돼. 다음 실행 ${nextRunText()}. 요청한 원고·주제·변환을 먼저 하고, 앞으로 7일 발행표가 비어 있으면 자동 주제로 채워 (주력 주제를 정하면 그 안에서만). 자동 작가가 쓴 원고는 항상 '검수 필요'로 들어와.`),
  ];
}
function secJobs() {
  const t = todayS();
  const jobs = S.jobs.filter((j) => j.status === 'pending' || L.daysSince(j.created_at, t) <= 14);
  const runs = S.runs.slice(0, 10);
  return [
    h('h3', null, '작업'), jobs.length ? h('div', { class: 'list' }, jobs.map(jobRow)) : h('p', { class: 'hint' }, '최근 2주 작업이 없어.'),
    h('h3', null, '자동 작가 실행 기록'),
    runs.length ? h('div', { class: 'list' }, runs.map((r) => h('div', { class: 'item' }, h('div', { class: 'main', style: 'cursor:default' }, h('b', null, `${L.fmtTime(r.ran_at)} · ${r.status}`), h('small', null, [r.note || `${r.written}개 저장`, r.error].filter(Boolean).join(' · ')))))) : h('p', { class: 'hint' }, '실행 기록이 없어.'),
    h('p', { class: 'hint' }, "실패한 작업은 '다시'를 누르면 다음 실행에 다시 처리해. 세 번 실패하면 자동으로 멈춰."),
  ];
}
function secPrograms() {
  const out = [];
  for (const p of S.programs) {
    const myst = h('select', { value: p.my_status, onchange: async (e) => { const j = await run(null, () => api('/programs/' + p.id, { method: 'POST', body: { my_status: e.target.value } }), '저장했어'); if (j) await load(); } },
      ['사용 중', '가입 대기', '미가입', '확인 필요'].map((x) => opt(x, x)));
    out.push(h('div', { class: 'prod' },
      h('div', { class: 'split' }, h('b', null, p.name), h('span', { class: 'chip' }, KIND_LABEL[p.kind] || p.kind)),
      h('div', { class: 'row' }, field('내 상태', myst)),
      h('span', { class: 'hint' }, `가입 ${p.needs_signup} · 고지 ${p.needs_disclosure} · 링크 ${p.needs_link ? '필요' : '없음'}`),
      (() => {
        const by = { '가능': [], '불가': [], '확인 필요': [] };
        for (const c of S.channels.filter((x) => x.active)) (by[compatOf(p.id, c.id, S.compat).verdict] || by['확인 필요']).push(c.name);
        return h('span', { class: 'hint' }, [by['가능'].length && '쓸 수 있는 채널: ' + by['가능'].join(', '), by['불가'].length && '못 쓰는 채널: ' + by['불가'].join(', '), by['확인 필요'].length && '확인 필요: ' + by['확인 필요'].join(', ')].filter(Boolean).join(' · '));
      })(),
      p.disclosure_template ? h('p', { class: 'sns' }, p.disclosure_template) : h('p', { class: p.needs_disclosure === '필요' ? 'badbox' : 'hint' }, p.needs_disclosure === '필요' ? '고지문이 비어 있어. 공식 문구를 넣어야 발행 준비 완료로 바꿀 수 있어.' : '고지문 없음'),
      p.disclosure_where ? h('span', { class: 'hint' }, '위치: ' + p.disclosure_where) : null,
      p.data_source ? h('span', { class: 'hint' }, '실적 보는 곳: ' + p.data_source) : null,
      p.commission_note ? h('span', { class: 'hint' }, p.commission_note) : null,
      p.unverified ? h('p', { class: 'notice' }, '확인 필요: ' + p.unverified) : null,
      h('div', { class: 'go' }, p.policy_url ? h('a', { class: 'copy', href: p.policy_url, target: '_blank', rel: 'noopener noreferrer' }, `근거 보기 ↗ (${p.policy_checked_at || '확인일 없음'})`) : null, btn('고치기', 'sm ghost', () => programSheet(p)))));
  }
  out.push(btn('+ 수익 모델 추가', 'sm ghost', () => programSheet(null)));
  out.push(h('p', { class: 'hint' }, '수수료율은 바뀌고 확인이 필요해서 앱에 넣지 않았어. 정책을 확인했으면 근거 주소와 날짜를 같이 고쳐줘.'));
  return out;
}
function programSheet(p) {
  const v = p || {};
  const f = {
    name: h('input', { type: 'text', value: v.name || '' }),
    kind: h('select', { value: v.kind || 'other', disabled: !!p }, Object.entries(KIND_LABEL).map(([k, l]) => opt(k, l))),
    signup: h('select', { value: v.needs_signup || '확인 필요' }, ['필요', '불필요', '확인 필요'].map((x) => opt(x, x))),
    disc: h('select', { value: v.needs_disclosure || '확인 필요' }, ['필요', '불필요', '확인 필요'].map((x) => opt(x, x))),
    link: h('input', { type: 'checkbox', checked: !!v.needs_link }),
    tpl: h('textarea', { value: v.disclosure_template || '' }), where: h('input', { type: 'text', value: v.disclosure_where || '' }),
    data: h('textarea', { value: v.data_source || '' }), note: h('textarea', { value: v.commission_note || '' }), unv: h('textarea', { value: v.unverified || '' }),
    url: h('input', { type: 'url', value: v.policy_url || '' }), at: h('input', { type: 'date', value: v.policy_checked_at || '' }),
    active: h('input', { type: 'checkbox', checked: v.active !== false }),
  };
  openSheet(p ? p.name + ' 고치기' : '수익 모델 추가', field('이름', f.name), field('종류', f.kind), h('div', { class: 'row' }, field('가입', f.signup), field('고지', f.disc)),
    h('label', { class: 'chk' }, f.link, '제휴 링크를 넣어야 수익이 생김'),
    field('고지문 (복사할 때 글 맨 위에 붙음)', f.tpl, '"받을 수 있음"처럼 애매하게 말고 수수료를 받는다는 사실을 분명하게.'),
    field('고지 위치', f.where), field('실적 보는 곳', f.data), field('정산·조건 메모', f.note), field('아직 확인 못 한 것', f.unv),
    h('div', { class: 'row' }, field('근거 주소', f.url), field('확인일', f.at)), p ? h('label', { class: 'chk' }, f.active, '사용 (끄면 새 원고에서 안 보임)') : null,
    btn('저장', 'wide', async (ev) => {
      if (!f.name.value.trim()) { toast('이름을 넣어줘'); return; }
      if (f.url.value.trim() && !L.safeUrl(f.url.value)) { toast('주소는 https://로 시작해야 해'); return; }
      if (VAGUE_DISCLOSURE.test(f.tpl.value)) { toast("고지문을 '…수수료를 제공받습니다'처럼 분명하게 써줘. '받을 수 있음'은 공정위가 애매한 표현으로 봐.", 5000); f.tpl.focus(); return; }
      const body = { name: f.name.value.trim(), needs_signup: f.signup.value, needs_disclosure: f.disc.value, needs_link: f.link.checked, disclosure_template: f.tpl.value.trim(), disclosure_where: f.where.value.trim(),
        data_source: f.data.value.trim(), commission_note: f.note.value.trim(), unverified: f.unv.value.trim(), policy_url: f.url.value.trim(), policy_checked_at: f.at.value || null };
      if (p) body.active = f.active.checked; else body.kind = f.kind.value;
      const j = await run(ev.currentTarget, () => api(p ? '/programs/' + p.id : '/programs', { method: 'POST', body }), '저장했어');
      if (j) { closeSheet(); await load(); noteDemoted(j); }
    }));
}
function secChannels() {
  const out = S.channels.map((c) => h('div', { class: 'prod' },
    h('div', { class: 'split' }, h('b', null, c.name), h('span', { class: 'chip' }, CH_KIND[c.kind] || c.kind)),
    h('span', { class: 'hint' }, `글자 수 제한 ${c.max_chars ? L.fmtNum(c.max_chars) + '자' : '없음'} · 본문 링크 ${c.clickable_links ? '눌림' : '안 눌림'}${c.active ? '' : ' · 사용 안 함'}`),
    c.notes ? h('span', { class: 'hint' }, c.notes) : null,
    h('div', { class: 'go' }, c.source_url ? h('a', { class: 'copy', href: c.source_url, target: '_blank', rel: 'noopener noreferrer' }, `근거 보기 ↗ (${c.checked_at || '확인일 없음'})`) : null, btn('고치기', 'sm ghost', () => channelSheet(c)))));
  out.push(btn('+ 채널 추가', 'sm ghost', () => channelSheet(null)));
  out.push(h('p', { class: 'hint' }, '네이버 블로그·티스토리는 글쓰기 API가 없어서 앱이 대신 올리지 않아. 복사해서 붙여넣는 방식이야.'));
  return out;
}
function channelSheet(c) {
  const v = c || {};
  const f = { name: h('input', { type: 'text', value: v.name || '' }), kind: h('select', { value: v.kind || 'blog', disabled: !!c }, Object.entries(CH_KIND).map(([k, l]) => opt(k, l))),
    max: h('input', { type: 'text', inputmode: 'numeric', value: v.max_chars ?? '' }), links: h('input', { type: 'checkbox', checked: v.clickable_links !== false }),
    html: h('input', { type: 'checkbox', checked: !!v.html_paste }), notes: h('textarea', { value: v.notes || '' }), active: h('input', { type: 'checkbox', checked: v.active !== false }) };
  openSheet(c ? c.name + ' 고치기' : '채널 추가', field('이름', f.name), field('종류', f.kind), field('글자 수 제한 (없으면 비워둬)', f.max),
    h('label', { class: 'chk' }, f.links, '본문 링크가 눌림'), h('label', { class: 'chk' }, f.html, '서식(HTML) 붙여넣기 가능'), field('메모', f.notes),
    c ? h('label', { class: 'chk' }, f.active, '사용') : null,
    btn('저장', 'wide', async (ev) => {
      if (!f.name.value.trim()) { toast('이름을 넣어줘'); return; }
      const max = f.max.value.trim() ? Number(f.max.value.replace(/[^\d]/g, '')) : null;
      const body = { name: f.name.value.trim(), max_chars: max, clickable_links: f.links.checked, html_paste: f.html.checked, notes: f.notes.value.trim() };
      if (c) body.active = f.active.checked; else body.kind = f.kind.value;
      const j = await run(ev.currentTarget, () => api(c ? '/channels/' + c.id : '/channels', { method: 'POST', body }), '저장했어');
      if (j) { closeSheet(); await load(); noteDemoted(j); }
    }));
}
function secCompat() {
  const out = [h('p', { class: 'hint' }, '칸을 누르면 판정·이유·근거를 고칠 수 있어. 불가로 바꾸면 그 조합은 원고 요청과 발행 준비 완료가 막혀.')];
  for (const c of S.channels) {
    out.push(h('h3', null, c.name));
    out.push(h('div', { class: 'list' }, S.programs.map((p) => {
      const v = compatOf(p.id, c.id, S.compat);
      return h('div', { class: 'item' },
        h('button', { type: 'button', class: 'main', onclick: () => compatSheet(p, c, v) }, h('b', null, p.name), h('small', null, [v.reason, v.checked_at && '확인 ' + v.checked_at].filter(Boolean).join(' · ') || '아직 확인 안 함')),
        h('span', { class: 'badge ' + verdictClass(v.verdict) }, v.verdict));
    })));
  }
  return out;
}
function compatSheet(p, c, v) {
  const verdict = h('select', { value: v.verdict }, ['가능', '불가', '확인 필요'].map((x) => opt(x, x)));
  const reason = h('textarea', { value: v.reason || '' });
  const url = h('input', { type: 'url', value: v.source_url || '' });
  const at = h('input', { type: 'date', value: todayS() });
  openSheet(`${p.name} × ${c.name}`, field('판정', verdict), field('이유', reason), field('근거 주소', url), field('확인일', at),
    v.source_url ? h('a', { class: 'copy', href: v.source_url, target: '_blank', rel: 'noopener noreferrer' }, '지금 근거 열기 ↗') : null,
    btn('저장', 'wide', async (ev) => {
      if (url.value.trim() && !L.safeUrl(url.value)) { toast('주소는 https://로 시작해야 해'); return; }
      const j = await run(ev.currentTarget, () => api('/compat', { method: 'POST', body: { program_id: p.id, channel_id: c.id, verdict: verdict.value, reason: reason.value.trim(), source_url: url.value.trim(), checked_at: at.value || todayS() } }), '저장했어');
      if (j) { closeSheet(); await load(); noteDemoted(j); }
    }));
}
function secProducts() {
  const used = new Set(S.post_products.map((x) => x.product_id));
  const out = S.products.map((x) => productCard(x, [btn('고치기', 'sm ghost', () => productSheet(x)), used.has(x.id) ? h('span', { class: 'hint' }, '원고에 연결됨') : null]));
  if (!S.products.length) out.push(h('p', { class: 'hint' }, '저장된 상품이 없어. 원고에서 상품을 추가하거나 자동 작가가 조사한 상품이 여기에 쌓여.'));
  out.push(btn('+ 새 상품', 'sm ghost', () => productSheet(null)));
  return out;
}
function secDevices() {
  const list = h('div', { class: 'list' }, h('p', { class: 'hint' }, '불러오는 중…'));
  const draw = () => api('/sessions').then((j) => list.replaceChildren(...j.sessions.map((s) => h('div', { class: 'item' },
    h('div', { class: 'main', style: 'cursor:default' }, h('b', null, s.label + (s.current ? ' (지금 이 기기)' : '')), h('small', null, `마지막 사용 ${L.fmtTime(s.last_used_at || s.created_at)}`)),
    h('div', { class: 'side' }, h('button', { type: 'button', class: 'copy', onclick: async (ev) => {
      if (!confirmBox(ev.currentTarget, '로그아웃시킬까?')) return;
      const r = await run(ev.currentTarget, () => api(`/sessions/${s.id}/revoke`, { method: 'POST', body: {} }), '로그아웃시켰어');
      if (r && r.self) authLost('이 기기에서 로그아웃했어.'); else if (r) draw();
    } }, '로그아웃')))))).catch((e) => list.replaceChildren(h('p', { class: 'hint' }, errText(e))));
  draw();
  const revokeOthers = h('input', { type: 'checkbox', checked: true });
  return [
    h('p', { class: 'hint' }, '로그인한 기기 목록이야. 모르는 기기가 있으면 로그아웃시키고 접속 코드를 바꿔줘.'), list,
    h('div', { class: 'go' }, btn('이 기기에서 로그아웃', 'sm ghost', async (ev) => { const r = await run(ev.currentTarget, () => api('/logout', { method: 'POST', body: {} })); if (r) authLost('로그아웃했어. 다시 열려면 접속 코드를 넣어줘.'); })),
    h('h3', null, '접속 코드 바꾸기'),
    h('p', { class: 'hint' }, '예전 링크(주소에 ?k=가 붙은 것)에는 접속 코드가 그대로 들어 있어. 그 링크를 어디에 보낸 적이 있다면 바꾸는 게 안전해. 바꾸면 예전 코드와 예전 링크는 더 이상 안 돼.'),
    h('label', { class: 'chk' }, revokeOthers, '다른 기기도 모두 로그아웃시키기'),
    btn('새 접속 코드 만들기', 'sm danger', async (ev) => {
      if (!confirmBox(ev.currentTarget, '정말 바꿀까?')) return;
      const r = await run(ev.currentTarget, () => api('/code/rotate', { method: 'POST', body: { revoke_others: revokeOthers.checked } }));
      if (!r) return;
      const code = h('input', { type: 'text', value: r.code, readonly: true });
      openSheet('새 접속 코드', h('p', { class: 'badbox' }, '이 창을 닫으면 다시 볼 수 없어. 지금 메모장이나 비밀번호 관리자에 저장해줘.'), code,
        h('div', { class: 'go' }, btn('복사', 'sm', (e2) => copyPlain(r.code, e2.currentTarget))),
        h('p', { class: 'hint' }, r.revoked ? `다른 기기 ${r.revoked}대를 로그아웃시켰어.` : '다른 기기는 그대로 로그인돼 있어.'));
    }),
  ];
}
function secBackup() {
  return [
    h('p', { class: 'hint' }, '원고·주제·상품·링크·실적·설정·이미지 정보(출처·프롬프트·비용·연결)를 파일 하나(JSON)로 받아. 접속 코드와 기기 정보는 들어가지 않아. 이미지 파일 자체는 안 들어가니 필요한 이미지는 보관함에서 내려받아 둬.'),
    btn('전체 백업 받기', 'sm', async (ev) => {
      const j = await run(ev.currentTarget, () => api('/export'));
      if (!j) return;
      const blob = new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `글공장-백업-${todayS()}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('백업 파일을 만들었어');
    }),
    h('p', { class: 'hint' }, '복구는 앱 안에서 바로 하지 않아 (잘못 덮어쓰면 위험해서). 백업 파일을 Claude에게 주고 "이 백업으로 되돌려줘"라고 하면, 서버에 있는 자동 백업 표와 함께 확인하면서 되돌릴 수 있어. 자세한 방법은 저장소의 docs/backup-restore.md에 있어.'),
  ];
}
function secTrash() {
  if (!S.trash.length) return [h('p', { class: 'hint' }, '휴지통이 비어 있어. 지운 원고는 30일 동안 여기에 있어.')];
  return [h('div', { class: 'list' }, S.trash.map((p) => h('div', { class: 'item' },
    h('div', { class: 'main', style: 'cursor:default' }, h('b', null, titleOf(p)), h('small', null, '지운 날 ' + L.fmtTime(p.deleted_at))),
    h('div', { class: 'side' }, h('button', { type: 'button', class: 'copy', onclick: async (ev) => { const r = await run(ev.currentTarget, () => api(`/posts/${p.id}/restore`, { method: 'POST', body: {} }), '되살렸어'); if (r) await load(); } }, '되살리기')))))];
}
function secGuide() {
  const g = (title, ...kids) => h('div', { class: 'gsec' }, h('h3', null, title), ...kids);
  return [
    g('하루 루틴',
      h('ol', null, h('li', null, "홈에서 '오늘 할 일' 확인"), h('li', null, "검수할 원고 열기 → 빨간색(고칠 것) 고치기, ✏️ 내 경험 채우기"), h('li', null, '제휴 링크 넣고 한 번 열어서 확인'),
        h('li', null, "'발행 준비 완료로' → '서식 그대로 복사' → 블로그에 붙여넣고 사진 넣기"), h('li', null, "올린 뒤 '게시 완료 기록'에 글 주소 넣기"), h('li', null, '며칠 뒤 수익 탭에서 실적 넣기'))),
    g('원고는 어떻게 채워져?', h('p', null, '네 Claude 구독으로 하루 세 번 자동 작가가 실행돼. 요청한 원고·주제 추천·채널별 버전을 먼저 처리하고, 앞으로 7일 발행표가 비어 있으면 자동 주제로 채워. 추가 비용은 없어. 원고는 항상 "검수 필요"로 들어오고, 앱이 대신 게시하지 않아.')),
    g('상태 뜻', h('ul', null, Object.entries(STAGES).map(([k, v]) => h('li', null, h('b', null, v.label), ' — ', {
      queued: '자동 작가를 기다리는 중', researching: '자료를 찾는 중', writing: '쓰는 중', verify: '정보가 부족해서 네가 더 넣어야 함', review: '네가 읽고 고칠 차례', ready: '검사 통과, 올릴 준비 끝',
      scheduled: '올릴 날짜를 정해둠 (자동 게시 아님)', published: '네가 직접 올렸고 주소를 기록함', collecting: '실적을 넣는 중', analyzed: '실적 정리 끝', failed: '작업이 실패함 — 다시 요청 가능',
    }[k] || '')))),
    g('지켜야 할 것', h('ul', null,
      h('li', null, '고지문은 글 맨 위 (복사하면 자동으로 붙어). 제휴 수수료도 공정위 지침상 표시 대상이야.'),
      h('li', null, "쓰레드·인스타로 복사할 때도 고지문이 맨 앞에 붙어. '#광고'나 '제휴'만 쓰는 건 부족해 (더보기 뒤에 숨기지 마)."),
      h('li', null, '쿠팡은 파트너스 사이트에서 만든 링크만 수익이 잡혀. 쿠팡 상품 주소를 그대로 복사하면 안 잡혀.'),
      h('li', null, '안 써본 걸 써본 척 금지 — 경험 칸은 진짜 경험만.'),
      h('li', null, '가격은 자주 바뀌어. 본문에 정확한 가격을 쓰려면 7일 안에 확인한 가격을 상품에 넣어둬.'),
      h('li', null, '제휴 링크는 받은 그대로. 줄이거나 다른 주소로 돌리지 마 (제휴사 규정 위반이 될 수 있어).'),
      h('li', null, '내가 산 건 수익으로 인정 안 될 수 있어 (토스 쉐어링크는 본인·지인 구매 불인정).'))),
    g('이미지 넣기',
      h('ol', null, h('li', null, "원고 아래 '이미지'에서 사진 자리마다 AI로 만들기·실제 사진 찾기(Pexels)·파일 올리기·보관함에서 고르기 중 하나 (파일을 올릴 때는 '이 사진은 어디서 났어?'에서 출처를 골라줘 — 직접 찍은 사진으로 셀지 정해져)"),
        h('li', null, "미리보기에서 자를 곳을 맞추고 '사용 가능'으로 검수"), h('li', null, "'모두 내려받기' → '서식 그대로 복사'로 붙여넣은 뒤, 적힌 파일 이름대로 사진을 넣기"),
        h('li', null, "블로그에 넣었으면 '사용 완료' 표시")),
      h('p', null, 'AI 이미지는 일반 상황 삽화·배경용이야. 실제 상품 모습은 공식 이미지나 직접 찍은 사진으로. 이미지 안 글자는 카드뉴스에서 앱이 직접 그려. AI 이미지 키·한도는 설정 > 이미지.')),
    g('실적 넣기', h('p', null, '제휴사·블로그와 자동 연결은 없어. 쿠팡 파트너스·토스 쉐어링크·블로그 통계에서 숫자를 보고 직접 넣거나, 리포트를 CSV·엑셀로 내려받아 수익 탭에서 올려줘. 같은 파일을 두 번 올려도 중복은 건너뛰어.')),
  ];
}
function secAbout() {
  return [
    h('p', { class: 'hint' }, `앱 버전 ${APP_VER} · 서버 버전 ${S.serverVersion || '확인 안 됨'}`),
    h('div', { class: 'go' }, btn('업데이트 확인', 'sm ghost', () => checkUpdate(true)), h('a', { class: 'btn sm ghost', href: ARTIFACT_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Claude 안 글공장 ↗')),
    h('p', { class: 'hint' }, '이 앱의 원고·실적은 네 Supabase 프로젝트에만 저장돼. 이 기기에는 로그인 정보와 화면을 빨리 띄우기 위한 사본만 남아.'),
    btn('이 기기에 남은 사본 지우기', 'sm ghost', () => { LS.del('gf-cache2'); toast('지웠어. 다음에 열 때 서버에서 다시 불러와.'); }),
  ];
}

// ───────── 자동 업데이트 ─────────
let lastUpdCheck = 0;
async function checkUpdate(force) {
  if (!force && Date.now() - lastUpdCheck < 5 * 60e3) return;
  lastUpdCheck = Date.now();
  try {
    const r = await fetch('version.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json();
    if (!v.version || v.version === APP_VER) { if (force) toast('최신 버전이야'); return; }
    const tried = LS.get('gf-upd-try', null);
    if (!force && tried && tried.v === v.version && Date.now() - tried.at < 10 * 60e3) return;
    if (!force && editing()) return;
    LS.set('gf-upd-try', { v: v.version, at: Date.now() });
    LS.set('gf-upd-notes', String(v.notes || ''));
    const u = new URL(location.href); u.searchParams.set('v', v.version);
    location.replace(u.toString());
  } catch { /* 오프라인 */ }
}
$('#updOk').addEventListener('click', () => { $('#upd').hidden = true; });
function showUpdateNote() {
  const seen = LS.get('gf-seen-ver', null);
  if (seen && seen !== APP_VER) {
    const notes = LS.get('gf-upd-notes', '');
    $('#updText').textContent = `새 버전(${APP_VER})으로 바뀌었어.` + (notes ? ' ' + notes : '');
    $('#upd').hidden = false;
  }
  LS.set('gf-seen-ver', APP_VER);
}

// ───────── 시작 ─────────
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !session) return;
  checkUpdate(false);
  if (Date.now() - lastLoad > 30e3) load();
});
setInterval(() => { if (document.visibilityState === 'visible' && session && Date.now() - lastLoad > 60e3 && !editing()) load(); }, 20e3);

function startApp() {
  $('#gate').hidden = true; $('#app').hidden = false; $('#tabbar').hidden = false;
  route = parseHash();
  loadCache();
  render(true);
  load();
}
(async function boot() {
  // 예전 링크(?k=코드)로 열었으면 주소에서 코드를 바로 지우고, 그 코드로 이 기기만 로그인
  const qs = new URLSearchParams(location.search);
  const k = qs.get('k');
  if (k) {
    qs.delete('k');
    history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash);
  }
  showUpdateNote();
  const legacy = LS.get('gf-token', '');
  if (session) { if (legacy) LS.del('gf-token'); startApp(); checkUpdate(false); return; }
  const code = k || legacy;
  if (code) {
    try { await login(code); startApp(); checkUpdate(false); return; } catch (e) {
      LS.del('gf-token');
      showGate(e.code === 'rate_limited' ? ERR.rate_limited : e.code === 'network' ? ERR.network : '저장된 접속 코드가 맞지 않아. 코드를 다시 넣어줘.');
      return;
    }
  }
  showGate();
})();
