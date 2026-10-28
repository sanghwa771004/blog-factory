// cutout.js — 상품 사진에서 '남길 영역'(마스크)을 만들고, 원본 픽셀을 그대로 AI 배경 위에 얹는 합성 (1.5.1)
// 모두 이 기기 브라우저 안에서 함 — 서버·외부 API를 부르지 않아서 배경 지우기 비용은 0원이고, 사진이 다른 곳으로 가지 않음.
// · 배경 지우기 모델: U²-Netp (Apache-2.0 — models/NOTICE) + ONNX Runtime Web 1.30.0 (MIT — vendor/onnxruntime-web/LICENSE). 앱과 같은 주소에서 받음 (CSP 'self')
// · Supabase Edge Function 은 CPU 시간이 짧고 그림 도구가 없어서 서버에서는 픽셀을 다루지 않음
// · 원본 상품 사진 파일은 읽기만 하고 고치지 않음. 합성 결과는 새 PNG(다시 압축하지 않음)로 따로 저장
// 순수 계산 함수(마스크 다듬기·합성)는 Node 시험에서도 돌아감. 브라우저 전용은 loadSegmenter·decodeImage·toPngBlob·maskFromPng 뿐
import { cleanLayer, layerBox, RATIOS } from './images.js?v=1.5.1';

export const SEG_SIZE = 320;                       // U²-Netp 입력 크기 (1×3×320×320)
export const MAX_MASK_SIDE = 1600;                 // 마스크를 만드는 크기 (큰 사진은 같은 비율로 줄여서 — 서버도 같은 비율만 받음)
export const MODEL_URL = './models/u2netp.onnx';
export const MODEL_SHA256 = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8';
export const ORT_URL = './vendor/onnxruntime-web/ort.wasm.bundle.min.mjs';
export const WASM_URL = './vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm';
export const CACHE_NAME = 'gf-cutout-v1';

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ───────── 크기 ─────────
export function workSize(w, h, max = MAX_MASK_SIDE) {
  const s = Math.min(1, max / Math.max(1, w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s };
}
// 합성 결과 크기: 고른 비율로, 긴 변은 용도 크기(out)와 배경 해상도×1.25 중 작은 쪽 (배경을 많이 늘려 흐려지지 않게), 짝수로
export function outputSize(ratio, bgW, bgH, out = 1600) {
  const R = RATIOS[ratio] || RATIOS['4:3'];
  const long = Math.max(480, Math.min(out, Math.round(Math.max(bgW, bgH) * 1.25)));
  let W, H;
  if (R.w >= R.h) { W = long; H = Math.round((long * R.h) / R.w); } else { H = long; W = Math.round((long * R.w) / R.h); }
  return { W: W - (W % 2), H: H - (H % 2) };
}

// ───────── 다시 뽑기 (줄일 때는 면적 평균, 늘릴 때는 쌍선형) ─────────
// src: RGBA(Uint8ClampedArray|Uint8Array) 또는 한 칸짜리(채널 1) 배열. 결과는 Float32Array (채널 수 그대로)
export function resample(src, sw, sh, dw, dh, ch = 4, rect = null) {
  const r = rect || { x: 0, y: 0, w: sw, h: sh };
  const out = new Float32Array(dw * dh * ch);
  const fx = r.w / dw, fy = r.h / dh;
  if (fx > 1 || fy > 1) {
    // 면적 평균: 대상 한 칸이 덮는 원본 칸들을 겹친 넓이만큼 더함
    const acc = new Float64Array(ch);
    for (let y = 0; y < dh; y++) {
      const y0 = r.y + y * fy, y1 = y0 + fy;
      const iy0 = Math.max(0, Math.floor(y0)), iy1 = Math.min(sh, Math.ceil(y1));
      for (let x = 0; x < dw; x++) {
        const x0 = r.x + x * fx, x1 = x0 + fx;
        const ix0 = Math.max(0, Math.floor(x0)), ix1 = Math.min(sw, Math.ceil(x1));
        acc.fill(0);
        let wsum = 0;
        for (let yy = iy0; yy < iy1; yy++) {
          const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
          if (wy <= 0) continue;
          for (let xx = ix0; xx < ix1; xx++) {
            const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
            if (wx <= 0) continue;
            const wgt = wx * wy, si = (yy * sw + xx) * ch;
            for (let c = 0; c < ch; c++) acc[c] += src[si + c] * wgt;
            wsum += wgt;
          }
        }
        const di = (y * dw + x) * ch;
        for (let c = 0; c < ch; c++) out[di + c] = wsum ? acc[c] / wsum : 0;
      }
    }
    return out;
  }
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, r.y + (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), ty = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, r.x + (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), tx = sx - x0;
      const a = (y0 * sw + x0) * ch, b = (y0 * sw + x1) * ch, c0 = (y1 * sw + x0) * ch, d = (y1 * sw + x1) * ch, di = (y * dw + x) * ch;
      for (let c = 0; c < ch; c++) {
        const top = src[a + c] + (src[b + c] - src[a + c]) * tx, bot = src[c0 + c] + (src[d + c] - src[c0 + c]) * tx;
        out[di + c] = top + (bot - top) * ty;
      }
    }
  }
  return out;
}

// ───────── 배경 지우기 모델 입력·출력 (rembg 와 같은 전처리: 가장 밝은 값으로 나누고 ImageNet 평균·표준편차) ─────────
export function segInput(rgba, w, h, S = SEG_SIZE) {
  const r = resample(rgba, w, h, S, S, 4);
  let mx = 0;
  for (let i = 0; i < r.length; i += 4) { if (r[i] > mx) mx = r[i]; if (r[i + 1] > mx) mx = r[i + 1]; if (r[i + 2] > mx) mx = r[i + 2]; }
  mx = mx || 1;
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const f = new Float32Array(3 * S * S);
  for (let p = 0, i = 0; p < S * S; p++, i += 4) for (let c = 0; c < 3; c++) f[c * S * S + p] = (r[i + c] / mx - mean[c]) / std[c];
  return f;
}
// 모델 출력(320×320 확률) → 최솟값·최댓값으로 0~1 → 마스크 크기로 늘림
export function probToMap(prob, S, w, h) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < S * S; i++) { const v = prob[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const span = mx - mn || 1;
  const n = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) n[i] = (prob[i] - mn) / span;
  return resample(n, S, S, w, h, 1);
}
// 회색 밝기 (0~1)
export function grayOf(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) g[p] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255;
  return g;
}
// 상자 평균 (반지름 r, 가장자리는 있는 칸만) — 누적합으로 O(N)
export function boxMean(src, w, h, r) {
  if (r <= 0) return Float32Array.from(src);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0, n = 0;
    for (let x = 0; x <= Math.min(w - 1, r); x++) { s += src[row + x]; n++; }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / n;
      const add = x + r + 1, sub = x - r;
      if (add < w) { s += src[row + add]; n++; }
      if (sub >= 0) { s -= src[row + sub]; n--; }
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let y = 0; y <= Math.min(h - 1, r); y++) { s += tmp[y * w + x]; n++; }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      const add = y + r + 1, sub = y - r;
      if (add < h) { s += tmp[add * w + x]; n++; }
      if (sub >= 0) { s -= tmp[sub * w + x]; n--; }
    }
  }
  return out;
}
// 유도 필터(He 외, 2010): 늘린 확률 지도의 가장자리를 사진의 실제 경계에 맞춤
export function guidedFilter(I, p, w, h, r, eps = 1e-3) {
  const N = w * h;
  const Ip = new Float32Array(N), II = new Float32Array(N);
  for (let i = 0; i < N; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r), mIp = boxMean(Ip, w, h, r), mII = boxMean(II, w, h, r);
  const a = new Float32Array(N), b = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = mII[i] - mI[i] * mI[i], cov = mIp[i] - mI[i] * mp[i];
    a[i] = cov / (v + eps); b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r);
  const q = new Float32Array(N);
  for (let i = 0; i < N; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
// 확률 지도 → 마스크 (0~255): 가장자리 맞춤 → 부드러운 문턱 → 작은 조각 지우기·구멍 메우기
export function mapToMask(map, rgba, w, h, { guide = true, lo = 0.3, hi = 0.7 } = {}) {
  let q = map;
  if (guide) q = guidedFilter(grayOf(rgba, w, h), map, w, h, Math.max(2, Math.round(Math.max(w, h) / 200)), 1e-3);
  const m = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) m[i] = Math.round(255 * smooth(lo, hi, q[i]));
  return keepMain(m, w, h);
}
// 연결된 조각 (문턱 thr 이상 = 남김): 가장 큰 조각의 minFrac 보다 작은 조각은 지우고, 남긴 조각 안의 작은 구멍은 메움
export function keepMain(mask, w, h, { thr = 128, minFrac = 0.04, holeFrac = 0.002 } = {}) {
  const N = w * h;
  const lab = new Int32Array(N).fill(-1);
  const sizes = [];
  const stack = new Int32Array(N);
  const label = (on) => {
    const ids = [];
    for (let s = 0; s < N; s++) {
      if (lab[s] !== -1 || (mask[s] >= thr) !== on) continue;
      const id = sizes.length; sizes.push(0); ids.push(id);
      let sp = 0; stack[sp++] = s; lab[s] = id;
      let touches = false;
      while (sp) {
        const p = stack[--sp]; sizes[id]++;
        const x = p % w, y = (p - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
        for (const q of nb) if (q >= 0 && lab[q] === -1 && (mask[q] >= thr) === on) { lab[q] = id; stack[sp++] = q; }
      }
      if (!on && touches) sizes[id] = -sizes[id]; // 테두리에 닿는 빈 곳 = 진짜 배경 (구멍이 아님)
    }
    return ids;
  };
  const fg = label(true);
  const nFg = sizes.length;
  let big = 0;
  for (const i of fg) if (sizes[i] > big) big = sizes[i];
  const out = Uint8ClampedArray.from(mask);
  if (big) for (let i = 0; i < N; i++) { const l = lab[i]; if (l >= 0 && l < nFg && sizes[l] < big * minFrac) out[i] = 0; }
  label(false);
  for (let i = 0; i < N; i++) { const l = lab[i]; if (l >= nFg && sizes[l] > 0 && sizes[l] < N * holeFrac) out[i] = 255; }
  return out;
}
// 모델 없이 간단히: 테두리와 비슷한 색을 배경으로 (흰 배경·단색 배경 사진에 맞음)
export function simpleMask(rgba, w, h, { tol = 30 } = {}) {
  const N = w * h;
  const bg = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const seed = (p) => { if (!bg[p]) { bg[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  const t2 = tol * tol * 3;
  while (sp) {
    const p = stack[--sp];
    const x = p % w, y = (p - x) / w, i = p * 4;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q < 0 || bg[q]) continue;
      const j = q * 4;
      const d = (rgba[i] - rgba[j]) ** 2 + (rgba[i + 1] - rgba[j + 1]) ** 2 + (rgba[i + 2] - rgba[j + 2]) ** 2;
      if (d <= t2) { bg[q] = 1; stack[sp++] = q; }
    }
  }
  const m = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) m[i] = bg[i] ? 0 : 255;
  return keepMain(featherMask(m, w, h, 1), w, h);
}
// 사진에 원래 투명한 부분이 있는지·그걸 마스크로
export function hasTransparency(rgba) { for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) return true; return false; }
export function alphaMask(rgba, w, h) { const m = new Uint8ClampedArray(w * h); for (let p = 0; p < w * h; p++) m[p] = rgba[p * 4 + 3]; return m; }

// ───────── 마스크 다듬기 ─────────
export function featherMask(mask, w, h, r) {
  if (!r) return Uint8ClampedArray.from(mask);
  let f = Float32Array.from(mask);
  for (let k = 0; k < 2; k++) f = boxMean(f, w, h, Math.max(1, Math.round(r / 1.5)));
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.round(f[i]);
  return out;
}
// 안쪽으로 줄이기 (가장자리에 남은 원래 배경을 깎음)
export function erodeMask(mask, w, h, px) {
  if (!px) return Uint8ClampedArray.from(mask);
  const tmp = new Uint8ClampedArray(w * h), out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 255;
    for (let k = Math.max(0, x - px); k <= Math.min(w - 1, x + px); k++) { const v = mask[y * w + k]; if (v < m) m = v; }
    tmp[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 255;
    for (let k = Math.max(0, y - px); k <= Math.min(h - 1, y + px); k++) { const v = tmp[k * w + x]; if (v < m) m = v; }
    out[y * w + x] = m;
  }
  return out;
}
export const edgeMask = (mask, w, h, { feather = 0, shrink = 0 } = {}) => featherMask(erodeMask(mask, w, h, shrink), w, h, feather);
// 붓: (x, y) 둘레 반지름 r 안을 남기기(add)·지우기 — 가장자리는 부드럽게
export function brush(mask, w, h, x, y, r, add, hard = 0.6) {
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(w - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(h - 1, Math.ceil(y + r));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y) / Math.max(0.5, r);
    if (d > 1) continue;
    const s = d <= hard ? 1 : 1 - (d - hard) / (1 - hard);
    const i = yy * w + xx;
    mask[i] = add ? Math.max(mask[i], Math.round(255 * s)) : Math.min(mask[i], Math.round(255 * (1 - s)));
  }
}
export function stroke(mask, w, h, a, b, r, add) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, r / 3)));
  for (let i = 0; i <= n; i++) brush(mask, w, h, a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, r, add);
}
export function maskBBox(mask, w, h, thr = 16) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] >= thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
export function maskCoverage(mask, thr = 128) { let n = 0; for (let i = 0; i < mask.length; i++) if (mask[i] >= thr) n++; return mask.length ? Math.round((n / mask.length) * 1000) / 1000 : 0; }
// 마스크를 사진 크기로 (마스크가 사진보다 작으면 쌍선형으로 늘림 — 같은 비율)
export function maskAt(mask, mw, mh, pw, ph) {
  if (mw === pw && mh === ph) return mask;
  const f = resample(mask, mw, mh, pw, ph, 1);
  const out = new Uint8ClampedArray(pw * ph);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(f[i]);
  return out;
}
// 가장자리 색 정리: 반쯤 투명한 가장자리 칸의 색을 바로 안쪽(불투명) 칸들의 색 쪽으로 — 원래 배경색이 테두리에 묻어 나오지 않게.
// 완전히 불투명한 칸(상품 안쪽)은 건드리지 않음 (원본 픽셀 그대로)
export function decontaminate(rgba, alpha, w, h, r = 2) {
  const out = Uint8ClampedArray.from(rgba);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, a = alpha[p];
    if (a >= 250 || a < 8) continue;
    let s0 = 0, s1 = 0, s2 = 0, n = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
      const q = yy * w + xx;
      if (alpha[q] < 250) continue;
      s0 += rgba[q * 4]; s1 += rgba[q * 4 + 1]; s2 += rgba[q * 4 + 2]; n++;
    }
    if (!n) continue;
    const t = 1 - a / 255; // 투명할수록 안쪽 색을 더 씀
    out[p * 4] = Math.round(rgba[p * 4] * (1 - t) + (s0 / n) * t);
    out[p * 4 + 1] = Math.round(rgba[p * 4 + 1] * (1 - t) + (s1 / n) * t);
    out[p * 4 + 2] = Math.round(rgba[p * 4 + 2] * (1 - t) + (s2 / n) * t);
  }
  return out;
}

// ───────── 합성 ─────────
// 밝기 b(-0.3~0.3)·색온도 w(-0.3 차갑게 ~ 0.3 따뜻하게). 둘 다 0이면 값을 바꾸지 않음
const toneFn = (b, w) => (b || w ? (r, g, bl) => [clamp255(r * (1 + b) * (1 + w * 0.35)), clamp255(g * (1 + b) * (1 + w * 0.05)), clamp255(bl * (1 + b) * (1 - w * 0.35))] : null);
// 배경을 결과 비율로 가운데 맞춰 자를 곳 (cover)
export function coverRect(sw, sh, W, H) {
  const s = Math.max(W / sw, H / sh);
  const w = W / s, h = H / s;
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
}
// 상품 레이어 준비 (마스크·가장자리 설정이 바뀔 때만 다시): 마스크를 사진 크기로 → 가장자리 줄이기·부드럽게 → 상품 상자 → 가장자리 색 정리
// prod: {data, w, h} (원본 상품 사진 RGBA — 읽기만, 고치지 않음), mask: {data, w, h} (남길 영역 0~255, 상품 사진과 같은 비율)
export function prepareLayer(prod, mask, { feather = 1, shrink = 0, decon = true } = {}) {
  const full = maskAt(mask.data, mask.w, mask.h, prod.w, prod.h);
  const alpha = edgeMask(full, prod.w, prod.h, { feather, shrink });
  const bbox = maskBBox(alpha, prod.w, prod.h, 8);
  const rgb = bbox && decon ? decontaminate(prod.data, alpha, prod.w, prod.h) : prod.data;
  return { rgb, alpha, w: prod.w, h: prod.h, bbox, key: `${feather}|${shrink}|${decon ? 1 : 0}` };
}
// 배경 준비 (결과 크기가 바뀔 때만 다시): 결과 비율로 가운데 맞춰 자르고 크기 맞춤
export function prepareBg(bg, W, H) { return { f: resample(bg.data, bg.w, bg.h, W, H, 4, coverRect(bg.w, bg.h, W, H)), W, H }; }
// 미리보기용: 상품 사진·마스크를 줄인 사본 (미리보기에서만 — 저장할 때는 원래 크기로 다시 그림)
export function shrinkSource(img, maxSide) {
  const s = Math.min(1, maxSide / Math.max(img.w, img.h));
  if (s >= 1) return img;
  const w = Math.max(1, Math.round(img.w * s)), h = Math.max(1, Math.round(img.h * s));
  const ch = img.data.length === img.w * img.h ? 1 : 4;
  const f = resample(img.data, img.w, img.h, w, h, ch);
  const d = new Uint8ClampedArray(f.length);
  for (let i = 0; i < f.length; i++) d[i] = Math.round(f[i]);
  return { data: d, w, h };
}
// 같은 상품·배경으로 여러 번 그릴 때 (위치·크기를 바꿀 때마다) 준비한 것을 다시 씀
export function makeComposer(prod, mask) {
  let lp = null, bp = null, bgRef = null;
  return (bg, layer, W, H, { decon = true } = {}) => {
    const L = cleanLayer(layer);
    const key = `${L.mask.feather}|${L.mask.shrink}|${decon ? 1 : 0}`;
    if (!lp || lp.key !== key) lp = prepareLayer(prod, mask, { feather: L.mask.feather, shrink: L.mask.shrink, decon });
    if (!bp || bgRef !== bg || bp.W !== W || bp.H !== H) { bp = prepareBg(bg, W, H); bgRef = bg; }
    return render(bp, lp, L, W, H);
  };
}
// bg: {data, w, h} (AI 배경 RGBA), prod·mask: 위 prepareLayer 와 같음, layer: images.js cleanLayer 모양, W×H: 결과 크기.
// 돌려줌: { data: RGBA, box, scale, warnings }. 상품 칸: 배율 1·회전 0이면 원본 픽셀을 그대로 복사(가장 가까운 칸 — 다시 계산하지 않음),
// 그 밖은 쌍선형으로 크기만 바꿈. 상품 밝기·색은 사용자가 바꿨을 때만
export function composite({ bg, prod, mask, layer, W, H, decon = true }) {
  const L = cleanLayer(layer);
  return render(prepareBg(bg, W, H), prepareLayer(prod, mask, { feather: L.mask.feather, shrink: L.mask.shrink, decon }), L, W, H);
}
function render(bp, lp, L, W, H) {
  const out = new Uint8ClampedArray(W * H * 4);
  // 1) 배경 + (고른 경우) 밝기·색온도
  const bgf = bp.f;
  const bt = toneFn(L.bg.b, L.bg.w);
  const base = new Float32Array(W * H * 3);
  for (let p = 0; p < W * H; p++) {
    let r = bgf[p * 4], g = bgf[p * 4 + 1], b = bgf[p * 4 + 2];
    if (bt) [r, g, b] = bt(r, g, b);
    base[p * 3] = r; base[p * 3 + 1] = g; base[p * 3 + 2] = b;
  }
  // 2) 상품 상자
  const { alpha, bbox: bb, rgb } = lp;
  const prod = { w: lp.w, h: lp.h };
  const warnings = [];
  if (!bb) {
    for (let p = 0; p < W * H; p++) { out[p * 4] = Math.round(base[p * 3]); out[p * 4 + 1] = Math.round(base[p * 3 + 1]); out[p * 4 + 2] = Math.round(base[p * 3 + 2]); out[p * 4 + 3] = 255; }
    return { data: out, box: null, scale: 0, warnings: ['empty_mask'] };
  }
  const box = layerBox(L, W, H, bb.w, bb.h);
  let scale = L.one ? 1 : box.scale;
  let dw = bb.w * scale, dh = bb.h * scale;
  let left = box.cx - dw / 2, top = box.bottom - dh;
  const exact = Math.abs(scale - 1) < 1e-9 && !L.rot;
  if (exact) { left = Math.round(left); top = Math.round(top); }
  if (scale > 1.05) warnings.push('upscaled');
  const rad = (L.rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const cx = left + dw / 2, cy = top + dh / 2;
  // 결과 칸 → 상품 사진 칸 (회전은 상품 가운데 기준)
  const toProd = (x, y) => {
    const dx = x - cx, dy = y - cy;
    const ux = dx * cos + dy * sin, uy = -dx * sin + dy * cos;
    return [bb.x + bb.w / 2 + ux / scale, bb.y + bb.h / 2 + uy / scale];
  };
  // 돌린 상자를 덮는 결과 칸 범위
  const corners = [[-dw / 2, -dh / 2], [dw / 2, -dh / 2], [-dw / 2, dh / 2], [dw / 2, dh / 2]].map(([u, v]) => [cx + u * cos - v * sin, cy + u * sin + v * cos]);
  const ex0 = Math.floor(Math.min(...corners.map((c) => c[0]))), ex1 = Math.ceil(Math.max(...corners.map((c) => c[0])));
  const ey0 = Math.floor(Math.min(...corners.map((c) => c[1]))), ey1 = Math.ceil(Math.max(...corners.map((c) => c[1])));
  if (ex0 < 0 || ey0 < 0 || ex1 > W || ey1 > H) warnings.push('clipped');
  const qx0 = Math.max(0, ex0), qx1 = Math.min(W, ex1), qy0 = Math.max(0, ey0), qy1 = Math.min(H, ey1);
  const sampleA = (px, py) => {
    if (exact) { const ix = Math.floor(px), iy = Math.floor(py); return ix < 0 || iy < 0 || ix >= prod.w || iy >= prod.h ? 0 : alpha[iy * prod.w + ix]; }
    const x = px - 0.5, y = py - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const g = (ix, iy) => (ix < 0 || iy < 0 || ix >= prod.w || iy >= prod.h ? 0 : alpha[iy * prod.w + ix]);
    const t = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * tx, b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * tx;
    return t + (b - t) * ty;
  };
  // 3) 상품 칸 미리 계산 (덮는 범위만): 투명도와 색 — 배율 1·회전 0이면 원본 칸을 그대로 (다시 계산하지 않음)
  const rw = Math.max(0, qx1 - qx0), rh = Math.max(0, qy1 - qy0);
  const RA = new Float32Array(rw * rh), RC = new Float32Array(rw * rh * 3);
  const pt = toneFn(L.tone.b, L.tone.w);
  let groundY = -1;
  for (let y = qy0; y < qy1; y++) for (let x = qx0; x < qx1; x++) {
    const [px, py] = toProd(x + 0.5, y + 0.5);
    const a = sampleA(px, py);
    if (a <= 0) continue;
    let r, g, b;
    if (exact) {
      const i = (Math.floor(py) * prod.w + Math.floor(px)) * 4;
      r = rgb[i]; g = rgb[i + 1]; b = rgb[i + 2];
    } else {
      const sx = Math.min(prod.w - 1, Math.max(0, px - 0.5)), sy = Math.min(prod.h - 1, Math.max(0, py - 0.5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(prod.w - 1, x0 + 1), y1 = Math.min(prod.h - 1, y0 + 1), tx = sx - x0, ty = sy - y0;
      const c = (ix, iy, k) => rgb[(iy * prod.w + ix) * 4 + k];
      const lerp = (k) => { const t = c(x0, y0, k) + (c(x1, y0, k) - c(x0, y0, k)) * tx, bt2 = c(x0, y1, k) + (c(x1, y1, k) - c(x0, y1, k)) * tx; return t + (bt2 - t) * ty; };
      r = lerp(0); g = lerp(1); b = lerp(2);
    }
    if (pt) [r, g, b] = pt(r, g, b);
    const q = (y - qy0) * rw + (x - qx0);
    RA[q] = a / 255; RC[q * 3] = r; RC[q * 3 + 1] = g; RC[q * 3 + 2] = b;
    if (a >= 128 && y > groundY) groundY = y;
  }
  const At = (x, y) => (x < qx0 || y < qy0 || x >= qx1 || y >= qy1 ? 0 : RA[(y - qy0) * rw + (x - qx0)]);
  // 4) 그림자 (배경 위, 상품 아래): 상품 윤곽을 바닥 쪽으로 눌러 펼친 그림자 + 바닥에 닿는 곳의 좁고 진한 접촉 그림자 — 흐리게
  if (L.shadow.o > 0 && groundY >= 0) {
    const squash = 0.06 + 0.16 * L.shadow.s;            // 눌린 높이 (상품 높이에 대한 비율)
    const lean = L.shadow.dx * 0.8;                      // 빛 방향 (-1 왼쪽에서 빛 → 그림자는 오른쪽으로)
    const blurR = Math.max(1, Math.round(1 + L.shadow.s * Math.max(3, dh * 0.03)));
    const reach = Math.ceil(Math.abs(lean) * dh + blurR * 3);
    const sx0 = Math.max(0, qx0 - reach), sx1 = Math.min(W, qx1 + reach);
    const sy0 = Math.max(0, Math.floor(groundY - dh * squash) - blurR * 3), sy1 = Math.min(H, groundY + 2 + blurR * 3);
    const sw2 = sx1 - sx0, shh = sy1 - sy0;
    if (sw2 > 0 && shh > 0) {
      const cast = new Float32Array(sw2 * shh), touch = new Float32Array(sw2 * shh);
      const contactH = Math.max(2, Math.round(dh * 0.015));
      for (let y = sy0; y < sy1; y++) {
        const u = groundY - y;
        for (let x = sx0; x < sx1; x++) {
          const k = (y - sy0) * sw2 + (x - sx0);
          if (u >= 0) {
            const hgt = u / squash;
            const a = At(Math.round(x + lean * hgt), Math.round(groundY - hgt));
            if (a > 0) cast[k] = a * (1 - 0.65 * Math.min(1, hgt / Math.max(1, dh)));
          }
          if (u >= -1 && u <= contactH) touch[k] = At(x, groundY - Math.max(0, u));
        }
      }
      const b1 = boxMean(boxMean(cast, sw2, shh, blurR), sw2, shh, blurR);
      const b2 = boxMean(touch, sw2, shh, Math.max(1, Math.round(blurR / 2)));
      for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) {
        const k = (y - sy0) * sw2 + (x - sx0);
        const sdw = Math.min(0.9, L.shadow.o * (0.7 * b1[k] + 0.55 * b2[k]));
        if (sdw <= 0) continue;
        const p = y * W + x;
        base[p * 3] *= 1 - sdw; base[p * 3 + 1] *= 1 - sdw * 0.97; base[p * 3 + 2] *= 1 - sdw * 0.94;
      }
    }
  }
  // 5) 상품 얹기
  for (let y = qy0; y < qy1; y++) for (let x = qx0; x < qx1; x++) {
    const q = (y - qy0) * rw + (x - qx0), t = RA[q];
    if (t <= 0) continue;
    const p = y * W + x;
    if (t >= 1) { base[p * 3] = RC[q * 3]; base[p * 3 + 1] = RC[q * 3 + 1]; base[p * 3 + 2] = RC[q * 3 + 2]; continue; }
    base[p * 3] = RC[q * 3] * t + base[p * 3] * (1 - t); base[p * 3 + 1] = RC[q * 3 + 1] * t + base[p * 3 + 1] * (1 - t); base[p * 3 + 2] = RC[q * 3 + 2] * t + base[p * 3 + 2] * (1 - t);
  }
  for (let p = 0; p < W * H; p++) { out[p * 4] = Math.round(base[p * 3]); out[p * 4 + 1] = Math.round(base[p * 3 + 1]); out[p * 4 + 2] = Math.round(base[p * 3 + 2]); out[p * 4 + 3] = 255; }
  if (dh < H * 0.08) warnings.push('tiny');
  return { data: out, box: { left, top, w: dw, h: dh, rot: L.rot, exact, bbox: bb }, scale, warnings };
}
export const COMPOSE_WARN = {
  upscaled: '상품을 원래 사진보다 크게 늘렸어 — 흐려 보일 수 있어. 크기를 줄이거나 더 큰 상품 사진을 써줘.',
  clipped: '상품이 그림 밖으로 조금 나갔어 — 위치나 크기를 바꿔줘.',
  tiny: '상품이 아주 작아 — 크기를 키워줘.',
  empty_mask: '남길 영역이 비어 있어 — 마스크를 다시 만들어줘.',
};

// ───────── 브라우저 전용 ─────────
async function cachedBytes(url) {
  let cache = null;
  try { cache = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null; } catch { cache = null; }
  if (cache) { try { const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch { /* 아래로 */ } }
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error('fetch ' + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (cache) { try { await cache.put(url, new Response(buf.slice(), { headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' } })); } catch { /* 저장 공간 부족 등 — 다음에 다시 받음 */ } }
  return buf;
}
async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
let segP = null;
// 배경 지우기 모델 준비 (처음 한 번 약 19MB를 받아서 이 기기에 저장해 둠 — 다음부터는 바로). 받은 모델은 해시로 확인
export function loadSegmenter() {
  if (segP) return segP;
  segP = (async () => {
    const ort = await import(ORT_URL);
    const [wasm, model] = await Promise.all([cachedBytes(WASM_URL), cachedBytes(MODEL_URL)]);
    if ((await sha256Hex(model)) !== MODEL_SHA256) throw new Error('model_hash');
    ort.env.wasm.numThreads = 1;      // GitHub Pages 는 여러 스레드를 못 씀 (cross-origin isolation 없음)
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
    const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return {
      async run(rgba, w, h) {
        const input = segInput(rgba, w, h);
        const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SEG_SIZE, SEG_SIZE]) });
        return res[session.outputNames[0]].data;
      },
    };
  })();
  segP.catch(() => { segP = null; });
  return segP;
}
// 이미지(주소·Blob) → RGBA (maxSide 를 주면 같은 비율로 줄여서)
export async function decodeImage(src, maxSide = 0) {
  const blob = src instanceof Blob ? src : await (await fetch(src, { mode: 'cors', credentials: 'omit', cache: 'no-store' })).blob();
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch {
    bmp = await new Promise((ok, no) => { const u = URL.createObjectURL(blob); const im = new Image(); im.onload = () => { ok(im); setTimeout(() => URL.revokeObjectURL(u), 1000); }; im.onerror = () => { URL.revokeObjectURL(u); no(new Error('decode')); }; im.src = u; });
  }
  const W = bmp.width || bmp.naturalWidth, H = bmp.height || bmp.naturalHeight;
  const s = maxSide ? Math.min(1, maxSide / Math.max(W, H)) : 1;
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  if (bmp.close) bmp.close();
  cv.width = 0; cv.height = 0;
  return { data, w, h, blob, srcW: W, srcH: H, scaled: s < 1 }; // scaled: 원래 사진이 maxSide 보다 커서 줄여 읽었는지
}
export function rgbaCanvas(data, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').putImageData(new ImageData(data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data), w, h), 0, 0);
  return cv;
}
export function toPngBlob(data, w, h) {
  const cv = rgbaCanvas(data, w, h);
  return new Promise((ok, no) => cv.toBlob((b) => { cv.width = 0; cv.height = 0; if (b) ok(b); else no(new Error('png')); }, 'image/png'));
}
// 마스크 저장 모양: 흰색 + 투명도 = 마스크 (불투명 = 남김) — 그대로 보면 상품 실루엣
export function maskRGBA(mask, w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) { d[p * 4] = 255; d[p * 4 + 1] = 255; d[p * 4 + 2] = 255; d[p * 4 + 3] = mask[p]; }
  return d;
}
export async function maskFromPng(src) {
  const { data, w, h } = await decodeImage(src);
  return { data: alphaMask(data, w, h), w, h };
}
// 자동 마스크: 모델(U²-Netp) → 안 되면 간단히(테두리 색). 사진에 원래 투명한 부분이 있으면 그걸로
export async function autoMask(rgba, w, h, { useModel = true } = {}) {
  if (hasTransparency(rgba)) return { mask: keepMain(alphaMask(rgba, w, h), w, h), method: 'alpha' };
  if (useModel) {
    try {
      const seg = await loadSegmenter();
      const prob = await seg.run(rgba, w, h);
      const map = probToMap(prob, SEG_SIZE, w, h);
      return { mask: mapToMask(map, rgba, w, h), method: 'auto_u2netp' };
    } catch (e) {
      return { mask: simpleMask(rgba, w, h), method: 'auto_simple', error: String((e && e.message) || e) };
    }
  }
  return { mask: simpleMask(rgba, w, h), method: 'auto_simple' };
}
