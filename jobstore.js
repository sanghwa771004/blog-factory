// jobstore.js — '이 상품으로 장면 만들기' 작업 이어 하기 (1.5.2)
// 진행 상황을 이 기기 브라우저의 IndexedDB 에만 저장해 (서버로 보내지 않음). 새로고침하거나 화면을 닫았다 열어도 이어서 할 수 있게.
// 저장하는 것: 이미지 ID(상품·추가 사진·마스크·배경 후보·고른 후보·합성 결과)와 설정(목적·장면·각도·위치·그림자·밝기·비율·모델·품질).
// 저장하지 않는 것: 사진 파일, 서명 주소(1시간이면 닫힘 — 다시 열 때 ID로 새로 받음), 접속 코드·세션·API 키.
// 예외 하나: 손으로 고쳤는데 아직 서버에 저장하지 않은 마스크(남길 영역)는 PNG 로 같이 둠 (보통 수십~수백 KB).
// 보존: 마지막으로 고친 뒤 14일, 다 끝낸 작업은 3일, 많아야 8개(오래된 것부터 지움). 로그아웃하면 모두 지움.
// Safari 는 이 사이트를 7일 동안 안 쓰면 브라우저 저장소를 먼저 지울 수 있어 — 그때는 이어 하기가 안 보이고, 만든 이미지는 보관함(서버)에 그대로 있어.
import { cleanProductSpec, cleanLayer, validSlotKey, RATIOS } from './images.js?v=1.5.2';

export const JOB_VERSION = 1;
export const KEEP_DAYS = 14;
export const DONE_KEEP_DAYS = 3;
export const MAX_JOBS = 8;
export const MAX_CANDS = 12;
const DAY = 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const isId = (v) => typeof v === 'string' && UUID.test(v);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const FLOWS = ['layer', 'reference', 'bg_only'];

// 저장할 모양으로 정리 (모르는 칸은 버림 — 서명 주소·세션 같은 게 실수로 들어가도 남지 않게)
export function cleanJob(o, now = Date.now()) {
  const x = o && typeof o === 'object' ? o : {};
  if (!isId(x.id) || !isId(x.product_id)) return null;
  const m = x.mask && typeof x.mask === 'object' ? x.mask : null;
  const blob = typeof Blob !== 'undefined' && x.mask_png instanceof Blob && x.mask_png.size <= 8 * 1024 * 1024 ? x.mask_png : null;
  const cands = (Array.isArray(x.cands) ? x.cands : []).filter((c) => c && isId(c.image_id)).slice(-MAX_CANDS)
    .map((c) => ({ image_id: c.image_id, mode: c.mode === 'reference' ? 'reference' : 'layer', gen_id: isId(c.gen_id) ? c.gen_id : '' }));
  const created = Number.isFinite(Number(x.created_at)) ? Number(x.created_at) : now;
  return {
    v: JOB_VERSION, id: x.id, created_at: created, updated_at: Number.isFinite(Number(x.updated_at)) ? Number(x.updated_at) : now,
    post_id: isId(x.post_id) ? x.post_id : '', slot_key: validSlotKey(x.slot_key) ? x.slot_key : '',
    product_id: x.product_id, extra_ids: (Array.isArray(x.extra_ids) ? x.extra_ids : []).filter(isId).slice(0, 3),
    name: str(x.name, 60), flow: FLOWS.includes(x.flow) ? x.flow : '',
    spec: cleanProductSpec(x.spec), ratio: Object.prototype.hasOwnProperty.call(RATIOS, x.ratio) ? x.ratio : '',
    // 사용자가 직접 고른 장면 칸 (추정으로 다시 덮지 않게 — '지정 안 함'도 고른 것)
    user_set: [...new Set((Array.isArray(x.user_set) ? x.user_set : []).filter((k) => ['light', 'warmth', 'bright', 'shape'].includes(k)))],
    mode_id: str(x.mode_id, 30), quality: str(x.quality, 12), count: int(x.count, 1, 3, 1),
    mask: m ? { saved_id: isId(m.saved_id) ? m.saved_id : '', dirty: m.dirty === true && !!blob, method: str(m.method, 20), model: str(m.model, 20), edited: m.edited === true, w: int(m.w, 0, 4096, 0), h: int(m.h, 0, 4096, 0) } : null,
    mask_png: m && m.dirty === true ? blob : null,
    cands, pick_id: isId(x.pick_id) && cands.some((c) => c.image_id === x.pick_id) ? x.pick_id : '',
    layer: x.layer && typeof x.layer === 'object' ? cleanLayer(x.layer) : null,
    result_id: isId(x.result_id) ? x.result_id : '',
    pending_keys: (Array.isArray(x.pending_keys) ? x.pending_keys : []).filter((k) => typeof k === 'string' && KEY.test(k)).slice(-5),
    step: int(x.step, 1, 11, 1), done: x.done === true,
  };
}
// 지울 때가 된 작업인지
export const expiredJob = (j, now = Date.now()) => !j || now - Number(j.updated_at || 0) > (j.done ? DONE_KEEP_DAYS : KEEP_DAYS) * DAY;
// 이어 하기를 권할 작업: 이 원고(없으면 원고 없이 시작한 것)에서 끝내지 않은 가장 최근 작업
export function pickResumable(jobs, { postId = '' } = {}, now = Date.now()) {
  const list = (jobs || []).filter((j) => j && !j.done && !expiredJob(j, now) && (j.post_id || '') === (postId || ''));
  list.sort((a, b) => b.updated_at - a.updated_at);
  return list[0] || null;
}
// 이어 하기 안내 한 줄 (어디까지 했는지)
export const STEP_LABEL = { 1: '상품 사진 고름', 3: '남길 영역 정하는 중', 4: '목적 고름', 5: '장면 고름', 6: '모델 고름', 8: '후보 만들기 전', 9: '후보 고르는 중', 10: '위치·그림자 맞추는 중', 11: '결과 저장함' };
export function stepLabel(step) { const ks = Object.keys(STEP_LABEL).map(Number).filter((k) => k <= step); return STEP_LABEL[ks.length ? Math.max(...ks) : 1]; }

// ── 저장소 (IndexedDB · 시험용 메모리) ──
const errCode = (e) => {
  const n = String((e && (e.name || (e.target && e.target.error && e.target.error.name))) || '');
  return /Quota/i.test(n) ? 'quota' : 'failed';
};
export function memoryBackend() {
  const m = new Map();
  return { kind: 'memory', get: async (id) => (m.has(id) ? { ...m.get(id) } : null), put: async (r) => { m.set(r.id, { ...r }); }, delete: async (id) => { m.delete(id); },
    all: async () => [...m.values()].map((r) => ({ ...r })), clear: async () => { m.clear(); } };
}
export function idbBackend(idb = typeof indexedDB !== 'undefined' ? indexedDB : null, name = 'gf-jobs') {
  if (!idb) return null;
  let dbP = null;
  const open = () => dbP || (dbP = new Promise((ok, no) => {
    let req;
    try { req = idb.open(name, 1); } catch (e) { no(e); return; }
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('product')) db.createObjectStore('product', { keyPath: 'id' }); };
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => { try { db.close(); } catch { /* 무시 */ } dbP = null; }; ok(db); };
    req.onerror = () => no(req.error);
    req.onblocked = () => no(new Error('blocked'));
  }).catch((e) => { dbP = null; throw e; }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((ok, no) => {
      let t, out;
      try { t = db.transaction('product', mode); } catch (e) { no(e); return; }
      const st = t.objectStore('product');
      const r = fn(st);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => ok(out);
      t.onerror = () => no(t.error || (r && r.error));
      t.onabort = () => no(t.error || new Error('abort'));
    });
  };
  return { kind: 'idb', get: async (id) => (await tx('readonly', (s) => s.get(id))) || null, put: (r) => tx('readwrite', (s) => s.put(r)).then(() => undefined),
    delete: (id) => tx('readwrite', (s) => s.delete(id)).then(() => undefined), all: async () => (await tx('readonly', (s) => s.getAll())) || [], clear: () => tx('readwrite', (s) => s.clear()).then(() => undefined) };
}
// 결과: { ok: true } 또는 { ok: false, code: 'unavailable' | 'quota' | 'failed' } — 저장을 못 해도 작업은 계속됨 (화면이 알림)
export function createJobStore({ backend = idbBackend(), now = () => Date.now() } = {}) {
  const b = backend;
  const guard = async (fn) => { if (!b) return { ok: false, code: 'unavailable' }; try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, code: errCode(e) }; } };
  const sweepRaw = async () => {
    const all = (await b.all()).filter(Boolean);
    const t = now();
    const keep = all.filter((j) => !expiredJob(j, t)).sort((x, y) => y.updated_at - x.updated_at);
    const drop = [...all.filter((j) => expiredJob(j, t)), ...keep.slice(MAX_JOBS)];
    for (const j of drop) await b.delete(j.id);
    return drop.length;
  };
  const sweep = () => guard(sweepRaw);
  return {
    available: () => !!b,
    async save(job) {
      const j = cleanJob({ ...job, updated_at: now() }, now());
      if (!j) return { ok: false, code: 'failed' };
      const r = await guard(() => b.put(j));
      if (r.ok) sweep();
      return r;
    },
    get: (id) => guard(async () => { const j = await b.get(id); return j && !expiredJob(j, now()) ? cleanJob(j, now()) : null; }),
    // 열 때마다 기간이 지난 기록을 먼저 지움 (저장할 때만 지우면 안 쓰는 기기에 오래 남아서 — 1.5.2 검토)
    latest: (o) => guard(async () => { try { await sweepRaw(); } catch { /* 그래도 고르기는 함 */ } const j = pickResumable(await b.all(), o, now()); return j ? cleanJob(j, now()) : null; }),
    remove: (id) => guard(() => b.delete(id)),
    clear: () => guard(() => b.clear()),
    sweep,
  };
}
// 이 기기 브라우저 저장 공간 (모르면 null — Safari 옛 판 등)
export async function storageLeft() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) return null;
    const e = await navigator.storage.estimate();
    return Number.isFinite(e.quota) && Number.isFinite(e.usage) ? Math.max(0, e.quota - e.usage) : null;
  } catch { return null; }
}
