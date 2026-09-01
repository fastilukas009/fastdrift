// Driftin pisteytys. Pisteet kertyvät "pankkiin" kesken sarjan ja lyödään lukkoon vasta
// kun sarja päättyy siististi. Seinään ajo tai spinni pudottaa keräämättömät pisteet -
// tämä riskin ja palkkion suhde on koko pelin ydin.

const MIN_ANGLE = 11 * Math.PI / 180;
const MAX_ANGLE = 100 * Math.PI / 180;
const SPIN_ANGLE = 118 * Math.PI / 180;
const MIN_SPEED = 6.5;

export class DriftScorer {
  constructor(track) {
    this.track = track;
    this.reset();
  }

  reset() {
    this.total = 0;
    this.pending = 0;
    this.multiplier = 1;
    this.drifting = false;
    this.driftTime = 0;
    this.graceTimer = 0;
    this.lastSign = 0;
    this.transitionTimer = 0;
    this.angle = 0;
    this.events = [];
    this.best = 0;
    this.bestCombo = 0;
    this.topSpeed = 0;
    this.longestDrift = 0;
    this.clipCount = 0;
    this.transitions = 0;
    this.wallHits = 0;
    this.proximityTimer = 0;
    this.missTimer = 0;
    this.nearMisses = 0;
    this.lastGain = 0;
    this.flashTimer = 0;
  }

  emit(type, data) { this.events.push({ type, ...data }); }

  update(dt, vehicle, input) {
    this.events.length = 0;
    const track = this.track;
    const speed = vehicle.speed;
    const angle = vehicle.sideSlip;
    const absAngle = Math.abs(angle);
    this.angle = angle;
    this.topSpeed = Math.max(this.topSpeed, vehicle.speedKmh);
    this.flashTimer = Math.max(0, this.flashTimer - dt);

    const surf = track.sample(vehicle.x, vehicle.z);
    const onSurface = surf.grip > 0.55 || track.def.surface === 'snow';
    const valid = speed > MIN_SPEED && absAngle > MIN_ANGLE && absAngle < MAX_ANGLE && onSurface;

    if (absAngle > SPIN_ANGLE && speed > 4) {
      this.breakCombo('spin');
    } else if (valid) {
      if (!this.drifting) {
        this.drifting = true;
        this.driftTime = 0;
        this.lastSign = Math.sign(angle);
      }
      this.graceTimer = 0;
      this.driftTime += dt;
      this.longestDrift = Math.max(this.longestDrift, this.driftTime);

      // Kerroin kasvaa mitä pidempään sarja jatkuu. Kynnysten ylitys näytetään pelaajalle.
      const before = Math.floor(this.multiplier);
      this.multiplier = Math.min(10, this.multiplier + dt * 0.32);
      if (Math.floor(this.multiplier) > before) this.emit('levelup', { level: Math.floor(this.multiplier) });

      const sign = Math.sign(angle);
      if (sign !== 0 && sign !== this.lastSign && absAngle > 18 * Math.PI / 180) {
        this.lastSign = sign;
        this.transitions++;
        this.multiplier = Math.min(10, this.multiplier + 0.45);
        const bonus = 700 * this.multiplier;
        this.pending += bonus;
        this.emit('transition', { bonus });
      }

      // Peruspisteet: nopeus kertaa kulman sini. Jyrkkä kulma kovassa vauhdissa maksaa eniten.
      let rate = vehicle.speedKmh * Math.sin(absAngle) * this.multiplier * 1.9;

      // Seinän vieressä ajaminen on riskialtista, joten se palkitaan erikseen.
      const wallDist = this.wallDistance(vehicle);
      if (wallDist < 1.6) {
        this.proximityTimer += dt;
        rate *= 1 + (1.6 - wallDist) * 0.5;
        if (this.proximityTimer > 0.35) {
          this.proximityTimer = 0;
          this.emit('close', {});
        }
      } else {
        this.proximityTimer = 0;
      }

      this.pending += rate * dt;
      this.lastGain = rate;

      // Ohilipaisu siviiliautosta on kaupungin oma riskibonus.
      if (track.trafficDistance) {
        this.missTimer = Math.max(0, (this.missTimer || 0) - dt);
        const md = track.trafficDistance(vehicle.x, vehicle.z);
        if (md < 3.2 && speed > 11 && this.missTimer <= 0) {
          this.missTimer = 1.1;
          this.nearMisses = (this.nearMisses || 0) + 1;
          const bonus = Math.round((900 + (3.2 - md) * 700) * this.multiplier);
          this.pending += bonus;
          this.emit('nearmiss', { bonus });
        }
      }

      const near = track.clipProximity(vehicle.x, vehicle.z);
      if (near && near.clip.cooldown <= 0) {
        near.clip.cooldown = 6;
        this.clipCount++;
        const bonus = Math.round(1200 * this.multiplier * (1 - near.d / (near.clip.r + 2.5)) + 400 * this.multiplier);
        this.pending += bonus;
        this.emit('clip', { bonus });
      }
    } else if (this.drifting) {
      this.graceTimer += dt;
      this.lastGain *= 0.9;
      // Pieni armonaika sallii oikaisun kaarteiden välissä ilman sarjan katkeamista.
      if (this.graceTimer > 1.35 || speed < 3) this.bank();
    }

    if (vehicle.lastImpact > 0.02 && this.pending > 0) {
      this.wallHits++;
      this.breakCombo('crash');
    }
    return this.events;
  }

  wallDistance(vehicle) {
    const track = this.track;
    // Kaupungissa etäisyys mitataan oikeasti lähimpään seinään, koska siellä ei ole
    // keskilinjaa josta laskea.
    if (track.wallDistance) return track.wallDistance(vehicle.x, vehicle.z);
    if (track.def.kind === 'lot') return 99;
    const surf = track.sample(vehicle.x, vehicle.z);
    const gap = track.def.kind === 'touge' ? 1.4 : 3.4;
    return Math.max(0, track.halfWidth + gap - surf.dist);
  }

  bank() {
    if (this.pending > 0) {
      const amount = Math.round(this.pending);
      this.total += amount;
      this.best = Math.max(this.best, amount);
      this.bestCombo = Math.max(this.bestCombo, this.multiplier);
      this.emit('bank', { amount, multiplier: this.multiplier });
      this.flashTimer = 1.1;
    }
    this.pending = 0;
    this.multiplier = 1;
    this.drifting = false;
    this.driftTime = 0;
    this.graceTimer = 0;
    this.lastGain = 0;
  }

  breakCombo(reason) {
    if (this.pending > 0 || this.drifting) {
      const lost = Math.round(this.pending);
      this.emit('lost', { amount: lost, reason });
    }
    this.pending = 0;
    this.multiplier = 1;
    this.drifting = false;
    this.driftTime = 0;
    this.lastGain = 0;
  }

  // Ajon päättyessä kesken oleva sarja lasketaan mukaan.
  finish() {
    this.bank();
    return {
      total: Math.round(this.total),
      best: Math.round(this.best),
      bestCombo: this.bestCombo,
      topSpeed: Math.round(this.topSpeed),
      longestDrift: this.longestDrift,
      clips: this.clipCount,
      transitions: this.transitions,
      nearMisses: this.nearMisses || 0,
      wallHits: this.wallHits
    };
  }
}
