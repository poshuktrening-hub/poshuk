/* Друк і PDF: записи довідника (один, розділ або результат пошуку) і аналітика групи.
   Друкується прихований блок #print-root (решта сторінки на друці ховається); «Зберегти як PDF» — у вікні друку браузера. */
(function () {
  const esc = (s) => UI.esc(s);
  const plain = (h) => String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<(?!\/?b>)[^>]+>/g, " ").replace(/&#x27;/g, "'");
  const noLead = (h) => String(h || "").replace(/^(\s*(?:<[^>]+>\s*)*)Ознаки\s*:\s*(?:<\/b>\s*)?(\S)/i, (m, pre, ch) => pre + ch.toUpperCase());

  function root() {
    let r = document.getElementById("print-root");
    if (!r) { r = document.createElement("div"); r.id = "print-root"; document.body.appendChild(r); }
    return r;
  }
  /* дочекатися фото (не довше 15 с), потім вікно друку */
  async function go(html, title) {
    const r = root(); r.innerHTML = html;
    const imgs = [...r.querySelectorAll("img")];
    await Promise.race([Promise.all(imgs.map((i) => (i.complete ? null : new Promise((res) => { i.onload = i.onerror = res; })))), new Promise((res) => setTimeout(res, 15000))]);
    imgs.forEach((i) => { if (!i.naturalWidth) i.remove(); });
    const t = document.title; if (title) document.title = title;
    document.body.classList.add("printing");
    const done = () => { document.body.classList.remove("printing"); document.title = t; r.innerHTML = ""; window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    setTimeout(() => window.print(), 50);
  }

  /* Фото запису: фото з таблиці, інакше фото картки; до 2 штук. */
  async function pics(e, pw) {
    const out = [];
    for (const id of (e.imgs || []).slice(0, 2)) { const u = await API.refUrl(id, e.v, pw).catch(() => null); if (u) out.push(u); }
    if (!out.length && e.card && window.Cards) { await Cards.loadRefPics().catch(() => null); const u = await Cards.photoUrl(e.card).catch(() => null); if (u) out.push(u); }
    return out;
  }
  async function entryHtml(e, pw) {
    const weak = e.card && (window.CARD_WEAK || {})[e.card];
    const ph = await pics(e, pw);
    return `<article class="pr-entry">
      <p class="pr-cat">${esc(e.cat || "")}${e.concept ? " · КОНЦЕПТ" : ""}</p><h2>${esc(Logic.dispName(e.name))}</h2>
      ${ph.length ? `<div class="pr-pics">${ph.map((u) => `<img src="${esc(u)}" alt="">`).join("")}</div>` : ""}
      ${e.ttx ? `<h3>ТТХ</h3><div class="pr-txt">${plain(e.ttx)}</div>` : ""}
      ${e.desc ? `<h3>Ознаки та опис</h3><div class="pr-txt">${noLead(e.fromCard ? esc(e.desc) : plain(e.desc))}</div>` : ""}
      ${weak && weak.length ? `<h3>Недоліки</h3><ul>${weak.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </article>`;
  }
  const head = (title, sub) => `<header class="pr-head"><b>${esc(title)}</b><span>${esc(sub || "")} · ${new Date().toLocaleDateString("uk-UA")}</span></header>`;

  const Print = {
    async entries(list, title, pw) {
      if (!list.length) return UI.toast("Немає записів для друку");
      if (list.length > 80 && !confirm(`До друку ${list.length} записів — це довго й багато сторінок. Продовжити?`)) return;
      UI.toast(`Готую до друку: ${list.length}…`, 6000);
      let html = head("Довідник техніки", title);
      for (const e of list) html += await entryHtml(e, pw);
      go(html, `Довідник — ${title}`);
    },
    /* аналітика: друкуємо вміст вікна аналітики як є (таблиці, смужки) */
    analytics(box, title) {
      const c = box.cloneNode(true);
      c.querySelectorAll("button, select, input, .m-head .link").forEach((x) => x.remove());
      go(head("Аналітика", title) + `<div class="pr-an">${c.innerHTML}</div>`, `Аналітика — ${title}`);
    },
  };
  window.Print = Print;
})();
