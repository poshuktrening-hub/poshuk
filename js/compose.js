/* Вбудовування техніки (PNG, вигляд зверху, перед угору) у знімок: масштаб, поворот, тінь, крони, «мангал».
   Порт compose.py з локальної версії: обʼєкт малюється у SS× більшій роздільності й усереднюється. */
(function () {
  const SS = 8;

  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Прибрати однотонний фон (якщо немає прозорості) і обрізати по вмісту. */
  function prepareObject(img, tolerance = 28) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const c = canvas(w, h), ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, w, h), px = id.data;
    let minA = 255;
    for (let i = 3; i < px.length; i += 4) if (px[i] < minA) minA = px[i];
    if (minA > 250) {
      // Модель кольорів фону будується з рамки картинки (сітка, градієнт, шум — усе, що є по краях).
      // Простір: яскравість (грубо, кроки 8) × відтінок r−g, b−g (точно, кроки 3) — тож сірий фон
      // не плутається з оливковою/сіро-зеленою технікою навіть однакової яскравості.
      const k = Math.max(2, Math.floor(Math.min(w, h) / 50));
      const LB = 32, CB = 171, key = (r, g, b) => {
        const L = Math.min(LB - 1, ((r + g + b) / 24) | 0);
        return (L * CB + Math.round((r - g) / 3) + 85) * CB + Math.round((b - g) / 3) + 85;
      };
      const hist = new Uint32Array(LB * CB * CB);
      let nb = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (y >= k && y < h - k && x >= k && x < w - k) continue;
        const j = (y * w + x) * 4; hist[key(px[j], px[j + 1], px[j + 2])]++; nb++;
      }
      const minCount = Math.max(2, nb * 0.0004);
      const cand = new Uint8Array(w * h);
      for (let i = 0, j = 0; i < cand.length; i++, j += 4) {
        const kk = key(px[j], px[j + 1], px[j + 2]), step = CB * CB;
        // сусідні градації яскравості з тим самим відтінком — теж фон (м'які градієнти)
        let c = hist[kk];
        if (kk >= step) c = Math.max(c, hist[kk - step]);
        if (kk + step < hist.length) c = Math.max(c, hist[kk + step]);
        cand[i] = c >= minCount ? 1 : 0;
      }
      const isBg = new Uint8Array(w * h), stack = [];
      const push = (i) => { if (cand[i] && !isBg[i]) { isBg[i] = 1; stack.push(i); } };
      for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
      while (stack.length) {
        const i = stack.pop(), x = i % w, y = (i - x) / w;
        if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
      }
      // ерозія на 1 пкс (прибирає ореол фону) + легке пом'якшення краю
      const al = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let keep = 1;
        for (let dy = -1; dy <= 1 && keep; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
          if (isBg[yy * w + xx]) { keep = 0; break; }
        }
        al[y * w + x] = keep;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += al[yy * w + xx] * (dx || dy ? 1 : 4); n += dx || dy ? 1 : 4; }
        }
        px[(y * w + x) * 4 + 3] = Math.round(s / n * 255);
      }
    }
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 24) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    ctx.putImageData(id, 0, 0);
    if (x1 < 0) return c;
    const out = canvas(x1 - x0 + 1, y1 - y0 + 1);
    out.getContext("2d").drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  /* «Мангал»: решітка з рамою над центральною частиною корпусу. */
  function addCage(sprite, color = "rgb(140,140,128)") {
    const w = sprite.width, h = sprite.height;
    const c = canvas(w, h), ctx = c.getContext("2d");
    ctx.drawImage(sprite, 0, 0);
    const x0 = 0, y0 = Math.floor(h * 0.33), x1 = w - 1, y1 = Math.floor(h * 0.88);
    const lw = Math.max(2, Math.floor(w / 32)), step = Math.max(6, Math.floor(w / 5));
    ctx.strokeStyle = color;
    ctx.lineWidth = lw + 2;
    ctx.strokeRect(x0 + (lw + 2) / 2, y0 + (lw + 2) / 2, x1 - x0 - lw - 2, y1 - y0 - lw - 2);
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let x = x0; x < x1; x += step) { ctx.moveTo(x + 0.5, y0); ctx.lineTo(x + 0.5, y1); }
    for (let y = y0; y < y1; y += step) { ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); }
    ctx.stroke();
    return c;
  }

  /* Вбудований приклад: катапульта з БпЛА типу «Ланцет» (вигляд зверху, ніс угору), 40 пкс/м. */
  function catapultSprite() {
    const U = 40, w = 1.6 * U, h = 6.2 * U, cx = w / 2;
    const c = canvas(w, h), d = c.getContext("2d");
    const P = (x, y) => [cx + x * U, y * U];
    const poly = (pts, fill) => { d.fillStyle = fill; d.beginPath(); pts.forEach((p, i) => (i ? d.lineTo(...p) : d.moveTo(...p))); d.closePath(); d.fill(); };
    const line = (a, b, col, wd) => { d.strokeStyle = col; d.lineWidth = wd; d.beginPath(); d.moveTo(...a); d.lineTo(...b); d.stroke(); };
    poly([P(-0.25, 0.3), P(0.25, 0.3), P(0.35, 5.4), P(-0.35, 5.4)], "rgb(46,48,44)");
    line(P(0, 0.3), P(0, 5.4), "rgb(78,80,72)", 0.12 * U);
    d.fillStyle = "rgb(55,57,50)"; d.fillRect(...P(-0.6, 5.2), 1.2 * U, 0.9 * U);
    const body = "rgb(176,190,200)";
    line(P(0, 0.6), P(0, 2.6), body, 0.26 * U);
    for (const [wy, span] of [[1.05, 0.72], [2.15, 0.65]]) for (const s of [1, -1]) line(P(-span * s, wy - span * 0.55), P(span * s, wy + span * 0.55), body, 0.16 * U);
    return c;
  }

  function compass(deg) { const r = deg * Math.PI / 180; return [Math.sin(r), -Math.cos(r)]; }

  function gaussBlur(src, W, H, sigma) {
    const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += (k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)));
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) { const xx = x + i; if (xx >= 0 && xx < W) v += src[y * W + xx] * k[i + r]; }
      tmp[y * W + x] = v;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) { const yy = y + i; if (yy >= 0 && yy < H) v += tmp[yy * W + x] * k[i + r]; }
      out[y * W + x] = v;
    }
    return out;
  }

  /* ---------------- якісне зменшення моделі: піраміда (половинки) замість одного стрибка ---------------- */
  const PYR = new WeakMap();
  function fitSprite(sprite, target) {
    let lv = PYR.get(sprite);
    if (!lv) { lv = [sprite]; PYR.set(sprite, lv); }
    let i = 0;
    while (Math.max(lv[i].width, lv[i].height) > target * 2 && Math.max(lv[i].width, lv[i].height) > 8) {
      if (!lv[i + 1]) {
        const s = lv[i], c = canvas(Math.ceil(s.width / 2), Math.ceil(s.height / 2)), x = c.getContext("2d");
        x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
        x.drawImage(s, 0, 0, c.width, c.height);
        lv.push(c);
      }
      i++;
    }
    return lv[i];
  }

  /* Нормалізація завантаженої моделі: будь-який розмір файлу → обрізаний PNG до maxSide пкс без втрати деталей. */
  function normalizeModel(img, maxSide = 2048) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    let src = img;
    if (Math.max(w, h) > maxSide * 1.05) {
      const k = maxSide / Math.max(w, h), tmp = canvas(w, h);
      tmp.getContext("2d").drawImage(img, 0, 0);
      const lvl = fitSprite(tmp, maxSide), c = canvas(w * k, h * k), x = c.getContext("2d");
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
      x.drawImage(lvl, 0, 0, c.width, c.height);
      src = c;
    }
    return prepareObject(src);
  }

  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  function pct(hist, total, q) { let s = 0; const lim = total * q; for (let i = 0; i < hist.length; i++) { s += hist[i]; if (s >= lim) return i; } return hist.length - 1; }

  /* ---------------- аналіз ділянки знімка довкола точки ----------------
     Рівні (чорна/біла точка, серпанок), колірний відтінок освітлення, насиченість, шум, різкість (PSF), колір і щільність тіней. */
  function analyze(base, cx, cy, size) {
    const W = base.width, H = base.height, R = Math.round(Math.max(40, Math.min(320, size * 2.5)));
    const x0 = Math.max(0, Math.round(cx - R)), y0 = Math.max(0, Math.round(cy - R));
    const w = Math.min(W, Math.round(cx + R)) - x0, h = Math.min(H, Math.round(cy + R)) - y0;
    if (w < 8 || h < 8) return null;
    const d = base.getContext("2d").getImageData(x0, y0, w, h).data, N = w * h;
    const L = new Float32Array(N), hist = new Uint32Array(256);
    let sL = 0, sL2 = 0, sS = 0, mCb = 0, mCr = 0, nCb = 0, nCr = 0, nn = 0;
    for (let i = 0; i < N; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], l = lum(r, g, b);
      L[i] = l; hist[Math.min(255, l | 0)]++; sL += l; sL2 += l * l;
      const cb = b - l, cr = r - l, c = Math.hypot(cb, cr);
      sS += c; mCb += cb; mCr += cr;
      if (c < 16 && l > 40 && l < 235) { nCb += cb; nCr += cr; nn++; }   // майже сірі поверхні: дороги, ґрунт, дахи — показують відтінок світла
    }
    const mean = sL / N, std = Math.sqrt(Math.max(1, sL2 / N - mean * mean));
    const p1 = pct(hist, N, 0.01), p5 = pct(hist, N, 0.05), p50 = pct(hist, N, 0.5), p99 = pct(hist, N, 0.99);
    const cast = nn > N * 0.02 ? [nCb / nn, nCr / nn] : [mCb / N * 0.3, mCr / N * 0.3];
    // тіні: найтемніші 5% проти середніх тонів — щільність і колір (зазвичай синюватий від неба)
    let dr = 0, dg = 0, db = 0, dn = 0, ar = 0, ag = 0, ab = 0, an = 0;
    const lo40 = pct(hist, N, 0.4), hi60 = pct(hist, N, 0.6);
    for (let i = 0; i < N; i++) {
      const l = L[i];
      if (l <= p5) { dr += d[i * 4]; dg += d[i * 4 + 1]; db += d[i * 4 + 2]; dn++; }
      else if (l >= lo40 && l <= hi60) { ar += d[i * 4]; ag += d[i * 4 + 1]; ab += d[i * 4 + 2]; an++; }
    }
    const tr = dn && an ? [(dr / dn + 4) / (ar / an + 4), (dg / dn + 4) / (ag / an + 4), (db / dn + 4) / (ab / an + 4)] : [0.5, 0.5, 0.55];
    // шум (Immerkær): маска Лапласа різниць; нижній квартиль — щоб фактура трави не рахувалась як шум
    const nz = [];
    for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      nz.push(Math.abs(L[i - w - 1] - 2 * L[i - w] + L[i - w + 1] - 2 * L[i - 1] + 4 * L[i] - 2 * L[i + 1] + L[i + w - 1] - 2 * L[i + w] + L[i + w + 1]));
    }
    nz.sort((a, b) => a - b);
    const noise = nz.length ? Math.min(12, nz[nz.length >> 2] / (0.3186 * 6)) : 0;
    // різкість: як слабне 95-й перцентиль градієнта після розмиття σ=1 → σ PSF знімка
    const rho = edgeRho(L, w, h);
    const psf = Math.sqrt(rho * rho / (1 - rho * rho));
    // дрібний локальний контраст (фактура): std високих частот — щоб деталі моделі були не «чистіші» за знімок
    const Lb = gaussBlur(L, w, h, 1.5);
    let hp = 0; for (let i = 0; i < N; i++) hp += (L[i] - Lb[i]) ** 2;
    return {mean, std, p1, p5, p50, p99, sat: sS / N, cast, env: [mCb / N, mCr / N], shadowT: tr, dark: p50 ? p5 / p50 : 0.5, noise, psf, rho, hp: Math.sqrt(hp / N)};
  }

  /* Різкість: наскільки слабнуть найсильніші перепади (верхні 5% градієнтів) після розмиття σ=1.
     Та сама міра для знімка і для моделі — тож розмиття моделі підбирається «у замкненому циклі», без припущень про обробку знімка. */
  function edgeRho(L, w, h, mask) {
    const top = (A) => {
      const v = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (mask && !mask[i]) continue; v.push(Math.hypot(A[i + 1] - A[i - 1], A[i + w] - A[i - w])); }
      if (!v.length) return 0;
      v.sort((a, b) => b - a);
      const n = Math.max(1, Math.floor(v.length * 0.05)); let s = 0; for (let i = 0; i < n; i++) s += v[i]; return s / n;
    };
    const G1 = top(L), G2 = top(gaussBlur(L, w, h, 1));
    return Math.max(0.3, Math.min(0.97, G1 ? G2 / G1 : 0.5));
  }

  /* Обʼєм: світлотінь за сонцем знімка. Висота — розмита маска силуету (борти нижче, дах вище) + трохи яскравості
     (панелі, люки); нормаль → освітлення з боку сонця, протилежний бік у півтіні. Плюс легка нерівномірність фарби/пилу. */
  function relief(cv, angRad, shadowDir, seed) {
    const w = cv.width, h = cv.height, x = cv.getContext("2d"), id = x.getImageData(0, 0, w, h), d = id.data, N = w * h;
    const A = new Float32Array(N), Lm = new Float32Array(N);
    for (let i = 0; i < N; i++) { A[i] = d[i * 4 + 3] / 255; Lm[i] = lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) / 255 * A[i]; }
    const sg = Math.max(1.2, Math.max(w, h) * 0.045);
    const Hb = gaussBlur(A, w, h, sg), Hm = gaussBlur(Lm, w, h, Math.max(0.8, sg * 0.25));
    const [sx, sy] = compass(shadowDir);
    const vx = -sx, vy = -sy;   // напрям на сонце в координатах знімка
    const lx = vx * Math.cos(angRad) + vy * Math.sin(angRad), ly = -vx * Math.sin(angRad) + vy * Math.cos(angRad);
    const el = 45 * Math.PI / 180, Lx = lx * Math.cos(el), Ly = ly * Math.cos(el), Lz = Math.sin(el);
    const k = sg * 2.2, km = sg * 0.9;
    const R = rng(seed || 1), cells = Math.max(4, Math.round(Math.max(w, h) / Math.max(6, sg * 1.5)));
    const nz = canvas(cells, Math.max(2, Math.round(cells * h / w))), nx = nz.getContext("2d"), nd = nx.createImageData(nz.width, nz.height);
    for (let i = 0; i < nd.data.length; i += 4) { const v = 96 + R() * 64; nd.data[i] = nd.data[i + 1] = nd.data[i + 2] = v; nd.data[i + 3] = 255; }
    nx.putImageData(nd, 0, 0);
    const big = canvas(w, h), bx = big.getContext("2d"); bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = "high"; bx.drawImage(nz, 0, 0, w, h);
    const wn = bx.getImageData(0, 0, w, h).data;
    for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
      const i = y * w + xx, j = i * 4; if (!d[j + 3]) continue;
      const gx = (Hb[i + 1] - Hb[i - 1]) * k + (Hm[i + 1] - Hm[i - 1]) * km, gy = (Hb[i + w] - Hb[i - w]) * k + (Hm[i + w] - Hm[i - w]) * km;
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const sh = (-gx * Lx - gy * Ly + Lz) * inv / Lz;           // 1 — рівний дах
      const f = Math.max(0.68, Math.min(1.25, 1 + 0.42 * (sh - 1))) * (1 + (wn[j] - 128) / 128 * 0.06);
      d[j] = Math.min(255, d[j] * f); d[j + 1] = Math.min(255, d[j + 1] * f); d[j + 2] = Math.min(255, d[j + 2] * f);
    }
    x.putImageData(id, 0, 0);
    return cv;
  }

  /* Розмиття, за якого модель (у масштабі знімка) має ту саму «різкість країв», що й ділянка знімка. */
  function matchBlur(lvl, sc, size) {
    const k = size / Math.max(lvl.width, lvl.height), w = Math.max(6, Math.ceil(lvl.width * k) + 6), h = Math.max(6, Math.ceil(lvl.height * k) + 6);
    const cv = canvas(w, h), x = cv.getContext("2d");
    let best = 0, bd = Infinity;
    for (const b of [0, 0.25, 0.5, 0.75, 1, 1.3, 1.7, 2.2]) {
      x.filter = "none"; x.fillStyle = `rgb(${sc.mean | 0},${sc.mean | 0},${sc.mean | 0})`; x.fillRect(0, 0, w, h);
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
      if (b) x.filter = `blur(${b}px)`;
      x.drawImage(lvl, 3, 3, w - 6, h - 6);
      x.filter = "none";
      const d = x.getImageData(0, 0, w, h).data, L = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) L[i] = lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      const r = edgeRho(L, w, h), dd = Math.abs(r - sc.rho);
      if (dd < bd) { bd = dd; best = b; }
      if (r > sc.rho) break;   // далі тільки розмитіше
    }
    return best;
  }

  /* Статистика самої моделі (кешується). */
  const SPST = new WeakMap();
  function spriteStats(sprite) {
    if (SPST.has(sprite)) return SPST.get(sprite);
    const lv = fitSprite(sprite, 128), w = lv.width, h = lv.height;
    const d = lv.getContext("2d").getImageData(0, 0, w, h).data, hist = new Uint32Array(256);
    let n = 0, sL = 0, sL2 = 0, sS = 0;
    for (let i = 0; i < w * h; i++) {
      if (d[i * 4 + 3] < 200) continue;
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], l = lum(r, g, b);
      hist[Math.min(255, l | 0)]++; sL += l; sL2 += l * l; sS += Math.hypot(b - l, r - l); n++;
    }
    const st = n ? {mean: sL / n, std: Math.sqrt(Math.max(1, sL2 / n - (sL / n) ** 2)), sat: sS / n} : {mean: 110, std: 30, sat: 20};
    SPST.set(sprite, st);
    return st;
  }

  /* Підбір обробки моделі під ділянку: тон, рівні, колір, насиченість, розмиття, шум, тінь. */
  function harmonize(sprite, sc, p = {}) {
    const sp = spriteStats(sprite);
    // рівні: чорне на знімку не чорне (серпанок), біле — не біле; модель частково переводиться в ці рівні
    const lo = Math.min(60, sc.p1 * 0.55), hi = Math.max(lo + 150, Math.min(255, Math.max(235, sc.p99 + 12)));
    // середній тон: трохи до тону місцевості (освітлення одне), але техніка лишається собою
    const mt = Math.max(sc.p5, Math.min(sc.p99 - 10, sp.mean * 0.8 + sc.mean * 0.2 + (p.bright || 0) * 60));
    const gain = Math.max(0.92, Math.min(1.2, 1 + (sc.std / sp.std - 1) * 0.2));
    const sat = Math.max(0.6, Math.min(1.05, Math.sqrt((sc.sat + 2) / (sp.sat + 2))));
    const op = Math.max(0.4, Math.min(0.72, (1 - sc.dark) * 0.95)) * (p.shadowK === undefined ? 1 : p.shadowK);
    const tl = lum(...sc.shadowT) || 0.5;
    const T = sc.shadowT.map((t) => Math.max(0.15, Math.min(0.98, (1 - op) * t / tl)));
    return {lo, hi, mt: (mt - lo) * 255 / (hi - lo), smean: sp.mean, gain, sat, cast: sc.cast, env: sc.env,
      // знімки зазвичай уже підшарплені — розмиваємо лише на різницю, мʼякше за «фізичну» оцінку
      blur: Math.max(0, Math.min(1.6, (sc.psf - 0.55) * 0.75)), noise: sc.noise, op, T};   // blur — запасне; основне підбирає matchBlur
  }

  function grade(src, g) {
    const c = canvas(src.width, src.height), x = c.getContext("2d");
    x.drawImage(src, 0, 0);
    const id = x.getImageData(0, 0, c.width, c.height), d = id.data, k = (g.hi - g.lo) / 255;
    const cb0 = g.cast[0] * 0.8 + g.env[0] * 0.1, cr0 = g.cast[1] * 0.8 + g.env[1] * 0.1;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const r = d[i], gg = d[i + 1], b = d[i + 2], l = lum(r, gg, b);
      const L1 = Math.max(0, Math.min(255, g.mt + (l - g.smean) * g.gain)), Lo = g.lo + L1 * k;
      const cb = (b - l) * g.sat + cb0, cr = (r - l) * g.sat + cr0;
      const R = Lo + cr, B = Lo + cb, G = (Lo - 0.299 * R - 0.114 * B) / 0.587;
      d[i] = R; d[i + 1] = G; d[i + 2] = B;
    }
    x.putImageData(id, 0, 0);
    return c;
  }

  /* Напрям уздовж краю посадки/крон (компас) — техніку ставлять паралельно лісосмузі. null — краю немає. */
  function alongEdge(base, cx, cy, size) {
    const R = Math.round(Math.max(16, size * 2)), W = base.width, H = base.height;
    const x0 = Math.max(0, Math.round(cx - R)), y0 = Math.max(0, Math.round(cy - R));
    const w = Math.min(W, Math.round(cx + R)) - x0, h = Math.min(H, Math.round(cy + R)) - y0;
    if (w < 6 || h < 6) return null;
    const d = base.getContext("2d").getImageData(x0, y0, w, h).data, v = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) v[i] = Math.max(0, Math.min(1, (2 * d[i * 4 + 1] - d[i * 4] - d[i * 4 + 2]) / 60)) * 0.6 + (1 - lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) / 255) * 0.4;
    const s = gaussBlur(v, w, h, Math.max(1.5, size * 0.3));
    let jxx = 0, jyy = 0, jxy = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, gx = s[i + 1] - s[i - 1], gy = s[i + w] - s[i - w];
      jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
    }
    const tr = jxx + jyy; if (tr < 1e-6) return null;
    if (Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / tr < 0.2) return null;
    const th = 0.5 * Math.atan2(2 * jxy, jxx - jyy);   // напрям градієнта; край — перпендикулярно
    return ((Math.atan2(-Math.sin(th), -Math.cos(th)) * 180 / Math.PI) % 180 + 180) % 180;
  }

  /* Малює обʼєкт у dst (canvas того ж розміру, що й base). Повертає змінений прямокутник {x,y,w,h,hidden,auto}.
     Усе, крім геометрії, підбирається саме з ділянки знімка (harmonize).
     p: size (пкс), angle, hideTarget (0…0.95) або hide, shadow_dir, shadow_len (пкс), shade, bright (−0.5…0.5), shadowK (0…1.5), seed */
  function compose(base, dst, sprite, cx, cy, p) {
    const SSd = Math.max(2, Math.min(8, Math.round(160 / Math.max(4, p.size))));
    const sw = sprite.width, sh = sprite.height;
    const scale = p.size * SSd / Math.max(sw, sh);
    const dw = sw * scale, dh = sh * scale, ang = p.angle * Math.PI / 180;
    const tw = Math.ceil(Math.abs(dw * Math.cos(ang)) + Math.abs(dh * Math.sin(ang)));
    const th = Math.ceil(Math.abs(dw * Math.sin(ang)) + Math.abs(dh * Math.cos(ang)));
    const pad = Math.ceil((Math.abs(p.shadow_len || 0) + 4 + p.size * 0.12) * SSd);
    let Wp = tw + 2 * pad, Hp = th + 2 * pad;
    Wp += (SSd - Wp % SSd) % SSd; Hp += (SSd - Hp % SSd) % SSd;
    const mw = Wp / SSd, mh = Hp / SSd;
    const x0 = Math.round(cx) - Math.floor(mw / 2), y0 = Math.round(cy) - Math.floor(mh / 2);

    const sc = analyze(base, cx, cy, p.size);
    if (!sc) return null;
    const g = harmonize(sprite, sc, p);

    // модель: якісне зменшення → підбір тону/кольору → малювання в SSd× роздільності з розмиттям під PSF знімка
    const lvl = relief(grade(fitSprite(sprite, Math.max(dw, dh)), g), ang, p.shadow_dir || 135, (p.seed || 0) + Math.round(cx * 7 + cy * 13));
    try { g.blur = matchBlur(lvl, sc, p.size); } catch (e) { /* лишається оцінка з PSF */ }
    const sctx0 = canvas(Wp, Hp), sctx = sctx0.getContext("2d");
    sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = "high";
    sctx.translate(Wp / 2, Hp / 2); sctx.rotate(ang);
    if (g.blur > 0.05) sctx.filter = `blur(${(g.blur * SSd).toFixed(2)}px)`;
    sctx.drawImage(lvl, -dw / 2, -dh / 2, dw, dh);
    sctx.filter = "none";
    const spx = sctx.getImageData(0, 0, Wp, Hp).data;

    const rpx = base.getContext("2d").getImageData(x0, y0, mw, mh).data;
    let ln = 0;
    for (let i = 3; i < rpx.length; i += 4) if (rpx[i]) ln++;
    if (!ln) return null;

    // крони поверх техніки (як і раніше): частка схованого силуету — бінарним пошуком порогу «зелені»
    const Av = new Float32Array(Wp * Hp);
    const hide = Math.min(0.95, p.hide || 0), wantT = p.hideTarget === undefined || p.hideTarget === null ? null : Math.max(0, Math.min(0.95, p.hideTarget));
    let vs = null, meanVeg = 0;
    if (hide > 0 || wantT !== null || p.shade) {
      const vc = canvas(mw, mh), vx = vc.getContext("2d"), vd = vx.createImageData(mw, mh);
      for (let i = 0; i < mw * mh; i++) {
        const r = rpx[i * 4], gg = rpx[i * 4 + 1], b = rpx[i * 4 + 2];
        const score = Math.max(0, Math.min(1, (2 * gg - r - b) / 90));
        vd.data[i * 4] = vd.data[i * 4 + 1] = vd.data[i * 4 + 2] = 255; vd.data[i * 4 + 3] = score * 255;
        meanVeg += score;
      }
      meanVeg /= mw * mh;
      vx.putImageData(vd, 0, 0);
      const big = canvas(Wp, Hp), bx = big.getContext("2d");
      bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = "high";
      bx.filter = `blur(${SSd * 0.6}px)`; bx.drawImage(vc, 0, 0, Wp, Hp); bx.filter = "none";
      const vdat = bx.getImageData(0, 0, Wp, Hp).data;
      vs = new Float32Array(Wp * Hp);
      for (let i = 0; i < Wp * Hp; i++) vs[i] = vdat[i * 4 + 3] / 255;
    }
    const cov = (s, thr) => Math.max(0, Math.min(1, (s - thr) / 0.18 + 0.5));
    let thr = 1 - hide;
    if (vs && wantT !== null) {
      const hid = (t) => { let s0 = 0, s1 = 0; for (let i = 0; i < Wp * Hp; i += 3) { const a = spx[i * 4 + 3]; if (a) { s0 += a; s1 += a * cov(vs[i], t); } } return s0 ? s1 / s0 : 0; };
      let lo = -0.6, hi = 1.6;
      for (let k = 0; k < 16; k++) { const mid = (lo + hi) / 2; if (hid(mid) > wantT) lo = mid; else hi = mid; }
      thr = hi;
    }
    let a0 = 0, a1 = 0;
    for (let i = 0; i < Wp * Hp; i++) {
      let a = spx[i * 4 + 3] / 255;
      a0 += a;
      if (a && vs && (hide > 0 || wantT !== null)) a *= 1 - cov(vs[i], thr);
      a1 += a;
      Av[i] = a;
    }
    const hiddenFrac = a0 ? 1 - a1 / a0 : 0;
    // притінення кронами — лише коли техніку справді ховають під ними (на відкритому місці її не темнимо)
    const shadeK = 1 - Math.min(0.6, (p.shade || 0) * Math.min(1, meanVeg * 1.6) * Math.min(1, Math.max(hide, wantT || 0) / 0.3));

    // тінь (колір і щільність — як у тіней на цьому знімку) + контактна тінь під корпусом (AO)
    const sl = p.shadow_len || 0;
    let S = null;
    if (sl > 0 && g.op > 0) {
      const [sdx, sdy] = compass(p.shadow_dir || 135);
      const sx = Math.round(sdx * sl * SSd), sy = Math.round(sdy * sl * SSd);
      const sh0 = new Float32Array(Wp * Hp);
      // «витягнута» тінь: кілька зсувів уздовж напрямку — без розриву між корпусом і тінню
      for (let st = 1; st <= 4; st++) {
        const ox = Math.round(sx * st / 4), oy = Math.round(sy * st / 4);
        for (let y = Math.max(0, oy); y < Math.min(Hp, Hp + oy); y++) for (let x = Math.max(0, ox); x < Math.min(Wp, Wp + ox); x++) {
          const v = Av[(y - oy) * Wp + (x - ox)]; if (v > sh0[y * Wp + x]) sh0[y * Wp + x] = v;
        }
      }
      S = gaussBlur(sh0, Wp, Hp, SSd * (0.45 + g.blur * 0.8));
    }
    const AO = gaussBlur(Av, Wp, Hp, SSd * Math.max(0.7, Math.min(3, p.size * 0.06)));
    const IN = gaussBlur(Av, Wp, Hp, SSd * 0.7);   // «внутрішність» силуету — для мʼякого краю (light wrap)
    const aoS = 0.35 * Math.min(1.3, g.op / 0.5) * (p.shadowK === undefined ? 1 : p.shadowK);

    const out = new ImageData(mw, mh), o = out.data, n = SSd * SSd, cvr = new Float32Array(mw * mh);
    for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
      const j = (my * mw + mx) * 4;
      const r0 = rpx[j], g0 = rpx[j + 1], b0 = rpx[j + 2];
      let sr = 0, sg = 0, sb = 0, ca = 0;
      for (let yy = my * SSd; yy < my * SSd + SSd; yy++) for (let xx = mx * SSd; xx < mx * SSd + SSd; xx++) {
        const i = yy * Wp + xx, a = Av[i], out1 = 1 - a;
        const s = S ? S[i] * out1 : 0, ao = AO[i] * out1 * aoS;
        let r = r0 * (1 - s * (1 - g.T[0])) * (1 - ao), gg = g0 * (1 - s * (1 - g.T[1])) * (1 - ao), b = b0 * (1 - s * (1 - g.T[2])) * (1 - ao);
        if (a) {
          const q = i * 4, wrap = Math.max(0, Math.min(1, (1 - IN[i]) * 1.6)) * 0.28;
          const cr = (spx[q] * (1 - wrap) + r0 * wrap) * shadeK, cg = (spx[q + 1] * (1 - wrap) + g0 * wrap) * shadeK, cb = (spx[q + 2] * (1 - wrap) + b0 * wrap) * shadeK;
          r = r * (1 - a) + cr * a; gg = gg * (1 - a) + cg * a; b = b * (1 - a) + cb * a;
          ca += a;
        }
        sr += r; sg += gg; sb += b;
      }
      cvr[my * mw + mx] = ca / n;
      o[j] = sr / n; o[j + 1] = sg / n; o[j + 2] = sb / n; o[j + 3] = rpx[j + 3] ? 255 : 0;
    }
    // шум сенсора/стиснення як на знімку — лише на техніці (розмиття прибрало її власний)
    if (g.noise > 0.3) {
      const R = rng((p.seed || 0) + Math.round(cx) * 73856093 + Math.round(cy) * 19349663);
      const gauss = () => { const u = R() || 1e-9, v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
      for (let i = 0; i < mw * mh; i++) {
        const a = cvr[i]; if (a < 0.03) continue;
        const nL = gauss() * g.noise * a, j = i * 4;
        o[j] += nL + gauss() * g.noise * 0.25 * a; o[j + 1] += nL; o[j + 2] += nL + gauss() * g.noise * 0.25 * a;
      }
    }
    dst.getContext("2d").putImageData(out, x0, y0);
    return {x: x0, y: y0, w: mw, h: mh, hidden: hiddenFrac,
      auto: {tone: Math.round((g.mt * (g.hi - g.lo) / 255 + g.lo - g.smean) / 2.55), sat: Math.round(g.sat * 100), blur: Math.round(g.blur * 10) / 10, noise: Math.round(g.noise * 10) / 10, shadow: Math.round(g.op * 100)}};
  }

  /* Згладити ламану (Чайкін). */
  function smooth(pts, n = 2) {
    let P = pts.slice();
    for (let k = 0; k < n && P.length > 2; k++) {
      const Q = [P[0]];
      for (let i = 0; i < P.length - 1; i++) {
        const [ax, ay] = P[i], [bx, by] = P[i + 1];
        Q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
      }
      Q.push(P[P.length - 1]); P = Q;
    }
    return P;
  }

  /* Накатані сліди колісної/гусеничної техніки вздовж ламаної pts (координати знімка).
     p: gauge — відстань між коліями (пкс), rut — ширина колії (пкс), str — помітність 0…1.
     По траві — світліші пригнуті смуги, по ґрунту — темніші вдавлені. Повертає змінений прямокутник. */
  function tracks(cv, pts, p = {}) {
    if (!pts || pts.length < 2) return null;
    const P = smooth(pts.filter((q, i) => !i || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) > 2), 3);
    if (P.length < 2) return null;
    const gauge = Math.max(3, p.gauge || 20), rut = Math.max(1.2, p.rut || gauge * 0.22), str = p.str === undefined ? 0.6 : p.str;
    const pad = gauge + rut * 3;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    P.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
    x1 = Math.min(cv.width, Math.ceil(x1 + pad)); y1 = Math.min(cv.height, Math.ceil(y1 + pad));
    const w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) return null;
    // маска двох колій: зсув ламаної вбік на ±gauge/2 по нормалі
    const mc = canvas(w, h), mx = mc.getContext("2d");
    mx.lineCap = mx.lineJoin = "round"; mx.strokeStyle = "#fff";
    const off = (s) => P.map(([x, y], i) => {
      const [ax, ay] = P[Math.max(0, i - 1)], [bx, by] = P[Math.min(P.length - 1, i + 1)];
      const L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L;
      return [x - x0 + nx * s, y - y0 + ny * s];
    });
    mx.filter = `blur(${Math.max(0.6, rut * 0.25)}px)`;
    // по сегментах: на кінцях траса плавно згасає (без «клинів»)
    const fade = (i, n) => Math.max(0, Math.min(1, (Math.min(i, n - 2 - i)) / Math.max(3, n * 0.22)));
    const strokeLine = (Q, lw, a0) => {
      mx.lineWidth = lw;
      for (let i = 0; i < Q.length - 1; i++) {
        mx.globalAlpha = a0 * fade(i, Q.length);
        if (mx.globalAlpha < 0.01) continue;
        mx.beginPath(); mx.moveTo(...Q[i]); mx.lineTo(...Q[i + 1]); mx.stroke();
      }
    };
    for (const s of [-gauge / 2, gauge / 2]) strokeLine(off(s), rut, 1);
    strokeLine(off(0), gauge * 0.6, 0.25);   // слабка смуга між коліями (пригнута трава від днища)
    mx.globalAlpha = 1; mx.filter = "none";
    const m = mx.getImageData(0, 0, w, h).data;
    const ctx = cv.getContext("2d"), img = ctx.getImageData(x0, y0, w, h), d = img.data;
    // під кронами дерев слідів не видно: де фактура «крон» (сильний локальний контраст + зелень) — слабше
    const tc = canvas(w, h), tx = tc.getContext("2d"); tx.filter = `blur(${Math.max(2, gauge * 0.25)}px)`; tx.drawImage(cv, x0, y0, w, h, 0, 0, w, h); tx.filter = "none";
    const bl = tx.getImageData(0, 0, w, h).data;
    const seed = (p.seed || 7) * 9301;
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      const mv = m[j + 3] / 255; if (mv < 0.01) continue;
      const xx = i % w, yy = (i - xx) / w;
      const nz = Math.sin((xx + x0) * 0.37 + seed) * Math.cos((yy + y0) * 0.29 - seed) * 0.5 + 0.5;   // нерівномірність
      const r = d[j], g = d[j + 1], b = d[j + 2], lum = 0.3 * r + 0.59 * g + 0.11 * b;
      const veg = Math.max(0, Math.min(1, (2 * g - r - b) / 60));
      const tex = Math.abs(lum - (0.3 * bl[j] + 0.59 * bl[j + 1] + 0.11 * bl[j + 2])) / 22;
      const canopy = Math.min(0.9, tex * veg + (lum < 70 ? 0.4 : 0));
      const road = veg < 0.15 && lum > 140 ? 0.75 : 0;   // укатана дорога: накатів майже не видно
      const f = Math.min(1, mv * str * (0.65 + 0.7 * nz) * (1 - canopy) * (1 - road));
      // трава: світліша, жовтувато-сіра; ґрунт: темніший
      const tr = veg * (lum * 1.12 + 18) + (1 - veg) * (r * 0.8), tg = veg * (lum * 1.08 + 14) + (1 - veg) * (g * 0.78), tb = veg * (lum * 0.92 + 4) + (1 - veg) * (b * 0.76);
      d[j] = r + (tr - r) * f; d[j + 1] = g + (tg - g) * f; d[j + 2] = b + (tb - b) * f;
    }
    ctx.putImageData(img, x0, y0);
    return {x: x0, y: y0, w, h};
  }

  /* Напрям тіней на знімку (компас, куди падає тінь): світле (крона/дах) — а поруч темне. */
  function shadowDir(cv) {
    const W = cv.width, H = cv.height, k = Math.max(1, Math.max(W, H) / 900);
    const w = Math.round(W / k), h = Math.round(H / k);
    const c = canvas(w, h), x = c.getContext("2d"); x.drawImage(cv, 0, 0, w, h);
    const px = x.getImageData(0, 0, w, h).data, N = w * h, L = new Float32Array(N);
    for (let i = 0; i < N; i++) L[i] = 0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2];
    // high-pass: мінус розмите
    const bc = canvas(w, h), bx = bc.getContext("2d"); bx.filter = "blur(6px)"; bx.drawImage(c, 0, 0); bx.filter = "none";
    const bp = bx.getImageData(0, 0, w, h).data;
    const hp = new Float32Array(N);
    for (let i = 0; i < N; i++) hp[i] = L[i] - (0.3 * bp[i * 4] + 0.59 * bp[i * 4 + 1] + 0.11 * bp[i * 4 + 2]);
    let best = 135, bv = -Infinity;
    for (let deg = 0; deg < 360; deg += 10) {
      const [dx, dy] = compass(deg); let s = 0, n = 0;
      for (const dist of [2, 3, 4]) {
        const ox = Math.round(dx * dist), oy = Math.round(dy * dist);
        for (let y = 8; y < h - 8; y += 2) for (let xx = 8; xx < w - 8; xx += 2) {
          const a = hp[y * w + xx], b = hp[(y + oy) * w + xx + ox];
          if (a > 0 && b < 0) { s += a * -b; } n++;
        }
      }
      const v = s / n;
      if (v > bv) { bv = v; best = deg; }
    }
    return best;
  }

  window.Compose = {compose, analyze, harmonize, alongEdge, normalizeModel, fitSprite, prepareObject, addCage, catapultSprite, canvas, SS, tracks, shadowDir, smooth};
})();
