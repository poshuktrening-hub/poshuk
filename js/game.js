/* Гра курсанта: вхід, етапи, доповідь, розбір, підсумок, черга відправки результатів. */
(function () {
  const $ = (id) => document.getElementById(id);
  const {LS, SS} = API;
  const HINT_SCORE = 5, BRIEF_MS = 5000;
  const OUTRO_DELAY = 450, OUTRO_MS = 1100;
  const COLORS = {hit: "#3ddc97", miss: "#ff5a4f", accent: "#ffb23e", decoy: "#b48cff"};

  const TOUCH = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  const BG_SCREENS = ["s-login", "s-start", "s-summary"];
  /* Системна кнопка «Назад» (Android, встановлений застосунок): з будь-якого екрана — назад у меню, а не вихід
     із застосунку. Поки відкрито екран чи підменю, в історії лежить один «запобіжний» запис {trap: 1}. */
  const inTrap = () => !!(history.state && history.state.trap);
  const trap = () => { if (!inTrap()) try { history.pushState({trap: 1}, ""); } catch (e) { /* ок */ } };
  function show(id) {
    const sp = $("splash"); if (sp) sp.remove();
    document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
    if (!/^s-(start|login|admin)$/.test(id)) trap();
    const bg = $("bgvid"), on = BG_SCREENS.includes(id);
    if (!bg) return;
    bg.hidden = !on;
    document.body.classList.toggle("with-bg", on);
    const v = bg.querySelector("video");
    // відео тла (2+ МБ) — лише на ПК зі швидким зв'язком; на телефоні й повільній мережі — нерухома картинка
    const cn = navigator.connection || {};
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches || cn.saveData || /(^|-)(2g|3g)$/.test(cn.effectiveType || "") || matchMedia("(pointer: coarse)").matches;
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
      // Enter у полі «Прізвище» не запускає гру: старт — лише кнопкою в підменю «Пошук»
      $("start-form").onsubmit = (e) => { e.preventDefault(); if ($("start-form").dataset.view === "search") this.start(); };
      $("callsign").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } });
      $("logout-btn").onclick = () => { LS.del("poshuk_pw"); this.password = null; this.showLogin(); };
      $("g-skip").onclick = () => this.skip();
      $("g-hint").onclick = () => this.hint();
      $("g-sound").textContent = SFX.on ? "🔊" : "🔇";
      $("g-sound").onclick = () => { $("g-sound").textContent = SFX.toggle() ? "🔊" : "🔇"; };
      $("g-next").onclick = () => this.goNext();
      $("g-quit").onclick = () => { if (confirm("Перервати гру? Результат не буде збережено.")) { this.quit(); this.showStart(); } };
      $("sum-again").onclick = () => { SFX.click(); if (this.lastFix) return this.againFix(this.lastGame); if (this.lastGame === "cards" && window.Cards) Cards.start(this.lastCardsMode ? {mode: this.lastCardsMode} : undefined); else this.start(); };   // та сама гра з тими ж налаштуваннями
      $("sum-menu").onclick = () => { SFX.click(); this.lastView = "menu"; this.showStart(); };
      $("sum-exit").onclick = () => $("logout-btn").click();
      window.addEventListener("popstate", () => {
        const vis = (id) => { const el = $(id); return !!el && !el.hidden; };
        const again = (sel) => { trap(); const b = $(sel); if (b) b.click(); };   // підтвердження: відмовився — запобіжник лишається
        if (vis("s-ref")) { if (window.Ref && $("r-detail") && !$("r-detail").hidden) { trap(); Ref.closeDetail(); } else if (window.Ref) Ref.close(); return; }
        if (vis("s-summary")) { $("sum-menu").click(); return; }
        if (vis("s-cards")) return again("c-quit");
        if (vis("s-game")) return again("g-quit");
        if (vis("s-duel")) return again("d-quit");
        if (vis("s-start") && this.lastView !== "menu") this.view("menu", true);
      });
      document.addEventListener("keydown", (e) => {
        if ($("s-game").hidden || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
        if (e.key === "+" || e.key === "=") this.viewer.zoomCenter(1.6);
        else if (e.key === "-") this.viewer.zoomCenter(1 / 1.6);
        else if (e.key === "0") this.viewer.fill(true);
        else if (e.key === "Enter" && !$("g-next").hidden) this.goNext();
      });
      if (window.Offline && Offline.ready && !Offline.on && !navigator.onLine) Offline.goOffline();   // немає мережі — сам вмикаю офлайн
      if (!this.password) return this.showLogin();
      // збережений пароль: перший запит після відкриття іноді не доходить (сервер «прокидається», мережа ще не піднялась) —
      // кілька тихих повторів, і лише потім показуємо вхід; помилку зв'язку не показуємо, якщо далі все вдалося
      for (let k = 0; ; k++) {
        try { await this.loadConfig(); return this.showStart(); } catch (e) {
          const net = /зв'язку/.test(e.message || "");
          if (net && window.Offline && Offline.ready && !Offline.on) { Offline.goOffline(); return location.reload(); }
          if (net && k < 3) { await new Promise((r) => setTimeout(r, 800 * (k + 1))); continue; }
          if (net) { this.showLogin(""); return this.retryBoot(); }   // далі — тихо пробуємо у фоні
          return this.showLogin(e.auth && !/змінено/i.test(e.message) ? "" : e.message);   // «пароль змінено» — показати, щоб було зрозуміло, чому просить вхід
        }
      }
    },
    /* Сервер не відповів одразу — без червоного повідомлення, тихо повторюємо, поки курсант на екрані входу. */
    retryBoot() {
      clearTimeout(this._rb);
      this._rb = setTimeout(async () => {
        if ($("s-login").hidden || !LS.get("poshuk_pw", null)) return;
        try { this.password = LS.get("poshuk_pw", null); await this.loadConfig(); this.showStart(); }
        catch (e) { if (/зв'язку/.test(e.message || "")) this.retryBoot(); }
      }, navigator.onLine ? 4000 : 8000);
    },

    showLogin(err = "") {
      show("s-login");
      $("login-err").textContent = err;
      $("login-pass").value = "";
      $("login-pass").focus();
    },

    async login(pw) {
      clearTimeout(this._rb);
      $("login-btn").disabled = true;
      $("login-err").textContent = "";
      try {
        this.password = pw;
        // один тихий повтор, якщо перший запит не дійшов (сервер «прокидається»)
        try { await this.loadConfig(); } catch (e1) { if (!/зв'язку/.test(e1.message || "")) throw e1; await new Promise((r) => setTimeout(r, 1200)); await this.loadConfig(); }
        // пароль адміністратора в браузері не зберігаємо (спільний пристрій у класі): адмін входить щоразу
        if (this.role !== "admin") LS.set("poshuk_pw", pw); else LS.del("poshuk_pw");
        this.showStart();
      } catch (e) {
        if (window.Offline && Offline.ready && !Offline.on && /зв'язку/.test(e.message)) { Offline.goOffline(); return this.login(pw); }
        this.password = null;
        console.error(e);
        $("login-err").textContent = /[а-яіїєґ]/i.test(e.message || "") ? e.message
          : "Не вдалося запустити тренажер. Оновіть сторінку (потягніть екран донизу) і спробуйте ще раз.";
      } finally { $("login-btn").disabled = false; }
    },

    async loadConfig() {
      const j = await API.call("config", {}, this.password);
      this.cfg = j.settings; this.role = j.role || "player";
      // підпис автора: іконка завантажується в адмінці (у базі, не в репозиторії); немає — лишається слово
      const ci = $("credit-icon");
      if (ci) ci.innerHTML = j.brandIcon ? `<img src="${j.brandIcon}" alt="росомаха">` : "росомахою";
      this.stages = j.stages; API.noteStages(j.stages);
      this.objects = j.objects || [];
      this.cardPhotos = new Map(j.cardPhotos || []);
      this.cardCredits = new Map(j.cardCredits || []);
      this.cardPics = j.cardPics || {};   // фото карток із довідника: картка → [[id фото, версія, джерело]]
      this.cardHard = j.cardHard || {};
      this.marks = j.marks || {};   // ознаки на фото довідника: id фото → [{x,y,w,h,t}]
      this.typePool = [...new Set([...this.stages.flatMap((s) => s.targets.map((t) => t.type)), ...Logic.TYPES].filter(Boolean))];
    },

    showStart() {
      show("s-start");
      requestAnimationFrame(fitMenuTitles);
      const saved = LS.get("poshuk_menu", {}) || {};
      this.sel = {mode: Logic.MODES[saved.mode] ? saved.mode : "game",
        regions: Array.isArray(saved.regions) ? saved.regions.filter((r) => Logic.REGIONS.includes(r)) : Logic.REGIONS.slice(),
        seasons: Array.isArray(saved.seasons) ? saved.seasons.filter((r) => Logic.SEASONS.includes(r)) : Logic.SEASONS.slice()};
      if (!this.sel.seasons.length) this.sel.seasons = Logic.SEASONS.slice();   // збережені «Весна/Осінь» більше не існують
      this.renderMenu();
      try { if (window.Cards) Cards.renderMenu(); } catch (e) { console.error(e); }
      const offOn = !!(window.Offline && Offline.on);
      $("callsign").value = offOn ? Game.OFF_NAME : ($("callsign").value.trim() || LS.get("poshuk_callsign", ""));   // не губити щойно введений позивний
      $("start-err").textContent = "";
      this.view(this.lastView || "menu");
      document.querySelectorAll("#s-start [data-go]").forEach((b) => (b.onclick = () => { SFX.click(); this.view(b.dataset.go); }));
      document.querySelectorAll("#s-start [data-help]").forEach((b) => (b.onclick = () => Help.show(b.dataset.help)));
      this.offUi();
      this.refreshPending();
      this.flushPending().then(() => { this.loadTop(); this.loadMistakes(); });
      $("callsign").onchange = () => this.loadMistakes();
      if (!$("callsign").value) $("callsign").focus();
    },
    OFF_NAME: "Офлайн",   // в офлайн-версії результати лише на пристрої — прізвище не потрібне
    /* Офлайн-версія: позначка в меню; без мережі не показуємо дуель, топ і адмінку. */
    offUi() {
      const on = !!(window.Offline && Offline.on), inf = on ? Offline.info() : null;
      const badge = $("off-badge");
      if (badge) {
        badge.hidden = !on;
        if (on) badge.innerHTML = `<b>ОФЛАЙН</b><span>Торкніться для переходу в онлайн</span><span>Оновлено: ${new Date(inf.at).toLocaleTimeString("uk-UA", {hour: "2-digit", minute: "2-digit"})}, ${new Date(inf.at).toLocaleDateString("uk-UA")}</span>`;
        badge.onclick = () => this.switchMode(false);
      }
      document.querySelectorAll(".mm-duel, .admin-link, .top3, .cs-field").forEach((el) => { if (on) el.hidden = true; else if (!el.classList.contains("top3")) el.hidden = false; });
      const link = $("off-link-t");
      if (link) link.textContent = on ? "Офлайн ✓" : Offline.ready ? "В офлайн" : "Офлайн";
    },
    /* Перемикання онлайн ↔ офлайн без видалення завантажених даних. */
    switchMode(toOffline) {
      if (!toOffline && !navigator.onLine) return toast("Немає інтернету — онлайн-режим недоступний. Залишаюсь в офлайні.");
      if (toOffline) Offline.goOffline(); else Offline.goOnline();
      this.lastView = "menu";
      location.reload();
    },
    renderOff() {
      const box = $("off-body"), on = !!(window.Offline && Offline.on), ready = !!(window.Offline && Offline.ready), inf = ready ? Offline.info() : null;
      const mb = (b) => Math.max(1, Math.round((b || 0) / 1048576));
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
      const install = standalone ? "" : `<div class="off-inst"><b>Встановити як застосунок</b>
          ${this.installEvt ? `<button type="button" id="off-install">📲 Встановити на головний екран</button>` : ""}
          <p class="muted small">${ios ? "iPhone: відкрийте сайт у <b>Safari</b> → «Поділитися» → «На екран „Додому“»." : "Android: Chrome → меню ⋮ → «Встановити застосунок» або «Додати на головний екран»."}</p></div>`;
      const back = `<button type="button" class="off-back" id="off-back">Повернутися в меню</button>`;
      const au = LS.get("poshuk_off_auto", {}) || {};
      const autoTxt = `<p class="muted small">🔄 Автооновлення: о 08:00 і 20:00, якщо є інтернет і застосунок відкритий (або при наступному відкритті) — докачуються лише зміни. Зміна паролів оновленням не заважає.</p>`
        + (au.err && !au.at ? `<p class="small err">Останнє автооновлення не вдалося: ${esc(au.err)}</p>` : "");
      box.innerHTML = on
        ? `<p>Офлайн-версія <b>увімкнена</b>: тренажер працює без інтернету й не звертається до сервера.</p>
           <p class="muted">Дані від ${new Date(inf.at).toLocaleString("uk-UA", {dateStyle: "short", timeStyle: "short"})}: етапів — ${inf.stages}, фото карток — ${inf.cards}, записів довідника — ${inf.ref} (≈ ${mb(inf.bytes)} МБ).</p>
           <p class="muted small">Результати й «Робота над помилками» зберігаються лише на цьому пристрої. Дуель і «Топ дня» офлайн недоступні.</p>
           <div class="fix-btns"><button class="primary" type="button" id="off-online">🌐 Перейти в онлайн</button><button type="button" id="off-update">🔄 Оновити дані</button><button type="button" id="off-disable">Видалити офлайн-версію</button></div>
           <div class="off-prog" id="off-prog" hidden><div class="u-bar"><i id="off-bar"></i></div><p class="muted small" id="off-st"></p></div>${autoTxt}${install}${back}`
        : ready
        ? `<p>Зараз <b>онлайн</b>. Офлайн-дані збережено на пристрої — перейти в офлайн можна будь-коли, навіть без інтернету.</p>
           <p class="muted">Дані від ${new Date(inf.at).toLocaleString("uk-UA", {dateStyle: "short", timeStyle: "short"})}: етапів — ${inf.stages}, фото карток — ${inf.cards}, записів довідника — ${inf.ref} (≈ ${mb(inf.bytes)} МБ).</p>
           <div class="fix-btns"><button class="primary" type="button" id="off-offline">📴 Перейти в офлайн</button><button type="button" id="off-update">🔄 Оновити дані</button><button type="button" id="off-disable">Видалити офлайн-версію</button></div>
           <div class="off-prog" id="off-prog" hidden><div class="u-bar"><i id="off-bar"></i></div><p class="muted small" id="off-st"></p></div>${autoTxt}${install}${back}`
        : `<p>Тренажер один раз завантажує етапи, картки й довідник на пристрій і далі працює <b>без інтернету</b> — у полі й без витрат сервера.</p>
           <p class="muted small">Результати в офлайн-версії бачите лише ви — інструктору вони не надсилаються. Дуель і «Топ дня» офлайн недоступні. Потрібно вільне місце — зазвичай 50–300 МБ.</p>
           <div class="fix-btns"><button class="primary" type="button" id="off-dl">📥 ${standalone ? "Завантажити офлайн-версію" : "Завантажити й встановити застосунок"}</button></div>
           ${standalone || this.installEvt ? "" : `<p class="muted small">${ios ? "Після завантаження на iPhone: у <b>Safari</b> → «Поділитися» → «На екран „Додому“»." : "Якщо вікно встановлення не з'явиться: Chrome → меню ⋮ → «Встановити застосунок»."}</p>`}
           <div class="off-prog" id="off-prog" hidden><div class="u-bar"><i id="off-bar"></i></div><p class="muted small" id="off-st"></p></div>${back}`;
      const prog = (t, f) => { $("off-prog").hidden = false; $("off-st").textContent = t; $("off-bar").style.width = Math.round(100 * f) + "%"; };
      const run = async (btn, withInstall) => {
        btn.disabled = true;
        // одна кнопка: системне вікно «Встановити застосунок» — одразу (браузер дозволяє його лише в момент натискання),
        // завантаження даних іде паралельно, незалежно від відповіді
        let asked = false;
        if (withInstall && this.installEvt && !standalone) {
          const ev = this.installEvt; this.installEvt = null; asked = true;
          try { ev.prompt(); ev.userChoice.catch(() => {}); } catch (er) { this.installEvt = ev; asked = false; }
        }
        try {
          if (!(window.Offline && Offline.on)) await this.flushPending();   // спершу відправити ще не надіслані результати
          await Offline.download(this.password, prog);
          if (asked) { /* вікно встановлення вже показано */ }
          else if (this.installEvt && !standalone) {   // Android: системне вікно «Встановити застосунок»
            prog("Готово ✓ Встановлюю застосунок…", 1);
            const ev = this.installEvt;
            try { await ev.prompt(); await ev.userChoice; this.installEvt = null; }
            catch (er) {   // браузер дозволяє вікно встановлення лише одразу після натискання — тоді одна велика кнопка
              $("off-prog").insertAdjacentHTML("beforeend", `<div class="fix-btns"><button class="primary" type="button" id="off-inst-now">📲 Встановити застосунок</button><button type="button" id="off-inst-skip">Пізніше</button></div>`);
              $("off-inst-skip").onclick = () => location.reload();
              $("off-inst-now").onclick = async () => { this.installEvt = null; try { await ev.prompt(); await ev.userChoice; } catch (e2) { /* ок */ } location.reload(); };
              return;
            }
          } else if (ios && !standalone) {
            prog("Готово ✓ Тепер у Safari: «Поділитися» → «На екран „Додому“».", 1);
            return setTimeout(() => location.reload(), 4000);
          }
          prog("Готово ✓ Перезапускаю…", 1);
          setTimeout(() => location.reload(), 800);
        } catch (e) { prog("Помилка: " + e.message, 0); btn.disabled = false; }
      };
      $("off-back").onclick = () => { SFX.click(); this.view("menu"); };
      if ($("off-dl")) $("off-dl").onclick = () => run($("off-dl"), true);
      if ($("off-update")) $("off-update").onclick = () => run($("off-update"));
      if ($("off-online")) $("off-online").onclick = () => this.switchMode(false);
      if ($("off-offline")) $("off-offline").onclick = () => this.switchMode(true);
      if ($("off-disable")) $("off-disable").onclick = async () => {
        if (!confirm("Видалити офлайн-версію? Завантажені дані й офлайн-результати на цьому пристрої буде видалено. Далі тренажер працюватиме з інтернетом.")) return;
        await Offline.disable(); location.reload();
      };
      if ($("off-install")) $("off-install").onclick = async () => { const e = this.installEvt; this.installEvt = null; e.prompt(); try { await e.userChoice; } catch (er) { /* ок */ } this.renderOff(); };
    },

    /* «Мої результати»: власні підсумки курсанта — останні ігри, точність за видами техніки, що варто повторити. */
    async renderMy() {
      const box = $("my-body"), cs = (window.Offline && Offline.on) ? this.OFF_NAME : $("callsign").value.trim();
      if (!cs) { box.innerHTML = `<p class="muted">Впишіть прізвище в меню — і тут з'являться ваші результати.</p>`; return; }
      box.innerHTML = `<p class="muted">Завантажую…</p>`;
      let j;
      try { j = await API.call("my_results", {callsign: cs, dev: deviceId()}, this.password); } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
      const res = j.results || [], ans = (j.answers || []).filter((a) => /^(search|cards)$/.test(a.kind));
      if (!res.length && !ans.length) { box.innerHTML = `<p class="muted">Поки немає жодної гри під прізвищем «${esc(cs)}». Пройдіть пошук цілей або картки — результати з'являться тут.</p>`; return; }
      const MODE = {game: "Ігровий", exam: "Іспит", hard: "Хардкор", cards: "Картки", cards_exam: "Картки · іспит", cards_hard: "Картки · складний"};
      const kindOf = (r) => (/^cards/.test(r.mode || "") || /^Картки/.test(r.conclusion || "") ? "Картки" : "Пошук");
      const best = (k) => res.filter((r) => kindOf(r) === k).reduce((m, r) => Math.max(m, r.pct), 0);
      const acc = (k) => { const a = ans.filter((x) => x.kind === k); return a.length ? Math.round(100 * a.filter((x) => x.ok).length / a.length) : null; };
      const tone = (p) => (p >= 75 ? "t-ok" : p >= 40 ? "" : "t-no");
      const cats = new Map();
      ans.filter((a) => a.kind === "cards").forEach((a) => { const k = a.cat || "Інше", c = cats.get(k) || {n: 0, ok: 0}; c.n++; c.ok += a.ok ? 1 : 0; cats.set(k, c); });
      const catRows = [...cats].map(([k, c]) => [k, c, Math.round(100 * c.ok / c.n)]).sort((a, b) => a[2] - b[2]);
      const fmt = (ts) => { const m = String(ts || "").match(/^\d{4}-(\d\d)-(\d\d)[ T](\d\d:\d\d)/); return m ? `${m[2]}.${m[1]} ${m[3]}` : String(ts || ""); };
      box.innerHTML = `
        <div class="my-stats">
          <div><b>${res.length}</b><span>ігор</span></div>
          <div><b class="${tone(best("Пошук"))}">${best("Пошук")}%</b><span>найкращий пошук</span></div>
          <div><b class="${tone(best("Картки"))}">${best("Картки")}%</b><span>найкращі картки</span></div>
          <div><b>${acc("search") == null ? "—" : acc("search") + "%"}</b><span>точність по цілях</span></div>
          <div><b>${acc("cards") == null ? "—" : acc("cards") + "%"}</b><span>точність по картках</span></div>
        </div>
        ${catRows.length ? `<h3 class="my-h">Картки за видами техніки</h3><div class="my-cats">${catRows.map(([k, c, p]) => `<div class="my-cat"><span>${esc(k)}</span><div class="u-bar"><i style="width:${p}%;background:${p >= 75 ? "var(--hit)" : p >= 40 ? "var(--accent)" : "var(--miss)"}"></i></div><b class="${tone(p)}">${p}%</b><small>${c.ok}/${c.n}</small></div>`).join("")}</div>` : ""}
        <h3 class="my-h">Останні ігри</h3>
        <table class="my-tbl">${res.slice(0, 30).map((r) => `<tr><td class="nowrap muted">${esc(fmt(r.ts))}</td><td>${esc(MODE[r.mode] || kindOf(r))}<small> · ${esc(String(r.conclusion || "").replace(/^(Картки[^:]*|Іспит|Хардкор|Робота над помилками): ?/, ""))}</small></td><td class="num"><b class="${tone(r.pct)}">${r.pct}%</b></td></tr>`).join("")}</table>
        ${window.Offline && Offline.on ? `<p class="muted small">Офлайн-версія: показано результати лише з цього пристрою.</p>` : ""}`;
    },

    /* Топ дня в головному меню: найкращий результат кожного курсанта за поточну добу + звання за цим результатом. */
    async loadTop() {
      if (window.Offline && Offline.on) return;
      const draw = (id, list) => {
        const el = $(id); if (!el) return;
        list = list || [];
        if (!list.length) { el.innerHTML = ""; el.hidden = true; return; }   // ніхто ще не грав — топ не показуємо
        el.innerHTML = `<li class="top-h">Топ дня</li>` + (list.length ? list.map((x, i) => { const rk = Logic.rank(x.pct);
          return `<li><i>${["🥇", "🥈", "🥉"][i]}</i><span class="tn"><b>${esc(x.name)}</b><small title="${esc(rk.name)}">${Logic.rankBadge(rk.level)}${esc(rk.name)}</small></span><em>${x.pct}%</em></li>`; }).join("")
          : `<li class="top-none">Ще ніхто — будьте першим</li>`);
        el.hidden = false;
      };
      const drawDuel = (list) => {
        const el = $("top-duel"); if (!el) return;
        list = list || [];
        if (!list.length) { el.innerHTML = ""; el.hidden = true; return; }
        const word = (n) => (n % 10 === 1 && n % 100 !== 11 ? "перемога" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "перемоги" : "перемог");
        el.innerHTML = `<li class="top-h">Топ дня · перемог</li>` + (list.length ? list.map((x, i) =>
          `<li><i>${["🥇", "🥈", "🥉"][i]}</i><span class="tn"><b>${esc(x.name)}</b></span><em title="${x.wins} ${word(x.wins)}">${x.wins}</em></li>`).join("")
          : `<li class="top-none">Ще ніхто — будьте першим</li>`);
        el.hidden = false;
      };
      if (this.top && this.topDay === today()) { draw("top-search", this.top.search); draw("top-cards", this.top.cards); draw("top-ff", this.top.ff); drawDuel(this.top.duel); }
      try {
        const d = today(), mid = new Date(); mid.setHours(0, 0, 0, 0);
        const j = await API.call("top", {since: d + " 00:00", sinceMs: mid.getTime()}, this.password);
        this.top = j.top; this.topDay = d; draw("top-search", j.top.search); draw("top-cards", j.top.cards); draw("top-ff", j.top.ff); drawDuel(j.top.duel);
      } catch (e) { /* без топу — не страшно */ }
    },
    /* Робота над помилками: що курсант востаннє пройшов з помилкою (етапи — лише ті, що зараз у грі; картки — з фото). */
    async loadMistakes() {
      const cs = $("callsign").value.trim();
      this.mist = {stages: [], cards: []};
      if (cs) {
        try {
          const j = await API.call("mistakes", {callsign: cs, dev: deviceId()}, this.password);
          const ids = new Set(j.stages || []);
          this.mist.stages = this.playable().filter((s) => ids.has(s.id));
          if (window.Cards) { await API.need("data"); await Cards.loadRefPics().catch(() => null); const c = new Set(j.cards || []); this.mist.cards = Cards.withPhoto().filter((x) => c.has(x.id)); }
        } catch (e) { /* без списку помилок */ }
      }
      const n = this.mist.stages.length, m = this.mist.cards.length;
      $("mm-fix").hidden = !(n + m);
      $("fix-info").textContent = [n ? `етапів: ${n}` : "", m ? `карток: ${m}` : ""].filter(Boolean).join(" · ");
      if (!$("sub-fix").hidden) this.renderFix();
      return this.mist;
    },
    renderFix() {
      const mi = this.mist || {stages: [], cards: []}, n = mi.stages.length, m = mi.cards.length;
      $("fix-search").textContent = `Етапи з помилками (${n})`; $("fix-search").disabled = !n;
      $("fix-cards").textContent = `Картки з помилками (${m})`; $("fix-cards").disabled = !m;
      $("fix-none").hidden = !!(n + m);
      $("fix-search").onclick = () => { SFX.click(); this.start({fix: mi.stages}); };
      $("fix-cards").onclick = () => { SFX.click(); if (window.Cards) Cards.start({fix: mi.cards}); };
    },
    /* «Нова гра» після роботи над помилками: оновити список (виправлене зникає) і почати ще раз або повернутись у меню. */
    async againFix(kind) {
      const mi = await this.loadMistakes();
      const list = kind === "cards" ? mi.cards : mi.stages;
      if (!list.length) { this.showStart(); this.view("fix"); return; }
      if (kind === "cards") Cards.start({fix: list}); else this.start({fix: list});
    },

    /* Головне меню → підменю режиму. */
    view(v, fromPop) {
      // розділу потрібні модулі, які ще докачуються у фоні, — дочекатись їх
      const dep = {ref: ["data", "extra"], weak: ["data", "extra"], duel: ["data", "models", "duel"], ff: ["data", "extra"], cards: ["data", "extra"], fix: ["data", "extra", "models"]}[v];
      if (dep && !API.ready(...dep)) {
        if (this._needWait === v) return;
        this._needWait = v; toast("Завантажую…", 20000);
        API.need(...dep).then(() => { this._needWait = null; $("toast").hidden = true; if (!$("s-start").hidden) this.view(v, fromPop); },
          (e) => { this._needWait = null; toast(e.message); });
        return;
      }
      if (v === "ref") { if (window.Ref) Ref.open(); return; }
      if (v === "duel") { if (window.Duel) Duel.open(); return; }
      if (v === "ff") {   // «Свій/чужий» — окремою плиткою меню, одразу в гру
        if (!window.Cards) return;
        if (!Cards.refPics && API.isCF) {
          if (this._ffWait) return;   // уже чекаємо — не дублювати запит
          this._ffWait = true; toast("Завантажую фото…");
          Cards.loadRefPics().catch(() => null).then((m) => {
            this._ffWait = false;
            if (!m) return toast("Немає зв'язку — фото не завантажились. Спробуйте ще раз.");
            if (!$("s-start").hidden) this.view("ff");   // курсант уже пішов в інший розділ — не перекидати
          });
          return;
        }
        const f = Cards.ffPools();
        if (f.own.length < 3 || f.foe.length < 3) { toast(`Мало фото своєї техніки (${f.own.length}): автопошук ще підбирає. Адміністратору: адмінка → «Картки» → «🤖 Автопошук фото».`); return; }
        Cards.start({mode: "ff"}); return;
      }
      if (v === "weak") { if (window.Ref) Ref.open(); return; }
      // системна кнопка «Назад» (Android, встановлений застосунок) повертає з підменю в меню
      if (!fromPop) { if (v !== "menu") trap(); else if (inTrap()) history.back(); }
      this.lastView = v;
      $("start-form").dataset.view = v;
      // «Мої результати» й «Робота над помилками» — лише за своїм прізвищем: тут поле не редагується
      const lock = v === "my" || v === "fix";
      $("callsign").readOnly = lock; $("callsign").closest(".cs-wrap").classList.toggle("locked", lock);
      $("callsign").title = lock ? "Прізвище змінюється в головному меню" : "";   // у підменю: «Меню» зліва вгорі, назва розділу й приціл — праворуч
      const TITLE = {menu: "Пошук техніки", search: "Пошук цілей", cards: "Картки цілей", fix: "Робота над помилками", my: "Мої результати", off: "Офлайн-версія"};
      const lt = document.querySelector("#start-form .logo span"); if (lt) lt.textContent = TITLE[v] || TITLE.menu;
      [["main-menu", "menu"], ["sub-search", "search"], ["sub-cards", "cards"], ["sub-fix", "fix"], ["sub-off", "off"], ["sub-my", "my"]]
        .forEach(([id, k]) => { const el = $(id); if (el) el.hidden = v !== k; });
      if (v === "fix") this.renderFix();
      if (v === "off") this.renderOff();
      if (v === "my") this.renderMy();
      $("start-err").textContent = "";
    },
    callsignOk() {
      if (window.Offline && Offline.on) { this.callsign = this.OFF_NAME; return this.callsign; }
      const cs = $("callsign").value.trim();
      if (!cs) { $("start-err").textContent = "Введіть прізвище"; $("callsign").focus(); return null; }
      LS.set("poshuk_callsign", cs); this.callsign = cs; return cs;
    },

    /* Головне меню: режим, напрямок, пора року (з кількістю етапів у кожному варіанті). */
    playable() { return this.stages.filter((s) => s.targets && s.targets.some((t) => !t.decoy)); },
    /* Галочки: усі вибрані = без фільтра (разом з етапами, де напрямок/пора не вказані). */
    filtered(regions = this.sel.regions, seasons = this.sel.seasons) {
      // напрямки й пори року без жодного етапу приховано — вони не обмежують вибір
      const pl = this.playable(), hasR = (r) => pl.some((s) => Logic.region(s) === r), hasS = (x) => pl.some((s) => s.season === x);
      const allR = Logic.REGIONS.every((r) => regions.includes(r) || !hasR(r)), allS = Logic.SEASONS.every((x) => seasons.includes(x) || !hasS(x));
      const pool = this.playable().filter((s) => (allR || regions.includes(Logic.region(s))) && (allS || seasons.includes(s.season)));
      // хардкор-етапи (техніка сховано понад 60%) — лише в «Хардкорі»; там вони йдуть першими
      if ((this.sel && this.sel.mode) !== "hard") return pool.filter((s) => !s.hard);
      const hard = pool.filter((s) => s.hard);
      return hard.length >= Math.min(this.cfg.rounds_per_game, pool.length) ? hard : [...hard, ...pool.filter((s) => !s.hard)];
    },
    renderMenu() {
      const sel = this.sel;
      const chip = (group, v, list, n) => { const on = sel[group].includes(v);
        return `<button type="button" role="checkbox" aria-checked="${on}" class="chip${on ? " on" : ""}" data-g="${group}" data-v="${esc(v)}"><i aria-hidden="true">${on ? "✓" : ""}</i>${esc(v)}<small>${n}</small></button>`; };
      // «Хардкор» — лише коли в адмінці є етапи з позначкою хардкор
      const hasHard = this.playable().some((s) => s.hard);
      if (sel.mode === "hard" && !hasHard) sel.mode = "game";
      $("pick-mode").innerHTML = Object.values(Logic.MODES).filter((m) => m.id !== "hard" || hasHard).map((m) =>
        `<button type="button" role="radio" aria-checked="${sel.mode === m.id}" class="mode${sel.mode === m.id ? " on" : ""}" data-m="${m.id}"><b>${m.name}</b><span>${esc(m.desc)}</span></button>`).join("");
      // лише напрямки й пори року, для яких є етапи; один варіант — вибору немає, блок ховається
      const rs = Logic.REGIONS.map((r) => [r, this.playable().filter((s) => Logic.region(s) === r).length]).filter(([, n]) => n);
      const ss = Logic.SEASONS.map((x) => [x, this.playable().filter((s) => s.season === x).length]).filter(([, n]) => n);
      $("pick-region").innerHTML = rs.map(([r, n]) => chip("regions", r, sel.regions, n)).join("");
      $("pick-season").innerHTML = ss.map(([x, n]) => chip("seasons", x, sel.seasons, n)).join("");
      $("pick-region").closest(".pick").hidden = rs.length < 2;
      $("pick-season").closest(".pick").hidden = ss.length < 2;
      const save = () => { LS.set("poshuk_menu", sel); SFX.click(); this.renderMenu(); };
      document.querySelectorAll("#pick-mode [data-m]").forEach((b) => (b.onclick = () => { sel.mode = b.dataset.m; save(); }));
      document.querySelectorAll("#s-start [data-g]").forEach((b) => (b.onclick = () => {
        const a = sel[b.dataset.g], v = b.dataset.v;
        sel[b.dataset.g] = a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
        save();
      }));
      const pool = this.filtered(), n = Math.min(this.cfg.rounds_per_game, Logic.sceneCount(pool));
      if (!this.playable().length) {
        $("start-info").innerHTML = 'Поки немає жодного етапу. Адміністратору: <a href="#admin">відкрийте адмінку</a> й додайте знімки.';
      } else $("start-info").textContent = n ? `Етапів у грі: ${n}${pool.length > n ? ` (з ${pool.length})` : ""}.` : "Для вибраних напрямків і пір року етапів немає — додайте галочки.";
      $("start-btn").disabled = !n;
      $("start-btn").textContent = `Почати: ${Logic.MODES[sel.mode].name.toLowerCase()}`;
    },

    // ---------- гра
    start(opt) {
      if (!this.callsignOk()) return;
      SFX.unlock();
      if (!API.ready("data", "models", "extra")) {   // моделі техніки для брифінгу ще докачуються
        if (this._startWait) return;
        this._startWait = true; toast("Завантажую…", 20000);
        API.need("data", "models", "extra").then(() => { this._startWait = false; $("toast").hidden = true; if (!$("s-start").hidden) this.start(opt); },
          (e) => { this._startWait = false; toast(e.message); });
        return;
      }
      if (window.Help && Help.maybe("search", () => this.start(opt))) return;   // перший раз — інструкція
      this.fix = opt && opt.fix && opt.fix.length ? opt.fix : null;
      this.mode = this.fix ? Logic.MODES.game : Logic.MODES[this.sel.mode] || Logic.MODES.game;
      this.limit = this.mode.seconds || Math.round(this.cfg.time_limit_sec * (this.mode.time || 1));
      this.missLimit = this.mode.misses === null ? this.cfg.misses_allowed : this.mode.misses;
      document.body.dataset.mode = this.mode.id;
      const fl = this.filtered(), hardFirst = this.mode.id === "hard" ? fl.filter((s) => s.hard) : [];
      const taken = new Set();   // сцени, вже взяті в цю гру: день і його зима/ніч разом не показуються
      this.rounds = this.fix ? Logic.pickRounds(this.fix, this.cfg.rounds_per_game, taken, true)
        : hardFirst.length >= this.cfg.rounds_per_game ? Logic.pickRounds(hardFirst, this.cfg.rounds_per_game, taken)
        : [...Logic.pickRounds(hardFirst, hardFirst.length, taken), ...Logic.pickRounds(fl.filter((s) => !hardFirst.includes(s)), this.cfg.rounds_per_game - hardFirst.length, taken)];
      this.results = [];
      this.idx = -1; this.loadFail = null;
      show("s-game");
      if (!this.viewer) {
        this.viewer = new Viewer($("g-view"), {fill: true, onLeft: (x, y) => this.leftClick(x, y), onRight: (x, y) => this.rightClick(x, y), onChange: () => this.hud()});
        const g = this.viewer.addButton("#", "Сітка квадратів", () => { this.viewer.toggleGrid(); g.classList.toggle("on", this.viewer.showGrid); });
        this.gridBtn = g;
        this.viewer.rail.insertBefore($("g-sound"), this.viewer.zoomLbl || null);
        $("g-tools").appendChild(this.viewer.rail);   // кнопки зуму — у нижню панель, щоб нічого не лежало поверх мапи
      }
      this.viewer.toggleGrid(false);   // сітка — за кнопкою «#» (і вмикається підказкою)
      this.gridBtn.classList.remove("on");
      this.gridBtn.hidden = !this.mode.grid;
      this.preload(0);
      this.nextRound();
    },

    /* Наперед — лише наступний етап: поки курсант проходить поточний, наступний встигає завантажитись,
       а в пам'яті телефона не накопичуються всі 10 знімків. */
    preload(i) {
      const st = this.rounds && this.rounds[i];
      if (st) API.loadImage(st.id, this.password).catch(() => {});
    },

    /* Кнопка «Далі» по центру з відліком 5 с — потім сама переходить далі.
       Розгорнули розбір — відлік ставиться на паузу. */
    showNext(label) {
      const b = $("g-next"), N = 5;
      clearInterval(this.nextT);
      let left = N;
      b.innerHTML = `${label} → <span class="cd">${left}</span><i class="cd-bar"></i>`;
      b.hidden = false; b.classList.add("center-next");
      const bar = b.querySelector(".cd-bar");
      bar.style.transition = "none"; bar.style.transform = "scaleX(1)";
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = `transform ${N}s linear`; bar.style.transform = "scaleX(0)"; }));
      b.focus({preventScroll: true});
      this.placeNext();
      this.nextT = setInterval(() => {
        const det = document.querySelector("#g-debrief details");
        if (det && det.open) {   // читають розбір — чекаємо
          clearInterval(this.nextT); b.querySelector(".cd").textContent = ""; bar.style.transition = "none"; bar.style.transform = "scaleX(0)";
          return;
        }
        left--;
        const cd = b.querySelector(".cd"); if (cd) cd.textContent = left > 0 ? left : "";
        if (left <= 0) { clearInterval(this.nextT); this.goNext(); }
      }, 1000);
    },
    /* «Далі» — нижче або вище центру, там, де немає цілей (кнопка не має закривати щойно знищену ціль). */
    placeNext() {
      const b = $("g-next"), v = this.viewer;
      if (!b || b.hidden || !v || !v.img) return;
      const hr = v.host.getBoundingClientRect(), H = innerHeight, bh = b.offsetHeight || 60, bw = b.offsetWidth || 240;
      const pts = [...(this.targets || []), ...(this.decoys || [])].map((t) => [hr.left + v.tx + t.x * v.s, hr.top + v.ty + t.y * v.s, (t.r || 14) * v.s + 30]);
      const score = (fy) => {   // найменша відстань від цілей до прямокутника кнопки
        const cy = H * fy, x0 = innerWidth / 2 - bw / 2, x1 = innerWidth / 2 + bw / 2, y0 = cy - bh / 2, y1 = cy + bh / 2;
        return Math.min(1e9, ...pts.map(([x, y, r]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)) - r));
      };
      const best = [0.76, 0.86, 0.24, 0.5].map((fy) => [fy, score(fy)]).sort((a, c) => (c[1] > 0) - (a[1] > 0) || (a[1] > 0 ? 0 : c[1] - a[1]))[0][0];
      b.style.top = Math.round(best * 100) + "%";
    },
    goNext() {
      clearInterval(this.nextT);
      const b = $("g-next"); if (b.hidden) return;
      b.hidden = true; b.classList.remove("center-next"); b.style.top = "";
      this.nextRound();
    },

    /* Вихід посеред гри: зупинити все, що ще чекає (таймер, брифінг, «Далі», підвантаження), щоб гра не йшла далі у фоні. */
    quit() {
      this.over = true;
      clearTimeout(this.tickT); clearInterval(this.nextT); clearTimeout(this.outroT); clearTimeout(this._fcT);
      if (this._briefEnd) this._briefEnd();
      this.rounds = null; this.cur = null; this.loadFail = null;
      $("g-brief").hidden = true; $("g-next").hidden = true; $("g-next").classList.remove("center-next");
      if (this.viewer) this.viewer.setImage(null);
      API.trimImages && API.trimImages([]);
    },

    async nextRound() {
      if (!this.rounds) return;
      this.idx++;
      if (this.idx >= this.rounds.length) return this.summary();
      clearTimeout(this.outroT);
      const st = this.cur = this.rounds[this.idx];
      if ($("g-fcard")) $("g-fcard").hidden = true;
      this.targets = st.targets.filter((t) => !t.decoy);
      this.decoys = st.targets.filter((t) => t.decoy);
      this.found = new Set(); this.foundOrder = []; this.misses = 0; this.marks = []; this.clicks = []; this.taps = []; this.pen = 0;
      this.over = true;
      $("g-next").hidden = true; $("g-skip").hidden = !this.mode.skip; $("g-hint").hidden = !this.mode.hint; $("g-hint").disabled = false;
      this.hintUsed = false;
      $("g-debrief").hidden = true;
      $("g-stage").textContent = `${this.mode.id === "game" ? "" : this.mode.name + " · "}Етап ${this.idx + 1}/${this.rounds.length} · ${st.title}`;
      this.msg("Завантажую знімок…");
      $("g-loading").hidden = false;
      // знімок — до 3 спроб (обрив мережі, застарілий токен: api.js сам перевходить)
      let img = null, err = null;
      for (let k = 0; k < 3 && !img; k++) {
        try { img = await API.loadImage(st.id, this.password); } catch (e) { err = e; if (k < 2 && this.cur === st) await new Promise((r) => setTimeout(r, 1500 * (k + 1))); }
        if (this.cur !== st) return;   // гру перервано
      }
      $("g-loading").hidden = true;
      if (!img) {   // не вдалось — «Повторити» або «Пропустити»; пропущений через зв'язок етап не рахується в оцінку
        this.msg(`Не вдалось завантажити знімок: ${String(err && err.message || "немає зв'язку").replace(/[.\s]+$/, "")}. Повторіть або пропустіть — на оцінку це не вплине.`, "no");
        this.loadFail = st; this.idx--;
        $("g-skip").hidden = false;
        const b = $("g-next"); b.innerHTML = "Повторити ↻"; b.hidden = false; b.classList.add("center-next"); b.style.top = "50%";
        return;
      }
      this.loadFail = null;
      if (API.trimImages) API.trimImages(this.rounds.slice(this.idx, this.idx + 2).map((s) => s.id));   // у пам'яті — лише поточний і наступний
      this.preload(this.idx + 1);
      this.viewer.setImage(img);
      if (window.FX && FX.prepare) FX.prepare(this.viewer);
      this.viewer.setGrid(this.cfg.grid_cols);
      if (!this.mode.blind) { this.msg("Брифінг: запам'ятайте, що шукаєте."); await this.brief(st); }
      if (this.cur !== st) return;
      this.over = false;
      this.msg("");
      this.t0 = performance.now(); this.lastTick = null;
      this.hudSeed(st); this.hud();
      this.stats();
      this.tick();
    },

    /* Брифінг перед етапом: 5 с чорний екран з технікою, яку шукатимуть, та її ТТХ. */
    /* Модель за назвою цілі, якщо прямого збігу немає (напр. ціль «РСЗВ Град», а модель «БМ-21 Град» або вже оновлена версія). */
    objByName(type) {
      const GEN = /^(рсзв|танк|сау|зрк|зргк|бмп|бмд|бтр|рлс|реб|птрк|ціль|техніка|муляж|вантажівка|гаубиця|гармата|міномет|бпла|катапульта|з)$/;
      const words = String(type || "").toLowerCase().split(/[^a-zа-яіїєґ0-9-]+/).filter((w) => w.length >= 3 && !GEN.test(w));
      if (!words.length) return null;
      const cand = this.objects.filter((x) => !x.decoy && words.some((w) => String((x.name || "") + " " + (x.type || "")).toLowerCase().includes(w)));
      return cand[0] || null;
    },
    /* Картинка техніки для брифінгу — ланцюжок запасних варіантів: модель етапу → інша модель з такою назвою →
       вбудована модель того ж типу → фото з карток/довідника. Якщо одна не відкривається — береться наступна. */
    async picChain(t, o) {
      const norm = (x) => String(x || "").toLowerCase();
      const out = [], add = (u) => { if (u && !out.includes(u)) out.push(u); };
      const objSrc = async (m) => (m.builtin ? (Models.sprite(m.id) || {toDataURL: () => ""}).toDataURL() : API.objUrl(m.id, this.password).catch(() => null));
      if (o) add(await objSrc(o));
      const text = norm([t.type, o && o.name].join(" "));
      const words = text.split(/[^a-zа-яіїєґ0-9-]+/).filter((w) => w.length >= 3);
      for (const m of this.objects.filter((x) => !x.decoy && x !== o && words.some((w) => norm(x.name).includes(w)))) add(await objSrc(m));
      const ty = Logic.typeOf(t.type || (o && o.name) || "");
      const bi = Models.LIST.find((m) => !m.decoy && !/:decoy$/.test(m.id) && (m.id === t.obj || words.some((w) => norm(m.name).includes(w)) || Logic.typeOf(m.name) === ty));
      if (bi) add(await objSrc(bi));
      // фото з режиму «Картки» (за назвами/синонімами), напр. «Град» → БМ-21
      const hay = norm([text, bi && bi.name].join(" "));
      const card = (window.CARDS || []).find((c) => String(c[2] || "").split("|").some((al) => al.length >= 3 && hay.includes(al)));
      if (card && window.Cards) add(await Cards.photoUrl(card[0]).catch(() => null));
      return out;
    },
    /* Відкрилась, але порожня (майже прозора чи крихітна — напр. невдало прибраний фон)? Тоді — наступна картинка. */
    picCheck(img) {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (w < 16 || h < 16) return this.picFail(img);
        const k = Math.min(1, 64 / Math.max(w, h)), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        const x = c.getContext("2d"); x.drawImage(img, 0, 0, c.width, c.height);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
        if (n < c.width * c.height * 0.04) this.picFail(img);
      } catch (e) { /* немає доступу до пікселів — лишаємо як є */ }
    },
    picFail(img) {
      let alt = []; try { alt = JSON.parse(img.dataset.alt || "[]"); } catch (e) { alt = []; }
      if (!alt.length) { const b = img.closest(".b-pic"); if (b) b.remove(); return; }
      img.dataset.alt = JSON.stringify(alt.slice(1));
      img.src = alt[0];
    },
    async brief(st, after = false) {
      const norm = (s) => String(s || "").toLowerCase().trim();
      const seen = new Set(), items = [];
      for (const t of st.targets.filter((x) => !x.decoy)) {
        const key = t.obj || norm(t.type);
        if (seen.has(key)) continue;
        seen.add(key);
        const o = this.objects.find((x) => x.id === t.obj) || this.objects.find((x) => norm(x.type) === norm(t.type)) || this.objByName(t.type) || null;
        items.push({t, o: o || (Models.isBuiltin(t.obj) ? Models.LIST.find((m) => m.id === t.obj) : null) || (/катапульт/.test(norm(t.type)) ? Models.LIST[0] : null)});
      }
      const box = $("g-brief");
      // обробники картинок — кодом, а не в розмітці (політика безпеки сторінки забороняє inline-скрипти)
      const wirePics = () => box.querySelectorAll("img[data-alt]").forEach((im) => {
        im.onerror = () => this.picFail(im); im.onload = () => this.picCheck(im);
        if (im.complete) { if (im.naturalWidth) this.picCheck(im); else if (im.getAttribute("src")) this.picFail(im); }
      });
      const cards = await Promise.all(items.map(async ({t, o}) => {
        const srcs = await this.picChain(t, o);
        const pic = srcs.length ? `<img src="${srcs[0]}" alt="" data-alt="${esc(JSON.stringify(srcs.slice(1)))}">` : "";
        const ttx = Logic.ttxFor(o, t.type, !!t.decoy);
        const len = o && o.length_m ? `<p class="len">Довжина ≈ ${o.length_m} м</p>` : "";
        const name = Logic.dispName(o && o.name ? o.name.replace(/\s*\(вбудована\)$/, "") : (t.type || "ціль"));
        const sub = o && o.name && t.type && !Logic.nameHasType(name, t.type) ? `<p class="len">${esc(t.type)}</p>` : "";   // тип окремим рядком — лише якщо його немає в назві
        return `<div class="b-card">${pic ? `<div class="b-pic">${pic}</div>` : ""}<div class="b-txt"><h3>${UI.nameHtml(name)}</h3>${sub}${len}${ttx ? `<p>${esc(ttx).replace(/\n/g, "<br>")}</p>` : ""}</div></div>`;
      }));
      const n = st.targets.filter((x) => !x.decoy).length;
      const types = [...new Set(st.targets.filter((x) => !x.decoy).map((x) => x.type).filter(Boolean))].join(", ");
      const task = (st.task || "").trim() || `Виявити ${types || "техніку противника"} у районі «${st.title.split("·")[0].trim()}» та позначити для ураження.`;
      if (after) {   // хардкор: картка цілі — лише після етапу
        box.innerHTML = `<div class="b-inner"><div class="b-head">ЕТАП ${this.idx + 1} · ЩО ВИ ШУКАЛИ</div>${cards.join("")}
          <div class="b-foot"><div class="b-bar"><i></i></div><button type="button" class="primary" id="b-go">Далі</button></div></div>`;
        box.hidden = false; wirePics();
        const bar = box.querySelector(".b-bar i");
        requestAnimationFrame(() => { bar.style.transition = `transform ${BRIEF_MS}ms linear`; bar.style.transform = "scaleX(0)"; });
        await this.briefWait(box);
        box.hidden = true;
        return;
      }
      box.innerHTML = `<div class="b-inner"><div class="b-head">ЕТАП ${this.idx + 1} · ЗНАЙТИ ${n > 1 ? n + " ЦІЛІ" : "ЦІЛЬ"}</div>
        <div class="b-task"><div class="b-from">📡 ЗАВДАННЯ</div><p>${esc(task)}</p></div>${cards.join("")}
        ${st.cond === "thermal" ? `<p class="b-cond">🌡 Тепловізор, ніч: тепле — світле. Найяскравіші — двигун і вихлоп; муляжі холодні й темні.</p>` : st.cond === "winter" ? `<p class="b-cond">❄ Зима: техніка — темна пляма на снігу, видно свіжі накати.</p>` : ""}
        <p class="b-warn">⚠ На знімку можуть бути муляжі — клік по обманці рахується як промах.</p>
        <div class="b-foot"><div class="b-bar"><i></i></div><button type="button" class="primary" id="b-go">Почати зараз</button></div></div>`;
      box.hidden = false; wirePics();
      SFX.radio();
      const bar = box.querySelector(".b-bar i");
      requestAnimationFrame(() => { bar.style.transition = `transform ${BRIEF_MS}ms linear`; bar.style.transform = "scaleX(0)"; });
      await this.briefWait(box);
      box.hidden = true;
    },
    /* Очікування брифінгу: BRIEF_MS, кнопка «Почати» або вихід з гри (quit) — що станеться раніше. */
    briefWait(box) {
      return new Promise((res) => {
        const end = () => { clearTimeout(t); this._briefEnd = null; res(); };
        const t = setTimeout(end, BRIEF_MS);
        this._briefEnd = end;
        box.querySelector("#b-go").onclick = end;
      });
    },

    // ---------- вигляд камери дрона
    hudSeed(st) {
      let h = 0; for (const ch of String(st.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const r = (k) => ((h >>> k) & 1023) / 1023;
      this.hudBase = {lat: 46.45 + r(0) * 1.1, lon: 31.4 + r(10) * 3.2, hdg: Math.round(r(5) * 359), gsd: 0.5};
    },
    hud() {
      const v = this.viewer, b = this.hudBase;
      if (!v || !v.img || !b) return;
      const [cx, cy] = v.toImage(v.W / 2, v.H / 2), z = v.zoomRel();
      const dn = (v.img.height / 2 - cy) * b.gsd, de = (cx - v.img.width / 2) * b.gsd;
      const lat = b.lat + dn / 111320, lon = b.lon + de / (111320 * Math.cos(b.lat * Math.PI / 180));
      const dms = (d, p, n) => { const a = Math.abs(d), D = Math.floor(a), M = Math.floor((a - D) * 60), S = ((a - D) * 60 - M) * 60; return `${D}°${String(M).padStart(2, "0")}'${S.toFixed(1).padStart(4, "0")}"${d >= 0 ? p : n}`; };
      $("hud-tl").innerHTML = `ALT ${Math.round(620 / Math.max(1, z))} m<br>HDG ${String(b.hdg).padStart(3, "0")}°<br>SPD 0.0 m/s<br>BAT 78%`;
      $("hud-bl").textContent = `${dms(lat, "N", "S")}  ${dms(lon, "E", "W")}`;
      const sq = v.gridCell && v.inside(cx, cy) ? squareName(cx, cy, v.gridCell) : "—";
      $("hud-br").innerHTML = `ZOOM ×${z.toFixed(1)}<br>SQ ${sq}`;
    },
    hudClock() {
      const s = Math.floor((performance.now() - this.t0) / 1000);
      $("hud-clock").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    },
    left() { return Math.max(0, this.limit - (performance.now() - this.t0) / 1000); },

    tick() {
      if (this.over) return;
      const l = this.left(), warn = l <= 10;
      $("g-time").textContent = fmt(l);
      $("g-time").classList.toggle("warn", warn);
      document.querySelector(".timebar").classList.toggle("warn", warn);
      $("g-timebar").style.transform = `scaleX(${l / this.limit})`;
      const sec = Math.ceil(l);
      if (warn && sec !== this.lastTick && sec > 0) { this.lastTick = sec; SFX.tick(sec <= 3); }
      this.hudClock();
      if (l <= 0) { SFX.timeout(); return this.endRound("Час вийшов!"); }
      this.tickT = setTimeout(() => this.tick(), 200);
    },

    stats() {
      $("g-score").textContent = this.results.reduce((a, r) => a + r.score, 0);
      $("g-miss").textContent = `${this.misses}/${Math.max(1, this.missLimit)}`;
      $("g-found").textContent = `${this.found.size}/${this.targets.length}`;
    },

    msg(text, cls = "") { const m = $("g-msg"); m.textContent = text; m.className = "msg " + cls; },

    leftClick(cx, cy) {
      if (this.over) return;
      const v = this.viewer;
      const [x, y] = v.toImage(cx, cy);
      if (!v.inside(x, y)) return;
      const hit = Logic.hitTest(this.targets, this.found, x, y);
      this.clicks.push([this.cur.id, Math.round(x), Math.round(y), hit !== null]);
      // тицяння навмання: 3 тапи за 1,5 с — окремий штраф (як у hidden-object іграх)
      const now = performance.now(); this.taps = (this.taps || []).filter((t) => now - t < 1500); this.taps.push(now);
      if (hit === null) {
        const dec = this.decoys.find((t) => Math.hypot(x - t.x, y - t.y) <= (t.r || 14));
        this.misses++;
        if (dec) this.clicks[this.clicks.length - 1][4] = 1;
        if (dec) { FX.explode(v, dec.x, dec.y, dec.r || 14, {small: true}); SFX.pop(); setTimeout(() => SFX.decoy(), 450); } else SFX.miss();
        if (dec) { dec.hitByPlayer = true; this.marks.unshift({x: dec.x, y: dec.y, r: (dec.r || 14) * 0.6, scorch: true}); this.marks.push({x: dec.x, y: dec.y, r: dec.r || 14, color: COLORS.decoy, dashed: true, label: "муляж!"}); }
        else this.marks.push({x, y, square: true, color: COLORS.miss});
        v.setMarks(this.marks);
        Game.buzz([60, 40, 60]);
        // штраф часу за хибний тап, що наростає: −3, −5, −8 с…; тицяння навмання — ще −5 с
        const spam = this.taps.length >= 3, pen = Math.round(3 * Math.pow(1.6, this.misses - 1)) + (spam ? 5 : 0);
        this.penalty(pen, spam);
        const leftM = this.missLimit - this.misses;
        if (leftM < 0) return this.endRound(`${dec ? "Це муляж! " : ""}${this.missLimit ? "Ліміт промахів — етап завершено." : "Промах — етап завершено."}`);
        this.msg(`${dec ? "Це муляж — промах!" : "Мимо!"} −${pen} с.${spam ? " Не тицяйте навмання!" : ""} ${leftM === 0 ? "Ще промах — кінець етапу." : "Можна ще: " + leftM + "."}`, "no");
      } else {
        this.found.add(hit); this.foundOrder.push(hit); Game.buzz(25);
        const t = this.targets[hit];
        FX.explode(v, t.x, t.y, t.r || 14); SFX.boom();
        setTimeout(() => SFX.hit(), 650);
        this.marks.unshift({x: t.x, y: t.y, r: t.r || 14, scorch: true});
        this.marks.push({x: t.x, y: t.y, r: t.r || 14, color: COLORS.hit});
        v.setMarks(this.marks);
        if (this.mode.debrief && !this.mode.blind) this.findCard(t);   // картка цілі: що знайшли й чим вона вразлива (не в іспиті)
        if (this.found.size === this.targets.length) { setTimeout(() => SFX.win(), 1300); return this.endRound("Усі цілі знайдено!"); }
        this.msg(`Є! Лишилось: ${this.targets.length - this.found.size}.`, "ok");
      }
      this.stats();
    },

    /* Картка техніки для цілі: за моделлю етапу або назвою цілі — серед карток (назва, синоніми). */
    cardFor(t) {
      if (!window.Cards) return null;
      const o = this.objects.find((x) => x.id === t.obj) || (window.Models && Models.LIST.find((m) => m.id === t.obj)) || this.objByName(t.type);
      const hay = Cards.norm([t.type, o && o.name].join(" "));
      let best = null, bl = 0;
      const GENERIC = new Set([...Logic.TYPES, "техніка", "машина", "комплекс", "катапульта", "гармата", "гаубиця", "вантажівка", "муляж"].map((x) => Cards.norm(x)));
      for (const c of Cards.deck()) for (const a of [c.name, ...c.aliases]) {
        const v = Cards.norm(a);
        if (v.length >= 4 && !GENERIC.has(v) && hay.includes(v) && v.length > bl) { best = c; bl = v.length; }
      }
      return best;
    },
    /* Після влучання: коротка картка (назва, одна ознака, один недолік) — не заважає шукати далі, зникає сама. */
    findCard(t) {
      const c = this.cardFor(t);
      const name = c ? c.name : Logic.dispName(((this.objects.find((x) => x.id === t.obj) || {}).name || t.type || "ціль").replace(/\s*\(вбудована\)$/, ""));
      const sign = c && Cards.signOf(c), weak = c && Cards.weakOf(c);
      const cap = (s) => esc(s.charAt(0).toUpperCase() + s.slice(1));
      const box = $("g-fcard") || (() => { const d = document.createElement("div"); d.id = "g-fcard"; d.className = "fcard"; d.setAttribute("role", "status"); $("g-view").parentElement.appendChild(d); return d; })();
      box.innerHTML = `<b>🎯 ${UI.nameHtml(name)}</b>${sign ? `<p>🔎 ${cap(sign[0])}</p>` : t.signs && t.signs.length ? `<p>🔎 ${esc(t.signs.join(", "))}</p>` : ""}${weak ? `<p>⚠ ${cap(weak[0])}</p>` : ""}${c ? `<button type="button" class="link" data-ref="${esc(c.id)}">У довідник →</button>` : ""}`;
      const b = box.querySelector("[data-ref]");
      if (b) b.onclick = () => { if (confirm("Відкрити довідник? Етап буде перервано, результат не збережеться.")) { this.quit(); box.hidden = true; Ref.openCard(b.dataset.ref); } };
      box.hidden = false; box.classList.remove("in"); void box.offsetWidth; box.classList.add("in");
      clearTimeout(this._fcT); this._fcT = setTimeout(() => { box.hidden = true; }, 6000);
    },

    /* Мінус секунди: таймер «стрибає» вниз, поруч спливає «−5 с». */
    penalty(sec, spam) {
      if (!sec || this.over) return;
      this.t0 -= sec * 1000; this.pen = (this.pen || 0) + sec;
      const t = $("g-time"), r = t.getBoundingClientRect(), f = document.createElement("div");
      f.className = "pen-float"; f.textContent = `−${sec} с${spam ? " · навмання" : ""}`;
      f.style.left = Math.round(r.left + r.width / 2) + "px"; f.style.top = Math.round(r.bottom + 4) + "px";
      document.body.appendChild(f); setTimeout(() => f.remove(), 1400);
      t.classList.remove("pen"); void t.offsetWidth; t.classList.add("pen");
    },

    rightClick(cx, cy) {
      const v = this.viewer;
      v.zoomAt(1 / 1.6, cx, cy);
    },

    skip() {
      if (this.loadFail) {   // знімок не завантажився — етап пропускається без впливу на оцінку
        const st = this.loadFail; this.loadFail = null; this.idx++;
        this.results.push({title: st.title, id: st.id, found: 0, total: st.targets.filter((t) => !t.decoy).length, misses: 0, time: 0, score: 0, clicks: [], report: "", failed: 1});
        const b = $("g-next"); b.hidden = true; b.classList.remove("center-next"); b.style.top = "";
        return this.nextRound();
      }
      if (!this.over) this.endRound("Етап пропущено.");
    },

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
      this.msg(`Ціль у ${[...new Set(names)].join(", ")} · за етап ${HINT_SCORE} балів.`);
    },

    endRound(reason) {
      if (this.over) return;
      this.over = true;
      clearTimeout(this.tickT);
      this.used = this.limit - this.left();
      this.reason = reason;
      let score = Logic.roundScore(this.targets.length, this.found.size);
      if (this.hintUsed && score) score = HINT_SCORE;
      $("g-hint").hidden = true;
      this.result = {title: this.cur.title, id: this.cur.id, found: this.found.size, total: this.targets.length,
        misses: this.misses, time: Math.round(this.used * 10) / 10, score, clicks: this.clicks.slice(), report: "",
        items: this.targets.map((t, i) => ["search", this.cur.id, t.type || "ціль", Logic.category(t.type), this.found.has(i) ? 1 : 0])};
      this.results.push(this.result);
      this.stats();
      $("g-skip").hidden = true;
      if (!this.mode.debrief) {   // іспит: без розбору й показу цілей до кінця
        this.msg(`${reason} (етап ${this.idx + 1} з ${this.rounds.length})`);
        this.showNext(this.idx === this.rounds.length - 1 ? "Результат" : "Далі");
        return;
      }
      if (this.mode.blind) {   // спершу картка «що це було», потім розбір
        const st = this.cur;
        setTimeout(() => { if (this.cur === st) this.brief(st, true).then(() => { if (this.cur === st) { this.showAllMarks(); this.debrief(); } }); }, this.found.size ? 1200 : 0);
        return;
      }
      // після влучання камера рушає, коли вогняна куля вже згасла — інакше анімації накладаються й кадри «підвисають»
      this.outroT = setTimeout(() => { this.showAllMarks(); setTimeout(() => this.placeNext(), OUTRO_MS + 60); }, this.found.size ? 1500 : OUTRO_DELAY);
      this.debrief();
    },

    /* Після етапу: наблизити так, щоб було видно всі цілі, муляжі й промахи (без зайвих порожніх смуг). */
    showAllMarks() {
      const v = this.viewer, pts = [...this.targets, ...this.decoys].map((t) => [t.x, t.y, (t.r || 14) + 30]);
      this.clicks.forEach((c) => pts.push([c[1], c[2], 40]));
      if (!pts.length || !v.img) return v.fit(true, OUTRO_MS);
      const x0 = Math.min(...pts.map((p) => p[0] - p[2])), x1 = Math.max(...pts.map((p) => p[0] + p[2] + 50)); // +місце під підписи
      const y0 = Math.min(...pts.map((p) => p[1] - p[2])), y1 = Math.max(...pts.map((p) => p[1] + p[2]));
      // цілі — у верхніх ~62% екрана, щоб кнопка «Далі» (нижче центру) їх не перекривала
      const availH = v.H * 0.62;
      const rel = Math.max(v.coverRel(), Math.min(v.coverRel() * 3, Math.min(v.W / (x1 - x0), availH / (y1 - y0)) / v.minS));
      const s = v.minS * rel;
      v._go(s, v.W / 2 - (x0 + x1) / 2 * s, availH / 2 + 8 - (y0 + y1) / 2 * s, true, OUTRO_MS);
    },

    sq(t) { return this.viewer.gridCell ? squareName(t.x, t.y, this.viewer.gridCell) : ""; },

    debrief() {
      const missed = this.targets.map((_, i) => i).filter((i) => !this.found.has(i));
      const marks = [...this.targets.filter((_, i) => this.found.has(i)).map((t) => ({x: t.x, y: t.y, r: t.r || 14, scorch: true})),
        ...this.decoys.filter((t) => t.hitByPlayer).map((t) => ({x: t.x, y: t.y, r: (t.r || 14) * 0.6, scorch: true}))];
      let n = 0;
      this.clicks.forEach((c) => { if (!c[3] && !c[4]) marks.push({x: c[1], y: c[2], square: true, color: COLORS.miss, label: String(++n)}); });
      this.targets.forEach((t, i) => {
        const ok = this.found.has(i);
        marks.push({x: t.x, y: t.y, r: (t.r || 14) + (ok ? 0 : 6), color: ok ? COLORS.hit : COLORS.accent, dashed: !ok, label: t.type || ""});
      });
      this.decoys.forEach((t) => marks.push({x: t.x, y: t.y, r: t.r || 14, color: COLORS.decoy, dashed: true, label: "муляж"}));
      this.viewer.setMarks(marks);

      const h = [];
      this.targets.forEach((t, i) => {
        const ok = this.found.has(i), sq = this.sq(t);
        const where = sq ? "квадрат " + sq : "";
        h.push(`<p class="${ok ? "t-ok" : "t-no"}">${i + 1}. ${esc(t.type || "ціль")} — ${esc(where)} (${ok ? "знайдено" : "не знайдено"})</p>`);
        if (t.signs && t.signs.length) h.push(`<p class="sub">Ознаки: ${esc(t.signs.join(", "))}</p>`);
        if (t.note) h.push(`<p class="sub muted">${esc(t.note)}</p>`);
      });
      this.decoys.forEach((t) => {
        const sq = this.sq(t);
        h.push(`<p class="t-decoy">◇ Муляж: ${esc(t.type || "техніка")}${sq ? " — квадрат " + sq : ""}${t.hitByPlayer ? " (ви на нього клікнули)" : " (не повелись ✓)"}</p>`);
      });
      n = 0;
      this.clicks.forEach((c) => {
        if (c[3] || c[4]) return;
        n++;
        const near = this.targets.reduce((a, t) => (Math.hypot(t.x - c[1], t.y - c[2]) < Math.hypot(a.x - c[1], a.y - c[2]) ? t : a));
        const d = Math.round(Math.hypot(near.x - c[1], near.y - c[2]));
        const sq = this.viewer.gridCell ? squareName(c[1], c[2], this.viewer.gridCell) : "";
        h.push(`<p class="t-no">✗ Промах ${n}: квадрат ${sq}, ${d} пкс від цілі «${esc(near.type || "ціль")}»</p>`);
      });
      // коротко одним рядком; подробиці — по тапу
      const line = [
        ...this.targets.map((t, i) => `<b class="${this.found.has(i) ? "t-ok" : "t-no"}">${this.found.has(i) ? "✓" : "✗"} ${esc(t.type || "ціль")} ${esc(this.sq(t))}</b>`),
        n ? `<b class="t-no">промахів ${n}</b>` : "",
        this.decoys.some((t) => t.hitByPlayer) ? `<b class="t-decoy">муляж!</b>` : "",
        `${this.result.time} с${this.pen ? ` (штраф −${this.pen} с)` : ""} · +${this.result.score}${this.hintUsed ? " 💡" : ""}`,
      ].filter(Boolean).join(" · ");
      $("g-debrief").innerHTML = `<details><summary>${line}</summary>${h.join("")}</details>`;
      $("g-debrief").hidden = false;
      const last = this.idx === this.rounds.length - 1;
      this.msg(`${this.reason} +${this.result.score} балів.`, missed.length ? "no" : "ok");
      this.showNext(last ? "Підсумок" : "Далі");
    },

    // ---------- підсумок
    summary() {
      show("s-summary");
      this.lastGame = "search"; this.lastFix = !!this.fix;
      const all = this.results, res = all.filter((r) => !r.failed);   // етапи, що не завантажились, — поза оцінкою
      const max = 10 * res.length, total = res.reduce((a, r) => a + r.score, 0);
      const pct = max ? Math.round(100 * total / max) : 0, m = this.mode || Logic.MODES.game;
      const concl = m.pass ? (pct >= m.pass ? "Склав" : "Не склав") : Logic.conclusion(total, max);
      $("sum-title").textContent = `${this.fix ? "Робота над помилками" : m.id === "game" ? "Підсумок" : m.name} · ${this.callsign}`;
      $("sum-total").textContent = `${total} з ${max} балів · ${pct}% · ${concl}`;
      const rk = Logic.rank(pct);
      $("sum-rank").innerHTML = `${Logic.rankBadge(rk.level)}<div><div class="rk-label">Звання</div><div class="rk-name">${esc(rk.name)}</div><div class="rk-next">${rk.next ? `До «${esc(rk.next.name)}» — від ${rk.next.min}%` : "Найвище звання"}</div></div>`;
      $("sum-total").style.color = m.pass ? (pct >= m.pass ? "var(--hit)" : "var(--miss)") : pct >= 60 ? "var(--hit)" : pct >= 40 ? "var(--accent)" : "var(--miss)";
      $("sum-table").innerHTML = `<tr><th class="num">Етап</th><th>Знімок</th><th class="num">Цілі</th><th class="num">Промахи</th><th class="num">Час, с</th><th class="num">Бали</th></tr>` +
        all.map((r, i) => r.failed ? `<tr class="muted"><td class="num">${i + 1}</td><td>${esc(r.title)}</td><td colspan="4">не завантажився — поза оцінкою</td></tr>`
          : `<tr><td class="num">${i + 1}</td><td>${esc(r.title)}</td><td class="num">${r.found}/${r.total}</td><td class="num">${r.misses}</td><td class="num">${r.time}</td><td class="num">${r.score}</td></tr>`).join("");
      const now = new Date();
      const p2 = (x) => String(x).padStart(2, "0");
      const item = {callsign: this.callsign, scores: res.map((r) => r.score), max, mode: m.id,
        conclusion: this.fix ? `Робота над помилками: ${concl}` : m.id === "game" ? concl : `${m.name}: ${concl}${m.pass ? ` (поріг ${m.pass}%)` : ""}`,
        date: `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`,
        clicks: res.flatMap((r) => r.clicks), items: res.flatMap((r) => r.items || [])};
      if (!res.length) {   // жоден знімок не завантажився — нема чого записувати
        $("sum-sync").className = "muted"; $("sum-sync").style.color = "var(--miss)";
        $("sum-sync").textContent = "Знімки не завантажились (зв'язок) — результат не записано. Спробуйте ще раз.";
        return;
      }
      this.queueResult(item);
      $("sum-sync").className = "muted";
      $("sum-sync").textContent = "Записую результат…";
      this.flushPending().then((left) => {
        $("sum-sync").textContent = left ? "Немає зв'язку: результат збережено в браузері й надішлеться при наступному вході."
          : (/(^|[^a-zа-яіїєґ])(тест|test)/i.test(String(this.callsign || "")) ? "Тестовий вхід — результат не записується в аналітику." : (window.Offline && Offline.on ? "Збережено на цьому пристрої (офлайн-версія)." : "Результат записано."));
        $("sum-sync").style.color = left ? "var(--miss)" : "var(--hit)";
      });
    },

    /* Результат — у чергу з унікальним id: сервер не задвоїть його, навіть якщо відповідь загубилась і він надійде вдруге. */
    queueResult(item) {
      item.cid = item.cid || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      const q = LS.get("poshuk_pending", []); q.push(item); LS.set("poshuk_pending", q);
    },
    async flushPending() {
      if (this._flushing) { await this._flushing; }   // уже надсилаємо — дочекатись і надіслати решту (новий результат не губиться)
      if (!LS.get("poshuk_pending", []).length || !this.password) return LS.get("poshuk_pending", []).length;
      let done;
      this._flushing = new Promise((r) => (done = r));
      try {
        for (;;) {
          const q = LS.get("poshuk_pending", []);   // щоразу свіжа черга: поки йшов запит, міг додатися новий результат
          if (!q.length) break;
          const it = q[0];
          if (!it.cid) { it.cid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); LS.set("poshuk_pending", q); }
          await API.call("submit", Object.assign({dev: deviceId()}, it), this.password);
          LS.set("poshuk_pending", LS.get("poshuk_pending", []).filter((x) => x.cid !== it.cid));
        }
      } catch (e) { /* лишаємо в черзі */ } finally { this._flushing = null; done(); this.refreshPending(); }
      return LS.get("poshuk_pending", []).length;
    },

    refreshPending() {
      const k = LS.get("poshuk_pending", []).length;
      $("pending-info").textContent = k ? `Не надіслано результатів: ${k}. Надішлються автоматично.` : "";
    },
  };

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c])); }

  window.Game = Game;
  /* Випадковий id цього пристрою (браузера): «Мої результати» прізвища відкриваються лише на пристрої, що відкрив їх першим. */
  Game.deviceId = () => deviceId();
  /* Вібрація телефона (якщо є й звук увімкнено): влучання — короткий імпульс, промах — подвійний. */
  Game.buzz = (p) => { try { if (navigator.vibrate && localStorage.getItem("poshuk_sound") !== "off") navigator.vibrate(p); } catch (e) { /* немає */ } };
  function deviceId() {
    let d = LS.get("poshuk_dev", null);
    if (!d || !/^[a-f0-9]{32}$/.test(d)) { const b = new Uint8Array(16); crypto.getRandomValues(b); d = [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); LS.set("poshuk_dev", d); }
    return d;
  }
  /* Назви плиток меню не розриваються посеред слова («Довідни-к»): якщо слово не влазить (вузький екран,
     збільшений шрифт у налаштуваннях телефону) — назва трохи зменшується, поки не вміститься. */
  function fitMenuTitles() {
    const fit = (b) => {
      b.style.fontSize = "";
      if (!b.clientWidth) return 0;
      let fs = parseFloat(getComputedStyle(b).fontSize), n = 0;
      while (b.scrollWidth > b.clientWidth + 1 && n++ < 14) { fs *= 0.94; b.style.fontSize = fs + "px"; }
      return fs;
    };
    // чотири великі плитки — однаковий розмір назв (найменший із потрібних), решта — кожна окремо
    const big = [...document.querySelectorAll(".main-menu .mm:not(.mm-wide):not(.mm-small) .mm-h b")];
    const min = Math.min(...big.map(fit).filter(Boolean));
    if (isFinite(min)) big.forEach((b) => { if (b.clientWidth) b.style.fontSize = min + "px"; });
    document.querySelectorAll(".main-menu .mm.mm-wide .mm-h b, .main-menu .mm.mm-small .mm-h b").forEach(fit);
  }
  window.addEventListener("resize", () => requestAnimationFrame(fitMenuTitles));
  /* Офлайн-дані: автооновлення о 08:00 і 20:00 — перевірка при відкритті, при появі мережі й щоп'ять хвилин. */
  const autoOff = () => {
    if (!window.Offline || !Offline.ready) return;   // лише пристрої з офлайн-версією; онлайн бачить зміни одразу
    if ($("s-start").hidden) return;   // лише з меню: посеред гри фонове оновлення гальмує телефон
    Offline.autoUpdate(Game.password, (n) => { if (n) { toast("Офлайн-дані оновлено з сервера ✓"); Game.offUi(); if ($("off-body") && !$("sub-off").hidden) Game.renderOff(); } });
  };
  setTimeout(autoOff, 15000); setInterval(autoOff, 5 * 60e3); window.addEventListener("online", () => setTimeout(autoOff, 5000));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestAnimationFrame(fitMenuTitles));
  function today() { const n = new Date(), p2 = (x) => String(x).padStart(2, "0"); return `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}`; }
  /* Назва техніки для показу: позначення з дефісом («Тайфун-К», «Т-72Б3») не розриваються на рядки. */
  // позначення з дефісом («Т-72Б3», «Тайфун-К») не розривати; довгі слова («(ремонтно-евакуаційна)») — можна, інакше вилазять за екран
  const nameHtml = (name) => esc(Logic.dispName(name)).replace(/(\S*-\S*)/g, (w) => (w.replace(/&[a-z#0-9]+;|[«»“”"()]/g, "").length <= 10 ? `<span class="nb">${w}</span>` : w));
  window.UI = {show, toast, esc, nameHtml};
})();
