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
  return ctx;
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
  } else {
    tone(600, 0.08, 'triangle', 0.07, 1.2);
  }
}
