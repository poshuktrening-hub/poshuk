/* Збирає functions/api/photo-queries.js із карток (js/cards-data*.js) і запитів до Вікісховища (js/cards-commons.js, cards-data3.js):
   перелік карток, яким сервер у фоні сам підбирає вільне фото. Запускати після зміни карток: node tools/build-photo-queries.js */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
global.window = {};
for (const f of ["cards-data", "cards-data3", "cards-commons", "cards-data2"]) require(path.join(__dirname, "..", "js", f + ".js"));
const ref = window.CARD_REF || {}, com = window.CARD_COMMONS || {};
const order = [], queries = {}, names = {}, variants = {};
for (const [id, name, al] of window.CARDS) {
  if (ref[id]) continue;   // є фото з довідника
  order.push(id); names[id] = name;
  queries[id] = com[id] && com[id].length ? com[id] : [name.replace(/^[^\s]+\s+/, "").replace(/[«»]/g, "")];
  // запасні запити кирилицею: шифр у лапках, позначення з назви, синоніми (у т. ч. російське написання)
  const code = (name.match(/«([^»]+)»/) || [])[1] || "";
  const desig = name.replace(/^[^\s]+\s+/, "").replace(/\s*«[^»]*»/g, "").replace(/[()]/g, "").trim();
  const alts = String(al || "").split("|").map((x) => x.trim()).filter((x) => x.length >= 4 && /[а-яіїєґ]/i.test(x));
  const v = [];
  for (const x of [code && desig ? `${desig} ${code}` : "", code, desig, ...alts]) if (x && x.length >= 3 && !v.some((y) => y.toLowerCase() === x.toLowerCase())) v.push(x);
  // російське написання (на Вікісховищі багато файлів з mil.ru): і/ї→и, є→е
  const ru = (x) => x.replace(/[іїІЇ]/g, (c) => (c === c.toLowerCase() ? "и" : "И")).replace(/є/g, "е").replace(/Є/g, "Е");
  for (const x of v.slice(0, 2)) { const r = ru(x); if (r !== x && !v.includes(r)) v.splice(1, 0, r); }
  variants[id] = v.slice(0, 5);
}
const v = "2-" + crypto.createHash("sha1").update(JSON.stringify([order, queries, variants])).digest("hex").slice(0, 10);
const out = `/* Згенеровано tools/build-photo-queries.js — не редагувати вручну. Картки без фото з довідника та запити до Вікісховища. */
export const LIST_V = ${JSON.stringify(v)};
export const ORDER = ${JSON.stringify(order)};
export const NAMES = ${JSON.stringify(names)};
export const QUERIES = ${JSON.stringify(queries)};
export const VARIANTS = ${JSON.stringify(variants)};
`;
fs.writeFileSync(path.join(__dirname, "..", "functions", "api", "photo-queries.js"), out);
console.log("cards:", order.length, "version:", v, "without query from commons list:", order.filter((id) => !com[id]).length);
