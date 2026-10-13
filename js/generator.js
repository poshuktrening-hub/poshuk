/* Генератор етапів (адмінка): вбудувати техніку в знімок і зберегти як новий етап. */
(function () {
  const {LS} = API;
  const esc = (s) => UI.esc(s);
  const C = {hit: "#3ddc97", accent: "#ffb23e"};
  const BUILTIN = Models.LIST[0];

  // назва, ключ, мін, макс, крок, типове значення
  const SLIDERS = [
    ["Розмір на знімку, пкс", "size", 3, 120, 0.5, 16],
    ["Куди дивиться (компас), °", "angle", 0, 359, 1, 0],
    ["Сховано під кронами, %", "hide", 0, 95, 5, 0],
    ["Тінь: куди падає, °", "shadow_dir", 0, 359, 5, 135],
    ["Тінь: довжина, пкс", "shadow_len", 0, 8, 0.5, 2],
    ["Тінь: щільність, %", "shadow_op", 0, 90, 5, 55],
    ["Злиття з фоном, %", "blend", 0, 50, 1, 4],
    ["Затемнення, %", "darken", 0, 50, 1, 0],
    ["Насиченість кольору, %", "sat", 0, 150, 5, 95],
    ["Різкість техніки, %", "sharp", 0, 150, 10, 70],
  ];

  function fileToDataURL(blob) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error("Не вдалось прочитати файл")); fr.readAsDataURL(blob); });
  }
  function loadImg(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Це не зображення")); i.src = src; });
  }
  function toBlob(cv, type, q) { return new Promise((res) => cv.toBlob(res, type, q)); }

  const Gen = {
    objects: [], sprites: new Map(), base: null, work: null, baseName: "", placed: [], undo: [],
    point: null, rect: null, job: null,

    async open(admin) {
      this.admin = admin;
      this.pw = admin.pw;
      this.base = this.work = null; this.placed = []; this.undo = []; this.point = null; this.rect = null;
      const root = document.getElementById("s-admin");
      root.className = "screen admin";
      root.innerHTML = `
      <aside class="side">
        <div class="row"><h2>Генератор етапів</h2><button type="button" style="flex:0" id="g-back">← До етапів</button></div>
        <section>
          <h2>1. Знімок</h2>
          <div class="row"><button type="button" id="g-from-stage">З вибраного етапу</button><button type="button" id="g-from-file">Файл…</button></div>
          <input type="file" id="g-base-file" accept="image/*" hidden>
          <p class="status" id="g-base-lbl">Знімок не вибрано</p>
          <div class="kv"><label for="g-gsd" title="Скільки метрів на місцевості в одному пікселі знімка">Масштаб знімка, м/пкс</label><input id="g-gsd" type="number" min="0" step="0.05" placeholder="напр. 0.5"></div>
        </section>
        <section>
          <h2>2. Техніка</h2>
          <p class="status">PNG з виглядом зверху, перед дивиться вгору. Фон прибирається сам.</p>
          <div class="row"><select id="g-obj" style="flex:1 1 180px"></select><button type="button" id="g-obj-add" style="flex:0">PNG…</button><button type="button" id="g-obj-del" style="flex:0" title="Видалити з бібліотеки">✕</button></div>
          <input type="file" id="g-obj-file" accept="image/*" hidden>
          <div class="kv">
            <label for="g-len">Довжина техніки, м</label><input id="g-len" type="number" min="0.5" step="0.1">
            <label for="g-name" title="Перше слово — тип: «Танк Т-72Б3», «САУ 2С19»">Назва моделі</label><input id="g-name" maxlength="40" placeholder="Танк Т-72Б3">
            <label for="g-cage">«Мангал» (сітка над баштою)</label><input id="g-cage" type="checkbox">
          </div>
          <label class="chk"><input type="checkbox" id="g-decoy"> Муляж (обманка): клік по ньому — промах</label>
          <div class="row"><button type="button" id="g-inflate" title="Створити з цієї моделі надувний муляж і додати в бібліотеку">🎈 Зробити надувний муляж</button></div>
          <details class="adv"><summary>ТТХ для брифінгу курсанта</summary>
            <textarea id="g-ttx" rows="5" placeholder="Що це, розміри, як виглядає зверху"></textarea>
            <div class="row"><button type="button" id="g-ttx-save">Зберегти модель</button></div>
          </details>
          <p class="status" id="g-obj-status"></p>
        </section>
        <section>
          <h2>3. Клік по знімку — поставити</h2>
          <label class="slim">Розмір на знімку <b id="gq-size"></b><input type="range" id="gq-size-r" min="3" max="120" step="0.5"></label>
          <div class="seg-row"><span>Поворот</span><div class="seg" id="gp-angle">
            <button type="button" data-v="0">↑</button><button type="button" data-v="45">↗</button><button type="button" data-v="90">→</button>
            <button type="button" data-v="135">↘</button><button type="button" data-v="180">↓</button><button type="button" data-v="270">←</button>
            <button type="button" data-v="rnd">🎲</button></div></div>
          <div class="seg-row"><span>Маскування</span><div class="seg" id="gp-hide">
            <button type="button" data-v="0">Відкрито</button><button type="button" data-v="35">Частково</button><button type="button" data-v="70">Під кронами</button></div></div>
          <div class="seg-row"><span>Тінь</span><div class="seg" id="gp-shadow">
            <button type="button" data-v="0">Немає</button><button type="button" data-v="1">Слабка</button><button type="button" data-v="2">Сильна</button></div></div>
          <div class="seg-row"><span>Вигляд</span><div class="seg" id="gp-look">
            <button type="button" data-v="bright">Помітно</button><button type="button" data-v="mid">Природно</button><button type="button" data-v="dim">Зливається</button></div></div>
          <details class="adv"><summary>Тонке налаштування</summary><div class="sliders" id="g-sliders"></div></details>
        </section>
      </aside>
      <div class="mainpane">
        <div class="bar"><div class="hint" id="g-hint">1) знімок → 2) техніка → 3) клік по знімку → «Зберегти як новий етап».</div>
          <button type="button" id="g-commit">Закріпити й додати ще</button>
          <button type="button" id="g-undo">Скасувати закріплення</button>
          <button type="button" class="primary" id="g-save">Зберегти як новий етап</button></div>
        <div class="view-wrap"><div id="g-view" class="view-host"></div>
          <div class="loading" id="g-loading" hidden><span id="g-loading-t">Завантажую…</span></div></div>
      </div>`;
      const $ = (id) => root.querySelector("#" + id);
      this.$ = $;
      this.viewer = new Viewer($("g-view"), {onLeft: (x, y) => this.place(x, y)});
      $("g-sliders").innerHTML = SLIDERS.map(([t, k, lo, hi, st, v]) =>
        `<label><span>${esc(t)} <b id="gv-${k}">${v}</b></span><input type="range" id="gs-${k}" min="${lo}" max="${hi}" step="${st}" value="${v}"></label>`).join("");
      SLIDERS.forEach(([, k]) => ($("gs-" + k).oninput = () => { $("gv-" + k).textContent = $("gs-" + k).value; this.syncQuick(); this.schedule(); }));
      $("gq-size-r").oninput = () => { this.setVal("size", $("gq-size-r").value); this.syncQuick(); this.schedule(); };
      const presets = {
        "gp-angle": (v) => this.setVal("angle", v === "rnd" ? Math.floor(Math.random() * 360) : v),
        "gp-hide": (v) => this.setVal("hide", v),
        "gp-shadow": (v) => { const sz = this.val("size"); this.setVal("shadow_op", [0, 40, 60][v]); this.setVal("shadow_len", [0, Math.max(1, Math.round(sz * 0.08 * 2) / 2), Math.max(1.5, Math.round(sz * 0.15 * 2) / 2)][v]); },
        "gp-look": (v) => { const L = {bright: [4, 0, 95], mid: [10, 6, 80], dim: [20, 15, 60]}[v]; this.setVal("blend", L[0]); this.setVal("darken", L[1]); this.setVal("sat", L[2]); },
      };
      Object.keys(presets).forEach((id) => $(id).querySelectorAll("button").forEach((b) => (b.onclick = () => {
        $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
        presets[id](b.dataset.v); this.syncQuick(); this.schedule();
      })));
      $("gp-hide").querySelectorAll("button")[0].classList.add("on");
      $("gp-shadow").querySelectorAll("button")[1].classList.add("on"); $("gp-look").querySelectorAll("button")[0].classList.add("on");
      this.syncQuick();
      $("g-back").onclick = () => this.close();
      $("g-from-stage").onclick = () => this.baseFromStage();
      $("g-from-file").onclick = () => $("g-base-file").click();
      $("g-base-file").onchange = (e) => e.target.files[0] && this.baseFromFile(e.target.files[0]);
      $("g-obj").onchange = () => this.objectChanged();
      $("g-obj-add").onclick = () => $("g-obj-file").click();
      $("g-obj-file").onchange = (e) => e.target.files[0] && this.addObject(e.target.files[0]);
      $("g-obj-del").onclick = () => this.deleteObject();
      $("g-cage").onchange = () => this.schedule();
      $("g-ttx-save").onclick = () => this.saveMeta();
      $("g-decoy").onchange = () => { this.refreshTtx(); this.renderMarks(); };
      $("g-name").oninput = () => {
        const d = /^муляж/i.test($("g-name").value);
        if (d !== this.decoyName) { $("g-decoy").checked = d; this.decoyName = d; }
        this.refreshTtx();
      };
      $("g-inflate").onclick = () => this.makeDecoy();
      $("g-gsd").value = LS.get("poshuk_gen_gsd", "");
      $("g-gsd").oninput = () => { LS.set("poshuk_gen_gsd", $("g-gsd").value); this.autoSize(); };
      $("g-len").oninput = () => this.autoSize();
      $("g-commit").onclick = () => this.commit();
      $("g-undo").onclick = () => this.undoCommit();
      $("g-save").onclick = () => this.save();
      await this.loadObjects();
      if (admin.sel) this.baseFromStage();
    },

    close() { this.admin.render(); if (this.admin.sel) this.admin.select(this.admin.sel); },

    hint(t) { this.$("g-hint").textContent = t; },
    loading(t) { this.$("g-loading").hidden = !t; if (t) this.$("g-loading-t").textContent = t; },
    val(k) { return Number(this.$("gs-" + k).value); },
    setVal(k, v) { this.$("gs-" + k).value = v; this.$("gv-" + k).textContent = this.$("gs-" + k).value; if (k === "size") this.syncQuick(); },
    syncQuick() { const v = this.$("gs-size").value; this.$("gq-size-r").value = v; this.$("gq-size").textContent = v + " пкс"; },

    // ---------- бібліотека техніки
    async loadObjects(select) {
      let list = [];
      try { list = (await API.call("objects", {}, this.pw)).objects; } catch (e) { this.$("g-obj-status").textContent = "Бібліотека недоступна: " + e.message; }
      this.objects = [...list, ...Models.LIST];
      this.$("g-obj").innerHTML = this.objects.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("");
      const keep = select || LS.get("poshuk_gen_obj", "");
      if (this.objects.some((o) => o.id === keep)) this.$("g-obj").value = keep;
      this.objectChanged();
    },

    obj() { return this.objects.find((o) => o.id === this.$("g-obj").value) || BUILTIN; },

    objectChanged() {
      const o = this.obj();
      LS.set("poshuk_gen_obj", o.id);
      this.$("g-len").value = o.length_m;
      this.$("g-name").value = o.name.replace(/\s*\((вбудована|надувний)\)$/, "");
      this.$("g-decoy").checked = !!o.decoy;
      this.$("g-inflate").disabled = !!o.decoy;
      this.$("g-obj-del").disabled = !!o.builtin;
      this.decoyName = /^муляж/i.test(this.$("g-name").value);
      this.$("g-ttx").value = Logic.ttxFor(o, this.nameType());
      this.$("g-ttx-save").disabled = !!o.builtin;
      this.autoSize();
    },

    nameType() { return Logic.typeOf(this.$("g-name").value.replace(/^муляж\s+/i, "")); },
    /* Якщо в полі ТТХ автотекст — підставити актуальний для нового типу / позначки «муляж». */
    refreshTtx() {
      const box = this.$("g-ttx");
      if (Logic.isAutoTtx(box.value)) box.value = Logic.ttxFor(null, this.nameType(), this.$("g-decoy").checked);
    },

    async sprite() {
      const o = this.obj(), cage = this.$("g-cage").checked, key = o.id + (cage ? "+cage" : "");
      if (!this.sprites.has(o.id)) {
        let spr;
        if (o.builtin) spr = Models.sprite(o.id);
        else {
          const j = await API.call("object", {id: o.id}, this.pw);
          spr = Compose.prepareObject(await loadImg(`data:${j.mime || "image/png"};base64,${j.data}`));
        }
        this.sprites.set(o.id, spr);
      }
      if (!this.sprites.has(key)) this.sprites.set(key, Compose.addCage(this.sprites.get(o.id)));
      return this.sprites.get(key);
    },

    async addObject(file) {
      const st = this.$("g-obj-status");
      st.textContent = "Обробляю…"; st.className = "status";
      try {
        const spr = Compose.prepareObject(await loadImg(await fileToDataURL(file)));
        const data = (await fileToDataURL(await toBlob(spr, "image/png"))).split(",")[1];
        const name = file.name.replace(/\.[^.]+$/, "").slice(0, 40);
        const j = await API.call("object_upload", {name, data, length_m: Number(this.$("g-len").value) || 7, type: Logic.typeOf(name.replace(/^муляж\s+/i, "")), ttx: Logic.cleanTtx(this.$("g-ttx").value), decoy: this.$("g-decoy").checked || /^муляж/i.test(name) ? 1 : 0}, this.pw);
        this.sprites.set(j.object.id, spr);
        await this.loadObjects(j.object.id);
        st.textContent = j.replaced ? `«${name}» вже був — замінено новою версією.` : `Додано «${name}». Перевірте довжину й тип.`; st.className = "status ok";
      } catch (e) { st.textContent = e.message; st.className = "status no"; }
      this.$("g-obj-file").value = "";
    },

    /* Надувний муляж з поточної моделі → нова модель у бібліотеці з позначкою «муляж». */
    async makeDecoy() {
      const o = this.obj(), st = this.$("g-obj-status");
      if (o.builtin) { const v = this.objects.find((x) => x.id === o.id + ":decoy"); if (v) { this.$("g-obj").value = v.id; this.objectChanged(); } return; }
      st.textContent = "Роздуваю…"; st.className = "status";
      try {
        if (!this.sprites.has(o.id)) await this.sprite();
        const spr = Models.inflate(this.sprites.get(o.id));
        const data = (await fileToDataURL(await toBlob(spr, "image/png"))).split(",")[1];
        const name = ("Муляж " + o.name).slice(0, 40);
        const j = await API.call("object_upload", {name, data, length_m: o.length_m, type: o.type || Logic.typeOf(o.name), decoy: 1}, this.pw);
        this.sprites.set(j.object.id, spr);
        await this.loadObjects(j.object.id);
        st.textContent = `Додано «${name}» ✓`; st.className = "status ok";
      } catch (e) { st.textContent = e.message; st.className = "status no"; }
    },

    async saveMeta() {
      const o = this.obj(), st = this.$("g-obj-status");
      if (o.builtin) return;
      const nm = this.$("g-name").value.trim() || o.name;
      Object.assign(o, {name: nm, length_m: Number(this.$("g-len").value) || 7, type: Logic.typeOf(nm.replace(/^муляж\s+/i, "")), ttx: Logic.cleanTtx(this.$("g-ttx").value)});
      o.decoy = this.$("g-decoy").checked ? 1 : 0;
      try { await API.call("object_update", {id: o.id, name: o.name, length_m: o.length_m, type: o.type, ttx: o.ttx, decoy: o.decoy}, this.pw); await this.loadObjects(o.id); st.textContent = `Збережено ✓ (тип: ${o.type})`; st.className = "status ok"; }
      catch (e) { st.textContent = e.message; st.className = "status no"; }
    },

    async deleteObject() {
      const o = this.obj();
      if (o.builtin || !confirm(`Видалити «${o.name}» з бібліотеки техніки?`)) return;
      try { await API.call("object_delete", {id: o.id}, this.pw); } catch (e) { UI.toast(e.message); return; }
      await this.loadObjects();
    },

    autoSize() {
      const gsd = Number(this.$("g-gsd").value), len = Number(this.$("g-len").value);
      if (gsd > 0 && len > 0) this.setVal("size", Math.min(120, Math.max(3, Math.round(len / gsd * 2) / 2)));
      this.schedule();
    },

    // ---------- знімок
    async setBase(img, name) {
      const src = await Tiles.toCanvas(img);
      const w = src.width, h = src.height;
      this.base = Compose.canvas(w, h);
      this.base.getContext("2d").drawImage(src, 0, 0);
      this.work = Compose.canvas(w, h);
      this.work.getContext("2d").drawImage(this.base, 0, 0);
      this.baseName = name; this.placed = []; this.undo = []; this.point = null; this.rect = null;
      this.$("g-base-lbl").textContent = `${name} · ${w}×${h} пкс`;
      this.viewer.setImage(this.work);
      this.renderMarks();
      this.hint("Клікніть по знімку, щоб поставити техніку. Колесо — зум, перетягування — рух.");
    },

    async baseFromStage() {
      const a = this.admin, s = a.stage();
      if (!s) { this.hint("В адмінці не вибрано етап — відкрийте знімок кнопкою «Файл…»."); return; }
      this.loading("Завантажую знімок…");
      try {
        await this.setBase(await API.loadImage(s.id, this.pw), s.title);
        this.baseMeta = {direction: s.direction || "", season: s.season || "", gsd: s.gsd || 0};
        if (s.gsd) { this.$("g-gsd").value = s.gsd; this.autoSize(); }
      } catch (e) { this.hint(e.message); }
      this.loading(null);
    },

    async baseFromFile(file) {
      try {
        const img = await loadImg(await fileToDataURL(file));
        await this.setBase(img, file.name.replace(/\.[^.]+$/, "")); this.baseMeta = null;
        const gsd = Scale.fromName(file.name.replace(/\.[^.]+$/, "")) || (Scale.estimate(img) || {}).gsd;
        if (gsd) { this.$("g-gsd").value = gsd; LS.set("poshuk_gen_gsd", String(gsd)); this.autoSize(); }
      } catch (e) { this.hint(e.message); }
      this.$("g-base-file").value = "";
    },

    // ---------- рендер
    params() {
      return {size: this.val("size"), angle: this.val("angle"), hide: this.val("hide") / 100, sharp: this.val("sharp") / 100,
        shadow_dir: this.val("shadow_dir"), shadow_len: this.val("shadow_len"), shadow_op: this.val("shadow_op") / 100,
        blend: this.val("blend") / 100, darken: this.val("darken") / 100, sat: this.val("sat") / 100};
    },

    schedule() { clearTimeout(this.job); this.job = setTimeout(() => this.render(), 60); },

    restoreRect() {
      if (!this.rect) return;
      const r = this.rect, ctx = this.work.getContext("2d");
      ctx.clearRect(r.x, r.y, r.w, r.h);
      ctx.drawImage(this.base, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      this.rect = null;
    },

    async render() {
      if (!this.base) return;
      this.restoreRect();
      if (this.point) {
        try {
          const spr = await this.sprite();
          this.restoreRect();
          this.rect = Compose.compose(this.base, this.work, spr, this.point[0], this.point[1], this.params());
        } catch (e) { this.hint("Помилка: " + e.message); }
      }
      this.viewer.replaceImage(this.work);
      this.renderMarks();
    },

    renderMarks() {
      this.viewer.setMarks(this.placed.map((t) => ({x: t.x, y: t.y, r: t.r, color: t.decoy ? "#b48cff" : C.hit, dashed: !!t.decoy, label: (t.decoy ? "муляж: " : "") + t.type})));
    },

    place(cx, cy) {
      if (!this.base) return;
      const [x, y] = this.viewer.toImage(cx, cy);
      if (!this.viewer.inside(x, y)) return;
      this.point = [Math.round(x), Math.round(y)];
      this.hint(`Обʼєкт у точці (${this.point[0]}, ${this.point[1]}). Клік — перенести. Готово — «Закріпити й додати ще» або «Зберегти як новий етап».`);
      this.render();
    },

    target() {
      return {x: this.point[0], y: this.point[1], r: Math.max(8, Math.round(this.val("size") * 0.6)), type: Logic.typeOf(this.$("g-name").value.replace(/^муляж\s+/i, "")), obj: this.obj().id, ...(this.$("g-decoy").checked ? {decoy: true} : {})};
    },

    async commit() {
      if (!this.point) { this.hint("Спершу клікніть по знімку, щоб поставити техніку."); return; }
      clearTimeout(this.job);
      await this.render();
      const r = this.rect, bctx = this.base.getContext("2d");
      if (r) {
        this.undo.push({rect: r, data: bctx.getImageData(r.x, r.y, r.w, r.h), placed: this.placed.length});
        bctx.drawImage(this.work, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      }
      this.placed.push(this.target());
      this.point = null; this.rect = null;
      this.hint(`Закріплено обʼєктів: ${this.placed.length}. Можна ставити наступний або зберегти етап.`);
      this.renderMarks();
    },

    undoCommit() {
      const u = this.undo.pop();
      if (!u) { this.hint("Немає закріплених обʼєктів."); return; }
      this.restoreRect(); this.point = null;
      this.base.getContext("2d").putImageData(u.data, u.rect.x, u.rect.y);
      const ctx = this.work.getContext("2d");
      ctx.clearRect(u.rect.x, u.rect.y, u.rect.w, u.rect.h);
      ctx.drawImage(this.base, u.rect.x, u.rect.y, u.rect.w, u.rect.h, u.rect.x, u.rect.y, u.rect.w, u.rect.h);
      this.placed.length = u.placed;
      this.viewer.replaceImage(this.work);
      this.renderMarks();
      this.hint(`Скасовано. Закріплено обʼєктів: ${this.placed.length}.`);
    },

    async save() {
      if (!this.base) return;
      clearTimeout(this.job);
      await this.render();
      const targets = this.placed.slice();
      if (this.point) targets.push(this.target());
      if (!targets.length) { this.hint("На знімку ще немає техніки."); return; }
      if (!targets.some((t) => !t.decoy)) { this.hint("Потрібна хоча б одна справжня ціль — зараз на знімку лише муляжі."); return; }
      this.loading("Зберігаю етап…");
      try {
        const d = new Date(), pad = (n) => String(n).padStart(2, "0");
        const name = `gen_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const title = `${this.baseName} · ${[...new Set(targets.filter((t) => !t.decoy).map((t) => t.type))].sort().join(", ")}${targets.some((t) => t.decoy) ? " + муляжі" : ""}`;
        const cv = Compose.canvas(this.work.width, this.work.height);
        cv.getContext("2d").drawImage(this.work, 0, 0);
        const stage = await API.uploadStage(cv, {title, targets, name}, this.pw, (m) => this.loading("Зберігаю етап… " + m));
        const meta = Object.assign({gsd: Number(this.$("g-gsd").value) || 0}, this.baseMeta || {});
        await API.call("save_stage", Object.assign({id: stage.id}, meta), this.pw).catch(() => {});
        Object.assign(stage, meta);
        this.admin.stages.push(stage);
        this.admin.sel = stage.id;
        this.loading(null);
        UI.toast(`Етап «${title}» збережено: цілей ${targets.length}.`);
        this.close();
      } catch (e) { this.loading(null); this.hint("Не збережено: " + e.message); }
    },

    /* Імпорт папки poshuk_local: PNG з objects/ — у бібліотеку (без дублів за назвою). */
    async importObjects(files, pw) {
      if (!files.length) return 0;
      let have = [];
      try { have = (await API.call("objects", {}, pw)).objects.map((o) => o.name); } catch (e) { return 0; }
      let n = 0;
      for (const f of files) {
        const name = f.name.replace(/\.[^.]+$/, "").slice(0, 40);
        if (have.includes(name)) continue;
        const spr = Compose.prepareObject(await loadImg(await fileToDataURL(f)));
        const data = (await fileToDataURL(await toBlob(spr, "image/png"))).split(",")[1];
        const decoy = /^муляж/i.test(name), base = name.replace(/^муляж\s+/i, "");
        const LEN = [[/красух/i, 12], [/бук/i, 9.3], [/град|бм-21/i, 7.4], [/бмп/i, 7.2], [/бтр/i, 7.6], [/сау|мста|гвоздик/i, 7.2], [/katap|катап|lancet|ланцет/i, 6.2], [/tank|танк|т-\d/i, 7]];
        const len = (LEN.find(([re]) => re.test(base)) || [0, 7])[1];
        await API.call("object_upload", {name, data, length_m: len, type: Logic.typeOf(base), decoy: decoy ? 1 : 0}, pw);
        n++;
      }
      return n;
    },
  };

  window.Gen = Gen;
})();
