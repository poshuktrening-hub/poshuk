/* Адмінка → «Аналітика»: слабкі місця групи й кожного курсанта за категоріями техніки
   (картки цілей і цілі на знімках), найскладніша техніка, зведення по курсантах. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.esc(s);
  const kindOf = (mode, concl) => (/^cards/.test(mode || "") || /^Картки/.test(concl || "") ? "cards" : "search");
  const MODE_NAME = {game: "Ігровий", exam: "Іспит", hard: "Хардкор", cards: "Ігровий", cards_exam: "Іспит"};
  const when = (ts) => { const m = String(ts || "").match(/^\d{4}-(\d\d)-(\d\d)[ T](\d\d:\d\d)/); return m ? `${m[2]}.${m[1]} ${m[3]}` : String(ts || ""); };
  const pctOf = (ok, n) => (n ? Math.round(100 * ok / n) : 0);
  const tone = (p) => (p < 50 ? "bad" : p < 75 ? "mid" : "good");
  const MIN_ITEM = 2, MIN_CAT_CADET = 3;

  const Analytics = {
    period: "30", kind: "", who: "",

    async open(admin) {
      this.pw = admin.pw;
      let box = $("an"); if (!box) { box = document.createElement("div"); box.id = "an"; box.className = "modal"; document.body.appendChild(box); }
      box.hidden = false;
      box.onclick = (e) => { if (e.target === box) box.hidden = true; };
      await this.load();
    },

    since() {
      if (!this.period) return "0000";
      const d = this.period === "today" ? new Date() : new Date(Date.now() - Number(this.period) * 864e5), p2 = (x) => String(x).padStart(2, "0");
      return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} 00:00`;
    },

    async load() {
      $("an").innerHTML = `<div class="m-card"><p class="status">Рахую…</p></div>`;
      try { this.data = await API.call("analytics", {since: this.since()}, this.pw); }
      catch (e) { $("an").innerHTML = `<div class="m-card"><div class="m-head"><h2>Аналітика</h2><button type="button" class="link" id="an-x">Закрити</button></div><p class="status no">${esc(e.message)}</p></div>`; $("an-x").onclick = () => ($("an").hidden = true); return; }
      this.render();
    },

    render() {
      const d = this.data, k = this.kind, who = this.who;
      d.answers.forEach((a) => { a.cat = Logic.category(a.name); });
      // «Svinina» і «svinina » — той самий курсант
      if (!d._cs) { const disp = new Map(), key = (c) => String(c || "").trim().toLowerCase();
        [...d.results, ...d.answers, ...(d.list || [])].forEach((x) => { const k0 = key(x.callsign); if (!disp.has(k0)) disp.set(k0, String(x.callsign || "").trim()); x.callsign = disp.get(k0); }); d._cs = true; }   // категорію рахуємо за назвою — перейменування не дублюють рядки
      const ans = d.answers.filter((a) => (!k || a.kind === k) && (!who || a.callsign === who));
      const res = d.results.filter((r) => (!k || kindOf(r.mode) === k) && (!who || r.callsign === who));
      const people = [...new Set([...d.results.map((r) => r.callsign), ...d.answers.map((a) => a.callsign)])].filter(Boolean).sort((a, b) => a.localeCompare(b, "uk"));
      if (who && !people.includes(who)) people.push(who);

      // проходження — кожен тест з датою й часом
      const runs = (d.list || []).filter((r) => (!k || kindOf(r.mode, r.conclusion) === k) && (!who || r.callsign === who));
      const shown = runs.slice(0, 150);
      // по категоріях
      const cats = new Map();
      for (const a of ans) { const c = cats.get(a.cat) || {ok: 0, n: 0}; c.ok += a.ok; c.n += a.n; cats.set(a.cat, c); }
      const catRows = [...cats].map(([cat, c]) => ({cat, ...c, p: pctOf(c.ok, c.n)})).sort((a, b) => a.p - b.p || b.n - a.n);
      // по техніці
      const items = new Map();
      for (const a of ans) { const key = a.kind + "|" + a.name; const c = items.get(key) || {name: a.name, kind: a.kind, ok: 0, n: 0}; c.ok += a.ok; c.n += a.n; items.set(key, c); }
      const hard = [...items.values()].filter((x) => x.n >= MIN_ITEM).map((x) => ({...x, p: pctOf(x.ok, x.n)})).filter((x) => x.p < 100).sort((a, b) => a.p - b.p || b.n - a.n).slice(0, 12);
      // підсумок
      const tests = res.reduce((s, r) => s + r.n, 0), avg = tests ? Math.round(res.reduce((s, r) => s + r.avg * r.n, 0) / tests) : 0;
      const nAns = ans.reduce((s, a) => s + a.n, 0), okAns = ans.reduce((s, a) => s + a.ok, 0);
      // по курсантах
      const cadets = people.filter((p) => !who || p === who).map((p) => {
        const rr = d.results.filter((r) => r.callsign === p && (!k || kindOf(r.mode) === k));
        const aa = d.answers.filter((a) => a.callsign === p && (!k || a.kind === k));
        const n = rr.reduce((s, r) => s + r.n, 0), av = n ? Math.round(rr.reduce((s, r) => s + r.avg * r.n, 0) / n) : null;
        const cm = new Map(); for (const a of aa) { const c = cm.get(a.cat) || {ok: 0, n: 0}; c.ok += a.ok; c.n += a.n; cm.set(a.cat, c); }
        const weak = [...cm].filter(([, c]) => c.n >= MIN_CAT_CADET).map(([cat, c]) => ({cat, p: pctOf(c.ok, c.n)})).sort((a, b) => a.p - b.p)[0];
        const last = rr.map((r) => r.last).sort().pop() || "";
        return {p, n, av, ans: aa.reduce((s, a) => s + a.n, 0), weak, last};
      }).filter((c) => c.n || c.ans).sort((a, b) => (a.av ?? 101) - (b.av ?? 101));

      const sel = (id, opts, val) => `<select id="${id}">${opts.map(([v, t]) => `<option value="${esc(v)}"${v === val ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
      const bar = (p) => `<i class="an-bar ${tone(p)}"><b style="width:${Math.max(2, p)}%"></b></i>`;
      $("an").innerHTML = `<div class="m-card an-card">
        <div class="m-head"><h2>Аналітика${who ? ` · ${esc(who)}` : ""}</h2><button type="button" class="link" id="an-x">Закрити</button></div>
        <div class="row an-filters">
          ${sel("an-period", [["today", "Сьогодні"], ["7", "7 днів"], ["30", "30 днів"], ["90", "90 днів"], ["", "Увесь час"]], this.period)}
          ${sel("an-kind", [["", "Усі тести"], ["search", "Пошук"], ["cards", "Картки"]], this.kind)}
          ${sel("an-who", [["", "Уся група"], ...people.map((p) => [p, p])], who)}
        </div>
        <div class="an-kpi">
          <div><b>${tests}</b><span>тестів</span></div>
          <div><b class="${tests ? tone(avg) : ""}">${tests ? avg + "%" : "—"}</b><span>середній результат</span></div>
          <div><b>${nAns}</b><span>відповідей по техніці</span></div>
          <div><b class="${nAns ? tone(pctOf(okAns, nAns)) : ""}">${nAns ? pctOf(okAns, nAns) + "%" : "—"}</b><span>правильних</span></div>
        </div>

        <h3>Слабкі місця${who ? "" : " групи"} — за категоріями</h3>
        ${catRows.length ? `<ul class="an-cats">${catRows.map((c) => `<li><span class="nm">${esc(c.cat)}</span>${bar(c.p)}<b class="${tone(c.p)}">${c.p}%</b><small>${c.ok} з ${c.n}</small></li>`).join("")}</ul>`
          : `<p class="muted small">Ще немає відповідей за цей період.</p>`}

        ${hard.length ? `<h3>Найчастіше помиляються</h3><ul class="an-items">${hard.map((x) => `<li><span class="nm">${esc(Logic.dispName(x.name))}<small>${x.kind === "cards" ? "картка" : "на знімку"}</small></span><b class="${tone(x.p)}">${x.p}%</b><small>${x.ok} з ${x.n}</small></li>`).join("")}</ul>` : ""}

        <h3>Курсанти</h3>
        ${cadets.length ? `<div class="an-scroll"><table class="an-table"><tr><th>Прізвище</th><th class="num">Тестів</th><th class="num">Середній</th><th>Найслабше</th><th class="num">Останній</th></tr>
          ${cadets.map((c) => `<tr data-who="${esc(c.p)}"><td><a href="#" data-who="${esc(c.p)}">${esc(c.p)}</a></td><td class="num">${c.n}</td><td class="num ${c.av == null ? "" : tone(c.av)}">${c.av == null ? "—" : c.av + "%"}</td><td>${c.weak ? `${esc(c.weak.cat)} <small>${c.weak.p}%</small>` : "<small class=muted>мало даних</small>"}</td><td class="num"><small>${esc(when(c.last))}</small></td></tr>`).join("")}</table></div>`
          : `<p class="muted small">Немає результатів за цей період.</p>`}
        <h3>Проходження${runs.length ? ` <small>${runs.length}${runs.length > shown.length ? `, показано ${shown.length}` : ""}</small>` : ""}</h3>
        ${shown.length ? `<div class="an-scroll"><table class="an-table an-runs"><tr><th>Дата, час</th><th>Прізвище</th><th>Тест</th><th class="num">Результат</th><th>Висновок</th></tr>
          ${shown.map((r) => `<tr><td class="nowrap">${esc(when(r.ts))}</td><td><a href="#" data-who="${esc(r.callsign)}">${esc(r.callsign)}</a></td><td>${kindOf(r.mode, r.conclusion) === "cards" ? "Картки" : "Пошук"}<small> · ${esc(MODE_NAME[r.mode] || "—")}</small></td><td class="num nowrap"><b class="${tone(r.pct)}">${r.pct}%</b> <small>${r.total}/${r.max}</small></td><td><small>${esc(String(r.conclusion || "").replace(/^(Картки( \(іспит\))?|Іспит|Хардкор): /, ""))}</small></td></tr>`).join("")}</table></div>`
          : `<p class="muted small">Ніхто не проходив тести за цей період.</p>`}
        <p class="muted small">Категорії рахуються з ${d.since ? esc(d.since.slice(0, 10).split("-").reverse().join(".")) : "наступного тесту"}: відтоді зберігається кожна відповідь (картка або ціль на знімку). Середній результат — за всіма тестами періоду.</p>
      </div>`;
      $("an-x").onclick = () => ($("an").hidden = true);
      $("an-period").onchange = (e) => { this.period = e.target.value; this.load(); };
      $("an-kind").onchange = (e) => { this.kind = e.target.value; this.render(); };
      $("an-who").onchange = (e) => { this.who = e.target.value; this.render(); };
      $("an").querySelectorAll("a[data-who]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); this.who = a.dataset.who; this.render(); $("an").scrollTop = 0; }));
    },
  };
  window.Analytics = Analytics;
})();
