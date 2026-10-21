// 블로그 글공장 서버 API (1.1.2)
// - 기기별 로그인: 접속 코드로 한 번 로그인하면 기기마다 세션 토큰을 받음 (접속 코드는 기기에 남기지 않음)
// - 표는 모두 RLS로 잠겨 있고, 이 함수만 서버 키로 읽고 씀
// - '발행 준비 완료'는 서버에서도 checks.js 로 다시 검사해서 오류가 있으면 거부
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkPost, disclosureFor, USER_TRANSITIONS, CONTENT_TYPES, SCORE_FACTORS, VAGUE_DISCLOSURE } from "./checks.js";

const VERSION = "1.1.2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
// 앱을 여는 주소(쉼표로 여러 개). 기본값은 GitHub Pages 주소
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://sanghwa771004.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);
const SESSION_DAYS = 180; // 이 기간 동안 안 쓴 기기는 다시 로그인

function serviceKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === "object") {
        if (typeof o.default === "string" && o.default) return o.default;
        const first = Object.values(o).find((v) => typeof v === "string" && v);
        if (first) return first as string;
      }
    } catch (_) { /* 예전 키로 */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

const sb = createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });

function corsFor(req: Request): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-app-token,x-app-session",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  const origin = req.headers.get("origin") ?? "";
  if (origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*"))) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

class HttpError extends Error {
  constructor(public status: number, public code: string, public extra: Record<string, unknown> = {}) { super(code); }
}
function fail(status: number, code: string, extra: Record<string, unknown> = {}): never {
  throw new HttpError(status, code, extra);
}

// ───────── 입력 검증 ─────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const URLRE = /^https?:\/\/[^\s"'<>]+$/i;
const ID = /^[a-z0-9_]{2,40}$/;
type J = Record<string, unknown>;

const has = (o: unknown, k: unknown): boolean => typeof k === "string" && !!o && typeof o === "object" && Object.hasOwn(o as object, k);
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
function optUrl(v: unknown, field: string): string {
  const s = str(v, 2000).trim();
  if (!s) return "";
  if (!URLRE.test(s)) fail(400, "bad_field", { field });
  return s;
}
function optDate(v: unknown, field: string): string | null {
  if (v === null || v === "" || v === undefined) return null;
  if (typeof v === "string" && DATE.test(v) && !isNaN(Date.parse(v))) return v;
  return fail(400, "bad_field", { field });
}
function reqDate(v: unknown, field: string): string {
  const d = optDate(v, field);
  if (!d) fail(400, "bad_field", { field });
  return d as string;
}
function optInt(v: unknown, field: string, min = 0, max = 2_000_000_000): number | null {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, "bad_field", { field });
  return n;
}
function optNum(v: unknown, field: string, min = -1e12, max = 1e12): number | null {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) fail(400, "bad_field", { field });
  return n;
}
function strArr(v: unknown, field: string, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return fail(400, "bad_field", { field });
  return (v as unknown[]).map((x) => str(x, maxLen).trim()).filter(Boolean).slice(0, maxItems);
}
function oneOf<T extends string>(v: unknown, list: readonly T[], field: string): T {
  if (typeof v === "string" && (list as readonly string[]).includes(v)) return v as T;
  return fail(400, "bad_field", { field });
}
const ctypeOrEmpty = (v: unknown) => (has(CONTENT_TYPES, v) ? String(v) : "");
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

function cleanSources(v: unknown) {
  if (!Array.isArray(v)) return fail(400, "bad_field", { field: "sources" });
  return (v as J[]).slice(0, 30).map((s) => {
    const url = optUrl(s?.url, "sources");
    if (!url) fail(400, "bad_field", { field: "sources" });
    return { url, title: str(s?.title, 200), checked_at: optDate(s?.checked_at, "sources") ?? "", claim: str(s?.claim, 300) };
  });
}
const VARIANT_KEYS = ["naver_blog", "tistory", "website", "threads", "instagram", "cards", "shortform", "summary", "faq", "titles"];
function cleanVariants(v: unknown, prev: J) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail(400, "bad_field", { field: "variants" });
  const out: J = { ...(prev || {}) };
  for (const [k, val] of Object.entries(v as J)) {
    if (!VARIANT_KEYS.includes(k)) continue;
    if (val === null) { delete out[k]; continue; }
    if (typeof val === "string") out[k] = val.slice(0, 20000);
    else if (Array.isArray(val)) {
      out[k] = val.slice(0, 20).map((x) => (typeof x === "string" ? x.slice(0, 2000)
        : x && typeof x === "object" ? Object.fromEntries(Object.entries(x as J).slice(0, 6).map(([kk, vv]) => [kk.slice(0, 20), str(vv, 2000)])) : ""));
    } else if (typeof val === "object") {
      out[k] = Object.fromEntries(Object.entries(val as J).slice(0, 6).map(([kk, vv]) => [kk.slice(0, 20), str(vv, 20000)]));
    }
  }
  return out;
}

async function readJson(req: Request, limit = 200_000): Promise<J> {
  const text = await req.text();
  if (text.length > limit) fail(413, "too_large");
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object") return v as J;
  } catch (_) { /* 아래에서 처리 */ }
  return fail(400, "bad_body");
}

// ───────── 인증 ─────────
async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomCode(len = 24): string {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const a = new Uint8Array(len * 2);
  crypto.getRandomValues(a);
  let out = "";
  for (const x of a) { if (x < 248) out += alpha[x % 62]; if (out.length === len) break; }
  return out.length === len ? out : randomCode(len);
}

let codeHash: string | null = null;
let codeAt = 0;
async function codeMatches(code: string) {
  if (code.length < 16 || code.length > 128) return false;
  if (!codeHash || Date.now() - codeAt > 60_000) {
    const { data, error } = await sb.from("app_access").select("token_hash").eq("id", 1).maybeSingle();
    if (error || !data) return false;
    codeHash = String(data.token_hash);
    codeAt = Date.now();
  }
  return sameHex(await sha256hex(code), codeHash);
}

async function ipHash(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
  return (await sha256hex("gf:" + ip)).slice(0, 32);
}
// 접속 코드를 15분에 10번(전체 100번) 넘게 틀리면 잠시 막음
async function isLimited(ih: string) {
  const since = new Date(Date.now() - 15 * 60e3).toISOString();
  const [mine, all] = await Promise.all([
    sb.from("auth_failures").select("id", { count: "exact", head: true }).eq("ip_hash", ih).gte("at", since),
    sb.from("auth_failures").select("id", { count: "exact", head: true }).gte("at", since),
  ]);
  return (mine.count ?? 0) >= 10 || (all.count ?? 0) >= 100;
}
async function recordFailure(ih: string) {
  await sb.from("auth_failures").insert({ ip_hash: ih });
  if (Math.random() < 0.05) await sb.from("auth_failures").delete().lt("at", new Date(Date.now() - 86400e3).toISOString());
}

type Auth = { kind: "session" | "legacy"; sessionId?: string };
async function authenticate(req: Request): Promise<Auth | Response> {
  const s = req.headers.get("x-app-session") ?? "";
  if (s) {
    if (s.length < 20 || s.length > 200) return json({ error: "unauthorized" }, 401);
    const { data } = await sb.from("app_sessions").select("id, revoked_at, last_used_at, created_at").eq("token_hash", await sha256hex(s)).maybeSingle();
    if (!data || data.revoked_at) return json({ error: "unauthorized" }, 401);
    const last = Date.parse(data.last_used_at ?? data.created_at);
    if (Date.now() - last > SESSION_DAYS * 86400e3) {
      await sb.from("app_sessions").update({ revoked_at: nowIso() }).eq("id", data.id);
      return json({ error: "unauthorized", reason: "expired" }, 401);
    }
    if (!data.last_used_at || Date.now() - last > 10 * 60e3) {
      await sb.from("app_sessions").update({ last_used_at: nowIso() }).eq("id", data.id);
    }
    return { kind: "session", sessionId: data.id };
  }
  // 예전 화면(1.0.0)은 접속 코드를 그대로 머리글에 실어 보냄
  const t = req.headers.get("x-app-token") ?? "";
  if (!t) return json({ error: "unauthorized" }, 401);
  const ih = await ipHash(req);
  if (await isLimited(ih)) return json({ error: "rate_limited" }, 429);
  if (await codeMatches(t)) return { kind: "legacy" };
  await recordFailure(ih);
  return json({ error: "unauthorized" }, 401);
}

// ───────── 공통 조회 ─────────
const byId = (rows: unknown[] | null): Record<string, J> => Object.fromEntries(((rows ?? []) as J[]).map((r) => [String(r.id), r]));
async function catalog() {
  const [programs, channels, compat] = await Promise.all([
    sb.from("programs").select("*"),
    sb.from("channels").select("*"),
    sb.from("program_channels").select("*"),
  ]);
  for (const r of [programs, channels, compat]) if (r.error) throw r.error;
  return { programs: byId(programs.data), channels: byId(channels.data), compat: compat.data ?? [] };
}
async function getPost(id: string) {
  const { data, error } = await sb.from("posts").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  return data as J;
}
async function runChecks(post: J) {
  const [cat, links, pp] = await Promise.all([
    catalog(),
    sb.from("links").select("*").eq("post_id", post.id),
    sb.from("post_products").select("sort, products(*)").eq("post_id", post.id).order("sort"),
  ]);
  if (links.error) throw links.error;
  if (pp.error) throw pp.error;
  const products = (pp.data ?? []).map((x: J) => x.products).filter(Boolean);
  const result = checkPost(post, { ...cat, links: links.data ?? [], products, today: kstToday() });
  return { result, disclosure: disclosureFor(post.program_ids as string[], cat.programs).text };
}
// PostgREST는 한 번에 최대 1000줄(Supabase 기본 설정)만 돌려줘서, 나눠서 끝까지 가져옴
// deno-lint-ignore no-explicit-any
async function fetchAll(table: string, order: [string, boolean][], build?: (q: any) => any): Promise<J[]> {
  const out: J[] = [];
  const size = 1000;
  for (let from = 0; from < 200_000; from += size) {
    // deno-lint-ignore no-explicit-any
    let q: any = sb.from(table).select("*");
    if (build) q = build(q);
    for (const [col, asc] of order) q = q.order(col, { ascending: asc });
    const { data, error } = await q.range(from, from + size - 1);
    if (error) throw error;
    out.push(...((data ?? []) as J[]));
    if (!data || data.length < size) break;
  }
  return out;
}
// 수익 모델·채널·조합·상품이 바뀌면 '발행 준비 완료·예약' 원고를 다시 검사해서, 걸리면 '검수 필요'로 되돌림
async function recheckReadyPosts(match: (p: J) => boolean): Promise<string[]> {
  const { data, error } = await sb.from("posts").select("*").in("stage", ["ready", "scheduled"]).is("deleted_at", null).limit(500);
  if (error) throw error;
  const demoted: string[] = [];
  for (const p of (data ?? []) as J[]) {
    if (!match(p)) continue;
    const { result } = await runChecks(p);
    if (result.errors.length) {
      const r = await sb.from("posts").update({ stage: "review" }).eq("id", p.id).in("stage", ["ready", "scheduled"]);
      if (r.error) throw r.error;
      demoted.push(String(p.id));
    }
  }
  return demoted;
}
function rpcError(error: { message?: string; code?: string } | null): never {
  const m = String(error?.message ?? "");
  if (m.startsWith("incompatible:")) fail(400, "incompatible", { detail: m.replace("incompatible:", "").trim() });
  if (/topic already has a post/.test(m)) fail(409, "topic_used");
  if (/not found/.test(m)) fail(404, "not_found");
  if (/cannot be|not pending|not failed|not waiting/.test(m)) fail(409, "bad_state");
  if (/unknown channel|is required/.test(m)) fail(400, "bad_field");
  throw error;
}
async function assertCompat(progs: string[], ch: string) {
  const cat = await catalog();
  if (!has(cat.channels, ch)) fail(400, "bad_field", { field: "channel_id" });
  for (const p of progs) if (!has(cat.programs, p)) fail(400, "bad_field", { field: "program_ids" });
  const { error } = await sb.rpc("assert_compat", { progs, ch });
  if (error) rpcError(error);
  return cat;
}
const legacyNames = (cat: { programs: Record<string, J>; channels: Record<string, J> }, progs: string[], ch: string) => ({
  platform: String(cat.channels[ch]?.name ?? ""),
  money: progs.map((p) => cat.programs[p]?.name).filter(Boolean).join(", "),
});
// 예전 화면이 보내는 글자값 → 새 id
const LEGACY_CHANNEL: Record<string, string> = { "네이버 블로그": "naver_blog", "티스토리": "tistory", "워드프레스 / 구글 블로그": "website" };
const LEGACY_PROGRAM: Record<string, string> = { "쿠팡파트너스": "coupang_partners", "토스 쇼핑 제휴": "toss_sharelink", "애드센스(정보성 글)": "google_adsense" };

async function jobLimits(adding = 1) {
  const [pending, day] = await Promise.all([
    sb.from("requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("requests").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86400e3).toISOString()),
  ]);
  if ((pending.count ?? 0) + adding > 30) fail(429, "too_many_jobs");
  if ((day.count ?? 0) + adding > 60) fail(429, "too_many_jobs_today");
}

// ───────── 경로 처리 ─────────
type Ctx = { req: Request; auth: Auth; params: string[]; url: URL };

async function getState(c: Ctx) {
  const since30 = new Date(Date.now() - 30 * 86400e3).toISOString();
  const [posts, trash, jobs, settings, runs, channels, programs, compat, topics, imports] = await Promise.all([
    sb.from("posts").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(500),
    sb.from("posts").select("id, titles, keyword, deleted_at").not("deleted_at", "is", null).gte("deleted_at", since30).order("deleted_at", { ascending: false }).limit(50),
    sb.from("requests").select("*").order("created_at", { ascending: false }).limit(100),
    sb.from("settings").select("*").eq("id", 1).maybeSingle(),
    sb.from("runs").select("*").order("ran_at", { ascending: false }).limit(10),
    sb.from("channels").select("*").order("sort"),
    sb.from("programs").select("*").order("sort"),
    sb.from("program_channels").select("*"),
    sb.from("topics").select("*").order("created_at", { ascending: false }).limit(300),
    sb.from("imports").select("id, filename, source_label, program_id, channel_id, rows_total, rows_ok, rows_dup, rows_changed, rows_err, errors, status, created_at, cancelled_at").order("created_at", { ascending: false }).limit(30),
  ]);
  for (const r of [posts, trash, jobs, settings, runs, channels, programs, compat, topics, imports]) if (r.error) throw r.error;
  // 1000줄이 넘어도 빠지지 않게 끝까지 (링크·상품이 잘리면 '링크 없음' 같은 잘못된 오류가 뜸)
  const [products, pp, links] = await Promise.all([
    fetchAll("products", [["updated_at", false], ["id", true]]),
    fetchAll("post_products", [["post_id", true], ["sort", true], ["product_id", true]]),
    fetchAll("links", [["post_id", true], ["sort", true], ["id", true]]),
  ]);
  return json({
    version: VERSION, now: nowIso(), today: kstToday(), auth: c.auth.kind,
    posts: posts.data, trash: trash.data, jobs: jobs.data, settings: settings.data, runs: runs.data,
    channels: channels.data, programs: programs.data, compat: compat.data, topics: topics.data, products,
    post_products: pp, links, imports: imports.data,
    requests: jobs.data, lastRun: runs.data?.[0] ?? null, // 예전 화면 호환
  });
}

async function getStats(c: Ctx) {
  const from = c.url.searchParams.get("from");
  const to = c.url.searchParams.get("to");
  const { data, error } = await sb.rpc("stats", { d_from: from ? reqDate(from, "from") : null, d_to: to ? reqDate(to, "to") : null });
  if (error) throw error;
  return json({ stats: data });
}

// 백업: 표마다 1000줄씩 나눠서 끝까지 담고, 표마다 줄 수를 같이 적음
const EXPORT_TABLES: [string, [string, boolean][]][] = [
  ["posts", [["id", true]]], ["requests", [["id", true]]], ["settings", [["id", true]]], ["runs", [["id", true]]],
  ["channels", [["id", true]]], ["programs", [["id", true]]], ["program_channels", [["program_id", true], ["channel_id", true]]],
  ["topics", [["id", true]]], ["products", [["id", true]]], ["post_products", [["post_id", true], ["product_id", true]]],
  ["links", [["id", true]]], ["metrics", [["id", true]]], ["imports", [["id", true]]],
];
async function getExport(_c: Ctx) {
  const out: J = { exported_at: nowIso(), version: VERSION, note: "접속 코드·기기 로그인 정보는 들어 있지 않아." };
  const counts: J = {};
  for (const [t, order] of EXPORT_TABLES) {
    const rows = await fetchAll(t, order);
    out[t] = rows;
    counts[t] = rows.length;
  }
  out.counts = counts;
  return json(out);
}

// 기기·접속 코드
async function login(req: Request) {
  const ih = await ipHash(req);
  if (await isLimited(ih)) return json({ error: "rate_limited" }, 429);
  const b = await readJson(req, 10_000);
  const code = str(b.code, 200).trim();
  if (!code || !(await codeMatches(code))) {
    await recordFailure(ih);
    return json({ error: (await isLimited(ih)) ? "rate_limited" : "unauthorized" }, 401);
  }
  const token = randomToken(32);
  const { error } = await sb.from("app_sessions").insert({ token_hash: await sha256hex(token), label: str(b.label, 60).trim() || "기기", last_used_at: nowIso() });
  if (error) throw error;
  return json({ session: token });
}
async function logout(c: Ctx) {
  if (c.auth.sessionId) await sb.from("app_sessions").update({ revoked_at: nowIso() }).eq("id", c.auth.sessionId);
  return json({ ok: true });
}
async function listSessions(c: Ctx) {
  const { data, error } = await sb.from("app_sessions").select("id, label, created_at, last_used_at").is("revoked_at", null).order("last_used_at", { ascending: false }).limit(50);
  if (error) throw error;
  return json({ sessions: (data ?? []).map((s: J) => ({ ...s, current: s.id === c.auth.sessionId })) });
}
async function revokeSession(c: Ctx) {
  const { data, error } = await sb.from("app_sessions").update({ revoked_at: nowIso() }).eq("id", c.params[0]).is("revoked_at", null).select("id").maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  return json({ ok: true, self: c.params[0] === c.auth.sessionId });
}
async function rotateCode(c: Ctx) {
  const b = await readJson(c.req, 10_000);
  const code = randomCode(24);
  const { error } = await sb.from("app_access").update({ token_hash: await sha256hex(code) }).eq("id", 1);
  if (error) throw error;
  codeHash = null;
  let revoked = 0;
  if (b.revoke_others === true) {
    let q = sb.from("app_sessions").update({ revoked_at: nowIso() }).is("revoked_at", null);
    if (c.auth.sessionId) q = q.neq("id", c.auth.sessionId);
    const r = await q.select("id");
    if (r.error) throw r.error;
    revoked = (r.data ?? []).length;
  }
  return json({ code, revoked });
}

// 원고
const CONTENT_KEYS = new Set(["titles", "body", "threads", "instagram", "experience", "content_type", "sources", "variants", "summary"]);
const RECHECK_KEYS = new Set(["titles", "body", "experience", "content_type", "sources", "variants", "channel_id", "program_ids", "keyword"]);
const LIVE = ["published", "collecting", "analyzed"];

async function createPost(c: Ctx) {
  const b = await readJson(c.req, 100_000);
  if (b.mode === "manual") {
    // AI 없이 '이미 쓴 글'을 기록 (예전에 올린 글의 성과를 추적할 때)
    const title = str(b.title, 200).trim();
    if (!title) fail(400, "bad_field", { field: "title" });
    const ch = str(b.channel_id, 40) || "naver_blog";
    const progs = Array.isArray(b.program_ids) ? strArr(b.program_ids, "program_ids", 10, 40) : [];
    const cat = await assertCompat(progs, ch);
    const blogUrl = optUrl(b.blog_url, "blog_url");
    const publishedOn = optDate(b.published_on, "published_on");
    const row = {
      keyword: str(b.keyword, 120).trim() || title, titles: [title], body: str(b.body, 60000), channel_id: ch, program_ids: progs,
      category: str(b.category, 60).trim(), content_type: ctypeOrEmpty(b.content_type),
      blog_url: blogUrl, published_on: publishedOn, publish_date: publishedOn,
      stage: blogUrl && publishedOn ? "published" : "review", source: "manual", ...legacyNames(cat, progs, ch),
    };
    const { data, error } = await sb.from("posts").insert(row).select().single();
    if (error) throw error;
    return json({ post: data });
  }
  await jobLimits(1);
  const p: J = {
    keyword: str(b.keyword, 120).trim(),
    title: str(b.title, 200).trim(),
    channel_id: str(b.channel_id, 40),
    program_ids: Array.isArray(b.program_ids) ? strArr(b.program_ids, "program_ids", 10, 40) : undefined,
    content_type: ctypeOrEmpty(b.content_type),
    category: str(b.category, 60).trim(),
    topic_id: isUuid(b.topic_id) ? b.topic_id : "",
    experience: str(b.experience, 3000),
    ref: str(b.ref, 6000),
    notes: str(b.notes, 1000),
    link: optUrl(b.link, "link"),
    len: ["1500", "2500", "3500"].includes(String(b.len)) ? String(b.len) : "",
    products: Array.isArray(b.products) ? (b.products as unknown[]).filter(isUuid).slice(0, 10) : [],
  };
  if (!p.keyword) fail(400, "bad_field", { field: "keyword" });
  if (p.content_type === "experience_review" && !String(p.experience).trim()) fail(400, "needs_experience");
  if (p.channel_id || p.program_ids) {
    const s = await sb.from("settings").select("default_channel, default_programs").eq("id", 1).single();
    await assertCompat((p.program_ids as string[] | undefined) ?? (s.data?.default_programs as string[]) ?? [], String(p.channel_id || s.data?.default_channel || "naver_blog"));
  }
  const { data, error } = await sb.rpc("request_post", { p });
  if (error) rpcError(error);
  const row = (data as J[])[0];
  return json({ post_id: row.post_id, job_id: row.job_id });
}

async function patchPost(c: Ctx) {
  const id = c.params[0];
  const b = await readJson(c.req, 200_000);
  const post = await getPost(id);
  const patch: J = {};

  if ("titles" in b) patch.titles = strArr(b.titles, "titles", 5, 300);
  if ("body" in b) {
    if (typeof b.body !== "string" || b.body.length > 60000) fail(400, "bad_field", { field: "body" });
    patch.body = b.body;
  }
  if ("threads" in b) patch.threads = str(b.threads, 2000);
  if ("instagram" in b) patch.instagram = str(b.instagram, 3000);
  if ("experience" in b) patch.experience = str(b.experience, 3000);
  if ("category" in b) patch.category = str(b.category, 60).trim();
  if ("keyword" in b) patch.keyword = str(b.keyword, 120).trim();
  if ("summary" in b) patch.summary = str(b.summary, 2000);
  if ("content_type" in b) {
    if (b.content_type !== "" && !has(CONTENT_TYPES, b.content_type)) fail(400, "bad_field", { field: "content_type" });
    patch.content_type = String(b.content_type);
  }
  if ("sources" in b) patch.sources = cleanSources(b.sources);
  if ("variants" in b) patch.variants = cleanVariants(b.variants, post.variants as J);
  if ("effort_minutes" in b) patch.effort_minutes = optInt(b.effort_minutes, "effort_minutes", 0, 100000);
  if ("topic_id" in b) patch.topic_id = isUuid(b.topic_id) ? b.topic_id : null;
  if ("publish_date" in b) patch.publish_date = optDate(b.publish_date, "publish_date");
  if ("blog_url" in b) patch.blog_url = optUrl(b.blog_url, "blog_url");
  if ("published_on" in b) patch.published_on = optDate(b.published_on, "published_on");

  if ("channel_id" in b || "program_ids" in b) {
    const ch = "channel_id" in b ? str(b.channel_id, 40) : String(post.channel_id ?? "");
    const progs = "program_ids" in b ? strArr(b.program_ids, "program_ids", 10, 40) : ((post.program_ids as string[]) ?? []);
    const cat = await assertCompat(progs, ch);
    Object.assign(patch, { channel_id: ch, program_ids: progs }, legacyNames(cat, progs, ch));
  }

  // 예전 화면(1.0.0): 링크 한 칸
  if ("link" in b) {
    const url = optUrl(b.link, "link");
    patch.link = url;
    if (url) {
      const { data: ex } = await sb.from("links").select("id").eq("post_id", id).eq("url", url).maybeSingle();
      if (!ex) {
        const { error } = await sb.from("links").insert({ post_id: id, url, program_id: (post.program_ids as string[])?.[0] ?? null, channel_id: post.channel_id });
        if (error) throw error;
      }
    }
  }

  if (["queued", "writing", "researching"].includes(String(post.stage)) && Object.keys(patch).some((k) => CONTENT_KEYS.has(k))) fail(409, "busy");

  const merged = { ...post, ...patch };
  let checked = false;
  const stage: string | null = "stage" in b ? str(b.stage, 20) : null;

  if (!stage && "status" in b && c.auth.kind === "legacy") {
    // 1.0 화면의 '발행 완료' 체크는 상태 규칙·발행 전 검사를 건너뛰어서 더는 받지 않음 (앱을 다시 열면 새 화면으로 바뀜)
    fail(409, "update_app");
  } else if (stage && stage !== post.stage) {
    const allowed = (USER_TRANSITIONS as Record<string, string[]>)[String(post.stage)] || [];
    if (!allowed.includes(stage)) fail(409, "bad_transition", { from: post.stage, to: stage });
    if (stage === "queued") fail(400, "use_retry");
    if (stage === "scheduled" && !merged.publish_date) fail(400, "need_publish_date");
    if (stage === "published" && (!merged.blog_url || !merged.published_on)) fail(400, "need_published_info");
    // 발행 준비 완료·예약·게시 완료로 갈 때는 언제나 다시 검사 (그사이 정책·조합·상품 정보나 가격 확인일이 바뀌었을 수 있음)
    if (stage === "ready" || stage === "scheduled" || (stage === "published" && !LIVE.includes(String(post.stage)))) {
      const { result, disclosure } = await runChecks(merged);
      if (result.errors.length) fail(409, "check_failed", { errors: result.errors });
      patch.disclosure_text = disclosure;
      patch.disclosure_at = nowIso();
      checked = true;
    }
    patch.stage = stage;
  }

  // 발행 준비가 끝난 글의 내용이 바뀌면 다시 검사해서, 오류가 생기면 '검수 필요'로 되돌림
  let demoted: unknown = null;
  const finalStage = String(patch.stage ?? post.stage);
  if (!checked && Object.keys(patch).some((k) => RECHECK_KEYS.has(k)) && ["ready", "scheduled"].includes(finalStage)) {
    const { result, disclosure } = await runChecks({ ...post, ...patch });
    if (result.errors.length) { patch.stage = "review"; demoted = result.errors; }
    else { patch.disclosure_text = disclosure; patch.disclosure_at = nowIso(); }
  }

  if (!Object.keys(patch).length) fail(400, "empty");
  const { data, error } = await sb.from("posts").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return json({ post: data, demoted });
}

async function deletePost(c: Ctx) {
  const id = c.params[0];
  await getPost(id);
  const { error } = await sb.from("posts").update({ deleted_at: nowIso() }).eq("id", id);
  if (error) throw error;
  await sb.from("requests").update({ status: "cancelled", done_at: nowIso(), note: "글을 지워서 취소" })
    .eq("post_id", id).eq("status", "pending").is("started_at", null);
  // 기다리던 원고 요청이 취소됐으니 '작업 실패'로 표시 → 휴지통에서 되살린 뒤 '다시 요청'할 수 있음
  await sb.from("posts").update({ stage: "failed", error: "글을 지워서 요청을 취소했어. 되살렸으면 '다시 요청'을 눌러줘." })
    .eq("id", id).eq("stage", "queued");
  return json({ ok: true });
}
async function restorePost(c: Ctx) {
  const { data, error } = await sb.from("posts").update({ deleted_at: null }).eq("id", c.params[0]).not("deleted_at", "is", null).select().maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  return json({ post: data });
}
async function retryPost(c: Ctx) {
  await jobLimits(1);
  const post = await getPost(c.params[0]);
  if (post.content_type === "experience_review" && !String(post.experience || "").trim()) fail(400, "needs_experience");
  const { data, error } = await sb.rpc("post_retry", { target: c.params[0] });
  if (error) rpcError(error);
  return json({ job_id: data });
}

// 상품
const TRUST = ["미검증", "출처 있음", "확인 완료"] as const;
function productFields(b: J, partial: boolean) {
  const p: J = {};
  if (!partial || "name" in b) { p.name = str(b.name, 200).trim(); if (!p.name) fail(400, "bad_field", { field: "name" }); }
  for (const [k, max] of [["brand", 100], ["model", 100], ["category", 60], ["pros", 2000], ["cons", 2000], ["compare_with", 500], ["notes", 2000]] as const) {
    if (!partial || k in b) p[k] = str(b[k], max).trim();
  }
  if (!partial || "price" in b) p.price = optNum(b.price, "price", 0, 1e10);
  if (!partial || "price_checked_at" in b) p.price_checked_at = optDate(b.price_checked_at, "price_checked_at");
  if (!partial || "price_source_url" in b) p.price_source_url = optUrl(b.price_source_url, "price_source_url");
  if (!partial || "info_checked_at" in b) p.info_checked_at = optDate(b.info_checked_at, "info_checked_at");
  if (!partial || "source_urls" in b) p.source_urls = Array.isArray(b.source_urls) ? strArr(b.source_urls, "source_urls", 10, 2000).map((u) => optUrl(u, "source_urls")) : [];
  if (!partial || "specs" in b) {
    p.specs = Array.isArray(b.specs) ? (b.specs as J[]).slice(0, 30).map((s) => ({ name: str(s?.name, 60).trim(), value: str(s?.value, 200).trim(), source_url: optUrl(s?.source_url, "specs") })).filter((s) => s.name) : [];
  }
  if (!partial || "used_by_me" in b) p.used_by_me = b.used_by_me === true;
  if ("trust" in b) p.trust = oneOf(b.trust, TRUST, "trust");
  // 가격을 넣었는데 확인 날짜가 없으면 오늘 확인한 것으로 기록
  if ("price" in p && p.price != null && !p.price_checked_at) p.price_checked_at = kstToday();
  if (!partial && !("trust" in b)) p.trust = (p.source_urls as string[]).length ? "출처 있음" : "미검증";
  return p;
}
async function createProduct(c: Ctx) {
  const b = await readJson(c.req, 50_000);
  const fields = productFields(b, false);
  if (isUuid(b.attach_to)) await getPost(b.attach_to);
  const { data, error } = await sb.from("products").insert(fields).select().single();
  if (error) throw error;
  if (isUuid(b.attach_to)) {
    const { count } = await sb.from("post_products").select("product_id", { count: "exact", head: true }).eq("post_id", b.attach_to);
    const r = await sb.from("post_products").insert({ post_id: b.attach_to, product_id: data.id, sort: count ?? 0 });
    if (r.error) throw r.error;
  }
  return json({ product: data });
}
async function patchProduct(c: Ctx) {
  const b = await readJson(c.req, 50_000);
  const fields = productFields(b, true);
  if (!Object.keys(fields).length) fail(400, "empty");
  const { data, error } = await sb.from("products").update(fields).eq("id", c.params[0]).select().maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  // 가격·확인일·출처가 바뀌면 이 상품이 연결된 발행 준비 원고를 다시 검사
  const { data: used, error: e2 } = await sb.from("post_products").select("post_id").eq("product_id", c.params[0]);
  if (e2) throw e2;
  const ids = new Set(((used ?? []) as J[]).map((x) => String(x.post_id)));
  const demoted_posts = ids.size ? await recheckReadyPosts((p) => ids.has(String(p.id))) : [];
  return json({ product: data, demoted_posts });
}
async function deleteProduct(c: Ctx) {
  const { count } = await sb.from("post_products").select("post_id", { count: "exact", head: true }).eq("product_id", c.params[0]);
  if ((count ?? 0) > 0) fail(409, "in_use");
  const { data, error } = await sb.from("products").delete().eq("id", c.params[0]).select("id").maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  return json({ ok: true });
}
async function attachProduct(c: Ctx) {
  const b = await readJson(c.req, 10_000);
  await getPost(c.params[0]);
  if (!isUuid(b.product_id)) fail(400, "bad_field", { field: "product_id" });
  const { count } = await sb.from("post_products").select("product_id", { count: "exact", head: true }).eq("post_id", c.params[0]);
  const { error } = await sb.from("post_products").upsert({ post_id: c.params[0], product_id: b.product_id, sort: count ?? 0 }, { onConflict: "post_id,product_id", ignoreDuplicates: true });
  if (error) throw error;
  return json({ ok: true });
}
async function detachProduct(c: Ctx) {
  const { error } = await sb.from("post_products").delete().eq("post_id", c.params[0]).eq("product_id", c.params[1]);
  if (error) throw error;
  return json({ ok: true, demoted: await recheckAfterLinkChange(c.params[0]) });
}

// 링크 (바뀌면 '발행 준비 완료' 글은 다시 검사)
async function recheckAfterLinkChange(postId: string) {
  const { data: post } = await sb.from("posts").select("*").eq("id", postId).is("deleted_at", null).maybeSingle();
  if (!post || !["ready", "scheduled"].includes(String(post.stage))) return null;
  const { result } = await runChecks(post);
  if (result.errors.length) {
    await sb.from("posts").update({ stage: "review" }).eq("id", postId);
    return result.errors;
  }
  return null;
}
async function addLink(c: Ctx) {
  const b = await readJson(c.req, 10_000);
  const post = await getPost(c.params[0]);
  const url = optUrl(b.url, "url");
  if (!url) fail(400, "bad_field", { field: "url" });
  const cat = await catalog();
  const program = has(cat.programs, b.program_id) ? b.program_id : (post.program_ids as string[])?.[0] ?? null;
  const channel = has(cat.channels, b.channel_id) ? b.channel_id : post.channel_id;
  const product = isUuid(b.product_id) ? b.product_id : null;
  const { count } = await sb.from("links").select("id", { count: "exact", head: true }).eq("post_id", c.params[0]);
  const { data, error } = await sb.from("links").insert({ post_id: c.params[0], url, cta: str(b.cta, 80).trim(), program_id: program, channel_id: channel, product_id: product, sort: count ?? 0 }).select().single();
  if (error) throw error;
  return json({ link: data, demoted: await recheckAfterLinkChange(c.params[0]) });
}
async function patchLink(c: Ctx) {
  const b = await readJson(c.req, 10_000);
  const patch: J = {};
  if ("url" in b) {
    patch.url = optUrl(b.url, "url");
    if (!patch.url) fail(400, "bad_field", { field: "url" });
    patch.status = "미확인"; // 주소가 바뀌면 다시 확인해야 함
  }
  if ("cta" in b) patch.cta = str(b.cta, 80).trim();
  if ("sort" in b) patch.sort = optInt(b.sort, "sort", 0, 1000) ?? 0;
  if ("status" in b) { patch.status = oneOf(b.status, ["미확인", "정상", "오류"] as const, "status"); patch.checked_at = kstToday(); }
  if ("status_note" in b) patch.status_note = str(b.status_note, 300);
  if ("product_id" in b) patch.product_id = isUuid(b.product_id) ? b.product_id : null;
  if ("program_id" in b) patch.program_id = typeof b.program_id === "string" && ID.test(b.program_id) ? b.program_id : null;
  if (!Object.keys(patch).length) fail(400, "empty");
  const { data, error } = await sb.from("links").update(patch).eq("id", c.params[0]).select().maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  return json({ link: data, demoted: await recheckAfterLinkChange(String(data.post_id)) });
}
async function deleteLink(c: Ctx) {
  const { data, error } = await sb.from("links").delete().eq("id", c.params[0]).select("post_id").maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  return json({ ok: true, demoted: await recheckAfterLinkChange(String(data.post_id)) });
}

// 주제
const TOPIC_TEXT: [string, number][] = [["keyword", 120], ["category", 60], ["search_intent", 500], ["audience", 500], ["problem", 500], ["affiliate_fit", 500], ["product_availability", 500], ["competition", 500], ["differentiation", 500], ["seasonality", 300], ["research_needed", 500], ["rec_content_type", 40], ["basis", 1000]];
function cleanScores(v: unknown) {
  if (!v || typeof v !== "object") return {};
  const out: J = {};
  for (const f of Object.keys(SCORE_FACTORS)) {
    const s = (v as J)[f] as J | undefined;
    if (!s || typeof s !== "object") continue;
    const score = s.score === null || s.score === undefined || s.score === "" ? null : Number(s.score);
    out[f] = { score: score != null && Number.isFinite(score) && score >= 0 && score <= 5 ? score : null, basis: str(s.basis, 300), source: str(s.source, 60) || "직접 입력", confidence: str(s.confidence, 20) };
  }
  return out;
}
async function createTopic(c: Ctx) {
  const b = await readJson(c.req, 30_000);
  const t: J = { title: str(b.title, 200).trim(), origin: "user", status: "후보" };
  if (!t.title) fail(400, "bad_field", { field: "title" });
  for (const [k, max] of TOPIC_TEXT) if (k in b) t[k] = str(b[k], max);
  if ("scores" in b) t.scores = cleanScores(b.scores);
  const { data, error } = await sb.from("topics").insert(t).select().single();
  if (error) throw error;
  return json({ topic: data });
}
async function patchTopic(c: Ctx) {
  const b = await readJson(c.req, 30_000);
  const t: J = {};
  if ("status" in b) t.status = oneOf(b.status, ["후보", "채택", "보류", "제외", "제작 요청됨"] as const, "status");
  if ("title" in b) { t.title = str(b.title, 200).trim(); if (!t.title) fail(400, "bad_field", { field: "title" }); }
  for (const [k, max] of TOPIC_TEXT) if (k in b) t[k] = str(b[k], max);
  if ("scores" in b) t.scores = cleanScores(b.scores);
  if (!Object.keys(t).length) fail(400, "empty");
  const { data, error } = await sb.from("topics").update(t).eq("id", c.params[0]).select().maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  return json({ topic: data });
}

// 작업 (주제 추천·채널별 버전)
const REFORMAT_TARGETS = ["naver_blog", "tistory", "website", "threads", "instagram", "cards", "shortform", "summary", "faq", "titles"];
async function createJob(c: Ctx) {
  const b = await readJson(c.req, 20_000);
  if (b.kind === "topics") {
    const mode = b.mode === "performance" ? "performance" : "category";
    const category = str(b.category, 60).trim();
    if (mode === "category" && !category) fail(400, "bad_field", { field: "category" });
    await jobLimits(1);
    const payload: J = { mode, category, count: optInt(b.count, "count", 1, 10) ?? 6 };
    if (isUuid(b.seed_post_id)) payload.seed_post_id = b.seed_post_id;
    if (typeof b.hint === "string" && b.hint.trim()) payload.hint = str(b.hint, 300).trim();
    const { data, error } = await sb.from("requests").insert({ keyword: category || "성과 기반 추천", kind: "topics", payload, money: "", platform: "" }).select().single();
    if (error) throw error;
    return json({ job: data });
  }
  if (b.kind === "reformat") {
    if (!isUuid(b.post_id)) fail(400, "bad_field", { field: "post_id" });
    const post = await getPost(b.post_id as string);
    if (String(post.body || "").length < 200) fail(400, "no_body");
    const targets = Array.isArray(b.targets) ? strArr(b.targets, "targets", 10, 20).filter((t) => REFORMAT_TARGETS.includes(t)) : ["threads", "instagram", "cards", "shortform", "summary", "faq", "titles"];
    if (!targets.length) fail(400, "bad_field", { field: "targets" });
    await jobLimits(1);
    const { data, error } = await sb.from("requests").insert({ keyword: String(post.keyword || ""), kind: "reformat", post_id: post.id, payload: { targets }, money: String(post.money || ""), platform: String(post.platform || "") }).select().single();
    if (error) throw error;
    return json({ job: data });
  }
  return fail(400, "bad_field", { field: "kind" });
}
async function cancelJob(c: Ctx) {
  const { error } = await sb.rpc("job_cancel", { job: c.params[0] });
  if (error) rpcError(error);
  return json({ ok: true });
}
async function retryJob(c: Ctx) {
  await jobLimits(1);
  const { error } = await sb.rpc("job_retry", { job: c.params[0] });
  if (error) rpcError(error);
  return json({ ok: true });
}
// 예전 화면(1.0.0)의 '글 요청' 호환 — 한 번에 여러 키워드
async function legacyRequests(c: Ctx) {
  const b = await readJson(c.req, 300_000);
  const items = ((Array.isArray(b) ? b : [b]) as J[]).filter((it) => str(it?.keyword, 120).trim()).slice(0, 30);
  if (!items.length) fail(400, "empty");
  await jobLimits(items.length);
  const out: J[] = [];
  for (const it of items) {
    const ch = LEGACY_CHANNEL[str(it.platform, 40)] ?? "";
    const prog = LEGACY_PROGRAM[str(it.money, 40)];
    const p: J = {
      keyword: str(it.keyword, 120).trim(), experience: str(it.exp, 3000), ref: str(it.ref, 6000), link: optUrl(it.link, "link"),
      len: ["1500", "2500", "3500"].includes(String(it.len)) ? String(it.len) : "",
    };
    if (ch) p.channel_id = ch;
    if (prog) p.program_ids = [prog];
    const { data, error } = await sb.rpc("request_post", { p });
    if (error) rpcError(error);
    const row = (data as J[])[0];
    const { data: job } = await sb.from("requests").select("*").eq("id", row.job_id).single();
    out.push(job as J);
  }
  return json({ requests: out });
}

// 실적
const NUM_FIELDS = ["views", "impressions", "clicks", "orders", "cancels", "revenue_est", "revenue_confirmed", "revenue_paid", "cost"];
const COUNT_FIELDS = new Set(["views", "impressions", "clicks", "orders", "cancels"]);
function metricValues(b: J, field = "row") {
  const out: J = {};
  let any = false;
  for (const f of NUM_FIELDS) {
    const v = COUNT_FIELDS.has(f) ? optInt(b[f], `${field}.${f}`, 0, 2_000_000_000) : optNum(b[f], `${field}.${f}`, f === "cost" ? 0 : -1e10, 1e10);
    out[f] = v;
    if (v != null) any = true;
  }
  if (!any) fail(400, "no_values");
  return out;
}
async function listMetrics(c: Ctx) {
  let q = sb.from("metrics").select("*").order("period_start", { ascending: false }).order("created_at", { ascending: false }).limit(300);
  const pid = c.url.searchParams.get("post_id");
  const iid = c.url.searchParams.get("import_id");
  if (pid) { if (!isUuid(pid)) fail(400, "bad_field", { field: "post_id" }); q = q.eq("post_id", pid); }
  if (iid) { if (!isUuid(iid)) fail(400, "bad_field", { field: "import_id" }); q = q.eq("import_id", iid); }
  if (c.url.searchParams.get("source") === "manual") q = q.eq("source", "manual");
  const { data, error } = await q;
  if (error) throw error;
  return json({ metrics: data });
}
async function addMetric(c: Ctx) {
  const b = await readJson(c.req, 20_000);
  const start = reqDate(b.period_start, "period_start");
  const end = optDate(b.period_end, "period_end") ?? start;
  if (end < start) fail(400, "bad_field", { field: "period_end" });
  const row: J = { period_start: start, period_end: end, source: "manual", source_label: str(b.source_label, 60).trim() || "직접 입력", note: str(b.note, 300), ...metricValues(b) };
  if (isUuid(b.post_id)) { await getPost(b.post_id); row.post_id = b.post_id; }
  // 링크별 실적: 그 링크가 실제로 있고, 고른 글의 링크인지 확인 (글을 안 골랐으면 링크의 글로)
  let link: J | null = null;
  if (b.link_id !== undefined && b.link_id !== null && b.link_id !== "") {
    if (!isUuid(b.link_id)) fail(400, "bad_field", { field: "link_id" });
    const r = await sb.from("links").select("id, post_id, program_id, channel_id").eq("id", b.link_id).maybeSingle();
    if (r.error) throw r.error;
    link = r.data as J | null;
    if (!link || (row.post_id && link.post_id !== row.post_id)) fail(400, "bad_field", { field: "link_id" });
    if (!row.post_id) { await getPost(String(link.post_id)); row.post_id = link.post_id; }
    row.link_id = link.id;
  }
  const cat = await catalog();
  if (has(cat.programs, b.program_id)) row.program_id = b.program_id;
  else if (link?.program_id) row.program_id = link.program_id;
  if (has(cat.channels, b.channel_id)) row.channel_id = b.channel_id;
  else if (link?.channel_id) row.channel_id = link.channel_id;
  const { data, error } = await sb.from("metrics").insert(row).select().single();
  if (error) throw error;
  if (row.post_id) await sb.from("posts").update({ stage: "collecting" }).eq("id", row.post_id).eq("stage", "published");
  return json({ metric: data });
}
async function deleteMetric(c: Ctx) {
  const { data, error } = await sb.from("metrics").delete().eq("id", c.params[0]).eq("source", "manual").select("id").maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  return json({ ok: true });
}
async function createImport(c: Ctx) {
  const b = await readJson(c.req, 3_000_000);
  const rows = Array.isArray(b.rows) ? (b.rows as J[]) : fail(400, "bad_field", { field: "rows" });
  if (!rows.length) fail(400, "empty");
  if (rows.length > 5000) fail(413, "too_many_rows");
  const clientErrors = Array.isArray(b.errors) ? (b.errors as J[]).slice(0, 50).map((e) => ({ line: optInt(e?.line, "errors", 0, 1e7), msg: str(e?.msg, 200) })) : [];
  const clientErrCount = optInt(b.error_count, "error_count", 0, 1e7) ?? clientErrors.length;
  const clientDup = optInt(b.dup_in_file, "dup_in_file", 0, 1e7) ?? 0;
  const clean = rows.map((r, i) => {
    const start = reqDate(r?.period_start, `rows[${i}].period_start`);
    const end = optDate(r?.period_end, `rows[${i}].period_end`) ?? start;
    if (end < start) fail(400, "bad_field", { field: `rows[${i}].period_end` });
    return {
      period_start: start, period_end: end,
      post_id: isUuid(r.post_id) ? r.post_id : null,
      match_text: str(r.match_text, 300),
      ...metricValues(r, `rows[${i}]`),
    };
  });
  const cat = await catalog();
  const imp = {
    filename: str(b.filename, 200), source_label: str(b.source_label, 60).trim() || "파일",
    program_id: has(cat.programs, b.program_id) ? b.program_id : null,
    channel_id: has(cat.channels, b.channel_id) ? b.channel_id : null,
    mapping: b.mapping && typeof b.mapping === "object" && !Array.isArray(b.mapping) ? b.mapping : {},
    rows_total: rows.length + clientErrCount + clientDup, rows_err: clientErrCount, rows_dup: clientDup, errors: clientErrors,
  };
  const { data: ins, error } = await sb.from("imports").insert(imp).select().single();
  if (error) throw error;
  // 한 번에 넣어서, 중간에 실패하면 이 업로드 기록을 통째로 지움
  const { data, error: e2 } = await sb.rpc("import_metrics", { p_import: ins.id, p_rows: clean });
  if (e2) {
    await sb.from("imports").delete().eq("id", ins.id);
    throw e2;
  }
  return json({ import_id: ins.id, ok: Number((data as J).ok), changed: Number((data as J).changed ?? 0), dup: Number((data as J).dup) + clientDup, errors: clientErrCount });
}
// 올리기 취소: 이 파일이 새로 넣은 줄은 지우고, 이 파일이 숫자를 고친 줄은 예전 숫자로 되돌림 (DB 함수 하나로 한 번에)
async function cancelImport(c: Ctx) {
  const { data, error } = await sb.rpc("import_cancel", { p_import: c.params[0] });
  if (error) rpcError(error);
  return json({ ok: true, removed: Number((data as J)?.removed ?? 0), restored: Number((data as J)?.restored ?? 0) });
}

// 설정·카탈로그
async function patchSettings(c: Ctx) {
  const b = await readJson(c.req, 20_000);
  const s: J = {};
  if ("per_day" in b) s.per_day = optInt(b.per_day, "per_day", 1, 3);
  if ("auto_topics" in b) s.auto_topics = str(b.auto_topics, 300);
  if ("auto_enabled" in b) s.auto_enabled = b.auto_enabled === true;
  if ("len" in b) s.len = oneOf(String(b.len), ["1500", "2500", "3500"] as const, "len");
  if ("score_weights" in b) {
    const w: J = {};
    for (const f of Object.keys(SCORE_FACTORS)) {
      const n = Number((b.score_weights as J)?.[f]);
      w[f] = Number.isFinite(n) && n >= 0 && n <= 5 ? n : 1;
    }
    s.score_weights = w;
  }
  // 예전 화면은 글자값(money·platform)으로 보냄
  if (!("default_channel" in b) && LEGACY_CHANNEL[str(b.platform, 40)]) b.default_channel = LEGACY_CHANNEL[str(b.platform, 40)];
  if (!("default_programs" in b) && LEGACY_PROGRAM[str(b.money, 40)]) b.default_programs = [LEGACY_PROGRAM[str(b.money, 40)]];
  if ("default_channel" in b || "default_programs" in b) {
    const { data: cur } = await sb.from("settings").select("default_channel, default_programs").eq("id", 1).single();
    const ch = "default_channel" in b ? str(b.default_channel, 40) : String(cur?.default_channel ?? "naver_blog");
    const progs = "default_programs" in b ? strArr(b.default_programs, "default_programs", 10, 40) : ((cur?.default_programs as string[]) ?? []);
    const cat = await assertCompat(progs, ch);
    Object.assign(s, { default_channel: ch, default_programs: progs }, legacyNames(cat, progs, ch));
  }
  if (!Object.keys(s).length) fail(400, "empty");
  const { data, error } = await sb.from("settings").update(s).eq("id", 1).select().single();
  if (error) throw error;
  return json({ settings: data });
}
const PROGRAM_TEXT: [string, number][] = [["disclosure_template", 500], ["disclosure_where", 300], ["data_source", 500], ["commission_note", 500], ["unverified", 1000]];
async function patchProgram(c: Ctx) {
  const b = await readJson(c.req, 20_000);
  const p: J = {};
  for (const [k, max] of PROGRAM_TEXT) if (k in b) p[k] = str(b[k], max).trim();
  // 공정위 지침: '받을 수 있음'처럼 애매한 고지문은 저장하지 않음
  if (typeof p.disclosure_template === "string" && VAGUE_DISCLOSURE.test(p.disclosure_template)) fail(400, "vague_disclosure");
  if ("name" in b) { p.name = str(b.name, 60).trim(); if (!p.name) fail(400, "bad_field", { field: "name" }); }
  if ("my_status" in b) p.my_status = oneOf(b.my_status, ["사용 중", "가입 대기", "미가입", "확인 필요"] as const, "my_status");
  if ("needs_signup" in b) p.needs_signup = oneOf(b.needs_signup, ["필요", "불필요", "확인 필요"] as const, "needs_signup");
  if ("needs_disclosure" in b) p.needs_disclosure = oneOf(b.needs_disclosure, ["필요", "불필요", "확인 필요"] as const, "needs_disclosure");
  if ("needs_link" in b) p.needs_link = b.needs_link === true;
  if ("active" in b) p.active = b.active !== false;
  if ("policy_url" in b) p.policy_url = optUrl(b.policy_url, "policy_url");
  if ("policy_checked_at" in b) p.policy_checked_at = optDate(b.policy_checked_at, "policy_checked_at");
  if (!Object.keys(p).length) fail(400, "empty");
  const { data, error } = await sb.from("programs").update(p).eq("id", c.params[0]).select().maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  // 고지문·고지 필요·링크 필요·사용 여부가 바뀌면 이 수익 모델을 쓰는 발행 준비 원고를 다시 검사
  const pid = c.params[0];
  const demoted_posts = ["disclosure_template", "needs_disclosure", "needs_link", "active"].some((k) => k in p)
    ? await recheckReadyPosts((x) => ((x.program_ids as string[]) ?? []).includes(pid)) : [];
  return json({ program: data, demoted_posts });
}
async function createProgram(c: Ctx) {
  const b = await readJson(c.req, 20_000);
  const name = str(b.name, 60).trim();
  if (!name) fail(400, "bad_field", { field: "name" });
  const row: J = {
    id: "custom_" + randomCode(8).toLowerCase(), name, kind: oneOf(b.kind ?? "other", ["affiliate", "ads", "sponsor", "product", "cpa", "other"] as const, "kind"),
    needs_link: b.needs_link === true, my_status: "확인 필요", sort: 200,
  };
  for (const [k, max] of PROGRAM_TEXT) if (k in b) row[k] = str(b[k], max).trim();
  if (typeof row.disclosure_template === "string" && VAGUE_DISCLOSURE.test(row.disclosure_template)) fail(400, "vague_disclosure");
  const { data, error } = await sb.from("programs").insert(row).select().single();
  if (error) throw error;
  return json({ program: data });
}
async function createChannel(c: Ctx) {
  const b = await readJson(c.req, 20_000);
  const name = str(b.name, 60).trim();
  if (!name) fail(400, "bad_field", { field: "name" });
  const row = {
    id: "ch_" + randomCode(8).toLowerCase(), name, kind: oneOf(b.kind ?? "other", ["blog", "site", "sns", "other"] as const, "kind"),
    max_chars: optInt(b.max_chars, "max_chars", 1, 1_000_000), clickable_links: b.clickable_links !== false, html_paste: b.html_paste === true,
    notes: str(b.notes, 500), sort: 200,
  };
  const { data, error } = await sb.from("channels").insert(row).select().single();
  if (error) throw error;
  return json({ channel: data });
}
async function patchChannel(c: Ctx) {
  const b = await readJson(c.req, 20_000);
  const p: J = {};
  if ("name" in b) { p.name = str(b.name, 60).trim(); if (!p.name) fail(400, "bad_field", { field: "name" }); }
  if ("max_chars" in b) p.max_chars = optInt(b.max_chars, "max_chars", 1, 1_000_000);
  if ("clickable_links" in b) p.clickable_links = b.clickable_links !== false;
  if ("html_paste" in b) p.html_paste = b.html_paste === true;
  if ("notes" in b) p.notes = str(b.notes, 500);
  if ("active" in b) p.active = b.active !== false;
  if (!Object.keys(p).length) fail(400, "empty");
  const { data, error } = await sb.from("channels").update(p).eq("id", c.params[0]).select().maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  const chId = c.params[0];
  const demoted_posts = ["max_chars", "clickable_links", "active"].some((k) => k in p)
    ? await recheckReadyPosts((x) => x.channel_id === chId) : [];
  return json({ channel: data, demoted_posts });
}
async function setCompat(c: Ctx) {
  const b = await readJson(c.req, 20_000);
  const cat = await catalog();
  const program_id = str(b.program_id, 40), channel_id = str(b.channel_id, 40);
  if (!has(cat.programs, program_id)) fail(400, "bad_field", { field: "program_id" });
  if (!has(cat.channels, channel_id)) fail(400, "bad_field", { field: "channel_id" });
  const row = {
    program_id, channel_id, verdict: oneOf(b.verdict, ["가능", "불가", "확인 필요"] as const, "verdict"),
    reason: str(b.reason, 300), source_url: optUrl(b.source_url, "source_url"), checked_at: optDate(b.checked_at, "checked_at") ?? kstToday(),
  };
  const { data, error } = await sb.from("program_channels").upsert(row, { onConflict: "program_id,channel_id" }).select().single();
  if (error) throw error;
  // 판정이 바뀌면 그 조합을 쓰는 발행 준비 원고를 다시 검사 ('불가'가 되면 검수 필요로 되돌아감)
  const demoted_posts = await recheckReadyPosts((x) => x.channel_id === channel_id && ((x.program_ids as string[]) ?? []).includes(program_id));
  return json({ compat: data, demoted_posts });
}

// ───────── 경로표 ─────────
const U = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const R = (s: string) => new RegExp(`^${s}$`);
const ROUTES: [string, RegExp, (c: Ctx) => Promise<Response>][] = [
  ["GET", R("state"), getState],
  ["GET", R("stats"), getStats],
  ["GET", R("export"), getExport],
  ["GET", R("sessions"), listSessions],
  ["POST", R("logout"), logout],
  ["POST", R(`sessions/${U}/revoke`), revokeSession],
  ["POST", R("code/rotate"), rotateCode],
  ["POST", R("posts"), createPost],
  ["POST", R(`posts/${U}`), patchPost],
  ["PATCH", R(`posts/${U}`), patchPost],
  ["DELETE", R(`posts/${U}`), deletePost],
  ["POST", R(`posts/${U}/restore`), restorePost],
  ["POST", R(`posts/${U}/retry`), retryPost],
  ["POST", R(`posts/${U}/products`), attachProduct],
  ["DELETE", R(`posts/${U}/products/${U}`), detachProduct],
  ["POST", R(`posts/${U}/links`), addLink],
  ["POST", R(`links/${U}`), patchLink],
  ["DELETE", R(`links/${U}`), deleteLink],
  ["POST", R("products"), createProduct],
  ["POST", R(`products/${U}`), patchProduct],
  ["DELETE", R(`products/${U}`), deleteProduct],
  ["POST", R("topics"), createTopic],
  ["POST", R(`topics/${U}`), patchTopic],
  ["POST", R("jobs"), createJob],
  ["DELETE", R(`jobs/${U}`), cancelJob],
  ["POST", R(`jobs/${U}/retry`), retryJob],
  ["POST", R("requests"), legacyRequests],
  ["DELETE", R(`requests/${U}`), cancelJob],
  ["POST", R(`requests/${U}/retry`), retryJob],
  ["GET", R("metrics"), listMetrics],
  ["POST", R("metrics"), addMetric],
  ["DELETE", R(`metrics/${U}`), deleteMetric],
  ["POST", R("imports"), createImport],
  ["POST", R(`imports/${U}/cancel`), cancelImport],
  ["POST", R("settings"), patchSettings],
  ["PATCH", R("settings"), patchSettings],
  ["POST", R("programs"), createProgram],
  ["POST", R("programs/([a-z0-9_]{2,40})"), patchProgram],
  ["POST", R("channels"), createChannel],
  ["POST", R("channels/([a-z0-9_]{2,40})"), patchChannel],
  ["POST", R("compat"), setCompat],
];

// DB 오류를 사용자 입력 오류로 바꿔서 알려줌 (내부 내용은 기록만)
function dbError(e: unknown): Response | null {
  const code = String((e as { code?: string })?.code ?? "");
  if (code === "23503") return json({ error: "bad_ref" }, 400);
  if (code === "23514" || code === "22P02" || code === "22007" || code === "22008") return json({ error: "bad_field" }, 400);
  if (code === "23505") return json({ error: "duplicate" }, 409);
  return null;
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const at = parts.findIndex((p) => p.startsWith("blog-app"));
  const route = (at >= 0 ? parts.slice(at + 1) : parts.slice(1)).join("/");
  try {
    if (route === "ping") return json({ ok: true, version: VERSION, time: nowIso() });
    if (route === "login" && req.method === "POST") return await login(req);
    const auth = await authenticate(req);
    if (auth instanceof Response) return auth;
    for (const [method, re, handler] of ROUTES) {
      if (method !== req.method) continue;
      const m = route.match(re);
      if (m) return await handler({ req, auth, params: m.slice(1), url });
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, ...e.extra }, e.status);
    const mapped = dbError(e);
    const msg = String((e as Error)?.message ?? e).replace(/[A-Za-z0-9_\-]{32,}/g, "[가림]").slice(0, 300);
    console.error("blog-app error:", (e as { code?: string })?.code ?? "", msg);
    return mapped ?? json({ error: "server" }, 500);
  }
}

Deno.serve(async (req: Request) => {
  const res = await handle(req);
  for (const [k, v] of Object.entries(corsFor(req))) res.headers.set(k, v);
  return res;
});
