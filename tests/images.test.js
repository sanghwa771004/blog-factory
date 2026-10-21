// 이미지 스튜디오 규칙(images.js) 테스트 — 앱과 서버가 같은 파일을 씀
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSlots, slotKey, matchSlots, textSimilarity, RATIOS, PURPOSES, sizeFor, ratioOf, validApiSize, cropRect, outputSize,
  buildPrompt, PROMPT_RULES, promptRisk, blocksOf, slotRisk, descriptionMismatch, estimateUsd, usageUsd, OUTPUT_TOKENS, QUALITIES,
  sniffImage, checkImageFile, MAX_UPLOAD_BYTES, attributionFor, captionHint, altTextFor, fileNameFor, deckFromPost, EXTRA_SLOTS, isExtraKey, fmtUsd,
  stripMetadata, validSlotKey, slotPurpose, extraSlot, sameRatio, orientationFor, searchSuggestions, imageChecks, extOf, estimateTokens,
  ctxOf, modelCaps, qualitiesFor, normQuality, sanitizeContext, STANDARD_SIZES,
} from '../images.js';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name) => new Uint8Array(readFileSync(join(ROOT, 'tests', 'fixtures', 'img', name)));

const BODY = [
  '## 고르는 기준',
  '원룸에서는 크기가 먼저예요.',
  '[이미지: 원룸 책상 옆에 놓인 소형 히터 전경]',
  '전기세는 타이머로 줄여요.',
  '- 타이머 쓰기',
  '[링크: 최저가 보기]',
  '## 비교',
  '[이미지: 4가지 히터 타입을 나란히 놓은 비교 사진]',
  '본문 중간에 [이미지: 이건 줄 전체가 아니라서 자리 아님] 이 있어요.',
  '[이미지: 원룸 책상 옆에 놓인 소형 히터 전경]',
].join('\n');

describe('사진 자리 찾기', () => {
  test('줄 전체가 [이미지: …] 인 줄만, 순서대로, 같은 설명은 몇 번째인지로 구분', () => {
    const s = parseSlots(BODY);
    assert.equal(s.length, 3);
    assert.deepEqual(s.map((x) => x.n), [1, 2, 3]);
    assert.equal(s[0].text, '원룸 책상 옆에 놓인 소형 히터 전경');
    assert.equal(s[0].key, slotKey('원룸 책상 옆에 놓인 소형 히터 전경', 1));
    assert.equal(s[2].key, slotKey('원룸 책상 옆에 놓인 소형 히터 전경', 2), '같은 설명 두 번째');
    assert.notEqual(s[0].key, s[2].key);
    assert.equal(s[0].heading, '고르는 기준');
    assert.equal(s[0].before, '원룸에서는 크기가 먼저예요.');
    assert.equal(s[0].after, '전기세는 타이머로 줄여요.');
    assert.equal(s[1].heading, '비교');
    assert.equal(s[1].before, '', '다른 소제목을 넘어가서 맥락을 가져오지 않음');
  });
  test('띄어쓰기·대소문자만 다른 설명은 같은 열쇠', () => {
    assert.equal(slotKey('소형  히터 전경'), slotKey(' 소형 히터 전경 '));
    assert.equal(parseSlots('').length, 0);
    assert.equal(parseSlots('[이미지]').length, 1, '설명 없는 자리도 자리');
  });
  test('본문 밖 이미지 열쇠는 x: 로 시작', () => {
    assert.ok(EXTRA_SLOTS.every((x) => isExtraKey(x.key) && PURPOSES[x.purpose]));
    assert.equal(isExtraKey(slotKey('a')), false);
  });
});

describe('연결 맞추기 (원고를 고치거나 다시 만들어도 연결이 사라지지 않게)', () => {
  const rows = (s) => s.map((x, i) => ({ id: 'r' + i, slot_key: x.key, slot_index: x.index, slot_text: x.text, image_id: 'img' + i }));
  test('그대로면 그대로 연결', () => {
    const cur = parseSlots(BODY);
    const m = matchSlots(cur, rows(cur));
    assert.ok(m.slots.every((s) => s.link && !s.rekey));
    assert.equal(m.orphans.length, 0);
  });
  test('설명을 조금 고치면 비슷한 자리로 옮김(rekey), 순서가 바뀌어도 설명으로 찾음', () => {
    const before = parseSlots(BODY);
    const edited = BODY.replace('4가지 히터 타입을 나란히 놓은 비교 사진', '4가지 히터 타입을 나란히 놓은 비교 모습')
      .replace('## 고르는 기준', '## 먼저 볼 것\n[이미지: 새로 넣은 창가 사진]');
    const after = parseSlots(edited);
    const m = matchSlots(after, rows(before));
    assert.deepEqual(m.slots.map((s) => s.text), ['새로 넣은 창가 사진', '원룸 책상 옆에 놓인 소형 히터 전경', '4가지 히터 타입을 나란히 놓은 비교 모습', '원룸 책상 옆에 놓인 소형 히터 전경']);
    assert.equal(m.slots[0].link, null, '새 자리는 비어 있음');
    assert.equal(m.slots[1].link.image_id, 'img0', '앞에 자리가 하나 생겨 순서가 밀려도 같은 이미지');
    assert.equal(m.slots[2].link.image_id, 'img1', '설명을 조금 고친 자리');
    assert.equal(m.slots[3].link.image_id, 'img2', '같은 설명 두 번째 자리');
    assert.equal(m.rekeys.length, 1);
    assert.equal(m.rekeys[0].from, before[1].key);
    assert.equal(m.orphans.length, 0);
  });
  test('자리를 지우면 연결은 사라지지 않고 orphans 로 남음 (이미지 없는 빈 줄은 무시)', () => {
    const before = parseSlots(BODY);
    const r = rows(before);
    r.push({ id: 'empty', slot_key: slotKey('비어 있던 자리'), slot_index: 9, slot_text: '비어 있던 자리', image_id: null });
    const after = parseSlots(BODY.replace('[이미지: 4가지 히터 타입을 나란히 놓은 비교 사진]', ''));
    const m = matchSlots(after, r);
    assert.equal(m.orphans.length, 1);
    assert.equal(m.orphans[0].image_id, 'img1');
  });
  test('완전히 다른 설명이면 함부로 옮기지 않음', () => {
    const before = parseSlots('[이미지: 겨울 코트 차림으로 지하철을 기다리는 모습]');
    const after = parseSlots('[이미지: 냉동실에 소분 보관한 소금빵]');
    const m = matchSlots(after, rows(before));
    assert.equal(m.slots[0].link, null);
    assert.equal(m.orphans.length, 1);
  });
  // 리뷰에서 재현된 경우들: 같은 설명이 여러 번 있을 때 몇 번째인지만 보고 섞거나, 설명을 다시 쓰면 연결이 떨어지던 것
  const DUP = ['## 거실', '거실 창가에 두었어요.', '[이미지: 히터 사진]', '바람이 잘 퍼져요.', '## 침실', '침대 옆에 두었어요.', '[이미지: 히터 사진]', '조용해요.'].join('\n');
  const rowsCtx = (s) => s.map((x, i) => ({ id: 'r' + i, slot_key: x.key, slot_index: x.index, slot_text: x.text, slot_ctx: ctxOf(x), image_id: 'IMG_' + (i + 1) }));
  test('같은 설명 두 자리 중 첫째 설명만 고쳐도 이미지가 서로 바뀌지 않음 (주변 글로 구분)', () => {
    const before = parseSlots(DUP);
    const after = parseSlots(DUP.replace('[이미지: 히터 사진]', '[이미지: 히터 사진 두 개]'));
    const m = matchSlots(after, rowsCtx(before));
    assert.deepEqual(m.slots.map((x) => x.link && x.link.image_id), ['IMG_1', 'IMG_2']);
    assert.equal(m.orphans.length, 0);
    // 둘째 자리는 열쇠가 '#2' → '#1'로 바뀌고 첫째는 새 설명으로 → 서로 자리를 비켜야 하는 두 번 옮기기
    assert.deepEqual(m.rekeys.map((r) => [r.from, r.to]).sort(), [[before[0].key, after[0].key], [before[1].key, after[1].key]].sort());
  });
  test('같은 설명 두 자리 중 첫째를 지우면, 남은 자리는 둘째 이미지를 그대로 (첫째 이미지는 사라진 자리로)', () => {
    const before = parseSlots(DUP);
    const after = parseSlots(DUP.replace('[이미지: 히터 사진]', ''));
    const m = matchSlots(after, rowsCtx(before));
    assert.equal(m.slots.length, 1);
    assert.equal(m.slots[0].link.image_id, 'IMG_2');
    assert.deepEqual(m.orphans.map((o) => o.image_id), ['IMG_1']);
  });
  test('같은 위치에서 설명만 새로 쓰면(주변 글은 그대로) 연결을 옮김, 원고를 통째로 다시 쓰면 함부로 옮기지 않음', () => {
    const before = parseSlots(DUP);
    const rewritten = parseSlots(DUP.replace('[이미지: 히터 사진]', '[이미지: 창가 바닥에 둔 작은 난방기]'));
    const m = matchSlots(rewritten, rowsCtx(before));
    assert.equal(m.slots[0].link.image_id, 'IMG_1', '주변 글이 그대로라 같은 자리로 봄');
    const regen = parseSlots('## 고르는 법\n전기세가 걱정이면\n[이미지: 전기 요금 고지서와 계산기]\n## 보관\n여름에는\n[이미지: 옷장 위 보관 상자]');
    const m2 = matchSlots(regen, rowsCtx(before));
    assert.ok(m2.slots.every((x) => !x.link), '내용이 다 바뀌면 사라진 자리로 남겨서 사용자가 고르게');
    assert.equal(m2.orphans.length, 2);
  });
  test('옮길 자리를 연결이 끊긴 다른 이미지 줄이 차지하고 있으면 알려줌 (서버가 먼저 비켜 놓음)', () => {
    const before = parseSlots(DUP);
    const r = rowsCtx(before);
    // 첫째 줄의 열쇠를 가진 '사라진 자리' 이미지가 하나 더 있는 경우
    const after = parseSlots(DUP.replace('[이미지: 히터 사진]', ''));
    const m = matchSlots(after, r);
    assert.equal(m.slots[0].rekey && m.slots[0].rekey.to, after[0].key);
    assert.deepEqual(m.blockers.map((b) => b.image_id), ['IMG_1']);
  });
  test("설명 없는 '[이미지]' 자리도 연결할 수 있는 열쇠", () => {
    const s = parseSlots('글\n[이미지]\n끝\n[이미지:  ]');
    assert.deepEqual(s.map((x) => x.key), ['k:_#1', 'k:_#2']);
    assert.ok(s.every((x) => validSlotKey(x.key)));
  });
  test('본문 밖 이미지(x:)는 본문 자리와 섞지 않음', () => {
    const cur = parseSlots(BODY);
    const m = matchSlots(cur, [{ slot_key: 'x:cover', slot_index: 0, slot_text: '대표', image_id: 'c' }]);
    assert.equal(m.orphans.length, 0);
    assert.ok(m.slots.every((s) => !s.link));
  });
  test('비슷한 정도', () => {
    assert.equal(textSimilarity('소형 히터', '소형 히터'), 1);
    assert.ok(textSimilarity('소형 히터 전경', '소형 히터 모습') > 0.5);
    assert.ok(textSimilarity('소금빵', '헤드폰') < 0.1);
  });
});

describe('같은 설명이 여러 번인 자리 (검증 N1: 주변 글만 새로 쓰면 이미지가 서로 바뀌던 문제)', () => {
  const POOL = ['겨울철 난방비가 걱정된다면 작은 히터부터 살펴보세요.', '전기 히터는 생각보다 전력을 많이 써요.', '창가 쪽은 외풍이 들어와서 더 춥게 느껴져요.',
    '바닥에 두면 발이 따뜻해져서 좋아요.', '타이머 기능이 있으면 잠들 때 편해요.', '아이가 있는 집은 넘어짐 방지 기능을 꼭 확인하세요.',
    '소음이 적은 제품이 침실에는 더 잘 맞아요.', '전기 요금은 하루 몇 시간 쓰는지에 따라 달라져요.', '작은 방이라면 500W 정도면 충분해요.',
    '사용 후에는 먼지를 털어서 보관하면 오래 써요.', '온도 조절이 세밀할수록 전기를 아낄 수 있어요.', '원룸에서는 공간을 덜 차지하는 세로형이 편해요.',
    '거실처럼 넓은 곳은 대류형이 더 좋아요.', '밤새 켜 두는 건 피하는 게 좋아요.', '가습기와 같이 쓰면 덜 건조해요.'];
  const sec = (h, a, b) => [`## ${h}`, a, '[이미지: 히터 사진]', b];
  const A = sec('거실', '거실 창가에 두었어요.', '바람이 잘 퍼져요.'), B = sec('침실', '침대 옆에 두었어요.', '조용해요.'), Cc = sec('욕실', '욕실 앞에 두었어요.', '습기가 있어요.');
  const rowsOf = (parts, withCtx = true) => parseSlots(parts.flat().join('\n')).map((x, i) => ({
    id: 'r' + i, slot_key: x.key, slot_index: x.index, slot_text: x.text, slot_ctx: withCtx ? ctxOf(x) : '', image_id: 'IMG_' + (i + 1),
  }));
  const ids = (parts, rows) => matchSlots(parseSlots(parts.flat().join('\n')), rows).slots.map((s) => (s.link ? s.link.image_id : '-'));
  test('주변 문장을 마구 새로 써도(자리 순서는 그대로) 이미지가 서로 바뀌지 않음 — 무작위 1,000번', () => {
    let seed = 11;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = () => POOL[Math.floor(rnd() * POOL.length)];
    const rows = rowsOf([A, B]);
    let swaps = 0;
    for (let t = 0; t < 1000; t++) {
      const keepHeads = t % 2 === 0;
      const h1 = keepHeads ? '거실' : pick().slice(0, 8), h2 = keepHeads ? '침실' : pick().slice(0, 8);
      const got = ids([sec(h1, pick(), pick()), sec(h2, pick(), pick())], rows);
      if (got[0] !== 'IMG_1' || got[1] !== 'IMG_2') swaps++;
    }
    assert.equal(swaps, 0);
  });
  test('문단째 옮기면(주변 글이 그대로) 이미지가 따라감: 둘 바꾸기·셋 돌리기·셋 뒤집기', () => {
    assert.deepEqual(ids([B, A], rowsOf([A, B])), ['IMG_2', 'IMG_1']);
    assert.deepEqual(ids([Cc, A, B], rowsOf([A, B, Cc])), ['IMG_3', 'IMG_1', 'IMG_2']);
    assert.deepEqual(ids([Cc, B, A], rowsOf([A, B, Cc])), ['IMG_3', 'IMG_2', 'IMG_1']);
  });
  test('문단을 옮기면서 문장을 조금 고쳐도 따라감, 다 새로 쓰면 순서대로', () => {
    const B2 = sec('침실', '침대 옆 협탁에 두었어요.', '조용해요.');
    assert.deepEqual(ids([B2, A], rowsOf([A, B])), ['IMG_2', 'IMG_1']);
    const X = sec('작은 방', '책상 아래에 두었어요.', '발이 따뜻해요.'), Y = sec('큰 방', '문 옆에 두었어요.', '금방 따뜻해져요.');
    assert.deepEqual(ids([X, Y], rowsOf([A, B])), ['IMG_1', 'IMG_2']);
  });
  test('가운데를 지우거나 새로 넣어도 나머지는 제자리 (셋 중 첫째·가운데 지우기, 위에 새로 넣기)', () => {
    const rows = rowsOf([A, B, Cc]);
    const m1 = matchSlots(parseSlots([B, Cc].flat().join('\n')), rows);
    assert.deepEqual(m1.slots.map((s) => s.link.image_id), ['IMG_2', 'IMG_3']);
    assert.deepEqual(m1.orphans.map((o) => o.image_id), ['IMG_1']);
    const m2 = matchSlots(parseSlots([A, Cc].flat().join('\n')), rows);
    assert.deepEqual(m2.slots.map((s) => s.link.image_id), ['IMG_1', 'IMG_3']);
    assert.deepEqual(m2.orphans.map((o) => o.image_id), ['IMG_2']);
    assert.deepEqual(ids([A, B], rowsOf([B])), ['-', 'IMG_1']);
  });
  test('주변 글을 저장하지 않은 예전 줄: 몇 번째인지(키)대로 — 순서를 바꾸지 않음', () => {
    assert.deepEqual(ids([B, A], rowsOf([A, B], false)), ['IMG_1', 'IMG_2']);
  });
  test('일부 자리만 연결돼 있어도(둘째·셋째만) 그대로 그 자리', () => {
    const rows = rowsOf([A, B, Cc]).slice(1);
    assert.deepEqual(ids([A, B, Cc], rows), ['-', 'IMG_2', 'IMG_3']);
  });
  test('같은 설명이 8곳 넘게 있으면 순서만 지킴 (자리 바꾸기 계산은 작은 묶음에서만)', () => {
    const many = Array.from({ length: 8 }, (_, i) => sec('방' + i, POOL[i] , POOL[i + 1]));
    const rows = rowsOf(many);
    const rev = [...many].reverse();
    assert.deepEqual(ids(rev, rows), rows.map((r) => r.image_id));
  });
});

describe('용도·비율·크기', () => {
  test('모든 비율의 AI 요청 크기가 OpenAI 규칙에 맞고, 비용 표에 있음', () => {
    for (const [r, v] of Object.entries(RATIOS)) {
      assert.ok(validApiSize(v.size), r + ' ' + v.size);
      assert.ok(OUTPUT_TOKENS[v.size], '비용 표에 없음: ' + v.size);
      const [w, h] = v.size.split('x').map(Number);
      assert.ok(Math.abs(w / h - v.w / v.h) < 0.01, r + ' 비율이 다름');
    }
    for (const p of Object.values(PURPOSES)) assert.ok(p.ratios.every((r) => RATIOS[r]));
  });
  test('용도별 기본 비율 (지시서 예시: 대표 16:9, 피드 4:5, 스토리 9:16)', () => {
    assert.equal(ratioOf('blog_cover'), '16:9');
    assert.equal(ratioOf('ig_feed'), '4:5');
    assert.equal(ratioOf('ig_story'), '9:16');
    assert.equal(ratioOf('cards', '1:1'), '1:1');
    assert.equal(ratioOf('ig_story', '1:1'), '9:16', '그 용도에 없는 비율이면 기본값');
    assert.equal(sizeFor('blog_body'), '1280x960');
  });
  test('크기 규칙: 16의 배수·비율·총 픽셀', () => {
    assert.ok(validApiSize('1024x1024'));
    assert.equal(validApiSize('1000x1000'), false);
    assert.equal(validApiSize('3840x1024'), false, '3:1 넘음');
    assert.equal(validApiSize('512x512'), false, '픽셀 부족');
    assert.equal(validApiSize('4096x2304'), false, '한 변 3840 초과');
    assert.equal(validApiSize('abc'), false);
  });
  test('자르기: 중심·초점·경계', () => {
    assert.deepEqual(cropRect(1600, 900, '1:1'), { x: 350, y: 0, w: 900, h: 900 });
    assert.deepEqual(cropRect(1600, 900, '1:1', { x: 0, y: 0.5 }), { x: 0, y: 0, w: 900, h: 900 });
    assert.deepEqual(cropRect(1600, 900, '1:1', { x: 1, y: 0.5 }), { x: 700, y: 0, w: 900, h: 900 });
    assert.deepEqual(cropRect(1000, 1000, '16:9'), { x: 0, y: 219, w: 1000, h: 563 });
    assert.deepEqual(cropRect(1024, 1280, '4:5'), { x: 0, y: 0, w: 1024, h: 1280 });
    assert.deepEqual(outputSize({ w: 900, h: 900 }, 1080), { w: 900, h: 900 }, '원본보다 키우지 않음');
    assert.deepEqual(outputSize({ w: 2000, h: 1500 }, 1600), { w: 1600, h: 1200 });
  });
});

describe('프롬프트', () => {
  const post = { titles: ['원룸 전기히터 고르는 법'], keyword: '원룸 전기히터' };
  const slot = parseSlots(BODY)[0];
  test('원고 제목·소제목·주변 문장·사진 자리 설명·스타일·용도와 지울 수 없는 규칙이 들어감', () => {
    const p = buildPrompt({ post, slot, style: 'life_photo', purpose: 'blog_body' });
    assert.match(p, /원룸 전기히터 고르는 법/);
    assert.match(p, /고르는 기준/);
    assert.match(p, /원룸에서는 크기가 먼저예요/);
    assert.match(p, /Scene to show \(Korean\): 원룸 책상 옆에 놓인 소형 히터 전경/);
    assert.match(p, /aspect ratio 4:3/);
    for (const r of PROMPT_RULES) assert.ok(p.includes(r), '규칙 빠짐: ' + r);
    assert.match(p, /No text of any kind/);
  });
  test('사용자가 고친 설명·추가 요청·편집 모드', () => {
    const p = buildPrompt({ post, slot, text: '창가에 둔 히터', extra: '파란 톤으로', purpose: 'ig_story', mode: 'edit' });
    assert.match(p, /Change to make \(Korean\): 창가에 둔 히터/);
    assert.match(p, /파란 톤으로/);
    assert.match(p, /9:16/);
    assert.match(p, /^Edit the provided image/);
  });
  test('긴 입력은 잘림', () => {
    const p = buildPrompt({ post, slot, text: '가'.repeat(2000), extra: '나'.repeat(2000) });
    assert.ok(p.length < 2600);
  });
});

describe('모델마다 되는 크기·품질·가격 (OpenAI 문서 2026-10-22)', () => {
  test('2.5 계열: 원하는 비율 그대로, 품질 5단계 / 이전 모델: 표준 크기 세 가지, 품질 3단계', () => {
    assert.equal(modelCaps('gpt-image-2.5-flare').flexible, true);
    assert.equal(modelCaps('gpt-image-2.5-sunburst-2026-09-08').flexible, true);
    assert.deepEqual(qualitiesFor('gpt-image-2.5-flare'), QUALITIES);
    assert.deepEqual(qualitiesFor('gpt-image-1.5'), ['low', 'medium', 'high']);
    assert.equal(modelCaps('gpt-image-2').flexible, true);
    assert.equal(modelCaps('gpt-image-2').conservative, true, '가격을 확인 못 한 모델');
    for (const m of ['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'my-new-model']) assert.equal(modelCaps(m).flexible, false, m);
    assert.equal(modelCaps('gpt-image-1-mini').id, 'gpt-image-1-mini', '1-mini 를 1로 잘못 읽지 않음');
    assert.equal(sizeFor('blog_cover', '16:9', 'gpt-image-2.5-flare'), '1536x864');
    assert.equal(sizeFor('blog_cover', '16:9', 'gpt-image-1.5'), '1536x1024');
    assert.equal(sizeFor('ig_story', '9:16', 'gpt-image-1.5'), '1024x1536');
    assert.equal(sizeFor('general', '1:1', 'gpt-image-1'), '1024x1024');
    assert.ok(['1536x1024', '1024x1536', '1024x1024'].every((x) => STANDARD_SIZES.includes(x)));
    assert.equal(normQuality('gpt-image-1.5', 'xhigh'), 'high');
    assert.equal(normQuality('gpt-image-1.5', 'max'), 'high');
    assert.equal(normQuality('gpt-image-2.5-flare', 'max'), 'max');
  });
  test('예상 비용: 1.5는 모델 페이지 장당 가격, 모르는 모델은 넉넉히(gpt-image-1 값), 사용량 비용은 그 모델 가격으로', () => {
    const e15 = estimateUsd({ quality: 'medium', size: '1024x1024', promptTokens: 0, model: 'gpt-image-1.5' });
    assert.equal(e15, 0.034, 'gpt-image-1.5 medium 1024² = $0.034 (2.5 계산이면 약 $0.013 → 2.6배 낮게 잡을 뻔)');
    assert.equal(estimateUsd({ quality: 'high', size: '1536x1024', promptTokens: 0, model: 'gpt-image-1' }), 0.25);
    assert.equal(estimateUsd({ quality: 'xhigh', size: '1024x1024', model: 'gpt-image-1.5' }), null, '못 받는 품질은 계산 안 함');
    assert.equal(estimateUsd({ quality: 'medium', size: '1280x960', model: 'gpt-image-1.5' }), null, '못 받는 크기');
    assert.equal(estimateUsd({ quality: 'medium', size: '1280x960', promptTokens: 0, model: 'gpt-image-2' }), 0.063, '가격 모르는 모델은 넉넉히');
    assert.equal(estimateUsd({ quality: 'medium', size: '1280x960', promptTokens: 0, model: 'gpt-image-2.5-flare' }), estimateUsd({ quality: 'medium', size: '1280x960', promptTokens: 0 }));
    const u = { input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens: 1000 };
    assert.equal(usageUsd(u, null, 'gpt-image-1.5'), 0.0325, '100×$5 + 1000×$32 (100만 토큰당)');
    assert.equal(usageUsd(u, null, 'some-unknown-model'), null, '가격을 모르면 계산하지 않음');
    assert.equal(usageUsd(u, { image_output_per_m: 30, image_input_per_m: 8, text_input_per_m: 5 }, 'gpt-image-2.5-flare'), 0.0305);
  });
});

describe('맥락 글 정리 (AI에 보내기 전)', () => {
  test('연결 상품 이름·브랜드·모델명·가격·인증 표현을 지움', () => {
    const t = sanitizeContext('다이슨 V12 무선청소기 보관법 — 39,000원이고 KC 인증을 받았어요. 판매 1위', ['다이슨', 'V12 디텍트 슬림']);
    assert.ok(!/다이슨|V12|39,000|KC|1위/.test(t), t);
    assert.match(t, /무선청소기 보관법/);
    const p = buildPrompt({ post: { titles: ['다이슨 V12 무선청소기 보관법'] }, slot: { text: '보관하는 모습', heading: '다이슨 정리', before: '이 히터는 39,000원이고 KC 인증을 받았어요.', after: '' }, text: '보관하는 모습', hide: ['다이슨'] });
    assert.ok(!/다이슨|39,000|KC/.test(p), p);
    assert.ok(PROMPT_RULES.some((r) => /packaging, component layouts, labels/.test(r)), '구성품·라벨 그리지 말라는 규칙');
  });
});

describe('위험 표현', () => {
  test('막는 요청: 로고·가격 숫자·최저가·인증·순위·후기 사진·글자·연결 상품 브랜드', () => {
    const codes = (t, b) => blocksOf(promptRisk(t, b)).map((x) => x.code);
    assert.deepEqual(codes('애플 로고가 보이게'), ['logo']);
    assert.deepEqual(codes('29,900원 가격표'), ['price']);
    assert.deepEqual(codes('최저가 느낌으로'), ['price']);
    assert.deepEqual(codes('KC 마크와 판매 1위 표시'), ['claim']);
    assert.deepEqual(codes('내돈내산 후기 사진처럼'), ['review']);
    assert.deepEqual(codes('제목을 넣어서 글자 크게'), ['text']);
    assert.deepEqual(codes('다이슨 같은 무선청소기', ['다이슨']), ['brand']);
    assert.deepEqual(codes('원룸 책상 옆에 놓인 소형 히터 전경'), []);
  });
  test("'글자 없이'·'로고 빼고'·'no text' 처럼 넣지 말라는 말은 막지 않음, 보통 표현을 잘못 막지 않음 (리뷰 지적)", () => {
    const codes = (t) => blocksOf(promptRisk(t)).map((x) => x.code);
    for (const t of ['글자 없이 깔끔한 배경', '로고 없이 일반적인 청소기', 'no text, soft light', '글자는 빼고 그림만', 'without logos', '텍스트 없는 배경'])
      assert.deepEqual(codes(t), [], t);
    for (const t of ['에너지 소비효율 1등급 냉장고', '수상한 소리가 나는 세탁기', '원룸 3 원룸 구조', '문구점 앞 풍경'])
      assert.deepEqual(codes(t), [], t);
    assert.deepEqual(codes('수상 경력 트로피'), ['claim']);
    assert.deepEqual(codes('1등 상품 표시'), ['claim']);
    assert.deepEqual(codes('글자를 크게 넣어줘'), ['text'], '넣어달라는 건 그대로 막음');
    assert.deepEqual(codes('3만원짜리 느낌'), ['price']);
  });
  test("'가격'만 있으면 막지 않고 알려만 줌", () => {
    const r = promptRisk('가격대가 다른 히터 세 개');
    assert.equal(blocksOf(r).length, 0);
    assert.deepEqual(r.map((x) => x.code), ['price_word']);
  });
  test('실제 상품·화면 사진이 필요한 자리 (실제 원고 설명으로)', () => {
    assert.equal(slotRisk('박스 구성품을 펼쳐놓은 사진').real, true);
    assert.equal(slotRisk('원재료 표기와 보관 방법이 보이는 포장 뒷면 사진').real, true);
    assert.equal(slotRisk('배터리 성능 상태 확인 화면 캡처').real, true);
    assert.equal(slotRisk('USB-C 단자와 온도 표시등 클로즈업').real, true);
    assert.equal(slotRisk('원룸 책상 옆에 놓인 소형 히터 전경').real, false);
    assert.equal(slotRisk('구연산으로 물통을 세척하는 모습').real, false);
    assert.match(slotRisk('박스 구성품').msg, /직접 찍은 사진/);
  });
  test('이미지 설명이 자리 설명과 많이 다르면', () => {
    assert.equal(descriptionMismatch('소형 히터 전경', '원룸에 놓인 소형 히터'), false);
    assert.equal(descriptionMismatch('소형 히터 전경', '바닷가 노을 풍경'), true);
    assert.equal(descriptionMismatch('', '아무거나'), false);
  });
  test('검증 N10: 여러 개를 함께 빼라는 말·영어 부정·-free 도 막지 않음, 뒤에서 다시 넣어달라면 막음', () => {
    const codes = (t) => blocksOf(promptRisk(t)).map((x) => x.code);
    for (const t of ['글자나 로고 없이 깔끔한 배경', '글자와 로고 없이', '글자, 로고 없이 깔끔하게', '글자·로고 없이', '로고는 없는 일반 청소기', '텍스트가 안 보이게',
      '글자는 넣지 말고', '로고를 지운 청소기', 'no text or logos', 'without any text', 'text-free background', 'no-logo', 'logo-free design', "don't put any text",
      '가격표 없이', 'KC 마크 없이', '로고 X'])
      assert.deepEqual(codes(t), [], t);
    assert.deepEqual(codes('로고 없이 하지 말고 로고를 크게 넣어줘'), ['logo']);
    assert.deepEqual(codes('글자 없는 척 말고 글자 넣어줘'), ['text']);
    assert.deepEqual(codes('로고와 글자 넣어줘'), ['logo', 'text']);
    assert.deepEqual(codes('add a big logo'), ['logo']);
  });
  test('검증 N8: 가격 — 50원·3천원·2만 9천원·5천만원·1.5만원도 막고, 원룸·원형·원래는 가격이 아님', () => {
    const codes = (t) => blocksOf(promptRisk(t)).map((x) => x.code);
    for (const t of ['50원짜리 동전', '3천원 할인 스티커', '2만 9천원 느낌', '5천만원 자동차', '1.5만원', '9,900 원', '990원', '$19.99 tag'])
      assert.deepEqual(codes(t), ['price'], t);
    for (const t of ['원룸 3 원룸 구조', '3원색 배경', '제1원칙', '원형 테이블 2개', '원래 쓰던 히터'])
      assert.deepEqual(codes(t), [], t);
  });
  test('검증 N7: 실제 사진이 필요한 자리 — 빼라는 말·다른 뜻(포장마차·리포트)은 넘어감', () => {
    for (const t of ['로고 없이 일반적인 청소기', '포장마차 거리', '리포트 쓰는 대학생', '박스 없이 거실에 놓인 히터', '화면이 안 보이게 뒤에서 찍은 노트북'])
      assert.equal(slotRisk(t).real, false, t);
    for (const t of ['포장 박스 뒷면', '로고가 보이는 앞면', '제품 내부 구조'])
      assert.equal(slotRisk(t).real, true, t);
  });
  test('검증 N8: 연결 상품 브랜드는 낱말로만 (LG가 algorithm 안에서 걸리지 않음)', () => {
    const codes = (t, b) => blocksOf(promptRisk(t, b)).map((x) => x.code);
    assert.deepEqual(codes('algorithm 설명 그림', ['LG']), []);
    assert.deepEqual(codes('LG 냉장고 느낌', ['LG']), ['brand']);
    assert.deepEqual(codes('삼성전자 느낌의 세탁기', ['삼성']), ['brand'], '한글 이름은 붙여 써도 찾음');
  });
});

describe('맥락 글 정리 — 검증 N8', () => {
  test('가격(천원·만 단위)·인증은 지우고, 모델 번호처럼 생긴 것만 지움 (A4·PM2.5·LED 3개·Wi-Fi 6은 그대로)', () => {
    assert.equal(sanitizeContext('가격은 2만 9천원이고 3천원 쿠폰도 있어요'), '가격은 이고 쿠폰도 있어요');
    assert.equal(sanitizeContext('50원 차이예요'), '차이예요');
    assert.equal(sanitizeContext('A4 용지 크기, LED 3개, PM2.5 필터, Wi-Fi 6 지원'), 'A4 용지 크기, LED 3개, PM2.5 필터, Wi-Fi 6 지원');
    assert.equal(sanitizeContext('갤럭시 SM-G998N 과 V12 비교'), '갤럭시 과 비교');
    assert.equal(sanitizeContext('인증샷 남겨요, KC인증 제품'), '인증샷 남겨요, 제품');
    assert.equal(sanitizeContext('algorithm 설명', ['LG']), 'algorithm 설명');
    assert.equal(sanitizeContext('LG 스탠바이미 후기', ['LG', '스탠바이미']), '제품 제품 후기');
  });
});

describe('내려받을 기본 비율·카드뉴스 출처 (검증 N5·N14)', () => {
  test('자르는 곳을 저장하지 않았으면: 만들 때 고른 비율 → 이미 그 용도 비율인 이미지 → 용도의 첫 비율', async () => {
    const { defaultRatio } = await import('../images.js');
    assert.equal(defaultRatio({ ratio: '16:9', width: 1536, height: 1024 }, 'blog_body'), '16:9', '정해진 크기(3:2)로 만든 이미지도 고른 비율로');
    assert.equal(defaultRatio({ ratio: '', width: 1536, height: 864 }, 'blog_body'), '16:9', '이미 16:9인 사진');
    assert.equal(defaultRatio({ ratio: '4:5', width: 1024, height: 1536 }, 'blog_body'), '4:3', '그 용도에 없는 비율이면 용도 기본');
    assert.equal(defaultRatio({ width: 1000, height: 1000 }, 'ig_feed'), '1:1');
    assert.equal(defaultRatio(null, 'blog_cover'), '16:9');
  });
  test('카드뉴스 이미지를 블로그에 쓸 때: AI 배경이면 AI 표시, Pexels 배경이면 사진가 출처', () => {
    assert.equal(captionHint({ kind: 'card', license: '카드뉴스 (앱에서 직접 만듦) · 배경: AI 생성 이미지', attribution_text: '배경: AI로 만든 예시 이미지' }), '※ 배경은 AI로 만든 예시 이미지');
    assert.equal(captionHint({ kind: 'card', license: '카드뉴스 (앱에서 직접 만듦) · 배경: Pexels 사진 (AIDAN)', attribution_text: '사진: AIDAN (Pexels)' }), '사진: AIDAN (Pexels)');
    assert.equal(captionHint({ kind: 'card', license: '카드뉴스 (앱에서 직접 만듦)', attribution_text: '' }), '');
  });
});

describe('비용 예상 (OpenAI 공식 가격·계산기 값)', () => {
  test('보통 품질 1024x1024: 출력 439토큰 × $30/100만 = $0.01317', () => {
    assert.equal(estimateUsd({ quality: 'medium', size: '1024x1024' }), 0.01317);
    assert.equal(estimateUsd({ quality: 'low', size: '1536x864' }), 0.0036);
    assert.equal(estimateUsd({ quality: 'medium', size: '1024x1024', promptChars: 1000 }), 0.01817, '프롬프트 글자 수만큼 텍스트 입력');
    assert.equal(estimateUsd({ quality: 'medium', size: '1024x1024', mode: 'edit' }), 0.02517, '편집은 입력 이미지 예상치 더함');
    assert.equal(estimateUsd({ quality: 'medium', size: '999x999' }), null, '표에 없는 크기는 예상 못 함');
    assert.equal(estimateUsd({ quality: 'medium', size: '1024x1024', prices: { image_output_per_m: 60 } }), 0.02634, '설정한 가격으로');
  });
  test('품질이 높을수록 비싸짐', () => {
    for (const size of Object.keys(OUTPUT_TOKENS)) {
      const xs = QUALITIES.map((q) => estimateUsd({ quality: q, size }));
      for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], size);
    }
  });
  test('실제 사용량으로 다시 계산', () => {
    const u = { input_tokens: 120, input_tokens_details: { text_tokens: 120, image_tokens: 0 }, output_tokens: 439, total_tokens: 559 };
    assert.equal(usageUsd(u), 0.01377);
    assert.equal(usageUsd({ input_tokens: 100, output_tokens: 0 }), 0.0005, '세부 항목이 없으면 입력은 텍스트로');
    assert.equal(usageUsd(null), null);
    assert.equal(usageUsd({}), null);
    assert.equal(fmtUsd(0.01317), '$0.0132');
    assert.equal(fmtUsd(1.5), '$1.50');
    assert.equal(fmtUsd(null), '–');
  });
});

describe('프롬프트 토큰 어림 (예상 비용의 텍스트 입력 부분)', () => {
  test('영어는 약 3.5글자에 1토큰, 한글은 1글자에 1.2토큰으로 넉넉히', () => {
    assert.equal(estimateTokens('a'.repeat(35)), 10);
    assert.equal(estimateTokens('가'.repeat(10)), 12);
    assert.equal(estimateTokens(''), 0);
    const prompt = buildPrompt({ post: { titles: ['원룸 무선청소기 보관 방법'] }, slot: { text: '작은 원룸에서 무선청소기를 보관하는 모습' }, purpose: 'blog_body', ratio: '4:3' });
    const byTokens = estimateUsd({ quality: 'medium', size: '1280x960', promptTokens: estimateTokens(prompt) });
    const byChars = estimateUsd({ quality: 'medium', size: '1280x960', promptChars: prompt.length });
    assert.ok(byTokens < byChars && byTokens > 0.0105, `${byTokens} < ${byChars}`);
  });
});

describe('파일 검사 (확장자가 아니라 실제 내용으로)', () => {
  test('JPEG·PNG·WebP를 알아보고 가로·세로를 읽음', () => {
    assert.deepEqual(sniffImage(fx('tiny.jpg')), { mime: 'image/jpeg', ext: 'jpg', width: 64, height: 48, animated: false });
    assert.deepEqual(sniffImage(fx('progressive.jpg')), { mime: 'image/jpeg', ext: 'jpg', width: 70, height: 35, animated: false });
    assert.deepEqual(sniffImage(fx('tiny.png')), { mime: 'image/png', ext: 'png', width: 40, height: 50, animated: false });
    assert.deepEqual(sniffImage(fx('tiny.webp')), { mime: 'image/webp', ext: 'webp', width: 30, height: 20, animated: false });
    assert.deepEqual(sniffImage(fx('tiny-lossless.webp')), { mime: 'image/webp', ext: 'webp', width: 30, height: 20, animated: false });
    assert.deepEqual(sniffImage(fx('tiny-alpha.webp')).width, 33);
    assert.equal(sniffImage(fx('tiny-alpha.webp')).height, 21);
  });
  test('움직이는 이미지·GIF·SVG·이름만 바꾼 HTML은 거절', () => {
    assert.equal(sniffImage(fx('anim.png')).animated, true);
    assert.equal(sniffImage(fx('anim.webp')).animated, true);
    assert.equal(sniffImage(fx('tiny.gif')), null);
    assert.equal(sniffImage(fx('vector.svg')), null);
    assert.equal(sniffImage(fx('fake.jpg')), null);
    assert.equal(checkImageFile(fx('anim.png')).code, 'animated');
    assert.equal(checkImageFile(fx('fake.jpg'), 'image/jpeg').code, 'bad_type');
    assert.equal(checkImageFile(fx('tiny.gif')).code, 'bad_type');
  });
  test('형식이 다르다고 적힌 파일·빈 파일·너무 큰 파일', () => {
    assert.equal(checkImageFile(fx('tiny.jpg'), 'image/png').code, 'type_mismatch');
    assert.equal(checkImageFile(new Uint8Array(0)).code, 'empty');
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1); big.set(fx('tiny.jpg'));
    assert.equal(checkImageFile(big).code, 'too_big');
    const ok = checkImageFile(fx('tiny.png'), 'image/png');
    assert.equal(ok.ok, true);
    assert.equal(ok.mime, 'image/png');
  });
});

describe('출처·대체 텍스트·파일 이름', () => {
  test('Pexels 사진가 표기, AI 이미지 안내 문구', () => {
    assert.equal(attributionFor({ provider: 'pexels', author_name: 'Daria' }), '사진: Daria (Pexels)');
    assert.equal(captionHint({ kind: 'ai', provider: 'openai' }), '※ AI로 만든 예시 이미지');
    assert.equal(captionHint({ kind: 'upload', provider: 'upload' }), '');
    assert.equal(altTextFor('원룸 책상 옆에 놓인 소형 히터 사진'), '원룸 책상 옆에 놓인 소형 히터');
    assert.equal(fileNameFor({ keyword: '원룸 전기히터/추천' }, 2, 'blog_body', 'jpg'), '원룸-전기히터-추천-02-blog_body.jpg');
    assert.equal(fileNameFor({ keyword: '원룸 히터' }, 'cover', 'blog_cover', 'png'), '원룸-히터-cover.png', '본문 밖 자리는 이름으로');
    assert.equal(fileNameFor({ keyword: 'a' }, '../x', '', 'jpg'), 'a-x.jpg', '이름에 경로 글자는 빠짐');
    assert.equal(extOf('image/webp'), 'webp');
    assert.equal(extOf('text/html'), 'jpg');
  });
});

describe('사진 자리 이름·용도·검색어', () => {
  test('자리 이름 검사: 본문 자리(k:…#n)와 정해진 본문 밖 자리만', () => {
    assert.equal(validSlotKey(slotKey('원룸 히터')), true);
    assert.equal(validSlotKey('x:cover'), true);
    assert.equal(validSlotKey('x:unknown'), false);
    assert.equal(validSlotKey('k:'), false);
    assert.equal(validSlotKey('k:' + 'a'.repeat(300) + '#1'), false);
    assert.equal(validSlotKey(null), false);
    assert.equal(slotPurpose('x:ig_story'), 'ig_story');
    assert.equal(slotPurpose(slotKey('a')), 'blog_body');
    assert.equal(extraSlot('x:threads').label, '쓰레드 게시물 이미지');
  });
  test('비율이 같은지, 사진 검색 방향', () => {
    assert.equal(sameRatio(1280, 960, '4:3'), true);
    assert.equal(sameRatio(1024, 1024, '4:3'), false);
    assert.equal(orientationFor('16:9'), 'landscape');
    assert.equal(orientationFor('4:5'), 'portrait');
    assert.equal(orientationFor('1:1'), 'square');
  });
  test('검색어 추천: 자리 설명(모습·사진 같은 끝말 뺌) → 키워드 → 소제목, 중복 없이', () => {
    const s = parseSlots('## 보관 요령\n[이미지: 작은 원룸에서 무선청소기를 보관하는 모습]')[0];
    assert.deepEqual(searchSuggestions({ keyword: '무선청소기 보관' }, s), ['작은 원룸에서 무선청소기를 보관', '무선청소기 보관', '보관 요령']);
    assert.deepEqual(searchSuggestions({ keyword: '같음' }, { text: '같음' }), ['같음']);
  });
});

describe('사진 속 숨은 정보 지우기 (GPS·기기·메모)', () => {
  const has = (b, str) => Buffer.from(b).includes(Buffer.from(str));
  const pyDecode = (b, ext) => {
    const dir = mkdtempSync(join(tmpdir(), 'gf-img-'));
    const f = join(dir, 'x.' + ext);
    writeFileSync(f, b);
    const r = spawnSync('python3', ['-c', 'import sys;from PIL import Image;im=Image.open(sys.argv[1]);im.load();print(im.size[0],im.size[1],len(im.getexif()))', f], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : (r.error ? 'skip' : 'fail:' + r.stderr);
  };
  for (const [name, ext, secrets] of [['exif.jpg', 'jpg', ['Exif', 'GPS', 'secret comment', 'TRAILING', 'TestCam']], ['exif-progressive.jpg', 'jpg', ['Exif', 'TestCam']],
    ['exif.png', 'png', ['secret', 'eXIf', 'TestCam', 'Description']], ['exif.webp', 'webp', ['EXIF', 'XMP ', 'secret', 'TestCam']]]) {
    test(name + ': 숨은 정보는 지우고 그림은 그대로', () => {
      const src = fx(name);
      assert.ok(secrets.some((x) => has(src, x)), '원본에는 숨은 정보가 있음');
      const r = stripMetadata(src);
      assert.equal(r.stripped, true);
      for (const x of secrets) assert.equal(has(r.bytes, x), false, x + ' 가 남음');
      const a = sniffImage(src), b = sniffImage(r.bytes);
      assert.deepEqual([b.mime, b.width, b.height], [a.mime, a.width, a.height]);
      const dec = pyDecode(r.bytes, ext);
      if (dec !== 'skip') assert.equal(dec, `${a.width} ${a.height} 0`, '열리고, EXIF 0개');
    });
  }
  test('숨은 정보가 없는 파일은 그대로 열림, 못 읽는 파일은 원본 그대로', () => {
    for (const n of ['tiny.jpg', 'progressive.jpg', 'tiny.png', 'tiny.webp', 'tiny-alpha.webp', 'tiny-lossless.webp']) {
      const r = stripMetadata(fx(n));
      assert.equal(r.stripped, true, n);
      assert.deepEqual(sniffImage(r.bytes), sniffImage(fx(n)), n);
    }
    const broken = fx('tiny.jpg').slice(0, 300);
    assert.equal(stripMetadata(broken).stripped, false);
    assert.equal(stripMetadata(fx('fake.jpg')).stripped, false);
  });
});

describe('이미지 검사 (발행 전 검사에 더하는 확인할 것)', () => {
  const body = '## 비교\n[이미지: 두 제품의 구성품을 펼쳐 놓은 사진]\n[이미지: 원룸 거실 분위기]\n[이미지: 빈 자리]';
  const [a, b] = parseSlots(body);
  test('검수 전·사용 안 함·실제 사진이 필요한 자리의 AI 이미지·상품 글의 AI 이미지·설명 불일치', () => {
    const r = imageChecks({ body, content_type: 'comparison' }, [
      { slot_key: a.key, image: { kind: 'ai', review_status: '검수 전', description: '두 제품의 구성품을 펼쳐 놓은 사진' } },
      { slot_key: b.key, image: { kind: 'stock', review_status: '사용 안 함', description: '바닷가 노을 풍경과 요트' } },
    ]);
    const codes = r.warnings.map((w) => w.code);
    assert.deepEqual(codes, ['image_unreviewed', 'image_rejected', 'ai_real_needed', 'ai_in_product_post', 'image_mismatch']);
    assert.match(r.warnings[0].msg, /사진 1/);
    assert.equal(r.tips[0].msg, '사진 자리 3곳 중 2곳에 이미지가 연결돼 있어.');
  });
  test('문제없으면 진행 상황만', () => {
    const r = imageChecks({ body, content_type: 'how_to' }, [{ slot_key: b.key, image: { kind: 'upload', review_status: '사용 가능', description: '원룸 거실 분위기' } }]);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.tips.length, 1);
    assert.deepEqual(imageChecks({ body: '사진 없음' }, []), { warnings: [], tips: [] });
  });
});

describe('카드뉴스 초안', () => {
  test('채널별 버전의 카드뉴스 문구가 있으면 그걸 씀', () => {
    const d = deckFromPost({ titles: ['제목'], variants: { cards: [{ title: '첫 장', text: '내용' }, '두 번째 장'] } });
    assert.equal(d.source, 'variants');
    assert.deepEqual(d.slides, [{ title: '첫 장', text: '내용' }, { title: '두 번째 장', text: '' }]);
  });
  test('없으면 소제목·목록에서 뽑고, 사진·링크·빈 경험 칸·표는 빼고, 마지막은 블로그 안내', () => {
    const body = '## 고르는 기준\n- 방 크기 [내 경험: 몇 평]\n- 소비전력\n[이미지: 사진]\n## 관리\n먼지는 자주 닦아요. 두 번째 문장.\n| 가 | 나 |\n[링크: 보기]';
    const d = deckFromPost({ titles: ['원룸 히터 고르는 법'], body });
    assert.equal(d.source, 'body');
    assert.equal(d.slides[0].title, '원룸 히터 고르는 법');
    assert.deepEqual(d.slides[1], { title: '고르는 기준', text: '· 방 크기\n· 소비전력' });
    assert.deepEqual(d.slides[2], { title: '관리', text: '먼지는 자주 닦아요.' });
    assert.equal(d.slides[d.slides.length - 1].title, '자세한 내용은 블로그에서');
    assert.ok(!JSON.stringify(d).includes('[이미지') && !JSON.stringify(d).includes('[링크') && !JSON.stringify(d).includes('| 가'));
  });
  test('최대 장수', () => {
    const body = Array.from({ length: 20 }, (_, i) => `## 소제목 ${i}\n- 항목`).join('\n');
    assert.equal(deckFromPost({ titles: ['t'], body }, { max: 6 }).slides.length, 6);
  });
});

describe('서버 사본', () => {
  test('서버 함수 폴더의 images.js·checks.js가 앱 파일과 똑같음', () => {
    for (const f of ['images.js', 'checks.js']) {
      assert.equal(readFileSync(join(ROOT, 'supabase', 'functions', 'blog-app', f), 'utf8'), readFileSync(join(ROOT, f), 'utf8'), f + ' 사본이 다름');
    }
  });
});
