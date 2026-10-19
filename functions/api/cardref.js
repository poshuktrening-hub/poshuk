/* Фото карток живуть у довіднику (одна фотобаза):
   • ref_entries.card — явна прив'язка запису довідника до картки;
   • фото — ref_images; ті, що додано «через картку» (автопідбір, адмінка «Картки», надіслані адміністратором), мають id cp_…;
   • id з «--ref» — лише для довідника (підписи на фото, вид згори), у гру не йдуть;
   • для картки, якої немає в навчальній таблиці, створюється запис-оболонка c_<картка> (тексти бере з картки клієнт).
   Стара таблиця card_photos лишається лише до перенесення (migrateLegacy). */
import {NAMES} from "./photo-queries.js";

export const CP = "cp_";
export const isGameImg = (id) => !String(id).includes("--ref");
const MAX_IMGS = 20;
const now = () => new Date().toISOString();
const J = (s) => { try { return JSON.parse(s || "[]"); } catch (e) { return []; } };

/* Запам'ятати джерела автопідібраних фото, які прибирають (адміністратор чи перевірка): автопошук їх більше не бере.
   Джерело — сторінка фото в кінці підпису («… — https://…»). До 800 останніх. */
export async function rememberReject(env, ids) {
  const list = (ids || []).map(String).filter((x) => x.startsWith(CP));
  if (!list.length) return;
  const pages = [];
  for (const id of list) {
    const r = await env.DB.prepare("SELECT credit FROM ref_images WHERE id=?").bind(id).first();
    const c = String((r && r.credit) || "");
    if (!/Wikimedia|Openverse|flickr|АрміяInform/i.test(c)) continue;   // надіслані адміністратором / завантажені вручну — не джерела автопошуку
    const m = c.match(/—\s*(https?:\/\/\S+)\s*(\(.*\))?$/); if (m) pages.push(m[1]);
  }
  if (!pages.length) return;
  let old = []; try { old = JSON.parse((await env.DB.prepare("SELECT v FROM meta WHERE k='photo_reject'").first() || {}).v || "[]"); } catch (e) { old = []; }
  const all = [...new Set(old.concat(pages))].slice(-800);
  await env.DB.prepare("INSERT INTO meta (k,v) VALUES ('photo_reject',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(JSON.stringify(all)).run();
}

/* картка → записи довідника з її фото */
export async function linked(env) {
  const {results} = await env.DB.prepare("SELECT id, card, imgs, updated FROM ref_entries WHERE card IS NOT NULL AND card <> '' ORDER BY ord").all();
  const m = new Map();
  for (const r of results) { const a = m.get(r.card) || []; a.push({id: r.id, imgs: J(r.imgs), v: r.updated}); m.set(r.card, a); }
  return m;
}

/* картка → [[id фото, версія, джерело]] — лише фото, придатні для гри */
export async function cardPics(env) {
  const m = await linked(env);
  const {results: cr} = await env.DB.prepare("SELECT id, credit FROM ref_images WHERE credit IS NOT NULL AND credit <> ''").all();
  const credit = new Map(cr.map((r) => [r.id, r.credit]));
  const out = {};
  for (const [card, list] of m) {
    const a = [];
    for (const e of list) for (const im of e.imgs) if (isGameImg(im)) a.push([im, e.v, credit.get(im) || ""]);
    if (a.length) out[card] = a;
  }
  return out;
}

/* запис довідника для картки (перший за порядком) або нова оболонка */
export async function entryFor(env, card) {
  const r = await env.DB.prepare("SELECT id, imgs FROM ref_entries WHERE card=? ORDER BY ord LIMIT 1").bind(card).first();
  if (r) return {id: r.id, imgs: J(r.imgs)};
  const id = "c_" + card;
  await env.DB.prepare("INSERT OR REPLACE INTO ref_entries (id,ord,cat,name,ttx,descr,imgs,updated,card) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, 100000, "", String(NAMES[card] || card).slice(0, 200), "", "", "[]", now(), card).run();
  return {id, imgs: []};
}

/* Додати фото картці. front — першим (обкладинка); replace — замість першого фото «з картки» (cp_). */
export async function putCardImg(env, card, {data, mime = "image/jpeg", credit = "", imgId, front = true, replace = false, pos = null}) {
  const e = await entryFor(env, card), up = now(), st = [];
  const iid = imgId || (CP + card + "-" + Date.now().toString(36));   // id картки не містить «-»
  let imgs = e.imgs.filter((x) => x !== iid);
  if (replace) {
    const old = imgs.find((x) => x.startsWith(CP) && isGameImg(x));
    if (old) { imgs = imgs.filter((x) => x !== old); st.push(env.DB.prepare("DELETE FROM ref_images WHERE id=?").bind(old)); }
  }
  if (pos != null) imgs.splice(Math.min(pos, imgs.length), 0, iid);   // на задану позицію (1 — друге фото)
  else imgs = front ? [iid, ...imgs] : [...imgs, iid];
  for (const x of imgs.slice(MAX_IMGS)) if (x.startsWith(CP)) st.push(env.DB.prepare("DELETE FROM ref_images WHERE id=?").bind(x));
  imgs = imgs.slice(0, MAX_IMGS);
  st.push(env.DB.prepare("INSERT OR REPLACE INTO ref_images (id,data,mime,updated,credit) VALUES (?,?,?,?,?)").bind(iid, data, mime, up, String(credit || "").slice(0, 400)));
  st.push(env.DB.prepare("UPDATE ref_entries SET imgs=?, updated=? WHERE id=?").bind(JSON.stringify(imgs), up, e.id));
  await env.DB.batch(st);
  return {entry: e.id, img: iid, updated: up};
}

/* Прибрати перше фото «з картки». Фото з навчальної таблиці так не видаляються — лише в «Довіднику». */
export async function delCardImg(env, card) {
  const m = await linked(env);
  for (const e of m.get(card) || []) {
    const old = e.imgs.find((x) => x.startsWith(CP) && isGameImg(x));
    if (!old) continue;
    await rememberReject(env, [old]);
    await env.DB.batch([env.DB.prepare("DELETE FROM ref_images WHERE id=?").bind(old),
      env.DB.prepare("UPDATE ref_entries SET imgs=?, updated=? WHERE id=?").bind(JSON.stringify(e.imgs.filter((x) => x !== old)), now(), e.id)]);
    return true;
  }
  return false;
}

/* Видалити окреме фото довідника разом із посиланням із запису (для очищення невдалих автопідборів). */
export async function dropImg(env, imgId) {
  await rememberReject(env, [imgId]);
  const {results} = await env.DB.prepare("SELECT id, imgs FROM ref_entries WHERE imgs LIKE ?").bind(`%"${imgId}"%`).all();
  const st = [env.DB.prepare("DELETE FROM ref_images WHERE id=?").bind(imgId)];
  for (const r of results) st.push(env.DB.prepare("UPDATE ref_entries SET imgs=?, updated=? WHERE id=?").bind(JSON.stringify(J(r.imgs).filter((x) => x !== imgId)), now(), r.id));
  await env.DB.batch(st);
}

/* Прив'язки «запис → картка» (рахує браузер адміністратора за назвами; один раз, далі вони явні).
   Оболонку c_X, для якої з'явився справжній запис картки X, зливаємо в нього. */
export async function setLinks(env, links) {
  const st = [];
  for (const [eid, card] of (links || []).slice(0, 2000)) {
    if (!/^[a-z0-9_-]+$/i.test(String(eid)) || !/^[a-z0-9_]+$/.test(String(card))) continue;
    st.push(env.DB.prepare("UPDATE ref_entries SET card=? WHERE id=? AND (card IS NULL OR card='')").bind(String(card), String(eid)));
  }
  for (let i = 0; i < st.length; i += 100) await env.DB.batch(st.slice(i, i + 100));
  // оболонки, що тепер дублюють справжній запис
  const {results} = await env.DB.prepare("SELECT id, card, imgs, ord FROM ref_entries WHERE card IS NOT NULL AND card <> '' ORDER BY ord").all();
  const real = new Map();
  for (const r of results) if (!r.id.startsWith("c_") && !real.has(r.card)) real.set(r.card, r);
  let merged = 0;
  for (const r of results) {
    if (!r.id.startsWith("c_") || !real.has(r.card)) continue;
    const t = real.get(r.card), imgs = J(t.imgs);
    for (const x of J(r.imgs)) if (!imgs.includes(x)) imgs.push(x);
    t.imgs = JSON.stringify(imgs.slice(0, MAX_IMGS));
    await env.DB.batch([env.DB.prepare("UPDATE ref_entries SET imgs=?, updated=? WHERE id=?").bind(t.imgs, now(), t.id), env.DB.prepare("DELETE FROM ref_entries WHERE id=?").bind(r.id)]);
    merged++;
  }
  return merged;
}

/* Перенести старі фото карток (card_photos) у довідник — порціями, щоб уміститися в ліміти запиту. */
export async function migrateLegacy(env, max = 15) {
  const {results} = await env.DB.prepare("SELECT id FROM card_photos LIMIT ?").bind(max).all();
  for (const {id} of results) {
    const r = await env.DB.prepare("SELECT data, mime, credit FROM card_photos WHERE id=?").bind(id).first();
    if (r && r.data) {
      const card = id.split("--")[0], iid = CP + id;
      const ex = await env.DB.prepare("SELECT id FROM ref_images WHERE id=?").bind(iid).first();
      if (!ex) await putCardImg(env, card, {data: r.data, mime: r.mime || "image/jpeg", credit: r.credit || "", imgId: iid, front: !id.includes("--")});
    }
    await env.DB.prepare("DELETE FROM card_photos WHERE id=?").bind(id).run();
  }
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM card_photos").first();
  return (left && left.n) || 0;
}
