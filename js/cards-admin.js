/* Адмінка → «Картки»: фото до карток техніки. Масове завантаження: файл зіставляється з карткою за назвою
   («Т-72Б3.jpg», «Град.png», «t72b3.jpg» — так само, як перевіряється відповідь курсанта). */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.esc(s);

  function readImg(file) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`«${file.name}» — не зображення`)); i.src = fr.result; }; fr.readAsDataURL(file); });
  }
  /* Стиснути до 1280 пкс і JPEG — щоб швидко вантажилось на телефоні. */
  async function toJpeg(file) {
    const img = await readImg(file), k = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, c.width, c.height);
    let q = 0.86, url = c.toDataURL("image/jpeg", q);
    while (url.length > 1_400_000 && q > 0.5) { q -= 0.1; url = c.toDataURL("image/jpeg", q); }
    return url.split(",")[1];
  }
  /* ---------- Вікісховище: запити йдуть із браузера адміністратора (API дозволяє origin=*) */
  const API_C = "https://commons.wikimedia.org/w/api.php";
  const FREE = (lic) => { const l = String(lic || "").toLowerCase(); return !/nc|nd|fair|non-free/.test(l) && /(cc0|public domain|pd|cc by|cc-by|attribution)/.test(l); };
  const strip = (h) => { const d = document.createElement("div"); d.innerHTML = String(h || ""); return d.textContent.replace(/\s+/g, " ").trim(); };
  async function commons(params) {
    const u = API_C + "?" + new URLSearchParams(Object.assign({format: "json", origin: "*", formatversion: "2"}, params));
    const r = await fetch(u); if (!r.ok) throw new Error("Вікісховище недоступне (" + r.status + ")");
    return r.json();
  }
  /* Кандидати для картки: спершу файли з переліку, далі пошук. Лише вільні ліцензії, ширина ≥ 700. */
  async function candidates(id) {
    const spec = (window.CARD_COMMONS || {})[id] || [];
    const q = spec[0], files = spec.slice(1);
    const ii = {prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: "1280", iiextmetadatafilter: "LicenseShortName|Artist|UsageTerms"};
    const out = [], seen = new Set();
    const take = (pages) => (pages || []).forEach((p) => {
      const i = p.imageinfo && p.imageinfo[0]; if (!i || seen.has(p.title)) return; seen.add(p.title);
      const m = i.extmetadata || {}, lic = (m.LicenseShortName && m.LicenseShortName.value) || "";
      if (!/^image\/(jpeg|png|webp)/.test(i.mime || "") || (i.width || 0) < 700 || !FREE(lic)) return;
      out.push({title: p.title, url: i.thumburl || i.url, page: i.descriptionurl, license: lic, author: strip(m.Artist && m.Artist.value).slice(0, 120)});
    });
    if (files.length) { const j = await commons(Object.assign({action: "query", titles: files.map((f) => "File:" + f).join("|")}, ii)); take(j.query && j.query.pages); }
    if (q) {
      const j = await commons(Object.assign({action: "query", generator: "search", gsrsearch: q + " filetype:bitmap", gsrnamespace: "6", gsrlimit: "12"}, ii));
      const pages = (j.query && j.query.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0));
      // пошук повертає й сміття (туманності, газети, інші гелікоптери) — у назві файлу має бути позначення моделі
      const nz = (s) => String(s).toLowerCase().replace(/[^a-z0-9а-яіїєґ]/g, "");
      const keys = q.split(/\s+/).filter((w) => /\d/.test(w)).map(nz).filter((w) => w.length >= 3);
      const need = keys.length ? keys : q.split(/\s+/).map(nz).filter((w) => w.length >= 3);
      take(pages.filter((p) => { const t = nz(p.title); return need.every((k) => t.includes(k)) && !/decoy|inflatable|maket|макет|model|toy|replica|lego|interior|operators|cutaway|diagram|scheme|emblem|logo|\bmap\b/i.test(p.title); }));
      // справжніх фото немає (концепт, рідкісний зразок) — беремо модель, макет з виставки чи візуалізацію
      if (!out.length) take(pages.filter((p) => { const t = nz(p.title); return need.every((k) => t.includes(k)) && !/toy|lego|emblem|logo|\bmap\b|interior|operators/i.test(p.title); }).map((p) => Object.assign(p, {model: true})));
    }
    return out;
  }
  async function urlToJpeg(url) {
    const r = await fetch(url); if (!r.ok) throw new Error("фото не завантажилось");
    return toJpeg(new File([await r.blob()], "x.jpg"));
  }

  function match(fname, deck) {
    const base = fname.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s*\(\d+\)$/, "").trim();
    const byId = deck.find((c) => c.id === base.toLowerCase());
    if (byId) return byId;
    const hit = deck.find((c) => Cards.check(c, base).ok);
    if (hit) return hit;
    // назва файлу містить позначення моделі («2С19 Мста-С фото 3») — найдовший збіг
    const n = Cards.norm(base); let best = null, bl = 0;
    for (const c of deck) for (const a of c.aliases) { const v = Cards.norm(a); if (v.length >= 3 && n.includes(v) && v.length > bl) { best = c; bl = v.length; } }
    return best;
  }

  const CardsAdmin = {
    async open(admin) {
      this.admin = admin; this.pw = admin.pw;
      let box = $("ca"); if (!box) { box = document.createElement("div"); box.id = "ca"; box.className = "modal"; document.body.appendChild(box); }
      box.hidden = false;
      box.onclick = (e) => { if (e.target === box && !this.busy) box.hidden = true; };
      const wire = () => box.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => (box.hidden = true)));
      const fail = (e) => { box.innerHTML = `<div class="m-card"><div class="m-head"><h2>Картки цілей</h2><button type="button" class="link" data-close>Закрити</button></div><p class="status no">${esc(e && e.message || e)}</p><p class="muted small">Оновіть сторінку й спробуйте ще раз. Якщо повторюється — напишіть у підтримку цей текст.</p></div>`; wire(); };
      box.innerHTML = `<div class="m-card"><div class="m-head"><h2>Картки цілей</h2><button type="button" class="link" data-close>Закрити</button></div><p class="status">Завантажую список фото…</p></div>`; wire();
      try { const j = await API.call("card_photos", {}, this.pw); this.photos = new Map(j.photos); this.credits = new Map(j.credits || []); this.fill = j.fill || null; } catch (e) { return fail(e); }
      try { this.render(); } catch (e) { console.error(e); fail(e); }
    },
    render() {
      const deck = Cards.deck(), n = deck.filter((c) => this.photos.has(c.id)).length;
      $("ca").innerHTML = `<div class="m-card">
        <div class="m-head"><h2>Картки цілей</h2><button type="button" class="link" id="ca-x">Закрити</button></div>
        <p class="muted small">Галочка «хардкор» — картка грає лише в режимі «Хардкор» (не в ігровому й не на іспиті). У хардкорі зараз: ${deck.filter((c) => c.hard).length}.</p>
        <p class="muted small">У грі беруть участь лише картки з фото: зараз ${n} з ${deck.length}. Виберіть одразу багато фото — кожне прив'яжеться до картки за назвою файлу (напр. «Т-72Б3.jpg», «Град.png», «2С19 Мста-С.jpg»).</p>
        <div class="row"><button type="button" class="primary" id="ca-wiki" title="Знайти фото з вільною ліцензією у Wikimedia Commons для всіх карток без фото">🔎 Підібрати фото з Вікісховища</button></div>
        <div class="row"><button type="button" id="ca-bulk">＋ Свої фото (кілька файлів)…</button><button type="button" id="ca-names">Список назв файлів</button></div>
        <input type="file" id="ca-files" accept="image/*" multiple hidden><input type="file" id="ca-one" accept="image/*" hidden>
        <p class="status" id="ca-st"></p>
        ${this.fill ? `<div class="ca-fill"><p class="muted small">🤖 <b>Автопідбір у фоні</b> (сервер сам шукає вільні фото, креслення чи моделі у Вікісховищі): переглянуто ${this.fill.pos} з ${this.fill.total}, знайдено ${this.fill.ok}, не знайдено ${this.fill.miss.length}${this.fill.done ? " · завершено" : this.fill.paused ? " · пауза, Вікісховище не відповідає" : " · триває, поки сайтом користуються"}.</p>
          ${this.fill.miss.length ? `<details class="small"><summary class="muted">Не знайдено (${this.fill.miss.length}) — додайте своє фото</summary><p class="muted small">${esc(this.fill.miss.join(", "))}</p></details>` : ""}
          <div class="row"><button type="button" id="ca-fill-now" ${this.fill.done ? "disabled" : ""}>⏩ Наступні 2 картки зараз</button><button type="button" id="ca-fill-reset" title="Пройти перелік спочатку (вже знайдені фото лишаються)">Спочатку</button></div></div>` : ""}
        <input type="search" id="ca-q" placeholder="Пошук картки: Т-72, Бук, РЕБ…" value="${esc(this.q || "")}" autocomplete="off" style="margin-top:10px">
        <div class="tabs" id="ca-f"><button type="button" data-f="all" class="${this.f !== "no" && this.f !== "yes" ? "on" : ""}">Усі</button><button type="button" data-f="no" class="${this.f === "no" ? "on" : ""}">Без фото ${deck.length - n}</button><button type="button" data-f="yes" class="${this.f === "yes" ? "on" : ""}">З фото ${n}</button></div>
        <ul class="ca-list">${deck.filter((c) => this.f === "no" ? !this.photos.has(c.id) : this.f === "yes" ? this.photos.has(c.id) : true)
          .filter((c) => !this.q || Cards.norm(c.name + " " + c.id + " " + c.aliases.join(" ")).includes(Cards.norm(this.q))).map((c) => `<li>
          ${this.photos.has(c.id) ? `<img class="th" loading="lazy" alt="" data-th="${c.id}">` : `<span class="dot"></span>`}<span class="nm">${esc(Logic.dispName(c.name))}<small>${esc(this.credits.get(c.id) || c.id)}</small></span>
          <label class="ca-hard" title="Хардкор"><input type="checkbox" data-hard="${c.id}" ${c.hard ? "checked" : ""}><span>хардкор</span></label>
          <button type="button" data-wiki="${c.id}" title="Інше фото з Вікісховища">🔎</button>
          <button type="button" data-up="${c.id}">${this.photos.has(c.id) ? "Замінити" : "Фото…"}</button>${this.photos.has(c.id) ? `<button type="button" data-del="${c.id}" title="Видалити фото">✕</button>` : ""}</li>`).join("")}</ul>
      </div>`;
      $("ca-x").onclick = () => ($("ca").hidden = true);
      $("ca-wiki").onclick = () => this.wikiAll();
      $("ca").querySelectorAll("[data-wiki]").forEach((b) => (b.onclick = () => this.wikiOne(b.dataset.wiki)));
      $("ca").querySelectorAll("[data-hard]").forEach((cb) => (cb.onchange = async () => {
        try { const j = await API.call("set_card_hard", {id: cb.dataset.hard, hard: cb.checked ? 1 : 0}, this.pw); Game.cardHard = j.cardHard || {}; }
        catch (e) { cb.checked = !cb.checked; UI.toast(e.message); }
      }));
      $("ca").querySelectorAll("[data-th]").forEach(async (im) => { im.src = await API.cardUrl(im.dataset.th, this.photos.get(im.dataset.th), this.pw).catch(() => ""); });
      $("ca-f").querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { this.f = b.dataset.f; this.render(); }));
      const fillNow = async (reset) => {
        this.say(reset ? "Починаю спочатку…" : "Шукаю для наступних карток…");
        try {
          const j = await API.call("photo_fill_now", {reset: reset ? 1 : 0}, this.pw);
          const ph = await API.call("card_photos", {}, this.pw); this.photos = new Map(ph.photos); this.credits = new Map(ph.credits || []); this.fill = j.fill || ph.fill;
          this.render(); this.say(`Переглянуто ${j.fill.pos} з ${j.fill.total}, знайдено ${j.fill.ok}.`, "ok");
        } catch (e) { this.say(e.message, "no"); }
      };
      if ($("ca-fill-now")) $("ca-fill-now").onclick = () => fillNow(false);
      if ($("ca-fill-reset")) $("ca-fill-reset").onclick = () => { if (confirm("Пройти автопідбір спочатку? Знайдені фото лишаються; картки без фото буде перевірено ще раз.")) fillNow(true); };
      $("ca-q").oninput = (e) => { this.q = e.target.value; const pos = e.target.selectionStart; this.render(); const q = $("ca-q"); q.focus(); try { q.setSelectionRange(pos, pos); } catch (er) { /* ок */ } };
      $("ca-bulk").onclick = () => $("ca-files").click();
      $("ca-files").onchange = (e) => this.bulk([...e.target.files]);
      $("ca-names").onclick = () => {
        const txt = Cards.deck().map((c) => `${c.name}.jpg`).join("\n");
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], {type: "text/plain"})); a.download = "картки-назви-файлів.txt"; a.click();
      };
      $("ca").querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => { this.oneId = b.dataset.up; $("ca-one").click(); }));
      $("ca-one").onchange = async (e) => { const f = e.target.files[0]; if (f) await this.upload(this.oneId, f); e.target.value = ""; this.render(); };
      $("ca").querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
        if (!confirm("Видалити фото цієї картки?")) return;
        await API.call("card_photo_delete", {id: b.dataset.del}, this.pw).catch((e) => UI.toast(e.message));
        this.photos.delete(b.dataset.del); this.render();
      }));
    },
    say(t, cls = "") { const s = $("ca-st"); if (s) { s.textContent = t; s.className = "status " + cls; } },
    async upload(id, file, credit = "", data = null) {
      data = data || await toJpeg(file);
      const j = await API.call("card_photo_upload", {id, data, mime: "image/jpeg", credit}, this.pw);
      this.photos.set(id, j.updated); if (credit) this.credits.set(id, credit); else this.credits.delete(id);
      if (window.Game && Game.cardPhotos) Game.cardPhotos.set(id, j.updated);
    },
    /* Одне фото з Вікісховища для картки; skip — скільки кандидатів пропустити (кнопка 🔎 щоразу бере наступне). */
    async wikiPut(id, skip = 0) {
      const list = await candidates(id);
      if (!list.length) return false;
      const cur = (this.credits && this.credits.get(id)) || "";
      let c = list[skip % list.length];
      // 🔎 має давати інше фото, а не те саме, що вже стоїть
      for (let k = 0; k < list.length && cur && cur.includes(c.page); k++) c = list[(skip + k + 1) % list.length];
      const data = await urlToJpeg(c.url);
      const credit = `${c.author || "автор невідомий"}, ${c.license}, Wikimedia Commons — ${c.page}`;
      await this.upload(id, null, credit, data);
      return true;
    },
    async wikiOne(id) {
      this.skip = this.skip || {}; this.skip[id] = this.photos.has(id) ? (this.skip[id] || 0) + 1 : 0;
      this.say(`Шукаю фото у Вікісховищі…`);
      try { const ok = await this.wikiPut(id, this.skip[id]); this.render(); this.say(ok ? "Фото оновлено ✓ (ще раз 🔎 — інше)" : "Нічого вільного не знайдено — додайте своє фото.", ok ? "ok" : "no"); }
      catch (e) { this.say(e.message, "no"); }
    },
    async wikiAll() {
      const todo = Cards.deck().filter((c) => !this.photos.has(c.id) && !(window.CARD_REF || {})[c.id]);   // картки з фото довідника не чіпаємо
      if (!todo.length) { this.say("У всіх карток уже є фото.", "ok"); return; }
      this.busy = true; let ok = 0; const miss = [];
      for (let i = 0; i < todo.length; i++) {
        this.say(`${i + 1}/${todo.length}: ${todo[i].name}…`);
        try { if (await this.wikiPut(todo[i].id)) ok++; else miss.push(todo[i].name); } catch (e) { miss.push(todo[i].name); if (/недоступне/.test(e.message)) { this.say(e.message, "no"); break; } }
      }
      this.busy = false; this.render();
      this.say(`Додано з Вікісховища: ${ok}.${miss.length ? ` Не знайдено вільних фото: ${miss.join(", ")}.` : ""} Перегляньте мініатюри — невдале фото міняється кнопкою 🔎.`, miss.length ? "" : "ok");
    },
    async bulk(files) {
      if (!files.length) return;
      this.busy = true;
      const deck = Cards.deck(), miss = []; let ok = 0;
      for (let i = 0; i < files.length; i++) {
        const c = match(files[i].name, deck);
        if (!c) { miss.push(files[i].name); continue; }
        this.say(`${i + 1}/${files.length}: ${files[i].name} → ${c.name}…`);
        try { await this.upload(c.id, files[i]); ok++; } catch (e) { miss.push(`${files[i].name} (${e.message})`); }
      }
      this.busy = false;
      this.render();
      this.say(`Додано фото: ${ok}.${miss.length ? ` Не впізнано: ${miss.join(", ")} — перейменуйте файл як у «Списку назв» або завантажте кнопкою «Фото…» в рядку картки.` : ""}`, miss.length ? "no" : "ok");
    },
  };
  /* Разові виправлення фото карток (виконуються тихо при вході в адмінку, якщо стоїть невдале фото). */
  const FIXES = [{id: "tu95ms", bad: /AN1744941/}];
  CardsAdmin.autoFix = async function (admin) {
    try {
      this.pw = admin.pw;
      const j = await API.call("card_photos", {}, this.pw); this.photos = new Map(j.photos); this.credits = new Map(j.credits || []);
      for (const f of FIXES) { const cr = this.credits.get(f.id) || ""; if (f.bad.test(decodeURIComponent(cr))) await this.wikiPut(f.id, 0); }
    } catch (e) { /* не критично */ }
  };
  window.CardsAdmin = CardsAdmin;
})();
