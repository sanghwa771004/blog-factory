// cards.js — 카드뉴스 그리기 (앱 안 템플릿). 글자는 이미지 AI가 아니라 여기서 직접 그려서 PNG로 내보냄 (글자 깨짐 없음)
// 그리는 방법(renderer)만 이 파일에 모음 → 나중에 Canva 같은 외부 디자인 도구를 붙일 때는 같은 모양의 renderer 를 더하면 됨
// (Canva 연결은 OAuth 인증·API 이용 조건 확인이 필요해서 이번 버전에는 없음)

export const SIZES = { '4:5': [1080, 1350], '1:1': [1080, 1080] };
const THEMES = {
  clean: { bg: '#FBFCF9', ink: '#1B2420', muted: '#5E6B64', accent: '#1F5D4C', soft: '#DCEBE4', mark: '', pill: '#1F5D4C', pillInk: '#FFFFFF' },
  mark: { bg: '#FFFDF2', ink: '#1B2420', muted: '#6A6550', accent: '#1F5D4C', soft: '#F7E9A6', mark: '#F4DA62', pill: '#1B2420', pillInk: '#FFFDF2' },
  dark: { bg: '#121815', ink: '#E9EFEA', muted: '#9AA8A0', accent: '#6FC3A8', soft: '#1E3A30', mark: '', pill: '#6FC3A8', pillInk: '#0E1A15' },
};
const FONT_TITLE = (px) => `400 ${px}px "Do Hyeon", "IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
const FONT_BODY = (px, w = 400) => `${w} ${px}px "IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;

// 웹 글꼴이 다 내려온 다음에 그려야 글꼴이 맞음 (인터넷이 안 되면 기기 글꼴로 그림)
// 한글 글꼴은 글자 범위별로 나뉘어 내려와서, 실제로 쓸 글자(text)와 쓰는 굵기(400·500·700, 제목 글꼴) 모두 미리 받음
export async function ensureFonts(text = '') {
  try {
    if (!document.fonts || !document.fonts.load) return;
    const chars = [...new Set([...String(text || ''), ...'가A0광고'])].join('').slice(0, 3000);
    await Promise.race([
      Promise.all([document.fonts.load(FONT_TITLE(64), chars), document.fonts.load(FONT_BODY(40), chars), document.fonts.load(FONT_BODY(40, 500), chars), document.fonts.load(FONT_BODY(40, 700), chars)]),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch { /* 기기 글꼴로 */ }
}

// 줄 나누기: 띄어쓰기 기준, 한 낱말이 칸보다 길면 글자 단위로
export function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width <= maxW) { line = test; continue; }
      if (line) out.push(line);
      if (ctx.measureText(w).width > maxW) {
        let part = '';
        for (const ch of w) {
          if (part && ctx.measureText(part + ch).width > maxW) { out.push(part); part = ch; } else part += ch;
        }
        line = part;
      } else line = w;
    }
    out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}
// 상자에 맞는 글자 크기 찾기 (크게 → 작게). 가장 작게 해도 넘치면 줄을 자르고 … 표시 + overflow 알림
export function fitText(ctx, text, { font, maxW, maxH, maxSize, minSize, lineHeight }) {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = font(size);
    const lines = wrapLines(ctx, text, maxW);
    if (lines.length * size * lineHeight <= maxH) return { size, lines, overflow: false };
  }
  ctx.font = font(minSize);
  const lines = wrapLines(ctx, text, maxW);
  const max = Math.max(1, Math.floor(maxH / (minSize * lineHeight)));
  const cut = lines.slice(0, max);
  if (lines.length > max) cut[max - 1] = cut[max - 1].slice(0, -1) + '…';
  return { size: minSize, lines: cut, overflow: lines.length > max };
}

// 선으로 그리는 아이콘 (24칸 기준)
const ICON_PATHS = {
  check: 'M5 12.5l4.2 4.2L19 7',
  idea: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
  warn: 'M12 4 2.5 20h19L12 4zM12 10v4.5M12 17.2v.3',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
  home: 'M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z',
  money: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6.5 10v4M17.5 10v4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.5 2',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
};
function drawIcon(ctx, name, x, y, size, color) {
  const p = ICON_PATHS[name];
  if (!p || typeof Path2D === 'undefined') return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.lineWidth = 1.9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(p));
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function pill(ctx, text, x, y, bg, ink) {
  ctx.font = FONT_BODY(34, 700);
  const w = ctx.measureText(text).width + 44;
  ctx.fillStyle = bg; roundRect(ctx, x, y, w, 60, 30); ctx.fill();
  ctx.fillStyle = ink; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 22, y + 31); ctx.textBaseline = 'alphabetic';
  return w;
}
function drawLines(ctx, fit, x, y, lineHeight, color, markColor) {
  let yy = y;
  for (const line of fit.lines) {
    yy += fit.size;
    if (markColor && line.trim()) {
      const w = ctx.measureText(line).width;
      ctx.fillStyle = markColor;
      ctx.fillRect(x - 6, yy - fit.size * 0.42, w + 12, fit.size * 0.46);
    }
    ctx.fillStyle = color;
    ctx.fillText(line, x, yy);
    yy += fit.size * (lineHeight - 1);
  }
  return yy;
}
function coverImage(ctx, img, W, H) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.max(W / iw, H / ih);
  ctx.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
}

// 한 장 그리기. deck: {template, ratio, slides:[{title,text,icon}], ad_label}, opt: {scale, bg (그림), adText}
// 돌려줌: { overflow } — 글자가 넘쳐서 잘린 장이 있으면 true (화면에서 줄이라고 알려줌)
export function renderSlide(canvas, deck, i, opt = {}) {
  const [W, H] = SIZES[deck.ratio] || SIZES['4:5'];
  const scale = opt.scale || 1;
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const T = THEMES[deck.template] || THEMES.clean;
  const slides = deck.slides || [];
  const s = slides[i] || { title: '', text: '' };
  const total = slides.length;
  const cover = i === 0;
  const P = 96, maxW = W - P * 2;
  const top = P + 40, bottom = H - P - 70; // 글자가 들어가는 위·아래 끝 (아래는 쪽 번호 자리)
  let overflow = false;
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  const onImage = cover && opt.bg;
  if (onImage) {
    coverImage(ctx, opt.bg, W, H);
    const g = ctx.createLinearGradient(0, H * 0.25, 0, H);
    g.addColorStop(0, 'rgba(10,14,12,0.12)'); g.addColorStop(1, 'rgba(10,14,12,0.84)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else {
    if (cover) { // 표지 장식: 오른쪽 위 큰 원
      ctx.fillStyle = T.soft; ctx.beginPath(); ctx.arc(W - 40, 200, W * 0.36, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = T.accent; ctx.fillRect(P, P - 30, 120, 12);
  }
  const ink = onImage ? '#FFFFFF' : T.ink, muted = onImage ? 'rgba(255,255,255,0.88)' : T.muted;
  if (cover && deck.ad_label) pill(ctx, opt.adText || '광고', P, P + 6, onImage ? '#FFFFFF' : T.pill, onImage ? '#111' : T.pillInk);
  // 쪽 번호
  ctx.font = FONT_BODY(32, 500); ctx.fillStyle = muted; ctx.textAlign = 'right';
  ctx.fillText(`${i + 1} / ${total}`, W - P, H - P + 24); ctx.textAlign = 'left';
  if (cover) {
    const tf = fitText(ctx, s.title || '', { font: FONT_TITLE, maxW, maxH: H * 0.44, maxSize: 128, minSize: 72, lineHeight: 1.16 });
    const sf = s.text ? fitText(ctx, s.text, { font: (px) => FONT_BODY(px, 500), maxW, maxH: H * 0.16, maxSize: 48, minSize: 34, lineHeight: 1.45 }) : null;
    const th = tf.lines.length * tf.size * 1.16, sh = sf ? sf.lines.length * sf.size * 1.45 + 40 : 0;
    let y = bottom - th - sh;
    ctx.font = FONT_TITLE(tf.size);
    y = drawLines(ctx, tf, P, y, 1.16, ink, onImage ? '' : T.mark);
    if (sf) { ctx.font = FONT_BODY(sf.size, 500); drawLines(ctx, sf, P, y + 40, 1.45, muted, ''); }
    overflow = tf.overflow || (sf && sf.overflow);
  } else {
    // 아이콘 + 제목 + 내용을 한 덩어리로 재서, 위·아래 가운데쯤(조금 위)에 놓음
    const iconH = s.icon ? 168 : 0;
    const titleOnly = !String(s.text || '').trim();
    const tf = fitText(ctx, s.title || '', { font: FONT_TITLE, maxW, maxH: H * (titleOnly ? 0.5 : 0.3), maxSize: titleOnly ? 104 : 92, minSize: 56, lineHeight: 1.2 });
    const th = tf.lines.length * tf.size * 1.2;
    const gap = s.text ? 48 : 0;
    const bf = s.text ? fitText(ctx, s.text, { font: (px) => FONT_BODY(px), maxW, maxH: bottom - top - iconH - th - gap, maxSize: 54, minSize: 34, lineHeight: 1.6 }) : null;
    const bh = bf ? bf.lines.length * bf.size * 1.6 : 0;
    const block = iconH + th + gap + bh;
    let y = Math.max(top, Math.round(top + (bottom - top - block) * 0.38));
    if (s.icon) {
      ctx.fillStyle = T.soft; roundRect(ctx, P, y, 120, 120, 28); ctx.fill();
      drawIcon(ctx, s.icon, P + 24, y + 24, 72, T.accent);
      y += iconH;
    }
    ctx.font = FONT_TITLE(tf.size);
    y = drawLines(ctx, tf, P, y, 1.2, ink, T.mark);
    if (bf) { ctx.font = FONT_BODY(bf.size); drawLines(ctx, bf, P, y + gap, 1.6, ink, ''); }
    overflow = tf.overflow || (bf && bf.overflow);
  }
  return { overflow: !!overflow };
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), type, quality));
}

// 나중에 다른 그리기 방법(예: Canva)을 붙일 자리. connected=false 인 것은 화면에 '연결됨'으로 보이지 않음
export const RENDERERS = { builtin: { label: '앱 안 템플릿', connected: true, render: renderSlide } };
