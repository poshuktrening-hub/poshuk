/* Версії файлів у index.html за їхнім вмістом: node tools/stamp.js (запускати перед кожним релізом).
   Кожен скрипт/стиль отримує ?v=<число з хешу вмісту> — змінився файл → нова адреса, решта лишається в кеші
   браузера й service worker (раніше одна спільна версія змушувала перекачувати все після будь-якої правки).
   Модулі, що вантажаться пізніше (API.need, адмінка), — у <script type="application/json" id="asset-v">. */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const root = path.join(__dirname, "..");
const ver = (f) => String(parseInt(crypto.createHash("sha1").update(fs.readFileSync(path.join(root, f))).digest("hex").slice(0, 9), 16));
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
html = html.replace(/(src|href)="([^"?]+\.(?:js|css))\?v=\d+"/g, (m, a, f) => `${a}="${f}?v=${ver(f)}"`);
const inHtml = new Set([...html.matchAll(/src="js\/([^".?]+)\.js\?/g)].map((m) => m[1]));
const lazy = {};
for (const f of fs.readdirSync(path.join(root, "js")).sort()) {
  const n = f.replace(/\.js$/, "");
  if (f.endsWith(".js") && !inHtml.has(n)) lazy[n] = `js/${f}?v=${ver("js/" + f)}`;
}
const block = `<script type="application/json" id="asset-v">${JSON.stringify(lazy)}</script>`;
if (/<script type="application\/json" id="asset-v">[^<]*<\/script>/.test(html)) html = html.replace(/<script type="application\/json" id="asset-v">[^<]*<\/script>/, block);
else html = html.replace(/(<script src="config\.js)/, `${block}\n$1`);
fs.writeFileSync(path.join(root, "index.html"), html);
console.log(`stamped: ${inHtml.size} in page, ${Object.keys(lazy).length} lazy`);
