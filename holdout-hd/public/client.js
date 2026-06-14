import { TILE, createGame, step, snapshot, applyResults, charsById, dailyChallenge } from '/shared/game.js';
// Namespace import so optional sim features (serializeGame/restoreGame for save
// beacons) can ship independently — accessed via gameMod.* with runtime checks.
import * as gameMod from '/shared/game.js';
import { render, renderMinimap, addEventFX, initTextures, drawPortrait, drawWeaponIcon } from './render.js';
// Namespace import so optional renderer features (cutscenes, menu backdrop) can
// ship independently — accessed via renderMod.* with runtime existence checks.
import * as renderMod from './render.js';
import { playEvent, playUi, setupAudioToggle, setMusicVolume, setVoiceVolume, setSfxVolume } from './audio.js';

const characters = await (await fetch('/shared/characters.json')).json();
const charMap = charsById(characters);
// build-static.js rewrites the quoted /api/levels literal below to a relative
// ./levels.json — that rewrite doubles as the static-build marker: no server
// means no online play and no shared rankings (personal bests live in
// localStorage instead; see the rankings section).
const LEVELS_URL = '/api/levels';
const IS_STATIC = !LEVELS_URL.startsWith('/api');
const levels = await (await fetch(LEVELS_URL)).json();
// Levels are organized by category subdirectory (classic/story/stronghold/
// ctf/br) and each def carries its subdir as def.category. Mode lists derive
// from the category; the old per-def flags stay as fallbacks so a stale
// flat build (no category field) keeps working.
const campaign = levels.filter(l => l.category ? l.category === 'classic' : !l.expedition);
const expeditions = levels.filter(l => !l.category && l.expedition && !l.mode && !l.story);
const ctfLevels = levels.filter(l => l.category === 'ctf' || (!l.category && l.mode === 'ctf'));
const brLevels = levels.filter(l => l.category === 'br' || (!l.category && l.mode === 'br'));
const siegeLevels = levels.filter(l => l.category === 'siege' || (!l.category && l.mode === 'siege'));
const familyLevels = levels.filter(l => l.category === 'family' || (!l.category && l.family));
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
// Declared early: fitStage() (used by the aspect/overscan settings applied at
// init, well above) references stageEl — a late `const` here is a temporal
// dead-zone crash that kills the whole frame loop before it starts.
const stageEl = $('stage');
const ctx = canvas.getContext('2d');
const mmCtx = $('minimap').getContext('2d');
const SAVE_KEY = 'holdout-hd.save';
const STORY_KEY = 'holdout-hd.story'; // { chapter: next 1-based chapter, roster }
const BEACON_KEY = 'holdout-hd.beacon'; // { chapter: 1-based, data: serializeGame(g) } — local story only
const SUSPEND_KEY = 'holdout-hd.suspend'; // Save & Quit bookmark — see loadSuspend()
const PCOLORS = ['#4fc3f7', '#ffb74d', '#f06292', '#aed581'];
// CTF team identity (badge color sets) + display names.
const TEAMC = ['#5ea7ff', '#ff7a6a'];
const TEAM_NAME = ['TEAM A', 'TEAM B'];
// Per-mode room caps (client mirror of the server's MODE_CAPS — addLocal
// gating + lobby copy; the server clamps authoritatively).
const MODE_CAPS = { classic: 8, story: 8, bastion: 8, ctf: 32, br: 16 };
const roomCapOf = mode => MODE_CAPS[mode] ?? 8;
// Host visibility preference, persisted PER MODE GROUP: versus rooms (ctf/br)
// default Public, co-op rooms (classic/story/bastion) default Private. The
// host message always carries the explicit public flag (additive — an older
// server simply ignores it).
const VIS_KEY = 'holdout-hd.visibility'; // { coop: 'public'|'private', versus: ... }
const VIS_GROUP = mode => (mode === 'ctf' || mode === 'br') ? 'versus' : 'coop';
let visPrefs = {};
try { visPrefs = JSON.parse(localStorage.getItem(VIS_KEY)) || {}; } catch {}
function visOf(group) {
  const v = visPrefs?.[group];
  return v === 'public' || v === 'private' ? v : (group === 'versus' ? 'public' : 'private');
}
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

// ---------- suspended-game bookmark (Save & Quit -> main-menu Resume Game) ----------
// One slot: { mode: 'classic'|'story'|'bastion', levelIdx, story, name, at,
// data: serializeGame(g), seats: [{pid, device}] }. Written ONLY by Save &
// Quit; cleared ONLY by a resume (successful or corrupt) — starting any new
// game never touches it. seats is additive metadata: it hands each player
// back the physical device they were holding when the run was suspended.
function loadSuspend() {
  try {
    const s = JSON.parse(localStorage.getItem(SUSPEND_KEY));
    return s && s.data && typeof s.levelIdx === 'number'
      && ['classic', 'story', 'bastion'].includes(s.mode) ? s : null;
  } catch { return null; }
}
function clearSuspend() { localStorage.removeItem(SUSPEND_KEY); }

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
  // an override of explicit null means "unbound" (a default that lost its key
  // to a remap conflict); a missing key falls back to the device defaults
  const eff = (def, o) => Object.fromEntries(ACTIONS.map(a =>
    [a, o && a in o ? (o[a] != null ? [o[a]] : []) : (def[a] ?? [])]));
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

// ---------- controller type detection (adaptive prompt glyphs) ----------
// The in-world prompts ('[hold E/X] BUILD ...') show a glyph that matches the
// ACTIVE controller. The NATIVE (Electron) lane exposes typed pads via
// window.anchorfallDesktop.controllers() -> [{ index, type, name, id }] where
// type is keyboard|xbox|ps4|ps5|switch|generic; in the browser we fall back to
// inferring the type from navigator.getGamepads()[].id strings. The render
// glyph itself comes from render.js's glyphForType; here we only resolve TYPE
// and track which device the player is actually using.

// Infer a pad type from its W3C id string (browser fallback). Pure.
function inferPadType(id) {
  const s = String(id || '').toLowerCase();
  // PlayStation: DualSense (ps5) vs DualShock (ps4) where distinguishable
  if (/dualsense|ps5|playstation 5|sony.*0ce6|0ce6/.test(s)) return 'ps5';
  if (/dualshock|ps4|playstation 4|playstation\(r\)4|sony.*09cc|09cc|05c4/.test(s)) return 'ps4';
  if (/playstation|sony|wireless controller.*054c|054c/.test(s)) return 'ps4';
  // Nintendo Switch / Pro Controller / Joy-Con
  if (/switch|joy-?con|pro controller|nintendo|057e/.test(s)) return 'switch';
  // Xbox / XInput (real Xbox pads report "xbox" in the name, so they match here
  // before the generic "wireless controller" fallback below)
  if (/xbox|xinput|x-?box|microsoft|045e/.test(s)) return 'xbox';
  // a bare "wireless controller" (no vendor) is almost always a Sony pad
  if (/wireless controller/.test(s)) return 'ps4';
  return 'generic';
  // NOTE: on some Linux/Batocera setups a PlayStation pad is wrapped as an
  // XInput device with no Sony markers and reads as Xbox — set Settings ->
  // "Button prompts: PlayStation" to override the glyphs in that case.
}

// The native bridge's typed controller list, or a browser-inferred equivalent.
// Shape: [{ index, type, name, id }]. Keyboards aren't in getGamepads(), so the
// browser fallback synthesizes a keyboard entry for the per-player readout.
function controllerList() {
  const native = window.anchorfallDesktop?.controllers;
  if (typeof native === 'function') {
    try {
      const list = native();
      if (Array.isArray(list)) return list;
    } catch {}
  }
  const out = [];
  for (const gp of navigator.getGamepads?.() ?? []) {
    if (!gp || !gp.connected) continue;
    out.push({ index: gp.index, type: inferPadType(gp.id), name: gp.id, id: gp.id });
  }
  return out;
}

// Type for a specific pad index (native list first, else inference).
function padTypeForIndex(i) {
  for (const c of controllerList()) if (c.index === i) return c.type || 'generic';
  const gp = navigator.getGamepads?.()[i];
  return gp ? inferPadType(gp.id) : 'generic';
}

// Map a DEVICES id (kb1/kb2/gp0..gp3) to a controller type for prompts.
function deviceType(id) {
  if (id === 'kb1' || id === 'kb2') return 'keyboard';
  if (id.startsWith('gp')) return padTypeForIndex(+id.slice(2));
  return 'keyboard';
}

// A friendly per-player label for the Settings readout ('Xbox Wireless',
// 'Keyboard'). Pads prefer the native/inferred name; keyboards read 'Keyboard'.
function deviceReadout(id) {
  if (id === 'kb1') return 'Keyboard (WASD)';
  if (id === 'kb2') return 'Keyboard (Arrows)';
  const i = +id.slice(2);
  for (const c of controllerList()) if (c.index === i) return c.name || c.id || `Pad ${i + 1}`;
  const gp = navigator.getGamepads?.()[i];
  return gp ? (gp.id || `Pad ${i + 1}`) : 'Not connected';
}

// The most-recently-active device id (any input edge marks it). Drives the
// prompt glyph in Auto mode. Seeded to kb1 so the very first prompt has a type.
let activeDevId = 'kb1';
function noteActiveDevice(polled) {
  for (const [id, st] of Object.entries(polled)) {
    if (st.fire || st.special || st.act || st.item || st.start
      || st.up || st.down || st.left || st.right) { activeDevId = id; return; }
  }
}

// Manual glyph-style override, persisted. 'auto' tracks the active device; the
// rest force a fixed glyph regardless of what's plugged in.
const GLYPH_KEY = 'holdout-hd.glyphstyle';
const GLYPH_MODES = ['auto', 'keyboard', 'xbox', 'playstation', 'switch'];
const GLYPH_LABEL = { auto: 'Auto', keyboard: 'Keyboard', xbox: 'Xbox', playstation: 'PlayStation', switch: 'Switch' };
const GLYPH_OVERRIDE_TYPE = { keyboard: 'keyboard', xbox: 'xbox', playstation: 'ps5', switch: 'switch' };
let glyphStyle = localStorage.getItem(GLYPH_KEY) || 'auto';
if (!GLYPH_MODES.includes(glyphStyle)) glyphStyle = 'auto';

// The keyboard ACT key label the prompts should show (remap-aware). KB1 is the
// primary keyboard seat; the [E/X] prompts are authored against it.
function actKeyLabel() {
  return keyLabel((KB1.act ?? [])[0]) || 'E';
}

// Resolve the active controller type honoring the override, then push it (with
// the live keyboard ACT key) into the renderer's prompt-glyph context. Called
// each frame after noteActiveDevice — cheap, and render.js dedupes nothing so
// we guard with a signature to avoid needless work.
let glyphSig = null;
function applyPromptGlyph() {
  const type = glyphStyle === 'auto'
    ? deviceType(activeDevId)
    : GLYPH_OVERRIDE_TYPE[glyphStyle];
  const kb = actKeyLabel();
  const sig = type + '|' + kb;
  if (sig === glyphSig) return;
  glyphSig = sig;
  renderMod.setPromptGlyphContext?.(type, kb);
}

// Online play: one player per machine, so any device drives them. `exclude`
// drops devices the leave dialog has captured for menu navigation.
function mergedInput(exclude) {
  const o = { up: false, down: false, left: false, right: false, fire: false, special: false, act: false, item: false };
  for (const id of DEVICES) {
    if (exclude?.has(id)) continue;
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
// Anchor Siege match-start objective brief (non-blocking, ~5s).
function showSiegeIntro() {
  showBanner('DESTROY THE ENEMY ANCHOR', false, 5200);
  showToast('Push a lane → break their towers → shatter their Anchor.  BLUE = your team · RED = enemy', 5200, true);
}
function hideBanner() {
  clearTimeout(bannerTimer);
  $('banner').hidden = true;
  $('spectateTag').hidden = true;
  $('countdown').hidden = true;
  $('otChip').hidden = true;
  $('ctrlOverlay').hidden = true;
  cdSig = null;
  otSig = null;
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
      const teamWin = session?.versusMode?.() === 'ctf' || session?.mode === 'siege';
      return { text: `${teamWin ? (TEAM_NAME[ev.winner] ?? 'TEAM') : playerName(ev.winner)} WINS THE MATCH` };
    }
    // Anchor Siege banners
    case 'siegeWave': return null; // too frequent for a banner; FX/audio only
    case 'towerDown': return { text: `${TEAM_NAME[ev.team] ?? 'A'} TOWER DOWN` };
    case 'coreDown': return { text: `${TEAM_NAME[ev.team] ?? 'A'} ANCHOR SHATTERED`, blood: true };
    // stronghold beacon-defense variant + early-extraction ship (all optional)
    case 'beaconDown': return { text: 'A BEACON GOES DARK', blood: true };
    case 'beaconLit': return { text: 'BEACON RELIT' };
    case 'shipDown': return { text: 'THE ANCHORCRAFT HAS LANDED — ALL ABOARD TO EXTRACT' };
    case 'shipLaunch': return { text: 'ANCHORCRAFT AWAY — FULL CLEAR' };
    // bastion day events: the horn call and the supply drop
    case 'horn': return { text: `THE HORN SOUNDS — NIGHT ${ev.nightNo ?? '?'} COMES EARLY` };
    case 'supplyDrop': return { text: 'SUPPLY DROP INBOUND' };
  }
  return null;
}
const EDGE_NAME = { n: 'NORTH', e: 'EAST', s: 'SOUTH', w: 'WEST' };
// One funnel for sim events: FX + audio + banners + the DOM dialogue box.
function handleEvent(ev) {
  // tag a hit with whether it landed on one of THIS connection's seats, so the
  // renderer only shakes/flashes the screen when it's your own operator hit.
  if (ev.type === 'playerHit') ev.mine = (session?.focusPids?.() ?? new Set()).has(ev.pid);
  if (tut) tutorialEvent(ev); // advance the coach on kills / rescues
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
  // bastion day events: the horn banks its shard bonus; probes get a quiet
  // heads-up; supply drops ping the tactical map until the cache is opened
  if (ev.type === 'horn') showToast(`HORN BONUS +${ev.bonus ?? 0}◆`);
  if (ev.type === 'probe') showToast(`SCAVENGERS OFF THE ${EDGE_NAME[ev.edge] ?? '?'} EDGE`, 2600);
  if (ev.type === 'supplyDrop') supplyPings.push({ x: ev.x, y: ev.y });
  const b = bannerFor(ev);
  if (b) showBanner(b.text, b.blood);
}
// supply-drop map pings: live while the dropped cache still sits unopened
const supplyPings = [];

// ---------- screens ----------
function show(id) {
  hideDialogue();
  hideBanner();
  hideToast();
  closePauseUi(); // any full-screen change tears the pause/leave dialog down
  for (const s of ['menu', 'lobby', 'msg']) $(s).hidden = s !== id;
  // fade the revealed screen in (the active menu page re-triggers its own
  // staggered entrance via showMenuPage)
  const sc = $(id);
  if (sc && !sc.hidden) { sc.classList.remove('anim-in'); void sc.offsetWidth; sc.classList.add('anim-in'); }
  // back on the menu with the room browser still the current page: resume its
  // 5s auto-refresh (it reaps itself whenever the page is not actually open)
  if (id === 'menu' && menuPageId === 'pageBrowse') startBrowse();
}
function hideAll() {
  closePauseUi();
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
  for (const s of ['pause', 'msg', 'lobby', 'menu']) if (!$(s).hidden) return s;
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
  if (screen === 'pause') return; // pauseUiTick owns the pause/leave dialog
  const btns = navButtons(screen);
  if (!btns.length) { setNavFocus(null); return; }
  if (navEl && !btns.includes(navEl)) setNavFocus(null); // focused button hid or disabled
  // Menu and dialogs get a default focus so a lone gamepad can always just
  // press FIRE; the lobby starts unfocused because FIRE there means "join".
  // Continue buttons take priority so a blind first press resumes a campaign
  // instead of wiping it with a fresh start.
  if (!navEl && screen !== 'lobby') {
    setNavFocus(
      btns.find(b => b.id === 'btnResumeGame' || b.id === 'btnStoryContinue' || b.id === 'btnContinue')
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
    // volume rows (Settings): LEFT/RIGHT nudges the focused row by 10%
    if (screen === 'menu' && navEl?.dataset?.vol && (st.leftJust || st.rightJust)) {
      const d = st.rightJust ? 10 : -10;
      st.leftJust = st.rightJust = false;
      adjustVolume(navEl.dataset.vol, d);
      navDev = dev;
    }
    // cycle settings (display mode / aspect / overscan): LEFT/RIGHT steps them
    if (screen === 'menu' && navEl?.dataset?.cycle && (st.leftJust || st.rightJust)) {
      const d = st.rightJust ? 1 : -1;
      st.leftJust = st.rightJust = false;
      ({ display: cycleDisplayMode, aspect: cycleAspect, overscan: cycleOverscan }[navEl.dataset.cycle])?.(d);
      navDev = dev;
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

// ---------- pause / leave dialog (Esc-Start during play) ----------
// A dedicated overlay, NOT showMsg: on this screen START/B must always mean
// "back to the game" (never "click whatever happens to be focused"), and an
// online leave dialog must capture only the devices actually navigating it so
// the other couch seats on this connection keep playing. UP/DOWN (or
// LEFT/RIGHT) move the focus ring, FIRE activates, START/B backs out; the
// mouse clicks buttons directly as everywhere else.
let pauseUi = null; // { onBack, onClose, devs } — devs null = every device navs (local pause)
function openPauseUi({ title, body, hint, items, onBack, onClose, devs = null }) {
  closePauseUi();
  $('pauseTitle').textContent = title;
  $('pauseBody').textContent = body;
  $('pauseHint').textContent = hint || '';
  const host = $('pauseBtns');
  host.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    if (it.ghost) b.className = 'ghost';
    b.textContent = it.label;
    b.onclick = e => { e.currentTarget.blur(); it.onPick(); };
    host.appendChild(b);
  }
  pauseUi = { onBack, onClose, devs };
  $('pause').hidden = false;
  setNavFocus(host.querySelector('button'));
}
// Closes from ANY exit (a pick, START/B, or another screen taking over via
// show()/hideAll()) — onClose is the owner's cleanup (unpause / release the
// captured devices), so a force-close can never wedge a session.
function closePauseUi() {
  if (!pauseUi) return;
  const ui = pauseUi;
  pauseUi = null;
  $('pause').hidden = true;
  ui.onClose?.();
}
// Runs each frame between navTick and session.tick; consumes (zeroes) every
// edge it handles so the session never double-acts on the same press.
function pauseUiTick(polled) {
  if (!pauseUi) return;
  const btns = [...$('pauseBtns').querySelectorAll('button')]
    .filter(b => !b.disabled && b.offsetParent !== null);
  if (!btns.length) return;
  if (!navEl || !btns.includes(navEl)) setNavFocus(btns[0]);
  for (const [dev, st] of Object.entries(polled)) {
    if (pauseUi.devs && !pauseUi.devs.has(dev)) {
      // online: this device's seat keeps playing — its own START press pulls
      // it into the open dialog instead of stacking a second one
      if (st.startJust) { st.startJust = false; pauseUi.devs.add(dev); }
      continue;
    }
    if (st.startJust || st.specialJust) { // Esc/Start again, or pad B: back out
      st.startJust = st.specialJust = false;
      pauseUi.onBack();
      return;
    }
    if (st.upJust || st.downJust || st.leftJust || st.rightJust) {
      const d = st.downJust || st.rightJust ? 1 : -1;
      const idx = btns.indexOf(navEl);
      st.upJust = st.downJust = st.leftJust = st.rightJust = false;
      setNavFocus(btns[mod(idx + d, btns.length)]);
    }
    if (st.fireJust) {
      st.fireJust = false;
      (btns.includes(navEl) ? navEl : btns[0]).click();
      return; // the dialog likely changed — re-evaluate next frame
    }
  }
}

function renderLobby({ title, info, hint, players, roster, canStart, cursors = [], onCard, onStep, teamCols = false, allowDupes = false }) {
  $('lobbyTitle').textContent = title;
  $('roomInfo').innerHTML = info;
  $('lobbyHint').textContent = hint || '';
  const pl = $('playerList');
  pl.innerHTML = '';
  pl.classList.toggle('teamcols', !!teamCols);
  const makeChip = p => {
    const chip = document.createElement('span');
    chip.className = 'pchip';
    const col = p.charId ? charMap[p.charId].color : (p.color || '#555');
    chip.innerHTML = `<span class="dot" style="background:${col}"></span>${p.badge ? p.badge + ' · ' : ''}${p.name}${p.isHost ? ' ★' : ''}${p.charId ? ' — ' + charMap[p.charId].name : ''}`;
    return chip;
  };
  if (teamCols) {
    // ctf at 32: two team columns of chips (wraps within each column). Chips
    // are inert spans — pad nav only ever walks buttons, so nav is untouched.
    for (const t of [0, 1]) {
      const colEl = document.createElement('div');
      colEl.className = 'tcol';
      const members = players.filter(p => (p.team ?? 0) === t);
      const head = document.createElement('div');
      head.className = 'thead';
      head.style.color = TEAMC[t];
      head.textContent = `${TEAM_NAME[t]} — ${members.length}`;
      colEl.appendChild(head);
      for (const p of members) colEl.appendChild(makeChip(p));
      pl.appendChild(colEl);
    }
  } else {
    for (const p of players) pl.appendChild(makeChip(p));
  }
  // ---- character carousel: one focused operative, browse ◀/▶, live preview ----
  const grid = $('charGrid');
  grid.innerHTML = '';
  const takenBy = {};
  for (const p of players) if (p.charId) (takenBy[p.charId] ??= []).push(p);
  const myCur = cursors.find(c => c.me) || cursors[0];
  const n = roster.length || 1;
  const fidx = (((myCur ? myCur.idx : 0) % n) + n) % n;
  const fid = roster[fidx];
  const ch = charMap[fid];
  window.__carouselId = fid; // frame() animates the ability preview off this
  if (ch) {
    const card = document.createElement('div');
    card.className = 'bigcard';
    const owners = takenBy[fid] || [];
    const owner = owners.find(o => o.me) || owners.find(o => o.badge) || owners[0];
    let blocked = false;
    if (owner) {
      if (owner.me) card.classList.add('selected');
      else if (owner.badge || allowDupes) { card.classList.add('claimed'); card.style.borderColor = owner.color || '#3fd9c0'; }
      else { card.classList.add('taken'); blocked = true; }
    }
    const idxTag = document.createElement('div');
    idxTag.className = 'cidx';
    idxTag.textContent = `${fidx + 1} / ${n}`;
    card.appendChild(idxTag);
    if (owners.length) {
      const ow = document.createElement('div');
      ow.className = 'powner';
      owners.slice(0, 4).forEach(o => {
        const b = document.createElement('div');
        b.className = 'pbadge';
        b.textContent = o.badge || '✓';
        b.style.background = o.color || ch.color;
        ow.appendChild(b);
      });
      card.appendChild(ow);
    }
    const pc = document.createElement('canvas');
    drawPortrait(pc, ch, 104);
    card.appendChild(pc);
    const nm = document.createElement('div');
    nm.className = 'cname';
    nm.style.color = ch.color;
    nm.textContent = ch.name.toUpperCase();
    card.appendChild(nm);
    const role = document.createElement('div');
    role.className = 'crole';
    role.textContent = ch.weapon.name;
    card.appendChild(role);
    const stats = document.createElement('div');
    stats.className = 'cstats';
    stats.innerHTML = `SPD <b>${ch.speed}</b> · DMG <b>${ch.weapon.damage}</b> · RNG <b>${ch.weapon.range}</b>`;
    card.appendChild(stats);
    if (!blocked && onCard) card.onclick = () => onCard(fid);
    grid.appendChild(card);
    // behavior tags beside the live preview (the preview itself draws in frame())
    const cap = $('abilityCaption');
    if (cap) {
      const tags = renderMod.weaponTags?.(ch.weapon) || [];
      cap.innerHTML = `<span class="wname">${ch.weapon.name}</span>` + tags.map(t => `<span class="wtag">${t}</span>`).join('');
    }
  }
  // roster dots: focused operative + any picked ones
  const dots = $('carDots');
  if (dots) {
    dots.innerHTML = '';
    roster.forEach((id, i) => {
      const d = document.createElement('div');
      d.className = 'cdot' + (i === fidx ? ' here' : '');
      if (takenBy[id]) { d.classList.add('picked'); d.style.background = charMap[id].color; }
      dots.appendChild(d);
    });
  }
  // ◀ / ▶ buttons (mouse) step the primary seat's cursor through the session
  const pv = $('carPrev'), nx = $('carNext');
  if (pv) pv.onclick = () => onStep?.(-1);
  if (nx) nx.onclick = () => onStep?.(1);
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
    // Endless drops the "/N" cap and flies an ∞ — the run has no final night.
    const nightCount = cyc.endless ? ' ∞' : (cyc.nights ? '/' + cyc.nights : '');
    $('cyclePhase').textContent = night
      ? `${cyc.bloodMoon ? 'BLOOD MOON' : 'NIGHT'} ${cyc.nightNo ?? 1}${nightCount} — ${clock}`
      : `DAY${cyc.endless ? ' ∞' : ''} — DUSK IN ${clock}`;
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
  // Family Mode shows the shared lives heart instead of a score
  $('hScore').textContent = snap.family ? `\u{1F49A} ${snap.familyLives ?? 0}` : (snap.score ?? 0).toLocaleString();
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
  // AOI tolerance: online snapshots may filter far-away enemies to the area
  // around this connection's seats — never assume the full list rides every
  // tick. The compact mini array (global, tile-rounded, every 3rd tick — the
  // net session keeps the latest attached) carries the true hostile count.
  const enemies = snap.enemies ?? [];
  const sleeping = enemies.filter(e => e.awake === false).length;
  const hostiles = snap.mini ? Math.max(snap.mini.length, enemies.length) : enemies.length;
  // followers (combat hires/dogs) ship only on maps with hire posts; the
  // squad cap is 5 (2 per player) so the count reads against the pool
  const followers = snap.followers?.length ?? 0;
  $('squadStatusBody').textContent =
    `Hostiles: ${hostiles}${sleeping ? ` (${sleeping} unaware)` : ''} · Rescued: ${snap.rescued.length}`
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
  updateOvertime(snap);
  updateControlsOverlay(snap, me);
  // the renderer owns the fog-of-war exploration ledger and painting; the
  // client only decides per-mode WHETHER fog applies this frame
  renderMod.setFogEnabled?.(fogActive());
  renderMinimap(mmCtx, miniSnap(snap), session?.focusPids() ?? new Set());
}

// AOI tolerance for the minimap: when the server ships the compact mini
// array (global enemy positions as tile-rounded [x,y] pairs, every 3rd tick)
// the minimap draws those instead of the AOI-filtered enemy list, so red
// dots keep working beyond the interest radius. Everything else rides the
// snap untouched — players/objectives/flags are always shipped in full, and
// local sessions never carry a mini field (full snapshots, no change).
function miniSnap(snap) {
  if (!snap.mini) return snap;
  return {
    ...snap,
    enemies: snap.mini.map(m => ({ x: ((m?.[0] ?? 0) + 0.5) * TILE, y: ((m?.[1] ?? 0) + 0.5) * TILE })),
  };
}

// ---------- fog of war (mode gate; render.js owns the exploration ledger) ----------
// Story / stronghold / expedition missions get a fogged minimap; versus and
// classic arcade missions keep their full minimap.
function fogActive() {
  if (!session) return false;
  if (session.versusMode?.()) return false;
  return !!(session.story || session.bastionMode?.() || session.expedition);
}

// ---------- dynamic splitscreen (1..4 local viewports on the one canvas) ----
// Settings: Off | Dynamic | Always (persisted). Off keeps today's shared
// camera. Dynamic shares the camera while every local seat still fits at a
// readable zoom and SPLITS once they spread past it — hysteresis (split when
// they'd need < 0.62, merge once they'd fit again at >= 0.78) stops border
// flicker, and the viewport bounds lerp through a fast 0.25s transition.
// Always splits whenever 2+ local seats are in the field. Couch Battle
// Royale FORCES Always while >1 local seat (opponents never share a camera).
// The client only drives view rects each frame; renderMod.renderViews draws
// them (typeof-guarded — until it ships, render() stays single-view). Demo
// mode, menus, lobbies, cutscenes and all DOM overlays stay full-canvas.
//
// views[] contract (consumed by render.js renderViews):
//   { id,            stable per-view camera key ('p<pid>' | 'map')
//     kind,          'player' | 'map' (3 seats: the 4th cell is a full map)
//     rect,          { x, y, w, h } viewport in canvas px (lerped in transit)
//     pid,           the seat's player id (null for the map cell)
//     seat,          cell index (seat order = cell order)
//     name, color,   the cell's name+hearts chip styling
//     mask, focus }  map cell only: fog mask (null = no fog) + local pid Set
const SPLIT_KEY = 'holdout-hd.splitscreen';
const SPLIT_MODES = ['off', 'dynamic', 'always'];
const SPLIT_LABEL = { off: 'Off', dynamic: 'Dynamic', always: 'Always' };
let splitMode = localStorage.getItem(SPLIT_KEY);
if (!SPLIT_MODES.includes(splitMode)) splitMode = 'dynamic';
const SPLIT_OUT = 0.62;     // dynamic: split when locals no longer fit at this zoom
const SPLIT_IN = 0.78;      // dynamic: merge once they'd fit at this zoom again
const SPLIT_T = 0.25;       // transition seconds (viewport bounds lerp)
const CAM_PAD = TILE * 4.5; // matches the shared camera's bbox padding
const split = { session: null, on: false, k: 0 };

function localSeatInfo() {
  if (!session || demoMode) return []; // demo/attract stays single-view
  return session.localSeats?.() ?? [];
}
// Zoom at which ONE shared camera would fit every ACTIVE local seat (the
// shared camera's own bbox-fit math). Infinity when 0-1 are active — a lone
// survivor always "fits", so dynamic mode merges while teammates are down.
function localFitZoom(snap, pids, vw, vh) {
  // mirror computeCamera's whole-map branch (render.js): a map the shared
  // camera frames whole-screen can never need a split
  if (Math.min(vw / (snap.w * TILE), vh / (snap.h * TILE)) >= 0.8) return Infinity;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
  for (const p of snap.players ?? []) {
    if (p.state !== 'active' || !pids.has(p.pid)) continue;
    n++;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  if (n < 2) return Infinity;
  return Math.min(vw / (maxX - minX + CAM_PAD * 2), vh / (maxY - minY + CAM_PAD * 2));
}
// Per-frame split/merge state machine. Returns views[] while split (or mid-
// transition), null for the classic single-view render().
function splitViews(snap, dt) {
  if (split.session !== session) { split.session = session; split.on = false; split.k = 0; }
  // a seat only counts once its pid exists in the snapshot (net seats can be
  // claimed mid-lobby; a dead seat's pid leaves the player list)
  const seats = localSeatInfo()
    .filter(s => (snap.players ?? []).some(p => p.pid === s.pid))
    .slice(0, 4);
  if (seats.length < 2) { split.on = false; split.k = 0; return null; }
  let want;
  if (session.versusMode?.() === 'br') want = true; // couch-BR: forced Always
  else if (splitMode === 'always') want = true;
  else if (splitMode === 'dynamic') {
    const fz = localFitZoom(snap, new Set(seats.map(s => s.pid)), canvas.width, canvas.height);
    want = fz < (split.on ? SPLIT_IN : SPLIT_OUT); // hysteresis — no flicker
  } else want = false; // 'off'
  split.on = want;
  split.k = Math.max(0, Math.min(1, split.k + (dt / SPLIT_T) * (want ? 1 : -1)));
  return split.k > 0 ? buildViews(snap, seats) : null;
}
// Layouts: 2 seats = vertical halves (P1 left); 3 seats = 2x2 grid with the
// 4th cell a fog-aware FULL-MAP view; 4 seats = 2x2 quadrants in seat order.
// During the transition the primary cell lerps from full-canvas while the
// other cells grow in from their canvas edge/corner (a merge runs the same
// lerp backwards, so secondary cells shrink away as P1 retakes the screen).
function buildViews(snap, seats) {
  const W = canvas.width, H = canvas.height;
  const k = split.k, e = k * k * (3 - 2 * k); // smoothstep the bounds lerp
  const L = (a, b) => Math.round(a + (b - a) * e);
  const lerpRect = (a, b) => ({ x: L(a.x, b.x), y: L(a.y, b.y), w: L(a.w, b.w), h: L(a.h, b.h) });
  const full = { x: 0, y: 0, w: W, h: H };
  const hw = Math.round(W / 2), hh = Math.round(H / 2);
  const two = seats.length === 2;
  const cells = two
    ? [{ x: 0, y: 0, w: hw, h: H }, { x: hw, y: 0, w: W - hw, h: H }]
    : [{ x: 0, y: 0, w: hw, h: hh }, { x: hw, y: 0, w: W - hw, h: hh },
       { x: 0, y: hh, w: hw, h: H - hh }, { x: hw, y: hh, w: W - hw, h: H - hh }];
  const anchors = two
    ? [full, { x: W, y: 0, w: 0, h: H }]
    : [full, { x: W, y: 0, w: 0, h: 0 }, { x: 0, y: H, w: 0, h: 0 }, { x: W, y: H, w: 0, h: 0 }];
  const views = seats.map((s, i) => ({
    id: 'p' + s.pid, kind: 'player', pid: s.pid, seat: i,
    name: s.name, color: PCOLORS[i],
    rect: lerpRect(anchors[i], cells[i]),
  }));
  if (seats.length === 3) {
    views.push({
      id: 'map', kind: 'map', pid: null, seat: 3,
      mask: fogActive() ? (renderMod.exploreMask?.(snap) ?? null) : null,
      focus: new Set(seats.map(s => s.pid)),
      rect: lerpRect(anchors[3], cells[3]),
    });
  }
  return views;
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
      // the sim gates cycle.bloodMoon to dusk; nextBloodMoon is the day-phase
      // "the UPCOMING night is a blood moon" flag (optional — older sims omit it)
      blood = !!cyc?.nextBloodMoon;
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

// ---------- CTF overtime chip ("OVERTIME +n") ----------
// After sudden death begins the sim escalates pressure every 20s and exposes
// the escalation level on the snapshot; the chip pins while it's live. Every
// read is optional — classic/older snapshots never carry the field, so the
// chip simply never shows there.
let otSig = null;
function updateOvertime(snap) {
  // the chip pins for the WHOLE of sudden death: the sim ships the overtime
  // key from the horn on (level 0 for the first 20s), so the key's presence
  // is the live flag — 'OVERTIME' at 0, 'OVERTIME +n' once escalation ticks.
  // ot -1 = no key / not playing = hidden (classic snapshots never show it).
  const raw = snap.overtime ?? snap.otLevel;
  const ot = snap.status === 'play' && raw != null
    ? Math.max(0, Math.floor(Number(raw) || 0))
    : -1;
  if (ot === otSig) return;
  otSig = ot;
  const el = $('otChip');
  el.hidden = ot < 0;
  if (ot >= 0) el.textContent = ot > 0 ? `OVERTIME +${ot}` : 'OVERTIME';
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
  // couch with 2+ seats: surface the live splitscreen mode (Settings cycles
  // Off/Dynamic/Always; couch Battle Royale always splits, setting or not)
  if (localSeatInfo().length > 1) {
    rows.push(`VIEW  SPLIT ${session.versusMode?.() === 'br' ? 'ALWAYS (BR)' : SPLIT_LABEL[splitMode].toUpperCase()}`);
  }
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
  const fogMask = fogActive() ? renderMod.exploreMask?.(snap) : null; // fog off = all seen
  const seen = (x, y) => !fogMask
    || !!fogMask[Math.min(snap.h - 1, Math.max(0, Math.floor(y / TILE))) * snap.w + Math.min(snap.w - 1, Math.max(0, Math.floor(x / TILE)))];
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
  // supply drops ping (objective-marker style) until their cache is opened;
  // entries whose chest is gone or looted fall out of the list
  for (let i = supplyPings.length - 1; i >= 0; i--) {
    const sp = supplyPings[i];
    const chest = (snap.chests ?? []).find(c => Math.abs(c.x - sp.x) < 1 && Math.abs(c.y - sp.y) < 1);
    if (!chest || chest.opened) { supplyPings.splice(i, 1); continue; }
    ring(sp.x, sp.y, 'rgba(255,217,138,0.95)');
  }
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
  sess.cutscene = { slides, idx: 0, t: 0, done, hold: !!opts.hold, holdHint: opts.holdHint || '', waiting: false, fired: false, holdT: 0, holdThreshold: 3 };
}
function slidesTick(sess, polled, dt) {
  const cs = sess.cutscene;
  cs.t += dt;
  // hold FIRE/START for holdThreshold seconds to SKIP the whole cutscene (a
  // quick tap still advances one slide, below). Online host-paced intros only
  // let the host skip, so the room stays in sync.
  const mayHoldSkip = (sess.isHost?.() ?? true);
  let holding = false;
  for (const st of Object.values(polled)) if (st.fire || st.start) { holding = true; break; }
  cs.holdT = (holding && mayHoldSkip) ? (cs.holdT || 0) + dt : 0;
  if (cs.holdT >= cs.holdThreshold) {
    cs.holdT = 0;
    if (cs.hold) { cs.waiting = true; if (!cs.fired) { cs.fired = true; cs.done(); } return; }
    endSlides(sess); cs.done(); return;
  }
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
    this.mode = ['ctf', 'br', 'siege'].includes(opts.mode) ? opts.mode : null;
    // bastion siege: expedition-style one-shot (no saves), solo+ couch fine
    this.bastion = opts.mode === 'bastion';
    // Endless Siege: a bastion run with no night cap, escalating forever
    this.endless = this.bastion && !!opts.endless;
    // Daily Challenge: a seeded endless siege on one map+twist, shared board.
    // opts.daily = { dateStr, label, def } — def already carries endless + mods.
    this.daily = (this.bastion && opts.daily) ? opts.daily : null;
    // Tutorial: a coached classic run on a one-map list (opts.tutorialDef), no
    // saves/rankings — just teaches move/fire/rescue/extract.
    this.tutorial = !!opts.tutorial;
    // Family Mode: gentle co-op on the bright family maps (no saves/rankings)
    this.family = !this.mode && !this.bastion && !this.story && !!opts.family;
    this.expedition = !this.story && !this.mode && !this.bastion && !this.family && !!opts.expedition;
    this.levels = this.story ? storyLevels
      : this.mode ? (this.mode === 'ctf' ? ctfLevels : this.mode === 'br' ? brLevels : siegeLevels)
        : this.bastion ? bastionLevels
          : this.family ? familyLevels
            : this.expedition ? expeditions : campaign;
    this.levelIdx = this.story
      ? Math.max(0, Math.min((save?.chapter ?? 1) - 1, this.levels.length - 1))
      : (this.bastion || this.mode)
        // bastion: the level-select pick; versus: the map choice (defaults 0)
        ? Math.max(0, Math.min(opts.levelIdx ?? 0, Math.max(0, this.levels.length - 1)))
        : this.expedition ? 0 : (save?.levelIdx ?? 0);
    // stronghold lobbies draw from the stronghold roster (starters + every
    // operative unlocked by beaten levels); other modes are untouched
    this.roster = save?.roster ?? (this.bastion ? strongholdRoster() : this.mode ? startingRoster.slice() : coopRoster());
    // co-op (classic/story/stronghold): always surface earned operators, even
    // when resuming a save whose stored roster predates the unlock. Versus is
    // left exactly as it was.
    if (!this.mode) this.roster = [...new Set([...this.roster, ...profileUnlocked().filter(id => !startingRoster.includes(id))])];
    // Daily: a one-map list of the seeded def, so the lobby/HUD/start() all read it.
    if (this.daily) { this.levels = [this.daily.def]; this.levelIdx = 0; }
    if (this.tutorial && opts.tutorialDef) { this.levels = [opts.tutorialDef]; this.levelIdx = 0; }
    this.players = []; // { pid, name, device, charId, cursor }
    this.game = null;
    this.snap = null;
    this.paused = false;
    this.inLobby = false;
    this.cutscene = null; // { slides, idx, t, done } — intro/outro state machine
  }
  focusPids() { return new Set(this.players.map(p => p.pid)); }
  primaryPid() { return 0; }
  // splitscreen seats: join order = cell order (demo bots never split —
  // localSeatInfo gates on demoMode before this is consulted)
  localSeats() { return this.players.map(p => ({ pid: p.pid, name: p.name })); }
  levelIdxView() { return this.levelIdx; }
  levelList() { return this.levels; }
  versusMode() { return this.mode; }
  bastionMode() { return this.bastion; }
  // seats alternate ctf teams by join order (P1/P3 vs P2/P4)
  teamOf(p) { return (this.mode === 'ctf' || this.mode === 'siege') ? p.pid % 2 : this.mode === 'br' ? p.pid : null; }
  canStart() {
    // siege is solo-playable: one human deploys and the field is padded with bots
    const min = this.mode === 'siege' ? 1 : this.mode ? 2 : 1;
    return this.players.length >= min && this.players.every(p => p.charId);
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
      hint: 'FIRE (A / Space / Enter) joins — up to 4 players. Move with the stick or D-pad, FIRE to lock in your operator. '
        + 'Once everyone has picked, FIRE again — or START — to DEPLOY. SPECIAL (B / F / RShift) backs out to the menu. '
        + (ctf ? 'Blue seats are Team A, red seats Team B — odd joins vs even joins.'
          : 'Hold ACT (X / E) on a build site to construct — LYTH shards drop from fallen Entropy.'),
      players: this.players.map(p => ({
        name: p.name, charId: p.charId, isHost: p.pid === 0, me: false,
        badge: 'P' + (p.pid + 1), color: colorOf(p), team: this.teamOf(p),
      })),
      roster: this.roster,
      canStart: this.canStart(),
      cursors: this.players.map(p => ({ idx: p.cursor, color: colorOf(p), badge: 'P' + (p.pid + 1), picked: !!p.charId, me: p.pid === 0 })),
      onCard: id => this.clickChar(id),
      onStep: dir => {
        if (!this.players.length) this.join('kb1');
        const p = this.players[0];
        if (p && !p.charId) { p.cursor = mod(p.cursor + dir, this.roster.length); this.renderLobby(); }
      },
      teamCols: ctf,
      allowDupes: !!this.mode, // versus char select allows duplicates everywhere
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
      // versus drops uniqueness entirely (matches the sim: identity = name +
      // team color, so even same-team duplicates are fine in ctf/br).
      // Classic/story/co-op stay strictly unique.
      const taken = !this.mode && this.players.some(o => o !== p && o.charId === id);
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
      // SPECIAL / B (or Esc) anywhere in the lobby backs out to the menu
      if (st.specialJust) { st.specialJust = false; return this.leave(); }
      const p = this.deviceOf(dev);
      if (!p) {
        if (st.fireJust) this.join(dev);
        continue;
      }
      // START still deploys when everyone's ready; an un-picked seat START leaves
      if (st.startJust) {
        if (this.canStart()) return this.start();
        if (!p.charId) { this.unjoin(p); continue; }
      }
      const n = this.roster.length;
      if (!p.charId) {
        if (st.leftJust || st.upJust) { p.cursor = mod(p.cursor - 1, n); moved = true; }
        if (st.rightJust || st.downJust) { p.cursor = mod(p.cursor + 1, n); moved = true; }
      }
      if (st.fireJust) {
        // FIRE/A locks in your operator; once everyone's picked, FIRE/A DEPLOYS
        if (p.charId && this.canStart()) return this.start();
        this.pick(p, p.charId ?? this.roster[p.cursor]);
      }
    }
    if (moved) this.renderLobby();
  }
  start() {
    if (!this.inLobby || !this.canStart()) return;
    // Siege: pad an under-filled field with bot allies + enemies (target 3v3).
    // teamOf alternates by pid, so the humans + even-pid bots face the odd-pid
    // bots — every human gets allies AND opponents.
    if (this.mode === 'siege' && this.players.length < 6) {
      const pool = this.roster.filter(id => charMap[id]);
      let pid = this.players.length ? Math.max(...this.players.map(p => p.pid)) + 1 : 0;
      while (this.players.length < 6) {
        this.players.push({ pid, name: 'BOT' + pid, device: 'bot' + pid, charId: pool[pid % pool.length] || this.roster[0], cursor: 0, missingT: 0 });
        pid++;
      }
    }
    this.inLobby = false;
    let lvl = this.levels[this.levelIdx];
    // Endless: clone the def (never mutate the shared catalog) and flip the
    // bastion flag — the sim then escalates without end and never auto-clears.
    if (this.endless && lvl.mode === 'bastion') {
      lvl = { ...lvl, bastion: { ...(lvl.bastion || {}), endless: true } };
    }
    // fresh coach counters each (re)start so a retry doesn't inherit progress
    if (this.tutorial) tut = { step: 0, kills: 0, rescued: 0, moved: 0, lastPos: null };
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
      if (this.mode === 'siege') setTimeout(showSiegeIntro, 250); // brief objective brief
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
    if (this.paused) {
      this.paused = false; // belt and braces if the dialog already fell
      closePauseUi();
      return;
    }
    this.paused = true;
    const items = [{ label: 'Resume', onPick: () => closePauseUi() }];
    if (this.canSaveQuit()) items.push({ label: 'Save & Quit', ghost: true, onPick: () => this.saveQuit() });
    items.push({ label: 'Quit to Menu', ghost: true, onPick: () => this.leave() });
    openPauseUi({
      title: 'Paused',
      body: 'The frontier waits.',
      hint: 'UP/DOWN picks · FIRE confirms · START / ESC / B resumes',
      items,
      onBack: () => closePauseUi(),
      onClose: () => {
        this.paused = false;
        // a button still held from the dismissing press must not fire into
        // the sim's first resumed frames (the cutscene-dismissal squelch)
        this.fireSquelch = new Set(DEVICES.filter(d => prevDev[d]?.fire));
      },
    });
  }
  // Save & Quit is offered on non-versus LOCAL runs (classic/story/bastion —
  // each twin-test-proven to round-trip through serializeGame); couch versus
  // matches, legacy expeditions and the attract demo never see the button.
  suspendMode() {
    if (this.mode || this.expedition || demoMode) return null;
    return this.story ? 'story' : this.bastion ? 'bastion' : 'classic';
  }
  canSaveQuit() {
    return !!this.suspendMode() && typeof gameMod.serializeGame === 'function';
  }
  suspendName() {
    const lvl = this.levels[this.levelIdx];
    if (this.story) return lvl?.title || `Chapter ${this.levelIdx + 1} — ${lvl?.name ?? ''}`;
    if (this.bastion) {
      return `Stronghold ${String(lvl?.stronghold?.level ?? this.levelIdx + 1).padStart(2, '0')} — ${lvl?.stronghold?.name ?? lvl?.name ?? ''}`;
    }
    return `Mission ${this.levelIdx + 1} — ${lvl?.name ?? ''}`;
  }
  saveQuit() {
    if (!this.game || !this.canSaveQuit()) return;
    try {
      localStorage.setItem(SUSPEND_KEY, JSON.stringify({
        mode: this.suspendMode(),
        levelIdx: this.levelIdx,
        story: !!this.story,
        data: gameMod.serializeGame(this.game),
        name: this.suspendName(),
        at: Date.now(),
        // additive: each seat's physical device, so the resumed run hands
        // every player back the controller they were actually holding
        seats: this.players.map(p => ({ pid: p.pid, device: p.device })),
      }));
    } catch {
      // storage quota — stay paused rather than quit and silently lose the run
      showToast('SAVE FAILED — STORAGE FULL, RUN NOT SUSPENDED', 3200, true);
      return;
    }
    this.leave();
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

    // Anchor Siege bot: shoot the nearest enemy tower, then minion, else advance
    // on the enemy core; retreat to your own core when low.
    if (snap.mode === 'siege' && snap.siege) {
      const dst = o => Math.hypot(o.x - me.x, o.y - me.y);
      const foe = me.team === 0 ? 1 : 0;
      if ((me.hp ?? 9) <= 1) {
        const own = (snap.cores || []).find(c => c.team === me.team);
        if (own) steerTo(own.x, own.y);
        return inp;
      }
      // priority: a nearby enemy operative -> enemy tower -> enemy minion
      let tgt = null, best = 5 * TILE;
      for (const q of snap.players || []) { if (q.team !== foe || q.state !== 'active') continue; const d = dst(q); if (d < best) { best = d; tgt = q; } }
      if (!tgt) { best = 7 * TILE; for (const t of snap.siege.towers || []) { if (t.destroyed || t.team !== foe) continue; const d = dst(t); if (d < best) { best = d; tgt = t; } } }
      if (!tgt) { best = 6 * TILE; for (const m of snap.siege.minions || []) { if (m.team !== foe) continue; const d = dst(m); if (d < best) { best = d; tgt = m; } } }
      if (tgt) { inp.fire = true; steerTo(tgt.x, tgt.y); return inp; }
      const fc = (snap.cores || []).find(c => c.team === foe);
      if (fc) steerTo(fc.x, fc.y);
      return inp;
    }

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
    const timeS = this.game.elapsed ?? 0; // rankings clock — captured before the game drops
    const lvl = this.levels[this.levelIdx];
    const endlessNights = this.endless ? (this.game.cycle?.nightNo || 0) : 0; // survival metric
    const runKills = this.game.kills || 0;                      // milestone: total kills
    const runRescues = (this.game.rescued || []).length;        // milestone: total rescues
    const playedOps = this.players.map(p => p.charId).filter(Boolean); // milestone: distinct operators
    this.game = null;
    this.paused = false;
    for (const p of this.players) { p.charId = null; p.cursor = 0; p.bot = null; }
    // Tutorial: never saves or ranks — a clear graduates the player to the
    // campaign; a wipe just offers a relaxed retry. (Intercept before the
    // normal classic/endless/fail chain.)
    if (this.tutorial) {
      endTutorialCoach();
      if (cleared) {
        playUi('victory');
        showMsg('You’re Ready',
          'That’s the core of it — move, fire, rescue, extract.\nJump into the campaign, or hold a Stronghold in Endless.',
          'Play Campaign', () => { session = null; show('menu'); showMenuPage('pageSingle'); refreshContinue(); },
          'Main Menu', () => this.leave());
      } else {
        showMsg('Take Your Time', 'No one is lost on a practice run.\nGive it another go — you’ve got this.',
          'Retry', () => this.lobby(), 'Main Menu', () => this.leave());
      }
      return;
    }
    if (cleared) {
      // Family Mode: a gentle clear — no rankings/milestones, just a cheery
      // "great job" and on to the next bright map (or the menu after the last).
      if (this.family) {
        playUi('victory');
        this.levelIdx++;
        if (this.levelIdx >= this.levels.length) {
          showMsg('All Done — Great Job! 🌟', 'You finished every family adventure!\nCome back and play again any time.', 'Main Menu', () => this.leave());
        } else {
          showMsg('Yay! 🌸', (resultText(res) || 'Lovely exploring!') + '\nReady for the next adventure?', 'Next Adventure', () => this.lobby(), 'Main Menu', () => this.leave());
        }
        return;
      }
      // milestone progress: a cleared co-op mission + run stats toward unlocks
      if (!demoMode) recordProgress({ gamePlayed: true, missionCleared: true, strongholdClear: this.bastion, kills: runKills, rescues: runRescues, score, operators: playedOps });
      // rankings: one board entry per cleared level (server POST, or static-
      // build local bests). submitRun no-ops on demo runs and keyless defs.
      submitRun(lvl, this.players.map(p => p.name), this.players.length, score, timeS);
      this.roster = res.roster;
      if (this.story) {
        this.levelIdx++;
        // save now (before any cutscene/dialog) so quitting can't lose the clear;
        // demo/attract runs never touch the player's story save or its beacon
        if (!demoMode) {
          // the cleared chapter's mid-run checkpoint is spent — but a beacon
          // belonging to ANOTHER chapter (this run was a resumed Save & Quit
          // bookmark of an older chapter) is not ours to spend
          if (loadBeacon(this.levelIdx)) clearBeacon();
          if (this.levelIdx >= this.levels.length) localStorage.removeItem(STORY_KEY);
          else {
            // never regress: clearing a resumed OLDER chapter while a further
            // story save exists must not pull that save backwards
            let cur = null;
            try { cur = JSON.parse(localStorage.getItem(STORY_KEY)); } catch {}
            if (!((cur?.chapter ?? 0) > this.levelIdx + 1)) {
              localStorage.setItem(STORY_KEY, JSON.stringify({ chapter: this.levelIdx + 1, roster: this.roster }));
            }
          }
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
      // never regress the campaign bookmark: clearing a RESUMED older run
      // while a further classic save exists must not pull that save backwards
      let curSave = null;
      try { curSave = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
      if (!((curSave?.levelIdx ?? -1) > this.levelIdx)) {
        localStorage.setItem(SAVE_KEY, JSON.stringify({ levelIdx: this.levelIdx, roster: this.roster }));
      }
      showMsg('Mission Cleared', (resultText(res) || 'Nicely done.') + `\nScore: ${score.toLocaleString()}`, 'Continue', () => this.lobby());
    } else if (this.endless) {
      // Endless Siege "loss" is the run's natural end — celebrate how far the
      // squad got and record it on the map's endless board (nights survived,
      // then in-run score; the combined number decodes back to Night N).
      const nights = endlessNights;
      if (nights >= 1 && !demoMode) {
        // Daily runs land on the shared daily board; free Endless on the map's own board.
        const base = levelKeyOf(lvl);
        const ekey = this.daily ? 'daily/' + this.daily.dateStr : (base ? 'endless/' + base.split('/')[1] : null);
        if (ekey) submitRun(lvl, this.players.map(p => p.name), this.players.length, nights * 100000 + Math.min(99999, score), timeS, { key: ekey });
      }
      // milestone progress: best/total endless nights + (for dailies) the day + run stats
      if (!demoMode) recordProgress({ gamePlayed: true, endlessNights: nights, dailyDate: this.daily ? this.daily.dateStr : undefined, kills: runKills, rescues: runRescues, score, operators: playedOps });
      playUi('victory');
      const dailyBack = () => { session = null; show('menu'); showMenuPage('pageMain'); refreshContinue(); };
      showMsg(this.daily ? `Daily Over — ${this.daily.label}` : 'Endless Over',
        `You held ${lvl.stronghold?.name ?? lvl.name ?? 'the line'} through ${nights} night${nights === 1 ? '' : 's'}.\nScore: ${score.toLocaleString()}`,
        'Play Again', () => this.lobby(),
        this.daily ? 'Main Menu' : 'Level Select',
        this.daily ? dailyBack : () => { session = null; shPurpose = 'local'; show('menu'); showMenuPage('pageSh'); refreshContinue(); });
    } else {
      // a lost co-op run still accrues games played / kills / score / operators
      if (!demoMode) recordProgress({ gamePlayed: true, kills: runKills, rescues: runRescues, score, operators: playedOps });
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
    const lvl = this.levels[this.levelIdx];
    const timeS = g?.elapsed ?? 0; // match length — the versus board clock
    this.game = null;
    this.paused = false;
    let body;
    if (this.mode === 'ctf' && winner != null) {
      const winners = this.players.filter(p => p.pid % 2 === winner).map(p => p.name);
      body = `${TEAM_NAME[winner] ?? 'A team'} takes the match${winners.length ? ` — ${winners.join(', ')}` : ''}`
        + (caps ? `\nCaptures: ${caps[0] ?? 0} — ${caps[1] ?? 0}` : '');
      // CTF board contract: the winning team's run — score = captures x1000,
      // timeS = match length, players = match size
      submitRun(lvl, winners, this.players.length, (caps?.[winner] ?? 0) * 1000, timeS);
    } else if (this.mode === 'br' && winner != null) {
      const name = this.players.find(p => p.pid === winner)?.name ?? 'P' + (winner + 1);
      body = `${name} is the last operative standing.`;
      // BR board contract: the last operative standing — score = their kills
      // (per-player kill ledger), timeS = match length, players = match size
      const kills = g?.players?.find(p => p.pid === winner)?.kills ?? 0;
      submitRun(lvl, [name], this.players.length, kills, timeS);
    } else {
      body = 'The match is over.';
    }
    // milestone progress: CTF/BR wins (when a local seat is on the winning side) + games/kills
    if (!demoMode) {
      const myPids = this.focusPids?.() ?? new Set();
      const ctfWin = this.mode === 'ctf' && winner != null && [...myPids].some(pid => pid % 2 === winner);
      const brWin = this.mode === 'br' && winner != null && myPids.has(winner);
      const myKills = (g?.players || []).reduce((s, p) => s + (myPids.has(p.pid) ? (p.kills || 0) : 0), 0);
      recordProgress({ gamePlayed: true, ctfWin, brWin, kills: myKills, operators: this.players.map(p => p.charId).filter(Boolean) });
    }
    for (const p of this.players) { p.charId = null; p.cursor = 0; p.bot = null; }
    playUi('victory');
    showMsg('Match Over', body, 'Rematch', () => this.lobby());
  }
  victory() {
    playUi('victory');
    if (this.story) {
      if (!demoMode) { localStorage.removeItem(STORY_KEY); clearBeacon(); }
      // saga complete (ch11 Genesis Drift): the dialog speaks the finale's
      // own language — see levels/story/ch11.json outro + the saga slides
      showMsg('Genesis Holds', `The First Anchor settles, and a hundred anchors answer in one breath.\nThe frontier holds end to end. Keep the signal alive.\nFinal roster: ${this.roster.map(id => charMap[id].name).join(', ')}`, 'Main Menu', () => this.leave());
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
  constructor(mode, code, hostMode = 'classic', hostLevelIdx = null, opts = {}) {
    const hostDaily = hostMode === 'bastion' && !!opts.daily;
    const hostEndless = hostMode === 'bastion' && (!!opts.endless || hostDaily);
    this.endless = hostEndless;
    this.daily = hostDaily;
    this.myPid = null;
    this.myPick = null;
    this.snap = null;
    this.grid = null;
    this.mini = null;     // latest AOI minimap array (server ships every 3rd tick)
    this.joinCode = mode === 'join' ? code : null; // rejoin offer before the first lobby lands
    this.lobbyData = null;
    this.hostToastPid = null; // last host pid already toasted (migration dedupe)
    this.cutscene = null;
    this.seats = new Map();        // device -> pid (insertion order = seat order)
    this.menuDevs = null;          // devices captured by the open leave dialog
    this.pendingSeats = new Map(); // device -> request time, awaiting localAdded
    this.cursors = {};             // device -> roster pick cursor
    this.missingT = {};            // device -> seconds a bound pad has been gone
    this.joinToasted = new Set();  // pids already toasted as mid-match joiners
    this.name = $('nameInput').value.trim() || 'Player';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.onopen = () => {
      if (mode === 'host') {
        const msg = { t: 'host', name: this.name, resume: code };
        // room visibility: always explicit (per-mode-group toggle on the
        // Online page; versus defaults public, co-op private). Additive —
        // an older server ignores the flag and keeps rooms private.
        msg.public = visOf(VIS_GROUP(hostMode)) === 'public';
        // classic hosting stays byte-identical otherwise; story/ctf/br ride the mode field
        if (hostMode && hostMode !== 'classic') msg.mode = hostMode;
        // stronghold: the host's level-select pick rides along (the server
        // clamps it; unlock gating is client-side — this menu only offers
        // unlocked levels). ctf reuses the same pattern for its map choice.
        if ((hostMode === 'bastion' || hostMode === 'ctf') && hostLevelIdx != null) msg.levelIdx = hostLevelIdx;
        // stronghold: the host's earned roster rides along (the server
        // validates ids, dedupes and always keeps every starter)
        if (hostMode === 'bastion') msg.roster = strongholdRoster();
        // Endless Siege rides the host message (additive — an older server
        // ignores it and the room plays as the fixed-night campaign)
        if (hostEndless) msg.endless = true;
        // Daily online: the server resolves today's map+twist from its own date.
        if (hostDaily) msg.daily = true;
        this.ws.send(JSON.stringify(msg));
      } else {
        this.ws.send(JSON.stringify({ t: 'join', room: code, name: this.name }));
      }
    };
    this.ws.onmessage = e => this.onMsg(JSON.parse(e.data));
    this.ws.onclose = () => {
      clearInterval(this.inputTimer);
      if (session !== this) return;
      session = null;
      // Mid-level drop: the server holds this connection's seats (matched by
      // name, case-insensitive) for 120s — offer a one-press rejoin. On
      // success the room re-binds the held seats, replays a full levelStart
      // snapshot and the players re-enter via the respawn-pick flow.
      const roomCode = this.lobbyData?.room || this.joinCode || '';
      if (roomCode && this.snap?.status === 'play') {
        const heldUntil = Date.now() + 120000;
        showMsg('Disconnected',
          `Lost connection mid-level.\nYour seats are held for 2 minutes — rejoin room ${roomCode} to retake them.`,
          `Rejoin ${roomCode}`, () => {
            if (session) return; // a second blind FIRE while connecting
            if (Date.now() > heldUntil) {
              show('menu');
              refreshContinue();
              showToast('REJOIN WINDOW EXPIRED — SEATS RELEASED', 3000, true);
              return;
            }
            session = new NetSession('join', roomCode);
          },
          'Main Menu', () => { show('menu'); refreshContinue(); });
      } else {
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
        // mouse-only machine: any device drives the primary (legacy form);
        // devices navigating the leave dialog are excluded while it is up
        const o = mergedInput(this.menuDevs);
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
  // splitscreen: ONLY this machine's couch seats split (insertion order =
  // seat order); a mouse-only machine (no bound seats) keeps the shared view
  // and the server/other machines are untouched either way
  localSeats() {
    return [...this.seats.values()].map((pid, i) => ({
      pid,
      name: this.lobbyData?.players.find(p => p.pid === pid)?.name
        ?? this.snap?.players?.find(p => p.pid === pid)?.name
        ?? 'P' + (i + 1),
    }));
  }
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
    // a device captured by the open leave dialog navigates the menu, not the
    // match — its seat stands idle while the rest of the couch keeps playing
    if (this.menuDevs?.has(dev)) return {};
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
    if (m.t === 'joined') {
      this.myPid = m.you;
      // mid-level rejoin: the server re-binds this connection's held seats
      // and lists their pids (or {tag,pid} pairs). Tagged seats re-bind to
      // their device instantly; bare pids queue up and each FIRE press from
      // an unbound device retakes the next one (join order = seat order,
      // exactly like the lobby claim flow). Until anything binds, the legacy
      // merged-input path keeps the primary playable.
      if (m.rejoined && Array.isArray(m.seats)) {
        const pids = [];
        for (const s of m.seats) {
          if (s && typeof s === 'object') {
            if (s.tag != null && s.pid != null && !this.seats.has(s.tag)) {
              this.seats.set(s.tag, s.pid);
              this.cursors[s.tag] = 0;
            } else if (Number.isFinite(s.pid)) pids.push(s.pid);
          } else if (Number.isFinite(s)) pids.push(s);
        }
        const bound = new Set(this.seats.values());
        this.rebindQueue = pids.filter(p => !bound.has(p));
        if (this.rebindQueue.length > (this.rebindQueue.includes(this.myPid) ? 1 : 0)) {
          showToast('SEATS HELD — EACH PAD: PRESS FIRE TO RETAKE YOURS', 3200, true);
        }
      }
    }
    else if (m.t === 'hostMigrated') {
      // leader connection dropped; the server promoted a new room leader.
      // Deferred a beat (the levelEnd rank-toast trick): in the lobby this
      // message arrives in the same batch as the fresh 'lobby' broadcast,
      // whose renderLobby -> show('lobby') -> hideToast would wipe it.
      this.hostToastPid = m.hostPid ?? null;
      setTimeout(() => showToast(`HOST MIGRATED — ${String(m.name || 'PLAYER').toUpperCase()} LEADS`, 3200, true), 60);
    }
    else if (m.t === 'localAdded') {
      this.pendingSeats.delete(m.tag);
      if (m.tag != null && m.pid != null && !this.seats.has(m.tag)) {
        this.seats.set(m.tag, m.pid);
        this.cursors[m.tag] = 0;
      }
    }
    else if (m.t === 'lobby') {
      // host migration also reads straight off the lobby broadcast (belt and
      // braces with the explicit message): the crown moved to another pid.
      // Guarded against the explicit message's record so a MID-LEVEL
      // migration's stale diff can't re-toast minutes later at levelEnd, and
      // deferred past this batch's renderLobby/hideToast like the explicit one.
      const prevHost = this.lobbyData?.players?.find(p => p.isHost);
      const newHost = m.players.find(p => p.isHost);
      if (prevHost && newHost && newHost.pid !== prevHost.pid && newHost.pid !== this.hostToastPid) {
        this.hostToastPid = newHost.pid;
        setTimeout(() => showToast(`HOST MIGRATED — ${String(newHost.name || 'PLAYER').toUpperCase()} LEADS`, 3200, true), 60);
      }
      // mid-match joiners (ctf at 32): a lobby refresh lands while the level
      // runs — render the newcomers as toasts, never stomp the live screen.
      // The diff needs a REAL previous roster (a rejoiner's synthesized lobby
      // has players: [] and must not toast the whole room at itself).
      const prevPlayers = this.lobbyData?.players;
      if (this.snap?.status === 'play' && prevPlayers?.length) {
        const mine = new Set(this.seats.values());
        for (const p of m.players) {
          if (p.pid === this.myPid || mine.has(p.pid)) continue;
          if (prevPlayers.some(q => q.pid === p.pid)) continue;
          if (this.joinToasted.has(p.pid)) continue;
          this.joinToasted.add(p.pid);
          showToast(`${String(p.name || 'PLAYER').toUpperCase()} JOINED — ${TEAM_NAME[p.team] ?? 'THE MATCH'}`, 3000);
        }
      }
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
      this.mini = m.s?.mini ?? null; // the AOI minimap ledger resets per level
      // mid-level rejoin: levelStart can land before any lobby broadcast —
      // synthesize just enough lobby state for the HUD/mode gates until the
      // real one arrives at levelEnd
      if (!this.lobbyData) {
        this.lobbyData = {
          t: 'lobby', room: this.joinCode || '', mode: m.mode ?? m.s?.mode ?? null,
          levelIdx: m.levelIdx ?? 0, totalLevels: 0, roster: [], players: [],
        };
      }
      this.snap = m.s || null;
      hideAll();
    }
    else if (m.t === 'state') {
      if (!m.s.grid) m.s.grid = this.grid;
      else this.grid = m.s.grid;
      // AOI: the compact global minimap array ships every 3rd tick — keep the
      // latest and re-attach it so every consumer sees a current full picture
      if (m.s.mini) this.mini = m.s.mini;
      else if (this.mini) m.s.mini = this.mini;
      const prev = this.snap;
      this.snap = m.s;
      for (const ev of m.s.events) handleEvent(ev);
      if (!prev) hideAll();
    }
    else if (m.t === 'levelEnd') {
      this.myPick = null;
      // online rooms auto-record rankings server-side; the recorded rank may
      // ride back on levelEnd — deferred a beat so the results dialog's
      // hideToast can't wipe it before it shows
      if (Number.isFinite(m.rank) && m.rank >= 1 && m.rank <= 50) {
        const label = String(this.lobbyData?.levelName ?? '').toUpperCase();
        setTimeout(() => showToast(`RUN RECORDED — #${m.rank}${label ? ' ' + label : ''}`, 3200, true), 60);
      }
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
          // story saga complete: Genesis finale copy (matches the local
          // victory() dialog and the ch11 outro slides)
          showMsg(story ? 'Genesis Holds' : 'Campaign Complete!',
            (story ? 'The First Anchor settles, and a hundred anchors answer in one breath.\nThe frontier holds end to end. Keep the signal alive.\n' : '')
            + resultText(m) + `Final roster: ${m.roster.map(id => charMap[id].name).join(', ')}`,
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
    else if (m.t === 'playerJoined') {
      // explicit mid-match join broadcast (ctf): toast only, never a screen
      // change. Deduped against the lobby-diff path above by pid; an optional
      // players refresh keeps lobbyData honest for the levelEnd roster panel.
      const pid = Number(m.pid);
      const dupe = Number.isFinite(pid) && (this.joinToasted.has(pid) || pid === this.myPid || [...this.seats.values()].includes(pid));
      if (!dupe) {
        if (Number.isFinite(pid)) this.joinToasted.add(pid);
        showToast(`${String(m.name || 'PLAYER').toUpperCase()} JOINED — ${TEAM_NAME[m.team] ?? 'THE MATCH'}`, 3000);
      }
      if (Array.isArray(m.roster) && this.lobbyData) this.lobbyData.players = m.roster;
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
      hint: `Press FIRE to claim a seat — up to 4 couch players per machine, ${roomCapOf(m.mode)} per room. `
        + 'Move your cursor with LEFT/RIGHT, FIRE to lock in; START on an unpicked extra seat hands it back. '
        + 'The mouse picks for the first seat.'
        + (ctf ? ' Capture the Flag: badge colors are your team — seats alternate. Duplicate operatives are allowed.'
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
        me: pid === this.myPid,
      })),
      onCard: id => this.pickChar(id),
      onStep: dir => {
        const e = [...this.seats.entries()].find(([, pid]) => pid === this.myPid);
        if (e) { const dev = e[0]; this.cursors[dev] = mod((this.cursors[dev] ?? 0) + dir, m.roster.length); this.renderLobby(); }
      },
      teamCols: ctf,
      allowDupes: !!vm, // versus char select allows duplicates everywhere
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
      if (this.rebindQueue) this.rebindQueue = this.rebindQueue.filter(p => p !== this.myPid);
      this.renderLobby();
      return;
    }
    if (this.rebindQueue?.length) {
      // held couch seats from a mid-level rejoin claim before any addLocal —
      // the room already owns those pids, so no new seat is requested
      const pid = this.rebindQueue.shift();
      this.seats.set(dev, pid);
      this.cursors[dev] = 0;
      this.renderLobby();
      return;
    }
    if (this.seats.size + this.pendingSeats.size >= 4) return; // per-connection cap
    // per-mode room cap (classic/story/bastion 8, ctf 32, br 16)
    if ((this.lobbyData?.players.length ?? 0) + this.pendingSeats.size >= roomCapOf(this.lobbyData?.mode)) return;
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
      // SPECIAL / B (or Esc) leaves the room back to the menu
      if (st.specialJust) { st.specialJust = false; return this.leave(); }
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
        if (st.upJust) { this.cursors[dev] = mod((this.cursors[dev] ?? 0) - 1, n); moved = true; }
        if (st.downJust) { this.cursors[dev] = mod((this.cursors[dev] ?? 0) + 1, n); moved = true; }
      }
      if (st.fireJust) {
        // host: once everyone's picked, FIRE/A DEPLOYS (the Deploy button is live)
        if (pid === this.myPid && picked && !$('btnStart').disabled) { this.start(); continue; }
        // otherwise FIRE locks the cursor pick, or unlocks the current one
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
    if (!$('lobby').hidden) return this.lobbyTick(polled, dt);
    // Esc/Start during an active match opens the leave dialog (lobby phases
    // keep their Leave button; pauseUiTick owns every input while it is up)
    if (!pauseUi) {
      for (const [dev, st] of Object.entries(polled)) {
        if (st.startJust) {
          st.startJust = false;
          this.openLeaveDialog(dev);
          break;
        }
      }
    }
    // mid-level rejoin: held seats re-bind as each unbound device presses
    // FIRE (join order = seat order); the press doubles as the seat's first
    // shot/pick input, which is fine for a squad re-entering the field
    if (this.rebindQueue?.length && this.snap?.status === 'play') {
      for (const [dev, st] of Object.entries(polled)) {
        if (!st.fireJust || this.seats.has(dev)) continue;
        const pid = this.rebindQueue.shift();
        this.seats.set(dev, pid);
        this.cursors[dev] = 0;
        if (!this.rebindQueue.length) break;
      }
    }
  }
  // Esc/Start during an active online match: the match keeps running server-
  // side, so this is a LEAVE dialog, not a pause. Only the opening device
  // (plus any other device that presses START while it is up) is captured for
  // menu navigation — the other couch seats on this connection keep playing.
  openLeaveDialog(dev) {
    if (pauseUi || !this.snap || this.snap.status !== 'play') return;
    this.menuDevs = new Set([dev]);
    const room = this.lobbyData?.room || this.joinCode || '';
    openPauseUi({
      title: 'Leave match?',
      body: 'The match keeps running on the server while this is open — your operative stands down until you choose.\n'
        + `After leaving, your seats are held for about 2 minutes: rejoin from the Online page with the same name and room code${room ? ` ${room}` : ''} to retake them.`,
      hint: 'UP/DOWN picks · FIRE confirms · START / ESC / B keeps playing',
      items: [
        { label: 'Keep Playing', onPick: () => closePauseUi() },
        { label: 'Leave Match', ghost: true, onPick: () => this.leave() },
      ],
      onBack: () => closePauseUi(),
      onClose: () => { this.menuDevs = null; },
      devs: this.menuDevs,
    });
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
        unlocked: Math.max(1, Math.min(bastionLevels.length || 25, Math.floor(s.unlocked) || 1)),
        beaten: Array.isArray(s.beaten) ? s.beaten : [],
        chars: Array.isArray(s.chars) ? s.chars : [],
      };
    }
  } catch {}
  return { unlocked: 1, beaten: [], chars: [] };
}
function shUnlockOf(def, n) { return def?.stronghold?.unlock ?? SH_UNLOCKS[n] ?? null; }
// Stronghold lobby roster: 4 starters + every operative the save has earned.
// --- Operator milestones: new operators earned by playing the loop ----------
// Endless nights survived, Daily Challenge completions, and missions cleared
// unlock new operators. Tracked in a local profile; an unlock toasts and the
// operator joins the co-op roster everywhere.
const PROFILE_KEY = 'holdout-hd.profile';
function loadProfile() {
  let p = {};
  try { const j = JSON.parse(localStorage.getItem(PROFILE_KEY)); if (j && typeof j === 'object') p = j; } catch {}
  const intOf = k => Math.max(0, Math.floor(p[k]) || 0);
  const out = {
    bestEndlessNights: intOf('bestEndlessNights'), missionsCleared: intOf('missionsCleared'),
    strongholdClears: intOf('strongholdClears'), totalKills: intOf('totalKills'),
    totalRescues: intOf('totalRescues'), bestRunScore: intOf('bestRunScore'),
    gamesPlayed: intOf('gamesPlayed'), endlessNightsTotal: intOf('endlessNightsTotal'),
    ctfWins: intOf('ctfWins'), brWins: intOf('brWins'),
    dailyDates: Array.isArray(p.dailyDates) ? p.dailyDates.slice(0, 400) : [],
    operatorsPlayed: Array.isArray(p.operatorsPlayed) ? p.operatorsPlayed.filter(id => charMap[id]) : [],
    unlocked: Array.isArray(p.unlocked) ? p.unlocked.filter(id => charMap[id]) : [],
  };
  out.distinctOperators = out.operatorsPlayed.length; // derived, for the wisp milestone
  return out;
}
function saveProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch {} }
const OPERATOR_UNLOCKS = [
  { id: 'ranger',   need: 8,  how: 'Survive 8 nights in one Endless run', val: p => p.bestEndlessNights },
  { id: 'sentinel', need: 3,  how: 'Complete Daily Challenges on 3 days', val: p => p.dailyDates.length },
  { id: 'tempest',  need: 12, how: 'Clear 12 missions (any mode)',        val: p => p.missionsCleared },
  { id: 'vandal', need: 1500, how: 'Rack up 1500 total kills.', val: p => p.totalKills },
  { id: 'rampart', need: 8, how: 'Clear 8 strongholds.', val: p => p.strongholdClears },
  { id: 'cinder', need: 18000, how: 'Score 18000 in a single run.', val: p => p.bestRunScore },
  { id: 'vesper', need: 40, how: 'Play 40 games.', val: p => p.gamesPlayed },
  { id: 'howitz', need: 60, how: 'Survive 60 endless nights total.', val: p => p.endlessNightsTotal },
  { id: 'quill', need: 18, how: 'Clear 18 missions in any mode.', val: p => p.missionsCleared },
  { id: 'frost', need: 8, how: 'Win 8 Capture the Flag matches.', val: p => p.ctfWins },
  { id: 'hymn', need: 60, how: 'Rescue 60 captives across the campaign.', val: p => p.totalRescues },
  { id: 'mirage', need: 8, how: 'Win 8 Battle Royale matches.', val: p => p.brWins },
  { id: 'wisp', need: 14, how: 'Play 14 distinct operators.', val: p => p.distinctOperators },
];
function profileUnlocked() { return loadProfile().unlocked.filter(id => charMap[id]); }
// Apply a finished run's progress; toast any operator it just earned.
function recordProgress(up) {
  const p = loadProfile();
  if (up.endlessNights != null) { p.bestEndlessNights = Math.max(p.bestEndlessNights, up.endlessNights); p.endlessNightsTotal += Math.max(0, up.endlessNights | 0); }
  if (up.dailyDate && !p.dailyDates.includes(up.dailyDate)) p.dailyDates.push(up.dailyDate);
  if (up.missionCleared) p.missionsCleared += 1;
  if (up.strongholdClear) p.strongholdClears += 1;
  if (up.kills) p.totalKills += Math.max(0, up.kills | 0);
  if (up.rescues) p.totalRescues += Math.max(0, up.rescues | 0);
  if (up.score != null) p.bestRunScore = Math.max(p.bestRunScore, up.score | 0);
  if (up.gamePlayed) p.gamesPlayed += 1;
  if (up.ctfWin) p.ctfWins += 1;
  if (up.brWin) p.brWins += 1;
  if (Array.isArray(up.operators)) for (const id of up.operators) if (charMap[id] && !p.operatorsPlayed.includes(id)) p.operatorsPlayed.push(id);
  p.distinctOperators = p.operatorsPlayed.length;
  const newly = [];
  for (const u of OPERATOR_UNLOCKS) {
    if (!p.unlocked.includes(u.id) && u.val(p) >= u.need) { p.unlocked.push(u.id); newly.push(u); }
  }
  saveProfile(p);
  pushCloudProfile(); // sync to the account if signed in (debounced, reads the saved profile)
  if (newly.length) playUi('victory');
  newly.forEach((u, i) => {
    const ch = charMap[u.id];
    setTimeout(() => showToast('★ NEW OPERATOR — ' + (ch?.name ?? u.id).toUpperCase(), 4600, true), 140 + i * 1800);
  });
  return newly;
}
// co-op roster base = starters + any milestone-earned operators
function coopRoster() {
  return [...startingRoster, ...profileUnlocked().filter(id => !startingRoster.includes(id))];
}
function strongholdRoster() {
  const s = loadShSave();
  const earned = [...s.chars, ...profileUnlocked()].filter(id => charMap[id] && !startingRoster.includes(id));
  return [...startingRoster, ...new Set(earned)];
}
// Operator gallery status: starter / earned / locked-with-progress.
function operatorStatus(ch) {
  if (ch.starting) return { txt: 'STARTER', on: true };
  if (ch.milestone) {
    const p = loadProfile();
    if (p.unlocked.includes(ch.id)) return { txt: 'EARNED ✓', on: true };
    const u = OPERATOR_UNLOCKS.find(x => x.id === ch.id);
    return u ? { txt: `${u.how} · ${Math.min(u.val(p), u.need)}/${u.need}`, on: false } : { txt: 'Locked', on: false };
  }
  // captive / stronghold-rescued operators
  return loadShSave().chars.includes(ch.id)
    ? { txt: 'UNLOCKED ✓', on: true }
    : { txt: 'Rescue or unlock in the Stronghold campaign', on: false };
}
function renderOperators() {
  const grid = $('opGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const tier = ch => ch.starting ? 0 : ch.milestone ? 2 : 1; // starters · rescues · milestones
  [...characters].sort((a, b) => tier(a) - tier(b)).forEach(ch => {
    const st = operatorStatus(ch);
    const card = document.createElement('div');
    card.className = 'opcard' + (st.on ? '' : ' locked');
    const pc = document.createElement('canvas');
    drawPortrait(pc, ch, 56);
    card.appendChild(pc);
    const meta = document.createElement('div');
    meta.className = 'opmeta';
    meta.innerHTML = `<div class="opname" style="color:${ch.color}">${ch.name.toUpperCase()}</div>`
      + `<div class="opwpn">${ch.weapon.name} · SPD ${ch.speed} · DMG ${ch.weapon.damage}</div>`
      + `<div class="opstat ${st.on ? 'on' : ''}">${st.txt}</div>`;
    card.appendChild(meta);
    grid.appendChild(card);
  });
}
// Records a cleared level; returns 'UNLOCKED — …' toast lines for the caller.
function shRecordClear(def) {
  const n = def?.stronghold?.level ?? (bastionLevels.indexOf(def) + 1);
  if (!(n >= 1)) return [];
  const s = loadShSave();
  const toasts = [];
  if (!s.beaten.includes(n)) s.beaten.push(n);
  const nextN = Math.min(bastionLevels.length, n + 1);
  // never jump more than one level past the current save: a joiner clearing a
  // friend's sh20 on a fresh save advances to 2, not 21 (beaten + character
  // unlocks above/below still record for every participant)
  const was = s.unlocked;
  s.unlocked = Math.max(s.unlocked, Math.min(nextN, s.unlocked + 1));
  if (s.unlocked > was && s.unlocked === nextN) {
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

// ---------- rankings (boards keyed "<category>/<filename-stem>") ----------
// Server builds: GET /api/rankings lists boards {levels:[{key,name,count}]},
// GET /api/rankings/<category>/<stem> returns {entries:[...]}, and POST
// /api/rankings records a LOCAL session's clear (online rooms are recorded
// server-side; the server clamps, rate-limits and stamps online:false).
// Static builds (IS_STATIC) have no server: personal bests live in
// localStorage and the page reads those instead, labelled as local bests.
const BESTS_KEY = 'holdout-hd.bests';     // static: { [levelKey]: [entry...] }
const LASTRUN_KEY = 'holdout-hd.lastrun'; // { key, score, timeS, date } — board highlight
const RANK_CATS = ['daily', 'story', 'stronghold', 'endless', 'classic', 'ctf', 'br'];
const RANK_CAT_LABEL = { daily: 'DAILY CHALLENGE', story: 'STORY', stronghold: 'STRONGHOLD', endless: 'ENDLESS SIEGE', classic: 'CLASSIC', ctf: 'VERSUS — CTF', br: 'VERSUS — ROYALE' };
const pad2 = n => String(n).padStart(2, '0');
const rankSlug = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'level';
let rankIndex = null; // latest GET /api/rankings payload (server builds only)

// levelKey for a def. story/stronghold/classic stems reconstruct exactly from
// def fields (chXX / shXX / levelXX match the level filenames); a def.file or
// def.key stem, if the server ever ships one on /api/levels, always wins.
// ctf/br defs carry no stem: prefer a served board in that category whose
// name matches (online matches are recorded under the true filename stem),
// else fall back to a name slug. Legacy expedition defs have no board.
function levelKeyOf(def) {
  if (!def) return null;
  const cat = def.category ?? (def.chapter || def.story ? 'story'
    : def.mode === 'bastion' ? 'stronghold'
      : def.mode === 'ctf' ? 'ctf'
        : def.mode === 'br' ? 'br'
          : def.expedition ? null : 'classic');
  if (!cat) return null;
  const own = def.file ?? def.key;
  if (own) return String(own).includes('/') ? String(own) : cat + '/' + own;
  const stem = cat === 'story' ? 'ch' + pad2(def.chapter ?? storyLevels.indexOf(def) + 1)
    : cat === 'stronghold' ? 'sh' + pad2(def.stronghold?.level ?? bastionLevels.indexOf(def) + 1)
      : cat === 'classic' ? 'level' + pad2(campaign.indexOf(def) + 1)
        : null;
  if (stem) return cat + '/' + stem;
  // the two locked versus maps ship under filename stems their defs can't
  // reconstruct — pinned so local couch matches land on the same boards as
  // the server's online auto-records from day one
  const pin = RANK_STEM_PIN[cat + '/' + def.name];
  if (pin) return cat + '/' + pin;
  const inCat = (rankIndex?.levels ?? []).filter(l => typeof l.key === 'string' && l.key.startsWith(cat + '/'));
  const hit = inCat.find(l => l.name === def.name) ?? (inCat.length === 1 ? inCat[0] : null);
  return hit ? hit.key : cat + '/' + rankSlug(def.name);
}
const RANK_STEM_PIN = { 'ctf/Twin Relays': 'level21-ctf', 'br/The Shattering': 'level22-br' };
// key -> def, for display names of boards the server hasn't listed (yet)
const rankKeyDef = new Map();
for (const d of levels) {
  const k = levelKeyOf(d);
  if (k && !rankKeyDef.has(k)) rankKeyDef.set(k, d);
}
function rankNameOf(key) {
  const def = rankKeyDef.get(key);
  return def ? String(def.stronghold?.name ?? def.title ?? def.name ?? key) : (key.split('/')[1] ?? key);
}

function loadBests() {
  try {
    const b = JSON.parse(localStorage.getItem(BESTS_KEY));
    if (b && typeof b === 'object' && !Array.isArray(b)) return b;
  } catch {}
  return {};
}
function loadLastRun() {
  try { return JSON.parse(localStorage.getItem(LASTRUN_KEY)) || null; } catch { return null; }
}
const RANK_ORDER = {
  score: (a, b) => (b.score - a.score) || (a.timeS - b.timeS), // the server's board order
  fastest: (a, b) => (a.timeS - b.timeS) || (b.score - a.score),
};
async function refreshRankIndex() {
  if (IS_STATIC) return null;
  try {
    const res = await fetch('/api/rankings');
    if (res.ok) rankIndex = await res.json();
  } catch {} // older server / offline: the page degrades to saves-only rows
  return rankIndex;
}
// warm the index early (server builds): versus key matching + first picker paint
if (!IS_STATIC) refreshRankIndex();

// One local clear -> one board entry. Toasts RUN RECORDED — #rank when the
// run places top 50 (the toast is deferred a beat: the results dialog that
// opens in the same tick clears the toast queue as every screen change does).
async function submitRun(def, names, players, score, timeS, opts = {}) {
  if (demoMode) return;
  // unpinned versus maps resolve their key against the served board index —
  // make sure it's loaded before deriving (no-op for static/known stems)
  const cat = def?.category ?? def?.mode;
  if (!IS_STATIC && (cat === 'ctf' || cat === 'br') && !rankIndex) await refreshRankIndex();
  // opts.key forces the board (Endless Siege records onto its own endless/<stem>
  // board rather than the map's campaign clear board).
  const key = opts.key || levelKeyOf(def);
  if (!key) return;
  const label = String(def.stronghold?.name ?? def.name ?? key).toUpperCase();
  const entry = {
    names: names.slice(0, 8).map(n => String(n).slice(0, 12)),
    players: Math.max(1, Math.min(8, Math.round(players) || 1)),
    score: Math.max(0, Math.round(score) || 0),
    timeS: Math.max(0, Math.round((Number(timeS) || 0) * 10) / 10),
    date: new Date().toISOString(),
    online: false,
  };
  try { localStorage.setItem(LASTRUN_KEY, JSON.stringify({ key, score: entry.score, timeS: entry.timeS, date: entry.date })); } catch {}
  if (IS_STATIC) {
    const bests = loadBests();
    const list = [...(Array.isArray(bests[key]) ? bests[key] : []), entry]
      .sort(RANK_ORDER.score).slice(0, 50);
    bests[key] = list;
    try { localStorage.setItem(BESTS_KEY, JSON.stringify(bests)); } catch {}
    const rank = list.indexOf(entry) + 1;
    if (rank >= 1) setTimeout(() => showToast(`RUN RECORDED — #${rank} ${label}`, 3200, true), 60);
    return;
  }
  try {
    const res = await fetch('/api/rankings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, names: entry.names, players: entry.players, score: entry.score, timeS: entry.timeS }),
    });
    if (!res.ok) return; // rate-limited / rejected — never breaks a clear
    const out = await res.json().catch(() => null);
    const rank = Number(out?.rank);
    if (Number.isFinite(rank) && rank >= 1 && rank <= 50) {
      showToast(`RUN RECORDED — #${rank} ${label}`, 3200, true);
    }
  } catch {} // network hiccup: the run is simply not recorded
}

// boards worth listing even with no entries yet: where the current saves are
function saveLevelKeys() {
  const keys = new Set();
  const add = def => { const k = levelKeyOf(def); if (k) keys.add(k); };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && campaign.length) add(campaign[Math.max(0, Math.min(s.levelIdx ?? 0, campaign.length - 1))]);
  } catch {}
  try {
    const s = JSON.parse(localStorage.getItem(STORY_KEY));
    if (s && storyLevels.length) add(storyLevels[Math.max(0, Math.min((s.chapter ?? 1) - 1, storyLevels.length - 1))]);
  } catch {}
  const sh = loadShSave();
  bastionLevels.forEach((lvl, i) => { if ((lvl.stronghold?.level ?? i + 1) <= sh.unlocked) add(lvl); });
  return keys;
}

// ---------- rankings UI (pageRank picker -> pageRankBoard) ----------
let rankBoardKey = null, rankBoardName = '', rankSort = 'score', rankEntries = null;
async function renderRankPicker() {
  const host = $('rankGroups');
  const note = $('rankNote');
  note.hidden = !IS_STATIC;
  note.textContent = IS_STATIC
    ? 'Static build — these are this machine’s local bests, not shared online rankings.'
    : ' ';
  host.innerHTML = '<div class="rgrp">LOADING…</div>';
  let boards;
  if (IS_STATIC) {
    boards = Object.entries(loadBests())
      .filter(([, list]) => Array.isArray(list))
      .map(([key, list]) => ({ key, name: rankNameOf(key), count: list.length }));
  } else {
    await refreshRankIndex();
    boards = (rankIndex?.levels ?? []).filter(l => l && typeof l.key === 'string')
      .map(l => ({ key: l.key, name: String(l.name || rankNameOf(l.key)), count: Math.max(0, Math.round(l.count) || 0) }));
  }
  if (menuPageId !== 'pageRank') return; // the page changed while fetching
  // the current saves' levels join the list so the boards you're playing
  // toward are reachable before anyone records a run on them
  const have = new Set(boards.map(b => b.key));
  for (const key of saveLevelKeys()) {
    if (!have.has(key)) boards.push({ key, name: rankNameOf(key), count: 0 });
  }
  host.innerHTML = '';
  const catOf = key => RANK_CATS.find(c => key.startsWith(c + '/')) ?? 'other';
  for (const cat of [...RANK_CATS, 'other']) {
    const group = boards.filter(b => catOf(b.key) === cat)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    if (!group.length) continue;
    const h = document.createElement('div');
    h.className = 'rgrp';
    h.textContent = RANK_CAT_LABEL[cat] ?? cat.toUpperCase();
    host.appendChild(h);
    for (const b of group) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rlev';
      const nm = document.createElement('span');
      nm.textContent = b.name;
      const ct = document.createElement('b');
      ct.textContent = b.count ? `${b.count} ${b.count === 1 ? 'RUN' : 'RUNS'}` : '—';
      btn.append(nm, ct);
      btn.onclick = e => {
        e.currentTarget.blur();
        playUi('select');
        rankBoardKey = b.key;
        rankBoardName = b.name;
        rankEntries = null;
        showMenuPage('pageRankBoard');
      };
      host.appendChild(btn);
    }
  }
  if (!boards.length) {
    host.innerHTML = '<div class="rgrp">NO RECORDED RUNS YET — CLEAR A LEVEL TO OPEN ITS BOARD</div>';
  }
}
async function renderRankBoard() {
  if (!rankBoardKey) return showMenuPage('pageRank');
  $('rankBoardTitle').textContent = rankBoardName || 'Rankings';
  $('rankBoardSub').textContent =
    (RANK_CAT_LABEL[rankBoardKey.split('/')[0]] ?? rankBoardKey.split('/')[0].toUpperCase())
    + (IS_STATIC ? ' · LOCAL BESTS' : ' · TOP 50');
  $('btnRankSort').textContent = `Sort: ${rankSort === 'score' ? 'Score' : 'Fastest'}`;
  const host = $('rankTable');
  if (!rankEntries) {
    host.innerHTML = '<div class="rgrp">LOADING…</div>';
    if (IS_STATIC) {
      rankEntries = (loadBests()[rankBoardKey] ?? []).slice();
    } else {
      try {
        const res = await fetch('/api/rankings/' + rankBoardKey);
        rankEntries = res.ok ? ((await res.json())?.entries ?? []) : [];
      } catch { rankEntries = []; }
    }
    if (menuPageId !== 'pageRankBoard') return; // backed out while fetching
  }
  const rows = rankEntries.filter(e => e && typeof e === 'object')
    .slice().sort(RANK_ORDER[rankSort] ?? RANK_ORDER.score).slice(0, 50);
  host.innerHTML = '';
  if (!rows.length) {
    host.innerHTML = '<div class="rgrp">NO RUNS RECORDED ON THIS BOARD YET</div>';
    return;
  }
  // Endless + Daily boards rank by nights survived: the stored score is
  // nights*1e5 + in-run score, so the SCORE column decodes back to "Night N".
  const isEndless = String(rankBoardKey).startsWith('endless/') || String(rankBoardKey).startsWith('daily/');
  const head = document.createElement('div');
  head.className = 'rrowt head';
  for (const c of ['#', 'NAMES', 'PL', isEndless ? 'NIGHTS' : 'SCORE', 'TIME', 'DATE']) {
    const s = document.createElement('span');
    s.textContent = c;
    head.appendChild(s);
  }
  host.appendChild(head);
  // your latest run: an exact lastRun match wins; otherwise the newest entry
  // carrying your name (covers online clears the server recorded for you)
  const lastRun = loadLastRun();
  const myName = ($('nameInput').value.trim() || 'P1').toLowerCase();
  let mine = lastRun && lastRun.key === rankBoardKey
    ? rows.find(e => e.score === lastRun.score && e.timeS === lastRun.timeS)
    : null;
  mine ??= rows.filter(e => (e.names ?? []).some(n => String(n).toLowerCase() === myName))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))[0] ?? null;
  const fmtT = s => {
    const t = Math.max(0, Number(s) || 0);
    return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  };
  rows.forEach((e, i) => {
    // rows are inert BUTTONS so the pad focus ring can walk them: navTick
    // treats every visible button as a nav target and setNavFocus
    // scrollIntoViews the ring — a pad-only couch can reach row 50 of a
    // full board (FIRE on a row is a no-op; Sort/Back stay in the cycle)
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'rrowt' + (e === mine ? ' mine' : '');
    // 32-player ctf entries can carry 16 winner names — show the first few
    // and fold the rest into '+N more' so the row never explodes
    // the server stores at most 8 real names plus a literal '+N more' tail —
    // strip the tail and fold from the true player count instead
    const names = (Array.isArray(e.names) ? e.names : []).map(n => String(n)).filter(n => !/^\+\d+ more$/.test(n));
    const total = Math.max(Number(e.players) || 0, names.length);
    const nameTxt = total > 4
      ? `${names.slice(0, 4).join(', ')} +${total - 4} more`
      : (names.join(', ') || '—');
    const cells = [
      '#' + (i + 1),
      nameTxt,
      String(e.players ?? (Array.isArray(e.names) ? e.names.length : 1)),
      isEndless ? 'Night ' + Math.floor((Number(e.score) || 0) / 100000) : (Number(e.score) || 0).toLocaleString(),
      fmtT(e.timeS),
      String(e.date ?? '').slice(0, 10) || '—',
    ];
    for (const c of cells) {
      const s = document.createElement('span');
      s.textContent = c;
      row.appendChild(s);
    }
    host.appendChild(row);
  });
}

// ---------- public room browser (Online > Browse Games) ----------
// GET /api/rooms lists joinable PUBLIC rooms: lobby-phase rooms always, plus
// CTF rooms joinable mid-match (joinableNow) — those get a LIVE tag. The list
// auto-refreshes every 5s while the page is open; rows are pad-navigable
// buttons and a press joins through the existing NetSession join flow.
const BROWSE_MODE_LABEL = { classic: 'CLASSIC', story: 'STORY', bastion: 'STRONGHOLD', ctf: 'CTF', br: 'ROYALE' };
let browseTimer = null;
let browseSeq = 0; // stale-fetch guard: only the newest request may render
function stopBrowse() {
  if (browseTimer) { clearInterval(browseTimer); browseTimer = null; }
  browseSeq++;
}
function startBrowse() {
  stopBrowse();
  renderBrowse();
  browseTimer = setInterval(() => {
    // left the page / joined a game: the interval reaps itself
    if (menuPageId !== 'pageBrowse' || $('menu').hidden || session) return stopBrowse();
    renderBrowse();
  }, 5000);
}
async function renderBrowse() {
  const seq = ++browseSeq;
  let list = [];
  let failed = false;
  try {
    const res = await fetch('/api/rooms');
    if (res.ok) {
      const d = await res.json();
      list = Array.isArray(d) ? d : Array.isArray(d?.rooms) ? d.rooms : [];
    } // non-ok (older server, no endpoint yet): graceful empty state below
  } catch { failed = true; } // server down entirely: say so instead
  if (seq !== browseSeq || menuPageId !== 'pageBrowse' || $('menu').hidden) return;
  const host = $('browseList');
  // a refresh rebuilds the rows — re-aim the pad focus ring at the same room
  // so auto-refresh never yanks navigation back to the top
  const focusCode = navEl?.dataset?.room ?? null;
  host.innerHTML = '';
  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'bempty';
    d.textContent = failed ? 'SERVER UNREACHABLE — TRY A ROOM CODE INSTEAD' : 'NO OPEN GAMES — HOST ONE!';
    host.appendChild(d);
    return;
  }
  for (const r of list) {
    if (!r || typeof r !== 'object' || !r.code) continue;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'brow';
    row.dataset.room = String(r.code);
    const live = !!r.joinableNow && !!r.phase && r.phase !== 'lobby';
    const mode = document.createElement('i');
    mode.className = 'bmode';
    mode.textContent = BROWSE_MODE_LABEL[r.mode] ?? String(r.mode || '?').toUpperCase();
    const map = document.createElement('span');
    map.className = 'bmap';
    map.textContent = String(r.levelTitle || r.levelName || '—');
    const count = document.createElement('span');
    count.className = 'bcount';
    count.textContent = `${r.players ?? '?'}/${r.cap ?? roomCapOf(r.mode)}`;
    row.append(mode, map, count);
    if (live) {
      const tag = document.createElement('i');
      tag.className = 'blive';
      tag.textContent = 'LIVE';
      row.appendChild(tag);
    }
    row.onclick = e => {
      e.currentTarget.blur();
      if (session) return;
      playUi('select');
      stopBrowse();
      session = new NetSession('join', String(r.code).toUpperCase());
    };
    host.appendChild(row);
  }
  if (focusCode) {
    const again = [...host.querySelectorAll('button.brow')].find(b => b.dataset.room === focusCode);
    if (again) setNavFocus(again);
  }
}

// ---------- menu pages (MAIN / SINGLEPLAYER / VERSUS / ONLINE / SETTINGS /
// REMAP / STRONGHOLD SELECT / BROWSE) — DOM screens inside #menu, pad-navigable ----
const MENU_PARENT = {
  pageSingle: 'pageMain', pageVersus: 'pageMain', pageOnline: 'pageMain',
  pageSettings: 'pageMain', pageRemap: 'pageSettings', pageSh: 'pageSingle',
  pageRank: 'pageMain', pageRankBoard: 'pageRank', pageBrowse: 'pageOnline',
  pageOperators: 'pageMain', pageAccount: 'pageMain',
};
let menuPageId = 'pageMain';
let shPurpose = 'local'; // why the level select is open: 'local' | 'host'
let shEndless = false; // Endless Siege toggle on the stronghold select screen
function showMenuPage(id) {
  menuPageId = id;
  for (const el of document.querySelectorAll('#menu .mpage')) el.hidden = el.id !== id;
  cancelRemapListen();
  setNavFocus(null); // navTick re-picks a default focus on the new page
  if (id === 'pageSh') renderShGrid();
  if (id === 'pageSettings') renderCtrlReadout?.(); // refresh the controller list (pads hot-plug)
  if (id === 'pageRemap') renderRemap();
  if (id === 'pageRank') renderRankPicker();      // async: fills in when fetched
  if (id === 'pageRankBoard') renderRankBoard();  // async: fills in when fetched
  if (id === 'pageBrowse') startBrowse();         // 5s auto-refresh while open
  else stopBrowse();
  if (id === 'pageOperators') renderOperators();
  // re-trigger the entrance animation on the page that just became visible
  const pg = $(id);
  if (pg) { pg.classList.remove('anim-in'); void pg.offsetWidth; pg.classList.add('anim-in'); }
}
// pageSh opens from Singleplayer (shPurpose 'local') AND from Online's Host
// Stronghold ('host') — Back must return to whichever page opened it, so the
// static MENU_PARENT/data-back target is overridden for pageSh specifically.
const shBackTarget = () => shPurpose === 'host' ? 'pageOnline' : 'pageSingle';
// pad B / Escape: one page back. Returns false on the main page (no-op).
function menuBack() {
  const parent = menuPageId === 'pageSh' ? shBackTarget() : MENU_PARENT[menuPageId];
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
  // Endless Siege toggle: when on, picking any unlocked stronghold launches it
  // as a never-ending escalating holdout (ranked by nights survived) instead of
  // the fixed campaign. Reuses every stronghold map, lobby and roster.
  const eb = $('btnShEndless');
  if (eb) {
    const paintEndless = () => {
      eb.textContent = 'Mode: ' + (shEndless ? 'Endless Siege ∞' : 'Campaign');
      eb.classList.toggle('on', shEndless);
      $('shSub').textContent = shEndless
        ? 'ENDLESS — hold any stronghold through escalating nights · ranked by nights survived'
        : (shPurpose === 'host'
          ? 'pick a stronghold to host online — only your unlocked levels are offered'
          : 'beat a stronghold to unlock the next · new operatives join the roster');
    };
    paintEndless();
    eb.onclick = e => { e.currentTarget.blur(); shEndless = !shEndless; playUi('select'); paintEndless(); };
  }
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
      startStronghold(idx, shEndless);
    };
    grid.appendChild(card);
  });
}
function startStronghold(idx, endless = false) {
  if (session) return;
  playUi('select');
  if (shPurpose === 'host') {
    session = new NetSession('host', '', 'bastion', idx, { endless });
  } else {
    session = new LocalSession(null, { mode: 'bastion', levelIdx: idx, endless });
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
    row.className = 'rrow' + (binds[remapDev] && a in binds[remapDev] ? ' custom' : ''); // null (unbound) is custom too
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
// One physical key/button per action per device: after (dev, action) takes a
// code, every OTHER action on that device that resolves to the same code
// loses it. A conflicting custom override is dropped (its default returns —
// unless the default is the same code); a conflicting DEFAULT binding gets an
// explicit null override, which applyBinds treats as unbound ('—' in the UI).
// Reset-to-defaults deletes the whole device key, clearing nulls too.
function unbindConflicts(dev, action) {
  const o = binds[dev];
  const code = o?.[action];
  if (code == null) return;
  const defs = dev === 'pad' ? PAD_DEF : dev === 'kb1' ? KB1_DEF : KB2_DEF;
  for (const a of ACTIONS) {
    if (a === action) continue;
    const live = a in o ? (o[a] != null ? [o[a]] : []) : (defs[a] ?? []);
    if (!live.includes(code)) continue;
    if (a in o && !(defs[a] ?? []).includes(code)) delete o[a]; // default returns, conflict-free
    else o[a] = null; // the default holds this code — explicitly unbound
    showToast(`UNBOUND ${ACTION_LABEL[a] ?? a.toUpperCase()} — ${(dev === 'pad' ? padLabel : keyLabel)(code)} REASSIGNED`, 2600, true);
  }
}
function remapKeyCapture(e) {
  if (!remapListen || remapListen.dev === 'pad' || e.repeat) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code !== 'Escape') {
    (binds[remapListen.dev] ??= {})[remapListen.action] = e.code;
    unbindConflicts(remapListen.dev, remapListen.action);
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
        unbindConflicts('pad', remapListen.action);
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
  // Save & Quit bookmark: Resume Game shows only while the slot parses and
  // the sim can actually restore it (older shared/game.js = no offer)
  $('btnResumeGame').hidden = !(loadSuspend() && typeof gameMod.restoreGame === 'function');
  $('btnContinue').hidden = !localStorage.getItem(SAVE_KEY);
  $('btnStory').hidden = !storyLevels.length;
  $('btnStoryContinue').hidden = !storyLevels.length || !localStorage.getItem(STORY_KEY);
  $('btnHostStory').hidden = !storyLevels.length;
  // versus/stronghold buttons only exist once their mode maps ship
  $('btnBastion').hidden = !bastionLevels.length;
  $('btnHostBastion').hidden = !bastionLevels.length;
  $('btnHostDaily').hidden = !bastionLevels.length;
  $('btnCtf').hidden = !ctfLevels.length;
  $('btnHostCtf').hidden = !ctfLevels.length;
  $('btnBr').hidden = !brLevels.length;
  $('btnSiege').hidden = !siegeLevels.length;
  $('btnFamily').hidden = !familyLevels.length;
  $('btnHostBr').hidden = !brLevels.length;
  // visibility toggles and the browser need a live server (static builds
  // have no online play at all); the couch map cycler works everywhere
  $('btnVisCoop').hidden = IS_STATIC;
  $('btnVisVersus').hidden = IS_STATIC || (!ctfLevels.length && !brLevels.length);
  $('btnBrowse').hidden = IS_STATIC;
  $('btnCtfMap').hidden = IS_STATIC || ctfLevels.length < 2; // map choice needs 2+ ctf maps
  $('btnCtfMapV').hidden = ctfLevels.length < 2;
  // back on the menu with the level select up: re-read unlock/beaten states
  if (menuPageId === 'pageSh' && !$('menu').hidden) renderShGrid();
}
refreshContinue();

// page navigation buttons + every Back control (mouse path; pad B mirrors it)
$('btnSingle').onclick = e => { e.currentTarget.blur(); showMenuPage('pageSingle'); };
$('btnVersus').onclick = e => { e.currentTarget.blur(); showMenuPage('pageVersus'); };
$('btnOnline').onclick = e => { e.currentTarget.blur(); showMenuPage('pageOnline'); };
// Daily Challenge: today's UTC date seeds the same map + twist for everyone,
// played as an endless siege onto a shared daily board. Couch-local launch.
const todayUTC = () => new Date().toISOString().slice(0, 10);
function startDaily() {
  if (session) return;
  const dateStr = todayUTC();
  const spec = dailyChallenge(dateStr, bastionLevels.length);
  const baseLvl = bastionLevels[spec.mapIdx];
  if (!baseLvl) return;
  playUi('select');
  const def = { ...baseLvl, bastion: { ...(baseLvl.bastion || {}), endless: true, ...spec.mods } };
  session = new LocalSession(null, { mode: 'bastion', endless: true, daily: { dateStr, label: spec.label, def } });
  session.lobby();
}
function paintDaily() {
  const b = $('btnDaily'); if (!b) return;
  const spec = dailyChallenge(todayUTC(), bastionLevels.length);
  const map = bastionLevels[spec.mapIdx];
  b.textContent = `Daily Challenge — ${spec.label}`;
  if (map) b.title = `${map.stronghold?.name ?? map.name} · ${spec.label} · ${todayUTC()}`;
}
$('btnDaily').onclick = e => { e.currentTarget.blur(); startDaily(); };
paintDaily();

// --- Tutorial coach: a scripted first mission teaching the core verbs -------
// Reuses level 1 (Outer Barricade) untimed, with an on-screen coach that
// advances as the new player moves, fires, rescues the pinned marksman, and
// extracts. No saves, no rankings — just onboarding.
let tut = null; // { step, kills, rescued, moved, lastPos } while a tutorial runs
const TUTORIAL_STEPS = [
  { text: '① MOVE — left stick, or WASD / Arrow keys', ok: 'Moving!', done: () => tut.moved > TILE * 5 },
  { text: '② HOLD FIRE to break the cordon — RT · Space · Enter', ok: 'Nice shooting!', done: () => tut.kills >= 2 },
  { text: '③ RESCUE — walk into the pinned marksman to free them', ok: 'Rescued!', done: () => tut.rescued >= 1 },
  { text: '④ EXTRACT — reach the glowing exit', ok: '', done: (snap) => snap.status === 'cleared' },
];
function startTutorial() {
  if (session) return;
  playUi('select');
  const base = campaign[0]; // move → fight → rescue → extract, all in one small map
  const def = { ...base, untimed: true, name: 'Tutorial' };
  tut = { step: 0, kills: 0, rescued: 0, moved: 0, lastPos: null };
  session = new LocalSession(null, { tutorial: true, tutorialDef: def });
  session.lobby();
}
function tutorialEvent(ev) { // funneled from handleEvent while a tutorial runs
  if (!tut) return;
  if (ev.type === 'die') tut.kills++;
  else if (ev.type === 'pickup') tut.rescued++;
}
function endTutorialCoach() { tut = null; const el = $('tutorialCoach'); if (el) el.hidden = true; }
function tutorialTick(snap) {
  const el = $('tutorialCoach');
  if (!tut || !el) { if (el) el.hidden = true; return; }
  // accumulate the local operator's travel for the MOVE step
  const mine = session.focusPids?.() ?? new Set();
  const me = (snap.players || []).find(p => mine.has(p.pid)) || (snap.players || [])[0];
  if (me) {
    if (tut.lastPos) tut.moved += Math.hypot(me.x - tut.lastPos.x, me.y - tut.lastPos.y);
    tut.lastPos = { x: me.x, y: me.y };
  }
  const step = TUTORIAL_STEPS[tut.step];
  if (!step) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = step.text;
  if (step.done(snap)) {
    if (step.ok) showToast('✓ ' + step.ok, 1500, true);
    playUi('victory');
    tut.step++;
    el.classList.add('ok');
    setTimeout(() => el.classList.remove('ok'), 600);
  }
}
$('btnTutorial').onclick = e => { e.currentTarget.blur(); startTutorial(); };
$('btnBrowse').onclick = e => { e.currentTarget.blur(); showMenuPage('pageBrowse'); };
// room visibility toggles (Online page): cycle Public/Private per mode group,
// persisted; the choice rides the next host message's explicit public flag
const visSync = () => {
  $('btnVisCoop').textContent = `Co-op visibility: ${visOf('coop') === 'public' ? 'Public' : 'Private'}`;
  $('btnVisVersus').textContent = `Versus visibility: ${visOf('versus') === 'public' ? 'Public' : 'Private'}`;
};
for (const [btn, grp] of [['btnVisCoop', 'coop'], ['btnVisVersus', 'versus']]) {
  $(btn).onclick = e => {
    e.currentTarget.blur();
    visPrefs[grp] = visOf(grp) === 'public' ? 'private' : 'public';
    try { localStorage.setItem(VIS_KEY, JSON.stringify(visPrefs)); } catch {}
    visSync();
  };
}
visSync();
// ctf map choice (2+ maps): cycles through the ctf list, persisted; rides the
// host message levelIdx (stronghold pattern) and the local couch CTF lobby
const CTFMAP_KEY = 'holdout-hd.ctfmap';
let ctfMapIdx = Math.max(0, Math.min(Math.max(0, ctfLevels.length - 1), Math.floor(+(localStorage.getItem(CTFMAP_KEY) ?? 0)) || 0));
const ctfMapSync = () => {
  const label = `CTF map: ${ctfLevels[ctfMapIdx]?.name ?? '—'}`;
  $('btnCtfMap').textContent = label;
  $('btnCtfMapV').textContent = label; // versus-page mirror (couch CTF uses the same pick)
};
for (const id of ['btnCtfMap', 'btnCtfMapV']) $(id).onclick = e => {
  e.currentTarget.blur();
  if (!ctfLevels.length) return;
  ctfMapIdx = (ctfMapIdx + 1) % ctfLevels.length;
  try { localStorage.setItem(CTFMAP_KEY, String(ctfMapIdx)); } catch {}
  ctfMapSync();
};
ctfMapSync();
$('btnRankings').onclick = e => { e.currentTarget.blur(); showMenuPage('pageRank'); };
$('btnOperators').onclick = e => { e.currentTarget.blur(); showMenuPage('pageOperators'); };

// --- Account: register / sign in, cloud-sync the milestone profile -----------
let authUser = null;
function acctMsg(t, err) { const e = $('acctMsg'); if (e) { e.textContent = t || ' '; e.style.color = err ? '#ff7a6a' : '#5fd2b4'; } }
function paintAccount() {
  if (!$('pageAccount')) return;
  $('acctForms').hidden = !!authUser;
  $('acctSignedIn').hidden = !authUser;
  if (authUser) $('acctWho').textContent = `Signed in as ${authUser.name}`;
}
// Merge two profiles: best of each stat, union of the id/date arrays — so logging
// in on a new device keeps both local and cloud progress.
function mergeProfiles(a, b) {
  const out = { ...a };
  for (const k of ['bestEndlessNights', 'missionsCleared', 'strongholdClears', 'totalKills', 'totalRescues', 'bestRunScore', 'gamesPlayed', 'endlessNightsTotal', 'ctfWins', 'brWins'])
    out[k] = Math.max(a[k] || 0, b[k] || 0);
  out.dailyDates = [...new Set([...(a.dailyDates || []), ...(b.dailyDates || [])])];
  out.operatorsPlayed = [...new Set([...(a.operatorsPlayed || []), ...(b.operatorsPlayed || [])])].filter(id => charMap[id]);
  out.unlocked = [...new Set([...(a.unlocked || []), ...(b.unlocked || [])])].filter(id => charMap[id]);
  return out;
}
let cloudPushT = null;
function pushCloudProfile() {
  if (!authUser || IS_STATIC) return;
  clearTimeout(cloudPushT);
  cloudPushT = setTimeout(() => {
    fetch('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: loadProfile() }) }).catch(() => {});
  }, 800);
}
async function pullCloudProfile() {
  try {
    const r = await fetch('/api/profile'); if (!r.ok) return; const j = await r.json();
    if (j.profile && typeof j.profile === 'object') {
      const merged = mergeProfiles(loadProfile(), j.profile);
      saveProfile(merged);
      clearTimeout(cloudPushT); // push the union straight back so the cloud has everything
      fetch('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: merged }) }).catch(() => {});
      if (!$('menu').hidden) renderOperators(); // refresh the gallery if it's open
    }
  } catch {}
}
async function refreshAuth() {
  const b = $('btnAccount');
  if (IS_STATIC) { if (b) b.hidden = true; return; }
  if (b) b.hidden = false;
  try {
    const r = await fetch('/api/auth/me'); const j = await r.json();
    authUser = j.user || null;
    if (authUser) { const ni = $('nameInput'); if (ni) ni.value = authUser.name; await pullCloudProfile(); }
  } catch {}
  paintAccount();
}
async function acctSubmit(path) {
  const name = $('acctName').value.trim(), password = $('acctPass').value;
  if (!name || !password) return acctMsg('enter a username and password', true);
  acctMsg('…');
  try {
    const r = await fetch('/api/auth/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password }) });
    const j = await r.json();
    if (!r.ok) return acctMsg(j.error || 'failed', true);
    authUser = j.user; $('acctPass').value = '';
    const ni = $('nameInput'); if (ni) ni.value = authUser.name;
    if (path === 'register') { pushCloudProfile(); acctMsg('account created — your progress will sync'); }
    else { await pullCloudProfile(); acctMsg('signed in — progress synced'); }
    paintAccount();
  } catch { acctMsg('network error', true); }
}
if ($('btnAccount')) {
  $('btnAccount').onclick = e => { e.currentTarget.blur(); showMenuPage('pageAccount'); paintAccount(); acctMsg(''); };
  $('btnRegister').onclick = e => { e.currentTarget.blur(); acctSubmit('register'); };
  $('btnLogin').onclick = e => { e.currentTarget.blur(); acctSubmit('login'); };
  $('btnSyncNow').onclick = e => { e.currentTarget.blur(); pullCloudProfile(); acctMsg('syncing…'); };
  $('btnLogout').onclick = async e => { e.currentTarget.blur(); try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {} authUser = null; paintAccount(); acctMsg('signed out'); };
  $('acctPass').addEventListener('keydown', ev => { if (ev.key === 'Enter') acctSubmit('login'); });
}
refreshAuth();
$('btnSettings').onclick = e => { e.currentTarget.blur(); showMenuPage('pageSettings'); };
// native desktop (Electron) shell: a real Quit-to-Desktop button on the main menu
if (window.anchorfallDesktop?.isDesktop) {
  const q = $('btnQuitDesktop');
  if (q) { q.hidden = false; q.onclick = e => { e.currentTarget.blur(); window.anchorfallDesktop.quit(); }; }
}
$('btnRemap').onclick = e => { e.currentTarget.blur(); showMenuPage('pageRemap'); };
// rankings board: toggle score-order <-> fastest-order (entries are cached,
// so the toggle re-sorts without refetching)
$('btnRankSort').onclick = e => {
  e.currentTarget.blur();
  rankSort = rankSort === 'score' ? 'fastest' : 'score';
  renderRankBoard();
};
for (const b of document.querySelectorAll('#menu .mback')) {
  b.onclick = e => {
    e.currentTarget.blur();
    // pageSh's data-back is static — route by who opened it instead
    showMenuPage(menuPageId === 'pageSh' ? shBackTarget()
      : (b.dataset.back || MENU_PARENT[menuPageId] || 'pageMain'));
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
// splitscreen mode: Off -> Dynamic -> Always (persisted; default Dynamic)
const splitSync = () => { $('btnSplitscreen').textContent = `Splitscreen: ${SPLIT_LABEL[splitMode]}`; };
$('btnSplitscreen').onclick = e => {
  e.currentTarget.blur();
  splitMode = SPLIT_MODES[(SPLIT_MODES.indexOf(splitMode) + 1) % SPLIT_MODES.length];
  try { localStorage.setItem(SPLIT_KEY, splitMode); } catch {}
  splitSync();
};
splitSync();
// game zoom: 100% -> 115% -> 130% -> 150% (persisted; pad-cyclable like the
// splitscreen button). Scales every camera's zoom bounds in render.js so the
// world reads larger on couch TVs — single view and split views alike.
const ZOOM_KEY = 'holdout-hd.zoom';
const ZOOM_STEPS = [25, 50, 75, 100, 150, 200];
const ZOOM_DEFAULT = 150; // 150% reads best; new players start here
let gameZoom = +(localStorage.getItem(ZOOM_KEY) || ZOOM_DEFAULT);
if (!ZOOM_STEPS.includes(gameZoom)) gameZoom = ZOOM_DEFAULT;
const zoomSync = () => {
  $('btnGameZoom').textContent = `Game zoom: ${gameZoom}%`;
  renderMod.setViewZoom?.(gameZoom / 100); // applied on boot + every change
};
$('btnGameZoom').onclick = e => {
  e.currentTarget.blur();
  gameZoom = ZOOM_STEPS[(ZOOM_STEPS.indexOf(gameZoom) + 1) % ZOOM_STEPS.length];
  try { localStorage.setItem(ZOOM_KEY, String(gameZoom)); } catch {}
  zoomSync();
};
zoomSync();

// ---------- Display: display mode (desktop) + aspect-ratio letterbox ----------
// (a) Display mode — Fullscreen / Borderless / Windowed — only meaningful in the
// native Electron shell, so the button hides in the browser. Cycles on
// click/FIRE and LEFT/RIGHT (data-cycle), persisted, and calls the bridge.
const DISPLAY_KEY = 'holdout-hd.displaymode';
const DISPLAY_MODES = ['fullscreen', 'borderless', 'windowed'];
const DISPLAY_LABEL = { fullscreen: 'Fullscreen', borderless: 'Borderless', windowed: 'Windowed' };
const isDesktopShell = !!window.anchorfallDesktop?.isDesktop;
let displayMode = localStorage.getItem(DISPLAY_KEY) || 'fullscreen';
if (!DISPLAY_MODES.includes(displayMode)) displayMode = 'fullscreen';
const displaySync = () => { $('btnDisplayMode').textContent = `Display mode: ${DISPLAY_LABEL[displayMode]}`; };
function cycleDisplayMode(dir = 1) {
  const i = DISPLAY_MODES.indexOf(displayMode);
  displayMode = DISPLAY_MODES[mod(i + dir, DISPLAY_MODES.length)];
  try { localStorage.setItem(DISPLAY_KEY, displayMode); } catch {}
  displaySync();
  window.anchorfallDesktop?.setDisplayMode?.(displayMode);
}
if (isDesktopShell) {
  $('btnDisplayMode').hidden = false;
  $('btnDisplayMode').onclick = e => { e.currentTarget.blur(); cycleDisplayMode(1); };
  displaySync();
  // push the persisted choice to the shell on boot so it matches the UI
  window.anchorfallDesktop?.setDisplayMode?.(displayMode);
}

// (b) Aspect ratio — Auto (fill) / 16:9 / 16:10 / 4:3 / 21:9 — constrains the
// #center canvas box to the chosen aspect, centered with black bars
// (letterbox/pillarbox). fitStage already reads the canvas box, so the canvas
// resolution follows. Works in browser AND desktop. Persisted.
const ASPECT_KEY = 'holdout-hd.aspect';
const ASPECT_MODES = ['auto', '16:9', '16:10', '4:3', '21:9'];
const ASPECT_LABEL = { auto: 'Auto (fill)', '16:9': '16:9', '16:10': '16:10', '4:3': '4:3', '21:9': '21:9' };
const ASPECT_RATIO = { '16:9': 16 / 9, '16:10': 16 / 10, '4:3': 4 / 3, '21:9': 21 / 9 };
let aspectMode = localStorage.getItem(ASPECT_KEY) || 'auto';
if (!ASPECT_MODES.includes(aspectMode)) aspectMode = 'auto';
function applyAspect() {
  const centerEl = document.getElementById('center');
  const r = ASPECT_RATIO[aspectMode];
  if (!r) {
    // Auto: fill — the classic no-letterbox behavior.
    canvas.style.aspectRatio = '';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.margin = '';
    if (centerEl) { centerEl.style.display = ''; centerEl.style.alignItems = ''; centerEl.style.justifyContent = ''; }
  } else {
    // Constrain the canvas to the aspect, centered in #center with black bars.
    // max-width/height keep it inside the available box; aspect-ratio + the
    // object-fit-free CSS box does the letterbox/pillarbox. #center's own
    // background (the page void) shows as the bars.
    if (centerEl) { centerEl.style.display = 'flex'; centerEl.style.alignItems = 'center'; centerEl.style.justifyContent = 'center'; }
    canvas.style.aspectRatio = String(r);
    canvas.style.width = 'auto';
    canvas.style.height = 'auto';
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    canvas.style.margin = 'auto';
  }
  fitStage(); // re-derive the canvas logical resolution from the new box
}
const aspectSync = () => { $('btnAspect').textContent = `Aspect ratio: ${ASPECT_LABEL[aspectMode]}`; };
function cycleAspect(dir = 1) {
  const i = ASPECT_MODES.indexOf(aspectMode);
  aspectMode = ASPECT_MODES[mod(i + dir, ASPECT_MODES.length)];
  try { localStorage.setItem(ASPECT_KEY, aspectMode); } catch {}
  aspectSync();
  applyAspect();
}
$('btnAspect').onclick = e => { e.currentTarget.blur(); cycleAspect(1); };
aspectSync();

// (c) TV overscan / screen fit — inset the whole #stage a few % per side via
// the --ov CSS var, so the view never spills past a TV's cropped edge (common
// on Batocera / older TVs). Re-fits the canvas resolution. Persisted.
const OVERSCAN_KEY = 'holdout-hd.overscan';
const OVERSCAN_STEPS = [0, 2, 3, 4, 5, 6, 8];
const overscanLabel = v => v === 0 ? 'Full' : `Inset ${v}%`;
let overscan = +(localStorage.getItem(OVERSCAN_KEY) || 0);
if (!OVERSCAN_STEPS.includes(overscan)) overscan = 0;
function applyOverscan() {
  document.documentElement.style.setProperty('--ov', String(overscan));
  fitStage(); // re-derive the canvas resolution from the new (smaller) box
}
const overscanSync = () => { $('btnOverscan').textContent = `Screen fit: ${overscanLabel(overscan)}`; };
function cycleOverscan(dir = 1) {
  const i = OVERSCAN_STEPS.indexOf(overscan);
  overscan = OVERSCAN_STEPS[mod(i + dir, OVERSCAN_STEPS.length)];
  try { localStorage.setItem(OVERSCAN_KEY, String(overscan)); } catch {}
  overscanSync();
  applyOverscan();
}
$('btnOverscan').onclick = e => { e.currentTarget.blur(); cycleOverscan(1); };
overscanSync();
applyOverscan();

// ---------- Controller prompts: glyph style + per-player readout ----------
// Button prompts: Auto / Keyboard / Xbox / PlayStation / Switch (persisted).
// Auto tracks the active controller; the rest force the glyph. The world
// prompts ('[hold E/X] BUILD') re-glyph live via applyPromptGlyph().
const glyphStyleSync = () => { $('btnGlyphStyle').textContent = `Button prompts: ${GLYPH_LABEL[glyphStyle]}`; };
function cycleGlyphStyle(dir = 1) {
  const i = GLYPH_MODES.indexOf(glyphStyle);
  glyphStyle = GLYPH_MODES[mod(i + dir, GLYPH_MODES.length)];
  try { localStorage.setItem(GLYPH_KEY, glyphStyle); } catch {}
  glyphStyleSync();
  glyphSig = null;       // force a re-push next frame
  applyPromptGlyph();    // and immediately, so an open settings demo updates
}
$('btnGlyphStyle').onclick = e => { e.currentTarget.blur(); cycleGlyphStyle(1); };
glyphStyleSync();

// Per-player controller readout, rebuilt whenever Settings opens (cheap; pads
// hot-plug). Lists P1.. with each connected device's friendly name. Keyboards
// always appear (couch seats); pads appear once connected.
function renderCtrlReadout() {
  const host = $('ctrlReadout');
  if (!host) return;
  const lines = [];
  // keyboard seats first (always present in this couch model)
  lines.push(['Keyboard 1', deviceReadout('kb1')]);
  lines.push(['Keyboard 2', deviceReadout('kb2')]);
  // then each connected pad, labeled by slot
  for (const c of controllerList()) {
    if (c.type === 'keyboard') continue; // native lane may include a kb entry
    lines.push([`Pad ${(+c.index) + 1}`, `${c.name || c.id || 'Controller'} (${GLYPH_LABEL[({ xbox: 'xbox', ps4: 'playstation', ps5: 'playstation', switch: 'switch' })[c.type] || 'auto'] || 'Generic'})`]);
  }
  host.innerHTML = lines.map(([k, v]) => `<div><span class="crp">${k}:</span> ${v}</div>`).join('');
}

// volume rows: Music & ambience / Voice (EVA + dialogue) / Effects, persisted
// 0-100 in steps of 10 (defaults 70/100/100). Pad/keys LEFT-RIGHT adjust the
// focused row (see navTick); FIRE/click steps up and wraps past 100 to 0.
// The master Audio toggle above is unchanged and still gates everything.
const VOL_KEY = 'holdout-hd.volumes';
const VOL_DEF = { music: 70, voice: 100, sfx: 100 };
const VOL_BTN = { music: 'btnVolMusic', voice: 'btnVolVoice', sfx: 'btnVolSfx' };
const VOL_NAME = { music: 'Music & ambience', voice: 'Voice (EVA + dialogue)', sfx: 'Effects' };
const VOL_SET = { music: setMusicVolume, voice: setVoiceVolume, sfx: setSfxVolume };
let vols = {};
try { vols = JSON.parse(localStorage.getItem(VOL_KEY)) || {}; } catch {}
for (const k of Object.keys(VOL_DEF)) {
  const v = +vols[k];
  vols[k] = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v / 10) * 10)) : VOL_DEF[k];
}
const volSync = k => {
  $(VOL_BTN[k]).textContent = `${VOL_NAME[k]}: ${vols[k]}%`;
  VOL_SET[k](vols[k] / 100); // applied on boot + every change
};
function adjustVolume(k, d) {
  // d = ±10 (pad LEFT/RIGHT, clamped); d = 0 means click/FIRE (wrap upward)
  vols[k] = d === 0
    ? (vols[k] >= 100 ? 0 : vols[k] + 10)
    : Math.max(0, Math.min(100, vols[k] + d));
  try { localStorage.setItem(VOL_KEY, JSON.stringify(vols)); } catch {}
  volSync(k);
  playUi('uiTick'); // audible feedback at the new mix
}
for (const k of Object.keys(VOL_DEF)) {
  $(VOL_BTN[k]).onclick = e => { e.currentTarget.blur(); adjustVolume(k, 0); };
  volSync(k);
}
$('nameInput').value = localStorage.getItem('holdout.name') || '';
$('nameInput').onchange = () => localStorage.setItem('holdout.name', $('nameInput').value);

// ---------- Resume Game (the Save & Quit bookmark, main menu) ----------
// Mirrors the beacon-restore construction: a LocalSession is built around the
// restored game with the mode-correct level list and levelIdx, the squad
// panels and mission readout are rebuilt, and play resumes next frame (fog,
// minimap, quest HUD and camera all re-derive from the restored snapshots,
// exactly like a beacon resume). The slot is one-shot: it clears on a
// successful resume, and a corrupt slot clears with a toast like a corrupt
// beacon. Starting any NEW game never touches it.
function resumeSuspended() {
  if (session) return;
  const s = loadSuspend();
  if (!s || typeof gameMod.restoreGame !== 'function') {
    refreshContinue();
    return;
  }
  let g = null;
  try { g = gameMod.restoreGame(s.data, charMap); } catch {}
  // the beacon resume's liveness bar: a steppable mid-run game or nothing
  const valid = !!g && g.status === 'play'
    && Array.isArray(g.players) && g.players.length > 0
    && typeof g.w === 'number' && Number.isFinite(g.w) && g.w > 0
    && typeof g.h === 'number' && Number.isFinite(g.h) && g.h > 0
    && Array.isArray(g.grid) && g.grid.length === g.h
    && g.grid.every(row => typeof row === 'string' && row.length === g.w);
  if (!valid) {
    clearSuspend();
    refreshContinue();
    showToast('SAVED GAME CORRUPT — BOOKMARK DISCARDED', 3200, true);
    return;
  }
  const opts = s.mode === 'story' ? { story: true }
    : s.mode === 'bastion' ? { mode: 'bastion', levelIdx: s.levelIdx } : {};
  const sess = new LocalSession(null, opts);
  sess.levelIdx = Math.max(0, Math.min(s.levelIdx, Math.max(0, sess.levels.length - 1)));
  // the run's own roster rides inside the serialized game (createGame keeps
  // it on g.roster); the constructor's mode default covers older data
  if (Array.isArray(g.roster) && g.roster.length) {
    sess.roster = g.roster.filter(id => charMap[id]);
  }
  const seats = Array.isArray(s.seats) ? s.seats : [];
  sess.players = g.players.map((p, i) => ({
    pid: p.pid,
    name: p.name,
    // hand each seat back its original device; older slots without the seat
    // map fall back to join order (kb1, kb2, then pads)
    device: seats.find(q => q && q.pid === p.pid)?.device ?? DEVICES[i] ?? 'kb1',
    charId: p.charId ?? null,
    cursor: 0,
    missingT: 0,
  }));
  sess.inLobby = false;
  sess.game = g;
  sess.snap = null;
  sess.paused = false;
  clearSuspend(); // one-shot bookmark — resumed means spent
  session = sess;
  playUi('select');
  buildSquadPanels(sess.roster);
  updateMissionPanel();
  hideAll();
  refreshContinue(); // the Resume button hides for the next menu visit
}
$('btnResumeGame').onclick = e => {
  e.currentTarget.blur();
  resumeSuspended();
};

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
  session = new LocalSession(null, { mode: 'ctf', levelIdx: ctfMapIdx });
  session.lobby();
};
$('btnBr').onclick = e => {
  e.currentTarget.blur();
  if (!brLevels.length || session) return;
  session = new LocalSession(null, { mode: 'br' });
  session.lobby();
};
$('btnSiege').onclick = e => {
  e.currentTarget.blur();
  if (!siegeLevels.length || session) return;
  // solo deploys vs bots; couch teammates can FIRE-join the lobby before deploy
  session = new LocalSession(null, { mode: 'siege' });
  session.lobby();
};
$('btnFamily').onclick = e => {
  e.currentTarget.blur();
  if (!familyLevels.length || session) return;
  // gentle co-op: 1-4 players FIRE-join the lobby, then off to the bright maps
  session = new LocalSession(null, { family: true });
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
$('btnHostDaily').onclick = e => {
  e.currentTarget.blur();
  if (!bastionLevels.length || session) return;
  // no level select — the server resolves today's daily map+twist itself
  session = new NetSession('host', $('joinCode').value.trim().toUpperCase(), 'bastion', 0, { daily: true });
};
$('btnHostCtf').onclick = e => {
  e.currentTarget.blur();
  if (!ctfLevels.length || session) return;
  session = new NetSession('host', $('joinCode').value.trim().toUpperCase(), 'ctf', ctfMapIdx);
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
// stageEl is declared up top (next to `canvas`) to avoid a TDZ crash, since the
// aspect/overscan settings above call fitStage() during init.
function fitStage() {
  stageEl.style.transform = 'none'; // the old uniform-scale path is retired
  const r = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(r.width));
  const cssH = Math.max(1, Math.round(r.height));
  if (cssW < 8 || cssH < 8) return; // layout not ready yet
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  // uniform resolution scale: respect dpr, floor at 960x540, cap at 2560x1440.
  // The cap is applied LAST so a degenerate window (e.g. 4000x500 CSS) can
  // never exceed 2560x1440 — there the logical height drops below 540, which
  // beats overshooting the texture budget. Normal windows are unaffected.
  let s = Math.min(dpr, 2560 / cssW, 1440 / cssH);
  s = Math.max(s, 960 / cssW, 540 / cssH);
  s = Math.min(s, 2560 / cssW, 1440 / cssH);
  if (!(s > 0)) return;
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
  noteActiveDevice(polled); // track the live device for Auto prompt glyphs
  applyPromptGlyph();        // push the active controller type to the renderer
  remapPadTick();  // a pad rebind capture polls raw buttons each frame
  navTick(polled); // first: consumes the button edges it handles
  pauseUiTick(polled); // then the pause/leave dialog, when one is up
  // live ability preview beside the lobby carousel — runs whenever the lobby is
  // open (the lobby keeps an active session, so this can't live in the menu-only
  // branch below)
  if (!$('lobby').hidden) {
    const apc = $('abilityPreview');
    if (apc) renderMod.drawAbilityPreview?.(apc.getContext('2d'), charMap[window.__carouselId], now / 1000);
  }
  if (session) {
    session.tick?.(polled, dt);
    const cs = session.cutscene;
    if (cs) {
      renderMod.drawCutscene?.(ctx, cs.slides[cs.idx], now / 1000, cs.t, cs.holdT || 0, cs.holdThreshold || 3);
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
        // dynamic splitscreen: views[] while split (or mid-transition), null
        // for the classic shared camera. renderViews is typeof-guarded — the
        // render module's split pass ships separately, and until it lands
        // (or with 0-1 local seats / Off / demo) render() stays single-view.
        const views = typeof renderMod.renderViews === 'function' ? splitViews(snap, dt) : null;
        if (views) renderMod.renderViews(ctx, snap, charMap, views, now / 1000, dt);
        else render(ctx, snap, charMap, session.focusPids(), now / 1000, dt);
        updateHUD(snap);
        if (session.tutorial) tutorialTick(snap);
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
    if (tut) endTutorialCoach(); // session gone (quit mid-tutorial): clear the coach
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
