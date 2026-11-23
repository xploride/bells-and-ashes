// core.js — 자료 불러오기, 그림 캐시, 그리기 도우미
export const DATA = {};

const DATA_FILES = ['maps', 'events', 'characters', 'enemies', 'stones', 'spellnames', 'skills', 'items', 'animations'];

export async function loadData(onStep) {
  for (const n of DATA_FILES) {
    const r = await fetch(`data/${n}.json`, { cache: 'force-cache' });
    DATA[n] = await r.json();
    if (onStep) onStep(n);
  }
  buildIndex();
}

export const IDX = { map: {}, event: {}, char: {}, enemy: {}, stone: {}, skill: {}, item: {}, anim: {}, node: {} };
export let EVENT_ORDER = [];

function buildIndex() {
  for (const m of DATA.maps) IDX.map[m.id] = m;
  for (const e of DATA.events) IDX.event[e.id] = e;
  EVENT_ORDER = DATA.events.map(e => e.id);
  for (const c of DATA.characters) IDX.char[c.id] = c;
  for (const e of DATA.enemies) IDX.enemy[e.id] = e;
  for (const s of DATA.stones) IDX.stone[s.id] = s;
  for (const s of DATA.skills) IDX.skill[s.id] = s;
  for (const i of DATA.items) IDX.item[i.id] = i;
  for (const a of DATA.animations) IDX.anim[a.id] = a;
}

// ── 그림 ────────────────────────────────────────────────────────────
export const IMG = {};
let manifest = [];

export async function loadImages(onProgress) {
  const list = await fetch('assets/manifest.json').then(r => r.json());
  manifest = list.filter(n => !['manifest', 'app_icon', 'TILE_REPEAT_PREVIEW'].includes(n));
  let done = 0;
  const CONC = 12;
  let cursor = 0;
  async function worker() {
    while (cursor < manifest.length) {
      const name = manifest[cursor++];
      const img = new Image();
      img.src = `assets/${name}.png`;
      try { await img.decode(); } catch (e) { /* 빈 그림은 무시 */ }
      IMG[name] = img;
      done++;
      if (onProgress) onProgress(done, manifest.length);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
}

export function img(name) { return IMG[name] || null; }
export function hasImg(name) { return !!IMG[name]; }

/** 이름 규칙으로 시트 칸 크기·개수를 돌려준다 (SpriteSheets.swift 와 같은 규칙) */
const SHEET_CACHE = {};
export function sheet(name) {
  if (SHEET_CACHE[name]) return SHEET_CACHE[name];
  const im = IMG[name];
  if (!im) return null;
  let cols = 1, rows = 1, fw = im.width, fh = im.height;
  if (name.startsWith('tiles_')) { cols = 8; fw = fh = 24; rows = Math.round(im.height / 24); }
  else if (name.startsWith('chr_') || name.startsWith('npc_')) { cols = 8; rows = 4; fw = 24; fh = 36; }
  else if (name.startsWith('bat_')) { cols = 8; rows = 8; fw = 32; fh = 40; }
  else if (name.startsWith('enm_')) { cols = 4; rows = 3; fw = im.width / 4; fh = im.height / 3; }
  else if (name.startsWith('fx_')) { cols = 6; rows = 1; fw = im.width / 6; fh = im.height; }
  else if (name.startsWith('edge_')) { cols = 8; rows = 8; fw = im.width / 8; fh = im.height / 8; }
  else if (name.startsWith('cliff_')) { cols = 3; rows = 2; fw = im.width / 3; fh = im.height / 2; }
  const s = { img: im, cols, rows, fw, fh };
  SHEET_CACHE[name] = s;
  return s;
}

export function drawFrame(ctx, name, col, row, x, y, w, h, opt = {}) {
  const s = sheet(name);
  if (!s) return;
  const { flip = false, alpha = 1, tint = null } = opt;
  ctx.save();
  if (alpha !== 1) ctx.globalAlpha *= alpha;
  const sx = col * s.fw, sy = row * s.fh;
  if (flip) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(s.img, sx, sy, s.fw, s.fh, 0, 0, w, h);
  } else {
    ctx.drawImage(s.img, sx, sy, s.fw, s.fh, x, y, w, h);
  }
  if (tint) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = tint;
    ctx.fillRect(flip ? 0 : x, flip ? 0 : y, w, h);
  }
  ctx.restore();
}

/** 4분할 오버레이 (경계 오토타일) */
export function drawQuarter(ctx, name, qcol, qrow, x, y, w, h, alpha = 1) {
  const s = sheet(name);
  if (!s) return;
  ctx.save();
  if (alpha !== 1) ctx.globalAlpha *= alpha;
  ctx.drawImage(s.img, qcol * s.fw, qrow * s.fh, s.fw, s.fh, x, y, w, h);
  ctx.restore();
}

// ── 수학 · 잡동사니 ────────────────────────────────────────────────
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
export const irnd = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const easeOut = t => 1 - (1 - t) * (1 - t);
export const easeInOut = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** requestAnimationFrame 으로 도는 트윈 (초 단위) */
export function tween(dur, fn) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / (dur * 1000));
      fn(t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export function store(key, val) {
  try {
    if (val === undefined) {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }
    localStorage.setItem(key, JSON.stringify(val));
    return true;
  } catch (e) { return null; }
}
