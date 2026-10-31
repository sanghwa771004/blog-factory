// cutout.js — 상품 사진에서 '남길 영역'(마스크)을 만들고, 원본 픽셀을 그대로 AI 배경 위에 얹는 합성 (1.5.1 · 1.5.2)
// 모두 이 기기 브라우저 안에서 함 — 서버·외부 API를 부르지 않아서 배경 지우기 비용은 0원이고, 사진이 다른 곳으로 가지 않음.
// · 배경 지우기 모델: U²-Netp (Apache-2.0 — models/NOTICE) + ONNX Runtime Web 1.30.0 (MIT — vendor/onnxruntime-web/LICENSE). 앱과 같은 주소에서 받음 (CSP 'self')
// · Supabase Edge Function 은 CPU 시간이 짧고 그림 도구가 없어서 서버에서는 픽셀을 다루지 않음
// · 원본 상품 사진 파일은 읽기만 하고 고치지 않음. 합성 결과는 새 PNG(다시 압축하지 않음)로 따로 저장
// 순수 계산 함수(마스크 다듬기·품질 점수·합성)는 Node 시험에서도 돌아감. 브라우저 전용은 loadSegmenter·일꾼·decodeImage·toPngBlob·maskFromPng 뿐
// 1.5.2: 배경 지우기는 따로 일꾼(seg-worker.js)에서 — 처리 중에도 화면이 안 멈추고, 취소·시간 제한·끝나면 메모리 풀기. 일꾼을 못 쓰는 브라우저는 예전처럼 화면 쪽에서
//        기기 확인(WebAssembly SIMD·일꾼·메모리)으로 '간단 모드'(작게 처리), 마스크 품질 점수, 가장자리 다듬기, 2단계(정밀하게)
import { cleanLayer, layerBox, RATIOS } from './images.js?v=1.5.2';

export const SEG_SIZE = 320;                       // U²-Netp 입력 크기 (1×3×320×320)
export const MAX_MASK_SIDE = 1600;                 // 마스크를 만드는 크기 (큰 사진은 같은 비율로 줄여서 — 서버도 같은 비율만 받음)
export const MODEL_URL = './models/u2netp.onnx';
export const MODEL_SHA256 = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8';
export const ORT_URL = './vendor/onnxruntime-web/ort.wasm.bundle.min.mjs';
export const WASM_URL = './vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm';
export const WASM_SHA256 = '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2';
export const CACHE_NAME = 'gf-cutout-v1';
export const MODEL_BYTES = 4574861;                // 받기 진행률 표시용 (압축돼서 오면 content-length 가 달라서)
export const WASM_BYTES = 14239897;
export const WORKER_URL = './seg-worker.js?v=1.5.2';

// ───────── 이 기기·브라우저 확인 (1.5.2) ─────────
// WebAssembly SIMD: 배경 지우기 실행기(ONNX Runtime Web 1.30 의 SIMD 판)가 꼭 필요 (iOS Safari 16.4 이상). 없으면 모델 없이 간단히·직접 칠하기만
// (wasm-feature-detect 의 simd 검사와 같은 작은 모듈 — 실행하지 않고 검사만)
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
export function capabilities(g = globalThis) {
  const wasm = typeof g.WebAssembly === 'object' && !!g.WebAssembly && typeof g.WebAssembly.validate === 'function';
  let simd = false;
  try { simd = wasm && g.WebAssembly.validate(SIMD_TEST); } catch { simd = false; }
  const nav = g.navigator || {};
  const ua = String(nav.userAgent || '');
  return {
    wasm, simd, worker: typeof g.Worker === 'function', cache: !!g.caches, idb: !!g.indexedDB, offscreen: typeof g.OffscreenCanvas === 'function',
    memory: Number(nav.deviceMemory) || 0, cores: Number(nav.hardwareConcurrency) || 0, // deviceMemory 는 Safari 에 없음 (0 = 모름)
    ios: /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1),
  };
}
// 처리 크기: 보통 / 간단 모드 (저사양·메모리 적음·전에 처리가 멈춤). 간단 모드는 상품 사진을 작게 읽어서 마스크·합성도 작게
export const SIZES = { normal: { decode: 2560, mask: MAX_MASK_SIDE, preview: 900 }, lite: { decode: 1600, mask: 1024, preview: 600 } };
export function deviceTier(cap = capabilities(), { failed = false, force = '' } = {}) {
  const reasons = [];
  if (!cap.wasm || !cap.simd) reasons.push('no_simd');
  if (cap.memory && cap.memory <= 2) reasons.push('low_memory'); // deviceMemory 는 크롬 계열만 알려줌 (아이폰 Safari 는 모름 → 처리가 한 번 멈추면 그때 간단 모드로)
  if (failed) reasons.push('failed');
  // 코어 수는 메모리를 말해 주지 않아서(2코어 PC도 많음) 간단 모드 기준으로 쓰지 않음
  const lite = force === 'lite' || (force !== 'normal' && reasons.length > 0);
  return { lite, model: cap.wasm && cap.simd, worker: cap.worker, reasons, sizes: lite ? SIZES.lite : SIZES.normal, ios: cap.ios };
}
export const TIER_MSG = {
  no_simd: '이 브라우저는 배경 지우기 도구(WebAssembly SIMD)를 못 돌려서 간단한 방법(테두리 색)과 직접 칠하기만 돼 (iPhone은 iOS 16.4 이상이면 돼).',
  low_memory: '이 기기는 메모리가 적어 보여서 사진을 작게 처리해.',
  failed: '전에 이 기기에서 처리가 멈췄거나 메모리가 모자라서 사진을 작게 처리해.',
};

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
// 2단계 '정밀하게' (1.5.2): 1단계 결과의 상품 상자(+여백)만 잘라서 모델을 한 번 더 돌림. 모델 입력은 늘 320×320이라
// 상품이 사진에서 작을수록 가장자리·가는 부분(끈·털)이 뭉개지는데, 잘라서 다시 보면 상품이 입력을 더 크게 채움. 상자 밖은 1단계 그대로.
// runModel(rgba, w, h) → 모델의 320×320 출력 (화면 쪽이든 일꾼이든 같은 함수로). 시간은 대략 두 배
export async function twoPassMap(rgba, w, h, runModel, { margin = 0.12, thr = 0.5, maxFill = 0.7 } = {}) {
  const p1 = probToMap(await runModel(rgba, w, h), SEG_SIZE, w, h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (p1[y * w + x] >= thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { map: p1, refined: false };
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const mx = Math.round(bw * margin) + 2, my = Math.round(bh * margin) + 2;
  const cx0 = Math.max(0, x0 - mx), cy0 = Math.max(0, y0 - my), cx1 = Math.min(w, x1 + 1 + mx), cy1 = Math.min(h, y1 + 1 + my);
  const cw = cx1 - cx0, ch = cy1 - cy0;
  // 상품이 이미 사진을 거의 채우면 다시 봐도 나아지지 않음
  if (cw * ch > maxFill * w * h || cw < 16 || ch < 16) return { map: p1, refined: false };
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) crop.set(rgba.subarray(((cy0 + y) * w + cx0) * 4, ((cy0 + y) * w + cx1) * 4), y * cw * 4);
  const p2 = probToMap(await runModel(crop, cw, ch), SEG_SIZE, cw, ch);
  const out = Float32Array.from(p1);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out[(cy0 + y) * w + cx0 + x] = p2[y * cw + x];
  return { map: out, refined: true, crop: { x: cx0, y: cy0, w: cw, h: ch } };
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
// 넓히기(+)·좁히기(-) px칸 (넓히기 = 거꾸로 해서 좁히기)
export function growMask(mask, w, h, px) {
  if (!px) return Uint8ClampedArray.from(mask);
  if (px < 0) return erodeMask(mask, w, h, -px);
  const inv = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) inv[i] = 255 - mask[i];
  const e = erodeMask(inv, w, h, px);
  for (let i = 0; i < w * h; i++) e[i] = 255 - e[i];
  return e;
}
// 가장자리 다듬기 (1.5.2 편집 도구): 경계 근처 띠만 사진의 실제 윤곽에 맞춰 다시 (유도 필터). 띠 밖(확실한 안쪽·바깥)은 그대로 — 손으로 칠한 곳을 되돌리지 않게
export function refineEdges(mask, rgba, w, h, { radius = 0 } = {}) {
  const r = radius || Math.max(2, Math.round(Math.max(w, h) / 250));
  const p = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) p[i] = mask[i] / 255;
  const near = boxMean(p, w, h, r * 2);
  const q = guidedFilter(grayOf(rgba, w, h), p, w, h, r, 1e-3);
  const out = Uint8ClampedArray.from(mask);
  for (let i = 0; i < w * h; i++) if (near[i] > 0.02 && near[i] < 0.98) out[i] = Math.round(255 * smooth(0.35, 0.65, q[i]));
  return out;
}
// 연결된 조각·구멍 세기 (4방향, 문턱 thr) — 품질 점수용 (keepMain 과 같은 기준)
function partsOf(mask, w, h, thr = 128) {
  const N = w * h, lab = new Int32Array(N).fill(-1), stack = new Int32Array(N);
  const fg = [], holes = [];
  for (let s = 0; s < N; s++) {
    if (lab[s] !== -1) continue;
    const on = mask[s] >= thr;
    let sp = 0, n = 0, touches = false;
    stack[sp++] = s; lab[s] = 1;
    while (sp) {
      const p = stack[--sp]; n++;
      const x = p % w, y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      if (x > 0 && lab[p - 1] === -1 && (mask[p - 1] >= thr) === on) { lab[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && lab[p + 1] === -1 && (mask[p + 1] >= thr) === on) { lab[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && lab[p - w] === -1 && (mask[p - w] >= thr) === on) { lab[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && lab[p + w] === -1 && (mask[p + w] >= thr) === on) { lab[p + w] = 1; stack[sp++] = p + w; }
    }
    if (on) fg.push(n); else if (!touches) holes.push(n);
  }
  return { fg: fg.sort((a, b) => b - a), holes };
}
// 마스크 품질 점수 (1.5.2): 0~100 과 고칠 곳. 정답을 모르는 상태에서 보는 '추정'이야 — 점수가 높아도 확대해서 직접 확인해야 해
// rgba(같은 크기 사진)를 주면 경계가 사진의 실제 윤곽(밝기 변화)과 맞는지도 봄
export const MASK_QUALITY_MSG = {
  empty: '남긴 부분이 거의 없어 — 다시 자동으로 하거나 칠해서 남겨줘.',
  full: '거의 다 남았어 — 배경이 안 지워진 것 같아.',
  parts: '떨어진 조각이 더 있어 — 상품의 일부(구성품)인지, 지워야 할 배경인지 확인해줘.',
  cut: '남긴 부분이 사진 가장자리(위·옆)에 닿아 있어 — 상품이 잘렸거나 배경이 덜 지워졌을 수 있어.',
  cut_bottom: '아래쪽이 사진 끝에 닿아 있어 — 바닥까지 찍힌 사진이면 괜찮아.',
  soft: '가장자리가 흐릿한 곳이 많아 — 털·투명한 부분·배경과 비슷한 색일 수 있어. 확대해서 고쳐줘.',
  weak_edge: '경계가 사진의 실제 윤곽과 잘 안 맞아 — 배경과 색이 비슷하면 이래. 확대해서 칠해줘.',
  holes: '안쪽에 빈 곳이 있어 — 손잡이처럼 진짜 뚫린 곳이 아니면 남기기 붓으로 메워줘.',
};
export const MASK_LEVEL = { good: '좋아 보임', check: '확인 필요', fix: '고쳐야 함' };
export function maskQuality(mask, w, h, rgba = null) {
  const N = w * h;
  if (!N || !mask || mask.length < N) return { score: 0, level: 'fix', coverage: 0, issues: ['empty'] };
  const g = rgba && rgba.length >= N * 4 ? grayOf(rgba, w, h) : null;
  const near = (i, x, y) => { // 3×3 안에서 가장 큰 밝기 차이
    let mn = 1, mx = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v = g[yy * w + xx]; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    return mx - mn;
  };
  let fgN = 0, soft = 0, bnd = 0, gsum = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = mask[i], on = v >= 128;
    if (on) fgN++;
    if (v > 24 && v < 232) soft++;
    if ((x + 1 < w && (mask[i + 1] >= 128) !== on) || (y + 1 < h && (mask[i + w] >= 128) !== on)) { bnd++; if (g) gsum += near(i, x, y); }
  }
  // 사진 전체의 '뚜렷한 윤곽' 세기 (표본 90번째 값) — 경계의 밝기 변화가 이것에 비해 얼마나 되는지
  let edge = null;
  if (g && bnd) {
    const hist = new Uint32Array(101); let n = 0;
    const st = Math.max(1, Math.round(Math.sqrt(N / 40000)));
    for (let y = 1; y < h - 1; y += st) for (let x = 1; x < w - 1; x += st) { hist[Math.min(100, Math.round(near(y * w + x, x, y) * 100))]++; n++; }
    let acc = 0, p90 = 0;
    for (let k = 0; k <= 100; k++) { acc += hist[k]; if (acc >= n * 0.9) { p90 = k / 100; break; } }
    edge = Math.round(Math.min(1.5, gsum / bnd / Math.max(0.02, p90)) * 100) / 100;
  }
  const cov = fgN / N;
  const { fg, holes } = partsOf(mask, w, h);
  const big = fg[0] || 0;
  const extra = fg.slice(1).filter((n) => n >= big * 0.02 && n >= N * 0.0005).length;
  const bigHoles = holes.filter((n) => n >= N * 0.0005).length;
  const side = (pts) => { let k = 0; for (const p of pts) if (mask[p] >= 128) k++; return pts.length ? k / pts.length : 0; };
  const row = (y) => Array.from({ length: w }, (_, x) => y * w + x), col = (x) => Array.from({ length: h }, (_, y) => y * w + x);
  const touches = { top: side(row(0)), bottom: side(row(h - 1)), left: side(col(0)), right: side(col(w - 1)) };
  const issues = [];
  let s = 100;
  if (cov < 0.02) { s -= 70; issues.push('empty'); } else if (cov > 0.97) { s -= 70; issues.push('full'); }
  if (extra) { s -= 12; issues.push('parts'); }
  const cut = ['top', 'left', 'right'].filter((k) => touches[k] > 0.03).length;
  if (cut && cov <= 0.97) { s -= 10 * cut; issues.push('cut'); }
  if (touches.bottom > 0.03 && cov <= 0.97) issues.push('cut_bottom');
  const softRatio = bnd ? soft / bnd : 0;   // 흐릿한 띠의 두께(대략 몇 칸)
  if (softRatio > 6 && cov >= 0.02) { s -= 15; issues.push('soft'); }
  if (edge != null && edge < 0.35 && cov >= 0.02 && cov <= 0.97) { s -= 20; issues.push('weak_edge'); }
  if (bigHoles) issues.push('holes');
  s = Math.max(0, Math.min(100, s));
  return { score: s, level: s >= 75 ? 'good' : s >= 50 ? 'check' : 'fix', coverage: Math.round(cov * 1000) / 1000, parts: 1 + extra, holes: bigHoles,
    soft: Math.round(softRatio * 10) / 10, edge, touches, issues };
}
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
// 상품 상자를 면적 평균으로 rw×rh 까지 줄인 레이어 (투명도로 곱한 색 → 줄임 → 다시 나눔). 결과: {rgb(Float32 RGBA), alpha(Float32 0~255), w, h, bbox}
export function reducedLayer(lp, bb, rw, rh) {
  const pm = new Float32Array(bb.w * bb.h * 4);
  for (let y = 0; y < bb.h; y++) {
    for (let x = 0; x < bb.w; x++) {
      const si = (bb.y + y) * lp.w + bb.x + x, di = (y * bb.w + x) * 4, a = lp.alpha[si] / 255;
      pm[di] = lp.rgb[si * 4] * a; pm[di + 1] = lp.rgb[si * 4 + 1] * a; pm[di + 2] = lp.rgb[si * 4 + 2] * a; pm[di + 3] = lp.alpha[si];
    }
  }
  const f = resample(pm, bb.w, bb.h, rw, rh, 4);
  const rgb = new Float32Array(rw * rh * 4), alpha = new Float32Array(rw * rh);
  for (let p = 0; p < rw * rh; p++) {
    const a = f[p * 4 + 3];
    alpha[p] = a;
    const k = a > 1e-6 ? 255 / a : 0;
    rgb[p * 4] = Math.min(255, f[p * 4] * k); rgb[p * 4 + 1] = Math.min(255, f[p * 4 + 1] * k); rgb[p * 4 + 2] = Math.min(255, f[p * 4 + 2] * k); rgb[p * 4 + 3] = 255;
  }
  return { rgb, alpha, w: rw, h: rh, bbox: { x: 0, y: 0, w: rw, h: rh } };
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
  const bb = lp.bbox;
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
  // 줄일 때: 원본에서 2×2 칸만 보고 뽑으면 작은 글자·줄무늬가 깨져 보여서(계단·물결), 먼저 면적 평균으로 그 크기까지 줄인 레이어를 만든 뒤
  // 그걸 거의 1:1로 그림 (투명도로 곱한 색을 같이 줄여서 가장자리에 원래 배경색이 섞이지 않게 — 1.5.1 검토)
  let src = lp, sb = bb, sx = scale, sy = scale;
  if (!exact && scale < 0.999) {
    const rw = Math.max(1, Math.round(dw)), rh = Math.max(1, Math.round(dh));
    if (!lp.reduced || lp.reduced.w !== rw || lp.reduced.h !== rh) lp.reduced = reducedLayer(lp, bb, rw, rh);
    src = lp.reduced; sb = src.bbox; sx = dw / rw; sy = dh / rh;
  }
  const { alpha, rgb } = src;
  const prod = { w: src.w, h: src.h };
  const rad = (L.rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const cx = left + dw / 2, cy = top + dh / 2;
  // 결과 칸 → 상품 사진 칸 (회전은 상품 가운데 기준)
  const toProd = (x, y) => {
    const dx = x - cx, dy = y - cy;
    const ux = dx * cos + dy * sin, uy = -dx * sin + dy * cos;
    return [sb.x + sb.w / 2 + ux / sx, sb.y + sb.h / 2 + uy / sy];
  };
  // 돌린 상자를 덮는 결과 칸 범위
  const corners = [[-dw / 2, -dh / 2], [dw / 2, -dh / 2], [-dw / 2, dh / 2], [dw / 2, dh / 2]].map(([u, v]) => [cx + u * cos - v * sin, cy + u * sin + v * cos]);
  const ex0 = Math.floor(Math.min(...corners.map((c) => c[0]))), ex1 = Math.ceil(Math.max(...corners.map((c) => c[0])));
  const ey0 = Math.floor(Math.min(...corners.map((c) => c[1]))), ey1 = Math.ceil(Math.max(...corners.map((c) => c[1])));
  if (ex0 < 0 || ey0 < 0 || ex1 > W || ey1 > H) warnings.push('clipped');
  const qx0 = Math.max(0, ex0), qx1 = Math.min(W, ex1), qy0 = Math.max(0, ey0), qy1 = Math.min(H, ey1);
  // 3) 상품 칸 미리 계산 (덮는 범위만): 투명도와 색 — 배율 1·회전 0이면 원본 칸을 그대로 (다시 계산하지 않음)
  // 그 밖은 둘레 네 칸을 쌍선형으로 섞는데, 색은 투명도로 곱해서 섞고 나중에 나눔 (premultiplied) — 완전히 투명한 칸의 색(원래 배경색·0)이
  // 가장자리에 섞여 테두리가 생기지 않게 (1.5.1 재검토: 흰 상품이 흰 배경에서 회색 테두리)
  const rw = Math.max(0, qx1 - qx0), rh = Math.max(0, qy1 - qy0);
  const RA = new Float32Array(rw * rh), RC = new Float32Array(rw * rh * 3);
  const pt = toneFn(L.tone.b, L.tone.w);
  let groundY = -1;
  for (let y = qy0; y < qy1; y++) for (let x = qx0; x < qx1; x++) {
    const [px, py] = toProd(x + 0.5, y + 0.5);
    let a, r, g, b;
    if (exact) {
      const ix = Math.floor(px), iy = Math.floor(py);
      if (ix < 0 || iy < 0 || ix >= prod.w || iy >= prod.h) continue;
      a = alpha[iy * prod.w + ix];
      if (a <= 0) continue;
      const i = (iy * prod.w + ix) * 4;
      r = rgb[i]; g = rgb[i + 1]; b = rgb[i + 2];
    } else {
      const sx0 = px - 0.5, sy0 = py - 0.5;
      const x0 = Math.floor(sx0), y0 = Math.floor(sy0), tx = sx0 - x0, ty = sy0 - y0;
      let A = 0, R = 0, G = 0, B = 0;
      for (let k = 0; k < 4; k++) {
        const ix = x0 + (k & 1), iy = y0 + (k >> 1);
        if (ix < 0 || iy < 0 || ix >= prod.w || iy >= prod.h) continue;
        const w = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty);
        const j = iy * prod.w + ix, aw = alpha[j] * w;
        if (aw <= 0) continue;
        A += aw; R += rgb[j * 4] * aw; G += rgb[j * 4 + 1] * aw; B += rgb[j * 4 + 2] * aw;
      }
      if (A <= 1e-6) continue;
      a = A; r = R / A; g = G / A; b = B / A;
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
// 받은 파일은 해시가 맞을 때만 이 기기에 저장하고, 저장된 것도 쓸 때마다 해시를 확인 (와이파이 로그인 화면 같은 엉뚱한 응답이나
// 같은 주소의 새 파일이 영영 남아서 배경 지우기가 계속 '간단히'로만 되지 않게 — 1.5.1 검토). 저장 이름에 해시를 넣어서 파일이 바뀌면 새로 받음
// 1.5.2: 받는 동안 진행률(onProgress)과 취소(signal)
async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const cancelled = () => ({ code: 'cancelled' });
async function cachedBytes(url, sha, { onProgress = null, signal = null, expect = 0 } = {}) {
  const key = `${url}?sha=${sha.slice(0, 16)}`;
  let cache = null;
  try { cache = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null; } catch { cache = null; }
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        const b = new Uint8Array(await hit.arrayBuffer());
        if ((await sha256Hex(b)) === sha) { if (onProgress) onProgress(b.length, b.length, true); return b; }
        await cache.delete(key);
      }
    } catch { /* 아래로 */ }
  }
  if (signal && signal.aborted) throw cancelled();
  let res;
  try { res = await fetch(url, { cache: 'no-cache', signal: signal || undefined }); } catch (e) { if (signal && signal.aborted) throw cancelled(); throw e; }
  if (!res.ok) throw new Error('fetch ' + res.status);
  let buf;
  if (onProgress && res.body && res.body.getReader) {
    const rd = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      let r;
      try { r = await rd.read(); } catch (e) { if (signal && signal.aborted) throw cancelled(); throw e; }
      if (r.done) break;
      parts.push(r.value); got += r.value.length;
      onProgress(got, expect || Number(res.headers.get('content-length')) || 0, false);
    }
    buf = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
  } else buf = new Uint8Array(await res.arrayBuffer());
  if ((await sha256Hex(buf)) !== sha) throw new Error(url === MODEL_URL ? 'model_hash' : 'wasm_hash');
  if (cache) { try { await cache.put(key, new Response(buf.slice(), { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* 저장 공간 부족 등 — 다음에 다시 받음 */ } }
  return buf;
}
async function dropCache() { try { if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME); } catch { /* 무시 */ } }
// 두 파일을 같이 받으며 진행률을 하나로 (약 19MB)
async function toolBytes({ onStage = null, signal = null } = {}) {
  const got = { w: 0, m: 0 }, cached = { w: false, m: false };
  const tell = () => { if (onStage) onStage({ stage: 'download', loaded: got.w + got.m, total: WASM_BYTES + MODEL_BYTES, cached: cached.w && cached.m }); };
  const [wasm, model] = await Promise.all([
    cachedBytes(WASM_URL, WASM_SHA256, { signal, expect: WASM_BYTES, onProgress: (n, _t, c) => { got.w = n; cached.w = !!c; tell(); } }),
    cachedBytes(MODEL_URL, MODEL_SHA256, { signal, expect: MODEL_BYTES, onProgress: (n, _t, c) => { got.m = n; cached.m = !!c; tell(); } }),
  ]);
  return { wasm, model };
}
const ownBuffer = (u8) => (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer);

// ── 화면 쪽에서 (일꾼을 못 쓰는 브라우저) ──
let segP = null;
// 배경 지우기 모델 준비 (처음 한 번 약 19MB를 받아서 이 기기에 저장해 둠 — 다음부터는 바로). 받은 모델은 해시로 확인
export function loadSegmenter(o = {}) {
  if (segP) return segP;
  segP = (async () => {
    const ort = await import(ORT_URL);
    const { wasm, model } = await toolBytes(o);
    if (o.onStage) o.onStage({ stage: 'prepare' });
    ort.env.wasm.numThreads = 1;      // GitHub Pages 는 여러 스레드를 못 씀 (cross-origin isolation 없음)
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = ownBuffer(wasm);
    let session;
    try { session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }); } catch (e) { await dropCache(); throw e; }
    return {
      async run(rgba, w, h) {
        const input = segInput(rgba, w, h);
        const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SEG_SIZE, SEG_SIZE]) });
        return res[session.outputNames[0]].data;
      },
      release() { try { session.release(); } catch { /* 무시 */ } },
    };
  })();
  segP.catch(() => { segP = null; });
  return segP;
}
async function maskOnMain(rgba, w, h, { refine = false, onStage = null, signal = null } = {}) {
  const seg = await loadSegmenter({ onStage, signal });
  if (signal && signal.aborted) throw cancelled();
  if (onStage) onStage({ stage: 'run', where: 'main' });
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const run = (d, ww, hh) => seg.run(d, ww, hh);
  const r = refine ? await twoPassMap(rgba, w, h, run) : { map: probToMap(await run(rgba, w, h), SEG_SIZE, w, h), refined: false };
  if (signal && signal.aborted) throw cancelled();
  const mask = mapToMask(r.map, rgba, w, h);
  return { mask, quality: maskQuality(mask, w, h, rgba), refined: r.refined, where: 'main', ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) };
}

// ── 일꾼에서 (1.5.2 기본) ──
// 처음 한 번 파일을 받아 넘기고, 끝나고 45초 동안 안 쓰면 일꾼을 끝내서 메모리를 풀어 (다음엔 이 기기에 저장된 파일로 금방 다시 준비)
let SW = null, workerBroken = false, seqId = 0;
const IDLE_MS = 45000;
function killWorker(reason = 'cancelled') {
  const sw = SW;
  SW = null;
  if (!sw) return;
  clearTimeout(sw.idle);
  try { sw.w.terminate(); } catch { /* 무시 */ }
  for (const p of sw.pend.values()) p.no({ code: reason });
  sw.pend.clear();
}
function ask(sw, msg, transfer, ms) {
  const id = ++seqId;
  return new Promise((ok, no) => {
    const t = ms ? setTimeout(() => { if (sw.pend.has(id)) killWorker('timeout'); }, ms) : null;
    sw.pend.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, no: (e) => { clearTimeout(t); no(e); } });
    sw.w.postMessage({ ...msg, id }, transfer || []);
  });
}
async function workerReady({ onStage = null, signal = null } = {}) {
  if (SW) { clearTimeout(SW.idle); return SW.ready; }
  const w = new Worker(new URL(WORKER_URL, import.meta.url), { type: 'module' });
  const sw = { w, pend: new Map(), idle: null, ready: null };
  SW = sw;
  w.onmessage = (ev) => {
    const m = ev.data || {};
    const p = sw.pend.get(m.id);
    if (!p) return;
    sw.pend.delete(m.id);
    if (m.type === 'error') p.no(new Error(m.message || 'worker'));
    else p.ok(m);
  };
  // 일꾼 파일을 못 읽었거나(옛 브라우저는 module 일꾼을 못 씀) 안에서 죽으면 → 화면 쪽으로 (한 번 실패하면 이번 접속 동안은 계속 화면 쪽)
  w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); workerBroken = true; if (SW === sw) killWorker('worker_failed'); };
  sw.ready = (async () => {
    const { wasm, model } = await toolBytes({ onStage, signal });
    if (SW !== sw) throw cancelled();
    if (onStage) onStage({ stage: 'prepare' });
    await ask(sw, { type: 'init', wasm: ownBuffer(wasm), model: ownBuffer(model) }, [], 90000);
    return sw;
  })();
  sw.ready.catch(() => { if (SW === sw) killWorker('worker_failed'); });
  return sw.ready;
}
async function maskInWorker(rgba, w, h, { refine = false, onStage = null, signal = null } = {}) {
  const onAbort = () => killWorker('cancelled');
  if (signal) { if (signal.aborted) throw cancelled(); signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    const sw = await workerReady({ onStage, signal });
    if (onStage) onStage({ stage: 'run', where: 'worker' });
    const copy = Uint8ClampedArray.from(rgba); // 넘기면 원래 배열이 비게 돼서 사본을 넘김 (화면이 쓰는 상품 사진은 그대로)
    const r = await ask(sw, { type: 'mask', rgba: copy, w, h, refine }, [copy.buffer], refine ? 150000 : 90000);
    if (SW === sw) { clearTimeout(sw.idle); sw.idle = setTimeout(() => { if (SW === sw && !sw.pend.size) killWorker('idle'); }, IDLE_MS); }
    return { mask: r.mask, quality: r.quality, refined: r.refined, where: 'worker', ms: r.ms };
  } finally { if (signal) signal.removeEventListener('abort', onAbort); }
}
// 배경 지우기 도구를 메모리에서 내림 (상품 화면을 나갈 때·합성을 저장하기 전 — 아이폰처럼 메모리가 빠듯한 기기를 위해)
export function releaseSegmenter() {
  killWorker('idle');
  if (segP) { const p = segP; segP = null; p.then((s) => s && s.release && s.release()).catch(() => {}); }
}
export const segmenterState = () => ({ worker: !!SW, workerBroken, main: !!segP });

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
  if (!ctx) { if (bmp.close) bmp.close(); throw new Error('canvas'); } // 아이폰에서 캔버스 메모리가 모자라면 null
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  if (bmp.close) bmp.close();
  cv.width = 0; cv.height = 0;
  return { data, w, h, blob, srcW: W, srcH: H, scaled: s < 1 }; // scaled: 원래 사진이 maxSide 보다 커서 줄여 읽었는지
}
export function rgbaCanvas(data, w, h, opaque = false) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', opaque ? { alpha: false } : undefined);
  if (!ctx) throw new Error('canvas');
  ctx.putImageData(new ImageData(data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data), w, h), 0, 0);
  return cv;
}
// PNG 로 (무손실). opaque: 모든 칸이 불투명한 그림(합성 결과)은 투명도 칸 없이 — 브라우저에 따라 파일이 작아짐 (픽셀 값은 같음, 화면 시험으로 확인)
export function toPngBlob(data, w, h, { opaque = false } = {}) {
  const cv = rgbaCanvas(data, w, h, opaque);
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
// 자동 마스크: 모델(U²-Netp — 일꾼, 안 되면 화면 쪽) → 안 되면 간단히(테두리 색). 사진에 원래 투명한 부분이 있으면 그걸로
// opts: refine(2단계 정밀하게), onStage({stage:'download'|'prepare'|'run', loaded, total, where}), signal(취소)
// 취소·시간 초과는 오류로 던짐 (마스크를 바꾸지 않음) — 그 밖의 실패는 간단한 방법으로 만들고 error 에 이유
export async function autoMask(rgba, w, h, { useModel = true, refine = false, onStage = null, signal = null } = {}) {
  const done = (mask, method, extra = {}) => ({ mask, method, quality: extra.quality || maskQuality(mask, w, h, rgba), ...extra });
  if (hasTransparency(rgba)) return done(keepMain(alphaMask(rgba, w, h), w, h), 'alpha');
  if (useModel) {
    const tier = deviceTier();
    if (!tier.model) return done(simpleMask(rgba, w, h), 'auto_simple', { error: 'no_simd' });
    try {
      let r = null;
      if (tier.worker && !workerBroken) {
        try { r = await maskInWorker(rgba, w, h, { refine, onStage, signal }); } catch (e) {
          if (e && ['cancelled', 'timeout'].includes(e.code)) throw e;
          if (e && /model_hash|wasm_hash|fetch/.test(String(e.message || ''))) throw e;
          workerBroken = true; // 일꾼만 안 되는 브라우저 → 화면 쪽으로 다시
        }
      }
      if (!r) r = await maskOnMain(rgba, w, h, { refine, onStage, signal });
      return done(r.mask, 'auto_u2netp', { quality: r.quality, refined: !!r.refined, where: r.where, ms: r.ms });
    } catch (e) {
      if (e && ['cancelled', 'timeout'].includes(e.code)) throw e;
      return done(simpleMask(rgba, w, h), 'auto_simple', { error: String((e && (e.code || e.message)) || e) });
    }
  }
  return done(simpleMask(rgba, w, h), 'auto_simple');
}
