/* Полотно зі знімком: плавний зум (колесо, кнопки, pinch), перетягування, сітка квадратів, позначки. */
(function () {
  const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // без I та O, щоб не плутати з 1 і 0

  function letterOf(col) {
    if (col < LETTERS.length) return LETTERS[col];
    return LETTERS[Math.floor(col / LETTERS.length) - 1] + LETTERS[col % LETTERS.length];
  }

  function squareName(x, y, cell) {
    return letterOf(Math.floor(x / cell)) + (Math.floor(y / cell) + 1);
  }

  class Viewer {
    constructor(host, opts = {}) {
      this.host = host;
      this.onLeft = opts.onLeft || null;
      this.onRight = opts.onRight || null;
      this.onChange = opts.onChange || null;
      this.startFill = !!opts.fill;
      this.insets = opts.insets || null;   // () => {t,r,b,l}: смуги під панелями поверх мапи — мапу можна витягнути з-під них   // стартовий вигляд: знімок на весь екран (без порожніх смуг)
      this.MAX_ZOOM = 16;
      this.ANIM_MS = 220;
      this.img = null;
      this.s = this.minS = 1;
      this.tx = this.ty = 0;
      this.marks = [];
      this.gridCell = null;
      this.showGrid = false;
      this.pixel = false;
      this.anim = null;
      this.pointers = new Map();
      this.drag = null;
      this.pinch = null;

      host.classList.add("viewer");
      this.canvas = document.createElement("canvas");
      host.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");
      this.rail = document.createElement("div");
      this.rail.className = "rail";
      host.appendChild(this.rail);
      this.addButton("+", "Наблизити", () => this.zoomCenter(1.6));
      this.addButton("−", "Віддалити", () => this.zoomCenter(1 / 1.6));
      this.addButton("ВСЕ", "Весь знімок", () => this.fit(true));
      this.zoomLbl = document.createElement("div");
      this.zoomLbl.className = "zoom-lbl";
      this.zoomLbl.textContent = "×1.0";
      this.rail.appendChild(this.zoomLbl);

      const c = this.canvas;
      c.addEventListener("pointerdown", (e) => this._down(e));
      c.addEventListener("pointermove", (e) => this._move(e));
      c.addEventListener("pointerup", (e) => this._up(e));
      c.addEventListener("pointercancel", (e) => this._up(e, true));
      c.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (this.onRight && this.img) this.onRight(...this._local(e));
      });
      c.addEventListener("wheel", (e) => {
        e.preventDefault();
        const [x, y] = this._local(e);
        const big = Math.abs(e.deltaY) >= 50;
        this.zoomAt(Math.pow(1.25, -e.deltaY / (big ? 100 : 60)), x, y, big);
      }, {passive: false});
      this.ro = new ResizeObserver(() => this._resize());
      this.ro.observe(host);
      this._resize();
    }

    addButton(text, title, fn) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.addEventListener("click", fn);
      this.rail.insertBefore(b, this.zoomLbl || null);
      return b;
    }

    // ---------- публічне
    setImage(img) {
      this.img = img;
      this.marks = [];
      this.anim = null;
      if (this.startFill) this.fill(false); else this.fit(false);
    }

    /* У скільки разів «на весь екран» більше за «весь знімок» (≥1). */
    coverRel() {
      if (!this.img) return 1;
      const c = Math.max(this.W / this.img.width, this.H / this.img.height);
      return Math.max(1, c / Math.min(this.W / this.img.width, this.H / this.img.height));
    }

    /* Стартовий вигляд: знімок перекриває весь екран (+ трохи зуму), від лівого верхнього кута — далі гортати. */
    fill(animate, ms) {
      if (!this.img) return;
      this.minS = Math.min(this.W / this.img.width, this.H / this.img.height);
      const s = this.minS * Math.min(this.MAX_ZOOM, this.coverRel() * (this.fillExtra || 1.25));
      const n = this.insets ? this.insets() : {t: 0, l: 0};
      this._go(s, n.l, n.t, animate, ms);   // верх мапи — одразу під панеллю, не під нею
    }

    replaceImage(img) { this.img = img; this.draw(); }

    setMarks(m) { this.marks = m.slice(); this.draw(); }

    setGrid(cols) { this.gridCell = this.img && cols ? this.img.width / cols : null; this.draw(); }

    toggleGrid(on) { this.showGrid = on === undefined ? !this.showGrid : on; this.draw(); }

    zoomRel() {
      const s = this.anim ? this.anim.to[0] : this.s;
      return this.minS ? s / this.minS : 1;
    }

    toImage(cx, cy) { return [(cx - this.tx) / this.s, (cy - this.ty) / this.s]; }

    inside(x, y) { return this.img && x >= 0 && y >= 0 && x < this.img.width && y < this.img.height; }

    fit(animate, ms) {
      if (!this.img) return;
      this.minS = Math.min(this.W / this.img.width, this.H / this.img.height);
      const s = this.lowS();
      this._go(s, (this.W - this.img.width * s) / 2, (this.H - this.img.height * s) / 2, animate, ms);
    }

    /* Найменший дозволений масштаб: у грі (fill) — знімок завжди перекриває екран, без чорних смуг. */
    lowS() { return this.startFill ? this.minS * this.coverRel() : this.minS; }

    zoomAt(f, cx, cy, animate = true) {
      if (!this.img) return;
      const [bs, btx, bty] = this.anim ? this.anim.to : [this.s, this.tx, this.ty];
      const ns = Math.max(this.lowS(), Math.min(this.minS * this.MAX_ZOOM, bs * f));
      const k = ns / bs;
      this._go(ns, cx - (cx - btx) * k, cy - (cy - bty) * k, animate);
    }

    zoomTo(rel, ix, iy, animate = true) {
      const s = Math.max(this.lowS(), Math.min(this.minS * this.MAX_ZOOM, this.minS * rel));
      this._go(s, this.W / 2 - ix * s, this.H / 2 - iy * s, animate);
    }

    zoomCenter(f) { this.zoomAt(f, this.W / 2, this.H / 2); }

    // ---------- стан і анімація
    _clamped(s, tx, ty) {
      const iw = this.img.width * s, ih = this.img.height * s;
      const n = this.insets ? this.insets() : {t: 0, r: 0, b: 0, l: 0};
      tx = iw < this.W ? (this.W - iw) / 2 : Math.min(n.l, Math.max(this.W - iw - n.r, tx));
      ty = ih < this.H ? (this.H - ih) / 2 : Math.min(n.t, Math.max(this.H - ih - n.b, ty));
      return [s, tx, ty];
    }

    _go(s, tx, ty, animate, ms) {
      const [s1, tx1, ty1] = this._clamped(s, tx, ty);
      this.anim = null;
      const same = Math.abs(s1 - this.s) < 1e-9 && Math.abs(tx1 - this.tx) < 0.5 && Math.abs(ty1 - this.ty) < 0.5;
      const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!animate || same || reduce) {
        this.s = s1; this.tx = tx1; this.ty = ty1;
        this.draw();
        return;
      }
      const s0 = this.s, tx0 = this.tx, ty0 = this.ty;
      let fixed = null;
      if (Math.abs(s1 - s0) > 1e-9) {
        const px = (tx0 - tx1) / (s1 - s0), py = (ty0 - ty1) / (s1 - s0);
        fixed = [tx0 + s0 * px, ty0 + s0 * py, px, py];
      }
      this.anim = {from: [s0, tx0, ty0], to: [s1, tx1, ty1], fixed, t0: performance.now(), ms: ms || this.ANIM_MS};
      requestAnimationFrame(() => this._step());
    }

    _step() {
      const a = this.anim;
      if (!a) return;
      const t = Math.min(1, (performance.now() - a.t0) / a.ms);
      const e = a.ms <= this.ANIM_MS ? 1 - Math.pow(1 - t, 3) : t * t * (3 - 2 * t);
      const [s0, tx0, ty0] = a.from, [s1, tx1, ty1] = a.to;
      if (t >= 1) {
        this.s = s1; this.tx = tx1; this.ty = ty1;
        this.anim = null;
      } else {
        const s = s0 * Math.pow(s1 / s0, e);
        if (a.fixed) {
          const [ax, ay, px, py] = a.fixed;
          this.s = s; this.tx = ax - s * px; this.ty = ay - s * py;
        } else {
          this.s = s; this.tx = tx0 + (tx1 - tx0) * e; this.ty = ty0 + (ty1 - ty0) * e;
        }
      }
      this._render();
      if (this.anim) requestAnimationFrame(() => this._step());
    }

    _resize() {
      const r = this.host.getBoundingClientRect();
      const oldW = this.W || r.width, oldH = this.H || r.height;
      this.W = Math.max(50, r.width);
      this.H = Math.max(50, r.height);
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(this.W * dpr);
      this.canvas.height = Math.round(this.H * dpr);
      this.canvas.style.width = this.W + "px";
      this.canvas.style.height = this.H + "px";
      if (!this.img) return this._render();
      if (this.anim) {
        const [s1, tx1, ty1] = this.anim.to;
        const rel = s1 / this.minS;
        const cx = (oldW / 2 - tx1) / s1, cy = (oldH / 2 - ty1) / s1;
        this.minS = Math.min(this.W / this.img.width, this.H / this.img.height);
        const ns = Math.max(this.lowS(), this.minS * rel);
        this._go(ns, this.W / 2 - cx * ns, this.H / 2 - cy * ns, true, this.anim.ms);
        return;
      }
      const rel = this.zoomRel();
      this.minS = Math.min(this.W / this.img.width, this.H / this.img.height);
      const s = Math.max(this.lowS(), this.minS * rel);
      const cx = (oldW / 2 - this.tx) / this.s, cy = (oldH / 2 - this.ty) / this.s;
      [this.s, this.tx, this.ty] = this._clamped(s, this.W / 2 - cx * s, this.H / 2 - cy * s);
      this._render();
    }

    // ---------- малювання
    draw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this._render(); });
    }

    _render() {
      const ctx = this.ctx, dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      if (!this.img) return;
      const s = this.s;
      ctx.imageSmoothingEnabled = !(this.pixel || s / this.minS >= 6);
      ctx.imageSmoothingQuality = "high";
      if (this.img.drawTo) { this.img.onTile = () => this.draw(); this.img.drawTo(ctx, this.tx, this.ty, s, this.W, this.H); }
      else ctx.drawImage(this.img, this.tx, this.ty, this.img.width * s, this.img.height * s);
      if (this.showGrid && this.gridCell) this._grid();
      for (const m of this.marks) this._mark(m);
      this.zoomLbl.textContent = "×" + (this.s / this.minS).toFixed(1);
      if (this.onChange) this.onChange();
    }

    _grid() {
      const ctx = this.ctx, s = this.s, cell = this.gridCell;
      const iw = this.img.width, ih = this.img.height;
      const cols = Math.ceil(iw / cell), rows = Math.ceil(ih / cell);
      ctx.save();
      ctx.strokeStyle = "rgba(242,240,216,.38)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= cols; i++) {
        const x = Math.round(this.tx + Math.min(iw, i * cell) * s) + 0.5;
        ctx.moveTo(x, Math.max(0, this.ty)); ctx.lineTo(x, Math.min(this.H, this.ty + ih * s));
      }
      for (let j = 0; j <= rows; j++) {
        const y = Math.round(this.ty + Math.min(ih, j * cell) * s) + 0.5;
        ctx.moveTo(Math.max(0, this.tx), y); ctx.lineTo(Math.min(this.W, this.tx + iw * s), y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "600 12px 'IBM Plex Sans', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const top = Math.max(this.ty, 0) + 2, left = Math.max(this.tx, 0) + 2;
      for (let i = 0; i < cols; i++) {
        const x = this.tx + (i + 0.5) * cell * s;
        if (x < 0 || x > this.W) continue;
        ctx.fillStyle = "rgba(12,15,18,.78)"; ctx.fillRect(x - 12, top, 24, 18);
        ctx.fillStyle = "#ffb23e"; ctx.fillText(letterOf(i), x, top + 9);
      }
      for (let j = 0; j < rows; j++) {
        const y = this.ty + (j + 0.5) * cell * s;
        if (y < 0 || y > this.H) continue;
        ctx.fillStyle = "rgba(12,15,18,.78)"; ctx.fillRect(left, y - 9, 24, 18);
        ctx.fillStyle = "#ffb23e"; ctx.fillText(String(j + 1), left + 12, y);
      }
      ctx.restore();
    }

    _mark(m) {
      const ctx = this.ctx;
      const cx = this.tx + m.x * this.s, cy = this.ty + m.y * this.s;
      ctx.save();
      ctx.strokeStyle = m.color; ctx.fillStyle = m.color; ctx.lineWidth = 2;
      if (m.square) {
        // широкий квадратний «приціл» промаху: рамка з кутами
        const half = Math.max(22, Math.min(46, 18 * Math.sqrt(this.s / this.minS))), k = half * 0.45;
        ctx.setLineDash([]); ctx.lineWidth = 2.5; ctx.strokeStyle = m.color; ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = 3;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const px = cx + sx * half, py = cy + sy * half;
          ctx.moveTo(px - sx * k, py); ctx.lineTo(px, py); ctx.lineTo(px, py - sy * k);
        }
        ctx.stroke();
        ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.strokeRect(cx - half, cy - half, half * 2, half * 2); ctx.globalAlpha = 1;
        ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(cx, cy, 2, 0, 7); ctx.fill();
        ctx.shadowBlur = 0;
        if (m.label) { ctx.font = "600 12px 'IBM Plex Sans', system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(13,16,13,.85)"; ctx.strokeText(m.label, cx + half + 5, cy - half + 6); ctx.fillText(m.label, cx + half + 5, cy - half + 6); }
        ctx.restore();
        return;
      }
      if (m.rect) {
        const [rx, ry, rw, rh] = m.rect;
        ctx.lineWidth = 2.5;
        ctx.fillStyle = "rgba(255,178,62,.12)";
        ctx.fillRect(this.tx + rx * this.s, this.ty + ry * this.s, rw * this.s, rh * this.s);
        ctx.strokeRect(this.tx + rx * this.s, this.ty + ry * this.s, rw * this.s, rh * this.s);
        ctx.restore();
        return;
      } else if (m.cross) {
        const k = 6;
        ctx.beginPath();
        ctx.moveTo(cx - k, cy - k); ctx.lineTo(cx + k, cy + k);
        ctx.moveTo(cx - k, cy + k); ctx.lineTo(cx + k, cy - k);
        ctx.stroke();
      } else {
        const rr = Math.max(8, (m.r || 14) * this.s);
        if (m.dashed) ctx.setLineDash([5, 3]);
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      }
      if (m.label) {
        ctx.setLineDash([]);
        ctx.font = "600 12px 'IBM Plex Sans', system-ui, sans-serif";
        ctx.textBaseline = "middle";
        const off = m.cross ? 10 : Math.max(10, (m.r || 14) * this.s) + 5;
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(13,16,13,.85)";
        ctx.strokeText(m.label, cx + off, cy);
        ctx.fillText(m.label, cx + off, cy);
      }
      ctx.restore();
    }

    // ---------- події
    _local(e) {
      const r = this.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    _down(e) {
      if (e.button === 2) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, this._local(e));
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = {d: Math.hypot(a[0] - b[0], a[1] - b[1])};
        this.drag = null;
        return;
      }
      this.anim = null;
      const [x, y] = this._local(e);
      this.drag = {x, y, moved: 0};
    }

    _move(e) {
      if (!this.pointers.has(e.pointerId)) return;
      const p = this._local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (this.pinch.d > 0) this.zoomAt(d / this.pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, false);
        this.pinch.d = d;
        return;
      }
      const dr = this.drag;
      if (!dr) return;
      const dx = p[0] - dr.x, dy = p[1] - dr.y;
      dr.moved += Math.abs(dx) + Math.abs(dy);
      if (dr.moved > 4 && this.img) {
        this.canvas.classList.add("dragging");
        [this.s, this.tx, this.ty] = this._clamped(this.s, this.tx + dx, this.ty + dy);
        this.draw();
      }
      dr.x = p[0]; dr.y = p[1];
    }

    _up(e, cancel) {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      this.canvas.classList.remove("dragging");
      if (this.pinch) {
        if (this.pointers.size < 2) { this.pinch = null; this.drag = null; }
        return;
      }
      const dr = this.drag;
      this.drag = null;
      if (!cancel && dr && dr.moved <= 4 && this.onLeft && this.img) this.onLeft(...this._local(e));
    }
  }

  window.Viewer = Viewer;
  window.squareName = squareName;
})();
