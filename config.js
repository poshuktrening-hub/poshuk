/* Куди звертається сайт.
   • На Cloudflare (*.pages.dev або свій домен) — вбудований сервер "/api".
   • На GitHub Pages — Google Apps Script (стара схема, працює паралельно до повного переїзду).
   gas — адреса Google-скрипта: для перенесення етапів і для GitHub-версії. */
(function () {
  const GAS = "https://script.google.com/macros/s/AKfycbwQwREKkQLH18-z4cnJKse146hTkdDmNlfE83ru9OlXQjkE_bU7xctcndsNhps3Dmra3w/exec";
  const onGitHub = /github\.io$/.test(location.hostname);
  window.POSHUK_CONFIG = {api: onGitHub ? GAS : "/api", gas: GAS};
})();
