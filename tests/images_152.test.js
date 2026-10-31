// 1.5.2 이미지 규칙 (images.js — 앱과 서버가 같은 파일): 빛·색·밝기·모양 → 빈 배경 프롬프트 · 장면 정보 기록 · 검수 칸 도움말 ·
// 후기 오해 가능성 · 공급자 비교 평가 칸 · 원고 사진 자리 정보 · 같은 이미지 반복 · 상품이 그려진 자리
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as I from '../images.js';

describe('지시서 3-2: 빈 배경을 상품 사진의 시점·표면·빛·색에 맞춰 (상품은 그리지 않음)', () => {
  const sc = (o) => I.buildProductScene({ spec: { mode: 'layer', template: 'table', ...o }, ratio: '4:3', size: '1024x768' });
  test('빛 방향·그림자 방향·밝기·색온도·모양·표면 높이·원근이 프롬프트에', () => {
    const p = I.promptFromProductScene(sc({ light: 'left', warmth: 'warm', bright: 'bright', shape: 'tall', angle: 'high' }));
    assert.match(p, /main light comes from the left side/);
    assert.match(p, /shadows fall toward the right/);
    assert.match(p, /bright, airy overall exposure; a slightly warm white balance/);
    assert.match(p, /a tall, narrow object about 50% of the image height/);
    assert.match(p, /Surface and perspective: The resting surface fills roughly the lower two-thirds/);
    for (const r of I.LAYER_BG_RULES) assert.ok(p.includes(r), '원본 보존 합성 규칙은 그대로: ' + r);
  });
  test('지정 안 하면 예전처럼 (빛은 한쪽에서 부드럽게), 위에서 찍은 사진은 수평선 없는 평면', () => {
    const p = I.promptFromProductScene(sc({}));
    assert.match(p, /soft and consistent, coming from one side/);
    assert.ok(!/Brightness and color:/.test(p));
    assert.match(I.promptFromProductScene(sc({ angle: 'top' })), /Flat lay: the surface fills the whole frame/);
  });
  test('AI 실사 장면도 고른 빛·색을 따름, 모르는 값은 버림', () => {
    const p = I.promptFromProductScene(I.buildProductScene({ spec: { mode: 'reference', template: 'window', light: 'right', warmth: 'cool' }, ratio: '1:1', refs: [{ image_id: 'x', role: 'subject' }] }));
    assert.match(p, /main light comes from the right side of the frame; soft shadows fall toward the left/);
    assert.match(p, /slightly cool white balance/);
    assert.deepEqual(['light', 'warmth', 'bright', 'shape'].map((k) => I.cleanProductSpec({ [k]: 'nope' })[k]), ['', '', '', '']);
    assert.deepEqual(Object.keys(I.PRODUCT_LIGHTS), ['', 'left', 'right', 'front']);
  });
});

describe('장면 정보 기록 (scene.fit) — 이 기기에서 추정한 값이라고 남기고 모르는 칸은 버림', () => {
  test('정리', () => {
    const f = I.cleanFit({ product: { light: { dir: 'left', confidence: 'medium', why: '…' }, view: { value: 'top' }, temp: { value: 'x' }, aspect: 99, bright: { product: 3 } },
      background: { contrast: 'hard', spot: { x: 2, y: 0.8, confidence: 'nope' } }, applied: 'yes', match: { light: 'same' }, token: 'secret' });
    assert.equal(f.source, 'device_estimate');
    assert.deepEqual(f.product.light, { value: 'left', confidence: 'medium' });
    assert.deepEqual([f.product.view.confidence, f.product.temp, f.product.aspect, f.product.bright], ['low', null, 10, 1]);
    assert.deepEqual(f.background.spot, { x: 1, y: 0.8, confidence: 'low' });
    assert.deepEqual([f.applied, f.match.light], [false, 'same']);
    assert.ok(!JSON.stringify(f).includes('secret'));
    assert.deepEqual(I.cleanFit(null).match, { light: 'unknown' });
  });
  test('상품이 그려진 자리(layer.box)는 있을 때만 남김 — 없으면 예전 레이어 모양 그대로', () => {
    assert.deepEqual(I.cleanLayer({ box: { l: 0.3, t: -5, w: 0.4, h: 9 } }).box, { l: 0.3, t: -2, w: 0.4, h: 3 });
    assert.equal('box' in I.cleanLayer({}), false);
    assert.equal('box' in I.cleanLayer({ box: { l: 'x' } }), false);
  });
});

describe('지시서 8: 검수 기준은 방식마다 다름 · 후기 오해 가능성 · 비교 평가 칸', () => {
  test('아홉 칸 모두 두 방식의 도움말이 있음', () => {
    for (const mode of ['layer', 'reference']) for (const [k] of I.PRODUCT_CHECKS) assert.ok(I.PRODUCT_CHECK_HINTS[mode][k], `${mode}.${k}`);
    assert.match(I.PRODUCT_CHECK_HINTS.layer.placement, /떠 보이지|접촉 그림자/);
    assert.match(I.PRODUCT_CHECK_HINTS.layer.consistency, /실제로 그 장소에서 찍은 사진처럼 쓰지 마/);
    assert.match(I.PRODUCT_CHECK_HINTS.reference.text, /한 글자씩/);
  });
  test('후기 오해 가능성: 후기 글·써본 경험을 말하는 자리·사용 장면이면 표시, AI 실사 장면은 더 높게', () => {
    const layer = { kind: 'composite', composite_mode: 'layer', scene: { template: 'table' } };
    const ref = { kind: 'ai', composite_mode: 'reference', scene: { template: 'in_use' } };
    assert.equal(I.reviewRiskOf({ img: layer }).level, 'low');
    assert.equal(I.reviewRiskOf({ img: layer, slotText: '한 달 써보니 좋았던 점' }).level, 'medium');
    assert.equal(I.reviewRiskOf({ img: ref }).level, 'high');
    assert.equal(I.reviewRiskOf({ img: layer, post: { content_type: 'experience_review' }, slotText: '실사용 모습' }).level, 'high');
    assert.equal(I.reviewRiskOf({ img: { kind: 'ai', composite_mode: '' } }).level, 'none', '상품 장면이 아니면 대상 아님');
    assert.match(I.reviewRiskOf({ img: layer }).label, /배경·그림자는 AI와 앱이 만듦/);
  });
  test('공급자 비교 평가 칸 (지시서 9번 항목) — 서버가 받는 칸에 다 들어 있음', () => {
    assert.deepEqual(I.PRODUCT_EVAL_CRITERIA.map(([k]) => k), ['natural', 'preserve', 'composition', 'lighting', 'shadow', 'color', 'fit', 'ai_look', 'usable']);
    for (const [k] of [...I.EVAL_CRITERIA, ...I.PRODUCT_EVAL_CRITERIA]) assert.ok(I.ALL_EVAL_KEYS.includes(k), k);
    assert.equal(new Set(I.ALL_EVAL_KEYS).size, I.ALL_EVAL_KEYS.length);
  });
});

describe('지시서 10: 원고 사진 자리 정보 · 같은 이미지 반복 막기', () => {
  const body = ['## 고르는 법', '전기요는 크기부터 봐요.', '[이미지: 침대 위에 깔린 전기요]', '[이미지: 전기요를 접는 손 (직접 찍기)]', '[이미지: 온도 조절기 버튼 (제품 사진)]', '[이미지: 제품 박스 뒷면 라벨]'].join('\n');
  const slots = I.parseSlots(body);
  test('왜 필요한지·보여줄 것·AI로 대신할 수 있는지·직접 찍어야 하는지·추천 종류', () => {
    const [a, own, mark, real] = slots.map((s) => I.slotInfo(s));
    assert.deepEqual([a.ai, a.own, a.product], ['yes', false, false]);
    assert.match(a.why, /고르는 법/);
    assert.equal(a.explains, '침대 위에 깔린 전기요');
    assert.ok(a.preset && a.preset_label && a.preset_why);
    assert.deepEqual([own.ai, own.own], ['no', true], "'(직접 찍기)'는 직접 찍은 사진만");
    assert.deepEqual([mark.ai, mark.product, mark.explains], ['real', true, '온도 조절기 버튼'], "'(제품 사진)'은 실제 상품 사진 권장, 표시는 설명에서 뺌");
    assert.deepEqual([real.ai, real.product], ['real', true], '라벨·뒷면처럼 실제 모습이 보여야 하는 자리');
    const cover = I.slotInfo({ key: 'x:cover' });
    assert.deepEqual([cover.extra, cover.ai, cover.preset], [true, 'yes', 'editorial']);
  });
  test('같은 이미지가 본문 두 자리에 있으면 찾아냄 (대표·SNS 자리는 본문 사진을 그대로 써도 돼서 빼고)', () => {
    const d = I.duplicateSlots([{ slot_key: slots[0].key, image_id: 'A' }, { slot_key: slots[2].key, image_id: 'A' }, { slot_key: slots[1].key, image_id: 'B' }, { slot_key: 'x:cover', image_id: 'B' }]);
    assert.deepEqual(d, { A: [slots[0].key, slots[2].key] });
  });
  test('발행 전 검사에 반복 이미지 알림 (막지는 않음)', () => {
    const rows = [{ slot_key: slots[0].key, image: { id: 'A', kind: 'upload', review_status: '사용 가능', source_type: 'own' } }, { slot_key: slots[3].key, image: { id: 'A', kind: 'upload', review_status: '사용 가능', source_type: 'own' } }];
    const r = I.imageChecks({ body, content_type: 'buying_guide' }, rows);
    const w = r.warnings.find((x) => x.code === 'image_duplicate');
    assert.ok(w, JSON.stringify(r.warnings.map((x) => x.code)));
    assert.match(w.msg, /사진 1, 사진 4/);
  });
});

test('앱과 서버의 images.js 가 글자 하나까지 같음 (1.5.2)', () => {
  assert.equal(readFileSync(new URL('../images.js', import.meta.url), 'utf8'), readFileSync(new URL('../supabase/functions/blog-app/images.js', import.meta.url), 'utf8'));
});
