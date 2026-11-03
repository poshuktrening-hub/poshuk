/* Сонце над Україною: висота й азимут за порою року та часом доби → куди падає тінь і яка вона довга.
   Використовується генератором, автонакладанням і «Оновити етапи», щоб тіні техніки відповідали знімку:
   довжина тіні = висота техніки / tg(висоти сонця) / масштаб знімка. */
(function () {
  const LAT = 48.5, LON = 31.5;   // центр України; місцевий час — Київ (UTC+2 взимку, +3 влітку)
  const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;

  /* Типова дата пори року й типова година доби (місцевий час). */
  const SEASON_DAY = {"Весна": [4, 20], "Літо": [7, 10], "Осінь": [10, 10], "Зима": [1, 20]};
  const TIME_HOUR = {"Ранок": 8.5, "День": 12.5, "Вечір": 16.5, "Ніч": 1};
  const SEASONS = Object.keys(SEASON_DAY), TIMES = Object.keys(TIME_HOUR);

  /* Висота (elev) і азимут (az, від півночі за годинниковою) сонця для дати й місцевої години (спрощений алгоритм NOAA, ±1°). */
  function pos(month, day, hour, lat = LAT, lon = LON) {
    const y = 2025, n = Math.floor((275 * month) / 9) - 2 * Math.floor((month + 9) / 12) + day - 30;   // день року
    const dst = month >= 4 && month <= 10 ? 3 : 2, utc = hour - dst;
    const g = 2 * Math.PI / 365 * (n - 1 + (utc - 12) / 24);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const tst = (utc * 60 + eqt + 4 * lon) % 1440, ha = rad(tst / 4 - 180);
    const phi = rad(lat);
    const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
    const zen = Math.acos(Math.max(-1, Math.min(1, cosZ))), elev = 90 - deg(zen);
    let az = deg(Math.acos(Math.max(-1, Math.min(1, ((Math.sin(phi) * Math.cos(zen)) - Math.sin(decl)) / (Math.cos(phi) * Math.sin(zen))))));
    az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
    void y;
    return {elev, az, shadowDir: (az + 180) % 360};
  }
  const forPreset = (season, time) => { const [m, d] = SEASON_DAY[season] || SEASON_DAY["Літо"]; return pos(m, d, TIME_HOUR[time] === undefined ? 12.5 : TIME_HOUR[time]); };

  /* Висота техніки (м) за типом — для довжини тіні. */
  const HEIGHT = [[/танк|бмпт/i, 2.3], [/бмд/i, 2.1], [/бмп|мт-лб|мтлб/i, 2.3], [/бтр|брдм/i, 2.5], [/сау|мста|гвоздик|акац|гіацинт|2с/i, 3.0],
    [/град|ураган|смерч|торнадо|рсзв/i, 3.1], [/урал|камаз|краз|зіл|газ|вантаж|мто/i, 3.0], [/бук|тор|панцир|с-300|зрк|рлс|реб/i, 3.4], [/катап|ланцет/i, 1.6]];
  const heightOf = (name, len) => { const h = (HEIGHT.find(([re]) => re.test(String(name || ""))) || [])[1]; return h || Math.max(1.6, Math.min(3.2, (len || 7) * 0.33)); };

  /* Довжина тіні на знімку (пкс). Сонце нижче 8° — тінь обмежуємо (інакше вона довша за знімок). */
  function shadowLen(heightM, elevDeg, gsd) {
    const e = Math.max(8, Math.min(85, elevDeg || 45));
    const m = heightM / Math.tan(rad(e));
    return gsd > 0 ? Math.min(60, m / gsd) : Math.min(40, Math.max(2, m));
  }
  /* Теплота світла за часом доби: ранок/вечір — тепліше і м'якше, день — нейтрально (−1…1). */
  const warmth = (time, elev) => (time === "Ніч" ? 0 : elev !== undefined && elev < 20 ? 0.7 : time === "Ранок" || time === "Вечір" ? 0.5 : 0);

  window.Sun = {pos, forPreset, shadowLen, heightOf, warmth, SEASONS, TIMES, SEASON_DAY, TIME_HOUR};
})();
