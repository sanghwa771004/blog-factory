// image_service.js — 이미지 공급자 호출과 저장 흐름 (서버 전용, 화면 코드 없음)
// - OpenAI 이미지 생성·편집, 사진 공급자(지금은 Pexels만) 검색·한 장 가져오기, 이미지 내려받기
// - 저장 흐름(생성 결과 저장·사진 고르기·파일 올리기)은 deps(DB 함수·파일 저장소)를 받아서 실행 → 테스트에서 가짜로 바꿔 끼움
// 키는 서버 환경변수(Supabase Edge Function Secrets)로만 받음. 화면(app.js)으로는 키가 있는지 여부만 보냄.
import { sniffImage, checkImageFile, stripMetadata, attributionFor, altTextFor, usageUsd, ctxOf, modelCaps } from './images.js';

export const OPENAI_URL = 'https://api.openai.com/v1';
export const PEXELS_URL = 'https://api.pexels.com/v1';
export const CF_URL = 'https://api.cloudflare.com/client/v4/accounts';
export const BUCKET = 'post-images';
// 저장소 버킷 한도(10MB, 012)와 같게 — 이보다 크면 받아도 저장하지 못함
export const MAX_AI_BYTES = 10 * 1024 * 1024;
export const MAX_STOCK_BYTES = 10 * 1024 * 1024;

// 점검용 가짜 모델: 설정의 모델 이름을 이걸로 바꾸면 OpenAI를 부르지 않고 작은 회색 시험 이미지를 돌려줌 (비용 0, 실제 이미지 아님)
// 서버 흐름(생성 시작 → 저장소 → 기록 → 연결)을 키 없이 점검할 때만 씀
export const TEST_MODEL = 'gf-test-fake';
const TEST_IMAGE_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABaAKADASIAAhEBAxEB/8QAGQABAQEBAQEAAAAAAAAAAAAABAMFAgEG/8QALhAAAQMDAwIFAwQDAAAAAAAAAAIEgQEzsQMRQiExBRITIlEUQZEGcaHwMmHh/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAEC/8QAGBEBAQEBAQAAAAAAAAAAAAAAAAERMUH/2gAMAwEAAhEDEQA/AN4Y3spnIMY3spnJGU3fCSbe8mcFHfCSbe8mcAMM80DPBTG9lM5Ju+ElG9lM5Ju+EgTb3kzgYDb3kzgYBnjG9lM5BjG9lM5Am74STb3kzgo74STb3kzgBhnmgZ4KY3spnJN3wko3spnJN3wkCbe8mcDAbe8mcDAM8Y3spnIMY3spnIE3fCSbe8mcFHfCSbe8mcAMM80DPBTG9lM5Ju+ElG9lM5Ju+EgTb3kzgYY2s+rouEaLfT9ZwrsnfpTp9zr6LxRz7nD70PulGlTtv9q7bdv3qDVxjeymcmF9G90/dovqqV22XTpt/Ixh4kr1UtHul6OrWntrv7V9Qaa74STb3kzgo74STb3kzgBhnmgZ4KY3spnJN3wko3spnJN3wkCbe8mcDAbe8mcDAM8Y3spnIMY3spnIE3fCSbe8mcFHfCSbe8mcAMM80DPBTG9lM5BeNOPpmvnp/lXdKf3Gt7KZyZXj3VywRXqlWpXdNe1eqQXjrwlpRutK17q1l9Vqr1r+xrg295M4GAjPOtdjpPmSdPU6KpvVC6d01ORjeymcgZbFzqazf0XFa1126qoXvXetfjr+aQMb3kzgzqe39Qukp6Jqila0p2rXZPX+a/k0W95M4BDDPNAzwUxvZTOSbvhJRvZTOSbvhIE295M4GA295M4GAZ4xvZTOQYxvZTOQJu+Ek295M4KO+Ek295M4AYZ5oGeCmN7KZyZv6g01V0NLW06e/RV5qV+KdP8An4NJvZTOSTylFUSlVKVpXelaV+4PEWWonWrp6iK+1VN6fgefPITq+FuvV0UK1Wqt6rRTrVHTv/Z+TV0PFWOundLhCK7U3ouvlrT894BKmL0VUS3opVaUTSla1rWvSlDMW9a6dN1a6K07e2vmwST9R4x5NJKV6LJPVSq02rqde1P7/v4oDXjGinDhw/XSu2qqqdPem1fLT+PikVNJveTOD3V0tPR0tLS0k0ShNK0pSh43vJnADDPNAzwUxvZTOSbvhJRvZTOSbvhIE295M4GA295M4GAZ4xvZTOQYxvZTOQJu+Ek295M4KO+Ek295M4AYZ5oGeCmN7KZyTd8JKN7KZyTd8JAm3vJnB1r+GsnCvNqt0VVvWtap9ta1r87dzlveTOBgGKhg001bp0E1r2926sms3spnIMY3spnIIm74STb3kzgo74STb3kzgBhnmgZ4KY3spnJN3wko3spnJN3wkCbe8mcDAbe8mcDAM8Y3spnIMY3spnIE3fCSbe8mcFHfCSbe8mcAMM80DPBTG9lM5Ju+ElG9lM5Ju+EgTb3kzgYDb3kzgYBnjG9lM5BjG9lM5Am74STb3kzgo74STb3kzgBhnmgZ4KY3spnJN3wko3spnJN3wkCbe8mcDAbe8mcDAP/Z';

// 키처럼 생긴 글자는 오류 메시지·기록에 남기지 않음
export const scrub = (s, n = 300) => String(s ?? '').replace(/sk-[A-Za-z0-9_-]{8,}/g, '[가림]').replace(/[A-Za-z0-9_-]{40,}/g, '[가림]').slice(0, n);

export function b64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// 저장 경로: 종류/연/월/임의값.확장자 (원고 제목·사용자 정보는 경로에 넣지 않음)
export function storagePath(folder, ext, now = new Date(), id = crypto.randomUUID()) {
  return `${folder}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${ext}`;
}

const isAbort = (e) => !!e && (e.name === 'AbortError' || e.name === 'TimeoutError' || /abort/i.test(String(e.message || '')));
// 시간 제한은 응답 머리만이 아니라 본문을 다 읽을 때까지 (read 가 끝나야 타이머를 끔)
async function timed(fetchImpl, url, init, ms, read) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1, ms));
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    return read ? { res, body: await read(res) } : { res, body: undefined };
  } finally { clearTimeout(t); }
}
const jsonOrNull = async (r) => { try { return await r.json(); } catch (e) { if (isAbort(e)) throw e; return null; } };
// 정해진 크기까지만 읽음 (넘으면 null — 끝까지 받지 않음)
async function readCapped(res, max) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const b = new Uint8Array(await res.arrayBuffer());
    return b.length > max ? null : b;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch { /* 무시 */ } return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve({ ok: false, timeout: true }), Math.max(1, ms)))]);

// ───────── OpenAI ─────────
// 오류를 앱이 알아듣는 코드로. billed: 'no' = 청구 안 됐을 것, 'maybe' = 됐을 수도 있음(확인 필요)
// 공식 가이드: 할당량(quota) 오류와 사용자 오류(image_generation_user_error)는 자동으로 다시 시도하지 말 것
export function classifyOpenAIError(status, body) {
  const e = (body && body.error) || {};
  const code = String(e.code || '');
  const type = String(e.type || '');
  const msg = scrub(e.message || '');
  const m = msg.toLowerCase();
  if (status === 401) return { code: 'openai_key_invalid', message: 'OpenAI API 키가 맞지 않아. Supabase Secrets의 OPENAI_API_KEY를 확인해줘.', billed: 'no', retryable: false };
  if (status === 403 && /verif/.test(m)) return { code: 'openai_org_unverified', message: 'OpenAI 조직 인증(Organization Verification)을 해야 이 모델을 쓸 수 있어.', billed: 'no', retryable: false };
  if (status === 403) return { code: 'openai_forbidden', message: '이 키로는 이 기능을 쓸 수 없어. ' + msg, billed: 'no', retryable: false };
  const param = String(e.param || '');
  if (status === 404 || code === 'model_not_found' || param === 'model') {
    return { code: 'model_unavailable', message: '이 계정에서 쓸 수 없는 모델이야. 설정 > 이미지에서 다른 모델 이름으로 바꿔줘.', billed: 'no', retryable: false };
  }
  // 모델은 되는데 그 크기·품질을 못 받는 경우 (모델을 바꾸라고 하면 헛돎 → 크기·품질 문제라고 알려줌)
  const opt = param === 'size' || param === 'quality' ? param : status === 400 && /(support|invalid|allowed|must be)/.test(m) ? (/\bquality\b/.test(m) ? 'quality' : /\bsize\b|\d+x\d+/.test(m) ? 'size' : '') : '';
  if (status === 400 && opt) {
    return { code: 'openai_unsupported_option', param: opt, message: `이 모델이 ${opt === 'size' ? '이 크기를' : '이 품질을'} 지원하지 않아. 설정 > 이미지에서 모델이나 품질을 바꿔줘.`, billed: 'no', retryable: false };
  }
  if (status === 400 && /model/.test(m) && /(not|invalid|exist|support)/.test(m)) {
    return { code: 'model_unavailable', message: '이 계정에서 쓸 수 없는 모델이야. 설정 > 이미지에서 다른 모델 이름으로 바꿔줘.', billed: 'no', retryable: false };
  }
  // OpenAI에 직접 걸어둔 한 달 한도(hard spend limit)·등급 한도: 기다려도 안 풀림 (OpenAI 문서 'Spend limits', 2026-10-22 확인)
  if (status === 429 && (/spend_limit_exceeded|usage_limit_exceeded/.test(code) || /spend limit|usage limit/.test(m))) {
    return { code: 'openai_spend_limit', message: 'OpenAI에 걸어둔 사용 한도(Spend limit)에 닿았어. OpenAI 설정의 Limits에서 한도를 올리거나 다음 달까지 기다려줘.', billed: 'no', retryable: false };
  }
  if (status === 429 && (code === 'insufficient_quota' || code === 'credit_balance_exhausted' || type === 'insufficient_quota' || /quota|billing|credit|balance/.test(m))) {
    return { code: 'openai_quota', message: 'OpenAI 잔액·한도가 부족해. OpenAI 결제(Billing) 화면을 확인해줘.', billed: 'no', retryable: false };
  }
  if (status === 429) return { code: 'openai_rate_limited', message: 'OpenAI가 잠깐 요청을 막았어. 1분쯤 뒤에 다시 해줘.', billed: 'no', retryable: true };
  if (code === 'moderation_blocked' || type === 'image_generation_user_error') {
    const stage = e.moderation_details && e.moderation_details.moderation_stage;
    return {
      code: code === 'moderation_blocked' ? 'moderation_blocked' : 'image_user_error', stage: stage || '',
      message: stage === 'output' ? '만든 이미지가 OpenAI 안전 검사에 걸렸어. 설명을 바꿔서 다시 해줘.' : '요청이 OpenAI 안전 기준에 맞지 않아. 설명을 바꿔서 다시 해줘.',
      billed: stage === 'output' ? 'maybe' : 'no', retryable: false,
    };
  }
  if (status >= 500) return { code: 'openai_server', message: 'OpenAI 서버에 문제가 있어. 조금 뒤에 다시 해줘.', billed: 'maybe', retryable: true };
  return { code: 'openai_bad_request', message: '요청이 거절됐어: ' + (msg || status), billed: 'no', retryable: false };
}
// OpenAI가 만들기 전에 거절한 오류 → 하루 생성 횟수에 안 셈
export const NOT_COUNTED = new Set(['openai_key_missing', 'openai_key_invalid', 'openai_org_unverified', 'openai_forbidden', 'model_unavailable',
  'openai_unsupported_option', 'openai_quota', 'openai_spend_limit', 'openai_rate_limited', 'openai_bad_request', 'bad_base_image', 'server_busy_late',
  'cf_key_missing', 'cf_key_invalid', 'cf_daily_free_used', 'cf_rate_limited', 'cf_bad_request', 'cf_network']);

// 한 장 만들기(generate) 또는 고치기(edit). 성공하면 base64 이미지와 사용량을 돌려줌
export async function openaiImage({ fetchImpl, key, mode = 'generate', model, prompt, size, quality, outputFormat = 'jpeg', compression = 90, image, safetyId, timeoutMs = 115000 }) {
  if (model === TEST_MODEL) {
    return { ok: true, b64: TEST_IMAGE_B64, revisedPrompt: '', outputFormat: 'jpeg', requestId: 'test-model', test: true,
      usage: { input_tokens: 0, input_tokens_details: { text_tokens: 0, image_tokens: 0 }, output_tokens: 0, total_tokens: 0 } };
  }
  if (!key) return { ok: false, code: 'openai_key_missing', message: 'OpenAI API 키가 설정되지 않았어.', billed: 'no' };
  let res, j = null;
  try {
    if (mode === 'edit') {
      if (!image || !image.bytes) return { ok: false, code: 'bad_base_image', message: '고칠 이미지를 찾지 못했어.', billed: 'no' };
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append('size', size);
      form.append('quality', quality);
      form.append('output_format', outputFormat);
      if (outputFormat !== 'png') form.append('output_compression', String(compression));
      form.append('n', '1');
      if (safetyId) form.append('safety_identifier', safetyId);
      const mime = image.mime || 'image/png';
      form.append('image[]', new Blob([image.bytes], { type: mime }), 'base.' + (mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]));
      ({ res, body: j } = await timed(fetchImpl, OPENAI_URL + '/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form }, timeoutMs, jsonOrNull));
    } else {
      const body = { model, prompt, size, quality, output_format: outputFormat, n: 1, moderation: 'auto' };
      if (outputFormat !== 'png') body.output_compression = compression;
      if (safetyId) body.safety_identifier = safetyId;
      ({ res, body: j } = await timed(fetchImpl, OPENAI_URL + '/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs, jsonOrNull));
    }
  } catch (e) {
    return isAbort(e)
      ? { ok: false, code: 'openai_timeout', message: '응답이 너무 오래 걸려서 멈췄어. 청구됐을 수 있으니 OpenAI 사용량을 확인해줘.', billed: 'maybe', retryable: true }
      : { ok: false, code: 'openai_network', message: 'OpenAI에 연결하지 못했어. 조금 뒤에 다시 해줘.', billed: 'maybe', retryable: true };
  }
  const requestId = scrub(res.headers && res.headers.get ? res.headers.get('x-request-id') || '' : '', 120);
  if (!res.ok) return { ok: false, status: res.status, requestId, ...classifyOpenAIError(res.status, j) };
  const item = j && Array.isArray(j.data) ? j.data[0] : null;
  if (!item || typeof item.b64_json !== 'string' || !item.b64_json) {
    return { ok: false, code: 'openai_empty', message: 'OpenAI가 이미지를 돌려주지 않았어. 청구됐을 수 있으니 OpenAI 사용량을 확인해줘.', billed: 'maybe', usage: j && j.usage, requestId };
  }
  return { ok: true, b64: item.b64_json, revisedPrompt: scrub(item.revised_prompt || '', 4000), usage: (j && j.usage) || null, outputFormat: (j && j.output_format) || outputFormat, requestId };
}

// ───────── Cloudflare Workers AI (무료 이미지) ─────────
// 무료 플랜(Workers Free)은 하루 10,000 뉴런까지 무료이고, 넘으면 오류로 실패만 함 (청구 없음). 매일 오전 9시(한국)에 다시 채워짐.
// 이미지 모델(FLUX.1 schnell)은 한국어를 잘 못 알아들어서, 같은 무료 계정의 글 모델로 먼저 영어 장면 설명을 만들고 규칙을 붙여 보냄.
export const CF_TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// FLUX는 '하지 마' 문장을 잘 못 따르고 오히려 글자를 그리기도 해서, 마지막 줄은 짧은 긍정형으로 (금지 규칙은 글 모델 지시문·요청 검사에서 지킴)
export const CF_RULES = 'Plain unbranded objects with blank, unmarked surfaces; no writing anywhere.';
// 2026-10-25 실서버 시험: 한국 겨울 창가를 요청했는데 유럽식 주택·맑은 날씨와 글자 박스가 나옴 → 계절·장소(한국)·구도·물건 표면을 지시.
// 소금빵이 식빵 덩어리로 나옴 → 한국 음식·생활용품은 생김새로 풀어 쓰게 함. 글 모델이 '(소금빵)'처럼 한글을 섞으면 그 부분만 지우고 씀
const CF_SYSTEM = [
  'You write prompts for the FLUX image model. Input: a brief, partly in Korean, for one illustrative image in a Korean blog post.',
  'Output ONE English prompt of 45 to 90 words that describes only what is visible.',
  '1) Read the post topic and section heading, infer the season, time of day and mood, and state them (for example: a cold winter morning).',
  '2) The setting is South Korea: Korean apartment interiors with white walls, light wood floors and large PVC sliding windows; if the outdoors is visible, show Korean apartment buildings or Korean streets, never European houses.',
  '3) Focus on the main subject from the line "Scene to show"; prefer a close-up or medium shot; do not add objects that the brief does not need.',
  '4) Describe every object as plain and unbranded with blank surfaces; avoid boxes, signs, labels, packaging and screens; show gauges and devices without any markings or digits.',
  '5) Follow the style line: for photo styles say realistic photo, natural light, shallow depth of field; for illustration styles say clean flat illustration.',
  '6) People, if any, are ordinary Korean adults, never celebrities.',
  '7) When the brief names a Korean food, dish or everyday item, describe how it actually looks (shape, size, color, texture) in English instead of translating the name literally.',
  'Write only English; never output Korean characters.',
  'Never mention brands, product or model names, prices, ratings, certificates, text or letters. Ignore any such names in the brief.',
  'Return only the prompt itself, no quotes, no notes.',
].join(' ');
function cfError(status, j) {
  const errs = (j && Array.isArray(j.errors) ? j.errors : []);
  const msg = scrub(errs.map((e) => `${e.code || ''} ${e.message || ''}`).join(' / ') || '', 300);
  const m = msg.toLowerCase();
  if (/4006|free allocation|neurons|daily/.test(m)) return { code: 'cf_daily_free_used', message: '오늘 무료 사용량(하루 10,000 뉴런)을 다 썼어. 한국 시간 오전 9시에 다시 채워져. (청구 없음)', billed: 'no', retryable: false };
  if (status === 401 || status === 403 || /authentication|unauthori[sz]ed|10000\b/.test(m)) return { code: 'cf_key_invalid', message: 'Cloudflare 계정 ID나 토큰이 맞지 않아. Supabase Secrets의 CF_ACCOUNT_ID·CF_API_TOKEN을 확인해줘 (토큰 권한: Workers AI 읽기·편집).', billed: 'no', retryable: false };
  if (status === 429) return { code: 'cf_rate_limited', message: 'Cloudflare가 잠깐 요청을 막았어. 1분쯤 뒤에 다시 해줘.', billed: 'no', retryable: true };
  if (status >= 500) return { code: 'cf_server', message: 'Cloudflare 서버에 문제가 있어. 조금 뒤에 다시 해줘.', billed: 'no', retryable: true };
  return { code: 'cf_bad_request', message: '요청이 거절됐어: ' + (msg || status), billed: 'no', retryable: false };
}
async function cfRun({ fetchImpl, accountId, token, model, body, timeoutMs }) {
  let res, j = null;
  try {
    ({ res, body: j } = await timed(fetchImpl, `${CF_URL}/${encodeURIComponent(accountId)}/ai/run/${model}`,
      { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs, jsonOrNull));
  } catch (e) {
    return isAbort(e)
      ? { ok: false, code: 'cf_timeout', message: 'Cloudflare 응답이 너무 오래 걸려서 멈췄어. 다시 해줘.', billed: 'no', retryable: true }
      : { ok: false, code: 'cf_network', message: 'Cloudflare에 연결하지 못했어. 조금 뒤에 다시 해줘.', billed: 'no', retryable: true };
  }
  const requestId = scrub(res.headers && res.headers.get ? res.headers.get('cf-ray') || '' : '', 120);
  if (!res.ok || !j || j.success === false) return { ok: false, status: res.status, requestId, ...cfError(res.status, j) };
  return { ok: true, result: j.result || {}, requestId };
}
// 글 모델 답 정리: 따옴표·줄바꿈을 지우고, 섞여 나온 한글(괄호 속 원래 이름 등)은 빼고 씀. 너무 짧으면 버림
export function cleanEnglishPrompt(raw) {
  const t = String(raw || '').replace(/\([^)]*[가-힣][^)]*\)/g, ' ').replace(/[가-힣]+/g, ' ')
    .replace(/^\s*(?:prompt\s*:)?/i, '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim();
  return t.length >= 20 ? t.slice(0, 1200) : '';
}
// 한국어가 섞인 요청서 → 영어 이미지 프롬프트. 한 번 더 시도해도 안 되면 실패 (그때는 요청서를 그대로 씀)
export async function cfEnglishPrompt({ fetchImpl, accountId, token, brief, timeoutMs = 25000 }) {
  let last = { ok: false, code: 'cf_prompt_bad', message: '' };
  const until = Date.now() + timeoutMs;
  for (const temperature of [0.4, 0.2]) {
    const left = until - Date.now();
    if (left < 3000) break;
    const r = await cfRun({ fetchImpl, accountId, token, model: CF_TEXT_MODEL, timeoutMs: left,
      body: { messages: [{ role: 'system', content: CF_SYSTEM }, { role: 'user', content: String(brief).slice(0, 6000) }], max_tokens: 220, temperature } });
    if (!r.ok) {
      last = { ok: false, code: r.code, message: r.message };
      if (r.code === 'cf_key_invalid' || r.code === 'cf_daily_free_used') return last;
      continue;
    }
    const t = cleanEnglishPrompt(r.result && r.result.response);
    if (t) return { ok: true, text: t };
  }
  return last;
}
export async function cloudflareImage({ fetchImpl, accountId, token, model, prompt, quality, timeoutMs = 60000 }) {
  if (!accountId || !token) return { ok: false, code: 'cf_key_missing', message: 'Cloudflare 계정 ID·토큰이 설정되지 않았어.', billed: 'no' };
  const caps = modelCaps(model);
  if (caps.provider !== 'cloudflare') return { ok: false, code: 'model_unavailable', message: '무료 모델이 아니야.', billed: 'no' };
  const started = Date.now();
  const en = await cfEnglishPrompt({ fetchImpl, accountId, token, brief: prompt, timeoutMs: Math.min(25000, Math.max(1000, timeoutMs - 30000)) });
  if (!en.ok && (en.code === 'cf_key_invalid' || en.code === 'cf_daily_free_used')) return { ok: false, code: en.code, message: en.message, billed: 'no' };
  const finalPrompt = ((en.ok ? en.text : prompt) + '\n' + CF_RULES).slice(0, 2048);
  const steps = (caps.steps && caps.steps[quality]) || 4;
  const r = await cfRun({ fetchImpl, accountId, token, model: caps.cfModel, timeoutMs: Math.max(5000, timeoutMs - (Date.now() - started)),
    body: { prompt: finalPrompt, steps } });
  if (!r.ok) return r;
  const b64 = r.result && typeof r.result.image === 'string' ? r.result.image : '';
  if (!b64) return { ok: false, code: 'cf_empty', message: 'Cloudflare가 이미지를 돌려주지 않았어. 다시 해줘. (청구 없음)', billed: 'no', requestId: r.requestId };
  return { ok: true, b64, revisedPrompt: scrub(finalPrompt, 4000), usage: null, outputFormat: 'jpeg', requestId: r.requestId, provider: 'cloudflare', englishPrompt: en.ok };
}

// ───────── 사진 공급자 (지금은 Pexels만 실제로 연결) ─────────
// 새 공급자를 붙일 때는 같은 모양(search·get)의 함수를 PHOTO_PROVIDERS 에 더하면 됨. 연결 안 된 공급자는 화면에 보이지 않음.
const okHost = (u, hosts) => { try { const x = new URL(String(u)); return x.protocol === 'https:' && hosts.includes(x.hostname); } catch { return false; } };
// Pexels가 준 주소를 그대로 씀 (크기 바꾸려고 주소를 고치지 않음). 다른 곳을 가리키는 주소는 버림
export function normalizePexels(p) {
  if (!p || typeof p !== 'object' || !p.src) return null;
  const src = p.src;
  const pick = (k) => (okHost(src[k], ['images.pexels.com']) ? String(src[k]) : '');
  const out = {
    id: Number(p.id), width: Number(p.width) || 0, height: Number(p.height) || 0,
    alt: scrub(p.alt || '', 300), photographer: scrub(p.photographer || '', 120),
    photographer_url: okHost(p.photographer_url, ['www.pexels.com', 'pexels.com']) ? String(p.photographer_url) : '',
    url: okHost(p.url, ['www.pexels.com', 'pexels.com']) ? String(p.url) : '',
    avg_color: /^#[0-9a-f]{6}$/i.test(String(p.avg_color || '')) ? String(p.avg_color) : '',
    thumb: pick('medium') || pick('small') || pick('tiny'),
    preview: pick('large') || pick('medium'),
    download: pick('large2x') || pick('large') || pick('original'),
  };
  return Number.isInteger(out.id) && out.id > 0 && out.thumb && out.download && out.url ? out : null;
}
const remainingOf = (res) => {
  const v = res.headers && res.headers.get ? res.headers.get('x-ratelimit-remaining') : null;
  return v == null || v === '' ? null : Number(v);
};
function pexelsError(status) {
  if (status === 401 || status === 403) return { code: 'pexels_key_invalid', message: 'Pexels API 키가 맞지 않아. Supabase Secrets의 PEXELS_API_KEY를 확인해줘.' };
  if (status === 429) return { code: 'pexels_rate_limited', message: 'Pexels 요청 한도(시간당 200번·월 20,000번)에 닿았어. 조금 뒤에 다시 해줘.' };
  if (status === 404) return { code: 'not_found', message: '그 사진을 찾을 수 없어.' };
  return { code: 'pexels_error', message: 'Pexels에서 문제가 생겼어. 조금 뒤에 다시 해줘.' };
}
export async function pexelsSearch({ fetchImpl, key, query, orientation, page = 1, perPage = 24, timeoutMs = 15000 }) {
  if (!key) return { ok: false, code: 'pexels_key_missing', message: 'Pexels API 키가 설정되지 않았어.' };
  const q = new URLSearchParams({ query: String(query), page: String(page), per_page: String(perPage) });
  if (['landscape', 'portrait', 'square'].includes(orientation)) q.set('orientation', orientation);
  q.set('locale', /[ㄱ-힝]/.test(String(query)) ? 'ko-KR' : 'en-US');
  let res, j = null;
  try { ({ res, body: j } = await timed(fetchImpl, PEXELS_URL + '/search?' + q, { headers: { Authorization: key } }, timeoutMs, (r) => (r.ok ? jsonOrNull(r) : null))); } catch { return { ok: false, code: 'pexels_network', message: 'Pexels에 연결하지 못했어.' }; }
  if (!res.ok) return { ok: false, status: res.status, ...pexelsError(res.status) };
  const photos = (j && Array.isArray(j.photos) ? j.photos : []).map(normalizePexels).filter(Boolean);
  return { ok: true, status: res.status, photos, total: Number(j && j.total_results) || 0, page: Number(j && j.page) || page, hasNext: !!(j && j.next_page), remaining: remainingOf(res) };
}
export async function pexelsPhoto({ fetchImpl, key, id, timeoutMs = 15000 }) {
  if (!key) return { ok: false, code: 'pexels_key_missing', message: 'Pexels API 키가 설정되지 않았어.' };
  let res, j = null;
  try { ({ res, body: j } = await timed(fetchImpl, PEXELS_URL + '/photos/' + encodeURIComponent(String(id)), { headers: { Authorization: key } }, timeoutMs, (r) => (r.ok ? jsonOrNull(r) : null))); } catch { return { ok: false, code: 'pexels_network', message: 'Pexels에 연결하지 못했어.' }; }
  if (!res.ok) return { ok: false, status: res.status, ...pexelsError(res.status) };
  const photo = normalizePexels(j);
  return photo ? { ok: true, status: res.status, photo, remaining: remainingOf(res) } : { ok: false, code: 'pexels_error', message: 'Pexels 사진 정보를 읽지 못했어.' };
}
export const PHOTO_PROVIDERS = {
  pexels: {
    label: 'Pexels', envKey: 'PEXELS_API_KEY', site: 'https://www.pexels.com', license: 'Pexels 라이선스', licenseUrl: 'https://www.pexels.com/license/',
    search: pexelsSearch, get: pexelsPhoto, hosts: ['images.pexels.com'], hourLimit: 150, monthLimit: 18000,
  },
};

// 허용한 주소(사진 공급자 이미지 서버)에서만, 크기 제한을 지키며 내려받음 (다른 곳으로 넘겨주는 주소는 따라가지 않음)
export async function downloadImage({ fetchImpl, url, hosts, maxBytes, timeoutMs = 20000 }) {
  if (!okHost(url, hosts)) return { ok: false, code: 'bad_source', message: '허용하지 않은 주소야.' };
  let res, buf = null;
  try {
    ({ res, body: buf } = await timed(fetchImpl, url, { redirect: 'error' }, timeoutMs, async (r) => {
      if (!r.ok) return null;
      const len = Number(r.headers && r.headers.get ? r.headers.get('content-length') : 0);
      if (len && len > maxBytes) return 'too_big';
      return (await readCapped(r, maxBytes)) || 'too_big';
    }));
  } catch { return { ok: false, code: 'download_failed', message: '사진을 내려받지 못했어.' }; }
  if (!res.ok) return { ok: false, code: 'download_failed', message: '사진을 내려받지 못했어. (' + res.status + ')' };
  if (buf === 'too_big' || !buf) return { ok: false, code: 'too_big', message: '사진이 너무 커.' };
  return { ok: true, bytes: buf };
}

// ───────── 저장 흐름 ─────────
// deps: { rpc(name, args) → {data, error}, upload(path, bytes, mime, {upsert}) → {error}, remove(paths), download(path) → {ok, bytes},
//         findImage({provider, source_id} | {sha256}) → 행 또는 null, logCall(provider, kind, status), fetchImpl, now(), uuid() }
const linkArg = (post, slot, purpose) => (post && slot
  ? { post_id: post.id, slot_key: slot.key, slot_index: slot.index ?? 0, slot_text: slot.text || '', slot_ctx: ctxOf(slot), purpose: purpose || '' } : null);
// 처음 올리기가 실제로는 됐는데 응답만 실패한 경우를 위해, 다시 할 때는 덮어쓰기 허용 (경로는 매번 새 무작위 값이라 다른 파일을 덮지 않음)
async function uploadWithRetry(d, path, bytes, mime) {
  let up = await d.upload(path, bytes, mime, { upsert: false });
  if (up && up.error) up = await d.upload(path, bytes, mime, { upsert: true });
  return !(up && up.error);
}
async function linkExisting(d, link, image) {
  if (!link) return { ok: true, image, slot: null, reused: true };
  const s = await d.rpc('image_slot_upsert', { p_post: link.post_id, p: { ...link, image_id: image.id } });
  if (s.error) return { ok: false, status: 500, code: 'server', error: s.error };
  return { ok: true, image, slot: s.data, reused: true };
}

// ───────── 서버 일꾼 시간 (Supabase Edge Functions: 일꾼 하나가 켜진 뒤 무료 150초·유료 400초까지 일함) ─────────
// 품질별로 OpenAI 응답을 기다릴 수 있어야 하는 시간 — 이만큼 남아 있어야 시작함 (모자라면 돈이 나가기 전에 '잠깐 뒤에')
export const NEED_MS = { low: 60000, medium: 75000, high: 100000, xhigh: 115000, max: 115000 };
export const needMsFor = (quality, mode, wallMs) => Math.min((NEED_MS[quality] ?? 115000) + (mode === 'edit' ? 10000 : 0), wallMs - 30000);
// '잠깐 뒤에 다시'까지 기다릴 초: 일꾼 시간의 절반이 지나기 전이면 그 뒤 (그때부터 새 요청은 새 일꾼이 받는 경우가 많음 —
// Supabase 'retire'. 공식 문서로 확인하지 못해서, 같은 일꾼이 또 받으면 그때는 이 일꾼이 끝난 뒤로), 아니면 이 일꾼이 끝난 뒤
export function busyRetryAfter(ageMs, wallMs) {
  const sec = ageMs < wallMs / 2 ? (wallMs / 2 - ageMs) / 1000 + 3 : (wallMs - ageMs) / 1000 + 2;
  return Math.min(150, Math.max(3, Math.ceil(sec)));
}

// AI 생성 실행 (image_gen_begin 으로 '생성 중' 한 줄을 만든 다음). 끝나면 성공·실패를 기록하고 결과를 돌려줌
// opt: { key, prices, safetyId, timeoutMs, deadline(이 서버 일꾼이 꺼지기 전 마지막 시각, ms), base: {path, mime} (편집일 때), description,
//        ratio(고른 비율 — 정해진 크기로만 만드는 모델은 내려받을 때 이 비율로 자름) }
// 시간 제한은 OpenAI를 부르기 바로 직전에 남은 시간으로 다시 계산 (편집 원본 받기 등 앞 단계에서 쓴 시간을 뺌)
export const MIN_OPENAI_MS = 20000;
export async function runGeneration(d, gen, opt = {}) {
  const leftMs = () => (opt.deadline ? opt.deadline - d.now().getTime() : Infinity);
  const isTest = gen.model === TEST_MODEL; // 점검용 가짜 모델은 어디서 실패해도 OpenAI를 안 불렀으니 청구 없음·횟수에 안 셈
  const isFree = modelCaps(gen.model).provider === 'cloudflare'; // 무료 모델(Cloudflare 무료 플랜): 실패해도 청구 없음
  const who = isFree ? 'Cloudflare' : 'OpenAI';
  const billedNote = isFree ? '(청구 없음)' : `청구됐을 수 있으니 ${who} 사용량을 확인해줘.`;
  const fail = async (r) => {
    const fin = {
      provider_called: !isTest && !NOT_COUNTED.has(r.code), error_code: r.code, error_message: scrub(r.message, 500),
      cost_status: isTest || isFree || r.billed === 'no' ? '청구 없음' : '확인 필요', request_id: r.requestId || '',
    };
    if (r.usage) { fin.usage = r.usage; fin.usage_usd = usageUsd(r.usage, opt.prices, gen.model); }
    const x = await d.rpc('image_gen_fail', { gen: gen.id, fin });
    return { ok: false, code: r.code, message: r.message, retryable: !!r.retryable, billed: r.billed, generation: x && x.data };
  };
  let res;
  try {
    let image = null;
    if (gen.mode === 'edit') {
      const dl = opt.base && opt.base.path ? await withTimeout(d.download(opt.base.path), Math.min(20000, Math.max(1, leftMs() - MIN_OPENAI_MS))) : { ok: false };
      if (!dl.ok) return fail({ code: 'bad_base_image', message: '고칠 이미지를 불러오지 못했어.', billed: 'no' });
      image = { bytes: dl.bytes, mime: opt.base.mime };
    }
    if (leftMs() < MIN_OPENAI_MS) return fail({ code: 'server_busy_late', message: '서버 준비 시간이 모자라서 시작하지 않았어 (청구 없음). 다시 눌러줘.', billed: 'no', retryable: true });
    const timeoutMs = Math.min(opt.timeoutMs || 115000, leftMs());
    res = isFree
      ? await cloudflareImage({ fetchImpl: d.fetchImpl, accountId: opt.cf && opt.cf.accountId, token: opt.cf && opt.cf.token, model: gen.model, prompt: gen.prompt, quality: gen.quality, timeoutMs })
      : await openaiImage({ fetchImpl: d.fetchImpl, key: opt.key, mode: gen.mode, model: gen.model, prompt: gen.prompt, size: gen.size, quality: gen.quality,
        outputFormat: gen.output_format || 'jpeg', image, safetyId: opt.safetyId, timeoutMs });
  } catch (e) {
    res = { ok: false, code: 'server_error', message: '서버에서 문제가 생겼어. ' + billedNote, billed: isFree ? 'no' : 'maybe', detail: scrub(e && e.message) };
  }
  if (!res.ok) return fail(res);
  let bytes = null;
  try { bytes = b64ToBytes(res.b64); } catch { bytes = null; }
  const sn = bytes && bytes.length <= MAX_AI_BYTES ? sniffImage(bytes) : null;
  if (!sn) return fail({ code: 'openai_bad_image', message: `${who}가 보낸 이미지를 읽지 못했어. ${billedNote}`, billed: isFree ? 'no' : 'maybe', usage: res.usage, requestId: res.requestId });
  const path = storagePath('ai', sn.ext, d.now(), d.uuid());
  if (!(await uploadWithRetry(d, path, bytes, sn.mime))) {
    return fail({ code: 'storage_failed', message: '만든 이미지를 저장하지 못했어. ' + billedNote, billed: isFree ? 'no' : 'maybe', usage: res.usage, requestId: res.requestId });
  }
  const text = opt.description || gen.slot_text || '';
  const img = {
    origin_post_id: gen.post_id || '', origin_slot_index: gen.slot_index ?? '', origin_slot_key: gen.slot_key || '',
    kind: 'ai', provider: res.test ? '' : isFree ? 'cloudflare' : 'openai', model: gen.model, prompt: gen.prompt, user_prompt: gen.user_prompt, style: gen.style, purpose: gen.purpose,
    ratio: opt.ratio || '', description: text, alt_text: altTextFor(text), storage_path: path, mime: sn.mime, bytes: bytes.length, width: sn.width, height: sn.height,
    sha256: await sha256Hex(bytes), attribution_text: '',
    license: res.test ? '점검용 시험 이미지 (OpenAI를 부르지 않음 — 실제 이미지 아님)' : isFree ? 'AI 생성 이미지 (FLUX.1 schnell · Cloudflare Workers AI 약관을 따름)' : 'AI 생성 이미지 (OpenAI 이용 약관을 따름)',
  };
  // 점검용 가짜 모델은 청구가 없고 하루 횟수에도 안 셈
  const fin = res.test
    ? { usage: res.usage, usage_usd: 0, cost_status: '청구 없음', provider_called: false, request_id: res.requestId }
    : isFree ? { usage: null, usage_usd: 0, cost_status: '청구 없음', revised_prompt: res.revisedPrompt, request_id: res.requestId }
    : { usage: res.usage, usage_usd: usageUsd(res.usage, opt.prices, gen.model), revised_prompt: res.revisedPrompt, request_id: res.requestId };
  const r = await d.rpc('image_save', { img, link: null, gen: gen.id, fin });
  if (r.error) {
    await d.remove([path]);
    return fail({ code: 'save_failed', message: '만든 이미지를 기록하지 못했어. ' + billedNote, billed: isFree ? 'no' : 'maybe', usage: res.usage, requestId: res.requestId });
  }
  return { ok: true, image: r.data.image, generation: r.data.generation, test: !!res.test };
}

// 사진 공급자에서 고른 사진을 보관함에 복사 (이미 받은 사진이면 다시 받지 않음) + 원하면 자리에 연결
// a: { provider, photoId, key, post, slot, purpose, link }
export async function saveStockPhoto(d, a) {
  const P = PHOTO_PROVIDERS[a.provider];
  if (!P) return { ok: false, status: 400, code: 'bad_field', field: 'provider' };
  const link = a.link ? linkArg(a.post, a.slot, a.purpose) : null;
  const ex = await d.findImage({ provider: a.provider, source_id: String(a.photoId) });
  if (ex) return linkExisting(d, link, ex);
  const g = await P.get({ fetchImpl: d.fetchImpl, key: a.key, id: a.photoId });
  await d.logCall(a.provider, 'photo', g.status || 0);
  if (!g.ok) return { ok: false, status: g.code === 'not_found' ? 404 : g.code === 'pexels_key_missing' ? 503 : 502, code: g.code, message: g.message };
  const photo = g.photo;
  const dl = await downloadImage({ fetchImpl: d.fetchImpl, url: photo.download, hosts: P.hosts, maxBytes: MAX_STOCK_BYTES });
  if (!dl.ok) return { ok: false, status: 502, code: dl.code, message: dl.message };
  const chk = sniffImage(dl.bytes);
  if (!chk || chk.animated) return { ok: false, status: 502, code: 'stock_bad_image', message: '사진 파일을 읽지 못했어.' };
  const bytes = stripMetadata(dl.bytes).bytes;
  const path = storagePath('stock', chk.ext, d.now(), d.uuid());
  if (!(await uploadWithRetry(d, path, bytes, chk.mime))) return { ok: false, status: 502, code: 'storage_failed', message: '사진을 저장하지 못했어.' };
  const desc = (a.slot && a.slot.text) || photo.alt || '';
  const img = {
    origin_post_id: a.post ? a.post.id : '', origin_slot_index: a.slot ? a.slot.index ?? '' : '', origin_slot_key: a.slot ? a.slot.key : '',
    kind: 'stock', provider: a.provider, purpose: a.purpose || '', description: desc, alt_text: photo.alt ? scrub(photo.alt, 300) : altTextFor(desc),
    storage_path: path, mime: chk.mime, bytes: bytes.length, width: chk.width, height: chk.height, sha256: await sha256Hex(bytes),
    source_url: photo.url, source_id: String(photo.id), author_name: photo.photographer, author_url: photo.photographer_url,
    license: `${P.license} (${P.licenseUrl})`, attribution_text: attributionFor({ provider: a.provider, author_name: photo.photographer }),
  };
  const r = await d.rpc('image_save', { img, link, gen: null, fin: null });
  if (r.error) { await d.remove([path]); return { ok: false, status: 500, code: 'server', error: r.error }; }
  return { ok: true, image: r.data.image, slot: r.data.slot, reused: false };
}

// 직접 올린 파일(또는 앱에서 만든 카드뉴스 PNG)을 검사 → 숨은 정보 지우기 → 저장 (같은 파일이면 다시 저장하지 않음)
// a: { bytes, declaredMime, kind: 'upload'|'card', rights, post, slot, purpose, description, link, bg(카드뉴스 배경 이미지 행) }
export async function saveUploaded(d, a) {
  const chk = checkImageFile(a.bytes, a.declaredMime);
  // 카드뉴스는 앱이 캔버스로 그린 PNG만 (다른 형식이면 일반 올리기처럼 권한 확인을 받음)
  const kind = a.kind === 'card' && chk.ok && chk.mime === 'image/png' ? 'card' : 'upload';
  if (!chk.ok) return { ok: false, status: chk.code === 'too_big' ? 413 : 400, code: 'bad_image', reason: chk.code, message: chk.msg };
  if (kind === 'upload' && a.rights !== true) return { ok: false, status: 400, code: 'rights_required', message: '쓸 권한이 있는 사진인지 확인해줘.' };
  const bytes = stripMetadata(a.bytes).bytes;
  const sha = await sha256Hex(bytes);
  const link = a.link ? linkArg(a.post, a.slot, a.purpose) : null;
  const ex = await d.findImage({ sha256: sha });
  if (ex) return linkExisting(d, link, ex);
  const path = storagePath(kind, chk.ext, d.now(), d.uuid());
  if (!(await uploadWithRetry(d, path, bytes, chk.mime))) return { ok: false, status: 502, code: 'storage_failed', message: '파일을 저장하지 못했어.' };
  const desc = String(a.description || (a.slot && a.slot.text) || '').slice(0, 500);
  // 카드뉴스 배경으로 쓴 이미지의 출처를 같이 남김 (Pexels 사진가·AI 여부가 사라지지 않게)
  const bg = kind === 'card' && a.bg ? a.bg : null;
  const bgNote = bg ? (bg.kind === 'ai' ? 'AI 생성 이미지' : bg.provider === 'pexels' ? `Pexels 사진 (${bg.author_name || '사진가'})` : bg.kind === 'upload' ? '직접 올린 사진' : '카드뉴스') : '';
  const img = {
    origin_post_id: a.post ? a.post.id : '', origin_slot_index: a.slot ? a.slot.index ?? '' : '', origin_slot_key: a.slot ? a.slot.key : '',
    kind, provider: kind === 'card' ? 'cardnews' : 'upload', purpose: a.purpose || '', description: desc, alt_text: altTextFor(desc),
    storage_path: path, mime: chk.mime, bytes: bytes.length, width: chk.width, height: chk.height, sha256: sha,
    license: kind === 'card' ? '카드뉴스 (앱에서 직접 만듦)' + (bgNote ? ' · 배경: ' + bgNote : '') : '직접 올림 (사용 권한 확인함)',
    rights_confirmed: kind === 'card' ? !bg || !!bg.rights_confirmed || bg.kind !== 'upload' : true,
    source_url: bg ? bg.source_url || '' : '', author_name: bg ? bg.author_name || '' : '', author_url: bg ? bg.author_url || '' : '',
    attribution_text: bg ? bg.attribution_text || (bg.kind === 'ai' ? '배경: AI로 만든 예시 이미지' : '') : '',
  };
  const r = await d.rpc('image_save', { img, link, gen: null, fin: null });
  if (r.error) { await d.remove([path]); return { ok: false, status: 500, code: 'server', error: r.error }; }
  return { ok: true, image: r.data.image, slot: r.data.slot, reused: false };
}
