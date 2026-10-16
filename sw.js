/* Кеш файлів сайту, щоб застосунок відкривався без мережі (офлайн-версія).
   Запити /api не кешуються ніколи. Усе інше — спершу мережа (свіжа версія, без змішування старих і нових файлів),
   а якщо мережі немає або вона не відповідає за кілька секунд — з кешу. */
const CACHE = "poshuk-shell";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function fromCache(c, req, nav) {
  return (await c.match(req)) || (nav && ((await c.match("./")) || (await c.match("index.html")))) || (await c.match(req, {ignoreSearch: true}));
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api")) return;
  const nav = req.mode === "navigate", media = /\.(mp4|webm)$/i.test(url.pathname);
  if (media) return;   // фонове відео — без кешу (є картинка-заставка)
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const net = fetch(req).then((r) => {
      if (r.status === 200) c.put(nav ? "./" : req, r.clone()).catch(() => {});
      return r;
    });
    const cached = await fromCache(c, req, nav);
    if (!cached) return net;   // нічого в кеші (звичайний онлайн-режим) — просто мережа
    // є копія: чекаємо мережу до 4 с, далі — копія з кешу
    const timeout = new Promise((res) => setTimeout(() => res(null), 4000));
    try {
      const r = await Promise.race([net, timeout]);
      if (r) return r;
    } catch (er) { /* немає мережі */ }
    e.waitUntil(net.catch(() => {}));
    return cached;
  })());
});
