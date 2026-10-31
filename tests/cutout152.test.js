// 1.5.2 배경 지우기 도구: 마스크 품질 점수(추정) · 가장자리 다듬기 · 넓히기·좁히기 · 2단계(정밀하게) · 기기 확인·간단 모드
// 모델(U²-Netp) 자체는 여기서 돌리지 않아 (2단계는 가짜 모델 함수로 흐름만 확인 — 실제 모델은 화면 시험에서 브라우저로 돌림)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { maskQuality, MASK_QUALITY_MSG, MASK_LEVEL, refineEdges, growMask, twoPassMap, REFINE, simpleMask, capabilities, deviceTier, SIZES, TIER_MSG, SEG_SIZE, maskCoverage } from '../cutout.js';

const W = 120, H = 90;
const rect = (x0, y0, x1, y1, w = W, h = H) => { const m = new Uint8ClampedArray(w * h); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 255; return m; };
// 사진 흉내: 마스크 자리만 어둡고(뚜렷한 윤곽) 나머지는 밝은 바탕
const photoOf = (m, w = W, h = H, fg = 60, bg = 220) => { const d = new Uint8ClampedArray(w * h * 4); for (let p = 0; p < w * h; p++) { const v = m[p] >= 128 ? fg : bg; d[p * 4] = v; d[p * 4 + 1] = v; d[p * 4 + 2] = v; d[p * 4 + 3] = 255; } return d; };

describe('마스크 품질 점수 (정답을 모르는 추정 — 화면도 그렇게 알림)', () => {
  test('사진 윤곽과 맞는 한 덩어리 → 좋음', () => {
    const m = rect(30, 20, 90, 75);
    const q = maskQuality(m, W, H, photoOf(m));
    assert.equal(q.level, 'good', JSON.stringify(q));
    assert.ok(q.score >= 75 && q.issues.length === 0);
    assert.ok(q.edge >= 0.95, '경계가 사진의 실제 윤곽과 맞음 (경계 칸 대부분이 윤곽 위)');
  });
  test('비었음·다 남음은 고쳐야 함', () => {
    assert.deepEqual(maskQuality(new Uint8ClampedArray(W * H), W, H).issues, ['empty']);
    const full = new Uint8ClampedArray(W * H).fill(255);
    assert.equal(maskQuality(full, W, H).level, 'fix');
    assert.ok(maskQuality(full, W, H).issues.includes('full'));
  });
  test('떨어진 조각·가장자리에 닿음·안쪽 구멍을 알려줌', () => {
    const m = rect(30, 20, 90, 75);
    for (let y = 2; y < 12; y++) for (let x = 2; x < 14; x++) m[y * W + x] = 255; // 떨어진 조각 (위 왼쪽 — 사진 끝에는 안 닿음)
    for (let y = 40; y < 52; y++) for (let x = 50; x < 66; x++) m[y * W + x] = 0;  // 안쪽 구멍
    const q = maskQuality(m, W, H);
    assert.ok(q.issues.includes('parts') && q.issues.includes('holes'), JSON.stringify(q.issues));
    assert.equal(q.parts, 2);
    const cut = maskQuality(rect(0, 20, 60, 75), W, H);
    assert.ok(cut.issues.includes('cut'), '왼쪽 끝에 닿음');
    const bottom = maskQuality(rect(30, 20, 90, H), W, H);
    assert.ok(bottom.issues.includes('cut_bottom') && !bottom.issues.includes('cut'), '아래 끝은 따로 (바닥까지 찍힌 사진이면 괜찮아)');
    for (const k of q.issues) assert.ok(MASK_QUALITY_MSG[k], k);
    assert.deepEqual(Object.keys(MASK_LEVEL), ['good', 'check', 'fix']);
  });
  test('경계가 사진 윤곽과 안 맞으면(배경과 비슷한 색) 확인 필요', () => {
    const m = rect(30, 20, 90, 75);
    const shifted = rect(10, 20, 70, 75); // 사진 속 물건은 30~90 인데 마스크는 10~70
    const q = maskQuality(shifted, W, H, photoOf(m));
    assert.ok(q.issues.includes('weak_edge') && q.level !== 'good', JSON.stringify(q));
  });
  test('가장자리가 넓게 흐릿하면 알려줌 (털·투명한 부분일 수 있어)', () => {
    const m = new Uint8ClampedArray(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(x - 60, y - 45); m[y * W + x] = Math.max(0, Math.min(255, Math.round(255 * (1 - (d - 15) / 22)))); }
    assert.ok(maskQuality(m, W, H).issues.includes('soft'));
  });
});

describe('편집 도구', () => {
  test('넓히기·좁히기 1칸', () => {
    const m = rect(40, 30, 80, 60);
    assert.ok(maskCoverage(growMask(m, W, H, 1)) > maskCoverage(m));
    assert.ok(maskCoverage(growMask(m, W, H, -1)) < maskCoverage(m));
    assert.deepEqual(growMask(m, W, H, 0), m);
  });
  test('가장자리 다듬기: 경계 근처 띠만 사진 윤곽 쪽으로 — 확실한 안쪽·바깥(손으로 칠한 곳)은 그대로', () => {
    const truth = rect(30, 20, 90, 75);
    const rough = rect(27, 20, 93, 75); // 3칸 넓게 칠함
    const out = refineEdges(rough, photoOf(truth), W, H, { radius: 3 });
    assert.equal(out[45 * W + 60], 255, '안쪽 그대로');
    assert.equal(out[5 * W + 5], 0, '먼 바깥 그대로');
    const err = (a) => { let e = 0; for (let i = 0; i < W * H; i++) e += Math.abs(a[i] - truth[i]); return e; };
    assert.ok(err(out) < err(rough), `${err(out)} < ${err(rough)}`);
  });
});

describe('2단계 (정밀하게): 1단계 상자만 잘라서 한 번 더 — 가짜 모델로 흐름 확인 (실제 모델 점수는 docs/REPORT-1.5.2.md 5번)', () => {
  // 가짜 모델: 입력 그림을 320×320 으로 줄여 어두운 곳을 1로 (실제 모델 대신)
  const fakeModel = (calls) => async (rgba, w, h) => {
    calls.push([w, h]);
    const out = new Float32Array(SEG_SIZE * SEG_SIZE);
    for (let y = 0; y < SEG_SIZE; y++) for (let x = 0; x < SEG_SIZE; x++) { const sx = Math.floor((x * w) / SEG_SIZE), sy = Math.floor((y * h) / SEG_SIZE); out[y * SEG_SIZE + x] = rgba[(sy * w + sx) * 4] < 128 ? 1 : 0; }
    return out;
  };
  test('작은 상품이면 상자(+여백)를 잘라서 두 번째로 보고, 그 결과를 상자 안에만 넣음', async () => {
    const w = 400, h = 300, m = rect(180, 120, 230, 200, w, h);
    const calls = [];
    const r = await twoPassMap(photoOf(m, w, h), w, h, fakeModel(calls));
    assert.equal(r.refined, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], [w, h]);
    assert.ok(calls[1][0] < 100 && calls[1][1] < 120, '두 번째는 상품 근처만');
    assert.ok(r.crop.x <= 180 && r.crop.x + r.crop.w >= 230);
    assert.ok(r.map[160 * w + 200] > 0.9 && r.map[10 * w + 10] < 0.1);
  });
  test('상품이 사진을 거의 채우면 한 번만 (다시 봐도 나아지지 않음)', async () => {
    const w = 200, h = 150, m = rect(4, 4, 196, 146, w, h);
    const calls = [];
    const r = await twoPassMap(photoOf(m, w, h), w, h, fakeModel(calls));
    assert.deepEqual([r.refined, r.skip, calls.length], [false, 'fills', 1]);
  });
  test('두 번째 결과가 처음과 많이 다르면(다른 물건을 잡음) 1단계 그대로 — maskbench 에서 고른 안전장치', async () => {
    const w = 400, h = 300, m = rect(180, 120, 230, 200, w, h);
    const calls = [];
    const first = fakeModel(calls);
    // 두 번째는 잘린 칸의 왼쪽 위 구석만 '상품'이라고 함 (엉뚱한 물건)
    const model = async (rgba, ww, hh) => { if (!calls.length) return first(rgba, ww, hh); calls.push([ww, hh]); const o = new Float32Array(SEG_SIZE * SEG_SIZE); for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) o[y * SEG_SIZE + x] = 1; return o; };
    const r = await twoPassMap(photoOf(m, w, h), w, h, model);
    assert.deepEqual([r.refined, r.skip, calls.length], [false, 'disagree', 2]);
    assert.ok(r.agree < 0.9, String(r.agree));
    assert.ok(r.map[160 * w + 200] > 0.9, '1단계 결과 그대로');
  });
  test('작은 얼룩(가장 큰 덩어리의 4% 미만)은 상자를 넓히지 않음', async () => {
    const w = 400, h = 300, m = rect(180, 120, 230, 200, w, h);
    for (let y = 5; y < 9; y++) for (let x = 5; x < 9; x++) m[y * w + x] = 255; // 구석 얼룩
    const calls = [];
    const r = await twoPassMap(photoOf(m, w, h), w, h, fakeModel(calls));
    assert.equal(r.refined, true);
    assert.ok(r.crop.x > 100 && r.crop.y > 60, JSON.stringify(r.crop));
  });
  test('기본값은 maskbench 에서 고른 값', () => {
    assert.deepEqual({ ...REFINE }, { thr: 0.5, minFrac: 0.04, margin: 0.12, minSide: 64, skipAbove: 0.8, feather: 16, minAgree: 0.9 });
  });
});

describe("'간단히'(모델 없이): 부드러운 윤곽으로 번지지 않음 · 서서히 바뀌는 배경은 따라감", () => {
  // 밝은 배경(위 235 → 아래 195로 서서히) 위 어두운 상품, 윤곽은 6칸에 걸쳐 조금씩 바뀜 (예전 방식은 이 틈으로 상품 안까지 번졌어)
  const w = 200, h = 150, x0 = 60, y0 = 40, x1 = 140, y1 = 115;
  const d = new Uint8ClampedArray(w * h * 4), gt = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const bgv = 235 - (40 * y) / h;
    const dx = Math.max(x0 - x, x - (x1 - 1), 0), dy = Math.max(y0 - y, y - (y1 - 1), 0), dist = Math.max(dx, dy);
    const t = dist === 0 ? 1 : Math.max(0, 1 - dist / 6);
    const v = 70 * t + bgv * (1 - t);
    const i = (y * w + x) * 4; d[i] = v + 6; d[i + 1] = v; d[i + 2] = v - 6; d[i + 3] = 255;
    gt[y * w + x] = t >= 0.5 ? 1 : 0; // 윤곽 가운데(반쯤 바뀐 곳)까지가 상품
  }
  test('IoU 0.85 넘게 (예전 방식은 상품 안까지 번져서 거의 0)', () => {
    const m = simpleMask(d, w, h);
    let inter = 0, uni = 0;
    for (let i = 0; i < m.length; i++) { const a = m[i] >= 128, b = gt[i] === 1; if (a && b) inter++; if (a || b) uni++; }
    assert.ok(inter / uni > 0.85, `IoU ${inter / uni}`);
    assert.equal(m[5 * w + 5], 0, '배경(위)'); assert.equal(m[(h - 5) * w + 5], 0, '배경(아래 — 더 어두운 쪽도)');
  });
});

describe('기기 확인 · 간단 모드', () => {
  test('WebAssembly SIMD 가 없으면 모델 없이 (간단히·직접 칠하기만), 메모리가 적거나 전에 멈췄으면 작게', () => {
    const none = capabilities({ navigator: {} });
    assert.deepEqual([none.wasm, none.simd, none.worker], [false, false, false]);
    const t = deviceTier(none);
    assert.deepEqual([t.model, t.lite, t.reasons], [false, true, ['no_simd']]);
    const here = capabilities();
    assert.equal(here.simd, true, '이 Node(V8)는 SIMD 검사 모듈을 받아들임');
    assert.deepEqual(deviceTier({ ...here, memory: 2 }).reasons, ['low_memory']);
    assert.equal(deviceTier(here, { failed: true }).lite, true);
    assert.deepEqual(deviceTier(here, { failed: true }).sizes, SIZES.lite);
    assert.equal(deviceTier({ ...here, memory: 1 }, { force: 'normal' }).lite, false, '사용자가 보통으로 고르면 보통');
    assert.equal(deviceTier(here, { force: 'lite' }).lite, true);
    assert.equal(deviceTier({ ...here, cores: 2 }).lite, false, '코어 수만으로는 간단 모드로 안 바꿈');
    for (const r of ['no_simd', 'low_memory', 'failed']) assert.ok(TIER_MSG[r], r);
  });
  test('아이폰 Safari 는 기기 메모리를 안 알려줌 → 0(모름)이고, 아이폰으로 알아봄', () => {
    const c = capabilities({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }, WebAssembly });
    assert.deepEqual([c.memory, c.ios, c.simd], [0, true, true]);
    assert.equal(capabilities({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }, WebAssembly }).ios, true, 'iPad 데스크톱 모드');
  });
});
