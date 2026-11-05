/* Розпізнавання написів на фото (адмінка → Картки → «Перевірити фото на написи»).
   Tesseract.js, усе своє (media/ocr: рушій, мови укр+рос+англ) — нічого не йде в сторонні сервіси; вантажиться лише тут (~12 МБ, далі в кеші).
   Завдання: знайти фото-підказки — назва чи індекс техніки на самому знімку («2С19 Мста-С», «Т-72Б3», підписи, водяні знаки). */
(function () {
  const abs = (p) => new URL(p, location.href).href;
  let sched = null, loading = null, nWorkers = 0;

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (window.Tesseract) return res();
      const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Не завантажився модуль розпізнавання (media/ocr)"));
      document.head.appendChild(s);
    });
  }
  /* Пул воркерів (до 3 — більше пам'яті, а виграш малий). */
  async function init(onStatus) {
    if (sched) return sched;
    if (loading) return loading;
    loading = (async () => {
      onStatus && onStatus("Завантажую модуль розпізнавання (разовий, ~12 МБ)…");
      await loadScript(abs("media/ocr/tesseract.min.js"));
      const s = Tesseract.createScheduler(), n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
      for (let i = 0; i < n; i++) {
        const w = await Tesseract.createWorker(["ukr", "rus", "eng"], 1, {
          workerPath: abs("media/ocr/worker.min.js"), corePath: abs("media/ocr/"), langPath: abs("media/ocr/"),
          workerBlobURL: false, gzip: true, cacheMethod: "none",
        });
        s.addWorker(w); nWorkers++;
        onStatus && onStatus(`Модуль розпізнавання: ${i + 1}/${n}…`);
      }
      sched = s; return s;
    })();
    try { return await loading; } catch (e) { loading = null; throw e; }
  }
  async function stop() { if (sched) { try { await sched.terminate(); } catch (e) { /* ок */ } } sched = null; loading = null; nWorkers = 0; }

  const MAXSIDE = 1600;
  async function toCanvas(url) {
    const r = await fetch(url); if (!r.ok) throw new Error("Фото не завантажилось");
    const bmp = await createImageBitmap(await r.blob()), k = Math.min(1, MAXSIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  /* Ключі картки: позначення й назви, зведені до однієї абетки (Cards.norm: латиниця↔кирилиця, без дефісів). */
  function keysOf(card) {
    const set = new Set();
    for (const a of [card.name, ...(card.aliases || []), card.id]) {
      const n = Cards.norm(String(a || "").replace(/^(танк|бмп|бмд|бтр|брдм|сау|рсзв|гаубиця|гармата|вантажівка|автомобіль|бронеавтомобіль|зрк|рлс|реб|мінометі?)\s+/i, ""));
      if (n.length >= 2) set.add(n);
      for (const w of String(a || "").split(/[\s«»"()]+/)) { const m = Cards.norm(w); if (m.length >= 3 && /[a-zа-яіїєґ]/i.test(m) && !/^(танк|бмп|вантажівка|автомобіль|броньований|бронеавтомобіль)$/.test(m)) set.add(m); }
    }
    return [...set];
  }
  /* Оцінка слів: «name» — слово збігається з назвою/позначенням картки (явна підказка); «text» — інший впевнений напис. */
  function judge(words, card) {
    const keys = card ? keysOf(card) : [], out = [];
    for (const w of words) {
      const raw = String(w.text || "").trim(), conf = w.confidence || 0;
      const alnum = raw.replace(/[^0-9A-Za-zА-Яа-яІіЇїЄєҐґ]/g, "");
      if (alnum.length < 2) continue;
      const nrm = Cards.norm(alnum);
      const isName = conf >= 50 && nrm.length >= 2 && keys.some((k) => (nrm.length >= 3 || /\d/.test(nrm)) && (k === nrm || (nrm.length >= 3 && (k.includes(nrm) || nrm.includes(k)) && Math.min(k.length, nrm.length) >= 3)));
      const letters = (alnum.match(/[A-Za-zА-Яа-яІіЇїЄєҐґ]/g) || []).length, digits = alnum.length - letters;
      const isText = (letters >= 4 && conf >= 78) || (letters >= 1 && digits >= 1 && alnum.length >= 3 && conf >= 72);
      if (isName) out.push({t: raw, c: Math.round(conf), kind: "name"});
      else if (isText) out.push({t: raw, c: Math.round(conf), kind: "text"});
    }
    return out;
  }
  /* Перевірка одного фото: повертає {hits:[{t,c,kind}], level:"name"|"text"|"clean"}. */
  async function check(url, card, onStatus) {
    const s = await init(onStatus), c = await toCanvas(url);
    const r = await s.addJob("recognize", c, {}, {blocks: true});
    const words = [];
    for (const b of r.data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) words.push(w);
    const hits = judge(words.length ? words : (r.data.words || []), card);
    return {hits, level: hits.some((h) => h.kind === "name") ? "name" : hits.length ? "text" : "clean"};
  }
  window.Ocr = {init, stop, check, judge, keysOf, get workers() { return nWorkers; }};
})();
