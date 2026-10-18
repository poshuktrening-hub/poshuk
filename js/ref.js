/* «Довідник техніки»: перегляд без оцінок — фото, ТТХ і характерні ознаки з навчальної таблиці.
   Дані й зображення лежать у базі (доступ лише після входу), а не в коді сайту. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.esc(s);
  /* Додаткові фото від адміністратора (у базі серед фото карток: <картка>--altN, <картка>--refN). */
  const extraPics = (card) => (window.Game && Game.cardPhotos ? [...Game.cardPhotos.keys()].filter((k) => k.startsWith(card + "--")).sort() : []);
  const norm = (s) => (window.Cards ? Cards.norm(s) : String(s || "").toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, ""));
  const plain = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  // у текстах із таблиці дозволено лише <b>; решта вже екранована при імпорті
  // «Ознаки: …» на початку опису зайве (розділ і так «Ознаки та опис») — прибираємо, першу літеру робимо великою
  const noLead = (h) => String(h || "").replace(/^(\s*(?:<[^>]+>\s*)*)Ознаки\s*:\s*(?:<\/b>\s*)?(\S)/i, (m, pre, ch) => pre + ch.toUpperCase());
  const safe = (h) => String(h || "").replace(/<(?!\/?b>)/g, "&lt;");

  /* розділи — у порядку появи в таблиці, всередині розділу — за порядковим номером */
  function sortRef(list) {
    const first = new Map(); list.forEach((e) => { const o = e.ord || 0; if (!first.has(e.cat) || o < first.get(e.cat)) first.set(e.cat, o); });
    return list.slice().sort((a, b) => (first.get(a.cat) - first.get(b.cat)) || String(a.cat).localeCompare(String(b.cat)) || (a.ord || 0) - (b.ord || 0));
  }

  /* Один розділ на один вид техніки: розділи навчальної таблиці й карток часто дублюються («Танки» і «Танки, БМПТ»,
     «Інженерна» і «Інженерна техніка»…) — зводимо до одного. Збірні розділи карток розкладаємо за назвою. */
  function canonCat(cat, name) {
    const c = String(cat || "").replace(/[’ʼ`]/g, "'").trim(), n = String(name || "").toLowerCase();
    const MAP = {"Танки": "Танки, БМПТ", "Танки, БМПТ": "Танки, БМПТ", "Інженерна": "Інженерна техніка", "РЕБ": "Зв'язок, РЕБ", "Зв'язок і КШМ": "Зв'язок, РЕБ",
      "Зв'язок, РЕБ": "Зв'язок, РЕБ", "Автомобілі": "МТО"};
    if (MAP[c]) return MAP[c];
    if (c === "БМП, БТР, броньовики") return /^(бмп|бмд|бмо)|\sбмп|\sбмд/.test(n) ? "БМП, БМД" : /бтр|мт-?лб|брдм|брм|ладога|бмм/.test(n) ? "БТР" : "Бронеавтомобілі";
    if (c === "РСЗВ і ракети") return /рсзв|тос-|тзм|град|ураган|смерч|торнадо|прима|тайфун/.test(n) ? "Реактивна артилерія" : "Ракети й ОТРК";
    if (c === "Артилерія") return /^сау|\s2с\d|^2с\d|самохід/.test(n) ? "Самохідна артилерія" : "Буксирована артилерія";
    return c || "Інше";
  }
  /* розділи — за алфавітом («Інше» — останнім), усередині — порядок таблиці */
  function sortCats(list) {
    const k = (c) => (c === "Інше" ? "яяя" : c);
    return list.slice().sort((a, b) => k(a.cat).localeCompare(k(b.cat), "uk") || (a.ord || 0) - (b.ord || 0));
  }

  const Ref = {
    entries: null, cat: "", q: "",

    async open() {
      if (!Game.password) return;
      UI.show("s-ref");
      document.body.dataset.mode = "ref";
      $("r-back").onclick = () => this.close();
      $("r-q").oninput = (e) => { this.q = e.target.value; this.renderList(); };
      $("r-q").value = this.q;
      this.closeDetail();
      if (!this.entries) {
        $("r-list").innerHTML = `<p class="muted r-empty">Завантажую довідник…</p>`;
        try { this.entries = this.withCards(sortRef((await API.call("ref_list", {}, Game.password)).entries || [])); }
        catch (e) { $("r-list").innerHTML = `<p class="err r-empty">${esc(e.message)}</p>`; return; }
      }
      this.renderCats(); this.renderList();
      $("r-help").onclick = () => Help.show("ref");
      if (window.Help) Help.maybe("ref");
    },
    close() { this.closeDetail(); Game.showStart(); },

    /* Довідник = записи навчальної таблиці + картки, яких у таблиці немає (ТТХ, ознаки, фото картки).
       До кожного запису, що відповідає картці, додаються «Недоліки». */
    withCards(list, onlyLinks) {
      if (!window.Cards) return list;
      const deck = Cards.deck(), idx = new Map(), byId = new Map(deck.map((c) => [c.id, c]));
      // записи-оболонки c_<картка> (картки без запису в таблиці, але з фото): тексти й розділ — з картки
      const shells = [];
      list = list.filter((e) => {
        if (!String(e.id).startsWith("c_")) return true;
        const c = byId.get(e.card); if (!c) return false;
        // тексти: якщо адміністратор заповнив їх у довіднику — вони, інакше з картки
        const own = plain(e.ttx).trim() || plain(e.desc).trim();
        if (!onlyLinks) shells.push(Object.assign(e, {cat: c.concept ? "Концепти й новітні розробки" : Logic.category(c.name), name: c.name,
          ttx: own ? e.ttx : c.p1, desc: own ? e.desc : c.p2, fromCard: !own, concept: c.concept}));
        return false;
      });
      const good = (v) => v.length >= 4 || (v.length === 3 && /\d/.test(v));   // «т72», «д30», «мтлб», «шилка» — але не «бв», «уд»
      const brand = /^(камаз|урал|уаз|газ|зіл|зил|краз|маз|кзкт|тигр)$/;   // сама марка шасі ще не каже, що це за техніка
      for (const c of deck) for (const a of [c.name, ...c.aliases]) { const v = norm(a); if (good(v) && !brand.test(v) && !idx.has(v)) idx.set(v, c.id); }
      const used = new Set(shells.map((e) => e.card));
      for (const e of list) {
        if (e.card && byId.has(e.card)) { used.add(e.card); continue; }   // прив'язка збережена в базі
        e.card = "";
        const name = String(e.name || "");
        // спершу вся назва й частини між роздільниками, далі окремі слова, потім слова ще й по дефісу («9К35-Стрела-10»)
        const parts = name.split(/[\/\\;,()“”"«»]|\s[-–—]\s|\sта\s|\sабо\s/).map(norm).filter(good);
        const words = name.split(/[\s\/\\;,()“”"«»]+/).map(norm).filter(good);
        // шматки через дефіс — лише якщо це не загальне слово типу («брем», «бмп»): інакше «БРЕМ-2» прив'язувався б до БРЕМ-1
        const TYPE = /^(брем|бмп|бмд|бтр|брдм|бат|имр|пмп|птс|сау|рсзв|зрк|рлс|реб|танк|камаз|урал|газ|зил|маз|краз|тигр)$/;
        const sub = name.split(/[\s\/\\;,()“”"«»\-–—]+/).map(norm).filter((w) => good(w) && !TYPE.test(w) && (/\d/.test(w) ? w.length >= 4 : w.length >= 5));
        // ручні відповідності там, де автоматичний збіг неоднозначний (той самий шасі в різних машин)
        const FIX = {[norm("КамАЗ-53949 Линза")]: "linza", [norm("Тайфун-К 53949 4х4")]: "typhoonk4", [norm("Панцирь-СА")]: null};
        if (Object.prototype.hasOwnProperty.call(FIX, norm(name))) { const id = FIX[norm(name)]; if (id && deck.some((c) => c.id === id)) { e.card = id; used.add(id); } continue; }
        for (const p of [norm(name), ...parts, ...words, ...sub]) if (idx.has(p)) { e.card = idx.get(p); used.add(e.card); break; }
      }
      if (onlyLinks) return list;
      const extra = deck.filter((c) => !used.has(c.id)).map((c, i) => ({id: "card:" + c.id, ord: 100000 + i, cat: c.concept ? "Концепти й новітні розробки" : Logic.category(c.name),
        name: c.name, ttx: c.p1, desc: c.p2, imgs: [], card: c.id, fromCard: true, concept: c.concept}));
      return sortCats(list.concat(shells, extra).map((e) => Object.assign(e, {cat: canonCat(e.cat, e.name)})));
    },
    async shellCats(pw) {
      const list = (await API.call("ref_list", {}, pw)).entries || [], byId = new Map(Cards.deck().map((c) => [c.id, c]));
      return list.filter((e) => String(e.id).startsWith("c_") && byId.has(e.card)).map((e) => { const c = byId.get(e.card); return [e.id, c.concept ? "Концепти й новітні розробки" : Logic.category(c.name), c.name]; })
        .filter(([id, cat]) => list.find((x) => x.id === id).cat !== cat);
    },
    /* Адмінка: один раз зберегти в базі прив'язки «запис → картка», знайдені за назвами, і перенести старі фото карток
       у довідник. Далі прив'язки явні — їх можна змінити в записі довідника (поле «Картка»). */
    async syncLinks(pw) {
      if (!window.Cards || this._synced) return;
      const list = (await API.call("ref_list", {}, pw)).entries || [];
      const fresh = list.filter((e) => !e.card && !String(e.id).startsWith("c_"));
      const links = this.withCards(fresh.map((e) => Object.assign({}, e)), true).filter((e) => e.card).map((e) => [e.id, e.card]);
      // записи-оболонки карток: розділ і назва — в базу (щоб розділ «Концепти…» був і в старих версіях застосунку)
      const byId = new Map(Cards.deck().map((c) => [c.id, c]));
      const shells = list.filter((e) => String(e.id).startsWith("c_") && byId.has(e.card)).map((e) => { const c = byId.get(e.card);
        return [e.id, c.concept ? "Концепти й новітні розробки" : Logic.category(c.name), c.name]; }).filter(([id, cat, name]) => { const e = list.find((x) => x.id === id); return e.cat !== cat || e.name !== name; });
      let j = await API.call("ref_link", {links, shells}, pw), n = 0;
      while (j.left > 0 && n++ < 100) j = await API.call("ref_link", {}, pw);
      const more = await this.shellCats(pw); if (more.length) await API.call("ref_link", {shells: more}, pw);   // оболонки, створені під час перенесення
      this._synced = true;
      this.entries = null;
      return j;
    },
    weakHtml(e) {
      const w = e.card && (window.CARD_WEAK || {})[e.card];
      return w && w.length ? `<section class="r-sec r-weak"><h3>Недоліки</h3><ul>${w.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="muted small">За відкритими джерелами.</p></section>` : "";
    },

    cats() { const m = new Map(); (this.entries || []).forEach((e) => m.set(e.cat, (m.get(e.cat) || 0) + 1)); return [...m]; },
    renderCats() {
      const all = this.entries.length;
      $("r-cats").innerHTML = [["", `Усі`, all], ...this.cats().map(([c, n]) => [c, c, n])].map(([v, t, n]) =>
        `<button type="button" class="chip${this.cat === v ? " on" : ""}" data-cat="${esc(v)}">${esc(t)}<small>${n}</small></button>`).join("");
      $("r-cats").querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { this.cat = b.dataset.cat; SFX.click(); this.renderCats(); this.renderList(); }));
    },
    /* Пошук: кілька слів у будь-якому порядку, частина слова, одруківка в назві (1 літера на 5+ літер), латиниця/кирилиця,
       і/и/ы, без дефісів і лапок. Шукає в назві, синонімах прив'язаної картки, ТТХ, описі й слабких сторонах. */
    filtered() {
      const q = norm(this.q), pool = this.entries.filter((e) => !this.cat || e.cat === this.cat);
      if (!q) return pool;
      const deck = this._deckMap || (this._deckMap = new Map((window.Cards ? Cards.deck() : []).map((c) => [c.id, c])));
      const qw = String(this.q).split(/[\s,;\/]+/).map(norm).filter(Boolean);
      const lev1 = (a, b) => {   // відстань Левенштейна ≤ 1?
        if (Math.abs(a.length - b.length) > 1) return false;
        let i = 0, j = 0, d = 0;
        while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++d > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
        return d + (a.length - i) + (b.length - j) <= 1;
      };
      const fuzzyIn = (w, text) => {   // w — частина тексту або майже-збіг з початком якогось слова
        if (text.includes(w)) return 2;
        if (w.length < 5) return 0;
        for (let k = 0; k + w.length - 1 <= text.length; k++) { const seg = text.slice(k, k + w.length); if (lev1(w, seg) || lev1(w, text.slice(k, k + w.length + 1)) || lev1(w, text.slice(k, k + w.length - 1))) return 1; }
        return 0;
      };
      const scored = [];
      for (const e of pool) {
        const c = e.card && deck.get(e.card);
        const name = [norm(e.name), ...(c ? [norm(c.name), ...c.aliases.map(norm)] : [])].join("|");
        const text = norm(plain(e.ttx) + " " + plain(e.desc) + " " + ((c && (window.CARD_WEAK || {})[c.id]) || []).join(" "));
        let sN = 0, sT = 0, ok = true;   // у тексті — лише точна частина слова, без одруківок (інакше зайві збіги)
        for (const w of qw) { const n = fuzzyIn(w, name); if (n) { sN += n; continue; } const t = w.length >= 3 && text.includes(w) ? 1 : 0; if (t) { sT += t; continue; } ok = false; break; }
        if (!ok) continue;
        const whole = name.includes(q) ? 3 : 0, start = name.split("|").some((k) => k.startsWith(qw[0] || q)) ? 2 : 0;
        e._txt = sN === 0;
        scored.push([e, (sN ? 10 : 0) + whole + start + sN + sT * 0.2]);
      }
      return scored.sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    },
    renderList() {
      if (!this.entries) return;
      const list = this.filtered();
      $("r-count").textContent = `${list.length} з ${this.entries.length}`;
      if (!this.entries.length) { $("r-list").innerHTML = `<p class="muted r-empty">Довідник ще не заповнено. Адміністратору: адмінка → «📘 Довідник».</p>`; return; }
      if (!list.length) { $("r-list").innerHTML = `<p class="muted r-empty">Нічого не знайдено.</p>`; return; }
      let html = "", last = null;
      const q = !!norm(this.q);
      for (const e of list) {
        if (q) { const h = e._txt ? "Згадується в описі" : "Назва"; if (h !== last) { html += `<h3 class="r-h">${h}</h3>`; last = h; } }
        else if (!this.cat && e.cat !== last) { html += `<h3 class="r-h">${esc(e.cat)}</h3>`; last = e.cat; }
        html += `<button type="button" class="r-item" data-id="${esc(e.id)}"><span class="r-th">${e.imgs[0] ? `<img loading="lazy" alt="" data-img="${esc(e.imgs[0])}" data-v="${esc(e.v)}">` : e.card ? `<img loading="lazy" alt="" data-card="${esc(e.card)}">` : ""}${e.concept ? `<em class="r-cpt">КОНЦЕПТ</em>` : ""}</span>
          <span class="r-nm"><b>${UI.nameHtml(e.name)}</b><small>${esc(plain(e.desc || e.ttx).slice(0, 90))}</small></span></button>`;
      }
      $("r-list").innerHTML = html;
      $("r-list").querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => this.show(b.dataset.id)));
      this.loadImgs($("r-list"));
    },
    async loadImgs(root, pw) {
      for (const im of root.querySelectorAll("img[data-img]")) {
        if (im.getAttribute("src")) continue;
        API.refUrl(im.dataset.img, im.dataset.v, pw || Game.password).then((u) => { im.src = u; }).catch(() => {});
      }
      for (const im of root.querySelectorAll("img[data-cardown]")) {
        if (im.getAttribute("src")) continue;
        const id = im.dataset.cardown;
        API.cardUrl(id, Game.cardPhotos.get(id), pw || Game.password).then((u) => { if (u) im.src = u; else im.closest(".r-gal").remove(); }).catch(() => {});
      }
      for (const im of root.querySelectorAll("img[data-card]")) {
        if (im.getAttribute("src") || !window.Cards) continue;
        im.setAttribute("src", "data:,"); im.style.visibility = "hidden";
        const none = () => { im.remove(); };   // фото ще немає — лишається порожня рамка без «битої» іконки
        (Cards.loadRefPics ? Cards.loadRefPics() : Promise.resolve()).then(() => Cards.photoUrl(im.dataset.card)).then((u) => { if (u) { im.src = u; im.style.visibility = ""; } else none(); }).catch(none);
      }
    },

    show(id) {
      const list = this.filtered(), i = list.findIndex((e) => e.id === id), e = list[i];
      if (!e) return;
      this.cur = id;
      const prev = list[i - 1], next = list[i + 1];
      const box = $("r-detail");
      box.innerHTML = `<header class="bar top r-dh"><button type="button" class="link" id="rd-back">← До списку</button><div class="r-pn">
          <button type="button" id="rd-prev" ${prev ? "" : "disabled"} aria-label="Попередня">‹</button><button type="button" id="rd-next" ${next ? "" : "disabled"} aria-label="Наступна">›</button></div></header>
        <div class="r-body">
          ${e.concept ? `<p class="r-concept">КОНЦЕПТ</p>` : ""}<p class="r-cat">${esc(e.cat)}</p><h2>${UI.nameHtml(e.name)}</h2>
          ${e.card && window.Game && Game.cardPhotos && Game.cardPhotos.has(e.card) ? `<div class="r-gal r-gal-card"><button type="button" class="r-ph" data-zoom="1"><img alt="" data-cardown="${esc(e.card)}"></button></div>${e.imgs.length ? `<p class="muted small r-hint">Фото з картки цілей</p>` : ""}` : ""}
          ${!e.imgs.length && e.card && !(window.Game && Game.cardPhotos && Game.cardPhotos.has(e.card)) ? `<div class="r-gal"><button type="button" class="r-ph" data-zoom="1"><img alt="" data-card="${esc(e.card)}"></button></div>` : ""}
          ${e.card && extraPics(e.card).length ? `<div class="r-gal">${extraPics(e.card).map((x) => `<button type="button" class="r-ph" data-zoom="1"><img alt="" data-cardown="${esc(x)}"></button>`).join("")}</div><p class="muted small r-hint">Додаткові фото</p>` : ""}
          ${e.imgs.length ? `<div class="r-gal">${e.imgs.map((x) => `<button type="button" class="r-ph" data-zoom="${esc(x)}"><img alt="" data-img="${esc(x)}" data-v="${esc(e.v)}"></button>`).join("")}</div>
          ${e.imgs.length > 1 ? `<p class="muted small r-hint">Гортайте фото вбік · торкніться, щоб збільшити</p>` : `<p class="muted small r-hint">Торкніться фото, щоб збільшити</p>`}` : ""}
          ${e.ttx ? `<section class="r-sec"><h3>ТТХ</h3><div class="r-txt">${safe(e.ttx)}</div></section>` : ""}
          ${e.desc ? `<section class="r-sec"><h3>Ознаки та опис</h3><div class="r-txt">${noLead(e.fromCard ? esc(e.desc) : safe(e.desc))}</div></section>` : ""}
          ${this.weakHtml(e)}
        </div>`;
      box.hidden = false; box.scrollTop = 0;
      $("rd-back").onclick = () => this.closeDetail();
      if (prev) $("rd-prev").onclick = () => this.show(prev.id);
      if (next) $("rd-next").onclick = () => this.show(next.id);
      box.querySelectorAll("[data-zoom]").forEach((b) => (b.onclick = () => this.zoom(b.querySelector("img").src)));
      this.loadImgs(box);
      if (!this._keys) {
        this._keys = (ev) => {
          if ($("s-ref").hidden) return;
          if (ev.key === "Escape") { if (!$("r-zoom").hidden) $("r-zoom").hidden = true; else if (!$("r-detail").hidden) this.closeDetail(); }
          if ($("r-detail").hidden || !$("r-zoom").hidden) return;
          if (ev.key === "ArrowLeft") $("rd-prev") && $("rd-prev").click();
          if (ev.key === "ArrowRight") $("rd-next") && $("rd-next").click();
        };
        addEventListener("keydown", this._keys);
      }
    },
    closeDetail() { $("r-detail").hidden = true; $("r-zoom").hidden = true; this.cur = null; },
    zoom(src) {
      if (!src) return;
      const z = $("r-zoom"); z.innerHTML = `<img alt="" src="${esc(src)}"><button type="button" class="r-zx" aria-label="Закрити">✕</button>`;
      z.hidden = false; z.classList.remove("full");
      z.querySelector("img").onclick = (ev) => { ev.stopPropagation(); z.classList.toggle("full"); };
      z.onclick = () => (z.hidden = true);
    },
  };

  /* ---------- адмінка: записи довідника (додати / змінити / видалити) та імпорт файлу */
  const unesc = (h) => String(h || "").replace(/<b>([\s\S]*?)<\/b>/g, "**$1**").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
  const toHtml = (t) => String(t || "").trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;")
    .replace(/\*\*([\s\S]+?)\*\*/g, "<b>$1</b>");
  function readImg(file) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`«${file.name}» — не зображення`)); i.src = fr.result; }; fr.readAsDataURL(file); });
  }
  async function toJpeg(file) {
    const img = await readImg(file), k = Math.min(1, 1400 / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, c.width, c.height);
    let q = 0.85, url = c.toDataURL("image/jpeg", q);
    while (url.length > 1_400_000 && q > 0.5) { q -= 0.1; url = c.toDataURL("image/jpeg", q); }
    return url;
  }
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const RefAdmin = {
    f: "", fcat: "",
    async open(admin) {
      this.pw = admin.pw;
      let box = $("ra"); if (!box) { box = document.createElement("div"); box.id = "ra"; box.className = "modal"; document.body.appendChild(box); }
      box.hidden = false;
      box.onclick = (e) => { if (e.target === box && !this.busy) box.hidden = true; };
      box.innerHTML = `<div class="m-card"><p class="status">Завантажую…</p></div>`;
      await this.load();
      this.renderList();
    },
    async load() {
      try { this.entries = sortRef((await API.call("ref_list", {}, this.pw)).entries || []); } catch (e) { this.entries = []; this.err = e.message; }
      // записи-оболонки карток (c_…): розділ і назва — з картки; порожні тексти — теж з картки
      const deck = window.Cards ? Cards.deck() : [], byId = new Map(deck.map((c) => [c.id, c]));
      const catOf = (c) => (c.concept ? "Концепти й новітні розробки" : Logic.category(c.name));
      for (const e of this.entries) {
        const c = byId.get(e.card); if (!String(e.id).startsWith("c_") || !c) continue;
        if (!e.cat) e.cat = catOf(c); e.name = e.name || c.name;
        if (!plain(e.ttx).trim() && !plain(e.desc).trim()) { e.ttx = toHtml(c.p1); e.desc = toHtml(c.p2); }
      }
      // картки, яких у довіднику ще немає (без запису в таблиці й без фото) — показуємо як записи без фото;
      // запис у базі з'явиться, щойно до нього додадуть фото чи збережуть форму
      const linked = new Set(this.entries.map((e) => e.card).filter(Boolean));
      const virt = deck.filter((c) => !linked.has(c.id)).map((c, i) => ({id: "c_" + c.id, ord: 100000 + i, cat: catOf(c), name: c.name, ttx: toHtml(c.p1), desc: toHtml(c.p2), imgs: [], v: "", card: c.id, virt: true}));
      this.entries = sortRef(this.entries.concat(virt));
      Ref.entries = null;   // курсантський список перечитається
    },
    cats() { const out = []; this.entries.forEach((e) => { if (!out.includes(e.cat)) out.push(e.cat); }); return out; },
    renderList() {
      const q = norm(this.f), list = this.entries.filter((e) => (!this.fcat || e.cat === this.fcat) && (!q || norm(e.name).includes(q)) && (!this.nophoto || !e.imgs.length));
      const noPh = this.entries.filter((e) => !e.imgs.length).length;
      $("ra").innerHTML = `<div class="m-card ra-card"><div class="m-head"><h2>Довідник техніки</h2><button type="button" class="link" id="ra-x">Закрити</button></div>
        <p class="muted small">Записів: <b>${this.entries.length}</b>, без фото: <b>${noPh}</b>. Курсанти відкривають довідник з головного меню. Щоб додати фото — торкніться порожньої рамки в рядку.</p>
        <div class="row"><button type="button" class="primary" id="ra-new">＋ Новий запис</button><button type="button" id="ra-file">Завантажити файл довідника…</button></div>
        <input type="file" id="ra-in" accept=".json,application/json" hidden>
        <p class="status" id="ra-st">${this.err ? esc(this.err) : ""}</p>
        <div class="row ra-filt"><input id="ra-q" type="search" placeholder="Пошук за назвою" value="${esc(this.f)}"><select id="ra-c"><option value="">Усі розділи</option>${this.cats().map((c) => `<option${c === this.fcat ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
        <div class="tabs"><button type="button" id="ra-all" class="${this.nophoto ? "" : "on"}">Усі</button><button type="button" id="ra-noph" class="${this.nophoto ? "on" : ""}">Без фото ${noPh}</button></div>
        <input type="file" id="ra-ph" accept="image/*" multiple hidden>
        <ul class="ra-list">${list.map((e) => `<li><span class="r-th${e.imgs[0] ? "" : " empty"}" ${e.imgs[0] ? `data-edit="${esc(e.id)}" title="Змінити"` : `data-addph="${esc(e.id)}" title="Додати фото" role="button"`}>${e.imgs[0] ? `<img loading="lazy" alt="" data-img="${esc(e.imgs[0])}" data-v="${esc(e.v)}">` : "＋"}</span>
          <span class="nm">${esc(Logic.dispName(e.name))}<small>${esc(e.cat)} · фото: ${e.imgs.length}${e.card ? " · 🃏 картка" : ""}${e.virt ? " · ще не в довіднику" : ""}</small></span>
          <button type="button" data-edit="${esc(e.id)}" title="Змінити">✎</button>${e.virt ? "<span></span>" : `<button type="button" data-del="${esc(e.id)}" title="Видалити">✕</button>`}</li>`).join("") || `<li class="muted small">Нічого не знайдено</li>`}</ul></div>`;
      $("ra-x").onclick = () => { if (!this.busy) $("ra").hidden = true; };
      $("ra-new").onclick = () => this.edit(null);
      $("ra-file").onclick = () => $("ra-in").click();
      $("ra-in").onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        e.target.value = "";
        let b; try { b = JSON.parse(await f.text()); } catch (err) { this.say("Файл не читається як JSON", "no"); return; }
        if (b && b.type === "ref-text-patch") {   // лише тексти (переклад, правки): фото й решта записів не чіпаються
          if (!confirm(`${b.title || "Оновлення текстів довідника"}: записів — ${(b.entries || []).length}. Фото не змінюються. Продовжити?`)) return;
          try { const r = await this.applyTextPatch(b); await this.load(); this.renderList(); this.say(r, "ok"); } catch (err) { this.say(err.message, "no"); }
          return;
        }
        if (!confirm("Імпорт файлу замінить довідник вмістом файлу (записи, яких у файлі немає, буде прибрано). Продовжити?")) return;
        try { await this.importBundle(b); await this.load(); this.renderList(); this.say("Імпорт завершено ✓", "ok"); } catch (err) { this.say(err.message, "no"); }
      };
      $("ra-q").oninput = (e) => { this.f = e.target.value; const pos = e.target.selectionStart; this.renderList(); const q = $("ra-q"); q.focus(); q.setSelectionRange(pos, pos); };
      $("ra-all").onclick = () => { this.nophoto = false; this.renderList(); };
      $("ra-noph").onclick = () => { this.nophoto = true; this.renderList(); };
      // порожня рамка → вибрати фото → одразу в запис (перше — обкладинка); запис-оболонка картки при цьому створюється
      $("ra").querySelectorAll("[data-addph]").forEach((b) => (b.onclick = () => { this.addTo = b.dataset.addph; $("ra-ph").click(); }));
      $("ra-ph").onchange = async (ev) => {
        const files = [...ev.target.files].slice(0, 20); ev.target.value = "";
        const e = this.entries.find((x) => x.id === this.addTo); if (!e || !files.length) return;
        this.busy = true; this.say(`Додаю фото: ${e.name}…`);
        try {
          const images = []; for (const f of files) images.push({id: uid(e.id + "-"), data: (await toJpeg(f)).split(",")[1], mime: "image/jpeg"});
          const entry = {id: e.id, ord: e.ord, cat: e.cat, name: e.name, ttx: e.ttx, desc: e.desc, imgs: images.map((x) => x.id).concat(e.imgs).slice(0, 20), card: e.card || ""};
          await this.putEntry(entry, images, e.imgs);
          await this.load(); this.renderList(); this.say(`«${e.name}»: додано фото — ${images.length} ✓`, "ok");
        } catch (err) { this.say(err.message, "no"); }
        finally { this.busy = false; }
      };
      $("ra-c").onchange = (e) => { this.fcat = e.target.value; this.renderList(); };
      $("ra").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => this.edit(b.dataset.edit)));
      $("ra").querySelectorAll(".r-th img").forEach((im) => (im.style.cursor = "pointer"));
      $("ra").querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => this.del(b.dataset.del)));
      Ref.loadImgs.call({}, $("ra"), this.pw);
    },
    async del(id) {
      const e = this.entries.find((x) => x.id === id); if (!e) return;
      if (!confirm(`Видалити запис «${e.name}» разом із його фото?`)) return;
      try { await API.call("ref_delete", {id}, this.pw); await this.load(); this.renderList(); this.say(`«${e.name}» видалено.`, "ok"); }
      catch (err) { this.say(err.message, "no"); }
    },
    edit(id) {
      const e = id ? this.entries.find((x) => x.id === id) : null;
      const cats = this.cats();
      this.photos = e ? e.imgs.map((x) => ({id: x, v: e.v})) : [];
      $("ra").innerHTML = `<div class="m-card ra-card"><div class="m-head"><h2>${e ? "Змінити запис" : "Новий запис"}</h2><button type="button" class="link" id="re-back">← До списку</button></div>
        <div class="ra-form">
          <label>Назва<input id="re-name" maxlength="200" value="${esc(e ? e.name : "")}" placeholder="напр. Т-72Б3М"></label>
          <label>Розділ<select id="re-cat">${cats.map((c) => `<option${(e ? e.cat : this.fcat || cats[0]) === c ? " selected" : ""}>${esc(c)}</option>`).join("")}<option value="__new">＋ Новий розділ…</option></select></label>
          <label id="re-newcat-l" hidden>Назва нового розділу<input id="re-newcat" maxlength="80"></label>
          <label>Картка цілей (фото цього запису йдуть у гру)<select id="re-card"><option value="">— не прив'язано —</option>${(window.Cards ? Cards.deck() : []).slice().sort((a, b) => a.name.localeCompare(b.name, "uk")).map((c) => `<option value="${esc(c.id)}"${e && e.card === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
          <label>ТТХ<textarea id="re-ttx" rows="6" placeholder="Озброєння: …&#10;Калібр: …">${esc(unesc(e ? e.ttx : ""))}</textarea></label>
          <label>Ознаки та опис<textarea id="re-desc" rows="8">${esc(unesc(e ? e.desc : ""))}</textarea></label>
          <p class="muted small">Жирний текст: оберніть слова в **зірочки**. Кожен рядок — з нового рядка.</p>
          <div class="re-ph-h"><b>Фото</b> <span class="muted small">перше — обкладинка в списку; до 20 шт.</span></div>
          <div class="re-photos" id="re-photos"></div>
          <div class="row"><button type="button" id="re-add">＋ Додати фото…</button></div>
          <input type="file" id="re-files" accept="image/*" multiple hidden>
          <div class="row"><button type="button" class="primary" id="re-save">Зберегти</button><button type="button" id="re-cancel">Скасувати</button></div>
          <p class="status" id="ra-st"></p>
        </div></div>`;
      const back = () => this.renderList();
      $("re-back").onclick = back; $("re-cancel").onclick = back;
      $("re-cat").onchange = (ev) => { $("re-newcat-l").hidden = ev.target.value !== "__new"; if (ev.target.value === "__new") $("re-newcat").focus(); };
      $("re-add").onclick = () => $("re-files").click();
      $("re-files").onchange = async (ev) => {
        for (const f of [...ev.target.files]) {
          if (this.photos.length >= 20) { this.say("Не більше 20 фото в записі.", "no"); break; }
          try { this.photos.push({id: null, url: await toJpeg(f)}); } catch (err) { this.say(err.message, "no"); }
        }
        ev.target.value = ""; this.renderPhotos();
      };
      $("re-save").onclick = () => this.save(e);
      this.renderPhotos();
      $("re-name").focus();
    },
    renderPhotos() {
      const box = $("re-photos");
      box.innerHTML = this.photos.map((p, i) => `<div class="re-ph"><img alt="" ${p.url ? `src="${p.url}"` : `data-img="${esc(p.id)}" data-v="${esc(p.v)}"`}>
        <div class="re-ph-b">${i ? `<button type="button" data-first="${i}" title="Зробити обкладинкою">★</button>` : `<span class="re-main">обкладинка</span>`}<button type="button" data-rm="${i}" title="Прибрати">✕</button></div></div>`).join("")
        || `<p class="muted small">Ще немає фото.</p>`;
      box.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { this.photos.splice(+b.dataset.rm, 1); this.renderPhotos(); }));
      box.querySelectorAll("[data-first]").forEach((b) => (b.onclick = () => { const [p] = this.photos.splice(+b.dataset.first, 1); this.photos.unshift(p); this.renderPhotos(); }));
      Ref.loadImgs.call({}, box, this.pw);
    },
    async save(e) {
      const name = $("re-name").value.trim();
      let cat = $("re-cat").value; if (cat === "__new") cat = $("re-newcat").value.trim();
      if (!name) { this.say("Вкажіть назву.", "no"); $("re-name").focus(); return; }
      if (!cat) { this.say("Вкажіть розділ.", "no"); return; }
      if (this.entries.some((x) => x !== e && norm(x.name) === norm(name))) { this.say("Запис з такою назвою вже є.", "no"); return; }
      const id = e ? e.id : uid("u");
      const images = [], imgs = [];
      for (const p of this.photos) {
        if (p.id) { imgs.push(p.id); continue; }
        const iid = uid(id + "-"); imgs.push(iid); images.push({id: iid, data: p.url.split(",")[1], mime: "image/jpeg"});
      }
      // місце: для нового — в кінці свого розділу
      let ord = e ? e.ord : 0;
      if (!e || e.cat !== cat) {
        const inCat = this.entries.filter((x) => x.cat === cat && x !== e);
        ord = (inCat.length ? Math.max(...inCat.map((x) => x.ord || 0)) : Math.max(0, ...this.entries.map((x) => x.ord || 0))) + 1;
      }
      const entry = {id, ord, cat, name, ttx: toHtml($("re-ttx").value), desc: toHtml($("re-desc").value), imgs, card: $("re-card").value};
      this.busy = true; $("re-save").disabled = true; this.say("Зберігаю…");
      try {
        await this.putEntry(entry, images, this.photos.filter((p) => p.id).map((p) => p.id));
        await this.load(); this.renderList(); this.say(`«${name}» збережено ✓`, "ok");
      } catch (err) { this.say(err.message, "no"); $("re-save").disabled = false; }
      finally { this.busy = false; }
    },
    /* Зберегти запис із новими фото: по кілька фото на запит, щоб не впертися в розмір запиту;
       kept — уже збережені фото, які лишаються (на проміжних кроках запис тримає їх + уже завантажені нові). */
    async putEntry(entry, images, kept) {
      const chunks = []; let cur = [], size = 0;
      for (const im of images) { if (cur.length && size + im.data.length > 4_000_000) { chunks.push(cur); cur = []; size = 0; } cur.push(im); size += im.data.length; }
      if (cur.length) chunks.push(cur);
      for (let i = 0; i < chunks.length - 1; i++) {
        await API.call("ref_put", {entry: Object.assign({}, entry, {imgs: kept.concat(chunks.slice(0, i + 1).flat().map((x) => x.id))}), images: chunks[i]}, this.pw);
      }
      await API.call("ref_put", {entry, images: chunks.length ? chunks[chunks.length - 1] : []}, this.pw);
    },
    say(t, cls = "") { const el = $("ra-st"); if (el) { el.textContent = t; el.className = "status " + cls; } },
    /* Патч текстів: поле міняється, лише якщо в базі ще той самий текст, що й «from» (ручні правки не перезаписуються). */
    async applyTextPatch(b) {
      const same = (x, y) => String(x || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim() === String(y || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
      let done = 0, already = 0;
      const skipped = [];
      this.busy = true;
      try {
        for (const p of b.entries || []) {
          const e = this.entries.find((x) => x.id === p.id);
          if (!e) { skipped.push(p.name || p.id); continue; }
          const upd = Object.assign({}, e);
          let ch = 0;
          for (const [f, v] of Object.entries(p.fields || {})) {
            if (!["name", "ttx", "desc"].includes(f)) continue;
            if (same(e[f], v.to)) { already++; continue; }
            if (!same(e[f], v.from)) { skipped.push(`${e.name} (${f === "ttx" ? "ТТХ" : f === "desc" ? "опис" : "назва"} змінено вручну)`); continue; }
            upd[f] = v.to; ch++;
          }
          if (!ch) continue;
          this.say(`Оновлюю: ${e.name}…`);
          await API.call("ref_put", {entry: {id: upd.id, ord: upd.ord, cat: upd.cat, name: upd.name, ttx: upd.ttx, desc: upd.desc, imgs: upd.imgs}, images: []}, this.pw);
          done += ch;
        }
      } finally { this.busy = false; }
      Ref.entries = null;
      return `Готово ✓ Оновлено полів: ${done}${already ? `, уже були оновлені: ${already}` : ""}${skipped.length ? `. Пропущено: ${skipped.join("; ")}` : ""}.`;
    },

    async importBundle(b) {
      if (!b || !Array.isArray(b.entries) || !b.images) throw new Error("Це не файл довідника");
      this.busy = true;
      try {
        for (let i = 0; i < b.entries.length; i++) {
          const e = b.entries[i];
          this.say(`${i + 1}/${b.entries.length}: ${e.name}…`);
          const images = (e.imgs || []).filter((x) => b.images[x]).map((x) => ({id: x, data: b.images[x], mime: "image/jpeg"}));
          for (let k = 0; ; k++) {
            try { await API.call("ref_put", {entry: Object.assign({}, e, {ord: i, card: undefined}), images, keepCp: 1}, this.pw); break; }
            catch (err) { if (k >= 2) throw err; await new Promise((r) => setTimeout(r, 1500)); }
          }
        }
        const pr = await API.call("ref_prune", {keep: b.entries.map((e) => e.id)}, this.pw);
        this.say(`Готово ✓ Позицій: ${b.entries.length}${pr.removed ? `, прибрано застарілих записів: ${pr.removed}` : ""}.`, "ok");
        Ref.entries = null;
        return b.entries.length;
      } finally { this.busy = false; }
    },
    /* Імпорт зашифрованого пакета (частини лежать на сайті тимчасово, ключ передається окремо). */
    async importEncrypted(urls, keyB64) {
      const parts = [];
      for (const u of urls) { const r = await fetch(u, {cache: "no-store"}); if (!r.ok) throw new Error("Немає " + u); parts.push(new Uint8Array(await r.arrayBuffer())); }
      const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; parts.forEach((p) => { all.set(p, o); o += p.length; });
      const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
      const plainBuf = await crypto.subtle.decrypt({name: "AES-GCM", iv: all.slice(0, 12)}, key, all.slice(12));
      return this.importBundle(JSON.parse(new TextDecoder().decode(plainBuf)));
    },
  };

  window.Ref = Ref;
  window.RefAdmin = RefAdmin;
})();
