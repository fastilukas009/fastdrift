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

// Moottorin luonne. Sytytystaajuus on kierrokset kertaa sylinterit/2 (nelitahti
// sytyttaa joka toisella kierroksella), ja layout ratkaisee mita sen ymparille
// kuullaan:
//
//   puolikkaat kertaluvut (0.5x, 1.5x) = ristikampi-V8:n epatasainen sytytysvali,
//   se murina jonka jokainen tunnistaa amerikkalaisesta V8:sta. Tasakampinen
//   moottori ei tuota niita lainkaan, vaan kirkkaan ulvonnan.
//
//   lope = kierroskohtainen amplitudimodulaatio. Syva ristikampi-V8:lla,
//   olematon tasavalisilla moottoreilla.
//
//   cut = alipaastosuotimen lisavara. Korkeakierroksinen moottori tarvitsee
//   enemman ylapaata tai se kuulostaa tukahdutetulta.
const ENGINE_VOICES = {
  // Ristikampi-V8: puolikkaat kertaluvut ja syva loikka.
  v8cross: {
    lope: 1.0, cut: 0,
    harmonics: [
      { mul: 0.5, gain: 0.50, detune: -5 },
      { mul: 1.0, gain: 0.42, detune: 4 },
      { mul: 1.5, gain: 0.20, detune: -9 },
      { mul: 2.0, gain: 0.16, detune: 7 },
      { mul: 3.0, gain: 0.07, detune: -3 }
    ]
  },
  // Tasakampinen V8: ei puolikkaita, painopiste perustaajuudessa - kilpa-auton ulvonta.
  v8flat: {
    lope: 0.15, cut: 900,
    harmonics: [
      { mul: 1.0, gain: 0.52, detune: 3 },
      { mul: 2.0, gain: 0.26, detune: -6 },
      { mul: 3.0, gain: 0.14, detune: 5 },
      { mul: 4.0, gain: 0.07, detune: -4 }
    ]
  },
  // Boksterikuutonen: tasavalinen sytytys, mutta vastakkaiset pankit antavat
  // ominaisen karhean keskialueen.
  flat6: {
    lope: 0.25, cut: 700,
    harmonics: [
      { mul: 1.0, gain: 0.46, detune: 4 },
      { mul: 1.5, gain: 0.10, detune: -7 },
      { mul: 2.0, gain: 0.28, detune: -5 },
      { mul: 3.0, gain: 0.16, detune: 6 },
      { mul: 4.5, gain: 0.06, detune: -2 }
    ]
  },
  // V10: korkea sytytystaajuus ja runsas ylapaa - kirkuna, ei murina.
  v10: {
    lope: 0.0, cut: 2600,
    harmonics: [
      { mul: 1.0, gain: 0.44, detune: 2 },
      { mul: 2.0, gain: 0.30, detune: -5 },
      { mul: 2.5, gain: 0.12, detune: 8 },
      { mul: 3.0, gain: 0.20, detune: -3 },
      { mul: 4.0, gain: 0.11, detune: 6 }
    ]
  },
  // W16: sytytyksia niin tiheästi ettei yksittaista pamausta erota - matala,
  // yhtenainen mylvinta jonka paalla neljan ahtimen imu.
  w16: {
    lope: 0.35, cut: -150,
    harmonics: [
      { mul: 0.5, gain: 0.30, detune: -6 },
      { mul: 1.0, gain: 0.50, detune: 3 },
      { mul: 2.0, gain: 0.20, detune: -8 },
      { mul: 3.0, gain: 0.08, detune: 5 }
    ]
  }
};
const VOICE_SLOTS = 5;

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

    // Kiintea maara oskillaattoreita, joiden kertaluku ja voimakkuus vaihdetaan
    // auton mukana. Uusien luonti lennossa nakisi klikkina.
    this.oscs = [];
    for (let i = 0; i < VOICE_SLOTS; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g);
      g.connect(this.engineBus);
      o.start();
      this.oscs.push({ osc: o, mul: 1, gain: g, base: 0 });
    }
    this.voiceLayout = null;
    this.voiceCut = 0;
    this.voiceLope = 1;
    this.setVoice('v8cross');

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

  // Vaihtaa moottorin luonteen. Kaytossa olemattomat kertaluvut vaimennetaan
  // nollaan sen sijaan etta oskillaattori pysaytettaisiin - pysaytettya ei voi
  // kayttaa uudelleen.
  setVoice(layout) {
    if (!this.oscs || this.voiceLayout === layout) return;
    const v = ENGINE_VOICES[layout] || ENGINE_VOICES.v8cross;
    this.voiceLayout = layout;
    this.voiceCut = v.cut;
    this.voiceLope = v.lope;
    for (let i = 0; i < this.oscs.length; i++) {
      const h = v.harmonics[i];
      const slot = this.oscs[i];
      slot.mul = h ? h.mul : 1;
      slot.base = h ? h.gain : 0;
      if (h) slot.osc.detune.setTargetAtTime(h.detune, this.ctx.currentTime, 0.02);
      slot.gain.gain.setTargetAtTime(slot.base, this.ctx.currentTime, 0.05);
    }
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
  blowoff(strength = 1) {
    const k = Math.max(0.2, Math.min(1, strength));
    this.burst({ duration: 0.16 + k * 0.14, freq: 3400, q: 1.4, gain: 0.09 + k * 0.13, type: 'highpass', sweep: 1.8 });
    // Matala "puh" venttiilin auetessa - pelkka ylapaan sihina kuulostaa ohuelta.
    this.burst({ duration: 0.1 + k * 0.08, freq: 620, q: 1.0, gain: 0.05 + k * 0.07, sweep: 0.5 });
  }
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

    // Moottorin luonne auton mukaan. Nelitahti sytyttaa joka toisella
    // kierroksella, joten sytytystaajuus on kierrosnopeus kertaa sylinterit/2.
    const eng = spec.engine || { cylinders: 8, layout: 'v8cross' };
    this.setVoice(eng.layout);
    const rev = rpm / 60;
    const f0 = Math.max(24, rev * eng.cylinders * 0.5);
    for (const o of this.oscs) {
      if (o.base <= 0) continue;
      // Nyquistin yli menevä kertaluku vaimennetaan: muuten se laskostuu takaisin
      // kuuluvalle alueelle vieraana sivusävelenä.
      const f = f0 * o.mul;
      const nyq = ctx.sampleRate * 0.5;
      o.osc.frequency.setTargetAtTime(Math.min(f, nyq * 0.9), now, 0.018);
      if (f > nyq * 0.55) o.gain.gain.setTargetAtTime(o.base * Math.max(0, 1 - (f / nyq - 0.55) * 3), now, 0.05);
      else o.gain.gain.setTargetAtTime(o.base, now, 0.05);
    }

    const load = 0.30 + throttle * 0.70;
    const revShare = Math.min(1, rpm / spec.redline);
    const target = opts.muted ? 0 : (0.13 + load * 0.20) * (0.78 + revShare * 0.38);
    this.engineBus.gain.setTargetAtTime(target, now, 0.045);

    // Loikka kuuluu voimakkaimmin tyhjäkäynnillä ja häviää kierrosten noustessa.
    this.lope.frequency.setTargetAtTime(Math.max(6, rev), now, 0.03);
    this.lopeDepth.gain.setTargetAtTime(
      target * (0.42 - revShare * 0.30) * (1.15 - throttle * 0.45) * this.voiceLope, now, 0.06);

    // Suodin aukeaa kaasulla: kiihdytyksessä ääni kirkastuu, kaasua nostaessa tummuu.
    // voiceCut avaa suodinta korkeakierroksisille moottoreille: ilman sita V10:n
    // ylapaa leikkautuisi pois ja kirkuna kuulostaisi tukahdutetulta.
    this.engineFilter.frequency.setTargetAtTime(
      Math.max(220, 360 + this.voiceCut + revShare * 2100 + throttle * 1900), now, 0.045);
    this.engineFilter.Q.setTargetAtTime(1.0 + throttle * 0.9, now, 0.08);
    this.exhaust.frequency.setTargetAtTime(88 + revShare * 60, now, 0.06);

    this.engineNoiseFilter.frequency.setTargetAtTime(200 + revShare * 700, now, 0.06);
    this.engineNoiseGain.gain.setTargetAtTime(0.012 + throttle * 0.032 + revShare * 0.018, now, 0.06);

    // Ahdin ei seuraa kaasua hetkessä: siinä on massaa, joka kiihtyy ja hidastuu
    // viiveellä. Nousu on nopeampi kuin lasku, koska pakokaasu kiihdyttaa
    // turbiinia voimakkaammin kuin laakerikitka hidastaa sita.
    const turboLevel = spec.upgrades.turbo || 0;
    const boostTarget = Math.max(0, revShare - 0.35) * throttle;
    if (this.boost === undefined) this.boost = 0;
    const spoolRate = boostTarget > this.boost ? 3.4 : 1.7;
    this.boost += (boostTarget - this.boost) * Math.min(1, spoolRate * dt);
    this.turbo.frequency.setTargetAtTime(2600 + revShare * 5200, now, 0.08);
    this.turboGain.gain.setTargetAtTime(this.boost * 0.035 * (turboLevel > 0 ? 1 : 0.35), now, 0.09);

    // Popoff-venttiili: kaasun sulkeutuessa ahtimen tuottama paine purkautuu.
    // Se vaatii oikeasti painetta - tyhjakaynnilla kaasun nostaminen ei sihahda.
    this.bovTimer = Math.max(0, (this.bovTimer || 0) - dt);
    const lifted = (this.prevThrottle || 0) > 0.55 && throttle < 0.15;
    if (lifted && this.boost > 0.12 && this.bovTimer <= 0 && !opts.muted) {
      this.bovTimer = 0.35;
      this.blowoff(Math.min(1, this.boost * (0.5 + turboLevel * 0.35)));
      this.boost *= 0.35;
    }
    this.prevThrottle = throttle;

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
