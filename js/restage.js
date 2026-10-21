/* Адмінка: «Оновити етапи» — перерендер уже створених етапів новою обробкою техніки (Compose.harmonize)
   з автоматичним бекапом на сервері й відновленням однією кнопкою.
   Як працює для кожної цілі: береться чиста карта, з якої етап зроблено; стара обробка (ComposeLegacy)
   перебором підбирає кут і ступінь маскування так, щоб збігтися зі старим знімком; по сліду старої техніки
   й тіні повертаються пікселі чистої карти (накати й решта знімка не чіпаються); новий рендер — на те саме місце
   під тим самим кутом. Координати цілей не змінюються, тож статистика кліків лишається чинною. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.esc(s);
  const lumOf = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  const ReStage = {
    async open(admin) {
      this.admin = admin; this.pw = admin.pw;
      await admin.flushSave();
      if (!admin.objects) await admin.loadObjects();
      let box = $("rs");
      if (!box) { box = document.createElement("div"); box.id = "rs"; box.className = "modal"; document.body.appendChild(box); }
      box.hidden = false;
      try { this.backups = new Set((await API.call("backups_list", {}, this.pw)).backups.map((b) => b.id)); } catch (e) { this.backups = new Set(); }
      this.sel = this.sel || null;
      this.render();
    },

    close() { $("rs").hidden = true; this.admin.renderList(); },

    /* Карта, з якої зроблено етап: її назва — початок назви етапу (« · »), той самий розмір. */
    sourceMap(s) {
      if (s.src) { const m = this.admin.stages.find((x) => x.id === s.src); if (m) return m; }   // новіші етапи знають карту за id
      // джерелом може бути й етап з розміткою (генератор бере «З вибраного етапу») — важить назва й розмір; чиста карта — у пріоритеті
      const c = this.admin.stages.filter((m) => m.id !== s.id && !m.cond && s.title.startsWith(m.title + " · ") && (!m.w || !s.w || (m.w === s.w && m.h === s.h)));
      return c.sort((a, b) => b.title.length - a.title.length || a.targets.length - b.targets.length)[0] || null;
    },
    hasModels(s) { const ids = new Set((this.admin.objects || []).map((o) => o.id)); return s.targets.some((t) => t.obj && ids.has(t.obj)); },

    list() {
      return this.admin.stages.filter((s) => s.targets.length).map((s) => {
        const map = this.sourceMap(s), ok = !!map && this.hasModels(s);
        if (s.cond) return {s, map: null, ok: false, why: s.cond === "thermal" ? "тепловізійний варіант" : "зимовий варіант"};
        return {s, map, ok, why: !s.targets.some((t) => t.obj) ? "справжній знімок з розміткою — не чіпаємо" : !map ? "не знайдено карти, з якої його зроблено" : !this.hasModels(s) ? "моделі видалено з бібліотеки" : ""};
      }).sort((a, b) => b.ok - a.ok);
    },

    render() {
      const L = this.list(), okIds = L.filter((x) => x.ok).map((x) => x.s.id);
      if (!this.sel) this.sel = new Set(okIds.filter((id) => !this.backups.has(id)));   // типово — ще не оновлені
      $("rs").innerHTML = `<div class="m-card">
        <div class="m-head"><h2>♻ Оновити етапи під нову обробку</h2><button type="button" class="link" id="rs-x">Закрити</button></div>
        <p class="muted small">Техніка на вибраних етапах перемальовується новим алгоритмом (тон, колір, різкість, шум і тінь під ділянку знімка). Місця й кути лишаються ті самі, статистика кліків не губиться. Перед першою зміною етапу на сервері автоматично зберігається бекап — «↩ Відновити» повертає оригінал.</p>
        <div class="rs-bar"><b>Можна оновити: ${okIds.length}</b><button type="button" class="link" id="rs-all">Вибрати всі</button><button type="button" class="link" id="rs-none">Зняти всі</button></div>
        <ul class="ag-list rs-list">${L.map(({s, ok, why}) => `<li>
          <label class="chk"><input type="checkbox" data-s="${s.id}"${ok ? "" : " disabled"}${ok && this.sel.has(s.id) ? " checked" : ""}> ${esc(s.title)}
            ${this.backups.has(s.id) ? '<small class="tag ok">бекап ✓</small>' : ""}${why ? `<small class="muted"> — ${esc(why)}</small>` : ""}</label>
          <span class="rs-btns">${ok ? `<button type="button" class="link" data-prev="${s.id}">👁 Порівняти</button>` : ""}${this.backups.has(s.id) ? `<button type="button" class="link" data-rest="${s.id}">↩ Відновити</button>` : ""}</span></li>`).join("") || `<li class="muted">Етапів з технікою ще немає.</li>`}</ul>
        <div class="rs-prev" id="rs-prev" hidden></div>
        <div class="row m-foot"><button type="button" class="primary" id="rs-go">Оновити вибрані</button></div>
        <p class="status" id="rs-st" role="status"></p>
      </div>`;
      const box = $("rs");
      $("rs-x").onclick = () => this.close();
      box.onclick = (e) => { if (e.target === box && !this.busy) this.close(); };
      box.querySelectorAll("[data-s]").forEach((c) => (c.onchange = () => { c.checked ? this.sel.add(c.dataset.s) : this.sel.delete(c.dataset.s); }));
      $("rs-all").onclick = () => { this.sel = new Set(okIds); this.render(); };
      $("rs-none").onclick = () => { this.sel = new Set(); this.render(); };
      box.querySelectorAll("[data-prev]").forEach((b) => (b.onclick = () => this.preview(b.dataset.prev)));
      box.querySelectorAll("[data-rest]").forEach((b) => (b.onclick = () => this.restore(b.dataset.rest)));
      $("rs-go").onclick = () => this.run();
    },

    say(t, cls = "") { const s = $("rs-st"); if (s) { s.textContent = t; s.className = "status " + cls; } },

    async sprite(o) {
      this.sprites = this.sprites || new Map();
      if (!this.sprites.has(o.id)) {
        let spr;
        if (o.builtin) spr = Models.sprite(o.id);
        else {
          const j = await API.call("object", {id: o.id}, this.pw);
          spr = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(Compose.prepareObject(i)); i.onerror = () => rej(new Error("модель не відкривається")); i.src = `data:${j.mime || "image/png"};base64,${j.data}`; });
        }
        this.sprites.set(o.id, spr);
      }
      return this.sprites.get(o.id);
    },
    obj(id) { return (this.admin.objects || []).find((o) => o.id === id) || null; },

    /* Перерендер одного етапу в памʼяті. Повертає {canvas, old (TiledImage), targets, dirty, pairs (для порівняння)}. */
    async rerender(s, onStep) {
      const map = this.sourceMap(s);
      if (!map) throw new Error("немає чистої карти");
      const oldT = await API.loadImage(s.id, this.pw), clean = await Tiles.toCanvas(await API.loadImage(map.id, this.pw));
      const oldCv = await Tiles.toCanvas(oldT);
      if (oldCv.width !== clean.width || oldCv.height !== clean.height) throw new Error("розмір карти не збігається зі знімком етапу");
      const out = Compose.canvas(oldCv.width, oldCv.height); out.getContext("2d").drawImage(oldCv, 0, 0);
      const gsd = s.gsd || map.gsd || 0;
      let sun = 135; try { sun = Compose.shadowDir(clean); } catch (e) { /* типовий */ }
      const targets = s.targets.map((t) => Object.assign({}, t)), dirty = [], pairs = [];
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i], o = t.obj && this.obj(t.obj);
        if (!o) continue;
        if (onStep) onStep(i + 1, targets.length);
        const spr = await this.sprite(o);
        const size = Math.max(3, Math.min(160, t.r > 8 ? t.r / 0.6 : gsd > 0 ? Logic.lengthOf(o) / gsd : 16));
        const slen = gsd > 0 ? Math.min(40, Math.max(2, 2.2 / gsd)) : Math.max(2, size * 0.3);
        const r = await this.redo(out, clean, spr, t, size, slen, sun);
        if (!r) continue;
        dirty.push(r.rect);
        if (r.hidden > 0.6) t.hidden = Math.round(r.hidden * 100) / 100; else delete t.hidden;
        pairs.push(r.pair);
        await new Promise((res) => setTimeout(res, 0));   // не морозити сторінку
      }
      return {canvas: out, old: oldT, targets, dirty, pairs};
    },

    /* Одна ціль: підбір старих параметрів → прибирання старої техніки → новий рендер. Працює на локальному вікні. */
    async redo(out, clean, spr, t, size, slen, sun, opt = {}) {
      const W = out.width, H = out.height, CR = Math.ceil(Math.max(48, size * 2.6 + slen + 12));
      const x0 = Math.max(0, Math.round(t.x - CR)), y0 = Math.max(0, Math.round(t.y - CR));
      const w = Math.min(W, Math.round(t.x + CR)) - x0, h = Math.min(H, Math.round(t.y + CR)) - y0;
      if (w < 16 || h < 16) return null;
      const cx = t.x - x0, cy = t.y - y0;
      const crop = (src) => { const c = Compose.canvas(w, h); c.getContext("2d").drawImage(src, x0, y0, w, h, 0, 0, w, h); return c; };
      const cl = crop(clean), ol = crop(out), sc = Compose.canvas(w, h), sx = sc.getContext("2d");
      const cd = cl.getContext("2d").getImageData(0, 0, w, h).data, od = ol.getContext("2d").getImageData(0, 0, w, h).data;
      const base = {size, sharp: 0.3, shade: 0.25, shadow_dir: sun, shadow_len: slen, shadow_op: 0.55, shadow_soft: 0.7, blend: 0.08, darken: 0, sat: 0.9, grain: 0.35, blur: 0.35};
      const dif3 = (d, e, i) => Math.max(Math.abs(d[i] - e[i]), Math.abs(d[i + 1] - e[i + 1]), Math.abs(d[i + 2] - e[i + 2]));
      // ---- підбір старих параметрів — у зменшеній копії (техніка ≈24 пкс): у десятки разів швидше, точності досить
      const f = Math.min(1, 24 / size), fw = Math.max(16, Math.round(w * f)), fh = Math.max(16, Math.round(h * f)), fk = fw / w;
      const down = (c) => { const d = Compose.canvas(fw, fh), x = d.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, fw, fh); return d; };
      const clS = down(cl), scS = Compose.canvas(fw, fh), sxS = scS.getContext("2d");
      const cdS = clS.getContext("2d").getImageData(0, 0, fw, fh).data, odS = down(ol).getContext("2d").getImageData(0, 0, fw, fh).data;
      const fcx = cx * fk, fcy = cy * fk, rr = (size * 0.75 + slen * 0.6) * fk, pts = [];
      for (let y = Math.max(0, Math.floor(fcy - rr)); y < Math.min(fh, Math.ceil(fcy + rr)); y++) for (let x = Math.max(0, Math.floor(fcx - rr)); x < Math.min(fw, Math.ceil(fcx + rr)); x++)
        if ((x - fcx) ** 2 + (y - fcy) ** 2 <= rr * rr) pts.push((y * fw + x) * 4);
      const renderS = (o) => {
        sxS.drawImage(clS, 0, 0);
        ComposeLegacy.compose(clS, scS, spr, fcx, fcy, Object.assign({}, base, o, {size: (o.size || base.size) * fk, shadow_len: slen * fk}));
        return sxS.getImageData(0, 0, fw, fh).data;
      };
      // збіг форми (IoU масок «відрізняється від чистої карти»), а не кольору: працює, навіть якщо модель відтоді замінили
      const oldM = pts.map((i) => dif3(odS, cdS, i) > 14);
      const h0 = t.hidden || 0, s0 = size;
      const err = (sz, op, a) => {
        const d = renderS({size: sz, shadow_op: op, angle: a, hideTarget: h0});
        let I = 0, U = 0;
        pts.forEach((i, k) => { const p = dif3(d, cdS, i) > 14, q = oldM[k]; if (p && q) I++; if (p || q) U++; });
        const e = U ? 1 - I / U : 1;
        if (this.debug) this.debug.push([sz, op, a, Math.round(e * 1000) / 1000]);
        return e;
      };
      // розмір (у старих етапах радіус цілі рахувався інакше) × кут × тінь (ранні етапи — без тіні)
      let best = [Infinity, s0, 0, 0];   // [похибка, розмір, тінь, кут]
      for (const k of [0.6, 0.75, 0.9, 1.05, 1.2]) for (let a = 0; a < 360; a += 20) { const e = err(s0 * k, 0, a); if (e < best[0]) best = [e, s0 * k, 0, a]; }
      for (const op of [0, 0.55]) for (let a = 0; a < 360; a += 10) { const e = err(best[1], op, a); if (e < best[0]) best = [e, best[1], op, a]; }
      for (const k of [0.92, 0.96, 1.04, 1.08]) { const e = err(best[1] * k, best[2], best[3]); if (e < best[0]) best = [e, best[1] * k, best[2], best[3]]; }
      for (const da of [-6, -3, 3, 6]) { const a = (best[3] + da + 360) % 360, e = err(best[1], best[2], a); if (e < best[0]) best = [e, best[1], best[2], a]; }
      base.size = size = best[1]; base.shadow_op = best[2];
      let angle = best[3];
      // перед/корма: форма майже симетрична — вирішує збіг яскравості (кабіна, пакет, башта)
      const lumErr = (ang) => { const d = renderS({angle: ang, hideTarget: h0}); let e = 0; for (const i of pts) e += Math.abs(lumOf(d, i) - lumOf(odS, i)); return e; };
      const flip = (angle + 180) % 360;
      if (err(size, base.shadow_op, flip) - best[0] < 0.04 && lumErr(flip) < lumErr(angle)) angle = flip;
      // маскування: яка частка силуету (без тіні) справді відрізняється від чистої карти — решта була під кронами.
      // Не через підгонку: модель у бібліотеці могли замінити новою версією, і тоді «сховати більше» хибно виглядає краще.
      const vd = renderS({angle, hideTarget: 0, shadow_op: 0, grain: 0, shade: 0});
      let nS = 0, nV = 0;
      for (let i = 0; i < fw * fh * 4; i += 4) {
        const dv = dif3(vd, cdS, i); if (dv <= 10) continue;
        nS++;
        if (dif3(odS, cdS, i) >= Math.max(6, dv * 0.4)) nV++;
      }
      let hide = nS ? Math.max(0, Math.min(0.85, 1 - nV / nS - 0.12)) : 0;
      hide = hide < 0.15 ? 0 : Math.round(hide * 20) / 20;   // дрібні «сховано» — це шум порівняння, не крони
      if (t.hidden > 0.6) hide = Math.max(hide, t.hidden);
      else if (hide > 0.6) hide = 0.6;   // поза хардкором — не більше 60%, як і раніше
      const hb = [0, hide];
      // слід старої техніки + тіні (стара обробка з підібраними параметрами) ∪ явна різниця під корпусом
      sx.drawImage(cl, 0, 0);
      ComposeLegacy.compose(cl, sc, spr, cx, cy, Object.assign({}, base, {angle, hideTarget: hb[1]}));
      const ld = sx.getImageData(0, 0, w, h).data, mc = Compose.canvas(w, h), mx = mc.getContext("2d"), md = mx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const j = i * 4, x = i % w, y = (i - x) / w;
        const leg = Math.max(Math.abs(ld[j] - cd[j]), Math.abs(ld[j + 1] - cd[j + 1]), Math.abs(ld[j + 2] - cd[j + 2])) > 4;
        const near = (x - cx) ** 2 + (y - cy) ** 2 <= (size * 0.62) ** 2 && Math.abs(lumOf(od, j) - lumOf(cd, j)) > 12;
        md.data[j + 3] = leg || near ? 255 : 0;
      }
      mx.putImageData(md, 0, 0);
      const fm = Compose.canvas(w, h), fx = fm.getContext("2d");
      fx.filter = "blur(1.5px)"; fx.drawImage(mc, 0, 0); fx.drawImage(mc, 0, 0); fx.filter = "none";   // розширити й пом'якшити край
      const m = fx.getImageData(0, 0, w, h).data, rest = new ImageData(w, h), rd = rest.data;
      for (let i = 0; i < w * h; i++) {
        const j = i * 4, a = Math.min(1, m[j + 3] / 255 * 2.5);
        for (let c = 0; c < 3; c++) rd[j + c] = od[j + c] * (1 - a) + cd[j + c] * a;
        rd[j + 3] = 255;
      }
      const rp = Compose.canvas(w, h), rx = rp.getContext("2d"); rx.putImageData(rest, 0, 0);
      const before = Compose.canvas(w, h); before.getContext("2d").drawImage(ol, 0, 0);
      // лише прибрати стару техніку (для зимових/тепловізійних варіантів — нову ставить Variants)
      if (opt.removeOnly) { out.getContext("2d").drawImage(rp, x0, y0); return {rect: {x: x0, y: y0, w, h}, angle, hide: hb[1], size}; }
      const res = Compose.compose(rp, rp, spr, cx, cy, {size, angle, hideTarget: hb[1], shade: 0.25, shadow_dir: sun, shadow_len: slen});
      out.getContext("2d").drawImage(rp, x0, y0);
      return {rect: {x: x0, y: y0, w, h}, hidden: res ? res.hidden : 0, angle, hide: hb[1], pair: [before, rp, `${t.type || "ціль"} · кут ${angle}° · сховано ≈${Math.round((res ? res.hidden : 0) * 100)}%`]};
    },

    async preview(id) {
      const s = this.admin.stages.find((x) => x.id === id); if (!s || this.busy) return;
      this.busy = true; this.say(`Рендерю «${s.title}» для порівняння…`);
      try {
        const r = await this.rerender(s, (i, n) => this.say(`Ціль ${i}/${n}…`));
        const box = $("rs-prev"); box.hidden = false; box.innerHTML = `<p class="muted small">Ліворуч — як зараз, праворуч — нова обробка (збільшено ×3). Нічого не збережено.</p>`;
        for (const [a, b, label] of r.pairs) {
          const k = Math.min(3, 220 / a.width), c = Compose.canvas(a.width * k * 2 + 8, a.height * k), x = c.getContext("2d");
          x.imageSmoothingEnabled = false; x.drawImage(a, 0, 0, a.width * k, a.height * k); x.drawImage(b, a.width * k + 8, 0, a.width * k, a.height * k);
          const fig = document.createElement("figure"); fig.appendChild(c); const cap = document.createElement("figcaption"); cap.textContent = label; fig.appendChild(cap); box.appendChild(fig);
        }
        this.say(r.pairs.length ? "Порівняння готове." : "На етапі немає моделей для перерендеру.", r.pairs.length ? "ok" : "");
      } catch (e) { this.say("Не вдалось: " + e.message, "no"); }
      this.busy = false;
    },

    async run() {
      if (this.busy) return;
      const L = this.list().filter((x) => x.ok && this.sel.has(x.s.id));
      if (!L.length) return this.say("Виберіть хоча б один етап.", "no");
      this.busy = true; $("rs-go").disabled = true;
      let done = 0;
      const fail = [];
      for (const {s} of L) {
        try {
          const pre = `Етап ${done + fail.length + 1}/${L.length} «${s.title}»`;
          this.say(`${pre}: рендерю…`);
          const r = await this.rerender(s, (i, n) => this.say(`${pre}: ціль ${i}/${n}…`));
          this.say(`${pre}: пакую…`);
          const pack = await Tiles.build(r.canvas, {reuse: r.old, dirty: r.dirty});
          const b = await API.call("stage_reimage_begin", {id: s.id, size: pack.bytes.byteLength}, this.pw);   // тут сервер робить бекап
          this.backups.add(s.id);
          for (let i = 0; i < b.chunks; i++) {
            this.say(`${pre}: вивантажую ${i + 1}/${b.chunks}…`);
            const part = pack.bytes.subarray(i * b.chunk, Math.min(pack.bytes.byteLength, (i + 1) * b.chunk));
            let ok = false, err = null;
            for (let k = 0; k < 3 && !ok; k++) {
              try { const q = await fetch(`${API.url}/blob/${b.id}/${i}`, {method: "PUT", headers: {"X-Token": b.token}, body: part}); const j = await q.json(); ok = j.ok; err = j.error; }
              catch (e) { err = "Немає зв'язку з сервером"; }
            }
            if (!ok) throw new Error(err || "не вдалось вивантажити");
          }
          const fin = await API.call("stage_reimage_end", {id: s.id}, this.pw);   // підміна знімка — лише коли все завантажено
          s.v = fin.stage && fin.stage.v; API.noteStages([s]);
          await API.call("save_stage", {id: s.id, targets: r.targets}, this.pw);
          s.targets = r.targets;
          API.imgCache.set(s.id, Tiles.open(pack.bytes.buffer.slice(pack.bytes.byteOffset, pack.bytes.byteOffset + pack.bytes.byteLength)));
          done++;
        } catch (e) { fail.push(`${s.title}: ${e.message}`); }
      }
      this.busy = false;
      this.sel = new Set();
      this.render();
      this.say(`Оновлено етапів: ${done}${fail.length ? `. Не вдалось: ${fail.join("; ")} (оригінали не змінено або є бекап)` : ""}.`, fail.length ? "no" : "ok");
    },

    async restore(id) {
      const s = this.admin.stages.find((x) => x.id === id);
      if (!s || this.busy || !confirm(`Повернути етап «${s.title}» до оригіналу з бекапу?`)) return;
      this.busy = true;
      try {
        const j = await API.call("stage_restore", {id}, this.pw);
        s.targets = j.stage.targets; s.v = j.stage.v; API.imgCache.delete(id); API.noteStages([s]);
        this.say(`«${s.title}» повернуто до оригіналу. Бекап лишився.`, "ok");
      } catch (e) { this.say(e.message, "no"); }
      this.busy = false;
    },
  };

  window.ReStage = ReStage;
})();
