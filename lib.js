// lib.js — 앱에서 쓰는 계산 도구 (화면 코드 없음, 테스트 가능)
import { parseBody, disclosureFor, SCORE_FACTORS, countMe, focusFit, SEO_RULES } from './checks.js?v=1.4.0';

// ───────── 날짜·숫자 ─────────
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const todayStr = () => ymd(new Date());
export function fmtDate(s) {
  if (!s) return '날짜 미정';
  const d = parseYmd(s);
  if (isNaN(d)) return '날짜 미정';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
}
export function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const h = d.getHours();
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${pad(d.getMinutes())}`;
}
export const daysSince = (s, today) => Math.round((Date.parse(today || todayStr()) - Date.parse(String(s).slice(0, 10))) / 86400000);
export function monthRange(offset = 0, today = todayStr()) {
  const d = parseYmd(today);
  const first = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
  return { from: ymd(first), to: ymd(last) };
}
export const fmtNum = (n) => (n == null || Number.isNaN(n) ? '' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
export const won = (n) => (n == null ? '' : `${Number(n) < 0 ? '−' : ''}${Math.abs(Math.round(Number(n))).toLocaleString('ko-KR')}원`);
export const pct = (r) => (r == null ? '' : `${(r * 100).toFixed(r < 0.1 ? 2 : 1)}%`);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeUrl = (u) => { u = String(u || '').trim(); return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; };
// 미리보기에 띄울 이미지 주소: https(서명 주소)·blob(이 기기에서 만든 것)·같은 곳(테스트)만
// (//·/\ 로 시작하는 다른 곳 주소는 막음 — 브라우저는 /\ 도 // 처럼 읽음, http://127.0.0.1 은 이 기기에서 시험할 때만)
const LOCAL_TEST = typeof location !== 'undefined' && location.hostname === '127.0.0.1';
export const safeImgUrl = (u) => {
  u = String(u || '');
  if (/^(https:\/\/|blob:|\/(?![/\\]))[^\s"'<>\\]*$/i.test(u)) return u;
  return LOCAL_TEST && /^http:\/\/127\.0\.0\.1[:/][^\s"'<>]*$/i.test(u) ? u : '';
};

// ───────── ZIP 만들기 (압축 없이 묶기만 — 사진은 이미 압축돼 있음) ─────────
// files: [{ name, bytes: Uint8Array }] → ZIP 파일 바이트. 한글 파일 이름은 UTF-8 표시(0x0800)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
// 같은 이름이 있으면 -2, -3… (이미 그런 이름이 있으면 그다음 번호) — ZIP 안에서 파일이 겹치지 않게
export function uniqueNames(names) {
  const used = new Set();
  return names.map((n) => {
    let out = n, c = 1;
    while (used.has(out.toLowerCase())) { c++; out = n.replace(/(\.[a-z0-9]+)?$/i, (ext) => `-${c}${ext}`); }
    used.add(out.toLowerCase());
    return out;
  });
}
export function makeZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const day = ((Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const names = uniqueNames(files.map((f) => String(f.name || 'file').replace(/[\\/:*?"<>|]+/g, '-')));
  const parts = [], central = [];
  let offset = 0;
  files.forEach((f, i) => {
    const name = enc.encode(names[i]);
    const data = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + name.length), v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint16(10, time, true); v.setUint16(12, day, true); v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true); v.setUint16(28, 0, true); lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), w = new DataView(ch.buffer);
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, 0x0800, true); w.setUint16(10, 0, true);
    w.setUint16(12, time, true); w.setUint16(14, day, true); w.setUint32(16, crc, true); w.setUint32(20, data.length, true); w.setUint32(24, data.length, true);
    w.setUint16(28, name.length, true); w.setUint32(42, offset, true); ch.set(name, 46);
    parts.push(lh, data); central.push(ch);
    offset += lh.length + data.length;
  });
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of all) { out.set(x, o); o += x.length; }
  return out;
}

// ───────── 원고 내보내기 ─────────
const stripMd = (s) => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1');
function inlineHtml(s, mode) {
  const h = esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return h.replace(/\[(내 경험[^\]]*)\]/g, mode === 'export' ? '<span style="background:#fff1a8;">[$1]</span>' : '<span class="me">[$1]</span>');
}
export const sortedLinks = (links) => [...(links || [])].sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
// 본문의 n번째 [링크] 자리에 들어갈 링크 (링크가 모자라면 마지막 링크)
export function linkForSlot(links, i) {
  const ls = sortedLinks(links).filter((l) => l.status !== '오류' && safeUrl(l.url));
  if (!ls.length) return null;
  return ls[Math.min(i, ls.length - 1)];
}

// imgs: 사진 자리 순서(줄 전체가 [이미지: …] 인 자리)대로 연결된 이미지 [{ url, alt, label, caption, fileName }] (없으면 null)
const imgLabel = (n, b) => `사진 ${n}${b.text ? ' · ' + b.text : ''}`;
export function viewHtml(post, links, imgs) {
  let slot = 0, pic = 0;
  return parseBody(post.body).map((b) => {
    if (b.t === 'h') return `<h2>${inlineHtml(b.text, 'view')}</h2>`;
    if (b.t === 'p') return `<p>${inlineHtml(b.text, 'view')}</p>`;
    if (b.t === 'ul') return `<ul>${b.items.map((i) => `<li>${inlineHtml(i, 'view')}</li>`).join('')}</ul>`;
    if (b.t === 'table') return `<div class="tblwrap"><table>${b.rows.map((r, ri) => `<tr>${r.map((c) => (ri ? `<td>${inlineHtml(c, 'view')}</td>` : `<th>${inlineHtml(c, 'view')}</th>`)).join('')}</tr>`).join('')}</table></div>`;
    if (b.t === 'img') {
      if (!b.full) return `<div class="img">📷 ${esc(b.text)}</div>`;
      const n = ++pic, im = imgs && imgs[n - 1];
      if (im && safeImgUrl(im.url)) return `<figure class="img has"><img src="${esc(im.url)}" alt="${esc(im.alt || b.text)}" loading="lazy" decoding="async"><figcaption>${esc(imgLabel(n, b))}${im.label ? ' · ' + esc(im.label) : ''}</figcaption></figure>`;
      return `<div class="img">📷 ${esc(imgLabel(n, b))}${im ? ' · 이미지 연결됨' : ''}</div>`;
    }
    if (b.t === 'cta') {
      const l = linkForSlot(links, slot++);
      return `<div class="cta"><span>🔗 ${esc(b.text || (l && l.cta) || '최저가 확인하기')}</span><small>${l ? esc(l.url) : '제휴 링크를 넣으면 여기에 걸려'}</small></div>`;
    }
    return '';
  }).join('');
}

export function exportHtml(post, { links, programs, images } = {}) {
  const disc = disclosureFor(post.program_ids, programs).text;
  const out = [];
  const S = {
    p: 'line-height:1.8;margin:0 0 1em;',
    h: 'font-size:1.3em;font-weight:bold;line-height:1.4;margin:1.6em 0 .6em;',
    th: 'border:1px solid #d9d9d9;padding:8px 10px;text-align:left;background:#f4f6f4;font-weight:bold;',
    td: 'border:1px solid #d9d9d9;padding:8px 10px;text-align:left;',
  };
  if (disc) out.push(`<p style="font-size:.9em;color:#555;background:#f4f4f4;padding:10px 12px;border-radius:6px;margin:0 0 1.4em;">${esc(disc).replace(/\n/g, '<br>')}</p>`);
  let slot = 0, pic = 0;
  for (const b of parseBody(post.body)) {
    if (b.t === 'h') out.push(`<h2 style="${S.h}">${inlineHtml(b.text, 'export')}</h2>`);
    else if (b.t === 'p') out.push(`<p style="${S.p}">${inlineHtml(b.text, 'export')}</p>`);
    else if (b.t === 'ul') out.push(`<ul style="margin:0 0 1em;padding-left:1.4em;line-height:1.8;">${b.items.map((i) => `<li>${inlineHtml(i, 'export')}</li>`).join('')}</ul>`);
    else if (b.t === 'table') out.push(`<table style="border-collapse:collapse;width:100%;margin:0 0 1.2em;font-size:.95em;">${b.rows.map((r, ri) => `<tr>${r.map((c) => `<${ri ? 'td' : 'th'} style="${ri ? S.td : S.th}">${inlineHtml(c, 'export')}</${ri ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`);
    else if (b.t === 'img') {
      const im = b.full ? images && images[pic] : null;
      const n = b.full ? ++pic : 0;
      if (im && im.fileName) {
        // 앱이 블로그에 사진을 대신 올리지 않음 → 내려받은 파일 이름을 적어 두고, 붙여넣은 뒤 그 자리에 직접 넣음
        out.push(`<p style="text-align:center;color:#888;border:1px dashed #c8c8c8;padding:18px;margin:0 0 1em;">📷 사진 ${n}: 내려받은 「${esc(im.fileName)}」 파일을 여기에 넣어줘<br><small>${esc(b.text)}</small></p>`);
        if (im.caption) out.push(`<p style="text-align:center;color:#777;font-size:.85em;margin:-.6em 0 1.2em;">${esc(im.caption)}</p>`);
      } else out.push(`<p style="text-align:center;color:#888;border:1px dashed #c8c8c8;padding:18px;margin:0 0 1em;">📷 ${n ? '사진 ' + n + ': ' : ''}${esc(b.text)} (여기에 사진 넣기)</p>`);
    }
    else if (b.t === 'cta') {
      const l = linkForSlot(links, slot++);
      const label = b.text || (l && l.cta) || '최저가 확인하기';
      out.push(l
        ? `<p style="text-align:center;margin:1.4em 0;"><a href="${esc(l.url)}" target="_blank" rel="noopener nofollow sponsored" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#1F5D4C;color:#ffffff;font-weight:bold;text-decoration:none;">${esc(label)}</a></p>`
        : `<p style="text-align:center;margin:1.4em 0;">🔗 ${esc(label)} (여기에 제휴 링크 넣기)</p>`);
    }
  }
  return out.join('\n');
}

export function exportPlain(post, { links, programs, images } = {}) {
  const disc = disclosureFor(post.program_ids, programs).text;
  const lines = [];
  if (disc) lines.push(disc, '');
  let slot = 0, pic = 0;
  for (const b of parseBody(post.body)) {
    if (b.t === 'h') lines.push('', '■ ' + stripMd(b.text));
    else if (b.t === 'p') lines.push(stripMd(b.text));
    else if (b.t === 'ul') b.items.forEach((i) => lines.push('· ' + stripMd(i)));
    else if (b.t === 'table') b.rows.forEach((r) => lines.push(r.map(stripMd).join(' | ')));
    else if (b.t === 'img') {
      const im = b.full ? images && images[pic] : null;
      const n = b.full ? ++pic : 0;
      if (im && im.fileName) { lines.push(`(사진 ${n}: ${im.fileName} — ${b.text})`); if (im.caption) lines.push(im.caption); } else lines.push('(사진' + (n ? ' ' + n : '') + ': ' + b.text + ')');
    }
    else if (b.t === 'cta') {
      const l = linkForSlot(links, slot++);
      lines.push('👉 ' + (b.text || (l && l.cta) || '최저가 확인하기') + (l ? '\n' + l.url : ''));
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// SNS(쓰레드·인스타·카드뉴스·숏폼)용 고지: 제휴·협찬·CPA 글이면 수익 모델의 공식 고지문을 맨 앞에 (없으면 기본 문구)
// '#광고'나 '제휴'만 쓰는 건 부족하다는 게 토스 고지 가이드, 첫 부분에 쓰라는 게 공정위 지침
export const SNS_FALLBACK_DISCLOSURE = '#광고 이 글의 링크로 구매하면 수수료를 받아요';
export function snsDisclosure(post, programs) {
  const affiliate = (post.program_ids || []).some((id) => programs && programs[id] && ['affiliate', 'sponsor', 'cpa'].includes(programs[id].kind));
  if (!affiliate) return '';
  return disclosureFor(post.program_ids, programs).text || SNS_FALLBACK_DISCLOSURE;
}
export function withSnsDisclosure(text, post, programs) {
  const t = String(text || '').trim();
  const d = snsDisclosure(post, programs);
  if (!d) return t;
  if (!t) return d;
  if (t.startsWith(d)) return t;
  // 글 중간·끝에 있던 고지문은 빼고 맨 앞으로 (끝에 두면 글자 수 자를 때 잘려 나감)
  let rest = t;
  for (const line of d.split('\n')) if (line.trim()) rest = rest.split(line).join('');
  rest = rest.replace(/\n{3,}/g, '\n\n').trim();
  return rest ? d + '\n\n' + rest : d;
}

// 쓰레드: 블로그 주소가 있으면 블로그로, 없으면 첫 제휴 링크. 제휴 글이면 고지문을 맨 앞에
export function threadsShare(post, { links, programs } = {}) {
  let text = String((post.variants && typeof post.variants.threads === 'string' && post.variants.threads) || post.threads || '').trim();
  let url = safeUrl(post.blog_url);
  let hint = '블로그 글 링크가 같이 붙어.';
  if (!url) {
    const l = linkForSlot(links, 0);
    if (l) { url = l.url; hint = '블로그 주소가 없어서 제휴 링크를 붙였어.'; }
    else hint = "블로그에 올린 뒤 '게시 주소'를 넣으면 링크도 같이 붙어.";
  }
  const before = text;
  text = withSnsDisclosure(text, post, programs);
  if (text !== before) hint += ' 맨 앞에 고지문을 넣었어.';
  if (text.length > 480) text = text.slice(0, 477) + '…';
  return { url: 'https://www.threads.com/intent/post?text=' + encodeURIComponent(text) + (url ? '&url=' + encodeURIComponent(url) : ''), text, hint };
}

export function instagramText(post, { programs } = {}) {
  const cap = withSnsDisclosure(String((post.variants && typeof post.variants.instagram === 'string' && post.variants.instagram) || post.instagram || '').trim(), post, programs);
  const tags = (post.hashtags || []).map((h) => '#' + h).join(' ');
  return cap + (tags ? '\n\n' + tags : '');
}

export const fillMe = (body, answers) => {
  let i = 0;
  return String(body || '').replace(/\[내 경험[^\]]*\]/g, (m) => { const a = String(answers[i++] || '').trim(); return a || m; });
};
export const meHints = (body) => (String(body || '').match(/\[내 경험[^\]]*\]/g) || []).map((m) => m.replace(/^\[내 경험:?\s*|\]$/g, ''));

// ───────── CSV·엑셀 ─────────
export function decodeBytes(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); }
  catch { return new TextDecoder('euc-kr').decode(bytes); }
}

export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': (firstLine.match(/,/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length, ';': (firstLine.match(/;/g) || []).length };
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

export const METRIC_FIELDS = {
  date: '날짜 (하루치)',
  period_start: '기간 시작일',
  period_end: '기간 종료일',
  post_match: '글 (게시 주소 또는 제목)',
  views: '조회수',
  impressions: '노출 수',
  clicks: '클릭 수',
  orders: '구매(인정) 건수',
  cancels: '취소·미인정 건수',
  revenue_est: '발생 수익',
  revenue_confirmed: '확정 수익',
  revenue_paid: '지급액',
  cost: '비용',
};
export const NUM_FIELDS = ['views', 'impressions', 'clicks', 'orders', 'cancels', 'revenue_est', 'revenue_confirmed', 'revenue_paid', 'cost'];
export const COUNT_FIELDS = ['views', 'impressions', 'clicks', 'orders', 'cancels'];

export function guessMapping(headers) {
  const m = {};
  const used = new Set();
  const rules = [
    ['period_start', /(시작|start|from)/i],
    ['period_end', /(종료|끝|end\b|to\b)/i],
    ['date', /(날짜|일자|일시|^기간$|date|day)/i],
    ['revenue_confirmed', /확정/],
    ['revenue_paid', /(지급|정산|payout|paid)/i],
    ['cancels', /(취소|반품|미인정|cancel)/i],
    ['revenue_est', /(수익|수수료|커미션|commission|revenue|earning|적립|예상)/i],
    ['cost', /(비용|광고비|cost|spend)/i],
    ['orders', /(주문|구매|판매|전환|order|purchase|conversion)/i],
    ['clicks', /(클릭|click)/i],
    ['impressions', /(노출|impression)/i],
    ['views', /(조회|방문|view|pv\b|uv\b)/i],
    ['post_match', /(url|주소|링크|게시물|포스트|제목|title|글)/i],
  ];
  for (const [field, re] of rules) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(String(h || '')) && !(field === 'orders' && /(금액|액|수익)/.test(h)) && !(field === 'cancels' && /(금액|액)/.test(h)));
    if (i >= 0) { m[field] = i; used.add(i); }
  }
  if (m.date != null && (m.period_start != null || m.period_end != null)) delete m.date;
  return m;
}

export function parseNum(v) {
  if (v == null) return { ok: true, value: null };
  let s = String(v).trim();
  if (s === '' || s === '-' || s === '—') return { ok: true, value: null };
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[,\s원₩%건회]/g, '');
  if (s.startsWith('−') || s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, value: null };
  const n = Number(s) * (neg ? -1 : 1);
  return { ok: true, value: n };
}

export function parseDateCell(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) { // 엑셀 날짜 숫자
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  let m = s.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
const validDate = (s) => !!s && !isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}$/.test(s);

// rows: 머리줄을 뺀 데이터 행들. 결과의 ok 행은 서버로 보낼 모양
export function normalizeRows(rows, mapping, opts = {}) {
  const ok = [], errors = [], unmatched = [];
  const seen = new Set();
  let dupInFile = 0;
  rows.forEach((r, idx) => {
    const line = idx + (opts.firstLine || 2);
    const get = (f) => (mapping[f] == null ? undefined : r[mapping[f]]);
    let start = null, end = null;
    if (mapping.date != null) start = end = parseDateCell(get('date'));
    else { start = parseDateCell(get('period_start')); end = parseDateCell(get('period_end')) || start; }
    if (!start && opts.defaultDate) start = end = opts.defaultDate;
    if (!validDate(start) || !validDate(end)) { errors.push({ line, msg: '날짜를 읽을 수 없어' }); return; }
    if (end < start) { errors.push({ line, msg: '종료일이 시작일보다 빨라' }); return; }
    const out = { period_start: start, period_end: end };
    let bad = false, any = false;
    for (const f of NUM_FIELDS) {
      if (mapping[f] == null) { out[f] = null; continue; }
      const p = parseNum(get(f));
      if (!p.ok) { errors.push({ line, msg: `${METRIC_FIELDS[f]} 값이 숫자가 아니야: ${String(get(f)).slice(0, 20)}` }); bad = true; break; }
      if (p.value != null && COUNT_FIELDS.includes(f) && (p.value < 0 || !Number.isInteger(p.value))) { errors.push({ line, msg: `${METRIC_FIELDS[f]}는 0 이상의 정수여야 해` }); bad = true; break; }
      if (p.value != null && f === 'cost' && p.value < 0) { errors.push({ line, msg: '비용은 음수일 수 없어' }); bad = true; break; }
      out[f] = p.value;
      if (p.value != null) any = true;
    }
    if (bad) return;
    if (!any) { errors.push({ line, msg: '숫자 칸이 모두 비어 있어' }); return; }
    let postId = opts.postId || null;
    const matchText = mapping.post_match != null ? String(get('post_match') || '').trim() : '';
    if (!postId && matchText && opts.resolvePost) postId = opts.resolvePost(matchText);
    if (!postId && matchText) unmatched.push(line);
    out.post_id = postId;
    out.match_text = matchText.slice(0, 300);
    // 파일 안 중복 = 모든 칸이 똑같은 줄 (붙여넣다 두 번 들어간 줄). 상품명·주문번호처럼 안 고른 칸이 하나라도 다르면
    // 다른 주문이라서 빼지 않아 — 같은 글·같은 날짜 줄은 서버가 더해서 한 줄로 저장해.
    const cells = (Array.isArray(r) ? r : []).map((c) => String(c == null ? '' : c).trim());
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    const key = JSON.stringify([opts.source_label || '', opts.program_id || '', opts.channel_id || '', postId || '', cells]);
    if (seen.has(key)) { dupInFile++; return; }
    seen.add(key);
    ok.push(out);
  });
  return { ok, errors, dupInFile, unmatched };
}

// ───────── 엑셀(.xlsx) 읽기 — 외부 라이브러리 없이 (zip 풀기 + XML 읽기) ─────────
export const isZip = (bytes) => bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export function unzip(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (off + 46 > b.length || dv.getUint32(off, true) !== 0x02014b50) throw new Error('zip');
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true), extraLen = dv.getUint16(off + 30, true), commentLen = dv.getUint16(off + 32, true);
    const local = dv.getUint32(off + 42, true);
    files.set(dec.decode(b.subarray(off + 46, off + 46 + nameLen)), { method, csize, local });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...files.keys()],
    async read(name) {
      const f = files.get(name);
      if (!f) return null;
      if (dv.getUint32(f.local, true) !== 0x04034b50) throw new Error('zip');
      const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
      const data = b.subarray(start, start + f.csize);
      if (f.method === 0) return dec.decode(data);
      if (f.method === 8) return dec.decode(await inflateRaw(data));
      throw new Error('zip');
    },
  };
}
const xmlText = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (m, x) => String.fromCodePoint(parseInt(x, 16)))
  .replace(/&amp;/g, '&');
const runsText = (xml) => [...String(xml).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('');
function sharedStrings(xml) {
  return [...String(xml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => xmlText(runsText(m[1] || '')));
}
const colIndex = (letters) => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
export function sheetRows(xml, ss = []) {
  const rows = [];
  const src = String(xml).replace(/<row\b[^>]*\/>/g, '');
  for (const rm of src.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rAttr = rm[1].match(/\br="(\d+)"/);
    const rowIdx = rAttr ? Number(rAttr[1]) - 1 : rows.length;
    const cells = [];
    let next = 0;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
      const ci = ref ? colIndex(ref) : next;
      next = ci + 1;
      const t = (attrs.match(/\bt="(\w+)"/) || [])[1] || 'n';
      const inner = cm[2] || '';
      let v;
      if (t === 'inlineStr') v = xmlText(runsText(inner));
      else {
        const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
        v = vm ? vm[1] : '';
        if (t === 's') v = ss[Number(v)] ?? '';
        else v = xmlText(v);
        if (t === 'b') v = v === '1' ? 'TRUE' : 'FALSE';
      }
      cells[ci] = v;
    }
    rows[rowIdx] = Array.from(cells, (x) => (x == null ? '' : String(x).trim()));
  }
  return rows.filter((r) => r && r.some((x) => x !== ''));
}
// 첫 번째 시트를 [[칸, 칸, …], …] 로
export async function readXlsx(buf) {
  const z = unzip(buf);
  const wb = await z.read('xl/workbook.xml');
  const rels = await z.read('xl/_rels/workbook.xml.rels');
  let path = 'xl/worksheets/sheet1.xml';
  const first = wb && wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  if (first && rels) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${first[1]}"`));
    const target = rel && (rel.match(/Target="([^"]+)"/) || [])[1];
    if (target) path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  const ssXml = await z.read('xl/sharedStrings.xml');
  const ss = ssXml ? sharedStrings(ssXml) : [];
  let sheet = await z.read(path);
  if (!sheet) {
    const any = z.names.find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    sheet = any ? await z.read(any) : null;
  }
  if (!sheet) throw new Error('xlsx');
  return sheetRows(sheet, ss);
}
// 파일 바이트 → 행 목록 (엑셀이면 첫 시트, 아니면 CSV/TSV)
export async function readTable(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (isZip(bytes)) return { kind: 'xlsx', rows: await readXlsx(bytes) };
  return { kind: 'csv', rows: parseCsv(decodeBytes(bytes)) };
}

// 게시 주소나 제목으로 글 찾기
export function makePostResolver(posts) {
  const norm = (s) => String(s || '').toLowerCase().replace(/^https?:\/\/(m\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '').trim();
  const byUrl = new Map(), byTitle = new Map();
  for (const p of posts) {
    if (p.blog_url) byUrl.set(norm(p.blog_url), p.id);
    for (const t of p.titles || []) if (t) byTitle.set(String(t).trim(), p.id);
    if (p.keyword) byTitle.set(String(p.keyword).trim(), byTitle.get(String(p.keyword).trim()) || p.id);
  }
  return (text) => byUrl.get(norm(text)) || byTitle.get(String(text).trim()) || null;
}

// ───────── 통계 ─────────
// stats() 결과의 칸: {sum, n} → n = 0 이면 데이터 없음(null), 0 과 구분
export const val = (agg, f) => (agg && agg[f] && agg[f].n > 0 ? Number(agg[f].sum) : null);
export const ratio = (num, den) => (num == null || den == null || den <= 0 ? null : num / den);
// 비용을 한 번도 안 넣었으면 0원으로 계산하되 costMissing 으로 알려줌 (화면에 '비용 입력 없음' 표시)
export function netProfit(agg) {
  const conf = val(agg, 'revenue_confirmed'), est = val(agg, 'revenue_est'), cost = val(agg, 'cost');
  return {
    confirmed: conf == null ? null : conf - (cost || 0),
    estimated: est == null ? null : est - (cost || 0),
    costMissing: cost == null,
  };
}
// 클릭률·전환율·1,000회 조회당 수익: 분자와 분모가 둘 다 있는 글만 모아서 계산
export function rates(byPost) {
  let v = 0, c = 0, c2 = 0, o = 0, v3 = 0, r = 0, nCtr = 0, nConv = 0, nRpm = 0;
  for (const a of byPost || []) {
    const views = val(a, 'views'), clicks = val(a, 'clicks'), orders = val(a, 'orders'), rev = val(a, 'revenue_est');
    if (views != null && clicks != null && views > 0) { v += views; c += clicks; nCtr++; }
    if (clicks != null && orders != null && clicks > 0) { c2 += clicks; o += orders; nConv++; }
    if (views != null && rev != null && views > 0) { v3 += views; r += rev; nRpm++; }
  }
  return {
    ctr: nCtr ? c / v : null, ctrPosts: nCtr,
    conversion: nConv ? o / c2 : null, convPosts: nConv,
    rpm: nRpm ? (r / v3) * 1000 : null, rpmPosts: nRpm,
  };
}

// ───────── 주제 점수 ─────────
export function topicScore(topic, weights) {
  const w = weights || {};
  const parts = [];
  let sum = 0, max = 0, wAll = 0, measured = 0;
  for (const [f, label] of Object.entries(SCORE_FACTORS)) {
    const weight = Number(w[f] ?? 1);
    if (!(weight > 0)) continue;
    wAll += weight;
    const s = topic.scores && topic.scores[f];
    const score = s && typeof s.score === 'number' && s.score >= 0 && s.score <= 5 ? s.score : null;
    if (score != null) {
      sum += weight * score; max += weight * 5;
      if (/^실측/.test(String(s.source || ''))) measured++;
    }
    parts.push({ f, label, weight, score, basis: (s && s.basis) || '', source: (s && s.source) || (score == null ? '데이터 없음' : 'AI 추정'), confidence: (s && s.confidence) || '' });
  }
  const coverage = wAll ? max / (wAll * 5) : 0;
  const total = max ? Math.round((sum / max) * 100) : null;
  const confidence = total == null ? '데이터 없음' : measured === 0 ? '낮음 (실측 데이터 없이 AI 추정만)' : coverage < 0.6 ? '낮음 (빈 항목 많음)' : '보통';
  return { total, coverage, measured, confidence, parts };
}

// 점수 항목 중 실측·성과 데이터·직접 입력 근거가 하나라도 있으면 true — 없으면 화면이 점수 옆에 'AI 추정'을 붙임 (1.3.1)
export const realScore = (s) => ((s && s.parts) || []).some((pt) => pt.score != null && /^(실측|성과 데이터|직접 입력)/.test(String(pt.source || '')));

// ───────── 검색 노출 도우미 ─────────
// 달마다 사람들이 많이 찾기 시작하는 생활 주제 (앱이 정해 둔 달력 — 실제 검색량 숫자가 아님)
export const SEASON_CALENDAR = {
  1: ['설 선물', '연말정산', '겨울 방학', '동파 예방', '새해 다이어트'],
  2: ['졸업·입학 선물', '신학기 준비', '봄 이사 준비', '봄맞이 대청소'],
  3: ['신학기', '미세먼지·공기청정기', '봄 이사', '환절기 건강'],
  4: ['봄나들이·캠핑', '꽃가루 알레르기', '자외선 차단', '봄옷 정리'],
  5: ['어린이날·어버이날 선물', '에어컨 점검·청소', '여름 준비'],
  6: ['장마·제습기', '선풍기·서큘레이터', '여름 휴가 준비', '모기 퇴치'],
  7: ['폭염·냉방', '여름 휴가', '전기요금 아끼기', '여름 캠핑'],
  8: ['휴가 막바지', '개학 준비', '태풍 대비', '추석 선물 준비'],
  9: ['추석 선물', '환절기', '가을 캠핑', '가을 이사'],
  10: ['난방 준비', '가을 나들이', '핼러윈', '김장 준비', '가습기'],
  11: ['김장', '난방·전기장판', '결로·외풍 막기', '블랙프라이데이', '수능'],
  12: ['크리스마스·연말 선물', '한파·동파 대비', '연말정산 준비', '겨울 여행'],
};
// 2~4주 뒤 달의 주제 (그때 검색이 늘기 전에 미리 써 두기)
export function seasonAhead(today = todayStr()) {
  const months = [...new Set([14, 28].map((n) => parseYmd(addDays(today, n)).getMonth() + 1))];
  return { months, themes: [...new Set(months.flatMap((m) => SEASON_CALENDAR[m] || []))] };
}
// 주력 주제 비율 — 게시를 마친 글만 셈 (게시 완료·실적 수집 중·성과 분석 완료). 초안(검수 필요·발행 준비 등)·지운 글·실패 글은 빼
// '최근' 순서: 게시일(published_on) → 없으면 예정 발행일(publish_date) → 그것도 없으면 만든 날(created_at)
// 게시한 글이 하나도 없으면 ratio 는 null (= 데이터 없음. 0%가 아님)
// fit(post, focus): checks.js focusFit 처럼 {verdict} 를 돌려주는 함수 (true/false 를 돌려줘도 됨). opts.terms: 주력 주제 낱말, opts.channels: 이 채널 글만
export const LIVE_STAGES = ['published', 'collecting', 'analyzed'];
export const postedOn = (p) => String((p && (p.published_on || p.publish_date || p.created_at)) || '').slice(0, 10);
export function focusShare(posts, focus, n = 30, fit = null, opts = {}) {
  const fitFn = typeof fit === 'function' ? fit : (p, f) => focusFit(p, f, opts.terms);
  const list = (posts || []).filter((p) => p && !p.deleted_at && LIVE_STAGES.includes(p.stage) && (!opts.channels || opts.channels.includes(p.channel_id)))
    .sort((a, b) => postedOn(b).localeCompare(postedOn(a)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, n);
  let hit = 0, unclear = 0, off = 0, none = 0;
  for (const p of list) {
    const r = fitFn(p, focus);
    const v = typeof r === 'boolean' ? (r ? 'match' : 'off') : (r && r.verdict) || 'off';
    if (v === 'match') hit++; else if (v === 'unclear') unclear++; else if (v === 'none') none++; else off++;
  }
  // 판정할 수 없는 글(none — 주력 주제가 없거나 낱말이 없음)은 비율에서 빼
  const total = hit + unclear + off;
  return { total, hit, unclear, off, none, ratio: total ? hit / total : null, goal: SEO_RULES.focusShareGoal };
}
// 내 하루 발행 설정(perDay)보다 많이 올렸거나 잡아 둔 날 (지난 7일 ~ 다음 7일, 발행 준비·예약·게시 글)
export function crowdedDays(posts, today = todayStr(), perDay = 1) {
  const limit = Math.max(1, Number(perDay) || 1);
  const from = addDays(today, -7), to = addDays(today, 7);
  const count = {};
  for (const p of posts || []) {
    if (p.deleted_at || !['ready', 'scheduled', ...LIVE_STAGES].includes(p.stage)) continue;
    const d = p.published_on || p.publish_date;
    if (d && d >= from && d <= to) count[d] = (count[d] || 0) + 1;
  }
  return Object.entries(count).filter(([, n]) => n > limit).map(([day, n]) => ({ day, n })).sort((a, b) => a.day.localeCompare(b.day));
}

// ───────── 자동 작가 발행표 계획 (자동 작가 프롬프트 3단계와 같은 규칙) ─────────
// 목표 = 하루 발행 수 × 7, 잡힌 원고 = 내일~7일 뒤 발행일이 잡힌 원고(지운 것·실패·대기 빼고 — DB writer_context 'upcoming'과 같음)
// 한 번 실행에 자동 글은 최대 4편, 요청 원고까지 합쳐 최대 6편. 자동 작가가 쓴 원고는 항상 '검수 필요'로 들어옴
// 1.4.0: 검수·게시 안 한 원고(쌓인 원고)가 한도 이상이면 자동 글을 안 씀 — DB add_post 도 같은 규칙으로 막음 (backlog_state)
export const AUTO_RULES = { days: 7, maxAutoPerRun: 4, maxPerRun: 6, maxJobsPerRun: 5 };
export const BACKLOG_STAGES = ['review', 'verify', 'ready', 'scheduled'];
// 쌓인 원고: 사람이 검수·게시해야 하는 원고. 한도는 설정(backlog_limit, 1~60), 0이면 하루 발행 수 × 7 (DB backlog_state 와 같음)
// overdue = 예정일이 지난 원고 중 날짜를 다시 잡을 수 있는 것(검수 필요·정보 필요·발행 준비),
// overdueScheduled = 예약한 날이 지난 원고 (블로그에 이미 올라갔을 수 있어서 날짜를 옮기지 않음 — '게시 완료 기록'을 권함)
export const RESCHEDULE_STAGES = ['review', 'verify', 'ready'];
export function backlogInfo(posts, settings, today = todayStr()) {
  const st = settings || {};
  const perDay = Math.min(3, Math.max(1, Number(st.per_day) || 1));
  const own = Math.round(Number(st.backlog_limit) || 0);
  const limit = own > 0 ? Math.min(60, own) : perDay * AUTO_RULES.days;
  const list = (posts || []).filter((p) => p && !p.deleted_at && BACKLOG_STAGES.includes(p.stage));
  const late = list.filter((p) => p.publish_date && p.publish_date < today);
  const overdue = late.filter((p) => RESCHEDULE_STAGES.includes(p.stage)).length;
  const review = list.filter((p) => p.stage === 'review' || p.stage === 'verify').length;
  return { backlog: list.length, limit, auto: !(own > 0), full: list.length >= limit, room: Math.max(0, limit - list.length), overdue, overdueScheduled: late.length - overdue, review, ready: list.length - review };
}
// pendingWrites: 기다리는 원고 작업 수 — 2단계에서 채우면 '검수 필요'가 돼서 쌓인 원고가 그만큼 늘어 (프롬프트 3단계: 한도 − 쌓인 원고 − 2단계에서 저장한 원고)
export function autoPlan({ posts, settings, today = todayStr(), pendingWrites = 0 } = {}) {
  const st = settings || {};
  const perDay = Math.min(3, Math.max(1, Number(st.per_day) || 1));
  const goal = perDay * AUTO_RULES.days;
  const from = addDays(today, 1), to = addDays(today, AUTO_RULES.days);
  const scheduled = (posts || []).filter((p) => p && !p.deleted_at && !['failed', 'queued'].includes(p.stage) && p.publish_date && p.publish_date >= from && p.publish_date <= to).length;
  const gap = Math.max(0, goal - scheduled);
  const enabled = st.auto_enabled !== false && !!(String(st.focus_topic || '').trim() || String(st.auto_topics || '').trim());
  const jobs = Math.min(Math.max(0, Number(pendingWrites) || 0), AUTO_RULES.maxJobsPerRun);
  const bl = backlogInfo(posts, st, today);
  const roomNext = Math.max(0, bl.room - jobs); // 요청 원고를 먼저 쓰고 남는 자리
  const autoNext = enabled ? Math.min(gap, AUTO_RULES.maxAutoPerRun, Math.max(0, AUTO_RULES.maxPerRun - jobs), roomNext) : 0;
  return { perDay, recommended: SEO_RULES.perDayRecommended, differs: perDay !== SEO_RULES.perDayRecommended, goal, scheduled, gap, enabled, jobs, autoNext,
    backlog: bl.backlog, backlogLimit: bl.limit, backlogFull: bl.full, room: bl.room, roomNext, overdue: bl.overdue };
}

// ───────── 유입 검색어 (블로그 통계에서 복사해 붙여넣은 글) ─────────
// 한 줄에 검색어 하나: "원룸 전기요 12", "1. 원룸 전기요 12회 4.5%", "원룸 전기요 (12)", 표에서 복사한 "1\t원룸 전기요\t12\t4.5%"
// 숫자가 없으면 views 는 null(데이터 없음). 비율(%)은 유입 수가 아니라서 숫자로 안 씀. 같은 검색어가 두 번 나오면 숫자를 더함. 머리글 줄(검색어·키워드·유입수…)은 건너뜀
// 없는 숫자를 만들지 않게 — 끝의 숫자가 검색어의 일부일 수 있으면(예: "아이폰 16 12.5%") 유입 수로 읽지 않음:
//  - 비율이 붙은 줄은 '회·건·명'이나 괄호가 붙은 숫자만 유입 수로 읽어. 단 비율이 붙은 줄이 2줄 이상이고 모두 비율 바로 앞에 숫자가 있으면
//    그 칸을 유입 수로 봐 (표에서 복사하다 칸 구분이 사라진 경우: "1 원룸 전기요 7 2.1%")
//  - 맨 앞의 "1." "1)"은 순위로 빼고, 점 없는 맨 앞 숫자(1~3자리)는 여러 줄이 1, 2, 3…처럼 이어질 때만 순위로 봐 ("2026 달력"·"10 평 원룸" 같은 검색어를 지키려고)
const TERM_HEADERS = new Set(['검색어', '키워드', '유입 검색어', '유입검색어', '검색 키워드', '순위', '유입수', '조회수', '비율', '검색어 유입수']);
const HEADER_WORDS = new Set(['검색어', '키워드', '유입', '검색', '순위', '유입수', '조회수', '비율', '횟수', '건수', '점유율', '유입검색어']);
const isCountCell = (c) => /^[\d,]+\s*(회|건|명)?$/.test(c);
const isPctCell = (c) => /^\d+(\.\d+)?\s*%$/.test(c);
const toCount = (c) => { const n = Number(String(c).replace(/[^\d]/g, '')); return Number.isFinite(n) ? n : null; };
const PCT_END = /\s+\d+(\.\d+)?\s*%$/;
const BARE_RANK = /^(\d{1,3})\s+(?=\S)/;
const UNIT_COUNT = /^(.*\S)\s*[([]\s*([\d,]+)\s*(?:회|건|명)?\s*[)\]]$|^(.*\S)\s+([\d,]+)\s*(?:회|건|명)$/;
const BARE_COUNT = /^(.*\S)\s+([\d,]+)$/;
export function parseSearchTerms(text) {
  const items = [], skipped = [];
  const seen = new Map();
  const rows = String(text || '').split(/\r?\n/).map((raw, i) => ({ raw, n: i + 1, line: raw.replace(/ /g, ' ').trim() })).filter((r) => r.line);
  // 칸 구분(탭)이 없는 줄: 순위 칸·유입 수 칸이 있는지 붙여넣은 줄 전체를 보고 정함
  const plain = rows.filter((r) => !r.line.includes('\t')).map((r) => ({ r, s: r.line.replace(/^\d+\s*[.)]\s*/, '') }));
  const bare = plain.map((x) => { const m = x.s.match(BARE_RANK); return m ? Number(m[1]) : null; }).filter((v) => v != null);
  const rankCol = bare.length >= 2 && bare.every((v, k) => v === bare[0] + k);
  if (rankCol) for (const x of plain) x.s = x.s.replace(BARE_RANK, '');
  const pct = plain.filter((x) => PCT_END.test(x.s)).map((x) => x.s.replace(PCT_END, '').trim());
  const pctCountCol = pct.length >= 2 && pct.every((s) => UNIT_COUNT.test(s) || BARE_COUNT.test(s));
  const plainOf = new Map(plain.map((x) => [x.r, x.s]));
  for (const r of rows) {
    const { raw, n } = r;
    let term = '', views = null;
    const cols = r.line.split('\t').map((c) => c.trim()).filter(Boolean);
    if (cols.length > 1) {
      let cs = cols;
      if (/^\d+$/.test(cs[0]) && cs.length >= 3) cs = cs.slice(1); // 순위 칸
      const ti = cs.findIndex((c) => !isCountCell(c) && !isPctCell(c));
      if (ti < 0) { skipped.push({ line: n, text: raw.trim(), why: '검색어가 없어' }); continue; }
      term = cs[ti];
      const num = cs.slice(ti + 1).find(isCountCell);
      views = num != null ? toCount(num) : null;
    } else {
      let s = plainOf.get(r) ?? r.line;
      const hadPct = PCT_END.test(s);
      if (hadPct) s = s.replace(PCT_END, '').trim();
      const u = s.match(UNIT_COUNT);
      const b = !u && (!hadPct || pctCountCol) ? s.match(BARE_COUNT) : null;
      if (u) { term = u[1] ?? u[3]; views = toCount(u[2] ?? u[4]); } else if (b) { term = b[1]; views = toCount(b[2]); } else term = s;
    }
    term = term.replace(/\s+/g, ' ').trim();
    if (!term || TERM_HEADERS.has(term) || term.split(' ').every((w) => HEADER_WORDS.has(w))) continue;
    if (/^[\d,.%\s]+$/.test(term)) { skipped.push({ line: n, text: raw.trim(), why: '숫자만 있어' }); continue; }
    if (term.length > 100) { skipped.push({ line: n, text: raw.trim().slice(0, 40), why: '100자 넘어' }); continue; }
    const key = term.toLowerCase();
    const was = seen.get(key);
    if (was) { if (views != null) was.views = (was.views ?? 0) + views; continue; }
    const it = { term, views };
    seen.set(key, it);
    items.push(it);
  }
  return { items, skipped };
}
const normTerm = (s) => String(s || '').toLowerCase().replace(/[\s·,./!?~\-_'"()[\]]+/g, '');
// 글별 검색어 합계 (기간 상관없이 같은 검색어는 더함, 빈 값만 있으면 null), 많은 순
export function termsByPost(terms) {
  const out = new Map();
  for (const t of terms || []) {
    if (!t || !t.post_id || !t.term) continue;
    const m = out.get(t.post_id) || new Map();
    const k = t.term.toLowerCase();
    const was = m.get(k) || { term: t.term, views: null, rows: 0 };
    if (t.views != null) was.views = (was.views ?? 0) + Number(t.views);
    was.rows++;
    m.set(k, was);
    out.set(t.post_id, m);
  }
  const res = new Map();
  for (const [id, m] of out) res.set(id, [...m.values()].sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || a.term.localeCompare(b.term)));
  return res;
}
// 제목·키워드에 없는 검색어 (많이 들어온 순, 숫자가 있는 것만) — 제목·소제목을 고칠 때 쓸 말
// unknown: true 면 숫자 없이 들어온 검색어(비율만 있는 통계 등)도 같이 (원고 화면 알림용 — 추천은 숫자가 있는 것만 씀)
export function titleGaps(post, list, min = 1, { unknown = false } = {}) {
  const have = normTerm([post && post.keyword, ...((post && post.titles) || [])].join(' '));
  return (list || []).filter((t) => (t.views != null ? t.views >= min : unknown) && !have.includes(normTerm(t.term)));
}
// 어느 글의 키워드·제목도 다루지 않는 검색어 (모든 글 합계 min회 이상) — 새 글 후보
// 검색어 낱말의 절반 이상이 어떤 글의 키워드·제목에 있으면 그 글이 다루는 걸로 봄 (그건 '제목에 없는 검색어'로 따로 알려줌)
// 지운 글(posts 에 없는 글)의 검색어는 안 셈 — DB writer_context search_terms_top 과 같음
const termWords = (s) => String(s || '').toLowerCase().split(/[\s·,./!?~\-_'"()[\]]+/).filter(Boolean);
export function uncoveredTerms(posts, terms, min = 5) {
  const alive = (posts || []).filter((p) => p && !p.deleted_at);
  const ids = new Set(alive.map((p) => p.id));
  const texts = alive.map((p) => [p.keyword, ...(p.titles || [])].join(' ').toLowerCase());
  const covered = (term) => { const ws = termWords(term); return !ws.length || texts.some((tx) => ws.filter((w) => tx.includes(w)).length / ws.length >= 0.5); };
  const sum = new Map();
  for (const t of terms || []) {
    if (!t || !t.term || t.views == null || (t.post_id && !ids.has(t.post_id))) continue;
    const k = normTerm(t.term);
    if (!k) continue;
    const was = sum.get(k) || { term: t.term, views: 0, posts: new Set() };
    was.views += Number(t.views);
    if (t.post_id) was.posts.add(t.post_id);
    sum.set(k, was);
  }
  return [...sum.values()].filter((x) => x.views >= min && !covered(x.term))
    .map((x) => ({ term: x.term, views: x.views, posts: x.posts.size })).sort((a, b) => b.views - a.views);
}

// ───────── 운영 흐름판: 주제 → 원고 → 게시 준비 → 게시 → 다른 채널 → 실적 → 개선, 어디서 막혔는지 ─────────
// metricPostIds: 실적이 한 줄이라도 있는 글 id (Set 또는 배열). 실적은 게시한 지 7일 지난 글만 따짐
// postChannels·metricPostIds 가 null 이면 '못 읽음'(DB 016 전이거나 읽다가 오류) — 0으로 보지 않고 '데이터 없음', 그 단계로 막힌 곳을 정하지 않음
// channels(채널 목록)를 주면, 켜 둔 다른 채널이 없는 글은 '다른 채널' 단계에서 빼 (퍼뜨릴 곳이 없는데 막혔다고 하지 않게)
export const OPS_RULES = { measureAfterDays: 7, spreadGoal: 0.5 };
// 이 글을 올릴 수 있는 다른 채널 (켜 둔 채널 중 글의 채널이 아닌 것). channels 를 안 주면 null(모름)
export const otherChannels = (p, channels) => (Array.isArray(channels) ? channels.filter((c) => c && c.active && c.id !== p.channel_id) : null);
export function opsFunnel({ posts, postChannels, metricPostIds, topics, programs, settings, channels, fixCount = 0, today = todayStr() } = {}) {
  const ps = (posts || []).filter((p) => p && !p.deleted_at);
  const bl = backlogInfo(ps, settings, today);
  const pcKnown = postChannels !== null, mKnown = metricPostIds !== null;
  const mset = metricPostIds instanceof Set ? metricPostIds : new Set(metricPostIds || []);
  const spreadIds = new Set((postChannels || []).map((x) => x.post_id));
  const live = ps.filter((p) => LIVE_STAGES.includes(p.stage));
  const measurable = live.filter((p) => !p.published_on || daysSince(p.published_on, today) >= OPS_RULES.measureAfterDays);
  const withData = measurable.filter((p) => mset.has(p.id));
  const spreadable = live.filter((p) => { const o = otherChannels(p, channels); return o == null || o.length > 0; });
  const spread = spreadable.filter((p) => spreadIds.has(p.id));
  const refreshed = ps.filter((p) => p.refresh && Object.keys(p.refresh).some((k) => !k.startsWith('_'))).length;
  const nTopics = (topics || []).filter((t) => t.status === '후보' || t.status === '채택').length;
  const drafting = ps.filter((p) => ['queued', 'researching', 'writing', 'review', 'verify'].includes(p.stage)).length;
  const ready = ps.filter((p) => p.stage === 'ready' || p.stage === 'scheduled').length;
  const live7 = live.filter((p) => p.published_on && daysSince(p.published_on, today) <= 6).length;
  const joined = (programs || []).filter((x) => x.active !== false && x.my_status === '사용 중').length;
  const waiting = (programs || []).filter((x) => x.active !== false && x.my_status === '가입 대기').length;
  const stages = [
    { key: 'topic', label: '주제', count: nTopics, sub: '후보·채택' },
    { key: 'draft', label: '원고', count: drafting, sub: '쓰는 중·검수' },
    { key: 'ready', label: '게시 준비', count: ready, sub: '준비·예약' },
    { key: 'live', label: '게시', count: live.length, sub: `최근 7일 ${live7}` },
    !pcKnown ? { key: 'spread', label: '다른 채널', count: null, sub: '데이터 없음' }
      : { key: 'spread', label: '다른 채널', count: spread.length, of: spreadable.length, sub: spreadable.length ? `게시 글 ${spreadable.length}개 중` : (live.length ? '올릴 다른 채널 없음' : '') },
    !mKnown ? { key: 'data', label: '실적', count: null, sub: '데이터 없음' }
      : { key: 'data', label: '실적', count: withData.length, of: measurable.length, sub: measurable.length ? `7일 지난 ${measurable.length}개 중` : '' },
    { key: 'improve', label: '개선', count: refreshed, sub: fixCount ? `고칠 것 ${fixCount}` : '' },
  ];
  let bottleneck;
  if (bl.full || (!live.length && bl.backlog > 0)) {
    bottleneck = { key: 'live', title: '게시가 막혔어',
      reason: bl.full ? `검수·게시 안 한 원고가 ${bl.backlog}개 쌓여서(한도 ${bl.limit}개) 자동 작가가 새 글을 멈췄어. 오늘 1편만 검수해서 올리면 다시 돌아가.`
        : `원고 ${bl.backlog}개가 검수·게시를 기다리는데 게시한 글이 아직 없어. 1편만 올려도 다음 단계(다른 채널·실적)를 시작할 수 있어.`,
      action: { type: 'go', path: bl.review ? 'content/f/you' : 'content/f/ready', label: bl.review ? '검수할 원고 보기' : '게시할 원고 보기' } };
  } else if (pcKnown && spreadable.length && spread.length / spreadable.length < OPS_RULES.spreadGoal) {
    const next = spreadable.find((p) => !spreadIds.has(p.id));
    bottleneck = { key: 'spread', title: '다른 채널로 안 퍼지고 있어', reason: `게시한 글 ${spreadable.length}개 중 다른 채널(티스토리·쓰레드·인스타 등)에도 올린 글이 ${spread.length}개야. 같은 글을 채널에 맞게 바꿔 올리면 들어오는 길이 늘어.`,
      action: next ? { type: 'post', postId: next.id, label: '안 퍼뜨린 글 보기' } : null };
  } else if (mKnown && measurable.length && withData.length < measurable.length) {
    const next = measurable.find((p) => !mset.has(p.id));
    bottleneck = { key: 'data', title: '실적이 안 들어오고 있어', reason: `게시한 지 7일 지난 글 ${measurable.length}개 중 실적(조회·클릭·수익)을 넣은 글이 ${withData.length}개야. 숫자가 있어야 다음 글을 고를 수 있어.`,
      action: next ? { type: 'metrics', postId: next.id, label: '실적 넣기' } : { type: 'go', path: 'money', label: '실적 넣으러 가기' } };
  } else if (fixCount) {
    bottleneck = { key: 'improve', title: '고칠 글이 있어', reason: `실적·검색어로 보면 고칠 만한 글이 ${fixCount}개야. 아래 '개선 루프'에서 개선안을 요청해봐.`, action: null };
  } else if (!nTopics && !drafting && !ready) {
    bottleneck = { key: 'topic', title: '쓸 주제가 없어', reason: '주제 추천을 받거나 새 원고를 요청해줘.', action: { type: 'go', path: 'topics', label: '주제 추천 보기' } };
  } else {
    bottleneck = { key: 'ok', title: '흐름이 막힌 곳은 없어', reason: live.length ? '게시·확산·실적이 고르게 돌고 있어. 개선 루프에서 다음 글을 골라봐.' : '원고가 들어오는 중이야.', action: null };
  }
  for (const st of stages) st.state = st.key === bottleneck.key ? 'block' : st.count == null ? 'none' : (st.of != null && st.of > 0 && st.count < st.of ? 'warn' : 'ok');
  return { stages, bottleneck, backlog: bl, money: { joined, waiting, total: (programs || []).filter((x) => x.active !== false).length } };
}

// ───────── 다음 할 일 추천 (규칙 기반, 근거 데이터 같이 표시) ─────────
// 묶음(group): more = 더 쓸 것, fix = 고칠 것, stop = 그만할 것(줄일 것), data = 데이터 먼저
export const REC_GROUPS = { more: '더 쓸 것', fix: '고칠 것', stop: '그만할 것', data: '데이터 먼저' };
// postChannels 가 null 이면(못 읽음) '안 퍼뜨린 글' 추천은 안 함. channels 를 주면 올릴 다른 채널이 없는 글도 뺌
export function recommendations({ posts, byPost, products, postProducts, searchTerms, postChannels, channels, today }) {
  const recs = [];
  const t = today || todayStr();
  const map = new Map((byPost || []).map((a) => [a.key, a]));
  const live = posts.filter((p) => !p.deleted_at && ['published', 'collecting', 'analyzed'].includes(p.stage));
  const withData = live.filter((p) => map.has(p.id));

  // 1) 게시했는데 실적이 없음
  for (const p of live) {
    const since = p.published_on ? daysSince(p.published_on, t) : null;
    if (since != null && since >= 7 && !map.has(p.id)) {
      recs.push({ kind: 'need_metrics', group: 'data', postId: p.id, title: '실적 입력이 필요해', reason: `게시한 지 ${since}일 지났는데 조회수·클릭·수익 기록이 하나도 없어.`, data: [{ label: '게시일', value: p.published_on }], action: { type: 'metrics', postId: p.id }, confidence: '확실' });
    }
  }

  // 2) 조회는 많은데 클릭이 적음 / 3) 클릭은 많은데 구매가 적음 → 개선안 요청
  const ctrs = withData.map((p) => { const a = map.get(p.id); const v = val(a, 'views'), c = val(a, 'clicks'); return v && c != null ? { p, v, c, r: c / v } : null; }).filter(Boolean);
  const sorted = ctrs.map((x) => x.r).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  for (const x of ctrs) {
    if (x.v < 100) continue;
    const low = ctrs.length >= 3 ? x.r < median * 0.5 : x.r < 0.005;
    if (low) recs.push({ kind: 'low_ctr', group: 'fix', postId: x.p.id, title: '조회는 많은데 링크 클릭이 적어', reason: ctrs.length >= 3 ? `클릭률이 다른 글 중간값(${pct(median)})의 절반도 안 돼. 링크 위치·버튼 문구를 바꿔볼 만해.` : `클릭률이 0.5% 미만이야. 비교할 글이 적어서 참고만 해.`, data: [{ label: '조회수', value: fmtNum(x.v) }, { label: '클릭', value: fmtNum(x.c) }, { label: '클릭률', value: pct(x.r) }], action: { type: 'refresh', postId: x.p.id, focus: 'ctr' }, confidence: ctrs.length >= 3 ? '보통' : '참고' });
  }
  for (const p of withData) {
    const a = map.get(p.id); const c = val(a, 'clicks'), o = val(a, 'orders');
    if (c != null && c >= 30 && o != null && o / c < 0.01) recs.push({ kind: 'low_conversion', group: 'fix', postId: p.id, title: '클릭은 많은데 구매가 거의 없어', reason: '연결 상품이 독자가 찾는 것과 맞는지, 가격대가 맞는지 봐줘.', data: [{ label: '클릭', value: fmtNum(c) }, { label: '구매', value: fmtNum(o) }, { label: '전환율', value: pct(o / c) }], action: { type: 'refresh', postId: p.id, focus: 'conversion' }, confidence: c >= 100 ? '보통' : '참고' });
  }

  // 4) 돈이 된 글 → 후속 글
  for (const p of withData) {
    const a = map.get(p.id); const o = val(a, 'orders'), rev = val(a, 'revenue_est');
    if ((o != null && o >= 1) || (rev != null && rev > 0)) {
      const prods = (postProducts || []).filter((pp) => pp.post_id === p.id).map((pp) => (products || []).find((x) => x.id === pp.product_id)).filter(Boolean);
      recs.push({ kind: 'follow_up', group: 'more', postId: p.id, title: '구매가 나온 글이야 — 후속 글을 만들어볼까', reason: `${prods.length ? '연결 상품(' + prods.slice(0, 2).map((x) => x.name).join(', ') + ')과 ' : ''}비슷한 주제로 비교 글이나 사용법 글을 만들 가치가 있어.`, data: [{ label: '구매', value: o == null ? '데이터 없음' : fmtNum(o) }, { label: '발생 수익', value: rev == null ? '데이터 없음' : won(rev) }], action: { type: 'topics', seedPostId: p.id, category: p.category, keyword: p.keyword }, confidence: (o || 0) >= 3 ? '보통' : '참고' });
    }
  }

  // 5) 실제 유입 검색어: 제목에 없는 검색어 → 제목·소제목 고치기 / 아무 글도 안 다룬 검색어 → 새 글
  const tbp = termsByPost(searchTerms);
  for (const p of live) {
    const gaps = titleGaps(p, tbp.get(p.id), 3);
    if (gaps.length) recs.push({ kind: 'title_from_search', group: 'fix', postId: p.id, title: '실제로 들어온 검색어가 제목에 없어', reason: `'${gaps[0].term}'(${fmtNum(gaps[0].views)}회)${gaps[1] ? `, '${gaps[1].term}'(${fmtNum(gaps[1].views)}회)` : ''}로 들어왔는데 제목·키워드에 그 말이 없어. 제목이나 소제목에 넣어볼 만해.`, data: gaps.slice(0, 3).map((g) => ({ label: g.term, value: `${fmtNum(g.views)}회` })), action: { type: 'refresh', postId: p.id, focus: 'title' }, confidence: gaps[0].views >= 10 ? '보통' : '참고' });
  }
  for (const u of uncoveredTerms(posts, searchTerms, 5).slice(0, 3)) {
    recs.push({ kind: 'new_from_search', group: 'more', title: `'${u.term}' 검색으로 들어오는데 그걸 다룬 글이 없어`, reason: `글 ${u.posts}개에 이 검색어로 ${fmtNum(u.views)}회 들어왔어. 이 검색어를 직접 다루는 글을 따로 써볼 만해.`, data: [{ label: '유입', value: `${fmtNum(u.views)}회` }], action: { type: 'topics', keyword: u.term, hint: `"${u.term}" 검색 유입 ${u.views}회 — 이 검색어를 직접 다루는 글` }, confidence: u.views >= 20 ? '보통' : '참고' });
  }

  // 6) 반응이 있는데 다른 채널에 안 올린 글 → 퍼뜨리기
  const spread = new Set((postChannels || []).map((x) => x.post_id));
  for (const p of postChannels === null ? [] : withData) {
    const others = otherChannels(p, channels);
    if (spread.has(p.id) || (others && !others.length)) continue;
    const a = map.get(p.id); const v = val(a, 'views'), c = val(a, 'clicks'), rev = val(a, 'revenue_est');
    if ((v != null && v >= 100) || (c != null && c >= 5) || (rev != null && rev > 0)) {
      recs.push({ kind: 'spread', group: 'more', postId: p.id, title: '반응이 있는 글인데 다른 채널에는 안 올렸어', reason: '쓰레드·인스타·티스토리 버전을 만들어 올리면 같은 글로 들어오는 길이 늘어.', data: [v != null && { label: '조회수', value: fmtNum(v) }, c != null && { label: '클릭', value: fmtNum(c) }].filter(Boolean), action: { type: 'post', postId: p.id }, confidence: '참고' });
    }
  }

  // 7) 제작 시간 대비 수익 (줄일 것)
  for (const p of withData) {
    const a = map.get(p.id); const rev = val(a, 'revenue_est');
    if (p.effort_minutes && p.effort_minutes >= 60 && rev != null) {
      const perHour = rev / (p.effort_minutes / 60);
      if (perHour < 1000) recs.push({ kind: 'effort', group: 'stop', postId: p.id, title: '들인 시간에 비해 수익이 적어', reason: `제작에 ${p.effort_minutes}분 들었고 시간당 ${won(perHour)} 벌었어. 비슷한 글은 더 짧게 만들거나 다른 주제를 고려해봐.`, data: [{ label: '제작 시간', value: `${p.effort_minutes}분` }, { label: '발생 수익', value: won(rev) }], action: { type: 'post', postId: p.id }, confidence: '참고' });
    }
  }
  // 8) 30일 넘게 반응이 없는 카테고리 (실적을 넣은 글이 3개 이상인데 클릭·구매·수익이 모두 0)
  const cats = new Map();
  for (const p of withData) {
    if (!p.category || !p.published_on || daysSince(p.published_on, t) < 30) continue;
    const a = map.get(p.id);
    const c = cats.get(p.category) || { n: 0, hit: 0 };
    c.n++;
    if ((val(a, 'clicks') || 0) > 0 || (val(a, 'orders') || 0) > 0 || (val(a, 'revenue_est') || 0) > 0) c.hit++;
    cats.set(p.category, c);
  }
  for (const [cat, c] of cats) {
    if (c.n >= 3 && c.hit === 0) recs.push({ kind: 'stop_category', group: 'stop', title: `'${cat}' 글은 반응이 없어`, reason: `30일 넘은 '${cat}' 글 ${c.n}개 모두 클릭·구매·수익이 0이야. 이 카테고리는 줄이거나 방향을 바꿔볼 만해.`, data: [{ label: '글', value: `${c.n}개` }], action: null, confidence: '참고' });
  }

  // 9) 가격·출처 다시 확인
  for (const p of posts.filter((x) => !x.deleted_at && ['ready', 'scheduled', 'published', 'collecting'].includes(x.stage))) {
    const prods = (postProducts || []).filter((pp) => pp.post_id === p.id).map((pp) => (products || []).find((x) => x.id === pp.product_id)).filter(Boolean);
    const stale = prods.filter((x) => (x.price_checked_at && daysSince(x.price_checked_at, t) > 30) || (x.info_checked_at && daysSince(x.info_checked_at, t) > 90));
    const oldSrc = (p.sources || []).filter((s) => s && s.checked_at && daysSince(s.checked_at, t) > 180);
    if (stale.length || oldSrc.length) recs.push({ kind: 'recheck', group: 'fix', postId: p.id, title: '가격·출처를 다시 확인할 때야', reason: [stale.length ? `오래된 상품 정보 ${stale.length}개` : '', oldSrc.length ? `6개월 넘은 출처 ${oldSrc.length}개` : ''].filter(Boolean).join(', '), data: stale.slice(0, 2).map((x) => ({ label: x.name, value: `가격 확인 ${x.price_checked_at || '없음'}` })), action: { type: 'post', postId: p.id }, confidence: '확실' });
  }

  if (!withData.length && live.length) recs.push({ kind: 'no_data', group: 'data', title: '성과 분석을 하려면 실적이 필요해', reason: '게시한 글의 조회수·클릭·수익을 입력하거나 파일로 올리면, 어떤 글이 돈이 되는지 비교해줄게.', data: [{ label: '게시한 글', value: String(live.length) }], action: { type: 'import' }, confidence: '확실' });
  return recs;
}

// ───────── 주간 정리: 최근 7일(오늘 포함)과 그 전 7일 비교 ─────────
// 숫자는 앱 기록(원고·게시·다른 채널·검색어)과 입력한 실적(stats) 기준. 실적이 없으면 null(데이터 없음)
// statsNow·statsPrev 는 그 7일 안에 '다 들어가는' 실적만 센 통계(stats_window within) — 한 달치 실적이 두 주에 똑같이 잡히지 않게. partial = 그래서 뺀 줄 수
// postChannels·searchTerms 가 null 이면(못 읽음) 그 줄은 데이터 없음. 지운 글(posts 에 없는 글)의 기록은 안 셈
// runsAuto7d: 서버가 센 최근 7일 자동 실행 수 (주면 그것, 없으면 runs 목록에서 셈)
const dayOf = (iso) => (iso ? ymd(new Date(iso)) : '');
export function weeklySummary({ posts, postChannels, searchTerms, runs, runsAuto7d, statsNow, statsPrev, today = todayStr() } = {}) {
  const r = { from: addDays(today, -6), to: today }, q = { from: addDays(today, -13), to: addDays(today, -7) };
  const inR = (d, x) => d && d >= x.from && d <= x.to;
  const ps = (posts || []).filter((p) => p && !p.deleted_at);
  const ids = new Set(ps.map((p) => p.id));
  const pcs = postChannels === null ? null : (postChannels || []).filter((c) => ids.has(c.post_id));
  const sts = searchTerms === null ? null : (searchTerms || []).filter((t) => ids.has(t.post_id));
  const count = (x) => ({
    drafts: ps.filter((p) => inR(dayOf(p.created_at), x)).length,
    auto: ps.filter((p) => p.source === 'auto' && inR(dayOf(p.created_at), x)).length,
    published: ps.filter((p) => LIVE_STAGES.includes(p.stage) && inR(p.published_on, x)).length,
    spread: pcs ? pcs.filter((c) => inR(c.posted_on, x)).length : null,
    terms: sts ? sts.filter((t) => inR(dayOf(t.created_at), x)).length : null,
    runs: (runs || []).filter((u) => u.kind === 'auto' && inR(dayOf(u.ran_at), x)).length,
  });
  const a = count(r), b = count(q);
  const tn = (statsNow && statsNow.totals) || {}, tp = (statsPrev && statsPrev.totals) || {};
  const rows = [
    { key: 'drafts', label: '새 원고', now: a.drafts, prev: b.drafts, sub: a.auto ? `자동 ${a.auto}` : '' },
    { key: 'published', label: '게시', now: a.published, prev: b.published },
    { key: 'spread', label: '다른 채널에 올림', now: a.spread, prev: b.spread },
    { key: 'terms', label: '넣은 검색어', now: a.terms, prev: b.terms },
    { key: 'views', label: '조회수', now: val(tn, 'views'), prev: val(tp, 'views') },
    { key: 'clicks', label: '링크 클릭', now: val(tn, 'clicks'), prev: val(tp, 'clicks') },
    { key: 'revenue', label: '발생 수익', now: val(tn, 'revenue_est'), prev: val(tp, 'revenue_est'), money: true },
  ];
  const top = ((statsNow && statsNow.by_post) || []).filter((x) => x.key && ids.has(x.key))
    .map((x) => ({ postId: x.key, revenue: val(x, 'revenue_est'), clicks: val(x, 'clicks'), views: val(x, 'views') }))
    .filter((x) => x.revenue != null || x.clicks != null || x.views != null)
    .sort((m, n) => (n.revenue ?? -1) - (m.revenue ?? -1) || (n.clicks ?? -1) - (m.clicks ?? -1) || (n.views ?? -1) - (m.views ?? -1))
    .slice(0, 3);
  const partial = (statsNow && Number(statsNow.partial)) || 0;
  const partialPrev = (statsPrev && Number(statsPrev.partial)) || 0;
  return { range: r, prevRange: q, rows, top, ranAuto: Number.isFinite(runsAuto7d) ? runsAuto7d : a.runs, partial, partialPrev, statsMissing: !statsNow };
}

export const hasUnfilledMe = (p) => countMe(p.body) > 0;
