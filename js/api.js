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
  async function callNet(action, data = {}, password) {
    if (!url || !(isCF || url.indexOf("http") === 0)) throw new Error("Сайт ще не підключено до сервера: вкажіть адресу в config.js");
    const body = Object.assign({action, p: password}, data);
    if (isCF && tokens[password]) body.t = tokens[password];
    let res;
    try {
      res = await fetch(url, {method: "POST", body: JSON.stringify(body), redirect: "follow"});
    } catch (e) {
      throw new Error("Немає зв'язку з сервером. Перевірте інтернет.");
    }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error("Сервер повернув неочікувану відповідь (перевірте розгортання)."); }
    if (!j.ok) {
      if (isCF && body.t) { delete tokens[password]; if (/вхід|токен/i.test(j.error || "")) return callNet(action, data, password); }
      const err = new Error(j.error || "Помилка сервера");
      err.auth = /пароль|спроб/i.test(j.error || "");
      throw err;
    }
    if (j.token) { tokens[password] = j.token; tokenCookie(j.token); }
    return j;
  }

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
  const tq = (t) => (cookieOk ? "" : `&t=${encodeURIComponent(t)}`);

  /* Ключ офлайн-пристрою (офлайн-версія оновлюється ним, навіть якщо паролі змінили): «пароль» "" + цей токен. */
  function useKey(key) { if (key) tokens[""] = key; else delete tokens[""]; }
  async function token(password) {
    if (!tokens[password]) await callNet("login", {}, password);
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
  async function loadPack(id, password) { return Tiles.open(await fetchPack(id, password)); }
  /* Пакет знімка як є (ArrayBuffer) — для офлайн-версії. */
  async function fetchPack(id, password) {
    const t = await token(password);
    let res;
    try { res = await fetch(`${url}/img/${encodeURIComponent(id)}?v=${encodeURIComponent(imgVer[id] || "")}`, {headers: {"X-Token": t}}); } catch (e) { throw new Error("Немає зв'язку з сервером."); }
    if (res.status === 403) { delete tokens[password]; throw new Error("Сесія застаріла — оновіть сторінку"); }
    if (!res.ok) throw new Error("Знімок не знайдено");
    return res.arrayBuffer();
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

  async function objUrl(id, password) {
    if (id && off()) return Offline.url("obj", id);
    if (!isCF || !id) return null;
    return `${url}/obj/${encodeURIComponent(id)}?v=1${tq(await token(password))}`;
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

  window.API = {useKey, call, callNet, fetchPack, token, noteStages, loadImage, uploadStage, objUrl, cardUrl, refUrl, url, isCF, LS, SS, imgCache};
})();
