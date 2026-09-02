// Kaupungin ulkopuoliset alueet: moottoritie ja lentokentta.
//
// Ruutukaavan ajopinta lasketaan analyyttisesti kadun keskilinjasta. Naita kahta
// aluetta ei saa siihen malliin - moottoritie ei ole ruudukon katu ja kiitorata
// on 60 metria leveä - joten ne kuvataan akselien suuntaisina laattoina
// (slab). Yksi laatta on suorakaide, jolla on oma kitka. sample() ottaa parhaan
// osuman kadun ja laattojen valilta, joten kumpikin pysyy O(1):ssa eika mitaan
// tarvitse rasteroida.
//
// Laatat ovat myos ainoa asia, jonka rekvisiitan sijoitus ja pisteytys tarvitsee
// tietaa: liikenne ei aja naille alueille, joten tekoalyn ei tarvitse tuntea
// niita lainkaan.

import * as THREE from '../vendor/three.module.min.js';
import { asphaltTexture, concreteTexture, toTexture } from './textures.js';

// Moottoritie
const MW_Z = -630;          // keskilinja
const MW_HALF = 17;         // puolileveys (3 kaistaa suuntaansa + piennar)
const MW_X0 = -1040, MW_X1 = 1040;
const RAMP_HALF = 7;

// Lentokentta
const RW_X0 = -1560, RW_X1 = -760;   // kiitorata
const RW_Z = 0, RW_HALF = 30;
const TW_Z = 82, TW_HALF = 9;        // rullaustie
const AP_X0 = -1120, AP_X1 = -860;   // asemataso
const AP_Z0 = 108, AP_Z1 = 236;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Kiitoradan pinta: tumma betoni, keskiviiva, kynnysraidat ja kosketusalueen
// merkit. Kuva on pitka ja kapea ja venytetaan koko kiitoradalle kerralla,
// joten merkinnat osuvat oikeille kohdille eivatka toistu.
function runwayTexture() {
  const W = 2048, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const rand = rng(4711);

  ctx.fillStyle = '#3a3d43';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 5200; i++) {
    const l = 0.6 + rand() * 0.5;
    ctx.fillStyle = `rgba(${(126 * l) | 0},${(130 * l) | 0},${(138 * l) | 0},${0.05 + rand() * 0.12})`;
    ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 3, 1 + rand() * 3);
  }
  // Kumijaljet kosketusalueilla.
  for (const cx of [W * 0.16, W * 0.84]) {
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(24,24,26,${0.02 + rand() * 0.05})`;
      ctx.fillRect(cx + (rand() - 0.5) * W * 0.10, rand() * H, 2 + rand() * 26, 1 + rand() * 3);
    }
  }

  ctx.fillStyle = '#e8e9ec';
  // Keskiviiva: 30 m viiva, 20 m vali. Kiitorata on 800 m, joten 2048 px / 800 m.
  const pxPerM = W / (RW_X1 - RW_X0);
  for (let x = 60; x < (RW_X1 - RW_X0) - 60; x += 50) {
    ctx.fillRect(x * pxPerM, H / 2 - 3, 30 * pxPerM, 6);
  }
  // Kynnysraidat molemmissa paissa.
  for (const [x0, dir] of [[24, 1], [(RW_X1 - RW_X0) - 24, -1]]) {
    for (let k = 0; k < 8; k++) {
      const y = H * (0.10 + k * 0.1);
      ctx.fillRect((x0 - (dir > 0 ? 0 : 34)) * pxPerM, y, 34 * pxPerM, H * 0.045);
    }
  }
  // Kosketusalueen parit.
  for (const cx of [150, (RW_X1 - RW_X0) - 150]) {
    for (const s of [-1, 1]) {
      ctx.fillRect(cx * pxPerM, H / 2 + s * H * 0.13 - 4, 22 * pxPerM, 8);
      ctx.fillRect(cx * pxPerM, H / 2 + s * H * 0.20 - 4, 22 * pxPerM, 8);
    }
  }
  // Reunaviivat.
  ctx.fillRect(0, 6, W, 5);
  ctx.fillRect(0, H - 11, W, 5);
  return c;
}

// Moottoritien pinta: kolme kaistaa suuntaansa, keskella betonikaide.
function motorwayTexture() {
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const rand = rng(9012);
  ctx.fillStyle = '#2f3238';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    const l = 0.55 + rand() * 0.5;
    ctx.fillStyle = `rgba(${(118 * l) | 0},${(122 * l) | 0},${(130 * l) | 0},${0.07 + rand() * 0.15})`;
    ctx.beginPath();
    ctx.arc(rand() * W, rand() * H, 1 + rand() * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Keskikaide levena tummana kaistana.
  ctx.fillStyle = '#5a5e66';
  ctx.fillRect(W / 2 - 7, 0, 14, H);
  ctx.fillStyle = 'rgba(232,232,232,0.9)';
  ctx.fillRect(W / 2 - 10, 0, 3, H);
  ctx.fillRect(W / 2 + 7, 0, 3, H);
  // Kaistaviivat, kolme kaistaa suuntaansa.
  ctx.strokeStyle = 'rgba(235,235,235,0.85)';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([54, 46]);
  for (const k of [1, 2]) {
    for (const s of [-1, 1]) {
      const x = W / 2 + s * (10 + k * ((W / 2 - 14) / 3));
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(228,228,228,0.75)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(4, 0); ctx.lineTo(4, H);
  ctx.moveTo(W - 4, 0); ctx.lineTo(W - 4, H);
  ctx.stroke();
  return c;
}

export class Districts {
  /**
   * @param {City} city  ruutukaava, johon alueet liitetaan
   */
  constructor(city) {
    this.city = city;
    this.group = new THREE.Group();
    this.disposables = [];
    this.slabs = [];
    this.rand = rng(20260902);

    // Ramppien x-paikat haetaan olemassa olevilta bulevardeilta, jotta liittyma
    // osuu kadun kohdalle eika keskelle korttelia.
    this.rampX = [
      city.xs[city.nearestIndex(city.xs, -210)],
      city.xs[city.nearestIndex(city.xs, 210)]
    ];
    // Lentokentan tulotie ajetaan sen vaakakadun kohdalta, joka on lahinna
    // asematasoa - nain se jatkuu suoraan kaupungin katuverkkoon.
    this.accessZ = city.zs[city.nearestIndex(city.zs, (AP_Z0 + AP_Z1) / 2)];

    this.layout();
    this.buildMotorway();
    this.buildAirport();
  }

  addSlab(x0, x1, z0, z1, grip, kind) {
    this.slabs.push({ x0, x1, z0, z1, grip, kind });
  }

  layout() {
    const g = this.city.def.roadGrip;
    // Moottoritie ja sen kaksi ramppia.
    this.addSlab(MW_X0, MW_X1, MW_Z - MW_HALF, MW_Z + MW_HALF, g, 'motorway');
    for (const rx of this.rampX) {
      this.addSlab(rx - RAMP_HALF, rx + RAMP_HALF, MW_Z, this.city.minZ - 40, g, 'ramp');
    }
    // Kiitorata, rullaustie, niiden yhdystiet, asemataso ja tulotie.
    const gc = g * 0.97;   // betoni pitaa hitusen asfalttia vahemman
    this.addSlab(RW_X0, RW_X1, RW_Z - RW_HALF, RW_Z + RW_HALF, gc, 'runway');
    this.addSlab(RW_X0, RW_X1, TW_Z - TW_HALF, TW_Z + TW_HALF, gc, 'taxiway');
    for (const x of [RW_X0 + 40, RW_X1 - 40]) {
      this.addSlab(x - TW_HALF, x + TW_HALF, RW_Z + RW_HALF, TW_Z - TW_HALF, gc, 'taxiway');
    }
    this.addSlab(AP_X0, AP_X1, AP_Z0, AP_Z1, gc, 'apron');
    this.addSlab((AP_X0 + AP_X1) / 2 - TW_HALF, (AP_X0 + AP_X1) / 2 + TW_HALF,
      TW_Z + TW_HALF, AP_Z0, gc, 'taxiway');
    this.addSlab(AP_X1, this.city.minX - 40, this.accessZ - 8, this.accessZ + 8, g, 'access');

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of this.slabs) {
      minX = Math.min(minX, s.x0); maxX = Math.max(maxX, s.x1);
      minZ = Math.min(minZ, s.z0); maxZ = Math.max(maxZ, s.z1);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  /**
   * Laattojen pintanayte. Palauttaa nullin jos piste ei ole minkaan laatan
   * vaikutusalueella, jolloin kutsuja kayttaa kadun omaa tulosta.
   */
  sample(x, z) {
    let best = null;
    for (const s of this.slabs) {
      const dx = Math.max(s.x0 - x, x - s.x1);
      const dz = Math.max(s.z0 - z, z - s.z1);
      const d = Math.max(dx, dz);
      if (d > 8) continue;
      if (!best || d < best.d) best = { d, s };
    }
    if (!best) return null;
    const onRoad = best.d <= 0;
    // dist pidetaan pienena ajopinnalla: main.js:n "palaa radalle" -kello lukee
    // tata, eika kiitoradalla ajamisen pida kaynnistaa sita.
    return {
      grip: onRoad ? best.s.grip : this.city.def.offGrip,
      onRoad,
      height: 0,
      dist: onRoad ? 0 : Math.max(0, best.d) + this.city.halfWidth,
      slopeX: 0, slopeZ: 0, prog: 0
    };
  }

  /** Onko piste jollain laatalla - rekvisiitan sijoitus kysyy tata. */
  onSlab(x, z, margin = 0) {
    for (const s of this.slabs) {
      if (x > s.x0 - margin && x < s.x1 + margin &&
          z > s.z0 - margin && z < s.z1 + margin) return true;
    }
    return false;
  }

  /** Lahin laatan keskilinja - palautusta varten. */
  respawn(x, z) {
    let best = null;
    for (const s of this.slabs) {
      const cx = Math.min(Math.max(x, s.x0 + 4), s.x1 - 4);
      const cz = Math.min(Math.max(z, s.z0 + 4), s.z1 - 4);
      const d = Math.hypot(cx - x, cz - z);
      if (!best || d < best.d) best = { d, s, cx, cz };
    }
    if (!best || best.d > 60) return null;
    const s = best.s;
    // Suuntaus laatan pitkan sivun mukaan.
    const horiz = (s.x1 - s.x0) >= (s.z1 - s.z0);
    return { x: best.cx, z: best.cz, yaw: horiz ? Math.PI / 2 : 0 };
  }

  // =====================================================================
  // Geometria
  // =====================================================================

  slabMesh(s, tex, y, repU, repV) {
    const geo = new THREE.PlaneGeometry(s.x1 - s.x0, s.z1 - s.z0);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repU, uv.getY(i) * repV);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, metalness: 0.02 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((s.x0 + s.x1) / 2, y, (s.z0 + s.z1) / 2);
    m.receiveShadow = true;
    this.group.add(m);
    this.disposables.push(geo, mat);
    return m;
  }

  buildMotorway() {
    const tex = toTexture(motorwayTexture(), 1);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    const mw = this.slabs.find((s) => s.kind === 'motorway');
    // Kuvan pystyakseli on ajosuunta, joten vaakasuuntainen tie tarvitsee
    // kaannetyn UV:n: U kulkee pituussuunnassa.
    const geo = new THREE.PlaneGeometry(mw.x1 - mw.x0, mw.z1 - mw.z0);
    const uv = geo.attributes.uv;
    const rep = (mw.x1 - mw.x0) / 34;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i) * rep);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, metalness: 0.02 });
    const road = new THREE.Mesh(geo, mat);
    road.rotation.x = -Math.PI / 2;
    road.position.set((mw.x0 + mw.x1) / 2, 0.014, MW_Z);
    road.receiveShadow = true;
    this.group.add(road);
    this.disposables.push(geo, mat, tex);

    const rampTex = toTexture(asphaltTexture('#31343a', 12), 6);
    for (const s of this.slabs) {
      if (s.kind !== 'ramp') continue;
      this.slabMesh(s, rampTex, 0.013, 1, (s.z1 - s.z0) / 14);
    }
    this.disposables.push(rampTex);

    // Keskikaide ja reunakaiteet. Kaiteet ovat oikeita seinia: moottoritielta
    // ei saa pudota, ja keskikaide tekee siita kaksi erillista suoraa.
    const walls = this.city.walls;
    const rampSpans = this.rampX.map((rx) => [rx - RAMP_HALF - 2, rx + RAMP_HALF + 2]);
    const addSideWithGaps = (z, inward) => {
      let x = mw.x0;
      const cuts = rampSpans.slice().sort((a, b) => a[0] - b[0]);
      for (const [a, b] of cuts) {
        if (a > x) walls.add(x, z, a, z, inward < 0);
        x = Math.max(x, b);
      }
      if (x < mw.x1) walls.add(x, z, mw.x1, z, inward < 0);
    };
    // Etelareuna: sisaanpain on +z. Pohjoisreuna: sisaanpain on -z, ja siina
    // ovat rampit, joten se katkaistaan niiden kohdalta.
    walls.add(mw.x0, mw.z0, mw.x1, mw.z0, false);
    addSideWithGaps(mw.z1, -1);
    // Keskikaide kahtena seinana, jotta kumpikin puoli tyontaa omaan suuntaansa.
    walls.add(mw.x0, MW_Z - 1.2, mw.x1, MW_Z - 1.2, false);
    walls.add(mw.x0, MW_Z + 1.2, mw.x1, MW_Z + 1.2, true);
    // Ramppien reunat.
    for (const rx of this.rampX) {
      const z0 = MW_Z + 2.5, z1 = this.city.minZ - 40;
      walls.add(rx - RAMP_HALF, z0, rx - RAMP_HALF, z1, true);
      walls.add(rx + RAMP_HALF, z0, rx + RAMP_HALF, z1, false);
    }

    this.buildGuardrailMesh(mw);
    this.buildMotorwayLights(mw);
  }

  // Kaiteet nakyvaksi: matala betonipalkki keskelle ja reunoille.
  buildGuardrailMesh(mw) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.9 });
    const bars = [
      { x: (mw.x0 + mw.x1) / 2, z: MW_Z, w: mw.x1 - mw.x0, d: 2.4, h: 1.05 },
      { x: (mw.x0 + mw.x1) / 2, z: mw.z0 - 0.5, w: mw.x1 - mw.x0, d: 1.0, h: 0.9 }
    ];
    for (const rx of this.rampX) {
      const z0 = MW_Z + 2.5, z1 = this.city.minZ - 40;
      for (const s of [-1, 1]) {
        bars.push({ x: rx + s * (RAMP_HALF + 0.5), z: (z0 + z1) / 2, w: 1.0, d: Math.abs(z1 - z0), h: 0.9 });
      }
    }
    // Pohjoisreuna paloissa ramppien valista.
    const cuts = this.rampX.map((rx) => [rx - RAMP_HALF - 2, rx + RAMP_HALF + 2]).sort((a, b) => a[0] - b[0]);
    let x = mw.x0;
    for (const [a, b] of cuts) {
      if (a > x) bars.push({ x: (x + a) / 2, z: mw.z1 + 0.5, w: a - x, d: 1.0, h: 0.9 });
      x = Math.max(x, b);
    }
    if (x < mw.x1) bars.push({ x: (x + mw.x1) / 2, z: mw.z1 + 0.5, w: mw.x1 - x, d: 1.0, h: 0.9 });

    const im = new THREE.InstancedMesh(geo, mat, bars.length);
    const d = new THREE.Object3D();
    bars.forEach((b, k) => {
      d.position.set(b.x, b.h / 2, b.z);
      d.scale.set(b.w, b.h, b.d);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      im.setMatrixAt(k, d.matrix);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    this.group.add(im);
    this.disposables.push(geo, mat);
  }

  buildMotorwayLights(mw) {
    const poleGeo = new THREE.CylinderGeometry(0.16, 0.22, 11, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x6a6e76, roughness: 0.8 });
    const headGeo = new THREE.BoxGeometry(2.2, 0.28, 0.9);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xf0e2b4, emissive: 0x2a2417, roughness: 0.6
    });
    const n = Math.floor((mw.x1 - mw.x0) / 70);
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, n);
    const heads = new THREE.InstancedMesh(headGeo, headMat, n);
    const d = new THREE.Object3D();
    for (let k = 0; k < n; k++) {
      const x = mw.x0 + 35 + k * 70;
      d.position.set(x, 5.5, MW_Z);
      d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1);
      d.updateMatrix(); poles.setMatrixAt(k, d.matrix);
      d.position.set(x, 11.0, MW_Z);
      d.updateMatrix(); heads.setMatrixAt(k, d.matrix);
    }
    poles.castShadow = true;
    this.group.add(poles, heads);
    this.disposables.push(poleGeo, poleMat, headGeo, headMat);
  }

  buildAirport() {
    const rwTex = toTexture(runwayTexture(), 1);
    rwTex.wrapS = THREE.ClampToEdgeWrapping;
    rwTex.wrapT = THREE.ClampToEdgeWrapping;
    const rw = this.slabs.find((s) => s.kind === 'runway');
    const geo = new THREE.PlaneGeometry(rw.x1 - rw.x0, rw.z1 - rw.z0);
    const uv = geo.attributes.uv;
    // Kuva on vaakasuuntainen ja venytetaan kerran koko kiitoradalle.
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), 1 - uv.getY(i));
    const mat = new THREE.MeshStandardMaterial({ map: rwTex, roughness: 0.9, metalness: 0.02 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((rw.x0 + rw.x1) / 2, 0.014, RW_Z);
    m.receiveShadow = true;
    this.group.add(m);
    this.disposables.push(geo, mat, rwTex);

    const conc = toTexture(concreteTexture(10, '#8b8e94'), 14);
    for (const s of this.slabs) {
      if (s.kind !== 'taxiway' && s.kind !== 'apron') continue;
      this.slabMesh(s, conc, 0.012,
        Math.max(1, (s.x1 - s.x0) / 30), Math.max(1, (s.z1 - s.z0) / 30));
    }
    const accessTex = toTexture(asphaltTexture('#31343a', 12), 8);
    for (const s of this.slabs) {
      if (s.kind === 'access') this.slabMesh(s, accessTex, 0.013, (s.x1 - s.x0) / 16, 1);
    }
    this.disposables.push(conc, accessTex);

    this.buildTerminal();
    this.buildHangars();
    this.buildAircraft();
    this.buildFence();
  }

  buildTerminal() {
    const g = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.85 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x1d2732, roughness: 0.18, metalness: 0.6
    });
    const cx = (AP_X0 + AP_X1) / 2, cz = AP_Z1 + 26;
    const W = 208, D = 32;

    const base = new THREE.Mesh(new THREE.BoxGeometry(W, 13, D), wallMat);
    base.position.set(cx, 6.5, cz);
    const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 5.2, D + 0.6), glassMat);
    band.position.set(cx, 7.6, cz);
    // Kaareva katto pitkin terminaalia. Litistetaan ennen kiertoa, muuten
    // sateesta tulee myos korkeus ja terminaalista 35 metria korkea putki.
    const roofGeo = new THREE.CylinderGeometry(D / 2, D / 2, W, 16, 1, false, 0, Math.PI);
    roofGeo.scale(9 / (D / 2), 1, 1);
    const roof = new THREE.Mesh(roofGeo, wallMat);
    roof.rotation.z = Math.PI / 2;
    roof.position.set(cx, 13, cz);
    this.disposables.push(roofGeo);
    // Lennonjohtotorni.
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.4, 34, 10), wallMat);
    tower.position.set(AP_X1 + 22, 17, cz - 8);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 5.0, 6, 10), glassMat);
    cab.position.set(AP_X1 + 22, 36, cz - 8);
    for (const o of [base, band, roof, tower, cab]) { o.castShadow = true; o.receiveShadow = true; g.add(o); }
    this.group.add(g);
    this.disposables.push(wallMat, glassMat);

    // Terminaali on kiintea este.
    this.city.walls.addRect(cx, cz, W, D, false);
    this.city.walls.addRect(AP_X1 + 22, cz - 8, 9, 9, false);
  }

  buildHangars() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8f959d, roughness: 0.88 });
    const g = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const x = AP_X0 - 70 - k * 78;
      const z = AP_Z0 + 34;
      const bodyGeo = new THREE.BoxGeometry(64, 13, 52);
      const body = new THREE.Mesh(bodyGeo, mat);
      body.position.set(x, 6.5, z);
      const roofGeo = new THREE.CylinderGeometry(26, 26, 64, 14, 1, false, 0, Math.PI);
      roofGeo.scale(11 / 26, 1, 1);
      const roof = new THREE.Mesh(roofGeo, mat);
      roof.rotation.z = Math.PI / 2;
      roof.position.set(x, 13, z);
      this.disposables.push(bodyGeo, roofGeo);
      body.castShadow = roof.castShadow = true;
      body.receiveShadow = roof.receiveShadow = true;
      g.add(body, roof);
      this.city.walls.addRect(x, z, 64, 52, false);
    }
    this.group.add(g);
    this.disposables.push(mat);
  }

  // Muutama pysakoity kone asematasolle. Tarkoitus on mittakaava, ei realismi:
  // runko, siivet, pyrsto ja moottorit, ei enempaa.
  buildAircraft() {
    const body = new THREE.MeshStandardMaterial({ color: 0xe9ecf1, roughness: 0.55, metalness: 0.15 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x2b3a6b, roughness: 0.6 });
    const g = new THREE.Group();
    const specs = [
      { x: AP_X0 + 52, z: AP_Z0 + 44, s: 1.0, yaw: 0 },
      { x: AP_X0 + 148, z: AP_Z0 + 44, s: 0.82, yaw: 0 },
      { x: RW_X1 - 120, z: TW_Z, s: 1.05, yaw: Math.PI / 2 }
    ];
    for (const a of specs) {
      const p = new THREE.Group();
      const fus = new THREE.Mesh(new THREE.CapsuleGeometry(2.6, 32, 6, 12), body);
      fus.rotation.z = Math.PI / 2;
      fus.position.y = 4.6;
      const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.7, 34), body);
      wing.position.set(1, 3.6, 0);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(7, 0.6, 13), body);
      tail.position.set(-16, 4.4, 0);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(8, 10, 0.7), trim);
      fin.position.set(-16, 9, 0);
      for (const s of [-1, 1]) {
        const eng = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 6.4, 10), trim);
        eng.rotation.z = Math.PI / 2;
        eng.position.set(2, 2.4, s * 11);
        p.add(eng);
      }
      for (const o of [fus, wing, tail, fin]) { o.castShadow = true; p.add(o); }
      p.position.set(a.x, 0, a.z);
      p.rotation.y = a.yaw;
      p.scale.setScalar(a.s);
      g.add(p);
    }
    this.group.add(g);
    this.disposables.push(body, trim);
  }

  // Aita kentan ympari. Tulotien kohdalle jaa aukko, muuten sinne ei paase.
  buildFence() {
    const walls = this.city.walls;
    const x0 = RW_X0 - 40, x1 = this.city.minX - 40;
    const z0 = RW_Z - RW_HALF - 40, z1 = AP_Z1 + 70;
    const gate0 = this.accessZ - 9, gate1 = this.accessZ + 9;
    walls.add(x0, z0, x1, z0, true);        // etela
    walls.add(x0, z1, x1, z1, false);       // pohjoinen
    walls.add(x0, z0, x0, z1, true);        // lansi
    // Ita: kahdessa palassa, valiin portti tulotielle.
    walls.add(x1, z0, x1, gate0, false);
    walls.add(x1, gate1, x1, z1, false);

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x767b83, roughness: 0.92 });
    const bars = [
      { x: (x0 + x1) / 2, z: z0, w: x1 - x0, d: 0.5 },
      { x: (x0 + x1) / 2, z: z1, w: x1 - x0, d: 0.5 },
      { x: x0, z: (z0 + z1) / 2, w: 0.5, d: z1 - z0 },
      { x: x1, z: (z0 + gate0) / 2, w: 0.5, d: gate0 - z0 },
      { x: x1, z: (gate1 + z1) / 2, w: 0.5, d: z1 - gate1 }
    ];
    const im = new THREE.InstancedMesh(geo, mat, bars.length);
    const d = new THREE.Object3D();
    bars.forEach((b, k) => {
      d.position.set(b.x, 1.3, b.z);
      d.scale.set(b.w, 2.6, b.d);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      im.setMatrixAt(k, d.matrix);
    });
    im.castShadow = true;
    this.group.add(im);
    this.disposables.push(geo, mat);
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.group.clear();
  }
}
