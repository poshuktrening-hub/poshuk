/* Автогенератор етапів (адмінка): бере чисті карти (етапи без цілей) і бібліотеку моделей,
   сам розставляє техніку там, де її реально ставлять — біля посадок і крон, не на дорогах і дахах,
   з тінню й маскуванням — і зберігає готові етапи. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.esc(s);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function loadImg(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Не вдалось відкрити зображення")); i.src = src; });
  }

  const HIDE = {open: [0], part: [0.3], mix: [0, 0, 0.15, 0.3, 0.45]};

  const AutoGen = {
    async open(admin) {
      this.admin = admin; this.pw = admin.pw;
      await admin.flushSave();
      this.sprites = this.sprites || new Map();
      this.maps = new Map();
      let box = $("ag");
      if (!box) { box = document.createElement("div"); box.id = "ag"; box.className = "modal"; document.body.appendChild(box); }
      box.hidden = false;
      this.render();
    },

    close() { $("ag").hidden = true; this.admin.renderList(); },

    mapList() { return this.admin.stages.filter((s) => !s.targets.length); },
    models(decoy) { return (this.admin.objects || []).filter((o) => !!o.decoy === decoy); },

    render() {
      const maps = this.mapList(), real = this.models(false), dec = this.models(true);
      const st = this.state = this.state || {maps: new Set(maps.map((m) => m.id)), real: new Set(real.map((o) => o.id)), dec: new Set(dec.map((o) => o.id)),
        n: 5, tmin: 1, tmax: 2, dmin: 0, dmax: 1, hide: "mix"};
      const tag = (m) => [Logic.region(m), m.season].filter(Boolean).join(" · ");
      const opt = (a, b, v) => Array.from({length: b - a + 1}, (_, i) => a + i).map((x) => `<option${x === v ? " selected" : ""}>${x}</option>`).join("");
      $("ag").innerHTML = `<div class="m-card">
        <div class="m-head"><h2>Автогенератор етапів</h2><button type="button" class="link" id="ag-x">Закрити</button></div>
        <p class="muted small">Бере чисті карти й сам розставляє вибрану техніку: біля посадок і крон, не на дорогах і дахах, з тінню й маскуванням. Кожен запуск — нові місця й повороти.</p>

        <h3>Карти <small class="muted">— етапи без цілей</small></h3>
        <ul class="ag-list">${maps.map((m) => `<li><label class="chk"><input type="checkbox" data-map="${m.id}"${st.maps.has(m.id) ? " checked" : ""}> ${esc(m.title)}${tag(m) ? ` <small class="tag">${esc(tag(m))}</small>` : ""}</label>
          <span class="gsd"><input type="number" min="0.02" max="5" step="0.01" data-gsd="${m.id}" value="${m.gsd || ""}" placeholder="0.25"> м/пкс</span></li>`).join("") || `<li class="muted">Карт ще немає — додайте знімки без техніки.</li>`}</ul>
        <div class="row"><button type="button" id="ag-add">Додати карти…</button><input type="file" id="ag-file" accept="image/*" multiple hidden></div>
        <p class="muted small">Масштаб визначається сам (за шириною доріг) або з назви файлу: «Північ · Літо · 02 · 0.1». Його можна поправити тут. Назва файлу також задає напрямок і пору року.</p>

        <h3>Техніка</h3>
        <div class="ag-grid">${real.map((o) => `<label class="chk"><input type="checkbox" data-real="${o.id}"${st.real.has(o.id) ? " checked" : ""}> ${esc(o.name.replace(/\s*\(вбудована\)$/, ""))}</label>`).join("")}</div>
        <h3>Муляжі</h3>
        <div class="ag-grid">${dec.map((o) => `<label class="chk"><input type="checkbox" data-dec="${o.id}"${st.dec.has(o.id) ? " checked" : ""}> ${esc(o.name)}</label>`).join("") || `<span class="muted small">Немає</span>`}</div>

        <h3>Параметри</h3>
        <div class="kv ag-kv">
          <label for="ag-n">Скільки етапів створити</label><input id="ag-n" type="number" min="1" max="50" value="${st.n}">
          <label>Справжніх цілей на етап</label><span class="rng"><select id="ag-tmin">${opt(1, 3, st.tmin)}</select>–<select id="ag-tmax">${opt(1, 3, st.tmax)}</select></span>
          <label>Муляжів на етап</label><span class="rng"><select id="ag-dmin">${opt(0, 3, st.dmin)}</select>–<select id="ag-dmax">${opt(0, 3, st.dmax)}</select></span>
        </div>
        <div class="seg-row"><span>Маскування</span><div class="seg" id="ag-hide">${[["open", "Відкрито"], ["part", "Частково"], ["mix", "Різне"]].map(([k, l]) => `<button type="button" data-h="${k}" class="${st.hide === k ? "on" : ""}">${l}</button>`).join("")}</div></div>

        <div class="row m-foot"><button type="button" class="primary" id="ag-go">Згенерувати</button></div>
        <p class="status" id="ag-st" role="status"></p>
      </div>`;
      const box = $("ag");
      $("ag-x").onclick = () => this.close();
      box.onclick = (e) => { if (e.target === box && !this.busy) this.close(); };
      box.querySelectorAll("[data-map]").forEach((c) => (c.onchange = () => { c.checked ? st.maps.add(c.dataset.map) : st.maps.delete(c.dataset.map); }));
      box.querySelectorAll("[data-real]").forEach((c) => (c.onchange = () => { c.checked ? st.real.add(c.dataset.real) : st.real.delete(c.dataset.real); }));
      box.querySelectorAll("[data-dec]").forEach((c) => (c.onchange = () => { c.checked ? st.dec.add(c.dataset.dec) : st.dec.delete(c.dataset.dec); }));
      box.querySelectorAll("[data-gsd]").forEach((inp) => (inp.onchange = async () => {
        const m = this.admin.stages.find((s) => s.id === inp.dataset.gsd), v = Number(inp.value) || 0;
        if (!m) return; m.gsd = v;
        try { await API.call("save_stage", {id: m.id, gsd: v}, this.pw); } catch (e) { this.say(e.message, "no"); }
      }));
      box.querySelectorAll("#ag-hide [data-h]").forEach((b) => (b.onclick = () => { st.hide = b.dataset.h; this.render(); }));
      ["n", "tmin", "tmax", "dmin", "dmax"].forEach((k) => ($("ag-" + k).onchange = () => { st[k] = Number($("ag-" + k).value) || 0; }));
      $("ag-add").onclick = () => $("ag-file").click();
      $("ag-file").onchange = async (e) => {
        const files = [...e.target.files];
        if (!files.length) return;
        this.say(`Завантажую карти: ${files.length}…`);
        await this.admin.uploadFiles(files);
        this.mapList().forEach((m) => st.maps.add(m.id));
        this.render();
        this.say(`Додано карт: ${files.length}. Вкажіть їхній масштаб.`, "ok");
      };
      $("ag-go").onclick = () => this.run();
    },

    say(text, cls = "") { const s = $("ag-st"); if (s) { s.textContent = text; s.className = "status " + cls; } },

    async sprite(o) {
      if (this.sprites.has(o.id)) return this.sprites.get(o.id);
      let spr;
      if (o.builtin) spr = Models.sprite(o.id);
      else {
        const j = await API.call("object", {id: o.id}, this.pw);
        spr = Compose.prepareObject(await loadImg(`data:${j.mime || "image/png"};base64,${j.data}`));
      }
      this.sprites.set(o.id, spr);
      return spr;
    },

    /* Карта + аналіз місцевості (зменшена копія): рослинність і «голі» світлі поверхні (дороги, дахи). */
    async mapData(m) {
      if (this.maps.has(m.id)) return this.maps.get(m.id);
      const src = await Tiles.toCanvas(await API.loadImage(m.id, this.pw));
      const W = src.width, H = src.height, k = Math.max(1, Math.max(W, H) / 640);
      const w = Math.max(8, Math.round(W / k)), h = Math.max(8, Math.round(H / k));
      const sm = Compose.canvas(w, h), sx = sm.getContext("2d");
      sx.imageSmoothingQuality = "high"; sx.drawImage(src, 0, 0, w, h);
      const px = sx.getImageData(0, 0, w, h).data;
      // інтегральні суми: швидко рахувати частку рослинності/доріг у будь-якому вікні
      const IV = new Float64Array((w + 1) * (h + 1)), IB = new Float64Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) {
        let rv = 0, rb = 0;
        for (let x = 0; x < w; x++) {
          const j = (y * w + x) * 4, r = px[j], g = px[j + 1], b = px[j + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
          rv += (2 * g - r - b) / 255 > 0.1 && g > 45 ? 1 : 0;           // зелень
          rb += mx > 165 && sat < 0.2 ? 1 : 0;                            // світле й сіре: дорога, дах, бетон
          IV[(y + 1) * (w + 1) + x + 1] = IV[y * (w + 1) + x + 1] + rv;
          IB[(y + 1) * (w + 1) + x + 1] = IB[y * (w + 1) + x + 1] + rb;
        }
      }
      const d = {src, W, H, k, w, h, IV, IB};
      this.maps.set(m.id, d);
      return d;
    },

    frac(d, I, cx, cy, r) {
      const x0 = Math.max(0, Math.round(cx - r)), y0 = Math.max(0, Math.round(cy - r));
      const x1 = Math.min(d.w, Math.round(cx + r)), y1 = Math.min(d.h, Math.round(cy + r));
      const a = (x1 - x0) * (y1 - y0); if (a <= 0) return 0;
      const W = d.w + 1;
      return (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / a;
    },

    /* Місце для техніки: край посадки/крон (частка зелені довкола ~35%), не на дорозі/даху, не впритул до інших. */
    spot(d, size, placed) {
      const margin = Math.max(size * 1.4, 24), cand = [];
      const R = Math.max(2, 1.6 * size / d.k), r0 = Math.max(1, 0.45 * size / d.k);
      for (let i = 0; i < 700; i++) {
        const x = rnd(margin, d.W - margin), y = rnd(margin, d.H - margin);
        if (placed.some((p) => Math.hypot(p[0] - x, p[1] - y) < Math.max(size * 3, 60))) continue;
        const gx = x / d.k, gy = y / d.k;
        const veg = this.frac(d, d.IV, gx, gy, R), bare = this.frac(d, d.IB, gx, gy, r0 * 1.6), core = this.frac(d, d.IV, gx, gy, r0);
        let s = 1 - Math.abs(veg - 0.35) * 2 - bare * 3 - (core > 0.85 ? 0.5 : 0) + Math.random() * 0.25;
        cand.push([s, x, y]);
      }
      if (!cand.length) return null;
      cand.sort((a, b) => b[0] - a[0]);
      const top = cand.slice(0, Math.max(1, Math.min(8, Math.ceil(cand.length * 0.03))));
      const c = pick(top);
      return [Math.round(c[1]), Math.round(c[2])];
    },

    async run() {
      if (this.busy) return;
      const st = this.state, A = this.admin;
      const maps = this.mapList().filter((m) => st.maps.has(m.id));
      const real = this.models(false).filter((o) => st.real.has(o.id)), dec = this.models(true).filter((o) => st.dec.has(o.id));
      if (!maps.length) return this.say("Виберіть хоча б одну карту.", "no");
      // карти без масштабу — визначити автоматично (за шириною доріг)
      for (const m of maps.filter((x) => !(x.gsd > 0))) {
        this.say(`Визначаю масштаб «${m.title}»…`);
        const e = Scale.estimate((await this.mapData(m)).src);
        if (e) { m.gsd = e.gsd; await API.call("save_stage", {id: m.id, gsd: e.gsd}, this.pw).catch(() => {}); }
      }
      const noScale = maps.filter((m) => !(m.gsd > 0));
      if (noScale.length) { this.render(); return this.say(`Не вдалось визначити масштаб (немає доріг) — впишіть вручну: ${noScale.map((m) => m.title).join(", ")}.`, "no"); }
      if (!real.length) return this.say("Виберіть хоча б одну модель техніки.", "no");
      const N = Math.max(1, Math.min(50, st.n)), tmin = Math.min(st.tmin, st.tmax), tmax = Math.max(st.tmin, st.tmax);
      const dmin = Math.min(st.dmin, st.dmax), dmax = Math.max(st.dmin, st.dmax);
      this.busy = true; $("ag-go").disabled = true;
      let made = 0;
      const order = [];
      try {
        for (let i = 0; i < N; i++) {
          if (!order.length) order.push(...maps.slice().sort(() => Math.random() - 0.5));
          const m = order.shift();
          this.say(`Етап ${i + 1}/${N}: «${m.title}» — розставляю техніку…`);
          const d = await this.mapData(m);
          const cv = Compose.canvas(d.W, d.H), ctx = cv.getContext("2d");
          ctx.drawImage(d.src, 0, 0);
          const nT = rint(tmin, tmax), nD = dec.length ? rint(dmin, dmax) : 0;
          const items = [];
          const pool = real.slice().sort(() => Math.random() - 0.5);
          for (let t = 0; t < nT; t++) items.push({o: pool[t % pool.length], decoy: false});
          for (let t = 0; t < nD; t++) items.push({o: pick(dec), decoy: true});
          const shadowDir = rnd(110, 170), placed = [], targets = [];
          for (const it of items) {
            const size = Math.max(4, (it.o.length_m || 7) / m.gsd);
            const at = this.spot(d, size, placed);
            if (!at) continue;
            placed.push(at);
            const p = {size, angle: Math.round(rnd(0, 359)), hide: pick(HIDE[st.hide] || HIDE.mix), sharp: 0.7,
              shadow_dir: shadowDir, shadow_len: Math.max(1, Math.round(size * 0.08 * 2) / 2), shadow_op: 0.45,
              blend: 0.04, darken: 0, sat: 0.95};
            Compose.compose(cv, cv, await this.sprite(it.o), at[0], at[1], p);
            const type = Logic.typeOf(it.o.name.replace(/^муляж\s+/i, "").replace(/\s*\((вбудована|надувний)\)$/i, ""));
            targets.push(Object.assign({x: at[0], y: at[1], r: Math.max(8, Math.round(size * 0.6)), type, obj: it.o.id}, it.decoy ? {decoy: true} : {}));
          }
          if (!targets.some((t) => !t.decoy)) continue;
          const types = [...new Set(targets.filter((t) => !t.decoy).map((t) => t.type))].sort().join(", ");
          let title = `${m.title} · ${types}${targets.some((t) => t.decoy) ? " + муляжі" : ""}`;
          for (let k = 2; A.stages.some((s) => s.title === title); k++) title = title.replace(/ #\d+$/, "") + ` #${k}`;
          this.say(`Етап ${i + 1}/${N}: зберігаю «${title}»…`);
          const stage = await API.uploadStage(cv, {title, targets, name: `auto_${Date.now()}`}, this.pw, (msg) => this.say(`Етап ${i + 1}/${N}: ${msg}`));
          const meta = {direction: Logic.region(m) || m.direction || "", season: m.season || "", gsd: m.gsd};
          await API.call("save_stage", Object.assign({id: stage.id}, meta), this.pw).catch(() => {});
          A.stages.push(Object.assign(stage, meta));
          made++;
        }
        this.say(`Готово: створено етапів — ${made}. Вони вже ввімкнені й потрапляють у гру.`, "ok");
        A.renderList();
      } catch (e) {
        this.say(`Зупинено після ${made} етапів: ${e.message}`, "no");
      } finally { this.busy = false; const b = $("ag-go"); if (b) b.disabled = false; }
    },
  };

  window.AutoGen = AutoGen;
})();
