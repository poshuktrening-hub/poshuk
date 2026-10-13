/* «Пошук техніки» — бекенд на Cloudflare Pages Functions + D1.
 *
 *   POST /api               {action, p, ...}  — ті самі дії, що й у Google-скрипта
 *   GET  /api/img/<id>?t=…                    — знімок етапу (пакет плиток), з кешем на CDN
 *   PUT  /api/blob/<id>/<n> (заголовок X-Token) — частина пакета під час завантаження етапу
 *
 * Привʼязки (Settings → Functions): D1 як DB; змінні SHEETS_URL і SHEETS_SECRET —
 * куди дублювати результати (Google-скрипт таблиці). Перший вхід адміна сам переносить
 * налаштування й паролі з Google-таблиці.
 */
const VERSION = "cf-1.0";
const MAX_ROUNDS = 10;
const LOCK_FAILS = 10, LOCK_SECONDS = 15 * 60;
const CHUNK = 1_500_000; // < 2 МБ — ліміт рядка D1
const TOKEN_HOURS = 12;
const DEFAULTS = {
  player_password: "змініть-мене-курсант", admin_password: "змініть-мене-адмін",
  rounds_per_game: "5", time_limit_sec: "60", misses_allowed: "1", grid_cols: "8", zoom_click: "5", report: "TRUE",
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY, title TEXT, enabled INTEGER, w INTEGER, h INTEGER,
     targets TEXT, created TEXT, size INTEGER DEFAULT 0, chunks INTEGER DEFAULT 0, ready INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS blobs (id TEXT, part INTEGER, data BLOB, PRIMARY KEY (id, part))`,
  `CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, name TEXT, length_m REAL, type TEXT, data TEXT, created TEXT)`,
  `CREATE TABLE IF NOT EXISTS clicks (stage TEXT, x INTEGER, y INTEGER, hit INTEGER, ts TEXT, who TEXT)`,
  `CREATE INDEX IF NOT EXISTS clicks_stage ON clicks (stage)`,
  `CREATE TABLE IF NOT EXISTS results (ts TEXT, callsign TEXT, total INTEGER, max INTEGER, pct INTEGER, conclusion TEXT, scores TEXT)`,
];

class HttpError extends Error { constructor(msg, status = 200) { super(msg); this.status = status; } }

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: Object.assign({"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}, extra),
});

// ------------------------------------------------------------------ база
let schemaReady = false;
async function db(env) {
  if (!env.DB) throw new HttpError("База D1 не підключена (Settings → Functions → D1 binding: DB)");
  if (!schemaReady) { await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q))); schemaReady = true; }
  return env.DB;
}

async function metaGet(env, k) { const r = await env.DB.prepare("SELECT v FROM meta WHERE k=?").bind(k).first(); return r ? r.v : null; }
async function metaSet(env, k, v) { await env.DB.prepare("INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(v)).run(); }

async function settings(env) {
  const {results} = await env.DB.prepare("SELECT k, v FROM settings").all();
  const out = Object.assign({}, DEFAULTS);
  results.forEach((r) => (out[r.k] = r.v));
  out._empty = !results.length;
  return out;
}

function publicSettings(s) {
  const n = (v, d) => (isNaN(Number(v)) || v === "" ? d : Number(v));
  return {
    rounds_per_game: Math.max(1, Math.min(MAX_ROUNDS, n(s.rounds_per_game, 5))),
    time_limit_sec: Math.max(10, n(s.time_limit_sec, 60)),
    misses_allowed: Math.max(0, n(s.misses_allowed, 1)),
    grid_cols: Math.max(3, Math.min(20, n(s.grid_cols, 8))),
    zoom_click: Math.max(2, n(s.zoom_click, 5)),
    report: String(s.report).toUpperCase() !== "FALSE",
  };
}

async function saveSettings(env, vals) {
  const st = [];
  for (const k of Object.keys(DEFAULTS)) {
    if (vals[k] === undefined) continue;
    const v = String(vals[k]).trim();
    if (/password/.test(k) && v.length < 6) throw new HttpError("Пароль має бути не коротший за 6 символів");
    st.push(env.DB.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, v));
  }
  if (st.length) await env.DB.batch(st);
}

// ------------------------------------------------------------------ Google-скрипт (перенесення й дублювання результатів)
async function gas(env, body) {
  if (!env.SHEETS_URL) throw new HttpError("Не задано SHEETS_URL");
  const r = await fetch(env.SHEETS_URL, {method: "POST", body: JSON.stringify(body), redirect: "follow"});
  return r.json();
}

/* Перший вхід: якщо налаштувань ще немає, пароль перевіряє Google-скрипт і віддає налаштування. */
async function bootstrap(env, p) {
  if (!env.SHEETS_URL || !p) return false;
  let j;
  try { j = await gas(env, {action: "get_settings", p}); } catch (e) { return false; }
  if (!j || !j.ok) return false;
  const vals = {};
  Object.keys(DEFAULTS).forEach((k) => { if (j.settings[k] !== undefined && j.settings[k] !== "") vals[k] = j.settings[k]; });
  await saveSettings(env, vals);
  return true;
}

// ------------------------------------------------------------------ доступ
const enc = new TextEncoder();
async function hmac(env, msg) {
  let secret = await metaGet(env, "token_secret");
  if (!secret) {
    secret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await metaSet(env, "token_secret", secret);
  }
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* Токен стабільний у межах 12-годинного вікна — тоді адреси знімків однакові й браузер їх кешує. */
async function makeToken(env, role) {
  const win = TOKEN_HOURS * 3600;
  const exp = (Math.floor(Date.now() / 1000 / win) + 2) * win;
  return `${role}.${exp}.${await hmac(env, role + "." + exp)}`;
}

async function checkToken(env, t, need) {
  const [role, exp, sig] = String(t || "").split(".");
  if (!role || !exp || !sig || Number(exp) * 1000 < Date.now()) return null;
  if (sig !== await hmac(env, role + "." + exp)) return null;
  if (need === "admin" && role !== "admin") return null;
  return role;
}

async function auth(env, req, need) {
  if (req.t) { const r = await checkToken(env, req.t, need); if (r) return r; }
  const until = Number(await metaGet(env, "lock_until") || 0);
  if (until > Date.now()) throw new HttpError("Забагато невдалих спроб. Спробуйте за 15 хвилин.");
  let s = await settings(env);
  const p = String(req.p || "");
  if (s._empty && await bootstrap(env, p)) s = await settings(env);
  const isAdmin = !!p && p === String(s.admin_password);
  const isPlayer = isAdmin || (!!p && p === String(s.player_password));
  if (need === "admin" ? isAdmin : isPlayer) return isAdmin ? "admin" : "player";
  const fails = Number(await metaGet(env, "fails") || 0) + 1;
  if (fails >= LOCK_FAILS) { await metaSet(env, "lock_until", Date.now() + LOCK_SECONDS * 1000); await metaSet(env, "fails", 0); }
  else await metaSet(env, "fails", fails);
  throw new HttpError("Невірний пароль");
}

// ------------------------------------------------------------------ етапи
function rowToStage(r) {
  let targets = [];
  try { targets = JSON.parse(r.targets || "[]"); } catch (e) { targets = []; }
  return {id: r.id, title: r.title, enabled: !!r.enabled, w: r.w || 0, h: r.h || 0, targets};
}

async function stages(env, all) {
  const {results} = await env.DB.prepare("SELECT id,title,enabled,w,h,targets FROM stages WHERE ready=1 ORDER BY created").all();
  return results.map(rowToStage).filter((s) => all || (s.enabled && s.targets.length));
}

function newId() { return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join(""); }

// ------------------------------------------------------------------ дії (POST /api)
async function action(env, ctx, req, origin) {
  const a = req.action;
  switch (a) {
    case "ping": return {ok: true, version: VERSION};
    case "diag": {
      if (!env.SHEETS_URL) return {ok: true, gas: "no SHEETS_URL"};
      try {
        const r = await fetch(env.SHEETS_URL, {method: "POST", body: JSON.stringify({action: "ping"}), redirect: "follow"});
        const t = await r.text();
        return {ok: true, status: r.status, type: r.headers.get("content-type"), url: r.url.slice(0, 60), body: t.slice(0, 160), secret: !!env.SHEETS_SECRET};
      } catch (e) { return {ok: true, error: String(e)}; }
    }
    case "login": { const role = await auth(env, req, "player"); return {ok: true, role, token: await makeToken(env, role)}; }
    case "config": {
      const role = await auth(env, req, "player");
      return {ok: true, settings: publicSettings(await settings(env)), stages: await stages(env, false), token: await makeToken(env, role)};
    }
    case "submit": { await auth(env, req, "player"); return submit(env, ctx, req); }
  }
  await auth(env, req, "admin");
  switch (a) {
    case "admin_stages": return {ok: true, stages: await stages(env, true), token: await makeToken(env, "admin")};
    case "stage_begin": {
      const id = newId(), size = Number(req.size) || 0;
      const chunks = Math.ceil(size / CHUNK);
      if (!size || size > 60e6) throw new HttpError("Знімок завеликий (понад 60 МБ)");
      await env.DB.prepare("INSERT INTO stages (id,title,enabled,w,h,targets,created,size,chunks,ready) VALUES (?,?,1,?,?,?,?,?,?,0)")
        .bind(id, String(req.title || "Етап").slice(0, 120), Number(req.w) || 0, Number(req.h) || 0,
          JSON.stringify(Array.isArray(req.targets) ? req.targets : []), new Date().toISOString(), size, chunks).run();
      return {ok: true, id, chunk: CHUNK, chunks, token: await makeToken(env, "admin")};
    }
    case "stage_end": {
      const st = await env.DB.prepare("SELECT chunks FROM stages WHERE id=?").bind(String(req.id)).first();
      if (!st) throw new HttpError("Етап не знайдено");
      const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM blobs WHERE id=?").bind(String(req.id)).first();
      if (c.n !== st.chunks) throw new HttpError(`Завантажено ${c.n} з ${st.chunks} частин — спробуйте ще раз`);
      await env.DB.prepare("UPDATE stages SET ready=1 WHERE id=?").bind(String(req.id)).run();
      const r = await env.DB.prepare("SELECT id,title,enabled,w,h,targets FROM stages WHERE id=?").bind(String(req.id)).first();
      return {ok: true, stage: rowToStage(r)};
    }
    case "save_stage": {
      const sets = [], vals = [];
      if (req.title !== undefined) { sets.push("title=?"); vals.push(String(req.title).slice(0, 120)); }
      if (req.enabled !== undefined) { sets.push("enabled=?"); vals.push(req.enabled ? 1 : 0); }
      if (req.targets !== undefined) { sets.push("targets=?"); vals.push(JSON.stringify(req.targets)); }
      if (sets.length) await env.DB.prepare(`UPDATE stages SET ${sets.join(",")} WHERE id=?`).bind(...vals, String(req.id)).run();
      return {ok: true};
    }
    case "delete_stage":
      await env.DB.batch([env.DB.prepare("DELETE FROM stages WHERE id=?").bind(String(req.id)),
        env.DB.prepare("DELETE FROM blobs WHERE id=?").bind(String(req.id))]);
      return {ok: true};
    case "heat": {
      const {results} = await env.DB.prepare("SELECT x,y,hit FROM clicks WHERE stage=?").bind(String(req.id)).all();
      const pl = await env.DB.prepare("SELECT COUNT(DISTINCT who) AS n FROM clicks WHERE stage=?").bind(String(req.id)).first();
      return {ok: true, clicks: results.map((r) => [r.x, r.y, !!r.hit]), players: pl ? pl.n : 0};
    }
    case "get_settings": { const s = await settings(env); delete s._empty; return {ok: true, settings: s}; }
    case "set_settings": await saveSettings(env, req.settings || {}); return {ok: true};
    case "objects": {
      const {results} = await env.DB.prepare("SELECT id,name,length_m,type FROM objects ORDER BY name").all();
      return {ok: true, objects: results};
    }
    case "object": {
      const r = await env.DB.prepare("SELECT data FROM objects WHERE id=?").bind(String(req.id)).first();
      if (!r) throw new HttpError("Обʼєкт не знайдено");
      return {ok: true, mime: "image/png", data: r.data};
    }
    case "object_upload": {
      if (!req.data || req.data.length > 1_900_000) throw new HttpError("PNG техніки завеликий (до ~1,4 МБ)");
      const o = {id: newId(), name: String(req.name || "техніка").slice(0, 40), length_m: Number(req.length_m) || 7, type: String(req.type || "")};
      await env.DB.prepare("INSERT INTO objects (id,name,length_m,type,data,created) VALUES (?,?,?,?,?,?)")
        .bind(o.id, o.name, o.length_m, o.type, String(req.data), new Date().toISOString()).run();
      return {ok: true, object: o};
    }
    case "object_delete": await env.DB.prepare("DELETE FROM objects WHERE id=?").bind(String(req.id)).run(); return {ok: true};
  }
  throw new HttpError("Невідома дія");
}

async function submit(env, ctx, req) {
  const when = req.date || new Date().toISOString().slice(0, 16).replace("T", " ");
  const cs = String(req.callsign || "").slice(0, 40);
  const scores = (req.scores || []).slice(0, MAX_ROUNDS).map(Number);
  const total = scores.reduce((a, b) => a + b, 0);
  const max = Number(req.max) || scores.length * 10;
  const pct = max ? Math.round(100 * total / max) : 0;
  const st = [env.DB.prepare("INSERT INTO results (ts,callsign,total,max,pct,conclusion,scores) VALUES (?,?,?,?,?,?,?)")
    .bind(when, cs, total, max, pct, String(req.conclusion || ""), JSON.stringify(scores))];
  const who = (await hmac(env, "who." + cs)).slice(0, 10); // позивний у кліках не зберігаємо
  (req.clicks || []).slice(0, 500).forEach((c) => st.push(env.DB.prepare("INSERT INTO clicks (stage,x,y,hit,ts,who) VALUES (?,?,?,?,?,?)")
    .bind(String(c[0]), Math.round(c[1]), Math.round(c[2]), c[3] ? 1 : 0, when, who)));
  await env.DB.batch(st);
  if (env.SHEETS_URL && env.SHEETS_SECRET) {
    const body = Object.assign({}, req, {action: "ingest", secret: env.SHEETS_SECRET, p: undefined, t: undefined});
    ctx.waitUntil(gas(env, body).catch(() => {}));
  }
  return {ok: true};
}

// ------------------------------------------------------------------ знімки
async function getImage(env, ctx, request, id, t) {
  if (!await checkToken(env, t, "player")) return new Response("Потрібен вхід", {status: 403});
  const cache = caches.default;
  const key = new Request(new URL(`/api/img/${id}`, request.url).toString());
  let res = await cache.match(key);
  if (!res) {
    const st = await env.DB.prepare("SELECT chunks, size, ready FROM stages WHERE id=?").bind(id).first();
    if (!st || !st.ready) return new Response("Етап не знайдено", {status: 404});
    const parts = [];
    for (let i = 0; i < st.chunks; i++) {
      const r = await env.DB.prepare("SELECT data FROM blobs WHERE id=? AND part=?").bind(id, i).first();
      if (!r) return new Response("Знімок пошкоджено", {status: 500});
      parts.push(r.data instanceof ArrayBuffer ? new Uint8Array(r.data) : new Uint8Array(r.data));
    }
    res = new Response(new Blob(parts), {headers: {"Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable"}});
    ctx.waitUntil(cache.put(key, res.clone()).catch(() => {}));
  }
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, max-age=43200");
  return out;
}

async function putBlob(env, request, id, part) {
  if (!await checkToken(env, request.headers.get("X-Token"), "admin")) return json({ok: false, error: "Потрібен вхід адміністратора"}, 403);
  const st = await env.DB.prepare("SELECT chunks FROM stages WHERE id=?").bind(id).first();
  if (!st || part < 0 || part >= st.chunks) return json({ok: false, error: "Невірна частина"}, 400);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > CHUNK) return json({ok: false, error: "Частина завелика"}, 400);
  await env.DB.prepare("INSERT INTO blobs (id,part,data) VALUES (?,?,?) ON CONFLICT(id,part) DO UPDATE SET data=excluded.data").bind(id, part, buf).run();
  return json({ok: true});
}

// ------------------------------------------------------------------ точка входу
export async function onRequest(context) {
  const {request, env} = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  try {
    await db(env);
    if (request.method === "GET" && path[0] === "img" && path[1]) return await getImage(env, context, request, path[1], url.searchParams.get("t"));
    if (request.method === "PUT" && path[0] === "blob" && path[1]) return await putBlob(env, request, path[1], Number(path[2]));
    if (request.method === "GET") return json({ok: true, app: "poshuk", version: VERSION});
    if (request.method !== "POST") return json({ok: false, error: "Метод не підтримується"}, 405);
    let req;
    try { req = JSON.parse(await request.text()); } catch (e) { return json({ok: false, error: "Некоректний запит"}); }
    return json(await action(env, context, req, url.origin));
  } catch (e) {
    return json({ok: false, error: String(e && e.message || e)}, e instanceof HttpError ? e.status : 200);
  }
}
