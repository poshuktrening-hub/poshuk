/* Умови зйомки: зимовий і нічний тепловізійний варіанти етапів.
   Зима: відкриті місця й дахи під снігом (рельєф і тіні лишаються), крони — голі сіро-бурі з присипкою, світло холодне;
         на техніці — сніг на горизонтальних поверхнях, тіні на снігу синюваті, накати — темні.
   Тепловізор (ніч, «біле — тепле»): трава холодна, крони й ґрунт тепліші, дороги/дахи ще тримають тепло;
         знімок мʼякший і шумніший; техніка тепла, двигун/вихлоп — найгарячіші, ходова тепла;
         муляжі холодні й без гарячих точок — так їх і відрізняють.
   Етап-варіант створюється новим (оригінал не змінюється): стара техніка прибирається, знімок перефарбовується,
   техніка ставиться заново в ті самі місця під тими самими кутами. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.esc(s);
  const cv = (w, h) => Compose.canvas(w, h);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* Сіра «карта» L у канвасі → розмиття засобами браузера (швидко навіть для великих знімків) → масив. */
  function grayCanvas(L, w, h) {
    const c = cv(w, h), x = c.getContext("2d"), id = x.createImageData(w, h), d = id.data;
    for (let i = 0; i < w * h; i++) { const v = clamp(L[i], 0, 255); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    x.putImageData(id, 0, 0); return c;
  }
  function blurArr(L, w, h, px) {
    const src = grayCanvas(L, w, h), c = cv(w, h), x = c.getContext("2d");
    x.filter = `blur(${px}px)`; x.drawImage(src, 0, 0); x.filter = "none";
    // краї: розмиття тягне чорне з-за меж — підмішуємо оригінал по периметру
    const d = x.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = d[i * 4];
    const m = Math.ceil(px * 2);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      if (xx >= m && xx < w - m && y >= m && y < h - m) continue;
      const i = y * w + xx; out[i] = L[i];
    }
    return out;
  }
  function chan(img) {
    const w = img.width, h = img.height, d = img.getContext("2d").getImageData(0, 0, w, h).data, N = w * h;
    const L = new Float32Array(N), V = new Float32Array(N), S = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      L[i] = lum(r, g, b); V[i] = clamp((2 * g - r - b) / 60, 0, 1); S[i] = mx ? (mx - mn) / mx : 0;
    }
    return {w, h, d, L, V, S, N};
  }
  /* Фактура: |L − розмите| → згладжене. Високе на кронах, кущах, руїнах; низьке на полях, дорогах, дахах. */
  function texture(L, w, h, k) {
    const b = blurArr(L, w, h, Math.max(1.2, 2 * k)), t = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) t[i] = Math.abs(L[i] - b[i]);
    return blurArr(t, w, h, Math.max(2, 4.5 * k));
  }
  const scaleK = (w, h) => clamp(Math.max(w, h) / 2400, 0.6, 2.5);   // підлаштування радіусів під роздільність

  // ---------------------------------------------------------------- зима
  function winter(src, seed = 7) {
    const {w, h, d, L, V, N} = chan(src), k = scaleK(w, h);
    const T = texture(L, w, h, k), Lb2 = blurArr(L, w, h, 1.5 * k), Lb15 = blurArr(L, w, h, 18 * k);
    const R = rng(seed), noise = new Float32Array(N); for (let i = 0; i < N; i++) noise[i] = R() * 255;
    const nz = blurArr(noise, w, h, 1.2 * k);
    const out = cv(w, h), x = out.getContext("2d"), id = x.createImageData(w, h), o = id.data;
    for (let i = 0; i < N; i++) {
      const j = i * 4, l = L[i], tx = clamp(T[i] / 16, 0, 1), dark = clamp((75 - l) / 55, 0, 1);
      const shade = clamp(l / Math.max(20, Lb15[i]), 0.35, 1.35);
      // скільки снігу: рівні місця — повністю, крони/кущі (фактура, зелень) і дуже темне — мало
      const crown = clamp(tx * 1.15 * (0.3 + V[i]) + dark * 0.5 - 0.08, 0, 1);
      const sn = clamp(1 - crown, 0, 1);
      const det = (l - Lb2[i]) * 0.35;
      const sl = clamp(240 * Math.pow(shade, 0.8), 70, 252) + det;
      const blue = shade < 0.85 ? (0.85 - shade) * 40 : 0;   // тінь на снігу — синювата
      const snR = sl - 4 - blue * 0.6, snG = sl - blue * 0.2, snB = sl + 5 + blue * 0.3;
      // голі крони: сіро-бурі гілки + трохи снігу між ними
      const gray = l * 0.78 + 10, sp = clamp((nz[i] / 255 - 0.45) * 3, 0, 1) * 0.45;
      const trR = gray * 1.04 + 4, trG = gray * 0.98 + 2, trB = gray * 0.94;
      const tR = trR + (snR - trR) * sp, tG = trG + (snG - trG) * sp, tB = trB + (snB - trB) * sp;
      o[j] = tR + (snR - tR) * sn; o[j + 1] = tG + (snG - tG) * sn; o[j + 2] = tB + (snB - tB) * sn; o[j + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    return out;
  }

  /* Сніг на техніці: на рівних «дахових» місцях (подалі від країв), плямами. */
  function snowSprite(spr, seed = 3) {
    const w = spr.width, h = spr.height, c = cv(w, h), x = c.getContext("2d");
    x.drawImage(spr, 0, 0);
    const id = x.getImageData(0, 0, w, h), d = id.data, N = w * h, A = new Float32Array(N);
    for (let i = 0; i < N; i++) A[i] = d[i * 4 + 3];
    const inner = blurArr(A, w, h, Math.max(1.5, Math.max(w, h) * 0.03));
    const R = rng(seed), nb = new Float32Array(N); for (let i = 0; i < N; i++) nb[i] = R() * 255;
    const n1 = blurArr(nb, w, h, Math.max(1.5, Math.max(w, h) * 0.02));
    for (let i = 0; i < N; i++) {
      if (!d[i * 4 + 3]) continue;
      const j = i * 4, flat = clamp((inner[i] / 255 - 0.75) * 4, 0, 1), m = clamp((n1[i] - 118) / 14, 0, 1) * flat * 0.55;
      d[j] += (236 - d[j]) * m; d[j + 1] += (239 - d[j + 1]) * m; d[j + 2] += (245 - d[j + 2]) * m;
    }
    x.putImageData(id, 0, 0);
    return c;
  }

  // ---------------------------------------------------------------- тепловізор
  // «температура» → яскравість (біле — тепле). Автопідсилення як у тепловізора: діапазон місцевості — у 20…205,
  // гарячіше (двигуни) — у пересвіт. Та сама шкала і для техніки (base.t2g).
  const mkT2G = (lo, hi) => (t) => clamp((t * 255 - lo) / Math.max(8, hi - lo) * 185 + 20, 0, 255);
  const T2G = mkT2G(0.18 * 255, 0.62 * 255);
  function thermal(src, seed = 11) {
    const {w, h, d, L, V, S, N} = chan(src), k = scaleK(w, h);
    const T = texture(L, w, h, k), Lb15 = blurArr(L, w, h, 18 * k);
    const t = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const tx = clamp(T[i] / 16, 0, 1), v = V[i], l = L[i];
      const road = (1 - v) * clamp((l - 125) / 50, 0, 1) * clamp((0.22 - S[i]) / 0.12, 0, 1);
      t[i] = (0.30 + 0.12 * (1 - v) + 0.17 * v * tx + 0.11 * road + 0.05 * clamp((l - Lb15[i]) / 60, -1, 1)) * 255;
    }
    const tb = blurArr(t, w, h, 1.4 * k);   // тепловізор мʼякший за оптику
    const hist = new Uint32Array(256); for (let i = 0; i < N; i += 3) hist[clamp(tb[i] | 0, 0, 255)]++;
    const pc = (q) => { let s2 = 0; const lim = hist.reduce((a, b) => a + b, 0) * q; for (let i = 0; i < 256; i++) { s2 += hist[i]; if (s2 >= lim) return i; } return 255; };
    const t2g = mkT2G(pc(0.01), pc(0.99));
    const R = rng(seed), out = cv(w, h), x = out.getContext("2d"), id = x.createImageData(w, h), o = id.data;
    out.t2g = t2g;
    const cx = w / 2, cy = h / 2, rr = Math.hypot(cx, cy);
    for (let i = 0; i < N; i++) {
      const xx = i % w, yy = (i - xx) / w, vig = 1 - 0.12 * (Math.hypot(xx - cx, yy - cy) / rr) ** 2;
      const g = clamp(t2g(tb[i] / 255) * vig + (R() - 0.5) * 7, 0, 255);
      o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = g; o[i * 4 + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    return out;
  }

  /* Тип теплової картини за назвою: де двигун. Вантажівки/колісні (РСЗВ, РЛС, РЕБ, вантажівки) — спереду,
     гусеничні (танки, БМП, САУ, ЗРК на гусеницях) — ззаду; катапульта — майже холодна, лише генератор. */
  function heatKind(name) {
    const n = String(name || "").toLowerCase();
    if (/катапульт|ланцет/.test(n)) return "cold";
    if (/рсзв|град|ураган|торнадо|смерч|урал|камаз|вантаж|рлс|реб|красух|бтр|брдм|тигр|панцир|п-2|р-1|машина зв/.test(n)) return "front";
    return "rear";
  }
  function thermalSprite(spr, kind, decoy, seed = 5, t2g = T2G) {
    const w = spr.width, h = spr.height, c = cv(w, h), x = c.getContext("2d");
    x.drawImage(spr, 0, 0);
    const id = x.getImageData(0, 0, w, h), d = id.data, N = w * h;
    const R = rng(seed), A = new Float32Array(N), Lm = new Float32Array(N);
    for (let i = 0; i < N; i++) { A[i] = d[i * 4 + 3]; Lm[i] = lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); }
    const inner = blurArr(A, w, h, Math.max(1, Math.max(w, h) * 0.02));
    // одразу в яскравості (шкала тепловізора: місцевість ≈ 20…205): корпус трохи тепліший за найтепліше довкола,
    // двигун і вихлоп — у пересвіт; муляж — холодний, як повітря вночі
    const ey = kind === "front" ? 0.2 : 0.8, er = Math.min(w, h) * 0.32;
    for (let i = 0; i < N; i++) {
      if (!d[i * 4 + 3]) continue;
      const xx = i % w, yy = (i - xx) / w, fx = xx / w, fy = yy / h, tex = Lm[i] / 255 - 0.5;
      let g;
      if (decoy) g = 78 + 18 * tex + (R() - 0.5) * 3;
      else if (kind === "cold") g = 120 + 20 * tex + 110 * Math.exp(-(((fx - 0.5) * w) ** 2 + ((fy - 0.92) * h) ** 2) / (2 * (er * 0.4) ** 2));
      else {
        const eng = Math.exp(-(((fx - 0.5) * w) ** 2 + ((fy - ey) * h) ** 2) / (2 * er * er));
        const exh = Math.exp(-(((fx - 0.78) * w) ** 2 + ((fy - (kind === "front" ? 0.3 : 0.93)) * h) ** 2) / (2 * (er * 0.25) ** 2));
        const run = Math.max(Math.exp(-((fx - 0.08) ** 2) / 0.004), Math.exp(-((fx - 0.92) ** 2) / 0.004));   // ходова/колеса
        g = 168 + 28 * tex + 85 * eng + 95 * exh + 22 * run;
      }
      g -= 22 * (1 - inner[i] / 255);   // краї трохи холодніші
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = clamp(g, 0, 255);
    }
    x.putImageData(id, 0, 0);
    return c;
  }
  /* Нагріта земля під/за двигуном (техніка стояла з працюючим двигуном). */
  function warmGround(base, cx, cy, size, angle, kind) {
    if (kind === "cold") return;
    const a = angle * Math.PI / 180, fx = Math.sin(a), fy = -Math.cos(a), off = (kind === "front" ? 0.25 : -0.55) * size;
    const x = base.getContext("2d"), px = cx + fx * off, py = cy + fy * off, r = size * 0.55;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, "rgba(255,255,255,0.22)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.save(); x.globalCompositeOperation = "lighter"; x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill(); x.restore();
  }

  /* Поставити техніку на перефарбований знімок. vegBase — кольоровий знімок (де крони), щоб маскування працювало й узимку/вночі. */
  function place(mode, base, vegBase, spr, o, it) {
    const name = (o && o.name) || it.t.type || "", decoy = !!it.t.decoy || !!(o && o.decoy);
    const p = {size: it.size, angle: it.angle, hideTarget: it.hide, shade: 0.25, shadow_dir: it.sun, shadow_len: it.slen, vegBase, seed: Math.round(it.t.x + it.t.y)};
    if (mode === "winter") return Compose.compose(base, base, snowSprite(spr, Math.round(it.t.x)), it.t.x, it.t.y, Object.assign(p, {bright: -0.12}));   // на снігу техніка — темна пляма
    const kind = heatKind(name);
    if (!decoy) warmGround(base, it.t.x, it.t.y, it.size, it.angle, kind);
    return Compose.compose(base, base, thermalSprite(spr, kind, decoy, Math.round(it.t.y), base.t2g || T2G), it.t.x, it.t.y, Object.assign(p, {raw: true, shade: 0, shadow_len: 0, blurFix: 1.7 * scaleK(base.width, base.height)}));
  }

  // ---------------------------------------------------------------- адмінка
  const MODES = {winter: {name: "❄ Зима", suffix: "Зима"}, thermal: {name: "🌡 Тепловізор", suffix: "Тепловізор"}};

  const Variants = {
    winter, thermal, snowSprite, thermalSprite, heatKind, place,

    async open(admin) {
      this.admin = admin; this.pw = admin.pw;
      await admin.flushSave();
      if (!admin.objects) await admin.loadObjects();
      ReStage.admin = admin; ReStage.pw = admin.pw;
      let box = $("vr");
      if (!box) { box = document.createElement("div"); box.id = "vr"; box.className = "modal"; document.body.appendChild(box); }
      box.hidden = false;
      this.mode = this.mode || "winter";
      this.sel = this.sel || new Set();
      this.render();
    },
    close() { $("vr").hidden = true; this.admin.renderList(); },
    list() { return ReStage.list().filter((x) => x.ok); },
    has(s, mode) { return this.admin.stages.some((x) => x.cond === mode && (x.of === s.id || x.title.startsWith(s.title + " · "))); },

    render() {
      const L = this.list();
      $("vr").innerHTML = `<div class="m-card">
        <div class="m-head"><h2>❄ 🌡 Зима й тепловізор</h2><button type="button" class="link" id="vr-x">Закрити</button></div>
        <p class="muted small">З вибраних етапів створюються <b>нові</b> етапи-варіанти: знімок перефарбовується під зиму або нічний тепловізор, техніка ставиться заново в ті самі місця. Оригінали не змінюються.</p>
        <div class="seg" id="vr-mode">${Object.entries(MODES).map(([k, m]) => `<button type="button" data-m="${k}" class="${this.mode === k ? "on" : ""}">${m.name}</button>`).join("")}</div>
        <p class="muted small">${this.mode === "thermal" ? "Тепловізор (ніч, біле — тепле): техніка світиться, найгарячіші — двигун і вихлоп; муляжі холодні — так їх і вчаться відрізняти." : "Зима: поля й дахи під снігом, крони голі, тіні синюваті; на техніці — сніг, накати темні. Етап позначається порою «Зима»."}</p>
        <div class="rs-bar"><b>Доступно: ${L.length}</b><button type="button" class="link" id="vr-all">Вибрати всі</button><button type="button" class="link" id="vr-none">Зняти всі</button></div>
        <ul class="ag-list rs-list">${L.map(({s}) => `<li><label class="chk"><input type="checkbox" data-s="${s.id}"${this.sel.has(s.id) ? " checked" : ""}> ${esc(s.title)}${this.has(s, this.mode) ? ' <small class="tag ok">вже є</small>' : ""}</label>
          <span class="rs-btns"><button type="button" class="link" data-prev="${s.id}">👁 Переглянути</button></span></li>`).join("") || `<li class="muted">Немає етапів, зроблених з карт адмінки.</li>`}</ul>
        <div class="rs-prev" id="vr-prev" hidden></div>
        <div class="row m-foot"><button type="button" class="primary" id="vr-go">Створити варіанти</button></div>
        <p class="status" id="vr-st" role="status"></p></div>`;
      const box = $("vr");
      $("vr-x").onclick = () => this.close();
      box.onclick = (e) => { if (e.target === box && !this.busy) this.close(); };
      box.querySelectorAll("#vr-mode [data-m]").forEach((b) => (b.onclick = () => { this.mode = b.dataset.m; this.render(); }));
      box.querySelectorAll("[data-s]").forEach((c) => (c.onchange = () => { c.checked ? this.sel.add(c.dataset.s) : this.sel.delete(c.dataset.s); }));
      $("vr-all").onclick = () => { this.sel = new Set(L.map((x) => x.s.id)); this.render(); };
      $("vr-none").onclick = () => { this.sel = new Set(); this.render(); };
      box.querySelectorAll("[data-prev]").forEach((b) => (b.onclick = () => this.preview(b.dataset.prev)));
      $("vr-go").onclick = () => this.run();
    },
    say(t, cls = "") { const s = $("vr-st"); if (s) { s.textContent = t; s.className = "status " + cls; } },

    /* Варіант етапу в памʼяті: прибрати стару техніку → перефарбувати → поставити техніку знову. */
    async build(s, mode, onStep) {
      const map = ReStage.sourceMap(s);
      if (!map) throw new Error("немає карти-джерела");
      const old = await Tiles.toCanvas(await API.loadImage(s.id, this.pw)), clean = await Tiles.toCanvas(await API.loadImage(map.id, this.pw));
      if (old.width !== clean.width || old.height !== clean.height) throw new Error("розмір карти не збігається");
      const work = cv(old.width, old.height); work.getContext("2d").drawImage(old, 0, 0);
      const gsd = s.gsd || map.gsd || 0;
      let sun = 135; try { sun = Compose.shadowDir(clean); } catch (e) { /* типовий */ }
      const items = [], targets = s.targets.map((t) => Object.assign({}, t));
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i], o = t.obj && ReStage.obj(t.obj);
        if (!o) continue;
        if (onStep) onStep(`ціль ${i + 1}/${targets.length}: шукаю, як стояла…`);
        const spr = await ReStage.sprite(o);
        const size = Math.max(3, Math.min(160, t.r > 8 ? t.r / 0.6 : gsd > 0 ? Logic.lengthOf(o) / gsd : 16));
        const slen = gsd > 0 ? Math.min(40, Math.max(2, 2.2 / gsd)) : Math.max(2, size * 0.3);
        const r = await ReStage.redo(work, clean, spr, t, size, slen, sun, {removeOnly: true});
        if (r) items.push({t, o, spr, size: r.size, angle: r.angle, hide: r.hide, slen, sun});
        await new Promise((res) => setTimeout(res, 0));
      }
      // дуже велика карта: обробка тримає в пам'яті ~десяток повнорозмірних масивів — на слабкому ноутбуці вкладка може впасти
      const mp = work.width * work.height / 1e6;
      if (mp > 40 && !confirm(`Карта велика (${Math.round(mp)} Мпкс): обробка займе ~${Math.round(mp * 0.06)} ГБ пам'яті й може тривати хвилину. Закрийте інші вкладки. Продовжити?`)) throw new Error("Скасовано");
      if (onStep) onStep(mode === "winter" ? "засніжую знімок…" : "перетворюю на тепловізор…");
      await new Promise((res) => setTimeout(res, 0));
      const base = mode === "winter" ? winter(work) : thermal(work);
      for (const it of items) {
        if (mode === "winter" && !it.t.decoy && gsd > 0) { /* накати на снігу видно найкраще */
          // накат позаду техніки вздовж її курсу, з легким вигином (раніше тут був виклик неіснуючого AutoGen — накатів не було)
          try {
            const a = (it.angle || 0) * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), L = Math.max(8, it.size || 20);
            const bend = (Math.random() - 0.5) * 0.6, pts = [];
            for (let k = 0; k <= 6; k++) { const d = L * (0.2 + k * 0.7), b = bend * k * k * L * 0.05; pts.push([it.t.x - dx * d - dy * b, it.t.y - dy * d + dx * b]); }
            const g = 2.4 / gsd;
            Compose.tracks(base, pts, {gauge: g, rut: g * 0.22, str: 0.7, seed: 5});
          } catch (e) { /* без накатів */ }
        }
        const r = place(mode, base, work, it.spr, it.o, it);
        if (r && r.hidden > 0.6) it.t.hidden = Math.round(r.hidden * 100) / 100; else delete it.t.hidden;
      }
      return {canvas: base, before: old, targets, items};
    },

    async preview(id) {
      const s = this.admin.stages.find((x) => x.id === id); if (!s || this.busy) return;
      this.busy = true; this.say(`Готую «${s.title}»…`);
      try {
        const r = await this.build(s, this.mode, (m) => this.say(`«${s.title}»: ${m}`));
        const box = $("vr-prev"); box.hidden = false;
        box.innerHTML = `<p class="muted small">Ліворуч — оригінал, праворуч — ${MODES[this.mode].suffix.toLowerCase()}. Нічого не збережено.</p>`;
        const add = (a, b, label) => {
          const k = Math.min(1, 300 / Math.max(a.width, a.height)), c = cv(a.width * k * 2 + 8, a.height * k), x = c.getContext("2d");
          x.drawImage(a, 0, 0, a.width * k, a.height * k); x.drawImage(b, a.width * k + 8, 0, a.width * k, a.height * k);
          const f = document.createElement("figure"); f.appendChild(c); const cap = document.createElement("figcaption"); cap.textContent = label; f.appendChild(cap); box.appendChild(f);
        };
        add(r.before, r.canvas, "увесь знімок");
        for (const it of r.items) {
          const R = Math.round(Math.max(40, it.size * 1.6)), crop = (src) => { const c = cv(2 * R, 2 * R); c.getContext("2d").drawImage(src, it.t.x - R, it.t.y - R, 2 * R, 2 * R, 0, 0, 2 * R, 2 * R); return c; };
          add(crop(r.before), crop(r.canvas), `${it.t.decoy ? "муляж · " : ""}${it.t.type || "ціль"}`);
        }
        this.say("Перегляд готовий.", "ok");
      } catch (e) { this.say("Не вдалось: " + e.message, "no"); }
      this.busy = false;
    },

    async run() {
      if (this.busy) return;
      const L = this.list().filter((x) => this.sel.has(x.s.id));
      if (!L.length) return this.say("Виберіть хоча б один етап.", "no");
      this.busy = true; $("vr-go").disabled = true;
      const A = this.admin, mode = this.mode, fail = [];
      let made = 0;
      for (const {s} of L) {
        const pre = `«${s.title}»`;
        try {
          const r = await this.build(s, mode, (m) => this.say(`${pre}: ${m}`));
          let title = `${s.title} · ${MODES[mode].suffix}`;
          for (let k = 2; A.stages.some((x) => x.title === title); k++) title = title.replace(/ #\d+$/, "") + ` #${k}`;
          this.say(`${pre}: зберігаю…`);
          const st = await API.uploadStage(r.canvas, {title, targets: r.targets, name: `${mode}_${Date.now()}`}, this.pw, (m) => this.say(`${pre}: ${m}`));
          const meta = {direction: s.direction || "", season: mode === "winter" ? "Зима" : (s.season || ""), gsd: s.gsd || 0, hard: !!s.hard, cond: mode, of: s.id, src: s.src || ""};
          A.stages.push(Object.assign(st, meta));   // знімок уже на сервері — показати, навіть якщо мітки не запишуться
          try { await API.call("save_stage", Object.assign({id: st.id}, meta), this.pw); }
          catch (e) { fail.push(`${s.title}: варіант створено, але не записано напрямок/пору — перевірте його в списку (${e.message})`); }
          made++;
        } catch (e) { fail.push(`${s.title}: ${e.message}`); }
      }
      this.busy = false; this.sel = new Set(); this.render();
      this.say(`Створено етапів: ${made}${fail.length ? `. Не вдалось: ${fail.join("; ")}` : ""}. Вони вже ввімкнені й потрапляють у гру.`, fail.length ? "no" : "ok");
    },
  };

  window.Variants = Variants;
})();
