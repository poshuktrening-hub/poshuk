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
  rounds_per_game: "5", time_limit_sec: "180", misses_allowed: "1", grid_cols: "8", zoom_click: "5", report: "TRUE",
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
  `CREATE TABLE IF NOT EXISTS card_photos (id TEXT PRIMARY KEY, data TEXT, mime TEXT, updated TEXT)`,
  `CREATE TABLE IF NOT EXISTS answers (ts TEXT, callsign TEXT, kind TEXT, mode TEXT, item TEXT, name TEXT, cat TEXT, ok INTEGER)`,
  `CREATE INDEX IF NOT EXISTS answers_ts ON answers (ts)`,
  `CREATE TABLE IF NOT EXISTS ref_entries (id TEXT PRIMARY KEY, ord INTEGER, cat TEXT, name TEXT, ttx TEXT, descr TEXT, imgs TEXT, updated TEXT)`,
  `CREATE TABLE IF NOT EXISTS ref_images (id TEXT PRIMARY KEY, data TEXT, mime TEXT, updated TEXT)`,
];

class HttpError extends Error { constructor(msg, status = 200) { super(msg); this.status = status; } }

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: Object.assign({"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}, extra),
});

// ------------------------------------------------------------------ база
let schemaReady = false;
async function db(env) {
  if (!env.DB) throw new HttpError("База D1 не підключена (Settings → Functions → D1 binding: DB)");
  if (!schemaReady) {
    await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
    try { await env.DB.prepare("ALTER TABLE objects ADD COLUMN ttx TEXT").run(); } catch (e) { /* колонка вже є */ }
    try { await env.DB.prepare("ALTER TABLE objects ADD COLUMN decoy INTEGER DEFAULT 0").run(); } catch (e) { /* колонка вже є */ }
    try { await env.DB.prepare("ALTER TABLE stages ADD COLUMN meta TEXT").run(); } catch (e) { /* колонка вже є */ }
    try { await env.DB.prepare("ALTER TABLE results ADD COLUMN mode TEXT").run(); } catch (e) { /* колонка вже є */ }
    try { await env.DB.prepare("ALTER TABLE card_photos ADD COLUMN credit TEXT").run(); } catch (e) { /* колонка вже є */ }
    // архів: записи не видаляються, а позначаються archived=1 і більше не рахуються в аналітиці, топі й теплових картах
    for (const t of ["results", "answers", "clicks"]) { try { await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN archived INTEGER DEFAULT 0`).run(); } catch (e) { /* колонка вже є */ } }
    schemaReady = true;
  }
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

async function saveSettings(env, vals, lenient = false) {
  const st = [];
  for (const k of Object.keys(DEFAULTS)) {
    if (vals[k] === undefined) continue;
    const v = String(vals[k]).trim();
    if (!lenient && /password/.test(k) && v.length < 6) throw new HttpError("Пароль має бути не коротший за 6 символів");
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

/* Перший вхід: якщо налаштувань ще немає, пароль адміна перевіряє Google-скрипт і віддає налаштування.
   Повертає null при успіху або текст помилки. */
async function bootstrap(env, p) {
  if (!env.SHEETS_URL) return "Не задано SHEETS_URL";
  if (!p) return "Введіть пароль";
  let j;
  try { j = await gas(env, {action: "get_settings", p}); } catch (e) { return "Google-скрипт недоступний"; }
  if (!j || !j.ok) return (j && j.error) || "Помилка Google-скрипта";
  const vals = {};
  Object.keys(DEFAULTS).forEach((k) => { if (j.settings[k] !== undefined && j.settings[k] !== "") vals[k] = j.settings[k]; });
  await saveSettings(env, vals, true); // паролі з таблиці беремо як є, навіть короткі
  return null;
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
  if (s._empty) {
    const err = await bootstrap(env, p);
    if (err) {
      if (/спроб/i.test(err)) throw new HttpError("Google-скрипт тимчасово заблокував вхід після невдалих спроб. Спробуйте за 15 хвилин.");
      throw new HttpError("Сайт ще не налаштований. Адміністратору: увійдіть в адмінку (кнопка «Адмінка») паролем адміна з Google-таблиці — налаштування перенесуться автоматично. (" + err + ")");
    }
    s = await settings(env);
  }
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
  let meta = {};
  try { meta = JSON.parse(r.meta || "{}"); } catch (e) { meta = {}; }
  return {id: r.id, title: r.title, enabled: !!r.enabled, w: r.w || 0, h: r.h || 0, targets, task: meta.task || "", direction: meta.direction || "", season: meta.season || "", gsd: Number(meta.gsd) || 0, hard: !!meta.hard};
}

async function stages(env, all) {
  const {results} = await env.DB.prepare("SELECT id,title,enabled,w,h,targets,meta FROM stages WHERE ready=1 ORDER BY created").all();
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
      const {results: objs} = await env.DB.prepare("SELECT id,name,length_m,type,ttx,decoy FROM objects").all();
      const {results: cp} = await env.DB.prepare("SELECT id,updated,credit FROM card_photos").all();
      return {ok: true, settings: publicSettings(await settings(env)), stages: await stages(env, false), objects: objs, cardPhotos: cp.map((r) => [r.id, r.updated]),
        cardCredits: cp.filter((r) => r.credit).map((r) => [r.id, r.credit]), token: await makeToken(env, role)};
    }
    case "submit": { await auth(env, req, "player"); return submit(env, ctx, req); }
    case "ref_list": {
      await auth(env, req, "player");
      const {results} = await env.DB.prepare("SELECT id, ord, cat, name, ttx, descr, imgs, updated FROM ref_entries ORDER BY ord").all();
      return {ok: true, entries: results.map((r) => ({id: r.id, ord: r.ord, cat: r.cat, name: r.name, ttx: r.ttx, desc: r.descr, imgs: JSON.parse(r.imgs || "[]"), v: r.updated}))};
    }
    case "top": { await auth(env, req, "player"); return {ok: true, top: await top3(env, String(req.since || "0000"))}; }
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
      const r = await env.DB.prepare("SELECT id,title,enabled,w,h,targets,meta FROM stages WHERE id=?").bind(String(req.id)).first();
      return {ok: true, stage: rowToStage(r)};
    }
    case "save_stage": {
      const sets = [], vals = [];
      if (req.title !== undefined) { sets.push("title=?"); vals.push(String(req.title).slice(0, 120)); }
      if (req.enabled !== undefined) { sets.push("enabled=?"); vals.push(req.enabled ? 1 : 0); }
      if (req.targets !== undefined) { sets.push("targets=?"); vals.push(JSON.stringify(req.targets)); }
      if (["task", "direction", "season", "gsd", "hard"].some((k) => req[k] !== undefined)) {   // мета зливається: незмінені поля лишаються
        const cur = await env.DB.prepare("SELECT meta FROM stages WHERE id=?").bind(String(req.id)).first();
        let m = {}; try { m = JSON.parse((cur && cur.meta) || "{}"); } catch (e) { m = {}; }
        if (req.task !== undefined) m.task = String(req.task || "").slice(0, 400);
        if (req.direction !== undefined) m.direction = String(req.direction || "").slice(0, 40);
        if (req.season !== undefined) m.season = String(req.season || "").slice(0, 10);
        if (req.gsd !== undefined) m.gsd = Math.max(0, Math.min(10, Number(req.gsd) || 0));
        if (req.hard !== undefined) m.hard = !!req.hard;
        delete m.unit;
        sets.push("meta=?"); vals.push(JSON.stringify(m));
      }
      if (sets.length) await env.DB.prepare(`UPDATE stages SET ${sets.join(",")} WHERE id=?`).bind(...vals, String(req.id)).run();
      return {ok: true};
    }
    case "delete_stage":
      await env.DB.batch([env.DB.prepare("DELETE FROM stages WHERE id=?").bind(String(req.id)),
        env.DB.prepare("DELETE FROM blobs WHERE id=?").bind(String(req.id))]);
      return {ok: true};
    case "heat": {
      const {results} = await env.DB.prepare("SELECT x,y,hit FROM clicks WHERE stage=? AND COALESCE(archived,0)=0").bind(String(req.id)).all();
      const pl = await env.DB.prepare("SELECT COUNT(DISTINCT who) AS n FROM clicks WHERE stage=? AND COALESCE(archived,0)=0").bind(String(req.id)).first();
      return {ok: true, clicks: results.map((r) => [r.x, r.y, !!r.hit]), players: pl ? pl.n : 0};
    }
    case "get_settings": { const s = await settings(env); delete s._empty; return {ok: true, settings: s}; }
    case "set_settings": await saveSettings(env, req.settings || {}); return {ok: true};
    case "objects": {
      await dedupeObjects(env);
      const {results} = await env.DB.prepare("SELECT id,name,length_m,type,ttx,decoy FROM objects ORDER BY name").all();
      return {ok: true, objects: results};
    }
    case "object": {
      const data = await objData(env, String(req.id));
      if (data === null) throw new HttpError("Обʼєкт не знайдено");
      return {ok: true, mime: "image/png", data};
    }
    case "object_upload": {
      // модель зберігається частинами (D1 тримає до ~2 МБ у рядку) — ліміт розміру фактично знято
      if (!req.data || typeof req.data !== "string") throw new HttpError("Немає файлу моделі");
      if (req.data.length > OBJ_MAX) throw new HttpError("Модель завелика (понад ~20 МБ) — зменште її");
      const o = {id: newId(), name: String(req.name || "техніка").slice(0, 40), length_m: Number(req.length_m) || 7, type: String(req.type || ""), ttx: String(req.ttx || "").slice(0, 2000), decoy: req.decoy ? 1 : 0};
      // без дублів: модель з такою самою назвою — оновлюється (нова версія замість старої)
      const {results: same} = await env.DB.prepare("SELECT id,name,decoy,ttx FROM objects").all();
      const old = same.find((x) => normName(x.name) === normName(o.name) && (x.decoy ? 1 : 0) === o.decoy);
      const id = old ? old.id : o.id;
      const col = await objPut(env, id, req.data);
      if (old) {
        await env.DB.prepare("UPDATE objects SET name=?, length_m=?, type=?, data=?, created=?, ttx=? WHERE id=?")
          .bind(o.name, o.length_m, o.type, col, new Date().toISOString(), o.ttx || old.ttx || "", old.id).run();
        await purgeObjCache(origin, old.id);
        return {ok: true, replaced: true, object: Object.assign(o, {id: old.id, ttx: o.ttx || old.ttx || ""})};
      }
      await env.DB.prepare("INSERT INTO objects (id,name,length_m,type,data,created,ttx,decoy) VALUES (?,?,?,?,?,?,?,?)")
        .bind(o.id, o.name, o.length_m, o.type, col, new Date().toISOString(), o.ttx, o.decoy).run();
      return {ok: true, object: o};
    }
    case "object_update": {
      await env.DB.prepare("UPDATE objects SET name=?, length_m=?, type=?, ttx=?, decoy=COALESCE(?, decoy) WHERE id=?")
        .bind(String(req.name || "техніка").slice(0, 40), Number(req.length_m) || 7, String(req.type || ""), String(req.ttx || "").slice(0, 2000), req.decoy === undefined || req.decoy === null ? null : (req.decoy ? 1 : 0), String(req.id)).run();
      return {ok: true};
    }
    case "analytics": {
      const since = String(req.since || "0000");
      const {results: ans} = await env.DB.prepare("SELECT callsign, kind, cat, name, SUM(ok) ok, COUNT(*) n FROM answers WHERE ts >= ? AND COALESCE(archived,0)=0 GROUP BY callsign, kind, cat, name").bind(since).all();
      const {results: res} = await env.DB.prepare("SELECT callsign, mode, COUNT(*) n, AVG(pct) avg, MAX(ts) last FROM results WHERE ts >= ? AND COALESCE(archived,0)=0 GROUP BY callsign, mode").bind(since).all();
      const {results: list} = await env.DB.prepare("SELECT ts, callsign, mode, total, max, pct, conclusion FROM results WHERE ts >= ? AND COALESCE(archived,0)=0 ORDER BY ts DESC LIMIT 500").bind(since).all();
      const first = await env.DB.prepare("SELECT MIN(ts) t FROM answers WHERE COALESCE(archived,0)=0").first();
      return {ok: true, answers: ans, results: res, list, since: first ? first.t : null};
    }
    case "archive_history": {
      const A = "COALESCE(archived,0)=0";
      const n = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM results WHERE ${A}) r, (SELECT COUNT(*) FROM answers WHERE ${A}) a, (SELECT COUNT(*) FROM clicks WHERE ${A}) c`).first();
      await env.DB.batch(["results", "answers", "clicks"].map((t) => env.DB.prepare(`UPDATE ${t} SET archived=1 WHERE ${A}`)));
      // Google-таблиця: рядки результатів переносяться на сусідній аркуш «Архів»
      let sheet = null;
      if (env.SHEETS_URL && env.SHEETS_SECRET) {
        try { sheet = await gas(env, {action: "archive", secret: env.SHEETS_SECRET}); } catch (e) { sheet = {ok: false, error: String(e.message || e)}; }
      }
      return {ok: true, archived: n, sheet};
    }
    case "ref_put": {   // одна позиція довідника разом із її зображеннями
      const e = req.entry || {}, id = String(e.id || "").slice(0, 40);
      if (!/^[a-z0-9_-]+$/i.test(id)) throw new HttpError("Невірний id позиції");
      const up = new Date().toISOString(), st = [];
      for (const im of (req.images || []).slice(0, 12)) {
        const iid = String(im.id || "").slice(0, 50);
        if (!/^[a-z0-9_-]+$/i.test(iid) || !im.data || im.data.length > 1_900_000) throw new HttpError("Зображення завелике або без id");
        st.push(env.DB.prepare("INSERT OR REPLACE INTO ref_images (id,data,mime,updated) VALUES (?,?,?,?)").bind(iid, String(im.data), String(im.mime || "image/jpeg"), up));
      }
      // фото, які адміністратор прибрав із запису, — видалити з бази
      const old = await env.DB.prepare("SELECT imgs FROM ref_entries WHERE id=?").bind(id).first();
      const now = new Set((e.imgs || []).map(String));
      if (old) JSON.parse(old.imgs || "[]").filter((x) => !now.has(x)).forEach((x) => st.push(env.DB.prepare("DELETE FROM ref_images WHERE id=?").bind(x)));
      st.push(env.DB.prepare("INSERT OR REPLACE INTO ref_entries (id,ord,cat,name,ttx,descr,imgs,updated) VALUES (?,?,?,?,?,?,?,?)")
        .bind(id, Number(e.ord) || 0, String(e.cat || "").slice(0, 80), String(e.name || "").slice(0, 200), String(e.ttx || "").slice(0, 8000),
          String(e.desc || "").slice(0, 20000), JSON.stringify((e.imgs || []).map(String).slice(0, 12)), up));
      await env.DB.batch(st);
      return {ok: true};
    }
    case "ref_delete": {
      const id = String(req.id || "");
      const old = await env.DB.prepare("SELECT imgs FROM ref_entries WHERE id=?").bind(id).first();
      if (!old) throw new HttpError("Запис не знайдено");
      await env.DB.batch([env.DB.prepare("DELETE FROM ref_entries WHERE id=?").bind(id),
        ...JSON.parse(old.imgs || "[]").map((x) => env.DB.prepare("DELETE FROM ref_images WHERE id=?").bind(String(x)))]);
      return {ok: true};
    }
    case "ref_prune": {   // після імпорту: прибрати позиції й зображення, яких немає в новій версії довідника
      const keep = new Set((req.keep || []).map(String));
      const {results} = await env.DB.prepare("SELECT id, imgs FROM ref_entries").all();
      const keepImg = new Set(), st = [];
      for (const r of results) { if (keep.has(r.id)) JSON.parse(r.imgs || "[]").forEach((x) => keepImg.add(x)); else st.push(env.DB.prepare("DELETE FROM ref_entries WHERE id=?").bind(r.id)); }
      const {results: ims} = await env.DB.prepare("SELECT id FROM ref_images").all();
      for (const r of ims) if (!keepImg.has(r.id)) st.push(env.DB.prepare("DELETE FROM ref_images WHERE id=?").bind(r.id));
      if (st.length) await env.DB.batch(st);
      return {ok: true, removed: st.length};
    }
    case "card_photos": {
      const {results} = await env.DB.prepare("SELECT id,updated,credit FROM card_photos").all();
      return {ok: true, photos: results.map((r) => [r.id, r.updated]), credits: results.filter((r) => r.credit).map((r) => [r.id, r.credit])};
    }
    case "card_photo_upload": {
      const id = String(req.id || "").slice(0, 40);
      if (!/^[a-z0-9_]+$/.test(id)) throw new HttpError("Невірний id картки");
      if (!req.data || req.data.length > 1_900_000) throw new HttpError("Фото завелике (до ~1,4 МБ)");
      const up = new Date().toISOString();
      await env.DB.prepare("INSERT OR REPLACE INTO card_photos (id,data,mime,updated,credit) VALUES (?,?,?,?,?)").bind(id, String(req.data), String(req.mime || "image/jpeg"), up, String(req.credit || "").slice(0, 400)).run();
      return {ok: true, updated: up};
    }
    case "card_photo_delete": await env.DB.prepare("DELETE FROM card_photos WHERE id=?").bind(String(req.id)).run(); return {ok: true};
    case "object_delete":
      await env.DB.batch([env.DB.prepare("DELETE FROM objects WHERE id=?").bind(String(req.id)), env.DB.prepare("DELETE FROM blobs WHERE id=?").bind("obj_" + String(req.id))]);
      return {ok: true};
  }
  throw new HttpError("Невідома дія");
}

/* Моделі техніки: base64 PNG. До OBJ_PART — у самому рядку objects, більше — частинами в blobs ("obj_<id>"). */
const OBJ_PART = 1_500_000, OBJ_MAX = 28_000_000;
async function objPut(env, id, data) {
  const bid = "obj_" + id;
  await env.DB.prepare("DELETE FROM blobs WHERE id=?").bind(bid).run();
  if (data.length <= OBJ_PART) return data;
  const n = Math.ceil(data.length / OBJ_PART);
  for (let i = 0; i < n; i++)
    await env.DB.prepare("INSERT INTO blobs (id,part,data) VALUES (?,?,?)").bind(bid, i, data.slice(i * OBJ_PART, (i + 1) * OBJ_PART)).run();
  return "@parts:" + n;
}
async function objData(env, id) {
  const r = await env.DB.prepare("SELECT data FROM objects WHERE id=?").bind(id).first();
  if (!r) return null;
  const m = /^@parts:(\d+)$/.exec(String(r.data || ""));
  if (!m) return r.data;
  const {results} = await env.DB.prepare("SELECT part, data FROM blobs WHERE id=? ORDER BY part").bind("obj_" + id).all();
  if (results.length !== Number(m[1])) return null;
  return results.map((x) => typeof x.data === "string" ? x.data : new TextDecoder().decode(new Uint8Array(x.data))).join("");
}
async function purgeObjCache(origin, id) {
  try { await caches.default.delete(new Request(new URL(`/api/obj/${id}`, origin).toString())); } catch (e) { /* кеш не критичний */ }
}

/* Назва моделі для порівняння: регістр, пробіли/підкреслення, «(2)», «копія» не важать. */
function normName(s) {
  return String(s || "").toLowerCase().replace(/[_\s]+/g, " ").replace(/\s*\(\d+\)\s*$/, "").replace(/\s*[-–]?\s*(копія|copy)(\s*\d+)?\s*$/, "").trim();
}

/* Прибрати дублі в бібліотеці: лишається найновіша версія, цілі в етапах переводяться на неї. */
async function dedupeObjects(env) {
  const {results} = await env.DB.prepare("SELECT id,name,decoy,created FROM objects").all();
  const keep = new Map(), remap = new Map();
  results.sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
  for (const o of results) {
    const k = normName(o.name) + "|" + (o.decoy ? 1 : 0);
    if (keep.has(k)) remap.set(o.id, keep.get(k)); else keep.set(k, o.id);
  }
  if (!remap.size) return 0;
  const {results: st} = await env.DB.prepare("SELECT id,targets FROM stages").all();
  const ops = [];
  for (const s of st) {
    let t; try { t = JSON.parse(s.targets || "[]"); } catch (e) { continue; }
    let ch = false;
    t.forEach((x) => { if (x && remap.has(x.obj)) { x.obj = remap.get(x.obj); ch = true; } });
    if (ch) ops.push(env.DB.prepare("UPDATE stages SET targets=? WHERE id=?").bind(JSON.stringify(t), s.id));
  }
  for (const id of remap.keys()) ops.push(env.DB.prepare("DELETE FROM objects WHERE id=?").bind(id), env.DB.prepare("DELETE FROM blobs WHERE id=?").bind("obj_" + id));
  await env.DB.batch(ops);
  return remap.size;
}

/* Топ-3 для головного меню: найкращий результат кожного позивного окремо для «Пошуку цілей» і «Карток». */
async function top3(env, since = "0000") {   // since — початок доби за часом курсанта («YYYY-MM-DD 00:00»)
  const {results} = await env.DB.prepare("SELECT callsign, mode, pct, ts, conclusion FROM results WHERE COALESCE(archived,0)=0 AND ts >= ? ORDER BY ts DESC LIMIT 5000").bind(since).all();
  const out = {search: new Map(), cards: new Map()};
  for (const r of results) {
    const name = String(r.callsign || "").trim(); if (!name) continue;
    const kind = /^cards/.test(r.mode || "") || /^Картки/.test(r.conclusion || "") ? "cards" : "search";
    const key = name.toLowerCase(), m = out[kind], cur = m.get(key);
    if (!cur) m.set(key, {name, best: r.pct, ts: r.ts, n: 1});
    else { cur.n++; if (r.pct > cur.best || (r.pct === cur.best && r.ts < cur.ts)) { cur.best = r.pct; cur.ts = r.ts; } }
  }
  const pick = (m) => [...m.values()].sort((a, b) => b.best - a.best || b.n - a.n || String(a.ts).localeCompare(String(b.ts))).slice(0, 3).map((x) => ({name: x.name, pct: x.best, n: x.n}));
  return {search: pick(out.search), cards: pick(out.cards)};
}

async function submit(env, ctx, req) {
  const when = req.date || new Date().toISOString().slice(0, 16).replace("T", " ");
  const cs = String(req.callsign || "").slice(0, 40);
  const scores = (req.scores || []).slice(0, MAX_ROUNDS).map(Number);
  const total = scores.reduce((a, b) => a + b, 0);
  const max = Number(req.max) || scores.length * 10;
  const pct = max ? Math.round(100 * total / max) : 0;
  const st = [env.DB.prepare("INSERT INTO results (ts,callsign,total,max,pct,conclusion,scores,mode) VALUES (?,?,?,?,?,?,?,?)")
    .bind(when, cs, total, max, pct, String(req.conclusion || "").slice(0, 120), JSON.stringify(scores), String(req.mode || "game").slice(0, 10))];
  // відповіді по кожній цілі/картці — для аналітики інструктора (слабкі місця по категоріях техніки)
  (req.items || []).slice(0, 200).forEach((it) => {
    if (!Array.isArray(it)) return;
    const s = (v, n) => String(v == null ? "" : v).slice(0, n);
    st.push(env.DB.prepare("INSERT INTO answers (ts,callsign,kind,mode,item,name,cat,ok) VALUES (?,?,?,?,?,?,?,?)")
      .bind(when, cs, s(it[0], 10), s(req.mode || "game", 10), s(it[1], 60), s(it[2], 80), s(it[3], 40), it[4] ? 1 : 0));
  });
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

// ------------------------------------------------------------------ зображення техніки для брифінгу курсанта
async function getCardPhoto(env, ctx, request, id, t, v) {
  if (!await checkToken(env, t, "player")) return new Response("Потрібен вхід", {status: 403});
  const cache = caches.default, key = new Request(new URL(`/api/card/${id}?v=${encodeURIComponent(v || "")}`, request.url).toString());
  let res = await cache.match(key);
  if (!res) {
    const r = await env.DB.prepare("SELECT data,mime FROM card_photos WHERE id=?").bind(id).first();
    if (!r) return new Response("Не знайдено", {status: 404});
    const bin = atob(r.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    res = new Response(bytes, {headers: {"Content-Type": r.mime || "image/jpeg", "Cache-Control": "public, max-age=86400"}});
    ctx.waitUntil(cache.put(key, res.clone()).catch(() => {}));
  }
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, max-age=86400");
  return out;
}

async function getRefImage(env, ctx, request, id, t, v) {
  if (!await checkToken(env, t, "player")) return new Response("Потрібен вхід", {status: 403});
  const cache = caches.default, key = new Request(new URL(`/api/ref/${id}?v=${encodeURIComponent(v || "")}`, request.url).toString());
  let res = await cache.match(key);
  if (!res) {
    const r = await env.DB.prepare("SELECT data,mime FROM ref_images WHERE id=?").bind(id).first();
    if (!r) return new Response("Не знайдено", {status: 404});
    const bin = atob(r.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    res = new Response(bytes, {headers: {"Content-Type": r.mime || "image/jpeg", "Cache-Control": "public, max-age=604800"}});
    ctx.waitUntil(cache.put(key, res.clone()).catch(() => {}));
  }
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, max-age=604800");
  return out;
}

async function getObject(env, ctx, request, id, t) {
  if (!await checkToken(env, t, "player")) return new Response("Потрібен вхід", {status: 403});
  const cache = caches.default, key = new Request(new URL(`/api/obj/${id}`, request.url).toString());
  let res = await cache.match(key);
  if (!res) {
    const data = await objData(env, id);
    if (data === null) return new Response("Не знайдено", {status: 404});
    const bin = atob(data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    res = new Response(bytes, {headers: {"Content-Type": "image/png", "Cache-Control": "public, max-age=3600"}});
    ctx.waitUntil(cache.put(key, res.clone()).catch(() => {}));
  }
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, max-age=3600");
  return out;
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
    if (request.method === "GET" && path[0] === "obj" && path[1]) return await getObject(env, context, request, path[1], url.searchParams.get("t"));
    if (request.method === "GET" && path[0] === "card" && path[1]) return await getCardPhoto(env, context, request, path[1], url.searchParams.get("t"), url.searchParams.get("v"));
    if (request.method === "GET" && path[0] === "ref" && path[1]) return await getRefImage(env, context, request, path[1], url.searchParams.get("t"), url.searchParams.get("v"));
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
