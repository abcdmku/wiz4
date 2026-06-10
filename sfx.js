// sfx.js
'use strict';

const SFX = (() => {
  let ac = null, master = null, muted = false;

  function ensure() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = 0.35;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.35; }
  function toggleMute() { setMuted(!muted); return muted; }

  function tone(type, f0, f1, t, dur, vol = 0.5, curve = 'exp') {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(t, dur, vol = 0.4, freq = 1000, q = 1) {
    const len = Math.ceil(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = buf;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  function arp(notes, step, type = 'square', vol = 0.3, dur = null) {
    const t = ac.currentTime;
    notes.forEach((f, i) => tone(type, f, f, t + i * step, dur || step * 1.8, vol));
  }

  const fx = {
    jump()   { tone('square', 240, 540, ac.currentTime, 0.13, 0.25); },
    bounce() { tone('triangle', 140, 760, ac.currentTime, 0.2, 0.5); },
    bottle() { const t = ac.currentTime; tone('sine', 900, 900, t, 0.05, 0.4); tone('sine', 1350, 1350, t + 0.05, 0.08, 0.35); },
    star()   { arp([660, 880, 1175], 0.05, 'square', 0.22); },
    key()    { arp([523, 784, 1046, 1318], 0.055, 'triangle', 0.4); },
    nokey()  { const t = ac.currentTime; tone('square', 130, 98, t, 0.18, 0.3); tone('square', 65, 60, t, 0.18, 0.3); },
    door()   { const t = ac.currentTime; tone('square', 100, 55, t, 0.22, 0.4); noise(t + 0.16, 0.09, 0.3, 300, 2); },
    lever()  { const t = ac.currentTime; noise(t, 0.03, 0.5, 2400, 3); tone('square', 320, 250, t + 0.04, 0.07, 0.3); },
    hit()    { noise(ac.currentTime, 0.12, 0.5, 800, 0.8); },
    die()    { const t = ac.currentTime; tone('sawtooth', 420, 55, t, 0.55, 0.4); tone('square', 210, 40, t, 0.55, 0.25); },
    powerup(){ arp([392, 523, 659, 784, 1046, 1318], 0.07, 'triangle', 0.4); },
    extra()  { arp([523, 659, 784, 1046, 784, 1318], 0.08, 'square', 0.25); },
    checkpoint() { const t = ac.currentTime; tone('sine', 988, 988, t, 0.3, 0.35); tone('sine', 1480, 1480, t + 0.04, 0.34, 0.25); },
    banish() { const t = ac.currentTime; tone('triangle', 1200, 200, t, 0.25, 0.35); noise(t, 0.1, 0.2, 1800, 2); },
    fall()   { tone('sawtooth', 180, 90, ac.currentTime, 0.25, 0.2); },
    title()  { arp([262, 330, 392, 523, 660, 523, 784], 0.1, 'triangle', 0.3); },
  };

  function play(name) {
    if (muted) return;
    try { ensure(); fx[name] && fx[name](); } catch (e) { /* audio unavailable */ }
  }

  return { play, ensure, toggleMute, get muted() { return muted; }, setMuted };
})();
