/* Ознаки на фото: прямокутники з підписами поверх зображення довідника (частки 0..1 від розміру фото).
   • Marks.overlay — показ (номери або підписи) поверх <img> з object-fit: contain;
   • Marks.edit — редактор для адміністратора: обвести ознаку пальцем/мишею, підписати, зберегти.
   Дані: Game.marks = {id фото: [{x,y,w,h,t}]} — приходять із конфігурацією (працює й офлайн). */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => (window.UI ? UI.esc(s) : String(s));
  const NUM = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

  /* Прямокутник, у якому справді намальовано фото (object-fit: contain), відносно батьківського блока. */
  function rect(img) {
    const nw = img.naturalWidth, nh = img.naturalHeight, cw = img.clientWidth, ch = img.clientHeight;
    if (!nw || !nh || !cw || !ch) return null;
    const s = Math.min(cw / nw, ch / nh), w = nw * s, h = nh * s;
    return {x: img.offsetLeft + (cw - w) / 2, y: img.offsetTop + (ch - h) / 2, w, h};
  }
  function layout(layer, img) {
    const r = rect(img);
    if (!r) { layer.style.display = "none"; return; }
    layer.style.display = "";
    layer.style.left = r.x + "px"; layer.style.top = r.y + "px"; layer.style.width = r.w + "px"; layer.style.height = r.h + "px";
  }
  const boxHtml = (m, i, labels) => `<div class="mk-box${m.y < 0.07 ? " mk-top" : ""}" style="left:${m.x * 100}%;top:${m.y * 100}%;width:${m.w * 100}%;height:${m.h * 100}%"><b class="mk-n">${labels && m.t ? `${NUM[i] || i + 1} ${esc(m.t)}` : NUM[i] || i + 1}</b></div>`;

  const Marks = {
    NUM,
    of(img) { return (window.Game && Game.marks && Game.marks[img]) || null; },
    /* Перше фото зі списку, для якого є ознаки (список: [{id,…}] або [id]). */
    firstMarked(list) { for (const p of list || []) { const id = typeof p === "string" ? p : p && p.id; if (id && this.of(id)) return p; } return null; },
    /* Накласти ознаки на фото. parent — блок із position: relative, у якому лежить img. labels — писати підписи (не лише номери). */
    overlay(parent, img, marks, opt = {}) {
      this.clear(parent);
      if (!parent || !img || !marks || !marks.length) return null;
      const layer = document.createElement("div"); layer.className = "mk-layer" + (opt.labels ? " mk-labels" : "");
      layer.innerHTML = marks.map((m, i) => boxHtml(m, i, opt.labels)).join("");
      parent.appendChild(layer);
      const re = () => layout(layer, img);
      if (img.complete && img.naturalWidth) re(); else layer.style.display = "none";
      img.addEventListener("load", re);
      if (window.ResizeObserver) { const ro = new ResizeObserver(re); ro.observe(img); layer._ro = ro; }
      layer._img = img; layer._re = re;
      addEventListener("resize", re);
      return layer;
    },
    clear(parent) {
      if (!parent) return;
      parent.querySelectorAll(":scope > .mk-layer").forEach((l) => { if (l._ro) l._ro.disconnect(); if (l._img && l._re) { l._img.removeEventListener("load", l._re); removeEventListener("resize", l._re); } l.remove(); });
    },
    legend(marks) { return (marks || []).filter((m) => m.t).map((m, i) => `<b>${NUM[i] || i + 1}</b> ${esc(m.t)}`).join(" · "); },

    /* Редактор: url — адреса фото, marks — поточна розмітка, suggest — готові підписи (ознаки з опису), onSave(marks). */
    edit({url, marks, title, suggest, onSave}) {
      let box = $("mk"); if (!box) { box = document.createElement("div"); box.id = "mk"; box.className = "modal mk-modal"; document.body.appendChild(box); }
      const list = (marks || []).map((m) => Object.assign({}, m));
      let cur = list.length - 1;
      box.hidden = false;
      box.innerHTML = `<div class="m-card mk-card"><div class="m-head"><h2>Ознаки на фото</h2><button type="button" class="link" id="mk-x">Закрити</button></div>
        <p class="muted small">${title ? `<b>${esc(title)}</b>. ` : ""}Обведіть ознаку на фото (проведіть пальцем або мишею), потім підпишіть її. До 8 ознак. Курсант побачить їх після відповіді в «Картках» і в довіднику.</p>
        <div class="mk-stage" id="mk-stage"><img id="mk-img" alt="" draggable="false"></div>
        <ol class="mk-list" id="mk-list"></ol>
        ${suggest && suggest.length ? `<p class="muted small">Готові підписи з опису — торкніться, щоб підписати виділену ознаку:</p><div class="mk-sugg" id="mk-sugg">${suggest.slice(0, 8).map((t, i) => `<button type="button" data-sg="${i}">${esc(t.length > 70 ? t.slice(0, 68) + "…" : t)}</button>`).join("")}</div>` : ""}
        <div class="row"><button type="button" class="primary" id="mk-save">Зберегти</button><button type="button" id="mk-cancel">Скасувати</button></div>
        <p class="status" id="mk-st"></p></div>`;
      const img = $("mk-img"), stage = $("mk-stage"), say = (t, c = "") => { $("mk-st").textContent = t; $("mk-st").className = "status " + c; };
      const close = () => { Marks.clear(stage); box.hidden = true; };
      $("mk-x").onclick = close; $("mk-cancel").onclick = close;
      box.onclick = (e) => { if (e.target === box) close(); };
      let layer = null;
      const draw = () => {
        layer = this.overlay(stage, img, list.length ? list : [{x: 0, y: 0, w: 0, h: 0}], {});
        if (!list.length) layer.innerHTML = "";
        layer.classList.add("mk-edit");
        [...layer.children].forEach((b, i) => b.classList.toggle("sel", i === cur));
        $("mk-list").innerHTML = list.map((m, i) => `<li class="${i === cur ? "sel" : ""}" data-i="${i}"><b>${NUM[i] || i + 1}</b><input data-t="${i}" maxlength="80" value="${esc(m.t || "")}" placeholder="що це за ознака, напр. «мангал» над баштою"><button type="button" data-rm="${i}" title="Прибрати">✕</button></li>`).join("")
          || `<li class="muted small">Ще немає ознак — обведіть першу на фото.</li>`;
        $("mk-list").querySelectorAll("[data-t]").forEach((inp) => { inp.oninput = () => { list[+inp.dataset.t].t = inp.value; }; inp.onfocus = () => { cur = +inp.dataset.t; [...layer.children].forEach((b, i) => b.classList.toggle("sel", i === cur)); $("mk-list").querySelectorAll("li").forEach((li) => li.classList.toggle("sel", +li.dataset.i === cur)); }; });
        $("mk-list").querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { list.splice(+b.dataset.rm, 1); cur = Math.min(cur, list.length - 1); draw(); }));
      };
      if ($("mk-sugg")) $("mk-sugg").querySelectorAll("[data-sg]").forEach((b) => (b.onclick = () => {
        if (cur < 0 || !list[cur]) return say("Спершу обведіть ознаку на фото.", "no");
        list[cur].t = suggest[+b.dataset.sg].slice(0, 80); draw(); say("");
      }));
      // малювання: pointerdown → pointermove → pointerup; координати — частки від прямокутника фото
      let start = null, tmp = null;
      const frac = (e) => { const r = rect(img); if (!r) return null; const s = stage.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - s.left - r.x) / r.w)), Math.max(0, Math.min(1, (e.clientY - s.top - r.y) / r.h))]; };
      stage.onpointerdown = (e) => {
        if (list.length >= 8) return say("Не більше 8 ознак на фото.", "no");
        const f = frac(e); if (!f) return;
        start = f; stage.setPointerCapture(e.pointerId); e.preventDefault();
        tmp = document.createElement("div"); tmp.className = "mk-box mk-tmp"; (layer || stage).appendChild(tmp);
      };
      stage.onpointermove = (e) => {
        if (!start || !tmp) return;
        const f = frac(e); if (!f) return;
        const x = Math.min(start[0], f[0]), y = Math.min(start[1], f[1]), w = Math.abs(f[0] - start[0]), h = Math.abs(f[1] - start[1]);
        Object.assign(tmp.style, {left: x * 100 + "%", top: y * 100 + "%", width: w * 100 + "%", height: h * 100 + "%"});
      };
      const up = (e) => {
        if (!start) return;
        const f = frac(e) || start, x = Math.min(start[0], f[0]), y = Math.min(start[1], f[1]), w = Math.abs(f[0] - start[0]), h = Math.abs(f[1] - start[1]);
        start = null; if (tmp) tmp.remove(); tmp = null;
        if (w < 0.02 || h < 0.02) return;   // випадковий дотик
        list.push({x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4), t: ""}); cur = list.length - 1; draw(); say("");
        const inp = $("mk-list").querySelector(`[data-t="${cur}"]`); if (inp && !matchMedia("(pointer: coarse)").matches) inp.focus();
      };
      stage.onpointerup = up; stage.onpointercancel = up;
      $("mk-save").onclick = async () => {
        const out = list.filter((m) => m.w >= 0.01 && m.h >= 0.01).map((m) => ({x: m.x, y: m.y, w: m.w, h: m.h, t: String(m.t || "").trim().slice(0, 80)}));
        if (out.some((m) => !m.t) && !confirm("Є ознаки без підпису — зберегти їх лише номерами?")) return;
        $("mk-save").disabled = true; say("Зберігаю…");
        try { await onSave(out); close(); } catch (e) { say(e.message, "no"); $("mk-save").disabled = false; }
      };
      img.onload = () => draw();
      img.src = url;
      if (img.complete && img.naturalWidth) draw();
    },
  };
  window.Marks = Marks;
})();
