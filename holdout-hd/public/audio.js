let ctx = null;
let master = null;
// Settings volume buses, all feeding master (so the Audio toggle still gates
// everything): musicBus carries the ambient bed + every music-ish bed (the
// whole amb.out field), voiceBus carries the EVA announcer + NPC dialogue
// clips, sfxBus carries everything else (synth engine, pack cues, combat
// vocals). Defaults 70/100/100, persisted client-side; see the exported
// setMusicVolume/setVoiceVolume/setSfxVolume setters below.
let musicBus = null;
let voiceBus = null;
let sfxBus = null;
const vols = { music: 0.7, voice: 1, sfx: 1 };
let muted = false;
let storageKey = 'holdout.audio.muted';

function ensureAudio() {
  if (typeof window === 'undefined') return null; // headless (tests): stay silent
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.connect(ctx.destination);
    const bus = v => { const g = ctx.createGain(); g.gain.value = v; g.connect(master); return g; };
    musicBus = bus(vols.music);
    voiceBus = bus(vols.voice);
    sfxBus = bus(vols.sfx);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  master.gain.value = muted ? 0 : 0.55;
  startAmbient(); // gesture-gated by construction: ensureAudio runs on input
  startSceneEngine(); // ambience beds / music rotation / weather (same gating)
  return ctx;
}

// Settings > volume rows. v in 0..1; values land before OR after the ctx is
// born (the buses pick vols up at creation). The master toggle is unchanged.
const vol01 = v => { const n = +v; return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1; };
export function setMusicVolume(v) {
  vols.music = vol01(v);
  if (musicBus) musicBus.gain.value = vols.music;
}
export function setVoiceVolume(v) {
  vols.voice = vol01(v);
  if (voiceBus) voiceBus.gain.value = vols.voice;
}
export function setSfxVolume(v) {
  vols.sfx = vol01(v);
  if (sfxBus) sfxBus.gain.value = vols.sfx;
}

// ---- MUSIC BOX easter egg track --------------------------------------------
// When the squad restores a level's music box (4/4), the client asks for that
// level's track on loop at MUSIC volume. Files live at
//   /assets/audio/music/<mode>-<stem>.mp3   (e.g. music/story-ch01.mp3)
// with /assets/audio/music/musicbox-default.mp3 as the fallback. NONE of these
// ship yet, and that is fine: loadFile() resolves a 404 to {state:'missing'}
// silently (no throw, no console spam), so a couch with no music assets just
// hears nothing. playMusicBox is idempotent — calling it every frame while the
// same track already loops is a no-op — so the per-frame client sync, the 4/4
// banner cue, online late-joins and save-resume all funnel through it safely.
let musicBoxWant = null; // the id we're trying to play, retried while loading
let musicBoxDone = null; // id that already played its one-shot this level (no replay)

function tryStartMusicBox() {
  if (!ctx || muted || !musicBoxWant || musicBoxBed) return;
  // try the level-specific track, then the shared fallback; a still-loading
  // head retries next call, a confirmed-missing head falls through to silence
  const want = musicBoxWant;
  let f = loadFile(want.rel);
  if (f.state === 'missing') f = loadFile('music/musicbox-default.ogg');
  if (f.state !== 'ready') return; // loading or both missing: stay silent
  const src = ctx.createBufferSource();
  src.buffer = f.buf;
  src.loop = false; // relic tracks play ONCE — the horde wave lasts the song's length
  const g = ctx.createGain();
  const t0 = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.5, t0 + 2.5); // MUSIC bus scales this
  src.connect(g);
  g.connect(musicBus); // ride the MUSIC volume bus, gated by the audio toggle
  // when the song finishes, mark it done so the per-frame sync never restarts it
  src.onended = () => { if (musicBoxBed && musicBoxBed.src === src) { musicBoxBed = null; musicBoxDone = want.id; musicBoxWant = null; } };
  src.start();
  musicBoxBed = { id: want.id, src, g };
}

// Begin (or keep) the restored music box loop for a level. mode is
// 'story'|'stronghold', stem is the level file stem (e.g. 'ch01','sh13').
export function playMusicBox(mode, stem) {
  if (typeof window === 'undefined') return; // headless (tests): no-op
  const id = `${mode}-${stem}`;
  if (id === musicBoxDone) return;                    // already played its one-shot this level
  if (musicBoxBed && musicBoxBed.id === id) return;   // already playing this one
  if (musicBoxWant && musicBoxWant.id === id && !musicBoxBed) { tryStartMusicBox(); return; }
  if (musicBoxBed) stopMusicBox(); // a different level's box: drop the old one
  musicBoxWant = { id, rel: `music/${id}.ogg` };
  ensureAudio(); // born on first gesture; harmless if the ctx already exists
  tryStartMusicBox(); // plays now if the buffer's already cached, else retries
}

// Stop and clear the music box loop (level change, menu, completion reset).
export function stopMusicBox() {
  musicBoxWant = null;
  musicBoxDone = null; // reset the one-shot guard (a new level can play its track)
  if (!musicBoxBed) return;
  const b = musicBoxBed;
  musicBoxBed = null;
  try {
    const t0 = ctx.currentTime;
    b.g.gain.cancelScheduledValues(t0);
    b.g.gain.setTargetAtTime(0.0001, t0, 0.4);
    b.src.stop(t0 + 1.2);
  } catch { /* already stopped */ }
}

// ============================== ASSET LIBRARY ==============================
// The Anchorfall audio pack lives at /assets/audio/<category>/... (463 opus .ogg
// clips: ambient beds, sci-fi interaction cues, enemy combat vocals, Karen &
// Ian NPC voice lines, crash effects). This layer is ASSET-FIRST: each cue
// names a list of files; playback rotates through the list DETERMINISTICALLY
// via a per-mission counter (never Math.random — every couch hears the same
// take order). Clips lazy-load on first use, are gesture-gated by riding the
// existing ctx, route through the sfx bus into `master` (audio toggle
// silences them), and a missing/still-loading clip silently falls back to the
// synth engine below — the game never goes quiet and never throws.
const FILES = new Map(); // rel -> { state: 'loading'|'ready'|'missing', buf }
let seq = new Map();     // cue key -> per-mission rotation counter
let cueGateAt = new Map(); // cue key -> earliest next allowed play (cooldowns)

// The music tracks (~40MB) are kept OUT of the Railway build (see
// .railwayignore) to keep deploys fast; on the public web they stream from the
// jsDelivr CDN (the repo is public). The desktop/console app is served from
// localhost and uses its bundled copy. Everything else (the voice pack) is
// always local.
const CDN_MUSIC = 'https://cdn.jsdelivr.net/gh/monoplay-xyz/holdout@main/holdout-hd/public/assets/audio/';
const IS_LOCAL = typeof location !== 'undefined' &&
  (/^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname || '') || location.protocol === 'file:');
function audioUrl(rel) {
  return (rel.startsWith('music/') && !IS_LOCAL) ? CDN_MUSIC + rel : `/assets/audio/${rel}`;
}
function loadFile(rel) {
  let f = FILES.get(rel);
  if (f) return f;
  if (!ctx || typeof fetch === 'undefined') return { state: 'missing', buf: null }; // pre-gesture / headless: uncached
  f = { state: 'loading', buf: null };
  FILES.set(rel, f);
  (async () => {
    try {
      const res = await fetch(audioUrl(rel));
      if (!res.ok || !ctx) throw new Error('clip unavailable');
      f.buf = await ctx.decodeAudioData(await res.arrayBuffer());
      f.state = 'ready';
    } catch {
      f.state = 'missing'; // synth fallback covers it forever after
    }
  })();
  return f;
}

// Deterministic rotation with peek-commit: the counter only advances when a
// clip actually plays (so a still-loading head clip retries instead of being
// skipped), except a confirmed-missing clip advances so a dead file can't
// wedge its cue. Returns true when a buffer was scheduled.
function playFile(list, key, vol = 0.5, rate = 1, dest = null) {
  try {
    if (!ctx || muted || !list || !list.length) return false;
    const n = seq.get(key) ?? 0;
    const rel = list[n % list.length];
    const f = loadFile(rel);
    if (f.state === 'missing') { seq.set(key, n + 1); return false; }
    if (f.state !== 'ready') return false; // loading: synth covers this one
    seq.set(key, n + 1);
    const src = ctx.createBufferSource();
    src.buffer = f.buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(dest || sfxBus);
    src.start();
    return true;
  } catch {
    return false; // a bad clip never breaks the game
  }
}

// Per-cue rate limiting so horde fights don't become a choir. The absurd-wait
// guard heals epoch mixing: evaNow() switches clocks (performance -> ctx time)
// when the AudioContext is born, and a pre-gesture gate must not wedge a cue.
function cueGate(key, cd) {
  const t = evaNow();
  const at = cueGateAt.get(key) ?? -1;
  if (t < at && at - t < cd * 4) return false;
  cueGateAt.set(key, t + cd);
  return true;
}

// ---- cue manifest (all paths relative to /assets/audio/) ----
const CUE = {
  uiTick: ['interactions/clicks/Click.ogg', 'interactions/clicks/Click_1.ogg', 'interactions/clicks/Click_Mid.ogg', 'interactions/clicks/Click_2.ogg', 'interactions/clicks/Click_Mid-High.ogg', 'interactions/clicks/Click_3.ogg', 'interactions/clicks/Click_Pitched_Up.ogg', 'interactions/clicks/Click_Low.ogg', 'interactions/clicks/Click_Pitched_Down.ogg'],
  chest: ['interactions/clicks/Click_Combo_3.ogg', 'interactions/clicks/Click_Combo_4.ogg', 'interactions/clicks/Click_Combo_5.ogg', 'interactions/clicks/Click_Scoop_Up.ogg', 'interactions/clicks/Click_Combo_3_High.ogg', 'interactions/clicks/Click_Combo_4_High.ogg'],
  buy: ['interactions/misc/Ting_Pitched_Up.ogg', 'interactions/rings/Ring_Pitched_Up.ogg', 'interactions/misc/Ting_Pitched_Down.ogg', 'interactions/rings/Ring_Pitched_Up_1.ogg'],
  built: ['interactions/impacts/Impact_1.ogg', 'interactions/impacts/Impact_2.ogg', 'interactions/impacts/Impact_2_Mid.ogg', 'interactions/impacts/Impact_1_Low.ogg'],
  upgrade: ['interactions/tones/Tone1A_MajorThirdUp.ogg', 'interactions/tones/Tone1A_FourthUp.ogg', 'interactions/tones/Tone1A_FifthUp.ogg'],
  turretType: ['interactions/clicks/Click_Combo_2_High.ogg', 'interactions/clicks/Click_Combo_2.ogg', 'interactions/clicks/Click_Combo_2_Low.ogg'],
  switch: ['interactions/clicks/Click_Low.ogg', 'interactions/clicks/Click_Stutter.ogg', 'interactions/clicks/Click_Pitched_Down_High_Pass.ogg'],
  teleport: ['interactions/glitches/Glitch_4.ogg', 'interactions/glitches/Glitch_12.ogg', 'interactions/glitches/Glitch_18.ogg', 'interactions/glitches/Glitch_25.ogg', 'interactions/glitches/Glitch_7.ogg'],
  door: ['interactions/fx/Air_FX.ogg', 'interactions/fx/Air_FX_Pitched_Down.ogg', 'interactions/fx/Air_FX_Pitched_Up.ogg'],
  // one tone file per Monolythium rune symbol 0-7 (indexed, not rotated)
  glyph: ['interactions/tones/Tone1A.ogg', 'interactions/tones/Tone1A_MajorThirdUp.ogg', 'interactions/tones/Tone1A_FourthUp.ogg', 'interactions/tones/Tone1A_FifthUp.ogg', 'interactions/tones/Tone1A_OctaveUp.ogg', 'interactions/tones/Tone1A_MinorThirdUp.ogg', 'interactions/tones/Tone1A_TritoneUp.ogg', 'interactions/tones/Tone1A_FifthOctaveUp.ogg'],
  glyphFail: ['interactions/tones/Tone1A_TritoneDown.ogg', 'interactions/tones/Tone1A_MinorTriadDown.ogg'],
  fanfare: ['interactions/tones/Tone2A_MajorTriadUp.ogg', 'interactions/tones/Tone3A_MajorTriadUp.ogg', 'interactions/tones/Tone1A_MajorTriadUp.ogg'],
  riser: ['interactions/misc/Reverse_Ring_2.ogg', 'interactions/misc/Reverse_Ring.ogg', 'interactions/misc/Reverse_Ring_2_High.ogg'],
  ting: ['interactions/misc/Ting_Pitched_Up.ogg'],
  crash: ['effects/Crash_fx_01.ogg', 'effects/Crash_fx_02.ogg', 'effects/Crash_fx_03.ogg', 'effects/Crash_fx_04.ogg'],
  longCrash: ['effects/Long_Crash_fx_01.ogg', 'effects/Long_Crash_fx_02.ogg'],
  bloodSting: ['effects/Long_Distorted_fx.ogg'],
};

// ---- enemy combat vocals, two kind-families (light/eerie vs heavy/brute) ----
const VOX = {
  hitF: ['enemies-hostile/vocal-damage/female/ugh_meghan.ogg', 'enemies-hostile/vocal-damage/female/eh_karen.ogg', 'enemies-hostile/vocal-damage/female/ugh-2_meghan.ogg', 'enemies-hostile/vocal-damage/female/egh_karen.ogg', 'enemies-hostile/vocal-damage/female/ah_meghan.ogg', 'enemies-hostile/vocal-damage/female/eh-2_karen.ogg', 'enemies-hostile/vocal-damage/female/ugh-4_meghan.ogg', 'enemies-hostile/vocal-damage/female/ew_karen.ogg', 'enemies-hostile/vocal-damage/female/mah_meghan.ogg', 'enemies-hostile/vocal-damage/female/eh-3_karen.ogg', 'enemies-hostile/vocal-damage/female/ugh-5_meghan.ogg', 'enemies-hostile/vocal-damage/female/ugh_karen.ogg', 'enemies-hostile/vocal-damage/female/ugh-6_meghan.ogg', 'enemies-hostile/vocal-damage/female/eh-4_karen.ogg', 'enemies-hostile/vocal-damage/female/ugh-7_meghan.ogg', 'enemies-hostile/vocal-damage/female/eh-5_karen.ogg', 'enemies-hostile/vocal-damage/female/ugh-8_meghan.ogg', 'enemies-hostile/vocal-damage/female/ugh-3_meghan.ogg'],
  hitM: ['enemies-hostile/vocal-damage/male/ugh_ian.ogg', 'enemies-hostile/vocal-damage/male/ah_alex.ogg', 'enemies-hostile/vocal-damage/male/oof_sean.ogg', 'enemies-hostile/vocal-damage/male/argh_ian.ogg', 'enemies-hostile/vocal-damage/male/ugh_alex.ogg', 'enemies-hostile/vocal-damage/male/ah-2_sean.ogg', 'enemies-hostile/vocal-damage/male/ow_ian.ogg', 'enemies-hostile/vocal-damage/male/ahh_alex.ogg', 'enemies-hostile/vocal-damage/male/ugh-2_ian.ogg', 'enemies-hostile/vocal-damage/male/oh_sean.ogg', 'enemies-hostile/vocal-damage/male/ow_alex.ogg', 'enemies-hostile/vocal-damage/male/ugh-3_ian.ogg', 'enemies-hostile/vocal-damage/male/hah_alex.ogg', 'enemies-hostile/vocal-damage/male/ugh_sean.ogg', 'enemies-hostile/vocal-damage/male/oof_ian.ogg', 'enemies-hostile/vocal-damage/male/huh_alex.ogg', 'enemies-hostile/vocal-damage/male/ugh-4_ian.ogg', 'enemies-hostile/vocal-damage/male/ooh_alex.ogg', 'enemies-hostile/vocal-damage/male/ugh-5_ian.ogg', 'enemies-hostile/vocal-damage/male/ay_ian.ogg'],
  dieF: ['enemies-hostile/vocal-death/female/ugh_meghan.ogg', 'enemies-hostile/vocal-death/female/oh_karen.ogg', 'enemies-hostile/vocal-death/female/nnngh_meghan.ogg', 'enemies-hostile/vocal-death/female/ugh-2_karen.ogg', 'enemies-hostile/vocal-death/female/nuh_meghan.ogg', 'enemies-hostile/vocal-death/female/eh-eh-eh_karen.ogg', 'enemies-hostile/vocal-death/female/ugh-2_meghan.ogg', 'enemies-hostile/vocal-death/female/oh-2_karen.ogg', 'enemies-hostile/vocal-death/female/ugh-3_meghan.ogg', 'enemies-hostile/vocal-death/female/ugh-3_karen.ogg', 'enemies-hostile/vocal-death/female/ugh-4_meghan.ogg', 'enemies-hostile/vocal-death/female/death_6_karen.ogg', 'enemies-hostile/vocal-death/female/ugh-5_meghan.ogg', 'enemies-hostile/vocal-death/female/ugh-4_karen.ogg', 'enemies-hostile/vocal-death/female/ugh-6_meghan.ogg', 'enemies-hostile/vocal-death/female/ugh-5_karen.ogg', 'enemies-hostile/vocal-death/female/ugh-7_meghan.ogg', 'enemies-hostile/vocal-death/female/eh-eh-eh-eh-eh-eh-eh_karen.ogg', 'enemies-hostile/vocal-death/female/ugh-8_meghan.ogg', 'enemies-hostile/vocal-death/female/ugh_karen.ogg'],
  dieM: ['enemies-hostile/vocal-death/male/ugh_alex.ogg', 'enemies-hostile/vocal-death/male/oh_ian.ogg', 'enemies-hostile/vocal-death/male/huh-ugh_sean.ogg', 'enemies-hostile/vocal-death/male/ugh-2_alex.ogg', 'enemies-hostile/vocal-death/male/d-oh-d-oh-ah_ian.ogg', 'enemies-hostile/vocal-death/male/agh-ugh-ugh_alex.ogg', 'enemies-hostile/vocal-death/male/ah_sean.ogg', 'enemies-hostile/vocal-death/male/oh-oh_alex.ogg', 'enemies-hostile/vocal-death/male/death_9_ian.ogg', 'enemies-hostile/vocal-death/male/hup_sean.ogg', 'enemies-hostile/vocal-death/male/ugh-3_alex.ogg', 'enemies-hostile/vocal-death/male/oh-oh-oh-oh_ian.ogg', 'enemies-hostile/vocal-death/male/awww_sean.ogg', 'enemies-hostile/vocal-death/male/uh-uh-uh-uh-uh-uh-uh_alex.ogg', 'enemies-hostile/vocal-death/male/i-am_ian.ogg', 'enemies-hostile/vocal-death/male/ugh-agh-ugh-ugh-ugh_sean.ogg', 'enemies-hostile/vocal-death/male/ugh-4_alex.ogg', 'enemies-hostile/vocal-death/male/it-s-wrong_ian.ogg', 'enemies-hostile/vocal-death/male/hup-hup-ahem_sean.ogg', 'enemies-hostile/vocal-death/male/oh-oh-2_alex.ogg'],
  // big-moment screams (boss/elite deaths only — too theatrical for fodder)
  dieBig: ['enemies-hostile/vocal-death/male/ahhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh_ian.ogg', 'enemies-hostile/vocal-death/male/nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn_sean.ogg', 'enemies-hostile/vocal-death/male/yeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee_ian.ogg', 'enemies-hostile/vocal-death/male/nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn_ian.ogg'],
  // an enemy spots its prey (telegraph/aim) — "the camp wakes up"
  shout: ['enemies-hostile/vocal-shouting/male/over-here_alex.ogg', 'enemies-hostile/vocal-shouting/female/hey_karen.ogg', 'enemies-hostile/vocal-shouting/male/you-there_alex.ogg', 'enemies-hostile/vocal-shouting/female/hey_meghan.ogg', 'enemies-hostile/vocal-shouting/male/oi_alex.ogg', 'enemies-hostile/vocal-shouting/female/heeey_karen.ogg', 'enemies-hostile/vocal-shouting/male/hey_alex.ogg', 'enemies-hostile/vocal-shouting/female/haaah_meghan.ogg', 'enemies-hostile/vocal-shouting/male/hoorah_ian.ogg', 'enemies-hostile/vocal-shouting/female/gaaaaah_meghan.ogg', 'enemies-hostile/vocal-shouting/male/ahhhhh_ian.ogg', 'enemies-hostile/vocal-shouting/female/hey-2_karen.ogg', 'enemies-hostile/vocal-shouting/male/whoa_ian.ogg', 'enemies-hostile/vocal-shouting/male/ayo_sean.ogg'],
  // operator takes a real knock (playerHit) — short human grunts
  grunt: ['enemies-hostile/vocal-grunting/male/ugh_ian.ogg', 'enemies-hostile/vocal-grunting/female/oof_karen.ogg', 'enemies-hostile/vocal-grunting/male/huh_alex.ogg', 'enemies-hostile/vocal-grunting/female/ugh_meghan.ogg', 'enemies-hostile/vocal-grunting/male/ah_sean.ogg', 'enemies-hostile/vocal-grunting/female/huah_meghan.ogg', 'enemies-hostile/vocal-grunting/male/ugh-2_ian.ogg', 'enemies-hostile/vocal-grunting/female/oof_meghan.ogg', 'enemies-hostile/vocal-grunting/male/hah_sean.ogg', 'enemies-hostile/vocal-grunting/female/ugh-2_meghan.ogg', 'enemies-hostile/vocal-grunting/male/ugh_alex.ogg', 'enemies-hostile/vocal-grunting/female/hah_meghan.ogg'],
};
// enemy kind (snapshot name) -> vocal family; unlisted kinds stay synth-only
const VOX_FAM = {
  skitter: 'F', husk: 'F', alpha: 'F', beetle: 'F', acolyte: 'F', archer: 'F',
  grunt: 'M', charger: 'M', bulwark: 'M', stalker: 'M', wraith: 'M', sniper: 'M', boss: 'M',
};

// ---- NPC voice lines (Karen & Ian) — polarity-matched social VO ----
const DIALOGUE = {
  greeting: {
    ian: ['dialogue/greeting/male/hey_ian.ogg', 'dialogue/greeting/male/howdy_ian.ogg', 'dialogue/greeting/male/hello_ian.ogg', 'dialogue/greeting/male/welcome_ian.ogg', 'dialogue/greeting/male/greetings_ian.ogg', 'dialogue/greeting/male/yo_ian.ogg', 'dialogue/greeting/male/hiya_ian.ogg', 'dialogue/greeting/male/what-s-up_ian.ogg', 'dialogue/greeting/male/hi_ian.ogg'],
    karen: ['dialogue/greeting/female/hello_karen.ogg', 'dialogue/greeting/female/hey_karen.ogg', 'dialogue/greeting/female/welcome_karen.ogg', 'dialogue/greeting/female/howdy_karen.ogg', 'dialogue/greeting/female/greetings_karen.ogg', 'dialogue/greeting/female/heya_karen.ogg', 'dialogue/greeting/female/what-s-up_karen.ogg', 'dialogue/greeting/female/yo_karen.ogg', 'dialogue/greeting/female/hi_karen.ogg'],
  },
  confirmation: {
    ian: ['dialogue/confirmation/male/you-got-it_ian.ogg', 'dialogue/confirmation/male/all-right_ian.ogg', 'dialogue/confirmation/male/on-it_ian.ogg', 'dialogue/confirmation/male/yeah_ian.ogg', 'dialogue/confirmation/male/definitely_ian.ogg', 'dialogue/confirmation/male/okay_ian.ogg', 'dialogue/confirmation/male/let-s-go_ian.ogg', 'dialogue/confirmation/male/great_ian.ogg', 'dialogue/confirmation/male/yes_ian.ogg', 'dialogue/confirmation/male/on-my-way_ian.ogg'],
    karen: ['dialogue/confirmation/female/okay_karen.ogg', 'dialogue/confirmation/female/on-it_karen.ogg', 'dialogue/confirmation/female/you-got-it_karen.ogg', 'dialogue/confirmation/female/all-right_karen.ogg', 'dialogue/confirmation/female/yeah_karen.ogg', 'dialogue/confirmation/female/let-s-go_karen.ogg', 'dialogue/confirmation/female/definitely_karen.ogg', 'dialogue/confirmation/female/great_karen.ogg', 'dialogue/confirmation/female/yes_karen.ogg', 'dialogue/confirmation/female/on-my-way_karen.ogg'],
  },
  completion: {
    ian: ['dialogue/completion/male/objective-complete_ian.ogg', 'dialogue/completion/male/all-done_ian.ogg', 'dialogue/completion/male/complete_ian.ogg', 'dialogue/completion/male/finished_ian.ogg', 'dialogue/completion/male/ready_ian.ogg'],
    karen: ['dialogue/completion/female/objective-complete_karen.ogg', 'dialogue/completion/female/all-done_karen.ogg', 'dialogue/completion/female/complete_karen.ogg', 'dialogue/completion/female/finished_karen.ogg', 'dialogue/completion/female/ready_karen.ogg'],
  },
  refusal: {
    ian: ['dialogue/refusal/male/no-can-do_ian.ogg', 'dialogue/refusal/male/sorry_ian.ogg', 'dialogue/refusal/male/nah_ian.ogg', 'dialogue/refusal/male/not-happening_ian.ogg', 'dialogue/refusal/male/negative_ian.ogg'],
    karen: ['dialogue/refusal/female/no-can-do_karen.ogg', 'dialogue/refusal/female/sorry_karen.ogg', 'dialogue/refusal/female/negative_karen.ogg', 'dialogue/refusal/female/not-happening_karen.ogg', 'dialogue/refusal/female/no-way_karen.ogg'],
  },
};
const talked = new Set(); // npcIds greeted this mission (greeting vs confirmation)
function npcVoice(id) {
  let h = 0;
  const s = String(id ?? '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h & 1) ? 'karen' : 'ian'; // stable voice per NPC for the mission
}

// ============================== AMBIENT LOOP ==============================
// A very quiet generative bed — low drone + sparse pentatonic plucks, the
// Monolythium night mood under couch-TV gameplay. Routed through the music
// bus into `master`, so the Music & ambience volume scales it and the audio
// toggle still silences it instantly. Started once, lazily, from ensureAudio
// (which only ever runs off a user gesture or game sound).
let amb = null;

function startAmbient() {
  if (amb || !ctx) return;
  const now = ctx.currentTime;
  const out = ctx.createGain(); // the whole bed routes through here so EVA can duck it
  out.connect(musicBus); // amb.out carries every music-ish bed -> music volume
  const bed = ctx.createGain();
  bed.gain.setValueAtTime(0.0001, now);
  bed.gain.exponentialRampToValueAtTime(0.16, now + 8); // slow fade-in
  bed.connect(out);
  const drone = (freq, type, vol) => {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    og.gain.value = vol;
    o.connect(og);
    og.connect(bed);
    o.start();
    return o;
  };
  drone(55, 'sine', 0.16);            // root
  drone(55 * 1.5, 'sine', 0.05);      // fifth
  drone(55 * 2.02, 'triangle', 0.02); // detuned octave shimmer
  // slow breathing on the bed
  const lfo = ctx.createOscillator();
  const lfoG = ctx.createGain();
  lfo.frequency.value = 0.06;
  lfoG.gain.value = 0.05;
  lfo.connect(lfoG);
  lfoG.connect(bed.gain);
  lfo.start();
  // sparse pluck — leave plenty of silence in the night
  const scale = [220, 261.63, 293.66, 329.63, 392, 523.25];
  const timer = setInterval(() => {
    if (!ctx || ctx.state !== 'running' || muted) return;
    if (Math.random() < 0.45) return;
    const f = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.25 ? 0.5 : 1);
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.035, t0 + 0.04);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
    o.connect(og);
    og.connect(out);
    o.start(t0);
    o.stop(t0 + 2.7);
  }, 3800);
  amb = { bed, out, timer };
}

// ============================== SCENE ENGINE ==============================
// Drives everything that breathes with the world: rotating asset music beds
// (day / night / blood moon), generative biome textures per def.ambience,
// the night tension layer, the blood-moon dread bed, and weather audio.
// render() feeds it every frame via setScene(snap); drawMenuBackdrop feeds
// setScene(null). Everything routes through amb.out so the EVA announcer's
// duck still squeezes the whole ambient field, and master gates it all.
const MUSIC = {
  day: ['ambient-day-only/Restless_Melody_01.ogg', 'ambient-day-only/Mysterious_Theme.ogg', 'ambient-day-only/Restless_Melody_02.ogg', 'ambient-day-only/Lofi_Creepy_Theme.ogg'],
  night: ['ambient-night-only/06.There_In_Spirit.ogg', 'ambient-night-only/Dark_Pulsating_Ambient.ogg', 'ambient-night-only/04.Those_Who_Wait.ogg', 'ambient-night-only/Ambient_Lingering_Action.ogg', 'ambient-night-only/05.From_The_Ashes.ogg', 'ambient-night-only/Mellow_Ambient_Track.ogg'],
  blood: ['ambient-situation/Chaos_Loop.ogg', 'ambient-situation/Breathless_Oblivion.ogg'],
};
const MUSIC_VOL = { day: 0.14, night: 0.17, blood: 0.22 };
const STORY_BEDS = {
  intro: ['ambient-situation/sad-intro-new-map-or-final-map.ogg'],
  ending: ['ambient-situation/ending-cut-scenes.ogg'],
};
const AMBIENCES = new Set(['meadow', 'forest', 'swamp', 'ash', 'city', 'night', 'lava', 'ship']);

const scene = { active: false, ambience: 'meadow', phase: 'day', blood: false, weather: 'clear', theme: null, boss: false };
let lastSceneAt = -1e9;
let sceneTimer = null;
let music = null;        // { cat, src, g }
let musicGapUntil = 0;   // small silence between rotated tracks
let bloodDrone = null;   // sustained dissonant pair while the moon is up
let weatherBed = null;   // { kind, src, g } looping filtered-noise bed
let storyBed = null;     // intro/ending one-shot bed (cutscenes, victory)
let musicBoxBed = null;  // { id, src, g } the restored Music Box loop (easter egg)
let texT = 0;            // texture scheduler clock
let texRng = 1;          // tiny LCG for texture spacing (reseeded per mission)
function texRand() { texRng = (texRng * 1664525 + 1013904223) >>> 0; return texRng / 4294967296; }

// The render loop calls this with every snapshot (or null from the menus).
// Defensive by contract: snapshot.ambience lands from the sim this phase —
// until then every read falls back ('meadow', clear weather, cycle-less day).
export function setScene(snap) {
  try {
    lastSceneAt = evaNow();
    if (!snap) { sceneOff(); return; }
    if (!scene.active) {
      // mission (re)start: fresh per-mission rotation counters + NPC memory
      seq = new Map();
      cueGateAt = new Map();
      talked.clear();
      texRng = 0x9d2c5680 ^ (FILES.size + 1);
      stopStoryBed(0.8);
    }
    scene.active = true;
    scene.ambience = AMBIENCES.has(snap.ambience) ? snap.ambience : 'meadow';
    const cy = snap.cycle;
    scene.phase = cy ? cy.phase : (snap.dark ? 'night' : 'day');
    scene.blood = !!(cy && cy.bloodMoon && cy.phase === 'night');
    const w = snap.weather ?? snap.modifiers?.weather;
    scene.weather = (w === 'rain' || w === 'snow' || w === 'ashstorm' || w === 'fog' || w === 'thunderstorm') ? w : 'clear';
    // map theme drives a low per-theme ambient bed (see themeTick)
    scene.theme = typeof snap.theme === 'string' ? snap.theme : null;
  } catch { /* a malformed snapshot never breaks audio */ }
}

function sceneOff() {
  if (!scene.active) return;
  scene.active = false;
  scene.blood = false;
  scene.weather = 'clear';
  scene.theme = null;
}

function startSceneEngine() {
  if (sceneTimer || !ctx || typeof setInterval === 'undefined') return;
  sceneTimer = setInterval(() => { try { sceneTick(); } catch { /* never throw */ } }, 250);
}

function sceneTick() {
  if (!ctx || !amb) return;
  // watchdog: render stopped feeding us (cutscene, results, pause) -> menus
  if (scene.active && evaNow() - lastSceneAt > 1.5) sceneOff();
  musicTick();
  bloodTick();
  weatherTick();
  if (!muted && scene.active && ctx.state === 'running') textureTick();
}

// --- rotating music beds -------------------------------------------------
function musicTick() {
  const want = scene.active ? (scene.blood ? 'blood' : scene.phase === 'night' ? 'night' : 'day') : null;
  if (music && music.cat !== want) stopMusic(want ? (want === 'blood' ? 0.35 : 1.2) : 2.0);
  if (!music && want && evaNow() >= musicGapUntil && !muted) startMusic(want);
}

function startMusic(cat) {
  const list = MUSIC[cat];
  if (!list || !list.length) return;
  const key = `music-${cat}`;
  const n = seq.get(key) ?? 0;
  const f = loadFile(list[n % list.length]);
  if (f.state === 'missing') { seq.set(key, n + 1); return; } // skip dead track
  if (f.state !== 'ready') return; // retry next tick; synth bed carries the room
  seq.set(key, n + 1);
  const src = ctx.createBufferSource();
  src.buffer = f.buf;
  src.loop = cat === 'blood'; // the dread bed holds until dawn breaks it
  const g = ctx.createGain();
  const t0 = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(MUSIC_VOL[cat] ?? 0.15, t0 + (cat === 'blood' ? 0.7 : 2.5));
  src.connect(g);
  g.connect(amb.out);
  const mine = { cat, src, g };
  src.onended = () => {
    if (music === mine) { music = null; musicGapUntil = evaNow() + 5; } // breathe, then next track
  };
  src.start();
  music = mine;
}

function stopMusic(fade = 1.2) {
  const m = music;
  if (!m) return;
  music = null;
  try {
    m.src.onended = null;
    const t0 = ctx.currentTime;
    m.g.gain.cancelScheduledValues(t0);
    m.g.gain.setValueAtTime(Math.max(m.g.gain.value, 0.0001), t0);
    m.g.gain.exponentialRampToValueAtTime(0.0001, t0 + fade);
    m.src.stop(t0 + fade + 0.05);
  } catch { /* already gone */ }
}

// --- blood moon dread: heartbeat + sustained dissonant pair ---------------
function bloodTick() {
  if (scene.blood && !bloodDrone && !muted) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 2);
    g.connect(amb.out);
    const mk = fr => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(g); o.start(); return o; };
    bloodDrone = { g, oscs: [mk(66), mk(69.4)], beatAt: 0 }; // a flat semitone grinding
    playFile(CUE.bloodSting, 'bloodSting', 0.4, 1, amb.out); // the darkest sting in the pack
  } else if (!scene.blood && bloodDrone) {
    const d = bloodDrone;
    bloodDrone = null;
    try {
      const t0 = ctx.currentTime;
      d.g.gain.cancelScheduledValues(t0);
      d.g.gain.setTargetAtTime(0.0001, t0, 0.5);
      for (const o of d.oscs) o.stop(t0 + 2.5);
    } catch { /* fine */ }
  }
  if (bloodDrone && evaNow() >= bloodDrone.beatAt && !muted) {
    bloodDrone.beatAt = evaNow() + 1.15; // the slow heartbeat under the moon
    tone(55, 0.14, 'sine', 0.09, 0.8, amb.out);
    setTimeout(() => tone(41, 0.18, 'sine', 0.07, 0.8, amb.out), 220);
  }
}

// --- weather beds: looping filtered noise, one per weather kind ------------
const WEATHER_BED = {
  rain: { freq: 1100, q: 0.5, vol: 0.016 }, // soft patter, not hiss — tuned down per playtest
  snow: { freq: 700, q: 0.4, vol: 0.022 },   // soft high wind, half-buried
  ashstorm: { freq: 380, q: 0.5, vol: 0.045 }, // low gusting roar
  fog: { freq: 240, q: 0.3, vol: 0.018 },     // barely-there low air
  thunderstorm: { freq: 900, q: 0.45, vol: 0.03 }, // RELIC AWAKENING: a heavier downpour bed (thunder cracks ride playEvent)
};
function weatherTick() {
  const want = scene.active && scene.weather !== 'clear' ? scene.weather : null;
  if (weatherBed && weatherBed.kind !== want) {
    const wb = weatherBed;
    weatherBed = null;
    try {
      wb.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.8);
      wb.src.stop(ctx.currentTime + 3);
    } catch { /* fine */ }
  }
  if (!weatherBed && want && !muted) {
    const cfg = WEATHER_BED[want];
    if (!cfg) return;
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1; // render-side noise
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; // highpass rain read as harsh static
    filt.frequency.value = cfg.freq;
    filt.Q.value = cfg.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(cfg.vol, ctx.currentTime + 3);
    // gusts: slow LFO wobble for wind-driven weather
    if (want !== 'rain') {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 0.13;
      lg.gain.value = cfg.vol * 0.6;
      lfo.connect(lg);
      lg.connect(g.gain);
      lfo.start();
    }
    src.connect(filt);
    filt.connect(g);
    g.connect(amb.out);
    src.start();
    weatherBed = { kind: want, src, g };
  }
}

// --- generative biome textures (per def.ambience, day/night aware) ---------
// Sparse one-shot colors over the beds: birdsong in a day meadow, frog croaks
// in the swamp, magma rumbles on lava maps, metal groans on ships. At night
// the biome quiets down and a tension layer (low pulse + distant skitters)
// takes the room instead. All synth, all through amb.out, all very quiet.
function textureTick() {
  texT += 0.25;
  const day = scene.phase !== 'night';
  const a = scene.ambience;
  const r = texRand();
  if (day) {
    if (a === 'meadow' && r < 0.07) birdChirp(2200 + texRand() * 900);
    else if (a === 'forest' && r < 0.05) (texRand() < 0.7 ? birdChirp(1800 + texRand() * 700) : leafRustle());
    else if (a === 'swamp' && r < 0.07) (texRand() < 0.6 ? frogCroak() : insectBuzz());
  } else if (a !== 'lava' && a !== 'ash' && r < 0.045) {
    skitterScratch(); // distant chitin on stone, somewhere out there
  }
  // biome voices that never sleep
  if (a === 'ash' && r >= 0.07 && r < 0.12) windGust();
  if (a === 'lava' && r < 0.09) (texRand() < 0.65 ? magmaRumble() : magmaPop());
  if ((a === 'city' || a === 'ship') && r >= 0.05 && r < 0.075) metalGroan();
  if (a === 'ship' && r < 0.02) tone(820 + texRand() * 400, 0.05, 'sine', 0.018, 1.1, amb.out); // console blip
  if (a === 'night' && r >= 0.045 && r < 0.065) lowMoan();
  // map theme ambient bed: a sparse, very quiet per-theme color through amb.out.
  // No-op on unthemed levels (scene.theme null). All synth, all reused helpers.
  const th = scene.theme;
  if (th && r >= 0.12 && r < 0.17) {
    if (th === 'lava' || th === 'fire') magmaRumble();
    else if (th === 'toxic') noise(1.4, 0.02, 600, amb.out);          // chem air drift
    else if (th === 'nuclear') tone(1400, 0.02, 'square', 0.012, 1.0, amb.out); // faint geiger blip
    else if (th === 'storm') tone(46, 0.9, 'sine', 0.02, 1.0, amb.out);  // distant thunder roll
    else if (th === 'ice') tone(2400 + texRand() * 600, 0.05, 'sine', 0.01, 0.8, amb.out); // wind shimmer
  }
  // night tension pulse (skipped under blood moon — the heartbeat owns it)
  if (!day && !scene.blood && (texT % 2.25) < 0.25) tone(49, 0.45, 'sine', 0.028, 1.0, amb.out);
}
function birdChirp(f) {
  tone(f, 0.06, 'sine', 0.022, 1.35, amb.out);
  setTimeout(() => tone(f * 1.18, 0.05, 'sine', 0.018, 0.8, amb.out), 90);
  if (texRand() < 0.5) setTimeout(() => tone(f * 0.92, 0.07, 'sine', 0.015, 1.25, amb.out), 200);
}
function leafRustle() { noise(0.5, 0.014, 2600, amb.out); }
function frogCroak() {
  tone(108, 0.16, 'square', 0.02, 0.72, amb.out);
  setTimeout(() => tone(95, 0.12, 'square', 0.014, 0.8, amb.out), 200);
}
function insectBuzz() { noise(0.7, 0.008, 4200, amb.out); }
function windGust() { noise(2.2, 0.026, 420, amb.out); if (texRand() < 0.4) setTimeout(() => tone(1900 + texRand() * 800, 0.02, 'sine', 0.012, 0.9, amb.out), 700); }
function magmaRumble() { noise(1.8, 0.04, 95, amb.out); }
function magmaPop() { tone(150, 0.09, 'sine', 0.03, 0.55, amb.out); }
function metalGroan() { tone(64 + texRand() * 22, 1.6, 'sawtooth', 0.016, 1.18, amb.out); }
function lowMoan() { tone(82, 1.1, 'sine', 0.02, 0.86, amb.out); }
function skitterScratch() {
  noise(0.07, 0.018, 3200, amb.out);
  setTimeout(() => noise(0.05, 0.012, 2800, amb.out), 110);
}

// --- story beds: intro slide / ending payoff (one-shot, self-replacing) ----
function playStoryBed(list, key) {
  stopStoryBed(0.4);
  if (!ctx || muted) return;
  const n = seq.get(key) ?? 0;
  const f = loadFile(list[n % list.length]);
  if (f.state !== 'ready') { if (f.state === 'missing') seq.set(key, n + 1); return; }
  seq.set(key, n + 1);
  const src = ctx.createBufferSource();
  src.buffer = f.buf;
  const g = ctx.createGain();
  const t0 = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.2, t0 + 1.2);
  src.connect(g);
  g.connect(amb.out);
  const mine = { src, g };
  src.onended = () => { if (storyBed === mine) storyBed = null; };
  src.start();
  storyBed = mine;
}
function stopStoryBed(fade = 0.8) {
  const b = storyBed;
  if (!b) return;
  storyBed = null;
  try {
    b.src.onended = null;
    b.g.gain.setTargetAtTime(0.0001, ctx.currentTime, fade / 3);
    b.src.stop(ctx.currentTime + fade + 0.1);
  } catch { /* fine */ }
}

// ============================== EVA ANNOUNCER ==============================
// RA2-style ops voice. Every clip is a tiny local m4a synthesized offline on
// this machine (macOS `say` -> afconvert 44.1k AAC) — zero copyrighted game
// audio. Clips lazy-load on first use; one announcement plays at a time with
// a 0.4s gap; per-line cooldowns stop chatter; pri 2 lines preempt whatever
// is speaking; everything passes a bandpass 'comms' chain plus a slight
// sample-hold crush for the radio feel; the ambient bed ducks while she
// talks; the master audio toggle silences her; a missing clip is silently
// skipped — the announcer never throws.
const EVA_VOL = 0.85;
const EVA_GAP = 0.4;   // seconds of air between queued lines
const EVA_MAX_AGE = 8; // a line still waiting after this long is stale — drop it
// pri 2 preempts the current line; pri 1 jumps the queue; 0 waits its turn.
// cd is the per-line cooldown in seconds (default 3). once = once per session.
const EVA_LINES = {
  'pylon-online':    { cd: 1.5 },
  'anchor-charging': { cd: 30 },             // reserved: no sim event emits this yet
  'anchor-open':     { cd: 30, pri: 1 },
  'nightfall':       { cd: 20 },             // sim emits dusk once per dusk already
  'daybreak':        { cd: 20 },
  'blood-moon':      { cd: 25, pri: 1 },
  'base-attack':     { cd: 12, pri: 2 },
  'core-critical':   { cd: 10, pri: 2 },
  'beacon-down':     { cd: 6 },              // reserved: no sim event emits this yet
  'beacon-lit':      { cd: 5 },
  'structure-lost':  { cd: 8 },
  'turret-online':   { cd: 1.5 },
  'tower-manned':    { cd: 6 },              // reserved: no sim event emits this yet
  'unit-promoted':   { cd: 5 },
  'new-operator':    { cd: 4 },
  'operator-down':   { cd: 6, pri: 1 },
  'rescue':          { cd: 4 },
  'shields-up':      { cd: 8 },
  'low-shards':      { cd: 6 },              // reserved: no sim event emits this yet
  'quest-new':       { cd: 2 },
  'quest-done':      { cd: 2 },
  'wave-incoming':   { cd: 10 },
  'match-won':       { cd: 30, pri: 1 },
  'match-lost':      { cd: 30, pri: 1 },
  'flag-taken':      { cd: 6 },
  'flag-capture':    { cd: 4 },
  'teleport-online': { once: true },         // the first blink confirms the pad network
  'ship-arrived':    { cd: 30 },             // reserved: no sim event emits this yet
};
// The one declarative wiring table: sim event type -> line id (null = silent).
// playEvent is the single client funnel for sim events, so hooking here wires
// every session kind (story/bastion/classic/ctf/br) without touching client.js.
const EVA_WIRES = {
  built: ev => ev.kind === 'pylon' ? 'pylon-online' : ev.kind === 'turret' ? 'turret-online' : null,
  gateOpen: () => 'anchor-open',
  dusk: () => 'nightfall',
  dawn: () => 'daybreak',
  bloodWarn: () => 'blood-moon',
  coreHit: ev => (ev.hp != null && ev.hp < 10) ? 'core-critical' : 'base-attack',
  beacon: () => 'beacon-lit',              // a save beacon comes online
  beaconDown: () => 'beacon-down',         // stronghold beacon variant
  beaconLit: () => 'beacon-lit',           // relit by shards under fire
  relight: () => 'beacon-lit',             // alias some emitters may prefer
  buildDown: () => 'structure-lost',
  levelUp: () => 'unit-promoted',
  down: () => 'operator-down',
  eliminated: () => 'operator-down',
  pickup: () => 'rescue',                  // captive rescued (joins the roster)
  hired: () => 'new-operator',
  shieldUp: () => 'shields-up',
  quest: ev => ev.state === 'done' ? 'quest-done' : ev.state === 'active' ? 'quest-new' : null,
  wave: () => 'wave-incoming',
  // the horn calls the night early: no dedicated line fits, so EVA gives the
  // wave warning (dusk itself still announces 'nightfall' 5s later)
  horn: () => 'wave-incoming',
  clear: () => 'match-won',
  fail: () => 'match-lost',
  flagTaken: () => 'flag-taken',
  capture: () => 'flag-capture',
  teleport: () => 'teleport-online',
  shipDown: () => 'ship-arrived',          // future-proofed: no current emitter
  towerOccupied: () => 'tower-manned',     // future-proofed: no current emitter
  noShards: () => 'low-shards',            // future-proofed: no current emitter
};

const evaClips = new Map(); // id -> { state: 'loading'|'ready'|'missing', buf }
const evaQueue = [];        // [{ id, pri, at }]
const evaLast = new Map();  // id -> last accepted time (cooldowns)
const evaOnce = new Set();
let evaSpeaking = null;     // { id, src, watchdog }
let evaNextOk = 0;          // earliest time the next line may start
let evaPumpT = null;        // pending pump timer
let evaChain = null;        // comms filter input node

// Monotonic seconds that also works headless (node tests have no AudioContext).
function evaNow() {
  if (ctx) return ctx.currentTime;
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

// Slight downsample: hold every 3rd sample (~14.7kHz effective at 44.1k) —
// just enough grit to sit the voice "on the radio" without mangling it.
function evaCrush(buf) {
  const HOLD = 3;
  const out = ctx.createBuffer(1, buf.length, buf.sampleRate);
  const src = buf.getChannelData(0);
  const dst = out.getChannelData(0);
  for (let i = 0; i < src.length; i += HOLD) {
    const v = src[i];
    const end = Math.min(i + HOLD, src.length);
    for (let j = i; j < end; j++) dst[j] = v;
  }
  return out;
}

function evaLoad(id) {
  let c = evaClips.get(id);
  if (c) return c;
  c = { state: 'loading', buf: null };
  evaClips.set(id, c);
  (async () => {
    try {
      const res = await fetch(`/assets/voice/${id}.m4a`);
      if (!res.ok || !ctx) throw new Error('voice clip unavailable');
      c.buf = evaCrush(await ctx.decodeAudioData(await res.arrayBuffer()));
      c.state = 'ready';
    } catch {
      c.state = 'missing'; // graceful silent fallback, never throws
    }
    evaPump();
  })();
  return c;
}

// The comms chain: telephone-band bandpass (hp 320 / lp 3400) with a small
// presence peak. Built once, feeds the voice bus into master so the Voice
// volume scales her and the audio toggle still governs it.
function evaOut() {
  if (evaChain) return evaChain;
  const inG = ctx.createGain();
  inG.gain.value = EVA_VOL;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 320; hp.Q.value = 0.8;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 3400; lp.Q.value = 0.8;
  const pres = ctx.createBiquadFilter();
  pres.type = 'peaking'; pres.frequency.value = 1800; pres.gain.value = 4; pres.Q.value = 1;
  inG.connect(hp); hp.connect(lp); lp.connect(pres); pres.connect(voiceBus);
  evaChain = inG;
  return evaChain;
}

function evaDuck(on) {
  if (!amb || !amb.out || !ctx) return;
  const g = amb.out.gain;
  g.cancelScheduledValues(ctx.currentTime);
  g.setTargetAtTime(on ? 0.25 : 1, ctx.currentTime, on ? 0.05 : 0.4);
}

function evaStop() {
  if (!evaSpeaking) return;
  try { evaSpeaking.src.onended = null; evaSpeaking.src.stop(); } catch { /* already done */ }
  clearTimeout(evaSpeaking.watchdog);
  evaSpeaking = null;
  evaDuck(false);
  evaNextOk = evaNow() + 0.15; // one breath before the preempting line
}

function evaPump() {
  try {
    if (evaPumpT) { clearTimeout(evaPumpT); evaPumpT = null; }
    if (evaSpeaking || !evaQueue.length) return;
    const t = evaNow();
    if (t < evaNextOk) { evaPumpT = setTimeout(evaPump, (evaNextOk - t) * 1000 + 10); return; }
    const head = evaQueue[0];
    if (t - head.at > EVA_MAX_AGE) { evaQueue.shift(); evaPump(); return; }
    const clip = evaClips.get(head.id) || evaLoad(head.id);
    if (clip.state === 'loading') { evaPumpT = setTimeout(evaPump, 120); return; }
    evaQueue.shift();
    if (clip.state !== 'ready' || !ctx || muted) { evaPump(); return; } // skip silently
    const src = ctx.createBufferSource();
    src.buffer = clip.buf;
    src.connect(evaOut());
    const done = () => {
      if (!evaSpeaking || evaSpeaking.src !== src) return;
      clearTimeout(evaSpeaking.watchdog);
      evaSpeaking = null;
      evaDuck(false);
      evaNextOk = evaNow() + EVA_GAP;
      evaPump();
    };
    src.onended = done;
    evaSpeaking = { id: head.id, src, watchdog: setTimeout(done, src.buffer.duration * 1000 + 600) };
    evaDuck(true);
    src.start();
  } catch {
    evaSpeaking = null; // a broken clip must never wedge the queue
  }
}

export function announce(id) {
  try {
    const line = EVA_LINES[id];
    if (!line || muted) return;
    ensureAudio(); // no-op headless; resumes/creates the ctx in a browser
    const t = evaNow();
    if (line.once && evaOnce.has(id)) return;
    const last = evaLast.get(id);
    if (last != null && t - last < (line.cd ?? 3)) return;
    evaLast.set(id, t);
    if (line.once) evaOnce.add(id);
    evaLoad(id);
    const pri = line.pri ?? 0;
    if (evaSpeaking && pri >= 2 && evaSpeaking.id !== id) evaStop(); // preempt
    if (evaQueue.some(q => q.id === id)) return; // already waiting its turn
    const entry = { id, pri, at: t };
    if (pri > 0) {
      let i = 0;
      while (i < evaQueue.length && evaQueue[i].pri >= pri) i++;
      evaQueue.splice(i, 0, entry);
    } else {
      evaQueue.push(entry);
    }
    evaPump();
  } catch { /* the announcer never breaks the game */ }
}

function evaOnEvent(ev) {
  try {
    const wire = EVA_WIRES[ev.type];
    const id = wire && wire(ev);
    if (id) announce(id);
  } catch { /* bad payloads stay silent */ }
}

function updateButton(btn) {
  if (btn) btn.textContent = muted ? 'Audio: Off' : 'Audio: On';
}

export function setupAudioToggle(btn, key = 'holdout.audio.muted') {
  if (typeof window === 'undefined') return; // headless (tests): no DOM, no storage
  storageKey = key;
  muted = localStorage.getItem(storageKey) === '1';
  updateButton(btn);
  const unlock = () => ensureAudio();
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });
  if (btn) {
    btn.onclick = () => {
      ensureAudio();
      muted = !muted;
      localStorage.setItem(storageKey, muted ? '1' : '0');
      updateButton(btn);
      if (!muted) playUi('pickup');
    };
  }
}

function tone(freq, dur, type = 'square', gain = 0.14, slide = 1, dest = null) {
  const ac = ensureAudio();
  if (!ac || muted) return;
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), now + dur);
  vol.gain.setValueAtTime(0.0001, now);
  vol.gain.exponentialRampToValueAtTime(gain, now + 0.01);
  vol.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(vol);
  vol.connect(dest || sfxBus);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

function noise(dur, gain = 0.12, filterFreq = 1200, dest = null) {
  const ac = ensureAudio();
  if (!ac || muted) return;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  const filt = ac.createBiquadFilter();
  const vol = ac.createGain();
  src.buffer = buf;
  filt.type = 'bandpass';
  filt.frequency.value = filterFreq;
  vol.gain.setValueAtTime(gain, ac.currentTime);
  vol.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  src.connect(filt);
  filt.connect(vol);
  vol.connect(dest || sfxBus);
  src.start();
}

// A thunder crack: a sharp noise transient over a deep rolling sub-rumble.
// `power` 0..1 scales the wallop (relic awaken = full, periodic cracks softer).
function thunder(power = 1) {
  const ac = ensureAudio();
  if (!ac || muted) return;
  noise(0.06, 0.16 * power, 5200);                         // the crack
  setTimeout(() => noise(0.5, 0.12 * power, 240), 40);     // the rolling boom
  tone(46, 0.9 * power + 0.3, 'sine', 0.16 * power, 0.5);  // deep sub-rumble
  setTimeout(() => noise(0.7, 0.05 * power, 120), 180);    // tail roll
}

function shot(kind, who, ev = null) {
  if (who === 'e') {
    tone(kind === 'sniper' ? 520 : 220, 0.08, 'sawtooth', 0.08, 0.55);
    return;
  }
  // per-evolution flavor riding the muzzle voice — defensive: only when the
  // sim ships evolution hints on the shoot event (absent today, lands later)
  const evo = ev?.evo ?? (ev?.ignite ? 'burn' : ev?.stun ? 'shock' : ev?.aoeRadius ? 'blast' : null);
  if (evo === 'burn') noise(0.09, 0.04, 600);
  else if (evo === 'shock') noise(0.04, 0.05, 4200);
  else if (evo === 'blast') tone(110, 0.07, 'triangle', 0.06, 0.6);
  else if (evo === 'multi') setTimeout(() => tone(520, 0.03, 'square', 0.03, 1.15), 40);
  if (kind === 'rail') { tone(1080, 0.08, 'sawtooth', 0.13, 1.8); tone(260, 0.06, 'square', 0.08, 0.7); }
  else if (kind === 'mortar' || kind === 'comet' || kind === 'cannon' || kind === 'rivet') { tone(150, 0.13, 'triangle', 0.18, 0.45); noise(0.08, 0.08, 240); }
  else if (kind === 'scatter') { noise(0.08, 0.16, 1700); tone(180, 0.05, 'square', 0.08, 0.65); }
  else if (kind === 'flame') { noise(0.11, 0.1, 520); tone(260, 0.05, 'sawtooth', 0.05, 0.85); }
  else if (kind === 'disc' || kind === 'helix') { tone(420, 0.1, 'triangle', 0.1, 1.35); }
  else if (kind === 'blade') { tone(760, 0.04, 'triangle', 0.08, 0.8); }
  else if (kind === 'harpoon') { tone(880, 0.08, 'square', 0.1, 0.45); noise(0.06, 0.05, 1600); } // line twang
  else if (kind === 'riptide') { noise(0.16, 0.11, 460); tone(290, 0.12, 'sine', 0.07, 0.65); } // water burst
  else if (kind === 'toxin') { tone(220, 0.06, 'sine', 0.07, 0.6); noise(0.1, 0.04, 800); } // glob lob
  else if (kind === 'tornado') { noise(0.18, 0.07, 380); tone(160, 0.14, 'triangle', 0.05, 1.3); } // wind-up
  // field weapon pickups
  else if (kind === 'flamer') { noise(0.13, 0.11, 460); tone(200, 0.07, 'sawtooth', 0.05, 0.8); } // burning gout
  else if (kind === 'railcannon') { tone(1480, 0.12, 'sawtooth', 0.14, 2.0); tone(170, 0.1, 'square', 0.1, 0.55); noise(0.06, 0.06, 3200); } // heavy lance
  else if (kind === 'stormgun') { noise(0.07, 0.13, 3800); tone(90, 0.08, 'square', 0.08, 0.6); } // coil crack
  else if (kind === 'mortarMk2') { tone(120, 0.18, 'triangle', 0.2, 0.4); noise(0.11, 0.09, 190); } // deep thump
  // remaining roster voices, each its own hand-feel
  else if (kind === 'needle') tone(980, 0.05, 'triangle', 0.07, 1.3); // medic's sliver
  else if (kind === 'twin') { tone(540, 0.04, 'square', 0.08, 1.1); setTimeout(() => tone(540, 0.04, 'square', 0.07, 1.1), 60); } // raider pair
  else if (kind === 'spark') { noise(0.05, 0.09, 3600); tone(440, 0.04, 'square', 0.05, 1.4); } // volt arc-pistol
  else if (kind === 'slug') { tone(190, 0.09, 'square', 0.13, 0.6); noise(0.05, 0.05, 700); } // warden's heavy bore
  else if (kind === 'ghost') { noise(0.09, 0.05, 1400); tone(660, 0.08, 'sine', 0.05, 0.7); } // shade's whisper round
  else { tone(520, 0.05, 'square', 0.1, 1.15); }
}

// One tone per Monolythium rune (symbol 0-7): Anchor, Wave, Vertex, Seal,
// Fork, Burn, Quorum, Drift. A correct combination sounds like a chord
// finalizing — each settled stone adds a deeper supporting octave.
const GLYPH_TONES = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25];

// One NPC voice line, polarity-matched, twice gated (a global breath between
// any two lines plus a per-polarity cooldown). Returns true when VO played.
// Dialogue rides the voice bus (with EVA), not the sfx bus.
function sayVO(pol, voice, vol = 0.55, cd = 1.2) {
  const lines = DIALOGUE[pol]?.[voice];
  if (!lines) return false;
  if (!cueGate('vo-any', 0.8) || !cueGate(`vo-${pol}`, cd)) return false;
  return playFile(lines, `vo-${pol}-${voice}`, vol, 1, voiceBus);
}

// Additive combat-vocal flavor on top of the synth hits (never replaces the
// arcade ticks): enemy pain/death by kind family, operator grunts, spotters
// calling targets. Deterministic rotation + cooldown gates keep hordes sane.
function vocalEvent(ev) {
  if (ev.type === 'hit' && ev.kind) {
    const fam = VOX_FAM[ev.kind];
    if (fam && cueGate('vox-hit', 0.3)) {
      const key = `vox-hit-${fam}`;
      playFile(fam === 'F' ? VOX.hitF : VOX.hitM, key, 0.26, 0.95 + ((seq.get(key) ?? 0) % 4) * 0.035);
    }
  } else if (ev.type === 'die' && ev.kind) {
    if (ev.kind === 'boss') { playFile(VOX.dieBig, 'vox-die-big', 0.45); return; }
    const fam = VOX_FAM[ev.kind];
    if (fam && cueGate('vox-die', 0.35)) {
      const key = `vox-die-${fam}`;
      playFile(fam === 'F' ? VOX.dieF : VOX.dieM, key, 0.32, 0.94 + ((seq.get(key) ?? 0) % 5) * 0.03);
    }
  } else if (ev.type === 'telegraph' || ev.type === 'aim') {
    if (cueGate('vox-shout', 3.5)) playFile(VOX.shout, 'vox-shout', 0.28);
  } else if (ev.type === 'playerHit') {
    if (cueGate('vox-grunt', 0.9)) playFile(VOX.grunt, 'vox-grunt', 0.4);
  } else if (ev.type === 'quest' && ev.state === 'done') {
    sayVO('completion', npcVoice(ev.id), 0.55, 2.5); // turn-in payoff under the chime
  } else if (ev.type === 'hired') {
    sayVO('confirmation', npcVoice(ev.pid ?? ev.name), 0.5, 2); // "you got it" by the fire
  }
}

// Asset-first interaction cues: when the pack clip is loaded it REPLACES the
// synth voice for that event (return true short-circuits the switch below);
// missing/still-loading clips return false and the synth covers, so the game
// sounds right on the very first chest of a fresh cache.
function assetEvent(ev) {
  switch (ev.type) {
    case 'chest': return playFile(CUE.chest, 'chest', 0.5);
    case 'buy': return playFile(CUE.buy, 'buy', 0.42);
    case 'built': { playFile(CUE.built, 'built', 0.5); return false; } // impact under the relay-hum synth
    case 'switch': {
      const played = playFile(CUE.switch, 'switch', 0.5);
      if (played && ev.on !== false) setTimeout(() => playFile(CUE.ting, 'switch-on', 0.28), 90);
      return played;
    }
    case 'teleport': return playFile(CUE.teleport, 'teleport', 0.38);
    case 'doorOpen': return playFile(CUE.door, 'door', 0.45);
    case 'glyph':
    case 'glyphLit': {
      const i = ((Math.round(ev.symbol ?? 0) % 8) + 8) % 8;
      return playFile([CUE.glyph[i]], `glyph-${i}`, 0.5); // rune-indexed, not rotated
    }
    case 'glyphReset': return playFile(CUE.glyphFail, 'glyphFail', 0.5);
    case 'buildDown': return playFile(CUE.crash, 'crash', 0.5);
    case 'beaconDown': { playFile(CUE.crash, 'crash', 0.45); return false; } // crash under the dark synth toll
    case 'coreHit': { if (cueGate('coreCrash', 1.2)) playFile(CUE.crash, 'crash', 0.32); return false; } // alarm stays
    case 'coreDown': { playFile(CUE.longCrash, 'longCrash', 0.55); return false; } // keep the fail sting
    case 'shipDown': { playFile(CUE.longCrash, 'shipDown', 0.38); return false; } // touchdown under the engine roar
    case 'shipLaunch': { playFile(CUE.riser, 'shipLaunch', 0.5); return false; }
    case 'sealForged': { playFile(CUE.fanfare, 'sealForged', 0.5); return false; }
    case 'turretType': return playFile(CUE.turretType, 'turretType', 0.45);
    case 'upgrade':
    case 'towerUp':
    case 'buildUp': return playFile(CUE.upgrade, 'upgrade', 0.45); // future-proofed: no current emitter
    case 'talk': {
      const id = ev.npcId ?? ev.name;
      const pol = ev.gift ? 'completion' : talked.has(id) ? 'confirmation' : 'greeting';
      talked.add(id);
      return sayVO(pol, npcVoice(id), 0.55); // VO replaces the blip; blip covers when missing
    }
    case 'slotFull': return sayVO('refusal', npcVoice('the-clerk'), 0.5, 2);
  }
  return false;
}

export function playEvent(ev) {
  if (muted) return;
  evaOnEvent(ev); // EVA announcer rides the same funnel as the sfx
  try {
    vocalEvent(ev);              // additive flavor (combat vocals, VO payoffs)
    if (assetEvent(ev)) return;  // pack cue replaced the synth for this event
  } catch { /* asset layer must never silence the synth engine */ }
  if (ev.type === 'shoot') shot(ev.weapon, ev.who, ev);
  else if (ev.type === 'hit') tone(310, 0.04, 'square', 0.07, 0.7);
  else if (ev.type === 'hitWall' || ev.type === 'shield') noise(0.05, 0.08, 900);
  else if (ev.type === 'die') { tone(150, 0.11, 'sawtooth', 0.12, 0.45); noise(0.09, 0.08, 360); }
  else if (ev.type === 'explode') { tone(90, 0.2, 'sawtooth', 0.2, 0.35); noise(0.18, 0.15, 180); }
  else if (ev.type === 'pickup') { tone(520, 0.08, 'triangle', 0.08, 1.4); tone(780, 0.08, 'triangle', 0.06, 1.25); }
  else if (ev.type === 'extract' || ev.type === 'clear') playUi('clear');
  else if (ev.type === 'down' || ev.type === 'fail') playUi('fail');
  else if (ev.type === 'lowTime') tone(660, 0.08, 'square', 0.12, 0.6);
  else if (ev.type === 'spawn' || ev.type === 'spawnEnemy') tone(360, 0.07, 'triangle', 0.07, 1.25);
  else if (ev.type === 'telegraph' || ev.type === 'aim') tone(620, 0.06, 'sine', 0.05, 1.05);
  // --- Anchorfall events ---
  else if (ev.type === 'shard') {
    // bright LYTH chime
    tone(1175, 0.06, 'sine', 0.07, 1.2);
    setTimeout(() => tone(1760, 0.09, 'sine', 0.05, 1.15), 45);
  }
  else if (ev.type === 'build') tone(420, 0.03, 'square', 0.025, 0.9); // quiet work tick
  else if (ev.type === 'built') {
    // deep thunk + relay hum
    tone(92, 0.16, 'triangle', 0.2, 0.7);
    noise(0.05, 0.05, 320);
    setTimeout(() => tone(228, 0.32, 'sine', 0.05, 1.02), 60);
  }
  else if (ev.type === 'buildHit') noise(0.05, 0.07, 650);
  else if (ev.type === 'buildDown') {
    // structural crack
    noise(0.12, 0.13, 2100);
    tone(120, 0.16, 'sawtooth', 0.11, 0.5);
  }
  else if (ev.type === 'gateOpen') {
    // low boom swell — the Anchor wakes
    tone(52, 1.1, 'sine', 0.22, 2.2);
    noise(0.7, 0.07, 140);
    setTimeout(() => tone(330, 0.5, 'triangle', 0.07, 1.6), 250);
  }
  else if (ev.type === 'talk') tone(720, 0.05, 'sine', 0.05, 1.12);
  else if (ev.type === 'special') {
    // energy whoosh
    noise(0.16, 0.1, 1500);
    setTimeout(() => noise(0.12, 0.08, 600), 70);
  }
  else if (ev.type === 'dash') noise(0.1, 0.07, 950);
  else if (ev.type === 'crystal') {
    // glassy LYTH crack
    tone(1568, 0.1, 'triangle', 0.07, 0.72);
    noise(0.07, 0.05, 2800);
  }
  else if (ev.type === 'wave') {
    // nightwave incoming — low dread swell + two alarm knocks
    tone(58, 1.0, 'sawtooth', 0.12, 2.6);
    noise(0.7, 0.05, 200);
    setTimeout(() => tone(466.16, 0.1, 'square', 0.07, 0.8), 380);
    setTimeout(() => tone(466.16, 0.12, 'square', 0.06, 0.7), 560);
  }
  // --- frontier survival / bastion / versus events ---
  else if (ev.type === 'playerHit') {
    // armor thud — heavier than an enemy hit
    tone(180, 0.1, 'sawtooth', 0.12, 0.55);
    noise(0.07, 0.07, 500);
  }
  else if (ev.type === 'crackerOut') {
    // the lure lands: clack + fizzing fuse
    tone(340, 0.05, 'square', 0.08, 0.7);
    noise(0.12, 0.04, 2400);
  }
  else if (ev.type === 'crackerBoom') {
    tone(80, 0.22, 'sawtooth', 0.2, 0.4);
    noise(0.2, 0.14, 220);
  }
  else if (ev.type === 'volatile') {
    // mutant pop — sharper, smaller than a full explosion
    tone(110, 0.16, 'sawtooth', 0.15, 0.4);
    noise(0.13, 0.1, 320);
  }
  else if (ev.type === 'dusk') {
    // the dusk horn — two long low calls over the walls
    tone(98, 0.9, 'sawtooth', 0.09, 1.0);
    tone(147, 0.9, 'triangle', 0.05, 1.0);
    setTimeout(() => { tone(98, 1.2, 'sawtooth', 0.08, 1.26); tone(196, 1.0, 'triangle', 0.04, 1.0); }, 700);
  }
  else if (ev.type === 'horn') {
    // the operators answer first: the dusk horn's calls, a fourth up —
    // defiant rather than dreadful (the real dusk follows 5s later)
    tone(131, 0.8, 'sawtooth', 0.09, 1.05);
    tone(196, 0.8, 'triangle', 0.05, 1.0);
    setTimeout(() => { tone(131, 1.0, 'sawtooth', 0.08, 1.3); tone(262, 0.8, 'triangle', 0.04, 1.0); }, 600);
  }
  else if (ev.type === 'probe') {
    // scavengers on the wind — one short uneasy knock
    tone(311, 0.12, 'square', 0.06, 0.8);
    noise(0.18, 0.04, 240);
  }
  else if (ev.type === 'supplyDrop') {
    // inbound whistle falling to a thump
    tone(1175, 0.55, 'sine', 0.05, 0.5);
    setTimeout(() => { tone(70, 0.22, 'sawtooth', 0.14, 0.5); noise(0.16, 0.1, 220); }, 500);
  }
  else if (ev.type === 'dawn') {
    // first light — rising soft chime
    tone(392, 0.5, 'sine', 0.06, 1.25);
    setTimeout(() => tone(587.33, 0.7, 'sine', 0.05, 1.12), 220);
    setTimeout(() => tone(784, 1.0, 'triangle', 0.04, 1.05), 460);
  }
  else if (ev.type === 'bloodWarn') {
    // blood moon dread sting — grinding minor cluster + slow swell
    tone(62, 1.6, 'sawtooth', 0.12, 1.4);
    tone(66, 1.6, 'sawtooth', 0.1, 1.45);
    noise(1.1, 0.05, 130);
    setTimeout(() => tone(124.5, 0.8, 'sawtooth', 0.07, 0.5), 600);
  }
  else if (ev.type === 'coreHit') {
    // core alarm: two clipped beeps over a deep thunk
    tone(880, 0.09, 'square', 0.09, 1);
    tone(110, 0.12, 'triangle', 0.12, 0.6);
    setTimeout(() => tone(880, 0.09, 'square', 0.08, 1), 140);
  }
  else if (ev.type === 'coreDown') {
    tone(60, 1.2, 'sawtooth', 0.22, 0.3);
    noise(0.9, 0.14, 110);
    setTimeout(() => playUi('fail'), 350);
  }
  else if (ev.type === 'trample') noise(0.09, 0.08, 800); // crops crushed
  else if (ev.type === 'repair') {
    // two wrench ticks
    tone(1200, 0.03, 'square', 0.04, 0.9);
    setTimeout(() => tone(900, 0.03, 'square', 0.03, 0.85), 70);
  }
  else if (ev.type === 'buy') {
    // shard-spend chime
    tone(932, 0.07, 'triangle', 0.08, 1.2);
    setTimeout(() => tone(1397, 0.1, 'triangle', 0.06, 1.1), 70);
  }
  else if (ev.type === 'chest') {
    // latch + sparkle
    noise(0.05, 0.06, 700);
    setTimeout(() => { tone(1047, 0.08, 'sine', 0.06, 1.2); tone(1568, 0.1, 'sine', 0.04, 1.1); }, 60);
  }
  else if (ev.type === 'heal') {
    // warm mend
    tone(523, 0.16, 'sine', 0.07, 1.18);
    setTimeout(() => tone(784, 0.22, 'sine', 0.05, 1.08), 110);
  }
  else if (ev.type === 'mount') { noise(0.06, 0.07, 420); tone(196, 0.07, 'triangle', 0.07, 0.85); }
  else if (ev.type === 'dismount') noise(0.05, 0.05, 360);
  else if (ev.type === 'hired') {
    // a handshake by the signal fire
    tone(440, 0.08, 'triangle', 0.07, 1.1);
    setTimeout(() => tone(659, 0.12, 'triangle', 0.06, 1.05), 90);
  }
  else if (ev.type === 'capture') {
    // capture fanfare
    tone(523, 0.1, 'triangle', 0.1, 1.05);
    setTimeout(() => tone(659, 0.1, 'triangle', 0.09, 1.05), 110);
    setTimeout(() => tone(784, 0.12, 'triangle', 0.09, 1.04), 220);
    setTimeout(() => tone(1047, 0.22, 'triangle', 0.08, 1.0), 330);
  }
  else if (ev.type === 'flagTaken') {
    tone(740, 0.09, 'square', 0.08, 0.85);
    setTimeout(() => tone(587, 0.09, 'square', 0.07, 0.85), 110);
  }
  else if (ev.type === 'flagReturn') {
    tone(587, 0.08, 'triangle', 0.07, 1.1);
    setTimeout(() => tone(880, 0.1, 'triangle', 0.06, 1.05), 90);
  }
  else if (ev.type === 'eliminated') {
    tone(140, 0.3, 'sawtooth', 0.13, 0.45);
    noise(0.16, 0.08, 240);
  }
  else if (ev.type === 'matchEnd') playUi('clear');
  else if (ev.type === 'zoneShrink') {
    // the zone hum — rising pressure
    tone(55, 1.4, 'sine', 0.14, 1.5);
    tone(110, 1.2, 'sine', 0.07, 1.5);
    noise(0.8, 0.03, 90);
  }
  // --- combat depth: xp, evolutions, tower types, followers ---
  else if (ev.type === 'levelUp') {
    // on-the-spot leveling — quick rising gold arpeggio
    tone(523.25, 0.09, 'triangle', 0.09, 1.05);
    setTimeout(() => tone(659.25, 0.09, 'triangle', 0.08, 1.05), 80);
    setTimeout(() => tone(784, 0.1, 'triangle', 0.08, 1.04), 160);
    setTimeout(() => tone(1046.5, 0.2, 'triangle', 0.07, 1.0), 240);
  }
  else if (ev.type === 'prismBeam') {
    // charge hum, then the beam snaps
    tone(196, 0.22, 'sine', 0.06, 2.2);
    setTimeout(() => { tone(1318, 0.12, 'sawtooth', 0.08, 1.3); noise(0.06, 0.04, 3400); }, 60);
  }
  else if (ev.type === 'teslaZap') {
    // the crack of the coil
    noise(0.09, 0.16, 4200);
    tone(70, 0.12, 'square', 0.1, 0.5);
    setTimeout(() => noise(0.05, 0.07, 2600), 40);
  }
  else if (ev.type === 'converted') {
    // psychic warble — pitch bending up then settling back
    tone(440, 0.45, 'sine', 0.08, 1.7);
    setTimeout(() => tone(740, 0.35, 'sine', 0.06, 0.55), 140);
    setTimeout(() => tone(560, 0.3, 'triangle', 0.05, 1.25), 300);
  }
  else if (ev.type === 'toxin' || ev.type === 'toxinOut' || ev.type === 'toxinPatch'
    || (ev.type === 'patch' && ev.kind === 'toxin')) {
    // chem hiss as the slick spreads
    noise(0.45, 0.08, 700);
    setTimeout(() => noise(0.3, 0.04, 1700), 120);
  }
  else if (ev.type === 'patch') {
    // ground fire takes hold — low whoomp under a settling crackle
    tone(90, 0.22, 'sawtooth', 0.08, 0.5);
    noise(0.3, 0.06, 420);
    setTimeout(() => noise(0.22, 0.04, 900), 140);
  }
  else if (ev.type === 'ambientHazard') {
    // a themed environment hazard bit an unmasked operative — a quiet, gated
    // per-kind cue (the bleed ticks every ~8s, but gate anyway so co-op stacks
    // never pile up): geiger blip (radiation), chem hiss (toxin), heat sizzle.
    if (cueGate('ambient-hz', 0.7)) {
      if (ev.kind === 'radiation') { tone(1500, 0.03, 'square', 0.05, 1.0); setTimeout(() => tone(2100, 0.02, 'square', 0.04, 1.0), 60); }
      else if (ev.kind === 'toxin') { noise(0.3, 0.06, 760); }
      else { noise(0.2, 0.05, 500); tone(120, 0.1, 'sawtooth', 0.05, 0.6); } // fire sizzle
    }
  }
  else if (ev.type === 'turretType') {
    // type confirmed off the carousel — two-step servo chirp
    tone(620, 0.06, 'square', 0.06, 1.0);
    setTimeout(() => tone(932, 0.09, 'square', 0.05, 1.02), 70);
  }
  else if (ev.type === 'followerHit') {
    // a hire takes a knock — small dry thud
    tone(250, 0.05, 'square', 0.06, 0.6);
    noise(0.04, 0.04, 600);
  }
  else if (ev.type === 'bark' || ev.type === 'followerEngage') {
    // attack dog barks onto a target
    tone(180, 0.07, 'sawtooth', 0.13, 0.55);
    noise(0.04, 0.05, 900);
    setTimeout(() => { tone(160, 0.09, 'sawtooth', 0.11, 0.5); noise(0.05, 0.04, 800); }, 120);
  }
  else if (ev.type === 'followerDown') {
    // a hire falls — short falling whimper
    tone(420, 0.16, 'sine', 0.07, 0.5);
    setTimeout(() => tone(260, 0.18, 'sine', 0.05, 0.55), 110);
  }
  // --- frontier III: quests, puzzle systems, field weapons ---
  else if (ev.type === 'switch') {
    // breaker clunk; coming ON earns a small gold confirmation
    tone(140, 0.07, 'square', 0.12, 0.7);
    noise(0.05, 0.06, 500);
    if (ev.on !== false) setTimeout(() => tone(523.25, 0.12, 'sine', 0.05, 1.1), 90);
  }
  else if (ev.type === 'glyph' || ev.type === 'glyphLit') {
    // the rune settles with a deepening tone (one per rune symbol)
    const f = GLYPH_TONES[((Math.round(ev.symbol ?? 0) % 8) + 8) % 8];
    tone(f, 0.4, 'sine', 0.09, 1.0);
    tone(f / 2, 0.55, 'triangle', 0.045, 1.0); // the deepening under-octave
  }
  else if (ev.type === 'glyphReset') {
    // wrong rune: a low flat chord and a cough of drift-static
    tone(110, 0.5, 'sawtooth', 0.09, 0.96);
    tone(116.54, 0.5, 'sawtooth', 0.08, 0.96); // a flat semitone against it
    noise(0.25, 0.07, 900);
  }
  else if (ev.type === 'pillarDown') {
    // obsolete cryptography comes down: stone rumble + cracking
    tone(70, 0.5, 'sawtooth', 0.16, 0.4);
    noise(0.5, 0.13, 240);
    setTimeout(() => noise(0.3, 0.08, 160), 180);
  }
  else if (ev.type === 'sealForged') {
    // the forge roar, then the Combining settles checkpoint gold
    noise(0.7, 0.13, 300);
    tone(65, 0.8, 'sawtooth', 0.1, 1.3);
    setTimeout(() => { tone(523.25, 0.3, 'triangle', 0.08, 1.0); tone(659.25, 0.4, 'triangle', 0.06, 1.0); }, 350);
    setTimeout(() => tone(1046.5, 0.6, 'sine', 0.06, 1.0), 600);
  }
  else if (ev.type === 'doorOpen') {
    // bulkhead hiss + servo + the latch seating
    noise(0.35, 0.09, 1300);
    tone(90, 0.3, 'triangle', 0.07, 1.4);
    setTimeout(() => tone(180, 0.06, 'square', 0.05, 0.8), 320);
  }
  else if (ev.type === 'teleport') {
    // the blink zip: one missed heartbeat, then you're already there
    tone(660, 0.12, 'sine', 0.08, 2.4);
    noise(0.08, 0.06, 2600);
    setTimeout(() => tone(1320, 0.07, 'sine', 0.05, 0.6), 90);
  }
  else if (ev.type === 'beacon') {
    // a checkpoint settles — two rising tones that simply stop arguing
    tone(392, 0.25, 'sine', 0.08, 1.0);
    setTimeout(() => tone(587.33, 0.4, 'sine', 0.06, 1.0), 180);
  }
  else if (ev.type === 'quest') {
    // ledger chime: a new entry rings up; completion resolves the chord
    if (ev.state === 'done') {
      tone(659.25, 0.1, 'triangle', 0.08, 1.0);
      setTimeout(() => tone(880, 0.12, 'triangle', 0.07, 1.0), 90);
      setTimeout(() => tone(1318.5, 0.2, 'triangle', 0.06, 1.0), 180);
    } else {
      tone(880, 0.09, 'sine', 0.07, 1.1);
      setTimeout(() => tone(1174.66, 0.12, 'sine', 0.05, 1.05), 100);
    }
  }
  else if (ev.type === 'fieldEmpty') tone(300, 0.05, 'square', 0.05, 0.6); // dry click — the weapon evaporates
  else if (ev.type === 'fieldPickup' || ev.type === 'pickupWeapon' || ev.type === 'weaponPickup') {
    // shouldering found hardware
    tone(494, 0.07, 'triangle', 0.07, 1.2);
    setTimeout(() => tone(740, 0.09, 'triangle', 0.06, 1.1), 70);
  }
  else if (ev.type === 'fieldDrop' || ev.type === 'dropWeapon') { noise(0.06, 0.06, 420); tone(180, 0.05, 'triangle', 0.05, 0.8); }
  else if (ev.type === 'qitem' || ev.type === 'questItem') {
    // a proof fragment found — bright and brief
    tone(1047, 0.07, 'sine', 0.06, 1.15);
    setTimeout(() => tone(1568, 0.09, 'sine', 0.04, 1.1), 60);
  }
  else if (ev.type === 'shielded' || ev.type === 'enemyShield') tone(330, 0.12, 'sine', 0.05, 0.7); // a ward wraps on
  else if (ev.type === 'shieldPop') { noise(0.06, 0.08, 2200); tone(520, 0.06, 'triangle', 0.06, 0.6); } // the absorb shatters
  else if (ev.type === 'blink') { noise(0.06, 0.06, 3000); tone(880, 0.06, 'sine', 0.05, 0.45); } // stalker zip
  else if (ev.type === 'zap' || ev.type === 'chainZap' || ev.type === 'voltZap' || ev.type === 'shockArc') {
    // a chain-zap leaps — smaller than the tesla coil's crack
    noise(0.07, 0.11, 4000);
    tone(80, 0.09, 'square', 0.08, 0.55);
  }
  else if (ev.type === 'pyreBurst') {
    // a pyre beetle pops — between a volatile mutant and a full explosion
    tone(100, 0.18, 'sawtooth', 0.16, 0.4);
    noise(0.15, 0.11, 300);
  }
  else if (ev.type === 'questProgress') tone(740, 0.05, 'sine', 0.045, 1.1); // ledger tick
  else if (ev.type === 'harvest') {
    tone(587.33, 0.08, 'triangle', 0.07, 1.15);
    setTimeout(() => tone(880, 0.1, 'triangle', 0.05, 1.08), 80);
  }
  else if (ev.type === 'slotFull') tone(220, 0.06, 'square', 0.05, 0.8); // dull refusal
  else if (ev.type === 'restock') {
    tone(392, 0.08, 'triangle', 0.06, 1.1);
    setTimeout(() => tone(523.25, 0.1, 'triangle', 0.05, 1.05), 90);
  }
  else if (ev.type === 'shieldUp') { tone(523.25, 0.1, 'sine', 0.06, 1.2); tone(784, 0.14, 'sine', 0.04, 1.1); }
  // --- frontier IV: stronghold beacons, the Anchorcraft, living terrain ---
  else if (ev.type === 'beaconDown') {
    // a monolith goes dark — descending toll over a dying hum
    tone(392, 0.3, 'triangle', 0.1, 0.5);
    tone(98, 0.8, 'sine', 0.08, 0.55);
    setTimeout(() => tone(196, 0.5, 'triangle', 0.07, 0.45), 260);
  }
  else if (ev.type === 'beaconLit' || ev.type === 'relight' || ev.type === 'beaconRelit') {
    // shards take and the beacon breathes again — three rising lights
    tone(392, 0.14, 'sine', 0.07, 1.1);
    setTimeout(() => tone(523.25, 0.16, 'sine', 0.07, 1.08), 130);
    setTimeout(() => { tone(784, 0.3, 'sine', 0.06, 1.04); tone(196, 0.4, 'triangle', 0.04, 1.0); }, 270);
  }
  else if (ev.type === 'shipDown') {
    // the Anchorcraft descends: long engine fall + ground thud
    tone(160, 1.6, 'sawtooth', 0.1, 0.28);
    noise(1.4, 0.07, 220);
    setTimeout(() => { tone(55, 0.4, 'sine', 0.16, 0.6); noise(0.3, 0.1, 150); }, 1500);
  }
  else if (ev.type === 'shipLaunch') {
    // full-clear extraction: engines spool up and the night lets you go
    tone(70, 1.8, 'sawtooth', 0.12, 4.2);
    noise(1.5, 0.07, 300);
    setTimeout(() => playUi('clear'), 900);
  }
  else if (ev.type === 'lavaSizzle' || ev.type === 'sizzle' || ev.type === 'lavaHurt') {
    // boots on the flow — short fry, gated so standing in it doesn't shriek
    if (cueGate('sizzle', 0.45)) { noise(0.18, 0.07, 2400); noise(0.12, 0.04, 900); }
  }
  else if (ev.type === 'footstep') {
    // sand scuff (only wired for soft terrain; gated hard — it's a texture)
    if (cueGate('footstep', 0.28)) noise(0.06, 0.025, 500);
  }
  else if (ev.type === 'mask' || ev.type === 'maskOn') {
    // the seal takes: canister hiss + a clean click
    noise(0.25, 0.06, 1700);
    setTimeout(() => tone(880, 0.04, 'square', 0.05, 0.9), 240);
  }
  else if (ev.type === 'toxicHurt' || ev.type === 'toxicTick') {
    // bad air in the lungs — low cough of static, heavily gated
    if (cueGate('toxic', 1.2)) { noise(0.2, 0.05, 650); tone(140, 0.12, 'sine', 0.04, 0.7); }
  }
  // --- RELIC AWAKENING horde event ---
  else if (ev.type === 'relicAwaken') {
    // the sky cracks open: a full thunder wallop + a long tense dread swell
    thunder(1);
    tone(40, 2.4, 'sawtooth', 0.14, 1.3);   // rising dread rumble
    setTimeout(() => { tone(58, 1.6, 'sawtooth', 0.1, 1.2); tone(311, 0.2, 'square', 0.07, 0.6); }, 500);
  }
  else if (ev.type === 'hordeBurst') {
    // periodic thunder through the storm, intensity climbing toward the climax;
    // gated so dense late bursts don't machine-gun the cracks
    if (cueGate('hordeThunder', 1.4)) thunder(0.4 + 0.5 * (ev.progress ?? 0));
  }
  else if (ev.type === 'horde') {
    // an edge breaches: a short low alarm knock (gated — fires per edge)
    if (cueGate('hordeEdge', 0.18)) { tone(62, 0.5, 'sawtooth', 0.08, 1.8); noise(0.3, 0.04, 200); }
  }
  else if (ev.type === 'nightmareDissolve') {
    // a leftover horror unravels: a brief reversed-shimmer hiss (heavily gated)
    if (cueGate('dissolve', 0.12)) { tone(420, 0.18, 'sine', 0.04, 0.4); noise(0.12, 0.04, 1800); }
  }
  else if (ev.type === 'relicSurvived') {
    // the storm breaks: a triumphant rising fanfare over a settling rumble
    tone(392, 0.16, 'triangle', 0.09, 1.05);
    setTimeout(() => tone(523.25, 0.16, 'triangle', 0.09, 1.05), 130);
    setTimeout(() => tone(659.25, 0.18, 'triangle', 0.09, 1.04), 260);
    setTimeout(() => { tone(1046.5, 0.45, 'triangle', 0.08, 1.0); tone(196, 0.6, 'sine', 0.05, 1.0); }, 400);
    setTimeout(() => playUi('clear'), 700);
  }
  else if (ev.type === 'relicFailed') {
    // the relic falls dormant: a grim descending toll + a dead thud
    thunder(0.6);
    tone(196, 0.7, 'sawtooth', 0.1, 0.45);
    setTimeout(() => tone(98, 1.0, 'sawtooth', 0.1, 0.4), 300);
    setTimeout(() => playUi('fail'), 500);
  }
  // --- POWER-UP DROPS (Black Ops Zombies-style) ---
  else if (ev.type === 'powerupDrop') {
    // a rare token materializes: a bright, beckoning two-note shimmer
    tone(1320, 0.07, 'sine', 0.06, 1.3);
    setTimeout(() => tone(1980, 0.1, 'sine', 0.05, 1.2), 60);
  }
  else if (ev.type === 'powerup') {
    // a friendly grabbed it: a short announcer-style sting, colored per type
    if (ev.ptype === 'nuke') {
      // ominous low boom into a rising whoosh
      tone(60, 0.35, 'sawtooth', 0.18, 0.5);
      noise(0.4, 0.1, 320);
      setTimeout(() => tone(110, 0.5, 'sawtooth', 0.1, 1.8), 180);
    } else if (ev.ptype === 'maxammo') {
      // bright ascending rank-up triad
      tone(523.25, 0.09, 'triangle', 0.09, 1.05);
      setTimeout(() => tone(659.25, 0.09, 'triangle', 0.09, 1.05), 80);
      setTimeout(() => tone(1046.5, 0.18, 'triangle', 0.08, 1.0), 160);
    } else if (ev.ptype === 'firesale') {
      // playful coin-cascade flourish
      tone(880, 0.06, 'square', 0.06, 1.2);
      setTimeout(() => tone(1175, 0.06, 'square', 0.06, 1.2), 70);
      setTimeout(() => tone(1568, 0.12, 'square', 0.05, 1.1), 140);
    } else if (ev.ptype === 'stamina') {
      // quick energetic zip
      tone(440, 0.07, 'triangle', 0.07, 1.6);
      noise(0.12, 0.05, 1600);
      setTimeout(() => tone(880, 0.12, 'triangle', 0.06, 1.2), 70);
    } else {
      // full health (and any fallback): a warm healing chime
      tone(659.25, 0.1, 'sine', 0.08, 1.1);
      setTimeout(() => tone(987.77, 0.16, 'sine', 0.07, 1.05), 90);
    }
  }
  // --- MOBA Wave D: timed traps + super weapons + prism shatter ---
  else if (ev.type === 'trapArm') {
    // a tight mechanical click as the trap latches live
    tone(660, 0.05, 'square', 0.06, 0.9);
    setTimeout(() => tone(990, 0.05, 'square', 0.05, 1.1), 60);
  }
  else if (ev.type === 'trapTrip') {
    // the snap + a short fiery whoosh as the patch blooms
    tone(180, 0.08, 'square', 0.1, 0.5);
    noise(0.14, 0.1, 900);
    setTimeout(() => noise(0.1, 0.06, 500), 60);
  }
  else if (ev.type === 'superBlast') {
    // a deep cannon swell into a rolling barrage roll — the team payload lands
    tone(48, 0.5, 'sawtooth', 0.22, 2.4);
    noise(0.5, 0.14, 240);
    setTimeout(() => { tone(90, 0.4, 'sawtooth', 0.16, 0.5); noise(0.4, 0.1, 160); }, 200);
    setTimeout(() => noise(0.6, 0.07, 110), 420);
  }
  else if (ev.type === 'prismDown') {
    // the neutral prism shatters: glassy crack + a settling shimmer
    noise(0.1, 0.12, 3200);
    tone(1318, 0.1, 'triangle', 0.07, 0.6);
    setTimeout(() => tone(523, 0.14, 'sine', 0.05, 0.7), 90);
  }
  // unknown event types stay silent, never throw
}

export function playUi(kind) {
  if (muted) return;
  if (kind === 'clear' || kind === 'victory') {
    tone(392, 0.09, 'triangle', 0.09, 1.05);
    setTimeout(() => tone(523, 0.1, 'triangle', 0.09, 1.08), 90);
    setTimeout(() => tone(784, 0.16, 'triangle', 0.08, 1.02), 180);
    try { playStoryBed(STORY_BEDS.ending, 'bed-ending'); } catch { /* synth fanfare stands alone */ }
  } else if (kind === 'fail') {
    tone(220, 0.18, 'sawtooth', 0.11, 0.6);
    setTimeout(() => tone(130, 0.2, 'sawtooth', 0.1, 0.55), 130);
  } else if (kind === 'cutscene') {
    // soft story sting — low relay tones swelling, never startling
    tone(196, 0.5, 'sine', 0.07, 1);
    setTimeout(() => tone(293.66, 0.6, 'sine', 0.06, 1), 160);
    setTimeout(() => tone(392, 0.8, 'triangle', 0.04, 1), 320);
    try { playStoryBed(STORY_BEDS.intro, 'bed-intro'); } catch { /* sting stands alone */ }
  } else if (kind === 'uiTick' || kind === 'tick' || kind === 'nav') {
    // level-select / menu navigation tick — pack click first, synth fallback
    if (!playFile(CUE.uiTick, 'uiTick', 0.32)) tone(700, 0.03, 'square', 0.045, 1.05);
  } else if (kind === 'unlock' || kind === 'fanfare') {
    // a new operator / level unlocks — triad swell with a ting on top
    const played = playFile(CUE.fanfare, 'unlock', 0.55);
    if (played) setTimeout(() => playFile(CUE.ting, 'unlock-ting', 0.35), 220);
    else {
      tone(523.25, 0.1, 'triangle', 0.09, 1.05);
      setTimeout(() => tone(659.25, 0.1, 'triangle', 0.08, 1.05), 100);
      setTimeout(() => tone(784, 0.12, 'triangle', 0.08, 1.03), 200);
      setTimeout(() => tone(1318.5, 0.3, 'triangle', 0.07, 1.0), 320);
    }
  } else {
    tone(600, 0.08, 'triangle', 0.07, 1.2);
  }
}
