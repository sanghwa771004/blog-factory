// infocards.js — 1.7.0 앱이 그리는 정보 카드·썸네일
// 원고의 표·목록·요약·숫자 확인표·용어 풀이를 블로그 전용 디자인 PNG로 그림 (남의 사진 없이, 저작권 걱정 없이, 글자 안 깨짐)
// 후보 고르기(cardCandidates·bestCandidate)는 화면 없이 계산만 → 테스트 가능. 그리기(renderInfoCard)는 캔버스
import { parseBody, PLAN_KINDS, INFO_CARD_SLOT, THUMB_SLOT } from './checks.js?v=1.8.0';
import { FONT_TITLE, FONT_BODY, fitText, wrapLines, roundRect, drawIcon, ensureFonts } from './cards.js?v=1.8.0';

export const CARD_SIZES = { thumb: [1080, 1080], card: [1200, 900] };
// 글 종류마다 색 (매일 같은 색이면 홈판에서 '채널'처럼 보임)
export const KIND_THEMES = {
  affiliate: { label: '쿠팡·토스 추천', bg: '#F3FAF6', ink: '#13261D', muted: '#4D6358', accent: '#1F7A55', soft: '#D5EEDF' },
  adpost: { label: '생활 정보', bg: '#F2F7FC', ink: '#12233A', muted: '#4B5E74', accent: '#2563A6', soft: '#D8E7F5' },
  trending: { label: '오늘의 이슈', bg: '#FFF6EF', ink: '#2A190E', muted: '#6E5444', accent: '#D45F27', soft: '#FADFCC' },
  market: { label: '오늘의 증시', bg: '#F1F3FA', ink: '#131A33', muted: '#4E5672', accent: '#2B3A8C', soft: '#D9DEF3' },
  stock: { label: '종목 정리', bg: '#F6F2FB', ink: '#20153A', muted: '#5C5072', accent: '#6A3FB5', soft: '#E5DAF6' },
  '': { label: '정보', bg: '#FBFCF9', ink: '#1B2420', muted: '#5E6B64', accent: '#1F5D4C', soft: '#DCEBE4' },
};
export const themeOf = (post) => KIND_THEMES[(post && PLAN_KINDS[post.plan_kind]) ? post.plan_kind : ''] || KIND_THEMES[''];
const strip = (s) => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/==(.+?)==/g, '$1').replace(/\[\^\d{1,2}\]/g, '').trim();
// 제목 앞의 [시리즈 이름] 은 썸네일에서 위쪽 띠로 따로 씀
export function splitSeries(title) {
  const m = String(title || '').match(/^\s*\[([^\]]{1,30})\]\s*(.+)$/);
  return m ? { series: m[1].trim(), title: m[2].trim() } : { series: '', title: String(title || '').trim() };
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
// 카드 아래 작은 글씨: 이 글의 기준(있으면) 또는 출처 사이트 이름
export function footnoteOf(post) {
  const basis = parseBody(post && post.body).find((b) => b.t === 'basis');
  if (basis) return '기준 ' + strip(basis.text).slice(0, 70);
  const hosts = [...new Set((Array.isArray(post && post.sources) ? post.sources : []).map((x) => hostOf(x && x.url)).filter(Boolean))].slice(0, 3);
  return hosts.length ? '출처 ' + hosts.join(' · ') : '';
}

// 원고에서 그릴 수 있는 카드 후보 (썸네일·표·목록·요약·핵심 숫자·용어)
export function cardCandidates(post) {
  const p = post || {};
  const out = [];
  const t0 = splitSeries(strip((p.titles || [])[0] || p.keyword || '')); // **굵게**·==강조== 표시는 빼고 그림
  out.push({ type: 'thumb', key: 'thumb', label: '썸네일 (대표 이미지 1:1)', title: t0.title, series: t0.series });
  let head = '', n = 0;
  for (const b of parseBody(p.body)) {
    n++;
    if (b.t === 'h') { head = strip(b.text); continue; }
    if (b.t === 'table' && b.rows.length >= 2) out.push({ type: 'table', key: 'table:' + n, label: `표 — ${head || '표'}`, title: head || '한눈에 보기', rows: b.rows.slice(0, 8).map((r) => r.slice(0, 4).map(strip)) });
    else if (b.t === 'ul' && b.items.length >= 3) out.push({ type: 'list', key: 'list:' + n, label: `체크리스트 — ${head || '목록'}`, title: head || '체크리스트', items: b.items.slice(0, 7).map(strip) });
    else if (b.t === 'term' && b.text) out.push({ type: 'term', key: 'term:' + n, label: `용어 — ${b.term}`, title: '용어 풀이', term: strip(b.term), text: strip(b.text) });
  }
  const sum = String(p.summary || '').split('\n').map(strip).filter(Boolean).slice(0, 3);
  if (sum.length) out.push({ type: 'summary', key: 'summary', label: '3줄 요약', title: '3줄 요약', items: sum });
  const figs = (Array.isArray(p.figures) ? p.figures : []).filter((f) => f && typeof f === 'object' && String(f.label || '').trim() && String(f.value ?? '').trim()).slice(0, 6);
  if (figs.length) out.push({ type: 'figures', key: 'figures', label: '핵심 숫자', title: '핵심 숫자', items: figs.map((f) => ({ label: strip(f.label).slice(0, 20), value: String(f.value).slice(0, 14), unit: String(f.unit || '').slice(0, 8), as_of: String(f.as_of || '').slice(0, 10) })) });
  return out;
}
// 사진 자리 설명에 가장 맞는 후보 — "(썸네일)" 자리는 썸네일, "(정보 카드) 지수 표" 는 낱말이 가장 많이 겹치는 카드
export function bestCandidate(cands, slotText) {
  const list = cands || [];
  const t = String(slotText || '');
  if (THUMB_SLOT.test(t) || !t) return list.find((c) => c.type === 'thumb') || list[0] || null;
  const words = t.replace(INFO_CARD_SLOT, '').split(/[\s·,/]+/).filter((w) => w.length >= 2);
  let best = null, bestScore = -1;
  for (const c of list) {
    if (c.type === 'thumb') continue;
    const hay = [c.label, c.title, ...(c.items || []).map((x) => (typeof x === 'string' ? x : x.label)), ...((c.rows || [])[0] || [])].join(' ');
    let sc = words.filter((w) => hay.includes(w)).length;
    if (/표/.test(t) && c.type === 'table') sc += 2;
    if (/(체크|목록|순서|단계)/.test(t) && c.type === 'list') sc += 2;
    if (/요약/.test(t) && c.type === 'summary') sc += 2;
    if (/(숫자|지수|실적|수치)/.test(t) && c.type === 'figures') sc += 2;
    if (/용어/.test(t) && c.type === 'term') sc += 2;
    if (sc > bestScore) { best = c; bestScore = sc; }
  }
  return best || list[0] || null;
}

// ───────── 그리기 ─────────
function base(ctx, W, H, T) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = T.soft; ctx.beginPath(); ctx.arc(W - 30, 40, W * 0.22, 0, Math.PI * 2); ctx.fill();
}
function pillAt(ctx, text, x, y, T, size = 30) {
  ctx.font = FONT_BODY(size, 700);
  const w = ctx.measureText(text).width + size * 1.3;
  ctx.fillStyle = T.accent; roundRect(ctx, x, y, w, size * 1.8, size * 0.9); ctx.fill();
  ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + size * 0.65, y + size * 0.92); ctx.textBaseline = 'alphabetic';
  return w;
}
function footer(ctx, W, H, T, P, left, right) {
  ctx.fillStyle = T.accent; ctx.fillRect(P, H - P - 46, 64, 6);
  ctx.font = FONT_BODY(24, 500); ctx.fillStyle = T.muted;
  if (left) { const l = wrapLines(ctx, left, W - P * 2 - 260)[0] || ''; ctx.fillText(l, P, H - P); }
  if (right) { ctx.textAlign = 'right'; ctx.fillText(right, W - P, H - P); ctx.textAlign = 'left'; }
}
function drawLinesAt(ctx, fit, x, y, lh, color) {
  let yy = y;
  ctx.fillStyle = color;
  for (const line of fit.lines) { yy += fit.size; ctx.fillText(line, x, yy); yy += fit.size * (lh - 1); }
  return yy;
}
// 1.8.0: 홈판 카드는 휴대폰에서 1:1, 컴퓨터에서 3:2 로 잘려 보임 → 글자·띠는 가운데 띠(위아래 17% 안쪽) 안에 (2026-11-06 조사)
export const THUMB_SAFE = { top: 0.18, bottom: 0.82 };
const hashOf = (s) => { let x = 0; for (const ch of String(s || '')) x = (x * 31 + ch.codePointAt(0)) >>> 0; return x; };
// 1.8.0 사진 썸네일: 사진을 꽉 채우고(초점 자리 기준으로 자름) 어둡게 덮은 뒤, 짧은 문구를 흰 글씨로 크게 (사용자가 직접 만들던 모양)
function drawPhotoThumb(ctx, W, H, T, c, o) {
  const P = 84, img = o.photo;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.max(W / iw, H / ih), dw = iw * s, dh = ih * s;
  const fx = o.focus && Number.isFinite(o.focus.x) ? o.focus.x : 0.5, fy = o.focus && Number.isFinite(o.focus.y) ? o.focus.y : 0.5;
  ctx.drawImage(img, (W - dw) * fx, (H - dh) * fy, dw, dh);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, H * THUMB_SAFE.top - 40, 0, H * 0.66);
  g.addColorStop(0, 'rgba(0,0,0,0.58)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.66);
  const top = Math.round(H * THUMB_SAFE.top);
  if (c.series || o.pill) pillAt(ctx, (c.series || T.label).slice(0, 18), P, top, T, 32);
  const fit = fitText(ctx, c.title || '', { font: FONT_TITLE, maxW: W - P * 2, maxH: H * 0.4, maxSize: 128, minSize: 64, lineHeight: 1.14 });
  ctx.font = FONT_TITLE(fit.size);
  ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  let y = top + (c.series || o.pill ? 84 : 10);
  for (const line of fit.lines) {
    y += fit.size;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 22;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = Math.max(6, fit.size * 0.11); ctx.strokeText(line, W / 2, y);
    ctx.restore();
    ctx.fillStyle = '#FFFFFF'; ctx.fillText(line, W / 2, y);
    y += fit.size * 0.14;
  }
  ctx.textAlign = 'left';
  if (o.brand) { ctx.font = FONT_BODY(30, 600); ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillText(o.brand.slice(0, 24), P, Math.round(H * THUMB_SAFE.bottom)); }
  return fit.overflow;
}
// 1.8.0 C 사진만: 글자·덮개 없이 사진만 꽉 채움 (초점 자리 기준으로 1:1로 자름) — 홈판 썸네일 A/B/C 시험의 C
function drawPhotoOnly(ctx, W, H, o) {
  const img = o.photo;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.max(W / iw, H / ih), dw = iw * s, dh = ih * s;
  const fx = o.focus && Number.isFinite(o.focus.x) ? o.focus.x : 0.5, fy = o.focus && Number.isFinite(o.focus.y) ? o.focus.y : 0.5;
  ctx.drawImage(img, (W - dw) * fx, (H - dh) * fy, dw, dh);
  return false;
}
function drawThumb(ctx, W, H, T, c, o) {
  if (o.photo && o.plain) return drawPhotoOnly(ctx, W, H, o);
  if (o.photo) return drawPhotoThumb(ctx, W, H, T, c, o);
  const P = 84;
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  // 1.8.0: 같은 색·같은 모양만 매일 반복하지 않게 둥근 장식 자리를 글마다 바꿈 (색은 그대로 — 채널처럼 보이게)
  const v = hashOf(c.title) % 3;
  const [cx, cy] = [[W - 60, 150], [60, H - 150], [W - 40, H - 120]][v];
  ctx.fillStyle = T.soft; ctx.beginPath(); ctx.arc(cx, cy, W * 0.34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = T.accent; ctx.fillRect(0, H - 28, W, 28);
  pillAt(ctx, (c.series || T.label).slice(0, 18), P, Math.round(H * THUMB_SAFE.top), T, 34);
  const fit = fitText(ctx, c.title || '', { font: FONT_TITLE, maxW: W - P * 2, maxH: H * 0.44, maxSize: 112, minSize: 62, lineHeight: 1.18 });
  const th = fit.lines.length * fit.size * 1.18;
  ctx.font = FONT_TITLE(fit.size);
  const y0 = Math.max(Math.round(H * THUMB_SAFE.top) + 100, Math.round((H - th) / 2 + 10));
  // 첫 줄 아래 형광펜
  let yy = y0;
  fit.lines.forEach((line, i) => {
    yy += fit.size;
    if (i === fit.lines.length - 1) { const w = ctx.measureText(line).width; ctx.fillStyle = T.soft; ctx.fillRect(P - 6, yy - fit.size * 0.36, w + 12, fit.size * 0.42); }
    ctx.fillStyle = T.ink; ctx.fillText(line, P, yy);
    yy += fit.size * 0.18;
  });
  if (o.brand) { ctx.font = FONT_BODY(30, 500); ctx.fillStyle = T.muted; ctx.fillText(o.brand.slice(0, 24), P, Math.round(H * THUMB_SAFE.bottom) - 6); }
  return fit.overflow;
}
function drawTitleTop(ctx, W, T, P, title, maxSize = 64) {
  const fit = fitText(ctx, title || '', { font: FONT_TITLE, maxW: W - P * 2, maxH: 150, maxSize, minSize: 40, lineHeight: 1.15 });
  ctx.font = FONT_TITLE(fit.size);
  const y = drawLinesAt(ctx, fit, P, P + 40, 1.15, T.ink);
  ctx.fillStyle = T.accent; ctx.fillRect(P, P + 10, 90, 10);
  return { y: y + 34, overflow: fit.overflow };
}
function drawTable(ctx, W, H, T, c) {
  const P = 72;
  base(ctx, W, H, T);
  const top = drawTitleTop(ctx, W, T, P, c.title);
  const rows = c.rows || [];
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const availH = H - top.y - P - 70;
  const rh = Math.min(92, Math.floor(availH / rows.length));
  const cw = (W - P * 2) / cols;
  let overflow = top.overflow;
  rows.forEach((r, ri) => {
    const y = top.y + ri * rh;
    ctx.fillStyle = ri === 0 ? T.accent : ri % 2 ? '#FFFFFF' : T.soft;
    roundRect(ctx, P, y, W - P * 2, rh - 6, 12); ctx.fill();
    for (let ci = 0; ci < cols; ci++) {
      const txt = r[ci] || '';
      const fit = fitText(ctx, txt, { font: (px) => FONT_BODY(px, ri === 0 || ci === 0 ? 700 : 500), maxW: cw - 32, maxH: rh - 18, maxSize: 34, minSize: 20, lineHeight: 1.2 });
      overflow = overflow || fit.overflow;
      ctx.font = FONT_BODY(fit.size, ri === 0 || ci === 0 ? 700 : 500);
      const th = fit.lines.length * fit.size * 1.2;
      drawLinesAt(ctx, fit, P + ci * cw + 16, y + (rh - 6 - th) / 2 - fit.size * 0.12, 1.2, ri === 0 ? '#FFFFFF' : T.ink);
    }
  });
  return overflow;
}
function drawList(ctx, W, H, T, c, numbered) {
  const P = 72;
  base(ctx, W, H, T);
  const top = drawTitleTop(ctx, W, T, P, c.title);
  const items = c.items || [];
  const availH = H - top.y - P - 70;
  const each = Math.floor(availH / Math.max(items.length, 1));
  let overflow = top.overflow;
  items.forEach((it, i) => {
    const y = top.y + i * each;
    ctx.fillStyle = T.soft; roundRect(ctx, P, y + 4, 58, 58, 16); ctx.fill();
    if (numbered) { ctx.font = FONT_TITLE(38); ctx.fillStyle = T.accent; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), P + 29, y + 48); ctx.textAlign = 'left'; } else drawIcon(ctx, 'check', P + 9, y + 13, 40, T.accent);
    const fit = fitText(ctx, it, { font: (px) => FONT_BODY(px, 500), maxW: W - P * 2 - 90, maxH: each - 14, maxSize: 40, minSize: 24, lineHeight: 1.35 });
    overflow = overflow || fit.overflow;
    ctx.font = FONT_BODY(fit.size, 500);
    drawLinesAt(ctx, fit, P + 84, y + 4, 1.35, T.ink);
  });
  return overflow;
}
function drawFigures(ctx, W, H, T, c) {
  const P = 72;
  base(ctx, W, H, T);
  const top = drawTitleTop(ctx, W, T, P, c.title);
  const items = c.items || [];
  const cols = items.length <= 2 ? items.length || 1 : items.length === 4 ? 2 : 3;
  const rowsN = Math.ceil(items.length / cols) || 1;
  const gw = (W - P * 2 - (cols - 1) * 24) / cols, gh = Math.min(260, (H - top.y - P - 80 - (rowsN - 1) * 24) / rowsN);
  let overflow = top.overflow;
  items.forEach((f, i) => {
    const x = P + (i % cols) * (gw + 24), y = top.y + Math.floor(i / cols) * (gh + 24);
    ctx.fillStyle = '#FFFFFF'; roundRect(ctx, x, y, gw, gh, 22); ctx.fill();
    ctx.strokeStyle = T.soft; ctx.lineWidth = 4; roundRect(ctx, x, y, gw, gh, 22); ctx.stroke();
    ctx.font = FONT_BODY(28, 700); ctx.fillStyle = T.muted; ctx.fillText(wrapLines(ctx, f.label, gw - 40)[0] || '', x + 22, y + 52);
    const v = fitText(ctx, f.value + (f.unit ? ' ' + f.unit : ''), { font: FONT_TITLE, maxW: gw - 44, maxH: gh * 0.42, maxSize: 76, minSize: 36, lineHeight: 1.1 });
    overflow = overflow || v.overflow;
    ctx.font = FONT_TITLE(v.size); drawLinesAt(ctx, v, x + 22, y + 70, 1.1, T.accent);
    if (f.as_of) { ctx.font = FONT_BODY(22, 500); ctx.fillStyle = T.muted; ctx.fillText(f.as_of + ' 기준', x + 22, y + gh - 22); }
  });
  return overflow;
}
function drawTerm(ctx, W, H, T, c) {
  const P = 84;
  base(ctx, W, H, T);
  pillAt(ctx, '용어 풀이', P, P, T, 30);
  const tf = fitText(ctx, c.term || '', { font: FONT_TITLE, maxW: W - P * 2, maxH: 220, maxSize: 110, minSize: 56, lineHeight: 1.1 });
  ctx.font = FONT_TITLE(tf.size);
  const y = drawLinesAt(ctx, tf, P, P + 120, 1.1, T.accent);
  const bf = fitText(ctx, c.text || '', { font: (px) => FONT_BODY(px, 500), maxW: W - P * 2, maxH: H - y - P - 100, maxSize: 46, minSize: 28, lineHeight: 1.5 });
  ctx.font = FONT_BODY(bf.size, 500);
  drawLinesAt(ctx, bf, P, y + 40, 1.5, T.ink);
  return tf.overflow || bf.overflow;
}
// 한 장 그리기 → { overflow } (글자가 넘쳐 잘렸으면 true — 화면에서 알려줌)
export function renderInfoCard(canvas, cand, opt = {}) {
  const [W, H] = cand && cand.type === 'thumb' ? CARD_SIZES.thumb : CARD_SIZES.card;
  const scale = opt.scale || 1;
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const T = opt.theme || KIND_THEMES[''];
  let overflow = false;
  if (!cand) { ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H); return { overflow }; }
  if (cand.type === 'thumb') overflow = drawThumb(ctx, W, H, T, cand, opt);
  else if (cand.type === 'table') overflow = drawTable(ctx, W, H, T, cand);
  else if (cand.type === 'list') overflow = drawList(ctx, W, H, T, cand, false);
  else if (cand.type === 'summary') overflow = drawList(ctx, W, H, T, cand, true);
  else if (cand.type === 'figures') overflow = drawFigures(ctx, W, H, T, cand);
  else if (cand.type === 'term') overflow = drawTerm(ctx, W, H, T, cand);
  if (cand.type !== 'thumb') footer(ctx, W, H, T, 72, opt.foot || '', opt.brand || '');
  return { overflow: !!overflow };
}
export const fontsFor = (cand) => ensureFonts([cand && cand.title, cand && cand.series, cand && cand.term, cand && cand.text, ...((cand && cand.items) || []).map((x) => (typeof x === 'string' ? x : `${x.label}${x.value}${x.unit}`)), ...((cand && cand.rows) || []).flat(), '기준 출처 용어 풀이 핵심 숫자'].filter(Boolean).join(''));
