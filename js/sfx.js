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

  /* Вибух: тріск детонації + низький удар + «тіло» вибуху з падаючим фільтром + гуркіт + уламки. */
  let master = null;
  function bus() {
    const c = ac(); if (!c) return null;
    if (!master) {
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.25;
      master = c.createGain(); master.gain.value = 0.9; master.connect(comp).connect(c.destination);
    }
    return master;
  }
  const NB = {};   // шумові буфери генеруються один раз — інакше кожен вибух «гальмує» потік на десятки мс
  function noiseBuf(c, dur, brown) {
    const key = dur + (brown ? "b" : "w"); if (NB[key]) return NB[key];
    const n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); NB[key] = b;
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  function boom(scale = 1) {
    const c = ac(), out = bus(); if (!c || !on || !out) return;
    const t = c.currentTime + 0.01, v = scale;
    const src = (buf) => { const s = c.createBufferSource(); s.buffer = buf; return s; };
    // 1) тріск детонації
    { const s = src(noiseBuf(c, 0.08)), f = c.createBiquadFilter(), g = c.createGain();
      f.type = "highpass"; f.frequency.value = 1800; g.gain.setValueAtTime(0.9 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      s.connect(f).connect(g).connect(out); s.start(t); }
    // 2) удар: синус, що падає 110 → 32 Гц
    { const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.45);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.0 * v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g).connect(out); o.start(t); o.stop(t + 1); }
    // 3) тіло вибуху: шум через lowpass, що закривається 2400 → 160 Гц
    { const s = src(noiseBuf(c, 1.8)), f = c.createBiquadFilter(), g = c.createGain();
      f.type = "lowpass"; f.Q.value = 0.8; f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(160, t + 1.4);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.8 * v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 1.7);
      s.connect(f).connect(g).connect(out); s.start(t); }
    // 4) гуркіт-відлуння (брунатний шум, довгий хвіст)
    { const s = src(noiseBuf(c, 3.2, true)), f = c.createBiquadFilter(), g = c.createGain();
      f.type = "lowpass"; f.frequency.value = 220;
      g.gain.setValueAtTime(0.0001, t + 0.05); g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + 3.1);
      s.connect(f).connect(g).connect(out); s.start(t + 0.05); }
    // 5) уламки, що падають: короткі клацання
    for (let i = 0; i < 9 * v; i++) {
      const at = t + 0.25 + Math.random() * 1.1, s = src(noiseBuf(c, 0.03)), f = c.createBiquadFilter(), g = c.createGain();
      f.type = "bandpass"; f.frequency.value = 1500 + Math.random() * 3000; f.Q.value = 3;
      g.gain.setValueAtTime(0.12 * Math.random() * v, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
      s.connect(f).connect(g).connect(out); s.start(at);
    }
  }

  const SFX = {
    boom() { boom(1); },
    pop() { boom(0.45); },
    get on() { return on; },
    toggle() { on = !on; try { localStorage.setItem("poshuk_sound", on ? "on" : "off"); } catch (e) { /* ок */ } if (on) SFX.click(); return on; },
    unlock() {
      const c = ac();
      // шум для вибуху — заздалегідь, у вільний час, щоб перше влучання не «гальмувало»
      if (c && !NB._warm) { NB._warm = 1; const w = () => { [[0.08], [1.8], [3.2, true], [0.03]].forEach(([d, b]) => noiseBuf(c, d, b)); bus(); };
        if (window.requestIdleCallback) requestIdleCallback(w, {timeout: 3000}); else setTimeout(w, 800); }
    },
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
