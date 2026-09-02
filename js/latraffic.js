// LATrafficAndPedestrianManager
// =============================
// Yksi hallinta sekä ajoneuvo- että jalankulkijatekoälylle avoimessa kaupungissa.
//
// SUORITUSKYVYN PERUSRATKAISUT (nämä kolme pitävät ruudunpäivityksen tasaisena):
//
//  1. KIINTEÄ AGENTTIPOOLI + KIERRÄTYS. Autoja ja jalankulkijoita on aina sama
//     määrä. Kun agentti ajautuu kauas pelaajasta, se siirretään uuteen paikkaan
//     pelaajan lähelle sen sijaan että maailmaan luotaisiin uusia. Muistia ei
//     varata ajon aikana lainkaan, joten roskienkeruu ei aiheuta nykäyksiä.
//
//  2. HILAHAKU NAAPUREILLE. Törmäysten välttely tarvitsee tiedon lähimmistä
//     agenteista. Naiivi vertailu olisi O(n^2); tässä agentit lajitellaan joka
//     tikillä soluihin ja verrataan vain 3x3-soluruutuun.
//
//  3. PORRASTETTU PÄIVITYS. Kaukana pelaajasta olevat agentit päivitetään
//     joka neljäs tikki ja ilman naapurihakua. Ne liikkuvat silti oikein, mutta
//     eivät kuluta laskentaa yksityiskohtiin joita kukaan ei näe.
//
// Piirto tapahtuu neljänä instansoituna kutsuna (korit, valot, vilkut, ihmiset)
// riippumatta siitä onko agentteja 50 vai 500.

import * as THREE from '../vendor/three.module.min.js';

// Kummalle puolelle keskilinjaa ajetaan. Kaikki liikenne käyttää samaa merkkiä,
// joten vastaantulijat ohittavat aina samalta puolelta.
const LANE_SIDE = -1;
const LIGHT_CYCLE = 19;
// Vilkun merkki: jos kääntyminen näyttää vilkuttavan väärää puolta, käännä tämä.
const BLINKER_SIDE = 1;

const CAR_LEN = 4.3;
const PED_RADIUS = 0.34;
const HASH_CELL = 8;
// Etäisyydenpito: jarrutuskiihtyvyys ja pysähdysväli edellä ajavaan.
const FOLLOW_DECEL = 6;
const FOLLOW_GAP = 3.0;

function hash2(i, j) {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

// Laatikoiden yhdistäminen yhdeksi geometriaksi. Väri tulee verteksiväreistä,
// jolloin yksi materiaali ja yksi piirtokutsu riittää koko agenttijoukolle.
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

const CAR_COLORS = [
  [0.82, 0.83, 0.86], [0.13, 0.14, 0.17], [0.58, 0.60, 0.64], [0.72, 0.18, 0.16],
  [0.16, 0.32, 0.62], [0.90, 0.86, 0.78], [0.20, 0.44, 0.34], [0.86, 0.62, 0.16],
  [0.42, 0.44, 0.50], [0.94, 0.94, 0.95]
];
const SHIRT_COLORS = [
  [0.86, 0.30, 0.26], [0.20, 0.36, 0.68], [0.94, 0.92, 0.88], [0.22, 0.24, 0.28],
  [0.94, 0.74, 0.24], [0.30, 0.58, 0.44], [0.74, 0.44, 0.72], [0.55, 0.58, 0.62]
];

// Karkea tilaindeksi: agentit soluihin, naapurihaku 3x3-ruudusta.
class SpatialHash {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  clear() { this.map.clear(); }
  insert(agent) {
    const k = Math.floor(agent.x / this.cell) + ',' + Math.floor(agent.z / this.cell);
    let list = this.map.get(k);
    if (!list) { list = []; this.map.set(k, list); }
    list.push(agent);
  }
  forEachNear(x, z, fn) {
    const gx = Math.floor(x / this.cell), gz = Math.floor(z / this.cell);
    for (let i = gx - 1; i <= gx + 1; i++) {
      for (let j = gz - 1; j <= gz + 1; j++) {
        const list = this.map.get(i + ',' + j);
        if (!list) continue;
        for (const a of list) fn(a);
      }
    }
  }
}

export class LATrafficAndPedestrianManager {
  /**
   * @param {City} city  Kaupunki, joka tarjoaa katuverkon: xs, zs, halfV, halfH,
   *                     isMajor, lanesEachWay, speedLimit ja blocks.
   * @param {object} opts
   * @param {number} opts.cars        ajoneuvojen määrä poolissa
   * @param {number} opts.pedestrians jalankulkijoiden määrä poolissa
   * @param {number} opts.farRadius   etäisyys jonka jälkeen agentti kierrätetään
   * @param {number} opts.detailRadius etäisyys jonka sisällä tehdään naapurihaku
   */
  constructor(city, opts = {}) {
    this.city = city;
    this.cars = [];
    this.peds = [];
    this.time = 0;
    this.tick = 0;
    this.group = new THREE.Group();
    this.disposables = [];

    // Kaksi eri kierrätyssädettä. Auto liikkuu 15 m/s ja tulee vastaan itsestään,
    // joten sen saa kierrättää kauas. Jalankulkija kävelee 1,4 m/s: jos hänet
    // heitetään 300 metrin päähän, hän ei ehdi pelaajan lähelle koskaan, ja
    // jalkakäytävät näyttävät autiolta. Siksi kävelijän rengas on paljon tiukempi.
    this.farRadius = opts.farRadius || 240;
    this.pedFarRadius = opts.pedFarRadius || 150;
    this.detailRadius = opts.detailRadius || 130;
    this.carHash = new SpatialHash(HASH_CELL);
    this.pedHash = new SpatialHash(HASH_CELL);

    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();

    const carCount = opts.cars ?? 56;
    const pedCount = opts.pedestrians ?? 90;
    this.buildCarMeshes(carCount);
    this.buildPedMeshes(pedCount);
    this.buildSignals();

    for (let i = 0; i < carCount; i++) this.cars.push(this.makeCar(i));
    this.buildSidewalkLoops();
    for (let i = 0; i < pedCount; i++) this.peds.push(this.makePed(i));
  }

  // =====================================================================
  // Piirto
  // =====================================================================

  buildCarMeshes(count) {
    const white = [1, 1, 1], glass = [0.10, 0.12, 0.16], tire = [0.05, 0.05, 0.06];
    const bodyGeo = mergeBoxes([
      { w: 1.82, h: 0.72, d: CAR_LEN, x: 0, y: 0.66, z: 0, c: white },
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
    this.carBodies = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
    this.carBodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carBodies.castShadow = true;
    this.carBodies.receiveShadow = true;
    this.carBodies.frustumCulled = false;
    this.group.add(this.carBodies);
    this.disposables.push(bodyGeo, bodyMat);

    // Ajovalot ja takavalot omana instanssinaan: ne saavat hehkua korin väristä
    // riippumatta, ja yön hehkusuodin tarttuu niihin.
    const lampGeo = mergeBoxes([
      { w: 0.34, h: 0.13, d: 0.09, x: -0.56, y: 0.80, z: 2.18, c: [1, 0.97, 0.85] },
      { w: 0.34, h: 0.13, d: 0.09, x: 0.56, y: 0.80, z: 2.18, c: [1, 0.97, 0.85] },
      { w: 0.36, h: 0.13, d: 0.09, x: -0.56, y: 0.82, z: -2.18, c: [1, 0.16, 0.12] },
      { w: 0.36, h: 0.13, d: 0.09, x: 0.56, y: 0.82, z: -2.18, c: [1, 0.16, 0.12] }
    ]);
    const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.carLamps = new THREE.InstancedMesh(lampGeo, lampMat, count);
    this.carLamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carLamps.frustumCulled = false;
    this.group.add(this.carLamps);
    this.disposables.push(lampGeo, lampMat);

    // Vilkut: kaksi instanssia autoa kohti (vasen ja oikea). Sammutettu vilkku
    // saa mustan värin, jolloin sitä ei tarvitse siirtää pois näkyvistä.
    const blinkGeo = new THREE.BoxGeometry(0.2, 0.12, 0.1);
    const blinkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.carBlinkers = new THREE.InstancedMesh(blinkGeo, blinkMat, count * 2);
    this.carBlinkers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carBlinkers.frustumCulled = false;
    this.group.add(this.carBlinkers);
    this.disposables.push(blinkGeo, blinkMat);
  }

  buildPedMeshes(count) {
    const skin = [0.72, 0.56, 0.44];
    const bodyGeo = mergeBoxes([
      { w: 0.42, h: 0.62, d: 0.25, x: 0, y: 1.15, z: 0, c: [1, 1, 1] },
      { w: 0.22, h: 0.24, d: 0.22, x: 0, y: 1.58, z: 0, c: skin },
      { w: 0.13, h: 0.54, d: 0.14, x: -0.27, y: 1.15, z: 0, c: skin },
      { w: 0.13, h: 0.54, d: 0.14, x: 0.27, y: 1.15, z: 0, c: skin }
    ]);
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.pedBodies = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
    this.pedBodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pedBodies.castShadow = true;
    this.pedBodies.frustumCulled = false;
    this.group.add(this.pedBodies);
    this.disposables.push(bodyGeo, bodyMat);

    // Jalat erillisinä instansseina, jotta ne voivat heilua. Ilman heilahdusta
    // kävelijä näyttää liukuvan jalustalla.
    const legGeo = new THREE.BoxGeometry(0.16, 0.84, 0.18);
    legGeo.translate(0, -0.42, 0);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.9 });
    this.pedLegs = new THREE.InstancedMesh(legGeo, legMat, count * 2);
    this.pedLegs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pedLegs.frustumCulled = false;
    this.group.add(this.pedLegs);
    this.disposables.push(legGeo, legMat);
  }

  buildSignals() {
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
    const lampMat = new THREE.MeshBasicMaterial();
    this.signals = new THREE.InstancedMesh(lampGeo, lampMat, spots.length * 2);
    this.signals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const d = this.dummy;
    let n = 0;
    this.signalDirs = [];
    for (const [i, j] of spots) {
      const px = c.xs[i], pz = c.zs[j];
      const hv = c.halfV(i), hh = c.halfH(j);
      // Pylvaat risteyksen kulmiin, ei kadun keskelle. Aiemmin vaakasuunnan
      // opastin sai z:ksi risteyksen keskilinjan eli seisoi keskella poikkikatua.
      for (const [sx, sz, horiz] of [[1, 1, true], [-1, -1, false]]) {
        const x = px + sx * (hv + 1.4);
        const z = pz + sz * (hh + 1.4);
        d.position.set(x, 2.6, z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1);
        d.updateMatrix();
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
  }

  // =====================================================================
  // Katuverkko ja kaistat
  // =====================================================================

  /** Vihreä valo: vaakasuunta syklin alkupuolen, pystysuunta lopun. */
  greenFor(i, j, horizontal) {
    const p = ((this.time / LIGHT_CYCLE) + hash2(i, j)) % 1;
    return horizontal ? p < 0.44 : (p >= 0.5 && p < 0.94);
  }

  /** Onko jalankulkijan turvallista ylittää katu tässä risteyksessä. */
  walkSignal(i, j, crossingHorizontalRoad) {
    // Vaakakadun yli kävellään kun vaakasuunnan ajoneuvoilla on punainen.
    return !this.greenFor(i, j, !crossingHorizontalRoad) &&
      !this.greenFor(i, j, crossingHorizontalRoad) === false;
  }

  /** Kaistan keskikohta keskiviivasta. lane 0 = keskiviivan vieressä. */
  laneCenter(axis, k, lane) {
    const c = this.city;
    const w = axis === 'h' ? c.wH[k] : c.wV[k];
    const lanes = c.lanesEachWay(axis, k);
    return (Math.min(lane, lanes - 1) + 0.5) * w / (2 * lanes);
  }

  lanePoint(i, j, dirX, dirZ, backOff, lane) {
    const c = this.city;
    const perpX = dirZ * LANE_SIDE, perpZ = -dirX * LANE_SIDE;
    const axis = dirX !== 0 ? 'h' : 'v';
    const k = dirX !== 0 ? j : i;
    const off = this.laneCenter(axis, k, lane);
    return { x: c.xs[i] - dirX * backOff + perpX * off, z: c.zs[j] - dirZ * backOff + perpZ * off };
  }

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

  // =====================================================================
  // Ajoneuvot
  // =====================================================================

  makeCar(index) {
    const car = {
      kind: 'car',
      slot: index,
      color: CAR_COLORS[index % CAR_COLORS.length],
      speed: 8, stun: 0, wait: 0, ox: 0, oz: 0, yaw: 0, x: 0, z: 0,
      lane: 0, blinker: 0, colorSet: false
    };
    this.placeCarRandomly(car, undefined, undefined, true);
    return car;
  }

  // Sijoitus arpoo solmun ja kaistan, mutta hyväksyy tuloksen vasta kun paikka
  // on vapaa. Ilman tarkistusta kaksi autoa voi syntyä täsmälleen päällekkäin,
  // ja ne jäävät siihen: kumpikaan ei näe toista "edessä".
  placeCarRandomly(car, nearX, nearZ, spread = false) {
    const c = this.city;
    for (let attempt = 0; attempt < 12; attempt++) {
      let i, j;
      if (nearX !== undefined) {
        // Kierrätys: haetaan solmu renkaalta pelaajan ympäriltä, ei aivan vierestä.
        let tries = 0;
        do {
          i = Math.floor(Math.random() * c.xs.length);
          j = Math.floor(Math.random() * c.zs.length);
          tries++;
        } while (tries < 24 && !this.inRing(c.xs[i], c.zs[j], nearX, nearZ));
      } else {
        i = 1 + Math.floor(Math.random() * (c.xs.length - 2));
        j = 1 + Math.floor(Math.random() * (c.zs.length - 2));
      }
      const n = this.neighbours(i, j);
      const [ni, nj] = n[Math.floor(Math.random() * n.length)];
      car.lane = Math.floor(Math.random() * 2);
      this.startEdge(car, i, j, ni, nj);
      if (spread) car.s = Math.random() * car.len;
      car.stun = 0; car.ox = 0; car.oz = 0;
      this.placeCar(car);
      if (this.spotFree(car, 9)) return;
    }
  }

  /** Onko autolle juuri lasketussa paikassa tilaa. */
  spotFree(car, r) {
    let free = true;
    const r2 = r * r;
    for (const o of this.cars) {
      if (o === car) continue;
      if ((o.x - car.x) ** 2 + (o.z - car.z) ** 2 < r2) { free = false; break; }
    }
    return free;
  }

  inRing(x, z, px, pz, radius) {
    const r = radius || this.farRadius;
    const d = Math.hypot(x - px, z - pz);
    return d > r * 0.52 && d < r * 0.94;
  }

  startEdge(car, fi, fj, i, j) {
    const c = this.city;
    const dirX = Math.sign(c.xs[i] - c.xs[fi]);
    const dirZ = Math.sign(c.zs[j] - c.zs[fj]);
    const horizontal = dirX !== 0;
    const axis = horizontal ? 'h' : 'v';
    const k = horizontal ? fj : fi;
    const lanes = c.lanesEachWay(axis, k);
    if (car.lane >= lanes) car.lane = lanes - 1;

    const a = this.lanePoint(fi, fj, dirX, dirZ, -this.crossHalf(fi, fj, horizontal) - 1.5, car.lane);
    const b = this.lanePoint(i, j, dirX, dirZ, this.crossHalf(i, j, horizontal) + 1.5, car.lane);
    car.mode = 'edge';
    car.fi = fi; car.fj = fj; car.i = i; car.j = j;
    car.dirX = dirX; car.dirZ = dirZ;
    car.horizontal = horizontal;
    car.ax = a.x; car.az = a.z;
    car.bx = b.x; car.bz = b.z;
    car.len = Math.hypot(b.x - a.x, b.z - a.z);
    car.s = 0;
    car.limit = c.speedLimit(axis, k);

    // Seuraava käännös päätetään heti, jotta vilkkua ehtii näyttää etukäteen.
    const opts = this.neighbours(i, j).filter(([ni, nj]) => !(ni === fi && nj === fj));
    const pick = opts.length ? opts[Math.floor(Math.random() * opts.length)] : [fi, fj];
    car.nextNode = pick;
    const ndx = Math.sign(c.xs[pick[0]] - c.xs[i]);
    const ndz = Math.sign(c.zs[pick[1]] - c.zs[j]);
    // Ristitulon merkki kertoo kummalle puolelle käännytään.
    const cross = dirX * ndz - dirZ * ndx;
    car.turn = cross === 0 ? 0 : Math.sign(cross) * BLINKER_SIDE;
  }

  startTurn(car) {
    const c = this.city;
    const [ni, nj] = car.nextNode;
    const ndirX = Math.sign(c.xs[ni] - c.xs[car.i]);
    const ndirZ = Math.sign(c.zs[nj] - c.zs[car.j]);
    const nHoriz = ndirX !== 0;
    const exit = this.lanePoint(car.i, car.j, ndirX, ndirZ,
      -this.crossHalf(car.i, car.j, nHoriz) - 1.5, car.lane);
    car.mode = 'turn';
    car.tax = car.bx; car.taz = car.bz;
    car.tbx = exit.x; car.tbz = exit.z;
    car.tcx = c.xs[car.i]; car.tcz = c.zs[car.j];
    car.next = { fi: car.i, fj: car.j, i: ni, j: nj };
    car.s = 0;
    car.len = Math.hypot(car.tbx - car.tax, car.tbz - car.taz) * 1.18;
  }

  updateCar(car, dt, player, detailed) {
    if (car.stun > 0) {
      car.stun -= dt;
      car.ox += car.kx * dt; car.oz += car.kz * dt;
      car.kx *= Math.pow(0.12, dt); car.kz *= Math.pow(0.12, dt);
      car.speed *= Math.pow(0.05, dt);
      this.placeCar(car);
      return;
    }
    car.ox *= Math.pow(0.25, dt);
    car.oz *= Math.pow(0.25, dt);

    let target = car.limit;

    // 1. Edellä ajava. Tämä ajetaan aina, myös kaukana ja risteyskaarteessa:
    //    hilahaku on halpa, ja jos etäisyydenpito jätetään pois, autot menevät
    //    toistensa läpi juuri sillä etäisyydellä jolla se vielä näkyy.
    const gap = this.gapAhead(car);
    // Neliöjuurilaki: nopeus jolla auto ehtii vielä pysähtyä kiihtyvyydellä
    // FOLLOW_DECEL ennen kuin väli loppuu. Lineaarinen profiili näytti samalta
    // mutta vaati kaukana enemmän jarrutusta kuin autolla oli käytettävissä,
    // joten kaukana päivittyvä auto ajoi edellä ajavan läpi.
    target = Math.min(target, Math.sqrt(2 * FOLLOW_DECEL * Math.max(0, gap - FOLLOW_GAP)));

    // 2. Risteys: valo-ohjatussa punainen pysäyttää, ohjaamattomassa väistetään
    //    risteyksessä jo olevaa.
    if (car.mode === 'edge') {
      const toStop = car.len - car.s;
      const controlled = this.city.isMajor('v', car.i) && this.city.isMajor('h', car.j);
      if (controlled) {
        if (!this.greenFor(car.i, car.j, car.horizontal)) {
          target = Math.min(target, Math.sqrt(2 * FOLLOW_DECEL * Math.max(0, toStop - 1.5)));
        }
      } else if (toStop < 14 && car.wait < 2 && this.intersectionBusy(car)) {
        target = Math.min(target, Math.sqrt(2 * FOLLOW_DECEL * Math.max(0, toStop - 3)));
      }
    }

    // 3. Pelaaja edessä samalla kaistalla.
    if (player) {
      const dx = player.x - car.x, dz = player.z - car.z;
      const fwd = dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw);
      const side = Math.abs(dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw));
      if (fwd > 0 && fwd < 22 && side < 3.4) target = Math.min(target, Math.max(0, fwd * 0.4 - 2));
    }

    const accel = target > car.speed ? 3.2 : FOLLOW_DECEL * 1.6;
    car.speed += Math.max(-accel * dt, Math.min(accel * dt, target - car.speed));
    if (car.speed < 0) car.speed = 0;
    // Odotusaika: väistösäännöt voivat periaatteessa lukkiutua kehäksi
    // (A väistää B:tä, B C:tä, C A:ta). Kello purkaa lukon.
    car.wait = car.speed < 0.3 ? car.wait + dt : 0;
    // Kova takaraja: matkaa ei koskaan oteta enempää kuin väliä on jäljellä.
    // Tämä ei ole hienovarainen, mutta se takaa ettei auto mene toisen läpi
    // silloinkaan kun kaukana päivittyvän auton aika-askel on nelinkertainen.
    car.s += Math.min(car.speed * dt, Math.max(0, gap - FOLLOW_GAP * 0.5));

    // Vilkku päälle 28 metriä ennen risteystä.
    car.blinker = (car.mode === 'edge' && car.turn !== 0 && car.len - car.s < 28) ? car.turn : 0;

    if (car.s >= car.len) {
      if (car.mode === 'edge') {
        // Punaiseen ei ajeta sisään edes pyöristysvirheellä: risteykseen
        // siirrytään vasta kun valo on vihreä ja ulostulokaista vapaa.
        const controlled = this.city.isMajor('v', car.i) && this.city.isMajor('h', car.j);
        if (controlled && !this.greenFor(car.i, car.j, car.horizontal)) {
          car.s = car.len; car.speed = 0; this.placeCar(car); return;
        }
        // Käännöstä ei aloiteta ennen kuin ulostulokaista on vapaa. Ilman tätä
        // leveältä bulevardilta kapealle kadulle kääntyvä auto pakotetaan
        // kaistalle 0 ja voi ilmestyä siellä jo ajavan päälle.
        // Odotusaikaa kasvatetaan tässä eikä ylempänä: pysäytetty auto ehtii
        // kiihdyttää yli 0,3 m/s joka ruudulla, jolloin ylempi nollaus söisi
        // koko kellon eikä lukonpurku laukeaisi koskaan.
        if (car.wait > 2.5 || this.exitClear(car)) { this.startTurn(car); car.wait = 0; }
        else { car.s = car.len; car.speed = 0; car.wait += dt; }
      } else {
        this.startEdge(car, car.next.fi, car.next.fj, car.next.i, car.next.j);
      }
    }
    this.placeCar(car);
  }

  /** Etäisyys edellä samalla kaistalla ajavan takapuskuriin. */
  gapAhead(car) {
    let best = 999;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    this.carHash.forEachNear(car.x, car.z, (o) => {
      if (o === car) return;
      const dx = o.x - car.x, dz = o.z - car.z;
      const fwd = dx * fx + dz * fz;
      if (fwd <= 0) return;
      const side = Math.abs(dx * fz - dz * fx);
      if (side > 1.6) return;
      const gap = fwd - CAR_LEN;
      if (gap < best) best = gap;
    });
    return best;
  }

  /** Onko sen kaistan alkupää vapaa, jolle auto on kääntymässä. */
  exitClear(car) {
    const c = this.city;
    const [ni, nj] = car.nextNode;
    const ndirX = Math.sign(c.xs[ni] - c.xs[car.i]);
    const ndirZ = Math.sign(c.zs[nj] - c.zs[car.j]);
    const nHoriz = ndirX !== 0;
    const lanes = c.lanesEachWay(nHoriz ? 'h' : 'v', nHoriz ? car.j : car.i);
    const lane = Math.min(car.lane, lanes - 1);
    const p = this.lanePoint(car.i, car.j, ndirX, ndirZ,
      -this.crossHalf(car.i, car.j, nHoriz) - 1.5, lane);
    let clear = true;
    this.carHash.forEachNear(p.x, p.z, (o) => {
      if (o === car || !clear) return;
      // Liikkeessä oleva ei estä: hän on poissa siihen mennessä kun kaarre on
      // ajettu. Vain paikallaan tai hitaasti matelava tukkii ulostulon.
      if (o.speed > 5) return;
      if ((o.x - p.x) ** 2 + (o.z - p.z) ** 2 < 30) clear = false;
    });
    return clear;
  }

  /** Onko risteyslaatikossa jo joku toinen auto. */
  intersectionBusy(car) {
    const cx = this.city.xs[car.i], cz = this.city.zs[car.j];
    const r = Math.max(this.city.halfV(car.i), this.city.halfH(car.j)) + 1;
    let busy = false;
    this.carHash.forEachNear(cx, cz, (o) => {
      if (o === car || busy) return;
      if (Math.abs(o.x - cx) < r && Math.abs(o.z - cz) < r) busy = true;
    });
    return busy;
  }

  placeCar(car) {
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

  // =====================================================================
  // Jalankulkijat
  // =====================================================================

  /**
   * Jalkakäytäväreitit: jokaisen korttelin ympäri kulkeva silmukka. Piste-
   * jonoina, joten kävelijän ei tarvitse tehdä reitinhakua - se seuraa
   * silmukkaa ja päättää nurkassa jatkaako vai ylittääkö kadun.
   */
  buildSidewalkLoops() {
    const inset = 1.7;
    this.loops = [];
    for (const b of this.city.blocks) {
      const x0 = b.x0 + inset, x1 = b.x1 - inset;
      const z0 = b.z0 + inset, z1 = b.z1 - inset;
      if (x1 - x0 < 6 || z1 - z0 < 6) continue;
      this.loops.push({
        pts: [
          { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }
        ],
        cx: b.cx, cz: b.cz
      });
    }
  }

  makePed(index) {
    const ped = {
      kind: 'ped',
      slot: index,
      shirt: SHIRT_COLORS[index % SHIRT_COLORS.length],
      x: 0, z: 0, yaw: 0, speed: 1.25 + Math.random() * 0.5,
      phase: Math.random() * 6.28,
      state: 'walk', flee: 0, vx: 0, vz: 0, colorSet: false
    };
    this.placePedRandomly(ped);
    return ped;
  }

  placePedRandomly(ped, nearX, nearZ) {
    if (!this.loops.length) return;
    let loop, tries = 0;
    do {
      loop = this.loops[Math.floor(Math.random() * this.loops.length)];
      tries++;
    } while (tries < 40 && nearX !== undefined &&
             !this.inRing(loop.cx, loop.cz, nearX, nearZ, this.pedFarRadius));
    ped.loop = loop;
    ped.seg = Math.floor(Math.random() * 4);
    ped.t = Math.random();
    ped.dir = Math.random() < 0.5 ? 1 : -1;
    ped.state = 'walk';
    ped.flee = 0;
    this.placePedOnLoop(ped);
  }

  placePedOnLoop(ped) {
    const pts = ped.loop.pts;
    const a = pts[ped.seg], b = pts[(ped.seg + 1) % 4];
    ped.x = a.x + (b.x - a.x) * ped.t;
    ped.z = a.z + (b.z - a.z) * ped.t;
    const dx = (b.x - a.x) * ped.dir, dz = (b.z - a.z) * ped.dir;
    const l = Math.hypot(dx, dz) || 1;
    ped.yaw = Math.atan2(dx / l, dz / l);
  }

  updatePed(ped, dt, player, detailed) {
    // Pakotila: auto tulee päälle. Juokse poispäin auton kulkusuunnasta ja
    // palaa sitten jalkakäytävälle.
    if (player) {
      const dx = ped.x - player.x, dz = ped.z - player.z;
      const d = Math.hypot(dx, dz);
      const speed = Math.hypot(player.vx, player.vz);
      if (d < 11 && speed > 4) {
        const fwd = (dx * player.vx + dz * player.vz) / (speed || 1);
        if (fwd > -2) {
          ped.state = 'flee';
          ped.flee = 1.4;
          // Väistö kohtisuoraan auton kulkusuuntaa vastaan on lyhin tie pois.
          const px = -player.vz / speed, pz = player.vx / speed;
          const s = (dx * px + dz * pz) >= 0 ? 1 : -1;
          ped.vx = px * s * 4.2;
          ped.vz = pz * s * 4.2;
        }
      }
    }

    if (ped.state === 'flee') {
      ped.flee -= dt;
      ped.x += ped.vx * dt;
      ped.z += ped.vz * dt;
      ped.vx *= Math.pow(0.35, dt);
      ped.vz *= Math.pow(0.35, dt);
      const l = Math.hypot(ped.vx, ped.vz) || 1;
      ped.yaw = Math.atan2(ped.vx / l, ped.vz / l);
      ped.phase += dt * 14;
      if (ped.flee <= 0) {
        // Takaisin lähimpään silmukan pisteeseen.
        ped.state = 'walk';
        this.snapPedToLoop(ped);
      }
      return;
    }

    // Erottelu muista kävelijöistä: pieni sivuttaissiirto riittää estämään
    // päällekkäisyyden ilman varsinaista törmäysratkaisua.
    let push = 0;
    if (detailed) {
      this.pedHash.forEachNear(ped.x, ped.z, (o) => {
        if (o === ped) return;
        const dx = o.x - ped.x, dz = o.z - ped.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > (PED_RADIUS * 3) ** 2 || d2 < 1e-5) return;
        const fwd = dx * Math.sin(ped.yaw) + dz * Math.cos(ped.yaw);
        if (fwd <= 0) return;
        push += (dx * Math.cos(ped.yaw) - dz * Math.sin(ped.yaw)) > 0 ? -0.6 : 0.6;
      });
    }

    const pts = ped.loop.pts;
    const a = pts[ped.seg], b = pts[(ped.seg + 1) % 4];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    ped.t += (ped.speed * ped.dir * dt) / segLen;
    ped.phase += dt * ped.speed * 5.5;

    if (ped.t > 1) { ped.t -= 1; ped.seg = (ped.seg + 1) % 4; }
    else if (ped.t < 0) { ped.t += 1; ped.seg = (ped.seg + 3) % 4; }

    this.placePedOnLoop(ped);
    if (push) {
      ped.x += Math.cos(ped.yaw) * push * dt;
      ped.z -= Math.sin(ped.yaw) * push * dt;
    }
  }

  snapPedToLoop(ped) {
    let best = null, bd = Infinity;
    for (const loop of this.loops) {
      const d = Math.hypot(loop.cx - ped.x, loop.cz - ped.z);
      if (d < bd) { bd = d; best = loop; }
    }
    if (!best) return;
    ped.loop = best;
    // Lähin sivu ja sitä pitkin lähin kohta.
    let bs = 0, bt = 0, bdist = Infinity;
    for (let s = 0; s < 4; s++) {
      const a = best.pts[s], b = best.pts[(s + 1) % 4];
      const abx = b.x - a.x, abz = b.z - a.z;
      const l2 = abx * abx + abz * abz || 1;
      let t = ((ped.x - a.x) * abx + (ped.z - a.z) * abz) / l2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ped.x - (a.x + abx * t), ped.z - (a.z + abz * t));
      if (d < bdist) { bdist = d; bs = s; bt = t; }
    }
    ped.seg = bs; ped.t = bt;
    this.placePedOnLoop(ped);
  }

  // =====================================================================
  // Pääsilmukka
  // =====================================================================

  update(dt, player) {
    this.time += dt;
    this.tick++;

    const px = player ? player.x : 0;
    const pz = player ? player.z : 0;

    // Hilat rakennetaan kerran per tikki; kaikki naapurihaut lukevat samaa.
    this.carHash.clear();
    for (const c of this.cars) this.carHash.insert(c);
    this.pedHash.clear();
    for (const p of this.peds) this.pedHash.insert(p);

    const far2 = this.farRadius * this.farRadius;
    const pedFar2 = this.pedFarRadius * this.pedFarRadius;
    const detail2 = this.detailRadius * this.detailRadius;

    for (const car of this.cars) {
      const d2 = (car.x - px) ** 2 + (car.z - pz) ** 2;
      if (player && d2 > far2) { this.placeCarRandomly(car, px, pz); continue; }
      const detailed = d2 < detail2;
      // Kaukana oleva päivitetään joka neljäs tikki nelinkertaisella askeleella:
      // liike pysyy oikeana, mutta laskentaa kuluu neljäsosa.
      if (!detailed && (this.tick & 3) !== (car.slot & 3)) continue;
      this.updateCar(car, detailed ? dt : dt * 4, player, detailed);
    }

    for (const ped of this.peds) {
      const d2 = (ped.x - px) ** 2 + (ped.z - pz) ** 2;
      if (player && d2 > pedFar2) { this.placePedRandomly(ped, px, pz); continue; }
      const detailed = d2 < detail2;
      if (!detailed && (this.tick & 3) !== (ped.slot & 3)) continue;
      this.updatePed(ped, detailed ? dt : dt * 4, player, detailed);
    }

    this.flush();
    this.updateSignals();
  }

  flush() {
    const d = this.dummy;
    const blinkOn = (this.time * 2.6) % 1 < 0.5;

    for (let k = 0; k < this.cars.length; k++) {
      const car = this.cars[k];
      d.position.set(car.x, 0, car.z);
      d.rotation.set(0, car.yaw, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.carBodies.setMatrixAt(k, d.matrix);
      this.carLamps.setMatrixAt(k, d.matrix);
      if (!car.colorSet) {
        this.tmpColor.setRGB(car.color[0], car.color[1], car.color[2]);
        this.carBodies.setColorAt(k, this.tmpColor);
        car.colorSet = true;
      }
      // Vilkut: kaksi instanssia, kummallakin oma paikka korin nurkassa.
      const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
      for (let s = 0; s < 2; s++) {
        const sx = s === 0 ? -0.86 : 0.86;
        d.position.set(car.x + sx * cy + 1.9 * sy, 0.8, car.z - sx * sy + 1.9 * cy);
        d.rotation.set(0, car.yaw, 0);
        d.updateMatrix();
        const idx = k * 2 + s;
        this.carBlinkers.setMatrixAt(idx, d.matrix);
        const lit = blinkOn && car.blinker !== 0 && (car.blinker > 0 ? s === 1 : s === 0);
        this.tmpColor.setRGB(lit ? 1 : 0.02, lit ? 0.55 : 0.02, lit ? 0.05 : 0.02);
        this.carBlinkers.setColorAt(idx, this.tmpColor);
      }
    }
    this.carBodies.instanceMatrix.needsUpdate = true;
    this.carLamps.instanceMatrix.needsUpdate = true;
    this.carBlinkers.instanceMatrix.needsUpdate = true;
    if (this.carBodies.instanceColor) this.carBodies.instanceColor.needsUpdate = true;
    if (this.carBlinkers.instanceColor) this.carBlinkers.instanceColor.needsUpdate = true;

    for (let k = 0; k < this.peds.length; k++) {
      const p = this.peds[k];
      const bob = Math.sin(p.phase * 2) * 0.035;
      d.position.set(p.x, bob, p.z);
      d.rotation.set(0, p.yaw, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.pedBodies.setMatrixAt(k, d.matrix);
      if (!p.colorSet) {
        this.tmpColor.setRGB(p.shirt[0], p.shirt[1], p.shirt[2]);
        this.pedBodies.setColorAt(k, this.tmpColor);
        p.colorSet = true;
      }
      // Jalat heiluvat vastakkaisissa vaiheissa lonkan ympäri.
      for (let s = 0; s < 2; s++) {
        const swing = Math.sin(p.phase + (s ? Math.PI : 0)) * 0.42;
        d.position.set(p.x - Math.cos(p.yaw) * (s ? -0.11 : 0.11),
          0.86 + bob, p.z + Math.sin(p.yaw) * (s ? -0.11 : 0.11));
        d.rotation.set(swing, p.yaw, 0);
        d.updateMatrix();
        this.pedLegs.setMatrixAt(k * 2 + s, d.matrix);
      }
    }
    this.pedBodies.instanceMatrix.needsUpdate = true;
    this.pedLegs.instanceMatrix.needsUpdate = true;
    if (this.pedBodies.instanceColor) this.pedBodies.instanceColor.needsUpdate = true;
  }

  updateSignals() {
    if (!this.signals) return;
    const c = this.tmpColor;
    for (let k = 0; k < this.signalDirs.length; k++) {
      const s = this.signalDirs[k];
      if (this.greenFor(s.i, s.j, s.horizontal)) c.setRGB(0.15, 0.95, 0.35);
      else c.setRGB(0.95, 0.12, 0.12);
      this.signals.setColorAt(k, c);
    }
    if (this.signals.instanceColor) this.signals.instanceColor.needsUpdate = true;
  }

  // =====================================================================
  // Vuorovaikutus pelaajan kanssa
  // =====================================================================

  /** Törmäykset pelaajaan. Palauttaa kovimman osuman voimakkuuden. */
  collide(vehicle) {
    const rCar = vehicle.spec.body.width * 0.46 + 1.5;
    let worst = 0;
    this.carHash.forEachNear(vehicle.x, vehicle.z, (car) => {
      const dx = vehicle.x - car.x, dz = vehicle.z - car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > rCar * rCar) return;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d, nz = dz / d;
      const impact = vehicle.applyImpact(nx, nz, rCar - d, 0.2);
      car.stun = 2.4 + Math.random();
      car.kx = -nx * (3 + impact * 0.8);
      car.kz = -nz * (3 + impact * 0.8);
      if (impact > worst) worst = impact;
    });
    // Jalankulkijat eivät pysäytä autoa; he väistävät ja säikähtävät.
    this.pedHash.forEachNear(vehicle.x, vehicle.z, (ped) => {
      const dx = ped.x - vehicle.x, dz = ped.z - vehicle.z;
      if (dx * dx + dz * dz > 9) return;
      ped.state = 'flee';
      ped.flee = 1.6;
      const l = Math.hypot(dx, dz) || 1;
      ped.vx = (dx / l) * 6;
      ped.vz = (dz / l) * 6;
    });
    return worst;
  }

  /** Lähin siviiliauto - läheltä piti -bonus mitataan tästä. */
  nearestDistance(x, z) {
    let best = 99;
    this.carHash.forEachNear(x, z, (car) => {
      const d = Math.hypot(car.x - x, car.z - z);
      if (d < best) best = d;
    });
    return best;
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.group.clear();
  }
}
