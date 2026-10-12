/* Зв'язок із Google Apps Script: усі запити — POST з JSON (без preflight), пароль у тілі. */
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

  async function call(action, data = {}, password) {
    if (!url || url.indexOf("http") !== 0) throw new Error("Сайт ще не підключено до таблиці: вкажіть адресу скрипта в config.js");
    let res;
    try {
      res = await fetch(url, {method: "POST", body: JSON.stringify(Object.assign({action, p: password}, data)), redirect: "follow"});
    } catch (e) {
      throw new Error("Немає зв'язку з сервером. Перевірте інтернет.");
    }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error("Сервер повернув неочікувану відповідь (перевірте розгортання скрипта)."); }
    if (!j.ok) {
      const err = new Error(j.error || "Помилка сервера");
      err.auth = /пароль|спроб/i.test(j.error || "");
      throw err;
    }
    return j;
  }

  const imgCache = new Map();
  function loadImage(id, password, action = "image") {
    if (imgCache.has(id)) return imgCache.get(id);
    const p = call(action, {id}, password).then((j) => new Promise((resolve, reject) => {
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

  window.API = {call, loadImage, url, LS, SS, imgCache};
})();
