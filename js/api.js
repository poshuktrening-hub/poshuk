/* Зв'язок із сервером. Два варіанти:
   • Cloudflare (адреса "/api"): токен після входу, знімки — пакети плиток з CDN;
   • Google Apps Script (повна адреса …/exec): усе через POST, знімки — base64. */
(function () {
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватний режим */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ок */ } },
  };
  const SS = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ок */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ок */ } },
  };

  const url = (window.POSHUK_CONFIG && window.POSHUK_CONFIG.api || "").trim();
  const isCF = url.indexOf("/") === 0;
  const tokens = {};            // пароль → токен (Cloudflare)

  /* Офлайн-версія (js/offline.js): усі виклики й зображення — з телефона, до сервера ні запиту. */
  const off = () => window.Offline && Offline.on;
  async function call(action, data = {}, password) {
    if (off()) return Offline.call(action, data, password);
    return callNet(action, data, password);
  }
  /* Тайм-аут запиту: на поганому мобільному зв'язку fetch може «висіти» хвилинами. Звичайні дії — 30 с,
     важкі (вивантаження, офлайн-пакети, аналітика, автопошук) — 3 хв. */
  const LONG = /offline|upload|import|fill|analytics|archive|duel_ready|stage_|ref_put|export|backup|restore|reimage|photo/;
  function timed(ms) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    return {signal: c.signal, done: () => clearTimeout(t), abort: () => c.abort()};
  }
  const NET_ERR = "Немає зв'язку з сервером. Перевірте інтернет.";
  async function callNet(action, data = {}, password) {
    if (!url || !(isCF || url.indexOf("http") === 0)) throw new Error("Сайт ще не підключено до сервера: вкажіть адресу в config.js");
    const body = Object.assign({action, p: password}, data);
    if (isCF && tokens[password]) body.t = tokens[password];
    const tm = timed(LONG.test(action) ? 180e3 : 30e3);
    let res, j;
    try {
      res = await fetch(url, {method: "POST", body: JSON.stringify(body), redirect: "follow", signal: tm.signal});
      try { j = await res.json(); } catch (e) { if (tm.signal.aborted) throw e; throw new Error("Сервер повернув неочікувану відповідь (перевірте розгортання)."); }
    } catch (e) {
      if (/неочікувану/.test(e.message || "")) throw e;
      throw new Error(tm.signal.aborted ? "Немає зв'язку з сервером: сервер не відповідає. Спробуйте ще раз." : NET_ERR);
    } finally { tm.done(); }
    if (!j.ok) {
      if (isCF && body.t) { delete tokens[password]; if (/вхід|токен/i.test(j.error || "")) return callNet(action, data, password); }
      const err = new Error(j.error || "Помилка сервера");
      err.auth = /пароль|спроб/i.test(j.error || "");
      throw err;
    }
    if (j.token) { tokens[password] = j.token; tokenAt[password] = Date.now(); tokenCookie(j.token); }
    return j;
  }
  const tokenAt = {};

  /* Токен у cookie (лише для /api): адреси фото й знімків тоді без ?t=…, тобто сталі — і кеш браузера
     тримає їх тиждень, а не до наступного входу. Якщо cookie не приймаються — токен лишається в адресі. */
  let cookieOk = false;
  function tokenCookie(t) {
    if (!isCF) return;
    try {
      document.cookie = `pt=${encodeURIComponent(t)}; Path=/; Max-Age=43200; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      cookieOk = document.cookie.indexOf("pt=") >= 0;
    } catch (e) { cookieOk = false; }
  }
  // cookie живе 12 год: якщо вона вже зникла (застосунок відкритий довго) — токен знову в адресі
  const tq = (t) => (cookieOk && document.cookie.indexOf("pt=") >= 0 ? "" : `&t=${encodeURIComponent(t)}`);

  /* Ключ офлайн-пристрою (офлайн-версія оновлюється ним, навіть якщо паролі змінили): «пароль» "" + цей токен. */
  function useKey(key) { if (key) tokens[""] = key; else delete tokens[""]; }
  /* Токен для картинок; старший за 10 год — новий вхід (токен і cookie не протухнуть посеред гри → фото не «зникають»). */
  async function token(password) {
    const old = password && tokenAt[password] && Date.now() - tokenAt[password] > 10 * 3600e3;
    if (!tokens[password] || old) {
      try { await callNet("login", {}, password); } catch (e) { if (!tokens[password]) throw e; }
    }
    return tokens[password];
  }

  const imgCache = new Map();
  function loadImage(id, password) {
    if (imgCache.has(id)) return imgCache.get(id);
    const p = off() ? Offline.image(id) : isCF ? loadPack(id, password) : call("image", {id}, password).then((j) => new Promise((resolve, reject) => {
      const bin = atob(j.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Не вдалось показати знімок"));
      img.src = URL.createObjectURL(new Blob([bytes], {type: j.mime || "image/png"}));
    }));
    p.catch(() => imgCache.delete(id));
    imgCache.set(id, p);
    return p;
  }

  /* Версії знімків (після перерендеру етапу змінюється v → нова адреса, кеш браузера не віддасть старий знімок). */
  const imgVer = {};
  function noteStages(list) {
    for (const s of list || []) { const v = s.v || ""; if (imgVer[s.id] !== undefined && imgVer[s.id] !== v) imgCache.delete(s.id); imgVer[s.id] = v; }
  }
  /* Знімок для гри — потоком: щойно дійшли заголовок і превʼю (вони на початку пакета), етап уже можна показувати;
     плитки повної роздільності домальовуються, коли докачається решта. Обрив посередині — лишається превʼю,
     а знімок прибирається з кешу (наступного разу качається знову). */
  async function loadPack(id, password) {
    const res = await packRes(id, password);
    if (!res.body || !res.body.getReader) return Tiles.open(await res.arrayBuffer());
    const reader = res.body.getReader();
    let idle = null;
    const watch = () => { clearTimeout(idle); idle = setTimeout(() => reader.cancel().catch(() => {}), 25e3); };   // 25 с без жодного байта — обрив
    let restOk, restErr;
    const rest = new Promise((a, b) => { restOk = a; restErr = b; });
    rest.catch(() => imgCache.delete(id));
    return new Promise((resolve, reject) => {
      let opened = false, buf = null, u8 = null, got = 0, head = [], headLen = 0, need = 0, total = 0;
      const tryOpen = () => { if (!opened && buf && got >= need) { opened = true; Tiles.open(buf, rest).then(resolve, (e) => { reject(e); restErr(e); }); } };
      (async () => {
        try {
          watch();
          for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            watch();
            if (!buf) {
              head.push(value); headLen += value.byteLength;
              const h = new Uint8Array(headLen); let p = 0; for (const c of head) { h.set(c, p); p += c.byteLength; }
              const inf = Tiles.info(h, headLen);
              if (!inf) { head = [h]; continue; }
              total = inf.total; need = inf.need;
              buf = new ArrayBuffer(total); u8 = new Uint8Array(buf);
              got = Math.min(headLen, total); u8.set(h.subarray(0, got)); head = null;
            } else {
              const n = Math.min(value.byteLength, total - got);
              u8.set(value.subarray(0, n), got); got += n;
            }
            tryOpen();
          }
          clearTimeout(idle);
          if (!buf || got < total) throw new Error("Знімок завантажився не повністю — перевірте зв'язок");
          restOk();
          tryOpen();
        } catch (e) {
          clearTimeout(idle);
          const err = /не повністю|Пошкоджений/.test(e.message || "") ? e : new Error("Немає зв'язку з сервером.");
          restErr(err);
          if (!opened) { opened = true; reject(err); }
        }
      })();
    });
  }
  async function packRes(id, password) {
    const t = await token(password);
    let res;
    try { res = await fetch(`${url}/img/${encodeURIComponent(id)}?v=${encodeURIComponent(imgVer[id] || "")}`, {headers: {"X-Token": t}}); } catch (e) { throw new Error("Немає зв'язку з сервером."); }
    if (res.status === 403) { delete tokens[password]; delete tokenAt[password]; throw new Error("Сесія застаріла — спробуйте ще раз"); }
    if (!res.ok) throw new Error("Знімок не знайдено");
    return res;
  }
  /* Пакет знімка як є (ArrayBuffer) — для офлайн-версії. */
  async function fetchPack(id, password) { return (await packRes(id, password)).arrayBuffer(); }

  /* Лишити в пам'яті лише ці знімки (поточний і наступний етап); решту — звільнити. */
  function trimImages(keep) {
    const k = new Set(keep || []);
    for (const [id, p] of imgCache) {
      if (k.has(id)) continue;
      imgCache.delete(id);
      Promise.resolve(p).then((im) => { if (im && im.release) im.release(); }, () => {});
    }
  }

  /* Новий етап зі знімка (Image/Canvas/ImageBitmap або TiledImage). */
  async function uploadStage(src, meta, password, onProgress) {
    if (!isCF) {
      const cv = await Tiles.toCanvas(src);
      let blob = await new Promise((r) => cv.toBlob(r, "image/png"));
      let mime = "image/png", name = (meta.name || "stage") + ".png";
      if (blob.size > 15e6) { blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.95)); mime = "image/jpeg"; name = name.replace(/png$/, "jpg"); }
      const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
      const j = await call("upload", {name, mime, data, title: meta.title, w: cv.width, h: cv.height, targets: meta.targets || []}, password);
      imgCache.set(j.stage.id, Promise.resolve(cv));
      return j.stage;
    }
    if (onProgress) onProgress("Готую плитки…");
    const pack = await Tiles.build(src);
    const b = await call("stage_begin", {title: meta.title, w: pack.w, h: pack.h, targets: meta.targets || [], size: pack.bytes.byteLength}, password);
    for (let i = 0; i < b.chunks; i++) {
      if (onProgress) onProgress(`Вивантажую ${i + 1}/${b.chunks}…`);
      const part = pack.bytes.subarray(i * b.chunk, Math.min(pack.bytes.byteLength, (i + 1) * b.chunk));
      let ok = false, err = null;
      for (let k = 0; k < 3 && !ok; k++) {
        try {
          const r = await fetch(`${url}/blob/${b.id}/${i}`, {method: "PUT", headers: {"X-Token": b.token}, body: part});
          const j = await r.json(); ok = j.ok; err = j.error;
        } catch (e) { err = "Немає зв'язку з сервером"; }
      }
      if (!ok) throw new Error(err || "Не вдалось вивантажити знімок");
    }
    const j = await call("stage_end", {id: b.id}, password);
    imgCache.set(j.stage.id, Tiles.open(pack.bytes.buffer.slice(pack.bytes.byteOffset, pack.bytes.byteOffset + pack.bytes.byteLength)));
    return j.stage;
  }

  /* Версії картинок моделей техніки (дата заміни) — з config: замінили модель → нова адреса, кеш не віддасть стару. */
  const objVer = {};
  function noteObjects(list) { for (const o of list || []) if (o && o.id) objVer[o.id] = o.created || ""; }
  async function objUrl(id, password) {
    if (id && off()) return Offline.url("obj", id);
    if (!isCF || !id) return null;
    return `${url}/obj/${encodeURIComponent(id)}?v=${encodeURIComponent(objVer[id] || "1")}${tq(await token(password))}`;
  }

  async function cardUrl(id, ver, password) {
    if (id && off()) return Offline.url("card", id);
    if (!isCF || !id) return null;
    return `${url}/card/${encodeURIComponent(id)}?v=${encodeURIComponent(ver || "")}${tq(await token(password))}`;
  }

  async function refUrl(id, ver, password) {
    if (id && off()) return Offline.url("ref", id);
    if (!isCF || !id) return null;
    return `${url}/ref/${encodeURIComponent(id)}?v=${encodeURIComponent(ver || "")}${tq(await token(password))}`;
  }

  /* Список довідника — один запит на сеанс для гри й довідника (раніше качався двічі); оновлюється раз на 10 хв
     або після змін в адмінці (refReset). */
  let refP = null, refAt = 0;
  function refList(password) {
    if (!refP || Date.now() - refAt > 10 * 60e3) { refAt = Date.now(); refP = call("ref_list", {}, password); refP.catch(() => { refP = null; }); }
    return refP;
  }
  const refReset = () => { refP = null; };

  /* Модулі, яких немає на першому екрані (дані карток ~470 КБ, довідник, дуель, моделі техніки) — вантажаться
     після входу у фоні, а розділ, якому вони потрібні, чекає на них (API.need). Так вхід з'являється в рази швидше. */
  const LAZY = {
    data: ["cards-data", "cards-data3", "cards-weak", "cards-data2", "cards-own", "ff-skip"],
    models: ["compose", "models", "models2"],
    extra: ["marks", "ref", "markexport", "print"],
    duel: ["duel"],
  };
  const LAZY_DEPS = {extra: ["data"], duel: ["models"]};
  const lazyP = {}, lazyDone = {};
  // адреси з версією за вмістом файлу (tools/stamp.js пише їх в index.html)
  const AV = (() => { try { return JSON.parse((document.getElementById("asset-v") || {}).textContent || "{}"); } catch (e) { return {}; } })();
  const lazySrc = (name) => AV[name] || `js/${name}.js`;
  function script(name) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = lazySrc(name);
      s.onload = res; s.onerror = () => { s.remove(); rej(new Error(`Не завантажився модуль ${name}.js — перевірте зв'язок`)); };
      document.body.appendChild(s);
    });
  }
  function need(...groups) {
    return Promise.all(groups.map((g) => lazyP[g] || (lazyP[g] = (async () => {
      if (LAZY_DEPS[g]) await need(...LAZY_DEPS[g]);
      for (const n of LAZY[g]) await script(n);
      lazyDone[g] = true;
    })().catch((e) => { delete lazyP[g]; throw e; }))));
  }
  const ready = (...groups) => groups.every((g) => lazyDone[g]);
  const lazyFiles = () => Object.values(LAZY).flat().map(lazySrc);

  window.API = {noteObjects, need, ready, lazyFiles, lazySrc, refList, refReset, useKey, call, callNet, fetchPack, token, noteStages, loadImage, trimImages, uploadStage, objUrl, cardUrl, refUrl, url, isCF, LS, SS, imgCache};
})();
