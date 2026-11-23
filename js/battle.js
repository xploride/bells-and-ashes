// battle.js — ATB 전투 · 애니메이션 프리셋 해석기 · UI
import { IDX, drawFrame, sheet, clamp, rnd, pick, sleep, rgba, hexToRgb } from './core.js';
import { memberStats, memberSpell, gainExp, clampVitals, ELEMENT_KR, ELEMENT_HEX, NATURE_KR } from './state.js';
import { playSfx } from './audio.js';

const GAUGE = 1000;
const LETTER = ['A', 'B', 'C', 'D', 'E', 'F'];

const FOE_SLOTS = [[0.15, 0.72], [0.33, 0.76], [0.19, 0.56], [0.37, 0.60]];
const ALLY_SLOTS = [[0.73, 0.70], [0.88, 0.64], [0.63, 0.58], [0.80, 0.54]];

export class Battle {
  constructor(app, opts) {
    this.app = app;
    this.ctx = app.ctx;
    this.state = app.state;
    this.opts = opts;
    this.isBoss = !!opts.isBoss;
    this.units = [];
    this.log = [];
    this.outcome = 'ongoing';
    this.waiting = null;
    this.turns = 0;
    this.time = 0;
    this.shake = 0;
    this.flash = null;
    this.particles = [];
    this.popups = [];
    this.slashes = [];
    this.beams = [];
    this.msg = '';
    this.hoverTarget = null;
    this.done = false;

    for (const m of this.state.activeParty) {
      const s = memberStats(m);
      this.units.push({
        id: m.defID, defID: m.defID, side: 'ally', name: IDX.char[m.defID].name,
        stats: s, hp: m.hp, mp: m.mp, dispHp: m.hp, row: m.row, atb: rnd(0, 400),
        guarding: false, sprite: 'bat_' + m.defID, mods: {},
      });
    }
    const seen = {};
    for (const eid of opts.enemyIDs) {
      const d = IDX.enemy[eid];
      if (!d) continue;
      seen[eid] = (seen[eid] || 0) + 1;
      const n = seen[eid];
      const total = opts.enemyIDs.filter(x => x === eid).length;
      this.units.push({
        id: `${eid}#${n}`, defID: eid, side: 'foe', name: d.name + (total > 1 ? ` ${LETTER[n - 1] || n}` : ''),
        stats: d.stats, hp: d.stats.maxHP, mp: d.stats.maxMP, dispHp: d.stats.maxHP,
        row: d.defaultRow, atb: rnd(1, 30) * 10, guarding: false, sprite: d.sprite,
        element: d.element, resist: d.resist || {}, exp: d.exp, coin: d.coin, mods: {},
      });
    }
    this.layout();
  }

  layout() {
    const { W, H } = this.app;
    this.W = W; this.H = H;
    let fi = 0, ai = 0;
    for (const u of this.units) {
      const slot = u.side === 'foe' ? FOE_SLOTS[fi++ % 4] : ALLY_SLOTS[ai++ % 4];
      u.hx = W * slot[0];
      u.hy = H * slot[1];
      u.x = u.hx; u.y = u.hy;
      u.kx = 0; u.ky = 0;
      const s = sheet(u.sprite);
      const fh0 = s ? s.fh : 40;
      const maxH = u.side === 'foe' ? H * 0.30 : H * 0.24;
      const maxW = u.side === 'foe' ? W * 0.17 : W * 0.11;
      u.k = Math.min(maxH / fh0, maxW / (s ? s.fw : 32));
      u.dw = (s ? s.fw : 32) * u.k;
      u.dh = fh0 * u.k;
      u.pose = 'idle';
      u.poseT = 0;
    }
  }

  // ── 규칙 ───────────────────────────────────────────────────────
  get allies() { return this.units.filter(u => u.side === 'ally'); }
  get foes() { return this.units.filter(u => u.side === 'foe'); }
  get livingAllies() { return this.allies.filter(u => u.hp > 0); }
  get livingFoes() { return this.foes.filter(u => u.hp > 0); }
  unit(id) { return this.units.find(u => u.id === id); }

  eff(u, key) {
    const mod = u.mods[key];
    return Math.max(1, Math.floor(u.stats[key === 'maxHP' ? 'maxHP' : key] * (mod ? mod.scale : 1)));
  }
  attacksAtRange(u) {
    if (u.side === 'ally') return !!IDX.char[u.defID]?.ranged;
    return u.row === 'back';
  }
  meleeTargets(side) {
    const pool = side === 'ally' ? this.livingFoes : this.livingAllies;
    const front = pool.filter(u => u.row === 'front');
    return front.length ? front : pool;
  }
  elementScale(el, t) {
    if (!el) return 1;
    let s = t.resist?.[el] ?? 1;
    const strong = { fire: 'wind', water: 'fire', wind: 'earth', earth: 'thunder', thunder: 'water', light: 'sound', sound: 'light' };
    if (t.element && strong[el] === t.element) s *= 1.5;
    return s;
  }
  physicalDamage(a, t, power, element, ranged) {
    const atk = this.eff(a, 'atk') * power / 100;
    const mitig = 1 - this.eff(t, 'def') / (this.eff(t, 'def') + 110);
    let dmg = atk * mitig * 1.4;
    if (!ranged) {
      dmg *= a.row === 'back' ? 0.75 : 1;
      dmg *= t.row === 'back' ? 0.6 : 1;
    }
    const scale = this.elementScale(element, t);
    dmg *= scale;
    if (t.guarding) dmg *= 0.5;
    dmg *= rnd(0.9, 1.1);
    const crit = Math.random() < 0.06;
    if (crit) dmg *= 1.6;
    return { amount: Math.max(1, Math.round(dmg)), scale, crit };
  }
  magicDamage(a, t, power, element) {
    const base = power * 1.3 + this.eff(a, 'mag') * 0.8;
    const mitig = 1 - this.eff(t, 'res') / (this.eff(t, 'res') + 130);
    let dmg = base * mitig;
    const scale = this.elementScale(element, t);
    dmg *= scale;
    if (t.guarding) dmg *= 0.7;
    dmg *= rnd(0.92, 1.08);
    return { amount: Math.max(1, Math.round(dmg)), scale, crit: false };
  }

  applyDamage(t, amount, beat) {
    const wasUp = t.hp > 0;
    t.hp = Math.max(0, t.hp - amount);
    beat.damage[t.id] = (beat.damage[t.id] || 0) + amount;
    if (wasUp && t.hp === 0) { beat.downed.push(t.id); t.atb = 0; this.push(`${t.name} 쓰러짐`); }
  }
  heal(t, amount, beat) {
    if (t.hp <= 0) return;
    const before = t.hp;
    t.hp = Math.min(t.stats.maxHP, t.hp + Math.max(1, amount));
    beat.heal[t.id] = (beat.heal[t.id] || 0) + (t.hp - before);
  }
  revive(t, fraction, beat) {
    if (t.hp > 0) { this.heal(t, Math.round(t.stats.maxHP * fraction), beat); return; }
    t.hp = Math.max(1, Math.round(t.stats.maxHP * fraction));
    t.atb = 0;
    beat.revived.push(t.id);
    this.push(`${t.name} 일어남`);
  }
  push(s) {
    this.log.push(s);
    if (this.log.length > 6) this.log.shift();
    this.app.onBattleLog?.(this.log);
  }

  // ── 시간 ───────────────────────────────────────────────────────
  tick(dt) {
    if (this.outcome !== 'ongoing' || this.waiting) return null;
    let ready = this.nextReady();
    if (ready) return this.begin(ready);
    for (const u of this.units) if (u.hp > 0) u.atb += this.eff(u, 'agi') * 60 * dt;
    ready = this.nextReady();
    if (ready) return this.begin(ready);
    return null;
  }
  nextReady() {
    const c = this.units.filter(u => u.hp > 0 && u.atb >= GAUGE).sort((a, b) => b.atb - a.atb);
    return c[0] || null;
  }
  begin(u) {
    u.guarding = false;
    for (const k of Object.keys(u.mods)) {
      if (u.mods[k].turns > 1) u.mods[k].turns--;
      else delete u.mods[k];
    }
    if (u.side === 'ally') { this.waiting = u.id; return { kind: 'await', id: u.id }; }
    const beat = this.enemyAI(u);
    this.finishTurn(u);
    return { kind: 'enemy', beat };
  }
  finishTurn(u) {
    u.atb = Math.max(0, u.atb - GAUGE);
    this.turns++;
    this.check();
  }
  check() {
    if (!this.livingFoes.length) this.outcome = 'victory';
    else if (!this.livingAllies.length) this.outcome = 'defeat';
  }

  // ── 명령 ───────────────────────────────────────────────────────
  command(actorID, action) {
    const a = this.unit(actorID);
    if (!a) return null;
    let beat = null;
    switch (action.type) {
      case 'attack': {
        const ranged = this.attacksAtRange(a);
        beat = this.physical(a, action.target, 100, '공격', ranged ? 'ranged_shot' : 'default_strike', null, ranged);
        break;
      }
      case 'skill': {
        const sk = IDX.skill[action.skill];
        if (!sk) return null;
        if (a.mp < sk.cost) { this.push('MP가 모자라다'); return null; }
        a.mp -= sk.cost;
        beat = this.resolveSkill(a, sk, action.target);
        beat.mpSpent = sk.cost;
        break;
      }
      case 'spell': {
        const m = this.state.member(a.defID);
        const sp = m ? memberSpell(m) : null;
        if (!sp) { this.push('울림석 조합이 완성되지 않았다'); return null; }
        if (a.mp < sp.cost) { this.push('MP가 모자라다'); return null; }
        a.mp -= sp.cost;
        beat = this.resolveSpell(a, sp, action.target);
        beat.mpSpent = sp.cost;
        break;
      }
      case 'item': {
        const it = IDX.item[action.item];
        if (!it || !this.state.consume(action.item)) return null;
        beat = this.useItem(a, it, action.target);
        break;
      }
      case 'guard':
        a.guarding = true;
        beat = this.beat(a, '방어', 'guard', [a.id]);
        this.push(`${a.name}은(는) 몸을 웅크렸다`);
        break;
      case 'swap':
        a.row = a.row === 'front' ? 'back' : 'front';
        beat = this.beat(a, a.row === 'front' ? '전열으로' : '후열으로', 'swap', [a.id]);
        a.atb = GAUGE * 0.5;
        this.waiting = null;
        playSfx('ui_open');
        return beat;
      case 'flee': {
        if (this.isBoss) {
          this.push('도망칠 수 없다!');
          beat = this.beat(a, '도주 실패', 'flee_fail', []);
        } else {
          const mine = this.livingAllies.reduce((s, u) => s + this.eff(u, 'agi'), 0);
          const theirs = Math.max(1, this.livingFoes.reduce((s, u) => s + this.eff(u, 'agi'), 0));
          const chance = Math.min(0.9, 0.35 + (mine / theirs) * 0.3);
          if (Math.random() < chance) {
            this.outcome = 'fled';
            beat = this.beat(a, '도주', 'flee', []);
            beat.fled = true;
            this.push('무사히 빠져나왔다');
          } else {
            beat = this.beat(a, '도주 실패', 'flee_fail', []);
            this.push('길이 막혔다!');
          }
        }
        break;
      }
      default: return null;
    }
    this.waiting = null;
    this.finishTurn(a);
    return beat;
  }

  beat(a, label, animation, targets) {
    return { actorID: a.id, label, animation, targetIDs: targets, damage: {}, heal: {}, revived: [], downed: [], mpSpent: 0, effective: {}, note: '', fled: false };
  }

  physical(a, tid, power, label, anim, element, ranged) {
    const beat = this.beat(a, label, anim, []);
    const t = this.retarget(tid, a.side, !ranged);
    if (!t) return beat;
    beat.targetIDs = [t.id];
    const d = this.physicalDamage(a, t, power, element, ranged);
    this.applyDamage(t, d.amount, beat);
    if (d.scale !== 1) beat.effective[t.id] = d.scale;
    beat.crit = d.crit;
    this.push(`${a.name}의 ${label} → ${t.name}에게 ${d.amount}`);
    return beat;
  }

  retarget(tid, side, melee) {
    const t = this.unit(tid);
    if (t && t.hp > 0 && t.side !== side) return t;
    const pool = melee ? this.meleeTargets(side) : (side === 'ally' ? this.livingFoes : this.livingAllies);
    return pool[0] || null;
  }

  resolveTargets(shape, side, primary, support, melee) {
    const friends = this.units.filter(u => u.side === side);
    const enemies = this.units.filter(u => u.side !== side && u.hp > 0);
    switch (shape) {
      case 'selfOnly': {
        const p = this.unit(primary);
        return p && p.side === side ? [p] : friends.slice(0, 1);
      }
      case 'allyOne': {
        const p = this.unit(primary);
        if (p && p.side === side) return [p];
        const alive = friends.filter(u => u.hp > 0);
        const best = alive.sort((x, y) => x.hp / x.stats.maxHP - y.hp / y.stats.maxHP)[0];
        return best ? [best] : [];
      }
      case 'allyAll': return friends.filter(u => u.hp > 0);
      case 'all': return enemies;
      case 'line': {
        const p = this.unit(primary);
        const row = p ? p.row : 'front';
        const same = enemies.filter(u => u.row === row);
        return same.length ? same : enemies;
      }
      case 'single':
      default: {
        const p = this.unit(primary);
        if (p && p.hp > 0 && p.side !== side) {
          if (melee) {
            const allowed = this.meleeTargets(side).map(u => u.id);
            if (allowed.includes(p.id)) return [p];
          } else return [p];
        }
        const pool = melee ? this.meleeTargets(side) : (side === 'ally' ? this.livingFoes : this.livingAllies);
        return pool.length ? [pool[0]] : [];
      }
    }
  }

  resolveSkill(a, sk, tid) {
    const beat = this.beat(a, sk.name, sk.animation, []);
    const targets = this.resolveTargets(sk.shape, a.side, tid, sk.nature === 'heal' || sk.nature === 'buff' || sk.nature === 'revive', sk.kind === 'physical' && !sk.ranged);
    beat.targetIDs = targets.map(t => t.id);
    const isSupport = sk.nature === 'heal' || sk.nature === 'buff' || sk.nature === 'revive';
    for (const t of targets) {
      if (sk.nature === 'strike' || sk.nature === 'drain') {
        const r = sk.kind === 'physical'
          ? this.physicalDamage(a, t, sk.power, sk.element, !(sk.kind === 'physical' && !sk.ranged))
          : this.magicDamage(a, t, sk.power, sk.element);
        this.applyDamage(t, r.amount, beat);
        if (r.scale !== 1) beat.effective[t.id] = r.scale;
        if (sk.nature === 'drain') this.heal(a, Math.floor(r.amount / 2), beat);
      } else if (sk.nature === 'heal') {
        this.heal(t, sk.power + this.eff(a, 'mag') / 2, beat);
      } else if (sk.nature === 'buff') {
        const key = this.buffKey(sk.element || 'fire');
        t.mods[key] = { scale: 1 + sk.power / 100, turns: 4 };
      } else if (sk.nature === 'debuff') {
        const key = this.buffKey(sk.element || 'earth');
        t.mods[key] = { scale: Math.max(0.4, 1 - sk.power / 100), turns: 4 };
      } else if (sk.nature === 'revive') {
        this.revive(t, 0.3, beat);
      }
    }
    this.push(`${a.name}의 ${sk.name}`);
    return beat;
  }

  resolveSpell(a, sp, tid) {
    const beat = this.beat(a, sp.name, sp.animation, []);
    const isSupport = sp.shape === 'allyOne' || sp.shape === 'allyAll' || sp.shape === 'selfOnly';
    const targets = this.resolveTargets(sp.shape, a.side, tid, isSupport, false);
    beat.targetIDs = targets.map(t => t.id);
    for (const t of targets) {
      if (sp.nature === 'strike' || sp.nature === 'drain') {
        const r = this.magicDamage(a, t, sp.power, sp.element);
        this.applyDamage(t, r.amount, beat);
        if (r.scale !== 1) beat.effective[t.id] = r.scale;
        if (sp.nature === 'drain') this.heal(a, Math.floor(r.amount / 2), beat);
      } else if (sp.nature === 'heal') {
        this.heal(t, sp.power * 2 + this.eff(a, 'mag') / 2, beat);
      } else if (sp.nature === 'buff') {
        const key = this.buffKey(sp.element);
        t.mods[key] = { scale: 1 + sp.power / 60, turns: 3 + sp.tier };
      } else if (sp.nature === 'debuff') {
        const key = this.buffKey(sp.element);
        t.mods[key] = { scale: Math.max(0.4, 1 - sp.power / 70), turns: 3 + sp.tier };
      } else if (sp.nature === 'revive') {
        this.revive(t, 0.25 + 0.15 * (sp.tier - 1), beat);
      }
    }
    beat.note = sp.note;
    beat.element = sp.element;
    this.push(`${a.name}의 울림 — 〈${sp.name}〉`);
    return beat;
  }

  buffKey(el) {
    return { fire: 'atk', thunder: 'atk', earth: 'def', light: 'res', water: 'res', sound: 'mag', wind: 'agi' }[el] || 'atk';
  }

  useItem(a, it, tid) {
    const target = this.unit(tid) || a;
    const anim = it.revive ? 'item_revive' : (it.healMP > 0 && it.healHP > 0 ? 'item_elixir' : it.healMP > 0 ? 'item_mp' : 'item_hp');
    const beat = this.beat(a, it.name, anim, [target.id]);
    if (it.revive && target.hp <= 0) this.revive(target, 0.4, beat);
    else if (target.hp > 0) {
      if (it.healHP > 0) this.heal(target, it.healHP, beat);
      if (it.healMP > 0) target.mp = Math.min(target.stats.maxMP, target.mp + it.healMP);
    }
    this.push(`${a.name}은(는) ${it.name}을(를) 썼다`);
    return beat;
  }

  enemyAI(a) {
    const d = IDX.enemy[a.defID];
    if (!d) return this.beat(a, '…', 'wait', []);
    const usable = (d.skills || []).map(id => IDX.skill[id]).filter(s => s && a.mp >= s.cost);
    const hpRatio = a.hp / Math.max(1, a.stats.maxHP);
    if (hpRatio < 0.35) {
      const h = usable.find(s => s.nature === 'heal');
      if (h && Math.random() < 0.6) {
        a.mp -= h.cost;
        const b = this.resolveSkill(a, h, a.id);
        b.mpSpent = h.cost;
        return b;
      }
    }
    const offensive = usable.filter(s => !(s.nature === 'heal' || s.nature === 'buff' || s.nature === 'revive'));
    if (offensive.length && Math.random() < 0.45) {
      const sk = pick(offensive);
      a.mp -= sk.cost;
      const melee = sk.kind === 'physical' && !sk.ranged;
      const pool = melee ? this.meleeTargets('foe') : this.livingAllies;
      const t = pick(pool);
      const b = this.resolveSkill(a, sk, t ? t.id : null);
      b.mpSpent = sk.cost;
      return b;
    }
    const ranged = this.attacksAtRange(a);
    const pool = ranged ? this.livingAllies : this.meleeTargets('foe');
    const sorted = [...pool].sort((x, y) => (x.hp * rnd(0.7, 1.3)) - (y.hp * rnd(0.7, 1.3)));
    return this.physical(a, sorted[0]?.id || '', 100, '공격', ranged ? 'enemy_ranged' : 'enemy_strike', null, ranged);
  }

  makeResult() {
    const r = {
      victory: this.outcome === 'victory', fled: this.outcome === 'fled',
      exp: 0, coin: 0, turns: this.turns, levelUps: [],
      finalHP: {}, finalMP: {},
    };
    if (r.victory) {
      r.exp = this.foes.reduce((s, u) => s + (u.exp || 0), 0);
      r.coin = this.foes.reduce((s, u) => s + (u.coin || 0), 0);
    }
    for (const a of this.allies) {
      r.finalHP[a.defID] = (r.victory || r.fled) ? Math.max(1, a.hp) : 1;
      r.finalMP[a.defID] = a.mp;
    }
    return r;
  }

  // ── 애니메이션 ─────────────────────────────────────────────────
  async playBeat(beat) {
    const a = this.unit(beat.actorID);
    if (!a) return;
    const preset = IDX.anim[beat.animation] || IDX.anim['default_strike'] || { steps: [{ type: 'wait', duration: 0.3 }] };
    a.pose = beat.animation.startsWith('spell') || beat.animation.includes('cast') ? 'cast'
      : beat.animation.includes('guard') ? 'guard'
      : beat.animation === 'flee' ? 'run' : 'attack';
    a.poseT = 0;
    this.app.onBattleMessage?.(`${a.name} — ${beat.label}`);
    for (const step of preset.steps) {
      if (this.aborted) break;
      await this.doStep(step, beat, a);
    }
    // 결과 표시
    for (const [id, dmg] of Object.entries(beat.damage)) {
      const t = this.unit(id);
      if (!t) continue;
      const eff = beat.effective[id];
      const col = eff && eff > 1 ? '#ffd24e' : eff && eff < 1 ? '#9ec2d8' : '#fff3e0';
      this.popups.push({ x: t.x, y: t.y - t.dh - 8, text: String(dmg), t: 0, life: 1.1, color: col, size: 1.25 });
      if (eff && eff > 1) this.popups.push({ x: t.x, y: t.y - t.dh - 34, text: '효과가 크다!', t: 0, life: 1.2, color: '#ffd24e', size: 0.7 });
      if (eff && eff < 1) this.popups.push({ x: t.x, y: t.y - t.dh - 34, text: '별로다…', t: 0, life: 1.0, color: '#9ec2d8', size: 0.7 });
    }
    for (const [id, h] of Object.entries(beat.heal)) {
      const t = this.unit(id);
      if (t && h > 0) this.popups.push({ x: t.x, y: t.y - t.dh - 8, text: '+' + h, t: 0, life: 1.0, color: '#7ee08a', size: 1.1 });
    }
    for (const id of beat.revived) {
      const t = this.unit(id);
      if (t) this.popups.push({ x: t.x, y: t.y - t.dh - 8, text: '일어남', t: 0, life: 1.2, color: '#f2e2a0', size: 0.85 });
    }
    a.pose = 'idle';
    if (this.outcome === 'ongoing') this.check();
    await sleep(120);
  }

  async doStep(step, beat, a) {
    const dur = Math.max(0.02, step.duration || 0.2);
    const targets = (beat.targetIDs || []).map(id => this.unit(id)).filter(Boolean);
    const t = targets[0] || this.livingFoes[0] || a;
    if (step.sfx) for (const s of step.sfx) playSfx(s, 0.9);
    switch (step.type) {
      case 'cast': {
        const c = step.color || '#b58ae0';
        this.beams.push({ x: a.x, y: a.y - a.dh * 0.4, t: 0, life: dur + 0.1, color: c, kind: 'rune', r: a.dh * 0.5 });
        this.burst(a.x, a.y - a.dh * 0.45, 10, c, 0.5);
        await sleep(dur * 1000);
        break;
      }
      case 'dash': {
        const dx = (t.x - a.x) * 0.55, dy = (t.y - a.y) * 0.55;
        const t0 = performance.now();
        await new Promise(res => {
          const tickFn = now => {
            const k = Math.min(1, (now - t0) / (dur * 1000));
            a.kx = dx * k; a.ky = dy * k;
            if (k < 1) requestAnimationFrame(tickFn); else res();
          };
          requestAnimationFrame(tickFn);
        });
        break;
      }
      case 'strike': {
        const c = step.color || '#ffffff';
        const n = step.count || 1;
        for (let i = 0; i < n; i++) {
          this.slashes.push({ x: t.x, y: t.y - t.dh * 0.5, t: 0, life: 0.28, color: c, ang: rnd(-0.9, 0.9), len: t.dh * 0.9 });
          this.burst(t.x, t.y - t.dh * 0.5, 8, c, 0.4);
        }
        await sleep(dur * 1000);
        break;
      }
      case 'flash': {
        const c = step.color || '#ffffff';
        for (const u of (targets.length ? targets : [t])) {
          u.flash = { t: 0, life: dur + 0.12, color: c };
          this.burst(u.x, u.y - u.dh * 0.5, 10, c, 0.5);
        }
        if (step.sfx?.length) playSfx('hit', 0.9);
        await sleep(dur * 1000);
        break;
      }
      case 'knockback': {
        const dir = t.side === 'ally' ? 1 : -1;
        const t0 = performance.now();
        await new Promise(res => {
          const tickFn = now => {
            const k = Math.min(1, (now - t0) / (dur * 1000));
            const shake = Math.sin(k * Math.PI);
            t.kx = dir * shake * 16;
            if (k < 1) requestAnimationFrame(tickFn); else { t.kx = 0; res(); }
          };
          requestAnimationFrame(tickFn);
        });
        break;
      }
      case 'shake':
        this.shake = Math.max(this.shake, (step.magnitude || 1) * 8);
        await sleep(dur * 1000);
        break;
      case 'particle':
        this.burst(t.x, t.y - t.dh * 0.5, step.count || 14, step.color || '#ffffff', 0.7);
        await sleep(dur * 1000);
        break;
      case 'projectile': {
        const c = step.color || '#ffffff';
        const t0 = performance.now();
        await new Promise(res => {
          const tickFn = now => {
            const k = Math.min(1, (now - t0) / (dur * 1000));
            this.proj = { x0: a.x, y0: a.y - a.dh * 0.55, x1: t.x, y1: t.y - t.dh * 0.5, k, color: c };
            if (k < 1) requestAnimationFrame(tickFn); else { this.proj = null; res(); }
          };
          requestAnimationFrame(tickFn);
        });
        break;
      }
      case 'pillar': {
        this.beams.push({ x: t.x, y: t.y, t: 0, life: dur + 0.3, color: step.color || '#f2e2a0', kind: 'pillar', w: t.dw * 0.9 });
        await sleep(dur * 1000);
        break;
      }
      case 'ring': {
        this.rings = this.rings || [];
        this.rings.push({ x: t.x, y: t.y - t.dh * 0.5, t: 0, life: dur + 0.4, color: step.color || '#f2c14e', max: t.dw * 1.8 });
        await sleep(dur * 1000);
        break;
      }
      case 'rain': {
        for (let i = 0; i < (step.count || 12); i++) {
          this.particles.push({ x: t.x + rnd(-t.dw, t.dw), y: t.y - t.dh - rnd(0, 40), vx: 0, vy: rnd(120, 260), t: 0, life: dur + rnd(0, 0.3), color: step.color || '#ffffff', s: 2 });
        }
        await sleep(dur * 1000);
        break;
      }
      case 'screen':
        this.flash = { t: 0, life: dur + 0.15, color: step.color || '#ffffff' };
        await sleep(dur * 1000);
        break;
      case 'fx': {
        const name = step.sheet;
        if (name && sheet(name)) {
          this.fx = { name, x: t.x, y: t.y - t.dh * 0.55, t: 0, life: Math.max(dur, 0.4), size: t.dh * 1.1 };
          await sleep(Math.max(dur, 0.4) * 1000);
        } else {
          this.burst(t.x, t.y - t.dh * 0.5, 16, step.color || '#ffffff', 0.6);
          await sleep(dur * 1000);
        }
        break;
      }
      case 'return': {
        const t0 = performance.now();
        const sx = a.kx, sy = a.ky;
        await new Promise(res => {
          const tickFn = now => {
            const k = Math.min(1, (now - t0) / (dur * 1000));
            a.kx = sx * (1 - k); a.ky = sy * (1 - k);
            if (k < 1) requestAnimationFrame(tickFn); else { a.kx = 0; a.ky = 0; res(); }
          };
          requestAnimationFrame(tickFn);
        });
        break;
      }
      case 'wait':
        await sleep(dur * 1000);
        break;
      default:
        await sleep(dur * 1000);
    }
  }

  burst(x, y, n, color, spread = 0.5) {
    for (let i = 0; i < n; i++) {
      const ang = rnd(0, Math.PI * 2), sp = rnd(40, 190) * spread;
      this.particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 30, t: 0, life: rnd(0.3, 0.8), color, s: rnd(1.5, 3.5) });
    }
  }

  // ── 화면 ───────────────────────────────────────────────────────
  update(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 40);
    for (const u of this.units) {
      if (u.flash) { u.flash.t += dt; if (u.flash.t > u.flash.life) u.flash = null; }
      if (u.dispHp > u.hp) u.dispHp = Math.max(u.hp, u.dispHp - dt * Math.max(20, (u.dispHp - u.hp) * 4));
      else u.dispHp = u.hp;
      if (u.poseT !== undefined) u.poseT += dt;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 220 * dt;
      if (p.t > p.life) this.particles.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]; p.t += dt;
      if (p.t > p.life) this.popups.splice(i, 1);
    }
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i]; s.t += dt;
      if (s.t > s.life) this.slashes.splice(i, 1);
    }
    for (let i = (this.beams || []).length - 1; i >= 0; i--) {
      const b = this.beams[i]; b.t += dt;
      if (b.t > b.life) this.beams.splice(i, 1);
    }
    for (let i = (this.rings || []).length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt;
      if (r.t > r.life) this.rings.splice(i, 1);
    }
    if (this.flash) { this.flash.t += dt; if (this.flash.t > this.flash.life) this.flash = null; }
    if (this.fx) { this.fx.t += dt; if (this.fx.t > this.fx.life) this.fx = null; }
  }

  draw(bgName) {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (this.shake > 0.2) ctx.translate(rnd(-this.shake, this.shake), rnd(-this.shake, this.shake));
    // 배경
    const bg = this.app.bgImage;
    if (bg) {
      const scale = Math.max(W / bg.width, H / bg.height);
      const dw = bg.width * scale, dh = bg.height * scale;
      ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2 - H * 0.02, dw, dh);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1b1630'); g.addColorStop(1, '#0c0a14');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // 바닥 어둡게
    const gg = ctx.createLinearGradient(0, H * 0.5, 0, H);
    gg.addColorStop(0, 'rgba(8,6,14,0)'); gg.addColorStop(1, 'rgba(8,6,14,.85)');
    ctx.fillStyle = gg; ctx.fillRect(0, H * 0.5, W, H * 0.5);

    // 유닛 — 아래(가까운) 것부터
    const order = [...this.units].sort((a, b) => a.hy - b.hy);
    for (const u of order) {
      const s = sheet(u.sprite);
      if (!s) continue;
      let row = 0, col = 0;
      if (u.side === 'ally') {
        col = Math.floor((this.time * 6) % 4);
        row = 0;
        if (u.pose === 'attack') { row = 2; col = Math.min(5, Math.floor(u.poseT * 14)); }
        else if (u.pose === 'cast') { row = 3; col = Math.floor((u.poseT * 8) % 4); }
        else if (u.pose === 'guard') { row = 7; col = Math.floor((u.poseT * 6) % 2); }
        else if (u.pose === 'run') { row = 1; col = Math.floor((u.poseT * 10) % 4); }
        else if (u.hp <= 0) { row = 5; col = 1; }
        if (u.hp <= 0) { row = 5; col = 1; }
      } else {
        row = 0; col = Math.floor((this.time * 4 + u.hx) % 4);
        if (u.pose === 'attack') { row = 1; col = Math.min(3, Math.floor(u.poseT * 10)); }
        if (u.hp <= 0) { row = 2; col = 1; }
      }
      const x = Math.round(u.x + u.kx - u.dw / 2);
      const y = Math.round(u.y + u.ky - u.dh);
      // 그림자
      ctx.save();
      ctx.globalAlpha = 0.32; ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(u.x + u.kx, u.y + u.ky - 2, u.dw * 0.34, u.dw * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const bob = u.side === 'ally' && u.hp > 0 ? Math.sin(this.time * 2.2 + u.hx) * 2 : 0;
      drawFrame(ctx, u.sprite, col, row, x, y + bob, u.dw, u.dh);
      if (u.hp <= 0) { ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = '#1a1424'; ctx.fillRect(x, y + bob, u.dw, u.dh); ctx.restore(); }
      if (u.flash) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - u.flash.t / u.flash.life) * 0.85;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = u.flash.color;
        ctx.fillRect(x, y + bob, u.dw, u.dh);
        ctx.restore();
      }
      u.bx = x; u.by = y;
    }

    // 이펙트
    for (const b of this.beams || []) {
      const k = b.t / b.life;
      ctx.save();
      if (b.kind === 'pillar') {
        const w = b.w * (1 - k * 0.35);
        const grad = ctx.createLinearGradient(b.x, b.y - H * 0.5, b.x, b.y);
        grad.addColorStop(0, rgba(b.color, 0));
        grad.addColorStop(1, rgba(b.color, 0.75 * (1 - k)));
        ctx.fillStyle = grad;
        ctx.fillRect(b.x - w / 2, b.y - H * 0.6, w, H * 0.6);
      } else if (b.kind === 'rune') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(b.x, b.y + i * 6, b.r * (0.6 + i * 0.25), b.r * 0.22, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    for (const r of this.rings || []) {
      const k = r.t / r.life;
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(1, 3 * (1 - k));
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.max * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const s of this.slashes) {
      const k = s.t / s.life;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(2, 9 * (1 - k));
      ctx.beginPath();
      const r = s.len * 0.55;
      ctx.arc(s.x, s.y, r, s.ang - 0.8 + k, s.ang + 0.7 + k);
      ctx.stroke();
      ctx.restore();
    }
    if (this.proj) {
      const p = this.proj;
      const x = p.x0 + (p.x1 - p.x0) * p.k, y = p.y0 + (p.y1 - p.y0) * p.k - Math.sin(p.k * Math.PI) * 30;
      ctx.save();
      ctx.shadowColor = p.color; ctx.shadowBlur = 12;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (this.fx) {
      const f = this.fx, s = sheet(f.name);
      if (s) {
        const k = f.t / f.life;
        const col = Math.min(s.cols - 1, Math.floor(k * s.cols));
        const sz = f.size * (0.6 + k * 0.5);
        ctx.save();
        ctx.globalAlpha = 1 - k * 0.25;
        ctx.drawImage(s.img, col * s.fw, 0, s.fw, s.fh, f.x - sz / 2, f.y - sz / 2, sz, sz);
        ctx.restore();
      }
    }
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s || 2, p.s || 2);
      ctx.restore();
    }
    for (const p of this.popups) {
      const k = p.t / p.life;
      ctx.save();
      ctx.globalAlpha = 1 - Math.max(0, k - 0.6) / 0.4;
      ctx.font = `bold ${Math.round(26 * p.size)}px Galmuri11, monospace`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = '#1a1424';
      const y = p.y - k * 26;
      ctx.strokeText(p.text, p.x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, y);
      ctx.restore();
    }
    // 아군 머리 위 ATB
    for (const u of this.allies) {
      if (!u.bx) continue;
      const p = u.hp > 0 ? u.atb / GAUGE : 0;
      const w = Math.min(70, u.dw * 0.9), x = u.x - w / 2, y = u.by - 8;
      ctx.fillStyle = 'rgba(10,8,16,.8)';
      ctx.fillRect(x, y, w, 5);
      ctx.fillStyle = p >= 1 ? '#f2c14e' : '#6b5a8a';
      ctx.fillRect(x + 1, y + 1, (w - 2) * clamp(p, 0, 1), 3);
    }
    ctx.restore();
    if (this.flash) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - this.flash.t / this.flash.life) * 0.5;
      ctx.fillStyle = this.flash.color;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }
}
