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

  // скільки силуету ховати під кронами; звичайні етапи — не більше 60%, понад — лише хардкор
  const LEVELS = {
    open: {name: "Відкрито", range: [0, 0.15], veg: 0.3},
    norm: {name: "Звичайні (сховано 20–60%)", range: [0.2, 0.6], veg: 0.6},
    hard: {name: "Хардкор (60–85%)", range: [0.6, 0.85], veg: 0.75},
  };

  const AutoGen = {
    async open(admin, onlyMap) {
      this.admin = admin; this.pw = admin.pw;
      this.onlyMap = onlyMap || null;
      if (onlyMap && this.state) this.state.maps = new Set([onlyMap]);
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
      const st = this.state = this.state || {maps: new Set(this.onlyMap ? [this.onlyMap] : maps.map((m) => m.id)), real: new Set(real.map((o) => o.id)), dec: new Set(dec.map((o) => o.id)),
        n: 5, tmin: 1, tmax: 2, dmin: 0, dmax: 1, level: "norm", tracks: true, cond: ""};
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

        <h3>Техніка <button type="button" class="link" id="ag-models">＋ PNG моделі…</button><input type="file" id="ag-mfile" accept="image/png,image/*" multiple hidden></h3>
        <div class="ag-grid">${real.map((o) => `<label class="chk"><input type="checkbox" data-real="${o.id}"${st.real.has(o.id) ? " checked" : ""}> ${esc(o.name.replace(/\s*\(вбудована\)$/, ""))}</label>`).join("")}</div>
        <h3>Муляжі</h3>
        <div class="ag-grid">${dec.map((o) => `<label class="chk"><input type="checkbox" data-dec="${o.id}"${st.dec.has(o.id) ? " checked" : ""}> ${esc(o.name)}</label>`).join("") || `<span class="muted small">Немає</span>`}</div>

        <h3>Параметри</h3>
        <div class="kv ag-kv">
          <label for="ag-n">Скільки етапів створити</label><input id="ag-n" type="number" min="1" max="50" value="${st.n}">
          <label>Справжніх цілей на етап</label><span class="rng"><select id="ag-tmin">${opt(1, 3, st.tmin)}</select>–<select id="ag-tmax">${opt(1, 3, st.tmax)}</select></span>
          <label>Муляжів на етап</label><span class="rng"><select id="ag-dmin">${opt(0, 3, st.dmin)}</select>–<select id="ag-dmax">${opt(0, 3, st.dmax)}</select></span>
        </div>
        <div class="seg-row"><span>Маскування</span><div class="seg" id="ag-hide">${Object.entries(LEVELS).map(([k, L]) => `<button type="button" data-h="${k}" class="${st.level === k ? "on" : ""}">${L.name}</button>`).join("")}</div></div>
        <div class="seg-row"><span>Умови</span><div class="seg" id="ag-cond">${[["", "☀ День"], ["winter", "❄ Зима"], ["thermal", "🌡 Тепловізор (ніч)"]].map(([k, n]) => `<button type="button" data-c="${k}" class="${(st.cond || "") === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
        <label class="chk"><input type="checkbox" id="ag-tracks"${st.tracks ? " checked" : ""}> Накатані сліди від дороги до техніки</label>
        <p class="muted small">Хардкор-етапи потрапляють лише в режим «Хардкор»; в інших режимах техніка сховано не більше ніж на 60%.</p>

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
      box.querySelectorAll("#ag-hide [data-h]").forEach((b) => (b.onclick = () => { st.level = b.dataset.h; this.render(); }));
      $("ag-tracks").onchange = () => { st.tracks = $("ag-tracks").checked; };
      box.querySelectorAll("#ag-cond [data-c]").forEach((b) => (b.onclick = () => { st.cond = b.dataset.c; this.render(); }));
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
      $("ag-models").onclick = () => $("ag-mfile").click();
      $("ag-mfile").onchange = async (e) => {
        const files = [...e.target.files]; if (!files.length) return;
        this.say(`Додаю моделі: ${files.length}… (фон прибирається сам; «Муляж …» у назві — муляж)`);
        const n = await Gen.importObjects(files, this.pw);
        await this.admin.loadObjects();
        this.models(false).forEach((o) => st.real.add(o.id)); this.models(true).forEach((o) => st.dec.add(o.id));
        this.render(); this.say(`Додано/оновлено моделей: ${n}.`, "ok");
      };
    },

    say(text, cls = "") { const s = $("ag-st"); if (s) { s.textContent = text; s.className = "status " + cls; } },

    async sprite(o) {
      if (this.sprites.has(o.id)) return this.sprites.get(o.id);
      let spr;
      if (o.builtin) spr = Models.sprite(o.id);
      else {
        const j = await API.call("object", {id: o.id}, this.pw);
        spr = Compose.prepareObject(await loadImg(`data:${j.mime || "image/png"};base64,${j.data}`));   // збережені моделі вже нормалізовані — тут лише прозорість/обрізка
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
      let sunDir = 135; try { sunDir = Compose.shadowDir(src); } catch (e) { /* типовий */ }
      // відстань (у клітинках) до дороги/ґрунтовки — техніку ставлять туди, куди можна заїхати
      const DR = new Float32Array(w * h).fill(1e9), q = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const W1 = w + 1, s9 = IB[(y + 2) * W1 + x + 2] - IB[(y - 1) * W1 + x + 2] - IB[(y + 2) * W1 + x - 1] + IB[(y - 1) * W1 + x - 1];
        if (s9 >= 6) { DR[y * w + x] = 0; q.push(y * w + x); }
      }
      for (let qi = 0; qi < q.length; qi++) {
        const i = q[qi], x = i % w;
        for (const j of [i - 1, i + 1, i - w, i + w]) { if (j < 0 || j >= w * h || (j % w === 0 && x === w - 1) || (x === 0 && j === i - 1)) continue; if (DR[j] > DR[i] + 1) { DR[j] = DR[i] + 1; q.push(j); } }
      }
      const d = {src, W, H, k, w, h, IV, IB, sunDir, DR};
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
    spot(d, size, placed, vegWant = 0.35) {
      const margin = Math.max(size * 1.4, 24), cand = [];
      const R = Math.max(2, 1.6 * size / d.k), r0 = Math.max(1, 0.45 * size / d.k);
      for (let i = 0; i < 700; i++) {
        const x = rnd(margin, d.W - margin), y = rnd(margin, d.H - margin);
        if (placed.some((p) => Math.hypot(p[0] - x, p[1] - y) < Math.max(size * 3, 60))) continue;
        const gx = x / d.k, gy = y / d.k;
        const veg = this.frac(d, d.IV, gx, gy, R), bare = this.frac(d, d.IB, gx, gy, r0 * 1.6), core = this.frac(d, d.IV, gx, gy, r0);
        // під'їзд: відстань до дороги в довжинах техніки; далі ніж ~12 корпусів у суцільний ліс — не реалістично
        const dr = d.DR[Math.round(gy) * d.w + Math.round(gx)] * d.k / size;
        const reach = dr < 1e8 ? Math.max(0, dr - 3) / 9 : 1.5;
        let s = 1 - Math.abs(veg - vegWant) * 2 - bare * 3 - (vegWant < 0.5 && core > 0.85 ? 0.5 : 0) - reach * 0.9 + Math.random() * 0.25;
        cand.push([s, x, y]);
      }
      if (!cand.length) return null;
      cand.sort((a, b) => b[0] - a[0]);
      const top = cand.slice(0, Math.max(1, Math.min(8, Math.ceil(cand.length * 0.03))));
      const c = pick(top);
      return [Math.round(c[1]), Math.round(c[2])];
    },

    /* Накати: від корми техніки — плавно до найближчої дороги/ґрунтовки (або просто назад, якщо дороги нема). */
    addTracks(cv, d, at, angle, size, gsd) {
      const [fx, fy] = [Math.sin(angle * Math.PI / 180), -Math.cos(angle * Math.PI / 180)];
      const gx = at[0] / d.k, gy = at[1] / d.k, maxR = Math.min(d.w, d.h) * 0.45;
      let road = null;
      for (let R = Math.max(3, size / d.k); R < maxR && !road; R += 2) {
        for (let a = 0; a < 360; a += 8) {
          const x = gx + Math.cos(a * Math.PI / 180) * R, y = gy + Math.sin(a * Math.PI / 180) * R;
          if (x < 2 || y < 2 || x > d.w - 3 || y > d.h - 3) continue;
          if (this.frac(d, d.IB, x, y, 1.5) > 0.6) { road = [x * d.k, y * d.k]; break; }
        }
      }
      const rear = [at[0] - fx * size * 0.45, at[1] - fy * size * 0.45];
      const back = [at[0] - fx * size * 1.6, at[1] - fy * size * 1.6];
      let end = road || [at[0] - fx * size * rnd(5, 9), at[1] - fy * size * rnd(5, 9)];
      if (road) {   // зупинитись на узбіччі, не заходячи на саму дорогу
        const vx = end[0] - back[0], vy = end[1] - back[1], vl = Math.hypot(vx, vy) || 1, cut = Math.min(vl * 0.5, 2.4 / gsd);
        end = [end[0] - vx / vl * cut, end[1] - vy / vl * cut];
      }
      const mid = [(back[0] + end[0]) / 2, (back[1] + end[1]) / 2], L = Math.hypot(end[0] - back[0], end[1] - back[1]) || 1;
      const nx = -(end[1] - back[1]) / L, ny = (end[0] - back[0]) / L, j = rnd(-0.18, 0.18) * L;
      const pts = [rear, back, [mid[0] + nx * j, mid[1] + ny * j], end];
      const g = 2.4 / gsd;
      Compose.tracks(cv, pts, {gauge: g, rut: Math.max(1.2, 0.5 / gsd), str: 0.5, seed: Math.round(at[0] + at[1])});
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
          // зима / тепловізор: техніка ставиться на перефарбовану копію, а крони для маскування беруться з кольорової
          const cond = st.cond || "";
          let tcv = null;
          if (cond) {
            this.say(`Етап ${i + 1}/${N}: «${m.title}» — ${cond === "winter" ? "засніжую" : "тепловізор"}…`);
            await new Promise((res) => setTimeout(res, 0));
            this.condCache = this.condCache || new Map();
            const key = m.id + ":" + cond;
            if (!this.condCache.has(key)) this.condCache.set(key, cond === "winter" ? Variants.winter(cv) : Variants.thermal(cv));
            const src0 = this.condCache.get(key);
            tcv = Compose.canvas(d.W, d.H); tcv.getContext("2d").drawImage(src0, 0, 0); tcv.t2g = src0.t2g;
          }
          const nT = rint(tmin, tmax), nD = dec.length ? rint(dmin, dmax) : 0;
          const items = [];
          const pool = real.slice().sort(() => Math.random() - 0.5);
          for (let t = 0; t < nT; t++) items.push({o: pool[t % pool.length], decoy: false});
          for (let t = 0; t < nD; t++) items.push({o: pick(dec), decoy: true});
          const L = LEVELS[st.level] || LEVELS.norm, placed = [], targets = [];
          const scratch = this.scratch && this.scratch.width === d.W && this.scratch.height === d.H ? this.scratch : (this.scratch = Compose.canvas(d.W, d.H));
          for (const it of items) {
            const size = Math.max(4, (it.o.length_m || 7) / m.gsd), spr = await this.sprite(it.o);
            const want = rnd(L.range[0], L.range[1]);
            // тон, колір, різкість, шум і тінь Compose підбирає сам під ділянку знімка
            const base = {size, shade: 0.25, shadow_dir: d.sunDir, shadow_len: Math.min(40, Math.max(2, 2.2 / m.gsd)), hideTarget: want};
            // кілька спроб місця: потрібна частка схованого силуету має бути досяжною (є крони поруч)
            let ok = null;
            for (let tries = 0; tries < 6 && !ok; tries++) {
              const at = this.spot(d, size, placed, L.veg);
              if (!at) break;
              // як у реальності: здебільшого паралельно краю посадки (±12°), інколи — довільно
              const edge = Math.random() < 0.65 ? Compose.alongEdge(cv, at[0], at[1], size) : null;
              const p = Object.assign({angle: edge === null ? Math.round(rnd(0, 359)) : Math.round((edge + (Math.random() < 0.5 ? 0 : 180) + rnd(-12, 12) + 360) % 360)}, base);
              const r = Compose.compose(cv, scratch, spr, at[0], at[1], p);
              const hid = r ? r.hidden : 0;
              const inRange = hid >= L.range[0] - 0.08 && hid <= L.range[1] + 0.03;
              if (inRange || tries === 5) ok = {at, p, hid};
            }
            if (!ok) continue;
            const {at, p, hid} = ok;
            if (st.level !== "hard" && hid > 0.62) continue;   // правило: поза хардкором — не більше 60%
            placed.push(at);
            if (tcv) {
              if (st.tracks && !it.decoy && cond === "winter") this.addTracks(tcv, d, at, p.angle, size, m.gsd);
              Variants.place(cond, tcv, cv, spr, it.o, {t: {x: at[0], y: at[1], type: it.o.name, decoy: it.decoy}, size, angle: p.angle, hide: p.hideTarget, slen: p.shadow_len, sun: d.sunDir});
            } else {
              if (st.tracks && !it.decoy) this.addTracks(cv, d, at, p.angle, size, m.gsd);
              Compose.compose(cv, cv, spr, at[0], at[1], p);
            }
            const type = Logic.typeOf(it.o.name.replace(/^муляж\s+/i, "").replace(/\s*\((вбудована|надувний)\)$/i, ""));
            targets.push(Object.assign({x: at[0], y: at[1], r: Math.max(8, Math.round(size * 0.6)), type, obj: it.o.id}, it.decoy ? {decoy: true} : {}, hid > 0.6 ? {hidden: Math.round(hid * 100) / 100} : {}));
          }
          if (!targets.some((t) => !t.decoy)) continue;
          const types = [...new Set(targets.filter((t) => !t.decoy).map((t) => t.type))].sort().join(", ");
          let title = `${m.title} · ${types}${targets.some((t) => t.decoy) ? " + муляжі" : ""}${cond ? (cond === "winter" ? " · Зима" : " · Тепловізор") : ""}`;
          for (let k = 2; A.stages.some((s) => s.title === title); k++) title = title.replace(/ #\d+$/, "") + ` #${k}`;
          this.say(`Етап ${i + 1}/${N}: зберігаю «${title}»…`);
          const stage = await API.uploadStage(tcv || cv, {title, targets, name: `auto_${Date.now()}`}, this.pw, (msg) => this.say(`Етап ${i + 1}/${N}: ${msg}`));
          const meta = {direction: Logic.region(m) || m.direction || "", season: cond === "winter" ? "Зима" : (m.season || ""), gsd: m.gsd, hard: st.level === "hard", cond};
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
