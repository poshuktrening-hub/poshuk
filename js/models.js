/* Вбудовані моделі техніки (вигляд зверху, ніс угору), намальовані програмно — без чужих зображень і водяних знаків.
   Кожна має «надувний муляж»: той самий силует, роздутий фільтром inflate(). Масштаб малювання — U пкс/м. */
(function () {
  const U = 60;   // пкс/м: танк ≈ 570 пкс завдовжки — вистачає і для зуму в дуелі

  function cv(wm, hm) { const c = document.createElement("canvas"); c.width = Math.round(wm * U); c.height = Math.round(hm * U); return c; }

  /* Детермінований шум, щоб фарба не була пластиковою. */
  function grain(ctx, w, h, amt = 14, seed = 7) {
    const id = ctx.getImageData(0, 0, w, h), d = id.data;
    let s = seed;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const n = ((s >> 8) % 1000) / 1000 - 0.5;
      d[i] += n * amt; d[i + 1] += n * amt; d[i + 2] += n * amt * 0.8;
    }
    ctx.putImageData(id, 0, 0);
  }

  function setup(wm, hm) {
    const c = cv(wm, hm), x = c.getContext("2d");
    x.scale(U, U); x.lineJoin = "round"; x.lineCap = "round";
    return [c, x];
  }
  const rect = (x, a, b, w, h, fill) => { x.fillStyle = fill; x.fillRect(a, b, w, h); };
  const rr = (x, a, b, w, h, r, fill, stroke, lw) => {
    x.beginPath(); x.roundRect ? x.roundRect(a, b, w, h, r) : x.rect(a, b, w, h);
    if (fill) { x.fillStyle = fill; x.fill(); }
    if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw || 0.05; x.stroke(); }
  };
  const poly = (x, pts, fill, stroke, lw) => {
    x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath();
    if (fill) { x.fillStyle = fill; x.fill(); }
    if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw || 0.05; x.stroke(); }
  };
  const line = (x, a, b, c, d, col, w) => { x.strokeStyle = col; x.lineWidth = w; x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke(); };
  const circ = (x, a, b, r, fill, stroke, lw) => { x.beginPath(); x.arc(a, b, r, 0, 7); if (fill) { x.fillStyle = fill; x.fill(); } if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw || 0.05; x.stroke(); } };

  function tracks(x, W, y0, y1, tw) {
    for (const a of [0, W - tw]) {
      rr(x, a, y0, tw, y1 - y0, 0.15, "#2c2d28");
      for (let y = y0 + 0.1; y < y1 - 0.05; y += 0.16) line(x, a + 0.04, y, a + tw - 0.04, y, "#3f403a", 0.05);
    }
  }
  function wheels(x, W, ys, wr = 0.55, ww = 0.42) {
    for (const y of ys) for (const a of [-0.06, W - ww + 0.06]) rr(x, a, y - wr, ww, wr * 2, 0.12, "#262722");
  }
  const shade = (x, a, b, w, h, c1, c2) => { const g = x.createLinearGradient(a, b, a + w, b); g.addColorStop(0, c1); g.addColorStop(0.5, c2); g.addColorStop(1, c1); return g; };

  // ---------- БМП-3: 7,2 × 3,2 м
  function bmp3() {
    const W = 3.2, L = 7.4, [c, x] = setup(W, L);
    tracks(x, W, 0.6, 7.2, 0.48);
    poly(x, [[0.42, 1.0], [0.9, 0.35], [W - 0.9, 0.35], [W - 0.42, 1.0], [W - 0.42, 7.25], [0.42, 7.25]], shade(x, 0.4, 0, W - 0.8, 7, "#4b5139", "#5f664a"), "#3a3f2c", 0.04);
    line(x, 0.6, 1.25, W - 0.6, 1.25, "#3d4230", 0.05);
    for (let y = 5.5; y < 7.0; y += 0.22) line(x, 0.9, y, W - 0.9, y, "#43482f", 0.07); // моторне відділення ззаду
    circ(x, 0.95, 1.7, 0.22, "#4a5037", "#363a29", 0.04); circ(x, W - 0.95, 1.7, 0.22, "#4a5037", "#363a29", 0.04);
    poly(x, [[1.0, 2.4], [2.2, 2.4], [2.45, 3.0], [2.2, 3.9], [1.0, 3.9], [0.75, 3.0]], "#555c41", "#353a28", 0.05); // башта
    circ(x, 1.35, 3.25, 0.2, "#484e36", "#30342a", 0.03);
    rr(x, 1.53, -0.1, 0.18, 2.6, 0.06, "#3a3e2e"); // 100-мм
    rr(x, 1.8, 0.7, 0.08, 1.8, 0.04, "#33372a"); // 30-мм
    grain(x, c.width, c.height);
    return c;
  }

  // ---------- Бук-М1 (9А310): 9,3 × 3,25 м
  function buk() {
    const W = 3.3, L = 9.4, [c, x] = setup(W, L);
    tracks(x, W, 0.5, 9.1, 0.5);
    poly(x, [[0.45, 0.9], [0.8, 0.3], [W - 0.8, 0.3], [W - 0.45, 0.9], [W - 0.45, 9.2], [0.45, 9.2]], shade(x, 0.4, 0, W - 0.8, 9, "#4a5038", "#5c6347"), "#383d2b", 0.04);
    rr(x, 0.6, 0.55, 1.0, 1.1, 0.1, "#3f4430", "#2f3325", 0.04); // кабіна
    rr(x, 0.85, 0.7, 0.55, 0.25, 0.05, "#262a22");
    rr(x, 0.55, 2.7, W - 1.1, 6.1, 0.3, "#566048", "#353a28", 0.05); // поворотна платформа
    rr(x, 0.9, 2.2, W - 1.8, 0.9, 0.12, "#4d553f", "#2f3325", 0.05); // РЛС підсвічування
    for (const a of [0.85, 1.38, 1.92, 2.45]) {
      rr(x, a - 0.2, 2.9, 0.4, 5.6, 0.2, "#b9bdb0", "#7c8074", 0.03); // ракети 9М38
      poly(x, [[a, 2.6], [a - 0.2, 2.95], [a + 0.2, 2.95]], "#8f9386");
      line(x, a - 0.32, 7.9, a + 0.32, 7.9, "#6c7064", 0.08);
    }
    grain(x, c.width, c.height);
    return c;
  }

  // ---------- Красуха-4 (КамАЗ 8×8): 12 × 2,55 м
  function krasukha() {
    const W = 2.7, L = 12, [c, x] = setup(W, L);
    wheels(x, W, [1.4, 6.2, 8.0, 10.2]);
    rr(x, 0.15, 0.1, W - 0.3, 2.3, 0.35, shade(x, 0.15, 0, W - 0.3, 2, "#4d5439", "#606849"), "#353a28", 0.05); // кабіна
    rr(x, 0.35, 0.25, W - 0.7, 0.45, 0.12, "#22261f"); // лобове скло
    rr(x, 0.3, 2.7, W - 0.6, 9.1, 0.12, shade(x, 0.3, 0, W - 0.6, 9, "#4f563c", "#646c4c"), "#363b29", 0.05); // кунг
    for (let y = 3.0; y < 11.6; y += 1.05) rr(x, 0.42, y, W - 0.84, 0.85, 0.05, null, "#3e432f", 0.04);
    circ(x, W / 2, 8.6, 1.15, "#59614a", "#353a28", 0.06); // поворотна платформа
    poly(x, [[0.35, 7.4], [W - 0.35, 7.4], [W - 0.15, 9.0], [0.15, 9.0]], "#6b7358", "#3a3f2c", 0.05); // антенне полотно
    for (let a = 0.45; a < W - 0.4; a += 0.28) line(x, a, 7.5, a, 8.9, "#566048", 0.04);
    circ(x, W / 2, 10.9, 0.45, "#7b8269", "#454a36", 0.05); // тарілка
    line(x, W / 2, 10.3, W / 2, 11.6, "#3d4230", 0.08); // щогла
    grain(x, c.width, c.height);
    return c;
  }

  // ---------- БМ-21 «Град» (Урал-375 6×6): 7,4 × 2,4 м
  function grad() {
    const W = 2.5, L = 7.5, [c, x] = setup(W, L);
    wheels(x, W, [1.2, 5.0, 6.4], 0.5, 0.4);
    rr(x, 0.45, 0.05, W - 0.9, 1.1, 0.25, "#566048", "#353a28", 0.05); // капот
    rr(x, 0.2, 1.05, W - 0.4, 1.4, 0.2, shade(x, 0.2, 0, W - 0.4, 1, "#4d5439", "#606849"), "#353a28", 0.05); // кабіна
    rr(x, 0.35, 1.1, W - 0.7, 0.35, 0.08, "#22261f");
    rr(x, 0.25, 2.6, W - 0.5, 1.0, 0.1, "#4a5037", "#353a28", 0.04);
    rr(x, 0.15, 3.4, W - 0.3, 3.95, 0.12, "#59614a", "#33382a", 0.05); // пакет 40 труб
    const n = 10, tw = (W - 0.5) / n;
    for (let i = 0; i < n; i++) {
      rr(x, 0.25 + i * tw + 0.02, 3.5, tw - 0.04, 3.75, 0.06, i % 2 ? "#525a43" : "#5c654b");
      circ(x, 0.25 + i * tw + tw / 2, 7.2, tw * 0.35, "#1f221c");
    }
    grain(x, c.width, c.height);
    return c;
  }

  /* Чамферна відстань до найближчого пікселя з src[i]==0 (для «всередині») або ==1 (для «зовні»). */
  function chamfer(inside, w, h) {
    const INF = 1e9, D = new Float32Array(w * h);
    for (let i = 0; i < D.length; i++) D[i] = inside[i] ? INF : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!D[i]) continue; let v = D[i];
      if (x > 0) v = Math.min(v, D[i - 1] + 1); if (y > 0) v = Math.min(v, D[i - w] + 1);
      if (x > 0 && y > 0) v = Math.min(v, D[i - w - 1] + 1.414); if (x < w - 1 && y > 0) v = Math.min(v, D[i - w + 1] + 1.414);
      D[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; if (!D[i]) continue; let v = D[i];
      if (x < w - 1) v = Math.min(v, D[i + 1] + 1); if (y < h - 1) v = Math.min(v, D[i + w] + 1);
      if (x < w - 1 && y < h - 1) v = Math.min(v, D[i + w + 1] + 1.414); if (x > 0 && y < h - 1) v = Math.min(v, D[i + w - 1] + 1.414);
      D[i] = v;
    }
    return D;
  }

  /* «Роздути» модель як надувний муляж: тонкі деталі товщають (стволи — «ковбаски»), краї округлі,
     об'єм подушкою, деталі згладжені, колір світліший і рівніший, глянцевий відблиск. Силует і башта лишаються впізнаваними. */
  function inflate(src, opts = {}) {
    const S = Math.min(src.width, src.height);
    const pad = Math.round(S * 0.08), w = src.width + pad * 2, h = src.height + pad * 2;
    const mk = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const o = mk(), ox = o.getContext("2d"); ox.drawImage(src, pad, pad);
    const od = ox.getImageData(0, 0, w, h).data;
    const m0 = new Uint8Array(w * h);
    for (let i = 0; i < m0.length; i++) m0[i] = od[i * 4 + 3] > 100 ? 1 : 0;
    // 1) розширити силует на rd пкс (тонкі деталі стають товстими) і згладити край
    const rd = S * (opts.grow || 0.045);
    const out = chamfer(m0.map((v) => 1 - v), w, h);
    const mc = mk(), mx = mc.getContext("2d"), mid = mx.createImageData(w, h);
    for (let i = 0; i < m0.length; i++) mid.data[i * 4 + 3] = out[i] <= rd ? 255 : 0;
    mx.putImageData(mid, 0, 0);
    const sm = mk(), sx = sm.getContext("2d");
    sx.filter = `blur(${Math.max(1.5, rd * 0.6)}px)`; sx.drawImage(mc, 0, 0); sx.filter = "none";
    const sd = sx.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = sd[i * 4 + 3] > 127 ? 1 : 0;
    // 2) висота = подушка від краю + рельєф деталей (світліші частини оригіналу трохи «вищі»)
    const din = chamfer(mask, w, h), R = S * (opts.round || 0.14);
    const rel = mk(), rx = rel.getContext("2d");
    rx.filter = `blur(${Math.max(2, S * 0.025)}px)`; rx.drawImage(o, 0, 0); rx.filter = "none";
    const rdd = rx.getImageData(0, 0, w, h).data;
    const H = new Float32Array(w * h);
    for (let i = 0; i < H.length; i++) {
      if (!mask[i]) continue;
      const t = Math.min(1, din[i] / R), pillow = Math.sqrt(1 - (1 - t) * (1 - t));
      const a = rdd[i * 4 + 3] / 255, lum = a ? (rdd[i * 4] + rdd[i * 4 + 1] + rdd[i * 4 + 2]) / (3 * 255 * a) : 0;
      H[i] = pillow * (0.75 + 0.5 * lum);
    }
    // 3) колір і світло
    const col = mk(), cx = col.getContext("2d");
    cx.filter = `blur(${Math.max(1.5, S * 0.018)}px)`; cx.drawImage(mc, 0, 0); cx.globalCompositeOperation = "source-in";
    cx.fillStyle = "#5d6548"; cx.fillRect(0, 0, w, h); cx.globalCompositeOperation = "source-over"; cx.drawImage(o, 0, 0);
    cx.filter = "none";
    const cd = cx.getImageData(0, 0, w, h).data;
    const res = mk(), resx = res.getContext("2d"), rd2 = resx.createImageData(w, h), d = rd2.data;
    const L = [-0.5, -0.6, 0.62], k3 = R * 0.9;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, j = i * 4;
      if (!mask[i]) continue;
      const nx = (H[i - 1] - H[i + 1]) * k3, ny = (H[i - w] - H[i + w]) * k3, nl = Math.hypot(nx, ny, 1);
      const lam = Math.max(0, (nx * L[0] + ny * L[1] + L[2]) / nl);
      const spec = Math.pow(lam, 24) * 0.6;
      const a = cd[j + 3] / 255 || 1;
      let r = cd[j] / a, g = cd[j + 1] / a, b = cd[j + 2] / a;
      const gr = 0.3 * r + 0.59 * g + 0.11 * b;
      r = gr + (r - gr) * 0.7 + 16; g = gr + (g - gr) * 0.7 + 19; b = gr + (b - gr) * 0.7 + 8;
      const k = 0.5 + 0.65 * lam;
      d[j] = Math.min(255, r * k + 255 * spec); d[j + 1] = Math.min(255, g * k + 255 * spec); d[j + 2] = Math.min(255, b * k + 250 * spec);
      d[j + 3] = Math.min(255, 60 + 195 * Math.min(1, din[i] / 1.2));
    }
    resx.putImageData(rd2, 0, 0);
    return res;
  }

  const BUILTIN = [
    {id: "builtin:catapult", name: "Катапульта з «Ланцетом»", length_m: 6.2, draw: () => Compose.catapultSprite()},
    {id: "builtin:bmp3", name: "БМП-3", length_m: 7.2, draw: bmp3},
    {id: "builtin:buk", name: "ЗРК Бук-М1 (9А310)", length_m: 9.3, draw: buk},
    {id: "builtin:krasukha", name: "РЕБ Красуха-4", length_m: 12, draw: krasukha},
    {id: "builtin:grad", name: "РСЗВ БМ-21 Град", length_m: 7.4, draw: grad},
  ];
  const LIST = [];
  function register(models) {
    for (const m of models) {
      if (BUILTIN.some((b) => b.id === m.id)) continue;
      BUILTIN.push(m);
      const real = {id: m.id, name: m.name + " (вбудована)", length_m: m.length_m, builtin: true, ttx: m.ttx || ""};
      const decoy = {id: m.id + ":decoy", name: "Муляж " + m.name + " (надувний)", length_m: m.length_m, builtin: true, decoy: true};
      for (const o of [real, decoy]) { o.type = Logic.typeOf(o.name.replace(/^Муляж\s+/, "")); LIST.push(o); }
    }
  }
  const first = BUILTIN.splice(0); register(first);

  const cache = new Map();
  function sprite(id) {
    if (cache.has(id)) return cache.get(id);
    const base = BUILTIN.find((m) => m.id === id.replace(/:decoy$/, ""));
    if (!base) return null;
    const c = /:decoy$/.test(id) ? inflate(sprite(base.id)) : base.draw();
    cache.set(id, c);
    return c;
  }

  // набір для малювання додаткових моделей (js/models2.js): ті самі примітиви й масштаб
  const kit = {U, setup, rect, rr, poly, line, circ, tracks, wheels, shade, grain};
  window.Models = {LIST, sprite, inflate, register, kit, isBuiltin: (id) => /^builtin:/.test(id || ""), U};
})();
