// Kaikki tekstuurit piirretään ajon aikana canvakselle - peli ei lataa yhtään kuvatiedostoa,
// joten se toimii myös offline-tilassa eikä latausaika riipu verkosta.
import * as THREE from '../vendor/three.module.min.js';

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function finish(canvas, repeat = 1, aniso = 8) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Deterministinen kohina: sama rata näyttää samalta joka käynnistyksellä.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function grain(ctx, size, rand, amount, alpha) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    d[i + 3] = alpha === undefined ? d[i + 3] : alpha;
  }
  ctx.putImageData(img, 0, 0);
}

export function asphaltTexture(base = '#2f3136', seed = 7) {
  const size = 512;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rand = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  // Karkeat kiviainesläikät antavat asfaltille syvyyttä lähietäisyydeltä.
  for (let i = 0; i < 2600; i++) {
    const r = 1 + rand() * 3.2;
    const l = 0.55 + rand() * 0.5;
    ctx.fillStyle = `rgba(${Math.floor(120 * l)},${Math.floor(124 * l)},${Math.floor(132 * l)},${0.10 + rand() * 0.2})`;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Muutama hiushalkeama. Pitkiä vetoja vältetään, koska tekstuuri toistuu radalla
  // kymmeniä kertoja ja isot kuviot alkaisivat näkyä ruudukkona.
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = `rgba(22,22,26,${0.06 + rand() * 0.09})`;
    ctx.lineWidth = 1 + rand() * 1.4;
    ctx.beginPath();
    let px = rand() * size, py = rand() * size;
    ctx.moveTo(px, py);
    for (let k = 0; k < 4; k++) {
      px += (rand() - 0.5) * 90; py += (rand() - 0.5) * 90;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  grain(ctx, size, rand, 16);
  return c;
}

export function groundTexture(kind) {
  const size = 512;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rand = rng(kind === 'snow' ? 21 : kind === 'dirt' ? 13 : 3);
  const palette = kind === 'snow'
    ? ['#e8eef5', '#dbe4ee', '#f2f6fa']
    : kind === 'gravel'
      ? ['#4a4a48', '#565553', '#3e3e3c']
      : kind === 'dirt'
        ? ['#6b563c', '#7a6446', '#5c4a33']
        : ['#3d5a35', '#456a3a', '#33502e'];
  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = palette[1 + (rand() > 0.5 ? 1 : 0)];
    ctx.globalAlpha = 0.15 + rand() * 0.35;
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, 3 + rand() * 22, 2 + rand() * 12, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  grain(ctx, size, rand, kind === 'snow' ? 10 : 22);
  return c;
}

export function curbTexture(a = '#d8443c', b = '#f2f2f2') {
  const c = makeCanvas(128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = b;
  ctx.fillRect(0, 0, 128, 64);
  return c;
}

export function concreteTexture(seed = 5, tint = '#8d8f93') {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rand = rng(seed);
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rand() * 0.06})`;
    ctx.fillRect(rand() * size, rand() * size, 2 + rand() * 20, 2 + rand() * 8);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, size, size);
  grain(ctx, size, rand, 14);
  return c;
}

// Rakennusten julkisivu: yön valaistut ikkunat luovat kaupunkitunnelman ilman geometriaa.
export function buildingTexture(seed = 11, night = false) {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rand = rng(seed);
  ctx.fillStyle = night ? '#191b22' : '#4a4e57';
  ctx.fillRect(0, 0, size, size);
  const cols = 8, rows = 12;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = night ? rand() < 0.34 : rand() < 0.12;
      ctx.fillStyle = lit ? `rgba(255,${190 + rand() * 50},${120 + rand() * 60},0.92)` : (night ? '#12141a' : '#2c3038');
      ctx.fillRect(x * 32 + 7, y * 21 + 5, 18, 12);
    }
  }
  return c;
}

// Pehmeä savupilvi. Kaksi päällekkäistä gradienttia antaa reunoihin epätasaisuutta.
export function smokeTexture() {
  const size = 128;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const rand = rng(31);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 14; i++) {
    const r = 6 + rand() * 20;
    ctx.globalAlpha = 0.10 + rand() * 0.16;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function sparkTexture() {
  const size = 64;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,244,214,1)');
  g.addColorStop(0.3, 'rgba(255,178,60,0.8)');
  g.addColorStop(1, 'rgba(255,90,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export { finish as toTexture };
