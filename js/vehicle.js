// Ajoneuvofysiikka: nelipyöräinen jäykkä kappale tasossa, rengasmalli yhdistetylle
// luistolle, kuormansiirto, voimansiirto ja luistonestollinen tasauspyörästö.
//
// Koordinaatisto: Y = ylös, Z = auton etusuunta, X = sivuttaisakseli. yaw kiertää
// Y-akselin ympäri oikeakätisesti, joten etusuunta maailmassa on (sin yaw, cos yaw).
// HUOM: oikeakätisessä kehyksessä paikallinen +X on auton VASEMMALLA. Fysiikka on
// peilisymmetrinen ja sisäisesti johdonmukainen, joten pelaajan ohjaus käännetään
// kerran step():ssä - älä kumoa sitä ilman että käyt koko kehyksen läpi.

import { torqueAt } from './cars.js';

const G = 9.81;
const AIR = 1.225;

// Rengaskäyrän huippuluisto. Pitkittäissuunnassa rengas saavuttaa maksimin pienemmällä
// luistolla kuin sivuttain - siksi erilliset normalisoinnit.
const PEAK_LONG = 0.13;
const PEAK_LAT = 0.21;
// tail = kuinka paljon pidosta jää jäljelle täysin saturoituneella renkaalla. Tämä luku
// ratkaisee luiston hallittavuuden: matala = auto lähtee lapasesta, korkea = ei liu'u.
function tireCurve(s, tail) {
  if (s <= 1e-4) return 0;
  if (s <= 1) return Math.sin(Math.PI * 0.5 * s);
  return tail + (1 - tail) * Math.exp(-(s - 1) * 0.85);
}

// Kaksi rengassarjaa. Driftirenkaissa taka on tarkoituksella pehmeämpi ja luistaa
// ennustettavasti; kisarenkaissa taka pitää enemmän kuin etu, jolloin auto on vakaa
// eikä yliohjaa - silloin ajetaan kierrosaikaa, ei kulmaa.
export const TIRE_SETS = {
  drift: { name: 'DRIFT', front: 1.00, rear: 1.00, tail: 0.74, peakLat: 0.21 },
  grip: { name: 'PITO', front: 1.10, rear: 1.22, tail: 0.88, peakLat: 0.17 }
};

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

export const WHEEL_FL = 0, WHEEL_FR = 1, WHEEL_RL = 2, WHEEL_RR = 3;

class Wheel {
  constructor(px, pz, front) {
    this.px = px; this.pz = pz; this.front = front;
    this.steer = 0;
    this.omega = 0;
    this.load = 3000;
    this.fx = 0; this.fy = 0;
    this.slipRatio = 0;
    this.slipAngle = 0;
    this.slipSpeed = 0;      // liukuman nopeus m/s - savun ja äänen lähde
    this.saturation = 0;     // 1 = renkaan pidon huippu, yli sen liu'utaan
    this.grip = 1;           // alustan kitkakerroin renkaan alla
    this.spin = 0;           // visuaalinen pyörimiskulma
    this.compression = 0.5;  // jousen puristus 0..1
    this.onRoad = true;
  }
}

export class Vehicle {
  constructor(spec) {
    this.setSpec(spec);
    this.reset(0, 0, 0);
  }

  setSpec(spec) {
    this.spec = spec;
    const halfTrack = spec.trackWidth * 0.5;
    this.wheels = [
      new Wheel(-halfTrack, spec.cgToFront, true),
      new Wheel(halfTrack, spec.cgToFront, true),
      new Wheel(-halfTrack, -spec.cgToRear, false),
      new Wheel(halfTrack, -spec.cgToRear, false)
    ];
  }

  reset(x, z, yaw) {
    this.x = x; this.z = z; this.y = 0;
    this.vx = 0; this.vz = 0;
    this.yaw = yaw; this.yawRate = 0;
    this.steerAngle = 0;
    this.gear = 1;
    this.rpm = this.spec.idle;
    this.clutch = 0;
    this.prevClutch = 0;
    this.shiftTimer = 0;
    this.limiterTimer = 0;
    this.backfire = 0;
    this.accelLong = 0; this.accelLat = 0;
    this.pitch = 0; this.roll = 0;
    this.damage = 0;
    this.tireMode = this.tireMode || 'drift';
    this.lastImpact = 0;
    this.frameImpact = 0;
    this.airTime = 0;
    for (const w of this.wheels) { w.omega = 0; w.spin = 0; w.fx = 0; w.fy = 0; w.slipSpeed = 0; }
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get speedKmh() { return this.speed * 3.6; }
  get forwardX() { return Math.sin(this.yaw); }
  get forwardZ() { return Math.cos(this.yaw); }

  // Sivuluistokulma: kulma auton nokan ja todellisen kulkusuunnan välillä.
  get sideSlip() {
    const s = this.speed;
    if (s < 1.2) return 0;
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    const lat = this.vx * c - this.vz * sn;
    const lon = this.vx * sn + this.vz * c;
    return Math.atan2(lat, Math.abs(lon));
  }

  get driveRatio() {
    const g = this.gear;
    if (g === 0) return 0;
    if (g < 0) return -3.35 * this.spec.finalDrive;
    return this.spec.gears[g - 1] * this.spec.finalDrive;
  }

  shiftUp() {
    if (this.gear < this.spec.gears.length && this.shiftTimer <= 0) {
      this.gear = this.gear <= 0 ? 1 : this.gear + 1;
      this.shiftTimer = 0.16;
    }
  }

  shiftDown() {
    if (this.shiftTimer > 0) return;
    if (this.gear > 1) { this.gear--; this.shiftTimer = 0.13; }
    else if (this.gear === 1 && this.speed < 3) { this.gear = -1; this.shiftTimer = 0.2; }
    else if (this.gear === 0) { this.gear = -1; }
  }

  update(dt, input, world) {
    // Alle 4 ms:n askel pitää rengasmallin vakaana myös 30 fps:llä.
    const steps = Math.max(1, Math.min(8, Math.ceil(dt / 0.004)));
    const h = dt / steps;
    // Törmäys tarkistetaan jokaisen aliaskeleen jälkeen, ei kerran ruudussa. Muuten
    // auto ehtisi hitaalla ruudunpäivityksellä liikkua seinän läpi yhdessä hypyssä.
    for (let i = 0; i < steps; i++) {
      this.step(h, input, world);
      if (world && world.collide) {
        const hit = world.collide(this);
        if (hit > this.frameImpact) this.frameImpact = hit;
      }
    }
    // Vaihtaminen tapahtuu kerran ruudussa, ei joka aliaskeleella - muuten automaatti
    // ehtisi vaihtaa läpi koko laatikon yhden ruudun aikana.
    if (input.autoGear) this.autoShift(input);
    this.updateVisuals(dt);
  }

  // Kovin osuma tämän ruudun aikana; main lukee ja nollaa sen efektejä varten.
  takeImpact() { const v = this.frameImpact; this.frameImpact = 0; return v; }

  step(h, input, world) {
    const spec = this.spec;
    const speed = this.speed;
    const tires = TIRE_SETS[this.tireMode] || TIRE_SETS.drift;

    // --- ohjaus -------------------------------------------------------------
    // HUOM kääntömerkki: oikeakätisessä Y-ylös -koordinaatistossa +Z:aan katsovan
    // kappaleen paikallinen +X osoittaa sen VASEMMALLE, ei oikealle. Fysiikka on
    // sisäisesti johdonmukainen tässä kehyksessä (ja peilisymmetrinen), joten
    // pelaajan ohjaus käännetään kerran tässä - silloin D kääntää ruudulla oikealle.
    let target = -input.steer * spec.maxSteer;
    if (input.assist > 0 && speed > 4) {
      // Vastaohjausapu on turvaverkko, ei autopilotti: se lisää vastaohjausta vasta kun
      // kulma ylittää noin 30 astetta. Alle sen pelaaja saa driftata täysin itse.
      const beta = this.sideSlip;
      const excess = Math.abs(beta) - 0.52;
      if (excess > 0) {
        const help = Math.sign(beta) * Math.min(spec.maxSteer, excess * 2.4);
        target = clamp(target + help * input.assist, -spec.maxSteer, spec.maxSteer);
      }
    }
    // Ratti kääntyy nopeammin paikallaan kuin vauhdissa (rengaskuorma ja hydrauliikka).
    const steerRate = (5.6 - Math.min(2.4, speed * 0.045)) * (1 + input.steerBoost * 0.6);
    const d = target - this.steerAngle;
    const maxD = steerRate * h;
    this.steerAngle += clamp(d, -maxD, maxD);

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const vLat = this.vx * cy - this.vz * sy;
    const vLon = this.vx * sy + this.vz * cy;
    this.vLon = vLon;

    // Peruutusvaihteella pedaalit vaihtavat roolia: jarru antaa kaasua taaksepäin.
    // Näin sama S-näppäin sekä jarruttaa että peruuttaa, kuten pelaajat odottavat.
    const rev = this.gear < 0;
    const thr = rev ? input.brake : input.throttle;
    const brk = rev ? input.throttle : input.brake;

    // --- alusta ja kuormansiirto -------------------------------------------
    const surf = world ? world.sample(this.x, this.z) : null;
    const baseGrip = surf ? surf.grip : 1;
    const L = spec.wheelbase;
    const staticFront = spec.mass * G * spec.cgToRear / L;
    const staticRear = spec.mass * G * spec.cgToFront / L;
    const df = 0.5 * AIR * spec.downforce * speed * speed;

    const longShift = spec.mass * this.accelLong * spec.cgHeight / L;
    const latShift = spec.mass * this.accelLat * spec.cgHeight / spec.trackWidth;
    const frontRoll = latShift * spec.rollBalance;
    const rearRoll = latShift * (1 - spec.rollBalance);

    const fzF = Math.max(0, staticFront - longShift + df * 0.42);
    const fzR = Math.max(0, staticRear + longShift + df * 0.58);
    const loads = [
      Math.max(0, fzF * 0.5 - frontRoll),
      Math.max(0, fzF * 0.5 + frontRoll),
      Math.max(0, fzR * 0.5 - rearRoll),
      Math.max(0, fzR * 0.5 + rearRoll)
    ];

    // --- voimansiirto -------------------------------------------------------
    const ratio = this.driveRatio;
    const rearOmega = (this.wheels[WHEEL_RL].omega + this.wheels[WHEEL_RR].omega) * 0.5;
    const gearedRpm = Math.abs(rearOmega * ratio) * 60 / (2 * Math.PI);

    this.clutch = input.clutch;
    // Alle noin 8 km/h kytkin luistaa itsestään, jotta moottori ei sammu.
    const creepBlend = clamp(1 - Math.abs(rearOmega) * spec.wheelRadius / 2.4, 0, 1);
    const slip = this.gear === 0 ? 1 : Math.max(this.clutch, creepBlend);

    // Vaihdon aikana kierrokset seuraavat edelleen välitystä (kuten oikeassa autossa
    // kytkimen kiinni palatessa) - vain vääntö katkaistaan erikseen.
    const freeTarget = lerp(spec.idle, spec.redline * 0.97, thr);
    this.gearedRpm = gearedRpm;
    const engaged = Math.max(spec.idle, gearedRpm);
    const blended = lerp(engaged, Math.max(freeTarget, engaged * (1 - slip)), slip);
    const rpmRate = slip > 0.5 ? 9.5 : 22;
    this.rpm += (blended - this.rpm) * Math.min(1, rpmRate * h);
    this.rpm = clamp(this.rpm, spec.idle * 0.85, spec.redline + 250);

    if (this.rpm >= spec.redline) {
      this.limiterTimer = 0.07;
      if (thr > 0.5) this.backfire = Math.max(this.backfire, 1);
    }
    this.limiterTimer = Math.max(0, this.limiterTimer - h);

    let engineTorque = torqueAt(spec.torqueCurve, this.rpm) * spec.powerLimit;
    const engineBrake = 12 + this.rpm * 0.0065;
    engineTorque = engineTorque * thr - engineBrake * (1 - thr);
    if (this.limiterTimer > 0) engineTorque = Math.min(engineTorque, -engineBrake * 0.5);
    if (this.shiftTimer > 0) engineTorque = 0;

    // Kytkinpotku: kytkimen nopea vapautus korkeilla kierroksilla antaa vääntöpiikin,
    // joka on driftaajan tapa katkaista takapään pito.
    let kick = 0;
    if (this.prevClutch > 0.6 && input.clutch < 0.25 && this.rpm > spec.idle * 2.4) {
      kick = spec.engineInertia * (this.rpm - engaged) * 0.35;
    }
    this.prevClutch = input.clutch;

    let driveTorque = (engineTorque + kick) * ratio * 0.9 * (1 - this.clutch * 0.92);
    if (this.gear === 0) driveTorque = 0;

    // Luistonesto leikkaa vääntöä jos takarenkaat karkaavat.
    if (spec.tcs && thr > 0.05 && !input.handbrake) {
      const kappa = Math.max(
        Math.abs(this.wheels[WHEEL_RL].slipRatio),
        Math.abs(this.wheels[WHEEL_RR].slipRatio)
      );
      if (kappa > 0.22) driveTorque *= clamp(1 - (kappa - 0.22) * 2.2, 0.15, 1);
    }

    // Tasauspyörästö: vääntöä siirtyy nopeammalta pyörältä hitaammalle.
    const dOmega = this.wheels[WHEEL_RL].omega - this.wheels[WHEEL_RR].omega;
    const lockCap = Math.abs(driveTorque) * 0.55 + 260;
    const lockTorque = spec.lsdLock * lockCap * Math.tanh(dOmega * 0.55);
    const driveEach = driveTorque * 0.5;

    // --- rengasvoimat -------------------------------------------------------
    let sumFx = 0, sumFz = 0, sumM = 0;
    const brakeF = spec.brakeTorque * spec.brakeBalance * brk;
    const brakeR = spec.brakeTorque * (1 - spec.brakeBalance) * brk;
    const handbrake = input.handbrake ? spec.brakeTorque * 0.62 + 700 : 0;

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.load = loads[i];
      w.steer = w.front ? this.steerAngle : 0;

      const wheelSurf = world ? world.sample(
        this.x + (w.px * cy + w.pz * sy),
        this.z + (-w.px * sy + w.pz * cy)
      ) : null;
      w.grip = wheelSurf ? wheelSurf.grip : baseGrip;
      w.onRoad = wheelSurf ? wheelSurf.onRoad : true;

      // Renkaan kosketuspisteen nopeus korin koordinaatistossa.
      const wLat = vLat + this.yawRate * w.pz;
      const wLon = vLon - this.yawRate * w.px;

      const cs = Math.cos(w.steer), ss = Math.sin(w.steer);
      const tLon = wLat * ss + wLon * cs;
      const tLat = wLat * cs - wLon * ss;

      const R = spec.wheelRadius;
      const vRef = Math.max(Math.abs(tLon), 2.4);
      const slipLong = (tLon - w.omega * R) / vRef;
      const slipLat = tLat / vRef;
      w.slipRatio = slipLong;
      w.slipAngle = Math.atan2(tLat, Math.max(Math.abs(tLon), 0.6));

      const sxn = slipLong / PEAK_LONG;
      const syn = slipLat / tires.peakLat;
      const sn = Math.hypot(sxn, syn);

      const mu = (w.front ? spec.gripFront * tires.front : spec.gripRear * tires.rear) * w.grip
        * (input.handbrake && !w.front ? 0.86 : 1)
        * (1 - this.damage * 0.12);
      // Kuormariippuvainen kitka: rengas menettää suhteellista pitoa kuorman kasvaessa.
      const loadFactor = 1.06 - 0.055 * (w.load / 3600);
      const fmax = mu * loadFactor * w.load;
      const f = tireCurve(sn, tires.tail) * fmax;

      const fLon = sn > 1e-5 ? -f * sxn / sn : 0;
      const fLat = sn > 1e-5 ? -f * syn / sn : 0;
      w.slipSpeed = Math.hypot(tLon - w.omega * R, tLat);
      w.saturation = clamp(sn, 0, 4);

      // Pyörän pyörimisdynamiikka. Vetävillä pyörillä moottorin hitaus näkyy
      // välityssuhteen neliöllä kerrottuna - jaettuna kahdelle vetävälle pyörälle.
      const driven = !w.front && this.gear !== 0;
      const Iw = spec.wheelInertia + (driven ? spec.engineInertia * ratio * ratio * (1 - this.clutch) * 0.5 : 0);
      let torque = -fLon * R;
      if (driven) torque += driveEach + (i === WHEEL_RL ? -lockTorque : lockTorque);
      w.omega += torque / Iw * h;

      let brake = w.front ? brakeF : brakeR;
      if (!w.front) brake += handbrake;
      if (spec.abs && !input.handbrake && brake > 0 && Math.abs(slipLong) > 0.18) {
        brake *= clamp(1 - (Math.abs(slipLong) - 0.18) * 3, 0.1, 1);
      }
      if (brake > 0) {
        const dw = brake / Iw * h;
        if (Math.abs(w.omega) <= dw) w.omega = 0;
        else w.omega -= Math.sign(w.omega) * dw;
      }

      // Voimat takaisin korin koordinaatistoon.
      const bx = fLon * ss + fLat * cs;
      const bz = fLon * cs - fLat * ss;
      w.fx = bx; w.fy = bz;
      sumFx += bx;
      sumFz += bz;
      sumM += w.pz * bx - w.px * bz;
    }

    // --- ilmanvastus, vierintävastus, mäki --------------------------------
    const drag = 0.5 * AIR * spec.dragArea * speed;
    sumFz -= drag * vLon;
    sumFx -= drag * vLat;
    const rollRes = 0.013 * spec.mass * G;
    if (speed > 0.2) {
      sumFz -= rollRes * (vLon / speed);
      sumFx -= rollRes * (vLat / speed);
    }

    if (surf && (surf.slopeX || surf.slopeZ)) {
      const gx = -spec.mass * G * surf.slopeX;
      const gz = -spec.mass * G * surf.slopeZ;
      sumFx += gx * cy - gz * sy;
      sumFz += gx * sy + gz * cy;
    }

    const ax = sumFx / spec.mass;
    const az = sumFz / spec.mass;

    // Kuormansiirto seuraa kiihtyvyyttä viiveellä - jäykempi alusta = nopeampi vaste.
    const k = Math.min(1, spec.loadTransferRate * h);
    this.accelLong += (az - this.accelLong) * k;
    this.accelLat += (ax - this.accelLat) * k;

    this.vx += (ax * cy + az * sy) * h;
    this.vz += (-ax * sy + az * cy) * h;

    this.yawRate += sumM / spec.inertia * h;
    // Pieni vaimennus estää loputtoman pyörimisen paikallaan.
    this.yawRate *= 1 - Math.min(0.5, (speed < 1.5 ? 3.5 : 0.25) * h);
    this.yaw += this.yawRate * h;

    this.x += this.vx * h;
    this.z += this.vz * h;

    if (this.speed < 0.12 && thr < 0.05) {
      this.vx *= 0.7; this.vz *= 0.7;
    }

    this.shiftTimer = Math.max(0, this.shiftTimer - h);
    this.backfire = Math.max(0, this.backfire - h * 6);
    this.lastImpact = Math.max(0, this.lastImpact - h);
    this.damage = Math.max(0, this.damage - h * 0.02);
  }

  // Automaatti päättää välityksen todellisen pyörännopeuden mukaan, ei kytkimen
  // luistaessa nousevan kierroslukumittarin mukaan.
  autoShift(input) {
    const spec = this.spec;
    if (this.shiftTimer > 0) return;
    const fwd = this.vLon || 0;
    if (this.gear < 0) {
      // Peruutuksesta ykköselle vasta kun taaksepäin liike on loppunut.
      if (input.throttle > 0.1 && fwd > -0.9) this.gear = 1;
      return;
    }
    if (this.gear === 0) { if (input.throttle > 0.1) this.gear = 1; return; }
    const rpm = Math.max(this.gearedRpm || 0, spec.idle);
    const up = spec.redline * 0.93;
    const down = spec.redline * 0.42;
    if (rpm > up && this.gear < spec.gears.length) this.shiftUp();
    else if (rpm < down && this.gear > 1) this.shiftDown();
    else if (this.gear === 1 && input.brake > 0.5 && input.throttle < 0.05 && !input.handbrake && fwd < 0.9) this.gear = -1;
  }

  updateVisuals(dt) {
    const spec = this.spec;
    for (const w of this.wheels) {
      w.spin += w.omega * dt;
      const target = clamp(w.load / (spec.mass * G * 0.5), 0.1, 1.6);
      w.compression += (target - w.compression) * Math.min(1, 8 * dt);
    }
    const targetPitch = clamp(-this.accelLong * 0.011, -0.09, 0.09);
    const targetRoll = clamp(this.accelLat * 0.014, -0.12, 0.12);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, 7 * dt);
    this.roll += (targetRoll - this.roll) * Math.min(1, 7 * dt);
  }

  // Törmäys seinään: nopeus heijastetaan normaalin suuntaan ja auto menettää vauhtia.
  applyImpact(nx, nz, penetration, restitution = 0.28) {
    this.x += nx * penetration;
    this.z += nz * penetration;
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      this.vx -= (1 + restitution) * vn * nx;
      this.vz -= (1 + restitution) * vn * nz;
      const impact = Math.abs(vn);
      this.vx *= 0.86; this.vz *= 0.86;
      this.yawRate *= 0.55;
      this.damage = Math.min(1, this.damage + impact * 0.012);
      this.lastImpact = Math.max(this.lastImpact, Math.min(1, impact / 12));
      return impact;
    }
    return 0;
  }
}
