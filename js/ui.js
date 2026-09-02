// Valikoiden logiikka: ratavalinta, talli, asetukset ja tulosnäkymä.
// UI ei tunne fysiikkaa - se lukee tallennustilaa ja kutsuu pelin metodeja.

import { CARS, CAR_BY_ID, UPGRADES, UPGRADE_KEYS, upgradeCost, buildSpec, specStars, defaultTune } from './cars.js';
import { TRACKS } from './tracks.js';
import { Vehicle } from './vehicle.js';
import { ensureCarState, persist, resetSave } from './save.js';

// Tallin suoritusarvot ajetaan oikealla fysiikalla, ei kaavalla: kiihdytysaika ja
// huippunopeus vastaavat siis täsmälleen sitä mitä radalla tapahtuu.
const FLAT_WORLD = { sample: () => ({ grip: 1, onRoad: true, height: 0, dist: 0, slopeX: 0, slopeZ: 0, prog: 0 }) };
const perfCache = new Map();

function measurePerformance(spec) {
  const key = spec.id + '|' + JSON.stringify(spec.upgrades) + '|' + JSON.stringify(spec.tune);
  const hit = perfCache.get(key);
  if (hit) return hit;
  const v = new Vehicle(spec);
  v.reset(0, 0, 0);
  const input = { steer: 0, throttle: 1, brake: 0, handbrake: false, clutch: 0, assist: 0, autoGear: true, steerBoost: 0 };
  const dt = 1 / 50;
  let t = 0, t100 = null, top = 0;
  for (let i = 0; i < 50 * 55; i++) {
    v.update(dt, input, FLAT_WORLD);
    t += dt;
    if (!t100 && v.speedKmh >= 100) t100 = t;
    if (v.speedKmh > top) top = v.speedKmh;
  }
  const out = { zeroToHundred: t100, topSpeed: top };
  perfCache.set(key, out);
  return out;
}

const BODY_COLORS = ['#d94f4f', '#f2f2f2', '#f6d34a', '#2f6fd0', '#3fd0c8', '#8ad14a', '#ff6a2b',
  '#1a1c22', '#8e44ad', '#ff87c3', '#5c6672', '#00d0ff'];
const RIM_COLORS = ['#c8ccd4', '#1c1e24', '#c9a227', '#b06a3a', '#3fd0c8', '#ff2e63'];

const fmt = (n) => Math.round(n).toLocaleString('fi-FI');

// Kevyt Catmull-Rom pikkukartoille, jotta ratakortit näyttävät oikean muodon.
function catmull(points, closed, steps = 12) {
  const out = [];
  const n = points.length;
  const last = closed ? n : n - 1;
  const at = (i) => points[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  return out;
}

function trackMapSvg(def) {
  // Kaupungille piirretään ruutukaava, ei yhtä ajolinjaa.
  if (def.kind === 'city') {
    const lines = [];
    for (let k = 0; k < 7; k++) {
      const x = 14 + k * 23.7;
      lines.push(`<line x1="${x.toFixed(1)}" y1="6" x2="${x.toFixed(1)}" y2="106"
        stroke="${k % 3 === 0 ? '#ff2e63' : 'rgba(255,255,255,0.22)'}" stroke-width="${k % 3 === 0 ? 2.4 : 1.2}"/>`);
    }
    for (let k = 0; k < 5; k++) {
      const y = 12 + k * 22;
      lines.push(`<line x1="8" y1="${y.toFixed(1)}" x2="162" y2="${y.toFixed(1)}"
        stroke="${k % 2 === 0 ? '#ff2e63' : 'rgba(255,255,255,0.22)'}" stroke-width="${k % 2 === 0 ? 2.4 : 1.2}"/>`);
    }
    return `<svg viewBox="0 0 170 112" preserveAspectRatio="xMidYMid meet">${lines.join('')}
      <circle cx="85" cy="56" r="3.6" fill="#2ee6a8"/></svg>`;
  }
  let pts;
  if (def.kind === 'lot') {
    pts = [];
    for (let i = 0; i <= 90; i++) {
      const t = i / 90 * Math.PI * 2;
      pts.push([Math.sin(t) * 52, Math.sin(t * 2) * 42]);
    }
  } else {
    pts = catmull(def.points.map((p) => [p[0], p[2]]), !!def.closed);
    if (def.closed) pts.push(pts[0]);
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const w = maxX - minX || 1, h = maxY - minY || 1;
  const scale = Math.min(150 / w, 92 / h);
  const ox = (170 - w * scale) / 2 - minX * scale;
  const oy = (112 - h * scale) / 2 - minY * scale;
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * scale + ox).toFixed(1)} ${(y * scale + oy).toFixed(1)}`).join(' ');
  const start = pts[0];
  return `<svg viewBox="0 0 170 112" preserveAspectRatio="xMidYMid meet">
    <path d="${d}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="#ff2e63" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${(start[0] * scale + ox).toFixed(1)}" cy="${(start[1] * scale + oy).toFixed(1)}" r="3.4" fill="#2ee6a8"/>
  </svg>`;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.state = game.state;
    this.screen = 'main';
    this.garageCar = this.state.current;
    this.tab = 'stats';
    this.cache = {};
    this.bind();
  }

  el(id) {
    if (!this.cache[id]) this.cache[id] = document.getElementById(id);
    return this.cache[id];
  }

  bind() {
    document.querySelectorAll('[data-go]').forEach((b) => {
      b.addEventListener('click', () => { this.game.audio.uiClick(); this.show(b.dataset.go); });
    });
    document.querySelectorAll('.garage-tabs .tab').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        document.querySelectorAll('.garage-tabs .tab').forEach((t) => t.classList.toggle('active', t === b));
        for (const name of ['stats', 'upgrades', 'tune', 'paint']) {
          this.el('tab' + name[0].toUpperCase() + name.slice(1)).classList.toggle('hidden', name !== this.tab);
        }
        this.game.audio.uiClick();
      });
    });
    this.el('btnResume').addEventListener('click', () => this.game.resume());
    this.el('btnRestart').addEventListener('click', () => this.game.restartRun());
    this.el('btnQuit').addEventListener('click', () => this.game.endRun(true));
    this.el('btnAgain').addEventListener('click', () => this.game.startRun(this.game.lastTrackId));
    this.el('btnToGarage').addEventListener('click', () => this.show('garage'));
    this.el('btnToMenu').addEventListener('click', () => this.show('main'));
  }

  show(name) {
    // Valikkoon palatessa peli näyttää auton näyttelytilassa.
    this.screen = name;
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const target = document.getElementById('screen-' + name);
    if (target) target.classList.add('active');
    this.el('hud').classList.toggle('hidden', name !== 'none');
    this.el('touch').classList.toggle('hidden', !(name === 'none' && this.game.touchMode));
    if (name === 'main') this.buildMain();
    if (name === 'tracks') this.buildTracks();
    if (name === 'garage') { this.garageCar = this.state.current; this.buildGarage(); }
    if (name === 'settings') this.buildSettings();
    this.refreshMoney();
    this.game.onScreenChange(name);
  }

  refreshMoney() {
    const v = fmt(this.state.money);
    const m = this.el('moneyMain');
    if (m) m.textContent = v;
    document.querySelectorAll('.moneyView').forEach((e) => { e.textContent = v; });
  }

  buildMain() {
    const s = this.state.stats;
    this.el('mainStats').innerHTML = `
      <div><b>${fmt(s.totalScore)}</b>PISTEITÄ YHTEENSÄ</div>
      <div><b>${s.runs}</b>AJOA</div>
      <div><b>x${(s.bestCombo || 1).toFixed(1)}</b>PARAS KERROIN</div>
      <div><b>${this.state.owned.length}/${CARS.length}</b>AUTOA</div>`;
    const car = CAR_BY_ID[this.state.current];
    this.el('carLabel').textContent = car ? `Valittuna: ${car.name}` : '';
  }

  buildTracks() {
    const list = this.el('trackList');
    list.innerHTML = '';
    for (const def of TRACKS) {
      const rec = this.state.records[def.id];
      const card = document.createElement('button');
      card.className = 'track-card';
      card.innerHTML = `
        <div class="track-map">${trackMapSvg(def)}</div>
        <div class="track-body">
          <h3>${def.name}</h3>
          <p>${def.blurb}</p>
          <div class="track-meta">
            <span>VAIKEUS <span class="diff">${[1, 2, 3].map((i) => `<i class="${i <= def.difficulty ? 'on' : ''}"></i>`).join('')}</span></span>
            <span>${def.mode === 'lap' ? `AIKA <b>${def.time}s</b>` : def.mode === 'sprint' ? 'LASKU <b>A&rarr;B</b>' : 'VAPAA <b>&#8734;</b>'}</span>
            <span>ENNÄTYS <b>${rec ? fmt(rec.best) : '-'}</b></span>
          </div>
        </div>`;
      card.addEventListener('click', () => { this.game.audio.uiClick(); this.game.startRun(def.id); });
      list.appendChild(card);
    }
  }

  // ------------------------------------------------------------------ talli

  buildGarage() {
    const picker = this.el('carPicker');
    picker.innerHTML = '';
    for (const car of CARS) {
      const owned = this.state.owned.includes(car.id);
      const b = document.createElement('button');
      b.className = 'car-item' + (car.id === this.garageCar ? ' sel' : '');
      b.innerHTML = `<span class="cname">${car.name}</span>
        <span class="cmeta ${owned ? '' : 'locked'}">${owned ? car.tier : '&euro; ' + fmt(car.price)}</span>`;
      b.addEventListener('click', () => {
        this.garageCar = car.id;
        this.game.audio.uiClick();
        this.buildGarage();
        this.game.showroomCar(car.id);
      });
      picker.appendChild(b);
    }
    this.renderGarageDetail();
    this.game.showroomCar(this.garageCar);
  }

  renderGarageDetail() {
    const car = CAR_BY_ID[this.garageCar];
    const owned = this.state.owned.includes(car.id);
    const cs = owned ? ensureCarState(this.state, car.id) : null;
    const spec = buildSpec(car.id, cs ? cs.upgrades : undefined, cs ? cs.tune : undefined);

    this.el('garageCarName').textContent = car.name;
    this.el('garageCarBlurb').textContent = car.blurb;
    this.renderStats(spec, car);
    this.renderUpgrades(car, cs);
    this.renderTune(car, cs, spec);
    this.renderPaint(car, cs);

    const actions = this.el('garageActions');
    actions.innerHTML = '';
    if (!owned) {
      const buy = document.createElement('button');
      const afford = this.state.money >= car.price;
      buy.className = 'big' + (afford ? '' : ' ghost');
      buy.disabled = !afford;
      buy.innerHTML = `<span>OSTA &euro; ${fmt(car.price)}</span>`;
      buy.addEventListener('click', () => {
        if (this.state.money < car.price) return;
        this.state.money -= car.price;
        this.state.owned.push(car.id);
        ensureCarState(this.state, car.id);
        this.state.current = car.id;
        persist(this.state);
        this.game.audio.scoreBank();
        this.buildGarage();
        this.refreshMoney();
      });
      actions.appendChild(buy);
    } else if (this.state.current !== car.id) {
      const use = document.createElement('button');
      use.className = 'big';
      use.innerHTML = '<span>VALITSE TÄMÄ</span>';
      use.addEventListener('click', () => {
        this.state.current = car.id;
        persist(this.state);
        this.game.audio.uiClick();
        this.buildGarage();
      });
      actions.appendChild(use);
    } else {
      const drive = document.createElement('button');
      drive.className = 'big';
      drive.innerHTML = '<span>AJAMAAN</span>';
      drive.addEventListener('click', () => this.show('tracks'));
      actions.appendChild(drive);
    }
  }

  renderStats(spec, car) {
    const perf = measurePerformance(spec);
    const topSpeed = perf.topSpeed;
    const zeroToHundred = perf.zeroToHundred;
    const stars = specStars(spec);
    const labels = { teho: 'TEHO', pito: 'PITO', kulma: 'KULMA', keveys: 'KEVEYS', tasapaino: 'TASAPAINO' };
    this.el('tabStats').innerHTML = `
      <div class="spec-grid">
        <div class="spec"><small>TEHO</small><b>${spec.peakPowerHp} hv</b></div>
        <div class="spec"><small>MASSA</small><b>${Math.round(spec.mass)} kg</b></div>
        <div class="spec"><small>HUIPPUNOPEUS</small><b>${Math.round(topSpeed)} km/h</b></div>
        <div class="spec"><small>0-100</small><b>${zeroToHundred ? zeroToHundred.toFixed(1) + ' s' : '-'}</b></div>
        <div class="spec"><small>OHJAUSKULMA</small><b>${Math.round(spec.maxSteerDeg)}&deg;</b></div>
        <div class="spec"><small>PAINOJAKAUMA</small><b>${Math.round(spec.cgToRear / spec.wheelbase * 100)}/${Math.round(spec.cgToFront / spec.wheelbase * 100)}</b></div>
      </div>
      ${Object.keys(labels).map((k) => `
        <div class="bar-row">
          <span>${labels[k]}</span>
          <div class="bar"><i style="width:${Math.round(stars[k] * 100)}%"></i></div>
          <b>${Math.round(stars[k] * 100)}</b>
        </div>`).join('')}`;
  }

  renderUpgrades(car, cs) {
    const body = this.el('tabUpgrades');
    if (!cs) {
      body.innerHTML = '<p class="tune-note">Osta auto ensin, niin pääset virittämään sitä.</p>';
      return;
    }
    body.innerHTML = '';
    for (const key of UPGRADE_KEYS) {
      const u = UPGRADES[key];
      const level = cs.upgrades[key] || 0;
      const cost = upgradeCost(key, level);
      const afford = cost !== null && this.state.money >= cost;
      const row = document.createElement('div');
      row.className = 'up-row';
      row.innerHTML = `
        <div>
          <div class="up-name">${u.name}</div>
          <div class="up-desc">${u.desc}</div>
          <div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</div>
        </div>
        <button class="buy ${cost === null ? 'max' : afford ? '' : 'no'}">${cost === null ? 'TÄYNNÄ' : '&euro; ' + fmt(cost)}</button>`;
      row.querySelector('button').addEventListener('click', () => {
        if (cost === null || !afford) return;
        this.state.money -= cost;
        cs.upgrades[key] = level + 1;
        // Kulmasarja nostaa myös käytössä olevaa ohjauskulmaa, ettei osto tunnu tyhjältä.
        if (key === 'angle') cs.tune.steerAngle = car.maxSteer + 6 * cs.upgrades.angle;
        if (key === 'lsd' && cs.tune.lsdLock < 0.4) cs.tune.lsdLock = 0.5;
        persist(this.state);
        this.game.audio.scoreBank();
        this.renderGarageDetail();
        this.refreshMoney();
        this.game.showroomCar(this.garageCar);
      });
      body.appendChild(row);
    }
  }

  renderTune(car, cs, spec) {
    const body = this.el('tabTune');
    if (!cs) {
      body.innerHTML = '<p class="tune-note">Säädöt aukeavat kun auto on omassa tallissa.</p>';
      return;
    }
    const maxSteer = car.maxSteer + 6 * (cs.upgrades.angle || 0);
    const rows = [
      { key: 'steerAngle', label: 'Ohjauskulma', min: car.maxSteer - 6, max: maxSteer, step: 1, unit: '°' },
      { key: 'brakeBalance', label: 'Jarrujako (etu)', min: 0.35, max: 0.8, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'rollBalance', label: 'Kallistusjako', min: 0.3, max: 0.75, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'finalDrive', label: 'Perävälitys', min: 0.8, max: 1.3, step: 0.01, fmt: (v) => v.toFixed(2) + 'x' },
      { key: 'lsdLock', label: 'Lukkoprosentti', min: 0, max: 0.95, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', need: 'lsd' },
      { key: 'camber', label: 'Camber', min: 0, max: 4, step: 0.1, fmt: (v) => '-' + v.toFixed(1) + '°', need: 'suspension' },
      { key: 'rideHeight', label: 'Maavara', min: 0, max: 1, step: 0.05, fmt: (v) => (v < 0.34 ? 'matala' : v > 0.66 ? 'korkea' : 'vakio'), need: 'suspension' },
      { key: 'powerLimit', label: 'Tehonrajoitin', min: 0.5, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' }
    ];
    body.innerHTML = rows.map((r) => {
      const locked = r.need && !(cs.upgrades[r.need] > 0);
      const v = cs.tune[r.key];
      return `<div class="tune-row">
        <label>${r.label}${locked ? ' <span class="locked">&#128274;</span>' : ''}</label>
        <input type="range" data-key="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" ${locked ? 'disabled' : ''}>
        <output data-out="${r.key}">${r.fmt ? r.fmt(v) : Math.round(v) + (r.unit || '')}</output>
      </div>`;
    }).join('') + `
      <div class="tune-row">
        <label>Luistonesto</label>
        <div class="seg">
          <button data-toggle="tcs" class="${cs.tune.tcs ? 'sel' : ''}">PÄÄLLÄ</button>
          <button data-toggle="tcs-off" class="${cs.tune.tcs ? '' : 'sel'}">POIS</button>
        </div><output></output>
      </div>
      <div class="tune-row">
        <label>Lukkiutumaton jarru</label>
        <div class="seg">
          <button data-toggle="abs" class="${cs.tune.abs ? 'sel' : ''}">PÄÄLLÄ</button>
          <button data-toggle="abs-off" class="${cs.tune.abs ? '' : 'sel'}">POIS</button>
        </div><output></output>
      </div>
      <p class="tune-note">Suurempi ohjauskulma pitää auton hallinnassa jyrkemmissä kulmissa. Pehmeämpi
      kallistusjako edessä lisää takapään liikkuvuutta. Perävälitys lyhyemmäksi = terävämpi
      kaasuvaste mutta matalampi huippunopeus. Tehonrajoitin auttaa liukkaalla.</p>
      <div style="margin-top:14px"><button class="buy" data-reset="1">PALAUTA OLETUKSET</button></div>`;

    body.querySelectorAll('input[type=range]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const r = rows.find((x) => x.key === inp.dataset.key);
        const v = parseFloat(inp.value);
        cs.tune[r.key] = v;
        body.querySelector(`[data-out="${r.key}"]`).textContent = r.fmt ? r.fmt(v) : Math.round(v) + (r.unit || '');
        persist(this.state);
        this.renderStats(buildSpec(car.id, cs.upgrades, cs.tune), car);
      });
    });
    body.querySelectorAll('[data-toggle]').forEach((b) => {
      b.addEventListener('click', () => {
        const t = b.dataset.toggle;
        if (t === 'tcs') cs.tune.tcs = true;
        if (t === 'tcs-off') cs.tune.tcs = false;
        if (t === 'abs') cs.tune.abs = true;
        if (t === 'abs-off') cs.tune.abs = false;
        persist(this.state);
        this.renderTune(car, cs, spec);
        this.game.audio.uiClick();
      });
    });
    const reset = body.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', () => {
      cs.tune = defaultTune(car);
      cs.tune.steerAngle = car.maxSteer + 6 * (cs.upgrades.angle || 0);
      persist(this.state);
      this.renderGarageDetail();
    });
  }

  renderPaint(car, cs) {
    const body = this.el('tabPaint');
    if (!cs) {
      body.innerHTML = '<p class="tune-note">Maalaamo on käytettävissä omille autoille.</p>';
      return;
    }
    body.innerHTML = `
      <div class="paint-label">KORIN VÄRI</div>
      <div class="swatches" data-role="body">${BODY_COLORS.map((c) =>
        `<button class="swatch ${cs.paint.body === c ? 'sel' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}</div>
      <div class="paint-label">VANTEET</div>
      <div class="swatches" data-role="rim">${RIM_COLORS.map((c) =>
        `<button class="swatch ${cs.paint.rim === c ? 'sel' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}</div>
      <div class="paint-label">PINTA</div>
      <div class="finish-toggle">
        <button data-finish="gloss" class="${cs.paint.finish !== 'matte' ? 'sel' : ''}">KIILTÄVÄ</button>
        <button data-finish="matte" class="${cs.paint.finish === 'matte' ? 'sel' : ''}">MATTA</button>
      </div>`;
    body.querySelectorAll('.swatch').forEach((b) => {
      b.addEventListener('click', () => {
        const role = b.parentElement.dataset.role;
        cs.paint[role === 'body' ? 'body' : 'rim'] = b.dataset.color;
        persist(this.state);
        this.renderPaint(car, cs);
        this.game.showroomCar(this.garageCar);
      });
    });
    body.querySelectorAll('[data-finish]').forEach((b) => {
      b.addEventListener('click', () => {
        cs.paint.finish = b.dataset.finish;
        persist(this.state);
        this.renderPaint(car, cs);
        this.game.showroomCar(this.garageCar);
      });
    });
  }

  // -------------------------------------------------------------- asetukset

  buildSettings() {
    const s = this.state.settings;
    const body = this.el('settingsBody');
    body.innerHTML = `
      <div class="set-row"><label>Äänenvoimakkuus</label>
        <input type="range" id="setVol" min="0" max="1" step="0.05" value="${s.volume}">
        <output id="outVol">${Math.round(s.volume * 100)}%</output></div>
      <div class="set-row"><label>Äänet</label>
        <div class="seg" id="setSound">
          <button data-v="1" class="${s.sound ? 'sel' : ''}">PÄÄLLÄ</button>
          <button data-v="0" class="${s.sound ? '' : 'sel'}">POIS</button>
        </div><output></output></div>
      <div class="set-row"><label>Vastaohjausapu</label>
        <input type="range" id="setAssist" min="0" max="1" step="0.05" value="${s.assist}">
        <output id="outAssist">${Math.round(s.assist * 100)}%</output></div>
      <div class="set-row"><label>Vaihteisto</label>
        <div class="seg" id="setGear">
          <button data-v="1" class="${s.autoGear ? 'sel' : ''}">AUTOMAATTI</button>
          <button data-v="0" class="${s.autoGear ? '' : 'sel'}">MANUAALI</button>
        </div><output></output></div>
      <div class="set-row"><label>Kamera</label>
        <div class="seg" id="setCam">
          <button data-v="chase" class="${s.camera === 'chase' ? 'sel' : ''}">SEURAAVA</button>
          <button data-v="hood" class="${s.camera === 'hood' ? 'sel' : ''}">KONEPELTI</button>
          <button data-v="far" class="${s.camera === 'far' ? 'sel' : ''}">KAUKO</button>
        </div><output></output></div>
      <div class="set-row"><label>Ohjaustuntuma</label>
        <input type="range" id="setSens" min="0.5" max="1.5" step="0.05" value="${s.sensitivity}">
        <output id="outSens">${s.sensitivity.toFixed(2)}x</output></div>
      <div class="set-row"><label>Grafiikka</label>
        <div class="seg" id="setQual">
          <button data-v="low" class="${s.quality === 'low' ? 'sel' : ''}">KEVYT</button>
          <button data-v="medium" class="${s.quality === 'medium' ? 'sel' : ''}">NORMAALI</button>
          <button data-v="high" class="${s.quality === 'high' ? 'sel' : ''}">KORKEA</button>
        </div><output></output></div>
      <div class="set-row"><label>Varjot</label>
        <div class="seg" id="setShadow">
          <button data-v="1" class="${s.shadows ? 'sel' : ''}">PÄÄLLÄ</button>
          <button data-v="0" class="${s.shadows ? '' : 'sel'}">POIS</button>
        </div><output></output></div>
      <div class="set-row"><label>Tallennus</label>
        <div class="seg"><button class="danger" id="setReset">NOLLAA KAIKKI</button></div><output></output></div>
      <p class="tune-note">Peli tallentaa edistymisen vain tähän selaimeen. Nollaus poistaa autot,
      rahat ja ennätykset lopullisesti.</p>`;

    const range = (id, out, key, fmtFn, apply) => {
      const inp = document.getElementById(id);
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        s[key] = v;
        document.getElementById(out).textContent = fmtFn(v);
        if (apply) apply(v);
        persist(this.state);
      });
    };
    range('setVol', 'outVol', 'volume', (v) => Math.round(v * 100) + '%', (v) => this.game.audio.setVolume(v));
    range('setAssist', 'outAssist', 'assist', (v) => Math.round(v * 100) + '%');
    range('setSens', 'outSens', 'sensitivity', (v) => v.toFixed(2) + 'x', (v) => { this.game.input.sensitivity = v; });

    const seg = (id, key, parse, apply) => {
      const wrap = document.getElementById(id);
      if (!wrap) return;
      wrap.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => {
          wrap.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
          s[key] = parse(b.dataset.v);
          if (apply) apply(s[key]);
          persist(this.state);
          this.game.audio.uiClick();
        });
      });
    };
    seg('setSound', 'sound', (v) => v === '1', (v) => this.game.audio.setEnabled(v));
    seg('setGear', 'autoGear', (v) => v === '1');
    seg('setCam', 'camera', (v) => v, (v) => this.game.setCamera(v));
    // Kasin valittu laatu lukitsee automaattisen laadunpudotuksen.
    seg('setQual', 'quality', (v) => v, () => {
      this.game.qualityLocked = true;
      this.game.applyQuality();
    });
    seg('setShadow', 'shadows', (v) => v === '1', () => this.game.applyQuality());

    document.getElementById('setReset').addEventListener('click', () => {
      if (!confirm('Nollataanko kaikki edistyminen? Tätä ei voi perua.')) return;
      this.game.state = resetSave();
      this.state = this.game.state;
      this.garageCar = this.state.current;
      this.game.audio.scoreLost();
      this.show('main');
    });
  }

  // ---------------------------------------------------------------- tulokset

  showResults(result, money, record, trackDef) {
    this.el('resultTitle').textContent = trackDef ? trackDef.name.toUpperCase() : 'AJO PÄÄTTYI';
    this.el('resultScore').textContent = fmt(result.total);
    this.el('resultRecord').classList.toggle('hidden', !record);
    this.el('resultMoney').textContent = fmt(money);
    this.el('resultGrid').innerHTML = `
      <div><small>PARAS SARJA</small><b>${fmt(result.best)}</b></div>
      <div><small>PARAS KERROIN</small><b>x${result.bestCombo.toFixed(1)}</b></div>
      <div><small>PISIN DRIFTI</small><b>${result.longestDrift.toFixed(1)} s</b></div>
      <div><small>HUIPPUNOPEUS</small><b>${result.topSpeed} km/h</b></div>
      <div><small>KLIPSIT</small><b>${result.clips}</b></div>
      <div><small>SUUNNANVAIHDOT</small><b>${result.transitions}</b></div>
      ${result.nearMisses ? `<div><small>OHILIPAISUT</small><b>${result.nearMisses}</b></div>` : ''}
      <div><small>OSUMAT</small><b>${result.wallHits}</b></div>`;
    this.show('results');
  }
}
