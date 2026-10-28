// 1.5.1 상품 사진으로 장면 만들기 — 규칙·프롬프트·모드 기본값 (images.js — 앱과 서버가 같은 파일). 실행: npm test
// 여기 시험은 프롬프트 글·판단 규칙만 봄. 실제 이미지 품질은 실제 생성 API로만 알 수 있어서 이 시험으로 '품질 확인'이라고 하지 않음
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_MODES, resolveModes, modeOverrides, modelCaps, PRODUCT_MODES, PRODUCT_TEMPLATES, PRODUCT_PURPOSES, PRODUCT_PRESETS, PRODUCT_CHECKS, cleanProductSpec, buildProductScene,
  promptFromProductScene, productGate, productCheckState, preservedChecks, productSceneMode, productApproved, cleanLayer, defaultLayer, layerBox, LAYER_BG_RULES,
  productAttribution, compositeLicense, refDownscaleNote, productGateErrors, imageChecks, originLabel, captionHint, KIND_LABEL, PROMPT_RULES, isProductPreset, PRESETS, presetOf,
} from '../images.js';
import { reviewPrompt, productReviewPrompt, parseReview } from '../supabase/functions/blog-app/image_service.js';

const SPEC = { mode: 'layer', template: 'table', purpose: 'blog_body', angle: 'front', place: 'center', custom: '', name: '포근 전기요 PK-200' };
const post = { titles: ['포근 전기요 PK-200 솔직 비교'], keyword: '전기요' };
const slot = { heading: '포근 전기요 PK-200 고르는 법', text: '침대 위 전기요' };

describe('지시서 5번: 모델 기본값 — 고품질은 Sunburst(high), 빠른 모드는 Flare, 저장한 설정은 그대로', () => {
  test("hq_paid 기본은 gpt-image-2.5-sunburst · high, fast_paid 는 Flare 그대로 (지시서 9번 10)", () => {
    const hq = IMAGE_MODES.find((m) => m.id === 'hq_paid');
    assert.deepEqual([hq.model, hq.quality], ['gpt-image-2.5-sunburst', 'high']);
    assert.equal(IMAGE_MODES.find((m) => m.id === 'fast_paid').model, 'gpt-image-2.5-flare');
    const r = resolveModes({ image_modes: {} }).find((m) => m.id === 'hq_paid');
    assert.deepEqual([r.model, r.quality, r.saved, r.custom, r.paid], ['gpt-image-2.5-sunburst', 'high', false, false, true]);
    assert.ok(modelCaps('gpt-image-2.5-sunburst').qualities.includes('high'));
  });
  test('사용자가 예전에 저장해 둔 고품질 모드(Flare 등)는 덮어쓰지 않고 그대로 씀', () => {
    const r = resolveModes({ image_modes: { hq_paid: { model: 'gpt-image-2.5-flare', quality: 'medium' } } }).find((m) => m.id === 'hq_paid');
    assert.deepEqual([r.model, r.quality, r.saved, r.custom], ['gpt-image-2.5-flare', 'medium', true, true]);
  });
  test('설정 저장은 기본값과 다른 모드만 (그대로 둔 모드는 저장 안 함 → 기본값이 바뀌면 따름), 예전에 저장한 값은 지우지 않음', () => {
    const rows = IMAGE_MODES.map((m) => ({ id: m.id, model: m.model, quality: m.quality }));
    assert.deepEqual(modeOverrides(rows), {});
    const changed = rows.map((r) => (r.id === 'free_draft' ? { ...r, model: 'cf-flux-1-schnell', quality: 'high' } : r));
    assert.deepEqual(modeOverrides(changed), { free_draft: { model: 'cf-flux-1-schnell', quality: 'high' } });
    assert.deepEqual(modeOverrides(rows, ['hq_paid']), { hq_paid: { model: 'gpt-image-2.5-sunburst', quality: 'high' } }, '저장해 둔 모드는 같은 값이어도 남김');
    assert.deepEqual(modeOverrides([{ id: 'nope', model: 'x' }, { id: 'hq_paid', model: '' }]), {});
  });
  test('Gemini 두 모델은 계속 고를 수 있고, 3 Pro Image 에는 문서에 없는 비율(1:4 등)을 안 줌', () => {
    for (const m of ['gemini-3-pro-image', 'gemini-nano-banana-2.1']) assert.equal(modelCaps(m).usable, true, m);
    assert.equal(modelCaps('gemini-3-pro-image').aspects.includes('1:4'), false);
    assert.equal(modelCaps('gemini-nano-banana-2.1').aspects.includes('1:4'), true);
    assert.deepEqual([modelCaps('gemini-3-pro-image').refsMax, modelCaps('gemini-nano-banana-2.1').refsMax], [6, 10]);
  });
  test('무료 모델이 참고 사진을 줄여 받으면 AI 실사 장면 전에 알림 (원본 보존 합성은 해당 없음)', () => {
    assert.match(refDownscaleNote('cf-flux-2-klein-4b'), /500px보다 작게.*로고·상품 글자·버튼/);
    assert.equal(refDownscaleNote('cf-flux-2-klein-4b', 'layer'), '');
    assert.equal(refDownscaleNote('gpt-image-2.5-sunburst'), '');
  });
});

describe('지시서 1·7번: 두 방식은 섞지 않고 프롬프트도 따로', () => {
  test('요청 정리: 모르는 값은 기본값, 배경만 템플릿은 원본 보존 합성에서만, 직접 적는 칸은 300자', () => {
    assert.deepEqual(cleanProductSpec({ mode: 'x', template: 'nope', purpose: 'x', angle: 'x', place: 'x' }),
      { mode: 'layer', template: 'table', purpose: 'blog_body', angle: 'front', place: 'center', custom: '', name: '' });
    assert.equal(cleanProductSpec({ mode: 'reference', template: 'bg_only' }).template, 'table');
    assert.equal(cleanProductSpec({ mode: 'layer', template: 'bg_only' }).template, 'bg_only');
    assert.equal(cleanProductSpec({ custom: '가'.repeat(400) }).custom.length, 300);
    assert.deepEqual(Object.keys(PRODUCT_PURPOSES), ['blog_body', 'blog_cover', 'product_detail', 'ig_feed', 'ad_creative']);
    assert.equal(Object.keys(PRODUCT_TEMPLATES).length, 7);
    assert.equal(isProductPreset('pscene_layer') && isProductPreset('pscene_ref'), true);
    assert.equal(PRESETS.pscene_layer, undefined, '일반 이미지 종류 목록에는 안 나옴');
    assert.notEqual(presetOf('product_bg'), 'pscene_layer', "예전 별칭 'product_bg' 와 섞이지 않음");
  });
  test('원본 보존 합성(배경): 상품을 그리지 말라고 하고, 빈자리·같은 각도만. 상품 이름·원고 제목·소제목은 안 보냄', () => {
    const sc = buildProductScene({ spec: SPEC, ratio: '4:3', size: '1024×768', post, slot });
    const p = promptFromProductScene(sc);
    for (const r of LAYER_BG_RULES) assert.ok(p.includes(r), r);
    for (const r of PROMPT_RULES) assert.ok(p.includes(r), r);
    assert.match(p, /empty background plate/);
    assert.match(p, /Empty resting spot: .* in the center of the frame/);
    assert.match(p, /eye-level/);
    assert.ok(!/PK-200|포근|전기요|솔직 비교/.test(p), p);
    assert.ok(!/subject reference/.test(p), '참고 사진 목록 없음');
    assert.deepEqual([sc.mode, sc.preset, sc.refs], ['layer', 'pscene_layer', []]);
  });
  test('AI 실사 장면: 상품 사진을 정확한 상품으로, 바꾸지 말 것·글자 규칙, 작은 글씨는 원본과 달라질 수 있다는 건 화면이 알림', () => {
    const sc = buildProductScene({ spec: { ...SPEC, mode: 'reference', template: 'in_use' }, ratio: '4:3', refs: [{ image_id: 'p1', role: 'subject' }, { image_id: 's1', role: 'style' }], post, slot });
    const p = promptFromProductScene(sc);
    assert.match(p, /exact product/);
    assert.match(p, /Do not redesign the product/);
    assert.match(p, /- Image 1: subject reference/);
    assert.ok(!/Image 2/.test(p), '대상 참고 사진만 (구도 참고는 섞지 않음)');
    assert.match(p, /customer review, testimonial or proof-of-use photo/, '사용 장면도 후기·인증 사진처럼 보이지 않게');
    assert.ok(!/Do NOT draw the product/.test(p));
    assert.match(PRODUCT_MODES.reference.hint, /작은 글자·로고·버튼이 원본과 달라질 수 있어/);
  });
  test('목적마다 연출이 다르고, 어수선함·흠집을 넣으라고 하지 않음', () => {
    const looks = Object.keys(PRODUCT_PURPOSES).map((k) => promptFromProductScene(buildProductScene({ spec: { ...SPEC, purpose: k } })));
    assert.equal(new Set(looks).size, looks.length);
    for (const p of looks) assert.ok(!/clutter(?!ed)|messy|scratch|stain|imperfection|wear and tear|lived-in/i.test(p.replace(/uncluttered/g, '')), p);
  });
  test('부분 수정: 원본 보존 합성의 배경은 빈자리를 그대로 두고, AI 실사 장면은 상품을 그대로 두라고', () => {
    const a = promptFromProductScene(buildProductScene({ spec: SPEC, edit: '조명을 조금 더 따뜻하게' }));
    assert.match(a, /keep the empty resting spot empty and do not add any product/);
    const b = promptFromProductScene(buildProductScene({ spec: { ...SPEC, mode: 'reference' }, edit: '뒤쪽 화분만 지워줘', refs: [{ image_id: 'p1', role: 'subject' }] }));
    assert.match(b, /Keep the product exactly as it is/);
    assert.match(b, /Image 2: subject reference/, '고칠 이미지가 1번, 상품 사진은 2번');
  });
  test('상품 장면 검사: 직접 찍기 자리는 막고, 원본 보존 합성은 참고 사진을 안 받고, AI 실사 장면은 진짜 상품 사진이 필요', () => {
    assert.equal(productGate('layer', { slotText: '전기요를 접는 손 (직접 찍기)' }).code, 'own_photo_slot');
    assert.equal(productGate('layer', { refs: [{ role: 'subject', kind: 'upload' }] }).code, 'layer_no_refs');
    assert.equal(productGate('layer').ok, true);
    assert.equal(productGate('reference', { refs: [{ role: 'subject', kind: 'ai' }] }).code, 'product_photo_needed');
    assert.equal(productGate('reference', { refs: [{ role: 'style', kind: 'upload' }] }).code, 'product_photo_needed');
    assert.equal(productGate('reference', { refs: [{ role: 'subject', kind: 'stock' }] }).ok, true);
  });
});

describe('지시서 4번: 레이어 설정 (위치·크기·회전·그림자·밝기) — 원본 픽셀은 화면이 그대로 얹음', () => {
  test('범위 밖 값은 범위 안으로, 모르는 비율은 빈 값', () => {
    const L = cleanLayer({ x: 3, y: -1, h: 9, rot: 90, shadow: { o: 2, s: -1, dx: 5 }, tone: { b: 1, w: -1 }, bg: { b: 0.1 }, mask: { feather: 99, shrink: -3 }, ratio: '21:9' });
    assert.deepEqual(L, { x: 1, y: 0.05, h: 1.2, rot: 45, shadow: { o: 1, s: 0, dx: 1 }, tone: { b: 0.3, w: -0.3 }, bg: { b: 0.1, w: 0 }, mask: { feather: 8, shrink: 0 }, ratio: '' });
  });
  test('첫 설정은 목적·자리·각도에 맞춤', () => {
    assert.deepEqual([defaultLayer({ place: 'left', purpose: 'product_detail' }).x, defaultLayer({ place: 'left', purpose: 'product_detail' }).h], [0.34, 0.62]);
    assert.equal(defaultLayer({ angle: 'top', purpose: 'blog_body' }).y, 0.75);
  });
  test('놓일 곳 계산: 높이 비율로 크기, 가로 위치는 가운데 기준, 아래 끝은 y — 배율이 1보다 크면 늘린 것', () => {
    const b = layerBox({ x: 0.5, y: 0.9, h: 0.5 }, 1600, 1200, 400, 300);
    assert.deepEqual([b.h, b.w, b.scale, b.left, b.top, b.bottom], [600, 800, 2, 400, 480, 1080]);
  });
});

describe('지시서 6번: 상품 디테일 검수 — 아홉 칸 모두 괜찮아야 승인, 두 방식을 구분', () => {
  test('검수 항목은 지시서와 같은 아홉 가지', () => {
    assert.deepEqual(PRODUCT_CHECKS.map(([, l]) => l), ['상품 외형과 비율', '색상과 소재', '버튼·포트·마감', '라벨·로고·인쇄', '구성품의 수와 배치', '상품 크기와 원근감',
      '상품이 배경에 자연스럽게 놓여 있는지', '불필요한 물체나 가짜 문구', '게시할 때 상품 정보와 모순되지 않는지']);
  });
  test('하나라도 문제·모르겠음·빈칸이면 승인 못 함', () => {
    const ok = Object.fromEntries(PRODUCT_CHECKS.map(([k]) => [k, 'ok']));
    assert.equal(productCheckState(ok).ok, true);
    assert.deepEqual(productCheckState({ ...ok, text: 'issue' }).issues, ['text']);
    assert.deepEqual(productCheckState({ ...ok, parts: 'unsure' }).unsure, ['parts']);
    assert.deepEqual(productCheckState({ ...ok, scale: undefined }).missing, ['scale']);
  });
  test('원본 보존 합성은 픽셀이 원본이라 모양·버튼·글자는 미리 채울 수 있음 (밝기를 바꿨으면 색은 직접)', () => {
    assert.deepEqual(preservedChecks({ tone: { b: 0, w: 0 } }), ['shape', 'color', 'details', 'text']);
    assert.deepEqual(preservedChecks({ tone: { b: 0.1, w: 0 } }), ['shape', 'details', 'text']);
  });
  test('어느 방식인지·승인했는지 (예전 1.5.0 AI 합성은 상품 장면으로 보지 않음)', () => {
    assert.equal(productSceneMode({ kind: 'composite' }), 'layer');
    assert.equal(productSceneMode({ kind: 'ai', composite_mode: 'reference' }), 'reference');
    assert.equal(productSceneMode({ kind: 'ai', composite: true }), '');
    assert.equal(productApproved({ product_check: { approved: true } }), true);
    assert.equal(productApproved({ product_check: { approved: 'true' } }), false);
  });
  test("출처 이름: 'AI 합성 이미지'는 그대로 남고, 원본 보존 합성은 따로", () => {
    assert.equal(originLabel({ kind: 'ai', composite: true, composite_mode: 'reference' }), 'AI 합성 이미지 (실제 사진 참고)');
    assert.equal(originLabel({ kind: 'composite' }), '원본 보존 합성 (상품 사진 + AI 배경)');
    assert.equal(KIND_LABEL.composite, '상품 합성');
    assert.match(captionHint({ kind: 'composite', attribution_text: '상품 사진: 김사진 (Pexels)' }), /^※ 원본 보존 합성 — 실제 상품 사진에 AI로 만든 배경을 합성한 이미지 \(실제 사용 사진 아님\) · 상품 사진: 김사진 \(Pexels\)$/);
    assert.match(captionHint({ kind: 'ai', composite: true }), /^※ AI 합성 이미지 — .*\(실제 사용 사진 아님\)$/);
  });
  test('합성 결과의 출처·라이선스는 상품 사진에서 이어받음', () => {
    assert.equal(productAttribution({ kind: 'stock', author_name: '김사진' }), '상품 사진: 김사진 (Pexels)');
    assert.equal(productAttribution({ kind: 'upload', source_type: 'official' }), '상품 사진: 제조사·판매처 제공 이미지');
    assert.equal(productAttribution({ kind: 'upload', source_type: 'own' }), '');
    assert.match(compositeLicense({ kind: 'upload', license: '직접 올림 (사용 권한 확인함)' }), /^원본 보존 합성 \(앱이 합성\) · 상품: 직접 올림 \(사용 권한 확인함\) · 배경: AI 생성 이미지$/);
    assert.ok(compositeLicense({ kind: 'stock', license: 'x'.repeat(300) }).length <= 200);
  });
});

describe('지시서 9번 7: 상품 디테일 검수 경고와 발행 막기', () => {
  const body = ['## 고르는 법', '[이미지: 침대 위 전기요]', '[이미지: 전기요를 접는 손 (직접 찍기)]', '[이미지: 온도 조절기 버튼 (제품 사진)]'].join('\n');
  const rows = [
    { slot_key: 'k:침대 위 전기요#1', image: { kind: 'composite', composite_mode: 'layer', product_check: null, review_status: '검수 전' } },
    { slot_key: 'k:전기요를 접는 손 (직접 찍기)#1', image: { kind: 'composite', composite_mode: 'layer', product_check: { approved: true }, review_status: '사용 가능' } },
    { slot_key: 'k:온도 조절기 버튼 (제품 사진)#1', image: { kind: 'ai', composite: true, composite_mode: 'reference', product_check: { approved: false }, review_status: '검수 전' } },
    { slot_key: 'x:cover', image: { kind: 'ai', composite: true, composite_mode: 'reference', product_check: null } },
  ];
  test('승인 안 한 상품 이미지는 경고(검수 전과 따로), 직접 찍기 자리의 합성도 경고, 네이버 AI 표시 안내에 합성 포함', () => {
    const r = imageChecks({ body }, rows, { naver: true });
    const w = Object.fromEntries(r.warnings.map((x) => [x.code, x]));
    assert.match(w.product_check_needed.msg, /2곳 있어 \(사진 1, 사진 3\)/);
    assert.match(w.product_check_needed.fix, /승인 전에는 발행 준비 완료로 못 바꿔/);
    assert.equal(w.image_unreviewed, undefined, '상품 이미지는 검수 전 경고와 겹치지 않음');
    assert.ok(w.composite_in_own_slot);
    const t = r.tips.map((x) => x.code);
    assert.ok(t.includes('layer_composite') && t.includes('ai_composite') && t.includes('ai_label'));
  });
  test('발행 막기: 본문 자리와 본문 밖 자리(대표 이미지 등) 모두 봄', () => {
    const e = productGateErrors({ body }, rows);
    assert.equal(e.length, 1);
    assert.equal(e[0].code, 'product_check_needed');
    assert.match(e[0].msg, /3곳 있어 \(사진 1, 사진 3, /);
    assert.deepEqual(productGateErrors({ body }, rows.map((r) => ({ ...r, image: { ...r.image, product_check: { approved: true } } }))), []);
  });
});

describe('AI 검수(참고용): 상품 장면은 아홉 항목으로, 두 방식을 분명히 알려줌', () => {
  test('원본 보존 합성 검수 지시: 픽셀을 다시 그리지 않은 합성이라고, 고칠 점은 배경·그림자만', () => {
    const p = reviewPrompt({ product: 'layer', refs: 1, slotText: '침대 위 전기요' });
    assert.match(p, /\[원본 보존 합성\]/);
    assert.match(p, /배경·그림자만 고치는/);
    for (const [k] of PRODUCT_CHECKS) assert.ok(p.includes(`- ${k}:`), k);
    assert.match(p, /합격 보증이 아니야/);
  });
  test('AI 재생성 검수 지시: 원본과 달라진 곳을 찾으라고, 원본 사진이 없으면 원본 비교 항목은 unsure', () => {
    assert.match(productReviewPrompt({ mode: 'reference', refs: 1 }), /\[AI 재생성\].*달라진 곳/);
    assert.match(productReviewPrompt({ mode: 'reference', refs: 0 }), /원본 사진이 없어서/);
  });
  test('답 읽기: 상품 장면이면 아홉 항목만 남김', () => {
    const raw = JSON.stringify({ checks: { shape: { verdict: 'ok', reason: '같음', confidence: 0.8 }, text: { verdict: 'issue', reason: '로고가 달라', confidence: 0.6 }, match: { verdict: 'ok' } }, summary: 's', suggestions: [] });
    const r = parseReview(raw, { refs: 1, product: 'reference' });
    assert.deepEqual(Object.keys(r.checks), ['shape', 'text']);
    assert.deepEqual(Object.keys(parseReview(raw, { refs: 1 }).checks), ['match'], '일반 검수는 예전 항목');
  });
});
