/* Адмінка → Довідник → «Експорт фото для розмітки»: фото записів (крім «лише довідник» і вже розмічених)
   у ZIP-архіви частинами, кожен з manifest.json (id фото, техніка, ознаки й недоліки з опису).
   Архіви надсилаються Claude; розмітка повертається в репозиторій (media/seed/marks.json) і сервер вносить її сам,
   не чіпаючи ознак, які адміністратор уже розставив вручну. */
(function () {
  const PART = 120, SIDE = 900, Q = 0.82;

  /* ---------- мінімальний ZIP (без стиснення: JPEG і так стиснутий) */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {   // files: [{name, data: Uint8Array}]
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + n;
    }
    const csize = central.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], {type: "application/zip"});
  }

  /* фото → JPEG до 900 пкс */
  async function shrink(url) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => rej(new Error("фото не відкрилось")); i.src = url; });
    const k = Math.min(1, SIDE / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    const b = await new Promise((r) => c.toBlob(r, "image/jpeg", Q));
    return {data: new Uint8Array(await b.arrayBuffer()), w: img.naturalWidth, h: img.naturalHeight};
  }
  const plain = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  function save(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }

  const MarkExport = {
    /* entries — записи довідника (RefAdmin.entries), pw — пароль адміністратора, say(text) — статус. */
    async run(entries, pw, say) {
      const marks = (window.Game && Game.marks) || {}, deck = window.Cards ? new Map(Cards.deck().map((c) => [c.id, c])) : new Map();
      const list = [];
      for (const e of entries) for (const id of e.imgs || []) if (!String(id).includes("--ref") && !marks[id]) list.push({id, e});
      if (!list.length) return say("Усі фото вже розмічено ✓", "ok");
      const parts = Math.ceil(list.length / PART);
      if (!confirm(`Фото без ознак: ${list.length}. Буде ${parts} архів(и) по ≤${PART} фото (≈${Math.round(list.length * 0.09)} МБ разом).\nНадішліть архіви в чат Claude для розмітки. Почати?`)) return;
      let fail = 0;
      for (let p = 0; p < parts; p++) {
        const files = [], man = [];
        for (const [i, {id, e}] of list.slice(p * PART, (p + 1) * PART).entries()) {
          say(`Архів ${p + 1}/${parts}: фото ${i + 1}/${Math.min(PART, list.length - p * PART)}…`);
          try {
            const r = await shrink(await API.refUrl(id, e.v, pw));
            const c = e.card && deck.get(e.card);
            files.push({name: `${id}.jpg`, data: r.data});
            man.push({img: id, file: `${id}.jpg`, w: r.w, h: r.h, entry: e.id, card: e.card || "", name: c ? c.name : e.name, cat: e.cat,
              signs: c && Cards.signOf(c) ? Cards.signOf(c).slice(0, 8) : plain(e.desc).split(/(?<=[.!?;])\s+/).filter((x) => x.length >= 8).slice(0, 8),
              weak: c && Cards.weakOf(c) ? Cards.weakOf(c) : []});
          } catch (er) { fail++; }
        }
        files.push({name: "manifest.json", data: new TextEncoder().encode(JSON.stringify({type: "poshuk-marks-export", part: p + 1, parts, at: new Date().toISOString(), photos: man}, null, 1))});
        save(zip(files), `rozmitka_${p + 1}_z_${parts}.zip`);
        await new Promise((r) => setTimeout(r, 800));   // браузер інакше блокує кілька завантажень поспіль
      }
      say(`Готово ✓ Архівів: ${parts}, фото: ${list.length - fail}${fail ? `, не відкрилось: ${fail}` : ""}. Надішліть їх Claude.`, "ok");
    },
  };
  window.MarkExport = MarkExport;
})();
