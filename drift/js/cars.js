// Autokatalogi, viritysosat ja niistä johdettu lopullinen ajoneuvospeksi.
// Kaikki yksiköt SI: kg, m, N, Nm, rad. Kierrokset (rpm) ovat poikkeus, koska
// pelaaja lukee niitä mittarista.

export const UPGRADES = {
  engine: {
    name: 'Moottori', max: 5, base: 4200, step: 1.85,
    desc: 'Nokka-akselit, ahtopaine ja ohjainlaite. Lisää vääntöä koko alueella.'
  },
  turbo: {
    name: 'Ahdin', max: 3, base: 9000, step: 2.0,
    desc: 'Isompi turbo: enemmän huipputehoa, mutta viive alakierroksilla.'
  },
  tires: {
    name: 'Renkaat', max: 4, base: 2600, step: 1.7,
    desc: 'Pitävämpi seos. Nostaa kitkaa ja nopeuttaa lämpenemistä.'
  },
  suspension: {
    name: 'Alusta', max: 4, base: 3400, step: 1.7,
    desc: 'Coiloverit ja kallistuksenvakaajat. Terävämpi vaste ja säätövara.'
  },
  angle: {
    name: 'Kulmasarja', max: 3, base: 3000, step: 1.8,
    desc: 'Lisää maksimiohjauskulmaa. Suuremmat kulmat pysyvät hallinnassa.'
  },
  weight: {
    name: 'Kevennys', max: 3, base: 5000, step: 1.9,
    desc: 'Sisustan purku ja kevyet vanteet. Vähemmän massaa, nopeampi vaihto.'
  },
  brakes: {
    name: 'Jarrut', max: 3, base: 2800, step: 1.7,
    desc: 'Isommat levyt. Voimakkaampi jarrutus ja parempi kestävyys.'
  },
  lsd: {
    name: 'Tasauspyörästö', max: 2, base: 6500, step: 2.1,
    desc: 'Luistonesto takasillalle. Molemmat renkaat vetävät driftissä.'
  }
};

export const UPGRADE_KEYS = Object.keys(UPGRADES);

export function upgradeCost(key, level) {
  const u = UPGRADES[key];
  if (!u || level >= u.max) return null;
  return Math.round(u.base * Math.pow(u.step, level) / 100) * 100;
}

// ---------------------------------------------------------------------------

export const CARS = [
  {
    id: 'aurum',
    name: 'Aurum S550',
    tier: 'Aloittelija',
    price: 0,
    blurb: 'Neljän oven lepakko. Iso V8, pitkä akseliväli ja rauhallinen luonne - antaa anteeksi kun kulma karkaa.',
    mass: 1795, wheelbase: 2.83, trackWidth: 1.54, weightFront: 0.52, cgHeight: 0.52,
    wheelRadius: 0.325, wheelInertia: 1.8, maxSteer: 40, grip: 1.02,
    engine: { cylinders: 8, layout: 'v8cross' },
    idle: 720, redline: 7000, engineInertia: 0.28,
    torque: [[1000, 330], [2000, 440], [3800, 500], [5000, 490], [6600, 435], [7000, 398]],
    gears: [4.23, 2.51, 1.67, 1.23, 1.00, 0.83], final: 3.15,
    dragArea: 0.66, downforce: 0.07, brakeTorque: 3000,
    body: { length: 4.78, width: 1.80, height: 1.41, shape: 'sedan', color: '#1b3fa8' }
  },
  {
    id: 'sturm',
    name: 'Sturmwind GT',
    tier: 'Keskisarja',
    price: 65000,
    blurb: 'Loputon konepelti ja ohjaamo takana. Biturbo-V8 vääntää kulman auki milloin tahansa.',
    mass: 1615, wheelbase: 2.63, trackWidth: 1.68, weightFront: 0.47, cgHeight: 0.46,
    wheelRadius: 0.340, wheelInertia: 1.8, maxSteer: 40, grip: 1.10,
    engine: { cylinders: 8, layout: 'v8flat' },
    idle: 700, redline: 7000, engineInertia: 0.29,
    torque: [[1200, 420], [2100, 700], [4000, 700], [5500, 700], [6250, 662], [7000, 570]],
    gears: [3.40, 2.19, 1.63, 1.29, 1.03, 0.84, 0.67], final: 3.67,
    dragArea: 0.63, downforce: 0.22, brakeTorque: 3600,
    body: { length: 4.55, width: 1.94, height: 1.29, shape: 'coupe', color: '#c9ccd2' }
  },
  {
    id: 'falke',
    name: 'Falke 900 RS',
    tier: 'Ammattilainen',
    price: 150000,
    blurb: 'Takamoottori ja 9000 kierrosta. Heiluri elää omaa elämäänsä - vaativin ja palkitsevin auto tallissa.',
    mass: 1435, wheelbase: 2.46, trackWidth: 1.60, weightFront: 0.43, cgHeight: 0.43,
    wheelRadius: 0.345, wheelInertia: 1.6, maxSteer: 46, grip: 1.13,
    engine: { cylinders: 6, layout: 'flat6' },
    idle: 900, redline: 9000, engineInertia: 0.19,
    torque: [[2000, 320], [4000, 420], [6100, 470], [7500, 452], [8400, 436], [9000, 392]],
    gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96], final: 3.97,
    dragArea: 0.68, downforce: 0.34, brakeTorque: 4000,
    body: { length: 4.57, width: 1.85, height: 1.28, shape: 'rear', color: '#e9ebee' }
  },
  {
    id: 'apex',
    name: 'Apex F-01',
    tier: 'Kilpasarja',
    price: 380000,
    blurb: 'Avopyöräinen kilpuri. Maakiinnitys liimaa auton radalle - kulman saa auki vain hurjalla vauhdilla.',
    mass: 798, wheelbase: 3.60, trackWidth: 1.85, weightFront: 0.45, cgHeight: 0.28,
    wheelRadius: 0.360, wheelInertia: 1.3, maxSteer: 38, grip: 1.34,
    engine: { cylinders: 10, layout: 'v10' },
    idle: 4000, redline: 15000, engineInertia: 0.09,
    torque: [[4000, 340], [7000, 480], [9500, 560], [11500, 592], [13000, 570], [15000, 470]],
    gears: [3.60, 2.70, 2.15, 1.78, 1.50, 1.28, 1.08, 0.92], final: 6.90,
    dragArea: 1.30, downforce: 2.00, brakeTorque: 7000,
    body: { length: 5.60, width: 2.00, height: 0.95, shape: 'formula', color: '#101a4e' }
  },
  {
    id: 'chimera',
    name: 'Chimera W16',
    tier: 'Kilpasarja',
    price: 900000,
    blurb: 'Kaksi tonnia, kuusitoista sylinteriä, neljä ahdinta. Mitään ei voi tehdä varovasti.',
    mass: 1995, wheelbase: 2.71, trackWidth: 1.68, weightFront: 0.44, cgHeight: 0.44,
    wheelRadius: 0.360, wheelInertia: 2.1, maxSteer: 38, grip: 1.22,
    engine: { cylinders: 16, layout: 'w16' },
    idle: 800, redline: 6900, engineInertia: 0.42,
    torque: [[1500, 900], [2000, 1600], [4000, 1600], [6000, 1600], [6700, 1600], [6900, 1450]],
    gears: [2.77, 1.80, 1.29, 0.97, 0.77, 0.63, 0.51], final: 4.35,
    dragArea: 0.72, downforce: 0.55, brakeTorque: 5200,
    body: { length: 4.54, width: 2.04, height: 1.21, shape: 'hyper', color: '#2b7fd4' }
  }
];

export const CAR_BY_ID = Object.fromEntries(CARS.map((c) => [c.id, c]));

export function defaultTune(car) {
  return {
    steerAngle: car.maxSteer,
    brakeBalance: 0.62,
    rollBalance: 0.52,
    finalDrive: 1.0,
    lsdLock: 0.55,
    camber: 1.5,
    rideHeight: 0.5,
    powerLimit: 1.0,
    tcs: false,
    abs: false
  };
}

export function defaultUpgrades() {
  return { engine: 0, turbo: 0, tires: 0, suspension: 0, angle: 0, weight: 0, brakes: 0, lsd: 0 };
}

function lerp(a, b, t) { return a + (b - a) * t; }

// Vääntökäyrä lineaarisesti interpoloituna. Käyrän ulkopuolella pidetään reunan arvo,
// jotta tyhjäkäynnillä tai rajoittimella ei tule negatiivista vääntöä.
export function torqueAt(curve, rpm) {
  if (rpm <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (rpm >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [r0, t0] = curve[i - 1];
      const [r1, t1] = curve[i];
      return lerp(t0, t1, (rpm - r0) / (r1 - r0));
    }
  }
  return last[1];
}

// Katalogiauto + ostetut osat + säädöt -> yksi litteä speksi, jota fysiikka käyttää.
export function buildSpec(carId, upgrades = defaultUpgrades(), tune = null) {
  const car = CAR_BY_ID[carId] || CARS[0];
  const up = { ...defaultUpgrades(), ...upgrades };
  const t = { ...defaultTune(car), ...(tune || {}) };

  const powerMul = (1 + 0.125 * up.engine) * (1 + 0.11 * up.turbo);
  const mass = car.mass * (1 - 0.042 * up.weight);
  const maxSteer = car.maxSteer + 6 * up.angle;
  const grip = car.grip + 0.045 * up.tires;
  const L = car.wheelbase;

  // Ahdin siirtää väännön ylemmäs: alakierrokset laihtuvat, yläpää lihoaa.
  const boostShape = up.turbo > 0
    ? (rpm) => {
      const spool = 2200 + 500 * up.turbo;
      const x = Math.min(1, Math.max(0, (rpm - 900) / (spool - 900)));
      return lerp(1 - 0.09 * up.turbo, 1 + 0.05 * up.turbo, x * x);
    }
    : null;

  const curve = car.torque.map(([rpm, nm]) => [rpm, nm * powerMul * (boostShape ? boostShape(rpm) : 1)]);

  const steer = Math.min(t.steerAngle, maxSteer);

  return {
    id: car.id,
    name: car.name,
    body: car.body,
    mass,
    // Suorakulmaisen levyn hitausmomentti pystyakselin ympäri, kerroin 0.85 koska massa
    // (moottori, kuljettaja) on todellisuudessa lähempänä keskiötä kuin tasaisesti jakautunut.
    inertia: 0.85 * mass * (car.body.length * car.body.length + car.body.width * car.body.width) / 12,
    wheelbase: L,
    trackWidth: car.trackWidth,
    cgToFront: (1 - car.weightFront) * L,
    cgToRear: car.weightFront * L,
    cgHeight: car.cgHeight * (0.94 + 0.12 * t.rideHeight),
    wheelRadius: car.wheelRadius,
    wheelInertia: car.wheelInertia * (1 - 0.06 * up.weight),
    maxSteer: steer * Math.PI / 180,
    maxSteerDeg: steer,
    angleKitMax: maxSteer,
    gripFront: grip * (1 + 0.012 * (t.camber - 1.5)),
    // Takarenkaat ovat driftiautoissa tarkoituksella kovempaa seosta: pito irtoaa
    // ennustettavasti ja kulman pitäminen ei vaadi kohtuutonta tehoa.
    gripRear: grip * 0.94 * (1 - 0.008 * (t.camber - 1.5)),
    rollBalance: t.rollBalance,
    // Alustapaketti terävöittää vastetta: jäykempi jousitus siirtää kuormaa nopeammin.
    loadTransferRate: 9 + 2.6 * up.suspension,
    idle: car.idle,
    redline: car.redline,
    engineInertia: car.engineInertia,
    // Äänisynteesi tarvitsee sylinterimäärän sytytystaajuuteen ja layoutin
    // harmoniseen sisältöön. Viritysosat eivät muuta moottorin luonnetta.
    engine: car.engine || { cylinders: 8, layout: 'v8cross' },
    torqueCurve: curve,
    powerLimit: t.powerLimit,
    gears: car.gears,
    finalDrive: car.final * t.finalDrive,
    // Vakiona takasillassa on driftikäyttöön riittävä luistonesto; osilla siitä saa lukon.
    lsdLock: up.lsd > 0 ? Math.min(t.lsdLock + 0.22 * up.lsd, 0.95) : Math.min(t.lsdLock, 0.55),
    dragArea: car.dragArea,
    downforce: car.downforce,
    brakeTorque: car.brakeTorque * (1 + 0.16 * up.brakes),
    brakeBalance: t.brakeBalance,
    tcs: t.tcs,
    abs: t.abs,
    peakPowerHp: peakPower(curve),
    upgrades: up,
    tune: t
  };
}

export function peakPower(curve) {
  let best = 0;
  for (let rpm = 1000; rpm <= curve[curve.length - 1][0]; rpm += 100) {
    const nm = torqueAt(curve, rpm);
    const kw = nm * rpm * 2 * Math.PI / 60 / 1000;
    if (kw > best) best = kw;
  }
  return Math.round(best * 1.341);
}

// Tallin tähtipalkit: 0..1 kullekin ominaisuudelle.
export function specStars(spec) {
  const powerToWeight = spec.peakPowerHp / (spec.mass / 1000);
  return {
    teho: Math.min(1, powerToWeight / 750),
    pito: Math.min(1, Math.max(0, (spec.gripFront - 0.94) / 0.42)),
    kulma: Math.min(1, (spec.maxSteerDeg - 35) / 35),
    keveys: Math.min(1, Math.max(0, (2100 - spec.mass) / 1300)),
    tasapaino: Math.min(1, 1 - Math.abs(spec.cgToRear / spec.wheelbase - 0.5) * 3.4)
  };
}
