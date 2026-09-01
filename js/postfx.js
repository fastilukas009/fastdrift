// Jälkikäsittely: hehku, värikorjaus, vinjetti ja nopeussumennus.
//
// Pino on RenderPass -> Bloom -> OutputPass -> Grade. Hehku lasketaan lineaarisessa
// HDR-tilassa ennen sävykartoitusta, muuten kirkkaat kohdat olisivat jo leikkautuneet
// eikä valoista tulisi hehkua lainkaan.

import * as THREE from '../vendor/three.module.min.js';
import { EffectComposer } from '../vendor/pp/EffectComposer.js';
import { RenderPass } from '../vendor/pp/RenderPass.js';
import { ShaderPass } from '../vendor/pp/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/pp/UnrealBloomPass.js';
import { OutputPass } from '../vendor/pp/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeed: { value: 0 },
    uVignette: { value: 0.55 },
    uSat: { value: 1.08 },
    uContrast: { value: 1.06 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uShake: { value: 0 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uSpeed;
    uniform float uVignette;
    uniform float uSat;
    uniform float uContrast;
    uniform float uShake;
    uniform vec3 uTint;
    varying vec2 vUv;

    void main() {
      vec2 c = vUv - 0.5;
      vec4 col = texture2D(tDiffuse, vUv);

      // Radiaalinen nopeussumennus: näytteet vedetään kohti ruudun keskustaa, joten
      // reunat venyvät ja keskikuva pysyy terävänä. Juuri tämä tekee vauhdin tunnun.
      if (uSpeed > 0.002) {
        float w = 1.0;
        for (int i = 1; i <= 6; i++) {
          float t = float(i) / 6.0;
          col += texture2D(tDiffuse, vUv - c * t * uSpeed * 0.14);
          w += 1.0;
        }
        col /= w;
      }

      // Kromaattinen aberraatio reunoilla lisää linssin tuntua kovassa vauhdissa.
      float ca = uSpeed * 0.006 + uShake * 0.004;
      if (ca > 0.0001) {
        col.r = texture2D(tDiffuse, vUv - c * ca).r;
        col.b = texture2D(tDiffuse, vUv + c * ca).b;
      }

      float v = 1.0 - dot(c, c) * uVignette;
      col.rgb *= v;
      col.rgb *= uTint;

      float l = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      col.rgb = mix(vec3(l), col.rgb, uSat);
      col.rgb = (col.rgb - 0.5) * uContrast + 0.5;

      gl_FragColor = vec4(clamp(col.rgb, 0.0, 1.0), 1.0);
    }`
};

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.enabled = quality !== 'low';
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    const size = renderer.getSize(new THREE.Vector2());
    // Kynnys 1.0 = vain aidot HDR-kirkkaudet (valot, aurinko) hehkuvat. Matalampi
    // kynnys saisi vaaleat pinnat kuten maalitiedot sumentumaan koko kuvan yli.
    this.bloom = new UnrealBloomPass(size, quality === 'high' ? 0.30 : 0.20, 0.55, 1.0);
    this.composer.addPass(this.bloom);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.setQuality(quality);
  }

  setQuality(quality) {
    this.enabled = quality !== 'low';
    this.bloom.strength = quality === 'high' ? 0.30 : 0.20;
    this.bloom.radius = quality === 'high' ? 0.55 : 0.45;
    // Kevyellä asetuksella hehku sammutetaan kokonaan, muuten se maksaa mobiililla
    // enemmän kuin koko muu piirto.
    this.bloom.enabled = this.enabled;
  }

  setScene(scene, camera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.grade.uniforms.uSpeed.value = 0;
  }

  // env-kohtainen sävytys: yö kylmenee, iltarusko lämpenee.
  setLook({ tint, vignette, saturation, contrast }) {
    const u = this.grade.uniforms;
    if (tint) u.uTint.value.set(tint);
    if (vignette !== undefined) u.uVignette.value = vignette;
    if (saturation !== undefined) u.uSat.value = saturation;
    if (contrast !== undefined) u.uContrast.value = contrast;
  }

  update(dt, speedKmh, shake) {
    const u = this.grade.uniforms;
    // Sumennus alkaa vasta noin 90 km/h:ssa, jottei hidas ajo näytä sumealta.
    const target = Math.max(0, Math.min(1, (speedKmh - 90) / 190));
    u.uSpeed.value += (target - u.uSpeed.value) * Math.min(1, dt * 5);
    u.uShake.value = shake || 0;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  render() { this.composer.render(); }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
  }
}
