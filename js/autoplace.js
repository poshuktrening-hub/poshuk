/* Автонакладання (адмінка): вибрані моделі самі розставляються на карті так, як техніку ставлять насправді,
   і вбудовуються реалістично.
   Де ставить: рівні ділянки (поля, узбіччя, майданчики) біля посадок і крон — не на воді, не на дахах, не впритул
   до краю знімка; частину — під кронами (за вибраним рівнем маскування); техніка в групах стоїть паралельно
   (колона/стоянка), курс — уздовж посадки або дороги.
   Як малює: масштаб — з м/пкс карти і довжини машини; напрям тіні — як у тіней на самому знімку; довжина тіні —
   за висотою сонця (пора року × час доби) і висотою машини; світлотінь корпусу — під те саме сонце; ранок/вечір —
   тепліше світло; осінь/весна — пил і бруд на ходовій; зима — сніг на техніці й зимовий знімок; ніч — тепловізор.
   Результат — новий етап (карта не змінюється). */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.esc(s);
  const cv = (w, h) => Compose.canvas(w, h);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const HIDE = {open: ["Відкрито", [0, 0]], part: ["Частково", [0.15, 0.4]], crown: ["Під кронами", [0.45, 0.7]], mix: ["Змішано", null]};
  const DUST = {"Весна": 0.45, "Літо": 0.2, "Осінь": 0.55, "Зима": 0};

  /* Карта місцевості у зменшеному масштабі: рослинність, фактура, яскравість, вода, близькість до крон. */
  function analyze(base) {
    const W = base.width, H = base.height, k = Math.max(1, Math.max(W, H) / 900);
    const w = Math.round(W / k), h = Math.round(H / k), N = w * h;
    const c = cv(w, h), x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(base, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const L = new Float32Array(N), V = new Float32Array(N), Wt = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      V[i] = clamp((2 * g - r - b) / 60, 0, 1);
      Wt[i] = b > g + 4 && b > r + 10 && L[i] < 150 ? 1 : 0;   // вода: синювате й не яскраве
    }
    const Lb = Compose.gaussBlur(L, w, h, 1.5), T0 = new Float32Array(N);
    for (let i = 0; i < N; i++) T0[i] = Math.abs(L[i] - Lb[i]);
    const T = Compose.gaussBlur(T0, w, h, 3);                 // фактура: крони, кущі, забудова — високо; поля, дороги — низько
    const Vb = Compose.gaussBlur(V, w, h, 6);                  // «близькість» до зелені
    const Wb = Compose.gaussBlur(Wt, w, h, 3);
    const Lw = Compose.gaussBlur(L, w, h, 4);
    return {w, h, k, L: Lw, V, Vb, T, W: Wb};
  }
  /* Середнє карти m у колі радіуса r (у зменшеній сітці). */
  function mean(an, m, cx, cy, r) {
    let s = 0, n = 0;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(an.h - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(an.w - 1, Math.ceil(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue; s += m[y * an.w + x]; n++;
    }
    return n ? s / n : 0;
  }
  /* Оцінка місця для машини розміром sizePx з бажаним прихованням want (0…0.7). Менше — гірше; null — не можна. */
  function score(an, X, Y, sizePx, want, R) {
    const x = X / an.k, y = Y / an.k, r = Math.max(2, sizePx * 0.55 / an.k), m = sizePx * 1.3 / an.k;
    if (x < m || y < m || x > an.w - m || y > an.h - m) return null;
    const water = mean(an, an.W, x, y, r * 1.5); if (water > 0.15) return null;
    const veg = mean(an, an.V, x, y, r), tex = mean(an, an.T, x, y, r), lum = mean(an, an.L, x, y, r), near = mean(an, an.Vb, x, y, r * 3);
    if (lum > 205 && tex < 4) return null;                       // світлий рівний дах / бетон — не ставимо
    let s = 1;
    if (want < 0.1) { s -= veg * 1.6; s += clamp(near, 0, 0.5) * 0.9; }   // відкрито: поле, але поруч із посадкою (техніку ховають біля укриття)
    else { const t = clamp(want * 1.2, 0.2, 0.85); s -= Math.abs(veg - t) * 2.2; s += 0.3; }
    s -= clamp(tex / 12, 0, 1) * 0.8 * (want < 0.1 ? 1 : 0.3);  // рівна ділянка
    s -= Math.abs(lum - 120) / 400;                               // ні дуже темно (тінь, вода), ні дуже світло
    s += (R() - 0.5) * 0.25;                                       // трохи випадковості, щоб етапи не повторювались
    return s;
  }
  /* Розстановка n машин: кандидати по сітці + випадково, жадібний вибір найкращих з відстанню між машинами;
     частина — поруч із попередньою паралельно (колона/стоянка). Повертає [{x, y, angle, hide}]. */
  function layout(base, an, items, hideMode, R) {
    const out = [], W = base.width, H = base.height;
    const want = (i) => { const h = HIDE[hideMode] && HIDE[hideMode][1]; if (h) return h[0] + (h[1] - h[0]) * R(); const pick = [0, 0, 0.25, 0.55][Math.floor(R() * 4)]; return pick + (pick ? (R() - 0.5) * 0.2 : 0); };
    const heading = (x, y, size) => { let a = null; try { a = Compose.alongEdge(base, x, y, size); } catch (e) { a = null; } return a === null ? Math.floor(R() * 360) : Math.round((a + (R() < 0.5 ? 0 : 180)) % 360); };
    for (let i = 0; i < items.length; i++) {
      const it = items[i], size = it.size, hide = want(i), prev = out[out.length - 1];
      // група: з імовірністю 45 % — поруч із попередньою, паралельно (інтервал 1.5–2.6 довжини)
      if (prev && R() < 0.45 && Math.abs(prev.hide - hide) < 0.3) {
        for (let tr = 0; tr < 12; tr++) {
          const a = prev.angle * Math.PI / 180, side = R() < 0.5 ? -1 : 1, d = size * (1.5 + R() * 1.1), along = (R() - 0.5) * size * 0.6;
          const x = prev.x + Math.cos(a) * d * side + Math.sin(a) * along, y = prev.y + Math.sin(a) * d * side - Math.cos(a) * along;
          const sc = score(an, x, y, size, hide, R);
          if (sc !== null && sc > 0.1 && out.every((o) => Math.hypot(o.x - x, o.y - y) > size * 1.3)) { out.push({x, y, angle: (prev.angle + Math.round((R() - 0.5) * 16) + 360) % 360, hide, size, grp: true}); break; }
        }
        if (out.length === i + 1) continue;
      }
      let best = null;
      const tries = 900;
      for (let t = 0; t < tries; t++) {
        const x = size * 1.5 + R() * (W - size * 3), y = size * 1.5 + R() * (H - size * 3);
        if (out.some((o) => Math.hypot(o.x - x, o.y - y) < size * 3.5)) continue;
        const sc = score(an, x, y, size, hide, R);
        if (sc !== null && (!best || sc > best.sc)) best = {x, y, sc};
      }
      if (!best) { for (let t = 0; t < 200 && !best; t++) { const x = size * 1.5 + R() * (W - size * 3), y = size * 1.5 + R() * (H - size * 3); if (out.every((o) => Math.hypot(o.x - x, o.y - y) > size * 2)) best = {x, y, sc: 0}; } }
      if (!best) break;
      out.push({x: best.x, y: best.y, angle: heading(best.x, best.y, size), hide, size});
    }
    return out;
  }

  const AutoPlace = {
    async open(admin) {
      this.admin = admin; this.pw = admin.pw;
      if (!admin.objects) await admin.loadObjects();
      let box = $("ap");
      if (!box) { box = document.createElement("div"); box.id = "ap"; box.className = "modal"; document.body.appendChild(box); }
      box.hidden = false;
      this.sel = this.sel || new Set();
      this.result = null;
      this.render();
    },
    close() { $("ap").hidden = true; this.result = null; this.admin.renderList(); },
    maps() { return this.admin.stages.filter((s) => !s.targets.length && !s.cond); },
    models() { return (this.admin.objects || []).filter((o) => !o.decoy && !/^муляж/i.test(o.name || "")); },
    say(t, cls) { const e = $("ap-st"); if (e) { e.textContent = t; e.className = "status " + (cls || ""); } },

    render() {
      const maps = this.maps(), models = this.models();
      const sel = $("ap-map") ? $("ap-map").value : (this.admin.sel && maps.some((m) => m.id === this.admin.sel) ? this.admin.sel : maps[0] && maps[0].id);
      const keep = (id, dflt) => ($(id) ? $(id).value : dflt);
      const season = keep("ap-season", "auto"), time = keep("ap-time", "День"), n = keep("ap-n", "4"), hide = keep("ap-hide", "mix");
      const decoy = $("ap-decoy") ? $("ap-decoy").checked : false, tracks = $("ap-tracks") ? $("ap-tracks").checked : true;
      $("ap").innerHTML = `<div class="m-card ap-card">
        <div class="m-head"><h2>🤖 Автонакладання</h2><button type="button" class="link" id="ap-x">Закрити</button></div>
        <p class="muted small">Вибрані моделі самі стають на карту: рівні ділянки біля посадок, групами, уздовж краю; масштаб — з м/пкс карти, тінь — як на знімку й за висотою сонця (пора року × час доби), на техніці — пил/сніг. Створюється <b>новий етап</b>, карта не змінюється.</p>
        <div class="ap-grid">
          <label>Карта<select id="ap-map">${maps.map((m) => `<option value="${esc(m.id)}"${m.id === sel ? " selected" : ""}>${esc(m.title)}${m.gsd ? ` · ${m.gsd} м/пкс` : " · ⚠ без масштабу"}${m.season ? ` · ${esc(m.season)}` : ""}</option>`).join("") || `<option value="">— немає чистих карт (додайте в «＋ Карти») —</option>`}</select></label>
          <label>Пора року<select id="ap-season"><option value="auto"${season === "auto" ? " selected" : ""}>Як на карті</option>${Sun.SEASONS.map((s) => `<option${season === s ? " selected" : ""}>${s}</option>`).join("")}</select></label>
          <label>Час доби<select id="ap-time">${Sun.TIMES.map((t) => `<option value="${t}"${time === t ? " selected" : ""}>${t}${t === "Ніч" ? " (тепловізор)" : ""}</option>`).join("")}</select></label>
          <label>Скільки машин<select id="ap-n">${[1, 2, 3, 4, 5, 6, 8, 10].map((k) => `<option${String(k) === n ? " selected" : ""}>${k}</option>`).join("")}</select></label>
          <label>Маскування<select id="ap-hide">${Object.entries(HIDE).map(([k, [t]]) => `<option value="${k}"${hide === k ? " selected" : ""}>${t}</option>`).join("")}</select></label>
          <label class="chk ap-chk"><input type="checkbox" id="ap-decoy"${decoy ? " checked" : ""}> + муляж (надувний)</label>
          <label class="chk ap-chk"><input type="checkbox" id="ap-tracks"${tracks ? " checked" : ""}> накати позаду техніки</label>
        </div>
        <div class="rs-bar"><b>Моделі: вибрано ${[...this.sel].filter((id) => models.some((m) => m.id === id)).length} з ${models.length}</b><button type="button" class="link" id="ap-all">Вибрати всі</button><button type="button" class="link" id="ap-none">Зняти всі</button></div>
        <ul class="ag-list rs-list ap-models">${models.map((m) => `<li><label class="chk"><input type="checkbox" data-m="${esc(m.id)}"${this.sel.has(m.id) ? " checked" : ""}> ${esc(m.name)} <small class="muted">${Logic.lengthOf(m)} м</small></label></li>`).join("") || `<li class="muted">Немає моделей — додайте PNG у генераторі.</li>`}</ul>
        <p class="status" id="ap-st"></p>
        <div class="row"><button type="button" class="primary" id="ap-go">🎲 Розставити</button><button type="button" id="ap-save" disabled>Зберегти як етап</button></div>
        <div class="rs-prev" id="ap-prev" hidden></div>
      </div>`;
      $("ap-x").onclick = () => this.close();
      $("ap-all").onclick = () => { models.forEach((m) => this.sel.add(m.id)); this.render(); };
      $("ap-none").onclick = () => { this.sel.clear(); this.render(); };
      $("ap").querySelectorAll("[data-m]").forEach((c) => (c.onchange = () => { if (c.checked) this.sel.add(c.dataset.m); else this.sel.delete(c.dataset.m); $("ap").querySelector(".rs-bar b").textContent = `Моделі: вибрано ${this.sel.size} з ${models.length}`; }));
      $("ap-go").onclick = () => this.run();
      $("ap-save").onclick = () => this.save();
      $("ap-map").onchange = () => { this.result = null; $("ap-save").disabled = true; $("ap-prev").hidden = true; };
    },

    async sprite(o) { ReStage.pw = this.pw; return ReStage.sprite(o); },

    /* Побудова: карта → (зима/тепловізор) → розстановка → вбудовування. Повертає {canvas, targets, items, map}. */
    async build(onStep) {
      const map = this.admin.stages.find((s) => s.id === $("ap-map").value);
      if (!map) throw new Error("Виберіть карту");
      const gsd = Number(map.gsd) || 0;
      if (!gsd) throw new Error("У карти немає масштабу (м/пкс) — вкажіть його в картці етапу, інакше розмір техніки невідомий");
      const models = this.models().filter((m) => this.sel.has(m.id));
      if (!models.length) throw new Error("Виберіть хоча б одну модель");
      const season = $("ap-season").value === "auto" ? (map.season || "Літо") : $("ap-season").value;
      const time = $("ap-time").value, n = Number($("ap-n").value) || 4, hideMode = $("ap-hide").value;
      const wantDecoy = $("ap-decoy").checked, wantTracks = $("ap-tracks").checked;
      const night = time === "Ніч", winter = season === "Зима" && map.season !== "Зима";
      const seed = (Date.now() % 1e6) | 0, R = Compose.rng(seed);
      onStep("завантажую карту…");
      const clean = await Tiles.toCanvas(await API.loadImage(map.id, this.pw));
      const mp = clean.width * clean.height / 1e6;
      if (mp > 40 && !confirm(`Карта велика (${Math.round(mp)} Мпкс): обробка може тривати хвилину. Продовжити?`)) throw new Error("Скасовано");
      onStep("вивчаю місцевість…");
      await new Promise((r) => setTimeout(r, 0));
      let sun = 135; try { sun = Compose.shadowDir(clean); } catch (e) { /* типовий */ }
      const sp = Sun.forPreset(season, night ? "День" : time), an = analyze(clean);
      sp.elev = Math.max(8, sp.elev);   // взимку ввечері сонце вже за обрієм — беремо найнижче, що ще дає тінь
      // список машин: по колу з вибраних, поки не набереться n; муляж — копія однієї з них
      const items = [];
      for (let i = 0; i < n; i++) { const o = models[(i + Math.floor(R() * models.length)) % models.length]; items.push({o, size: clamp(Logic.lengthOf(o) / gsd, 3, 160)}); }
      if (wantDecoy) { const o = items[Math.floor(R() * items.length)].o; items.push({o, size: clamp(Logic.lengthOf(o) / gsd, 3, 160), decoy: true}); }
      onStep("шукаю місця…");
      await new Promise((r) => setTimeout(r, 0));
      const pos = layout(clean, an, items, hideMode, R);
      if (!pos.length) throw new Error("Не знайшов місця для техніки — карта надто мала або суцільна вода/забудова");
      // знімок за умовами
      let base = clean, vegBase = null;
      if (winter) { onStep("засніжую знімок…"); await new Promise((r) => setTimeout(r, 0)); base = Variants.winter(clean, seed); vegBase = clean; }
      if (night) { onStep("перетворюю на тепловізор…"); await new Promise((r) => setTimeout(r, 0)); base = Variants.thermal(winter ? base : clean, seed); vegBase = clean; }
      const targets = [], warm = Sun.warmth(time, sp.elev), dust = DUST[season] || 0;
      for (let i = 0; i < pos.length; i++) {
        const p = pos[i], it = items[i], o = it.o;
        onStep(`ставлю ${i + 1}/${pos.length}: ${o.name}…`);
        await new Promise((r) => setTimeout(r, 0));
        let spr = await this.sprite(o);
        if (it.decoy) spr = Models.inflate(spr);
        const hM = Sun.heightOf(o.name, Logic.lengthOf(o)), slen = Sun.shadowLen(it.decoy ? hM * 0.85 : hM, sp.elev, gsd);
        // накати: позаду машини вздовж курсу, з вигином; лише на відкритому й не для муляжів (їх привозять, не заганяють)
        if (wantTracks && !it.decoy && p.hide < 0.3 && !night && R() < 0.8) {
          try {
            const a = p.angle * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), L = Math.max(8, p.size), bend = (R() - 0.5) * 0.6, pts = [];
            for (let k = 0; k <= 7; k++) { const d = L * (0.25 + k * 0.7), b = bend * k * k * L * 0.05; pts.push([p.x - dx * d - dy * b, p.y - dy * d + dx * b]); }
            const g = Math.max(3, (season === "Зима" ? 2.4 : 2.6) / gsd);
            Compose.tracks(base, pts, {gauge: g, rut: g * 0.22, str: season === "Зима" ? 0.7 : 0.45, seed: seed + i});
          } catch (e) { /* без накатів */ }
        }
        const t = {x: Math.round(p.x), y: Math.round(p.y), r: Math.max(8, Math.round(p.size * 0.6)), type: Logic.typeOf(o.name), obj: o.id, ...(it.decoy ? {decoy: true} : {})};
        let res;
        if (night) res = Variants.place("thermal", base, vegBase, spr, Object.assign({}, o, it.decoy ? {decoy: true} : {}), {t, size: p.size, angle: p.angle, hide: p.hide, sun, slen});
        else {
          const prm = {size: p.size, angle: p.angle, hideTarget: p.hide, shade: 0.25, shadow_dir: sun, shadow_len: slen, sun_elev: sp.elev, warm, dust, vegBase, seed: seed + i * 7};
          if (season === "Зима") { spr = Variants.snowSprite(spr, seed + i); prm.bright = -0.12; prm.dust = 0; }
          res = Compose.compose(base, base, spr, p.x, p.y, prm);
        }
        if (res && res.hidden > 0.6) t.hidden = Math.round(res.hidden * 100) / 100;
        targets.push(t);
        items[i].pos = p;
      }
      return {canvas: base, before: clean, targets, items: items.slice(0, targets.length), map, season, time, night, winter, sun, elev: sp.elev};
    },

    async run() {
      if (this.busy) return;
      this.busy = true; $("ap-go").disabled = true; $("ap-save").disabled = true;
      try {
        const r = await this.build((m) => this.say(m));
        this.result = r;
        const box = $("ap-prev"); box.hidden = false;
        box.innerHTML = `<p class="muted small">Перегляд: ${r.targets.length} ціл${r.targets.length === 1 ? "ь" : r.targets.length < 5 ? "і" : "ей"} · ${esc(r.season)}, ${esc(r.time)} · сонце ${Math.round(r.elev)}°, тінь на ${r.sun}° · нічого не збережено. Не подобається — «Розставити» ще раз.</p>`;
        const k = Math.min(1, 860 / Math.max(r.canvas.width, r.canvas.height)), c = cv(r.canvas.width * k, r.canvas.height * k), x = c.getContext("2d");
        x.imageSmoothingQuality = "high"; x.drawImage(r.canvas, 0, 0, c.width, c.height);
        x.strokeStyle = "rgba(255,178,62,.9)"; x.lineWidth = 1.5;
        for (const t of r.targets) { x.beginPath(); x.arc(t.x * k, t.y * k, Math.max(5, t.r * k * 1.2), 0, Math.PI * 2); x.stroke(); }
        const f = document.createElement("figure"); f.appendChild(c); const cap = document.createElement("figcaption"); cap.textContent = "увесь знімок (кола — де стоїть техніка; у грі їх немає)"; f.appendChild(cap); box.appendChild(f);
        for (let i = 0; i < r.targets.length; i++) {
          const t = r.targets[i], it = r.items[i], Rr = Math.round(Math.max(40, it.size * 1.8));
          const cc = cv(2 * Rr, 2 * Rr); cc.getContext("2d").drawImage(r.canvas, t.x - Rr, t.y - Rr, 2 * Rr, 2 * Rr, 0, 0, 2 * Rr, 2 * Rr);
          const fg = document.createElement("figure"); fg.appendChild(cc); const cp = document.createElement("figcaption");
          cp.textContent = `${t.decoy ? "муляж · " : ""}${it.o.name} · ${it.pos.angle}°${t.hidden ? ` · сховано ${Math.round(t.hidden * 100)}%` : ""}${it.pos.grp ? " · у групі" : ""}`; fg.appendChild(cp); box.appendChild(fg);
        }
        this.say("Готово. Перегляньте й збережіть або розставте ще раз.", "ok");
        $("ap-save").disabled = false;
      } catch (e) { this.say("Не вдалось: " + e.message, "no"); }
      this.busy = false; $("ap-go").disabled = false;
    },

    async save() {
      const r = this.result; if (!r || this.busy) return;
      this.busy = true; $("ap-save").disabled = true;
      const A = this.admin;
      try {
        const types = [...new Set(r.targets.filter((t) => !t.decoy).map((t) => t.type))].sort().join(", ");
        let title = `${r.map.title} · ${types}${r.targets.some((t) => t.decoy) ? " + муляжі" : ""} · ${r.season}, ${r.time.toLowerCase()}`;
        for (let k = 2; A.stages.some((x) => x.title === title); k++) title = title.replace(/ #\d+$/, "") + ` #${k}`;
        const st = await API.uploadStage(r.canvas, {title, targets: r.targets, name: `auto_${Date.now()}`}, this.pw, (m) => this.say(`Зберігаю… ${m}`));
        const meta = {direction: r.map.direction || "", season: r.season, gsd: r.map.gsd || 0, hard: r.targets.some((t) => t.hidden > 0.6), src: r.map.id, cond: r.night ? "thermal" : r.winter ? "winter" : ""};
        A.stages.push(Object.assign(st, meta));
        try { await API.call("save_stage", Object.assign({id: st.id}, meta), this.pw); } catch (e) { this.say(`Етап створено, але мітки не записано: ${e.message}`, "no"); }
        A.sel = st.id;
        UI.toast(`Етап «${title}» збережено: цілей ${r.targets.length}.`);
        this.result = null; $("ap-prev").hidden = true;
        this.say(`Збережено «${title}». Можна розставити ще.`, "ok");
      } catch (e) { this.say("Не збережено: " + e.message, "no"); $("ap-save").disabled = false; }
      this.busy = false;
    },
  };

  window.AutoPlace = AutoPlace;
})();
