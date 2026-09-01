// Auton 3D-malli generoidaan koodista: korin siluetti syntyy poikkileikkausrenkaista,
// jotka yhdistetään putkeksi. Näin jokainen korimalli saa oman muotonsa ilman
// mallitiedostoja, ja väri sekä vanteet voidaan vaihtaa lennossa tallissa.
//
// Kolme asiaa tekee muodosta auton eikä laatikon: lokasuojien pullistumat akselien
// kohdalla, tumma helma korin alaosassa ja ohuet valolistat päädyissä.

import * as THREE from '../vendor/three.module.min.js';

// Pyöristetty poikkileikkaus. bottomK/topK kaventavat ala- tai yläreunaa, jolloin
// alakori jää kapeammaksi kuin helmalinja ja pyörät jäävät näkyviin.
function roundedSection(halfW, y0, y1, r, K = 24, bottomK = 1, topK = 1) {
  const h = y1 - y0;
  r = Math.min(r, halfW * 0.9, h * 0.45);
  const pts = [];
  // Vastapäivään kiertävä ääriviiva (oikea ala -> oikea ylä -> vasen ylä -> vasen ala).
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
      pts.push({ x, y, ty });
    }
  }
  return pts;
}

// Yhdistää poikkileikkaukset putkeksi. classify(a, b, i, j) palauttaa materiaali-
// ryhmän: 0 = kylki, 1 = tumma helma, 2 = katto / kansi.
function buildTube(rings, classify) {
  const pos = [];
  const groups = [[], [], []];
  const K = rings[0].pts.length;
  for (const ring of rings) {
    for (const p of ring.pts) pos.push(p.x, p.y, ring.z);
  }
  for (let s = 0; s < rings.length - 1; s++) {
    for (let i = 0; i < K; i++) {
      const j = (i + 1) % K;
      const a = s * K + i, b = s * K + j, c = (s + 1) * K + i, d = (s + 1) * K + j;
      const g = classify ? classify(rings[s], rings[s + 1], i, j) : 0;
      groups[g].push(a, b, c, b, d, c);
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
      if (end === 0) groups[0].push(centerIndex, base + j, base + i);
      else groups[0].push(centerIndex, base + i, base + j);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const index = [];
  let offset = 0;
  for (let g = 0; g < 3; g++) {
    if (!groups[g].length) continue;
    index.push(...groups[g]);
    geo.addGroup(offset, groups[g].length, g);
    offset += groups[g].length;
  }
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

const SHAPES = {
  // body: [t, leveyskerroin, helmalinjan korkeuskerroin]; t = 0 perä, 1 keula.
  // flare = lokasuojien pullistuma, sill = tumman helman yläraja helmalinjasta.
  coupe: {
    body: [[0, .82, .76], [.05, .94, .90], [.17, 1, .98], [.34, 1, 1], [.50, 1, 1], [.62, 1, .99],
      [.70, .99, .90], [.82, .98, .84], [.92, .93, .79], [.98, .85, .70], [1, .77, .62]],
    cabin: [0.18, 0.68], roof: [0.28, 0.56], cabinW: 0.86,
    flare: 0.085, sill: 0.30, wing: 'gt', light: 'slim', tail: 'bar',
    grille: { w: 0.72, h: 0.34, y: 0.42 }
  },
  sedan: {
    body: [[0, .85, .86], [.06, .96, .96], [.18, 1, 1], [.38, 1, 1], [.56, 1, 1], [.70, 1, .98],
      [.78, .99, .90], [.88, .97, .85], [.96, .90, .77], [1, .80, .65]],
    cabin: [0.20, 0.72], roof: [0.30, 0.62], cabinW: 0.88,
    flare: 0.055, sill: 0.28, wing: 'lip', light: 'slim', tail: 'split',
    grille: { w: 0.58, h: 0.40, y: 0.46 }
  },
  rear: {
    body: [[0, .90, .86], [.08, 1, .98], [.22, 1, 1], [.42, .99, 1], [.56, .97, .96],
      [.68, .95, .88], [.80, .91, .82], [.92, .85, .75], [1, .74, .64]],
    cabin: [0.24, 0.70], roof: [0.34, 0.60], cabinW: 0.86,
    flare: 0.105, sill: 0.30, wing: 'ducktail', light: 'round', tail: 'bar',
    grille: { w: 0.44, h: 0.20, y: 0.30 }
  },
  hyper: {
    body: [[0, .93, .84], [.06, 1, .95], [.18, 1, 1], [.32, 1, 1], [.46, 1, .99], [.58, 1, .95],
      [.70, .99, .87], [.82, .96, .80], [.92, .89, .72], [1, .74, .58]],
    cabin: [0.28, 0.78], roof: [0.40, 0.66], cabinW: 0.84,
    flare: 0.12, sill: 0.34, wing: 'duck', light: 'quad', tail: 'bar',
    grille: { w: 0.50, h: 0.52, y: 0.40, horseshoe: true },
    darkRoof: true
  },
  formula: { formula: true, cabin: [0.4, 0.6], roof: [0.45, 0.55], wing: 'f1' }
};

// Avopyöräisen formulan runko: kapea monokokki, sivupontonit, siivet ja halo.
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
    pts: roundedSection(hw, y0, y1, Math.min(0.09, hw * 0.5), 20)
  }));
  const tubGeo = buildTube(rings, null);
  geos.push(tubGeo);
  const tub = new THREE.Mesh(tubGeo, [paintMat, darkMat, paintMat]);
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

  add(new THREE.BoxGeometry(0.36, 0.30, 0.5), paintMat, 0, 0.80, -L / 2 + L * 0.30);
  add(new THREE.BoxGeometry(0.05, 0.30, L * 0.30), paintMat, 0, 0.66, -L / 2 + L * 0.16);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.34, 0.42, 1.55), paintMat, sx * 0.60, 0.30, -L / 2 + L * 0.40);
    add(new THREE.BoxGeometry(0.30, 0.22, 0.6), darkMat, sx * 0.60, 0.22, -L / 2 + L * 0.24);
  }
  add(new THREE.BoxGeometry(W * 0.72, 0.05, L * 0.56), darkMat, 0, 0.055, -L / 2 + L * 0.36);
  add(new THREE.BoxGeometry(W * 0.60, 0.26, 0.5), darkMat, 0, 0.16, -L / 2 + 0.28, -0.22);
  add(new THREE.BoxGeometry(W * 0.95, 0.05, 0.55), paintMat, 0, 0.11, L / 2 - 0.24, -0.09);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.04, 0.26, 0.55), darkMat, sx * W * 0.47, 0.20, L / 2 - 0.24);
  }
  add(new THREE.BoxGeometry(W * 0.52, 0.05, 0.36), paintMat, 0, 0.94, -L / 2 + 0.34, -0.30);
  add(new THREE.BoxGeometry(W * 0.50, 0.04, 0.22), paintMat, 0, 0.56, -L / 2 + 0.30, -0.2);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.03, 0.46, 0.5), darkMat, sx * W * 0.26, 0.78, -L / 2 + 0.34);
  }

  const haloGeo = new THREE.TorusGeometry(0.38, 0.032, 6, 18, Math.PI);
  geos.push(haloGeo);
  const halo = new THREE.Mesh(haloGeo, darkMat);
  halo.rotation.set(Math.PI / 2, 0, 0);
  halo.position.set(0, 0.62, -L / 2 + L * 0.47);
  shell.add(halo);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6), darkMat, 0, 0.5, -L / 2 + L * 0.47 + 0.38);

  const armGeo = new THREE.BoxGeometry(0.62, 0.035, 0.06);
  geos.push(armGeo);
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

  const matte = paint.finish === 'matte';
  const paintMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(paint.body || spec.body.color),
    metalness: matte ? 0.25 : 0.55,
    roughness: matte ? 0.62 : 0.16,
    envMapIntensity: matte ? 0.9 : 2.1
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x121722), metalness: 0.4, roughness: 0.05,
    transparent: true, opacity: 0.72, envMapIntensity: 3.0
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.62, metalness: 0.35, envMapIntensity: 0.9 });
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1b1d23, roughness: 0.34, metalness: 0.6, envMapIntensity: 1.4 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd4d9e0, metalness: 1, roughness: 0.12, envMapIntensity: 2.4 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(paint.rim || '#c8ccd4'), metalness: 0.95, roughness: 0.22, envMapIntensity: 2.2
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0f1013, roughness: 0.92, metalness: 0.02 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xdfe6f5, emissive: 0xcfe0ff, emissiveIntensity: 0.55, roughness: 0.12, metalness: 0.1
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x5c0c0c, emissive: 0xff2020, emissiveIntensity: 0.45, roughness: 0.25
  });
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0xd93a2b, roughness: 0.45, metalness: 0.3 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x7c8189, metalness: 0.95, roughness: 0.42 });

  const extraGeos = [];
  let beltline, exhausts;

  if (shape.formula) {
    const f = buildFormula(shell, spec, { paintMat, darkMat, chromeMat });
    beltline = f.beltline;
    exhausts = f.exhausts;
    extraGeos.push(...f.geos);
  } else {
    beltline = H * 0.56;
    const sillY = beltline * shape.sill;

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

    // Pyöräkotelot: akselien kohdalla kori levenee ylhäältä (lokasuojan pullistuma)
    // ja kaventuu alhaalta (kotelon aukko). Yhdessä ne muodostavat kaaren, jonka
    // sisällä rengas näkyy - ilman tätä auto on umpinainen suklaapatukka.
    const axleF = spec.cgToFront - zOff;
    const axleR = -spec.cgToRear - zOff;
    const archBump = (z) => {
      let f = 0;
      for (const a of [axleF, axleR]) {
        const d = Math.abs(z - a) / 0.78;
        if (d < 1) f = Math.max(f, Math.pow(1 - d * d, 1.3));
      }
      return f;
    };

    const bodyRings = shape.body.map(([t, wS, hS]) => {
      const z = -L / 2 + t * L;
      const bump = archBump(z);
      return {
        z,
        top: beltline * hS,
        pts: roundedSection(W / 2 * wS * (1 + shape.flare * bump), 0.15, beltline * hS,
          Math.min(0.17, W * 0.11), 24, 0.78 - 0.17 * bump, 1)
      };
    });
    // Alin kolmannes maalataan tummaksi: puskurit, helmat ja kynnykset ovat
    // oikeassakin autossa lähes aina mustaa muovia tai hiilikuitua.
    const bodyGeo = buildTube(bodyRings, (ra, rb, i, j) => {
      const ys = [ra.pts[i].y, ra.pts[j].y, rb.pts[i].y, rb.pts[j].y];
      return Math.max(...ys) < sillY ? 1 : 0;
    });
    extraGeos.push(bodyGeo);
    const body = new THREE.Mesh(bodyGeo, [paintMat, darkMat, paintMat]);
    body.castShadow = true;
    shell.add(body);

    // --- ohjaamo -----------------------------------------------------------
    const [c0, c1] = shape.cabin;
    const [r0, r1] = shape.roof;
    const cabinRings = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = c0 + (c1 - c0) * (i / steps);
      let up;
      if (t < r0) up = smoothstep((t - c0) / Math.max(0.001, r0 - c0));
      else if (t > r1) up = 1 - smoothstep((t - r1) / Math.max(0.001, c1 - r1)) * 0.94;
      else up = 1;
      const w = W / 2 * (shape.cabinW + 0.10 * up);
      const top = beltline + (H - beltline) * (0.24 + 0.76 * up);
      cabinRings.push({
        z: -L / 2 + t * L, top,
        pts: roundedSection(w, beltline - 0.02, top, 0.11, 24, 1, 0.86)
      });
    }
    // Katto korin väriin (kaksisävyisessä hiilikuituna), kyljet lasiksi.
    const roofLimit = (ring) => ring.top - (ring.top - beltline) * 0.30;
    const cabinGeo = buildTube(cabinRings, (ra, rb, i, j) => {
      const ys = [ra.pts[i].y, ra.pts[j].y, rb.pts[i].y, rb.pts[j].y];
      const lim = Math.min(roofLimit(ra), roofLimit(rb));
      const flat = Math.abs(ra.pts[i].x) < W * 0.30 && Math.abs(ra.pts[j].x) < W * 0.30;
      return (Math.min(...ys) > lim && flat) ? 2 : 0;
    });
    extraGeos.push(cabinGeo);
    const cabin = new THREE.Mesh(cabinGeo, [glassMat, darkMat, shape.darkRoof ? carbonMat : paintMat]);
    cabin.castShadow = true;
    shell.add(cabin);

    const noseW = W / 2 * shape.body[shape.body.length - 1][1];
    const tailW = W / 2 * shape.body[0][1];
    const noseTop = bodyTopAt(0.97);
    const tailTop = bodyTopAt(0.03);

    const put = (geo, mat, x, y, z, rot) => {
      extraGeos.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
      m.castShadow = true;
      shell.add(m);
      return m;
    };

    // --- valot -------------------------------------------------------------
    if (shape.light === 'quad') {
      for (const sx of [-1, 1]) for (const dx of [0.34, 0.66]) {
        put(new THREE.BoxGeometry(noseW * 0.24, 0.10, 0.07), headMat,
          sx * noseW * dx, noseTop * 0.80, L / 2 + 0.01);
      }
    } else if (shape.light === 'round') {
      for (const sx of [-1, 1]) {
        put(new THREE.SphereGeometry(0.13, 14, 10), headMat, sx * noseW * 0.56, noseTop * 0.86, L / 2 - 0.10);
      }
    } else {
      // Ohut vaakalista on nykyautojen tunnistettavin etuvalo.
      for (const sx of [-1, 1]) {
        put(new THREE.BoxGeometry(noseW * 0.70, 0.075, 0.08), headMat,
          sx * noseW * 0.42, noseTop * 0.82, L / 2 + 0.01);
      }
    }

    if (shape.tail === 'bar') {
      put(new THREE.BoxGeometry(tailW * 1.72, 0.075, 0.06), tailMat, 0, tailTop * 0.80, -L / 2 - 0.01);
    } else {
      for (const sx of [-1, 1]) {
        put(new THREE.BoxGeometry(tailW * 0.62, 0.11, 0.07), tailMat,
          sx * tailW * 0.5, tailTop * 0.78, -L / 2 - 0.01);
      }
    }

    // --- säleikkö, puskurit, helmat ----------------------------------------
    const gr = shape.grille;
    put(new THREE.BoxGeometry(noseW * gr.w * 2, gr.h * beltline, gr.horseshoe ? 0.07 : 0.06),
      darkMat, 0, beltline * gr.y, L / 2 + 0.005);
    if (gr.horseshoe) {
      // Hevosenkengän kaari kootaan kahdesta kromilistasta säleikön reunoille.
      for (const sx of [-1, 1]) {
        put(new THREE.BoxGeometry(0.09, gr.h * beltline * 1.15, 0.075), chromeMat,
          sx * noseW * gr.w, beltline * gr.y, L / 2 + 0.01);
      }
    }
    put(new THREE.BoxGeometry(noseW * 1.5, 0.13, 0.05), darkMat, 0, beltline * 0.16, L / 2 + 0.005);
    put(new THREE.BoxGeometry(noseW * 1.75, 0.035, 0.3), carbonMat, 0, 0.145, L / 2 - 0.24);
    for (const sx of [-1, 1]) {
      put(new THREE.BoxGeometry(0.06, 0.10, L * 0.42), carbonMat, sx * W * 0.44, 0.185, -zOff * 0.5);
    }
    put(new THREE.BoxGeometry(tailW * 1.6, 0.16, 0.28), carbonMat, 0, 0.20, -L / 2 + 0.09, [-0.25, 0, 0]);

    // --- siipi -------------------------------------------------------------
    const deckY = bodyTopAt(0.04);
    if (shape.wing === 'gt') {
      put(new THREE.BoxGeometry(W * 1.0, 0.05, 0.40), carbonMat, 0, deckY + 0.46, -L / 2 + 0.30, [-0.17, 0, 0]);
      for (const sx of [-1, 1]) {
        put(new THREE.BoxGeometry(0.045, 0.44, 0.15), carbonMat, sx * W * 0.33, deckY + 0.24, -L / 2 + 0.32);
      }
    } else if (shape.wing === 'duck' || shape.wing === 'ducktail') {
      put(new THREE.BoxGeometry(tailW * 1.75, 0.045, 0.28), paintMat, 0, deckY + 0.06, -L / 2 + 0.20, [-0.3, 0, 0]);
    } else if (shape.wing === 'lip') {
      put(new THREE.BoxGeometry(tailW * 1.68, 0.035, 0.18), paintMat, 0, deckY + 0.02, -L / 2 + 0.15);
    }

    // --- peilit ja pakoputket ----------------------------------------------
    for (const sx of [-1, 1]) {
      const mz = -L / 2 + L * (shape.cabin[1] - 0.05);
      put(new THREE.BoxGeometry(0.10, 0.03, 0.04), darkMat, sx * (W * 0.42), beltline + 0.07, mz);
      put(new THREE.BoxGeometry(0.15, 0.075, 0.09), paintMat, sx * (W * 0.485), beltline + 0.09, mz);
    }

    const pipeGeo = new THREE.CylinderGeometry(0.052, 0.06, 0.16, 12);
    extraGeos.push(pipeGeo);
    exhausts = [];
    const pipeX = shape.tail === 'bar' ? [0.16, 0.30] : [0.24];
    for (const sx of [-1, 1]) {
      for (const px of pipeX) {
        const p = new THREE.Mesh(pipeGeo, chromeMat);
        p.rotation.x = Math.PI / 2;
        p.position.set(sx * W * px, 0.235, -L / 2 - 0.01);
        shell.add(p);
      }
      exhausts.push(new THREE.Vector3(sx * W * pipeX[0], 0.235, -L / 2 - 0.1 + zOff));
    }
  }

  // --- pyörät --------------------------------------------------------------
  const R = spec.wheelRadius;
  const wheels = [];
  const tireW = shape.formula ? 0.38 : Math.max(0.22, W * 0.135);
  const tireGeo = new THREE.CylinderGeometry(R, R, tireW, 28);
  const rimGeo = new THREE.CylinderGeometry(R * 0.74, R * 0.74, tireW * 0.92, 24);
  const hubGeo = new THREE.CylinderGeometry(R * 0.22, R * 0.22, tireW * 0.98, 12);
  const spokeGeo = new THREE.BoxGeometry(0.038, R * 1.34, 0.055);
  const discGeo = new THREE.CylinderGeometry(R * 0.62, R * 0.62, 0.028, 20);
  const caliperGeo = new THREE.BoxGeometry(0.07, 0.20, 0.11);
  extraGeos.push(tireGeo, rimGeo, hubGeo, spokeGeo, discGeo, caliperGeo);

  // Tumma kaari kotelon reunaan: se rajaa aukon ja saa renkaan näyttämään
  // istuvan korin sisällä eikä leijuvan sen vieressä.
  if (!shape.formula) {
    const archGeo = new THREE.TorusGeometry(R * 1.16, 0.035, 6, 16, Math.PI * 0.92);
    extraGeos.push(archGeo);
    for (let i = 0; i < 4; i++) {
      const sx = i % 2 === 0 ? -1 : 1;
      const pz = i < 2 ? spec.cgToFront : -spec.cgToRear;
      const arch = new THREE.Mesh(archGeo, darkMat);
      arch.rotation.set(0, Math.PI / 2, Math.PI * 0.04);
      arch.position.set(sx * (spec.trackWidth / 2 + tireW * 0.42), R * 0.06, pz);
      group.add(arch);
    }
  }

  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    const spinner = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(hubGeo, rimMat);
    hub.rotation.z = Math.PI / 2;
    spinner.add(tire, rim, hub);
    // Kymmenen puolaa: nykyaikaisen vanteen tunnistaa tiheästä puolituksesta.
    for (let s = 0; s < 10; s++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.rotation.x = (s / 10) * Math.PI;
      spinner.add(spoke);
    }
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.z = Math.PI / 2;
    const caliper = new THREE.Mesh(caliperGeo, caliperMat);
    caliper.position.set(0, R * 0.5, 0.02);
    pivot.add(disc, caliper, spinner);
    group.add(pivot);
    wheels.push({ pivot, spinner });
  }

  group.userData = {
    paintMat, rimMat, tailMat, headMat, glassMat,
    wheels, exhausts, beltline,
    dispose() {
      for (const g of extraGeos) if (g && g.dispose) g.dispose();
      [paintMat, glassMat, darkMat, carbonMat, chromeMat, rimMat, tireMat,
        headMat, tailMat, discMat, caliperMat].forEach((m) => m.dispose());
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

  const braking = vehicle.brakeLight ? 1.9 : 0.45;
  ud.tailMat.emissiveIntensity += (braking - ud.tailMat.emissiveIntensity) * Math.min(1, dt * 14);
}
