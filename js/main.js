/* Маршрут: адреса з #admin — адмінка, інакше гра. */
(function () {
  function route() {
    if (!API.url || !(API.isCF || API.url.indexOf("http") === 0)) {
      UI.show("s-login");
      document.getElementById("login-sub").textContent = "Сайт ще не підключено до таблиці. Адміністратору: вставте адресу скрипта у файл config.js.";
      document.getElementById("login-btn").disabled = true;
      return;
    }
    if (location.hash === "#admin") Admin.boot(); else Game.boot();
  }
  window.addEventListener("hashchange", () => location.reload());
  // застосунок на головному екрані (Android): запам'ятати запрошення встановити
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); if (window.Game) Game.installEvt = e; });
  // кеш файлів сайту — щоб відкривався без мережі (для офлайн-версії)
  if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch(() => {});
  route();
})();
