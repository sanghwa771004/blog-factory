// 블로그 글공장 앱 전용 API
// - 접속 코드(x-app-token)의 SHA-256 해시를 app_access 표와 비교해서 통과한 요청만 처리
// - 표는 RLS로 막혀 있고, 이 함수만 서비스 키로 읽고 쓴다
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

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
    } catch (_) {
      // 아래 예전 키로 넘어감
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

const sb = createClient(SUPABASE_URL, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,x-app-token,authorization,apikey,x-client-info",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const URLRE = /^https?:\/\/[^\s"'<>]+$/i;
const STYLES = ["TOP N 비교 추천형", "단일 상품 솔직 리뷰형", "문제 해결 정보형", "구매 가이드(고르는 법)형"];
const MONEY = ["쿠팡파트너스", "토스 쇼핑 제휴", "애드센스(정보성 글)"];
const PLATFORMS = ["네이버 블로그", "티스토리", "워드프레스 / 구글 블로그"];
const LENS = ["1500", "2500", "3500"];

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
function urlOrEmpty(v: unknown): string | null {
  const s = str(v, 2000).trim();
  if (!s) return "";
  return URLRE.test(s) ? s : null;
}

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let tokenHash: string | null = null;
let tokenAt = 0;
async function authorized(req: Request): Promise<boolean> {
  const t = req.headers.get("x-app-token") ?? "";
  if (t.length < 16 || t.length > 128) return false;
  if (!tokenHash || Date.now() - tokenAt > 60_000) {
    const { data, error } = await sb.from("app_access").select("token_hash").eq("id", 1).maybeSingle();
    if (error || !data) return false;
    tokenHash = String(data.token_hash);
    tokenAt = Date.now();
  }
  const h = await sha256hex(t);
  if (h.length !== tokenHash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ tokenHash.charCodeAt(i);
  return diff === 0;
}

function cleanPostPatch(b: Record<string, unknown>): Record<string, unknown> | string {
  const p: Record<string, unknown> = {};
  if ("publish_date" in b) {
    const v = b.publish_date;
    if (v === null || v === "") p.publish_date = null;
    else if (typeof v === "string" && DATE.test(v)) p.publish_date = v;
    else return "publish_date";
  }
  if ("link" in b) {
    const v = urlOrEmpty(b.link);
    if (v === null) return "link";
    p.link = v;
  }
  if ("blog_url" in b) {
    const v = urlOrEmpty(b.blog_url);
    if (v === null) return "blog_url";
    p.blog_url = v;
  }
  if ("status" in b) {
    if (b.status !== "planned" && b.status !== "published") return "status";
    p.status = b.status;
    p.published_at = b.status === "published" ? new Date().toISOString() : null;
  }
  if ("body" in b) {
    if (typeof b.body !== "string" || b.body.length > 60000) return "body";
    p.body = b.body;
  }
  if ("titles" in b) {
    if (!Array.isArray(b.titles)) return "titles";
    p.titles = b.titles.map((t) => str(t, 300).trim()).filter(Boolean).slice(0, 5);
  }
  if ("threads" in b) p.threads = str(b.threads, 2000);
  if ("instagram" in b) p.instagram = str(b.instagram, 3000);
  return p;
}

function cleanRequest(b: Record<string, unknown>): Record<string, unknown> | null {
  if (!b || typeof b !== "object") return null;
  const keyword = str(b.keyword, 120).trim();
  if (!keyword) return null;
  return {
    keyword,
    style: STYLES.includes(String(b.style)) ? String(b.style) : "",
    money: MONEY.includes(String(b.money)) ? String(b.money) : "쿠팡파트너스",
    platform: PLATFORMS.includes(String(b.platform)) ? String(b.platform) : "네이버 블로그",
    len: LENS.includes(String(b.len)) ? String(b.len) : "2500",
    link: urlOrEmpty(b.link) ?? "",
    exp: str(b.exp, 1500),
    ref: str(b.ref, 6000),
  };
}

function cleanSettings(b: Record<string, unknown>): Record<string, unknown> | string {
  const p: Record<string, unknown> = {};
  if ("per_day" in b) {
    const n = Number(b.per_day);
    if (!Number.isInteger(n) || n < 1 || n > 3) return "per_day";
    p.per_day = n;
  }
  if ("auto_topics" in b) p.auto_topics = str(b.auto_topics, 300);
  if ("auto_enabled" in b) p.auto_enabled = b.auto_enabled === true;
  if ("money" in b) {
    if (!MONEY.includes(String(b.money))) return "money";
    p.money = String(b.money);
  }
  if ("platform" in b) {
    if (!PLATFORMS.includes(String(b.platform))) return "platform";
    p.platform = String(b.platform);
  }
  if ("len" in b) {
    if (!LENS.includes(String(b.len))) return "len";
    p.len = String(b.len);
  }
  return p;
}

async function readJson(req: Request): Promise<Record<string, unknown> | unknown[] | null> {
  try {
    const text = await req.text();
    if (text.length > 200_000) return null;
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const at = parts.indexOf("blog-app");
  const route = at >= 0 ? parts.slice(at + 1) : parts;

  if (route[0] === "ping") return json({ ok: true, time: new Date().toISOString() });
  if (!(await authorized(req))) return json({ error: "unauthorized" }, 401);

  try {
    // 앱이 처음 열릴 때 한 번에 다 가져가기
    if (req.method === "GET" && route[0] === "state") {
      const [posts, requests, settings, runs] = await Promise.all([
        sb.from("posts").select("*").order("created_at", { ascending: false }).limit(500),
        sb.from("requests").select("*").order("created_at", { ascending: false }).limit(100),
        sb.from("settings").select("*").eq("id", 1).maybeSingle(),
        sb.from("runs").select("*").order("ran_at", { ascending: false }).limit(1),
      ]);
      for (const r of [posts, requests, settings, runs]) if (r.error) throw r.error;
      return json({
        posts: posts.data ?? [],
        requests: requests.data ?? [],
        settings: settings.data,
        lastRun: runs.data?.[0] ?? null,
        now: new Date().toISOString(),
      });
    }

    if (route[0] === "posts" && route[1]) {
      const id = route[1];
      if (!UUID.test(id)) return json({ error: "bad_id" }, 400);
      if (req.method === "PATCH" || req.method === "POST") {
        const body = await readJson(req);
        if (!body || Array.isArray(body)) return json({ error: "bad_body" }, 400);
        const patch = cleanPostPatch(body);
        if (typeof patch === "string") return json({ error: "bad_field", field: patch }, 400);
        if (!Object.keys(patch).length) return json({ error: "empty" }, 400);
        const { data, error } = await sb.from("posts").update(patch).eq("id", id).select().maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: "not_found" }, 404);
        return json({ post: data });
      }
      if (req.method === "DELETE") {
        await sb.from("requests").update({ post_id: null }).eq("post_id", id);
        const { error } = await sb.from("posts").delete().eq("id", id);
        if (error) throw error;
        return json({ ok: true });
      }
    }

    if (route[0] === "requests") {
      if (req.method === "POST" && !route[1]) {
        const body = await readJson(req);
        const items = Array.isArray(body) ? body : body ? [body] : [];
        const rows = items.slice(0, 30).map((x) => cleanRequest(x as Record<string, unknown>)).filter(Boolean);
        if (!rows.length) return json({ error: "empty" }, 400);
        const { data, error } = await sb.from("requests").insert(rows).select();
        if (error) throw error;
        return json({ requests: data });
      }
      if (route[1] && UUID.test(route[1])) {
        if (req.method === "DELETE") {
          const { data, error } = await sb.from("requests").update({ status: "cancelled" })
            .eq("id", route[1]).eq("status", "pending").select().maybeSingle();
          if (error) throw error;
          return json({ request: data });
        }
        if (req.method === "PATCH" || (req.method === "POST" && route[2] === "retry")) {
          // 실패한 요청 다시 넣기
          const { data, error } = await sb.from("requests").update({ status: "pending", note: "" })
            .eq("id", route[1]).in("status", ["failed", "cancelled"]).select().maybeSingle();
          if (error) throw error;
          return json({ request: data });
        }
      }
    }

    if (route[0] === "settings" && (req.method === "PATCH" || req.method === "POST")) {
      const body = await readJson(req);
      if (!body || Array.isArray(body)) return json({ error: "bad_body" }, 400);
      const patch = cleanSettings(body);
      if (typeof patch === "string") return json({ error: "bad_field", field: patch }, 400);
      const { data, error } = await sb.from("settings").update(patch).eq("id", 1).select().maybeSingle();
      if (error) throw error;
      return json({ settings: data });
    }

    return json({ error: "not_found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "server", detail: String((e as Error)?.message ?? e).slice(0, 300) }, 500);
  }
});
