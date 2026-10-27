// 1.5.0 이미지 프롬프트: 이미지 종류(프리셋)·장면 설계서·원고 맥락 (지시서 1·2·3번)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, STYLES, IMAGE_TYPES, presetOf, validPreset, recommendPreset, readContext, buildScene, promptFromScene, buildPrompt,
  TEXT_RULES, PROMPT_RULES, REF_ROLES, SCENE_EDITABLE, aiGate, parseSlots, originLabel, captionHint, originOf,
} from '../images.js';

const post = { titles: ['원룸 전기히터 고르는 법'], keyword: '원룸 전기히터' };
const slot = { text: '책상 옆에 놓인 소형 히터', heading: '고르는 기준', before: '크기가 먼저예요.', after: '' };
const P = (preset, extra = {}) => buildPrompt({ post, slot, preset, purpose: 'blog_body', ratio: '4:3', ...extra });
const PHOTO = Object.keys(PRESETS).filter((k) => PRESETS[k].type === 'photo');

describe('지시서 1: 실사 사진에 삽화 지시를 넣지 않고, 종류마다 프롬프트를 따로', () => {
  test('프리셋 9가지 (생활·다큐·편집·제품 정물·음식·반려동물·설명 일러스트·도식·카드뉴스 배경)', () => {
    assert.deepEqual(Object.keys(PRESETS), ['life_photo', 'documentary', 'editorial', 'product_still', 'food', 'pet', 'explainer', 'diagram', 'card_bg']);
    assert.equal(PHOTO.length, 6);
    for (const [k, v] of Object.entries(PRESETS)) {
      assert.ok(IMAGE_TYPES[v.type], k);
      for (const f of ['label', 'render', 'camera', 'light', 'color', 'materials', 'composition']) assert.ok(v[f], `${k}.${f}`);
    }
    assert.equal(STYLES, PRESETS, '예전 이름도 같은 표');
  });
  test("실사 사진 프리셋 프롬프트에는 'illustrat'(삽화) 지시가 없고 'Photograph'로 시작", () => {
    for (const k of PHOTO) {
      const p = P(k);
      assert.ok(!/illustrat/i.test(p), `${k}: ${p.slice(0, 200)}`);
      assert.match(p, /^Image type: Photograph — /, k);
    }
    assert.match(P('explainer'), /^Image type: Illustration/);
    assert.match(P('diagram'), /^Image type: Information diagram/);
    assert.match(P('card_bg'), /^Image type: Background image for a social media card/);
  });
  test('프리셋마다 카메라·빛·구도·피할 것이 다름 (같은 문장을 돌려쓰지 않음)', () => {
    const keys = Object.keys(PRESETS);
    for (const f of ['render', 'camera', 'light', 'composition']) {
      const vals = keys.map((k) => PRESETS[k][f]);
      assert.equal(new Set(vals).size, vals.length, `${f} 값이 겹침`);
    }
    const prompts = keys.map((k) => P(k));
    assert.equal(new Set(prompts).size, prompts.length);
  });
  test('모든 사진에 먼지·주름·사용 흔적·어수선함을 강제하지 않음, 가운데 정렬·같은 여백을 강제하지 않음', () => {
    for (const k of Object.keys(PRESETS)) {
      const p = P(k);
      assert.ok(!/\b(dust|creases?|wear|clutter|lived-in)\b/i.test(p), `${k}: 사용 흔적 강제`);
      assert.ok(!/먼지|주름|어수선|사용 흔적/.test(PRESETS[k].composition + PRESETS[k].materials), k);
      assert.ok(!/\bcentered\b|safe margins/i.test(p), `${k}: 가운데 강제`);
    }
    // 대표 이미지만: 썸네일로 잘리는 경우를 위해 주인공 위치 안내 (다른 용도에는 없음)
    assert.match(buildPrompt({ post, slot, preset: 'life_photo', purpose: 'blog_cover' }), /썸네일/);
    assert.ok(!/썸네일/.test(P('life_photo')));
  });
  test('예전 스타일 이름은 비슷한 프리셋으로 (다시 만들기 할 때)', () => {
    assert.equal(presetOf('product_bg'), 'editorial');
    assert.equal(presetOf('warm_info'), 'explainer');
    assert.equal(presetOf('compare_bg'), 'diagram');
    assert.equal(presetOf('ig_card'), 'card_bg');
    assert.equal(presetOf('없는거'), 'life_photo');
    assert.equal(validPreset('ig_card'), true);
    assert.equal(validPreset('nope'), false);
  });
});

describe('지시서 1: 맥락에 없는 계절·날씨·장소·나라를 지어내지 않음', () => {
  test('원고에 계절·시간이 없으면 넣지 말라고 적고, 계절 낱말을 쓰지 않음', () => {
    const p = buildPrompt({ post: { titles: ['무선청소기 보관 방법'] }, slot: { text: '청소기를 벽에 세워 둔 모습' }, preset: 'life_photo' });
    assert.match(p, /Season, weather and time: not stated in the post — do not add/);
    assert.ok(!/\b(winter|summer|spring|autumn|snow|rain|morning|night)\b/i.test(p), p);
    assert.match(p, /Location: not stated — do not add a particular country/);
    assert.ok(!/South Korea|Korean apartment/.test(p), '한국을 뜻하는 말이 없으면 나라를 정하지 않음');
    const s = buildScene({ post: { titles: ['무선청소기 보관 방법'] }, slot: { text: '청소기를 벽에 세워 둔 모습' } });
    assert.ok(s.notes.some((n) => n.startsWith('계절·날씨·시간: 원고에 없어서')));
    assert.ok(s.notes.some((n) => n.startsWith('장소: 원고에 없어서')));
  });
  test('원고에 있으면 그대로 (어디서 읽었는지와 함께)', () => {
    const c = readContext({ post: { titles: ['겨울 원룸 결로 막는 법'] }, slot: { text: '창틀에 맺힌 물방울', heading: '아침마다 생기는 결로' } });
    assert.deepEqual(c.season.items.map((x) => x.ko), ['겨울']);
    assert.equal(c.season.from, '제목');
    assert.deepEqual(c.time.items.map((x) => x.ko), ['아침']);
    assert.equal(c.time.from, '소제목');
    assert.deepEqual(c.place.items.map((x) => x.ko), ['창가', '원룸']);
    assert.equal(c.korea, true, '원룸은 한국 주거 형태');
    const p = buildPrompt({ post: { titles: ['겨울 원룸 결로 막는 법'] }, slot: { text: '창틀에 맺힌 물방울', heading: '아침마다 생기는 결로' } });
    assert.match(p, /Season, weather and time \(from the post, Korean\): 겨울 · 아침 \(winter, morning\)/);
    assert.match(p, /Location: South Korea, as the post implies/);
  });
  test('낱말 속 글자로 잘못 읽지 않음 (돌봄의 봄·비교의 비·낮은의 낮·군밤의 밤·건조기·거리 두기)', () => {
    const c = readContext({ slot: { text: '반려동물 돌봄 비교, 낮은 소음, 군밤 간식, 건조기 사용, 거리를 두고 놓기' } });
    assert.deepEqual([c.season.items, c.weather.items, c.time.items, c.place.items].map((x) => x.length), [0, 0, 0, 0], JSON.stringify(c));
  });
  test('장소는 앞뒤 문장에서 가져오지 않음 (다른 이야기일 때가 많음), 계절은 가장 가까운 곳 한 곳에서', () => {
    const c = readContext({ slot: { text: '책상 위 가습기', before: '카페나 사무실에서도 쓸 수 있어요. 여름에는 끄고', after: '겨울엔 켜요' } });
    assert.deepEqual(c.place.items.map((x) => x.ko), ['책상']);
    assert.deepEqual(c.season.items.map((x) => x.ko), ['여름', '겨울'], '앞뒤 문장 한 곳 안의 것만');
    assert.equal(c.season.from, '앞뒤 문장');
  });
  test('사용자가 장면 설계서에서 고친 값이 먼저 (지역도 직접 켜고 끌 수 있음)', () => {
    const s = buildScene({ post, slot, overrides: { setting: '오래된 주택 거실', time: '비 오는 저녁', locale: 'none', camera: '위에서 내려다봄' } });
    assert.equal(s.setting, '오래된 주택 거실');
    assert.equal(s.setting_from, '직접 적음');
    assert.equal(s.setting_en, '');
    assert.equal(s.time, '비 오는 저녁');
    assert.equal(s.locale, '', '원룸이 있어도 사용자가 끄면 나라를 정하지 않음');
    assert.equal(s.camera, '위에서 내려다봄');
    const s2 = buildScene({ post: { titles: ['청소기'] }, slot: { text: '청소기' }, overrides: { locale: 'KR' } });
    assert.equal(s2.locale, 'KR');
    assert.ok(SCENE_EDITABLE.includes('must_show') && SCENE_EDITABLE.includes('avoid'));
  });
});

describe('지시서 1: 글자·로고 규칙은 용도에 맞게', () => {
  test('사진: 글자를 얹지 않음 · 일러스트: 글자 없음 · 도식: 숫자·화살표는 됨 · 카드뉴스 배경: 아무 글자도 없음', () => {
    assert.match(P('life_photo'), new RegExp('Text and logos: ' + TEXT_RULES.photo.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(P('explainer'), /No words or letters anywhere/);
    assert.match(P('diagram'), /Simple numerals 1-9, arrows and icons are allowed/);
    assert.match(P('card_bg'), /No text, letters, numbers, logos or symbols anywhere/);
    assert.ok(!/numerals/.test(P('card_bg')) && !/numerals/.test(P('life_photo')));
  });
  test('제품 참고 사진(대상 모양 유지)이 있으면 그 제품의 인쇄·로고는 참고 사진 그대로 두라고 (새 글자는 안 됨), 없으면 브랜드 없이', () => {
    const withRef = buildPrompt({ post, slot, preset: 'product_still', refs: [{ role: 'subject', image_id: 'x' }] });
    assert.match(withRef, /Keep any printing or logo that is on the subject reference exactly as it is there/);
    assert.match(withRef, /Image 1: subject reference — keep this exact object exactly as shown/);
    assert.match(withRef, /Take the subject's appearance only from the subject reference image/);
    assert.ok(!/draw generic, unbranded objects/.test(withRef), '참고 제품을 일반 물건으로 바꾸라고 하지 않음');
    assert.match(withRef, /Must show:\n- 참고 사진 속 대상/);
    const noRef = buildPrompt({ post, slot, preset: 'product_still' });
    assert.match(noRef, /draw generic, unbranded objects/);
  });
  test('참고 이미지 역할 3가지와 순서 (고치기면 1번은 고칠 이미지)', () => {
    assert.deepEqual(Object.keys(REF_ROLES), ['subject', 'style', 'background']);
    const refs = [{ role: 'subject' }, { role: 'style' }, { role: 'background' }];
    const p = buildPrompt({ post, slot, refs });
    assert.match(p, /- Image 1: subject reference[\s\S]*- Image 2: style reference[\s\S]*- Image 3: background reference/);
    const e = buildPrompt({ post, slot, text: '조명만 더 자연스럽게', mode: 'edit', refs: [{ role: 'style' }] });
    assert.match(e, /^Edit the provided image \(the first attached image\)/);
    assert.match(e, /- Image 2: style reference/);
    assert.match(e, /Do not redraw the whole image/);
    assert.ok(!/Camera \(Korean\)/.test(e), '고치기에는 새 장면 지시(카메라·빛)를 넣지 않음 — 요청한 부분만');
  });
});

describe('지시서 2: 장면 설계서 (JSON)', () => {
  test('목적·피사체·장소·카메라·빛·색·소재·구도·플랫폼·꼭 보일 것·넣지 말 것이 다 있고 JSON으로 그대로 저장됨', () => {
    const s = buildScene({ post, slot, preset: 'food', purpose: 'ig_feed', ratio: '4:5', size: '1024x1280', channel: 'instagram' });
    for (const k of ['goal', 'subject', 'setting', 'camera', 'light', 'color', 'materials', 'composition', 'platform', 'must_show', 'avoid', 'refs']) assert.ok(k in s, k);
    assert.equal(s.type, 'photo');
    assert.equal(s.preset, 'food');
    assert.deepEqual(s.platform, { purpose: 'ig_feed', label: '인스타그램 피드용', ratio: '4:5', size: '1024x1280', channel: 'instagram' });
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    assert.equal(promptFromScene(s), buildPrompt({ post, slot, preset: 'food', purpose: 'ig_feed', ratio: '4:5', size: '1024x1280', channel: 'instagram' }));
    assert.match(s.goal, /'고르는 기준' 부분에서 '책상 옆에 놓인 소형 히터'를 보여주는 인스타그램 피드용 이미지/);
  });
  test('맥락의 상품 이름·가격·인증 표현은 설계서에서도 지움', () => {
    const s = buildScene({ post: { titles: ['다이슨 V12 39,000원 KC 인증'] }, slot: { text: '보관 모습', heading: '다이슨 정리' }, hide: ['다이슨'] });
    assert.ok(!/다이슨|V12|39,000|KC/.test(JSON.stringify(s.context)), JSON.stringify(s.context));
  });
});

describe('지시서 3: 프리셋 추천 (바꿀 수 있음)', () => {
  test('반려동물·음식·도식·제품·카드뉴스·대표 이미지·뉴스·그 밖', () => {
    const r = (text, o = {}) => recommendPreset({ slot: { text }, ...o }).id;
    assert.equal(r('소파에서 낮잠 자는 강아지'), 'pet');
    assert.equal(r('접시에 담은 소금빵'), 'food');
    assert.equal(r('커피머신 정면'), 'product_still', '커피머신은 음식이 아님');
    assert.equal(r('제습기가 습기를 빨아들이는 원리'), 'diagram');
    assert.equal(r('제품 외관 정면'), 'product_still');
    assert.equal(r('아무 장면', { purpose: 'cards' }), 'card_bg');
    assert.equal(r('아무 장면', { purpose: 'blog_cover' }), 'editorial');
    assert.equal(r('아무 장면', { post: { content_type: 'news_summary' } }), 'documentary');
    assert.equal(r('원룸 책상 위 노트북'), 'life_photo');
    assert.ok(recommendPreset({ slot: { text: '강아지' } }).why);
  });
});

describe("지시서 1: 실제 제품·사용 인증 사진을 AI로 지어내지 않음", () => {
  const body = '## 결로\n[이미지: (직접 찍기) 내 방 창틀에 맺힌 물방울]\n[이미지: 제습기 구성품]\n[이미지: 원룸 창가 풍경]';
  const [own, real, plain] = parseSlots(body);
  test("'직접 찍기' 자리는 AI로 못 만듦 — 설명에서 표시를 지워도, 참고 사진을 넣어도, 일반 장면으로 체크해도", () => {
    for (const o of [{}, { text: '창틀 물방울' }, { refs: [{ role: 'subject' }] }, { genericOk: true }]) {
      const g = aiGate(own.text, o);
      assert.deepEqual([g.ok, g.code], [false, 'own_photo_slot'], JSON.stringify(o));
    }
  });
  test('실제 제품 모양이 필요한 자리: 진짜 제품 사진(대상 모양 유지)을 넣으면 AI 합성으로, 아니면 일반 장면 확인이 있어야', () => {
    assert.deepEqual([aiGate(real.text).ok, aiGate(real.text).code], [false, 'real_photo_needed']);
    assert.match(aiGate(real.text).msg, /참고 사진\(대상 모양 유지\)/);
    assert.deepEqual([aiGate(real.text, { refs: [{ role: 'subject' }] }).ok, aiGate(real.text, { refs: [{ role: 'subject' }] }).composite], [true, true]);
    assert.equal(aiGate(real.text, { refs: [{ role: 'style' }] }).ok, false, '구도 참고만으로는 제품 모양이 안 정해짐');
    assert.deepEqual([aiGate(real.text, { genericOk: true }).ok, aiGate(real.text, { genericOk: true }).generic], [true, true]);
    assert.equal(aiGate(plain.text).ok, true);
    assert.equal(aiGate(plain.text, { text: '버튼 클로즈업' }).ok, false, '고친 설명도 같이 봄');
  });
  test("실제 사진을 참고한 AI 이미지는 'AI 합성'으로 따로 표시하고 캡션에 실제 사용 사진이 아니라고", () => {
    const img = { kind: 'ai', composite: true };
    assert.equal(originOf(img), 'ai');
    assert.equal(originLabel(img), 'AI 합성 (실제 사진 참고)');
    assert.match(captionHint(img), /실제 사진을 참고해 AI로 만든 연출 이미지 \(실제 사용 사진 아님\)/);
    assert.equal(originLabel({ kind: 'ai' }), 'AI 생성');
    assert.equal(captionHint({ kind: 'ai' }), '※ AI로 만든 예시 이미지');
  });
  test('규칙은 늘 붙음 (가격·인증·실존 인물·후기 사진처럼 보이게 하지 않기)', () => {
    for (const k of Object.keys(PRESETS)) for (const r of PROMPT_RULES) assert.ok(P(k).includes(r), `${k}: ${r}`);
  });
});
