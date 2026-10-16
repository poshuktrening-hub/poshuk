/* Гра курсанта: вхід, етапи, доповідь, розбір, підсумок, черга відправки результатів. */
(function () {
  const $ = (id) => document.getElementById(id);
  const {LS, SS} = API;
  const HINT_SCORE = 5, BRIEF_MS = 5000;
  const OUTRO_DELAY = 450, OUTRO_MS = 1100;
  const COLORS = {hit: "#3ddc97", miss: "#ff5a4f", accent: "#ffb23e", decoy: "#b48cff"};

  const TOUCH = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  const BG_SCREENS = ["s-login", "s-start", "s-summary"];
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
    const bg = $("bgvid"), on = BG_SCREENS.includes(id);
    if (!bg) return;
    bg.hidden = !on;
    document.body.classList.toggle("with-bg", on);
    const v = bg.querySelector("video");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches || (navigator.connection && navigator.connection.saveData);
    if (on && !still) v.play().catch(() => {}); else v.pause();
  }
  function toast(text, ms = 3500) {
    const t = $("toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
  }
  const fmt = (sec) => { const s = Math.ceil(sec); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  const Game = {
    password: null, cfg: null, stages: [], viewer: null,

    // ---------- вхід
    async boot() {
      this.password = LS.get("poshuk_pw", null);
      $("login-form").onsubmit = (e) => { e.preventDefault(); this.login($("login-pass").value); };
      $("start-form").onsubmit = (e) => { e.preventDefault(); this.start(); };
      $("logout-btn").onclick = () => { LS.del("poshuk_pw"); this.password = null; this.showLogin(); };
      $("g-skip").onclick = () => this.skip();
      $("g-hint").onclick = () => this.hint();
      $("g-sound").textContent = SFX.on ? "🔊" : "🔇";
      $("g-sound").onclick = () => { $("g-sound").textContent = SFX.toggle() ? "🔊" : "🔇"; };
      $("g-next").onclick = () => this.goNext();
      $("g-quit").onclick = () => { clearInterval(this.nextT); if (confirm("Перервати гру? Результат не буде збережено.")) this.showStart(); };
      $("sum-again").onclick = () => { SFX.click(); if (this.lastGame === "cards" && window.Cards) Cards.start(); else this.start(); };   // та сама гра з тими ж налаштуваннями
      $("sum-menu").onclick = () => { SFX.click(); this.lastView = "menu"; this.showStart(); };
      $("sum-exit").onclick = () => $("logout-btn").click();
      document.addEventListener("keydown", (e) => {
        if ($("s-game").hidden || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
        if (e.key === "+" || e.key === "=") this.viewer.zoomCenter(1.6);
        else if (e.key === "-") this.viewer.zoomCenter(1 / 1.6);
        else if (e.key === "0") this.viewer.fill(true);
        else if (e.key === "Enter" && !$("g-next").hidden) this.goNext();
      });
      if (!this.password) return this.showLogin();
      try { await this.loadConfig(); this.showStart(); } catch (e) { this.showLogin(e.auth ? "" : e.message); }
    },

    showLogin(err = "") {
      show("s-login");
      $("login-err").textContent = err;
      $("login-pass").value = "";
      $("login-pass").focus();
    },

    async login(pw) {
      $("login-btn").disabled = true;
      $("login-err").textContent = "";
      try {
        this.password = pw;
        await this.loadConfig();
        LS.set("poshuk_pw", pw);
        this.showStart();
      } catch (e) {
        this.password = null;
        $("login-err").textContent = e.message;
      } finally { $("login-btn").disabled = false; }
    },

    async loadConfig() {
      const j = await API.call("config", {}, this.password);
      this.cfg = j.settings;
      // підпис автора: іконка завантажується в адмінці (у базі, не в репозиторії); немає — лишається слово
      const ci = $("credit-icon");
      if (ci) ci.innerHTML = j.brandIcon ? `<img src="${j.brandIcon}" alt="wolverine">` : "wolverine";
      this.stages = j.stages; API.noteStages(j.stages);
      this.objects = j.objects || [];
      this.cardPhotos = new Map(j.cardPhotos || []);
      this.cardCredits = new Map(j.cardCredits || []);
      this.typePool = [...new Set([...this.stages.flatMap((s) => s.targets.map((t) => t.type)), ...Logic.TYPES].filter(Boolean))];
    },

    showStart() {
      show("s-start");
      const saved = LS.get("poshuk_menu", {}) || {};
      this.sel = {mode: Logic.MODES[saved.mode] ? saved.mode : "game",
        regions: Array.isArray(saved.regions) ? saved.regions.filter((r) => Logic.REGIONS.includes(r)) : Logic.REGIONS.slice(),
        seasons: Array.isArray(saved.seasons) ? saved.seasons.filter((r) => Logic.SEASONS.includes(r)) : Logic.SEASONS.slice()};
      if (!this.sel.seasons.length) this.sel.seasons = Logic.SEASONS.slice();   // збережені «Весна/Осінь» більше не існують
      this.renderMenu();
      try { if (window.Cards) Cards.renderMenu(); } catch (e) { console.error(e); }
      $("callsign").value = $("callsign").value.trim() || LS.get("poshuk_callsign", "");   // не губити щойно введений позивний
      $("start-err").textContent = "";
      this.view(this.lastView || "menu");
      document.querySelectorAll("#s-start [data-go]").forEach((b) => (b.onclick = () => { SFX.click(); this.view(b.dataset.go); }));
      document.querySelectorAll("#s-start [data-help]").forEach((b) => (b.onclick = () => Help.show(b.dataset.help)));
      this.refreshPending();
      this.flushPending().then(() => this.loadTop());
      if (!$("callsign").value) $("callsign").focus();
    },
    /* Топ дня в головному меню: найкращий результат кожного курсанта за поточну добу + звання за цим результатом. */
    async loadTop() {
      const draw = (id, list) => {
        const el = $(id); if (!el) return;
        list = list || [];
        el.innerHTML = `<li class="top-h">Топ дня</li>` + (list.length ? list.map((x, i) => { const rk = Logic.rank(x.pct);
          return `<li><i>${["🥇", "🥈", "🥉"][i]}</i><span class="tn"><b>${esc(x.name)}</b><small title="${esc(rk.name)}">${Logic.rankBadge(rk.level)}${esc(rk.name)}</small></span><em>${x.pct}%</em></li>`; }).join("")
          : `<li class="top-none">Сьогодні ще ніхто не проходив — будьте першим</li>`);
        el.hidden = false;
      };
      if (this.top && this.topDay === today()) { draw("top-search", this.top.search); draw("top-cards", this.top.cards); }
      try {
        const d = today(), j = await API.call("top", {since: d + " 00:00"}, this.password);
        this.top = j.top; this.topDay = d; draw("top-search", j.top.search); draw("top-cards", j.top.cards);
      } catch (e) { /* без топу — не страшно */ }
    },
    /* Головне меню → підменю режиму. */
    view(v) {
      if (v === "ref") { if (window.Ref) Ref.open(); return; }
      if (v === "duel") { if (window.Duel) Duel.open(); return; }
      this.lastView = v;
      $("main-menu").hidden = v !== "menu";
      $("sub-search").hidden = v !== "search";
      $("sub-cards").hidden = v !== "cards";
      $("start-err").textContent = "";
    },
    callsignOk() {
      const cs = $("callsign").value.trim();
      if (!cs) { $("start-err").textContent = "Введіть прізвище"; $("callsign").focus(); return null; }
      LS.set("poshuk_callsign", cs); this.callsign = cs; return cs;
    },

    /* Головне меню: режим, напрямок, пора року (з кількістю етапів у кожному варіанті). */
    playable() { return this.stages.filter((s) => s.targets && s.targets.some((t) => !t.decoy)); },
    /* Галочки: усі вибрані = без фільтра (разом з етапами, де напрямок/пора не вказані). */
    filtered(regions = this.sel.regions, seasons = this.sel.seasons) {
      const allR = regions.length === Logic.REGIONS.length, allS = seasons.length === Logic.SEASONS.length;
      const pool = this.playable().filter((s) => (allR || regions.includes(Logic.region(s))) && (allS || seasons.includes(s.season)));
      // хардкор-етапи (техніка сховано понад 60%) — лише в «Хардкорі»; там вони йдуть першими
      if ((this.sel && this.sel.mode) !== "hard") return pool.filter((s) => !s.hard);
      const hard = pool.filter((s) => s.hard);
      return hard.length >= Math.min(this.cfg.rounds_per_game, pool.length) ? hard : [...hard, ...pool.filter((s) => !s.hard)];
    },
    renderMenu() {
      const sel = this.sel;
      const chip = (group, v, list, n) => { const on = sel[group].includes(v);
        return `<button type="button" role="checkbox" aria-checked="${on}" class="chip${on ? " on" : ""}" data-g="${group}" data-v="${esc(v)}"><i aria-hidden="true">${on ? "✓" : ""}</i>${esc(v)}<small>${n}</small></button>`; };
      $("pick-mode").innerHTML = Object.values(Logic.MODES).map((m) =>
        `<button type="button" role="radio" aria-checked="${sel.mode === m.id}" class="mode${sel.mode === m.id ? " on" : ""}" data-m="${m.id}"><b>${m.name}</b><span>${esc(m.desc)}</span></button>`).join("");
      $("pick-region").innerHTML = Logic.REGIONS.map((r) => chip("regions", r, sel.regions, this.playable().filter((s) => Logic.region(s) === r).length)).join("");
      $("pick-season").innerHTML = Logic.SEASONS.map((x) => chip("seasons", x, sel.seasons, this.playable().filter((s) => s.season === x).length)).join("");
      const save = () => { LS.set("poshuk_menu", sel); SFX.click(); this.renderMenu(); };
      document.querySelectorAll("#pick-mode [data-m]").forEach((b) => (b.onclick = () => { sel.mode = b.dataset.m; save(); }));
      document.querySelectorAll("#s-start [data-g]").forEach((b) => (b.onclick = () => {
        const a = sel[b.dataset.g], v = b.dataset.v;
        sel[b.dataset.g] = a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
        save();
      }));
      const pool = this.filtered(), n = Math.min(this.cfg.rounds_per_game, pool.length);
      if (!this.playable().length) {
        $("start-info").innerHTML = 'Поки немає жодного етапу. Адміністратору: <a href="#admin">відкрийте адмінку</a> й додайте знімки.';
      } else $("start-info").textContent = n ? `Етапів у грі: ${n}${pool.length > n ? ` (з ${pool.length})` : ""}.` : "Для вибраних напрямків і пір року етапів немає — додайте галочки.";
      $("start-btn").disabled = !n;
      $("start-btn").textContent = `Почати: ${Logic.MODES[sel.mode].name.toLowerCase()}`;
    },

    // ---------- гра
    start() {
      if (!this.callsignOk()) return;
      SFX.unlock();
      if (window.Help && Help.maybe("search", () => this.start())) return;   // перший раз — інструкція
      this.mode = Logic.MODES[this.sel.mode] || Logic.MODES.game;
      this.limit = this.mode.seconds || Math.round(this.cfg.time_limit_sec * (this.mode.time || 1));
      this.missLimit = this.mode.misses === null ? this.cfg.misses_allowed : this.mode.misses;
      document.body.dataset.mode = this.mode.id;
      const fl = this.filtered(), hardFirst = this.mode.id === "hard" ? fl.filter((s) => s.hard) : [];
      this.rounds = hardFirst.length >= this.cfg.rounds_per_game ? Logic.pickRounds(hardFirst, this.cfg.rounds_per_game)
        : [...Logic.pickRounds(hardFirst, hardFirst.length), ...Logic.pickRounds(fl.filter((s) => !hardFirst.includes(s)), this.cfg.rounds_per_game - hardFirst.length)];
      this.results = [];
      this.idx = -1;
      show("s-game");
      if (!this.viewer) {
        this.viewer = new Viewer($("g-view"), {fill: true, onLeft: (x, y) => this.leftClick(x, y), onRight: (x, y) => this.rightClick(x, y), onChange: () => this.hud()});
        const g = this.viewer.addButton("#", "Сітка квадратів", () => { this.viewer.toggleGrid(); g.classList.toggle("on", this.viewer.showGrid); });
        this.gridBtn = g;
        this.viewer.rail.insertBefore($("g-sound"), this.viewer.zoomLbl || null);
        $("g-tools").appendChild(this.viewer.rail);   // кнопки зуму — у нижню панель, щоб нічого не лежало поверх мапи
      }
      this.viewer.toggleGrid(false);   // сітка — за кнопкою «#» (і вмикається підказкою)
      this.gridBtn.classList.remove("on");
      this.gridBtn.hidden = !this.mode.grid;
      this.rounds.forEach((_, i) => this.preload(i));
      this.nextRound();
    },

    preload(i) {
      const st = this.rounds[i];
      if (st) API.loadImage(st.id, this.password).catch(() => {});
    },

    /* Кнопка «Далі» по центру з відліком 5 с — потім сама переходить далі.
       Розгорнули розбір — відлік ставиться на паузу. */
    showNext(label) {
      const b = $("g-next"), N = 5;
      clearInterval(this.nextT);
      let left = N;
      b.innerHTML = `${label} → <span class="cd">${left}</span><i class="cd-bar"></i>`;
      b.hidden = false; b.classList.add("center-next");
      const bar = b.querySelector(".cd-bar");
      bar.style.transition = "none"; bar.style.transform = "scaleX(1)";
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = `transform ${N}s linear`; bar.style.transform = "scaleX(0)"; }));
      b.focus({preventScroll: true});
      this.placeNext();
      this.nextT = setInterval(() => {
        const det = document.querySelector("#g-debrief details");
        if (det && det.open) {   // читають розбір — чекаємо
          clearInterval(this.nextT); b.querySelector(".cd").textContent = ""; bar.style.transition = "none"; bar.style.transform = "scaleX(0)";
          return;
        }
        left--;
        const cd = b.querySelector(".cd"); if (cd) cd.textContent = left > 0 ? left : "";
        if (left <= 0) { clearInterval(this.nextT); this.goNext(); }
      }, 1000);
    },
    /* «Далі» — нижче або вище центру, там, де немає цілей (кнопка не має закривати щойно знищену ціль). */
    placeNext() {
      const b = $("g-next"), v = this.viewer;
      if (!b || b.hidden || !v || !v.img) return;
      const hr = v.host.getBoundingClientRect(), H = innerHeight, bh = b.offsetHeight || 60, bw = b.offsetWidth || 240;
      const pts = [...(this.targets || []), ...(this.decoys || [])].map((t) => [hr.left + v.tx + t.x * v.s, hr.top + v.ty + t.y * v.s, (t.r || 14) * v.s + 30]);
      const score = (fy) => {   // найменша відстань від цілей до прямокутника кнопки
        const cy = H * fy, x0 = innerWidth / 2 - bw / 2, x1 = innerWidth / 2 + bw / 2, y0 = cy - bh / 2, y1 = cy + bh / 2;
        return Math.min(1e9, ...pts.map(([x, y, r]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)) - r));
      };
      const best = [0.76, 0.86, 0.24, 0.5].map((fy) => [fy, score(fy)]).sort((a, c) => (c[1] > 0) - (a[1] > 0) || (a[1] > 0 ? 0 : c[1] - a[1]))[0][0];
      b.style.top = Math.round(best * 100) + "%";
    },
    goNext() {
      clearInterval(this.nextT);
      const b = $("g-next"); if (b.hidden) return;
      b.hidden = true; b.classList.remove("center-next"); b.style.top = "";
      this.nextRound();
    },

    async nextRound() {
      this.idx++;
      if (this.idx >= this.rounds.length) return this.summary();
      clearTimeout(this.outroT);
      const st = this.cur = this.rounds[this.idx];
      this.targets = st.targets.filter((t) => !t.decoy);
      this.decoys = st.targets.filter((t) => t.decoy);
      this.found = new Set(); this.foundOrder = []; this.misses = 0; this.marks = []; this.clicks = [];
      this.over = true;
      $("g-next").hidden = true; $("g-skip").hidden = !this.mode.skip; $("g-hint").hidden = !this.mode.hint; $("g-hint").disabled = false;
      this.hintUsed = false;
      $("g-debrief").hidden = true;
      $("g-stage").textContent = `${this.mode.id === "game" ? "" : this.mode.name + " · "}Етап ${this.idx + 1}/${this.rounds.length} · ${st.title}`;
      this.msg("Завантажую знімок…");
      $("g-loading").hidden = false;
      let img;
      try { img = await API.loadImage(st.id, this.password); } catch (e) {
        $("g-loading").hidden = true;
        this.msg("Не вдалось завантажити знімок: " + e.message + " Етап пропущено.", "no");
        this.results.push({title: st.title, id: st.id, found: 0, total: st.targets.length, misses: 0, time: 0, score: 0, clicks: [], report: ""});
        $("g-skip").hidden = true; this.showNext("Далі");
        return;
      }
      $("g-loading").hidden = true;
      this.preload(this.idx + 1);
      this.viewer.setImage(img);
      if (window.FX && FX.prepare) FX.prepare(this.viewer);
      this.viewer.setGrid(this.cfg.grid_cols);
      if (!this.mode.blind) { this.msg("Брифінг: запам'ятайте, що шукаєте."); await this.brief(st); }
      if (this.cur !== st) return;
      this.over = false;
      this.msg("");
      this.t0 = performance.now(); this.lastTick = null;
      this.hudSeed(st); this.hud();
      this.stats();
      this.tick();
    },

    /* Брифінг перед етапом: 5 с чорний екран з технікою, яку шукатимуть, та її ТТХ. */
    /* Модель за назвою цілі, якщо прямого збігу немає (напр. ціль «РСЗВ Град», а модель «БМ-21 Град» або вже оновлена версія). */
    objByName(type) {
      const GEN = /^(рсзв|танк|сау|зрк|зргк|бмп|бмд|бтр|рлс|реб|птрк|ціль|техніка|муляж|вантажівка|гаубиця|гармата|міномет|бпла|катапульта|з)$/;
      const words = String(type || "").toLowerCase().split(/[^a-zа-яіїєґ0-9-]+/).filter((w) => w.length >= 3 && !GEN.test(w));
      if (!words.length) return null;
      const cand = this.objects.filter((x) => !x.decoy && words.some((w) => String((x.name || "") + " " + (x.type || "")).toLowerCase().includes(w)));
      return cand[0] || null;
    },
    /* Картинка техніки для брифінгу — ланцюжок запасних варіантів: модель етапу → інша модель з такою назвою →
       вбудована модель того ж типу → фото з карток/довідника. Якщо одна не відкривається — береться наступна. */
    async picChain(t, o) {
      const norm = (x) => String(x || "").toLowerCase();
      const out = [], add = (u) => { if (u && !out.includes(u)) out.push(u); };
      const objSrc = async (m) => (m.builtin ? (Models.sprite(m.id) || {toDataURL: () => ""}).toDataURL() : API.objUrl(m.id, this.password).catch(() => null));
      if (o) add(await objSrc(o));
      const text = norm([t.type, o && o.name].join(" "));
      const words = text.split(/[^a-zа-яіїєґ0-9-]+/).filter((w) => w.length >= 3);
      for (const m of this.objects.filter((x) => !x.decoy && x !== o && words.some((w) => norm(x.name).includes(w)))) add(await objSrc(m));
      const ty = Logic.typeOf(t.type || (o && o.name) || "");
      const bi = Models.LIST.find((m) => !m.decoy && !/:decoy$/.test(m.id) && (m.id === t.obj || words.some((w) => norm(m.name).includes(w)) || Logic.typeOf(m.name) === ty));
      if (bi) add(await objSrc(bi));
      // фото з режиму «Картки» (за назвами/синонімами), напр. «Град» → БМ-21
      const hay = norm([text, bi && bi.name].join(" "));
      const card = (window.CARDS || []).find((c) => String(c[2] || "").split("|").some((al) => al.length >= 3 && hay.includes(al)));
      if (card && window.Cards) add(await Cards.photoUrl(card[0]).catch(() => null));
      return out;
    },
    /* Відкрилась, але порожня (майже прозора чи крихітна — напр. невдало прибраний фон)? Тоді — наступна картинка. */
    picCheck(img) {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (w < 16 || h < 16) return this.picFail(img);
        const k = Math.min(1, 64 / Math.max(w, h)), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        const x = c.getContext("2d"); x.drawImage(img, 0, 0, c.width, c.height);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
        if (n < c.width * c.height * 0.04) this.picFail(img);
      } catch (e) { /* немає доступу до пікселів — лишаємо як є */ }
    },
    picFail(img) {
      let alt = []; try { alt = JSON.parse(img.dataset.alt || "[]"); } catch (e) { alt = []; }
      if (!alt.length) { const b = img.closest(".b-pic"); if (b) b.remove(); return; }
      img.dataset.alt = JSON.stringify(alt.slice(1));
      img.src = alt[0];
    },
    async brief(st, after = false) {
      const norm = (s) => String(s || "").toLowerCase().trim();
      const seen = new Set(), items = [];
      for (const t of st.targets.filter((x) => !x.decoy)) {
        const key = t.obj || norm(t.type);
        if (seen.has(key)) continue;
        seen.add(key);
        const o = this.objects.find((x) => x.id === t.obj) || this.objects.find((x) => norm(x.type) === norm(t.type)) || this.objByName(t.type) || null;
        items.push({t, o: o || (Models.isBuiltin(t.obj) ? Models.LIST.find((m) => m.id === t.obj) : null) || (/катапульт/.test(norm(t.type)) ? Models.LIST[0] : null)});
      }
      const box = $("g-brief");
      const cards = await Promise.all(items.map(async ({t, o}) => {
        const srcs = await this.picChain(t, o);
        const pic = srcs.length ? `<img src="${srcs[0]}" alt="" data-alt="${esc(JSON.stringify(srcs.slice(1)))}" onerror="Game.picFail(this)" onload="Game.picCheck(this)">` : "";
        const ttx = Logic.ttxFor(o, t.type, !!t.decoy);
        const len = o && o.length_m ? `<p class="len">Довжина ≈ ${o.length_m} м</p>` : "";
        const name = Logic.dispName(o && o.name ? o.name.replace(/\s*\(вбудована\)$/, "") : (t.type || "ціль"));
        const sub = o && o.name && t.type && !Logic.nameHasType(name, t.type) ? `<p class="len">${esc(t.type)}</p>` : "";   // тип окремим рядком — лише якщо його немає в назві
        return `<div class="b-card">${pic ? `<div class="b-pic">${pic}</div>` : ""}<div class="b-txt"><h3>${esc(name)}</h3>${sub}${len}${ttx ? `<p>${esc(ttx).replace(/\n/g, "<br>")}</p>` : ""}</div></div>`;
      }));
      const n = st.targets.filter((x) => !x.decoy).length;
      const types = [...new Set(st.targets.filter((x) => !x.decoy).map((x) => x.type).filter(Boolean))].join(", ");
      const task = (st.task || "").trim() || `Виявити ${types || "техніку противника"} у районі «${st.title.split("·")[0].trim()}» та позначити для ураження.`;
      if (after) {   // хардкор: картка цілі — лише після етапу
        box.innerHTML = `<div class="b-inner"><div class="b-head">ЕТАП ${this.idx + 1} · ЩО ВИ ШУКАЛИ</div>${cards.join("")}
          <div class="b-foot"><div class="b-bar"><i></i></div><button type="button" class="primary" id="b-go">Далі</button></div></div>`;
        box.hidden = false;
        const bar = box.querySelector(".b-bar i");
        requestAnimationFrame(() => { bar.style.transition = `transform ${BRIEF_MS}ms linear`; bar.style.transform = "scaleX(0)"; });
        await new Promise((res) => { const t = setTimeout(res, BRIEF_MS); box.querySelector("#b-go").onclick = () => { clearTimeout(t); res(); }; });
        box.hidden = true;
        return;
      }
      box.innerHTML = `<div class="b-inner"><div class="b-head">ЕТАП ${this.idx + 1} · ЗНАЙТИ ${n > 1 ? n + " ЦІЛІ" : "ЦІЛЬ"}</div>
        <div class="b-task"><div class="b-from">📡 ЗАВДАННЯ</div><p>${esc(task)}</p></div>${cards.join("")}
        ${st.cond === "thermal" ? `<p class="b-cond">🌡 Тепловізор, ніч: тепле — світле. Найяскравіші — двигун і вихлоп; муляжі холодні й темні.</p>` : st.cond === "winter" ? `<p class="b-cond">❄ Зима: техніка — темна пляма на снігу, видно свіжі накати.</p>` : ""}
        <p class="b-warn">⚠ На знімку можуть бути муляжі — клік по обманці рахується як промах.</p>
        <div class="b-foot"><div class="b-bar"><i></i></div><button type="button" class="primary" id="b-go">Почати зараз</button></div></div>`;
      box.hidden = false;
      SFX.radio();
      const bar = box.querySelector(".b-bar i");
      requestAnimationFrame(() => { bar.style.transition = `transform ${BRIEF_MS}ms linear`; bar.style.transform = "scaleX(0)"; });
      await new Promise((res) => { const t = setTimeout(res, BRIEF_MS); box.querySelector("#b-go").onclick = () => { clearTimeout(t); res(); }; });
      box.hidden = true;
    },

    // ---------- вигляд камери дрона
    hudSeed(st) {
      let h = 0; for (const ch of String(st.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const r = (k) => ((h >>> k) & 1023) / 1023;
      this.hudBase = {lat: 46.45 + r(0) * 1.1, lon: 31.4 + r(10) * 3.2, hdg: Math.round(r(5) * 359), gsd: 0.5};
    },
    hud() {
      const v = this.viewer, b = this.hudBase;
      if (!v || !v.img || !b) return;
      const [cx, cy] = v.toImage(v.W / 2, v.H / 2), z = v.zoomRel();
      const dn = (v.img.height / 2 - cy) * b.gsd, de = (cx - v.img.width / 2) * b.gsd;
      const lat = b.lat + dn / 111320, lon = b.lon + de / (111320 * Math.cos(b.lat * Math.PI / 180));
      const dms = (d, p, n) => { const a = Math.abs(d), D = Math.floor(a), M = Math.floor((a - D) * 60), S = ((a - D) * 60 - M) * 60; return `${D}°${String(M).padStart(2, "0")}'${S.toFixed(1).padStart(4, "0")}"${d >= 0 ? p : n}`; };
      $("hud-tl").innerHTML = `ALT ${Math.round(620 / Math.max(1, z))} m<br>HDG ${String(b.hdg).padStart(3, "0")}°<br>SPD 0.0 m/s<br>BAT 78%`;
      $("hud-bl").textContent = `${dms(lat, "N", "S")}  ${dms(lon, "E", "W")}`;
      const sq = v.gridCell && v.inside(cx, cy) ? squareName(cx, cy, v.gridCell) : "—";
      $("hud-br").innerHTML = `ZOOM ×${z.toFixed(1)}<br>SQ ${sq}`;
    },
    hudClock() {
      const s = Math.floor((performance.now() - this.t0) / 1000);
      $("hud-clock").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    },
    left() { return Math.max(0, this.limit - (performance.now() - this.t0) / 1000); },

    tick() {
      if (this.over) return;
      const l = this.left(), warn = l <= 10;
      $("g-time").textContent = fmt(l);
      $("g-time").classList.toggle("warn", warn);
      document.querySelector(".timebar").classList.toggle("warn", warn);
      $("g-timebar").style.transform = `scaleX(${l / this.limit})`;
      const sec = Math.ceil(l);
      if (warn && sec !== this.lastTick && sec > 0) { this.lastTick = sec; SFX.tick(sec <= 3); }
      this.hudClock();
      if (l <= 0) { SFX.timeout(); return this.endRound("Час вийшов!"); }
      this.tickT = setTimeout(() => this.tick(), 200);
    },

    stats() {
      $("g-score").textContent = this.results.reduce((a, r) => a + r.score, 0);
      $("g-miss").textContent = `${this.misses}/${Math.max(1, this.missLimit)}`;
      $("g-found").textContent = `${this.found.size}/${this.targets.length}`;
    },

    msg(text, cls = "") { const m = $("g-msg"); m.textContent = text; m.className = "msg " + cls; },

    leftClick(cx, cy) {
      if (this.over) return;
      const v = this.viewer;
      const [x, y] = v.toImage(cx, cy);
      if (!v.inside(x, y)) return;
      const hit = Logic.hitTest(this.targets, this.found, x, y);
      this.clicks.push([this.cur.id, Math.round(x), Math.round(y), hit !== null]);
      if (hit === null) {
        const dec = this.decoys.find((t) => Math.hypot(x - t.x, y - t.y) <= (t.r || 14));
        this.misses++;
        if (dec) this.clicks[this.clicks.length - 1][4] = 1;
        if (dec) { FX.explode(v, dec.x, dec.y, dec.r || 14, {small: true}); SFX.pop(); setTimeout(() => SFX.decoy(), 450); } else SFX.miss();
        if (dec) { dec.hitByPlayer = true; this.marks.unshift({x: dec.x, y: dec.y, r: (dec.r || 14) * 0.6, scorch: true}); this.marks.push({x: dec.x, y: dec.y, r: dec.r || 14, color: COLORS.decoy, dashed: true, label: "муляж!"}); }
        else this.marks.push({x, y, square: true, color: COLORS.miss});
        v.setMarks(this.marks);
        const leftM = this.missLimit - this.misses;
        if (leftM < 0) return this.endRound(`${dec ? "Це муляж! " : ""}${this.missLimit ? "Ліміт промахів — етап завершено." : "Промах — етап завершено."}`);
        this.msg(`${dec ? "Це муляж — промах!" : "Мимо!"} ${leftM === 0 ? "Ще промах — кінець етапу." : "Можна ще: " + leftM + "."}`, "no");
      } else {
        this.found.add(hit); this.foundOrder.push(hit);
        const t = this.targets[hit];
        FX.explode(v, t.x, t.y, t.r || 14); SFX.boom();
        setTimeout(() => SFX.hit(), 650);
        this.marks.unshift({x: t.x, y: t.y, r: t.r || 14, scorch: true});
        this.marks.push({x: t.x, y: t.y, r: t.r || 14, color: COLORS.hit});
        v.setMarks(this.marks);
        if (this.found.size === this.targets.length) { setTimeout(() => SFX.win(), 1300); return this.endRound("Усі цілі знайдено!"); }
        this.msg(`Є! Лишилось: ${this.targets.length - this.found.size}.`, "ok");
      }
      this.stats();
    },

    rightClick(cx, cy) {
      const v = this.viewer;
      v.zoomAt(1 / 1.6, cx, cy);
    },

    skip() { if (!this.over) this.endRound("Етап пропущено."); },

    /* Підказка: блок 2×2 квадрати, всередині якого ціль (ціль не обов'язково в центрі блоку). */
    hint() {
      if (this.over || this.hintUsed) return;
      const v = this.viewer, c = v.gridCell, img = v.img;
      const i = this.targets.findIndex((_, k) => !this.found.has(k));
      if (i < 0 || !c || !img) return;
      const t = this.targets[i];
      const cols = Math.ceil(img.width / c), rows = Math.ceil(img.height / c);
      const col = Math.floor(t.x / c), row = Math.floor(t.y / c);
      const c0 = Math.max(0, Math.min(cols - 2, col - (Math.random() < 0.5 ? 0 : 1)));
      const r0 = Math.max(0, Math.min(rows - 2, row - (Math.random() < 0.5 ? 0 : 1)));
      const x = c0 * c, y = r0 * c, w = Math.min(2 * c, img.width - x), h = Math.min(2 * c, img.height - y);
      this.hintUsed = true;
      $("g-hint").disabled = true;
      this.marks.push({rect: [x, y, w, h], color: COLORS.accent});
      v.setMarks(this.marks);
      v.toggleGrid(true); this.gridBtn.classList.add("on");
      const rel = Math.min(v.W / w, v.H / h) * 0.85 / v.minS;
      v.zoomTo(Math.max(1, rel), x + w / 2, y + h / 2);
      const names = [squareName(x + 1, y + 1, c), squareName(x + w - 1, y + 1, c), squareName(x + 1, y + h - 1, c), squareName(x + w - 1, y + h - 1, c)];
      this.msg(`Ціль у ${[...new Set(names)].join(", ")} · за етап ${HINT_SCORE} балів.`);
    },

    endRound(reason) {
      if (this.over) return;
      this.over = true;
      clearTimeout(this.tickT);
      this.used = this.limit - this.left();
      this.reason = reason;
      let score = Logic.roundScore(this.targets.length, this.found.size);
      if (this.hintUsed && score) score = HINT_SCORE;
      $("g-hint").hidden = true;
      this.result = {title: this.cur.title, id: this.cur.id, found: this.found.size, total: this.targets.length,
        misses: this.misses, time: Math.round(this.used * 10) / 10, score, clicks: this.clicks.slice(), report: "",
        items: this.targets.map((t, i) => ["search", this.cur.id, t.type || "ціль", Logic.category(t.type), this.found.has(i) ? 1 : 0])};
      this.results.push(this.result);
      this.stats();
      $("g-skip").hidden = true;
      if (!this.mode.debrief) {   // іспит: без розбору й показу цілей до кінця
        this.msg(`${reason} (етап ${this.idx + 1} з ${this.rounds.length})`);
        this.showNext(this.idx === this.rounds.length - 1 ? "Результат" : "Далі");
        return;
      }
      if (this.mode.blind) {   // спершу картка «що це було», потім розбір
        const st = this.cur;
        setTimeout(() => { if (this.cur === st) this.brief(st, true).then(() => { if (this.cur === st) { this.showAllMarks(); this.debrief(); } }); }, this.found.size ? 1200 : 0);
        return;
      }
      // після влучання камера рушає, коли вогняна куля вже згасла — інакше анімації накладаються й кадри «підвисають»
      this.outroT = setTimeout(() => { this.showAllMarks(); setTimeout(() => this.placeNext(), OUTRO_MS + 60); }, this.found.size ? 1500 : OUTRO_DELAY);
      this.debrief();
    },

    /* Після етапу: наблизити так, щоб було видно всі цілі, муляжі й промахи (без зайвих порожніх смуг). */
    showAllMarks() {
      const v = this.viewer, pts = [...this.targets, ...this.decoys].map((t) => [t.x, t.y, (t.r || 14) + 30]);
      this.clicks.forEach((c) => pts.push([c[1], c[2], 40]));
      if (!pts.length || !v.img) return v.fit(true, OUTRO_MS);
      const x0 = Math.min(...pts.map((p) => p[0] - p[2])), x1 = Math.max(...pts.map((p) => p[0] + p[2] + 50)); // +місце під підписи
      const y0 = Math.min(...pts.map((p) => p[1] - p[2])), y1 = Math.max(...pts.map((p) => p[1] + p[2]));
      // цілі — у верхніх ~62% екрана, щоб кнопка «Далі» (нижче центру) їх не перекривала
      const availH = v.H * 0.62;
      const rel = Math.max(v.coverRel(), Math.min(v.coverRel() * 3, Math.min(v.W / (x1 - x0), availH / (y1 - y0)) / v.minS));
      const s = v.minS * rel;
      v._go(s, v.W / 2 - (x0 + x1) / 2 * s, availH / 2 + 8 - (y0 + y1) / 2 * s, true, OUTRO_MS);
    },

    sq(t) { return this.viewer.gridCell ? squareName(t.x, t.y, this.viewer.gridCell) : ""; },

    debrief() {
      const missed = this.targets.map((_, i) => i).filter((i) => !this.found.has(i));
      const marks = [...this.targets.filter((_, i) => this.found.has(i)).map((t) => ({x: t.x, y: t.y, r: t.r || 14, scorch: true})),
        ...this.decoys.filter((t) => t.hitByPlayer).map((t) => ({x: t.x, y: t.y, r: (t.r || 14) * 0.6, scorch: true}))];
      let n = 0;
      this.clicks.forEach((c) => { if (!c[3] && !c[4]) marks.push({x: c[1], y: c[2], square: true, color: COLORS.miss, label: String(++n)}); });
      this.targets.forEach((t, i) => {
        const ok = this.found.has(i);
        marks.push({x: t.x, y: t.y, r: (t.r || 14) + (ok ? 0 : 6), color: ok ? COLORS.hit : COLORS.accent, dashed: !ok, label: t.type || ""});
      });
      this.decoys.forEach((t) => marks.push({x: t.x, y: t.y, r: t.r || 14, color: COLORS.decoy, dashed: true, label: "муляж"}));
      this.viewer.setMarks(marks);

      const h = [];
      this.targets.forEach((t, i) => {
        const ok = this.found.has(i), sq = this.sq(t);
        const where = sq ? "квадрат " + sq : "";
        h.push(`<p class="${ok ? "t-ok" : "t-no"}">${i + 1}. ${esc(t.type || "ціль")} — ${esc(where)} (${ok ? "знайдено" : "не знайдено"})</p>`);
        if (t.signs && t.signs.length) h.push(`<p class="sub">Ознаки: ${esc(t.signs.join(", "))}</p>`);
        if (t.note) h.push(`<p class="sub muted">${esc(t.note)}</p>`);
      });
      this.decoys.forEach((t) => {
        const sq = this.sq(t);
        h.push(`<p class="t-decoy">◇ Муляж: ${esc(t.type || "техніка")}${sq ? " — квадрат " + sq : ""}${t.hitByPlayer ? " (ви на нього клікнули)" : " (не повелись ✓)"}</p>`);
      });
      n = 0;
      this.clicks.forEach((c) => {
        if (c[3] || c[4]) return;
        n++;
        const near = this.targets.reduce((a, t) => (Math.hypot(t.x - c[1], t.y - c[2]) < Math.hypot(a.x - c[1], a.y - c[2]) ? t : a));
        const d = Math.round(Math.hypot(near.x - c[1], near.y - c[2]));
        const sq = this.viewer.gridCell ? squareName(c[1], c[2], this.viewer.gridCell) : "";
        h.push(`<p class="t-no">✗ Промах ${n}: квадрат ${sq}, ${d} пкс від цілі «${esc(near.type || "ціль")}»</p>`);
      });
      // коротко одним рядком; подробиці — по тапу
      const line = [
        ...this.targets.map((t, i) => `<b class="${this.found.has(i) ? "t-ok" : "t-no"}">${this.found.has(i) ? "✓" : "✗"} ${esc(t.type || "ціль")} ${esc(this.sq(t))}</b>`),
        n ? `<b class="t-no">промахів ${n}</b>` : "",
        this.decoys.some((t) => t.hitByPlayer) ? `<b class="t-decoy">муляж!</b>` : "",
        `${this.result.time} с · +${this.result.score}${this.hintUsed ? " 💡" : ""}`,
      ].filter(Boolean).join(" · ");
      $("g-debrief").innerHTML = `<details><summary>${line}</summary>${h.join("")}</details>`;
      $("g-debrief").hidden = false;
      const last = this.idx === this.rounds.length - 1;
      this.msg(`${this.reason} +${this.result.score} балів.`, missed.length ? "no" : "ok");
      this.showNext(last ? "Підсумок" : "Далі");
    },

    // ---------- підсумок
    summary() {
      show("s-summary");
      this.lastGame = "search";
      const res = this.results;
      const max = 10 * res.length, total = res.reduce((a, r) => a + r.score, 0);
      const pct = max ? Math.round(100 * total / max) : 0, m = this.mode || Logic.MODES.game;
      const concl = m.pass ? (pct >= m.pass ? "Склав" : "Не склав") : Logic.conclusion(total, max);
      $("sum-title").textContent = `${m.id === "game" ? "Підсумок" : m.name} · ${this.callsign}`;
      $("sum-total").textContent = `${total} з ${max} балів · ${pct}% · ${concl}`;
      const rk = Logic.rank(pct);
      $("sum-rank").innerHTML = `${Logic.rankBadge(rk.level)}<div><div class="rk-label">Звання</div><div class="rk-name">${esc(rk.name)}</div><div class="rk-next">${rk.next ? `До «${esc(rk.next.name)}» — від ${rk.next.min}%` : "Найвище звання"}</div></div>`;
      $("sum-total").style.color = m.pass ? (pct >= m.pass ? "var(--hit)" : "var(--miss)") : pct >= 60 ? "var(--hit)" : pct >= 40 ? "var(--accent)" : "var(--miss)";
      $("sum-table").innerHTML = `<tr><th class="num">Етап</th><th>Знімок</th><th class="num">Цілі</th><th class="num">Промахи</th><th class="num">Час, с</th><th class="num">Бали</th></tr>` +
        res.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.title)}</td><td class="num">${r.found}/${r.total}</td><td class="num">${r.misses}</td><td class="num">${r.time}</td><td class="num">${r.score}</td></tr>`).join("");
      const now = new Date();
      const p2 = (x) => String(x).padStart(2, "0");
      const item = {callsign: this.callsign, scores: res.map((r) => r.score), max, mode: m.id,
        conclusion: m.id === "game" ? concl : `${m.name}: ${concl}${m.pass ? ` (поріг ${m.pass}%)` : ""}`,
        date: `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`,
        clicks: res.flatMap((r) => r.clicks), items: res.flatMap((r) => r.items || [])};
      const q = LS.get("poshuk_pending", []);
      q.push(item);
      LS.set("poshuk_pending", q);
      $("sum-sync").className = "muted";
      $("sum-sync").textContent = "Записую результат…";
      this.flushPending().then((left) => {
        $("sum-sync").textContent = left ? "Немає зв'язку: результат збережено в браузері й надішлеться при наступному вході."
          : "Результат записано.";
        $("sum-sync").style.color = left ? "var(--miss)" : "var(--hit)";
      });
    },

    async flushPending() {
      const q = LS.get("poshuk_pending", []);
      if (!q.length || !this.password || this._flushing) return q.length;
      this._flushing = true;
      try {
        while (q.length) {
          await API.call("submit", q[0], this.password);
          q.shift();
          LS.set("poshuk_pending", q);
        }
      } catch (e) { /* лишаємо в черзі */ } finally { this._flushing = false; this.refreshPending(); }
      return q.length;
    },

    refreshPending() {
      const k = LS.get("poshuk_pending", []).length;
      $("pending-info").textContent = k ? `Не надіслано результатів: ${k}. Надішлються автоматично.` : "";
    },
  };

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c])); }

  window.Game = Game;
  function today() { const n = new Date(), p2 = (x) => String(x).padStart(2, "0"); return `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}`; }
  window.UI = {show, toast, esc};
})();
