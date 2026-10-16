/* Кеш файлів сайту, щоб застосунок відкривався без мережі (офлайн-версія).
   Запити /api не кешуються ніколи. Сторінка — спершу мережа, без мережі — з кешу;
   решта (скрипти, стилі, шрифти, картинки) — з кешу з фоновим оновленням. */
const CACHE = "poshuk-shell";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(async () => {
      const c = await caches.open(CACHE);
      return (await c.match("./")) || (await c.match("index.html")) || (await c.match(req, {ignoreSearch: true})) || Response.error();
    }));
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req) || await c.match(req, {ignoreSearch: true});
    const net = fetch(req).then((r) => {
      if (r.status === 200 && !/\.(mp4|webm)$/i.test(url.pathname)) c.put(req, r.clone()).catch(() => {});
      return r;
    });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })());
});
