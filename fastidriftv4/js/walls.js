// Seinien törmäys ja geometria. Seinä on jana, jolla on sisäänpäin osoittava normaali.
// Janat indeksoidaan karkeaan hilaan, joten törmäystesti katsoo vain auton lähellä
// olevia janoja eikä koko kaupunkia.

import * as THREE from '../vendor/three.module.min.js';

export class WallSet {
  constructor(cellSize = 12) {
    this.cellSize = cellSize;
    this.walls = [];
    this.grid = new Map();
  }

  get count() { return this.walls.length; }

  // flip kääntää normaalin. Normaali osoittaa aina sille puolelle, jolla ajetaan.
  add(ax, az, bx, bz, flip = false, y = 0) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    let nx = dz / len, nz = -dx / len;
    if (flip) { nx = -nx; nz = -nz; }
    this.walls.push({ ax, az, bx, bz, nx, nz, len, y });
  }

  // Suorakaide neljänä seinänä. inward = true kun ajetaan suorakaiteen sisällä.
  addRect(cx, cz, w, h, inward, y = 0) {
    const hw = w / 2, hh = h / 2;
    const c = [
      [cx - hw, cz - hh], [cx + hw, cz - hh], [cx + hw, cz + hh], [cx - hw, cz + hh]
    ];
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      this.add(a[0], a[1], b[0], b[1], inward, y);
    }
  }

  index() {
    this.grid.clear();
    const s = this.cellSize;
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      const x0 = Math.floor(Math.min(w.ax, w.bx) / s), x1 = Math.floor(Math.max(w.ax, w.bx) / s);
      const z0 = Math.floor(Math.min(w.az, w.bz) / s), z1 = Math.floor(Math.max(w.az, w.bz) / s);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = x + ',' + z;
          let list = this.grid.get(key);
          if (!list) { list = []; this.grid.set(key, list); }
          list.push(i);
        }
      }
    }
    return this;
  }

  // Auto esitetään kolmena ympyränä pituussuunnassa: riittävän tarkka nurkkiin,
  // huomattavasti halvempi kuin suunnattu suorakaide jokaista janaa vastaan.
  collide(vehicle, restitution = 0.25) {
    const b = vehicle.spec.body;
    const r = b.width * 0.46;
    const offsets = [-b.length * 0.3, 0, b.length * 0.3];
    const fx = Math.sin(vehicle.yaw), fz = Math.cos(vehicle.yaw);
    const s = this.cellSize;
    let worst = 0;
    for (const o of offsets) {
      const cx = vehicle.x + fx * o;
      const cz = vehicle.z + fz * o;
      const gx = Math.floor(cx / s), gz = Math.floor(cz / s);
      for (let ix = gx - 1; ix <= gx + 1; ix++) {
        for (let iz = gz - 1; iz <= gz + 1; iz++) {
          const list = this.grid.get(ix + ',' + iz);
          if (!list) continue;
          for (const wi of list) {
            const w = this.walls[wi];
            const abx = w.bx - w.ax, abz = w.bz - w.az;
            const l2 = abx * abx + abz * abz || 1;
            let t = ((cx - w.ax) * abx + (cz - w.az) * abz) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = w.ax + abx * t, pz = w.az + abz * t;
            const dx = cx - px, dz = cz - pz;
            if (dx * dx + dz * dz >= r * r) continue;
            // Normaali otetaan seinästä, ei erotusvektorista: näin auto työntyy aina
            // oikealle puolelle vaikka se olisi ehtinyt hetkeksi seinän sisään.
            const signed = dx * w.nx + dz * w.nz;
            const push = r - signed;
            if (push <= 0) continue;
            const impact = vehicle.applyImpact(w.nx, w.nz, push, restitution);
            if (impact > worst) worst = impact;
          }
        }
      }
    }
    return worst;
  }

  // Etäisyys lähimpään seinään. Pisteytys palkitsee läheltä ajamisesta.
  distanceTo(x, z, maxR = 12) {
    const s = this.cellSize;
    const gx = Math.floor(x / s), gz = Math.floor(z / s);
    const span = Math.ceil(maxR / s);
    let best = maxR;
    for (let ix = gx - span; ix <= gx + span; ix++) {
      for (let iz = gz - span; iz <= gz + span; iz++) {
        const list = this.grid.get(ix + ',' + iz);
        if (!list) continue;
        for (const wi of list) {
          const w = this.walls[wi];
          const abx = w.bx - w.ax, abz = w.bz - w.az;
          const l2 = abx * abx + abz * abz || 1;
          let t = ((x - w.ax) * abx + (z - w.az) * abz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - (w.ax + abx * t), z - (w.az + abz * t));
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  // Yksi mesh kaikista seinistä: sisäpinta ja yläpinta. Paksuus tekee reunasta
  // kiinteän eikä paperinohuen.
  buildMesh(material, height = 1.2, thickness = 0.3) {
    const pos = [], uv = [], idx = [];
    let v = 0;
    for (const w of this.walls) {
      const { ax, az, bx, bz, nx, nz, len, y } = w;
      const oax = ax - nx * thickness, oaz = az - nz * thickness;
      const obx = bx - nx * thickness, obz = bz - nz * thickness;
      pos.push(ax, y, az, bx, y, bz, ax, y + height, az, bx, y + height, bz);
      uv.push(0, 0, len / 4, 0, 0, 1, len / 4, 1);
      idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      v += 4;
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
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.geo = geo;
    return mesh;
  }
}
