/* Стара (до жовтня 2026) обробка техніки — лише для адмінки «Оновити етапи»: щоб знайти, як саме
   техніку було вбудовано в уже створені етапи (кут, маскування), і акуратно прибрати її перед новим рендером.
   Завантажується на вимогу, у грі не використовується. */
(function () {
  const SS = 8;
  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
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
    if (p.blur > 0) sctx.filter = `blur(${(p.blur * SS).toFixed(1)}px)`;   // під розмитість знімка
    sctx.drawImage(sprite, -dw / 2, -dh / 2, dw, dh);
    sctx.filter = "none";
    const spx = sctx.getImageData(0, 0, Wp, Hp).data;

    // ділянка знімка (поза межами — нулі)
    const rpx = base.getContext("2d").getImageData(x0, y0, mw, mh).data;
    let lr = 0, lg = 0, lb = 0, ln = 0;
    for (let i = 0; i < rpx.length; i += 4) if (rpx[i + 3]) { lr += rpx[i]; lg += rpx[i + 1]; lb += rpx[i + 2]; ln++; }
    if (!ln) return null;
    lr /= ln; lg /= ln; lb /= ln;

    // видимість (крони): техніка ховається там, де на самому знімку рослинність (крони, кущі).
    // Чим більший hide, тим слабша зелень уже вкриває техніку. На відкритому місці нічого не обрізається.
    // Крони: «зелень» знімка (надлишок зеленого) — це те, що лежить поверх техніки.
    // hideTarget (0…1) — яку частку силуету сховати: поріг підбирається бінарним пошуком.
    const Av = new Float32Array(Wp * Hp);
    const hide = Math.min(0.95, p.hide || 0), wantT = p.hideTarget === undefined || p.hideTarget === null ? null : Math.max(0, Math.min(0.95, p.hideTarget));
    let vs = null, meanVeg = 0;
    if (hide > 0 || wantT !== null || p.shade) {
      const vc = canvas(mw, mh), vx = vc.getContext("2d"), vd = vx.createImageData(mw, mh);
      for (let i = 0; i < mw * mh; i++) {
        const r = rpx[i * 4], g = rpx[i * 4 + 1], b = rpx[i * 4 + 2];
        const score = Math.max(0, Math.min(1, (2 * g - r - b) / 90));
        vd.data[i * 4] = vd.data[i * 4 + 1] = vd.data[i * 4 + 2] = 255; vd.data[i * 4 + 3] = score * 255;
        meanVeg += score;
      }
      meanVeg /= mw * mh;
      vx.putImageData(vd, 0, 0);
      const big = canvas(Wp, Hp), bx = big.getContext("2d");
      bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = "high";
      bx.filter = `blur(${SS * 0.6}px)`; bx.drawImage(vc, 0, 0, Wp, Hp); bx.filter = "none";
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
    const shadeK = 1 - Math.min(0.6, (p.shade || 0) * Math.min(1, meanVeg * 1.6));   // під кронами — в тіні

    // тінь
    let S = null;
    if (p.shadow_len > 0 && p.shadow_op > 0) {
      const [sdx, sdy] = compass(p.shadow_dir);
      const sx = Math.round(sdx * p.shadow_len * SS), sy = Math.round(sdy * p.shadow_len * SS);
      const sh0 = new Float32Array(Wp * Hp);
      for (let y = Math.max(0, sy); y < Math.min(Hp, Hp + sy); y++) for (let x = Math.max(0, sx); x < Math.min(Wp, Wp + sx); x++) sh0[y * Wp + x] = Av[(y - sy) * Wp + (x - sx)];
      S = gaussBlur(sh0, Wp, Hp, SS * (p.shadow_soft || 0.4));
      for (let i = 0; i < S.length; i++) S[i] *= 1 - Av[i];
    }

    // змішування й усереднення SS×SS
    const bl = p.blend || 0, dk = (1 - (p.darken || 0)) * shadeK, op = p.shadow_op || 0, sat = p.sat === undefined ? 1 : p.sat;
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
    // «зерно» знімка поверх техніки (шум/стиснення камери), щоб не виглядала вклеєною
    const gr = p.grain || 0;
    if (gr > 0) {
      for (let my = 1; my < mh - 1; my++) for (let mx2 = 1; mx2 < mw - 1; mx2++) {
        let a = 0; for (let yy = my * SS; yy < my * SS + SS; yy += 2) for (let xx = mx2 * SS; xx < mx2 * SS + SS; xx += 2) a += Av[yy * Wp + xx];
        a /= SS * SS / 4; if (a < 0.05) continue;
        const j = (my * mw + mx2) * 4;
        for (let c = 0; c < 3; c++) {
          const hpv = rpx[j + c] - (rpx[j - 4 + c] + rpx[j + 4 + c] + rpx[j - mw * 4 + c] + rpx[j + mw * 4 + c]) / 4;
          o[j + c] = o[j + c] + hpv * gr * a;
        }
      }
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
    return {x: x0, y: y0, w: mw, h: mh, hidden: hiddenFrac};
  }

  window.ComposeLegacy = {compose};
})();
