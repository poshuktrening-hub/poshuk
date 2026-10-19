/* Збирає functions/api/photo-queries.js із карток (js/cards-data*.js) і запитів до Вікісховища (js/cards-commons.js, cards-data3.js):
   перелік карток, яким сервер у фоні сам підбирає вільне фото. Запускати після зміни карток: node tools/build-photo-queries.js */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
global.window = {};
for (const f of ["cards-data", "cards-data3", "cards-commons", "cards-data2", "cards-own"]) require(path.join(__dirname, "..", "js", f + ".js"));
const ref = window.CARD_REF || {}, com = window.CARD_COMMONS || {};
const order = [], queries = {}, names = {}, variants = {}, indexes = {}, codes = {}, typew = {}, strong = {};
const nz = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9а-яіїєґ]/g, "");
// російське написання (на Вікісховищі багато файлів з mil.ru): і/ї→и, є→е
const ru = (x) => x.replace(/[іїІЇ]/g, (c) => (c === c.toLowerCase() ? "и" : "И")).replace(/є/g, "е").replace(/Є/g, "Е").replace(/ськ/g, "ск").replace(/СЬК/g, "СК");
/* Латиниця: усі поширені варіанти транслітерації (Khrizantema/Hrizantema, Akatsiya/Akaciya), найуживаніший — першим. */
const TR = {а: ["a"], б: ["b"], в: ["v"], г: ["g", "h"], ґ: ["g"], д: ["d"], е: ["e"], є: ["ye", "e", "je"], ж: ["zh"], з: ["z"], и: ["i", "y"], і: ["i"], ї: ["yi", "i"],
  й: ["y", "j", "i"], к: ["k"], л: ["l"], м: ["m"], н: ["n"], о: ["o"], п: ["p"], р: ["r"], с: ["s"], т: ["t"], у: ["u"], ф: ["f"], х: ["kh", "h", "x"], ц: ["ts", "c"],
  ч: ["ch"], ш: ["sh"], щ: ["shch", "sch"], ь: [""], ю: ["yu", "iu", "ju"], я: ["ya", "ia", "ja"], ы: ["y"], э: ["e"], ё: ["yo", "e", "jo"], ъ: [""]};
// схожі латинські літери: «2C19», «T-72» часто набирають латиницею
const LOOK = {а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", х: "x", у: "y", і: "i"};
function translit(x) {
  let out = [""];
  for (const ch of x) { const v = TR[ch] || [ch]; out = out.flatMap((p) => v.map((y) => p + y)); if (out.length > 48) out = out.slice(0, 48); }
  return [...new Set(out)].slice(0, 12);
}
/* Усі написання позначення: кирилиця (укр., рос.), латиниця, схожі латинські літери. */
function forms(tok) {
  const a = nz(tok), b = nz(ru(tok)), out = new Set([a, b, ...translit(a), ...translit(b)]);
  if ([...a].every((c) => /[0-9]/.test(c) || LOOK[c])) out.add([...a].map((c) => LOOK[c] || c).join(""));
  return [...out].filter(Boolean);
}
for (const [id, name, al] of window.CARDS) {
  if (ref[id]) continue;   // є фото з довідника
  order.push(id); names[id] = name;
  queries[id] = com[id] && com[id].length ? com[id] : [name.replace(/^[^\s]+\s+/, "").replace(/[«»]/g, "")];
  // запасні запити кирилицею: шифр у лапках, позначення з назви, синоніми (у т. ч. російське написання)
  const code = (name.match(/«([^»]+)»/) || [])[1] || "";
  const desig = name.replace(/^[^\s]+\s+/, "").replace(/\s*«[^»]*»/g, "").replace(/[()]/g, "").trim();
  // синоніми — лише з позначенням (цифри) або шифр із назви; загальні слова («цистерна», «бензовоз») дають чужі фото
  const lc = name.toLowerCase();
  const alts = String(al || "").split("|").map((x) => x.trim()).filter((x) => x.length >= 4 && /[а-яіїєґ]/i.test(x) && (/\d/.test(x) || (code && lc.includes(x.toLowerCase()))));
  const v = [];
  for (const x of [code && desig ? `${desig} ${code}` : "", code, desig, ...alts]) if (x && x.length >= 3 && !v.some((y) => y.toLowerCase() === x.toLowerCase())) v.push(x);
  for (const x of v.slice(0, 2)) { const r = ru(x); if (r !== x && !v.includes(r)) v.splice(1, 0, r); }
  // лише запити з позначенням (цифри) або шифром: самі «КамАЗ», «Урал» знаходять будь-яку машину на тому ж шасі
  const has = (x, c) => c && (x.toLowerCase().includes(c.toLowerCase()) || x.toLowerCase().includes(ru(c).toLowerCase()));
  let good = v.filter((x) => /\d/.test(x) || has(x, code));
  if (!good.length && desig.split(/\s+/).length >= 2) good = [desig];
  // + латиницею (файли «GAZ-2330», «9K317 Buk-M2» без шифру англійською): перший варіант транслітерації, дефіси й пробіли лишаються
  const lat = (x) => [...x].map((c) => { const l = c.toLowerCase(), t = (TR[l] || [c])[0]; return c === l ? t : t.charAt(0).toUpperCase() + t.slice(1); }).join("");
  for (const x of good.slice(0, 3)) { const l = lat(x); if (l !== x && !good.includes(l) && nz(l) !== nz(queries[id][0])) good.push(l); }
  variants[id] = good.slice(0, 8);
  /* Правило В автопошуку: у назві файлу має бути індекс картки (з цифрами) або її шифр — у будь-якому написанні.
     Індекс — слово з цифрами з назви картки, крім років (2022), колісних формул (4х4) і коротких чисел. */
  const toks = name.split(/[\s«»“”"(),;\/]+/).filter(Boolean);
  // індекс — лише поза «лапками»: «Москва-1», «Ланцет-3» — це шифри (місто, слово), а не індекси
  const outside = name.replace(/«[^»]*»/g, " ").split(/[\s“”"(),;\/]+/).filter(Boolean);
  const dg = outside.filter((t) => /\d/.test(t)).map((t) => t.replace(/^[^а-яіїєґa-z0-9]+|[^а-яіїєґa-z0-9]+$/gi, ""))
    .filter((t) => nz(t).length >= 3 && !/^\d+[xх]\d+$/i.test(t) && !(/^\d+$/.test(nz(t)) && nz(t).length < 5));
  indexes[id] = [...new Set(dg.flatMap(forms))].slice(0, 24);
  // шифр: усе в «лапках» (і його частина до цифр: «Ланцет-3» → ланцет), а також абревіатури (МТ-ЛБ, БТР-Д), крім першого слова-типу
  const cs = [...name.matchAll(/«([^»]+)»/g)].map((m) => m[1]);
  for (const c of cs.slice()) {
    const head = c.split(/[-\s]?\d/)[0]; if (/\d/.test(c) && head && nz(head).length >= 4) cs.push(head);   // «Ланцет-3» → ланцет
    const h2 = c.split(/[-\s]/)[0]; if (h2 !== c && nz(c).length >= 5 && nz(h2).length >= 3 && !/\d/.test(h2) && !/^[A-Za-z]+\s[A-Za-z]/.test(c)) cs.push(h2);   // «Оса-АКМ» → оса, «Тигр-М СпН» → тигр; «Big Bird» — лише цілим
  }
  // абревіатури — лише поза «лапками»: «Big Bird», «Argus» — звичайні слова, не позначення
  const abbr = outside.slice(1).filter((t) => (/^[А-ЯІЇЄҐA-Z]{2,}(-[А-ЯІЇЄҐA-Z][А-ЯІЇЄҐA-Zа-яіїєґ]*)*$/.test(t) || /^[A-Za-z][A-Za-z-]{3,}$/.test(t)) && !/\d/.test(t));   // абревіатури та латинські назви (ZALA, Desertcross)
  const cf = [...new Set([...cs.flatMap(forms).filter((x) => x.length >= 3), ...abbr.flatMap(forms).filter((x) => x.length >= 3)])];
  codes[id] = cf.slice(0, 24);
  // «сильні» шифри — самі по собі позначення: абревіатури (МТ-ЛБ) і шифри з літерним індексом через дефіс (Панцир-СМ, Мурманськ-БН, Тигр-М)
  strong[id] = [...new Set([...abbr.flatMap(forms), ...[...name.matchAll(/«([^»]+)»/g)].map((m) => m[1]).filter((c) => /-[А-ЯІЇЄҐA-Z]/.test(c)).flatMap(forms)])].filter((x) => x.length >= 3).slice(0, 24);
  // слова типу техніки: файл, що збігся лише за шифром (без індексу), має містити ще й тип («Булат» + detector)
  const first = String(name.split(/\s+/)[0] || "").toLowerCase();
  const TYPE = {"бпла": "drone uav бпла бла дрон беспилотник", "реб": "electronic warfare jamming jammer ew реб рэб", "рер": "electronic intelligence sigint reconnaissance рер ртр",
    "ракета": "missile rocket ракета", "бомба": "bomb бомба фаб", "рлс": "radar рлс рлк радар", "танк": "tank танк", "сау": "howitzer artillery gun сау", "бмп": "ifv bmp бмп",
    "бтр": "apc btr бтр", "корабель": "ship vessel corvette frigate корабль корабель", "крейсер": "cruiser крейсер", "катер": "boat катер", "підводний": "submarine подводная підводний",
    "літак": "aircraft plane bomber fighter самолет літак", "гелікоптер": "helicopter вертолет гелікоптер", "робот": "robot ugv робот", "гранатомет": "grenade launcher гранатомет",
    "зрк": "sam missile launcher зрк", "зргк": "sam зргк зрпк", "птрк": "atgm птрк", "бронеавтомобіль": "armoured armored vehicle бронеавтомобиль бронеавтомобіль", "лазерний": "laser лазер",
    "мінний": "mine minelayer минный мінний", "рсзв": "mlrs rocket рсзо рсзв", "отрк": "missile launcher отрк"};
  const extra = (queries[id][0] || "").split(/\s+/).map(nz).filter((w) => w.length >= 4 && !/\d/.test(w) && !cf.includes(w));
  typew[id] = [...new Set([...(TYPE[first] || "").split(" ").filter(Boolean).map(nz), ...extra])].slice(0, 16);
}
const v = "4-" + crypto.createHash("sha1").update(JSON.stringify([order, queries, variants, indexes, codes, typew, strong])).digest("hex").slice(0, 10);
const out = `/* Згенеровано tools/build-photo-queries.js — не редагувати вручну. Картки без фото з довідника та запити до Вікісховища. */
export const LIST_V = ${JSON.stringify(v)};
export const ORDER = ${JSON.stringify(order)};
export const NAMES = ${JSON.stringify(names)};
export const QUERIES = ${JSON.stringify(queries)};
export const VARIANTS = ${JSON.stringify(variants)};
export const DESIG = ${JSON.stringify(indexes)};
export const CODES = ${JSON.stringify(codes)};
export const TYPEW = ${JSON.stringify(typew)};
export const STRONG = ${JSON.stringify(strong)};
`;
fs.writeFileSync(path.join(__dirname, "..", "functions", "api", "photo-queries.js"), out);
console.log("cards:", order.length, "version:", v, "without query from commons list:", order.filter((id) => !com[id]).length,
  "without index/code:", order.filter((id) => !indexes[id].length && !codes[id].length).map((id) => names[id]).join("; "));
