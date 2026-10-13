/* Гра курсанта: вхід, етапи, доповідь, розбір, підсумок, черга відправки результатів. */
(function () {
  const $ = (id) => document.getElementById(id);
  const {LS, SS} = API;
  const HINT_SCORE = 5, BRIEF_MS = 5000;
  const OUTRO_DELAY = 450, OUTRO_MS = 1100;
  const COLORS = {hit: "#5fd38a", miss: "#e8664f", accent: "#c9d64a"};

  const BG_SCREENS = ["s-login", "s-start", "s-summary"];
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
    const bg = $("bgvid"), on = BG_SCREENS.includes(id);
    if (!bg) return;
    bg.hidden = !on;
    document.body.classList.toggle("with-bg", on);
    const v = bg.querySelector("video");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches || (navigator.connection && navigator.connection.saveData);
    if (on && !still) v.play().catch(() => {}); else v.pause();
  }
  function toast(text, ms = 3500) {
    const t = $("toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
  }
  const fmt = (sec) => { const s = Math.ceil(sec); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  const Game = {
    password: null, cfg: null, stages: [], viewer: null,

    // ---------- вхід
    async boot() {
      this.password = LS.get("poshuk_pw", null);
      $("login-form").onsubmit = (e) => { e.preventDefault(); this.login($("login-pass").value); };
      $("start-form").onsubmit = (e) => { e.preventDefault(); this.start(); };
      $("logout-btn").onclick = () => { LS.del("poshuk_pw"); this.password = null; this.showLogin(); };
      $("g-skip").onclick = () => this.skip();
      $("g-hint").onclick = () => this.hint();
      $("g-next").onclick = () => this.nextRound();
      $("g-quit").onclick = () => { if (confirm("Перервати гру? Результат не буде збережено.")) this.showStart(); };
      $("sum-again").onclick = () => this.showStart();
      document.addEventListener("keydown", (e) => {
        if ($("s-game").hidden || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
        if (e.key === "+" || e.key === "=") this.viewer.zoomCenter(1.6);
        else if (e.key === "-") this.viewer.zoomCenter(1 / 1.6);
        else if (e.key === "0") this.viewer.fit(true);
        else if (e.key === "Enter" && !$("g-next").hidden) this.nextRound();
      });
      if (!this.password) return this.showLogin();
      try { await this.loadConfig(); this.showStart(); } catch (e) { this.showLogin(e.auth ? "" : e.message); }
    },

    showLogin(err = "") {
      show("s-login");
      $("login-err").textContent = err;
      $("login-pass").value = "";
      $("login-pass").focus();
    },

    async login(pw) {
      $("login-btn").disabled = true;
      $("login-err").textContent = "";
      try {
        this.password = pw;
        await this.loadConfig();
        LS.set("poshuk_pw", pw);
        this.showStart();
      } catch (e) {
        this.password = null;
        $("login-err").textContent = e.message;
      } finally { $("login-btn").disabled = false; }
    },

    async loadConfig() {
      const j = await API.call("config", {}, this.password);
      this.cfg = j.settings;
      this.stages = j.stages;
      this.objects = j.objects || [];
      this.typePool = [...new Set([...this.stages.flatMap((s) => s.targets.map((t) => t.type)), ...Logic.TYPES].filter(Boolean))];
    },

    showStart() {
      show("s-start");
      const n = Math.min(this.cfg.rounds_per_game, this.stages.length);
      $("start-info").textContent = n ? `${n} етап(ів) по ${this.cfg.time_limit_sec} с. Знайдіть усю техніку на кожному знімку.`
        : "Поки немає жодного етапу. Адміністратору: відкрийте адмінку й імпортуйте знімки.";
      $("start-info").insertAdjacentHTML("beforeend", n ? "" : ' <a href="#admin">Відкрити адмінку →</a>');
      $("start-btn").disabled = !n;
      $("callsign").value = LS.get("poshuk_callsign", "");
      $("start-err").textContent = "";
      this.refreshPending();
      this.flushPending();
      $("callsign").focus();
    },

    // ---------- гра
    start() {
      const cs = $("callsign").value.trim();
      if (!cs) { $("start-err").textContent = "Введіть позивний"; return; }
      LS.set("poshuk_callsign", cs);
      this.callsign = cs;
      this.rounds = Logic.pickRounds(this.stages, this.cfg.rounds_per_game);
      this.results = [];
      this.idx = -1;
      show("s-game");
      if (!this.viewer) {
        this.viewer = new Viewer($("g-view"), {onLeft: (x, y) => this.leftClick(x, y), onRight: (x, y) => this.rightClick(x, y)});
        const g = this.viewer.addButton("#", "Сітка квадратів", () => { this.viewer.toggleGrid(); g.classList.toggle("on", this.viewer.showGrid); });
        this.gridBtn = g;
      }
      this.viewer.toggleGrid(true);
      this.gridBtn.classList.add("on");
      this.rounds.forEach((_, i) => this.preload(i));
      this.nextRound();
    },

    preload(i) {
      const st = this.rounds[i];
      if (st) API.loadImage(st.id, this.password).catch(() => {});
    },

    async nextRound() {
      this.idx++;
      if (this.idx >= this.rounds.length) return this.summary();
      clearTimeout(this.outroT);
      const st = this.cur = this.rounds[this.idx];
      this.targets = st.targets;
      this.found = new Set(); this.foundOrder = []; this.misses = 0; this.marks = []; this.clicks = []; this.reports = {};
      this.over = true;
      $("g-next").hidden = true; $("g-skip").hidden = false; $("g-hint").hidden = false; $("g-hint").disabled = false;
      this.hintUsed = false;
      $("g-debrief").hidden = true;
      $("g-stage").textContent = `Етап ${this.idx + 1}/${this.rounds.length} · ${st.title}`;
      this.msg("Завантажую знімок…");
      $("g-loading").hidden = false;
      let img;
      try { img = await API.loadImage(st.id, this.password); } catch (e) {
        $("g-loading").hidden = true;
        this.msg("Не вдалось завантажити знімок: " + e.message + " Етап пропущено.", "no");
        this.results.push({title: st.title, id: st.id, found: 0, total: st.targets.length, misses: 0, time: 0, score: 0, clicks: [], report: ""});
        $("g-skip").hidden = true; $("g-next").hidden = false;
        return;
      }
      $("g-loading").hidden = true;
      this.preload(this.idx + 1);
      this.viewer.setImage(img);
      this.viewer.setGrid(this.cfg.grid_cols);
      this.msg("Брифінг: запам'ятайте, що шукаєте.");
      await this.brief(st);
      if (this.cur !== st) return;
      this.over = false;
      this.msg("Лівий клік — наблизити. Ще один лівий клік — позначити ціль. Правий клік — віддалити. «#» — сітка.");
      this.t0 = performance.now();
      this.stats();
      this.tick();
    },

    /* Брифінг перед етапом: 5 с чорний екран з технікою, яку шукатимуть, та її ТТХ. */
    async brief(st) {
      const norm = (s) => String(s || "").toLowerCase().trim();
      const seen = new Set(), items = [];
      for (const t of st.targets) {
        const key = t.obj || norm(t.type);
        if (seen.has(key)) continue;
        seen.add(key);
        const o = this.objects.find((x) => x.id === t.obj) || this.objects.find((x) => norm(x.type) === norm(t.type)) || null;
        items.push({t, o, builtin: !o && (t.obj === "builtin:catapult" || /катапульт/.test(norm(t.type)))});
      }
      const box = $("g-brief");
      const cards = await Promise.all(items.map(async ({t, o, builtin}) => {
        let pic = "";
        if (o) { const u = await API.objUrl(o.id, this.password).catch(() => null); if (u) pic = `<img src="${u}" alt="">`; }
        else if (builtin) pic = `<img src="${Compose.catapultSprite().toDataURL()}" alt="">`;
        const ttx = Logic.ttxFor(o, t.type);
        const len = o && o.length_m ? `<p class="len">Довжина ≈ ${o.length_m} м</p>` : "";
        const name = o && o.name ? o.name : builtin ? "Катапульта з БпЛА «Ланцет»" : (t.type || "ціль");
        const sub = o && o.name && t.type && norm(o.name) !== norm(t.type) ? `<p class="len">${esc(t.type)}</p>` : "";
        return `<div class="b-card">${pic ? `<div class="b-pic">${pic}</div>` : ""}<div class="b-txt"><h3>${esc(name)}</h3>${sub}${len}${ttx ? `<p>${esc(ttx).replace(/\n/g, "<br>")}</p>` : ""}</div></div>`;
      }));
      const n = st.targets.length;
      box.innerHTML = `<div class="b-inner"><div class="b-head">ЕТАП ${this.idx + 1} · ЗНАЙТИ ${n > 1 ? n + " ЦІЛІ" : "ЦІЛЬ"}</div>${cards.join("")}
        <div class="b-foot"><div class="b-bar"><i></i></div><button type="button" class="primary" id="b-go">Почати зараз</button></div></div>`;
      box.hidden = false;
      const bar = box.querySelector(".b-bar i");
      requestAnimationFrame(() => { bar.style.transition = `transform ${BRIEF_MS}ms linear`; bar.style.transform = "scaleX(0)"; });
      await new Promise((res) => { const t = setTimeout(res, BRIEF_MS); box.querySelector("#b-go").onclick = () => { clearTimeout(t); res(); }; });
      box.hidden = true;
    },

    left() { return Math.max(0, this.cfg.time_limit_sec - (performance.now() - this.t0) / 1000); },

    tick() {
      if (this.over) return;
      const l = this.left(), warn = l <= 10;
      $("g-time").textContent = fmt(l);
      $("g-time").classList.toggle("warn", warn);
      document.querySelector(".timebar").classList.toggle("warn", warn);
      $("g-timebar").style.transform = `scaleX(${l / this.cfg.time_limit_sec})`;
      if (l <= 0) return this.endRound("Час вийшов!");
      this.tickT = setTimeout(() => this.tick(), 200);
    },

    stats() {
      $("g-score").textContent = this.results.reduce((a, r) => a + r.score, 0);
      $("g-miss").textContent = `${this.misses}/${this.cfg.misses_allowed}`;
      $("g-found").textContent = `${this.found.size}/${this.targets.length}`;
    },

    msg(text, cls = "") { const m = $("g-msg"); m.textContent = text; m.className = "msg " + cls; },

    leftClick(cx, cy) {
      if (this.over) return;
      const v = this.viewer;
      if (v.zoomRel() < 2.5) {
        v.zoomAt(this.cfg.zoom_click / v.zoomRel(), cx, cy);
        this.msg("Лівий клік — позначити ціль. Правий клік — віддалити.");
        return;
      }
      const [x, y] = v.toImage(cx, cy);
      if (!v.inside(x, y)) return;
      const hit = Logic.hitTest(this.targets, this.found, x, y);
      this.clicks.push([this.cur.id, Math.round(x), Math.round(y), hit !== null]);
      if (hit === null) {
        this.misses++;
        this.marks.push({x, y, cross: true, color: COLORS.miss});
        v.setMarks(this.marks);
        const leftM = this.cfg.misses_allowed - this.misses;
        if (leftM < 0) return this.endRound("Другий промах — етап завершено.");
        this.msg(`Мимо! ${leftM === 0 ? "Наступний промах завершить етап." : "Можна ще промахнутись: " + leftM + "."} Правий клік — віддалити й шукати далі.`, "no");
      } else {
        this.found.add(hit); this.foundOrder.push(hit);
        const t = this.targets[hit];
        this.marks.push({x: t.x, y: t.y, r: t.r || 14, color: COLORS.hit});
        v.setMarks(this.marks);
        if (this.found.size === this.targets.length) return this.endRound("Усі цілі знайдено!");
        this.msg(`Є! Лишилось цілей: ${this.targets.length - this.found.size}.`, "ok");
      }
      this.stats();
    },

    rightClick(cx, cy) {
      const v = this.viewer;
      if (v.zoomRel() <= this.cfg.zoom_click * 1.05) v.fit(true); else v.zoomAt(1 / 2.5, cx, cy);
      if (!this.over) this.msg("Лівий клік — наблизити в це місце.");
    },

    skip() { if (!this.over) this.endRound("Етап пропущено."); },

    /* Підказка: блок 2×2 квадрати, всередині якого ціль (ціль не обов'язково в центрі блоку). */
    hint() {
      if (this.over || this.hintUsed) return;
      const v = this.viewer, c = v.gridCell, img = v.img;
      const i = this.targets.findIndex((_, k) => !this.found.has(k));
      if (i < 0 || !c || !img) return;
      const t = this.targets[i];
      const cols = Math.ceil(img.width / c), rows = Math.ceil(img.height / c);
      const col = Math.floor(t.x / c), row = Math.floor(t.y / c);
      const c0 = Math.max(0, Math.min(cols - 2, col - (Math.random() < 0.5 ? 0 : 1)));
      const r0 = Math.max(0, Math.min(rows - 2, row - (Math.random() < 0.5 ? 0 : 1)));
      const x = c0 * c, y = r0 * c, w = Math.min(2 * c, img.width - x), h = Math.min(2 * c, img.height - y);
      this.hintUsed = true;
      $("g-hint").disabled = true;
      this.marks.push({rect: [x, y, w, h], color: COLORS.accent});
      v.setMarks(this.marks);
      v.toggleGrid(true); this.gridBtn.classList.add("on");
      const rel = Math.min(v.W / w, v.H / h) * 0.85 / v.minS;
      v.zoomTo(Math.max(1, rel), x + w / 2, y + h / 2);
      const names = [squareName(x + 1, y + 1, c), squareName(x + w - 1, y + 1, c), squareName(x + 1, y + h - 1, c), squareName(x + w - 1, y + h - 1, c)];
      this.msg(`Підказка: ціль у квадратах ${[...new Set(names)].join(", ")}. За етап буде ${HINT_SCORE} балів замість 10.`);
    },

    endRound(reason) {
      if (this.over) return;
      this.over = true;
      clearTimeout(this.tickT);
      this.used = this.cfg.time_limit_sec - this.left();
      this.reason = reason;
      let score = Logic.roundScore(this.targets.length, this.found.size);
      if (this.hintUsed && score) score = HINT_SCORE;
      $("g-hint").hidden = true;
      this.result = {title: this.cur.title, id: this.cur.id, found: this.found.size, total: this.targets.length,
        misses: this.misses, time: Math.round(this.used * 10) / 10, score, clicks: this.clicks.slice(), report: ""};
      this.results.push(this.result);
      this.stats();
      $("g-skip").hidden = true;
      this.outroT = setTimeout(() => this.viewer.fit(true, OUTRO_MS), OUTRO_DELAY);
      if (false) { // доповідь вимкнено
        this.queue = this.foundOrder.slice();
        this.msg(`${reason} +${score} балів. Доповідь: що це за техніка?`, "ok");
        this.askReport();
      } else this.debrief();
    },

    sq(t) { return this.viewer.gridCell ? squareName(t.x, t.y, this.viewer.gridCell) : ""; },

    askReport() {
      const i = this.queue[0];
      const n = this.foundOrder.length - this.queue.length + 1;
      $("r-title").textContent = `Доповідь ${n}/${this.foundOrder.length}:`;
      const t = this.targets[i], sq = this.sq(t);
      this.choice = {};
      const fill = (id, opts) => {
        $(id).innerHTML = opts.map((o) => `<button type="button" data-v="${esc(o)}">${esc(o)}</button>`).join("");
        $(id).querySelectorAll("button").forEach((b) => (b.onclick = () => {
          $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
          this.choice[id] = b.dataset.v;
          $("r-send").disabled = !this.reportReady();
        }));
      };
      fill("r-type", Logic.options(t.type || "ціль", this.typePool));
      $("r-lm-row").hidden = !t.landmark;
      if (t.landmark) fill("r-landmark", Logic.options(t.landmark, Logic.LANDMARKS.filter((l) => l !== "інше")));
      $("r-send").disabled = true;
      $("g-report").hidden = false;
      const marks = this.marks.filter((m) => m.cross);
      this.foundOrder.forEach((j) => {
        const t = this.targets[j], cur = j === i;
        marks.push({x: t.x, y: t.y, r: (t.r || 14) + (cur ? 4 : 0), color: cur ? COLORS.accent : COLORS.hit, dashed: cur, label: cur ? "доповідь" : ""});
      });
      this.viewer.setMarks(marks);
    },

    reportReady() {
      const t = this.targets[this.queue[0]];
      return this.choice["r-type"] && (!t.landmark || this.choice["r-landmark"]);
    },

    /* Сусідні квадрати навколо цілі — правдоподібні неправильні варіанти. */
    neighbors(t) {
      const c = this.viewer.gridCell, img = this.viewer.img;
      if (!c || !img) return [];
      const col = Math.floor(t.x / c), row = Math.floor(t.y / c), cols = Math.ceil(img.width / c), rows = Math.ceil(img.height / c), out = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = col + dx, y = row + dy;
        if ((dx || dy) && x >= 0 && y >= 0 && x < cols && y < rows) out.push(squareName((x + 0.5) * c, (y + 0.5) * c, c));
      }
      return out;
    },

    submitReport() {
      if (!this.reportReady()) return;
      const i = this.queue.shift();
      const t = this.targets[i];
      const rep = {type: this.choice["r-type"], landmark: this.choice["r-landmark"] || ""};
      this.reports[i] = {rep, ev: Logic.evalReport(t, this.sq(t), rep)};
      if (this.queue.length) return this.askReport();
      $("g-report").hidden = true;
      const vals = Object.values(this.reports);
      this.result.report = `${vals.reduce((a, r) => a + r.ev.ok, 0)}/${vals.reduce((a, r) => a + r.ev.total, 0)}`;
      this.debrief();
    },

    debrief() {
      const missed = this.targets.map((_, i) => i).filter((i) => !this.found.has(i));
      const marks = [];
      let n = 0;
      this.clicks.forEach((c) => { if (!c[3]) marks.push({x: c[1], y: c[2], cross: true, color: COLORS.miss, label: String(++n)}); });
      this.targets.forEach((t, i) => {
        const ok = this.found.has(i);
        marks.push({x: t.x, y: t.y, r: (t.r || 14) + (ok ? 0 : 6), color: ok ? COLORS.hit : COLORS.accent, dashed: !ok, label: t.type || ""});
      });
      this.viewer.setMarks(marks);

      const h = [`<h2>РОЗБІР ЕТАПУ</h2>`];
      this.targets.forEach((t, i) => {
        const ok = this.found.has(i), sq = this.sq(t);
        const where = [sq && "квадрат " + sq, t.landmark].filter(Boolean).join(", ");
        h.push(`<p class="${ok ? "t-ok" : "t-no"}">${i + 1}. ${esc(t.type || "ціль")} — ${esc(where)} (${ok ? "знайдено" : "не знайдено"})</p>`);
        if (t.signs && t.signs.length) h.push(`<p class="sub">Ознаки: ${esc(t.signs.join(", "))}</p>`);
        if (t.note) h.push(`<p class="sub muted">${esc(t.note)}</p>`);
        const r = this.reports[i];
        if (r) {
          const said = [r.rep.type, r.rep.square && "квадрат " + r.rep.square, r.rep.landmark].filter(Boolean).join(", ");
          h.push(`<p class="sub">Доповідь: «${esc(said || "—")}»</p>`);
          const parts = r.ev.checks.map(([name, good, right]) => good ? `${name} ✓` : `${name} ✗ (правильно: ${esc(right)})`);
          h.push(`<p class="sub ${r.ev.ok === r.ev.total ? "t-ok" : "t-no"}">${parts.join(" · ")}</p>`);
        }
      });
      n = 0;
      this.clicks.forEach((c) => {
        if (c[3]) return;
        n++;
        const near = this.targets.reduce((a, t) => (Math.hypot(t.x - c[1], t.y - c[2]) < Math.hypot(a.x - c[1], a.y - c[2]) ? t : a));
        const d = Math.round(Math.hypot(near.x - c[1], near.y - c[2]));
        const sq = this.viewer.gridCell ? squareName(c[1], c[2], this.viewer.gridCell) : "";
        h.push(`<p class="t-no">✗ Промах ${n}: квадрат ${sq}, ${d} пкс від цілі «${esc(near.type || "ціль")}»</p>`);
      });
      if (!this.clicks.length) h.push(`<p class="muted">Кліків по знімку не було.</p>`);
      h.push(`<p class="muted">Час: ${this.result.time} с · бали: +${this.result.score}${this.hintUsed ? " (з підказкою)" : ""}</p>`);
      $("g-debrief").innerHTML = h.join("");
      $("g-debrief").hidden = false;
      const last = this.idx === this.rounds.length - 1;
      this.msg(`${this.reason} +${this.result.score} балів.${missed.length ? " Незнайдені цілі обведено жовтим пунктиром." : ""}`, missed.length ? "no" : "ok");
      $("g-next").textContent = last ? "Підсумок →" : "Далі →";
      $("g-next").hidden = false;
      $("g-next").focus();
    },

    // ---------- підсумок
    summary() {
      show("s-summary");
      const res = this.results;
      const max = 10 * res.length, total = res.reduce((a, r) => a + r.score, 0);
      const pct = max ? Math.round(100 * total / max) : 0, concl = Logic.conclusion(total, max);
      $("sum-title").textContent = `Підсумок · ${this.callsign}`;
      $("sum-total").textContent = `${total} з ${max} балів · ${pct}% · ${concl}`;
      $("sum-total").style.color = pct >= 60 ? "var(--hit)" : pct >= 40 ? "var(--accent)" : "var(--miss)";
      $("sum-table").innerHTML = `<tr><th class="num">Етап</th><th>Знімок</th><th class="num">Цілі</th><th class="num">Промахи</th><th class="num">Час, с</th><th class="num">Бали</th></tr>` +
        res.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.title)}</td><td class="num">${r.found}/${r.total}</td><td class="num">${r.misses}</td><td class="num">${r.time}</td><td class="num">${r.score}</td></tr>`).join("");
      const now = new Date();
      const p2 = (x) => String(x).padStart(2, "0");
      const item = {callsign: this.callsign, scores: res.map((r) => r.score), max, conclusion: concl,
        date: `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`,
        clicks: res.flatMap((r) => r.clicks)};
      const q = LS.get("poshuk_pending", []);
      q.push(item);
      LS.set("poshuk_pending", q);
      $("sum-sync").className = "muted";
      $("sum-sync").textContent = "Записую результат…";
      this.flushPending().then((left) => {
        $("sum-sync").textContent = left ? "Немає зв'язку: результат збережено в браузері й надішлеться при наступному вході."
          : "Результат записано.";
        $("sum-sync").style.color = left ? "var(--miss)" : "var(--hit)";
      });
    },

    async flushPending() {
      const q = LS.get("poshuk_pending", []);
      if (!q.length || !this.password || this._flushing) return q.length;
      this._flushing = true;
      try {
        while (q.length) {
          await API.call("submit", q[0], this.password);
          q.shift();
          LS.set("poshuk_pending", q);
        }
      } catch (e) { /* лишаємо в черзі */ } finally { this._flushing = false; this.refreshPending(); }
      return q.length;
    },

    refreshPending() {
      const k = LS.get("poshuk_pending", []).length;
      $("pending-info").textContent = k ? `Не надіслано результатів: ${k}. Надішлються автоматично.` : "";
    },
  };

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c])); }

  window.Game = Game;
  window.UI = {show, toast, esc};
})();
