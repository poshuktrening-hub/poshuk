/* Маршрут: адреса з #admin — адмінка, інакше гра. */
(function () {
  function route() {
    if (!API.url || !(API.isCF || API.url.indexOf("http") === 0)) {
      UI.show("s-login");
      document.getElementById("login-sub").textContent = "Сайт ще не підключено до таблиці. Адміністратору: вставте адресу скрипта у файл config.js.";
      document.getElementById("login-btn").disabled = true;
      return;
    }
    if (location.hash === "#admin") loadAdmin().then(() => Admin.boot()).catch((e) => { UI.show("s-login"); document.getElementById("login-sub").textContent = e.message; });
    else Game.boot();
  }
  /* Адмінка — окремі модулі (~200 КБ), які курсантові не потрібні: вантажаться лише за адресою #admin. */
  const ADMIN_JS = ["cards-commons", "cards-admin", "analytics", "scale", "crop", "generator", "compose-legacy", "restage", "variants", "admin"];
  function loadAdmin() {
    if (window.Admin) return Promise.resolve();
    const me = document.querySelector('script[src*="js/main.js"]'), v = me && (me.getAttribute("src").match(/v=([^&]+)/) || [])[1] || "";
    return ADMIN_JS.reduce((p, name) => p.then(() => new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = `js/${name}.js${v ? "?v=" + v : ""}`;
      s.onload = res; s.onerror = () => rej(new Error(`Не завантажився модуль адмінки: ${name}.js — оновіть сторінку`));
      document.body.appendChild(s);
    })), Promise.resolve());
  }
  window.addEventListener("hashchange", () => location.reload());
  // застосунок на головному екрані (Android): запам'ятати запрошення встановити
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); if (window.Game) Game.installEvt = e; });
  /* Встановлений застосунок на ПК — на весь екран. Браузер дозволяє повний екран лише після дії користувача,
     тому вмикаємо його на перший клік чи клавішу. Вийшли з повного екрана (Esc/F11) — більше не нав'язуємо до наступного запуску. */
  const installed = matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches || matchMedia("(display-mode: window-controls-overlay)").matches;
  const pc = matchMedia("(pointer: fine)").matches && matchMedia("(hover: hover)").matches;
  if (installed && pc && document.documentElement.requestFullscreen && !location.hash.startsWith("#admin")) {
    let declined = false;
    const go = () => {
      if (declined || document.fullscreenElement) return;
      document.documentElement.requestFullscreen({navigationUI: "hide"}).catch(() => {});
    };
    document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) declined = true; });
    window.addEventListener("pointerdown", go, {capture: true});
    window.addEventListener("keydown", (e) => { if (e.key !== "Escape" && e.key !== "F11") go(); }, {capture: true});
  }
  // кеш файлів сайту — щоб відкривався без мережі (для офлайн-версії)
  if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch(() => {});
  route();
})();
