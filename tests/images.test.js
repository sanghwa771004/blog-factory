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
