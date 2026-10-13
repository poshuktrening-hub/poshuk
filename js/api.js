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

  async function call(action, data = {}, password) {
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
      if (isCF && body.t) { delete tokens[password]; if (/вхід|токен/i.test(j.error || "")) return call(action, data, password); }
      const err = new Error(j.error || "Помилка сервера");
      err.auth = /пароль|спроб/i.test(j.error || "");
      throw err;
    }
    if (j.token) tokens[password] = j.token;
    return j;
  }

  async function token(password) {
    if (!tokens[password]) await call("login", {}, password);
    return tokens[password];
  }

  const imgCache = new Map();
  function loadImage(id, password) {
    if (imgCache.has(id)) return imgCache.get(id);
    const p = isCF ? loadPack(id, password) : call("image", {id}, password).then((j) => new Promise((resolve, reject) => {
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

  async function loadPack(id, password) {
    const t = await token(password);
    let res;
    try { res = await fetch(`${url}/img/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}`); } catch (e) { throw new Error("Немає зв'язку з сервером."); }
    if (res.status === 403) { delete tokens[password]; throw new Error("Сесія застаріла — оновіть сторінку"); }
    if (!res.ok) throw new Error("Знімок не знайдено");
    return Tiles.open(await res.arrayBuffer());
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
    if (!isCF || !id) return null;
    return `${url}/obj/${encodeURIComponent(id)}?t=${encodeURIComponent(await token(password))}`;
  }

  window.API = {call, loadImage, uploadStage, objUrl, url, isCF, LS, SS, imgCache};
})();
