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
      // Фон — те, що зʼєднане з краями картинки і схоже на колір кутів АБО такий самий сірий/темний
      // (прибирає й сітку, й градієнт фону рендера; темні деталі всередині техніки лишаються).
      const k = Math.max(2, Math.floor(Math.min(w, h) / 40));
      const rs = [], gs = [], bs = [];
      const take = (x0, y0) => { for (let y = y0; y < y0 + k; y++) for (let x = x0; x < x0 + k; x++) { const j = (y * w + x) * 4; rs.push(px[j]); gs.push(px[j + 1]); bs.push(px[j + 2]); } };
      take(0, 0); take(w - k, 0); take(0, h - k); take(w - k, h - k);
      const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
      const bg = [med(rs), med(gs), med(bs)];
      const bmx = Math.max(...bg), bgv = bmx / 255, bgs = bmx ? (bmx - Math.min(...bg)) / bmx : 0;
      const cand = new Uint8Array(w * h);
      for (let i = 0, j = 0; i < cand.length; i++, j += 4) {
        const r = px[j], g = px[j + 1], b = px[j + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx ? (mx - mn) / mx : 0, val = mx / 255;
        const d = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
        cand[i] = d < tolerance || (Math.abs(sat - bgs) < 0.12 && Math.abs(val - bgv) < 0.22) ? 1 : 0;
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

  /* Малює обʼєкт у dst (canvas того ж розміру, що й base). Повертає змінений прямокутник {x,y,w,h}.
     p: size (пкс на знімку), angle, hide (0…0.9), hide_dir, shadow_dir, shadow_len, shadow_op, blend, darken, seed */
  function compose(base, dst, sprite, cx, cy, p) {
    const sw = sprite.width, sh = sprite.height;
    const scale = p.size * SS / Math.max(sw, sh);
    const dw = sw * scale, dh = sh * scale, ang = p.angle * Math.PI / 180;
    const tw = Math.ceil(Math.abs(dw * Math.cos(ang)) + Math.abs(dh * Math.sin(ang)));
    const th = Math.ceil(Math.abs(dw * Math.sin(ang)) + Math.abs(dh * Math.cos(ang)));
    const pad = Math.ceil((Math.abs(p.shadow_len) + 3) * SS);
    let Wp = tw + 2 * pad, Hp = th + 2 * pad;
    Wp += (SS - Wp % SS) % SS; Hp += (SS - Hp % SS) % SS;
    const mw = Wp / SS, mh = Hp / SS;
    const x0 = Math.round(cx) - Math.floor(mw / 2), y0 = Math.round(cy) - Math.floor(mh / 2);

    // спрайт у великій роздільності
    const sc = canvas(Wp, Hp), sctx = sc.getContext("2d");
    sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = "high";
    sctx.translate(Wp / 2, Hp / 2); sctx.rotate(ang);
    sctx.drawImage(sprite, -dw / 2, -dh / 2, dw, dh);
    const spx = sctx.getImageData(0, 0, Wp, Hp).data;

    // ділянка знімка (поза межами — нулі)
    const rpx = base.getContext("2d").getImageData(x0, y0, mw, mh).data;
    let lr = 0, lg = 0, lb = 0, ln = 0;
    for (let i = 0; i < rpx.length; i += 4) if (rpx[i + 3]) { lr += rpx[i]; lg += rpx[i + 1]; lb += rpx[i + 2]; ln++; }
    if (!ln) return null;
    lr /= ln; lg /= ln; lb /= ln;

    // видимість (крони): техніка ховається там, де на самому знімку рослинність (крони, кущі).
    // Чим більший hide, тим слабша зелень уже вкриває техніку. На відкритому місці нічого не обрізається.
    const Av = new Float32Array(Wp * Hp);
    const hide = Math.min(0.95, p.hide || 0);
    let veg = null;
    if (hide > 0) {
      const vc = canvas(mw, mh), vx = vc.getContext("2d"), vd = vx.createImageData(mw, mh);
      const thr = 1 - hide;
      for (let i = 0; i < mw * mh; i++) {
        const r = rpx[i * 4], g = rpx[i * 4 + 1], b = rpx[i * 4 + 2];
        const exg = (2 * g - r - b) / 90;                       // надлишок зеленого
        const score = Math.max(0, Math.min(1, exg));
        const c = Math.max(0, Math.min(1, (score - thr) / 0.18 + 0.5));
        vd.data[i * 4] = vd.data[i * 4 + 1] = vd.data[i * 4 + 2] = 255; vd.data[i * 4 + 3] = c * 255;
      }
      vx.putImageData(vd, 0, 0);
      const big = canvas(Wp, Hp), bx = big.getContext("2d");
      bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = "high";
      bx.filter = `blur(${SS * 0.6}px)`; bx.drawImage(vc, 0, 0, Wp, Hp); bx.filter = "none";
      veg = bx.getImageData(0, 0, Wp, Hp).data;
    }
    for (let i = 0; i < Wp * Hp; i++) {
      let a = spx[i * 4 + 3] / 255;
      if (a && veg) a *= 1 - veg[i * 4 + 3] / 255;
      Av[i] = a;
    }

    // тінь
    let S = null;
    if (p.shadow_len > 0 && p.shadow_op > 0) {
      const [sdx, sdy] = compass(p.shadow_dir);
      const sx = Math.round(sdx * p.shadow_len * SS), sy = Math.round(sdy * p.shadow_len * SS);
      const sh0 = new Float32Array(Wp * Hp);
      for (let y = Math.max(0, sy); y < Math.min(Hp, Hp + sy); y++) for (let x = Math.max(0, sx); x < Math.min(Wp, Wp + sx); x++) sh0[y * Wp + x] = Av[(y - sy) * Wp + (x - sx)];
      S = gaussBlur(sh0, Wp, Hp, SS * 0.4);
      for (let i = 0; i < S.length; i++) S[i] *= 1 - Av[i];
    }

    // змішування й усереднення SS×SS
    const bl = p.blend || 0, dk = 1 - (p.darken || 0), op = p.shadow_op || 0, sat = p.sat === undefined ? 1 : p.sat;
    const out = new ImageData(mw, mh), o = out.data, n = SS * SS;
    for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
      const j = (my * mw + mx) * 4;
      const r0 = rpx[j], g0 = rpx[j + 1], b0 = rpx[j + 2];
      let sr = 0, sg = 0, sb = 0;
      for (let yy = my * SS; yy < my * SS + SS; yy++) for (let xx = mx * SS; xx < mx * SS + SS; xx++) {
        const i = yy * Wp + xx, a = Av[i], k = S ? 1 - op * S[i] : 1;
        let r = r0 * k, g = g0 * k, b = b0 * k;
        if (a) {
          const q = i * 4;
          let cr = spx[q], cg = spx[q + 1], cb = spx[q + 2];
          if (sat !== 1) { const gr = 0.299 * cr + 0.587 * cg + 0.114 * cb; cr = gr + (cr - gr) * sat; cg = gr + (cg - gr) * sat; cb = gr + (cb - gr) * sat; }
          r = r * (1 - a) + (cr * (1 - bl) + lr * bl) * dk * a;
          g = g * (1 - a) + (cg * (1 - bl) + lg * bl) * dk * a;
          b = b * (1 - a) + (cb * (1 - bl) + lb * bl) * dk * a;
        }
        sr += r; sg += g; sb += b;
      }
      o[j] = sr / n; o[j + 1] = sg / n; o[j + 2] = sb / n; o[j + 3] = rpx[j + 3] ? 255 : 0;
    }
    // підвищення різкості техніки (unsharp mask), лише там, де вона є
    const shp = p.sharp === undefined ? 0.7 : p.sharp;
    if (shp > 0) {
      const cov = new Float32Array(mw * mh);
      for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
        let s = 0;
        for (let yy = my * SS; yy < my * SS + SS; yy += 2) for (let xx = mx * SS; xx < mx * SS + SS; xx += 2) s += Av[yy * Wp + xx];
        cov[my * mw + mx] = s / (SS * SS / 4);
      }
      const src = new Uint8ClampedArray(o);
      for (let my = 1; my < mh - 1; my++) for (let mx = 1; mx < mw - 1; mx++) {
        const k = cov[my * mw + mx]; if (k < 0.05) continue;
        const j = (my * mw + mx) * 4;
        for (let c = 0; c < 3; c++) {
          const bl = (src[j - 4 + c] + src[j + 4 + c] + src[j - mw * 4 + c] + src[j + mw * 4 + c] + src[j + c] * 4) / 8;
          o[j + c] = src[j + c] + (src[j + c] - bl) * shp * 1.6 * Math.min(1, k * 1.5);
        }
      }
    }
    // пікселі поза знімком не чіпаємо: putImageData сам обріже по межах полотна
    dst.getContext("2d").putImageData(out, x0, y0);
    return {x: x0, y: y0, w: mw, h: mh};
  }

  window.Compose = {compose, prepareObject, addCage, catapultSprite, canvas, SS};
})();
