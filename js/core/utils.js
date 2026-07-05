// ============================================================
//  Shared math / noise / particle helpers
// ============================================================
import * as THREE from 'three';

/** Coarse-pointer device (phone/tablet) — `?touch` in the URL forces it for testing. */
export const IS_TOUCH = (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)
  || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('touch'));

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Frame-rate independent exponential smoothing. */
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

// ---------------- deterministic value noise ----------------

function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Fractal noise in [-1, 1]. */
export function fbm(x, y, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise(x * freq, y * freq) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

// ---------------- particle burst ----------------

export class Burst {
  /**
   * One-shot particle burst (confetti, explosions, sparkles, poofs).
   * opts: { count, colors[], size, life, speed, gravity, spread(1=sphere), up }
   */
  constructor(scene, pos, opts = {}) {
    const {
      count = 60, colors = [0xffd76e, 0xff4d6d, 0x7c6cff], size = 0.12,
      life = 1.2, speed = 5, gravity = -7, spread = 1, up = 3,
    } = opts;
    this.scene = scene;
    this.life = life;
    this.age = 0;
    this.gravity = gravity;

    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colAttr = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z;
      const th = rand(Math.PI * 2), ph = Math.acos(rand(-1, 1));
      const s = speed * rand(0.3, 1);
      this.vel[i * 3] = Math.sin(ph) * Math.cos(th) * s * spread;
      this.vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * s * 0.6 + rand(0, up);
      this.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s * spread;
      c.set(pick(colors));
      colAttr[i * 3] = c.r; colAttr[i * 3 + 1] = c.g; colAttr[i * 3 + 2] = c.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colAttr, 3));
    this.mat = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** @returns {boolean} false when dead */
  update(dt) {
    this.age += dt;
    if (this.age >= this.life) { this.dispose(); return false; }
    const p = this.points.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      this.vel[i * 3 + 1] += this.gravity * dt;
      p.array[i * 3] += this.vel[i * 3] * dt;
      p.array[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      p.array[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    p.needsUpdate = true;
    this.mat.opacity = 1 - (this.age / this.life) ** 1.5;
    return true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

/** Manages a list of live bursts — call update(dt) each frame. */
export class BurstPool {
  constructor(scene) { this.scene = scene; this.list = []; }
  spawn(pos, opts) { this.list.push(new Burst(this.scene, pos, opts)); }
  update(dt) { this.list = this.list.filter((b) => b.update(dt)); }
  dispose() { this.list.forEach((b) => b.dispose()); this.list = []; }
}

// ---------------- ambient dust / bubbles field ----------------

export class DriftField {
  /**
   * Looping particle volume (dust motes, bubbles, snow, plankton).
   * opts: { count, box:{x,y,z}, center, size, color, opacity, rise, wobble }
   */
  constructor(scene, opts = {}) {
    const {
      count = 900, box = { x: 40, y: 16, z: 40 }, center = new THREE.Vector3(0, 8, 0),
      size = 0.06, color = 0xaab4ff, opacity = 0.35, rise = 0.15, wobble = 0.4,
    } = opts;
    this.box = box; this.center = center; this.rise = rise; this.wobble = wobble;
    this.seeds = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = center.x + rand(-box.x / 2, box.x / 2);
      positions[i * 3 + 1] = center.y + rand(-box.y / 2, box.y / 2);
      positions[i * 3 + 2] = center.z + rand(-box.z / 2, box.z / 2);
      this.seeds[i] = rand(100);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, color, transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt, t) {
    const p = this.points.geometry.attributes.position;
    const { box, center } = this;
    for (let i = 0; i < p.count; i++) {
      let y = p.array[i * 3 + 1] + this.rise * dt;
      if (y > center.y + box.y / 2) y = center.y - box.y / 2;
      p.array[i * 3 + 1] = y;
      p.array[i * 3] += Math.sin(t * 0.7 + this.seeds[i]) * this.wobble * dt;
      p.array[i * 3 + 2] += Math.cos(t * 0.6 + this.seeds[i] * 1.3) * this.wobble * dt;
    }
    p.needsUpdate = true;
  }
}

// ---------------- volumetric light cone ----------------

const coneVert = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const coneFrag = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float fade = smoothstep(1.0, 0.05, vUv.y);          // fade toward the wide end
    float flicker = 0.92 + 0.08 * sin(uTime * 2.7 + vUv.y * 9.0);
    gl_FragColor = vec4(uColor, fade * uOpacity * flicker);
  }
`;

/** Additive translucent cone — fake volumetric light shaft. */
export function makeLightCone(color = 0xffffff, opacity = 0.16, radius = 2.6, height = 9) {
  const geo = new THREE.ConeGeometry(radius, height, 24, 1, true);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
    },
    vertexShader: coneVert,
    fragmentShader: coneFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  return mesh;
}
