// 1.5.0 공급자 어댑터 테스트 — OpenAI·Gemini·Cloudflare 요청 모양·오류 처리·참고 사진·검수·연결 확인 (가짜 fetch, 실제 API는 부르지 않음)
// 여기서 통과해도 '실제 생성 성공'이 아님 — 실제 API로 돌려 본 결과는 docs/REPORT-1.5.0.md 에 따로 적음
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openaiImage, geminiImage, classifyGeminiError, geminiPickImage, GEMINI_URL, cloudflareImage, cfRulesFor, runGeneration, bytesToB64, NOT_COUNTED,
  reviewPrompt, parseReview, visionReview, reviewUsageUsd, providerCheck, needMsFor, TEST_MODEL,
} from '../supabase/functions/blog-app/image_service.js';
import { modelCaps, sizeFor, estimateUsd, usageUsd, REVIEW_CHECKS, estimateReviewUsd, roundUsd, refsLimit } from '../images.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name) => new Uint8Array(readFileSync(join(ROOT, 'tests', 'fixtures', 'img', name)));
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = await handler(String(url), init, calls.length);
    const headers = new Map(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return { ok: (r.status || 200) < 400, status: r.status || 200, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
      json: async () => { if (r.json === undefined) throw new Error('no json'); return r.json; }, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  f.calls = calls;
  return f;
}
function fakeDeps(over = {}) {
  const log = { rpc: [], upload: [], download: [] };
  return {
    log,
    rpc: async (name, args) => {
      log.rpc.push({ name, args });
      if (name === 'image_save') return { data: { image: { id: 'img-1', ...args.img }, generation: { id: args.gen, status: '성공' } }, error: null };
      if (name === 'image_gen_fail') return { data: { id: args.gen, status: '실패', ...args.fin }, error: null };
      return { data: null, error: null };
    },
    upload: async (path, bytes, mime) => { log.upload.push({ path, mime }); return { error: null }; },
    remove: async () => ({ error: null }),
    download: async (path) => { log.download.push(path); return over.download ? over.download(path) : { ok: true, bytes: fx('photo-4x3.jpg') }; },
    findImage: async () => null, logCall: async () => {},
    fetchImpl: over.fetchImpl || fakeFetch(() => ({ status: 500, json: {} })),
    now: () => new Date('2026-10-27T05:00:00Z'), uuid: () => '11111111-2222-4333-8444-555555555555',
  };
}
const JPG = fx('photo-4x3.jpg');
const PRO = 'gemini-3-pro-image';
const GUSAGE = { promptTokenCount: 900, candidatesTokenCount: 1180, thoughtsTokenCount: 200, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }, { modality: 'TEXT', tokenCount: 60 }] };
const gemOk = (parts) => ({ json: { candidates: [{ content: { parts: parts || [{ thought: true, inlineData: { mimeType: 'image/png', data: bytesToB64(fx('tiny.png')) } }, { text: '여기 있어' }, { inlineData: { mimeType: 'image/jpeg', data: bytesToB64(JPG) } }] }, finishReason: 'STOP' }], usageMetadata: GUSAGE, responseId: 'resp-1' } });
const GEN = { id: 'gen-1', mode: 'generate', model: PRO, prompt: 'BRIEF', size: '16:9@2K', quality: 'high', output_format: 'jpeg', post_id: 'post-1', slot_key: 'k:a#1', slot_index: 0, slot_text: '책상 위 제습기', user_prompt: '', style: 'product_still', purpose: 'blog_body' };

describe('Gemini 이미지 (generateContent)', () => {
  test('요청: 모델 주소, 키는 x-goog-api-key 머리글로만(주소에 없음), 글 + 참고 사진(inline_data), 비율·해상도', async () => {
    const f = fakeFetch(() => gemOk());
    const r = await geminiImage({ fetchImpl: f, key: 'g-key-secret', model: PRO, prompt: '제습기', size: '16:9@2K', images: [{ bytes: JPG, mime: 'image/jpeg', role: 'subject' }] });
    assert.equal(r.ok, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, `${GEMINI_URL}/models/${PRO}:generateContent`);
    assert.ok(!f.calls[0].url.includes('g-key-secret') && !/[?&]key=/.test(f.calls[0].url), '키를 주소에 넣지 않음');
    assert.equal(f.calls[0].init.headers['x-goog-api-key'], 'g-key-secret');
    const body = JSON.parse(f.calls[0].init.body);
    assert.deepEqual(body.contents[0].parts[0], { text: '제습기' });
    assert.equal(body.contents[0].parts[1].inline_data.mime_type, 'image/jpeg');
    assert.equal(body.contents[0].parts[1].inline_data.data, bytesToB64(JPG));
    assert.ok(body.generationConfig.responseModalities.includes('IMAGE'));
    assert.deepEqual(body.generationConfig.imageConfig, { aspectRatio: '16:9', imageSize: '2K' });
  });
  test('답: 생각 과정(thought) 이미지는 버리고 마지막 결과 이미지, 사용량은 그대로', async () => {
    const r = await geminiImage({ fetchImpl: fakeFetch(() => gemOk()), key: 'k', model: PRO, prompt: 'p', size: '4:3@1K' });
    assert.equal(r.b64, bytesToB64(JPG));
    assert.equal(r.mime, 'image/jpeg');
    assert.deepEqual(r.usage, GUSAGE);
    assert.equal(r.requestId, 'resp-1');
    const p = geminiPickImage({ candidates: [{ content: { parts: [{ thought: true, inlineData: { data: 'AAA', mimeType: 'image/png' } }] } }] });
    assert.equal(p.img, null, '생각 과정 이미지만 있으면 결과 없음');
  });
  // 2026-10-27: 해상도를 못 고르던 2.5 Flash Image 는 지원 종료 날짜가 문서마다 달라서 등록표에서 뺐음 → Nano Banana 2.1 로 시험
  test('Nano Banana 2.1도 비율·해상도를 같이, 해상도 없는 크기는 비율만, 못 받는 비율은 부르기 전에 거절', async () => {
    const NB = 'gemini-nano-banana-2.1';
    const f = fakeFetch(() => gemOk());
    assert.equal(sizeFor('ig_feed', '4:5', NB, 'high'), '4:5@2K');
    await geminiImage({ fetchImpl: f, key: 'k', model: NB, prompt: 'p', size: sizeFor('ig_feed', '4:5', NB, 'high') });
    assert.equal(f.calls[0].url, `${GEMINI_URL}/models/${NB}:generateContent`);
    assert.deepEqual(JSON.parse(f.calls[0].init.body).generationConfig.imageConfig, { aspectRatio: '4:5', imageSize: '2K' });
    await geminiImage({ fetchImpl: f, key: 'k', model: NB, prompt: 'p', size: '4:5' });
    assert.deepEqual(JSON.parse(f.calls[1].init.body).generationConfig.imageConfig, { aspectRatio: '4:5' });
    assert.equal(modelCaps('gemini-2.5-flash-image').known, false, '등록표에서 뺀 이름은 모르는 모델 → 서버가 거절');
    const g = fakeFetch(() => gemOk());
    const r = await geminiImage({ fetchImpl: g, key: 'k', model: PRO, prompt: 'p', size: '7:3@2K' });
    assert.deepEqual([r.ok, r.code, g.calls.length], [false, 'gemini_unsupported_option', 0]);
    assert.equal((await geminiImage({ fetchImpl: g, key: '', model: PRO, prompt: 'p', size: '1:1@1K' })).code, 'gemini_key_missing');
    assert.equal((await geminiImage({ fetchImpl: g, key: 'k', model: 'gpt-image-2.5-flare', prompt: 'p', size: '1:1@1K' })).code, 'model_unavailable', 'Gemini 모델이 아니면 Gemini로 안 보냄');
    assert.equal(g.calls.length, 0);
  });
  test('오류 나누기: 키·권한·모델·결제·한도·옵션·서버 (청구 여부와 하루 횟수)', () => {
    const c = (st, error) => classifyGeminiError(st, { error });
    assert.equal(c(400, { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' }).code, 'gemini_key_invalid');
    assert.equal(c(403, { status: 'PERMISSION_DENIED', message: 'denied' }).code, 'gemini_key_invalid');
    assert.equal(c(404, { status: 'NOT_FOUND', message: 'models/x is not found' }).code, 'model_unavailable');
    assert.equal(c(400, { status: 'FAILED_PRECONDITION', message: 'User location is not supported for the API use.' }).code, 'gemini_billing');
    assert.equal(c(429, { status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted (e.g. check quota).' }).code, 'gemini_quota');
    assert.equal(c(429, { status: 'RESOURCE_EXHAUSTED', message: 'Too many requests per minute' }).code, 'gemini_rate_limited');
    assert.equal(c(400, { status: 'INVALID_ARGUMENT', message: 'Unsupported aspect ratio' }).code, 'gemini_unsupported_option');
    const sv = c(503, { status: 'UNAVAILABLE', message: 'overloaded' });
    assert.deepEqual([sv.code, sv.billed, sv.retryable], ['gemini_server', 'maybe', true]);
    assert.equal(c(400, { status: 'INVALID_ARGUMENT', message: 'API key not valid sk-abcdefghijklmnopqrstuvwxyz0123' }).message.includes('sk-abc'), false, '키처럼 생긴 글자는 가림');
    for (const k of ['gemini_key_missing', 'gemini_key_invalid', 'gemini_billing', 'gemini_quota', 'gemini_rate_limited', 'gemini_unsupported_option', 'gemini_blocked']) assert.ok(NOT_COUNTED.has(k), k);
    assert.ok(!NOT_COUNTED.has('gemini_output_blocked') && !NOT_COUNTED.has('gemini_server'), '만든 뒤 실패는 횟수에 셈');
  });
  test('안전 검사: 만들기 전에 막힘(청구 없음·횟수 안 셈) / 만든 뒤 막힘(확인 필요·횟수 셈)', async () => {
    const pre = await geminiImage({ fetchImpl: fakeFetch(() => ({ json: { promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 10 } } })), key: 'k', model: PRO, prompt: 'p', size: '1:1@1K' });
    assert.deepEqual([pre.code, pre.billed], ['gemini_blocked', 'no']);
    const post = await geminiImage({ fetchImpl: fakeFetch(() => ({ json: { candidates: [{ content: { parts: [] }, finishReason: 'IMAGE_SAFETY' }], usageMetadata: GUSAGE } })), key: 'k', model: PRO, prompt: 'p', size: '1:1@1K' });
    assert.deepEqual([post.code, post.billed], ['gemini_output_blocked', 'maybe']);
    const none = await geminiImage({ fetchImpl: fakeFetch(() => ({ json: { candidates: [{ content: { parts: [{ text: '못 그려' }] }, finishReason: 'STOP' }] } })), key: 'k', model: PRO, prompt: 'p', size: '1:1@1K' });
    assert.equal(none.code, 'gemini_no_image');
  });
  test('비용: 예상(해상도별 장당 + 설명 토큰 + 넣는 이미지) / 사용량 기준(이미지 출력·글 출력·생각 토큰을 따로)', () => {
    assert.equal(estimateUsd({ quality: 'high', size: '16:9@2K', promptTokens: 1000, model: PRO }), 0.136);
    assert.equal(estimateUsd({ quality: 'max', size: '16:9@4K', promptTokens: 0, model: PRO }), 0.24);
    assert.equal(estimateUsd({ quality: 'high', size: '16:9@2K', promptTokens: 0, model: PRO, refs: 2 }), 0.1362);
    assert.equal(estimateUsd({ quality: 'low', size: '16:9@2K', model: PRO }), null, '못 받는 품질');
    // 입력 900 × $2 + 이미지 1120 × $120 + (글 60 + 생각 200) × $12 (100만 토큰당)
    assert.equal(usageUsd(GUSAGE, null, PRO), 0.13932);
    // 설정에서 가격을 고치면 그 값
    assert.equal(estimateUsd({ quality: 'high', size: '16:9@2K', promptTokens: 0, model: PRO, prices: { 'gemini-3-pro-image': { per_image: { '2K': 0.2 } } } }), 0.2);
  });
});

describe('OpenAI: 참고 사진으로 만들기 (/images/edits 에 image[] 여러 장)', () => {
  const ok = { json: { data: [{ b64_json: bytesToB64(JPG) }], usage: { input_tokens: 10, output_tokens: 10 } } };
  test('참고 사진이 있으면 새로 만들기도 edits 로, 넣은 순서대로 image[]', async () => {
    const f = fakeFetch(() => ok);
    const r = await openaiImage({ fetchImpl: f, key: 'sk', model: 'gpt-image-2.5-flare', prompt: 'p', size: '1280x960', quality: 'medium',
      images: [{ bytes: JPG, mime: 'image/jpeg', role: 'subject' }, { bytes: fx('tiny.png'), mime: 'image/png', role: 'style' }] });
    assert.equal(r.ok, true);
    assert.equal(f.calls[0].url, 'https://api.openai.com/v1/images/edits');
    const form = f.calls[0].init.body;
    assert.ok(form instanceof FormData);
    const imgs = form.getAll('image[]');
    assert.equal(imgs.length, 2);
    assert.deepEqual(imgs.map((x) => x.type), ['image/jpeg', 'image/png']);
    assert.equal(form.get('input_fidelity'), null, '모델 표가 지원한다고 할 때만 보냄');
    const g = fakeFetch(() => ok);
    await openaiImage({ fetchImpl: g, key: 'sk', model: 'gpt-image-2.5-flare', prompt: 'p', size: '1280x960', quality: 'medium', images: [{ bytes: JPG, mime: 'image/jpeg' }], inputFidelity: true });
    assert.equal(g.calls[0].init.body.get('input_fidelity'), 'high');
    const h = fakeFetch(() => ok);
    await openaiImage({ fetchImpl: h, key: 'sk', model: 'gpt-image-2.5-flare', prompt: 'p', size: '1280x960', quality: 'medium' });
    assert.equal(h.calls[0].url, 'https://api.openai.com/v1/images/generations', '참고 사진이 없으면 그대로');
  });
});

describe('생성 흐름 (runGeneration) — 공급자 나누기·참고 사진·수정 이력', () => {
  test('모르는 모델: 어떤 공급자도 부르지 않고 실패(청구 없음·횟수 안 셈) — OpenAI로 보내지 않음', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    const d = fakeDeps({ fetchImpl: f });
    const r = await runGeneration(d, { ...GEN, model: 'my-new-model' }, { keys: { openai: 'sk', gemini: 'g' } });
    assert.deepEqual([r.ok, r.code, f.calls.length], [false, 'model_unknown', 0]);
    const fin = d.log.rpc.find((x) => x.name === 'image_gen_fail').args.fin;
    assert.deepEqual([fin.provider_called, fin.cost_status], [false, '청구 없음']);
    assert.equal(modelCaps('my-new-model').provider, '', '모르는 모델은 공급자가 없음 (예전에는 openai 로 봤음)');
    assert.equal(estimateUsd({ quality: 'medium', size: '1024x1024', model: 'my-new-model' }), null);
  });
  test('Gemini: 참고 사진을 저장소에서 받아 같이 보내고, 공급자·사용량 비용·SynthID 안내·참고 사진·합성 여부·설계서를 저장', async () => {
    const f = fakeFetch(() => gemOk());
    const d = fakeDeps({ fetchImpl: f });
    const scene = { v: 1, type: 'photo', preset: 'product_still' };
    const r = await runGeneration(d, GEN, { keys: { gemini: 'g-key' }, refs: [{ path: 'upload/2026/10/ref.jpg', mime: 'image/jpeg', role: 'subject', id: 'ref-1', kind: 'upload' }],
      composite: true, scene, preset: 'product_still', description: '책상 위 제습기', ratio: '16:9' });
    assert.equal(r.ok, true);
    assert.deepEqual(d.log.download, ['upload/2026/10/ref.jpg']);
    assert.equal(JSON.parse(f.calls[0].init.body).contents[0].parts.length, 2);
    const save = d.log.rpc.find((x) => x.name === 'image_save').args;
    assert.equal(save.img.provider, 'gemini');
    assert.match(save.img.license, /Gemini API 약관.*SynthID/);
    assert.deepEqual(save.img.ref_images, [{ image_id: 'ref-1', role: 'subject', kind: 'upload' }]);
    assert.equal(save.img.composite, true);
    assert.deepEqual(save.img.scene, scene);
    assert.equal(save.img.preset, 'product_still');
    assert.equal(save.img.parent_image_id, '', '새로 만들기는 고친 원본 없음');
    assert.equal(save.fin.usage_usd, 0.13932);
  });
  test('참고 사진을 못 받으면 공급자를 부르지 않음 (청구 없음)', async () => {
    const f = fakeFetch(() => gemOk());
    const d = fakeDeps({ fetchImpl: f, download: () => ({ ok: false }) });
    const r = await runGeneration(d, GEN, { keys: { gemini: 'g' }, refs: [{ path: 'x', mime: 'image/jpeg', role: 'subject', id: 'r' }] });
    assert.deepEqual([r.code, f.calls.length], ['bad_ref_image', 0]);
    assert.equal(d.log.rpc.find((x) => x.name === 'image_gen_fail').args.fin.provider_called, false);
  });
  test('고치기: 고칠 이미지가 첫 장, 참고 사진이 그 뒤 — 원본을 덮어쓰지 않고 새 이미지에 원본 id(수정 이력)', async () => {
    const f = fakeFetch(() => ({ json: { data: [{ b64_json: bytesToB64(JPG) }], usage: { input_tokens: 10, output_tokens: 10 } } }));
    const d = fakeDeps({ fetchImpl: f, download: (p) => ({ ok: true, bytes: p === 'ai/base.jpg' ? JPG : fx('tiny.png') }) });
    const r = await runGeneration(d, { ...GEN, mode: 'edit', model: 'gpt-image-2.5-sunburst', size: '1280x960', quality: 'medium' },
      { keys: { openai: 'sk' }, base: { path: 'ai/base.jpg', mime: 'image/jpeg', id: 'base-1' }, refs: [{ path: 'up/ref.png', mime: 'image/png', role: 'style', id: 'ref-2', kind: 'upload' }] });
    assert.equal(r.ok, true);
    assert.deepEqual(d.log.download, ['ai/base.jpg', 'up/ref.png']);
    const imgs = f.calls[0].init.body.getAll('image[]');
    assert.deepEqual(imgs.map((x) => x.type), ['image/jpeg', 'image/png']);
    const save = d.log.rpc.find((x) => x.name === 'image_save').args;
    assert.equal(save.img.parent_image_id, 'base-1');
    assert.equal(d.log.upload.length, 1);
    assert.notEqual(d.log.upload[0].path, 'ai/base.jpg', '원본 경로에 덮어쓰지 않음');
  });
  test('예전 이름의 키(opt.key·opt.cf)도 받음, 점검용 가짜 모델은 그대로', async () => {
    const d = fakeDeps();
    const r = await runGeneration(d, { ...GEN, model: TEST_MODEL, size: '1280x960', quality: 'medium' }, {});
    assert.equal(r.ok, true);
    assert.equal(d.log.rpc.find((x) => x.name === 'image_save').args.fin.provider_called, false);
  });
});

describe('Cloudflare: 이미지 종류에 맞는 마지막 규칙, 글 모델 지시문이 사용 흔적·계절을 강제하지 않음', () => {
  const cfText = (t) => ({ json: { success: true, result: { response: t } } });
  const cfImg = () => ({ json: { success: true, result: { image: bytesToB64(JPG) } } });
  test('도식은 숫자·화살표만, 카드뉴스 배경은 빈 공간 — 사진은 예전 규칙 그대로', async () => {
    assert.match(cfRulesFor('diagram'), /icons, arrows and numerals only/);
    assert.match(cfRulesFor('card_bg'), /large empty area/);
    const f = fakeFetch((url) => (url.includes('llama') ? cfText('A simple flat diagram of air flowing through a dehumidifier') : cfImg()));
    await cloudflareImage({ fetchImpl: f, accountId: 'a', token: 't', model: 'cf-flux-2-klein-4b', prompt: 'BRIEF', quality: 'medium', size: '1024x768', type: 'diagram' });
    assert.ok(f.calls[1].init.body.get('prompt').endsWith(cfRulesFor('diagram')));
  });
  test('글 모델 지시문: 먼지·주름·어수선함·가운데 피하기를 강제하지 않고, 원고에 없는 계절·나라를 넣지 말라고', async () => {
    const f = fakeFetch((url) => (url.includes('llama') ? cfText('A product still life photo of a white dehumidifier on a wooden desk') : cfImg()));
    await cloudflareImage({ fetchImpl: f, accountId: 'a', token: 't', model: 'cf-flux-2-klein-4b', prompt: 'BRIEF', quality: 'medium', size: '1024x768' });
    const sys = JSON.parse(f.calls[0].init.body).messages[0].content;
    assert.ok(!/dust|creases|clutter|not perfectly centered|smartphone snapshot|Korean apartments or one-room/i.test(sys), sys);
    assert.match(sys, /do not add any season, weather, time of day, country or city/);
    assert.match(sys, /Follow the "Image type" line/);
  });
});

describe('AI 검수 (멀티모달) — 의견일 뿐, 근거·확신 정도와 함께', () => {
  test('지시문: 지시서 7번 항목 전부 + 참고 사진이 있을 때만 원본 비교, JSON 하나로', () => {
    const p = reviewPrompt({ slotText: '책상 위 제습기', goal: '제품 정물', ratio: '4:3', refs: 1, composite: true, crops: ['1:1'] });
    for (const [k] of REVIEW_CHECKS) assert.ok(p.includes(`- ${k}:`), k);
    assert.match(p, /unsure 로 두고 짐작으로 ok 를 주지 마/);
    const q = reviewPrompt({ slotText: 'x' });
    assert.ok(!q.includes('- ref_match:'), '참고 사진이 없으면 원본 비교 항목 없음');
  });
  test('답 읽기: 코드 블록 안 JSON도, 모르는 판정은 판단 어려움으로, 제안은 3개까지, 모양이 틀리면 null', () => {
    const r = parseReview('```json\n{"checks":{"match":{"verdict":"ok","reason":"맞아","confidence":0.83},"anatomy":{"verdict":"weird","reason":"?"}},"summary":"좋아","uncertainty":"작은 글자","suggestions":["a","b","c","d"]}\n```');
    assert.deepEqual(r.checks.match, { verdict: 'ok', reason: '맞아', confidence: 0.83 });
    assert.equal(r.checks.anatomy.verdict, 'unsure');
    assert.equal(r.checks.anatomy.confidence, null);
    assert.deepEqual(r.suggestions, ['a', 'b', 'c']);
    assert.equal(parseReview('그냥 괜찮아 보여요'), null);
    assert.equal(parseReview('{"summary":"x"}'), null);
  });
  test('요청 모양: OpenAI(Responses, input_image 데이터 주소) · Gemini(JSON 답) · Cloudflare(무료, messages)', async () => {
    const ans = '{"checks":{"match":{"verdict":"ok","reason":"r","confidence":0.5}},"summary":"s","uncertainty":"","suggestions":[]}';
    const o = fakeFetch(() => ({ json: { output_text: ans, usage: { input_tokens: 1500, output_tokens: 300 } } }));
    const ro = await visionReview({ fetchImpl: o, keys: { openai: 'sk' }, model: 'gpt-5.6-luna', prompt: 'P', images: [{ bytes: JPG, mime: 'image/jpeg' }] });
    assert.equal(ro.ok, true);
    assert.equal(o.calls[0].url, 'https://api.openai.com/v1/responses');
    const ob = JSON.parse(o.calls[0].init.body);
    assert.equal(ob.model, 'gpt-5.6-luna');
    assert.equal(ob.input[0].content[1].type, 'input_image');
    assert.equal(ob.input[0].content[1].detail, 'low', '이미지 토큰을 적게 (가격표의 계산 규칙과 같게)');
    assert.ok(ob.input[0].content[1].image_url.startsWith('data:image/jpeg;base64,'));
    const g = fakeFetch(() => ({ json: { candidates: [{ content: { parts: [{ text: ans }] } }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 300 } } }));
    const rg = await visionReview({ fetchImpl: g, keys: { gemini: 'gk' }, model: 'gemini-3.5-flash-lite', prompt: 'P', images: [{ bytes: JPG, mime: 'image/jpeg' }] });
    assert.equal(rg.ok, true);
    assert.equal(g.calls[0].url, `${GEMINI_URL}/models/gemini-3.5-flash-lite:generateContent`);
    assert.equal(JSON.parse(g.calls[0].init.body).generationConfig.responseMimeType, 'application/json');
    const c = fakeFetch(() => ({ json: { success: true, result: { response: ans } } }));
    const rc = await visionReview({ fetchImpl: c, keys: { cf: { accountId: 'acc', token: 't' } }, model: 'cf-gemma-4-26b', prompt: 'P', images: [{ bytes: JPG, mime: 'image/jpeg' }] });
    assert.equal(rc.ok, true);
    assert.match(c.calls[0].url, /\/ai\/run\/@cf\/google\/gemma-4-26b-a4b-it$/);
    assert.equal(JSON.parse(c.calls[0].init.body).messages[0].content[1].type, 'image_url');
    assert.equal(parseReview(rc.text).summary, 's');
    // 새 모델은 OpenAI 채팅 모양(choices)으로 답하기도 해서 둘 다 읽음
    const c2 = fakeFetch(() => ({ json: { success: true, result: { choices: [{ message: { content: ans } }], usage: { prompt_tokens: 10 } } } }));
    const rc2 = await visionReview({ fetchImpl: c2, keys: { cf: { accountId: 'acc', token: 't' } }, model: 'cf-gemma-4-26b', prompt: 'P', images: [{ bytes: JPG, mime: 'image/jpeg' }] });
    assert.equal(parseReview(rc2.text).summary, 's');
    assert.equal((await visionReview({ fetchImpl: c, keys: {}, model: 'gpt-5.6-luna', prompt: 'P', images: [] })).code, 'openai_key_missing');
    assert.equal((await visionReview({ fetchImpl: c, keys: {}, model: 'gemini-3.5-flash-lite', prompt: 'P', images: [] })).code, 'gemini_key_missing');
    assert.equal((await visionReview({ fetchImpl: c, keys: {}, model: 'nope', prompt: 'P', images: [] })).code, 'review_model_unknown');
    assert.equal((await visionReview({ fetchImpl: c, keys: {}, model: 'gpt-5-mini', prompt: 'P', images: [] })).code, 'review_model_unknown', '지원 종료 예정이라 뺀 모델');
  });
  test('검수 비용: 무료 모델 0, 유료는 사용량 × 가격 (예상치는 따로)', () => {
    assert.equal(reviewUsageUsd('cf-gemma-4-26b', { a: 1 }), 0);
    // 입력 1000 × $0.30 + 출력 400 × $2.50 (100만 토큰당)
    assert.equal(reviewUsageUsd('gemini-3.5-flash-lite', { promptTokenCount: 1000, candidatesTokenCount: 400 }), 0.0013);
    // 생각 토큰도 출력 값으로
    assert.equal(reviewUsageUsd('gemini-3.5-flash-lite', { promptTokenCount: 1000, candidatesTokenCount: 400, thoughtsTokenCount: 100 }), 0.00155);
    // 입력 1000 × $0.20 + 출력 500 × $1.20
    assert.equal(reviewUsageUsd('gpt-5.6-luna', { input_tokens: 1000, output_tokens: 500 }), 0.0008);
    assert.equal(reviewUsageUsd('gemini-3.5-flash-lite', null), null);
    assert.equal(estimateReviewUsd('cf-gemma-4-26b', 2), 0);
    // 예상: (이미지 1장 1,120 + 지시문 900) × $0.30 + 답 1,000 × $2.50
    assert.equal(estimateReviewUsd('gemini-3.5-flash-lite', 1), roundUsd((2020 * 0.3 + 1000 * 2.5) / 1e6));
    // 예상: (이미지 2장 × 308 + 900) × $0.20 + 답 1,000 × $1.20
    assert.equal(estimateReviewUsd('gpt-5.6-luna', 2), roundUsd((1516 * 0.2 + 1000 * 1.2) / 1e6));
    assert.equal(estimateReviewUsd('nope', 1), null);
  });
});

describe('연결 확인 — 만들지 않고 키·모델만 물어봄 (돈 안 듦)', () => {
  test('OpenAI·Gemini 는 모델 정보 조회, Cloudflare 는 모델 찾기 — 생성 주소는 부르지 않음', async () => {
    const o = fakeFetch(() => ({ json: { id: 'gpt-image-2.5-flare' } }));
    const ro = await providerCheck({ fetchImpl: o, provider: 'openai', keys: { openai: 'sk' }, model: 'gpt-image-2.5-flare' });
    assert.equal(ro.ok, true);
    assert.equal(o.calls[0].url, 'https://api.openai.com/v1/models/gpt-image-2.5-flare');
    assert.equal(o.calls[0].init.method, undefined, 'GET');
    const g = fakeFetch(() => ({ status: 400, json: { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid.' } } }));
    const rg = await providerCheck({ fetchImpl: g, provider: 'gemini', keys: { gemini: 'bad' }, model: PRO });
    assert.deepEqual([rg.ok, rg.code], [false, 'gemini_key_invalid']);
    assert.equal(g.calls[0].url, `${GEMINI_URL}/models/${PRO}`);
    assert.equal(g.calls[0].init.headers['x-goog-api-key'], 'bad');
    const c = fakeFetch(() => ({ json: { success: true, result: [{ name: '@cf/black-forest-labs/flux-2-klein-4b' }] } }));
    const rc = await providerCheck({ fetchImpl: c, provider: 'cloudflare', keys: { cf: { accountId: 'acc', token: 't' } }, model: '@cf/black-forest-labs/flux-2-klein-4b' });
    assert.equal(rc.ok, true);
    assert.match(c.calls[0].url, /\/accounts\/acc\/ai\/models\/search\?search=flux-2-klein-4b$/);
    for (const call of [...o.calls, ...g.calls, ...c.calls]) assert.ok(!/generations|edits|generateContent|\/ai\/run\//.test(call.url), call.url);
    assert.equal((await providerCheck({ fetchImpl: c, provider: 'gemini', keys: {}, model: PRO })).code, 'gemini_key_missing');
  });
});

test('서버 일꾼 시간: Gemini는 해상도별로 넉넉히', () => {
  assert.equal(needMsFor('max', 'generate', 150000, 'gemini'), 115000);
  assert.equal(needMsFor('medium', 'generate', 150000, 'gemini'), 75000);
  assert.equal(needMsFor('medium', 'generate', 150000), 75000);
});

describe('추가 확인: 무료 모델 참고 사진·Gemini 402·한 번에 보내는 크기·종료된 모델·참고 사진 수', () => {
  const cfOk = (url) => (url.includes('llama') ? { json: { success: true, result: { response: 'A white dehumidifier on a wooden desk' } } } : { json: { success: true, result: { image: bytesToB64(JPG) } } });
  test('FLUX.2 klein: 참고 사진은 input_image_0.. 로, 4장 넘거나 512px 이상이면 부르기 전에 거절 (schnell 은 못 받음)', async () => {
    const small = fx('tiny.jpg'); // 64x48
    const f = fakeFetch(cfOk);
    const r = await cloudflareImage({ fetchImpl: f, accountId: 'a', token: 't', model: 'cf-flux-2-klein-4b', prompt: 'B', quality: 'medium', size: '1024x768',
      images: [{ bytes: small, mime: 'image/jpeg' }, { bytes: fx('tiny.png'), mime: 'image/png' }] });
    assert.equal(r.ok, true);
    const form = f.calls[1].init.body;
    assert.deepEqual([form.get('input_image_0').type, form.get('input_image_1').type, form.get('input_image_2')], ['image/jpeg', 'image/png', null]);
    assert.deepEqual([form.get('width'), form.get('height')], ['1024', '768']);
    const g = fakeFetch(() => ({ json: {} }));
    const five = Array.from({ length: 5 }, () => ({ bytes: small, mime: 'image/jpeg' }));
    assert.equal((await cloudflareImage({ fetchImpl: g, accountId: 'a', token: 't', model: 'cf-flux-2-klein-4b', prompt: 'B', size: '1024x768', images: five })).code, 'refs_unsupported');
    assert.equal((await cloudflareImage({ fetchImpl: g, accountId: 'a', token: 't', model: 'cf-flux-2-klein-4b', prompt: 'B', size: '1024x768', images: [{ bytes: JPG, mime: 'image/jpeg' }] })).code, 'ref_small_missing', '1280x960 원본은 못 보냄');
    assert.equal((await cloudflareImage({ fetchImpl: g, accountId: 'a', token: 't', model: 'cf-flux-1-schnell', prompt: 'B', size: '1024x1024', images: [{ bytes: small, mime: 'image/jpeg' }] })).code, 'refs_unsupported', 'schnell 은 참고 사진 못 받음');
    assert.equal(g.calls.length, 0);
  });
  test('생성 흐름(무료 모델): 저장소의 작은 사본(small)만 받아 JPEG로 보내고 원본 경로는 안 받음 — 결과는 청구 없음, 사본이 없으면 공급자를 안 부름', async () => {
    const f = fakeFetch(cfOk);
    const d = fakeDeps({ fetchImpl: f, download: (p) => ({ ok: true, bytes: p.startsWith('small/') ? fx('tiny.jpg') : JPG }) });
    const r = await runGeneration(d, { ...GEN, model: 'cf-flux-2-klein-4b', size: '1024x768', quality: 'medium' },
      { keys: { cf: { accountId: 'a', token: 't' } }, refs: [{ path: 'up/a.png', small: 'small/2026/10/a.jpg', mime: 'image/png', role: 'subject', id: 'r1', kind: 'upload' }], composite: true, type: 'photo' });
    assert.equal(r.ok, true);
    assert.deepEqual(d.log.download, ['small/2026/10/a.jpg']);
    assert.equal(f.calls[1].init.body.get('input_image_0').type, 'image/jpeg', '작은 사본은 JPEG');
    const save = d.log.rpc.find((x) => x.name === 'image_save').args;
    assert.deepEqual([save.fin.cost_status, save.fin.usage_usd, save.img.provider, save.img.composite], ['청구 없음', 0, 'cloudflare', true]);
    const g = fakeFetch(() => ({ json: {} }));
    const d2 = fakeDeps({ fetchImpl: g });
    const r2 = await runGeneration(d2, { ...GEN, model: 'cf-flux-2-klein-4b', size: '1024x768', quality: 'medium' },
      { keys: { cf: { accountId: 'a', token: 't' } }, refs: [{ path: 'up/a.jpg', small: '', mime: 'image/jpeg', role: 'subject', id: 'r1' }] });
    assert.deepEqual([r2.code, g.calls.length, d2.log.download.length], ['bad_ref_image', 0, 0]);
  });
  test('Gemini: 402(미리 낸 크레딧 다 씀)는 한도 오류·청구 없음, 한 번에 보낼 크기(약 18MB)를 넘으면 부르기 전에 거절', async () => {
    const e = classifyGeminiError(402, { error: { status: 'PAYMENT_REQUIRED', message: 'prepay credits depleted' } });
    assert.deepEqual([e.code, e.billed], ['gemini_quota', 'no']);
    const big = new Uint8Array(14 * 1024 * 1024); // base64 로 4/3 → 약 18.7MB
    const f = fakeFetch(() => gemOk());
    const r = await geminiImage({ fetchImpl: f, key: 'k', model: PRO, prompt: 'p', size: '1:1@1K', images: [{ bytes: big, mime: 'image/jpeg' }] });
    assert.deepEqual([r.code, r.billed, f.calls.length], ['refs_too_big', 'no', 0]);
    assert.ok(NOT_COUNTED.has('refs_too_big') && NOT_COUNTED.has('gemini_quota'));
  });
  test('종료된 모델(gpt-image-1)은 어느 공급자도 부르지 않고 실패 (청구 없음·횟수 안 셈)', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    const d = fakeDeps({ fetchImpl: f });
    const r = await runGeneration(d, { ...GEN, model: 'gpt-image-1', size: '1024x1024', quality: 'medium' }, { keys: { openai: 'sk' } });
    assert.deepEqual([r.ok, r.code, f.calls.length], [false, 'model_retired', 0]);
    const fin = d.log.rpc.find((x) => x.name === 'image_gen_fail').args.fin;
    assert.deepEqual([fin.provider_called, fin.cost_status], [false, '청구 없음']);
  });
  test('참고 사진 수: 모델마다 다르고, 고치기면 고칠 이미지가 한 장을 씀', () => {
    assert.deepEqual([refsLimit('gpt-image-2.5-flare', 'generate'), refsLimit('gpt-image-2.5-sunburst', 'edit')], [16, 15]);
    assert.deepEqual([refsLimit('gemini-3-pro-image', 'generate'), refsLimit('gemini-3-pro-image', 'edit')], [6, 5]);
    assert.deepEqual([refsLimit('gemini-nano-banana-2.1', 'generate'), refsLimit('cf-flux-2-klein-4b', 'generate'), refsLimit('cf-flux-2-klein-4b', 'edit')], [10, 4, 3]);
    assert.deepEqual([refsLimit('cf-flux-1-schnell', 'generate'), refsLimit('my-new-model', 'generate')], [0, 0]);
  });
});
