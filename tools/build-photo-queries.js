/* Збирає functions/api/photo-queries.js із карток (js/cards-data*.js) і запитів до Вікісховища (js/cards-commons.js, cards-data3.js):
   перелік карток, яким сервер у фоні сам підбирає вільне фото. Запускати після зміни карток: node tools/build-photo-queries.js */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
global.window = {};
for (const f of ["cards-data", "cards-data3", "cards-commons", "cards-data2"]) require(path.join(__dirname, "..", "js", f + ".js"));
const ref = window.CARD_REF || {}, com = window.CARD_COMMONS || {};
const order = [], queries = {}, names = {};
for (const [id, name] of window.CARDS) {
  if (ref[id]) continue;   // є фото з довідника
  order.push(id); names[id] = name;
  queries[id] = com[id] && com[id].length ? com[id] : [name.replace(/^[^\s]+\s+/, "").replace(/[«»]/g, "")];
}
const v = crypto.createHash("sha1").update(JSON.stringify([order, queries])).digest("hex").slice(0, 10);
const out = `/* Згенеровано tools/build-photo-queries.js — не редагувати вручну. Картки без фото з довідника та запити до Вікісховища. */
export const LIST_V = ${JSON.stringify(v)};
export const ORDER = ${JSON.stringify(order)};
export const NAMES = ${JSON.stringify(names)};
export const QUERIES = ${JSON.stringify(queries)};
`;
fs.writeFileSync(path.join(__dirname, "..", "functions", "api", "photo-queries.js"), out);
console.log("cards:", order.length, "version:", v, "without query from commons list:", order.filter((id) => !com[id]).length);
