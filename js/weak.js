/* Підручник «Слабкі сторони»: обмеження й вразливості кожного зразка (відкриті джерела) з фото картки.
   Текст — у js/cards-weak.js; фото — ті самі, що в «Картках цілей» (свої або з довідника). */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.esc(s);
  const norm = (s) => Cards.norm(s);
  const ic = (c) => (window.CARD_WEAK || {})[c.id] || [];

  const Weak = {
    cat: "", q: "", open_id: null,
    list() { return Cards.deck().filter((c) => ic(c).length); },
    async open() {
      if (!Game.password) return;
      UI.show("s-weak");
      document.body.dataset.mode = "weak";
      $("w-back").onclick = () => Game.showStart();
      $("w-q").value = this.q;
      $("w-q").oninput = (e) => { this.q = e.target.value; this.render(); };
      this.renderCats(); this.render();
      Cards.loadRefPics && Cards.loadRefPics().then(() => this.loadImgs()).catch(() => {});
    },
    cats() { const m = new Map(); this.list().forEach((c) => { const k = Logic.category(c.name); m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); },
    renderCats() {
      $("w-cats").innerHTML = [["", "Усі", this.list().length], ...this.cats().map(([c, n]) => [c, c, n])].map(([v, t, n]) =>
        `<button type="button" class="chip${this.cat === v ? " on" : ""}" data-cat="${esc(v)}">${esc(t)}<small>${n}</small></button>`).join("");
      $("w-cats").querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { this.cat = b.dataset.cat; SFX.click(); this.renderCats(); this.render(); }));
    },
    filtered() {
      const q = norm(this.q);
      let pool = this.list().filter((c) => !this.cat || Logic.category(c.name) === this.cat);
      if (q) pool = pool.filter((c) => norm(c.name).includes(q) || c.aliases.some((a) => norm(a).includes(q)) || (q.length >= 3 && norm(ic(c).join(" ")).includes(q)));
      return pool;
    },
    render() {
      const list = this.filtered();
      $("w-count").textContent = `${list.length} з ${this.list().length}`;
      if (!list.length) { $("w-list").innerHTML = `<p class="muted r-empty">Нічого не знайдено.</p>`; return; }
      let html = "", last = null;
      for (const c of list) {
        const k = Logic.category(c.name);
        if (!this.cat && !norm(this.q) && k !== last) { html += `<h3 class="r-h">${esc(k)}</h3>`; last = k; }
        const open = this.open_id === c.id;
        html += `<div class="w-item${open ? " open" : ""}${c.hard ? " hard" : ""}" data-id="${esc(c.id)}">
          <button type="button" class="w-head" data-tg="${esc(c.id)}"><span class="r-th"><img loading="lazy" alt="" data-pic="${esc(c.id)}"></span>
            <span class="r-nm"><b>${esc(Logic.dispName(c.name))}</b><small>${c.hard ? "складний рівень · " : ""}${ic(c).length} пункт${ic(c).length === 1 ? "" : ic(c).length < 5 ? "и" : "ів"}</small></span><i class="w-arr">›</i></button>
          <ul class="w-pts"${open ? "" : " hidden"}>${ic(c).map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`;
      }
      $("w-list").innerHTML = html;
      $("w-list").querySelectorAll("[data-tg]").forEach((b) => (b.onclick = () => {
        const id = b.dataset.tg, box = b.parentElement, ul = box.querySelector(".w-pts");
        const now = ul.hidden; ul.hidden = !now; box.classList.toggle("open", now); this.open_id = now ? id : null; SFX.click();
      }));
      this.loadImgs();
    },
    async loadImgs() {
      for (const im of $("w-list").querySelectorAll("img[data-pic]")) {
        if (im.dataset.done) continue; im.dataset.done = "1";
        try { const u = await Cards.photoUrl(im.dataset.pic); if (u) im.src = u; else im.parentElement.classList.add("none"); } catch (e) { im.parentElement.classList.add("none"); }
      }
    },
  };
  window.Weak = Weak;
})();
