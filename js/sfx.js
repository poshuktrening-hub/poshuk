/* Звуки гри — синтез через Web Audio (без файлів). Вимикач зберігається в браузері. */
(function () {
  let ctx = null, on = true;
  try { on = localStorage.getItem("poshuk_sound") !== "off"; } catch (e) { /* ок */ }

  function ac() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, {type = "sine", vol = 0.15, at = 0, slide = 0} = {}) {
    const c = ac(); if (!c || !on) return;
    const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, {vol = 0.06, at = 0, band = 1800, q = 0.7} = {}) {
    const c = ac(); if (!c || !on) return;
    const t = c.currentTime + at, n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / 900));
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf; f.type = "bandpass"; f.frequency.value = band; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(c.destination); s.start(t);
  }

  const SFX = {
    get on() { return on; },
    toggle() { on = !on; try { localStorage.setItem("poshuk_sound", on ? "on" : "off"); } catch (e) { /* ок */ } if (on) SFX.click(); return on; },
    unlock() { ac(); },
    click() { tone(1400, 0.035, {type: "square", vol: 0.04}); },
    zoom() { tone(520, 0.09, {type: "sine", vol: 0.05, slide: 260}); },
    hit() { tone(660, 0.09, {type: "triangle", vol: 0.16}); tone(990, 0.16, {type: "triangle", vol: 0.16, at: 0.08}); },
    miss() { tone(170, 0.28, {type: "sawtooth", vol: 0.09, slide: -60}); noise(0.12, {vol: 0.04, band: 400}); },
    decoy() { tone(300, 0.12, {type: "square", vol: 0.07}); tone(220, 0.22, {type: "square", vol: 0.07, at: 0.12}); },
    tick(last) { tone(last ? 1250 : 1000, 0.04, {type: "square", vol: last ? 0.07 : 0.045}); },
    timeout() { tone(440, 0.18, {type: "square", vol: 0.08}); tone(330, 0.32, {type: "square", vol: 0.08, at: 0.2}); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, {type: "triangle", vol: 0.12, at: i * 0.1})); },
    /* «Радіоефір» на брифінгу: шум, клацання тангенти, морзянка-сигнал */
    radio() {
      noise(0.08, {vol: 0.08, band: 2500, q: 0.4});
      noise(1.4, {vol: 0.025, band: 1600, q: 0.5, at: 0.08});
      [0, 0.14, 0.28, 0.6, 0.74].forEach((t) => tone(1150, 0.07, {type: "sine", vol: 0.05, at: 0.25 + t}));
      noise(0.08, {vol: 0.08, band: 2500, q: 0.4, at: 1.45});
    },
  };

  window.SFX = SFX;
})();
