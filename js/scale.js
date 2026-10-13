/* Масштаб знімка (м/пкс) без ручного вводу:
   1) з назви файлу: «Північ · Літо · 02 · 0.1» або «… 0,25 м» / «… 0.25м/пкс»;
   2) автоматично зі знімка: ширина ґрунтових/польових доріг (світлі сірі смуги) ≈ 4 м. */
(function () {
  const ROAD_M = 4.5;   // типова ширина ґрунтової/сільської дороги з узбіччям

  function fromName(name) {
    const m = String(name || "").match(/(?:^|[\s·_|@-])(\d+[.,]\d+)\s*(?:м\/пкс|м|m\/px|m)?(?=$|[\s·_|)])/i);
    if (!m) return 0;
    const v = Number(m[1].replace(",", "."));
    return v >= 0.02 && v <= 5 ? v : 0;
  }

  /* Оцінка з картинки. Повертає {gsd, width, n} або null, якщо доріг не знайдено. */
  function estimate(src) {
    const W0 = src.naturalWidth || src.width, H0 = src.naturalHeight || src.height;
    const k = Math.max(1, Math.max(W0, H0) / 1600);
    const w = Math.round(W0 / k), h = Math.round(H0 / k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, w, h);
    const px = x.getImageData(0, 0, w, h).data, N = w * h;
    // поріг яскравості — відносно самого знімка (верхні ~12% пікселів)
    const hist = new Uint32Array(256);
    for (let i = 0; i < N; i++) hist[Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])]++;
    let acc = 0, vthr = 255;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > N * 0.12) { vthr = v; break; } }
    vthr = Math.max(120, Math.min(200, vthr));
    let M = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0;
      M[i] = mx >= vthr && sat < 0.3 && g - (r + b) / 2 < 12 ? 1 : 0;
    }
    // згладити маску (відкриття 3×3 прибирає дрібні відблиски, закриття — дірки)
    const morph = (A, erode) => {
      const B = new Uint8Array(N);
      for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
        let v = erode ? 1 : 0;
        for (let dy = -1; dy <= 1 && (erode ? v : !v); dy++) for (let dx = -1; dx <= 1; dx++) {
          const a = A[(y + dy) * w + xx + dx];
          if (erode && !a) { v = 0; break; } if (!erode && a) { v = 1; break; }
        }
        B[y * w + xx] = v;
      }
      return B;
    };
    M = morph(morph(M, true), false);
    M = morph(morph(M, false), true);
    // відстань до краю маски (chamfer 3-4)
    const D = new Float32Array(N), INF = 1e9;
    for (let i = 0; i < N; i++) D[i] = M[i] ? INF : 0;
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const i = y * w + xx; if (!D[i]) continue;
      let v = D[i];
      if (xx > 0) v = Math.min(v, D[i - 1] + 3);
      if (y > 0) { v = Math.min(v, D[i - w] + 3); if (xx > 0) v = Math.min(v, D[i - w - 1] + 4); if (xx < w - 1) v = Math.min(v, D[i - w + 1] + 4); }
      D[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let xx = w - 1; xx >= 0; xx--) {
      const i = y * w + xx; if (!D[i]) continue;
      let v = D[i];
      if (xx < w - 1) v = Math.min(v, D[i + 1] + 3);
      if (y < h - 1) { v = Math.min(v, D[i + w] + 3); if (xx < w - 1) v = Math.min(v, D[i + w + 1] + 4); if (xx > 0) v = Math.min(v, D[i + w - 1] + 4); }
      D[i] = v;
    }
    // компоненти маски: дорога — довга смуга сталої ширини (довжина ≫ ширини)
    const lab = new Int32Array(N).fill(-1), comps = [];
    const st = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (!M[s0] || lab[s0] >= 0) continue;
      const id = comps.length, ws = []; let area = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
      lab[s0] = id; st.push(s0);
      while (st.length) {
        const i = st.pop(); area++;
        const xx = i % w, y = (i - xx) / w;
        if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (xx > 1 && y > 1 && xx < w - 2 && y < h - 2) {
          const d = D[i] / 3;   // chamfer 3-4 → пікселі
          let top = d >= 1.5;
          for (const j of [i - 1, i + 1, i - w, i + w, i - w - 1, i - w + 1, i + w - 1, i + w + 1]) if (D[j] > D[i]) { top = false; break; }
          if (top) ws.push(2 * d);
        }
        for (const j of [i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < N && M[j] && lab[j] < 0) { lab[j] = id; st.push(j); }
      }
      if (ws.length < 8) continue;
      ws.sort((p, q) => p - q);
      const wd = ws[ws.length >> 1];                 // типова ширина (зменшені пікселі)
      const span = Math.max(x1 - x0, y1 - y0);
      comps.push({wd, span, area});
    }
    // дороги — найпротяжніші вузькі смуги через пів знімка, а не дахи й плями
    const lin = comps.filter((c) => c.span >= 15 * c.wd && c.wd * k >= 5 && c.wd * k <= 150);
    if (!lin.length) return null;
    const maxSpan = Math.max(...lin.map((c) => c.span));
    if (maxSpan < Math.max(w, h) * 0.2) return null;   // довгої дороги немає — краще спитати людину
    const roads = lin.filter((c) => c.span >= 0.6 * maxSpan);
    const width = roads.reduce((a, c) => a + c.wd * c.span, 0) / roads.reduce((a, c) => a + c.span, 0) * k;
    const gsd = Math.max(0.03, Math.min(2, ROAD_M / width));
    return {gsd: Math.round(gsd * 100) / 100, width: Math.round(width), n: roads.length};
  }

  window.Scale = {fromName, estimate, ROAD_M};
})();
