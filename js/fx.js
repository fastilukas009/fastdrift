// Visuaaliset efektit: jarrutusjäljet, rengassavu, kipinät ja sään hiukkaset.
//
// Hiukkaset piirretään yhtenä instansoituna kutsuna ja käännetään kameraa kohti
// verteksivarjostimessa. Näin savua voi olla satoja pilviä ilman piirtokutsutulvaa.

import * as THREE from '../vendor/three.module.min.js';
import { smokeTexture, sparkTexture } from './textures.js';

const PARTICLE_VERT = `
attribute vec3 aOffset;
attribute float aScale;
attribute float aAlpha;
attribute float aRot;
attribute vec3 aColor;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  float c = cos(aRot), s = sin(aRot);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aScale;
  mv.xy += p;
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = `
uniform sampler2D uMap;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(vColor, t.a * vAlpha);
  if (gl_FragColor.a < 0.004) discard;
}`;

class ParticleSystem {
  constructor(count, texture, blending = THREE.NormalBlending) {
    this.count = count;
    this.cursor = 0;
    this.particles = new Array(count);
    for (let i = 0; i < count; i++) {
      this.particles[i] = { life: 0, max: 1, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 1, rot: 0, spin: 0, alpha: 0, r: 1, g: 1, b: 1, drag: 1 };
    }
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.aScale = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    geo.setAttribute('aOffset', this.aOffset);
    geo.setAttribute('aScale', this.aScale);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setAttribute('aRot', this.aRot);
    geo.setAttribute('aColor', this.aColor);
    geo.instanceCount = count;
    this.geometry = geo;
    this.baseGeometry = base;

    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  spawn(opts) {
    const p = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.count;
    Object.assign(p, opts);
    p.life = 0;
    return p;
  }

  update(dt) {
    const off = this.aOffset.array, sc = this.aScale.array, al = this.aAlpha.array;
    const ro = this.aRot.array, co = this.aColor.array;
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      if (p.life >= p.max) { al[i] = 0; continue; }
      p.life += dt;
      const t = p.life / p.max;
      const drag = Math.pow(p.drag, dt * 60);
      p.vx *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vy += p.gravity !== undefined ? p.gravity * dt : 0;
      p.rot += p.spin * dt;
      off[i * 3] = p.x; off[i * 3 + 1] = p.y; off[i * 3 + 2] = p.z;
      sc[i] = p.size * (1 + p.grow * t);
      // Nopea nousu näkyviin, hidas haipuminen - savulta odotetaan juuri tätä käyrää.
      al[i] = p.alpha * Math.min(1, t * 7) * (1 - t) * (1 - t);
      ro[i] = p.rot;
      co[i * 3] = p.r; co[i * 3 + 1] = p.g; co[i * 3 + 2] = p.b;
    }
    this.aOffset.needsUpdate = true;
    this.aScale.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.aRot.needsUpdate = true;
    this.aColor.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.baseGeometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------

const SKID_VERT = `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKID_FRAG = `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  if (vAlpha < 0.01) discard;
  gl_FragColor = vec4(uColor, vAlpha);
}`;

// Jarrutusjäljet talletetaan rengaspuskuriin: vanhimmat nelikulmiot ylikirjoitetaan,
// joten jälkiä voi ajaa rajattomasti ilman että muisti kasvaa.
class SkidMarks {
  constructor(maxQuads = 3000) {
    this.max = maxQuads;
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(maxQuads * 4 * 3);
    this.alphas = new Float32Array(maxQuads * 4);
    const index = new Uint32Array(maxQuads * 6);
    for (let i = 0; i < maxQuads; i++) {
      const v = i * 4;
      index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setDrawRange(0, maxQuads * 6);
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x14151a) } },
      vertexShader: SKID_VERT,
      fragmentShader: SKID_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.prev = [null, null, null, null];
  }

  add(wheelIndex, x, y, z, dirX, dirZ, width, alpha) {
    const prev = this.prev[wheelIndex];
    if (!prev) {
      this.prev[wheelIndex] = { x, z, y, alpha };
      return;
    }
    const dx = x - prev.x, dz = z - prev.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.12) return;
    if (len > 6) { this.prev[wheelIndex] = { x, z, y, alpha }; return; }
    const nx = -dz / len * width * 0.5;
    const nz = dx / len * width * 0.5;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const p = i * 12;
    const yy = y + 0.015;
    this.positions.set([
      prev.x - nx, prev.y + 0.015, prev.z - nz,
      prev.x + nx, prev.y + 0.015, prev.z + nz,
      x - nx, yy, z - nz,
      x + nx, yy, z + nz
    ], p);
    const a = i * 4;
    this.alphas[a] = prev.alpha; this.alphas[a + 1] = prev.alpha;
    this.alphas[a + 2] = alpha; this.alphas[a + 3] = alpha;
    this.dirty = true;
    this.prev[wheelIndex] = { x, z, y, alpha };
  }

  lift(wheelIndex) { this.prev[wheelIndex] = null; }

  flush() {
    if (!this.dirty) return;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.dirty = false;
  }

  clear() {
    this.alphas.fill(0);
    this.cursor = 0;
    this.prev = [null, null, null, null];
    this.dirty = true;
    this.flush();
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

// ---------------------------------------------------------------------------

export class Effects {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    const smokeCount = quality === 'low' ? 180 : quality === 'medium' ? 400 : 750;
    this.smokeTex = smokeTexture();
    this.sparkTex = sparkTexture();
    this.smoke = new ParticleSystem(smokeCount, this.smokeTex);
    this.sparks = new ParticleSystem(90, this.sparkTex, THREE.AdditiveBlending);
    this.weather = null;
    this.skid = new SkidMarks(quality === 'low' ? 1200 : 3200);
    scene.add(this.smoke.mesh, this.sparks.mesh, this.skid.mesh);
    this.smokeTimer = 0;
  }

  enableWeather(kind) {
    if (this.weather) { this.scene.remove(this.weather.mesh); this.weather.dispose(); this.weather = null; }
    if (kind !== 'snow') return;
    this.weather = new ParticleSystem(this.quality === 'low' ? 150 : 420, this.smokeTex);
    this.scene.add(this.weather.mesh);
    this.weatherKind = kind;
  }

  // Rengassavu: määrä ja väri riippuvat liukumasta ja alustasta.
  emitWheel(wheel, x, y, z, vx, vz, surface, dt) {
    const slip = wheel.slipSpeed;
    if (slip < 3.2 || wheel.load < 200) { this.skid.lift(wheel.index); return; }
    const intensity = Math.min(1, (slip - 3.2) / 16);
    const onRoad = wheel.onRoad;

    this.skid.add(wheel.index, x, y, z, 0, 0, 0.26, onRoad ? intensity * 0.72 : intensity * 0.3);

    const rate = (this.quality === 'low' ? 22 : 55) * intensity;
    wheel.smokeAcc = (wheel.smokeAcc || 0) + rate * dt;
    while (wheel.smokeAcc >= 1) {
      wheel.smokeAcc -= 1;
      const spread = 0.9;
      const tint = onRoad ? 0.86 : 0.62;
      const dust = !onRoad;
      this.smoke.spawn({
        x: x + (Math.random() - 0.5) * spread,
        y: y + 0.15 + Math.random() * 0.2,
        z: z + (Math.random() - 0.5) * spread,
        vx: vx * -0.12 + (Math.random() - 0.5) * 2.4,
        vy: 0.5 + Math.random() * 1.5 + intensity * 1.4,
        vz: vz * -0.12 + (Math.random() - 0.5) * 2.4,
        gravity: 0.35,
        drag: 0.965,
        size: 0.9 + Math.random() * 0.8,
        grow: 3.4 + Math.random() * 2.6,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 1.1,
        alpha: (dust ? 0.34 : 0.5) * (0.45 + intensity * 0.75),
        max: 1.5 + Math.random() * 1.6,
        r: dust ? 0.62 : tint, g: dust ? 0.53 : tint, b: dust ? 0.4 : tint + 0.03
      });
    }
  }

  emitSparks(x, y, z, vx, vz, amount) {
    for (let i = 0; i < amount; i++) {
      this.sparks.spawn({
        x, y: y + 0.3, z,
        vx: vx * 0.25 + (Math.random() - 0.5) * 9,
        vy: 1 + Math.random() * 4,
        vz: vz * 0.25 + (Math.random() - 0.5) * 9,
        gravity: -11,
        drag: 0.94,
        size: 0.14 + Math.random() * 0.16,
        grow: -0.5,
        rot: Math.random() * 6,
        spin: 0,
        alpha: 1,
        max: 0.4 + Math.random() * 0.5,
        r: 1, g: 0.75, b: 0.35
      });
    }
  }

  emitExhaust(x, y, z, vx, vz, strength) {
    this.smoke.spawn({
      x, y, z,
      vx: vx * 0.2 + (Math.random() - 0.5) * 1.4,
      vy: 0.6 + Math.random(),
      vz: vz * 0.2 + (Math.random() - 0.5) * 1.4,
      gravity: 0.5, drag: 0.95,
      size: 0.35, grow: 3.2,
      rot: Math.random() * 6, spin: (Math.random() - 0.5) * 2,
      alpha: 0.32 * strength, max: 0.85,
      r: 0.75, g: 0.75, b: 0.78
    });
  }

  updateWeather(dt, camera) {
    if (!this.weather) return;
    const ps = this.weather;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 45;
      ps.spawn({
        x: camera.position.x + Math.cos(a) * r,
        y: camera.position.y + 16 + Math.random() * 8,
        z: camera.position.z + Math.sin(a) * r,
        vx: (Math.random() - 0.5) * 1.6, vy: -2.2 - Math.random() * 1.6, vz: (Math.random() - 0.5) * 1.6,
        gravity: 0, drag: 1,
        size: 0.09 + Math.random() * 0.11, grow: 0,
        rot: 0, spin: 0,
        alpha: 0.75, max: 7,
        r: 1, g: 1, b: 1
      });
    }
    ps.update(dt);
  }

  update(dt, camera) {
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.skid.flush();
    this.updateWeather(dt, camera);
  }

  clear() { this.skid.clear(); }

  dispose() {
    this.smoke.dispose();
    this.sparks.dispose();
    this.skid.dispose();
    if (this.weather) this.weather.dispose();
    this.smokeTex.dispose();
    this.sparkTex.dispose();
  }
}
