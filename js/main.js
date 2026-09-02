// Pelin runko: renderöinti, kamerat, ajotilan logiikka ja mittariston piirto.

import * as THREE from '../vendor/three.module.min.js';
import { buildSpec, CAR_BY_ID } from './cars.js';
import { Vehicle } from './vehicle.js';
import { createTrack, TRACK_BY_ID } from './tracks.js';
import { DriftScorer } from './scoring.js';
import { Effects } from './fx.js';
import { buildCar, syncCarModel } from './carmodel.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { UI } from './ui.js';
import { PostFX } from './postfx.js';
import { loadSave, persist, persistNow, ensureCarState, recordRun } from './save.js';

const ENVIRONMENTS = {
  day: {
    top: '#3f7fd8', horizon: '#c9dcf0', ground: '#3a3f46',
    sun: [0.45, 0.72, 0.3], sunColor: 0xfff3dd, sunIntensity: 2.6,
    ambient: 0x9fb4cc, ambientIntensity: 0.85,
    fog: 0xb9cadd, fogDensity: 0.0024, exposure: 1.0,
    look: { tint: 0xfff8ee, vignette: 0.5, saturation: 1.12, contrast: 1.09 }
  },
  dusk: {
    top: '#1d2450', horizon: '#f2865a', ground: '#241d22',
    sun: [-0.62, 0.34, -0.36], sunColor: 0xffc08c, sunIntensity: 3.0,
    ambient: 0x7a6a8b, ambientIntensity: 1.15,
    fog: 0x86606a, fogDensity: 0.0032, exposure: 1.08,
    look: { tint: 0xffe2c4, vignette: 0.62, saturation: 1.18, contrast: 1.08 }
  },
  la: {
    top: '#2f74c8', horizon: '#f4c98d', ground: '#4a4640',
    sun: [-0.5, 0.42, 0.62], sunColor: 0xffd9a8, sunIntensity: 3.2,
    ambient: 0xa9bcd4, ambientIntensity: 1.1,
    fog: 0xd9c6ac, fogDensity: 0.0011, exposure: 1.02,
    look: { tint: 0xfff2dd, vignette: 0.46, saturation: 1.16, contrast: 1.08 }
  },
  night: {
    top: '#05070f', horizon: '#111a2c', ground: '#0a0c12',
    sun: [0.3, 0.6, -0.5], sunColor: 0x9fb6e0, sunIntensity: 0.5,
    ambient: 0x24304a, ambientIntensity: 0.55,
    fog: 0x0a0e18, fogDensity: 0.0072, exposure: 1.25,
    look: { tint: 0xd8e4ff, vignette: 0.78, saturation: 1.02, contrast: 1.12 }
  },
  studio: {
    top: '#3d434f', horizon: '#171b24', ground: '#0a0b10',
    sun: [0.35, 0.85, 0.4], sunColor: 0xffffff, sunIntensity: 3.4,
    ambient: 0x7d879b, ambientIntensity: 2.2,
    fog: 0x07080b, fogDensity: 0.009, exposure: 1.15,
    look: { tint: 0xffffff, vignette: 0.68, saturation: 1.06, contrast: 1.04 }
  }
};

// Taivas piirretään equirect-canvakselle. Samasta kuvasta johdetaan myös ympäristökartta,
// joten auton maalipinta heijastaa juuri sitä taivasta jonka pelaaja näkee.
function skyCanvas(env) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const ctx = c.getContext('2d');
  const W = 2048, H = 1024;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, env.top);
  g.addColorStop(0.34, env.top);
  g.addColorStop(0.47, env.horizon);
  g.addColorStop(0.502, env.horizon);
  g.addColorStop(0.515, env.ground);
  g.addColorStop(1, env.ground);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const sun = env.sun;
  const az = Math.atan2(sun[0], sun[2]);
  const el = Math.asin(Math.max(-1, Math.min(1, sun[1])));
  const sx = ((az / (Math.PI * 2) + 0.5) % 1) * W;
  const sy = (0.5 - el / Math.PI) * H;
  const halo = ctx.createRadialGradient(sx, sy, 2, sx, sy, 460);
  halo.addColorStop(0, 'rgba(255,255,250,1)');
  halo.addColorStop(0.022, 'rgba(255,252,238,1)');
  halo.addColorStop(0.05, 'rgba(255,240,205,0.7)');
  halo.addColorStop(0.22, 'rgba(255,222,175,0.22)');
  halo.addColorStop(1, 'rgba(255,205,150,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  if (env === ENVIRONMENTS.night) {
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * W, y = Math.random() * 470;
      ctx.globalAlpha = Math.random() * 0.8;
      const s = Math.random() < 0.1 ? 2.6 : 1.6;
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;
  } else {
    // Pilviharso: pehmeitä ellipsejä horisontin yläpuolelle.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 110; i++) {
      const x = Math.random() * W, y = 90 + Math.random() * 340;
      ctx.globalAlpha = 0.05 + Math.random() * 0.14;
      ctx.beginPath();
      ctx.ellipse(x, y, 60 + Math.random() * 260, 10 + Math.random() * 34, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  return c;
}

class Game {
  constructor() {
    this.state = loadSave();
    this.canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: false
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.25, 1600);
    this.camPos = new THREE.Vector3(0, 4, -10);
    this.camLook = new THREE.Vector3();
    this.shake = 0;

    this.audio = new GameAudio();
    this.input = new Input();
    this.input.sensitivity = this.state.settings.sensitivity;
    this.touchMode = window.matchMedia('(pointer: coarse)').matches;

    this.mode = 'menu';
    this.view = 'showroom';
    this.lastTrackId = 'satama';
    this.toastPool = [];

    this.buildShowroom();
    this.post = new PostFX(this.renderer, this.showroom.scene, this.camera, this.state.settings.quality);
    this.post.setLook(ENVIRONMENTS.studio.look);
    this.ui = new UI(this);
    this.bindInput();
    this.applyQuality();
    this.audio.setVolume(this.state.settings.volume);
    this.audio.setEnabled(this.state.settings.sound);

    window.addEventListener('resize', () => this.resize());
    this.resize();

    // Selain sallii äänen vasta käyttäjän eleen jälkeen.
    const unlock = () => { this.audio.init(); this.audio.resume(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    const tireBtn = document.getElementById('tireBadge');
    if (tireBtn) tireBtn.addEventListener('click', () => this.toggleTires());
    const touchTire = document.getElementById('touchTire');
    if (touchTire) touchTire.addEventListener('click', () => this.toggleTires());

    if (this.touchMode) {
      this.input.bindTouch({
        wheel: document.getElementById('touchWheel'),
        gas: document.getElementById('touchGas'),
        brake: document.getElementById('touchBrake'),
        hand: document.getElementById('touchHand')
      });
    }

    this.ui.show('main');
    document.getElementById('loading').classList.add('done');
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  bindInput() {
    this.input.on('pause', () => {
      if (this.mode === 'driving') this.pause();
      else if (this.mode === 'paused') this.resume();
    });
    this.input.on('camera', () => {
      const order = ['chase', 'hood', 'far'];
      const i = (order.indexOf(this.state.settings.camera) + 1) % order.length;
      this.setCamera(order[i]);
      persist(this.state);
    });
    this.input.on('reset', () => this.respawn());
    this.input.on('shiftUp', () => { if (this.vehicle && !this.state.settings.autoGear) this.vehicle.shiftUp(); });
    this.input.on('shiftDown', () => { if (this.vehicle && !this.state.settings.autoGear) this.vehicle.shiftDown(); });
    this.input.on('tire', () => this.toggleTires());
    this.input.on('hud', () => {
      this.state.settings.showHud = !this.state.settings.showHud;
      document.getElementById('hud').style.opacity = this.state.settings.showHud ? '1' : '0';
      persist(this.state);
    });
  }

  // Rengasvalinta kesken ajon. Vaihto katkaisee kesken olevan sarjan, jottei
  // kisarenkaille voi vaihtaa juuri ennen pisteiden lukitsemista.
  toggleTires() {
    if (!this.vehicle) return;
    const next = this.vehicle.tireMode === 'grip' ? 'drift' : 'grip';
    this.vehicle.tireMode = next;
    this.state.settings.tires = next;
    persist(this.state);
    if (this.scorer) this.scorer.bank();
    this.audio.blip(next === 'grip' ? 880 : 520, 0.1, 0.1);
    this.toast(next === 'grip' ? 'KISARENKAAT' : 'DRIFTIRENKAAT', 'good');
    const el = document.getElementById('tireBadge');
    if (el) {
      el.textContent = next === 'grip' ? 'PITO' : 'DRIFT';
      el.className = 'tire-badge ' + next;
    }
  }

  // ------------------------------------------------------------- ympäristö

  applyEnvironment(scene, key) {
    const env = ENVIRONMENTS[key] || ENVIRONMENTS.day;
    const canvas = skyCanvas(env);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const rt = this.pmrem.fromEquirectangular(tex);
    scene.background = tex;
    scene.environment = rt.texture;
    scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);
    this.renderer.toneMappingExposure = env.exposure;

    const sun = new THREE.DirectionalLight(env.sunColor, env.sunIntensity);
    sun.position.set(env.sun[0] * 220, env.sun[1] * 220, env.sun[2] * 220);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 40;
    sun.shadow.camera.far = 360;
    // Tiukka varjokamera, joka seuraa autoa: sama resoluutio kattaa paljon
    // pienemmän alueen, joten varjon reuna on terävä juuri siellä missä katsotaan.
    const d = 44;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0009;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    scene.add(sun.target);

    const hemi = new THREE.HemisphereLight(env.ambient, 0x1a1c22, env.ambientIntensity);
    scene.add(hemi);

    return { sun, hemi, tex, rt, env };
  }

  buildShowroom() {
    const scene = new THREE.Scene();
    this.showroom = { scene, lights: this.applyEnvironment(scene, 'studio') };
    this.showroom.lights.sun.castShadow = true;
    this.showroom.lights.sun.shadow.camera.left = -12;
    this.showroom.lights.sun.shadow.camera.right = 12;
    this.showroom.lights.sun.shadow.camera.top = 12;
    this.showroom.lights.sun.shadow.camera.bottom = -12;

    const platGeo = new THREE.CylinderGeometry(4.9, 5.2, 0.3, 64);
    const platMat = new THREE.MeshStandardMaterial({ color: 0x161922, metalness: 0.6, roughness: 0.3 });
    const plat = new THREE.Mesh(platGeo, platMat);
    plat.position.y = -0.15;
    plat.receiveShadow = true;
    scene.add(plat);

    const ringGeo = new THREE.TorusGeometry(5.05, 0.045, 8, 96);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xff2e63, emissive: 0xff2e63, emissiveIntensity: 3 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);

    for (const [x, z, color, power] of [[7, 5, 0x8fc0ff, 220], [-8, 3, 0xff9a70, 180], [0, -9, 0xffffff, 160]]) {
      const p = new THREE.PointLight(color, power, 34, 2);
      p.position.set(x, 6, z);
      scene.add(p);
    }

    this.showroomAngle = 0.6;
    this.showroomDrag = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.view !== 'showroom') return;
      this.showroomDrag = { x: e.clientX, a: this.showroomAngle };
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.showroomDrag) return;
      this.showroomAngle = this.showroomDrag.a + (e.clientX - this.showroomDrag.x) * 0.008;
    });
    window.addEventListener('pointerup', () => { this.showroomDrag = null; });
  }

  showroomCar(carId) {
    const id = carId || this.state.current;
    if (this.showroomModel) {
      this.showroom.scene.remove(this.showroomModel);
      this.showroomModel.userData.dispose();
      this.showroomModel = null;
    }
    const cs = this.state.owned.includes(id) ? ensureCarState(this.state, id) : null;
    const spec = buildSpec(id, cs ? cs.upgrades : undefined, cs ? cs.tune : undefined);
    const paint = cs ? cs.paint : { body: CAR_BY_ID[id].body.color, rim: '#c8ccd4', finish: 'gloss' };
    const model = buildCar(spec, paint);
    // Näyttelytilassa pyörät ovat suorassa ja auto lepää alustallaan.
    for (let i = 0; i < 4; i++) {
      const half = spec.trackWidth / 2;
      const px = i % 2 === 0 ? -half : half;
      const pz = i < 2 ? spec.cgToFront : -spec.cgToRear;
      model.userData.wheels[i].pivot.position.set(px, spec.wheelRadius, pz);
    }
    this.showroom.scene.add(model);
    this.showroomModel = model;
    this.showroomSpec = spec;
  }

  // ----------------------------------------------------------------- radat

  loadTrack(trackId) {
    if (this.track) {
      this.world.scene.remove(this.track.group);
      this.track.dispose();
      this.effects.dispose();
      if (this.carModel) { this.world.scene.remove(this.carModel); this.carModel.userData.dispose(); }
      if (this.world.lights.tex) this.world.lights.tex.dispose();
      if (this.world.lights.rt) this.world.lights.rt.dispose();
    }
    const def = TRACK_BY_ID[trackId];
    const scene = new THREE.Scene();
    const lights = this.applyEnvironment(scene, def.env);
    this.world = { scene, lights, def };

    this.track = createTrack(def);
    scene.add(this.track.group);

    this.effects = new Effects(scene, this.state.settings.quality);
    if (def.surface === 'snow') this.effects.enableWeather('snow');

    const carId = this.state.current;
    const cs = ensureCarState(this.state, carId);
    this.spec = buildSpec(carId, cs.upgrades, { ...cs.tune, assistOverride: undefined });
    this.vehicle = new Vehicle(this.spec);
    this.vehicle.tireMode = this.state.settings.tires || 'drift';
    const badge = document.getElementById('tireBadge');
    if (badge) {
      badge.textContent = this.vehicle.tireMode === 'grip' ? 'PITO' : 'DRIFT';
      badge.className = 'tire-badge ' + this.vehicle.tireMode;
    }
    for (let i = 0; i < 4; i++) this.vehicle.wheels[i].index = i;
    this.carModel = buildCar(this.spec, cs.paint);
    scene.add(this.carModel);

    if (def.env === 'night') {
      // Ajovalot: kaksi kartiovaloa auton edessä. Varjoja ei lasketa suorituskyvyn takia.
      this.headlights = [];
      for (const sx of [-1, 1]) {
        const spot = new THREE.SpotLight(0xfff0cc, 260, 75, 0.5, 0.45, 1.6);
        spot.castShadow = false;
        scene.add(spot, spot.target);
        this.headlights.push({ spot, sx });
      }
    } else {
      this.headlights = null;
    }

    this.scorer = new DriftScorer(this.track);
    if (this.post && lights.env.look) this.post.setLook(lights.env.look);
    this.applyQuality();
  }

  startRun(trackId) {
    this.lastTrackId = trackId;
    const loading = document.getElementById('loading');
    loading.classList.remove('done');
    // Latausruutu ehtii näkyviin ennen kuin radan rakennus jumittaa säikeen.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.loadTrack(trackId);
      this.resetRun();
      loading.classList.add('done');
      this.ui.show('none');
      this.view = 'track';
      this.mode = 'countdown';
      this.countdown = 3.2;
      this.audio.init();
      this.audio.resume();
    }));
  }

  resetRun() {
    const spawn = this.track.spawnPoint();
    const spawnY = this.track.sample(spawn.x, spawn.z).height;
    this.vehicle.reset(spawn.x, spawn.z, spawn.yaw);
    this.vehicle.y = spawnY;
    this.scorer.reset();
    this.effects.clear();
    const def = this.world.def;
    this.timeLeft = def.time || 0;
    this.progress = 0;
    this.runTime = 0;
    this.finished = false;
    this.offTrack = 0;
    const ot = document.getElementById('offTrack');
    if (ot) ot.classList.add('hidden');
    document.getElementById('progressWrap').classList.toggle('hidden', def.mode !== 'sprint');
    document.getElementById('timerPanel').classList.toggle('hidden', def.mode === 'free');
    // Kamera aloittaa radan korkeudelta - mäkisellä radalla nollataso olisi maan alla.
    this.camPos.set(spawn.x - Math.sin(spawn.yaw) * 8, spawnY + 3.2, spawn.z - Math.cos(spawn.yaw) * 8);
    this.camLook.set(spawn.x, spawnY + 1, spawn.z);
    this.shake = 0;
  }

  restartRun() {
    this.resetRun();
    this.ui.show('none');
    this.mode = 'countdown';
    this.countdown = 3.2;
  }

  respawn() {
    if (!this.vehicle || this.mode !== 'driving') return;
    const p = this.track.respawnNear(this.vehicle.x, this.vehicle.z);
    this.vehicle.reset(p.x, p.z, p.yaw);
    this.vehicle.y = this.track.sample(p.x, p.z).height;
    this.scorer.breakCombo('reset');
    this.effects.skid.prev = [null, null, null, null];
    this.toast('PALAUTETTU', 'bad');
  }

  pause() {
    if (this.mode !== 'driving') return;
    this.mode = 'paused';
    const s = this.scorer;
    document.getElementById('pauseLive').innerHTML = `
      <div>PISTEET<b>${Math.round(s.total).toLocaleString('fi-FI')}</b></div>
      <div>KERROIN<b>x${s.multiplier.toFixed(1)}</b></div>
      <div>PARAS SARJA<b>${Math.round(s.best).toLocaleString('fi-FI')}</b></div>`;
    this.ui.show('pause');
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.ui.show('none');
    this.mode = 'countdown';
    this.countdown = 1.6;
  }

  endRun(quit) {
    if (this.mode === 'menu') return;
    const result = this.scorer.finish();
    const def = this.world.def;
    // Neliöjuuri tasaa palkkiot: aloitusautolla pääsee alkuun, eikä huippuauto
    // tee muusta pelistä turhaa yhdellä ajolla.
    const money = Math.round(45 * Math.sqrt(Math.max(0, result.total)) * def.payout);
    this.state.money += money;
    const prevBest = (this.state.records[def.id] || {}).best || 0;
    recordRun(this.state, def.id, result);
    persistNow(this.state);
    this.mode = 'menu';
    this.ui.showResults(result, money, result.total > prevBest && result.total > 0, def);
    this.ui.refreshMoney();
  }

  // ------------------------------------------------------------- asetukset

  setCamera(mode) {
    this.state.settings.camera = mode;
    if (this.ui && this.ui.screen === 'settings') this.ui.buildSettings();
  }

  // Automaattinen laadunpudotus. Peli ei tieda etukateen mille raudalle se
  // paatyy, joten se mittaa itse. Jos ruutunopeus jaa alle 45:n yhtajaksoisesti
  // nelja sekuntia, laatu putoaa askeleen. Ylos ei nostella automaattisesti:
  // se johtaisi edestakaiseen heilahteluun juuri rajan tuntumassa. Kun pelaaja
  // valitsee laadun itse, automatiikka ei enaa puutu asiaan.
  governQuality(dt) {
    if (this.qualityLocked || this.mode !== 'driving') return;
    const q = this.state.settings.quality;
    if (q === 'low') return;
    this.slowFor = this.fpsAvg < 45 ? (this.slowFor || 0) + dt : 0;
    if (this.slowFor < 4) return;
    this.slowFor = 0;
    const next = q === 'high' ? 'medium' : 'low';
    this.state.settings.quality = next;
    this.applyQuality();
    this.toast('GRAFIIKKA: ' + (next === 'medium' ? 'NORMAALI' : 'KEVYT'), 'bad');
  }

  applyQuality() {
    const q = this.state.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    const cap = q === 'low' ? 1 : q === 'medium' ? 1.35 : 2;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.renderer.shadowMap.enabled = this.state.settings.shadows && q !== 'low';
    if (this.post) this.post.setQuality(q);
    const size = q === 'high' ? 2048 : 1024;
    for (const w of [this.world, this.showroom]) {
      if (!w || !w.lights) continue;
      const sun = w.lights.sun;
      sun.castShadow = this.renderer.shadowMap.enabled;
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
    }
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.post) this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const g = document.getElementById('gauges');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = g.clientWidth || 280, cssH = g.clientHeight || 140;
    g.width = Math.round(cssW * dpr);
    g.height = Math.round(cssH * dpr);
    this.gaugeCtx = g.getContext('2d');
    this.gaugeScale = dpr;
  }

  onScreenChange(name) {
    const inGame = name === 'none' || name === 'pause' || name === 'results';
    this.view = inGame && this.track ? 'track' : 'showroom';
    this.showroomShift = name === 'garage' ? 1.7 : 0;
    if (this.view === 'showroom' && !this.showroomModel) this.showroomCar();
    if (this.view === 'showroom' && this.showroomModel && this.showroomSpecId !== this.state.current
      && (name === 'main' || name === 'tracks' || name === 'settings' || name === 'help')) {
      this.showroomSpecId = this.state.current;
      this.showroomCar(this.state.current);
    }
  }

  // ------------------------------------------------------------------ loop

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    this.fpsAvg = this.fpsAvg ? this.fpsAvg * 0.92 + (1 / Math.max(dt, 0.001)) * 0.08 : 60;
    this.lastFps = Math.round(this.fpsAvg);
    this.governQuality(dt);
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) return;

    if (this.mode === 'countdown') {
      this.countdown -= dt;
      const el = document.getElementById('countdown');
      const txt = document.getElementById('countdownText');
      el.classList.remove('hidden');
      const n = Math.ceil(this.countdown);
      const label = this.countdown <= 0.6 ? 'AJA!' : String(Math.max(1, n - 1));
      if (txt.textContent !== label) {
        txt.textContent = label;
        txt.style.animation = 'none';
        void txt.offsetWidth;
        txt.style.animation = '';
        this.audio.blip(label === 'AJA!' ? 900 : 520, 0.12, 0.12);
      }
      this.updateDriving(dt, true);
      if (this.countdown <= 0) { this.mode = 'driving'; el.classList.add('hidden'); }
    } else if (this.mode === 'driving') {
      this.updateDriving(dt, false);
    } else if (this.view === 'showroom') {
      this.updateShowroom(dt);
    }

    const scene = this.view === 'showroom' ? this.showroom.scene : (this.world && this.world.scene);
    if (!scene) return;
    if (this.post.renderPass.scene !== scene) this.post.setScene(scene, this.camera);
    this.post.update(dt, this.vehicle && this.mode !== 'menu' ? this.vehicle.speedKmh : 0, this.shake);
    this.post.render();

    this.state.stats.playTime += dt;
  }

  updateShowroom(dt) {
    if (!this.showroomDrag) this.showroomAngle += dt * 0.16;
    if (this.showroomModel) this.showroomModel.rotation.y = this.showroomAngle;
    const shiftOn = window.innerWidth > 1100 && this.showroomShift;
    const r = shiftOn ? 8.6 : 7.4, h = shiftOn ? 2.2 : 1.95;
    this.camera.position.set(Math.sin(0.62) * r, h, Math.cos(0.62) * r);
    const look = this._look || (this._look = new THREE.Vector3());
    look.set(0, 0.72, 0);
    // Tallissa katsepiste siirretään vasemmalle, jolloin auto asettuu oikeaan reunaan
    // eikä jää valikkopaneelin taakse.
    const shift = shiftOn ? this.showroomShift : 0;
    if (shift) {
      const fwd = look.clone().sub(this.camera.position).normalize();
      const right = fwd.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
      look.addScaledVector(right, -shift);
    }
    this.camera.lookAt(look);
    if (this.camera.fov !== 40) { this.camera.fov = 40; this.camera.updateProjectionMatrix(); }
  }

  updateDriving(dt, frozen) {
    const v = this.vehicle;
    const settings = this.state.settings;
    const input = this.input.update(dt);
    input.assist = settings.assist;
    input.autoGear = settings.autoGear;
    if (frozen) {
      // Lähtölaskennassa saa jo revitellä, mutta auto pysyy paikallaan. Käsijarru
      // eikä jarrupoljin - muuten automaatti tulkitsisi sen peruutuspyynnöksi.
      input.brake = 0; input.steer = 0; input.handbrake = true;
    }

    v.update(dt, input, this.track);
    const impact = v.takeImpact();
    if (impact > 1.2) {
      this.audio.crash(impact);
      this.shake = Math.min(1, this.shake + impact * 0.06);
      const fwd = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
      this.effects.emitSparks(v.x + fwd.x, v.y, v.z + fwd.z, v.vx, v.vz, Math.min(14, 3 + impact));
    }
    this.track.update(dt, v);

    const surf = this.track.sample(v.x, v.z);
    v.y = surf.height;
    v.brakeLight = input.brake > 0.05 || input.handbrake;

    if (!frozen) {
      this.runTime += dt;
      const events = this.scorer.update(dt, v, input);
      for (const e of events) this.handleScoreEvent(e);
    }

    this.emitWheelEffects(dt, v);
    if (v.backfire > 0.6) {
      this.audio.backfire();
      const ud = this.carModel.userData;
      for (const p of ud.exhausts) {
        const wx = v.x + (p.x * Math.cos(v.yaw) + p.z * Math.sin(v.yaw));
        const wz = v.z + (-p.x * Math.sin(v.yaw) + p.z * Math.cos(v.yaw));
        this.effects.emitSparks(wx, v.y + p.y, wz, -v.vx * 0.2, -v.vz * 0.2, 5);
      }
      v.backfire = 0;
    }
    if (Math.random() < dt * 12 && input.throttle > 0.15) {
      const p = this.carModel.userData.exhausts[0];
      const wx = v.x + (p.x * Math.cos(v.yaw) + p.z * Math.sin(v.yaw));
      const wz = v.z + (-p.x * Math.sin(v.yaw) + p.z * Math.cos(v.yaw));
      this.effects.emitExhaust(wx, v.y + p.y, wz, -v.vx, -v.vz, input.throttle);
    }

    this.followSun(v);
    syncCarModel(this.carModel, v, dt);
    this.effects.update(dt, this.camera);
    this.updateCamera(dt, v);
    this.updateHeadlights(v);
    this.audio.update(dt, v, { throttle: input.throttle, surfaceGrip: surf.grip });
    this.updateHud(dt, v, input);

    if (!frozen) {
      this.checkRunEnd(dt, surf);
      this.checkBounds(dt, surf, v);
    }
    this.state.stats.distance += v.speed * dt;
  }

  emitWheelEffects(dt, v) {
    const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      const wx = v.x + (w.px * cy + w.pz * sy);
      const wz = v.z + (-w.px * sy + w.pz * cy);
      const wy = this.track.sample(wx, wz).height;
      this.effects.emitWheel(w, wx, wy, wz, v.vx, v.vz, null, dt);
    }
  }

  handleScoreEvent(e) {
    if (e.type === 'bank') {
      this.audio.scoreBank();
      this.toast('+' + Math.round(e.amount).toLocaleString('fi-FI'), 'good');
      const p = document.getElementById('scoreTotal').parentElement;
      p.classList.remove('flash');
      void p.offsetWidth;
      p.classList.add('flash');
    } else if (e.type === 'lost') {
      if (e.amount > 400) {
        this.audio.scoreLost();
        this.toast(e.reason === 'crash' ? 'OSUMA! -' + Math.round(e.amount).toLocaleString('fi-FI')
          : 'SPINNI! -' + Math.round(e.amount).toLocaleString('fi-FI'), 'bad');
      }
    } else if (e.type === 'clip') {
      this.audio.clipHit();
      this.toast('KLIPSI +' + Math.round(e.bonus), 'big');
    } else if (e.type === 'transition') {
      this.audio.blip(1180, 0.08, 0.08);
      this.toast('SUUNNANVAIHTO', 'good');
    } else if (e.type === 'levelup' && e.level >= 3) {
      this.audio.blip(660 + e.level * 60, 0.09, 0.07);
    } else if (e.type === 'nearmiss') {
      this.audio.blip(1480, 0.06, 0.08);
      this.toast('OHILIPAISU +' + Math.round(e.bonus), 'big');
    } else if (e.type === 'close') {
      this.toast('LÄHELTÄ PITI', 'big');
    }
  }

  toast(text, kind) {
    const wrap = document.getElementById('toasts');
    if (wrap.childElementCount > 5) wrap.removeChild(wrap.firstChild);
    const d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.textContent = text;
    wrap.appendChild(d);
    setTimeout(() => d.remove(), 1300);
  }

  updateCamera(dt, v) {
    const mode = this.state.settings.camera;
    const speed = v.speed;
    const body = v.spec.body;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);

    if (mode === 'hood') {
      const hx = v.x + fx * (body.length * 0.06);
      const hz = v.z + fz * (body.length * 0.06);
      this.camera.position.set(hx, v.y + this.carModel.userData.beltline + 0.34, hz);
      this.camera.lookAt(hx + fx * 12, v.y + 1.1, hz + fz * 12);
      this.camera.rotation.z += v.roll * 0.6;
      this.setFov(66 + Math.min(14, speed * 0.28));
      return;
    }

    // Kamera asettuu kulkusuunnan taakse, ei nokan taakse. Driftissä auto näkyy
    // sivuttain ja pelaaja näkee sinne minne oikeasti ollaan menossa.
    let dx = fx, dz = fz;
    if (speed > 3.5) {
      const inv = 1 / speed;
      const vx = v.vx * inv, vz = v.vz * inv;
      const blend = mode === 'far' ? 0.75 : 0.62;
      dx = fx + (vx - fx) * blend;
      dz = fz + (vz - fz) * blend;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
    }
    const far = mode === 'far';
    // Pystyasennossa vaakasuuntainen kuvakulma on kapea, joten kameraa vedetään
    // kauemmas - muuten auto täyttää puolet ruudusta eikä rataa näe.
    const narrow = Math.max(0, 1.25 - this.camera.aspect);
    const dist = ((far ? 11 : 6.1) + speed * (far ? 0.075 : 0.052) + body.length * 0.3) * (1 + narrow * 0.55);
    const height = (far ? 4.6 : 2.32) + speed * 0.008 + narrow * 0.7;

    const tx = v.x - dx * dist, tz = v.z - dz * dist;
    const ty = v.y + height;
    // Kehysnopeudesta riippumaton pehmennys.
    const k = 1 - Math.exp(-(far ? 3.4 : 6.2) * dt);
    this.camPos.x += (tx - this.camPos.x) * k;
    this.camPos.y += (ty - this.camPos.y) * k;
    this.camPos.z += (tz - this.camPos.z) * k;

    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * 0.32;
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * sh,
      this.camPos.y + (Math.random() - 0.5) * sh,
      this.camPos.z + (Math.random() - 0.5) * sh
    );

    const lookAhead = far ? 3 : 5.5;
    const lx = v.x + dx * lookAhead, lz = v.z + dz * lookAhead;
    const ly = v.y + 0.95;
    const lk = 1 - Math.exp(-9 * dt);
    this.camLook.x += (lx - this.camLook.x) * lk;
    this.camLook.y += (ly - this.camLook.y) * lk;
    this.camLook.z += (lz - this.camLook.z) * lk;
    this.camera.lookAt(this.camLook);
    // Pieni kallistus driftin suuntaan tekee liikkeestä elävämmän.
    // sideSlip on peilatussa fysiikkakehyksessä, joten ruudulle päin merkki käännetään.
    this.camera.rotateZ(v.sideSlip * 0.05);
    this.setFov((far ? 52 : 60) + Math.min(20, speed * 0.34));
  }

  setFov(f) {
    if (Math.abs(this.camera.fov - f) > 0.05) {
      this.camera.fov += (f - this.camera.fov) * 0.12;
      this.camera.updateProjectionMatrix();
    }
  }

  // Varjokamera kulkee auton mukana. Ilman tätä varjot olisivat joko sumeita
  // (iso kartta) tai katoaisivat kokonaan radan toisella puolella.
  followSun(v) {
    const lights = this.world && this.world.lights;
    if (!lights || !lights.sun.castShadow) return;
    const d = lights.env.sun;
    lights.sun.position.set(v.x + d[0] * 150, v.y + d[1] * 150 + 30, v.z + d[2] * 150);
    lights.sun.target.position.set(v.x, v.y, v.z);
    lights.sun.target.updateMatrixWorld();
  }

  updateHeadlights(v) {
    if (!this.headlights) return;
    const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
    const b = v.spec.body;
    for (const h of this.headlights) {
      const px = h.sx * b.width * 0.3, pz = b.length * 0.45;
      h.spot.position.set(v.x + px * cy + pz * sy, v.y + 0.65, v.z - px * sy + pz * cy);
      h.spot.target.position.set(v.x + sy * 28, v.y + 0.1, v.z + cy * 28);
      h.spot.target.updateMatrixWorld();
    }
  }

  // Radan ulkopuolelle jääminen ei jumita peliä: ensin varoitus, sitten palautus.
  checkBounds(dt, surf, v) {
    if (this.track.outOfBounds(v.x, v.z) || v.y < -80) {
      this.toast('RADAN ULKOPUOLELLA', 'bad');
      this.respawn();
      this.offTrack = 0;
      return;
    }
    const far = this.track.halfWidth + (this.world.def.kind === 'lot' ? 6 : 11);
    const off = surf.dist > far && v.speed > 1;
    this.offTrack = off ? (this.offTrack || 0) + dt : 0;
    const warn = document.getElementById('offTrack');
    if (!warn) return;
    if (this.offTrack > 1.2) {
      warn.classList.remove('hidden');
      warn.textContent = 'PALAA RADALLE ' + Math.ceil(5 - this.offTrack);
      if (this.offTrack > 5) { this.respawn(); this.offTrack = 0; }
    } else if (!warn.classList.contains('hidden')) {
      warn.classList.add('hidden');
    }
  }

  checkRunEnd(dt, surf) {
    const def = this.world.def;
    if (def.mode === 'lap') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.endRun(); }
    } else if (def.mode === 'sprint') {
      // Edistyminen ei saa hypähtää taaksepäin, jos auto ajaa hetkeksi radan sivuun.
      if (surf.dist < this.track.halfWidth + 8) this.progress = Math.max(this.progress, surf.prog);
      document.getElementById('progressFill').style.width = (this.progress * 100).toFixed(1) + '%';
      if (this.progress > 0.985 && !this.finished) {
        this.finished = true;
        this.toast('MAALISSA!', 'big');
        setTimeout(() => this.endRun(), 900);
      }
    }
  }

  // -------------------------------------------------------------- mittarit

  updateHud(dt, v, input) {
    const s = this.scorer;
    document.getElementById('scoreTotal').textContent = Math.round(s.total).toLocaleString('fi-FI');
    const pend = document.getElementById('scorePending');
    pend.textContent = s.pending > 1 ? '+' + Math.round(s.pending).toLocaleString('fi-FI') : '';
    document.getElementById('comboMult').textContent = 'x' + s.multiplier.toFixed(1);
    document.getElementById('comboFill').style.width = ((s.multiplier - 1) / 9 * 100).toFixed(1) + '%';
    const deg = Math.abs(s.angle) * 180 / Math.PI;
    document.getElementById('comboAngle').textContent = Math.round(deg) + '°';
    document.getElementById('angleNeedle').style.left = (50 - Math.max(-48, Math.min(48, s.angle * 180 / Math.PI * 0.52))) + '%';

    const def = this.world.def;
    if (def.mode !== 'free') {
      const panel = document.getElementById('timerPanel');
      if (def.mode === 'lap') {
        document.getElementById('timerLabel').textContent = 'AIKAA';
        document.getElementById('timerValue').textContent = this.timeLeft.toFixed(1);
        panel.classList.toggle('low', this.timeLeft < 15);
      } else {
        document.getElementById('timerLabel').textContent = 'AIKA';
        document.getElementById('timerValue').textContent = this.runTime.toFixed(1);
      }
    }

    document.getElementById('gearValue').textContent =
      v.gear === 0 ? 'N' : v.gear < 0 ? 'R' : String(v.gear);
    document.getElementById('gearMode').textContent = this.state.settings.autoGear ? 'AUTO' : 'MANU';

    const danger = Math.min(1, Math.max(0, (Math.abs(s.angle) * 180 / Math.PI - 78) / 40));
    document.getElementById('dangerVignette').style.opacity = danger * 0.8;

    this.drawGauges(v, input);
  }

  drawGauges(v, input) {
    const ctx = this.gaugeCtx;
    if (!ctx) return;
    const scale = this.gaugeScale;
    const W = ctx.canvas.width / scale, H = ctx.canvas.height / scale;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, W, H);

    // Puoliympyrä mahtuu piirtoalueelle kokonaan, joten mittari ei leikkaudu reunasta.
    const cx = W / 2, cy = H * 0.96, r = Math.min(H * 0.84, W * 0.42);
    const start = Math.PI, end = Math.PI * 2;
    const spec = v.spec;
    const redline = spec.redline;
    const maxRpm = Math.ceil(redline / 1000) * 1000;

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.stroke();

    const redStart = start + (redline / maxRpm) * (end - start);
    ctx.strokeStyle = 'rgba(255,46,99,0.75)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, redStart, end);
    ctx.stroke();

    const t = Math.min(1, v.rpm / maxRpm);
    const grad = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    grad.addColorStop(0, '#2ee6a8');
    grad.addColorStop(0.65, '#ffc23c');
    grad.addColorStop(1, '#ff2e63');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + t * (end - start));
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.font = '600 8px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'center';
    for (let k = 0; k <= maxRpm; k += 1000) {
      const a = start + (k / maxRpm) * (end - start);
      const x1 = cx + Math.cos(a) * (r - 12), y1 = cy + Math.sin(a) * (r - 12);
      const x2 = cx + Math.cos(a) * (r - 6), y2 = cy + Math.sin(a) * (r - 6);
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.stroke();
      if (k % 2000 === 0) {
        ctx.fillText(String(k / 1000), cx + Math.cos(a) * (r - 22), cy + Math.sin(a) * (r - 22) + 3);
      }
    }

    ctx.fillStyle = '#fff';
    ctx.font = '700 32px ui-monospace, monospace';
    ctx.fillText(String(Math.round(v.speedKmh)), cx, cy - r * 0.44);
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('KM/H', cx, cy - r * 0.44 + 13);

    // Kaasu ja jarru pikkupalkkeina mittarin sisällä.
    const barW = 44, barH = 4, by = cy - 16;
    const bars = [
      { x: cx - barW - 5, v: input.brake, c: '#ff2e63' },
      { x: cx + 5, v: input.throttle, c: '#2ee6a8' }
    ];
    for (const b of bars) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(b.x, by, barW, barH);
      ctx.fillStyle = b.c;
      ctx.fillRect(b.x, by, barW * b.v, barH);
    }
    if (input.handbrake) {
      ctx.fillStyle = '#ffc23c';
      ctx.font = '800 9px system-ui, sans-serif';
      ctx.fillText('KÄSIJARRU', cx, by + 14);
    }
    ctx.restore();
  }
}

// Virhe näytetään ruudulla, ei pelkästään konsolissa: pelaajan ei pitäisi joutua
// avaamaan kehittäjätyökaluja saadakseen selville miksi ruutu on musta.
function showFatal(err) {
  console.error(err);
  const l = document.getElementById('loading');
  if (!l) return;
  l.classList.remove('done');
  l.innerHTML = '<div style="max-width:52ch;text-align:left;line-height:1.7;letter-spacing:0">'
    + '<div style="color:#ff2e63;font-weight:800;letter-spacing:.14em;margin-bottom:10px">PELI EI KÄYNNISTYNYT</div>'
    + '<div style="color:#e9edf4;font-family:ui-monospace,monospace;font-size:12px;'
    + 'background:rgba(255,255,255,.06);padding:12px;border-radius:8px;white-space:pre-wrap;'
    + 'overflow:auto;max-height:40vh">' + String(err && err.stack || err).replace(/[<>&]/g, '') + '</div>'
    + '<div style="color:#8b94a4;font-size:12px;margin-top:12px">Yleisin syy on selaimen '
    + 'välimuistiin jäänyt vanha versio: paina Ctrl+F5. Toinen mahdollinen syy on '
    + 'WebGL, joka voi olla pois päältä selaimen asetuksista.</div></div>';
}

window.addEventListener('error', (e) => { if (!window.game) showFatal(e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => { if (!window.game) showFatal(e.reason); });

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.game = new Game();
  } catch (err) {
    showFatal(err);
  }
});
