// studio.js — 이미지 스튜디오 화면 (원고 상세의 '이미지' 칸, 만들기·찾기·올리기·고르기, 미리보기·자르기·내려받기, 카드뉴스, 보관함, 설정, 이미지 비용)
// OpenAI·Pexels 키는 서버(Supabase Secrets)에만 있음. 이 화면은 서버가 알려주는 '키 있음/없음'만 보고, 이미지는 1시간짜리 서명 주소로만 봄.
// 앱은 블로그에 사진을 대신 올리지 않음 — 사용자가 내려받아서 직접 넣음.
import * as IMG from './images.js?v=1.2.0';
import { renderSlide, ensureFonts, canvasToBlob } from './cards.js?v=1.2.0';

export const TEST_MODEL = 'gf-test-fake'; // 서버의 점검용 가짜 모델 이름 (image_service.js 와 같음)

// 오류 코드 → 문구 (app.js 의 ERR 에 합쳐짐)
export const IMAGE_ERR = {
  openai_key_missing: "OpenAI API 키가 아직 없어서 AI 이미지를 못 만들어. 설정 > 이미지에서 방법을 봐줘. 사진 찾기·직접 올리기·카드뉴스는 지금도 돼.",
  pexels_key_missing: 'Pexels API 키가 아직 없어서 사진 검색을 못 해. 직접 올리기로 계속할 수 있어.',
  pexels_key_invalid: 'Pexels API 키가 맞지 않아. Supabase Secrets의 PEXELS_API_KEY를 확인해줘.',
  pexels_rate_limited: 'Pexels 요청 한도에 닿았어. 조금 뒤에 다시 해줘.',
  pexels_error: 'Pexels에서 문제가 생겼어. 조금 뒤에 다시 해줘.',
  pexels_network: 'Pexels에 연결하지 못했어. 조금 뒤에 다시 해줘.',
  stock_hour_limit: '사진 검색을 한 시간에 너무 많이 했어 (Pexels 한도 보호). 조금 뒤에 다시 해줘.',
  stock_month_limit: '이번 달 사진 검색 한도에 거의 닿았어. 다음 달에 다시 쓸 수 있어.',
  prompt_blocked: '이미지로 만들 수 없는 요청이 있어. 표시된 내용을 고쳐줘.',
  estimate_changed: '예상 비용이 바뀌었어. 다시 확인하고 눌러줘.',
  server_busy: '서버가 준비 중이야. 잠깐 뒤에 다시 눌러줘.',
  image_busy: '다른 이미지를 만드는 중이야. 끝나면 다시 해줘 (한 번에 하나씩).',
  image_daily_limit: '오늘 만들 수 있는 횟수를 다 썼어. 설정 > 이미지에서 하루 한도를 바꿀 수 있어.',
  image_budget: '이번 달 이미지 예산을 넘게 돼서 멈췄어. 설정 > 이미지에서 예산을 바꿀 수 있어.',
  edit_ai_only: '직접 찍은 사진·실제 사진은 AI로 고치지 않아 (실제와 다르게 보일 수 있어서). AI로 만든 이미지만 고칠 수 있어.',
  slot_gone: '이 사진 자리가 본문에서 바뀌었어. 새로고침해줘.',
  slot_taken: '그 자리에는 이미 이미지가 있어.',
  image_in_use: '원고(휴지통 포함)나 카드뉴스에서 쓰는 이미지라 지울 수 없어. 먼저 연결을 빼줘.',
  storage_full: '저장 공간이 거의 찼어 (900MB). 안 쓰는 이미지를 지워줘.',
  rights_required: '쓸 권한이 있는 사진인지 확인 칸을 체크해줘.',
  bad_image: '이미지 파일을 읽지 못했어. JPEG·PNG·WebP만 올릴 수 있어.',
  bad_type: '이미지 파일만 올릴 수 있어.',
  download_failed: '사진을 받아오지 못했어. 다시 해줘.',
  bad_source: '허용하지 않은 주소의 사진이야.',
  too_big: '파일이 너무 커.',
  storage_failed: '파일을 저장하지 못했어. 다시 해줘.',
  stock_bad_image: 'Pexels 사진 파일을 읽지 못했어. 다른 사진을 골라줘.',
  real_photo_needed: '실제 상품·화면이 보여야 하는 자리야. 직접 찍은 사진을 올리거나, 일반 장면으로 만들겠다고 체크해줘.',
  openai_unsupported_option: '이 모델이 그 크기·품질을 지원하지 않아. 설정 > 이미지에서 모델이나 품질을 바꿔줘.',
  openai_spend_limit: 'OpenAI에 걸어둔 사용 한도(Spend limit)에 닿았어. OpenAI 설정의 Limits에서 한도를 올리거나 다음 달까지 기다려줘.',
  timeout: '응답이 너무 늦어. 다시 눌러줘 (같은 요청이면 두 번 만들지 않아).',
  cf_key_missing: '무료 이미지(Cloudflare) 계정 ID·토큰이 아직 없어. 설정 > 이미지에서 방법을 봐줘. 사진 찾기·직접 올리기·카드뉴스는 지금도 돼.',
  cf_key_invalid: 'Cloudflare 계정 ID나 토큰이 맞지 않아. Supabase Secrets의 CF_ACCOUNT_ID·CF_API_TOKEN을 확인해줘.',
  cf_daily_free_used: '오늘 무료 사용량을 다 썼어. 한국 시간 오전 9시에 다시 채워져. (청구 없음)',
  cf_rate_limited: 'Cloudflare가 잠깐 요청을 막았어. 1분쯤 뒤에 다시 해줘.',
  edit_unsupported: '무료 모델은 고치기(편집)를 못 해. 설명을 바꿔서 새로 만들어줘.',
};
export const IMAGE_FIELD = {
  request_key: '요청', slot_key: '사진 자리', text: '사진 설명', ratio: '비율', quality: '품질', photo_id: '사진', file: '파일', b64: '파일', q: '검색어',
  image_gen_model: '생성 모델', image_edit_model: '편집 모델', image_quality: '기본 품질', image_daily_limit: '하루 한도', image_monthly_budget_usd: '한 달 예산',
  image_fx_krw: '환율', image_fx_date: '환율 날짜', image_prices: '가격', crop: '자르기', slides: '카드 문구', template: '템플릿', bg_image_id: '배경 이미지',
  actual_usd: '청구액', actual_checked_at: '확인일', base_image_id: '고칠 이미지', post_id: '원고', image_id: '이미지', review_status: '검수 상태',
};
export const IMAGE_REASON = {
  empty: '파일이 비어 있어.', too_big: '파일이 너무 커. 8MB까지 올릴 수 있어.', bad_type: 'JPEG·PNG·WebP 이미지만 올릴 수 있어. (이름만 바꾼 파일도 안 돼)',
  type_mismatch: '파일 내용과 형식이 달라. 원래 이미지 파일을 올려줘.', animated: '움직이는 이미지는 올릴 수 없어.', too_many_pixels: '가로·세로가 너무 큰 이미지야. 줄여서 올려줘.',
};
const RETRYABLE = new Set(['cf_timeout', 'cf_server', 'cf_network', 'cf_rate_limited', 'cf_empty', 'openai_timeout', 'openai_server', 'openai_network', 'openai_rate_limited', 'server_stopped', 'timeout', 'storage_failed', 'save_failed', 'server_error', 'server_busy_late']);

const MOBILE = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));
const usd = (x) => IMG.fmtUsd(x);
const clamp = (v) => Math.min(1, Math.max(0, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const byId = (list) => Object.fromEntries((list || []).map((x) => [x.id, x]));
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const fmtBytes = (n) => (n == null ? '' : n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + 'KB' : (n / 1048576).toFixed(1) + 'MB');
const typeName = (t) => ({ 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' }[t] || t);
const outExt = (img) => (img.kind === 'card' || img.mime === 'image/png' ? 'png' : 'jpg');
const slotName = (s) => (s.n ? `사진 ${s.n}` : s.label || (IMG.extraSlot(s.key) || {}).label || '사진');
// 받침에 맞는 조사 (사진 1과 / 사진 2와)
const DIGIT_BATCHIM = [true, true, false, true, false, false, true, true, true, false];
export function josa(word, withB, withoutB) {
  const c = String(word || '').trim().slice(-1);
  if (/[0-9]/.test(c)) return word + (DIGIT_BATCHIM[Number(c)] ? withB : withoutB);
  const code = c.charCodeAt(0) - 0xac00;
  if (code >= 0 && code < 11172) return word + (code % 28 ? withB : withoutB);
  return word + withB;
}
const newKey = () => {
  try { if (crypto.randomUUID) return 'g' + crypto.randomUUID().replace(/-/g, ''); } catch { /* 아래로 */ }
  return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
};
// 생성 비용: 청구액 확인 > 사용량 기준 > 예상 (청구 없음은 $0). '실제 비용'은 사용자가 확인해 넣은 청구액뿐
export function genCost(g) {
  if (!g) return null;
  if (g.cost_status === '청구 없음') return { usd: 0, label: '청구 없음' };
  if (g.actual_usd != null) return { usd: Number(g.actual_usd), label: '청구액 확인' };
  const unsure = g.cost_status === '확인 필요' ? ' · 확인 필요' : '';
  if (g.usage_usd != null) return { usd: Number(g.usage_usd), label: '사용량 기준' + unsure };
  return { usd: Number(g.est_usd || 0), label: '예상' + unsure };
}

// 큰 파일을 올리기 전에: 형식 확인 → (휴대폰 사진 방향을 반영해) 다시 그리기 → 2560px로 줄이기 → 숨은 정보(EXIF·GPS) 없이 저장
export async function prepareUpload(file) {
  if (!file) throw new Error('파일을 골라줘.');
  if (file.size > 25 * 1024 * 1024) throw new Error('파일이 너무 커 (25MB 넘음). 줄여서 올려줘.');
  const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const sn = IMG.sniffImage(head);
  if (!sn) throw new Error('JPEG·PNG·WebP 이미지만 올릴 수 있어. (HEIC·GIF·SVG·이름만 바꾼 파일은 안 돼)');
  if (sn.animated) throw new Error('움직이는 이미지는 올릴 수 없어.');
  // 머리 부분에서 읽은 가로·세로로 먼저 거름 (아주 큰 그림을 다 풀다가 휴대폰 브라우저가 멈추지 않게)
  if (sn.width && sn.height && (sn.width > 12000 || sn.height > 12000 || sn.width * sn.height > 50_000_000)) throw new Error('가로·세로가 너무 큰 이미지야. 줄여서 올려줘.');
  const el = await loadImg(file);
  const W = el.naturalWidth, H = el.naturalHeight;
  if (!W || !H) throw new Error('이미지를 열지 못했어.');
  if (W * H > 50_000_000) throw new Error('가로·세로가 너무 큰 이미지야. 줄여서 올려줘.');
  const scale = Math.min(1, 2560 / Math.max(W, H));
  const w = Math.round(W * scale), hh = Math.round(H * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = hh;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(el, 0, 0, w, hh);
  const alpha = sn.mime !== 'image/jpeg' && hasAlpha(el);
  let type = sn.mime;
  let blob = await canvasToBlob(cv, type, 0.92);
  if (blob.type !== type) { type = alpha ? 'image/png' : 'image/jpeg'; blob = await canvasToBlob(cv, type, 0.92); } // 이 기기가 WebP로 못 저장하면
  if (blob.size > IMG.MAX_UPLOAD_BYTES && !alpha) { type = 'image/jpeg'; blob = await canvasToBlob(cv, type, 0.88); }
  if (blob.size > IMG.MAX_UPLOAD_BYTES) { type = 'image/jpeg'; blob = await canvasToBlob(cv, type, 0.78); }
  if (blob.size > IMG.MAX_UPLOAD_BYTES) throw new Error('줄여도 8MB가 넘어. 더 작은 사진으로 올려줘.');
  const base = String(file.name || 'photo').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w가-힣-]+/g, '-').slice(0, 40) || 'photo';
  return { blob, w, h: hh, type: blob.type, name: `${base}.${IMG.extOf(blob.type)}`, resized: scale < 1, original: { w: W, h: H, mime: sn.mime } };
}
function hasAlpha(el) {
  try {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.drawImage(el, 0, 0, 64, 64);
    const d = x.getImageData(0, 0, 64, 64).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  } catch { /* 모르면 투명 없음으로 */ }
  return false;
}
function loadImg(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const el = new Image();
    el.onload = () => { resolve(el); setTimeout(() => URL.revokeObjectURL(url), 60_000); };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 열지 못했어.')); };
    el.src = url;
  });
}
function fileOf(blob, name, w, h) {
  let f;
  try { f = new File([blob], name, { type: blob.type }); } catch { f = blob; try { f.name = name; } catch { /* 무시 */ } }
  f.w = w; f.h = h;
  return f;
}
// 서명 주소에서 원본을 받아서 풀어 둠 (한 창에서 여러 번 자를 때 다시 받지 않게). signal 로 받기를 멈출 수 있음 (창을 닫을 때)
export async function loadSource(img, signal) {
  const res = await fetch(img.url, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal });
  if (!res.ok) throw new Error('fetch ' + res.status);
  const blob = await res.blob();
  const el = await loadImg(blob);
  return { blob, el, W: el.naturalWidth || img.width, H: el.naturalHeight || img.height };
}
// 원본 파일 그대로 (풀지 않음 — 보관함에서 원본만 받을 때)
export async function originalFile(img, name, signal) {
  const res = await fetch(img.url, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal });
  if (!res.ok) throw new Error('fetch ' + res.status);
  const blob = await res.blob();
  return fileOf(blob, String(name).replace(/\.[a-z0-9]+$/i, '') + '.' + IMG.extOf(blob.type), img.width, img.height);
}
// 내려받을 파일 만들기: (필요하면) 저장한 초점으로 자르고 → 용도 크기로 줄임 (늘리지는 않음)
export async function renderOutput(img, o, src) {
  const { blob, el, W, H } = src || (await loadSource(img));
  if (o.original) return fileOf(blob, String(o.name).replace(/\.[a-z0-9]+$/i, '') + '.' + IMG.extOf(blob.type), W, H);
  const need = o.ratio && !IMG.sameRatio(W, H, o.ratio);
  const rect = need ? IMG.cropRect(W, H, o.ratio, o.focus) : { x: 0, y: 0, w: W, h: H };
  const out = IMG.outputSize(rect, (IMG.PURPOSES[o.purpose] || IMG.PURPOSES.general).out);
  const type = outExt(img) === 'png' ? 'image/png' : 'image/jpeg';
  if (!need && out.w === W && out.h === H && blob.type === type) return fileOf(blob, o.name, W, H); // 그대로 (다시 압축하지 않음)
  const cv = document.createElement('canvas');
  cv.width = out.w; cv.height = out.h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.w, out.h); }
  ctx.drawImage(el, rect.x, rect.y, rect.w, rect.h, 0, 0, out.w, out.h);
  const outBlob = await canvasToBlob(cv, type, 0.92);
  cv.width = 0; cv.height = 0; // 휴대폰 메모리 아끼기
  return fileOf(outBlob, o.name, out.w, out.h);
}

export function createStudio(ui) {
  const { h, btn, field, det, opt, api, run, toast, openSheet, closeSheet, confirmBox, go, L } = ui;
  const C = {};        // 원고별 이미지 정보 { at, data, loading }
  const panels = {};   // 원고별로 지금 화면에 있는 '이미지' 칸
  const drafts = {};   // 원고별 카드뉴스 고치는 중인 내용
  const polls = {};    // 원고별 '만드는 중' 확인 타이머
  let libKind = '';
  let fontsListener = null; // 카드뉴스 미리보기의 '글꼴 다 받음' 듣는 함수 (하나만)
  const settings = () => (ui.S.settings || {});
  const prices = () => settings().image_prices || IMG.DEFAULT_PRICES;
  const fresh = (c, p) => !!(c && c.data && Date.now() - c.at < 45 * 60e3 && (!p || c.body === p.body));

  // ── 서버에서 받기 ──
  // 강제로 다시 받을 때는 진행 중인 요청(바꾸기 전 내용일 수 있음)의 결과를 쓰지 않고 새로 보냄. 늦게 온 예전 응답은 버림
  // 같은 원고 요청은 겹쳐 보내지 않고 앞의 요청이 끝난 뒤에 보냄 (서버의 사진 자리 맞추기가 동시에 돌지 않게). 기다리는 사이 더 새 요청이 생기면 보내지 않음
  let seqN = 0;
  function fetchPost(id, force) {
    const c = C[id];
    if (!force && fresh(c)) return Promise.resolve(c.data);
    if (!force && c && c.loading) return c.loading;
    const seq = ++seqN;
    let body;
    const req = ((c && c.req) || Promise.resolve()).catch(() => {}).then(() => {
      const cur = C[id];
      if (cur && cur.seq > seq && cur.loading && cur.loading !== p) return null; // 더 새 요청이 기다리는 중 → 이건 안 보냄
      body = (ui.post(id) || {}).body; // 보낼 때의 본문 (받을 때가 아니라)
      return api(`/posts/${id}/images`, { timeout: 25000 }); // 오래 멈춘 요청이 뒤의 요청을 계속 막지 않게
    });
    const p = req.then((d) => {
      const cur = C[id];
      if (d && !(cur && cur.seq > seq)) { C[id] = { at: Date.now(), data: d, loading: null, req: null, body, seq }; return d; }
      // 더 새 요청이 있었음 → 그 결과를 기다려서 돌려줌
      return cur && cur.loading && cur.loading !== p ? cur.loading : (cur && cur.data) || d;
    });
    p.catch(() => {}).finally(() => { const cur = C[id]; if (cur && cur.loading === p) { cur.loading = null; cur.req = null; } });
    C[id] = { ...(c || {}), loading: p, req, seq };
    return p;
  }
  function redraw(id) {
    const box = panels[id];
    const p = ui.post(id);
    if (box && box.isConnected && p && C[id] && C[id].data) drawPanel(box, p, C[id].data);
    if (ui.onImages) ui.onImages(id);
  }
  async function refresh(id) {
    try { await fetchPost(id, true); } catch (e) { if (e && e.code !== 'auth') toast(ui.errText(e)); return; }
    redraw(id);
    if (ui.clearStats) ui.clearStats(); // 수익 탭의 이미지 비용도 새로
    ui.load();
  }
  // AI 이미지 만들기 요청: 생성 전용 서버(blog-gen — 같은 코드, 다른 요청과 섞이지 않는 일꾼)로 먼저 보내고,
  // 그게 아직 없거나 닿지 않으면 본 서버로 같은 요청 번호로 다시 보냄 (서버가 이미 받았으면 그 기록을 돌려줘서 두 번 만들지 않음)
  let genFn = true;
  async function sendGenerate(body) {
    if (genFn) {
      try { return await api('/images/generate', { method: 'POST', body, timeout: 40000, gen: true }); } catch (e) {
        if (!e || (e.code !== 'gen_unavailable' && e.code !== 'network')) throw e;
        const j = await api('/images/generate', { method: 'POST', body, timeout: 40000 });
        genFn = false; // 본 서버는 되니까 이번에 앱을 쓰는 동안은 본 서버로
        return j;
      }
    }
    return api('/images/generate', { method: 'POST', body, timeout: 40000 });
  }
  const dataOf = (id) => (C[id] && C[id].data) || null;
  const imgsOf = (id) => byId((dataOf(id) || {}).images);
  const genOf = (d, img) => (d && img && img.generation_id ? (d.generations || []).find((g) => g.id === img.generation_id) : null);
  const keysOf = (id) => (dataOf(id) || {}).keys || {};

  // ── 작은 조각 ──
  const kindChip = (img) => h('span', { class: 'chip k-' + img.kind }, IMG.KIND_LABEL[img.kind] || img.kind);
  const reviewChip = (img) => h('span', { class: 'chip ' + (img.review_status === '사용 가능' ? 'v-ok' : img.review_status === '사용 안 함' ? 'v-no' : 'v-unk') }, img.review_status);
  function thumb(img, onclick) {
    const pic = img.url ? h('img', { src: img.url, alt: img.alt_text || img.description || '이미지', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'hint' }, '미리보기를 불러오지 못했어');
    return onclick ? h('button', { type: 'button', class: 'thumb', onclick, 'aria-label': '크게 보기' }, pic) : h('div', { class: 'thumb' }, pic);
  }
  function pickThumb(img, onclick) {
    return h('button', { type: 'button', class: 'pick', onclick },
      img.url ? h('img', { src: img.url, alt: img.alt_text || img.description || '이미지', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'ph' }, '이미지'),
      h('small', null, [IMG.KIND_LABEL[img.kind], img.uses ? `${img.uses}곳에서 사용` : ''].filter(Boolean).join(' · ')));
  }
  function imageLine(img, d) {
    const parts = [];
    if (img.kind === 'ai') {
      const g = genOf(d, img);
      parts.push(img.model || 'AI');
      const c = genCost(g);
      if (c) parts.push(`비용 ${usd(c.usd)} (${c.label})`);
    } else if (img.kind === 'stock') parts.push(img.attribution_text || `사진: ${img.author_name || '사진가'} (Pexels)`);
    else if (img.kind === 'upload') parts.push('직접 올림 · 쓸 권한 확인함');
    else if (img.kind === 'card') parts.push('카드뉴스 (앱에서 만듦)');
    if (img.width && img.height) parts.push(`${img.width}×${img.height}`);
    if (img.used_posts > 1) parts.push(`다른 원고 ${img.used_posts - 1}곳에서도 사용 중`);
    return parts.join(' · ');
  }
  // 이번 달 금액은 청구액을 넣은 것 말고는 예상·사용량 기준 계산값이라 '(예상 포함)'
  const usageLine = (u) => (u ? `오늘 ${u.today}/${u.daily_limit}번 · 이번 달 ${usd(u.month_usd)}(예상 포함) / 예산 ${usd(u.budget_usd)}` : '');

  // ═════════ 원고 상세의 '이미지' 칸 ═════════
  function postPanel(p) {
    const box = h('section', { class: 'panel studio', id: 'images-' + p.id });
    panels[p.id] = box;
    const c = C[p.id];
    if (c && c.data) drawPanel(box, p, c.data);
    else box.append(h('h2', null, '이미지'), h('p', { class: 'hint' }, '불러오는 중…'));
    if (!fresh(c, p)) {
      fetchPost(p.id, !!(c && c.data)).then(() => redraw(p.id)).catch((e) => {
        if (!e || e.code === 'auth' || !box.isConnected || dataOf(p.id)) return;
        put(box, h('h2', null, '이미지'), h('p', { class: 'hint' }, ui.errText(e)),
          h('div', { class: 'go' }, btn('다시 불러오기', 'sm ghost', (ev) => run(ev.currentTarget, () => fetchPost(p.id, true).then(() => redraw(p.id))))));
      });
    }
    return box;
  }
  function drawPanel(box, p, d) {
    const imgs = byId(d.images);
    const slots = d.slots || [];
    const has = (s) => s.row && s.row.image_id && imgs[s.row.image_id];
    const linked = slots.filter(has);
    const extra = (d.extra || []).map((x) => ({ key: x.key, n: 0, text: x.label, label: x.label, row: x.row }));
    const extraLinked = extra.filter(has);
    const kids = [h('div', { class: 'split' }, h('h2', null, '이미지'),
      h('span', { class: 'hint' }, slots.length ? `사진 자리 ${slots.length}곳 · 연결 ${linked.length} · 사용 완료 ${linked.filter((s) => s.row.used_at).length}` : '본문에 사진 자리 없음'))];
    if (d.rekeyed) kids.push(h('p', { class: 'okbox' }, `본문이 바뀌어서 사진 자리 ${d.rekeyed}곳의 연결을 새 자리로 옮겼어.`));
    const running = d.usage && d.usage.running;
    if (running) {
      const mine = running.post_id === p.id;
      const s = mine ? [...slots, ...extra].find((x) => x.key === running.slot_key) : null;
      kids.push(h('div', { class: 'genprog' }, h('i', { class: 'spin', 'aria-hidden': 'true' }),
        h('span', null, mine ? `이미지 만드는 중${s ? ' (' + slotName(s) + ')' : ''} — 이 화면을 나가도 서버에서 계속 만들어.` : '다른 원고의 이미지를 만드는 중이야 (한 번에 하나씩).')));
      if (mine) schedulePoll(p.id);
    }
    const st = settings();
    const freeGen = IMG.modelCaps(st.image_gen_model || '').free;
    if (freeGen && !(d.keys || {}).cloudflare) kids.push(h('p', { class: 'hint' }, 'AI 이미지(무료): Cloudflare 계정 ID·토큰이 아직 없어 (설정 > 이미지에서 방법 보기). 사진 찾기·직접 올리기·카드뉴스는 지금도 돼.'));
    if (!freeGen && !(d.keys || {}).openai && st.image_gen_model !== TEST_MODEL) kids.push(h('p', { class: 'hint' }, 'AI 이미지: OpenAI 키가 아직 없어 (설정 > 이미지에서 방법 보기). 사진 찾기·직접 올리기·카드뉴스는 지금도 돼.'));
    if (st.image_gen_model === TEST_MODEL) kids.push(h('p', { class: 'notice' }, "설정의 생성 모델이 점검용 가짜 모델(gf-test-fake)이야. 실제 이미지가 아니라 회색 시험 그림이 나와."));
    if (!slots.length) kids.push(h('p', { class: 'hint' }, "본문에 [이미지: 설명] 줄이 없어. '본문 고치기'에서 사진이 들어갈 곳에 [이미지: 설명] 한 줄을 넣으면 여기에 자리가 생겨."));
    slots.forEach((s, i) => kids.push(slotCard(p, d, s, imgs, slots[i - 1], slots[i + 1])));
    const ex = det('img-extra:' + p.id, `블로그 대표·SNS용 이미지 (${extraLinked.length}/${extra.length})`, extraLinked.length > 0, '');
    ex.append(h('div', { class: 'stack', style: 'margin-top:8px' }, extra.map((s) => slotCard(p, d, s, imgs))));
    kids.push(ex);
    if ((d.orphans || []).length) {
      const ob = det('img-orphans:' + p.id, `본문에서 사라진 사진 자리 ${d.orphans.length}곳 (이미지는 그대로 있어)`, true, '');
      ob.append(h('div', { class: 'stack', style: 'margin-top:8px' }, d.orphans.map((o) => {
        const img = imgs[o.image_id];
        return h('div', { class: 'slot' }, h('b', null, o.slot_text || '(설명 없음)'), img ? thumb(img, null) : null,
          h('div', { class: 'go' }, slots.length && img ? btn('다른 자리에 연결', 'sm ghost', () => moveSheet(p, d, o, img)) : null,
            btn('연결 빼기', 'sm ghost', (ev) => unlink(p, { key: o.slot_key, n: 0, label: o.slot_text }, ev.currentTarget))));
      }), h('p', { class: 'hint' }, '본문을 고치거나 다시 만들면서 사라진 자리야. 이미지는 지우지 않았어. 새 자리에 연결하거나 빼줘.')));
      kids.push(ob);
    }
    // '사용 안 함' 이미지는 모두 내려받기에서 빠지니까 개수에서도 뺌
    const all = [...linked, ...extraLinked].filter((s) => imgs[s.row.image_id].review_status !== '사용 안 함').length;
    kids.push(h('div', { class: 'go' },
      all ? btn(`모두 내려받기 (${all})`, 'sm', () => downloadAllSheet(p)) : null,
      btn('카드뉴스 만들기', 'sm ghost', () => go(`content/post/${p.id}/cards`)),
      btn('이미지 보관함', 'sm ghost', () => go('content/images'))));
    kids.push(costBlock(p, d));
    kids.push(h('p', { class: 'hint' }, 'AI 이미지는 일반 상황 삽화·배경용이야. 실제 상품 모습은 직접 찍은 사진이나 쓸 수 있는 공식 이미지를 써줘. 앱은 블로그에 사진을 대신 올리지 않아 — 내려받아서 직접 넣어줘.'));
    put(box, ...kids);
  }
  function slotCard(p, d, s, imgs, prevSlot, nextSlot) {
    const row = s.row;
    const img = row && row.image_id ? imgs[row.image_id] : null;
    const running = d.usage && d.usage.running && d.usage.running.post_id === p.id && d.usage.running.slot_key === s.key;
    const card = h('div', { class: 'slot' + (img ? ' on' : '') });
    const chips = h('span', { class: 'chips' });
    if (img) {
      chips.append(kindChip(img), reviewChip(img));
      if (row.downloaded_at) chips.append(h('span', { class: 'chip v-ok' }, '내려받음'));
      if (row.used_at) chips.append(h('span', { class: 'chip v-ok' }, '사용 완료'));
    } else chips.append(h('span', { class: 'chip' }, running ? '만드는 중' : '이미지 없음'));
    card.append(h('div', { class: 'split' }, h('b', null, slotName(s)), chips));
    if (s.n) card.append(h('p', { class: 'slot-t' }, s.text || '(설명 없음)'));
    const risk = s.n ? IMG.slotRisk(s.text) : { real: false };
    if (risk.real && (!img || img.kind === 'ai')) card.append(h('p', { class: 'notice' }, risk.msg));
    if (img) {
      card.append(thumb(img, () => previewSheet(p, s)), h('span', { class: 'hint' }, imageLine(img, d)));
      if (s.n && img.description && IMG.descriptionMismatch(s.text, img.description)) card.append(h('p', { class: 'notice' }, '이 이미지 설명이 사진 자리 설명과 많이 달라. 맞는 이미지인지 확인해줘.'));
      if (img.review_status === '사용 안 함') card.append(h('p', { class: 'badbox' }, "'사용 안 함'으로 표시한 이미지야. 바꾸거나 연결을 빼줘."));
    }
    const cands = (d.images || []).filter((i) => i.origin_slot_key === s.key && (!img || i.id !== img.id)).slice(0, 6);
    if (cands.length) {
      card.append(h('div', { class: 'stack' }, h('span', { class: 'hint' }, img ? '이 자리용으로 만든 다른 이미지 — 눌러서 바꾸기' : '이 자리용으로 만든 이미지 — 눌러서 연결'),
        h('div', { class: 'grid3' }, cands.map((i) => pickThumb(i, (ev) => linkTo(p, s, i, ev.currentTarget))))));
    }
    const row2 = h('div', { class: 'go' });
    if (!img) {
      // 실제 상품·화면이 보여야 하는 자리는 직접 찍은 사진 올리기를 먼저 권함
      const ai = btn('AI로 만들기', risk.real ? 'sm ghost' : 'sm', () => genSheet(p, s), { disabled: running });
      const up = btn('파일 올리기', risk.real ? 'sm' : 'sm ghost', () => uploadSheet(p, s));
      row2.append(risk.real ? up : ai, btn('실제 사진 찾기', 'sm ghost', () => stockSheet(p, s)), risk.real ? ai : up, btn('보관함에서', 'sm ghost', () => pickSheet(p, s)));
    } else {
      row2.append(btn('미리보기·내려받기', 'sm', () => previewSheet(p, s)), btn('바꾸기', 'sm ghost', () => chooser(p, s, img)),
        img.kind === 'ai' ? btn('다시 만들기', 'sm ghost', () => genSheet(p, s, { prev: genOf(d, img) }), { disabled: running }) : null,
        btn(row.used_at ? '사용 완료 취소' : '사용 완료', 'sm ghost', (ev) => markUsed(p, s, !row.used_at, ev.currentTarget)),
        btn('빼기', 'sm ghost', (ev) => { if (confirmBox(ev.currentTarget, '연결을 뺄까?')) unlink(p, s, ev.currentTarget); }));
    }
    if (s.n && (img || (prevSlot && prevSlot.row && prevSlot.row.image_id) || (nextSlot && nextSlot.row && nextSlot.row.image_id))) {
      row2.append(btn('↑', 'sm ghost', (ev) => swap(p, s, prevSlot, ev.currentTarget), { disabled: !prevSlot, 'aria-label': `${slotName(s)} 위로 (위 자리와 이미지 맞바꾸기)` }),
        btn('↓', 'sm ghost', (ev) => swap(p, s, nextSlot, ev.currentTarget), { disabled: !nextSlot, 'aria-label': `${slotName(s)} 아래로 (아래 자리와 이미지 맞바꾸기)` }));
    }
    card.append(row2);
    return card;
  }
  // 이미지 칸이 화면에 있는 동안 '만드는 중'을 확인. 한 번 실패해도 멈추지 않고 간격을 늘려서 다시 (최대 30초)
  function schedulePoll(id, delay = 5000) {
    if (polls[id]) return;
    polls[id] = setTimeout(async () => {
      polls[id] = null;
      const box = panels[id];
      if (!box || !box.isConnected) return;
      const before = dataOf(id);
      const was = before && before.usage && before.usage.running && before.usage.running.post_id === id;
      try { await fetchPost(id, true); } catch (e) { if (!e || e.code !== 'auth') schedulePoll(id, Math.min(30000, delay * 2)); return; }
      const now = dataOf(id);
      const still = now && now.usage && now.usage.running && now.usage.running.post_id === id;
      redraw(id);
      if (was && !still) { toast('이미지 만들기가 끝났어. 사진 자리에서 확인해줘.'); ui.load(); }
    }, delay);
  }
  function costBlock(p, d) {
    const t = (d.costs && d.costs.totals) || {};
    const gens = d.generations || [];
    const st = settings();
    const box = det('img-cost:' + p.id, `이미지 생성 비용 — ${t.count || 0}번 (비용 반영 ${t.billed || 0}번) · ${usd(t.usd || 0)}${t.krw != null && Number(t.usd) > 0 ? ' ≈ ' + L.won(t.krw) : ''}${Number(t.n_actual || 0) < Number(t.billed || 0) ? ' (예상 포함)' : ''}`, false, '');
    const inner = h('div', { class: 'stack', style: 'margin-top:8px' });
    inner.append(h('p', { class: 'hint' }, "예상: 요청 전에 공식 가격표로 계산한 값 · 사용량 기준: OpenAI가 알려준 사용량(토큰) × 가격 · 청구액 확인: OpenAI 사용량 화면에서 확인해 직접 넣은 금액. 앱은 실제 청구액을 직접 가져오지 못해."),
      h('p', { class: 'hint' }, st.image_fx_krw ? `원화는 환율 ${L.fmtNum(st.image_fx_krw)}원/달러 기준 (${st.image_fx_date || '날짜 없음'}${st.image_fx_source ? ' · ' + st.image_fx_source : ''}). 기록마다 그때 환율로 계산해.` : '환율을 아직 안 넣어서 원화로 바꾸지 않았어 (설정 > 이미지).'));
    if (t.uncertain) inner.append(h('p', { class: 'notice' }, `청구됐는지 확인이 필요한 기록이 ${t.uncertain}개 있어. OpenAI 사용량 화면에서 확인하고 청구액을 넣어줘.`));
    if (!gens.length) inner.append(h('p', { class: 'hint' }, '이 글로 만든 AI 이미지가 아직 없어.'));
    for (const g of gens.slice(0, 30)) {
      const c = genCost(g);
      inner.append(h('div', { class: 'mrow' },
        h('div', { class: 'split' }, h('span', { class: 'small num' }, L.fmtTime(g.created_at)), h('span', { class: 'chip ' + (g.status === '성공' ? 'v-ok' : g.status === '실패' ? 'v-no' : 'v-unk') }, g.status)),
        h('div', { class: 'vals' }, h('span', null, `${g.mode === 'edit' ? '편집' : '생성'} · ${g.model} · ${g.size} · ${IMG.QUALITY_LABEL[g.quality] || g.quality}`),
          h('span', null, '비용 ', h('b', null, usd(c.usd)), ` (${c.label})`), g.status === '실패' && g.error_message ? h('span', null, g.error_message) : null),
        g.status !== '생성 중' ? h('div', { class: 'go' }, h('button', { type: 'button', class: 'copy', onclick: () => costSheet(p, g) }, g.actual_usd != null ? '청구액 고치기' : '청구액 넣기')) : null));
    }
    box.append(inner);
    return box;
  }
  function costSheet(p, g) {
    const amt = h('input', { type: 'text', inputmode: 'decimal', value: g.actual_usd ?? '', placeholder: '예: 0.0123' });
    const at = h('input', { type: 'date', value: g.actual_checked_at || L.todayStr() });
    const send = (body, button, msg) => run(button, async () => {
      await api(`/images/generations/${g.id}/cost`, { method: 'POST', body });
      closeSheet(); await refresh(p.id);
    }, msg);
    openSheet('실제 청구액 넣기',
      h('p', { class: 'hint' }, `${L.fmtTime(g.created_at)} · ${g.model} · ${g.size} · 품질 ${IMG.QUALITY_LABEL[g.quality] || g.quality}`),
      h('p', { class: 'hint' }, `예상 ${usd(g.est_usd)}${g.usage_usd != null ? ' · 사용량 기준 ' + usd(g.usage_usd) : ''} · 지금 상태: ${g.cost_status}`),
      h('p', { class: 'notice' }, "앱은 OpenAI 청구액을 직접 가져오지 못해. OpenAI 사용량 화면에서 확인한 금액을 넣어줘. 넣은 것만 '청구액 확인'으로 표시해."),
      h('div', { class: 'go' }, h('a', { class: 'copy', href: 'https://platform.openai.com/usage', target: '_blank', rel: 'noopener noreferrer' }, 'OpenAI 사용량 보기 ↗')),
      field('청구액 (달러)', amt), field('확인한 날', at),
      h('div', { class: 'go' },
        btn('청구액 저장', 'sm', (ev) => {
          const v = Number(String(amt.value).replace(/[$,\s]/g, ''));
          if (!amt.value.trim() || !Number.isFinite(v) || v < 0 || v > 100) { toast('0~100 사이 달러 금액을 넣어줘'); return; }
          send({ actual_usd: v, actual_checked_at: at.value || null }, ev.currentTarget, '청구액을 저장했어');
        }),
        btn('청구 없음으로', 'sm ghost', (ev) => send({ cost_status: '청구 없음', actual_checked_at: at.value || null }, ev.currentTarget, '청구 없음으로 표시했어')),
        // 내가 넣은 값(청구액·청구 없음 표시)만 지울 수 있고, 지우면 서버가 처음 매긴 상태로 돌아감
        g.actual_checked_at && (g.actual_usd != null || g.cost_status === '청구 없음')
          ? btn('넣은 값 지우기', 'sm ghost', (ev) => send({ actual_usd: null }, ev.currentTarget, `지웠어 (${g.auto_cost_status || '처음 상태'}로)`)) : null));
  }

  // ── 연결·빼기·순서·사용 완료 ──
  // extra: { purpose } — AI로 만든 바로 그 이미지를 연결할 때는 만들 때 고른 용도로 (내려받을 때 고른 비율로 자르게)
  async function linkTo(p, s, img, button, extra) {
    const j = await run(button, () => api(`/posts/${p.id}/images/link`, { method: 'POST', body: { slot_key: s.key, image_id: img.id, ...(extra || {}) } }), `${slotName(s)}에 연결했어`);
    if (j) await refresh(p.id);
    return j;
  }
  async function unlink(p, s, button) {
    const j = await run(button, () => api(`/posts/${p.id}/images/link`, { method: 'POST', body: { slot_key: s.key, image_id: null } }), '연결을 뺐어 (이미지는 보관함에 그대로)');
    if (j) await refresh(p.id);
  }
  async function markUsed(p, s, used, button) {
    const j = await run(button, () => api(`/posts/${p.id}/images/slot`, { method: 'POST', body: { slot_key: s.key, used } }), used ? '사용 완료로 표시했어' : '사용 완료를 취소했어');
    if (j) await refresh(p.id);
  }
  async function swap(p, a, b, button) {
    if (!b) return;
    const j = await run(button, () => api(`/posts/${p.id}/images/swap`, { method: 'POST', body: { a: a.key, b: b.key } }), `${josa(slotName(a), '과', '와')} ${slotName(b)} 이미지를 맞바꿨어`);
    if (j) await refresh(p.id);
  }
  function chooser(p, s, img) {
    openSheet(`${slotName(s)} — 이미지 바꾸기`,
      h('p', { class: 'hint' }, '지금 이미지는 보관함에 그대로 남아.'),
      h('div', { class: 'stack' },
        btn('AI로 새로 만들기', 'wide', () => genSheet(p, s)),
        img && img.kind === 'ai' ? btn('이 이미지 고쳐서 만들기 (편집)', 'wide ghost', () => genSheet(p, s, { base: img })) : null,
        btn('실제 사진 찾기 (Pexels)', 'wide ghost', () => stockSheet(p, s)),
        btn('파일 올리기', 'wide ghost', () => uploadSheet(p, s)),
        btn('보관함에서 고르기', 'wide ghost', () => pickSheet(p, s))));
  }
  function moveSheet(p, d, o, img) {
    const slots = d.slots || [];
    openSheet('다른 자리에 연결',
      thumb(img, null),
      h('p', { class: 'hint' }, '이 이미지를 넣을 자리를 골라줘. 그 자리에 있던 이미지는 보관함에 그대로 남아.'),
      h('div', { class: 'stack' }, slots.map((s) => btn(`${slotName(s)} · ${s.text}`, 'wide ghost', async (ev) => {
        const ok = await run(ev.currentTarget, async () => {
          await api(`/posts/${p.id}/images/link`, { method: 'POST', body: { slot_key: s.key, image_id: img.id } });
          await api(`/posts/${p.id}/images/link`, { method: 'POST', body: { slot_key: o.slot_key, image_id: null } });
          return true;
        }, `${slotName(s)}에 연결했어`);
        if (ok) { closeSheet(); refresh(p.id); }
      }))));
  }

  // ═════════ AI로 만들기 ═════════
  function genSheet(p, s, o = {}) {
    const d = dataOf(p.id) || {};
    const st = settings();
    const base = o.base || null;
    const prev = o.prev || null;
    const mode = base ? 'edit' : 'generate';
    const model = mode === 'edit' ? st.image_edit_model || 'gpt-image-2.5-sunburst' : st.image_gen_model || 'gpt-image-2.5-flare';
    const isTest = model === TEST_MODEL;
    const capsModel = isTest ? 'gpt-image-2.5-flare' : model; // 점검용 가짜 모델은 크기·품질 규칙을 2.5처럼 (서버와 같게)
    const caps = IMG.modelCaps(capsModel);
    const qualities = IMG.qualitiesFor(capsModel);
    const keyOk = caps.free ? !!(d.keys && d.keys.cloudflare) : !!(d.keys && d.keys.openai) || isTest;
    const prevLines = prev ? String(prev.user_prompt || '').split('\n') : [];
    const purpose0 = (prev && prev.purpose) || (s.row && s.row.purpose) || IMG.slotPurpose(s.key);
    const f = {
      purpose: IMG.PURPOSES[purpose0] ? purpose0 : 'blog_body', ratio: '', style: (prev && IMG.STYLES[prev.style] && prev.style) || IMG.DEFAULT_STYLE,
      text: mode === 'edit' ? '' : prev ? prevLines[0] || s.text : s.text, extra: prev ? prevLines.slice(1).join(' ') : '',
      quality: IMG.normQuality(capsModel, (prev && prev.quality) || st.image_quality || 'medium'),
    };
    if (base) f.ratio = IMG.defaultRatio(base, f.purpose); // 고치기는 원래 이미지의 비율로 (정해진 크기로 만든 이미지면 그때 고른 비율)
    const prods = ui.productsOf(p.id) || [];
    const brands = prods.map((x) => x.brand).filter(Boolean);
    const hide = prods.flatMap((x) => [x.brand, x.name, x.model]).filter((v) => v && String(v).trim().length >= 2);
    const purposeSel = h('select', { value: f.purpose }, Object.entries(IMG.PURPOSES).map(([k, v]) => opt(k, v.label)));
    const ratioSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '비율' });
    const styleSel = h('select', { value: f.style }, Object.entries(IMG.STYLES).map(([k, v]) => opt(k, v.label)));
    const textTa = h('textarea', { value: f.text, maxlength: '300', style: 'min-height:70px', placeholder: mode === 'edit' ? '예: 배경을 더 밝게, 식물은 빼줘' : '' });
    const extraTa = h('textarea', { value: f.extra, maxlength: '400', style: 'min-height:56px', placeholder: '예: 밝은 오전 햇살, 위에서 내려다본 구도' });
    const qualSel = h('select', { value: f.quality }, qualities.map((q) => opt(q, IMG.QUALITY_LABEL[q])));
    const f0 = { text: f.text, extra: f.extra }; // 처음 채워 둔 값 (이것과 같으면 '적던 내용'이 아님)
    const genericChk = h('input', { type: 'checkbox' });
    const genericRow = h('label', { class: 'chk' }, genericChk, ' 실제 상품·화면이 아니라 일반 장면으로 만들게 (AI 예시 이미지 — 실제 구성품·라벨·화면은 직접 찍은 사진으로)');
    const riskBox = h('div', { class: 'stack' });
    const costBox = h('div', { class: 'costbox' });
    const promptPre = h('pre', { class: 'prompt' });
    const msg = h('div');
    // serverEst: 서버가 '예상 비용이 바뀌었어'라며 알려준 값 {usd, key: 모델|크기|품질}. 지금 고른 것과 같을 때만, 화면 계산보다 크면 그걸 보여주고 그걸로 확인을 보냄
    // newModel: 다른 기기에서 설정의 모델을 바꿔서 서버가 다른 모델로 계산한 경우 (창을 다시 열어야 함)
    let busy = false, lastEst = null, serverEst = null, newModel = '', rk = newKey();
    const goBtn = btn('만들기', 'wide', () => submit());
    const usage = () => (dataOf(p.id) || {}).usage || null;
    const update = () => {
      f.purpose = purposeSel.value; f.style = styleSel.value; f.text = textTa.value; f.extra = extraTa.value; f.quality = qualSel.value;
      const ratios = IMG.PURPOSES[f.purpose].ratios;
      if (!ratios.includes(f.ratio)) f.ratio = ratios[0];
      put(ratioSeg, ...ratios.map((r) => h('button', { type: 'button', 'aria-pressed': String(r === f.ratio), onclick: () => { f.ratio = r; update(); } }, r)));
      const size = IMG.sizeFor(f.purpose, f.ratio, capsModel);
      const prompt = IMG.buildPrompt({ post: p, slot: s, text: clean(f.text), style: f.style, purpose: f.purpose, ratio: f.ratio, extra: clean(f.extra), mode, hide });
      promptPre.textContent = prompt;
      const clientEst = isTest ? 0 : IMG.estimateUsd({ quality: f.quality, size, promptTokens: IMG.estimateTokens(prompt), mode, prices: prices(), model });
      const sEst = serverEst && serverEst.key === `${model}|${size}|${f.quality}` ? serverEst.usd : null;
      const est = clientEst == null ? null : sEst != null && sEst > clientEst ? sEst : clientEst;
      lastEst = est;
      const risks = IMG.promptRisk(f.text + '\n' + f.extra, brands);
      const blocks = IMG.blocksOf(risks);
      const sr = IMG.slotRisk(f.text + ' ' + f.extra);
      put(riskBox, ...risks.map((r) => h('p', { class: r.level === 'block' ? 'badbox' : 'notice' }, r.msg)), sr.real ? h('p', { class: 'notice' }, sr.msg) : '', sr.real ? genericRow : '');
      const u = usage();
      const fx = Number(st.image_fx_krw) || 0;
      const over = u && est != null && Number(u.month_usd) + est > Number(u.budget_usd) + 1e-9;
      const limit = u && Number(u.today) >= Number(u.daily_limit);
      put(costBox,
        h('span', null, `모델 ${model} · ${size} · 품질 ${IMG.QUALITY_LABEL[f.quality]}`),
        caps.free ? h('b', { class: 'num' }, '무료 (Cloudflare 무료 플랜 — 하루 약 100장까지, 넘으면 다음 날)')
          : h('b', { class: 'num' }, est == null ? '예상 비용을 계산하지 못했어' : `예상 ${usd(est)}${fx && est ? ' ≈ ' + L.won(est * fx) : ''}`),
        caps.free ? h('span', { class: 'hint' }, '무료 모델은 한국어 설명을 영어로 바꿔서 그려 (사람·글자에는 약해). 마음에 안 들면 설명을 구체적으로 적고 다시 만들어줘.') : null,
        sEst != null && est === sEst ? h('span', { class: 'notice' }, `서버에서 다시 계산한 예상 비용이 ${usd(sEst)}이야 (설정·가격·원고가 바뀐 것 같아). 확인하고 다시 눌러줘.`) : null,
        !caps.flexible && !isTest ? h('span', { class: 'hint' }, `이 모델은 정해진 크기(${size})로만 만들어. 만든 이미지를 이 자리에 연결하면 내려받을 때 ${f.ratio}로 잘라 줄게 (미리보기에서 자르는 곳을 고를 수 있어).`) : null,
        caps.conservative && !isTest && !caps.free ? h('span', { class: 'notice' }, '이 모델은 공식 가격표에서 장당 가격을 확인하지 못해서 예상 비용을 넉넉하게 잡았어. 실제 청구액은 OpenAI 사용량 화면에서 확인해줘.') : null,
        caps.deprecated ? h('span', { class: 'hint' }, 'OpenAI가 이전 모델(Deprecated)로 표시한 모델이야. 되도록 gpt-image-2.5-flare를 써줘.') : null,
        h('span', { class: 'hint' }, fx ? `환율 ${L.fmtNum(fx)}원/달러 (${st.image_fx_date || '날짜 없음'}${st.image_fx_source ? ' · ' + st.image_fx_source : ''})` : '환율을 넣으면 원화로도 보여줘 (설정 > 이미지)'),
        caps.free ? null : h('span', { class: 'hint' }, `예상 비용이야 (가격표 ${(prices().checked_at) || '확인일 없음'} 기준). 실제 청구액은 OpenAI 사용량 화면에서 확인해야 하고 조금 다를 수 있어.`),
        u ? h('span', { class: 'hint' }, usageLine(u)) : null);
      let why = '';
      if (newModel) why = `설정의 ${mode === 'edit' ? '편집' : '생성'} 모델이 바뀌었어 (${model} → ${newModel}). 이 창을 닫고 다시 열어줘.`;
      else if (!keyOk) why = caps.free ? 'Cloudflare 계정 ID·토큰이 없어서 아직 못 만들어. 설정 > 이미지에서 방법을 봐줘.' : 'OpenAI 키가 없어서 아직 못 만들어. 설정 > 이미지에서 방법을 봐줘.';
      else if (caps.free && mode === 'edit') why = '무료 모델은 고치기(편집)를 못 해. 설명을 바꿔서 새로 만들어줘.';
      else if (!clean(f.text)) why = mode === 'edit' ? '바꿀 내용을 적어줘.' : '사진 설명을 적어줘.';
      else if (blocks.length) why = '빨간 내용을 고쳐야 만들 수 있어.';
      else if (sr.real && !genericChk.checked) why = '실제 상품·화면이 보여야 하는 자리야. 직접 찍은 사진을 올리거나, 일반 장면으로 만들겠다고 체크해줘.';
      else if (limit) why = '오늘 만들 수 있는 횟수를 다 썼어. (설정 > 이미지에서 하루 한도)';
      else if (over) why = '이번 달 예산을 넘게 돼서 못 만들어. (설정 > 이미지에서 한 달 예산)';
      else if (u && u.running) why = '다른 이미지를 만드는 중이야. 끝나면 다시 해줘.';
      goBtn.textContent = busy ? '보내는 중…' : est == null ? '만들기' : `예상 ${usd(est)} · ${mode === 'edit' ? '고치기' : '만들기'}`;
      goBtn.disabled = !!why || busy || est == null;
      if (!busy) put(msg, why ? h('p', { class: 'hint' }, why) : '');
    };
    for (const el of [purposeSel, styleSel, qualSel]) el.addEventListener('change', update);
    for (const el of [textTa, extraTa]) el.addEventListener('input', update);
    genericChk.addEventListener('change', update);
    const form = () => {
      openSheet(`${slotName(s)} — AI ${mode === 'edit' ? '이미지 고치기' : '이미지 만들기'}`,
      s.n ? h('p', { class: 'hint' }, `사진 자리: ${s.text}`) : h('p', { class: 'hint' }, s.label || ''),
      base ? h('div', { class: 'stack' }, thumb(base, null), h('p', { class: 'hint' }, `이 이미지를 고쳐서 새로 만들어 (원본은 그대로 남아). 모델 ${model}`)) : null,
      field('어디에 쓸 이미지야?', purposeSel), h('p', { class: 'legend' }, '비율'), ratioSeg,
      field('스타일', styleSel),
      field(mode === 'edit' ? '바꿀 내용' : '사진 설명 (고쳐도 돼)', textTa, '글자·로고·가격·인증 마크는 이미지에 넣지 않아. 글자는 카드뉴스에서 따로 얹어.'),
      field('더 원하는 것 (선택)', extraTa),
      field('품질', qualSel, '높을수록 비싸고 오래 걸려. 블로그는 보통이면 충분해.'),
      riskBox,
      (() => { const dd = det('gen-prompt', 'AI에 보낼 내용 보기', false, 'plain'); dd.append(promptPre); return dd; })(),
      costBox, msg, goBtn,
      h('p', { class: 'hint' }, '버튼을 누를 때만 만들어. 한 번에 한 장씩, 같은 요청은 한 번만 보내.'));
      // 처음 채워 둔 설명·더 원하는 것을 고쳤으면 창 밖을 눌러도 안 닫힘 (안 고쳤으면 그냥 닫힘)
      if (ui.setSheetGuard) ui.setSheetGuard(() => clean(textTa.value) === clean(f0.text) && clean(extraTa.value) === clean(f0.extra));
    };
    // 창을 닫거나 다른 창을 열면(=만들기 버튼이 화면에서 사라지면) 기다리던 다시 보내기를 멈춤 — 사용자가 누르지 않은 생성이 시작되지 않게
    const alive = () => goBtn.isConnected;
    const wait = async (sec) => {
      for (let t = Math.max(1, Math.round(sec)); t > 0; t--) {
        if (!alive()) return false;
        put(msg, h('p', { class: 'hint' }, `서버가 다른 일을 마무리하는 중이야. ${t}초 뒤에 같은 요청으로 다시 보낼게 (돈은 아직 안 나갔어). 창을 닫으면 멈춰.`));
        await sleep(1000);
      }
      return alive();
    };
    const submit = async () => {
      if (busy) return;
      busy = true; update();
      put(msg, h('p', { class: 'hint' }, '보내는 중…'));
      const body = { request_key: rk, post_id: p.id, slot_key: s.key, mode, base_image_id: base ? base.id : undefined, purpose: f.purpose, ratio: f.ratio, style: f.style,
        text: clean(f.text), extra: clean(f.extra), quality: f.quality, confirm_usd: lastEst, generic_ok: genericChk.checked || undefined };
      let j = null;
      for (let attempt = 0; attempt < 4 && !j; attempt++) {
        try { j = await sendGenerate(body); } catch (e) {
          if (e && e.code === 'server_busy' && attempt < 3 && await wait(Number(e.retry_after) || 3)) continue;
          busy = false;
          if (!e || e.code === 'auth' || !alive()) return;
          if (e.code === 'estimate_changed') {
            // 서버가 계산한 값은 그 모델·크기·품질에만 씀 (품질을 바꾸면 화면 계산으로 돌아감)
            serverEst = { usd: Number(e.est_usd), key: `${e.model}|${e.size}|${e.quality}` };
            if (e.model && e.model !== model) newModel = String(e.model);
            toast(ui.errText(e), 4000);
            ui.load(); // 다른 기기에서 바꾼 설정·가격을 다시 받음
            update();
            return;
          }
          update();
          const again = e.code === 'timeout' || e.code === 'network';
          put(msg, h('p', { class: 'badbox' }, ui.errText(e)), ...((e.risks || []).map((r) => h('p', { class: 'badbox' }, r.msg))),
            again ? h('p', { class: 'hint' }, '다시 누르면 같은 요청 번호로 보내서, 서버가 이미 받았으면 그 결과를 보여줘 (두 번 만들지 않아).') : null);
          return;
        }
      }
      busy = false;
      if (!j) { update(); return; }
      if (!alive()) {
        // 보낸 뒤에 창을 닫았어도 서버는 이미 받아서 만들고 있음 → 이미지 칸에 '만드는 중'이 보이게 새로 받음
        if (j.generation && j.generation.status === '생성 중') toast('창을 닫았지만 서버에서 만드는 중이야. 끝나면 사진 자리에서 볼 수 있어.', 4000);
        refresh(p.id);
        return;
      }
      if (j.duplicate) toast('이미 받은 요청이야. 그 결과를 보여줄게.', 3000);
      progress(j.generation);
    };
    const progress = (gen) => {
      const t0 = Date.now();
      const timer = h('b', { class: 'num' }, '0초');
      let stop = false;
      openSheet(`${slotName(s)} — AI ${mode === 'edit' ? '고치기' : '만들기'}`,
        h('div', { class: 'genprog' }, h('i', { class: 'spin', 'aria-hidden': 'true' }), h('span', null, '만드는 중… '), timer),
        h('p', { class: 'hint' }, '보통 20초~1분, 길면 2분까지 걸려. 이 창을 닫아도 서버에서 계속 만들고, 끝나면 사진 자리에서 고를 수 있어.'));
      ui.setSheetOnClose(() => { stop = true; refresh(p.id); });
      const tick = setInterval(() => { if (!timer.isConnected) { clearInterval(tick); return; } timer.textContent = Math.round((Date.now() - t0) / 1000) + '초'; }, 1000);
      const poll = async () => {
        if (stop) return;
        let r;
        try { r = await api('/images/generations/' + gen.id); } catch (e) { if (e && e.code === 'auth') return; setTimeout(poll, 5000); return; }
        if (stop) return;
        const g = r.generation;
        if (g.status === '생성 중') { setTimeout(poll, Date.now() - t0 > 60e3 ? 5000 : 3000); return; }
        clearInterval(tick);
        rk = newKey(); serverEst = null;
        if (C[p.id] && C[p.id].data) C[p.id].data.usage = r.usage;
        if (g.status === '성공' && r.image) showResult(g, r.image); else showFail(g);
      };
      setTimeout(poll, 2500);
    };
    const showResult = (g, img) => {
      const c = genCost(g);
      openSheet(`${slotName(s)} — 다 만들었어`,
        thumb(img, null),
        h('div', { class: 'chips' }, kindChip(img), reviewChip(img)),
        h('p', { class: 'hint' }, `${g.model} · ${img.width}×${img.height} · 비용 ${usd(c.usd)} (${c.label})`),
        h('ul', { class: 'lic' }, h('li', null, '이미지 안에 글자·로고·가격이 생기지 않았는지'), h('li', null, '실제 상품 사진처럼 보이지 않는지 (이건 예시 삽화야)'), h('li', null, '사진 자리 설명과 맞는지')),
        h('p', { class: 'hint' }, "쓰기 전에 위를 확인해줘. 미리보기에서 '사용 가능'으로 바꾸면 검수 완료야."),
        btn(`이 이미지 쓰기 → ${slotName(s)}에 연결`, 'wide', async (ev) => { const j = await linkTo(p, s, img, ev.currentTarget, IMG.PURPOSES[g.purpose] ? { purpose: g.purpose } : null); if (j) closeSheet(); }),
        h('div', { class: 'go' }, btn('다시 만들기', 'sm ghost', () => { busy = false; form(); update(); }), btn('보관함에만 두고 닫기', 'sm ghost', closeSheet)));
      ui.setSheetOnClose(() => refresh(p.id));
    };
    const showFail = (g) => {
      const billed = g.cost_status === '청구 없음' ? '청구되지 않았을 거야.' : "청구됐을 수 있어. OpenAI 사용량 화면에서 확인하고, 이 글의 '이미지 생성 비용'에서 청구액을 넣어줘.";
      openSheet(`${slotName(s)} — 못 만들었어`,
        h('p', { class: 'badbox' }, g.error_message || '이유가 기록되지 않았어.'),
        h('p', { class: 'hint' }, billed),
        RETRYABLE.has(g.error_code) ? h('p', { class: 'hint' }, '잠깐 뒤에 다시 하면 될 수 있어.') : h('p', { class: 'hint' }, '같은 요청을 그대로 다시 보내도 안 될 거야. 설명이나 설정을 바꿔줘.'),
        h('div', { class: 'go' }, btn('고쳐서 다시 해보기', 'sm', () => { busy = false; form(); update(); }), btn('닫기', 'sm ghost', closeSheet)));
      ui.setSheetOnClose(() => refresh(p.id));
    };
    form();
    update();
  }

  // ═════════ 실제 사진 찾기 (Pexels) ═════════
  function stockSheet(p, s) {
    const d = dataOf(p.id) || {};
    const purpose = (s.row && s.row.purpose) || IMG.slotPurpose(s.key);
    const ratio = (s.row && s.row.crop && s.row.crop.ratio) || IMG.ratioOf(purpose);
    const title = `${slotName(s)} — 실제 사진 찾기`;
    if (d.keys && !d.keys.pexels) {
      openSheet(title, h('p', { class: 'notice' }, IMAGE_ERR.pexels_key_missing),
        h('p', { class: 'hint' }, 'Pexels는 지금 새 API 키 발급을 멈춰 둔 상태야 (2026-10-22 Pexels API 페이지 안내). 발급이 다시 열리면 설정 > 이미지 안내대로 넣으면 바로 돼.'),
        h('div', { class: 'go' }, btn('파일 올리기로', 'sm', () => uploadSheet(p, s)), btn('설정 보기', 'sm ghost', () => { closeSheet(); go('settings/images'); })));
      return;
    }
    const sugg = IMG.searchSuggestions(p, s);
    const q = h('input', { type: 'search', value: sugg[0] || '', placeholder: '예: 원룸 책상, small room desk', 'aria-label': '사진 검색어', enterkeyhint: 'search', maxlength: '100' });
    let orientation = IMG.orientationFor(ratio);
    const orSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '사진 방향' });
    const results = h('div', { class: 'stack' });
    let page = 1, items = [], sseq = 0, searching = false;
    const drawOr = () => put(orSeg, ...[['', '전체'], ['landscape', '가로'], ['portrait', '세로'], ['square', '정사각형']].map(([k, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(k === orientation), onclick: () => { orientation = k; drawOr(); search(1); } }, l)));
    drawOr();
    const credit = h('p', { class: 'hint' }, h('a', { href: 'https://www.pexels.com', target: '_blank', rel: 'noopener noreferrer' }, 'Photos provided by Pexels'), ' — 앱이 서버에서 대신 검색해 (키는 화면에 안 보임).');
    const searchView = [credit, h('p', { class: 'hint' }, s.n ? `사진 자리: ${s.text}` : s.label || ''),
      h('div', { class: 'chips' }, sugg.map((x) => h('button', { type: 'button', class: 'copy', onclick: () => { q.value = x; search(1); } }, x))),
      h('div', { class: 'searchrow' }, q, btn('검색', 'sm', () => search(1))), orSeg, results];
    const show = () => openSheet(title, ...searchView);
    const drawResults = (j) => {
      if (!items.length) { put(results, h('p', { class: 'notice' }, '검색 결과가 없어. 더 짧은 말이나 영어로 찾아봐 (예: room, desk, cleaning).')); return; }
      put(results, 
        h('div', { class: 'grid2' }, items.map((ph) => h('button', { type: 'button', class: 'pick', onclick: () => detail(ph) },
          h('img', { src: ph.thumb, alt: ph.alt || '사진', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }), h('small', null, ph.photographer)))),
        j.has_next ? btn('더 보기', 'sm ghost', (ev) => { if (searching) return; ev.currentTarget.disabled = true; search(page + 1); }) : null,
        h('p', { class: 'hint' }, `사진 ${j.total ? L.fmtNum(j.total) + '장 중 ' : ''}${items.length}장 · Pexels 남은 요청 ${j.remaining ?? '알 수 없음'}`));
    };
    // 검색을 빨리 여러 번 눌러도 마지막 검색 결과만 보여줌 (예전 응답은 버림 — 결과가 섞이지 않게)
    const search = async (pg) => {
      const qq = q.value.trim();
      if (!qq) { toast('검색어를 넣어줘'); return; }
      const my = ++sseq;
      searching = true;
      if (pg === 1) put(results, h('p', { class: 'hint' }, '찾는 중…'));
      try {
        const j = await api(`/stock/search?provider=pexels&q=${encodeURIComponent(qq)}&orientation=${encodeURIComponent(orientation)}&page=${pg}`);
        if (my !== sseq) return;
        page = pg; items = pg === 1 ? (j.photos || []) : items.concat(j.photos || []);
        drawResults(j);
      } catch (e) {
        if (my !== sseq || !e || e.code === 'auth') return;
        put(results, h('p', { class: 'badbox' }, ui.errText(e)), e.code === 'pexels_key_missing' ? btn('파일 올리기로', 'sm ghost', () => uploadSheet(p, s)) : null);
      } finally { if (my === sseq) searching = false; }
    };
    const detail = (ph) => {
      openSheet('사진 고르기',
        h('img', { class: 'big', src: ph.preview || ph.thumb, alt: ph.alt || '', referrerpolicy: 'no-referrer' }),
        h('p', null, 'Photo by ', ph.photographer_url ? h('a', { href: ph.photographer_url, target: '_blank', rel: 'noopener noreferrer' }, ph.photographer) : ph.photographer,
          ' on ', h('a', { href: ph.url, target: '_blank', rel: 'noopener noreferrer' }, 'Pexels')),
        h('ul', { class: 'lic' },
          h('li', null, 'Pexels 라이선스: 무료로 쓸 수 있고 고쳐 써도 돼. 출처 표시는 꼭은 아니지만 권장 — 글에 넣을 출처 문구(사진: 사진가 (Pexels))를 자동으로 만들어 둬.'),
          h('li', null, '안 되는 것: 사진 속 사람·브랜드가 내 상품을 추천·보증하는 것처럼 쓰기, 사진을 그대로 팔기, 다른 사진·배경화면 사이트에 다시 올리기, 사람을 나쁘게 보이게 쓰기.'),
          h('li', null, '실제 상품 사진이 아니야. 상품 모습이 중요한 자리에는 공식 이미지나 직접 찍은 사진을 써줘.')),
        h('div', { class: 'go' }, h('a', { class: 'copy', href: 'https://www.pexels.com/license/', target: '_blank', rel: 'noopener noreferrer' }, 'Pexels 라이선스 원문 ↗')),
        btn(`이 사진 쓰기 → ${slotName(s)}에 연결`, 'wide', async (ev) => {
          const j = await run(ev.currentTarget, () => api('/stock/select', { method: 'POST', body: { provider: 'pexels', photo_id: ph.id, post_id: p.id, slot_key: s.key, purpose, link: true } }));
          if (j) { toast(j.reused ? '이미 받아둔 사진이라 그걸 연결했어' : `${slotName(s)}에 연결했어`); closeSheet(); refresh(p.id); }
        }),
        btn('← 검색 결과로', 'sm ghost', show));
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(1); } });
    show();
    if (q.value) search(1);
  }

  // ═════════ 파일 올리기 ═════════
  function uploadSheet(p, s) {
    const purpose = (s.row && s.row.purpose) || IMG.slotPurpose(s.key);
    const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': '올릴 이미지 파일' });
    const pickLabel = h('span', null, '사진 고르기');
    const picker = h('label', { class: 'btn sm filebtn' }, pickLabel, input);
    const preview = h('div', { class: 'stack' });
    const rights = h('input', { type: 'checkbox' });
    const desc = h('input', { type: 'text', value: s.n ? IMG.altTextFor(s.text) : s.label || '', maxlength: '300' });
    let ready = null, prevUrl = null;
    const goBtn = btn(`올리고 ${slotName(s)}에 연결`, 'wide', () => send(), { disabled: true });
    const dropUrl = () => { if (prevUrl) { URL.revokeObjectURL(prevUrl); prevUrl = null; } };
    input.addEventListener('change', async () => {
      ready = null; goBtn.disabled = true; dropUrl();
      const file = input.files && input.files[0];
      if (!file) return;
      pickLabel.textContent = '다른 사진 고르기';
      put(preview, h('p', { class: 'hint' }, '확인하는 중…'));
      try { ready = await prepareUpload(file); } catch (e) { put(preview, h('p', { class: 'badbox' }, (e && e.message) || '이 파일은 올릴 수 없어.')); return; }
      const url = URL.createObjectURL(ready.blob);
      prevUrl = url;
      put(preview, h('img', { class: 'big', src: url, alt: '올릴 사진 미리보기' }),
        h('span', { class: 'hint' }, `${ready.w}×${ready.h} · ${fmtBytes(ready.blob.size)} · ${typeName(ready.blob.type)}${ready.resized ? ` · 원본 ${ready.original.w}×${ready.original.h}에서 줄였어` : ''} · 촬영 위치 같은 숨은 정보는 빼고 올려`));
      goBtn.disabled = false;
    });
    const send = async () => {
      if (!ready) return;
      if (!rights.checked) { toast(IMAGE_ERR.rights_required); return; }
      const fd = new FormData();
      fd.append('meta', JSON.stringify({ post_id: p.id, slot_key: s.key, purpose, rights: true, description: desc.value.trim(), link: true }));
      fd.append('file', ready.blob, ready.name);
      const j = await run(goBtn, () => api('/images/upload', { method: 'POST', body: fd }).catch((e) => {
        throw e && e.code === 'too_large' ? { code: 'bad_image', reason: 'too_big' } : e; // 이미지는 '나눠서 올려줘'가 아니라 크기 안내로
      }));
      if (j) { dropUrl(); toast(j.reused ? '같은 사진이 보관함에 있어서 그걸 연결했어' : `${slotName(s)}에 연결했어`); closeSheet(); refresh(p.id); }
    };
    openSheet(`${slotName(s)} — 파일 올리기`,
      h('p', { class: 'hint' }, 'JPEG·PNG·WebP만, 한 장 8MB까지 (큰 사진은 올리기 전에 자동으로 줄여). GIF·HEIC·SVG는 안 돼.'),
      h('div', { class: 'go' }, picker), preview,
      h('label', { class: 'chk' }, rights, '내가 찍었거나 쓸 권한이 있는 사진이야'),
      h('p', { class: 'notice' }, '다른 사람 사진·인터넷에서 받은 사진은 저작권자 허락이 있어야 써. 상품 공식 이미지는 판매처·제조사의 이용 조건을 먼저 확인해줘.'),
      field('사진 설명 (대체 텍스트)', desc),
      goBtn);
    ui.setSheetOnClose(dropUrl);
    if (ui.setSheetGuard) ui.setSheetGuard(() => !ready);
  }

  // ═════════ 보관함에서 고르기 ═════════
  function pickSheet(p, s) {
    const d = dataOf(p.id) || {};
    const mine = (d.images || []).filter((i) => !i.deleted_at);
    let tab = mine.length ? 'mine' : 'all';
    const seg = h('div', { class: 'seg', role: 'group' });
    const box = h('div', { class: 'stack' });
    let next = null, all = [], lseq = 0;
    const choose = async (img, ev) => { const j = await linkTo(p, s, img, ev.currentTarget); if (j) closeSheet(); };
    const grid = (list) => (list.length ? h('div', { class: 'grid3' }, list.map((i) => pickThumb(i, (ev) => choose(i, ev)))) : h('p', { class: 'hint' }, '이미지가 없어.'));
    // 탭을 빨리 바꿔도 늦게 온 응답이 다른 탭을 덮지 않게
    const loadAll = async (more, button) => {
      const my = ++lseq;
      if (button) button.disabled = true;
      if (!more) put(box, h('p', { class: 'hint' }, '불러오는 중…'));
      try {
        const j = await api('/images' + (more && next ? '?before=' + encodeURIComponent(next) : ''));
        if (my !== lseq || tab !== 'all') return;
        all = more ? all.concat(j.images) : j.images; next = j.next;
        put(box, grid(all), next ? btn('더 보기', 'sm ghost', (ev) => loadAll(true, ev.currentTarget)) : null);
      } catch (e) { if (my === lseq && e && e.code !== 'auth') put(box, h('p', { class: 'hint' }, ui.errText(e))); }
    };
    const draw = () => {
      put(seg, ...[['mine', `이 글 이미지 ${mine.length}`], ['all', '보관함 전체']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(k === tab), onclick: () => { tab = k; draw(); } }, l)));
      if (tab === 'mine') { lseq++; put(box, grid(mine)); } else loadAll(false);
    };
    openSheet(`${slotName(s)} — 보관함에서 고르기`, h('p', { class: 'hint' }, '같은 이미지를 여러 자리·여러 원고에 써도 돼.'), seg, box);
    draw();
  }

  // ═════════ 미리보기·자르기·검수·내려받기 ═════════
  function previewSheet(p, s) {
    const d = dataOf(p.id);
    if (!d) return;
    const row = s.row;
    const img = row && imgsOf(p.id)[row.image_id];
    if (!img) return;
    const g = genOf(d, img);
    let purpose = (row.purpose && IMG.PURPOSES[row.purpose]) ? row.purpose : IMG.slotPurpose(s.key);
    let ratio = (row.crop && row.crop.ratio) || IMG.defaultRatio(img, purpose);
    let focus = row.crop ? { x: Number(row.crop.x), y: Number(row.crop.y) } : { x: 0.5, y: 0.5 };
    const pic = h('img', { src: img.url, alt: img.alt_text || '' });
    const win = h('div', { class: 'win', 'aria-hidden': 'true' });
    const wrap = h('div', { class: 'crop', role: 'button', tabindex: '0', 'aria-label': '사진을 눌러 가운데 둘 곳 정하기' }, pic, win);
    const cropNote = h('p', { class: 'hint' });
    const dims = () => [pic.naturalWidth || img.width, pic.naturalHeight || img.height];
    const place = () => {
      const [W, H] = dims();
      if (!W || !H) { win.hidden = true; return; }
      const need = !IMG.sameRatio(W, H, ratio);
      win.hidden = !need;
      cropNote.textContent = need ? `${ratio}로 자를 곳이 밝게 보여. 중요한 부분이 밝은 칸 안에 들어오게 사진을 눌러서 맞춰줘.` : `이미 ${ratio} 비율이라 자르지 않아.`;
      if (!need) return;
      const r = IMG.cropRect(W, H, ratio, focus);
      win.style.left = (r.x / W) * 100 + '%'; win.style.top = (r.y / H) * 100 + '%';
      win.style.width = (r.w / W) * 100 + '%'; win.style.height = (r.h / H) * 100 + '%';
    };
    // 원본은 이 창에서 한 번만 받아서 풀어 둠 (자르는 곳을 바꿀 때마다 다시 받지 않게)
    let srcP = null;
    const source = () => (srcP ||= loadSource(img).catch((e) => { srcP = null; throw e; }));
    let prepTimer = null;
    const prepareSoon = () => { clearTimeout(prepTimer); prepTimer = setTimeout(() => prepare(), 250); };
    pic.addEventListener('load', () => { place(); prepareSoon(); });
    let cropDirty = false;
    // 저장하면 지금 화면의 기록(캐시)에도 바로 넣음 — 다른 동작으로 기록이 새로 바뀌어도 잃지 않게
    const applySlot = (sl) => {
      if (!sl) return;
      row.crop = sl.crop; row.purpose = sl.purpose;
      const cur = dataOf(p.id) || {};
      for (const x of [...(cur.slots || []), ...(cur.extra || [])]) if (x.key === s.key && x.row) { x.row.crop = sl.crop; x.row.purpose = sl.purpose; }
    };
    const saveSlot = () => api(`/posts/${p.id}/images/slot`, { method: 'POST', body: { slot_key: s.key, crop: { ratio, x: focus.x, y: focus.y }, purpose } })
      .then((j) => { cropDirty = false; saveCrop.disabled = true; applySlot(j.slot); refresh(p.id); return j; });
    const saveCrop = btn('자르는 곳 저장', 'sm ghost', (ev) => run(ev.currentTarget, saveSlot, '저장했어 — 내려받을 때 이대로 잘라'), { disabled: true });
    const dirtyCrop = () => { cropDirty = true; saveCrop.disabled = false; place(); prepareSoon(); };
    wrap.addEventListener('click', (e) => {
      const b = pic.getBoundingClientRect();
      if (!b.width || !b.height) return;
      focus = { x: clamp((e.clientX - b.left) / b.width), y: clamp((e.clientY - b.top) / b.height) };
      dirtyCrop();
    });
    wrap.addEventListener('keydown', (e) => {
      const step = 0.05;
      const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!k) return;
      e.preventDefault();
      focus = { x: clamp(focus.x + k[0]), y: clamp(focus.y + k[1]) };
      dirtyCrop();
    });
    const purposeSel = h('select', { value: purpose }, Object.entries(IMG.PURPOSES).map(([k, v]) => opt(k, v.label)));
    const ratioSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '비율' });
    const drawRatio = () => put(ratioSeg, ...IMG.PURPOSES[purpose].ratios.map((r) =>
      h('button', { type: 'button', 'aria-pressed': String(r === ratio), onclick: () => { ratio = r; drawRatio(); dirtyCrop(); } }, r)));
    purposeSel.addEventListener('change', () => { purpose = purposeSel.value; ratio = IMG.ratioOf(purpose, ratio); drawRatio(); dirtyCrop(); });
    drawRatio();
    // 검수
    const reviewSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '검수 상태' });
    const drawReview = () => put(reviewSeg, ...['검수 전', '사용 가능', '사용 안 함'].map((v) =>
      h('button', { type: 'button', 'aria-pressed': String(v === img.review_status), onclick: async (ev) => {
        const j = await run(ev.currentTarget, () => api('/images/' + img.id, { method: 'POST', body: { review_status: v } }), `'${v}'(으)로 바꿨어`);
        if (j) { img.review_status = v; drawReview(); syncDl(); refresh(p.id); }
      } }, v)));
    drawReview();
    const alt = h('input', { type: 'text', value: img.alt_text || '', maxlength: '300' });
    // 내려받기 (열자마자 파일을 준비해 둠 → 누르면 바로 저장·공유 창)
    const fileName = () => IMG.fileNameFor(p, s.n || (IMG.extraSlot(s.key) || {}).file || 'image', s.n ? purpose : '', outExt(img));
    const dlBtn = btn('파일 준비 중…', 'wide', () => save(), { disabled: true });
    const outInfo = h('span', { class: 'hint' });
    let file = null, seq = 0;
    const syncDl = () => {
      if (img.review_status === '사용 안 함') { dlBtn.disabled = true; dlBtn.textContent = "'사용 안 함' 이미지는 내려받지 않아"; return; }
      if (!file) return;
      dlBtn.disabled = false;
      dlBtn.textContent = img.review_status === '검수 전' ? `검수 완료하고 내려받기 · ${file.name}` : `내려받기 · ${file.name}`;
    };
    const prepare = async () => {
      const my = ++seq;
      file = null; dlBtn.disabled = true; dlBtn.textContent = '파일 준비 중…';
      try {
        const f = await renderOutput(img, { ratio, focus, purpose, name: fileName() }, await source());
        if (my !== seq) return;
        file = f;
        outInfo.textContent = `내려받을 파일: ${f.w}×${f.h} · ${fmtBytes(f.size)}`;
        syncDl();
      } catch {
        if (my !== seq) return;
        dlBtn.textContent = '파일을 만들지 못했어';
        outInfo.textContent = '이미지를 불러오지 못했어. 새로고침한 뒤 다시 해줘 (주소는 1시간 동안만 열려).';
      }
    };
    const save = async () => {
      if (!file) return;
      const reviewNow = img.review_status === '검수 전';
      const pending = saveFiles([file], file.name); // 누른 순간에 바로 (휴대폰 공유 창은 바로 열어야 함)
      if (reviewNow) api('/images/' + img.id, { method: 'POST', body: { review_status: '사용 가능' } }).then(() => { img.review_status = '사용 가능'; drawReview(); syncDl(); }).catch(() => {});
      // 저장 안 한 자르기·용도로 내려받았으면 그것도 저장 (복사한 글의 파일 이름·크기와 맞게)
      if (cropDirty) saveSlot().catch(() => {});
      const r = await pending;
      if (r === 'cancelled') return;
      api('/images/downloaded', { method: 'POST', body: { items: [{ image_id: img.id, post_id: p.id, slot_key: s.key }] } }).then(() => refresh(p.id)).catch(() => {});
      toast(r === 'shared' ? "저장했어. 블로그에 붙여넣은 뒤 '" + slotName(s) + "' 자리에 넣어줘." : `내려받았어 (${file.name})`, 4000);
    };
    const info = [];
    info.push(h('div', { class: 'chips' }, kindChip(img), reviewChip(img)));
    if (img.kind === 'ai') {
      const c = genCost(g);
      info.push(h('p', { class: 'hint' }, `AI 생성 · ${img.model}${g ? ' · ' + g.size + ' · 품질 ' + (IMG.QUALITY_LABEL[g.quality] || g.quality) : ''}${c ? ` · 비용 ${usd(c.usd)} (${c.label})` : ''}`));
      info.push(h('ul', { class: 'lic' }, h('li', null, '글자·로고·가격이 생기지 않았는지'), h('li', null, '실제 상품 사진처럼 보이지 않는지 (예시 삽화야)'), h('li', null, '사진 자리 설명과 맞는지')));
      const dd = det('img-prompt:' + img.id, 'AI에 보낸 내용(프롬프트) 보기', false, 'plain');
      dd.append(h('pre', { class: 'prompt' }, img.prompt || ''));
      info.push(dd);
      info.push(h('p', { class: 'hint' }, "블로그에 올릴 때 '※ AI로 만든 예시 이미지'를 사진 아래에 같이 넣어줘 (복사할 때 자동으로 들어가)."));
    } else if (img.kind === 'stock') {
      info.push(h('p', null, 'Photo by ', img.author_url ? h('a', { href: img.author_url, target: '_blank', rel: 'noopener noreferrer' }, img.author_name || '사진가') : (img.author_name || '사진가'),
        ' on ', img.source_url ? h('a', { href: img.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'Pexels') : 'Pexels'));
      info.push(h('p', { class: 'hint' }, `라이선스: ${img.license}`), h('div', { class: 'go' }, h('span', { class: 'sns' }, img.attribution_text), h('button', { type: 'button', class: 'copy', onclick: (ev) => ui.copyPlain(img.attribution_text, ev.currentTarget) }, '출처 문구 복사')));
    } else if (img.kind === 'upload') info.push(h('p', { class: 'hint' }, '직접 올린 사진 · 쓸 권한이 있다고 확인함'));
    else info.push(h('p', { class: 'hint' }, `카드뉴스에서 만든 이미지${img.license && img.license.includes('배경') ? ' · ' + img.license.replace(/^카드뉴스 \(앱에서 직접 만듦\)\s*·\s*/, '') : ''}`));
    info.push(h('p', { class: 'hint' }, `원본 ${img.width}×${img.height} · ${fmtBytes(img.bytes)} · ${L.fmtTime(img.created_at)}${img.used_posts > 1 ? ` · 다른 원고 ${img.used_posts - 1}곳에서도 사용 중` : ''}`));
    const altSaved = () => alt.value.trim() === String(img.alt_text || '').trim();
    openSheet(`${slotName(s)} 미리보기`,
      // 내려받기 버튼을 사진보다 위에 (세로로 긴 사진이 휴대폰 화면을 다 덮어도 바로 보이게)
      dlBtn, outInfo,
      wrap, cropNote,
      h('div', { class: 'row' }, field('용도', purposeSel)), h('p', { class: 'legend' }, '비율'), ratioSeg,
      h('div', { class: 'go' }, saveCrop),
      h('p', { class: 'legend' }, '검수'), reviewSeg,
      ...info,
      field('대체 텍스트 (사진 설명)', alt, '블로그 에디터에 사진 설명을 넣는 칸이 있으면 이걸 넣어줘. 고치고 창을 닫으면 저절로 저장돼.'),
      h('div', { class: 'go' }, btn('대체 텍스트 저장', 'sm ghost', async (ev) => {
        const j = await run(ev.currentTarget, () => api('/images/' + img.id, { method: 'POST', body: { alt_text: alt.value.trim() } }), '저장했어');
        if (j) img.alt_text = alt.value.trim();
      }), h('button', { type: 'button', class: 'copy', onclick: (ev) => ui.copyPlain(alt.value.trim(), ev.currentTarget) }, '복사')),
      h('div', { class: 'go' }, btn(row.used_at ? '사용 완료 취소' : '블로그에 넣었어 (사용 완료)', 'sm ghost', async (ev) => { await markUsed(p, s, !row.used_at, ev.currentTarget); closeSheet(); })));
    ui.setSheetOnClose(() => {
      clearTimeout(prepTimer); seq++;
      if (cropDirty) toast('자르는 곳은 저장하지 않았어');
      if (!altSaved()) {
        const v = alt.value.trim();
        api('/images/' + img.id, { method: 'POST', body: { alt_text: v } }).then(() => { img.alt_text = v; toast('대체 텍스트도 저장했어'); }).catch(() => toast('대체 텍스트를 저장하지 못했어'));
      }
    });
    if (pic.complete && pic.naturalWidth) { place(); prepareSoon(); }
  }

  // 파일 저장: 휴대폰은 공유 창(사진에 저장), 컴퓨터는 내려받기 (여러 장이면 ZIP)
  async function saveFiles(files, zipName) {
    if (MOBILE && navigator.share && navigator.canShare) {
      let can = false;
      try { can = navigator.canShare({ files }); } catch { can = false; }
      if (can) {
        try { await navigator.share({ files }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
      }
    }
    if (files.length === 1) { blobDownload(files[0], files[0].name); return 'downloaded'; }
    const parts = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    blobDownload(new Blob([L.makeZip(parts)], { type: 'application/zip' }), zipName);
    return 'downloaded';
  }
  function blobDownload(blob, name) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
  function downloadAllSheet(p) {
    const d = dataOf(p.id);
    if (!d) return;
    const imgs = byId(d.images);
    const list = [...(d.slots || []), ...(d.extra || []).map((x) => ({ key: x.key, n: 0, text: x.label, label: x.label, row: x.row }))]
      .filter((s) => s.row && s.row.image_id && imgs[s.row.image_id] && imgs[s.row.image_id].review_status !== '사용 안 함');
    const status = h('p', { class: 'hint' }, `${list.length}장 준비 중…`);
    const files = [];
    const saveBtn = btn('준비 중…', 'wide', () => save(), { disabled: true });
    const unrev = list.filter((s) => imgs[s.row.image_id].review_status === '검수 전').length;
    openSheet('모두 내려받기',
      h('p', { class: 'hint' }, '사진 자리 순서대로 파일 이름에 번호가 붙어 (예: 키워드-01-blog_body.jpg). 자르는 곳을 저장한 사진은 그 비율로 잘라서 받아.'),
      unrev ? h('p', { class: 'notice' }, `아직 검수하지 않은 이미지가 ${unrev}장 있어. 받은 뒤에도 글·로고·실제 상품처럼 보이는지 꼭 확인해줘.`) : null,
      status, saveBtn);
    (async () => {
      let failed = 0;
      for (const [i, s] of list.entries()) {
        if (!saveBtn.isConnected) return; // 창을 닫으면 그만 받음 (휴대폰 데이터 아끼기)
        status.textContent = `${i + 1}/${list.length} 준비 중…`;
        const img = imgs[s.row.image_id];
        const purpose = (s.row.purpose && IMG.PURPOSES[s.row.purpose]) ? s.row.purpose : IMG.slotPurpose(s.key);
        const ratio = (s.row.crop && s.row.crop.ratio) || IMG.defaultRatio(img, purpose);
        const focus = s.row.crop ? { x: Number(s.row.crop.x), y: Number(s.row.crop.y) } : { x: 0.5, y: 0.5 };
        try { files.push({ s, img, file: await renderOutput(img, { ratio, focus, purpose, name: IMG.fileNameFor(p, s.n || (IMG.extraSlot(s.key) || {}).file || 'image', s.n ? purpose : '', outExt(img)) }) }); } catch { failed++; }
      }
      if (!saveBtn.isConnected) return;
      status.textContent = `${files.length}장 준비됐어${failed ? ` (${failed}장은 불러오지 못했어 — 새로고침 후 다시 해줘)` : ''}`;
      saveBtn.disabled = !files.length;
      saveBtn.textContent = MOBILE ? `사진 ${files.length}장 저장하기` : files.length > 1 ? `ZIP으로 받기 (${files.length}장)` : '내려받기';
    })();
    const save = async () => {
      const r = await saveFiles(files.map((x) => x.file), IMG.fileNameFor(p, 'images', '', 'zip'));
      if (r === 'cancelled') return;
      // 서버는 한 번에 40개까지 받아서 나눠 보냄
      const items = files.map((x) => ({ image_id: x.img.id, post_id: p.id, slot_key: x.s.key }));
      const sends = [];
      for (let i = 0; i < items.length; i += 40) sends.push(api('/images/downloaded', { method: 'POST', body: { items: items.slice(i, i + 40) } }));
      Promise.all(sends).then(() => refresh(p.id)).catch(() => {});
      toast(r === 'shared' ? '저장했어. 순서대로 블로그 사진 자리에 넣어줘.' : '내려받았어', 4000);
    };
  }

  // ═════════ 카드뉴스 ═════════
  function viewCards(p) {
    const box = h('div', { class: 'view' });
    box.append(btn('← 원고', 'sm ghost back', () => go('content/post/' + p.id)));
    box.append(h('section', { class: 'panel hi' }, h('h2', null, '카드뉴스 만들기'), h('p', { class: 'hint' }, ui.titleOf(p)),
      h('p', { class: 'hint' }, '글자는 이미지 AI가 아니라 앱이 직접 그려 (글자 깨짐 없음). 원고에 있는 사실만 넣고, 저장하기 전에 고쳐줘. Canva 연결은 아직 없어.')));
    const body = h('div', { class: 'stack' }, h('p', { class: 'hint' }, '불러오는 중…'));
    box.append(body);
    fetchPost(p.id, !fresh(C[p.id], p)).then((d) => { if (body.isConnected) drawCards(body, p, d); }).catch((e) => { if (e && e.code !== 'auth' && body.isConnected) put(body, h('p', { class: 'hint' }, ui.errText(e))); });
    return box;
  }
  function initialDeck(p, d) {
    if (d.deck) return { template: d.deck.template, ratio: d.deck.ratio, ad_label: d.deck.ad_label, bg_image_id: d.deck.bg_image_id, slides: (d.deck.slides || []).map((x) => ({ title: x.title || '', text: x.text || '', icon: x.icon || '' })), saved: true };
    const draft = IMG.deckFromPost(p, { max: 8 });
    return { template: 'clean', ratio: '4:5', ad_label: !!L.snsDisclosure(p, ui.programs()), bg_image_id: null, slides: draft.slides.map((x) => ({ ...x, icon: '' })), saved: false, source: draft.source };
  }
  function drawCards(body, p, d) {
    const dk = drafts[p.id] || (drafts[p.id] = initialDeck(p, d));
    const imgs = byId(d.images);
    let prepared = null;
    const pngBtn = btn('PNG 파일 만들기', 'sm ghost', () => (prepared ? savePrepared() : prepareAll()));
    const resetPng = () => { prepared = null; pngBtn.disabled = false; pngBtn.textContent = 'PNG 파일 만들기'; };
    const changed = () => { dk.saved = false; ui.markDirty(); schedule(); resetPng(); };
    const tplSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '템플릿' });
    const ratioSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '비율' });
    const drawSegs = () => {
      put(tplSeg, ...Object.entries(IMG.CARD_TEMPLATES).map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(k === dk.template), onclick: () => { dk.template = k; drawSegs(); changed(); } }, l)));
      put(ratioSeg, ...IMG.CARD_RATIOS.map((r) => h('button', { type: 'button', 'aria-pressed': String(r === dk.ratio), onclick: () => { dk.ratio = r; drawSegs(); changed(); } }, r === '1:1' ? '정사각형 1:1' : '세로 4:5')));
    };
    drawSegs();
    const ad = h('input', { type: 'checkbox', checked: !!dk.ad_label, onchange: (e) => { dk.ad_label = e.target.checked; changed(); } });
    const bgBox = h('div', { class: 'grid3' });
    const bgNote = h('div');
    // '사용 안 함'으로 표시한 이미지는 배경 후보에서 뺌
    const bgChoices = (d.images || []).filter((i) => i.kind !== 'card' && (i.review_status !== '사용 안 함' || i.id === dk.bg_image_id));
    const drawBg = () => {
      put(bgBox,
        h('button', { type: 'button', class: 'pick' + (!dk.bg_image_id ? ' sel' : ''), onclick: () => { dk.bg_image_id = null; drawBg(); changed(); } }, h('span', { class: 'ph' }, '배경 없음'), h('small', null, '표지 배경')),
        ...bgChoices.map((i) => { const b = pickThumb(i, () => { dk.bg_image_id = i.id; drawBg(); changed(); }); if (dk.bg_image_id === i.id) b.classList.add('sel'); return b; }));
      const cur = dk.bg_image_id ? imgs[dk.bg_image_id] : null;
      put(bgNote,
        cur && cur.kind === 'ai' ? h('p', { class: 'notice' }, "AI로 만든 배경이야. 인스타에 올릴 때 캡션에 'AI로 만든 이미지'라고 같이 적어줘 (실제 사진처럼 보이지 않게).") : null,
        cur && cur.kind === 'stock' ? h('p', { class: 'hint' }, `배경 사진: ${cur.attribution_text || 'Pexels'} — 캡션에 출처를 같이 적으면 좋아.`) : null,
        cur && cur.review_status === '사용 안 함' ? h('p', { class: 'badbox' }, "'사용 안 함'으로 표시한 이미지야. 다른 배경을 골라줘.") : null);
    };
    drawBg();
    const list = h('div', { class: 'stack' });
    const drawList = () => {
      put(list, ...dk.slides.map((sl, i) => {
        const t = h('input', { type: 'text', value: sl.title, maxlength: String(IMG.CARD_LIMITS.title), 'aria-label': `${i + 1}장 제목`, oninput: (e) => { sl.title = e.target.value; changed(); } });
        const x = h('textarea', { value: sl.text, maxlength: String(IMG.CARD_LIMITS.text), style: 'min-height:70px', 'aria-label': `${i + 1}장 내용`, oninput: (e) => { sl.text = e.target.value; changed(); } });
        const ic = h('select', { value: sl.icon || '', 'aria-label': `${i + 1}장 아이콘`, onchange: (e) => { sl.icon = e.target.value; changed(); } }, Object.entries(IMG.CARD_ICONS).map(([k, l]) => opt(k, l)));
        const move = (dir) => { const j = i + dir; if (j < 0 || j >= dk.slides.length) return; [dk.slides[i], dk.slides[j]] = [dk.slides[j], dk.slides[i]]; drawList(); changed(); };
        return h('div', { class: 'slot' },
          h('div', { class: 'split' }, h('b', null, i === 0 ? '1장 (표지)' : `${i + 1}장`),
            h('span', { class: 'go' }, btn('↑', 'sm ghost', () => move(-1), { disabled: i === 0, 'aria-label': '위로' }), btn('↓', 'sm ghost', () => move(1), { disabled: i === dk.slides.length - 1, 'aria-label': '아래로' }),
              btn('빼기', 'sm ghost', () => { if (dk.slides.length <= 1) { toast('한 장은 있어야 해'); return; } dk.slides.splice(i, 1); drawList(); changed(); }))),
          field('제목', t), field(i === 0 ? '부제 (선택)' : '내용', x, i === 0 ? '' : '한 장에 2~3줄이 보기 좋아. 줄을 바꾸면 그대로 줄이 바뀌어.'), i === 0 ? null : field('아이콘', ic));
      }), h('div', { class: 'go' },
        btn('+ 장 추가', 'sm ghost', () => { if (dk.slides.length >= IMG.CARD_LIMITS.slides) { toast(`${IMG.CARD_LIMITS.slides}장까지 만들 수 있어`); return; } dk.slides.push({ title: '', text: '', icon: '' }); drawList(); changed(); }),
        btn('원고에서 다시 뽑기', 'sm ghost', (ev) => { if (!confirmBox(ev.currentTarget, '지금 문구를 바꿀까?')) return; const fresh2 = initialDeck(p, { ...d, deck: null }); dk.slides = fresh2.slides; drawList(); changed(); })));
    };
    drawList();
    const previews = h('div', { class: 'cardgrid' });
    const overflowNote = h('div');
    let timer = null, bgEl = null, bgFor = null;
    const getBg = async () => {
      if (!dk.bg_image_id) return null;
      if (bgFor === dk.bg_image_id) return bgEl;
      const im = imgs[dk.bg_image_id];
      if (!im || !im.url) return null;
      try { const r = await fetch(im.url, { mode: 'cors', credentials: 'omit' }); bgEl = await loadImg(await r.blob()); bgFor = dk.bg_image_id; } catch { bgEl = null; bgFor = dk.bg_image_id; toast('배경 이미지를 불러오지 못했어. 새로고침 후 다시 해줘.'); }
      return bgEl;
    };
    const adText = () => '광고';
    const allText = () => dk.slides.map((x) => `${x.title}${x.text}`).join('');
    // 장마다 캔버스를 하나씩 두고 다시 씀 (글자를 칠 때마다 새로 만들지 않게 — 휴대폰 메모리)
    const figs = [];
    const paint = async () => {
      await ensureFonts(allText());
      const bg = await getBg();
      const deck = { ...dk };
      const over = [];
      figs.length = Math.min(figs.length, dk.slides.length);
      for (let i = 0; i < dk.slides.length; i++) {
        if (!figs[i]) {
          const cv = document.createElement('canvas');
          figs[i] = { cv, el: h('figure', { class: 'card-prev' }, cv, h('figcaption', { class: 'go' }, h('span', { class: 'hint' }, `${i + 1}장`),
            h('button', { type: 'button', class: 'copy', onclick: (ev) => saveSlideToLibrary(p, dk, i, ev.currentTarget) }, '이 장 보관함에 저장'))) };
        }
        const r = renderSlide(figs[i].cv, deck, i, { scale: 0.5, bg, adText: adText() });
        if (r.overflow) over.push(i + 1);
      }
      put(previews, ...figs.map((f) => f.el));
      put(overflowNote, over.length ? h('p', { class: 'notice' }, `${over.join(', ')}장은 글자가 많아서 잘렸어. 줄여줘.`) : '');
    };
    // 글꼴이 늦게 내려오면 그때 다시 그림
    // (카드뉴스 화면을 여러 번 열어도 듣는 함수는 하나만 — 앞의 것은 뗌)
    const onFonts = () => {
      if (!previews.isConnected) { document.fonts.removeEventListener('loadingdone', onFonts); if (fontsListener === onFonts) fontsListener = null; return; }
      schedule();
    };
    if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
      if (fontsListener) document.fonts.removeEventListener('loadingdone', fontsListener);
      fontsListener = onFonts;
      document.fonts.addEventListener('loadingdone', onFonts);
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(paint, 250); };
    const prepareAll = async () => {
      pngBtn.disabled = true; pngBtn.textContent = '만드는 중…';
      try {
        await ensureFonts(allText());
        const bg = await getBg();
        const files = [];
        const cv = document.createElement('canvas');
        for (let i = 0; i < dk.slides.length; i++) {
          renderSlide(cv, dk, i, { scale: 1, bg, adText: adText() });
          files.push(fileOf(await canvasToBlob(cv, 'image/png'), IMG.fileNameFor(p, `card-${String(i + 1).padStart(2, '0')}`, '', 'png'), cv.width, cv.height));
        }
        cv.width = 0; cv.height = 0;
        if (!pngBtn.isConnected) return;
        prepared = files;
        pngBtn.disabled = false;
        pngBtn.textContent = MOBILE ? `카드 ${files.length}장 저장하기` : files.length > 1 ? `ZIP으로 받기 (${files.length}장)` : 'PNG 내려받기';
      } catch { toast('카드를 만들지 못했어'); resetPng(); }
    };
    const savePrepared = async () => {
      const r = await saveFiles(prepared, IMG.fileNameFor(p, 'cards', '', 'zip'));
      if (r !== 'cancelled') toast(r === 'shared' ? '저장했어. 인스타그램에는 직접 올려줘.' : '내려받았어');
    };
    const saveDeck = btn('저장', 'sm', async (ev) => {
      const body2 = { template: dk.template, ratio: dk.ratio, ad_label: dk.ad_label, bg_image_id: dk.bg_image_id || null, slides: dk.slides.map((x) => ({ title: x.title.trim(), text: x.text.trim(), icon: x.icon || '' })) };
      if (!body2.slides.some((x) => x.title || x.text)) { toast('문구를 하나 이상 넣어줘'); return; }
      const j = await run(ev.currentTarget, () => api(`/posts/${p.id}/cards`, { method: 'POST', body: body2 }), '카드뉴스를 저장했어');
      if (j) { dk.saved = true; ui.clearDirty(); if (C[p.id] && C[p.id].data) C[p.id].data.deck = j.deck; }
    });
    const disc = L.snsDisclosure(p, ui.programs());
    put(body, 
      h('section', { class: 'panel' }, h('h2', null, '모양'), h('p', { class: 'legend' }, '템플릿'), tplSeg, h('p', { class: 'legend' }, '비율'), ratioSeg,
        h('label', { class: 'chk' }, ad, '첫 장에 광고 표시'),
        disc ? h('p', { class: 'hint' }, '제휴·협찬 글이라 켜 두는 게 좋아. 인스타에 올릴 때 캡션 첫 줄에도 고지문을 넣어줘 (원고의 인스타 캡션 복사 버튼이 자동으로 넣어줘).') : null,
        h('p', { class: 'legend' }, '표지 배경 (이 글의 이미지)'), bgBox, bgNote),
      h('section', { class: 'panel' }, h('h2', null, `문구 (${dk.slides.length}장)`),
        !dk.saved && dk.source === 'body' && !d.deck ? h('p', { class: 'notice' }, '원고의 소제목·목록에서 뽑은 초안이야. 사실과 맞는지 보고 고쳐줘. 채널별 버전에서 카드뉴스 문구를 만들면 그걸로 시작해.') : null, list),
      h('section', { class: 'panel' }, h('h2', null, '미리보기'), overflowNote, previews,
        h('div', { class: 'go' }, saveDeck, pngBtn),
        h('p', { class: 'hint' }, '휴대폰은 공유 창에서 사진에 저장, 컴퓨터는 ZIP으로 받아져. 인스타그램에는 직접 올려줘 (앱이 대신 올리지 않아).')));
    paint();
  }
  async function saveSlideToLibrary(p, dk, i, button) {
    await run(button, async () => {
      await ensureFonts(dk.slides.map((x) => `${x.title}${x.text}`).join(''));
      const cv = document.createElement('canvas');
      let bg = null; // 표지 배경이 있으면 미리보기와 같게 그림 (배경은 1장에만)
      if (dk.bg_image_id && i === 0) {
        const im = imgsOf(p.id)[dk.bg_image_id];
        if (im && im.url) { try { const r = await fetch(im.url, { mode: 'cors', credentials: 'omit' }); bg = await loadImg(await r.blob()); } catch { bg = null; } }
      }
      renderSlide(cv, dk, i, { scale: 1, bg, adText: '광고' });
      const blob = await canvasToBlob(cv, 'image/png');
      const fd = new FormData();
      // 배경으로 쓴 이미지를 알려줘서 출처(사진가·AI 여부)를 카드 기록에도 남김
      fd.append('meta', JSON.stringify({ kind: 'card', post_id: p.id, description: `카드뉴스 ${i + 1}장 · ${dk.slides[i].title || ''}`.trim(), bg_image_id: i === 0 && bg ? dk.bg_image_id : undefined }));
      fd.append('file', blob, `card-${i + 1}.png`);
      const j = await api('/images/upload', { method: 'POST', body: fd });
      await fetchPost(p.id, true).catch(() => {});
      return j;
    }, '보관함에 저장했어 — 인스타 피드 같은 자리에 연결할 수 있어');
  }

  // ═════════ 보관함 ═════════
  function viewLibrary() {
    const box = h('div', { class: 'view' });
    box.append(btn('← 콘텐츠', 'sm ghost back', () => go('content')));
    const pnl = h('section', { class: 'panel' });
    box.append(pnl);
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '종류' });
    const usageP = h('p', { class: 'hint' });
    const grid = h('div', { class: 'grid2' });
    const more = h('div');
    let items = [], next = null, lseq = 0;
    const drawSeg = () => put(seg, ...[['', '전체'], ['ai', 'AI 생성'], ['stock', '실제 사진'], ['upload', '직접 올림'], ['card', '카드뉴스']].map(([k, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(k === libKind), onclick: () => { libKind = k; drawSeg(); loadLib(false); } }, l)));
    const card = (i) => h('button', { type: 'button', class: 'pick', onclick: () => imageSheet(i.id, () => loadLib(false)) },
      i.url ? h('img', { src: i.url, alt: i.alt_text || i.description || '이미지', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'ph' }, '이미지'),
      h('small', null, [IMG.KIND_LABEL[i.kind], i.review_status, i.uses ? `${i.uses}곳에서 사용` : '안 쓰는 중'].join(' · ')));
    // 종류를 빨리 바꿔도 마지막으로 고른 것만 보여줌 (늦게 온 응답은 버림)
    const loadLib = async (append) => {
      const my = ++lseq;
      if (!append) { put(grid, h('p', { class: 'hint' }, '불러오는 중…')); put(more); } else put(more, h('p', { class: 'hint' }, '불러오는 중…'));
      try {
        const qs = new URLSearchParams();
        if (libKind) qs.set('kind', libKind);
        if (append && next) qs.set('before', next);
        const j = await api('/images' + (qs.toString() ? '?' + qs : ''));
        if (my !== lseq) return;
        items = append ? items.concat(j.images) : j.images; next = j.next;
        const u = j.usage || {};
        usageP.textContent = `보관함 ${L.fmtNum(u.image_count || 0)}장 · 저장 공간 ${fmtBytes(Number(u.storage_bytes || 0))} 사용 중 · ${usageLine(u)}`;
        put(grid, ...(items.length ? items.map(card) : [h('p', { class: 'hint' }, '이미지가 없어.')]));
        put(more, next ? btn('더 보기', 'sm ghost', () => loadLib(true)) : '');
      } catch (e) { if (my === lseq && e && e.code !== 'auth') put(grid, h('p', { class: 'hint' }, ui.errText(e))); }
    };
    drawSeg();
    pnl.append(h('h2', null, '이미지 보관함'), usageP, seg, grid, more,
      h('p', { class: 'hint' }, '이미지는 비공개 저장소에 있고, 로그인한 이 앱에서만 1시간짜리 주소로 보여. 원고를 지워도 이미지는 남아. 어디서도 안 쓰는 이미지만 지울 수 있어.'));
    loadLib(false);
    return box;
  }
  async function imageSheet(id, onChange) {
    const marker = h('p', { class: 'hint' }, '불러오는 중…');
    openSheet('이미지', marker);
    let j;
    try { j = await api('/images/' + id); } catch (e) { if (e && e.code !== 'auth' && marker.isConnected) openSheet('이미지', h('p', { class: 'hint' }, ui.errText(e))); return; }
    if (!marker.isConnected) return; // 기다리는 사이에 창을 닫았으면 다시 열지 않음
    const img = j.image;
    const used = (j.used_in || []).map((u) => h('li', null, h('button', { type: 'button', class: 'copy', onclick: () => { closeSheet(); go('content/post/' + u.post_id); } },
      `${u.posts && u.posts.titles && u.posts.titles[0] ? u.posts.titles[0] : u.posts ? u.posts.keyword : '원고'}${u.posts && u.posts.deleted_at ? ' (휴지통)' : ''} · ${u.slot_key.startsWith('x:') ? (IMG.extraSlot(u.slot_key) || {}).label || '본문 밖' : '사진 ' + (Number(u.slot_index) + 1)}`)));
    const inUse = (j.used_in || []).length + (j.decks || []).length;
    const c = genCost(j.generation);
    // 휴대폰 공유 창은 누른 순간에 열어야 해서, 창을 열 때 파일을 먼저 준비해 둠 (창을 닫으면 받기를 멈춤 — 휴대폰 데이터 아끼기)
    let orig = null;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const dl = btn('원본 준비 중…', 'sm ghost', async () => {
      if (!orig) return;
      const r = await saveFiles([orig], orig.name);
      if (r !== 'cancelled') toast(r === 'shared' ? '저장했어' : `내려받았어 (${orig.name})`);
    }, { disabled: true });
    originalFile(img, IMG.fileNameFor({ keyword: (img.description || '이미지').slice(0, 20) }, 'original', '', outExt(img)), ctrl ? ctrl.signal : undefined)
      .then((f) => { orig = f; if (dl.isConnected) { dl.disabled = false; dl.textContent = '원본 내려받기'; } })
      .catch(() => { if (dl.isConnected) dl.textContent = '원본을 불러오지 못했어'; });
    openSheet(IMG.KIND_LABEL[img.kind] || '이미지',
      thumb(img, null), h('div', { class: 'chips' }, kindChip(img), reviewChip(img)),
      img.description ? h('p', null, img.description) : null,
      h('p', { class: 'hint' }, [img.kind === 'ai' ? `${img.model}${c ? ` · 비용 ${usd(c.usd)} (${c.label})` : ''}` : '', img.kind === 'stock' ? img.attribution_text : '', `${img.width}×${img.height} · ${fmtBytes(img.bytes)} · ${L.fmtTime(img.created_at)}`].filter(Boolean).join(' · ')),
      img.kind === 'stock' && img.source_url ? h('div', { class: 'go' }, h('a', { class: 'copy', href: img.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'Pexels 원본 보기 ↗')) : null,
      h('p', { class: 'legend' }, inUse ? `쓰는 곳 ${inUse}곳` : '쓰는 곳 없음'),
      used.length ? h('ul', { class: 'lic' }, used) : null,
      (j.decks || []).length ? h('p', { class: 'hint' }, `카드뉴스 배경으로 ${(j.decks || []).length}곳에서 사용 중`) : null,
      h('div', { class: 'go' }, dl,
        btn('지우기', 'sm danger', async (ev) => {
          if (inUse) { toast(IMAGE_ERR.image_in_use, 4000); return; }
          if (!confirmBox(ev.currentTarget, '정말 지울까?')) return;
          const r = await run(ev.currentTarget, () => api('/images/' + img.id, { method: 'DELETE' }), '지웠어');
          if (r) { closeSheet(); if (onChange) onChange(); }
        }, { disabled: false })),
      h('p', { class: 'hint' }, inUse ? '원고(휴지통 포함)나 카드뉴스에서 쓰는 중이라 지울 수 없어. 먼저 연결을 빼줘.' : '지우면 파일은 없어지고, 비용·출처 기록은 남아.'));
    ui.setSheetOnClose(() => { if (ctrl && !orig) ctrl.abort(); });
  }

  // ═════════ 설정 > 이미지 ═════════
  function settingsSection() {
    const st = settings();
    const pr = st.image_prices || {};
    const status = h('div', { class: 'stack' }, h('p', { class: 'hint' }, '연결 상태 확인 중…'));
    api('/images/config').then((j) => {
      put(status, 
        h('div', { class: 'item' }, h('div', { class: 'main', style: 'cursor:default' }, h('b', null, 'Cloudflare (무료 AI 이미지)'), h('small', null, 'Supabase Secrets: CF_ACCOUNT_ID · CF_API_TOKEN')), h('span', { class: 'badge ' + (j.keys.cloudflare ? 'v-ok' : 'v-no') }, j.keys.cloudflare ? '연결됨' : '없음')),
        h('div', { class: 'item' }, h('div', { class: 'main', style: 'cursor:default' }, h('b', null, 'OpenAI (유료 AI 이미지 · 고치기)'), h('small', null, 'Supabase Secrets: OPENAI_API_KEY')), h('span', { class: 'badge ' + (j.keys.openai ? 'v-ok' : 'v-no') }, j.keys.openai ? '키 연결됨' : '키 없음')),
        ...j.providers.map((x) => h('div', { class: 'item' }, h('div', { class: 'main', style: 'cursor:default' }, h('b', null, `${x.label} (실제 사진 검색)`), h('small', null, 'Supabase Secrets: PEXELS_API_KEY')), h('span', { class: 'badge ' + (x.connected ? 'v-ok' : 'v-no') }, x.connected ? '키 연결됨' : '키 없음'))),
        h('p', { class: 'hint' }, `${usageLine(j.usage)} · 보관함 ${L.fmtNum(j.usage.image_count || 0)}장 · ${fmtBytes(Number(j.usage.storage_bytes || 0))} (멈추는 선 ${fmtBytes(j.storage_limit)})`),
        j.settings.image_gen_model === j.test_model || j.settings.image_edit_model === j.test_model ? h('p', { class: 'notice' }, '점검용 가짜 모델(gf-test-fake)로 돼 있어. 실제로 쓰려면 모델 이름을 gpt-image-2.5-flare / gpt-image-2.5-sunburst 로 바꿔줘.') : null);
    }).catch((e) => put(status, h('p', { class: 'hint' }, ui.errText(e))));
    const inp = (v, attrs = {}) => h('input', { type: 'text', value: v ?? '', oninput: ui.markDirty, ...attrs });
    const f = {
      gen: inp(st.image_gen_model || IMG.FREE_MODEL, { autocapitalize: 'off', spellcheck: 'false' }),
      edit: inp(st.image_edit_model || 'gpt-image-2.5-sunburst', { autocapitalize: 'off', spellcheck: 'false' }),
      quality: h('select', { value: st.image_quality || 'medium', onchange: ui.markDirty }, IMG.QUALITIES.map((q) => opt(q, IMG.QUALITY_LABEL[q]))),
      daily: inp(st.image_daily_limit ?? 5, { inputmode: 'numeric' }),
      budget: inp(st.image_monthly_budget_usd ?? 2, { inputmode: 'decimal' }),
      fx: inp(st.image_fx_krw ?? '', { inputmode: 'decimal', placeholder: '예: 1385' }),
      fxDate: h('input', { type: 'date', value: st.image_fx_date || '', oninput: ui.markDirty }),
      fxSrc: inp(st.image_fx_source || '', { placeholder: '예: 하나은행 매매기준율' }),
      pOut: inp(pr.image_output_per_m ?? 30, { inputmode: 'decimal' }), pIn: inp(pr.image_input_per_m ?? 8, { inputmode: 'decimal' }), pText: inp(pr.text_input_per_m ?? 5, { inputmode: 'decimal' }),
      pAt: h('input', { type: 'date', value: pr.checked_at || '', oninput: ui.markDirty }), pSrc: h('input', { type: 'url', value: pr.source || 'https://developers.openai.com/api/docs/pricing', oninput: ui.markDirty }),
    };
    const num = (el, min, max, label) => { const v = Number(String(el.value).replace(/[,\s$원]/g, '')); if (!Number.isFinite(v) || v < min || v > max) { toast(`${label}: ${min}~${max} 사이 숫자를 넣어줘`); el.focus(); return null; } return v; };
    const guide = det('img-key-guide', '키 받는 방법·넣는 곳 (처음 한 번)', false, '');
    guide.append(h('ol', { class: 'steps' },
      h('li', null, '무료 AI 이미지(Cloudflare): dash.cloudflare.com 에 무료로 가입해 (플랜은 Free 그대로 — 카드 등록 안 해도 돼).'),
      h('li', null, '왼쪽 메뉴 AI → Workers AI → Use REST API → Create a Workers AI API Token → Create API Token → Copy API Token 으로 토큰을 복사해 (한 번만 보여줘). 같은 화면의 Get Account ID 에서 계정 ID도 복사해.'),
      h('li', null, 'Supabase Secrets 에 CF_ACCOUNT_ID(계정 ID), CF_API_TOKEN(토큰) 이름으로 넣어. 무료 플랜은 하루 10,000 뉴런(이 앱 기준 약 100장)까지고, 넘으면 실패만 하고 돈은 안 나가 (매일 오전 9시에 다시 채워짐).'),
      h('li', null, '(선택) OpenAI: platform.openai.com 에 로그인 → API keys → Create new secret key. 결제(Billing)에 크레딧이 있어야 하고, GPT Image 모델은 조직 인증(Organization Verification)이 필요할 수 있어.'),
      h('li', null, 'OpenAI 쪽 안전장치: OpenAI 설정 → Limits → Spend 에서 한 달 한도를 넣고 Enforce a hard limit 를 켜두면, 앱 한도와 별개로 그 금액에서 막혀.'),
      h('li', null, 'Pexels: 지금(2026-10-22 확인)은 새 키 발급이 멈춰 있어. 다시 열리면 pexels.com/api → Get Started 로 받아 (무료, 시간당 200번·월 20,000번). 그 전까지는 직접 올리기를 써.'),
      h('li', null, 'Supabase 대시보드 → 이 프로젝트 → Edge Functions → Secrets 에서 CF_ACCOUNT_ID, CF_API_TOKEN (그리고 쓰면 OPENAI_API_KEY, PEXELS_API_KEY) 이름으로 붙여넣고 저장. 다시 배포할 필요 없이 바로 적용돼.'),
      h('li', null, '이 화면을 다시 열어 "키 연결됨"이 보이면 끝. 키는 이 앱·채팅·GitHub에 붙여넣지 마 (서버에만 있어야 해).')),
      h('div', { class: 'go' }, h('a', { class: 'copy', href: 'https://supabase.com/dashboard/project/oxewhsqmdkiasckvnyua/functions/secrets', target: '_blank', rel: 'noopener noreferrer' }, 'Supabase Secrets 열기 ↗'),
        h('a', { class: 'copy', href: 'https://dash.cloudflare.com/profile/api-tokens', target: '_blank', rel: 'noopener noreferrer' }, 'Cloudflare 토큰 ↗'),
        h('a', { class: 'copy', href: 'https://platform.openai.com/api-keys', target: '_blank', rel: 'noopener noreferrer' }, 'OpenAI 키 ↗'),
        h('a', { class: 'copy', href: 'https://www.pexels.com/api/', target: '_blank', rel: 'noopener noreferrer' }, 'Pexels API ↗')));
    return [
      status, guide,
      h('h3', null, '모델'), field('생성 모델', f.gen), field('편집 모델 (고쳐서 만들기)', f.edit),
      h('p', { class: 'hint' }, '계정에서 이 모델을 못 쓰면 다른 이미지 모델 이름으로 바꿔줘. 앱이 아는 모델 (OpenAI 문서, 2026-10-22 확인):'),
      h('div', { class: 'go' }, btn('무료 모델로 (cf-flux-1-schnell)', 'sm', () => { f.gen.value = IMG.FREE_MODEL; ui.markDirty(); toast('생성 모델을 무료 모델로 바꿨어. 저장을 눌러줘.'); })),
      h('ul', { class: 'lic' },
        h('li', null, 'cf-flux-1-schnell — 무료 (Cloudflare Workers AI · FLUX.1 schnell). 1024×1024로 만들고 내려받을 때 비율대로 잘라. 품질 = 그리는 단계(낮음 4·보통 6·높음 8). 한국어 설명은 같은 무료 계정의 글 모델이 영어로 바꿔서 보내. 고치기(편집)는 못 해. 글자·사람 손은 약해'),
        h('li', null, 'gpt-image-2.5-flare · gpt-image-2.5-sunburst — 유료(OpenAI). 원하는 비율 그대로, 품질 5단계, 가격은 아래 가격표'),
        h('li', null, 'gpt-image-2 — 원하는 비율 그대로, 품질 3단계. 장당 가격을 확인 못 해서 예상 비용을 넉넉히 잡아'),
        h('li', null, 'gpt-image-1.5 · gpt-image-1 · gpt-image-1-mini — 이전 모델(Deprecated). 정해진 크기 3가지로 만들고 내려받을 때 잘라, 품질 3단계, 모델 페이지의 장당 가격으로 계산'),
        h('li', null, '그 밖의 이름 — 정해진 크기 3가지·품질 3단계로 보내고, 예상 비용은 넉넉히 잡고 사용량 계산은 안 해 (청구액은 직접 확인)')),
      field('기본 품질', f.quality, '보통(medium) 1024×1024 한 장 예상 약 $0.013, 높음은 약 $0.05 (2.5 모델, 2026-10-22 가격표 기준). 모델이 못 받는 품질이면 가까운 것으로 바꿔서 보내.'),
      h('h3', null, '비용 한도'),
      h('div', { class: 'row' }, field('하루 생성 한도 (번)', f.daily, '0이면 AI 생성을 막아.'), field('한 달 예산 (달러)', f.budget, '넘게 되면 새 생성을 멈춰.')),
      h('p', { class: 'hint' }, '예산은 실제 청구액 > 사용량 기준 > 예상 순으로 더해서 셈해. 청구됐는지 모르는 실패도 예상 비용으로 셈해서 넉넉하게 막아.'),
      h('h3', null, '환율 (원화로 볼 때)'),
      h('div', { class: 'row' }, field('원/달러', f.fx), field('기준 날짜', f.fxDate)), field('기준 (어디 환율)', f.fxSrc),
      h('p', { class: 'hint' }, '앱이 환율을 가져오지 않아. 확인한 환율과 날짜·출처를 넣으면, 그 뒤 생성 기록은 그 환율로 원화를 계산해.'),
      h('h3', null, 'OpenAI 가격 (100만 토큰당 달러 · gpt-image-2.5 모델)'),
      h('div', { class: 'row' }, field('이미지 출력', f.pOut), field('이미지 입력', f.pIn), field('텍스트 입력', f.pText)),
      h('div', { class: 'row' }, field('확인한 날', f.pAt), field('가격표 주소', f.pSrc)),
      btn('저장', 'sm', async (ev) => {
        const daily = num(f.daily, 0, 50, '하루 한도'); if (daily == null) return;
        const budget = num(f.budget, 0, 500, '한 달 예산'); if (budget == null) return;
        let fx = null;
        if (String(f.fx.value).trim()) { fx = num(f.fx, 100, 10000, '환율'); if (fx == null) return; }
        const pOut = num(f.pOut, 0, 1000, '이미지 출력 가격'); if (pOut == null) return;
        const pIn = num(f.pIn, 0, 1000, '이미지 입력 가격'); if (pIn == null) return;
        const pText = num(f.pText, 0, 1000, '텍스트 입력 가격'); if (pText == null) return;
        if (f.pSrc.value.trim() && !L.safeUrl(f.pSrc.value)) { toast('가격표 주소는 https://로 시작해야 해'); return; }
        const body = {
          image_gen_model: f.gen.value.trim(), image_edit_model: f.edit.value.trim(), image_quality: f.quality.value, image_daily_limit: Math.round(daily), image_monthly_budget_usd: budget,
          image_fx_krw: fx, image_fx_date: f.fxDate.value || null, image_fx_source: f.fxSrc.value.trim(),
          image_prices: { image_output_per_m: pOut, image_input_per_m: pIn, text_input_per_m: pText, checked_at: f.pAt.value || null, source: f.pSrc.value.trim() },
        };
        const j = await run(ev.currentTarget, () => api('/settings', { method: 'POST', body }), '저장했어');
        if (j) { ui.clearDirty(); for (const k in C) C[k].at = 0; await ui.load(); }
      }),
    ];
  }

  // ═════════ 수익 탭: 이미지 비용 (실적의 비용과 따로) ═════════
  function moneyBlock(ic, net) {
    if (!ic) return h('p', { class: 'hint' }, '이미지 비용을 불러오지 못했어.');
    const t = ic.totals || {};
    const st = settings();
    const krwText = t.krw != null ? L.won(t.krw) : null;
    const kp = (label, value, sub) => h('div', { class: 'kpi' }, h('span', null, label), value == null ? h('b', { class: 'none' }, '데이터 없음') : h('b', null, value), sub ? h('small', null, sub) : null);
    const after = net != null && t.krw != null ? net - Number(t.krw) : null;
    // 청구액을 다 확인한 게 아니면 '예상 포함'이라고 밝힘 (예상과 실제 청구액은 다를 수 있음)
    const est = Number(t.n_actual || 0) < Number(t.billed || 0);
    return h('div', { class: 'stack' },
      h('div', { class: 'kpis' },
        kp(est ? '이미지 생성 비용 (예상 포함)' : '이미지 생성 비용', t.count ? `${usd(t.usd)}${krwText && Number(t.usd) > 0 ? ' ≈ ' + krwText : ''}` : null, t.count ? `비용 반영 ${t.billed}번 / 기록 ${t.count}번` : null),
        kp('청구액 확인', t.count ? `${t.n_actual || 0}건` : null, t.count ? `사용량 기준 ${t.n_usage || 0}건 · 확인 필요 ${t.uncertain || 0}건` : null),
        after != null ? kp(est ? '이미지 비용(예상 포함)까지 뺀 순수익' : '이미지 비용까지 뺀 확정 기준 순수익', L.won(after), '확정 수익 − 비용 − 이미지 비용(원화)') : null),
      h('p', { class: 'hint' }, '이미지 생성 비용은 위 실적의 비용과 따로 셈해 (두 번 더하지 않아). 실적 입력의 비용 칸에는 이미지 비용을 넣지 마.'),
      h('p', { class: 'hint' }, `예상·사용량 기준 금액은 계산값이고, OpenAI 사용량 화면에서 확인해 넣은 것만 청구액으로 표시해.${st.image_fx_krw ? '' : ' 환율을 넣으면 원화로도 보여줘 (설정 > 이미지).'}${t.fx_missing ? ` 환율이 없는 기록 ${t.fx_missing}건이 있어서 원화 합계는 비워뒀어.` : ''}`));
  }
  const postCost = (ic, key) => ((ic && ic.by_post) || []).find((x) => x.key === key) || null;

  // ═════════ 원고 미리보기·복사에 쓰는 이미지 목록 ═════════
  // 미리보기: 받아 둔 정보(서명 주소)가 있으면 그림, 없으면 '이미지 연결됨' 표시만
  function previewImages(p) {
    const slots = IMG.parseSlots(p.body);
    const d = dataOf(p.id);
    const imgs = d ? byId(d.images) : {};
    const rows = d ? Object.fromEntries((d.slots || []).filter((s) => s.row).map((s) => [s.key, s.row])) : Object.fromEntries(ui.slotsOf(p.id).map((r) => [r.slot_key, r]));
    return slots.map((s) => {
      const r = rows[s.key];
      if (!r || !r.image_id) return null;
      const im = imgs[r.image_id];
      if (!im) return { url: '', alt: '', label: '' };
      return { url: im.url, alt: im.alt_text || s.text, label: IMG.KIND_LABEL[im.kind] + (im.review_status !== '사용 가능' ? ' · ' + im.review_status : '') };
    });
  }
  // 복사: 내려받을 파일 이름과 캡션(AI 안내·사진 출처)만 — 이미지 주소는 넣지 않음
  function exportImages(p) {
    const slots = IMG.parseSlots(p.body);
    const rows = Object.fromEntries(ui.slotsOf(p.id).map((r) => [r.slot_key, r]));
    return slots.map((s) => {
      const r = rows[s.key];
      const im = r && r.image_id ? r.post_images : null;
      if (!im || im.review_status === '사용 안 함') return null; // '사용 안 함'은 내려받지 않으니 글에도 안 넣음
      const purpose = (r.purpose && IMG.PURPOSES[r.purpose]) ? r.purpose : 'blog_body';
      return { fileName: IMG.fileNameFor(p, s.n, purpose, outExt(im)), caption: IMG.captionHint({ kind: im.kind, provider: im.provider, author_name: im.author_name, license: im.license, attribution_text: im.attribution_text }) };
    });
  }
  // 원고 목록에 붙이는 '사진 연결 수'
  function slotCount(p) {
    const slots = IMG.parseSlots(p.body);
    if (!slots.length) return null;
    const rows = Object.fromEntries(ui.slotsOf(p.id).map((r) => [r.slot_key, r]));
    const linked = slots.filter((s) => rows[s.key]);
    // '사용 가능'으로 검수한 이미지만 다 됨으로 셈 (검수 전·사용 안 함은 아직)
    return { total: slots.length, linked: linked.length, usable: linked.filter((s) => (rows[s.key].post_images || {}).review_status === '사용 가능').length };
  }
  // 지울 때도 번호를 올려 둠 → 그 전에 보낸 요청의 응답이 늦게 와도 다시 쓰지 않음
  // 기록을 버림 (진행 중인 요청은 기억해 둬서 다음 요청이 그 뒤에 가게)
  const invalidate = (id) => { for (const k of id ? [id] : Object.keys(C)) C[k] = { seq: ++seqN, req: (C[k] && C[k].req) || null }; };

  return { postPanel, viewCards, viewLibrary, settingsSection, moneyBlock, postCost, previewImages, exportImages, slotCount, invalidate, genCost };
}
