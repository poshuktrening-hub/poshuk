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
  const ttxFor = (o, type) => (o && o.ttx) || TTX_DEFAULT[String(type || (o && o.type) || "").toLowerCase().trim()] || "";

  function pickRounds(stages, n) {
    const pool = stages.filter((s) => s.targets && s.targets.length).slice();
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

  window.Logic = {TTX_DEFAULT, ttxFor, LANDMARKS, SIGNS, TYPES, options, shuffle, pickRounds, hitTest, roundScore, conclusion, normSquare, evalReport};
})();
