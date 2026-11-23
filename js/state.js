// state.js — 진행 상태 · 파티 · 울림석 조합 · 오픈 시나리오 이벤트 엔진
import { DATA, IDX, EVENT_ORDER, store } from './core.js';
import { playSfx } from './audio.js';

export const ELEMENT_KR = { fire: '불', water: '물', wind: '바람', earth: '땅', light: '빛', sound: '소리', thunder: '번개' };
export const SHAPE_KR = { single: '단일', line: '열', all: '전체', selfOnly: '자신', allyOne: '아군 하나', allyAll: '아군 전체' };
export const NATURE_KR = { strike: '타격', heal: '치유', buff: '강화', debuff: '약화', revive: '부활', drain: '흡수' };
export const SLOT_KR = { base: '속성 돌', form: '형태 돌', tone: '성질 돌' };
export const SLOT_GLYPH = { base: '基', form: '格', tone: '響' };
export const ELEMENT_HEX = { fire: '#e2703a', water: '#5aa9e6', wind: '#7ee0a0', earth: '#c9a06a',
  light: '#f2e2a0', sound: '#b58ae0', thunder: '#f2d24e' };

// ── 능력치 ────────────────────────────────────────────────────────
export function statsOf(defID, level) {
  const d = IDX.char[defID];
  if (!d) return { maxHP: 1, maxMP: 0, atk: 1, def: 1, mag: 1, res: 1, agi: 1 };
  const b = d.baseStats, g = d.growth, k = Math.max(0, level - 1);
  return {
    maxHP: b.maxHP + g.maxHP * k, maxMP: b.maxMP + g.maxMP * k,
    atk: b.atk + g.atk * k, def: b.def + g.def * k,
    mag: b.mag + g.mag * k, res: b.res + g.res * k, agi: b.agi + g.agi * k,
  };
}

export const expToNext = lv => 20 + lv * lv * 6 + lv * 10;

export function makeMember(defID, level = 1) {
  const d = IDX.char[defID];
  const s = statsOf(defID, level);
  return {
    defID, level, exp: 0, hp: s.maxHP, mp: s.maxMP,
    row: d?.defaultRow || 'front',
    loadout: { base: null, form: null, tone: null },
  };
}

export function memberStats(m) { return statsOf(m.defID, m.level); }
export function clampVitals(m) {
  const s = memberStats(m);
  m.hp = Math.max(0, Math.min(m.hp, s.maxHP));
  m.mp = Math.max(0, Math.min(m.mp, s.maxMP));
}

export function gainExp(m, amount) {
  m.exp += amount;
  let ups = 0;
  while (m.level < 60 && m.exp >= expToNext(m.level)) {
    m.exp -= expToNext(m.level);
    m.level++;
    ups++;
    const s = memberStats(m);
    m.hp = Math.min(s.maxHP, m.hp + Math.floor(s.maxHP / 6));
    m.mp = Math.min(s.maxMP, m.mp + Math.floor(s.maxMP / 5));
  }
  return ups;
}

// ── 울림석 조합 ───────────────────────────────────────────────────
const NATURE_BASE = { strike: 22, drain: 16, heal: 20, buff: 12, debuff: 12, revive: 1 };
const COST_BASE = { strike: 6, drain: 8, heal: 7, buff: 9, debuff: 8, revive: 18 };
const POWER_SCALE = { single: 1, allyOne: 1, selfOnly: 1, line: 0.72, all: 0.55, allyAll: 0.55 };
const COST_SCALE = { single: 1, allyOne: 1, selfOnly: 0.7, line: 1.6, all: 2.2, allyAll: 2.2 };
const isSupport = n => n === 'heal' || n === 'buff' || n === 'revive';
const targetsAllies = s => s === 'selfOnly' || s === 'allyOne' || s === 'allyAll';

export function compose(loadout, affinities, magStat) {
  const { base, form, tone } = loadout;
  if (!base || !form || !tone) return null;
  const b = IDX.stone[base], f = IDX.stone[form], t = IDX.stone[tone];
  if (!b || !f || !t || !b.element || !f.shape || !t.nature) return null;
  const element = b.element, shape = f.shape, nature = t.nature;
  let eff = shape;
  if (nature === 'revive' && !targetsAllies(shape)) eff = 'allyOne';
  if (isSupport(nature) && !targetsAllies(eff)) eff = (shape === 'all' || shape === 'line') ? 'allyAll' : 'allyOne';
  if (!isSupport(nature) && nature !== 'debuff' && targetsAllies(eff) && nature !== 'heal') {
    eff = (shape === 'allyAll') ? 'all' : 'single';
  }
  const tier = Math.max(b.tier, f.tier, t.tier);
  const attuned = affinities.includes(element);
  const tierScale = 1 + 0.45 * (tier - 1);
  const attuneScale = attuned ? 1.25 : 0.85;
  const magScale = 1 + magStat / 120;
  let power = NATURE_BASE[nature] * POWER_SCALE[eff] * tierScale * attuneScale;
  if (nature !== 'revive' && nature !== 'buff' && nature !== 'debuff') power *= magScale;
  let cost = COST_BASE[nature] * COST_SCALE[eff] * (1 + 0.35 * (tier - 1));
  cost *= attuned ? 0.8 : 1.15;
  const name = spellName(element, eff, nature, tier);
  let note = `${ELEMENT_KR[element]}·${SHAPE_KR[eff]}·${NATURE_KR[nature]}`;
  if (attuned) note += ' · 적성';
  if (eff !== shape) note += ' · 형태 교정';
  return {
    name, element, shape: eff, nature, tier,
    power: Math.max(1, Math.round(power)), cost: Math.max(1, Math.round(cost)),
    animation: spellAnim(element, eff, nature), note,
  };
}

function romanTier(t) { return t === 2 ? 'Ⅱ' : t === 3 ? 'Ⅲ' : t === 4 ? 'Ⅳ' : 'Ⅰ'; }

function spellName(element, shape, nature, tier) {
  const table = DATA.spellnames;
  for (const k of [`${element}.${nature}.${shape}`, `${element}.${nature}`]) {
    if (table[k]) return tier > 1 ? `${table[k]}·${romanTier(tier)}` : table[k];
  }
  const fb = `${ELEMENT_KR[element]} ${NATURE_KR[nature]}`;
  return tier > 1 ? `${fb}·${romanTier(tier)}` : fb;
}

function spellAnim(element, shape, nature) {
  if (isSupport(nature) || nature === 'revive') return `spell_${nature}_${element}`;
  const base = (shape === 'all' || shape === 'line') ? 'spell_wide_' : 'spell_single_';
  if (nature === 'debuff' || nature === 'drain') return base + element + '_' + nature;
  return base + element;
}

export function memberSpell(m) {
  const d = IDX.char[m.defID];
  const s = memberStats(m);
  return compose(m.loadout, d?.affinities || [], s.mag);
}

// ── 게임 상태 ─────────────────────────────────────────────────────
const SAVE_KEY = 'bells_and_ashes_save_v1';

export class GameState {
  constructor() {
    this.party = [];
    this.flags = new Set();
    this.completed = new Set();
    this.stones = [];
    this.items = {};
    this.coin = 0;
    this.mapID = 'selain_belltower';
    this.pos = { x: 6, y: 10 };
    this.playTime = 0;
  }

  newGame() {
    this.party = [makeMember('lien', 1)];
    this.flags = new Set();
    this.completed = new Set();
    this.stones = [];
    this.items = { itm_bread: 3 };
    this.coin = 40;
    this.mapID = 'selain_belltower';
    const m = IDX.map[this.mapID];
    this.pos = { ...(m?.spawn || { x: 6, y: 10 }) };
    this.playTime = 0;
    this.save();
  }

  // 파티
  member(id) { return this.party.find(m => m.defID === id) || null; }
  hasMember(id) { return this.party.some(m => m.defID === id); }
  get activeParty() { return this.party.slice(0, 4); }
  join(id) {
    if (this.hasMember(id) || !IDX.char[id]) return false;
    const avg = this.party.length ? Math.max(1, Math.floor(this.party.reduce((a, m) => a + m.level, 0) / this.party.length)) : 1;
    this.party.push(makeMember(id, avg));
    return true;
  }
  restAll() { for (const m of this.party) { const s = memberStats(m); m.hp = s.maxHP; m.mp = s.maxMP; } }

  // 플래그 · 아이템 · 돌
  setFlag(f) { if (f) this.flags.add(f); }
  hasFlag(f) { return this.flags.has(f); }
  giveStone(id) { if (IDX.stone[id] && !this.stones.includes(id)) this.stones.push(id); }
  stonesFor(slot) {
    return this.stones.map(id => IDX.stone[id]).filter(s => s && s.slot === slot)
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }
  stoneHolder(stoneID, excluding) {
    for (const m of this.party) {
      if (m.defID === excluding) continue;
      const l = m.loadout;
      if (l.base === stoneID || l.form === stoneID || l.tone === stoneID) return m.defID;
    }
    return null;
  }
  equip(memberID, slot, stoneID) {
    if (stoneID) {
      const holder = this.stoneHolder(stoneID, memberID);
      if (holder) {
        const h = this.member(holder);
        for (const k of ['base', 'form', 'tone']) if (h.loadout[k] === stoneID) h.loadout[k] = null;
      }
    }
    const m = this.member(memberID);
    if (m) m.loadout[slot] = stoneID || null;
  }
  give(itemID, n = 1) {
    if (!IDX.item[itemID]) return;
    this.items[itemID] = (this.items[itemID] || 0) + n;
  }
  consume(itemID) {
    if (!this.items[itemID]) return false;
    this.items[itemID]--;
    if (this.items[itemID] <= 0) delete this.items[itemID];
    return true;
  }
  count(itemID) { return this.items[itemID] || 0; }
  wallet() { return this.coin; }
  itemList() {
    return Object.entries(this.items)
      .map(([id, n]) => ({ def: IDX.item[id], n }))
      .filter(x => x.def)
      .sort((a, b) => a.def.kind.localeCompare(b.def.kind) || a.def.id.localeCompare(b.def.id));
  }

  // 저장
  snapshot() {
    return {
      v: 1,
      party: this.party.map(m => ({ ...m, loadout: { ...m.loadout } })),
      flags: [...this.flags], completed: [...this.completed],
      stones: [...this.stones], items: { ...this.items }, coin: this.coin,
      mapID: this.mapID, pos: { ...this.pos }, playTime: this.playTime,
      savedAt: Date.now(),
    };
  }
  save() { store(SAVE_KEY, this.snapshot()); }
  hasSave() { return !!store(SAVE_KEY); }
  saveInfo() {
    const s = store(SAVE_KEY);
    if (!s) return null;
    const lead = s.party?.[0];
    const c = lead ? IDX.char[lead.defID] : null;
    return { map: IDX.map[s.mapID]?.name || s.mapID, lv: lead?.level || 1,
      name: c?.name || '리엔', at: s.savedAt, stones: s.stones?.length || 0 };
  }
  load() {
    const s = store(SAVE_KEY);
    if (!s) return false;
    this.party = s.party.map(m => ({ ...m, loadout: { base: null, form: null, tone: null, ...(m.loadout || {}) } }));
    for (const m of this.party) clampVitals(m);
    this.flags = new Set(s.flags || []);
    this.completed = new Set(s.completed || []);
    this.stones = s.stones || [];
    this.items = s.items || {};
    this.coin = s.coin || 0;
    this.mapID = IDX.map[s.mapID] ? s.mapID : 'selain_belltower';
    const m = IDX.map[this.mapID];
    this.pos = s.pos && m ? { x: s.pos.x, y: s.pos.y } : { ...m.spawn };
    this.playTime = s.playTime || 0;
    return true;
  }
}

// ── 오픈 시나리오 엔진 ────────────────────────────────────────────
export const Events = {
  satisfied(c, s) {
    switch (c.type) {
      case 'flag': return s.hasFlag(c.value);
      case 'notFlag': return !s.hasFlag(c.value);
      case 'event': return s.completed.has(c.value);
      case 'notEvent': return !s.completed.has(c.value);
      case 'item': return s.count(c.value) >= (c.amount ?? 1);
      case 'stone': return s.stones.includes(c.value);
      case 'member': return s.hasMember(c.value);
      case 'level': return Math.max(...s.party.map(m => m.level), 1) >= (c.amount ?? 1);
      case 'partySize': return s.party.length >= (c.amount ?? 1);
      default: return false;
    }
  },
  isOpen(e, s) {
    if (s.completed.has(e.id)) return false;
    return e.conditions.every(c => Events.satisfied(c, s));
  },
  openOn(mapID, s) {
    return EVENT_ORDER.map(id => IDX.event[id]).filter(e => e && e.map === mapID && Events.isOpen(e, s));
  },
  forNPC(npcID, mapID, s) {
    const open = Events.openOn(mapID, s).filter(e => e.npc === npcID);
    return open.find(e => e.kind === 'main') || open[0] || null;
  },
  auto(mapID, s) {
    return Events.openOn(mapID, s).find(e => !e.npc) || null;
  },
  markers(mapID, s) {
    const out = {};
    for (const e of Events.openOn(mapID, s)) {
      if (!e.npc) continue;
      if (out[e.npc] === 'main') continue;
      out[e.npc] = e.kind;
    }
    return out;
  },
  progress(s) {
    let md = 0, mt = 0, od = 0, ot = 0;
    for (const id of EVENT_ORDER) {
      const e = IDX.event[id];
      if (!e) continue;
      const done = s.completed.has(id);
      if (e.kind === 'main') { mt++; if (done) md++; }
      else { ot++; if (done) od++; }
    }
    return { md, mt, od, ot };
  },
  complete(e, s) {
    s.completed.add(e.id);
    for (const f of e.setFlags || []) s.setFlag(f);
    for (const r of e.rewards || []) Events.reward(r, s);
    s.save();
  },
  reward(r, s) {
    switch (r.type) {
      case 'stone': s.giveStone(r.value); break;
      case 'item': s.give(r.value, r.amount ?? 1); break;
      case 'member': s.join(r.value); break;
      case 'coin': s.coin += (r.amount ?? 0); break;
      case 'exp': for (const m of s.activeParty) gainExp(m, r.amount ?? 0); break;
      case 'flag': s.setFlag(r.value); break;
      case 'heal': s.restAll(); break;
    }
  },
  describe(rewards = []) {
    const out = [];
    for (const r of rewards) {
      switch (r.type) {
        case 'stone': { const st = IDX.stone[r.value]; if (st) out.push({ icon: `icon_base_${st.element || 'sound'}`, text: `울림석 〈${st.name}〉 [${SLOT_GLYPH[st.slot]}]` }); break; }
        case 'item': { const it = IDX.item[r.value]; if (it) out.push({ icon: `icon_${it.id}`, text: `${it.name} ×${r.amount ?? 1}` }); break; }
        case 'member': { const c = IDX.char[r.value]; if (c) out.push({ icon: c.portrait, text: `${c.name} 합류` }); break; }
        case 'coin': out.push({ icon: null, text: `${r.amount ?? 0} 셰켈` }); break;
        case 'exp': out.push({ icon: null, text: `경험치 ${r.amount ?? 0}` }); break;
        case 'heal': out.push({ icon: null, text: '체력 회복' }); break;
      }
    }
    return out;
  },
};

// ── 대화 진행기 ───────────────────────────────────────────────────
export class DialogueSession {
  constructor(event, state) {
    this.event = event;
    this.state = state;
    this.index = 0;
    this.finished = false;
    this.started = false;
    this.lastSpeaker = '';
  }

  idleEvent(npc, map) {
    return {
      id: `__idle_${npc.id}`, title: npc.name, kind: 'optional', map: map.id, npc: npc.id,
      conditions: [], script: [{ speaker: npc.name, text: npc.idleLine }], rewards: [], setFlags: [], summary: '',
    };
  }

  /** 다음 멈춤 지점까지 진행: {line} · {battle} · {end} */
  next() {
    const st = this.state;
    let guard = 0;
    while (this.index < this.event.script.length && guard++ < 600) {
      const line = this.event.script[this.index];
      const text = line.text;
      if (text && text.length) {
        this.lastSpeaker = line.speaker || '';
        this.index++;
        return { type: 'line', speaker: line.speaker || '', text };
      }
      const op = line.op;
      if (!op) { this.index++; continue; }
      switch (op) {
        case 'battle': {
          let raw = line.arg || '';
          let boss = false;
          if (raw.startsWith('boss:')) { boss = true; raw = raw.slice(5); }
          const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
          if (!ids.length) { this.index++; break; }
          return { type: 'battle', enemyIDs: ids, isBoss: boss };
        }
        case 'take': if (line.arg && st.consume(line.arg)) playSfx('ui_take'); break;
        case 'setFlag': st.setFlag(line.arg); break;
        case 'give': this.#give(line.arg); break;
        case 'join':
          if (line.arg && !st.hasMember(line.arg)) { st.join(line.arg); playSfx('ui_join'); }
          break;
        case 'warp': {
          const p = (line.arg || '').split(':');
          if (p.length === 3) { st.mapID = p[0]; st.pos = { x: +p[1], y: +p[2] }; this.warped = true; }
          break;
        }
        case 'heal': st.restAll(); playSfx('ui_rest'); break;
        case 'coin': st.coin += parseInt(line.arg || '0', 10) || 0; playSfx('ui_coin'); break;
        case 'choice': this.pendingChoice = (line.arg || '').split('|'); break;
        default: break;
      }
      if (this.pendingChoice) { const c = this.pendingChoice; this.pendingChoice = null; this.index++; return { type: 'choice', options: c }; }
      this.index++;
    }
    this.#finish();
    return { type: 'end' };
  }

  #give(arg) {
    const p = (arg || '').split(':');
    if (p.length < 2) return;
    const n = p.length >= 3 ? parseInt(p[2], 10) || 1 : 1;
    if (p[0] === 'stone') { this.state.giveStone(p[1]); playSfx('ui_get_stone'); }
    else if (p[0] === 'item') {
      this.state.give(p[1], n);
      playSfx(IDX.item[p[1]]?.kind === 'key' ? 'ui_get_key' : 'ui_get_item');
    }
  }

  resumeAfterBattle(victory) {
    if (!victory) { this.finished = true; return; }
    this.index++;
  }

  #finish() {
    if (this.finished) return;
    this.finished = true;
    if (!this.event.id.startsWith('__idle_')) {
      this.rewardSummary = Events.describe(this.event.rewards || []);
      Events.complete(this.event, this.state);
    } else {
      this.rewardSummary = [];
    }
  }
}
