/* Пакет знімка: превʼю (до 2048 пкс) + плитки 1024×1024 у повній роздільності, усе JPEG в одному файлі.
   Формат: "PSK1" | u32 довжина заголовка | JSON {w,h,preview:[off,len,w,h],tiles:[[x,y,w,h,off,len],…]} | дані. */
(function () {
  const TILE = 1024, PREVIEW = 2048;

  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  const toBlob = (cv, q) => new Promise((r) => cv.toBlob(r, "image/jpeg", q));
  const dims = (s) => [s.naturalWidth || s.width, s.naturalHeight || s.height];

  async function toCanvas(src) {
    if (src && src.full) return src.full();
    if (src instanceof HTMLCanvasElement) return src;
    const [w, h] = dims(src);
    const c = canvas(w, h);
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
  }

  /* opt.reuse (TiledImage) + opt.dirty ([{x,y,w,h}]): плитки поза зміненими ділянками беруться зі старого пакета як є —
     без повторного JPEG-стиснення (якість решти знімка не падає) і швидше. */
  async function build(src, opt = {}) {
    const full = await toCanvas(src);
    const hit = (x, y, w, h) => !opt.dirty || opt.dirty.some((r) => r.x < x + w && r.x + r.w > x && r.y < y + h && r.y + r.h > y);
    const addBlob = async (b) => { const u = new Uint8Array(await b.arrayBuffer()); parts.push(u); const r = [off, u.byteLength]; off += u.byteLength; return r; };
    const w = full.width, h = full.height;
    const parts = [], header = {w, h, tiles: []};
    let off = 0;
    const add = async (cv, q) => { const b = new Uint8Array(await (await toBlob(cv, q)).arrayBuffer()); parts.push(b); const r = [off, b.byteLength]; off += b.byteLength; return r; };
    const k = Math.min(1, PREVIEW / Math.max(w, h));
    const pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
    const pv = k === 1 ? full : canvas(pw, ph);
    if (k < 1) { const c = pv.getContext("2d"); c.imageSmoothingQuality = "high"; c.drawImage(full, 0, 0, pw, ph); }
    header.preview = [...await add(pv, k === 1 ? 0.92 : 0.85), pw, ph];
    if (k < 1) {
      for (let y = 0; y < h; y += TILE) for (let x = 0; x < w; x += TILE) {
        const tw = Math.min(TILE, w - x), th = Math.min(TILE, h - y);
        const old = opt.reuse && opt.reuse.tiles && !hit(x, y, tw, th) && opt.reuse.tiles.find((q) => q.x === x && q.y === y && q.w === tw && q.h === th);
        if (old) { header.tiles.push([x, y, tw, th, ...await addBlob(old.blob)]); continue; }
        const t = canvas(tw, th);
        t.getContext("2d").drawImage(full, x, y, tw, th, 0, 0, tw, th);
        header.tiles.push([x, y, tw, th, ...await add(t, 0.9)]);
      }
    }
    const hb = new TextEncoder().encode(JSON.stringify(header));
    const bytes = new Uint8Array(8 + hb.byteLength + off);
    bytes.set([0x50, 0x53, 0x4b, 0x31]);
    new DataView(bytes.buffer).setUint32(4, hb.byteLength, true);
    bytes.set(hb, 8);
    let p = 8 + hb.byteLength;
    for (const b of parts) { bytes.set(b, p); p += b.byteLength; }
    return {w, h, bytes};
  }

  function decode(blob) {
    if (window.createImageBitmap) return createImageBitmap(blob);
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); });
  }

  class TiledImage {
    constructor(header, buf, base, preview) {
      this.width = header.w; this.height = header.h;
      this.preview = preview;
      this.tiles = header.tiles.map(([x, y, w, h, off, len]) => ({x, y, w, h, blob: new Blob([new Uint8Array(buf, base + off, len)], {type: "image/jpeg"}), bmp: null, p: null}));
      this.onTile = null;
    }
    load(t) {
      if (!t.p) t.p = decode(t.blob).then((b) => { t.bmp = b; if (this.onTile) this.onTile(); return b; });
      return t.p;
    }
    drawTo(ctx, tx, ty, s, W, H) {
      ctx.drawImage(this.preview, tx, ty, this.width * s, this.height * s);
      if (!this.tiles.length || s <= (this.preview.width / this.width) * 1.05) return;
      for (const t of this.tiles) {
        const x = tx + t.x * s, y = ty + t.y * s, w = t.w * s, h = t.h * s;
        if (x > W || y > H || x + w < 0 || y + h < 0) continue;
        if (t.bmp) ctx.drawImage(t.bmp, x, y, w + 0.6, h + 0.6); else this.load(t);
      }
    }
    async full() {
      if (!this.tiles.length) { const c = canvas(this.width, this.height); c.getContext("2d").drawImage(this.preview, 0, 0, this.width, this.height); return c; }
      const c = canvas(this.width, this.height), ctx = c.getContext("2d");
      await Promise.all(this.tiles.map((t) => this.load(t)));
      for (const t of this.tiles) ctx.drawImage(t.bmp, t.x, t.y);
      return c;
    }
  }

  async function open(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength < 8 || dv.getUint32(0) !== 0x50534b31) throw new Error("Пошкоджений знімок");
    const hl = dv.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
    const base = 8 + hl;
    const [off, len] = header.preview;
    const preview = await decode(new Blob([new Uint8Array(buf, base + off, len)], {type: "image/jpeg"}));
    return new TiledImage(header, buf, base, preview);
  }

  window.Tiles = {build, open, toCanvas, TiledImage};
})();
