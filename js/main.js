/* Маршрут: адреса з #admin — адмінка, інакше гра. */
(function () {
  function route() {
    if (!API.url || API.url.indexOf("http") !== 0) {
      UI.show("s-login");
      document.getElementById("login-sub").textContent = "Сайт ще не підключено до таблиці. Адміністратору: вставте адресу скрипта у файл config.js.";
      document.getElementById("login-btn").disabled = true;
      return;
    }
    if (location.hash === "#admin") Admin.boot(); else Game.boot();
  }
  window.addEventListener("hashchange", () => location.reload());
  route();
})();
