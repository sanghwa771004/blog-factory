// images.js — 이미지 스튜디오 규칙 (앱과 서버가 같은 파일을 씀, 화면 코드 없음)
// 사진 자리 찾기·연결 맞추기, 용도별 비율, AI 프롬프트 만들기, 비용 예상, 파일 검사, 위험 표현 검사, 출처 문구, 카드뉴스 초안
// 서버(Edge Function)에도 같은 파일을 올림: supabase/functions/blog-app/images.js

// ───────── 사진 자리 ─────────
// 본문에서 한 줄 전체가 "[이미지: 설명]" 인 줄 (checks.js 의 countImg 와 같은 기준)
const IMG_LINE = /^\s*\[이미지[^\]]*\]\s*$/;
const normText = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const stripMd = (s) => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/, '').replace(/^[-•*]\s+/, '').replace(/^>\s?/, '').trim();

export const slotTextOf = (line) => String(line || '').trim().replace(/^\[이미지:?\s*|\]$/g, '').trim();
// 같은 설명이 여러 번 나오면 몇 번째인지(occ)로 구분. 설명 없는 '[이미지]'는 '_'
export const slotKey = (text, occ = 1) => 'k:' + (normText(text).slice(0, 150) || '_') + '#' + occ;
export const isExtraKey = (k) => typeof k === 'string' && k.startsWith('x:');

// 본문 밖 이미지 (대표 이미지·SNS용) — 본문 사진 자리와 따로 관리
export const EXTRA_SLOTS = [
  { key: 'x:cover', label: '블로그 대표 이미지', purpose: 'blog_cover', file: 'cover' },
  { key: 'x:threads', label: '쓰레드 게시물 이미지', purpose: 'threads', file: 'threads' },
  { key: 'x:ig_feed', label: '인스타그램 피드 이미지', purpose: 'ig_feed', file: 'instagram' },
  { key: 'x:ig_story', label: '인스타 스토리·릴스 이미지', purpose: 'ig_story', file: 'story' },
];
export const extraSlot = (key) => EXTRA_SLOTS.find((x) => x.key === key) || null;
// 자리의 기본 용도 (본문 자리는 블로그 본문용)
export const slotPurpose = (key) => (extraSlot(key) ? extraSlot(key).purpose : 'blog_body');
// 사진 자리 이름이 올바른지 (본문 자리 'k:…#n' 또는 정해진 본문 밖 자리)
export const validSlotKey = (k) => typeof k === 'string' && k.length <= 220 && (/^k:.+#\d{1,3}$/.test(k) || !!extraSlot(k));

// 본문의 사진 자리 목록 (순서·설명·주변 맥락)
export function parseSlots(body) {
  const lines = String(body || '').split('\n');
  const out = [];
  const seen = new Map();
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const l = raw.trim();
    if (/^#{1,4}\s/.test(l)) { heading = stripMd(l); continue; }
    if (!IMG_LINE.test(raw)) continue;
    const text = slotTextOf(l);
    const k = normText(text).slice(0, 150) || '_';
    const occ = (seen.get(k) || 0) + 1;
    seen.set(k, occ);
    const near = (from, step) => {
      for (let j = from; j >= 0 && j < lines.length && Math.abs(j - i) <= 6; j += step) {
        const t = lines[j].trim();
        if (!t || IMG_LINE.test(lines[j]) || /^\[(링크|내 경험)/.test(t) || /^\|/.test(t)) continue;
        if (/^#{1,4}\s/.test(t)) return ''; // 다른 소제목을 넘어가지 않음
        return stripMd(t);
      }
      return '';
    };
    out.push({ index: out.length, n: out.length + 1, text, key: slotKey(text, occ), heading, before: near(i - 1, -1), after: near(i + 1, 1), line: i });
  }
  return out;
}

// 글자 두 개씩 겹치는 정도 (0~1) — 설명을 조금 고쳐도 같은 자리로 알아보려고
function bigrams(s) {
  const t = normText(s).replace(/\s+/g, '');
  const m = new Map();
  for (let i = 0; i + 2 <= t.length; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  return { m, n: Math.max(0, t.length - 1) };
}
const simOf = (a, b, A, B) => {
  if (!A.n || !B.n) return normText(a) && normText(a) === normText(b) ? 1 : 0;
  let inter = 0;
  for (const [g, c] of A.m) inter += Math.min(c, B.m.get(g) || 0);
  return (2 * inter) / (A.n + B.n);
};
export function textSimilarity(a, b) { return simOf(a, b, bigrams(a), bigrams(b)); }
// 같은 글을 여러 번 비교할 때 (사진 자리 맞추기) — 글자 쌍 목록을 한 번만 만듦
function similarityCache() {
  const bg = new Map(), memo = new Map();
  const big = (t) => { let x = bg.get(t); if (!x) { x = bigrams(t); bg.set(t, x); } return x; };
  return (a, b) => {
    const k = a + '\u0001' + b;
    let v = memo.get(k);
    if (v === undefined) { v = simOf(a, b, big(a), big(b)); memo.set(k, v); }
    return v;
  };
}

// 자리 주변 글(소제목·앞뒤 문장). 연결할 때 같이 저장해 두고, 같은 설명이 여러 번 있거나 설명을 고쳐도 같은 자리를 알아보는 데 씀
export const ctxOf = (s) => String([s && s.heading, s && s.before, s && s.after].filter(Boolean).join(' | ')).replace(/\s+/g, ' ').trim().slice(0, 300);
const baseOf = (key) => String(key || '').replace(/#\d+$/, '');
const occOf = (key) => Number((/#(\d+)$/.exec(String(key || '')) || [])[1] || 0);
// 서버가 잠깐 비켜 둔 줄(사라진 자리 'k:~~…')은 열쇠 대신 저장된 설명으로 원래 묶음을 찾음
const isParked = (key) => /^k:~~/.test(String(key || ''));
const rowBase = (r) => (isParked(r.slot_key) ? 'k:' + (normText(r.slot_text).slice(0, 150) || '_') : baseOf(r.slot_key));

// 주변 글 점수(V)로 가장 잘 맞는 짝 (순서 상관없이). 작은 묶음(7개 이하)에서만 씀 — 같은 점수면 앞의 짝(=순서대로)을 고름
function bestAssign(V, n, m) {
  const rowsFirst = n <= m;
  const A = rowsFirst ? n : m, B = rowsFirst ? m : n;
  const val = (a, b) => (rowsFirst ? V[a][b] : V[b][a]) ?? 0;
  const usedB = new Array(B).fill(false);
  const cur = [];
  let best = -1, pairs = [];
  const rec = (a, sum) => {
    if (a === A) { if (sum > best + 1e-9) { best = sum; pairs = cur.slice(); } return; }
    for (let b = 0; b < B; b++) {
      if (usedB[b]) continue;
      usedB[b] = true; cur.push(rowsFirst ? [a, b] : [b, a]);
      rec(a + 1, sum + val(a, b));
      cur.pop(); usedB[b] = false;
    }
  };
  rec(0, 0);
  return { sum: best, pairs };
}
// 같은 설명끼리 짝짓기 (S = 지금 자리들, R = 저장된 줄들, V = 주변 글이 비슷한 정도 0~1, 주변 글을 저장 안 한 줄은 null)
// 1) 확실한 짝 먼저: 주변 글이 거의 그대로(0.9 이상)이고 다른 후보보다 뚜렷이(0.1 넘게) 나은 짝 —
//    문단째 옮기거나, 같은 설명의 다른 자리를 지우거나 새로 넣어도 그 자리는 제 이미지를 지킴 (순서가 바뀌어도 됨)
// 2) 나머지는 순서를 지키며 짝지음 (1의 짝들과도 앞뒤가 맞게). 단 주변 글이 꽤 다르면(0.5 미만) 몇 번째인지(키)가 같을 때만 —
//    주변 문장만 새로 쓴 자리(AI가 다시 씀)는 그대로 두고, 지운 자리의 이미지를 다른 자리에 붙이지 않음 (사라진 자리로 남김)
// 3) 나머지끼리 순서를 바꾸는 게 주변 글로 확실하면(바뀌는 짝마다 0.6 이상, 0.3 넘게 나음) 바꿈 — 문단을 옮기면서 문장도 조금 고친 경우 (7개 이하일 때)
function matchGroup(S, R, ctxSim) {
  // 저장된 줄은 예전 본문 순서대로 (서버가 맞출 때마다 slot_index 를 고쳐 둠, 같으면 몇 번째인지로)
  const rs = [...R].sort((a, b) => Number(a.slot_index ?? 0) - Number(b.slot_index ?? 0) || occOf(a.slot_key) - occOf(b.slot_key));
  const n = S.length, m = rs.length;
  const V = S.map((s) => rs.map((r) => ctxSim(s, r)));
  const v = (i, j) => V[i][j] ?? 0;
  const key = (i, j) => rs[j].slot_key === S[i].key;
  const out = [], uS = new Set(), uR = new Set();
  // 1) 확실한 짝
  const cand = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if (V[i][j] != null && V[i][j] >= 0.9) cand.push([V[i][j] + (key(i, j) ? 0.001 : 0), i, j]);
  cand.sort((a, b) => b[0] - a[0]);
  // 아직 안 묶인 다른 강한 후보(0.9 이상)와 0.1 안으로 비슷하면 애매해서 넘김 (예: 주변 글이 같은, 바로 붙은 두 자리)
  // (후보는 점수가 높은 순이라 자리·줄마다 목록 앞에서부터 아직 안 묶인 첫 후보만 보면 됨)
  const byS = Array.from({ length: n }, () => []), byR = Array.from({ length: m }, () => []);
  for (const c of cand) { byS[c[1]].push(c); byR[c[2]].push(c); }
  const firstFree = (list, i, j) => { for (const [, ii, jj] of list) if (!(ii === i && jj === j) && !uS.has(ii) && !uR.has(jj)) return V[ii][jj]; return 0; };
  const rival = (i, j) => Math.max(firstFree(byS[i], i, j), firstFree(byR[j], i, j));
  for (const [, i, j] of cand) {
    if (uS.has(i) || uR.has(j) || V[i][j] - rival(i, j) < 0.1) continue;
    uS.add(i); uR.add(j); out.push([i, j]);
  }
  // 2) 나머지는 순서대로
  const Si = [...Array(n).keys()].filter((i) => !uS.has(i)), Rj = [...Array(m).keys()].filter((j) => !uR.has(j));
  // 비켜 둔 줄은 주변 글이 맞을 때만 다시 씀 (주변 글이 없으면 다시 쓰지 않음 — 지운 자리의 이미지가 다른 자리로 가지 않게)
  const ok = (i, j) => key(i, j) || (V[i][j] == null ? !isParked(rs[j].slot_key) : V[i][j] >= 0.5);
  // 확실한 짝들과 앞뒤가 엇갈리는 짝은 주변 글이 꽤 비슷할 때(0.75 이상 — 문단을 옮기면서 조금 고친 경우)만 씀
  // (예: 맨 앞 문단을 지우고 맨 뒤에 비슷한 틀의 새 문단을 넣었을 때 지운 문단의 이미지가 새 문단으로 가지 않게)
  const fits = (i, j) => v(i, j) >= 0.75 || out.every(([ia, ja]) => (i < ia) === (j < ja));
  const w = (i, j) => (ok(i, j) && fits(i, j)
    ? 0.5 + (V[i][j] ?? 0.5) + (key(i, j) ? 0.35 : 0) + (rs[j].image_id ? 0.15 : 0) - 0.01 * Math.min(Math.abs(Number(rs[j].slot_index ?? 0) - S[i].index), 20)
    : -1);
  const a = Si.length, b = Rj.length;
  const f = Array.from({ length: a + 1 }, () => new Array(b + 1).fill(0));
  for (let x = 1; x <= a; x++) for (let y = 1; y <= b; y++) f[x][y] = Math.max(f[x - 1][y], f[x][y - 1], f[x - 1][y - 1] + w(Si[x - 1], Rj[y - 1]));
  let rest = [];
  for (let x = a, y = b; x > 0 && y > 0;) {
    const ww = w(Si[x - 1], Rj[y - 1]);
    if (ww > 0 && f[x][y] === f[x - 1][y - 1] + ww) { rest.push([Si[x - 1], Rj[y - 1]]); x--; y--; }
    else if (f[x][y] === f[x - 1][y]) x--;
    else y--;
  }
  // 3) 나머지끼리 순서 바꾸기
  if (rest.length >= 2 && Math.max(a, b) <= 7 && Rj.every((j) => rs[j].slot_ctx)) {
    const best = bestAssign(Si.map((i) => Rj.map((j) => V[i][j])), a, b);
    const mapped = best.pairs.map(([x, y]) => [Si[x], Rj[y]]);
    const sumOf = (ps) => ps.reduce((t, [i, j]) => t + v(i, j), 0);
    const inRest = new Set(rest.map(([i, j]) => i + ':' + j));
    const diff = mapped.filter(([i, j]) => !inRest.has(i + ':' + j));
    if (mapped.length === rest.length && diff.length && diff.every(([i, j]) => v(i, j) >= 0.6 && fits(i, j)) && sumOf(mapped) - sumOf(rest) >= 0.3 * diff.length) rest = mapped;
  }
  return [...out, ...rest].map(([i, j]) => [S[i], rs[j]]);
}

// 서버가 이대로 옮긴 뒤 다음에 다시 맞춰도 결과가 같게: 옮긴 뒤의 모습(짝지은 줄 = 그 자리의 열쇠·주변 글, 그 열쇠를 쓰던 안 짝지은 줄 = 비켜 둠·빈 줄은 지워짐)으로
// 한 번 더 맞춰 보고, 달라지면 그 결과를 씀 (최대 3번). 그래서 한 번 저장할 때 한 번에 자리를 잡음
function matchGroupStable(S, R, ctxSim) {
  let pairs = matchGroup(S, R, ctxSim);
  for (let it = 0; it < 3; it++) {
    const slotOf = new Map(pairs.map(([s, r]) => [r, s]));
    const taken = new Map(pairs.map(([s, r]) => [s.key, r]));
    const virt = [];
    R.forEach((r, k) => {
      const s = slotOf.get(r);
      if (s) { virt.push({ ...r, slot_key: s.key, slot_index: s.index, slot_ctx: ctxOf(s) || r.slot_ctx, __r: r }); return; }
      const other = taken.get(r.slot_key);
      if (other && other !== r) { if (r.image_id) virt.push({ ...r, slot_key: `k:~~v${k}#1`, __r: r }); return; }
      virt.push({ ...r, __r: r });
    });
    const again = matchGroup(S, virt, ctxSim).map(([s, x]) => [s, x.__r]);
    const same = again.length === pairs.length && again.every(([s, r]) => slotOf.get(r) === s);
    if (same) break;
    pairs = again;
  }
  return pairs;
}

// 저장된 연결(rows)을 지금 본문의 사진 자리에 맞춤.
// 1) 설명이 같은 자리끼리 — matchGroup (주변 글이 확실한 짝 먼저, 나머지는 순서대로)
// 2) 설명을 고친 자리 — 설명이 비슷하거나, 설명은 달라도 같은 위치에 주변 글이 그대로면 연결을 옮김(rekey). 설명이 같은 자리끼리는 1)에서만 정함
// 3) 본문에서 사라진 자리의 연결은 지우지 않고 orphans 로 돌려줌 (이미지는 보관함에 그대로)
export function matchSlots(current, rows) {
  const stored = (rows || []).filter((r) => r && !isExtraKey(r.slot_key));
  const used = new Set();
  const slots = (current || []).map((c) => ({ ...c, link: null, rekey: null }));
  const sim = similarityCache();
  const ctxS = new Map(slots.map((s) => [s, ctxOf(s)]));
  const ctxSim = (s, r) => (r.slot_ctx ? sim(ctxS.get(s) ?? ctxOf(s), r.slot_ctx) : null);
  const take = (s, r) => { used.add(r.slot_key); s.link = r; s.rekey = r.slot_key === s.key ? null : { from: r.slot_key, to: s.key }; };
  const assign = (pairs) => {
    pairs.sort((x, y) => y[0] - x[0]);
    for (const [, s, r] of pairs) if (!s.link && !used.has(r.slot_key)) take(s, r);
  };
  // 1) 같은 설명
  const groups = new Map();
  for (const s of slots) {
    const b = baseOf(s.key);
    if (!groups.has(b)) groups.set(b, { S: [], R: [] });
    groups.get(b).S.push(s);
  }
  for (const r of stored) { const g = groups.get(rowBase(r)); if (g) g.R.push(r); }
  for (const { S, R } of groups.values()) if (R.length) for (const [s, r] of matchGroupStable(S, R, ctxSim)) take(s, r);
  // 2) 설명을 고친 자리 (이미지가 있는 연결만)
  const pairs2 = [];
  for (const s of slots) {
    if (s.link) continue;
    for (const r of stored) {
      if (used.has(r.slot_key) || !r.image_id || rowBase(r) === baseOf(s.key)) continue;
      const ts = sim(s.text, r.slot_text);
      const cx = ctxSim(s, r);
      const near = Number(r.slot_index) === s.index;
      const ok = ts >= 0.55 || (near && ts >= 0.35) || (cx != null && cx >= 0.6 && (near || ts >= 0.2));
      if (ok) pairs2.push([ts + (near ? 0.1 : 0) + (cx != null ? cx * 0.5 : 0), s, r]);
    }
  }
  assign(pairs2);
  const orphans = stored.filter((r) => !used.has(r.slot_key) && r.image_id);
  // 옮길 자리(to)를 지금 다른 줄이 쓰고 있으면 알려줌 (서버가 그 줄을 먼저 비켜 놓고 옮김)
  const linkedKeys = new Set(slots.filter((s) => s.link).map((s) => s.link.slot_key));
  const blockers = stored.filter((r) => !linkedKeys.has(r.slot_key) && slots.some((s) => s.rekey && s.rekey.to === r.slot_key));
  return {
    slots, orphans, blockers,
    rekeys: slots.filter((s) => s.rekey).map((s) => ({ ...s.rekey, index: s.index, text: s.text, ctx: ctxOf(s) })),
  };
}

// matchSlots 결과를 DB에서 실행할 순서로 바꿈 (서버가 이 순서대로 image_slot_rekey·줄 고치기를 부름)
// 1) 옮길 자리를 차지한, 연결이 끊긴 이미지 줄은 '사라진 자리' 이름으로 비켜 둠 (빈 줄은 옮길 때 지워짐)
// 2) 옮기기 — 여러 개면 서로 자리를 바꾸는 경우가 있어서 임시 이름을 거쳐 두 번에 (1단계가 실패한 건 2단계를 건너뜀)
// 3) 순서만 바뀐 자리는 번호를, 주변 글이 바뀐 자리는 주변 글을 고침
// tmp(tag, n): 임시 이름 만들기 (서버는 무작위 값을 섞음)
export function planSlotSync(m, tmp = (tag, n) => `k:~~${tag}${n}#1`) {
  const ops = [];
  let n = 0;
  for (const bl of (m && m.blockers) || []) if (bl.image_id) ops.push({ op: 'rekey', p: { from: bl.slot_key, to: tmp('o', n++) } });
  const rk = (m && m.rekeys) || [];
  if (rk.length === 1) ops.push({ op: 'rekey', p: rk[0], final: true });
  else if (rk.length > 1) {
    const t = rk.map((r) => ({ ...r, tmp: tmp('t', n++) }));
    for (const r of t) ops.push({ op: 'rekey', p: { from: r.from, to: r.tmp }, key: r.tmp });
    for (const r of t) ops.push({ op: 'rekey', p: { from: r.tmp, to: r.to, index: r.index, text: r.text, ctx: r.ctx }, after: r.tmp, final: true });
  }
  for (const s of (m && m.slots) || []) {
    if (!s.link || s.rekey) continue;
    const patch = {};
    if (Number(s.link.slot_index) !== s.index) patch.slot_index = s.index;
    const ctx = ctxOf(s);
    if (ctx && s.link.slot_ctx !== ctx) patch.slot_ctx = ctx;
    if (Object.keys(patch).length) ops.push({ op: 'update', id: s.link.id, patch });
  }
  return ops;
}

// ───────── 용도·비율 ─────────
// size = AI에 요청할 크기 (16의 배수, 비율 1:3~3:1, 총 픽셀 655,360 이상 — OpenAI 공식 문서 기준, 2026-10-22 확인)
// out = 내려받을 때 만드는 크기 (원본이 더 작으면 원본 크기)
export const RATIOS = {
  '16:9': { w: 16, h: 9, size: '1536x864' },
  '4:3': { w: 4, h: 3, size: '1280x960' },
  '1:1': { w: 1, h: 1, size: '1024x1024' },
  '4:5': { w: 4, h: 5, size: '1024x1280' },
  '9:16': { w: 9, h: 16, size: '864x1536' },
};
export const PURPOSES = {
  blog_body: { label: '블로그 본문용', ratios: ['4:3', '16:9'], out: 1600 },
  blog_cover: { label: '블로그 대표 이미지', ratios: ['16:9'], out: 1600 },
  threads: { label: '쓰레드 게시물용', ratios: ['4:5', '1:1'], out: 1080 },
  ig_feed: { label: '인스타그램 피드용', ratios: ['4:5', '1:1'], out: 1080 },
  ig_story: { label: '인스타 스토리·릴스용', ratios: ['9:16'], out: 1080 },
  cards: { label: '카드뉴스용', ratios: ['4:5', '1:1'], out: 1080 },
  general: { label: '일반 삽화용', ratios: ['1:1', '4:3'], out: 1600 },
  // 1.5.1: 상품 사진으로 장면 만들기의 제작 목적 (상품 상세 소개·광고용 연출)
  product_detail: { label: '상품 상세 소개용', ratios: ['1:1', '4:5', '4:3'], out: 1200 },
  ad_creative: { label: '광고용 연출 이미지', ratios: ['1:1', '4:5', '16:9'], out: 1600 },
};
export const ratioOf = (purpose, ratio) => {
  const p = PURPOSES[purpose] || PURPOSES.blog_body;
  return p.ratios.includes(ratio) ? ratio : p.ratios[0];
};
// AI에 요청할 크기. 임의 크기를 못 받는 모델은 표준 크기 세 가지 중 방향이 같은 것으로 만들고, 내려받을 때 비율대로 자름
export const STANDARD_SIZES = ['1024x1024', '1536x1024', '1024x1536'];
export const standardSizeFor = (ratio) => { const R = RATIOS[ratio] || RATIOS['1:1']; return R.w > R.h ? '1536x1024' : R.w < R.h ? '1024x1536' : '1024x1024'; };
// quality: Gemini처럼 품질 대신 해상도(1K·2K·4K)를 고르는 모델에서만 씀 → '비율@해상도' (예: 16:9@2K)
export const sizeFor = (purpose, ratio, model, quality) => {
  const r = ratioOf(purpose, ratio);
  const c = model ? modelCaps(model) : null;
  if (c && c.aspect) { const sz = c.imageSizes ? c.imageSizes[normQuality(model, quality || 'medium')] : ''; return sz ? `${r}@${sz}` : r; }
  if (c && c.sizes) return c.sizes[r] || c.sizes['1:1'];   // 비율별로 정해 둔 크기로 바로 만드는 모델 (자를 필요 없음)
  if (c && c.fixedSize) return c.fixedSize;
  return model && !modelCaps(model).flexible ? standardSizeFor(r) : RATIOS[r].size;
};
// 크기 문자열이 OpenAI 규칙에 맞는지 (16의 배수, 비율, 한 변·총 픽셀)
export function validApiSize(size) {
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(String(size || ''));
  if (!m) return false;
  const w = Number(m[1]), h = Number(m[2]);
  if (w % 16 || h % 16) return false;
  if (w > 3840 || h > 3840) return false;
  const r = w / h;
  if (r < 1 / 3 || r > 3) return false;
  const px = w * h;
  return px >= 655360 && px <= 8294400;
}

// 원본(sw×sh)에서 목표 비율로 자를 영역. focus = 중심으로 둘 지점(0~1). 자를 필요가 없으면 전체
export function cropRect(sw, sh, ratio, focus) {
  const R = RATIOS[ratio] || RATIOS['1:1'];
  const target = R.w / R.h;
  const fx = Math.min(1, Math.max(0, Number(focus && focus.x != null ? focus.x : 0.5)));
  const fy = Math.min(1, Math.max(0, Number(focus && focus.y != null ? focus.y : 0.5)));
  let w = sw, h = sh;
  if (sw / sh > target) w = Math.round(sh * target); else h = Math.round(sw / target);
  const x = Math.round(Math.min(Math.max(fx * sw - w / 2, 0), sw - w));
  const y = Math.round(Math.min(Math.max(fy * sh - h / 2, 0), sh - h));
  return { x, y, w, h };
}
// 자르고 줄인 결과 크기 (가로 기준 maxW, 원본보다 크게 늘리지 않음)
export function outputSize(rect, maxW) {
  const scale = Math.min(1, (maxW || rect.w) / rect.w);
  return { w: Math.max(1, Math.round(rect.w * scale)), h: Math.max(1, Math.round(rect.h * scale)) };
}
// 이미 그 비율이면(1% 안) 자를 필요 없음
export const sameRatio = (w, h, ratio) => { const R = RATIOS[ratio]; return !!R && w > 0 && h > 0 && Math.abs(w / h - R.w / R.h) / (R.w / R.h) < 0.01; };
// 자르는 곳을 저장하지 않았을 때 내려받을 비율: 만들 때 고른 비율(img.ratio — 정해진 크기로만 만드는 모델) → 이미 그 용도의 비율인 이미지면 그대로 → 용도의 첫 비율
export function defaultRatio(img, purpose) {
  const p = PURPOSES[purpose] || PURPOSES.blog_body;
  if (img && p.ratios.includes(img.ratio)) return img.ratio;
  const w = Number(img && img.width), h = Number(img && img.height);
  return (w && h && p.ratios.find((r) => sameRatio(w, h, r))) || p.ratios[0];
}
// 사진 검색 방향 (Pexels orientation)
export const orientationFor = (ratio) => { const R = RATIOS[ratio]; return !R ? '' : R.w > R.h ? 'landscape' : R.w < R.h ? 'portrait' : 'square'; };

// ───────── 이미지 종류(프리셋)·장면 설계서·프롬프트 (1.5.0) ─────────
// 1.4.0까지는 모든 이미지에 'illustrative image'와 같은 생활 사진 규칙(가운데 두기 등)을 똑같이 붙였음.
// 1.5.0: 이미지 종류(실사 사진·일러스트·도식·카드뉴스 배경)마다 프롬프트를 따로 만들고, 프리셋마다 구도·빛·질감·피할 것을 다르게 줌.
// 먼저 '장면 설계서'(buildScene, JSON)를 만들고 → 그걸로 공급자에 보낼 글(promptFromScene)을 만듦. 설계서는 생성 기록에 같이 저장.
// 계절·날씨·시간·장소·나라는 원고(사진 자리 설명·소제목·제목, 계절 등은 앞뒤 문장까지)에 있을 때만 넣음 — 없으면 '넣지 마'라고 적음.
export const IMAGE_TYPES = { photo: '실사 사진', illustration: '일러스트', diagram: '정보 도식', card_bg: '카드뉴스 배경' };
const TYPE_EN = { photo: 'Photograph', illustration: 'Illustration', diagram: 'Information diagram', card_bg: 'Background image for a social media card' };
// 프리셋: 화면·장면 설계서에는 한국어로 보여주고 고칠 수 있게, 공급자에는 render(영어 한 줄) + 한국어 값으로 보냄
export const PRESETS = {
  life_photo: {
    label: '자연스러운 생활 사진', type: 'photo',
    hint: '일상에서 실제로 찍은 듯한 사진. 생활 정보·사용법 글 본문에 무난해.',
    render: 'A believable everyday photograph of a real moment, the way a person would take it in daily life. Not an advertisement.',
    camera: '눈높이나 살짝 위, 35~50mm 표준 화각, 중간 거리',
    light: '그 자리의 자연광이나 평범한 실내 조명, 부드러운 그림자',
    color: '실제와 같은 색, 중립적인 화이트 밸런스',
    materials: '물건마다 실제 재질 그대로의 질감',
    composition: '자연스럽고 지나치게 반듯하지 않은 구도, 피사체가 답답하지 않게',
    avoid: ['스튜디오 조명', '광고 사진처럼 번쩍이는 연출', '지나치게 완벽한 대칭'],
  },
  documentary: {
    label: '다큐멘터리·현장 사진풍', type: 'photo',
    hint: '현장을 지켜보듯 찍은 사진. 최신 정보·장소·현장 이야기에 맞아.',
    render: 'An observational documentary photograph of a real, unposed situation.',
    camera: '눈높이, 28~35mm 넓은 화각, 주변 상황이 같이 보이는 거리',
    light: '현장의 빛 그대로 (여러 빛이 섞여도 됨), 플래시 없음',
    color: '꾸미지 않은 담백한 색, 고운 입자감은 괜찮음',
    materials: '현장의 실제 재질',
    composition: '장소의 선과 앞·뒤 층을 살린 구도. 사람은 장면에 꼭 필요할 때만, 뒷모습이나 옆모습으로',
    avoid: ['포즈 잡은 모델', '연출한 소품', '과한 보정'],
  },
  editorial: {
    label: '고급 편집 디자인 사진', type: 'photo',
    hint: '잡지 화보처럼 정돈된 사진. 대표 이미지나 분위기가 중요한 자리에.',
    render: 'A refined editorial photograph for a magazine-style layout.',
    camera: '정면이나 3/4 시점, 50~85mm, 반듯한 원근',
    light: '한쪽에서 오는 부드러운 방향광, 은은하게 떨어지는 그림자',
    color: '2~3가지 색으로 절제한 톤',
    materials: '고급스럽게 보이는 실제 재질, 선명한 디테일',
    composition: '한쪽에 의도한 여백(나중에 글을 얹을 자리), 비대칭 균형',
    avoid: ['어수선한 배경', '과한 소품'],
  },
  product_still: {
    label: '제품 정물 사진', type: 'photo',
    hint: '제품 하나를 깔끔하게 보여주는 사진. 실제 제품이면 참고 사진(제품 모양 유지)을 꼭 넣어줘.',
    render: 'A product still-life photograph.',
    camera: '3/4 앞모습이나 정면, 50~100mm, 왜곡 적게',
    light: '창가나 큰 소프트박스 같은 넓고 부드러운 주광 + 약한 보조광, 바닥에 닿는 그림자',
    color: '제품 고유의 색 그대로, 중립적인 배경',
    materials: '제품의 재질·마감 그대로',
    composition: '제품이 잘리지 않고 다 보이게 여유 있는 여백, 제품에 초점',
    avoid: ['없는 부품·버튼 만들기', '가짜 라벨·글자', '제품 모양 바꾸기'],
  },
  food: {
    label: '음식 사진', type: 'photo',
    hint: '식탁 위 음식을 자연스럽게. 레시피·맛집·간식 글에.',
    render: 'A natural, appetizing but realistic food photograph.',
    camera: '음식에 맞게 45도 위나 바로 위에서, 가까운~중간 거리',
    light: '옆에서 들어오는 부드러운 창가 빛, 자연스러운 반사',
    color: '먹음직스럽지만 실제 같은 색 (과하게 진하지 않게)',
    materials: '음식 본래의 질감, 그릇·식탁 재질',
    composition: '음식이 주인공, 소품은 적게, 식탁이나 조리대 위',
    avoid: ['플라스틱 같은 음식', '실제로 없을 장식', '뜨거운 음식이 아닌데 김 나는 것'],
  },
  pet: {
    label: '반려동물 일상 사진', type: 'photo',
    hint: '반려동물의 평소 모습. 몸 생김새가 자연스러운지 꼭 확인해.',
    render: 'A natural everyday photograph of a pet.',
    camera: '동물 눈높이, 35~85mm, 빠른 셔터 느낌 (움직이는 장면이 아니면 흔들림 없이)',
    light: '부드러운 자연광',
    color: '털·눈 색 그대로',
    materials: '털의 결, 주변 물건의 실제 재질',
    composition: '얼굴과 자세가 잘 보이게, 주변에 숨 쉴 여백',
    avoid: ['다리·발가락 개수가 틀린 몸', '사람처럼 꾸민 표정', '말하지 않은 옷·소품'],
  },
  explainer: {
    label: '설명용 일러스트', type: 'illustration',
    hint: '원리·방법을 그림으로 쉽게. 글자는 넣지 않아.',
    render: 'A clear explanatory illustration in a clean flat vector style.',
    camera: '단순한 정면이나 아이소메트릭 시점',
    light: '평평한 조명, 사진 같은 그림자 없음',
    color: '대비가 좋은 3~5가지 색',
    materials: '단순한 도형, 일정한 선 굵기',
    composition: '한 그림에 생각 하나, 넉넉한 간격, 깔끔한 배경',
    avoid: ['사진처럼 보이는 질감', '복잡한 배경'],
  },
  diagram: {
    label: '정보 전달용 도식', type: 'diagram',
    hint: '순서·구조·비교를 아이콘·화살표로. 글자는 나중에 앱(카드뉴스)이나 본문으로.',
    render: 'An information diagram made of simple schematic shapes, icons and arrows.',
    camera: '평면(2D)이나 아이소메트릭',
    light: '평평한 조명',
    color: '대비가 높은 2~4가지 색',
    materials: '단순한 아이콘과 선',
    composition: '읽는 순서가 분명하게 (왼쪽→오른쪽 또는 위→아래), 격자에 맞춘 정렬, 나중에 글을 얹을 빈칸',
    avoid: ['사진 같은 장면', '장식만 많은 그림'],
  },
  card_bg: {
    label: '카드뉴스 배경', type: 'card_bg',
    hint: '카드뉴스 글자 뒤에 깔 배경. 글자는 앱이 얹어.',
    render: 'A calm background image for a social media card; text will be placed on it later.',
    camera: '평면적이고 단순한 시점',
    light: '부드럽고 고른 빛',
    color: '서로 어울리는 차분한 색, 글자가 잘 읽히는 밝기',
    materials: '단순한 질감이나 은은한 사진 배경',
    composition: '위쪽이나 가운데에 글자가 올라갈 넓고 조용한 공간, 볼거리는 가장자리에',
    avoid: ['복잡한 무늬', '가운데를 가리는 물체'],
  },
};
export const STYLES = PRESETS; // 예전 이름 (1.4.0까지 '스타일')
export const DEFAULT_STYLE = 'life_photo';
// 1.4.0 스타일 이름 → 1.5.0 프리셋 (예전 생성 기록으로 '다시 만들기' 할 때)
export const STYLE_ALIAS = { product_bg: 'editorial', warm_info: 'explainer', compare_bg: 'diagram', ig_card: 'card_bg' };
export const presetOf = (id) => (PRESETS[id] ? id : STYLE_ALIAS[id] && PRESETS[STYLE_ALIAS[id]] ? STYLE_ALIAS[id] : DEFAULT_STYLE);
export const validPreset = (id) => !!(id && (PRESETS[id] || STYLE_ALIAS[id]));

// 원고 내용으로 프리셋 추천 (사용자가 바꿀 수 있음)
const PET_RE = /강아지|고양이|반려(동물|견|묘)|댕댕|냥이|애견|애묘|햄스터|앵무|(?<![가-힣])토끼|강쥐|퍼피/;
const FOOD_RE = /음식|요리|반찬|국물|찌개|김치|밥상|도시락|라면|레시피|간식|디저트|과일|(?<![가-힣])빵|소금빵|케이크|떡볶이|(?<![가-힣])떡|커피(?!\s?(머신|메이커|포트))|차 한 잔|한 끼|식사/;
const DIAGRAM_RE = /도식|구조도|원리|순서도|흐름도|단계별|과정|비교표|그래프|차트|구성도|배치도|작동\s?방식/;
const PRODUCT_RE = /제품|상품|정면|외관|본체|구성품|패키지|박스/;
export function recommendPreset({ post, slot, text, purpose } = {}) {
  const t = [text != null && String(text).trim() ? text : slot && slot.text, slot && slot.heading].filter(Boolean).join(' ');
  if (purpose === 'cards') return { id: 'card_bg', why: '카드뉴스에 쓸 배경이라' };
  if (PET_RE.test(t)) return { id: 'pet', why: '반려동물이 나오는 자리라' };
  if (FOOD_RE.test(t)) return { id: 'food', why: '음식이 나오는 자리라' };
  if (DIAGRAM_RE.test(t)) return { id: 'diagram', why: '원리·순서·구조를 보여주는 자리라' };
  if (PRODUCT_RE.test(t)) return { id: 'product_still', why: '제품 모습이 중심인 자리라' };
  if (purpose === 'blog_cover') return { id: 'editorial', why: '대표 이미지라' };
  if (post && post.content_type === 'news_summary') return { id: 'documentary', why: '최신 정보 글이라' };
  return { id: 'life_photo', why: '일상 장면이라' };
}

// ── 원고에서 읽는 맥락 (있을 때만) ──
// [찾을 말, 한국어, 영어, 한국을 뜻하는지]
const SEASON_AFTER = '(?=철|맞이|날|시즌|에|이|의|은|엔|을|도|용|\\s|$|[,.·)!?~])';
// '봄'은 '써 봄'·'해 봄'·'먹어 봄'처럼 말끝에도 쓰여서, 뒤에 계절을 뜻하는 말이 붙을 때만, 그리고 앞 낱말이 '써·해·먹어'처럼
// 동사(…해 봄)가 아닐 때만 (1.5.0 검토). '올해 봄'·'새 봄'처럼 앞 낱말이 이름씨면 계절
const SPRING_AFTER = '(?=철|맞이|날|시즌|나들이|에|이|의|은|엔|을|도|용|과|·|,|\\s(?:시즌|철|나들이|날씨|맞이|코디|대청소|이사|신상|분위기|풍경|햇살|햇볕|꽃|여행|감성|소풍|피크닉|산책|패션|아우터|코트|재킷|자켓|원피스|인테리어|바람|비|하늘|데이트|축제|정원|가드닝|휴가|방학|새\\s?학기|학기|캠핑|등산|드라이브|향기|컬러|색|메이크업|네일|알레르기|환절기|미세먼지))';
const VERB_BEFORE_SPRING = '(?<!(?:(?<![가-힣])(?:써|해|봐|가|사|와|줘|타|켜|꺼|돼|쳐|져|펴|자)|[가-힣](?:어|아|여|워|셔|라|러|려))\\s)';
const CTX_SEASON = [
  [new RegExp(`(?<![가-힣])${VERB_BEFORE_SPRING}봄${SPRING_AFTER}|봄(?:비|바람|꽃|볕|밤)|올봄|초봄|늦봄|이른\\s?봄|벚꽃|꽃샘추위`), '봄', 'spring'],
  // 여름·가을·겨울은 다른 뜻으로 거의 안 쓰여서 붙은 말과 상관없이 ('가을비'·'여름휴가'·'겨울바람'도)
  [/여름|폭염|무더위|열대야/, '여름', 'summer'],
  [/가을|단풍/, '가을', 'autumn'],
  [/겨울|한파|첫눈|동파/, '겨울', 'winter'],
  [/김장/, '김장철', 'early winter (kimchi-making season)', true],
  [/장마/, '장마철', 'rainy season'],
  [/크리스마스|성탄절/, '크리스마스', 'Christmas season'],
  [/설날|설\s?연휴|추석|명절/, '명절', 'a Korean holiday season', true],
  [/연말|송년|새해|신년/, '연말연시', 'year-end holidays'],
  [/환절기/, '환절기', 'change of seasons'],
];
// 앞에 다른 글자가 붙은 말('대비가 오히려'·'준비가')·눈을 뜻하는 말('눈길을 끄는'·'눈이 오래')은 날씨로 안 봄 (1.5.0 검토)
// '와'·'온'은 뒤에 말끝이 올 때만 ('눈이 와서'·'비가 온 날'은 날씨, '눈이 온통'·'눈이 와닿는'은 아님)
const COME = '(?:오(?:는|면|고|던|니|기|다|자|길|네|겠)|와(?=서|요|도|야|\\s|$|[,.!?~])|온(?=다|\\s|$|[,.!?~])|왔|올\\s?때|내리)';
const CTX_WEATHER = [
  [new RegExp(`(?<![가-힣])비\\s?(?:오는|내리는|올\\s?때|소식)|(?<![가-힣])비가\\s?${COME}|(?:봄|여름|가을|겨울|장맛|소낙|이슬|가랑|보슬|여우)비|빗(?:물|방울|소리)|빗길|폭우|소나기`), '비', 'rain'],
  [new RegExp(`(?<![가-힣])눈\\s?(?:오는|내리는|올\\s?때)|(?<![가-힣])눈이\\s?(?:${COME}|쌓)|폭설|함박눈|첫눈|눈\\s?덮인|설경|눈사람`), '눈', 'snow'],
  [/맑은\s?날|화창/, '맑음', 'clear sky'],
  [/흐린\s?날/, '흐림', 'overcast sky'],
  [/미세먼지|황사/, '미세먼지', 'hazy air'],
  [/(?<![가-힣])(?:습한|눅눅한|후텁지근한)\s?(?:날|날씨|여름)/, '습함', 'humid air'],   // '습기'·'제습기'는 날씨가 아님 — 날씨로 말할 때만
  [/추운\s?날|영하|강추위|쌀쌀/, '추운 날씨', 'cold weather'],
  [/더운\s?날|무더운/, '더운 날씨', 'hot weather'],
];
const CTX_TIME = [
  [/새벽/, '새벽', 'dawn'],
  [/아침|오전/, '아침', 'morning'],
  [/(?<![가-힣])(한낮|낮)(에|시간|동안)?(?![가-힣])|점심/, '낮', 'midday'],
  [/오후/, '오후', 'afternoon'],
  [/해\s?질\s?녘|노을|석양/, '해 질 녘', 'sunset'],
  [/저녁/, '저녁', 'evening'],
  [/(?<![가-힣])밤(?:에|중|새|늦게|시간|사이|마다)(?![가-힣])|(?<![가-힣])밤\s?(?:산책|하늘|풍경|공기|바다|거리|드라이브|조명|야경|별|분위기|운전|외출)|(?:봄|여름|가을|겨울)\s?밤|(?:늦은|깊은|오늘)\s?밤|어젯밤|간밤|야간|야경|한밤/, '밤', 'night'],   // '밤 껍질'·'군밤'(먹는 밤)은 아님
];
const CTX_PLACE = [
  [/원룸/, '원룸', 'a small one-room studio apartment', true],
  [/오피스텔/, '오피스텔', 'a small studio apartment', true],
  [/아파트/, '아파트', 'an apartment home', true],
  [/빌라/, '빌라', 'a small low-rise apartment', true],
  [/한옥/, '한옥', 'a traditional Korean house', true],
  [/거실/, '거실', 'a living room'],
  [/침실|안방/, '침실', 'a bedroom'],
  [/주방|부엌|싱크대|조리대/, '주방', 'a kitchen'],
  [/욕실|화장실|세면대/, '욕실', 'a bathroom'],
  [/베란다|발코니/, '베란다', 'a balcony'],
  [/현관|신발장/, '현관', 'an entryway'],
  [/창가|창문|창틀|창밖/, '창가', 'by a window'],
  [/책상/, '책상', 'at a desk'],
  [/사무실|회사\s?(?:책상|자리|사무실)|회사에서|오피스(?!텔)/, '사무실', 'an office'],   // 'A회사 제품'은 장소가 아님
  [/카페(?!인)/, '카페', 'a cafe'],   // 카페인은 아님
  [/식당|음식점/, '식당', 'a restaurant'],
  [/편의점/, '편의점', 'a convenience store', true],
  [/대형\s?마트|(?<![가-힣])마트/, '마트', 'a supermarket'],
  [/전통\s?시장|재래시장/, '전통시장', 'a traditional market', true],
  [/지하철/, '지하철', 'a subway station or train'],
  [/정류장/, '정류장', 'a bus stop'],
  [/길거리|골목|거리\s?(풍경|에서)/, '거리', 'a street'],
  [/공원/, '공원', 'a park'],
  [/캠핑/, '캠핑장', 'a campsite'],
  [/(?<![가-힣])(?:차|차량|자동차)\s?(?:안|내부)(?:에서|에|쪽|이|은|을|도|의)?(?![가-힣])|운전석/, '차 안', 'inside a car'],   // 주차 안내·자동차 안전은 아님
  [/주차장/, '주차장', 'a parking lot'],
  [/교실|학교/, '학교', 'a school'],
  [/도서관/, '도서관', 'a library'],
  [/헬스장|체육관/, '헬스장', 'a gym'],
  [/매장|진열대/, '매장', 'a store'],
];
const CTX_KOREA = /한국|국내|우리나라|(?<![가-힣])(?:서울|부산(?![물하])|대구(?![탕살알포지])|인천|광주|대전(?!쟁)|울산|제주)/;   // 부산물·대구탕은 아님
const hitsOf = (list, text) => {
  const out = [];
  for (const [re, ko, en, kr] of list) if (re.test(text) && !out.some((x) => x.ko === ko)) out.push({ ko, en, kr: !!kr });
  return out;
};
// 원고에서 계절·날씨·시간·장소를 읽음. 장소는 사진 자리 설명·소제목·제목에서만(앞뒤 문장은 다른 이야기일 때가 많아서 뺌),
// 계절·날씨·시간은 가장 가까운 곳(사진 자리 → 소제목 → 제목 → 앞뒤 문장) 한 곳에서. from = 어디서 읽었는지
export function readContext({ post, slot, text } = {}) {
  const sceneText = stripSlotMarks(text != null && String(text).trim() ? text : (slot && slot.text) || '');
  const src = [
    ['사진 자리', sceneText],
    ['소제목', (slot && slot.heading) || ''],
    ['제목', (post && ((post.titles && post.titles[0]) || post.keyword)) || ''],
    ['앞뒤 문장', [slot && slot.before, slot && slot.after].filter(Boolean).join(' ')],
  ];
  const first = (list) => {
    for (const [from, t] of src) { const items = hitsOf(list, String(t)); if (items.length) return { items: items.slice(0, 2), from }; }
    return { items: [], from: '' };
  };
  const place = { items: [], from: [] };
  for (const [from, t] of src.slice(0, 3)) {
    for (const x of hitsOf(CTX_PLACE, String(t))) if (place.items.length < 3 && !place.items.some((y) => y.ko === x.ko)) { place.items.push(x); if (!place.from.includes(from)) place.from.push(from); }
  }
  const season = first(CTX_SEASON), weather = first(CTX_WEATHER), time = first(CTX_TIME);
  const all = src.map(([, t]) => String(t || '')).join(' ');
  const korea = place.items.some((x) => x.kr) || season.items.some((x) => x.kr) || CTX_KOREA.test(all);
  return { place: { items: place.items, from: place.from.join('·') }, season, weather, time, korea };
}

// ── 참고 이미지 역할 ──
export const REF_ROLES = {
  subject: { label: '대상 모양 유지', hint: '실제 제품·물건·반려동물의 생김새를 그대로 (진짜 제품 사진)' },
  style: { label: '구도·스타일 참고', hint: '구도·빛·색감만 참고 (안의 물건은 따라 하지 않음)' },
  background: { label: '배경·장소 참고', hint: '이 장소를 배경으로' },
};
const REF_ROLE_EN = {
  subject: 'subject reference — keep this exact object exactly as shown: same shape, proportions, colors, materials, buttons and printing. Do not redesign it and do not add or remove parts.',
  style: 'style reference — borrow only its composition, lighting and color mood; do not copy its objects, people or text.',
  background: 'background reference — use this place as the setting and keep its main features recognisable.',
};
// ── 글자·로고 규칙 (용도별) ──
export const TEXT_RULES = {
  photo: 'Do not add captions, watermarks, frames or any overlaid text. Do not invent logos or brand names; objects stay unbranded with no readable writing.',
  photo_ref: 'Do not add captions, watermarks or overlaid text. Keep any printing or logo that is on the subject reference exactly as it is there; do not add any new text or logos.',
  illustration: 'No words or letters anywhere; explain with shapes and icons.',
  diagram: 'No words or letters. Simple numerals 1-9, arrows and icons are allowed. Leave empty areas where labels can be added later.',
  card_bg: 'No text, letters, numbers, logos or symbols anywhere. Keep the large calm area clean for text that will be added later.',
};
// AI에 꼭 같이 보내는 규칙 (사용자가 지울 수 없음)
export const PROMPT_RULES = [
  'No prices, ratings, badges, certification marks or award marks.',
  'No real, identifiable people or celebrities. If people appear, they are ordinary people who are not posing for the camera.',
  'Do not make it look like a customer review photo, an unboxing, a receipt or a certificate.',
];
const RULE_NOREF = 'Ignore any brand, product or model names that may remain in the context; draw generic, unbranded objects. Avoid packaging labels, manuals and readable device screens.';
const RULE_REF = "Take the subject's appearance only from the subject reference image; do not take product names from the text and do not add other brands.";
export const textRuleFor = (s) => (s.type === 'photo' ? (s.refs || []).some((r) => r.role === 'subject') ? TEXT_RULES.photo_ref : TEXT_RULES.photo : TEXT_RULES[s.type] || TEXT_RULES.photo);
export const rulesFor = (s) => [...PROMPT_RULES, (s.refs || []).some((r) => r.role === 'subject') ? RULE_REF : RULE_NOREF];

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// 맥락으로 같이 보내는 글(제목·소제목·앞뒤 문장)에서 상품 이름·브랜드·모델명·가격·인증·순위 표현을 지움 (AI가 그대로 그리지 않게)
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 영문·숫자로 된 이름(LG·V12)은 낱말 경계로만 찾음 — 'algorithm' 안의 'lg' 같은 건 건드리지 않게. 한글 이름은 붙여 쓴 것도 찾음
const nameRe = (w, flags = 'gi') => (/^[A-Za-z0-9 .&+'_-]+$/.test(w) ? new RegExp(`(?<![A-Za-z0-9])${escRe(w)}(?![A-Za-z0-9])`, flags) : new RegExp(escRe(w), flags));
// 원화 가격: 29,900원 · 990원 · 50원 · 3천원 · 2만 9천원 · 5천만원 · 1.5만원 (원룸·원형·원래처럼 '원'으로 시작하는 낱말은 가격이 아님)
const WON = '원(?![룸형래인칙리소자고두본단피목격산재액판통석색작조장서])';
const KRW = `\\d[\\d,.]*\\s*(?:[억만천]\\s*(?:\\d[\\d,.]*\\s*)?)*${WON}`;
const CTX_PRICE = new RegExp(`${KRW}|₩\\s*\\d[\\d,]*|\\$\\s?\\d[\\d,.]*|\\d[\\d,.]*\\s*(?:달러|USD)`, 'gi');
const CTX_CLAIM = /KC\s*(인증|마크)|인증\s*(마크|서)?(?!샷)|특허|판매\s*1위|\d+\s*위|1등(?!급)|베스트\s*셀러|(?<![가-힣])수상(?!한|하|스키|쩍|레저|가옥)/gi;
// 모델 번호처럼 생긴 것만 (대문자+숫자 두 자리 이상: V12 · S24 · SM-G998N · XQ-1234). A4 · PM2.5 · LED 3개 · Wi-Fi 6 은 그대로
const CTX_MODEL = /(?<![A-Za-z0-9-])(?!PM\d|TOP\d)(?:[A-Z]{1,5}-?\d{2,5}[A-Z0-9]*(?:-[A-Z0-9]+)*|[A-Z]{1,4}-[A-Z]\d{2,5}[A-Z0-9]*(?:-[A-Z0-9]+)*)(?![A-Za-z0-9-])/g;
export function sanitizeContext(text, hide = []) {
  let t = String(text || '');
  const words = [...new Set((hide || []).map((w) => String(w || '').trim()).filter((w) => w.length >= 2))].sort((a, b) => b.length - a.length);
  for (const w of words) t = t.replace(nameRe(w), '제품');
  return t.replace(CTX_PRICE, '').replace(CTX_CLAIM, '').replace(CTX_MODEL, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();
}

// 목적어 조사 (받침 있으면 '을', 없으면 '를'. 한글이 아니면 '를')
const objJosa = (w) => { const c = String(w || '').trim().slice(-1).charCodeAt(0) - 0xac00; return c >= 0 && c < 11172 && c % 28 ? '을' : '를'; };
// ── 장면 설계서 ──
// 화면에서 고칠 수 있는 칸 (overrides 로 옴). 서버는 이 칸만 받고 길이를 자름
export const SCENE_EDITABLE = ['subject', 'setting', 'time', 'camera', 'light', 'color', 'materials', 'composition', 'must_show', 'avoid', 'locale'];
// '대상 모양 유지' 참고 사진이 있을 때 '꼭 보일 것'에 앱이 저절로 넣는 줄 (다시 만들기에서 사용자가 쓴 줄로 되살리지 않게 — 1.5.0 검토)
export const SUBJECT_MUST_SHOW = '참고 사진 속 대상 (모양·색·버튼·인쇄 그대로)';
// 사용자가 고친 장면 칸 → 금지 표현 검사에 쓰는 글: 그려 달라는 칸 전부 ('넣지 말 것'·지역은 빼고). 화면·서버 같은 범위
export const sceneDrawText = (o) => Object.entries(o && typeof o === 'object' ? o : {})
  .filter(([k, v]) => SCENE_EDITABLE.includes(k) && k !== 'avoid' && k !== 'locale' && v != null)
  .map(([, v]) => (Array.isArray(v) ? v.join(' ') : String(v))).join('\n').trim();
// 실제 상품 자리 판단에 쓰는 글: 주 피사체·꼭 보일 것만 (장소·구도·빛 칸의 '화면 왼쪽'·'카페 내부'·'소프트박스'는 상품을 그리라는 뜻이 아님)
export const sceneGateText = (o) => {
  const x = o && typeof o === 'object' ? o : {};
  return [typeof x.subject === 'string' ? x.subject : '', ...(Array.isArray(x.must_show) ? x.must_show : [])].map((v) => String(v || '')).join(' ').trim();
};
export const SCENE_LABELS = {
  goal: '이미지의 목적', subject: '주 피사체와 행동', setting: '장소와 주변 환경', time: '계절·날씨·시간', camera: '카메라 각도와 거리',
  light: '광원과 그림자', color: '색감', materials: '소재와 질감', composition: '구도와 여백', platform: '대상 플랫폼·화면 비율',
  must_show: '정확히 보여야 하는 요소', avoid: '생성하면 안 되는 요소', locale: '지역', refs: '참고 이미지',
};
// 다른 비율로 잘려서 쓰이는 용도: 대표 이미지는 목록 썸네일(정사각형에 가깝게)로 잘리는 경우가 많아서 주인공을 가운데 쪽에
const CROP_NOTE = { blog_cover: '목록 썸네일로 정사각형에 가깝게 잘려도 주인공이 보이게, 주인공은 가운데 60% 안에' };
/** @param {{ post?: any, slot?: any, text?: string, style?: string, preset?: string, purpose?: string, ratio?: string, extra?: string, mode?: string, hide?: any[], refs?: any[], channel?: string, size?: string, overrides?: any }} [o] */
const SCENE_NONE = /^(없음|없어|빼|-|—|x|none)$/i;
export function buildScene({ post, slot, text, style, preset, purpose, ratio, extra, mode, hide, refs, channel, size, overrides } = {}) {
  const pid = presetOf(preset || style);
  const P = PRESETS[pid];
  const pu = PURPOSES[purpose] ? purpose : 'blog_body';
  const r = ratioOf(pu, ratio);
  const sc = (s, n) => clip(sanitizeContext(s, hide), n);
  const sceneText = clip(stripSlotMarks(text != null && String(text).trim() ? text : (slot && slot.text) || ''), 300);
  const c = readContext({ post, slot, text: sceneText });
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  const has = (k) => typeof o[k] === 'string' && o[k].trim() !== '';
  // 칸을 비우면 기본값, '없음'(또는 '-')이라고 쓰면 그 칸을 뺌 — 원고에서 잘못 읽은 계절·장소를 지울 수 있게 (1.5.0 검토). 주 피사체는 못 뺌
  const none = (k) => has(k) && k !== 'subject' && SCENE_NONE.test(o[k].trim());
  const line = (k, d, n = 300) => (none(k) ? '' : has(k) ? clip(o[k], n) : d);
  const list = (k, d) => (Array.isArray(o[k]) ? (o[k].length === 1 && SCENE_NONE.test(String(o[k][0]).trim()) ? [] : o[k].map((x) => clip(x, 120)).filter(Boolean).slice(0, 8)) : d);
  const heading = slot && slot.heading ? sc(slot.heading, 120) : '';
  const isEdit = mode === 'edit';
  const timeItems = [...c.season.items, ...c.weather.items, ...c.time.items];
  const roleList = (refs || []).filter((x) => x && REF_ROLES[x.role]).slice(0, 14).map((x) => ({ role: x.role, image_id: x.image_id || '', label: clip(x.label || '', 80) }));
  const notes = [];
  if (!isEdit) {
    if (none('setting')) notes.push('장소: 직접 뺐어');
    else if (!has('setting') && !c.place.items.length) notes.push('장소: 원고에 없어서 정하지 않음 (지어내지 않음)');
    if (none('time')) notes.push('계절·날씨·시간: 직접 뺐어');
    else if (!has('time') && !timeItems.length) notes.push('계절·날씨·시간: 원고에 없어서 넣지 않음');
    if (!c.korea && !(o.locale === 'KR')) notes.push('지역: 원고에 한국을 뜻하는 말이 없어서 나라를 정하지 않음');
  }
  const composition = [P.composition, CROP_NOTE[pu]].filter(Boolean).join('. ');
  return {
    v: 1, preset: pid, preset_label: P.label, type: P.type, mode: isEdit ? 'edit' : 'generate',
    goal: isEdit ? `AI 이미지 고치기: ${sceneText}` : `${heading ? `'${heading}' 부분에서 ` : ''}'${sceneText}'${objJosa(sceneText)} 보여주는 ${PURPOSES[pu].label} 이미지`,
    subject: line('subject', sceneText),
    setting: line('setting', c.place.items.map((x) => x.ko).join(' · '), 200),
    setting_en: has('setting') ? '' : c.place.items.map((x) => x.en).join(', '),
    setting_from: none('setting') ? '직접 뺌' : has('setting') ? '직접 적음' : c.place.from,
    time: line('time', timeItems.map((x) => x.ko).join(' · '), 120),
    time_en: has('time') ? '' : timeItems.map((x) => x.en).join(', '),
    camera: line('camera', P.camera, 200), light: line('light', P.light, 200), color: line('color', P.color, 200),
    materials: line('materials', P.materials, 200), composition: line('composition', composition, 300),
    platform: { purpose: pu, label: PURPOSES[pu].label, ratio: r, size: String(size || ''), channel: String(channel || '') },
    must_show: list('must_show', roleList.some((x) => x.role === 'subject') ? [SUBJECT_MUST_SHOW] : []),
    avoid: list('avoid', [...P.avoid]),
    locale: o.locale === 'KR' ? 'KR' : o.locale === 'none' ? '' : c.korea ? 'KR' : '',
    refs: roleList,
    context: { title: sc((post && ((post.titles && post.titles[0]) || post.keyword)) || '', 120), heading,
      nearby: [slot && slot.before, slot && slot.after].filter(Boolean).map((x) => sc(x, 160)).filter(Boolean).join(' / ') },
    extra: clip(extra || '', 400),
    notes,
  };
}
// 장면 설계서 → 공급자에 보낼 글 (OpenAI·Gemini는 이 글 그대로, Cloudflare는 무료 글 모델이 이 글을 영어 프롬프트로 바꿈)
export function promptFromScene(s) {
  const P = PRESETS[s.preset] || PRESETS[DEFAULT_STYLE];
  const L = [];
  const edit = s.mode === 'edit';
  if (edit) {
    L.push('Edit the provided image (the first attached image). Change only what the request below asks for.');
    L.push(`Requested change (Korean): ${s.subject}`);
    L.push("Keep everything else as it is: the main subject's identity and shape, the composition and framing, the background, colors and lighting, unless the request asks otherwise. Do not redraw the whole image and do not add new objects, people or text.");
  } else {
    L.push(`Image type: ${TYPE_EN[s.type] || TYPE_EN.photo} — ${P.render}`);
    L.push(`Purpose (Korean): ${s.goal}`);
    L.push(`Main subject and action (Korean): ${s.subject}`);
  }
  if (s.context.title) L.push(`Post topic (Korean, context only): ${s.context.title}`);
  if (s.context.heading) L.push(`Section heading (Korean, context only): ${s.context.heading}`);
  if (s.context.nearby) L.push(`Nearby text for context only (Korean, do not render it): ${s.context.nearby}`);
  if (!edit) {
    L.push(s.setting ? `Setting (from the post, Korean): ${s.setting}${s.setting_en ? ` (${s.setting_en})` : ''}` : 'Setting: the post names no specific place — keep the surroundings simple and plausible for the subject.');
    L.push(s.time ? `Season, weather and time (from the post, Korean): ${s.time}${s.time_en ? ` (${s.time_en})` : ''}` : 'Season, weather and time: not stated in the post — do not add a particular season, weather or time of day.');
    L.push(s.locale === 'KR' ? 'Location: South Korea, as the post implies — everyday Korean surroundings.' : 'Location: not stated — do not add a particular country, city or culture-specific details.');
    if (s.camera) L.push(`Camera (Korean): ${s.camera}`);
    if (s.light) L.push(`Light (Korean): ${s.light}`);
    if (s.color) L.push(`Color (Korean): ${s.color}`);
    if (s.materials) L.push(`Materials and texture (Korean): ${s.materials}`);
    if (s.composition) L.push(`Composition (Korean): ${s.composition}`);
  }
  L.push(`Format: ${s.platform.label} — aspect ratio ${s.platform.ratio}${s.platform.size ? ` (${s.platform.size})` : ''}.`);
  if (s.must_show.length) { L.push('Must show:'); for (const x of s.must_show) L.push('- ' + x); }
  if (s.refs.length) {
    L.push('Reference images (attached after the text, in this order):');
    s.refs.forEach((x, i) => L.push(`- Image ${i + 1 + (edit ? 1 : 0)}: ${REF_ROLE_EN[x.role]}`));
  }
  if (s.extra) L.push(`Extra direction from the author (Korean): ${s.extra}`);
  if (s.avoid.length) { L.push('Avoid (Korean):'); for (const x of s.avoid) L.push('- ' + x); }
  L.push('Text and logos: ' + textRuleFor(s));
  L.push('Rules:');
  for (const rule of rulesFor(s)) L.push('- ' + rule);
  return L.join('\n');
}
// post: {titles, keyword}, slot: parseSlots 한 칸 (또는 본문 밖 자리 {text}), text: 고친 설명, hide: 연결 상품의 브랜드·이름 (맥락에서 지움)
export function buildPrompt(args = {}) { return promptFromScene(buildScene(args)); }

// ───────── 위험 표현 검사 ─────────
// 이미지에 넣으면 안 되는 요청. block = 생성을 막음, warn = 알려만 줌. brands: 이 글에 연결된 상품 브랜드
const PROMPT_RISKS = [
  ['block', /(로고|상표|트레이드\s*마크|브랜드\s*(이름|명|로고|마크))|\blogos?\b|\btrademarks?\b/i, 'logo', '상표·로고는 이미지로 만들 수 없어. 실제 상품 이미지는 공식 이미지나 직접 찍은 사진을 써줘.'],
  ['block', new RegExp(`${KRW}|₩\\s*\\d|\\$\\s?\\d|가격\\s*(표|표시|태그)|최저가|할인율|\\bprice\\s*tags?\\b`, 'i'), 'price', '이미지에 가격을 넣으면 안 돼. 가격은 본문에 확인한 날짜와 함께 써줘.'],
  ['warn', /가격/, 'price_word', "'가격'이 들어 있어. 이미지에는 가격이 그려지지 않게 할게 (가격은 본문에만)."],
  ['block', /(인증\s*(마크|서)|KC\s*마크|특허|판매\s*1위|1위|1등(?!급)|베스트\s*셀러|(?<![가-힣])수상(?!한|하|스키|쩍|레저|가옥)|\bcertified\b|\bawards?\b)/i, 'claim', '인증·순위·수상 같은 표시는 이미지로 만들면 안 돼.'],
  ['block', /(후기\s*사진|리뷰\s*사진|실사용\s*(사진|샷)|내돈내산|구매\s*인증|언박싱|\bunboxing\b)/i, 'review', '실제로 써본 것처럼 보이는 후기 사진은 만들 수 없어.'],
  ['block', /(글자|문구(?!점)|텍스트|자막|제목을?\s*넣|타이포|\btext\b|\bcaptions?\b|\btypography\b)/i, 'text', "이미지 안에 글자는 넣지 않아. 글자는 '카드뉴스 만들기'에서 따로 얹어줘."],
];
// '글자 없이', '로고 빼고', '글자나 로고 없이', '로고를 지운', 'no text', 'no text or logos', 'without any text', 'text-free' 처럼
// 넣지 말라는 뜻이면 막지 않음 ('로고 없이 말고 로고 넣어줘'처럼 뒤에 다시 나오면 그건 막음)
const NEG_KO = '(?:없이|없는|없게|없고|없음|빼고|빼서|뺀|말고|제외|금지|넣지|지운|지우고|지워|없앤|없애고|가린|가리고|안\\s*(?:넣|보이|들어|나오|그려|생기))';
const PART = '(?:이|가|은|는|을|를|도|만)';
const JOIN = '(?:이?나|와|과|이?랑|하고|및|또는|[,·/])';
const NEG_AFTER = new RegExp(`^\\s*${PART}?\\s*(?:${JOIN}\\s*[가-힣A-Za-z]{1,8}(?:\\s+[가-힣A-Za-z]{1,8})?\\s*${PART}?\\s*){0,4}(?:${NEG_KO}|X(?![A-Za-z]))`);
const NEG_AFTER_EN = /^(?:e?s)?-?\s?free\b/i;
const NEG_BEFORE = /(?:\b(?:no|without|not|non|zero|never|free\s+of|don'?t\s+(?:put|add|include|draw|show|use|render|write))\s+(?:(?:put|add|include|draw|show|use|render|write)\s+)?(?:any\s+)?(?:[a-z-]+\s*(?:,|\bor\b|\band\b|\bnor\b)\s*){0,4}|\b(?:no|non|zero)-)$/i;
const negated = (t, at, len) => {
  const after = t.slice(at + len, at + len + 40);
  return NEG_AFTER.test(after) || NEG_AFTER_EN.test(after) || NEG_BEFORE.test(t.slice(Math.max(0, at - 40), at));
};
const firstHit = (re, t) => {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = g.exec(t))) {
    if (!m[0]) { g.lastIndex++; continue; }
    if (!negated(t, m.index, m[0].length)) return m;
  }
  return null;
};
export function promptRisk(text, brands = []) {
  const t = String(text || '');
  const out = [];
  for (const [level, re, code, msg] of PROMPT_RISKS) {
    if (code === 'price_word' && out.some((x) => x.code === 'price')) continue;
    if (firstHit(re, t)) out.push({ level, code, msg });
  }
  const hit = (brands || []).map((b) => String(b || '').trim()).filter((b) => b.length >= 2).find((b) => nameRe(b, 'i').test(t));
  if (hit) out.push({ level: 'block', code: 'brand', msg: `'${hit}' 같은 실제 브랜드 이름은 AI 이미지에 넣을 수 없어.` });
  return out;
}
export const blocksOf = (risks) => (risks || []).filter((r) => r.level === 'block');
// 실제 상품·화면 사진이 필요해 보이는 자리 (AI로 만들면 실제와 다르게 보일 수 있음 → 직접 찍은 사진·공식 이미지 권장)
// '로고 없이'처럼 빼라는 말은 넘어감. 포장마차·리포트·실내처럼 다른 뜻으로 쓰인 말도 넘어감
const REAL_NEEDED = /(구성품|박스|포장(?!마차)|뒷면|라벨|원재료|성분표|표기(?!법)|설명서|화면\s*캡처|캡처|스크린샷|실물|실사용|착용|사용\s*후기|후기\s*사진|언박싱|영수증|인증서|단자|(?<![리서어스])포트(?!폴|라이트)|버튼|조작부|컨트롤러|디스플레이|화면|제품\s*사진|상품\s*사진|모델명|로고|내부)/;
// '(직접 찍기)'로 표시한 자리 — 자동 작가가 '내가 직접 찍을 수 있는 장면'으로 남긴 자리 (원본 사진이 있어야 다른 글과 달라짐)
const OWN_PHOTO = /직접\s*(찍|촬영)/;
export const isOwnPhotoSlot = (text) => OWN_PHOTO.test(String(text || ''));
// '(직접 찍기)' 표시만 뺀 설명 (검색어·대체 텍스트·AI에 보내는 장면 설명에는 표시를 안 넣음)
export const stripOwnMark = (text) => String(text || '').replace(/\(\s*직접\s*(찍기|촬영)\s*\)\s*/g, '').trim();
// 대체 텍스트·검색어·AI에 보내는 장면 설명에서는 '(제품 사진)' 표시도 뺌 (1.5.0 — 자동 작가가 다는 표시. 판단에는 표시를 남긴 글을 씀)
export const stripSlotMarks = (text) => stripOwnMark(text).replace(/\(\s*제품\s*사진\s*\)\s*/g, '').trim();
export function slotRisk(text) {
  if (isOwnPhotoSlot(text)) return { real: true, word: '직접 찍기', msg: "'직접 찍기'로 표시한 자리야. 네가 찍은 사진이 들어가야 다른 글과 달라져 — 휴대폰으로 찍어서 '파일 올리기'로 넣어줘." };
  const m = firstHit(REAL_NEEDED, String(text || ''));
  return m ? { real: true, word: m[1], msg: `'${m[1]}'처럼 실제 상품·화면이 보여야 하는 자리야. AI로 만들면 실제와 다르게 보일 수 있어서, 직접 찍은 사진이나 쓸 수 있는 공식 이미지를 권해.` } : { real: false };
}
// 진짜 사진으로 보는 이미지 종류 (직접 올린 사진·Pexels 사진). AI·카드뉴스는 아님
export const REAL_KINDS = ['upload', 'stock'];
// AI로 만들어도 되는 자리인지 (1.5.0 — 서버와 화면이 같은 판단)
// slotText: 본문의 사진 자리 설명 (사용자가 고친 설명이 아니라 본문 그대로 — '(직접 찍기)' 표시를 지워서 넘어가지 않게)
// text: 고친 설명·추가 요청, refs: [{role}] 참고 이미지, genericOk: '특정 제품 모양이 꼭 필요하지 않아 — 일반 장면으로' 확인
// - '직접 찍기' 자리: 막음 (실제로 해본 것처럼 보이는 사진을 AI로 만들지 않음 — 참고 사진을 넣어도 마찬가지)
// - 실제 상품·화면이 보여야 하는 자리: 대상 모양 유지 참고 사진(진짜 제품 사진)이 있으면 'AI 합성'으로 만들고,
//   없으면 사용자가 '일반 장면이어도 돼'라고 확인했을 때만 (그때는 특정 제품처럼 보이지 않게 만듦). 몰래 일반 물건으로 바꿔 그리지 않음
// refs: [{role, kind}] — kind 가 upload·stock(진짜 사진)인 '대상 모양 유지'만 셈 (AI 이미지를 대상으로 넣어도 실제 제품 사진이 아님 — 1.5.0 검토)
// baseComposite: 고치는 이미지가 이미 'AI 합성(실제 사진 참고)'이면 그 합성을 이어서 고치는 것으로 봄
/** @param {string} slotText @param {{ text?: string, refs?: any[], genericOk?: boolean, baseComposite?: boolean }} [o] */
export function aiGate(slotText, { text = '', refs = [], genericOk = false, baseComposite = false } = {}) {
  if (isOwnPhotoSlot(slotText)) {
    return { ok: false, code: 'own_photo_slot', msg: "'직접 찍기' 자리는 네가 찍은 사진만 넣어 (AI로 만들면 실제로 해본 것처럼 보여서). 휴대폰으로 찍어서 '파일 올리기'로 넣거나, 본문에서 '(직접 찍기)'를 지워 일반 사진 자리로 바꿔줘." };
  }
  const r = slotRisk(`${stripOwnMark(slotText)} ${text || ''}`);
  if (!r.real) return { ok: true };
  if (baseComposite || (refs || []).some((x) => x && x.role === 'subject' && REAL_KINDS.includes(String(x.kind || '')))) return { ok: true, composite: true, word: r.word };
  if (genericOk) return { ok: true, generic: true, word: r.word };
  return { ok: false, code: 'real_photo_needed', word: r.word, msg: `'${r.word}'처럼 실제 제품 모양이 보여야 하는 자리야. 진짜 제품 사진을 '참고 사진(대상 모양 유지)'으로 넣거나, 직접 찍은 사진을 올려줘. 특정 제품이 아니어도 되면 '일반 장면으로 만들게'를 체크해줘.` };
}
// 이미지 설명이 사진 자리 설명과 너무 다르면 알려줌
export function descriptionMismatch(slotText, desc) {
  const a = normText(slotText), b = normText(desc);
  if (!a || !b) return false;
  if (textSimilarity(a, b) >= 0.2) return false;
  const words = (s) => new Set(s.split(/[\s,./·()]+/).map((w) => w.replace(/(을|를|이|가|은|는|의|에|에서|과|와|로|으로|한|된|하는)$/, '')).filter((w) => w.length >= 2));
  const A = words(a);
  for (const w of words(b)) if (A.has(w)) return false;
  return true;
}

// ───────── 비용 예상 ─────────
// 출력 토큰 수: 2026-10-22에 OpenAI 이미지 가이드의 계산기에서 읽은 값 (크기·품질별).
// 2026-10-27 다시 보니 2.5 모델 페이지에 'GPT Image 2 계산기는 2.5의 토큰 사용량을 추정하지 않는다'고 적혀 있고, 가이드의 표도 다시 읽지 못했어.
// → 2.5는 이 값이 '추정'일 뿐이라고 화면에 밝히고, 실제 사용량(usage)이 오면 그걸로 다시 계산함. 토큰 가격($/100만)은 가격 페이지에서 다시 확인함.
export const PRICE_SOURCE = { url: 'https://developers.openai.com/api/docs/guides/image-generation', checked_at: '2026-10-22', rates_checked_at: '2026-10-27' };
export const OUTPUT_TOKENS = {
  '1024x1024': { low: 196, medium: 439, high: 1756, xhigh: 3122, max: 7024 },
  '1536x1024': { low: 158, medium: 343, high: 1372, xhigh: 2459, max: 5488 },
  '1024x1536': { low: 158, medium: 343, high: 1372, xhigh: 2459, max: 5488 },
  '1536x864': { low: 120, medium: 280, high: 1078, xhigh: 1917, max: 4312 },
  '864x1536': { low: 120, medium: 280, high: 1078, xhigh: 1917, max: 4312 },
  '1280x960': { low: 155, medium: 349, high: 1395, xhigh: 2480, max: 5580 },
  '1024x1280': { low: 173, medium: 378, high: 1510, xhigh: 2702, max: 6119 },
};
export const QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'];
export const QUALITY_LABEL = { low: '낮음(초안)', medium: '보통', high: '높음', xhigh: '아주 높음', max: '최고' };
// 편집할 때 넣는 이미지의 입력 토큰은 이미지마다 달라서 넉넉히 잡음 (예상치)
export const EDIT_INPUT_TOKENS_EST = 1500;
export const DEFAULT_PRICES = { image_output_per_m: 30, image_input_per_m: 8, text_input_per_m: 5 };
const priceOf = (prices, k) => { const n = Number(prices && prices[k]); return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PRICES[k]; };

// ───────── 공급자·모델 등록표 (1.5.0) ─────────
// 모델마다 되는 것(크기·품질·고치기·참고 사진 수)과 가격을 여기 한 곳에만 둠 — 화면·서버·문서의 비용 표가 모두 이걸 씀.
// 확인한 날(checked)과 공식 주소(source)를 같이 둠. 가격이 바뀌면 여기와 설정의 가격표(OpenAI·Gemini)를 고침.
// 설정에 모델 이름을 넣은 것만으로 '연결됨'이라고 하지 않음 — 연결 상태는 서버가 키를 실제로 물어본 결과(연결 확인)와 실제 생성 기록으로 따로 보여줌.
// 2026-10-27 공식 문서 다시 확인 (OpenAI 가이드·모델·가격·지원 종료 페이지, Gemini 이미지 생성·가격·지원 종료·오류 페이지, Cloudflare 모델·변경 기록·가격 페이지)
// 2026-10-28 (1.5.1) 다시 확인: 모델 이름·상태, 품질·크기·참고 사진 수, 가격 — 바뀐 것은 Gemini 3 Pro Image 비율(아래)과 설명 몇 줄뿐
export const PROVIDERS = {
  cloudflare: { label: 'Cloudflare Workers AI', env: ['CF_ACCOUNT_ID', 'CF_API_TOKEN'], free_note: 'Cloudflare 무료 플랜 하루 10,000 뉴런 안에서 청구 없음 — 넘으면 실패만 함',
    usage_url: 'https://dash.cloudflare.com/', checked: '2026-10-28', source: 'https://developers.cloudflare.com/workers-ai/platform/pricing/' },
  openai: { label: 'OpenAI', env: ['OPENAI_API_KEY'], usage_url: 'https://platform.openai.com/usage', checked: '2026-10-28', source: 'https://developers.openai.com/api/docs/pricing' },
  gemini: { label: 'Google Gemini API', env: ['GEMINI_API_KEY'], usage_url: 'https://aistudio.google.com/usage', checked: '2026-10-28', source: 'https://ai.google.dev/gemini-api/docs/pricing' },
};
// 크기: OpenAI 레퍼런스 — 임의 WIDTHxHEIGHT는 gpt-image-2·2.5 계열만(16의 배수·비율 1:3~3:1·한 변 3840 이하), 나머지는 1024x1024·1536x1024·1024x1536
// 품질: OpenAI — xhigh·max는 2.5 계열만, 그 밖은 high까지 (문서의 기본값은 auto지만 앱은 늘 품질을 정해서 보냄 — 예상 비용을 미리 알 수 있게).
//       Gemini — 품질 대신 해상도(1K·2K·4K, 대문자 K)를 고름 (아래 imageSizes). Cloudflare — 단계 수
// 가격: OpenAI 2·2.5는 같은 토큰 가격(설정의 가격표, 기본 = 가격 페이지 Standard), 1.5·1-mini는 모델 페이지의 장당 가격표·토큰 가격,
//       Gemini는 가격 페이지의 해상도별 장당 가격과 토큰 가격 (이미지 모델은 무료 등급 없음)
export const MODEL_CHECKED = '2026-10-28';
const Q3 = ['low', 'medium', 'high'];
const per = (a, b) => ({ '1024x1024': a, '1536x1024': b, '1024x1536': b });
// Gemini 비율: 1:4·4:1·1:8·8:1 은 Nano Banana 2.1(과 3.1 Flash Image)에만 문서에 있음 — 3 Pro Image 에는 안 적혀 있어서 빼 둠 (2026-10-28 확인)
const GEMINI_ASPECTS = ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'];
const GEMINI_PRO_ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const MODEL_FAMILIES = [
  // 무료(기본, 2026-10-25~): FLUX.2 [klein] 4B — 만들기와 고치기를 한 모델에서. 고른 비율 그대로(긴 변 1024), 단계 4 고정이라 품질은 '보통' 하나.
  // 요청은 multipart(prompt·width·height, 참고 사진은 input_image_0~3 — 최대 4장, 한 장이 512x512보다 작아야 함 → 앱이 작은 사본을 만들어 보냄).
  // 뉴런: 출력 512칸마다 26.05, 입력 사진 512칸마다 5.37 (단계당 과금 없음). 공식: Cloudflare 변경 기록 2026-01-15, 가격 페이지
  // 크기를 안 보내면 1024x768 이 기본이라 앱은 늘 width·height 를 보냄 (2026-10-28 확인: 256~1920, steps 칸 없음)
  { id: 'cf-flux-2-klein-4b', re: /^cf-flux-2-klein-4b$/, flexible: true, qualities: ['medium'], free: true, edit: true, refsMax: 4, refSmall: 500,
    provider: 'cloudflare', cfModel: '@cf/black-forest-labs/flux-2-klein-4b', multipart: true, label: 'FLUX.2 [klein] 4B', checked: '2026-10-28',
    sizes: { '16:9': '1024x576', '4:3': '1024x768', '1:1': '1024x1024', '4:5': '816x1024', '9:16': '576x1024' },
    url: 'https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/' },
  // 무료: FLUX.1 schnell — 크기를 고르는 칸이 없음(문서에 출력 크기도 안 적혀 있음 — 지금까지 받은 결과는 1024x1024) → 내려받을 때 고른 비율로 자름.
  //       고치기·참고 사진 못 함. 품질 = 단계 수(4·6·8 — 문서: 기본 4, 최대 8)
  { id: 'cf-flux-1-schnell', re: /^cf-flux-1-schnell$/, flexible: false, fixedSize: '1024x1024', qualities: Q3, free: true, noEdit: true, refsMax: 0,
    provider: 'cloudflare', cfModel: '@cf/black-forest-labs/flux-1-schnell', steps: { low: 4, medium: 6, high: 8 }, label: 'FLUX.1 schnell', checked: '2026-10-24',
    url: 'https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/' },
  // OpenAI GPT Image 2.5 (2026-09-08 출시): 'Sunburst = 고치기 정확도가 가장 중요할 때, Flare = 빠르고 질 좋은 일상 생성' (OpenAI 가이드).
  // edits 는 이미지 16장까지 (고치기면 고칠 이미지 포함). input_fidelity 는 2.5에서 되는지 문서로 확인 못 해서 안 보냄
  // 2026-10-28: Sunburst = '이미지 생성·고치기에서 가장 뛰어난 모델'(성능 Highest), Flare = '가장 빠른 고품질 일상 생성' (모델 페이지) → 고품질 모드 기본은 Sunburst
  { id: 'gpt-image-2.5', re: /^gpt-image-2\.5-(flare|sunburst)(-\d{4}-\d{2}-\d{2})?$/, flexible: true, qualities: QUALITIES, settingsPrices: true, edit: true, refsMax: 16,
    label: 'GPT Image 2.5', labelFor: (m) => (/sunburst/.test(m) ? 'GPT Image 2.5 Sunburst' : 'GPT Image 2.5 Flare'), // 1.5.1: 두 모델이 화면에서 같은 이름으로 보이지 않게
    checked: '2026-10-28', url: 'https://developers.openai.com/api/docs/guides/image-generation' },
  // GPT Image 2 (2026-04-21): 품질은 high까지. 가격 페이지 표에는 Batch(반값)만 있고 표준 값은 'GPT Image 2 토큰 가격을 쓴다'는 문구로만 알 수 있어서
  //   2.5와 같은 표준 값($5·$8·$30)으로 셈 (예상치 — 2026-10-28 확인)
  { id: 'gpt-image-2', re: /^gpt-image-2(-\d{4}-\d{2}-\d{2})?$/, flexible: true, qualities: Q3, settingsPrices: true, edit: true, refsMax: 16, label: 'GPT Image 2', checked: '2026-10-28',
    url: 'https://developers.openai.com/api/docs/models/gpt-image-2' },
  // 지원 종료 예정 (2026-12-01 API에서 빠짐 — OpenAI 지원 종료 페이지)
  { id: 'gpt-image-1.5', re: /^gpt-image-1\.5(-\d{4}-\d{2}-\d{2})?$/, flexible: false, qualities: Q3, deprecated: true, shutdown: '2026-12-01', edit: true, refsMax: 16, label: 'GPT Image 1.5', checked: '2026-10-27',
    prices: { image_output_per_m: 32, image_input_per_m: 8, text_input_per_m: 5 },
    perImage: per({ low: 0.009, medium: 0.034, high: 0.133 }, { low: 0.013, medium: 0.05, high: 0.2 }), url: 'https://developers.openai.com/api/docs/models/gpt-image-1.5' },
  { id: 'gpt-image-1-mini', re: /^gpt-image-1-mini(-\d{4}-\d{2}-\d{2})?$/, flexible: false, qualities: Q3, deprecated: true, shutdown: '2026-12-01', edit: true, refsMax: 16, label: 'GPT Image 1 mini', checked: '2026-10-27',
    prices: { image_output_per_m: 8, image_input_per_m: 2.5, text_input_per_m: 2 },
    perImage: per({ low: 0.005, medium: 0.011, high: 0.036 }, { low: 0.006, medium: 0.015, high: 0.052 }), url: 'https://developers.openai.com/api/docs/models/gpt-image-1-mini' },
  // 종료됨 (2026-10-23 — OpenAI 모델 페이지): 이름은 알아보지만 만들지 않음 (보내도 실패만 하니까 앱이 먼저 막음)
  { id: 'gpt-image-1', re: /^gpt-image-1(-\d{4}-\d{2}-\d{2})?$/, flexible: false, qualities: Q3, deprecated: true, retired: '2026-10-23', edit: true, refsMax: 16, label: 'GPT Image 1 (종료됨)', checked: '2026-10-27',
    prices: { image_output_per_m: 40, image_input_per_m: 10, text_input_per_m: 5 },
    perImage: per({ low: 0.011, medium: 0.042, high: 0.167 }, { low: 0.016, medium: 0.063, high: 0.25 }), url: 'https://developers.openai.com/api/docs/models/gpt-image-1' },
  // Google Gemini API — 비율(aspectRatio)과 해상도(imageSize)로 고름. 품질 칸: 보통=1K · 높음=2K. 생각(thinking) 토큰은 글 출력 값으로 청구됨
  // 4K 는 앱에서 뺐어: 결과 형식을 고를 수 없고(generateContent 는 outputMimeType 을 받지 않음 — SDK 문서) PNG 이면 4K 한 장이 저장 한도(25MB)를 넘을 수 있어서.
  // 넘으면 돈은 나가고 저장은 못 하니까, 만들기 전에 막는 쪽으로 (가격표에는 4K 값을 남겨 둠)
  // 3 Pro Image (GA, preview 이름은 2026-06-25 종료): 참고 사진은 물건 6장(정확하게)·인물 5장·스타일 3장까지 → 앱은 6장까지만
  // 2026-10-28: generateContent 는 문서에 '(Legacy)'로 바뀌었지만 '계속 완전히 지원'이라 그대로 씀 (새 모델은 Interactions API 로 나온다고 함 — 후속 작업)
  { id: 'gemini-3-pro-image', re: /^gemini-3-pro-image$/, provider: 'gemini', aspect: true, aspects: GEMINI_PRO_ASPECTS, flexible: false,
    qualities: ['medium', 'high'], imageSizes: { medium: '1K', high: '2K' }, qualityLabels: { medium: '1K (보통)', high: '2K (높음)' },
    edit: true, refsMax: 6, label: 'Gemini 3 Pro Image', checked: '2026-10-28', maxInlineBytes: 18 * 1024 * 1024,
    gemini: { text_input_per_m: 2, image_input_per_image: 0.0011, image_output_per_m: 120, text_output_per_m: 12, per_image: { '1K': 0.134, '2K': 0.134, '4K': 0.24 } },
    url: 'https://ai.google.dev/gemini-api/docs/image-generation' },
  // Nano Banana 2.1 (2026-10-06, Google이 새 프로젝트에 권함): 참고 사진은 물건 10장·인물 4장까지 (스타일 참고 없음).
  // 넣는 이미지 한 장 값($0.00168)은 가격표에 없는 예상치: Gemini 3 기본 미디어 해상도 1,120토큰 × $1.50/100만 (2026-10-28 확인)
  { id: 'gemini-nano-banana-2.1', re: /^gemini-nano-banana-2\.1$/, provider: 'gemini', aspect: true, aspects: GEMINI_ASPECTS, flexible: false,
    qualities: ['medium', 'high'], imageSizes: { medium: '1K', high: '2K' }, qualityLabels: { medium: '1K (보통)', high: '2K (높음)' },
    edit: true, refsMax: 10, label: 'Gemini Nano Banana 2.1', checked: '2026-10-28', maxInlineBytes: 18 * 1024 * 1024,
    gemini: { text_input_per_m: 1.5, image_input_per_image: 0.00168, image_output_per_m: 30, text_output_per_m: 7.5, per_image: { '1K': 0.0336, '2K': 0.0504, '4K': 0.113 } },
    url: 'https://ai.google.dev/gemini-api/docs/image-generation' },
];
// 가격을 모르는 모델을 넉넉하게 잡을 때의 값 (지금 등록표에는 그런 모델이 없음 — gpt-image-2 는 2026-10-27 가격 페이지에서 확인)
const CONSERVATIVE = { prices: { image_output_per_m: 40, image_input_per_m: 10, text_input_per_m: 5 }, perImage: MODEL_FAMILIES.find((f) => f.id === 'gpt-image-1').perImage };
// 모델 이름 → 되는 것. 앱이 모르는 이름이면 known: false, provider: '' — 서버는 만들기 전에 거절함 (모르는 이름을 OpenAI로 보내지 않음, 1.5.0)
// retired: 공급자가 종료한 모델 (알아보지만 만들지 않음)
export function modelCaps(model) {
  const m = String(model || '').trim();
  const f = MODEL_FAMILIES.find((x) => x.re.test(m));
  if (!f) return { id: '', known: false, flexible: false, qualities: Q3, conservative: true, settingsPrices: false, provider: '', label: m, edit: false, refsMax: 0, free: false, usable: false };
  return { id: f.id, known: true, flexible: f.flexible, qualities: f.qualities, conservative: !!f.conservative, settingsPrices: !!f.settingsPrices, deprecated: !!f.deprecated, prices: f.prices || null, perImage: f.perImage || null, url: f.url || '',
    provider: f.provider || 'openai', free: !!f.free, noEdit: !!f.noEdit, fixedSize: f.fixedSize || '', cfModel: f.cfModel || '', steps: f.steps || null,
    sizes: f.sizes || null, multipart: !!f.multipart, label: (f.labelFor && f.labelFor(m)) || f.label || f.id, edit: !!f.edit && !f.noEdit, refsMax: Number(f.refsMax || 0), refSmall: Number(f.refSmall || 0),
    aspect: !!f.aspect, aspects: f.aspects || null, imageSizes: f.imageSizes || null, qualityLabels: f.qualityLabels || null, gemini: f.gemini || null, maxInlineBytes: Number(f.maxInlineBytes || 0),
    inputFidelity: !!f.inputFidelity, retired: f.retired || '', shutdown: f.shutdown || '', usable: !f.retired,
    status: f.retired ? 'retired' : f.status || (f.deprecated ? 'deprecated' : 'ga'), checked: f.checked || MODEL_CHECKED };
}
// 같이 보낼 수 있는 이미지 수 (고치기면 고칠 이미지가 한 장을 씀) — 참고 사진은 이만큼까지
export const refsLimit = (model, mode) => { const c = modelCaps(model); return Math.max(0, c.refsMax - (mode === 'edit' ? 1 : 0)); };
export const FREE_MODEL = 'cf-flux-2-klein-4b';
export const qualitiesFor = (model) => (model ? modelCaps(model).qualities : QUALITIES);
// 모델이 못 받는 품질이면 가까운 것으로 (xhigh·max → high 또는 그 모델의 가장 높은 것, 그 밖 → medium 또는 그 모델의 첫 품질)
export const normQuality = (model, q) => {
  const qs = qualitiesFor(model);
  if (qs.includes(q)) return q;
  if (q === 'xhigh' || q === 'max') return qs.includes('high') ? 'high' : qs[qs.length - 1];
  return qs.includes('medium') ? 'medium' : qs[0];
};
export const qualityLabel = (model, q) => { const c = modelCaps(model); return (c.qualityLabels && c.qualityLabels[q]) || QUALITY_LABEL[q] || String(q || ''); };
// 공급자에 보낼 크기 표시: OpenAI·Cloudflare = 'WIDTHxHEIGHT', Gemini = '비율@해상도' (예: 16:9@2K, 해상도를 못 고르는 모델은 비율만)
export const sizeLabel = (size) => { const m = /^(\d+:\d+)(?:@(\w+))?$/.exec(String(size || '')); return m ? `${m[1]}${m[2] ? ' · ' + m[2] : ''}` : String(size || '').replace('x', '×'); };
export const geminiSizeOf = (size) => { const m = /^(\d+:\d+)(?:@(1K|2K|4K))?$/.exec(String(size || '')); return m ? { aspectRatio: m[1], imageSize: m[2] || '' } : null; };

// ───────── 모드 (설정 > 이미지에서 모드마다 모델·품질을 바꿀 수 있음) ─────────
// 화면은 고른 모드의 실제 모델 이름을 늘 보여주고, 사용자가 고르지 않은 유료 모델로 저절로 바꾸지 않음
// 1.5.1: 고품질 모드의 기본 모델을 Flare(속도 우선)에서 Sunburst(정확도 우선)로, 품질은 high. 빠른 모드는 Flare 그대로.
//        기본값만 바뀜 — 설정에 사용자가 저장해 둔 모드(image_modes)는 그대로 씀 (덮어쓰지 않음)
export const IMAGE_MODES = [
  { id: 'free_draft', label: '무료·저비용 초안', model: 'cf-flux-2-klein-4b', quality: 'medium' },
  { id: 'fast_paid', label: '빠른 유료 생성', model: 'gpt-image-2.5-flare', quality: 'medium' },
  { id: 'hq_paid', label: '고품질 유료 생성', model: 'gpt-image-2.5-sunburst', quality: 'high' },
  { id: 'gemini_hq', label: 'Gemini 고품질 생성', model: 'gemini-3-pro-image', quality: 'high' },
];
// 설정의 image_modes({모드: {model, quality}})를 반영한 모드 목록. 모르는 모델이면 그 모드는 기본 모델로 (사용자에게 알림은 설정 화면에서)
// saved: 사용자가 저장한 값이 있는 모드인지 (기본값과 구분 — 1.5.1). custom: 기본 모델과 다른 모델인지
// 1.5.0 화면은 설정을 저장할 때마다 모드 넷을 그때의 기본값까지 모두 저장했어. 그래서 1.5.0 기본값과 똑같이 저장된 모드는
// 사용자가 고른 값이 아니라 그때의 기본값으로 봄 → 바뀐 기본값을 씀 (저장된 값을 지우거나 바꾸지는 않음 — 설정 화면에 그렇게 알림, 1.5.1 검토)
export const MODE_DEFAULTS_150 = { hq_paid: { model: 'gpt-image-2.5-flare', quality: 'high' } };
export function resolveModes(settings) {
  const o = (settings && settings.image_modes && typeof settings.image_modes === 'object') ? settings.image_modes : {};
  return IMAGE_MODES.map((d) => {
    let x = o[d.id] && typeof o[d.id] === 'object' ? o[d.id] : {};
    const old = MODE_DEFAULTS_150[d.id];
    // 1.5.1 화면이 저장한 값(user 표시)은 늘 사용자가 고른 값 — 1.5.0 기본값과 같아도 그대로 씀 (1.5.1 재검토: 예전 값을 다시 고를 수 있게)
    const legacy = !!old && x.user !== true && x.model === old.model && (typeof x.quality === 'string' ? x.quality : old.quality) === old.quality && (old.model !== d.model || old.quality !== d.quality);
    if (legacy) x = {};
    const model = typeof x.model === 'string' && modelCaps(x.model).known && modelCaps(x.model).usable ? x.model : d.model;
    const caps = modelCaps(model);
    const saved = typeof x.model === 'string' && model === x.model;
    return { id: d.id, label: d.label, model, quality: normQuality(model, typeof x.quality === 'string' ? x.quality : d.quality), caps, paid: !caps.free, custom: model !== d.model,
      saved, legacy, default_model: d.model, default_quality: d.quality };
  });
}
// 설정 화면에서 저장할 모드: 기본값(모델·품질)과 다른 것만 (1.5.1) — 그대로 둔 모드는 저장하지 않아서 나중에 기본값이 바뀌면 그걸 따름.
// rows: [{id, model, quality}] (화면에서 고른 값). keep: 예전에 저장해 둔 값이 있는 모드는 같은 값이어도 지우지 않으려면 그 id 목록
export function modeOverrides(rows, keep = []) {
  const out = {};
  for (const r of rows || []) {
    const d = IMAGE_MODES.find((x) => x.id === r.id);
    if (!d || typeof r.model !== 'string' || !r.model) continue;
    const q = normQuality(r.model, String(r.quality || d.quality));
    if (r.model === d.model && q === normQuality(d.model, d.quality) && !keep.includes(r.id)) continue;
    out[r.id] = { model: r.model, quality: q, user: true }; // user: 이 화면에서 사용자가 고른 값 (1.5.0 화면이 같이 저장한 기본값과 구분)
  }
  return out;
}
// 설정 화면의 모델 고르기 목록 (공급자별)
export const KNOWN_MODELS = ['cf-flux-2-klein-4b', 'cf-flux-1-schnell', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1-mini', 'gemini-3-pro-image', 'gemini-nano-banana-2.1'];

// ───────── AI 검수 모델 (멀티모달: 이미지를 보고 의견을 줌 — 품질 보증 아님) ─────────
// 2026-10-27 확인: Cloudflare Gemma 4 (이미지 입력 됨, 무료 뉴런 안에서), Gemini 3.5 Flash-Lite (종료일 없음, 이미지 1장 기본 1,120토큰),
// OpenAI gpt-5.6-luna (이미지 토큰 규칙이 문서에 있음: detail low = 512×512 안 → 32px 칸 최대 256개 × 1.2 = 308토큰)
// Llama 3.2 Vision 은 처음에 라이선스 동의('agree')를 보내야 해서 쓰지 않음 (사용자 대신 약관에 동의하지 않게)
export const REVIEW_MODELS = [
  { id: 'cf-gemma-4-26b', provider: 'cloudflare', cfModel: '@cf/google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B (Cloudflare)', free: true, checked: '2026-10-27' },
  { id: 'gemini-3.5-flash-lite', provider: 'gemini', label: 'Gemini 3.5 Flash-Lite', price: { input_per_m: 0.3, output_per_m: 2.5, image_tokens: 1120, out_tokens: 1000 }, checked: '2026-10-27' },
  { id: 'gpt-5.6-luna', provider: 'openai', label: 'GPT-5.6 luna', price: { input_per_m: 0.2, output_per_m: 1.2, image_tokens: 308, out_tokens: 1000 }, checked: '2026-10-27' },
];
export const reviewCaps = (id) => REVIEW_MODELS.find((m) => m.id === id) || null;
// 검수 예상 비용: 이미지 n장(토큰) + 지시문(약 900토큰) + 답(약 700토큰). 무료 모델은 0
export function estimateReviewUsd(id, nImages = 1) {
  const m = reviewCaps(id);
  if (!m) return null;
  if (m.free) return 0;
  const p = m.price;
  return roundUsd(((Math.max(1, nImages) * p.image_tokens + 900) * p.input_per_m + p.out_tokens * p.output_per_m) / 1e6);
}
export function reviewBasis(id, nImages = 1) {
  const m = reviewCaps(id);
  if (!m) return '';
  if (m.free) return PROVIDERS[m.provider].free_note;
  const p = m.price;
  return `입력 약 ${(Math.max(1, nImages) * p.image_tokens + 900).toLocaleString('en-US')}토큰 × $${p.input_per_m}/100만 + 답 약 ${p.out_tokens}토큰 × $${p.output_per_m}/100만 (${m.checked} 가격표)`;
}
// 검수 항목 (지시서 7번)
export const REVIEW_CHECKS = [
  ['match', '원고의 이미지 자리와 내용이 맞는지'],
  ['artifacts', '불필요한 물체·글자·로고가 없는지'],
  ['anatomy', '사람·동물 형태가 자연스러운지'],
  ['physics', '물리적으로 이상한 곳이 없는지'],
  ['camera', '카메라 구도와 조명이 자연스러운지'],
  ['crop', '목표 비율로 잘라도 피사체가 안 잘리는지'],
  ['misleading', '실제 제품으로 오해할 요소가 없는지'],
  ['ref_match', '참고한 제품 사진과 모양·글자가 같은지'],
];
// 모델 비교 평가 항목 (지시서 8번) — [키, 이름, 낮을수록 좋은 항목인지]
export const EVAL_CRITERIA = [
  ['fit', '글과의 일치도'], ['natural', '사진의 자연스러움'], ['detail', '형태와 디테일의 정확성'],
  ['composition', '구도와 시각적 완성도'], ['ai_look', 'AI 생성 티', true], ['usable', '최종 게시용으로 쓸 수 있는지'],
];

// ───────── 상품 사진으로 장면 만들기 (1.5.1) ─────────
// 두 방식은 목적과 한계가 달라서 섞지 않음 (한 요청은 한 방식만):
//  layer     — 상품 원본 보존 합성: 기기에서 상품 사진의 배경을 지운 레이어(원본 픽셀 그대로)를 AI가 만든 '빈 배경' 위에 앱이 얹음.
//              AI에는 상품 사진을 보내지 않고 상품을 그리라고 하지도 않음. 위치·크기·회전·그림자를 바꿔도 상품 픽셀은 다시 만들지 않음
//  reference — AI 실사 장면 생성: 상품 사진을 참고 사진(대상 모양 유지)으로 보내 AI가 장면 전체를 새로 그림.
//              작은 글자·로고·버튼은 원본과 달라질 수 있어서 검수가 꼭 필요하고, 결과에는 'AI 합성 이미지'라고 남김
export const PRODUCT_MODES = {
  layer: { label: '상품 원본 보존 합성', short: '원본 보존 합성',
    hint: '상품은 네 사진 픽셀 그대로 두고 배경만 AI가 새로 만들어. 글자·로고·버튼이 바뀌지 않아. 대신 빛·그림자·크기가 어색하지 않게 직접 맞춰줘.' },
  reference: { label: 'AI 실사 장면 생성', short: 'AI 재생성',
    hint: 'AI가 상품 사진을 보고 장면 전체를 새로 그려. 더 자연스럽지만 작은 글자·로고·버튼이 원본과 달라질 수 있어 — 만든 뒤 원본과 꼭 비교해줘.' },
};
// 상품 장면으로 만든 이미지의 종류 표시 (post_images.preset · image_generations.preset). 일반 '이미지 종류(프리셋)' 목록에는 안 나옴
export const PRODUCT_PRESETS = { layer: 'pscene_layer', reference: 'pscene_ref' };
export const isProductPreset = (id) => id === PRODUCT_PRESETS.layer || id === PRODUCT_PRESETS.reference;
// 제작 목적 → 용도(비율·크기)와 연출. 모든 장면에 어수선함·흠집을 넣지 않고 목적마다 구도·빛·색을 다르게
export const PRODUCT_PURPOSES = {
  blog_body: { label: '블로그 본문', size: 0.5, look_en: 'a natural, believable lifestyle photograph for a blog article, with realistic everyday light',
    look_ko: '블로그 본문에 넣을 자연스러운 생활 사진' },
  blog_cover: { label: '블로그 대표 이미지', size: 0.45, look_en: 'a clean, inviting hero image for the top of a blog post; calm empty space on one side for a title',
    look_ko: '글 맨 위 대표 이미지 — 한쪽에 제목이 올라갈 여백' },
  product_detail: { label: '상품 상세 소개', size: 0.62, look_en: 'a clean product detail photograph with even, soft light and neutral surroundings; the product is the clear focus',
    // 원본 보존 합성의 빈 배경에는 '상품' 이야기를 하지 않음 (AI가 상품을 그리게 할 수 있어서 — 1.5.1 재검토)
    layer_look_en: 'a clean, minimal detail photograph with even, soft light, neutral surroundings and one clear, uncluttered spot in the middle ground',
    look_ko: '상품이 잘 보이는 깔끔한 상세 사진' },
  ig_feed: { label: 'SNS 게시물', size: 0.55, look_en: 'a bright, pleasant social media photo with simple styling and harmonious colors',
    look_ko: '밝고 깔끔한 SNS용 사진' },
  ad_creative: { label: '광고용 연출 이미지', size: 0.55, look_en: 'a polished advertising key visual with controlled, high-quality lighting, a premium uncluttered set and negative space for copy',
    look_ko: '광고처럼 정돈된 연출 — 문구를 얹을 여백' },
};
// 장면 템플릿 (초보자는 버튼으로 시작, 직접 적어도 됨). modes: 이 템플릿이 되는 방식
export const PRODUCT_TEMPLATES = {
  table: { label: '집 안 테이블이나 선반', modes: ['layer', 'reference'], setting_ko: '집 안 테이블이나 선반 위',
    setting_en: 'on a tabletop or shelf in a tidy, naturally furnished home interior', light_en: 'soft indoor daylight' },
  window: { label: '자연광이 들어오는 실내', modes: ['layer', 'reference'], setting_ko: '창가 자연광이 드는 실내',
    setting_en: 'in a bright room near a window', light_en: 'soft natural daylight coming from a side window, gentle shadows' },
  outdoor: { label: '야외 환경', modes: ['layer', 'reference'], setting_ko: '제품과 어울리는 야외',
    setting_en: 'outdoors in a calm setting that suits this kind of product (for example a patio table or a park bench)', light_en: 'natural outdoor light, not harsh midday sun',
    // 원본 보존 합성의 빈 배경에는 '제품' 이야기를 하지 않음 (상품을 그리게 할 수 있어서 — 1.5.1 검토)
    layer_setting_en: 'outdoors in a calm, pleasant setting such as a patio table or a park bench' },
  in_use: { label: '제품을 사용하는 상황', modes: ['layer', 'reference'], setting_ko: '이런 제품을 보통 쓰는 자리',
    setting_en: 'in the place where this kind of product is normally used, shown as an ordinary situation',
    layer_setting_en: 'in an ordinary, lived-in everyday place (follow the author\'s extra direction for the exact place, if given)',
    note_en: 'If a person is needed, show only hands or a back view with no face. It must not look like a customer review, testimonial or proof-of-use photo.',
    note_ko: '사람이 필요하면 손이나 뒷모습만 — 후기·인증 사진처럼 보이면 안 됨' },
  pet: { label: '반려동물과 함께 있는 장면', modes: ['layer', 'reference'], setting_ko: '반려동물이 근처에 있는 집 안',
    setting_en: 'at home with a pet resting calmly nearby', note_en: 'The pet stays beside the product and does not cover it; natural anatomy.',
    layer_note_en: 'The pet rests calmly to one side, away from the empty resting spot; it never steps onto, covers or casts a shadow over that spot; natural anatomy.',
    note_ko: '반려동물은 제품 옆에 — 제품을 가리지 않게' },
  studio: { label: '깔끔한 제품 스튜디오', modes: ['layer', 'reference'], setting_ko: '이음매 없는 배경지의 스튜디오',
    setting_en: 'in a clean photo studio with a seamless backdrop and a simple surface', light_en: 'a large softbox key light with gentle fill light' },
  bg_only: { label: '배경만 만들고 상품은 직접 배치', modes: ['layer'], setting_ko: '아무것도 놓이지 않은 깨끗한 바닥·배경',
    setting_en: 'an empty set: a clean surface and background with nothing standing on it', light_en: 'soft, even light' },
};
// 상품 사진을 찍은 각도 (원본 보존 합성은 배경을 같은 각도로 만들어야 어색하지 않음)
export const PRODUCT_ANGLES = {
  front: { label: '정면 (눈높이)', en: 'an eye-level, straight-on camera; the surface is seen at a shallow angle' },
  high: { label: '살짝 위에서', en: 'a slightly elevated camera, about 30 degrees above the surface' },
  top: { label: '바로 위에서', en: 'a top-down flat-lay camera directly above the surface' },
};
// 상품을 놓을 자리 (원본 보존 합성: 그 자리를 비워 둔 배경 / AI 실사 장면: 상품을 그 자리에)
export const PRODUCT_PLACES = {
  center: { label: '가운데', en: 'in the center of the frame', x: 0.5 },
  left: { label: '왼쪽', en: 'in the left third of the frame', x: 0.34 },
  right: { label: '오른쪽', en: 'in the right third of the frame', x: 0.66 },
};
// 상품 장면 설명: 사용자가 직접 적는 칸 (금지 표현 검사는 서버·화면이 같이 함)
export const PRODUCT_CUSTOM_MAX = 300;
const pickKey = (map, k, d) => (Object.prototype.hasOwnProperty.call(map, k) ? k : d);
// 상품 장면 요청을 정리 (화면·서버 같은 규칙). 모르는 값은 기본값으로, 방식이 안 되는 템플릿은 그 방식에서 고를 수 없음
export function cleanProductSpec(o) {
  const x = o && typeof o === 'object' ? o : {};
  const mode = x.mode === 'reference' ? 'reference' : 'layer';
  let template = pickKey(PRODUCT_TEMPLATES, x.template, 'table');
  if (!PRODUCT_TEMPLATES[template].modes.includes(mode)) template = 'table';
  return {
    mode, template,
    purpose: pickKey(PRODUCT_PURPOSES, x.purpose, 'blog_body'),
    angle: pickKey(PRODUCT_ANGLES, x.angle, 'front'),
    place: pickKey(PRODUCT_PLACES, x.place, 'center'),
    custom: clip(typeof x.custom === 'string' ? x.custom : '', PRODUCT_CUSTOM_MAX),
    name: clip(typeof x.name === 'string' ? x.name : '', 60),
  };
}
// 상품 장면 설계서 (일반 장면 설계서와 따로 — 상품을 '새로 그리라'와 '정확히 두라'를 섞지 않게)
// spec: cleanProductSpec 결과, refs: [{image_id, role:'subject', label}] (AI 실사 장면만), edit: 고치기(부분 수정)
/** @param {{ spec?: any, ratio?: string, size?: string, refs?: any[], post?: any, slot?: any, hide?: any[], channel?: string, edit?: string }} [o] */
export function buildProductScene({ spec, ratio, size, refs, post, slot, hide, channel, edit } = {}) {
  const s = cleanProductSpec(spec);
  const T = PRODUCT_TEMPLATES[s.template], Pp = PRODUCT_PURPOSES[s.purpose], A = PRODUCT_ANGLES[s.angle], Pl = PRODUCT_PLACES[s.place];
  const r = ratioOf(s.purpose, ratio);
  const sc = (t, n) => clip(sanitizeContext(t, hide), n);
  const roleList = s.mode === 'reference' ? (refs || []).filter((x) => x && x.role === 'subject').slice(0, 16).map((x) => ({ role: 'subject', image_id: x.image_id || '', label: clip(x.label || '', 40) })) : [];
  return {
    v: 1, kind: 'product', mode: s.mode, mode_label: PRODUCT_MODES[s.mode].label, preset: PRODUCT_PRESETS[s.mode],
    template: s.template, template_label: T.label, purpose: s.purpose, purpose_label: Pp.label, angle: s.angle, place: s.place,
    goal: `${Pp.look_ko} · ${T.label}${s.custom ? ` · ${s.custom}` : ''}`,
    setting: T.setting_ko, custom: sc(s.custom, PRODUCT_CUSTOM_MAX), size_ratio: Pp.size,
    platform: { purpose: s.purpose, label: (PURPOSES[s.purpose] || PURPOSES.blog_body).label, ratio: r, size: String(size || ''), channel: String(channel || '') },
    refs: roleList,
    edit: edit ? clip(edit, 300) : '',
    context: { title: sc((post && ((post.titles && post.titles[0]) || post.keyword)) || '', 120), heading: slot && slot.heading ? sc(slot.heading, 120) : '' },
  };
}
// 원본 보존 합성의 배경에 꼭 붙는 규칙 (사용자가 지울 수 없음)
export const LAYER_BG_RULES = [
  'A real product photo will be composited onto this image later by software. Do NOT draw the product, or any product, device, appliance, bottle, package, box, label or brand.',
  'Leave the resting spot completely empty: nothing stands on it, overlaps it or casts a shadow onto it.',
  'No text, letters, numbers, logos, labels, signage or watermarks anywhere.',
];
export const REF_SCENE_RULES = [
  'Use the attached subject reference photo(s) as the exact product. Keep its shape, proportions, colors, materials, buttons, ports, printing and logos exactly as in the photos.',
  'Do not redesign the product, do not add or remove parts, do not change its printing, and do not invent any new text or logos.',
  'Show the whole product clearly; it is the main subject and must not be cut off or hidden.',
];
// 상품 장면 설계서 → 공급자에 보낼 글
export function promptFromProductScene(sc) {
  const T = PRODUCT_TEMPLATES[sc.template] || PRODUCT_TEMPLATES.table;
  const Pp = PRODUCT_PURPOSES[sc.purpose] || PRODUCT_PURPOSES.blog_body;
  const A = PRODUCT_ANGLES[sc.angle] || PRODUCT_ANGLES.front;
  const Pl = PRODUCT_PLACES[sc.place] || PRODUCT_PLACES.center;
  const L = [];
  const layer = sc.mode === 'layer';
  if (sc.edit) {
    L.push('Edit the provided image (the first attached image). Change only what the request below asks for.');
    L.push(`Requested change (Korean): ${sc.edit}`);
    if (layer) L.push('This image is an empty background plate for product compositing — keep the empty resting spot empty and do not add any product, object, text or logo.');
    else L.push('Keep the product exactly as it is in the image (same shape, colors, buttons, printing and logos); keep the composition, background and lighting unless the request asks otherwise.');
  } else if (layer) {
    L.push(`Image type: Photograph — an empty background plate for product compositing; the final picture should read as ${Pp.layer_look_en || Pp.look_en}.`);
    L.push(`Scene: ${T.layer_setting_en || T.setting_en}.${T.light_en ? ` Light: ${T.light_en}.` : ''}`);
    L.push(`Empty resting spot: a clear, flat, uncluttered part of the surface ${Pl.en}, large enough for an object about ${Math.round(Pp.size * 100)}% of the image height to stand on.`);
    L.push(`Camera: ${A.en}. Keep perspective natural and surface lines level so a product photographed from this angle fits in.`);
    L.push('Light direction: soft and consistent, coming from one side, so a product added later can match; no colored light and no strong spotlight on the empty spot.');
    if ((T.layer_note_en || T.note_en) && sc.template !== 'in_use') L.push(T.layer_note_en || T.note_en);
    if (sc.template === 'in_use') L.push('Show only the setting itself; no people.');
  } else {
    L.push(`Image type: Photograph — ${Pp.look_en}.`);
    L.push(`Scene: the product from the reference photo(s) ${T.setting_en}, placed ${Pl.en}.${T.light_en ? ` Light: ${T.light_en}.` : ''}`);
    L.push(`Camera: ${A.en}.`);
    if (T.note_en) L.push(T.note_en);
  }
  if (sc.custom && !sc.edit) L.push(`Extra direction from the author (Korean): ${sc.custom}`);
  // 원고 제목·소제목은 보내지 않음: '제습기 고르는 법' 같은 제목을 보면 빈 배경에도 그 제품을 그리거나(원본 보존 합성), 다른 상품을 더 그릴 수 있어서
  L.push(`Format: ${sc.platform.label} — aspect ratio ${sc.platform.ratio}${sc.platform.size ? ` (${sc.platform.size})` : ''}.`);
  if (!layer && sc.refs.length) {
    L.push('Reference images (attached after the text, in this order):');
    sc.refs.forEach((x, i) => L.push(`- Image ${i + 1 + (sc.edit ? 1 : 0)}: subject reference — the exact product${x.label ? ` (${x.label})` : ''}`));
  }
  L.push('Rules:');
  for (const rule of [...(layer ? LAYER_BG_RULES : REF_SCENE_RULES), ...PROMPT_RULES]) L.push('- ' + rule);
  if (!layer) L.push('- Text and logos: keep any printing that is on the product exactly as in the reference; add no other text, captions or watermarks.');
  return L.join('\n');
}
// 상품 장면을 AI로 만들어도 되는지 (서버·화면 같은 판단)
// - '직접 찍기' 자리: 막음 (합성·AI 이미지는 네가 직접 찍은 사진이 아님)
// - AI 실사 장면: 진짜 상품 사진(직접 올림·Pexels)을 '대상 모양 유지'로 한 장 이상
// - 원본 보존 합성: 상품 사진은 AI에 보내지 않음 (참고 사진을 붙이면 거절 — 상품을 다시 그리게 되니까)
/** @param {string} mode @param {{ slotText?: string, refs?: any[] }} [o] */
export function productGate(mode, { slotText = '', refs = [] } = {}) {
  if (isOwnPhotoSlot(slotText)) return { ok: false, code: 'own_photo_slot', msg: "'직접 찍기' 자리는 네가 찍은 사진만 넣어 (합성 이미지도 직접 찍은 사진이 아니야)." };
  if (mode === 'layer') return (refs || []).length ? { ok: false, code: 'layer_no_refs', msg: '원본 보존 합성은 상품 사진을 AI에 보내지 않아 (배경만 만들어).' } : { ok: true };
  if (!(refs || []).some((x) => x && x.role === 'subject' && REAL_KINDS.includes(String(x.kind || '')))) {
    return { ok: false, code: 'product_photo_needed', msg: '진짜 상품 사진(직접 올린 사진이나 Pexels 사진)을 한 장 이상 넣어줘.' };
  }
  return { ok: true };
}
// 상품 디테일 검수 항목 (지시서 6번). 원본 보존 합성은 상품 픽셀이 원본 그대로라 일부 칸을 미리 '원본 그대로'로 채움
export const PRODUCT_CHECKS = [
  ['shape', '상품 외형과 비율'],
  ['color', '색상과 소재'],
  ['details', '버튼·포트·마감'],
  ['text', '라벨·로고·인쇄'],
  ['parts', '구성품의 수와 배치'],
  ['scale', '상품 크기와 원근감'],
  ['placement', '상품이 배경에 자연스럽게 놓여 있는지'],
  ['artifacts', '불필요한 물체나 가짜 문구'],
  ['consistency', '게시할 때 상품 정보와 모순되지 않는지'],
];
export const PRODUCT_VERDICTS = { ok: '괜찮아', issue: '문제 있어', unsure: '모르겠어' };
// 원본 보존 합성에서 미리 '괜찮아'로 채우는 칸 (픽셀을 다시 만들지 않았으니까). 상품 밝기를 바꿨으면 색은 빼고, 구성품은 배경 지우기에서 잘렸을 수 있어서 늘 직접 확인
// 줄이거나 돌리면 원본 픽셀을 다시 뽑아서 작은 글자·버튼이 흐려질 수 있어 → 그 칸은 '원본 크기 그대로'·회전 0일 때만 미리 채움 (1.5.1 검토)
export function preservedChecks(layer) {
  const L = layer && typeof layer === 'object' ? layer : {};
  const tone = L.tone && (Number(L.tone.b) || Number(L.tone.w));
  // 아주 큰 사진(긴 변 2,560px 넘음)은 줄여 읽어서 '원본 크기 그대로'여도 줄인 사진의 픽셀 — 그때도 글자·버튼은 직접 확인 (1.5.1 재검토)
  const exact = L.one === true && !Number(L.rot) && L.src_scaled !== true;
  return ['shape', ...(tone ? [] : ['color']), ...(exact ? ['details', 'text'] : [])];
}
// 검수 상태: 모든 칸이 '괜찮아'여야 승인할 수 있음 (하나라도 '문제 있어'·'모르겠어'·빈칸이면 못 함)
export function productCheckState(items) {
  const x = items && typeof items === 'object' ? items : {};
  const missing = PRODUCT_CHECKS.filter(([k]) => !PRODUCT_VERDICTS[x[k]]).map(([k]) => k);
  const issues = PRODUCT_CHECKS.filter(([k]) => x[k] === 'issue').map(([k]) => k);
  const unsure = PRODUCT_CHECKS.filter(([k]) => x[k] === 'unsure').map(([k]) => k);
  return { ok: !missing.length && !issues.length && !unsure.length, missing, issues, unsure };
}
// 상품 장면으로 만든 이미지인지 (원본 보존 합성 결과 · AI 실사 장면 결과). 이 이미지는 상품 디테일 검수를 승인하기 전에는 '사용 가능'으로 못 바꿈
export const productSceneMode = (img) => (!img ? '' : img.kind === 'composite' ? 'layer' : img.kind === 'ai' && img.composite_mode === 'reference' ? 'reference' : '');
export const productApproved = (img) => !!(img && img.product_check && img.product_check.approved === true);
// ── 원본 보존 합성의 레이어 설정 (화면이 만들고 서버가 정리해서 저장) ──
// x: 상품 가운데의 가로 위치(0~1), y: 상품 아래쪽 끝의 세로 위치(0~1), h: 상품 높이 ÷ 결과 높이, rot: 회전(도), one: 원본 크기 그대로(h 무시)
// shadow: { o 진하기 0~1, s 퍼짐 0~1, dx 빛 방향 -1~1 }, tone: 상품 밝기·색온도(-0.3~0.3, 기본 0 = 원본 그대로), bg: 배경 밝기·색온도
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const r3 = (n) => Math.round(n * 1000) / 1000;
export const LAYER_DEFAULT = { x: 0.5, y: 0.86, h: 0.5, rot: 0, shadow: { o: 0.45, s: 0.5, dx: 0 }, tone: { b: 0, w: 0 }, bg: { b: 0, w: 0 }, mask: { feather: 1, shrink: 0 } };
export function cleanLayer(o) {
  const x = o && typeof o === 'object' ? o : {};
  const sh = x.shadow && typeof x.shadow === 'object' ? x.shadow : {};
  const t = x.tone && typeof x.tone === 'object' ? x.tone : {};
  const b = x.bg && typeof x.bg === 'object' ? x.bg : {};
  const m = x.mask && typeof x.mask === 'object' ? x.mask : {};
  const D = LAYER_DEFAULT;
  return {
    x: r3(num(x.x, 0, 1, D.x)), y: r3(num(x.y, 0.05, 1, D.y)), h: r3(num(x.h, 0.05, 1.2, D.h)), rot: Math.round(num(x.rot, -45, 45, 0) * 10) / 10,
    shadow: { o: r3(num(sh.o, 0, 1, D.shadow.o)), s: r3(num(sh.s, 0, 1, D.shadow.s)), dx: r3(num(sh.dx, -1, 1, 0)) },
    tone: { b: r3(num(t.b, -0.3, 0.3, 0)), w: r3(num(t.w, -0.3, 0.3, 0)) },
    bg: { b: r3(num(b.b, -0.3, 0.3, 0)), w: r3(num(b.w, -0.3, 0.3, 0)) },
    mask: { feather: Math.round(num(m.feather, 0, 8, D.mask.feather)), shrink: Math.round(num(m.shrink, 0, 6, 0)) },
    ratio: Object.prototype.hasOwnProperty.call(RATIOS, x.ratio) ? x.ratio : '',
    one: x.one === true, // 원본 크기 그대로 (늘리거나 줄이지 않음 — 회전도 0이면 상품 칸이 원본 픽셀 그대로)
    src_scaled: x.src_scaled === true, // 상품 사진이 아주 커서(긴 변 2,560px 넘음) 줄여 읽은 사진으로 합성했는지
  };
}
// 제작 목적·놓을 자리에 맞춘 첫 레이어 설정
export function defaultLayer(spec) {
  const s = cleanProductSpec(spec);
  const L = cleanLayer({});
  L.x = PRODUCT_PLACES[s.place].x;
  L.h = PRODUCT_PURPOSES[s.purpose].size;
  L.y = s.angle === 'top' ? Math.min(0.95, 0.5 + L.h / 2) : 0.86;
  if (s.angle === 'top') L.shadow = { o: 0.3, s: 0.6, dx: 0 };
  return L;
}
// 레이어가 놓일 곳 (결과 크기 W×H, 상품 레이어 원래 크기 pw×ph — 배경을 지운 상품 영역) → 그릴 크기·위치·늘린 배율
// scale > 1 이면 상품 사진보다 크게 늘린 것 (흐려질 수 있어서 화면이 알려줌)
export function layerBox(layer, W, H, pw, ph) {
  const L = cleanLayer(layer);
  const dh = Math.max(1, L.h * H);
  const scale = dh / Math.max(1, ph);
  const dw = pw * scale;
  return { cx: L.x * W, bottom: L.y * H, w: dw, h: dh, scale, rot: L.rot, left: L.x * W - dw / 2, top: L.y * H - dh };
}
// 마스크(남길 영역)를 만든 방식 — 모두 이 기기 안에서 처리해서 외부 API를 부르지 않음 (배경 지우기 비용 0원, 청구 없음)
export const MASK_METHODS = {
  auto_u2netp: '자동 (U²-Netp 사물 분할, 이 기기에서)',
  auto_simple: '자동 (테두리 색으로 간단히)',
  alpha: '사진에 원래 있던 투명 부분',
  manual: '직접 칠함',
};
// 원본 보존 합성 결과의 출처 글: 상품 사진의 출처를 이어받음 (Pexels 사진가 등 — 사라지지 않게)
export function productAttribution(prod) {
  if (!prod) return '';
  if (prod.kind === 'stock') return `상품 사진: ${prod.author_name || '사진가'} (Pexels)`;
  if (prod.kind === 'upload' && prod.source_type === 'official') return '상품 사진: 제조사·판매처 제공 이미지';
  if (prod.kind === 'upload' && prod.source_type === 'external') return '상품 사진: 외부 제공 이미지';
  return '';
}
export function compositeLicense(prod) {
  const p = !prod ? '' : prod.kind === 'stock' ? String(prod.license || 'Pexels 라이선스') : String(prod.license || '직접 올림 (사용 권한 확인함)');
  return clip(`원본 보존 합성 (앱이 합성) · 상품: ${p} · 배경: AI 생성 이미지`, 200);
}
// 참고 사진을 작게 줄여서 받는 모델(무료 FLUX.2 klein 등)로 AI 실사 장면을 만들 때, 만들기 전에 알릴 글 (지시서 5번)
// 원본 보존 합성은 상품 사진을 AI에 보내지 않아서 해당 없음
export function refDownscaleNote(model, mode = 'reference') {
  const c = modelCaps(model);
  if (mode !== 'reference' || !c.known || !c.refSmall) return '';
  return `${c.label}은 참고 사진을 ${c.refSmall}px보다 작게 줄여서 받아. 작은 로고·상품 글자·버튼은 남지 않거나 바뀔 수 있어 — 초안으로만 쓰고, 상품 모양이 중요하면 '원본 보존 합성'을 써줘.`;
}
// 발행 준비 완료·예약·게시 완료로 바꿀 때 막는 것: 이 글의 자리(본문·본문 밖·본문에서 사라진 자리 모두)에 연결된 상품 장면 이미지 중
// 상품 디테일 검수를 승인하지 않은 것 (서버·화면·DB 같은 판단 — 사라진 자리도 보는 건 그 줄을 다시 쓰면 연결이 되살아나서, 1.5.1 검토).
// 1.5.1 재검토: 카드뉴스도 — 자리에 연결된 카드뉴스 PNG를 그릴 때 쓴 배경(bg)과 이 글의 카드뉴스 배경(deck: true 줄)
// rows: [{slot_key, image: {kind, composite_mode, product_check}, bg?: {…카드뉴스 PNG의 배경}}, {deck: true, image: {…카드뉴스 배경}}]
const unapprovedScene = (img) => !!(img && productSceneMode(img) && !productApproved(img));
export function productGateErrors(post, rows) {
  const slots = parseSlots(post && post.body);
  const byKey = new Map(slots.map((s) => [s.key, s]));
  const list = (rows || []).filter(Boolean);
  const bad = list.filter((r) => !r.deck && (unapprovedScene(r.image) || (r.image && r.image.kind === 'card' && unapprovedScene(r.bg))));
  const deck = list.some((r) => r.deck && unapprovedScene(r.image));
  const name = (r, base) => (r.image && r.image.kind === 'card' ? `${base} (카드뉴스)` : base);
  const body = bad.filter((r) => byKey.has(r.slot_key)).sort((a, b) => byKey.get(a.slot_key).n - byKey.get(b.slot_key).n).map((r) => name(r, '사진 ' + byKey.get(r.slot_key).n));
  const extra = bad.filter((r) => !byKey.has(r.slot_key) && isExtraKey(r.slot_key)).map((r) => name(r, (extraSlot(r.slot_key) || {}).label || '본문 밖 자리'));
  const gone = bad.filter((r) => !byKey.has(r.slot_key) && !isExtraKey(r.slot_key)).length;
  const ns = [...body, ...extra, ...(gone ? [`본문에서 사라진 자리 ${gone}곳`] : []), ...(deck ? ['카드뉴스 배경'] : [])];
  const n = bad.length + (deck ? 1 : 0);
  const cards = deck || bad.some((r) => r.image && r.image.kind === 'card');
  return n ? [{ code: 'product_check_needed', msg: `상품 디테일 검수를 승인하지 않은 상품 이미지가 ${n}곳 있어 (${ns.join(', ')}).`,
    fix: "이미지 미리보기의 '상품 디테일 검수'에서 원본과 비교하고 승인해줘 (본문에서 사라진 자리면 그 연결을 빼도 돼)."
      + (cards ? ' 카드뉴스는 배경으로 쓴 상품 장면을 승인하거나, 승인한 배경으로 카드를 다시 만들어줘.' : '')
      + ' 승인 전에는 발행 준비 완료·예약·게시 완료로 못 바꿔.' }] : [];
}

// 프롬프트 토큰 수 어림: 영어·숫자는 약 3.5글자에 1토큰, 한글 등은 1글자에 1.2토큰으로 넉넉하게 (실제 사용량이 오면 그걸로 다시 계산)
export function estimateTokens(text) {
  const t = String(text || '');
  let ascii = 0, other = 0;
  for (const ch of t) { if (ch.charCodeAt(0) < 128) ascii++; else other++; }
  return Math.ceil(ascii / 3.5 + other * 1.2);
}
// 임의 크기를 장당 가격표(표준 크기 세 가지)에 맞출 때: 픽셀 수가 1024x1024 이하면 그 값, 넘으면 1536x1024 값 (넉넉한 쪽)
const perImageSize = (size) => {
  if (STANDARD_SIZES.includes(size)) return size;
  const m = /^(\d+)x(\d+)$/.exec(String(size || ''));
  return m && Number(m[1]) * Number(m[2]) <= 1024 * 1024 ? '1024x1024' : '1536x1024';
};
// Gemini 가격: 등록표 값 + 설정의 가격표에서 그 모델 칸(prices[모델 id])을 고쳤으면 그 값
// 설정에서 가격을 고칠 수 있는 Gemini 모델 (등록표의 id — 서버 저장·설정 화면이 같은 목록을 씀)
export const GEMINI_PRICE_IDS = MODEL_FAMILIES.filter((f) => f.provider === 'gemini').map((f) => f.id);
export function geminiPrices(caps, prices) {
  const base = (caps && caps.gemini) || null;
  if (!base) return null;
  const ov = prices && caps && prices[caps.id] && typeof prices[caps.id] === 'object' ? prices[caps.id] : {};
  const num = (v, d) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };
  const per_image = { ...base.per_image };
  if (ov.per_image && typeof ov.per_image === 'object') for (const k of Object.keys(per_image)) per_image[k] = num(ov.per_image[k], per_image[k]);
  return {
    per_image, text_input_per_m: num(ov.text_input_per_m, base.text_input_per_m), image_input_per_image: num(ov.image_input_per_image, base.image_input_per_image),
    image_output_per_m: num(ov.image_output_per_m, base.image_output_per_m), text_output_per_m: num(ov.text_output_per_m, base.text_output_per_m),
    checked_at: ov.checked_at || caps.checked, source: ov.source || (PROVIDERS.gemini && PROVIDERS.gemini.source),
  };
}
const inImages = (mode, refs) => Math.max(0, Number(refs) || 0) + (mode === 'edit' ? 1 : 0);
// Gemini 이미지 모델은 생각(thinking)을 늘 해서 글 출력 값으로 청구되는 토큰이 더 있음 — 양은 문서에 없어서 넉넉히 1,000토큰으로 셈 (예상치, 1.5.0 검토)
export const GEMINI_THINK_TOKENS_EST = 1000;
/** @param {{ quality?: string, size?: string, promptChars?: number, promptTokens?: number, mode?: string, prices?: any, model?: string, refs?: number }} [o] */
export function estimateUsd({ quality, size, promptChars = 0, promptTokens, mode = 'generate', prices, model, refs = 0 } = {}) {
  const tokens = Math.max(0, promptTokens != null ? promptTokens : promptChars); // promptChars 만 주면 글자 수 = 토큰 수로 아주 넉넉히
  const caps = model ? modelCaps(model) : null;
  if (caps && !caps.known) return null; // 1.5.0: 모르는 모델은 계산하지 않음 (만들기 전에 거절)
  if (caps && caps.free) return caps.qualities.includes(quality) ? 0 : null;
  const nIn = inImages(mode, refs);
  if (caps && caps.provider === 'gemini') {
    if (!caps.qualities.includes(quality)) return null;
    const g = geminiPrices(caps, prices);
    const sz = caps.imageSizes ? caps.imageSizes[quality] : '';
    const out = g && g.per_image[sz];
    if (out == null) return null;
    return roundUsd(out + (tokens * g.text_input_per_m) / 1e6 + nIn * g.image_input_per_image + (GEMINI_THINK_TOKENS_EST * g.text_output_per_m) / 1e6);
  }
  if (!caps || caps.settingsPrices) {
    const t = OUTPUT_TOKENS[size] && OUTPUT_TOKENS[size][quality];
    if (t == null) return null;
    const out = (t * priceOf(prices, 'image_output_per_m')) / 1e6;
    const text = (tokens * priceOf(prices, 'text_input_per_m')) / 1e6;
    const img = (nIn * EDIT_INPUT_TOKENS_EST * priceOf(prices, 'image_input_per_m')) / 1e6;
    return roundUsd(out + text + img);
  }
  if (!caps.qualities.includes(quality)) return null;
  if (!caps.flexible && !STANDARD_SIZES.includes(size)) return null;
  const src = caps.perImage ? caps : CONSERVATIVE;
  const out = src.perImage[perImageSize(size)][quality];
  const text = (tokens * src.prices.text_input_per_m) / 1e6;
  const img = (nIn * EDIT_INPUT_TOKENS_EST * src.prices.image_input_per_m) / 1e6;
  return roundUsd(out + text + img);
}
const n$ = (x) => '$' + String(roundUsd(x));
// 예상 비용의 계산 근거 (생성 전 확인 칸에 그대로 보여줌)
export function costBasis({ quality, size, promptTokens = 0, mode = 'generate', prices, model, refs = 0 } = {}) {
  const caps = model ? modelCaps(model) : null;
  if (caps && !caps.known) return '앱이 모르는 모델이라 계산하지 않아';
  if (caps && caps.free) return PROVIDERS[caps.provider] ? PROVIDERS[caps.provider].free_note : '무료';
  const nIn = inImages(mode, refs);
  const tok = Math.max(0, Number(promptTokens) || 0).toLocaleString('en-US');
  if (caps && caps.provider === 'gemini') {
    const g = geminiPrices(caps, prices);
    const sz = caps.imageSizes ? caps.imageSizes[quality] : '';
    return `이미지 1장 ${n$(g.per_image[sz] ?? 0)}${sz ? ` (${sz})` : ''} + 설명 약 ${tok}토큰 × $${g.text_input_per_m}/100만${nIn ? ` + 넣는 이미지 ${nIn}장 × ${n$(g.image_input_per_image)}` : ''} + 생각·글 출력 약 ${GEMINI_THINK_TOKENS_EST.toLocaleString('en-US')}토큰(추정) × $${g.text_output_per_m}/100만 — Gemini 가격 페이지 ${g.checked_at} 확인값`;
  }
  if (!caps || caps.settingsPrices) {
    const t = OUTPUT_TOKENS[size] && OUTPUT_TOKENS[size][quality];
    return `출력 이미지 약 ${t == null ? '?' : t.toLocaleString('en-US')}토큰 × $${priceOf(prices, 'image_output_per_m')}/100만 + 설명 약 ${tok}토큰 × $${priceOf(prices, 'text_input_per_m')}/100만${nIn ? ` + 넣는 이미지 ${nIn}장 × 약 ${EDIT_INPUT_TOKENS_EST.toLocaleString('en-US')}토큰 × $${priceOf(prices, 'image_input_per_m')}/100만` : ''} — 토큰 가격은 설정의 가격표(${(prices && prices.checked_at) || '확인일 없음'}), 출력 토큰 수는 OpenAI 계산기 값(${PRICE_SOURCE.checked_at})${caps && caps.id === 'gpt-image-2.5' ? '이라 2.5는 추정 — 만든 뒤 실제 사용량으로 다시 계산해' : ''}`;
  }
  const src = caps.perImage ? caps : CONSERVATIVE;
  const pi = src.perImage[perImageSize(size)] ? src.perImage[perImageSize(size)][quality] : null;
  return `${caps.perImage ? '모델 페이지' : '가격을 확인 못 해서 gpt-image-1'}의 장당 ${pi == null ? '?' : n$(pi)} (${perImageSize(size)} 기준) + 설명 약 ${tok}토큰 × $${src.prices.text_input_per_m}/100만${nIn ? ` + 넣는 이미지 ${nIn}장 × 약 ${EDIT_INPUT_TOKENS_EST.toLocaleString('en-US')}토큰 × $${src.prices.image_input_per_m}/100만` : ''} (${caps.checked} 확인)`;
}
// 실제 사용량(usage) × 그 모델의 가격. 가격을 모르는 모델이면 null (예상치만 남기고 청구액은 직접 확인)
// OpenAI: { input_tokens_details: {text_tokens, image_tokens}, output_tokens }
// Gemini: { promptTokenCount, candidatesTokenCount, thoughtsTokenCount, candidatesTokensDetails: [{modality, tokenCount}] }
export function usageUsd(usage, prices, model) {
  if (!usage || typeof usage !== 'object') return null;
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  if (model) {
    const caps = modelCaps(model);
    if (!caps.known) return null;
    if (caps.free) return 0;
    if (caps.provider === 'gemini') {
      const g = geminiPrices(caps, prices);
      const det = Array.isArray(usage.candidatesTokensDetails) ? usage.candidatesTokensDetails : [];
      const outAll = n(usage.candidatesTokenCount);
      // 출력 토큰을 이미지·글로 나눈 내역이 없으면 전부 이미지 값으로 (더 비싼 쪽 — 예산을 적게 세지 않게, 1.5.0 검토)
      const outImg = det.length ? det.filter((x) => x && x.modality === 'IMAGE').reduce((a, x) => a + n(x.tokenCount), 0) : outAll;
      const outText = Math.max(0, outAll - outImg) + n(usage.thoughtsTokenCount);
      const inTok = n(usage.promptTokenCount);
      if (!inTok && !outAll) return null;
      return roundUsd((inTok * g.text_input_per_m + outImg * g.image_output_per_m + outText * g.text_output_per_m) / 1e6);
    }
    if (!caps.settingsPrices) {
      if (!caps.prices) return null;
      prices = caps.prices;
    }
  }
  const d = usage.input_tokens_details || {};
  const textIn = d.text_tokens != null || d.image_tokens != null ? n(d.text_tokens) : n(usage.input_tokens);
  const imgIn = n(d.image_tokens);
  const out = n(usage.output_tokens);
  if (!textIn && !imgIn && !out) return null;
  return roundUsd((textIn * priceOf(prices, 'text_input_per_m') + imgIn * priceOf(prices, 'image_input_per_m') + out * priceOf(prices, 'image_output_per_m')) / 1e6);
}
export const roundUsd = (x) => Math.round(Number(x) * 1e6) / 1e6;
export function fmtUsd(x) {
  if (x == null || !Number.isFinite(Number(x))) return '–';
  const n = Number(x);
  if (n === 0) return '$0';
  return '$' + n.toFixed(n < 0.1 ? 4 : n < 1 ? 3 : 2);
}

// ───────── 파일 검사 (실제 내용으로 형식 판별) ─────────
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
// 앞부분 바이트로 JPEG·PNG·WebP를 알아보고 가로·세로를 읽음. 그 밖의 형식이면 null
export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 24) return null;
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
    let animated = false;
    for (let i = 8; i + 8 <= b.length && i < 1 << 20;) {
      const len = u32be(b, i), type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      if (type === 'acTL') { animated = true; break; }
      if (type === 'IDAT' || type === 'IEND') break;
      i += 12 + len;
    }
    return { mime: 'image/png', ext: 'png', width: u32be(b, 16), height: u32be(b, 20), animated };
  }
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = u16be(b, i + 2);
      if (len < 2) return null;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { mime: 'image/jpeg', ext: 'jpg', width: u16be(b, i + 7), height: u16be(b, i + 5), animated: false };
      }
      if (m === 0xda) break; // 픽셀 데이터 시작 전까지 크기를 못 찾음
      i += 2 + len;
    }
    return { mime: 'image/jpeg', ext: 'jpg', width: 0, height: 0, animated: false };
  }
  // WebP
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP') {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8X' && b.length >= 30) return { mime: 'image/webp', ext: 'webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1, animated: (b[20] & 0x02) !== 0 };
    if (chunk === 'VP8 ' && b.length >= 30) return { mime: 'image/webp', ext: 'webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff, animated: false };
    if (chunk === 'VP8L' && b.length >= 25) {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { mime: 'image/webp', ext: 'webp', width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1, animated: false };
    }
    return null;
  }
  return null;
}
// 올린 파일이 쓸 수 있는지: 형식(실제 내용)·크기·가로세로·움직이는 이미지 여부
// maxBytes: 직접 올리기는 8MB, 앱이 만든 합성 PNG(다시 압축하지 않음)는 서버가 더 크게 (1.5.1)
export function checkImageFile(bytes, declaredMime, maxBytes = MAX_UPLOAD_BYTES) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!b.length) return { ok: false, code: 'empty', msg: '파일이 비어 있어.' };
  if (b.length > maxBytes) return { ok: false, code: 'too_big', msg: `파일이 너무 커. ${Math.round(maxBytes / 1048576)}MB까지 올릴 수 있어.` };
  const s = sniffImage(b);
  if (!s) return { ok: false, code: 'bad_type', msg: 'JPEG·PNG·WebP 이미지만 올릴 수 있어. (파일 이름만 바꾼 파일도 안 돼)' };
  if (declaredMime && ALLOWED_MIME.includes(declaredMime) && declaredMime !== s.mime) return { ok: false, code: 'type_mismatch', msg: '파일 내용과 형식이 달라. 원래 이미지 파일을 올려줘.' };
  if (s.animated) return { ok: false, code: 'animated', msg: '움직이는 이미지는 올릴 수 없어.' };
  if (s.width && s.height && (s.width > 10000 || s.height > 10000 || s.width * s.height > 50_000_000)) return { ok: false, code: 'too_many_pixels', msg: '가로·세로가 너무 큰 이미지야. 줄여서 올려줘.' };
  return { ok: true, ...s };
}

// 사진 속 숨은 정보(촬영 위치 GPS·기기·날짜 등 EXIF/XMP, 글 메모) 지우기 — 픽셀은 그대로 (다시 압축하지 않음)
// 화면은 올리기 전에 이미 새로 그려서 저장하지만, 서버에서도 한 번 더 지움. 못 읽는 구조면 원본 그대로 (stripped: false)
const ascii = (b, i, n) => { let s = ''; for (let k = 0; k < n && i + k < b.length; k++) s += String.fromCharCode(b[i + k]); return s; };
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
function joinParts(b, parts) {
  const n = parts.reduce((a, [s, e]) => a + (e - s), 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const [s, e] of parts) { out.set(b.subarray(s, e), o); o += e - s; }
  return out;
}
function stripJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts = [[0, 2]];
  let i = 2, inScan = false;
  while (i < b.length) {
    if (inScan) { // 압축된 픽셀 데이터: 다음 표시(마커)까지 그대로
      let j = i;
      for (;;) {
        if (j + 1 >= b.length) return null;
        if (b[j] === 0xff) {
          const n = b[j + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { j += 2; continue; }
          if (n === 0xff) { j += 1; continue; }
          break;
        }
        j++;
      }
      parts.push([i, j]);
      i = j; inScan = false;
      continue;
    }
    if (b[i] !== 0xff || i + 1 >= b.length) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd9) { parts.push([i, i + 2]); return joinParts(b, parts); } // 끝 — 뒤에 붙은 추가 이미지(보조 사진·정보)는 버림
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { parts.push([i, i + 2]); i += 2; continue; }
    if (i + 4 > b.length) return null;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    let keep = true;
    if (m === 0xfe) keep = false; // 메모
    else if (m >= 0xe0 && m <= 0xef) { // APPn: 색 정보(JFIF·ICC·Adobe)만 남김
      const id = ascii(b, i + 4, Math.min(len - 2, 12));
      keep = (m === 0xe0 && id.startsWith('JFIF')) || (m === 0xe2 && id.startsWith('ICC_PROFILE')) || (m === 0xee && id.startsWith('Adobe'));
    }
    if (keep) parts.push([i, i + 2 + len]);
    i += 2 + len;
    if (m === 0xda) inScan = true;
  }
  return null;
}
function stripPng(b) {
  const parts = [[0, 8]];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = u32be(b, i), type = ascii(b, i + 4, 4), end = i + 12 + len;
    if (end > b.length) return null;
    if (!['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(type)) parts.push([i, end]);
    i = end;
    if (type === 'IEND') return joinParts(b, parts);
  }
  return null;
}
function stripWebp(b) {
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const riffEnd = Math.min(b.length, 8 + u32le(b, 4));
  const chunks = [];
  let i = 12, vp8x = -1;
  while (i + 8 <= riffEnd) {
    const type = ascii(b, i, 4), size = u32le(b, i + 4), end = i + 8 + size + (size & 1);
    if (i + 8 + size > b.length) return null;
    if (type === 'VP8X') vp8x = chunks.length;
    if (type !== 'EXIF' && type !== 'XMP ') chunks.push([i, Math.min(end, b.length)]);
    i = end;
  }
  if (!chunks.length) return null;
  const body = joinParts(b, chunks);
  const out = new Uint8Array(12 + body.length);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  const total = 4 + body.length;
  out.set([total & 255, (total >> 8) & 255, (total >> 16) & 255, (total >>> 24) & 255], 4);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  out.set(body, 12);
  if (vp8x >= 0) {
    const at = 12 + chunks.slice(0, vp8x).reduce((a, [s, e]) => a + (e - s), 0);
    out[at + 8] &= ~(0x08 | 0x04); // EXIF·XMP 있음 표시 끄기
  }
  return out;
}
export function stripMetadata(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const s = sniffImage(b);
  if (!s) return { bytes: b, stripped: false };
  let out = null;
  try { out = s.mime === 'image/jpeg' ? stripJpeg(b) : s.mime === 'image/png' ? stripPng(b) : stripWebp(b); } catch { out = null; }
  const s2 = out && sniffImage(out);
  if (!s2 || s2.mime !== s.mime || s2.width !== s.width || s2.height !== s.height) return { bytes: b, stripped: false };
  return { bytes: out, stripped: true, removed: b.length - out.length };
}

// ───────── 출처·대체 텍스트·파일 이름 ─────────
export const KIND_LABEL = { ai: 'AI 생성', stock: '실제 사진(Pexels)', upload: '직접 올림', card: '카드뉴스', composite: '상품 합성' };
// ───────── 이미지 출처 (1.3.1) ─────────
// 파일을 올렸다고 직접 찍은 사진으로 보지 않음. 직접 올린 사진은 사용자가 출처를 골라야 하고(source_type), 안 고르면 '출처 확인 필요'
// AI·Pexels·카드뉴스는 만든 방법(kind)으로 출처가 정해짐. 예전에 올린 사진(source_type 빈칸)은 '출처 확인 필요'로 둠 (직접 촬영으로 소급하지 않음)
export const SOURCE_TYPES = { own: '직접 촬영', official: '공식 제공', external: '외부 제공' };  // 직접 올린 사진에서 고를 수 있는 출처
export const ORIGIN_LABEL = { own: '직접 촬영', ai: 'AI 생성', external: '외부 제공', official: '공식 제공', card: '카드뉴스', composite: '상품 사진 + AI 배경', unknown: '출처 확인 필요' };
export function originOf(img) {
  if (!img) return 'unknown';
  if (img.kind === 'ai') return 'ai';
  if (img.kind === 'card') return 'card';
  if (img.kind === 'stock') return 'external';
  if (img.kind === 'upload') return SOURCE_TYPES[img.source_type] ? img.source_type : 'unknown';
  if (img.kind === 'composite') return 'composite';   // 1.5.1 원본 보존 합성 (상품은 실제 사진, 배경은 AI)
  return 'unknown';
}
// 화면에 보여줄 출처 이름 (게시 원고 미리보기·보관함·검수 화면이 같은 이름을 씀)
export function originLabel(img) {
  const o = originOf(img);
  // 1.5.0: 실제 사진(제품 사진 등)을 참고해서 AI가 만든 이미지 — 직접 찍은 사진처럼 보이지 않게 따로 표시 (1.5.1: 'AI 합성 이미지'라고 그대로 남김)
  if (o === 'ai' && img && img.composite) return 'AI 합성 이미지 (실제 사진 참고)';
  if (o === 'composite') return '원본 보존 합성 (상품 사진 + AI 배경)';
  if (o === 'external' && img && img.kind === 'stock') return '외부 제공 (Pexels)';
  if (img && img.kind === 'upload' && o !== 'own') return ORIGIN_LABEL[o] + ' · 직접 올림';
  return ORIGIN_LABEL[o];
}
export function attributionFor(img) {
  if (!img) return '';
  if (img.provider === 'pexels') return `사진: ${img.author_name || '사진가'} (Pexels)`;
  return '';
}
export function captionHint(img) {
  if (!img) return '';
  // 1.5.1: 실제 사진을 참고한 AI 이미지는 'AI 합성 이미지'라는 이름을 캡션에도 그대로 남김 (지시서 1번 모드 B)
  if (img.kind === 'ai' && img.composite) return '※ AI 합성 이미지 — 실제 사진을 참고해 AI로 만든 연출 이미지 (실제 사용 사진 아님)';
  if (img.kind === 'ai') return '※ AI로 만든 예시 이미지';
  // 원본 보존 합성: 상품은 실제 사진 그대로, 배경은 AI — 그 장소에서 실제로 찍은 사진이 아님. 상품 사진의 출처(Pexels 사진가 등)도 같이
  if (img.kind === 'composite') return '※ 원본 보존 합성 — 실제 상품 사진에 AI로 만든 배경을 합성한 이미지 (실제 사용 사진 아님)' + (img.attribution_text ? ` · ${img.attribution_text}` : '');
  if (img.provider === 'pexels') return attributionFor(img);
  // 카드뉴스: 배경으로 쓴 이미지의 출처를 그대로 (AI 배경이면 AI 표시, Pexels 배경이면 사진가)
  if (img.kind === 'card') {
    const t = String(img.license || '') + ' ' + String(img.attribution_text || '');
    // 1.5.1: 상품 장면을 배경으로 쓴 카드도 AI 표시를 잃지 않게 (원본 보존 합성 · AI 합성 이미지)
    if (/원본 보존 합성/.test(t)) {
      const credit = /상품 사진: (?:[^·]+\(Pexels\)|제조사·판매처 제공 이미지|외부 제공 이미지)/.exec(String(img.attribution_text || ''));
      return '※ 배경은 원본 보존 합성 이미지 — 실제 상품 사진에 AI로 만든 배경을 합성 (실제 사용 사진 아님)' + (credit ? ` · ${credit[0].trim()}` : '');
    }
    if (/AI 합성 이미지|실제 사진을 참고해 AI/.test(t)) return '※ 배경은 AI 합성 이미지 — 실제 사진을 참고해 AI로 만든 연출 이미지 (실제 사용 사진 아님)';
    if (/배경: AI|AI로 만든/.test(t)) return '※ 배경은 AI로 만든 예시 이미지';
    return String(img.attribution_text || '');
  }
  // 직접 올린 사진: 고른 출처대로 (직접 촬영·출처 미확인은 캡션 없음). 구체적인 출처 이름은 이미지 검사 '참고'에서 적으라고 알려줌
  if (img.kind === 'upload' && img.source_type === 'official') return '사진: 제조사·판매처 제공 이미지';
  if (img.kind === 'upload' && img.source_type === 'external') return '사진: 외부 제공 이미지';
  return '';
}
export const altTextFor = (text) => clip(stripSlotMarks(text).replace(/\s*(사진|이미지)$/, ''), 120);
// 내려받을 파일 이름: 본문 자리는 '키워드-01-blog_body.jpg' (사진 순서), 본문 밖 자리는 '키워드-cover.jpg'
export function fileNameFor(post, n, purpose, ext) {
  const base = String((post && (post.keyword || (post.titles && post.titles[0]))) || '글공장')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '') // 보이지 않는 글자·방향 바꾸는 글자
    .replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 30) || '글공장';
  if (typeof n === 'string') return `${base}-${n.replace(/[^a-z0-9_-]/gi, '') || 'image'}.${ext || 'jpg'}`;
  return `${base}-${String(n).padStart(2, '0')}${purpose ? '-' + purpose : ''}.${ext || 'jpg'}`;
}
export const extOf = (mime) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime] || 'jpg');

// 사진 검색어 추천: 사진 자리 설명 → 원고 키워드 → 소제목 (짧게)
export function searchSuggestions(post, slot) {
  const out = [];
  const add = (s) => {
    const t = clip(String(s || '').replace(/[[\]#*]/g, ' ').replace(/\s*(하는|있는|된)?\s*(모습|사진|이미지|장면)$/, '').trim(), 40);
    if (t && !out.includes(t)) out.push(t);
  };
  if (slot) add(stripSlotMarks(slot.text));
  if (post) add(post.keyword);
  if (slot && slot.heading) add(slot.heading);
  return out.slice(0, 4);
}

// ───────── 이미지 검사 (발행 전 검사에 '확인할 것'으로 더함 — 막지는 않음) ─────────
// post: {body, content_type}, rows: 이 원고의 자리 연결 [{slot_key, image: {kind, provider, review_status, description, source_type}}]
// opts.search: 검색으로 들어오는 채널(블로그·사이트)이면 직접 촬영 사진도 알려줌, opts.naver: 네이버 블로그면 'AI 활용' 표시도 안내
export function imageChecks(post, rows, opts = {}) {
  const W = [], T = [];
  const slots = parseSlots(post && post.body);
  const byKey = new Map((rows || []).filter((r) => r && r.image).map((r) => [r.slot_key, r.image]));
  const list = (ns) => ns.map((n) => '사진 ' + n).join(', ');
  const unrev = [], rejected = [], aiReal = [], aiOwn = [], ai = [], mismatch = [], unknownSrc = [], credit = [], composite = [], layered = [], pcheck = [], layerOwn = [];
  for (const s of slots) {
    const img = byKey.get(s.key);
    if (!img) continue;
    // 1.5.1: 상품 디테일 검수를 승인하지 않은 상품 장면 이미지는 '검수 전'과 따로 셈 (승인해야 '사용 가능'이 됨 — 발행 준비 완료를 막음, app.js)
    const pmode = productSceneMode(img);
    if (pmode && !productApproved(img)) pcheck.push(s.n);
    else if (img.review_status === '검수 전') unrev.push(s.n);
    if (img.review_status === '사용 안 함') rejected.push(s.n);
    // 1.5.0: 진짜 제품 사진을 참고한 AI 합성은 '실제 상품 자리' 경고 대신 원본과 비교하라는 참고로 (그래도 '직접 찍기' 자리는 경고)
    if (img.kind === 'ai') { ai.push(s.n); if (img.composite) composite.push(s.n); if (isOwnPhotoSlot(s.text)) aiOwn.push(s.n); else if (slotRisk(s.text).real && !img.composite) aiReal.push(s.n); }
    // 1.5.1 원본 보존 합성: 상품은 실제 사진이라 '실제 상품 자리'는 채움. 배경은 AI라 '직접 찍기' 자리에는 안 맞음
    if (img.kind === 'composite') { layered.push(s.n); if (isOwnPhotoSlot(s.text)) layerOwn.push(s.n); }
    if (img.description && descriptionMismatch(s.text, img.description)) mismatch.push(s.n);
    if (originOf(img) === 'unknown') unknownSrc.push(s.n);
    if (img.kind === 'upload' && (img.source_type === 'official' || img.source_type === 'external')) credit.push(s.n);
  }
  if (pcheck.length) W.push({ code: 'product_check_needed', msg: `상품 디테일 검수를 승인하지 않은 상품 이미지가 ${pcheck.length}곳 있어 (${list(pcheck)}).`, fix: "이미지 미리보기의 '상품 디테일 검수'에서 원본과 비교하고 승인해줘. 승인 전에는 발행 준비 완료로 못 바꿔." });
  if (layerOwn.length) W.push({ code: 'composite_in_own_slot', msg: `'직접 찍기' 자리에 합성 이미지가 있어 (${list(layerOwn)}).`, fix: "배경이 AI라 직접 찍은 사진이 아니야. 휴대폰으로 찍어서 '파일 올리기'로 바꿔줘." });
  if (unrev.length) W.push({ code: 'image_unreviewed', msg: `아직 검수하지 않은 이미지가 ${unrev.length}곳 있어 (${list(unrev)}).`, fix: "이미지 미리보기에서 확인하고 '사용 가능'으로 바꿔줘." });
  if (rejected.length) W.push({ code: 'image_rejected', msg: `'사용 안 함'으로 표시한 이미지가 연결돼 있어 (${list(rejected)}).`, fix: '다른 이미지로 바꾸거나 연결을 빼줘.' });
  if (aiReal.length) W.push({ code: 'ai_real_needed', msg: `실제 상품·화면이 보여야 하는 자리에 AI 이미지가 있어 (${list(aiReal)}).`, fix: '직접 찍은 사진이나 쓸 수 있는 공식 이미지로 바꿔줘.' });
  if (aiOwn.length) W.push({ code: 'ai_in_own_slot', msg: `'직접 찍기' 자리에 AI 이미지가 있어 (${list(aiOwn)}).`, fix: "휴대폰으로 직접 찍어서 '파일 올리기'로 바꾸면 다른 글과 달라져." });
  if (ai.length && ['comparison', 'experience_review', 'pros_cons'].includes(post && post.content_type)) {
    W.push({ code: 'ai_in_product_post', msg: `상품을 다루는 글에 AI 이미지가 ${ai.length}곳 있어 (${list(ai)}).`, fix: "실제 상품 사진처럼 보이지 않게 'AI로 만든 예시 이미지' 캡션을 지우지 마. 상품 모습은 실제 사진으로." });
  }
  if (mismatch.length) W.push({ code: 'image_mismatch', msg: `사진 자리 설명과 이미지 설명이 많이 달라 (${list(mismatch)}).`, fix: '맞는 이미지인지 확인해줘.' });
  if (unknownSrc.length) W.push({ code: 'image_source_unknown', msg: `출처를 고르지 않은 사진이 ${unknownSrc.length}곳 있어 (${list(unknownSrc)}).`, fix: "이미지 미리보기에서 '직접 촬영·공식 제공·외부 제공' 중에 골라줘." });
  if (opts.search) {
    const linkedImgs = slots.map((s) => byKey.get(s.key)).filter(Boolean);
    // 직접 촬영으로 확인한 사진만 셈 (파일을 올렸다는 것만으로는 안 셈)
    const own = linkedImgs.filter((i) => originOf(i) === 'own').length;
    if (linkedImgs.length && !own) W.push({ code: 'no_own_photo', msg: '직접 촬영으로 확인한 사진이 하나도 없어 (막지는 않아). AI 이미지·남의 사진만 있으면 다른 글과 같아 보이기 쉬워.', fix: "사진 자리 하나는 휴대폰으로 직접 찍어서 '파일 올리기'로 넣고 출처를 '직접 촬영'으로 골라줘." });
  }
  if (credit.length) T.push({ code: 'image_credit', msg: `공식·외부 제공 사진이 ${credit.length}곳 있어 (${list(credit)}). 올릴 때 출처(제조사·사이트·사진가)와 이용 조건을 같이 확인해서 적어줘.` });
  if (composite.length) T.push({ code: 'ai_composite', msg: `실제 사진을 참고한 AI 합성 이미지가 ${composite.length}곳 있어 (${list(composite)}). 제품 모양·글자·버튼이 원본과 같은지 확인하고, 실제로 써본 사진처럼 쓰지 마 (캡션이 같이 들어가).` });
  if (layered.length) T.push({ code: 'layer_composite', msg: `상품 사진에 AI 배경을 합성한 이미지가 ${layered.length}곳 있어 (${list(layered)}). 상품은 원본 그대로지만 배경은 AI야 — 실제 장소·실제 사용 사진처럼 쓰지 마 (캡션이 같이 들어가).` });
  if (opts.naver && ai.length + layered.length) T.push({ code: 'ai_label', msg: `AI 이미지가 ${ai.length + layered.length}곳 있어${layered.length ? ' (AI 배경 합성 포함)' : ''}. 네이버 글쓰기에서 'AI 활용' 표시를 켜두면 안전해 (2026년 7월 기준 블로그는 자율).` });
  if (slots.length) {
    const linked = slots.filter((s) => byKey.has(s.key)).length;
    T.push({ code: 'image_progress', msg: `사진 자리 ${slots.length}곳 중 ${linked}곳에 이미지가 연결돼 있어.`, fix: linked < slots.length ? "원고 아래 '이미지'에서 만들거나 찾거나 올려서 채워줘." : '' });
  }
  return { warnings: W, tips: T };
}

// ───────── 카드뉴스 초안 ─────────
// 원고의 '카드뉴스 문구'(채널별 버전)가 있으면 그걸, 없으면 소제목·목록에서 뽑음. 사용자가 저장 전에 고침.
// 글자는 이미지 AI가 아니라 앱이 직접 그림(cards.js). 템플릿·아이콘 이름은 서버도 같은 목록으로 검사
export const CARD_TEMPLATES = { clean: '깔끔한', mark: '형광펜', dark: '어두운' };
export const CARD_RATIOS = ['4:5', '1:1'];
export const CARD_ICONS = { '': '없음', check: '체크', idea: '전구', warn: '주의', star: '별', home: '집', money: '돈', clock: '시계', list: '목록', heart: '하트' };
export const CARD_LIMITS = { slides: 12, title: 60, text: 300 };
const NO_CARD_LINE = /^\[(이미지|링크|내 경험)/;
export function deckFromPost(post, { max = 8 } = {}) {
  const title = clip((post && ((post.titles && post.titles[0]) || post.keyword)) || '', 60);
  const v = post && post.variants && Array.isArray(post.variants.cards) ? post.variants.cards : null;
  const slides = [];
  if (v && v.length) {
    for (const x of v) {
      if (typeof x === 'string') slides.push({ title: clip(x, 40), text: '' });
      else if (x && typeof x === 'object') slides.push({ title: clip(x.title || '', 40), text: clip(x.text || '', 160) });
    }
    return { source: 'variants', slides: slides.filter((s) => s.title || s.text).slice(0, max) };
  }
  slides.push({ title, text: '' });
  const lines = String((post && post.body) || '').split('\n');
  let cur = null;
  const push = () => { if (cur && (cur.items.length || cur.para)) slides.push({ title: clip(cur.h, 40), text: (cur.items.length ? cur.items.slice(0, 3).map((t) => '· ' + clip(t, 44)).join('\n') : clip(cur.para, 120)) }); };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || NO_CARD_LINE.test(l) || /^\|/.test(l)) continue;
    if (/^#{1,4}\s/.test(l)) { push(); cur = { h: stripMd(l), items: [], para: '' }; continue; }
    if (!cur) continue;
    if (/^[-•*]\s+/.test(l)) cur.items.push(stripMd(l).replace(/\[내 경험[^\]]*\]/g, '').trim());
    else if (!cur.para) cur.para = stripMd(l).replace(/\[내 경험[^\]]*\]/g, '').split(/(?<=[.!?。])\s+/)[0];
  }
  push();
  slides.push({ title: '자세한 내용은 블로그에서', text: '' });
  return { source: 'body', slides: slides.filter((s) => s.title || s.text).slice(0, max) };
}
