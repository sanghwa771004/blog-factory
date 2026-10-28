// product.js — '이 상품으로 장면 만들기' (1.5.1)
// 상품 사진 하나로 블로그 본문·대표 이미지·상품 상세·SNS·광고용 장면을 만듦. 두 방식은 목적과 한계가 달라서 섞지 않음:
//  · 원본 보존 합성(layer): 이 기기에서 상품 사진의 배경을 지우고(cutout.js — 무료, 사진이 밖으로 안 나감) AI가 만든 '빈 배경' 위에
//    원본 픽셀을 그대로 얹음. 위치·크기·회전·그림자·밝기를 바꿔도 상품은 다시 그리지 않음
//  · AI 실사 장면(reference): 상품 사진을 '대상 모양 유지' 참고 사진으로 보내 AI가 장면 전체를 그림 → 'AI 합성 이미지', 작은 글자·로고는 바뀔 수 있음
// 어느 쪽이든 상품 디테일 검수를 승인해야 '사용 가능'이 되고, 발행 준비 완료·예약·게시 완료로 바꿀 수 있음 (서버·DB도 같은 규칙)
// 유료 생성은 예상 비용을 보여준 뒤 버튼을 누를 때만. 앱은 블로그에 사진을 대신 올리지 않음
import * as IMG from './images.js?v=1.5.1';
import * as CUT from './cutout.js?v=1.5.1';

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

export function createProduct(ui, kit) {
  const { h, btn, field, det, opt, api, run, toast, openSheet, closeSheet, go, L } = ui;
  const { put, thumb, pickThumb, kindChip, reviewChip, sendGenerate, ensureSmall, modeChoices, keyOk, noKeyText, usageLine, genCost, prepareUpload, sourceSelect,
    newKey, newUuid, usd, refreshPost, TEST_MODEL, fmtBytes } = kit;
  const settings = () => (ui.S.settings || {});
  const prices = () => settings().image_prices || IMG.DEFAULT_PRICES;
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let PS = null;     // 지금 작업 (화면을 다시 그려도 남음 — 새로고침하면 처음부터지만 만든 이미지는 보관함에 남음)
  let cfg = null;    // /images/config (키 있음/없음·사용량)

  // ═════════ 시작 ═════════
  // productId: 상품 사진(직접 올림·Pexels), resume: 다시 맞출 상품 장면 결과(합성·AI 실사 장면), postId·slotKey: 넣을 원고·자리
  function start(o = {}) {
    init(o);
    go(o.postId ? `content/post/${o.postId}/product` : 'content/product');
  }
  function init({ productId = '', postId = '', slotKey = '', resume = '' } = {}) {
    PS = {
      postId, slotKey, product: null, extras: [], name: '', src: null, srcP: null,
      mask: null, maskMethod: '', maskEdited: false, maskSaved: null, maskDirty: false, undo: [], paint: false, tool: 'add', brush: 0.035, segNote: '', savedMasks: [],
      purpose: 'blog_body', mode: 'layer', template: 'table', angle: 'front', place: 'center', custom: '',
      ratio: '', modeId: '', quality: '', count: 1,
      busy: false, status: null, serverEst: null, newModel: '',
      cands: [], pick: -1, layer: null, result: null, parentId: '', editText: '', loading: !!(productId || resume), el: {},
    };
    const ps = PS;
    if (resume) loadResume(ps, resume);
    else if (productId) api('/images/' + productId).then((j) => { if (PS !== ps) return; setProduct(j.image, j.masks || []); ps.loading = false; draw(); }).catch((e) => { ps.loading = false; if (e && e.code !== 'auth') toast(ui.errText(e)); draw(); });
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
          ps.mask = m; ps.maskSaved = t.mask; ps.maskSavedMask = { data: Uint8ClampedArray.from(m.data), w: m.w, h: m.h }; ps.maskMethod = t.mask.method; ps.maskEdited = !!t.mask.edited; ps.maskDirty = false; ps.maskRev = (ps.maskRev || 0) + 1;
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
    PS.name = PS.name || clean(img.description || '').slice(0, 60);
    PS.src = null; PS.mask = null; PS.maskSaved = null; PS.maskDirty = false; PS.undo = []; PS.maskMethod = ''; PS.segNote = '';
    PS.savedMasks = masks || [];
    PS.cands = []; PS.pick = -1; PS.result = null; PS.parentId = '';
    PS.srcP = img && img.url ? CUT.decodeImage(img.url, 2560).then((s) => { if (PS && PS.product === img) { PS.src = s; draw(); } return s; }) : null;
    if (PS.srcP) PS.srcP.catch(() => { if (PS) { PS.segNote = '상품 사진을 불러오지 못했어. 새로고침한 뒤 다시 해줘 (주소는 1시간 동안만 열려).'; draw(); } });
  }
  const spec = () => IMG.cleanProductSpec({ mode: PS.mode, template: PS.template, purpose: PS.purpose, angle: PS.angle, place: PS.place, custom: PS.custom, name: PS.name });
  const prefRatio = (pu) => { const r = (settings().image_ratio_prefs || {})[pu]; const rs = (IMG.PURPOSES[pu] || IMG.PURPOSES.blog_body).ratios; return rs.includes(r) ? r : rs[0]; };
  const post = () => (PS.postId ? ui.post(PS.postId) : null);

  // ═════════ 화면 ═════════
  function view(postId) {
    const box = h('div', { class: 'view product' });
    // 바로 주소로 들어온 경우 (새로고침 등)·다른 원고: 새 작업으로 (주소는 이미 맞아서 화면만 새로)
    if (!PS || (postId || '') !== (PS.postId || '')) init({ postId: postId || '' });
    PS.root = box;
    draw(true);
    if (!cfg) api('/images/config').then((j) => { cfg = j; draw(); }).catch(() => {});
    return box;
  }
  function draw(force) {
    if (!PS || !PS.root || (!force && !PS.root.isConnected)) return;
    const p = post();
    const back = PS.postId ? btn('← 원고', 'sm ghost back', () => go('content/post/' + PS.postId)) : btn('← 이미지 보관함', 'sm ghost back', () => go('content/images'));
    put(PS.root, back,
      h('section', { class: 'panel' }, h('h2', null, '이 상품으로 장면 만들기'),
        h('p', { class: 'hint' }, `${p ? `원고: ${ui.titleOf(p)} · ` : ''}상품 사진 하나로 블로그·SNS·광고용 장면을 만들어. 버튼을 누를 때만 만들고, 유료 모델은 예상 비용을 먼저 보여줘.`),
        PS.loading ? h('p', { class: 'hint' }, '불러오는 중…') : null),
      secProduct(), secExtras(), secMask(), secPurpose(), secScene(), secOutput(), secGenerate(), secCandidates(), secResult(), secInsert());
  }
  const step = (n, title, ...kids) => h('section', { class: 'panel pstep' }, h('h3', null, h('span', { class: 'stepn' }, String(n)), ' ', title), ...kids);

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
  function secMask() {
    if (!PS.product) return null;
    const need = PS.mode === 'layer';
    const kids = [h('p', { class: 'hint' }, need ? '원본 보존 합성은 여기서 남긴 부분(상품)만 원본 픽셀 그대로 배경 위에 얹어. 이 기기 안에서 처리해서 무료이고 사진이 밖으로 나가지 않아.'
      : "AI 실사 장면은 마스크 없이 만들 수 있어 (건너뛰어도 돼). 원본 보존 합성을 쓰려면 여기서 상품 영역을 정해줘.")];
    if (PS.segNote) kids.push(h('p', { class: 'notice' }, PS.segNote));
    if (!PS.src) { kids.push(h('p', { class: 'hint' }, '상품 사진을 불러오는 중…')); return step(3, '상품에서 남길 영역 확인', ...kids); }
    if (!PS.mask) {
      kids.push(h('div', { class: 'go' },
        btn('자동으로 배경 지우기 (이 기기에서 · 무료)', 'sm', (ev) => autoMask(ev.currentTarget, true)),
        btn('간단히 (흰 배경·단색 배경 사진)', 'sm ghost', (ev) => autoMask(ev.currentTarget, false)),
        PS.savedMasks.length ? btn('저장해 둔 영역 쓰기', 'sm ghost', (ev) => useSavedMask(ev.currentTarget, PS.savedMasks[0])) : null),
      h('p', { class: 'hint' }, '처음 한 번 배경 지우기 도구(약 19MB)를 받아서 이 기기에 저장해 둬 — Wi-Fi에서 권장. 다음부터는 바로 돼.'));
      return step(3, '상품에서 남길 영역 확인', ...kids);
    }
    const m = PS.mask;
    if (!PS.el.maskCv) PS.el.maskCv = maskCanvas();
    const cv = PS.el.maskCv;
    paintMask();
    const tools = h('div', { class: 'seg', role: 'group', 'aria-label': '붓' }, ...[['add', '남기기'], ['erase', '지우기']].map(([k, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(PS.tool === k), onclick: () => { PS.tool = k; draw(); } }, l)));
    const size = h('input', { type: 'range', min: '0.01', max: '0.12', step: '0.005', value: String(PS.brush), 'aria-label': '붓 크기' });
    size.addEventListener('input', () => { PS.brush = Number(size.value); });
    const cov = CUT.maskCoverage(m.data);
    kids.push(
      h('div', { class: 'maskwrap' + (PS.paint ? ' painting' : '') }, cv),
      h('p', { class: 'hint' }, `분홍색으로 덮인 곳이 지울 곳이야. 남긴 부분 ${Math.round(cov * 100)}% · ${m.w}×${m.h} · ${IMG.MASK_METHODS[PS.maskMethod] || '직접 칠함'}${PS.maskEdited ? ' · 손으로 고침' : ''}`),
      h('div', { class: 'go' }, btn(PS.paint ? '칠하기 끄기 (화면 움직이기)' : '칠해서 고치기', PS.paint ? 'sm' : 'sm ghost', () => { PS.paint = !PS.paint; draw(); }),
        PS.paint ? tools : null, PS.paint ? field('붓 크기', size) : null,
        btn('되돌리기', 'sm ghost', () => {
          const u = PS.undo.pop();
          if (!u) return;
          // 되돌리면 그때의 방법·'손으로 고침'·저장 상태도 같이 (저장한 영역 그대로면 다시 저장하지 않아도 됨)
          PS.mask = { data: u.data, w: u.w, h: u.h }; PS.maskEdited = u.edited; PS.maskMethod = u.method; PS.maskDirty = u.dirty || u.saved !== PS.maskSaved;
          PS.maskRev = (PS.maskRev || 0) + 1; draw();
        }, { disabled: !PS.undo.length })),
      h('div', { class: 'go' }, btn('다시 자동으로', 'sm ghost', (ev) => autoMask(ev.currentTarget, true)), btn('간단히', 'sm ghost', (ev) => autoMask(ev.currentTarget, false)),
        btn(PS.maskSaved && !PS.maskDirty ? '영역 저장됨 ✓' : '이 영역 저장', PS.maskSaved && !PS.maskDirty ? 'sm ghost' : 'sm', (ev) => saveMask(ev.currentTarget), { disabled: !!(PS.maskSaved && !PS.maskDirty) })),
      cov < 0.02 ? h('p', { class: 'badbox' }, '남긴 부분이 거의 없어. 칠해서 상품을 남기거나 다시 자동으로 해줘.') : null,
      cov > 0.97 ? h('p', { class: 'notice' }, '거의 다 남았어 — 배경이 안 지워진 것 같아. 지우기 붓으로 배경을 지워줘.') : null,
      h('p', { class: 'hint' }, "가장자리에 원래 배경이 조금 남으면 합성 화면의 '가장자리 안쪽으로'로 깎을 수 있어. 저장해도 원본 사진은 그대로야."));
    return step(3, '상품에서 남길 영역 확인', ...kids);
  }
  // 되돌리기용: 마스크와 그때의 방법·고침 여부·저장 상태 (최근 8번까지)
  const pushUndo = (ps) => { ps.undo.push({ data: Uint8ClampedArray.from(ps.mask.data), w: ps.mask.w, h: ps.mask.h, edited: ps.maskEdited, method: ps.maskMethod, dirty: ps.maskDirty, saved: ps.maskSaved }); if (ps.undo.length > 8) ps.undo.shift(); };
  function maskCanvas() {
    const cv = h('canvas', { class: 'maskcv', 'aria-label': '상품 영역 (칠해서 고치기)' });
    let last = null, snap = false;
    const at = (e) => { const b = cv.getBoundingClientRect(); return { x: ((e.clientX - b.left) / b.width) * PS.mask.w, y: ((e.clientY - b.top) / b.height) * PS.mask.h }; };
    let raf = 0;
    const redrawSoon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintMask(); }); };
    cv.addEventListener('pointerdown', (e) => {
      if (!PS.paint || !PS.mask) return;
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
    const end = () => { if (last) { last = null; snap = false; PS.maskDirty = true; PS.maskEdited = true; PS.maskRev = (PS.maskRev || 0) + 1; draw(); } };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    return cv;
  }
  // 마스크 보기: 지울 곳은 분홍색으로 덮고, 남길 곳은 원본 그대로
  function paintMask() {
    const cv = PS.el.maskCv, m = PS.mask;
    if (!cv || !m || !PS.src) return;
    if (!PS.maskView || PS.maskView.w !== m.w) PS.maskView = { w: m.w, h: m.h, base: shrinkTo(PS.src, m.w, m.h) };
    const b = PS.maskView.base;
    const out = new Uint8ClampedArray(m.w * m.h * 4);
    for (let p = 0; p < m.w * m.h; p++) {
      const t = 0.62 * (1 - m.data[p] / 255);
      out[p * 4] = b[p * 4] * (1 - t) + 255 * t; out[p * 4 + 1] = b[p * 4 + 1] * (1 - t) + 70 * t; out[p * 4 + 2] = b[p * 4 + 2] * (1 - t) + 150 * t; out[p * 4 + 3] = 255;
    }
    cv.width = m.w; cv.height = m.h;
    cv.getContext('2d').putImageData(new ImageData(out, m.w, m.h), 0, 0);
  }
  const shrinkTo = (src, w, hh) => { if (src.w === w && src.h === hh) return src.data; const f = CUT.resample(src.data, src.w, src.h, w, hh, 4); const d = new Uint8ClampedArray(f.length); for (let i = 0; i < f.length; i++) d[i] = Math.round(f[i]); return d; };
  async function autoMask(button, useModel) {
    if (!PS.src) return;
    const ps = PS;
    button.disabled = true;
    const label = button.textContent;
    button.textContent = useModel ? '배경 지우는 중… (처음이면 도구를 받는 중)' : '배경 지우는 중…';
    try {
      const ws = CUT.workSize(ps.src.w, ps.src.h);
      const small = { data: shrinkTo(ps.src, ws.w, ws.h), w: ws.w, h: ws.h };
      const r = await CUT.autoMask(small.data, small.w, small.h, { useModel });
      if (PS !== ps) return;
      if (ps.mask) pushUndo(ps);
      ps.mask = { data: r.mask, w: small.w, h: small.h };
      ps.maskMethod = r.method; ps.maskEdited = false; ps.maskDirty = true; ps.maskView = null; ps.maskRev = (ps.maskRev || 0) + 1;
      ps.segNote = r.error ? `자동 배경 지우기 도구를 쓰지 못해서 간단한 방법(테두리 색)으로 했어. 결과를 확인하고 칠해서 고쳐줘. (${r.error === 'model_hash' || r.error === 'wasm_hash' ? '받은 도구 파일이 달라서 안 썼어 — 다음에 다시 받아' : '이 기기·브라우저에서 안 될 수 있어'})` : '';
    } catch (e) {
      if (PS === ps) ps.segNote = '배경을 지우지 못했어: ' + ((e && e.message) || '이유 모름');
    } finally { if (button.isConnected) { button.disabled = false; button.textContent = label; } draw(); }
  }
  async function useSavedMask(button, m) {
    const ps = PS;
    const j = await run(button, () => CUT.maskFromPng(m.url));
    if (!j || PS !== ps) return;
    ps.mask = j; ps.maskSaved = m; ps.maskSavedMask = { data: Uint8ClampedArray.from(j.data), w: j.w, h: j.h }; ps.maskDirty = false; ps.maskMethod = m.method; ps.maskEdited = !!m.edited; ps.maskView = null; ps.maskRev = (ps.maskRev || 0) + 1;
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
        params: { model: ps.maskMethod === 'auto_u2netp' ? 'u2netp' : '' }, bbox: bb, coverage: CUT.maskCoverage(data) }));
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

  // ── 4. 제작 목적 ──
  function secPurpose() {
    if (!PS.product) return null;
    return step(4, '어디에 쓸 이미지야?',
      h('div', { class: 'seg wrap', role: 'group', 'aria-label': '제작 목적' }, ...Object.entries(IMG.PRODUCT_PURPOSES).map(([k, v]) =>
        h('button', { type: 'button', 'aria-pressed': String(PS.purpose === k), onclick: () => { PS.purpose = k; PS.ratio = prefRatio(k); PS.serverEst = null; draw(); } }, v.label))),
      h('p', { class: 'hint' }, IMG.PRODUCT_PURPOSES[PS.purpose].look_ko));
  }
  // ── 5. 장면·방식 ──
  function secScene() {
    if (!PS.product) return null;
    if (!PS.el.custom) {
      PS.el.custom = h('textarea', { maxlength: String(IMG.PRODUCT_CUSTOM_MAX), style: 'min-height:56px', placeholder: '예: 따뜻한 원목 탁자, 오전 햇살, 뒤에 초록 식물 (글자·가격·브랜드는 넣지 않아)' });
      PS.el.custom.addEventListener('input', () => { PS.custom = PS.el.custom.value; drawRisk(); updateCost(); });
    }
    PS.el.custom.value = PS.custom;
    PS.el.risk = h('div', { class: 'stack' });
    drawRisk();
    const T = IMG.PRODUCT_TEMPLATES;
    if (!T[PS.template].modes.includes(PS.mode)) PS.template = 'table';
    const angleSel = h('select', { value: PS.angle, 'aria-label': '상품 사진 각도' }, Object.entries(IMG.PRODUCT_ANGLES).map(([k, v]) => opt(k, v.label)));
    angleSel.addEventListener('change', () => { PS.angle = angleSel.value; if (PS.layer) PS.layer = null; PS.serverEst = null; draw(); });
    const placeSel = h('select', { value: PS.place, 'aria-label': '상품 놓을 자리' }, Object.entries(IMG.PRODUCT_PLACES).map(([k, v]) => opt(k, v.label)));
    placeSel.addEventListener('change', () => { PS.place = placeSel.value; if (PS.layer) PS.layer.x = IMG.PRODUCT_PLACES[PS.place].x; PS.serverEst = null; draw(); });
    // 만드는 중에는 방식을 못 바꿈 (AI 실사 장면 결과가 원본 보존 합성의 배경으로 섞이지 않게 — 1.5.1 검토)
    const modeCard = (k) => h('button', { type: 'button', class: 'modecard', 'aria-pressed': String(PS.mode === k), disabled: !!PS.busy && PS.mode !== k,
      onclick: () => { if (PS.busy) { toast('만드는 중에는 방식을 바꿀 수 없어. 끝난 뒤에 바꿔줘.'); return; } if (PS.mode !== k) { PS.mode = k; PS.cands = []; PS.pick = -1; PS.result = null; PS.parentId = ''; PS.serverEst = null; draw(); } } },
      h('b', null, IMG.PRODUCT_MODES[k].label), h('small', null, IMG.PRODUCT_MODES[k].hint));
    return step(5, '장면과 합성 방식',
      h('div', { class: 'modecards' }, modeCard('layer'), modeCard('reference')),
      PS.mode === 'reference' ? h('p', { class: 'notice' }, "AI가 상품까지 다시 그려서 작은 글자·로고·버튼·구성품이 원본과 달라질 수 있어. 결과는 'AI 합성 이미지'로 표시되고, 원본과 비교해서 승인해야 써.") :
        h('p', { class: 'hint' }, '상품 사진은 AI에 보내지 않아. AI는 상품이 놓일 자리를 비운 배경만 만들고, 상품은 이 기기에서 원본 그대로 얹어.'),
      h('p', { class: 'legend' }, '장면'),
      h('div', { class: 'tgrid' }, ...Object.entries(T).map(([k, v]) => h('button', { type: 'button', 'aria-pressed': String(PS.template === k), disabled: !v.modes.includes(PS.mode),
        title: v.modes.includes(PS.mode) ? '' : '원본 보존 합성에서만', onclick: () => { PS.template = k; PS.serverEst = null; draw(); } }, v.label))),
      T[PS.template].note_ko ? h('p', { class: 'hint' }, T[PS.template].note_ko) : null,
      h('div', { class: 'row' }, field('상품 사진을 찍은 각도', angleSel, '배경도 같은 각도로 만들어야 어색하지 않아.'), field('상품 놓을 자리', placeSel)),
      field('직접 적기 (선택)', PS.el.custom, '버튼으로 고른 장면에 더할 것. 실제 후기·사용 인증처럼 보이게 하는 요청은 안 돼.'),
      PS.el.risk);
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
  function secOutput() {
    if (!PS.product) return null;
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
    PS.el.cost = h('div', { class: 'costbox' });
    const out = step(6, '비율·품질·모델',
      h('p', { class: 'legend' }, '비율'),
      h('div', { class: 'seg', role: 'group', 'aria-label': '비율' }, ...ratios.map((r) => h('button', { type: 'button', 'aria-pressed': String(r === PS.ratio), onclick: () => { PS.ratio = r; PS.serverEst = null; draw(); } }, r))),
      field('모드 (모델)', modeSel), field('품질', qualSel, '높을수록 비싸고 오래 걸려. 원본 보존 합성은 배경만 만들어서 보통이면 충분해.'),
      PS.mode === 'reference' && !maxRefs ? h('p', { class: 'badbox' }, `${c.label || modelOf()}은 참고 사진을 못 받아서 AI 실사 장면을 못 만들어. 다른 모드를 골라줘.`) : null,
      PS.mode === 'reference' && maxRefs && nRefs() > maxRefs ? h('p', { class: 'badbox' }, `이 모델은 참고 사진을 ${maxRefs}장까지 받아. 추가 사진을 ${nRefs() - maxRefs}장 빼줘.`) : null,
      note ? h('p', { class: 'notice' }, note) : null,
      PS.mode === 'layer' && c.free ? h('p', { class: 'hint' }, '무료 모델은 배경 품질이 낮을 수 있지만, 상품은 원본 그대로라 글자·로고는 안 바뀌어.') : null);
    return [out, step(7, '예상 비용', PS.el.cost)];
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
  // ── 8. 후보 만들기 ──
  function secGenerate() {
    if (!PS.product) return null;
    PS.el.go = btn('만들기', 'wide', () => submit());
    PS.el.msg = h('div');
    const countSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '후보 몇 장' }, ...[1, 2, 3].map((n) =>
      h('button', { type: 'button', 'aria-pressed': String(n === PS.count), disabled: !!PS.busy && n !== PS.count, onclick: () => { if (PS.busy) return; PS.count = n; draw(); } }, n === 1 ? '1장' : `${n}장 후보`)));
    if (!PS.el.status) PS.el.status = h('div', { class: 'stack' });
    const sec = step(8, '후보 만들기', h('p', { class: 'legend' }, '몇 장 만들까'), countSeg, PS.el.msg, PS.el.go, PS.el.status,
      h('p', { class: 'hint' }, '버튼을 누를 때만 만들어. 같은 요청은 한 번만 보내고, 여러 장이면 한 장씩 차례로 만들어. 이 화면을 나가도 서버에서 계속 만들고, 만든 이미지는 보관함에 남아.'));
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
    if (PS.mode === 'layer' && !PS.mask) return "원본 보존 합성은 먼저 3번에서 상품 영역을 정해줘.";
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
      if (mode === 'layer' && (!ps.maskSaved || ps.maskDirty)) {
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

  // ── 9. 후보 고르기 · 원본과 비교 ──
  // 지금 방식으로 만든 후보만 (다른 방식의 결과가 섞이지 않게 — 1.5.1 검토)
  const candOf = (i) => { const c = i >= 0 ? PS.cands[i] : null; return c && (!c.mode || c.mode === PS.mode) ? c : null; };
  function secCandidates() {
    const vis = PS.cands.map((c, i) => [c, i]).filter(([c]) => !c.mode || c.mode === PS.mode);
    if (!PS.product || !vis.length) return null;
    if (PS.mode === 'layer') {
      return step(9, '배경 고르기 (원본과 같이 보기)',
        h('p', { class: 'hint' }, '배경마다 상품을 원본 그대로 얹어 본 모습이야. 마음에 드는 배경을 골라서 10번에서 위치·크기·그림자를 맞춰줘.'),
        h('div', { class: 'grid2' }, ...vis.map(([c, i]) => candTile(c, i))));
    }
    return step(9, '장면 고르기 · 원본과 비교',
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
      btn(PS.pick === i ? '고른 배경 ✓' : '이 배경으로 합성하기', PS.pick === i ? 'sm' : 'sm ghost', () => { PS.pick = i; if (!PS.layer) PS.layer = IMG.defaultLayer(spec()); draw(); }));
    if (fresh) previewInto(cv, c, lay, 420).catch(() => { c.cv = null; put(tile, thumb(c.image, null), btn('이 배경으로 합성하기', 'sm ghost', () => { PS.pick = i; draw(); })); });
    return tile;
  }
  async function bgOf(c) {
    if (!c.bgP) c.bgP = CUT.decodeImage(c.image.url, 2048);
    try { return await c.bgP; } catch (e) { c.bgP = null; throw e; }
  }
  // 미리보기용으로 줄인 상품·마스크 (저장할 때는 원래 크기로 다시 그림)
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

  // ── 10. 맞추기·승인·부분 수정·다시 만들기·저장 ──
  function secResult() {
    if (!PS.product) return null;
    if (PS.mode === 'layer') return secComposer();
    const img = candOf(PS.pick) ? candOf(PS.pick).image : null;
    if (!img) return null;
    if (!PS.el.edit) { PS.el.edit = h('textarea', { maxlength: '300', style: 'min-height:56px', placeholder: '예: 상품은 그대로 두고 뒤쪽 화분만 지워줘' }); PS.el.edit.addEventListener('input', () => { PS.editText = PS.el.edit.value; }); }
    PS.el.edit.value = PS.editText;
    const approved = IMG.productApproved(img);
    return step(10, '승인 · 부분 수정 · 다시 만들기',
      h('div', { class: 'cmp' }, h('figure', null, thumb(PS.product, null), h('figcaption', null, '원본 상품 사진')), h('figure', null, thumb(img, null), h('figcaption', null, 'AI 실사 장면 (AI 합성 이미지)'))),
      h('div', { class: 'chips' }, kindChip(img), h('span', { class: 'chip ' + (approved ? 'v-ok' : 'v-unk') }, approved ? '상품 검수 승인' : '상품 검수 전')),
      h('div', { class: 'go' }, btn(approved ? '상품 디테일 검수 다시 보기' : '원본과 비교해서 검수·승인', 'sm', () => checkSheet(img, { onDone: (im) => { Object.assign(img, im); draw(); } }))),
      field('부분 수정 (선택)', PS.el.edit, '바꿀 부분만 적어줘. 상품은 그대로 두라고 같이 보내고, 원본 상품 사진도 참고로 다시 보내. 고친 결과는 새 이미지로 (원래 것은 그대로).'),
      h('div', { class: 'go' }, btn('부분 수정 (예상 비용 확인 후)', 'sm ghost', () => editSheet(img)), btn('다시 만들기 (8번)', 'sm ghost', () => { PS.pick = -1; PS.result = null; draw(); })));
  }
  function secComposer() {
    const c = candOf(PS.pick);
    if (!c || !PS.mask || !PS.src) return null;
    if (!PS.layer) PS.layer = IMG.defaultLayer(spec());
    const L0 = PS.layer;
    if (!PS.el.compCv) PS.el.compCv = composeCanvas();
    const cv = PS.el.compCv;
    PS.el.warn = h('div', { class: 'stack' });
    const slider = (label, get, set, min, max, stepv, fmt) => {
      const el = h('input', { type: 'range', min: String(min), max: String(max), step: String(stepv), value: String(get()), 'aria-label': label });
      const val = h('small', { class: 'hint' }, fmt(get()));
      el.addEventListener('input', () => { set(Number(el.value)); val.textContent = fmt(Number(el.value)); recompose(); });
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
      h('label', { class: 'chk' }, one, PS.src.scaled
        ? ` 원본 크기 그대로 (늘리거나 줄이지 않음 — 이 사진은 ${PS.src.srcW}×${PS.src.srcH}로 커서 긴 변 ${Math.max(PS.src.w, PS.src.h)}px로 줄여 읽었어. 줄인 사진의 픽셀 그대로야)`
        : ' 원본 크기 그대로 (늘리거나 줄이지 않음 — 회전도 0이면 상품 칸이 원본 픽셀과 한 칸도 안 달라)'),
      L0.one ? null : slider('크기 (그림 높이 대비)', () => PS.layer.h, (v) => { PS.layer.h = v; }, 0.1, 1, 0.01, pct),
      slider('회전', () => PS.layer.rot, (v) => { PS.layer.rot = v; }, -30, 30, 0.5, (v) => `${v}°`),
    ];
    const dShadow = det('pscene-shadow', '그림자', true, 'plain'), dTone = det('pscene-tone', '밝기·색온도', false, 'plain'), dEdge = det('pscene-edge', '가장자리', false, 'plain');
    kids.push(dShadow, dTone, dEdge);
    dShadow.append(slider('진하기', () => PS.layer.shadow.o, (v) => { PS.layer.shadow.o = v; }, 0, 1, 0.01, pct), slider('퍼짐', () => PS.layer.shadow.s, (v) => { PS.layer.shadow.s = v; }, 0, 1, 0.01, pct),
      slider('빛 방향 (왼쪽 ← → 오른쪽)', () => PS.layer.shadow.dx, (v) => { PS.layer.shadow.dx = v; }, -1, 1, 0.05, signed));
    dTone.append(h('p', { class: 'hint' }, '상품 밝기·색온도를 바꾸면 그 값만큼 상품 색이 원본과 달라져 (검수에서 색 항목을 직접 확인해야 해).'),
      slider('상품 밝기', () => PS.layer.tone.b, (v) => { PS.layer.tone.b = v; }, -0.3, 0.3, 0.01, signed), slider('상품 색온도 (차갑게 ← → 따뜻하게)', () => PS.layer.tone.w, (v) => { PS.layer.tone.w = v; }, -0.3, 0.3, 0.01, signed),
      slider('배경 밝기', () => PS.layer.bg.b, (v) => { PS.layer.bg.b = v; }, -0.3, 0.3, 0.01, signed), slider('배경 색온도', () => PS.layer.bg.w, (v) => { PS.layer.bg.w = v; }, -0.3, 0.3, 0.01, signed));
    dEdge.append(slider('가장자리 부드럽게', () => PS.layer.mask.feather, (v) => { PS.layer.mask.feather = v; }, 0, 4, 1, (v) => `${v}px`),
      slider('가장자리 안쪽으로 (남은 배경 깎기)', () => PS.layer.mask.shrink, (v) => { PS.layer.mask.shrink = v; }, 0, 4, 1, (v) => `${v}px`));
    if (!PS.el.bgEdit) { PS.el.bgEdit = h('textarea', { maxlength: '300', style: 'min-height:48px', placeholder: '예: 조명을 조금 더 따뜻하게 / 탁자 색을 밝은 원목으로' }); PS.el.bgEdit.addEventListener('input', () => { PS.editText = PS.el.bgEdit.value; }); }
    PS.el.bgEdit.value = PS.editText;
    const result = PS.result && PS.result.kind === 'composite' ? PS.result : null;
    const approved = result && IMG.productApproved(result);
    kids.push(
      h('div', { class: 'go' }, btn('기본값으로', 'sm ghost', () => { PS.layer = IMG.defaultLayer(spec()); draw(); }),
        btn(result && PS.savedKey === saveKey(PS, c) ? '저장됨 ✓' : '합성 저장 (새 이미지로)', 'sm', (ev) => saveComposite(ev.currentTarget, c))),
      result ? h('div', { class: 'stack' },
        h('div', { class: 'chips' }, kindChip(result), h('span', { class: 'chip ' + (approved ? 'v-ok' : 'v-unk') }, approved ? '상품 검수 승인' : '상품 검수 전')),
        h('div', { class: 'go' }, btn(approved ? '상품 디테일 검수 다시 보기' : '원본과 비교해서 검수·승인', 'sm', () => checkSheet(result, { onDone: (im) => { Object.assign(result, im); draw(); } })))) : null,
      field('배경 고치기 (부분 수정, 선택)', PS.el.bgEdit, '배경만 고쳐. 상품 자리는 비워 둔 채로 두고, 고친 배경에 지금 위치·크기 그대로 다시 얹어 (상품은 다시 그리지 않음).'),
      h('div', { class: 'go' }, btn('배경 고치기 (예상 비용 확인 후)', 'sm ghost', () => editSheet(c.image)), btn('배경 다시 만들기 (8번)', 'sm ghost', () => { PS.pick = -1; draw(); })),
      saved ? null : h('p', { class: 'hint' }, '저장하면 새 이미지(PNG — 다시 압축하지 않음)로 보관함에 들어가. 원본 상품 사진·배경은 그대로 남아.'));
    queueMicrotask(recompose);
    return step(10, '위치·크기·그림자 맞추기 → 저장 → 승인', ...kids);
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
    const end = () => { drag = null; };
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
      const r = await previewInto(PS.el.compCv, c, PS.layer, 900);
      if (r && PS.el.warn) put(PS.el.warn, ...r.warnings.map((w) => h('p', { class: 'notice' }, CUT.COMPOSE_WARN[w] || w)), r.scale > 1.05 ? null : null);
    } catch {
      if (PS && PS.el.warn) put(PS.el.warn, h('p', { class: 'badbox' }, '배경을 불러오지 못했어. 새로고침한 뒤 다시 해줘 (주소는 1시간 동안만 열려).'));
    } finally {
      composing = false;
      if (again) { again = false; requestAnimationFrame(() => recompose()); }
    }
  }
  // 이미 저장한 것과 같은 합성인지: 위치·크기·그림자·밝기, 제작 목적·비율, 배경, 마스크가 모두 같을 때만 '저장됨'
  const saveKey = (ps, c) => JSON.stringify([ps.layer, ps.purpose, ps.ratio || prefRatio(ps.purpose), c.image.id, ps.maskRev || 0]);
  // 원래 크기로 다시 그려서 저장 (원본 상품 사진·마스크 원래 크기 — 미리보기 사본이 아님)
  async function saveComposite(button, c) {
    const ps = PS;
    if (ps.saving) return; // 두 번 눌러도 한 번만
    ps.saving = true;
    let j = null, key = '';
    try {
      // 합성에 쓰는 마스크 = 서버에 저장한 그 마스크 (저장하는 동안 칠했으면 한 번 더 저장 — 기록과 그림이 어긋나지 않게, 1.5.1 검토)
      for (let i = 0; i < 2 && (!ps.maskSaved || ps.maskDirty); i++) { const m = await saveMask(null); if (!m) return; }
      if (ps.maskDirty || !ps.maskSavedMask) { toast('영역을 고치는 중이라 저장하지 않았어. 다 칠한 뒤 다시 눌러줘.', 4000); return; }
      // 누른 때의 설정으로 저장 (저장하는 동안 바꾼 위치·비율은 다음 저장에)
      key = saveKey(ps, c);
      const snap = { layer: JSON.parse(JSON.stringify(ps.layer)), purpose: ps.purpose, ratio: IMG.ratioOf(ps.purpose, ps.ratio || prefRatio(ps.purpose)),
        mask: ps.maskSavedMask, maskId: ps.maskSaved.id, spec: spec(), parent: ps.parentId, name: ps.name, template: ps.template };
      j = await run(button, async () => {
        button.textContent = '저장하는 중…';
        const bg = await bgOf(c);
        const o = CUT.outputSize(snap.ratio, bg.w, bg.h, (IMG.PURPOSES[snap.purpose] || IMG.PURPOSES.blog_body).out);
        const r = CUT.makeComposer(ps.src, snap.mask)(bg, { ...snap.layer, ratio: snap.ratio }, o.W, o.H);
        if (r.warnings.includes('empty_mask')) throw { code: 'empty_mask' };
        const blob = await CUT.toPngBlob(r.data, o.W, o.H);
        const fd = new FormData();
        const desc = clean(`${snap.name || '상품'} · ${IMG.PRODUCT_TEMPLATES[snap.template].label}`).slice(0, 120);
        // src_scaled: 아주 큰 상품 사진을 줄여 읽었으면 '원본 크기 그대로'여도 줄인 사진의 픽셀이라 검수 칸(글자·버튼)을 미리 채우지 않음 (1.5.1 재검토)
        fd.append('meta', JSON.stringify({ product_image_id: ps.product.id, background_image_id: c.image.id, mask_id: snap.maskId, layer: { ...snap.layer, ratio: snap.ratio, src_scaled: !!(ps.src && ps.src.scaled) }, purpose: snap.purpose, ratio: snap.ratio,
          description: desc, spec: snap.spec, parent_image_id: snap.parent || undefined, post_id: ps.postId || undefined }));
        fd.append('file', blob, 'composite.png');
        return api('/images/composite', { method: 'POST', body: fd, timeout: 60000 });
      }, '합성 이미지를 새로 저장했어 (원본은 그대로)');
    } finally { ps.saving = false; }
    if (button.isConnected) button.textContent = '합성 저장 (새 이미지로)';
    if (!j || !j.image || PS !== ps) return;
    ps.result = j.image; ps.savedId = j.image.id; ps.parentId = j.image.id; ps.savedKey = key;
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

  // ── 11. 게시글 자리에 넣기 ──
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
          return h('div', { class: 'go' }, h('span', null, s.n ? `사진 ${s.n}: ${s.text}` : s.text),
            own ? h('small', { class: 'hint' }, "'직접 찍기' 자리 — 합성 이미지는 안 넣어") : btn(PS.slotKey === s.key && pid === PS.postId ? '여기에 넣기 (시작한 자리)' : '여기에 넣기', PS.slotKey === s.key ? 'sm' : 'sm ghost', async (ev) => {
              const j = await run(ev.currentTarget, () => api(`/posts/${pid}/images/link`, { method: 'POST', body: { image_id: img.id, slot_key: s.key } }), `${s.n ? '사진 ' + s.n : s.text}에 넣었어`);
              if (j) { refreshPost(pid); ui.load(); }
            }, { disabled: ready && !approved }));
        }));
    };
    postSel.addEventListener('change', drawSlots);
    drawSlots();
    return step(11, '게시글 이미지 자리에 넣기',
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
    const rows = IMG.PRODUCT_CHECKS.map(([k, label]) => {
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': label });
      const drawSeg = () => put(seg, ...Object.entries(IMG.PRODUCT_VERDICTS).map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(items[k] === v), onclick: () => { items[k] = v; drawSeg(); upd(); } }, l)));
      drawSeg();
      return h('div', { class: 'pcheck' }, h('b', null, label), pre.includes(k) ? h('small', { class: 'hint' }, '원본 픽셀 그대로라 미리 채웠어 — 그래도 확인해줘') : null, seg);
    });
    const upd = () => {
      const s = IMG.productCheckState(items);
      okB.disabled = !s.ok;
      stateLine.textContent = s.ok ? '모두 괜찮아 — 승인할 수 있어.' : `${s.missing.length ? `빈칸 ${s.missing.length}개` : ''}${s.issues.length ? ` · 문제 ${s.issues.length}개` : ''}${s.unsure.length ? ` · 모르겠음 ${s.unsure.length}개` : ''} — 모두 '괜찮아'여야 승인할 수 있어.`;
    };
    const save = async (approve) => {
      const r = await run(approve ? okB : saveB, () => api(`/images/${img.id}/product-check`, { method: 'POST', body: { items, note: note.value.trim(), approve } }), approve ? "승인했어 — '사용 가능'이 됐어" : '저장했어 (승인 안 함)');
      if (!r) return;
      if (r.demoted && r.demoted.length) toast(`승인을 풀어서 이 이미지를 쓰는 발행 준비 글 ${r.demoted.length}개를 '검수 필요'로 되돌렸어.`, 6000);
      closeSheet();
      if (o.onDone) o.onDone(r.image);
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
    openSheet('상품 디테일 검수',
      h('div', { class: 'modebadge ' + (layer ? 'm-layer' : 'm-ref') }, h('b', null, layer ? '원본 보존 합성' : 'AI 재생성 (AI 실사 장면)'),
        h('small', null, layer ? '상품 픽셀은 원본 사진 그대로야. 배경·그림자·크기·가장자리를 주로 봐.' : 'AI가 상품까지 다시 그렸어. 모양·글자·로고·버튼이 바뀌었을 수 있어.')),
      layer ? null : h('p', { class: 'badbox' }, '제품 외형·제품명·로고·인쇄 글자가 원본과 다를 수 있어. 다르면 승인하지 말고 다시 만들거나 원본 보존 합성을 써줘.'),
      h('div', { class: 'cmp' }, h('figure', null, prodImg && prodImg.url ? thumb(prodImg, null) : h('p', { class: 'hint' }, '원본 사진을 불러오지 못했어'), h('figcaption', null, '원본 상품 사진')),
        h('figure', null, thumb(img, null), h('figcaption', null, layer ? '합성 결과' : 'AI 실사 장면'))),
      t.costs ? h('p', { class: 'hint' }, [t.costs.model ? `모델 비용 ${usd(genCost(t.costs.model) ? genCost(t.costs.model).usd : 0)} (${t.costs.model.cost_status}, ${t.costs.model.model})` : '', t.costs.cutout ? `배경 지우기 ${usd(t.costs.cutout.cost_usd)} (${t.costs.cutout.cost_status} · ${t.costs.cutout.where})` : ''].filter(Boolean).join(' · ')) : null,
      ...rows, field('메모 (선택)', note), stateLine, okB, h('div', { class: 'go' }, saveB),
      aiDet,
      h('p', { class: 'hint' }, "승인하면 '사용 가능'이 되고, 승인을 풀면 '검수 전'으로 돌아가. 원본·결과 이미지는 지우거나 고치지 않아."));
  }

  return { start, view, checkSheet };
}
