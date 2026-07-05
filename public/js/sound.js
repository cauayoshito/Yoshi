/* ============================================================
   YOSHI BET — Sons do Yoshi Fortune (WebAudio, zero arquivos)
   Sintetizados na hora: spin, parada de reel, moedas, fanfarra.
   Mute persistido em localStorage.
   ============================================================ */

(() => {
  "use strict";

  const MUTE_KEY = "yoshibet_muted";
  let ctx = null;
  let muted = localStorage.getItem(MUTE_KEY) === "1";

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /** Nota simples: osciladores + envelope. */
  function tone({ freq, time = 0, dur = 0.12, type = "sine", gain = 0.16, slide = 0 }) {
    if (muted) return;
    const a = ac();
    const t0 = a.currentTime + time;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Ruído curto filtrado (whoosh/tick). */
  function noise({ time = 0, dur = 0.2, gain = 0.08, freq = 1200 }) {
    if (muted) return;
    const a = ac();
    const t0 = a.currentTime + time;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    const g = a.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t0);
  }

  const S = {
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
      return muted;
    },

    /** Início do giro: whoosh + ticks acelerando. */
    spin() {
      noise({ dur: 0.35, gain: 0.06, freq: 900 });
      for (let i = 0; i < 8; i++) {
        tone({ freq: 220 + i * 14, time: i * 0.05, dur: 0.03, type: "square", gain: 0.03 });
      }
    },

    /** Parada de uma coluna: thump grave. */
    reelStop(col = 0) {
      tone({ freq: 150 - col * 14, dur: 0.1, type: "sine", gain: 0.2, slide: -70 });
      noise({ dur: 0.05, gain: 0.05, freq: 2400 });
    },

    /** Vitória: arpejo de moedas — mais notas quanto maior o prêmio. */
    win(multiplier = 1) {
      const notes = [523, 659, 784, 1047, 1319, 1568]; // C5 E5 G5 C6 E6 G6
      const count = Math.min(notes.length, 3 + Math.floor(multiplier / 3));
      for (let i = 0; i < count; i++) {
        tone({ freq: notes[i], time: i * 0.09, dur: 0.16, type: "triangle", gain: 0.14 });
        tone({ freq: notes[i] * 2, time: i * 0.09 + 0.02, dur: 0.1, type: "sine", gain: 0.05 });
      }
    },

    /** Multiplicador da feature: fanfarra curta. */
    feature() {
      const seq = [392, 523, 659, 784];
      seq.forEach((f, i) => {
        tone({ freq: f, time: i * 0.11, dur: 0.22, type: "sawtooth", gain: 0.09 });
        tone({ freq: f * 1.5, time: i * 0.11, dur: 0.22, type: "triangle", gain: 0.06 });
      });
      tone({ freq: 1047, time: 0.46, dur: 0.5, type: "triangle", gain: 0.12 });
    },

    /** Free spins: sino místico. */
    freeSpins() {
      [880, 1174, 1568].forEach((f, i) =>
        tone({ freq: f, time: i * 0.14, dur: 0.5, type: "sine", gain: 0.11 })
      );
    },
  };

  window.YoshiSound = S;
})();
