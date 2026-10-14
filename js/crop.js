/* Автообрізка карти: прибирає білі/чорні поля довкола знімка (скріншот слайда, підписи, рамки,
   чорні клини від зшивки) — лишає найбільший прямокутник, де є лише сама карта.
   Світлі плями всередині карти (дахи, дороги) полем не вважаються: фон — це лише те, що зʼєднане з краєм. */
(function () {
  function auto(src) {
    const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
    const k = Math.max(1, Math.max(W, H) / 700), w = Math.max(8, Math.round(W / k)), h = Math.max(8, Math.round(H / k));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.drawImage(src, 0, 0, w, h);
    const px = x.getImageData(0, 0, w, h).data, N = w * h;
    const bad = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0;
      bad[i] = (mx > 225 && sat < 0.1) || mx < 14 || px[i * 4 + 3] < 200 ? 1 : 0;
    }
    // фон = «погане», зʼєднане з краєм зображення
    const out = new Uint8Array(N), st = [];
    const push = (i) => { if (bad[i] && !out[i]) { out[i] = 1; st.push(i); } };
    for (let i = 0; i < w; i++) { push(i); push((h - 1) * w + i); }
    for (let j = 0; j < h; j++) { push(j * w); push(j * w + w - 1); }
    while (st.length) {
      const i = st.pop(), xx = i % w;
      if (xx > 0) push(i - 1); if (xx < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < N - w) push(i + w);
    }
    // ерозія 1 клітинки (мʼякі краї й антиаліасинг) — і найбільший прямокутник з самих «карта»
    const ok = new Uint8Array(N);
    for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
      const i = y * w + xx;
      ok[i] = !out[i] && !out[i - 1] && !out[i + 1] && !out[i - w] && !out[i + w] ? 1 : 0;
    }
    let best = 0, R = null;
    const hh = new Int32Array(w);
    for (let y = 0; y < h; y++) {
      for (let xx = 0; xx < w; xx++) hh[xx] = ok[y * w + xx] ? hh[xx] + 1 : 0;
      const stk = [];
      for (let xx = 0; xx <= w; xx++) {
        const cur = xx < w ? hh[xx] : 0; let s = xx;
        while (stk.length && stk[stk.length - 1][1] >= cur) {
          const [s0, hv] = stk.pop(); s = s0;
          const a = hv * (xx - s0);
          if (a > best) { best = a; R = [s0, y - hv + 1, xx, y + 1]; }
        }
        stk.push([s, cur]);
      }
    }
    if (!R) return null;
    let nOut = 0; for (let i = 0; i < N; i++) nOut += out[i];
    if (nOut < N * 0.003) return null;   // полів немає — карта вже чиста
    // сторона без фону вздовж прямокутника — до самого краю (не різати зайве через ерозію)
    const clean = (ax, ay, bx, by) => { for (let y = ay; y <= by; y++) for (let xx = ax; xx <= bx; xx++) if (out[y * w + xx]) return false; return true; };
    let x0 = Math.ceil((R[0] + 1) * k), y0 = Math.ceil((R[1] + 1) * k), x1 = Math.floor((R[2] - 1) * k), y1 = Math.floor((R[3] - 1) * k);
    if (R[0] <= 2 && clean(0, R[1], R[0], R[3] - 1)) x0 = 0;
    if (R[1] <= 2 && clean(R[0], 0, R[2] - 1, R[1])) y0 = 0;
    if (R[2] >= w - 2 && clean(R[2] - 1, R[1], w - 1, R[3] - 1)) x1 = W;
    if (R[3] >= h - 2 && clean(R[0], R[3] - 1, R[2] - 1, h - 1)) y1 = H;
    x0 = Math.min(W - 1, x0); y0 = Math.min(H - 1, y0); x1 = Math.max(x0 + 1, Math.min(W, x1)); y1 = Math.max(y0 + 1, Math.min(H, y1));
    const cw = x1 - x0, ch = y1 - y0;
    if (cw * ch > W * H * 0.985 || cw < 64 || ch < 64) return null;   // обрізати нічого (або щось пішло не так)
    const o = document.createElement("canvas"); o.width = cw; o.height = ch;
    o.getContext("2d").drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
    return {canvas: o, rect: [x0, y0, cw, ch], cut: 1 - (cw * ch) / (W * H)};
  }
  window.Crop = {auto};
})();
