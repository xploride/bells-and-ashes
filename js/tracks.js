// tracks.js — 피클 오리지널 7곡. 90년대 PC-98/DOS(AdLib·OPL) 감성의 FM 칩튠.
// 모든 곡은 코드 진행 + 손으로 쓴 선율로 만든다. 음 하나하나가 이 게임을 위해 쓴 것.
import { midi } from './audio.js';

const M = midi;

class Score {
  constructor() { this.events = []; }
  add(voice, beat, dur, note, vel = 1, extra = {}) {
    this.events.push({ voice, beat, dur, note: M(note), vel, ...extra });
    return this;
  }
  /** 화음 — 여러 음을 같은 자리에 겹친다 */
  chord(voice, beat, dur, notes, vel = 1) {
    for (const n of notes) this.add(voice, beat, dur, n, vel);
    return this;
  }
  /** 아르페지오: notes 를 step 간격으로 훑는다 */
  arp(voice, beat, notes, step, dur, vel = 1, repeat = 1, velFn = null) {
    let i = 0;
    for (let r = 0; r < repeat; r++) {
      for (const n of notes) {
        const v = velFn ? velFn(i) : vel;
        this.add(voice, beat + i * step, dur, n, v);
        i++;
      }
    }
    return this;
  }
  drums(beat, pattern, step = 0.5, vel = 1) {
    pattern.forEach((k, i) => {
      if (!k) return;
      const [kind, v] = Array.isArray(k) ? k : [k, 1];
      this.add('drum', beat + i * step, 0.1, 60, vel * v, { kind });
    });
    return this;
  }
  /** 한 마디를 16분음표로 채우는 드럼 헬퍼 */
  beatDrums(bar, bars, step, fn) {
    for (let b = 0; b < bars; b++) {
      const arr = fn(b);
      this.drums(bar + b * step * arr.length, arr, step);
    }
  }
}

// ── 공통 화음 ───────────────────────────────────────────────────────
const CH = {
  Dm: [50, 57, 62], Dm7: [50, 57, 60, 65], Bb: [46, 53, 58], F: [41, 53, 57, 60],
  C: [48, 55, 60], Gm: [43, 50, 55], A: [45, 52, 57], Am: [45, 52, 57],
  Em: [40, 47, 52], Cmaj: [48, 52, 55], Fmaj7: [41, 53, 57, 64], G: [43, 50, 55],
  Cm: [48, 55, 60], Ab: [44, 51, 56], Fm: [41, 48, 53], G7: [43, 50, 53, 59],
  B7: [47, 51, 54, 57], E: [40, 47, 52, 56], D: [50, 57, 62],
};

// ── 1. 타이틀 — 침묵 위의 첫 울림 ──────────────────────────────────
const title = () => {
  const s = new Score();
  const prog = [CH.Dm, CH.Bb, CH.F, CH.C, CH.Dm, CH.Gm, CH.A, CH.A];
  prog.forEach((c, i) => {
    const b = i * 8;
    s.chord('pad', b, 8, c.slice(1).map(n => n + 12), 0.8);
    if (i >= 4) s.chord('choir', b, 8, c.slice(1).map(n => n + 12), 0.55);
    s.add('bass', b, 3.6, c[0] - 12, 0.85);
    s.add('bass', b + 4, 3.4, c[0] - 12, 0.7);
    // 종 아르페지오 — 두 옥타브 위에서 천천히
    const bellNotes = [c[1], c[2], c[1] + 12, c[2] + 12];
    s.arp('bell', b, bellNotes, 1, 1.6, 0.55, 2, i => (i % 4 === 0 ? 0.8 : 0.45));
    s.add('bellLow', b, 2.5, c[0], 0.5);
  });
  // 선율 — 낮게 시작해 종루 위로 올라간다
  const mel = [
    [0, 3, 'D5'], [3, 1, 'F5'], [4, 2, 'E5'], [6, 2, 'D5'],
    [8, 2, 'F5'], [10, 2, 'D5'], [12, 4, 'Bb4'],
    [16, 3, 'A4'], [19, 1, 'C5'], [20, 4, 'D5'],
    [24, 3, 'E5'], [27, 1, 'C5'], [28, 4, 'A4'],
    [32, 2, 'D5'], [34, 2, 'F5'], [36, 4, 'A5'],
    [40, 3, 'G5'], [43, 1, 'F5'], [44, 4, 'D5'],
    [48, 4, 'E5'], [52, 2, 'C#5'], [54, 2, 'E5'],
    [56, 7, 'D5'],
  ];
  mel.forEach(([b, d, n], i) => {
    s.add('flute', b, d * 0.95, n, 0.9);
    s.add('bell', b, Math.min(d, 2) * 1.4, n, 0.32);
  });
  return s;
};

// ── 2. 셀레인 마을 — 재가 닿지 않은 종루 ───────────────────────────
const selain = () => {
  const s = new Score();
  const prog = [CH.F, CH.F, CH.Bb, CH.C, CH.F, CH.Dm, CH.Bb, CH.C,
                CH.F, CH.Bb, CH.Gm, CH.C, CH.F, CH.Dm, CH.Bb, CH.C];
  prog.forEach((c, i) => {
    const b = i * 4;
    s.chord('pad', b, 3.9, c.map(n => n + 12), 0.42);
    s.add('bass', b, 1.8, c[0] - 12, 0.8);
    s.add('bass', b + 2, 1.8, c[0] - 5, 0.7);
    // 류트 반주 — 팔분음표 아르페지오
    const arp = [c[0], c[1], c[2], c[1] + 12, c[2], c[1], c[0] + 12, c[1]];
    arp.forEach((n, k) => s.add('lute', b + k * 0.5, 0.45, n + 12, k % 2 ? 0.5 : 0.68));
    // 작은 종 — 마디 첫박에 가볍게
    if (i % 4 === 0) s.add('bell', b, 1.8, c[2] + 24, 0.3);
  });
  // 플루트 선율 — 마을을 걷는 발걸음
  const mel = [
    [0, 1.5, 'A4'], [1.5, 0.5, 'C5'], [2, 2, 'F5'],
    [4, 1.5, 'D5'], [5.5, 0.5, 'C5'], [6, 2, 'A4'],
    [8, 1.5, 'Bb4'], [9.5, 0.5, 'D5'], [10, 2, 'F5'],
    [12, 3, 'E5'], [15, 1, 'C5'],
    [16, 1.5, 'A4'], [17.5, 0.5, 'C5'], [18, 2, 'F5'],
    [20, 1.5, 'A5'], [21.5, 0.5, 'F5'], [22, 2, 'D5'],
    [24, 2, 'Bb4'], [26, 2, 'D5'],
    [28, 3, 'C5'], [31, 1, 'G4'],
    [32, 2, 'A4'], [34, 1, 'C5'], [35, 1, 'F5'],
    [36, 2, 'Bb4'], [38, 2, 'D5'],
    [40, 2, 'G4'], [42, 1, 'Bb4'], [43, 1, 'D5'],
    [44, 3.5, 'C5'],
    [48, 1.5, 'F5'], [49.5, 0.5, 'E5'], [50, 2, 'D5'],
    [52, 1.5, 'C5'], [53.5, 0.5, 'A4'], [54, 2, 'F4'],
    [56, 2, 'Bb4'], [58, 2, 'D5'],
    [60, 3, 'C5'], [63, 1, 'A4'],
  ];
  mel.forEach(([b, d, n]) => s.add('flute', b, d, n, 0.85));
  // 뒷절반에 조용한 오르골 같은 겹선율
  [4, 20, 36, 52].forEach(b => s.add('bell', b, 2.4, 'C6', 0.22));
  return s;
};

// ── 3. 잿빛 들판 — 잿빛 들판의 순례자 ─────────────────────────────
const ashField = () => {
  const s = new Score();
  const prog = [CH.Dm, CH.Dm, CH.Bb, CH.C, CH.Dm, CH.F, CH.Gm, CH.A,
                CH.Dm, CH.Bb, CH.Gm, CH.A, CH.Dm, CH.F, CH.Gm, CH.A];
  prog.forEach((c, i) => {
    const b = i * 4;
    s.chord('pad', b, 3.9, c.map(n => n + 12), 0.34);
    // 오스티나토 저음 — 순례자의 발
    for (let k = 0; k < 8; k++) {
      s.add('bass', b + k * 0.5, 0.42, c[0] - 12 + (k % 2 ? 12 : 0), k % 2 ? 0.55 : 0.8);
    }
    s.add('timp', b, 0.4, c[0] - 12, 0.7);
    s.add('timp', b + 2.5, 0.3, c[0] - 12, 0.4);
    s.add('drum', b + 2, 0.1, 60, 0.5, { kind: 'snare' });
    s.add('drum', b + 3.5, 0.1, 60, 0.35, { kind: 'hat' });
  });
  // 낮게 깔리는 선율 — 바람에 흩어지는 재
  const mel = [
    [0, 3, 'D4'], [3, 1, 'F4'], [4, 2, 'E4'], [6, 2, 'D4'],
    [8, 3, 'F4'], [11, 1, 'G4'], [12, 4, 'A4'],
    [16, 2, 'Bb4'], [18, 2, 'A4'], [20, 2, 'G4'], [22, 2, 'F4'],
    [24, 3, 'G4'], [27, 1, 'A4'], [28, 4, 'D4'],
    [32, 2, 'A4'], [34, 2, 'Bb4'], [36, 4, 'A4'],
    [40, 2, 'G4'], [42, 2, 'F4'], [44, 2, 'E4'], [46, 2, 'D4'],
    [48, 4, 'Bb4'], [52, 4, 'A4'],
    [56, 2, 'G4'], [58, 2, 'A4'], [60, 4, 'D4'],
  ];
  mel.forEach(([b, d, n]) => s.add('flute', b, d, n, 0.62));
  // 멀리서 우는 종
  [16, 48].forEach(b => s.add('bellLow', b, 3, 'D3', 0.35));
  return s;
};

// ── 4. 성당 — 빈 고리의 성당 ──────────────────────────────────────
const chapel = () => {
  const s = new Score();
  const prog = [CH.Dm, CH.Bb, CH.Gm, CH.A, CH.Dm, CH.Bb, CH.C, CH.A];
  prog.forEach((c, i) => {
    const b = i * 6;
    // 파이프 오르간 — 길게 끌며 쌓인다
    s.chord('organ', b, 6, [c[0], c[0] + 12, c[1] + 12, c[2] + 12], 0.85);
    s.add('organ', b, 6, c[0] - 12, 0.9);
    s.add('choir', b, 6, c[2] + 12, 0.4);
    // 낮은 저음의 맥박
    for (let k = 0; k < 4; k++) s.add('bass', b + k * 1.5, 1.2, c[0] - 24, 0.55);
    s.add('bellLow', b, 3.5, c[0], 0.5);
    s.add('bellLow', b + 3, 2.5, c[0] + 6, 0.22);
  });
  // 불협 종소리 — 빈 고리의 긴장
  [[10, 'F5'], [10.4, 'C#5'], [34, 'E5'], [34.3, 'Bb4'], [46, 'D5'], [46.35, 'G#4']]
    .forEach(([b, n]) => s.add('bell', b, 2.2, n, 0.26));
  // 아주 느린 선율
  const mel = [[0, 5, 'A4'], [6, 5, 'Bb4'], [12, 5, 'D5'], [18, 5, 'C#5'],
               [24, 5, 'D5'], [30, 5, 'F5'], [36, 5, 'E5'], [42, 5, 'C#5']];
  mel.forEach(([b, d, n]) => s.add('flute', b, d, n, 0.5));
  return s;
};

// ── 5. 일반 전투 — 울림석의 검 ─────────────────────────────────────
const battle = () => {
  const s = new Score();
  const prog = [CH.Em, CH.Em, CH.C, CH.D, CH.Em, CH.Em, CH.B7, CH.B7,
                CH.Em, CH.C, CH.G, CH.D, CH.Em, CH.C, CH.B7, CH.B7];
  const bar = 4;
  prog.forEach((c, i) => {
    const b = i * bar;
    s.chord('pad', b, bar - 0.1, c.map(n => n + 12), 0.22);
    // 8분 저음 — 달린다
    for (let k = 0; k < 8; k++) {
      s.add('bass', b + k * 0.5, 0.4, c[0] - 12 + (k % 4 === 3 ? 7 : 0), k % 2 ? 0.6 : 0.9);
    }
    // 드럼
    s.drums(b, ['kick', null, 'hat', 'snare', null, 'hat', 'kick', 'hat'], 0.5, 0.9);
    // 리드 리프
    if (i % 4 === 0 || i % 4 === 2) {
      const riff = [[0, 'E5'], [0.5, 'E5'], [1, 'G5'], [1.5, 'A5'], [2, 'B5'], [2.5, 'A5'], [3, 'G5'], [3.5, 'E5']];
      riff.forEach(([t, n]) => s.add('lead', b + t, 0.4, n, 0.8));
    } else {
      const riff = [[0, 'B4'], [0.5, 'D5'], [1, 'E5'], [1.5, 'G5'], [2, 'A5'], [3, 'G5'], [3.5, 'E5']];
      riff.forEach(([t, n]) => s.add('lead', b + t, 0.45, n, 0.75));
    }
    s.add('bell', b, 0.8, c[2] + 24, 0.2);
  });
  // 중간의 종 선율
  [32, 36].forEach(b => s.arp('bell', b, ['E5', 'B5', 'E6'], 0.5, 0.9, 0.35, 2));
  return s;
};

// ── 6. 보스 — 침묵의 자비 ─────────────────────────────────────────
const boss = () => {
  const s = new Score();
  const prog = [CH.Cm, CH.Cm, CH.Ab, CH.G7, CH.Cm, CH.Cm, CH.Fm, CH.G7,
                CH.Cm, CH.Ab, CH.Fm, CH.G7, CH.Cm, CH.Ab, CH.G7, CH.G7];
  const bar = 4;
  prog.forEach((c, i) => {
    const b = i * bar;
    s.chord('organ', b, bar - 0.05, [c[0] + 12, c[1] + 12, c[2] + 12], 0.6);
    s.add('organ', b, bar - 0.05, c[0] - 12, 0.8);
    // 더블타임 저음
    for (let k = 0; k < 16; k++) {
      s.add('bass', b + k * 0.25, 0.22, c[0] - 12 + (k % 4 === 2 ? 12 : 0), k % 2 ? 0.45 : 0.72);
    }
    s.drums(b, ['kick', null, 'hat', null, 'snare', null, 'hat', 'snare'], 0.5, 1);
    s.drums(b + 2, ['kick', 'hat', 'kick', 'hat'], 0.5, 0.85);
    if (i % 4 === 0) s.add('drum', b, 0.6, 60, 0.6, { kind: 'crash' });
    s.add('timp', b, 0.4, c[0] - 12, 0.8);
    s.add('timp', b + 2, 0.4, c[0] - 12, 0.6);
    // 불협 종소리
    s.add('bell', b + 3.5, 1.2, c[1] + 24, 0.3);
    s.add('bell', b + 3.62, 1.2, c[1] + 25, 0.22);
  });
  // 리드 — 심문관의 노래
  const mel = [
    [0, 1, 'G4'], [1, 1, 'C5'], [2, 1.5, 'Eb5'], [3.5, 0.5, 'D5'],
    [4, 2, 'C5'], [6, 2, 'G4'],
    [8, 1, 'Ab4'], [9, 1, 'C5'], [10, 2, 'Eb5'],
    [12, 3, 'D5'], [15, 1, 'B4'],
    [16, 1, 'C5'], [17, 1, 'Eb5'], [18, 1.5, 'G5'], [19.5, 0.5, 'F5'],
    [20, 2, 'Eb5'], [22, 2, 'C5'],
    [24, 2, 'F5'], [26, 2, 'Eb5'],
    [28, 3, 'D5'], [31, 1, 'B4'],
    [32, 2, 'C5'], [34, 2, 'Eb5'],
    [36, 2, 'Ab5'], [38, 2, 'G5'],
    [40, 2, 'F5'], [42, 2, 'Eb5'],
    [44, 4, 'D5'],
    [48, 2, 'C5'], [50, 2, 'G4'],
    [52, 2, 'Ab4'], [54, 2, 'C5'],
    [56, 4, 'B4'],
  ];
  mel.forEach(([b, d, n]) => {
    s.add('lead', b, d * 0.95, n, 0.8);
    if (d >= 2) s.add('choir', b, d, n, 0.3);
  });
  return s;
};

// ── 7. 승리 — 울림의 승리 ─────────────────────────────────────────
const victory = () => {
  const s = new Score();
  // 세 번의 상승 동기 + 길게 뻗는 마침
  const phrase = (b, trans = 0) => {
    const notes = [[0, 0.5, 'G4'], [0.5, 0.5, 'C5'], [1, 0.5, 'E5'], [1.5, 0.5, 'G5'],
                   [2, 1.5, 'C6']];
    notes.forEach(([t, d, n]) => {
      s.add('lead', b + t, d, M(n) + trans, 0.9);
      s.add('bell', b + t, d * 2, M(n) + trans, 0.4);
      s.add('organ', b + t, d, M(n) - 12 + trans, 0.5);
    });
  };
  phrase(0);
  phrase(4, 2);
  // 마지막 화음 — C 장조
  [8, 9, 10, 11].forEach((b, i) => {
    s.chord('lead', b, 1, ['C5', 'E5', 'G5', 'C6'].map(n => M(n) + (i === 3 ? 0 : 0)), 0.8);
  });
  s.chord('organ', 8, 4, ['C4', 'E4', 'G4', 'C5'], 0.8);
  s.chord('bell', 10, 3, ['C5', 'E5', 'G5', 'C6'], 0.5);
  s.add('timp', 8, 0.5, 'C2', 1);
  s.add('timp', 10, 0.5, 'C2', 0.8);
  s.add('drum', 8, 0.4, 60, 0.7, { kind: 'crash' });
  s.chord('pad', 8, 4, ['C4', 'E4', 'G4'], 0.6);
  return s;
};

export const TRACKS = [
  {
    id: 'title', no: '01', title: '침묵 위의 첫 울림', sub: '타이틀',
    desc: '종소리 FM 아르페지오 + 서정적 패드 · D단조 72 BPM',
    bpm: 72, loopBeats: 64, gain: 0.95, build: title,
  },
  {
    id: 'selain', no: '02', title: '재가 닿지 않은 종루', sub: '셀레인 마을',
    desc: '따뜻한 플루트 + 류트 반주 · F장조 104 BPM',
    bpm: 104, loopBeats: 64, gain: 1.0, build: selain,
  },
  {
    id: 'field', no: '03', title: '잿빛 들판의 순례자', sub: '들판 · 길',
    desc: '비장한 마이너 행진곡 · D단조 92 BPM',
    bpm: 92, loopBeats: 64, gain: 1.0, build: ashField,
  },
  {
    id: 'chapel', no: '04', title: '빈 고리의 성당', sub: '성당 · 예배당',
    desc: '파이프 오르간 + 긴장의 저음 · D단조 56 BPM',
    bpm: 56, loopBeats: 48, gain: 1.0, build: chapel,
  },
  {
    id: 'battle', no: '05', title: '울림석의 검', sub: '일반 전투',
    desc: '빠른 148 BPM 레트로 JRPG 배틀 록 · E단조',
    bpm: 148, loopBeats: 64, gain: 0.95, build: battle,
  },
  {
    id: 'boss', no: '06', title: '침묵의 자비', sub: '보스전',
    desc: '강렬한 오르간 + 더블타임 베이스 + 불협 종 · C단조 156 BPM',
    bpm: 156, loopBeats: 64, gain: 0.95, build: boss,
  },
  {
    id: 'victory', no: '07', title: '울림의 승리', sub: '승리 팡파레',
    desc: '세 번의 상승 동기로 맺는 짧은 팡파레 · C장조',
    bpm: 138, loopBeats: 16, gain: 1.0, build: victory,
  },
];

/** 맵·상황 → 곡 */
export const BGM_FOR = {
  selain: 'selain', harvel: 'selain', ash: 'field', chapel: 'chapel',
};
