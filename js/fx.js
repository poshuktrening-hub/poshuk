/* Вибух при влучанні: спалах, вогняна куля, ударна хвиля, іскри, уламки, дим, тряска камери.
   Малюється на окремому полотні поверх мапи в координатах знімка (тримається за ціллю при зумі/русі). */
(function () {
  const reduce = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rnd = (a, b) => a + Math.random() * (b - a);

  class FXLayer {
    constructor(viewer) {
      this.v = viewer; this.items = [];
      this.c = document.createElement("canvas");
      this.c.className = "fx-layer";
      viewer.host.appendChild(this.c);
      this.ctx = this.c.getContext("2d");
      this.raf = null;
    }
    resize() {
      // ефектам не потрібна «ретина»: на телефонах (dpr 3) полотно в 9 разів більше — саме це й давало підвисання
      const dpr = Math.min(1.25, window.devicePixelRatio || 1), W = this.v.W, H = this.v.H;
      if (this.c.width !== Math.round(W * dpr) || this.c.height !== Math.round(H * dpr)) {
        this.c.width = Math.round(W * dpr); this.c.height = Math.round(H * dpr);
        this.c.style.width = W + "px"; this.c.style.height = H + "px";
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    add(fx) { this.items.push(fx); if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t)); }
    frame(now) {
      this.resize();
      const ctx = this.ctx, v = this.v;
      ctx.clearRect(0, 0, v.W, v.H);
      this.items = this.items.filter((fx) => fx.draw(ctx, now, v));
      this.raf = this.items.length ? requestAnimationFrame((t) => this.frame(t)) : null;
      if (!this.raf) ctx.clearRect(0, 0, v.W, v.H);
    }
  }

  /* Фактурні спрайти клубів (генеруються один раз): вогонь і дим з купи розмитих плям. */
  const SPR = {};
  function puff(kind, seed) {
    const key = kind + seed; if (SPR[key]) return SPR[key];
    const N = 192, c = document.createElement("canvas"); c.width = c.height = N;
    const x = c.getContext("2d");
    let a = seed * 9973 + 17; const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
    x.filter = "blur(1.5px)";
    for (let i = 0; i < 90; i++) {
      const ang = r() * 6.283, d = Math.pow(r(), 0.8) * N * 0.34, px = N / 2 + Math.cos(ang) * d, py = N / 2 + Math.sin(ang) * d, rad = N * (0.035 + r() * 0.09);
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      if (kind === "fire") {
        const hot = 1 - d / (N * 0.3);
        g.addColorStop(0, `rgba(255,${200 + 55 * hot | 0},${120 + 120 * hot | 0},${0.55 + 0.4 * hot})`);
        g.addColorStop(0.5, `rgba(255,${110 + 60 * hot | 0},20,0.45)`); g.addColorStop(1, "rgba(160,30,0,0)");
      } else {
        // клуб диму з освітленим боком (сонце) і темнішим затіненим
        const lit = 0.75 + 0.5 * Math.max(0, Math.cos(ang + 2.2)) * (d / (N * 0.34));
        const v = (kind === "smokeD" ? 38 + r() * 34 : 100 + r() * 50) * lit;
        g.addColorStop(0, `rgba(${v | 0},${v - 3 | 0},${v - 8 | 0},${0.35 + r() * 0.35})`); g.addColorStop(0.7, `rgba(${v | 0},${v - 3 | 0},${v - 8 | 0},${0.12})`); g.addColorStop(1, `rgba(${v | 0},${v | 0},${v | 0},0)`);
      }
      x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
    }
    SPR[key] = c; return c;
  }

  /* Один вибух у точці знімка (ix, iy), r — радіус цілі в пікселях знімка. */
  function makeBlast(ix, iy, r, small) {
    const k = small ? 0.5 : 1;
    const sparks = Array.from({length: small ? 22 : 64}, () => ({a: rnd(0, 6.283), sp: rnd(0.8, 2.8), life: rnd(0.35, 0.95), w: rnd(1, 2.4)}));
    const debris = Array.from({length: small ? 14 : 40}, () => ({a: rnd(0, 6.283), sp: rnd(0.5, 2.2), life: rnd(0.7, 1.4), s: rnd(0.8, 2.2)}));
    const fires = Array.from({length: small ? 4 : 7}, (_, i) => ({a: rnd(0, 6.283), d: rnd(0, 0.45), s: rnd(0.75, 1.15), rot: rnd(0, 6.283), sp: rnd(-1, 1), seed: i + 1}));
    const wind = rnd(0, 6.283);
    const smokes = Array.from({length: small ? 5 : 9}, (_, i) => ({a: rnd(0, 6.283), d: rnd(0.15, 0.9), s: rnd(0.7, 1.15), rot: rnd(0, 6.283), sp: rnd(-0.4, 0.4), delay: 0.12 + i * 0.04 + rnd(0, 0.15), seed: (i % 6) + 1}));
    const DUR = reduce() ? 1.5 : 4.2;
    const drawSpr = (ctx, img, x, y, size, rot, alpha) => {
      if (alpha <= 0.003) return;
      ctx.save(); ctx.globalAlpha = Math.min(1, alpha); ctx.translate(x, y); ctx.rotate(rot); ctx.drawImage(img, -size / 2, -size / 2, size, size); ctx.restore();
    };
    return {
      t0: performance.now(),
      draw(ctx, now, v) {
        const t = (now - this.t0) / 1000;
        if (t > DUR) return false;
        const cx = v.tx + ix * v.s, cy = v.ty + iy * v.s;
        const R = Math.max(small ? 22 : 38, Math.min(200, Math.min(v.W, v.H) * 0.16, r * v.s * 2.1)) * (small ? 0.75 : 1);
        ctx.save();
        // кільце пилу від ударної хвилі (по землі, повільне)
        if (t < 1.5) {
          const u = t / 1.5, rad = R * (0.8 + 2.4 * (1 - Math.pow(1 - u, 3)));
          const g = ctx.createRadialGradient(cx, cy, rad * 0.6, cx, cy, rad);
          g.addColorStop(0, "rgba(150,135,110,0)"); g.addColorStop(0.75, `rgba(165,150,125,${0.32 * (1 - u)})`); g.addColorStop(1, "rgba(150,135,110,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fill();
        }
        // дим: спершу темний, далі світлішає, розноситься вітром
        for (const p of smokes) {
          const tt = t - p.delay; if (tt <= 0) continue;
          const life = DUR - p.delay, u = Math.min(1, tt / life), e = 1 - Math.pow(1 - u, 2);
          const drift = R * 1.8 * e;
          const x = cx + Math.cos(p.a) * p.d * R * (0.6 + e) + Math.cos(wind) * drift, y = cy + Math.sin(p.a) * p.d * R * (0.6 + e) + Math.sin(wind) * drift;
          const size = R * (0.9 + 2.2 * Math.sqrt(u)) * p.s, rot = p.rot + p.sp * tt;
          const al = Math.min(1, tt / 0.35) * Math.pow(1 - u, 0.9);
          drawSpr(ctx, puff("smokeD", p.seed), x, y, size, rot, al * 0.95 * (1 - 0.7 * u));
          drawSpr(ctx, puff("smokeL", p.seed), x, y, size * 1.05, rot, al * 0.8 * Math.min(1, u * 1.5));
        }
        // уламки — дрібні темні частинки з коротким слідом
        for (const d of debris) {
          if (t > d.life) continue;
          const u = t / d.life, dist = R * d.sp * (1 - Math.pow(1 - u, 2.4)) * 1.7;
          const x = cx + Math.cos(d.a) * dist, y = cy + Math.sin(d.a) * dist, tail = R * 0.12 * (1 - u) * d.sp;
          ctx.strokeStyle = `rgba(25,20,16,${0.85 * (1 - u * u)})`; ctx.lineWidth = d.s; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(d.a) * tail, y - Math.sin(d.a) * tail); ctx.stroke();
        }
        ctx.globalCompositeOperation = "lighter";
        // спалах
        if (t < 0.2) {
          const a = 1 - t / 0.2, rad = R * (1.0 + 2.6 * t / 0.2);
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
          g.addColorStop(0, `rgba(255,255,245,${a})`); g.addColorStop(0.3, `rgba(255,225,150,${a * 0.85})`); g.addColorStop(1, "rgba(255,140,40,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fill();
        }
        // вогняна куля: фактурні клуби, що ростуть, крутяться й гаснуть
        if (t < 1.25) {
          const u = t / 1.25, grow = 0.5 + 1.1 * (1 - Math.pow(1 - Math.min(1, t / 0.4), 3));
          for (const f of fires) {
            const x = cx + Math.cos(f.a) * f.d * R * grow, y = cy + Math.sin(f.a) * f.d * R * grow;
            drawSpr(ctx, puff("fire", f.seed), x, y, R * 1.6 * f.s * grow, f.rot + f.sp * t, Math.pow(1 - u, 1.5));
          }
        }
        // іскри
        for (const s of sparks) {
          if (t > s.life) continue;
          const u = t / s.life, dist = R * s.sp * (1 - Math.pow(1 - u, 2)) * 1.5;
          const x = cx + Math.cos(s.a) * dist, y = cy + Math.sin(s.a) * dist, tail = R * 0.3 * s.sp * (1 - u);
          ctx.strokeStyle = `rgba(255,${235 - 140 * u | 0},${150 - 120 * u | 0},${1 - u})`; ctx.lineWidth = s.w; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(s.a) * tail, y - Math.sin(s.a) * tail); ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
        // ударна хвиля
        if (t < 0.5) {
          const u = t / 0.5, rad = R * (0.7 + 4 * u);
          ctx.strokeStyle = `rgba(255,248,235,${0.7 * (1 - u)})`; ctx.lineWidth = Math.max(1.2, R * 0.07 * (1 - u));
          ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.stroke();
          ctx.strokeStyle = `rgba(255,255,255,${0.25 * (1 - u)})`; ctx.lineWidth = Math.max(1, R * 0.2 * (1 - u));
          ctx.beginPath(); ctx.arc(cx, cy, rad * 0.93, 0, 7); ctx.stroke();
        }
        ctx.restore();
        // короткий спалах на весь кадр (камера «засліплена»)
        if (!small && t < 0.09 && !reduce()) { ctx.fillStyle = `rgba(255,250,235,${0.28 * (1 - t / 0.09)})`; ctx.fillRect(0, 0, v.W, v.H); }
        return true;
      },
    };
  }

  const layers = new WeakMap();
  /* Спрайти — заздалегідь, у вільний час (а не в момент першого влучання). */
  function warm() { ["fire", "smokeD", "smokeL"].forEach((k) => { for (let s = 1; s <= 7; s++) puff(k, s); }); }
  if (window.requestIdleCallback) requestIdleCallback(warm, {timeout: 4000}); else setTimeout(warm, 1500);

  const FX = {
    _blast: makeBlast,   // для перевірки покадрово
    /* шар ефектів створюється разом зі знімком, а не в момент влучання */
    prepare(viewer) { if (viewer && !layers.get(viewer)) { const L = new FXLayer(viewer); layers.set(viewer, L); L.resize(); } },
    explode(viewer, ix, iy, r, opts = {}) {
      if (!viewer || !viewer.img) return;
      let L = layers.get(viewer);
      if (!L) { L = new FXLayer(viewer); layers.set(viewer, L); }
      L.add(makeBlast(ix, iy, r || 14, !!opts.small));
      if (!reduce() && !opts.small) shake(viewer.host, 7);
      if (navigator.vibrate) try { navigator.vibrate(opts.small ? 40 : [70, 40, 140]); } catch (e) { /* ок */ }
    },
  };

  function shake(el, amp) {
    const t0 = performance.now();
    el.style.willChange = "transform";
    const step = (now) => {
      const t = (now - t0) / 380;
      if (t >= 1) { el.style.transform = ""; el.style.willChange = ""; return; }
      const a = amp * Math.pow(1 - t, 2);
      el.style.transform = `translate(${rnd(-a, a).toFixed(1)}px,${rnd(-a, a).toFixed(1)}px)`;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  window.FX = FX;
})();
