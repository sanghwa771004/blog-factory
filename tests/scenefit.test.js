// 1.5.2 빛·원근·그림자 자동 추천 (scenefit.js) — 만든 그림(정답을 아는 합성 그림)으로 규칙 확인
// 실제 사진에서 얼마나 맞는지는 이 시험으로 알 수 없어 (그래서 화면은 늘 '추정'·'확신 낮음'을 같이 보여주고, 사용자가 적용해야 바뀜)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProduct, analyzeBackground, recommendLayer, sceneHints, shapeOf } from '../scenefit.js';

// 상품 사진 흉내: 밝은 배경 위 세로로 긴 상품. light: 'left' 면 상품 왼쪽이 밝음, shadow: 'right' 면 상품 오른쪽 아래 바닥이 어두움
function productShot({ W = 240, H = 200, light = 'left', shadow = 'right', warm = 10, box = [100, 40, 140, 170] } = {}) {
  const d = new Uint8ClampedArray(W * H * 4), m = new Uint8ClampedArray(W * H);
  const [x0, y0, x1, y1] = box;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let v = 205;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) {
      m[y * W + x] = 255;
      const t = (x - x0) / (x1 - x0);
      v = light === 'left' ? 235 - t * 90 : light === 'right' ? 145 + t * 90 : 190;
    } else if (shadow && y >= y1 - 6 && y < y1 + 10 && (shadow === 'right' ? x >= x1 - 10 && x < x1 + 45 : x >= x0 - 45 && x < x0 + 10)) v = 140;
    d[i] = v + warm; d[i + 1] = v; d[i + 2] = v - warm; d[i + 3] = 255;
  }
  return { src: { data: d, w: W, h: H }, mask: { data: m, w: W, h: H } };
}
// 배경 흉내: 왼쪽이 밝고(빛이 왼쪽에서), 위쪽엔 무늬(물건), 아래 가운데는 비어 있는 바닥
function background({ W = 320, H = 240, light = 'left', clutter = true } = {}) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let v = light === 'left' ? 225 - x * 0.3 : light === 'right' ? 130 + x * 0.3 : 180;
    if (clutter && (y < H * 0.55 || x < W * 0.2 || x > W * 0.8) && (x * 7 + y * 13) % 17 < 6) v -= 70; // 무늬가 있는 곳
    d[i] = v; d[i + 1] = v - 3; d[i + 2] = v - 10; d[i + 3] = 255;
  }
  return { data: d, w: W, h: H };
}

describe('상품 사진 분석 (추정)', () => {
  test('상자·비율·모양, 왼쪽이 밝고 오른쪽 아래에 그림자 → 빛은 왼쪽에서 (서로 맞아서 확신 보통), 따뜻한 배경', () => {
    const { src, mask } = productShot();
    const a = analyzeProduct(src, mask);
    assert.ok(Math.abs(a.bbox.x - 100 / 240) < 0.02 && Math.abs(a.bbox.w - 40 / 240) < 0.02, JSON.stringify(a.bbox));
    assert.ok(a.aspect > 2.8 && a.aspect < 3.6, String(a.aspect));
    assert.equal(a.shape, 'tall');
    assert.deepEqual([a.light.dir, a.light.confidence, a.light.source], ['left', 'medium', 'estimate']);
    assert.equal(a.shadow.side, 'right');
    assert.equal(a.temp.value, 'warm');
    assert.equal(a.view.confidence, 'low', '카메라 시점은 늘 확신 낮음');
  });
  test('밝기 차이와 그림자가 서로 다르면 빛 방향을 모른다고 함 (단정하지 않음)', () => {
    const { src, mask } = productShot({ light: 'left', shadow: 'left' });
    const a = analyzeProduct(src, mask);
    assert.deepEqual([a.light.dir, a.light.confidence], ['', 'low']);
  });
  test('마스크가 비면 분석하지 않음', () => {
    const { src } = productShot();
    assert.equal(analyzeProduct(src, { data: new Uint8ClampedArray(240 * 200), w: 240, h: 200 }), null);
  });
  test('5번 장면 칸의 추정 기본값', () => {
    const { src, mask } = productShot();
    const hnt = sceneHints(analyzeProduct(src, mask));
    assert.deepEqual([hnt.light, hnt.warmth, hnt.shape], ['left', 'warm', 'tall']);
    assert.deepEqual(sceneHints(null), { light: '', warmth: '', bright: '', view: '', shape: '' });
    assert.deepEqual([shapeOf(2), shapeOf(1), shapeOf(0.5), shapeOf(NaN)], ['tall', 'square', 'wide', '']);
  });
});

describe('배경 분석 (추정)', () => {
  test('왼쪽이 밝은 배경 → 빛은 왼쪽, 무늬 없는 아래 가운데를 빈 자리로', () => {
    const b = analyzeBackground(background(), { place: 'center', angle: 'front', h: 0.4, aspect: 1, W: 1600, H: 1200 });
    assert.equal(b.light.dir, 'left');
    assert.ok(b.spot.y >= 0.7 && Math.abs(b.spot.x - 0.5) <= 0.2, JSON.stringify(b.spot));
    assert.ok(['soft', 'medium', 'hard'].includes(b.contrast));
  });
  test('무늬가 없으면(어디나 비슷) 빈 자리를 확실히 못 찾았다고 함', () => {
    const b = analyzeBackground(background({ clutter: false, light: 'none' }), { place: 'left', h: 0.4 });
    assert.equal(b.spot.confidence, 'low');
  });
});

describe('추천값 (적용은 사용자가 — 여기서는 값만)', () => {
  const prodLeft = analyzeProduct(productShot().src, productShot().mask);
  const bgLeft = analyzeBackground(background(), { place: 'center', angle: 'front', h: 0.5, aspect: prodLeft.aspect, W: 1600, H: 1200 });
  test('그림자는 배경 빛의 반대쪽으로 (빛 왼쪽 → dx 음수 = 그림자 오른쪽), 바뀐 칸마다 이유', () => {
    const r = recommendLayer({ prod: prodLeft, bg: bgLeft, spec: { purpose: 'blog_body', angle: 'front' }, layer: {}, W: 1600, H: 1200 });
    assert.ok(r.layer.shadow.dx < 0, String(r.layer.shadow.dx));
    const c = r.changes.find((x) => x.key === 'shadow.dx');
    assert.ok(c && /왼쪽/.test(c.why), JSON.stringify(r.changes));
    assert.equal(r.match.light, 'same');
  });
  test('밝기·색은 기본으로 배경 쪽을 맞춤 (상품 픽셀 그대로) — 상품 쪽은 고를 때만, 그때는 검수 안내', () => {
    const darkBg = { ...bgLeft, bright: 0.3 };
    const r = recommendLayer({ prod: prodLeft, bg: darkBg, spec: {}, layer: {}, W: 1600, H: 1200 });
    assert.ok(r.layer.bg.b > 0 && r.layer.tone.b === 0, JSON.stringify(r.layer));
    const r2 = recommendLayer({ prod: prodLeft, bg: darkBg, spec: {}, layer: {}, W: 1600, H: 1200, productTone: true });
    assert.ok(r2.layer.tone.b < 0 && r2.layer.bg.b === 0, JSON.stringify(r2.layer));
    assert.ok(r2.notes.some((n) => /색 칸을 직접 확인/.test(n)));
  });
  test('빛 방향이 서로 반대면 알려줌 (상품의 빛은 바꿀 수 없어서 배경을 다시 만들라고)', () => {
    const bgRight = analyzeBackground(background({ light: 'right' }), { h: 0.5 });
    const r = recommendLayer({ prod: prodLeft, bg: bgRight, spec: {}, layer: {}, W: 1600, H: 1200 });
    assert.equal(r.match.light, 'opposite');
    assert.ok(r.notes.some((n) => /빛이 오는 쪽/.test(n)));
  });
  test('옆으로 넓은 상품은 폭이 그림의 80%를 넘지 않게, 원래 사진보다 크게 늘리지 않게 크기를 줄여 추천', () => {
    const wide = { ...prodLeft, aspect: 0.3 };
    const r = recommendLayer({ prod: wide, bg: bgLeft, spec: { purpose: 'product_detail' }, layer: {}, W: 1600, H: 1200 });
    assert.ok((r.layer.h / 0.3) / (1600 / 1200) <= 0.81, String(r.layer.h));
    const small = recommendLayer({ prod: prodLeft, bg: bgLeft, spec: { purpose: 'product_detail' }, layer: {}, W: 1600, H: 1200, prodPx: { w: 100, h: 300 } });
    assert.ok(small.layer.h * 1200 <= 300 * 1.05 + 1, String(small.layer.h));
    assert.ok(small.notes.some((n) => /흐려져/.test(n)));
  });
  test("'원본 크기 그대로'면 크기는 바꾸지 않음, 확신이 낮은 빈 자리로는 옮기지 않음", () => {
    const flat = analyzeBackground(background({ clutter: false, light: 'none' }), { h: 0.5 });
    const r = recommendLayer({ prod: prodLeft, bg: flat, spec: {}, layer: { one: true, h: 0.33, x: 0.3, y: 0.8 }, W: 1600, H: 1200 });
    assert.deepEqual([r.layer.h, r.layer.x, r.layer.y], [0.33, 0.3, 0.8]);
  });
});
