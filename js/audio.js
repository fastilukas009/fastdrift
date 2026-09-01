// Kaikki äänet syntetisoidaan WebAudiolla - pelissä ei ole yhtään äänitiedostoa.
// Moottori rakentuu sytytystaajuuden harmonisista, renkaiden vinkuna suodatetusta
// kohinasta. Näin ääni seuraa fysiikkaa tarkasti eikä loopin saumoja kuule.

function noiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    // Kevyt integrointi tekee kohinasta ruskeampaa eli vähemmän sihisevää.
    last = (last + 0.02 * white) / 1.02;
    data[i] = white * 0.6 + last * 3.2;
  }
  return buf;
}

function distortionCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export class GameAudio {
  constructor() {
    this.ready = false;
    this.enabled = true;
    this.volume = 0.7;
    this.ctx = null;
  }

  init() {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.noise = noiseBuffer(ctx);

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(ctx.destination);

    // --- moottori: ristikampi-V8 ------------------------------------------
    // V8:n tunnistaa kahdesta asiasta: puolikkaista kertaluvuista (0.5x ja 1.5x
    // sytytystaajuudesta) ja kierroskohtaisesta "loikasta", joka syntyy kun pankit
    // eivät syty tasavälein. Molemmat mallinnetaan tässä suoraan.
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0.0;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = distortionCurve(1.9);
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 1.15;
    // Pakoputken resonanssi antaa rintakehään osuvan matalan möyryn.
    this.exhaust = ctx.createBiquadFilter();
    this.exhaust.type = 'peaking';
    this.exhaust.frequency.value = 105;
    this.exhaust.Q.value = 1.1;
    this.exhaust.gain.value = 9;
    this.engineBus.connect(this.shaper);
    this.shaper.connect(this.engineFilter);
    this.engineFilter.connect(this.exhaust);
    this.exhaust.connect(this.master);

    this.oscs = [];
    const harmonics = [
      { mul: 0.5, gain: 0.50, type: 'sawtooth', detune: -5 },
      { mul: 1.0, gain: 0.42, type: 'sawtooth', detune: 4 },
      { mul: 1.5, gain: 0.20, type: 'sawtooth', detune: -9 },
      { mul: 2.0, gain: 0.16, type: 'sawtooth', detune: 7 },
      { mul: 3.0, gain: 0.07, type: 'sawtooth', detune: -3 }
    ];
    for (const h of harmonics) {
      const o = ctx.createOscillator();
      o.type = h.type;
      o.detune.value = h.detune;
      const g = ctx.createGain();
      g.gain.value = h.gain;
      o.connect(g);
      g.connect(this.engineBus);
      o.start();
      this.oscs.push({ osc: o, mul: h.mul, gain: g, base: h.gain });
    }

    // Kierroskohtainen amplitudimodulaatio = V8:n loikka. Taajuus on kierrosluku
    // sekunneissa, ei sytytystaajuus, joten sykettä kuulee yksi per kierros.
    this.lope = ctx.createOscillator();
    this.lope.type = 'sine';
    this.lope.frequency.value = 20;
    this.lopeDepth = ctx.createGain();
    this.lopeDepth.gain.value = 0;
    this.lope.connect(this.lopeDepth);
    this.lopeDepth.connect(this.engineBus.gain);
    this.lope.start();

    // Imuäänen karheus pysyy hillittynä: liika kohina kuulostaa pölynimurilta.
    this.engineNoise = ctx.createBufferSource();
    this.engineNoise.buffer = this.noise;
    this.engineNoise.loop = true;
    this.engineNoiseFilter = ctx.createBiquadFilter();
    this.engineNoiseFilter.type = 'bandpass';
    this.engineNoiseFilter.frequency.value = 260;
    this.engineNoiseFilter.Q.value = 0.8;
    this.engineNoiseGain = ctx.createGain();
    this.engineNoiseGain.gain.value = 0;
    this.engineNoise.connect(this.engineNoiseFilter);
    this.engineNoiseFilter.connect(this.engineNoiseGain);
    this.engineNoiseGain.connect(this.master);
    this.engineNoise.start();

    // --- turbo ------------------------------------------------------------
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain);
    this.turboGain.connect(this.master);
    this.turbo.start();

    // --- renkaiden vinkuna -------------------------------------------------
    this.squealSrc = ctx.createBufferSource();
    this.squealSrc.buffer = this.noise;
    this.squealSrc.loop = true;
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 1200;
    this.squealFilter.Q.value = 5.5;
    this.squealFilter2 = ctx.createBiquadFilter();
    this.squealFilter2.type = 'bandpass';
    this.squealFilter2.frequency.value = 2400;
    this.squealFilter2.Q.value = 5;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squealSrc.connect(this.squealFilter);
    this.squealFilter.connect(this.squealFilter2);
    this.squealFilter2.connect(this.squealGain);
    this.squealGain.connect(this.master);
    this.squealSrc.start();

    // --- ajoviima ----------------------------------------------------------
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = this.noise;
    this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 700;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.windSrc.start();

    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && this.enabled) this.master.gain.value = v;
  }

  // Lyhyt kohinapurske: käytetään pamahduksiin, popoff-venttiiliin ja törmäyksiin.
  burst({ duration = 0.16, freq = 900, q = 2, gain = 0.5, type = 'bandpass', sweep = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + duration);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), now + duration);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.02);
  }

  blip(freq = 660, duration = 0.07, gain = 0.12, type = 'triangle') {
    if (!this.ready) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + duration);
    o.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + duration + 0.02);
  }

  backfire() {
    this.burst({ duration: 0.16, freq: 170, q: 0.9, gain: 0.6, sweep: 0.28 });
    this.burst({ duration: 0.07, freq: 1900, q: 0.6, gain: 0.14, type: 'highpass' });
  }
  blowoff() { this.burst({ duration: 0.22, freq: 3400, q: 1.4, gain: 0.16, type: 'highpass', sweep: 1.8 }); }
  crash(force) {
    const g = Math.min(0.8, 0.12 + force * 0.07);
    this.burst({ duration: 0.3, freq: 180, q: 0.6, gain: g, type: 'lowpass', sweep: 0.35 });
    this.burst({ duration: 0.09, freq: 2600, q: 0.8, gain: g * 0.4, type: 'highpass' });
  }
  scoreBank() { this.blip(880, 0.09, 0.10); setTimeout(() => this.blip(1320, 0.11, 0.09), 70); }
  scoreLost() { this.blip(300, 0.2, 0.11, 'sawtooth'); }
  clipHit() { this.blip(1560, 0.07, 0.09); }
  uiClick() { this.blip(520, 0.045, 0.06, 'square'); }

  update(dt, vehicle, opts = {}) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const spec = vehicle.spec;
    const rpm = vehicle.rpm;
    const throttle = opts.throttle || 0;

    // Kaikissa autoissa V8: kahdeksan sylinteriä, neljä sytytystä kierrosta kohti.
    const rev = rpm / 60;
    const f0 = Math.max(24, rev * 4);
    for (const o of this.oscs) {
      o.osc.frequency.setTargetAtTime(f0 * o.mul, now, 0.018);
    }

    const load = 0.30 + throttle * 0.70;
    const revShare = Math.min(1, rpm / spec.redline);
    const target = opts.muted ? 0 : (0.13 + load * 0.20) * (0.78 + revShare * 0.38);
    this.engineBus.gain.setTargetAtTime(target, now, 0.045);

    // Loikka kuuluu voimakkaimmin tyhjäkäynnillä ja häviää kierrosten noustessa.
    this.lope.frequency.setTargetAtTime(Math.max(6, rev), now, 0.03);
    this.lopeDepth.gain.setTargetAtTime(target * (0.42 - revShare * 0.30) * (1.15 - throttle * 0.45), now, 0.06);

    // Suodin aukeaa kaasulla: kiihdytyksessä ääni kirkastuu, kaasua nostaessa tummuu.
    this.engineFilter.frequency.setTargetAtTime(360 + revShare * 2100 + throttle * 1900, now, 0.045);
    this.engineFilter.Q.setTargetAtTime(1.0 + throttle * 0.9, now, 0.08);
    this.exhaust.frequency.setTargetAtTime(88 + revShare * 60, now, 0.06);

    this.engineNoiseFilter.frequency.setTargetAtTime(200 + revShare * 700, now, 0.06);
    this.engineNoiseGain.gain.setTargetAtTime(0.012 + throttle * 0.032 + revShare * 0.018, now, 0.06);

    const boost = Math.max(0, revShare - 0.35) * throttle;
    this.turbo.frequency.setTargetAtTime(2600 + revShare * 5200, now, 0.08);
    this.turboGain.gain.setTargetAtTime(boost * 0.035 * (spec.upgrades.turbo > 0 ? 1 : 0.35), now, 0.09);

    // Vinkuna kaikkien renkaiden yhteenlasketusta liukumasta.
    let slip = 0;
    for (const w of vehicle.wheels) slip += Math.max(0, w.slipSpeed - 1.6);
    slip = Math.min(1, slip / 26);
    const surfaceMul = opts.surfaceGrip !== undefined ? Math.max(0.25, opts.surfaceGrip) : 1;
    this.squealGain.gain.setTargetAtTime(slip * 0.105 * surfaceMul, now, 0.06);
    this.squealFilter.frequency.setTargetAtTime(950 + slip * 900 + Math.sin(now * 9) * 60, now, 0.05);
    this.squealFilter2.frequency.setTargetAtTime(2100 + slip * 1500, now, 0.05);

    const speed = vehicle.speed;
    this.windGain.gain.setTargetAtTime(Math.min(0.055, speed / 110 * 0.055), now, 0.14);
    this.windFilter.frequency.setTargetAtTime(300 + speed * 22, now, 0.12);
  }
}
