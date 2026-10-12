/* Правила гри — ті самі, що в локальній версії. */
(function () {
  const LANDMARKS = ["край лісосмуги", "у лісосмузі", "у полі", "біля дороги", "біля будівель",
    "у населеному пункті", "біля водойми", "у промзоні", "інше"];
  const SIGNS = ["тінь", "«мангал»", "колія / сліди", "нетиповий силует", "маскувальна сітка",
    "колір / відблиск", "укриття під кронами", "позиція / окоп"];
  const LAT2CYR = {A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х", I: "І"};

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

  const normSquare = (s) => (s || "").toUpperCase().replace(/[\s.\-]/g, "").replace(/[ABCEHKMOPTXI]/g, (c) => LAT2CYR[c]);
  const normText = (s) => (s || "").toLowerCase().replace(/[«»"]/g, "").replace(/\s+/g, " ").trim();

  function evalReport(t, squareTrue, rep) {
    const checks = [["тип", normText(rep.type) === normText(t.type), t.type || ""],
      ["квадрат", normSquare(rep.square) === squareTrue, squareTrue]];
    if (t.landmark) checks.push(["орієнтир", normText(rep.landmark) === normText(t.landmark), t.landmark]);
    return {ok: checks.filter((c) => c[1]).length, total: checks.length, checks};
  }

  window.Logic = {LANDMARKS, SIGNS, pickRounds, hitTest, roundScore, conclusion, normSquare, evalReport};
})();
