/* Правила гри — ті самі, що в локальній версії. */
(function () {
  const LANDMARKS = ["край лісосмуги", "у лісосмузі", "у полі", "біля дороги", "біля будівель",
    "у населеному пункті", "біля водойми", "у промзоні", "інше"];
  const SIGNS = ["тінь", "«мангал»", "колія / сліди", "нетиповий силует", "маскувальна сітка",
    "колір / відблиск", "укриття під кронами", "позиція / окоп"];
  const CYR2LAT = {А: "A", В: "B", С: "C", Е: "E", Н: "H", К: "K", М: "M", Р: "P", Т: "T", Х: "X"};
  const TYPES = ["танк", "БМП", "БТР", "САУ", "РСЗВ", "буксирувана гармата", "міномет", "ЗРК", "РЕБ", "РЛС",
    "катапульта з БпЛА", "вантажівка", "легковик", "бліндаж / укриття"];

  /* Типові ТТХ для брифінгу, якщо адміністратор не заповнив свої (довжини орієнтовні). */
  const TTX_DEFAULT = {
    "танк": "Гусенична броньована машина з баштою і гарматою 120–125 мм.\nДовжина корпусу ≈ 7 м (з гарматою ≈ 9,5 м), ширина ≈ 3,5 м.\nЗверху: башта посередині, довга гармата, гусениці по боках; часто «мангал» над баштою.",
    "катапульта з бпла": "Пускова рейка для ударного БпЛА типу «Ланцет».\nДовжина ≈ 5–6 м, ширина ≈ 1 м.\nЗверху: вузька довга рейка, БпЛА з Х-подібним крилом; ховають у лісосмугах під кронами.",
    "бмп": "Гусенична бойова машина піхоти з невеликою баштою (гармата 30 мм).\nДовжина ≈ 6,5–7 м, ширина ≈ 3,2 м.\nЗверху: компактна башта ближче до носа, десантні люки ззаду.",
    "бтр": "Колісний бронетранспортер (8 коліс).\nДовжина ≈ 7,5 м, ширина ≈ 2,9 м.\nЗверху: видовжений корпус, мала башта, 4 пари коліс.",
    "сау": "Самохідна гаубиця на гусеничному шасі, гармата 152 мм.\nДовжина ≈ 7 м (з гарматою ≈ 11 м), ширина ≈ 3,4 м.\nЗверху: велика башта зміщена назад, дуже довга гармата.",
    "рсзв": "Реактивна система залпового вогню на колісному шасі.\nДовжина ≈ 7–12 м, ширина ≈ 2,5–3 м.\nЗверху: кабіна спереду, пакет напрямних на задній частині.",
    "вантажівка": "Військова вантажівка.\nДовжина ≈ 7–9 м, ширина ≈ 2,5 м.\nЗверху: кабіна спереду і кузов/кунг ззаду.",
    "рлс": "Радіолокаційна станція на колісному шасі.\nДовжина ≈ 8–10 м.\nЗверху: кунг з антеною (часто прямокутне полотно або тарілка).",
    "реб": "Комплекс РЕБ на колісному шасі.\nДовжина ≈ 8–10 м.\nЗверху: кунг з антенами/щоглами, поруч генератори.",
    "зрк": "Зенітний ракетний комплекс.\nДовжина ≈ 7–10 м.\nЗверху: пакет ракет або пускові контейнери, РЛС на даху.",
  };
  /* Тип техніки зі слова в назві моделі: «Танк Т-72Б3» → «танк», «Катапульта Ланцет» → «катапульта з БпЛА». */
  const TYPE_ALIASES = {"tank": "танк", "t-72": "танк", "т-72": "танк", "т-80": "танк", "т-90": "танк", "т-62": "танк","катапульт": "катапульта з БпЛА", "ланцет": "катапульта з БпЛА", "гармат": "буксирувана гармата", "гаубиц": "буксирувана гармата",
    "мінмет": "міномет", "вантаж": "вантажівка", "камаз": "вантажівка", "урал": "вантажівка", "бліндаж": "бліндаж / укриття", "укритт": "бліндаж / укриття"};
  function typeOf(name) {
    const n = String(name || "").toLowerCase();
    if (!n.trim()) return "ціль";
    const hit = TYPES.filter((t) => n.includes(t.toLowerCase().split(" ")[0])).sort((a, b) => b.length - a.length)[0];
    if (hit) return hit;
    for (const k of Object.keys(TYPE_ALIASES)) if (n.includes(k)) return TYPE_ALIASES[k];
    return String(name).trim().split(/\s+/)[0];
  }
  const DECOY_TTX = "Надувний / макетний муляж — обманка для розвідки.\nОзнаки зверху: згладжені округлі форми, «надуті» стволи й борти, рівний світлий колір, глянцевий відблиск, немає колії та слідів руху, тінь мʼяка, деталі (люки, сітки, гусениці) не читаються.";
  /* Автотекст (типовий або «муляж») не вважається власним описом моделі — його не зберігаємо, щоб зміна типу/муляжу оновлювала опис. */
  const isAutoTtx = (s) => { const t = String(s || "").trim(); return !t || t === DECOY_TTX || Object.values(TTX_DEFAULT).some((v) => v.trim() === t); };
  const ttxFor = (o, type, decoy) => {
    const own = o && o.ttx && !isAutoTtx(o.ttx) ? o.ttx : "";
    const d = decoy === undefined ? !!(o && o.decoy) : !!decoy;
    return own || (d ? DECOY_TTX : "") || TTX_DEFAULT[String(type || (o && o.type) || "").toLowerCase().trim()] || "";
  };
  const cleanTtx = (s) => (isAutoTtx(s) ? "" : String(s).trim());

  /* ---- головне меню: режими, напрямки, пори року ---- */
  const MODES = {
    game: {id: "game", name: "Ігровий", desc: "Підказка, пропуск і розбір після кожного етапу.", hint: true, skip: true, grid: true, debrief: true, time: 1, misses: null},
    exam: {id: "exam", name: "Іспит", desc: "Без підказок і пропусків. Розбір — у кінці, прохідний бал 80%.", hint: false, skip: false, grid: true, debrief: false, time: 1, misses: null, pass: 80},
    hard: {id: "hard", name: "Хардкор", desc: "Без підказок і сітки, половина часу, перший промах завершує етап.", hint: false, skip: true, grid: false, debrief: true, time: 0.5, misses: 0},
  };
  const REGIONS = ["Північ", "Схід", "Південь", "Крим"];
  const SEASONS = ["Весна", "Літо", "Осінь", "Зима"];
  const REGION_KEYS = {
    "Північ": ["північ", "сум", "харків", "черніг", "київ", "бєлгор", "курськ", "брянськ"],
    "Схід": ["схід", "донец", "донеччин", "луган", "бахмут", "покров", "краматор", "слов'ян", "слов’ян", "куп'ян", "куп’ян", "лиман", "часів яр", "торецьк", "авдіїв", "курахов", "вугледар"],
    "Південь": ["півден", "херсон", "запор", "микола", "одес", "оріх", "каховк", "очаків", "кінбурн"],
    "Крим": ["крим", "севаст", "сімфер", "джанкой", "керч", "євпатор"],
  };
  /* Напрямок етапу: вибраний в адмінці, або впізнаний зі старого тексту напрямку/назви («Сумський» → Північ). */
  const GENERIC = ["північ", "схід", "півден"];   // «Тернувате, схід» у назві — не напрямок, тож ці слова шукаємо лише в полі напрямку
  function region(s) {
    if (REGIONS.includes(s.direction)) return s.direction;
    const d = String(s.direction || "").toLowerCase(), t = String(s.title || "").toLowerCase();
    return REGIONS.find((r) => REGION_KEYS[r].some((k) => d.includes(k))) ||
      REGIONS.find((r) => REGION_KEYS[r].some((k) => !GENERIC.includes(k) && t.includes(k))) || "";
  }
  function regionOf(text) { return region({direction: text}); }

  function pickRounds(stages, n) {
    const pool = stages.filter((s) => s.targets && s.targets.some((t) => !t.decoy)).slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
  }

  function hitTest(targets, found, x, y) {
    let best = null, bestD = Infinity;
    targets.forEach((t, i) => {
      if (found.has(i)) return;
      const d = Math.hypot(x - t.x, y - t.y);
      if (d <= (t.r || 14) && d < bestD) { best = i; bestD = d; }
    });
    return best;
  }

  const roundScore = (total, found) => (total && found === total ? 10 : 0);

  /* Звання за відсотком балів гри */
  const RANKS = [
    {min: 0, name: "Курсант"}, {min: 40, name: "Спостерігач"}, {min: 60, name: "Оператор розвідки"},
    {min: 75, name: "Старший оператор розвідки"}, {min: 90, name: "Аналітик аеророзвідки"}, {min: 100, name: "Майстер повітряної розвідки"},
  ];
  function rank(pct) {
    let level = 0;
    RANKS.forEach((r, i) => { if (pct >= r.min) level = i; });
    return {level, name: RANKS[level].name, next: RANKS[level + 1] || null};
  }
  /* Бейдж: щит з шевронами (1–5) або зірка для найвищого */
  function rankBadge(level) {
    const col = ["#6f7b85", "#9aa8b2", "#ffb23e", "#d9c24a", "#e8a84a", "#f0d060"][level];
    let inner = "";
    if (level === 5) inner = `<path d="M40 22l5.3 10.8 11.9 1.7-8.6 8.4 2 11.8L40 49.1l-10.6 5.6 2-11.8-8.6-8.4 11.9-1.7z" fill="${col}"/>`;
    else for (let i = 0; i <= level; i++) inner += `<path d="M24 ${58 - i * 9}l16-9 16 9" fill="none" stroke="${col}" stroke-width="5" stroke-linejoin="round"/>`;
    return `<svg class="rk-badge" viewBox="0 0 80 88" width="72" height="80" aria-hidden="true"><path d="M40 4l32 10v28c0 20-14 34-32 42C22 76 8 62 8 42V14z" fill="#141814" stroke="${col}" stroke-width="3"/>${inner}</svg>`;
  }

  function conclusion(total, max) {
    const pct = max ? 100 * total / max : 0;
    if (pct >= 80) return "Відмінно";
    if (pct >= 60) return "Добре";
    if (pct >= 40) return "Задовільно";
    return "Незадовільно";
  }

  const normSquare = (s) => (s || "").toUpperCase().replace(/[\s.\-]/g, "").replace(/[АВСЕНКМРТХ]/g, (c) => CYR2LAT[c]);

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /* Варіанти відповіді: правильна + до n-1 інших (без повторів), у випадковому порядку. */
  function options(right, pool, n = 4) {
    const others = shuffle([...new Set(pool.filter((v) => v && normText(v) !== normText(right)))]).slice(0, n - 1);
    return shuffle([right, ...others]);
  }
  const normText = (s) => (s || "").toLowerCase().replace(/[«»"]/g, "").replace(/\s+/g, " ").trim();

  function evalReport(t, squareTrue, rep) {
    const checks = [["тип", normText(rep.type) === normText(t.type), t.type || ""]];
    if (rep.square !== undefined) checks.push(["квадрат", normSquare(rep.square) === squareTrue, squareTrue]);
    if (t.landmark) checks.push(["орієнтир", normText(rep.landmark) === normText(t.landmark), t.landmark]);
    return {ok: checks.filter((c) => c[1]).length, total: checks.length, checks};
  }

  window.Logic = {MODES, REGIONS, SEASONS, region, regionOf, rank, rankBadge, RANKS, TTX_DEFAULT, ttxFor, isAutoTtx, cleanTtx, typeOf, LANDMARKS, SIGNS, TYPES, options, shuffle, pickRounds, hitTest, roundScore, conclusion, normSquare, evalReport};
})();
