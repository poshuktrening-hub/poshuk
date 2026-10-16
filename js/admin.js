/* Адмінка (адреса сайту + #admin): знімки, цілі, ознаки, теплова карта, налаштування. */
(function () {
  const {LS, SS} = API;
  const esc = (s) => UI.esc(s);
  const C = {hit: "#3ddc97", accent: "#ffb23e"};

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
        <h1 class="logo"><svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="11" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M20 2v9M20 29v9M2 20h9M29 20h9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="20" cy="20" r="2.5" fill="currentColor"/></svg><span>Адмінка</span></h1>
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
      this.stages = j.stages; API.noteStages(j.stages);
      try { this.cols = Number((await API.call("get_settings", {}, this.pw)).settings.grid_cols) || 8; } catch (e) { this.cols = 8; }
    },

    // ---------- розмітка
    render() {
      const root = document.getElementById("s-admin");
      root.className = "screen admin";
      root.innerHTML = `
      <aside class="side">
        <div class="adm-head"><h2>Адмінка</h2><button type="button" class="iconbtn" id="a-settings-btn" title="Налаштування гри">⚙</button><button type="button" class="iconbtn" id="a-out" title="Вийти з адмінки">⎋</button></div>
        <div class="adm-actions">
          <button type="button" id="a-add" title="Знімки без техніки: масштаб, напрямок і пора року визначаються самі">＋ Карти</button>
          <button type="button" class="primary" id="a-gen" title="Поставити техніку вручну">✎ Генератор</button>
          <button type="button" id="a-variants" title="Зимові й нічні тепловізійні варіанти етапів">❄ Зима / 🌡 ТПВ</button>
          <button type="button" id="a-restage" title="Перемалювати техніку на вже створених етапах новою обробкою (з бекапом)">♻ Оновити етапи</button>
          <button type="button" id="a-cards" title="Фото для режиму «Картки цілей»">🃏 Картки</button>
          <button type="button" id="a-stats" title="Слабкі місця групи й кожного курсанта">📊 Аналітика</button>
          <button type="button" id="a-ref" title="Довідник техніки для курсантів">📘 Довідник</button>
        </div>
        <details class="usage" id="a-usage"><summary><span>Ліміти Cloudflare на добу</span><b id="a-usage-sum">…</b></summary><div id="a-usage-body"></div></details>
        <input type="file" id="a-file" accept="image/*" multiple hidden>
        <p class="status" id="a-up-status"></p>
        <section>
          <div class="tabs" id="a-tabs"><button type="button" data-t="stages" class="on">Етапи</button><button type="button" data-t="maps">Карти</button></div>
          <div class="row filters"><select id="a-filter-dir"><option value="">Усі напрямки</option></select><select id="a-filter-season"><option value="">Усі пори року</option><option>Літо</option><option>Зима</option></select></div>
          <ul class="list" id="a-stages"></ul>
        </section>
        <section id="a-stage-box" hidden>
          <input id="a-title" aria-label="Назва" class="title-in">
          <div class="kv3">
            <label>Напрямок<select id="a-dir"><option value="">—</option>${Logic.REGIONS.map((r) => `<option>${r}</option>`).join("")}</select></label>
            <label>Пора року<select id="a-season"><option value="">—</option><option>Літо</option><option>Зима</option></select></label>
            <label title="м на 1 піксель знімка — визначається сам">Масштаб<input id="a-gsd" type="number" min="0" max="10" step="0.01" placeholder="авто"></label>
          </div>
          <div class="row">
            <label class="chk" title="Техніка сховано понад 60% — етап іде лише в режим «Хардкор»"><input id="a-hard" type="checkbox"> Хардкор</label>
            <button type="button" id="a-toggle" style="flex:0"></button>
            <button type="button" class="danger" id="a-del" style="flex:0">Видалити</button>
          </div>
          <div id="a-tg-wrap">
            <h2>Цілі <small class="muted" id="a-thint"></small></h2>
            <ul class="list" id="a-targets"></ul>
            <div id="a-tedit" hidden>
              <div class="row">
                <select id="a-type" aria-label="Техніка" style="flex:1 1 140px"></select>
                <label class="chk" style="flex:0"><input id="a-decoy" type="checkbox"> Муляж</label>
                <button type="button" id="a-tdel" style="flex:0" title="Видалити ціль">✕</button>
              </div>
              <details id="a-model-box" class="model-box" hidden><summary><img id="a-model-img" alt=""><span class="status" id="a-model-meta"></span></summary>
                <div class="kv" style="margin-top:6px"><label for="a-mname">Назва моделі</label><input id="a-mname" maxlength="40" placeholder="Танк Т-72Б3"></div>
                <label for="a-ttx" style="margin:.4rem 0 .2rem">ТТХ (бачить курсант перед етапом)</label>
                <textarea id="a-ttx" rows="5"></textarea>
                <div class="row"><button type="button" id="a-ttx-save">Зберегти модель</button><span class="status" id="a-ttx-st"></span></div>
              </details>
            </div>
          </div>
          <details class="adv"><summary>Текст завдання на брифінгу</summary>
            <textarea id="a-task" rows="2" maxlength="400" placeholder="Порожньо — складеться сам: «Виявити … у районі …»"></textarea>
          </details>
          <p class="status" id="a-save-status"></p>
        </section>
        <section id="a-settings" hidden></section>
      </aside>
      <div class="mainpane">
        <div class="bar"><div class="hint" id="a-hint">«＋ Карти» → «✎ Генератор» — поставте техніку й збережіть етап. Клік по знімку — додати ціль вручну.</div>
          <button type="button" id="a-heat" title="Куди клікали курсанти">Теплова карта</button>
          <button type="button" onclick="location.hash='';location.reload()">До гри</button></div>
        <div class="view-wrap"><div id="a-view" class="view-host"></div>
          <div class="loading" id="a-loading" hidden><span>Завантажую…</span></div></div>
      </div>`;
      const $ = (id) => root.querySelector("#" + id);
      this.$ = $;
      this.viewer = new Viewer($("a-view"), {onLeft: (x, y) => this.click(x, y), onRight: (x, y) => this.rclick(x, y)});
      const g = this.viewer.addButton("#", "Сітка квадратів", () => { this.viewer.toggleGrid(); g.classList.toggle("on", this.viewer.showGrid); });

      $("a-out").onclick = () => { SS.del("poshuk_admin_pw"); location.reload(); };
      $("a-add").onclick = () => $("a-file").click();
      $("a-file").onchange = (e) => this.uploadFiles([...e.target.files]);
      this.tab = this.tab || "stages";
      $("a-tabs").querySelectorAll("button").forEach((b) => (b.onclick = () => { this.tab = b.dataset.t; this.renderList(); }));
      $("a-title").oninput = () => { this.stage().title = $("a-title").value; this.dirty(true); this.renderList(); };
      $("a-dir").onchange = () => { this.stage().direction = $("a-dir").value; this.dirty(true); this.renderList(); };
      $("a-hard").onchange = () => { this.stage().hard = $("a-hard").checked; this.dirty(true); this.renderList(); };
      $("a-gsd").oninput = () => { this.stage().gsd = Number($("a-gsd").value) || 0; this.dirty(true); };
      $("a-season").onchange = () => { this.stage().season = $("a-season").value; this.dirty(true); this.renderList(); };
      $("a-filter-dir").onchange = $("a-filter-season").onchange = () => this.renderList();
      $("a-task").oninput = () => { this.stage().task = $("a-task").value; this.dirty(true); };
      $("a-toggle").onclick = () => { const s = this.stage(); s.enabled = !s.enabled; this.dirty(true); this.renderStage(); };
      $("a-del").onclick = () => this.deleteStage();
      $("a-decoy").onchange = () => this.fieldChanged();
      $("a-type").onchange = () => this.fieldChanged();
      $("a-ttx-save").onclick = () => this.saveTtx();
      $("a-mname").oninput = () => {
        const o = this.objById(this.modelId), box = $("a-ttx");
        if (o && Logic.isAutoTtx(box.value)) box.value = Logic.ttxFor(null, Logic.typeOf($("a-mname").value.replace(/^муляж\s+/i, "")), !!o.decoy);
      };
      this.loadObjects();
      clearInterval(this.usageT); this.usage(); this.usageT = setInterval(() => { if (document.getElementById("a-usage")) this.usage(); else clearInterval(this.usageT); }, 5 * 60e3);
      $("a-tdel").onclick = () => this.deleteTarget(this.tsel);
      $("a-heat").onclick = () => this.toggleHeat();
      $("a-cards").onclick = () => CardsAdmin.open(this);
      if (!this._fixed) { this._fixed = true; setTimeout(() => CardsAdmin.autoFix(this), 3000); }
      $("a-stats").onclick = () => Analytics.open(this);
      $("a-ref").onclick = () => RefAdmin.open(this);
      $("a-variants").onclick = () => { this.heatOn = false; Variants.open(this); };
      $("a-restage").onclick = () => { this.heatOn = false; ReStage.open(this); };
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
      const fd = $("a-filter-dir"), keep = fd.value;
      fd.innerHTML = `<option value="">Усі напрямки</option>` + Logic.REGIONS.map((d) => `<option>${d}</option>`).join("") + `<option value="-">Без напрямку</option>`;
      fd.value = keep;
      const fs = $("a-filter-season").value;
      const reg = (s) => Logic.region(s) || "-";
      const isMap = (s) => !s.targets.length;   // карта = знімок без техніки
      const nM = this.stages.filter(isMap).length, nS = this.stages.length - nM;
      $("a-tabs").innerHTML = `<button type="button" data-t="stages" class="${this.tab !== "maps" ? "on" : ""}">Етапи <small>${nS}</small></button><button type="button" data-t="maps" class="${this.tab === "maps" ? "on" : ""}">Карти <small>${nM}</small></button>`;
      $("a-tabs").querySelectorAll("button").forEach((b) => (b.onclick = () => { this.tab = b.dataset.t; this.renderList(); }));
      const list = this.stages.filter((s) => (this.tab === "maps") === isMap(s) && (!fd.value || reg(s) === fd.value) && (!fs || s.season === fs));
      $("a-stages").innerHTML = list.map((s) =>
        `<li data-id="${s.id}" class="${s.id === this.sel ? "sel" : ""}"><span class="${s.enabled ? "" : "off"}">${s.enabled ? "✓" : "✗"} ${esc(s.title)}${Logic.region(s) || s.season || s.hard ? `<small class="tag">${esc([Logic.region(s), s.season, s.hard ? "хардкор" : ""].filter(Boolean).join(" · "))}</small>` : ""}</span>${s.targets.length ? `<span class="cnt">${s.targets.filter((t) => !t.decoy).length}${s.targets.some((t) => t.decoy) ? "+" + s.targets.filter((t) => t.decoy).length : ""}</span>` : `<span class="cnt">${s.gsd ? s.gsd + " м" : ""}</span>`}</li>`
      ).join("") || `<li class="muted">${this.tab === "maps" ? "Карт немає — «＋ Карти»" : this.stages.length ? "Нічого за фільтром" : "Етапів ще немає — додайте карти й поставте техніку в «✎ Генераторі»"}</li>`;
      $("a-stages").querySelectorAll("li[data-id]").forEach((li) => (li.onclick = () => this.select(li.dataset.id)));
    },

    async select(id) {
      await this.flushSave();
      this.sel = id; this.tsel = null;
      const s = this.stage();
      this.renderList(); this.renderStage();
      this.$("a-loading").hidden = false;
      try {
        this.img = await API.loadImage(id, this.pw);
      } catch (e) { if (this.$("a-loading")) this.$("a-loading").hidden = true; UI.toast(e.message); return; }
      if (!this.$("a-loading")) return;   // поки вантажилось — відкрили генератор
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
      $("a-dir").value = Logic.region(s);
      $("a-season").value = s.season || "";
      $("a-gsd").value = s.gsd || "";
      $("a-hard").checked = !!s.hard;
      $("a-task").value = s.task || "";
      $("a-toggle").textContent = s.enabled ? "Вимкнути" : "Увімкнути";
      const map = !s.targets.length;
      $("a-toggle").hidden = map;   // карта без цілей у гру не йде
      $("a-hard").parentElement.hidden = map;
      this.renderTargets();
    },

    renderTargets() {
      const s = this.stage(), $ = this.$;
      if (!s) return;
      if (this.tsel !== null && this.tsel >= s.targets.length) this.tsel = null;
      $("a-targets").innerHTML = s.targets.map((t, i) =>
        `<li data-i="${i}" class="${i === this.tsel ? "sel" : ""}">${t.decoy ? "◇" : "●"} ${t.obj && this.objById(t.obj) ? esc(this.objById(t.obj).name) : esc(t.type || "ціль")}${t.decoy ? " · муляж" : ""}${t.hidden ? ` <small class="muted">сховано ${Math.round(t.hidden * 100)}%</small>` : ""}</li>`
      ).join("") || `<li class="muted">Клікніть по техніці на знімку</li>`;
      $("a-targets").querySelectorAll("li[data-i]").forEach((li) => (li.onclick = () => this.selectTarget(Number(li.dataset.i), true)));
      $("a-thint").textContent = this.tsel === null ? "клік по знімку — нова; ПКМ — видалити" : `№${this.tsel + 1}: клік по знімку — перенести · Esc — готово`;
      $("a-tedit").hidden = this.tsel === null;
      const marks = s.targets.map((t, i) => ({x: t.x, y: t.y, r: t.r || 14, color: i === this.tsel ? C.accent : t.decoy ? "#b48cff" : C.hit, dashed: i === this.tsel || !!t.decoy, label: (t.decoy ? "муляж: " : "") + (t.type || "")}));
      this.viewer.setMarks(marks);
    },

    selectTarget(i, zoom) {
      this.tsel = i;
      const $ = this.$, s = this.stage();
      if (i !== null && s) {
        const t = s.targets[i];
        this.filling = true;
        this.typeOptions(t.type);
        $("a-type").value = t.type || "ціль";
        $("a-type").disabled = !!(t.obj && this.objById(t.obj));   // ціль з генератора: тип — від її моделі
        $("a-decoy").checked = !!t.decoy;
        this.modelId = t.obj || null;
        this.showModel();
        this.filling = false;
        if (zoom) this.viewer.zoomTo(6, t.x, t.y);
      } else { $("a-type").disabled = false; this.modelId = null; this.showModel(); }
      this.renderTargets();
    },

    fieldChanged() {
      if (this.filling || this.tsel === null) return;
      const t = this.stage().targets[this.tsel], $ = this.$;
      const mo = this.objById(t.obj);
      t.type = mo ? Logic.typeOf(mo.name.replace(/^муляж\s+/i, "")) : ($("a-type").value || "ціль");
      if (!mo) this.lastType = t.type;
      delete t.landmark;
      if ($("a-decoy").checked) t.decoy = true; else delete t.decoy;
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
        // радіус влучання — під реальний розмір техніки (≈7 м) за масштабом карти
        const r = s.gsd > 0 ? Math.max(8, Math.min(90, Math.round(3.5 / s.gsd))) : 14;
        const t = {x: Math.round(x), y: Math.round(y), r, type: this.lastType || "ціль"};
        s.targets.push(t);
        this.dirty(true); this.renderList(); this.renderStage();
        this.selectTarget(s.targets.length - 1);   // одразу вибрати тип
        return;
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
        await API.call("save_stage", {id: s.id, title: s.title, enabled: s.enabled, targets: s.targets, task: s.task || "", direction: s.direction || "", season: s.season || "", gsd: s.gsd || 0, hard: !!s.hard}, this.pw);
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
      let {img} = await this.readImage(file);
      const st = this.$("a-up-status"), prefix = st.textContent;
      // без цілей = чиста карта: обрізати білі/чорні поля довкола (скріншот слайда, підписи, клини)
      if (!(targets && targets.length)) { const c = Crop.auto(img); if (c) { img = c.canvas; this.cropped = (this.cropped || 0) + 1; } }
      const stage = await API.uploadStage(img, {title, targets, name: file.name.replace(/\.[^.]+$/, "")}, this.pw, (m) => (st.textContent = prefix + " " + m));
      // масштаб: з назви файлу або автоматично за шириною доріг
      let gsd = Scale.fromName(file.name.replace(/\.[^.]+$/, "")), how = "з назви";
      if (!gsd) { const e = Scale.estimate(img); if (e) { gsd = e.gsd; how = "авто"; } }
      if (gsd) { stage.gsd = gsd; stage.gsdHow = how; await API.call("save_stage", {id: stage.id, gsd}, this.pw).catch(() => {}); }
      this.stages.push(stage);
      return stage;
    },

    async uploadFiles(files) {
      const st = this.$("a-up-status"), skipped = [];
      this.cropped = 0;
      let last = null;
      for (let i = 0; i < files.length; i++) {
        st.textContent = `Завантажую ${i + 1}/${files.length}: ${files[i].name}…`;
        st.className = "status";
        try {
          // число масштабу в назві («… · 0.1») — не частина назви етапу
          const title = files[i].name.replace(/\.[^.]+$/, "").replace(/\s*[·|_-]?\s*\d+[.,]\d+\s*(м\/пкс|м|m\/px|m)?\s*$/i, "").trim() || files[i].name;
          // без дублів: така сама карта вже є — не завантажуємо вдруге
          if (this.stages.some((s) => s.title === title && !s.targets.length)) { skipped.push(title); continue; }
          last = await this.uploadOne(files[i], title);
          const parts = title.split(/\s*[·|_]\s*|\s+-\s+/).map((x) => x.trim());
          const season = parts.find((x) => /^(зима|літо)$/i.test(x));
          if (season) {
            last.season = season[0].toUpperCase() + season.slice(1).toLowerCase();
            const d = parts.find((x) => x && x !== season && !/^\d+$/.test(x)) || "";
            last.direction = Logic.regionOf(d) || d;
            await API.call("save_stage", {id: last.id, direction: last.direction, season: last.season}, this.pw);
          }
        } catch (e) { st.textContent = e.message; st.className = "status no"; return; }
      }
      const nAdd = files.length - skipped.length;
      const added = nAdd ? this.stages.slice(-nAdd) : [], noScale = added.filter((s) => !s.gsd).length;
      const sc = added.filter((s) => s.gsd).map((s) => `${s.gsd} (${s.gsdHow})`).join(", ");
      st.textContent = files.length ? `${skipped.length ? `Вже є, пропущено: ${skipped.join(", ")}. ` : ""}Додано: ${nAdd}.${this.cropped ? ` Обрізано поля: ${this.cropped}.` : ""}${sc ? " Масштаб, м/пкс: " + sc + "." : ""}${noScale ? ` Для ${noScale} масштаб не визначився (немає доріг) — впишіть вручну.` : ""}` : "";
      st.className = "status ok";
      this.$("a-file").value = "";
      if (nAdd) this.tab = "maps";
      this.renderList();
      if (last) this.select(last.id);
    },

    // ---------- моделі техніки (бібліотека генератора) для брифінгу
    async loadObjects() {
      try { this.objects = (await API.call("objects", {}, this.pw)).objects; } catch (e) { this.objects = []; }
      this.objects.push(...Models.LIST);
      this.typeOptions(this.$("a-type").value);
      this.showModel();
      if (this.stage()) this.renderTargets();
    },

    /* Список «Техніка»: типові типи + типи моделей з бібліотеки. */
    typeOptions(keep) {
      const sel = this.$("a-type"); if (!sel) return;
      const cur = keep || sel.value;
      const types = [...new Set([...Logic.TYPES, ...(this.objects || []).filter((o) => !o.decoy).map((o) => Logic.typeOf(o.name)), ...(this.stages || []).flatMap((s) => s.targets.map((t) => t.type)), cur].filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "uk"));
      sel.innerHTML = types.map((t) => `<option>${esc(t)}</option>`).join("");
      sel.value = cur && types.includes(cur) ? cur : types[0];
    },

    objById(id) { return (this.objects || []).find((o) => o.id === id) || null; },

    async showModel() {
      const $ = this.$, o = this.tsel === null ? null : this.objById(this.modelId);
      if (!$("a-model-box")) return;
      $("a-model-box").hidden = !o;
      if (!o) return;
      $("a-model-meta").textContent = `модель з генератора · тип: ${Logic.typeOf(o.name.replace(/^муляж\s+/i, ""))}${o.decoy ? " · муляж" : ""} · ≈${o.length_m} м`;
      $("a-ttx").value = Logic.ttxFor(o, o.type);
      $("a-mname").value = o.name;
      $("a-ttx").disabled = $("a-ttx-save").disabled = $("a-mname").disabled = !!o.builtin;
      $("a-ttx-st").textContent = o.builtin ? "вбудована модель — ТТХ типові" : "";
      const img = $("a-model-img");
      img.src = o.builtin ? Models.sprite(o.id).toDataURL() : (await API.objUrl(o.id, this.pw).catch(() => "")) || "";
    },

    async saveTtx() {
      const o = this.objById(this.modelId), st = this.$("a-ttx-st");
      if (!o || o.builtin) return;
      o.ttx = Logic.cleanTtx(this.$("a-ttx").value);
      o.name = this.$("a-mname").value.trim() || o.name;
      o.type = Logic.typeOf(o.name.replace(/^муляж\s+/i, ""));
      try { await API.call("object_update", {id: o.id, name: o.name, length_m: o.length_m, type: o.type, ttx: o.ttx, decoy: o.decoy ? 1 : 0}, this.pw); await this.loadObjects(); st.textContent = "Збережено ✓"; st.className = "status ok"; }
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

    // ---------- ліміти Cloudflare (безкоштовний тариф, добові; онулення о 00:00 UTC)
    async usage(fresh) {
      const box = this.$ && this.$("a-usage-body"); if (!box) return;
      let u;
      try { u = (await API.call("usage", {fresh: !!fresh}, this.pw)).usage; }
      catch (e) { this.$("a-usage-sum").textContent = "?"; box.innerHTML = `<p class="status no">${esc(e.message)}</p>`; return; }
      const L = u.limits || {}, rows = [
        ["requests", "Запити до сайту", (v) => fmt(v)], ["rowsRead", "Читання бази (рядки)", (v) => fmt(v)],
        ["rowsWritten", "Записи в базу (рядки)", (v) => fmt(v)], ["dbBytes", "Розмір бази", (v) => mb(v)]];
      function fmt(v) { return v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + " млн" : v >= 1e4 ? Math.round(v / 1e3) + " тис" : String(Math.round(v)); }
      function mb(v) { return Math.round(v / 1048576) + " МБ"; }
      let worst = null;
      const bars = rows.map(([k, name, f]) => {
        const v = u[k], lim = L[k];
        if (v == null || !lim) return `<div class="u-row off"><div class="u-h"><span>${name}</span><em>немає даних</em></div><div class="u-bar"><i style="width:0"></i></div></div>`;
        const p = Math.min(100, 100 * v / lim), left = Math.max(0, 100 - p), cls = left < 10 ? "bad" : left < 30 ? "warn" : "ok";
        if (!worst || left < worst.left) worst = {left, name};
        return `<div class="u-row ${cls}"><div class="u-h"><span>${name}</span><em>${f(v)} з ${f(lim)} · лишилось ${Math.floor(left)}%</em></div><div class="u-bar"><i style="width:${p.toFixed(1)}%"></i></div></div>`;
      }).join("");
      const h = Math.floor(u.resetIn / 3600e3), m = Math.round((u.resetIn % 3600e3) / 60e3);
      box.innerHTML = bars + `<p class="muted small">Онулення через ${h} год ${m} хв (о 00:00 UTC). Оновлено ${new Date(u.at).toLocaleTimeString("uk-UA", {hour: "2-digit", minute: "2-digit"})} · <a href="#" id="a-usage-re">оновити</a></p>` +
        (u.low && u.low.length ? `<p class="status no">⚠ Лишилось менше 10% — ${u.low.length > 1 ? "кількох лімітів" : "ліміту"} на сьогодні. Лист адміністратору надсилається автоматично.</p>` : "") +
        (!u.configured ? `<p class="status muted">Запити й рядки бази видно після підключення токена Cloudflare: Pages → Settings → Variables and Secrets — <b>CF_ACCOUNT_ID</b> і <b>CF_API_TOKEN</b> (право «Account Analytics: Read»).</p>` : "") +
        (u.errors && u.errors.length ? `<p class="status no small">${esc(u.errors.join(" · "))}</p>` : "");
      const sum = this.$("a-usage-sum");
      sum.textContent = worst ? `лишилось ${Math.floor(worst.left)}%` : "—";
      sum.className = worst ? (worst.left < 10 ? "bad" : worst.left < 30 ? "warn" : "ok") : "";
      if (worst && worst.left < 10) this.$("a-usage").open = true;
      const re = box.querySelector("#a-usage-re"); if (re) re.onclick = (e) => { e.preventDefault(); this.usage(true); };
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
      const f = [["rounds_per_game", "Етапів у грі (до 10)", "number"], ["time_limit_sec", "Секунд на етап", "number"],
        ["misses_allowed", "Дозволено промахів", "number"], ["grid_cols", "Квадратів по ширині", "number"],
        ["player_password", "Пароль курсантів", "text"], ["admin_password", "Пароль адмінки", "text"]];
      box.innerHTML = `<h2>Налаштування</h2><div class="kv">` + f.map(([k, l, t]) =>
        t === "checkbox" ? `<label for="st-${k}">${l}</label><input id="st-${k}" type="checkbox" ${String(s[k]).toUpperCase() !== "FALSE" ? "checked" : ""}>`
          : `<label for="st-${k}">${l}</label><input id="st-${k}" type="${t}" value="${esc(s[k])}">`).join("") +
        `</div><p class="status muted">Паролі — щонайменше 6 символів. Після зміни пароля курсантам потрібно ввести новий.</p>
        <div class="row"><button class="primary" type="button" id="st-save">Зберегти</button><button type="button" id="st-close">Закрити</button></div>
        <p class="status" id="st-status"></p>
        <h3>Історія гри</h3>
        <p class="status muted">Переносить усі поточні результати в архів: в аналітиці, топі меню й теплових картах вони більше не рахуються. Нічого не видаляється — у Google-таблиці рядки переїжджають на сусідній аркуш «Архів».</p>
        <div class="row"><button type="button" id="st-archive">📦 Перенести історію в архів</button></div>
        <p class="status" id="st-archive-status"></p>`;
      box.querySelector("#st-archive").onclick = async () => {
        const out = box.querySelector("#st-archive-status");
        if (!confirm("Перенести всю поточну історію гри в архів?\nАналітика й топ почнуться з нуля; архів лишиться в Google-таблиці.")) return;
        out.textContent = "Переношу…"; out.className = "status";
        try {
          const j = await API.call("archive_history", {}, this.pw);
          const d = j.archived || {}, sh = j.sheet;
          out.textContent = `В архіві ✓ Результатів: ${d.r || 0}, відповідей: ${d.a || 0}, кліків: ${d.c || 0}. ` +
            (!sh ? "Google-таблиця не підключена." : sh.ok ? `У таблиці перенесено рядків: ${sh.moved || 0} → аркуш «${sh.sheet || "Архів"}».` : `Таблиця: ${sh.error || "не вдалося перенести"}.`);
          out.className = sh && !sh.ok ? "status no" : "status ok";
        } catch (e) { out.textContent = e.message; out.className = "status no"; }
      };
      box.querySelector("#st-close").onclick = () => { box.hidden = true; this.renderStage(); };
      box.querySelector("#st-save").onclick = async () => {
        const vals = {};
        f.forEach(([k, , t]) => { const el = box.querySelector("#st-" + k); vals[k] = t === "checkbox" ? (el.checked ? "TRUE" : "FALSE") : el.value; });
        const out = box.querySelector("#st-status");
        try {
          const r = await API.call("set_settings", {settings: vals}, this.pw);
          out.textContent = "Збережено ✓" + (r.sheet ? (r.sheet.ok ? " Паролі оновлено й у Google-таблиці." : ` Але в Google-таблиці паролі не оновились (${r.sheet.error}) — змініть їх там вручну, інакше старий пароль з таблиці теж працюватиме.`) : "");
          out.className = "status " + (r.sheet && !r.sheet.ok ? "no" : "ok");
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
      if (hit) { ctx.fillStyle = "#3ddc97"; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); }
      else { ctx.strokeStyle = "#ff5a46"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 2, y - 2); ctx.lineTo(x + 2, y + 2); ctx.moveTo(x - 2, y + 2); ctx.lineTo(x + 2, y - 2); ctx.stroke(); }
    }
    ctx.strokeStyle = "#ffb23e"; ctx.lineWidth = 2;
    for (const t of targets) { ctx.beginPath(); ctx.arc(t.x, t.y, t.r || 14, 0, 7); ctx.stroke(); }
    return cv;
  }

  window.Admin = Admin;
})();
