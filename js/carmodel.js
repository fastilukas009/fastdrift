// Auton 3D-malli generoidaan koodista: korin siluetti syntyy poikkileikkausrenkaista,
// jotka yhdistetään putkeksi. Näin jokainen korimalli saa oman muotonsa ilman
// mallitiedostoja, ja väri sekä vanteet voidaan vaihtaa lennossa tallissa.

import * as THREE from '../vendor/three.module.min.js';

// Pyöristetty suorakaide poikkileikkaukseksi. Palauttaa pisteet ja tiedon siitä,
// mitkä niistä muodostavat katon - kattopinnat maalataan korin väriin, kyljet lasiksi.
// bottomK/topK kaventavat leikkausta ala- tai yläreunasta. Alakori on kapeampi
// helmalinjasta (jolloin pyörät näkyvät) ja ohjaamo kapenee kattoa kohti.
function roundedSection(halfW, y0, y1, r, K = 22, bottomK = 1, topK = 1) {
  const h = y1 - y0;
  r = Math.min(r, halfW * 0.9, h * 0.45);
  const pts = [];
  // Vastapäivään kiertävä ääriviiva (oikea alanurkka -> oikea ylä -> vasen ylä -> vasen ala).
  // Kiertosuunta ratkaisee putken pintojen suunnan, joten sitä ei saa vaihtaa.
  const cx = [halfW - r, halfW - r, -(halfW - r), -(halfW - r)];
  const cy = [y0 + r, y1 - r, y1 - r, y0 + r];
  const a0 = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  const per = Math.max(3, Math.round(K / 4));
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < per; i++) {
      const a = a0[c] + (i / per) * (Math.PI / 2);
      let x = cx[c] + Math.cos(a) * r;
      const y = cy[c] + Math.sin(a) * r;
      const ty = h > 1e-4 ? (y - y0) / h : 0;
      x *= bottomK + (topK - bottomK) * ty;
      pts.push({ x, y, top: y > y1 - r * 0.6 && Math.abs(x) < halfW * topK - r * 0.3 });
    }
  }
  return pts;
}

// Yhdistää poikkileikkaukset putkeksi. Ryhmä 0 = kori/lasi, ryhmä 1 = katto.
function buildTube(rings) {
  const pos = [], norm = [], idxA = [], idxB = [];
  const K = rings[0].pts.length;
  for (const ring of rings) {
    for (const p of ring.pts) pos.push(p.x, p.y, ring.z);
  }
  for (let s = 0; s < rings.length - 1; s++) {
    for (let i = 0; i < K; i++) {
      const j = (i + 1) % K;
      const a = s * K + i, b = s * K + j, c = (s + 1) * K + i, d = (s + 1) * K + j;
      const isRoof = rings[s].pts[i].top && rings[s].pts[j].top
        && rings[s + 1].pts[i].top && rings[s + 1].pts[j].top;
      const target = isRoof ? idxB : idxA;
      target.push(a, b, c, b, d, c);
    }
  }
  // Päätykannet, jotta kori ei ole ontto putki.
  for (const end of [0, rings.length - 1]) {
    const base = end * K;
    const centerIndex = pos.length / 3;
    let cxx = 0, cyy = 0;
    for (const p of rings[end].pts) { cxx += p.x; cyy += p.y; }
    pos.push(cxx / K, cyy / K, rings[end].z);
    for (let i = 0; i < K; i++) {
      const j = (i + 1) % K;
      if (end === 0) idxA.push(centerIndex, base + j, base + i);
      else idxA.push(centerIndex, base + i, base + j);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex([...idxA, ...idxB]);
  geo.addGroup(0, idxA.length, 0);
  if (idxB.length) geo.addGroup(idxA.length, idxB.length, 1);
  geo.computeVertexNormals();
  return geo;
}

const SHAPES = {
  // [t, leveyskerroin, korkeuskerroin]; t = 0 perä, 1 keula
  // Profiilit: [t, leveyskerroin, helmalinjan korkeuskerroin]. Konepellin kohdalla
  // korkeus laskee selvästi - juuri se erottaa auton siluetin leivästä.
  coupe: {
    body: [[0, .82, .76], [.05, .94, .90], [.17, 1, .98], [.34, 1, 1], [.50, 1, 1], [.62, 1, .99],
      [.70, .99, .90], [.82, .98, .84], [.92, .93, .79], [.98, .85, .70], [1, .77, .62]],
    cabin: [0.20, 0.66], roof: [0.34, 0.52], wing: 'lip'
  },
  hatch: {
    body: [[0, .86, .94], [.07, .97, 1], [.22, 1, 1], [.44, 1, 1], [.58, 1, .99],
      [.68, .99, .89], [.80, .98, .83], [.92, .92, .78], [1, .80, .66]],
    cabin: [0.14, 0.62], roof: [0.26, 0.5], wing: 'none'
  },
  muscle: {
    body: [[0, .88, .82], [.05, .98, .94], [.16, 1, 1], [.34, 1, 1], [.52, 1, 1], [.62, 1, .98],
      [.70, 1, .89], [.84, .99, .85], [.94, .93, .78], [1, .83, .66]],
    cabin: [0.24, 0.62], roof: [0.36, 0.55], wing: 'duck'
  },
  sedan: {
    body: [[0, .85, .86], [.06, .96, .96], [.18, 1, 1], [.38, 1, 1], [.56, 1, 1], [.70, 1, .98],
      [.78, .99, .90], [.88, .97, .85], [.96, .90, .77], [1, .80, .65]],
    cabin: [0.22, 0.70], roof: [0.36, 0.58], wing: 'lip'
  },
  rear: {
    body: [[0, .90, .86], [.08, 1, .98], [.22, 1, 1], [.42, .99, 1], [.56, .97, .96],
      [.68, .95, .88], [.80, .91, .82], [.92, .85, .75], [1, .74, .64]],
    cabin: [0.26, 0.68], roof: [0.4, 0.56], wing: 'ducktail'
  },
  race: {
    body: [[0, .94, .78], [.05, 1, .90], [.17, 1, .98], [.34, 1, 1], [.52, 1, 1], [.62, 1, .97],
      [.70, 1, .87], [.84, .99, .81], [.94, .92, .74], [1, .79, .58]],
    cabin: [0.22, 0.64], roof: [0.34, 0.52], wing: 'gt'
  },
  // Hyperauto: leveä, matala ja ohjaamo työnnettynä eteen.
  hyper: {
    body: [[0, .93, .84], [.06, 1, .95], [.18, 1, 1], [.32, 1, 1], [.46, 1, .99], [.58, 1, .95],
      [.70, .99, .87], [.82, .96, .80], [.92, .89, .72], [1, .74, .58]],
    cabin: [0.32, 0.76], roof: [0.44, 0.62], wing: 'duck'
  },
  formula: { formula: true, cabin: [0.4, 0.6], roof: [0.45, 0.55], wing: 'f1' }
};

// Avopyöräisen formulan runko: kapea monokokki, sivupontonit, siivet ja halo.
// Pyörät jäävät kokonaan korin ulkopuolelle, kuten oikeassakin autossa.
function buildFormula(shell, spec, mats) {
  const L = spec.body.length, W = spec.body.width;
  const { paintMat, darkMat, chromeMat } = mats;
  const geos = [];

  const profile = [
    [0, .30, .10, .42], [.12, .34, .09, .60], [.26, .40, .08, .72], [.38, .42, .08, .62],
    [.50, .44, .06, .48], [.62, .40, .06, .44], [.74, .30, .06, .36], [.86, .20, .08, .28],
    [.95, .13, .10, .22], [1, .09, .11, .19]
  ];
  const rings = profile.map(([t, hw, y0, y1]) => ({
    z: -L / 2 + t * L,
    pts: roundedSection(hw, y0, y1, Math.min(0.09, hw * 0.5), 18)
  }));
  const tubGeo = buildTube(rings);
  geos.push(tubGeo);
  const tub = new THREE.Mesh(tubGeo, [paintMat, paintMat]);
  tub.castShadow = true;
  shell.add(tub);

  const add = (geo, mat, x, y, z, rx = 0) => {
    geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    shell.add(m);
    return m;
  };

  // Ilmanottolaatikko ja moottorikate.
  add(new THREE.BoxGeometry(0.36, 0.30, 0.5), paintMat, 0, 0.80, -L / 2 + L * 0.30);
  add(new THREE.BoxGeometry(0.05, 0.30, L * 0.30), paintMat, 0, 0.66, -L / 2 + L * 0.16);

  // Sivupontonit.
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.34, 0.42, 1.55), paintMat, sx * 0.60, 0.30, -L / 2 + L * 0.40);
    add(new THREE.BoxGeometry(0.30, 0.22, 0.6), darkMat, sx * 0.60, 0.22, -L / 2 + L * 0.24);
  }

  // Pohjalevy ja diffuusori.
  add(new THREE.BoxGeometry(W * 0.72, 0.05, L * 0.56), darkMat, 0, 0.055, -L / 2 + L * 0.36);
  add(new THREE.BoxGeometry(W * 0.60, 0.26, 0.5), darkMat, 0, 0.16, -L / 2 + 0.28, -0.22);

  // Etusiipi kahdella päätylevyllä.
  add(new THREE.BoxGeometry(W * 0.95, 0.05, 0.55), paintMat, 0, 0.11, L / 2 - 0.24, -0.09);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.04, 0.26, 0.55), darkMat, sx * W * 0.47, 0.20, L / 2 - 0.24);
  }

  // Takasiipi.
  add(new THREE.BoxGeometry(W * 0.52, 0.05, 0.36), paintMat, 0, 0.94, -L / 2 + 0.34, -0.30);
  add(new THREE.BoxGeometry(W * 0.50, 0.04, 0.22), paintMat, 0, 0.56, -L / 2 + 0.30, -0.2);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.03, 0.46, 0.5), darkMat, sx * W * 0.26, 0.78, -L / 2 + 0.34);
  }

  // Halo ohjaamon ympärillä.
  const haloGeo = new THREE.TorusGeometry(0.38, 0.032, 6, 18, Math.PI);
  geos.push(haloGeo);
  const halo = new THREE.Mesh(haloGeo, darkMat);
  halo.rotation.set(Math.PI / 2, 0, 0);
  halo.position.set(0, 0.62, -L / 2 + L * 0.47);
  shell.add(halo);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6), darkMat, 0, 0.5, -L / 2 + L * 0.47 + 0.38);

  // Tukivarret pyörille - avopyöräisen tunnusmerkki.
  const armGeo = new THREE.BoxGeometry(0.62, 0.035, 0.06);
  for (const sz of [spec.cgToFront, -spec.cgToRear]) {
    for (const sx of [-1, 1]) {
      for (const dy of [0.20, 0.40]) {
        const arm = new THREE.Mesh(armGeo, chromeMat);
        arm.position.set(sx * 0.62, dy, sz - shell.position.z);
        arm.rotation.z = sx * (dy > 0.3 ? -0.06 : 0.06);
        shell.add(arm);
      }
    }
  }
  geos.push(armGeo);

  return { beltline: 0.5, exhausts: [new THREE.Vector3(0, 0.5, -L / 2 - 0.05)], geos };
}

export function buildCar(spec, paint = {}) {
  const shape = SHAPES[spec.body.shape] || SHAPES.coupe;
  const L = spec.body.length, W = spec.body.width, H = spec.body.height;
  const group = new THREE.Group();
  // Kori mallinnetaan painopisteen ympärille, mutta oikeassa autossa takaylitys on
  // etuylitystä pidempi. Siirretään koria akseleihin nähden, jotta pyörät istuvat
  // oikeille kohdille siluettia.
  const k = 0.86;
  const zOff = (k * (L / 2 - spec.cgToRear) - (L / 2 - spec.cgToFront)) / (1 + k);
  const shell = new THREE.Group();
  shell.position.z = zOff;
  group.add(shell);

  const paintMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(paint.body || spec.body.color),
    metalness: paint.finish === 'matte' ? 0.15 : 0.72,
    roughness: paint.finish === 'matte' ? 0.72 : 0.24,
    envMapIntensity: 1.15
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x0d1016), metalness: 0.55, roughness: 0.08,
    transparent: true, opacity: 0.85, envMapIntensity: 1.6
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.85, metalness: 0.2 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.95, roughness: 0.18 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(paint.rim || '#c8ccd4'), metalness: 0.9, roughness: 0.28
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x131317, roughness: 0.95, metalness: 0.02 });

  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfdf6dc, emissive: 0xfff0b8, emissiveIntensity: 1.6, roughness: 0.25
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x8c1414, emissive: 0xff2020, emissiveIntensity: 1.0, roughness: 0.35
  });

  const extraGeos = [];
  let beltline, exhausts;

  if (shape.formula) {
    const f = buildFormula(shell, spec, { paintMat, darkMat, chromeMat });
    beltline = f.beltline;
    exhausts = f.exhausts;
    extraGeos.push(...f.geos);
  } else {
    // --- kori --------------------------------------------------------------
    beltline = H * 0.56;
    const bodyTopAt = (t) => {
      const b = shape.body;
      for (let i = 1; i < b.length; i++) {
        if (t <= b[i][0]) {
          const q = (t - b[i - 1][0]) / (b[i][0] - b[i - 1][0] || 1);
          return beltline * (b[i - 1][2] + (b[i][2] - b[i - 1][2]) * q);
        }
      }
      return beltline * b[b.length - 1][2];
    };
    const bodyRings = shape.body.map(([t, wS, hS]) => ({
      z: -L / 2 + t * L,
      pts: roundedSection(W / 2 * wS, 0.16, beltline * hS, Math.min(0.15, W * 0.095), 22, 0.84, 1)
    }));
    const bodyGeo = buildTube(bodyRings);
    extraGeos.push(bodyGeo);
    const body = new THREE.Mesh(bodyGeo, [paintMat, paintMat]);
    body.castShadow = true;
    shell.add(body);

    // --- ohjaamo -----------------------------------------------------------
    const [c0, c1] = shape.cabin;
    const [r0, r1] = shape.roof;
    const cabinRings = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = c0 + (c1 - c0) * (i / steps);
      // Katon korkeus nousee tuulilasin kohdalla ja laskee takaikkunaa kohti.
      let up;
      if (t < r0) up = smoothstep((t - c0) / Math.max(0.001, r0 - c0));
      else if (t > r1) up = 1 - smoothstep((t - r1) / Math.max(0.001, c1 - r1)) * 0.94;
      else up = 1;
      const w = W / 2 * (0.86 + 0.10 * up);
      const top = beltline + (H - beltline) * (0.14 + 0.86 * up);
      cabinRings.push({ z: -L / 2 + t * L, pts: roundedSection(w, beltline - 0.02, top, 0.12, 22, 1, 0.87) });
    }
    const cabinGeo = buildTube(cabinRings);
    extraGeos.push(cabinGeo);
    const cabin = new THREE.Mesh(cabinGeo, [glassMat, paintMat]);
    cabin.castShadow = true;
    shell.add(cabin);

    // --- valot -------------------------------------------------------------
    // Valot upotetaan korin pintaan: leveys ja korkeus otetaan siitä kohtaa siluettia,
    // jossa ne sijaitsevat, jotta ne eivät jää leijumaan puskurin ulkopuolelle.
    const noseW = W / 2 * shape.body[shape.body.length - 1][1];
    const tailW = W / 2 * shape.body[0][1];
    const lampGeo = new THREE.BoxGeometry(noseW * 0.52, 0.12, 0.09);
    const tailGeo = new THREE.BoxGeometry(tailW * 0.5, 0.13, 0.08);
    extraGeos.push(lampGeo, tailGeo);
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(lampGeo, headMat);
      hl.position.set(sx * noseW * 0.48, bodyTopAt(0.97) * 0.78, L / 2 + 0.01);
      shell.add(hl);
      const tl = new THREE.Mesh(tailGeo, tailMat);
      tl.position.set(sx * tailW * 0.48, bodyTopAt(0.03) * 0.78, -L / 2 - 0.01);
      shell.add(tl);
    }
    // Musta säleikkö keulan alaosaan antaa siluetille ryhtiä.
    const grillGeo = new THREE.BoxGeometry(noseW * 1.25, 0.15, 0.06);
    extraGeos.push(grillGeo);
    const grill = new THREE.Mesh(grillGeo, darkMat);
    grill.position.set(0, 0.30, L / 2 + 0.005);
    shell.add(grill);

    // --- lisäosat ----------------------------------------------------------
    const splitterGeo = new THREE.BoxGeometry(noseW * 1.85, 0.04, 0.3);
    extraGeos.push(splitterGeo);
    const splitter = new THREE.Mesh(splitterGeo, darkMat);
    splitter.position.set(0, 0.175, L / 2 - 0.22);
    shell.add(splitter);

    const deckY = bodyTopAt(0.04);
    if (shape.wing === 'gt') {
      const wingGeo = new THREE.BoxGeometry(W * 1.02, 0.06, 0.42);
      const stayGeo = new THREE.BoxGeometry(0.05, 0.55, 0.16);
      extraGeos.push(wingGeo, stayGeo);
      const wing = new THREE.Mesh(wingGeo, darkMat);
      wing.position.set(0, deckY + 0.58, -L / 2 + 0.24);
      wing.rotation.x = -0.16;
      shell.add(wing);
      for (const sx of [-1, 1]) {
        const stay = new THREE.Mesh(stayGeo, darkMat);
        stay.position.set(sx * W * 0.34, deckY + 0.3, -L / 2 + 0.26);
        shell.add(stay);
      }
    } else if (shape.wing === 'duck' || shape.wing === 'ducktail') {
      const lipGeo = new THREE.BoxGeometry(tailW * 1.8, 0.05, 0.3);
      extraGeos.push(lipGeo);
      const lip = new THREE.Mesh(lipGeo, paintMat);
      lip.position.set(0, deckY + 0.06, -L / 2 + 0.19);
      lip.rotation.x = -0.3;
      shell.add(lip);
    } else if (shape.wing === 'lip') {
      const lipGeo = new THREE.BoxGeometry(tailW * 1.72, 0.04, 0.2);
      extraGeos.push(lipGeo);
      const lip = new THREE.Mesh(lipGeo, paintMat);
      lip.position.set(0, deckY + 0.02, -L / 2 + 0.14);
      shell.add(lip);
    }

    // Peilit ja pakoputket.
    const mirrorGeo = new THREE.BoxGeometry(0.15, 0.08, 0.1);
    extraGeos.push(mirrorGeo);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(mirrorGeo, paintMat);
      m.position.set(sx * (W * 0.45), beltline + 0.09, -L / 2 + L * (shape.cabin[1] - 0.04));
      shell.add(m);
    }
    const pipeGeo = new THREE.CylinderGeometry(0.055, 0.062, 0.18, 10);
    extraGeos.push(pipeGeo);
    exhausts = [];
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(pipeGeo, chromeMat);
      p.rotation.x = Math.PI / 2;
      p.position.set(sx * W * 0.24, 0.24, -L / 2 - 0.02);
      shell.add(p);
      exhausts.push(new THREE.Vector3(sx * W * 0.24, 0.24, -L / 2 - 0.1 + zOff));
    }
  }

  // --- pyörät --------------------------------------------------------------
  const R = spec.wheelRadius;
  const wheels = [];
  const tireW = shape.formula ? 0.38 : Math.max(0.22, W * 0.135);
  const tireGeo = new THREE.CylinderGeometry(R, R, tireW, 22);
  const rimGeo = new THREE.CylinderGeometry(R * 0.66, R * 0.66, tireW * 1.03, 16);
  const spokeGeo = new THREE.BoxGeometry(0.055, R * 1.2, 0.06);
  const discGeo = new THREE.CylinderGeometry(R * 0.58, R * 0.58, 0.03, 16);
  const discMat = new THREE.MeshStandardMaterial({ color: 0x6a6d74, metalness: 0.9, roughness: 0.5 });

  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    const spinner = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2;
    spinner.add(tire, rim);
    for (let s = 0; s < 5; s++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.rotation.x = (s / 5) * Math.PI;
      spinner.add(spoke);
    }
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.z = Math.PI / 2;
    pivot.add(disc);
    pivot.add(spinner);
    group.add(pivot);
    wheels.push({ pivot, spinner });
  }

  group.userData = {
    paintMat, rimMat, tailMat, headMat, glassMat,
    wheels, exhausts, beltline,
    dispose() {
      [...extraGeos, tireGeo, rimGeo, spokeGeo, discGeo].forEach((g) => g.dispose());
      [paintMat, glassMat, darkMat, chromeMat, rimMat, tireMat, headMat, tailMat, discMat].forEach((m) => m.dispose());
    }
  };
  return group;
}

function smoothstep(x) {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}

// Kytkee auton mallin fysiikan tilaan: pyörien paikat, ohjauskulma, pyörintä ja korin kallistus.
export function syncCarModel(model, vehicle, dt) {
  const spec = vehicle.spec;
  const ud = model.userData;
  model.position.set(vehicle.x, vehicle.y, vehicle.z);
  model.rotation.set(vehicle.pitch, vehicle.yaw, vehicle.roll);

  for (let i = 0; i < 4; i++) {
    const w = vehicle.wheels[i];
    const m = ud.wheels[i];
    // Jousen puristus näkyy pyörän pystysuuntaisena liikkeenä koriin nähden.
    const travel = (1 - w.compression) * 0.06;
    m.pivot.position.set(w.px, spec.wheelRadius + travel, w.pz);
    m.pivot.rotation.y = w.steer;
    m.spinner.rotation.x = w.spin;
  }

  const braking = vehicle.brakeLight ? 2.6 : 1.0;
  ud.tailMat.emissiveIntensity += (braking - ud.tailMat.emissiveIntensity) * Math.min(1, dt * 14);
}
