let ctx = null;
let master = null;
let muted = false;
let storageKey = 'holdout.audio.muted';

function ensureAudio() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  master.gain.value = muted ? 0 : 0.55;
  startAmbient(); // gesture-gated by construction: ensureAudio runs on input
  return ctx;
}

// ============================== AMBIENT LOOP ==============================
// A very quiet generative bed — low drone + sparse pentatonic plucks, the
// Monolythium night mood under couch-TV gameplay. Routed through `master`,
// so the existing audio toggle silences it instantly. Started once, lazily,
// from ensureAudio (which only ever runs off a user gesture or game sound).
let amb = null;

function startAmbient() {
  if (amb || !ctx) return;
  const now = ctx.currentTime;
  const bed = ctx.createGain();
  bed.gain.setValueAtTime(0.0001, now);
  bed.gain.exponentialRampToValueAtTime(0.16, now + 8); // slow fade-in
  bed.connect(master);
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
    og.connect(master);
    o.start(t0);
    o.stop(t0 + 2.7);
  }, 3800);
  amb = { bed, timer };
}

function updateButton(btn) {
  if (btn) btn.textContent = muted ? 'Audio: Off' : 'Audio: On';
}

export function setupAudioToggle(btn, key = 'holdout.audio.muted') {
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

function tone(freq, dur, type = 'square', gain = 0.14, slide = 1) {
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
  vol.connect(master);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

function noise(dur, gain = 0.12, filterFreq = 1200) {
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
  vol.connect(master);
  src.start();
}

function shot(kind, who) {
  if (who === 'e') {
    tone(kind === 'sniper' ? 520 : 220, 0.08, 'sawtooth', 0.08, 0.55);
    return;
  }
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
  else { tone(520, 0.05, 'square', 0.1, 1.15); }
}

export function playEvent(ev) {
  if (muted) return;
  if (ev.type === 'shoot') shot(ev.weapon, ev.who);
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
  else if (ev.type === 'toxin' || ev.type === 'toxinOut' || ev.type === 'toxinPatch') {
    // chem hiss as the slick spreads
    noise(0.45, 0.08, 700);
    setTimeout(() => noise(0.3, 0.04, 1700), 120);
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
  // unknown event types stay silent, never throw
}

export function playUi(kind) {
  if (muted) return;
  if (kind === 'clear' || kind === 'victory') {
    tone(392, 0.09, 'triangle', 0.09, 1.05);
    setTimeout(() => tone(523, 0.1, 'triangle', 0.09, 1.08), 90);
    setTimeout(() => tone(784, 0.16, 'triangle', 0.08, 1.02), 180);
  } else if (kind === 'fail') {
    tone(220, 0.18, 'sawtooth', 0.11, 0.6);
    setTimeout(() => tone(130, 0.2, 'sawtooth', 0.1, 0.55), 130);
  } else if (kind === 'cutscene') {
    // soft story sting — low relay tones swelling, never startling
    tone(196, 0.5, 'sine', 0.07, 1);
    setTimeout(() => tone(293.66, 0.6, 'sine', 0.06, 1), 160);
    setTimeout(() => tone(392, 0.8, 'triangle', 0.04, 1), 320);
  } else {
    tone(600, 0.08, 'triangle', 0.07, 1.2);
  }
}
