// audio.js — Web Audio FM/칩튠 신디사이저 · 음악 시퀀서 · 효과음
import { TRACKS } from './tracks.js';

const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function midi(name) {
  if (typeof name === 'number') return name;
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) return 60;
  let v = NOTE_BASE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return v + (parseInt(m[3], 10) + 1) * 12;
}
const freqOf = m => 440 * Math.pow(2, (m - 69) / 12);

class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.musicVol = 0.5;
    this.sfxVol = 0.62;
    this.track = null;
    this.trackId = null;
    this.timer = null;
    this.lastSfx = new Map();
    this._noise = null;
    this.listeners = new Set();
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 3.2;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.master.connect(this.comp).connect(c.destination);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.musicVol;
    this.musicBus.connect(this.master);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.master);
    // 백색oise 버퍼
    const len = Math.floor(c.sampleRate * 1.2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    this.ready = true;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(v) {
    this.muted = v;
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(v ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // ── 저수준 합성 ────────────────────────────────────────────────
  _now() { return this.ctx.currentTime; }

  env(g, t0, a, d, s, r, peak = 1, dur = 0.2) {
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.002, a));
    g.gain.linearRampToValueAtTime(peak * s, t0 + Math.max(a + 0.002, d));
    g.gain.setValueAtTime(peak * s, t0 + Math.max(d, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + r);
  }

  noiseSrc(t0, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    return src;
  }

  /** FM 두 연산자 음색 */
  fm(dest, { freq, t0, dur, ratio = 1, index = 2, type = 'sine', attack = 0.01,
             decay = 0.1, sustain = 0.6, release = 0.2, gain = 0.3, detune = 0,
             vibrato = 0, indexEnv = true, glide = 0 }) {
    const c = this.ctx;
    const car = c.createOscillator();
    car.type = type;
    car.frequency.setValueAtTime(freq, t0);
    if (glide) car.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t0 + dur);
    if (detune) car.detune.value = detune;
    const mod = c.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * ratio;
    const mg = c.createGain();
    mg.gain.setValueAtTime(freq * index, t0);
    if (indexEnv) mg.gain.exponentialRampToValueAtTime(Math.max(0.5, freq * index * 0.06), t0 + Math.max(0.05, dur * 0.7));
    mod.connect(mg).connect(car.frequency);
    const g = c.createGain();
    this.env(g, t0, attack, decay, sustain, release, gain, dur);
    car.connect(g).connect(dest);
    if (vibrato) {
      const lfo = c.createOscillator();
      lfo.frequency.value = 5.2;
      const lg = c.createGain();
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(car.frequency);
      lfo.start(t0); lfo.stop(t0 + dur + release + 0.1);
    }
    car.start(t0); mod.start(t0);
    car.stop(t0 + dur + release + 0.05);
    mod.stop(t0 + dur + release + 0.05);
    return g;
  }

  // ── 악기 ───────────────────────────────────────────────────────
  voice(name, m, t0, dur, vel = 1, dest = null) {
    if (!this.ready) return;
    const out = dest || this.musicBus;
    const f = freqOf(m);
    const v = Math.max(0.001, vel);
    switch (name) {
      case 'bell': // 종 — 비화성 배음 두 겹
        this.fm(out, { freq: f, t0, dur: dur * 0.9, ratio: 3.01, index: 3.4, attack: 0.004,
          decay: dur * 0.5, sustain: 0.12, release: dur * 1.5, gain: 0.30 * v });
        this.fm(out, { freq: f * 2.01, t0, dur: dur * 0.6, ratio: 1.51, index: 1.4, attack: 0.003,
          decay: dur * 0.35, sustain: 0.04, release: dur * 1.1, gain: 0.10 * v, type: 'triangle' });
        break;
      case 'bellLow':
        this.fm(out, { freq: f / 2, t0, dur: dur, ratio: 2.01, index: 2.6, attack: 0.006,
          decay: dur * 0.6, sustain: 0.1, release: dur, gain: 0.26 * v });
        break;
      case 'flute':
        this.fm(out, { freq: f, t0, dur, ratio: 1.005, index: 0.55, attack: 0.09, decay: 0.18,
          sustain: 0.72, release: 0.22, gain: 0.20 * v, vibrato: 2.6, type: 'sine' });
        break;
      case 'lute':
        this.fm(out, { freq: f, t0, dur: Math.min(dur, 0.5), ratio: 2.01, index: 2.2,
          attack: 0.003, decay: 0.16, sustain: 0.06, release: 0.22, gain: 0.16 * v, type: 'triangle' });
        break;
      case 'bass':
        this.fm(out, { freq: f, t0, dur, ratio: 1.0, index: 1.1, attack: 0.006, decay: 0.12,
          sustain: 0.75, release: 0.12, gain: 0.26 * v, type: 'square' });
        break;
      case 'organ':
        this.fm(out, { freq: f, t0, dur, ratio: 2.0, index: 1.2, attack: 0.02, decay: 0.2,
          sustain: 0.8, release: 0.25, gain: 0.16 * v, type: 'sine' });
        this.fm(out, { freq: f * 2, t0, dur, ratio: 1.0, index: 0.6, attack: 0.03, decay: 0.2,
          sustain: 0.7, release: 0.25, gain: 0.09 * v, type: 'sine' });
        this.fm(out, { freq: f * 0.5, t0, dur, ratio: 1.0, index: 0.4, attack: 0.04, decay: 0.2,
          sustain: 0.8, release: 0.3, gain: 0.08 * v, type: 'triangle' });
        break;
      case 'pad': {
        const c = this.ctx;
        const g = c.createGain();
        this.env(g, t0, Math.min(0.5, dur * 0.35), dur * 0.3, 0.85, Math.min(1.4, dur * 0.6), 0.115 * v, dur);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1500;
        lp.Q.value = 0.4;
        g.connect(lp).connect(out);
        for (const det of [-7, 6]) {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = det;
          o.connect(g);
          o.start(t0); o.stop(t0 + dur + Math.min(1.4, dur * 0.6) + 0.1);
        }
        break;
      }
      case 'choir':
        this.fm(out, { freq: f, t0, dur, ratio: 1.0, index: 0.35, attack: Math.min(0.6, dur * 0.4),
          decay: 0.3, sustain: 0.85, release: 0.6, gain: 0.13 * v, vibrato: 1.2, type: 'triangle' });
        this.fm(out, { freq: f * 1.005, t0, dur, ratio: 2.0, index: 0.25, attack: 0.4,
          decay: 0.3, sustain: 0.7, release: 0.7, gain: 0.06 * v, type: 'sine' });
        break;
      case 'lead':
        this.fm(out, { freq: f, t0, dur, ratio: 1.0, index: 1.6, attack: 0.008, decay: 0.1,
          sustain: 0.6, release: 0.12, gain: 0.15 * v, type: 'square', vibrato: 3.4 });
        break;
      case 'pulse':
        this.fm(out, { freq: f, t0, dur, ratio: 1.0, index: 0.8, attack: 0.004, decay: 0.08,
          sustain: 0.5, release: 0.08, gain: 0.10 * v, type: 'square' });
        break;
      case 'harp':
        this.fm(out, { freq: f, t0, dur: Math.min(dur, 0.9), ratio: 3.0, index: 1.0,
          attack: 0.002, decay: 0.35, sustain: 0.02, release: 0.5, gain: 0.13 * v, type: 'sine' });
        break;
      case 'timp':
        this.fm(out, { freq: f / 2, t0, dur: 0.35, ratio: 1.4, index: 1.6, attack: 0.002,
          decay: 0.18, sustain: 0.02, release: 0.5, gain: 0.3 * v, type: 'sine', glide: 0.75 });
        this.noise(dest || out, t0, 0.12, 180, 90, 1.2, 0.10 * v, 'lowpass');
        break;
      case 'drum': {
        const kind = arguments[6] || 'kick';
        this.drum(dest || out, t0, kind, v);
        break;
      }
      default:
        this.fm(out, { freq: f, t0, dur, ratio: 1, index: 1, attack: 0.005, decay: 0.1,
          sustain: 0.5, release: 0.15, gain: 0.12 * v, type: 'square' });
    }
  }

  drum(out, t0, kind, v = 1) {
    const c = this.ctx;
    switch (kind) {
      case 'kick':
        this.fm(out, { freq: 118, t0, dur: 0.10, ratio: 1, index: 0.5, attack: 0.001, decay: 0.05,
          sustain: 0.02, release: 0.12, gain: 0.34 * v, type: 'sine', glide: 0.42 });
        break;
      case 'snare':
        this.noise(out, t0, 0.12, 1800, 900, 0.8, 0.15 * v, 'bandpass');
        this.fm(out, { freq: 210, t0, dur: 0.05, ratio: 1.4, index: 0.6, attack: 0.001,
          decay: 0.03, sustain: 0.01, release: 0.06, gain: 0.10 * v, type: 'triangle', glide: 0.7 });
        break;
      case 'hat':
        this.noise(out, t0, 0.035, 9000, 7000, 1.2, 0.055 * v, 'highpass');
        break;
      case 'openhat':
        this.noise(out, t0, 0.22, 8000, 6000, 1.0, 0.045 * v, 'highpass');
        break;
      case 'tom':
        this.fm(out, { freq: 170, t0, dur: 0.14, ratio: 1.1, index: 0.9, attack: 0.001,
          decay: 0.09, sustain: 0.02, release: 0.16, gain: 0.22 * v, type: 'sine', glide: 0.7 });
        break;
      case 'crash':
        this.noise(out, t0, 0.7, 6000, 3200, 0.7, 0.09 * v, 'highpass');
        break;
      case 'shaker':
        this.noise(out, t0, 0.06, 7000, 5000, 1.5, 0.035 * v, 'bandpass');
        break;
      default:
        this.noise(out, t0, 0.06, 3000, 1500, 1, 0.05 * v, 'bandpass');
    }
  }

  noise(out, t0, dur, f0, f1, q, gain, type = 'bandpass') {
    const c = this.ctx;
    const src = this.noiseSrc(t0, dur);
    const flt = c.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f0, t0);
    flt.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t0 + dur);
    flt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.01, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt).connect(g).connect(out);
  }

  // ── 음악 ───────────────────────────────────────────────────────
  playMusic(id, { fade = 0.6 } = {}) {
    if (!this.ready) return;
    if (this.trackId === id && this.timer) return;
    this.stopMusic(fade);
    const def = TRACKS.find(t => t.id === id);
    if (!def) return;
    const score = def.build();
    const c = this.ctx;
    const bus = c.createGain();
    bus.gain.value = 0.0001;
    bus.connect(this.musicBus);
    bus.gain.linearRampToValueAtTime(def.gain ?? 1, c.currentTime + fade);
    const spb = 60 / def.bpm;
    const loopBeats = def.loopBeats;
    const loopDur = loopBeats * spb;
    const evs = score.events
      .map(e => ({ ...e, at: (e.beat % loopBeats) * spb }))
      .sort((a, b) => a.at - b.at);
    const t = { id, bus, def, spb, loopBeats, loopDur, evs, idx: 0, loop: 0, start: c.currentTime + 0.12 };
    this.track = t;
    this.trackId = id;
    this.listeners.forEach(f => f(id));
    const tick = () => {
      if (!this.track || this.track !== t) return;
      const now = this.ctx.currentTime;
      const horizon = now + 0.35;
      let guard = 0;
      while (guard++ < 400) {
        const base = t.start + t.loop * t.loopDur;
        if (t.idx >= t.evs.length) { t.idx = 0; t.loop++; continue; }
        const e = t.evs[t.idx];
        const when = base + e.at;
        if (when > horizon) break;
        if (when >= now - 0.05) {
          const v = e.voice;
          try {
            if (v === 'drum' || v === 'timp') {
              if (v === 'drum') this.drum(t.bus, when, e.kind || 'kick', e.vel ?? 1);
              else { this.voice('timp', e.note, when, 0.35, e.vel ?? 1, t.bus); }
            } else {
              this.voice(v, e.note, when, Math.max(0.05, e.dur * t.spb), e.vel ?? 1, t.bus);
            }
          } catch (err) { /* 재생 실패는 무시 */ }
        }
        t.idx++;
      }
    };
    this.timer = setInterval(tick, 60);
    tick();
  }

  stopMusic(fade = 0.5) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const t = this.track;
    this.track = null;
    this.trackId = null;
    if (t && this.ready) {
      const now = this.ctx.currentTime;
      t.bus.gain.cancelScheduledValues(now);
      t.bus.gain.setValueAtTime(Math.max(0.0001, t.bus.gain.value), now);
      t.bus.gain.exponentialRampToValueAtTime(0.0001, now + fade);
      setTimeout(() => { try { t.bus.disconnect(); } catch (e) {} }, (fade + 0.4) * 1000);
    }
    this.listeners.forEach(f => f(null));
  }

  onTrackChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // ── 효과음 ─────────────────────────────────────────────────────
  sfx(name, vol = 1) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    const last = this.lastSfx.get(name) || 0;
    if (now - last < 0.028) return;
    this.lastSfx.set(name, now);
    const out = this.sfxBus;
    const t = now + 0.005;
    const v = vol;
    const [base, arg] = String(name).split(':');
    switch (base) {
      // 걸음 — 지형별
      case 'step_grass':
        this.noise(out, t, 0.055, 2200, 700, 0.7, 0.10 * v, 'bandpass');
        this.fm(out, { freq: 130, t0: t, dur: 0.03, ratio: 1, index: 0.6, attack: 0.001,
          decay: 0.02, sustain: 0.01, release: 0.04, gain: 0.05 * v, type: 'triangle' });
        break;
      case 'step_stone':
        this.noise(out, t, 0.045, 3400, 1400, 1.4, 0.11 * v, 'bandpass');
        this.fm(out, { freq: 320, t0: t, dur: 0.02, ratio: 2.2, index: 1.2, attack: 0.001,
          decay: 0.015, sustain: 0.01, release: 0.03, gain: 0.05 * v, type: 'square' });
        break;
      case 'step_wood':
        this.noise(out, t, 0.05, 1400, 500, 1.1, 0.08 * v, 'bandpass');
        this.fm(out, { freq: 168, t0: t, dur: 0.05, ratio: 1.5, index: 1.0, attack: 0.001,
          decay: 0.04, sustain: 0.02, release: 0.07, gain: 0.09 * v, type: 'sine', glide: 0.8 });
        break;
      case 'step_ash':
        this.noise(out, t, 0.09, 900, 300, 0.6, 0.075 * v, 'lowpass');
        break;
      case 'step':
        this.noise(out, t, 0.05, 1800, 800, 0.8, 0.09 * v, 'bandpass');
        break;
      // 공격 · 검격
      case 'swing':
        this.noise(out, t, 0.13, 5200, 900, 0.9, 0.16 * v, 'bandpass');
        this.fm(out, { freq: 900, t0: t, dur: 0.09, ratio: 1, index: 1.2, attack: 0.002,
          decay: 0.05, sustain: 0.05, release: 0.08, gain: 0.05 * v, type: 'sine', glide: 0.35 });
        break;
      case 'attack':
        this.noise(out, t, 0.16, 6000, 700, 0.85, 0.19 * v, 'bandpass');
        this.fm(out, { freq: 620, t0: t, dur: 0.10, ratio: 1.5, index: 2.2, attack: 0.001,
          decay: 0.06, sustain: 0.02, release: 0.12, gain: 0.09 * v, type: 'sawtooth', glide: 0.28 });
        break;
      case 'attack_heavy':
        this.noise(out, t, 0.22, 3800, 400, 0.7, 0.20 * v, 'bandpass');
        this.fm(out, { freq: 240, t0: t, dur: 0.18, ratio: 1.2, index: 2.8, attack: 0.001,
          decay: 0.09, sustain: 0.02, release: 0.2, gain: 0.16 * v, type: 'square', glide: 0.35 });
        break;
      case 'hit':
        this.noise(out, t, 0.09, 2600, 500, 0.9, 0.15 * v, 'bandpass');
        this.fm(out, { freq: 300, t0: t, dur: 0.07, ratio: 1, index: 2.0, attack: 0.001,
          decay: 0.04, sustain: 0.02, release: 0.1, gain: 0.10 * v, type: 'square', glide: 0.4 });
        break;
      case 'hit_heavy':
        this.noise(out, t, 0.14, 1800, 250, 0.8, 0.20 * v, 'lowpass');
        this.fm(out, { freq: 160, t0: t, dur: 0.14, ratio: 1.1, index: 2.4, attack: 0.001,
          decay: 0.06, sustain: 0.02, release: 0.2, gain: 0.18 * v, type: 'sine', glide: 0.35 });
        break;
      // 마법 — 속성별 공명 아르페지오 + 종 차임
      case 'magic': case 'magic_cast': {
        const el = arg || 'sound';
        const scale = { fire: [0, 4, 7, 12], water: [0, 3, 7, 10], wind: [0, 5, 7, 12],
          earth: [0, 2, 7, 12], light: [0, 4, 7, 11], sound: [0, 7, 12, 19], thunder: [0, 6, 7, 13] }[el] || [0, 4, 7, 12];
        const root = { fire: 62, water: 57, wind: 64, earth: 50, light: 67, sound: 60, thunder: 45 }[el] || 60;
        scale.forEach((s, i) => {
          this.fm(out, { freq: freqOf(root + s + 12), t0: t + i * 0.055, dur: 0.14,
            ratio: 2.4, index: 2.2, attack: 0.002, decay: 0.1, sustain: 0.05,
            release: 0.55, gain: 0.085 * v, type: 'sine' });
        });
        this.noise(out, t, 0.3, 1200, 5000, 0.6, 0.045 * v, 'bandpass');
        break;
      }
      case 'magic_impact': {
        const el = arg || 'sound';
        const root = { fire: 62, water: 57, wind: 64, earth: 50, light: 67, sound: 60, thunder: 45 }[el] || 60;
        this.fm(out, { freq: freqOf(root + 12), t0: t, dur: 0.3, ratio: 3.1, index: 3.2,
          attack: 0.002, decay: 0.18, sustain: 0.06, release: 0.7, gain: 0.13 * v, type: 'sine' });
        this.noise(out, t, 0.35, 4000, 300, 0.6, 0.10 * v, 'bandpass');
        break;
      }
      // 방어 · 회피 · 도망
      case 'defend':
        this.fm(out, { freq: 1480, t0: t, dur: 0.12, ratio: 1.41, index: 3.0, attack: 0.001,
          decay: 0.08, sustain: 0.02, release: 0.22, gain: 0.11 * v, type: 'square' });
        this.noise(out, t, 0.10, 5200, 2600, 2.2, 0.10 * v, 'bandpass');
        this.fm(out, { freq: 320, t0: t, dur: 0.1, ratio: 1, index: 1.2, attack: 0.001,
          decay: 0.06, sustain: 0.02, release: 0.12, gain: 0.10 * v, type: 'triangle' });
        break;
      case 'evade':
        this.noise(out, t, 0.2, 700, 6500, 1.1, 0.10 * v, 'bandpass');
        break;
      case 'flee':
        for (let i = 0; i < 4; i++) this.noise(out, t + i * 0.07, 0.05, 2400 + i * 300, 900, 0.9, 0.06 * v, 'bandpass');
        this.fm(out, { freq: 500, t0: t + 0.1, dur: 0.5, ratio: 1, index: 1.2, attack: 0.03,
          decay: 0.2, sustain: 0.4, release: 0.3, gain: 0.05 * v, type: 'sine', glide: 2.4 });
        break;
      case 'flee_fail':
        this.fm(out, { freq: 320, t0: t, dur: 0.18, ratio: 1, index: 1.4, attack: 0.005,
          decay: 0.1, sustain: 0.3, release: 0.2, gain: 0.08 * v, type: 'square', glide: 0.6 });
        this.fm(out, { freq: 240, t0: t + 0.12, dur: 0.22, ratio: 1, index: 1.4, attack: 0.005,
          decay: 0.1, sustain: 0.3, release: 0.25, gain: 0.08 * v, type: 'square', glide: 0.55 });
        break;
      // 도구
      case 'item': case 'item_heal': {
        const notes = [72, 76, 79, 84];
        notes.forEach((m, i) => this.fm(out, { freq: freqOf(m), t0: t + i * 0.06, dur: 0.18,
          ratio: 2.0, index: 1.4, attack: 0.002, decay: 0.14, sustain: 0.05, release: 0.6,
          gain: 0.075 * v, type: 'sine' }));
        this.noise(out, t, 0.28, 3000, 8000, 0.6, 0.03 * v, 'bandpass');
        break;
      }
      case 'item_food':
        this.noise(out, t, 0.12, 900, 400, 0.8, 0.08 * v, 'lowpass');
        this.fm(out, { freq: 220, t0: t, dur: 0.12, ratio: 1.2, index: 1.0, attack: 0.002,
          decay: 0.06, sustain: 0.05, release: 0.15, gain: 0.07 * v, type: 'triangle' });
        break;
      case 'item_drink':
        for (let i = 0; i < 3; i++) this.fm(out, { freq: freqOf(70 + [0, 2, 5][i]), t0: t + i * 0.08,
          dur: 0.1, ratio: 1.5, index: 1.2, attack: 0.004, decay: 0.08, sustain: 0.05,
          release: 0.2, gain: 0.07 * v, type: 'sine' });
        break;
      case 'item_revive':
        [0, 4, 7, 12, 16].forEach((s, i) => this.fm(out, { freq: freqOf(64 + s), t0: t + i * 0.08,
          dur: 0.3, ratio: 2.6, index: 1.8, attack: 0.003, decay: 0.2, sustain: 0.08,
          release: 1.0, gain: 0.08 * v, type: 'sine' }));
        break;
      // 종
      case 'bell':
        this.fm(out, { freq: 440, t0: t, dur: 1.4, ratio: 3.01, index: 4.0, attack: 0.002,
          decay: 0.7, sustain: 0.10, release: 2.4, gain: 0.26 * v, type: 'sine' });
        this.fm(out, { freq: 440 * 2.4, t0: t, dur: 0.9, ratio: 1.41, index: 2.0, attack: 0.002,
          decay: 0.4, sustain: 0.04, release: 1.6, gain: 0.10 * v, type: 'sine' });
        this.fm(out, { freq: 220, t0: t, dur: 1.2, ratio: 2.0, index: 2.2, attack: 0.004,
          decay: 0.6, sustain: 0.08, release: 2.0, gain: 0.12 * v, type: 'sine' });
        break;
      case 'bell_small':
        this.fm(out, { freq: 880, t0: t, dur: 0.4, ratio: 2.4, index: 2.4, attack: 0.002,
          decay: 0.2, sustain: 0.05, release: 0.9, gain: 0.10 * v, type: 'sine' });
        break;
      // 글자 · 커서
      case 'blip': {
        const p = arg ? parseFloat(arg) : 0;
        const m = 78 + (isNaN(p) ? 0 : Math.floor(p * 6));
        this.fm(out, { freq: freqOf(m), t0: t, dur: 0.02, ratio: 1, index: 1.0,
          attack: 0.001, decay: 0.01, sustain: 0.3, release: 0.03, gain: 0.05 * v, type: 'square' });
        break;
      }
      case 'blip_narr':
        this.fm(out, { freq: freqOf(69), t0: t, dur: 0.025, ratio: 1, index: 0.8,
          attack: 0.001, decay: 0.012, sustain: 0.3, release: 0.05, gain: 0.035 * v, type: 'triangle' });
        break;
      case 'cursor':
        this.fm(out, { freq: freqOf(84), t0: t, dur: 0.03, ratio: 1, index: 0.6,
          attack: 0.001, decay: 0.015, sustain: 0.2, release: 0.05, gain: 0.045 * v, type: 'square' });
        break;
      case 'confirm':
        this.fm(out, { freq: freqOf(79), t0: t, dur: 0.05, ratio: 1, index: 0.9,
          attack: 0.001, decay: 0.03, sustain: 0.2, release: 0.08, gain: 0.06 * v, type: 'square' });
        this.fm(out, { freq: freqOf(86), t0: t + 0.05, dur: 0.09, ratio: 1, index: 0.9,
          attack: 0.001, decay: 0.04, sustain: 0.2, release: 0.12, gain: 0.055 * v, type: 'square' });
        break;
      case 'cancel':
        this.fm(out, { freq: freqOf(74), t0: t, dur: 0.05, ratio: 1, index: 0.9,
          attack: 0.001, decay: 0.03, sustain: 0.2, release: 0.06, gain: 0.055 * v, type: 'square' });
        this.fm(out, { freq: freqOf(69), t0: t + 0.05, dur: 0.08, ratio: 1, index: 0.9,
          attack: 0.001, decay: 0.04, sustain: 0.2, release: 0.1, gain: 0.05 * v, type: 'square' });
        break;
      case 'pop':
        this.fm(out, { freq: freqOf(88), t0: t, dur: 0.04, ratio: 2, index: 1.0,
          attack: 0.001, decay: 0.02, sustain: 0.1, release: 0.06, gain: 0.05 * v, type: 'sine' });
        break;
      // 승리 · 레벨업
      case 'victory': {
        const seq = [[67, 0], [72, 0.12], [76, 0.24], [79, 0.36], [84, 0.52], [79, 0.68], [84, 0.78]];
        seq.forEach(([m, dt]) => {
          this.fm(out, { freq: freqOf(m), t0: t + dt, dur: 0.22, ratio: 1.0, index: 1.4,
            attack: 0.004, decay: 0.1, sustain: 0.5, release: 0.35, gain: 0.09 * v, type: 'square' });
          this.fm(out, { freq: freqOf(m - 12), t0: t + dt, dur: 0.2, ratio: 1.0, index: 0.8,
            attack: 0.006, decay: 0.1, sustain: 0.5, release: 0.3, gain: 0.055 * v, type: 'triangle' });
        });
        this.noise(out, t + 0.78, 0.5, 6000, 2500, 0.7, 0.05 * v, 'highpass');
        break;
      }
      case 'levelup':
        [0, 4, 7, 12, 16, 19].forEach((s, i) => this.fm(out, { freq: freqOf(72 + s), t0: t + i * 0.07,
          dur: 0.25, ratio: 2.0, index: 1.6, attack: 0.003, decay: 0.15, sustain: 0.1,
          release: 0.6, gain: 0.08 * v, type: 'sine' }));
        break;
      // UI
      case 'ui_open':
        this.fm(out, { freq: 520, t0: t, dur: 0.08, ratio: 1, index: 1.2, attack: 0.004,
          decay: 0.05, sustain: 0.2, release: 0.12, gain: 0.05 * v, type: 'triangle', glide: 1.8 });
        break;
      case 'ui_close':
        this.fm(out, { freq: 720, t0: t, dur: 0.08, ratio: 1, index: 1.2, attack: 0.004,
          decay: 0.05, sustain: 0.2, release: 0.12, gain: 0.05 * v, type: 'triangle', glide: 0.55 });
        break;
      case 'ui_take':
        this.fm(out, { freq: freqOf(76), t0: t, dur: 0.07, ratio: 2, index: 1.2, attack: 0.002,
          decay: 0.05, sustain: 0.1, release: 0.15, gain: 0.06 * v, type: 'sine' });
        this.fm(out, { freq: freqOf(83), t0: t + 0.06, dur: 0.12, ratio: 2, index: 1.2,
          attack: 0.002, decay: 0.06, sustain: 0.1, release: 0.3, gain: 0.06 * v, type: 'sine' });
        break;
      case 'ui_join':
        [64, 67, 71, 76].forEach((m, i) => this.fm(out, { freq: freqOf(m), t0: t + i * 0.09,
          dur: 0.22, ratio: 1.5, index: 1.2, attack: 0.006, decay: 0.12, sustain: 0.4,
          release: 0.4, gain: 0.075 * v, type: 'triangle' }));
        break;
      case 'ui_coin':
        this.fm(out, { freq: freqOf(88), t0: t, dur: 0.05, ratio: 3, index: 1.4, attack: 0.001,
          decay: 0.03, sustain: 0.1, release: 0.2, gain: 0.06 * v, type: 'square' });
        this.fm(out, { freq: freqOf(95), t0: t + 0.05, dur: 0.12, ratio: 3, index: 1.2,
          attack: 0.001, decay: 0.05, sustain: 0.1, release: 0.3, gain: 0.05 * v, type: 'square' });
        break;
      case 'ui_get_stone':
        this.fm(out, { freq: 660, t0: t, dur: 0.6, ratio: 3.01, index: 3.0, attack: 0.002,
          decay: 0.3, sustain: 0.08, release: 1.4, gain: 0.12 * v, type: 'sine' });
        [0, 7, 12].forEach((s, i) => this.fm(out, { freq: freqOf(72 + s), t0: t + 0.1 + i * 0.09,
          dur: 0.3, ratio: 2.4, index: 1.6, attack: 0.003, decay: 0.2, sustain: 0.06,
          release: 0.8, gain: 0.06 * v, type: 'sine' }));
        break;
      case 'ui_rest':
        [0, 5, 9, 12].forEach((s, i) => this.fm(out, { freq: freqOf(60 + s), t0: t + i * 0.16,
          dur: 0.5, ratio: 1.0, index: 0.6, attack: 0.08, decay: 0.2, sustain: 0.6,
          release: 0.8, gain: 0.07 * v, type: 'sine', vibrato: 1.4 }));
        break;
      case 'ui_bump':
        this.fm(out, { freq: 150, t0: t, dur: 0.06, ratio: 1, index: 1.0, attack: 0.001,
          decay: 0.03, sustain: 0.1, release: 0.08, gain: 0.07 * v, type: 'square', glide: 0.7 });
        break;
      case 'door':
        this.noise(out, t, 0.3, 900, 260, 0.8, 0.10 * v, 'lowpass');
        this.fm(out, { freq: 190, t0: t, dur: 0.28, ratio: 1.2, index: 1.4, attack: 0.01,
          decay: 0.15, sustain: 0.2, release: 0.3, gain: 0.10 * v, type: 'triangle', glide: 0.75 });
        break;
      case 'door_heavy':
        this.noise(out, t, 0.5, 700, 180, 0.7, 0.13 * v, 'lowpass');
        this.fm(out, { freq: 120, t0: t, dur: 0.5, ratio: 1.1, index: 1.8, attack: 0.02,
          decay: 0.3, sustain: 0.2, release: 0.5, gain: 0.14 * v, type: 'sine', glide: 0.7 });
        break;
      case 'encounter':
        this.fm(out, { freq: 220, t0: t, dur: 0.3, ratio: 1, index: 3, attack: 0.004,
          decay: 0.2, sustain: 0.4, release: 0.3, gain: 0.09 * v, type: 'sawtooth', glide: 3.2 });
        break;
      default:
        this.noise(out, t, 0.08, 2000, 800, 1, 0.08 * v, 'bandpass');
    }
  }
}

export const A = new Audio();

/** animations.json · 스킬 정의의 효과음 이름 → 우리 합성음 */
const ALIAS = {
  bt_dash: 'evade', bt_swing: 'swing', bt_hit: 'hit', bt_hit_enemy: 'hit',
  bt_hit_heavy: 'hit_heavy', bt_guard: 'defend', bt_turn: 'cursor', bt_heal: 'item',
  bt_start: 'encounter', bt_flee: 'flee', bt_flee_fail: 'flee_fail', bt_swap: 'ui_open',
  mag_buff: 'magic:light', mag_debuff: 'magic:sound', mag_drain: 'magic:water',
  mag_heal: 'item', mag_revive: 'item_revive',
  sk_bow_draw: 'swing', sk_bow_shot: 'swing', sk_arrow_hit: 'hit', sk_charge: 'magic_cast',
  sk_charge_dark: 'magic_cast', sk_chain: 'swing', sk_quick_stab: 'swing',
  sk_fire_arrow: 'magic:fire', sk_arrow_rain: 'swing', sk_bell_strike: 'attack_heavy',
  sk_steady: 'defend', sk_lullaby: 'magic:sound', sk_rally: 'ui_join', sk_staff: 'swing',
  sk_prayer: 'item', sk_sanctuary: 'item', sk_cleave: 'attack_heavy', sk_resolve: 'defend',
  sk_rend: 'swing',
  es_bite: 'attack', es_peck: 'swing', es_spear: 'attack', es_arrow: 'swing',
  es_heavy_blow: 'attack_heavy', es_shell: 'defend', es_cast: 'magic_cast',
  es_wail: 'magic:sound', es_judgement_cast: 'magic_cast', es_judgement: 'magic:light',
  it_food: 'item_food', it_drink: 'item_drink', it_elixir: 'item', it_feather: 'item_revive',
};

export function playSfx(name, vol = 1) {
  if (!name) return;
  let n = name;
  if (ALIAS[n]) n = ALIAS[n];
  else if (/^mag_cast_/.test(n)) n = 'magic_cast';
  else if (/^magw_/.test(n)) n = 'magic:' + n.slice(5);
  else if (/^mag_/.test(n)) n = 'magic:' + n.slice(4);
  else if (/^fld_step_/.test(n)) n = 'step_' + n.slice(9);
  else if (n === 'fld_bump') n = 'ui_bump';
  else if (n === 'fld_stairs') n = 'step_wood';
  else if (n === 'fld_door_wood') n = 'door';
  else if (n === 'fld_door_heavy') n = 'door_heavy';
  else if (/^ui_text/.test(n)) n = 'blip';
  else if (n === 'ui_page') n = 'pop';
  else if (n === 'ui_talk') n = 'pop';
  else if (/^ui_/.test(n)) n = n; // 그대로
  A.sfx(n, vol);
}

/** 사운드 테스트에 늘어놓을 효과음 목록 */
export const SFX_CATALOG = [
  { id: 'step_grass', name: '발소리 · 풀', desc: '지형별 걷기 — 셀레인 풀길' },
  { id: 'step_stone', name: '발소리 · 돌', desc: '성당·하벨 돌바닥' },
  { id: 'step_wood', name: '발소리 · 나무', desc: '실내 마루·계단' },
  { id: 'step_ash', name: '발소리 · 재', desc: '잿빛 들판의 무른 흙' },
  { id: 'attack', name: '공격', desc: '무기 베기 — 소음 + 피치 하강' },
  { id: 'attack_heavy', name: '강타', desc: '대검·철퇴 내려베기' },
  { id: 'swing', name: '휘두르기', desc: '활 시위·사슬이 바람을 가름' },
  { id: 'hit', name: '피격', desc: '맞았을 때의 둔탁한 틱' },
  { id: 'hit_heavy', name: '강피격', desc: '큰 타격' },
  { id: 'magic_cast', name: '마법 시전', desc: '공명이 모이는 소리' },
  { id: 'magic:fire', name: '불의 울림', desc: '울림석 — 불' },
  { id: 'magic:water', name: '물의 울림', desc: '울림석 — 물' },
  { id: 'magic:wind', name: '바람의 울림', desc: '울림석 — 바람' },
  { id: 'magic:earth', name: '땅의 울림', desc: '울림석 — 땅' },
  { id: 'magic:light', name: '빛의 울림', desc: '울림석 — 빛' },
  { id: 'magic:sound', name: '소리의 울림', desc: '울림석 — 소리' },
  { id: 'magic:thunder', name: '번개의 울림', desc: '울림석 — 번개' },
  { id: 'magic_impact', name: '마법 명중', desc: '주문이 터지는 순간' },
  { id: 'defend', name: '방어', desc: '금속 방패를 세우는 소리' },
  { id: 'evade', name: '회피', desc: '재빠른 스우시' },
  { id: 'flee', name: '도망', desc: '연속 발걸음 + 상승음' },
  { id: 'flee_fail', name: '도망 실패', desc: '길이 막혔다' },
  { id: 'item', name: '도구 사용', desc: '회복의 반짝임' },
  { id: 'item_food', name: '도구 · 음식', desc: '보리빵·스튜' },
  { id: 'item_drink', name: '도구 · 약', desc: '쓴 약초물' },
  { id: 'item_revive', name: '도구 · 부활', desc: '깨우는 깃털' },
  { id: 'bell', name: '성종 울림', desc: '마을의 성종이 울린다' },
  { id: 'bell_small', name: '작은 종', desc: '종추·울림석의 잔향' },
  { id: 'blip', name: '대화 타자음', desc: '한 글자 찍히는 소리' },
  { id: 'blip_narr', name: '나레이션 타자음', desc: '지문용 낮은 타자음' },
  { id: 'cursor', name: '커서 이동', desc: '메뉴 선택 이동' },
  { id: 'confirm', name: '확인', desc: '선택 확정' },
  { id: 'cancel', name: '취소', desc: '되돌아가기' },
  { id: 'ui_open', name: '메뉴 열기', desc: '' },
  { id: 'ui_close', name: '메뉴 닫기', desc: '' },
  { id: 'ui_take', name: '아이템 줍기', desc: '' },
  { id: 'ui_join', name: '동료 합류', desc: '' },
  { id: 'ui_coin', name: '셰켈', desc: '' },
  { id: 'ui_get_stone', name: '울림석 획득', desc: '' },
  { id: 'ui_rest', name: '휴식', desc: '체력 회복' },
  { id: 'victory', name: '승리 팡파레', desc: '전투 승리' },
  { id: 'levelup', name: '레벨 업', desc: '' },
  { id: 'encounter', name: '조우', desc: '필드의 적과 부딪힘' },
  { id: 'door', name: '문', desc: '' },
  { id: 'door_heavy', name: '무거운 문', desc: '성당·성문' },
];
