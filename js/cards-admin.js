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
      box.innerHTML = `<div class="m-card"><p class="status">Завантажую…</p></div>`;
      try { this.photos = new Map((await API.call("card_photos", {}, this.pw)).photos); } catch (e) { box.innerHTML = `<div class="m-card"><p class="status no">${esc(e.message)}</p></div>`; return; }
      this.render();
    },
    render() {
      const deck = Cards.deck(), n = deck.filter((c) => this.photos.has(c.id)).length;
      $("ca").innerHTML = `<div class="m-card">
        <div class="m-head"><h2>Картки цілей</h2><button type="button" class="link" id="ca-x">Закрити</button></div>
        <p class="muted small">У грі беруть участь лише картки з фото: зараз ${n} з ${deck.length}. Виберіть одразу багато фото — кожне прив'яжеться до картки за назвою файлу (напр. «Т-72Б3.jpg», «Град.png», «2С19 Мста-С.jpg»).</p>
        <div class="row"><button type="button" class="primary" id="ca-bulk">＋ Фото (кілька файлів)…</button><button type="button" id="ca-names">Список назв файлів</button></div>
        <input type="file" id="ca-files" accept="image/*" multiple hidden><input type="file" id="ca-one" accept="image/*" hidden>
        <p class="status" id="ca-st"></p>
        <div class="tabs" id="ca-f"><button type="button" data-f="all" class="${this.f !== "no" && this.f !== "yes" ? "on" : ""}">Усі</button><button type="button" data-f="no" class="${this.f === "no" ? "on" : ""}">Без фото ${deck.length - n}</button><button type="button" data-f="yes" class="${this.f === "yes" ? "on" : ""}">З фото ${n}</button></div>
        <ul class="ca-list">${deck.filter((c) => this.f === "no" ? !this.photos.has(c.id) : this.f === "yes" ? this.photos.has(c.id) : true).map((c) => `<li>
          <span class="dot ${this.photos.has(c.id) ? "on" : ""}"></span><span class="nm">${esc(c.name)}<small>${esc(c.id)}</small></span>
          <button type="button" data-up="${c.id}">${this.photos.has(c.id) ? "Замінити" : "Фото…"}</button>${this.photos.has(c.id) ? `<button type="button" data-del="${c.id}" title="Видалити фото">✕</button>` : ""}</li>`).join("")}</ul>
      </div>`;
      $("ca-x").onclick = () => ($("ca").hidden = true);
      $("ca-f").querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { this.f = b.dataset.f; this.render(); }));
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
    async upload(id, file) {
      const data = await toJpeg(file);
      const j = await API.call("card_photo_upload", {id, data, mime: "image/jpeg"}, this.pw);
      this.photos.set(id, j.updated);
      if (window.Game && Game.cardPhotos) Game.cardPhotos.set(id, j.updated);
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
  window.CardsAdmin = CardsAdmin;
})();
