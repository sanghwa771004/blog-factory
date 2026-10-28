// studio.js — 이미지 스튜디오 화면 (원고 상세의 '이미지' 칸, 만들기·찾기·올리기·고르기, 미리보기·자르기·내려받기, 카드뉴스, 보관함, 설정, 이미지 비용)
// OpenAI·Pexels 키는 서버(Supabase Secrets)에만 있음. 이 화면은 서버가 알려주는 '키 있음/없음'만 보고, 이미지는 1시간짜리 서명 주소로만 봄.
// 앱은 블로그에 사진을 대신 올리지 않음 — 사용자가 내려받아서 직접 넣음.
import * as IMG from './images.js?v=1.5.1';
import { renderSlide, ensureFonts, canvasToBlob } from './cards.js?v=1.5.1';
import { createProduct, PRODUCT_ERR } from './product.js?v=1.5.1';

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
  edit_ai_only: '직접 올린 사진·실제 사진은 AI로 고치지 않아 (실제와 다르게 보일 수 있어서). AI로 만든 이미지만 고칠 수 있어.',
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
  real_photo_needed: "실제 상품·화면이 보여야 하는 자리야. 진짜 제품 사진을 참고 사진('대상 모양 유지')으로 넣거나, 직접 찍은 사진을 올리거나, 일반 장면으로 만들겠다고 체크해줘.",
  openai_unsupported_option: '이 모델이 그 크기·품질을 지원하지 않아. 설정 > 이미지에서 모델이나 품질을 바꿔줘.',
  openai_spend_limit: 'OpenAI에 걸어둔 사용 한도(Spend limit)에 닿았어. OpenAI 설정의 Limits에서 한도를 올리거나 다음 달까지 기다려줘.',
  timeout: '응답이 너무 늦어. 다시 눌러줘 (같은 요청이면 두 번 만들지 않아).',
  cf_key_missing: '무료 이미지(Cloudflare) 계정 ID·토큰이 아직 없어. 설정 > 이미지에서 방법을 봐줘. 사진 찾기·직접 올리기·카드뉴스는 지금도 돼.',
  cf_key_invalid: 'Cloudflare 계정 ID나 토큰이 맞지 않아. Supabase Secrets의 CF_ACCOUNT_ID·CF_API_TOKEN을 확인해줘.',
  cf_daily_free_used: '오늘 무료 사용량을 다 썼어. 한국 시간 오전 9시에 다시 채워져. (청구 없음)',
  cf_rate_limited: 'Cloudflare가 잠깐 요청을 막았어. 1분쯤 뒤에 다시 해줘.',
  edit_unsupported: '이 모델은 고치기(편집)를 못 해. 고치기가 되는 모델(모드)을 골라줘.',
  // 1.5.0
  model_unknown: '앱이 모르는 모델이야. 설정 > 이미지에서 목록에 있는 모델로 골라줘 (모르는 이름을 다른 공급자로 보내지 않아).',
  gemini_key_missing: 'Gemini API 키가 아직 없어서 Gemini로는 못 만들어. 설정 > 이미지에서 방법을 봐줘.',
  gemini_key_invalid: 'Gemini API 키가 맞지 않거나 이 모델을 쓸 권한이 없어. Supabase Secrets의 GEMINI_API_KEY와 프로젝트 결제를 확인해줘.',
  gemini_billing: 'Gemini 이미지 모델은 결제가 연결된 프로젝트에서만 쓸 수 있어. Google AI Studio에서 결제를 연결해줘.',
  gemini_quota: 'Gemini 사용 한도에 닿았어. Google AI Studio의 한도·결제를 확인해줘.',
  gemini_rate_limited: 'Gemini가 잠깐 요청을 막았어. 1분쯤 뒤에 다시 해줘.',
  gemini_unsupported_option: '이 Gemini 모델이 그 비율·해상도를 지원하지 않아. 품질(해상도)이나 모델을 바꿔줘.',
  gemini_blocked: '요청이 Gemini 안전 기준에 걸렸어. 설명을 바꿔서 다시 해줘.',
  gemini_output_blocked: '만든 이미지가 Gemini 안전 검사에 걸렸어. 설명을 바꿔서 다시 해줘.',
  own_photo_slot: "'직접 찍기' 자리는 네가 찍은 사진만 넣어 (AI로 만들면 실제로 해본 것처럼 보여서). 휴대폰으로 찍어서 '파일 올리기'로 넣어줘.",
  refs_unsupported: '이 모델은 참고 사진을 못 받아. 참고 사진을 빼거나 참고 사진이 되는 모델을 골라줘.',
  too_many_refs: '참고 사진이 이 모델이 받는 수보다 많아. 몇 장 빼줘.',
  ref_not_found: '참고 사진을 보관함에서 찾지 못했어 (지웠을 수 있어). 다시 골라줘.',
  ref_too_big: '참고 사진이 너무 커 (8MB까지). 작은 사진으로 골라줘.',
  bad_ref_image: '참고 사진을 불러오지 못했어. 다시 골라줘.',
  image_request_cap: "한 번에 쓸 수 있는 금액을 넘어. 장수를 줄이거나 설정 > 이미지에서 '한 번 상한'을 바꿔줘.",
  review_ai_only: 'AI 검수는 AI로 만든 이미지만 해 (직접 찍은 사진은 실제 사진이라 검수하지 않아).',
  review_model_off: '검수할 AI를 골라줘 (설정 > 이미지에서 기본으로 정할 수 있어).',
  review_model_unknown: '앱이 모르는 검수 모델이야. 목록에서 골라줘.',
  review_busy: '이 이미지를 이미 검수하는 중이야. 잠깐 뒤에 다시 봐줘.',
  model_retired: '공급자가 종료한 모델이야. 설정 > 이미지에서 다른 모델로 바꿔줘.',
  ref_small_missing: '무료 모델에 보낼 작은 사본이 없어. 다시 눌러주면 만들어서 보낼게.',
  refs_too_big: '참고 사진이 너무 커서 한 번에 보낼 수 없어. 장수를 줄여줘.',
  // 1.5.1 상품 사진으로 장면 만들기
  ...PRODUCT_ERR,
};
export const IMAGE_FIELD = {
  request_key: '요청', slot_key: '사진 자리', text: '사진 설명', ratio: '비율', quality: '품질', photo_id: '사진', file: '파일', b64: '파일', q: '검색어',
  image_gen_model: '생성 모델', image_edit_model: '편집 모델', image_quality: '기본 품질', image_daily_limit: '하루 한도', image_monthly_budget_usd: '한 달 예산',
  image_modes: '모드별 모델', product_image_id: '상품 사진', background_image_id: '배경', mask_id: '마스크', layer: '합성 설정', edit: '바꿀 내용', image_review_model: '검수 모델', image_request_cap_usd: '한 번 상한', image_ratio_prefs: '용도별 비율', model: '모델', refs: '참고 사진', batch: '여러 장 묶음', scene: '장면 설계서', provider: '공급자',
  image_fx_krw: '환율', image_fx_date: '환율 날짜', image_prices: '가격', crop: '자르기', slides: '카드 문구', template: '템플릿', bg_image_id: '배경 이미지',
  actual_usd: '청구액', actual_checked_at: '확인일', base_image_id: '고칠 이미지', post_id: '원고', image_id: '이미지', review_status: '검수 상태',
};
export const IMAGE_REASON = {
  empty: '파일이 비어 있어.', too_big: '파일이 너무 커. 8MB까지 올릴 수 있어.', bad_type: 'JPEG·PNG·WebP 이미지만 올릴 수 있어. (이름만 바꾼 파일도 안 돼)',
  type_mismatch: '파일 내용과 형식이 달라. 원래 이미지 파일을 올려줘.', animated: '움직이는 이미지는 올릴 수 없어.', too_many_pixels: '가로·세로가 너무 큰 이미지야. 줄여서 올려줘.',
};
const RETRYABLE = new Set(['cf_timeout', 'cf_server', 'cf_network', 'cf_rate_limited', 'cf_empty', 'openai_timeout', 'openai_server', 'openai_network', 'openai_rate_limited', 'server_stopped', 'timeout', 'storage_failed', 'save_failed', 'server_error', 'server_busy_late',
  'gemini_timeout', 'gemini_server', 'gemini_network', 'gemini_rate_limited', 'gemini_no_image', 'bad_ref_image']);

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
// 묶음(후보 여러 장·모델 비교) 번호 — 서버가 uuid 모양만 받음
const newUuid = () => {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* 아래로 */ }
  const h = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${h(8)}-${h(4)}-4${h(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${h(3)}-${h(12)}`;
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
  // 고친 'AI 합성' 이미지는 자기 기록에 참고 사진이 없음 → 고치기 전 원본 쪽(이 글 이미지 안)에서 찾음 (최대 5단계 — 서버 lineageRefs 와 같은 규칙)
  const lineageRefs = (d, img) => {
    const own = (img && img.ref_images) || [];
    if (own.length || !img || !img.composite) return own;
    const by = byId((d && d.images) || []);
    let cur = img;
    for (let i = 0; i < 5 && cur.parent_image_id && by[cur.parent_image_id]; i++) {
      cur = by[cur.parent_image_id];
      if ((cur.ref_images || []).length) return cur.ref_images;
    }
    return [];
  };
  // 다시 만들기 (1.5.0 검토 뒤): 고친 이미지는 같은 원본을 같은 지시로 다시 고치는 창을, 그 밖은 같은 설정으로 새로 만드는 창을 열어.
  // 고친 원본이 이 글 이미지에 없으면 서버에 물어보고, 지워졌으면 새로 만들기 창으로 (그때 쓴 지시를 사진 설명으로 쓰지 않음)
  async function regen(p, s, d, img) {
    const prev = genOf(d, img);
    if (prev && prev.mode === 'edit' && prev.base_image_id) {
      let base = (d.images || []).find((x) => x.id === prev.base_image_id && !x.deleted_at) || null;
      if (!base) {
        try { base = (await api('/images/' + prev.base_image_id)).image || null; } catch (e) { if (e && e.code === 'auth') return; base = null; }
      }
      if (base) { genSheet(p, s, { base, prev, prevImg: img, text: String(prev.user_prompt || '').split('\n')[0] }); return; }
      toast('고친 원본을 찾지 못해서(지웠을 수 있어) 새로 만들기 창으로 열어.', 4000);
      genSheet(p, s, { prevImg: img });
      return;
    }
    genSheet(p, s, { prev, prevImg: img });
  }
  const keysOf = (id) => (dataOf(id) || {}).keys || {};

  // ── 작은 조각 ──
  // 출처 표시: 게시 원고·보관함·검수 화면이 모두 IMG.originLabel 을 씀 (직접 올린 사진은 고른 출처, 안 골랐으면 '출처 확인 필요')
  const kindChip = (img) => h('span', { class: 'chip k-' + img.kind + ' o-' + IMG.originOf(img) }, IMG.originLabel(img));
  // 직접 올린 사진의 출처 고르기 (파일을 올렸다고 직접 촬영으로 보지 않아서, 사용자가 확인해야 '직접 촬영'으로 셈)
  const SOURCE_OPTS = [['', '잘 모르겠어 (출처 확인 필요)'], ['own', '내가 직접 찍은 사진'], ['official', '제조사·판매처가 준 공식 이미지'], ['external', '다른 곳에서 받은 사진 (무료 사진 사이트 등)']];
  const sourceSelect = (value) => h('select', { value: value || '' }, SOURCE_OPTS.map(([v, l]) => opt(v, l))); // 이름은 감싸는 칸 제목('이 사진은 어디서 났어?')
  function sourcePicker(img, after) {
    const sel = sourceSelect(img.source_type);
    sel.addEventListener('change', async () => {
      const v = sel.value;
      const j = await run(sel, () => api('/images/' + img.id, { method: 'POST', body: { source_type: v } }), '출처를 바꿨어');
      if (j) { img.source_type = v; if (after) after(); } else sel.value = img.source_type || '';
    });
    return h('div', { class: 'stack' }, field('이 사진은 어디서 났어?', sel, "파일을 올렸다는 것만으로는 직접 찍은 사진으로 보지 않아. 직접 찍었으면 '내가 직접 찍은 사진'을 골라줘."));
  }
  const reviewChip = (img) => h('span', { class: 'chip ' + (img.review_status === '사용 가능' ? 'v-ok' : img.review_status === '사용 안 함' ? 'v-no' : 'v-unk') }, img.review_status);
  function thumb(img, onclick) {
    const pic = img.url ? h('img', { src: img.url, alt: img.alt_text || img.description || '이미지', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'hint' }, '미리보기를 불러오지 못했어');
    return onclick ? h('button', { type: 'button', class: 'thumb', onclick, 'aria-label': '크게 보기' }, pic) : h('div', { class: 'thumb' }, pic);
  }
  function pickThumb(img, onclick) {
    return h('button', { type: 'button', class: 'pick', onclick },
      img.url ? h('img', { src: img.url, alt: img.alt_text || img.description || '이미지', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'ph' }, '이미지'),
      h('small', null, [IMG.originLabel(img), img.uses ? `${img.uses}곳에서 사용` : ''].filter(Boolean).join(' · ')));
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
    else if (img.kind === 'composite') parts.push('상품은 원본 사진 그대로 · 배경은 AI');
    if (IMG.productSceneMode(img)) parts.push(IMG.productApproved(img) ? '상품 검수 승인' : '상품 검수 전');
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
    const genProv = IMG.modelCaps(st.image_gen_model || '').provider;
    if (genProv === 'cloudflare' && !(d.keys || {}).cloudflare) kids.push(h('p', { class: 'hint' }, 'AI 이미지(무료): Cloudflare 계정 ID·토큰이 아직 없어 (설정 > 이미지에서 방법 보기). 사진 찾기·직접 올리기·카드뉴스는 지금도 돼.'));
    if (genProv === 'openai' && !(d.keys || {}).openai && st.image_gen_model !== TEST_MODEL) kids.push(h('p', { class: 'hint' }, 'AI 이미지: OpenAI 키가 아직 없어 (설정 > 이미지에서 방법 보기). 사진 찾기·직접 올리기·카드뉴스는 지금도 돼.'));
    if (genProv === 'gemini' && !(d.keys || {}).gemini) kids.push(h('p', { class: 'hint' }, 'AI 이미지: Gemini API 키가 아직 없어 (설정 > 이미지에서 방법 보기). 사진 찾기·직접 올리기·카드뉴스는 지금도 돼.'));
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
      btn('이 상품으로 장면 만들기', 'sm ghost', () => prd().start({ postId: p.id })),
      btn('이미지 보관함', 'sm ghost', () => go('content/images'))));
    kids.push(costBlock(p, d));
    kids.push(h('p', { class: 'hint' }, "AI 이미지는 실제 사진이 아니야. 실제 상품 모습은 직접 찍은 사진을 쓰거나, '이 상품으로 장면 만들기'에서 상품 사진을 원본 그대로 합성(원본 보존 합성)하거나 참고해서 그려(AI 실사 장면) 줘. 앱은 블로그에 사진을 대신 올리지 않아 — 내려받아서 직접 넣어줘."));
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
    // 진짜 제품 사진을 참고한 AI 합성은 '실제 사진을 권해' 대신 원본과 비교하라고 (1.5.0)
    // 1.5.1: 상품 장면 이미지는 상품 디테일 검수를 승인해야 '사용 가능'·발행 준비 완료
    if (img && IMG.productSceneMode(img) && !IMG.productApproved(img)) card.append(h('p', { class: 'notice' }, "상품 디테일 검수 전이야. 원본과 비교해서 승인해야 '사용 가능'이 되고 발행 준비 완료로 바꿀 수 있어."));
    if (risk.real && img && img.kind === 'ai' && img.composite) card.append(h('p', { class: 'notice' }, "진짜 제품 사진을 참고한 'AI 합성 이미지'야. 참고한 사진과 모양·글자·버튼이 같은지 확인하고, 실제로 써본 사진처럼 쓰지 마."));
    else if (risk.real && (!img || img.kind === 'ai')) card.append(h('p', { class: 'notice' }, risk.msg));
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
      const own = s.n && IMG.isOwnPhotoSlot(s.text);
      row2.append(risk.real ? up : ai, btn('실제 사진 찾기', 'sm ghost', () => stockSheet(p, s)), risk.real ? ai : up, btn('보관함에서', 'sm ghost', () => pickSheet(p, s)),
        own ? null : btn('상품 사진으로 장면 만들기', 'sm ghost', () => prd().start({ postId: p.id, slotKey: s.key })));
    } else {
      row2.append(btn('미리보기·내려받기', 'sm', () => previewSheet(p, s)), btn('바꾸기', 'sm ghost', () => chooser(p, s, img)),
        img.kind === 'ai' ? btn('다시 만들기', 'sm ghost', () => regen(p, s, d, img), { disabled: running }) : null,
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
    const box = det('img-cost:' + p.id, `이미지 생성 비용 — ${t.count || 0}번 (비용 반영 ${t.billed || 0}번)${Number(t.reviews || 0) ? ` + AI 검수 ${t.reviews}번` : ''} · ${usd(t.usd || 0)}${t.krw != null && Number(t.usd) > 0 ? ' ≈ ' + L.won(t.krw) : ''}${Number(t.n_actual || 0) < Number(t.billed || 0) || Number(t.review_usd || 0) > 0 ? ' (예상 포함)' : ''}`, false, '');
    const inner = h('div', { class: 'stack', style: 'margin-top:8px' });
    inner.append(h('p', { class: 'hint' }, "예상: 요청 전에 공식 가격표로 계산한 값 · 사용량 기준: 공급자(OpenAI·Gemini)가 알려준 사용량(토큰) × 가격 · 청구액 확인: 공급자 사용량 화면에서 확인해 직접 넣은 금액. 앱은 실제 청구액을 직접 가져오지 못해."),
      h('p', { class: 'hint' }, st.image_fx_krw ? `원화는 환율 ${L.fmtNum(st.image_fx_krw)}원/달러 기준 (${st.image_fx_date || '날짜 없음'}${st.image_fx_source ? ' · ' + st.image_fx_source : ''}). 기록마다 그때 환율로 계산해.` : '환율을 아직 안 넣어서 원화로 바꾸지 않았어 (설정 > 이미지).'));
    if (t.uncertain) inner.append(h('p', { class: 'notice' }, `청구됐는지 확인이 필요한 생성 기록이 ${t.uncertain}개 있어. 그 공급자 사용량 화면(OpenAI·Google AI Studio)에서 확인하고 아래에서 청구액을 넣어줘.`));
    // AI 검수는 청구액을 넣는 칸이 없어서 '확인 필요'는 예상 비용으로 남음 — 생성 기록과 따로 알려줌 (1.5.0 검토)
    if (t.review_uncertain) inner.append(h('p', { class: 'hint' }, `AI 검수 ${t.review_uncertain}번은 청구됐는지 몰라서 예상 비용으로 셈했어 (검수는 청구액을 따로 넣지 않아).`));
    if (Number(t.reviews || 0)) inner.append(h('p', { class: 'hint' }, `AI 검수 ${t.reviews}번 · ${usd(t.review_usd || 0)} (위 합계에 포함 — 사용량 기준, 없으면 예상)`));
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

  // ═════════ AI로 만들기 (1.5.0: 모드·이미지 종류·참고 사진·장면 설계서·후보 여러 장) ═════════
  // 키가 있는지: 서버가 알려준 '있음/없음'만 봄 (점검용 가짜 모델은 키 없이)
  const keyOk = (keys, provider) => !!(keys && (provider === 'cloudflare' ? keys.cloudflare : provider === 'openai' ? keys.openai : provider === 'gemini' ? keys.gemini : false));
  const noKeyText = (provider) => (provider === 'cloudflare' ? 'Cloudflare 계정 ID·토큰이 없어서 아직 못 만들어. 설정 > 이미지에서 방법을 봐줘.'
    : provider === 'gemini' ? 'Gemini API 키가 없어서 아직 못 만들어. 설정 > 이미지에서 방법을 봐줘.' : 'OpenAI 키가 없어서 아직 못 만들어. 설정 > 이미지에서 방법을 봐줘.');
  // 무료 모델용 작은 사본: 서명 주소에서 원본을 받아 500px 안으로 줄여 JPEG로 → 서버에 한 번만 올려 둠 (보관함 이미지는 늘지 않음)
  async function ensureSmall(img) {
    if (!img || img.ref_small_path) return img;
    const src = await loadSource(img);
    const scale = Math.min(1, 500 / Math.max(src.W, src.H));
    const w = Math.max(1, Math.round(src.W * scale)), hh = Math.max(1, Math.round(src.H * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = hh;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, hh);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src.el, 0, 0, w, hh);
    const blob = await canvasToBlob(cv, 'image/jpeg', 0.9);
    cv.width = 0; cv.height = 0;
    const fd = new FormData();
    fd.append('file', blob, 'small.jpg');
    const j = await api(`/images/${img.id}/small`, { method: 'POST', body: fd });
    img.ref_small_path = (j && j.image && j.image.ref_small_path) || 'ok';
    return img;
  }
  // 모드 고르기 목록: 설정의 모드 4가지. 설정의 모델·기본 품질과 똑같은 모드가 없으면 '설정의 기본값'을 맨 앞에 두고 그걸로 시작
  // (설정은 낮음인데 '보통' 모드로 시작하는 것처럼, 사용자가 고르지 않은 더 비싼 값으로 시작하지 않게 — 1.5.0 검토). 고치기는 고치기가 되는 모델만
  function modeChoices(st, mode) {
    const all = IMG.resolveModes(st).filter((m) => mode !== 'edit' || m.caps.edit);
    const dflt = String((mode === 'edit' ? st.image_edit_model : st.image_gen_model) || '');
    const out = all.map((m) => ({ ...m }));
    const cm = dflt === TEST_MODEL ? 'gpt-image-2.5-flare' : dflt;
    const q0 = dflt ? IMG.normQuality(cm, String(st.image_quality || 'medium')) : '';
    if (dflt && !out.some((m) => m.model === dflt && m.quality === q0)) {
      const caps = IMG.modelCaps(cm);
      out.unshift({ id: 'settings', label: mode === 'edit' ? '설정의 편집 모델' : '설정의 기본값', model: dflt, quality: q0, caps, paid: !caps.free && dflt !== TEST_MODEL });
    }
    const pick = out.find((m) => m.model === dflt && m.quality === q0) || out[0];
    return { list: out, pick: pick ? pick.id : '' };
  }
  function genSheet(p, s, o = {}) {
    const d = dataOf(p.id) || {};
    const st = settings();
    const base = o.base || null;
    const prev = o.prev || null;
    const mode = base ? 'edit' : 'generate';
    const choices = modeChoices(st, mode);
    const prevLines = prev ? String(prev.user_prompt || '').split('\n') : [];
    const purpose0 = (prev && prev.purpose) || (s.row && s.row.purpose) || IMG.slotPurpose(s.key);
    const rec = IMG.recommendPreset({ post: p, slot: s, purpose: purpose0 });
    const f = {
      // 다시 만들기: 전에 쓴 모델·품질과 같은 모드 → 모델만 같은 모드 (없으면 설정과 같은 모드)
      modeId: (prev && (choices.list.find((m) => m.model === prev.model && m.quality === prev.quality) || choices.list.find((m) => m.model === prev.model)) || {}).id || o.modeId || choices.pick,
      purpose: IMG.PURPOSES[purpose0] ? purpose0 : 'blog_body', ratio: '',
      preset: prev && prev.style ? IMG.presetOf(prev.style) : rec.id,
      text: o.text != null ? o.text : mode === 'edit' ? '' : prev ? prevLines[0] || s.text : s.text, extra: prev ? prevLines.slice(1).join(' ') : '',
      quality: '', count: 1, refs: (o.refs || []).slice(), scene: {},
    };
    // 다시 만들기: 그 이미지에 남은 참고 사진(역할)·이미지 종류를 되살림 (생성 기록에는 없어서 이미지 기록에서 — 1.5.0 검토).
    // 고친 'AI 합성' 이미지는 고치기 전 원본의 참고 사진으로. 이 글 이미지에 없는 사진(다른 글 보관함에서 고른 것)은 서버에 물어봄 — 받는 동안은 못 만듦
    const prevImg = o.prevImg || null;
    let lostRefs = 0, refsPending = 0;
    // 고치기 창(같은 원본을 다시 고침)은 그 고치기에 붙였던 참고 사진만 — 원본의 참고 사진은 원본에 이미 들어 있음
    const prevRefs = !prevImg ? [] : base ? prevImg.ref_images || [] : lineageRefs(d, prevImg);
    const missing = [];
    for (const r of prevRefs) {
      const role = IMG.REF_ROLES[r.role] ? r.role : 'style';
      const im = (d.images || []).find((x) => x.id === r.image_id && !x.deleted_at);
      if (im) { if (!f.refs.some((y) => y.image.id === im.id)) f.refs.push({ image: im, role }); } else missing.push({ id: r.image_id, role });
    }
    // 진짜 제품 사진을 참고한 합성인데 그 사진을 못 찾은 경우 (고치기 창은 원본이 합성이라 괜찮음)
    const lostComposite = !!(prevImg && prevImg.composite && !prevRefs.length && !base);
    if (prevImg && prevImg.preset && IMG.PRESETS[prevImg.preset]) f.preset = prevImg.preset;
    // 설정의 용도별 기본 비율 (없으면 용도의 첫 비율)
    const prefRatio = (pu) => { const r = (st.image_ratio_prefs || {})[pu]; return IMG.PURPOSES[pu].ratios.includes(r) ? r : IMG.PURPOSES[pu].ratios[0]; };
    f.ratio = base ? IMG.defaultRatio(base, f.purpose) : prefRatio(f.purpose);
    const cur = () => choices.list.find((m) => m.id === f.modeId) || choices.list[0] || { model: '', caps: IMG.modelCaps(''), quality: 'medium' };
    const modelOf = () => cur().model;
    const isTest = () => modelOf() === TEST_MODEL;
    const capsModel = () => (isTest() ? 'gpt-image-2.5-flare' : modelOf()); // 점검용 가짜 모델은 크기·품질 규칙을 2.5처럼 (서버와 같게)
    const caps = () => IMG.modelCaps(capsModel());
    f.quality = IMG.normQuality(capsModel(), (prev && prev.quality) || cur().quality || st.image_quality || 'medium');
    const prods = ui.productsOf(p.id) || [];
    const brands = prods.map((x) => x.brand).filter(Boolean);
    const hide = prods.flatMap((x) => [x.brand, x.name, x.model]).filter((v) => v && String(v).trim().length >= 2);
    const modeSel = h('select', { value: f.modeId, name: 'mode' }, choices.list.map((m) => opt(m.id, `${m.label} — ${m.caps.label || m.model}${m.caps.free ? ' (무료)' : m.model === TEST_MODEL ? ' (점검용)' : ' (유료)'}`)));
    const modeInfo = h('div', { class: 'stack' });
    const presetSel = h('select', { value: f.preset, name: 'preset' }, Object.entries(IMG.PRESETS).map(([k, v]) => opt(k, `${v.label}${k === rec.id ? ' (추천)' : ''}`)));
    const presetHint = h('p', { class: 'hint' });
    const purposeSel = h('select', { value: f.purpose, name: 'purpose' }, Object.entries(IMG.PURPOSES).map(([k, v]) => opt(k, v.label)));
    const ratioSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '비율' });
    const countSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '몇 장' });
    const textTa = h('textarea', { value: f.text, maxlength: '300', style: 'min-height:70px', placeholder: mode === 'edit' ? '예: 조명만 더 자연스럽게 / 배경은 그대로 두고 강아지 자세만' : '' });
    const extraTa = h('textarea', { value: f.extra, maxlength: '400', style: 'min-height:56px', placeholder: '예: 밝은 오전 햇살, 위에서 내려다본 구도' });
    const qualSel = h('select', { name: 'quality' });
    const f0 = { text: f.text, extra: f.extra }; // 처음 채워 둔 값 (이것과 같으면 '적던 내용'이 아님)
    const genericChk = h('input', { type: 'checkbox' });
    const genericText = h('span', null, '');
    const genericRow = h('label', { class: 'chk' }, genericChk, genericText);
    const riskBox = h('div', { class: 'stack' });
    const refBox = h('div', { class: 'stack' });
    const sceneBox = h('div', { class: 'stack' });
    const costBox = h('div', { class: 'costbox' });
    const promptPre = h('pre', { class: 'prompt' });
    const scenePre = h('pre', { class: 'prompt' });
    const msg = h('div');
    // serverEst: 서버가 '예상 비용이 바뀌었어'라며 알려준 값 {usd, key: 모델|크기|품질}. 지금 고른 것과 같을 때만, 화면 계산보다 크면 그걸 보여주고 그걸로 확인을 보냄
    // newModel: 다른 기기에서 설정의 모델을 바꿔서 서버가 다른 모델로 계산한 경우 (창을 다시 열어야 함)
    let busy = false, lastEst = null, lastTotal = null, serverEst = null, newModel = '', batch = null, results = [];
    const goBtn = btn('만들기', 'wide', () => submit());
    const usage = () => (dataOf(p.id) || {}).usage || null;
    const refsOut = () => f.refs.map((r) => ({ image_id: r.image.id, role: r.role }));
    const gateRefs = () => f.refs.map((r) => ({ role: r.role, kind: r.image.kind }));
    // 고친 장면 칸: 금지 표현 검사는 그려 달라는 칸 전부(넣지 말 것·지역 빼고), 실제 상품 자리 판단은 주 피사체·꼭 보일 것만 — 서버와 같은 범위 (images.js)
    // 장면 설계서 칸 (고칠 수 있는 것만). 빈칸이면 원고·프리셋의 기본값
    const sceneInputs = {};
    const sceneField = (k, multi) => {
      const el = multi ? h('textarea', { style: 'min-height:48px', maxlength: '600' }) : h('input', { type: 'text', maxlength: '300' });
      el.addEventListener('input', () => { f.scene[k] = multi ? el.value.split('\n').map((x) => x.trim()).filter(Boolean) : el.value; update(); });
      sceneInputs[k] = el;
      return field(IMG.SCENE_LABELS[k], el);
    };
    const localeSel = h('select', {}, opt('', '원고대로 (한국을 뜻하는 말이 있으면 한국)'), opt('KR', '한국'), opt('none', '정하지 않음'));
    localeSel.addEventListener('change', () => { f.scene.locale = localeSel.value || undefined; update(); });
    const fillScene = (sc) => {
      for (const [k, el] of Object.entries(sceneInputs)) {
        if (document.activeElement === el) continue;
        const v = sc[k];
        el.placeholder = Array.isArray(v) ? v.join('\n') : String(v || '(원고에 없음 — 비워 두면 넣지 않아)');
        el.value = f.scene[k] == null ? '' : Array.isArray(f.scene[k]) ? f.scene[k].join('\n') : f.scene[k];
      }
    };
    if (prevImg && prevImg.scene && typeof prevImg.scene === 'object' && mode !== 'edit') {
      const base0 = IMG.buildScene({ post: p, slot: s, text: clean(f.text), preset: f.preset, purpose: f.purpose, ratio: f.ratio, extra: clean(f.extra), mode, hide, refs: [...refsOut(), ...missing.map((x) => ({ image_id: x.id, role: x.role }))], channel: p.channel_id });
      for (const k of IMG.SCENE_EDITABLE) {
        if (k === 'locale') { if (prevImg.scene.locale !== base0.locale) f.scene.locale = prevImg.scene.locale === 'KR' ? 'KR' : 'none'; continue; }
        let v = prevImg.scene[k];
        // '꼭 보일 것'의 '참고 사진 속 대상…' 줄은 앱이 저절로 넣은 것 — 사용자가 쓴 줄로 되살리지 않음 (지금 대상 사진이 있으면 다시 저절로 들어감)
        if (k === 'must_show' && Array.isArray(v)) {
          v = v.filter((x) => x !== IMG.SUBJECT_MUST_SHOW);
          if ((base0.must_show || []).includes(IMG.SUBJECT_MUST_SHOW)) v = [IMG.SUBJECT_MUST_SHOW, ...v];
        }
        if (v == null || JSON.stringify(v) === JSON.stringify(base0[k])) continue;
        f.scene[k] = Array.isArray(v) ? (v.length ? v.slice(0, 8) : ['없음']) : String(v) === '' ? '없음' : String(v);
      }
    }
    if (missing.length) {
      refsPending = missing.length;
      Promise.all(missing.map((x) => api('/images/' + x.id).then((j) => ({ x, im: (j && j.image) || null }), () => ({ x, im: null })))).then((rs) => {
        for (const { x, im } of rs) {
          if (im && !im.deleted_at) { if (!f.refs.some((y) => y.image.id === im.id)) f.refs.push({ image: im, role: x.role }); } else lostRefs++;
        }
        refsPending = 0;
        if (goBtn.isConnected) update();
      });
    }
    const scene0 = JSON.stringify(f.scene); // 처음 채운 장면 칸 (이것과 같으면 '적던 내용'이 아님)
    const update = () => {
      f.modeId = modeSel.value; f.preset = presetSel.value; f.purpose = purposeSel.value; f.text = textTa.value; f.extra = extraTa.value;
      const m = cur(), c = caps();
      const qs = IMG.qualitiesFor(capsModel());
      if (!qs.includes(f.quality)) f.quality = IMG.normQuality(capsModel(), qualSel.value || m.quality || 'medium');
      if (qualSel.dataset.model !== capsModel()) { put(qualSel, ...qs.map((q) => opt(q, IMG.qualityLabel(capsModel(), q)))); qualSel.dataset.model = capsModel(); }
      qualSel.value = f.quality;
      const ratios = IMG.PURPOSES[f.purpose].ratios;
      if (!ratios.includes(f.ratio)) f.ratio = prefRatio(f.purpose);
      put(ratioSeg, ...ratios.map((r) => h('button', { type: 'button', 'aria-pressed': String(r === f.ratio), onclick: () => { f.ratio = r; update(); } }, r)));
      put(countSeg, ...[1, 2, 3].map((n) => h('button', { type: 'button', 'aria-pressed': String(n === f.count), disabled: mode === 'edit' && n > 1, onclick: () => { f.count = n; update(); } }, n === 1 ? '1장' : `${n}장 비교`)));
      const P = IMG.PRESETS[f.preset];
      presetHint.textContent = `${P.hint}${f.preset === rec.id ? '' : ` (추천은 '${IMG.PRESETS[rec.id].label}' — ${rec.why})`}`;
      // 참고 사진: 이 모델이 받는 만큼만
      const maxRefs = IMG.refsLimit(capsModel(), mode);
      put(refBox,
        maxRefs ? h('p', { class: 'hint' }, `참고 사진은 ${maxRefs}장까지 (${c.label}${mode === 'edit' ? ' · 고칠 이미지 포함 ' + c.refsMax + '장' : ''}). 진짜 제품 사진은 '대상 모양 유지'로 넣어 — 그래도 작은 글자·로고는 바뀔 수 있으니 만든 뒤 원본과 비교해줘.`)
          : h('p', { class: 'hint' }, `${c.label || modelOf() || '이 모델'}은 참고 사진을 못 받아. 진짜 제품 사진을 넣으려면 참고 사진이 되는 모드를 골라줘 (무료 FLUX.2 klein · OpenAI · Gemini).`),
        maxRefs && c.refSmall ? h('p', { class: 'notice' }, `무료 모델은 참고 사진을 ${c.refSmall}px 안으로 줄인 사본으로 받아 (공식 제한: 512px보다 작게). 작은 글자·로고는 거의 안 남으니 모양을 크게 지켜야 하면 유료 모델이 나아.`) : null,
        ...f.refs.map((r, i) => {
          const sel = h('select', { value: r.role, 'aria-label': '참고 사진 역할' }, Object.entries(IMG.REF_ROLES).map(([k, v]) => opt(k, v.label)));
          sel.addEventListener('change', () => { r.role = sel.value; update(); });
          return h('div', { class: 'refrow' }, thumb(r.image, null),
            h('div', { class: 'stack' }, h('small', null, `${IMG.originLabel(r.image)}${r.image.kind !== 'ai' && r.image.kind !== 'card' && r.image.source_type !== 'own' ? ' · 이용 조건 확인 필요' : ''}`), sel,
              h('span', { class: 'hint' }, IMG.REF_ROLES[r.role].hint)),
            btn('빼기', 'sm ghost', () => { f.refs.splice(i, 1); update(); }));
        }),
        maxRefs && f.refs.length < maxRefs ? h('div', { class: 'go' }, btn('보관함에서 참고 사진 고르기', 'sm ghost', () => refPicker(p, f.refs, () => { form(); update(); })),
          btn('참고 사진 올리기', 'sm ghost', () => refUpload(p, f.refs, () => { form(); update(); }))) : null,
        f.refs.length > maxRefs ? h('p', { class: 'badbox' }, `이 모델은 참고 사진을 ${maxRefs}장까지만 받아. ${f.refs.length - maxRefs}장을 빼줘.`) : null,
        refsPending ? h('p', { class: 'hint' }, `전에 쓴 참고 사진 ${refsPending}장을 불러오는 중…`) : null,
        lostRefs ? h('p', { class: 'notice' }, `전에 쓴 참고 사진 ${lostRefs}장은 찾지 못해서 빠졌어 (지웠을 수 있어). 필요하면 다시 골라줘.`) : null,
        lostComposite ? h('p', { class: 'notice' }, "이 이미지는 진짜 제품 사진을 참고한 'AI 합성'인데, 그때 쓴 제품 사진을 찾지 못했어. 같은 제품으로 만들려면 제품 사진을 다시 골라줘.") : null);
      const size = IMG.sizeFor(f.purpose, f.ratio, capsModel(), f.quality);
      const sc = IMG.buildScene({ post: p, slot: s, text: clean(f.text), preset: f.preset, purpose: f.purpose, ratio: f.ratio, extra: clean(f.extra), mode, hide, refs: refsOut(), size: IMG.sizeLabel(size), channel: p.channel_id, overrides: f.scene });
      fillScene(sc);
      localeSel.value = f.scene.locale || '';
      put(sceneBox, ...(sc.notes || []).map((n) => h('p', { class: 'hint' }, '· ' + n)));
      const prompt = IMG.promptFromScene(sc);
      promptPre.textContent = prompt;
      scenePre.textContent = JSON.stringify(sc, null, 2);
      const model = modelOf();
      const clientEst = isTest() ? 0 : IMG.estimateUsd({ quality: f.quality, size, promptTokens: IMG.estimateTokens(prompt), mode, prices: prices(), model, refs: f.refs.length });
      const sEst = serverEst && serverEst.key === `${model}|${size}|${f.quality}` ? serverEst.usd : null;
      const est = clientEst == null ? null : sEst != null && sEst > clientEst ? sEst : clientEst;
      lastEst = est;
      lastTotal = est == null ? null : IMG.roundUsd(est * f.count);
      const sceneTxt = IMG.sceneDrawText(f.scene);
      // 서버처럼 설명·더 원하는 것과 장면 칸을 따로 검사 (이어 붙이면 '…로고' + '없이…'가 '로고 없이'로 읽힘)
      const risks = IMG.promptRisk(f.text + '\n' + f.extra, brands);
      for (const r of sceneTxt ? IMG.promptRisk(sceneTxt, brands) : []) if (!risks.some((x) => x.code === r.code)) risks.push(r);
      const blocks = IMG.blocksOf(risks);
      const gateText = [f.text, f.extra, IMG.sceneGateText(f.scene)].join(' ');
      const gate = s.n ? IMG.aiGate(s.text, { text: gateText, refs: gateRefs(), genericOk: genericChk.checked, baseComposite: !!(base && base.composite) }) : { ok: true };
      const sr = IMG.slotRisk(gateText);
      const own = gate.code === 'own_photo_slot';
      const realNeeded = !own && s.n && IMG.slotRisk(`${IMG.stripOwnMark(s.text)} ${gateText}`).real && !gate.composite;
      genericText.textContent = ' 실제 상품·화면이 아니라 일반 장면으로 만들게 (특정 제품처럼 보이지 않게 — 실제 구성품·라벨·화면은 직접 찍은 사진이나 진짜 제품 사진 참고로)';
      put(riskBox, ...risks.map((r) => h('p', { class: r.level === 'block' ? 'badbox' : 'notice' }, r.msg)),
        own ? h('p', { class: 'badbox' }, gate.msg) : '',
        !own && (realNeeded || (sr.real && !gate.composite)) ? h('p', { class: 'notice' }, IMG.slotRisk(`${IMG.stripOwnMark(s.text)} ${gateText}`).msg || sr.msg) : '',
        !own && realNeeded && f.refs.some((r) => r.role === 'subject' && !IMG.REAL_KINDS.includes(r.image.kind)) ? h('p', { class: 'notice' }, "AI로 만든 이미지는 '대상 모양 유지'로 넣어도 진짜 제품 사진이 아니라서 실제 상품 자리를 채우지 못해. 직접 올린 사진이나 Pexels 사진을 넣어줘.") : '',
        !own && realNeeded ? genericRow : '',
        gate.composite ? h('p', { class: 'notice' }, "진짜 제품 사진을 참고해서 만들어. 결과는 'AI 합성'으로 표시되고, 실제로 써본 사진처럼 쓰면 안 돼.") : '');
      const u = usage();
      const fx = Number(st.image_fx_krw) || 0;
      const over = u && lastTotal != null && Number(u.month_usd) + lastTotal > Number(u.budget_usd) + 1e-9;
      const capOver = u && lastTotal != null && u.request_cap_usd != null && lastTotal > Number(u.request_cap_usd) + 1e-9;
      const limit = u && Number(u.today) + f.count > Number(u.daily_limit);
      const prov = IMG.PROVIDERS[c.provider] || null;
      const keyGood = isTest() || keyOk(d.keys, c.provider);
      put(modeInfo,
        h('span', { class: 'hint' }, `${prov ? prov.label : '공급자 모름'} · ${model || '(모델 없음)'}${c.status === 'preview' ? ' · 미리보기(preview) 모델' : ''}${c.deprecated ? ' · 이전 모델' : ''}`),
        h('span', { class: 'chip ' + (keyGood ? 'v-ok' : 'v-no') }, isTest() ? '점검용 (실제 생성 아님)' : keyGood ? (c.free ? '키 있음 · 무료' : '키 있음') : '키 없음'));
      const basis = isTest() ? '점검용 가짜 모델 — 비용 없음' : IMG.costBasis({ quality: f.quality, size, promptTokens: IMG.estimateTokens(prompt), mode, prices: prices(), model, refs: f.refs.length });
      put(costBox,
        h('span', null, `공급자·모델: ${prov ? prov.label : '?'} · ${model}`),
        h('span', null, `장수: ${f.count}장${f.count > 1 ? ' (같은 설명으로 후보를 만들어 고르기)' : ''} · 품질 ${IMG.qualityLabel(capsModel(), f.quality)} · 크기 ${IMG.sizeLabel(size)}`),
        c.free ? h('b', { class: 'num' }, `무료 (${prov ? prov.free_note : ''})`)
          : h('b', { class: 'num' }, est == null ? '예상 비용을 계산하지 못했어' : f.count > 1 ? `예상 ${usd(est)} × ${f.count}장 = ${usd(lastTotal)}${fx && lastTotal ? ' ≈ ' + L.won(lastTotal * fx) : ''}` : `예상 ${usd(est)}${fx && est ? ' ≈ ' + L.won(est * fx) : ''}`),
        h('span', { class: 'hint' }, `계산 근거: ${basis}`),
        c.free ? h('span', { class: 'hint' }, '무료 모델은 한국어 설명을 영어로 바꿔서 그려 (사람·글자에는 약해). 마음에 안 들면 설명을 구체적으로 적고 다시 만들어줘.') : null,
        sEst != null && est === sEst ? h('span', { class: 'notice' }, `서버에서 다시 계산한 예상 비용이 ${usd(sEst)}이야 (설정·가격·원고가 바뀐 것 같아). 확인하고 다시 눌러줘.`) : null,
        !c.flexible && !c.aspect && !isTest() && c.known ? h('span', { class: 'hint' }, `이 모델은 정해진 크기(${IMG.sizeLabel(size)})로만 만들어. 만든 이미지를 이 자리에 연결하면 내려받을 때 ${f.ratio}로 잘라 줄게 (미리보기에서 자르는 곳을 고를 수 있어).`) : null,
        c.conservative && !isTest() && !c.free ? h('span', { class: 'notice' }, '이 모델은 공식 가격표에서 장당 가격을 확인하지 못해서 예상 비용을 넉넉하게 잡았어. 실제 청구액은 공급자 사용량 화면에서 확인해줘.') : null,
        c.deprecated ? h('span', { class: 'hint' }, '공급자가 이전 모델(Deprecated)로 표시한 모델이야. 되도록 새 모델을 써줘.') : null,
        h('span', { class: 'hint' }, fx ? `환율 ${L.fmtNum(fx)}원/달러 (${st.image_fx_date || '날짜 없음'}${st.image_fx_source ? ' · ' + st.image_fx_source : ''})` : '환율을 넣으면 원화로도 보여줘 (설정 > 이미지)'),
        c.free || isTest() ? null : h('span', { class: 'hint' }, c.provider === 'openai' ? `예상 비용이야 (가격표 ${(prices().checked_at) || '확인일 없음'} 기준). 실제 청구액은 OpenAI 사용량 화면에서 확인해야 하고 조금 다를 수 있어.`
          : `예상 비용이야 (가격표 ${c.checked || '확인일 없음'} 기준). 실제 청구액은 ${prov ? prov.label : '공급자'} 사용량 화면에서 확인해야 하고 조금 다를 수 있어.`),
        u ? h('span', { class: 'hint' }, `${usageLine(u)} · 남은 예산 ${usd(Math.max(0, Number(u.budget_usd) - Number(u.month_usd)))}${u.request_cap_usd != null ? ` · 한 번에 ${usd(u.request_cap_usd)}까지` : ''}`) : null);
      let why = '';
      if (newModel) why = `설정의 ${mode === 'edit' ? '편집' : '생성'} 모델이 바뀌었어 (${model} → ${newModel}). 이 창을 닫고 다시 열어줘.`;
      else if (!model) why = '쓸 모델이 없어. 설정 > 이미지에서 모델을 골라줘.';
      else if (!isTest() && !c.known) why = `앱이 모르는 모델이라(${model}) 만들 수 없어. 설정 > 이미지에서 목록에 있는 모델로 바꿔줘.`;
      else if (!keyGood) why = noKeyText(c.provider);
      else if (mode === 'edit' && !c.edit) why = '이 모델은 고치기(편집)를 못 해. 고치기가 되는 모드를 골라줘.';
      else if (refsPending) why = '전에 쓴 참고 사진을 불러오는 중이야. 잠깐만.';
      else if (f.refs.length > maxRefs) why = f.refs.length && !maxRefs ? '이 모델은 참고 사진을 못 받아. 참고 사진을 빼거나 다른 모드를 골라줘.' : `참고 사진이 너무 많아 (${maxRefs}장까지).`;
      else if (!isTest() && c.provider && !c.usable) why = `공급자가 종료한 모델이야 (${c.retired}). 다른 모드를 골라줘.`;
      else if (!clean(f.text)) why = mode === 'edit' ? '바꿀 내용을 적어줘.' : '사진 설명을 적어줘.';
      else if (blocks.length) why = '빨간 내용을 고쳐야 만들 수 있어.';
      else if (own) why = "'직접 찍기' 자리는 AI로 만들지 않아. 휴대폰으로 찍어서 '파일 올리기'로 넣어줘.";
      else if (!gate.ok) why = '실제 상품·화면이 보여야 하는 자리야. 진짜 제품 사진을 참고 사진(대상 모양 유지)으로 넣거나, 직접 찍은 사진을 올리거나, 일반 장면으로 만들겠다고 체크해줘.';
      else if (limit) why = `오늘 만들 수 있는 횟수가 모자라 (${f.count}장 필요). 설정 > 이미지에서 하루 한도를 바꿀 수 있어.`;
      else if (over) why = '이번 달 예산을 넘게 돼서 못 만들어. (설정 > 이미지에서 한 달 예산)';
      else if (capOver) why = `한 번에 쓸 수 있는 금액(${usd(u.request_cap_usd)})을 넘어. 장수를 줄이거나 설정 > 이미지에서 '한 번 상한'을 바꿔줘.`;
      else if (u && u.running) why = '다른 이미지를 만드는 중이야. 끝나면 다시 해줘.';
      const verb = mode === 'edit' ? '고치기' : '만들기';
      goBtn.textContent = busy ? '보내는 중…' : est == null ? verb : f.count > 1 ? `예상 ${usd(lastTotal)} (${f.count}장) · ${verb}` : `예상 ${usd(est)} · ${verb}`;
      goBtn.disabled = !!why || busy || est == null;
      if (!busy) put(msg, why ? h('p', { class: 'hint' }, why) : '');
    };
    // 모드를 바꾸면 그 모드에 정해 둔 품질로 (모드 = 모델 + 품질). 그 뒤에 품질 칸에서 따로 바꿀 수 있음
    modeSel.addEventListener('change', () => { f.modeId = modeSel.value; f.quality = IMG.normQuality(capsModel(), cur().quality || 'medium'); });
    for (const el of [modeSel, presetSel, purposeSel]) el.addEventListener('change', () => { serverEst = null; update(); });
    qualSel.addEventListener('change', () => { f.quality = qualSel.value; update(); });
    for (const el of [textTa, extraTa]) el.addEventListener('input', update);
    genericChk.addEventListener('change', update);
    const examples = mode === 'edit' ? h('div', { class: 'go' }, ...['조명만 더 자연스럽게 바꿔줘', '배경은 그대로 두고 자세만 바꿔줘', '피사체는 그대로, 카메라 각도를 조금 높여줘', '전체를 다시 만들지 말고 요청한 부분만 고쳐줘'].map((t) =>
      h('button', { type: 'button', class: 'copy', onclick: () => { textTa.value = textTa.value.trim() ? textTa.value.trim() + ' / ' + t : t; update(); } }, t))) : null;
    const form = () => {
      const sceneDet = det('gen-scene', '장면 설계서 (고칠 수 있어)', false, 'plain');
      sceneDet.append(h('p', { class: 'hint' }, "비워 둔 칸은 원고와 이미지 종류의 기본값을 써 (흐린 글씨). 원고에 없는 계절·날씨·장소는 넣지 않아. 잘못 읽은 칸은 '없음'이라고 쓰면 빼."), sceneBox,
        sceneField('subject'), sceneField('setting'), sceneField('time'), field(IMG.SCENE_LABELS.locale, localeSel), sceneField('camera'), sceneField('light'), sceneField('color'),
        sceneField('materials'), sceneField('composition'), sceneField('must_show', true), sceneField('avoid', true),
        h('div', { class: 'go' }, btn('기본값으로', 'sm ghost', () => { f.scene = {}; for (const el of Object.values(sceneInputs)) el.value = ''; localeSel.value = ''; update(); })));
      const promptDet = det('gen-prompt', 'AI에 보낼 내용 보기', false, 'plain');
      promptDet.append(promptPre, h('p', { class: 'legend' }, '장면 설계서 (JSON)'), scenePre);
      const refDet = det('gen-refs', `참고 사진 (${f.refs.length})`, f.refs.length > 0, 'plain');
      refDet.append(refBox);
      openSheet(`${slotName(s)} — AI ${mode === 'edit' ? '이미지 고치기' : '이미지 만들기'}`,
        s.n ? h('p', { class: 'hint' }, `사진 자리: ${s.text}`) : h('p', { class: 'hint' }, s.label || ''),
        base ? h('div', { class: 'stack' }, thumb(base, null), h('p', { class: 'hint' }, '이 이미지를 고쳐서 새로 만들어 (원본은 그대로 남고, 고친 이미지는 수정 이력으로 이어져).')) : null,
        field('모드', modeSel), modeInfo,
        field('이미지 종류', presetSel), presetHint,
        field('어디에 쓸 이미지야?', purposeSel), h('p', { class: 'legend' }, '비율'), ratioSeg,
        field(mode === 'edit' ? '바꿀 내용' : '사진 설명 (고쳐도 돼)', textTa, mode === 'edit' ? '바꿀 부분만 적어줘. 나머지는 그대로 두라고 같이 보내.' : '글자·로고·가격·인증 마크는 이미지에 넣지 않아. 글자는 카드뉴스에서 따로 얹어.'),
        examples,
        field('더 원하는 것 (선택)', extraTa),
        refDet, sceneDet,
        field('품질', qualSel, '높을수록 비싸고 오래 걸려. 블로그는 보통이면 충분해.'),
        mode === 'edit' ? null : h('p', { class: 'legend' }, '몇 장 만들까'), mode === 'edit' ? null : countSeg,
        riskBox, promptDet,
        costBox, msg, goBtn,
        mode === 'edit' ? null : h('div', { class: 'go' }, btn('여러 모델로 비교하기', 'sm ghost', () => compareSheet(p, s, { ...f, refs: f.refs.slice(), scene: { ...f.scene }, genericOk: genericChk.checked }))),
        h('p', { class: 'hint' }, '버튼을 누를 때만 만들어. 같은 요청은 한 번만 보내고, 여러 장이면 한 장씩 차례로 만들어.'));
      // 처음 채워 둔 설명·더 원하는 것을 고쳤으면 창 밖을 눌러도 안 닫힘 (안 고쳤으면 그냥 닫힘)
      if (ui.setSheetGuard) ui.setSheetGuard(() => clean(textTa.value) === clean(f0.text) && clean(extraTa.value) === clean(f0.extra) && JSON.stringify(f.scene) === scene0);
    };
    // 창을 닫거나 다른 창을 열면(=지금 보이는 만들기 버튼이나 진행 창이 화면에서 사라지면) 기다리던 다시 보내기를 멈춤 — 사용자가 누르지 않은 생성이 시작되지 않게.
    // 첫 장은 만들기 버튼, 두 번째 장부터는 진행 창의 상태 줄을 봄 (1.5.0 검토)
    let liveEl = null;
    const alive = () => (liveEl || goBtn).isConnected;
    const say = (node) => (liveEl && liveEl.isConnected ? put(liveEl, node) : put(msg, node));
    const wait = async (sec) => {
      for (let t = Math.max(1, Math.round(sec)); t > 0; t--) {
        if (!alive()) return false;
        say(h('span', null, `서버가 다른 일을 마무리하는 중이야. ${t}초 뒤에 같은 요청으로 다시 보낼게 (돈은 아직 안 나갔어). 창을 닫으면 멈춰.`));
        await sleep(1000);
      }
      return alive();
    };
    const bodyFor = (rk, i) => ({
      request_key: rk, post_id: p.id, slot_key: s.key, mode, base_image_id: base ? base.id : undefined, purpose: f.purpose, ratio: f.ratio, preset: f.preset, style: f.preset,
      text: clean(f.text), extra: clean(f.extra), quality: f.quality, model: modelOf(), refs: refsOut(), scene: Object.keys(f.scene).length ? f.scene : undefined,
      confirm_usd: lastEst, generic_ok: genericChk.checked || undefined,
      batch: f.count > 1 ? { id: batch.id, kind: 'candidates', index: i, total: f.count } : undefined,
      reserve_usd: f.count > 1 && lastEst != null ? IMG.roundUsd(lastEst * (f.count - i)) : undefined,
    });
    const submit = async () => {
      if (busy) return;
      liveEl = null;
      busy = true; update();
      put(msg, h('p', { class: 'hint' }, '보내는 중…'));
      batch = f.count > 1 ? { id: newUuid(), keys: Array.from({ length: f.count }, () => newKey()), done: [] } : { id: null, keys: [newKey()], done: [] };
      results = [];
      await sendOne(0);
    };
    // 무료 모델(FLUX.2 klein)은 참고 사진·고칠 이미지를 512px보다 작은 사본으로 받음 → 없으면 먼저 만들어 올림 (원본은 그대로)
    const smallNeeded = () => (caps().provider === 'cloudflare' && !isTest() ? [...(base ? [base] : []), ...f.refs.map((r) => r.image)].filter((x) => x && !x.ref_small_path) : []);
    const makeSmall = async (list) => {
      for (const im of list) {
        put(msg, h('p', { class: 'hint' }, '무료 모델에 보낼 작은 사본을 만드는 중… (원본은 그대로)'));
        await ensureSmall(im);
      }
    };
    // i번째 한 장: 보내기 → (서버가 바쁘면 기다렸다 같은 번호로) → 진행 상황 → 끝나면 다음 장
    const sendOne = async (i) => {
      if (i === 0) {
        try { await makeSmall(smallNeeded()); } catch (e) {
          busy = false; update();
          if (e && e.code === 'auth') return;
          put(msg, h('p', { class: 'badbox' }, '작은 사본을 만들지 못했어: ' + ((e && e.code ? ui.errText(e) : e && e.message) || '이유 모름')));
          return;
        }
      }
      const body = bodyFor(batch.keys[i], i);
      let j = null;
      for (let attempt = 0; attempt < 4 && !j; attempt++) {
        try { j = await sendGenerate(body); } catch (e) {
          if (e && e.code === 'server_busy' && attempt < 3 && await wait(Number(e.retry_after) || 3)) continue;
          // 다른 기기에서 고른 사진처럼 사본이 아직 없으면 만들고 한 번 더 (돈 안 나감)
          if (e && e.code === 'ref_small_missing' && attempt < 3 && alive()) {
            const ids = new Set(e.ids || []);
            try { await makeSmall([...(base ? [base] : []), ...f.refs.map((r) => r.image)].filter((x) => x && ids.has(x.id))); continue; } catch { /* 아래 오류 안내로 */ }
          }
          busy = false;
          if (!e || e.code === 'auth' || !alive()) return;
          if (e.code === 'estimate_changed') {
            // 서버가 계산한 값은 그 모델·크기·품질에만 씀 (품질을 바꾸면 화면 계산으로 돌아감)
            serverEst = { usd: Number(e.est_usd), key: `${e.model}|${e.size}|${e.quality}` };
            if (e.model && e.model !== modelOf()) newModel = String(e.model);
            toast(ui.errText(e), 4000);
            ui.load(); // 다른 기기에서 바꾼 설정·가격을 다시 받음
            if (i > 0) { showBatch(); return; }
            update();
            return;
          }
          if (i > 0) { results.push({ error: e }); showBatch(); return; }
          update();
          const again = e.code === 'timeout' || e.code === 'network';
          put(msg, h('p', { class: 'badbox' }, ui.errText(e)), ...((e.risks || []).map((r) => h('p', { class: 'badbox' }, r.msg))),
            again ? h('p', { class: 'hint' }, '다시 누르면 같은 요청 번호로 보내서, 서버가 이미 받았으면 그 결과를 보여줘 (두 번 만들지 않아).') : null);
          return;
        }
      }
      if (!j) { busy = false; if (i > 0 && alive()) { showBatch(); return; } update(); return; }
      if (!alive()) {
        busy = false;
        // 보낸 뒤에 창을 닫았어도 서버는 이미 받아서 만들고 있음 → 이미지 칸에 '만드는 중'이 보이게 새로 받음 (남은 장은 안 만듦)
        if (j.generation && j.generation.status === '생성 중') toast(i > 0 ? `창을 닫았지만 ${i + 1}번째 장은 서버에서 만드는 중이야. 남은 장은 안 만들어.` : '창을 닫았지만 서버에서 만드는 중이야. 끝나면 사진 자리에서 볼 수 있어.', 4000);
        refresh(p.id);
        return;
      }
      if (j.duplicate) toast('이미 받은 요청이야. 그 결과를 보여줄게.', 3000);
      progress(j.generation, i);
    };
    const progress = (gen, i) => {
      const t0 = Date.now();
      const timer = h('b', { class: 'num' }, '0초');
      let stop = false;
      const statusLine = h('p', { class: 'hint' });
      openSheet(`${slotName(s)} — AI ${mode === 'edit' ? '고치기' : '만들기'}`,
        h('div', { class: 'genprog' }, h('i', { class: 'spin', 'aria-hidden': 'true' }), h('span', null, f.count > 1 ? `${i + 1}/${f.count}장 만드는 중… ` : '만드는 중… '), timer),
        h('p', { class: 'hint' }, f.count > 1 ? '한 장씩 차례로 만들어. 이 창을 닫으면 지금 만드는 장까지만 서버에서 끝내고, 남은 장은 만들지 않아 (돈도 안 나가).' : '보통 20초~1분, 길면 2분까지 걸려. 이 창을 닫아도 서버에서 계속 만들고, 끝나면 사진 자리에서 고를 수 있어.'),
        statusLine,
        results.length ? h('div', { class: 'grid3' }, results.filter((r) => r.image).map((r) => thumb(r.image, null))) : null);
      liveEl = statusLine; // 다음 장을 보내는 동안(서버가 바쁨 등) 이 창이 열려 있는지·안내를 여기로
      ui.setSheetOnClose(() => { stop = true; busy = false; refresh(p.id); });
      const tick = setInterval(() => { if (!timer.isConnected) { clearInterval(tick); return; } timer.textContent = Math.round((Date.now() - t0) / 1000) + '초'; }, 1000);
      const poll = async () => {
        if (stop) return;
        let r;
        try { r = await api('/images/generations/' + gen.id); } catch (e) { if (e && e.code === 'auth') return; setTimeout(poll, 5000); return; }
        if (stop) return;
        const g = r.generation;
        if (g.status === '생성 중') { setTimeout(poll, Date.now() - t0 > 60e3 ? 5000 : 3000); return; }
        clearInterval(tick);
        serverEst = null;
        if (C[p.id] && C[p.id].data) C[p.id].data.usage = r.usage;
        results.push({ generation: g, image: g.status === '성공' ? r.image : null });
        if (i + 1 < f.count && g.status === '성공') { await sendOne(i + 1); return; }
        busy = false;
        if (f.count > 1) showBatch();
        else if (g.status === '성공' && r.image) showResult(g, r.image); else showFail(g);
      };
      setTimeout(poll, 2500);
    };
    const resultCard = (g, img, single) => {
      const c = genCost(g);
      const secs = g.started_at && g.finished_at ? Math.max(1, Math.round((Date.parse(g.finished_at) - Date.parse(g.started_at)) / 1000)) : null;
      return h('div', { class: 'slot on' },
        thumb(img, null),
        h('div', { class: 'chips' }, kindChip(img), reviewChip(img)),
        h('p', { class: 'hint' }, `${g.model} · ${img.width}×${img.height} · 품질 ${IMG.qualityLabel(g.model, g.quality)}${secs ? ` · ${secs}초` : ''} · 비용 ${usd(c.usd)} (${c.label})`),
        btn(single ? `이 이미지 쓰기 → ${slotName(s)}에 연결` : `이걸로 쓰기 → ${slotName(s)}`, single ? 'wide' : 'sm', async (ev) => { const j = await linkTo(p, s, img, ev.currentTarget, IMG.PURPOSES[g.purpose] ? { purpose: g.purpose } : null); if (j) closeSheet(); }),
        IMG.productSceneMode(img) ? h('p', { class: 'notice' }, "실제 상품이 보여야 하는 자리에 진짜 상품 사진을 참고해서 만든 'AI 합성 이미지'야. 상품 디테일 검수에서 원본과 비교해서 승인해야 써.") : null,
        h('div', { class: 'go' },
          IMG.productSceneMode(img) ? btn('상품 디테일 검수', 'sm', () => prd().checkSheet(img, { onDone: (im) => { Object.assign(img, im); refresh(p.id); } })) : null,
          btn('AI 검수 (참고용)', 'sm ghost', () => reviewSheet(p, img, { back: () => (single ? showResult(g, img) : showBatch()), slot: s })),
          IMG.modelCaps(g.model).edit || IMG.resolveModes(settings()).some((m) => m.caps.edit) ? btn('고치기', 'sm ghost', () => genSheet(p, s, { base: img })) : null));
    };
    const showResult = (g, img) => {
      openSheet(`${slotName(s)} — 다 만들었어`,
        resultCard(g, img, true),
        h('ul', { class: 'lic' }, h('li', null, '이미지 안에 글자·로고·가격이 생기지 않았는지'), h('li', null, img.composite ? '참고한 제품 사진과 모양·글자·버튼이 같은지 (다르면 쓰지 마)' : '실제 상품 사진처럼 보이지 않는지 (이건 AI 예시 이미지야)'), h('li', null, '사진 자리 설명과 맞는지')),
        h('p', { class: 'hint' }, IMG.productSceneMode(img) ? "쓰기 전에 위를 확인하고, '상품 디테일 검수'에서 승인해줘." : "쓰기 전에 위를 확인해줘. 미리보기에서 '사용 가능'으로 바꾸면 검수 완료야."),
        h('div', { class: 'go' }, btn('다시 만들기', 'sm ghost', () => { busy = false; form(); update(); }), btn('보관함에만 두고 닫기', 'sm ghost', closeSheet)));
      ui.setSheetOnClose(() => refresh(p.id));
    };
    const showBatch = () => {
      const ok = results.filter((r) => r.image);
      const failed = results.filter((r) => !r.image);
      openSheet(`${slotName(s)} — 후보 ${ok.length}장`,
        ok.length ? h('p', { class: 'hint' }, '같은 설명으로 만든 후보야. 마음에 드는 걸 골라서 연결해 (안 고른 건 보관함에 남아). 앱이 대신 고르지 않아.') : null,
        ...ok.map((r) => resultCard(r.generation, r.image, false)),
        ...failed.map((r) => h('p', { class: 'badbox' }, r.generation ? `못 만든 장: ${r.generation.error_message || '이유 없음'}` : ui.errText(r.error))),
        // 다 못 만들었으면 몇 장 만들었는지·보내지 않은 장(돈 안 나감)을 알려줌. 못 만든 장의 이유는 위 빨간 칸에 (1.5.0 검토)
        ok.length < f.count ? h('p', { class: 'notice' }, `${f.count}장 중 ${ok.length}장만 만들었어.${f.count > results.length ? ` 남은 ${f.count - results.length}장은 보내지 않았어 (그 장은 돈이 안 나가).` : ''}`) : null,
        h('div', { class: 'go' }, btn('다시 만들기', 'sm ghost', () => { busy = false; form(); update(); }), btn('보관함에만 두고 닫기', 'sm ghost', closeSheet)));
      ui.setSheetOnClose(() => refresh(p.id));
    };
    const showFail = (g) => {
      const billed = g.cost_status === '청구 없음' ? '청구되지 않았을 거야.' : "청구됐을 수 있어. 공급자 사용량 화면에서 확인하고, 이 글의 '이미지 생성 비용'에서 청구액을 넣어줘.";
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

  // ═════════ 참고 사진 고르기·올리기 (1.5.0) ═════════
  // 실제 사진(직접 올림·Pexels)은 '대상 모양 유지'로, AI 이미지는 '구도·스타일 참고'로 먼저 고름 (바꿀 수 있음)
  const defaultRole = (img) => (img.kind === 'upload' || img.kind === 'stock' ? 'subject' : 'style');
  function refPicker(p, refs, back) {
    const d = dataOf(p.id) || {};
    const taken = new Set(refs.map((r) => r.image.id));
    const mine = (d.images || []).filter((i) => !i.deleted_at && i.kind !== 'card' && !taken.has(i.id));
    let tab = mine.length ? 'mine' : 'all', all = [], next = null, lseq = 0;
    const seg = h('div', { class: 'seg', role: 'group' });
    const box = h('div', { class: 'stack' });
    const choose = (img) => { refs.push({ image: img, role: defaultRole(img) }); back(); };
    const grid = (list) => (list.length ? h('div', { class: 'grid3' }, list.map((i) => pickThumb(i, () => choose(i)))) : h('p', { class: 'hint' }, '고를 이미지가 없어. 참고 사진 올리기로 넣어줘.'));
    const loadAll = async (more, button) => {
      const my = ++lseq;
      if (button) button.disabled = true;
      if (!more) put(box, h('p', { class: 'hint' }, '불러오는 중…'));
      try {
        const j = await api('/images' + (more && next ? '?before=' + encodeURIComponent(next) : ''));
        if (my !== lseq || tab !== 'all') return;
        all = (more ? all.concat(j.images) : j.images).filter((i) => i.kind !== 'card' && !taken.has(i.id)); next = j.next;
        put(box, grid(all), next ? btn('더 보기', 'sm ghost', (ev) => loadAll(true, ev.currentTarget)) : null);
      } catch (e) { if (my === lseq && e && e.code !== 'auth') put(box, h('p', { class: 'hint' }, ui.errText(e))); }
    };
    const draw = () => {
      put(seg, ...[['mine', `이 글 이미지 ${mine.length}`], ['all', '보관함 전체']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(k === tab), onclick: () => { tab = k; draw(); } }, l)));
      if (tab === 'mine') { lseq++; put(box, grid(mine)); } else loadAll(false);
    };
    openSheet('참고 사진 고르기',
      h('p', { class: 'hint' }, "진짜 제품 사진은 고른 뒤 역할을 '대상 모양 유지'로 둬. 다른 사람 사진·공식 이미지는 이용 조건을 먼저 확인해줘."),
      seg, box, h('div', { class: 'go' }, btn('돌아가기', 'sm ghost', back)));
    draw();
  }
  function refUpload(p, refs, back) {
    const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': '참고 사진 파일' });
    const pickLabel = h('span', null, '사진 고르기');
    const picker = h('label', { class: 'btn sm filebtn' }, pickLabel, input);
    const preview = h('div', { class: 'stack' });
    const rights = h('input', { type: 'checkbox' });
    const srcSel = sourceSelect('own');
    const desc = h('input', { type: 'text', value: '', maxlength: '300', placeholder: '예: 우리 집 제습기 정면' });
    let ready = null, prevUrl = null;
    const goBtn = btn('올리고 참고 사진으로 쓰기', 'wide', () => send(), { disabled: true });
    const dropUrl = () => { if (prevUrl) { URL.revokeObjectURL(prevUrl); prevUrl = null; } };
    input.addEventListener('change', async () => {
      ready = null; goBtn.disabled = true; dropUrl();
      const file = input.files && input.files[0];
      if (!file) return;
      pickLabel.textContent = '다른 사진 고르기';
      put(preview, h('p', { class: 'hint' }, '확인하는 중…'));
      try { ready = await prepareUpload(file); } catch (e) { put(preview, h('p', { class: 'badbox' }, (e && e.message) || '이 파일은 올릴 수 없어.')); return; }
      prevUrl = URL.createObjectURL(ready.blob);
      put(preview, h('img', { class: 'big', src: prevUrl, alt: '참고 사진 미리보기' }), h('span', { class: 'hint' }, `${ready.w}×${ready.h} · ${fmtBytes(ready.blob.size)} · 숨은 정보(촬영 위치 등)는 빼고 올려`));
      goBtn.disabled = false;
    });
    const send = async () => {
      if (!ready) return;
      if (!rights.checked) { toast(IMAGE_ERR.rights_required); return; }
      const fd = new FormData();
      fd.append('meta', JSON.stringify({ post_id: p.id, purpose: 'general', rights: true, description: desc.value.trim() || '참고 사진', link: false, source_type: srcSel.value }));
      fd.append('file', ready.blob, ready.name);
      const j = await run(goBtn, () => api('/images/upload', { method: 'POST', body: fd }).catch((e) => { throw e && e.code === 'too_large' ? { code: 'bad_image', reason: 'too_big' } : e; }));
      if (j && j.image) { dropUrl(); refs.push({ image: j.image, role: 'subject' }); toast(j.reused ? '같은 사진이 보관함에 있어서 그걸 참고 사진으로 넣었어' : '참고 사진으로 넣었어'); back(); }
    };
    openSheet('참고 사진 올리기',
      h('p', { class: 'hint' }, '진짜 제품 사진(직접 찍은 사진이 제일 좋아)을 올리면 AI가 그 모양을 유지하려고 해. 보관함에도 남아 (이 사진 자체는 원고 자리에 연결하지 않아).'),
      h('div', { class: 'go' }, picker), preview,
      field('이 사진은 어디서 났어?', srcSel, '공식·외부 사진을 참고하면 그 사진의 이용 조건을 따라야 해.'),
      h('label', { class: 'chk' }, rights, '내가 찍었거나 쓸 권한이 있는 사진이야'),
      field('사진 설명', desc), goBtn, h('div', { class: 'go' }, btn('돌아가기', 'sm ghost', () => { dropUrl(); back(); })));
    ui.setSheetOnClose(dropUrl);
  }

  // ═════════ AI 검수 (참고용 — 품질 보증 아님) ═════════
  const VERDICT = { ok: ['괜찮아', 'v-ok'], issue: ['확인 필요', 'v-no'], unsure: ['판단 어려움', 'v-unk'] };
  function reviewView(r, img, p, s) {
    if (!r) return null;
    if (r.status === '실패') return h('p', { class: 'badbox' }, `AI 검수를 못 했어: ${r.error_message || r.error_code || '이유 없음'}`);
    const checks = (r.scores && r.scores.checks) || {};
    return h('div', { class: 'stack' },
      h('p', { class: 'notice' }, `AI(${r.model}) 의견이야 — 품질을 보장하는 점수가 아니고 틀릴 수 있어. 쓸지 말지는 네가 정해.`),
      r.summary ? h('p', null, r.summary) : null,
      h('ul', { class: 'lic' }, ...IMG.REVIEW_CHECKS.filter(([k]) => checks[k]).map(([k, label]) => {
        const c = checks[k];
        const v = VERDICT[c.verdict] || VERDICT.unsure;
        return h('li', null, h('span', { class: 'chip ' + v[1] }, v[0]), ` ${label}`, c.reason ? h('small', null, ` — ${c.reason}`) : null,
          c.confidence != null ? h('small', { class: 'hint' }, ` (확신 ${Math.round(Number(c.confidence) * 100)}%)`) : null);
      })),
      r.uncertainty ? h('p', { class: 'hint' }, `불확실한 점: ${r.uncertainty}`) : null,
      (r.suggestions || []).length ? h('div', { class: 'stack' }, h('p', { class: 'legend' }, 'AI가 제안한 고칠 점'),
        ...r.suggestions.map((t) => h('div', { class: 'go' }, h('span', null, t),
          img.kind === 'ai' && s ? btn('이걸로 고치기', 'sm ghost', () => genSheet(p, s, { base: img, text: t })) : null))) : null,
      h('p', { class: 'hint' }, `비용 ${usd(r.cost_status === '청구 없음' ? 0 : r.usage_usd ?? r.est_usd)} (${r.cost_status})`));
  }
  function reviewSheet(p, img, o = {}) {
    const st = settings();
    const d = dataOf(p.id) || {};
    const keys = d.keys || {};
    const opts = IMG.REVIEW_MODELS.map((m) => ({ ...m, ok: keyOk(keys, m.provider) }));
    // 처음 고른 것: 설정의 검수 모델 → 키가 있는 무료 모델 → 없으면 아무것도 안 고름 (유료 모델을 대신 고르지 않음 — 1.5.0 검토)
    const pick0 = opts.find((m) => m.id === st.image_review_model && m.ok) || opts.find((m) => m.ok && m.free) || null;
    const sel = h('select', { value: pick0 ? pick0.id : '', 'aria-label': '검수할 AI' }, pick0 ? null : opt('', '검수할 AI를 골라줘'), opts.map((m) => opt(m.id, `${m.label}${m.free ? ' (무료)' : ' (유료)'}${m.ok ? '' : ' — 키 없음'}`)));
    sel.value = pick0 ? pick0.id : '';
    const costLine = h('p', { class: 'hint' });
    const out = h('div', { class: 'stack' });
    const goB = btn('AI 검수 받기', 'wide', () => go());
    // 서버도 참고 사진은 3장까지만 같이 보냄. 고친 'AI 합성' 이미지는 원본의 참고 사진을 같이 보냄 (서버 lineageRefs)
    const nImgs = 1 + Math.min(3, lineageRefs(d, img).length || 0);
    let serverEst = null; // 서버가 다르게 계산한 예상 {model, usd} — 화면 값보다 크면 그걸 보여주고 그걸로 확인을 보냄
    const upd = () => {
      const m = opts.find((x) => x.id === sel.value);
      const local = m ? IMG.estimateReviewUsd(m.id, nImgs) : null;
      const est = local != null && serverEst && serverEst.model === sel.value && serverEst.usd > local ? serverEst.usd : local;
      const adopted = local != null && est !== local;
      costLine.textContent = m ? (adopted ? `예상 ${usd(est)} — 서버가 다시 계산한 값이야 (원본의 참고 사진처럼 더 보내는 이미지 포함). 확인하고 다시 눌러줘 — 이미지 비용(예산)에 같이 셈` : m.free ? `무료 (${IMG.PROVIDERS[m.provider].free_note}) · 이미지 ${nImgs}장을 보내` : `예상 ${usd(est)} · 이미지 ${nImgs}장 + 짧은 답 (근거: ${IMG.reviewBasis(m.id, nImgs)}) — 이미지 비용(예산)에 같이 셈`) : '';
      goB.disabled = !m || !m.ok || est == null;
      goB.dataset.est = est == null ? '' : String(est);
    };
    sel.addEventListener('change', upd);
    const go = async () => {
      const j = await run(goB, async () => {
        try { return await api(`/images/${img.id}/review`, { method: 'POST', body: { model: sel.value, confirm_usd: Number(goB.dataset.est), post_id: p.id, slot_key: o.slot ? o.slot.key : undefined }, timeout: 90000 }); } catch (e) {
          // 서버가 계산한 예상이 다르면(원본의 참고 사진까지 보내는 경우 등) 그 값을 보여주고 다시 누르게 — 확인 없이 더 비싸게 시작하지 않음
          if (e && e.code === 'estimate_changed' && Number.isFinite(Number(e.est_usd))) { serverEst = { model: String(e.model || sel.value), usd: Number(e.est_usd) }; upd(); }
          throw e;
        }
      });
      if (j && j.review) { put(out, reviewView(j.review, img, p, o.slot)); refresh(p.id); }
    };
    openSheet('AI 검수 (참고용)',
      thumb(img, null),
      h('p', { class: 'hint' }, '원고의 사진 자리와 맞는지, 이상한 물체·글자·로고, 사람·동물 형태, 물리적으로 이상한 곳, 구도·조명, 잘랐을 때 잘리는지, 실제 제품으로 오해할 만한지를 봐줘.'),
      field('검수할 AI', sel), costLine, goB, out,
      h('p', { class: 'hint' }, '앱이 대신 고르거나 지우지 않아. 원본은 그대로 남아.'),
      o.back ? h('div', { class: 'go' }, btn('돌아가기', 'sm ghost', o.back)) : null);
    upd();
    api('/images/' + img.id).then((j) => { const last = (j.reviews || []).find((r) => r.kind === 'ai_review'); if (last && !out.childNodes.length) put(out, h('p', { class: 'legend' }, '지난 AI 검수'), reviewView(last, img, p, o.slot)); }).catch(() => {});
  }

  // ═════════ 모델 비교 (같은 설명·비율·참고 사진으로) ═════════
  function compareSheet(p, s, f0) {
    const d = dataOf(p.id) || {};
    const st = settings();
    const keys = d.keys || {};
    const modes = IMG.resolveModes(st);
    // 처음에는 키가 있는 모드 중 모델이 서로 다른 것 두 개를 고름 (같은 모델을 품질만 바꿔 비교하지 않게 — 바꿀 수 있음)
    const picks = new Set();
    for (const m of modes) {
      if (picks.size >= 2) break;
      if (keyOk(keys, m.caps.provider) && ![...picks].some((id) => modes.find((x) => x.id === id).model === m.model)) picks.add(m.id);
    }
    const list = h('div', { class: 'stack' });
    const costBox = h('div', { class: 'costbox' });
    const msg = h('div');
    const goB = btn('비교 만들기', 'wide', () => start());
    let rows = [], busy = false;
    const prods = ui.productsOf(p.id) || [];
    const hide = prods.flatMap((x) => [x.brand, x.name, x.model]).filter((v) => v && String(v).trim().length >= 2);
    const refsOut = () => (f0.refs || []).map((r) => ({ image_id: r.image.id, role: r.role }));
    const plan = () => modes.filter((m) => picks.has(m.id)).map((m) => {
      const q = IMG.normQuality(m.model, m.quality);
      const size = IMG.sizeFor(f0.purpose, f0.ratio, m.model, q);
      const sc = IMG.buildScene({ post: p, slot: s, text: clean(f0.text), preset: f0.preset, purpose: f0.purpose, ratio: f0.ratio, extra: clean(f0.extra), hide, refs: refsOut(), size: IMG.sizeLabel(size), channel: p.channel_id, overrides: f0.scene });
      const tokens = IMG.estimateTokens(IMG.promptFromScene(sc));
      const est = IMG.estimateUsd({ quality: q, size, promptTokens: tokens, prices: prices(), model: m.model, refs: refsOut().length });
      return { m, q, size, est, tokens, ok: keyOk(keys, m.caps.provider), refsOk: refsOut().length <= (m.caps.refsMax || 0) };
    });
    const update = () => {
      put(list, ...modes.map((m) => {
        const c = h('input', { type: 'checkbox' });
        c.checked = picks.has(m.id);
        c.disabled = !keyOk(keys, m.caps.provider) || (!picks.has(m.id) && picks.size >= 3);
        c.addEventListener('change', () => { if (c.checked) picks.add(m.id); else picks.delete(m.id); update(); });
        return h('label', { class: 'chk' }, c, ` ${m.label} — ${m.caps.label} (${IMG.PROVIDERS[m.caps.provider] ? IMG.PROVIDERS[m.caps.provider].label : '?'})${keyOk(keys, m.caps.provider) ? '' : ' · 키 없음'}`);
      }));
      rows = plan();
      const total = rows.reduce((a, r) => a + (r.est == null ? NaN : r.est), 0);
      const u = (dataOf(p.id) || {}).usage || null;
      put(costBox, ...rows.flatMap((r) => [
          h('span', null, `${r.m.caps.label} (${r.m.model}): ${IMG.qualityLabel(r.m.model, r.q)} · ${IMG.sizeLabel(r.size)} · ${r.m.caps.free ? '무료' : r.est == null ? '계산 못 함' : '예상 ' + usd(r.est)}${r.refsOk ? '' : ' · 참고 사진을 못 받는 모델(빼고 비교 안 됨)'}`),
          h('span', { class: 'hint' }, `계산 근거: ${IMG.costBasis({ quality: r.q, size: r.size, promptTokens: r.tokens, prices: prices(), model: r.m.model, refs: refsOut().length })}`)]),
        h('b', { class: 'num' }, Number.isFinite(total) ? `합계 예상 ${usd(IMG.roundUsd(total))}` : '합계를 계산하지 못했어'),
        u ? h('span', { class: 'hint' }, `${usageLine(u)} · 남은 예산 ${usd(Math.max(0, Number(u.budget_usd) - Number(u.month_usd)))}`) : null,
        h('span', { class: 'hint' }, '같은 설명·비율·참고 사진으로 한 번씩 만들어. 한두 번 비교로 어느 모델이 늘 낫다고 단정할 수는 없어.'));
      // 실제 상품 자리·'직접 찍기' 자리는 만들기 창과 같은 판단 (서버도 다시 확인)
      const gate = s.n ? IMG.aiGate(s.text, { text: [f0.text, f0.extra, IMG.sceneGateText(f0.scene)].join(' '), refs: (f0.refs || []).map((r) => ({ role: r.role, kind: r.image.kind })), genericOk: !!f0.genericOk }) : { ok: true };
      let why = '';
      if (!gate.ok) why = gate.msg || IMAGE_ERR[gate.code] || '이 자리는 AI로 만들 수 없어.';
      else if (rows.length < 2) why = '비교할 모드를 2~3개 골라줘 (키가 있는 것만).';
      else if (rows.some((r) => !r.refsOk)) why = '참고 사진을 못 받는 모델이 있어. 그 모델을 빼거나 참고 사진을 빼고 비교해줘.';
      else if (!Number.isFinite(total)) why = '예상 비용을 계산하지 못한 모델이 있어.';
      else if (u && Number(u.today) + rows.length > Number(u.daily_limit)) why = '오늘 만들 수 있는 횟수가 모자라.';
      else if (u && Number(u.month_usd) + total > Number(u.budget_usd) + 1e-9) why = '이번 달 예산을 넘게 돼.';
      else if (u && u.request_cap_usd != null && total > Number(u.request_cap_usd) + 1e-9) why = `한 번에 쓸 수 있는 금액(${usd(u.request_cap_usd)})을 넘어.`;
      goB.disabled = !!why || busy;
      goB.textContent = busy ? '만드는 중…' : Number.isFinite(total) ? `예상 ${usd(IMG.roundUsd(total))} (${rows.length}장) · 비교 만들기` : '비교 만들기';
      if (!busy) put(msg, why ? h('p', { class: 'hint' }, why) : '');
    };
    const results = [];
    const batchId = newUuid();
    const start = async () => {
      if (busy) return;
      busy = true; update();
      const todo = rows.slice();
      // 무료 모델(FLUX.2 klein)이 들어 있으면 참고 사진의 작은 사본을 먼저 만들어 올림 (원본은 그대로, 돈 안 나감)
      if (todo.some((r) => r.m.caps.provider === 'cloudflare') && (f0.refs || []).length) {
        put(msg, h('p', { class: 'hint' }, '무료 모델에 보낼 작은 사본을 만드는 중… (원본은 그대로)'));
        try { for (const r of f0.refs) await ensureSmall(r.image); } catch (e) {
          busy = false; update();
          if (!e || e.code !== 'auth') put(msg, h('p', { class: 'badbox' }, '작은 사본을 만들지 못했어: ' + ((e && e.code ? ui.errText(e) : e && e.message) || '이유 모름')));
          return;
        }
      }
      for (let i = 0; i < todo.length; i++) {
        if (!goB.isConnected && i > 0) break;
        const r = todo[i];
        const reserve = IMG.roundUsd(todo.slice(i).reduce((a, x) => a + (x.est || 0), 0));
        const body = { request_key: newKey(), post_id: p.id, slot_key: s.key, mode: 'generate', purpose: f0.purpose, ratio: f0.ratio, preset: f0.preset, style: f0.preset,
          text: clean(f0.text), extra: clean(f0.extra), quality: r.q, model: r.m.model, refs: refsOut(), scene: Object.keys(f0.scene || {}).length ? f0.scene : undefined,
          confirm_usd: r.est, generic_ok: f0.genericOk || undefined, batch: { id: batchId, kind: 'compare', index: i, total: todo.length }, reserve_usd: reserve };
        put(msg, h('div', { class: 'genprog' }, h('i', { class: 'spin', 'aria-hidden': 'true' }), h('span', null, `${i + 1}/${todo.length} ${r.m.caps.label} 만드는 중…`)));
        let j = null;
        // 서버가 바쁘면(돈 나가기 전) 알려준 초만큼 기다렸다 같은 요청 번호로 다시 (최대 3번, 창을 닫으면 멈춤)
        let err = null;
        for (let attempt = 0; attempt < 4 && !j; attempt++) {
          try { j = await sendGenerate(body); err = null; } catch (e) {
            err = e;
            if (e && e.code === 'auth') return;
            if (!(e && e.code === 'server_busy' && attempt < 3 && goB.isConnected)) break;
            put(msg, h('p', { class: 'hint' }, `서버가 다른 일을 마무리하는 중이야. ${Math.max(1, Math.round(Number(e.retry_after) || 3))}초 뒤에 같은 요청으로 다시 보낼게 (돈은 아직 안 나갔어).`));
            await sleep(Math.max(1, Number(e.retry_after) || 3) * 1000);
            if (!goB.isConnected) break;
          }
        }
        if (!j) { results.push({ m: r.m, error: err || { code: 'server_busy' } }); continue; }
        let g = j.generation, img = null;
        for (let t = 0; t < 80 && g.status === '생성 중' && goB.isConnected; t++) {
          await sleep(t < 20 ? 3000 : 5000);
          try { const x = await api('/images/generations/' + g.id); g = x.generation; img = x.image; if (C[p.id] && C[p.id].data) C[p.id].data.usage = x.usage; } catch (e) { if (e && e.code === 'auth') return; }
        }
        results.push({ m: r.m, generation: g, image: img });
      }
      busy = false;
      // 창을 닫았거나 다른 창을 열었으면 결과 창을 다시 띄우지 않음 (서버는 보낸 장까지 끝냄 — 사진 자리·보관함에서 볼 수 있어)
      if (!goB.isConnected) { refresh(p.id); toast('모델 비교: 보낸 장까지만 만들고 멈췄어. 결과는 보관함에 있어.', 4000); return; }
      showResults();
    };
    const evalBox = (img, g) => {
      const sc = {};
      let pref = false;
      const segs = IMG.EVAL_CRITERIA.map(([k, label, inv]) => {
        const seg = h('div', { class: 'seg', role: 'group', 'aria-label': label });
        const draw = () => put(seg, ...[[3, inv ? '거의 없음' : '좋음'], [2, '보통'], [1, inv ? '많이 남' : '아쉬움']].map(([v, l]) =>
          h('button', { type: 'button', 'aria-pressed': String(sc[k] === v), onclick: () => { sc[k] = sc[k] === v ? undefined : v; draw(); } }, l)));
        draw();
        return h('div', { class: 'stack' }, h('small', null, label), seg);
      });
      const prefChk = h('input', { type: 'checkbox' });
      prefChk.addEventListener('change', () => { pref = prefChk.checked; });
      const save = btn('내 평가 저장', 'sm', async (ev) => {
        const b = ev.currentTarget; // await 뒤에는 ev.currentTarget 이 비어 있어서 먼저 잡아 둠
        const j = await run(b, () => api(`/images/${img.id}/evaluate`, { method: 'POST', body: { scores: sc, preferred: pref, batch_id: batchId } }), '평가를 저장했어 (AI 평가와 따로 남아)');
        if (j) b.textContent = '저장했어';
      });
      return h('div', { class: 'stack' }, h('p', { class: 'legend' }, '내 평가 (AI 평가와 따로 저장)'), ...segs, h('label', { class: 'chk' }, prefChk, ' 이 비교에서 제일 나아'), save);
    };
    const showResults = () => {
      openSheet(`${slotName(s)} — 모델 비교`,
        h('p', { class: 'hint' }, '같은 설명·비율·참고 사진으로 만든 결과야. 마음에 드는 걸 연결하고, 평가를 남기면 나중에 모델을 고를 때 참고할 수 있어 (앱이 대신 고르지 않아).'),
        ...results.map((r) => {
          if (!r.image) return h('div', { class: 'slot' }, h('b', null, r.m.caps.label), h('p', { class: 'badbox' }, r.generation ? r.generation.error_message || '못 만들었어' : ui.errText(r.error)));
          const g = r.generation, c = genCost(g);
          const secs = g.started_at && g.finished_at ? Math.max(1, Math.round((Date.parse(g.finished_at) - Date.parse(g.started_at)) / 1000)) : null;
          return h('div', { class: 'slot on' }, h('b', null, `${r.m.label} — ${r.m.caps.label}`), thumb(r.image, null),
            h('p', { class: 'hint' }, `${g.model} · 품질 ${IMG.qualityLabel(g.model, g.quality)} · ${r.image.width}×${r.image.height}${secs ? ` · ${secs}초` : ''} · 비용 ${usd(c.usd)} (${c.label})`),
            h('div', { class: 'go' }, btn(`이걸로 쓰기 → ${slotName(s)}`, 'sm', async (ev) => { const j = await linkTo(p, s, r.image, ev.currentTarget, IMG.PURPOSES[g.purpose] ? { purpose: g.purpose } : null); if (j) toast('연결했어'); }),
              btn('AI 평가 (참고용)', 'sm ghost', () => reviewSheet(p, r.image, { back: showResults, slot: s }))),
            evalBox(r.image, g));
        }),
        h('div', { class: 'go' }, btn('닫기', 'sm ghost', closeSheet)));
      ui.setSheetOnClose(() => refresh(p.id));
    };
    openSheet(`${slotName(s)} — 여러 모델로 비교`,
      h('p', { class: 'hint' }, `설명: ${clean(f0.text) || s.text} · ${IMG.PRESETS[f0.preset].label} · ${f0.ratio}${(f0.refs || []).length ? ` · 참고 사진 ${(f0.refs || []).length}장` : ''}`),
      h('p', { class: 'legend' }, '비교할 모드 (2~3개)'), list, costBox, msg, goB,
      h('div', { class: 'go' }, btn('돌아가기', 'sm ghost', () => genSheet(p, s, { modeId: f0.modeId, refs: f0.refs, text: f0.text }))));
    update();
  }

  // ═════════ 수정 이력 ═════════
  function lineageBox(img) {
    const box = h('div', { class: 'stack' }, h('p', { class: 'hint' }, '수정 이력 불러오는 중…'));
    api(`/images/${img.id}/lineage`).then((j) => {
      const items = j.items || [];
      if (items.length <= 1) { put(box, h('p', { class: 'hint' }, '고친 기록이 없어 (이 이미지가 원본이야).')); return; }
      put(box, h('p', { class: 'hint' }, '원본은 지우거나 덮어쓰지 않아. 고칠 때마다 새 이미지로 이어져.'),
        ...items.map((x) => {
          const c = x.cost ? genCost({ ...x.cost, est_usd: x.cost.est_usd }) : null;
          return h('div', { class: 'refrow', style: `margin-left:${Math.min(4, x.level) * 12}px` },
            x.url ? thumb({ url: x.url, alt_text: x.description }, null) : h('span', { class: 'hint' }, x.deleted ? '(지운 이미지)' : ''),
            h('div', { class: 'stack' }, h('small', null, `${x.level === 0 ? '원본' : `${x.level}번째 고침`}${x.id === img.id ? ' · 지금 보는 이미지' : ''}`),
              h('small', { class: 'hint' }, `${x.provider || x.kind} · ${x.model || ''}${c ? ` · ${usd(c.usd)} (${c.label})` : ''} · ${L.fmtTime(x.created_at)}`),
              x.user_prompt ? h('small', null, x.user_prompt) : null));
        }));
    }).catch((e) => put(box, h('p', { class: 'hint' }, ui.errText(e))));
    return box;
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
    const srcSel = sourceSelect('');
    const ownSlot = !!(s.n && IMG.isOwnPhotoSlot(s.text));
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
      fd.append('meta', JSON.stringify({ post_id: p.id, slot_key: s.key, purpose, rights: true, description: desc.value.trim(), link: true, source_type: srcSel.value }));
      fd.append('file', ready.blob, ready.name);
      const j = await run(goBtn, () => api('/images/upload', { method: 'POST', body: fd }).catch((e) => {
        throw e && e.code === 'too_large' ? { code: 'bad_image', reason: 'too_big' } : e; // 이미지는 '나눠서 올려줘'가 아니라 크기 안내로
      }));
      if (j) { dropUrl(); toast(j.reused ? '같은 사진이 보관함에 있어서 그걸 연결했어' : `${slotName(s)}에 연결했어`); closeSheet(); refresh(p.id); }
    };
    openSheet(`${slotName(s)} — 파일 올리기`,
      h('p', { class: 'hint' }, 'JPEG·PNG·WebP만, 한 장 8MB까지 (큰 사진은 올리기 전에 자동으로 줄여). GIF·HEIC·SVG는 안 돼.'),
      h('div', { class: 'go' }, picker), preview,
      field('이 사진은 어디서 났어?', srcSel, ownSlot ? "'직접 찍기' 자리야. 네가 찍은 사진이면 '내가 직접 찍은 사진'을 골라줘 — 그래야 직접 촬영 사진으로 셈." : "안 고르면 '출처 확인 필요'로 남아. 직접 찍은 사진으로는 세지 않아."),
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
    // 1.5.1: 상품 장면 이미지는 '사용 가능'을 누르면 상품 디테일 검수로 (승인해야 사용 가능 — 서버·DB도 막음)
    const pmode = IMG.productSceneMode(img);
    const drawReview = () => put(reviewSeg, ...['검수 전', '사용 가능', '사용 안 함'].map((v) =>
      h('button', { type: 'button', 'aria-pressed': String(v === img.review_status), onclick: async (ev) => {
        if (v === '사용 가능' && pmode && !IMG.productApproved(img)) { prd().checkSheet(img, { onDone: (im) => { Object.assign(img, im); refresh(p.id); } }); return; }
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
      dlBtn.textContent = pmode && !IMG.productApproved(img) ? `내려받기 (상품 검수 전) · ${file.name}` : img.review_status === '검수 전' ? `검수 완료하고 내려받기 · ${file.name}` : `내려받기 · ${file.name}`;
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
      // 상품 장면 이미지는 내려받아도 저절로 '사용 가능'이 되지 않음 (상품 디테일 검수 승인이 필요)
      const reviewNow = img.review_status === '검수 전' && !pmode;
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
      info.push(h('p', { class: 'hint' }, `${img.composite ? 'AI 합성 이미지 (실제 사진 참고)' : 'AI 생성'} · ${img.model}${g ? ' · ' + IMG.sizeLabel(g.size) + ' · 품질 ' + IMG.qualityLabel(g.model, g.quality) : ''}${c ? ` · 비용 ${usd(c.usd)} (${c.label})` : ''}`));
      if (pmode) info.push(h('div', { class: 'go' }, btn(IMG.productApproved(img) ? '상품 디테일 검수 (승인함)' : '상품 디테일 검수 · 승인', 'sm', () => prd().checkSheet(img, { onDone: (im) => { Object.assign(img, im); refresh(p.id); } })),
        btn('상품 장면 화면에서 이어 하기', 'sm ghost', () => { closeSheet(); prd().start({ resume: img.id, postId: p.id, slotKey: s.key }); })));
      info.push(h('ul', { class: 'lic' }, h('li', null, '글자·로고·가격이 생기지 않았는지'),
        h('li', null, img.composite ? '참고한 제품 사진과 모양·글자·버튼이 같은지 (다르면 쓰지 마)' : '실제 상품 사진처럼 보이지 않는지 (AI 예시 이미지야)'), h('li', null, '사진 자리 설명과 맞는지')));
      info.push(h('div', { class: 'go' }, btn('AI 검수 (참고용)', 'sm ghost', () => reviewSheet(p, img, { back: () => previewSheet(p, s), slot: s })),
        btn('고치기 (부분 수정)', 'sm ghost', () => genSheet(p, s, { base: img }))));
      const hist = det('img-hist:' + img.id, '수정 이력', false, 'plain');
      let histLoaded = false;
      hist.addEventListener('toggle', () => { if (hist.open && !histLoaded) { histLoaded = true; hist.append(lineageBox(img)); } });
      info.push(hist);
      const dd = det('img-prompt:' + img.id, 'AI에 보낸 내용(프롬프트) 보기', false, 'plain');
      dd.append(h('pre', { class: 'prompt' }, img.prompt || ''));
      if (img.scene) dd.append(h('p', { class: 'legend' }, '장면 설계서'), h('pre', { class: 'prompt' }, JSON.stringify(img.scene, null, 2)));
      info.push(dd);
      info.push(h('p', { class: 'hint' }, `블로그에 올릴 때 '${IMG.captionHint(img)}'를 사진 아래에 같이 넣어줘 (복사할 때 자동으로 들어가).`));
    } else if (img.kind === 'stock') {
      info.push(h('p', null, 'Photo by ', img.author_url ? h('a', { href: img.author_url, target: '_blank', rel: 'noopener noreferrer' }, img.author_name || '사진가') : (img.author_name || '사진가'),
        ' on ', img.source_url ? h('a', { href: img.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'Pexels') : 'Pexels'));
      info.push(h('p', { class: 'hint' }, `라이선스: ${img.license}`), h('div', { class: 'go' }, h('span', { class: 'sns' }, img.attribution_text), h('button', { type: 'button', class: 'copy', onclick: (ev) => ui.copyPlain(img.attribution_text, ev.currentTarget) }, '출처 문구 복사')));
    } else if (img.kind === 'upload') info.push(h('p', { class: 'hint' }, '직접 올린 사진 · 쓸 권한이 있다고 확인함'), sourcePicker(img, () => { refresh(p.id); }));
    else if (img.kind === 'composite') {
      info.push(h('p', { class: 'hint' }, `원본 보존 합성 · 상품은 원본 사진 픽셀 그대로, 배경은 AI가 만듦 (앱이 이 기기에서 합성)${img.attribution_text ? ' · ' + img.attribution_text : ''}`),
        h('div', { class: 'go' }, btn(IMG.productApproved(img) ? '상품 디테일 검수 (승인함)' : '상품 디테일 검수 · 승인', 'sm', () => prd().checkSheet(img, { onDone: (im) => { Object.assign(img, im); refresh(p.id); } })),
          btn('위치·크기 다시 맞추기', 'sm ghost', () => { closeSheet(); prd().start({ resume: img.id, postId: p.id, slotKey: s.key }); })),
        h('p', { class: 'hint' }, `블로그에 올릴 때 '${IMG.captionHint(img)}'를 사진 아래에 같이 넣어줘 (복사할 때 자동으로 들어가).`));
    } else info.push(h('p', { class: 'hint' }, `카드뉴스에서 만든 이미지${img.license && img.license.includes('배경') ? ' · ' + img.license.replace(/^카드뉴스 \(앱에서 직접 만듦\)\s*·\s*/, '') : ''}`));
    // 실제 사진은 AI로 고치지 않음 — 상품 사진이면 '이 상품으로 장면 만들기'에서 원본 보존 합성이나 AI 실사 장면으로 (두 방식을 고름)
    if (img.kind === 'upload' || img.kind === 'stock') {
      info.push(h('div', { class: 'go' }, btn('이 상품으로 장면 만들기', 'sm ghost', () => { closeSheet(); prd().start({ productId: img.id, postId: p.id, slotKey: s.key }); })),
        h('p', { class: 'hint' }, "원본 사진은 그대로 두고, 이 사진으로 새 장면을 만들어 — 상품을 원본 그대로 얹는 '원본 보존 합성'과, AI가 참고해서 다시 그리는 'AI 실사 장면' 중에 골라. '직접 찍기' 자리에는 못 써."));
    }
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
    const drawSeg = () => put(seg, ...[['', '전체'], ['ai', 'AI 생성'], ['composite', '상품 합성'], ['stock', '실제 사진'], ['upload', '직접 올림'], ['card', '카드뉴스']].map(([k, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(k === libKind), onclick: () => { libKind = k; drawSeg(); loadLib(false); } }, l)));
    const card = (i) => h('button', { type: 'button', class: 'pick', onclick: () => imageSheet(i.id, () => loadLib(false)) },
      i.url ? h('img', { src: i.url, alt: i.alt_text || i.description || '이미지', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'ph' }, '이미지'),
      h('small', null, [IMG.originLabel(i), i.review_status, i.uses ? `${i.uses}곳에서 사용` : '안 쓰는 중'].join(' · ')));
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
    pnl.append(h('h2', null, '이미지 보관함'), usageP,
      h('div', { class: 'go' }, btn('이 상품으로 장면 만들기', 'sm', () => prd().start({})), h('span', { class: 'hint' }, '상품 사진 하나로 블로그·SNS·광고용 장면 (원본 보존 합성 · AI 실사 장면)')),
      seg, grid, more,
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
    openSheet(IMG.originLabel(img) || '이미지',
      thumb(img, null), h('div', { class: 'chips' }, kindChip(img), reviewChip(img)),
      img.description ? h('p', null, img.description) : null,
      img.kind === 'upload' ? sourcePicker(img, onChange) : null,
      h('p', { class: 'hint' }, [img.kind === 'ai' ? `${img.model}${c ? ` · 비용 ${usd(c.usd)} (${c.label})` : ''}` : '', img.kind === 'stock' ? img.attribution_text : '', `${img.width}×${img.height} · ${fmtBytes(img.bytes)} · ${L.fmtTime(img.created_at)}`].filter(Boolean).join(' · ')),
      img.kind === 'stock' && img.source_url ? h('div', { class: 'go' }, h('a', { class: 'copy', href: img.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'Pexels 원본 보기 ↗')) : null,
      h('p', { class: 'legend' }, inUse ? `쓰는 곳 ${inUse}곳` : '쓰는 곳 없음'),
      used.length ? h('ul', { class: 'lic' }, used) : null,
      (j.decks || []).length ? h('p', { class: 'hint' }, `카드뉴스 배경으로 ${(j.decks || []).length}곳에서 사용 중`) : null,
      // 1.5.0: AI 검수·내 평가 기록과 수정 이력 (AI 이미지)
      img.kind === 'ai' ? (() => {
        const rv = (j.reviews || []);
        const ai = rv.find((r) => r.kind === 'ai_review');
        const me = rv.find((r) => r.kind === 'user_eval');
        const box = det('lib-review:' + img.id, `검수·평가 기록 (${rv.length})`, false, 'plain');
        box.append(ai ? reviewView(ai, img, null, null) : h('p', { class: 'hint' }, 'AI 검수 기록 없음'),
          me ? h('p', { class: 'hint' }, `내 평가: ${IMG.EVAL_CRITERIA.filter(([k]) => me.scores && me.scores[k]).map(([k, l]) => `${l} ${me.scores[k]}/3`).join(' · ') || '점수 없음'}${me.preferred ? ' · 비교에서 제일 나음' : ''}`) : null);
        const hist = det('lib-hist:' + img.id, '수정 이력', false, 'plain');
        let loaded = false;
        hist.addEventListener('toggle', () => { if (hist.open && !loaded) { loaded = true; hist.append(lineageBox(img)); } });
        return h('div', { class: 'stack' }, box, hist);
      })() : null,
      img.kind === 'upload' || img.kind === 'stock' ? h('div', { class: 'go' }, btn('이 상품으로 장면 만들기', 'sm', () => { closeSheet(); prd().start({ productId: img.id }); }),
        j.scenes ? h('span', { class: 'hint' }, `이 사진으로 만든 장면 ${j.scenes}개`) : null) : null,
      IMG.productSceneMode(img) ? h('div', { class: 'stack' },
        h('p', { class: img.kind === 'composite' ? 'hint' : 'notice' }, img.kind === 'composite' ? '원본 보존 합성 — 상품은 원본 사진 픽셀 그대로, 배경은 AI.' : 'AI 실사 장면 — AI가 상품까지 다시 그렸어 (작은 글자·로고가 바뀌었을 수 있어).'),
        j.product && j.product.costs ? h('p', { class: 'hint' }, [j.product.costs.model ? `모델 비용 ${usd(genCost(j.product.costs.model) ? genCost(j.product.costs.model).usd : 0)} (${j.product.costs.model.cost_status})` : '', j.product.costs.cutout ? `배경 지우기 ${usd(j.product.costs.cutout.cost_usd)} (${j.product.costs.cutout.cost_status})` : ''].filter(Boolean).join(' · ')) : null,
        h('div', { class: 'go' }, btn(IMG.productApproved(img) ? '상품 디테일 검수 (승인함)' : '상품 디테일 검수 · 승인', 'sm', () => prd().checkSheet(img, { onDone: () => { if (onChange) onChange(); } })),
          btn('상품 장면 화면에서 이어 하기', 'sm ghost', () => { closeSheet(); prd().start({ resume: img.id }); }))) : null,
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
    const PROV_ROWS = [
      ['cloudflare', 'Cloudflare (무료 AI 이미지)', 'Supabase Secrets: CF_ACCOUNT_ID · CF_API_TOKEN'],
      ['openai', 'OpenAI (유료 AI 이미지 · 고치기 · 참고 사진)', 'Supabase Secrets: OPENAI_API_KEY'],
      ['gemini', 'Google Gemini (유료 AI 이미지 · 고치기 · 참고 사진)', 'Supabase Secrets: GEMINI_API_KEY'],
    ];
    // 공급자마다: 키 있음(서버 Secrets) · 연결 확인(키·모델을 실제로 물어본 결과) · 마지막으로 실제로 만든 때 — 따로 보여줌
    const provRow = (id, title, env, j) => {
      const ps = (j.provider_status || {})[id] || {};
      const hasKey = !!(j.keys || {})[id];
      const chk = ps.check;
      const line = h('small', { class: 'hint' }, [
        chk ? `연결 확인: ${chk.ok ? '됨' : '안 됨'} (${L.fmtTime(chk.checked_at)}${chk.ok ? '' : ' · ' + (chk.message || chk.code)})` : '연결 확인: 아직 안 함',
        ps.last_success ? `실제 생성 성공: ${L.fmtTime(ps.last_success.at)} (${ps.last_success.model})` : '실제 생성 성공 기록 없음',
        ps.last_failure ? `마지막 실패: ${L.fmtTime(ps.last_failure.at)} (${ps.last_failure.code})` : '',
      ].filter(Boolean).join(' · '));
      const badge = hasKey ? (chk && chk.ok ? '키 있음 · 연결 확인됨' : '키 있음 · 연결 확인 전') : '키 없음';
      return h('div', { class: 'item' }, h('div', { class: 'main', style: 'cursor:default' }, h('b', null, title), h('small', null, env), line),
        h('div', { class: 'stack' }, h('span', { class: 'badge ' + (hasKey ? (chk && chk.ok ? 'v-ok' : 'v-unk') : 'v-no') }, badge),
          hasKey ? btn('연결 확인', 'sm ghost', async (ev) => {
            const r = await run(ev.currentTarget, () => api('/images/providers/check', { method: 'POST', body: { provider: id } }));
            if (r && r.check) { toast(r.check.ok ? '연결 확인됨 (이미지는 만들지 않았어)' : '연결 안 됨: ' + r.check.message, 5000); loadStatus(); }
          }) : null));
    };
    const loadStatus = () => api('/images/config').then((j) => {
      put(status,
        ...PROV_ROWS.map(([id, title, env]) => provRow(id, title, env, j)),
        ...j.providers.map((x) => h('div', { class: 'item' }, h('div', { class: 'main', style: 'cursor:default' }, h('b', null, `${x.label} (실제 사진 검색)`), h('small', null, 'Supabase Secrets: PEXELS_API_KEY')), h('span', { class: 'badge ' + (x.connected ? 'v-ok' : 'v-no') }, x.connected ? '키 있음' : '키 없음'))),
        h('p', { class: 'hint' }, "'키 있음'은 서버에 키가 있다는 뜻일 뿐이야. '연결 확인'은 이미지를 만들지 않고 키·모델을 공급자에 물어본 결과고(돈 안 듦), 실제로 만들어 본 기록은 따로 보여줘."),
        h('p', { class: 'hint' }, `${usageLine(j.usage)} · 보관함 ${L.fmtNum(j.usage.image_count || 0)}장 · ${fmtBytes(Number(j.usage.storage_bytes || 0))} (멈추는 선 ${fmtBytes(j.storage_limit)})`),
        j.settings.image_gen_model === j.test_model || j.settings.image_edit_model === j.test_model ? h('p', { class: 'notice' }, '점검용 가짜 모델(gf-test-fake)로 돼 있어. 실제로 쓰려면 아래에서 모델을 골라줘.') : null);
    }).catch((e) => put(status, h('p', { class: 'hint' }, ui.errText(e))));
    loadStatus();
    const inp = (v, attrs = {}) => h('input', { type: 'text', value: v ?? '', oninput: ui.markDirty, ...attrs });
    // 모델 고르기: 앱이 아는 모델만 (모르는 이름은 저장 못 함 — 1.5.0). 지금 값이 목록에 없으면 표시만 해서 바꾸게
    const modelSel = (value, { editOnly = false } = {}) => {
      const list = IMG.KNOWN_MODELS.filter((m) => !editOnly || IMG.modelCaps(m).edit);
      const opts = list.map((m) => { const c = IMG.modelCaps(m); return opt(m, `${m} — ${IMG.PROVIDERS[c.provider].label}${c.free ? ' · 무료' : ''}${c.status === 'preview' ? ' · 미리보기' : ''}${c.deprecated ? ' · 이전 모델' : ''}`); });
      if (value === TEST_MODEL) opts.unshift(opt(TEST_MODEL, `${TEST_MODEL} — 점검용 (실제 생성 아님)`));
      else if (value && !list.includes(value)) {
        const c = IMG.modelCaps(value);
        opts.unshift(opt(value, c.known && !c.usable ? `${value} — 공급자가 종료한 모델 (${c.retired}, 바꿔줘)` : c.known ? `${value} — 여기서 못 쓰는 모델 (바꿔줘)` : `${value} — 앱이 모르는 모델 (바꿔줘)`));
      }
      const el = h('select', { value: value || list[0], onchange: ui.markDirty }, opts);
      el.value = value || list[0];
      return el;
    };
    const f = {
      gen: modelSel(st.image_gen_model || IMG.FREE_MODEL),
      edit: modelSel(st.image_edit_model || 'gpt-image-2.5-sunburst', { editOnly: true }),
      quality: h('select', { value: st.image_quality || 'medium', onchange: ui.markDirty }, IMG.QUALITIES.map((q) => opt(q, IMG.QUALITY_LABEL[q]))),
      daily: inp(st.image_daily_limit ?? 5, { inputmode: 'numeric' }),
      budget: inp(st.image_monthly_budget_usd ?? 2, { inputmode: 'decimal' }),
      cap: inp(st.image_request_cap_usd ?? 1, { inputmode: 'decimal' }),
      fx: inp(st.image_fx_krw ?? '', { inputmode: 'decimal', placeholder: '예: 1385' }),
      fxDate: h('input', { type: 'date', value: st.image_fx_date || '', oninput: ui.markDirty }),
      fxSrc: inp(st.image_fx_source || '', { placeholder: '예: 하나은행 매매기준율' }),
      pOut: inp(pr.image_output_per_m ?? 30, { inputmode: 'decimal' }), pIn: inp(pr.image_input_per_m ?? 8, { inputmode: 'decimal' }), pText: inp(pr.text_input_per_m ?? 5, { inputmode: 'decimal' }),
      pAt: h('input', { type: 'date', value: pr.checked_at || '', oninput: ui.markDirty }), pSrc: h('input', { type: 'url', value: pr.source || 'https://developers.openai.com/api/docs/pricing', oninput: ui.markDirty }),
      review: h('select', { value: st.image_review_model || '', onchange: ui.markDirty }, opt('', '끔 (검수할 때마다 고름)'), ...IMG.REVIEW_MODELS.map((m) => opt(m.id, `${m.label}${m.free ? ' · 무료' : ' · 유료'}`))),
    };
    f.review.value = st.image_review_model || '';
    // 모드 4가지: 모드마다 모델·품질 (화면은 고른 모드의 실제 모델을 늘 보여줌)
    // 1.5.1: 기본값과 내가 저장한 값을 나눠서 보여줌. 저장은 기본값과 다른 모드(와 예전에 저장해 둔 모드)만 — 앱이 저장한 값을 덮어쓰지 않음
    const modes = IMG.resolveModes(st);
    const modeRows = modes.map((m) => {
      const ms = modelSel(m.model);
      const qs = h('select', { onchange: ui.markDirty });
      const info = h('small', { class: 'hint' });
      const tag = h('small', { class: 'hint' });
      const row = { m, ms, qs, keep: m.saved };
      const draw = () => {
        const c = IMG.modelCaps(ms.value);
        const cur = qs.value || m.quality;
        put(qs, ...IMG.qualitiesFor(ms.value).map((q) => opt(q, IMG.qualityLabel(ms.value, q))));
        qs.value = IMG.normQuality(ms.value, cur);
        const size = IMG.sizeFor('blog_body', '4:3', ms.value, qs.value);
        const est = IMG.estimateUsd({ quality: qs.value, size, promptTokens: 900, prices: pr, model: ms.value });
        info.textContent = `${IMG.PROVIDERS[c.provider] ? IMG.PROVIDERS[c.provider].label : '?'} · ${c.free ? '무료' : est == null ? '가격 계산 못 함' : `블로그 본문 4:3 한 장 예상 약 ${usd(est)}`} · 참고 사진 ${c.refsMax ? c.refsMax + '장까지' : '못 받음'} · 고치기 ${c.edit ? '됨' : '안 됨'}`;
        const isDefault = ms.value === m.default_model && qs.value === IMG.normQuality(m.default_model, m.default_quality);
        tag.textContent = `기본값: ${m.default_model} · ${IMG.qualityLabel(m.default_model, m.default_quality)} — ${row.keep ? (isDefault ? '저장해 둔 값 (기본값과 같음)' : '내가 저장한 값을 쓰는 중') : isDefault ? '기본값을 쓰는 중 (앱이 기본값을 바꾸면 따라감)' : '바꾼 값 (저장하면 이걸로)'}`;
      };
      ms.addEventListener('change', () => { qs.value = ''; draw(); });
      qs.addEventListener('change', draw);
      draw();
      const reset = btn('기본값으로', 'sm ghost', () => { row.keep = false; ms.value = m.default_model; qs.value = ''; draw(); ui.markDirty(); toast(`'${m.label}'을 기본값으로 바꿨어. 저장을 눌러줘.`); });
      row.el = h('div', { class: 'stack' }, h('b', null, m.label), h('div', { class: 'row' }, field('모델', ms), field('품질', qs)), info, h('div', { class: 'go' }, tag, reset));
      return row;
    });
    // 용도별 기본 비율
    const ratioSel = Object.entries(IMG.PURPOSES).filter(([, v]) => v.ratios.length > 1).map(([k, v]) => {
      const cur = (st.image_ratio_prefs || {})[k];
      const el = h('select', { onchange: ui.markDirty }, v.ratios.map((r) => opt(r, r)));
      el.value = v.ratios.includes(cur) ? cur : v.ratios[0];
      return [k, v, el];
    });
    // Gemini 가격 (모델 표 값으로 시작, 바뀌면 고침)
    const gp = (fid) => {
      const c = IMG.modelCaps(fid);
      const g = IMG.geminiPrices(c, pr);
      const row = { fid, c, per: {}, text: inp(g.text_input_per_m, { inputmode: 'decimal' }), imgIn: inp(g.image_input_per_image, { inputmode: 'decimal' }),
        at: h('input', { type: 'date', value: (pr[fid] && pr[fid].checked_at) || c.checked || '', oninput: ui.markDirty }) };
      // 앱이 쓰는 해상도만 (1K·2K — 4K는 저장 한도 때문에 안 씀)
      const used = new Set(IMG.qualitiesFor(fid).map((q) => (c.imageSizes || {})[q]).filter(Boolean));
      for (const k of Object.keys(g.per_image)) if (!used.size || used.has(k)) row.per[k] = inp(g.per_image[k], { inputmode: 'decimal' });
      return row;
    };
    const gRows = IMG.GEMINI_PRICE_IDS.map(gp);
    const num = (el, min, max, label) => { const v = Number(String(el.value).replace(/[,\s$원]/g, '')); if (!Number.isFinite(v) || v < min || v > max) { toast(`${label}: ${min}~${max} 사이 숫자를 넣어줘`); el.focus(); return null; } return v; };
    const guide = det('img-key-guide', '키 받는 방법·넣는 곳 (처음 한 번)', false, '');
    guide.append(h('ol', { class: 'steps' },
      h('li', null, '무료 AI 이미지(Cloudflare): dash.cloudflare.com 에 무료로 가입해 (플랜은 Free 그대로 — 카드 등록 안 해도 돼).'),
      h('li', null, '왼쪽 메뉴 AI → Workers AI → Use REST API → Create a Workers AI API Token → Create API Token → Copy API Token 으로 토큰을 복사해 (한 번만 보여줘). 같은 화면의 Get Account ID 에서 계정 ID도 복사해.'),
      h('li', null, 'Supabase Secrets 에 CF_ACCOUNT_ID(계정 ID), CF_API_TOKEN(토큰) 이름으로 넣어. 무료 플랜은 하루 10,000 뉴런까지고, 넘으면 실패만 하고 돈은 안 나가 (매일 오전 9시에 다시 채워짐).'),
      h('li', null, '(선택) OpenAI: platform.openai.com 에 로그인 → API keys → Create new secret key. 결제(Billing)에 크레딧이 있어야 하고, GPT Image 모델은 조직 인증(Organization Verification)이 필요할 수 있어.'),
      h('li', null, 'OpenAI 쪽 안전장치: OpenAI 설정 → Limits → Spend 에서 한 달 한도를 넣고 Enforce a hard limit 를 켜두면, 앱 한도와 별개로 그 금액에서 막혀.'),
      h('li', null, '(선택) Gemini: aistudio.google.com 에 로그인 → Get API key → Create API key. 이미지 모델은 결제가 연결된 프로젝트에서만 쓸 수 있어 (Google AI Studio의 결제 설정). 키를 Supabase Secrets 에 GEMINI_API_KEY 이름으로 넣어.'),
      h('li', null, 'Pexels: 지금(2026-10-22 확인)은 새 키 발급이 멈춰 있어. 다시 열리면 pexels.com/api → Get Started 로 받아 (무료, 시간당 200번·월 20,000번). 그 전까지는 직접 올리기를 써.'),
      h('li', null, 'Supabase 대시보드 → 이 프로젝트 → Edge Functions → Secrets 에서 이름대로 붙여넣고 저장. 다시 배포할 필요 없이 바로 적용돼.'),
      h('li', null, "이 화면을 다시 열어 '키 있음'이 보이면 '연결 확인'을 눌러 봐 (이미지를 만들지 않아서 돈이 안 들어). 키는 이 앱·채팅·GitHub에 붙여넣지 마 (서버에만 있어야 해).")),
      h('div', { class: 'go' }, h('a', { class: 'copy', href: 'https://supabase.com/dashboard/project/oxewhsqmdkiasckvnyua/functions/secrets', target: '_blank', rel: 'noopener noreferrer' }, 'Supabase Secrets 열기 ↗'),
        h('a', { class: 'copy', href: 'https://dash.cloudflare.com/profile/api-tokens', target: '_blank', rel: 'noopener noreferrer' }, 'Cloudflare 토큰 ↗'),
        h('a', { class: 'copy', href: 'https://platform.openai.com/api-keys', target: '_blank', rel: 'noopener noreferrer' }, 'OpenAI 키 ↗'),
        h('a', { class: 'copy', href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer' }, 'Gemini 키 ↗'),
        h('a', { class: 'copy', href: 'https://www.pexels.com/api/', target: '_blank', rel: 'noopener noreferrer' }, 'Pexels API ↗')));
    const cmp = h('div', { class: 'stack' });
    const cmpDet = det('img-compare-stats', '모델 비교 기록 (내 평가만)', false, '');
    cmpDet.append(cmp);
    let cmpLoaded = false;
    cmpDet.addEventListener('toggle', () => {
      if (!cmpDet.open || cmpLoaded) return;
      cmpLoaded = true;
      put(cmp, h('p', { class: 'hint' }, '불러오는 중…'));
      api('/images/compare-stats').then((j) => {
        if (!j.models.length) { put(cmp, h('p', { class: 'hint' }, "아직 비교 기록이 없어. 'AI로 만들기 > 여러 모델로 비교하기'에서 같은 설명으로 비교하고 평가를 남겨줘.")); return; }
        put(cmp, h('p', { class: 'hint' }, `같은 입력으로 비교한 ${j.batches}번 중 내가 평가한 것만 셈 (AI 평가는 안 섞음). 비교가 적으면 어느 모델이 늘 낫다고 단정할 수 없어.`),
          ...j.models.map((m) => h('p', null, `${m.model}: 평가 ${m.rated}장 · '제일 나음' ${m.preferred}번${m.avg.usable != null ? ` · 게시용 평균 ${m.avg.usable}/3` : ''}${m.avg.ai_look != null ? ` · AI 티(3=거의 없음) ${m.avg.ai_look}/3` : ''}`)));
      }).catch((e) => put(cmp, h('p', { class: 'hint' }, ui.errText(e))));
    });
    return [
      status, guide,
      h('h3', null, '기본 모델'), field('생성 모델', f.gen), field('편집 모델 (고쳐서 만들기)', f.edit),
      h('p', { class: 'hint' }, `앱이 아는 모델만 고를 수 있어 (모르는 이름은 다른 공급자로 보내지 않고 막아). 가격·옵션 확인: OpenAI ${IMG.PROVIDERS.openai.checked} · Gemini ${IMG.PROVIDERS.gemini.checked} · Cloudflare ${IMG.PROVIDERS.cloudflare.checked}.`),
      h('div', { class: 'go' }, btn(`무료 모델로 (${IMG.FREE_MODEL})`, 'sm', () => { f.gen.value = IMG.FREE_MODEL; ui.markDirty(); toast('생성 모델을 무료 모델로 바꿨어. 저장을 눌러줘.'); })),
      field('기본 품질', f.quality, '모델이 못 받는 품질이면 가까운 것으로 바꿔서 보내. Gemini는 품질 칸이 해상도야 (보통 1K · 높음 2K). 4K는 결과 파일이 저장 한도를 넘을 수 있어서 안 써.'),
      h('h3', null, '모드 (AI로 만들기에서 고름)'),
      h('p', { class: 'hint' }, "만들 때마다 모드를 고르고, 고른 모드의 실제 모델 이름·예상 비용을 보여준 뒤에만 만들어. 무료 모드에서 유료 모델로 저절로 바뀌지 않아. 1.5.1부터 '고품질 유료 생성'의 기본값은 GPT Image 2.5 Sunburst · 높음이야 (예전에 저장해 둔 값이 있으면 그걸 그대로 써)."),
      ...modeRows.map((r) => r.el),
      h('h3', null, 'AI 검수'), field('기본 검수 모델', f.review, '만든 이미지를 AI가 보고 의견을 줘 (품질 보증 아님). 유료 모델은 검수 비용도 이미지 예산에 같이 셈.'),
      h('h3', null, '비용 한도'),
      h('div', { class: 'row' }, field('하루 생성 한도 (번)', f.daily, '0~100. 0이면 AI 생성을 막아. 무료 모델은 Cloudflare 무료 한도(하루 약 70~100장)가 실제 상한이야.'), field('한 달 예산 (달러)', f.budget, '넘게 되면 새 생성을 멈춰.')),
      field('한 번 상한 (달러)', f.cap, '한 번 누를 때(후보 여러 장·모델 비교 포함) 예상 비용이 이걸 넘으면 안 만들어. 0~20.'),
      h('p', { class: 'hint' }, '예산은 실제 청구액 > 사용량 기준 > 예상 순으로 더해서 셈해 (AI 검수 비용 포함). 청구됐는지 모르는 실패도 예상 비용으로 셈해서 넉넉하게 막아.'),
      h('h3', null, '용도별 기본 비율'),
      h('div', { class: 'row' }, ...ratioSel.map(([, v, el]) => field(v.label, el))),
      h('h3', null, '환율 (원화로 볼 때)'),
      h('div', { class: 'row' }, field('원/달러', f.fx), field('기준 날짜', f.fxDate)), field('기준 (어디 환율)', f.fxSrc),
      h('p', { class: 'hint' }, '앱이 환율을 가져오지 않아. 확인한 환율과 날짜·출처를 넣으면, 그 뒤 생성 기록은 그 환율로 원화를 계산해.'),
      h('h3', null, 'OpenAI 가격 (100만 토큰당 달러 · gpt-image-2.5 모델)'),
      h('div', { class: 'row' }, field('이미지 출력', f.pOut), field('이미지 입력', f.pIn), field('텍스트 입력', f.pText)),
      h('div', { class: 'row' }, field('확인한 날', f.pAt), field('가격표 주소', f.pSrc)),
      ...gRows.map((g) => h('div', { class: 'stack' }, h('h3', null, `Gemini 가격 (${g.c.label})`),
        h('div', { class: 'row' }, ...Object.entries(g.per).map(([k, el]) => field(`장당 달러${k ? ' · ' + k : ''}`, el)), field('텍스트 입력 (100만 토큰당)', g.text), field('넣는 이미지 (장당)', g.imgIn)),
        field('확인한 날', g.at))),
      cmpDet,
      btn('저장', 'sm', async (ev) => {
        const daily = num(f.daily, 0, 100, '하루 한도'); if (daily == null) return;
        const budget = num(f.budget, 0, 500, '한 달 예산'); if (budget == null) return;
        const cap = num(f.cap, 0, 20, '한 번 상한'); if (cap == null) return;
        let fx = null;
        if (String(f.fx.value).trim()) { fx = num(f.fx, 100, 10000, '환율'); if (fx == null) return; }
        const pOut = num(f.pOut, 0, 1000, '이미지 출력 가격'); if (pOut == null) return;
        const pIn = num(f.pIn, 0, 1000, '이미지 입력 가격'); if (pIn == null) return;
        const pText = num(f.pText, 0, 1000, '텍스트 입력 가격'); if (pText == null) return;
        if (f.pSrc.value.trim() && !L.safeUrl(f.pSrc.value)) { toast('가격표 주소는 https://로 시작해야 해'); return; }
        const prices = { image_output_per_m: pOut, image_input_per_m: pIn, text_input_per_m: pText, checked_at: f.pAt.value || null, source: f.pSrc.value.trim() };
        for (const g of gRows) {
          const per = {};
          for (const [k, el] of Object.entries(g.per)) { const v = num(el, 0, 10, 'Gemini 장당 가격'); if (v == null) return; per[k] = v; }
          const t = num(g.text, 0, 1000, 'Gemini 텍스트 입력 가격'); if (t == null) return;
          const ii = num(g.imgIn, 0, 10, 'Gemini 넣는 이미지 가격'); if (ii == null) return;
          const base = IMG.geminiPrices(g.c, {});
          prices[g.fid] = { per_image: per, text_input_per_m: t, image_input_per_image: ii, image_output_per_m: base.image_output_per_m, text_output_per_m: base.text_output_per_m,
            checked_at: g.at.value || null, source: IMG.PROVIDERS.gemini.source };
        }
        // 생성·편집 모델은 바꿨을 때만 보냄 — 저장된 모델이 종료됐어도(서버가 새로 저장을 막음) 예산·한도 같은 다른 설정은 저장되게 (1.5.0 검토)
        const changedModel = (el, cur) => (el.value !== String(cur || '') ? el.value : undefined);
        const body = {
          image_gen_model: changedModel(f.gen, st.image_gen_model), image_edit_model: changedModel(f.edit, st.image_edit_model),
          image_quality: f.quality.value, image_daily_limit: Math.round(daily), image_monthly_budget_usd: budget,
          image_request_cap_usd: cap, image_review_model: f.review.value,
          image_modes: IMG.modeOverrides(modeRows.map((r) => ({ id: r.m.id, model: r.ms.value, quality: r.qs.value })), modeRows.filter((r) => r.keep).map((r) => r.m.id)),
          image_ratio_prefs: Object.fromEntries(ratioSel.map(([k, , el]) => [k, el.value])),
          image_fx_krw: fx, image_fx_date: f.fxDate.value || null, image_fx_source: f.fxSrc.value.trim(),
          image_prices: prices,
        };
        const j = await run(ev.currentTarget, () => api('/settings', { method: 'POST', body }), '저장했어');
        if (j) { ui.clearDirty(); for (const k in C) C[k].at = 0; await ui.load(); if (j.skipped && j.skipped.length) toast('DB 업데이트(017) 전이라 모드·검수·한 번 상한·비율은 저장하지 못했어', 5000); }
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
    // 1.5.0: AI 검수 비용도 같은 합계에 들어감 (검수만 있어도 '데이터 없음'이 아님) — 검수 몫은 따로 보여줌
    const est = Number(t.n_actual || 0) < Number(t.billed || 0) || Number(t.review_usd || 0) > 0;
    const any = Number(t.count || 0) > 0 || Number(t.reviews || 0) > 0;
    return h('div', { class: 'stack' },
      h('div', { class: 'kpis' },
        kp(est ? '이미지 비용 (예상 포함)' : '이미지 비용', any ? `${usd(t.usd)}${krwText && Number(t.usd) > 0 ? ' ≈ ' + krwText : ''}` : null,
          any ? `생성: 비용 반영 ${t.billed || 0}번 / 기록 ${t.count || 0}번${Number(t.reviews || 0) ? ` · AI 검수 ${t.reviews}번 ${usd(t.review_usd || 0)} 포함` : ''}` : null),
        kp('청구액 확인', t.count ? `${t.n_actual || 0}건` : null, t.count ? `사용량 기준 ${t.n_usage || 0}건 · 확인 필요 ${t.uncertain || 0}건` : null),
        after != null ? kp(est ? '이미지 비용(예상 포함)까지 뺀 순수익' : '이미지 비용까지 뺀 확정 기준 순수익', L.won(after), '확정 수익 − 비용 − 이미지 비용(원화)') : null),
      h('p', { class: 'hint' }, '이미지 생성 비용은 위 실적의 비용과 따로 셈해 (두 번 더하지 않아). 실적 입력의 비용 칸에는 이미지 비용을 넣지 마.'),
      h('p', { class: 'hint' }, `예상·사용량 기준 금액은 계산값이고, 공급자 사용량 화면(OpenAI·Google AI Studio)에서 확인해 넣은 것만 청구액으로 표시해. AI 검수 비용은 사용량 기준(없으면 예상)으로만 셈해.${st.image_fx_krw ? '' : ' 환율을 넣으면 원화로도 보여줘 (설정 > 이미지).'}${t.fx_missing ? ` 환율이 없는 기록 ${t.fx_missing}건이 있어서 원화 합계는 비워뒀어.` : ''}`));
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
      return { url: im.url, alt: im.alt_text || s.text, label: IMG.originLabel(im) + (im.review_status !== '사용 가능' ? ' · ' + im.review_status : '') };
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
      return { fileName: IMG.fileNameFor(p, s.n, purpose, outExt(im)), caption: IMG.captionHint({ kind: im.kind, provider: im.provider, author_name: im.author_name, license: im.license, attribution_text: im.attribution_text, source_type: im.source_type, composite: im.composite }) };
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

  // ═════════ 1.5.1 상품 사진으로 장면 만들기 (product.js) ═════════
  let PRD = null;
  const prd = () => (PRD ||= createProduct(ui, {
    put, thumb, pickThumb, kindChip, reviewChip, sendGenerate, ensureSmall, modeChoices, keyOk, noKeyText, usageLine, genCost, prepareUpload, sourceSelect,
    newKey, newUuid, usd, TEST_MODEL, fmtBytes, refreshPost: (id) => { if (id) refresh(id); },
  }));
  const viewProduct = (postId) => prd().view(postId);

  return { postPanel, viewCards, viewLibrary, viewProduct, settingsSection, moneyBlock, postCost, previewImages, exportImages, slotCount, invalidate, genCost };
}
