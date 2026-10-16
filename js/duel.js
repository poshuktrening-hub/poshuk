/* «Дуель» — морський бій на знімку для двох гравців на різних пристроях.
   1) Кімната: один створює (4-значний код), другий приєднується.
   2) Розстановка: кожен ховає свою техніку (5 одиниць) на своїй копії тієї самої карти —
      техніка вбудовується реалістично (Compose), крони природно ховають її. Готовий знімок іде на сервер,
      координати бачить лише сервер.
   3) Бій по черзі: 30 с на хід, один удар. Влучив — ходиш ще; мимо — хід суперникові.
   4) Перемога — хто першим знищить усю справжню техніку суперника. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.esc(s);
  const KIT_REAL = 5, KIT_DECOY = 0, TURN_S = 15, PLACE_S = 30, POLL_MS = 1000;
  const C = {hit: "#3ddc97", miss: "#ff5a4f", decoy: "#b48cff", accent: "#ffb23e", mine: "#7fb2ff"};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => rej(new Error("Не вдалось відкрити модель")); i.src = src; });

  const Duel = {
    open() {
      const cs = Game.callsignOk(); if (!cs) return;
      this.cs = cs; this.pw = Game.password;
      this.reset();
      UI.show("s-duel");
      document.body.dataset.mode = "duel";
      if (!this.viewer) {
        this.viewer = new Viewer($("d-view"), {fill: true, onLeft: (x, y) => this.click(x, y)});
        $("d-tools").appendChild(this.viewer.rail);
        this.viewer.grab = (ph, x, y, e) => this.grab(ph, x, y, e);
        $("d-quit").onclick = () => this.quit();
        $("d-ready").onclick = () => this.ready();
        $("d-tabs").querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => this.showMap(b.dataset.v)));
        document.addEventListener("keydown", (e) => this.key(e));
      }
      this.lobby();
    },

    reset() {
      clearTimeout(this.pollT); clearInterval(this.tickT); clearTimeout(this.switchT);
      $("d-turnbar").hidden = true;
      Object.assign(this, {autoDone: false, lastTurn: "", code: "", secret: "", me: 0, st: null, units: [], sel: -1, base: null, work: null, oppImg: null, seenShots: 0, mapView: "", placing: false, sprites: this.sprites || new Map()});
      $("d-tabs").hidden = true; $("d-ready").hidden = true; $("d-msg").textContent = "";
      $("d-title").textContent = "⚔ Дуель"; ["d-turn", "d-time", "d-me", "d-opp"].forEach((id) => ($(id).textContent = "—"));
      $("d-timebar").style.transform = "scaleX(0)";
      if (this.viewer) { this.viewer.setMarks([]); }
    },

    msg(t, cls = "") { const m = $("d-msg"); m.textContent = t; m.className = "msg " + cls; },
    loading(t) { $("d-loading").hidden = !t; if (t) $("d-loading-t").textContent = t; },
    panel(html, cls = "") { const p = $("d-panel"); p.hidden = !html; p.innerHTML = html || ""; p.className = "d-panel" + (cls ? " " + cls : ""); return p; },

    // ---------------------------------------------------------------- кімната
    lobby() {
      const p = this.panel(`<div class="d-card">
        <h2>⚔ Дуель на двох</h2>
        <img class="d-help-img" src="media/help-duel.svg?v=2" alt="Схема дуелі: розстановка техніки й удари по черзі">
        <ol class="d-rules">
          <li>Кожен за <b>${PLACE_S} с</b> ховає на тій самій карті <b>${KIT_REAL} одиниць техніки</b> — суперник розстановки не бачить.</li>
          <li>Б'єте по черзі по карті суперника: <b>${TURN_S} с на хід</b>, один удар.</li>
          <li>Влучили — ходите ще; мимо — хід суперникові.</li>
          <li>Виграє, хто першим знищить усю техніку суперника.</li>
        </ol>
        <button type="button" class="link" id="d-rules">📖 Детальні правила</button>
        <button type="button" class="primary" id="d-create">Створити кімнату</button>
        <div class="d-or">або</div>
        <div class="row"><input id="d-code" inputmode="numeric" maxlength="4" placeholder="Код кімнати" autocomplete="off"><button type="button" id="d-join">Приєднатись</button></div>
        <p class="status" id="d-err"></p></div>`);
      p.querySelector("#d-rules").onclick = () => Help.show("duel");
      p.querySelector("#d-create").onclick = () => this.create();
      p.querySelector("#d-join").onclick = () => this.join();
      p.querySelector("#d-code").onkeydown = (e) => { if (e.key === "Enter") this.join(); };
    },
    err(t) { const e = $("d-err"); if (e) { e.textContent = t; e.className = "status no"; } else this.msg(t, "no"); },

    /* Набір техніки (однаковий для обох): 5 різних моделей з бібліотеки (бракує — вбудовані, ще бракує — повтори). */
    kit() {
      const lib = (Game.objects || []).filter((o) => !o.decoy && o.name);
      const pool = lib.length >= KIT_REAL ? lib : [...lib, ...Models.LIST.filter((m) => !m.decoy && !/catapult/.test(m.id))];
      let src = Logic.shuffle(pool.slice());
      while (src.length < KIT_REAL) src = src.concat(Logic.shuffle(pool.slice()));
      const pick = src.slice(0, KIT_REAL).map((o) => ({obj: o.id, name: Logic.dispName(o.name.replace(/\s*\(вбудована\)$/, "")), length_m: o.length_m || 7, decoy: false}));
      for (let i = 0; i < KIT_DECOY; i++) { const k = pick[i % pick.length]; pick.push(Object.assign({}, k, {decoy: true, name: "Муляж " + k.name})); }
      return pick;
    },

    async create() {
      try {
        SFX.unlock();
        const j = await API.call("duel_create", {callsign: this.cs, kit: this.kit()}, this.pw);
        this.joined(j);
      } catch (e) { this.err(e.message); }
    },
    async join() {
      const code = ($("d-code").value || "").replace(/\D/g, "");
      if (code.length !== 4) return this.err("Введіть 4 цифри коду");
      try { SFX.unlock(); this.joined(await API.call("duel_join", {code, callsign: this.cs}, this.pw)); } catch (e) { this.err(e.message); }
    },
    joined(j) {
      this.code = j.code; this.secret = j.secret; this.me = j.me;
      $("d-title").textContent = `⚔ Дуель · кімната ${j.code}`;
      this.apply(j);
      this.poll();
    },

    async poll() {
      clearTimeout(this.pollT);
      if (!this.code) return;
      try { this.apply(await API.call("duel_state", {code: this.code, secret: this.secret}, this.pw)); }
      catch (e) { this.msg(e.message, "no"); }
      if (this.code && (!this.st || this.st.state !== "done")) this.pollT = setTimeout(() => this.poll(), POLL_MS);
    },

    /* Новий стан із сервера → екран. */
    apply(j) {
      const prev = this.st; this.st = j;
      const names = j.names, opp = names[2 - j.me] || "суперник";
      if (j.state === "lobby") {
        this.panel(`<div class="d-card"><h2>Кімната <span class="d-code">${esc(j.code)}</span></h2><p>Скажіть цей код суперникові — хай натисне «Дуель» → «Приєднатись».</p><p class="muted">Чекаю суперника…</p></div>`);
        return;
      }
      $("d-me").textContent = j.alive.me != null ? j.alive.me : "—";
      $("d-opp").textContent = j.alive.opp != null ? j.alive.opp : "?";
      if (j.state === "place") {
        if (this.helpFor !== j.code) { this.helpFor = j.code; Help.show("duel"); }   // правила — щоразу після зʼєднання
        if (!this.base && !this.placing) this.startPlacing(j);
        $("d-turn").textContent = "розстановка";
        this.placeBanner(j);
        this.deadline = j.left != null && j.loaded && j.loaded[0] && j.loaded[1] ? performance.now() + j.left : null;
        return;
      }
      if (j.state === "battle" || j.state === "done") {
        if (!prev || prev.state === "place" || !this.oppImg) this.startBattle(j);
        this.battle(j, prev);
      }
    },

    // ---------------------------------------------------------------- розстановка
    async startPlacing(j) {
      this.placing = true;
      this.panel("");
      this.loading("Завантажую карту…");
      try {
        const full = await Tiles.toCanvas(await API.loadImage(j.map.id, this.pw));
        // поле бою — та сама для обох чверть карти (½ ширини × ½ висоти), але не менше ~700×500 пкс
        const cr = j.map.crop || {k: 1, fx: 0, fy: 0};
        const cw = Math.min(full.width, Math.max(Math.round(full.width * cr.k), 700)), ch = Math.min(full.height, Math.max(Math.round(full.height * cr.k), 500));
        const sx = Math.round(cr.fx * (full.width - cw)), sy = Math.round(cr.fy * (full.height - ch));
        const src = Compose.canvas(cw, ch); src.getContext("2d").drawImage(full, sx, sy, cw, ch, 0, 0, cw, ch);
        this.base = Compose.canvas(src.width, src.height); this.base.getContext("2d").drawImage(src, 0, 0);
        this.work = Compose.canvas(src.width, src.height); this.work.getContext("2d").drawImage(src, 0, 0);
        try { this.sun = Compose.shadowDir(this.base); } catch (e) { this.sun = 135; }
        this.gsd = j.map.gsd || 0.25;
        this.units = j.kit.map((k) => ({k, x: null, y: null, angle: Math.floor(Math.random() * 360), size: Math.max(6, Math.min(120, (k.length_m || 7) / this.gsd)), rect: null}));
        this.sel = 0;
        this.viewer.setImage(this.work);
        this.mapView = "mine";
        this.renderKit();
        this.msg("Торкніться знімка — поставити вибрану техніку. Тягніть — перемістити; ⟳ — повернути.");
        API.call("duel_loaded", {code: this.code, secret: this.secret}, this.pw).then((r) => this.apply(r)).catch(() => {});   // таймер стартує, коли карта відкрилась в обох
        clearInterval(this.tickT); this.tickT = setInterval(() => this.tick(), 250);
      } catch (e) { this.msg("Не вдалось завантажити карту: " + e.message, "no"); }
      this.loading(null);
    },

    renderKit() {
      const all = this.units.every((u) => u.x !== null);
      if (!this.st || this.st.state !== "place") return;
      const p = this.panel(`<div class="d-kit"><b>Сховайте техніку</b>${this.units.map((u, i) => `<button type="button" data-u="${i}" class="${i === this.sel ? "on" : ""}${u.x !== null ? " done" : ""}">${u.k.decoy ? "◇" : "■"} ${esc(u.k.name)}${u.x !== null ? " ✓" : ""}</button>`).join("")}
        <div class="d-rot"><button type="button" data-rot="-45">⟲ Повернути</button><button type="button" data-rot="45">⟳ Повернути</button></div>
        <p class="muted small">Під кронами й біля посадок техніку видно гірше. Не ставте все в одному місці.</p></div>`, "side");
      p.querySelectorAll("[data-rot]").forEach((b) => (b.onclick = () => { const u = this.units[this.sel]; if (!u || u.x === null || this.st.ready[this.me - 1]) return; u.angle = (u.angle + Number(b.dataset.rot) + 360) % 360; this.redraw(); }));
      p.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => { this.sel = Number(b.dataset.u); this.renderKit(); this.marksPlace(); }));
      $("d-ready").hidden = false; $("d-ready").disabled = !all || !!(this.st && this.st.ready[this.me - 1]);
      this.marksPlace();
    },
    marksPlace() {
      this.viewer.setMarks(this.units.filter((u) => u.x !== null).map((u) => ({x: u.x, y: u.y, r: Math.max(8, u.size * 0.6), color: this.units[this.sel] === u ? C.accent : C.mine, dashed: !!u.k.decoy, label: u.k.decoy ? "муляж" : ""})));
    },

    async sprite(k) {
      const key = k.obj + (k.decoy ? ":d" : "");
      if (this.sprites.has(key)) return this.sprites.get(key);
      let spr;
      if (Models.isBuiltin(k.obj)) spr = Models.sprite(k.obj.replace(/:decoy$/, ""));
      else spr = Compose.prepareObject(await loadImg(await API.objUrl(k.obj, this.pw)));
      if (k.decoy) spr = Models.inflate(spr);
      this.sprites.set(key, spr);
      return spr;
    },

    /* Перемалювати всю техніку: повернути чисту карту в старих місцях і вбудувати наново. */
    async redraw() {
      if (this.drawing) { this.redrawAgain = true; return; }
      this.drawing = true;
      const ctx = this.work.getContext("2d");
      for (const u of this.units) if (u.rect) { const r = u.rect; ctx.clearRect(r.x, r.y, r.w, r.h); ctx.drawImage(this.base, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h); u.rect = null; }
      for (const u of this.units) {
        if (u.x === null) continue;
        const spr = await this.sprite(u.k);
        // крони ховають природно: де густа зелень — частина корпусу під нею
        u.rect = Compose.compose(this.base, this.work, spr, u.x, u.y, {size: u.size, angle: u.angle, hide: 0.5, shade: 0.25, shadow_dir: this.sun, shadow_len: Math.min(40, 2.2 / this.gsd), seed: 7});
      }
      this.viewer.replaceImage(this.work);
      this.marksPlace();
      this.drawing = false;
      if (this.redrawAgain) { this.redrawAgain = false; this.redraw(); }
    },

    placeAt(x, y) {
      if (this.st.ready[this.me - 1]) return;
      const u = this.units[this.sel]; if (!u) return;
      if (this.tooClose(u, x, y)) { this.msg("Занадто близько до іншої вашої техніки — поставте трохи далі.", "no"); return; }
      this.msg("");
      u.x = Math.round(x); u.y = Math.round(y);
      const next = this.units.findIndex((v) => v.x === null);
      if (next >= 0) this.sel = next;
      SFX.click();
      this.renderKit(); this.redraw();
    },

    /* Техніка не може стояти впритул (одним ударом — дві цілі). */
    tooClose(u, x, y) { return this.units.some((v) => v !== u && v.x !== null && Math.hypot(v.x - x, v.y - y) < (u.size + v.size) * 0.45); },

    grab(ph, x, y, e) {
      if (!this.st || this.st.state !== "place" || this.st.ready[this.me - 1]) return false;
      if (ph === "hit") {
        const i = this.units.findIndex((u) => u.x !== null && Math.hypot(x - u.x, y - u.y) < Math.max(6, u.size * 0.6));
        if (i < 0) return false;
        this.sel = i; this.renderKit(); return true;
      }
      const u = this.units[this.sel]; if (!u) return;
      if (ph === "start") { this.gd = {dx: u.x - x, dy: u.y - y, rot: e && e.shiftKey}; return; }
      if (!this.gd) return;
      if (this.gd.rot) u.angle = Math.round((Math.atan2(x - u.x, -(y - u.y)) * 180 / Math.PI + 360) % 360);
      else if (this.viewer.inside(x + this.gd.dx, y + this.gd.dy) && !this.tooClose(u, x + this.gd.dx, y + this.gd.dy)) { u.x = Math.round(x + this.gd.dx); u.y = Math.round(y + this.gd.dy); }
      if (ph === "end" || ph === "cancel") this.gd = null;
      this.redraw();
    },

    key(e) {
      if ($("s-duel").hidden || !this.st || this.st.state !== "place" || /INPUT|TEXTAREA/.test((e.target && e.target.tagName) || "")) return;
      const u = this.units[this.sel]; if (!u || u.x === null) return;
      const k = e.key.toLowerCase(), step = e.shiftKey ? 5 : 15;
      if (k === "q" || k === "й") u.angle = (u.angle - step + 360) % 360;
      else if (k === "e" || k === "у") u.angle = (u.angle + step) % 360;
      else if (k === "r" || k === "к") u.angle = Math.floor(Math.random() * 360);
      else return;
      e.preventDefault(); this.redraw();
    },

    async ready() {
      if (!this.units.every((u) => u.x !== null)) return;
      $("d-ready").disabled = true;
      this.loading("Відправляю вашу карту…");
      try {
        while (this.drawing) await sleep(50);
        const pack = await Tiles.build(this.work);
        const b = await API.call("duel_place_begin", {code: this.code, secret: this.secret, size: pack.bytes.byteLength,
          units: this.units.map((u) => ({x: u.x, y: u.y, r: Math.max(8, Math.round(u.size * 0.6)), type: Logic.typeOf(u.k.name.replace(/^муляж\s+/i, ""))}))}, this.pw);
        for (let i = 0; i < b.chunks; i++) {
          this.loading(`Відправляю вашу карту… ${i + 1}/${b.chunks}`);
          const part = pack.bytes.subarray(i * b.chunk, Math.min(pack.bytes.byteLength, (i + 1) * b.chunk));
          let ok = false, err = null;
          for (let k = 0; k < 3 && !ok; k++) {
            try { const r = await fetch(`${API.url}/blob/${b.id}/${i}`, {method: "PUT", headers: {"X-Token": b.token, "X-Duel": this.secret}, body: part}); const j = await r.json(); ok = j.ok; err = j.error; }
            catch (e) { err = "Немає зв'язку"; }
          }
          if (!ok) throw new Error(err || "Не вдалось відправити");
        }
        this.apply(await API.call("duel_place_end", {code: this.code, secret: this.secret}, this.pw));
        this.renderKit();
      } catch (e) { this.msg(e.message, "no"); $("d-ready").disabled = false; }
      this.loading(null);
    },

    // ---------------------------------------------------------------- бій
    async startBattle(j) {
      if (this.loadingOpp) return;
      this.loadingOpp = true;
      this.panel(""); $("d-ready").hidden = true; $("d-tabs").hidden = false;
      if (!this.work) { this.loading("Завантажую карту…"); try { const src = await Tiles.toCanvas(await API.loadImage(j.map.id, this.pw)); this.work = src; } catch (e) { /* без своєї карти */ } }
      this.loading("Завантажую знімок суперника…");
      try {
        const tok = await API.token(this.pw);
        const res = await fetch(`${API.url}/duel/${this.code}/${3 - this.me}?t=${encodeURIComponent(tok || "")}&s=${encodeURIComponent(this.secret)}`);
        if (!res.ok) throw new Error("знімок суперника ще не готовий");
        this.oppImg = await Tiles.open(await res.arrayBuffer());
      } catch (e) { this.msg("Не вдалось завантажити знімок суперника: " + e.message, "no"); this.oppImg = null; }
      this.loading(null);
      this.loadingOpp = false;
      this.mapView = "";
      this.battle(this.st, null);
      clearInterval(this.tickT);
      this.tickT = setInterval(() => this.tick(), 250);
    },

    showMap(v) {
      if (v === this.mapView) return;
      this.mapView = v;
      $("d-tabs").querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
      const img = v === "opp" ? this.oppImg : this.work;
      if (img) { this.viewer.setImage(img); if (window.FX && FX.prepare) FX.prepare(this.viewer); }
      this.marksBattle();
    },

    marksBattle() {
      const j = this.st; if (!j) return;
      const marks = [];
      if (this.mapView === "opp") {
        for (const s of j.shots.filter((x) => x.by === j.me && x.res !== "timeout")) {
          const u = s.i >= 0 && j.reveal.find((r) => r.i === s.i);
          if (s.res === "hit" && u) { marks.unshift({x: u.x, y: u.y, r: u.r, scorch: true}); marks.push({x: u.x, y: u.y, r: u.r, color: C.hit, label: u.type}); }
          else if (s.res === "decoy" && u) marks.push({x: u.x, y: u.y, r: u.r, color: C.decoy, dashed: true, label: "муляж"});
          else marks.push({x: s.x, y: s.y, square: true, color: C.miss});
        }
        if (j.state === "done") for (const u of j.reveal) if (!u.dead && !j.shots.some((s) => s.by === j.me && s.i === u.i)) marks.push({x: u.x, y: u.y, r: u.r, color: u.decoy ? C.decoy : C.accent, dashed: true, label: (u.decoy ? "муляж: " : "") + u.type});
      } else {
        for (const u of j.mine) marks.push({x: u.x, y: u.y, r: u.r, color: u.dead ? C.miss : C.mine, dashed: !!u.decoy, label: u.dead ? "знищено" : u.decoy ? "муляж" : ""});
        for (const s of j.shots.filter((x) => x.by !== j.me && x.res !== "timeout")) {
          if (s.res === "hit") { const u = j.mine[s.i]; if (u) marks.unshift({x: u.x, y: u.y, r: u.r, scorch: true}); }
          else marks.push({x: s.x, y: s.y, square: true, color: s.res === "decoy" ? C.decoy : "#9aa4ad"});
        }
      }
      this.viewer.setMarks(marks);
    },

    battle(j, prev) {
      if (!this.oppImg && j.state !== "done") return;
      const myTurn = j.state === "battle" && j.turn === j.me, opp = j.names[2 - j.me] || "суперник";
      // нові удари — ефекти
      const fresh = j.shots.slice(this.seenShots);
      this.seenShots = j.shots.length;
      // хто ходить — та карта на екрані
      // мій хід → карта суперника; хід суперника → моя карта (з його ударами). Перемикається щоразу, як змінюється хід.
      const want = j.state === "done" ? "opp" : myTurn ? "opp" : "mine";
      const turnKey = j.state + ":" + j.turn;
      const turnChanged = turnKey !== this.lastTurn;
      // спершу показати результат удару на тій карті, куди били, і лише потім перемкнути
      for (const s of fresh) {
        const mineShot = s.by === j.me;
        if (s.res === "timeout") { if (mineShot) this.float(null, null, "ЧАС ВИЙШОВ", "miss"); continue; }
        const onScreen = mineShot === (this.mapView === "opp");
        const u = mineShot ? j.reveal.find((r) => r.i === s.i) : j.mine[s.i];
        if (s.res === "hit" && u) {
          if (onScreen) FX.explode(this.viewer, u.x, u.y, u.r);
          SFX.boom(); this.float(onScreen ? u.x : null, onScreen ? u.y : null, mineShot ? "ВЛУЧАННЯ!" : "ВАШУ ТЕХНІКУ ЗНИЩЕНО", mineShot ? "hit" : "lost");
        } else if (s.res === "miss") {
          SFX.fart(); this.float(onScreen ? s.x : null, onScreen ? s.y : null, mineShot ? "ПРОМАХ" : "СУПЕРНИК ПРОМАХНУВСЯ", mineShot ? "miss" : "ok");
        }
      }
      if (turnChanged || !this.mapView) {
        const mineStarts = myTurn && this.lastTurn && turnChanged;
        const wasShown = !!this.mapView && this.lastTurn;
        this.lastTurn = turnKey;
        clearTimeout(this.switchT);
        const go = () => { this.showMap(want); if (mineStarts) { SFX.radio(); try { navigator.vibrate && navigator.vibrate(180); } catch (e) { /* ок */ } } };
        if (wasShown && fresh.length) this.switchT = setTimeout(go, 1800); else go();
      }
      this.turnBanner(j);
      this.marksBattle();
      $("d-turn").textContent = j.state === "done" ? "кінець" : myTurn ? "ВАШ" : "суперника";
      $("d-turn").parentElement.classList.toggle("d-my", myTurn); $("d-turn").parentElement.classList.toggle("d-their", j.state === "battle" && !myTurn);
      if (j.state === "done") return this.finish(j);
      const last = j.shots[j.shots.length - 1];
      const lastTxt = last && last.by !== j.me ? (last.res === "hit" ? `${opp} влучив у вашу техніку! ` : last.res === "decoy" ? `${opp} купився на ваш муляж. ` : last.res === "timeout" ? `${opp} не встиг. ` : `${opp} промахнувся. `)
        : last && last.by === j.me ? (last.res === "hit" ? "Влучання! Ходіть ще. " : last.res === "decoy" ? "Це був муляж — хід переходить. " : last.res === "timeout" ? "Час вийшов — хід переходить. " : "Мимо — хід переходить. ") : "";
      this.msg(lastTxt.trim(), last && last.by !== j.me && last.res === "hit" ? "no" : "");
      this.deadline = performance.now() + j.left;
    },

    /* Напис над місцем удару (або по центру, якщо місце не на екрані), що спливає й зникає. */
    float(x, y, text, cls) {
      const host = $("d-view").parentElement, el = document.createElement("div"), v = this.viewer;
      el.className = "d-float " + cls; el.textContent = text;
      if (x != null) { el.style.left = (v.tx + x * v.s) + "px"; el.style.top = (v.ty + y * v.s) + "px"; }
      else { el.style.left = "50%"; el.style.top = "45%"; }
      host.appendChild(el);
      setTimeout(() => el.remove(), 1900);
    },

    /* Великий напис угорі: чий зараз хід (мій — яскраво, суперника — приглушено) + таймер. */
    turnBanner(j) {
      const b = $("d-turnbar"), opp = j.names[2 - j.me] || "суперник";
      if (j.state !== "battle") { b.hidden = true; return; }
      const my = j.turn === j.me;
      b.hidden = false;
      b.className = "d-turnbar " + (my ? "my" : "their");
      b.innerHTML = my ? `🎯 <b>ВАШ ХІД</b> — бийте по карті суперника <span id="d-tb-t"></span>` : `⏳ <b>ХІД СУПЕРНИКА</b> «${esc(opp)}» — він б'є по вашій карті <span id="d-tb-t"></span>`;
      $("d-tabs").querySelectorAll("[data-v]").forEach((x) => x.classList.toggle("turn", (x.dataset.v === "opp") === my));
    },

    /* Розстановка: жовтий напис з таймером; поки суперник відкриває карту — таймер ще не йде. */
    placeBanner(j) {
      const b = $("d-turnbar"), opp = j.names[2 - j.me] || "суперник", mineReady = j.ready[j.me - 1];
      b.hidden = false; b.className = "d-turnbar place";
      b.innerHTML = mineReady ? `✓ <b>ГОТОВО</b> — чекаю, поки ${esc(opp)} сховає техніку <span id="d-tb-t"></span>`
        : !(j.loaded && j.loaded[0] && j.loaded[1]) ? `⏳ Чекаю, поки ${esc(opp)} відкриє карту…`
        : `🧩 <b>РОЗСТАНОВКА</b> — сховайте ${KIT_REAL} одиниць <span id="d-tb-t"></span>`;
    },

    /* Час розстановки вийшов: недоставлене — у випадкові вільні місця, і одразу «Готово». */
    async autoPlace() {
      if (this.autoDone || !this.base) return;
      this.autoDone = true;
      const W = this.base.width, H = this.base.height;
      for (const u of this.units) {
        if (u.x !== null) continue;
        for (let k = 0; k < 300; k++) {
          const x = u.size + Math.random() * (W - 2 * u.size), y = u.size + Math.random() * (H - 2 * u.size);
          if (!this.tooClose(u, x, y)) { u.x = Math.round(x); u.y = Math.round(y); break; }
        }
        if (u.x === null) { u.x = Math.round(W / 2); u.y = Math.round(H / 2); }
      }
      this.msg("Час вийшов — решту техніки поставлено випадково.", "no");
      await this.redraw();
      this.ready();
    },

    tick() {
      const j = this.st; if (!j) return;
      if (j.state === "place") {
        if (this.deadline == null) { $("d-time").textContent = "0:" + PLACE_S; return; }
        const left = Math.max(0, this.deadline - performance.now()), sec = Math.ceil(left / 1000), t = `0:${String(Math.min(59, sec)).padStart(2, "0")}`;
        $("d-time").textContent = t; const tb = $("d-tb-t"); if (tb && !j.ready[j.me - 1]) tb.textContent = t;
        $("d-timebar").style.transform = `scaleX(${Math.min(1, left / (PLACE_S * 1000))})`;
        if (!j.ready[j.me - 1] && sec <= 5 && sec > 0 && sec !== this.lastSec) { this.lastSec = sec; SFX.tick(sec <= 3); }
        if (left <= 0 && !j.ready[j.me - 1] && !this.autoDone) this.autoPlace();
        return;
      }
      if (j.state !== "battle") return;
      const left = Math.max(0, (this.deadline || 0) - performance.now()), sec = Math.ceil(left / 1000);
      $("d-time").textContent = `0:${String(Math.min(59, sec)).padStart(2, "0")}`;
      const tb = $("d-tb-t"); if (tb) tb.textContent = `0:${String(Math.min(59, sec)).padStart(2, "0")}`;
      $("d-timebar").style.transform = `scaleX(${Math.min(1, left / (TURN_S * 1000))})`;
      if (j.turn === j.me && sec <= 5 && sec > 0 && sec !== this.lastSec) { this.lastSec = sec; SFX.tick(sec <= 3); }
    },

    async click(cx, cy) {
      const j = this.st; if (!j) return;
      const [x, y] = this.viewer.toImage(cx, cy);
      if (!this.viewer.inside(x, y)) return;
      if (j.state === "place") return this.placeAt(x, y);
      if (j.state !== "battle" || j.turn !== j.me || this.mapView !== "opp" || this.shooting) return;
      this.shooting = true;
      try {
        const r = await API.call("duel_shot", {code: this.code, secret: this.secret, x, y}, this.pw);
        this.apply(r);
      } catch (e) { this.msg(e.message, "no"); }
      this.shooting = false;
    },

    finish(j) {
      $("d-turnbar").hidden = true;
      clearInterval(this.tickT); clearTimeout(this.pollT);
      const win = j.winner === j.me, opp = j.names[2 - j.me] || "суперник";
      const why = j.reason === "noplace" ? (win ? `${opp} не встиг сховати техніку.` : "Ви не встигли відправити розстановку.") : j.reason === "left" ? (win ? `${opp} вийшов з бою.` : "Ви вийшли з бою.") : win ? "Уся техніка суперника знищена." : "Уся ваша техніка знищена.";
      if (win) SFX.win(); else SFX.timeout();
      const mine = j.shots.filter((s) => s.by === j.me && s.res !== "timeout"), hits = mine.filter((s) => s.res === "hit").length;
      this.panel(`<div class="d-card result ${win ? "win" : "lose"}"><h2>${win ? "🏆 Перемога" : "Поразка"}</h2><p>${esc(why)}</p>
        <p class="muted">Ваші удари: ${mine.length}, влучань: ${hits}${mine.length ? ` (${Math.round(hits / mine.length * 100)}%)` : ""}. На карті суперника показано, де стояла його техніка.</p>
        <div class="row"><button type="button" class="primary" id="d-again">Нова дуель</button><button type="button" id="d-menu">В меню</button></div></div>`, "side");
      $("d-ready").hidden = true;
      $("d-again").onclick = () => { this.reset(); this.lobby(); };
      $("d-menu").onclick = () => this.quit(true);
      $("d-time").textContent = "—"; $("d-timebar").style.transform = "scaleX(0)";
    },

    async quit(force) {
      const active = this.st && this.st.state !== "done" && this.code;
      if (active && !force && !confirm("Вийти з дуелі? Суперникові зарахують перемогу.")) return;
      if (active) API.call("duel_leave", {code: this.code, secret: this.secret}, this.pw).catch(() => {});
      this.reset();
      Game.showStart();
    },
  };

  window.Duel = Duel;
})();
