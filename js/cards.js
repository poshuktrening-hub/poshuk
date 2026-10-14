/* Режим «Картки цілей»: фото техніки → курсант вписує назву → перевірка (з допуском на одруківки й регістр)
   → повний опис на 10 с → наступна картка. Ігровий (з підказкою) та Іспит (без підказок). */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.esc(s);
  const LS = API.LS;
  const ROUND_SEC = 30, REVEAL_SEC = 10, ROUNDS = 10;
  const MODES = {
    game: {id: "game", name: "Ігровий", desc: "30 с на картку, є підказка — тип техніки (перше слово назви).", hint: true},
    exam: {id: "exam", name: "Іспит", desc: "30 с на картку, без підказок. Прохідний бал 80%.", hint: false, pass: 80},
  };

  /* ---------- нормалізація відповіді: регістр, латиниця-«двійники», і/и/ы, лапки, дефіси, пробіли */
  const LAT = {a: "а", b: "б", c: "с", d: "д", e: "е", f: "ф", g: "г", h: "н", i: "і", k: "к", l: "л", m: "м", n: "н", o: "о", p: "р",
    r: "р", s: "с", t: "т", u: "у", v: "в", x: "х", y: "у", z: "з", w: "в"};
  function norm(s) {
    let t = String(s || "").toLowerCase().normalize("NFC");
    t = t.replace(/[a-z]/g, (ch) => LAT[ch] || ch);
    t = t.replace(/[іїиы]/g, "и").replace(/[єэ]/g, "е").replace(/ё/g, "е").replace(/ґ/g, "г").replace(/й/g, "и");
    t = t.replace(/[ьъ'’ʼ`"«»()\[\].,:;!?\/\\_\-–—\s]/g, "");
    return t;
  }
  const digits = (s) => (String(s).match(/\d+/g) || []).join(",");
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length; if (!m || !n) return m || n;
    let prev = Array.from({length: n + 1}, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  /* Варіанти правильної відповіді для картки. */
  function answers(card) {
    const type = card.name.split(" ")[0];
    const base = card.name.replace(/\s*\(.*?\)\s*/g, " ").trim();
    const list = new Set([card.name, base, card.name.split(" ").slice(1).join(" "), ...card.aliases]);
    card.aliases.forEach((a) => list.add(type + " " + a));
    const q = card.name.match(/«([^»]+)»/); if (q) { list.add(q[1]); list.add(type + " " + q[1]); }   // власна назва в лапках — завжди зараховується
    return [...list].map(norm).filter(Boolean);
  }
  /* Перевірка: точний збіг або одруківка (1 символ для ≥5, 2 для ≥10), але цифри мають збігатися точно. */
  function check(card, input) {
    const a = norm(input);
    if (a.length < 2) return {ok: false};
    const vars = answers(card);
    if (vars.includes(a)) return {ok: true, exact: true};
    // точна назва ІНШОЇ техніки (Т-80БВ замість Т-80БВМ) — це не одруківка, а помилка
    if (!check.idx) { check.idx = new Map(); Cards.deck().forEach((c) => answers(c).forEach((v) => { if (!check.idx.has(v)) check.idx.set(v, c.id); })); }
    if (check.idx.has(a) && check.idx.get(a) !== card.id) return {ok: false};
    const tolOf = (n) => n >= 9 ? 2 : n >= 5 ? 1 : 0;
    for (const v of vars) {
      if (digits(v) !== digits(a)) continue;
      const tol = tolOf(v.length);
      if (tol && lev(a, v) <= tol) return {ok: true, exact: false};
    }
    // Мʼяка перевірка: досить впізнаваної назви всередині відповіді («ТОС Солнцепек», «Град БМ-21», «солнцепьок»).
    // Шукаємо найдовший збіг з назвами всієї техніки; зараховуємо, якщо він належить саме цій картці.
    const words = String(input).split(/[\s,;/\\()«»"'.]+/).filter(Boolean);
    const pieces = new Set();
    for (let i = 0; i < words.length; i++) for (let k = 1; k <= 3 && i + k <= words.length; k++) pieces.add(norm(words.slice(i, i + k).join("")));
    let best = null;
    const consider = (owner, len, exact) => { if (!best || len > best.len || (len === best.len && exact && !best.exact)) best = {owner, len, exact}; };
    for (const [v, owner] of check.idx) if (v.length >= 4 && a.includes(v)) consider(owner, v.length, true);
    for (const p of pieces) {
      if (p.length < 2) continue;
      if (check.idx.has(p)) { consider(check.idx.get(p), p.length, true); continue; }
      for (const v of vars) { const tol = tolOf(v.length); if (tol && digits(v) === digits(p) && lev(p, v) <= tol) consider(card.id, v.length, false); }
    }
    if (best && best.owner === card.id) return {ok: true, exact: false};
    return {ok: false};
  }

  const Cards = {
    MODES, check, norm,
    deck() { return (window.CARDS || []).map(([id, name, al, p1, p2]) => ({id, name, aliases: al.split("|").map((x) => x.trim()).filter(Boolean), p1, p2})); },
    withPhoto() { const ph = (window.Game && Game.cardPhotos) || new Map(); return this.deck().filter((c) => ph.has(c.id)); },

    renderMenu() {
      let mode = LS.get("poshuk_cmode", "game"); if (!MODES[mode]) mode = "game";
      this.mode = MODES[mode];
      $("pick-cmode").innerHTML = Object.values(MODES).map((m) =>
        `<button type="button" role="radio" aria-checked="${m.id === mode}" class="mode${m.id === mode ? " on" : ""}" data-cm="${m.id}"><b>${m.name}</b><span>${esc(m.desc)}</span></button>`).join("");
      $("pick-cmode").querySelectorAll("[data-cm]").forEach((b) => (b.onclick = () => { LS.set("poshuk_cmode", b.dataset.cm); SFX.click(); this.renderMenu(); }));
      const n = this.withPhoto().length, all = this.deck().length;
      $("c-info").innerHTML = n ? `Карток у грі: ${Math.min(ROUNDS, n)} (з ${n} з фото).` : `Фото карток ще не додано (${all} карток без фото). Адміністратору: <a href="#admin">адмінка → «Картки»</a>.`;
      $("c-start").disabled = !n;
      $("c-start").textContent = `Почати: ${this.mode.name.toLowerCase()}`;
      $("c-start").onclick = () => this.start();
    },

    start() {
      if (!Game.callsignOk()) return;
      SFX.unlock();
      const pool = Logic.shuffle(this.withPhoto());
      this.rounds = pool.slice(0, ROUNDS); this.idx = -1; this.results = [];
      UI.show("s-cards");
      document.body.dataset.mode = "cards";
      $("c-form").onsubmit = (e) => { e.preventDefault(); this.submit(); };
      $("c-hint-btn").onclick = () => this.hint();
      $("c-next").onclick = () => this.next();
      $("c-quit").onclick = () => { if (confirm("Перервати? Результат не буде збережено.")) { this.stop(); Game.showStart(); } };
      this.fitViewport();
      this.next();
    },
    stop() { clearInterval(this.tT); clearInterval(this.rT); },

    /* Телефон: коли відкрито клавіатуру — екран займає лише видиму частину, фото стискається. */
    fitViewport() {
      if (this._vv || !window.visualViewport) return;
      this._vv = () => document.documentElement.style.setProperty("--vvh", window.visualViewport.height + "px");
      visualViewport.addEventListener("resize", this._vv); this._vv();
    },

    async next() {
      this.stop();
      this.idx++;
      if (this.idx >= this.rounds.length) return this.summary();
      const c = this.cur = this.rounds[this.idx];
      this.hintUsed = false; this.over = false;
      $("c-stage").textContent = `${this.mode.id === "exam" ? "Іспит · " : ""}Картка ${this.idx + 1}/${this.rounds.length}`;
      $("c-score").textContent = this.results.reduce((a, r) => a + r.score, 0);
      $("c-reveal").hidden = true; $("c-nextbox").hidden = true; $("c-form").hidden = false;
      $("c-hint").hidden = true; $("c-hint-btn").hidden = !this.mode.hint; $("c-hint-btn").disabled = false;
      $("c-answer").value = ""; $("c-answer").disabled = false; $("c-check").disabled = false;
      const img = $("c-img"); img.removeAttribute("src"); $("c-loading").hidden = false;
      const url = await API.cardUrl(c.id, Game.cardPhotos.get(c.id), Game.password).catch(() => null);
      await new Promise((res) => { img.onload = img.onerror = res; img.src = url || ""; });
      $("c-loading").hidden = true;
      if (this.cur !== c) return;
      // наступне фото — заздалегідь
      const nx = this.rounds[this.idx + 1];
      if (nx) API.cardUrl(nx.id, Game.cardPhotos.get(nx.id), Game.password).then((u) => { const p = new Image(); p.src = u; }).catch(() => {});
      this.t0 = performance.now();
      this.tick(); this.tT = setInterval(() => this.tick(), 200);
      if (!matchMedia("(pointer: coarse)").matches) $("c-answer").focus();
    },

    tick() {
      const left = Math.max(0, ROUND_SEC - (performance.now() - this.t0) / 1000);
      $("c-time").textContent = `0:${String(Math.ceil(left)).padStart(2, "0")}`;
      $("c-time").classList.toggle("warn", left <= 10);
      $("c-timebar").style.transform = `scaleX(${left / ROUND_SEC})`;
      document.querySelector("#s-cards .timebar").classList.toggle("warn", left <= 10);
      if (left <= 0) this.finish("", true);
    },

    hint() {
      if (!this.mode.hint || this.hintUsed || this.over) return;
      this.hintUsed = true;
      $("c-hint").innerHTML = `Тип: <b>${esc(this.cur.name.split(" ")[0])}</b> …`;
      $("c-hint").hidden = false; $("c-hint-btn").disabled = true;
      SFX.click();
    },

    submit() {
      const v = $("c-answer").value.trim();
      if (!v) { $("c-answer").focus(); return; }
      this.finish(v, false);
    },

    finish(answer, timeout) {
      if (this.over) return;
      this.over = true; this.stop();
      const c = this.cur, r = timeout ? {ok: false} : check(c, answer), score = r.ok ? 10 : 0;
      this.results.push({id: c.id, name: c.name, answer, ok: r.ok, score, hint: this.hintUsed});
      $("c-score").textContent = this.results.reduce((a, x) => a + x.score, 0);
      if (r.ok) SFX.hit(); else SFX.miss();
      document.activeElement && document.activeElement.blur && document.activeElement.blur();   // сховати клавіатуру
      $("c-form").hidden = true;
      const verdict = r.ok ? `<p class="c-v ok">✓ Вірно${r.exact ? "" : " (з одруківкою)"} · +10</p>`
        : `<p class="c-v no">${timeout ? "⏱ Час вийшов" : `✗ Невірно: «${esc(answer)}»`} · 0</p>`;
      const cr = Game.cardCredits && Game.cardCredits.get(c.id);
      $("c-reveal").innerHTML = `${verdict}<h3>${esc(c.name)}</h3><p>${esc(c.p1)}</p><p>${esc(c.p2)}</p>${cr ? `<p class="credit">Фото: ${esc(cr)}</p>` : ""}`;
      $("c-reveal").hidden = false; $("c-reveal").scrollTop = 0;
      const last = this.idx === this.rounds.length - 1;
      $("c-next").textContent = last ? "Підсумок →" : "Далі →";
      $("c-nextbox").hidden = false;
      const bar = $("c-cd"); bar.style.transition = "none"; bar.style.transform = "scaleX(1)";
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = `transform ${REVEAL_SEC}s linear`; bar.style.transform = "scaleX(0)"; }));
      const t0 = performance.now();
      this.rT = setInterval(() => { if (performance.now() - t0 >= REVEAL_SEC * 1000) this.next(); }, 250);
    },

    summary() {
      this.stop();
      UI.show("s-summary");
      const res = this.results, max = 10 * res.length, total = res.reduce((a, r) => a + r.score, 0);
      const pct = max ? Math.round(100 * total / max) : 0, m = this.mode;
      const concl = m.pass ? (pct >= m.pass ? "Склав" : "Не склав") : Logic.conclusion(total, max);
      $("sum-title").textContent = `Картки цілей${m.id === "exam" ? " · Іспит" : ""} · ${Game.callsign}`;
      $("sum-total").textContent = `${total} з ${max} балів · ${pct}% · ${concl}`;
      $("sum-total").style.color = m.pass ? (pct >= m.pass ? "var(--hit)" : "var(--miss)") : pct >= 60 ? "var(--hit)" : pct >= 40 ? "var(--accent)" : "var(--miss)";
      const rk = Logic.rank(pct);
      $("sum-rank").innerHTML = `${Logic.rankBadge(rk.level)}<div><div class="rk-label">Звання</div><div class="rk-name">${esc(rk.name)}</div><div class="rk-next">${rk.next ? `До «${esc(rk.next.name)}» — від ${rk.next.min}%` : "Найвище звання"}</div></div>`;
      $("sum-table").innerHTML = `<tr><th class="num">№</th><th>Техніка</th><th>Ваша відповідь</th><th class="num">Бали</th></tr>` +
        res.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.name)}</td><td class="${r.ok ? "t-ok" : "t-no"}">${esc(r.answer || "—")}${r.hint ? " 💡" : ""}</td><td class="num">${r.score}</td></tr>`).join("");
      const now = new Date(), p2 = (x) => String(x).padStart(2, "0");
      const item = {callsign: Game.callsign, scores: res.map((r) => r.score), max, mode: m.id === "exam" ? "cards_exam" : "cards",
        conclusion: `Картки${m.id === "exam" ? " (іспит)" : ""}: ${concl}`,
        date: `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`, clicks: []};
      const q = LS.get("poshuk_pending", []); q.push(item); LS.set("poshuk_pending", q);
      $("sum-sync").className = "muted"; $("sum-sync").textContent = "Записую результат…";
      Game.flushPending().then((left) => {
        $("sum-sync").textContent = left ? "Немає зв'язку: результат збережено в браузері й надішлеться при наступному вході." : "Результат записано.";
        $("sum-sync").style.color = left ? "var(--miss)" : "var(--hit)";
      });
    },
  };
  window.Cards = Cards;
})();
