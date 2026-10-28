// 1.5.1 생성 기록: AI 실사 장면은 'AI 합성 이미지' 출처·원본 상품 id·reference, 원본 보존 합성의 배경은 사진 자리 후보로 안 보이게 (가짜 fetch — 실제 API는 부르지 않음)
// 여기서 통과해도 '실제 생성 성공'이나 '실제 이미지 품질 확인'이 아님
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGeneration, bytesToB64 } from '../supabase/functions/blog-app/image_service.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name) => new Uint8Array(readFileSync(join(ROOT, 'tests', 'fixtures', 'img', name)));
const JPG = fx('photo-4x3.jpg');
function deps(fetchImpl) {
  const log = { rpc: [], upload: [], download: [] };
  return {
    log,
    rpc: async (name, args) => {
      log.rpc.push({ name, args });
      if (name === 'image_save') return { data: { image: { id: 'img-1', ...args.img }, generation: { id: args.gen, status: '성공' } }, error: null };
      return { data: { id: args.gen }, error: null };
    },
    upload: async (path, bytes, mime) => { log.upload.push({ path, mime }); return { error: null }; },
    remove: async () => ({ error: null }),
    download: async (path) => { log.download.push(path); return { ok: true, bytes: JPG }; },
    findImage: async () => null, logCall: async () => {},
    fetchImpl, now: () => new Date('2026-10-28T05:00:00Z'), uuid: () => '11111111-2222-4333-8444-555555555555',
  };
}
const openaiOk = async () => ({ ok: true, status: 200, headers: { get: () => 'req-1' }, json: async () => ({ data: [{ b64_json: bytesToB64(JPG) }], usage: { input_tokens: 100, output_tokens: 1000, input_tokens_details: { text_tokens: 100, image_tokens: 0 } } }) });
const GEN = { id: 'gen-1', mode: 'generate', model: 'gpt-image-2.5-sunburst', prompt: 'BRIEF', size: '1024x768', quality: 'high', output_format: 'jpeg', post_id: 'post-1', slot_key: 'k:a#1', slot_index: 0, slot_text: '침대 위 전기요', user_prompt: '', style: 'pscene_ref', purpose: 'blog_body', preset: 'pscene_ref' };

describe('1.5.1 생성 결과 기록', () => {
  test("AI 실사 장면: 출처에 'AI 합성 이미지 (실제 사진 참고)'가 남고 원본 상품 id·reference 를 기록", async () => {
    const d = deps(openaiOk);
    const r = await runGeneration(d, GEN, { keys: { openai: 'sk-test' }, refs: [{ path: 'upload/p.jpg', mime: 'image/jpeg', role: 'subject', id: 'prod-1', kind: 'upload' }],
      composite: true, compositeMode: 'reference', productImageId: 'prod-1', preset: 'pscene_ref', description: '전기요 · 집 안 테이블이나 선반' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const img = d.log.rpc.find((x) => x.name === 'image_save').args.img;
    assert.match(img.license, /^AI 합성 이미지 \(실제 사진 참고\) · AI 생성 이미지 \(OpenAI 이용 약관을 따름\)$/);
    assert.deepEqual([img.composite, img.composite_mode, img.product_image_id, img.origin_slot_key, img.preset], [true, 'reference', 'prod-1', 'k:a#1', 'pscene_ref']);
    assert.ok(img.license.length <= 200);
  });
  test('원본 보존 합성의 배경: reference 가 아니고, 원본 상품 id 만 남기고, 사진 자리 정보는 비움 (합성 결과가 그 자리 후보)', async () => {
    const d = deps(openaiOk);
    const r = await runGeneration(d, { ...GEN, preset: 'pscene_layer' }, { keys: { openai: 'sk-test' }, refs: [], composite: false, compositeMode: '', productImageId: 'prod-1', noSlot: true, preset: 'pscene_layer', description: '배경: 전기요' });
    assert.equal(r.ok, true);
    const img = d.log.rpc.find((x) => x.name === 'image_save').args.img;
    assert.deepEqual([img.composite, img.composite_mode, img.product_image_id, img.origin_slot_key, img.origin_slot_index, img.origin_post_id], [false, '', 'prod-1', '', '', 'post-1']);
    assert.equal(d.log.download.length, 0, '상품 사진을 받지도 보내지도 않음');
  });
  test('일반 AI 이미지는 1.5.0 과 같음 (새 칸은 빈 값)', async () => {
    const d = deps(openaiOk);
    await runGeneration(d, { ...GEN, preset: 'editorial' }, { keys: { openai: 'sk-test' }, preset: 'editorial' });
    const img = d.log.rpc.find((x) => x.name === 'image_save').args.img;
    assert.deepEqual([img.composite, img.composite_mode, img.product_image_id], [false, '', '']);
    assert.equal(img.license, 'AI 생성 이미지 (OpenAI 이용 약관을 따름)');
  });
});
