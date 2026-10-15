/* «Довідник техніки»: перегляд без оцінок — фото, ТТХ і характерні ознаки з навчальної таблиці.
   Дані й зображення лежать у базі (доступ лише після входу), а не в коді сайту. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.esc(s);
  const norm = (s) => (window.Cards ? Cards.norm(s) : String(s || "").toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, ""));
  const plain = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  // у текстах із таблиці дозволено лише <b>; решта вже екранована при імпорті
  const safe = (h) => String(h || "").replace(/<(?!\/?b>)/g, "&lt;");

  const Ref = {
    entries: null, cat: "", q: "",

    async open() {
      if (!Game.password) return;
      UI.show("s-ref");
      document.body.dataset.mode = "ref";
      $("r-back").onclick = () => this.close();
      $("r-q").oninput = (e) => { this.q = e.target.value; this.renderList(); };
      $("r-q").value = this.q;
      this.closeDetail();
      if (!this.entries) {
        $("r-list").innerHTML = `<p class="muted r-empty">Завантажую довідник…</p>`;
        try { this.entries = (await API.call("ref_list", {}, Game.password)).entries || []; }
        catch (e) { $("r-list").innerHTML = `<p class="err r-empty">${esc(e.message)}</p>`; return; }
      }
      this.renderCats(); this.renderList();
    },
    close() { this.closeDetail(); Game.showStart(); },

    cats() { const m = new Map(); (this.entries || []).forEach((e) => m.set(e.cat, (m.get(e.cat) || 0) + 1)); return [...m]; },
    renderCats() {
      const all = this.entries.length;
      $("r-cats").innerHTML = [["", `Усі`, all], ...this.cats().map(([c, n]) => [c, c, n])].map(([v, t, n]) =>
        `<button type="button" class="chip${this.cat === v ? " on" : ""}" data-cat="${esc(v)}">${esc(t)}<small>${n}</small></button>`).join("");
      $("r-cats").querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { this.cat = b.dataset.cat; SFX.click(); this.renderCats(); this.renderList(); }));
    },
    filtered() {
      const q = norm(this.q), pool = this.entries.filter((e) => !this.cat || e.cat === this.cat);
      if (!q) return pool;
      // спершу збіг у назві, далі — згадки в ТТХ/описі
      const byName = pool.filter((e) => norm(e.name).includes(q));
      const byText = q.length >= 3 ? pool.filter((e) => !byName.includes(e) && norm(plain(e.ttx) + plain(e.desc)).includes(q)) : [];
      byText.forEach((e) => (e._txt = true)); byName.forEach((e) => (e._txt = false));
      return byName.concat(byText);
    },
    renderList() {
      if (!this.entries) return;
      const list = this.filtered();
      $("r-count").textContent = `${list.length} з ${this.entries.length}`;
      if (!this.entries.length) { $("r-list").innerHTML = `<p class="muted r-empty">Довідник ще не заповнено. Адміністратору: адмінка → «📘 Довідник».</p>`; return; }
      if (!list.length) { $("r-list").innerHTML = `<p class="muted r-empty">Нічого не знайдено.</p>`; return; }
      let html = "", last = null;
      const q = !!norm(this.q);
      for (const e of list) {
        if (q) { const h = e._txt ? "Згадується в описі" : "Назва"; if (h !== last) { html += `<h3 class="r-h">${h}</h3>`; last = h; } }
        else if (!this.cat && e.cat !== last) { html += `<h3 class="r-h">${esc(e.cat)}</h3>`; last = e.cat; }
        html += `<button type="button" class="r-item" data-id="${esc(e.id)}"><span class="r-th">${e.imgs[0] ? `<img loading="lazy" alt="" data-img="${esc(e.imgs[0])}" data-v="${esc(e.v)}">` : ""}</span>
          <span class="r-nm"><b>${esc(e.name)}</b><small>${esc(plain(e.desc || e.ttx).slice(0, 90))}</small></span></button>`;
      }
      $("r-list").innerHTML = html;
      $("r-list").querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => this.show(b.dataset.id)));
      this.loadImgs($("r-list"));
    },
    async loadImgs(root) {
      for (const im of root.querySelectorAll("img[data-img]")) {
        if (im.src) continue;
        API.refUrl(im.dataset.img, im.dataset.v, Game.password).then((u) => { im.src = u; }).catch(() => {});
      }
    },

    show(id) {
      const list = this.filtered(), i = list.findIndex((e) => e.id === id), e = list[i];
      if (!e) return;
      this.cur = id;
      const prev = list[i - 1], next = list[i + 1];
      const box = $("r-detail");
      box.innerHTML = `<header class="bar top r-dh"><button type="button" class="link" id="rd-back">← До списку</button><div class="r-pn">
          <button type="button" id="rd-prev" ${prev ? "" : "disabled"} aria-label="Попередня">‹</button><button type="button" id="rd-next" ${next ? "" : "disabled"} aria-label="Наступна">›</button></div></header>
        <div class="r-body">
          <p class="r-cat">${esc(e.cat)}</p><h2>${esc(e.name)}</h2>
          ${e.imgs.length ? `<div class="r-gal">${e.imgs.map((x) => `<button type="button" class="r-ph" data-zoom="${esc(x)}"><img alt="" data-img="${esc(x)}" data-v="${esc(e.v)}"></button>`).join("")}</div>
          ${e.imgs.length > 1 ? `<p class="muted small r-hint">Гортайте фото вбік · торкніться, щоб збільшити</p>` : `<p class="muted small r-hint">Торкніться фото, щоб збільшити</p>`}` : ""}
          ${e.ttx ? `<section class="r-sec"><h3>ТТХ</h3><div class="r-txt">${safe(e.ttx)}</div></section>` : ""}
          ${e.desc ? `<section class="r-sec"><h3>Ознаки та опис</h3><div class="r-txt">${safe(e.desc)}</div></section>` : ""}
        </div>`;
      box.hidden = false; box.scrollTop = 0;
      $("rd-back").onclick = () => this.closeDetail();
      if (prev) $("rd-prev").onclick = () => this.show(prev.id);
      if (next) $("rd-next").onclick = () => this.show(next.id);
      box.querySelectorAll("[data-zoom]").forEach((b) => (b.onclick = () => this.zoom(b.querySelector("img").src)));
      this.loadImgs(box);
      if (!this._keys) {
        this._keys = (ev) => {
          if ($("s-ref").hidden) return;
          if (ev.key === "Escape") { if (!$("r-zoom").hidden) $("r-zoom").hidden = true; else if (!$("r-detail").hidden) this.closeDetail(); }
          if ($("r-detail").hidden || !$("r-zoom").hidden) return;
          if (ev.key === "ArrowLeft") $("rd-prev") && $("rd-prev").click();
          if (ev.key === "ArrowRight") $("rd-next") && $("rd-next").click();
        };
        addEventListener("keydown", this._keys);
      }
    },
    closeDetail() { $("r-detail").hidden = true; $("r-zoom").hidden = true; this.cur = null; },
    zoom(src) {
      if (!src) return;
      const z = $("r-zoom"); z.innerHTML = `<img alt="" src="${esc(src)}"><button type="button" class="r-zx" aria-label="Закрити">✕</button>`;
      z.hidden = false; z.classList.remove("full");
      z.querySelector("img").onclick = (ev) => { ev.stopPropagation(); z.classList.toggle("full"); };
      z.onclick = () => (z.hidden = true);
    },
  };

  /* ---------- адмінка: імпорт довідника (файл .json, підготовлений з таблиці) */
  const RefAdmin = {
    async open(admin) {
      this.pw = admin.pw;
      let box = $("ra"); if (!box) { box = document.createElement("div"); box.id = "ra"; box.className = "modal"; document.body.appendChild(box); }
      box.hidden = false;
      box.onclick = (e) => { if (e.target === box && !this.busy) box.hidden = true; };
      let n = "…";
      try { n = ((await API.call("ref_list", {}, this.pw)).entries || []).length; } catch (e) { n = "?"; }
      box.innerHTML = `<div class="m-card"><div class="m-head"><h2>Довідник техніки</h2><button type="button" class="link" id="ra-x">Закрити</button></div>
        <p class="muted small">Зараз у довіднику: <b>${n}</b> позицій. Курсанти відкривають його з головного меню.</p>
        <p class="muted small">Оновлення: завантажте файл довідника (.json), підготовлений з навчальної таблиці. Позиції з тими самими назвами оновляться, зайві — приберуться.</p>
        <div class="row"><button type="button" class="primary" id="ra-file">Завантажити файл довідника…</button></div>
        <input type="file" id="ra-in" accept=".json,application/json" hidden>
        <p class="status" id="ra-st"></p></div>`;
      $("ra-x").onclick = () => { if (!this.busy) box.hidden = true; };
      $("ra-file").onclick = () => $("ra-in").click();
      $("ra-in").onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { await this.importBundle(JSON.parse(await f.text())); } catch (err) { this.say(err.message, "no"); }
      };
    },
    say(t, cls = "") { const el = $("ra-st"); if (el) { el.textContent = t; el.className = "status " + cls; } },
    async importBundle(b) {
      if (!b || !Array.isArray(b.entries) || !b.images) throw new Error("Це не файл довідника");
      this.busy = true;
      try {
        for (let i = 0; i < b.entries.length; i++) {
          const e = b.entries[i];
          this.say(`${i + 1}/${b.entries.length}: ${e.name}…`);
          const images = (e.imgs || []).filter((x) => b.images[x]).map((x) => ({id: x, data: b.images[x], mime: "image/jpeg"}));
          for (let k = 0; ; k++) {
            try { await API.call("ref_put", {entry: Object.assign({}, e, {ord: i}), images}, this.pw); break; }
            catch (err) { if (k >= 2) throw err; await new Promise((r) => setTimeout(r, 1500)); }
          }
        }
        const pr = await API.call("ref_prune", {keep: b.entries.map((e) => e.id)}, this.pw);
        this.say(`Готово ✓ Позицій: ${b.entries.length}${pr.removed ? `, прибрано застарілих записів: ${pr.removed}` : ""}.`, "ok");
        Ref.entries = null;
        return b.entries.length;
      } finally { this.busy = false; }
    },
    /* Імпорт зашифрованого пакета (частини лежать на сайті тимчасово, ключ передається окремо). */
    async importEncrypted(urls, keyB64) {
      const parts = [];
      for (const u of urls) { const r = await fetch(u, {cache: "no-store"}); if (!r.ok) throw new Error("Немає " + u); parts.push(new Uint8Array(await r.arrayBuffer())); }
      const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; parts.forEach((p) => { all.set(p, o); o += p.length; });
      const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
      const plainBuf = await crypto.subtle.decrypt({name: "AES-GCM", iv: all.slice(0, 12)}, key, all.slice(12));
      return this.importBundle(JSON.parse(new TextDecoder().decode(plainBuf)));
    },
  };

  window.Ref = Ref;
  window.RefAdmin = RefAdmin;
})();
