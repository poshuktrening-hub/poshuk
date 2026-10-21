/* Режим «Картки цілей»: фото техніки → курсант вписує назву → перевірка (з допуском на одруківки й регістр)
   → повний опис на 15 с → наступна картка. Ігровий (з підказкою) та Іспит (без підказок). */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.esc(s);
  const LS = API.LS;
  const ROUND_SEC = 30, REVEAL_SEC = 15, ROUNDS = 10;
  const MODES = {
    game: {id: "game", name: "Ігровий", desc: "30 с на картку: обрати назву з 4 варіантів. Підказки: 50/50 — один раз за гру, «Ознака» й «Недолік» — з довідника.", hint: true, choice: true, sign: true},
    exam: {id: "exam", name: "Іспит", desc: "30 с на картку: вписати назву самому, без підказок. Прохідний бал 80%.", hint: false, pass: 80},
    ff: {id: "ff", name: "Свій/чужий", desc: "15 с на картку: своя це техніка чи ворожа. Вірно +10, помилка −2, не встиг відповісти −1.", ff: true, sec: 15},
    reveal: {id: "reveal", name: "Проявлення", desc: "Фото спершу грубо пікселізоване й поступово проступає — як погане відео чи знімок з висоти. Що раніше вірно назвав, то більше балів: від 10 до 2. Помилка — 0. 4 варіанти, без підказок, 20 с.", choice: true, reveal: true, sec: 20},
    hard: {id: "hard", name: "Хардкор", desc: "Рідкісні модифікації, РЛС, РЕБ і РЕР, ППО, авіація, ракети, флот, концепти. Лише одна можлива помилка — друга завершує гру. 4 варіанти, без підказки.", hint: false, choice: true, hard: true, lives: 1},
  };

  /* ---------- нормалізація відповіді: регістр, латиниця-«двійники», і/и/ы, лапки, дефіси, пробіли */
  const LAT = {a: "а", b: "б", c: "с", d: "д", e: "е", f: "ф", g: "г", h: "н", i: "і", k: "к", l: "л", m: "м", n: "н", o: "о", p: "р",
    r: "р", s: "с", t: "т", u: "у", v: "в", x: "х", y: "у", z: "з", w: "в"};
  function norm(s) {
    let t = String(s || "").toLowerCase().normalize("NFC");
    t = t.replace(/[a-z]/g, (ch) => LAT[ch] || ch);
    t = t.replace(/[іїиы]/g, "и").replace(/[єэ]/g, "е").replace(/ё/g, "е").replace(/ґ/g, "г").replace(/й/g, "и");
    t = t.replace(/[ьъ'’ʼ`"«»()\[\].,:;!?\/\\_\-–—\s]/g, "");
    return t;
  }
  const digits = (s) => (String(s).match(/\d+/g) || []).join(",");
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length; if (!m || !n) return m || n;
    let prev = Array.from({length: n + 1}, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  /* Варіанти правильної відповіді для картки. */
  function answers(card) {
    const type = card.name.split(" ")[0];
    const base = card.name.replace(/\s*\(.*?\)\s*/g, " ").trim();
    const list = new Set([card.name, base, card.name.split(" ").slice(1).join(" "), ...card.aliases]);
    card.aliases.forEach((a) => list.add(type + " " + a));
    const q = card.name.match(/«([^»]+)»/); if (q) { list.add(q[1]); list.add(type + " " + q[1]); }   // власна назва в лапках — завжди зараховується
    return [...list].map(norm).filter(Boolean);
  }
  /* Перевірка: точний збіг або одруківка (1 символ для ≥5, 2 для ≥10), але цифри мають збігатися точно. */
  function check(card, input) {
    const a = norm(input);
    if (a.length < 2) return {ok: false};
    const vars = answers(card);
    if (vars.includes(a)) return {ok: true, exact: true};
    // точна назва ІНШОЇ техніки (Т-80БВ замість Т-80БВМ) — це не одруківка, а помилка
    if (!check.idx) { check.idx = new Map(); Cards.deck().forEach((c) => answers(c).forEach((v) => { if (!check.idx.has(v)) check.idx.set(v, c.id); })); }
    if (check.idx.has(a) && check.idx.get(a) !== card.id) return {ok: false};
    const tolOf = (n) => n >= 9 ? 2 : n >= 5 ? 1 : 0;
    for (const v of vars) {
      if (digits(v) !== digits(a)) continue;
      const tol = tolOf(v.length);
      if (tol && lev(a, v) <= tol) return {ok: true, exact: false};
    }
    // Мʼяка перевірка: досить впізнаваної назви всередині відповіді («ТОС Солнцепек», «Град БМ-21», «солнцепьок»).
    // Шукаємо найдовший збіг з назвами всієї техніки; зараховуємо, якщо він належить саме цій картці.
    const words = String(input).split(/[\s,;/\\()«»"'.]+/).filter(Boolean);
    const pieces = new Set();
    for (let i = 0; i < words.length; i++) for (let k = 1; k <= 3 && i + k <= words.length; k++) pieces.add(norm(words.slice(i, i + k).join("")));
    let best = null;
    const consider = (owner, len, exact) => { if (!best || len > best.len || (len === best.len && exact && !best.exact)) best = {owner, len, exact}; };
    for (const [v, owner] of check.idx) if (v.length >= 4 && a.includes(v)) consider(owner, v.length, true);
    for (const p of pieces) {
      if (p.length < 2) continue;
      if (check.idx.has(p)) { consider(check.idx.get(p), p.length, true); continue; }
      for (const v of vars) { const tol = tolOf(v.length); if (tol && digits(v) === digits(p) && lev(p, v) <= tol) consider(card.id, v.length, false); }
    }
    if (best && best.owner === card.id) return {ok: true, exact: false};
    return {ok: false};
  }

  /* Схожі типи — щоб хибні варіанти були правдоподібними (танк серед танків, ППО серед ППО). */
  const GROUPS = [["Танк"], ["БМП", "БМД", "БМПТ", "БТР", "БРДМ", "БРМ", "РХМ", "Бронеавтомобіль", "Тягач"],
    ["САУ", "Гаубиця", "Гармата", "Міномет", "Гаубиця-гармата", "Гармата-гаубиця-міномет"],
    ["РСЗВ", "ОТРК", "БРК"], ["ЗРК", "ЗРГК", "ЗРС", "ЗСУ", "ЗУ", "ЗАК", "КП", "ПЗУ"], ["РЕБ", "РЛС", "АРК", "КШМ", "Машина"],
    ["Вантажівка", "Автомобіль", "Паливозаправник", "ТЗМ", "Сідельний", "Багі"],
    ["ІМР", "БАТ", "Мінний", "ПТС", "БРЕМ", "Мостоукладач", "Понтонний", "Паром", "ПЗМ", "МДК", "Робот", "Екскаватор", "БМР", "ТМК-2", "БТС", "РЕМ-КЛ", "МТП-А2", "МТО-УБ1"],
    ["БпЛА", "Катапульта", "БпЛА-мішень"], ["Гелікоптер", "Літак", "Літак-амфібія"], ["ПТРК"],
    ["Фрегат", "Корабель", "Тральщик", "Катер", "Крейсер", "Буксир", "Підводний", "Катер-дрон", "Безекіпажний"]];   // флот — варіанти лише з кораблів
  const NAVY = GROUPS[GROUPS.length - 1];
  const typeOf = (c) => c.name.split(" ")[0];
  const quoted = (c) => (c.name.match(/«([^»]+)»/) || [])[1] || "";
  function options(card, deck, must, all) {
    const t = typeOf(card), g = GROUPS.find((x) => x.includes(t)) || [t], q = quoted(card);
    // своя техніка — лише серед своїх, ворожа — серед ворожих (інакше Leopard/MaxxPro серед варіантів відкидаються одразу);
    // концепти — серед концептів, якщо їх досить (значок «КОНЦЕПТ» не підказує відповідь)
    const fit = (c) => c.id !== card.id && !!c.own === !!card.own && !(q && quoted(c) === q);
    const pool = deck.filter(fit), wide = (all || deck).filter((c) => fit(c) && !c.own);
    const pick = [], add = (list) => { for (const c of Logic.shuffle(list)) { if (pick.length >= 3) break; if (!pick.some((x) => x.id === c.id)) pick.push(c); } };
    // те, з чим цю техніку плутають (пара або власні помилки), — серед варіантів обов'язково
    const navy = NAVY.includes(t);
    for (const id of must || []) { const c = pool.find((x) => x.id === id); if (c && pick.length < 2 && !pick.includes(c) && (!navy || NAVY.includes(typeOf(c)))) pick.push(c); }
    if (card.concept) add(pool.filter((c) => c.concept && g.includes(typeOf(c))));
    add(pool.filter((c) => typeOf(c) === t)); add(pool.filter((c) => g.includes(typeOf(c))));
    add(wide.filter((c) => g.includes(typeOf(c))));   // своєї групи замало на цьому рівні — беремо з усієї техніки тієї ж групи
    if (!navy) add(pool);
    return Logic.shuffle([card, ...pick]);
  }

  /* Плутанина на цьому пристрої: «правильна|обрана» → скільки разів і коли востаннє. */
  const CONF = "poshuk_confuse";
  const confAll = () => LS.get(CONF, {}) || {};
  function confAdd(right, wrong) {
    if (!right || !wrong || right === wrong) return;
    const m = confAll(), k = right + "|" + wrong, e = m[k] || {n: 0, t: 0};
    e.n++; e.t = Date.now(); m[k] = e;
    const keys = Object.keys(m); if (keys.length > 300) keys.sort((a, b) => m[a].t - m[b].t).slice(0, keys.length - 300).forEach((x) => delete m[x]);
    LS.set(CONF, m);
  }
  /* з чим плутають картку (за спаданням) */
  const confWith = (id) => Object.entries(confAll()).filter(([k]) => k.startsWith(id + "|")).sort((a, b) => b[1].n - a[1].n).map(([k]) => k.split("|")[1]);
  /* «Чужі» для режиму «Свій/чужий» — лише техніка, якої немає в ЗСУ (Т-72, БМП-2, Д-30 тощо є в обох сторін — за типом не розрізнити). */
  const RU_ONLY = /т-90|т-72б3|т-80бвм|т-14|т-15|бмпт|термінатор|бмп-3|бмд|бтр-82|бтр-мдм|ракушк|тигр|тайфун|лінза|линза|ахмат|патруль|2с35|2с43|коаліц|мальва|тос-|торнадо|іскандер|бастіон|«бал»|панцир|тор-м2|бук-м2|бук-м3|с-400|с-350|красух|мурманськ|тирад|борисоглебськ|р-330|леер|житель|орлан|ланцет|герань|шахед|zala|supercam|мерлін|ка-52|мі-28|су-34|су-35|су-57|ту-95|ту-22|ту-160|а-50|іл-22|кинджал|циркон|калібр|х-101|х-555|х-59|х-69|х-22|онікс|курганец|бумеранг|арбалет|сарма|гербер/i;

  const Cards = {
    MODES, check, norm, confWith, RU_ONLY,
    ffPools() { const clean = (c) => !!this.pickPic(c.id, true); return {own: this.withPhoto("own").filter(clean), foe: this.withPhoto().filter((c) => RU_ONLY.test(c.name) && clean(c))}; },
    /* hard — «складний рівень»: прапорець у даних, який адмін може перекрити галочкою (Game.cardHard). */
    /* РЛС, РЕБ/РЕР, зв'язок, командні пункти — завжди хардкор (якщо адмін не зняв галочку) */
    HARD_TYPES: ["РЛС", "РЕБ", "РЕР", "АРК", "КШМ", "КП", "ПЗУ", "Машина"],
    deck() {
      const ov = (window.Game && Game.cardHard) || {};
      return (window.CARDS || []).map(([id, name, al, p1, p2, x]) => ({id, name, aliases: al.split("|").map((x) => x.trim()).filter(Boolean), p1, p2,
        concept: !!(x && x.concept), own: !!(x && x.own), noff: !!(x && x.noff), hard: ov[id] != null ? !!ov[id] : x && x.hard === 0 ? false : !!(x && x.hard) || this.HARD_TYPES.includes(name.split(" ")[0])}));
    },
    withPhoto(hard) {
      const ph = (window.Game && Game.cardPhotos) || new Map(), ref = window.CARD_REF || {};
      const cp = (window.Game && Game.cardPics) || {};
      const has = (c) => ph.has(c.id) || cp[c.id] || ref[c.id] || (this.refPics && this.refPics.has(c.id));
      // своя техніка — лише в режимі «Свій/чужий» (hard === "own"); в інших режимах — лише ворожа
      if (hard === "own") return this.deck().filter((c) => c.own && !c.noff && has(c));   // noff — схожа на російську, лише довідник
      return this.deck().filter((c) => !c.own && (hard === undefined || c.hard === hard) && has(c));
    },

    /* Фото з довідника для карток: усі зображення запису, до якого належить картка (явна відповідність CARD_REF
       або збіг назви). Кожен раунд бере випадкове — та сама техніка щоразу з іншого ракурсу. */
    async loadRefPics() {
      if (this.refPics || !API.isCF) return this.refPics;
      if (this._refP) return this._refP;
      this._refP = (async () => {
        let list = [];
        let j = {};
        try { j = await API.refList(Game.password); list = j.entries || []; } catch (e) { this._refP = null; return null; }
        const byId = new Map(list.map((e) => [e.id, e])), map = new Map();
        this.refDesc = new Map(list.filter((e) => e.card && e.desc).map((e) => [e.card, e.desc]));   // для підказки «Ознака»
        if (j.marks && window.Game) Game.marks = Object.assign(Game.marks || {}, j.marks);
        // фото «--ref» (лише для довідника, з підписами) — ніколи не фото завдання
        const add = (cid, e) => { const imgs = ((e && e.imgs) || []).filter((x) => !String(x).includes("--ref")); if (!imgs.length) return; const a = map.get(cid) || []; imgs.forEach((im) => { if (!a.some((x) => x.id === im)) a.push({id: im, v: e.v || "1"}); }); map.set(cid, a); };
        const ref = window.CARD_REF || {};
        // 1) явні відповідності: картка → запис (id зображення «r024-2» → запис r024)
        for (const [cid, img] of Object.entries(ref)) add(cid, byId.get(String(img).replace(/-[^-]+$/, "")));
        // 2) збіг назви: частина назви запису (до «/», «;», дужок, лапок) дорівнює назві чи синоніму картки
        const idx = new Map();
        for (const c of this.deck()) for (const v of answers(c)) if (v.length >= 4 && /\d/.test(v) && !idx.has(v)) idx.set(v, c.id);
        for (const e of list) {
          if (e.card) { add(e.card, Object.assign({}, e, {imgs: (e.imgs || []).filter((x) => !String(x).includes("--ref"))})); continue; }   // явна прив'язка
          if (/^відмінност|порівнян/i.test(e.name || "")) continue;   // порівняльні таблиці — не фото техніки
          const parts = String(e.name || "").split(/[\/\\;,()“”"«»]|\s[-–—]\s|\sта\s|\sабо\s/).map(norm).filter((x) => x.length >= 3);
          // кілька зразків в одному записі («2С1/2С34», «ИМР-2, ИМР-3М») — невідомо, хто на котрому фото: не беремо
          if (new Set(parts.filter((x) => /\d/.test(x))).size > 1) continue;
          const hit = new Set();
          for (const p of new Set([norm(e.name), ...parts])) if (p.length >= 4 && idx.has(p)) hit.add(idx.get(p));
          // довга назва («Машина розвідки … 1Л219 “Зоопарк”») — шукаємо позначення окремим словом
          if (!hit.size) for (const w of String(e.name || "").split(/[\s\/\\;,()“”"«»]+/).map(norm)) if (w.length >= 4 && /\d/.test(w) && idx.has(w)) hit.add(idx.get(w));
          if (hit.size === 1) hit.forEach((cid) => add(cid, e));
        }
        this.refPics = map;
        return map;
      })();
      return this._refP;
    },
    /* Варіанти фото картки: фото записів довідника цієї картки (+ старі фото карток, поки не перенесені). */
    picPool(id) {
      const pool = [];
      for (const [im, v, credit] of ((window.Game && Game.cardPics) || {})[id] || []) pool.push({id: im, v, credit});
      if (Game.cardPhotos.has(id)) pool.push({own: true});
      for (const k of Game.cardPhotos.keys()) if (k.startsWith(id + "--alt")) pool.push({own: true, key: k});   // додаткові фото від адміністратора
      const r = this.refPics && this.refPics.get(id);
      if (r && r.length) r.forEach((x) => { if (!pool.some((p) => p.id === x.id)) pool.push(x); });
      else if (!pool.length && (window.CARD_REF || {})[id]) pool.push({id: window.CARD_REF[id], v: "1"});
      return pool;
    },
    pickPic(id, ff) {
      // «Свій/чужий»: без фото, де сторону видно одразу (прапор, зірки, Z/V, написи) — див. js/ff-skip.js
      const p = this.picPool(id).filter((x) => !ff || !(x.id && (window.FF_SKIP || new Set()).has(x.id)));
      return p.length ? p[Math.floor(Math.random() * p.length)] : null;
    },
    /* адреса фото картки: своє/Вікісховище або зображення з довідника */
    photoUrl(id, pic) {
      pic = pic || this.pickPic(id);
      if (!pic) return Promise.resolve(null);
      if (pic.own) return API.cardUrl(pic.key || id, Game.cardPhotos.get(pic.key || id), Game.password);
      return API.refUrl(pic.id, pic.v, Game.password);
    },

    renderMenu() {
      let mode = LS.get("poshuk_cmode", "game"); if (!MODES[mode]) mode = "game";
      this.mode = MODES[mode];
      if (mode === "ff") mode = "game";   // «Свій/чужий» — у головному меню
      this.mode = MODES[mode];
      $("pick-cmode").innerHTML = Object.values(MODES).filter((m) => !m.ff).map((m) =>
        `<button type="button" role="radio" aria-checked="${m.id === mode}" class="mode${m.id === mode ? " on" : ""}" data-cm="${m.id}"><b>${m.name}</b><span>${esc(m.desc)}</span></button>`).join("");
      $("pick-cmode").querySelectorAll("[data-cm]").forEach((b) => (b.onclick = () => { LS.set("poshuk_cmode", b.dataset.cm); SFX.click(); this.renderMenu(); }));
      const hard = !!this.mode.hard, n = this.withPhoto(hard).length, all = this.deck().filter((c) => c.hard === hard).length;
      if (this.mode.ff) {
        const f = this.ffPools(), ok = f.own.length >= 3 && f.foe.length >= 3;
        $("c-info").innerHTML = ok ? `Своєї техніки з фото: ${f.own.length}, ворожої (лише та, якої в ЗСУ немає): ${f.foe.length}.` : `Мало фото своєї техніки (${f.own.length}): автопошук ще підбирає. Адміністратору: адмінка → «Картки» → «🤖 Автопошук фото».`;
        $("c-start").disabled = !ok;
        $("c-start").textContent = "Почати: свій/чужий"; $("c-start").onclick = () => this.start();
        return;
      }
      $("c-info").innerHTML = n ? `Карток у грі: ${Math.min(ROUNDS, n)} (з ${n} з фото${hard ? ` · у хардкорі всього ${all}` : ""}).` : `Фото карток ще не додано (${all} карток без фото). Адміністратору: <a href="#admin">адмінка → «Картки»</a>.`;
      $("c-start").disabled = !n;
      $("c-start").textContent = `Почати: ${this.mode.name.toLowerCase()}`;
      $("c-start").onclick = () => this.start();
      if (!this.refPics && Game.password) this.loadRefPics().then((m) => { if (m && !$("s-start").hidden) this.renderMenu(); }).catch(() => {});
    },

    start(opt) {
      if (!Game.callsignOk()) return;
      SFX.unlock();
      if (window.Help && Help.maybe("cards", () => this.start(opt))) return;   // перший раз — інструкція
      this.fix = opt && opt.fix && opt.fix.length ? opt.fix : null;
      if (this.fix) this.mode = MODES.game;
      else if (opt && opt.mode && MODES[opt.mode]) this.mode = MODES[opt.mode];
      else { const mm = LS.get("poshuk_cmode", "game"); this.mode = MODES[mm] || MODES.game; }
      let pool = Logic.shuffle(this.fix ? this.fix.slice() : this.withPhoto(!!this.mode.hard));
      if (this.mode.ff && !this.fix) {   // порівну своїх і чужих, перемішано
        // своїх — випадково від 3 до 7 (не завжди 5+5: інакше останні картки вгадуються підрахунком)
        const f = this.ffPools(), want = 3 + Math.floor(Math.random() * 5);
        const nOwn = Math.min(f.own.length, Math.max(want, ROUNDS - f.foe.length));
        pool = Logic.shuffle(Logic.shuffle(f.own).slice(0, nOwn).concat(Logic.shuffle(f.foe).slice(0, ROUNDS - nOwn)));
      }
      this.quitted = false;
      this.rounds = pool.slice(0, ROUNDS).map((c) => Object.assign({}, c, {pic: this.pickPic(c.id, !!this.mode.ff && !this.fix)})); this.idx = -1; this.results = []; this.planned = this.rounds.length;
      UI.show("s-cards");
      document.body.dataset.mode = "cards";
      $("c-form").onsubmit = (e) => { e.preventDefault(); this.submit(); };
      $("c-form").classList.toggle("choice", !!this.mode.choice || !!this.mode.ff);
      this._deck = this.fix ? this.deck() : this.deck().filter((c) => c.hard === !!this.mode.hard);   // хибні варіанти — з того ж рівня
      if (!this._keys) { this._keys = (e) => { if (!(this.mode.choice || this.mode.ff) || this.over || document.body.dataset.mode !== "cards" || $("s-cards").hidden) return; const b = $("c-choices").querySelectorAll("button")[Number(e.key) - 1]; if (b && !b.disabled) b.click(); }; addEventListener("keydown", this._keys); }
      $("c-hint-btn").onclick = () => this.hint();
      $("c-sign-btn").onclick = () => this.sign();
      $("c-weak-btn").onclick = () => this.weak();
      this.used5050 = false;   // 50/50 — один раз за всю гру
      $("c-next").onclick = () => this.next();
      $("c-quit").onclick = () => { if (confirm("Перервати? Результат не буде збережено.")) { this.quit(); Game.showStart(); } };
      this.fitViewport();
      this.next();
    },
    stop() { clearInterval(this.tT); clearInterval(this.rT); this.unpixel(); const i = $("c-img"); if (i) i.style.visibility = ""; },
    /* Вихід: гра не продовжується у фоні (завантаження фото, що вже йде, після повернення нічого не запускає). */
    quit() { this.stop(); this.over = true; this.cur = null; this.quitted = true; },

    /* Телефон: коли відкрито клавіатуру — екран займає лише видиму частину, фото стискається. */
    fitViewport() {
      if (this._vv || !window.visualViewport) return;
      this._vv = () => document.documentElement.style.setProperty("--vvh", window.visualViewport.height + "px");
      visualViewport.addEventListener("resize", this._vv); this._vv();
    },

    async next() {
      if (this.quitted) return;
      this.stop();
      this.idx++;
      if (this.idx >= this.rounds.length) return this.summary();
      const c = this.cur = this.rounds[this.idx];
      this.hintUsed = false; this.signUsed = false; this.weakUsed = false; this.chosen = null;
      this.over = true;   // відповіді приймаються лише коли фото вже видно
      const errs = this.results.filter((r) => !r.ok).length;
      $("c-stage").textContent = `${this.mode.ff ? "Свій/чужий · " : this.mode.id === "exam" ? "Іспит · " : this.mode.reveal ? "Проявлення · " : this.mode.hard ? `Хардкор · помилок ${errs}/${this.mode.lives} · ` : ""}Картка ${this.idx + 1}/${this.rounds.length}`;
      if ($("c-concept")) $("c-concept").hidden = true;   // «КОНЦЕПТ» — лише після відповіді (у розборі), інакше підказує
      $("c-score").textContent = this.results.reduce((a, r) => a + r.score, 0);
      $("c-reveal").hidden = true; $("c-nextbox").hidden = true; $("c-form").hidden = false;
      $("c-hint").hidden = true; $("c-hint-btn").hidden = !this.mode.hint; $("c-hint-btn").textContent = this.mode.choice ? "💡 50/50" : "💡 Підказка";
      $("c-hint-btn").disabled = !!(this.mode.choice && this.used5050);
      $("c-hint-btn").title = this.mode.choice ? (this.used5050 ? "50/50 уже використано в цій грі" : "Прибрати два хибні варіанти — один раз за гру") : "";
      $("c-sign-btn").hidden = !this.mode.sign; $("c-sign-btn").disabled = !this.signOf(c);
      $("c-weak-btn").hidden = !this.mode.sign; $("c-weak-btn").disabled = !this.weakOf(c);
      $("c-answer").value = ""; $("c-answer").disabled = false; $("c-check").disabled = false;
      if (this.mode.ff) {
        $("c-choices").innerHTML = `<button type="button" class="ff-own" data-ff="own"><i>1</i><span>🟦 Свій</span></button><button type="button" class="ff-foe" data-ff="foe"><i>2</i><span>🟥 Чужий</span></button>`;
        $("c-choices").querySelectorAll("[data-ff]").forEach((b) => (b.onclick = () => this.ffAnswer(b.dataset.ff)));
      } else if (this.mode.choice) {
        const opts = this.opts = options(c, this._deck, confWith(c.id), this.deck());
        $("c-choices").innerHTML = opts.map((o, i) => `<button type="button" data-ci="${i}"><i>${i + 1}</i><span>${UI.nameHtml(o.name)}</span></button>`).join("");
        $("c-choices").querySelectorAll("button").forEach((b) => (b.onclick = () => this.choose(opts[+b.dataset.ci])));
      }
      if (window.Marks) Marks.clear($("c-pic"));
      const img = $("c-img"); img.removeAttribute("src"); $("c-loading").hidden = false;
      this.unpixel(); if (this.mode.reveal) img.style.visibility = "hidden";   // «Проявлення»: фото — лише через пікселі
      // фото не відкрилось (видалене чи недоступне) — інше фото цієї ж техніки; якщо жодне — картку пропускаємо
      const tried = new Set();
      for (;;) {
        const url = await this.photoUrl(c.id, c.pic).catch(() => null);
        if (url) await new Promise((res) => { img.onload = img.onerror = res; img.src = url; });
        if (this.cur !== c) return;
        if (url && img.naturalWidth) break;
        tried.add(c.pic && (c.pic.id || c.pic.key || "own"));
        const rest = this.picPool(c.id).filter((x) => !tried.has(x.id || x.key || "own") && !(this.mode.ff && x.id && (window.FF_SKIP || new Set()).has(x.id)));
        if (!rest.length) { $("c-loading").hidden = true; this.rounds.splice(this.idx, 1); this.idx--; this.planned = Math.max(0, (this.planned || 1) - 1); return this.next(); }
        c.pic = rest[Math.floor(Math.random() * rest.length)];
      }
      $("c-loading").hidden = true;
      // наступне фото — заздалегідь
      const nx = this.rounds[this.idx + 1];
      if (nx) this.photoUrl(nx.id, nx.pic).then((u) => { if (u) { const p = new Image(); p.src = u; } }).catch(() => {});
      this.t0 = performance.now(); this.over = false;
      this.tick(); this.tT = setInterval(() => this.tick(), 200);
      if (!this.mode.choice && !matchMedia("(pointer: coarse)").matches) $("c-answer").focus();
    },

    tick() {
      const T = this.mode.sec || ROUND_SEC, left = Math.max(0, T - (performance.now() - this.t0) / 1000);
      $("c-time").textContent = `0:${String(Math.ceil(left)).padStart(2, "0")}`;
      $("c-time").classList.toggle("warn", left <= 10);
      $("c-timebar").style.transform = `scaleX(${left / T})`;
      if (this.mode.reveal && !this.over) { this.pixel(1 - left / T); $("c-time").title = `Зараз за вірну відповідь: +${this.revealScore()}`; $("c-hint").innerHTML = `Зараз за вірну: <b>+${this.revealScore()}</b>`; $("c-hint").hidden = false; }
      document.querySelector("#s-cards .timebar").classList.toggle("warn", left <= 10);
      if (left <= 0) this.finish("", true);
    },

    /* «Проявлення»: пікселізація — квадрати від ~7% ширини фото до повної чіткості на ~42% часу (≈8,5 с із 20) */
    pixel(p) {
      const img = $("c-img"), box = $("c-pic"); if (!img.naturalWidth || !box) return;
      let cv = $("c-pix");
      if (!cv) { cv = document.createElement("canvas"); cv.id = "c-pix"; cv.className = "c-pix"; box.appendChild(cv); }
      const dpr = Math.min(2, devicePixelRatio || 1), W = box.clientWidth, H = box.clientHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      // той самий прямокутник, що й object-fit: contain
      const r = Math.min(W / img.naturalWidth, H / img.naturalHeight), dw = img.naturalWidth * r, dh = img.naturalHeight * r, dx = (W - dw) / 2, dy = (H - dh) / 2;
      const k = Math.max(0, 1 - p / 0.425), block = Math.max(1, W * 0.07 * Math.pow(k, 1.3));
      if (block <= 1.2) { this.unpixel(); img.style.visibility = ""; return; }
      const bs = Math.round(block * 2) / 2; if (cv._b === bs) return; cv._b = bs;   // перемальовувати лише коли змінився розмір квадрата
      const sw = Math.max(2, Math.round(dw / block)), sh = Math.max(2, Math.round(dh / block));
      const t = this._pt || (this._pt = document.createElement("canvas")); t.width = sw; t.height = sh;
      const tc = t.getContext("2d"); tc.imageSmoothingEnabled = true; tc.drawImage(img, 0, 0, sw, sh);
      const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H); x.imageSmoothingEnabled = false;
      x.drawImage(t, 0, 0, sw, sh, dx, dy, dw, dh);
    },
    unpixel() { const cv = $("c-pix"); if (cv) cv.remove(); },
    revealScore() {
      const T = this.mode.sec || ROUND_SEC, el = (performance.now() - (this.t0 || performance.now())) / 1000;
      return Math.max(2, Math.ceil(10 * (1 - el / T)));
    },

    hint() {
      if (!this.mode.hint || this.over) return;
      if (this.mode.choice) {   // 50/50: прибрати два хибні варіанти (раз за гру)
        if (this.used5050) return;
        this.used5050 = true; this.hintUsed = true;
        const wrong = Logic.shuffle(this.opts.filter((o) => o !== this.cur)).slice(0, 2);
        $("c-choices").querySelectorAll("button").forEach((b) => { if (wrong.includes(this.opts[+b.dataset.ci])) { b.disabled = true; b.classList.add("gone"); } });
        $("c-hint-btn").disabled = true; SFX.click(); return;
      }
      this.hintUsed = true;
      $("c-hint").innerHTML = `Тип: <b>${esc(this.cur.name.split(" ")[0])}</b> …`;
      $("c-hint").hidden = false; $("c-hint-btn").disabled = true;
      SFX.click();
    },

    /* «Ознака»: одна характерна ознака з довідника (опис запису техніки або ознаки картки), без назви й позначень. */
    signOf(c) {
      if (c._signs) return c._signs.length ? c._signs : null;
      const ref = (this.refDesc && this.refDesc.get(c.id)) || "";
      const strip = (t) => String(t || "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      const bad = this.badWords(c);
      const parts = (strip(ref) + " ¶ " + strip(c.p2).replace(/^Ознаки:\s*/i, ""))
        .split(/(?<=[.!?])\s+(?=[А-ЯІЇЄҐA-Z])|\s*¶\s*|;\s*|\s—\s/).map((x) => x.replace(/^[-•–.,;:\s]+|[\s.;,]+$/g, "").trim())
        .filter((x) => x.length >= 20 && x.length <= 180 && !/^\d/.test(x) && !/^ознаки$/i.test(x));
      const ok = parts.filter((x) => { const n = norm(x); return !bad.some((w) => n.includes(w)); });
      c._signs = [...new Set(ok)];
      return c._signs.length ? c._signs : null;
    },
    /* «Слабка сторона»: одна зі слабких сторін техніки з довідника, без назви й позначень. */
    weakOf(c) {
      if (c._weak) return c._weak.length ? c._weak : null;
      const bad = this.badWords(c);
      c._weak = ((window.CARD_WEAK || {})[c.id] || []).map((x) => String(x).replace(/[\s.;,]+$/g, "").trim()).filter((x) => x.length >= 10 && !bad.some((w) => norm(x).includes(w)));
      return c._weak.length ? c._weak : null;
    },
    weak() {
      if (!this.mode.sign || this.weakUsed || this.over) return;
      const list = this.weakOf(this.cur); if (!list) return;
      this.weakUsed = true; this.hintUsed = true;
      const s = list[Math.floor(Math.random() * list.length)];
      this.showHint(`🎯 Недолік: ${esc(s.charAt(0).toUpperCase() + s.slice(1))}`);
      $("c-weak-btn").disabled = true; SFX.click();
    },
    /* кілька підказок на одній картці — показуються разом, кожна з нового рядка */
    showHint(html) {
      const h = $("c-hint");
      h.innerHTML = (h.hidden ? "" : h.innerHTML + "<br>") + html; h.hidden = false;
    },
    badWords(c) {
      // слова з назви й синонімів, що видають відповідь (позначення, шифр, абревіатура типу «БАТ»), крім загальних
      return [c.name, ...c.aliases].flatMap((a) => String(a).split(/[\s«»"“”()\-]+/)).map(norm).filter((w) => w.length >= 3 && !/^(танк|машина|комплекс|ракета|система|станція|автомобіль|вантажівка|бронеавтомобіль|гаубиця|тягач|катер|літак|гелікоптер|обр|модернізований|самохідна|буксирувана)/.test(w));
    },
    sign() {
      if (!this.mode.sign || this.signUsed || this.over) return;
      const list = this.signOf(this.cur); if (!list) return;
      this.signUsed = true; this.hintUsed = true;
      const s = list[Math.floor(Math.random() * list.length)];
      this.showHint(`🔎 Ознака: ${esc(s.charAt(0).toUpperCase() + s.slice(1))}`);
      $("c-sign-btn").disabled = true; SFX.click();
    },

    /* «Свій/чужий»: правильно +10, «не впевнений» −1, помилка −2 (хибне «чужий» по своїх — найгірше: виділяється червоним). */
    ffAnswer(a, timeout) {
      if (this.over) return;
      this.over = true; this.stop();
      const c = this.cur, truth = c.own ? "own" : "foe";
      if (timeout) a = "unsure";   // не встиг вирішити — −1
      const ok = a === truth, score = ok ? 10 : a === "unsure" ? -1 : -2;
      const label = {own: "свій", foe: "чужий", unsure: "—"}[a] || "—";
      this.results.push({id: c.id, name: c.name, answer: timeout ? "час вийшов" : label, ok, score, hint: false, cat: Logic.category(c.name)});
      $("c-score").textContent = this.results.reduce((s, r) => s + r.score, 0);
      if (ok) SFX.hit(); else SFX.miss();
      if (!ok && window.Game && Game.buzz) Game.buzz(a === "foe" ? [120, 60, 120] : 60);
      $("c-form").hidden = true; $("c-choices").innerHTML = "";
      const sign = this.signOf(c), cap = (s) => esc(s.charAt(0).toUpperCase() + s.slice(1));
      const v = ok ? `<p class="c-v ok">✓ Вірно: ${c.own ? "🟦 свій" : "🟥 чужий"} · +10</p>`
        : a === "unsure" ? `<p class="c-v no">⏱ Час вийшов · −1. Це ${c.own ? "🟦 свій" : "🟥 чужий"}.</p>`
        : truth === "own" ? `<p class="c-v no ff-frat">⚠ Удар по своїх! Це 🟦 своя техніка · −2</p>`
        : `<p class="c-v no">✗ Пропущено ворога: це 🟥 чужий · −2</p>`;
      $("c-reveal").innerHTML = `${v}<h3>${UI.nameHtml(c.name)}</h3>${sign ? `<p class="c-contrast">🔎 ${cap(sign[0])}</p>` : ""}<p>${esc(c.p1)}</p><p>${esc(c.p2)}</p>
        <p class="muted small">У бою вирішує не лише тип: розпізнавальні знаки, напрямок руху, місце в бойовому порядку — і запит на підтвердження перед ураженням.</p>`;
      $("c-reveal").hidden = false; $("c-reveal").scrollTop = 0;
      this.showMarks(c);
      const last = this.idx === this.rounds.length - 1;
      $("c-next").textContent = last ? "Підсумок →" : "Далі →"; $("c-nextbox").hidden = false;
      const bar = $("c-cd"); bar.style.transition = "none"; bar.style.transform = "scaleX(1)";
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = `transform ${REVEAL_SEC}s linear`; bar.style.transform = "scaleX(0)"; }));
      const t0 = performance.now();
      this.rT = setInterval(() => { if (performance.now() - t0 >= REVEAL_SEC * 1000) this.next(); }, 250);
    },

    choose(o) {
      if (this.over) return;
      this.chosen = o; this.finish(o.name, false, o.id === this.cur.id);
    },

    submit() {
      this.chosen = null;
      const v = $("c-answer").value.trim();
      if (!v) { $("c-answer").focus(); return; }
      this.finish(v, false);
    },

    finish(answer, timeout, picked) {
      if (this.mode.ff) return this.ffAnswer("", true);
      if (this.over) return;
      this.over = true; this.stop();
      this.unpixel(); $("c-img").style.visibility = "";   // «Проявлення»: після відповіді — чітке фото
      const c = this.cur, r = timeout ? {ok: false} : picked !== undefined ? {ok: picked, exact: true} : check(c, answer), score = r.ok ? (this.mode.reveal ? this.revealScore() : 10) : 0;
      this.results.push({id: c.id, name: c.name, answer, ok: r.ok, score, hint: this.hintUsed, cat: Logic.category(c.name)});
      $("c-score").textContent = this.results.reduce((a, x) => a + x.score, 0);
      if (r.ok) SFX.hit(); else SFX.miss();
      document.activeElement && document.activeElement.blur && document.activeElement.blur();   // сховати клавіатуру
      $("c-form").hidden = true;
      const verdict = r.ok ? `<p class="c-v ok">✓ Вірно${r.exact ? "" : " (з одруківкою)"} · +${score}</p>`
        : `<p class="c-v no">${timeout ? "⏱ Час вийшов" : `✗ Невірно: «${esc(answer)}»`} · 0</p>`;
      $("c-choices").innerHTML = "";
      const cr = c.pic && !c.pic.own ? (c.pic.credit ? (() => { try { return decodeURIComponent(c.pic.credit); } catch (e) { return c.pic.credit; } })() : "навчальний довідник ВОС276") : (Game.cardCredits && Game.cardCredits.get(c.id)) || "";
      const weak = (window.CARD_WEAK || {})[c.id];
      // плутанина: що обрали замість правильної (варіант або вписана назва іншої техніки) — запам'ятати й показати різницю
      let other = null;
      if (!r.ok && !timeout) {
        other = this.chosen && this.chosen.id !== c.id ? this.chosen : (() => { const id = check.idx && check.idx.get(norm(answer)); return id && id !== c.id ? this.deck().find((x) => x.id === id) : null; })();
        if (other) confAdd(c.id, other.id);
      }
      const cap = (s) => esc(s.charAt(0).toUpperCase() + s.slice(1));
      // відмінна ознака: така, якої немає в описі іншої техніки пари (однакові ознаки нічого не пояснюють)
      const diff = (x, y) => { const l = (x && this.signOf(x)) || [], o = new Set(((y && this.signOf(y)) || []).map(norm)); return l.find((t) => !o.has(norm(t))) || ""; };
      const oSign = diff(other, c), cSign = diff(c, other);
      const contrast = other ? `<p class="c-contrast">⚖ ${r.ok ? "Не плутати з" : "Ви обрали"} <b>${UI.nameHtml(other.name)}</b>${oSign ? `: ${cap(oSign)}` : ""}${cSign ? `<br>А тут — <b>${UI.nameHtml(c.name)}</b>: ${cap(cSign)}` : ""}</p>` : "";
      // хардкор: одна можлива помилка, друга — кінець гри
      const over = this.mode.lives != null && this.results.filter((x) => !x.ok).length > this.mode.lives;
      if (over) this.rounds = this.rounds.slice(0, this.idx + 1);
      $("c-reveal").innerHTML = `${verdict}${over ? `<p class="c-v no">💀 Друга помилка — хардкор завершено</p>` : ""}${c.concept ? `<p class="c-concept-tag">КОНЦЕПТ</p>` : ""}<h3>${UI.nameHtml(c.name)}</h3>${contrast}<p>${esc(c.p1)}</p><p>${esc(c.p2)}</p>${weak && weak.length ? `<p class="c-weak"><b>Недоліки:</b> ${weak.map(esc).join(" ")}</p>` : ""}${cr ? `<p class="credit">Фото: ${esc(cr)}</p>` : ""}`;
      $("c-reveal").hidden = false; $("c-reveal").scrollTop = 0;
      this.showMarks(c);
      const last = this.idx === this.rounds.length - 1;
      $("c-next").textContent = last ? "Підсумок →" : "Далі →";
      $("c-nextbox").hidden = false;
      const bar = $("c-cd"); bar.style.transition = "none"; bar.style.transform = "scaleX(1)";
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = `transform ${REVEAL_SEC}s linear`; bar.style.transform = "scaleX(0)"; }));
      const t0 = performance.now();
      this.rT = setInterval(() => { if (performance.now() - t0 >= REVEAL_SEC * 1000) this.next(); }, 250);
    },

    /* Після відповіді — ознаки на фото: якщо в цього фото є розмітка, показуємо її; якщо немає, але є розмічене
       інше фото цієї техніки — підміняємо фото на нього. Під описом — легенда «① … ② …». */
    async showMarks(c) {
      if (!window.Marks) return;
      let pic = c.pic && c.pic.id && Marks.of(c.pic.id) ? c.pic : Marks.firstMarked(this.picPool(c.id).filter((p) => p.id));
      if (!pic) return;
      const img = $("c-img");
      if (pic !== c.pic) {
        const u = await this.photoUrl(c.id, pic).catch(() => null);
        if (!u || this.cur !== c || !this.over) return;
        // спершу перевірити, що фото з розміткою відкривається — інакше лишаємо те, що вже на екрані
        const pre = new Image(); await new Promise((res) => { pre.onload = pre.onerror = res; pre.src = u; });
        if (!pre.naturalWidth || this.cur !== c) return;
        await new Promise((res) => { img.onload = img.onerror = res; img.src = u; });
        if (this.cur !== c) return;
      }
      const m = Marks.of(pic.id);
      Marks.overlay($("c-pic"), img, m);
      const lg = Marks.legend(m);
      if (lg) { const p = document.createElement("p"); p.className = "mk-legend"; p.innerHTML = `<span>Ознаки на фото:</span> ${lg}`; const h = $("c-reveal").querySelector("h3"); h ? h.after(p) : $("c-reveal").prepend(p); }
    },

    summary() {
      if (this.quitted) return;
      this.stop();
      if (window.Marks) Marks.clear($("c-pic"));
      if (!this.results.length) {   // жодне фото не відкрилось (зв'язок) — порожній результат не записуємо
        Game.showStart(); UI.toast("Фото не завантажились — перевірте зв'язок і спробуйте ще раз.");
        return;
      }
      UI.show("s-summary");
      Game.lastGame = "cards"; Game.lastFix = !!this.fix; Game.lastCardsMode = this.mode.ff ? "ff" : null;
      const res = this.results, max = 10 * (this.mode.lives != null && !this.fix ? (this.planned || res.length) : res.length), total = res.reduce((a, r) => a + r.score, 0);
      const pct = max ? Math.max(0, Math.round(100 * total / max)) : 0, m = this.mode;
      const concl = m.pass ? (pct >= m.pass ? "Склав" : "Не склав") : Logic.conclusion(total, max);
      $("sum-title").textContent = `${this.fix ? "Робота над помилками · картки" : `Картки${m.id === "exam" ? " · Іспит" : m.hard ? " · Хардкор" : m.reveal ? " · Проявлення" : m.ff ? " · Свій/чужий" : ""}`} · ${Game.callsign}`;
      $("sum-total").textContent = `${total} з ${max} балів · ${pct}% · ${concl}`;
      $("sum-total").style.color = m.pass ? (pct >= m.pass ? "var(--hit)" : "var(--miss)") : pct >= 60 ? "var(--hit)" : pct >= 40 ? "var(--accent)" : "var(--miss)";
      const rk = Logic.rank(pct);
      $("sum-rank").innerHTML = `${Logic.rankBadge(rk.level)}<div><div class="rk-label">Звання</div><div class="rk-name">${esc(rk.name)}</div><div class="rk-next">${rk.next ? `До «${esc(rk.next.name)}» — від ${rk.next.min}%` : "Найвище звання"}</div></div>`;
      $("sum-table").innerHTML = `<tr><th class="num">№</th><th>Техніка</th><th>Ваша відповідь</th><th class="num">Бали</th></tr>` +
        res.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${UI.nameHtml(r.name)}</td><td class="${r.ok ? "t-ok" : "t-no"}">${esc(r.answer || "—")}${r.hint ? " 💡" : ""}</td><td class="num">${r.score}</td></tr>`).join("");
      const now = new Date(), p2 = (x) => String(x).padStart(2, "0");
      const item = {callsign: Game.callsign, scores: res.map((r) => r.score), max, mode: m.id === "exam" ? "cards_exam" : m.hard ? "cards_hard" : "cards",
        conclusion: this.fix ? `Картки (робота над помилками): ${concl}` : `Картки${m.id === "exam" ? " (іспит)" : m.hard ? " (хардкор)" : m.reveal ? " (проявлення)" : m.ff ? " (свій/чужий)" : ""}: ${concl}`,
        date: `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`, clicks: [],
        items: res.map((r) => ["cards", r.id, r.name, r.cat, r.ok ? 1 : 0])};
      Game.queueResult(item);
      $("sum-sync").className = "muted"; $("sum-sync").textContent = "Записую результат…";
      Game.flushPending().then((left) => {
        $("sum-sync").textContent = left ? "Немає зв'язку: результат збережено в браузері й надішлеться при наступному вході." : (/(^|[^a-zа-яіїєґ])(тест|test)/i.test(String(Game.callsign || "")) ? "Тестовий вхід — результат не записується в аналітику." : (window.Offline && Offline.on ? "Збережено на цьому пристрої (офлайн-версія)." : "Результат записано."));
        $("sum-sync").style.color = left ? "var(--miss)" : "var(--hit)";
      });
    },
  };
  window.Cards = Cards;
})();
