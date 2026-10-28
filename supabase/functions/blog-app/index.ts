// 블로그 글공장 서버 API (1.5.1)
// - 기기별 로그인: 접속 코드로 한 번 로그인하면 기기마다 세션 토큰을 받음 (접속 코드는 기기에 남기지 않음)
// - 표는 모두 RLS로 잠겨 있고, 이 함수만 서버 키로 읽고 씀
// - '발행 준비 완료'는 서버에서도 checks.js 로 다시 검사해서 오류가 있으면 거부
// - 이미지 스튜디오: OpenAI·Pexels 키는 이 함수의 환경변수(Secrets)에만 있고 화면으로는 '있음/없음'만 보냄.
//   이미지 파일은 비공개 버킷(post-images)에, 정보는 post_images 표에. 화면은 1시간짜리 서명 주소로만 봄
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkPost, disclosureFor, USER_TRANSITIONS, CONTENT_TYPES, SCORE_FACTORS, VAGUE_DISCLOSURE } from "./checks.js";
import {
  parseSlots, matchSlots, planSlotSync, ctxOf, EXTRA_SLOTS, extraSlot, isExtraKey, validSlotKey, slotPurpose, PURPOSES, RATIOS, QUALITIES, ratioOf, sizeFor,
  validApiSize, promptRisk, blocksOf, estimateUsd, estimateTokens, normQuality, modelCaps, DEFAULT_PRICES, MAX_UPLOAD_BYTES,
  CARD_TEMPLATES, CARD_RATIOS, CARD_ICONS, CARD_LIMITS,
  presetOf, buildScene, promptFromScene, sizeLabel, aiGate, REF_ROLES, SCENE_EDITABLE, IMAGE_MODES, REVIEW_MODELS, reviewCaps, estimateReviewUsd, EVAL_CRITERIA, PRESETS, refsLimit, sniffImage,
  GEMINI_PRICE_IDS, sceneDrawText, sceneGateText,
  // 1.5.1 상품 장면
  cleanProductSpec, buildProductScene, promptFromProductScene, productGate, PRODUCT_PRESETS, PRODUCT_TEMPLATES, PRODUCT_CHECKS, productSceneMode, productApproved,
  cleanLayer, productAttribution, compositeLicense, productGateErrors, checkImageFile, stripMetadata, altTextFor,
} from "./images.js";
import {
  BUCKET, TEST_MODEL, PHOTO_PROVIDERS, runGeneration, saveStockPhoto, saveUploaded, b64ToBytes, needMsFor, busyRetryAfter,
  reviewPrompt, parseReview, visionReview, reviewUsageUsd, providerCheck, scrub, storagePath, sha256Hex,
} from "./image_service.js";

const VERSION = "1.5.1";
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
  if (/image_request_cap/.test(m)) fail(429, "image_request_cap");
  if (/review_busy/.test(m)) fail(409, "review_busy");
  // 1.5.1 상품 장면 (018)
  if (/product_check_needed/.test(m)) fail(409, "product_check_needed");
  if (/product_check_incomplete/.test(m)) fail(400, "product_check_incomplete");
  if (/not_product_scene/.test(m)) fail(400, "not_product_scene");
  if (/product_image_required/.test(m)) fail(400, "product_image_required");
  if (/background_image_required/.test(m)) fail(400, "background_image_required");
  if (/background_mismatch/.test(m)) fail(400, "background_mismatch");
  if (/image_generating/.test(m)) fail(409, "image_generating");
  if (/layer_required/.test(m)) fail(400, "bad_field", { field: "layer" });
  if (/mask_mismatch/.test(m)) fail(400, "mask_mismatch");
  if (/mask_real_only/.test(m)) fail(400, "mask_real_only");
  if (/rights_required/.test(m)) fail(400, "rights_required");
  if (/bad provider/.test(m)) fail(400, "bad_field", { field: "provider" });
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
  // 1.4.0: 다른 채널 기록·유입 검색어·실적이 있는 글 — 못 읽으면(016 전 DB거나 오류) 빈 목록을 보내고 unavailable 에 적음
  // → 화면은 0이 아니라 '데이터 없음'으로 보여줌 (빈 목록과 못 읽은 것을 구분)
  const unavailable: string[] = [];
  const soft = <T>(p: PromiseLike<T>, key: string, empty: T): Promise<T> => Promise.resolve(p).catch((e) => {
    console.error(`state ${key}:`, String((e as Error)?.message ?? e));
    unavailable.push(key);
    return empty;
  });
  const rpcData = (p: PromiseLike<{ data: unknown; error: unknown }>) => Promise.resolve(p).then(({ data, error }) => { if (error) throw error; return data; });
  // 홈 '최근 7일 정리'의 자동 작가 실행 수: 한국 날짜로 6일 전 0시부터 (실행 기록 목록이 잘려도 정확하게)
  const week0 = new Date(Date.parse(`${kstToday()}T00:00:00+09:00`) - 6 * 86400e3).toISOString();
  const [postChannels, searchTerms, metricPosts, runsAuto7d] = await Promise.all([
    soft(fetchAll("post_channels", [["posted_on", false], ["id", true]]), "post_channels", [] as J[]),
    soft(fetchAll("search_terms", [["period_end", false], ["id", true]], (q) => q.gte("period_end", since400),
      "id, post_id, term, views, period_start, period_end, channel_id, source_label, created_at"), "search_terms", [] as J[]),
    // 흐름판의 '실적' 단계: 실적이 한 줄이라도 있는 글 (DB가 글 id 만 모아서 줌)
    soft(rpcData(sb.rpc("metric_post_ids")).then((d) => (Array.isArray(d) ? d.map(String) : [])), "metric_post_ids", [] as string[]),
    Promise.resolve(sb.from("runs").select("id", { count: "exact", head: true }).eq("kind", "auto").gte("ran_at", week0))
      .then((r) => { if (r.error) throw r.error; return typeof r.count === "number" ? r.count : null; })
      .catch((e) => { console.error("state runs_auto_7d:", String((e as Error)?.message ?? e)); return null; }),
  ]);
  const [products, pp, links, imageSlots] = await Promise.all([
    fetchAll("products", [["updated_at", false], ["id", true]]),
    fetchAll("post_products", [["post_id", true], ["sort", true], ["product_id", true]]),
    fetchAll("links", [["post_id", true], ["sort", true], ["id", true]]),
    // 원고 목록·발행 전 검사에 쓰는 사진 자리 연결 요약 (1000줄이 넘어도 끝까지. 이미지 스튜디오 표가 아직 없으면 빈 목록)
    // source_type(직접 올린 사진의 출처)은 014→015 사이, composite(실제 사진을 참고한 AI 이미지)는 017, composite_mode·product_check(상품 장면·상품 검수)는 018에서 생김
    // — 그 전 DB면 없는 칸을 빼고 다시 읽음 (모르는 칸이 하나라도 있으면 PostgREST 가 전체를 거절하니까 새 칸부터 차례로 뺌)
    (async () => {
      const base = "post_id, slot_key, slot_index, image_id, purpose, used_at, downloaded_at, post_images(kind, provider, review_status, mime, author_name, description, license, attribution_text";
      const read = (extra: string) => fetchAll("post_image_slots", [["post_id", true], ["id", true]], (q) => q.not("image_id", "is", null), `${base}${extra})`);
      // 오류에 적힌 칸으로 어느 DB인지 알아냄: source_type → 015 전(둘 다 뺌), composite_mode·product_check → 018 전, composite → 017 전
      let extra = ", source_type, composite, composite_mode, product_check";
      for (;;) {
        try { return await read(extra); } catch (e) {
          const m = String((e as Error)?.message ?? e);
          const next = /source_type/.test(m) ? "" : /composite_mode|product_check/.test(m) ? ", source_type, composite" : /composite/.test(m) ? ", source_type" : null;
          if (next === null || next === extra || next.length > extra.length) throw e;
          extra = next;
        }
      }
    })().then((data) => ({ data, error: null as unknown }), (error) => ({ data: [] as J[], error: error as unknown })),
  ]);
  if (imageSlots.error) console.error("state image_slots:", String((imageSlots.error as Error)?.message ?? imageSlots.error));
  return json({
    version: VERSION, now: nowIso(), today: kstToday(), auth: c.auth.kind,
    posts: posts.data, trash: trash.data, jobs: jobs.data, settings: settings.data, runs: runs.data,
    channels: channels.data, programs: programs.data, compat: compat.data, topics: topics.data, products,
    post_products: pp, links, imports: imports.data, image_slots: imageSlots.error ? [] : imageSlots.data,
    post_channels: postChannels, search_terms: searchTerms, metric_post_ids: metricPosts, unavailable, runs_auto_7d: runsAuto7d,
    requests: jobs.data, lastRun: runs.data?.[0] ?? null, // 예전 화면 호환
  });
}

async function getStats(c: Ctx) {
  const from = c.url.searchParams.get("from");
  const to = c.url.searchParams.get("to");
  const range = { d_from: from ? reqDate(from, "from") : null, d_to: to ? reqDate(to, "to") : null };
  // within=1: 기간 안에 다 들어가는 실적만 (홈 '최근 7일 정리' — 한 달치 실적이 두 주에 똑같이 잡히지 않게, 016)
  if (c.url.searchParams.get("within") === "1") {
    const { data, error } = await sb.rpc("stats_window", { ...range, within: true });
    if (error) { needs016(error, "stats_window"); throw error; }
    return json({ stats: data });
  }
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
  ["image_reviews", [["id", true]]],
  ["product_masks", [["id", true]]],
];
// 016(1.4.0)에서 생긴 표 — 아직 016 전인 DB면 빈 목록으로
const OPS_TABLES = ["post_channels", "search_terms"];
// 017(1.5.0)에서 생긴 표: AI 검수 의견·비용과 내 평가 — 017 전 DB면 빈 목록으로.
// 연결 확인 기록(image_provider_checks)은 운영 기록이라 api_calls 처럼 백업에 넣지 않음
const STUDIO150_TABLES = ["image_reviews", "product_masks"]; // product_masks 는 018(1.5.1) — 그 전 DB면 빈 목록으로
async function getExport(_c: Ctx) {
  const out: J = { exported_at: nowIso(), version: VERSION, note: "접속 코드·기기 로그인 정보는 들어 있지 않아. 이미지 파일 자체는 들어 있지 않고 정보(출처·프롬프트·비용·연결·AI 검수·내 평가·상품 마스크·합성 설정)만 들어 있어." };
  const counts: J = {};
  const missing: string[] = [];
  for (const [t, order] of EXPORT_TABLES) {
    let rows: J[];
    try { rows = await fetchAll(t, order); } catch (e) {
      // 이미지 표가 아직 없는 DB(012 적용 전)여도 나머지 백업은 받을 수 있게 — 그 밖의 오류는 그대로 실패
      const code = String((e as { code?: string })?.code ?? "");
      if (t.startsWith("post_image") || t === "image_generations" || t === "post_card_decks" || OPS_TABLES.includes(t) || STUDIO150_TABLES.includes(t)) {
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
      // 1.5.1: 상품 디테일 검수를 승인하지 않은 상품 장면 이미지가 이 글의 사진 자리에 있으면 막음 (images.js productGateErrors — 화면과 같은 판단)
      const pErr = await productGateFor(merged);
      if (pErr.length) fail(409, "check_failed", { errors: pErr });
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
    // 1.5.1: 상품 장면 승인 여부도 같이 (자리 연결은 본문을 고쳐도 남아 있어서 — 사라진 자리 포함)
    const errs = [...result.errors, ...(await productGateFor({ ...post, ...patch }))];
    if (errs.length) { patch.stage = "review"; demoted = errs; }
    else { patch.disclosure_text = disclosure; patch.disclosure_at = nowIso(); }
  }

  if (!Object.keys(patch).length) fail(400, "empty");
  const { data, error } = await sb.from("posts").update(patch).eq("id", id).select().single();
  // DB도 같은 규칙으로 막음 (그사이 다른 기기에서 승인 안 한 상품 이미지를 넣은 경우 등)
  if (error && /product_check_needed/.test(String(error.message ?? ""))) fail(409, "check_failed", { errors: await productGateFor(merged) });
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
  const { data: before } = await sb.from("posts").select("stage").eq("id", c.params[0]).maybeSingle();
  const { data, error } = await sb.from("posts").update({ deleted_at: null }).eq("id", c.params[0]).not("deleted_at", "is", null).select().maybeSingle();
  if (error) throw error;
  if (!data) fail(404, "not_found");
  // 1.5.1: 휴지통에 있는 사이 상품 이미지 승인을 풀었으면 DB가 '검수 필요'로 되살림 → 화면에 알려줌
  const demoted = !!before && ["ready", "scheduled"].includes(String((before as J).stage)) && (data as J).stage === "review";
  return json({ post: data, demoted });
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
  // 이미지: 모델 이름·기본 품질·하루 한도·한 달 예산·환율·가격
  // 1.5.0: 앱이 아는 모델만 저장 (모르는 이름을 받아 두었다가 OpenAI로 보내지 않게), 편집 모델은 고치기가 되는 모델만
  const modelName = (v: unknown, field: string) => {
    const m = str(v, 64).trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,60}$/.test(m)) fail(400, "bad_field", { field });
    if (m !== TEST_MODEL && !modelCaps(m).known) fail(400, "model_unknown", { field, model: m });
    // 공급자가 종료한 모델(gpt-image-1, 2026-10-23)은 새로 저장하지 않음 — 보내도 실패만 하니까
    if (m !== TEST_MODEL && !modelCaps(m).usable) fail(400, "model_retired", { field, model: m, retired: modelCaps(m).retired });
    return m;
  };
  if ("image_gen_model" in b) s.image_gen_model = modelName(b.image_gen_model, "image_gen_model");
  if ("image_edit_model" in b) {
    s.image_edit_model = modelName(b.image_edit_model, "image_edit_model");
    if (s.image_edit_model !== TEST_MODEL && !modelCaps(s.image_edit_model as string).edit) fail(400, "edit_unsupported", { field: "image_edit_model", model: s.image_edit_model });
  }
  if ("image_modes" in b) {
    const o = (b.image_modes && typeof b.image_modes === "object" && !Array.isArray(b.image_modes) ? b.image_modes : {}) as J;
    const out: J = {};
    for (const d of IMAGE_MODES as J[]) {
      const x = o[String(d.id)] as J | undefined;
      if (!x || typeof x !== "object") continue;
      const m = modelName(x.model, "image_modes");
      const q = (QUALITIES as readonly string[]).includes(String(x.quality)) ? normQuality(m, String(x.quality)) : normQuality(m, String(d.quality));
      out[String(d.id)] = { model: m, quality: q };
    }
    s.image_modes = out;
  }
  if ("image_review_model" in b) {
    const m = str(b.image_review_model, 64).trim();
    if (m && !reviewCaps(m)) fail(400, "review_model_unknown", { field: "image_review_model" });
    s.image_review_model = m;
  }
  if ("image_request_cap_usd" in b) s.image_request_cap_usd = optNum(b.image_request_cap_usd, "image_request_cap_usd", 0, 20) ?? 1;
  if ("image_ratio_prefs" in b) {
    const o = (b.image_ratio_prefs && typeof b.image_ratio_prefs === "object" ? b.image_ratio_prefs : {}) as J;
    const out: J = {};
    for (const [k, v] of Object.entries(o)) {
      if (!has(PURPOSES, k)) continue;
      if (!(((PURPOSES as J)[k] as J).ratios as string[]).includes(String(v))) fail(400, "bad_field", { field: "image_ratio_prefs" });
      out[k] = String(v);
    }
    s.image_ratio_prefs = out;
  }
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
    // 1.5.0: Gemini 모델 가격 (모델 표의 id 마다 — 장당·토큰 가격, 확인한 날·주소). 안 보내면 모델 표의 값을 씀
    for (const fid of GEMINI_PRICE_IDS) {
      const g = p[fid];
      if (!g || typeof g !== "object") continue;
      const gg = g as J;
      const pi = (gg.per_image && typeof gg.per_image === "object" ? gg.per_image : {}) as J;
      const per: J = {};
      for (const [k, v] of Object.entries(pi)) if (["1K", "2K", "4K", ""].includes(k)) per[k] = optNum(v, "image_prices", 0, 10);
      (s.image_prices as J)[fid] = {
        per_image: per, text_input_per_m: optNum(gg.text_input_per_m, "image_prices", 0, 1000), image_input_per_image: optNum(gg.image_input_per_image, "image_prices", 0, 10),
        image_output_per_m: optNum(gg.image_output_per_m, "image_prices", 0, 1000), text_output_per_m: optNum(gg.text_output_per_m, "image_prices", 0, 1000),
        checked_at: optDate(gg.checked_at, "image_prices") ?? null, source: optUrl(gg.source, "image_prices"),
      };
    }
  }
  if (!Object.keys(s).length) fail(400, "empty");
  let { data, error } = await sb.from("settings").update(s).eq("id", 1).select().single();
  // DB에 015(주력 주제 낱말 열)가 아직 없으면 그 칸만 빼고 저장 — 서버를 DB보다 먼저 올려도 다른 설정 저장이 막히지 않게
  const skipped: string[] = [];
  // DB에 그 열이 아직 없으면(015 전: 주력 주제 낱말, 016 전: 쌓아둘 원고 한도) 그 칸만 빼고 저장
  for (const col of ["focus_terms", "backlog_limit", "image_modes", "image_review_model", "image_request_cap_usd", "image_ratio_prefs"]) {
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
// 1.5.0: Google Gemini API 키 (Supabase Secrets 의 GEMINI_API_KEY). 화면에는 있음/없음만
const keyGemini = () => (Deno.env.get("GEMINI_API_KEY") ?? "").trim();
const keysInfo = () => ({ openai: !!keyOpenAI(), gemini: !!keyGemini(), pexels: !!(Deno.env.get("PEXELS_API_KEY") ?? ""), cloudflare: !!(keyCf().accountId && keyCf().token) });
const providerKeys = () => ({ openai: keyOpenAI(), gemini: keyGemini(), cf: keyCf() });
const providerKeyOk = (p: string) => (p === "openai" ? !!keyOpenAI() : p === "gemini" ? !!keyGemini() : p === "cloudflare" ? keysInfo().cloudflare : false);
const keyMissingCode = (p: string) => (p === "gemini" ? "gemini_key_missing" : p === "cloudflare" ? "cf_key_missing" : "openai_key_missing");
// 장면 설계서에서 사용자가 고친 칸만 받음 (길이 자름). 고칠 수 없는 칸(목적·플랫폼 등)은 서버가 원고로 다시 만듦
function cleanSceneOverrides(v: unknown): J {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as J;
  const out: J = {};
  for (const k of SCENE_EDITABLE as string[]) {
    if (!(k in o)) continue;
    if (k === "locale") { if (["", "KR", "none"].includes(String(o.locale))) out.locale = String(o.locale); continue; }
    if (k === "must_show" || k === "avoid") { if (Array.isArray(o[k])) out[k] = (o[k] as unknown[]).map((x) => str(x, 120).trim()).filter(Boolean).slice(0, 8); continue; }
    const t = str(o[k], 300).trim();
    if (t) out[k] = t;
  }
  return out;
}
// 사용자가 고친 장면 칸 중 '그려 달라는' 칸 (넣지 말 것 목록·지역 선택은 빼고) — 금지 표현 검사에 씀.
// 실제 상품 자리 판단에는 주 피사체·꼭 보일 것만 씀 (장소·구도·빛 칸의 '화면 왼쪽'·'카페 내부'는 상품이 아님) — images.js 와 화면이 같은 범위 (1.5.0 검토)
const sceneUserText = (v: unknown) => sceneDrawText(cleanSceneOverrides(v));
const sceneSubjectText = (v: unknown) => sceneGateText(cleanSceneOverrides(v));
const needs017 = (e: unknown, name: string) => { if (missingTable(e, name)) fail(409, "db_update_needed", { migration: "017" }); };
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
    sb.rpc("image_gen_fail", { gen: id, fin: { error_code: "server_stopped", error_message: "서버가 중간에 멈췄어. 청구됐을 수 있으니 그 공급자의 사용량 화면에서 확인해줘.", cost_status: "확인 필요" } })
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
const IMG_SETTING_COLS = "image_gen_model, image_edit_model, image_quality, image_daily_limit, image_monthly_budget_usd, image_fx_krw, image_fx_date, image_fx_source, image_prices";
async function imageSettings() {
  // 1.5.0 칸(모드·검수 모델·한 번 상한·용도별 비율) — 017 전 DB면 빼고 읽음 (그때는 기본값)
  let { data, error } = await sb.from("settings").select(IMG_SETTING_COLS + ", image_modes, image_review_model, image_request_cap_usd, image_ratio_prefs").eq("id", 1).single();
  if (error && /image_modes|image_review_model|image_request_cap_usd|image_ratio_prefs/.test(String(error.message ?? ""))) {
    ({ data, error } = await sb.from("settings").select(IMG_SETTING_COLS).eq("id", 1).single());
  }
  if (error) throw error;
  return data as unknown as J;
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

// 공급자마다: 키가 있는지(서버 Secrets) · 마지막 연결 확인 결과 · 마지막으로 실제로 만든 때 — 셋을 따로 보여줌
// (설정에 모델 이름을 넣은 것만으로 '연결됨'이라고 하지 않음)
async function providerStatus() {
  const out: Record<string, J> = {};
  const k = keysInfo() as J;
  for (const p of ["cloudflare", "openai", "gemini"]) out[p] = { key: !!k[p], check: null, last_success: null, last_failure: null };
  const [checks, ok, bad] = await Promise.all([
    sb.from("image_provider_checks").select("provider, model, ok, code, message, checked_at").order("checked_at", { ascending: false }).limit(30),
    sb.from("image_generations").select("provider, model, finished_at").eq("status", "성공").eq("provider_called", true).order("finished_at", { ascending: false }).limit(60),
    sb.from("image_generations").select("provider, model, finished_at, error_code").eq("status", "실패").eq("provider_called", true).order("finished_at", { ascending: false }).limit(60),
  ]);
  for (const r of ((checks.error ? [] : checks.data) ?? []) as J[]) if (out[String(r.provider)] && !out[String(r.provider)].check) out[String(r.provider)].check = r;
  for (const r of (ok.data ?? []) as J[]) if (out[String(r.provider)] && !out[String(r.provider)].last_success) out[String(r.provider)].last_success = { model: r.model, at: r.finished_at };
  for (const r of (bad.data ?? []) as J[]) if (out[String(r.provider)] && !out[String(r.provider)].last_failure) out[String(r.provider)].last_failure = { model: r.model, at: r.finished_at, code: r.error_code };
  return out;
}
async function getImageConfig(_c: Ctx) {
  const [settings, usage, status] = await Promise.all([imageSettings(), imageUsage(), providerStatus()]);
  return json({ keys: keysInfo(), providers: providersInfo(), provider_status: status, settings, usage, test_model: TEST_MODEL, sign_seconds: SIGN_SECONDS, storage_limit: STORAGE_SOFT_LIMIT });
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
// 1.5.0: 모델을 요청에 직접 고를 수 있음(모드·비교) — 앱이 아는 모델만, 키가 있는 공급자만 (모르는 이름을 OpenAI로 보내지 않음)
//        이미지 종류(프리셋)·장면 설계서·참고 사진(역할)·묶음(후보 여러 장·모델 비교)
// 1.5.1: 상품 장면(b.product) — 두 방식을 섞지 않음 (images.js PRODUCT_MODES)
//        layer(원본 보존 합성): AI는 '빈 배경'만 만듦. 상품 사진은 AI에 보내지 않고, 합성은 화면이 원본 픽셀 그대로 얹어서 따로 저장(POST /images/composite)
//        reference(AI 실사 장면): 상품 사진을 '대상 모양 유지' 참고 사진으로 보내 AI가 장면 전체를 그림 → 'AI 합성 이미지', 상품 디테일 검수 필수
//        원고·사진 자리는 없어도 됨 (보관함에서 시작). 있으면 '직접 찍기' 자리 검사와 맥락(브랜드 지우기)에만 씀
const MAX_REF_BYTES = 8 * 1024 * 1024;
async function generateImage(c: Ctx) {
  const b = await readJson(c.req, 40_000);
  const requestKey = str(b.request_key, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestKey)) fail(400, "bad_field", { field: "request_key" });
  // 응답을 못 받아 같은 요청 번호로 다시 온 것은 검사·대기 없이 그 기록을 바로 돌려줌 (두 번 만들지 않음 — 만드는 중이면 화면이 바로 진행 상황을 봄)
  const prior = await sb.from("image_generations").select(GEN_COLS).eq("request_key", requestKey).maybeSingle();
  if (prior.error) throw prior.error;
  if (prior.data) return json({ generation: prior.data, duplicate: true });
  const product = b.product && typeof b.product === "object" && !Array.isArray(b.product) ? cleanProductSpec(b.product) as J : null;
  const { post, slot, purpose: slotPurposeOf } = await slotTarget(b, !product);
  const mode = b.mode === "edit" ? "edit" : "generate";
  const purpose = product ? String(product.purpose) : slotPurposeOf;
  const ratio = ratioOf(purpose, str(b.ratio, 8));
  const preset = product ? String(PRODUCT_PRESETS[String(product.mode) as "layer" | "reference"]) : presetOf(str(b.preset, 30) || str(b.style, 30));
  const editText = str(b.edit, 300).trim();
  const text = product ? (slot ? String(slot.text ?? "") : "") || productDescription(product) : str(b.text, 300).trim() || String(slot!.text ?? "").trim();
  const extra = product ? "" : str(b.extra, 400).trim();
  if (!text) fail(400, "bad_field", { field: "text" });
  if (product && mode === "edit" && !editText) fail(400, "bad_field", { field: "edit" });
  const s = await imageSettings();
  // 모델: 요청에 있으면 그것(화면에서 사용자가 고른 모드·비교 모델), 없으면 설정의 생성·편집 모델. 설정을 몰래 유료로 바꾸지 않음
  const asked = str(b.model, 64).trim();
  if (asked && !/^[a-z0-9][a-z0-9._-]{1,60}$/.test(asked)) fail(400, "bad_field", { field: "model" });
  const model = asked || String(mode === "edit" ? s.image_edit_model : s.image_gen_model);
  const isTest = model === TEST_MODEL;
  const capsModel = isTest ? "gpt-image-2.5-flare" : model; // 점검용 가짜 모델은 크기·품질 규칙을 2.5처럼
  const caps = modelCaps(capsModel);
  if (!caps.known) fail(400, "model_unknown", { model });
  if (!caps.usable) fail(400, "model_retired", { model, retired: caps.retired });
  const provider = caps.provider as string;
  const isFree = !!caps.free;
  if (mode === "edit" && !caps.edit) fail(400, "edit_unsupported", { model });
  if (!isTest && !providerKeyOk(provider)) fail(503, keyMissingCode(provider));
  // 모델이 못 받는 품질은 가까운 것으로 (모델마다 되는 품질이 다름 — images.js 모델 표)
  const quality = normQuality(capsModel, (QUALITIES as readonly string[]).includes(String(b.quality)) ? String(b.quality) : String(s.image_quality));
  // 상표·가격·인증·후기 사진·글자 요청은 서버에서도 막음 (화면에서 먼저 알려줌)
  const products = post ? await linkedProducts(String(post.id)) : { brands: [] as string[], hide: [] as string[] };
  const risks = blocksOf(promptRisk(product ? [String(product.custom ?? ""), editText].join("\n") : text + "\n" + extra, products.brands));
  if (risks.length) fail(400, "prompt_blocked", { risks });
  // 고친 장면 칸에도 같은 금지 검사 — 그려 달라는 칸만 (넣지 말 것 목록·지역은 빼고). 자리 검사보다 먼저 (1.5.0 검토)
  if (!product) {
    const sceneRisks = blocksOf(promptRisk(sceneUserText(b.scene), products.brands));
    if (sceneRisks.length) fail(400, "prompt_blocked", { risks: sceneRisks });
  }
  // 상품 장면: 원본 상품 사진(직접 올림 — 쓸 권한 확인한 것 · Pexels). AI 실사 장면은 이 사진을 첫 '대상 모양 유지' 참고 사진으로 보냄
  let productRow: J | null = null;
  if (product) {
    if (!isUuid(b.product_image_id)) fail(400, "bad_field", { field: "product_image_id" });
    const { data, error } = await sb.from("post_images").select("id, kind, rights_confirmed, deleted_at").eq("id", b.product_image_id).is("deleted_at", null).maybeSingle();
    if (error) throw error;
    if (!data) fail(404, "product_not_found");
    productRow = data as J;
    if (!["upload", "stock"].includes(String(productRow.kind))) fail(400, "product_image_required");
    if (productRow.kind === "upload" && productRow.rights_confirmed !== true) fail(400, "rights_required");
  }
  // 참고 사진: 이 모델이 받는 만큼만, 보관함에 있고 지우지 않은 것만 (직접 올린 사진은 쓸 권한 확인한 것만)
  const refsIn = Array.isArray(b.refs) ? (b.refs as J[]) : [];
  const maxRefs = refsLimit(capsModel, mode); // 고치기면 고칠 이미지가 한 장을 씀
  if (refsIn.length > 16) fail(400, "too_many_refs", { max: maxRefs }); // 어느 모델도 16장을 넘게 받지 않음 (OpenAI edits 최대)
  const refs: { image_id: string; role: string }[] = [];
  if (product && product.mode === "reference") refs.push({ image_id: String(productRow!.id), role: "subject" });
  for (const r of refsIn) {
    if (!isUuid(r?.image_id) || !has(REF_ROLES, r?.role)) fail(400, "bad_field", { field: "refs" });
    if (product && r.role !== "subject") fail(400, "bad_field", { field: "refs" }); // 상품 장면의 추가 사진은 같은 상품의 다른 면(앞·뒤·옆)만
    if (refs.some((x) => x.image_id === r.image_id)) continue;
    refs.push({ image_id: String(r.image_id), role: String(r.role) });
  }
  // 원본 보존 합성은 상품 사진을 AI에 보내지 않음 (images.js productGate — 참고 사진을 붙이면 상품을 다시 그리게 되니까)
  if (product && product.mode === "layer" && refs.length) fail(400, "layer_no_refs");
  if (refs.length > maxRefs) fail(400, refs.length && !caps.refsMax ? "refs_unsupported" : "too_many_refs", { max: maxRefs, model });
  let refRows: J[] = [];
  if (refs.length) {
    const { data, error } = await sb.from("post_images").select("id, kind, provider, storage_path, mime, bytes, rights_confirmed, source_type, description, ref_small_path").in("id", refs.map((r) => r.image_id)).is("deleted_at", null);
    if (error) throw error;
    refRows = refs.map((r) => ((data ?? []) as J[]).find((x) => x.id === r.image_id)).filter(Boolean) as J[];
    if (refRows.length !== refs.length) fail(404, "ref_not_found");
    for (const x of refRows) {
      if (x.kind === "upload" && x.rights_confirmed !== true) fail(400, "rights_required");
      if (Number(x.bytes ?? 0) > MAX_REF_BYTES) fail(400, "ref_too_big");
      // 1.5.1: 합성 이미지는 참고 사진으로 안 받음 (원본 상품 사진을 넣어야 '원본과 같은지'를 볼 수 있음)
      if (x.kind === "composite") fail(400, "ref_composite");
      if (product && !["upload", "stock"].includes(String(x.kind))) fail(400, "product_image_required");
    }
  }
  let base: J | null = null;
  if (mode === "edit") {
    if (!isUuid(b.base_image_id)) fail(400, "bad_field", { field: "base_image_id" });
    const { data } = await sb.from("post_images").select("*").eq("id", b.base_image_id).is("deleted_at", null).maybeSingle();
    if (!data) fail(404, "not_found");
    // 직접 찍은 사진·실제 사진을 AI로 고치면 실제와 다른 '진짜 같은 사진'이 될 수 있어서, AI가 만든 이미지만 고침
    // (실제 사진은 '참고 사진'으로 넣어 새로 만들면 'AI 합성'으로 표시됨. 원본 보존 합성 결과는 배경을 고친 뒤 다시 합성)
    if ((data as J).kind !== "ai") fail(400, "edit_ai_only");
    base = data as J;
    // 상품 장면의 부분 수정은 같은 방식의 이미지만: 원본 보존 합성은 그 배경, AI 실사 장면은 그 결과 (두 방식을 섞지 않음)
    if (product && product.mode === "layer" && base.preset !== PRODUCT_PRESETS.layer) fail(400, "edit_mode_mismatch");
    if (product && product.mode === "reference" && base.composite_mode !== "reference") fail(400, "edit_mode_mismatch");
  }
  // AI로 만들어도 되는 자리인지 (images.js aiGate·productGate — 화면과 같은 판단): '직접 찍기' 자리는 막음,
  // 실제 상품·화면이 보여야 하는 자리는 진짜 제품 사진(직접 올림·Pexels)을 '대상 모양 유지'로 넣었거나, 고치는 이미지가 이미 AI 합성이거나,
  // '일반 장면' 확인이 있어야 함. 고친 장면 칸 중 주 피사체·꼭 보일 것도 같이 봄 (1.5.0 검토)
  const gateRefs = refs.map((r) => ({ role: r.role, kind: String(refRows.find((x) => x.id === r.image_id)?.kind ?? "") }));
  const slotText = slot && !isExtraKey(String(slot.key)) ? String(slot.text ?? "") : "";
  const gate = product ? productGate(String(product.mode), { slotText, refs: gateRefs }) as J : aiGate(slotText, {
    text: [text, extra, sceneSubjectText(b.scene)].join(" "), refs: gateRefs, genericOk: b.generic_ok === true, baseComposite: base?.composite === true,
  }) as J;
  // 상품 장면의 부분 수정은 참고 사진이 없어도 됨 (고칠 이미지가 이미 그 상품의 장면)
  if (!gate.ok && !(product && mode === "edit" && gate.code === "product_photo_needed")) fail(400, String(gate.code), gate.word ? { word: gate.word } : {});
  // 무료 모델(FLUX.2 klein)은 512px보다 작은 사본만 받음 — 사본이 없는 이미지가 있으면 화면이 만들어 올린 뒤 다시 보냄 (돈 안 나감)
  if (provider === "cloudflare" && !isTest) {
    const need = [...(base ? [base] : []), ...refRows].filter((x) => !String(x.ref_small_path ?? "")).map((x) => String(x.id));
    if (need.length) fail(409, "ref_small_missing", { ids: need });
  }
  // 묶음(후보 2~3장·모델 비교): 화면이 한 장씩 차례로 보냄. 남은 장의 수·예상 비용으로 한도·예산을 미리 확인
  let batch: J | null = null;
  if (b.batch && typeof b.batch === "object") {
    const x = b.batch as J;
    const total = Number(x.total), index = Number(x.index);
    if (!isUuid(x.id) || !["candidates", "compare"].includes(String(x.kind)) || !Number.isInteger(total) || total < 1 || total > 3 || !Number.isInteger(index) || index < 0 || index >= total) fail(400, "bad_field", { field: "batch" });
    if (mode === "edit") fail(400, "bad_field", { field: "batch" });
    batch = { id: x.id, kind: x.kind, index, total };
  }
  const size = sizeFor(purpose, ratio, capsModel, quality);
  if (provider === "openai" && caps.flexible && !validApiSize(size)) fail(400, "bad_field", { field: "ratio" }); // 크기 규칙은 OpenAI 것
  // 장면 설계서: 원고 맥락 + 이미지 종류 + 사용자가 고친 칸. 맥락에서 연결 상품 이름·브랜드·모델명·가격·인증 표현을 지우고 보냄
  // 상품 장면은 상품 전용 설계서 (상품을 '새로 그리라'와 '정확히 두라'를 섞지 않게 — images.js buildProductScene)
  const scene = product
    ? buildProductScene({ spec: product, ratio, size: sizeLabel(size), refs: refs.map((r) => ({ ...r, label: "" })), post, slot, hide: products.hide,
        channel: String(post?.channel_id ?? ""), edit: mode === "edit" ? editText : "" })
    : buildScene({
        post, slot, text, preset, purpose, ratio, extra, mode, hide: products.hide, refs, size: sizeLabel(size), channel: String(post!.channel_id ?? ""),
        overrides: cleanSceneOverrides(b.scene),
      });
  const prompt = product ? promptFromProductScene(scene) : promptFromScene(scene);
  const est = isTest ? 0 : estimateUsd({ quality, size, promptTokens: estimateTokens(prompt), mode, prices: s.image_prices, model, refs: refs.length });
  if (est == null) fail(400, "bad_field", { field: "quality" });
  // 화면에서 보여준 예상 비용보다 눈에 띄게 비싸지면(설정·가격·제목이 바뀐 경우) 다시 확인받음 — 토큰 몇 개 차이는 넘어감
  const seen = Number(b.confirm_usd);
  const tol = Math.max(0.0005, Number(est) * 0.02);
  if (!isTest && !(Number.isFinite(seen) && seen + tol >= Number(est))) {
    fail(409, "estimate_changed", { est_usd: est, model, quality, size, prices: s.image_prices });
  }
  const reserveN = batch ? Number(batch.total) - Number(batch.index) : 1;
  const reserveAsked = Number(b.reserve_usd);
  // 후보(같은 모델)는 이번 장 × 남은 장 수, 모델 비교는 장마다 모델이 달라서 화면이 보낸 남은 장 합계 — 어느 쪽이든 이번 장 예상보다 적게 잡지 않음.
  // 예약은 미리 확인용이고, 장마다 생성 시작에서 그 장의 예상 비용으로 예산·상한을 다시 확인함 (1.5.0 검토)
  const askedReserve = Number.isFinite(reserveAsked) ? reserveAsked : 0;
  const reserveUsd = !batch ? Number(est) : batch.kind === "compare" ? Math.max(Number(est), askedReserve) : Math.max(Number(est) * reserveN, askedReserve);
  await storageGuard((provider === "gemini" ? 20 : 2) * 1024 * 1024);
  // 이 일꾼이 꺼질 때까지 남은 시간이 그 품질을 기다리기에 모자라면, 돈이 나가기 전에 '잠깐 뒤에 다시' (그때는 새 일꾼이 받음)
  // 화면은 retry_after 초만큼 기다렸다가 같은 요청 번호로 다시 보냄 (image_service.js busyRetryAfter)
  if (DEADLINE - Date.now() < (isFree ? 45000 : needMsFor(quality, mode, WALL_MS, provider)) + (refs.length ? 8000 : 0)) {
    fail(503, "server_busy", { retry_after: busyRetryAfter(Date.now() - BOOT_AT, WALL_MS) });
  }
  const composite = product ? product.mode === "reference" : (mode === "edit" && base?.composite === true)
    || refRows.some((x) => x.kind !== "ai" && x.kind !== "card" && refs.find((r) => r.image_id === x.id && (r.role === "subject" || r.role === "background")));
  // 1.5.1: 진짜 상품 사진(직접 올림·Pexels)을 '대상 모양 유지'로 넣어 AI가 그 상품을 다시 그린 이미지는 자리와 상관없이
  // 'AI 실사 장면'(composite_mode reference)으로 기록 → 상품 디테일 검수를 승인해야 '사용 가능'·발행 준비 완료 (1.5.1 검토: 일반 자리도)
  // 원본 상품 사진 id 를 같이 남김. AI 실사 장면을 고친 것도 같은 방식, 원본 보존 합성용 빈 배경을 고친 것은 그대로 빈 배경(상품 사진은 가리키기만)
  const realSubject = refRows.find((x) => ["upload", "stock"].includes(String(x.kind)) && refs.some((r) => r.image_id === x.id && r.role === "subject"));
  const productImageId = product ? String(productRow!.id) : String(realSubject?.id ?? (mode === "edit" ? base?.product_image_id ?? "" : ""));
  const compositeMode = product ? (product.mode === "reference" ? "reference" : "")
    : realSubject || base?.composite_mode === "reference" ? "reference" : "";
  // AI 실사 장면을 고칠 때 원본 상품 사진이 지워졌으면 돈이 나가기 전에 멈춤 (만든 뒤 저장을 못 해 결과만 버려지지 않게 — 1.5.1 검토)
  if (compositeMode === "reference" && !realSubject && !product) {
    if (!isUuid(productImageId)) fail(400, "product_image_required");
    const { data: pr, error: pe } = await sb.from("post_images").select("id, kind, rights_confirmed").eq("id", productImageId).is("deleted_at", null).maybeSingle();
    if (pe) throw pe;
    if (!pr || !["upload", "stock"].includes(String((pr as J).kind))) fail(400, "product_image_required");
    if ((pr as J).kind === "upload" && (pr as J).rights_confirmed !== true) fail(400, "rights_required");
  }
  const begin = await sb.rpc("image_gen_begin", {
    p: {
      request_key: requestKey, post_id: post ? post.id : "", slot_key: slot ? slot.key : "", slot_index: slot ? slot.index : "", slot_text: slot ? slot.text : "", mode, model, size, quality,
      provider: isTest ? "openai" : provider,
      output_format: "jpeg", purpose, style: preset, preset, user_prompt: product ? [String(product.custom ?? ""), editText].filter(Boolean).join("\n") : [text, extra].filter(Boolean).join("\n"),
      prompt, base_image_id: base ? base.id : "", est_usd: est,
      risk_override: gate.generic ? "일반 장면으로 만들기 확인: " + gate.word : gate.composite ? "진짜 제품 사진 참고: " + gate.word : "",
      refs, scene, batch_id: batch?.id ?? "", batch_kind: batch?.kind ?? "", batch_index: batch?.index ?? "", batch_total: batch?.total ?? "",
      reserve_n: reserveN, reserve_usd: reserveUsd,
    },
  });
  if (begin.error) {
    // 017 전 DB: 새 칸(참고 사진·장면 설계서·묶음)이나 공급자 gemini 를 모름 → 'DB 업데이트 필요'
    if (/bad provider|reserve|column .* does not exist/.test(String(begin.error.message ?? "")) && (provider === "gemini" || refs.length || batch)) fail(409, "db_update_needed", { migration: "017" });
    rpcError(begin.error);
  }
  const gen = begin.data as J;
  const { prompt: _p, revised_prompt: _r, ...pub } = gen;
  if (gen.duplicate) return json({ generation: pub, duplicate: true });
  // 017 전 DB의 생성 시작 함수는 공급자를 openai·cloudflare 로만 적고 새 칸(refs 등)을 모름 → 공급자를 부르기 전에 멈춤 (청구 없음)
  if (!("refs" in gen) || String(gen.provider) !== (isTest ? "openai" : provider)) {
    await sb.rpc("image_gen_fail", { gen: gen.id, fin: { provider_called: false, error_code: "db_update_needed", error_message: "DB 업데이트(017)가 필요해서 만들지 않았어 (청구 없음).", cost_status: "청구 없음" } });
    fail(409, "db_update_needed", { migration: "017" });
  }
  RUNNING.add(String(gen.id));
  const task = runGeneration(imageDeps(), gen, {
    keys: providerKeys(), prices: s.image_prices, safetyId: await safetyIdOf(c.auth), deadline: DEADLINE, timeoutMs: isFree ? 90_000 : 115_000, ratio,
    base: base ? { path: String(base.storage_path), mime: String(base.mime), id: String(base.id), small: String(base.ref_small_path ?? "") } : null,
    refs: refs.map((r) => { const x = refRows.find((y) => y.id === r.image_id)!; return { path: String(x.storage_path), mime: String(x.mime), role: r.role, id: r.image_id, kind: String(x.kind), small: String(x.ref_small_path ?? "") }; }),
    composite, scene, preset, type: product ? "photo" : (scene as J).type,
    // 1.5.1: 상품 장면 기록 — AI 실사 장면은 composite_mode reference, 원본 보존 합성의 배경은 상품 사진 id 만 (사진 자리 후보로는 안 보임 — 합성 결과가 후보)
    compositeMode, productImageId, noSlot: !!product && product.mode === "layer",
    // 고치기는 바뀐 내용(지시)이 아니라 원래 이미지 설명을 그대로 씀 (지시는 생성 기록의 user_prompt 에)
    description: mode === "edit" ? String(base?.description || slot?.text || text) : product && product.mode === "layer" ? "배경: " + text : text,
  }).catch(async (e) => {
    console.error("image generation:", String((e as Error)?.message ?? e).slice(0, 200));
    await sb.rpc("image_gen_fail", { gen: gen.id, fin: { error_code: "server_error", error_message: "서버에서 문제가 생겼어. 청구됐을 수 있으니 공급자 사용량을 확인해줘.", cost_status: "확인 필요" } });
  }).finally(() => RUNNING.delete(String(gen.id)));
  inBackground(task);
  return json({ generation: pub, est_usd: est, model, size, quality, provider }, 202);
}
// 상품 장면의 이미지 설명 (보관함·대체 텍스트): 상품 이름(사용자가 적은 것)과 장면 — AI에는 보내지 않음
function productDescription(spec: J): string {
  const t = (PRODUCT_TEMPLATES as Record<string, J>)[String(spec.template)];
  return [String(spec.name ?? "").trim() || "상품", t ? String(t.label) : ""].filter(Boolean).join(" · ").slice(0, 120);
}
// 4분 넘게 끝나지 않은 생성은 실패로 정리 (그 생성 하나 또는 그 글 전체).
// 유료 공급자(OpenAI·Gemini)는 청구됐을 수 있음 → 확인 필요, 무료 플랜 Cloudflare 는 청구 없음 (1.5.0: 공급자별로 나눔)
async function sweepStale(postId: string | null, genId?: string) {
  const old = new Date(Date.now() - 240e3).toISOString();
  const run = async (free: boolean) => {
    // deno-lint-ignore no-explicit-any
    let q: any = sb.from("image_generations").update({
      status: "실패", error_code: "timeout",
      error_message: free ? "응답이 끝나지 않아 멈췄어 (무료 모델이라 청구 없음)." : "응답이 끝나지 않아 멈췄어. 청구됐을 수 있으니 그 공급자(OpenAI·Gemini)의 사용량 화면에서 확인해줘.",
      cost_status: free ? "청구 없음" : "확인 필요", auto_cost_status: free ? "청구 없음" : "확인 필요", finished_at: nowIso(),
    }).eq("status", "생성 중").lt("started_at", old);
    q = free ? q.eq("provider", "cloudflare") : q.neq("provider", "cloudflare");
    q = genId ? q.eq("id", genId) : q.eq("post_id", postId);
    const { error } = await q;
    if (error) console.error("sweep:", error.message);
  };
  await run(true);
  await run(false);
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
// 실제 청구액 넣기 (공급자 사용량 화면 — OpenAI·Google AI Studio — 에서 확인한 값). 앱이 청구액을 직접 가져오지는 못함
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
// 무료 모델(FLUX.2 klein)에 보낼 작은 사본 올리기 — 화면이 원본을 512px보다 작게 줄여서 올림 (원본은 그대로, 보관함에 새 이미지로 늘리지 않음)
async function uploadSmallCopy(c: Ctx) {
  const ct = (c.req.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.startsWith("multipart/form-data")) fail(415, "bad_type");
  let form: FormData;
  try { form = await c.req.formData(); } catch { return fail(400, "bad_body"); }
  const f = form.get("file");
  if (!(f instanceof Blob)) fail(400, "bad_field", { field: "file" });
  const file = f as Blob;
  if (file.size > 1024 * 1024) fail(413, "too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sn = sniffImage(bytes) as J | null;
  if (!sn || sn.animated || !["image/jpeg", "image/png", "image/webp"].includes(String(sn.mime))) fail(400, "bad_image", { reason: "bad_type" });
  if (!(Number(sn!.width) > 0 && Number(sn!.width) < 512 && Number(sn!.height) > 0 && Number(sn!.height) < 512)) fail(400, "bad_field", { field: "file" });
  const { data: img, error } = await sb.from("post_images").select("id, ref_small_path").eq("id", c.params[0]).is("deleted_at", null).maybeSingle();
  if (error) { if (missingColumn(error, "ref_small_path")) fail(409, "db_update_needed", { migration: "017" }); throw error; }
  if (!img) fail(404, "not_found");
  const now = new Date();
  const path = `small/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${sn!.ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: String(sn!.mime), upsert: false, cacheControl: "3600" });
  if (up.error) fail(502, "storage_failed");
  const { data, error: e2 } = await sb.from("post_images").update({ ref_small_path: path }).eq("id", c.params[0]).select("id, ref_small_path").maybeSingle();
  if (e2 || !data) { await sb.storage.from(BUCKET).remove([path]); if (e2) throw e2; fail(404, "not_found"); }
  const old = String((img as J).ref_small_path ?? "");
  if (old && old !== path) await sb.storage.from(BUCKET).remove([old]);
  return json({ image: data });
}

// ───────── 1.5.0: AI 검수·사용자 평가·수정 이력·모델 비교 기록·연결 확인 ─────────
// AI 검수 (참고용): 멀티모달 모델에 이미지를 보여주고 항목별 의견을 받음. 비용은 이미지 예산에 같이 셈. 원본은 그대로 두고 앱이 대신 고르지 않음
async function reviewImage(c: Ctx) {
  const b = await readJson(c.req, 5_000);
  const id = c.params[0];
  const { data: row, error } = await sb.from("post_images").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!row) fail(404, "not_found");
  const img = row as J;
  // 1.5.1: 원본 보존 합성 결과도 검수함 (상품 장면은 상품 디테일 아홉 항목으로 — 원본 상품 사진과 비교)
  const pmode = productSceneMode(img);
  if (img.kind !== "ai" && pmode !== "layer") fail(400, "review_ai_only");
  const s = await imageSettings();
  const model = str(b.model, 64).trim() || String(s.image_review_model ?? "");
  const m = reviewCaps(model) as J | null;
  if (!m) fail(400, model ? "review_model_unknown" : "review_model_off");
  if (!providerKeyOk(String(m!.provider))) fail(503, keyMissingCode(String(m!.provider)));
  // 고친 'AI 합성' 이미지는 자기 기록에 참고 사진이 없음 → 고치기 전 원본 쪽에서 찾아 같이 보냄 (원본과 같은지 보게 — 1.5.0 검토)
  let refs = (Array.isArray(img.ref_images) ? img.ref_images : []) as J[];
  if (!refs.length && img.composite === true) refs = await lineageRefs(img);
  // 상품 장면: 원본 상품 사진을 맨 앞에 (같은 상품의 다른 면 사진이 있으면 그 뒤로)
  if (pmode && isUuid(img.product_image_id)) refs = [{ image_id: img.product_image_id, role: "subject" }, ...refs.filter((r) => r.image_id !== img.product_image_id && r.role === "subject")];
  const est = Number(estimateReviewUsd(model, 1 + Math.min(3, refs.length)));
  const seen = Number(b.confirm_usd);
  if (!(Number.isFinite(seen) && seen + Math.max(0.0005, est * 0.02) >= est)) fail(409, "estimate_changed", { est_usd: est, model });
  // 원고의 사진 자리 설명 (있으면) — 없으면 이미지 설명
  let slotText = String(img.description ?? "");
  if (isUuid(b.post_id) && typeof b.slot_key === "string") {
    const { data: post } = await sb.from("posts").select("body").eq("id", b.post_id).maybeSingle();
    const sl = parseSlots(String((post as J | null)?.body ?? "")).find((x: J) => x.key === b.slot_key);
    if (sl) slotText = String(sl.text);
  }
  if (DEADLINE - Date.now() < 40_000) fail(503, "server_busy", { retry_after: busyRetryAfter(Date.now() - BOOT_AT, WALL_MS) });
  const begin = await sb.rpc("image_review_begin", { p: { image_id: id, provider: m!.provider, model, est_usd: est, post_id: isUuid(b.post_id) ? b.post_id : "" } });
  if (begin.error) { needs017(begin.error, "image_review_begin"); rpcError(begin.error); }
  const review = begin.data as J;
  const deps = imageDeps();
  const finish = async (fin: J) => {
    const done = await sb.rpc("image_review_finish", { p_review: review.id, fin });
    if (done.error) throw done.error;
    return json({ review: done.data });
  };
  const images: { bytes: Uint8Array; mime: string }[] = [];
  const dl = await deps.download(String(img.storage_path));
  if (!dl.ok) return finish({ ok: false, error_code: "bad_image", error_message: "검수할 이미지를 불러오지 못했어 (청구 없음).", cost_status: "청구 없음" });
  images.push({ bytes: dl.bytes as Uint8Array, mime: String(img.mime) });
  const refIds = refs.map((r) => String(r.image_id)).filter(isUuid).slice(0, 3);
  if (refIds.length) {
    const { data: rr } = await sb.from("post_images").select("id, storage_path, mime").in("id", refIds).is("deleted_at", null);
    for (const x of (rr ?? []) as J[]) { const d2 = await deps.download(String(x.storage_path)); if (d2.ok) images.push({ bytes: d2.bytes as Uint8Array, mime: String(x.mime) }); }
  }
  const scene = (img.scene && typeof img.scene === "object" ? img.scene : {}) as J;
  const purpose = String(img.purpose || (scene.platform as J | undefined)?.purpose || "blog_body");
  const prompt = reviewPrompt({ slotText, goal: String(scene.goal ?? ""), type: String(scene.type ?? "photo"), ratio: String(img.ratio || (scene.platform as J | undefined)?.ratio || ""),
    crops: purpose === "blog_cover" ? ["1:1 (목록 썸네일)"] : [], refs: images.length - 1, composite: img.composite === true, product: pmode });
  const r = await visionReview({ fetchImpl: fetch, keys: providerKeys(), model, prompt, images, timeoutMs: Math.max(10_000, Math.min(60_000, DEADLINE - Date.now() - 8_000)) }) as J;
  if (!r.ok) return finish({ ok: false, error_code: r.code, error_message: scrub(r.message, 500), cost_status: m!.free || r.billed === "no" ? "청구 없음" : "확인 필요" });
  const usd = reviewUsageUsd(model, r.usage);
  const cost = m!.free ? "청구 없음" : usd != null ? "사용량 기준" : "예상";
  const parsed = parseReview(String(r.text ?? ""), { refs: images.length - 1, product: pmode });
  if (!parsed) return finish({ ok: false, error_code: "review_unreadable", error_message: "검수 답을 읽지 못했어. 다시 해줘.", usage: r.usage, usage_usd: usd, cost_status: cost });
  return finish({ ok: true, scores: { checks: parsed.checks, ...(pmode ? { set: "product", mode: pmode } : {}) }, summary: parsed.summary, uncertainty: parsed.uncertainty, suggestions: parsed.suggestions, usage: r.usage, usage_usd: usd, cost_status: cost });
}
// 고친 이미지의 참고 사진: 원본(parent_image_id)을 따라 올라가며 참고 사진이 있는 첫 이미지의 것 (최대 5단계, 지운 원본도 기록은 읽음)
async function lineageRefs(img: J): Promise<J[]> {
  let cur = img;
  for (let i = 0; i < 5 && isUuid(cur.parent_image_id); i++) {
    const { data, error } = await sb.from("post_images").select("id, parent_image_id, ref_images").eq("id", cur.parent_image_id).maybeSingle();
    if (error || !data) break;
    cur = data as J;
    const r = (Array.isArray(cur.ref_images) ? cur.ref_images : []) as J[];
    if (r.length) return r;
  }
  return [];
}
// 사용자 평가 (모델 비교·후보 고르기). AI 평가와 따로 저장 — 항목마다 1(아쉬움)~3(좋음), AI 티는 3 = 거의 없음
async function evaluateImage(c: Ctx) {
  const b = await readJson(c.req, 5_000);
  const sc = (b.scores && typeof b.scores === "object" ? b.scores : {}) as J;
  const scores: J = {};
  for (const [k] of EVAL_CRITERIA as [string, string][]) { const v = Number(sc[k]); if (v === 1 || v === 2 || v === 3) scores[k] = v; }
  const { data, error } = await sb.rpc("image_eval_save", { p: { image_id: c.params[0], scores, preferred: b.preferred === true, batch_id: isUuid(b.batch_id) ? b.batch_id : "", note: str(b.note, 300).trim() } });
  if (error) { needs017(error, "image_eval_save"); rpcError(error); }
  return json({ review: data });
}
// 수정 이력: 맨 처음 원본부터 고친 이미지까지 (원본은 지우거나 덮어쓰지 않음). 지운 이미지는 그림 없이 기록만
async function imageLineage(c: Ctx) {
  const { data, error } = await sb.rpc("image_lineage", { p_image: c.params[0] });
  if (error) { needs017(error, "image_lineage"); throw error; }
  const items = (((data as J | null)?.items ?? []) as J[]);
  const alive = items.filter((x) => !x.deleted).map((x) => String(x.id));
  const rows = alive.length ? (((await sb.from("post_images").select("id, storage_path").in("id", alive)).data ?? []) as J[]) : [];
  const urls = await signPaths(rows.map((r) => String(r.storage_path ?? "")));
  const pathOf = Object.fromEntries(rows.map((r) => [String(r.id), String(r.storage_path)]));
  return json({ root_id: (data as J | null)?.root_id ?? null, items: items.map((x) => ({ ...x, url: x.deleted ? "" : urls[pathOf[String(x.id)]] ?? "" })) });
}
// 모델 비교 기록: 같은 입력으로 비교한 묶음에서 사용자가 매긴 평가만 모음 (AI 평가는 섞지 않음). 표본 수를 같이 보여줌
async function compareStats(_c: Ctx) {
  const [ev, gens] = await Promise.all([
    sb.from("image_reviews").select("image_id, batch_id, model, preferred, scores").eq("kind", "user_eval").not("batch_id", "is", null).limit(2000),
    sb.from("image_generations").select("batch_id, model, image_id").eq("batch_kind", "compare").not("image_id", "is", null).limit(4000),
  ]);
  if (ev.error) { needs017(ev.error, "image_reviews"); throw ev.error; }
  if (gens.error) throw gens.error;
  const cmp = new Set(((gens.data ?? []) as J[]).map((g) => String(g.batch_id)));
  type Acc = { model: string; rated: number; preferred: number; sums: Record<string, number>; counts: Record<string, number> };
  const by: Record<string, Acc> = {};
  const batches = new Set<string>();
  for (const e of (ev.data ?? []) as J[]) {
    if (!cmp.has(String(e.batch_id))) continue;
    batches.add(String(e.batch_id));
    const k = String(e.model || "?");
    const x = (by[k] ??= { model: k, rated: 0, preferred: 0, sums: {}, counts: {} });
    x.rated++;
    if (e.preferred === true) x.preferred++;
    for (const [c2, v] of Object.entries((e.scores ?? {}) as J)) { x.sums[c2] = (x.sums[c2] ?? 0) + Number(v); x.counts[c2] = (x.counts[c2] ?? 0) + 1; }
  }
  const models = Object.values(by).map((x) => ({ model: x.model, rated: x.rated, preferred: x.preferred,
    avg: Object.fromEntries(Object.keys(x.sums).map((k) => [k, Math.round((x.sums[k] / x.counts[k]) * 100) / 100])) }));
  return json({ batches: batches.size, models });
}
// 연결 확인: 공급자에 키·모델을 물어보기만 함 (이미지를 만들지 않아 돈이 들지 않음). 결과를 기록해서 설정 화면에 보여줌
async function checkProviderRoute(c: Ctx) {
  const b = await readJson(c.req, 2_000);
  const provider = oneOf(b.provider, ["openai", "gemini", "cloudflare"] as const, "provider");
  const s = await imageSettings();
  const asked = str(b.model, 64).trim();
  const candidates = [asked, String(s.image_gen_model ?? ""), String(s.image_edit_model ?? ""), ...IMAGE_MODES.map((m: J) => String(m.model))].filter(Boolean);
  const model = candidates.find((x) => { const cc = modelCaps(x); return cc.known && cc.provider === provider; }) ?? "";
  if (!model) fail(400, "bad_field", { field: "model" });
  const caps = modelCaps(model);
  const r = await providerCheck({ fetchImpl: fetch, provider, keys: providerKeys(), model: provider === "cloudflare" ? String(caps.cfModel) : model }) as J;
  const row = { provider, model, ok: r.ok === true, code: str(r.code, 60), message: scrub(String(r.message ?? ""), 300) };
  const ins = await sb.from("image_provider_checks").insert(row);
  if (ins.error) console.error("provider check save:", ins.error.message); // 017 전 DB면 기록만 못 함
  return json({ check: { ...row, checked_at: nowIso() } });
}

// ───────── 1.5.1: 상품 사진으로 장면 만들기 — 마스크·원본 보존 합성 저장·상품 디테일 검수 ─────────
// 배경 지우기(마스크)와 합성(픽셀 얹기)은 화면(이 기기 브라우저)에서 함: Edge Function 은 CPU 시간이 짧고 그림 그리기 도구가 없어서
// 서버는 결과 파일을 검사해서 새 이미지로 저장하고, 원본 상품 사진·배경 파일과 기록은 건드리지 않음 (실패하면 새로 올린 파일만 지움)
const MAX_MASK_BYTES = 6 * 1024 * 1024;
const MAX_COMPOSITE_BYTES = 12 * 1024 * 1024;
async function need018() {
  const { error } = await sb.from("product_masks").select("id").limit(1);
  if (error && (missingTable(error, "product_masks") || ["PGRST205", "42P01"].includes(String((error as { code?: string }).code ?? "")))) fail(409, "db_update_needed", { migration: "018" });
  if (error) throw error;
}
async function readImageForm(c: Ctx, maxBytes: number): Promise<{ bytes: Uint8Array; type: string; meta: J }> {
  const ct = (c.req.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.startsWith("multipart/form-data")) fail(415, "bad_type");
  const len = Number(c.req.headers.get("content-length") ?? 0);
  if (len > maxBytes + 200_000) fail(413, "too_large");
  let form: FormData;
  try { form = await c.req.formData(); } catch { return fail(400, "bad_body"); }
  const f = form.get("file");
  if (!(f instanceof Blob)) fail(400, "bad_field", { field: "file" });
  const file = f as Blob;
  if (file.size > maxBytes) fail(413, "too_large");
  let meta: J = {};
  try { meta = JSON.parse(String(form.get("meta") ?? "{}")) as J; } catch { fail(400, "bad_body"); }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) meta = {};
  return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type, meta };
}
const clamp01 = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, Math.round(n * 1000) / 1000)) : null; };
// 마스크 저장: 화면이 만든 '남길 영역'(PNG — 불투명 = 남김, 투명 = 지움). 원본 상품 사진과 같은 비율이어야 함 (크기는 같거나 작게)
async function saveMask(c: Ctx) {
  await need018();
  const { bytes, meta } = await readImageForm(c, MAX_MASK_BYTES);
  const sn = sniffImage(bytes) as J | null;
  if (!sn || sn.mime !== "image/png" || sn.animated) fail(400, "bad_image", { reason: "mask_png" });
  const { data: img, error } = await sb.from("post_images").select("id, kind, width, height").eq("id", c.params[0]).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!img) fail(404, "not_found");
  const pw = Number((img as J).width ?? 0), ph = Number((img as J).height ?? 0);
  const mw = Number(sn!.width), mh = Number(sn!.height);
  if (!(mw > 0 && mh > 0 && mw <= 4096 && mh <= 4096)) fail(400, "bad_field", { field: "file" });
  if (pw > 0 && ph > 0 && (mw > pw + 1 || mh > ph + 1 || Math.abs(mw / mh - pw / ph) > (pw / ph) * 0.02)) fail(400, "mask_size_mismatch");
  await storageGuard(bytes.length);
  const path = storagePath("mask", "png");
  const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: false, cacheControl: "3600" });
  if (up.error) fail(502, "storage_failed");
  const bb = (meta.bbox && typeof meta.bbox === "object" ? meta.bbox : null) as J | null;
  const int = (v: unknown) => Math.max(0, Math.min(4096, Math.round(Number(v) || 0)));
  const pr = (meta.params && typeof meta.params === "object" ? meta.params : {}) as J;
  const p = {
    image_id: c.params[0], storage_path: path, width: mw, height: mh, bytes: bytes.length,
    method: ["auto_u2netp", "auto_simple", "alpha", "manual"].includes(String(meta.method)) ? String(meta.method) : "manual", edited: meta.edited === true,
    params: { feather: int(pr.feather), shrink: int(pr.shrink), threshold: clamp01(pr.threshold), model: str(pr.model, 40) },
    bbox: bb ? { x: int(bb.x), y: int(bb.y), w: int(bb.w), h: int(bb.h) } : null, coverage: clamp01(meta.coverage),
  };
  const r = await sb.rpc("image_mask_save", { p });
  if (r.error) { await sb.storage.from(BUCKET).remove([path]); rpcError(r.error); }
  const urls = await signPaths([path]);
  return json({ mask: { ...(r.data as J), url: urls[path] ?? "" } }, 201);
}
// 원본 보존 합성 저장: 화면이 원본 상품 레이어(마스크 밖만 투명, 상품 픽셀은 원본 그대로)를 AI 배경 위에 얹어 만든 파일 (보통 PNG — 다시 압축하지 않음)
async function saveComposite(c: Ctx) {
  await need018();
  const { bytes, type, meta } = await readImageForm(c, MAX_COMPOSITE_BYTES);
  const chk = checkImageFile(bytes, type, MAX_COMPOSITE_BYTES) as J;
  if (!chk.ok) fail(400, "bad_image", { reason: chk.code });
  if (Number(chk.width) > 4096 || Number(chk.height) > 4096) fail(400, "bad_image", { reason: "too_many_pixels" });
  for (const k of ["product_image_id", "background_image_id", "mask_id"]) if (!isUuid(meta[k])) fail(400, "bad_field", { field: k });
  if (meta.parent_image_id !== undefined && meta.parent_image_id !== "" && !isUuid(meta.parent_image_id)) fail(400, "bad_field", { field: "parent_image_id" });
  const purpose = has(PURPOSES, meta.purpose) ? String(meta.purpose) : "blog_body";
  const ratio = ratioOf(purpose, str(meta.ratio, 8));
  const layer = { ...(cleanLayer(meta.layer) as J), ratio };
  const { data: rows, error } = await sb.from("post_images").select("*").in("id", [meta.product_image_id, meta.background_image_id]).is("deleted_at", null);
  if (error) throw error;
  const prod = ((rows ?? []) as J[]).find((r) => r.id === meta.product_image_id);
  const bg = ((rows ?? []) as J[]).find((r) => r.id === meta.background_image_id);
  if (!prod) fail(404, "product_not_found");
  if (!bg) fail(404, "background_not_found");
  // 배경은 이 상품용으로 만든 빈 배경만 (AI 실사 장면·일반 AI 이미지에 원본 상품을 또 얹지 않게 — DB도 같은 규칙, 1.5.1 검토)
  if (bg!.kind !== "ai" || bg!.preset !== PRODUCT_PRESETS.layer || String(bg!.composite_mode ?? "") !== "" || bg!.product_image_id !== prod!.id) fail(400, "background_mismatch");
  // 사진 자리에 바로 넣기 (선택): 새 합성은 아직 상품 검수 전이라 발행 준비 완료·예약·게시 완료 글에는 못 넣음
  let post: J | null = null, slot: J | null = null, link: J | null = null;
  if (isUuid(meta.post_id)) ({ post, slot } = await slotTarget(meta, false));
  if (meta.link === true) {
    if (!post || !slot) fail(400, "bad_field", { field: "slot_key" });
    if (["ready", "scheduled", ...LIVE].includes(String(post!.stage))) fail(409, "product_check_needed");
    link = { post_id: post!.id, slot_key: slot!.key, slot_index: slot!.index, slot_text: slot!.text, slot_ctx: ctxOf(slot), purpose };
  }
  await storageGuard(bytes.length);
  const out = stripMetadata(bytes).bytes as Uint8Array;
  const path = storagePath("composite", String(chk.ext));
  const up = await sb.storage.from(BUCKET).upload(path, out, { contentType: String(chk.mime), upsert: false, cacheControl: "3600" });
  if (up.error) fail(502, "storage_failed");
  const desc = str(meta.description, 300).trim() || (slot ? String(slot.text ?? "") : "") || String(prod!.description || "상품 합성 이미지");
  const spec = cleanProductSpec(meta.spec) as J;
  const img = {
    origin_post_id: post ? post.id : "", origin_slot_index: slot ? slot.index ?? "" : "", origin_slot_key: slot ? slot.key : "",
    kind: "composite", provider: "composite", model: "", prompt: "", user_prompt: "", style: "", purpose, ratio,
    description: desc, alt_text: altTextFor(desc), storage_path: path, mime: chk.mime, bytes: out.length, width: chk.width, height: chk.height,
    sha256: await sha256Hex(out), license: compositeLicense(prod), attribution_text: productAttribution(prod), rights_confirmed: true,
    source_url: prod!.kind === "stock" ? String(prod!.source_url ?? "") : "", author_name: prod!.kind === "stock" ? String(prod!.author_name ?? "") : "",
    author_url: prod!.kind === "stock" ? String(prod!.author_url ?? "") : "",
    parent_image_id: isUuid(meta.parent_image_id) ? meta.parent_image_id : "",
    product_image_id: prod!.id, background_image_id: bg!.id, mask_id: meta.mask_id, layer,
    scene: { v: 1, kind: "product", mode: "layer", mode_label: "상품 원본 보존 합성", template: spec.template, purpose: spec.purpose, angle: spec.angle, place: spec.place,
      background_prompt_preset: String(bg!.preset ?? ""), note: "상품 픽셀은 원본 사진 그대로 (AI가 다시 그리지 않음), 배경만 AI" },
    preset: PRODUCT_PRESETS.layer,
  };
  const r = await sb.rpc("image_save", { img, link, gen: null, fin: null });
  if (r.error) { await sb.storage.from(BUCKET).remove([path]); rpcError(r.error); }
  return json({ image: (await withUrls([(r.data as J).image as J]))[0], slot: (r.data as J).slot ?? null }, 201);
}
// 상품 디테일 검수 저장·승인 (사용자가 원본과 결과를 나란히 보고 아홉 칸을 고름). AI 검수 의견은 참고로 따로 — 여기 섞지 않음
// 승인을 풀면 이 이미지를 쓰는 발행 준비·예약 글은 '검수 필요'로 되돌림 (게시 완료 글은 그대로 두고 발행 전 검사에 보임)
async function productCheck(c: Ctx) {
  await need018();
  const b = await readJson(c.req, 5_000);
  const src = (b.items && typeof b.items === "object" ? b.items : {}) as J;
  const items: J = {};
  for (const [k] of PRODUCT_CHECKS as [string, string][]) if (["ok", "issue", "unsure"].includes(String(src[k]))) items[k] = String(src[k]);
  const approve = b.approve === true;
  const { data: cur, error: e0 } = await sb.from("post_images").select("id, kind, composite_mode, product_check").eq("id", c.params[0]).is("deleted_at", null).maybeSingle();
  if (e0) throw e0;
  if (!cur) fail(404, "not_found");
  const was = productApproved(cur);
  // 승인을 풀면 DB(트리거)가 이 이미지를 쓰는 발행 준비·예약 글(휴지통 포함)을 '검수 필요'로 되돌림 → 어느 글인지 먼저 찾아서 알려줌
  let demoted: string[] = [];
  if (was && !approve) {
    const { data: sl, error: e1 } = await sb.from("post_image_slots").select("post_id").eq("image_id", c.params[0]);
    if (e1) throw e1;
    const ids = [...new Set(((sl ?? []) as J[]).map((x) => String(x.post_id)))];
    if (ids.length) {
      const { data: d2, error: e2 } = await sb.from("posts").select("id").in("id", ids).in("stage", ["ready", "scheduled"]);
      if (e2) throw e2;
      demoted = ((d2 ?? []) as J[]).map((x) => String(x.id));
    }
  }
  const { data, error } = await sb.rpc("image_product_check", { p_image: c.params[0], p: { items, note: str(b.note, 500).trim(), approve } });
  if (error) rpcError(error);
  return json({ image: (await withUrls([data as J]))[0], demoted });
}
// 카드뉴스 배경으로 상품 장면 이미지를 쓸 때도 상품 디테일 검수를 승인한 것만 (카드는 따로 검수 대상이 아니라서 — 1.5.1 검토)
async function productBgGate(id: string) {
  const { data, error } = await sb.from("post_images").select("kind, composite_mode, product_check").eq("id", id).maybeSingle();
  if (error) { if (missingColumn(error, "composite_mode") || /composite_mode|product_check/.test(String(error.message ?? ""))) return; throw error; }
  if (data && productSceneMode(data as J) && !productApproved(data as J)) fail(409, "product_check_needed");
}
// 발행 준비 완료·예약·게시 완료로 바꿀 때: 이 글의 자리에 연결된 상품 장면 이미지 중 승인 안 한 것 (018 전 DB면 그런 이미지가 있을 수 없어서 빈 목록)
async function productGateFor(post: J): Promise<J[]> {
  const { data, error } = await sb.from("post_image_slots").select("slot_key, image_id, post_images(kind, composite_mode, product_check)").eq("post_id", post.id).not("image_id", "is", null);
  if (error) {
    if (/composite_mode|product_check/.test(String(error.message ?? "")) || missingColumn(error, "composite_mode")) return [];
    throw error;
  }
  return productGateErrors(post, ((data ?? []) as J[]).map((r) => ({ slot_key: r.slot_key, image: r.post_images }))) as J[];
}
// 상품 장면 결과의 내력: 원본 상품 사진 · (원본 보존 합성) 배경·마스크 · 비용 (모델 생성 비용과 배경 지우기 비용을 따로, 예상과 실제를 따로)
async function productTrail(img: J): Promise<J | null> {
  const mode = productSceneMode(img);
  if (!mode) return null;
  const ids = [img.product_image_id, mode === "layer" ? img.background_image_id : null].filter(isUuid) as string[];
  const { data: rows } = ids.length ? await sb.from("post_images").select("*").in("id", ids) : { data: [] as J[] };
  const list = (rows ?? []) as J[];
  const prod = list.find((r) => r.id === img.product_image_id) ?? null;
  const bg = mode === "layer" ? list.find((r) => r.id === img.background_image_id) ?? null : null;
  const genId = mode === "layer" ? bg?.generation_id : img.generation_id;
  const [gen, mask] = await Promise.all([
    isUuid(genId) ? sb.from("image_generations").select(GEN_COLS).eq("id", genId).maybeSingle() : Promise.resolve({ data: null }),
    mode === "layer" && isUuid(img.mask_id) ? sb.from("product_masks").select("*").eq("id", img.mask_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const live = [prod, bg].filter((x) => x && !x.deleted_at) as J[];
  const signed = (await withUrls(live)) as J[];
  const urlOf = (x: J | null) => (x ? signed.find((y) => y.id === x.id) ?? { ...x, url: "" } : null);
  const m = (mask.data ?? null) as J | null;
  const mUrl = m && !m.deleted_at && m.storage_path ? (await signPaths([String(m.storage_path)]))[String(m.storage_path)] ?? "" : "";
  const g = (gen.data ?? null) as J | null;
  return {
    mode, product: urlOf(prod), background: urlOf(bg), mask: m ? { ...m, url: mUrl } : null,
    costs: {
      model: g ? { model: g.model, provider: g.provider, est_usd: g.est_usd, usage_usd: g.usage_usd, actual_usd: g.actual_usd, cost_status: g.cost_status, generation_id: g.id } : null,
      cutout: mode === "layer" ? { method: m ? m.method : "", cost_usd: m ? Number(m.cost_usd ?? 0) : 0, cost_status: m ? String(m.cost_status ?? "청구 없음") : "청구 없음", where: "이 기기 (브라우저)" } : null,
    },
  };
}

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
    await productBgGate(String(meta.bg_image_id));
    const cols = "kind, provider, source_url, author_name, author_url, attribution_text, license, rights_confirmed";
    let r0 = await sb.from("post_images").select(cols + ", composite, composite_mode").eq("id", meta.bg_image_id).maybeSingle();
    if (r0.error) r0 = await sb.from("post_images").select(cols + ", composite").eq("id", meta.bg_image_id).maybeSingle();
    if (r0.error && missingColumn(r0.error, "composite")) r0 = await sb.from("post_images").select(cols).eq("id", meta.bg_image_id).maybeSingle();
    bg = (r0.data as J | null) ?? null;
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
  if (kind) q = q.eq("kind", oneOf(kind, ["ai", "stock", "upload", "card", "composite"] as const, "kind"));
  // 1.5.1: 한 상품 사진으로 만든 장면(합성 결과·AI 실사 장면·합성 배경)만
  const productId = c.url.searchParams.get("product_id");
  if (productId) { if (!isUuid(productId)) fail(400, "bad_field", { field: "product_id" }); q = q.eq("product_image_id", productId); }
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
  // 1.5.0: 이 이미지의 AI 검수·사용자 평가 (017 전 DB면 빈 목록)
  const rv = await sb.from("image_reviews").select("*").eq("image_id", c.params[0]).order("created_at", { ascending: false }).limit(10);
  // 1.5.1: 상품 장면 결과면 원본 상품 사진·배경·마스크·비용 내력, 진짜 사진이면 그 사진의 마스크(최근 것)와 그 사진으로 만든 장면 수
  const img = data as J;
  const product = await productTrail(img).catch((e) => { console.error("product trail:", String((e as Error)?.message ?? e).slice(0, 200)); return null; });
  let masks: J[] = [], scenes = 0;
  if (img.kind === "upload" || img.kind === "stock") {
    const [mk, sc] = await Promise.all([
      sb.from("product_masks").select("*").eq("image_id", img.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(5),
      sb.from("post_images").select("id", { count: "exact", head: true }).eq("product_image_id", img.id).is("deleted_at", null),
    ]);
    if (!mk.error) {
      const urls = await signPaths(((mk.data ?? []) as J[]).map((m) => String(m.storage_path ?? "")));
      masks = ((mk.data ?? []) as J[]).map((m) => ({ ...m, url: urls[String(m.storage_path)] ?? "" }));
    }
    scenes = sc.error ? 0 : sc.count ?? 0;
  }
  return json({ image: (await withUrls([img]))[0], used_in: slots.data, decks: decks.data, generation: gen.data, reviews: rv.error ? [] : rv.data, product, masks, scenes });
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
  // 1.5.1: 상품 장면 이미지는 상품 디테일 검수를 승인해야 '사용 가능' (승인은 POST /images/{id}/product-check). DB 트리거도 같은 규칙으로 막음
  if (p.review_status === "사용 가능") {
    const { data: cur, error: e1 } = await sb.from("post_images").select("*").eq("id", c.params[0]).is("deleted_at", null).maybeSingle();
    if (e1) throw e1;
    if (!cur) fail(404, "not_found");
    if (productSceneMode(cur) && !productApproved(cur)) fail(409, "product_check_needed");
  }
  const { data, error } = await sb.from("post_images").update(p).eq("id", c.params[0]).is("deleted_at", null).select().maybeSingle();
  if (error && /product_check_needed/.test(String(error.message ?? ""))) fail(409, "product_check_needed");
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
  const small = String((data as J)?.ref_small_path ?? ""); // 1.5.0: 무료 모델용 작은 사본도 같이 지움
  // 1.5.1: 이 사진의 상품 마스크 파일도 (합성 결과가 남아 있으면 DB가 먼저 거절해서 여기까지 안 옴)
  const masks = (Array.isArray((data as J)?.mask_paths) ? (data as J).mask_paths as unknown[] : []).map(String).filter(Boolean);
  let removed = false;
  if (path) {
    const r = await sb.storage.from(BUCKET).remove([path, small, ...masks].filter(Boolean));
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
  const { post, slot, purpose } = await slotTarget({ ...b, post_id: postId }, true);
  // 1.5.1: 발행 준비 완료·예약·게시 완료 글에는 상품 디테일 검수를 승인한 상품 장면 이미지만 (검토 중인 글에는 넣어 두고 승인은 나중에 해도 됨)
  if (["ready", "scheduled", ...LIVE].includes(String(post!.stage))) {
    const { data: im, error: e0 } = await sb.from("post_images").select("*").eq("id", b.image_id).is("deleted_at", null).maybeSingle();
    if (e0) throw e0;
    if (im && productSceneMode(im) && !productApproved(im)) fail(409, "product_check_needed");
  }
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
    await productBgGate(bg);
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
// 저장은 DB 함수 save_search_terms 하나로 (한 번에). 그 글에 기간이 겹치는 다른 기록이 있으면 409 period_overlap —
// 화면이 확인을 받고 replace_overlap: true 로 다시 보내면 겹치는 기간을 지우고 저장
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
    seen.set(k, { term, views });
  }
  const { data, error } = await sb.rpc("save_search_terms", {
    target: post.id, p_start: start, p_end: end, items: [...seen.values()], replace_overlap: b.replace_overlap === true, p_channel: ch, p_label: label,
  });
  if (error) {
    needs016(error, "save_search_terms");
    const ov = /period overlap: (\[.*\])/s.exec(String(error.message ?? ""));
    if (ov) {
      let periods: J[] = [];
      try { periods = (JSON.parse(ov[1]) as J[]).map((x) => ({ period_start: String(x.period_start), period_end: String(x.period_end) })); } catch { /* 모양이 달라도 409 는 그대로 */ }
      fail(409, "period_overlap", { periods });
    }
    rpcError(error);
  }
  const saved = Array.isArray(data) ? (data as J[]) : [];
  return json({ saved: saved.length, search_terms: saved });
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
  ["GET", R("images/compare-stats"), compareStats],
  ["POST", R("images/providers/check"), checkProviderRoute],
  ["POST", R(`images/${U}/small`), uploadSmallCopy],
  ["POST", R("images/composite"), saveComposite],
  ["POST", R(`images/${U}/mask`), saveMask],
  ["POST", R(`images/${U}/product-check`), productCheck],
  ["POST", R(`images/${U}/review`), reviewImage],
  ["POST", R(`images/${U}/evaluate`), evaluateImage],
  ["GET", R(`images/${U}/lineage`), imageLineage],
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
