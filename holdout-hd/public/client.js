import { TILE, createGame, step, snapshot, applyResults, charsById } from '/shared/game.js';
// Namespace import so optional sim features (serializeGame/restoreGame for save
// beacons) can ship independently — accessed via gameMod.* with runtime checks.
import * as gameMod from '/shared/game.js';
import { render, renderMinimap, addEventFX, initTextures, drawPortrait, drawWeaponIcon } from './render.js';
// Namespace import so optional renderer features (cutscenes, menu backdrop) can
// ship independently — accessed via renderMod.* with runtime existence checks.
import * as renderMod from './render.js';
import { playEvent, playUi, setupAudioToggle } from './audio.js';

const characters = await (await fetch('/shared/characters.json')).json();
const charMap = charsById(characters);
const levels = await (await fetch('/api/levels')).json();
// Levels are organized by category subdirectory (classic/story/stronghold/
// ctf/br) and each def carries its subdir as def.category. Mode lists derive
// from the category; the old per-def flags stay as fallbacks so a stale
// flat build (no category field) keeps working.
const campaign = levels.filter(l => l.category ? l.category === 'classic' : !l.expedition);
const expeditions = levels.filter(l => !l.category && l.expedition && !l.mode && !l.story);
const ctfLevels = levels.filter(l => l.category === 'ctf' || (!l.category && l.mode === 'ctf'));
const brLevels = levels.filter(l => l.category === 'br' || (!l.category && l.mode === 'br'));
// Stronghold campaign (sim/server mode 'bastion'): sh01..sh25 ordered by
// their stronghold.level number, filename order as the fallback.
const bastionLevels = levels
  .filter(l => l.category === 'stronghold' || (!l.category && l.mode === 'bastion'))
  .sort((a, b) => (a.stronghold?.level ?? 999) - (b.stronghold?.level ?? 999));
// Story chapters, ordered by their chapter number.
const storyLevels = levels.filter(l => l.category === 'story' || (!l.category && l.story))
  .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));
const startingRoster = characters.filter(c => c.starting).map(c => c.id);
await initTextures();

const mod = (a, n) => ((a % n) + n) % n;

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const mmCtx = $('minimap').getContext('2d');
const SAVE_KEY = 'holdout-hd.save';
const STORY_KEY = 'holdout-hd.story'; // { chapter: next 1-based chapter, roster }
const BEACON_KEY = 'holdout-hd.beacon'; // { chapter: 1-based, data: serializeGame(g) } — local story only
const PCOLORS = ['#4fc3f7', '#ffb74d', '#f06292', '#aed581'];
// CTF team identity (badge color sets) + display names.
const TEAMC = ['#5ea7ff', '#ff7a6a'];
const TEAM_NAME = ['TEAM A', 'TEAM B'];
const ITEM_ICON = { cracker: '✷ ', medkit: '✚ ', shield: '⬡ ', toxin: '☣ ', controller: '◉ ', lythseal: '❖ ' };
// item-slot display name overrides (default: kind.toUpperCase())
const ITEM_LABEL = { controller: 'MIND LINK', lythseal: 'LYTH SEAL' };
// field weapon pickups: display names for the weapon panel while one is held
const FIELD_WEAPON_LABEL = { flamer: 'FLAMER', railcannon: 'RAIL CANNON', stormgun: 'STORM GUN', mortarMk2: 'MORTAR MK2' };

// ---------- save beacon storage (LOCAL story sessions only) ----------
// The sim's serializeGame/restoreGame exports may land independently — both
// reads are guarded, so an older shared/game.js just means no resume offer.
function loadBeacon(chapter) {
  try {
    const b = JSON.parse(localStorage.getItem(BEACON_KEY));
    return b && b.chapter === chapter && b.data ? b : null;
  } catch { return null; }
}
function clearBeacon() { localStorage.removeItem(BEACON_KEY); }

let session = null;
setupAudioToggle($('btnAudio'));
// ?demo=1 -> 4-bot attract mode; ?demo=2 -> same but pacifist (never fires)
const demoMode = +(new URLSearchParams(location.search).get('demo') || 0);

// ---------- input devices ----------
// Couch co-op input model: the keyboard is split into two devices and up to
// four gamepads are polled. A device "joins" the local lobby by pressing fire.
const keys = {};
addEventListener('keydown', e => {
  if (e.target?.tagName === 'INPUT') return;
  keys[e.code] = true;
  // Tab is the kb1 MAP hold — without preventDefault it would walk DOM focus
  if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Slash' || e.code === 'Tab') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });

// E = interact (matches the on-screen [E/X] prompts), F = special, Q = item,
// hold Tab/M/SELECT = full map. These are the DEFAULTS — the Settings remap
// screen stores per-device overrides in localStorage and applyBinds() builds
// the live KB1/KB2/PADMAP tables from defaults + overrides.
const KB1_DEF = { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], fire: ['Space'], special: ['KeyF'], act: ['KeyE'], item: ['KeyQ'], start: ['Escape'], map: ['Tab'] };
// KB2 pauses with Backspace (a shared Escape would emit start on BOTH seats at once)
const KB2_DEF = { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], fire: ['Enter'], special: ['ShiftRight'], act: ['Slash'], item: ['Period'], start: ['Backspace'], map: ['KeyM'] };
// Pad button indices (standard mapping); button 8 = Select/Back holds the map
const PAD_DEF = { up: [12], down: [13], left: [14], right: [15], fire: [0, 7], special: [1, 5], act: [2], item: [3], start: [9], map: [8] };
const ACTIONS = ['up', 'down', 'left', 'right', 'fire', 'special', 'act', 'item', 'start', 'map'];
const BIND_KEY = 'holdout-hd.binds'; // { kb1:{action:code}, kb2:{...}, pad:{action:btnIdx} }
let binds = {};
try { binds = JSON.parse(localStorage.getItem(BIND_KEY)) || {}; } catch {}
let KB1 = {}, KB2 = {}, PADMAP = {};
function applyBinds() {
  const eff = (def, o = {}) => Object.fromEntries(ACTIONS.map(a => [a, o?.[a] != null ? [o[a]] : (def[a] ?? [])]));
  KB1 = eff(KB1_DEF, binds.kb1);
  KB2 = eff(KB2_DEF, binds.kb2);
  PADMAP = eff(PAD_DEF, binds.pad);
}
applyBinds();
function saveBinds() {
  try { localStorage.setItem(BIND_KEY, JSON.stringify(binds)); } catch {}
  applyBinds();
}
const DEVICES = ['kb1', 'kb2', 'gp0', 'gp1', 'gp2', 'gp3'];
const DEVICE_LABEL = { kb1: 'Keyboard WASD', kb2: 'Keyboard Arrows', gp0: 'Pad 1', gp1: 'Pad 2', gp2: 'Pad 3', gp3: 'Pad 4' };

function readKeys(map) {
  const o = {};
  for (const k in map) o[k] = map[k].some(c => keys[c]);
  return o;
}

function readPad(i) {
  const gp = navigator.getGamepads?.()[i];
  if (!gp || !gp.connected) return null;
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  // Linux/Batocera pads often expose the d-pad as a HAT on axes 6/7 instead
  // of buttons 12-15 — honor both, so carousel/menu d-pad input always lands
  const hx = gp.axes[6] || 0, hy = gp.axes[7] || 0;
  const b = a => (PADMAP[a] || []).some(j => !!gp.buttons[j]?.pressed);
  const DZ = 0.35;
  return {
    up: ay < -DZ || hy < -0.5 || b('up'),
    down: ay > DZ || hy > 0.5 || b('down'),
    left: ax < -DZ || hx < -0.5 || b('left'),
    right: ax > DZ || hx > 0.5 || b('right'),
    fire: b('fire'),
    special: b('special'),
    act: b('act'),
    item: b('item'), // Y
    start: b('start'),
    map: b('map'),
  };
}

function readDevice(id) {
  if (id === 'kb1') return readKeys(KB1);
  if (id === 'kb2') return readKeys(KB2);
  return readPad(+id.slice(2));
}

const prevDev = {};
function pollDevices() {
  const out = {};
  for (const id of DEVICES) {
    const cur = readDevice(id);
    if (!cur) { prevDev[id] = null; continue; }
    const prev = prevDev[id] || {};
    out[id] = {
      ...cur,
      fireJust: cur.fire && !prev.fire,
      leftJust: cur.left && !prev.left,
      rightJust: cur.right && !prev.right,
      upJust: cur.up && !prev.up,
      downJust: cur.down && !prev.down,
      startJust: cur.start && !prev.start,
      specialJust: cur.special && !prev.special,
      actJust: cur.act && !prev.act,
      itemJust: cur.item && !prev.item, // unused by menus/lobby (item only acts in the sim)
    };
    prevDev[id] = cur;
  }
  return out;
}

// Online play: one player per machine, so any device drives them.
function mergedInput() {
  const o = { up: false, down: false, left: false, right: false, fire: false, special: false, act: false, item: false };
  for (const id of DEVICES) {
    const c = readDevice(id);
    if (!c) continue;
    o.up ||= c.up; o.down ||= c.down; o.left ||= c.left; o.right ||= c.right;
    o.fire ||= c.fire; o.special ||= c.special; o.act ||= c.act; o.item ||= c.item;
  }
  return o;
}

// ---------- dialogue box (NPC talk lines; game keeps running) ----------
let dlgTimer = 0;
function showDialogue(ev) {
  const box = $('dialogueBox');
  // 'talk' carries the gift amount on the first conversation; tolerate either
  // a plain number or a {shards} object so classic/newer sims both work.
  const gift = typeof ev.gift === 'object' ? (ev.gift?.shards ?? 0) : (ev.gift ?? 0);
  box.querySelector('.dname').textContent = ev.name ?? '';
  box.querySelector('.dtext').textContent = (ev.line ?? '') + (gift ? ` (+${gift}◆)` : '');
  box.hidden = false;
  clearTimeout(dlgTimer);
  dlgTimer = setTimeout(() => { box.hidden = true; }, 4500);
}
function hideDialogue() {
  clearTimeout(dlgTimer);
  $('dialogueBox').hidden = true;
}
// ---------- event banner (big one-liners over the play field) ----------
let bannerTimer = 0;
function showBanner(text, blood = false, dur = 3200) {
  const el = $('banner');
  el.textContent = text;
  el.classList.toggle('blood', !!blood);
  el.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.hidden = true; }, dur);
}
function hideBanner() {
  clearTimeout(bannerTimer);
  $('banner').hidden = true;
  $('spectateTag').hidden = true;
  $('countdown').hidden = true;
  $('ctrlOverlay').hidden = true;
  cdSig = null;
  ctrlSig = null;
}
// ---------- loot toast (small popup over the field; chest pickups) ----------
// One #toast element used to drop same-tick messages (the newest overwrote
// the rest). A small queue plays them through instead: the visible toast
// holds for ~2s, then the next waiting one shows. At most 3 wait in line —
// a full line drops its OLDEST waiting entry, so the newest is never lost.
let toastTimer = 0;
const toastQueue = [];
let toastShowing = false;
function pumpToasts() {
  const next = toastQueue.shift();
  if (!next) {
    toastShowing = false;
    $('toast').hidden = true;
    return;
  }
  toastShowing = true;
  const el = $('toast');
  el.textContent = next.text;
  // 'front' lifts system notices (corrupt beacon) above the screen overlays;
  // ordinary loot toasts stay beneath open menus as designed
  el.classList.toggle('front', !!next.front);
  el.hidden = false;
  toastTimer = setTimeout(pumpToasts, next.dur);
}
function showToast(text, dur = 2000, front = false) {
  toastQueue.push({ text, dur, front });
  while (toastQueue.length > 3) toastQueue.shift(); // oldest waiting drops first
  if (!toastShowing) pumpToasts();
}
function hideToast() {
  clearTimeout(toastTimer);
  toastQueue.length = 0;
  toastShowing = false;
  const el = $('toast');
  el.classList.remove('front');
  el.hidden = true;
}
// Per-loot toast text; chest events only carry `amount` for some loots, so
// every count read is guarded. Unknown future loots fall back to their name.
const LOOT_TOAST = {
  shards: ev => `+${ev.amount ?? 0}◆ SHARDS`,
  cracker: ev => `CRACKER${(ev.amount ?? 1) > 1 ? ' ×' + ev.amount : ''}`,
  medkit: ev => `MEDKIT${(ev.amount ?? 1) > 1 ? ' ×' + ev.amount : ''}`,
  shield: () => 'SHIELD +2',
  token: () => 'WEAPON TOKEN — DMG UP',
  toxin: ev => `TOXIN${(ev.amount ?? 1) > 1 ? ' ×' + ev.amount : ''}`,
  controller: () => 'MIND LINK',
};
function chestToast(ev) {
  const text = (LOOT_TOAST[ev.loot] ?? (() => String(ev.loot).toUpperCase()))(ev);
  // a remote opener's loot is still worth a toast, but named so it reads right
  const focus = session?.focusPids?.() ?? new Set();
  return ev.pid == null || focus.has(ev.pid) ? text : `${playerName(ev.pid)} — ${text}`;
}
const playerName = pid =>
  session?.snap?.players?.find(p => p.pid === pid)?.name ?? 'P' + ((pid ?? 0) + 1);
// Returns { text, blood } for events that deserve a banner; null otherwise.
function bannerFor(ev) {
  switch (ev.type) {
    case 'dusk': return {
      text: ev.bloodMoon ? `BLOOD MOON — NIGHT ${ev.nightNo ?? '?'}` : `NIGHT ${ev.nightNo ?? '?'} FALLS`,
      blood: !!ev.bloodMoon,
    };
    case 'dawn': return { text: `DAWN — NIGHT ${ev.nightNo ?? '?'} SURVIVED` };
    case 'bloodWarn': return { text: 'BLOOD MOON RISING', blood: true };
    case 'coreDown': return { text: 'THE CORE HAS FALLEN', blood: true };
    case 'capture': return { text: `${TEAM_NAME[ev.team] ?? 'TEAM'} SCORES` };
    case 'flagTaken': return { text: `${TEAM_NAME[ev.team] ?? ''} FLAG TAKEN`.trim() };
    case 'flagDrop': return { text: `${TEAM_NAME[ev.team] ?? ''} FLAG DROPPED`.trim() };
    case 'flagReturn': return { text: 'FLAG RETURNED' };
    case 'eliminated': return {
      text: `${playerName(ev.pid)} ELIMINATED${ev.remaining != null ? ` — ${ev.remaining} REMAIN` : ''}`,
    };
    case 'levelUp': {
      // {pid, level, perk} — local seats get the bare callout, remote players
      // are named so an online squad can read whose weapon just evolved
      const perk = ev.perk != null ? String(ev.perk).toUpperCase() : `LEVEL ${ev.level ?? '?'}`;
      const mine = (session?.focusPids?.() ?? new Set()).has(ev.pid);
      return { text: mine ? `LVL UP — ${perk}` : `${playerName(ev.pid)} LVL UP — ${perk}` };
    }
    case 'matchEnd': {
      if (ev.winner == null) return { text: 'MATCH OVER' };
      const ctf = session?.versusMode?.() === 'ctf';
      return { text: `${ctf ? (TEAM_NAME[ev.winner] ?? 'TEAM') : playerName(ev.winner)} WINS THE MATCH` };
    }
    // stronghold beacon-defense variant + early-extraction ship (all optional)
    case 'beaconDown': return { text: 'A BEACON GOES DARK', blood: true };
    case 'beaconLit': return { text: 'BEACON RELIT' };
    case 'shipDown': return { text: 'THE ANCHORCRAFT HAS LANDED — ALL ABOARD TO EXTRACT' };
    case 'shipLaunch': return { text: 'ANCHORCRAFT AWAY — FULL CLEAR' };
  }
  return null;
}
// One funnel for sim events: FX + audio + banners + the DOM dialogue box.
function handleEvent(ev) {
  addEventFX(ev);
  playEvent(ev);
  if (ev.type === 'talk') showDialogue(ev);
  if (ev.type === 'chest' && ev.loot) showToast(chestToast(ev));
  // quest lifecycle toasts: {id, state, title, main} — 'hidden' never toasts
  if (ev.type === 'quest' && (ev.state === 'active' || ev.state === 'done')) {
    showToast(`${ev.state === 'done' ? 'COMPLETE' : 'NEW OBJECTIVE'} — ${ev.title ?? 'OBJECTIVE'}`, 3200);
  }
  if (ev.type === 'fieldEmpty') showToast('FIELD WEAPON SPENT');
  if (ev.type === 'sealForged') showToast('LYTH SEAL FORGED');
  const b = bannerFor(ev);
  if (b) showBanner(b.text, b.blood);
}

// ---------- screens ----------
function show(id) {
  hideDialogue();
  hideBanner();
  hideToast();
  for (const s of ['menu', 'lobby', 'msg']) $(s).hidden = s !== id;
}
function hideAll() {
  for (const s of ['menu', 'lobby', 'msg']) $(s).hidden = true;
}
function showMsg(title, body, btnLabel, onOk, altLabel, onAlt) {
  $('msgTitle').textContent = title;
  $('msgBody').textContent = body;
  $('btnMsgOk').textContent = btnLabel || 'Continue';
  $('btnMsgOk').onclick = e => { e.currentTarget.blur(); onOk(); };
  // optional second action ('Resume from beacon' on a local story fail) — a
  // ghost button so blind FIRE still defaults to the primary, DOWN reaches it
  const alt = $('btnMsgAlt');
  alt.hidden = !altLabel;
  alt.textContent = altLabel || '';
  alt.onclick = altLabel ? (e => { e.currentTarget.blur(); onAlt?.(); }) : null;
  show('msg');
}
function resultText(res) {
  let s = '';
  if (res.gained?.length) s += `Recruited: ${res.gained.map(id => charMap[id].name).join(', ')}\n`;
  if (res.lost?.length) s += `Lost in the field: ${res.lost.map(id => charMap[id].name).join(', ')}\n`;
  return s;
}

// ---------- menu gamepad navigation (couch box has no mouse) ----------
// Any device's UP/DOWN moves a focus ring ('navfocus') across the visible
// screen's buttons in document order; FIRE clicks the focused one. Text inputs
// are never nav targets and the mouse keeps working. Focus resets whenever a
// screen opens. Lobby exception: joined couch players' dpads drive their pick
// cursor, so there only un-joined devices steer the ring, and only the device
// that moved it may fire it (a stray FIRE must still mean "join the lobby").
let navScreen = null, navEl = null, navDev = null;

function visibleScreen() {
  for (const s of ['msg', 'lobby', 'menu']) if (!$(s).hidden) return s;
  return null;
}
function navButtons(screenId) {
  return [...$(screenId).querySelectorAll('button')]
    .filter(b => !b.disabled && b.offsetParent !== null); // skips [hidden] buttons
}
function setNavFocus(el) {
  navEl = el;
  for (const b of document.querySelectorAll('.navfocus')) if (b !== el) b.classList.remove('navfocus');
  el?.classList.add('navfocus');
  el?.scrollIntoView?.({ block: 'nearest' }); // scrollable grids (level select)
  // stronghold cards publish their blurb to the detail line under the grid
  if (el?.classList.contains('shcard')) $('shBlurb').textContent = el.dataset.blurb || ' ';
}
// Runs before session.tick each frame; consumes (zeroes) the *Just edges it
// handles so the session never double-acts on the same press.
function navTick(polled) {
  if (remapListen) return; // a rebind capture owns every input until it lands
  if (remapBoundGuard > 0) { remapBoundGuard--; return; } // the landing press must not nav
  const screen = visibleScreen();
  if (screen !== navScreen) { navScreen = screen; navDev = null; setNavFocus(null); }
  if (!screen) return;
  const btns = navButtons(screen);
  if (!btns.length) { setNavFocus(null); return; }
  if (navEl && !btns.includes(navEl)) setNavFocus(null); // focused button hid or disabled
  // Menu and dialogs get a default focus so a lone gamepad can always just
  // press FIRE; the lobby starts unfocused because FIRE there means "join".
  // Continue buttons take priority so a blind first press resumes a campaign
  // instead of wiping it with a fresh start.
  if (!navEl && screen !== 'lobby') {
    setNavFocus(
      btns.find(b => b.id === 'btnStoryContinue' || b.id === 'btnContinue')
      || btns.find(b => !b.classList.contains('ghost'))
      || btns[0]
    );
  }
  for (const [dev, st] of Object.entries(polled)) {
    if (screen === 'lobby' && session?.deviceOf?.(dev)) continue; // joined player: dpad = pick cursor
    // menu pages: SPECIAL (pad B) or START (Escape) backs out one page
    if (screen === 'menu' && (st.specialJust || st.startJust)) {
      st.specialJust = st.startJust = false;
      if (menuBack()) return;
    }
    const gridEl = screen === 'menu' ? navEl?.closest?.('.navgrid') : null;
    if (gridEl && (st.leftJust || st.rightJust)) {
      // 2D grid nav (stronghold level select): LEFT/RIGHT step one card
      const cells = btns.filter(b => gridEl.contains(b));
      const ci = cells.indexOf(navEl);
      const ni = ci + (st.rightJust ? 1 : -1);
      st.leftJust = st.rightJust = false;
      if (ci >= 0 && ni >= 0 && ni < cells.length) { setNavFocus(cells[ni]); navDev = dev; }
    }
    if (st.upJust || st.downJust) {
      let next = null;
      if (gridEl) {
        // UP/DOWN step one row; off the last/first row exits to the
        // neighboring page button (Back) in document order
        const cells = btns.filter(b => gridEl.contains(b));
        const ci = cells.indexOf(navEl);
        const cols = Math.max(1, +gridEl.dataset.cols || 5);
        const ni = ci + (st.downJust ? cols : -cols);
        if (ci >= 0 && ni >= 0 && ni < cells.length) next = cells[ni];
        else {
          const edge = btns.indexOf(st.downJust ? cells[cells.length - 1] : cells[0]);
          next = btns[mod(edge + (st.downJust ? 1 : -1), btns.length)];
        }
      } else {
        const idx = btns.indexOf(navEl);
        next = idx < 0
          ? btns[st.downJust ? 0 : btns.length - 1]
          : btns[mod(idx + (st.downJust ? 1 : -1), btns.length)];
      }
      if (next) { setNavFocus(next); navDev = dev; }
    }
    if (screen === 'msg') {
      // dialogs: FIRE or START from anyone clicks (keeps the old click-through feel)
      if (st.fireJust || st.startJust) {
        st.fireJust = st.startJust = false;
        (navEl || $('btnMsgOk')).click();
        return; // screen likely changed — re-evaluate next frame
      }
    } else if (st.fireJust && navEl && screen === 'menu') {
      st.fireJust = false;
      navEl.click();
      return;
    } else if (screen === 'lobby' && st.startJust && navEl && dev === navDev && !session?.deviceOf?.(dev)) {
      // lobby: FIRE from an un-joined device ALWAYS means "join" (a stray
      // press must never click Leave) — the ring activates with START instead
      st.startJust = false;
      navEl.click();
      return;
    }
  }
}

function renderLobby({ title, info, hint, players, roster, canStart, cursors = [], onCard }) {
  $('lobbyTitle').textContent = title;
  $('roomInfo').innerHTML = info;
  $('lobbyHint').textContent = hint || '';
  const pl = $('playerList');
  pl.innerHTML = '';
  for (const p of players) {
    const chip = document.createElement('span');
    chip.className = 'pchip';
    const col = p.charId ? charMap[p.charId].color : (p.color || '#555');
    chip.innerHTML = `<span class="dot" style="background:${col}"></span>${p.badge ? p.badge + ' · ' : ''}${p.name}${p.isHost ? ' ★' : ''}${p.charId ? ' — ' + charMap[p.charId].name : ''}`;
    pl.appendChild(chip);
  }
  const grid = $('charGrid');
  grid.innerHTML = '';
  // versus allows the same char on both teams, so a card can have SEVERAL
  // owners — track them all (an object keyed by charId would drop all but
  // the last) and stamp one badge per owner.
  const takenBy = {};
  for (const p of players) if (p.charId) (takenBy[p.charId] ??= []).push(p);
  roster.forEach((id, idx) => {
    const ch = charMap[id];
    const card = document.createElement('div');
    card.className = 'card';
    const pc = document.createElement('canvas');
    drawPortrait(pc, ch, 56);
    card.appendChild(pc);
    const meta = document.createElement('div');
    meta.innerHTML = `<div class="cname" style="color:${ch.color}">${ch.name.toUpperCase()}</div>
      <div class="cstats">${ch.weapon.name}<br>SPD ${ch.speed} · DMG ${ch.weapon.damage} · RNG ${ch.weapon.range}</div>`;
    card.appendChild(meta);
    const owners = takenBy[id] || [];
    // the local/me owner wins the selected/claimed styling so your own pick
    // always reads as yours even when the other team grabbed the same char
    const owner = owners.find(o => o.me) || owners.find(o => o.badge) || owners[0];
    let blocked = false;
    if (owner) {
      if (owner.me) card.classList.add('selected');
      else if (owner.badge) {
        card.classList.add('claimed');
        card.style.borderColor = owner.color || '#3fd9c0';
      } else {
        card.classList.add('taken');
        blocked = true;
      }
      owners.forEach((o, i) => {
        const b = document.createElement('div');
        b.className = 'pbadge';
        b.textContent = o.badge || '✓';
        b.style.background = o.color || charMap[id].color;
        if (i) b.style.right = (-6 + i * 26) + 'px'; // fan extra badges leftward
        card.appendChild(b);
      });
    }
    for (const cur of cursors) {
      if (cur.idx === idx && !cur.picked) {
        const b = document.createElement('div');
        b.className = 'pbadge hoverb';
        b.textContent = cur.badge;
        b.style.background = cur.color;
        card.appendChild(b);
        card.style.outline = `2px dashed ${cur.color}`;
      }
    }
    if (!blocked && onCard) card.onclick = () => onCard(id);
    grid.appendChild(card);
  });
  $('btnStart').disabled = !canStart;
  show('lobby');
  buildSquadPanels(roster);
  updateMissionPanel();
}

// ---------- HUD ----------
const squadCards = {};
function buildSquadPanels(roster) {
  const host = $('squadPanels');
  host.innerHTML = '';
  for (const k of Object.keys(squadCards)) delete squadCards[k];
  resetHearts();
  resetObjectives();
  for (const id of roster.slice(0, 5)) {
    const ch = charMap[id];
    const card = document.createElement('div');
    card.className = 'squadcard';
    const pc = document.createElement('canvas');
    drawPortrait(pc, ch, 48);
    card.appendChild(pc);
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `<div class="nm" style="color:${ch.color}">${ch.name.toUpperCase()}</div>
      <div class="rl">${ch.weapon.name}</div>
      <div class="bar"><i style="width:100%"></i></div>
      <div class="st">READY</div>`;
    card.appendChild(info);
    host.appendChild(card);
    squadCards[id] = card;
  }
}

function updateMissionPanel() {
  const idx = session?.levelIdxView?.() ?? 0;
  const list = session?.levelList?.() ?? campaign;
  const lvl = list[Math.min(idx, list.length - 1)];
  const vm = session?.versusMode?.();
  if (vm) {
    $('missionNo').textContent = vm === 'ctf' ? 'VERSUS — CTF' : 'VERSUS — ROYALE';
    $('missionName').textContent = (lvl?.name || '—').toUpperCase();
    $('missionObj').textContent = lvl?.objective
      || (vm === 'ctf' ? 'First to 3 captures wins' : 'Last operative standing wins');
    return;
  }
  if (session?.bastionMode?.()) {
    // NIGHT n/N itself lives in the bastion HUD panel (updateModePanels)
    const sh = lvl?.stronghold;
    $('missionNo').textContent = sh
      ? `STRONGHOLD ${String(sh.level ?? idx + 1).padStart(2, '0')} / ${String(bastionLevels.length).padStart(2, '0')}`
      : 'BASTION SIEGE';
    $('missionName').textContent = ((sh?.name || lvl?.name) || '—').toUpperCase();
    $('missionObj').textContent = lvl?.objective || 'Hold the core until the final dawn';
    return;
  }
  if (session?.story) {
    $('missionNo').textContent = `CHAPTER ${String(Math.min(idx + 1, list.length)).padStart(2, '0')} / ${String(list.length).padStart(2, '0')}`;
    $('missionName').textContent = (lvl?.title || lvl?.name || '—').toUpperCase();
  } else {
    $('missionNo').textContent = `MISSION ${String(idx + 1).padStart(2, '0')}`;
    $('missionName').textContent = lvl?.name?.toUpperCase() || '—';
  }
  $('missionObj').textContent = lvl?.objective || 'Reach the exit gate';
}

// Objectives checklist (top of the left column): main quest title + check,
// then up to 3 secondaries. Lives off snapshot.quests (titles/main flags fall
// back to the level def's quest list); story/bastion maps without quests show
// the level objective as the standing main. Classic/versus snapshots carry no
// quests and aren't story sessions, so the panel never appears — unchanged.
let objSig = null;
function resetObjectives() {
  objSig = null;
  const host = $('objectivesPanel');
  host.hidden = true;
  $('objList').innerHTML = '';
}
function updateObjectives(snap) {
  const host = $('objectivesPanel');
  const list = session?.levelList?.() ?? campaign;
  const lvl = list[Math.min(session?.levelIdxView?.() ?? 0, list.length - 1)];
  const defs = lvl?.quests ?? [];
  const defOf = q => defs.find(d => d.id === q.id);
  const quests = (snap.quests ?? [])
    .filter(q => q.state !== 'hidden')
    .map(q => ({
      ...q,
      title: q.title ?? defOf(q)?.title ?? 'OBJECTIVE',
      main: q.main ?? defOf(q)?.main ?? false,
    }));
  let rows;
  if (quests.length) {
    const main = quests.find(q => q.main) ?? quests[0];
    rows = [{ ...main, mainRow: true }, ...quests.filter(q => q !== main).slice(0, 3)];
  } else if (session?.story || session?.bastionMode?.()) {
    rows = [{ title: snap.objective || lvl?.objective || 'Reach the exit gate', state: snap.status === 'cleared' ? 'done' : 'active', mainRow: true }];
  } else {
    if (!host.hidden) resetObjectives();
    return;
  }
  const sig = rows.map(r => [r.id ?? '', r.state, r.progress ?? '', r.count ?? '', r.title].join(':')).join('|');
  if (sig === objSig) return;
  objSig = sig;
  host.hidden = false;
  const el = $('objList');
  el.innerHTML = '';
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'obj' + (r.mainRow ? ' main' : ' sec') + (r.state === 'done' ? ' done' : '');
    const chk = document.createElement('span');
    chk.className = 'chk';
    chk.textContent = r.state === 'done' ? '☑' : '☐';
    const txt = document.createElement('span');
    txt.className = 'otxt';
    // kill/fetch counters read as "title 2/5" once a count ships
    txt.textContent = r.title + ((r.count ?? 0) > 1 ? ` ${Math.min(r.progress ?? 0, r.count)}/${r.count}` : '');
    row.append(chk, txt);
    el.appendChild(row);
  }
}

// Hearts row per LOCAL player (survival maps only — players carry hp/maxHp).
// DOM is rebuilt only when the signature changes; classic snapshots have no
// hp so the panel stays hidden and nothing regresses.
let heartsSig = null;
function resetHearts() {
  heartsSig = null;
  const host = $('heartsPanel');
  host.hidden = true;
  host.innerHTML = '';
}
function updateHearts(snap) {
  const host = $('heartsPanel');
  const focus = session?.focusPids?.() ?? new Set();
  const rows = (snap.players ?? []).filter(p => focus.has(p.pid) && p.maxHp != null);
  if (!rows.length) { if (!host.hidden) resetHearts(); return; }
  const sig = rows.map(p =>
    [p.pid, p.charId, p.state, p.hp ?? 0, p.maxHp, p.shield ?? 0, p.team ?? ''].join(':')).join('|');
  if (sig === heartsSig) return;
  heartsSig = sig;
  host.hidden = false;
  host.innerHTML = '';
  for (const p of rows) {
    const ch = p.charId ? charMap[p.charId] : null;
    const row = document.createElement('div');
    row.className = 'heartrow' + (p.state === 'out' ? ' outrow' : '');
    let pips = '';
    for (let i = 0; i < p.maxHp; i++) {
      pips += i < (p.hp ?? 0) ? '<span class="pip hp">♥</span>' : '<span class="pip off">♡</span>';
    }
    for (let i = 0; i < (p.shield ?? 0); i++) pips += '<span class="pip sh">⬡</span>';
    const col = p.team != null ? (TEAMC[p.team] ?? ch?.color) : ch?.color;
    row.innerHTML = `<span class="hr-name" style="color:${col ?? '#cfd8e8'}">`
      + `${String(ch?.name ?? p.name ?? '').toUpperCase()}</span><span class="pips">${pips}</span>`;
    host.appendChild(row);
  }
}

// Item slot in the weapon panel (single slot: cracker/medkit/shield).
function updateItemSlot(me) {
  const el = $('wItem');
  if (!me || me.maxHp == null) { el.hidden = true; return; }
  el.hidden = false;
  const it = me.item;
  const itemText = it?.kind
    ? `${ITEM_ICON[it.kind] ?? ''}${(ITEM_LABEL[it.kind] ?? it.kind).toUpperCase()}${(it.count ?? 1) > 1 ? ' ×' + it.count : ''}`
    : '—';
  // the carried LythiumSeal rides its OWN field (never the item slot), so it
  // reads as a badge beside whatever the slot holds
  const seal = me.lythseal || me.hasSeal;
  $('wItemLabel').textContent = seal
    ? `${ITEM_ICON.lythseal}${ITEM_LABEL.lythseal}${it?.kind ? ' · ' + itemText : ''}`
    : itemText;
}

// Bastion (day/night + core) and PvP (ctf score / br zone) mission readouts.
// Every field is optional — absent on classic/story snapshots.
function updateModePanels(snap) {
  const cyc = snap.cycle;
  $('bastionInfo').hidden = !cyc;
  if (cyc) {
    const t = Math.max(0, cyc.t ?? 0);
    const clock = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const night = cyc.phase === 'night';
    $('cyclePhase').textContent = night
      ? `${cyc.bloodMoon ? 'BLOOD MOON' : 'NIGHT'} ${cyc.nightNo ?? 1}${cyc.nights ? '/' + cyc.nights : ''} — ${clock}`
      : `DAY — DUSK IN ${clock}`;
    $('cyclePhase').style.color = night && cyc.bloodMoon ? '#ff7a6a' : '';
    const core = snap.core;
    $('coreWrap').hidden = !core;
    if (core) {
      $('coreLabel').textContent = `CORE ${core.hp ?? 0}/${core.maxHp ?? 0}`;
      const pct = Math.max(0, Math.min(1, (core.hp ?? 0) / (core.maxHp || 1)));
      $('coreFill').style.width = Math.round(pct * 100) + '%';
    }
    // beacon-defense variant: four monolith pips (lit/dark) instead of one
    // core bar; the landed Anchorcraft reads as a boarding tag beside them
    const pips = $('beaconPips');
    const cores = snap.cores;
    pips.hidden = !cores?.length;
    if (cores?.length) {
      pips.innerHTML = cores.map(c => `<span class="bpip ${(c.hp ?? 0) > 0 ? 'lit' : 'dark'}">⬟</span>`).join('')
        + (snap.ship?.landed ? ' <span class="bship">⏏ SHIP DOWN — BOARD TO EXTRACT</span>' : '');
    }
  }

  const el = $('pvpInfo');
  const focus = session?.focusPids?.() ?? new Set();
  let text = '';
  if (snap.caps) {
    // ctf score — relative ("YOU/FOE") when every local seat shares a team,
    // neutral when a couch hosts both teams
    const teams = new Set((snap.players ?? []).filter(p => focus.has(p.pid) && p.team != null).map(p => p.team));
    const caps = snap.caps;
    if (teams.size === 1) {
      const mine = [...teams][0];
      text = `YOU ${caps[mine] ?? 0} — ${caps[1 - mine] ?? 0} FOE`;
    } else {
      text = `${TEAM_NAME[0]} ${caps[0] ?? 0} — ${caps[1] ?? 0} ${TEAM_NAME[1]}`;
    }
    if (snap.flags?.length) {
      const st = f => f.carrier != null ? 'TAKEN' : (f.atBase ?? true) ? 'AT BASE' : 'DROPPED';
      text += '\n' + snap.flags.map(f => `${TEAM_NAME[f.team] ?? 'FLAG'}: ${st(f)}`).join(' · ');
    }
  } else if (snap.zone) {
    const remaining = (snap.players ?? []).filter(p => p.state !== 'out' && p.state !== 'extracted').length;
    text = `${remaining} REMAIN`;
    const sh = snap.zone.shrinkT;
    if (sh != null && sh > 0) text += ` · ZONE SHRINKS ${Math.ceil(sh)}s`;
  }
  el.hidden = !text;
  if (text) el.textContent = text;

  // spectate tag: every local seat is out but the match plays on (camera
  // already falls back to the remaining active players)
  const locals = (snap.players ?? []).filter(p => focus.has(p.pid));
  $('spectateTag').hidden =
    !(snap.status === 'play' && locals.length > 0 && locals.every(p => p.state === 'out'));
}

function charStatus(id, snap) {
  for (const p of snap.players) if (p.charId === id && p.state === 'active') return ['IN FIELD', 'infield', 100];
  for (const c of snap.captives) if (c.charId === id) return [c.owner != null ? 'CARRIED' : 'DOWN', 'down', 30];
  if (snap.rescued.includes(id)) return ['EXTRACTED', '', 100];
  return ['READY', '', 100];
}

function updateHUD(snap) {
  $('hScore').textContent = (snap.score ?? 0).toLocaleString();
  // untimed maps (story/bastion) count UP from elapsed and never tint red;
  // classic arcade countdowns are untouched
  const tl = Math.max(0, (snap.untimed ? snap.elapsed : snap.timeLeft) ?? 0);
  $('hTime').textContent = `${String(Math.floor(tl / 60)).padStart(2, '0')}:${String(Math.floor(tl % 60)).padStart(2, '0')}`;
  $('hTime').style.color = !snap.untimed && tl < 15 ? '#ff7a6a' : '';
  $('hKills').textContent = snap.kills ?? 0;
  $('hCombo').textContent = 'x' + (snap.combo ?? 1);
  // ctf runs per-team shard pools: show YOUR team's pool (both, labelled,
  // when a couch hosts both teams). Everything else shows the squad pool.
  if (snap.teamShards) {
    const focus = session?.focusPids?.() ?? new Set();
    const teams = new Set((snap.players ?? []).filter(p => focus.has(p.pid) && p.team != null).map(p => p.team));
    $('hShards').textContent = teams.size === 1
      ? '◆' + Math.floor(snap.teamShards[[...teams][0]] ?? 0)
      : `A◆${Math.floor(snap.teamShards[0] ?? 0)} B◆${Math.floor(snap.teamShards[1] ?? 0)}`;
  } else {
    $('hShards').textContent = '◆' + Math.floor(snap.shards ?? 0);
  }

  const gateEl = $('missionGate');
  if (snap.gate) {
    gateEl.hidden = false;
    gateEl.textContent = snap.gate.open
      ? 'ANCHOR OPEN'
      : snap.gate.charging
        ? 'ANCHOR CHARGING…' // full quorum, time-locked (hold the line)
        : `PYLONS ${snap.gate.built ?? 0}/${snap.gate.need ?? 0}`;
    gateEl.style.color = snap.gate.open ? 'var(--green)' : '';
  } else {
    gateEl.hidden = true;
  }

  for (const [id, card] of Object.entries(squadCards)) {
    const [label, cls, pct] = charStatus(id, snap);
    card.className = 'squadcard' + (cls ? ' ' + cls : '');
    card.querySelector('.st').textContent = label;
    card.querySelector('.bar i').style.width = pct + '%';
  }
  const sleeping = snap.enemies.filter(e => e.awake === false).length;
  // followers (combat hires/dogs) ship only on maps with hire posts; the
  // squad cap is 5 (2 per player) so the count reads against the pool
  const followers = snap.followers?.length ?? 0;
  $('squadStatusBody').textContent =
    `Hostiles: ${snap.enemies.length}${sleeping ? ` (${sleeping} unaware)` : ''} · Rescued: ${snap.rescued.length}`
    + (followers ? ` · Followers: ${followers}/5` : '');

  const focus = session?.focusPids() ?? new Set();
  const me = snap.players.find(p => focus.has(p.pid) && p.state === 'active' && p.charId)
    || snap.players.find(p => p.pid === session?.primaryPid());
  const ch = me?.charId ? charMap[me.charId] : null;
  const fw = me?.fieldWeapon;
  // field pickups read relay-cyan in the panel; character weapons keep amber
  $('wName').classList.toggle('fieldweapon', !!fw?.kind);
  if (fw?.kind) {
    // a field pickup overrides the character weapon: name + ammo replace the
    // stat line (special is unchanged, so the special row stays as-is below)
    $('wName').textContent = FIELD_WEAPON_LABEL[fw.kind] ?? String(fw.kind).toUpperCase();
    if (typeof renderMod.drawFieldWeaponIcon === 'function') renderMod.drawFieldWeaponIcon($('wIcon'), fw.kind);
    else { const c = $('wIcon'); c.getContext('2d').clearRect(0, 0, c.width, c.height); }
    $('wStats').textContent = `AMMO ${fw.ammo ?? 0} · hold Q / . / Y to drop`;
  } else if (ch) {
    $('wName').textContent = ch.weapon.name.toUpperCase();
    drawWeaponIcon($('wIcon'), ch);
    $('wStats').textContent = `DMG ${ch.weapon.damage} · RNG ${ch.weapon.range} · ROF ${(1 / ch.weapon.cooldown).toFixed(1)}/s`;
  }
  const sp = ch?.special;
  if (sp) {
    $('wSpecial').hidden = false;
    $('wSpecialName').textContent = (sp.name ?? sp.kind ?? 'SPECIAL').toUpperCase();
    const cool = Math.max(0, me?.specialCool ?? 0);
    const pct = Math.max(0, Math.min(1, 1 - cool / (sp.cooldown || 1)));
    $('wSpecialFill').style.width = Math.round(pct * 100) + '%';
  } else {
    $('wSpecial').hidden = true;
  }
  // per-mission XP/level (non-arcade snapshots only; classic players carry
  // neither field so the row stays hidden). Thresholds are cumulative: a bar
  // shows progress from this level's floor to the next; L4 (max) pins full.
  const XP_T = [0, 12, 34, 70];
  if (me?.level != null) {
    $('wXp').hidden = false;
    const lvl = Math.max(1, Math.min(4, me.level));
    $('wLvl').textContent = lvl >= 4 ? lvl + ' MAX' : String(lvl);
    const prev = XP_T[lvl - 1], next = XP_T[lvl];
    const pct = lvl >= 4 ? 1 : Math.max(0, Math.min(1, ((me.xp ?? 0) - prev) / (next - prev)));
    $('wXpFill').style.width = Math.round(pct * 100) + '%';
  } else {
    $('wXp').hidden = true;
  }
  updateItemSlot(me);
  updateHearts(snap);
  updateObjectives(snap);
  updateModePanels(snap);
  updateCountdown(snap);
  updateControlsOverlay(snap, me);
  renderMinimap(mmCtx, snap, session?.focusPids() ?? new Set());
  fogUpdate(snap);
  fogMaskMinimap(mmCtx, snap);
}

// ---------- fog of war (client-side exploration; no sim change) ----------
// The mask accumulates a ~10-tile reveal around EVERY player's position in
// every snapshot — positions are shared, so every machine derives the same
// mask. It resets whenever a new grid object arrives (new mission, retry,
// next chapter). Versus and classic arcade missions keep their full minimap.
const FOG_R = 10;
const fog = { gridRef: null, w: 0, h: 0, mask: null, stamp: {} };
function fogActive() {
  if (!session) return false;
  if (session.versusMode?.()) return false;
  return !!(session.story || session.bastionMode?.() || session.expedition);
}
function fogUpdate(snap) {
  if (!snap.grid || !fogActive()) return;
  if (fog.gridRef !== snap.grid) {
    fog.gridRef = snap.grid;
    fog.w = snap.w;
    fog.h = snap.h;
    fog.mask = new Uint8Array(snap.w * snap.h);
    fog.stamp = {};
  }
  for (const p of snap.players ?? []) {
    if (p.x == null || p.state === 'out') continue;
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    const k = tx + ',' + ty;
    if (fog.stamp[p.pid] === k) continue; // unchanged tile — already stamped
    fog.stamp[p.pid] = k;
    for (let dy = -FOG_R; dy <= FOG_R; dy++) {
      const y = ty + dy;
      if (y < 0 || y >= fog.h) continue;
      const span = Math.floor(Math.sqrt(FOG_R * FOG_R - dy * dy));
      const x0 = Math.max(0, tx - span), x1 = Math.min(fog.w - 1, tx + span);
      for (let x = x0; x <= x1; x++) fog.mask[y * fog.w + x] = 1;
    }
  }
}
// Paints unexplored tiles near-black OVER the freshly drawn minimap, so
// terrain and entity dots only read in explored areas (players reveal their
// own surroundings, so they always stay visible).
function fogMaskMinimap(c, snap) {
  if (!fogActive() || !fog.mask || fog.gridRef !== snap.grid) return;
  const W = c.canvas.width, H = c.canvas.height;
  const sx = W / fog.w, sy = H / fog.h;
  c.fillStyle = '#04060b';
  for (let y = 0; y < fog.h; y++) {
    const row = y * fog.w;
    let x = 0;
    while (x < fog.w) {
      if (fog.mask[row + x]) { x++; continue; }
      let x2 = x + 1;
      while (x2 < fog.w && !fog.mask[row + x2]) x2++;
      c.fillRect(x * sx, y * sy, (x2 - x) * sx + 0.25, sy + 0.25);
      x = x2;
    }
  }
}

// ---------- wave countdown (center-top blinking banner) ----------
// Driven from snap.cycle (<15s to dusk), the BR zone clock and the CTF
// sudden-death timer — every read optional so classic snapshots no-op.
let cdSig = null;
function updateCountdown(snap) {
  let text = '', blood = false;
  if (snap.status === 'play') {
    const cyc = snap.cycle;
    if (cyc?.phase === 'day' && cyc.t > 0 && cyc.t <= 15) {
      blood = !!cyc.bloodMoon;
      text = `${blood ? 'BLOOD MOON' : 'NIGHTFALL'} IN ${Math.ceil(cyc.t)}`;
    } else if (snap.zone?.shrinkT > 0 && snap.zone.shrinkT <= 15) {
      text = `ZONE SHRINKS IN ${Math.ceil(snap.zone.shrinkT)}`;
    } else if (snap.caps && !snap.untimed && snap.timeLeft > 0 && snap.timeLeft <= 15) {
      text = `SUDDEN DEATH IN ${Math.ceil(snap.timeLeft)}`;
    }
  }
  const sig = text + (blood ? '!' : '');
  if (sig === cdSig) return;
  cdSig = sig;
  const el = $('countdown');
  el.hidden = !text;
  el.textContent = text;
  el.classList.toggle('blood', blood);
}

// ---------- controls overlay (corner panel; Settings toggle, default ON) ----
// Shows the CURRENT bindings (remap-aware) plus a contextual hint when a
// local seat stands near a shop/carousel/tower/build site.
let ctrlHudOn = localStorage.getItem('holdout-hd.ctrlhud') !== '0';
let ctrlSig = null;
function updateControlsOverlay(snap, me) {
  const el = $('ctrlOverlay');
  if (!ctrlHudOn || !session || snap.status !== 'play' || visibleScreen() || session.cutscene) {
    if (!el.hidden) el.hidden = true;
    ctrlSig = null;
    return;
  }
  const k = a => keyLabel((KB1[a] ?? [])[0]);
  const pb = a => padLabel((PADMAP[a] ?? [])[0]);
  const rows = [
    `MOVE  WASD · STICK/D-PAD`,
    `FIRE  ${k('fire')} · ${pb('fire')}`,
    `SPCL  ${k('special')} · ${pb('special')}`,
    `ACT   ${k('act')} · ${pb('act')}`,
    `ITEM  ${k('item')} · ${pb('item')}`,
    `MAP   hold ${k('map')} · ${pb('map')}`,
  ];
  let hint = '';
  if (me && me.state === 'active') {
    const near = (o) => o && ((o.x - me.x) ** 2 + (o.y - me.y) ** 2) < (1.5 * TILE) ** 2;
    if (me.shop) hint = `SHOP — HOLD ${k('act')}/${pb('act')} + ◄ ► CYCLES · FIRE BUYS`;
    else if (me.selecting) hint = `TURRET TYPE — HOLD ${k('act')}/${pb('act')} + ◄ ► CYCLES · FIRE CONFIRMS`;
    else if ((snap.builds ?? []).some(b => !b.built && near(b))) hint = `HOLD ${k('act')}/${pb('act')} BUILDS · SHOOT YOUR OWN WALLS TO DEMOLISH`;
    else if ((snap.towers ?? []).some(t => (t.hp ?? 1) > 0 && t.occupant == null && near(t))) hint = `${k('act')}/${pb('act')} MANS THE TOWER`;
    else if ((snap.shops ?? []).some(s => near(s))) hint = `HOLD ${k('act')}/${pb('act')} BROWSES THE STALL`;
    else if ((snap.npcs ?? []).some(n => near(n))) hint = `${k('act')}/${pb('act')} TALKS`;
  }
  const sig = rows.join('|') + '#' + hint;
  if (sig === ctrlSig) return;
  ctrlSig = sig;
  el.hidden = false;
  el.innerHTML = rows.map(r => `<div>${r}</div>`).join('')
    + (hint ? `<div class="chint">${hint}</div>` : '');
}

// ---------- full-map overlay (hold MAP: pad SELECT / Tab / M) ----------
// A scaled copy of the freshly drawn minimap (fog, entities and the camera
// rect are already baked in) centered over the dimmed field, plus pulsing
// objective markers. Pure client/render — released, it vanishes instantly.
function drawMapOverlay(ctx, snap, t) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save();
  ctx.fillStyle = 'rgba(4,6,11,0.8)';
  ctx.fillRect(0, 0, W, H);
  const aspect = (snap.w || 1) / (snap.h || 1);
  let dw = W * 0.8, dh = dw / aspect;
  if (dh > H * 0.76) { dh = H * 0.76; dw = dh * aspect; }
  const dx = (W - dw) / 2, dy = (H - dh) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage($('minimap'), dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = true;
  ctx.strokeStyle = 'rgba(111,216,242,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(dx - 1.5, dy - 1.5, dw + 3, dh + 3);
  // objective markers (world px -> overlay px), fog-respecting
  const px = x => dx + (x / (snap.w * TILE)) * dw;
  const py = y => dy + (y / (snap.h * TILE)) * dh;
  const seen = (x, y) => !fogActive() || !fog.mask || fog.gridRef !== snap.grid
    || !!fog.mask[Math.min(fog.h - 1, Math.max(0, Math.floor(y / TILE))) * fog.w + Math.min(fog.w - 1, Math.max(0, Math.floor(x / TILE)))];
  const ring = (x, y, col) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px(x), py(y), 6 + 2.5 * Math.sin(t * 5), 0, Math.PI * 2);
    ctx.stroke();
  };
  if (snap.core) ring(snap.core.x, snap.core.y, 'rgba(255,217,138,0.9)');
  for (const c of snap.cores ?? []) ring(c.x, c.y, (c.hp ?? 0) > 0 ? 'rgba(255,217,138,0.9)' : 'rgba(224,72,72,0.9)');
  for (const q of snap.qitems ?? []) if (q.carrier == null && seen(q.x, q.y)) ring(q.x, q.y, 'rgba(111,216,242,0.9)');
  if (snap.ship?.landed) ring(snap.ship.x, snap.ship.y, 'rgba(111,216,242,0.95)');
  ctx.fillStyle = '#DFF3FF';
  ctx.textAlign = 'center';
  ctx.font = `bold ${Math.max(14, Math.round(H * 0.024))}px ui-monospace, Menlo, monospace`;
  ctx.fillText('TACTICAL MAP', W / 2, dy - Math.max(10, H * 0.015));
  ctx.fillStyle = 'rgba(160,176,204,0.75)';
  ctx.font = `${Math.max(10, Math.round(H * 0.015))}px ui-monospace, Menlo, monospace`;
  ctx.fillText('release MAP to return', W / 2, dy + dh + Math.max(16, H * 0.025));
  ctx.restore();
}

// ---------- cutscene slide player (shared by Local and Net sessions) ----------
// Owns sess.cutscene = { slides, idx, t, done, hold, holdHint, waiting, fired }.
// The frame loop draws sess.cutscene; any local device (or a mouse click)
// advances OUR slides. hold: online intros — the last slide stays up (done
// fires once, e.g. to send cutsceneDone) until levelStart tears it down, so
// the host paces the whole room.
function startSlides(sess, slides, done, opts = {}) {
  if (demoMode || !slides?.length || typeof renderMod.drawCutscene !== 'function') return done();
  hideAll();
  hideDialogue();
  playUi('cutscene');
  canvas.classList.add('cutscene');
  canvas.onclick = () => { sess.cutsceneClick = true; }; // mouse can advance too
  sess.cutscene = { slides, idx: 0, t: 0, done, hold: !!opts.hold, holdHint: opts.holdHint || '', waiting: false, fired: false };
}
function slidesTick(sess, polled, dt) {
  const cs = sess.cutscene;
  cs.t += dt;
  let adv = cs.t >= 12 || sess.cutsceneClick; // idle couch still auto-advances
  sess.cutsceneClick = false;
  for (const st of Object.values(polled)) {
    if (st.fireJust || st.startJust) { st.fireJust = st.startJust = false; adv = true; }
  }
  if (!adv) return;
  if (cs.hold && cs.idx + 1 >= cs.slides.length) {
    // finished, but the level starts on the host's say-so — hold the last slide
    cs.waiting = true;
    if (!cs.fired) { cs.fired = true; cs.done(); }
    return;
  }
  cs.idx++;
  cs.t = 0;
  if (cs.idx >= cs.slides.length) {
    endSlides(sess);
    cs.done();
  } else {
    playUi('cutscene');
  }
}
function endSlides(sess) {
  sess.cutscene = null;
  canvas.classList.remove('cutscene');
  canvas.onclick = null;
  // a button still held from the dismissing press must not fire into the
  // sim's first frames — squelch each device's fire until it is released
  // (prevDev mirrors this frame's raw device state)
  sess.fireSquelch = new Set(DEVICES.filter(d => prevDev[d]?.fire));
}

// ---------- local couch session (1-4 players, one screen) ----------
class LocalSession {
  constructor(save, opts = {}) {
    this.story = !!opts.story;
    // local versus ('ctf'|'br'): one-map match list, no autosave, no roster churn
    this.mode = opts.mode === 'ctf' || opts.mode === 'br' ? opts.mode : null;
    // bastion siege: expedition-style one-shot (no saves), solo+ couch fine
    this.bastion = opts.mode === 'bastion';
    this.expedition = !this.story && !this.mode && !this.bastion && !!opts.expedition;
    this.levels = this.story ? storyLevels
      : this.mode ? (this.mode === 'ctf' ? ctfLevels : brLevels)
        : this.bastion ? bastionLevels
          : this.expedition ? expeditions : campaign;
    this.levelIdx = this.story
      ? Math.max(0, Math.min((save?.chapter ?? 1) - 1, this.levels.length - 1))
      : this.bastion
        ? Math.max(0, Math.min(opts.levelIdx ?? 0, Math.max(0, this.levels.length - 1)))
        : (this.expedition || this.mode) ? 0 : (save?.levelIdx ?? 0);
    // stronghold lobbies draw from the stronghold roster (starters + every
    // operative unlocked by beaten levels); other modes are untouched
    this.roster = save?.roster ?? (this.bastion ? strongholdRoster() : startingRoster.slice());
    this.players = []; // { pid, name, device, charId, cursor }
    this.game = null;
    this.snap = null;
    this.paused = false;
    this.inLobby = false;
    this.cutscene = null; // { slides, idx, t, done } — intro/outro state machine
  }
  focusPids() { return new Set(this.players.map(p => p.pid)); }
  primaryPid() { return 0; }
  levelIdxView() { return this.levelIdx; }
  levelList() { return this.levels; }
  versusMode() { return this.mode; }
  bastionMode() { return this.bastion; }
  // seats alternate ctf teams by join order (P1/P3 vs P2/P4)
  teamOf(p) { return this.mode === 'ctf' ? p.pid % 2 : this.mode === 'br' ? p.pid : null; }
  canStart() {
    return this.players.length >= (this.mode ? 2 : 1) && this.players.every(p => p.charId);
  }

  lobby() {
    if (this.levelIdx >= this.levels.length) return this.victory();
    this.inLobby = true;
    this.renderLobby();
  }
  renderLobby() {
    const lvl = this.levels[this.levelIdx];
    const ctf = this.mode === 'ctf';
    // versus lobbies tint badges/cursors by team so the split reads at a glance
    const colorOf = p => ctf ? TEAMC[p.pid % 2] : PCOLORS[p.pid];
    renderLobby({
      title: this.story
        ? (lvl.title || `Chapter ${this.levelIdx + 1} — ${lvl.name}`)
        : this.mode
          ? `Versus ${ctf ? 'CTF' : 'Royale'} — ${lvl.name}`
          : this.bastion
            ? (lvl.stronghold
              ? `Stronghold ${String(lvl.stronghold.level ?? this.levelIdx + 1).padStart(2, '0')} — ${lvl.stronghold.name ?? lvl.name}`
              : `Bastion — ${lvl.name}`)
            : this.expedition
              ? `Expedition — ${lvl.name}`
              : `Mission ${this.levelIdx + 1} / ${this.levels.length} — ${lvl.name}`,
      info: this.story
        ? 'Story campaign · progress autosaves between chapters'
        : ctf ? 'Capture the Flag · first to 3 captures · 2-4 players, join order alternates teams'
          : this.mode === 'br' ? 'Battle Royale · last operative standing · 2-4 players'
            : this.bastion ? 'Siege survival · hold through every night · 1-4 players · clears unlock the next stronghold and new operatives'
              : this.expedition ? 'One huge map. No autosave — bring everyone home.' : 'Local campaign · progress autosaves',
      hint: 'Press FIRE to join: gamepad (A) · keyboard WASD+Space · keyboard Arrows+Enter — up to 4 players. Move your cursor with LEFT/RIGHT, FIRE to lock in. '
        + 'In the field — SPECIAL: F / RShift / B·RB · ACT: E / Slash / X · ITEM: Q / . / Y. '
        + (ctf ? 'Blue seats are Team A, red seats Team B — odd joins vs even joins.'
          : 'Hold ACT on a build site to construct — LYTH shards drop from fallen Entropy.'),
      players: this.players.map(p => ({
        name: p.name, charId: p.charId, isHost: p.pid === 0, me: false,
        badge: 'P' + (p.pid + 1), color: colorOf(p),
      })),
      roster: this.roster,
      canStart: this.canStart(),
      cursors: this.players.map(p => ({ idx: p.cursor, color: colorOf(p), badge: 'P' + (p.pid + 1), picked: !!p.charId })),
      onCard: id => this.clickChar(id),
    });
  }
  deviceOf(id) { return this.players.find(p => p.device === id); }
  join(device) {
    if (this.players.length >= 4 || this.deviceOf(device)) return;
    const pid = this.players.length;
    const name = pid === 0
      ? ($('nameInput').value.trim() || 'P1').slice(0, 12)
      : 'P' + (pid + 1);
    this.players.push({ pid, name, device, charId: null, cursor: 0, missingT: 0 });
    this.renderLobby();
  }
  unjoin(p) {
    const i = this.players.indexOf(p);
    if (i < 0) return;
    this.players.splice(i, 1);
    this.players.forEach((q, idx) => {
      q.pid = idx;
      if (/^P[1-4]$/.test(q.name)) q.name = 'P' + (idx + 1);
    });
    this.renderLobby();
  }
  clickChar(id) {
    if (!this.players.length) this.join('kb1');
    this.pick(this.players[0], id);
  }
  pick(p, id) {
    if (p.charId === id) {
      p.charId = null;
    } else {
      // versus relaxes uniqueness to same-team only (matches the server):
      // ctf allows the same char on opposite teams; br teams are the pids so
      // duplicates always pass. Classic/story/co-op stay strictly unique.
      const taken = this.players.some(o => o !== p && o.charId === id
        && (!this.mode || this.teamOf(o) === this.teamOf(p)));
      if (taken || !this.roster.includes(id)) return;
      p.charId = id;
      p.cursor = this.roster.indexOf(id);
    }
    this.renderLobby();
  }
  lobbyTick(polled, dt) {
    let moved = false;
    // a joined gamepad that vanished before picking (battery died) would
    // block Deploy forever — drop it after a grace period
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      if (p.device.startsWith('gp') && !polled[p.device] && !p.charId) {
        p.missingT += dt;
        if (p.missingT > 3) this.unjoin(p);
      } else p.missingT = 0;
    }
    for (const [dev, st] of Object.entries(polled)) {
      const p = this.deviceOf(dev);
      if (!p) {
        if (st.fireJust) this.join(dev);
        continue;
      }
      if (st.startJust) {
        if (p.pid === 0 && this.canStart()) return this.start();
        if (!p.charId) { this.unjoin(p); continue; }
      }
      const n = this.roster.length;
      if (!p.charId) {
        if (st.leftJust) { p.cursor = mod(p.cursor - 1, n); moved = true; }
        if (st.rightJust) { p.cursor = mod(p.cursor + 1, n); moved = true; }
        if (st.upJust) { p.cursor = mod(p.cursor - 5, n); moved = true; }
        if (st.downJust) { p.cursor = mod(p.cursor + 5, n); moved = true; }
      }
      if (st.fireJust) this.pick(p, p.charId ?? this.roster[p.cursor]);
    }
    if (moved) this.renderLobby();
  }
  start() {
    if (!this.inLobby || !this.canStart()) return;
    this.inLobby = false;
    const lvl = this.levels[this.levelIdx];
    const begin = () => {
      this.game = createGame(
        lvl,
        // versus party entries carry team (ctf: alternating seats, br: own pid)
        this.players.map(p => ({
          pid: p.pid, name: p.name, charId: p.charId,
          ...(this.mode ? { team: this.teamOf(p) } : {}),
        })),
        charMap,
        this.roster
      );
      this.snap = null;
      this.paused = false;
      hideAll();
    };
    // Story chapters and stronghold levels open on an intro cutscene (every
    // stronghold ships one slide: what is happening + what to do); the sim is
    // created only after it ends, so no mission time is lost. Classic and
    // expedition runs start instantly. startSlides() handles missing slides.
    if (this.story || this.bastion) this.startCutscene(lvl.intro, begin);
    else begin();
  }
  // Cutscenes are client-owned: render.drawCutscene draws, the shared slide
  // player advances. If the renderer doesn't ship cutscenes (yet), or we're in
  // demo/attract mode (bots can't press FIRE, &warp needs the sim immediately),
  // startSlides skips straight to done().
  startCutscene(slides, done) { startSlides(this, slides, done); }
  cutsceneTick(polled, dt) { slidesTick(this, polled, dt); }
  togglePause() {
    if (!this.game || this.game.status !== 'play') return;
    this.paused = !this.paused;
    if (this.paused) showMsg('Paused', 'The frontier waits.', 'Resume', () => this.togglePause());
    else hideAll();
  }
  tick(polled, dt) {
    if (this.cutscene) return this.cutsceneTick(polled, dt);
    if (this.inLobby) return this.lobbyTick(polled, dt);
    if (!this.game) {
      // a mission-end dialog is up: fire/start on any device clicks through,
      // so a controller-only couch never needs the mouse
      for (const st of Object.values(polled)) {
        if (st.fireJust || st.startJust) { $('btnMsgOk').click(); break; }
      }
      return;
    }
    for (const [dev, st] of Object.entries(polled)) {
      if (st.startJust && this.deviceOf(dev)) { this.togglePause(); break; }
    }
    if (this.paused || this.game.status !== 'play') return;
    const inputs = {};
    for (const p of this.players) {
      if (p.device.startsWith('bot')) { inputs[p.pid] = this.botInput(p, dt); continue; }
      const st = polled[p.device];
      let fire = !!st?.fire;
      if (this.fireSquelch?.has(p.device)) {
        if (fire) fire = false; // held since the cutscene dismissal
        else this.fireSquelch.delete(p.device);
      }
      inputs[p.pid] = st
        ? { up: st.up, down: st.down, left: st.left, right: st.right, fire, special: st.special, act: st.act, item: st.item }
        : {};
    }
    step(this.game, inputs, dt);
    this.snap = snapshot(this.game);
    for (const ev of this.snap.events) {
      handleEvent(ev);
      if (ev.type === 'beacon') this.saveBeacon();
    }
    if (this.snap.status !== 'play') this.finish();
  }
  // Attract-mode bot (?demo=1): walks east toward the exit, shoots what gets
  // close, holds ACT at build sites/NPCs. Reads only snapshot state, so it is
  // safe on classic maps where builds/npcs do not exist.
  botInput(p, dt) {
    const inp = { up: false, down: false, left: false, right: false, fire: false, special: false, act: false, item: false };
    const snap = this.snap;
    const me = snap?.players?.find(q => q.pid === p.pid);
    if (!me) return inp;
    const b = p.bot ??= { bias: p.pid % 2 ? 1 : -1, lastX: me.x, t: 0, pulse: 0 };
    if (me.state === 'pick') {
      // pulse fire so the respawn pick confirms (edges need release+press)
      b.pulse += dt;
      inp.fire = Math.floor(b.pulse * 4) % 2 === 0;
      return inp;
    }
    if (me.state !== 'active') return inp;

    // march east; flip the vertical bias every ~2s while x-progress stalls
    b.t += dt;
    if (b.t >= 2) {
      if (me.x - b.lastX < 0.4 * TILE) b.bias = -b.bias;
      b.lastX = me.x;
      b.t = 0;
    }
    inp.right = true;
    if (b.bias < 0) inp.up = true; else inp.down = true;

    const steerTo = (tx, ty) => {
      inp.up = inp.down = inp.left = inp.right = false;
      if (tx - me.x > 0.25 * TILE) inp.right = true; else if (me.x - tx > 0.25 * TILE) inp.left = true;
      if (ty - me.y > 0.25 * TILE) inp.down = true; else if (me.y - ty > 0.25 * TILE) inp.up = true;
    };

    // hold ACT at an unbuilt build site (nudging to stay in range) or near an NPC
    const dist = o => Math.hypot(o.x - me.x, o.y - me.y);
    const site = (snap.builds ?? []).find(s => !s.built && dist(s) <= 1.4 * TILE);
    if (site) {
      inp.act = true;
      steerTo(site.x, site.y);
      return inp;
    }
    if ((snap.npcs ?? []).some(n => dist(n) <= 1.4 * TILE)) inp.act = true;

    // engage AWAKE enemies within ~5 tiles (sleeping ones may be unreachable
    // behind walls — chasing them deadlocks the eastward march)
    if (demoMode !== 2) {
      let tgt = null, best = 5 * TILE;
      for (const e of snap.enemies ?? []) {
        if (e.awake === false) continue;
        const d = dist(e);
        if (d < best) { best = d; tgt = e; }
      }
      if (tgt) {
        inp.fire = true;
        steerTo(tgt.x, tgt.y);
      }
    }
    return inp;
  }
  // Save beacons checkpoint LOCAL story runs only (the server ignores them
  // online). serializeGame/restoreGame are guarded gameMod reads — an older
  // sim build simply means no checkpoint, never a crash.
  saveBeacon() {
    if (!this.story || demoMode || !this.game || typeof gameMod.serializeGame !== 'function') return;
    try {
      localStorage.setItem(BEACON_KEY, JSON.stringify({ chapter: this.levelIdx + 1, data: gameMod.serializeGame(this.game) }));
      showToast('BEACON LIT — PROGRESS SAVED');
    } catch {} // storage quota — a failed checkpoint must never break the run
  }
  resumeBeacon() {
    const b = loadBeacon(this.levelIdx + 1);
    let g = null;
    if (b && typeof gameMod.restoreGame === 'function') {
      try { g = gameMod.restoreGame(b.data, charMap); } catch {}
    }
    // a beacon must round-trip into a live, steppable game: status 'play', a
    // populated players array, numeric bounds and a row-per-tile string grid.
    // Anything else is corrupt/stale storage — resuming it would soft-lock
    // the chapter, so the beacon is discarded with a toast instead.
    const valid = !!g && g.status === 'play'
      && Array.isArray(g.players) && g.players.length > 0
      && typeof g.w === 'number' && Number.isFinite(g.w) && g.w > 0
      && typeof g.h === 'number' && Number.isFinite(g.h) && g.h > 0
      && Array.isArray(g.grid) && g.grid.length === g.h
      && g.grid.every(row => typeof row === 'string' && row.length === g.w);
    if (!valid) {
      clearBeacon(); // unreadable/corrupt beacon: regroup in the lobby
      this.lobby();
      // after lobby(): showing a screen wipes the toast queue first
      showToast('SAVE BEACON CORRUPT — CHECKPOINT DISCARDED', 3200, true);
      return;
    }
    this.game = g;
    this.snap = null;
    this.paused = false;
    hideAll();
  }
  finish() {
    if (this.mode) return this.finishVersus();
    const res = applyResults(this.roster, this.game);
    const cleared = this.game.status === 'cleared';
    const score = Math.round(this.game.score);
    const lvl = this.levels[this.levelIdx];
    this.game = null;
    this.paused = false;
    for (const p of this.players) { p.charId = null; p.cursor = 0; p.bot = null; }
    if (cleared) {
      this.roster = res.roster;
      if (this.story) {
        this.levelIdx++;
        // save now (before any cutscene/dialog) so quitting can't lose the clear;
        // demo/attract runs never touch the player's story save or its beacon
        if (!demoMode) {
          clearBeacon(); // the chapter is cleared — its mid-run checkpoint is spent
          if (this.levelIdx >= this.levels.length) localStorage.removeItem(STORY_KEY);
          else localStorage.setItem(STORY_KEY, JSON.stringify({ chapter: this.levelIdx + 1, roster: this.roster }));
        }
        this.startCutscene(lvl.outro, () => {
          if (this.levelIdx >= this.levels.length) return this.victory();
          showMsg('Chapter Cleared', (resultText(res) || 'The line holds.') + `\nScore: ${score.toLocaleString()}`, 'Continue', () => this.lobby());
        });
        return;
      }
      if (this.bastion) {
        // stronghold progression: mark the level beaten, unlock the next one
        // and its operative (toasts ride over the results dialog)
        playUi('victory');
        const unlocks = demoMode ? [] : shRecordClear(lvl);
        const last = this.levelIdx >= this.levels.length - 1;
        showMsg('The Stronghold Holds',
          (resultText(res) || 'Every night survived — the line still stands.') + `\nScore: ${score.toLocaleString()}`,
          last ? 'Main Menu' : 'Level Select',
          () => {
            if (last) return this.leave();
            session = null;
            shPurpose = 'local';
            show('menu');
            showMenuPage('pageSh');
            refreshContinue();
          },
          last ? null : 'Main Menu',
          last ? null : () => this.leave());
        for (const t of unlocks) showToast(t, 3000, true);
        return;
      }
      if (this.expedition) {
        playUi('victory');
        showMsg('Expedition Complete!', (resultText(res) || 'The crossing is yours.') + `\nScore: ${score.toLocaleString()}`, 'Main Menu', () => this.leave());
        return;
      }
      this.levelIdx++;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ levelIdx: this.levelIdx, roster: this.roster }));
      showMsg('Mission Cleared', (resultText(res) || 'Nicely done.') + `\nScore: ${score.toLocaleString()}`, 'Continue', () => this.lobby());
    } else {
      // story runs are untimed, so a story fail can only be a squad wipe
      const body = this.story
        ? 'The whole squad went down.\nNo one is lost on a failed run — try again.'
        : 'Time ran out or the whole squad went down.\nNo one is lost on a failed run — try again.';
      // a live beacon on THIS chapter offers a mid-run resume (local story only)
      const beacon = this.story && !demoMode && typeof gameMod.restoreGame === 'function'
        ? loadBeacon(this.levelIdx + 1) : null;
      if (beacon) {
        showMsg('Chapter Failed', body + '\nA save beacon still burns in the field.',
          'Retry', () => this.lobby(), 'Resume from beacon', () => this.resumeBeacon());
      } else {
        showMsg(this.story ? 'Chapter Failed' : 'Mission Failed', body, 'Retry', () => this.lobby());
      }
    }
  }
  // Versus matches never touch the roster or saves; the lobby is the rematch
  // (levelIdx stays put, so the same map reloads with fresh picks).
  finishVersus() {
    const g = this.game;
    const winner = g?.winner;
    const caps = g?.caps;
    this.game = null;
    this.paused = false;
    let body;
    if (this.mode === 'ctf' && winner != null) {
      const names = this.players.filter(p => p.pid % 2 === winner).map(p => p.name).join(', ');
      body = `${TEAM_NAME[winner] ?? 'A team'} takes the match${names ? ` — ${names}` : ''}`
        + (caps ? `\nCaptures: ${caps[0] ?? 0} — ${caps[1] ?? 0}` : '');
    } else if (this.mode === 'br' && winner != null) {
      const name = this.players.find(p => p.pid === winner)?.name ?? 'P' + (winner + 1);
      body = `${name} is the last operative standing.`;
    } else {
      body = 'The match is over.';
    }
    for (const p of this.players) { p.charId = null; p.cursor = 0; p.bot = null; }
    playUi('victory');
    showMsg('Match Over', body, 'Rematch', () => this.lobby());
  }
  victory() {
    playUi('victory');
    if (this.story) {
      if (!demoMode) { localStorage.removeItem(STORY_KEY); clearBeacon(); }
      showMsg('The Crossing Holds', `The Anchor is lit and the frontier breathes again.\nFinal roster: ${this.roster.map(id => charMap[id].name).join(', ')}`, 'Main Menu', () => this.leave());
      return;
    }
    localStorage.removeItem(SAVE_KEY);
    showMsg('Campaign Complete!', `You held out to the end.\nFinal roster: ${this.roster.map(id => charMap[id].name).join(', ')}`, 'Main Menu', () => this.leave());
  }
  leave() { session = null; show('menu'); refreshContinue(); }
}

// ---------- online co-op session ----------
// One WebSocket = one machine, but up to 4 couch seats ride on it: this.seats
// maps an input device to a server pid. The primary pid (from 'joined') stays
// unbound until the first device presses FIRE in the lobby; further devices
// request extra pids with addLocal. A machine with no bound seat keeps the
// classic mouse flow (legacy single-input form, primary pid).
class NetSession {
  constructor(mode, code, hostMode = 'classic', hostLevelIdx = null) {
    this.myPid = null;
    this.myPick = null;
    this.snap = null;
    this.grid = null;
    this.lobbyData = null;
    this.cutscene = null;
    this.seats = new Map();        // device -> pid (insertion order = seat order)
    this.pendingSeats = new Map(); // device -> request time, awaiting localAdded
    this.cursors = {};             // device -> roster pick cursor
    this.missingT = {};            // device -> seconds a bound pad has been gone
    this.name = $('nameInput').value.trim() || 'Player';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.onopen = () => {
      if (mode === 'host') {
        const msg = { t: 'host', name: this.name, resume: code };
        // classic hosting stays byte-identical; story/ctf/br ride the mode field
        if (hostMode && hostMode !== 'classic') msg.mode = hostMode;
        // stronghold: the host's level-select pick rides along (the server
        // clamps it; unlock gating is client-side — this menu only offers
        // unlocked levels)
        if (hostMode === 'bastion' && hostLevelIdx != null) msg.levelIdx = hostLevelIdx;
        this.ws.send(JSON.stringify(msg));
      } else {
        this.ws.send(JSON.stringify({ t: 'join', room: code, name: this.name }));
      }
    };
    this.ws.onmessage = e => this.onMsg(JSON.parse(e.data));
    this.ws.onclose = () => {
      clearInterval(this.inputTimer);
      if (session === this) {
        session = null;
        showMsg('Disconnected', 'Lost connection to the server.', 'Main Menu', () => { show('menu'); refreshContinue(); });
      }
    };
    this.inputTimer = setInterval(() => {
      if (this.ws.readyState !== 1 || this.snap?.status !== 'play') return;
      if (this.seats.size) {
        const inputs = {};
        for (const [dev, pid] of this.seats) inputs[pid] = this.deviceInput(dev);
        this.ws.send(JSON.stringify({ t: 'input', inputs }));
      } else {
        // mouse-only machine: any device drives the primary (legacy form)
        const o = mergedInput();
        if (this.fireSquelch?.size) {
          for (const dev of [...this.fireSquelch]) if (!readDevice(dev)?.fire) this.fireSquelch.delete(dev);
          if (this.fireSquelch.size) o.fire = false;
        }
        this.ws.send(JSON.stringify({ t: 'input', input: o }));
      }
    }, 50);
  }
  get story() { return this.lobbyData?.mode === 'story'; }
  versusMode() {
    const md = this.lobbyData?.mode;
    return md === 'ctf' || md === 'br' ? md : null;
  }
  bastionMode() { return this.lobbyData?.mode === 'bastion'; }
  isHost() { return !!this.lobbyData?.players.find(p => p.pid === this.myPid)?.isHost; }
  pickOf(pid) { return this.lobbyData?.players.find(p => p.pid === pid)?.charId || null; }
  focusPids() { return this.seats.size ? new Set(this.seats.values()) : new Set([this.myPid]); }
  primaryPid() { return this.myPid; }
  levelIdxView() { return this.lobbyData?.levelIdx ?? 0; }
  levelList() {
    const md = this.lobbyData?.mode;
    return md === 'story' ? storyLevels
      : md === 'ctf' ? ctfLevels
        : md === 'br' ? brLevels
          : md === 'bastion' ? bastionLevels : campaign;
  }
  // navTick: a bound device's dpad drives its pick cursor, not the focus ring
  deviceOf(dev) { return this.seats.has(dev) ? dev : null; }
  deviceInput(dev) {
    const c = readDevice(dev);
    if (!c) return {};
    let fire = c.fire;
    if (this.fireSquelch?.has(dev)) {
      if (fire) fire = false; // held since a cutscene was dismissed
      else this.fireSquelch.delete(dev);
    }
    return { up: c.up, down: c.down, left: c.left, right: c.right, fire, special: c.special, act: c.act, item: c.item };
  }
  onMsg(m) {
    if (m.t === 'joined') this.myPid = m.you;
    else if (m.t === 'localAdded') {
      this.pendingSeats.delete(m.tag);
      if (m.tag != null && m.pid != null && !this.seats.has(m.tag)) {
        this.seats.set(m.tag, m.pid);
        this.cursors[m.tag] = 0;
      }
    }
    else if (m.t === 'lobby') {
      this.lobbyData = m;
      // a seat whose pid the server no longer lists is dead — unbind it
      for (const [dev, pid] of [...this.seats]) {
        if (!m.players.some(p => p.pid === pid)) this.unbindSeat(dev);
      }
      const me = m.players.find(p => p.pid === this.myPid);
      this.myPick = me?.charId || null;
      // never stomp a live game, an open dialog or a playing cutscene —
      // renderLobby runs when they dismiss
      if (this.snap?.status === 'play' || !$('msg').hidden || this.cutscene) return;
      this.renderLobby();
    }
    else if (m.t === 'cutscene') {
      // story intro: everyone plays the slides; the host's finish starts the
      // level for the whole room, so non-hosts hold on their last slide
      const host = this.isHost();
      startSlides(this, m.slides, () => {
        if (host && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'cutsceneDone' }));
      }, { hold: true, holdHint: host ? '' : 'waiting for the host…' });
    }
    else if (m.t === 'levelStart') {
      if (this.cutscene) endSlides(this); // the host moved on — drop our slides
      // Full snapshot rides along once; later 'state' ticks omit the grid.
      if (m.s?.grid) this.grid = m.s.grid;
      this.snap = m.s || null;
      hideAll();
    }
    else if (m.t === 'state') {
      if (!m.s.grid) m.s.grid = this.grid;
      else this.grid = m.s.grid;
      const prev = this.snap;
      this.snap = m.s;
      for (const ev of m.s.events) handleEvent(ev);
      if (!prev) hideAll();
    }
    else if (m.t === 'levelEnd') {
      this.myPick = null;
      const vm = this.versusMode();
      if (vm) {
        // pvp: rosters never change and levelIdx stays put (rematch = same map)
        if (m.roster && this.lobbyData) this.lobbyData.roster = m.roster;
        let body;
        if (vm === 'ctf' && m.winner != null) {
          const myTeam = this.lobbyData?.players.find(p => p.pid === this.myPid)?.team;
          body = `${TEAM_NAME[m.winner] ?? 'A team'} takes the match`
            + (myTeam != null ? (myTeam === m.winner ? ' — VICTORY' : ' — DEFEAT') : '')
            + (m.caps ? `\nCaptures: ${m.caps[0] ?? 0} — ${m.caps[1] ?? 0}` : '');
        } else if (vm === 'br' && m.winner != null) {
          const w = this.lobbyData?.players.find(p => p.pid === m.winner)
            ?? this.snap?.players?.find(p => p.pid === m.winner);
          body = `${w?.name ?? 'Player ' + m.winner} is the last operative standing.`;
        } else {
          body = 'The match is over.';
        }
        showMsg('Match Over', body, 'To Lobby', () => this.renderLobby());
        return;
      }
      if (this.lobbyData) this.lobbyData.roster = m.roster;
      const story = this.story;
      // Optimistic levelIdx bump happens HERE, synchronously at message
      // receipt — never inside the deferred results dialog. A chapter outro
      // can hold results() open across the server's fresh lobby broadcast
      // (which already carries the advanced levelIdx); bumping the captured
      // object then would double-increment. Capture identity and only bump
      // the lobby we hold right now. Bastion rooms rematch in place (the
      // server never advances them), so they are exempt.
      if (m.status === 'cleared' && !m.victory
          && this.lobbyData && this.lobbyData.mode !== 'bastion') {
        this.lobbyData.levelIdx++;
      }
      const results = () => {
        if (m.victory) {
          showMsg(story ? 'The Crossing Holds' : 'Campaign Complete!',
            resultText(m) + `Final roster: ${m.roster.map(id => charMap[id].name).join(', ')}`,
            'OK', () => this.leave());
        } else if (m.status === 'cleared') {
          showMsg(story ? 'Chapter Cleared' : 'Mission Cleared',
            (resultText(m) || 'Nicely done.') + (m.nextTitle ? `\nNext: ${m.nextTitle}` : ''),
            'To Lobby', () => this.renderLobby());
        } else {
          showMsg(story ? 'Chapter Failed' : 'Mission Failed',
            'No one is lost on a failed run — regroup and retry.', 'To Lobby', () => this.renderLobby());
        }
      };
      // story outro plays first (cleared runs only), then the results dialog
      if (m.status === 'cleared' && m.outro?.length) startSlides(this, m.outro, results);
      else results();
      // online stronghold clears feed the LOCAL progression save too (every
      // participant earns the unlock); toasts ride over the results dialog
      if (m.status === 'cleared' && this.lobbyData?.mode === 'bastion') {
        const def = bastionLevels[this.lobbyData.levelIdx ?? 0];
        if (def?.stronghold) for (const t of shRecordClear(def)) showToast(t, 3000, true);
      }
    }
    else if (m.t === 'error') {
      this.close();
      showMsg('Co-op', m.error, 'Main Menu', () => { show('menu'); refreshContinue(); });
    }
  }
  renderLobby() {
    const m = this.lobbyData;
    if (!m) return;
    const allPicked = m.players.every(p => p.charId);
    const story = m.mode === 'story';
    const vm = this.versusMode();
    const ctf = vm === 'ctf';
    const seatNo = new Map([...this.seats.values()].map((pid, i) => [pid, i]));
    renderLobby({
      title: (story && m.levelTitle)
        ? m.levelTitle
        : vm
          ? `Versus ${ctf ? 'CTF' : 'Royale'} — ${m.levelName || ''}`
          : m.mode === 'bastion'
            ? `Stronghold ${String((m.levelIdx ?? 0) + 1).padStart(2, '0')} — ${m.levelName || ''}`
            : `${story ? 'Chapter' : 'Mission'} ${m.levelIdx + 1} / ${m.totalLevels} — ${m.levelName || ''}`,
      info: m.lan
        ? `Room <b>${m.room}</b> — friends: ${m.lan} (or this machine's address)`
        : `Room code: <b>${m.room}</b> — friends join with this code`,
      hint: 'Press FIRE to claim a seat — up to 4 couch players per machine, 8 per room. '
        + 'Move your cursor with LEFT/RIGHT, FIRE to lock in; START on an unpicked extra seat hands it back. '
        + 'The mouse picks for the first seat.'
        + (ctf ? ' Capture the Flag: badge colors are your team — seats alternate.'
          : vm === 'br' ? ' Battle Royale: free-for-all, 2+ players to start.' : ''),
      players: m.players.map(p => ({
        ...p,
        me: p.pid === this.myPid,
        // ctf: team badge color sets (server assigns p.team); seat number text
        // for local seats, team letter for everyone else
        badge: seatNo.has(p.pid)
          ? 'P' + (seatNo.get(p.pid) + 1)
          : (ctf && p.team != null ? (p.team ? 'B' : 'A') : undefined),
        color: ctf && p.team != null
          ? TEAMC[p.team]
          : (seatNo.has(p.pid) ? PCOLORS[seatNo.get(p.pid)] : undefined),
      })),
      roster: m.roster,
      canStart: this.isHost() && allPicked && (!vm || m.players.length >= 2),
      cursors: [...this.seats.entries()].map(([dev, pid], i) => ({
        idx: this.cursors[dev] ?? 0,
        color: PCOLORS[i],
        badge: 'P' + (i + 1),
        picked: !!this.pickOf(pid),
      })),
      onCard: id => this.pickChar(id),
    });
  }
  // mouse click — picks for the primary seat (legacy form, no pid)
  pickChar(id) { this.ws.send(JSON.stringify({ t: 'select', charId: id })); }
  start() { this.ws.send(JSON.stringify({ t: 'start' })); }
  unbindSeat(dev) {
    this.seats.delete(dev);
    delete this.cursors[dev];
    delete this.missingT[dev];
  }
  dropSeat(dev) { // START on an unpicked extra seat / dead pad: hand the pid back
    const pid = this.seats.get(dev);
    if (pid == null) return;
    this.unbindSeat(dev);
    if (pid !== this.myPid) this.ws.send(JSON.stringify({ t: 'removeLocal', pid }));
    this.renderLobby(); // server re-broadcasts, but reflect the unbind now
  }
  claimSeat(dev) {
    if (this.myPid == null) return;
    if (![...this.seats.values()].includes(this.myPid)) {
      // first FIRE binds that device to the primary pid
      this.seats.set(dev, this.myPid);
      this.cursors[dev] = 0;
      this.renderLobby();
      return;
    }
    if (this.seats.size + this.pendingSeats.size >= 4) return;                       // per-connection cap
    if ((this.lobbyData?.players.length ?? 0) + this.pendingSeats.size >= 8) return; // room cap
    if (this.pendingSeats.has(dev)) return; // double FIRE before localAdded returns
    this.pendingSeats.set(dev, performance.now());
    this.ws.send(JSON.stringify({ t: 'addLocal', name: 'P' + (this.seats.size + this.pendingSeats.size), tag: dev }));
  }
  lobbyTick(polled, dt) {
    const m = this.lobbyData;
    if (!m) return;
    // a request the server never answered (room filled meanwhile) must not
    // wedge that device — let it retry after a beat
    for (const [dev, t0] of [...this.pendingSeats]) {
      if (performance.now() - t0 > 2000) this.pendingSeats.delete(dev);
    }
    // a bound gamepad that vanished before picking (battery died) would block
    // Deploy forever — hand its pid back after a grace period
    for (const [dev, pid] of [...this.seats]) {
      if (dev.startsWith('gp') && !polled[dev] && !this.pickOf(pid)) {
        this.missingT[dev] = (this.missingT[dev] || 0) + dt;
        if (this.missingT[dev] > 3) this.dropSeat(dev);
      } else this.missingT[dev] = 0;
    }
    let moved = false;
    for (const [dev, st] of Object.entries(polled)) {
      const pid = this.seats.get(dev);
      if (pid == null) {
        if (st.fireJust) this.claimSeat(dev);
        continue;
      }
      const picked = this.pickOf(pid);
      if (st.startJust) {
        if (pid === this.myPid) {
          // primary START deploys when the button would (host + all picked);
          // the primary seat never removeLocals — it Leaves via the ring
          if (!$('btnStart').disabled) { this.start(); continue; }
        } else if (!picked) { this.dropSeat(dev); continue; }
      }
      const n = m.roster.length;
      if (!picked && n) {
        if (st.leftJust) { this.cursors[dev] = mod((this.cursors[dev] ?? 0) - 1, n); moved = true; }
        if (st.rightJust) { this.cursors[dev] = mod((this.cursors[dev] ?? 0) + 1, n); moved = true; }
        if (st.upJust) { this.cursors[dev] = mod((this.cursors[dev] ?? 0) - 5, n); moved = true; }
        if (st.downJust) { this.cursors[dev] = mod((this.cursors[dev] ?? 0) + 5, n); moved = true; }
      }
      if (st.fireJust) {
        // FIRE locks the cursor pick, or unlocks the current one (server toggles)
        const id = picked ?? m.roster[this.cursors[dev] ?? 0];
        if (id) this.ws.send(JSON.stringify({ t: 'select', charId: id, pid }));
      }
    }
    if (moved) this.renderLobby();
  }
  tick(polled, dt) {
    if (this.cutscene) return slidesTick(this, polled, dt);
    if (!$('msg').hidden) {
      // mission-end dialog: fire/start on any device clicks through
      for (const st of Object.values(polled)) {
        if (st.fireJust || st.startJust) { $('btnMsgOk').click(); break; }
      }
      return;
    }
    if (!$('lobby').hidden) this.lobbyTick(polled, dt);
  }
  close() {
    clearInterval(this.inputTimer);
    this.ws.onclose = null;
    this.ws.close();
    session = null;
  }
  leave() { this.close(); show('menu'); refreshContinue(); }
}

// ---------- stronghold progression (local save) ----------
// 'holdout-hd.stronghold' = { unlocked: highest unlocked 1-based level,
// beaten: [levelNo...], chars: [unlocked charIds] }. Level N+1 unlocks when
// N is beaten; the roster grows by each beaten level's def.stronghold.unlock.
const SH_KEY = 'holdout-hd.stronghold';
// Canonical unlock schedule (contract-fixed). Used as the fallback when a
// level def doesn't carry def.stronghold.unlock yet — defs win when present.
const SH_UNLOCKS = {
  2: 'sniper', 3: 'raider', 4: 'pyro', 5: 'engineer', 6: 'bastion', 8: 'duelist',
  10: 'volt', 12: 'boomer', 14: 'warden', 16: 'shade', 18: 'helix', 20: 'seal', 23: 'atlas',
};
function loadShSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SH_KEY));
    if (s && typeof s === 'object') {
      return {
        unlocked: Math.max(1, Math.floor(s.unlocked) || 1),
        beaten: Array.isArray(s.beaten) ? s.beaten : [],
        chars: Array.isArray(s.chars) ? s.chars : [],
      };
    }
  } catch {}
  return { unlocked: 1, beaten: [], chars: [] };
}
function shUnlockOf(def, n) { return def?.stronghold?.unlock ?? SH_UNLOCKS[n] ?? null; }
// Stronghold lobby roster: 4 starters + every operative the save has earned.
function strongholdRoster() {
  const s = loadShSave();
  return [...startingRoster, ...s.chars.filter(id => charMap[id] && !startingRoster.includes(id))];
}
// Records a cleared level; returns 'UNLOCKED — …' toast lines for the caller.
function shRecordClear(def) {
  const n = def?.stronghold?.level ?? (bastionLevels.indexOf(def) + 1);
  if (!(n >= 1)) return [];
  const s = loadShSave();
  const toasts = [];
  if (!s.beaten.includes(n)) s.beaten.push(n);
  const nextN = Math.min(bastionLevels.length, n + 1);
  if (nextN > s.unlocked) {
    s.unlocked = nextN;
    const nd = bastionLevels[nextN - 1];
    if (nd && nextN !== n) {
      toasts.push(`UNLOCKED — ${String(nd.stronghold?.name ?? nd.name ?? 'STRONGHOLD ' + nextN).toUpperCase()}`);
    }
  }
  const cid = shUnlockOf(def, n);
  if (cid && charMap[cid] && !startingRoster.includes(cid) && !s.chars.includes(cid)) {
    s.chars.push(cid);
    toasts.push(`UNLOCKED — ${charMap[cid].name.toUpperCase()}`);
  }
  try { localStorage.setItem(SH_KEY, JSON.stringify(s)); } catch {}
  return toasts;
}

// ---------- menu pages (MAIN / SINGLEPLAYER / VERSUS / ONLINE / SETTINGS /
// REMAP / STRONGHOLD SELECT) — DOM screens inside #menu, pad-navigable ----
const MENU_PARENT = {
  pageSingle: 'pageMain', pageVersus: 'pageMain', pageOnline: 'pageMain',
  pageSettings: 'pageMain', pageRemap: 'pageSettings', pageSh: 'pageSingle',
};
let menuPageId = 'pageMain';
let shPurpose = 'local'; // why the level select is open: 'local' | 'host'
function showMenuPage(id) {
  menuPageId = id;
  for (const el of document.querySelectorAll('#menu .mpage')) el.hidden = el.id !== id;
  cancelRemapListen();
  setNavFocus(null); // navTick re-picks a default focus on the new page
  if (id === 'pageSh') renderShGrid();
  if (id === 'pageRemap') renderRemap();
}
// pad B / Escape: one page back. Returns false on the main page (no-op).
function menuBack() {
  const parent = MENU_PARENT[menuPageId];
  if (!parent || $('menu').hidden) return false;
  playUi('back');
  showMenuPage(parent);
  return true;
}

// ---------- stronghold level select (25 cards, locked/beaten states) ----------
function renderShGrid() {
  const grid = $('shGrid');
  const s = loadShSave();
  $('shSub').textContent = shPurpose === 'host'
    ? 'pick a stronghold to host online — only your unlocked levels are offered'
    : 'beat a stronghold to unlock the next · new operatives join the roster';
  $('shBlurb').textContent = ' ';
  grid.innerHTML = '';
  bastionLevels.forEach((lvl, idx) => {
    const sh = lvl.stronghold ?? {};
    const n = sh.level ?? idx + 1;
    const locked = n > s.unlocked;
    const beaten = s.beaten.includes(n);
    const diff = Math.max(0, Math.min(5, sh.difficulty ?? 1));
    const cid = shUnlockOf(lvl, n);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'shcard' + (locked ? ' locked' : '') + (beaten ? ' beaten' : '');
    card.innerHTML =
      `<span class="shtop"><b class="shno">${String(n).padStart(2, '0')}</b>`
      + `<span class="shmark">${locked ? '🔒' : beaten ? '✔' : ''}</span></span>`
      + `<span class="shname">${sh.name ?? lvl.name ?? '—'}</span>`
      + `<span class="shmeta">${sh.sizeLabel ?? '?'} · <i class="pips">${'●'.repeat(diff)}${'○'.repeat(5 - diff)}</i> · ${sh.waves ?? '?'} waves</span>`
      + `<span class="shbadges">${(sh.newFeatures ?? []).slice(0, 2).map(f => `<i class="shnew">NEW · ${f}</i>`).join('')}`
      + (cid && charMap[cid] ? `<i class="shchar">+${charMap[cid].name.toUpperCase()}</i>` : '')
      + `</span>`;
    card.dataset.blurb = locked
      ? `Locked — beat stronghold ${String(n - 1).padStart(2, '0')} to open the way.`
      : (sh.blurb ?? lvl.objective ?? '');
    card.onmouseenter = () => { $('shBlurb').textContent = card.dataset.blurb || ' '; };
    card.onclick = e => {
      e.currentTarget.blur();
      if (locked) return playUi('locked');
      startStronghold(idx);
    };
    grid.appendChild(card);
  });
}
function startStronghold(idx) {
  if (session) return;
  playUi('select');
  if (shPurpose === 'host') {
    session = new NetSession('host', '', 'bastion', idx);
  } else {
    session = new LocalSession(null, { mode: 'bastion', levelIdx: idx });
    session.lobby();
  }
}

// ---------- input remapping (Settings > Input remapping) ----------
// Listen-for-next-press rebinding per action, per device (both keyboard seats
// + one shared gamepad layout), saved to localStorage via saveBinds().
const ACTION_LABEL = {
  up: 'MOVE UP', down: 'MOVE DOWN', left: 'MOVE LEFT', right: 'MOVE RIGHT',
  fire: 'FIRE', special: 'SPECIAL', act: 'INTERACT / BUILD', item: 'ITEM',
  start: 'PAUSE / START', map: 'MAP (HOLD)',
};
const KEY_NICE = {
  Space: 'SPACE', Slash: '/', Period: '.', Comma: ',', Escape: 'ESC', Backspace: 'BKSP',
  ShiftRight: 'R-SHIFT', ShiftLeft: 'L-SHIFT', ControlRight: 'R-CTRL', ControlLeft: 'L-CTRL',
  Enter: 'ENTER', Tab: 'TAB',
};
const keyLabel = c => c == null ? '—' : (KEY_NICE[c] ?? String(c).replace(/^Key|^Digit|^Arrow/, '').toUpperCase());
const PADBTN_NICE = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
  8: 'SELECT', 9: 'START', 10: 'L3', 11: 'R3', 12: 'D-UP', 13: 'D-DOWN', 14: 'D-LEFT', 15: 'D-RIGHT',
};
const padLabel = j => j == null ? '—' : (PADBTN_NICE[j] ?? 'BTN ' + j);
function bindLabel(dev, action) {
  const m = dev === 'pad' ? PADMAP : dev === 'kb1' ? KB1 : KB2;
  const list = m[action] ?? [];
  if (!list.length) return '—';
  return list.map(dev === 'pad' ? padLabel : keyLabel).join(' / ');
}
let remapDev = 'kb1';
let remapListen = null; // { dev, action, t0 } while waiting for a press
let remapHeld = null;   // pad buttons already down when listening started
let remapBoundGuard = 0; // frames navTick skips after a pad bind lands (the
                         // landing press must not double as B-back/A-click)
function renderRemap() {
  for (const b of document.querySelectorAll('#remapDevs .rdev')) {
    b.classList.toggle('active', b.dataset.dev === remapDev);
  }
  const host = $('remapList');
  host.innerHTML = '';
  for (const a of ACTIONS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'rrow' + (binds[remapDev]?.[a] != null ? ' custom' : '');
    const listening = remapListen && remapListen.dev === remapDev && remapListen.action === a;
    row.innerHTML = `<span>${ACTION_LABEL[a] ?? a.toUpperCase()}</span><b>${listening ? 'PRESS…' : bindLabel(remapDev, a)}</b>`;
    row.onclick = e => { e.currentTarget.blur(); startRemapListen(remapDev, a); };
    host.appendChild(row);
  }
}
function startRemapListen(dev, action) {
  cancelRemapListen();
  remapListen = { dev, action, t0: performance.now() };
  if (dev === 'pad') {
    remapHeld = new Set();
    for (const gp of navigator.getGamepads?.() ?? []) {
      if (!gp || !gp.connected) continue;
      gp.buttons.forEach((bt, j) => { if (bt?.pressed) remapHeld.add(gp.index + ':' + j); });
    }
  } else {
    addEventListener('keydown', remapKeyCapture, true);
  }
  renderRemap();
}
function remapKeyCapture(e) {
  if (!remapListen || remapListen.dev === 'pad' || e.repeat) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code !== 'Escape') {
    (binds[remapListen.dev] ??= {})[remapListen.action] = e.code;
    saveBinds();
    playUi('bind');
  }
  cancelRemapListen();
  renderRemap();
}
function cancelRemapListen() {
  if (!remapListen) return;
  remapListen = null;
  remapHeld = null;
  removeEventListener('keydown', remapKeyCapture, true);
}
// Polled from the frame loop: binds the first FRESH pad button press.
function remapPadTick() {
  if (!remapListen) return;
  if (performance.now() - remapListen.t0 > 8000) { // listen timed out
    cancelRemapListen();
    renderRemap();
    return;
  }
  if (remapListen.dev !== 'pad') return;
  for (const gp of navigator.getGamepads?.() ?? []) {
    if (!gp || !gp.connected) continue;
    for (let j = 0; j < gp.buttons.length; j++) {
      const k = gp.index + ':' + j;
      if (gp.buttons[j]?.pressed) {
        if (remapHeld.has(k)) continue; // held since before listening
        (binds.pad ??= {})[remapListen.action] = j;
        saveBinds();
        playUi('bind');
        cancelRemapListen();
        remapBoundGuard = 1;
        renderRemap();
        return;
      }
      remapHeld.delete(k); // released — a re-press now counts
    }
  }
}

// ---------- menu wiring ----------
function refreshContinue() {
  $('btnContinue').hidden = !localStorage.getItem(SAVE_KEY);
  $('btnStory').hidden = !storyLevels.length;
  $('btnStoryContinue').hidden = !storyLevels.length || !localStorage.getItem(STORY_KEY);
  $('btnHostStory').hidden = !storyLevels.length;
  // versus/stronghold buttons only exist once their mode maps ship
  $('btnBastion').hidden = !bastionLevels.length;
  $('btnHostBastion').hidden = !bastionLevels.length;
  $('btnCtf').hidden = !ctfLevels.length;
  $('btnHostCtf').hidden = !ctfLevels.length;
  $('btnBr').hidden = !brLevels.length;
  $('btnHostBr').hidden = !brLevels.length;
  // back on the menu with the level select up: re-read unlock/beaten states
  if (menuPageId === 'pageSh' && !$('menu').hidden) renderShGrid();
}
refreshContinue();

// page navigation buttons + every Back control (mouse path; pad B mirrors it)
$('btnSingle').onclick = e => { e.currentTarget.blur(); showMenuPage('pageSingle'); };
$('btnVersus').onclick = e => { e.currentTarget.blur(); showMenuPage('pageVersus'); };
$('btnOnline').onclick = e => { e.currentTarget.blur(); showMenuPage('pageOnline'); };
$('btnSettings').onclick = e => { e.currentTarget.blur(); showMenuPage('pageSettings'); };
$('btnRemap').onclick = e => { e.currentTarget.blur(); showMenuPage('pageRemap'); };
for (const b of document.querySelectorAll('#menu .mback')) {
  b.onclick = e => {
    e.currentTarget.blur();
    showMenuPage(b.dataset.back || MENU_PARENT[menuPageId] || 'pageMain');
  };
}
for (const b of document.querySelectorAll('#remapDevs .rdev')) {
  b.onclick = e => {
    e.currentTarget.blur();
    cancelRemapListen();
    remapDev = b.dataset.dev;
    renderRemap();
  };
}
$('btnRemapReset').onclick = e => {
  e.currentTarget.blur();
  cancelRemapListen();
  delete binds[remapDev];
  saveBinds();
  renderRemap();
  showToast('BINDINGS RESET — ' + (remapDev === 'pad' ? 'GAMEPAD' : DEVICE_LABEL[remapDev]).toUpperCase(), 2200, true);
};
const ctrlHudSync = () => { $('btnCtrlHud').textContent = `Controls overlay: ${ctrlHudOn ? 'On' : 'Off'}`; };
$('btnCtrlHud').onclick = e => {
  e.currentTarget.blur();
  ctrlHudOn = !ctrlHudOn;
  try { localStorage.setItem('holdout-hd.ctrlhud', ctrlHudOn ? '1' : '0'); } catch {}
  ctrlHudSync();
};
ctrlHudSync();
$('nameInput').value = localStorage.getItem('holdout.name') || '';
$('nameInput').onchange = () => localStorage.setItem('holdout.name', $('nameInput').value);

$('btnSolo').onclick = e => {
  e.currentTarget.blur();
  localStorage.removeItem(SAVE_KEY);
  session = new LocalSession();
  session.lobby();
};
$('btnContinue').onclick = e => {
  e.currentTarget.blur();
  let save = null;
  try { save = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
  session = new LocalSession(save);
  session.lobby();
};
$('btnStory').onclick = e => {
  e.currentTarget.blur();
  if (!storyLevels.length || session) return;
  localStorage.removeItem(STORY_KEY); // fresh start, like btnSolo for classic
  clearBeacon(); // an abandoned run's checkpoint dies with it
  session = new LocalSession(null, { story: true });
  session.lobby();
};
$('btnStoryContinue').onclick = e => {
  e.currentTarget.blur();
  if (!storyLevels.length || session) return;
  let save = null;
  try { save = JSON.parse(localStorage.getItem(STORY_KEY)); } catch {}
  session = new LocalSession(save, { story: true });
  session.lobby();
};
$('btnBastion').onclick = e => {
  e.currentTarget.blur();
  if (!bastionLevels.length || session) return;
  shPurpose = 'local';
  showMenuPage('pageSh');
};
$('btnCtf').onclick = e => {
  e.currentTarget.blur();
  if (!ctfLevels.length || session) return;
  session = new LocalSession(null, { mode: 'ctf' });
  session.lobby();
};
$('btnBr').onclick = e => {
  e.currentTarget.blur();
  if (!brLevels.length || session) return;
  session = new LocalSession(null, { mode: 'br' });
  session.lobby();
};
$('btnHost').onclick = e => {
  e.currentTarget.blur();
  if (session) return;
  session = new NetSession('host', $('joinCode').value.trim().toUpperCase());
};
$('btnHostBastion').onclick = e => {
  e.currentTarget.blur();
  if (!bastionLevels.length || session) return;
  // the host picks a level FIRST (level select), then the room is created
  // with {t:'host', mode:'bastion', levelIdx} — see startStronghold()
  shPurpose = 'host';
  showMenuPage('pageSh');
};
$('btnHostCtf').onclick = e => {
  e.currentTarget.blur();
  if (!ctfLevels.length || session) return;
  session = new NetSession('host', $('joinCode').value.trim().toUpperCase(), 'ctf');
};
$('btnHostBr').onclick = e => {
  e.currentTarget.blur();
  if (!brLevels.length || session) return;
  session = new NetSession('host', $('joinCode').value.trim().toUpperCase(), 'br');
};
$('btnHostStory').onclick = e => {
  e.currentTarget.blur();
  if (session) return;
  // a resumed save's stored mode wins over this button (server rule)
  session = new NetSession('host', $('joinCode').value.trim().toUpperCase(), 'story');
};
$('btnJoin').onclick = e => {
  e.currentTarget.blur();
  if (session) return;
  const code = $('joinCode').value.trim().toUpperCase();
  if (code.length !== 4) return showMsg('Co-op', 'Enter the 4-letter room code first.', 'OK', () => show('menu'));
  session = new NetSession('join', code);
};
$('btnStart').onclick = e => { e.currentTarget.blur(); session?.start(); };
$('btnLeave').onclick = () => session?.leave();

// ---------- demo / attract mode ----------
if (demoMode) {
  // ?demo runs the story campaign with bots; &ch=N (1-based) picks the chapter.
  // Cutscenes are skipped in demo (see startCutscene) so &warp works instantly.
  if (storyLevels.length) {
    const ch = Math.max(1, Math.min(storyLevels.length, +(new URLSearchParams(location.search).get('ch') || 1) || 1));
    session = new LocalSession({ chapter: ch }, { story: true });
  } else {
    session = new LocalSession(null, { expedition: expeditions.length > 0 });
  }
  session.roster.slice(0, 4).forEach((charId, i) => {
    session.players.push({ pid: i, name: 'BOT' + (i + 1), device: 'bot' + i, charId, cursor: 0, missingT: 0 });
  });
  session.inLobby = true;
  session.start();
  // dev: ?demo=1&warp=54,32 drops the squad at a tile for screenshots/testing
  const warp = new URLSearchParams(location.search).get('warp');
  if (warp && session.game) {
    const [wx, wy] = warp.split(',').map(Number);
    if (Number.isFinite(wx) && Number.isFinite(wy)) {
      const grid = session.game.grid;
      const open = (x, y) => grid[y]?.[x] && !'#T~o'.includes(grid[y][x]);
      // ring-scan to the nearest passable tile so a warp can't trap the squad
      let tx = wx, ty = wy;
      outer: for (let r = 0; r < 8; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (open(wx + dx, wy + dy)) { tx = wx + dx; ty = wy + dy; break outer; }
          }
        }
      }
      session.game.players.forEach((p, i) => {
        p.x = (tx + 0.5) * TILE + (i % 2) * 20;
        p.y = (ty + 0.5) * TILE + (i >> 1) * 20;
      });
    }
  }
}

// ---------- fill the screen: responsive canvas (no letterboxing) ----------
// The stage spans the whole window (CSS); the side panels keep their fixed
// width and full height, and the CANVAS's logical resolution adapts to the
// remaining center area — devicePixelRatio-aware, clamped to sane bounds
// (~960x540 .. 2560x1440). The camera and all HUD/screen-space drawing read
// the canvas dims dynamically, so on ultra-wide the field simply shows more
// world (the cam clamps handle it). No distortion: one uniform scale factor.
const stageEl = document.getElementById('stage');
function fitStage() {
  stageEl.style.transform = 'none'; // the old uniform-scale path is retired
  const r = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(r.width));
  const cssH = Math.max(1, Math.round(r.height));
  if (cssW < 8 || cssH < 8) return; // layout not ready yet
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  // uniform resolution scale: respect dpr, cap at 2560x1440, floor at 960x540
  let s = Math.min(dpr, 2560 / cssW, 1440 / cssH);
  s = Math.max(s, 960 / cssW, 540 / cssH);
  const w = Math.round(cssW * s), h = Math.round(cssH * s);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}
addEventListener('resize', fitStage);
fitStage();

$('btnFullscreen').onclick = e => {
  e.currentTarget.blur();
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {});
};
document.addEventListener('fullscreenchange', () => { fitStage(); });

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const polled = pollDevices();
  remapPadTick();  // a pad rebind capture polls raw buttons each frame
  navTick(polled); // first: consumes the button edges it handles
  if (session) {
    session.tick?.(polled, dt);
    const cs = session.cutscene;
    if (cs) {
      renderMod.drawCutscene?.(ctx, cs.slides[cs.idx], now / 1000, cs.t);
      if (cs.waiting && cs.holdHint) {
        // online intro: our slides are done, the host hasn't moved on yet
        ctx.save();
        ctx.font = 'bold 15px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = `rgba(200,212,230,${(0.45 + 0.25 * Math.sin(now / 320)).toFixed(3)})`;
        ctx.fillText(cs.holdHint, Math.round(canvas.width * 0.045),
          canvas.height - Math.round(canvas.height * 0.04) - Math.round(canvas.height * 0.028));
        ctx.restore();
      }
    } else {
      const snap = session.snap;
      if (snap) {
        render(ctx, snap, charMap, session.focusPids(), now / 1000, dt);
        updateHUD(snap);
        // hold-MAP full-map overlay (pad SELECT / Tab / M) — play only;
        // lobbies, menus and dialogs ignore the map button entirely
        if (snap.status === 'play' && !visibleScreen()
            && Object.values(polled).some(st => st.map)) {
          drawMapOverlay(ctx, snap, now / 1000);
        }
      }
    }
  } else {
    // cheap animated backdrop behind the DOM menu (optional renderer feature)
    renderMod.drawMenuBackdrop?.(ctx, now / 1000);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
