/* Автопідбір фото для карток без фото — у фоні на сервері (Cloudflare має вихід у Вікісховище, телефон адміна не потрібен).
   Кожен запит до сайту, не частіше разу на 30 с, обробляє 2 картки: пошук у Wikimedia Commons за запитом картки,
   лише вільні ліцензії (CC0, PD, CC BY, CC BY-SA), ширина ≥ 700; якщо справжнього фото немає — креслення, модель або макет.
   Фото зберігається як у ручному підборі (card_photos: мініатюра 1280 px + підпис автора/ліцензії).
   Стан — у meta «photo_fill»: позиція у переліку, скільки знайдено, яких не знайдено. Перелік — photo-queries.js. */
import {LIST_V, ORDER, NAMES, QUERIES, VARIANTS} from "./photo-queries.js";
import {cardPics, putCardImg, dropImg, CP} from "./cardref.js";

const UA = "poshuk-trener/1.0 (https://poshuk.pages.dev; contact: mrqwerty841@gmail.com)";
const PER_TICK = 1, TICK_MS = 20e3,   // до ~20 підзапитів на картку — в межах ліміту 50 на запит
      LOCK_MS = 90e3, BACKOFF_MS = 10 * 60e3;
const FREE = (lic) => { const l = String(lic || "").toLowerCase(); return !/nc|nd|fair|non-free/.test(l) && /(cc0|public domain|pd|cc by|cc-by|attribution)/.test(l); };
const BAD_STRICT = /decoy|inflatable|maket|макет|model|toy|replica|lego|interior|operators|cutaway|diagram|scheme|drawing|blueprint|emblem|logo|\bmap\b|poster|stamp/i;
const BAD_LOOSE = /toy|lego|emblem|logo|\bmap\b|interior|operators|stamp|poster|flag|coat of arms/i;
/* Явно не військова техніка (позначення «2S42» буває номером потяга тощо) — ніколи не беремо. */
export const OFF_TOPIC = /train|railway|railroad|rail\b|station|locomotive|\btram|\bbus\b|metro|subway|platform|class \d|class_\d|airport|stadium|church|street|football|concert|car show|bmw|audi|mercedes|porsche|tractor|harvester|coin|banknote|medal|insect|mosquito|spray|cosmetic|perfume|skin|bottle|beetle|tick\b/i;
const STOP = /^(tank|self|propelled|howitzer|system|launcher|vehicle|radar|truck|missile|class|project|ship|boat|russian|military|mod|obr)$/;
/* Ключі, які мають бути в назві файлу: позначення з цифрами + шифр (якщо є), або лише слова. */
function needOf(q) {
  const t = String(q || "").split(/\s+/);
  const keys = t.filter((w) => /\d/.test(w)).map(nz).filter((w) => w.length >= 3);
  const words = t.filter((w) => !/\d/.test(w)).map(nz).filter((w) => w.length >= 4 && !STOP.test(w));
  return keys.length ? keys.concat(words.slice(0, 1)) : words;
}
/* Назва файлу підходить картці хоча б за одним із її запитів. */
function fileOk(id, title) {
  const t = nz(title);
  return [(QUERIES[id] || [])[0], ...(VARIANTS[id] || [])].filter(Boolean).some((q) => { const n = needOf(q); return n.length && n.every((k) => t.includes(k)); });
}
const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const nz = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9а-яіїєґ]/g, "");

async function api(env, params) {
  const base = env.COMMONS_API || "https://commons.wikimedia.org/w/api.php";
  const u = base + "?" + new URLSearchParams(Object.assign({format: "json", formatversion: "2"}, params));
  const r = await fetch(u, {headers: {"User-Agent": UA, "Accept": "application/json"}});
  if (!r.ok) throw new Error("commons " + r.status);
  return r.json();
}

/* Кандидати для картки. Порядок пошуку:
   1) названі файли; 2) пошук англійською (запит картки); 3) пошук кирилицею — шифр, позначення, російське написання
      (на Вікісховищі багато фото mil.ru з російськими назвами); 4) якщо справжніх фото немає — креслення, модель, макет;
   5) АрміяInform (сайт Міноборони, ліцензія CC BY 4.0): фото до статті про знищення/захоплення цього зразка. */
async function candidates(env, id) {
  const spec = QUERIES[id] || [], files = spec.slice(1);
  const queries = [spec[0], ...(VARIANTS[id] || [])].filter(Boolean);
  const ii = {prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: "1280", iiextmetadatafilter: "LicenseShortName|Artist"};
  const out = [], seen = new Set();
  const take = (pages, loose) => (pages || []).forEach((p) => {
    const i = p.imageinfo && p.imageinfo[0]; if (!i || seen.has(p.title)) return;
    const m = i.extmetadata || {}, lic = (m.LicenseShortName && m.LicenseShortName.value) || "";
    const svg = /svg/.test(i.mime || "");
    if (!/^image\/(jpeg|png|webp|svg)/.test(i.mime || "") || (svg && !loose) || (i.width || 0) < 600 || !FREE(lic)) return;
    if ((loose ? BAD_LOOSE : BAD_STRICT).test(p.title) || OFF_TOPIC.test(p.title)) return;
    seen.add(p.title);
    out.push({title: p.title, url: i.thumburl || i.url, page: i.descriptionurl, license: lic, author: strip(m.Artist && m.Artist.value).slice(0, 120), loose: !!loose});
  });
  if (files.length) { const j = await api(env, Object.assign({action: "query", titles: files.map((f) => "File:" + f).join("|")}, ii)); take(j.query && j.query.pages, false); }
  if (out.length) return out;
  const pool = [];   // [сторінки, ключі] з усіх запитів — для другого, м'якшого проходу
  for (const q of queries.slice(0, 5)) {
    const j = await api(env, Object.assign({action: "query", generator: "search", gsrsearch: q + " filetype:bitmap", gsrnamespace: "6", gsrlimit: "12"}, ii));
    const pages = (j.query && j.query.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0));
    // у назві файлу — усі позначення з цифрами із запиту («T-72B3» → t72b3), а без цифр — шифр
    // позначення з цифрами (напр. «2s42») саме по собі ненадійне — разом із шифром («lotos»), якщо він є в запиті
    const need = needOf(q);
    if (!need.length) continue;
    const fit = pages.filter((p) => { const t = nz(p.title); return need.every((k) => t.includes(k)); });
    take(fit, false);
    if (out.length) return out;
    pool.push(fit);
  }
  for (const fit of pool) take(fit, true);   // креслення, модель, макет
  if (out.length) return out;
  return armyInform(env, id).catch(() => []);
}

/* АрміяInform: WordPress-сайт Міноборони; матеріали — CC BY 4.0 з обов'язковим посиланням.
   Беремо головне фото статті, у заголовку якої є шифр або позначення зразка. */
async function armyInform(env, id) {
  if (env.ARMYINFORM === "0") return [];
  const name = NAMES[id] || "", code = (name.match(/«([^»]+)»/) || [])[1] || "";
  const desig = name.replace(/^[^\s]+\s+/, "").replace(/\s*«[^»]*»/g, "").replace(/[()]/g, "").trim();
  const base = env.ARMYINFORM_API || "https://armyinform.com.ua/wp-json/wp/v2";
  for (const term of [code, desig].filter((x) => x && x.length >= 3)) {
    const r = await fetch(`${base}/posts?search=${encodeURIComponent(term)}&per_page=6&_fields=link,title,featured_media`, {headers: {"User-Agent": UA, "Accept": "application/json"}});
    if (!r.ok) continue;
    const posts = await r.json();
    const k = nz(term);
    let tries = 0;
    for (const p of posts || []) {
      if (tries >= 2) break;
      if (!p.featured_media || !nz(strip(p.title && p.title.rendered)).includes(k)) continue;
      tries++;
      const mr = await fetch(`${base}/media/${p.featured_media}?_fields=source_url,media_details`, {headers: {"User-Agent": UA, "Accept": "application/json"}});
      if (!mr.ok) continue;
      const m = await mr.json(), sz = (m.media_details && m.media_details.sizes) || {};
      const pick = (sz.large || sz.medium_large || sz.full || {}).source_url || m.source_url;
      if (pick) return [{title: strip(p.title.rendered), url: pick, page: p.link, license: "CC BY 4.0", author: "АрміяInform", loose: false, src: "armyinform"}];
    }
  }
  return [];
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

/* Фото, які надіслав адміністратор: файли media/seed/<id>.jpg, перелік — SEED.
   Імпортуються в базу (card_photos) один раз на версію SEED_V (= сам перелік) і замінюють автопідібране фото.
   <картка>.jpg — головне фото картки; <картка>--altN — ще одне фото для гри й довідника;
   <картка>--refN — лише для довідника (з підписами, вид згори тощо). */
export const SEED = ["tirada", "tirada--ref1", "murmansk", "murmansk--alt1", "murmansk--ref1",
  "r330bmv", "r330bmv--alt1", "marker", "marker--alt1"];
const SEED_V = "ref:" + SEED.join(",");
async function applySeeds(env, metaGet, metaSet) {
  if (!env.ASSETS || (await metaGet(env, "photo_seed")) === SEED_V) return;
  for (const id of SEED) {
    const r = await env.ASSETS.fetch(new Request("https://assets.local/media/seed/" + id + ".jpg"));
    if (!r.ok) throw new Error("seed " + id + " " + r.status);
    const iid = CP + id;   // фото — у довідник, у запис картки (див. cardref.js)
    if (await env.DB.prepare("SELECT id FROM ref_images WHERE id=?").bind(iid).first()) continue;
    await putCardImg(env, id.split("--")[0], {data: b64(await r.arrayBuffer()), credit: "Фото надав адміністратор", imgId: iid, front: !id.includes("--")});
  }
  await metaSet(env, "photo_seed", SEED_V);
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
  try { await applySeeds(env, metaGet, metaSet); } catch (e) { /* наступного разу */ }
  const s = await fillState(env, metaGet);
  if (s.done) return s;
  if (!force && s.lock > Date.now() - LOCK_MS) return s;   // інший дата-центр саме працює, або пауза після збою
  s.lock = Date.now(); await metaSet(env, "photo_fill", JSON.stringify(s));
  if (!s.cleaned) {   // прибрати фото, підібрані раніше, у назві файлу яких явно не техніка (потяги тощо)
    const {results: cr} = await env.DB.prepare("SELECT id, credit FROM card_photos WHERE credit LIKE '%Wikimedia%'").all();
    const {results: rr} = await env.DB.prepare("SELECT id, credit FROM ref_images WHERE id LIKE 'cp\\_%' ESCAPE '\\' AND credit LIKE '%Wikimedia%'").all();
    for (const r of rr) {   // фото карток у довіднику: id cp_<картка>-…
      const card = r.id.slice(CP.length).split("-")[0];
      const cred = (() => { try { return decodeURIComponent(String(r.credit || "")); } catch (e) { return String(r.credit || ""); } })().replace(/_/g, " ");
      const file = (cred.match(/File:([^\s].*?)(\s\(|$)/) || [])[1] || "";
      if (OFF_TOPIC.test(cred) || (file && QUERIES[card] && !fileOk(card, file))) await dropImg(env, r.id);
    }
    for (const r of cr) {
      const cred = (() => { try { return decodeURIComponent(String(r.credit || "")); } catch (e) { return String(r.credit || ""); } })().replace(/_/g, " ");
      const file = (cred.match(/File:([^\s].*?)(\s\(|$)/) || [])[1] || "";
      if (OFF_TOPIC.test(cred) || (file && QUERIES[r.id] && !fileOk(r.id, file))) await env.DB.prepare("DELETE FROM card_photos WHERE id=?").bind(r.id).run();
    }
    s.cleaned = 1;
  }
  const {results} = await env.DB.prepare("SELECT id FROM card_photos").all();
  const have = new Set(results.map((r) => r.id).concat(Object.keys(await cardPics(env))));
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
          const credit = c.src === "armyinform" ? `АрміяInform, ${c.license} — ${c.page}` : `${c.author || "автор невідомий"}, ${c.license}, Wikimedia Commons — ${c.page}${c.loose ? " (креслення/модель)" : ""}`;
          await putCardImg(env, id, {data: t.data, mime: t.mime, credit: credit.slice(0, 400)});
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
