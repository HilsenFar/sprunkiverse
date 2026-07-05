// ============================================================
//  Engine — renderer + cinematic post pipeline shared by modes
//  ACES filmic tonemapping · HDR bloom · film grade (vignette,
//  grain, chromatic aberration) · IBL environment · soft shadows
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { damp } from './utils.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.04 },
    uCA: { value: 0.0007 },
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.05 },
    uLift: { value: 0.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uCA, uSaturation, uContrast, uLift;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * uCA * 20.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5 + uLift;
      float vig = smoothstep(0.85, 0.2, r2 * uVignette * 2.0);
      col *= mix(0.68, 1.0, vig);
      col += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 61.7) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Engine {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // IBL environment for PBR materials in every scene
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Post pipeline
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.85, 0.82);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.grade);

    this._bloomBase = 0.85;
    this.bloomExtra = 0;           // mode-driven offset (e.g. mixer phases)
    this._pulse = 0;
    this._satBase = 1.1;
    this._satBoost = 0;
    this.time = 0;
    this.tweens = [];

    this.setQuality('high');
    window.addEventListener('resize', () => this._onResize());
  }

  setScene(scene, camera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.activeCamera = camera;
    this._onResize();
  }

  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const target = q === 'ultra' ? Math.min(dpr, 2) : q === 'high' ? Math.min(dpr, 1.5) : 1;
    this.renderer.setPixelRatio(target);
    this.composer.setPixelRatio(target);
    this.grade.uniforms.uGrain.value = q === 'medium' ? 0.035 : 0.05;
    this._bloomBase = q === 'ultra' ? 0.95 : q === 'high' ? 0.85 : 0.65;
    this._onResize();
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    if (this.activeCamera) {
      const a = w / h;
      // portrait phones: widen the vertical FOV so the composition still fits
      const base = this.activeCamera.userData.baseFov ?? this.activeCamera.fov;
      this.activeCamera.userData.baseFov = base;
      let fov = base;
      const ref = 1.6;
      if (a < ref) {
        const scale = Math.pow(ref / a, 0.7);
        fov = THREE.MathUtils.radToDeg(
          2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base) / 2) * scale));
        fov = Math.min(fov, 80);
      }
      this.activeCamera.fov = fov;
      this.activeCamera.aspect = a;
      this.activeCamera.updateProjectionMatrix();
    }
  }

  /** Kick the bloom (and optionally saturation) — used on musical beats. */
  pulse(strength = 0.35, sat = 0) {
    this._pulse = Math.max(this._pulse, strength);
    this._satBoost = Math.max(this._satBoost, sat);
  }

  /** Simple tween: fn receives progress 0..1 every frame for dur seconds. Returns a cancel handle. */
  addTween(fn, dur, { ease = (t) => t, onDone = null } = {}) {
    const tw = { fn, dur, ease, onDone, elapsed: 0, cancelled: false };
    this.tweens.push(tw);
    return { cancel: () => { tw.cancelled = true; } };
  }

  update(dt) {
    this.time += dt;

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      if (tw.cancelled) { this.tweens.splice(i, 1); continue; }
      tw.elapsed += dt;
      const t = Math.min(1, tw.elapsed / tw.dur);
      tw.fn(tw.ease(t));
      if (t >= 1) {
        this.tweens.splice(i, 1);
        tw.onDone?.();
      }
    }

    this._pulse = damp(this._pulse, 0, 6, dt);
    this._satBoost = damp(this._satBoost, 0, 3, dt);
    this.bloom.strength = this._bloomBase + this.bloomExtra + this._pulse;
    this.grade.uniforms.uSaturation.value = this._satBase + this._satBoost;
    this.grade.uniforms.uTime.value = this.time;

    this.composer.render();
  }
}
