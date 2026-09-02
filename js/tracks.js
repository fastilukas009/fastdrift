// Ratojen määrittely, geometrian generointi, pinnan näytteistys ja törmäykset.
//
// Rata rakennetaan keskilinjan splinistä (tai suorakaiteen muotoisesta kentästä).
// Ajopinta rasteroidaan ruudukkoon, josta fysiikka kysyy kitkan, korkeuden ja
// kaltevuuden. Seinät ovat janoja, jotka indeksoidaan hilaan törmäystestiä varten.

import * as THREE from '../vendor/three.module.min.js';
import { City } from './city.js';
import {
  asphaltTexture, groundTexture, curbTexture, concreteTexture, buildingTexture, toTexture
} from './textures.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export const TRACKS = [
  {
    id: 'losangeles',
    name: 'Los Angeles',
    kind: 'city',
    mode: 'free',
    difficulty: 2,
    blurb: 'Avoin kaupunki: ruutukaava, palmubulevardit ja liikennettä joka noudattaa valoja. Aja minne haluat.',
    time: 0,
    payout: 1.5,
    env: 'la',
    roadGrip: 1.0, offGrip: 0.55,
    traffic: 64, pedestrians: 150
  },
  {
    id: 'satama',
    name: 'Satamalaituri',
    kind: 'lot',
    mode: 'free',
    difficulty: 1,
    blurb: 'Avoin asfalttikenttä konttien keskellä. Ei seiniä lähellä - täydellinen paikka opetella kulmat.',
    time: 0,
    payout: 1.0,
    env: 'day',
    lot: { x: 0, z: 0, w: 190, h: 140 },
    roadGrip: 1.0, offGrip: 0.55,
    spawn: { x: -60, z: -40, yaw: Math.PI * 0.5 },
    clips: [
      { x: 40, z: -30, r: 6 }, { x: 55, z: 30, r: 6 },
      { x: -30, z: 40, r: 6 }, { x: -55, z: -5, r: 6 }
    ],
    cones: 'donut'
  },
  {
    id: 'teollisuus',
    name: 'Teollisuusrata',
    kind: 'circuit',
    mode: 'lap',
    difficulty: 2,
    blurb: 'Kilpasarjan kotirata: nopeita kaareja, kaksi hiusneulaa ja betonimuurit lähellä.',
    time: 150,
    payout: 1.35,
    env: 'day',
    width: 15,
    closed: true,
    roadGrip: 1.0, offGrip: 0.5,
    points: [
      [0, 0, 0], [86, 0, 26], [148, 0, 88], [156, 0, 168], [112, 0, 224],
      [30, 0, 244], [-52, 0, 226], [-116, 0, 176], [-158, 0, 100], [-150, 0, 14],
      [-104, 0, -46], [-26, 0, -42]
    ],
    clipsT: [0.06, 0.19, 0.33, 0.48, 0.62, 0.78, 0.91],
    props: 'industrial'
  },
  {
    id: 'vuoristo',
    name: 'Vuoristolasku',
    kind: 'touge',
    mode: 'sprint',
    difficulty: 3,
    blurb: 'Kapea alamäki kaiteiden välissä. Yksi virhe riittää - mutta seinän vieressä on eniten pisteitä.',
    time: 0,
    payout: 1.7,
    env: 'dusk',
    width: 9.6,
    closed: false,
    roadGrip: 0.96, offGrip: 0.42,
    points: [
      [0, 64, 0], [10, 61, 52], [-24, 57, 96], [-70, 52, 118], [-104, 46, 88],
      [-92, 40, 36], [-46, 35, 12], [4, 30, 30], [40, 25, 78], [30, 20, 134],
      [-16, 15, 168], [-78, 11, 176], [-134, 7, 152], [-168, 3, 100], [-176, 0, 40]
    ],
    clipsT: [0.11, 0.24, 0.37, 0.52, 0.66, 0.81, 0.93],
    props: 'forest'
  },
  {
    id: 'talvi',
    name: 'Talviratapiha',
    kind: 'circuit',
    mode: 'lap',
    difficulty: 3,
    blurb: 'Yö, lumi ja puolet pidosta. Kaasu pysyy pohjassa, ratti tekee kaiken työn.',
    time: 180,
    payout: 1.9,
    env: 'night',
    width: 17,
    closed: true,
    roadGrip: 0.58, offGrip: 0.34,
    surface: 'snow',
    points: [
      [0, 0, 0], [70, 0, -8], [126, 0, 34], [130, 0, 100], [88, 0, 150],
      [16, 0, 160], [-40, 0, 132], [-52, 0, 74], [-96, 0, 40], [-92, 0, -24],
      [-40, 0, -44]
    ],
    clipsT: [0.09, 0.26, 0.44, 0.61, 0.79],
    props: 'winter'
  }
];

export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]));

// Kaupunki ja kilparadat toteuttavat saman rajapinnan, joten peli ei tiedä eroa.
export function createTrack(def) {
  return def.kind === 'city' ? new City(def) : new Track(def);
}

const CELL = 2.0;

export class Track {
  constructor(def) {
    this.def = def;
    this.group = new THREE.Group();
    this.walls = [];
    this.wallGrid = new Map();
    this.cones = [];
    this.clips = [];
    this.disposables = [];
    this.length = 0;
    this.build();
  }

  // -- rakentaminen --------------------------------------------------------

  build() {
    const def = this.def;
    this.centerline = def.kind === 'lot' ? [] : this.sampleCurve(def);
    this.buildGrid();
    this.buildGround();
    if (def.kind === 'lot') this.buildLot();
    else this.buildRoad();
    this.buildProps();
    this.buildClips();
    this.buildWallGrid();
  }

  sampleCurve(def) {
    const pts = def.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(pts, !!def.closed, 'centripetal', 0.5);
    this.curve = curve;
    const total = curve.getLength();
    this.length = total;
    const n = Math.max(64, Math.round(total / 2.5));
    const raw = curve.getSpacedPoints(n);
    const line = [];
    const closed = !!def.closed;
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      // Avoimella radalla indeksia ei saa kietaista: muuten ensimmaisen pisteen
      // tangentti laskettaisiin radan VIIMEISESTA pisteesta, jolloin lahtosuunta
      // ja radan paatymuuri osoittavat sinne pain mista rata loppuu.
      const prev = closed ? raw[(i - 1 + raw.length) % raw.length] : raw[Math.max(0, i - 1)];
      const next = closed ? raw[(i + 1) % raw.length] : raw[Math.min(raw.length - 1, i + 1)];
      const tx = next.x - prev.x, tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      line.push({
        x: p.x, y: p.y, z: p.z,
        tx: tx / len, tz: tz / len,
        rx: (tz / len), rz: -(tx / len),
        t: i / (raw.length - (closed ? 0 : 1))
      });
    }
    return line;
  }

  buildGrid() {
    const def = this.def;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    // Makisella radalla ruudukolle annetaan reilusti tilaa: sen reuna nakyy
    // maastossa suorana jyrkanteena, joten se pitaa tyontaa kauas tiesta.
    const hilly = def.points ? def.points.some((p) => Math.abs(p[1]) > 2) : false;
    const pad = def.kind === 'lot' ? 20 : (def.width || 12) + (hilly ? 90 : 24);
    if (def.kind === 'lot') {
      minX = def.lot.x - def.lot.w / 2 - pad; maxX = def.lot.x + def.lot.w / 2 + pad;
      minZ = def.lot.z - def.lot.h / 2 - pad; maxZ = def.lot.z + def.lot.h / 2 + pad;
    } else {
      for (const p of this.centerline) {
        minX = Math.min(minX, p.x - pad); maxX = Math.max(maxX, p.x + pad);
        minZ = Math.min(minZ, p.z - pad); maxZ = Math.max(maxZ, p.z + pad);
      }
    }
    this.minX = minX; this.minZ = minZ;
    this.nx = Math.ceil((maxX - minX) / CELL) + 1;
    this.nz = Math.ceil((maxZ - minZ) / CELL) + 1;
    const n = this.nx * this.nz;
    this.gDist = new Float32Array(n).fill(9999);
    this.gHeight = new Float32Array(n);
    this.gProg = new Float32Array(n);

    if (def.kind === 'lot') {
      const hw = def.lot.w / 2, hh = def.lot.h / 2;
      for (let ix = 0; ix < this.nx; ix++) {
        for (let iz = 0; iz < this.nz; iz++) {
          const x = minX + ix * CELL, z = minZ + iz * CELL;
          const dx = Math.max(Math.abs(x - def.lot.x) - hw, 0);
          const dz = Math.max(Math.abs(z - def.lot.z) - hh, 0);
          this.gDist[iz * this.nx + ix] = Math.hypot(dx, dz);
        }
      }
      this.halfWidth = 0;
      return;
    }

    const halfW = def.width / 2;
    this.halfWidth = halfW;
    const reach = halfW + 22;
    const line = this.centerline;
    const segs = def.closed ? line.length : line.length - 1;
    for (let s = 0; s < segs; s++) {
      const a = line[s], b = line[(s + 1) % line.length];
      const abx = b.x - a.x, abz = b.z - a.z;
      const abLen2 = abx * abx + abz * abz || 1;
      const lo = this.cellRange(Math.min(a.x, b.x) - reach, Math.min(a.z, b.z) - reach);
      const hi = this.cellRange(Math.max(a.x, b.x) + reach, Math.max(a.z, b.z) + reach);
      for (let iz = lo.iz; iz <= hi.iz; iz++) {
        for (let ix = lo.ix; ix <= hi.ix; ix++) {
          const x = minX + ix * CELL, z = minZ + iz * CELL;
          let t = ((x - a.x) * abx + (z - a.z) * abz) / abLen2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = a.x + abx * t, pz = a.z + abz * t;
          const d = Math.hypot(x - px, z - pz);
          const idx = iz * this.nx + ix;
          if (d < this.gDist[idx]) {
            this.gDist[idx] = d;
            this.gHeight[idx] = a.y + (b.y - a.y) * t;
            this.gProg[idx] = (s + t) / segs;
          }
        }
      }
    }
    // Segmenttihaku kattoi vain kaistaleen tien ymparilta (reach). Sen ulkopuolella
    // gDist jai arvoon 9999 ja gHeight nollaan, joten maasto putosi portaana nollaan
    // ja vuoristoradalla auto tippui 64 metria tyhjaan. Chamfer-muunnos levittaa
    // lahimman tiepisteen etaisyyden, korkeuden ja edistyman koko ruudukkoon
    // kahdella pyyhkaisylla - O(n), ei O(segmentit x ruudut).
    this.spreadGrid();

    // Radan ulkopuolella maasto laskee loivasti, jotta pientareelta ei aja tyhjään.
    for (let i = 0; i < n; i++) {
      const extra = Math.max(0, this.gDist[i] - halfW - 2);
      this.gHeight[i] -= Math.min(2.6, extra * 0.10);
    }
  }

  // Kahden pyyhkaisyn chamfer-etaisyysmuunnos. Naapurin etaisyyteen lisataan
  // askeleen pituus; jos summa on pienempi, myos korkeus ja edistyma peritaan
  // samalta naapurilta. Diagonaalin paino on sqrt(2), joten tulos on riittavan
  // lahella euklidista etta rinne on tasainen eika ruudukon suuntainen.
  spreadGrid() {
    const nx = this.nx, nz = this.nz;
    const d = this.gDist, h = this.gHeight, g = this.gProg;
    const S = CELL, D = CELL * Math.SQRT2;
    const relax = (i, j, cost) => {
      const v = d[j] + cost;
      if (v < d[i]) { d[i] = v; h[i] = h[j]; g[i] = g[j]; }
    };
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix;
        if (ix > 0) relax(i, i - 1, S);
        if (iz > 0) {
          relax(i, i - nx, S);
          if (ix > 0) relax(i, i - nx - 1, D);
          if (ix < nx - 1) relax(i, i - nx + 1, D);
        }
      }
    }
    for (let iz = nz - 1; iz >= 0; iz--) {
      for (let ix = nx - 1; ix >= 0; ix--) {
        const i = iz * nx + ix;
        if (ix < nx - 1) relax(i, i + 1, S);
        if (iz < nz - 1) {
          relax(i, i + nx, S);
          if (ix < nx - 1) relax(i, i + nx + 1, D);
          if (ix > 0) relax(i, i + nx - 1, D);
        }
      }
    }
  }

  cellRange(x, z) {
    return {
      ix: Math.max(0, Math.min(this.nx - 1, Math.round((x - this.minX) / CELL))),
      iz: Math.max(0, Math.min(this.nz - 1, Math.round((z - this.minZ) / CELL)))
    };
  }

  // Kaksilineaarinen näyte ruudukosta: kitka, korkeus, kaltevuus ja etäisyys keskilinjasta.
  sample(x, z) {
    const fx = (x - this.minX) / CELL;
    const fz = (z - this.minZ) / CELL;
    const ix = Math.max(0, Math.min(this.nx - 2, Math.floor(fx)));
    const iz = Math.max(0, Math.min(this.nz - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - ix));
    const tz = Math.max(0, Math.min(1, fz - iz));
    const i00 = iz * this.nx + ix, i10 = i00 + 1;
    const i01 = i00 + this.nx, i11 = i01 + 1;

    const h0 = this.gHeight[i00] + (this.gHeight[i10] - this.gHeight[i00]) * tx;
    const h1 = this.gHeight[i01] + (this.gHeight[i11] - this.gHeight[i01]) * tx;
    const height = h0 + (h1 - h0) * tz;

    const d0 = this.gDist[i00] + (this.gDist[i10] - this.gDist[i00]) * tx;
    const d1 = this.gDist[i01] + (this.gDist[i11] - this.gDist[i01]) * tx;
    const dist = d0 + (d1 - d0) * tz;

    const def = this.def;
    const edge = def.kind === 'lot' ? 0 : this.halfWidth;
    let grip, onRoad;
    if (dist <= edge + 0.4) { grip = def.roadGrip; onRoad = true; }
    else if (dist <= edge + 2.4) {
      const k = (dist - edge - 0.4) / 2.0;
      grip = def.roadGrip + (def.offGrip - def.roadGrip) * k;
      onRoad = k < 0.5;
    } else { grip = def.offGrip; onRoad = false; }

    const slopeX = (this.gHeight[i10] - this.gHeight[i00]) / CELL;
    const slopeZ = (this.gHeight[i01] - this.gHeight[i00]) / CELL;

    return { grip, onRoad, height, dist, slopeX, slopeZ, prog: this.gProg[i00] };
  }

  // -- geometriat ----------------------------------------------------------

  buildGround() {
    const def = this.def;
    const kind = def.surface === 'snow' ? 'snow'
      : def.props === 'forest' ? 'grass'
      : def.props === 'industrial' ? 'gravel' : 'dirt';
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.98, metalness: 0 });

    let maxY = 0;
    for (const p of this.centerline) maxY = Math.max(maxY, Math.abs(p.y));
    const hilly = maxY > 2;

    if (!hilly) {
      const tex = toTexture(groundTexture(kind), 90);
      mat.map = tex;
      const geo = new THREE.PlaneGeometry(1400, 1400, 1, 1);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      // Aivan tienpinnan alapuolella: pientareelle ei synny näkyvää porrasta.
      mesh.position.y = -0.06;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(geo, mat, tex);
      return;
    }

    // Mäkisellä radalla maasto rakennetaan korkeusruudukosta, jotta tie ei jää leijumaan.
    // Ruudukon ulkopuolella rinne jatkaa laskuaan, ja sumu peittää reunan.
    //
    // Ruutukoko sidotaan fysiikan ruudukkoon (CELL * 1.5). Aiemmin tassa oli
    // kiintea 96 x 96 ruutua 780 metrille eli 8 metria per verteksi, kun tie on
    // 9,6 metria leveä: maasto ei mitenkaan voinut seurata tienpintaa, vaan
    // tunkeutui sen lapi portaina. Se oli se "epamuodostunut rata".
    const tex = toTexture(groundTexture(kind), 60);
    mat.map = tex;
    // 4 metria per verteksi. Tarkempi ei kannata: maasto on joka tapauksessa
    // 12 cm tienpinnan alapuolella eika voi tunkeutua sen lapi, joten lisatarkkuus
    // menisi pelkkaan kolmiomaaraan. Ennen tama oli 8 metria, jolloin maasto ei
    // pysynyt tien mukana lainkaan.
    const step = CELL * 2;
    const span = Math.max(this.nx, this.nz) * CELL + 260;
    const seg = Math.min(220, Math.ceil(span / step));
    const geo = new THREE.PlaneGeometry(span, span, seg, seg);
    const pos = geo.attributes.position;
    const cxm = (this.minX + this.nx * CELL / 2), czm = (this.minZ + this.nz * CELL / 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cxm;
      const z = -pos.getY(i) + czm;
      pos.setZ(i, this.terrainHeight(x, z));
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cxm, 0, czm);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(geo, mat, tex);
  }

  // Maaston visuaalinen korkeus: tienpinta lähellä, jyrkkenevä rinne kauempana.
  terrainHeight(x, z) {
    const s = this.sample(x, z);
    const edge = this.halfWidth + 3;
    // Maasto pidetaan aina vahintaan 12 cm tienpinnan alapuolella. Nain se ei
    // voi tunkeutua ajopinnan lapi vaikka verteksi osuisi tien keskelle.
    const drop = 0.12 + Math.min(30, Math.max(0, s.dist - edge) * 0.30);
    const outX = Math.max(0, Math.abs(x - (this.minX + this.nx * CELL / 2)) - this.nx * CELL / 2);
    const outZ = Math.max(0, Math.abs(z - (this.minZ + this.nz * CELL / 2)) - this.nz * CELL / 2);
    return s.height - drop - Math.hypot(outX, outZ) * 0.20 - 0.06;
  }

  buildLot() {
    const def = this.def;
    const { x, z, w, h } = def.lot;
    const tex = toTexture(asphaltTexture('#33363c'), 22);
    const geo = new THREE.PlaneGeometry(w, h, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.02 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.01, z);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(geo, mat, tex);

    this.paintLotMarkings(x, z, w, h);

    const hw = w / 2, hh = h / 2;
    const c = [
      [x - hw, z - hh], [x + hw, z - hh], [x + hw, z + hh], [x - hw, z + hh]
    ];
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      // Sisaanpain = janan keskipisteesta kentan keskipisteeseen.
      this.addWall(a[0], a[1], b[0], b[1],
        x - (a[0] + b[0]) / 2, z - (a[1] + b[1]) / 2);
    }
    this.buildWallMesh(1.15, '#7d8087');
  }

  // Kentän maalaukset: kahdeksikkorata ja pistealueiden ympyrät ohjaavat ajolinjaa.
  paintLotMarkings(cx, cz, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 1024, 1024);
    const sx = 1024 / w, sz = 1024 / h;
    const toPx = (x, z) => [(x - cx + w / 2) * sx, (z - cz + h / 2) * sz];

    ctx.strokeStyle = 'rgba(240,240,240,0.42)';
    ctx.lineWidth = 6;
    ctx.setLineDash([26, 20]);
    ctx.beginPath();
    for (let i = 0; i <= 220; i++) {
      const t = i / 220 * Math.PI * 2;
      const px = Math.sin(t) * 52 + cx;
      const pz = Math.sin(t * 2) * 42 + cz;
      const [a, b] = toPx(px, pz);
      if (i === 0) ctx.moveTo(a, b); else ctx.lineTo(a, b);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(255,196,60,0.5)';
    ctx.lineWidth = 5;
    for (const clip of this.def.clips || []) {
      const [a, b] = toPx(clip.x, clip.z);
      ctx.beginPath();
      ctx.arc(a, b, clip.r * sx, 0, Math.PI * 2);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cx, 0.02, cz);
    this.group.add(mesh);
    this.disposables.push(geo, mat, tex);
  }

  buildRoad() {
    const def = this.def;
    const line = this.centerline;
    const halfW = this.halfWidth;
    const closed = !!def.closed;
    const count = line.length;
    const last = closed ? count : count - 1;

    const pos = [], uv = [], idx = [];
    const curbPos = [], curbUv = [], curbIdx = [];
    let dist = 0;

    for (let i = 0; i < count; i++) {
      const p = line[i];
      if (i > 0) dist += Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z);
      pos.push(p.x - p.rx * halfW, p.y + 0.02, p.z - p.rz * halfW);
      pos.push(p.x + p.rx * halfW, p.y + 0.02, p.z + p.rz * halfW);
      uv.push(0, dist / 9, 1, dist / 9);

      // Reunakivet vain kaarteissa, missä niistä on ajollista merkitystä.
      const prev = line[(i - 1 + count) % count];
      const next = line[(i + 1) % count];
      const curvature = Math.abs(next.tx * prev.tz - next.tz * prev.tx);
      const cw = curvature > 0.06 ? 0.75 : 0;
      const off = halfW + 0.02;
      curbPos.push(p.x - p.rx * off, p.y + 0.04, p.z - p.rz * off);
      curbPos.push(p.x - p.rx * (off + cw), p.y + 0.10, p.z - p.rz * (off + cw));
      curbPos.push(p.x + p.rx * off, p.y + 0.04, p.z + p.rz * off);
      curbPos.push(p.x + p.rx * (off + cw), p.y + 0.10, p.z + p.rz * (off + cw));
      const cv = dist / 2.2;
      curbUv.push(0, cv, 1, cv, 0, cv, 1, cv);
    }

    for (let i = 0; i < last; i++) {
      // Kierto niin että normaali osoittaa ylös; väärin päin ajopinta katoaa kokonaan.
      const a = (i * 2) % (count * 2), b = ((i + 1) % count) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
      const ca = i * 4, cb = ((i + 1) % count) * 4;
      curbIdx.push(ca, ca + 1, cb, cb, ca + 1, cb + 1);
      curbIdx.push(ca + 2, cb + 2, ca + 3, ca + 3, cb + 2, cb + 3);
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    roadGeo.setIndex(idx);
    roadGeo.computeVertexNormals();
    const roadTex = toTexture(
      def.surface === 'snow' ? asphaltTexture('#b9c4d0', 19) : asphaltTexture('#31343a'), 1
    );
    roadTex.repeat.set(1, 1);
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTex, roughness: def.surface === 'snow' ? 0.7 : 0.93, metalness: 0.02
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.receiveShadow = true;
    this.group.add(road);
    this.disposables.push(roadGeo, roadMat, roadTex);

    const curbGeo = new THREE.BufferGeometry();
    curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbPos, 3));
    curbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(curbUv, 2));
    curbGeo.setIndex(curbIdx);
    curbGeo.computeVertexNormals();
    const curbTex = toTexture(curbTexture(), 1);
    curbTex.repeat.set(1, 1);
    const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.8 });
    const curb = new THREE.Mesh(curbGeo, curbMat);
    curb.receiveShadow = true;
    this.group.add(curb);
    this.disposables.push(curbGeo, curbMat, curbTex);

    // Seinät molemmin puolin, hieman piennarta ulompana.
    const gap = def.kind === 'touge' ? 1.4 : 3.4;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < last; i++) {
        const a = line[i], b = line[(i + 1) % count];
        const ax = a.x + a.rx * side * (halfW + gap);
        const az = a.z + a.rz * side * (halfW + gap);
        const bx = b.x + b.rx * side * (halfW + gap);
        const bz = b.z + b.rz * side * (halfW + gap);
        // Seina on kohdassa p + r*side*(halfW+gap), joten sisaanpain on -r*side.
        this.addWall(ax, az, bx, bz, -a.rx * side, -a.rz * side, a.y);
      }
    }
    // Avoimen radan paat suljetaan. Ilman tata sprinttiradalla ajaa suoraan
    // tien lopusta ulos ja putoaa 64 metria alas tyhjaan.
    //
    // Pelkka poikittainen muuri ei riita: reunaseinat alkavat tasan radan
    // ensimmaisesta pisteesta, ja lahtoruudusta suoraan sivulle ajava auto
    // livahti muurin karjen ja reunaseinan alkupaan valista. Siksi reunaseinia
    // jatketaan ensin taaksepain radan ulkopuolelle, ja vasta sitten tulee
    // poikittainen muuri. Mitattu: 2 karkuria 120 pakoyrityksesta -> 0.
    if (!closed) {
      const capW = halfW + gap;
      const back = 6;
      const ends = [
        { p: line[0], dir: -1 },
        { p: line[count - 1], dir: 1 }
      ];
      for (const e of ends) {
        const p = e.p;
        const ex = p.x + p.tx * e.dir * back, ez = p.z + p.tz * e.dir * back;
        for (let side = -1; side <= 1; side += 2) {
          const off = halfW + gap;
          this.addWall(
            p.x + p.rx * side * off, p.z + p.rz * side * off,
            ex + p.rx * side * off, ez + p.rz * side * off,
            -p.rx * side, -p.rz * side, p.y);
        }
        this.addWall(ex - p.rx * capW, ez - p.rz * capW, ex + p.rx * capW, ez + p.rz * capW,
          -p.tx * e.dir, -p.tz * e.dir, p.y);
      }
    }

    this.buildWallMesh(def.kind === 'touge' ? 0.85 : 1.25,
      def.kind === 'touge' ? '#c8ccd2' : (def.surface === 'snow' ? '#8f98a6' : '#83868d'));

    if (def.closed) this.buildStartLine(line[0], halfW);
  }

  buildStartLine(p, halfW) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#1a1c22';
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 16; x++) {
        if ((x + y) % 2 === 0) ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(halfW * 2, 3.2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.atan2(p.tz, p.tx) + Math.PI / 2;
    mesh.position.set(p.x, p.y + 0.03, p.z);
    this.group.add(mesh);
    this.disposables.push(geo, mat, tex);
  }

  // Normaali annetaan suoraan, ei kaannettavana lippuna. Aiemmin taman
  // paattelivat kutsujat itse, ja tien seinat saivat normaalin vaarinpain:
  // tormäys työnsi auton radalta ULOS seinan lapi. Mitattu ennen korjausta:
  // auto paatyi 39 metrin paahan keskilinjasta kun seina oli 10,9 metrissa.
  addWall(ax, az, bx, bz, inX, inZ, y = 0) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const nl = Math.hypot(inX, inZ) || 1;
    this.walls.push({ ax, az, bx, bz, nx: inX / nl, nz: inZ / nl, len, y });
  }

  buildWallMesh(height, color) {
    const pos = [], uv = [], idx = [];
    let v = 0;
    for (const w of this.walls) {
      const { ax, az, bx, bz, nx, nz, len, y } = w;
      const t = 0.28;
      const oax = ax - nx * t, oaz = az - nz * t;
      const obx = bx - nx * t, obz = bz - nz * t;
      // Sisäpinta
      pos.push(ax, y, az, bx, y, bz, ax, y + height, az, bx, y + height, bz);
      uv.push(0, 0, len / 4, 0, 0, 1, len / 4, 1);
      idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      v += 4;
      // Yläpinta
      pos.push(ax, y + height, az, bx, y + height, bz, oax, y + height, oaz, obx, y + height, obz);
      uv.push(0, 0, len / 4, 0, 0, 0.2, len / 4, 0.2);
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      v += 4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tex = toTexture(concreteTexture(5, color), 1);
    tex.repeat.set(1, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(geo, mat, tex);
  }

  buildWallGrid() {
    const size = 12;
    this.wallCell = size;
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      const x0 = Math.floor(Math.min(w.ax, w.bx) / size), x1 = Math.floor(Math.max(w.ax, w.bx) / size);
      const z0 = Math.floor(Math.min(w.az, w.bz) / size), z1 = Math.floor(Math.max(w.az, w.bz) / size);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = x + ',' + z;
          let list = this.wallGrid.get(key);
          if (!list) { list = []; this.wallGrid.set(key, list); }
          list.push(i);
        }
      }
    }
  }

  // -- rekvisiitta ---------------------------------------------------------

  buildProps() {
    const def = this.def;
    const rand = rng(def.id.length * 977 + 13);
    if (def.kind === 'lot') this.buildContainers(rand);
    if (def.props === 'industrial') this.buildBuildings(rand, false);
    if (def.props === 'winter') { this.buildBuildings(rand, true); this.buildLampPosts(rand); }
    if (def.props === 'forest') this.buildTrees(rand);
    this.buildCones(rand);
    this.buildTireStacks(rand);
  }

  buildContainers(rand) {
    const colors = ['#b3452f', '#2f6ab3', '#c9a227', '#3f8f5c', '#8d8f93'];
    const geo = new THREE.BoxGeometry(12.2, 2.6, 2.44);
    const { x, z, w, h } = this.def.lot;
    for (let i = 0; i < 26; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.75, metalness: 0.25 });
      const m = new THREE.Mesh(geo, mat);
      const side = rand();
      const px = side < 0.5 ? x + (rand() < 0.5 ? -1 : 1) * (w / 2 + 6 + rand() * 22) : x + (rand() - 0.5) * w * 1.6;
      const pz = side < 0.5 ? z + (rand() - 0.5) * h * 1.7 : z + (rand() < 0.5 ? -1 : 1) * (h / 2 + 6 + rand() * 20);
      const stack = Math.floor(rand() * 3);
      for (let s = 0; s <= stack; s++) {
        const mm = s === 0 ? m : new THREE.Mesh(geo, mat);
        mm.position.set(px, 1.3 + s * 2.62, pz);
        mm.rotation.y = Math.round(rand() * 2) * Math.PI / 2 + (rand() - 0.5) * 0.06;
        mm.castShadow = true; mm.receiveShadow = true;
        this.group.add(mm);
      }
      this.disposables.push(mat);
    }
    this.disposables.push(geo);
  }

  buildBuildings(rand, night) {
    const tex = toTexture(buildingTexture(11, night), 1);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 });
    const line = this.centerline;
    for (let i = 0; i < 34; i++) {
      const p = line[Math.floor(rand() * line.length)];
      const side = rand() < 0.5 ? -1 : 1;
      const off = this.halfWidth + 22 + rand() * 46;
      const m = new THREE.Mesh(geo, mat);
      const wdt = 12 + rand() * 22, hgt = 8 + rand() * 26, dep = 12 + rand() * 20;
      m.scale.set(wdt, hgt, dep);
      m.position.set(p.x + p.rx * side * off, hgt / 2 - 1, p.z + p.rz * side * off);
      m.rotation.y = rand() * Math.PI;
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }
    this.disposables.push(geo, mat, tex);
  }

  buildTrees(rand) {
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.2, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3925', roughness: 1 });
    const leafGeo = new THREE.ConeGeometry(2.1, 7.5, 7);
    const leafMat = new THREE.MeshStandardMaterial({ color: '#224a2c', roughness: 1 });
    const line = this.centerline;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, 300);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 300);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 300; i++) {
      const p = line[Math.floor(rand() * line.length)];
      const side = rand() < 0.5 ? -1 : 1;
      const off = this.halfWidth + 5 + rand() * 40;
      const px = p.x + p.rx * side * off;
      const pz = p.z + p.rz * side * off;
      const py = this.sample(px, pz).height;
      const s = 0.7 + rand() * 0.8;
      m4.makeTranslation(px, py + 1.6 * s, pz);
      m4.scale(new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m4);
      m4.makeTranslation(px, py + 5.6 * s, pz);
      m4.scale(new THREE.Vector3(s, s, s));
      leaves.setMatrixAt(i, m4);
    }
    trunks.castShadow = leaves.castShadow = true;
    this.group.add(trunks, leaves);
    this.disposables.push(trunkGeo, trunkMat, leafGeo, leafMat);
  }

  buildLampPosts(rand) {
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3d44', roughness: 0.7, metalness: 0.4 });
    const bulbGeo = new THREE.SphereGeometry(0.34, 8, 6);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: '#fff0c0', emissive: '#ffcf70', emissiveIntensity: 2.4, roughness: 0.4
    });
    const line = this.centerline;
    this.lamps = [];
    for (let i = 0; i < line.length; i += 14) {
      const p = line[i];
      const side = (i / 14) % 2 === 0 ? 1 : -1;
      const off = this.halfWidth + 4.2;
      const px = p.x + p.rx * side * off, pz = p.z + p.rz * side * off;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(px, p.y + 3.5, pz);
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(px, p.y + 7.0, pz);
      this.group.add(pole, bulb);
      this.lamps.push({ x: px, y: p.y + 7, z: pz });
    }
    this.disposables.push(poleGeo, poleMat, bulbGeo, bulbMat);
  }

  buildCones(rand) {
    const geo = new THREE.ConeGeometry(0.28, 0.7, 8);
    const mat = new THREE.MeshStandardMaterial({ color: '#ff6a22', roughness: 0.7 });
    const def = this.def;
    const place = [];
    if (def.kind === 'lot') {
      for (let i = 0; i < 120; i++) {
        const t = i / 120 * Math.PI * 2;
        place.push([Math.sin(t) * 52 + def.lot.x, Math.sin(t * 2) * 42 + def.lot.z]);
      }
    } else {
      const line = this.centerline;
      for (let i = 4; i < line.length; i += 9) {
        const p = line[i];
        const side = rand() < 0.5 ? -1 : 1;
        place.push([p.x + p.rx * side * (this.halfWidth - 0.9), p.z + p.rz * side * (this.halfWidth - 0.9)]);
      }
    }
    this.coneMesh = new THREE.InstancedMesh(geo, mat, place.length);
    this.coneMesh.castShadow = true;
    this.coneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < place.length; i++) {
      const [x, z] = place[i];
      const y = this.sample(x, z).height;
      this.cones.push({ x, y: y + 0.35, z, vx: 0, vy: 0, vz: 0, tilt: 0, spin: rand() * 6, base: y, moving: false });
    }
    this.syncCones();
    this.group.add(this.coneMesh);
    this.disposables.push(geo, mat);
  }

  buildTireStacks(rand) {
    const geo = new THREE.CylinderGeometry(0.62, 0.62, 0.32, 12);
    const mat = new THREE.MeshStandardMaterial({ color: '#1a1a1e', roughness: 0.95 });
    const count = this.def.kind === 'lot' ? 40 : 90;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4();
    let n = 0;
    if (this.def.kind === 'lot') {
      const { x, z, w, h } = this.def.lot;
      while (n < count) {
        const px = x + (rand() < 0.5 ? -1 : 1) * (w / 2 - 3.5);
        const pz = z + (rand() - 0.5) * h * 0.9;
        for (let s = 0; s < 3 && n < count; s++, n++) {
          m4.makeTranslation(px, 0.18 + s * 0.33, pz);
          mesh.setMatrixAt(n, m4);
        }
      }
    } else {
      const line = this.centerline;
      while (n < count) {
        const p = line[Math.floor(rand() * line.length)];
        const side = rand() < 0.5 ? -1 : 1;
        const off = this.halfWidth + (this.def.kind === 'touge' ? 1.5 : 3.5);
        const px = p.x + p.rx * side * off, pz = p.z + p.rz * side * off;
        for (let s = 0; s < 3 && n < count; s++, n++) {
          m4.makeTranslation(px, p.y + 0.18 + s * 0.33, pz);
          mesh.setMatrixAt(n, m4);
        }
      }
    }
    mesh.castShadow = true;
    this.group.add(mesh);
    this.disposables.push(geo, mat);
  }

  buildClips() {
    const def = this.def;
    const list = [];
    if (def.clips) {
      for (const c of def.clips) list.push({ x: c.x, z: c.z, r: c.r, y: 0 });
    } else if (def.clipsT) {
      const line = this.centerline;
      for (const t of def.clipsT) {
        const i = Math.min(line.length - 1, Math.round(t * line.length));
        const p = line[i];
        const prev = line[(i - 3 + line.length) % line.length];
        // Klipsipiste asetetaan kaarteen sisäpuolelle - siellä ajaminen on riskialtista.
        const turn = Math.sign(p.tx * prev.tz - p.tz * prev.tx) || 1;
        const off = this.halfWidth - 2.0;
        list.push({ x: p.x + p.rx * turn * off, z: p.z + p.rz * turn * off, r: 4.2, y: p.y });
      }
    }
    const geo = new THREE.RingGeometry(2.4, 4.2, 28);
    for (const c of list) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffc23c, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(c.x, c.y + 0.05, c.z);
      this.group.add(mesh);
      this.clips.push({ ...c, mesh, mat, hit: false, cooldown: 0 });
    }
    this.disposables.push(geo);
  }

  syncCones() {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    const e = new THREE.Euler();
    for (let i = 0; i < this.cones.length; i++) {
      const c = this.cones[i];
      pos.set(c.x, c.y, c.z);
      e.set(c.tilt, c.spin, c.tilt * 0.6);
      q.setFromEuler(e);
      m4.compose(pos, q, s);
      this.coneMesh.setMatrixAt(i, m4);
    }
    this.coneMesh.instanceMatrix.needsUpdate = true;
  }

  // -- ajonaikainen päivitys ----------------------------------------------

  update(dt, vehicle) {
    let moved = false;
    const carR = 1.5;
    for (const c of this.cones) {
      if (c.moving) {
        c.vy -= 22 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        c.spin += c.spinRate * dt;
        c.tilt = Math.min(Math.PI / 2, c.tilt + Math.abs(c.spinRate) * dt * 0.5);
        if (c.y <= c.base + 0.12) {
          c.y = c.base + 0.12;
          c.vy = 0; c.vx *= 0.6; c.vz *= 0.6;
          c.spinRate *= 0.6;
          if (Math.hypot(c.vx, c.vz) < 0.4) { c.moving = false; c.vx = c.vz = 0; }
        }
        moved = true;
        continue;
      }
      const dx = c.x - vehicle.x, dz = c.z - vehicle.z;
      if (dx * dx + dz * dz < carR * carR) {
        const s = Math.max(3, vehicle.speed);
        c.moving = true;
        c.vx = vehicle.vx * 0.55 + dx * 1.6;
        c.vz = vehicle.vz * 0.55 + dz * 1.6;
        c.vy = 2.2 + s * 0.12;
        c.spinRate = (Math.random() - 0.5) * 14;
        moved = true;
      }
    }
    if (moved) this.syncCones();

    for (const c of this.clips) {
      c.cooldown = Math.max(0, c.cooldown - dt);
      const target = c.cooldown > 0 ? 0.9 : 0.42;
      c.mat.opacity += (target - c.mat.opacity) * Math.min(1, dt * 6);
    }
  }

  // Palauttaa lähimmän klipsipisteen etäisyyden, jotta pisteytys osaa palkita läheltä ajon.
  clipProximity(x, z) {
    let best = null;
    for (const c of this.clips) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < c.r + 2.5 && (!best || d < best.d)) best = { clip: c, d };
    }
    return best;
  }

  collide(vehicle) {
    const b = vehicle.spec.body;
    const r = b.width * 0.46;
    const offsets = [-b.length * 0.3, 0, b.length * 0.3];
    const fx = Math.sin(vehicle.yaw), fz = Math.cos(vehicle.yaw);
    let worst = 0;
    for (const o of offsets) {
      const cx = vehicle.x + fx * o;
      const cz = vehicle.z + fz * o;
      const gx = Math.floor(cx / this.wallCell), gz = Math.floor(cz / this.wallCell);
      for (let ix = gx - 1; ix <= gx + 1; ix++) {
        for (let iz = gz - 1; iz <= gz + 1; iz++) {
          const list = this.wallGrid.get(ix + ',' + iz);
          if (!list) continue;
          for (const wi of list) {
            const w = this.walls[wi];
            const abx = w.bx - w.ax, abz = w.bz - w.az;
            const l2 = abx * abx + abz * abz || 1;
            let t = ((cx - w.ax) * abx + (cz - w.az) * abz) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = w.ax + abx * t, pz = w.az + abz * t;
            let dx = cx - px, dz = cz - pz;
            const d = Math.hypot(dx, dz);
            if (d >= r) continue;
            // Normaali otetaan seinästä, ei erotusvektorista: näin auto työntyy aina
            // radan puolelle vaikka se olisi ehtinyt hetkeksi seinän sisään.
            const nx = w.nx, nz = w.nz;
            const signed = dx * nx + dz * nz;
            const push = r - signed;
            if (push <= 0) continue;
            const impact = vehicle.applyImpact(nx, nz, push, 0.25);
            if (impact > worst) worst = impact;
          }
        }
      }
    }
    return worst;
  }

  // Lähtöruudukko: ensimmäinen keskilinjan piste tai kentän oma aloituskohta.
  spawnPoint() {
    const def = this.def;
    if (def.spawn) return { x: def.spawn.x, z: def.spawn.z, yaw: def.spawn.yaw };
    // Avoimella radalla lahto siirretaan hieman eteenpain: tasan ensimmaisessa
    // pisteessa auto istuu puoliksi ajopinnan reunan yli.
    const p = this.centerline[def.closed ? 0 : Math.min(4, this.centerline.length - 1)];
    return { x: p.x, z: p.z, yaw: Math.atan2(p.tx, p.tz) };
  }

  // Onko auto karannut kokonaan ruudukon ulkopuolelle? Tämä on viimeinen verkko,
  // joka estää loputtoman tyhjyyteen ajamisen jos törmäys jostain syystä pettää.
  outOfBounds(x, z) {
    const maxX = this.minX + (this.nx - 1) * CELL;
    const maxZ = this.minZ + (this.nz - 1) * CELL;
    const m = 8;
    return x < this.minX - m || x > maxX + m || z < this.minZ - m || z > maxZ + m;
  }

  // Turvallinen palautuspiste: lähin keskilinjan piste ajosuuntaan.
  respawnNear(x, z) {
    if (this.def.kind === 'lot') return this.spawnPoint();
    let best = this.centerline[0], bd = Infinity;
    for (const p of this.centerline) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return { x: best.x, z: best.z, yaw: Math.atan2(best.tx, best.tz) };
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.group.clear();
  }
}
