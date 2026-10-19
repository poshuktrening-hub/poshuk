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
import {fillTick, fillState, fillReset, fillInfo, fillOne} from "./photofill.js";
import {cardPics, linked, putCardImg, delCardImg, setLinks, migrateLegacy, isGameImg, rememberReject} from "./cardref.js";
const VERSION = "cf-1.0";
const MAX_ROUNDS = 10;
const LOCK_FAILS = 20, LOCK_SECONDS = 15 * 60;       // невдалі входи з однієї адреси за 15 хв → ця адреса чекає 15 хв (клас за одним Wi-Fi — одна адреса, тому не менше)
const GLOBAL_FAILS = 150;                             // невдалі входи з усіх адрес за 15 хв → нові входи паролем чекають 15 хв (токени працюють)
const RATE = {api: [300, 60e3], img: [900, 60e3], login: [60, 60e3], heavy: [40, 60e3]};   // запитів з однієї адреси за вікно (мс)
const MAX_BODY = 30e6;                                // байт у POST-запиті (імпорт довідника, фото)
const CHUNK = 1_500_000; // < 2 МБ — ліміт рядка D1
const TOKEN_HOURS = 12;
const DEFAULTS = {
  player_password: "змініть-мене-курсант", admin_password: "змініть-мене-адмін",
  rounds_per_game: "10", time_limit_sec: "180", misses_allowed: "1", grid_cols: "8", zoom_click: "5", report: "TRUE",
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
  `CREATE TABLE IF NOT EXISTS callsign_owner (cs TEXT PRIMARY KEY, dev TEXT, ts TEXT)`,
  `CREATE TABLE IF NOT EXISTS ref_suggest (id TEXT PRIMARY KEY, ts TEXT, callsign TEXT, dev TEXT, kind TEXT, target TEXT, data TEXT, imgs TEXT)`,
  `CREATE INDEX IF NOT EXISTS answers_ts ON answers (ts)`,
  `CREATE TABLE IF NOT EXISTS ref_entries (id TEXT PRIMARY KEY, ord INTEGER, cat TEXT, name TEXT, ttx TEXT, descr TEXT, imgs TEXT, updated TEXT)`,
  `CREATE TABLE IF NOT EXISTS ref_images (id TEXT PRIMARY KEY, data TEXT, mime TEXT, updated TEXT)`,
  // бекап знімка етапу перед перерендером: частини лежать у blobs під id "bak_<етап>", тут — цілі й розмір
  // дуель на двох: кімната за 4-значним кодом; uN — техніка гравця N (координати бачить лише сервер), shots — усі удари
  `CREATE TABLE IF NOT EXISTS duels (code TEXT PRIMARY KEY, created INTEGER, state TEXT, map TEXT, gsd REAL, kit TEXT,
     p1 TEXT, p2 TEXT, s1 TEXT, s2 TEXT, u1 TEXT, u2 TEXT, c1 INTEGER DEFAULT 0, c2 INTEGER DEFAULT 0, r1 INTEGER DEFAULT 0, r2 INTEGER DEFAULT 0,
     seen1 INTEGER DEFAULT 0, seen2 INTEGER DEFAULT 0, l1 INTEGER DEFAULT 0, l2 INTEGER DEFAULT 0, turn INTEGER DEFAULT 0, until INTEGER DEFAULT 0, shots TEXT, winner INTEGER DEFAULT 0, reason TEXT)`,
  `CREATE TABLE IF NOT EXISTS stage_backups (id TEXT PRIMARY KEY, targets TEXT, size INTEGER, chunks INTEGER, created TEXT)`,
  // ознаки на фото довідника: прямокутники з підписами (частки від розміру зображення) — показуються після відповіді в картках
  `CREATE TABLE IF NOT EXISTS ref_marks (img TEXT PRIMARY KEY, marks TEXT, updated TEXT)`,
];

/* Адреса клієнта (Cloudflare підставляє справжню) — для лімітів і блокування перебору пароля. */
const ipOf = (request) => request.headers.get("CF-Connecting-IP") || (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() || "local";
const ipKey = (ip) => ip.replace(/[^0-9a-f.:]/gi, "").slice(0, 60);

/* Лічильники в пам'яті ізоляту: дешево (без запитів до бази). Кожен дата-центр рахує окремо,
   тому це перший рубіж; невдалі входи додатково зберігаються в базі (див. loginFail). */
const buckets = new Map();
function rateLimit(ip, kind) {
  const [limit, win] = RATE[kind], now = Date.now(), k = kind + "|" + ip;
  let b = buckets.get(k);
  if (!b || now - b.t0 > win) { b = {t0: now, n: 0}; buckets.set(k, b); }
  if (++b.n > limit) throw new HttpError("Забагато запитів. Зачекайте хвилину.", 429);
  if (buckets.size > 5000) for (const [key, v] of buckets) if (now - v.t0 > win) buckets.delete(key);
}
/* Порівняння паролів за сталий час (щоб за часом відповіді не вгадувати символи). */
function safeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Невдалі входи: за адресою (8 за 15 хв → адреса чекає 15 хв) і загалом (150 за 15 хв → нові входи паролем чекають).
   Токени, видані раніше, працюють і під час блокування — курсантам у грі це не заважає. */
async function loginLocked(env, ip) {
  const now = Date.now();
  const g = jp(await metaGet(env, "fails_g"), {});
  if (g.until > now) return "Забагато невдалих спроб входу. Спробуйте за 15 хвилин.";
  const r = jp(await metaGet(env, "fails_" + ipKey(ip)), {});
  if (r.until > now) return "Забагато невдалих спроб з вашої адреси. Спробуйте за 15 хвилин.";
  return null;
}
async function loginFail(env, ip, p) {
  const now = Date.now(), win = LOCK_SECONDS * 1000;
  const k = "fails_" + ipKey(ip), r = jp(await metaGet(env, k), {});
  // той самий невірний пароль повторно (старий пароль на телефоні, повтор тієї ж одруківки) — рахуємо один раз
  const h = (await hmac(env, "fp." + String(p || ""))).slice(0, 12), seen = r.t0 && now - r.t0 < win ? (r.h || []) : [];
  if (seen.includes(h)) { await sleep(400 + Math.random() * 400); return; }
  const n = (r.t0 && now - r.t0 < win ? r.n : 0) + 1;
  await metaSet(env, k, JSON.stringify({t0: r.t0 && now - r.t0 < win ? r.t0 : now, n, until: n >= LOCK_FAILS ? now + win : 0, h: seen.concat(h).slice(-30)}));
  const g = jp(await metaGet(env, "fails_g"), {});
  const gn = (g.t0 && now - g.t0 < win ? g.n : 0) + 1;
  await metaSet(env, "fails_g", JSON.stringify({t0: g.t0 && now - g.t0 < win ? g.t0 : now, n: gn, until: gn >= GLOBAL_FAILS ? now + win : 0}));
  await sleep(400 + Math.random() * 400);   // перебір стає повільним
}
async function loginOk(env, ip) {
  const k = "fails_" + ipKey(ip);
  if (await metaGet(env, k)) await env.DB.prepare("DELETE FROM meta WHERE k=?").bind(k).run();
}

function cookieOf(request, name) {
  const m = String(request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}

class HttpError extends Error { constructor(msg, status = 200) { super(msg); this.status = status; } }

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: Object.assign({"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}, extra),
});

// ------------------------------------------------------------------ база
const SCHEMA_V = "2026-10-19a";   // змінюйте, коли додаєте таблиці/колонки/індекси — тоді міграція виконається ще раз
let schemaReady = false;
async function db(env) {
  if (!env.DB) throw new HttpError("База D1 не підключена (Settings → Functions → D1 binding: DB)");
  if (!schemaReady) {
    let have = null;
    try { have = (await env.DB.prepare("SELECT v FROM meta WHERE k='schema_v'").first() || {}).v; } catch (e) { have = null; }   // нова база — таблиці meta ще немає
    if (have === SCHEMA_V) { schemaReady = true; return env.DB; }
    await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
    try { await env.DB.prepare("ALTER TABLE objects ADD COLUMN ttx TEXT").run(); } catch (e) { /* колонка вже є */ }
    try { await env.DB.prepare("ALTER TABLE objects ADD COLUMN decoy INTEGER DEFAULT 0").run(); } catch (e) { /* колонка вже є */ }
    try { await env.DB.prepare("ALTER TABLE stages ADD COLUMN meta TEXT").run(); } catch (e) { /* колонка вже є */ }
    try { await env.DB.prepare("ALTER TABLE results ADD COLUMN mode TEXT").run(); } catch (e) { /* колонка вже є */ }
    try { await env.DB.prepare("ALTER TABLE card_photos ADD COLUMN credit TEXT").run(); } catch (e) { /* колонка вже є */ }
    // одна фотобаза: запис довідника знає свою картку, фото довідника — своє джерело (автор/ліцензія)
    try { await env.DB.prepare("ALTER TABLE ref_entries ADD COLUMN card TEXT").run(); } catch (e) { /* колонка вже є */ }
    try { await env.DB.prepare("ALTER TABLE ref_images ADD COLUMN credit TEXT").run(); } catch (e) { /* колонка вже є */ }
    try { await env.DB.prepare("CREATE INDEX IF NOT EXISTS ref_card ON ref_entries (card)").run(); } catch (e) { /* є */ }
    // архів: записи не видаляються, а позначаються archived=1 і більше не рахуються в аналітиці, топі й теплових картах
    for (const c of ["l1", "l2"]) { try { await env.DB.prepare(`ALTER TABLE duels ADD COLUMN ${c} INTEGER DEFAULT 0`).run(); } catch (e) { /* колонка вже є */ } }
    for (const c of ["crop", "dims", "hints"]) { try { await env.DB.prepare(`ALTER TABLE duels ADD COLUMN ${c} TEXT`).run(); } catch (e) { /* колонка вже є */ } }
    try { await env.DB.prepare("ALTER TABLE duels ADD COLUMN purged INTEGER DEFAULT 0").run(); } catch (e) { /* колонка вже є */ }
    for (const t of ["results", "answers", "clicks"]) { try { await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN archived INTEGER DEFAULT 0`).run(); } catch (e) { /* колонка вже є */ } }
    // індекси для гарячих запитів (топ дня, робота над помилками, мої результати) — менше прочитаних рядків D1
    for (const q of ["CREATE INDEX IF NOT EXISTS results_ts ON results (ts)", "CREATE INDEX IF NOT EXISTS results_cs ON results (callsign, ts)", "CREATE INDEX IF NOT EXISTS answers_cs ON answers (callsign, ts)"]) {
      try { await env.DB.prepare(q).run(); } catch (e) { /* є */ }
    }
    await env.DB.prepare("INSERT INTO meta (k,v) VALUES ('schema_v',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(SCHEMA_V).run();
    schemaReady = true;
  }
  return env.DB;
}

async function metaGet(env, k) { const r = await env.DB.prepare("SELECT v FROM meta WHERE k=?").bind(k).first(); return r ? r.v : null; }
async function metaSet(env, k, v) { await env.DB.prepare("INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(v)).run(); }
/* Ознаки на фото: {id фото: [{x,y,w,h,t}]} — у конфігурації та довіднику (офлайн-версія отримує їх разом із конфігурацією). */
async function marksAll(env) {
  const {results} = await env.DB.prepare("SELECT img, marks FROM ref_marks").all();
  const out = {};
  for (const r of results) { try { const m = JSON.parse(r.marks || "[]"); if (Array.isArray(m) && m.length) out[r.img] = m; } catch (e) { /* зіпсований запис — пропускаємо */ } }
  return out;
}
/* Перевірка розмітки від адміністратора: до 8 прямокутників у частках 0..1, підпис до 80 символів. */
function cleanMarks(list) {
  const n = (v) => Math.max(0, Math.min(1, Math.round((Number(v) || 0) * 10000) / 10000));
  const out = [];
  for (const m of (Array.isArray(list) ? list : []).slice(0, 8)) {
    if (!m || typeof m !== "object") continue;
    const x = n(m.x), y = n(m.y), w = Math.min(n(m.w), 1 - x), h = Math.min(n(m.h), 1 - y);
    if (w < 0.01 || h < 0.01) continue;
    out.push({x, y, w, h, t: String(m.t || "").trim().slice(0, 80)});
  }
  return out;
}

async function settings(env) {
  // одноразово: у грі — до 10 етапів (раніше типово 5, і частина етапів у гру просто не потрапляла)
  if (!await metaGet(env, "mig_rounds10")) {
    await env.DB.prepare("UPDATE settings SET v='10' WHERE k='rounds_per_game' AND CAST(v AS INTEGER) < 10").run();
    await metaSet(env, "mig_rounds10", "1");
  }
  const {results} = await env.DB.prepare("SELECT k, v FROM settings").all();
  const out = Object.assign({}, DEFAULTS);
  results.forEach((r) => (out[r.k] = r.v));
  out._empty = !results.length;
  return out;
}

function publicSettings(s) {
  const n = (v, d) => (isNaN(Number(v)) || v === "" ? d : Number(v));
  return {
    rounds_per_game: Math.max(1, Math.min(MAX_ROUNDS, n(s.rounds_per_game, MAX_ROUNDS))),
    time_limit_sec: Math.max(10, n(s.time_limit_sec, 60)),
    misses_allowed: Math.max(0, n(s.misses_allowed, 1)),
    grid_cols: Math.max(3, Math.min(20, n(s.grid_cols, 8))),
    zoom_click: Math.max(2, n(s.zoom_click, 5)),
    report: String(s.report).toUpperCase() !== "FALSE",
  };
}

async function saveSettings(env, vals, lenient = false) {
  const st = [], before = await settings(env), bump = [];
  for (const k of Object.keys(DEFAULTS)) {
    if (vals[k] === undefined) continue;
    const v = String(vals[k]).trim();
    if (!lenient && /password/.test(k) && v.length < 6) throw new HttpError("Пароль має бути не коротший за 6 символів");
    if (/password/.test(k) && v !== String(before[k] || "")) bump.push(k === "admin_password" ? "admin" : "player");
    st.push(env.DB.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, v));
  }
  if (st.length) await env.DB.batch(st);
  for (const role of bump) await bumpGen(env, role);   // старі токени цієї ролі — недійсні
}

/* Паролі з Google-таблиці підтягуються самі (раз на 10 хв, у фоні): змінили пароль у таблиці — старий
   перестає діяти на сайті без жодних дій, а пристрої зі старим паролем просять увійти знову. */
let lastSheetCheck = 0;
function sheetSyncTick(env, ctx) {
  if (!env.SHEETS_URL || Date.now() - lastSheetCheck < 5 * 60e3) return;
  lastSheetCheck = Date.now();
  ctx.waitUntil((async () => {
    const at = Number(await metaGet(env, "sheet_sync_at") || 0);
    if (Date.now() - at < 10 * 60e3) return;
    await metaSet(env, "sheet_sync_at", String(Date.now()));
    const s = await settings(env);
    if (s._empty || !s.admin_password) return;
    let j;
    try { j = await gas(env, {action: "get_settings", p: s.admin_password}); } catch (e) { return; }
    if (!j || !j.ok || !j.settings) {
      // пароль адміна в таблиці вже інший — звіримося, коли адмін увійде новим; до того не турбуємо скрипт 6 годин
      await metaSet(env, "sheet_sync_at", String(Date.now() + 6 * 3600e3 - 10 * 60e3));
      return;
    }
    const vals = {};
    for (const k of ["player_password", "admin_password"]) { const v = String(j.settings[k] || "").trim(); if (v && v !== String(s[k] || "")) vals[k] = v; }
    if (Object.keys(vals).length) await saveSettings(env, vals, true);
  })().catch(() => {}));
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

/* Паролі в Google-таблиці (аркуш «Налаштування») — головні: якщо введений пароль не збігся з базою сайту,
   питаємо таблицю; підійшов — сайт оновлює в себе пароль курсантів (і адміна, якщо це пароль адміна). */
async function syncFromSheet(env, p) {
  if (!env.SHEETS_URL || p.length > 200) return null;
  let j;
  try { j = await gas(env, {action: "login", p}); } catch (e) { return null; }
  if (!j || !j.ok || !j.role) return null;
  if (j.role === "admin") {
    const vals = {admin_password: p};
    try { const g = await gas(env, {action: "get_settings", p}); if (g && g.ok && g.settings && g.settings.player_password) vals.player_password = g.settings.player_password; } catch (e) { /* лише пароль адміна */ }
    await saveSettings(env, vals, true);
    return "admin";
  }
  await saveSettings(env, {player_password: p}, true);
  return "player";
}

/* Зміна паролів в адмінці сайту — те саме в таблицю, щоб старий пароль із таблиці не повернувся. */
async function pushPasswordsToSheet(env, oldAdmin, vals) {
  if (!env.SHEETS_URL) return {ok: false, error: "не підключена"};
  const pw = {};
  for (const k of ["player_password", "admin_password"]) if (vals[k] !== undefined) pw[k] = String(vals[k]).trim();
  if (!Object.keys(pw).length) return {ok: true};
  try { const j = await gas(env, {action: "set_settings", p: oldAdmin, settings: pw}); return j && j.ok ? {ok: true} : {ok: false, error: (j && j.error) || "помилка"}; }
  catch (e) { return {ok: false, error: "недоступна"}; }
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
/* «Покоління» пароля ролі: змінюється разом із паролем (в адмінці, з таблиці, при синхронізації) —
   і всі токени, видані за старого пароля, перестають діяти. Кешується в пам'яті на 30 с. */
const genCache = {};
async function pwGen(env, role) {
  const c = genCache[role];
  if (c && Date.now() - c.t < 30e3) return c.v;
  const v = (await metaGet(env, "pw_gen_" + role)) || "0";
  genCache[role] = {v, t: Date.now()};
  return v;
}
async function bumpGen(env, role) { const v = String(Date.now()); await metaSet(env, "pw_gen_" + role, v); genCache[role] = {v, t: Date.now()}; }

async function makeToken(env, role) {
  const win = TOKEN_HOURS * 3600;
  const exp = (Math.floor(Date.now() / 1000 / win) + 2) * win, gen = await pwGen(env, role);
  return `${role}.${exp}.${gen}.${await hmac(env, role + "." + exp + "." + gen)}`;
}

/* Ключ офлайн-пристрою: лише для оновлення офлайн-даних (читання етапів, карток, довідника), діє 180 днів
   і продовжується з кожним оновленням. Від зміни паролів не залежить — його відкликає адміністратор
   («Відкликати офлайн-ключі» в налаштуваннях: змінюється покоління pw_gen_off). */
const OFF_DAYS = 180;
async function makeOffToken(env) {
  const exp = Math.floor(Date.now() / 1000) + OFF_DAYS * 86400, gen = await pwGen(env, "off");
  return `off.${exp}.${gen}.${await hmac(env, "off." + exp + "." + gen)}`;
}

/* Повертає роль; null — токен чужий/прострочений; "stale" — підпис справжній, але пароль відтоді змінили.
   need: "player" | "admin" | "offline" (оновлення офлайн-даних: гравець, адмін або ключ офлайн-пристрою). */
async function tokenState(env, t, need) {
  const [role, exp, gen, sig] = String(t || "").split(".");
  if (!role || !exp || !gen || !sig || Number(exp) * 1000 < Date.now()) return null;
  if (sig !== await hmac(env, role + "." + exp + "." + gen)) return null;
  if (need === "admin" && role !== "admin") return null;
  if (role === "off" && need !== "offline") return null;   // ключ офлайн-пристрою — лише для оновлення офлайн-даних
  if (gen !== await pwGen(env, role)) return "stale";
  return role;
}
async function checkToken(env, t, need) { const r = await tokenState(env, t, need); return r === "stale" ? null : r; }

let lastSync = 0;   // коли востаннє питали таблицю про невідомий пароль (не частіше разу на 20 с — захист квоти скрипта)
async function auth(env, req, need) {
  let stale = false;
  if (req.t) { const r = await tokenState(env, req.t, need); if (r === "stale") stale = true; else if (r) return r; }
  const ip = req._ip || "local";
  rateLimit(ip, "login");
  // блокування після невдалих спроб перевіряється ПІСЛЯ пароля: правильний пароль пускає завжди
  // (клас за одним Wi-Fi — одна адреса; чужі одруківки не мають закривати вхід усім), невірний — чекає
  const locked = await loginLocked(env, ip);
  let s = await settings(env);
  const p = String(req.p || "").slice(0, 200);
  if (s._empty) {
    if (locked) throw new HttpError(locked, 429);
    const err = await bootstrap(env, p);
    if (err) {
      if (/спроб/i.test(err)) throw new HttpError("Google-скрипт тимчасово заблокував вхід після невдалих спроб. Спробуйте за 15 хвилин.");
      throw new HttpError("Сайт ще не налаштований. Адміністратору: увійдіть в адмінку (кнопка «Адмінка») паролем адміна з Google-таблиці — налаштування перенесуться автоматично. (" + err + ")");
    }
    s = await settings(env);
  }
  const isAdmin = !!p && safeEqual(p, s.admin_password);
  const isPlayer = isAdmin || (!!p && safeEqual(p, s.player_password));
  if (need === "admin" ? isAdmin : isPlayer) { await loginOk(env, ip); return isAdmin ? "admin" : "player"; }
  if (!p && req.t && need === "offline") throw new HttpError("Ключ офлайн-пристрою недійсний — завантажте офлайн-версію заново", 401);   // не рахуємо як перебір
  // пароль змінили в Google-таблиці — сайт підхоплює його звідти (не частіше разу на 20 с)
  if (locked) { await sleep(1500 + Math.random() * 1000); throw new HttpError(locked, 429); }   // під час блокування невірний пароль не перевіряється далі й не синхронізується
  if (p && p.length >= 6 && Date.now() - lastSync > 20e3) {
    lastSync = Date.now();
    const role = await syncFromSheet(env, p);
    if (role && (need !== "admin" || role === "admin")) { await loginOk(env, ip); return role; }
  }
  if (stale) throw new HttpError("Пароль змінено — увійдіть із новим паролем", 401);   // пристрій зі старим паролем: не рахуємо як перебір
  await loginFail(env, ip, p);
  throw new HttpError("Невірний пароль");
}

// ------------------------------------------------------------------ етапи
function rowToStage(r) {
  let targets = [];
  try { targets = JSON.parse(r.targets || "[]"); } catch (e) { targets = []; }
  let meta = {};
  try { meta = JSON.parse(r.meta || "{}"); } catch (e) { meta = {}; }
  return {id: r.id, title: r.title, enabled: !!r.enabled, w: r.w || 0, h: r.h || 0, targets, task: meta.task || "", direction: meta.direction || "", season: meta.season || "", gsd: Number(meta.gsd) || 0, hard: !!meta.hard, v: meta.v || "", cond: meta.cond || ""};
}

/* Етапи, що «застрягли» (ready=0) після перерваного оновлення старою версією адмінки, — повернути з бекапу. */
async function healStuck(env) {
  const {results} = await env.DB.prepare("SELECT s.id FROM stages s JOIN stage_backups b ON b.id = s.id WHERE s.ready = 0").all();
  for (const {id} of results) {
    const b = await env.DB.prepare("SELECT targets,size,chunks FROM stage_backups WHERE id=?").bind(id).first();
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM blobs WHERE id=?").bind("bak_" + id).first();
    if (!b || c.n !== b.chunks) continue;
    await env.DB.prepare("DELETE FROM blobs WHERE id=?").bind(id).run();
    await env.DB.prepare("INSERT INTO blobs (id,part,data) SELECT ?, part, data FROM blobs WHERE id=?").bind(id, "bak_" + id).run();
    await env.DB.prepare("UPDATE stages SET targets=?, size=?, chunks=?, ready=1 WHERE id=?").bind(b.targets, b.size, b.chunks, id).run();
    await bumpStageVer(env, id);
  }
  return results.length;
}

async function stages(env, all) {
  try { await healStuck(env); } catch (e) { /* не заважати завантаженню списку */ }
  const {results} = await env.DB.prepare("SELECT id,title,enabled,w,h,targets,meta FROM stages WHERE ready=1 ORDER BY created").all();
  return results.map(rowToStage).filter((s) => all || (s.enabled && s.targets.length));
}

function newId() { return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join(""); }

// ------------------------------------------------------------------ ліміти безкоштовного тарифу Cloudflare
/* Добові ліміти (скидаються о 00:00 UTC): запити Functions, рядки D1 (читання/запис) і розмір бази.
   Дані — з GraphQL Analytics API (потрібні секрети CF_API_TOKEN з правом «Account Analytics: Read» і CF_ACCOUNT_ID);
   розмір бази D1 повідомляє сама (meta.size_after), тож він видно й без токена. */
const CF_LIMITS = {requests: 100000, rowsRead: 5000000, rowsWritten: 100000, dbBytes: 500 * 1024 * 1024};
const USAGE_ALERT = 0.10;   // попереджати, коли лишилось менше 10%
let usageCheckedAt = 0;

async function cfGql(env, query, variables) {
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {method: "POST",
    headers: {"Authorization": "Bearer " + env.CF_API_TOKEN, "Content-Type": "application/json"}, body: JSON.stringify({query, variables})});
  const j = await r.json().catch(() => null);
  if (!j) throw new Error("Cloudflare API: HTTP " + r.status);
  if (j.errors && j.errors.length) throw new Error(j.errors.map((e) => e.message).join("; ").slice(0, 200));
  return ((j.data || {}).viewer || {}).accounts || [];
}

async function cfUsage(env, ctx, fresh) {
  const cache = caches.default, key = new Request("https://usage.poshuk.internal/v2");
  if (!fresh) { const hit = await cache.match(key); if (hit) return hit.json(); }
  const now = new Date(), day = now.toISOString().slice(0, 10), start = day + "T00:00:00Z", end = now.toISOString().slice(0, 19) + "Z";
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const u = {day, at: now.toISOString(), resetIn: reset - now.getTime(), limits: CF_LIMITS, configured: !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID), errors: []};
  // розмір бази — без токена
  try { const r = await env.DB.prepare("SELECT 1").run(); if (r.meta && r.meta.size_after) u.dbBytes = r.meta.size_after; } catch (e) { /* ок */ }
  if (u.configured) {
    const a = String(env.CF_ACCOUNT_ID);
    const sum = (rows, f) => (rows || []).reduce((t, g) => t + (Number((g.sum || {})[f]) || 0), 0);
    const jobs = [
      cfGql(env, "query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:10000,filter:{datetime_geq:$s,datetime_leq:$e}){sum{requests}dimensions{scriptName}}}}}", {a, s: start, e: end})
        .then((acc) => { u.workers = sum((acc[0] || {}).workersInvocationsAdaptive, "requests"); }).catch((e) => u.errors.push("Workers: " + e.message)),
      cfGql(env, "query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){pagesFunctionsInvocationsAdaptiveGroups(limit:10000,filter:{datetime_geq:$s,datetime_leq:$e}){sum{requests}}}}}", {a, s: start, e: end})
        .then((acc) => { u.pages = sum((acc[0] || {}).pagesFunctionsInvocationsAdaptiveGroups, "requests"); }).catch(() => { /* набір даних може бути недоступний — тоді рахуємо за Workers */ }),
      cfGql(env, "query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){d1AnalyticsAdaptiveGroups(limit:10000,filter:{date_geq:$d,date_leq:$d}){sum{rowsRead rowsWritten}}}}}", {a, d: day})
        .then((acc) => { const g = (acc[0] || {}).d1AnalyticsAdaptiveGroups; u.rowsRead = sum(g, "rowsRead"); u.rowsWritten = sum(g, "rowsWritten"); }).catch((e) => u.errors.push("D1: " + e.message)),
      cfGql(env, "query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){d1StorageAdaptiveGroups(limit:10000,filter:{date_geq:$d,date_leq:$d}){max{databaseSizeBytes}dimensions{databaseId}}}}}", {a, d: day})
        .then((acc) => { const g = (acc[0] || {}).d1StorageAdaptiveGroups || []; const m = Math.max(0, ...g.map((x) => Number((x.max || {}).databaseSizeBytes) || 0)); if (m) u.dbBytes = Math.max(u.dbBytes || 0, m); }).catch(() => { /* є size_after */ }),
    ];
    await Promise.all(jobs);
    if (u.workers != null || u.pages != null) u.requests = Math.max(u.workers || 0, u.pages || 0);
  }
  // що вже майже вичерпано
  u.low = [];
  for (const [k, lim] of Object.entries(CF_LIMITS)) if (u[k] != null && lim - u[k] < lim * USAGE_ALERT) u.low.push(k);
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(u), {headers: {"Content-Type": "application/json", "Cache-Control": "max-age=300"}})).catch(() => {}));
  return u;
}

function kyivTime(ms) { try { return new Date(ms).toLocaleTimeString("uk-UA", {timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit"}); } catch (e) { return "00:00 UTC"; } }
const USAGE_NAMES = {requests: "запити до сайту", rowsRead: "читання бази D1", rowsWritten: "записи в базу D1", dbBytes: "розмір бази D1"};
/* Лист адміністратору (через Google-скрипт), не частіше разу на добу для кожного ліміту. */
async function usageAlert(env, u) {
  if (!u.low || !u.low.length || !env.SHEETS_URL || !env.SHEETS_SECRET) return;
  const sentKey = "usage_alert_" + u.day, sent = new Set(String((await metaGet(env, sentKey)) || "").split(",").filter(Boolean));
  const fresh = u.low.filter((k) => !sent.has(k));
  if (!fresh.length) return;
  const lines = fresh.map((k) => { const lim = CF_LIMITS[k], left = Math.max(0, lim - u[k]); return `• ${USAGE_NAMES[k]}: використано ${Math.round(100 * u[k] / lim)}%, лишилось ${Math.round(100 * left / lim)}%`; });
  const h = Math.floor(u.resetIn / 3600e3), m = Math.round((u.resetIn % 3600e3) / 60e3);
  const text = `«Пошук техніки»: денні ліміти Cloudflare майже вичерпано (${u.day}).\n\n${lines.join("\n")}\n\nОнулення лімітів через ${h} год ${m} хв (о ${kyivTime(Date.now() + u.resetIn)} за Києвом). Якщо ліміт вичерпається, сайт не відповідатиме до онулення.`;
  try {
    const j = await gas(env, {action: "alert", secret: env.SHEETS_SECRET, subject: "⚠ Пошук техніки: ліміти Cloudflare < 10%", text});
    if (j && j.ok) await metaSet(env, sentKey, [...sent, ...fresh].join(","));
  } catch (e) { /* наступна перевірка спробує ще раз */ }
}

/* Фонова перевірка: раз на 15 хв на екземпляр функції, у фоні (відповідь не чекає). */
function usageTick(env, ctx) {
  if (!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID) || Date.now() - usageCheckedAt < 15 * 60e3) return;
  usageCheckedAt = Date.now();
  ctx.waitUntil(cfUsage(env, ctx, false).then((u) => usageAlert(env, u)).catch(() => {}));
}

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
      const role = await auth(env, req, req.off ? "offline" : "player");
      const {results: objs} = await env.DB.prepare("SELECT id,name,length_m,type,ttx,decoy FROM objects").all();
      const {results: cp} = await env.DB.prepare("SELECT id,updated,credit FROM card_photos").all();
      let cardHard = {}; try { cardHard = JSON.parse((await metaGet(env, "cards_hard")) || "{}"); } catch (e) { cardHard = {}; }
      return {ok: true, brandIcon: (await metaGet(env, "brand_icon")) || "", settings: publicSettings(await settings(env)), stages: await stages(env, false), objects: objs, cardPhotos: cp.map((r) => [r.id, r.updated]), cardPics: await cardPics(env),
        cardCredits: cp.filter((r) => r.credit).map((r) => [r.id, r.credit]), cardHard, marks: await marksAll(env), token: role === "off" ? undefined : await makeToken(env, role)};
    }
    case "submit": { await auth(env, req, "player"); return submit(env, ctx, req); }
    case "offline_key": {   // ключ офлайн-пристрою (видається після входу паролем; ключем — продовжується)
      await auth(env, req, "offline");
      return {ok: true, key: await makeOffToken(env), days: OFF_DAYS};
    }
    case "ref_list": {
      await auth(env, req, req.off ? "offline" : "player");
      const {results} = await env.DB.prepare("SELECT id, ord, cat, name, ttx, descr, imgs, updated, card FROM ref_entries ORDER BY ord").all();
      return {ok: true, entries: results.map((r) => ({id: r.id, ord: r.ord, cat: r.cat, name: r.name, ttx: r.ttx, desc: r.descr, imgs: JSON.parse(r.imgs || "[]"), v: r.updated, card: r.card || ""})), marks: await marksAll(env)};
    }
    case "top": {
      await auth(env, req, "player");
      const top = await top3(env, String(req.since || "0000"));
      top.duel = await duelTop(env, Number(req.sinceMs) || (Date.now() - 24 * 3600e3));
      return {ok: true, top};
    }
    case "offline_assets": {   // офлайн-версія: багато зображень одним запитом (base64), до ~8 МБ за раз; решта — в "rest"
      await auth(env, req, "offline");
      const want = (Array.isArray(req.items) ? req.items : []).slice(0, 400), items = {}, rest = [];
      let size = 0;
      for (const it of want) {
        const [kind, id] = [String(it[0] || ""), String(it[1] || "").slice(0, 80)];
        if (size > 8e6) { rest.push([kind, id]); continue; }
        let data = null, mime = "image/jpeg";
        if (kind === "obj") { data = await objData(env, id); mime = "image/png"; }
        else if (kind === "card") { const r = await env.DB.prepare("SELECT data,mime FROM card_photos WHERE id=?").bind(id).first(); if (r) { data = r.data; mime = r.mime || mime; } }
        else if (kind === "ref") { const r = await env.DB.prepare("SELECT data,mime FROM ref_images WHERE id=?").bind(id).first(); if (r) { data = r.data; mime = r.mime || mime; } }
        if (data) { items[kind + ":" + id] = {data, mime}; size += data.length; }
      }
      return {ok: true, items, rest};
    }
    case "my_results": {   // «Мої результати»: власні підсумки й відповіді курсанта
      await auth(env, req, "player");
      const cs = String(req.callsign || "").trim().slice(0, 40);
      if (!cs) return {ok: true, results: [], answers: []};
      await ownCallsign(env, cs, req.dev);
      const {results} = await env.DB.prepare("SELECT ts, pct, total, max, mode, conclusion FROM results WHERE callsign=? ORDER BY ts DESC LIMIT 60").bind(cs).all();
      const {results: answers} = await env.DB.prepare("SELECT kind, item, name, cat, ok, ts FROM answers WHERE callsign=? AND COALESCE(archived,0)=0 ORDER BY ts DESC LIMIT 2000").bind(cs).all();
      return {ok: true, results, answers};
    }
    case "mistakes": {   // робота над помилками: етапи й картки, де ОСТАННЯ спроба курсанта була з помилкою
      await auth(env, req, "player");
      const cs = String(req.callsign || "").trim().slice(0, 40);
      if (!cs) return {ok: true, stages: [], cards: []};
      await ownCallsign(env, cs, req.dev);
      const {results} = await env.DB.prepare("SELECT kind, item, ts, MIN(ok) ok FROM answers WHERE callsign=? AND COALESCE(archived,0)=0 AND kind IN ('search','cards') GROUP BY kind, item, ts").bind(cs).all();
      const last = new Map();
      for (const r of results) { const k = r.kind + "|" + r.item, p = last.get(k); if (!p || r.ts >= p.ts) last.set(k, r); }
      const out = {ok: true, stages: [], cards: []};
      for (const r of last.values()) if (!r.ok) (r.kind === "search" ? out.stages : out.cards).push(r.item);
      return out;
    }
    case "ref_suggest": {   // пропозиція курсанта: новий запис довідника або фото до наявного — публікується після схвалення адміном
      await auth(env, req, "player");
      const dev = String(req.dev || ""), cs = String(req.callsign || "").trim().slice(0, 40);
      if (!/^[a-f0-9]{16,64}$/.test(dev)) throw new HttpError("Оновіть сторінку — потрібна нова версія застосунку");
      const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM ref_suggest WHERE dev=?").bind(dev).first();
      if (pend && pend.n >= 15) throw new HttpError("Забагато пропозицій очікують перевірки — дочекайтесь, поки адміністратор їх розгляне");
      const kind = req.kind === "photos" ? "photos" : "new", d = req.data || {};
      const target = kind === "photos" ? String(req.target || "").slice(0, 60) : "";
      if (kind === "photos" && !target) throw new HttpError("Не вказано запис");
      const name = String(d.name || "").trim().slice(0, 200);
      if (kind === "new" && name.length < 2) throw new HttpError("Вкажіть назву техніки");
      const ims = (req.images || []).slice(0, 6);
      if (kind === "photos" && !ims.length) throw new HttpError("Додайте хоча б одне фото");
      const id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), up = new Date().toISOString(), st = [], ids = [];
      for (let i = 0; i < ims.length; i++) {
        if (!ims[i] || !ims[i].data || ims[i].data.length > 1_900_000) throw new HttpError("Фото завелике (до ~1,4 МБ)");
        const iid = `sg_${id}-${i + 1}`; ids.push(iid);
        st.push(env.DB.prepare("INSERT OR REPLACE INTO ref_images (id,data,mime,updated,credit) VALUES (?,?,?,?,?)").bind(iid, String(ims[i].data), "image/jpeg", up, `Запропонував: ${cs || "курсант"}`));
      }
      const data = JSON.stringify({name, cat: String(d.cat || "").slice(0, 80), ttx: String(d.ttx || "").slice(0, 8000), desc: String(d.desc || "").slice(0, 20000), card: /^[a-z0-9_]+$/.test(String(d.card || "")) ? String(d.card) : "", note: String(d.note || "").slice(0, 500)});
      st.push(env.DB.prepare("INSERT INTO ref_suggest (id,ts,callsign,dev,kind,target,data,imgs) VALUES (?,?,?,?,?,?,?,?)").bind(id, up, cs, dev, kind, target, data, JSON.stringify(ids)));
      await env.DB.batch(st);
      return {ok: true, id};
    }
    case "duel_create": case "duel_join": case "duel_state": case "duel_loaded": case "duel_hint": case "duel_place_begin": case "duel_place_end": case "duel_shot": case "duel_leave":
      await auth(env, req, "player");
      return duel(env, req, a);
  }
  await auth(env, req, "admin");
  switch (a) {
    case "admin_stages": return {ok: true, stages: await stages(env, true), token: await makeToken(env, "admin")};
    case "set_card_hard": {   // галочка «складний рівень» для картки (перекриває прапорець у даних)
      let m = {}; try { m = JSON.parse((await metaGet(env, "cards_hard")) || "{}"); } catch (e) { m = {}; }
      const id = String(req.id || "").slice(0, 60);
      if (!id) throw new HttpError("Немає id картки");
      if (req.hard === null || req.hard === undefined) delete m[id]; else m[id] = req.hard ? 1 : 0;
      await metaSet(env, "cards_hard", JSON.stringify(m));
      return {ok: true, cardHard: m};
    }
    case "usage": { const u = await cfUsage(env, ctx, !!req.fresh); ctx.waitUntil(usageAlert(env, u).catch(() => {})); return {ok: true, usage: u}; }
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
      await purgeImgCache(origin, String(req.id));
      const r = await env.DB.prepare("SELECT id,title,enabled,w,h,targets,meta FROM stages WHERE id=?").bind(String(req.id)).first();
      return {ok: true, stage: rowToStage(r)};
    }
    case "save_stage": {
      const sets = [], vals = [];
      if (req.title !== undefined) { sets.push("title=?"); vals.push(String(req.title).slice(0, 120)); }
      if (req.enabled !== undefined) { sets.push("enabled=?"); vals.push(req.enabled ? 1 : 0); }
      if (req.targets !== undefined) { sets.push("targets=?"); vals.push(JSON.stringify(req.targets)); }
      if (["task", "direction", "season", "gsd", "hard", "cond"].some((k) => req[k] !== undefined)) {   // мета зливається: незмінені поля лишаються
        const cur = await env.DB.prepare("SELECT meta FROM stages WHERE id=?").bind(String(req.id)).first();
        let m = {}; try { m = JSON.parse((cur && cur.meta) || "{}"); } catch (e) { m = {}; }
        if (req.task !== undefined) m.task = String(req.task || "").slice(0, 400);
        if (req.direction !== undefined) m.direction = String(req.direction || "").slice(0, 40);
        if (req.season !== undefined) m.season = String(req.season || "").slice(0, 10);
        if (req.gsd !== undefined) m.gsd = Math.max(0, Math.min(10, Number(req.gsd) || 0));
        if (req.hard !== undefined) m.hard = !!req.hard;
        if (req.cond !== undefined) { if (["winter", "thermal"].includes(req.cond)) m.cond = req.cond; else delete m.cond; }
        delete m.unit;
        sets.push("meta=?"); vals.push(JSON.stringify(m));
      }
      if (sets.length) await env.DB.prepare(`UPDATE stages SET ${sets.join(",")} WHERE id=?`).bind(...vals, String(req.id)).run();
      return {ok: true};
    }
    case "delete_stage":
      await env.DB.batch([env.DB.prepare("DELETE FROM stages WHERE id=?").bind(String(req.id)),
        env.DB.prepare("DELETE FROM blobs WHERE id=?").bind(String(req.id)),
        env.DB.prepare("DELETE FROM blobs WHERE id=?").bind("bak_" + String(req.id)),
        env.DB.prepare("DELETE FROM stage_backups WHERE id=?").bind(String(req.id))]);
      return {ok: true};
    case "backups_list": {
      const {results} = await env.DB.prepare("SELECT id, created FROM stage_backups").all();
      return {ok: true, backups: results};
    }
    case "stage_reimage_begin": {
      // новий знімок для наявного етапу (той самий id — аналітика кліків лишається). Спершу — бекап, якщо його ще немає.
      const id = String(req.id), size = Number(req.size) || 0;
      const st = await env.DB.prepare("SELECT id,targets,size,chunks,ready FROM stages WHERE id=?").bind(id).first();
      if (!st) throw new HttpError("Етап не знайдено");
      if (!size || size > 60e6) throw new HttpError("Знімок завеликий (понад 60 МБ)");
      const bak = await env.DB.prepare("SELECT id FROM stage_backups WHERE id=?").bind(id).first();
      if (!bak) {
        if (!st.ready) throw new HttpError("Етап не готовий — бекап неможливий");
        await env.DB.prepare("DELETE FROM blobs WHERE id=?").bind("bak_" + id).run();
        await env.DB.prepare("INSERT INTO blobs (id,part,data) SELECT ?, part, data FROM blobs WHERE id=?").bind("bak_" + id, id).run();
        const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM blobs WHERE id=?").bind("bak_" + id).first();
        if (c.n !== st.chunks) throw new HttpError("Бекап не вдався — етап не змінено");
        await env.DB.prepare("INSERT INTO stage_backups (id,targets,size,chunks,created) VALUES (?,?,?,?,?)").bind(id, st.targets, st.size, st.chunks, new Date().toISOString()).run();
      }
      // новий знімок вантажиться окремо ("new_<id>"); живий етап не чіпається, доки все не дійде (stage_reimage_end)
      const chunks = Math.ceil(size / CHUNK);
      await env.DB.prepare("DELETE FROM blobs WHERE id=?").bind("new_" + id).run();
      await metaSet(env, "reimg_" + id, JSON.stringify({size, chunks}));
      return {ok: true, id: "new_" + id, chunk: CHUNK, chunks, token: await makeToken(env, "admin")};
    }
    case "stage_reimage_end": {
      const id = String(req.id);
      let pend = null; try { pend = JSON.parse(await metaGet(env, "reimg_" + id) || "null"); } catch (e) { pend = null; }
      if (!pend) throw new HttpError("Немає незавершеного оновлення для цього етапу");
      const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM blobs WHERE id=?").bind("new_" + id).first();
      if (c.n !== pend.chunks) throw new HttpError(`Завантажено ${c.n} з ${pend.chunks} частин — етап не змінено, спробуйте ще раз`);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM blobs WHERE id=?").bind(id),
        env.DB.prepare("UPDATE blobs SET id=? WHERE id=?").bind(id, "new_" + id),
        env.DB.prepare("UPDATE stages SET size=?, chunks=?, ready=1 WHERE id=?").bind(pend.size, pend.chunks, id),
        env.DB.prepare("DELETE FROM meta WHERE k=?").bind("reimg_" + id)]);
      await bumpStageVer(env, id);
      await purgeImgCache(origin, id);
      const r = await env.DB.prepare("SELECT id,title,enabled,w,h,targets,meta FROM stages WHERE id=?").bind(id).first();
      return {ok: true, stage: rowToStage(r)};
    }
    case "stage_restore": {
      const id = String(req.id);
      const b = await env.DB.prepare("SELECT targets,size,chunks FROM stage_backups WHERE id=?").bind(id).first();
      if (!b) throw new HttpError("Бекапу для цього етапу немає");
      await env.DB.prepare("DELETE FROM blobs WHERE id=?").bind(id).run();
      await env.DB.prepare("INSERT INTO blobs (id,part,data) SELECT ?, part, data FROM blobs WHERE id=?").bind(id, "bak_" + id).run();
      await env.DB.prepare("UPDATE stages SET targets=?, size=?, chunks=?, ready=1 WHERE id=?").bind(b.targets, b.size, b.chunks, id).run();
      await bumpStageVer(env, id);
      await purgeImgCache(origin, id);
      const r = await env.DB.prepare("SELECT id,title,enabled,w,h,targets,meta FROM stages WHERE id=?").bind(id).first();
      return {ok: true, stage: rowToStage(r)};
    }
    case "heat": {
      const {results} = await env.DB.prepare("SELECT x,y,hit FROM clicks WHERE stage=? AND COALESCE(archived,0)=0").bind(String(req.id)).all();
      const pl = await env.DB.prepare("SELECT COUNT(DISTINCT who) AS n FROM clicks WHERE stage=? AND COALESCE(archived,0)=0").bind(String(req.id)).first();
      return {ok: true, clicks: results.map((r) => [r.x, r.y, !!r.hit]), players: pl ? pl.n : 0};
    }
    case "get_settings": { const s = await settings(env); delete s._empty; return {ok: true, settings: s}; }
    case "ref_suggestions": {   // пропозиції курсантів, що чекають перевірки
      const {results} = await env.DB.prepare("SELECT id, ts, callsign, kind, target, data, imgs FROM ref_suggest ORDER BY ts").all();
      return {ok: true, list: results.map((r) => Object.assign({id: r.id, ts: r.ts, callsign: r.callsign, kind: r.kind, target: r.target, imgs: JSON.parse(r.imgs || "[]")}, JSON.parse(r.data || "{}")))};
    }
    case "ref_suggest_decide": {   // схвалити (запис/фото з'являються в довіднику) або відхилити (фото видаляються)
      const s = await env.DB.prepare("SELECT * FROM ref_suggest WHERE id=?").bind(String(req.id || "")).first();
      if (!s) throw new HttpError("Пропозицію вже розглянуто");
      const imgs = JSON.parse(s.imgs || "[]"), d = Object.assign(JSON.parse(s.data || "{}"), req.edit || {}), st = [], up = new Date().toISOString();
      let entry = null;
      if (req.approve) {
        if (s.kind === "photos") {
          const e = await env.DB.prepare("SELECT id, imgs FROM ref_entries WHERE id=?").bind(s.target).first();
          if (!e) throw new HttpError("Запис, до якого пропонували фото, уже видалено");
          const all = JSON.parse(e.imgs || "[]").concat(imgs).slice(0, 20);
          st.push(env.DB.prepare("UPDATE ref_entries SET imgs=?, updated=? WHERE id=?").bind(JSON.stringify(all), up, e.id));
          entry = e.id;
        } else {
          const cat = String(d.cat || "Інше").slice(0, 80), card = /^[a-z0-9_]+$/.test(String(d.card || "")) ? String(d.card) : "";
          const mx = await env.DB.prepare("SELECT MAX(ord) AS m FROM ref_entries WHERE cat=? AND id NOT LIKE 'c\\_%' ESCAPE '\\'").bind(cat).first();
          entry = "u" + s.id;
          st.push(env.DB.prepare("INSERT OR REPLACE INTO ref_entries (id,ord,cat,name,ttx,descr,imgs,updated,card) VALUES (?,?,?,?,?,?,?,?,?)")
            .bind(entry, ((mx && mx.m) || 0) + 1, cat, String(d.name || "").slice(0, 200), String(d.ttx || ""), String(d.desc || ""), JSON.stringify(imgs), up, card));
        }
      } else imgs.forEach((x) => st.push(env.DB.prepare("DELETE FROM ref_images WHERE id=?").bind(x)));
      st.push(env.DB.prepare("DELETE FROM ref_suggest WHERE id=?").bind(s.id));
      await env.DB.batch(st);
      return {ok: true, entry};
    }
    case "callsign_owners": {   // прив'язки прізвищ до пристроїв (для скидання)
      const {results} = await env.DB.prepare("SELECT cs, ts FROM callsign_owner ORDER BY cs").all();
      return {ok: true, owners: results};
    }
    case "callsign_reset": {   // скинути прив'язку: наступний пристрій, що відкриє «Мої результати» з цим прізвищем, стане власником
      await env.DB.prepare("DELETE FROM callsign_owner WHERE cs=? COLLATE NOCASE").bind(String(req.callsign || "").trim().slice(0, 40)).run();
      return {ok: true};
    }
    case "revoke_offline_keys": {   // усі офлайн-пристрої перестануть оновлюватись, доки не завантажать офлайн-версію заново
      await bumpGen(env, "off");
      return {ok: true};
    }
    case "set_settings": {
      const before = await settings(env), v = req.settings || {};
      await saveSettings(env, v);
      const changed = ["player_password", "admin_password"].some((k) => v[k] !== undefined && String(v[k]).trim() !== String(before[k]));
      const sheet = changed ? await pushPasswordsToSheet(env, String(before.admin_password), v) : null;
      return {ok: true, sheet};
    }
    case "brand_icon": {
      const icon = String(req.icon || "");
      if (icon && (!/^data:image\/(png|jpeg|webp);base64,/.test(icon) || icon.length > 120000)) throw new HttpError("Іконка має бути PNG/JPEG до ~80 КБ");
      if (icon) await metaSet(env, "brand_icon", icon); else await env.DB.prepare("DELETE FROM meta WHERE k='brand_icon'").run();
      return {ok: true};
    }
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
      const real = (r) => !isTestName(r.callsign);
      return {ok: true, answers: ans.filter(real), results: res.filter(real), list: list.filter(real), since: first ? first.t : null};
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
    case "ref_marks_put": {   // ознаки на фото довідника (порожній список — прибрати розмітку)
      const img = String(req.img || "").slice(0, 60);
      if (!/^[a-z0-9_-]+$/i.test(img)) throw new HttpError("Невірний id фото");
      const marks = cleanMarks(req.marks);
      if (!marks.length) await env.DB.prepare("DELETE FROM ref_marks WHERE img=?").bind(img).run();
      else await env.DB.prepare("INSERT INTO ref_marks (img,marks,updated) VALUES (?,?,?) ON CONFLICT(img) DO UPDATE SET marks=excluded.marks, updated=excluded.updated").bind(img, JSON.stringify(marks), new Date().toISOString()).run();
      return {ok: true, marks};
    }
    case "ref_put": {   // одна позиція довідника разом із її зображеннями
      const e = req.entry || {}, id = String(e.id || "").slice(0, 40);
      if (!/^[a-z0-9_-]+$/i.test(id)) throw new HttpError("Невірний id позиції");
      const up = new Date().toISOString(), st = [];
      for (const im of (req.images || []).slice(0, 20)) {
        const iid = String(im.id || "").slice(0, 50);
        if (!/^[a-z0-9_-]+$/i.test(iid) || !im.data || im.data.length > 1_900_000) throw new HttpError("Зображення завелике або без id");
        st.push(env.DB.prepare("INSERT OR REPLACE INTO ref_images (id,data,mime,updated) VALUES (?,?,?,?)").bind(iid, String(im.data), String(im.mime || "image/jpeg"), up));
      }
      // фото, які адміністратор прибрав із запису, — видалити з бази
      const old = await env.DB.prepare("SELECT imgs, card FROM ref_entries WHERE id=?").bind(id).first();
      // перейменування фото (прапорець «лише довідник» = суфікс --ref): спершу в базі, щоб старий id не вважався прибраним
      const ren = (req.renames || []).slice(0, 40).filter((r) => Array.isArray(r) && /^[a-z0-9_-]+$/i.test(String(r[0])) && /^[a-z0-9_-]+$/i.test(String(r[1])) && String(r[1]).replace(/--ref$/, "") === String(r[0]).replace(/--ref$/, ""));
      if (ren.length) {
        await env.DB.batch(ren.flatMap(([a, b]) => [env.DB.prepare("UPDATE ref_images SET id=? WHERE id=?").bind(String(b), String(a)), env.DB.prepare("UPDATE OR REPLACE ref_marks SET img=? WHERE img=?").bind(String(b), String(a))]));
        if (old) { const m = new Map(ren.map(([a, b]) => [String(a), String(b)])); old.imgs = JSON.stringify(JSON.parse(old.imgs || "[]").map((x) => m.get(x) || x)); }
      }
      let imgs = (e.imgs || []).map(String);
      // імпорт файлу довідника: фото, додані через картки (cp_…), і прив'язка до картки зберігаються
      if (req.keepCp && old) JSON.parse(old.imgs || "[]").filter((x) => x.startsWith("cp_") && !imgs.includes(x)).forEach((x) => imgs.push(x));
      imgs = imgs.slice(0, 20);
      const now = new Set(imgs);
      if (old) await rememberReject(env, JSON.parse(old.imgs || "[]").filter((x) => !now.has(x)));   // прибране автопідібране фото — не підбирати знову
      if (old) JSON.parse(old.imgs || "[]").filter((x) => !now.has(x)).forEach((x) => st.push(env.DB.prepare("DELETE FROM ref_images WHERE id=?").bind(x), env.DB.prepare("DELETE FROM ref_marks WHERE img=?").bind(x)));
      // картка: міняється лише якщо її передано («» — відв'язати)
      const card = e.card === undefined || e.card === null ? (old && old.card) || "" : String(e.card);
      if (card && !/^[a-z0-9_]+$/.test(card)) throw new HttpError("Невірний id картки");
      st.push(env.DB.prepare("INSERT OR REPLACE INTO ref_entries (id,ord,cat,name,ttx,descr,imgs,updated,card) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(id, Number(e.ord) || 0, String(e.cat || "").slice(0, 80), String(e.name || "").slice(0, 200), String(e.ttx || "").slice(0, 8000),
          String(e.desc || "").slice(0, 20000), JSON.stringify(imgs), up, card));
      await env.DB.batch(st);
      return {ok: true};
    }
    case "ref_delete": {
      const id = String(req.id || "");
      const old = await env.DB.prepare("SELECT imgs FROM ref_entries WHERE id=?").bind(id).first();
      if (!old) throw new HttpError("Запис не знайдено");
      await env.DB.batch([env.DB.prepare("DELETE FROM ref_entries WHERE id=?").bind(id),
        ...JSON.parse(old.imgs || "[]").flatMap((x) => [env.DB.prepare("DELETE FROM ref_images WHERE id=?").bind(String(x)), env.DB.prepare("DELETE FROM ref_marks WHERE img=?").bind(String(x))])]);
      return {ok: true};
    }
    case "ref_prune": {   // після імпорту: прибрати позиції й зображення, яких немає в новій версії довідника
      const keep = new Set((req.keep || []).map(String));
      const {results} = await env.DB.prepare("SELECT id, imgs FROM ref_entries").all();
      const keepImg = new Set(), st = [];
      for (const r of results) { if (keep.has(r.id) || r.id.startsWith("c_")) JSON.parse(r.imgs || "[]").forEach((x) => keepImg.add(x)); else st.push(env.DB.prepare("DELETE FROM ref_entries WHERE id=?").bind(r.id)); }
      const {results: ims} = await env.DB.prepare("SELECT id FROM ref_images").all();
      const {results: sg} = await env.DB.prepare("SELECT imgs FROM ref_suggest").all();
      sg.forEach((r) => JSON.parse(r.imgs || "[]").forEach((x) => keepImg.add(x)));   // фото пропозицій, що чекають перевірки
      for (const r of ims) if (!keepImg.has(r.id)) st.push(env.DB.prepare("DELETE FROM ref_images WHERE id=?").bind(r.id));
      st.push(env.DB.prepare("DELETE FROM ref_marks WHERE img NOT IN (SELECT id FROM ref_images)"));
      if (st.length) await env.DB.batch(st);
      return {ok: true, removed: st.length};
    }
    case "card_photos": {   // для адмінки «Картки»: у яких карток є фото (довідник + ще не перенесені старі) і звідки перше
      const {results} = await env.DB.prepare("SELECT id,updated,credit FROM card_photos").all();
      const photos = new Map(results.map((r) => [r.id, r.updated])), credits = new Map(results.filter((r) => r.credit).map((r) => [r.id, r.credit]));
      for (const [card, list] of Object.entries(await cardPics(env))) { if (!photos.has(card)) photos.set(card, list[0][1]); if (list[0][2] && !credits.has(card)) credits.set(card, list[0][2]); }
      return {ok: true, photos: [...photos], credits: [...credits], fill: fillInfo(await fillState(env, metaGet))};
    }
    case "ref_link": {   // прив'язки «запис довідника → картка» + перенесення старих фото карток у довідник (порція)
      const merged = req.links ? await setLinks(env, req.links) : 0;
      // розділ і назва записів-оболонок карток (їх рахує браузер адміністратора з даних карток)
      const sh = (req.shells || []).slice(0, 1000).filter((x) => Array.isArray(x) && /^c_[a-z0-9_]+$/.test(String(x[0])));
      for (let i = 0; i < sh.length; i += 100) await env.DB.batch(sh.slice(i, i + 100).map(([id, cat, name]) => env.DB.prepare("UPDATE ref_entries SET cat=?, name=? WHERE id=?").bind(String(cat || "").slice(0, 80), String(name || "").slice(0, 200), String(id))));
      const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM ref_entries WHERE id LIKE 'c\\_%' ESCAPE '\\' AND (cat IS NULL OR cat='')").first();
      const left = await migrateLegacy(env, 15);
      return {ok: true, merged, left, created: (before && before.n) || 0};
    }
    case "photo_fill_now": {   // крок автопідбору негайно (кнопка в адмінці); reset — почати перелік спочатку
      if (req.reset) await fillReset(env, metaSet);
      const s = await fillTick(env, metaGet, metaSet, true);
      return {ok: true, fill: fillInfo(s || await fillState(env, metaGet))};
    }
    case "photo_fill_card": {   // автопошук фото для однієї картки (усі джерела), skip — інший кандидат
      const id = String(req.id || "");
      if (!/^[a-z0-9_]+$/.test(id)) throw new HttpError("Невірний id картки");
      const r = await fillOne(env, id, Math.max(0, Number(req.skip) || 0));
      return {ok: true, put: !!r.ok, found: r.found || 0, credit: r.credit || "", updated: r.updated || ""};
    }
    case "card_photo_upload": {
      const id = String(req.id || "").slice(0, 40);
      if (!/^[a-z0-9_]+$/.test(id)) throw new HttpError("Невірний id картки");
      if (!req.data || req.data.length > 1_900_000) throw new HttpError("Фото завелике (до ~1,4 МБ)");
      // фото картки — у довідник (перше в записі картки; попереднє фото «з картки» замінюється)
      const r = await putCardImg(env, id, {data: String(req.data), mime: String(req.mime || "image/jpeg"), credit: String(req.credit || ""), replace: true});
      await env.DB.prepare("DELETE FROM card_photos WHERE id=?").bind(id).run();
      return {ok: true, updated: r.updated};
    }
    case "card_photo_delete": {
      const id = String(req.id || "");
      const legacy = await env.DB.prepare("DELETE FROM card_photos WHERE id=?").bind(id).run();
      const done = (legacy.meta && legacy.meta.changes) || await delCardImg(env, id);
      if (!done) throw new HttpError("Немає фото, доданого через картки. Фото з навчальної таблиці прибираються в «Довіднику» (запис цієї техніки).");
      return {ok: true};
    }
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
/* Нова версія знімка етапу (після перерендеру/відновлення): адреса знімка змінюється — браузери не покажуть старий з кешу. */
async function bumpStageVer(env, id) {
  const cur = await env.DB.prepare("SELECT meta FROM stages WHERE id=?").bind(id).first();
  let m = {}; try { m = JSON.parse((cur && cur.meta) || "{}"); } catch (e) { m = {}; }
  m.v = Date.now().toString(36);
  await env.DB.prepare("UPDATE stages SET meta=? WHERE id=?").bind(JSON.stringify(m), id).run();
}
async function purgeImgCache(origin, id) {
  try { await caches.default.delete(new Request(new URL(`/api/img/${id}`, origin).toString())); } catch (e) { /* кеш не критичний */ }
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
/* Тестові входи («Тест», «Тестовський», «test», «тест 2»…) — у результати, аналітику, топ і таблицю не потрапляють. */
const isTestName = (n) => /(^|[^a-zа-яіїєґ])(тест|test)/i.test(String(n || "").trim());

/* Дуель: топ-3 за кількістю перемог з початку доби курсанта. */
async function duelTop(env, sinceMs) {
  const {results} = await env.DB.prepare("SELECT p1, p2, winner FROM duels WHERE state='done' AND winner IN (1,2) AND created >= ?").bind(sinceMs).all();
  const m = new Map();
  for (const r of results) {
    const name = String((r.winner === 1 ? r.p1 : r.p2) || "").trim();
    if (!name || isTestName(name)) continue;
    const k = name.toLowerCase(), cur = m.get(k);
    if (cur) cur.wins++; else m.set(k, {name, wins: 1});
  }
  return [...m.values()].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name)).slice(0, 3);
}

async function top3(env, since = "0000") {   // since — початок доби за часом курсанта («YYYY-MM-DD 00:00»)
  const {results} = await env.DB.prepare("SELECT callsign, mode, pct, ts, conclusion FROM results WHERE COALESCE(archived,0)=0 AND ts >= ? ORDER BY ts DESC LIMIT 5000").bind(since).all();
  const out = {search: new Map(), cards: new Map()};
  for (const r of results) {
    const name = String(r.callsign || "").trim(); if (!name || isTestName(name)) continue;
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
  if (isTestName(cs)) return {ok: true, test: true};   // тестовий запуск — нікуди не записуємо
  // перший пристрій, з якого грають під цим прізвищем, стає його власником («Мої результати» відкриваються лише на ньому)
  if (cs.trim() && /^[a-f0-9]{16,64}$/.test(String(req.dev || ""))) {
    try { await env.DB.prepare("INSERT OR IGNORE INTO callsign_owner (cs, dev, ts) VALUES (?,?,?)").bind(cs.trim(), String(req.dev), new Date().toISOString()).run(); } catch (e) { /* не критично */ }
  }
  const scores = (req.scores || []).slice(0, MAX_ROUNDS).map(Number);
  const total = scores.reduce((a, b) => a + b, 0);
  const max = Number(req.max) || scores.length * 10;
  const pct = max ? Math.max(0, Math.round(100 * total / max)) : 0;   // «свій/чужий»: штрафи можуть дати мінус — у відсотках не нижче 0
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

/* Особисті дані («Мої результати», «Робота над помилками») — лише з пристрою, що першим відкрив їх із цим прізвищем.
   Пароль курсантів спільний, тож прізвище саме по собі не доводить, хто це; пристрій (випадковий id у браузері) — доводить.
   Інший пристрій того ж курсанта — адміністратор скидає прив'язку в налаштуваннях. Загальна аналітика — лише в адмінці. */
async function ownCallsign(env, cs, dev) {
  dev = String(dev || "").slice(0, 64);
  if (!/^[a-f0-9]{16,64}$/.test(dev)) throw new HttpError("Оновіть сторінку — потрібна нова версія застосунку", 400);
  const row = await env.DB.prepare("SELECT dev FROM callsign_owner WHERE cs=? COLLATE NOCASE").bind(cs).first();
  if (!row) {
    // результатів під цим прізвищем ще немає — нічого захищати, прив'язку не створюємо (щоб випадкові «Ро», «Рос» нічого не займали)
    const any = await env.DB.prepare("SELECT 1 FROM results WHERE callsign=? LIMIT 1").bind(cs).first();
    if (any) await env.DB.prepare("INSERT OR IGNORE INTO callsign_owner (cs, dev, ts) VALUES (?,?,?)").bind(cs, dev, new Date().toISOString()).run();
    return;
  }
  if (row.dev !== dev) throw new HttpError(`Результати «${cs}» відкриваються лише на пристрої цього курсанта. Якщо це ваше прізвище і ви змінили телефон чи браузер — попросіть адміністратора скинути прив'язку.`, 403);
}

// ------------------------------------------------------------------ зображення техніки для брифінгу курсанта
async function getCardPhoto(env, ctx, request, id, t, v) {
  if (!await checkToken(env, t, "player")) return new Response("Потрібен вхід", {status: 403});
  const cache = caches.default, key = new Request(new URL(`/api/card/${id}?v=${encodeURIComponent(v || "")}`, request.url).toString());
  let res = await cache.match(key);
  if (!res) {
    let r = await env.DB.prepare("SELECT data,mime FROM card_photos WHERE id=?").bind(id).first();
    if (!r) {   // фото карток живуть у довіднику: перше придатне для гри фото записів цієї картки
      const first = ((await linked(env)).get(id) || []).flatMap((e) => e.imgs).find(isGameImg);
      if (first) r = await env.DB.prepare("SELECT data,mime FROM ref_images WHERE id=?").bind(first).first();
    }
    if (!r) return new Response("Не знайдено", {status: 404});
    const bin = atob(r.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    res = new Response(bytes, {headers: {"Content-Type": r.mime || "image/jpeg", "Cache-Control": "public, max-age=86400"}});
    ctx.waitUntil(cache.put(key, res.clone()).catch(() => {}));
  }
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, max-age=604800");
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
  out.headers.set("Cache-Control", "private, max-age=86400");
  return out;
}

// ------------------------------------------------------------------ знімки
async function getImage(env, ctx, request, id, t, v) {
  if (!await checkToken(env, t, "offline")) return new Response("Потрібен вхід", {status: 403});
  const cache = caches.default;
  const key = new Request(new URL(`/api/img/${id}${v ? `?v=${encodeURIComponent(v)}` : ""}`, request.url).toString());
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
  out.headers.set("Cache-Control", "private, max-age=604800");
  return out;
}

async function putBlob(env, request, id, part) {
  if (id.startsWith("duel_")) return putDuelBlob(env, request, id, part);
  if (!await checkToken(env, request.headers.get("X-Token"), "admin")) return json({ok: false, error: "Потрібен вхід адміністратора"}, 403);
  let st;
  if (id.startsWith("new_")) { try { st = JSON.parse(await metaGet(env, "reimg_" + id.slice(4)) || "null"); } catch (e) { st = null; } }
  else st = await env.DB.prepare("SELECT chunks FROM stages WHERE id=?").bind(id).first();
  if (!st || part < 0 || part >= st.chunks) return json({ok: false, error: "Невірна частина"}, 400);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > CHUNK) return json({ok: false, error: "Частина завелика"}, 400);
  await env.DB.prepare("INSERT INTO blobs (id,part,data) VALUES (?,?,?) ON CONFLICT(id,part) DO UPDATE SET data=excluded.data").bind(id, part, buf).run();
  return json({ok: true});
}

// ------------------------------------------------------------------ дуель (морський бій на знімку)
const DUEL_AREA = 25000;   // м²: більші поля дуелі зменшуються ще вдвічі
const HINT_COLS = 8;   // сітка поля бою для підказки: 8 квадратів по ширині
const TURN_MS = 25000, PLACE_MS = 60000, EXTRA_MS = 10000, UPLOAD_GRACE = 45000, GONE_MS = 90000;
const jp = (s, d) => { try { return JSON.parse(s || ""); } catch (e) { return d; } };
const rnd4 = () => String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));

async function duelRow(env, code) {
  const r = await env.DB.prepare("SELECT * FROM duels WHERE code=?").bind(String(code || "")).first();
  if (!r) throw new HttpError("Кімнату не знайдено — перевірте код");
  return r;
}
function whoAmI(r, secret) { if (secret && secret === r.s1) return 1; if (secret && secret === r.s2) return 2; throw new HttpError("Ви не в цій кімнаті"); }

/* Лінива «годинникова» логіка: прострочений хід передається, зниклий гравець програє. */
async function duelTick(env, r, me) {
  const now = Date.now(), sets = {};
  // «я на звʼязку» пишемо не частіше ніж раз на 15 с — запис у D1 на безкоштовному плані обмежений (100 тис./добу)
  if (now - (r["seen" + me] || 0) > 15000) sets["seen" + me] = now;
  if (r.state === "place" && r.until) {
    // 60 с + 10 с додаткових: хто не розставив і не відправив техніку — програв (гра без його цілей не починається)
    const hard = r.until + EXTRA_MS + 1500;
    if (now > hard && (!r.u1 || !r.u2)) Object.assign(sets, {state: "done", winner: r.u1 && !r.u2 ? 1 : r.u2 && !r.u1 ? 2 : 0, reason: "noplace"});
    else if (now > hard + UPLOAD_GRACE && (!r.r1 || !r.r2)) Object.assign(sets, {state: "done", winner: r.r1 && !r.r2 ? 1 : r.r2 && !r.r1 ? 2 : 0, reason: "noplace"});
  }
  if (r.state === "battle") {
    const other = 3 - me;
    if (r["seen" + other] && now - r["seen" + other] > GONE_MS) { Object.assign(sets, {state: "done", winner: me, reason: "left"}); }
    else if (now > r.until + 1500) {
      const shots = jp(r.shots, []);
      shots.push({by: r.turn, res: "timeout", at: now});
      Object.assign(sets, {turn: 3 - r.turn, until: now + TURN_MS, shots: JSON.stringify(shots)});
    }
  }
  const keys = Object.keys(sets);
  if (!keys.length) return r;
  await env.DB.prepare(`UPDATE duels SET ${keys.map((k) => k + "=?").join(",")} WHERE code=?`).bind(...keys.map((k) => sets[k]), r.code).run();
  Object.assign(r, sets);
  return r;
}

function duelView(r, me) {
  const other = 3 - me, shots = jp(r.shots, []), opp = jp(r["u" + other], []) || [], mine = jp(r["u" + me], []) || [];
  const done = r.state === "done";
  const reveal = opp.map((u, i) => (done || u.dead || u.seen ? {i, x: u.x, y: u.y, r: u.r, type: u.type, decoy: !!u.decoy, dead: !!u.dead} : null)).filter(Boolean);
  const alive = (us) => us.filter((u) => !u.decoy && !u.dead).length;
  return {ok: true, code: r.code, state: r.state, me, turn: r.turn, left: r.state === "place" ? (r.until ? r.until - Date.now() : PLACE_MS) : Math.max(0, r.until - Date.now()),
    loaded: [!!r.l1, !!r.l2], placeMs: PLACE_MS, extraMs: EXTRA_MS, turnMs: TURN_MS, sent: [!!r.u1, !!r.u2], names: [r.p1 || "", r.p2 || ""],
    kit: jp(r.kit, []), map: {id: r.map, gsd: r.gsd, crop: jp(r.crop, null)}, mine, ready: [!!r.r1, !!r.r2], reveal, shots,
    alive: {me: alive(mine), opp: r["r" + other] ? alive(opp) : null}, winner: r.winner, reason: r.reason || "",
    hint: (jp(r.hints, {}) || {})[me] || null, grid: HINT_COLS};
}

async function duel(env, req, a) {
  const now = Date.now();
  if (a === "duel_create") {
    // старі кімнати: знімки — геть через 6 год; сам запис (хто переміг) лишається 2 доби — для «Топу дня»
    const {results: old} = await env.DB.prepare("SELECT code FROM duels WHERE created < ? AND COALESCE(purged,0)=0").bind(now - 6 * 3600e3).all();
    for (const o of old) await env.DB.batch([env.DB.prepare("DELETE FROM blobs WHERE id LIKE ?").bind(`duel_${o.code}_%`), env.DB.prepare("UPDATE duels SET purged=1 WHERE code=?").bind(o.code)]);
    await env.DB.prepare("DELETE FROM duels WHERE created < ?").bind(now - 48 * 3600e3).run();
    // карта: чистий знімок з масштабом (етап без цілей)
    const {results: maps} = await env.DB.prepare("SELECT id, meta, w, h FROM stages WHERE ready=1 AND (targets IS NULL OR targets='[]' OR targets='')").all();
    const ok = maps.filter((m) => Number(jp(m.meta, {}).gsd) > 0 && !jp(m.meta, {}).cond);
    if (!ok.length) throw new HttpError("Немає карт для дуелі: адміністратору — додати чисті карти з масштабом");
    const m = ok[Math.floor(Math.random() * ok.length)];
    const kit = (Array.isArray(req.kit) ? req.kit : []).slice(0, 6).map((k) => ({obj: String(k.obj || "").slice(0, 60), name: String(k.name || "").slice(0, 60), length_m: Number(k.length_m) || 7, decoy: !!k.decoy}));
    if (!kit.length) throw new HttpError("Немає техніки для дуелі");
    let code = rnd4();
    for (let k = 0; k < 20 && await env.DB.prepare("SELECT code FROM duels WHERE code=?").bind(code).first(); k++) code = rnd4();
    const secret = newId() + newId();
    // поле бою — випадкова чверть карти (вдвічі менша по кожній стороні): шукати швидше, ходи коротші;
    // великі карти (поле понад DUEL_AREA м²) — ще вдвічі менше за площею
    const g = Number(jp(m.meta, {}).gsd);
    let k = 0.5;
    if (m.w && m.h && (m.w * k * g) * (m.h * k * g) > DUEL_AREA) k = 0.5 / Math.SQRT2;
    const crop = JSON.stringify({k: Math.round(k * 1000) / 1000, fx: Math.random(), fy: Math.random()});
    await env.DB.prepare("INSERT INTO duels (code,created,state,map,gsd,kit,p1,s1,shots,seen1,crop) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(code, now, "lobby", m.id, Number(jp(m.meta, {}).gsd), JSON.stringify(kit), String(req.callsign || "Гравець 1").slice(0, 40), secret, "[]", now, crop).run();
    return Object.assign(duelView(await duelRow(env, code), 1), {secret});
  }
  const r = await duelRow(env, req.code);
  if (a === "duel_join") {
    if (r.s2) throw new HttpError("Кімната вже зайнята");
    const secret = newId() + newId();
    await env.DB.prepare("UPDATE duels SET p2=?, s2=?, state='place', seen2=? WHERE code=? AND s2 IS NULL").bind(String(req.callsign || "Гравець 2").slice(0, 40), secret, now, r.code).run();
    const r2 = await duelRow(env, r.code);
    if (r2.s2 !== secret) throw new HttpError("Кімната вже зайнята");
    return Object.assign(duelView(r2, 2), {secret});
  }
  const me = whoAmI(r, req.secret);
  await duelTick(env, r, me);
  if (a === "duel_state") return duelView(r, me);
  if (a === "duel_leave") {
    if (r.state !== "done") await env.DB.prepare("UPDATE duels SET state='done', winner=?, reason='left' WHERE code=?").bind(r.s2 ? 3 - me : 0, r.code).run();
    return {ok: true};
  }
  if (a === "duel_loaded") {
    // 30 с на розстановку рахуються, коли карта відкрилась в обох (повільний телефон не втрачає час)
    await env.DB.prepare(`UPDATE duels SET l${me}=1 WHERE code=?`).bind(r.code).run();
    await env.DB.prepare("UPDATE duels SET until=? WHERE code=? AND state='place' AND l1=1 AND l2=1 AND (until IS NULL OR until=0)").bind(now + PLACE_MS, r.code).run();
    return duelView(await duelRow(env, r.code), me);
  }
  if (a === "duel_place_begin") {
    if (r.state !== "place") throw new HttpError("Зараз не етап розстановки");
    if (r.until && now > r.until + EXTRA_MS + 1500) throw new HttpError("Час розстановки вийшов");
    const kit = jp(r.kit, []), units = Array.isArray(req.units) ? req.units : [];
    if (units.length !== kit.length) throw new HttpError("Розставте всю техніку");
    const us = units.map((u, i) => ({x: Math.round(Number(u.x) || 0), y: Math.round(Number(u.y) || 0), r: Math.max(6, Math.min(200, Number(u.r) || 12)), type: String(u.type || kit[i].name || "").slice(0, 60), decoy: !!kit[i].decoy}));
    const size = Number(req.size) || 0;
    if (!size || size > 60e6) throw new HttpError("Знімок завеликий");
    const chunks = Math.ceil(size / CHUNK);
    await env.DB.prepare("DELETE FROM blobs WHERE id LIKE ?").bind(`duel_${r.code}_${me}`).run();
    await env.DB.prepare(`UPDATE duels SET u${me}=?, c${me}=?, r${me}=0, dims=COALESCE(dims, ?) WHERE code=?`).bind(JSON.stringify(us), chunks, JSON.stringify({w: Number(req.w) || 0, h: Number(req.h) || 0}), r.code).run();
    return {ok: true, id: `duel_${r.code}_${me}`, chunk: CHUNK, chunks, token: await makeToken(env, "player")};
  }
  if (a === "duel_place_end") {
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM blobs WHERE id=?").bind(`duel_${r.code}_${me}`).first();
    if (c.n !== r["c" + me]) throw new HttpError(`Завантажено ${c.n} з ${r["c" + me]} частин — спробуйте ще раз`);
    await env.DB.prepare(`UPDATE duels SET r${me}=1 WHERE code=?`).bind(r.code).run();
    const r2 = await duelRow(env, r.code);
    if (r2.r1 && r2.r2 && r2.state === "place") {
      // перший хід — випадково; першому трохи більше часу (завантажити знімок суперника)
      await env.DB.prepare("UPDATE duels SET state='battle', turn=?, until=? WHERE code=? AND state='place'").bind(1 + (crypto.getRandomValues(new Uint8Array(1))[0] & 1), now + TURN_MS + 5000, r.code).run();
    }
    return duelView(await duelRow(env, r.code), me);
  }
  if (a === "duel_hint") {
    // одна підказка на гру: район 8 квадратів (4×2), де стоїть одна з живих цілей суперника
    if (r.state !== "battle") throw new HttpError("Підказка — лише під час бою");
    const hints = jp(r.hints, {}) || {};
    if (hints[me]) return duelView(r, me);
    const dims = jp(r.dims, {}) || {}, opp = (jp(r["u" + (3 - me)], []) || []).filter((u) => !u.dead && !u.decoy);
    if (!dims.w || !opp.length) throw new HttpError("Підказка недоступна");
    const c = dims.w / HINT_COLS, cols = HINT_COLS, rows = Math.max(1, Math.ceil(dims.h / c));
    const u = opp[Math.floor(Math.random() * opp.length)];
    const col = Math.min(cols - 1, Math.floor(u.x / c)), row = Math.min(rows - 1, Math.floor(u.y / c));
    const cw = rows >= 2 ? 4 : 8, ch = rows >= 2 ? 2 : 1;
    const rnd = (n) => Math.floor(Math.random() * n);
    const c0 = Math.max(0, Math.min(cols - cw, col - rnd(cw))), r0 = Math.max(0, Math.min(rows - ch, row - rnd(ch)));
    hints[me] = {x: c0 * c, y: r0 * c, w: Math.min(cw * c, dims.w - c0 * c), h: Math.min(ch * c, dims.h - r0 * c), c};
    await env.DB.prepare("UPDATE duels SET hints=? WHERE code=?").bind(JSON.stringify(hints), r.code).run();
    r.hints = JSON.stringify(hints);
    return duelView(r, me);
  }
  if (a === "duel_shot") {
    if (r.state !== "battle") throw new HttpError("Бій не йде");
    if (r.turn !== me) throw new HttpError("Зараз хід суперника");
    const other = 3 - me, opp = jp(r["u" + other], []), shots = jp(r.shots, []);
    const x = Number(req.x), y = Number(req.y);
    if (!isFinite(x) || !isFinite(y)) throw new HttpError("Некоректний удар");
    let best = -1, bd = Infinity;
    // зона ураження: радіус техніки × 1,4 + допуск на палець/курсор (до ще одного радіуса) — щоб не треба було цілитись у піксель
    const tol = Math.max(0, Math.min(Number(req.tol) || 0, 200));
    opp.forEach((u, i) => { if (u.dead || (u.decoy && u.seen)) return; const d = Math.hypot(x - u.x, y - u.y); if (d <= u.r * 1.4 + Math.min(tol, u.r) && d < bd) { bd = d; best = i; } });
    let res = "miss", turn = other, state = "battle", winner = 0;
    if (best >= 0 && !opp[best].decoy) { res = "hit"; opp[best].dead = true; turn = me; if (!opp.some((u) => !u.decoy && !u.dead)) { state = "done"; winner = me; } }
    else if (best >= 0) { res = "decoy"; opp[best].seen = true; }
    shots.push({by: me, x: Math.round(x), y: Math.round(y), res, i: best, at: now});
    await env.DB.prepare(`UPDATE duels SET u${other}=?, shots=?, turn=?, until=?, state=?, winner=? WHERE code=?`)
      .bind(JSON.stringify(opp), JSON.stringify(shots), turn, now + TURN_MS, state, winner, r.code).run();
    return Object.assign(duelView(await duelRow(env, r.code), me), {res});
  }
  throw new HttpError("Невідома дія");
}

async function putDuelBlob(env, request, id, part) {
  if (!await checkToken(env, request.headers.get("X-Token"), "player")) return json({ok: false, error: "Потрібен вхід"}, 403);
  const m = /^duel_(\d{4})_([12])$/.exec(id);
  if (!m) return json({ok: false, error: "Невірна частина"}, 400);
  const r = await env.DB.prepare("SELECT * FROM duels WHERE code=?").bind(m[1]).first();
  if (!r || request.headers.get("X-Duel") !== r["s" + m[2]] || part < 0 || part >= r["c" + m[2]]) return json({ok: false, error: "Невірна частина"}, 400);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > CHUNK) return json({ok: false, error: "Частина завелика"}, 400);
  await env.DB.prepare("INSERT INTO blobs (id,part,data) VALUES (?,?,?) ON CONFLICT(id,part) DO UPDATE SET data=excluded.data").bind(id, part, buf).run();
  return json({ok: true});
}

async function getDuelImage(env, code, n, t, secret) {
  if (!await checkToken(env, t, "player")) return new Response("Потрібен вхід", {status: 403});
  const r = await env.DB.prepare("SELECT * FROM duels WHERE code=?").bind(String(code)).first();
  if (!r || (secret !== r.s1 && secret !== r.s2) || (n !== 1 && n !== 2)) return new Response("Не знайдено", {status: 404});
  if (!r["r" + n] || (r.state !== "battle" && r.state !== "done" && secret !== r["s" + n])) return new Response("Ще не готово", {status: 404});
  const parts = [];
  for (let i = 0; i < r["c" + n]; i++) {
    const b = await env.DB.prepare("SELECT data FROM blobs WHERE id=? AND part=?").bind(`duel_${r.code}_${n}`, i).first();
    if (!b) return new Response("Знімок пошкоджено", {status: 500});
    parts.push(new Uint8Array(b.data));
  }
  return new Response(new Blob(parts), {headers: {"Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=3600"}});
}

// ------------------------------------------------------------------ точка входу
export async function onRequest(context) {
  const {request, env} = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  try {
    await db(env);
    try { usageTick(env, context); } catch (e) { /* ок */ }
    try { sheetSyncTick(env, context); } catch (e) { /* ок */ }
    if (request.method === "POST") context.waitUntil(fillTick(env, metaGet, metaSet, false).catch(() => {}));
    // токен для картинок: у запиті (?t=), у заголовку (fetch) або в cookie (<img>) — тоді адреса стала й кеш браузера живе довго
    const t = url.searchParams.get("t") || request.headers.get("X-Token") || cookieOf(request, "pt");
    if (request.method === "GET" && path[0]) rateLimit(ipOf(request), "img");
    if (request.method === "GET" && path[0] === "img" && path[1]) return await getImage(env, context, request, path[1], t, url.searchParams.get("v"));
    if (request.method === "GET" && path[0] === "obj" && path[1]) return await getObject(env, context, request, path[1], t);
    if (request.method === "GET" && path[0] === "card" && path[1]) return await getCardPhoto(env, context, request, path[1], t, url.searchParams.get("v"));
    if (request.method === "GET" && path[0] === "ref" && path[1]) return await getRefImage(env, context, request, path[1], t, url.searchParams.get("v"));
    if (request.method === "GET" && path[0] === "duel" && path[1] && path[2]) return await getDuelImage(env, path[1], Number(path[2]), url.searchParams.get("t"), url.searchParams.get("s"));
    if (request.method === "PUT" && path[0] === "blob" && path[1]) return await putBlob(env, request, path[1], Number(path[2]));
    if (request.method === "GET") return json({ok: true, app: "poshuk", version: VERSION});
    if (request.method !== "POST") return json({ok: false, error: "Метод не підтримується"}, 405);
    const ip = ipOf(request);
    rateLimit(ip, "api");
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return json({ok: false, error: "Запит завеликий"}, 413);
    let req;
    try { req = JSON.parse(await request.text()); } catch (e) { return json({ok: false, error: "Некоректний запит"}); }
    if (!req || typeof req !== "object") return json({ok: false, error: "Некоректний запит"});
    req._ip = ip;
    if (req.action === "offline_assets" || req.action === "duel_create" || req.action === "duel_join") rateLimit(ip, "heavy");
    return json(await action(env, context, req, url.origin));
  } catch (e) {
    // внутрішні помилки бази не показуємо назовні (назви таблиць і SQL — зайва інформація для стороннього)
    const msg = String(e && e.message || e);
    if (!(e instanceof HttpError)) console.error("api error:", msg);
    return json({ok: false, error: e instanceof HttpError ? msg : (/D1_|SQLITE|no such|syntax error/i.test(msg) ? "Помилка бази даних — спробуйте пізніше" : msg)}, e instanceof HttpError ? e.status : 200);
  }
}
