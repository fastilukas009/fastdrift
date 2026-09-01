// Siviililiikenne: autot ajavat katuverkossa omalla kaistallaan, pysähtyvät punaisiin
// valoihin, pitävät etäisyyttä edellä ajavaan ja väistävät pelaajaa.
//
// Auto kulkee aina jotakin polkua pitkin: joko suoraa kaistaa risteysten välillä tai
// Bezier-kaarta risteyksen läpi. Kaikki liikenne piirretään kahtena instansoituna
// kutsuna, joten autojen määrä ei kaada suorituskykyä.

import * as THREE from '../vendor/three.module.min.js';

// Kummalle puolelle keskilinjaa ajetaan. Kaikki liikenne käyttää samaa merkkiä, joten
// vastaantulijat ohittavat aina samalta puolelta.
const LANE_SIDE = -1;
const LIGHT_CYCLE = 19;

function hash2(i, j) {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

// Yksinkertainen laatikkojen yhdistäminen yhdeksi geometriaksi. Väri tulee
// verteksiväreistä, jotta yksi materiaali riittää koko autolle.
function mergeBoxes(parts) {
  const pos = [], norm = [], col = [], idx = [];
  let base = 0;
  for (const p of parts) {
    const g = new THREE.BoxGeometry(p.w, p.h, p.d);
    const gp = g.attributes.position.array;
    const gn = g.attributes.normal.array;
    const gi = g.index.array;
    for (let k = 0; k < gp.length; k += 3) {
      pos.push(gp[k] + p.x, gp[k + 1] + p.y, gp[k + 2] + p.z);
      norm.push(gn[k], gn[k + 1], gn[k + 2]);
      col.push(p.c[0], p.c[1], p.c[2]);
    }
    for (let k = 0; k < gi.length; k++) idx.push(gi[k] + base);
    base += gp.length / 3;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

const BODY_COLORS = [
  [0.82, 0.83, 0.86], [0.13, 0.14, 0.17], [0.58, 0.60, 0.64], [0.72, 0.18, 0.16],
  [0.16, 0.32, 0.62], [0.90, 0.86, 0.78], [0.20, 0.44, 0.34], [0.86, 0.62, 0.16],
  [0.42, 0.44, 0.50], [0.94, 0.94, 0.95]
];

export class Traffic {
  constructor(city, count = 50) {
    this.city = city;
    this.group = new THREE.Group();
    this.cars = [];
    this.time = 0;
    this.disposables = [];

    this.buildMeshes(count);
    for (let i = 0; i < count; i++) this.cars.push(this.spawnCar(i));
    this.buildLights();
  }

  buildMeshes(count) {
    // Verteksivärit: kori valkoinen (instanssiväri sävyttää sen), ohjaamo ja renkaat
    // tummia (tummuus säilyy sävytyksestä huolimatta).
    const white = [1, 1, 1], glass = [0.10, 0.12, 0.16], tire = [0.05, 0.05, 0.06];
    const bodyGeo = mergeBoxes([
      { w: 1.82, h: 0.72, d: 4.30, x: 0, y: 0.66, z: 0, c: white },
      { w: 1.66, h: 0.58, d: 2.05, x: 0, y: 1.28, z: -0.24, c: glass },
      { w: 1.70, h: 0.16, d: 0.30, x: 0, y: 0.42, z: 2.10, c: tire },
      { w: 1.70, h: 0.16, d: 0.30, x: 0, y: 0.42, z: -2.10, c: tire },
      { w: 0.26, h: 0.60, d: 0.60, x: -0.86, y: 0.34, z: 1.42, c: tire },
      { w: 0.26, h: 0.60, d: 0.60, x: 0.86, y: 0.34, z: 1.42, c: tire },
      { w: 0.26, h: 0.60, d: 0.60, x: -0.86, y: 0.34, z: -1.44, c: tire },
      { w: 0.26, h: 0.60, d: 0.60, x: 0.86, y: 0.34, z: -1.44, c: tire }
    ]);
    const bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.42, metalness: 0.35, envMapIntensity: 1.4
    });
    this.bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bodies.castShadow = true;
    this.bodies.receiveShadow = true;
    this.bodies.frustumCulled = false;
    this.group.add(this.bodies);
    this.disposables.push(bodyGeo, bodyMat);

    // Valot omana instanssinaan, jotta ne voivat hehkua korin väristä riippumatta.
    const lampGeo = mergeBoxes([
      { w: 0.34, h: 0.13, d: 0.09, x: -0.56, y: 0.80, z: 2.18, c: [1, 0.97, 0.85] },
      { w: 0.34, h: 0.13, d: 0.09, x: 0.56, y: 0.80, z: 2.18, c: [1, 0.97, 0.85] },
      { w: 0.36, h: 0.13, d: 0.09, x: -0.56, y: 0.82, z: -2.18, c: [1, 0.16, 0.12] },
      { w: 0.36, h: 0.13, d: 0.09, x: 0.56, y: 0.82, z: -2.18, c: [1, 0.16, 0.12] }
    ]);
    const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.lamps = new THREE.InstancedMesh(lampGeo, lampMat, count);
    this.lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lamps.frustumCulled = false;
    this.group.add(this.lamps);
    this.disposables.push(lampGeo, lampMat);

    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
  }

  // -- katuverkko ----------------------------------------------------------

  // Risteyksen valo: vaakasuunta vihreänä syklin alkupuolen, pystysuunta lopun.
  greenFor(i, j, horizontal) {
    const p = ((this.time / LIGHT_CYCLE) + hash2(i, j)) % 1;
    return horizontal ? p < 0.44 : (p >= 0.5 && p < 0.94);
  }

  // Kaistapiste: risteyksen reunalla, keskilinjasta sivuun ajosuunnan mukaan.
  lanePoint(i, j, dirX, dirZ, backOff) {
    const c = this.city;
    const px = c.xs[i], pz = c.zs[j];
    // Kohtisuora ajosuuntaan: (dz, -dx). Sama merkki kaikille, joten vastaantulijat
    // kulkevat aina eri puolilla keskilinjaa.
    const perpX = dirZ * LANE_SIDE, perpZ = -dirX * LANE_SIDE;
    const off = c.laneOffset(dirX !== 0 ? 'h' : 'v', dirX !== 0 ? j : i);
    return {
      x: px - dirX * backOff + perpX * off,
      z: pz - dirZ * backOff + perpZ * off
    };
  }

  // Risteyksen puolikas leveys ajosuunnassa: risteävän kadun leveys.
  crossHalf(i, j, horizontal) {
    return horizontal ? this.city.halfV(i) : this.city.halfH(j);
  }

  neighbours(i, j) {
    const c = this.city;
    const out = [];
    if (i > 0) out.push([i - 1, j]);
    if (i < c.xs.length - 1) out.push([i + 1, j]);
    if (j > 0) out.push([i, j - 1]);
    if (j < c.zs.length - 1) out.push([i, j + 1]);
    return out;
  }

  startEdge(car, fi, fj, i, j) {
    const dirX = Math.sign(this.city.xs[i] - this.city.xs[fi]);
    const dirZ = Math.sign(this.city.zs[j] - this.city.zs[fj]);
    const horizontal = dirX !== 0;
    const a = this.lanePoint(fi, fj, dirX, dirZ, -this.crossHalf(fi, fj, horizontal) - 1.5);
    const b = this.lanePoint(i, j, dirX, dirZ, this.crossHalf(i, j, horizontal) + 1.5);
    car.mode = 'edge';
    car.fi = fi; car.fj = fj; car.i = i; car.j = j;
    car.dirX = dirX; car.dirZ = dirZ;
    car.horizontal = horizontal;
    car.ax = a.x; car.az = a.z;
    car.bx = b.x; car.bz = b.z;
    car.len = Math.hypot(b.x - a.x, b.z - a.z);
    car.s = 0;
    car.limit = this.city.speedLimit(horizontal ? 'h' : 'v', horizontal ? fj : fi);
  }

  startTurn(car) {
    const opts = this.neighbours(car.i, car.j).filter(([ni, nj]) => !(ni === car.fi && nj === car.fj));
    const pick = opts.length ? opts[Math.floor(Math.random() * opts.length)] : [car.fi, car.fj];
    const [ni, nj] = pick;
    const ndirX = Math.sign(this.city.xs[ni] - this.city.xs[car.i]);
    const ndirZ = Math.sign(this.city.zs[nj] - this.city.zs[car.j]);
    const nHoriz = ndirX !== 0;
    const exit = this.lanePoint(car.i, car.j, ndirX, ndirZ, -this.crossHalf(car.i, car.j, nHoriz) - 1.5);
    car.mode = 'turn';
    car.tax = car.bx; car.taz = car.bz;
    car.tbx = exit.x; car.tbz = exit.z;
    car.tcx = this.city.xs[car.i]; car.tcz = this.city.zs[car.j];
    car.next = { fi: car.i, fj: car.j, i: ni, j: nj };
    car.s = 0;
    car.len = Math.hypot(car.tbx - car.tax, car.tbz - car.taz) * 1.18;
  }

  spawnCar(index) {
    const c = this.city;
    const car = {
      color: BODY_COLORS[index % BODY_COLORS.length],
      speed: 8, stun: 0, ox: 0, oz: 0, yaw: 0, x: 0, z: 0
    };
    const i = 1 + Math.floor(Math.random() * (c.xs.length - 2));
    const j = 1 + Math.floor(Math.random() * (c.zs.length - 2));
    const n = this.neighbours(i, j);
    const [ni, nj] = n[Math.floor(Math.random() * n.length)];
    this.startEdge(car, i, j, ni, nj);
    car.s = Math.random() * car.len;
    return car;
  }

  buildLights() {
    const c = this.city;
    const spots = [];
    for (let i = 0; i < c.xs.length; i++) {
      for (let j = 0; j < c.zs.length; j++) {
        if (c.isMajor('v', i) && c.isMajor('h', j)) spots.push([i, j]);
      }
    }
    this.lightSpots = spots;
    if (!spots.length) return;

    const poleGeo = new THREE.CylinderGeometry(0.09, 0.11, 5.2, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.7, metalness: 0.4 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length * 2);
    const lampGeo = new THREE.BoxGeometry(0.26, 0.7, 0.22);
    const lampMat = new THREE.MeshBasicMaterial({ vertexColors: false });
    this.signalMat = lampMat;
    this.signals = new THREE.InstancedMesh(lampGeo, lampMat, spots.length * 2);
    this.signals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const d = new THREE.Object3D();
    let n = 0;
    this.signalDirs = [];
    for (const [i, j] of spots) {
      const px = c.xs[i], pz = c.zs[j];
      const hv = c.halfV(i), hh = c.halfH(j);
      // Kaksi opastinta risteystä kohti: toinen vaakasuunnalle, toinen pystysuunnalle.
      for (const [dx, dz, horiz] of [[1, 0, true], [0, 1, false]]) {
        const x = px + dx * (hv + 1.4) - dz * 0;
        const z = pz + dz * (hh + 1.4);
        d.position.set(x, 2.6, z); d.rotation.set(0, 0, 0); d.updateMatrix();
        poles.setMatrixAt(n, d.matrix);
        d.position.set(x, 5.0, z); d.updateMatrix();
        this.signals.setMatrixAt(n, d.matrix);
        this.signalDirs.push({ i, j, horizontal: horiz });
        n++;
      }
    }
    poles.castShadow = true;
    this.group.add(poles, this.signals);
    this.disposables.push(poleGeo, poleMat, lampGeo, lampMat);
    this.signalColor = new THREE.Color();
  }

  // -- päivitys ------------------------------------------------------------

  update(dt, player) {
    this.time += dt;
    const cars = this.cars;

    // Kaistakohtaiset jonot, jotta edellä ajavan etsintä ei ole neliöllinen.
    const buckets = new Map();
    for (const car of cars) {
      if (car.mode !== 'edge') continue;
      const key = car.fi + ':' + car.fj + '>' + car.i + ':' + car.j;
      let b = buckets.get(key);
      if (!b) { b = []; buckets.set(key, b); }
      b.push(car);
    }
    for (const b of buckets.values()) b.sort((a, c) => a.s - c.s);

    const px = player ? player.x : 1e9;
    const pz = player ? player.z : 1e9;

    for (const car of cars) {
      if (car.stun > 0) {
        car.stun -= dt;
        car.ox += car.kx * dt; car.oz += car.kz * dt;
        car.kx *= Math.pow(0.12, dt); car.kz *= Math.pow(0.12, dt);
        car.speed *= Math.pow(0.05, dt);
        this.place(car);
        continue;
      }
      // Poikkeama kaistalta palautuu hitaasti töytäisyn jälkeen.
      car.ox *= Math.pow(0.25, dt);
      car.oz *= Math.pow(0.25, dt);

      let target = car.limit;

      // 1. edellä ajava samalla kaistalla
      if (car.mode === 'edge') {
        const key = car.fi + ':' + car.fj + '>' + car.i + ':' + car.j;
        const b = buckets.get(key);
        if (b) {
          const k = b.indexOf(car);
          const ahead = b[k + 1];
          if (ahead) {
            const gap = ahead.s - car.s - 5.2;
            if (gap < 2) target = 0;
            else if (gap < 16) target = Math.min(target, ahead.speed * 0.9 + gap * 0.35);
          }
        }
      }

      // 2. punainen valo risteyksen edessä
      if (car.mode === 'edge' && this.city.isMajor('v', car.i) && this.city.isMajor('h', car.j)) {
        const toStop = car.len - car.s;
        if (!this.greenFor(car.i, car.j, car.horizontal)) {
          if (toStop < 2) target = 0;
          else if (toStop < 26) target = Math.min(target, toStop * 0.42);
        }
      }

      // 3. pelaaja edessä
      if (player) {
        const dx = px - car.x, dz = pz - car.z;
        const fwd = dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw);
        const side = Math.abs(dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw));
        if (fwd > 0 && fwd < 22 && side < 3.4) target = Math.min(target, Math.max(0, fwd * 0.4 - 2));
      }

      const accel = target > car.speed ? 3.2 : 9;
      car.speed += Math.max(-accel * dt, Math.min(accel * dt, target - car.speed));
      car.speed = Math.max(0, car.speed);
      car.s += car.speed * dt;

      if (car.s >= car.len) {
        if (car.mode === 'edge') this.startTurn(car);
        else {
          const n = car.next;
          this.startEdge(car, n.fi, n.fj, n.i, n.j);
        }
      }
      this.place(car);
    }

    this.flush();
    this.updateSignals();
  }

  place(car) {
    let x, z, dx, dz;
    if (car.mode === 'edge') {
      const t = car.len > 0 ? car.s / car.len : 0;
      x = car.ax + (car.bx - car.ax) * t;
      z = car.az + (car.bz - car.az) * t;
      dx = car.bx - car.ax; dz = car.bz - car.az;
    } else {
      const t = car.len > 0 ? Math.min(1, car.s / car.len) : 1;
      const u = 1 - t;
      x = u * u * car.tax + 2 * u * t * car.tcx + t * t * car.tbx;
      z = u * u * car.taz + 2 * u * t * car.tcz + t * t * car.tbz;
      dx = 2 * u * (car.tcx - car.tax) + 2 * t * (car.tbx - car.tcx);
      dz = 2 * u * (car.tcz - car.taz) + 2 * t * (car.tbz - car.tcz);
    }
    car.x = x + car.ox;
    car.z = z + car.oz;
    const len = Math.hypot(dx, dz) || 1;
    car.yaw = Math.atan2(dx / len, dz / len);
  }

  flush() {
    const d = this.dummy;
    for (let k = 0; k < this.cars.length; k++) {
      const car = this.cars[k];
      d.position.set(car.x, 0, car.z);
      d.rotation.set(0, car.yaw, 0);
      d.updateMatrix();
      this.bodies.setMatrixAt(k, d.matrix);
      this.lamps.setMatrixAt(k, d.matrix);
      if (!car.colorSet) {
        this.color.setRGB(car.color[0], car.color[1], car.color[2]);
        this.bodies.setColorAt(k, this.color);
        car.colorSet = true;
      }
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
  }

  updateSignals() {
    if (!this.signals) return;
    const c = this.signalColor;
    for (let k = 0; k < this.signalDirs.length; k++) {
      const s = this.signalDirs[k];
      const green = this.greenFor(s.i, s.j, s.horizontal);
      if (green) c.setRGB(0.15, 0.95, 0.35);
      else c.setRGB(0.95, 0.12, 0.12);
      this.signals.setColorAt(k, c);
    }
    if (this.signals.instanceColor) this.signals.instanceColor.needsUpdate = true;
  }

  // -- vuorovaikutus pelaajan kanssa ---------------------------------------

  collide(vehicle) {
    const r = vehicle.spec.body.width * 0.46 + 1.5;
    let worst = 0;
    for (const car of this.cars) {
      const dx = vehicle.x - car.x, dz = vehicle.z - car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d, nz = dz / d;
      const impact = vehicle.applyImpact(nx, nz, r - d, 0.2);
      // Osuma sysää siviiliauton sivuun ja pysäyttää sen hetkeksi.
      car.stun = 2.4 + Math.random();
      car.kx = -nx * (3 + impact * 0.8);
      car.kz = -nz * (3 + impact * 0.8);
      if (impact > worst) worst = impact;
    }
    return worst;
  }

  // Lähin siviiliauto: läheltä piti -bonus mitataan tästä.
  nearestDistance(x, z) {
    let best = 99;
    for (const car of this.cars) {
      const d = Math.hypot(car.x - x, car.z - z);
      if (d < best) best = d;
    }
    return best;
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.group.clear();
  }
}
