// main.js — 부팅 · 타이틀 · 게임 루프 · 화면 전환 · 입력
import { DATA, IDX, IMG, loadData, loadImages, clamp, sleep, IMG as IMAGES } from './core.js';
import { A, playSfx } from './audio.js';
import { TRACKS, BGM_FOR } from './tracks.js';
import { GameState, Events, DialogueSession, memberSpell, gainExp, memberStats, ELEMENT_KR } from './state.js';
import { Field } from './field.js';
import { Battle } from './battle.js';
import * as ui from './ui.js';

const $ = id => document.getElementById(id);

const app = {
  canvas: $('game'),
  ctx: null,
  W: 0, H: 0,
  state: null,
  field: null,
  battle: null,
  mode: 'boot',
  dialogue: null,
  bgImage: null,
  crt: true,
  busy: false,
  autoTimer: null,
};

window.__app = app;

// ── 캔버스 ────────────────────────────────────────────────────────
app.ctx = app.canvas.getContext('2d', { alpha: false });

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = app.canvas.clientWidth || window.innerWidth;
  const h = app.canvas.clientHeight || window.innerHeight;
  app.canvas.width = Math.round(w * dpr);
  app.canvas.height = Math.round(h * dpr);
  app.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  app.ctx.imageSmoothingEnabled = false;
  app.W = w; app.H = h;
  app.field?.resize();
  if (app.battle) app.battle.layout();
  if (app.mode === 'title') ui.drawTitleArt();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// ── 음악 선택 ─────────────────────────────────────────────────────
function bgmForMap(map) {
  if (!map) return 'selain';
  return BGM_FOR[map.region] || 'selain';
}
function playBgm() {
  if (app.mode === 'title') A.playMusic('title');
  else if (app.mode === 'battle' && app.battle) A.playMusic(app.battle.isBoss ? 'boss' : 'battle');
  else if (app.mode === 'field' && app.field?.map) A.playMusic(bgmForMap(app.field.map));
}

// ── 필드 콜백 ─────────────────────────────────────────────────────
app.onMapEnter = map => {
  $('hud-map').textContent = map.name;
  $('hud-coin').textContent = `${app.state.coin} 셰켈`;
  if (app.mode === 'field') {
    A.playMusic(bgmForMap(map));
    ui.toast(map.name, 1800);
  }
  clearTimeout(app.autoTimer);
  app.autoTimer = setTimeout(() => checkAuto(), 420);
};

app.onArrive = () => { /* 자동 저장은 이벤트 완료 시 */ };

app.onEncounter = async enc => {
  if (app.busy) return;
  app.busy = true;
  app.field.locked = true;
  app.field.dir = null;
  playSfx('encounter');
  await sleep(180);
  await startBattle({ enemyIDs: enc.enemies, clearFlag: enc.clearFlag, encounterID: enc.id });
  app.field.locked = false;
  app.busy = false;
};

app.onExit = async exit => {
  if (app.busy) return;
  app.busy = true;
  app.field.locked = true;
  await ui.fade(true);
  app.field.setMap(exit.toMap, exit.toCoord);
  app.state.save();
  await ui.fade(false);
  app.field.locked = false;
  app.busy = false;
};

app.onTalk = async npcId => {
  if (app.busy) return;
  await talkTo(npcId);
};

app.onBattleLog = log => {
  const el = $('b-log');
  el.innerHTML = log.map((l, i) => `<div class="${i === log.length - 1 ? 'new' : ''}">${l}</div>`).join('');
};
app.onBattleMessage = msg => { $('b-turn').textContent = msg; };

app.toast = ui.toast;
app.onMenuClose = () => {
  if (app.mode === 'title') { $('title').hidden = false; ui.renderTitleMenu(app); }
  else if (app.field) app.field.locked = false;
};

// ── 대화 ──────────────────────────────────────────────────────────
async function talkTo(npcId) {
  const map = app.field.map;
  const npc = map.npcs.find(n => n.id === npcId);
  if (!npc) return;
  playSfx('pop', 0.6);
  const ev = Events.forNPC(npcId, map.id, app.state);
  let dlg;
  if (ev) {
    dlg = new DialogueSession(ev, app.state);
  } else {
    dlg = new DialogueSession({
      id: `__idle_${npc.id}`, title: npc.name, kind: 'optional', map: map.id, npc: npc.id,
      conditions: [], script: [{ speaker: npc.name, text: npc.idleLine }], rewards: [], setFlags: [], summary: '',
    }, app.state);
  }
  await runDialogue(dlg);
}

async function runDialogue(dlg) {
  app.busy = true;
  app.dialogue = dlg;
  app.field.locked = true;
  app.field.dir = null;
  let guard = 0;
  while (guard++ < 400) {
    const step = dlg.next();
    if (step.type === 'line') {
      await ui.showLine(step);
      continue;
    }
    if (step.type === 'choice') {
      await ui.choose(step.options);
      continue;
    }
    if (step.type === 'battle') {
      ui.hideDialogue();
      const res = await startBattle({ enemyIDs: step.enemyIDs, isBoss: step.isBoss, eventBattle: true });
      dlg.resumeAfterBattle(res.victory);
      if (!res.victory && !res.fled) break;
      continue;
    }
    break;
  }
  ui.hideDialogue();
  app.dialogue = null;
  app.busy = false;
  app.field.locked = false;

  if (dlg.rewardSummary && dlg.rewardSummary.length) {
    await ui.showRewards(dlg.rewardSummary);
    const f = app.field.footPoint(app.field.pos);
    app.field.pulse(f.x, f.y - 10);
    playSfx('bell', 0.8);
  }
  if (dlg.warped) {
    await ui.fade(true);
    app.field.setMap(app.state.mapID, app.state.pos);
    await ui.fade(false);
  }
  app.field.refreshActors();
  app.state.save();
  updateHud();
  checkAuto();
}

function checkAuto() {
  if (app.mode !== 'field' || app.busy || !app.field?.map) return;
  if (ui.menuOpen() || document.querySelector('.result') || $('menu').hidden === false) return;
  const ev = Events.auto(app.field.map.id, app.state);
  if (!ev) return;
  const dlg = new DialogueSession(ev, app.state);
  runDialogue(dlg);
}

function updateHud() {
  $('hud-coin').textContent = `${app.state.coin} 셰켈`;
  if (app.field?.map) $('hud-map').textContent = app.field.map.name;
}

// ── 전투 ──────────────────────────────────────────────────────────
async function startBattle(opts) {
  app.mode = 'battle';
  app.battle = new Battle(app, opts);
  const map = app.field?.map || IDX.map[app.state.mapID];
  const bgName = 'bg_' + (opts.bg || map?.region || 'selain');
  app.bgImage = IMG[bgName] || IMG['bg_selain'];
  $('battle-ui').hidden = false;
  $('b-hud')?.removeAttribute('hidden');
  $('hud').hidden = true;
  $('touch').classList.add('hide');
  A.playMusic(opts.isBoss ? 'boss' : 'battle');
  $('b-log').innerHTML = '';
  $('b-turn').textContent = '';
  $('b-command').hidden = true;
  ui.toast(opts.isBoss ? '보스전 — 도망칠 수 없다' : '전투!', 1200);
  await sleep(420);
  await battleLoop();
  const res = app.battle.makeResult();

  // 결과 반영
  const st = app.state;
  for (const [id, hp] of Object.entries(res.finalHP)) { const m = st.member(id); if (m) m.hp = hp; }
  for (const [id, mp] of Object.entries(res.finalMP)) { const m = st.member(id); if (m) m.mp = mp; }
  st.coin += res.coin;
  if (res.victory) {
    for (const m of st.activeParty) {
      const before = m.level;
      const ups = gainExp(m, res.exp);
      if (ups) res.levelUps.push(`${IDX.char[m.defID].name} Lv.${m.level}`);
    }
    if (opts.clearFlag) st.setFlag(opts.clearFlag);
  }
  if (res.victory) {
    A.playMusic('victory');
    playSfx('victory');
    await sleep(900);
  }

  await ui.showResult({
    victory: res.victory, fled: res.fled, defeat: !res.victory && !res.fled,
    exp: res.victory ? res.exp : 0, coin: res.victory ? res.coin : 0,
    levelUps: res.levelUps, turns: res.turns,
  });

  $('battle-ui').hidden = true;
  $('hud').hidden = false;
  $('touch').classList.toggle('hide', !app.touchVisible);
  app.battle = null;
  app.mode = 'field';
  st.save();
  updateHud();

  if (!res.victory && !res.fled) {
    // 패배 — 마지막 마을로 돌려보낸다
    const map = IDX.map[st.mapID];
    st.pos = { ...map.spawn };
    for (const m of st.party) m.hp = Math.max(1, Math.round(memberStats(m).maxHP * 0.3));
    app.field.setMap(st.mapID, st.pos);
    ui.toast('정신을 차렸다… 마을로 돌아왔다', 2600);
  } else if (res.fled) {
    ui.toast('도주했다', 1200);
  }
  A.playMusic(bgmForMap(app.field.map));
  app.field.refreshActors();
  return res;
}

async function battleLoop() {
  const B = app.battle;
  let last = performance.now();
  let lastPanel = 0;
  while (B.outcome === 'ongoing') {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let step = B.tick(dt);
    if (step && step.kind === 'await') {
      const unit = B.unit(step.id);
      refreshBattlePanel(B, unit);
      let action = null;
      while (!action && B.outcome === 'ongoing') {
        action = await ui.battleCommands(app, B, unit);
        if (!action) break;
        const beat = B.command(step.id, action);
        if (!beat) { action = null; ui.toast('지금은 쓸 수 없다'); continue; }
        ui.battleHideCommands();
        await B.playBeat(beat);
        break;
      }
    } else if (step && step.kind === 'enemy') {
      await B.playBeat(step.beat);
    }
    if (now - lastPanel > 100) {
      lastPanel = now;
      refreshBattlePanel(B, null);
    }
    refreshAtbStrip(B);
    await new Promise(r => requestAnimationFrame(r));
  }
  ui.battleHideCommands();
}

function refreshAtbStrip(B) {
  const strip = $('atb-strip');
  const order = [...B.units].filter(u => u.hp > 0).sort((a, b) => b.atb - a.atb).slice(0, 8);
  strip.innerHTML = order.map(u => `<span class="atb-chip ${u.side === 'foe' ? 'foe' : ''} ${B.waiting === u.id ? 'now' : ''}">${u.name}${u.atb >= 1000 ? ' ●' : ' ' + Math.min(99, Math.round(u.atb / 10)) + '%'}</span>`).join('');
  if (B.waiting) {
    const u = B.unit(B.waiting);
    $('b-turn').textContent = `${u.name}의 차례 — 명령을 고른다`;
  }
}

function refreshBattlePanel(B, acting) {
  const el = $('b-party');
  el.innerHTML = B.allies.map(u => {
    const s = u.stats;
    const hpP = clamp(u.dispHp / s.maxHP, 0, 1) * 100;
    const mpP = clamp(u.mp / s.maxMP, 0, 1) * 100;
    return `<div class="pslot ${B.waiting === u.id ? 'acting' : ''} ${u.hp <= 0 ? 'down' : ''}">
      <div class="nm"><span>${u.name}</span><span>${Math.round(u.dispHp)}/${s.maxHP}</span></div>
      <div class="bars">
        <div class="bar-s"><i class="hp" style="width:${hpP}%"></i></div>
        <div class="bar-s"><i class="mp" style="width:${mpP}%"></i></div>
      </div>
      <div class="b-note" style="font-size:10px">MP ${u.mp}/${s.maxMP} ${u.guarding ? '· 방어' : ''} ${u.row === 'back' ? '· 후열' : ''}</div>
    </div>`;
  }).join('');
}

// ── 타이틀 ────────────────────────────────────────────────────────
function showTitle() {
  app.mode = 'title';
  $('title').hidden = false;
  $('hud').hidden = true;
  $('battle-ui').hidden = true;
  $('touch').classList.add('hide');
  ui.drawTitleArt();
  ui.renderTitleMenu(app);
  A.playMusic('title');
}

app.titleAction = async id => {
  if (id === 'new') {
    await startGame(false);
  } else if (id === 'load') {
    await startGame(true);
  } else if (id === 'sound') {
    $('title').hidden = true;
    ui.openMenu(app, 'sound');
  } else if (id === 'crt') {
    app.toggleCrt();
    ui.renderTitleMenu(app);
  } else if (id === 'help') {
    $('title').hidden = true;
    ui.openMenu(app, 'system');
  }
};

async function startGame(load) {
  A.init();
  if (load) {
    if (!app.state.load()) { ui.toast('저장된 여정이 없다'); return; }
  } else {
    app.state.newGame();
  }
  await ui.fade(true);
  $('title').hidden = true;
  $('menu').hidden = true;
  $('hud').hidden = false;
  $('touch').classList.toggle('hide', !app.touchVisible);
  app.mode = 'field';
  app.field.leaderSheet = 'chr_' + (app.state.party[0]?.defID || 'lien');
  app.field.setMap(app.state.mapID, app.state.pos);
  updateHud();
  await ui.fade(false);
  A.playMusic(bgmForMap(app.field.map));
  app.busy = false;
  checkAuto();
}

app.loadGame = async () => {
  if (!app.state.load()) { ui.toast('저장된 여정이 없다'); return; }
  ui.closeMenu();
  await ui.fade(true);
  app.mode = 'field';
  $('title').hidden = true;
  $('hud').hidden = false;
  $('touch').classList.toggle('hide', !app.touchVisible);
  app.field.leaderSheet = 'chr_' + (app.state.party[0]?.defID || 'lien');
  app.field.setMap(app.state.mapID, app.state.pos);
  updateHud();
  await ui.fade(false);
  A.playMusic(bgmForMap(app.field.map));
  app.busy = false;
  checkAuto();
};

app.toTitle = async () => {
  ui.closeMenu();
  await ui.fade(true);
  app.mode = 'title';
  app.field.locked = true;
  app.state.save();
  showTitle();
  await ui.fade(false);
};

app.toggleCrt = () => {
  app.crt = !app.crt;
  $('crt').classList.toggle('crt-on', app.crt);
  playSfx('cursor');
};
app.toggleMute = () => {
  A.setMuted(!A.muted);
  $('btn-mute').classList.toggle('off', A.muted);
  playSfx('cursor');
};

// ── 입력 ──────────────────────────────────────────────────────────
const KEYDIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
const held = new Set();

window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  A.init();
  const k = e.key;
  if (k === 'm' || k === 'M') { app.toggleMute(); return; }
  if (KEYDIR[k]) {
    const d = KEYDIR[k];
    held.add(d);
    if (app.mode === 'field' && !ui.menuOpen()) app.field.setDir(d);
    return;
  }
  if (k === 'z' || k === 'Z' || k === 'Enter' || k === ' ') { pressA(); return; }
  if (k === 'x' || k === 'X' || k === 'Escape') { pressB(); return; }
});

window.addEventListener('keyup', e => {
  const d = KEYDIR[e.key];
  if (d) {
    held.delete(d);
    if (app.mode === 'field' && !app.field.dir) return;
    if (app.mode === 'field') app.field.setDir([...held][held.size - 1] || null);
  }
});

function pressA() {
  A.init();
  if (ui.hasAdvance()) { ui.advance(); return; }
  if (ui.menuOpen()) return;
  if (app.mode === 'field' && !app.field.locked) app.field.interact();
}

function pressB() {
  A.init();
  if (ui.menuOpen()) { ui.closeMenu(); app.field.locked = false; return; }
  if (ui.hasAdvance()) return;
  if (app.mode === 'field' && !app.field.locked && !app.busy) {
    app.field.locked = true;
    ui.openMenu(app);
  }
}

// 터치
function bindHold(btn, dir) {
  let startPos = null;
  const on = e => {
    e.preventDefault(); A.init(); btn.classList.add('hold');
    if (app.mode === 'field') { startPos = { ...app.field.pos }; app.field.setDir(dir); }
  };
  const off = e => {
    e.preventDefault(); btn.classList.remove('hold');
    if (app.mode !== 'field') return;
    app.field.setDir(null);
    // 짧게 톡 누른 경우에도 한 칸은 움직이게
    const p = app.field.pos;
    if (startPos && p.x === startPos.x && p.y === startPos.y && !app.field.moving && !app.field.locked) app.field.tryMove(dir);
    startPos = null;
  };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('contextmenu', e => e.preventDefault());
}
document.querySelectorAll('.dbtn').forEach(b => bindHold(b, b.dataset.dir));
$('btn-a').addEventListener('pointerdown', e => { e.preventDefault(); pressA(); });
$('btn-b').addEventListener('pointerdown', e => { e.preventDefault(); pressB(); });
$('btn-menu').addEventListener('click', () => { if (app.mode === 'field') { app.field.locked = true; ui.openMenu(app); } });
$('btn-juke').addEventListener('click', () => { app.field.locked = true; ui.openMenu(app, 'sound'); });
$('btn-mute').addEventListener('click', () => app.toggleMute());
$('btn-crt').addEventListener('click', () => app.toggleCrt());
$('dialogue').addEventListener('pointerdown', e => { e.preventDefault(); if (ui.hasAdvance()) ui.advance(); });
app.canvas.addEventListener('pointerdown', e => {
  if (app.mode === 'field' && !app.field.locked && !ui.menuOpen()) {
    A.init();
    app.field.interact();
  }
});

// 메뉴 닫기 (배경 탭)
$('menu').addEventListener('pointerdown', e => {
  if (e.target.id === 'menu') { ui.closeMenu(); app.field.locked = false; }
});

// 첫 터치에서 오디오 열기
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  window.addEventListener(ev, () => A.init(), { once: true }));

// ── 루프 ──────────────────────────────────────────────────────────
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (app.mode === 'field' && app.field) {
    app.field.update(dt);
    app.field.draw();
  } else if (app.mode === 'battle' && app.battle) {
    app.battle.update(dt);
    app.battle.draw();
  }
  requestAnimationFrame(loop);
}

// 터치 기기에서만 가상 패드를 보인다 (?touch=1 / ?touch=0 로 강제)
function applyTouchVisibility() {
  const q = new URLSearchParams(location.search).get('touch');
  const coarse = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const show = q === '1' ? true : q === '0' ? false : coarse;
  document.getElementById('touch').classList.toggle('hide', !show);
  app.touchVisible = show;
}

// ── 부팅 ──────────────────────────────────────────────────────────
async function boot() {
  const bar = $('load-bar');
  const txt = $('load-text');
  try {
    txt.textContent = '게임 자료를 펼치는 중…';
    await loadData();
    bar.style.width = '30%';
    txt.textContent = '그림을 깨우는 중…';
    await loadImages((d, t) => {
      bar.style.width = `${30 + (d / t) * 65}%`;
      if (d % 20 === 0) txt.textContent = `그림 ${d} / ${t}`;
    });
    txt.textContent = '종을 매다는 중…';
    applyTouchVisibility();
    app.state = new GameState();
    app.field = new Field(app);
    resize();
    await sleep(120);
    bar.style.width = '100%';
    $('loading').classList.add('hide');
    setTimeout(() => { $('loading').style.display = 'none'; }, 520);
    showTitle();
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    txt.textContent = '불러오지 못했다: ' + err.message;
  }
}

boot();

// 디버그용
window.__game = { app, IDX, DATA, A, playSfx, ui, startBattle, talkTo, openMenu: ui.openMenu };
