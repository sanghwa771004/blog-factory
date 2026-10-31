// product.js — '이 상품으로 장면 만들기' (1.5.1 · 1.5.2)
// 상품 사진 하나로 블로그 본문·대표 이미지·상품 상세·SNS·광고용 장면을 만듦. 두 방식은 목적과 한계가 달라서 섞지 않음:
//  · 원본 보존 합성(layer): 이 기기에서 상품 사진의 배경을 지우고(cutout.js — 무료, 사진이 밖으로 안 나감) AI가 만든 '빈 배경' 위에
//    원본 픽셀을 그대로 얹음. 위치·크기·회전·그림자·밝기를 바꿔도 상품은 다시 그리지 않음
//  · AI 실사 장면(reference): 상품 사진을 '대상 모양 유지' 참고 사진으로 보내 AI가 장면 전체를 그림 → 'AI 합성 이미지', 작은 글자·로고는 바뀔 수 있음
// 어느 쪽이든 상품 디테일 검수를 승인해야 '사용 가능'이 되고, 발행 준비 완료·예약·게시 완료로 바꿀 수 있음 (서버·DB도 같은 규칙)
// 유료 생성은 예상 비용을 보여준 뒤 버튼을 누를 때만. 앱은 블로그에 사진을 대신 올리지 않음
// 1.5.2: 첫 화면에서 세 방식(원본 보존 합성·AI 실사 장면·배경만) 고르기 · 작업 이어 하기(이 기기 IndexedDB — 이미지 ID와 설정만)
//        배경 지우기는 일꾼에서(진행률·취소·간단 모드) · 마스크 품질 점수·확대·다시 하기·가장자리 다듬기 · 빛·원근·그림자 자동 추천(추정 — 적용은 사용자가)
//        합성 저장 전 크기 확인·올리는 진행률·실패 이유·같은 요청으로 다시 저장 · 검수 화면 밀어서 비교·상품 부분 확대·원본 픽셀 비교 · 공급자 비교(유료는 따로 승인)
import * as IMG from './images.js?v=1.5.2';
import * as CUT from './cutout.js?v=1.5.2';
import * as FIT from './scenefit.js?v=1.5.2';
import { createJobStore, stepLabel, storageLeft } from './jobstore.js?v=1.5.2';

export const PRODUCT_ERR = {
  layer_no_refs: '원본 보존 합성은 상품 사진을 AI에 보내지 않아 (배경만 만들어). 추가 사진은 AI 실사 장면에서만 써.',
  product_photo_needed: '진짜 상품 사진(직접 올린 사진이나 Pexels 사진)이 있어야 해.',
  product_image_required: '상품 사진은 직접 올린 사진이나 Pexels 사진만 돼 (AI 이미지·합성 이미지는 원본 상품 사진이 아니야).',
  product_not_found: '상품 사진을 보관함에서 찾지 못했어 (지웠을 수 있어). 다시 골라줘.',
  background_not_found: '합성할 배경을 찾지 못했어 (지웠을 수 있어). 배경을 다시 만들어줘.',
  background_image_required: '합성할 배경은 AI가 만든 배경이어야 해.',
  ref_composite: '합성 이미지는 참고 사진으로 못 넣어. 원본 상품 사진을 넣어줘.',
  edit_mode_mismatch: '고칠 이미지의 방식이 달라 (원본 보존 합성은 그 배경, AI 실사 장면은 그 결과만 고칠 수 있어).',
  mask_mismatch: '이 마스크는 이 상품 사진의 것이 아니야. 영역을 다시 저장해줘.',
  mask_real_only: '배경 지우기는 진짜 사진(직접 올림·Pexels)에만 해.',
  mask_size_mismatch: '마스크 크기(비율)가 상품 사진과 달라. 다시 만들어줘.',
  product_check_needed: '상품 디테일 검수를 승인해야 해. 승인 전에는 사용 가능·발행 준비 완료로 못 바꿔.',
  product_check_incomplete: '아홉 칸이 모두 \'괜찮아\'여야 승인할 수 있어.',
  not_product_scene: '상품 장면으로 만든 이미지가 아니라서 상품 디테일 검수를 하지 않아.',
  background_mismatch: '원본 보존 합성은 이 상품용으로 만든 빈 배경에만 얹을 수 있어 (AI 실사 장면·다른 이미지 위에는 안 돼). 8번에서 배경을 만들어줘.',
  image_generating: '이 사진으로 지금 이미지를 만드는 중이야. 끝난 뒤에 지워줘.',
};
// 첫 화면의 세 방식 (지시서 11번): 결과와 한계를 짧게
export const PRODUCT_FLOWS = {
  layer: { label: IMG.PRODUCT_MODES.layer.label, got: '내 상품 사진 픽셀 그대로 + AI가 만든 빈 배경', limit: '빛·그림자·크기는 맞춰야 해 (자동 추천 있음). 상품 사진은 AI에 보내지 않아.' },
  reference: { label: IMG.PRODUCT_MODES.reference.label, got: 'AI가 상품 사진을 보고 장면 전체를 새로 그려 (더 자연스러움)', limit: "작은 글자·로고·버튼이 원본과 달라질 수 있어 — 원본과 꼭 비교해야 하고 'AI 합성 이미지'로 표시돼." },
  bg_only: { label: '배경만 만들기', got: '상품이 놓일 빈 배경만 만들어 보관함에 저장', limit: '상품은 나중에 직접 얹거나 다른 곳에서 써. 상품 사진은 빛·각도를 맞추는 데만 써 (AI에 안 보내).' },
};
const SAVE_REASON = {
  offline: '인터넷이 끊겼어. 연결되면 다시 저장을 눌러줘.',
  network: '서버에 닿지 못했어 (인터넷이 불안정할 수 있어). 다시 저장을 눌러줘.',
  timeout: '저장이 너무 오래 걸려서 기다리기를 멈췄어. 서버에는 저장됐을 수도 있어 — 다시 저장을 누르면 같은 요청 번호로 확인해서 두 장이 생기지 않아.',
  storage_failed: '보관함(Storage)에 파일을 넣지 못했어. 잠시 뒤에 다시 저장해줘.',
  storage_full: '보관함 저장 공간이 거의 찼어. 이미지 보관함에서 안 쓰는 이미지를 지운 뒤 다시 저장해줘.',
  server: '서버에서 문제가 생겼어. 잠시 뒤에 다시 저장해줘.',
};

export function createProduct(ui, kit) {
  const { h, btn, field, det, opt, api, run, toast, openSheet, closeSheet, go, L } = ui;
  const upload = typeof ui.upload === 'function' ? ui.upload : (path, fd, o = {}) => api(path, { method: 'POST', body: fd, timeout: o.timeout });
  // 1.5.2: 작업 이어 하기 (이 기기 브라우저 IndexedDB — 서버로 안 보냄)
  const JS = createJobStore();
  // 이 기기 처리 모드: 무거운 처리(배경 지우기·합성 저장) 중에 페이지가 꺼졌다 다시 열리면 (아이폰이 메모리가 모자라 페이지를 다시 읽는 경우가 많음)
  // 다음부터 '간단 모드'(작게 처리)로. 사용자가 '보통 모드로'를 누르면 다시 보통으로
  const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* 저장 안 되는 브라우저 */ } };
  const crashed = (() => { try { const x = JSON.parse(lsGet('gf-heavy') || 'null'); return x && Date.now() - Number(x.at) < 15 * 60e3 ? x : null; } catch { return null; } })();
  if (crashed) { lsSet('gf-tier-failed', '1'); lsSet('gf-heavy', ''); }
  const heavy = (stage) => lsSet('gf-heavy', stage ? JSON.stringify({ stage, at: Date.now() }) : '');
  const tier = () => CUT.deviceTier(CUT.capabilities(), { failed: lsGet('gf-tier-failed') === '1', force: lsGet('gf-tier') });
  const fmtMB = (n) => (Number(n || 0) / 1048576).toFixed(1);
  const { put, thumb, pickThumb, kindChip, reviewChip, sendGenerate, ensureSmall, modeChoices, keyOk, noKeyText, usageLine, genCost, prepareUpload, sourceSelect,
    newKey, newUuid, usd, refreshPost, TEST_MODEL, fmtBytes } = kit;
  const settings = () => (ui.S.settings || {});
  const prices = () => settings().image_prices || IMG.DEFAULT_PRICES;
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let PS = null;     // 지금 작업 (화면을 다시 그려도 남음 — 1.5.2: 새로고침해도 이 기기에 저장한 진행 상황으로 이어서 할 수 있음)
  let cfg = null;    // /images/config (키 있음/없음·사용량)

  // ═════════ 시작 ═════════
  // productId: 상품 사진(직접 올림·Pexels), resume: 다시 맞출 상품 장면 결과(합성·AI 실사 장면), postId·slotKey: 넣을 원고·자리
  function start(o = {}) {
    init(o);
    go(o.postId ? `content/post/${o.postId}/product` : 'content/product');
  }
  function init({ productId = '', postId = '', slotKey = '', resume = '', job = null } = {}) {
    PS = {
      jobId: newUuid(), created: Date.now(), flow: 'layer',
      postId, slotKey, product: null, extras: [], name: '', src: null, srcP: null,
      mask: null, maskMethod: '', maskModel: '', maskEdited: false, maskSaved: null, maskDirty: false, undo: [], redo: [], paint: false, tool: 'add', brush: 0.035, segNote: '', savedMasks: [],
      maskQ: null, maskBusy: null, zoom: 1, viewMode: 'pink',
      purpose: 'blog_body', mode: 'layer', template: 'table', angle: 'front', place: 'center', custom: '', light: '', warmth: '', bright: '', shape: '', est: {},
      ratio: '', modeId: '', quality: '', count: 1,
      busy: false, status: null, serverEst: null, newModel: '',
      cands: [], pick: -1, layer: null, result: null, parentId: '', editText: '', loading: !!(productId || resume || job), el: {},
      fitProd: null, rec: null, recBase: null, productTone: false, fitApplied: false,
      saveTry: null, saveErr: null, failedKeys: [], outLong: 0, offer: null, storeNote: '', resumeNote: '', done: false,
    };
    const ps = PS;
    if (job) resumeJob(ps, job);
    else if (resume) loadResume(ps, resume);
    else if (productId) api('/images/' + productId).then((j) => { if (PS !== ps) return; setProduct(j.image, j.masks || []); ps.loading = false; draw(); }).catch((e) => { ps.loading = false; if (e && e.code !== 'auth') toast(ui.errText(e)); draw(); });
    // 그냥 들어왔으면: 이 원고(또는 원고 없이)에서 하던 작업이 이 기기에 있는지 보고 '이어서 작업하기'를 권함
    else JS.latest({ postId }).then((r) => { if (PS === ps && !ps.product && r.ok && r.value) { ps.offer = r.value; draw(); } });
  }
  // ── 1.5.2 작업 이어 하기: 저장 (이미지 ID·설정만, 서명 주소·세션은 안 둠) ──
  const stepOf = (ps) => (ps.result ? 11 : ps.pick >= 0 && ps.mode === 'layer' ? 10 : ps.cands.length ? 9 : ps.mask && ps.maskSaved && !ps.maskDirty ? 4 : ps.mask ? 3 : 1);
  function jobOf(ps) {
    if (!ps || !ps.product || !ps.product.id) return null;
    const c = ps.pick >= 0 ? ps.cands[ps.pick] : null;
    return {
      id: ps.jobId, created_at: ps.created, post_id: ps.postId, slot_key: ps.slotKey, product_id: ps.product.id, extra_ids: ps.extras.map((x) => x.id),
      name: ps.name, flow: ps.flow, spec: specOf(ps), ratio: ps.ratio, mode_id: ps.modeId, quality: ps.quality, count: ps.count,
      mask: ps.mask ? { saved_id: ps.maskSaved ? ps.maskSaved.id : '', dirty: !!(ps.maskDirty || !ps.maskSaved), method: ps.maskMethod, model: ps.maskModel || '', edited: ps.maskEdited, w: ps.mask.w, h: ps.mask.h } : null,
      cands: ps.cands.filter((x) => x && x.image && x.image.id).map((x) => ({ image_id: x.image.id, mode: x.mode || ps.mode, gen_id: x.gen && x.gen.id ? x.gen.id : '' })),
      pick_id: c && c.image ? c.image.id : '', layer: ps.layer, result_id: ps.result && ps.result.id ? ps.result.id : '',
      pending_keys: ps.failedKeys, step: stepOf(ps), done: !!ps.done,
    };
  }
  let saveT = null;
  function schedulePersist() {
    const ps = PS;
    if (!ps || !ps.product || !JS.available()) return;
    clearTimeout(saveT);
    saveT = setTimeout(() => { persist(ps); }, 700);
  }
  async function persist(ps) {
    const j = jobOf(ps);
    if (!j) return;
    const sig = JSON.stringify(j) + '|' + (ps.maskRev || 0);
    if (sig === ps.persistSig) return;
    ps.persistSig = sig;
    // 서버에 아직 저장하지 않은 마스크(손으로 고친 영역)만 PNG 로 같이 (마스크가 바뀐 때만 다시 만듦)
    if (j.mask && j.mask.dirty && ps.mask) {
      if (ps.maskPngRev !== (ps.maskRev || 0)) { try { ps.maskPng = await CUT.toPngBlob(CUT.maskRGBA(ps.mask.data, ps.mask.w, ps.mask.h), ps.mask.w, ps.mask.h); ps.maskPngRev = ps.maskRev || 0; } catch { ps.maskPng = null; } }
      j.mask_png = ps.maskPng;
    }
    const r = await JS.save(j);
    let note = r.ok ? '' : r.code === 'quota' ? '이 기기 저장 공간이 모자라서 진행 상황을 저장하지 못했어. 만든 이미지는 보관함(서버)에 그대로 있어 — 공간을 비우면 다시 저장돼.'
      : r.code === 'unavailable' ? '이 브라우저는 진행 상황을 저장할 수 없어 (사생활 보호 모드일 수 있어). 새로고침하면 처음부터지만 만든 이미지는 보관함에 남아.' : '진행 상황을 이 기기에 저장하지 못했어 (만든 이미지는 보관함에 그대로).';
    if (r.ok && !ps.spaceChecked) { ps.spaceChecked = true; const left = await storageLeft(); if (left != null && left < 15 * 1048576) note = `이 기기 브라우저 저장 공간이 거의 없어 (${fmtMB(left)}MB 남음). 진행 상황 저장이 멈출 수 있어.`; }
    if (note !== ps.storeNote) { ps.storeNote = note; if (PS === ps) draw(); }
  }
  // 이어 하기: 이미지는 ID로 다시 불러와서 새 서명 주소를 받음 (지운 이미지는 빼고 알려줌)
  async function resumeJob(ps, job) {
    const miss = [];
    try {
      const j = await api('/images/' + job.product_id);
      if (PS !== ps) return;
      setProduct(j.image, j.masks || []);
      const sp = job.spec || {};
      Object.assign(ps, { jobId: job.id, created: job.created_at, flow: job.flow || (sp.mode === 'reference' ? 'reference' : 'layer'), mode: sp.mode === 'reference' ? 'reference' : 'layer',
        template: sp.template || 'table', purpose: sp.purpose || 'blog_body', angle: sp.angle || 'front', place: sp.place || 'center', custom: sp.custom || '',
        light: sp.light || '', warmth: sp.warmth || '', bright: sp.bright || '', shape: sp.shape || '', name: job.name || ps.name,
        ratio: job.ratio || '', modeId: job.mode_id || '', quality: job.quality || '', count: job.count || 1, layer: job.layer ? IMG.cleanLayer(job.layer) : null, failedKeys: (job.pending_keys || []).slice() });
      for (const id of job.extra_ids || []) { try { const x = await api('/images/' + id); if (x && x.image) ps.extras.push(x.image); else miss.push('추가 사진'); } catch { miss.push('추가 사진'); } }
      if (job.mask) {
        const sm = job.mask.saved_id ? (j.masks || []).find((m) => m.id === job.mask.saved_id) : null;
        let m = null;
        if (job.mask.dirty && job.mask_png) { try { m = await CUT.maskFromPng(job.mask_png); } catch { miss.push('고친 영역'); } }
        if (!m && sm) { try { m = await CUT.maskFromPng(sm.url); } catch { miss.push('저장한 영역'); } }
        else if (!m && job.mask.saved_id) miss.push('저장한 영역');
        if (m && PS === ps) {
          ps.mask = m; ps.maskMethod = job.mask.method || 'manual'; ps.maskModel = job.mask.model || ''; ps.maskEdited = !!job.mask.edited; ps.maskRev = 1;
          if (sm) { ps.maskSaved = sm; if (!(job.mask.dirty && job.mask_png)) ps.maskSavedMask = { data: Uint8ClampedArray.from(m.data), w: m.w, h: m.h }; }
          ps.maskDirty = !!(job.mask.dirty && job.mask_png) || !sm;
        }
      }
      for (const c of job.cands || []) {
        try { const x = await api('/images/' + c.image_id); if (x && x.image && !x.image.deleted_at) ps.cands.push({ image: x.image, gen: x.generation || null, mode: c.mode }); else miss.push('후보'); } catch { miss.push('후보'); }
      }
      ps.pick = job.pick_id ? ps.cands.findIndex((c) => c.image.id === job.pick_id) : -1;
      if (ps.mode === 'reference' && ps.pick >= 0) ps.result = ps.cands[ps.pick].image;
      if (job.result_id && ps.mode === 'layer') { try { const x = await api('/images/' + job.result_id); if (x && x.image && !x.image.deleted_at) { ps.result = x.image; ps.savedId = x.image.id; ps.parentId = x.image.id; } else miss.push('합성 결과'); } catch { miss.push('합성 결과'); } }
      if (ps.failedKeys.length) cleanupFailed(ps);
      ps.resumeNote = miss.length ? `지웠거나 찾지 못한 것(${[...new Set(miss)].join('·')})은 빼고 불러왔어.` : '하던 작업을 이어서 불러왔어. 사진 주소는 새로 받았어.';
      if (ps.mask) requalify(ps);
    } catch (e) {
      if (e && e.code !== 'auth') toast('이어서 하지 못했어: ' + ui.errText(e), 4000);
      if (e && e.code === 'not_found') JS.remove(job.id);
    }
    if (PS === ps) { ps.loading = false; draw(); }
  }
  // 끝내 저장하지 못한 합성 파일만 정리 (그 요청 번호의 파일 — 원본 상품·배경·마스크는 경로가 달라서 안 지워짐)
  async function cleanupFailed(ps) {
    const keys = ps.failedKeys.slice(0, 10);
    if (!keys.length) return;
    try { await api('/images/composite/cleanup', { method: 'POST', body: { request_keys: keys } }); ps.failedKeys = ps.failedKeys.filter((k) => !keys.includes(k)); schedulePersist(); } catch { /* 다음에 다시 */ }
  }
  async function loadResume(ps, id) {
    try {
      const j = await api('/images/' + id);
      if (PS !== ps) return;
      const img = j.image, t = j.product;
      if (!t || !t.product) { ps.loading = false; toast('원본 상품 사진을 찾지 못했어 (지웠을 수 있어). 새로 시작해줘.', 4000); draw(); return; }
      setProduct(t.product, []);
      const sc = img.scene || {};
      for (const k of ['template', 'purpose', 'angle', 'place']) if (sc[k]) ps[k] = sc[k];
      ps.mode = t.mode;
      ps.ratio = img.ratio || '';
      if (t.mode === 'layer') {
        ps.layer = IMG.cleanLayer(img.layer);
        ps.parentId = img.id;
        ps.result = img;
        if (t.mask && t.mask.url) {
          const m = await CUT.maskFromPng(t.mask.url);
          if (PS !== ps) return;
          ps.mask = m; ps.maskSaved = t.mask; ps.maskSavedMask = { data: Uint8ClampedArray.from(m.data), w: m.w, h: m.h }; ps.maskMethod = t.mask.method; ps.maskModel = modelOfMask(t.mask); ps.maskEdited = !!t.mask.edited; ps.maskDirty = false; ps.maskRev = (ps.maskRev || 0) + 1;
        }
        if (t.background) { ps.cands = [{ image: t.background, gen: null, mode: 'layer' }]; ps.pick = 0; }
      } else {
        ps.result = img;
        ps.cands = [{ image: img, gen: j.generation || null, mode: 'reference' }];
        ps.pick = 0;
      }
    } catch (e) { if (e && e.code !== 'auth') toast(ui.errText(e)); }
    if (PS === ps) { ps.loading = false; draw(); }
  }
  function setProduct(img, masks) {
    PS.product = img;
    PS.offer = null;
    PS.name = PS.name || clean(img.description || '').slice(0, 60);
    PS.src = null; PS.mask = null; PS.maskSaved = null; PS.maskDirty = false; PS.undo = []; PS.redo = []; PS.maskMethod = ''; PS.maskModel = ''; PS.segNote = ''; PS.maskQ = null; PS.maskView = null; PS.prev = null;
    PS.savedMasks = masks || [];
    PS.cands = []; PS.pick = -1; PS.result = null; PS.parentId = '';
    PS.fitProd = null; PS.rec = null; PS.recBase = null;
    // 추정으로 채운 빛·색·밝기는 다른 사진이면 다시 추정 (사용자가 고른 값은 그대로)
    for (const k of ['light', 'warmth', 'bright', 'shape']) if (PS.est[k]) { PS[k] = ''; PS.est[k] = false; }
    PS.srcP = img && img.url ? CUT.decodeImage(img.url, tier().sizes.decode).then((s) => { if (PS && PS.product === img) { PS.src = s; draw(); } return s; }) : null;
    if (PS.srcP) PS.srcP.catch(() => { if (PS) { PS.segNote = '상품 사진을 불러오지 못했어. 새로고침한 뒤 다시 해줘 (주소는 1시간 동안만 열려).'; draw(); } });
  }
  const specOf = (ps) => IMG.cleanProductSpec({ mode: ps.mode, template: ps.template, purpose: ps.purpose, angle: ps.angle, place: ps.place, custom: ps.custom, name: ps.name,
    light: ps.light, warmth: ps.warmth, bright: ps.bright, shape: ps.shape });
  const spec = () => specOf(PS);
  const prefRatio = (pu) => { const r = (settings().image_ratio_prefs || {})[pu]; const rs = (IMG.PURPOSES[pu] || IMG.PURPOSES.blog_body).ratios; return rs.includes(r) ? r : rs[0]; };
  const post = () => (PS.postId ? ui.post(PS.postId) : null);

  // ═════════ 화면 ═════════
  function view(postId) {
    const box = h('div', { class: 'view product' });
    hookPage();
    // 바로 주소로 들어온 경우 (새로고침 등)·다른 원고: 새 작업으로 (주소는 이미 맞아서 화면만 새로) — 이 기기에 하던 작업이 있으면 '이어서 작업하기'를 권함
    if (!PS || (postId || '') !== (PS.postId || '')) init({ postId: postId || '' });
    PS.root = box;
    draw(true);
    if (!cfg) api('/images/config').then((j) => { cfg = j; draw(); }).catch(() => {});
    return box;
  }
  // 화면을 내리거나 다른 앱으로 가면: 진행 상황을 바로 저장하고, 배경 지우기 도구를 메모리에서 내림 (아이폰이 페이지를 닫지 않게)
  let hooked = false;
  function hookPage() {
    if (hooked || typeof document === 'undefined') return;
    hooked = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (PS) { clearTimeout(saveT); persist(PS); }
        if (!PS || !PS.maskBusy) CUT.releaseSegmenter();
        else PS.maskBusy.hiddenAt = Date.now();
      } else if (PS && PS.maskBusy && PS.maskBusy.hiddenAt) { PS.maskBusy.wasHidden = true; fillMaskProg(); }
    });
    window.addEventListener('pagehide', () => { if (PS) persist(PS); CUT.releaseSegmenter(); });
  }
  function draw(force) {
    if (!PS || !PS.root || (!force && !PS.root.isConnected)) return;
    const p = post();
    const back = PS.postId ? btn('← 원고', 'sm ghost back', () => go('content/post/' + PS.postId)) : btn('← 이미지 보관함', 'sm ghost back', () => go('content/images'));
    put(PS.root, back,
      h('section', { class: 'panel' }, h('h2', null, '이 상품으로 장면 만들기'),
        h('p', { class: 'hint' }, `${p ? `원고: ${ui.titleOf(p)} · ` : ''}상품 사진 하나로 블로그·SNS·광고용 장면을 만들어. 버튼을 누를 때만 만들고, 유료 모델은 예상 비용을 먼저 보여줘.`),
        PS.loading ? h('p', { class: 'hint' }, '불러오는 중…') : null,
        PS.resumeNote ? h('p', { class: 'okbox' }, PS.resumeNote) : null,
        PS.storeNote ? h('p', { class: 'notice' }, PS.storeNote) : null),
      secOffer(), secFlow(), secProgress(),
      secProduct(), secExtras(), secMask(), secScene(), secGenerate(), secCandidates(), secResult(), secInsert());
    schedulePersist();
  }
  const step = (n, title, ...kids) => h('section', { class: 'panel pstep', id: 'pstep-' + n }, h('h3', null, h('span', { class: 'stepn' }, String(n)), ' ', title), ...kids);
  // ── 하던 작업 이어 하기 / 새로 시작하기 ──
  function secOffer() {
    const o = PS.offer;
    if (!o || PS.product) return null;
    const when = new Date(o.updated_at).toISOString();
    return h('section', { class: 'panel resume' }, h('h3', null, '하던 작업이 있어'),
      h('p', null, `${o.name || '상품'} · ${(PRODUCT_FLOWS[o.flow] || PRODUCT_FLOWS[o.spec.mode] || PRODUCT_FLOWS.layer).label} · ${stepLabel(o.step)} · ${L.fmtTime(when)}`),
      h('div', { class: 'go' },
        btn('이어서 작업하기', 'sm', () => { const root = PS.root; const job = PS.offer; init({ postId: job.post_id, slotKey: job.slot_key, job }); PS.root = root; draw(true); }),
        btn('새로 시작하기', 'sm ghost', async () => { const job = PS.offer; PS.offer = null; draw(); await JS.remove(job.id); toast('하던 작업 기록을 지웠어 (만든 이미지는 보관함에 그대로 있어)'); })),
      h('p', { class: 'hint' }, '진행 상황은 이 기기 브라우저에만 저장돼 (이미지 번호와 설정만 — 사진 파일·로그인 정보는 안 둠). 마지막으로 고친 뒤 14일, 다 끝낸 작업은 3일 뒤에 지워지고, 로그아웃하면 바로 지워져.'));
  }
  // ── 무엇을 만들까 (세 방식) ──
  function setFlow(k) {
    if (PS.busy) { toast('만드는 중에는 방식을 바꿀 수 없어. 끝난 뒤에 바꿔줘.'); return; }
    if (PS.flow === k) return;
    const mode = k === 'reference' ? 'reference' : 'layer';
    // 다른 방식의 결과가 섞이지 않게 (AI 실사 장면 결과가 원본 보존 합성의 배경이 되지 않게 — 1.5.1 검토)
    if (PS.mode !== mode) { PS.cands = []; PS.pick = -1; PS.result = null; PS.parentId = ''; }
    PS.flow = k; PS.mode = mode; PS.serverEst = null;
    if (k === 'bg_only') PS.template = 'bg_only'; else if (PS.template === 'bg_only') PS.template = 'table';
    draw();
  }
  function secFlow() {
    const card = (k) => h('button', { type: 'button', class: 'modecard', 'aria-pressed': String(PS.flow === k), disabled: !!PS.busy && PS.flow !== k, onclick: () => setFlow(k) },
      h('b', null, PRODUCT_FLOWS[k].label), h('small', null, '결과: ' + PRODUCT_FLOWS[k].got), h('small', { class: 'lim' }, '한계: ' + PRODUCT_FLOWS[k].limit));
    return h('section', { class: 'panel pstep', id: 'pstep-0' }, h('h3', null, '무엇을 만들까?'),
      h('div', { class: 'modecards three' }, card('layer'), card('reference'), card('bg_only')),
      PS.mode === 'reference' ? h('p', { class: 'notice' }, "AI가 상품까지 다시 그려서 작은 글자·로고·버튼·구성품이 원본과 달라질 수 있어. 결과는 'AI 합성 이미지'로 표시되고, 원본과 비교해서 승인해야 써.")
        : h('p', { class: 'hint' }, '상품 사진은 AI에 보내지 않아. AI는 상품이 놓일 자리를 비운 배경만 만들고, 상품은 이 기기에서 원본 그대로 얹어.'));
  }
  // 진행 단계 (눌러서 그 단계로)
  const resultImg = () => (PS.mode === 'layer' ? (PS.result && PS.result.kind === 'composite' ? PS.result : null) : candOf(PS.pick) ? candOf(PS.pick).image : null);
  function secProgress() {
    if (!PS.product) return null;
    const layer = PS.mode === 'layer';
    const r = resultImg();
    const items = [
      ['사진', true, 'pstep-1'], ['영역', !layer || (!!PS.maskSaved && !PS.maskDirty), 'pstep-3'], ['장면', PS.cands.length > 0, 'pstep-4'], ['만들기', PS.cands.length > 0, 'pstep-5'],
      [layer ? '맞추기·저장' : '고르기', !!r, layer ? 'pstep-7' : 'pstep-6'], ['검수·넣기', !!(r && IMG.productApproved(r)), 'pstep-8'],
    ];
    const cur = items.findIndex((x) => !x[1]);
    return h('ol', { class: 'pprog', 'aria-label': '진행 단계' }, ...items.map(([l, done, id], i) => h('li', { class: done ? 'done' : i === cur ? 'cur' : '' },
      h('button', { type: 'button', onclick: () => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, `${i + 1} ${l}${done ? ' ✓' : ''}`))));
  }

  // ── 1. 상품 사진 ──
  function secProduct() {
    const P = PS.product;
    if (!P) {
      return step(1, '상품 사진',
        h('p', { class: 'hint' }, '상품이 잘 보이는 사진 한 장 (직접 찍은 사진이 제일 좋아). 배경이 단순할수록 배경 지우기가 잘 돼.'),
        h('div', { class: 'go' }, btn('사진 올리기', 'sm', () => uploadSheet((img) => { setProduct(img, []); draw(); })), btn('보관함에서 고르기', 'sm ghost', () => pickSheet((img) => { setProduct(img, []); draw(); api('/images/' + img.id).then((j) => { if (PS && PS.product && PS.product.id === img.id) { PS.savedMasks = j.masks || []; draw(); } }).catch(() => {}); }))));
    }
    if (!PS.el.name) {
      PS.el.name = h('input', { type: 'text', maxlength: '60', placeholder: '예: 포근 전기요 (보관함 설명용)' });
      PS.el.name.addEventListener('input', () => { PS.name = PS.el.name.value; });
    }
    PS.el.name.value = PS.name;
    return step(1, '상품 사진',
      h('div', { class: 'refrow' }, thumb(P, null), h('div', { class: 'stack' }, h('div', { class: 'chips' }, kindChip(P)), h('small', { class: 'hint' }, `${P.width}×${P.height}${P.kind === 'stock' ? ' · ' + (P.attribution_text || 'Pexels') : ''}`),
        P.kind === 'upload' && P.source_type !== 'own' ? h('small', { class: 'hint' }, '직접 찍은 사진이 아니면 그 사진의 이용 조건을 꼭 확인해줘.') : null)),
      field('상품 이름 (선택)', PS.el.name, '보관함 설명·대체 텍스트에만 써. AI에는 보내지 않아 (이름을 보면 AI가 글자를 지어낼 수 있어서).'),
      h('div', { class: 'go' }, btn('다른 사진으로', 'sm ghost', () => pickSheet((img) => { setProduct(img, []); draw(); })), btn('새 사진 올리기', 'sm ghost', () => uploadSheet((img) => { setProduct(img, []); draw(); }))),
      h('p', { class: 'hint' }, '원본 사진은 보관함에 그대로 남고 고치지 않아. 합성 결과는 새 이미지로 따로 저장돼.'));
  }
  // ── 2. 추가 사진 (앞·뒤·옆) ──
  function secExtras() {
    if (!PS.product) return null;
    const d = det('pscene-extras', `추가 사진 (선택) ${PS.extras.length}/3`, PS.extras.length > 0, 'panel pstep');
    d.append(h('p', { class: 'hint' }, "같은 상품의 다른 면(뒷면·옆면·버튼 가까이) 사진. 'AI 실사 장면'에서 참고 사진으로 같이 보내고, 검수할 때 비교에 써. '원본 보존 합성'은 첫 사진만 써."),
      ...PS.extras.map((x, i) => h('div', { class: 'refrow' }, thumb(x, null), h('small', null, IMG.originLabel(x)), btn('빼기', 'sm ghost', () => { PS.extras.splice(i, 1); draw(); }))),
      PS.extras.length < 3 ? h('div', { class: 'go' }, btn('올리기', 'sm ghost', () => uploadSheet((img) => { if (img.id !== PS.product.id && !PS.extras.some((x) => x.id === img.id)) PS.extras.push(img); draw(); })),
        btn('보관함에서', 'sm ghost', () => pickSheet((img) => { if (img.id !== PS.product.id && !PS.extras.some((x) => x.id === img.id)) PS.extras.push(img); draw(); }))) : null);
    return d;
  }
  // ── 3. 보존할 영역 (배경 지우기 · 마스크) ──
  // 1.5.2: 일꾼에서 처리(진행률·취소), 품질 점수(추정), 확대·다시 하기·가장자리 다듬기, 결과를 흰·검은 바탕으로 보기, 간단 모드
  function secMask() {
    if (!PS.product) return null;
    const need = PS.mode === 'layer';
    const T = tier();
    const kids = [h('p', { class: 'hint' }, need ? '원본 보존 합성은 여기서 남긴 부분(상품)만 원본 픽셀 그대로 배경 위에 얹어. 이 기기 안에서 처리해서 무료이고 사진이 밖으로 나가지 않아.'
      : "AI 실사 장면은 마스크 없이 만들 수 있어 (건너뛰어도 돼). 영역을 정하면 빛·색 추정에 쓰고, 원본 보존 합성도 바로 할 수 있어.")];
    if (T.reasons.length) kids.push(h('p', { class: 'notice' }, T.reasons.map((r) => CUT.TIER_MSG[r]).filter(Boolean).join(' '),
      T.lite && T.model ? h('span', null, ' ', btn('보통 크기로 처리하기', 'sm ghost', () => { lsSet('gf-tier', 'normal'); lsSet('gf-tier-failed', ''); if (PS.product) setProduct(PS.product, PS.savedMasks); draw(); })) : null));
    else kids.push(h('p', { class: 'hint' }, `처리 크기: ${T.lite ? '간단 모드' : '보통'} (사진 긴 변 ${T.sizes.decode}px까지 · 영역 ${T.sizes.mask}px) `,
      btn(T.lite ? '보통 크기로' : '간단 모드로 (느린 기기·메모리가 모자랄 때)', 'sm ghost', () => { lsSet('gf-tier', T.lite ? 'normal' : 'lite'); if (T.lite) lsSet('gf-tier-failed', ''); if (PS.product) setProduct(PS.product, PS.savedMasks); draw(); })));
    if (PS.segNote) kids.push(h('p', { class: 'notice' }, PS.segNote));
    if (!PS.src) { kids.push(h('p', { class: 'hint' }, '상품 사진을 불러오는 중…')); return step(3, '상품에서 남길 영역 확인', ...kids); }
    if (PS.maskBusy) kids.push(maskProgressBox());
    const busy = !!PS.maskBusy;
    if (!PS.mask) {
      kids.push(h('div', { class: 'go' },
        btn('자동으로 배경 지우기 (이 기기에서 · 무료)', 'sm', () => autoMask(true, false), { disabled: busy }),
        T.model ? btn('정밀하게 (2단계 · 시간이 두 배)', 'sm ghost', () => autoMask(true, true), { disabled: busy }) : null,
        btn('간단히 (흰 배경·단색 배경 사진)', 'sm ghost', () => autoMask(false, false), { disabled: busy }),
        PS.savedMasks.length ? btn('저장해 둔 영역 쓰기', 'sm ghost', (ev) => useSavedMask(ev.currentTarget, PS.savedMasks[0]), { disabled: busy }) : null),
      h('p', { class: 'hint' }, "처음 한 번 배경 지우기 도구(약 19MB)를 받아서 이 기기에 저장해 둬 — Wi-Fi에서 권장. 다음부터는 바로 돼. '정밀하게'는 상품 부분만 한 번 더 봐서 가는 끈·털·가장자리가 나아질 수 있어."));
      return step(3, '상품에서 남길 영역 확인', ...kids);
    }
    const m = PS.mask;
    if (!PS.el.maskCv) PS.el.maskCv = maskCanvas();
    const cv = PS.el.maskCv;
    cv.style.width = PS.zoom > 1 ? `${PS.zoom * 100}%` : '';
    paintMask();
    const tools = h('div', { class: 'seg', role: 'group', 'aria-label': '붓' }, ...[['add', '남기기'], ['erase', '지우기']].map(([k, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(PS.tool === k), onclick: () => { PS.tool = k; draw(); } }, l)));
    const size = h('input', { type: 'range', min: '0.005', max: '0.12', step: '0.005', value: String(PS.brush), 'aria-label': '붓 크기' });
    size.addEventListener('input', () => { PS.brush = Number(size.value); });
    const cov = CUT.maskCoverage(m.data);
    const q = PS.maskQ;
    const seg = (label, cur, list, set) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, ...list.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(cur === k), onclick: () => set(k) }, l)));
    kids.push(
      q ? h('div', { class: 'mq mq-' + q.level }, h('b', null, `영역 품질 (추정): ${CUT.MASK_LEVEL[q.level]} · ${q.score}점`),
        ...q.issues.map((k) => h('small', null, CUT.MASK_QUALITY_MSG[k])),
        h('small', { class: 'hint' }, '정답을 모르고 보는 점수야 — 점수가 높아도 확대해서 가장자리를 직접 확인해줘.')) : null,
      // 버튼 묶음은 label 로 감싸지 않음 (label 안 첫 버튼의 이름이 label 글 전체가 돼서 — 화면 읽기·시험에서 '전체' 버튼을 못 찾음)
      h('div', { class: 'row' }, h('div', { class: 'stack' }, h('span', { class: 'legend' }, '보기'), seg('보기', PS.viewMode, [['pink', '지울 곳 표시'], ['white', '흰 바탕'], ['black', '검은 바탕']], (k) => { PS.viewMode = k; paintMask(); draw(); })),
        h('div', { class: 'stack' }, h('span', { class: 'legend' }, '확대'), seg('확대', PS.zoom, [[1, '전체'], [2, '2배'], [4, '4배']], (k) => { PS.zoom = k; draw(); }))),
      h('div', { class: 'maskwrap' + (PS.paint ? ' painting' : '') + (PS.zoom > 1 ? ' zoomed' : '') }, cv),
      h('p', { class: 'hint' }, `${PS.viewMode === 'pink' ? '분홍색으로 덮인 곳이 지울 곳이야. ' : '남긴 부분만 바탕 위에 보여 — 가장자리에 원래 배경이 남았는지 봐. '}남긴 부분 ${Math.round(cov * 100)}% · ${m.w}×${m.h} · ${IMG.MASK_METHODS[PS.maskMethod] || '직접 칠함'}${PS.maskEdited ? ' · 손으로 고침' : ''}${PS.zoom > 1 ? ' · 확대 중 (칠하기를 끄면 밀어서 움직여)' : ''}`),
      h('div', { class: 'go' }, btn(PS.paint ? '칠하기 끄기 (화면 움직이기)' : '칠해서 고치기', PS.paint ? 'sm' : 'sm ghost', () => { PS.paint = !PS.paint; draw(); }),
        PS.paint ? tools : null, PS.paint ? field('붓 크기', size) : null,
        btn('되돌리기', 'sm ghost', () => undoMask(), { disabled: !PS.undo.length || busy }),
        btn('다시 하기', 'sm ghost', () => redoMask(), { disabled: !PS.redo.length || busy })),
      h('div', { class: 'go' },
        btn('가장자리 다듬기', 'sm ghost', () => edgeOp((d, w, hh) => CUT.refineEdges(d, maskBase(), w, hh)), { disabled: busy }),
        btn('1칸 넓히기', 'sm ghost', () => edgeOp((d, w, hh) => CUT.growMask(d, w, hh, 1)), { disabled: busy }),
        btn('1칸 좁히기', 'sm ghost', () => edgeOp((d, w, hh) => CUT.growMask(d, w, hh, -1)), { disabled: busy }),
        btn('작은 조각·구멍 정리', 'sm ghost', () => edgeOp((d, w, hh) => CUT.keepMain(d, w, hh)), { disabled: busy })),
      h('div', { class: 'go' }, btn('다시 자동으로', 'sm ghost', () => autoMask(true, false), { disabled: busy }), T.model ? btn('정밀하게', 'sm ghost', () => autoMask(true, true), { disabled: busy }) : null,
        btn('간단히', 'sm ghost', () => autoMask(false, false), { disabled: busy }),
        btn(PS.maskSaved && !PS.maskDirty ? '영역 저장됨 ✓' : '이 영역 저장', PS.maskSaved && !PS.maskDirty ? 'sm ghost' : 'sm', (ev) => saveMask(ev.currentTarget), { disabled: !!(PS.maskSaved && !PS.maskDirty) || busy })),
      cov < 0.02 ? h('p', { class: 'badbox' }, '남긴 부분이 거의 없어. 칠해서 상품을 남기거나 다시 자동으로 해줘.') : null,
      cov > 0.97 ? h('p', { class: 'notice' }, '거의 다 남았어 — 배경이 안 지워진 것 같아. 지우기 붓으로 배경을 지워줘.') : null,
      h('p', { class: 'hint' }, "'가장자리 다듬기'는 경계 근처만 사진의 실제 윤곽에 맞춰 다시 그려 (손으로 칠한 안쪽·바깥은 그대로). 합성 화면의 '가장자리 안쪽으로'로도 남은 배경을 깎을 수 있어. 저장해도 원본 사진은 그대로야."));
    return step(3, '상품에서 남길 영역 확인', ...kids);
  }
  const modelOfMask = (m) => (m && m.params && typeof m.params.model === 'string' ? m.params.model.slice(0, 20) : '');
  // 되돌리기·다시 하기용: 마스크와 그때의 방법·고침 여부·저장 상태. 메모리를 생각해서 마스크 크기에 따라 3~12번까지
  const snapOf = (ps) => ({ data: Uint8ClampedArray.from(ps.mask.data), w: ps.mask.w, h: ps.mask.h, edited: ps.maskEdited, method: ps.maskMethod, model: ps.maskModel, dirty: ps.maskDirty, saved: ps.maskSaved });
  const undoCap = (ps) => Math.max(3, Math.min(12, Math.floor(24e6 / Math.max(1, ps.mask.w * ps.mask.h))));
  const pushUndo = (ps) => { ps.undo.push(snapOf(ps)); while (ps.undo.length > undoCap(ps)) ps.undo.shift(); ps.redo = []; };
  const restoreSnap = (ps, u) => {
    // 되돌리면 그때의 방법·'손으로 고침'·저장 상태도 같이 (저장한 영역 그대로면 다시 저장하지 않아도 됨)
    ps.mask = { data: u.data, w: u.w, h: u.h }; ps.maskEdited = u.edited; ps.maskMethod = u.method; ps.maskModel = u.model || ''; ps.maskDirty = u.dirty || u.saved !== ps.maskSaved;
    ps.maskRev = (ps.maskRev || 0) + 1; requalify(ps);
  };
  function undoMask() { const u = PS.undo.pop(); if (!u) return; PS.redo.push(snapOf(PS)); restoreSnap(PS, u); draw(); }
  function redoMask() { const u = PS.redo.pop(); if (!u) return; PS.undo.push(snapOf(PS)); restoreSnap(PS, u); draw(); }
  // 마스크 크기로 줄인 상품 사진 (보기·품질 점수·가장자리 다듬기용)
  const maskBase = (ps = PS) => { const m = ps.mask; if (!ps.maskView || ps.maskView.w !== m.w || ps.maskView.h !== m.h) ps.maskView = { w: m.w, h: m.h, base: shrinkTo(ps.src, m.w, m.h) }; return ps.maskView.base; };
  function requalify(ps = PS) { if (!ps.mask || !ps.src) { ps.maskQ = null; return; } ps.maskQ = CUT.maskQuality(ps.mask.data, ps.mask.w, ps.mask.h, maskBase(ps)); }
  function edgeOp(fn) {
    if (!PS.mask || !PS.src) return;
    pushUndo(PS);
    const m = PS.mask;
    PS.mask = { data: fn(m.data, m.w, m.h), w: m.w, h: m.h };
    PS.maskDirty = true; PS.maskEdited = true; PS.maskRev = (PS.maskRev || 0) + 1;
    requalify(PS);
    draw();
  }
  function maskCanvas() {
    const cv = h('canvas', { class: 'maskcv', 'aria-label': '상품 영역 (칠해서 고치기)' });
    let last = null, snap = false;
    const at = (e) => { const b = cv.getBoundingClientRect(); return { x: ((e.clientX - b.left) / b.width) * PS.mask.w, y: ((e.clientY - b.top) / b.height) * PS.mask.h }; };
    let raf = 0;
    const redrawSoon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintMask(); }); };
    cv.addEventListener('pointerdown', (e) => {
      if (!PS.paint || !PS.mask || PS.maskBusy) return;
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
      if (!snap) { pushUndo(PS); snap = true; }
      last = at(e);
      CUT.brush(PS.mask.data, PS.mask.w, PS.mask.h, last.x, last.y, PS.brush * Math.max(PS.mask.w, PS.mask.h), PS.tool === 'add');
      redrawSoon();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!PS.paint || !last) return;
      e.preventDefault();
      const p = at(e);
      CUT.stroke(PS.mask.data, PS.mask.w, PS.mask.h, last, p, PS.brush * Math.max(PS.mask.w, PS.mask.h), PS.tool === 'add');
      last = p;
      redrawSoon();
    });
    const end = () => { if (last) { last = null; snap = false; PS.maskDirty = true; PS.maskEdited = true; PS.maskRev = (PS.maskRev || 0) + 1; requalify(PS); draw(); } };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    return cv;
  }
  // 마스크 보기: '지울 곳 표시'는 지울 곳을 분홍색으로 덮고 남길 곳은 원본 그대로, '흰·검은 바탕'은 남긴 부분만 그 바탕 위에 (가장자리 잔상 확인)
  function paintMask() {
    const cv = PS.el.maskCv, m = PS.mask;
    if (!cv || !m || !PS.src) return;
    const b = maskBase();
    const out = new Uint8ClampedArray(m.w * m.h * 4);
    const mode = PS.viewMode;
    const bgc = mode === 'black' ? 0 : 255;
    for (let p = 0; p < m.w * m.h; p++) {
      if (mode === 'pink') {
        const t = 0.62 * (1 - m.data[p] / 255);
        out[p * 4] = b[p * 4] * (1 - t) + 255 * t; out[p * 4 + 1] = b[p * 4 + 1] * (1 - t) + 70 * t; out[p * 4 + 2] = b[p * 4 + 2] * (1 - t) + 150 * t;
      } else {
        const a = m.data[p] / 255;
        out[p * 4] = b[p * 4] * a + bgc * (1 - a); out[p * 4 + 1] = b[p * 4 + 1] * a + bgc * (1 - a); out[p * 4 + 2] = b[p * 4 + 2] * a + bgc * (1 - a);
      }
      out[p * 4 + 3] = 255;
    }
    cv.width = m.w; cv.height = m.h;
    cv.getContext('2d').putImageData(new ImageData(out, m.w, m.h), 0, 0);
  }
  const shrinkTo = (src, w, hh) => { if (src.w === w && src.h === hh) return src.data; const f = CUT.resample(src.data, src.w, src.h, w, hh, 4); const d = new Uint8ClampedArray(f.length); for (let i = 0; i < f.length; i++) d[i] = Math.round(f[i]); return d; };
  // 진행 상황 (그 줄만 고침): 도구 받기 n/19MB → 준비 → 배경 지우는 중 + 취소
  function maskProgressBox() { PS.el.maskProg = h('div', { class: 'genprog' }); fillMaskProg(); return PS.el.maskProg; }
  function fillMaskProg() {
    const el = PS && PS.el.maskProg, b = PS && PS.maskBusy;
    if (!el || !b) return;
    const st = b.stage || {};
    const txt = st.stage === 'download' ? (st.cached ? '이 기기에 저장해 둔 도구를 여는 중…' : `배경 지우기 도구 받는 중… ${fmtMB(st.loaded)}/${fmtMB(st.total)}MB (처음 한 번만)`)
      : st.stage === 'prepare' ? '도구를 준비하는 중…'
        : st.stage === 'run' ? `배경 지우는 중${b.refine ? ' (정밀하게 — 두 번 봄)' : ''}… ${st.where === 'worker' ? '화면은 계속 써도 돼' : '이 브라우저는 처리하는 동안 화면이 잠깐 멈출 수 있어'}` : '준비하는 중…';
    put(el, h('i', { class: 'spin', 'aria-hidden': 'true' }), h('span', null, ` ${txt} · ${Math.round((Date.now() - b.t0) / 1000)}초`),
      b.wasHidden ? h('small', { class: 'hint' }, ' 화면을 껐다 켰어 — 멈춘 것 같으면 취소하고 다시 해줘.') : null,
      btn('취소', 'sm ghost', () => { b.ctl.abort(); }));
  }
  async function autoMask(useModel, refine) {
    if (!PS.src || PS.maskBusy) return;
    const ps = PS;
    const ctl = new AbortController();
    ps.maskBusy = { ctl, stage: null, t0: Date.now(), refine };
    ps.segNote = '';
    draw();
    const tick = setInterval(() => { if (PS === ps && ps.maskBusy) fillMaskProg(); }, 1000);
    try {
      heavy('mask');
      const ws = CUT.workSize(ps.src.w, ps.src.h, tier().sizes.mask);
      const small = { data: shrinkTo(ps.src, ws.w, ws.h), w: ws.w, h: ws.h };
      const r = await CUT.autoMask(small.data, small.w, small.h, { useModel, refine, signal: ctl.signal, onStage: (st) => { if (PS === ps && ps.maskBusy) { ps.maskBusy.stage = st; fillMaskProg(); } } });
      if (PS !== ps) return;
      if (ps.mask) pushUndo(ps);
      ps.mask = { data: r.mask, w: small.w, h: small.h };
      ps.maskMethod = r.method; ps.maskModel = r.method === 'auto_u2netp' ? (r.refined ? 'u2netp_2pass' : 'u2netp') : ''; ps.maskEdited = false; ps.maskDirty = true; ps.maskView = null; ps.maskRev = (ps.maskRev || 0) + 1;
      ps.maskQ = r.quality || null;
      ps.fitProd = null;
      const why = r.error === 'model_hash' || r.error === 'wasm_hash' ? '받은 도구 파일이 달라서 안 썼어 — 다음에 다시 받아' : r.error === 'no_simd' ? '이 브라우저는 도구(WebAssembly SIMD)를 못 돌려' : '이 기기·브라우저에서 안 될 수 있어';
      const pct = r.agree == null ? '' : ` (두 결과 겹침 ${Math.round(r.agree * 100)}%)`;
      const refNote = !refine || r.error ? '' : r.refined ? `상품 부분만 잘라서 한 번 더 보고 가장자리를 다듬었어${pct}.`
        : r.skip === 'disagree' ? `두 번째로 본 결과가 처음과 많이 달라서${pct} 다른 물건을 잡았을 수 있어 — 처음 결과를 그대로 뒀어.`
          : r.skip === 'empty' ? '상품을 찾지 못해서 한 번만 봤어 — 칠해서 영역을 정해줘.' : '상품이 사진을 거의 채워서 한 번만 봤어 (정밀하게 해도 같아).';
      ps.segNote = r.error ? `자동 배경 지우기 도구를 쓰지 못해서 간단한 방법(테두리 색)으로 했어. 결과를 확인하고 칠해서 고쳐줘. (${why})`
        : [r.where === 'main' ? '이 브라우저는 따로 일꾼을 못 써서 화면 쪽에서 처리했어 (그동안 화면이 잠깐 멈췄을 수 있어).' : '', refNote].filter(Boolean).join(' ');
    } catch (e) {
      if (PS === ps) {
        if (e && e.code === 'cancelled') ps.segNote = '배경 지우기를 취소했어 (영역은 그대로야).';
        else if (e && e.code === 'timeout') { ps.segNote = "처리가 너무 오래 걸려서 멈췄어. 이 기기에서는 '간단 모드'로 작게 처리할게 — 다시 눌러줘."; lsSet('gf-tier-failed', '1'); }
        else ps.segNote = '배경을 지우지 못했어: ' + ((e && (e.code || e.message)) || '이유 모름');
      }
    } finally {
      clearInterval(tick);
      heavy('');
      if (PS === ps) { ps.maskBusy = null; draw(); }
    }
  }
  async function useSavedMask(button, m) {
    const ps = PS;
    const j = await run(button, () => CUT.maskFromPng(m.url));
    if (!j || PS !== ps) return;
    ps.mask = j; ps.maskSaved = m; ps.maskSavedMask = { data: Uint8ClampedArray.from(j.data), w: j.w, h: j.h }; ps.maskDirty = false; ps.maskMethod = m.method; ps.maskModel = modelOfMask(m); ps.maskEdited = !!m.edited; ps.maskView = null; ps.maskRev = (ps.maskRev || 0) + 1;
    ps.fitProd = null;
    requalify(ps);
    draw();
  }
  // 마스크 저장: 누른 때의 마스크를 저장 (저장하는 동안 칠한 건 '아직 저장 안 함'으로 남김), 두 번 눌러도 한 번만 (1.5.1 검토)
  async function saveMask(button) {
    const ps = PS;
    if (!ps.mask || !ps.product) return null;
    if (ps.maskSaving) return ps.maskSaving;
    const job = (async () => {
      const m = ps.mask, rev = ps.maskRev || 0;
      const data = Uint8ClampedArray.from(m.data);
      const blob = await CUT.toPngBlob(CUT.maskRGBA(data, m.w, m.h), m.w, m.h);
      const fd = new FormData();
      const bb = CUT.maskBBox(data, m.w, m.h, 128);
      fd.append('meta', JSON.stringify({ method: ps.maskEdited && ps.maskMethod !== 'manual' ? ps.maskMethod : ps.maskMethod || 'manual', edited: ps.maskEdited,
        params: { model: ps.maskMethod === 'auto_u2netp' ? ps.maskModel || 'u2netp' : '' }, bbox: bb, coverage: CUT.maskCoverage(data) }));
      fd.append('file', blob, 'mask.png');
      const j = await run(button, () => api(`/images/${ps.product.id}/mask`, { method: 'POST', body: fd }), '영역을 저장했어 (원본 사진은 그대로)');
      if (j && j.mask && PS === ps) {
        ps.maskSaved = j.mask; ps.maskSavedMask = { data, w: m.w, h: m.h };
        ps.maskDirty = (ps.maskRev || 0) !== rev;
        ps.savedMasks = [j.mask, ...ps.savedMasks]; draw();
      }
      return j && j.mask ? j.mask : null;
    })();
    ps.maskSaving = job;
    try { return await job; } finally { ps.maskSaving = null; }
  }

  // ── 4. 장면 설정 (목적·장면·자리·모델은 바로, 각도·빛·색·밝기·비율·품질·직접 적기는 '고급 설정'에 접어 둠 — 지시서 11번) ──
  // 1.5.2: 상품 사진을 이 기기에서 분석해(추정, 0원) 빛 방향·색 느낌·밝기를 미리 고르고 '(추정)'으로 표시 — 사용자가 고르면 그 값을 씀
  function ensureFitProd(ps = PS) {
    if (!ps.mask || !ps.src) return null;
    if (!ps.fitProd || ps.fitProd.rev !== (ps.maskRev || 0)) {
      let a = null;
      try { a = FIT.analyzeProduct(ps.src, ps.mask); } catch { a = null; }
      ps.fitProd = { rev: ps.maskRev || 0, a };
      const hints = FIT.sceneHints(a);
      for (const k of ['light', 'warmth', 'bright', 'shape']) if (!ps[k] || ps.est[k]) { ps[k] = hints[k] || ''; ps.est[k] = !!hints[k]; }
    }
    return ps.fitProd.a;
  }
  const DIR_KO = { left: '왼쪽에서', right: '오른쪽에서', front: '앞·위에서', below: '바로 아래', '': '모름' };
  const TEMP_KO = { warm: '따뜻한 편', neutral: '중간', cool: '차가운 편', '': '모름' };
  const BRIGHT_KO = { bright: '밝은 편', medium: '보통', dim: '어두운 편', '': '모름' };
  function secScene() {
    if (!PS.product) return null;
    const a = ensureFitProd();
    if (!PS.el.custom) {
      PS.el.custom = h('textarea', { maxlength: String(IMG.PRODUCT_CUSTOM_MAX), style: 'min-height:56px', placeholder: '예: 따뜻한 원목 탁자, 오전 햇살, 뒤에 초록 식물 (글자·가격·브랜드는 넣지 않아)' });
      PS.el.custom.addEventListener('input', () => { PS.custom = PS.el.custom.value; drawRisk(); updateCost(); });
    }
    PS.el.custom.value = PS.custom;
    PS.el.risk = h('div', { class: 'stack' });
    drawRisk();
    const T = IMG.PRODUCT_TEMPLATES;
    if (PS.flow === 'bg_only') PS.template = 'bg_only';
    if (!T[PS.template].modes.includes(PS.mode)) PS.template = 'table';
    const angleSel = h('select', { value: PS.angle, 'aria-label': '상품 사진 각도' }, Object.entries(IMG.PRODUCT_ANGLES).map(([k, v]) => opt(k, v.label)));
    angleSel.value = PS.angle;
    angleSel.addEventListener('change', () => { PS.angle = angleSel.value; if (PS.layer) PS.layer = null; PS.serverEst = null; draw(); });
    const placeSel = h('select', { value: PS.place, 'aria-label': '상품 놓을 자리' }, Object.entries(IMG.PRODUCT_PLACES).map(([k, v]) => opt(k, v.label)));
    placeSel.value = PS.place;
    placeSel.addEventListener('change', () => { PS.place = placeSel.value; if (PS.layer) PS.layer.x = IMG.PRODUCT_PLACES[PS.place].x; PS.serverEst = null; draw(); });
    const ch = choices();
    if (!PS.modeId || !ch.list.some((m) => m.id === PS.modeId)) PS.modeId = ch.pick;
    if (!PS.ratio) PS.ratio = prefRatio(PS.purpose);
    const modeSel = h('select', { value: PS.modeId, 'aria-label': '모드' }, ch.list.map((m) => opt(m.id, `${m.label} — ${m.caps.label || m.model}${m.caps.free ? ' (무료)' : m.model === TEST_MODEL ? ' (점검용)' : ' (유료)'}`)));
    modeSel.value = PS.modeId;
    modeSel.addEventListener('change', () => { PS.modeId = modeSel.value; PS.quality = IMG.normQuality(capsModel(), curMode().quality || 'medium'); PS.serverEst = null; draw(); });
    const qs = IMG.qualitiesFor(capsModel());
    if (!qs.includes(PS.quality)) PS.quality = IMG.normQuality(capsModel(), PS.quality || curMode().quality || 'medium');
    const qualSel = h('select', { value: PS.quality, 'aria-label': '품질' }, qs.map((q) => opt(q, IMG.qualityLabel(capsModel(), q))));
    qualSel.value = PS.quality;
    qualSel.addEventListener('change', () => { PS.quality = qualSel.value; PS.serverEst = null; draw(); });
    const c = caps();
    const ratios = IMG.PURPOSES[PS.purpose].ratios;
    const maxRefs = IMG.refsLimit(capsModel(), 'generate');
    const note = IMG.refDownscaleNote(capsModel(), PS.mode);
    const chips = (label, key, map) => h('div', { class: 'seg grow', role: 'group', 'aria-label': label }, ...Object.entries(map).map(([k, v]) =>
      h('button', { type: 'button', 'aria-pressed': String(PS[key] === k), onclick: () => { PS[key] = k; PS.est[key] = false; PS.serverEst = null; draw(); } }, `${v.label}${PS[key] === k && PS.est[key] ? ' (추정)' : ''}`)));
    const estLine = a ? h('p', { class: 'hint' }, `상품 사진 분석 (이 기기에서 추정 · 0원): 빛 ${DIR_KO[a.light.dir || '']}${a.light.confidence === 'medium' ? '' : '(확신 낮음)'} · 색 ${TEMP_KO[a.temp.value || '']} · 밝기 ${BRIGHT_KO[FIT.sceneHints(a).bright || '']}`
      + `${a.view.value && a.view.value !== PS.angle ? ` · 찍은 각도는 '${IMG.PRODUCT_ANGLES[a.view.value].label}' 같아 (확신 낮음)` : ''}. 배경을 이 빛에 맞춰 만들어 — 다르면 고급 설정에서 바꿔줘.`)
      : PS.mode === 'layer' && PS.flow !== 'bg_only' ? h('p', { class: 'hint' }, '3번에서 영역을 정하면 상품 사진의 빛·색을 추정해서 배경을 거기에 맞춰.') : null;
    const adv = det('pscene-adv', '고급 설정 (각도·빛·색·밝기·비율·품질·직접 적기)', false, 'plain');
    adv.append(
      field('상품 사진을 찍은 각도', angleSel, '배경도 같은 각도로 만들어야 어색하지 않아.'),
      h('p', { class: 'legend' }, '빛이 오는 쪽 (상품 사진과 같게)'), chips('빛이 오는 쪽', 'light', IMG.PRODUCT_LIGHTS),
      h('p', { class: 'legend' }, '색 느낌'), chips('색 느낌', 'warmth', IMG.PRODUCT_WARMTH),
      h('p', { class: 'legend' }, '밝기'), chips('밝기', 'bright', IMG.PRODUCT_BRIGHT),
      h('p', { class: 'legend' }, '비율'),
      h('div', { class: 'seg', role: 'group', 'aria-label': '비율' }, ...ratios.map((r) => h('button', { type: 'button', 'aria-pressed': String(r === PS.ratio), onclick: () => { PS.ratio = r; PS.serverEst = null; draw(); } }, r))),
      field('품질', qualSel, '높을수록 비싸고 오래 걸려. 원본 보존 합성은 배경만 만들어서 보통이면 충분해.'),
      field('직접 적기 (선택)', PS.el.custom, '버튼으로 고른 장면에 더할 것. 실제 후기·사용 인증처럼 보이게 하는 요청은 안 돼.'));
    return step(4, '장면 설정',
      h('p', { class: 'legend' }, '어디에 쓸 이미지야?'),
      h('div', { class: 'seg grow', role: 'group', 'aria-label': '제작 목적' }, ...Object.entries(IMG.PRODUCT_PURPOSES).map(([k, v]) =>
        h('button', { type: 'button', 'aria-pressed': String(PS.purpose === k), onclick: () => { PS.purpose = k; PS.ratio = prefRatio(k); PS.serverEst = null; draw(); } }, v.label))),
      h('p', { class: 'hint' }, IMG.PRODUCT_PURPOSES[PS.purpose].look_ko),
      PS.flow === 'bg_only' ? h('p', { class: 'hint' }, `장면: ${T.bg_only.label} — ${T.bg_only.setting_ko}`) : h('p', { class: 'legend' }, '장면'),
      PS.flow === 'bg_only' ? null : h('div', { class: 'tgrid' }, ...Object.entries(T).filter(([k]) => k !== 'bg_only').map(([k, v]) => h('button', { type: 'button', 'aria-pressed': String(PS.template === k), disabled: !v.modes.includes(PS.mode),
        title: v.modes.includes(PS.mode) ? '' : '원본 보존 합성에서만', onclick: () => { PS.template = k; PS.serverEst = null; draw(); } }, v.label))),
      T[PS.template].note_ko ? h('p', { class: 'hint' }, T[PS.template].note_ko) : null,
      h('div', { class: 'row' }, field('상품 놓을 자리', placeSel), field('모드 (모델)', modeSel)),
      PS.mode === 'reference' && !maxRefs ? h('p', { class: 'badbox' }, `${c.label || modelOf()}은 참고 사진을 못 받아서 AI 실사 장면을 못 만들어. 다른 모드를 골라줘.`) : null,
      PS.mode === 'reference' && maxRefs && nRefs() > maxRefs ? h('p', { class: 'badbox' }, `이 모델은 참고 사진을 ${maxRefs}장까지 받아. 추가 사진을 ${nRefs() - maxRefs}장 빼줘.`) : null,
      note ? h('p', { class: 'notice' }, note) : null,
      PS.mode === 'layer' && c.free ? h('p', { class: 'hint' }, '무료 모델은 배경 품질이 낮을 수 있지만, 상품은 원본 그대로라 글자·로고는 안 바뀌어.') : null,
      estLine, adv, PS.el.risk);
  }
  function drawRisk() {
    if (!PS.el.risk) return;
    const p = post();
    const brands = p ? (ui.productsOf(p.id) || []).map((x) => x.brand).filter(Boolean) : [];
    const risks = IMG.promptRisk(PS.custom || '', brands);
    put(PS.el.risk, ...risks.map((r) => h('p', { class: r.level === 'block' ? 'badbox' : 'notice' }, r.msg)));
    PS.blocked = IMG.blocksOf(risks).length > 0;
  }
  // ── 6·7. 비율·품질·모델 → 예상 비용 ──
  const choices = () => modeChoices(settings(), 'generate');
  const curMode = () => { const c = choices(); return c.list.find((m) => m.id === PS.modeId) || c.list.find((m) => m.id === c.pick) || c.list[0] || { model: '', caps: IMG.modelCaps(''), quality: 'medium' }; };
  const modelOf = () => curMode().model;
  const isTest = () => modelOf() === TEST_MODEL;
  const capsModel = () => (isTest() ? 'gpt-image-2.5-flare' : modelOf());
  const caps = () => IMG.modelCaps(capsModel());
  const refsOut = () => (PS.mode === 'reference' ? PS.extras.map((x) => ({ image_id: x.id, role: 'subject' })) : []);
  const nRefs = () => (PS.mode === 'reference' ? 1 + PS.extras.length : 0);
  function estimate() {
    const c = caps();
    const ratio = IMG.ratioOf(PS.purpose, PS.ratio || prefRatio(PS.purpose));
    const quality = IMG.normQuality(capsModel(), PS.quality || curMode().quality || settings().image_quality || 'medium');
    const size = IMG.sizeFor(PS.purpose, ratio, capsModel(), quality);
    const sc = IMG.buildProductScene({ spec: spec(), ratio, size: IMG.sizeLabel(size), refs: [{ image_id: PS.product ? PS.product.id : '', role: 'subject' }, ...refsOut()], post: post(), channel: post() ? post().channel_id : '' });
    const prompt = IMG.promptFromProductScene(sc);
    const clientEst = isTest() ? 0 : IMG.estimateUsd({ quality, size, promptTokens: IMG.estimateTokens(prompt), mode: 'generate', prices: prices(), model: modelOf(), refs: nRefs() });
    const sEst = PS.serverEst && PS.serverEst.key === `${modelOf()}|${size}|${quality}` ? PS.serverEst.usd : null;
    const est = clientEst == null ? null : sEst != null && sEst > clientEst ? sEst : clientEst;
    return { c, ratio, quality, size, prompt, scene: sc, est, total: est == null ? null : IMG.roundUsd(est * PS.count), sEst };
  }
  function updateCost() {
    const box = PS && PS.el.cost;
    if (!box || !PS.product) return;
    const e = estimate();
    const st = settings();
    const u = cfg && cfg.usage;
    const prov = IMG.PROVIDERS[e.c.provider] || null;
    const fx = Number(st.image_fx_krw) || 0;
    const basis = isTest() ? '점검용 가짜 모델 — 비용 없음' : IMG.costBasis({ quality: e.quality, size: e.size, promptTokens: IMG.estimateTokens(e.prompt), mode: 'generate', prices: prices(), model: modelOf(), refs: nRefs() });
    put(box,
      h('span', null, `공급자·모델: ${prov ? prov.label : '?'} · ${modelOf()} · 품질 ${IMG.qualityLabel(capsModel(), e.quality)} · 크기 ${IMG.sizeLabel(e.size)}`),
      h('span', null, PS.mode === 'layer' ? `만드는 것: 빈 배경 ${PS.count}장 (상품은 원본 그대로 얹음)` : `만드는 것: AI 실사 장면 ${PS.count}장 · 참고 사진 ${nRefs()}장`),
      e.c.free ? h('b', { class: 'num' }, `무료 (${prov ? prov.free_note : ''})`)
        : h('b', { class: 'num' }, e.est == null ? '예상 비용을 계산하지 못했어' : PS.count > 1 ? `예상 ${usd(e.est)} × ${PS.count}장 = ${usd(e.total)}${fx && e.total ? ' ≈ ' + L.won(e.total * fx) : ''}` : `예상 ${usd(e.est)}${fx && e.est ? ' ≈ ' + L.won(e.est * fx) : ''}`),
      PS.mode === 'layer' ? h('span', null, '배경 지우기: 0원 (이 기기에서 처리 — 외부 API 안 씀)') : null,
      h('span', { class: 'hint' }, `계산 근거: ${basis}`),
      e.sEst != null && e.est === e.sEst ? h('span', { class: 'notice' }, `서버에서 다시 계산한 예상 비용이 ${usd(e.sEst)}이야. 확인하고 다시 눌러줘.`) : null,
      e.c.free || isTest() ? null : h('span', { class: 'hint' }, `예상 비용이야 (가격표 ${e.c.provider === 'openai' ? prices().checked_at || '확인일 없음' : e.c.checked || '확인일 없음'} 기준). 실제 청구액은 ${prov ? prov.label : '공급자'} 사용량 화면에서 확인해야 해.`),
      u ? h('span', { class: 'hint' }, `${usageLine(u)} · 남은 예산 ${usd(Math.max(0, Number(u.budget_usd) - Number(u.month_usd)))}${u.request_cap_usd != null ? ` · 한 번에 ${usd(u.request_cap_usd)}까지` : ''}`) : null);
    if (PS.el.go) syncGo(e);
  }
  // ── 5. 만들기 (몇 장 · 예상 비용을 먼저 보여줌 · 공급자 비교) ──
  function secGenerate() {
    if (!PS.product) return null;
    PS.el.go = btn('만들기', 'wide', () => submit());
    PS.el.msg = h('div');
    PS.el.cost = h('div', { class: 'costbox' });
    const countSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '후보 몇 장' }, ...[1, 2, 3].map((n) =>
      h('button', { type: 'button', 'aria-pressed': String(n === PS.count), disabled: !!PS.busy && n !== PS.count, onclick: () => { if (PS.busy) return; PS.count = n; draw(); } }, n === 1 ? '1장' : `${n}장 후보`)));
    if (!PS.el.status) PS.el.status = h('div', { class: 'stack' });
    const sec = step(5, PS.flow === 'bg_only' ? '배경 만들기' : '후보 만들기', h('p', { class: 'legend' }, '몇 장 만들까'), countSeg,
      h('p', { class: 'legend' }, '예상 비용 (만들기 전에 확인)'), PS.el.cost, PS.el.msg, PS.el.go, PS.el.status,
      h('p', { class: 'hint' }, '버튼을 누를 때만 만들어. 같은 요청은 한 번만 보내고, 여러 장이면 한 장씩 차례로 만들어. 이 화면을 나가도 서버에서 계속 만들고, 만든 이미지는 보관함에 남아.'),
      h('div', { class: 'go' }, btn('공급자 비교 (같은 상품·장면으로)', 'sm ghost', () => compareSheet(), { disabled: !!PS.busy })));
    queueMicrotask(updateCost);
    return sec;
  }
  function whyNot(e) {
    const c = e.c;
    const u = cfg && cfg.usage;
    const keys = (cfg && cfg.keys) || {};
    if (PS.busy) return '만드는 중이야.';
    if (PS.newModel) return '설정의 모델이 바뀌었어. 화면을 다시 열어줘.';
    if (!modelOf()) return '쓸 모델이 없어. 설정 > 이미지에서 모델을 골라줘.';
    if (!isTest() && !c.known) return '앱이 모르는 모델이라 만들 수 없어.';
    if (cfg && !isTest() && !keyOk(keys, c.provider)) return noKeyText(c.provider);
    if (!isTest() && !c.usable) return `공급자가 종료한 모델이야 (${c.retired}). 다른 모드를 골라줘.`;
    if (PS.blocked) return '빨간 내용을 고쳐야 만들 수 있어.';
    if (PS.mode === 'layer' && PS.flow !== 'bg_only' && !PS.mask) return "원본 보존 합성은 먼저 3번에서 상품 영역을 정해줘.";
    if (PS.maskBusy) return '배경 지우기가 끝난 뒤에 만들어줘.';
    if (PS.mode === 'reference') { const mx = IMG.refsLimit(capsModel(), 'generate'); if (!mx) return '이 모델은 참고 사진을 못 받아. 다른 모드를 골라줘.'; if (nRefs() > mx) return `참고 사진이 너무 많아 (${mx}장까지).`; }
    if (PS.slotKey && IMG.isOwnPhotoSlot((IMG.parseSlots((post() || {}).body).find((s) => s.key === PS.slotKey) || {}).text)) return "'직접 찍기' 자리에는 합성 이미지를 만들지 않아. 직접 찍은 사진을 올려줘.";
    if (u && Number(u.today) + PS.count > Number(u.daily_limit)) return `오늘 만들 수 있는 횟수가 모자라 (${PS.count}장 필요).`;
    if (u && e.total != null && Number(u.month_usd) + e.total > Number(u.budget_usd) + 1e-9) return '이번 달 예산을 넘게 돼서 못 만들어. (설정 > 이미지에서 한 달 예산)';
    if (u && e.total != null && u.request_cap_usd != null && e.total > Number(u.request_cap_usd) + 1e-9) return `한 번에 쓸 수 있는 금액(${usd(u.request_cap_usd)})을 넘어. 장수를 줄여줘.`;
    if (e.est == null) return '예상 비용을 계산하지 못했어.';
    return '';
  }
  function syncGo(e) {
    const why = whyNot(e);
    const b = PS.el.go;
    b.textContent = PS.busy ? '만드는 중…' : e.est == null ? '만들기' : e.c.free || isTest() ? `무료 · ${PS.mode === 'layer' ? '배경' : '장면'} ${PS.count}장 만들기` : `예상 ${usd(PS.count > 1 ? e.total : e.est)}${PS.count > 1 ? ` (${PS.count}장)` : ''} · 만들기`;
    b.disabled = !!why;
    if (!PS.busy && PS.el.msg) put(PS.el.msg, why ? h('p', { class: 'hint' }, why) : '');
  }
  // 진행 상황은 그 줄만 고침 (화면 전체를 다시 그리지 않음)
  const say = (node) => { if (PS && PS.el.status) put(PS.el.status, node ? h('div', { class: 'genprog' }, node) : ''); if (node && PS && PS.el.go) { PS.el.go.disabled = true; PS.el.go.textContent = '만드는 중…'; } };
  async function submit() {
    if (!PS || PS.busy) return;
    const ps = PS;
    const e = estimate();
    if (whyNot(e)) return;
    // 누른 즉시 잠금 (두 번 눌러도 한 번만 — 1.5.1 검토). 방식·장면·모델·장수는 누른 때의 값으로 묶음 끝까지 (중간에 바꿔도 섞이지 않게)
    ps.busy = true;
    const mode = ps.mode, specNow = spec(), refsNow = refsOut(), modelNow = modelOf(), n = ps.count;
    say(h('span', null, '준비하는 중…'));
    draw();
    const made = [];
    try {
      // 원본 보존 합성: 마스크를 먼저 저장 (돈 안 듦) — 합성 기록이 이 마스크를 가리킴
      if (mode === 'layer' && ps.mask && (!ps.maskSaved || ps.maskDirty)) {
        const m = await saveMask(null);
        if (!m) return;
      }
      const batch = n > 1 ? { id: newUuid(), keys: Array.from({ length: n }, () => newKey()) } : { id: null, keys: [newKey()] };
      // 무료 모델(FLUX.2 klein)은 참고 사진을 512px보다 작은 사본으로 받음 → 없으면 먼저 만들어 올림 (원본은 그대로)
      if (mode === 'reference' && e.c.provider === 'cloudflare' && !isTest()) {
        try { for (const im of [ps.product, ...ps.extras]) await ensureSmall(im); } catch (err) { toast('작은 사본을 만들지 못했어: ' + ((err && err.code ? ui.errText(err) : err && err.message) || '이유 모름'), 5000); return; }
      }
      for (let i = 0; i < n; i++) {
        const body = {
          request_key: batch.keys[i], product: specNow, product_image_id: ps.product.id, refs: refsNow, post_id: ps.postId || undefined, slot_key: ps.slotKey || undefined,
          ratio: e.ratio, quality: e.quality, model: modelNow, confirm_usd: e.est,
          batch: n > 1 ? { id: batch.id, kind: 'candidates', index: i, total: n } : undefined,
          reserve_usd: n > 1 && e.est != null ? IMG.roundUsd(e.est * (n - i)) : undefined,
        };
        const r = await sendOne(ps, body, i, e, n);
        if (!r) break;
        made.push(r);
        if (!r.image) break;
      }
    } finally {
      ps.busy = false;
      if (PS === ps) { say(null); }
    }
    if (PS !== ps) return;
    const ok = made.filter((x) => x.image);
    if (ok.length) {
      ps.cands.push(...ok.map((x) => ({ ...x, mode })));
      if (mode === 'reference' && ps.pick < 0) ps.pick = ps.cands.length - ok.length;
      toast(mode === 'layer' ? `배경 ${ok.length}장을 만들었어. 9번에서 골라서 합성해줘.` : `장면 ${ok.length}장을 만들었어. 원본과 비교해서 골라줘.`, 4000);
    }
    const failed = made.filter((x) => !x.image);
    if (failed.length) toast(failed[0].generation ? `못 만든 장: ${failed[0].generation.error_message || '이유 없음'}` : '못 만들었어', 5000);
    if (ok.length < n && made.length < n) toast(`${n}장 중 ${ok.length}장만 만들었어. 남은 장은 보내지 않았어 (돈이 안 나가).`, 5000);
    draw();
    refreshPost(ps.postId);
  }
  async function sendOne(ps, body, i, e, n = 1) {
    let j = null;
    for (let attempt = 0; attempt < 4 && !j; attempt++) {
      say(h('span', null, n > 1 ? `${i + 1}/${n}장 보내는 중…` : '보내는 중…'));
      try { j = await sendGenerate(body); } catch (err) {
        if (err && err.code === 'server_busy' && attempt < 3) {
          for (let t = Math.max(1, Math.round(Number(err.retry_after) || 3)); t > 0; t--) { if (PS !== ps) return null; say(h('span', null, `서버가 다른 일을 마무리하는 중이야. ${t}초 뒤에 같은 요청으로 다시 보낼게 (돈은 아직 안 나갔어).`)); await sleep(1000); }
          continue;
        }
        if (err && err.code === 'ref_small_missing' && attempt < 3) {
          const ids = new Set(err.ids || []);
          try { for (const im of [ps.product, ...ps.extras].filter((x) => ids.has(x.id))) await ensureSmall(im); continue; } catch { /* 아래 안내 */ }
        }
        if (err && err.code === 'estimate_changed') {
          ps.serverEst = { usd: Number(err.est_usd), key: `${err.model}|${err.size}|${err.quality}` };
          if (err.model && err.model !== modelOf()) ps.newModel = String(err.model);
          ui.load();
        }
        if (err && err.code !== 'auth') toast(ui.errText(err) + ((err.risks || []).length ? ' — ' + err.risks.map((x) => x.msg).join(' / ') : ''), 5000);
        return null; // 잠금은 부른 쪽(submit·doEdit)이 끝날 때 풂
      }
    }
    if (!j) return null;
    const gen = j.generation;
    const t0 = Date.now();
    for (;;) {
      if (PS !== ps) return null;
      say(h('span', null, h('i', { class: 'spin', 'aria-hidden': 'true' }), ` ${n > 1 ? `${i + 1}/${n}장 ` : ''}만드는 중… ${Math.round((Date.now() - t0) / 1000)}초 (보통 20초~1분)`));
      await sleep(Date.now() - t0 > 60e3 ? 5000 : 3000);
      let r;
      try { r = await api('/images/generations/' + gen.id); } catch (err) { if (err && err.code === 'auth') return null; continue; }
      if (cfg && r.usage) cfg.usage = r.usage;
      const g = r.generation;
      if (g.status === '생성 중') continue;
      return { gen: g, image: g.status === '성공' ? r.image : null, generation: g };
    }
  }

  // ── 6. 후보 고르기 · 원본과 비교 ──
  // 지금 방식으로 만든 후보만 (다른 방식의 결과가 섞이지 않게 — 1.5.1 검토)
  const candOf = (i) => { const c = i >= 0 ? PS.cands[i] : null; return c && (!c.mode || c.mode === PS.mode) ? c : null; };
  function secCandidates() {
    const vis = PS.cands.map((c, i) => [c, i]).filter(([c]) => !c.mode || c.mode === PS.mode);
    if (!PS.product || !vis.length) return null;
    if (PS.mode === 'layer') {
      const canPreview = !!(PS.mask && PS.src);
      return step(6, '배경 고르기 (원본과 같이 보기)',
        PS.flow === 'bg_only' ? h('p', { class: 'okbox' }, '빈 배경은 보관함에 저장됐어 (내려받거나 원고에 넣을 수 있어). 상품을 얹어 보고 싶으면 아래에서 배경을 골라.') : null,
        h('p', { class: 'hint' }, canPreview ? '배경마다 상품을 원본 그대로 얹어 본 모습이야. 마음에 드는 배경을 골라서 7번에서 위치·크기·그림자를 맞춰줘.' : '상품을 얹어 보려면 3번에서 남길 영역을 먼저 정해줘.'),
        h('div', { class: 'grid2' }, ...vis.map(([c, i]) => (canPreview ? candTile(c, i) : h('div', { class: 'slot' }, thumb(c.image, null), h('small', { class: 'hint' }, costText(c)))))));
    }
    return step(6, '장면 고르기 · 원본과 비교',
      h('p', { class: 'notice' }, 'AI가 상품까지 다시 그린 이미지야. 원본 사진과 모양·색·버튼·글자·로고가 같은지 하나씩 비교해줘.'),
      h('div', { class: 'grid2' }, ...vis.map(([c, i]) => h('div', { class: 'slot' + (PS.pick === i ? ' on' : '') }, thumb(c.image, null),
        h('div', { class: 'chips' }, kindChip(c.image), reviewChip(c.image)),
        h('small', { class: 'hint' }, costText(c)),
        btn(PS.pick === i ? '고른 장면 ✓' : '이 장면 고르기', PS.pick === i ? 'sm' : 'sm ghost', () => { PS.pick = i; PS.result = c.image; draw(); })))));
  }
  const costText = (c) => { const k = genCost(c.gen); return `${c.image.model || ''}${k ? ` · 비용 ${usd(k.usd)} (${k.label})` : ''}`; };
  // 후보 배경에 상품을 기본 설정으로 얹은 작은 미리보기
  function candTile(c, i) {
    const lay = PS.pick === i && PS.layer ? PS.layer : IMG.defaultLayer(spec());
    const key = `${PS.purpose}|${PS.ratio}|${PS.maskRev || 0}|${JSON.stringify(lay)}`;
    const fresh = !(c.cv && c.cvKey === key);
    if (fresh) { c.cv = h('canvas', { class: 'cthumb', 'aria-label': `배경 ${i + 1} 미리보기` }); c.cvKey = key; }
    const cv = c.cv;
    const tile = h('div', { class: 'slot' + (PS.pick === i ? ' on' : '') }, cv, h('small', { class: 'hint' }, costText(c)),
      btn(PS.pick === i ? '고른 배경 ✓' : '이 배경으로 합성하기', PS.pick === i ? 'sm' : 'sm ghost', () => { PS.pick = i; if (!PS.layer) PS.layer = IMG.defaultLayer(spec()); PS.saveErr = null; draw(); }));
    if (fresh) previewInto(cv, c, lay, tier().lite ? 320 : 420).catch(() => { c.cv = null; put(tile, thumb(c.image, null), btn('이 배경으로 합성하기', 'sm ghost', () => { PS.pick = i; draw(); })); });
    return tile;
  }
  async function bgOf(c) {
    if (!c.bgP) c.bgP = CUT.decodeImage(c.image.url, tier().lite ? 1600 : 2048).then((b) => { c.bgDims = { w: b.w, h: b.h }; return b; });
    try { return await c.bgP; } catch (e) { c.bgP = null; throw e; }
  }
  // 미리보기용으로 줄인 상품·마스크 (저장할 때는 원래 크기로 다시 그림). 상품 레이어 준비(마스크→가장자리→색 정리)는 마스크·가장자리 설정이
  // 바뀔 때만 다시 하고, 위치·크기·그림자·배경만 바꾸면 준비해 둔 것을 그대로 씀 (원본 상품 픽셀을 불필요하게 다시 처리하지 않음)
  function previewSource(maxSide) {
    const k = `${maxSide}|${PS.mask ? PS.mask.w : 0}|${PS.maskRev || 0}`;
    if (!PS.prev || PS.prev.k !== k) {
      const sp = CUT.shrinkSource(PS.src, maxSide);
      const sm = CUT.shrinkSource(PS.mask, Math.round((maxSide * PS.mask.w) / Math.max(PS.src.w, PS.src.h)) || maxSide);
      PS.prev = { k, comp: CUT.makeComposer(sp, { data: sm.data, w: sm.w, h: sm.h }) };
    }
    return PS.prev.comp;
  }
  async function previewInto(cv, c, layer, maxSide) {
    if (!PS.src || !PS.mask) return;
    const bg = await bgOf(c);
    const ratio = IMG.ratioOf(PS.purpose, PS.ratio || prefRatio(PS.purpose));
    const o = CUT.outputSize(ratio, bg.w, bg.h, maxSide);
    const r = previewSource(Math.max(o.W, o.H))(bg, { ...layer, ratio }, o.W, o.H);
    cv.width = o.W; cv.height = o.H;
    cv.getContext('2d').putImageData(new ImageData(r.data, o.W, o.H), 0, 0);
    return r;
  }

  // ── 7. 맞추기·승인·부분 수정·다시 만들기·저장 ──
  function secResult() {
    if (!PS.product) return null;
    if (PS.mode === 'layer') return secComposer();
    const img = candOf(PS.pick) ? candOf(PS.pick).image : null;
    if (!img) return null;
    if (!PS.el.edit) { PS.el.edit = h('textarea', { maxlength: '300', style: 'min-height:56px', placeholder: '예: 상품은 그대로 두고 뒤쪽 화분만 지워줘' }); PS.el.edit.addEventListener('input', () => { PS.editText = PS.el.edit.value; }); }
    PS.el.edit.value = PS.editText;
    const approved = IMG.productApproved(img);
    return step(7, '승인 · 부분 수정 · 다시 만들기',
      h('div', { class: 'cmp' }, h('figure', null, thumb(PS.product, null), h('figcaption', null, '원본 상품 사진')), h('figure', null, thumb(img, null), h('figcaption', null, 'AI 실사 장면 (AI 합성 이미지)'))),
      h('div', { class: 'chips' }, kindChip(img), h('span', { class: 'chip ' + (approved ? 'v-ok' : 'v-unk') }, approved ? '상품 검수 승인' : '상품 검수 전')),
      h('div', { class: 'go' }, btn(approved ? '상품 디테일 검수 다시 보기' : '원본과 비교해서 검수·승인', 'sm', () => checkSheet(img, { onDone: (im) => { Object.assign(img, im); draw(); } }))),
      field('부분 수정 (선택)', PS.el.edit, '바꿀 부분만 적어줘. 상품은 그대로 두라고 같이 보내고, 원본 상품 사진도 참고로 다시 보내. 고친 결과는 새 이미지로 (원래 것은 그대로).'),
      h('div', { class: 'go' }, btn('부분 수정 (예상 비용 확인 후)', 'sm ghost', () => editSheet(img)), btn('다시 만들기 (5번)', 'sm ghost', () => { PS.pick = -1; PS.result = null; draw(); })));
  }
  // ── 빛·원근·그림자 자동 추천 (1.5.2 — 추정값. '추천값 적용'을 눌러야 바뀌고 그 뒤에도 슬라이더로 고칠 수 있음) ──
  async function fitFor(c) {
    ensureFitProd();
    const bg = await bgOf(c);
    const ratio = IMG.ratioOf(PS.purpose, PS.ratio || prefRatio(PS.purpose));
    const o = CUT.outputSize(ratio, bg.w, bg.h, outLongOf(PS));
    const key = `${PS.place}|${PS.angle}|${PS.purpose}|${ratio}|${PS.fitProd ? PS.fitProd.rev : 0}`;
    if (!c.fitBg || c.fitBgKey !== key) {
      const a = PS.fitProd && PS.fitProd.a;
      c.fitBg = FIT.analyzeBackground(bg, { place: PS.place, angle: PS.angle, h: (IMG.PRODUCT_PURPOSES[PS.purpose] || IMG.PRODUCT_PURPOSES.blog_body).size, aspect: a ? a.aspect : 1, W: o.W, H: o.H });
      c.fitBgKey = key;
    }
    c.fitWH = o;
    const a = PS.fitProd && PS.fitProd.a;
    const bb = PS.mask ? CUT.maskBBox(PS.mask.data, PS.mask.w, PS.mask.h, 128) : null;
    const k = PS.src && PS.mask ? PS.src.w / PS.mask.w : 1;
    PS.rec = FIT.recommendLayer({ prod: a, bg: c.fitBg, spec: spec(), layer: PS.layer, W: o.W, H: o.H, prodPx: bb ? { w: bb.w * k, h: bb.h * k } : null, productTone: PS.productTone });
    return PS.rec;
  }
  const fmtV = (key, v) => (/^(h|x|y|shadow\.o|shadow\.s)$/.test(key) ? `${Math.round(Number(v) * 100)}%` : `${Number(v) > 0 ? '+' : ''}${Math.round(Number(v) * 100)}`);
  function fitBox(c) {
    const box = h('div', { class: 'fitbox' }, h('p', { class: 'hint' }, '자동 추천을 계산하는 중… (이 기기에서 · 0원)'));
    fitFor(c).then((r) => {
      if (!box.isConnected && PS.el.fit !== box) return;
      const a = PS.fitProd && PS.fitProd.a, b = c.fitBg;
      const conf = (x) => (x && x.confidence === 'medium' ? '' : ' (확신 낮음)');
      const tone = h('input', { type: 'checkbox', checked: !!PS.productTone });
      tone.addEventListener('change', () => { PS.productTone = tone.checked; draw(); });
      put(box,
        h('p', { class: 'legend' }, '자동 추천 (이 기기에서 픽셀만 보고 추정 — 확정값이 아니야)'),
        a ? h('small', { class: 'hint' }, `상품 사진: 빛 ${DIR_KO[a.light.dir || '']}${conf(a.light)} · 색 ${TEMP_KO[a.temp.value || '']} · 원래 그림자 ${DIR_KO[a.shadow.side || '']}`) : null,
        b ? h('small', { class: 'hint' }, `배경: 빛 ${DIR_KO[b.light.dir || '']}${conf(b.light)} · 색 ${TEMP_KO[b.temp.value || '']} · 빛의 세기 ${({ soft: '부드러움', medium: '보통', hard: '강함' })[b.contrast]} · 빈 자리 ${b.spot && b.spot.confidence !== 'low' ? '찾음' : '확실하지 않음 (고른 자리 기본값)'}`) : null,
        ...r.notes.map((n) => h('p', { class: 'notice' }, n)),
        r.changes.length ? h('ul', { class: 'lic' }, ...r.changes.map((x) => h('li', null, `${x.label}: ${fmtV(x.key, x.from)} → ${fmtV(x.key, x.to)} `, h('small', null, `— ${x.why}`))))
          : h('p', { class: 'hint' }, '지금 값이 추천값과 같아.'),
        h('label', { class: 'chk' }, tone, ' 밝기·색은 상품 쪽을 바꿔서 맞추기 (기본은 배경 쪽 — 상품 픽셀을 그대로 두려고. 상품 쪽을 바꾸면 검수에서 색 칸을 직접 확인해야 해)'),
        h('div', { class: 'go' }, btn('추천값 적용', 'sm', () => applyRec(), { disabled: !r.changes.length }),
          PS.recBase ? btn('적용 전으로', 'sm ghost', () => { PS.layer = PS.recBase; PS.recBase = null; PS.fitApplied = false; draw(); }) : null));
    }).catch(() => put(box, h('p', { class: 'hint' }, '자동 추천을 계산하지 못했어 — 아래에서 직접 맞춰줘.')));
    PS.el.fit = box;
    return box;
  }
  function applyRec() {
    const r = PS.rec;
    if (!r || !PS.layer) return;
    PS.recBase = JSON.parse(JSON.stringify(PS.layer));
    const L = IMG.cleanLayer(r.layer);
    // 원본 크기 그대로·회전·가장자리 설정은 사용자가 고른 그대로
    PS.layer = { ...L, one: PS.layer.one, rot: PS.layer.rot, mask: { ...PS.layer.mask }, ratio: PS.layer.ratio };
    PS.fitApplied = true;
    draw();
  }
  const limitBytes = () => (cfg && cfg.limits && Number(cfg.limits.composite_bytes)) || 12 * 1024 * 1024;
  const outLongOf = (ps) => ps.outLong || (IMG.PURPOSES[ps.purpose] || IMG.PURPOSES.blog_body).out;
  const r4 = (n) => Math.round(n * 10000) / 10000;
  // 저장 크기 미리 보기: 결과 가로×세로와 PNG 예상 크기 (사진 같은 그림은 칸당 약 1~2.4바이트 — 정확한 크기는 만든 뒤 확인해서 한도를 넘으면 올리지 않음)
  function sizeLine(c) {
    if (!c.bgDims) return null;
    const ratio = IMG.ratioOf(PS.purpose, PS.ratio || prefRatio(PS.purpose));
    const o = CUT.outputSize(ratio, c.bgDims.w, c.bgDims.h, outLongOf(PS));
    const px = o.W * o.H;
    const lim = limitBytes();
    const known = cfg && cfg.limits;
    return h('p', { class: 'hint' }, `저장 크기: ${o.W}×${o.H} · PNG 예상 약 ${fmtMB(px)}~${fmtMB(px * 2.4)}MB · 서버 한도 ${fmtMB(lim)}MB`
      + (known ? (known.bucket_bytes ? '' : ' (보관함 버킷 한도는 확인 못 함)') : ' (서버에서 한도를 아직 못 받아 기본값)') + (PS.outLong ? ` · 긴 변 ${PS.outLong}px로 줄임` : ''));
  }
  function saveErrBox(c) {
    const se = PS.saveErr;
    if (!se) return null;
    return h('div', { class: 'badbox stack' }, h('b', null, '저장하지 못했어'),
      h('span', null, se.code === 'too_big' ? `저장할 PNG가 ${fmtMB(se.size)}MB라 서버 한도(${fmtMB(se.limit)}MB)를 넘어서 올리지 않았어. 무손실(PNG)이라 더 압축할 수는 없고, 크기를 줄여야 해.` : se.msg),
      h('small', null, '원본 상품 사진·배경·마스크는 그대로야.'),
      h('div', { class: 'go' },
        se.code === 'too_big' ? btn(`긴 변 ${se.long}px로 줄여서 저장`, 'sm', (ev) => { PS.outLong = se.long; PS.saveErr = null; PS.saveTry = null; saveComposite(ev.currentTarget, c); }) : null,
        se.retry && PS.saveTry ? btn('다시 저장 (같은 요청)', 'sm', (ev) => saveComposite(ev.currentTarget, c)) : null,
        btn('그만두기', 'sm ghost', () => { PS.saveErr = null; PS.saveTry = null; draw(); if (PS.failedKeys.length) cleanupFailed(PS); })));
  }
  function secComposer() {
    const c = candOf(PS.pick);
    if (!c || !PS.mask || !PS.src) return null;
    if (!PS.layer) PS.layer = IMG.defaultLayer(spec());
    const L0 = PS.layer;
    // 배경을 아직 안 읽었으면 읽은 뒤 한 번 더 그림 (저장 크기 줄을 보여주려고)
    if (!c.bgDims) bgOf(c).then(() => { if (PS && candOf(PS.pick) === c) draw(); }).catch(() => {});
    if (!PS.el.compCv) PS.el.compCv = composeCanvas();
    const cv = PS.el.compCv;
    PS.el.warn = h('div', { class: 'stack' });
    const slider = (label, get, set, min, max, stepv, fmt) => {
      const el = h('input', { type: 'range', min: String(min), max: String(max), step: String(stepv), value: String(get()), 'aria-label': label });
      const val = h('small', { class: 'hint' }, fmt(get()));
      el.addEventListener('input', () => { set(Number(el.value)); val.textContent = fmt(Number(el.value)); recompose(); schedulePersist(); });
      return h('label', { class: 'f rangef' }, h('span', null, label, ' ', val), el);
    };
    const pct = (v) => Math.round(v * 100) + '%';
    const signed = (v) => (v > 0 ? '+' : '') + Math.round(v * 100);
    const one = h('input', { type: 'checkbox', checked: !!L0.one });
    one.addEventListener('change', () => { PS.layer.one = one.checked; draw(); });
    const saved = PS.result && PS.result.kind === 'composite' && PS.result.id === PS.savedId ? PS.result : null;
    const kids = [
      h('p', { class: 'hint' }, '사진을 끌어서 상품 위치를 옮겨. 상품은 원본 픽셀 그대로고, 여기서 바꾸는 건 위치·크기·그림자·밝기뿐이야 (상품을 다시 그리지 않아).'),
      h('div', { class: 'compwrap' }, cv),
      PS.el.warn,
      fitBox(c),
      h('label', { class: 'chk' }, one, PS.src.scaled
        ? ` 원본 크기 그대로 (늘리거나 줄이지 않음 — 이 사진은 ${PS.src.srcW}×${PS.src.srcH}로 커서 긴 변 ${Math.max(PS.src.w, PS.src.h)}px로 줄여 읽었어. 줄인 사진의 픽셀 그대로야)`
        : ' 원본 크기 그대로 (늘리거나 줄이지 않음 — 회전도 0이면 상품 칸이 원본 픽셀과 한 칸도 안 달라)'),
      L0.one ? null : slider('크기 (그림 높이 대비)', () => PS.layer.h, (v) => { PS.layer.h = v; }, 0.1, 1, 0.01, pct),
      slider('회전', () => PS.layer.rot, (v) => { PS.layer.rot = v; }, -30, 30, 0.5, (v) => `${v}°`),
    ];
    const dShadow = det('pscene-shadow', '그림자', true, 'plain'), dTone = det('pscene-tone', '밝기·색온도', false, 'plain'), dEdge = det('pscene-edge', '가장자리', false, 'plain');
    kids.push(dShadow, dTone, dEdge);
    dShadow.append(slider('진하기', () => PS.layer.shadow.o, (v) => { PS.layer.shadow.o = v; }, 0, 1, 0.01, pct), slider('퍼짐', () => PS.layer.shadow.s, (v) => { PS.layer.shadow.s = v; }, 0, 1, 0.01, pct),
      slider('빛 방향 (왼쪽 ← → 오른쪽)', () => PS.layer.shadow.dx, (v) => { PS.layer.shadow.dx = v; }, -1, 1, 0.05, signed),
      h('p', { class: 'hint' }, '바닥에 닿는 곳의 진한 그림자(접촉 그림자)와 빛 반대쪽으로 펼쳐지는 그림자를 같이 그려. 상품이 떠 보이면 진하기를 올리거나 상품을 조금 내려줘.'));
    dTone.append(h('p', { class: 'hint' }, '상품 밝기·색온도를 바꾸면 그 값만큼 상품 색이 원본과 달라져 (검수에서 색 항목을 직접 확인해야 해). 배경 쪽을 바꾸면 상품 픽셀은 그대로야.'),
      slider('상품 밝기', () => PS.layer.tone.b, (v) => { PS.layer.tone.b = v; }, -0.3, 0.3, 0.01, signed), slider('상품 색온도 (차갑게 ← → 따뜻하게)', () => PS.layer.tone.w, (v) => { PS.layer.tone.w = v; }, -0.3, 0.3, 0.01, signed),
      slider('배경 밝기', () => PS.layer.bg.b, (v) => { PS.layer.bg.b = v; }, -0.3, 0.3, 0.01, signed), slider('배경 색온도', () => PS.layer.bg.w, (v) => { PS.layer.bg.w = v; }, -0.3, 0.3, 0.01, signed));
    dEdge.append(slider('가장자리 부드럽게', () => PS.layer.mask.feather, (v) => { PS.layer.mask.feather = v; }, 0, 4, 1, (v) => `${v}px`),
      slider('가장자리 안쪽으로 (남은 배경 깎기)', () => PS.layer.mask.shrink, (v) => { PS.layer.mask.shrink = v; }, 0, 4, 1, (v) => `${v}px`));
    if (!PS.el.bgEdit) { PS.el.bgEdit = h('textarea', { maxlength: '300', style: 'min-height:48px', placeholder: '예: 조명을 조금 더 따뜻하게 / 탁자 색을 밝은 원목으로' }); PS.el.bgEdit.addEventListener('input', () => { PS.editText = PS.el.bgEdit.value; }); }
    PS.el.bgEdit.value = PS.editText;
    const result = PS.result && PS.result.kind === 'composite' ? PS.result : null;
    const approved = result && IMG.productApproved(result);
    kids.push(
      sizeLine(c),
      saveErrBox(c),
      h('div', { class: 'go' }, btn('기본값으로', 'sm ghost', () => { PS.layer = IMG.defaultLayer(spec()); PS.recBase = null; PS.fitApplied = false; draw(); }),
        btn(result && PS.savedKey === saveKey(PS, c) ? '저장됨 ✓' : '합성 저장 (새 이미지로)', 'sm', (ev) => saveComposite(ev.currentTarget, c))),
      result ? h('div', { class: 'stack' },
        h('div', { class: 'chips' }, kindChip(result), h('span', { class: 'chip ' + (approved ? 'v-ok' : 'v-unk') }, approved ? '상품 검수 승인' : '상품 검수 전')),
        h('div', { class: 'go' }, btn(approved ? '상품 디테일 검수 다시 보기' : '원본과 비교해서 검수·승인', 'sm', () => checkSheet(result, { onDone: (im) => { Object.assign(result, im); draw(); } })))) : null,
      field('배경 고치기 (부분 수정, 선택)', PS.el.bgEdit, '배경만 고쳐. 상품 자리는 비워 둔 채로 두고, 고친 배경에 지금 위치·크기 그대로 다시 얹어 (상품은 다시 그리지 않음).'),
      h('div', { class: 'go' }, btn('배경 고치기 (예상 비용 확인 후)', 'sm ghost', () => editSheet(c.image)), btn('배경 다시 만들기 (5번)', 'sm ghost', () => { PS.pick = -1; draw(); })),
      saved ? null : h('p', { class: 'hint' }, '저장하면 새 이미지(PNG — 다시 압축하지 않음)로 보관함에 들어가. 원본 상품 사진·배경은 그대로 남아.'));
    queueMicrotask(recompose);
    return step(7, '위치·크기·그림자 맞추기 → 저장 → 승인', ...kids);
  }
  function composeCanvas() {
    const cv = h('canvas', { class: 'compcv', 'aria-label': '합성 미리보기 (끌어서 상품 옮기기)' });
    let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      if (!PS.layer) return;
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
      const b = cv.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, lx: PS.layer.x, ly: PS.layer.y, w: b.width, h: b.height };
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      e.preventDefault();
      PS.layer.x = Math.min(1, Math.max(0, drag.lx + (e.clientX - drag.x) / drag.w));
      PS.layer.y = Math.min(1, Math.max(0.05, drag.ly + (e.clientY - drag.y) / drag.h));
      recompose();
    });
    const end = () => { if (drag) schedulePersist(); drag = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    return cv;
  }
  let composing = false, again = false;
  async function recompose() {
    if (!PS || !PS.el.compCv) return;
    if (composing) { again = true; return; }
    composing = true;
    try {
      const c = PS.cands[PS.pick];
      if (!c) return;
      const r = await previewInto(PS.el.compCv, c, PS.layer, tier().sizes.preview);
      if (r && PS.el.warn) put(PS.el.warn, ...r.warnings.map((w) => h('p', { class: 'notice' }, CUT.COMPOSE_WARN[w] || w)));
    } catch {
      if (PS && PS.el.warn) put(PS.el.warn, h('p', { class: 'badbox' }, '배경을 불러오지 못했어. 새로고침한 뒤 다시 해줘 (주소는 1시간 동안만 열려).'));
    } finally {
      composing = false;
      if (again) { again = false; requestAnimationFrame(() => recompose()); }
    }
  }
  // 이미 저장한 것과 같은 합성인지: 위치·크기·그림자·밝기, 제작 목적·비율, 배경, 마스크, 저장 크기가 모두 같을 때만 '저장됨'
  const saveKey = (ps, c) => JSON.stringify([ps.layer, ps.purpose, ps.ratio || prefRatio(ps.purpose), c.image.id, ps.maskRev || 0, ps.outLong || 0]);
  // 결과에 같이 남길 장면 정보 (이 기기에서 추정한 값 · 추천값을 적용했는지 — 서버가 정리해서 저장)
  const fitRecord = (c) => { const a = PS.fitProd && PS.fitProd.a, b = c.fitBg; return a || b ? { product: a, background: b, applied: !!PS.fitApplied, match: PS.rec ? PS.rec.match : null } : undefined; };
  // 원래 크기로 다시 그려서 저장 (원본 상품 사진·마스크 원래 크기 — 미리보기 사본이 아님)
  // 1.5.2: 배경 지우기 도구를 먼저 내려 메모리 확보 → 그리기 → PNG(무손실, 불투명) → 크기가 서버 한도를 넘으면 올리지 않고 줄이기를 권함 →
  //        올리는 진행률 → 실패하면 이유와 '다시 저장(같은 요청 번호 — 두 장 안 생김)'·'그만두기(그 요청의 파일만 정리)'
  async function saveComposite(button, c) {
    const ps = PS;
    if (ps.saving) return; // 두 번 눌러도 한 번만
    ps.saving = true;
    try {
      // 합성에 쓰는 마스크 = 서버에 저장한 그 마스크 (저장하는 동안 칠했으면 한 번 더 저장 — 기록과 그림이 어긋나지 않게, 1.5.1 검토)
      for (let i = 0; i < 2 && (!ps.maskSaved || ps.maskDirty); i++) { const m = await saveMask(null); if (!m) return; }
      if (ps.maskDirty || !ps.maskSavedMask) { toast('영역을 고치는 중이라 저장하지 않았어. 다 칠한 뒤 다시 눌러줘.', 4000); return; }
      // 누른 때의 설정으로 저장 (저장하는 동안 바꾼 위치·비율은 다음 저장에)
      const key = saveKey(ps, c);
      if (ps.saveTry && ps.saveTry.key === key && ps.saveTry.blob) { await doUpload(ps, ps.saveTry, button); return; }
      const snap = { layer: JSON.parse(JSON.stringify(ps.layer)), purpose: ps.purpose, ratio: IMG.ratioOf(ps.purpose, ps.ratio || prefRatio(ps.purpose)),
        mask: ps.maskSavedMask, maskId: ps.maskSaved.id, spec: spec(), parent: ps.parentId, name: ps.name, template: ps.template, outLong: outLongOf(ps) };
      if (button && button.isConnected) { button.disabled = true; button.textContent = '저장할 그림을 만드는 중…'; }
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      CUT.releaseSegmenter();
      heavy('compose');
      let blob, o, r;
      try {
        const bg = await bgOf(c);
        o = CUT.outputSize(snap.ratio, bg.w, bg.h, snap.outLong);
        r = CUT.makeComposer(ps.src, snap.mask)(bg, { ...snap.layer, ratio: snap.ratio }, o.W, o.H);
        if (r.warnings.includes('empty_mask')) { toast(ui.errText({ code: 'empty_mask' })); return; }
        blob = await CUT.toPngBlob(r.data, o.W, o.H, { opaque: true });
      } catch {
        ps.saveErr = { code: 'render', msg: "저장할 그림을 만들지 못했어 (이 기기 메모리가 모자랐을 수 있어). 3번의 '간단 모드로'로 바꾸거나 크기를 줄여서 다시 해줘." };
        lsSet('gf-tier-failed', '1');
        if (PS === ps) draw();
        return;
      } finally { heavy(''); }
      const lim = limitBytes();
      if (blob.size > lim) {
        const k = Math.sqrt((lim * 0.9) / blob.size);
        ps.saveErr = { code: 'too_big', size: blob.size, limit: lim, long: Math.max(480, Math.floor((Math.max(o.W, o.H) * k) / 16) * 16) };
        if (PS === ps) draw();
        return;
      }
      const box = r.box ? { l: r4(r.box.left / o.W), t: r4(r.box.top / o.H), w: r4(r.box.w / o.W), h: r4(r.box.h / o.H) } : null;
      const desc = clean(`${snap.name || '상품'} · ${IMG.PRODUCT_TEMPLATES[snap.template].label}`).slice(0, 120);
      // src_scaled: 아주 큰 상품 사진을 줄여 읽었으면 '원본 크기 그대로'여도 줄인 사진의 픽셀이라 검수 칸(글자·버튼)을 미리 채우지 않음 (1.5.1 재검토)
      const meta = { product_image_id: ps.product.id, background_image_id: c.image.id, mask_id: snap.maskId,
        layer: { ...snap.layer, ratio: snap.ratio, src_scaled: !!(ps.src && ps.src.scaled), box }, purpose: snap.purpose, ratio: snap.ratio,
        description: desc, spec: snap.spec, parent_image_id: snap.parent || undefined, post_id: ps.postId || undefined, fit: fitRecord(c) };
      ps.saveTry = { key, reqKey: newKey(), blob, meta, size: blob.size, W: o.W, H: o.H };
      await doUpload(ps, ps.saveTry, button);
    } finally {
      ps.saving = false;
      if (button && button.isConnected) { button.disabled = false; button.textContent = '합성 저장 (새 이미지로)'; }
    }
  }
  const NO_RETRY = ['bad_image', 'bad_field', 'mask_mismatch', 'background_mismatch', 'product_not_found', 'background_not_found', 'db_update_needed', 'too_large', 'mask_size_mismatch', 'product_image_required', 'background_image_required'];
  async function doUpload(ps, t, button) {
    const fd = new FormData();
    fd.append('meta', JSON.stringify({ ...t.meta, request_key: t.reqKey }));
    fd.append('file', t.blob, 'composite.png');
    ps.saveErr = null;
    const say = (txt) => { if (button && button.isConnected) button.textContent = txt; };
    if (button && button.isConnected) button.disabled = true;
    say(`저장하는 중… (${fmtBytes(t.size)})`);
    let j = null;
    try {
      j = await upload('/images/composite', fd, { timeout: 120000, onProgress: (sent, total) => say(`올리는 중… ${Math.min(100, Math.round((sent / Math.max(1, total)) * 100))}% (${fmtBytes(t.size)})`) });
    } catch (e) {
      if (e && e.code === 'auth') return;
      const code = (e && e.code) || 'server';
      const msg = code === 'too_large' ? `파일이 서버 한도보다 커 (${fmtBytes(t.size)}).` : SAVE_REASON[code] || ui.errText(e);
      // 서버까지 갔을 수 있는 실패(시간 초과·연결 끊김·서버 오류)는 그 요청 번호를 기억 — '그만두기'하면 그 번호의 파일만 정리
      if (!NO_RETRY.includes(code) && code !== 'offline' && !ps.failedKeys.includes(t.reqKey)) ps.failedKeys.push(t.reqKey);
      ps.saveErr = { code, msg, retry: !NO_RETRY.includes(code) };
      toast(msg, 5000);
      if (PS === ps) draw();
      return;
    } finally { if (button && button.isConnected) button.disabled = false; }
    if (!j || !j.image) return;
    ps.failedKeys = ps.failedKeys.filter((k) => k !== t.reqKey);
    ps.saveTry = null; ps.saveErr = null;
    toast(j.reused ? '이미 저장돼 있던 합성이야 (같은 요청이라 두 장을 만들지 않았어)' : '합성 이미지를 새로 저장했어 (원본은 그대로)');
    if (PS !== ps) return;
    ps.result = j.image; ps.savedId = j.image.id; ps.parentId = j.image.id; ps.savedKey = t.key;
    if (ps.failedKeys.length) cleanupFailed(ps);
    draw();
    refreshPost(ps.postId);
  }
  // 부분 수정: 원본 보존 합성은 그 배경을, AI 실사 장면은 그 결과를 고쳐서 새 이미지로 (예상 비용을 보여준 뒤 누를 때만)
  function editSheet(base) {
    const ps = PS;
    const text = clean(ps.editText);
    if (!text) { toast('바꿀 내용을 적어줘'); return; }
    const st = settings();
    const ch = modeChoices(st, 'edit');
    let modeId = ch.pick;
    const sel = h('select', { value: modeId, 'aria-label': '고칠 모드' }, ch.list.map((m) => opt(m.id, `${m.label} — ${m.caps.label || m.model}${m.caps.free ? ' (무료)' : ' (유료)'}`)));
    sel.value = modeId;
    const info = h('div', { class: 'costbox' });
    const goB = btn('고치기', 'wide', () => doEdit());
    const m = () => ch.list.find((x) => x.id === modeId) || ch.list[0];
    const cm = () => (m().model === TEST_MODEL ? 'gpt-image-2.5-flare' : m().model);
    let serverEst = null;
    const est = () => {
      const ratio = IMG.ratioOf(ps.purpose, ps.ratio || prefRatio(ps.purpose));
      const q = IMG.normQuality(cm(), m().quality || 'medium');
      const size = IMG.sizeFor(ps.purpose, ratio, cm(), q);
      const refs = ps.mode === 'reference' ? 1 + ps.extras.length : 0;
      const sc = IMG.buildProductScene({ spec: spec(), ratio, size: IMG.sizeLabel(size), refs: ps.mode === 'reference' ? [{ image_id: ps.product.id, role: 'subject' }, ...refsOut()] : [], edit: text });
      const local = m().model === TEST_MODEL ? 0 : IMG.estimateUsd({ quality: q, size, promptTokens: IMG.estimateTokens(IMG.promptFromProductScene(sc)), mode: 'edit', prices: prices(), model: m().model, refs });
      const v = local != null && serverEst != null && serverEst > local ? serverEst : local;
      return { ratio, q, v, refs };
    };
    const upd = () => {
      const e = est();
      const c = IMG.modelCaps(cm());
      const keys = (cfg && cfg.keys) || {};
      const keyGood = m().model === TEST_MODEL || keyOk(keys, c.provider);
      const tooMany = e.refs > IMG.refsLimit(cm(), 'edit');
      put(info, h('span', null, `${c.label || m().model} · 품질 ${IMG.qualityLabel(cm(), e.q)}`), h('b', { class: 'num' }, c.free ? '무료' : e.v == null ? '예상 비용을 계산하지 못했어' : `예상 ${usd(e.v)}`),
        !keyGood ? h('span', { class: 'badbox' }, noKeyText(c.provider)) : null, !c.edit ? h('span', { class: 'badbox' }, '이 모델은 고치기를 못 해.') : null,
        tooMany ? h('span', { class: 'badbox' }, `이 모델은 고칠 때 참고 사진을 ${IMG.refsLimit(cm(), 'edit')}장까지 받아. 추가 사진을 빼줘.`) : null,
        ps.mode === 'reference' ? h('span', { class: 'hint' }, IMG.refDownscaleNote(cm(), 'reference') || '원본 상품 사진도 참고로 같이 보내 (상품을 그대로 두게).') : h('span', { class: 'hint' }, '배경만 고쳐 — 상품 사진은 보내지 않아.'));
      goB.disabled = !keyGood || !c.edit || e.v == null || tooMany;
      goB.textContent = c.free ? '무료 · 고치기' : e.v == null ? '고치기' : `예상 ${usd(e.v)} · 고치기`;
    };
    sel.addEventListener('change', () => { modeId = sel.value; serverEst = null; upd(); });
    const doEdit = async () => {
      if (ps.busy) return;
      const e = est();
      const mode = ps.mode;
      const body = { request_key: newKey(), mode: 'edit', base_image_id: base.id, edit: text, product: spec(), product_image_id: ps.product.id, refs: refsOut(),
        post_id: ps.postId || undefined, slot_key: ps.slotKey || undefined, ratio: e.ratio, quality: e.q, model: m().model, confirm_usd: e.v };
      ps.busy = true; // 누른 즉시 잠금 (두 번 눌러도 한 번만)
      goB.disabled = true;
      let r = null;
      try {
        if (IMG.modelCaps(cm()).provider === 'cloudflare' && m().model !== TEST_MODEL) {
          try { for (const im of [base, ...(mode === 'reference' ? [ps.product, ...ps.extras] : [])]) await ensureSmall(im); } catch (err) { toast('작은 사본을 만들지 못했어: ' + ((err && err.message) || ''), 4000); return; }
        }
        closeSheet();
        draw();
        r = await sendOne(ps, body, 0, e).catch(() => null);
      } finally { ps.busy = false; if (goB.isConnected) goB.disabled = false; }
      if (PS !== ps) return;
      say(null);
      if (r && r.image && ps.mode === mode) {
        ps.cands.push({ image: r.image, gen: r.gen, mode });
        ps.pick = ps.cands.length - 1;
        if (ps.mode === 'reference') ps.result = r.image;
        ps.editText = '';
        toast(ps.mode === 'layer' ? '배경을 고쳤어. 같은 위치·크기로 다시 얹었어 — 확인하고 저장해줘.' : '고친 장면을 만들었어. 원본과 다시 비교해줘.', 4000);
      } else if (r && r.gen) toast(`못 고쳤어: ${r.gen.error_message || '이유 없음'}`, 5000);
      draw();
      refreshPost(ps.postId);
    };
    openSheet(ps.mode === 'layer' ? '배경 고치기 (부분 수정)' : '장면 부분 수정',
      thumb(base, null), h('p', null, `바꿀 내용: ${text}`), field('모드', sel), info, goB,
      h('p', { class: 'hint' }, '원래 이미지는 그대로 남고, 고친 이미지는 새 이미지로 이어져 (수정 이력).'));
    upd();
  }

  // ── 8. 게시글 자리에 넣기 ──
  function secInsert() {
    const img = PS.mode === 'layer' ? (PS.result && PS.result.kind === 'composite' ? PS.result : null) : candOf(PS.pick) ? candOf(PS.pick).image : null;
    if (!img) return null;
    const box = h('div', { class: 'stack' });
    const approved = IMG.productApproved(img);
    // 본문 사진 자리가 없는 원고도 대표 이미지·SNS 자리에는 넣을 수 있어서, 본문이 있는 원고는 모두 보여줌
    const posts = (ui.S.posts || []).filter((p) => p.body && !p.deleted_at);
    const postSel = h('select', { 'aria-label': '넣을 원고' }, opt('', '원고 고르기'), posts.slice(0, 80).map((p) => opt(p.id, ui.titleOf(p))));
    postSel.value = PS.postId || PS.insertPost || '';
    const drawSlots = () => {
      const pid = postSel.value;
      PS.insertPost = pid;
      const p = pid ? ui.post(pid) : null;
      if (!p) { put(box, h('p', { class: 'hint' }, '넣을 원고를 골라줘.')); return; }
      const slots = IMG.parseSlots(p.body);
      const extra = IMG.EXTRA_SLOTS.map((x) => ({ key: x.key, n: 0, text: x.label }));
      const ready = ['ready', 'scheduled', 'published', 'collecting', 'analyzed'].includes(p.stage);
      put(box,
        ready && !approved ? h('p', { class: 'notice' }, '이 원고는 발행 준비 완료(또는 예약·게시) 상태라, 상품 디테일 검수를 승인한 뒤에 넣을 수 있어.') : null,
        ...[...slots, ...extra].map((s) => {
          const own = s.n && IMG.isOwnPhotoSlot(s.text);
          const info = IMG.slotInfo(s.n ? s : { key: s.key }, { post: p });
          const row = h('div', { class: 'stack' });
          const name = s.n ? `사진 ${s.n}` : s.text;
          // 1.5.2: 같은 이미지를 본문 여러 자리에 넣지 않게 — 서버가 거절하면 그 자리에서 옮겨 올지 물어봄
          const link = async (b, move) => {
            b.disabled = true;
            try {
              await api(`/posts/${pid}/images/link`, { method: 'POST', body: { image_id: img.id, slot_key: s.key, move: move || undefined } });
              toast(`${name}에 넣었어${move ? ' (다른 자리에서 옮겨 왔어)' : ''}`);
              if (PS) PS.done = true;
              refreshPost(pid); ui.load();
            } catch (e) {
              if (e && e.code === 'image_in_other_slot') {
                const other = slots.find((x) => x.key === e.slot_key);
                put(row, h('p', { class: 'notice' }, `이 이미지는 ${other ? '사진 ' + other.n : '다른 자리'}에 이미 들어 있어. 자리마다 다른 이미지가 좋아.`),
                  h('div', { class: 'go' }, btn(`${other ? '사진 ' + other.n : '그 자리'}에서 옮겨 오기`, 'sm', (ev) => link(ev.currentTarget, true)), btn('그대로 두기', 'sm ghost', () => drawSlots())));
              } else if (!e || e.code !== 'auth') toast(ui.errText(e), 4000);
            } finally { if (b.isConnected) b.disabled = false; }
          };
          put(row, h('div', { class: 'go' }, h('span', null, s.n ? `사진 ${s.n}: ${s.text}` : s.text),
            own ? h('small', { class: 'hint' }, "'직접 찍기' 자리 — 합성 이미지는 안 넣어") : btn(PS.slotKey === s.key && pid === PS.postId ? '여기에 넣기 (시작한 자리)' : '여기에 넣기', PS.slotKey === s.key ? 'sm' : 'sm ghost', (ev) => link(ev.currentTarget, false), { disabled: ready && !approved })),
            s.n ? h('small', { class: 'hint' }, `${info.why} · ${info.ai === 'no' ? '직접 찍은 사진 자리' : info.product ? '실제 상품이 보여야 하는 자리 — 원본 보존 합성이 잘 맞아' : '일반 장면 자리 — AI 장면으로도 돼'}`) : null);
          return row;
        }));
    };
    postSel.addEventListener('change', drawSlots);
    drawSlots();
    return step(8, '게시글 이미지 자리에 넣기',
      approved ? h('p', { class: 'okbox' }, '상품 디테일 검수를 승인했어. 발행 준비 완료 원고에도 넣을 수 있어.') : h('p', { class: 'hint' }, '승인 전에도 검토 중인 원고에는 넣어 둘 수 있어. 발행 준비 완료로 바꾸려면 승인해야 해.'),
      PS.postId ? null : field('원고', postSel), box,
      h('p', { class: 'hint' }, `블로그에 올릴 때 '${IMG.captionHint(img)}'를 사진 아래에 같이 넣어줘 (복사할 때 자동으로 들어가). 앱은 블로그에 사진을 대신 올리지 않아.`));
  }

  // ═════════ 상품 사진 올리기·고르기 ═════════
  function uploadSheet(done) {
    const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': '상품 사진 파일' });
    const pickLabel = h('span', null, '사진 고르기');
    const picker = h('label', { class: 'btn sm filebtn' }, pickLabel, input);
    const preview = h('div', { class: 'stack' });
    const rights = h('input', { type: 'checkbox' });
    const srcSel = sourceSelect('own');
    const desc = h('input', { type: 'text', value: '', maxlength: '300', placeholder: '예: 우리 집 전기요 정면' });
    let ready = null, prevUrl = null;
    const goBtn = btn('올리기', 'wide', () => send(), { disabled: true });
    const dropUrl = () => { if (prevUrl) { URL.revokeObjectURL(prevUrl); prevUrl = null; } };
    input.addEventListener('change', async () => {
      ready = null; goBtn.disabled = true; dropUrl();
      const file = input.files && input.files[0];
      if (!file) return;
      pickLabel.textContent = '다른 사진 고르기';
      put(preview, h('p', { class: 'hint' }, '확인하는 중…'));
      try { ready = await prepareUpload(file); } catch (e) { put(preview, h('p', { class: 'badbox' }, (e && e.message) || '이 파일은 올릴 수 없어.')); return; }
      prevUrl = URL.createObjectURL(ready.blob);
      put(preview, h('img', { class: 'big', src: prevUrl, alt: '상품 사진 미리보기' }), h('span', { class: 'hint' }, `${ready.w}×${ready.h} · ${fmtBytes(ready.blob.size)} · 숨은 정보(촬영 위치 등)는 빼고 올려`));
      goBtn.disabled = false;
    });
    const send = async () => {
      if (!ready) return;
      if (!rights.checked) { toast('쓸 권한이 있는 사진인지 확인 칸을 체크해줘.'); return; }
      const fd = new FormData();
      fd.append('meta', JSON.stringify({ post_id: PS && PS.postId ? PS.postId : undefined, purpose: 'general', rights: true, description: desc.value.trim() || '상품 사진', link: false, source_type: srcSel.value }));
      fd.append('file', ready.blob, ready.name);
      const j = await run(goBtn, () => api('/images/upload', { method: 'POST', body: fd }));
      if (j && j.image) { dropUrl(); closeSheet(); toast(j.reused ? '같은 사진이 보관함에 있어서 그걸 썼어' : '올렸어 (원본은 보관함에 따로 남아)'); done(j.image); }
    };
    openSheet('상품 사진 올리기',
      h('p', { class: 'hint' }, '상품이 잘 보이게 찍은 사진. 원본은 보관함에 그대로 남고, 합성은 새 이미지로 따로 저장돼.'),
      h('div', { class: 'go' }, picker), preview,
      field('이 사진은 어디서 났어?', srcSel, '공식·외부 사진은 그 사진의 이용 조건을 따라야 해.'),
      h('label', { class: 'chk' }, rights, '내가 찍었거나 쓸 권한이 있는 사진이야'),
      field('사진 설명', desc), goBtn);
    ui.setSheetOnClose(dropUrl);
  }
  function pickSheet(done) {
    let tab = 'upload', items = [], next = null, seq = 0;
    const seg = h('div', { class: 'seg', role: 'group' });
    const box = h('div', { class: 'stack' });
    const load = async (more) => {
      const my = ++seq;
      if (!more) put(box, h('p', { class: 'hint' }, '불러오는 중…'));
      try {
        const qs = new URLSearchParams({ kind: tab });
        if (more && next) qs.set('before', next);
        const j = await api('/images?' + qs);
        if (my !== seq) return;
        items = more ? items.concat(j.images) : j.images; next = j.next;
        put(box, items.length ? h('div', { class: 'grid3' }, items.map((i) => pickThumb(i, () => { closeSheet(); done(i); }))) : h('p', { class: 'hint' }, tab === 'upload' ? '직접 올린 사진이 없어. 사진 올리기로 넣어줘.' : 'Pexels 사진이 없어.'),
          next ? btn('더 보기', 'sm ghost', () => load(true)) : null);
      } catch (e) { if (my === seq && e && e.code !== 'auth') put(box, h('p', { class: 'hint' }, ui.errText(e))); }
    };
    const drawSeg = () => put(seg, ...[['upload', '직접 올린 사진'], ['stock', 'Pexels 사진']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(k === tab), onclick: () => { tab = k; drawSeg(); load(false); } }, l)));
    drawSeg();
    openSheet('상품 사진 고르기', h('p', { class: 'hint' }, '진짜 사진만 상품 사진으로 쓸 수 있어 (AI 이미지·합성 이미지는 원본 상품 사진이 아니야).'), seg, box);
    load(false);
  }

  // ═════════ 상품 디테일 검수 (원본과 나란히 — 사용자 승인) ═════════
  // 두 방식을 분명히 나눠서 보여주고, AI 의견은 참고로만 (승인을 대신하지 않음). 아홉 칸이 모두 '괜찮아'여야 승인
  // 1.5.2: 밀어서 비교·상품 부분 확대·(원본 보존 합성) 원본 픽셀 비교 버튼, 칸마다 볼 곳(방식마다 다름), 후기 오해 가능성 표시
  async function checkSheet(img0, o = {}) {
    const marker = h('p', { class: 'hint' }, '불러오는 중…');
    openSheet('상품 디테일 검수', marker);
    let j;
    try { j = await api('/images/' + img0.id); } catch (e) { if (e && e.code !== 'auth' && marker.isConnected) openSheet('상품 디테일 검수', h('p', { class: 'hint' }, ui.errText(e))); return; }
    if (!marker.isConnected) return;
    if (!cfg) { try { cfg = await api('/images/config'); } catch { /* 키 정보 없이 */ } }
    const img = j.image;
    const t = j.product || {};
    const mode = IMG.productSceneMode(img);
    if (!mode) { openSheet('상품 디테일 검수', h('p', { class: 'hint' }, PRODUCT_ERR.not_product_scene)); return; }
    const layer = mode === 'layer';
    const pc = img.product_check || {};
    const items = { ...(pc.items || {}) };
    const pre = layer && !pc.items ? IMG.preservedChecks(img.layer) : [];
    for (const k of pre) items[k] = 'ok';
    const note = h('textarea', { maxlength: '500', style: 'min-height:48px', placeholder: '예: 로고 위치 확인함 / 그림자가 조금 떠 보임' });
    note.value = pc.note || '';
    const stateLine = h('p', { class: 'hint' });
    const okB = btn('승인 — 사용 가능으로', 'wide', () => save(true));
    const saveB = btn('저장만 (승인 안 함)', 'sm ghost', () => save(false));
    const HINT = IMG.PRODUCT_CHECK_HINTS[layer ? 'layer' : 'reference'];
    const rows = IMG.PRODUCT_CHECKS.map(([k, label]) => {
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': label });
      const drawSeg = () => put(seg, ...Object.entries(IMG.PRODUCT_VERDICTS).map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(items[k] === v), onclick: () => { items[k] = v; drawSeg(); upd(); } }, l)));
      drawSeg();
      return h('div', { class: 'pcheck' }, h('b', null, label), HINT[k] ? h('small', { class: 'hint' }, HINT[k]) : null, pre.includes(k) ? h('small', { class: 'hint' }, '원본 픽셀 그대로라 미리 채웠어 — 그래도 확인해줘') : null, seg);
    });
    const upd = () => {
      const st = IMG.productCheckState(items);
      okB.disabled = !st.ok;
      stateLine.textContent = st.ok ? '모두 괜찮아 — 승인할 수 있어.' : `${st.missing.length ? `빈칸 ${st.missing.length}개` : ''}${st.issues.length ? ` · 문제 ${st.issues.length}개` : ''}${st.unsure.length ? ` · 모르겠음 ${st.unsure.length}개` : ''} — 모두 '괜찮아'여야 승인할 수 있어.`;
    };
    const save = async (approve) => {
      const r = await run(approve ? okB : saveB, () => api(`/images/${img.id}/product-check`, { method: 'POST', body: { items, note: note.value.trim(), approve } }), approve ? "승인했어 — '사용 가능'이 됐어" : '저장했어 (승인 안 함)');
      if (!r) return;
      if (r.demoted && r.demoted.length) toast(`승인을 풀어서 이 이미지를 쓰는 발행 준비 글 ${r.demoted.length}개를 '검수 필요'로 되돌렸어.`, 6000);
      closeSheet();
      if (o.onDone) o.onDone(r.image);
      if (approve && PS && PS.result && PS.result.id === img.id) PS.done = true;
      ui.load();
      if (PS && PS.postId) refreshPost(PS.postId);
    };
    upd();
    // AI 검수 (참고용)
    const aiBox = h('div', { class: 'stack' });
    const last = (j.reviews || []).find((r) => r.kind === 'ai_review');
    const aiView = (r) => {
      if (!r) return null;
      if (r.status === '실패') return h('p', { class: 'badbox' }, `AI 검수를 못 했어: ${r.error_message || r.error_code || '이유 없음'}`);
      const ch = (r.scores && r.scores.checks) || {};
      const V = { ok: ['괜찮아 보여', 'v-ok'], issue: ['확인 필요', 'v-no'], unsure: ['판단 어려움', 'v-unk'] };
      return h('div', { class: 'stack' }, h('p', { class: 'notice' }, `AI(${r.model}) 의견이야 — 참고용이고 합격 보증이 아니야. 틀릴 수 있어서 승인은 네가 원본과 비교해서 정해.`),
        r.summary ? h('p', null, r.summary) : null,
        h('ul', { class: 'lic' }, ...IMG.PRODUCT_CHECKS.filter(([k]) => ch[k]).map(([k, label]) => { const c = ch[k]; const v = V[c.verdict] || V.unsure; return h('li', null, h('span', { class: 'chip ' + v[1] }, v[0]), ` ${label}`, c.reason ? h('small', null, ` — ${c.reason}`) : null); })),
        r.uncertainty ? h('p', { class: 'hint' }, `불확실한 점: ${r.uncertainty}`) : null,
        h('p', { class: 'hint' }, `비용 ${usd(r.cost_status === '청구 없음' ? 0 : r.usage_usd ?? r.est_usd)} (${r.cost_status})`));
    };
    if (last) put(aiBox, h('p', { class: 'legend' }, '지난 AI 검수'), aiView(last));
    const keys = (cfg && cfg.keys) || {};
    const models = IMG.REVIEW_MODELS.map((m) => ({ ...m, ok: keyOk(keys, m.provider) }));
    const pick0 = models.find((m) => m.id === settings().image_review_model && m.ok) || models.find((m) => m.ok && m.free) || null;
    const rsel = h('select', { 'aria-label': '검수할 AI' }, pick0 ? null : opt('', '검수할 AI를 골라줘'), models.map((m) => opt(m.id, `${m.label}${m.free ? ' (무료)' : ' (유료)'}${m.ok ? '' : ' — 키 없음'}`)));
    rsel.value = pick0 ? pick0.id : '';
    const nImgs = 1 + Math.min(3, 1 + (layer ? 0 : (img.ref_images || []).filter((r) => r.role === 'subject' && r.image_id !== img.product_image_id).length));
    const rcost = h('p', { class: 'hint' });
    let rServer = null;
    const rB = btn('AI 검수 받기 (참고용)', 'sm ghost', async () => {
      const m = models.find((x) => x.id === rsel.value);
      const local = m ? IMG.estimateReviewUsd(m.id, nImgs) : null;
      const est = local != null && rServer && rServer.model === rsel.value && rServer.usd > local ? rServer.usd : local;
      const r = await run(rB, async () => {
        try { return await api(`/images/${img.id}/review`, { method: 'POST', body: { model: rsel.value, confirm_usd: est, post_id: PS && PS.postId ? PS.postId : undefined }, timeout: 90000 }); } catch (e) {
          if (e && e.code === 'estimate_changed' && Number.isFinite(Number(e.est_usd))) { rServer = { model: String(e.model || rsel.value), usd: Number(e.est_usd) }; rupd(); }
          throw e;
        }
      });
      if (r && r.review) put(aiBox, aiView(r.review));
    });
    const rupd = () => {
      const m = models.find((x) => x.id === rsel.value);
      const local = m ? IMG.estimateReviewUsd(m.id, nImgs) : null;
      const est = local != null && rServer && rServer.model === rsel.value && rServer.usd > local ? rServer.usd : local;
      rcost.textContent = !m ? '' : m.free ? `무료 · 결과와 원본 사진 ${nImgs - 1}장을 같이 보내` : `예상 ${usd(est)} · 결과와 원본 사진 ${nImgs - 1}장 (이미지 예산에 같이 셈)`;
      rB.disabled = !m || !m.ok || est == null;
    };
    rsel.addEventListener('change', () => { rServer = null; rupd(); });
    rupd();
    const prodImg = t.product || null;
    const aiDet = det('pcheck-ai', 'AI 검수 (참고용)', !!last, 'plain');
    aiDet.append(field('검수할 AI', rsel), rcost, rB, aiBox);
    // 후기·사용 인증 사진으로 오해될 가능성 (표시만)
    const slotText = (() => { const p = PS && PS.postId ? post() : null; const sl = p && PS.slotKey ? IMG.parseSlots(p.body).find((x) => x.key === PS.slotKey) : null; return sl ? sl.text : ''; })();
    const risk = IMG.reviewRiskOf({ img, slotText, post: PS && PS.postId ? post() : null });
    openSheet('상품 디테일 검수',
      h('div', { class: 'modebadge ' + (layer ? 'm-layer' : 'm-ref') }, h('b', null, layer ? '원본 보존 합성' : 'AI 재생성 (AI 실사 장면)'),
        h('small', null, layer ? '상품 픽셀은 원본 사진 그대로야. 배경·그림자·크기·가장자리를 주로 봐. 배경과 그림자는 AI와 앱이 만든 거라 실제 촬영 장소처럼 쓰면 안 돼.' : 'AI가 상품까지 다시 그렸어. 모양·글자·로고·버튼이 바뀌었을 수 있어서 아홉 칸 모두 네가 직접 확인해야 해.')),
      layer ? null : h('p', { class: 'badbox' }, '제품 외형·제품명·로고·인쇄 글자가 원본과 다를 수 있어. 다르면 승인하지 말고 다시 만들거나 원본 보존 합성을 써줘.'),
      risk.level === 'high' || risk.level === 'medium' ? h('div', { class: 'notice stack' }, h('b', null, `후기 사진으로 오해될 가능성: ${risk.level === 'high' ? '높음' : '있음'}`), ...risk.reasons.map((x) => h('small', null, '· ' + x)), h('small', null, risk.msg)) : null,
      compareBlock(img, prodImg, t, layer),
      t.costs ? h('p', { class: 'hint' }, [t.costs.model ? `모델 비용 ${usd(genCost(t.costs.model) ? genCost(t.costs.model).usd : 0)} (${t.costs.model.cost_status}, ${t.costs.model.model})` : '', t.costs.cutout ? `배경 지우기 ${usd(t.costs.cutout.cost_usd)} (${t.costs.cutout.cost_status} · ${t.costs.cutout.where})` : ''].filter(Boolean).join(' · ')) : null,
      ...rows, field('메모 (선택)', note), stateLine, okB, h('div', { class: 'go' }, saveB),
      aiDet,
      h('p', { class: 'hint' }, "승인하면 '사용 가능'이 되고, 승인을 풀면 '검수 전'으로 돌아가. 원본·결과 이미지는 지우거나 고치지 않아."));
  }
  // 원본과 결과 비교: 나란히 / 밀어서 비교 / 상품 부분 확대 / (원본 보존 합성) 원본 픽셀 비교
  // 원본 보존 합성은 저장할 때 남긴 '상품이 그려진 자리'(layer.box)와 마스크의 상품 상자로 같은 부분을 잘라서 맞춰 보여줌
  async function bitmapOf(url) {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!r.ok) throw new Error('fetch');
    return createImageBitmap(await r.blob());
  }
  const cropTo = (bmp, rc, W) => {
    const cv = h('canvas', { class: 'cropcv' });
    const sw = Math.max(1, rc.w * bmp.width), sh = Math.max(1, rc.h * bmp.height);
    const H = Math.max(1, Math.round((W * sh) / sw));
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(bmp, rc.x * bmp.width, rc.y * bmp.height, sw, sh, 0, 0, W, H);
    return cv;
  };
  const grow = (rc, m) => { const x = Math.max(0, rc.x - rc.w * m), y = Math.max(0, rc.y - rc.h * m); return { x, y, w: Math.min(1 - x, rc.w * (1 + 2 * m)), h: Math.min(1 - y, rc.h * (1 + 2 * m)) }; };
  function compareBlock(img, prodImg, t, layer) {
    const box = h('div', { class: 'stack' });
    const tabs = h('div', { class: 'seg', role: 'group', 'aria-label': '비교 방법' });
    const view = h('div', { class: 'stack' });
    let mode = 'side', bmps = null;
    const side = () => h('div', { class: 'cmp' }, h('figure', null, prodImg && prodImg.url ? thumb(prodImg, null) : h('p', { class: 'hint' }, '원본 사진을 불러오지 못했어'), h('figcaption', null, '원본 상품 사진')),
      h('figure', null, thumb(img, null), h('figcaption', null, layer ? '합성 결과' : 'AI 실사 장면')));
    // 잘라 볼 곳: 원본 보존 합성은 상품 상자(마스크)와 결과에서 상품이 놓인 자리, AI 실사 장면은 위치를 몰라서 그림 전체
    const rects = () => {
      const L = img.layer || {};
      const mb = t.mask && t.mask.bbox && t.mask.width ? { x: t.mask.bbox.x / t.mask.width, y: t.mask.bbox.y / t.mask.height, w: t.mask.bbox.w / t.mask.width, h: t.mask.bbox.h / t.mask.height } : null;
      if (layer && L.box && mb) return { a: grow(mb, 0.06), b: grow({ x: L.box.l, y: L.box.t, w: L.box.w, h: L.box.h }, 0.06), aligned: true };
      return { a: { x: 0, y: 0, w: 1, h: 1 }, b: { x: 0, y: 0, w: 1, h: 1 }, aligned: false };
    };
    const load = async () => {
      if (bmps) return bmps;
      if (!prodImg || !prodImg.url || !img.url) throw new Error('no_url');
      const [a, b] = await Promise.all([bitmapOf(prodImg.url), bitmapOf(img.url)]);
      bmps = { a, b };
      return bmps;
    };
    const show = async () => {
      put(tabs, ...[['side', '나란히'], ['swipe', '밀어서 비교'], ['zoom', '상품 부분 확대']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(mode === k), onclick: () => { mode = k; show(); } }, l)));
      if (mode === 'side') { put(view, side()); return; }
      put(view, h('p', { class: 'hint' }, '불러오는 중…'));
      try {
        const { a, b } = await load();
        const rc = rects();
        if (mode === 'swipe') {
          const W = 720;
          const cb = cropTo(b, rc.b, W), ca = cropTo(a, rc.a, W);
          ca.style.height = '100%'; ca.style.width = '100%'; ca.style.objectFit = 'contain';
          const top = h('div', { class: 'swipe-top' }, ca);
          const range = h('input', { type: 'range', min: '0', max: '100', step: '1', value: '50', 'aria-label': '원본·결과 나누는 위치' });
          const set = () => { top.style.clipPath = `inset(0 ${100 - Number(range.value)}% 0 0)`; top.style.webkitClipPath = top.style.clipPath; };
          range.addEventListener('input', set); set();
          put(view, h('div', { class: 'swipe' }, cb, top), range,
            h('small', { class: 'hint' }, `왼쪽 = 원본 상품 사진, 오른쪽 = ${layer ? '합성 결과' : 'AI 실사 장면'}. ${rc.aligned ? '상품 부분을 같은 크기로 맞춰 겹쳤어.' : '상품 위치가 달라서 겹쳐 보기는 대략적이야 — 나란히·확대로도 봐줘.'}`));
        } else {
          const W = 900;
          put(view, h('div', { class: 'zoomrow' }, h('figure', null, h('div', { class: 'zoombox' }, cropTo(a, rc.a, W)), h('figcaption', null, '원본 (상품 부분)')),
            h('figure', null, h('div', { class: 'zoombox' }, cropTo(b, rc.b, W)), h('figcaption', null, layer ? '합성 결과 (상품 부분)' : 'AI 실사 장면 (전체)'))),
            h('small', { class: 'hint' }, '로고·글자·버튼을 하나씩 비교해줘. 밀어서 움직일 수 있어.'));
        }
      } catch { put(view, h('p', { class: 'hint' }, '이미지를 불러오지 못했어 (주소가 닫혔을 수 있어 — 창을 닫고 다시 열어줘). 나란히 보기로 확인해줘.'), side()); }
    };
    show();
    box.append(tabs, view);
    // 원본 보존 합성 + 원본 크기 그대로 + 회전 0 + 상품 밝기·색 그대로 + 줄여 읽지 않은 사진이면, 상품 안쪽 칸을 원본과 한 칸씩 비교할 수 있음
    const L = img.layer || {};
    const exact = layer && L.one === true && !Number(L.rot) && !L.src_scaled && !(L.tone && (Number(L.tone.b) || Number(L.tone.w))) && L.box && t.mask && t.mask.url;
    if (layer) {
      const out = h('div', { class: 'stack' });
      box.append(exact ? btn('원본과 픽셀 비교하기 (이 기기에서)', 'sm ghost', (ev) => pixelCheck(ev.currentTarget, img, prodImg, t, out))
        : h('small', { class: 'hint' }, '크기를 바꿨거나 돌렸거나 상품 밝기·색을 바꿔서 픽셀 비교는 안 해 — 눈으로 비교해줘.'), out);
    }
    return box;
  }
  // 상품 안쪽(완전히 불투명한 칸)만 원본 사진과 결과를 한 칸씩 비교 — 결과는 숫자로만 보여주고, 그래도 승인은 사람이 함
  async function pixelCheck(button, img, prodImg, t, out) {
    button.disabled = true;
    put(out, h('p', { class: 'hint' }, '비교하는 중… (큰 사진은 몇 초 걸려)'));
    try {
      const [P, R, M] = await Promise.all([CUT.decodeImage(prodImg.url), CUT.decodeImage(img.url), CUT.maskFromPng(t.mask.url)]);
      const L = IMG.cleanLayer(img.layer);
      const full = CUT.maskAt(M.data, M.w, M.h, P.w, P.h);
      const alpha = CUT.edgeMask(full, P.w, P.h, { feather: L.mask.feather, shrink: L.mask.shrink });
      const sb = CUT.maskBBox(alpha, P.w, P.h, 8);
      if (!sb) throw new Error('empty');
      const left = Math.round(L.box.l * R.w), top = Math.round(L.box.t * R.h);
      let n = 0, same = 0;
      for (let y = 0; y < sb.h; y++) for (let x = 0; x < sb.w; x++) {
        const px = sb.x + x, py = sb.y + y, rx = left + x, ry = top + y;
        if (rx < 0 || ry < 0 || rx >= R.w || ry >= R.h || alpha[py * P.w + px] < 255) continue;
        const i = (py * P.w + px) * 4, k = (ry * R.w + rx) * 4;
        n++;
        if (P.data[i] === R.data[k] && P.data[i + 1] === R.data[k + 1] && P.data[i + 2] === R.data[k + 2]) same++;
      }
      put(out, n ? h('p', { class: same === n ? 'okbox' : 'notice' }, `상품 안쪽 ${n.toLocaleString('ko-KR')}칸 중 ${same.toLocaleString('ko-KR')}칸이 원본과 같아 (${Math.floor((same / n) * 1000) / 10}%). ${same === n ? '상품 픽셀은 원본 그대로야 — 가장자리·그림자·배경은 눈으로 봐줘.' : '다른 칸이 있어 — 가장자리 설정이나 저장 과정을 확인해줘.'}`)
        : h('p', { class: 'hint' }, '비교할 칸을 찾지 못했어.'));
    } catch { put(out, h('p', { class: 'hint' }, '비교하지 못했어 (사진을 불러오지 못했거나 메모리가 모자랐을 수 있어). 눈으로 비교해줘.')); }
    finally { if (button.isConnected) button.disabled = false; }
  }

  // ═════════ 공급자 비교 — 같은 상품·같은 장면으로 (지시서 9번) ═════════
  // 무료 Cloudflare: 빈 배경 2장(원본 보존 합성) + AI 실사 장면 1장. 유료(키가 있고, 줄마다 '승인'을 체크할 때만): GPT Image 2.5 Sunburst·Gemini 3 Pro Image 실사 장면 1장씩.
  // 모두 같은 장면 설정·비율·참고 사진으로 보내고, 모델이 못 받는 것(참고 사진 수 초과 등)이 있으면 그 줄은 막음. 시간·비용은 생성 기록 그대로, 평가는 사용자가
  const CMP_ROWS = [
    { id: 'cf_bg', label: '무료 Cloudflare FLUX.2 — 빈 배경 2장 (원본 보존 합성)', mode: 'layer', model: IMG.FREE_MODEL, quality: 'medium', n: 2 },
    { id: 'cf_ref', label: '무료 Cloudflare FLUX.2 — AI 실사 장면 1장', mode: 'reference', model: IMG.FREE_MODEL, quality: 'medium', n: 1 },
    { id: 'oa_ref', label: 'OpenAI GPT Image 2.5 Sunburst (높음) — AI 실사 장면 1장', mode: 'reference', model: 'gpt-image-2.5-sunburst', quality: 'high', n: 1 },
    { id: 'gm_ref', label: 'Google Gemini 3 Pro Image (2K) — AI 실사 장면 1장', mode: 'reference', model: 'gemini-3-pro-image', quality: 'high', n: 1 },
  ];
  function compareSheet() {
    const ps = PS;
    if (!ps || !ps.product || ps.busy) return;
    const keys = (cfg && cfg.keys) || {};
    const ratio = IMG.ratioOf(ps.purpose, ps.ratio || prefRatio(ps.purpose));
    const plan = (row) => {
      const q = IMG.normQuality(row.model, row.quality);
      const size = IMG.sizeFor(ps.purpose, ratio, row.model, q);
      const sp = { ...spec(), mode: row.mode, template: row.mode === 'reference' && ps.template === 'bg_only' ? 'table' : ps.template };
      const refs = row.mode === 'reference' ? ps.extras.map((x) => ({ image_id: x.id, role: 'subject' })) : [];
      const nr = row.mode === 'reference' ? 1 + refs.length : 0;
      const sc = IMG.buildProductScene({ spec: sp, ratio, size: IMG.sizeLabel(size), refs: row.mode === 'reference' ? [{ image_id: ps.product.id, role: 'subject' }, ...refs] : [] });
      const c = IMG.modelCaps(row.model);
      const est = IMG.estimateUsd({ quality: q, size, promptTokens: IMG.estimateTokens(IMG.promptFromProductScene(sc)), mode: 'generate', prices: prices(), model: row.model, refs: nr });
      const why = !keyOk(keys, c.provider) ? noKeyText(c.provider) : row.mode === 'reference' && nr > IMG.refsLimit(row.model, 'generate') ? `참고 사진이 이 모델이 받는 수(${IMG.refsLimit(row.model, 'generate')}장)보다 많아.` : est == null ? '예상 비용을 계산하지 못했어.' : '';
      return { row, q, size, sp, refs, nr, c, est, why, total: est == null ? null : IMG.roundUsd(est * row.n) };
    };
    const plans = CMP_ROWS.map(plan);
    const picks = new Set(plans.filter((p) => !p.why && p.c.free).map((p) => p.row.id));
    const approved = new Set();
    const list = h('div', { class: 'stack' }), costB = h('div', { class: 'costbox' }), msg = h('div');
    const goB = btn('비교 만들기', 'wide', () => start());
    let busy = false;
    const update = () => {
      put(list, ...plans.map((p) => {
        const c = h('input', { type: 'checkbox' });
        c.checked = picks.has(p.row.id); c.disabled = !!p.why || busy;
        c.addEventListener('change', () => { if (c.checked) picks.add(p.row.id); else { picks.delete(p.row.id); approved.delete(p.row.id); } update(); });
        const ap = h('input', { type: 'checkbox' });
        ap.checked = approved.has(p.row.id); ap.disabled = busy;
        ap.addEventListener('change', () => { if (ap.checked) approved.add(p.row.id); else approved.delete(p.row.id); update(); });
        return h('div', { class: 'slot' }, h('label', { class: 'chk' }, c, ` ${p.row.label}`),
          h('small', { class: 'hint' }, `${p.c.label} · ${IMG.qualityLabel(p.row.model, p.q)} · ${IMG.sizeLabel(p.size)} · ${p.c.free ? '무료 (Cloudflare 하루 무료 한도 안에서)' : p.est == null ? '비용 계산 못 함' : `예상 ${usd(p.total)}${p.row.n > 1 ? ` (${p.row.n}장)` : ''}`}${p.row.mode === 'reference' ? ` · 참고 사진 ${p.nr}장` : ' · 상품 사진은 안 보냄'}`),
          p.why ? h('small', { class: 'hint' }, p.why) : null,
          !p.c.free && picks.has(p.row.id) ? h('label', { class: 'chk' }, ap, ` 이 유료 요청을 승인해 (예상 ${usd(p.total)} — 실제 청구는 ${IMG.PROVIDERS[p.c.provider].label} 사용량 화면에서 확인)`) : null);
      }));
      const sel = plans.filter((p) => picks.has(p.row.id));
      const total = IMG.roundUsd(sel.reduce((a, p) => a + (p.total || 0), 0));
      const u = cfg && cfg.usage;
      const nImgs = sel.reduce((a, p) => a + p.row.n, 0);
      let why = '';
      if (sel.length < 2) why = '비교할 줄을 2개 이상 골라줘 (키가 있는 것만).';
      else if (sel.some((p) => !p.c.free && !approved.has(p.row.id))) why = '유료 줄은 하나씩 승인을 체크해야 만들어.';
      else if (sel.some((p) => p.row.mode === 'layer') && !ps.mask) why = "원본 보존 합성 줄은 3번에서 상품 영역을 먼저 정해줘 (배경에 얹어 봐야 비교가 돼).";
      else if (PS.blocked) why = '장면 설정의 빨간 내용을 고쳐야 만들 수 있어.';
      else if (u && Number(u.today) + nImgs > Number(u.daily_limit)) why = `오늘 만들 수 있는 횟수가 모자라 (${nImgs}장 필요).`;
      else if (u && Number(u.month_usd) + total > Number(u.budget_usd) + 1e-9) why = '이번 달 예산을 넘게 돼.';
      else if (u && u.request_cap_usd != null && sel.filter((p) => !p.c.free).some((p) => p.total > Number(u.request_cap_usd) + 1e-9)) why = `한 번에 쓸 수 있는 금액(${usd(u.request_cap_usd)})을 넘는 줄이 있어.`;
      put(costB, h('span', null, `같은 장면: ${IMG.PRODUCT_PURPOSES[ps.purpose].label} · ${IMG.PRODUCT_TEMPLATES[ps.template].label} · ${ratio} · 빛 ${DIR_KO[ps.light] || '지정 안 함'}`),
        h('b', { class: 'num' }, total > 0 ? `합계 예상 ${usd(total)} (유료 줄만)` : '모두 무료'),
        h('span', { class: 'hint' }, '한두 번 비교로 어느 모델이 늘 낫다고 단정할 수는 없어. 무료 모델은 참고 사진을 작게 줄여서 받아.'));
      goB.disabled = !!why || busy;
      goB.textContent = busy ? '만드는 중…' : total > 0 ? `예상 ${usd(total)} · 비교 만들기` : '무료 · 비교 만들기';
      if (!busy) put(msg, why ? h('p', { class: 'hint' }, why) : '');
    };
    const results = [];
    const start = async () => {
      if (busy || ps.busy) return;
      busy = true; ps.busy = true; update();
      const sel = plans.filter((p) => picks.has(p.row.id));
      try {
        if (sel.some((p) => p.row.mode === 'layer') && ps.mask && (!ps.maskSaved || ps.maskDirty)) { const m = await saveMask(null); if (!m) return; }
        if (sel.some((p) => p.row.mode === 'reference' && p.c.provider === 'cloudflare')) {
          put(msg, h('p', { class: 'hint' }, '무료 모델에 보낼 작은 사본을 만드는 중… (원본은 그대로)'));
          try { for (const im of [ps.product, ...ps.extras]) await ensureSmall(im); } catch (err) { put(msg, h('p', { class: 'badbox' }, '작은 사본을 만들지 못했어: ' + ((err && err.code ? ui.errText(err) : err && err.message) || '이유 모름'))); return; }
        }
        const refRows = sel.filter((p) => p.row.mode === 'reference');
        const refBatch = newUuid();
        for (const p of sel) {
          const n = p.row.n;
          const batch = p.row.mode === 'layer' ? (n > 1 ? { id: newUuid(), kind: 'candidates', total: n } : null) : refRows.length > 1 ? { id: refBatch, kind: 'compare', total: refRows.length } : null;
          for (let i = 0; i < n; i++) {
            if (!goB.isConnected && results.length) break;
            const idx = p.row.mode === 'layer' ? i : refRows.indexOf(p);
            put(msg, h('div', { class: 'genprog' }, h('i', { class: 'spin', 'aria-hidden': 'true' }), h('span', null, ` ${p.c.label} ${n > 1 ? `${i + 1}/${n}장 ` : ''}만드는 중…`)));
            const body = { request_key: newKey(), product: p.sp, product_image_id: ps.product.id, refs: p.refs, post_id: ps.postId || undefined, slot_key: ps.slotKey || undefined,
              ratio, quality: p.q, model: p.row.model, confirm_usd: p.est,
              batch: batch ? { id: batch.id, kind: batch.kind, index: idx, total: batch.total } : undefined,
              reserve_usd: batch && p.est != null ? IMG.roundUsd(batch.kind === 'compare' ? refRows.slice(idx).reduce((a, x) => a + (x.est || 0), 0) : p.est * (n - i)) : undefined };
            const t0 = Date.now();
            const r = await sendOne(ps, body, i, { c: p.c }, n);
            results.push({ p, r, ms: Date.now() - t0, batch: batch ? batch.id : '' });
            if (r && r.image) ps.cands.push({ image: r.image, gen: r.gen, mode: p.row.mode });
            if (!r || !r.image) break;
          }
        }
      } finally {
        busy = false; ps.busy = false;
        if (PS === ps) say(null);
      }
      if (PS === ps) draw();
      refreshPost(ps.postId);
      if (goB.isConnected) showResults(); else toast('공급자 비교: 보낸 장까지만 만들고 멈췄어. 결과는 보관함과 후보에 있어.', 4000);
    };
    const evalBox = (img, batchId) => {
      const sc = {};
      let pref = false;
      const segs = IMG.PRODUCT_EVAL_CRITERIA.map(([k, label, inv]) => {
        const seg = h('div', { class: 'seg', role: 'group', 'aria-label': label });
        const dr = () => put(seg, ...[[3, inv ? '거의 없음' : '좋음'], [2, '보통'], [1, inv ? '많이 남' : '아쉬움']].map(([v, l]) =>
          h('button', { type: 'button', 'aria-pressed': String(sc[k] === v), onclick: () => { sc[k] = sc[k] === v ? undefined : v; dr(); } }, l)));
        dr();
        return h('div', { class: 'stack' }, h('small', null, label), seg);
      });
      const pc = h('input', { type: 'checkbox' });
      pc.addEventListener('change', () => { pref = pc.checked; });
      const sv = btn('내 평가 저장', 'sm', async (ev) => {
        const b = ev.currentTarget;
        const j = await run(b, () => api(`/images/${img.id}/evaluate`, { method: 'POST', body: { scores: sc, preferred: pref, batch_id: batchId || undefined, note: 'product_compare' } }), '평가를 저장했어');
        if (j) b.textContent = '저장했어';
      });
      return h('div', { class: 'stack' }, h('p', { class: 'legend' }, '내 평가 (시간·비용은 위에 자동으로)'), ...segs, h('label', { class: 'chk' }, pc, ' 이 비교에서 제일 나아'), sv);
    };
    const showResults = () => {
      openSheet('공급자 비교 결과',
        h('p', { class: 'hint' }, '같은 상품·장면·비율로 만든 결과야. 원본 보존 합성 줄은 추천값으로 상품을 얹어 본 미리보기야 (저장은 본 화면에서). 평가는 네가 매겨 — 앱이 대신 고르지 않아.'),
        ...results.map(({ p, r, ms, batch }) => {
          if (!r || !r.image) return h('div', { class: 'slot' }, h('b', null, p.row.label), h('p', { class: 'badbox' }, r && r.generation ? r.generation.error_message || '못 만들었어' : '못 만들었어 (돈이 나가기 전에 멈췄을 수 있어 — 비용 기록을 확인해줘)'));
          const g = r.generation || r.gen || {}, k = genCost(g);
          const secs = g.started_at && g.finished_at ? Math.max(1, Math.round((Date.parse(g.finished_at) - Date.parse(g.started_at)) / 1000)) : Math.round(ms / 1000);
          const tile = h('div', { class: 'slot on' }, h('b', null, p.row.label));
          if (p.row.mode === 'layer' && ps.mask && ps.src) {
            const cv = h('canvas', { class: 'cthumb' });
            const cand = ps.cands.find((x) => x.image.id === r.image.id) || { image: r.image };
            (async () => { const rec = await fitFor(cand); const lay = IMG.cleanLayer({ ...IMG.defaultLayer(spec()), ...rec.layer }); await previewInto(cv, cand, lay, 520); })().catch(() => put(tile, h('b', null, p.row.label), thumb(r.image, null)));
            tile.append(cv);
          } else tile.append(thumb(r.image, null));
          tile.append(h('p', { class: 'hint' }, `${g.model || r.image.model} · ${IMG.qualityLabel(g.model || p.row.model, g.quality || p.q)} · ${r.image.width}×${r.image.height} · ${secs}초 · 비용 ${usd(k ? k.usd : 0)} (${k ? k.label : g.cost_status || '?'})`),
            p.row.mode === 'reference' ? h('p', { class: 'notice' }, "AI가 상품까지 그렸어 — '상품 외형 보존'은 원본과 비교해서 매겨줘.") : null,
            evalBox(r.image, batch));
          return tile;
        }),
        h('div', { class: 'go' }, btn('닫기', 'sm ghost', closeSheet)));
    };
    openSheet('공급자 비교 (같은 상품·같은 장면)',
      h('p', { class: 'hint' }, '같은 상품 사진·장면 설정·비율로 공급자마다 만들어 비교해. 무료 줄은 바로, 유료 줄은 키가 있고 줄마다 승인을 체크해야 보내. 모르는 옵션은 보내지 않아.'),
      list, costB, msg, goB);
    update();
  }

  return { start, view, checkSheet };
}
