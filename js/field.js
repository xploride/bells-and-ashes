// field.js — 높이(elevation)를 가진 타일맵 · 카메라 · 입자 · Y정렬
import { IDX, IMG, drawFrame, drawQuarter, sheet, clamp, rnd, irnd, pick } from './core.js';
import { playSfx } from './audio.js';
import { Events } from './state.js';

const DIRS = { down: [0, 1], left: [-1, 0], right: [1, 0], up: [0, -1] };
const OPP = { down: 'up', up: 'down', left: 'right', right: 'left' };
const DIRIDX = { down: 0, left: 1, right: 2, up: 3 };

const ANIM_TILES = {
  4: { frames: [4, 32, 33, 34], time: 0.30, phase: false },
  24: { frames: [24, 35, 36, 35], time: 0.30, phase: false },
  30: { frames: [30, 37, 38, 37, 30, 38], time: 0.15, phase: true },
  11: { frames: [11, 39], time: 1.1, phase: true },
};
const TALL = { 10: 11, 19: 20, 29: 30 };
// 경계 오토타일 겹침은 끈다 — GPT 경계 시트에 마젠타 잔선이 남아 지도가 지저분해진다.
const USE_AUTOTILE = false;

export class Field {
  constructor(app) {
    this.app = app;
    this.ctx = app.ctx;
    this.state = app.state;
    this.map = null;
    this.pos = { x: 6, y: 10 };
    this.facing = 'down';
    this.dir = null;
    this.moving = false;
    this.moveT = 0;
    this.moveDur = 0.18;
    this.from = null;
    this.to = null;
    this.walkStep = 0;
    this.walkCols = [2, 3, 4];
    this.locked = false;
    this.time = 0;
    this.cam = { x: 0, y: 0 };
    this.T = 48;
    this.items = [];
    this.npcs = new Map();
    this.encs = new Map();
    this.marks = {};
    this.particles = [];
    this.rings = [];
    this.floaters = [];
    this.doorFx = null;
    this.spawnAcc = 0;
    this.leaderSheet = 'chr_lien';
    this.npcPhase = new Map();
    this.resize();
  }

  resize() {
    const { canvas } = this.app;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.W = w; this.H = h;
    const portrait = h > w * 1.15;
    const across = portrait ? 9.4 : 13;
    const rows = portrait ? 17 : 8.8;
    let T = Math.round(Math.min(w / across, h / rows));
    T = clamp(T, 18, 64);
    if (T % 2) T -= 1;
    this.T = T;
    this.step = T / 2;
    this.buildStatic();
    this.snapCam();
  }

  // ── 맵 ─────────────────────────────────────────────────────────
  setMap(id, pos) {
    const m = IDX.map[id];
    if (!m) return;
    this.map = m;
    this.state.mapID = id;
    this.pos = pos ? { x: pos.x, y: pos.y } : { ...m.spawn };
    this.state.pos = { ...this.pos };
    this.facing = 'down';
    this.dir = null;
    this.moving = false;
    this.marks = Events.markers(id, this.state);
    this.bgColor = this.sampleFloorColor();
    this.buildStatic();
    this.buildActors();
    this.snapCam();
    this.particles = [];
    this.rings = [];
    this.doorFx = null;
    this.app.onMapEnter?.(m);
  }

  sampleFloorColor() {
    const ts = sheet(this.map.tileset);
    if (!ts) return '#0d0a14';
    try {
      const c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = false;
      x.drawImage(ts.img, 0, 0, 24, 24, 0, 0, 8, 8);
      const d = x.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      if (!n) return '#0d0a14';
      const k = 0.42;
      return `rgb(${Math.round(r / n * k)},${Math.round(g / n * k)},${Math.round(b / n * k)})`;
    } catch (e) { return '#0d0a14'; }
  }

  buildActors() {
    this.npcs.clear();
    for (const n of this.map.npcs || []) {
      if (!this.visibleNPC(n)) continue;
      this.npcs.set(n.id, n);
      if (!this.npcPhase.has(n.id)) this.npcPhase.set(n.id, rnd(0, 2.5));
    }
    this.encs.clear();
    for (const e of this.map.encounters || []) {
      if (this.state.hasFlag(e.clearFlag)) continue;
      this.encs.set(e.id, e);
    }
  }

  visibleNPC(n) {
    if (n.hideIfFlag && this.state.hasFlag(n.hideIfFlag)) return false;
    if (n.showIfFlag && !this.state.hasFlag(n.showIfFlag)) return false;
    return true;
  }

  refreshActors() {
    this.buildActors();
    this.marks = Events.markers(this.map.id, this.state);
  }

  heightAt(x, y) {
    const m = this.map;
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return 0;
    return m.heights[y * m.width + x];
  }
  collAt(x, y) {
    const m = this.map;
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return 1;
    return m.collision[y * m.width + x];
  }
  tileAt(x, y) {
    const m = this.map;
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return 0;
    return m.tiles[y * m.width + x];
  }

  charAt(x, y) {
    for (const n of this.npcs.values()) if (n.at.x === x && n.at.y === y) return n;
    for (const e of this.encs.values()) if (e.at.x === x && e.at.y === y) return { enc: e };
    return null;
  }

  canStep(a, b) {
    const kb = this.collAt(b.x, b.y);
    if (kb === 1) return false;
    const who = this.charAt(b.x, b.y);
    if (who) return false;
    const ha = this.heightAt(a.x, a.y), hb = this.heightAt(b.x, b.y);
    if (ha === hb) return true;
    const ka = this.collAt(a.x, a.y);
    if ((ka === 2 || kb === 2) && Math.abs(ha - hb) <= 2) return true;
    return false;
  }

  // ── 정적 그림 목록 ────────────────────────────────────────────
  buildStatic() {
    this.items = [];
    if (!this.map) return;
    const m = this.map, T = this.T, step = this.step;
    const baseY = y => (y + 1) * T;

    const autoRules = {};
    for (const a of m.autotiles || []) {
      if (!IMG[a.sheet]) continue;
      for (const t of a.tiles) autoRules[t] = { sheet: a.sheet, outside: new Set(a.outside) };
    }
    const out = (x, y, dx, dy, h) => {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) return false;
      if (this.heightAt(nx, ny) !== h) return false;
      const rule = autoRules[this.tileAt(x, y)];
      return rule ? rule.outside.has(this.tileAt(nx, ny)) : false;
    };

    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const idx = this.tileAt(x, y), h = this.heightAt(x, y);
        const sx = x * T, sy = y * T - h * step;
        this.items.push({ z: h > 0 ? y * 10 : -1000, t: 'tile', x, y, idx, sx, sy, phase: Math.random() * 6 });
        // 경계 오토타일 4분할
        const rule = USE_AUTOTILE ? autoRules[idx] : null;
        if (rule) {
          const outer = [[[0, 0], [0, 2]], [[2, 0], [2, 2]]];
          const inner = [[[0, 3], [1, 3]], [[2, 3], [3, 0]]];
          for (let qy = 0; qy <= 1; qy++) {
            for (let qx = 0; qx <= 1; qx++) {
              const v = out(x, y, 0, qy === 0 ? -1 : 1, h);
              const hz = out(x, y, qx === 0 ? -1 : 1, 0, h);
              const d = out(x, y, qx === 0 ? -1 : 1, qy === 0 ? -1 : 1, h);
              let cell = null;
              if (v && hz) cell = outer[qy][qx];
              else if (v) cell = [qy === 0 ? 0 : 2, 1];
              else if (hz) cell = [1, qx === 0 ? 0 : 2];
              else if (d) cell = inner[qy][qx];
              if (!cell) continue;
              this.items.push({ z: y * 10 + 0.05, t: 'quarter', sheet: rule.sheet,
                qc: cell[1] * 2 + qx, qr: cell[0] * 2 + qy,
                sx: sx + qx * T / 2, sy: sy + qy * T / 2 });
            }
          }
        }
        // 절벽면
        if (h > 0) {
          const below = y + 1 < m.height ? this.heightAt(x, y + 1) : 0;
          const drop = h - below;
          if (drop > 0) {
            for (let k = 0; k < drop; k++) {
              const level = below + k;
              this.items.push({
                z: y * 10 - 0.5, t: 'cliff', x, y, k, level, drop,
                sx, sy: baseY(y) - (level + 1) * step, dark: m.cliff ? 0.04 * (drop - k) : 0.12 + 0.06 * (drop - k),
              });
            }
            this.items.push({ z: y * 10 + 0.1, t: 'rect', sx, sy, w: T, h: 2, color: 'rgba(0,0,0,.25)' });
          }
        }
        // 키 큰 장식 윗부분
        const top = TALL[idx];
        if (top !== undefined) {
          this.items.push({ z: y * 10 + 8, t: 'tile', x, y, idx: top, sx, sy: sy - T, phase: Math.random() * 6 });
        }
      }
    }

    for (const p of m.props || []) {
      const s = sheet(p.sprite);
      if (!s) continue;
      const w = s.img.width * (T / 24), hh = s.img.height * (T / 24);
      const bx = p.x * T, by = (p.y + 1) * T - this.heightAt(p.x, p.y) * step;
      const ox = (p.ox || 0) * (T / 24), oy = (p.oy || 0) * (T / 24);
      const sx = bx + (p.w * T - w) / 2 + ox;
      const sy = by - hh - oy;
      const under = p.under ? (p.y - p.h + 1) * 10 + 0.6 : p.y * 10 + 6;
      this.items.push({ z: under, t: 'img', name: p.sprite, sx, sy, w, h: hh });
    }
  }

  // ── 이동 ───────────────────────────────────────────────────────
  footPoint(c) {
    const h = this.heightAt(c.x, c.y);
    return { x: c.x * this.T + this.T / 2, y: (c.y + 1) * this.T - h * this.step };
  }

  snapCam() {
    if (!this.map) return;
    const f = this.footPoint(this.pos);
    this.cam = this.clampCam({ x: f.x, y: f.y - this.T * 0.6 });
  }

  clampCam(p) {
    const T = this.T, m = this.map;
    const viewW = this.W, viewH = this.H;
    const mapW = m.width * T, mapH = m.height * T;
    let x = p.x, y = p.y;
    x = mapW > viewW ? clamp(x, viewW / 2, mapW - viewW / 2) : mapW / 2;
    y = mapH > viewH ? clamp(y, viewH / 2, mapH - viewH / 2) : mapH / 2;
    return { x, y };
  }

  setDir(d) { this.dir = d; }
  interact() {
    if (!this.map || this.moving) return;
    const [dx, dy] = DIRS[this.facing];
    const fx = this.pos.x + dx, fy = this.pos.y + dy;
    const who = this.charAt(fx, fy);
    if (who && who.enc) { this.app.onEncounter?.(who.enc); return; }
    if (who && who.id) { this.app.onTalk?.(who.id); return; }
    // 발밑에 문이 있으면 들어간다
    const ex = (this.map.exits || []).find(e => e.at.x === fx && e.at.y === fy);
    if (ex && !ex.requiresFlag) this.app.onExit?.(ex);
  }

  tryMove(d) {
    if (this.moving || this.locked || !this.map) return;
    const [dx, dy] = DIRS[d];
    const next = { x: this.pos.x + dx, y: this.pos.y + dy };
    if (this.facing !== d) {
      this.facing = d;
      this.walkT = 0;
    }
    const who = this.charAt(next.x, next.y);
    if (who && who.enc) {
      this.dir = null;
      this.moving = false;
      this.app.onEncounter?.(who.enc);
      return;
    }
    if (!this.canStep(this.pos, next)) {
      playSfx('ui_bump', 0.6);
      return;
    }
    // 문 열림 연출
    const ex = (this.map.exits || []).find(e => e.at.x === next.x && e.at.y === next.y);
    if (ex && ex.door && (!ex.requiresFlag || this.state.hasFlag(ex.requiresFlag))) {
      this.openDoor(ex);
    }
    this.from = { ...this.pos };
    this.to = next;
    this.moving = true;
    this.moveT = 0;
    this.walkStep = (this.walkStep + 1) % 2;
    const dh = this.heightAt(next.x, next.y) - this.heightAt(this.pos.x, this.pos.y);
    if (dh !== 0) playSfx('step_wood', 0.55);
    else playSfx('step_' + this.surface, 0.5);
  }

  arrive() {
    this.state.pos = { ...this.pos };
    const ex = (this.map.exits || []).find(e => e.at.x === this.pos.x && e.at.y === this.pos.y);
    if (ex) {
      if (ex.requiresFlag && !this.state.hasFlag(ex.requiresFlag)) {
        this.app.toast?.('아직 이 길로는 갈 수 없다');
      } else {
        this.app.onExit?.(ex);
      }
      return;
    }
    this.app.onArrive?.();
  }

  get surface() {
    const m = this.map;
    if (!m) return 'grass';
    const ts = m.tileset || '';
    if (ts.includes('int_stone') || ts.includes('int_sacred') || m.region === 'chapel') return 'stone';
    if (ts.startsWith('tiles_int')) return 'wood';
    if (m.region === 'ash' || ts.includes('ash')) return 'ash';
    if (m.region === 'harvel' || ts.includes('harvel')) return 'stone';
    return 'grass';
  }

  openDoor(ex) {
    const d = ex.door;
    if (!sheet(d.sheet)) return;
    const heavy = ['chapel', 'cathedral', 'gate', 'hall', 'order', 'records'].some(k =>
      (ex.toMap || '').includes(k) || (d.sheet || '').includes(k));
    playSfx(heavy ? 'door_heavy' : 'door');
    const b = this.footPoint(ex.at);
    this.doorFx = { sheet: d.sheet, w: d.w * (this.T / 24), lift: d.lift * (this.T / 24),
      x: ex.at.x * this.T, y: (ex.at.y + 1) * this.T - this.heightAt(ex.at.x, ex.at.y) * this.step,
      t: 0, z: ex.at.y * 10 + 6.5 };
  }

  // ── 입자·연출 ──────────────────────────────────────────────────
  pulse(x, y, color = '#f2c14e') {
    this.rings.push({ x, y, t: 0, life: 1.4, color, max: this.T * 2.6 });
  }

  floatText(x, y, text, color = '#f4ecdc') {
    this.floaters.push({ x, y, t: 0, life: 1.1, text, color });
  }

  spawnAmbient(dt) {
    const region = this.map?.region || 'selain';
    this.spawnAcc += dt;
    const rate = region === 'ash' ? 0.035 : region === 'selain' ? 0.12 : region === 'chapel' ? 0.16 : 0.09;
    while (this.spawnAcc > rate) {
      this.spawnAcc -= rate;
      const x = rnd(0, this.W), y = rnd(-20, this.H);
      if (region === 'ash') {
        if (Math.random() < 0.12) this.particles.push({ x, y: rnd(this.H * 0.4, this.H), vx: rnd(-8, 8), vy: rnd(-38, -16), life: rnd(1.6, 2.8), t: 0, c: '#ff9a5a', s: 2 });
        else this.particles.push({ x: rnd(0, this.W), y: -6, vx: rnd(-14, 4), vy: rnd(18, 34), life: rnd(3, 5), t: 0, c: '#d8d0cc', s: rnd(1, 2) });
      } else if (region === 'selain') {
        this.particles.push({ x: rnd(-10, this.W), y: rnd(0, this.H * 0.9), vx: rnd(16, 34), vy: rnd(6, 16), life: rnd(3.2, 5.5), t: 0,
          c: Math.random() < 0.5 ? '#f4d0dc' : '#fff6e8', s: rnd(1, 2), spin: rnd(-2, 2) });
      } else if (region === 'chapel') {
        this.particles.push({ x: rnd(0, this.W), y: rnd(0, this.H), vx: rnd(-4, 4), vy: rnd(-6, 2), life: rnd(4, 7), t: 0, c: '#fff3c8', s: 1 });
      } else {
        this.particles.push({ x: rnd(0, this.W), y: rnd(0, this.H), vx: rnd(-6, 6), vy: rnd(-4, 4), life: rnd(3, 5), t: 0, c: '#a8a4b0', s: 1 });
      }
    }
    if (this.particles.length > 220) this.particles.splice(0, this.particles.length - 220);
  }

  footDust() {
    const f = this.footPoint(this.pos);
    const col = this.map.region === 'ash' ? '#b8b0a8' : (this.map.region === 'chapel' || this.map.region === 'harvel') ? '#a8a4b0' : '#c8b090';
    for (const side of [-1, 1]) {
      this.particles.push({ x: f.x + side * this.T * 0.2, y: f.y - 2, vx: side * 14, vy: -6, life: 0.45, t: 0, c: col, s: 2, world: true });
    }
  }

  // ── 갱신 ───────────────────────────────────────────────────────
  update(dt) {
    this.time += dt;
    if (!this.map) return;
    // 눈 깜박임 · 숨쉬기
    this.blinkT = (this.blinkT || 0) + dt;
    if (this.blink) {
      this.blinkLeft = (this.blinkLeft || 0) - dt;
      if (this.blinkLeft <= 0) this.blink = false;
    } else if (this.blinkT > (this.nextBlink || 3)) {
      this.blink = true; this.blinkLeft = 0.14; this.blinkT = 0; this.nextBlink = rnd(2.4, 4.6);
    }
    this.spawnAmbient(dt);

    if (this.moving) {
      this.moveT += dt;
      const k = Math.min(1, this.moveT / this.moveDur);
      if (k >= 1) {
        this.pos = { ...this.to };
        this.moving = false;
        this.footDust();
        this.arrive();
      }
    } else if (this.dir && !this.locked) {
      this.tryMove(this.dir);
    }

    // 카메라 따라가기
    const f = this.footPoint(this.moving ? this.to : this.pos);
    const target = this.clampCam({ x: f.x, y: f.y - this.T * 0.6 });
    const k = 1 - Math.pow(0.001, dt);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;

    // 입자
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      if (p.t > p.life) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt;
      if (r.t > r.life) this.rings.splice(i, 1);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const r = this.floaters[i]; r.t += dt;
      if (r.t > r.life) this.floaters.splice(i, 1);
    }
    if (this.doorFx) {
      this.doorFx.t += dt;
      if (this.doorFx.t > 0.45) this.doorFx = null;
    }
  }

  // ── 그리기 ─────────────────────────────────────────────────────
  playerPixel() {
    const from = this.footPoint(this.from || this.pos);
    if (!this.moving) return this.playerFootCache = this.footPoint(this.pos);
    const to = this.footPoint(this.to);
    const k = Math.min(1, this.moveT / this.moveDur);
    return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
  }

  playerFrame() {
    if (this.moving) {
      const k = Math.min(1, this.moveT / this.moveDur);
      const cols = this.walkStep === 0 ? [2, 3, 4] : [5, 6, 7];
      return cols[clamp(Math.floor(k * 3), 0, 2)];
    }
    return this.blink ? 1 : 0;
  }

  draw() {
    const ctx = this.ctx, T = this.T;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = this.bgColor || '#0d0a14';
    ctx.fillRect(0, 0, this.W, this.H);
    if (!this.map) return;
    const camX = Math.round(this.cam.x - this.W / 2);
    const camY = Math.round(this.cam.y - this.H / 2);
    const view = { x: camX, y: camY, w: this.W, h: this.H };

    const list = [];
    const vis = (sx, sy, w, h) => sx + w > view.x - 8 && sx < view.x + view.w + 8 && sy + h > view.y - 8 && sy < view.y + view.h + 8;
    for (const it of this.items) {
      const w = it.t === 'rect' ? it.w : it.t === 'img' ? it.w : (it.t === 'quarter' ? T / 2 : T);
      const hh = it.t === 'rect' ? it.h : it.t === 'img' ? it.h : (it.t === 'quarter' ? T / 2 : (it.t === 'cliff' ? this.step : T));
      if (!vis(it.sx, it.sy, w, hh)) continue;
      list.push(it);
    }

    // 등장인물
    const dyn = [];
    for (const n of this.npcs.values()) {
      if (!this.visibleNPC(n)) continue;
      const f = this.footPoint(n.at);
      dyn.push({ z: n.at.y * 10 + 5, t: 'char', name: n.sprite, sheetName: n.sprite, dir: DIRIDX[n.facing ?? 'down'],
        x: f.x, y: f.y, npc: n, isNpc: true });
    }
    for (const e of this.encs.values()) {
      const f = this.footPoint(e.at);
      dyn.push({ z: e.at.y * 10 + 5, t: 'foe', name: e.sprite, x: f.x, y: f.y, bob: Math.sin(this.time * 3 + e.at.x) * 3 });
    }
    const pf = this.playerPixel();
    dyn.push({ z: (this.moving ? Math.max(this.from.y, this.to.y) : this.pos.y) * 10 + 5, t: 'char',
      name: this.leaderSheet, dir: DIRIDX[this.facing], x: pf.x, y: pf.y, isPlayer: true, frame: this.playerFrame() });

    for (const d of dyn) list.push(d);

    list.sort((a, b) => a.z - b.z);

    for (const it of list) {
      const sx = Math.round((it.sx ?? it.x) - camX), sy = Math.round((it.sy ?? it.y) - camY);
      switch (it.t) {
        case 'tile': {
          let idx = it.idx;
          const at = ANIM_TILES[idx];
          if (at && sheet(this.map.tileset)?.rows >= 5) {
            const base = at.phase ? it.phase : 0;
            const f = Math.floor((this.time + base) / at.time) % at.frames.length;
            idx = at.frames[f];
          }
          drawFrame(ctx, this.map.tileset, idx % 8, Math.floor(idx / 8), sx, sy, T, T);
          break;
        }
        case 'quarter':
          drawQuarter(ctx, it.sheet, it.qc, it.qr, sx, sy, T / 2, T / 2);
          break;
        case 'cliff': {
          const cliffName = this.map.cliff;
          const wallAt = nx => {
            if (nx < 0 || nx >= this.map.width) return true;
            const nh = this.heightAt(nx, it.y);
            const nb = it.y + 1 < this.map.height ? this.heightAt(nx, it.y + 1) : 0;
            return nh > it.level && nb <= it.level;
          };
          const col = !wallAt(it.x - 1) ? 0 : (!wallAt(it.x + 1) ? 2 : 1);
          const row = (it.k === 0 && it.drop >= 2) ? 1 : 0;
          const fromTop = this.heightAt(it.x, it.y) - 1 - it.level;
          const top = row === 1 ? true : (fromTop % 2 === 0);
          if (cliffName && sheet(cliffName)) {
            const s = sheet(cliffName);
            ctx.drawImage(s.img, col * s.fw, row * s.fh + (top ? 0 : s.fh / 2), s.fw, s.fh / 2,
              sx, sy, T, this.step);
          } else {
            const ts = sheet(this.map.tileset);
            if (ts) ctx.drawImage(ts.img, 5 * ts.fw, (top ? 0 : ts.fh / 2), ts.fw, ts.fh / 2, sx, sy, T, this.step);
          }
          if (it.dark > 0) {
            ctx.save();
            ctx.globalAlpha = it.dark;
            ctx.fillStyle = '#000';
            ctx.fillRect(sx, sy, T, this.step);
            ctx.restore();
          }
          break;
        }
        case 'rect':
          ctx.fillStyle = it.color;
          ctx.fillRect(sx, sy, it.w, it.h);
          break;
        case 'img':
          drawFrame(ctx, it.name, 0, 0, sx, sy, it.w, it.h);
          break;
        case 'char': {
          const s = sheet(it.name);
          if (!s) break;
          const fw = T, fh = T * 36 / 24;
          // 그림자
          ctx.save();
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.ellipse(sx + T / 2, sy - 2, T * 0.34, T * 0.11, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          let col = it.frame ?? 0;
          if (it.isNpc) {
            const ph = this.npcPhase.get(it.npc.id) || 0;
            const t = (this.time + ph) % 1.52;
            col = t < 0.42 ? 0 : t < 0.76 ? 1 : t < 1.18 ? 2 : 3;
          } else if (!this.moving) {
            col = this.blink ? 1 : 0;
          }
          const bob = it.isNpc ? Math.sin((this.time + (this.npcPhase.get(it.npc.id) || 0)) * 1.6) * 0.4 : 0;
          drawFrame(ctx, it.name, col, it.dir, sx, Math.round(sy - fh + bob), fw, fh);
          // 머리 위 표식
          const mark = this.marks[it.npc?.id];
          if (mark) this.drawMark(ctx, sx + T / 2, sy - fh - 10, mark);
          break;
        }
        case 'foe': {
          const s = sheet(it.name);
          if (!s) break;
          const kind = it.name;
          const fw0 = s.fw, fh0 = s.fh;
          const k = (T * 1.25) / Math.max(fw0, fh0);
          const w = fw0 * k, hh = fh0 * k;
          const f = Math.floor(this.time / 0.22) % 4;
          ctx.save();
          ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.ellipse(sx + T / 2, sy - 2, T * 0.36, T * 0.12, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          // 적 시트는 오른쪽을 본다 → 왼쪽(플레이어)을 보게 뒤집는다
          ctx.save();
          ctx.translate(sx + T / 2, sy - hh + it.bob);
          ctx.scale(-1, 1);
          ctx.drawImage(s.img, f * fw0, 0, fw0, fh0, -w / 2, 0, w, hh);
          ctx.restore();
          break;
        }
      }
    }

    // 문 열림
    if (this.doorFx) {
      const d = this.doorFx, s = sheet(d.sheet);
      if (s) {
        const f = Math.min(3, Math.floor(d.t / 0.08));
        const hh = d.w * (s.fh / s.fw);
        ctx.drawImage(s.img, f * s.fw, 0, s.fw, s.fh,
          Math.round(d.x - camX + T / 2 - d.w / 2), Math.round(d.y - camY - hh + d.lift), d.w, hh);
      }
    }

    // 입자 (화면 좌표 · 월드 좌표 혼합)
    for (const p of this.particles) {
      const px = p.world ? p.x - camX : p.x;
      const py = p.world ? p.y - camY : p.y;
      const a = Math.min(1, (p.life - p.t) / Math.min(1, p.life * 0.5));
      ctx.globalAlpha = Math.max(0, a) * 0.9;
      ctx.fillStyle = p.c;
      const s = p.s || 1;
      ctx.fillRect(Math.round(px), Math.round(py), s, s);
    }
    ctx.globalAlpha = 1;

    // 금빛 동심원 (성종·울림석 공명)
    for (const r of this.rings) {
      const k = r.t / r.life;
      const rad = r.max * k;
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.75;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(1, 2.4 * (1 - k));
      ctx.beginPath();
      ctx.arc(r.x - camX, r.y - camY, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = (1 - k) * 0.35;
      ctx.beginPath();
      ctx.arc(r.x - camX, r.y - camY, rad * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const f of this.floaters) {
      const k = f.t / f.life;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.color;
      ctx.font = `${Math.round(T * 0.42)}px Galmuri11, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x - camX, f.y - camY - k * T * 1.2);
      ctx.restore();
    }
  }

  drawMark(ctx, cx, cy, kind) {
    const main = kind === 'main';
    const bob = Math.sin(this.time * 4) * 2;
    const w = Math.round(this.T * 0.5), h = Math.round(this.T * 0.58);
    const x = Math.round(cx - w / 2), y = Math.round(cy - h + bob);
    ctx.save();
    ctx.fillStyle = main ? '#f2c14e' : '#7cc6e8';
    ctx.strokeStyle = '#1a1424';
    ctx.lineWidth = Math.max(1, this.T * 0.06);
    const r = Math.max(2, this.T * 0.1);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + w * 0.58, y + h); ctx.lineTo(x + w * 0.5, y + h + h * 0.22); ctx.lineTo(x + w * 0.42, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1a1424';
    ctx.font = `bold ${Math.round(this.T * 0.34)}px Galmuri11, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(main ? '!' : '?', x + w / 2, y + h * 0.48);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }
}
