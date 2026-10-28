// cutout.js — 원본 보존 합성의 계산 (지시서 9번 1·2·3·4·8). 그림을 만들어 픽셀 값으로 확인 — 실제 상품 사진·실제 AI 배경의 '품질' 시험은 아님
// 배경 지우기 모델(U²-Netp)은 브라우저 시험(tests/ui)에서 실제로 돌려 봄. 여기서는 모델 없이 되는 계산만
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resample, outputSize, coverRect, simpleMask, keepMain, featherMask, erodeMask, edgeMask, brush, stroke, maskBBox, maskCoverage, maskAt, decontaminate,
  composite, hasTransparency, alphaMask, segInput, probToMap, guidedFilter, mapToMask, workSize, maskRGBA, SEG_SIZE,
} from '../cutout.js';
import { cleanLayer, RATIOS } from '../images.js';

// 그림 만들기: 단색 배경(bgc) 위에 무늬 있는 상품 사각형 (x0,y0)~(x1,y1) — 칸마다 색이 달라서 '같은 칸을 복사했는지' 알 수 있음
function photo(w, h, { bgc = [245, 245, 245], box = [0.3, 0.25, 0.7, 0.85] } = {}) {
  const d = new Uint8ClampedArray(w * h * 4);
  const [x0, y0, x1, y1] = [Math.round(box[0] * w), Math.round(box[1] * h), Math.round(box[2] * w), Math.round(box[3] * h)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const inP = x >= x0 && x < x1 && y >= y0 && y < y1;
    d[i] = inP ? (x * 7 + y * 3) % 200 + 20 : bgc[0];
    d[i + 1] = inP ? (x * 5 + y * 11) % 180 + 30 : bgc[1];
    d[i + 2] = inP ? (x * 13 + y * 2) % 160 + 40 : bgc[2];
    d[i + 3] = 255;
  }
  return { data: d, w, h, rect: { x0, y0, x1, y1 } };
}
function solid(w, h, c) { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; } return { data: d, w, h }; }
function gradient(w, h) { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = (x * 255) / w; d[i + 1] = (y * 255) / h; d[i + 2] = 120; d[i + 3] = 255; } return { data: d, w, h }; }
const rectMask = (p) => { const m = new Uint8ClampedArray(p.w * p.h); for (let y = p.rect.y0; y < p.rect.y1; y++) for (let x = p.rect.x0; x < p.rect.x1; x++) m[y * p.w + x] = 255; return m; };
const NOSHADOW = { shadow: { o: 0 }, mask: { feather: 0, shrink: 0 } };
const px = (img, W, x, y) => Array.from(img.slice((y * W + x) * 4, (y * W + x) * 4 + 3));

describe('크기·다시 뽑기', () => {
  test('결과 크기는 고른 비율 그대로, 긴 변은 용도 크기와 배경×1.25 중 작은 쪽', () => {
    for (const r of Object.keys(RATIOS)) {
      const { W, H } = outputSize(r, 1024, 1024, 1600);
      assert.ok(Math.abs(W / H - RATIOS[r].w / RATIOS[r].h) < 0.01, r);
      assert.equal(Math.max(W, H), 1280, r);
      assert.equal(W % 2 + H % 2, 0);
    }
    assert.deepEqual(outputSize('4:3', 2048, 1536, 1600), { W: 1600, H: 1200 });
  });
  test('면적 평균으로 줄이기·쌍선형으로 늘리기', () => {
    const one = new Uint8ClampedArray([0, 100, 200, 255]);
    assert.deepEqual(Array.from(resample(one, 2, 2, 1, 1, 1)), [138.75]);
    const s = solid(64, 48, [10, 20, 30]);
    const r = resample(s.data, 64, 48, 13, 7, 4);
    for (let i = 0; i < r.length; i += 4) assert.deepEqual([Math.round(r[i]), Math.round(r[i + 1]), Math.round(r[i + 2])], [10, 20, 30]);
    const up = resample(new Float32Array([0, 1]), 2, 1, 4, 1, 1);
    assert.deepEqual(Array.from(up).map((v) => Math.round(v * 100) / 100), [0, 0.25, 0.75, 1]);
    assert.deepEqual(coverRect(1000, 500, 400, 400), { x: 250, y: 0, w: 500, h: 500 });
    assert.deepEqual(workSize(3200, 2400), { w: 1600, h: 1200, scale: 0.5 });
  });
});

describe('마스크 만들기·다듬기 (지시서 9번 3)', () => {
  test('간단히(테두리 색): 흰 배경의 상품을 거의 그대로 남김', () => {
    const p = photo(160, 120);
    const m = simpleMask(p.data, p.w, p.h);
    const gt = rectMask(p);
    let inter = 0, uni = 0;
    for (let i = 0; i < m.length; i++) { const a = m[i] >= 128, b = gt[i] === 255; if (a && b) inter++; if (a || b) uni++; }
    assert.ok(inter / uni > 0.95, `IoU ${inter / uni}`);
  });
  test('작은 조각은 지우고 안쪽 작은 구멍은 메움, 테두리에 닿은 빈 곳(진짜 배경)은 그대로', () => {
    const w = 100, h = 100, m = new Uint8ClampedArray(w * h);
    for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) m[y * w + x] = 255;
    m[50 * w + 50] = 0; m[50 * w + 51] = 0;          // 작은 구멍
    m[5 * w + 5] = 255;                              // 떨어진 점
    const k = keepMain(m, w, h);
    assert.equal(k[50 * w + 50], 255);
    assert.equal(k[5 * w + 5], 0);
    assert.equal(k[0], 0);
  });
  test('붓으로 남기기·지우기, 안쪽으로 줄이기·부드럽게, 상자·덮은 비율, 크기 맞추기', () => {
    const w = 50, h = 40, m = new Uint8ClampedArray(w * h);
    brush(m, w, h, 25, 20, 6, true);
    assert.equal(m[20 * w + 25], 255);
    stroke(m, w, h, { x: 5, y: 5 }, { x: 45, y: 5 }, 3, true);
    assert.equal(m[5 * w + 30], 255);
    brush(m, w, h, 25, 20, 3, false);
    assert.equal(m[20 * w + 25], 0);
    const bb = maskBBox(m, w, h);
    assert.ok(bb && bb.x <= 3 && bb.w >= 44);
    assert.ok(maskCoverage(m) > 0 && maskCoverage(m) < 1);
    const sq = new Uint8ClampedArray(w * h); for (let y = 10; y < 30; y++) for (let x = 10; x < 40; x++) sq[y * w + x] = 255;
    assert.equal(maskBBox(erodeMask(sq, w, h, 2), w, h).x, 12);
    const f = featherMask(sq, w, h, 2);
    assert.ok(f[20 * w + 10] > 0 && f[20 * w + 10] < 255 && f[20 * w + 25] === 255);
    assert.deepEqual(edgeMask(sq, w, h, { feather: 0, shrink: 0 }), sq);
    const big = maskAt(sq, w, h, w * 2, h * 2);
    assert.equal(big.length, w * h * 4);
    assert.equal(big[40 * w * 2 + 50], 255);
  });
  test('원래 투명한 사진은 그 투명도를 마스크로', () => {
    const p = photo(20, 10);
    assert.equal(hasTransparency(p.data), false);
    p.data[3] = 0;
    assert.equal(hasTransparency(p.data), true);
    assert.equal(alphaMask(p.data, 20, 10)[0], 0);
    const rgba = maskRGBA(new Uint8ClampedArray([0, 128, 255]), 3, 1);
    assert.deepEqual(Array.from(rgba), [255, 255, 255, 0, 255, 255, 255, 128, 255, 255, 255, 255]);
  });
  test('모델 입력·출력 모양: 1×3×320×320, 확률 지도는 0~1로 펴서 사진 크기로, 가장자리 맞춤 뒤 마스크', () => {
    const p = photo(200, 150);
    const inp = segInput(p.data, p.w, p.h);
    assert.equal(inp.length, 3 * SEG_SIZE * SEG_SIZE);
    const prob = new Float32Array(SEG_SIZE * SEG_SIZE);
    for (let y = 0; y < SEG_SIZE; y++) for (let x = 0; x < SEG_SIZE; x++) prob[y * SEG_SIZE + x] = x > 96 && x < 224 && y > 80 && y < 272 ? 5 : -5;
    const map = probToMap(prob, SEG_SIZE, p.w, p.h);
    assert.equal(map.length, p.w * p.h);
    assert.ok(Math.max(...map) <= 1 && Math.min(...map) >= 0);
    const g = guidedFilter(new Float32Array(p.w * p.h).fill(0.5), map, p.w, p.h, 3);
    assert.equal(g.length, map.length);
    const m = mapToMask(map, p.data, p.w, p.h);
    assert.equal(m[75 * p.w + 100], 255);
    assert.equal(m[5 * p.w + 5], 0);
  });
});

describe('원본 보존 합성 (지시서 9번 1·2·4·8)', () => {
  const prod = photo(400, 300);
  const mask = { data: rectMask(prod), w: 400, h: 300 };
  const orig = Uint8ClampedArray.from(prod.data);
  const origMask = Uint8ClampedArray.from(mask.data);
  // 원본 크기 그대로(one)·회전 0 → 상품 칸은 원본 픽셀 그대로
  const exactLayer = { x: 0.5, y: 0.9, h: 0.5, rot: 0, one: true, tone: { b: 0, w: 0 }, ...NOSHADOW };

  test('1: 합성해도 원본 상품 사진(픽셀·마스크)은 바뀌지 않음', () => {
    composite({ bg: gradient(640, 480), prod, mask, layer: { ...exactLayer, rot: 12, one: false, shadow: { o: 0.6, s: 0.7, dx: 0.5 }, tone: { b: 0.2, w: 0.2 } }, W: 640, H: 480 });
    assert.deepEqual(prod.data, orig);
    assert.deepEqual(mask.data, origMask);
  });
  test('2: 배경만 바꿔도 상품 칸은 그대로 — 원본 크기면 원본 픽셀과 한 칸도 안 다름', () => {
    const a = composite({ bg: gradient(640, 480), prod, mask, layer: exactLayer, W: 640, H: 480 });
    const b = composite({ bg: solid(1024, 768, [30, 90, 60]), prod, mask, layer: exactLayer, W: 640, H: 480 });
    assert.equal(a.box.exact, true);
    assert.deepEqual([a.box.left, a.box.top, b.box.left, b.box.top], [b.box.left, b.box.top, a.box.left, a.box.top]);
    const { x0, y0, x1, y1 } = prod.rect, bb = a.box.bbox;
    let same = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const ox = a.box.left + (x - bb.x), oy = a.box.top + (y - bb.y);
      n++;
      const want = px(orig, 400, x, y);
      if (JSON.stringify(px(a.data, 640, ox, oy)) === JSON.stringify(want) && JSON.stringify(px(b.data, 640, ox, oy)) === JSON.stringify(want)) same++;
    }
    assert.equal(same, n, `상품 칸 ${n}개 중 ${same}개가 원본과 같음`);
  });
  test('3: 마스크 밖은 배경 그대로, 마스크 안은 상품 (그림자를 끄면)', () => {
    const bg = solid(640, 480, [30, 90, 60]);
    const r = composite({ bg, prod, mask, layer: exactLayer, W: 640, H: 480 });
    assert.deepEqual(px(r.data, 640, 5, 5), [30, 90, 60]);
    assert.deepEqual(px(r.data, 640, r.box.left - 1, r.box.top + 10), [30, 90, 60], '상품 옆은 배경');
    assert.deepEqual(px(r.data, 640, r.box.left + 5, r.box.top + 5), px(orig, 400, prod.rect.x0 + 5, prod.rect.y0 + 5));
    assert.equal(r.data[3], 255, '결과는 불투명');
  });
  test('4: 여러 비율에서 크기·자르기·그림자가 맞음 (그림자는 상품 아래만 어둡게)', () => {
    const bg = solid(1024, 1024, [200, 200, 200]);
    for (const ratio of Object.keys(RATIOS)) {
      const { W, H } = outputSize(ratio, 1024, 1024, 1080);
      const L = { x: 0.5, y: 0.85, h: 0.45, rot: 0, shadow: { o: 0.6, s: 0.5, dx: 0 }, mask: { feather: 1, shrink: 0 }, ratio };
      const r = composite({ bg, prod, mask, layer: L, W, H });
      assert.equal(r.data.length, W * H * 4, ratio);
      assert.ok(!r.warnings.includes('clipped') && !r.warnings.includes('empty_mask'), ratio + ' ' + r.warnings.join(','));
      const bottom = Math.round(r.box.top + r.box.h);
      const cx = Math.round(r.box.left + r.box.w / 2);
      const under = px(r.data, W, cx, Math.min(H - 1, bottom + 1))[0];
      assert.ok(under < 190, `${ratio}: 상품 바로 아래가 어두워짐 (${under})`);
      assert.deepEqual(px(r.data, W, 2, 2), [200, 200, 200], `${ratio}: 먼 곳은 그대로`);
      assert.ok(Math.abs(r.box.h / H - 0.45) < 0.01, `${ratio}: 높이 비율`);
    }
  });
  test('그림자 방향: 빛이 왼쪽(dx -1)이면 그림자가 오른쪽으로 더 길게', () => {
    const bg = solid(800, 600, [210, 210, 210]);
    const L = (dx) => ({ x: 0.5, y: 0.8, h: 0.5, shadow: { o: 0.8, s: 1, dx }, mask: { feather: 0, shrink: 0 } });
    const dark = (r, x0, x1, y) => { let s = 0; for (let x = x0; x < x1; x++) s += 210 - px(r.data, 800, x, y)[0]; return s; };
    const r = composite({ bg, prod, mask, layer: L(-1), W: 800, H: 600 });
    const yb = Math.round(r.box.top + r.box.h) - 2;
    const right = dark(r, Math.round(r.box.left + r.box.w), 800, yb - 10), left = dark(r, 0, Math.round(r.box.left), yb - 10);
    assert.ok(right > left, `오른쪽 ${right} > 왼쪽 ${left}`);
  });
  test('크게 늘리면·밖으로 나가면 알림, 회전·밝기 조절도 됨', () => {
    const bg = solid(640, 480, [128, 128, 128]);
    assert.ok(composite({ bg, prod, mask, layer: { x: 0.5, y: 0.95, h: 1.1 }, W: 640, H: 480 }).warnings.includes('upscaled'));
    assert.ok(composite({ bg, prod, mask, layer: { x: 0.02, y: 0.9, h: 0.5 }, W: 640, H: 480 }).warnings.includes('clipped'));
    const t = composite({ bg, prod, mask, layer: { ...exactLayer, tone: { b: 0.3, w: 0 } }, W: 640, H: 480 });
    const o = px(orig, 400, prod.rect.x0 + 3, prod.rect.y0 + 3), v = px(t.data, 640, t.box.left + 3, t.box.top + 3);
    assert.ok(v[0] > o[0], '상품 밝기를 올리면 그 칸만 바뀜 (원본 사진은 그대로)');
    const rot = composite({ bg, prod, mask, layer: { ...exactLayer, rot: 20, one: false }, W: 640, H: 480 });
    assert.equal(rot.box.exact, false);
  });
  test('8: 마스크가 비면 배경만 돌려주고 알림 (원본은 그대로)', () => {
    const r = composite({ bg: solid(320, 240, [1, 2, 3]), prod, mask: { data: new Uint8ClampedArray(400 * 300), w: 400, h: 300 }, layer: exactLayer, W: 320, H: 240 });
    assert.deepEqual(r.warnings, ['empty_mask']);
    assert.deepEqual(px(r.data, 320, 100, 100), [1, 2, 3]);
    assert.deepEqual(prod.data, orig);
  });
  test('작은 마스크(같은 비율)도 사진 크기로 늘려서 씀, 가장자리 색 정리는 반투명 칸만', () => {
    const small = { data: maskAt(mask.data, 400, 300, 200, 150), w: 200, h: 150 };
    const r = composite({ bg: solid(640, 480, [30, 90, 60]), prod, mask: small, layer: exactLayer, W: 640, H: 480 });
    const bb = r.box.bbox;
    assert.deepEqual(px(r.data, 640, r.box.left + (prod.rect.x0 + 20 - bb.x), r.box.top + (prod.rect.y0 + 20 - bb.y)), px(orig, 400, prod.rect.x0 + 20, prod.rect.y0 + 20));
    const a = new Uint8ClampedArray(400 * 300); a.set(mask.data);
    const fe = featherMask(a, 400, 300, 2);
    const dc = decontaminate(prod.data, fe, 400, 300);
    const inner = (prod.rect.y0 + 20) * 400 + prod.rect.x0 + 20;
    assert.deepEqual(Array.from(dc.slice(inner * 4, inner * 4 + 4)), Array.from(orig.slice(inner * 4, inner * 4 + 4)), '불투명한 안쪽은 그대로');
  });
  test('줄여서 얹을 때 작은 글자·줄무늬가 깨지지 않게 면적 평균으로 먼저 줄임 (1.5.1 검토 — 2×2 칸만 보던 때는 43·213처럼 튐)', () => {
    // 1px 줄무늬(작은 글자처럼)인 상품: 줄이면 회색(약 128) 근처여야 함
    const W0 = 600, H0 = 600, d = new Uint8ClampedArray(W0 * H0 * 4), m = new Uint8ClampedArray(W0 * H0);
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
      const inP = x >= 50 && x < 550 && y >= 50 && y < 550, v = inP && x % 2 ? 0 : 255, i = (y * W0 + x) * 4;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255; if (inP) m[y * W0 + x] = 255;
    }
    const bg = solid(800, 600, [128, 128, 128]);
    for (const [h, lo, hi] of [[0.25, 95, 160], [0.105, 118, 138]]) {
      const r = composite({ bg, prod: { data: d, w: W0, h: H0 }, mask: { data: m, w: W0, h: H0 }, layer: { x: 0.5, y: 0.9, h, rot: 0, ...NOSHADOW }, W: 800, H: 600 });
      assert.ok(r.scale < 0.5, String(r.scale));
      const y = Math.round(r.box.top + r.box.h / 2), vals = [];
      for (let x = Math.ceil(r.box.left) + 2; x < Math.floor(r.box.left + r.box.w) - 2; x++) vals.push(r.data[(y * 800 + x) * 4]);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      assert.ok(Math.min(...vals) >= lo && Math.max(...vals) <= hi, `h=${h}: ${Math.min(...vals)}~${Math.max(...vals)}`);
      assert.ok(Math.abs(mean - 127.5) < 3, `h=${h} 평균 ${mean}`);
    }
    // 가장자리: 투명도로 곱해서 줄이니까 원래 배경(흰색)이 상품 테두리에 번지지 않음 — 검은 상품 + 흰 배경 사진
    const k = new Uint8ClampedArray(W0 * H0 * 4);
    for (let i = 0; i < W0 * H0; i++) { const inP = m[i] === 255; k[i * 4] = inP ? 0 : 255; k[i * 4 + 1] = inP ? 0 : 255; k[i * 4 + 2] = inP ? 0 : 255; k[i * 4 + 3] = 255; }
    const r2 = composite({ bg: solid(800, 600, [0, 0, 0]), prod: { data: k, w: W0, h: H0 }, mask: { data: m, w: W0, h: H0 }, layer: { x: 0.5, y: 0.9, h: 0.25, rot: 0, ...NOSHADOW }, W: 800, H: 600 });
    let maxv = 0;
    for (let i = 0; i < 800 * 600; i++) maxv = Math.max(maxv, r2.data[i * 4]);
    assert.ok(maxv <= 2, `검은 상품을 검은 배경에 얹었는데 흰 테두리가 남음: ${maxv}`);
  });
  test('줄이거나 늘려 얹어도 가장자리에 어두운 테두리가 없음 — 흰 상품·흰 사진 배경 → 흰 AI 배경 (1.5.1 재검토: 줄일 때 214 같은 회색 테두리)', () => {
    // 둥근 상품(가장자리 1px 반투명), 사진의 배경도 흰색 → 결과는 어디나 흰색(255)이어야 함
    const W0 = 800, d = new Uint8ClampedArray(W0 * W0 * 4).fill(255), m = new Uint8ClampedArray(W0 * W0), R = W0 * 0.4, C = W0 / 2;
    for (let y = 0; y < W0; y++) for (let x = 0; x < W0; x++) m[y * W0 + x] = Math.round(255 * Math.max(0, Math.min(1, R - Math.hypot(x + 0.5 - C, y + 0.5 - C) + 0.5)));
    const bg = solid(1024, 768, [255, 255, 255]);
    for (const feather of [1, 0]) for (const h of [0.2, 0.3, 0.45, 0.6, 1.1]) for (const x of [0.5, 0.507, 0.513]) {
      const r = composite({ bg, prod: { data: d, w: W0, h: W0 }, mask: { data: m, w: W0, h: W0 }, layer: { x, y: 0.877, h, rot: h === 0.45 ? 7 : 0, ...NOSHADOW, mask: { feather, shrink: 0 } }, W: 800, H: 600 });
      let minv = 255;
      for (let p = 0; p < 800 * 600; p++) minv = Math.min(minv, r.data[p * 4], r.data[p * 4 + 1], r.data[p * 4 + 2]);
      assert.ok(minv >= 254, `feather ${feather} h ${h} x ${x} (배율 ${r.scale.toFixed(2)}): 가장 어두운 칸 ${minv}`);
    }
  });
  test('레이어 설정은 images.js cleanLayer 로 정리 (원본 크기 그대로 표시 포함)', () => {
    assert.equal(cleanLayer({ one: true }).one, true);
    assert.equal(cleanLayer({ one: 'yes' }).one, false);
  });
});
