/* Офлайн-версія: тренажер один раз завантажує етапи, картки й довідник на телефон і далі працює без інтернету.
   До сервера — жодного запиту (ліміти Cloudflare не витрачаються). Результати й «Робота над помилками» — лише на пристрої.
   Дані — в IndexedDB «poshuk-offline» (сховище files): snap — налаштування й списки, img:<етап> — пакет знімка,
   obj:/card:/ref:<id> — зображення. Позначка «увімкнено» — localStorage poshuk_offline. */
(function () {
  const LS = API.LS, KEY = "poshuk_offline", RES = "poshuk_off_results", PAUSE = "poshuk_off_paused";
  const DB_NAME = "poshuk-offline", STORE = "files";
  let dbp = null;
  function idb() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error("Сховище браузера недоступне"));
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode), st = t.objectStore(STORE), out = fn(st);
      t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
      t.onerror = () => rej(t.error || new Error("Не вдалось записати на пристрій (мало місця?)"));
      t.onabort = () => rej(t.error || new Error("Не вдалось записати на пристрій (мало місця?)"));
    });
  }
  const put = (k, v) => tx("readwrite", (s) => { s.put(v, k); });
  const get = (k) => tx("readonly", (s) => s.get(k));
  const keys = () => tx("readonly", (s) => s.getAllKeys());
  const del = (k) => tx("readwrite", (s) => { s.delete(k); });
  const clearAll = () => tx("readwrite", (s) => { s.clear(); });

  function b64Blob(b64, mime) {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], {type: mime || "image/jpeg"});
  }
  async function sha(s) {
    try { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("poshuk:" + s)); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
    catch (e) { return "plain:" + s.length; }
  }
  const urls = new Map();

  /* Файли сайту (скрипти, стилі, шрифти, картинки правил) — у кеш, щоб застосунок відкривався без мережі. */
  async function cacheShell() {
    if (!window.caches) return;
    const list = new Set(["./", "index.html", "manifest.webmanifest", "media/icon-192.png", "media/icon-512.png", "media/bg.jpg",
      "media/help-search.svg", "media/help-cards.svg", "media/help-ref.svg", "media/help-duel.svg"]);
    document.querySelectorAll("script[src]").forEach((s) => list.add(s.getAttribute("src")));
    document.querySelectorAll("link[rel=stylesheet][href]").forEach((l) => list.add(l.getAttribute("href")));
    try { const css = await (await fetch("fonts.css")).text(); (css.match(/url\(([^)]+)\)/g) || []).forEach((u) => list.add(u.slice(4, -1).replace(/["']/g, ""))); } catch (e) { /* шрифти підтягнуться з кешу браузера */ }
    const c = await caches.open("poshuk-shell");
    for (const u of list) { try { await c.add(new Request(u, {cache: "reload"})); } catch (e) { /* без цього файлу — не критично */ } }
  }

  const Offline = {
    get ready() { return !!LS.get(KEY, null); },                 // офлайн-дані завантажено на пристрій
    get on() { return this.ready && !LS.get(PAUSE, false); },    // і зараз працюємо в офлайні
    goOnline() { LS.set(PAUSE, true); },
    goOffline() { LS.del(PAUSE); },
    info() { return LS.get(KEY, null); },
    snap: null,
    async snapshot() { if (!this.snap) this.snap = await get("snap"); return this.snap; },

    /* Заміна серверних дій. */
    async call(action, data = {}, password) {
      const s = await this.snapshot();
      if (!s) throw new Error("Офлайн-дані не знайдено. Підключіться до інтернету й завантажте офлайн-версію ще раз.");
      const inf = this.info() || {};
      if ((action === "login" || action === "config") && inf.pw && (await sha(password || "")) !== inf.pw) {
        const e = new Error("Невірний пароль"); e.auth = true; throw e;
      }
      switch (action) {
        case "login": return {ok: true, role: "player"};
        case "config": return Object.assign({ok: true}, s.config);
        case "ref_list": return {ok: true, entries: s.ref || []};
        case "top": return {ok: true, top: {search: [], cards: [], duel: []}};
        case "submit": {
          const all = LS.get(RES, []);
          all.push({cs: String(data.callsign || ""), ts: String(data.date || new Date().toISOString().slice(0, 16).replace("T", " ")), items: data.items || [],
            scores: data.scores || [], max: data.max || 0, mode: data.mode || "game", conclusion: String(data.conclusion || "").slice(0, 120)});
          while (all.length > 400) all.shift();
          LS.set(RES, all);
          return {ok: true};
        }
        case "my_results": {   // власні результати — з локальних записів
          const cs = String(data.callsign || "").trim(), results = [], answers = [];
          for (const r of LS.get(RES, []).slice().reverse()) {
            if (r.cs.trim() !== cs) continue;
            const sc = r.scores || [], total = sc.reduce((a, b) => a + b, 0), max = r.max || sc.length * 10;
            results.push({ts: r.ts, pct: max ? Math.round(100 * total / max) : 0, total, max, mode: r.mode || "game", conclusion: r.conclusion || ""});
            for (const it of r.items) if (Array.isArray(it)) answers.push({kind: it[0], item: it[1], name: it[2], cat: it[3], ok: it[4] ? 1 : 0, ts: r.ts});
          }
          return {ok: true, results, answers};
        }
        case "mistakes": {   // як на сервері: остання спроба з помилкою
          const cs = String(data.callsign || "").trim(), last = new Map();
          for (const r of LS.get(RES, [])) {
            if (r.cs.trim() !== cs) continue;
            const at = new Map();
            for (const it of r.items) { if (!Array.isArray(it) || !/^(search|cards)$/.test(it[0])) continue; const k = it[0] + "|" + it[1]; at.set(k, Math.min(at.has(k) ? at.get(k) : 1, it[4] ? 1 : 0)); }
            for (const [k, ok] of at) { const p = last.get(k); if (!p || r.ts >= p.ts) last.set(k, {ts: r.ts, ok}); }
          }
          const out = {ok: true, stages: [], cards: []};
          for (const [k, v] of last) if (!v.ok) { const [kind, id] = k.split("|"); (kind === "search" ? out.stages : out.cards).push(id); }
          return out;
        }
      }
      throw new Error("Недоступно в офлайн-версії");
    },
    async image(id) {
      const buf = await get("img:" + id);
      if (!buf) throw new Error("Цей етап не завантажено в офлайн-версію");
      return Tiles.open(buf);
    },
    async url(kind, id) {
      const k = kind + ":" + id;
      if (urls.has(k)) return urls.get(k);
      const blob = await get(k).catch(() => null);
      if (!blob) return null;
      const u = URL.createObjectURL(blob);
      urls.set(k, u);
      return u;
    },

    /* Завантаження (і оновлення) — лише з інтернетом. progress(текст, частка 0..1). */
    /* opt.auto — тихе фонове оновлення: режим (онлайн/офлайн) не змінюється, відкриті зображення не відкликаються.
       Повертає, скільки файлів змінилось (завантажено нових + прибрано застарілих). */
    async download(password, progress = () => {}, opt = {}) {
      let changed = 0;
      if (!navigator.onLine) throw new Error("Немає інтернету. Завантаження потрібне один раз — з мережею.");
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* ок */ }
      progress("Отримую список етапів…", 0);
      // ключем офлайн-пристрою (password === "") — з позначкою off; паролем — як завжди
      const off = password === "" ? {off: 1} : {};
      const cfg = await API.callNet("config", off, password);
      const ref = (await API.callNet("ref_list", off, password)).entries || [];
      const stages = (cfg.stages || []).filter((s) => s.targets && s.targets.some((t) => !t.decoy));
      const keep = new Set(["snap"]);
      let bytes = 0;
      // знімки етапів — по одному запиту на етап; незмінені (та сама версія) не перекачуємо
      const old = (this.info() || {}).ver || {};
      for (let i = 0; i < stages.length; i++) {
        const s = stages[i], k = "img:" + s.id;
        keep.add(k);
        progress(`Знімки етапів: ${i + 1} з ${stages.length}…`, 0.05 + 0.6 * i / stages.length);
        const have = old[s.id] === (s.v || "") ? await get(k).catch(() => null) : null;
        if (have) { bytes += have.byteLength || 0; continue; }
        const buf = await API.fetchPack(s.id, password);
        await put(k, buf);
        bytes += buf.byteLength; changed++;
      }
      // зображення: техніка (брифінг), фото карток, довідник — пачками в один запит
      const want = [];
      (cfg.objects || []).forEach((o) => { if (o.id && !/^builtin:/.test(o.id)) want.push(["obj", o.id]); });
      (cfg.cardPhotos || []).forEach(([id]) => want.push(["card", id]));
      ref.forEach((e) => (e.imgs || []).forEach((id) => want.push(["ref", id])));
      want.forEach(([kind, id]) => keep.add(kind + ":" + id));
      const have = new Set(await keys());
      let todo = want.filter(([kind, id]) => !have.has(kind + ":" + id) || kind === "card"), done = want.length - todo.length;
      while (todo.length) {
        progress(`Фото техніки й довідника: ${done} з ${want.length}…`, 0.65 + 0.3 * done / Math.max(1, want.length));
        const batch = todo.slice(0, 120);
        const j = await API.callNet("offline_assets", {items: batch}, password);
        for (const [k, v] of Object.entries(j.items || {})) { const b = b64Blob(v.data, v.mime); await put(k, b); bytes += b.size; done++; if (!k.startsWith("card:")) changed++; }
        const rest = new Set((j.rest || []).map(([kind, id]) => kind + ":" + id));
        const sentMissing = batch.filter(([kind, id]) => !rest.has(kind + ":" + id) && !(j.items || {})[kind + ":" + id]).length;
        done += sentMissing;   // на сервері вже немає — пропускаємо
        todo = (j.rest || []).concat(todo.slice(120));
      }
      progress("Зберігаю…", 0.96);
      const config = Object.assign({}, cfg); delete config.token; delete config.ok;
      config.stages = stages;
      await put("snap", {config, ref});
      for (const k of await keys()) if (!keep.has(k)) { await del(k); changed++; }
      const prev = this.info() || {};
      if (prev.stages !== stages.length || prev.ref !== ref.length) changed++;
      this.snap = null;
      if (!opt.auto) { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); }
      await cacheShell();
      LS.set(KEY, {at: new Date().toISOString(), stages: stages.length, cards: (cfg.cardPhotos || []).length, ref: ref.length, bytes, pw: await sha(password),
        ver: Object.fromEntries(stages.map((s) => [s.id, s.v || ""]))});
      if (!opt.auto) LS.del(PAUSE);   // після завантаження вручну — одразу в офлайн
      // ключ пристрою для автооновлень (не залежить від зміни паролів); з кожним оновленням продовжується
      try { const k = await API.callNet("offline_key", password === "" ? {off: 1} : {}, password); if (k.key) LS.set("poshuk_off_key", k.key); } catch (e) { /* лишається старий */ }
      progress("Готово", 1);
      return changed;
    },
    /* Автооновлення офлайн-даних двічі на добу — о 08:00 і 20:00 (час пристрою): якщо застосунок відкритий
       або відкриється пізніше, а з останньої перевірки настав новий строк і є інтернет — тихо докачує зміни. */
    autoSlot(now = new Date()) {
      const d = new Date(now); const slots = [8, 20].map((h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; });
      const past = slots.filter((x) => x <= d);
      if (past.length) return past[past.length - 1].getTime();
      const y = new Date(d); y.setDate(y.getDate() - 1); y.setHours(20, 0, 0, 0); return y.getTime();
    },
    async autoUpdate(password, onDone) {
      // оновлюємо ключем пристрою; немає ключа (завантажено до цієї версії) — паролем, і тоді ключ з'явиться
      const key = LS.get("poshuk_off_key", null);
      if (key) { API.useKey(key); password = ""; }
      if (!this.ready || (password !== "" && !password) || !navigator.onLine || this._auto) return;
      const st = LS.get("poshuk_off_auto", {}) || {}, slot = this.autoSlot();
      const last = Math.max(st.at || 0, Date.parse((this.info() || {}).at || "") || 0);
      if (last >= slot) return;                                   // у цьому строку вже оновлено
      if (st.fail && Date.now() - st.fail < 3600e3) return;       // невдала спроба — повтор не частіше разу на годину
      this._auto = true;
      try {
        const changed = await this.download(password, () => {}, {auto: true});
        LS.set("poshuk_off_auto", {at: Date.now()});
        if (onDone) onDone(changed);
      } catch (e) {
        LS.set("poshuk_off_auto", Object.assign(st, {fail: Date.now(), err: String(e.message || e).slice(0, 160)}));
        if (/недійсний/.test(e.message || "")) LS.del("poshuk_off_key");   // ключ відкликано — далі лише після завантаження паролем
      }
      finally { this._auto = false; }
    },
    async disable() {
      LS.del(KEY); LS.del(RES); LS.del(PAUSE); LS.del("poshuk_off_key"); LS.del("poshuk_off_auto");
      this.snap = null; urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear();
      try { await clearAll(); } catch (e) { /* ок */ }
    },
  };
  window.Offline = Offline;
})();
