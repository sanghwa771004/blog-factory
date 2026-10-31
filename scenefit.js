// scenefit.js — 원본 보존 합성의 '빛·원근·그림자 자동 추천' (1.5.2)
// 상품 사진(+마스크)과 AI 배경을 이 기기 안에서 작게 줄여 픽셀만 보고 '추정'해 — 서버·외부 AI로 보내지 않음 (0원).
// 픽셀만으로는 실제 렌즈·광원·카메라 각도를 알 수 없어서 모든 값은 추정이고 확신 정도(confidence)를 같이 줌. 화면은 '추천값'으로만 보여주고,
// 사용자가 '추천값 적용'을 눌러야 바뀌며, 그 뒤에도 슬라이더로 고칠 수 있음. 상품 픽셀은 여기서 읽기만 함.
import { cleanLayer, PRODUCT_PURPOSES, PRODUCT_PLACES } from './images.js?v=1.5.2';

const lum = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (n) => Math.round(n * 100) / 100;
// 긴 변 max 칸으로 줄인 사본 (가까운 칸 — 분석용이라 빠르게). ch: 4(RGBA) 또는 1(마스크)
export function tiny(img, max = 160) {
  const s = Math.min(1, max / Math.max(img.w, img.h));
  const w = Math.max(1, Math.round(img.w * s)), h = Math.max(1, Math.round(img.h * s));
  const ch = img.data.length >= img.w * img.h * 4 ? 4 : 1;
  const out = new Uint8ClampedArray(w * h * ch);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.h - 1, Math.floor(((y + 0.5) * img.h) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.w - 1, Math.floor(((x + 0.5) * img.w) / w));
      const si = (sy * img.w + sx) * ch, di = (y * w + x) * ch;
      for (let c = 0; c < ch; c++) out[di + c] = img.data[si + c];
    }
  }
  return { data: out, w, h };
}
// 색온도 경향: 채도가 낮은(무채색에 가까운) 칸들의 (R−B) 치우침 → -1(차가움)~1(따뜻함). 무채색 칸이 적으면 확신 낮음
function warmthOf(px) {
  let s = 0, n = 0, all = 0;
  for (const [r, g, b] of px) {
    all++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 40 || mx > 252) continue;           // 너무 어둡거나 하얗게 날아간 칸은 빼고
    if ((mx - mn) / mx > 0.28) continue;          // 색이 뚜렷한 칸(상품·소품 고유 색)은 빼고
    s += (r - b) / (r + g + b + 1); n++;
  }
  if (!n) return { value: '', k: 0, confidence: 'low' };
  const k = clamp(s / n * 6, -1, 1);
  return { value: k > 0.15 ? 'warm' : k < -0.15 ? 'cool' : 'neutral', k: r2(k), confidence: n >= Math.max(30, all * 0.15) ? 'medium' : 'low' };
}
const lightOf = (left, right, top, bottom) => {
  const d = right - left, v = top - bottom;
  const strength = clamp(Math.abs(d) / 0.22, 0, 1);
  const dir = Math.abs(d) < 0.035 ? (v > 0.04 ? 'front' : '') : d > 0 ? 'right' : 'left';
  return { dir, strength: r2(strength), confidence: Math.abs(d) > 0.1 ? 'medium' : 'low', source: 'estimate' };
};

// 상품 사진 분석: 외곽 상자·중심·비율·기울기·바닥 닿는 면·(추정) 카메라 시점·빛 방향·원래 그림자·색온도·밝기·배경과의 차이
// src: {data RGBA, w, h} 상품 사진, mask: {data 0~255, w, h} 같은 비율의 마스크
export function analyzeProduct(src, mask) {
  const S = tiny(src, 200), M = tiny(mask, 200);
  const w = Math.min(S.w, M.w), h = Math.min(S.h, M.h);
  const mAt = (x, y) => M.data[Math.min(M.h - 1, Math.round((y * M.h) / h)) * M.w + Math.min(M.w - 1, Math.round((x * M.w) / w))];
  const pAt = (x, y) => { const i = (Math.min(S.h - 1, Math.round((y * S.h) / h)) * S.w + Math.min(S.w - 1, Math.round((x * S.w) / w))) * 4; return [S.data[i], S.data[i + 1], S.data[i + 2]]; };
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, lsum = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (mAt(x, y) < 128) continue;
    n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    const [r, g, b] = pAt(x, y); lsum += lum(r, g, b);
  }
  if (!n) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const cx = sx / n, cy = sy / n;
  const cxx = sxx / n - cx * cx, cyy = syy / n - cy * cy, cxy = sxy / n - cx * cy;
  const orient = (0.5 * Math.atan2(2 * cxy, cyy - cxx) * 180) / Math.PI; // 세로축에서 기운 각도 (도)
  // 바닥 닿는 면: 상자 아래 4% 줄들의 폭, 아래쪽 윤곽이 가운데로 갈수록 처지는지(위에서 내려다본 둥근 바닥이면 처짐)
  const bottomOf = (x) => { for (let y = y1; y >= y0; y--) if (mAt(x, y) >= 128) return y; return -1; };
  let baseW = 0;
  for (let x = x0; x <= x1; x++) { let hit = false; for (let y = Math.max(y0, y1 - Math.max(1, Math.round(bh * 0.04))); y <= y1; y++) if (mAt(x, y) >= 128) { hit = true; break; } if (hit) baseW++; }
  const q = (a, b2) => { const ys = []; for (let x = Math.round(x0 + bw * a); x <= Math.round(x0 + bw * b2); x++) { const yb = bottomOf(x); if (yb >= 0) ys.push(yb); } return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : null; };
  const mid = q(0.4, 0.6), sides = [q(0.12, 0.25), q(0.75, 0.88)].filter((v) => v != null);
  const curve = mid != null && sides.length ? (mid - sides.reduce((s, v) => s + v, 0) / sides.length) / bh : 0;
  const baseFrac = baseW / bw;
  const view = curve > 0.03 ? { value: 'high', confidence: 'low', source: 'estimate', why: '아래쪽 윤곽이 가운데로 처져 보여 (위에서 찍은 둥근 바닥처럼)' }
    : Math.abs(curve) < 0.015 && baseFrac > 0.55 ? { value: 'front', confidence: 'low', source: 'estimate', why: '바닥 면이 곧고 넓어 보여' } : { value: '', confidence: 'low', source: 'estimate', why: '모양만으로는 판단하기 어려워' };
  // 빛 방향: 상품 안쪽의 왼쪽 1/3·오른쪽 1/3 밝기 차이 (상품 고유 색이 섞여서 확신은 낮음)
  const band = (fx0, fx1, fy0, fy1) => { let s = 0, k = 0; for (let y = Math.round(y0 + bh * fy0); y <= Math.round(y0 + bh * fy1); y++) for (let x = Math.round(x0 + bw * fx0); x <= Math.round(x0 + bw * fx1); x++) { if (x < 0 || y < 0 || x >= w || y >= h || mAt(x, y) < 128) continue; const [r, g, b] = pAt(x, y); s += lum(r, g, b); k++; } return k ? s / k : null; };
  const L = band(0, 0.33, 0.1, 0.9), R = band(0.67, 1, 0.1, 0.9), T = band(0.1, 0.9, 0, 0.3), B = band(0.1, 0.9, 0.7, 1);
  const light = L != null && R != null && T != null && B != null ? lightOf(L, R, T, B) : { dir: '', strength: 0, confidence: 'low', source: 'estimate' };
  // 원래 그림자: 상품 아래 띠의 왼쪽·오른쪽이 먼 배경보다 어두운지 (마스크 밖만)
  const outMean = (ax0, ax1, ay0, ay1) => { let s = 0, k = 0; for (let y = Math.max(0, Math.round(ay0)); y <= Math.min(h - 1, Math.round(ay1)); y++) for (let x = Math.max(0, Math.round(ax0)); x <= Math.min(w - 1, Math.round(ax1)); x++) { if (mAt(x, y) >= 64) continue; const [r, g, b] = pAt(x, y); s += lum(r, g, b); k++; } return k > 4 ? s / k : null; };
  const yb0 = y1 - bh * 0.06, yb1 = y1 + bh * 0.08;
  const shL = outMean(x0 - bw * 0.3, x0 + bw * 0.35, yb0, yb1), shR = outMean(x1 - bw * 0.35, x1 + bw * 0.3, yb0, yb1);
  const far = outMean(0, w - 1, 0, h - 1);
  let shadow = { side: '', confidence: 'low', source: 'estimate' };
  if (shL != null && shR != null && far != null) {
    const dl = far - shL, dr = far - shR;
    if (Math.max(dl, dr) > 0.05) shadow = { side: Math.abs(dl - dr) < 0.03 ? 'below' : dl > dr ? 'left' : 'right', confidence: Math.max(dl, dr) > 0.1 ? 'medium' : 'low', source: 'estimate' };
  }
  // 그림자가 한쪽에 있으면 빛은 반대쪽 — 빛 추정과 맞으면 확신을 올리고, 어긋나면 '모름'
  const opp = { left: 'right', right: 'left' };
  if (shadow.side === 'left' || shadow.side === 'right') {
    if (!light.dir || light.dir === 'front') Object.assign(light, { dir: opp[shadow.side], confidence: 'low', why: '원래 그림자 쪽의 반대' });
    else if (light.dir === opp[shadow.side]) light.confidence = 'medium';
    else Object.assign(light, { dir: '', confidence: 'low', why: '상품 밝기와 그림자 방향이 서로 달라' });
  }
  // 색온도: 원래 사진의 배경(마스크 밖) 무채색 칸 → 그 사진의 조명 색 / 밝기: 상품 안쪽·바깥
  const bgPx = [], fgPx = [];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) (mAt(x, y) < 64 ? bgPx : mAt(x, y) >= 200 ? fgPx : []).push(pAt(x, y));
  const temp = warmthOf(bgPx.length >= 40 ? bgPx : fgPx);
  const bgL = far;
  const prodL = lsum / n;
  return {
    v: 1,
    bbox: { x: r2(x0 / w), y: r2(y0 / h), w: r2(bw / w), h: r2(bh / h) }, center: { x: r2(cx / w), y: r2(cy / h) },
    aspect: r2(bh / bw), shape: shapeOf(bh / bw), // 상품 높이 ÷ 폭 (줄인 사본도 같은 비율)
    fill: r2(n / (bw * bh)), orient: Math.round(orient), upright: Math.abs(orient) < 12,
    base: { width: r2(baseFrac), curve: r2(curve) },
    view, light, shadow, temp,
    bright: { product: r2(prodL), bg: bgL == null ? null : r2(bgL), contrast: bgL == null ? null : r2(Math.abs(prodL - bgL)) },
  };
}
export const shapeOf = (aspect) => (!Number.isFinite(aspect) || aspect <= 0 ? '' : aspect >= 1.35 ? 'tall' : aspect <= 0.75 ? 'wide' : 'square');

// AI 배경 분석: 빛 방향·색온도·밝기·대비(그림자가 진할지)·상품을 놓기 좋은 빈 자리(무늬가 적은 곳)
// o: { place, angle, h(상품 높이 비율), aspect(상품 높이÷폭), W, H(결과 크기 — 비율만 씀) }
export function analyzeBackground(bg, o = {}) {
  const T = tiny(bg, 160);
  const { w, h } = T;
  const Lm = new Float32Array(w * h);
  const px = [];
  for (let p = 0; p < w * h; p++) { const i = p * 4; Lm[p] = lum(T.data[i], T.data[i + 1], T.data[i + 2]); if (p % 3 === 0) px.push([T.data[i], T.data[i + 1], T.data[i + 2]]); }
  const mean = (fx0, fx1, fy0, fy1) => { let s = 0, k = 0; for (let y = Math.floor(h * fy0); y < Math.ceil(h * fy1); y++) for (let x = Math.floor(w * fx0); x < Math.ceil(w * fx1); x++) { s += Lm[y * w + x]; k++; } return k ? s / k : 0; };
  const light = lightOf(mean(0, 0.33, 0.1, 0.9), mean(0.67, 1, 0.1, 0.9), mean(0.1, 0.9, 0, 0.3), mean(0.1, 0.9, 0.7, 1));
  let s1 = 0, s2 = 0;
  for (let p = 0; p < w * h; p++) { s1 += Lm[p]; s2 += Lm[p] * Lm[p]; }
  const mu = s1 / (w * h), sd = Math.sqrt(Math.max(0, s2 / (w * h) - mu * mu));
  const contrast = sd > 0.22 ? 'hard' : sd < 0.12 ? 'soft' : 'medium';
  // 빈 자리 찾기: 상품 크기만 한 상자 안의 밝기 흔들림(무늬·물건)이 가장 적고, 고른 자리(가운데·왼쪽·오른쪽)에 가까운 곳
  const place = PRODUCT_PLACES[o.place] ? o.place : 'center';
  const angle = o.angle === 'top' || o.angle === 'high' ? o.angle : 'front';
  const ph = clamp(Number(o.h) || 0.5, 0.1, 1), asp = clamp(Number(o.aspect) || 1, 0.2, 5);
  // 상품 상자: 높이 = 상품 높이 비율 × 그림 높이, 폭 = 높이 ÷ (상품 높이÷폭) — 결과 비율(W:H) 기준으로 줄인 배경 칸에 맞춤
  const ratioWH = (Number(o.W) && Number(o.H)) ? Number(o.W) / Number(o.H) : w / h;
  const boxH = Math.max(3, Math.round(ph * h));
  const BW = Math.min(w - 2, Math.max(3, Math.round((ph / asp / ratioWH) * w)));
  // 누적합으로 상자 안 분산을 빠르게
  const I1 = new Float64Array((w + 1) * (h + 1)), I2 = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Lm[y * w + x], k = (y + 1) * (w + 1) + x + 1;
    I1[k] = v + I1[k - 1] + I1[k - w - 1] - I1[k - w - 2]; I2[k] = v * v + I2[k - 1] + I2[k - w - 1] - I2[k - w - 2];
  }
  const rect = (A, ax, ay, bx, by) => A[by * (w + 1) + bx] - A[ay * (w + 1) + bx] - A[by * (w + 1) + ax] + A[ay * (w + 1) + ax];
  const varIn = (ax, ay, bx, by) => { const n = (bx - ax) * (by - ay); if (n <= 0) return 1; const m1 = rect(I1, ax, ay, bx, by) / n; return Math.max(0, rect(I2, ax, ay, bx, by) / n - m1 * m1); };
  const wantX = PRODUCT_PLACES[place].x, wantY = angle === 'top' ? Math.min(0.95, 0.5 + ph / 2) : angle === 'high' ? 0.84 : 0.86;
  const cands = [];
  const yLo = angle === 'top' ? Math.max(ph, 0.35) : Math.max(ph + 0.02, 0.55), yHi = 0.94;
  for (let fy = yLo; fy <= yHi + 1e-9; fy += 0.02) for (let fx = 0.12; fx <= 0.88 + 1e-9; fx += 0.02) {
    const by = Math.min(h, Math.round(fy * h)), ay = Math.max(0, by - boxH);
    const ax = Math.max(0, Math.round(fx * w - BW / 2)), bx = Math.min(w, ax + BW);
    if (bx - ax < 3 || by - ay < 3) continue;
    const v = Math.sqrt(varIn(ax, ay, bx, by));
    const cost = v + 0.12 * Math.abs(fx - wantX) + 0.2 * Math.abs(fy - wantY);
    cands.push({ x: fx, y: fy, v, cost });
  }
  cands.sort((a, b) => a.cost - b.cost);
  const best = cands[0];
  const med = cands.length ? cands[Math.floor(cands.length / 2)].v : 0;
  const spot = best ? { x: r2(best.x), y: r2(best.y), texture: r2(best.v), confidence: best.v < med * 0.6 && best.v < 0.06 ? 'medium' : 'low', source: 'estimate' }
    : { x: wantX, y: wantY, texture: null, confidence: 'low', source: 'default' };
  return { v: 1, light, temp: warmthOf(px), bright: r2(mu), contrast, sd: r2(sd), spot };
}

// 추천값 (원본 보존 합성의 레이어 설정). 상품 픽셀을 그대로 두려고 밝기·색온도는 기본으로 '배경' 쪽을 맞춤 (productTone: true 면 상품 쪽)
// 돌려줌: { layer: 추천 레이어(지금 값에서 바꾼 것만), changes: [{key, label, from, to, why}], notes: [...], match: {...} }
export function recommendLayer({ prod, bg, spec = {}, layer = {}, W = 0, H = 0, prodPx = null, productTone = false } = {}) {
  const L = cleanLayer(layer);
  const out = cleanLayer(layer);
  const changes = [], notes = [];
  const pu = PRODUCT_PURPOSES[spec.purpose] ? spec.purpose : 'blog_body';
  const angle = spec.angle === 'top' || spec.angle === 'high' ? spec.angle : 'front';
  const aspect = prod && Number(prod.aspect) > 0 ? Number(prod.aspect) : 1;
  // 크기: 목적별 기본 높이, 상품이 옆으로 넓으면 폭이 그림의 80%를 넘지 않게, 원래 사진보다 크게 늘리면 흐려져서 그 아래로
  let hh = PRODUCT_PURPOSES[pu].size;
  const ratioWH = W && H ? W / H : 4 / 3;
  if ((hh / aspect) / ratioWH > 0.8) hh = 0.8 * ratioWH * aspect;
  if (prodPx && prodPx.h && H && (hh * H) / prodPx.h > 1.05) { hh = (prodPx.h * 1.05) / H; notes.push('상품 사진보다 크게 늘리면 흐려져서 크기를 줄여 추천했어.'); }
  hh = clamp(Math.round(hh * 100) / 100, 0.12, 1);
  if (!L.one) out.h = hh;
  // 위치: 배경의 빈 자리 (확신이 낮으면 고른 자리 기본값)
  if (bg && bg.spot && bg.spot.confidence !== 'low') { out.x = clamp(bg.spot.x, 0.05, 0.95); out.y = clamp(bg.spot.y, 0.1, 1); }
  // 그림자: 배경 빛 방향의 반대쪽으로, 대비가 크면 진하고 좁게, 부드러운 빛이면 옅고 넓게
  const dirOf = (d) => (d === 'left' ? -1 : d === 'right' ? 1 : 0);
  const bl = bg ? bg.light : null, pl = prod ? prod.light : null;
  const k = bl ? dirOf(bl.dir) * (0.3 + 0.5 * (Number(bl.strength) || 0)) : 0;
  out.shadow.dx = Math.round(clamp(k, -1, 1) * 20) / 20;
  const c = bg ? bg.contrast : 'medium';
  out.shadow.o = { soft: 0.36, medium: 0.46, hard: 0.6 }[c] * (angle === 'top' ? 0.7 : 1);
  out.shadow.s = { soft: 0.72, medium: 0.5, hard: 0.3 }[c];
  out.shadow.o = Math.round(out.shadow.o * 100) / 100;
  // 빛 방향이 서로 다르면 알려줌 (상품의 빛은 바꿀 수 없음 — 배경을 다시 만들거나 상품 사진을 바꿔야 함)
  const match = { light: 'unknown', bright: null, temp: null };
  if (pl && bl && pl.dir && bl.dir && pl.dir !== 'front' && bl.dir !== 'front') {
    match.light = pl.dir === bl.dir ? 'same' : 'opposite';
    if (match.light === 'opposite') notes.push("상품 사진의 빛은 한쪽, 배경의 빛은 반대쪽이라 어색할 수 있어. 5번 장면에서 '빛이 오는 쪽'을 상품 사진에 맞춰 배경을 다시 만들어줘.");
  }
  // 밝기·색온도 차이 → 배경을 조금 맞춤 (상품 픽셀 그대로). 차이가 작으면 그대로 둠
  if (prod && bg && prod.bright && prod.bright.product != null) {
    const dB = prod.bright.product - bg.bright;
    match.bright = r2(dB);
    const dT = (prod.temp && prod.temp.value ? prod.temp.k : 0) - (bg.temp && bg.temp.value ? bg.temp.k : 0);
    match.temp = r2(dT);
    const tb = Math.abs(dB) > 0.12 ? clamp(dB * 0.4, -0.15, 0.15) : 0;
    const tw = Math.abs(dT) > 0.25 ? clamp(dT * 0.25, -0.15, 0.15) : 0;
    if (productTone) { out.tone.b = r2(-tb); out.tone.w = r2(-tw); if (tb || tw) notes.push('상품 밝기·색을 바꾸면 검수에서 색 칸을 직접 확인해야 해 (원본 픽셀과 달라져).'); }
    else { out.bg.b = r2(tb); out.bg.w = r2(tw); }
  }
  const LBL = { h: '크기', x: '가로 위치', y: '바닥 닿는 높이', 'shadow.dx': '그림자 방향', 'shadow.o': '그림자 진하기', 'shadow.s': '그림자 퍼짐', 'bg.b': '배경 밝기', 'bg.w': '배경 색온도', 'tone.b': '상품 밝기', 'tone.w': '상품 색온도' };
  const WHY = {
    h: '제작 목적에 맞는 크기 (상품 비율 반영)', x: bg && bg.spot && bg.spot.confidence !== 'low' ? '배경에서 무늬가 적은 빈 자리' : '고른 자리 (빈 자리를 확실히 못 찾음)', y: bg && bg.spot && bg.spot.confidence !== 'low' ? '빈 자리의 바닥 쪽' : '사진 각도에 맞는 기본 높이',
    'shadow.dx': bl && bl.dir && bl.dir !== 'front' ? `배경의 빛이 ${bl.dir === 'left' ? '왼쪽' : '오른쪽'}에서 와 보여서 반대쪽으로` : '빛 방향을 모르겠어서 바로 아래로',
    'shadow.o': { soft: '빛이 부드러운 배경', medium: '보통 대비의 배경', hard: '대비가 큰 배경' }[c], 'shadow.s': { soft: '부드러운 빛 → 넓게', medium: '보통', hard: '강한 빛 → 좁게' }[c],
    'bg.b': '상품과 배경 밝기 차이를 줄이게 (상품 픽셀은 그대로)', 'bg.w': '상품 사진과 배경의 색온도 차이를 줄이게 (상품 픽셀은 그대로)',
    'tone.b': '상품을 배경 밝기 쪽으로', 'tone.w': '상품을 배경 색온도 쪽으로',
  };
  const get = (o, key) => key.split('.').reduce((a, p) => (a ? a[p] : undefined), o);
  for (const key of Object.keys(LBL)) { const a = get(L, key), b = get(out, key); if (Math.abs(Number(a) - Number(b)) > 0.005) changes.push({ key, label: LBL[key], from: a, to: b, why: WHY[key] }); }
  return { layer: cleanLayer(out), changes, notes, match };
}

// 5번 장면 칸의 '추정' 기본값 (사용자가 고르지 않았을 때만 씀): 빛 방향·색 느낌·밝기
export function sceneHints(prod) {
  if (!prod) return { light: '', warmth: '', bright: '', view: '', shape: '' };
  const pb = prod.bright ? prod.bright.product : null;
  return {
    light: prod.light && prod.light.dir && prod.light.confidence !== 'low' ? prod.light.dir : prod.light && prod.light.dir ? prod.light.dir : '',
    warmth: prod.temp ? prod.temp.value : '',
    bright: pb == null ? '' : pb > 0.68 ? 'bright' : pb < 0.36 ? 'dim' : 'medium',
    view: prod.view ? prod.view.value : '',
    shape: shapeOf(prod.aspect),
  };
}
