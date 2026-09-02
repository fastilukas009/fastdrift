// Avoin kaupunki: ruutukaava-katuverkko, korttelit rakennuksineen ja siviililiikenne.
//
// Kadut ovat akselien suuntaisia, joten ajopinnan voi laskea analyyttisesti sen sijaan
// että se rasteroitaisiin ruudukkoon kuten kilparadoilla. Se on sekä tarkempi että
// nopeampi, ja kaupunki voi olla kilometrin levyinen ilman muistiongelmia.

import * as THREE from '../vendor/three.module.min.js';
import { WallSet } from './walls.js';
import { LATrafficAndPedestrianManager } from './latraffic.js';
import { Districts } from './districts.js';
import { asphaltTexture, concreteTexture, groundTexture, buildingTexture, toTexture } from './textures.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const BOULEVARD = 21;
const STREET = 13.5;
const SIDEWALK = 3.4;

// Ajoradan pinta kaistaviivoineen. Kuvan leveys vastaa kadun leveyttä, ja se
// toistetaan pituussuunnassa - näin katkoviiva pysyy oikean mittaisena.
function roadTexture(lanesEachWay, seed) {
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const rand = rng(seed);

  ctx.fillStyle = '#31343a';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 2200; i++) {
    const l = 0.55 + rand() * 0.5;
    ctx.fillStyle = `rgba(${Math.floor(118 * l)},${Math.floor(122 * l)},${Math.floor(130 * l)},${0.08 + rand() * 0.16})`;
    ctx.beginPath();
    ctx.arc(rand() * W, rand() * H, 1 + rand() * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  const lanes = lanesEachWay * 2;
  const laneW = W / lanes;

  // Keskiviiva kaksoiskeltaisena: vastaantuleva liikenne erottuu heti.
  ctx.strokeStyle = '#d8b13a';
  ctx.lineWidth = 3;
  for (const off of [-3.5, 3.5]) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + off, 0);
    ctx.lineTo(W / 2 + off, H);
    ctx.stroke();
  }

  // Kaistanjakajat valkoisella katkoviivalla.
  ctx.strokeStyle = 'rgba(235,235,235,0.85)';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([46, 40]);
  for (let k = 1; k < lanes; k++) {
    if (k === lanesEachWay) continue;
    ctx.beginPath();
    ctx.moveTo(k * laneW, 0);
    ctx.lineTo(k * laneW, H);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Reunaviivat.
  ctx.strokeStyle = 'rgba(225,225,225,0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(3, 0); ctx.lineTo(3, H);
  ctx.moveTo(W - 3, 0); ctx.lineTo(W - 3, H);
  ctx.stroke();

  return c;
}

export class City {
  constructor(def) {
    this.def = def;
    this.group = new THREE.Group();
    this.walls = new WallSet(14);
    this.clips = [];
    this.cones = [];
    this.disposables = [];
    this.halfWidth = BOULEVARD / 2;
    this.rand = rng(20260901);
    this.layout();
    this.build();
    this.traffic = new LATrafficAndPedestrianManager(this, { cars: def.traffic || 52, pedestrians: def.pedestrians || 90 });
    this.group.add(this.traffic.group);
    this.length = 0;
  }

  // -- kaava ---------------------------------------------------------------

  layout() {
    const rand = this.rand;
    const half = 470;
    this.xs = []; this.wV = []; this.majorV = [];
    this.zs = []; this.wH = []; this.majorH = [];
    let x = -half, n = 0;
    while (x < half) {
      const major = n % 3 === 0;
      this.xs.push(Math.round(x));
      this.wV.push(major ? BOULEVARD : STREET);
      this.majorV.push(major);
      x += 96 + rand() * 74;
      n++;
    }
    let z = -half; n = 0;
    while (z < half) {
      const major = n % 3 === 0;
      this.zs.push(Math.round(z));
      this.wH.push(major ? BOULEVARD : STREET);
      this.majorH.push(major);
      z += 96 + rand() * 74;
      n++;
    }
    this.minX = this.xs[0]; this.maxX = this.xs[this.xs.length - 1];
    this.minZ = this.zs[0]; this.maxZ = this.zs[this.zs.length - 1];
  }

  halfV(i) { return this.wV[i] / 2; }
  halfH(j) { return this.wH[j] / 2; }
  isMajor(axis, k) { return axis === 'v' ? this.majorV[k] : this.majorH[k]; }
  lanesEachWay(axis, k) { return this.isMajor(axis, k) ? 2 : 1; }

  // Kaistan keskikohta keskiviivasta mitattuna.
  laneOffset(axis, k) {
    const w = axis === 'h' ? this.wH[k] : this.wV[k];
    const lanes = this.lanesEachWay(axis, k);
    // Uloimmalla kaistalla ajetaan; sisempi jää ohituksille.
    return w / (4 * lanes) * (lanes === 2 ? 3 : 1);
  }

  speedLimit(axis, k) { return this.isMajor(axis, k) ? 15.5 : 11; }

  nearestIndex(arr, v) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const d = Math.abs(arr[i] - v);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // -- pinta ---------------------------------------------------------------

  sample(x, z) {
    // Lentokentta ja moottoritie eivat ole ruutukaavan katuja, joten ne
    // vastaavat ensin. Laattojen ulkopuolella tulos on null ja jatketaan katuun.
    if (this.districts) {
      const d = this.districts.sample(x, z);
      if (d && d.onRoad) return d;
      var slab = d;
    }
    const i = this.nearestIndex(this.xs, x);
    const j = this.nearestIndex(this.zs, z);
    const dx = Math.abs(x - this.xs[i]) - this.halfV(i);
    const dz = Math.abs(z - this.zs[j]) - this.halfH(j);
    const dEdge = Math.min(dx, dz);
    const onRoad = dEdge <= 0;
    let grip;
    if (onRoad) grip = this.def.roadGrip;
    else if (dEdge < SIDEWALK) {
      // Jalkakäytävä: betonia, selvästi liukkaampi kuin asfaltti.
      grip = this.def.roadGrip * 0.72;
    } else grip = this.def.offGrip;
    const out = {
      grip, onRoad, height: 0,
      dist: Math.max(0, dEdge + this.halfWidth),
      slopeX: 0, slopeZ: 0, prog: 0
    };
    // Laatan piennar voi olla lahempana kuin kadun: otetaan pienempi etaisyys,
    // jotta kiitoradan vieressa ei kayntyisi "palaa radalle" -kello.
    return (slab && slab.dist < out.dist) ? slab : out;
  }

  // Etäisyys lähimpään seinään; pisteytys palkitsee läheltä ajamisesta.
  wallDistance(x, z) { return this.walls.distanceTo(x, z, 10); }

  outOfBounds(x, z) {
    const m = 90;
    let minX = this.minX, maxX = this.maxX, minZ = this.minZ, maxZ = this.maxZ;
    if (this.districts) {
      const b = this.districts.bounds;
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
      minZ = Math.min(minZ, b.minZ); maxZ = Math.max(maxZ, b.maxZ);
    }
    return x < minX - m || x > maxX + m || z < minZ - m || z > maxZ + m;
  }

  clipProximity() { return null; }

  spawnPoint() {
    const i = this.nearestIndex(this.xs, 0);
    const j = this.nearestIndex(this.zs, 0);
    // Lähtö boulevardilla omalla kaistalla, samaan suuntaan kuin muu liikenne.
    return { x: this.xs[i] - this.laneOffset('v', i), z: this.zs[j] - 34, yaw: 0 };
  }

  respawnNear(x, z) {
    // Lentokentalla tai moottoritiella palautetaan sinne, ei kaupunkiin asti.
    if (this.districts) {
      const d = this.districts.respawn(x, z);
      if (d) return d;
    }
    const i = this.nearestIndex(this.xs, x);
    const j = this.nearestIndex(this.zs, z);
    const dx = Math.abs(x - this.xs[i]) - this.halfV(i);
    const dz = Math.abs(z - this.zs[j]) - this.halfH(j);
    // Palautus lähimmälle kadulle sen suuntaisena.
    if (dx < dz) return { x: this.xs[i] - this.laneOffset('v', i), z, yaw: 0 };
    return { x, z: this.zs[j] + this.laneOffset('h', j), yaw: Math.PI / 2 };
  }

  // -- geometria -----------------------------------------------------------

  build() {
    this.buildGround();
    this.buildRoads();
    this.buildBlocks();
    this.buildBuildings();
    // Alueet ennen rekvisiittaa: buildProps kysyy onRoadway(), ja sen pitaa
    // tietaa myos kiitoradasta ettei asematasolle kylveta palmuja.
    this.districts = new Districts(this);
    this.group.add(this.districts.group);
    this.buildProps();
    this.walls.index();
  }

  buildGround() {
    // Pohja on kuivaa maata, ei betonia. Kaupungin sisalla se jaa kokonaan
    // kortteleiden ja katujen alle; nakyviin se tulee vasta lentokentan ja
    // moottoritien ymparilla, ja siella harmaa betonilaatoitus nayttaisi
    // silta kuin koko LA olisi rakennettu parkkihallin katolle.
    const tex = toTexture(groundTexture('dirt'), 260);
    const geo = new THREE.PlaneGeometry(2600, 2600);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = -0.04;
    m.receiveShadow = true;
    this.group.add(m);
    this.disposables.push(geo, mat, tex);
  }

  // Kaikki saman levyiset kadut yhtenä meshinä, jotta piirtokutsuja on muutama
  // eikä sata. Vaaka- ja pystykadut eri korkeuksilla, ja risteykset niiden päällä,
  // jolloin ristiin meneviä kaistaviivoja ei jää näkyviin.
  buildRoads() {
    const mk = (lanes, seed, y, segs) => {
      const tex = toTexture(roadTexture(lanes, seed), 1);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      const pos = [], uv = [], idx = [];
      let v = 0;
      for (const s of segs) {
        const { x0, z0, x1, z1, rep } = s;
        pos.push(x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
        uv.push(0, 0, 1, 0, 0, rep, 1, rep);
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
        v += 4;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, metalness: 0.02 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(geo, mat, tex);
    };

    const z0 = this.minZ - 60, z1 = this.maxZ + 60;
    const x0 = this.minX - 60, x1 = this.maxX + 60;

    for (const [major, lanes] of [[true, 2], [false, 1]]) {
      const vSegs = [], hSegs = [];
      for (let i = 0; i < this.xs.length; i++) {
        if (this.majorV[i] !== major) continue;
        const h = this.halfV(i);
        vSegs.push({ x0: this.xs[i] - h, x1: this.xs[i] + h, z0, z1, rep: (z1 - z0) / 16 });
      }
      for (let j = 0; j < this.zs.length; j++) {
        if (this.majorH[j] !== major) continue;
        const h = this.halfH(j);
        hSegs.push({ x0, x1, z0: this.zs[j] - h, z1: this.zs[j] + h, rep: (x1 - x0) / 16 });
      }
      // Vaakakadut käännetään pystyn asennosta: sama tekstuuri, eri UV-akseli.
      if (vSegs.length) mk(lanes, major ? 3 : 8, 0.012, vSegs);
      if (hSegs.length) {
        const tex = toTexture(roadTexture(lanes, major ? 4 : 9), 1);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        const pos = [], uv = [], idx = [];
        let v = 0;
        for (const s of hSegs) {
          pos.push(s.x0, 0.01, s.z0, s.x1, 0.01, s.z0, s.x0, 0.01, s.z1, s.x1, 0.01, s.z1);
          uv.push(0, 0, s.rep, 0, 0, 1, s.rep, 1);
          idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
          v += 4;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, metalness: 0.02 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.disposables.push(geo, mat, tex);
      }
    }

    // Risteyslaatat peittävät ristiin menevät viivat, ja suojatiet piirretään päälle.
    const interTex = toTexture(asphaltTexture('#33363c', 12), 3);
    const interMat = new THREE.MeshStandardMaterial({ map: interTex, roughness: 0.93 });
    const pos = [], uv = [], idx = [];
    let v = 0;
    for (let i = 0; i < this.xs.length; i++) {
      for (let j = 0; j < this.zs.length; j++) {
        const hv = this.halfV(i), hh = this.halfH(j);
        const ax = this.xs[i] - hv, bx = this.xs[i] + hv;
        const az = this.zs[j] - hh, bz = this.zs[j] + hh;
        pos.push(ax, 0.016, az, bx, 0.016, az, ax, 0.016, bz, bx, 0.016, bz);
        uv.push(0, 0, 1, 0, 0, 1, 1, 1);
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
        v += 4;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, interMat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(geo, interMat, interTex);

    this.buildCrosswalks();
  }

  buildCrosswalks() {
    const pos = [], idx = [];
    let v = 0;
    const stripe = (cx, cz, w, d, horiz) => {
      const n = Math.max(3, Math.floor(w / 1.5));
      for (let k = 0; k < n; k++) {
        if (k % 2) continue;
        const t = (k + 0.5) / n - 0.5;
        const sx = horiz ? cx + t * w : cx;
        const sz = horiz ? cz : cz + t * w;
        const hw = horiz ? 0.42 : d / 2;
        const hd = horiz ? d / 2 : 0.42;
        pos.push(sx - hw, 0.02, sz - hd, sx + hw, 0.02, sz - hd,
          sx - hw, 0.02, sz + hd, sx + hw, 0.02, sz + hd);
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
        v += 4;
      }
    };
    for (let i = 0; i < this.xs.length; i++) {
      for (let j = 0; j < this.zs.length; j++) {
        if (!(this.majorV[i] && this.majorH[j])) continue;
        const hv = this.halfV(i), hh = this.halfH(j);
        stripe(this.xs[i], this.zs[j] - hh - 1.6, hv * 2, 2.4, true);
        stripe(this.xs[i], this.zs[j] + hh + 1.6, hv * 2, 2.4, true);
        stripe(this.xs[i] - hv - 1.6, this.zs[j], hh * 2, 2.4, false);
        stripe(this.xs[i] + hv + 1.6, this.zs[j], hh * 2, 2.4, false);
      }
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: 0xdfe2e6 });
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    this.disposables.push(geo, mat);
  }

  // Korttelit: jalkakäytävälaatta ja sen sisään rakennuslinja, joka toimii seinänä.
  blockRect(i, j) {
    const x0 = this.xs[i] + this.halfV(i);
    const x1 = this.xs[i + 1] - this.halfV(i + 1);
    const z0 = this.zs[j] + this.halfH(j);
    const z1 = this.zs[j + 1] - this.halfH(j + 1);
    return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, h: z1 - z0 };
  }

  buildBlocks() {
    const tex = toTexture(concreteTexture(3, '#9a9da3'), 1);
    const pos = [], uv = [], idx = [];
    let v = 0;
    this.blocks = [];
    for (let i = 0; i < this.xs.length - 1; i++) {
      for (let j = 0; j < this.zs.length - 1; j++) {
        const b = this.blockRect(i, j);
        if (b.w < 8 || b.h < 8) continue;
        this.blocks.push(b);
        pos.push(b.x0, 0.06, b.z0, b.x1, 0.06, b.z0, b.x0, 0.06, b.z1, b.x1, 0.06, b.z1);
        const r = b.w / 12, q = b.h / 12;
        uv.push(0, 0, r, 0, 0, q, r, q);
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
        v += 4;
        // Rakennuslinja jalkakäytävän sisäreunassa on törmäysseinä.
        this.walls.addRect(b.cx, b.cz, Math.max(4, b.w - SIDEWALK * 2), Math.max(4, b.h - SIDEWALK * 2), false, 0.06);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.94 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(geo, mat, tex);
  }

  buildBuildings() {
    const rand = this.rand;
    const facades = [
      toTexture(buildingTexture(11, false), 1),
      toTexture(buildingTexture(27, false), 1),
      toTexture(buildingTexture(43, false), 1)
    ];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const meshes = facades.map((t) => {
      const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.82, metalness: 0.08 });
      const im = new THREE.InstancedMesh(geo, mat, 240);
      im.castShadow = true;
      im.receiveShadow = true;
      im.count = 0;
      this.disposables.push(mat, t);
      return im;
    });
    const d = new THREE.Object3D();

    for (const b of this.blocks) {
      const iw = Math.max(4, b.w - SIDEWALK * 2);
      const ih = Math.max(4, b.h - SIDEWALK * 2);
      // Keskustassa tornit, laidoilla matalaa. Sama vaimennus kuin oikeassa
      // kaupungissa: korkeus laskee etäisyyden mukaan keskustasta.
      const dist = Math.hypot(b.cx, b.cz);
      const core = Math.max(0, 1 - dist / 300);
      const count = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < count; k++) {
        const w = iw * (count === 1 ? 1 : 0.42 + rand() * 0.3);
        const dp = ih * (count === 1 ? 1 : 0.42 + rand() * 0.3);
        const hgt = 7 + rand() * 12 + core * core * (30 + rand() * 80);
        const x = b.cx + (count === 1 ? 0 : (rand() - 0.5) * (iw - w));
        const z = b.cz + (count === 1 ? 0 : (rand() - 0.5) * (ih - dp));
        const mi = Math.floor(rand() * meshes.length);
        const im = meshes[mi];
        if (im.count >= 240) continue;
        d.position.set(x, hgt / 2 + 0.06, z);
        d.scale.set(w, hgt, dp);
        d.rotation.set(0, 0, 0);
        d.updateMatrix();
        im.setMatrixAt(im.count, d.matrix);
        im.count++;
      }
    }
    for (const im of meshes) { im.instanceMatrix.needsUpdate = true; this.group.add(im); }
    this.disposables.push(geo);
  }

  /**
   * Onko piste ajoradalla (kaikki kadut, ei jalkakaytava). Rekvisiitan sijoitus
   * kysyy tata: ilman sita bulevardin varteen kylvetty palmurivi jatkoi suoraan
   * jokaisen poikkikadun yli ja puita jai keskelle ajorataa.
   */
  onRoadway(x, z, margin = 0) {
    if (this.districts && this.districts.onSlab(x, z, margin)) return true;
    for (let i = 0; i < this.xs.length; i++) {
      if (Math.abs(x - this.xs[i]) < this.halfV(i) + margin) return true;
    }
    for (let j = 0; j < this.zs.length; j++) {
      if (Math.abs(z - this.zs[j]) < this.halfH(j) + margin) return true;
    }
    return false;
  }

  buildProps() {
    const rand = this.rand;
    // Palmut boulevardien varsille - ilman niitä tämä ei ole Los Angeles.
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.30, 9.5, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6d5a44, roughness: 0.95 });
    const frondGeo = new THREE.ConeGeometry(0.42, 3.6, 5, 1, true);
    const frondMat = new THREE.MeshStandardMaterial({
      color: 0x3f6b34, roughness: 0.9, side: THREE.DoubleSide
    });
    const spots = [];
    for (let i = 0; i < this.xs.length; i++) {
      if (!this.majorV[i]) continue;
      for (let z = this.minZ; z < this.maxZ; z += 26) {
        for (const s of [-1, 1]) spots.push([this.xs[i] + s * (this.halfV(i) + 2.0), z + rand() * 8]);
      }
    }
    for (let j = 0; j < this.zs.length; j++) {
      if (!this.majorH[j]) continue;
      for (let x = this.minX; x < this.maxX; x += 26) {
        for (const s of [-1, 1]) spots.push([x + rand() * 8, this.zs[j] + s * (this.halfH(j) + 2.0)]);
      }
    }
    // Vain jalkakaytavalle jaavat paikat kelpaavat.
    const clear = spots.filter(([x, z]) => !this.onRoadway(x, z, 1.2));
    spots.length = 0;
    for (const p of clear) spots.push(p);

    const n = Math.min(spots.length, 420);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
    const fronds = new THREE.InstancedMesh(frondGeo, frondMat, n * 5);
    const d = new THREE.Object3D();
    let f = 0;
    for (let k = 0; k < n; k++) {
      const [x, z] = spots[k];
      const s = 0.85 + rand() * 0.5;
      d.position.set(x, 4.8 * s, z);
      d.scale.set(s, s, s);
      d.rotation.set((rand() - 0.5) * 0.09, rand() * 3, (rand() - 0.5) * 0.09);
      d.updateMatrix();
      trunks.setMatrixAt(k, d.matrix);
      for (let q = 0; q < 5; q++) {
        const a = (q / 5) * Math.PI * 2 + rand();
        d.position.set(x + Math.cos(a) * 1.5 * s, 9.4 * s, z + Math.sin(a) * 1.5 * s);
        d.rotation.set(Math.PI * 0.62 * Math.cos(a) * -1, a, Math.PI * 0.62 * Math.sin(a));
        d.scale.set(s, s, s);
        d.updateMatrix();
        fronds.setMatrixAt(f++, d.matrix);
      }
    }
    fronds.count = f;
    trunks.castShadow = true;
    fronds.castShadow = true;
    this.group.add(trunks, fronds);
    this.disposables.push(trunkGeo, trunkMat, frondGeo, frondMat);
  }

  // -- ajonaikainen --------------------------------------------------------

  update(dt, vehicle) {
    this.traffic.update(dt, vehicle);
  }

  collide(vehicle) {
    const a = this.walls.collide(vehicle, 0.22);
    const b = this.traffic.collide(vehicle);
    return Math.max(a, b);
  }

  // Läheltä piti: lähin siviiliauto. Pisteytys palkitsee ohilipaisusta.
  trafficDistance(x, z) { return this.traffic.nearestDistance(x, z); }

  dispose() {
    if (this.districts) this.districts.dispose();
    this.traffic.dispose();
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.group.clear();
  }
}
