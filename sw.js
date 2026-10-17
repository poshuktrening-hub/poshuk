/* Кеш файлів сайту, щоб застосунок відкривався без мережі (офлайн-версія).
   Запити /api не кешуються ніколи.
   • сторінка — спершу мережа, без мережі (або довше 4 с) — копія з кешу;
   • файли з версією в адресі (?v=…) — лише точна версія: з кешу, якщо є, інакше мережа без обмеження часу.
     Так стара й нова версії скриптів ніколи не змішуються (інакше на повільній мережі ламався вхід);
   • решта (шрифти, картинки без версії) — з кешу з фоновим оновленням. */
const CACHE = "poshuk-shell";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

/* Після свіжої сторінки — прибрати з кешу файли старих версій (?v=…), яких сторінка вже не згадує. */
async function prune(c, res) {
  const html = await res.text(), keep = new Set((html.match(/[?&]v=([0-9]+)/g) || []).map((m) => m.slice(3)));
  if (!keep.size) return;
  for (const k of await c.keys()) { const v = (new URL(k.url).searchParams.get("v") || ""); if (v && !keep.has(v)) await c.delete(k); }
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api")) return;
  if (/\.(mp4|webm)$/i.test(url.pathname)) return;   // фонове відео — без кешу (є картинка-заставка)
  const nav = req.mode === "navigate", versioned = url.searchParams.has("v");
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (nav) {
      const net = fetch(req).then((r) => { if (r.status === 200) { c.put("./", r.clone()).catch(() => {}); e.waitUntil(prune(c, r.clone()).catch(() => {})); } return r; });
      const cached = (await c.match("./")) || (await c.match("index.html"));
      if (!cached) return net;
      const timeout = new Promise((res) => setTimeout(() => res(null), 4000));
      try { const r = await Promise.race([net, timeout]); if (r) return r; } catch (er) { /* немає мережі */ }
      e.waitUntil(net.catch(() => {}));
      return cached;
    }
    if (versioned) {
      const hit = await c.match(req);               // лише ця сама версія
      if (hit) return hit;
      const r = await fetch(req);
      if (r.status === 200) e.waitUntil(c.put(req, r.clone()).catch(() => {}));
      return r;
    }
    const hit = await c.match(req);
    const net = fetch(req).then((r) => { if (r.status === 200) c.put(req, r.clone()).catch(() => {}); return r; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })());
});
