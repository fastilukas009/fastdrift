// Minikartta: katuverkko, korttelit, lentokentta, moottoritie ja liikenne.
//
// Kartan tausta ei muutu ajon aikana, joten se piirretaan kerran radan
// vaihtuessa isolle offscreen-kankaalle. Joka ruudulla siita lohkaistaan
// pelaajan ymparilta pala. Nain ruutukohtainen tyo on yksi drawImage plus
// kourallinen pisteita, ei satojen katujen uudelleenpiirto.
//
// Kartta on pohjoinen ylospain. Ruutukaavassa se on ainoa jarkeva valinta:
// kaantyva kartta tekee suorakulmaisesta verkosta vinon eika kortteleita
// tunnista enaa mistaan. Pelaajan nuoli kaantyy, kartta ei.

const PAD = 60;              // marginaali maailman reunojen ymparille
const BG = '#0d1016';
const GROUND = '#151922';
const BLOCK = '#20252f';
const ST_MINOR = '#5b6577';
const ST_MAJOR = '#7d8899';
const RUNWAY = '#8d99ad';
const SLAB = '#68727f';

export class Minimap {
  /**
   * @param {HTMLCanvasElement} canvas  naytolla nakyva kartta
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layer = null;      // taustakuva maailman koordinaateissa
    this.scale = 1;         // pikselia per metri taustakuvassa
    this.track = null;
    this.full = false;      // koko kartan tila (M)
    this.range = 260;       // paljonko metreja nakyy sateella lahikuvassa
  }

  // Lahikuva on ympyra, koko kartta leveä suorakaide. Maailma on noin 2,4
  // kertaa leveampi kuin korkeampi, joten ympyraan mahtuisi vain keskiosa ja
  // moottoritien paat jaisivat rajauksen ulkopuolelle.
  toggle() {
    this.full = !this.full;
    this.canvas.width = this.full ? 900 : 320;
    this.canvas.height = this.full ? 420 : 320;
    return this.full;
  }

  /** Maailman koordinaatti -> taustakuvan pikseli. */
  px(x) { return (x - this.minX) * this.scale; }
  pz(z) { return (z - this.minZ) * this.scale; }

  // -----------------------------------------------------------------------
  // Taustakuva
  // -----------------------------------------------------------------------

  setTrack(track) {
    this.track = track;
    if (!track) { this.layer = null; return; }
    const b = this.worldBounds(track);
    this.minX = b.minX; this.minZ = b.minZ;
    const w = b.maxX - b.minX, h = b.maxZ - b.minZ;
    // Tausta piirretaan noin kahden metrin tarkkuudella. Se riittaa: kartalla
    // kapeinkin katu on 13,5 metria eli seitseman pikselia.
    this.scale = Math.min(1400 / w, 1400 / h, 2.2);
    this.layer = document.createElement('canvas');
    this.layer.width = Math.ceil(w * this.scale);
    this.layer.height = Math.ceil(h * this.scale);
    const g = this.layer.getContext('2d');
    g.fillStyle = GROUND;
    g.fillRect(0, 0, this.layer.width, this.layer.height);
    this.isCity = !!track.xs;
    if (this.isCity) this.drawCity(g, track);
    else this.drawCircuit(g, track);
  }

  worldBounds(track) {
    let minX, maxX, minZ, maxZ;
    if (track.xs) {
      minX = track.minX; maxX = track.maxX; minZ = track.minZ; maxZ = track.maxZ;
      if (track.districts) {
        const d = track.districts.bounds;
        minX = Math.min(minX, d.minX); maxX = Math.max(maxX, d.maxX);
        minZ = Math.min(minZ, d.minZ); maxZ = Math.max(maxZ, d.maxZ);
      }
    } else if (track.centerline && track.centerline.length) {
      minX = maxX = track.centerline[0].x;
      minZ = maxZ = track.centerline[0].z;
      for (const p of track.centerline) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
    } else {
      const l = track.def.lot;
      minX = l.x - l.w / 2; maxX = l.x + l.w / 2;
      minZ = l.z - l.h / 2; maxZ = l.z + l.h / 2;
    }
    return { minX: minX - PAD, maxX: maxX + PAD, minZ: minZ - PAD, maxZ: maxZ + PAD };
  }

  drawCity(g, t) {
    const s = this.scale;
    // Korttelit ensin, kadut paalle: nain risteyksiin ei jaa kortteleiden reunoja.
    g.fillStyle = BLOCK;
    for (const b of t.blocks) {
      g.fillRect(this.px(b.x0), this.pz(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
    }

    // Lentokentta ja moottoritie omalla savyllaan, jotta ne erottuvat kaduista.
    if (t.districts) {
      for (const sl of t.districts.slabs) {
        g.fillStyle = sl.kind === 'runway' ? RUNWAY
          : sl.kind === 'motorway' ? ST_MAJOR : SLAB;
        g.fillRect(this.px(sl.x0), this.pz(sl.z0),
          (sl.x1 - sl.x0) * s, (sl.z1 - sl.z0) * s);
      }
      // Kiitoradan keskiviiva, jotta se lukee kartalla lentokentaksi.
      const rw = t.districts.slabs.find((q) => q.kind === 'runway');
      if (rw) {
        g.strokeStyle = 'rgba(20,24,32,0.75)';
        g.lineWidth = Math.max(1, s * 1.2);
        g.setLineDash([s * 26, s * 20]);
        g.beginPath();
        g.moveTo(this.px(rw.x0 + 30), this.pz((rw.z0 + rw.z1) / 2));
        g.lineTo(this.px(rw.x1 - 30), this.pz((rw.z0 + rw.z1) / 2));
        g.stroke();
        g.setLineDash([]);
      }
    }

    const z0 = this.pz(t.minZ - 60), z1 = this.pz(t.maxZ + 60);
    const x0 = this.px(t.minX - 60), x1 = this.px(t.maxX + 60);
    for (let i = 0; i < t.xs.length; i++) {
      g.fillStyle = t.majorV[i] ? ST_MAJOR : ST_MINOR;
      const hw = t.halfV(i) * s;
      g.fillRect(this.px(t.xs[i]) - hw, z0, hw * 2, z1 - z0);
    }
    for (let j = 0; j < t.zs.length; j++) {
      g.fillStyle = t.majorH[j] ? ST_MAJOR : ST_MINOR;
      const hh = t.halfH(j) * s;
      g.fillRect(x0, this.pz(t.zs[j]) - hh, x1 - x0, hh * 2);
    }
  }

  drawCircuit(g, t) {
    const s = this.scale;
    if (t.centerline && t.centerline.length) {
      g.strokeStyle = ST_MAJOR;
      g.lineJoin = g.lineCap = 'round';
      g.lineWidth = Math.max(2, t.halfWidth * 2 * s);
      g.beginPath();
      t.centerline.forEach((p, i) => {
        const x = this.px(p.x), z = this.pz(p.z);
        if (i === 0) g.moveTo(x, z); else g.lineTo(x, z);
      });
      if (t.def.closed) g.closePath();
      g.stroke();
    } else if (t.def.lot) {
      const l = t.def.lot;
      g.fillStyle = ST_MAJOR;
      g.fillRect(this.px(l.x - l.w / 2), this.pz(l.z - l.h / 2), l.w * s, l.h * s);
    }
  }

  // -----------------------------------------------------------------------
  // Ruutukohtainen piirto
  // -----------------------------------------------------------------------

  /**
   * @param {Vehicle} v       pelaaja
   * @param {object}  track   nykyinen rata (liikenne luetaan tasta)
   */
  draw(v, track) {
    const c = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    if (!this.layer || !v) return;

    c.save();
    this.clipShape(c, W, H);
    c.clip();
    c.fillStyle = BG;
    c.fillRect(0, 0, W, H);

    // Kilparata mahtuu kokonaan kartalle, ja koko rata kerralla on
    // kierrosajossa hyodyllisempi kuin 260 metrin ikkuna. Kaupunki on
    // kilometrin levyinen, joten se katsotaan aina lahelta.
    const fit = this.full || !this.isCity;

    let k, ox, oz;
    if (fit) {
      // Koko maailma ruutuun, pieni marginaali reunoille.
      k = Math.min((W - 24) / this.layer.width, (H - 24) / this.layer.height);
      ox = W / 2 - this.layer.width * k / 2;
      oz = H / 2 - this.layer.height * k / 2;
    } else {
      // Pelaaja keskelle, kiintea nakyma sateella range.
      k = (W / 2) / (this.range * this.scale);
      ox = W / 2 - this.px(v.x) * k;
      oz = H / 2 - this.pz(v.z) * k;
    }
    c.imageSmoothingEnabled = true;
    c.drawImage(this.layer, ox, oz, this.layer.width * k, this.layer.height * k);

    const toX = (x) => ox + this.px(x) * k;
    const toZ = (z) => oz + this.pz(z) * k;

    // Siviililiikenne pieninä pisteina - vain lahikuvassa, muuten ne peittavat
    // koko kartan eivatka kerro mitaan.
    const tr = track && track.traffic;
    if (tr && !this.full) {
      c.fillStyle = 'rgba(255,214,120,0.9)';
      for (const car of tr.cars) {
        const dx = car.x - v.x, dz = car.z - v.z;
        if (dx * dx + dz * dz > this.range * this.range) continue;
        c.fillRect(toX(car.x) - 1.5, toZ(car.z) - 1.5, 3, 3);
      }
    }

    // Pelaaja: nuoli, joka osoittaa ajosuuntaan.
    const pxp = fit ? toX(v.x) : W / 2;
    const pzp = fit ? toZ(v.z) : H / 2;
    c.save();
    c.translate(pxp, pzp);
    // Maailman yaw kasvaa +Z:sta +X:aan; kartalla +Z on alaspain, joten
    // ruudun kulma on sama luku mitattuna alaspain osoittavasta akselista.
    c.rotate(-v.yaw);
    c.fillStyle = '#ff2e63';
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(5, 6);
    c.lineTo(0, 3);
    c.lineTo(-5, 6);
    c.closePath();
    c.fill();
    c.restore();

    // Nimikyltit vain koko kartalla: lahikuvassa ne peittaisivat kadut.
    if (this.full && track && track.districts) {
      c.fillStyle = 'rgba(226,232,244,0.72)';
      c.font = '700 12px system-ui, sans-serif';
      c.textAlign = 'center';
      const rw = track.districts.slabs.find((q) => q.kind === 'runway');
      const mw = track.districts.slabs.find((q) => q.kind === 'motorway');
      if (rw) c.fillText('LENTOKENTTÄ', toX((rw.x0 + rw.x1) / 2), toZ(rw.z0) - 10);
      // Keskustan nimi ruudukon ylareunaan, ei keskelle: siella se jaisi
      // pelaajan nuolen alle juuri silloin kun pelaaja on keskustassa.
      let keskustaY = toZ(track.minZ) - 6;
      if (mw) {
        const mwY = toZ(mw.z1) + 20;
        c.fillText('MOOTTORITIE', toX(0), mwY);
        // Moottoritie kulkee heti ruudukon ylapuolella, joten sen nimi ja
        // KESKUSTA osuvat samaan kohtaan. Kumpikin on kiinnitetty omaan
        // kohteeseensa, joten niita ei voi vain siirtaa - alempi tyonnetaan
        // ruudukon sisaan sen verran etta rivit erottuvat.
        // 26 px eli reilut kaksi rivikorkeutta 12 px:n fontilla; 16 px jatti
        // rivit kiinni toisissaan.
        if (Math.abs(keskustaY - mwY) < 26) keskustaY = mwY + 26;
      }
      c.fillText('KESKUSTA', toX(0), keskustaY);
    }

    c.restore();

    // Kehys ja pohjoisen merkki.
    c.strokeStyle = 'rgba(255,255,255,0.20)';
    c.lineWidth = 2;
    this.clipShape(c, W, H);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = '700 11px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('P', W / 2, this.full ? 18 : 15);
  }

  clipShape(c, W, H) {
    c.beginPath();
    if (this.full) {
      const r = 16;
      c.moveTo(r, 1);
      c.arcTo(W - 1, 1, W - 1, H - 1, r);
      c.arcTo(W - 1, H - 1, 1, H - 1, r);
      c.arcTo(1, H - 1, 1, 1, r);
      c.arcTo(1, 1, W - 1, 1, r);
      c.closePath();
    } else {
      c.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    }
  }
}
