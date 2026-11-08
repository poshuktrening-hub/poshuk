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
      const fail = (e) => { box.innerHTML = `<div class="m-card"><div class="m-head"><h2>Картки</h2><button type="button" class="link" data-close>Закрити</button></div><p class="status no">${esc(e && e.message || e)}</p><p class="muted small">Оновіть сторінку й спробуйте ще раз. Якщо повторюється — напишіть у підтримку цей текст.</p></div>`; wire(); };
      box.innerHTML = `<div class="m-card"><div class="m-head"><h2>Картки</h2><button type="button" class="link" data-close>Закрити</button></div><p class="status">Завантажую список фото…</p></div>`; wire();
      try { const j = await API.call("card_photos", {}, this.pw); this.photos = new Map(j.photos); this.credits = new Map(j.credits || []); this.own = new Set(j.own || []); this.fill = j.fill || null; } catch (e) { return fail(e); }
      try { this.render(); } catch (e) { console.error(e); fail(e); }
    },
    render() {
      const deck = Cards.deck(), n = deck.filter((c) => this.photos.has(c.id)).length;
      $("ca").innerHTML = `<div class="m-card">
        <div class="m-head"><h2>Картки</h2><button type="button" class="link" id="ca-x">Закрити</button></div>
        <p class="muted small">Галочка «хардкор» — картка грає лише в режимі «Хардкор» (не в ігровому й не на іспиті). У хардкорі зараз: ${deck.filter((c) => c.hard).length}.</p>
        <p class="muted small">Фото карток зберігаються в «Довіднику» (у записі цієї техніки) — там же можна додати кілька ракурсів.</p>
        <p class="muted small">У грі беруть участь лише картки з фото: зараз ${n} з ${deck.length}. Виберіть одразу багато фото — кожне прив'яжеться до картки за назвою файлу (напр. «Т-72Б3.jpg», «Град.png», «2С19 Мста-С.jpg»).</p>
        <div class="row"><button type="button" class="primary" id="ca-auto" title="Знайти вільні фото для всіх карток без фото: Вікісховище, Openverse (Flickr), АрміяInform; якщо фото немає — креслення чи модель">${this.running ? "⏸ Зупинити автопошук" : "🤖 Автопошук фото"}</button></div>
        <div class="row"><button type="button" id="ca-ocr" title="Розпізнати текст на фото карток: назва чи індекс техніки на знімку — це підказка. Знайдені можна замінити іншим вільним фото">🔤 Перевірити фото на написи</button></div>
        <div class="row"><button type="button" id="ca-bulk">＋ Свої фото (кілька файлів)…</button><button type="button" id="ca-names">Список назв файлів</button></div>
        <input type="file" id="ca-files" accept="image/*" multiple hidden><input type="file" id="ca-one" accept="image/*" hidden>
        <p class="status" id="ca-st"></p>
        ${this.fill ? `<div class="ca-fill"><p class="muted small">🤖 <b>Автопошук</b>: переглянуто ${this.fill.pos} з ${this.fill.total}, знайдено ${this.fill.ok}, не знайдено ${this.fill.miss.length}${this.fill.done ? ` · завершено${this.fill.next ? `, наступний фоновий прохід — ${new Date(this.fill.next).toLocaleDateString("uk-UA")}` : ""}` : this.fill.paused ? " · пауза, джерела не відповідають" : " · фоновий прохід триває"}. У фоні сервер шукає раз на тиждень; кнопка вище — одразу.</p>
          ${this.fill.miss.length ? `<details class="small"><summary class="muted">Не знайдено (${this.fill.miss.length}) — додайте своє фото</summary><p class="muted small">${esc(this.fill.miss.join(", "))}</p></details>` : ""}
          <details class="small ca-rules"><summary class="muted">Правила автопошуку</summary><ol class="muted small">
            <li>Джерела по черзі: Вікісховище → Openverse (Flickr та ін.) → креслення чи модель з Вікісховища (з позначкою) → АрміяInform. Лише вільні ліцензії (CC0, суспільне надбання, CC BY, CC BY-SA), ширина від 600 пкс.</li>
            <li>У назві файлу (чи тегах) мають бути всі ключі запиту картки: кожне позначення з цифрами + шифр; загальні слова (tank, truck, army, цистерна…) ключами не є.</li>
            <li>Індекс — лише цілим: 2С1 не підходить до «2С19», 9К33 — до «9К330», Tigr — до «Tigris». Модифікації (Т-72Б3М для Т-72Б3) підходять.</li>
            <li>У файлі має бути індекс самої картки або її шифр — кирилицею чи латиницею (Т-72Б3 / T-72B3, Іскандер-М / Iskander-M). Короткий індекс із цифри (2С1, 9К33) без шифру не рахується.</li>
            <li>Не беруться: потяги, вагони, станції, цивільні авто, іграшки, макети, інтер'єри, схеми, емблеми. Невдалі фото, підібрані раніше, сервер прибирає сам за цими ж правилами.</li>
            <li>Фоновий прохід — раз на тиждень; кнопка «Автопошук фото» — одразу; 🔎 у рядку — інше фото для однієї картки.</li>
            <li>Не беруться фото з тваринами, персонажами, іграшками. Автопідібране фото, яке ви прибрали з запису чи замінили, автопошук запам'ятовує і більше не бере.</li></ol></details></div>` : ""}
        <input type="search" id="ca-q" placeholder="Пошук картки: Т-72, Бук, РЕБ…" value="${esc(this.q || "")}" autocomplete="off" style="margin-top:10px">
        <div class="tabs" id="ca-f"><button type="button" data-f="all" class="${this.f !== "no" && this.f !== "yes" ? "on" : ""}">Усі</button><button type="button" data-f="no" class="${this.f === "no" ? "on" : ""}">Без фото ${deck.length - n}</button><button type="button" data-f="yes" class="${this.f === "yes" ? "on" : ""}">З фото ${n}</button></div>
        <ul class="ca-list">${deck.filter((c) => this.f === "no" ? !this.photos.has(c.id) : this.f === "yes" ? this.photos.has(c.id) : true)
          .filter((c) => { const k = Cards.norm(c.name + " " + c.id + " " + c.aliases.join(" ")); return String(this.q || "").split(/[\s,;\/]+/).map(Cards.norm).filter(Boolean).every((w) => k.includes(w)); }).map((c) => `<li>
          ${this.photos.has(c.id) ? `<img class="th" loading="lazy" alt="" data-th="${c.id}">` : `<span class="dot" data-up="${c.id}" title="Додати фото"></span>`}<span class="nm">${esc(Logic.dispName(c.name))}<small>${esc(this.credits.get(c.id) || c.id)}</small></span>
          <label class="ca-hard" title="Хардкор"><input type="checkbox" data-hard="${c.id}" ${c.hard ? "checked" : ""}><span>хардкор</span></label>
          <button type="button" data-wiki="${c.id}" title="Автопошук фото для цієї картки (ще раз — інше фото)">🔎</button>
          <button type="button" data-up="${c.id}">${this.photos.has(c.id) ? "Замінити" : "Фото…"}</button>${this.photos.has(c.id) ? `<button type="button" data-del="${c.id}" title="Видалити фото">✕</button>` : ""}</li>`).join("")}</ul>
      </div>`;
      $("ca-x").onclick = () => ($("ca").hidden = true);
      $("ca-auto").onclick = () => (this.running ? (this.running = false) : this.autoAll());
      $("ca-ocr").onclick = () => this.ocrOpen();
      $("ca").querySelectorAll("[data-wiki]").forEach((b) => (b.onclick = () => this.wikiOne(b.dataset.wiki)));
      $("ca").querySelectorAll("[data-hard]").forEach((cb) => (cb.onchange = async () => {
        try { const j = await API.call("set_card_hard", {id: cb.dataset.hard, hard: cb.checked ? 1 : 0}, this.pw); Game.cardHard = j.cardHard || {}; }
        catch (e) { cb.checked = !cb.checked; UI.toast(e.message); }
      }));
      $("ca").querySelectorAll("[data-th]").forEach(async (im) => { im.src = await API.cardUrl(im.dataset.th, this.photos.get(im.dataset.th), this.pw).catch(() => ""); });
      $("ca-f").querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { this.f = b.dataset.f; this.render(); }));
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
        try { await API.call("card_photo_delete", {id: b.dataset.del}, this.pw); } catch (e) { this.say(e.message, "no"); return; }
        const j = await API.call("card_photos", {}, this.pw); this.photos = new Map(j.photos); this.credits = new Map(j.credits || []); this.own = new Set(j.own || []); this.render();
      }));
    },
    say(t, cls = "") { const s = $("ca-st"); if (s) { s.textContent = t; s.className = "status " + cls; } },
    async upload(id, file, credit = "", data = null) {
      data = data || await toJpeg(file);
      const j = await API.call("card_photo_upload", {id, data, mime: "image/jpeg", credit}, this.pw);
      this.photos.set(id, j.updated); if (credit) this.credits.set(id, credit); else this.credits.delete(id);
      if (window.Game && Game.cardPhotos) Game.cardPhotos.set(id, j.updated);
    },
    /* 🔎 у рядку картки: пошук на сервері (Вікісховище, Openverse, АрміяInform); щоразу — наступний кандидат. */
    async wikiPut(id, skip = 0) {
      const j = await API.call("photo_fill_card", {id, skip}, this.pw);
      if (j.put) { this.photos.set(id, j.updated); if (j.credit) this.credits.set(id, j.credit); }
      return j.put;
    },
    async wikiOne(id) {
      this.skip = this.skip || {}; this.skip[id] = this.photos.has(id) ? (this.skip[id] || 0) + 1 : 0;
      this.say(`Шукаю фото…`);
      try { const ok = await this.wikiPut(id, this.skip[id]); this.render(); this.say(ok ? "Фото оновлено ✓ (ще раз 🔎 — інше)" : "Нічого вільного не знайдено — додайте своє фото.", ok ? "ok" : "no"); }
      catch (e) { this.say(e.message, "no"); }
    },
    /* ---- 🔤 Перевірка фото на написи ---- */
    isOwn(id) { return !!(this.own && this.own.has(id)); },
    ocrCache() { try { return JSON.parse(localStorage.getItem("poshuk_ocr") || "{}"); } catch (e) { return {}; } },
    ocrSave(c) { try { localStorage.setItem("poshuk_ocr", JSON.stringify(c)); } catch (e) { /* ок */ } },
    async ocrOpen() {
      let box = $("co");
      if (!box) { box = document.createElement("div"); box.id = "co"; box.className = "modal"; document.body.appendChild(box); }
      box.hidden = false; this.ocrStop = false; this.ocrRes = this.ocrRes || {};
      box.onclick = (e) => { if (e.target === box && !this.ocrBusy) box.hidden = true; };
      this.ocrRender();
    },
    ocrRender() {
      const deck = Cards.deck(), withPh = deck.filter((c) => this.photos.has(c.id) && !this.isOwn(c.id)), cache = this.ocrCache();
      const rows = withPh.map((c) => ({c, r: this.ocrRes[c.id] || (cache[c.id] && cache[c.id][0] === this.photos.get(c.id) ? {level: cache[c.id][1], hits: cache[c.id][2]} : null)}));
      const done = rows.filter((x) => x.r).length, bad = rows.filter((x) => x.r && x.r.level !== "clean" && !(cache[x.c.id] && cache[x.c.id][3] === this.photos.get(x.c.id)));
      const red = bad.filter((x) => x.r.level === "name");
      $("co").innerHTML = `<div class="m-card">
        <div class="m-head"><h2>🔤 Написи на фото</h2><button type="button" class="link" id="co-x">Закрити</button></div>
        <p class="muted small">Розпізнає текст на фото карток (у вашому браузері, нічого нікуди не йде). <b style="color:#ff7a59">Червоні</b> — на фото є назва чи індекс самої техніки (підказка), <b style="color:#ffb23e">жовті</b> — інший впевнений напис (підпис, водяний знак). Номери на бортах не рахуються. Перший запуск вантажить модуль ~12 МБ.</p>
        <div class="row"><button type="button" class="primary" id="co-go">${this.ocrBusy ? "⏹ Зупинити" : done ? "▶ Продовжити перевірку" : "▶ Перевірити всі фото"}</button>${red.length ? `<button type="button" id="co-fixall"${this.ocrBusy ? " disabled" : ""}>Замінити всі червоні (${red.length})</button>` : ""}</div>
        <p class="status" id="co-st">Перевірено ${done} з ${withPh.length}. Знайдено з написами: ${bad.length} (з назвою — ${red.length}).</p>
        <ul class="ca-list co-list">${bad.sort((a, b) => (a.r.level === "name" ? 0 : 1) - (b.r.level === "name" ? 0 : 1)).map(({c, r}) => `<li>
          <img class="th" loading="lazy" alt="" data-cth="${c.id}"><span class="nm">${esc(Logic.dispName(c.name))}<small>${r.hits.map((h) => `<b style="color:${h.kind === "name" ? "#ff7a59" : "#ffb23e"}">${esc(h.t)}</b>`).join(" · ")}</small></span>
          <button type="button" data-cfix="${c.id}"${this.ocrBusy ? " disabled" : ""} title="Знайти інше вільне фото й перевірити його">Замінити</button><button type="button" data-cok="${c.id}" title="Залишити це фото (написи не заважають)">Залишити</button></li>`).join("") || `<li class="muted">${done ? "Фото з написами не знайдено ✓" : "Ще не перевіряли."}</li>`}</ul>
      </div>`;
      $("co-x").onclick = () => { this.ocrStop = true; $("co").hidden = true; this.render(); };
      $("co-go").onclick = () => (this.ocrBusy ? (this.ocrStop = true) : this.ocrRun());
      if ($("co-fixall")) $("co-fixall").onclick = () => this.ocrFix(red.map((x) => x.c.id));
      $("co").querySelectorAll("[data-cth]").forEach(async (im) => { im.src = await API.cardUrl(im.dataset.cth, this.photos.get(im.dataset.cth), this.pw).catch(() => ""); });
      $("co").querySelectorAll("[data-cfix]").forEach((b) => (b.onclick = () => this.ocrFix([b.dataset.cfix])));
      $("co").querySelectorAll("[data-cok]").forEach((b) => (b.onclick = () => { const k = this.ocrCache(), id = b.dataset.cok; if (k[id]) k[id][3] = this.photos.get(id); this.ocrSave(k); this.ocrRender(); }));
    },
    cosay(t, cls = "") { const e = $("co-st"); if (e) { e.textContent = t; e.className = "status " + cls; } },
    async ocrOne(c) {
      const url = await API.cardUrl(c.id, this.photos.get(c.id), this.pw);
      const r = await Ocr.check(url, c, (m) => this.cosay(m));
      this.ocrRes[c.id] = r;
      const k = this.ocrCache(); k[c.id] = [this.photos.get(c.id), r.level, r.hits.slice(0, 8)]; this.ocrSave(k);
      return r;
    },
    async ocrRun() {
      this.ocrBusy = true; this.ocrStop = false; this.ocrRender();
      try {
        const cache = this.ocrCache(), todo = Cards.deck().filter((c) => this.photos.has(c.id) && !this.isOwn(c.id) && !(cache[c.id] && cache[c.id][0] === this.photos.get(c.id)));
        let n = 0;
        for (const c of todo) {
          if (this.ocrStop || $("co").hidden) break;
          this.cosay(`Перевіряю ${++n} з ${todo.length}: ${Logic.dispName(c.name)}…`);
          try { await this.ocrOne(c); } catch (e) { if (/модуль|media\/ocr/i.test(e.message)) throw e; }
          if (n % 10 === 0) this.ocrRender();
        }
      } catch (e) { this.ocrBusy = false; this.ocrRender(); this.cosay(e.message, "no"); return; }
      this.ocrBusy = false; this.ocrRender();
    },
    /* Замінити: наступний вільний кандидат з автопошуку → одразу перевірити → поки на новому фото є назва (до 6 спроб). */
    async ocrFix(ids) {
      this.ocrBusy = true; this.ocrStop = false; this.ocrRender();
      this.skip = this.skip || {}; let ok = 0, fail = [];
      try {
        for (let i = 0; i < ids.length; i++) {
          const c = Cards.deck().find((x) => x.id === ids[i]); if (!c || this.ocrStop) break;
          let good = false;
          for (let t = 0; t < 6 && !good && !this.ocrStop; t++) {
            this.skip[c.id] = (this.skip[c.id] || 0) + 1;
            this.cosay(`${i + 1}/${ids.length} ${Logic.dispName(c.name)}: шукаю інше фото (спроба ${t + 1})…`);
            let put = false; try { put = await this.wikiPut(c.id, this.skip[c.id]); } catch (e) { this.cosay(e.message, "no"); }
            if (!put) break;
            this.cosay(`${i + 1}/${ids.length} ${Logic.dispName(c.name)}: перевіряю нове фото…`);
            const r = await this.ocrOne(c);
            good = r.level === "clean" || (r.level === "text" && t >= 2);
          }
          if (good) ok++; else fail.push(Logic.dispName(c.name));
        }
      } catch (e) { this.cosay(e.message, "no"); }
      this.ocrBusy = false; this.ocrRender();
      this.cosay(`Замінено: ${ok}${fail.length ? `. Не вдалось знайти чисте фото: ${fail.join(", ")} — додайте своє (кнопка «Замінити» в списку карток).` : ""}`, fail.length ? "no" : "ok");
    },
    /* «Автопошук фото»: прохід по всіх картках без фото одразу (той самий, що сервер робить у фоні раз на тиждень). */
    async autoAll() {
      this.running = true; this.render();
      try {
        let j = await API.call("photo_fill_now", {reset: this.fill && this.fill.done ? 1 : 0}, this.pw);
        while (this.running && !j.fill.done && document.getElementById("ca-auto")) {
          this.fill = j.fill;
          this.say(`Автопошук: ${j.fill.pos} з ${j.fill.total}, знайдено ${j.fill.ok}…`);
          if (j.fill.paused) { this.say("Джерела фото не відповідають — спробуйте пізніше.", "no"); break; }
          j = await API.call("photo_fill_now", {}, this.pw);
        }
        const ph = await API.call("card_photos", {}, this.pw); this.photos = new Map(ph.photos); this.credits = new Map(ph.credits || []); this.fill = j.fill || ph.fill;
      } catch (e) { this.say(e.message, "no"); }
      const done = this.fill && this.fill.done;
      this.running = false;
      if (document.getElementById("ca-auto")) { this.render(); this.say(done ? `Готово ✓ Знайдено: ${this.fill.ok}, не знайдено: ${this.fill.miss.length}. Невдале фото міняється кнопкою 🔎.` : "Автопошук зупинено.", done ? "ok" : ""); }
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
