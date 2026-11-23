// ui.js — 대화창 · 메뉴 · 주크박스 · 전투 명령 · 결과 화면 (DOM)
import { IDX, DATA, EVENT_ORDER, IMG, sheet, clamp, sleep } from './core.js';
import { playSfx, A, SFX_CATALOG } from './audio.js';
import { TRACKS } from './tracks.js';
import * as S from './state.js';

export const $ = id => document.getElementById(id);

let advanceFn = null;
export function advance() { if (advanceFn) advanceFn(); }
export function hasAdvance() { return !!advanceFn; }

// ── 토스트 ────────────────────────────────────────────────────────
let toastTimer = null;
export function toast(text, ms = 2000) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function fade(on) {
  const f = $('fade');
  f.classList.toggle('on', on);
  return sleep(on ? 280 : 260);
}

// ── 대화 ──────────────────────────────────────────────────────────
function portraitCanvasFor(speaker) {
  const cv = $('dlg-portrait');
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 48, 48);
  let name = null;
  if (IDX.char[speaker]) return { name: IDX.char[speaker].name, portrait: IDX.char[speaker].portrait };
  const c = DATA.characters.find(c => c.name === speaker);
  if (c) return { name: c.name, portrait: c.portrait };
  return { name: speaker, portrait: null };
}

export function showLine(line) {
  return new Promise(resolve => {
    const box = $('dialogue');
    const nameEl = $('dlg-name');
    const textEl = $('dlg-text');
    const moreEl = $('dlg-more');
    const pwrap = document.querySelector('.portrait-wrap');
    const who = portraitCanvasFor(line.speaker || '');
    box.hidden = false;
    box.classList.add('talkable');
    const cv = $('dlg-portrait');
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (who.portrait && IMG[who.portrait]) {
      pwrap.classList.remove('empty');
      ctx.clearRect(0, 0, 48, 48);
      ctx.drawImage(IMG[who.portrait], 0, 0, 48, 48);
      nameEl.textContent = who.name;
    } else {
      pwrap.classList.add('empty');
      ctx.clearRect(0, 0, 48, 48);
      nameEl.textContent = who.name;
    }
    const text = line.text || '';
    const narr = !line.speaker;
    textEl.classList.toggle('narr', narr);
    textEl.textContent = '';
    moreEl.style.visibility = 'hidden';

    let i = 0, typed = false;
    const tick = () => {
      if (typed) return;
      i += 1;
      textEl.textContent = text.slice(0, i);
      if (i % (narr ? 3 : 2) === 0) playSfx(narr ? 'blip_narr' : 'blip', 0.5);
      if (i >= text.length) { typed = true; moreEl.style.visibility = 'visible'; }
    };
    const iv = setInterval(tick, 22);

    advanceFn = () => {
      if (!typed) {
        typed = true;
        i = text.length;
        textEl.textContent = text;
        moreEl.style.visibility = 'visible';
        clearInterval(iv);
        return;
      }
      advanceFn = null;
      clearInterval(iv);
      playSfx('pop', 0.5);
      resolve();
    };
  });
}

export function hideDialogue() {
  $('dialogue').hidden = true;
  advanceFn = null;
}

export function choose(options) {
  return new Promise(resolve => {
    const box = $('choices');
    box.innerHTML = '';
    box.hidden = false;
    options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.textContent = opt;
      b.onclick = () => { box.hidden = true; playSfx('confirm'); resolve(i); };
      box.appendChild(b);
    });
  });
}

// ── 보상 요약 ─────────────────────────────────────────────────────
export async function showRewards(list, title = '손에 넣었다') {
  if (!list || !list.length) return;
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'result';
    wrap.innerHTML = `
      <div class="panel">
        <h2>${title}</h2>
        <div class="lines">${list.map(r => `<div>${r.icon && IMG[r.icon] ? `<img src="assets/${r.icon}.png" style="width:24px;height:24px;image-rendering:pixelated;vertical-align:-6px;margin-right:6px">` : ''}<b>${r.text}</b></div>`).join('')}</div>
        <button class="btn gold" id="rw-ok">계속</button>
      </div>`;
    document.getElementById('app').appendChild(wrap);
    playSfx('ui_take');
    wrap.querySelector('#rw-ok').onclick = () => { wrap.remove(); advanceFn = null; playSfx('confirm'); resolve(); };
    advanceFn = () => { wrap.remove(); advanceFn = null; playSfx('confirm'); resolve(); };
  });
}

// ── 결과 화면 ─────────────────────────────────────────────────────
export function showResult({ victory, fled, defeat, exp, coin, levelUps, turns }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'result';
    const head = defeat ? '쓰러졌다' : fled ? '도주했다' : '승리';
    const sub = defeat ? '…눈앞이 어두워진다.' : fled ? '무사히 빠져나왔다.' : `${turns}번의 주고받음`;
    const lines = [];
    if (!defeat && !fled) {
      if (exp) lines.push(`경험치 <b>${exp}</b>`);
      if (coin) lines.push(`셰켈 <b>${coin}</b>`);
      for (const n of levelUps) lines.push(`<b>${n}</b> 레벨 업!`);
    }
    wrap.innerHTML = `
      <div class="panel">
        <h2>${head}</h2>
        <div class="sub" style="color:#a99cbf;font-size:12px">${sub}</div>
        <div class="lines">${lines.map(l => `<div>${l}</div>`).join('') || '<div style="color:#a99cbf">—</div>'}</div>
        <button class="btn gold" id="rs-ok">계속</button>
      </div>`;
    document.getElementById('app').appendChild(wrap);
    playSfx(defeat ? 'cancel' : 'victory');
    const done = () => { wrap.remove(); advanceFn = null; resolve(); };
    wrap.querySelector('#rs-ok').onclick = () => { playSfx('confirm'); done(); };
    advanceFn = () => { advanceFn = null; done(); };
  });
}

// ── 전투 명령 ─────────────────────────────────────────────────────
export function battleCommands(app, battle, unit) {
  const panel = $('b-command');
  const log = $('b-log');
  panel.hidden = false;
  return new Promise(resolve => {
    const finish = action => {
      panel.hidden = true;
      panel.innerHTML = '';
      resolve(action);
    };
    const member = app.state.member(unit.defID);
    const spell = member ? S.memberSpell(member) : null;

    const showMain = () => {
      playSfx('cursor');
      panel.innerHTML = `
        <div class="row"><span class="b-head">${unit.name}</span>
          <span class="b-note">HP ${unit.hp}/${unit.stats.maxHP} · MP ${unit.mp}/${unit.stats.maxMP}</span>
          <span class="spacer"></span><span class="b-note">${unit.row === 'front' ? '전열' : '후열'}</span></div>
        <div class="cmds">
          <button data-a="attack">공격</button>
          <button data-a="skill" ${IDX.char[unit.defID].skills.length ? '' : 'disabled'}>기술</button>
          <button data-a="spell" ${spell ? '' : 'disabled'}>울림</button>
          <button data-a="item" ${app.state.itemList().length ? '' : 'disabled'}>도구</button>
          <button data-a="guard">방어</button>
          <button data-a="swap">진형</button>
          <button data-a="flee" ${battle.isBoss ? 'disabled' : ''}>도주</button>
          <button data-a="info">살피기</button>
        </div>`;
      panel.querySelectorAll('button[data-a]').forEach(b => {
        b.onclick = () => {
          playSfx('confirm');
          const a = b.dataset.a;
          if (a === 'attack') pickTarget('적을 고른다', battle.livingFoes, t => finish({ type: 'attack', target: t.id }));
          else if (a === 'skill') showSkills();
          else if (a === 'spell') showSpell();
          else if (a === 'item') showItems();
          else if (a === 'guard') finish({ type: 'guard' });
          else if (a === 'swap') finish({ type: 'swap' });
          else if (a === 'flee') finish({ type: 'flee' });
          else if (a === 'info') showInfo();
        };
      });
    };

    const backBtn = label => `<button class="btn small" data-back="1">← ${label}</button>`;

    const pickTarget = (title, list, cb, cancelMsg) => {
      panel.innerHTML = `<div class="row"><span class="b-head">${title}</span><span class="spacer"></span>${backBtn('취소')}</div>
        <div class="b-targets">${list.map(t => `<button data-t="${t.id}">${t.name} <small>HP ${Math.max(0, t.hp)}/${t.stats.maxHP}${t.hp <= 0 ? ' · 쓰러짐' : ''}</small></button>`).join('')}</div>`;
      panel.querySelector('[data-back]').onclick = () => { playSfx('cancel'); showMain(); };
      panel.querySelectorAll('button[data-t]').forEach(b => {
        b.onclick = () => { playSfx('confirm'); cb(battle.unit(b.dataset.t)); };
      });
    };

    const showSkills = () => {
      const sks = IDX.char[unit.defID].skills.map(id => IDX.skill[id]).filter(Boolean);
      panel.innerHTML = `<div class="row"><span class="b-head">기술</span><span class="spacer"></span>${backBtn('돌아가기')}</div>
        <div class="b-targets">${sks.map(s => `<button data-s="${s.id}" ${unit.mp < s.cost ? 'disabled style="opacity:.4"' : ''}>${s.name} <small>MP ${s.cost} · ${S.SHAPE_KR[s.shape]} · ${S.NATURE_KR[s.nature]}</small></button>`).join('')}</div>`;
      panel.querySelector('[data-back]').onclick = () => { playSfx('cancel'); showMain(); };
      panel.querySelectorAll('button[data-s]').forEach(b => {
        b.onclick = () => {
          const sk = IDX.skill[b.dataset.s];
          if (unit.mp < sk.cost) { toast('MP가 모자라다'); playSfx('cancel'); return; }
          playSfx('confirm');
          const allies = sk.nature === 'heal' || sk.nature === 'buff' || sk.nature === 'revive';
          const auto = sk.shape === 'all' || sk.shape === 'allyAll' || sk.shape === 'selfOnly';
          if (auto) { finish({ type: 'skill', skill: sk.id, target: null }); return; }
          pickTarget(sk.name + ' — 대상', allies ? battle.livingAllies : battle.livingFoes,
            t => finish({ type: 'skill', skill: sk.id, target: t.id }));
        };
      });
    };

    const showSpell = () => {
      if (!spell) { toast('울림석 세 자리를 모두 채워야 한다'); playSfx('cancel'); return; }
      const allies = spell.shape === 'allyOne' || spell.shape === 'allyAll' || spell.shape === 'selfOnly';
      const auto = spell.shape === 'all' || spell.shape === 'allyAll' || spell.shape === 'selfOnly';
      panel.innerHTML = `<div class="row"><span class="b-head">울림 — 〈${spell.name}〉</span><span class="spacer"></span>${backBtn('돌아가기')}</div>
        <div class="b-note">MP ${spell.cost} · ${spell.note} · 위력 ${spell.power}</div>
        <div class="cmds"><button class="esc" data-go="1" ${unit.mp < spell.cost ? 'disabled' : ''}>${unit.mp < spell.cost ? 'MP가 모자라다' : '이 주문으로 울린다'}</button></div>`;
      panel.querySelector('[data-back]').onclick = () => { playSfx('cancel'); showMain(); };
      const go = panel.querySelector('[data-go]');
      if (go) go.onclick = () => {
        playSfx('confirm');
        if (auto) { finish({ type: 'spell', target: null }); return; }
        pickTarget('대상', allies ? battle.livingAllies : battle.livingFoes, t => finish({ type: 'spell', target: t.id }));
      };
    };

    const showItems = () => {
      const items = app.state.itemList().filter(x => x.def.kind === 'consumable');
      panel.innerHTML = `<div class="row"><span class="b-head">도구</span><span class="spacer"></span>${backBtn('돌아가기')}</div>
        <div class="b-targets">${items.map(x => `<button data-i="${x.def.id}">${x.def.name} ×${x.n} <small>${x.def.note}</small></button>`).join('') || '<div class="b-note">쓸 만한 도구가 없다</div>'}</div>`;
      panel.querySelector('[data-back]').onclick = () => { playSfx('cancel'); showMain(); };
      panel.querySelectorAll('button[data-i]').forEach(b => {
        b.onclick = () => {
          const it = IDX.item[b.dataset.i];
          playSfx('confirm');
          if (it.revive) {
            const down = battle.allies.filter(u => u.hp <= 0);
            if (!down.length) { toast('쓰러진 동료가 없다'); return; }
            pickTarget(it.name + ' — 대상', down, t => finish({ type: 'item', item: it.id, target: t.id }));
            return;
          }
          pickTarget(it.name + ' — 대상', battle.livingAllies, t => finish({ type: 'item', item: it.id, target: t.id }));
        };
      });
    };

    const showInfo = () => {
      panel.innerHTML = `<div class="row"><span class="b-head">전장</span><span class="spacer"></span>${backBtn('돌아가기')}</div>
        <div class="b-targets">
          ${battle.livingFoes.map(f => `<div class="b-note">${f.name} — HP ${f.hp}/${f.stats.maxHP} · ${f.element ? S.ELEMENT_KR[f.element] : '무속성'} ${f.row === 'front' ? '· 전열' : '· 후열'}</div>`).join('')}
          <div class="b-note" style="margin-top:6px">${IDX.enemy[battle.foes[0]?.defID]?.note || '눈에 띄는 약점은 모르겠다.'}</div>
        </div>`;
      panel.querySelector('[data-back]').onclick = () => { playSfx('cancel'); showMain(); };
    };

    showMain();
  });
}

export function battleHideCommands() {
  const p = $('b-command');
  p.hidden = true;
  p.innerHTML = '';
}

// ── 메뉴 ──────────────────────────────────────────────────────────
const TABS = [
  { id: 'party', name: '파티' },
  { id: 'stones', name: '울림석' },
  { id: 'items', name: '아이템' },
  { id: 'record', name: '기록' },
  { id: 'system', name: '저장' },
  { id: 'sound', name: '사운드' },
];

let menuTab = 'party';
let stoneMember = null;
let menuApp = null;

export function openMenu(app, tab) {
  menuApp = app;
  if (tab) menuTab = tab;
  const menu = $('menu');
  menu.hidden = false;
  playSfx('ui_open');
  renderMenu(app);
  $('menu-tabs').querySelectorAll('button').forEach(b => {
    b.onclick = () => { menuTab = b.dataset.t; playSfx('cursor'); renderMenu(app); };
  });
}

export function closeMenu() {
  $('menu').hidden = true;
  playSfx('ui_close');
  menuApp?.onMenuClose?.();
}

export function menuOpen() { return !$('menu').hidden; }

function bar(cur, max, cls) {
  const p = max > 0 ? clamp(cur / max, 0, 1) * 100 : 0;
  return `<div class="bar-s"><i class="${cls}" style="width:${p}%"></i></div>`;
}

function renderMenu(app) {
  const st = app.state;
  $('menu-tabs').innerHTML = TABS.map(t => `<button data-t="${t.id}" class="${t.id === menuTab ? 'on' : ''}">${t.name}</button>`).join('');
  $('menu-tabs').querySelectorAll('button').forEach(b => {
    b.onclick = () => { menuTab = b.dataset.t; playSfx('cursor'); renderMenu(app); };
  });
  const c = $('menu-content');
  const titles = { party: '파티', stones: '울림석 — 基 · 格 · 響', items: '아이템', record: '기록', system: '저장 · 설정', sound: '사운드 테스트' };
  $('menu-title').textContent = titles[menuTab] || '메뉴';

  if (menuTab === 'party') {
    c.innerHTML = st.party.map(m => {
      const d = IDX.char[m.defID];
      const s = S.memberStats(m);
      const sp = S.memberSpell(m);
      return `<div class="card">
        <div class="row"><h3>${d.name}</h3><span class="sub">${d.title}</span><span class="spacer"></span>
          <span class="gold">Lv.${m.level}</span></div>
        <div class="row wrap" style="margin:6px 0 4px">
          <span class="statline">HP <span class="hp">${m.hp}/${s.maxHP}</span></span>
          <span class="statline">MP <span class="mp">${m.mp}/${s.maxMP}</span></span>
          <span class="statline">경험 ${m.exp}/${S.expToNext(m.level)}</span>
          <span class="spacer"></span><span class="sub">${m.row === 'front' ? '전열' : '후열'} · ${d.weapon}</span>
        </div>
        <div class="row" style="gap:8px;margin-bottom:6px">
          <div style="flex:1">${bar(m.hp, s.maxHP, 'hp')}</div>
          <div style="flex:1">${bar(m.mp, s.maxMP, 'mp')}</div>
        </div>
        <div class="statline">공격 ${s.atk} · 방어 ${s.def} · 마력 ${s.mag} · 정신 ${s.res} · 민첩 ${s.agi} · 적성 ${d.affinities.map(e => S.ELEMENT_KR[e]).join('·')}</div>
        <div class="sub" style="margin-top:6px">기술 — ${d.skills.map(id => IDX.skill[id]?.name).filter(Boolean).join(' / ')}</div>
        <div class="sub">울림 — ${sp ? `〈${sp.name}〉 MP ${sp.cost}` : '세 자리를 채우면 주문이 된다'}</div>
        <div class="sub" style="margin-top:4px;color:#8d81a6">${d.intro}</div>
      </div>`;
    }).join('');
  } else if (menuTab === 'stones') {
    if (!stoneMember || !st.member(stoneMember)) stoneMember = st.party[0]?.defID;
    const m = st.member(stoneMember);
    const d = IDX.char[stoneMember];
    const sp = m ? S.memberSpell(m) : null;
    const slots = ['base', 'form', 'tone'].map(slot => {
      const id = m?.loadout[slot];
      const stone = id ? IDX.stone[id] : null;
      const el = stone?.element ? `<span class="el">${S.ELEMENT_KR[stone.element]}</span>` :
        stone?.shape ? `<span class="el">${S.SHAPE_KR[stone.shape]}</span>` :
        stone?.nature ? `<span class="el">${S.NATURE_KR[stone.nature]}</span>` : '';
      return `<div class="stone-slot ${stone ? '' : 'empty'}" data-slot="${slot}">
        <span class="glyph">${S.SLOT_GLYPH[slot]} ${S.SLOT_KR[slot]}</span>
        <div class="nm">${stone ? stone.name : '— 비어 있음 —'}</div>${el}
      </div>`;
    }).join('');
    c.innerHTML = `
      <div class="row wrap" style="margin-bottom:10px">
        ${st.party.map(mm => `<button class="btn small ${mm.defID === stoneMember ? 'on' : ''}" data-m="${mm.defID}">${IDX.char[mm.defID].name}</button>`).join('')}
        <span class="spacer"></span>
        <span class="sub">가진 돌 ${st.stones.length}개 · 울림석은 하나뿐이라 돌려 써야 한다</span>
      </div>
      <div class="slotrow">${slots}</div>
      <div class="card" style="margin-top:12px">
        <h3>지금 이 조합이 부르는 것</h3>
        ${sp ? `<div class="row wrap">
            <span class="gold" style="font-size:17px">〈${sp.name}〉</span>
            <span class="sub">MP ${sp.cost} · 위력 ${sp.power}</span>
          </div>
          <div class="sub" style="margin-top:4px">${sp.note}</div>
          <div class="sub">${S.ELEMENT_KR[sp.element]} 속성 · ${S.SHAPE_KR[sp.shape]} · ${S.NATURE_KR[sp.nature]}</div>
          ${d && d.affinities.includes(sp.element) ? '<div class="gd" style="font-size:12px">적성 속성 — 위력 1.25배, 비용 0.8배</div>' : '<div class="sub">적성 밖의 속성 — 위력 0.85배</div>'}
        ` : '<div class="sub">기(속성)·격(형태)·향(성질) 세 자리를 모두 채우면 주문이 완성된다.</div>'}
      </div>
      <div class="sub" style="margin-top:8px">돌을 끼우면 다른 동료에게서 빠진다. 조합은 저장되지 않고 장착된 돌에서 매번 계산된다.</div>`;

    c.querySelectorAll('[data-m]').forEach(b => {
      b.onclick = () => { stoneMember = b.dataset.m; playSfx('cursor'); renderMenu(app); };
    });
    c.querySelectorAll('.stone-slot').forEach(node => {
      node.onclick = () => {
        playSfx('cursor');
        const slot = node.dataset.slot;
        const list = st.stonesFor(slot);
        const cur = m.loadout[slot];
        c.querySelectorAll('.stone-slot').forEach(n => n.style.borderColor = '');
        node.style.borderColor = '#f2c14e';
        const box = document.createElement('div');
        box.className = 'picklist';
        box.style.marginTop = '10px';
        box.innerHTML = `<button data-x="__none">— 빼기 —</button>` + list.map(s => {
          const holder = st.stoneHolder(s.id, stoneMember);
          return `<button data-x="${s.id}" class="${holder ? 'dimrow' : ''}">${s.name} <span style="color:#8d81a6;font-size:11px">${s.tier > 1 ? `· ${s.tier}등급` : ''}${holder ? ` · ${IDX.char[holder].name}이(가) 꼈음` : ''}</span><br><span style="color:#8d81a6;font-size:11px">${s.flavor}</span></button>`;
        }).join('');
        const old = c.querySelector('.picklist');
        if (old) old.remove();
        node.parentElement.after(box);
        box.querySelectorAll('button').forEach(b => {
          b.onclick = () => {
            const id = b.dataset.x === '__none' ? null : b.dataset.x;
            st.equip(stoneMember, slot, id);
            playSfx('confirm');
            st.save();
            renderMenu(app);
          };
        });
      };
    });
  } else if (menuTab === 'items') {
    const list = st.itemList();
    c.innerHTML = `
      <div class="row" style="margin-bottom:8px"><span class="sub">셰켈 <span class="gold">${st.coin}</span></span><span class="spacer"></span><span class="sub">도구는 전투 중에도 쓸 수 있다</span></div>
      ${list.map(x => `<div class="card" style="padding:8px 12px">
        <div class="row"><img src="assets/icon_${x.def.id}.png" style="width:26px;height:26px;image-rendering:pixelated" onerror="this.style.display='none'">
        <b style="color:#f4ecdc;font-weight:400">${x.def.name}</b> <span class="sub">×${x.n}</span>
        <span class="spacer"></span><span class="sub">${x.def.note}</span>
        ${x.def.kind === 'consumable' ? `<button class="btn small" data-use="${x.def.id}">쓰기</button>` : ''}</div>
      </div>`).join('') || '<div class="sub">주머니가 비어 있다.</div>'}`;
    c.querySelectorAll('[data-use]').forEach(b => {
      b.onclick = () => {
        const id = b.dataset.use;
        const it = IDX.item[id];
        const st2 = app.state;
        let target = null;
        if (it.revive) target = st2.party.find(m => m.hp <= 0) || null;
        else {
          const alive = st2.party.filter(m => m.hp > 0);
          target = alive.sort((a, bb) => a.hp / S.memberStats(a).maxHP - bb.hp / S.memberStats(bb).maxHP)[0] || null;
        }
        if (!target) { toast('지금은 쓸 수 없다'); playSfx('cancel'); return; }
        if (!st2.consume(id)) return;
        const s2 = S.memberStats(target);
        if (it.revive && target.hp <= 0) { target.hp = Math.max(1, Math.round(s2.maxHP * 0.4)); playSfx('item_revive'); }
        else {
          if (it.healHP) target.hp = Math.min(s2.maxHP, target.hp + it.healHP);
          if (it.healMP) target.mp = Math.min(s2.maxMP, target.mp + it.healMP);
          playSfx(it.healMP > 0 && it.healHP > 0 ? 'item' : it.healMP > 0 ? 'item_drink' : 'item_food');
        }
        toast(`${IDX.char[target.defID].name}에게 ${it.name}을(를) 썼다`);
        st2.save();
        renderMenu(app);
      };
    });
  } else if (menuTab === 'record') {
    const p = S.Events.progress(st);
    const doneMain = EVENT_ORDER.map(id => IDX.event[id]).filter(e => e.kind === 'main' && st.completed.has(e.id));
    const doneOpt = EVENT_ORDER.map(id => IDX.event[id]).filter(e => e.kind === 'optional' && st.completed.has(e.id));
    c.innerHTML = `
      <div class="card">
        <h3>본편 ${p.md} / ${p.mt}</h3>
        <div class="bar-s" style="width:100%;height:10px"><i class="exp" style="width:${p.mt ? p.md / p.mt * 100 : 0}%"></i></div>
        <div class="sub" style="margin-top:6px">${p.mt - p.md}개의 이야기가 아직 열려 있다</div>
      </div>
      <div class="card">
        <h3>곁가지 ${p.od} / ${p.ot}</h3>
        <div class="bar-s" style="width:100%;height:10px"><i class="exp" style="width:${p.ot ? p.od / p.ot * 100 : 0}%;background:linear-gradient(to bottom,#7cc6e8,#2a6fa0)"></i></div>
        <div class="sub" style="margin-top:6px">${p.ot - p.od}개의 곁가지가 남아 있다</div>
      </div>
      <div class="card"><h3>지나온 이야기</h3>
        ${doneMain.concat(doneOpt).map(e => `<div class="sub">${e.kind === 'main' ? '<span class="gold">본편</span>' : '<span style="color:#7cc6e8">곁가지</span>'} — ${e.title}</div>`).join('') || '<div class="sub">아직 아무 이야기도 닫히지 않았다.</div>'}
      </div>`;
  } else if (menuTab === 'system') {
    const info = st.saveInfo();
    c.innerHTML = `
      <div class="row wrap" style="gap:8px">
        <button class="btn gold" id="m-save">저장하기</button>
        <button class="btn" id="m-load" ${info ? '' : 'disabled'}>불러오기</button>
        <button class="btn" id="m-title">타이틀로</button>
        <button class="btn" id="m-crt">브라운관 ${app.crt ? '끄기' : '켜기'}</button>
        <button class="btn" id="m-mute">소리 ${A.muted ? '켜기' : '끄기'}</button>
      </div>
      ${info ? `<div class="card" style="margin-top:12px"><h3>저장된 여정</h3>
        <div class="sub">${info.name} Lv.${info.lv} · ${info.map} · 울림석 ${info.stones}개</div>
        <div class="sub">${new Date(info.at).toLocaleString('ko-KR')}</div></div>` : '<div class="sub" style="margin-top:12px">아직 저장된 여정이 없다.</div>'}
      <div class="card" style="margin-top:12px"><h3>조작</h3>
        <div class="sub">방향키 / WASD — 걷기 · Z / Enter — 말하기·확인 · X / Esc — 메뉴·취소 · M — 음소거</div>
        <div class="sub">아이폰·아이패드에서는 화면 아래 십자키와 A·B 버튼을 쓴다.</div>
      </div>`;
    c.querySelector('#m-save').onclick = () => { st.save(); playSfx('confirm'); toast('저장했다'); renderMenu(app); };
    const ld = c.querySelector('#m-load');
    if (ld) ld.onclick = () => { app.loadGame(); };
    c.querySelector('#m-title').onclick = () => { app.toTitle(); };
    c.querySelector('#m-crt').onclick = () => { app.toggleCrt(); renderMenu(app); };
    c.querySelector('#m-mute').onclick = () => { app.toggleMute(); renderMenu(app); };
  } else if (menuTab === 'sound') {
    c.innerHTML = renderSoundPanel(app);
    wireSoundPanel(app, c);
  }
}

// ── 사운드 테스트 ─────────────────────────────────────────────────
export function renderSoundPanel(app) {
  return `
    <div class="card">
      <h3>오리지널 사운드트랙 — 7곡</h3>
      <div class="sub" style="margin-bottom:8px">외부 음원 없이 Web Audio FM 합성으로 즉석에서 연주한다. 90년대 PC-98 / AdLib 감성.</div>
      <div class="juke-grid">
        ${TRACKS.map(t => `<button class="juke ${A.trackId === t.id ? 'playing' : ''}" data-track="${t.id}">
          <span class="no">${t.no} · ${t.sub}</span><span class="tt">${t.title}</span><span class="ds">${t.desc}</span>
        </button>`).join('')}
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn small" data-stop="1">■ 정지</button>
        <span class="sub" id="now-playing">${A.trackId ? '지금 — ' + (TRACKS.find(t => t.id === A.trackId)?.title || '') : '조용하다'}</span>
      </div>
    </div>
    <div class="card">
      <h3>효과음 — 전부 합성</h3>
      <div class="sub" style="margin-bottom:8px">게임 안의 모든 동작에 이 소리들이 실제로 붙어 있다. 눌러서 들어 보세요.</div>
      <div class="sfx-grid">
        ${SFX_CATALOG.map(s => `<button class="sfx-btn" data-sfx="${s.id}">${s.name}${s.desc ? `<small>${s.desc}</small>` : ''}</button>`).join('')}
      </div>
    </div>`;
}

export function wireSoundPanel(app, root) {
  root.querySelectorAll('[data-track]').forEach(b => {
    b.onclick = () => {
      A.init();
      A.playMusic(b.dataset.track);
      root.querySelectorAll('[data-track]').forEach(x => x.classList.toggle('playing', x === b));
      const np = root.querySelector('#now-playing');
      if (np) np.textContent = '지금 — ' + (TRACKS.find(t => t.id === b.dataset.track)?.title || '');
      playSfx('confirm');
    };
  });
  const stop = root.querySelector('[data-stop]');
  if (stop) stop.onclick = () => {
    A.stopMusic();
    root.querySelectorAll('[data-track]').forEach(x => x.classList.remove('playing'));
    const np = root.querySelector('#now-playing');
    if (np) np.textContent = '조용하다';
    playSfx('cancel');
  };
  root.querySelectorAll('[data-sfx]').forEach(b => {
    b.onclick = () => { A.init(); playSfx(b.dataset.sfx, 1); };
  });
}

// ── 타이틀 메뉴 ───────────────────────────────────────────────────
export function renderTitleMenu(app) {
  const hasSave = app.state.hasSave();
  const info = app.state.saveInfo();
  const items = [
    { id: 'new', label: '새로 시작' },
    { id: 'load', label: '이어하기', sub: hasSave && info ? `${info.name} Lv.${info.lv} · ${info.map}` : '저장된 여정 없음', off: !hasSave },
    { id: 'sound', label: '🎵 사운드 테스트', sub: 'OST 7곡 + 효과음 전부' },
    { id: 'crt', label: `브라운관 ${app.crt ? 'ON' : 'OFF'}`, sub: '주사선 + 비네팅' },
    { id: 'help', label: '조작 안내' },
  ];
  const box = $('title-menu');
  box.innerHTML = items.map(i => `<button class="titem ${i.off ? 'sel' : ''}" data-id="${i.id}" ${i.off ? 'disabled' : ''}>${i.label}${i.sub ? `<small>${i.sub}</small>` : ''}</button>`).join('');
  box.querySelectorAll('button').forEach(b => {
    b.onclick = () => { playSfx('confirm'); app.titleAction(b.dataset.id); };
  });
}

export function drawTitleArt() {
  const cv = $('title-canvas');
  const w = Math.max(320, window.innerWidth), h = Math.max(320, window.innerHeight);
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const im = IMG['title_bg'];
  if (!im) return;
  const k = Math.max(w / im.width, h / im.height);
  const dw = im.width * k, dh = im.height * k;
  // 종루가 화면에 남도록 왼쪽으로 붙인다
  const dx = (w - dw) * (w > h ? 0.4 : 0.08);
  const dy = (h - dh) * 0.5;
  ctx.fillStyle = '#0a0810';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(im, dx, dy, dw, dh);
  // 달빛 아래 흩날리는 재
  ctx.fillStyle = 'rgba(255,240,220,.5)';
  for (let i = 0; i < 70; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
}
