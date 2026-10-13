/* Генератор етапів (адмінка): вбудувати техніку в знімок і зберегти як новий етап. */
(function () {
  const {LS} = API;
  const esc = (s) => UI.esc(s);
  const C = {hit: "#5fd38a", accent: "#c9d64a"};
  const BUILTIN = {id: "builtin:catapult", name: "Катапульта з «Ланцетом» (вбудована)", length_m: 6.2, type: "катапульта з БпЛА", builtin: true};

  // назва, ключ, мін, макс, крок, типове значення
  const SLIDERS = [
    ["Розмір на знімку, пкс", "size", 3, 120, 0.5, 16],
    ["Куди дивиться (компас), °", "angle", 0, 359, 1, 0],
    ["Сховано під кронами, %", "hide", 0, 90, 5, 30],
    ["З якого боку крони, °", "hide_dir", 0, 359, 5, 0],
    ["Тінь: куди падає, °", "shadow_dir", 0, 359, 5, 135],
    ["Тінь: довжина, пкс", "shadow_len", 0, 8, 0.5, 2],
    ["Тінь: щільність, %", "shadow_op", 0, 90, 5, 55],
    ["Злиття з фоном, %", "blend", 0, 50, 1, 10],
    ["Затемнення, %", "darken", 0, 50, 1, 10],
    ["Насиченість кольору, %", "sat", 0, 150, 5, 70],
    ["Варіант крон", "seed", 1, 30, 1, 1],
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
            <label for="g-type">Тип цілі</label><input id="g-type" placeholder="танк">
            <label for="g-cage">«Мангал» (сітка над баштою)</label><input id="g-cage" type="checkbox">
          </div>
          <p class="status" id="g-obj-status"></p>
        </section>
        <section>
          <h2>3. Клік по знімку — поставити</h2>
          <div class="sliders" id="g-sliders"></div>
        </section>
      </aside>
      <div class="mainpane">
        <div class="bar"><div class="hint" id="g-hint">Виберіть знімок і техніку.</div>
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
      SLIDERS.forEach(([, k]) => ($("gs-" + k).oninput = () => { $("gv-" + k).textContent = $("gs-" + k).value; this.schedule(); }));
      $("g-back").onclick = () => this.close();
      $("g-from-stage").onclick = () => this.baseFromStage();
      $("g-from-file").onclick = () => $("g-base-file").click();
      $("g-base-file").onchange = (e) => e.target.files[0] && this.baseFromFile(e.target.files[0]);
      $("g-obj").onchange = () => this.objectChanged();
      $("g-obj-add").onclick = () => $("g-obj-file").click();
      $("g-obj-file").onchange = (e) => e.target.files[0] && this.addObject(e.target.files[0]);
      $("g-obj-del").onclick = () => this.deleteObject();
      $("g-cage").onchange = () => this.schedule();
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
    setVal(k, v) { this.$("gs-" + k).value = v; this.$("gv-" + k).textContent = this.$("gs-" + k).value; },

    // ---------- бібліотека техніки
    async loadObjects(select) {
      let list = [];
      try { list = (await API.call("objects", {}, this.pw)).objects; } catch (e) { this.$("g-obj-status").textContent = "Бібліотека недоступна: " + e.message; }
      this.objects = [...list, BUILTIN];
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
      this.$("g-type").value = o.type || o.name.replace(/\s*\(.*\)$/, "");
      this.$("g-obj-del").disabled = !!o.builtin;
      this.autoSize();
    },

    async sprite() {
      const o = this.obj(), cage = this.$("g-cage").checked, key = o.id + (cage ? "+cage" : "");
      if (!this.sprites.has(o.id)) {
        let spr;
        if (o.builtin) spr = Compose.catapultSprite();
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
        const j = await API.call("object_upload", {name, data, length_m: Number(this.$("g-len").value) || 7, type: this.$("g-type").value.trim()}, this.pw);
        this.sprites.set(j.object.id, spr);
        await this.loadObjects(j.object.id);
        st.textContent = `Додано «${name}». Перевірте довжину й тип.`; st.className = "status ok";
      } catch (e) { st.textContent = e.message; st.className = "status no"; }
      this.$("g-obj-file").value = "";
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
      try { await this.setBase(await API.loadImage(s.id, this.pw), s.title); } catch (e) { this.hint(e.message); }
      this.loading(null);
    },

    async baseFromFile(file) {
      try { await this.setBase(await loadImg(await fileToDataURL(file)), file.name.replace(/\.[^.]+$/, "")); } catch (e) { this.hint(e.message); }
      this.$("g-base-file").value = "";
    },

    // ---------- рендер
    params() {
      return {size: this.val("size"), angle: this.val("angle"), hide: this.val("hide") / 100, hide_dir: this.val("hide_dir"),
        shadow_dir: this.val("shadow_dir"), shadow_len: this.val("shadow_len"), shadow_op: this.val("shadow_op") / 100,
        blend: this.val("blend") / 100, darken: this.val("darken") / 100, sat: this.val("sat") / 100, seed: this.val("seed")};
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
      this.viewer.setMarks(this.placed.map((t) => ({x: t.x, y: t.y, r: t.r, color: C.hit, label: t.type})));
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
      return {x: this.point[0], y: this.point[1], r: Math.max(8, Math.round(this.val("size") * 0.6)), type: this.$("g-type").value.trim() || "ціль"};
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
      this.setVal("seed", this.val("seed") % 30 + 1);
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
      this.loading("Зберігаю етап…");
      try {
        const d = new Date(), pad = (n) => String(n).padStart(2, "0");
        const name = `gen_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const title = `${this.baseName} · ${[...new Set(targets.map((t) => t.type))].sort().join(", ")}`;
        const cv = Compose.canvas(this.work.width, this.work.height);
        cv.getContext("2d").drawImage(this.work, 0, 0);
        const stage = await API.uploadStage(cv, {title, targets, name}, this.pw, (m) => this.loading("Зберігаю етап… " + m));
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
        const isTank = /tank|танк/i.test(name), isCat = /katap|катап|lancet|ланцет/i.test(name);
        await API.call("object_upload", {name, data, length_m: isTank ? 7 : isCat ? 6.2 : 7,
          type: isTank ? "танк" : isCat ? "катапульта з БпЛА" : ""}, pw);
        n++;
      }
      return n;
    },
  };

  window.Gen = Gen;
})();
