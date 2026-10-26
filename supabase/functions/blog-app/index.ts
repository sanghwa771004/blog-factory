// 블로그 글공장 서버 API (1.4.0)
// - 기기별 로그인: 접속 코드로 한 번 로그인하면 기기마다 세션 토큰을 받음 (접속 코드는 기기에 남기지 않음)
// - 표는 모두 RLS로 잠겨 있고, 이 함수만 서버 키로 읽고 씀
// - '발행 준비 완료'는 서버에서도 checks.js 로 다시 검사해서 오류가 있으면 거부
// - 이미지 스튜디오: OpenAI·Pexels 키는 이 함수의 환경변수(Secrets)에만 있고 화면으로는 '있음/없음'만 보냄.
//   이미지 파일은 비공개 버킷(post-images)에, 정보는 post_images 표에. 화면은 1시간짜리 서명 주소로만 봄
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkPost, disclosureFor, USER_TRANSITIONS, CONTENT_TYPES, SCORE_FACTORS, VAGUE_DISCLOSURE } from "./checks.js";
import {
  parseSlots, matchSlots, planSlotSync, ctxOf, EXTRA_SLOTS, extraSlot, isExtraKey, validSlotKey, slotPurpose, PURPOSES, RATIOS, STYLES, QUALITIES, ratioOf, sizeFor,
  validApiSize, buildPrompt, promptRisk, blocksOf, slotRisk, estimateUsd, estimateTokens, normQuality, modelCaps, DEFAULT_PRICES, MAX_UPLOAD_BYTES,
  CARD_TEMPLATES, CARD_RATIOS, CARD_ICONS, CARD_LIMITS,
} from "./images.js";
import { BUCKET, TEST_MODEL, PHOTO_PROVIDERS, runGeneration, saveStockPhoto, saveUploaded, b64ToBytes, needMsFor, busyRetryAfter } from "./image_service.js";

const VERSION = "1.4.0";
// 같은 코드를 두 이름으로 올림: blog-app = 모든 기능, blog-gen = 'AI 이미지 만들기' 요청만 받음.
// 생성 요청이 다른 요청(목록·저장 등)이 쓰던 일꾼에 섞이지 않아서 새 일꾼에서 시작할 때가 많음 → '서버 준비 중' 대기가 줄고,
// 다른 요청 때문에 일꾼이 멈춰 만들던 이미지를 잃는 일도 줄어듦 (실서버에서 얼마나 줄어드는지는 아직 확인 전)
const FN_GEN = "blog-gen";
const BOOT_AT = Date.now(); // 이 서버 일꾼(worker)이 켜진 때 — 무료 요금제는 켜진 뒤 150초까지만 일함
// 일꾼 하나가 일하는 최대 시간 (무료 150초, 유료 400초 — Supabase 문서). 요금제가 다르면 Secrets 에 EDGE_WALL_SECONDS 로 넣음
const WALL_MS = Math.min(400, Math.max(60, Number(Deno.env.get("EDGE_WALL_SECONDS") ?? "150") || 150)) * 1000;
const DEADLINE = BOOT_AT + WALL_MS - 12_000; // 이때까지 결과 저장까지 끝내야 함 (품질별로 기다릴 시간은 image_service.js NEED_MS)
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
async function fetchAll(table: string, order: [string, boolean][], build?: (q: any) => any, cols = "*"): Promise<J[]> {
  const out: J[] = [];
  const size = 1000;
  for (let from = 0; from < 200_000; from += size) {
    // deno-lint-ignore no-explicit-any
    let q: any = sb.from(table).select(cols);
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
  if (/image_busy/.test(m)) fail(409, "image_busy");
  if (/image_daily_limit/.test(m)) fail(429, "image_daily_limit");
  if (/image_budget/.test(m)) fail(429, "image_budget");
  const inUse = /image in use: (\d+)/.exec(m);
  if (inUse) fail(409, "image_in_use", { uses: Number(inUse[1]) });
  if (/slot taken/.test(m)) fail(409, "slot_taken");
  if (/same slot/.test(m)) fail(400, "bad_field", { field: "slot_key" });
  if (/generation is not running/.test(m)) fail(409, "bad_state");
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
    sb.from("runs").select("*").order("ran_at", { ascending: false }).limit(40), // 하루 3번 × 약 2주 — 홈 '최근 7일 정리'의 실행 횟수가 잘리지 않게
    sb.from("channels").select("*").order("sort"),
    sb.from("programs").select("*").order("sort"),
    sb.from("program_channels").select("*"),
    sb.from("topics").select("*").order("created_at", { ascending: false }).limit(300),
    sb.from("imports").select("id, filename, source_label, program_id, channel_id, rows_total, rows_ok, rows_dup, rows_changed, rows_err, errors, status, created_at, cancelled_at").order("created_at", { ascending: false }).limit(30),
  ]);
  for (const r of [posts, trash, jobs, settings, runs, channels, programs, compat, topics, imports]) if (r.error) throw r.error;
  // 1000줄이 넘어도 빠지지 않게 끝까지 (링크·상품이 잘리면 '링크 없음' 같은 잘못된 오류가 뜸)
  const since400 = new Date(Date.now() - 400 * 86400e3).toISOString().slice(0, 10);
  // 1.4.0: 다른 채널 기록·유입 검색어 (016 전 DB면 빈 목록 — 화면은 '데이터 없음'으로)
  const softAll = (p: Promise<J[]>, what: string) => p.catch((e) => { console.error(`state ${what}:`, String((e as Error)?.message ?? e)); return [] as J[]; });
  const [postChannels, searchTerms, metricPosts] = await Promise.all([
    softAll(fetchAll("post_channels", [["posted_on", false], ["id", true]]), "post_channels"),
    softAll(fetchAll("search_terms", [["period_end", false], ["id", true]], (q) => q.gte("period_end", since400),
      "id, post_id, term, views, period_start, period_end, channel_id, source_label, created_at"), "search_terms"),
    // 흐름판의 '실적' 단계: 실적이 한 줄이라도 있는 글
    softAll(fetchAll("metrics", [["id", true]], (q) => q.not("post_id", "is", null), "post_id"), "metric_posts"),
  ]);
  const [products, pp, links, imageSlots] = await Promise.all([
    fetchAll("products", [["updated_at", false], ["id", true]]),
    fetchAll("post_products", [["post_id", true], ["sort", true], ["product_id", true]]),
    fetchAll("links", [["post_id", true], ["sort", true], ["id", true]]),
    // 원고 목록·발행 전 검사에 쓰는 사진 자리 연결 요약 (1000줄이 넘어도 끝까지. 이미지 스튜디오 표가 아직 없으면 빈 목록)
    // source_type(직접 올린 사진의 출처)은 014→015 사이에 생김 — 아직 015 전인 DB면 빼고 다시 읽음
    fetchAll("post_image_slots", [["post_id", true], ["id", true]], (q) => q.not("image_id", "is", null),
      "post_id, slot_key, slot_index, image_id, purpose, used_at, downloaded_at, post_images(kind, provider, review_status, mime, author_name, description, license, attribution_text, source_type)")
      .catch(() => fetchAll("post_image_slots", [["post_id", true], ["id", true]], (q) => q.not("image_id", "is", null),
        "post_id, slot_key, slot_index, image_id, purpose, used_at, downloaded_at, post_images(kind, provider, review_status, mime, author_name, description, license, attribution_text)"))
      .then((data) => ({ data, error: null as unknown }), (error) => ({ data: [] as J[], error: error as unknown })),
  ]);
  if (imageSlots.error) console.error("state image_slots:", String((imageSlots.error as Error)?.message ?? imageSlots.error));
  return json({
    version: VERSION, now: nowIso(), today: kstToday(), auth: c.auth.kind,
    posts: posts.data, trash: trash.data, jobs: jobs.data, settings: settings.data, runs: runs.data,
    channels: channels.data, programs: programs.data, compat: compat.data, topics: topics.data, products,
    post_products: pp, links, imports: imports.data, image_slots: imageSlots.error ? [] : imageSlots.data,
    post_channels: postChannels, search_terms: searchTerms, metric_post_ids: [...new Set(metricPosts.map((m) => String(m.post_id)))],
    requests: jobs.data, lastRun: runs.data?.[0] ?? null, // 예전 화면 호환
  });
}

async function getStats(c: Ctx) {
  const from = c.url.searchParams.get("from");
  const to = c.url.searchParams.get("to");
  const range = { d_from: from ? reqDate(from, "from") : null, d_to: to ? reqDate(to, "to") : null };
  // 이미지 생성 비용은 실적의 '비용'과 따로 셈 (같은 돈이 두 번 더해지지 않게 따로 보냄)
  const [st, ic] = await Promise.all([sb.rpc("stats", range), sb.rpc("image_costs", range)]);
  if (st.error) throw st.error;
  if (ic.error) console.error("image_costs:", ic.error.message);
  return json({ stats: { ...(st.data as J), image_costs: ic.error ? null : ic.data } });
}

// 백업: 표마다 1000줄씩 나눠서 끝까지 담고, 표마다 줄 수를 같이 적음
const EXPORT_TABLES: [string, [string, boolean][]][] = [
  ["posts", [["id", true]]], ["requests", [["id", true]]], ["settings", [["id", true]]], ["runs", [["id", true]]],
  ["channels", [["id", true]]], ["programs", [["id", true]]], ["program_channels", [["program_id", true], ["channel_id", true]]],
  ["topics", [["id", true]]], ["products", [["id", true]]], ["post_products", [["post_id", true], ["product_id", true]]],
  ["links", [["id", true]]], ["metrics", [["id", true]]], ["imports", [["id", true]]],
  ["post_images", [["id", true]]], ["post_image_slots", [["id", true]]], ["image_generations", [["id", true]]], ["post_card_decks", [["post_id", true]]],
  ["post_channels", [["id", true]]], ["search_terms", [["id", true]]],
];
// 016(1.4.0)에서 생긴 표 — 아직 016 전인 DB면 빈 목록으로
const OPS_TABLES = ["post_channels", "search_terms"];
async function getExport(_c: Ctx) {
  const out: J = { exported_at: nowIso(), version: VERSION, note: "접속 코드·기기 로그인 정보는 들어 있지 않아. 이미지 파일 자체는 들어 있지 않고 정보(출처·프롬프트·비용·연결)만 들어 있어." };
  const counts: J = {};
  const missing: string[] = [];
  for (const [t, order] of EXPORT_TABLES) {
    let rows: J[];
    try { rows = await fetchAll(t, order); } catch (e) {
      // 이미지 표가 아직 없는 DB(012 적용 전)여도 나머지 백업은 받을 수 있게 — 그 밖의 오류는 그대로 실패
      const code = String((e as { code?: string })?.code ?? "");
      if (t.startsWith("post_image") || t === "image_generations" || t === "post_card_decks" || OPS_TABLES.includes(t)) {
        if (code === "PGRST205" || code === "42P01") { missing.push(t); out[t] = []; counts[t] = null; continue; }
      }
      throw e;
    }
    out[t] = rows;
    counts[t] = rows.length;
  }
  out.counts = counts;
  if (missing.length) out.missing_tables = missing;
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
  if ("refresh" in b) {
    // 개선안은 자동 작가만 쓰고, 화면에서는 지우기만 (다 고쳤거나 필요 없을 때)
    if (b.refresh !== null) fail(400, "bad_field", { field: "refresh" });
    patch.refresh = {};
  }

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
  if (error && "refresh" in patch && missingColumn(error, "refresh")) fail(409, "db_update_needed", { migration: "016" }); // 016 전 DB
  if (error) throw error;
  // 본문이 바뀌면 사진 자리 연결을 새 본문에 맞춤 (설명을 조금 고친 자리는 옮기고, 사라진 자리의 이미지는 보관함에 그대로)
  let image_sync: unknown = null;
  if ("body" in patch) {
    try {
      const sy = await syncSlots(data as J);
      image_sync = { rekeyed: sy.rekeyed, orphans: sy.m.orphans.length };
    } catch (e) { console.error("image sync:", String((e as Error)?.message ?? e).slice(0, 200)); }
  }
  return json({ post: data, demoted, image_sync });
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
  if (b.kind === "refresh") {
    // 개선안: 게시한 글을 실적·유입 검색어로 어떻게 고칠지 (자동 작가가 써서 글의 '개선안' 칸에 저장. 글 본문은 안 바꿈)
    if (!isUuid(b.post_id)) fail(400, "bad_field", { field: "post_id" });
    const post = await getPost(b.post_id as string);
    if (!LIVE.includes(String(post.stage))) fail(409, "not_published");
    if (String(post.body || "").length < 200) fail(400, "no_body");
    const focus = REFRESH_FOCUS.includes(String(b.focus)) ? String(b.focus) : "all";
    const note = str(b.note, 300).trim();
    const { data: dup, error: e1 } = await sb.from("requests").select("id").eq("post_id", post.id).eq("kind", "refresh").eq("status", "pending").limit(1);
    if (e1) throw e1;
    if ((dup ?? []).length) fail(409, "job_exists");
    await jobLimits(1);
    const { data, error } = await sb.from("requests").insert({ keyword: String(post.keyword || ""), kind: "refresh", post_id: post.id, payload: { focus, ...(note ? { note } : {}) }, money: String(post.money || ""), platform: String(post.platform || "") }).select().single();
    if (error && kindNotAllowed(error)) fail(409, "db_update_needed", { migration: "016" });
    if (error) throw error;
    return json({ job: data });
  }
  return fail(400, "bad_field", { field: "kind" });
}
const REFRESH_FOCUS = ["all", "title", "ctr", "conversion", "search"];
// 016 전 DB: 작업 종류 검사(requests_kind_check)에 refresh 가 없음
const kindNotAllowed = (e: unknown) => String((e as { code?: string })?.code ?? "") === "23514" && String((e as { message?: string })?.message ?? "").includes("requests_kind_check");
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
  if ("focus_topic" in b) s.focus_topic = str(b.focus_topic, 60).trim();
  if ("focus_terms" in b) s.focus_terms = str(b.focus_terms, 300).trim();
  if ("backlog_limit" in b) s.backlog_limit = optInt(b.backlog_limit, "backlog_limit", 0, 60) ?? 0;
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
  // 이미지: 모델 이름(계정에서 안 되면 바꿀 수 있게)·기본 품질·하루 한도·한 달 예산·환율·가격
  const modelName = (v: unknown, field: string) => { const m = str(v, 64).trim(); if (!/^[a-z0-9][a-z0-9._-]{1,60}$/.test(m)) fail(400, "bad_field", { field }); return m; };
  if ("image_gen_model" in b) s.image_gen_model = modelName(b.image_gen_model, "image_gen_model");
  if ("image_edit_model" in b) s.image_edit_model = modelName(b.image_edit_model, "image_edit_model");
  if ("image_quality" in b) s.image_quality = oneOf(b.image_quality, QUALITIES as readonly string[], "image_quality");
  if ("image_daily_limit" in b) s.image_daily_limit = optInt(b.image_daily_limit, "image_daily_limit", 0, 100) ?? 0;
  if ("image_monthly_budget_usd" in b) s.image_monthly_budget_usd = optNum(b.image_monthly_budget_usd, "image_monthly_budget_usd", 0, 500) ?? 0;
  if ("image_fx_krw" in b) s.image_fx_krw = optNum(b.image_fx_krw, "image_fx_krw", 100, 10000);
  if ("image_fx_date" in b) s.image_fx_date = optDate(b.image_fx_date, "image_fx_date");
  if ("image_fx_source" in b) s.image_fx_source = str(b.image_fx_source, 200).trim();
  if ("image_prices" in b) {
    const p = (b.image_prices && typeof b.image_prices === "object" ? b.image_prices : {}) as J;
    const price = (k: string) => optNum(p[k], "image_prices", 0, 1000) ?? (DEFAULT_PRICES as Record<string, number>)[k];
    s.image_prices = {
      image_output_per_m: price("image_output_per_m"), image_input_per_m: price("image_input_per_m"), text_input_per_m: price("text_input_per_m"),
      // 확인한 날을 비우면 비운 그대로 (서버가 오늘 날짜로 지어내지 않음)
      checked_at: optDate(p.checked_at, "image_prices") ?? null, source: optUrl(p.source, "image_prices"),
    };
  }
  if (!Object.keys(s).length) fail(400, "empty");
  let { data, error } = await sb.from("settings").update(s).eq("id", 1).select().single();
  // DB에 015(주력 주제 낱말 열)가 아직 없으면 그 칸만 빼고 저장 — 서버를 DB보다 먼저 올려도 다른 설정 저장이 막히지 않게
  const skipped: string[] = [];
  // DB에 그 열이 아직 없으면(015 전: 주력 주제 낱말, 016 전: 쌓아둘 원고 한도) 그 칸만 빼고 저장
  for (const col of ["focus_terms", "backlog_limit"]) {
    if (!(error && col in s && missingColumn(error, col))) continue;
    delete s[col];
    skipped.push(col);
    // 그 칸만 보냈으면 저장할 게 없으니 지금 설정만 다시 읽어서 돌려줌 (빈 저장 요청을 보내지 않음)
    ({ data, error } = Object.keys(s).length
      ? await sb.from("settings").update(s).eq("id", 1).select().single()
      : await sb.from("settings").select("*").eq("id", 1).single());
  }
  if (error) throw error;
  return json(skipped.length ? { settings: data, skipped } : { settings: data });
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

// ───────── 이미지 스튜디오 ─────────
const SIGN_SECONDS = 3600;                       // 비공개 이미지 서명 주소 유효 시간
const STORAGE_SOFT_LIMIT = 900 * 1024 * 1024;    // 저장 공간이 이만큼 차면 새로 올리기를 멈춤
const keyOpenAI = () => Deno.env.get("OPENAI_API_KEY") ?? "";
// 무료 이미지(Cloudflare Workers AI): 계정 ID + 'Workers AI' 권한 토큰
const keyCf = () => ({ accountId: (Deno.env.get("CF_ACCOUNT_ID") ?? "").trim(), token: (Deno.env.get("CF_API_TOKEN") ?? "").trim() });
const keysInfo = () => ({ openai: !!keyOpenAI(), pexels: !!(Deno.env.get("PEXELS_API_KEY") ?? ""), cloudflare: !!(keyCf().accountId && keyCf().token) });
const providersInfo = () => Object.entries(PHOTO_PROVIDERS).map(([id, p]) => ({ id, label: p.label, connected: !!(Deno.env.get(p.envKey) ?? ""), site: p.site, license_url: p.licenseUrl }));
// 생성 기록을 화면에 보낼 때는 긴 프롬프트를 뺌 (이미지 정보에 따로 있음)
const GEN_COLS = "id, request_key, post_id, slot_key, slot_index, slot_text, mode, provider, model, size, quality, output_format, purpose, style, user_prompt, base_image_id, status, provider_called, provider_request_id, risk_override, error_code, error_message, est_usd, usage, usage_usd, actual_usd, actual_checked_at, cost_status, auto_cost_status, fx_krw, fx_date, fx_source, image_id, started_at, finished_at, created_at";

// 응답을 보낸 뒤에도 계속 일하게 (이미지 생성). 일꾼이 꺼지기 전에 못 끝나면 4분 뒤 '확인 필요'로 정리됨
const RUNNING = new Set<string>();
function inBackground(p: Promise<unknown>) {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(p);
}
addEventListener("beforeunload", () => {
  for (const id of RUNNING) {
    sb.rpc("image_gen_fail", { gen: id, fin: { error_code: "server_stopped", error_message: "서버가 중간에 멈췄어. 청구됐을 수 있으니 OpenAI 사용량에서 확인해줘.", cost_status: "확인 필요" } })
      .then(() => {}, () => {});
  }
});

function imageDeps() {
  const bucket = sb.storage.from(BUCKET);
  return {
    rpc: (name: string, args: J) => sb.rpc(name, args),
    upload: (path: string, bytes: Uint8Array, mime: string, o: { upsert?: boolean } = {}) => bucket.upload(path, bytes, { contentType: mime, upsert: !!o.upsert, cacheControl: "3600" }),
    remove: (paths: string[]) => bucket.remove(paths),
    download: async (path: string) => {
      const { data, error } = await bucket.download(path);
      return error || !data ? { ok: false } : { ok: true, bytes: new Uint8Array(await data.arrayBuffer()) };
    },
    findImage: async (q: J) => {
      // deno-lint-ignore no-explicit-any
      let x: any = sb.from("post_images").select("*").is("deleted_at", null);
      x = q.sha256 ? x.eq("sha256", q.sha256) : x.eq("provider", q.provider).eq("source_id", q.source_id);
      const { data } = await x.order("created_at", { ascending: true }).limit(1);
      return ((data ?? []) as J[])[0] ?? null;
    },
    logCall: async (provider: string, kind: string, status: number) => {
      await sb.from("api_calls").insert({ provider, kind, status });
      if (Math.random() < 0.02) await sb.from("api_calls").delete().lt("at", new Date(Date.now() - 40 * 86400e3).toISOString());
    },
    fetchImpl: fetch,
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
  };
}
async function signPaths(paths: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(paths.filter(Boolean))];
  if (!uniq.length) return {};
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(uniq, SIGN_SECONDS);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { path: string | null; signedUrl: string; error: string | null }[]) if (r.path && r.signedUrl && !r.error) out[r.path] = r.signedUrl;
  return out;
}
// 이미지마다 몇 자리(몇 원고)에서 쓰는지
async function usesOf(ids: string[]) {
  const out: Record<string, { uses: number; used_posts: number }> = {};
  if (!ids.length) return out;
  const [sl, dk] = await Promise.all([
    sb.from("post_image_slots").select("image_id, post_id").in("image_id", ids),
    sb.from("post_card_decks").select("bg_image_id, post_id").in("bg_image_id", ids),
  ]);
  if (sl.error) throw sl.error;
  if (dk.error) throw dk.error;
  const posts: Record<string, Set<string>> = {};
  const pairs = [...((sl.data ?? []) as J[]).map((x) => [x.image_id, x.post_id]), ...((dk.data ?? []) as J[]).map((x) => [x.bg_image_id, x.post_id])] as [string, string][];
  for (const [i, p] of pairs) {
    (out[i] ??= { uses: 0, used_posts: 0 }).uses++;
    (posts[i] ??= new Set()).add(p);
  }
  for (const [i, s] of Object.entries(posts)) out[i].used_posts = s.size;
  return out;
}
async function withUrls(rows: J[]) {
  const [urls, uses] = await Promise.all([signPaths(rows.map((i) => String(i.storage_path ?? ""))), usesOf(rows.map((i) => String(i.id)))]);
  return rows.map((i) => ({ ...i, url: urls[String(i.storage_path)] ?? "", uses: uses[String(i.id)]?.uses ?? 0, used_posts: uses[String(i.id)]?.used_posts ?? 0 }));
}
async function imageSettings() {
  const { data, error } = await sb.from("settings").select("image_gen_model, image_edit_model, image_quality, image_daily_limit, image_monthly_budget_usd, image_fx_krw, image_fx_date, image_fx_source, image_prices").eq("id", 1).single();
  if (error) throw error;
  return data as J;
}
async function imageUsage() {
  const { data, error } = await sb.rpc("image_usage");
  if (error) throw error;
  return data as J;
}
async function storageGuard(adding = 0) {
  const u = await imageUsage();
  if (Number(u.storage_bytes ?? 0) + adding > STORAGE_SOFT_LIMIT) fail(507, "storage_full");
}
async function safetyIdOf(auth: Auth) {
  return (await sha256hex("gf-safety:" + (auth.sessionId ?? "legacy"))).slice(0, 32);
}

// 원고 본문의 사진 자리와 저장된 연결을 맞춤: 설명을 조금 고친 자리는 연결을 옮기고(rekey), 순서만 바뀐 자리는 번호를 고침
// 본문에서 사라진 자리의 연결은 지우지 않음 (orphans — 화면에서 다른 자리로 옮기거나 뺄 수 있음)
// 같은 원고의 자리 맞추기가 이 일꾼 안에서 겹치지 않게 앞의 것이 끝난 뒤에 시작 (겹치면 예전 계획으로 옮기다가 임시 이름에 잠깐 남을 수 있음)
const SYNC_LOCKS = new Map<string, Promise<unknown>>();
async function syncSlots(post: J) {
  const id = String(post.id);
  const run = (SYNC_LOCKS.get(id) ?? Promise.resolve()).catch(() => {}).then(() => syncSlotsNow(post));
  SYNC_LOCKS.set(id, run);
  try { return await run; } finally { if (SYNC_LOCKS.get(id) === run) SYNC_LOCKS.delete(id); }
}
async function syncSlotsNow(post: J) {
  const load = async () => {
    const { data, error } = await sb.from("post_image_slots").select("*").eq("post_id", post.id);
    if (error) throw error;
    return (data ?? []) as J[];
  };
  // 앞의 맞추기를 기다리는 사이 본문이 또 바뀌었을 수 있어서 지금 본문을 다시 읽어서 맞춤 (예전 본문으로 되돌려 맞추지 않게)
  const { data: now } = await sb.from("posts").select("body").eq("id", post.id).maybeSingle();
  const cur = parseSlots(String((now as J | null)?.body ?? post.body ?? ""));
  let rows = await load();
  let m = matchSlots(cur, rows);
  let rekeyed = 0, changed = false;
  const rekey = async (p: J) => {
    const r = await sb.rpc("image_slot_rekey", { p_post: post.id, p });
    if (r.error) console.error("slot rekey:", r.error.message);
    return !r.error;
  };
  // 실행 순서는 images.js planSlotSync (비켜 두기 → 임시 이름 거쳐 옮기기 → 번호·주변 글 고치기). 임시 이름에는 무작위 값을 섞음
  const ops = planSlotSync(m, (tag: string, n: number) => `k:~~${tag}${crypto.randomUUID().slice(0, 8)}${n}#1`) as J[];
  const done = new Set<string>();
  for (const o of ops) {
    if (o.op === "rekey") {
      if (o.after && !done.has(String(o.after))) continue; // 1단계가 안 된 건 건너뜀
      if (await rekey(o.p as J)) { changed = true; if (o.key) done.add(String(o.key)); if (o.final) rekeyed++; }
    } else {
      const r = await sb.from("post_image_slots").update(o.patch as J).eq("id", o.id);
      if (!r.error) changed = true;
    }
  }
  if (changed) { rows = await load(); m = matchSlots(cur, rows); }
  return { cur, rows, m, rekeyed };
}
// 요청이 가리키는 원고·사진 자리 (자리는 지금 본문에 있어야 함, 본문 밖 자리는 정해진 것만)
async function slotTarget(b: J, required: boolean) {
  if (!isUuid(b.post_id)) {
    if (required || b.slot_key) fail(400, "bad_field", { field: "post_id" });
    return { post: null as J | null, slot: null as J | null, purpose: has(PURPOSES, b.purpose) ? String(b.purpose) : "general" };
  }
  const post = await getPost(b.post_id as string);
  const key = str(b.slot_key, 220);
  let slot: J | null = null;
  if (key) {
    if (!validSlotKey(key)) fail(400, "bad_field", { field: "slot_key" });
    if (isExtraKey(key)) {
      const x = extraSlot(key)!;
      slot = { key: x.key, index: 0, n: 0, text: x.label, heading: "", before: "", after: "" };
    } else {
      slot = parseSlots(String(post.body ?? "")).find((s: J) => s.key === key) ?? null;
      if (!slot) fail(409, "slot_gone");
    }
  } else if (required) fail(400, "bad_field", { field: "slot_key" });
  const purpose = has(PURPOSES, b.purpose) ? String(b.purpose) : slotPurpose(key);
  return { post, slot, purpose };
}
// 이 글에 연결된 상품의 브랜드(요청에 있으면 막음)와 브랜드·상품 이름·모델명(맥락 글에서 지움)
async function linkedProducts(postId: string) {
  const { data } = await sb.from("post_products").select("products(brand, name, model)").eq("post_id", postId);
  const rows = ((data ?? []) as J[]).map((x) => ((x.products as J | null) ?? {}) as J);
  const brands = rows.map((r) => String(r.brand ?? "").trim()).filter(Boolean);
  const hide = rows.flatMap((r) => [r.brand, r.name, r.model]).map((v) => String(v ?? "").trim()).filter((v) => v.length >= 2);
  return { brands, hide };
}

async function getImageConfig(_c: Ctx) {
  const [settings, usage] = await Promise.all([imageSettings(), imageUsage()]);
  return json({ keys: keysInfo(), providers: providersInfo(), settings, usage, test_model: TEST_MODEL, sign_seconds: SIGN_SECONDS, storage_limit: STORAGE_SOFT_LIMIT });
}

// 원고 하나의 이미지 화면: 사진 자리(본문 순서) + 본문 밖 자리 + 사라진 자리 + 이미지(서명 주소) + 생성 기록 + 카드뉴스 + 비용
async function getPostImages(c: Ctx) {
  const post = await getPost(c.params[0]);
  // 이 글의 4분 넘게 끝나지 않은 생성은 실패(청구됐을 수 있음)로 정리 — 비용 목록에 '생성 중'으로 남지 않게
  await sweepStale(post.id as string);
  const sy = await syncSlots(post);
  const linkIds = sy.rows.map((r) => r.image_id).filter(Boolean) as string[];
  const empty = { data: [] as J[], error: null };
  const [linked, own, gens, deck, usage, costs] = await Promise.all([
    linkIds.length ? sb.from("post_images").select("*").in("id", linkIds) : Promise.resolve(empty),
    sb.from("post_images").select("*").eq("origin_post_id", post.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
    sb.from("image_generations").select(GEN_COLS).eq("post_id", post.id).order("created_at", { ascending: false }).limit(100),
    sb.from("post_card_decks").select("*").eq("post_id", post.id).maybeSingle(),
    sb.rpc("image_usage"),
    sb.rpc("image_costs", { d_from: null, d_to: null, p_post: post.id }),
  ]);
  for (const r of [linked, own, gens, deck, usage, costs]) if (r.error) throw r.error;
  const imgs = new Map<string, J>();
  for (const r of [...((own.data ?? []) as J[]), ...((linked.data ?? []) as J[])]) imgs.set(String(r.id), r);
  const bg = (deck.data as J | null)?.bg_image_id;
  if (bg && !imgs.has(String(bg))) {
    const { data } = await sb.from("post_images").select("*").eq("id", bg).maybeSingle();
    if (data) imgs.set(String(bg), data as J);
  }
  const extraRows = sy.rows.filter((r) => isExtraKey(String(r.slot_key)));
  return json({
    post_id: post.id,
    slots: sy.m.slots.map((s: J) => ({ index: s.index, n: s.n, text: s.text, key: s.key, heading: s.heading, before: s.before, after: s.after, row: s.link })),
    extra: EXTRA_SLOTS.map((x) => ({ ...x, row: extraRows.find((r) => r.slot_key === x.key) ?? null })),
    orphans: sy.m.orphans, rekeyed: sy.rekeyed,
    images: await withUrls([...imgs.values()]),
    generations: gens.data, deck: deck.data, usage: usage.data, costs: costs.data,
    keys: keysInfo(), providers: providersInfo(), signed_at: nowIso(), sign_seconds: SIGN_SECONDS,
  });
}

// AI 이미지 만들기: 검사·예상 비용 확인·한도 확인 → '생성 중' 기록 → 응답은 바로, 생성은 뒤에서 (화면은 상태를 물어봄)
async function generateImage(c: Ctx) {
  const b = await readJson(c.req, 20_000);
  const requestKey = str(b.request_key, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestKey)) fail(400, "bad_field", { field: "request_key" });
  // 응답을 못 받아 같은 요청 번호로 다시 온 것은 검사·대기 없이 그 기록을 바로 돌려줌 (두 번 만들지 않음 — 만드는 중이면 화면이 바로 진행 상황을 봄)
  const prior = await sb.from("image_generations").select(GEN_COLS).eq("request_key", requestKey).maybeSingle();
  if (prior.error) throw prior.error;
  if (prior.data) return json({ generation: prior.data, duplicate: true });
  const { post, slot, purpose } = await slotTarget(b, true);
  const mode = b.mode === "edit" ? "edit" : "generate";
  const ratio = ratioOf(purpose, str(b.ratio, 8));
  const style = has(STYLES, b.style) ? String(b.style) : "life_photo";
  const text = str(b.text, 300).trim() || String(slot!.text ?? "").trim();
  const extra = str(b.extra, 400).trim();
  if (!text) fail(400, "bad_field", { field: "text" });
  const s = await imageSettings();
  const model = String(mode === "edit" ? s.image_edit_model : s.image_gen_model);
  const isTest = model === TEST_MODEL;
  const capsModel = isTest ? "gpt-image-2.5-flare" : model; // 점검용 가짜 모델은 크기·품질 규칙을 2.5처럼
  // 모델이 못 받는 품질은 가까운 것으로 (xhigh·max는 2.5 계열만 — OpenAI API 레퍼런스)
  const quality = normQuality(capsModel, (QUALITIES as readonly string[]).includes(String(b.quality)) ? String(b.quality) : String(s.image_quality));
  const caps = modelCaps(capsModel);
  const isFree = caps.provider === "cloudflare";
  if (isFree && mode === "edit") fail(400, "edit_unsupported");
  if (isFree && !keysInfo().cloudflare) fail(503, "cf_key_missing");
  if (!isTest && !isFree && !keyOpenAI()) fail(503, "openai_key_missing");
  // 상표·가격·인증·후기 사진·글자 요청은 서버에서도 막음 (화면에서 먼저 알려줌)
  const products = await linkedProducts(String(post!.id));
  const risks = blocksOf(promptRisk(text + "\n" + extra, products.brands));
  if (risks.length) fail(400, "prompt_blocked", { risks });
  // 실제 상품·화면이 보여야 하는 자리(구성품·라벨·화면 등)는 사용자가 '일반 장면'이라고 확인해야만 만들고, 확인한 말을 기록
  const real = slotRisk(text + " " + extra);
  if (real.real && b.generic_ok !== true) fail(400, "real_photo_needed", { word: real.word });
  let base: J | null = null;
  if (mode === "edit") {
    if (!isUuid(b.base_image_id)) fail(400, "bad_field", { field: "base_image_id" });
    const { data } = await sb.from("post_images").select("*").eq("id", b.base_image_id).is("deleted_at", null).maybeSingle();
    if (!data) fail(404, "not_found");
    // 직접 찍은 사진·실제 사진을 AI로 고치면 실제와 다른 '진짜 같은 사진'이 될 수 있어서, AI가 만든 이미지만 고침
    if ((data as J).kind !== "ai") fail(400, "edit_ai_only");
    base = data as J;
  }
  const size = sizeFor(purpose, ratio, capsModel);
  if (!isFree && !validApiSize(size)) fail(400, "bad_field", { field: "ratio" }); // 크기 규칙은 OpenAI 것 (무료 모델은 정해 둔 크기)
  // 맥락(제목·소제목·앞뒤 문장)에서 연결 상품 이름·브랜드·모델명·가격·인증 표현을 지우고 보냄
  const prompt = buildPrompt({ post, slot, text, style, purpose, ratio, extra, mode, hide: products.hide });
  const est = isTest ? 0 : estimateUsd({ quality, size, promptTokens: estimateTokens(prompt), mode, prices: s.image_prices, model });
  if (est == null) fail(400, "bad_field", { field: "quality" });
  // 화면에서 보여준 예상 비용보다 눈에 띄게 비싸지면(설정·가격·제목이 바뀐 경우) 다시 확인받음 — 토큰 몇 개 차이는 넘어감
  const seen = Number(b.confirm_usd);
  const tol = Math.max(0.0005, Number(est) * 0.02);
  if (!isTest && !(Number.isFinite(seen) && seen + tol >= Number(est))) {
    fail(409, "estimate_changed", { est_usd: est, model, quality, size, prices: s.image_prices });
  }
  await storageGuard(2 * 1024 * 1024);
  // 이 일꾼이 꺼질 때까지 남은 시간이 그 품질을 기다리기에 모자라면, 돈이 나가기 전에 '잠깐 뒤에 다시' (그때는 새 일꾼이 받음)
  // 화면은 retry_after 초만큼 기다렸다가 같은 요청 번호로 다시 보냄 (image_service.js busyRetryAfter)
  if (DEADLINE - Date.now() < (isFree ? 45000 : needMsFor(quality, mode, WALL_MS))) {
    fail(503, "server_busy", { retry_after: busyRetryAfter(Date.now() - BOOT_AT, WALL_MS) });
  }
  const begin = await sb.rpc("image_gen_begin", {
    p: {
      request_key: requestKey, post_id: post!.id, slot_key: slot!.key, slot_index: slot!.index, slot_text: slot!.text, mode, model, size, quality,
      provider: isFree ? "cloudflare" : "openai",
      output_format: "jpeg", purpose, style, user_prompt: [text, extra].filter(Boolean).join("\n"), prompt, base_image_id: base ? base.id : "", est_usd: est,
      risk_override: real.real ? "일반 장면으로 만들기 확인: " + real.word : "",
    },
  });
  if (begin.error) rpcError(begin.error);
  const gen = begin.data as J;
  const { prompt: _p, revised_prompt: _r, ...pub } = gen;
  if (gen.duplicate) return json({ generation: pub, duplicate: true });
  RUNNING.add(String(gen.id));
  const task = runGeneration(imageDeps(), gen, {
    key: keyOpenAI(), cf: keyCf(), prices: s.image_prices, safetyId: await safetyIdOf(c.auth), deadline: DEADLINE, timeoutMs: isFree ? 90_000 : 115_000, ratio,
    base: base ? { path: String(base.storage_path), mime: String(base.mime) } : null,
    // 고치기는 바뀐 내용(지시)이 아니라 원래 이미지 설명을 그대로 씀 (지시는 생성 기록의 user_prompt 에)
    description: mode === "edit" ? String(base?.description || slot!.text || text) : text,
  }).catch(async (e) => {
    console.error("image generation:", String((e as Error)?.message ?? e).slice(0, 200));
    await sb.rpc("image_gen_fail", { gen: gen.id, fin: { error_code: "server_error", error_message: "서버에서 문제가 생겼어. 청구됐을 수 있으니 OpenAI 사용량을 확인해줘.", cost_status: "확인 필요" } });
  }).finally(() => RUNNING.delete(String(gen.id)));
  inBackground(task);
  return json({ generation: pub, est_usd: est, model, size, quality }, 202);
}
// 4분 넘게 끝나지 않은 생성은 실패(청구됐을 수 있음 → 확인 필요)로 정리 (그 생성 하나 또는 그 글 전체)
async function sweepStale(postId: string | null, genId?: string) {
  // deno-lint-ignore no-explicit-any
  let q: any = sb.from("image_generations").update({
    status: "실패", error_code: "timeout", error_message: "응답이 끝나지 않아 멈췄어. 청구됐을 수 있으니 OpenAI 사용량에서 확인해줘.",
    cost_status: "확인 필요", auto_cost_status: "확인 필요", finished_at: nowIso(),
  }).eq("status", "생성 중").lt("started_at", new Date(Date.now() - 240e3).toISOString());
  q = genId ? q.eq("id", genId) : q.eq("post_id", postId);
  const { error } = await q;
  if (error) console.error("sweep:", error.message);
}
async function getGeneration(c: Ctx) {
  const id = c.params[0];
  await sweepStale(null, id);
  const { data: g, error } = await sb.from("image_generations").select(GEN_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!g) fail(404, "not_found");
  let image: J | null = null;
  if ((g as J).image_id) {
    const { data: img } = await sb.from("post_images").select("*").eq("id", (g as J).image_id).maybeSingle();
    if (img) image = (await withUrls([img as J]))[0];
  }
  return json({ generation: g, image, usage: await imageUsage() });
}
// 실제 청구액 넣기 (OpenAI 사용량 화면에서 확인한 값). 앱이 청구액을 직접 가져오지는 못함
async function setGenerationCost(c: Ctx) {
  const b = await readJson(c.req, 5_000);
  const { data: g, error: e1 } = await sb.from("image_generations").select("id, status, usage_usd, auto_cost_status").eq("id", c.params[0]).maybeSingle();
  if (e1) throw e1;
  if (!g) fail(404, "not_found");
  if ((g as J).status === "생성 중") fail(409, "bad_state");
  const st = str(b.cost_status, 20);
  let patch: J;
  if (st === "청구 없음") patch = { actual_usd: null, actual_checked_at: optDate(b.actual_checked_at, "actual_checked_at") ?? kstToday(), cost_status: "청구 없음" };
  else if (st === "확인 필요") patch = { actual_usd: null, actual_checked_at: null, cost_status: "확인 필요" };
  // 넣은 값 지우기: 서버가 처음 매긴 상태로 되돌림 ('확인 필요'·'청구 없음'이 '예상'으로 바뀌지 않게)
  else if (b.actual_usd === null || b.actual_usd === "" || b.actual_usd === undefined) patch = { actual_usd: null, actual_checked_at: null, cost_status: String((g as J).auto_cost_status || ((g as J).usage_usd != null ? "사용량 기준" : "예상")) };
  else patch = { actual_usd: optNum(b.actual_usd, "actual_usd", 0, 100), actual_checked_at: optDate(b.actual_checked_at, "actual_checked_at") ?? kstToday(), cost_status: "청구액 확인" };
  const { data, error } = await sb.from("image_generations").update(patch).eq("id", c.params[0]).select(GEN_COLS).single();
  if (error) throw error;
  return json({ generation: data });
}

// 사진 공급자 (Pexels): 검색은 서버가 대신 (키를 화면에 안 보냄), 시간당·월 한도를 앱에서도 지킴
async function stockGuard(provider: string) {
  const P = PHOTO_PROVIDERS[provider as keyof typeof PHOTO_PROVIDERS];
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  const monthStart = new Date(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7) + "-01T00:00:00+09:00").toISOString();
  const [h, mo] = await Promise.all([
    sb.from("api_calls").select("id", { count: "exact", head: true }).eq("provider", provider).gte("at", since(3600e3)),
    sb.from("api_calls").select("id", { count: "exact", head: true }).eq("provider", provider).gte("at", monthStart),
  ]);
  if ((h.count ?? 0) >= P.hourLimit) fail(429, "stock_hour_limit");
  if ((mo.count ?? 0) >= P.monthLimit) fail(429, "stock_month_limit");
}
async function stockSearch(c: Ctx) {
  const provider = c.url.searchParams.get("provider") ?? "pexels";
  if (!has(PHOTO_PROVIDERS, provider)) fail(400, "bad_field", { field: "provider" });
  const P = PHOTO_PROVIDERS[provider as keyof typeof PHOTO_PROVIDERS];
  const q = (c.url.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) fail(400, "bad_field", { field: "q" });
  const orientation = c.url.searchParams.get("orientation") ?? "";
  const page = optInt(c.url.searchParams.get("page") ?? "1", "page", 1, 50) ?? 1;
  const key = Deno.env.get(P.envKey) ?? "";
  if (!key) fail(503, "pexels_key_missing");
  await stockGuard(provider);
  const r = await P.search({ fetchImpl: fetch, key, query: q, orientation, page, perPage: 24 }) as J;
  await imageDeps().logCall(provider, "search", Number(r.status ?? 0));
  if (!r.ok) fail(r.code === "pexels_rate_limited" ? 429 : 502, String(r.code));
  return json({ provider, label: P.label, site: P.site, license_url: P.licenseUrl, photos: r.photos, total: r.total, page: r.page, has_next: r.hasNext, remaining: r.remaining });
}
async function stockSelect(c: Ctx) {
  const b = await readJson(c.req, 10_000);
  const provider = str(b.provider, 20) || "pexels";
  if (!has(PHOTO_PROVIDERS, provider)) fail(400, "bad_field", { field: "provider" });
  const photoId = optInt(b.photo_id, "photo_id", 1, 9_000_000_000_000);
  if (!photoId) fail(400, "bad_field", { field: "photo_id" });
  const { post, slot, purpose } = await slotTarget(b, false);
  await stockGuard(provider);
  await storageGuard();
  const P = PHOTO_PROVIDERS[provider as keyof typeof PHOTO_PROVIDERS];
  const r = await saveStockPhoto(imageDeps(), { provider, photoId, key: Deno.env.get(P.envKey) ?? "", post, slot, purpose, link: b.link === true && !!slot }) as J;
  if (!r.ok) { if (r.error) rpcError(r.error as { message?: string }); fail(Number(r.status ?? 500), String(r.code)); }
  return json({ image: (await withUrls([r.image as J]))[0], slot: r.slot ?? null, reused: !!r.reused });
}

// 직접 올리기: 앱은 multipart(파일+정보), 점검용으로 JSON(base64)도 받음. 실제 내용으로 형식 검사, 숨은 정보 지움
async function uploadImage(c: Ctx) {
  const ct = (c.req.headers.get("content-type") ?? "").toLowerCase();
  const len = Number(c.req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES * 1.4 + 100_000) fail(413, "too_large");
  let bytes: Uint8Array = new Uint8Array();
  let declared = "";
  let meta: J = {};
  if (ct.startsWith("multipart/form-data")) {
    let form: FormData;
    try { form = await c.req.formData(); } catch { return fail(400, "bad_body"); }
    const f = form.get("file");
    if (!(f instanceof Blob)) fail(400, "bad_field", { field: "file" });
    const file = f as Blob;
    if (file.size > MAX_UPLOAD_BYTES) fail(413, "too_large");
    bytes = new Uint8Array(await file.arrayBuffer());
    declared = file.type;
    try { meta = JSON.parse(String(form.get("meta") ?? "{}")) as J; } catch { fail(400, "bad_body"); }
  } else if (ct.startsWith("application/json")) {
    const b = await readJson(c.req, Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 20_000);
    if (typeof b.b64 !== "string") fail(400, "bad_field", { field: "b64" });
    try { bytes = b64ToBytes(b.b64); } catch { fail(400, "bad_field", { field: "b64" }); }
    declared = str(b.mime, 40);
    meta = b;
  } else fail(415, "bad_type");
  if (!meta || typeof meta !== "object") meta = {};
  const { post, slot, purpose } = await slotTarget(meta, false);
  await storageGuard(bytes.length);
  // 카드뉴스 배경으로 쓴 이미지의 출처(사진가·AI 여부)를 카드 PNG 기록에도 남김
  let bg: J | null = null;
  if (meta.kind === "card" && isUuid(meta.bg_image_id)) {
    const { data } = await sb.from("post_images").select("kind, provider, source_url, author_name, author_url, attribution_text, license, rights_confirmed").eq("id", meta.bg_image_id).maybeSingle();
    bg = (data as J | null) ?? null;
  }
  const r = await saveUploaded(imageDeps(), {
    bytes, declaredMime: declared, kind: meta.kind === "card" ? "card" : "upload", rights: meta.rights === true,
    post, slot, purpose, description: str(meta.description, 300), link: meta.link === true && !!slot, bg,
  }) as J;
  if (!r.ok) { if (r.error) rpcError(r.error as { message?: string }); fail(Number(r.status ?? 500), String(r.code), r.reason ? { reason: r.reason } : {}); }
  // 직접 올린 사진의 출처: 사용자가 고른 것만 저장 (안 고르면 빈칸 = 출처 확인 필요. 올렸다고 직접 촬영으로 보지 않음)
  const src = sourceTypeOf(meta.source_type);
  const saved = r.image as J;
  if (saved && saved.kind === "upload" && src && saved.source_type !== src) {
    const u = await sb.from("post_images").update({ source_type: src }).eq("id", saved.id).select().maybeSingle();
    if (u.error) console.error("upload source_type:", u.error.message); // 저장 실패해도 사진은 남김 ('출처 확인 필요'로 보임)
    else if (u.data) r.image = u.data;
  }
  return json({ image: (await withUrls([r.image as J]))[0], slot: r.slot ?? null, reused: !!r.reused });
}
const SOURCE_TYPES = ["own", "official", "external"] as const;
// PostgREST '그런 열 없음' 오류인지 (마이그레이션 전 DB)
function missingColumn(e: unknown, col: string): boolean {
  const x = (e ?? {}) as { code?: string; message?: string };
  return (x.code === "PGRST204" || x.code === "42703") && String(x.message ?? "").includes(col);
}
// 빈칸('') = 출처 확인 필요. 그 밖의 값은 버림
function sourceTypeOf(v: unknown): string {
  const t = typeof v === "string" ? v.trim() : "";
  return (SOURCE_TYPES as readonly string[]).includes(t) ? t : "";
}

// 보관함
async function listImages(c: Ctx) {
  const kind = c.url.searchParams.get("kind");
  const before = c.url.searchParams.get("before");
  const postId = c.url.searchParams.get("post_id");
  let q = sb.from("post_images").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(48);
  if (kind) q = q.eq("kind", oneOf(kind, ["ai", "stock", "upload", "card"] as const, "kind"));
  if (postId) { if (!isUuid(postId)) fail(400, "bad_field", { field: "post_id" }); q = q.eq("origin_post_id", postId); }
  if (before) { if (isNaN(Date.parse(before))) fail(400, "bad_field", { field: "before" }); q = q.lt("created_at", before); }
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as J[];
  return json({ images: await withUrls(rows), usage: await imageUsage(), next: rows.length === 48 ? rows[rows.length - 1].created_at : null });
}
async function getImage(c: Ctx) {
  const { data, error } = await sb.from("post_images").select("*").eq("id", c.params[0]).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  const [slots, decks, gen] = await Promise.all([
    sb.from("post_image_slots").select("post_id, slot_key, slot_index, slot_text, used_at, downloaded_at, posts(titles, keyword, deleted_at)").eq("image_id", c.params[0]),
    sb.from("post_card_decks").select("post_id").eq("bg_image_id", c.params[0]),
    (data as J).generation_id ? sb.from("image_generations").select(GEN_COLS).eq("id", (data as J).generation_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (slots.error) throw slots.error;
  if (decks.error) throw decks.error;
  return json({ image: (await withUrls([data as J]))[0], used_in: slots.data, decks: decks.data, generation: gen.data });
}
async function patchImage(c: Ctx) {
  const b = await readJson(c.req, 10_000);
  const p: J = {};
  if ("review_status" in b) p.review_status = oneOf(b.review_status, ["검수 전", "사용 가능", "사용 안 함"] as const, "review_status");
  if ("review_note" in b) p.review_note = str(b.review_note, 300).trim();
  if ("description" in b) p.description = str(b.description, 500).trim();
  if ("alt_text" in b) p.alt_text = str(b.alt_text, 300).trim();
  if ("source_type" in b) {
    // 출처는 직접 올린 사진만 고름 (AI·Pexels·카드뉴스는 만든 방법으로 정해짐)
    if (b.source_type !== "" && !sourceTypeOf(b.source_type)) fail(400, "bad_field", { field: "source_type" });
    const { data: cur, error: e0 } = await sb.from("post_images").select("kind").eq("id", c.params[0]).is("deleted_at", null).maybeSingle();
    if (e0) throw e0;
    if (!cur) fail(404, "not_found");
    if ((cur as J).kind !== "upload") fail(400, "bad_field", { field: "source_type" });
    p.source_type = sourceTypeOf(b.source_type);
  }
  if (!Object.keys(p).length) fail(400, "empty");
  const { data, error } = await sb.from("post_images").update(p).eq("id", c.params[0]).is("deleted_at", null).select().maybeSingle();
  if (error && "source_type" in p && missingColumn(error, "source_type")) fail(409, "db_update_needed", { migration: "015" }); // 015 전 DB
  if (error) throw error;
  if (!data) fail(404, "not_found");
  return json({ image: (await withUrls([data as J]))[0] });
}
// 지우기: 어느 원고(휴지통 포함)·카드뉴스에서라도 쓰는 중이면 거절. 기록(비용·출처)은 남기고 파일만 지움
async function deleteImage(c: Ctx) {
  const { data, error } = await sb.rpc("image_delete", { p_image: c.params[0] });
  if (error) rpcError(error);
  const path = String((data as J)?.storage_path ?? "");
  let removed = false;
  if (path) {
    const r = await sb.storage.from(BUCKET).remove([path]);
    removed = !r.error;
    if (r.error) console.error("image file remove:", r.error.message);
  }
  return json({ ok: true, file_removed: removed });
}
async function markDownloaded(c: Ctx) {
  const b = await readJson(c.req, 20_000);
  const items = Array.isArray(b.items) ? (b.items as J[]).slice(0, 40) : [];
  const ids = [...new Set(items.map((x) => x?.image_id).filter(isUuid))] as string[];
  if (!ids.length) fail(400, "empty");
  const now = nowIso();
  const r = await sb.from("post_images").update({ downloaded_at: now }).in("id", ids);
  if (r.error) throw r.error;
  for (const it of items) {
    if (!isUuid(it?.post_id) || !isUuid(it?.image_id) || !validSlotKey(it?.slot_key)) continue;
    const u = await sb.from("post_image_slots").update({ downloaded_at: now }).eq("post_id", it.post_id).eq("slot_key", it.slot_key).eq("image_id", it.image_id);
    if (u.error) throw u.error;
  }
  return json({ ok: true, at: now });
}

// 사진 자리 연결·빼기·맞바꾸기·자르기/사용 완료
async function linkSlot(c: Ctx) {
  const b = await readJson(c.req, 10_000);
  const postId = c.params[0];
  if (b.image_id === null) {
    // 빼기: 지금 본문에 없는 자리(사라진 자리)도 뺄 수 있게, 그 원고의 연결 줄을 지움 (이미지는 보관함에 그대로)
    const key = str(b.slot_key, 220);
    if (!validSlotKey(key)) fail(400, "bad_field", { field: "slot_key" });
    await getPost(postId);
    const { error } = await sb.from("post_image_slots").delete().eq("post_id", postId).eq("slot_key", key);
    if (error) throw error;
    return json({ ok: true, slot: null });
  }
  if (!isUuid(b.image_id)) fail(400, "bad_field", { field: "image_id" });
  const { slot, purpose } = await slotTarget({ ...b, post_id: postId }, true);
  // 용도를 따로 안 보내면 그 자리에 저장해 둔 용도를 그대로 (연결할 때마다 기본값으로 돌아가지 않게)
  let use = has(PURPOSES, b.purpose) ? String(b.purpose) : "";
  if (!use) {
    const { data: ex } = await sb.from("post_image_slots").select("purpose").eq("post_id", postId).eq("slot_key", slot!.key).maybeSingle();
    use = String((ex as J | null)?.purpose ?? "") || purpose;
  }
  const { data, error } = await sb.rpc("image_slot_upsert", {
    p_post: postId, p: { slot_key: slot!.key, slot_index: slot!.index, slot_text: slot!.text, slot_ctx: ctxOf(slot), image_id: b.image_id, purpose: use },
  });
  if (error) rpcError(error);
  return json({ slot: data });
}
async function swapSlots(c: Ctx) {
  const b = await readJson(c.req, 10_000);
  const post = await getPost(c.params[0]);
  const cur = parseSlots(String(post.body ?? ""));
  const a = cur.find((s: J) => s.key === str(b.a, 220)), z = cur.find((s: J) => s.key === str(b.b, 220));
  if (!a || !z || a.key === z.key) fail(400, "bad_field", { field: "slot_key" });
  const { data, error } = await sb.rpc("image_slot_swap", {
    p_post: post.id,
    a: { slot_key: a.key, slot_index: a.index, slot_text: a.text, slot_ctx: ctxOf(a) }, b: { slot_key: z.key, slot_index: z.index, slot_text: z.text, slot_ctx: ctxOf(z) },
  });
  if (error) rpcError(error);
  return json(data);
}
async function patchSlot(c: Ctx) {
  const b = await readJson(c.req, 10_000);
  const post = await getPost(c.params[0]);
  const key = str(b.slot_key, 220);
  if (!validSlotKey(key)) fail(400, "bad_field", { field: "slot_key" });
  const patch: J = {};
  if ("crop" in b) {
    if (b.crop === null) patch.crop = null;
    else {
      const cr = (b.crop ?? {}) as J;
      const ratio = str(cr.ratio, 8), x = Number(cr.x), y = Number(cr.y);
      if (!has(RATIOS, ratio) || !(x >= 0 && x <= 1) || !(y >= 0 && y <= 1)) fail(400, "bad_field", { field: "crop" });
      patch.crop = { ratio, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
    }
  }
  if ("used" in b) patch.used_at = b.used === true ? nowIso() : null;
  if ("purpose" in b) { if (!has(PURPOSES, b.purpose)) fail(400, "bad_field", { field: "purpose" }); patch.purpose = String(b.purpose); }
  if (!Object.keys(patch).length) fail(400, "empty");
  const { data, error } = await sb.from("post_image_slots").update(patch).eq("post_id", post.id).eq("slot_key", key).not("image_id", "is", null).select().maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  return json({ slot: data });
}

// 카드뉴스 (문구·템플릿 저장. 그림은 앱이 직접 그려서 PNG로 내보냄 — 글자를 이미지 AI로 만들지 않음)
async function saveCards(c: Ctx) {
  const b = await readJson(c.req, 40_000);
  const post = await getPost(c.params[0]);
  if (!Array.isArray(b.slides)) fail(400, "bad_field", { field: "slides" });
  const slides = (b.slides as J[]).slice(0, CARD_LIMITS.slides).map((x) => ({
    title: str(x?.title, CARD_LIMITS.title).trim(), text: str(x?.text, CARD_LIMITS.text).trim(), icon: has(CARD_ICONS, x?.icon) ? String(x.icon) : "",
  })).filter((x) => x.title || x.text);
  if (!slides.length) fail(400, "empty");
  let bg: string | null = null;
  if (b.bg_image_id !== null && b.bg_image_id !== undefined && b.bg_image_id !== "") {
    if (!isUuid(b.bg_image_id)) fail(400, "bad_field", { field: "bg_image_id" });
    bg = String(b.bg_image_id);
  }
  const row = {
    template: oneOf(b.template ?? "clean", Object.keys(CARD_TEMPLATES), "template"), ratio: oneOf(b.ratio ?? "4:5", CARD_RATIOS as string[], "ratio"),
    slides, ad_label: b.ad_label !== false, bg_image_id: bg,
  };
  // 저장과 '배경 이미지가 아직 있는지' 확인을 DB 함수 하나에서 (그 이미지를 지우는 요청과 겹쳐도 지운 이미지를 가리키지 않게)
  const { data, error } = await sb.rpc("card_deck_save", { p_post: post.id, p: row });
  if (error) rpcError(error);
  return json({ deck: data });
}

// ───────── 1.4.0 운영: 다른 채널 기록 · 유입 검색어 · 예정일 다시 잡기 ─────────
// 016 전 DB(표·함수가 아직 없음)면 'DB 업데이트 필요'로 알려줌
function missingTable(e: unknown, name: string): boolean {
  const x = (e ?? {}) as { code?: string; message?: string };
  return ["PGRST205", "42P01", "PGRST202", "42883"].includes(String(x.code ?? "")) && String(x.message ?? "").includes(name);
}
const needs016 = (e: unknown, name: string) => { if (missingTable(e, name)) fail(409, "db_update_needed", { migration: "016" }); };
async function savePostChannel(c: Ctx) {
  const b = await readJson(c.req, 10_000);
  const post = await getPost(c.params[0]);
  const cat = await catalog();
  const ch = str(b.channel_id, 40);
  if (!has(cat.channels, ch)) fail(400, "bad_field", { field: "channel_id" });
  if (ch === post.channel_id) fail(400, "bad_field", { field: "channel_id" }); // 메인 채널은 '게시 완료 기록'으로
  const url = optUrl(b.url, "url");
  if (url && !/^https:\/\//i.test(url)) fail(400, "bad_field", { field: "url" });
  if (url.length > 500) fail(400, "bad_field", { field: "url" });
  const row: J = {
    post_id: post.id, channel_id: ch, url, posted_on: reqDate(b.posted_on, "posted_on"),
    variant_key: REFORMAT_TARGETS.includes(String(b.variant_key)) ? String(b.variant_key) : "", note: str(b.note, 300).trim(),
  };
  const { data, error } = await sb.from("post_channels").upsert(row, { onConflict: "post_id,channel_id" }).select().single();
  if (error) { needs016(error, "post_channels"); throw error; }
  return json({ post_channel: data });
}
async function deletePostChannel(c: Ctx) {
  const { data, error } = await sb.from("post_channels").delete().eq("id", c.params[0]).select("id").maybeSingle();
  if (error) { needs016(error, "post_channels"); throw error; }
  if (!data) fail(404, "not_found");
  return json({ ok: true });
}
// 유입 검색어: 블로그 통계에서 옮겨 적은 숫자 (앱이 직접 모으지 않음). 같은 글·검색어·기간이면 숫자만 새로
async function saveSearchTerms(c: Ctx) {
  const b = await readJson(c.req, 200_000);
  const post = await getPost(c.params[0]);
  const start = reqDate(b.period_start, "period_start");
  const end = optDate(b.period_end, "period_end") ?? start;
  if (end < start) fail(400, "bad_field", { field: "period_end" });
  const items = Array.isArray(b.terms) ? (b.terms as J[]) : fail(400, "bad_field", { field: "terms" });
  if (!items.length) fail(400, "empty");
  if (items.length > 300) fail(413, "too_many_rows");
  const cat = await catalog();
  const ch = has(cat.channels, b.channel_id) ? String(b.channel_id) : String(post.channel_id || "") || null;
  const label = str(b.source_label, 60).trim() || "블로그 통계 · 유입 검색어";
  const seen = new Map<string, J>();
  for (const it of items) {
    const term = str(it?.term, 200).replace(/\s+/g, " ").trim();
    if (!term || term.length > 100) fail(400, "bad_field", { field: "terms" });
    const views = optInt(it?.views, "terms", 0, 1e9);
    const k = term.toLowerCase();
    const was = seen.get(k);
    if (was) { if (views != null) was.views = (Number(was.views ?? 0)) + views; continue; }
    seen.set(k, { post_id: post.id, term, views, period_start: start, period_end: end, channel_id: ch, source_label: label });
  }
  const rows = [...seen.values()];
  const { data, error } = await sb.from("search_terms").upsert(rows, { onConflict: "post_id,term,period_start,period_end" }).select();
  if (error) { needs016(error, "search_terms"); throw error; }
  return json({ saved: (data ?? []).length, search_terms: data ?? [] });
}
async function deleteSearchTerm(c: Ctx) {
  const { data, error } = await sb.from("search_terms").delete().eq("id", c.params[0]).select("id").maybeSingle();
  if (error) { needs016(error, "search_terms"); throw error; }
  if (!data) fail(404, "not_found");
  return json({ ok: true });
}
async function rescheduleOverdue(_c: Ctx) {
  const { data, error } = await sb.rpc("reschedule_overdue");
  if (error) { needs016(error, "reschedule_overdue"); rpcError(error); }
  return json({ moved: data ?? [] });
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
  ["POST", R("posts/reschedule-overdue"), rescheduleOverdue],
  ["POST", R(`posts/${U}/channels`), savePostChannel],
  ["DELETE", R(`post-channels/${U}`), deletePostChannel],
  ["POST", R(`posts/${U}/search-terms`), saveSearchTerms],
  ["DELETE", R(`search-terms/${U}`), deleteSearchTerm],
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
  // 이미지 스튜디오
  ["GET", R("images/config"), getImageConfig],
  ["GET", R("images"), listImages],
  ["POST", R("images/upload"), uploadImage],
  ["POST", R("images/generate"), generateImage],
  ["POST", R("images/downloaded"), markDownloaded],
  ["GET", R(`images/generations/${U}`), getGeneration],
  ["POST", R(`images/generations/${U}/cost`), setGenerationCost],
  ["GET", R(`images/${U}`), getImage],
  ["POST", R(`images/${U}`), patchImage],
  ["DELETE", R(`images/${U}`), deleteImage],
  ["GET", R("stock/search"), stockSearch],
  ["POST", R("stock/select"), stockSelect],
  ["GET", R(`posts/${U}/images`), getPostImages],
  ["POST", R(`posts/${U}/images/link`), linkSlot],
  ["POST", R(`posts/${U}/images/swap`), swapSlots],
  ["POST", R(`posts/${U}/images/slot`), patchSlot],
  ["POST", R(`posts/${U}/cards`), saveCards],
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
  const at = parts.findIndex((p) => p.startsWith("blog-app") || p.startsWith(FN_GEN));
  const genFn = at >= 0 && parts[at].startsWith(FN_GEN);
  const route = (at >= 0 ? parts.slice(at + 1) : parts.slice(1)).join("/");
  try {
    if (route === "ping") return json({ ok: true, version: VERSION, fn: genFn ? FN_GEN : "blog-app", time: nowIso() });
    // blog-gen 은 생성 요청만 (나머지는 blog-app 으로)
    if (genFn && !(req.method === "POST" && route === "images/generate")) return json({ error: "not_found" }, 404);
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
