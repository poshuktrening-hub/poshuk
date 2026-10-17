/* Автопідбір фото для карток без фото — у фоні на сервері (Cloudflare має вихід у Вікісховище, телефон адміна не потрібен).
   Кожен запит до сайту, не частіше разу на 30 с, обробляє 2 картки: пошук у Wikimedia Commons за запитом картки,
   лише вільні ліцензії (CC0, PD, CC BY, CC BY-SA), ширина ≥ 700; якщо справжнього фото немає — креслення, модель або макет.
   Фото зберігається як у ручному підборі (card_photos: мініатюра 1280 px + підпис автора/ліцензії).
   Стан — у meta «photo_fill»: позиція у переліку, скільки знайдено, яких не знайдено. Перелік — photo-queries.js. */
import {LIST_V, ORDER, NAMES, QUERIES} from "./photo-queries.js";

const UA = "poshuk-trener/1.0 (https://poshuk.pages.dev; contact: mrqwerty841@gmail.com)";
const PER_TICK = 2, TICK_MS = 30e3, LOCK_MS = 90e3, BACKOFF_MS = 10 * 60e3;
const FREE = (lic) => { const l = String(lic || "").toLowerCase(); return !/nc|nd|fair|non-free/.test(l) && /(cc0|public domain|pd|cc by|cc-by|attribution)/.test(l); };
const BAD_STRICT = /decoy|inflatable|maket|макет|model|toy|replica|lego|interior|operators|cutaway|diagram|scheme|drawing|blueprint|emblem|logo|\bmap\b|poster|stamp/i;
const BAD_LOOSE = /toy|lego|emblem|logo|\bmap\b|interior|operators|stamp|poster|flag|coat of arms/i;
const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const nz = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9а-яіїєґ]/g, "");

async function api(env, params) {
  const base = env.COMMONS_API || "https://commons.wikimedia.org/w/api.php";
  const u = base + "?" + new URLSearchParams(Object.assign({format: "json", formatversion: "2"}, params));
  const r = await fetch(u, {headers: {"User-Agent": UA, "Accept": "application/json"}});
  if (!r.ok) throw new Error("commons " + r.status);
  return r.json();
}

/* Кандидати для картки: спершу названі файли, далі пошук; strict — без макетів/креслень, loose — з ними. */
async function candidates(env, id) {
  const spec = QUERIES[id] || [], q = spec[0], files = spec.slice(1);
  const ii = {prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: "1280", iiextmetadatafilter: "LicenseShortName|Artist"};
  const out = [], seen = new Set();
  const take = (pages, loose) => (pages || []).forEach((p) => {
    const i = p.imageinfo && p.imageinfo[0]; if (!i || seen.has(p.title)) return;
    const m = i.extmetadata || {}, lic = (m.LicenseShortName && m.LicenseShortName.value) || "";
    const svg = /svg/.test(i.mime || "");
    if (!/^image\/(jpeg|png|webp|svg)/.test(i.mime || "") || (svg && !loose) || (i.width || 0) < 700 || !FREE(lic)) return;
    if ((loose ? BAD_LOOSE : BAD_STRICT).test(p.title)) return;
    seen.add(p.title);
    out.push({title: p.title, url: i.thumburl || i.url, page: i.descriptionurl, license: lic, author: strip(m.Artist && m.Artist.value).slice(0, 120), mime: svg ? "image/png" : (i.thumbmime || i.mime), loose: !!loose});
  });
  if (files.length) { const j = await api(env, Object.assign({action: "query", titles: files.map((f) => "File:" + f).join("|")}, ii)); take(j.query && j.query.pages, false); }
  if (q && out.length < 1) {
    const j = await api(env, Object.assign({action: "query", generator: "search", gsrsearch: q + " filetype:bitmap", gsrnamespace: "6", gsrlimit: "15"}, ii));
    const pages = (j.query && j.query.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0));
    // у назві файлу мають бути всі позначення з цифрами із запиту («T-72B3» → t72b3), інакше це часто інша техніка
    const keys = q.split(/\s+/).filter((w) => /\d/.test(w)).map(nz).filter((w) => w.length >= 3);
    const need = keys.length ? keys : q.split(/\s+/).map(nz).filter((w) => w.length >= 3);
    const fit = pages.filter((p) => { const t = nz(p.title); return need.every((k) => t.includes(k)); });
    take(fit, false);
    if (!out.length) take(fit, true);                       // креслення, модель, макет
    if (!out.length && need.length > 1) take(pages.filter((p) => { const t = nz(p.title); return need.some((k) => t.includes(k)); }), true);
  }
  return out;
}

function b64(buf) {
  const u = new Uint8Array(buf); let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
async function fetchThumb(url) {
  for (const w of [1280, 900, 640]) {
    const u = url.replace(/\/(\d+)px-/, `/${w}px-`);
    const r = await fetch(u, {headers: {"User-Agent": UA}});
    if (!r.ok) throw new Error("thumb " + r.status);
    const buf = await r.arrayBuffer();
    if (buf.byteLength <= 1_350_000) return {data: b64(buf), mime: r.headers.get("Content-Type") || "image/jpeg"};
    if (!/\/\d+px-/.test(url)) break;
  }
  throw new Error("thumb too big");
}

const S0 = () => ({v: LIST_V, pos: 0, ok: 0, miss: [], at: 0, lock: 0});
export async function fillState(env, metaGet) {
  let s; try { s = JSON.parse(await metaGet(env, "photo_fill") || "null"); } catch (e) { s = null; }
  if (!s || s.v !== LIST_V) s = S0();
  return Object.assign(s, {total: ORDER.length, done: s.pos >= ORDER.length});
}
export async function fillReset(env, metaSet, onlyMiss) {
  await metaSet(env, "photo_fill", JSON.stringify(S0()));
}

let lastTick = 0;
/* Один крок автопідбору: до PER_TICK карток без фото. Викликається з ctx.waitUntil. */
export async function fillTick(env, metaGet, metaSet, force) {
  if (!force && Date.now() - lastTick < TICK_MS) return null;
  lastTick = Date.now();
  const s = await fillState(env, metaGet);
  if (s.done) return s;
  if (!force && s.lock > Date.now() - LOCK_MS) return s;   // інший дата-центр саме працює, або пауза після збою
  s.lock = Date.now(); await metaSet(env, "photo_fill", JSON.stringify(s));
  const {results} = await env.DB.prepare("SELECT id FROM card_photos").all();
  const have = new Set(results.map((r) => r.id));
  let n = 0;
  try {
    while (n < PER_TICK && s.pos < ORDER.length) {
      const id = ORDER[s.pos];
      if (have.has(id)) { s.pos++; continue; }
      const list = await candidates(env, id);
      if (!list.length) { s.miss.push(id); s.pos++; n++; continue; }
      let stored = false;
      for (const c of list.slice(0, 3)) {
        try {
          const t = await fetchThumb(c.url);
          const credit = `${c.author || "автор невідомий"}, ${c.license}, Wikimedia Commons — ${c.page}${c.loose ? " (креслення/модель)" : ""}`;
          await env.DB.prepare("INSERT OR REPLACE INTO card_photos (id,data,mime,updated,credit) VALUES (?,?,?,?,?)").bind(id, t.data, t.mime, new Date().toISOString(), credit.slice(0, 400)).run();
          stored = true; break;
        } catch (e) { /* наступний кандидат */ }
      }
      if (stored) s.ok++; else s.miss.push(id);
      s.pos++; n++;
    }
    s.at = Date.now(); s.lock = 0;
  } catch (e) {
    s.lock = Date.now() + BACKOFF_MS - LOCK_MS;   // Вікісховище не відповіло — пауза 10 хв, позиція не зсувається
  }
  await metaSet(env, "photo_fill", JSON.stringify(s));
  return Object.assign(s, {total: ORDER.length, done: s.pos >= ORDER.length, names: NAMES});
}
export const fillInfo = (s) => ({pos: s.pos, total: ORDER.length, ok: s.ok, miss: s.miss.map((id) => NAMES[id] || id), done: s.pos >= ORDER.length, at: s.at, paused: s.lock > Date.now()});
