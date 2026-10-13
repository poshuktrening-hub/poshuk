/* Адмінка (адреса сайту + #admin): знімки, цілі, ознаки, теплова карта, налаштування. */
(function () {
  const {LS, SS} = API;
  const esc = (s) => UI.esc(s);
  const C = {hit: "#5fd38a", accent: "#c9d64a"};

  const Admin = {
    pw: null, stages: [], sel: null, tsel: null, img: null, heatOn: false, saveT: null,

    async boot() {
      UI.show("s-admin");
      this.pw = SS.get("poshuk_admin_pw");
      if (this.pw) {
        try { await this.load(); return this.render(); } catch (e) { this.pw = null; }
      }
      this.loginScreen();
    },

    loginScreen(err = "") {
      const root = document.getElementById("s-admin");
      root.className = "screen center";
      root.innerHTML = `<form class="card narrow" id="a-login">
        <h1 class="logo">Адмін<span>ка</span></h1>
        <p class="muted">Пошук техніки · керування етапами</p>
        <label for="a-pass">Пароль адміністратора</label>
        <input id="a-pass" type="password" autocomplete="current-password" required>
        <p class="err" role="alert">${esc(err)}</p>
        <button class="primary" type="submit">Увійти</button>
        <button type="button" class="link" onclick="location.hash='';location.reload()">← До гри</button></form>`;
      root.querySelector("#a-login").onsubmit = async (e) => {
        e.preventDefault();
        this.pw = root.querySelector("#a-pass").value;
        const b = root.querySelector("button.primary"); b.disabled = true; b.textContent = "Перевіряю…";
        try { await this.load(); SS.set("poshuk_admin_pw", this.pw); this.render(); } catch (er) { this.loginScreen(er.message); }
      };
      root.querySelector("#a-pass").focus();
    },

    async load() {
      const j = await API.call("admin_stages", {}, this.pw);
      this.stages = j.stages;
      try { this.cols = Number((await API.call("get_settings", {}, this.pw)).settings.grid_cols) || 8; } catch (e) { this.cols = 8; }
    },

    // ---------- розмітка
    render() {
      const root = document.getElementById("s-admin");
      root.className = "screen admin";
      root.innerHTML = `
      <aside class="side">
        <div class="row"><h2>Етапи</h2><button type="button" id="a-settings-btn" style="flex:0">Налаштування</button><button type="button" style="flex:0" id="a-out">Вийти</button></div>
        <section>
          <ul class="list" id="a-stages"></ul>
          <div class="row">
            <label class="btnlike" style="margin:0;flex:1"><button type="button" id="a-add" style="width:100%">Додати знімки…</button></label>
            <button type="button" id="a-import" title="Виберіть папку локальної версії гри (poshuk_local)">Імпорт папки…</button>
          </div>
          <button type="button" id="a-migrate" hidden title="Скопіювати етапи й техніку з Google-таблиці">Перенести з Google…</button>
          <input type="file" id="a-file" accept="image/*" multiple hidden>
          <input type="file" id="a-imp-file" webkitdirectory directory multiple hidden>
          <p class="status" id="a-up-status"></p>
        </section>
        <section id="a-stage-box" hidden>
          <label for="a-title" style="margin:0">Назва етапу</label>
          <input id="a-title">
          <div class="row">
            <button type="button" id="a-toggle"></button>
            <button type="button" class="danger" id="a-del">Видалити етап</button>
          </div>
          <h2 style="margin-top:6px">Цілі</h2>
          <p class="status" id="a-thint"></p>
          <ul class="list" id="a-targets" style="font-family:var(--mono);font-size:.82rem"></ul>
          <div id="a-tedit">
            <div class="kv">
              <label for="a-obj">Модель (брифінг)</label><select id="a-obj"></select>
              <label for="a-type">Тип</label><input id="a-type" list="a-types" placeholder="танк">
              <label for="a-lm">Орієнтир</label><select id="a-lm"></select>
            </div>
            <div id="a-model-box" class="model-box" hidden>
              <div class="row"><img id="a-model-img" alt=""><div class="status" id="a-model-meta"></div></div>
              <div class="kv" style="margin-top:6px"><label for="a-mname">Назва моделі</label><input id="a-mname" maxlength="40" placeholder="Т-72Б3"></div>
              <label for="a-ttx" style="margin:.4rem 0 .2rem">ТТХ моделі (бачить курсант перед етапом)</label>
              <textarea id="a-ttx" rows="5"></textarea>
              <div class="row"><button type="button" id="a-ttx-save">Зберегти модель</button><span class="status" id="a-ttx-st"></span></div>
            </div>
            <details class="adv"><summary>Для розбору (необовʼязково)</summary>
              <div class="kv"><label for="a-r">Радіус влучання, пкс</label><input id="a-r" type="number" min="3" max="120" value="14"></div>
              <label style="margin:.6rem 0 .2rem">Ознаки</label>
              <div class="signs" id="a-signs"></div>
              <label for="a-note" style="margin:.6rem 0 .2rem">Примітка</label>
              <input id="a-note" placeholder="Корма під кронами, видно башту з «мангалом»">
            </details>
            <div class="row" style="margin-top:8px">
              <button type="button" id="a-tdel">Видалити ціль</button>
              <button type="button" id="a-tdesel">Зняти вибір (Esc)</button>
            </div>
          </div>
          <datalist id="a-types"></datalist>
          <p class="status" id="a-save-status"></p>
        </section>
        <section id="a-settings" hidden></section>
      </aside>
      <div class="mainpane">
        <div class="bar"><div class="hint" id="a-hint">Новий етап: «Генератор» (вставити техніку в знімок) або «Додати знімки…» і клік по техніці на знімку.</div>
          <button type="button" class="primary" id="a-gen" title="Вбудувати техніку в знімок і зберегти як новий етап">Генератор</button>
          <button type="button" id="a-heat">Теплова карта</button>
          <button type="button" onclick="location.hash='';location.reload()">До гри</button></div>
        <div class="view-wrap"><div id="a-view" class="view-host"></div>
          <div class="loading" id="a-loading" hidden><span>Завантажую…</span></div></div>
      </div>`;
      const $ = (id) => root.querySelector("#" + id);
      this.$ = $;
      this.viewer = new Viewer($("a-view"), {onLeft: (x, y) => this.click(x, y), onRight: (x, y) => this.rclick(x, y)});
      const g = this.viewer.addButton("#", "Сітка квадратів", () => { this.viewer.toggleGrid(); g.classList.toggle("on", this.viewer.showGrid); });

      $("a-lm").innerHTML = ["", ...Logic.LANDMARKS].map((l) => `<option value="${esc(l)}">${l ? esc(l) : "— не перевіряти —"}</option>`).join("");
      $("a-signs").innerHTML = Logic.SIGNS.map((s, i) => `<label><input type="checkbox" data-sign="${esc(s)}" id="a-sg${i}"> ${esc(s)}</label>`).join("");
      $("a-out").onclick = () => { SS.del("poshuk_admin_pw"); location.reload(); };
      $("a-add").onclick = () => $("a-file").click();
      $("a-file").onchange = (e) => this.uploadFiles([...e.target.files]);
      $("a-import").onclick = () => $("a-imp-file").click();
      $("a-imp-file").onchange = (e) => this.importLocal([...e.target.files]);
      $("a-title").oninput = () => { this.stage().title = $("a-title").value; this.dirty(true); this.renderList(); };
      $("a-toggle").onclick = () => { const s = this.stage(); s.enabled = !s.enabled; this.dirty(true); this.renderStage(); };
      $("a-del").onclick = () => this.deleteStage();
      ["a-type", "a-r", "a-lm", "a-note"].forEach((id) => ($(id).oninput = () => this.fieldChanged()));
      $("a-obj").onchange = () => {
        const o = this.objById($("a-obj").value);
        if (o && this.tsel !== null) { const t = this.stage().targets[this.tsel]; if (o.type && (!t.type || t.type === "ціль")) $("a-type").value = o.type; }
        this.fieldChanged(); this.showModel();
      };
      $("a-ttx-save").onclick = () => this.saveTtx();
      this.loadObjects();
      $("a-signs").onchange = () => this.fieldChanged();
      $("a-tdel").onclick = () => this.deleteTarget(this.tsel);
      $("a-tdesel").onclick = () => this.selectTarget(null);
      $("a-heat").onclick = () => this.toggleHeat();
      $("a-migrate").hidden = !(API.isCF && window.POSHUK_CONFIG.gas);
      $("a-migrate").onclick = () => this.migrate();
      $("a-gen").onclick = async () => { await this.flushSave(); this.heatOn = false; Gen.open(this); };
      $("a-settings-btn").onclick = () => this.settings();
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.getElementById("s-admin").hidden) this.selectTarget(null); });
      window.addEventListener("beforeunload", (e) => { if (this.saveT) { e.preventDefault(); e.returnValue = ""; } });
      this.renderList();
      if (this.stages.length) this.select(this.stages[0].id);
    },

    stage() { return this.stages.find((s) => s.id === this.sel); },

    renderList() {
      const $ = this.$;
      $("a-stages").innerHTML = this.stages.map((s) =>
        `<li data-id="${s.id}" class="${s.id === this.sel ? "sel" : ""}"><span class="${s.enabled ? "" : "off"}">${s.enabled ? "✓" : "✗"} ${esc(s.title)}</span><span class="cnt">${s.targets.length}</span></li>`
      ).join("") || `<li class="muted">Етапів ще немає</li>`;
      $("a-stages").querySelectorAll("li[data-id]").forEach((li) => (li.onclick = () => this.select(li.dataset.id)));
      const types = [...new Set([...this.stages.flatMap((s) => s.targets.map((t) => t.type)), ...Logic.TYPES].filter(Boolean))].sort();
      $("a-types").innerHTML = types.map((t) => `<option value="${esc(t)}">`).join("");
    },

    async select(id) {
      await this.flushSave();
      this.sel = id; this.tsel = null;
      const s = this.stage();
      this.renderList(); this.renderStage();
      this.$("a-loading").hidden = false;
      try {
        this.img = await API.loadImage(id, this.pw);
      } catch (e) { this.$("a-loading").hidden = true; UI.toast(e.message); return; }
      this.$("a-loading").hidden = true;
      if (this.sel !== id) return;
      if (!s.w) { s.w = this.img.width; s.h = this.img.height; }
      this.viewer.setImage(this.img);
      this.viewer.setGrid(this.cols || 8);
      if (this.heatOn) this.showHeat();
      this.renderTargets();
      this.$("a-hint").textContent = `${this.img.width}×${this.img.height} пкс · колесо — зум, перетягування — рух, правий клік по цілі — видалити`;
    },

    renderStage() {
      const s = this.stage(), $ = this.$;
      $("a-stage-box").hidden = !s;
      $("a-settings").hidden = true;
      if (!s) return;
      $("a-title").value = s.title;
      $("a-toggle").textContent = s.enabled ? "Вимкнути етап" : "Увімкнути етап";
      this.renderTargets();
    },

    renderTargets() {
      const s = this.stage(), $ = this.$;
      if (!s) return;
      if (this.tsel !== null && this.tsel >= s.targets.length) this.tsel = null;
      $("a-targets").innerHTML = s.targets.map((t, i) =>
        `<li data-i="${i}" class="${i === this.tsel ? "sel" : ""}">${t.signs && t.signs.length || t.landmark ? "•" : " "}${i + 1}. ${esc(t.type || "ціль")}${t.obj && this.objById(t.obj) ? " · " + esc(this.objById(t.obj).name) : ""} · x=${t.x} y=${t.y}</li>`
      ).join("") || `<li class="muted">Клікніть по знімку, щоб додати ціль</li>`;
      $("a-targets").querySelectorAll("li[data-i]").forEach((li) => (li.onclick = () => this.selectTarget(Number(li.dataset.i), true)));
      $("a-thint").textContent = this.tsel === null
        ? "Клік по знімку — нова ціль (тип і радіус з полів нижче). Виберіть ціль у списку, щоб змінити її."
        : `Редагується ціль №${this.tsel + 1}: клік по знімку переносить її, поля змінюють одразу.`;
      $("a-thint").className = "status" + (this.tsel === null ? "" : " ok");
      ["a-tdel", "a-tdesel"].forEach((id) => ($(id).disabled = this.tsel === null));
      const marks = s.targets.map((t, i) => ({x: t.x, y: t.y, r: t.r || 14, color: i === this.tsel ? C.accent : C.hit, dashed: i === this.tsel, label: t.type || ""}));
      this.viewer.setMarks(marks);
    },

    selectTarget(i, zoom) {
      this.tsel = i;
      const $ = this.$, s = this.stage();
      if (i !== null && s) {
        const t = s.targets[i];
        this.filling = true;
        $("a-type").value = t.type || "";
        $("a-r").value = t.r || 14;
        $("a-lm").value = t.landmark || "";
        $("a-note").value = t.note || "";
        $("a-obj").value = t.obj || "";
        this.showModel();
        $("a-signs").querySelectorAll("input").forEach((cb) => (cb.checked = (t.signs || []).includes(cb.dataset.sign)));
        this.filling = false;
        if (zoom) this.viewer.zoomTo(6, t.x, t.y);
      }
      this.renderTargets();
    },

    fieldChanged() {
      if (this.filling || this.tsel === null) return;
      const t = this.stage().targets[this.tsel], $ = this.$;
      t.type = $("a-type").value.trim() || "ціль";
      t.r = Math.max(3, Number($("a-r").value) || 14);
      const lm = $("a-lm").value; if (lm) t.landmark = lm; else delete t.landmark;
      const note = $("a-note").value.trim(); if (note) t.note = note; else delete t.note;
      const ob = $("a-obj").value; if (ob) t.obj = ob; else delete t.obj;
      const signs = [...$("a-signs").querySelectorAll("input:checked")].map((cb) => cb.dataset.sign);
      if (signs.length) t.signs = signs; else delete t.signs;
      this.dirty(true);
      this.renderTargets();
    },

    click(cx, cy) {
      const s = this.stage();
      if (!s || this.heatOn) return;
      const [x, y] = this.viewer.toImage(cx, cy);
      if (!this.viewer.inside(x, y)) return;
      if (this.tsel !== null) {
        Object.assign(s.targets[this.tsel], {x: Math.round(x), y: Math.round(y)});
      } else {
        const t = {x: Math.round(x), y: Math.round(y), r: Math.max(3, Number(this.$("a-r").value) || 14), type: this.$("a-type").value.trim() || "ціль"};
        if (this.$("a-obj").value) t.obj = this.$("a-obj").value;
        s.targets.push(t);
      }
      this.dirty(true);
      this.renderTargets(); this.renderList();
    },

    rclick(cx, cy) {
      const s = this.stage();
      if (!s) return;
      const [x, y] = this.viewer.toImage(cx, cy);
      const tol = 12 / this.viewer.s;
      let best = null, bd = Infinity;
      s.targets.forEach((t, i) => { const d = Math.hypot(t.x - x, t.y - y); if (d <= (t.r || 14) + tol && d < bd) { best = i; bd = d; } });
      if (best !== null && !this.heatOn) this.deleteTarget(best); else this.viewer.zoomAt(0.5, cx, cy);
    },

    deleteTarget(i) {
      if (i === null || i === undefined) return;
      this.stage().targets.splice(i, 1);
      this.tsel = null;
      this.dirty(true);
      this.renderTargets(); this.renderList();
    },

    // ---------- збереження (автоматично через 1,2 с після зміни)
    dirty() {
      clearTimeout(this.saveT);
      this.status("Не збережено…", "");
      this.saveT = setTimeout(() => this.flushSave(), 1200);
    },

    async flushSave() {
      if (!this.saveT) return;
      clearTimeout(this.saveT); this.saveT = null;
      const s = this.stage();
      if (!s) return;
      this.status("Зберігаю…", "");
      try {
        await API.call("save_stage", {id: s.id, title: s.title, enabled: s.enabled, targets: s.targets}, this.pw);
        this.status("Збережено ✓", "ok");
      } catch (e) {
        this.status("Не збережено: " + e.message, "no");
        this.saveT = setTimeout(() => this.flushSave(), 5000);
      }
    },

    status(t, cls) { const el = this.$("a-save-status"); if (el) { el.textContent = t; el.className = "status " + cls; } },

    // ---------- завантаження
    readImage(file) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
          const img = new Image();
          img.onload = () => resolve({img, data: String(fr.result).split(",")[1], mime: file.type || "image/png"});
          img.onerror = () => reject(new Error(`«${file.name}» — не зображення`));
          img.src = fr.result;
        };
        fr.onerror = () => reject(new Error(`Не вдалось прочитати «${file.name}»`));
        fr.readAsDataURL(file);
      });
    },

    async uploadOne(file, title, targets) {
      if (file.size > (API.isCF ? 80 : 20) * 1024 * 1024) throw new Error(`«${file.name}» завеликий`);
      const {img} = await this.readImage(file);
      const st = this.$("a-up-status"), prefix = st.textContent;
      const stage = await API.uploadStage(img, {title, targets, name: file.name.replace(/\.[^.]+$/, "")}, this.pw, (m) => (st.textContent = prefix + " " + m));
      this.stages.push(stage);
      return stage;
    },

    async uploadFiles(files) {
      const st = this.$("a-up-status");
      let last = null;
      for (let i = 0; i < files.length; i++) {
        st.textContent = `Завантажую ${i + 1}/${files.length}: ${files[i].name}…`;
        st.className = "status";
        try { last = await this.uploadOne(files[i], files[i].name.replace(/\.[^.]+$/, "")); } catch (e) { st.textContent = e.message; st.className = "status no"; return; }
      }
      st.textContent = files.length ? `Додано: ${files.length}. Клікніть по знімку, щоб поставити ціль.` : "";
      st.className = "status ok";
      this.$("a-file").value = "";
      this.renderList();
      if (last) this.select(last.id);
    },

    async importLocal(files) {
      if (!files.length) return;
      const st = this.$("a-up-status");
      const json = files.find((f) => f.name.toLowerCase() === "targets.json") || files.find((f) => f.name.toLowerCase().endsWith(".json") && /data/i.test(f.webkitRelativePath || ""));
      if (!json) { st.textContent = "У вибраній папці немає data/targets.json. Виберіть папку локальної гри (poshuk_local)."; st.className = "status no"; return; }
      files = files.filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|bmp)$/i.test(f.name));
      const objFiles = files.filter((f) => /(^|\/)objects\//i.test(f.webkitRelativePath || "") && /\.png$/i.test(f.name));
      let data;
      try { data = JSON.parse(await json.text()); } catch (e) { st.textContent = "targets.json пошкоджений"; st.className = "status no"; return; }
      const byName = new Map(files.map((f) => [f.name, f]));
      const items = (data.images || []).filter((it) => byName.has(it.file));
      const missing = (data.images || []).length - items.length;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        st.textContent = `Імпорт ${i + 1}/${items.length}: ${it.title}…`; st.className = "status";
        try { await this.uploadOne(byName.get(it.file), it.title, it.targets || []); } catch (e) { st.textContent = e.message; st.className = "status no"; return; }
      }
      if (objFiles.length) { st.textContent = "Імпорт техніки для генератора…"; st.className = "status"; }
      let nObj = 0;
      try { nObj = await Gen.importObjects(objFiles, this.pw); } catch (e) { /* техніку можна додати й у генераторі */ }
      st.textContent = `Імпортовано етапів: ${items.length}.` + (nObj ? ` Техніки в бібліотеку генератора: ${nObj}.` : "") + (missing ? ` Без знімка пропущено: ${missing} (виберіть і файли з папки images).` : "");
      st.className = "status ok";
      this.$("a-imp-file").value = "";
      this.renderList();
      if (items.length) this.select(this.stages[this.stages.length - 1].id);
    },

    /* Перенесення з Google-скрипта: етапи (знімок + цілі + увімкнено) і бібліотека техніки. Дублікати за назвою пропускаються. */
    async migrate() {
      const gas = window.POSHUK_CONFIG.gas, st = this.$("a-up-status");
      const G = async (action, data = {}) => {
        const r = await fetch(gas, {method: "POST", body: JSON.stringify(Object.assign({action, p: this.pw}, data)), redirect: "follow"});
        const j = await r.json(); if (!j.ok) throw new Error(j.error || "Помилка Google-скрипта"); return j;
      };
      const img = (j) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Не вдалось відкрити знімок")); i.src = `data:${j.mime};base64,${j.data}`; });
      try {
        st.className = "status"; st.textContent = "Читаю етапи з Google…";
        const list = (await G("admin_stages")).stages;
        const have = new Set(this.stages.map((s) => s.title));
        let n = 0;
        for (const s of list) {
          if (have.has(s.title)) continue;
          st.textContent = `Переношу ${n + 1}: ${s.title}…`;
          const stage = await API.uploadStage(await img(await G("image", {id: s.id})), {title: s.title, targets: s.targets}, this.pw);
          if (!s.enabled) { stage.enabled = false; await API.call("save_stage", {id: stage.id, enabled: false}, this.pw); }
          this.stages.push(stage); n++;
          this.renderList();
        }
        let m = 0;
        try {
          const objs = (await G("objects")).objects;
          const haveO = new Set((await API.call("objects", {}, this.pw)).objects.map((o) => o.name));
          for (const o of objs) {
            if (haveO.has(o.name)) continue;
            const d = await G("object", {id: o.id});
            await API.call("object_upload", {name: o.name, length_m: o.length_m, type: o.type, data: d.data}, this.pw); m++;
          }
        } catch (e) { /* у старій версії скрипта бібліотеки техніки ще немає */ }
        st.className = "status ok"; st.textContent = `Перенесено етапів: ${n}` + (m ? `, техніки: ${m}` : "") + ".";
        if (n && !this.sel) this.select(this.stages[0].id);
      } catch (e) { st.className = "status no"; st.textContent = "Перенесення зупинено: " + e.message; }
    },

    // ---------- моделі техніки (бібліотека генератора) для брифінгу
    async loadObjects() {
      try { this.objects = (await API.call("objects", {}, this.pw)).objects; } catch (e) { this.objects = []; }
      this.objects.push({id: "builtin:catapult", name: "Катапульта з «Ланцетом» (вбудована)", type: "катапульта з БпЛА", length_m: 6.2, builtin: true});
      const sel = this.$("a-obj"), keep = sel.value;
      sel.innerHTML = `<option value="">— за типом —</option>` + this.objects.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("");
      sel.value = keep;
      this.showModel();
      if (this.stage()) this.renderTargets();
    },

    objById(id) { return (this.objects || []).find((o) => o.id === id) || null; },

    async showModel() {
      const $ = this.$, o = this.objById($("a-obj").value);
      $("a-model-box").hidden = !o;
      if (!o) return;
      $("a-model-meta").textContent = `${o.name} · ${o.type || "—"} · ≈${o.length_m} м`;
      $("a-ttx").value = Logic.ttxFor(o, o.type);
      $("a-mname").value = o.name;
      $("a-ttx").disabled = $("a-ttx-save").disabled = $("a-mname").disabled = !!o.builtin;
      $("a-ttx-st").textContent = o.builtin ? "вбудована модель — ТТХ типові" : "";
      const img = $("a-model-img");
      img.src = o.builtin ? Compose.catapultSprite().toDataURL() : (await API.objUrl(o.id, this.pw).catch(() => "")) || "";
    },

    async saveTtx() {
      const o = this.objById(this.$("a-obj").value), st = this.$("a-ttx-st");
      if (!o || o.builtin) return;
      o.ttx = this.$("a-ttx").value.trim();
      o.name = this.$("a-mname").value.trim() || o.name;
      try { await API.call("object_update", {id: o.id, name: o.name, length_m: o.length_m, type: o.type, ttx: o.ttx}, this.pw); st.textContent = "Збережено ✓"; st.className = "status ok"; this.loadObjects(); }
      catch (e) { st.textContent = e.message; st.className = "status no"; }
    },

    async deleteStage() {
      const s = this.stage();
      if (!s || !confirm(`Видалити етап «${s.title}» разом зі знімком?`)) return;
      clearTimeout(this.saveT); this.saveT = null;
      try { await API.call("delete_stage", {id: s.id}, this.pw); } catch (e) { UI.toast(e.message); return; }
      this.stages = this.stages.filter((x) => x.id !== s.id);
      this.sel = null; this.viewer.setImage(null); this.viewer.img = null; this.viewer.draw();
      this.renderList(); this.renderStage();
      if (this.stages.length) this.select(this.stages[0].id);
    },

    // ---------- теплова карта
    toggleHeat() {
      this.heatOn = !this.heatOn;
      this.$("a-heat").classList.toggle("primary", this.heatOn);
      if (this.heatOn) this.showHeat();
      else if (this.img) { this.viewer.replaceImage(this.img); this.renderTargets(); this.$("a-hint").textContent = "Теплову карту вимкнено."; }
    },

    async showHeat() {
      const s = this.stage();
      if (!s || !this.img) return;
      this.$("a-hint").textContent = "Завантажую кліки курсантів…";
      let j;
      try { j = await API.call("heat", {id: s.id}, this.pw); } catch (e) { this.$("a-hint").textContent = e.message; return; }
      if (!this.heatOn || this.sel !== s.id) return;
      const src = await Tiles.toCanvas(this.img);
      if (!this.heatOn || this.sel !== s.id) return;
      this.viewer.replaceImage(renderHeat(src, j.clicks, s.targets));
      const miss = j.clicks.filter((c) => !c[2]).length;
      this.$("a-hint").textContent = j.clicks.length
        ? `Кліків: ${j.clicks.length} · влучань: ${j.clicks.length - miss} · промахів: ${miss} · курсантів: ${j.players}. Червона пляма — де найчастіше помилково клікають.`
        : "По цьому етапу ще немає кліків курсантів.";
    },

    // ---------- налаштування
    async settings() {
      await this.flushSave();
      const box = this.$("a-settings");
      this.$("a-stage-box").hidden = true;
      box.hidden = false;
      box.innerHTML = `<h2>Налаштування</h2><p class="status">Завантажую…</p>`;
      let s;
      try { s = (await API.call("get_settings", {}, this.pw)).settings; } catch (e) { box.innerHTML = `<p class="status no">${esc(e.message)}</p>`; return; }
      const f = [["rounds_per_game", "Етапів у грі", "number"], ["time_limit_sec", "Секунд на етап", "number"],
        ["misses_allowed", "Дозволено промахів", "number"], ["grid_cols", "Квадратів по ширині", "number"],
        ["zoom_click", "Зум першого кліку", "number"], ["report", "Доповідь після влучання", "checkbox"],
        ["player_password", "Пароль курсантів", "text"], ["admin_password", "Пароль адмінки", "text"]];
      box.innerHTML = `<h2>Налаштування</h2><div class="kv">` + f.map(([k, l, t]) =>
        t === "checkbox" ? `<label for="st-${k}">${l}</label><input id="st-${k}" type="checkbox" ${String(s[k]).toUpperCase() !== "FALSE" ? "checked" : ""}>`
          : `<label for="st-${k}">${l}</label><input id="st-${k}" type="${t}" value="${esc(s[k])}">`).join("") +
        `</div><p class="status muted">Паролі — щонайменше 6 символів. Після зміни пароля курсантам потрібно ввести новий.</p>
        <div class="row"><button class="primary" type="button" id="st-save">Зберегти</button><button type="button" id="st-close">Закрити</button></div>
        <p class="status" id="st-status"></p>`;
      box.querySelector("#st-close").onclick = () => { box.hidden = true; this.renderStage(); };
      box.querySelector("#st-save").onclick = async () => {
        const vals = {};
        f.forEach(([k, , t]) => { const el = box.querySelector("#st-" + k); vals[k] = t === "checkbox" ? (el.checked ? "TRUE" : "FALSE") : el.value; });
        const out = box.querySelector("#st-status");
        try {
          await API.call("set_settings", {settings: vals}, this.pw);
          out.textContent = "Збережено ✓"; out.className = "status ok";
          if (vals.admin_password !== this.pw) { this.pw = vals.admin_password; SS.set("poshuk_admin_pw", this.pw); }
          this.cols = Number(vals.grid_cols) || 8;
          if (this.img) this.viewer.setGrid(this.cols);
        } catch (e) { out.textContent = e.message; out.className = "status no"; }
      };
    },
  };

  /* Теплова карта: знімок притемнений, промахи — жовто-червона «хмара», влучання — зелені точки, цілі — жовті кола. */
  function renderHeat(img, clicks, targets, sigma = 12) {
    const w = img.width, h = img.height;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, w, h), px = id.data;
    for (let i = 0; i < px.length; i += 4) {
      const g = (px[i] + px[i + 1] + px[i + 2]) / 3;
      px[i] = (px[i] * 0.45 + g * 0.55) * 0.75; px[i + 1] = (px[i + 1] * 0.45 + g * 0.55) * 0.75; px[i + 2] = (px[i + 2] * 0.45 + g * 0.55) * 0.75;
    }
    const misses = clicks.filter((c) => !c[2]);
    if (misses.length) {
      const d = new Float32Array(w * h), r = Math.ceil(3 * sigma);
      const k = [];
      for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) k.push(Math.exp(-(xx * xx + yy * yy) / (2 * sigma * sigma)));
      let mx = 0;
      for (const [cx, cy] of misses) {
        for (let yy = -r; yy <= r; yy++) {
          const y = Math.round(cy) + yy; if (y < 0 || y >= h) continue;
          for (let xx = -r; xx <= r; xx++) {
            const x = Math.round(cx) + xx; if (x < 0 || x >= w) continue;
            const v = (d[y * w + x] += k[(yy + r) * (2 * r + 1) + (xx + r)]);
            if (v > mx) mx = v;
          }
        }
      }
      for (let i = 0; i < d.length; i++) {
        if (!d[i]) continue;
        const v = d[i] / mx, a = Math.min(0.85, v * 1.1), j = i * 4;
        px[j] = px[j] * (1 - a) + 235 * a; px[j + 1] = px[j + 1] * (1 - a) + (200 - 160 * v) * a; px[j + 2] = px[j + 2] * (1 - a) + 40 * a;
      }
    }
    ctx.putImageData(id, 0, 0);
    for (const [x, y, hit] of clicks) {
      if (hit) { ctx.fillStyle = "#5fd38a"; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); }
      else { ctx.strokeStyle = "#ff5a46"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 2, y - 2); ctx.lineTo(x + 2, y + 2); ctx.moveTo(x - 2, y + 2); ctx.lineTo(x + 2, y - 2); ctx.stroke(); }
    }
    ctx.strokeStyle = "#c9d64a"; ctx.lineWidth = 2;
    for (const t of targets) { ctx.beginPath(); ctx.arc(t.x, t.y, t.r || 14, 0, 7); ctx.stroke(); }
    return cv;
  }

  window.Admin = Admin;
})();
