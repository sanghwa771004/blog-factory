// 서버 이미지 흐름(image_service.js) 테스트 — OpenAI·Pexels·저장소·DB를 가짜로 바꿔 끼워서 확인 (실제 API는 부르지 않음)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyOpenAIError, openaiImage, normalizePexels, pexelsSearch, pexelsPhoto, downloadImage, runGeneration, saveStockPhoto, saveUploaded,
  storagePath, bytesToB64, b64ToBytes, sha256Hex, scrub, TEST_MODEL, NOT_COUNTED, needMsFor, busyRetryAfter,
} from '../supabase/functions/blog-app/image_service.js';
import { sniffImage } from '../images.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name) => new Uint8Array(readFileSync(join(ROOT, 'tests', 'fixtures', 'img', name)));
const has = (b, s) => Buffer.from(b).includes(Buffer.from(s));

// 가짜 fetch: 부른 주소·내용을 기록하고, 정해둔 답을 돌려줌
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = await handler(String(url), init, calls.length);
    const headers = new Map(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return {
      ok: (r.status || 200) < 400, status: r.status || 200,
      headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
      json: async () => { if (r.json === undefined) throw new Error('no json'); return r.json; },
      arrayBuffer: async () => (r.bytes || new Uint8Array()).buffer.slice(0),
    };
  };
  f.calls = calls;
  return f;
}
const USAGE = { input_tokens: 120, input_tokens_details: { text_tokens: 120, image_tokens: 0 }, output_tokens: 349, total_tokens: 469 };
const okImage = (bytes = fx('photo-4x3.jpg')) => ({ json: { data: [{ b64_json: bytesToB64(bytes), revised_prompt: 'r' }], usage: USAGE, output_format: 'jpeg' }, headers: { 'x-request-id': 'req_123' } });

// 가짜 DB·저장소
function fakeDeps(over = {}) {
  const log = { rpc: [], upload: [], remove: [], download: [], calls: [] };
  const d = {
    log,
    rpc: async (name, args) => {
      log.rpc.push({ name, args });
      if (over.rpc) { const r = await over.rpc(name, args); if (r) return r; }
      if (name === 'image_save') return { data: { image: { id: 'img-1', ...args.img }, slot: args.link ? { ...args.link, image_id: 'img-1' } : null, generation: args.gen ? { id: args.gen, status: '성공' } : null }, error: null };
      if (name === 'image_gen_fail') return { data: { id: args.gen, status: '실패', ...args.fin }, error: null };
      if (name === 'image_slot_upsert') return { data: { ...args.p }, error: null };
      return { data: null, error: null };
    },
    upload: async (path, bytes, mime, o) => { log.upload.push({ path, bytes, mime, o }); return over.upload ? over.upload(path, bytes, mime, o) : { error: null }; },
    remove: async (paths) => { log.remove.push(paths); return { error: null }; },
    download: async (path) => { log.download.push(path); return over.download ? over.download(path) : { ok: true, bytes: fx('photo-4x3.jpg') }; },
    findImage: async (q) => (over.findImage ? over.findImage(q) : null),
    logCall: async (p, k, s) => { log.calls.push([p, k, s]); },
    fetchImpl: over.fetchImpl || fakeFetch(() => ({ status: 500, json: {} })),
    now: () => new Date('2026-10-22T05:00:00Z'),
    uuid: () => '11111111-2222-4333-8444-555555555555',
  };
  return d;
}
const GEN = { id: 'gen-1', mode: 'generate', model: 'gpt-image-2.5-flare', prompt: 'P', size: '1280x960', quality: 'medium', output_format: 'jpeg', post_id: 'post-1', slot_key: 'k:a#1', slot_index: 0, slot_text: '작은 원룸 사진', user_prompt: '', style: 'life_photo', purpose: 'blog_body' };
const PRICES = { image_output_per_m: 30, image_input_per_m: 8, text_input_per_m: 5 };

describe('OpenAI 오류 나누기 (자동 재시도 금지 대상·청구 여부)', () => {
  test('키·조직 인증·모델·잔액·속도 제한·안전 검사·서버 오류', () => {
    const c = (s, b) => classifyOpenAIError(s, b);
    assert.equal(c(401, {}).code, 'openai_key_invalid');
    assert.equal(c(403, { error: { message: 'Your organization must be verified to use the model' } }).code, 'openai_org_unverified');
    assert.equal(c(404, { error: { code: 'model_not_found' } }).code, 'model_unavailable');
    assert.equal(c(400, { error: { message: 'Invalid model: gpt-image-x does not exist' } }).code, 'model_unavailable');
    const q = c(429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } });
    assert.deepEqual([q.code, q.billed, q.retryable], ['openai_quota', 'no', false]);
    assert.equal(c(429, { error: { message: 'Rate limit reached' } }).code, 'openai_rate_limited');
    // OpenAI 'Spend limits' 문서의 오류 코드 (2026-10-22): 직접 걸어둔 한 달 한도 → 기다려도 안 풀림, 다시 시도 안내 안 함
    for (const code of ['organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded']) {
      const sl = c(429, { error: { code, message: 'You have reached your spend limit.' } });
      assert.deepEqual([sl.code, sl.billed, sl.retryable], ['openai_spend_limit', 'no', false], code);
    }
    assert.equal(c(429, { error: { code: 'credit_balance_exhausted', message: 'Your credit balance is too low.' } }).code, 'openai_quota');
    const mi = c(400, { error: { code: 'moderation_blocked', type: 'image_generation_user_error', moderation_details: { moderation_stage: 'input' } } });
    assert.deepEqual([mi.code, mi.billed, mi.retryable], ['moderation_blocked', 'no', false]);
    assert.equal(c(400, { error: { code: 'moderation_blocked', moderation_details: { moderation_stage: 'output' } } }).billed, 'maybe', '만든 뒤에 걸리면 청구됐을 수 있음');
    assert.deepEqual([c(503, {}).code, c(503, {}).billed], ['openai_server', 'maybe']);
    // 모델은 되는데 크기·품질을 못 받는 경우는 '모델을 바꿔줘'가 아니라 크기·품질 문제로 (리뷰 지적: 헛도는 안내)
    assert.equal(c(400, { error: { message: 'Invalid size' } }).code, 'openai_unsupported_option');
    const uq = c(400, { error: { message: "Invalid value for 'quality': 'xhigh' is not supported for model gpt-image-1.", param: 'quality', code: 'invalid_value' } });
    assert.deepEqual([uq.code, uq.param, uq.billed, uq.retryable], ['openai_unsupported_option', 'quality', 'no', false]);
    assert.equal(c(400, { error: { message: "Invalid size '1280x960'. Supported sizes are 1024x1024, 1024x1536, 1536x1024 for this model." } }).param, 'size');
    assert.equal(c(400, { error: { message: 'The model `gpt-image-x` does not exist.' } }).code, 'model_unavailable');
    assert.equal(c(400, { error: { message: 'bad', param: 'model' } }).code, 'model_unavailable');
    assert.equal(c(400, { error: { message: 'Prompt is too long' } }).code, 'openai_bad_request');
  });
  test('오류 문구에 키가 섞여 와도 가림', () => {
    const r = classifyOpenAIError(403, { error: { message: 'Incorrect API key provided: sk-proj-abcdefghijklmnop1234567890' } });
    assert.ok(!r.message.includes('sk-proj'), r.message);
    assert.equal(scrub('x'.repeat(50)), '[가림]');
  });
  test('만들기 전에 거절된 오류만 하루 횟수에서 뺌', () => {
    for (const k of ['openai_quota', 'openai_spend_limit', 'model_unavailable', 'openai_unsupported_option', 'openai_key_invalid', 'openai_rate_limited', 'server_busy_late']) assert.ok(NOT_COUNTED.has(k), k);
    for (const k of ['moderation_blocked', 'openai_timeout', 'openai_server', 'storage_failed']) assert.ok(!NOT_COUNTED.has(k), k);
  });
});

describe('OpenAI 호출 (가짜 fetch)', () => {
  test('생성: 공식 문서 형식 (POST /v1/images/generations, Bearer 키, 모델·크기·품질·형식·1장·안전 식별자)', async () => {
    const f = fakeFetch(() => okImage());
    const r = await openaiImage({ fetchImpl: f, key: 'sk-test', model: 'gpt-image-2.5-flare', prompt: 'P', size: '1280x960', quality: 'medium', safetyId: 'abc' });
    assert.equal(r.ok, true);
    assert.equal(r.requestId, 'req_123');
    assert.deepEqual(r.usage, USAGE);
    const { url, init } = f.calls[0];
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer sk-test');
    const body = JSON.parse(init.body);
    assert.deepEqual(body, { model: 'gpt-image-2.5-flare', prompt: 'P', size: '1280x960', quality: 'medium', output_format: 'jpeg', n: 1, moderation: 'auto', output_compression: 90, safety_identifier: 'abc' });
  });
  test('편집: POST /v1/images/edits, multipart 로 image[] 파일과 함께', async () => {
    const f = fakeFetch(() => okImage());
    const r = await openaiImage({ fetchImpl: f, key: 'sk-test', mode: 'edit', model: 'gpt-image-2.5-sunburst', prompt: 'E', size: '1024x1024', quality: 'high', image: { bytes: fx('tiny.png'), mime: 'image/png' } });
    assert.equal(r.ok, true);
    const { url, init } = f.calls[0];
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get('model'), 'gpt-image-2.5-sunburst');
    assert.equal(init.body.get('quality'), 'high');
    const file = init.body.get('image[]');
    assert.equal(file.type, 'image/png');
    assert.equal(file.size, fx('tiny.png').length);
    assert.equal(init.headers['Content-Type'], undefined, 'multipart 경계는 fetch가 붙임');
  });
  test('키 없음·시간 초과·빈 응답·점검용 가짜 모델', async () => {
    assert.equal((await openaiImage({ fetchImpl: fakeFetch(() => okImage()), key: '', model: 'm', prompt: 'p' })).code, 'openai_key_missing');
    const slow = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const t = await openaiImage({ fetchImpl: slow, key: 'k', model: 'm', prompt: 'p', timeoutMs: 30 });
    assert.deepEqual([t.code, t.billed], ['openai_timeout', 'maybe']);
    const empty = await openaiImage({ fetchImpl: fakeFetch(() => ({ json: { data: [] } })), key: 'k', model: 'm', prompt: 'p' });
    assert.equal(empty.code, 'openai_empty');
    const f = fakeFetch(() => okImage());
    const fake = await openaiImage({ fetchImpl: f, key: '', model: TEST_MODEL, prompt: 'p' });
    assert.equal(fake.ok, true);
    assert.equal(fake.test, true);
    assert.equal(f.calls.length, 0, '가짜 모델은 OpenAI를 부르지 않음');
    assert.equal(sniffImage(b64ToBytes(fake.b64)).mime, 'image/jpeg');
  });
});

describe('Pexels (가짜 fetch)', () => {
  const photo = { id: 2014422, width: 3024, height: 3024, url: 'https://www.pexels.com/photo/2014422/', photographer: 'Joey Farina', photographer_url: 'https://www.pexels.com/@joey', avg_color: '#978E82', alt: 'Brown rocks during golden hour',
    src: { original: 'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg', large2x: 'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940', large: 'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', medium: 'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?auto=compress&cs=tinysrgb&h=350' } };
  test('응답 정리: Pexels 주소만, 주소는 받은 그대로', () => {
    const n = normalizePexels(photo);
    assert.equal(n.download, photo.src.large2x, '크기를 바꾸려고 주소를 고치지 않음');
    assert.equal(n.thumb, photo.src.medium);
    assert.equal(n.photographer, 'Joey Farina');
    assert.equal(normalizePexels({ ...photo, src: { ...photo.src, large2x: 'https://evil.example/x.jpg', large: '', original: '' } }), null, '다른 곳 주소면 버림');
    assert.equal(normalizePexels({ ...photo, url: 'javascript:alert(1)' }), null);
  });
  test('검색: Authorization 머리글에 키, 한글이면 ko-KR, 방향, 남은 횟수', async () => {
    const f = fakeFetch(() => ({ json: { photos: [photo, { id: 'x' }], total_results: 1, page: 1, next_page: 'n' }, headers: { 'X-Ratelimit-Remaining': '19990' } }));
    const r = await pexelsSearch({ fetchImpl: f, key: 'PX', query: '원룸 책상', orientation: 'landscape' });
    assert.equal(r.ok, true);
    assert.equal(r.photos.length, 1, '형식이 이상한 결과는 뺌');
    assert.equal(r.remaining, 19990);
    assert.equal(r.hasNext, true);
    const u = new URL(f.calls[0].url);
    assert.equal(u.origin + u.pathname, 'https://api.pexels.com/v1/search');
    assert.equal(u.searchParams.get('locale'), 'ko-KR');
    assert.equal(u.searchParams.get('orientation'), 'landscape');
    assert.equal(f.calls[0].init.headers.Authorization, 'PX');
    assert.equal((await pexelsSearch({ fetchImpl: fakeFetch(() => ({ status: 429, json: {} })), key: 'PX', query: 'a' })).code, 'pexels_rate_limited');
    assert.equal((await pexelsSearch({ fetchImpl: fakeFetch(() => ({ status: 401, json: {} })), key: 'PX', query: 'a' })).code, 'pexels_key_invalid');
    assert.equal((await pexelsSearch({ fetchImpl: f, key: '', query: 'a' })).code, 'pexels_key_missing');
    const one = await pexelsPhoto({ fetchImpl: fakeFetch(() => ({ json: photo })), key: 'PX', id: 2014422 });
    assert.equal(one.photo.id, 2014422);
  });
  test('내려받기: 허용한 주소만, 크기 제한, 넘겨주는 주소(redirect)는 따라가지 않음', async () => {
    const f = fakeFetch(() => ({ bytes: fx('tiny.jpg') }));
    assert.equal((await downloadImage({ fetchImpl: f, url: 'https://evil.example/a.jpg', hosts: ['images.pexels.com'], maxBytes: 1e6 })).code, 'bad_source');
    assert.equal((await downloadImage({ fetchImpl: f, url: 'http://images.pexels.com/a.jpg', hosts: ['images.pexels.com'], maxBytes: 1e6 })).code, 'bad_source', 'https만');
    const ok = await downloadImage({ fetchImpl: f, url: 'https://images.pexels.com/a.jpg', hosts: ['images.pexels.com'], maxBytes: 1e6 });
    assert.equal(ok.ok, true);
    assert.equal(f.calls[0].init.redirect, 'error');
    assert.equal((await downloadImage({ fetchImpl: f, url: 'https://images.pexels.com/a.jpg', hosts: ['images.pexels.com'], maxBytes: 10 })).code, 'too_big');
    const big = fakeFetch(() => ({ bytes: new Uint8Array(5), headers: { 'content-length': '99999999' } }));
    assert.equal((await downloadImage({ fetchImpl: big, url: 'https://images.pexels.com/a.jpg', hosts: ['images.pexels.com'], maxBytes: 1000 })).code, 'too_big');
  });
});

describe('AI 생성 흐름 (생성 → 저장소 → 기록)', () => {
  test('성공: 저장소에 올리고, 보관함·생성 기록에 사용량 기준 비용과 함께 저장 (자리 연결은 사용자가 고른 뒤)', async () => {
    const d = fakeDeps({ fetchImpl: fakeFetch(() => okImage()) });
    const r = await runGeneration(d, GEN, { key: 'sk', prices: PRICES, safetyId: 's', description: '작은 원룸 사진' });
    assert.equal(r.ok, true);
    assert.equal(d.log.upload.length, 1);
    assert.equal(d.log.upload[0].path, 'ai/2026/10/11111111-2222-4333-8444-555555555555.jpg');
    assert.equal(d.log.upload[0].mime, 'image/jpeg');
    const save = d.log.rpc.find((x) => x.name === 'image_save').args;
    assert.equal(save.gen, 'gen-1');
    assert.equal(save.link, null);
    assert.equal(save.img.kind, 'ai');
    assert.equal(save.img.width, 1280);
    assert.equal(save.img.origin_slot_key, 'k:a#1');
    assert.equal(save.img.alt_text, '작은 원룸');
    assert.equal(save.img.sha256, await sha256Hex(fx('photo-4x3.jpg')));
    assert.equal(save.fin.usage_usd, 0.01107, '텍스트 120토큰×$5 + 출력 349토큰×$30 (100만 토큰당)');
    assert.equal(save.fin.request_id, 'req_123');
    assert.ok(!d.log.rpc.some((x) => x.name === 'image_gen_fail'));
  });
  test('잔액 부족: 실패로 기록, 청구 없음, 하루 횟수에 안 셈, 저장소에 아무것도 안 올림', async () => {
    const d = fakeDeps({ fetchImpl: fakeFetch(() => ({ status: 429, json: { error: { code: 'insufficient_quota', message: 'quota' } } })) });
    const r = await runGeneration(d, GEN, { key: 'sk', prices: PRICES });
    assert.deepEqual([r.ok, r.code, r.retryable], [false, 'openai_quota', false]);
    const fin = d.log.rpc.find((x) => x.name === 'image_gen_fail').args.fin;
    assert.deepEqual([fin.provider_called, fin.cost_status, fin.error_code], [false, '청구 없음', 'openai_quota']);
    assert.equal(d.log.upload.length, 0);
  });
  test('시간 초과·안전 검사(만든 뒤): 청구됐을 수 있음(확인 필요), 횟수에 셈', async () => {
    const slow = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const d = fakeDeps({ fetchImpl: slow });
    const r = await runGeneration(d, GEN, { key: 'sk', prices: PRICES, timeoutMs: 20 });
    assert.equal(r.code, 'openai_timeout');
    const fin = d.log.rpc.find((x) => x.name === 'image_gen_fail').args.fin;
    assert.deepEqual([fin.provider_called, fin.cost_status], [true, '확인 필요']);
    const d2 = fakeDeps({ fetchImpl: fakeFetch(() => ({ status: 400, json: { error: { code: 'moderation_blocked', moderation_details: { moderation_stage: 'output' } } } })) });
    const r2 = await runGeneration(d2, GEN, { key: 'sk' });
    assert.equal(r2.code, 'moderation_blocked');
    assert.equal(d2.log.rpc.find((x) => x.name === 'image_gen_fail').args.fin.cost_status, '확인 필요');
  });
  test('저장소가 두 번 다 실패하면: 사용량 비용을 남기고 확인 필요로 실패 기록', async () => {
    const d = fakeDeps({ fetchImpl: fakeFetch(() => okImage()), upload: () => ({ error: { message: 'down' } }) });
    const r = await runGeneration(d, GEN, { key: 'sk', prices: PRICES });
    assert.equal(r.code, 'storage_failed');
    assert.equal(d.log.upload.length, 2, '한 번 더 시도');
    const fin = d.log.rpc.find((x) => x.name === 'image_gen_fail').args.fin;
    assert.deepEqual([fin.cost_status, fin.usage_usd, fin.provider_called], ['확인 필요', 0.01107, true]);
  });
  test('이미지가 아닌 응답·기록 실패: 실패로 정리하고 올린 파일은 지움', async () => {
    const bad = fakeDeps({ fetchImpl: fakeFetch(() => ({ json: { data: [{ b64_json: bytesToB64(fx('fake.jpg')) }], usage: USAGE } })) });
    assert.equal((await runGeneration(bad, GEN, { key: 'sk' })).code, 'openai_bad_image');
    assert.equal(bad.log.upload.length, 0);
    const d = fakeDeps({ fetchImpl: fakeFetch(() => okImage()), rpc: (name) => (name === 'image_save' ? { data: null, error: { message: 'boom' } } : null) });
    const r = await runGeneration(d, GEN, { key: 'sk' });
    assert.equal(r.code, 'save_failed');
    assert.deepEqual(d.log.remove, [[d.log.upload[0].path]]);
  });
  test('편집: 저장소에서 원본을 받아 같이 보냄, 원본을 못 받으면 OpenAI를 부르지 않음(횟수에 안 셈)', async () => {
    const f = fakeFetch(() => okImage());
    const d = fakeDeps({ fetchImpl: f });
    const r = await runGeneration(d, { ...GEN, mode: 'edit', model: 'gpt-image-2.5-sunburst' }, { key: 'sk', base: { path: 'ai/2026/10/base.jpg', mime: 'image/jpeg' } });
    assert.equal(r.ok, true);
    assert.deepEqual(d.log.download, ['ai/2026/10/base.jpg']);
    assert.equal(f.calls[0].url, 'https://api.openai.com/v1/images/edits');
    const f2 = fakeFetch(() => okImage());
    const d2 = fakeDeps({ fetchImpl: f2, download: () => ({ ok: false }) });
    const r2 = await runGeneration(d2, { ...GEN, mode: 'edit' }, { key: 'sk', base: { path: 'x', mime: 'image/jpeg' } });
    assert.equal(r2.code, 'bad_base_image');
    assert.equal(f2.calls.length, 0);
    assert.equal(d2.log.rpc.find((x) => x.name === 'image_gen_fail').args.fin.provider_called, false);
  });
  test('점검용 가짜 모델: 키 없이 흐름만 확인, 비용 0', async () => {
    const d = fakeDeps();
    const r = await runGeneration(d, { ...GEN, model: TEST_MODEL }, { key: '', prices: PRICES });
    assert.equal(r.ok, true);
    assert.equal(r.test, true);
    const save = d.log.rpc.find((x) => x.name === 'image_save').args;
    // 점검용은 청구 없음·하루 횟수에 안 셈, OpenAI 이미지로 보이지 않게 표시 (리뷰 지적)
    assert.deepEqual([save.fin.usage_usd, save.fin.cost_status, save.fin.provider_called], [0, '청구 없음', false]);
    assert.deepEqual([save.img.provider, save.img.model], ['', TEST_MODEL]);
    assert.match(save.img.license, /점검용 시험 이미지/);
  });
  test('서버 일꾼이 곧 꺼지면 OpenAI를 부르지 않고 실패(청구 없음·횟수에 안 셈), 남은 시간으로 시간 제한', async () => {
    const f = fakeFetch(() => okImage());
    const d = fakeDeps({ fetchImpl: f });
    const late = await runGeneration(d, GEN, { key: 'sk', prices: PRICES, deadline: d.now().getTime() + 5000 });
    assert.equal(late.code, 'server_busy_late');
    assert.equal(f.calls.length, 0, 'OpenAI 안 부름');
    const fin = d.log.rpc.find((x) => x.name === 'image_gen_fail').args.fin;
    assert.deepEqual([fin.provider_called, fin.cost_status], [false, '청구 없음']);
    // 본문을 읽는 동안에도 시간 제한이 걸림 (머리만 오고 본문이 늦게 오는 경우)
    const slowBody = (url, init) => Promise.resolve({ ok: true, status: 200, headers: { get: () => null },
      json: () => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
    const d2 = fakeDeps({ fetchImpl: slowBody });
    assert.equal((await runGeneration(d2, GEN, { key: 'sk', prices: PRICES, timeoutMs: 20 })).code, 'openai_timeout');
  });
  test('검증 N5: 고른 비율을 이미지에 같이 저장 (정해진 크기로만 만드는 모델은 내려받을 때 이 비율로 자름)', async () => {
    const d = fakeDeps({ fetchImpl: fakeFetch(() => okImage()) });
    await runGeneration(d, { ...GEN, model: 'gpt-image-1.5', size: '1536x1024' }, { key: 'sk', prices: PRICES, ratio: '16:9' });
    assert.equal(d.log.rpc.find((x) => x.name === 'image_save').args.img.ratio, '16:9');
  });
  test('검증 13b: 점검용 가짜 모델은 저장소에서 실패해도 청구 없음·횟수에 안 셈', async () => {
    const d = fakeDeps({ upload: () => ({ error: { message: 'down' } }) });
    const r = await runGeneration(d, { ...GEN, model: TEST_MODEL }, { key: '', prices: PRICES });
    assert.equal(r.code, 'storage_failed');
    const fin = d.log.rpc.find((x) => x.name === 'image_gen_fail').args.fin;
    assert.deepEqual([fin.provider_called, fin.cost_status], [false, '청구 없음']);
  });
  test('저장소 첫 시도가 실제로는 됐는데 응답만 실패해도, 두 번째는 덮어쓰기로 성공', async () => {
    const seen = [];
    const d = fakeDeps({ fetchImpl: fakeFetch(() => okImage()), upload: (path, bytes, mime, o) => { seen.push(!!(o && o.upsert)); return seen.length === 1 ? { error: { message: 'timeout' } } : { error: null }; } });
    const r = await runGeneration(d, GEN, { key: 'sk', prices: PRICES });
    assert.equal(r.ok, true);
    assert.deepEqual(seen, [false, true]);
  });
});

describe('실제 사진 고르기 흐름 (Pexels → 보관함)', () => {
  const photo = { id: 77, width: 1880, height: 1253, url: 'https://www.pexels.com/photo/77/', photographer: 'Kim', photographer_url: 'https://www.pexels.com/@kim', alt: 'desk',
    src: { large2x: 'https://images.pexels.com/photos/77/a.jpeg?w=940&dpr=2', large: 'https://images.pexels.com/photos/77/a.jpeg?w=940', medium: 'https://images.pexels.com/photos/77/a.jpeg?h=350' } };
  const route = (url) => (url.startsWith('https://api.pexels.com/v1/photos/77') ? { json: photo } : url.startsWith('https://images.pexels.com/') ? { bytes: fx('exif.jpg') } : { status: 404, json: {} });
  test('사진 정보를 서버가 다시 받아서(화면이 보낸 주소는 안 믿음) 받은 그대로의 큰 사진을 복사, 숨은 정보 지움, 출처·사진가·라이선스 저장, 자리 연결', async () => {
    const f = fakeFetch(route);
    const d = fakeDeps({ fetchImpl: f });
    const r = await saveStockPhoto(d, { provider: 'pexels', photoId: 77, key: 'PX', post: { id: 'post-1' }, slot: { key: 'k:책상#1', index: 2, text: '책상 사진' }, purpose: 'blog_body', link: true });
    assert.equal(r.ok, true);
    assert.deepEqual(f.calls.map((c) => c.url), ['https://api.pexels.com/v1/photos/77', photo.src.large2x]);
    assert.deepEqual(d.log.calls, [['pexels', 'photo', 200]], 'API 호출 기록 (시간당 한도 지키기)');
    const up = d.log.upload[0];
    assert.match(up.path, /^stock\/2026\/10\/.+\.jpg$/);
    assert.equal(has(up.bytes, 'Exif') || has(up.bytes, 'GPS'), false, '촬영 정보가 지워짐');
    const save = d.log.rpc.find((x) => x.name === 'image_save').args;
    assert.equal(save.img.kind, 'stock');
    assert.equal(save.img.source_url, 'https://www.pexels.com/photo/77/');
    assert.equal(save.img.source_id, '77');
    assert.equal(save.img.author_name, 'Kim');
    assert.equal(save.img.attribution_text, '사진: Kim (Pexels)');
    assert.match(save.img.license, /pexels\.com\/license/);
    assert.deepEqual(save.link, { post_id: 'post-1', slot_key: 'k:책상#1', slot_index: 2, slot_text: '책상 사진', slot_ctx: '', purpose: 'blog_body' });
  });
  test('이미 받은 사진이면 다시 받지 않고 연결만, 키 없음·없는 사진', async () => {
    const f = fakeFetch(route);
    const d = fakeDeps({ fetchImpl: f, findImage: async (q) => (q.source_id === '77' ? { id: 'old', kind: 'stock' } : null) });
    const r = await saveStockPhoto(d, { provider: 'pexels', photoId: 77, key: 'PX', post: { id: 'p' }, slot: { key: 'k:a#1', index: 0, text: 'a' }, link: true });
    assert.deepEqual([r.ok, r.reused, r.image.id], [true, true, 'old']);
    assert.equal(f.calls.length, 0);
    assert.equal(d.log.rpc[0].name, 'image_slot_upsert');
    const nokey = await saveStockPhoto(fakeDeps({ fetchImpl: f }), { provider: 'pexels', photoId: 77, key: '' });
    assert.deepEqual([nokey.status, nokey.code], [503, 'pexels_key_missing']);
    const missing = await saveStockPhoto(fakeDeps({ fetchImpl: fakeFetch(() => ({ status: 404, json: {} })) }), { provider: 'pexels', photoId: 5, key: 'PX' });
    assert.deepEqual([missing.status, missing.code], [404, 'not_found']);
    assert.equal((await saveStockPhoto(fakeDeps(), { provider: 'unsplash', photoId: 1 })).code, 'bad_field', '연결 안 된 공급자');
  });
});

describe('직접 올리기 흐름', () => {
  const post = { id: 'post-1' }, slot = { key: 'k:a#1', index: 0, text: '거실 사진' };
  test('실제 내용 검사: 이름만 바꾼 파일·움직이는 이미지·형식이 다르다고 적힌 파일은 거절', async () => {
    const d = fakeDeps();
    assert.equal((await saveUploaded(d, { bytes: fx('fake.jpg'), declaredMime: 'image/jpeg', rights: true })).reason, 'bad_type');
    assert.equal((await saveUploaded(d, { bytes: fx('anim.png'), declaredMime: 'image/png', rights: true })).reason, 'animated');
    assert.equal((await saveUploaded(d, { bytes: fx('tiny.png'), declaredMime: 'image/jpeg', rights: true })).reason, 'type_mismatch');
    assert.equal((await saveUploaded(d, { bytes: fx('tiny.gif'), declaredMime: 'image/gif', rights: true })).reason, 'bad_type');
    assert.equal(d.log.upload.length, 0);
  });
  test('쓸 권한 확인을 안 하면 거절 (카드뉴스는 앱이 만든 거라 필요 없음)', async () => {
    const d = fakeDeps();
    assert.equal((await saveUploaded(d, { bytes: fx('tiny.jpg'), declaredMime: 'image/jpeg' })).code, 'rights_required');
    const c = await saveUploaded(d, { kind: 'card', bytes: fx('tiny.png'), declaredMime: 'image/png' });
    assert.equal(c.ok, true);
    const img = d.log.rpc.find((x) => x.name === 'image_save').args.img;
    assert.deepEqual([img.kind, img.provider, img.rights_confirmed], ['card', 'cardnews', true]);
    assert.match(d.log.upload[0].path, /^card\//);
  });
  test('숨은 정보 지우고 저장 + 자리 연결, 같은 파일은 다시 저장하지 않음', async () => {
    const d = fakeDeps();
    const r = await saveUploaded(d, { bytes: fx('exif.webp'), declaredMime: 'image/webp', rights: true, post, slot, purpose: 'blog_body', link: true });
    assert.equal(r.ok, true);
    assert.equal(has(d.log.upload[0].bytes, 'EXIF'), false);
    assert.match(d.log.upload[0].path, /^upload\/2026\/10\/.+\.webp$/);
    const save = d.log.rpc.find((x) => x.name === 'image_save').args;
    assert.equal(save.img.description, '거실 사진');
    assert.equal(save.img.license, '직접 올림 (사용 권한 확인함)');
    assert.equal(save.link.slot_key, 'k:a#1');
    const d2 = fakeDeps({ findImage: async (q) => (q.sha256 ? { id: 'same' } : null) });
    const again = await saveUploaded(d2, { bytes: fx('exif.webp'), declaredMime: 'image/webp', rights: true });
    assert.deepEqual([again.reused, again.image.id, d2.log.upload.length], [true, 'same', 0]);
  });
  test('저장 경로에는 원고 제목·파일 이름이 들어가지 않음', () => {
    assert.equal(storagePath('upload', 'png', new Date('2026-01-05T00:00:00Z'), 'abc'), 'upload/2026/01/abc.png');
  });
});

describe('서버 일꾼 시간 (검증 N2: 기다리는 시간 줄이기)', () => {
  test('품질별로 남아 있어야 하는 시간, 고치기는 10초 더, 일꾼 시간에서 30초는 남김', () => {
    assert.equal(needMsFor('low', 'generate', 150000), 60000);
    assert.equal(needMsFor('medium', 'edit', 150000), 85000);
    assert.equal(needMsFor('max', 'edit', 150000), 120000, '150초 일꾼: 최대 120초');
    assert.equal(needMsFor('xhigh', 'generate', 400000), 115000);
    assert.equal(needMsFor('unknown', 'generate', 150000), 115000);
  });
  test('다시 보낼 때까지: 일꾼 시간의 절반 전이면 절반이 지난 뒤(+3초), 지났으면 이 일꾼이 끝난 뒤(+2초), 3~150초', () => {
    assert.equal(busyRetryAfter(40000, 150000), 38, '40초 된 일꾼 → 75초에서 3초 뒤');
    assert.equal(busyRetryAfter(74500, 150000), 4);
    assert.equal(busyRetryAfter(80000, 150000), 72, '절반 넘음 → 150초에서 2초 뒤');
    assert.equal(busyRetryAfter(149000, 150000), 3);
    assert.equal(busyRetryAfter(10000, 400000), 150, '최대 150초');
  });
});
