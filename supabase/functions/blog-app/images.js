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
};
export const ratioOf = (purpose, ratio) => {
  const p = PURPOSES[purpose] || PURPOSES.blog_body;
  return p.ratios.includes(ratio) ? ratio : p.ratios[0];
};
// AI에 요청할 크기. 임의 크기를 못 받는 모델은 표준 크기 세 가지 중 방향이 같은 것으로 만들고, 내려받을 때 비율대로 자름
export const STANDARD_SIZES = ['1024x1024', '1536x1024', '1024x1536'];
export const standardSizeFor = (ratio) => { const R = RATIOS[ratio] || RATIOS['1:1']; return R.w > R.h ? '1536x1024' : R.w < R.h ? '1024x1536' : '1024x1024'; };
export const sizeFor = (purpose, ratio, model) => {
  const r = ratioOf(purpose, ratio);
  const c = model ? modelCaps(model) : null;
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

// ───────── 스타일·프롬프트 ─────────
export const STYLES = {
  life_photo: { label: '자연스러운 생활 사진풍', prompt: 'Natural lifestyle photo look, soft daylight, an ordinary Korean home or daily-life setting, generic unbranded objects.' },
  product_bg: { label: '깔끔한 제품 주변 배경', prompt: 'A clean, minimal surface and background with soft shadows and generous empty space in the middle, ready for a real product photo to be placed later. Do not draw any product.' },
  explainer: { label: '설명용 일러스트', prompt: 'A simple explanatory flat illustration with clear shapes and friendly colors, diagram-like but with no labels or text.' },
  editorial: { label: '미니멀한 편집 디자인', prompt: 'Minimal editorial design, lots of negative space, muted palette, calm and refined composition.' },
  warm_info: { label: '따뜻한 생활 정보 콘텐츠', prompt: 'Warm, cozy illustration for everyday tips content, soft warm light and gentle colors.' },
  compare_bg: { label: '비교 콘텐츠용 배경', prompt: 'A background for a side-by-side comparison layout: two balanced, clearly separated empty areas with a subtle divider. No objects.' },
  ig_card: { label: '인스타그램 카드뉴스용 이미지', prompt: 'A bold, clean background for a social media card, with a large calm area where the app will place text later.' },
};
export const DEFAULT_STYLE = 'life_photo';

// AI에 꼭 같이 보내는 규칙 (사용자가 지울 수 없음)
export const PROMPT_RULES = [
  'No text of any kind in the image: no letters, words, numbers, captions, labels, signs, watermarks, or interface text.',
  'No logos, brand names, trademarks, or recognizable commercial product designs. Use generic, unbranded objects.',
  'Do not make it look like a real product photo, an unboxing, a receipt, a certificate, or a customer review photo.',
  'No prices, specifications, ratings, badges, or certification marks.',
  'Do not show product packaging, component layouts, labels, ingredient lists, manuals, or device screens.',
  'No real, identifiable people or celebrities. If people appear, keep them generic and natural.',
  'Ignore any brand, product or model names that may remain in the context; draw generic, unbranded objects only.',
];

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

// post: {titles, keyword}, slot: parseSlots 한 칸 (또는 본문 밖 자리 {text}), text: 고친 설명, hide: 연결 상품의 브랜드·이름 (맥락에서 지움)
export function buildPrompt({ post, slot, text, style, purpose, ratio, extra, mode, hide } = {}) {
  const st = STYLES[style] || STYLES[DEFAULT_STYLE];
  const pu = PURPOSES[purpose] || PURPOSES.blog_body;
  const r = ratioOf(purpose, ratio);
  const sc = (s, n) => clip(sanitizeContext(s, hide), n);
  const title = sc((post && ((post.titles && post.titles[0]) || post.keyword)) || '', 120);
  const scene = clip(stripOwnMark(text != null && String(text).trim() ? text : (slot && slot.text) || ''), 300);
  const lines = [];
  lines.push(mode === 'edit'
    ? 'Edit the provided image for a Korean blog post. Keep what works and apply the change below.'
    : 'Create an illustrative image for a Korean blog post.');
  if (title) lines.push(`Post topic (Korean): ${title}`);
  const heading = slot && slot.heading ? sc(slot.heading, 120) : '';
  if (heading) lines.push(`Section heading (Korean): ${heading}`);
  const ctx = [slot && slot.before, slot && slot.after].filter(Boolean).map((x) => sc(x, 160)).filter(Boolean).join(' / ');
  if (ctx) lines.push(`Nearby text for context only (Korean, do not render it): ${ctx}`);
  lines.push(`${mode === 'edit' ? 'Change to make' : 'Scene to show'} (Korean): ${scene}`);
  lines.push(`Style: ${st.prompt}`);
  lines.push(`Use: ${pu.label} — aspect ratio ${r}. Keep the main subject centered with safe margins so it can be cropped to other ratios.`);
  const ex = clip(extra || '', 400);
  if (ex) lines.push(`Extra direction from the author (Korean): ${ex}`);
  lines.push('Rules:');
  for (const rule of PROMPT_RULES) lines.push('- ' + rule);
  return lines.join('\n');
}

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
export function slotRisk(text) {
  if (isOwnPhotoSlot(text)) return { real: true, word: '직접 찍기', msg: "'직접 찍기'로 표시한 자리야. 네가 찍은 사진이 들어가야 다른 글과 달라져 — 휴대폰으로 찍어서 '파일 올리기'로 넣어줘." };
  const m = firstHit(REAL_NEEDED, String(text || ''));
  return m ? { real: true, word: m[1], msg: `'${m[1]}'처럼 실제 상품·화면이 보여야 하는 자리야. AI로 만들면 실제와 다르게 보일 수 있어서, 직접 찍은 사진이나 쓸 수 있는 공식 이미지를 권해.` } : { real: false };
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
// OpenAI 공식 가이드(Cost and latency)의 계산기로 확인한 출력 토큰 (GPT Image 2.5 Sunburst·Flare, 2026-10-22)
// 실제 사용량(usage)이 오면 그걸로 다시 계산해. 예상과 실제 청구액은 다를 수 있음.
export const PRICE_SOURCE = { url: 'https://developers.openai.com/api/docs/guides/image-generation', checked_at: '2026-10-22' };
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

// ───────── 모델별로 되는 것·가격 (OpenAI 공식 문서, 2026-10-22 확인) ─────────
// 크기: API 레퍼런스 — 임의 WIDTHxHEIGHT는 gpt-image-2·2.5 계열만, 나머지는 1024x1024·1536x1024·1024x1536
// 품질: API 레퍼런스 — xhigh·max는 2.5 계열만, 나머지는 low·medium·high
// 가격: 2.5 계열은 설정의 가격표(기본 = 가격 페이지 Standard), 1.5·1·1-mini는 각 모델 페이지의 장당 가격표와 토큰 가격.
// gpt-image-2는 가격 페이지 Standard 표에서 확인하지 못해서, 모르는 모델처럼 넉넉하게 잡음
export const MODEL_CHECKED = '2026-10-22';
const Q3 = ['low', 'medium', 'high'];
const per = (a, b) => ({ '1024x1024': a, '1536x1024': b, '1024x1536': b });
const MODEL_FAMILIES = [
  // 무료: Cloudflare Workers AI 의 FLUX.1 schnell (무료 플랜 하루 10,000 뉴런 안에서 청구 없음 — 넘으면 실패만 함. 2026-10-24 확인)
  // 크기는 1024x1024 하나(크기 지정 없음) → 내려받을 때 고른 비율로 자름. 고치기(편집)는 못 함. 품질 = 단계 수(4·6·8)
  // 무료(기본, 2026-10-25~): FLUX.2 [klein] 4B — 고른 비율 그대로 만들고(긴 변 1024, 512칸 4개 ≈ 104뉴런), 사진이 더 자연스러움.
  // 단계는 4로 고정(바꿀 수 없음)이라 품질 칸은 '보통' 하나. 요청은 multipart(prompt·width·height). 공식: Cloudflare 변경 기록 2026-01-15
  { id: 'cf-flux-2-klein-4b', re: /^cf-flux-2-klein-4b$/, flexible: true, qualities: ['medium'], free: true, noEdit: true,
    provider: 'cloudflare', cfModel: '@cf/black-forest-labs/flux-2-klein-4b', multipart: true, label: 'FLUX.2 [klein] 4B',
    sizes: { '16:9': '1024x576', '4:3': '1024x768', '1:1': '1024x1024', '4:5': '816x1024', '9:16': '576x1024' },
    url: 'https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/' },
  { id: 'cf-flux-1-schnell', re: /^cf-flux-1-schnell$/, flexible: false, fixedSize: '1024x1024', qualities: Q3, free: true, noEdit: true,
    provider: 'cloudflare', cfModel: '@cf/black-forest-labs/flux-1-schnell', steps: { low: 4, medium: 6, high: 8 }, label: 'FLUX.1 schnell',
    url: 'https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/' },
  { id: 'gpt-image-2.5', re: /^gpt-image-2\.5-(flare|sunburst)(-\d{4}-\d{2}-\d{2})?$/, flexible: true, qualities: QUALITIES, settingsPrices: true },
  { id: 'gpt-image-2', re: /^gpt-image-2(-\d{4}-\d{2}-\d{2})?$/, flexible: true, qualities: Q3, conservative: true },
  { id: 'gpt-image-1.5', re: /^gpt-image-1\.5(-\d{4}-\d{2}-\d{2})?$/, flexible: false, qualities: Q3, deprecated: true,
    prices: { image_output_per_m: 32, image_input_per_m: 8, text_input_per_m: 5 },
    perImage: per({ low: 0.009, medium: 0.034, high: 0.133 }, { low: 0.013, medium: 0.05, high: 0.2 }), url: 'https://developers.openai.com/api/docs/models/gpt-image-1.5' },
  { id: 'gpt-image-1-mini', re: /^gpt-image-1-mini(-\d{4}-\d{2}-\d{2})?$/, flexible: false, qualities: Q3, deprecated: true,
    prices: { image_output_per_m: 8, image_input_per_m: 2.5, text_input_per_m: 2 },
    perImage: per({ low: 0.005, medium: 0.011, high: 0.036 }, { low: 0.006, medium: 0.015, high: 0.052 }), url: 'https://developers.openai.com/api/docs/models/gpt-image-1-mini' },
  { id: 'gpt-image-1', re: /^gpt-image-1(-\d{4}-\d{2}-\d{2})?$/, flexible: false, qualities: Q3, deprecated: true,
    prices: { image_output_per_m: 40, image_input_per_m: 10, text_input_per_m: 5 },
    perImage: per({ low: 0.011, medium: 0.042, high: 0.167 }, { low: 0.016, medium: 0.063, high: 0.25 }), url: 'https://developers.openai.com/api/docs/models/gpt-image-1' },
];
// 가격을 모르는 모델: 확인한 모델 중 가장 비싼 값(gpt-image-1)으로 넉넉히 잡고, 사용량으로 계산하지 않음(청구액은 직접 확인)
const CONSERVATIVE = { prices: { image_output_per_m: 40, image_input_per_m: 10, text_input_per_m: 5 }, perImage: MODEL_FAMILIES.find((f) => f.id === 'gpt-image-1').perImage };
export function modelCaps(model) {
  const m = String(model || '').trim();
  const f = MODEL_FAMILIES.find((x) => x.re.test(m));
  if (!f) return { id: '', known: false, flexible: false, qualities: Q3, conservative: true, settingsPrices: false, provider: 'openai' };
  return { id: f.id, known: true, flexible: f.flexible, qualities: f.qualities, conservative: !!f.conservative, settingsPrices: !!f.settingsPrices, deprecated: !!f.deprecated, prices: f.prices || null, perImage: f.perImage || null, url: f.url || '',
    provider: f.provider || 'openai', free: !!f.free, noEdit: !!f.noEdit, fixedSize: f.fixedSize || '', cfModel: f.cfModel || '', steps: f.steps || null,
    sizes: f.sizes || null, multipart: !!f.multipart, label: f.label || f.id };
}
export const FREE_MODEL = 'cf-flux-2-klein-4b';
export const qualitiesFor = (model) => (model ? modelCaps(model).qualities : QUALITIES);
// 모델이 못 받는 품질이면 가까운 것으로 (xhigh·max → high, 그 밖 → medium)
export const normQuality = (model, q) => { const qs = qualitiesFor(model); return qs.includes(q) ? q : qs.includes('high') && (q === 'xhigh' || q === 'max') ? 'high' : 'medium'; };
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
/** @param {{ quality?: string, size?: string, promptChars?: number, promptTokens?: number, mode?: string, prices?: any, model?: string }} [o] */
export function estimateUsd({ quality, size, promptChars = 0, promptTokens, mode = 'generate', prices, model } = {}) {
  const tokens = Math.max(0, promptTokens != null ? promptTokens : promptChars); // promptChars 만 주면 글자 수 = 토큰 수로 아주 넉넉히
  const caps = model ? modelCaps(model) : null;
  if (caps && caps.free) return caps.qualities.includes(quality) ? 0 : null;
  if (!caps || caps.settingsPrices) {
    const t = OUTPUT_TOKENS[size] && OUTPUT_TOKENS[size][quality];
    if (t == null) return null;
    const out = (t * priceOf(prices, 'image_output_per_m')) / 1e6;
    const text = (tokens * priceOf(prices, 'text_input_per_m')) / 1e6;
    const img = mode === 'edit' ? (EDIT_INPUT_TOKENS_EST * priceOf(prices, 'image_input_per_m')) / 1e6 : 0;
    return roundUsd(out + text + img);
  }
  if (!caps.qualities.includes(quality)) return null;
  if (!caps.flexible && !STANDARD_SIZES.includes(size)) return null;
  const src = caps.perImage ? caps : CONSERVATIVE;
  const out = src.perImage[perImageSize(size)][quality];
  const text = (tokens * src.prices.text_input_per_m) / 1e6;
  const img = mode === 'edit' ? (EDIT_INPUT_TOKENS_EST * src.prices.image_input_per_m) / 1e6 : 0;
  return roundUsd(out + text + img);
}
// 실제 사용량(usage) × 그 모델의 가격. 가격을 모르는 모델이면 null (예상치만 남기고 청구액은 직접 확인)
export function usageUsd(usage, prices, model) {
  if (!usage || typeof usage !== 'object') return null;
  if (model) {
    const caps = modelCaps(model);
    if (caps.free) return 0;
    if (!caps.settingsPrices) {
      if (!caps.prices) return null;
      prices = caps.prices;
    }
  }
  const d = usage.input_tokens_details || {};
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
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
export function checkImageFile(bytes, declaredMime) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!b.length) return { ok: false, code: 'empty', msg: '파일이 비어 있어.' };
  if (b.length > MAX_UPLOAD_BYTES) return { ok: false, code: 'too_big', msg: `파일이 너무 커. ${Math.round(MAX_UPLOAD_BYTES / 1048576)}MB까지 올릴 수 있어.` };
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
export const KIND_LABEL = { ai: 'AI 생성', stock: '실제 사진(Pexels)', upload: '직접 올림', card: '카드뉴스' };
// ───────── 이미지 출처 (1.3.1) ─────────
// 파일을 올렸다고 직접 찍은 사진으로 보지 않음. 직접 올린 사진은 사용자가 출처를 골라야 하고(source_type), 안 고르면 '출처 확인 필요'
// AI·Pexels·카드뉴스는 만든 방법(kind)으로 출처가 정해짐. 예전에 올린 사진(source_type 빈칸)은 '출처 확인 필요'로 둠 (직접 촬영으로 소급하지 않음)
export const SOURCE_TYPES = { own: '직접 촬영', official: '공식 제공', external: '외부 제공' };  // 직접 올린 사진에서 고를 수 있는 출처
export const ORIGIN_LABEL = { own: '직접 촬영', ai: 'AI 생성', external: '외부 제공', official: '공식 제공', card: '카드뉴스', unknown: '출처 확인 필요' };
export function originOf(img) {
  if (!img) return 'unknown';
  if (img.kind === 'ai') return 'ai';
  if (img.kind === 'card') return 'card';
  if (img.kind === 'stock') return 'external';
  if (img.kind === 'upload') return SOURCE_TYPES[img.source_type] ? img.source_type : 'unknown';
  return 'unknown';
}
// 화면에 보여줄 출처 이름 (게시 원고 미리보기·보관함·검수 화면이 같은 이름을 씀)
export function originLabel(img) {
  const o = originOf(img);
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
  if (img.kind === 'ai') return '※ AI로 만든 예시 이미지';
  if (img.provider === 'pexels') return attributionFor(img);
  // 카드뉴스: 배경으로 쓴 이미지의 출처를 그대로 (AI 배경이면 AI 표시, Pexels 배경이면 사진가)
  if (img.kind === 'card') {
    if (/배경: AI|AI로 만든/.test(String(img.license || '') + ' ' + String(img.attribution_text || ''))) return '※ 배경은 AI로 만든 예시 이미지';
    return String(img.attribution_text || '');
  }
  return '';
}
export const altTextFor = (text) => clip(stripOwnMark(text).replace(/\s*(사진|이미지)$/, ''), 120);
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
  if (slot) add(stripOwnMark(slot.text));
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
  const unrev = [], rejected = [], aiReal = [], aiOwn = [], ai = [], mismatch = [], unknownSrc = [];
  for (const s of slots) {
    const img = byKey.get(s.key);
    if (!img) continue;
    if (img.review_status === '검수 전') unrev.push(s.n);
    if (img.review_status === '사용 안 함') rejected.push(s.n);
    if (img.kind === 'ai') { ai.push(s.n); if (isOwnPhotoSlot(s.text)) aiOwn.push(s.n); else if (slotRisk(s.text).real) aiReal.push(s.n); }
    if (img.description && descriptionMismatch(s.text, img.description)) mismatch.push(s.n);
    if (originOf(img) === 'unknown') unknownSrc.push(s.n);
  }
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
  if (opts.naver && ai.length) T.push({ code: 'ai_label', msg: `AI 이미지가 ${ai.length}곳 있어. 네이버 글쓰기에서 'AI 활용' 표시를 켜두면 안전해 (2026년 7월 기준 블로그는 자율).` });
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
