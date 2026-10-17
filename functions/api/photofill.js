/* Автопідбір фото для карток без фото — у фоні на сервері (Cloudflare має вихід у Вікісховище, телефон адміна не потрібен).
   Кожен запит до сайту, не частіше разу на 30 с, обробляє 2 картки: пошук у Wikimedia Commons за запитом картки,
   лише вільні ліцензії (CC0, PD, CC BY, CC BY-SA), ширина ≥ 700; якщо справжнього фото немає — креслення, модель або макет.
   Фото зберігається як у ручному підборі (card_photos: мініатюра 1280 px + підпис автора/ліцензії).
   Стан — у meta «photo_fill»: позиція у переліку, скільки знайдено, яких не знайдено. Перелік — photo-queries.js. */
import {LIST_V, ORDER, NAMES, QUERIES, VARIANTS, DESIG, CODES} from "./photo-queries.js";
import {cardPics, putCardImg, dropImg, CP} from "./cardref.js";

const UA = "poshuk-trener/1.0 (https://poshuk.pages.dev; contact: mrqwerty841@gmail.com)";
const PER_TICK = 1, TICK_MS = 20e3,   // до ~20 підзапитів на картку — в межах ліміту 50 на запит
      LOCK_MS = 90e3, BACKOFF_MS = 10 * 60e3;
const FREE = (lic) => { const l = String(lic || "").toLowerCase(); return !/nc|nd|fair|non-free/.test(l) && /(cc0|public domain|pd|cc by|cc-by|attribution)/.test(l); };
const BAD_STRICT = /decoy|inflatable|maket|макет|model|toy|replica|lego|interior|operators|cutaway|diagram|scheme|drawing|blueprint|emblem|logo|\bmap\b|poster|stamp/i;
const BAD_LOOSE = /toy|lego|emblem|logo|\bmap\b|interior|operators|stamp|poster|flag|coat of arms/i;
/* Явно не військова техніка (позначення «2S42» буває номером потяга тощо) — ніколи не беремо. */
export const OFF_TOPIC = /train|railway|railroad|rail\b|station|locomotive|\btram|\bbus\b|metro|subway|platform|class \d|class_\d|airport|stadium|church|street|football|concert|car show|bmw|audi|mercedes|porsche|tractor|harvester|coin|banknote|medal|insect|mosquito|spray|cosmetic|perfume|skin|bottle|beetle|tick\b|tank car|tankcar|tank wagon|railcar|rail car|freight|wagon|вагон|цистерна \d|залізнич|железнодорож|\bржд\b|\bуз\b/i;
/* Загальні слова запиту — не ключі (правило А): тип техніки, країна, рід військ, місце. */
const STOP = /^(tank|self|propelled|howitzer|system|launcher|vehicle|radar|truck|missile|class|project|ship|boat|russian|military|mod|obr|russia|soviet|ukraine|ukrainian|army|navy|force|forces|federation|ground|armed|parade|exhibition|museum|forum|complex|combat|artillery|rocket|infantry|fighting|armoured|armored|carrier|personnel|command|post|station|mobile|electronic|warfare|jamming|drone|uav|helicopter|aircraft|bomber|fighter|attack|jet|corvette|frigate|submarine|landing|craft|minesweeper|patrol|cruise|ballistic|anti|defense|defence|surface|mlrs|atgm|apc|ifv|mbt|tel|telar|transporter|loader|tractor|engineering|bridge|pontoon|layer|mine|clearing|recovery|repair|ambulance|fuel|tanker|cargo|utility|light|heavy|medium|tactical|strategic|coastal|naval|air|sam|spg|sph|gun|cannon|mortar|antitank|antiaircraft|battery|regiment|brigade|division|photo|image|picture|view|front|side|rear|left|right|top)$/;
/* ---------- Правила відбору фото (ті самі для Вікісховища, Openverse, АрміяInform і для перевірки вже підібраних):
   А. Запит: у назві файлу (чи тегах) — усі ключі запиту: кожне слово з цифрами (індекс) + перше не загальне слово;
      якщо в запиті немає індексу — усі його слова (загальні «tank», «truck», «russian»… не рахуються).
   Б. Індекс — лише цілим: не частина довшого (2С1 ≠ 2С19, 9К33 ≠ 9К330), але «АТЗ-10-4320», «2С19М2», «Т-72Б3М» — підходять.
   В. Своя назва: у файлі має бути індекс самої картки (Т-72Б3 / T-72B3 / 2C19 латиницею) або її шифр («Іскандер-М» / Iskander-M)
      у будь-якому написанні — крім карток, запит яких суто описовий («turtle tank»): там досить правила А.
   Г. Не беремо: потяги, вагони, станції, цивільні авто…; для справжніх фото — також макети, іграшки, моделі, схеми, інтер'єри;
      ширина < 600 пкс; невільні ліцензії (NC, ND, fair use).
   Д. Порядок джерел: Вікісховище → Openverse (Flickr та ін.) → креслення/моделі з Вікісховища (з позначкою) → АрміяInform. */
/* Нормалізований текст із картою позицій — щоб бачити, що стоїть навколо збігу в оригіналі (правило Б). */
function nzMap(s) {
  const o = String(s || "").toLowerCase(); let t = ""; const map = [];
  for (let i = 0; i < o.length; i++) if (/[a-z0-9а-яіїєґ]/.test(o[i])) { t += o[i]; map.push(i); }
  return {t, o, map};
}
/* Ключ є в тексті як ціле слово/позначення (правило Б): збіг не може бути приклеєний до цифри цифрою (2С1 ≠ 2С19)
   чи до літери літерою (Tigr ≠ Tigris, Оса ≠ Мімоза); літера після цифри — можна (Т-72Б3М для Т-72Б3). */
function hasKey(m, k) {
  const d = /\d/, l = /[a-zа-яіїєґё]/, glued = (a, b) => a !== undefined && b !== undefined && ((d.test(a) && d.test(b)) || (l.test(a) && l.test(b)));
  for (let i = m.t.indexOf(k); i >= 0; i = m.t.indexOf(k, i + 1)) {
    const before = m.o[m.map[i] - 1], after = m.o[m.map[i + k.length - 1] + 1];
    if (glued(k[0], before) || glued(k[k.length - 1], after)) continue;
    return true;
  }
  return false;
}
/* Ключі запиту (правило А). */
function needOf(q) {
  const t = String(q || "").split(/\s+/);
  const keys = t.filter((w) => /\d/.test(w)).map(nz).filter((w) => w.length >= 3);
  const words = t.filter((w) => !/\d/.test(w)).map(nz).filter((w) => w.length >= 4 && !STOP.test(w));
  return keys.length ? keys.concat(words.slice(0, 1)) : words;
}
/* Правило А для одного запиту. Короткий індекс із цифри (2С1, 9К33 — схожі на номери потягів тощо) сам по собі не достатній:
   якщо в картки є шифр, у файлі має бути і він. */
function queryOk(q, text, id) {
  const n = needOf(q); if (!n.length) return false;
  const m = nzMap(text);
  if (!n.every((k) => hasKey(m, k))) return false;
  const weak = n.every((k) => /^\d/.test(k) && k.length <= 5);
  if (weak && id && (CODES[id] || []).length && !CODES[id].some((k) => hasKey(m, k))) return false;
  return true;
}
/* Правило В: індекс або шифр самої картки. */
function cardOk(id, text) {
  const own = [...(DESIG[id] || []), ...(CODES[id] || [])];
  if (!own.length) return true;
  const m = nzMap(text);
  if (own.some((k) => hasKey(m, k))) return true;
  if ((DESIG[id] || []).length) return false;   // картка з індексом: індекс або шифр обов'язкові
  const q = (QUERIES[id] || [])[0] || "", qm = nzMap(q);
  return !(/\d/.test(q) || own.some((k) => hasKey(qm, k)));   // шифр є, але запит суто описовий («turtle tank») — досить правила А
}
/* Назва файлу підходить картці: правило В + хоча б один із запитів картки за правилом А. */
function fileOk(id, title) {
  return cardOk(id, title) && [(QUERIES[id] || [])[0], ...(VARIANTS[id] || [])].filter(Boolean).some((q) => queryOk(q, title, id));
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
   5) Openverse (Flickr та інші вільні джерела), 6) АрміяInform (сайт Міноборони, CC BY 4.0): фото до статті про знищення/захоплення зразка.
   (порядок 4↔5: креслення з Вікісховища — лише якщо ніде немає справжнього фото) */
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
    if (!needOf(q).length) continue;
    const fit = pages.filter((p) => queryOk(q, p.title, id) && cardOk(id, p.title));
    take(fit, false);
    if (out.length) return out;
    pool.push(fit);
  }
  // інші вільні джерела (Flickr тощо через Openverse) — справжнє фото краще за креслення з Вікісховища
  const ov = await openverse(env, id, queries).catch(() => []);
  if (ov.length) return ov;
  for (const fit of pool) take(fit, true);   // креслення, модель, макет
  if (out.length) return out;
  return armyInform(env, id).catch(() => []);
}

/* Openverse — відкритий каталог зображень під вільними ліцензіями (Flickr, музеї, Вікісховище…).
   Лише CC0, суспільне надбання, CC BY, CC BY-SA; у назві або тегах — ті самі позначення, що й для Вікісховища. */
async function openverse(env, id, queries) {
  if (env.OPENVERSE === "0") return [];
  const base = env.OPENVERSE_API || "https://api.openverse.org/v1";
  const out = [], seen = new Set();
  for (const q of queries.filter((x) => !/[а-яіїєґ]/i.test(x)).slice(0, 2)) {
    if (!needOf(q).length) continue;
    const r = await fetch(`${base}/images/?q=${encodeURIComponent(q)}&license=by,by-sa,cc0,pdm&page_size=20`, {headers: {"User-Agent": UA, "Accept": "application/json"}});
    if (!r.ok) continue;
    const j = await r.json();
    for (const x of j.results || []) {
      const text = [x.title, ...(x.tags || []).map((t) => t.name)].join(" ");
      if (!x.url || seen.has(x.url) || (x.width && x.width < 600) || BAD_STRICT.test(text) || OFF_TOPIC.test(text)) continue;
      if (!queryOk(q, text, id) || !cardOk(id, text)) continue;
      seen.add(x.url);
      // Flickr: середній розмір (1024 пкс) замість оригіналу на кілька МБ
      const url = /staticflickr\.com/.test(x.url) ? x.url.replace(/(_[a-z])?\.(jpg|jpeg|png)$/i, "_b.$2") : x.url;
      const lic = x.license === "pdm" ? "Public domain" : x.license === "cc0" ? "CC0" : `CC ${String(x.license).toUpperCase()} ${x.license_version || ""}`.trim();
      out.push({title: x.title || "", url, alt: x.thumbnail, page: x.foreign_landing_url || x.url, license: lic, author: String(x.creator || "автор невідомий").slice(0, 120),
        provider: x.source || x.provider || "Openverse", src: "openverse"});
      if (out.length >= 3) return out;
    }
  }
  return out;
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
      const title = strip(p.title && p.title.rendered);
      if (!p.featured_media || !nz(title).includes(k) || !cardOk(id, title) || OFF_TOPIC.test(title)) continue;
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

const FILL_V = LIST_V + "+ov1";   // +ov1 — додано Openverse: перелік проходиться ще раз (знайдені фото лишаються)
const WEEK = 7 * 24 * 3600e3;   // фоновий прохід — раз на тиждень (між проходами сервер Вікісховище не чіпає)
const S0 = () => ({v: FILL_V, pos: 0, ok: 0, miss: [], at: 0, lock: 0});
export async function fillState(env, metaGet) {
  let s; try { s = JSON.parse(await metaGet(env, "photo_fill") || "null"); } catch (e) { s = null; }
  if (!s || s.v !== FILL_V) s = S0();
  if (s.pos >= ORDER.length && s.doneAt && Date.now() - s.doneAt > WEEK) s = S0();   // минув тиждень — новий прохід по картках без фото
  return Object.assign(s, {total: ORDER.length, done: s.pos >= ORDER.length});
}
export async function fillReset(env, metaSet, onlyMiss) {
  await metaSet(env, "photo_fill", JSON.stringify(S0()));
}

const creditOf = (c) => (c.src === "armyinform" ? `АрміяInform, ${c.license} — ${c.page}` : c.src === "openverse" ? `${c.author}, ${c.license}, ${c.provider} — ${c.page}`
  : `${c.author || "автор невідомий"}, ${c.license}, Wikimedia Commons — ${c.page}${c.loose ? " (креслення/модель)" : ""}`).slice(0, 400);

/* Пошук для однієї картки (кнопка 🔎 в адмінці): skip — скільки кандидатів пропустити, щоб щоразу було інше фото.
   Знайдене замінює попереднє фото «з картки»; фото з навчальної таблиці не чіпаються. */
export async function fillOne(env, id, skip = 0) {
  if (!QUERIES[id] && !NAMES[id]) return {ok: false, error: "Невідома картка"};
  const list = await candidates(env, id);
  if (!list.length) return {ok: false, found: 0};
  for (let k = 0; k < list.length; k++) {
    const c = list[(skip + k) % list.length];
    try {
      const t = await fetchThumb(c.url).catch((e) => { if (c.alt) return fetchThumb(c.alt); throw e; });
      const r = await putCardImg(env, id, {data: t.data, mime: t.mime, credit: creditOf(c), replace: true});
      return {ok: true, found: list.length, credit: creditOf(c), updated: r.updated};
    } catch (e) { /* наступний кандидат */ }
  }
  return {ok: false, found: list.length};
}

let lastTick = 0;
/* Один крок автопідбору: до PER_TICK карток без фото. Викликається з ctx.waitUntil. */
export async function fillTick(env, metaGet, metaSet, force) {
  if (!force && Date.now() - lastTick < TICK_MS) return null;
  lastTick = Date.now();
  try { await applySeeds(env, metaGet, metaSet); } catch (e) { /* наступного разу */ }
  const s = await fillState(env, metaGet);
  if (s.done) { if (!s.doneAt) { s.doneAt = Date.now(); await metaSet(env, "photo_fill", JSON.stringify(s)); } return s; }
  if (!force && s.lock > Date.now() - LOCK_MS) return s;   // інший дата-центр саме працює, або пауза після збою
  s.lock = Date.now(); await metaSet(env, "photo_fill", JSON.stringify(s));
  if (!s.cleaned) {   // прибрати фото, підібрані раніше, у назві файлу яких явно не техніка (потяги тощо)
    const {results: cr} = await env.DB.prepare("SELECT id, credit FROM card_photos WHERE credit LIKE '%Wikimedia%'").all();
    const {results: rr} = await env.DB.prepare("SELECT id, credit FROM ref_images WHERE id LIKE 'cp\\_%' ESCAPE '\\' AND (credit LIKE '%Wikimedia%' OR credit LIKE '%flickr%' OR credit LIKE '%Openverse%')").all();
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
          const t = await fetchThumb(c.url).catch((e) => { if (c.alt) return fetchThumb(c.alt); throw e; });
          await putCardImg(env, id, {data: t.data, mime: t.mime, credit: creditOf(c)});
          stored = true; break;
        } catch (e) { /* наступний кандидат */ }
      }
      if (stored) s.ok++; else s.miss.push(id);
      s.pos++; n++;
    }
    s.at = Date.now(); s.lock = 0;
    if (s.pos >= ORDER.length) s.doneAt = Date.now();
  } catch (e) {
    s.lock = Date.now() + BACKOFF_MS - LOCK_MS;   // Вікісховище не відповіло — пауза 10 хв, позиція не зсувається
  }
  await metaSet(env, "photo_fill", JSON.stringify(s));
  return Object.assign(s, {total: ORDER.length, done: s.pos >= ORDER.length, names: NAMES});
}
export const fillInfo = (s) => ({pos: s.pos, total: ORDER.length, ok: s.ok, miss: s.miss.map((id) => NAMES[id] || id), done: s.pos >= ORDER.length, at: s.at, paused: s.lock > Date.now(),
  next: s.doneAt ? s.doneAt + WEEK : 0});
export {candidates, fileOk, cardOk, queryOk};   // для локальних перевірок
