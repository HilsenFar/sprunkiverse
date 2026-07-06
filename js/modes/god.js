// ============================================================
//  GOD MODE — guide a Sprunki civilization through the ages.
//  Universim-style autonomous villagers (gather, chop, vibe),
//  AoE2-style age progression with requirements, and the
//  Sprunki twist: every age adds an instrument to the island's
//  song. Win by raising the Neon Monument.
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  clamp, lerp, damp, rand, pick, fbm, BurstPool, makeLightCone,
} from '../core/utils.js';
import { createSprunki, STUDIO_CAST } from '../characters.js';
import { loadSpriteManifest, createSpriteRig } from '../sprites3d.js';

const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const WATER_Y = -2.6;
const ISLAND_R = 68;

function heightAt(x, z) {
  const d = Math.hypot(x, z);
  const base = fbm((x + 512) * 0.013, (z + 512) * 0.013, 4) * 7.5 + 2.6;
  let h = lerp(2.2, base, sstep(10, 38, d));
  h -= Math.pow(sstep(52, 88, d), 1.6) * 26;
  return h;
}

// ------------------------------------------------------------
//  Tools: blessings, wrath and buildings — with costs.
// ------------------------------------------------------------
const TOOLS = {
  select:    { icon: '👁', label: 'LOOK' },
  harvest:   { icon: '🌾', label: 'HARVEST', kind: 'bless', faith: 20 },
  music:     { icon: '🎵', label: 'MUSIC', kind: 'bless', faith: 25 },
  lightning: { icon: '⚡', label: 'BOLT', kind: 'wrath', faith: 15 },
  plague:    { icon: '☠', label: 'PLAGUE', kind: 'wrath', faith: 30 },
  meteor:    { icon: '☄', label: 'METEOR', kind: 'wrath', faith: 50 },
  hut:       { icon: '⛺', label: 'HUT', kind: 'build', wood: 10 },
  totem:     { icon: '🗿', label: 'TOTEM', kind: 'build', wood: 8 },
  house:     { icon: '🏠', label: 'HOUSE', kind: 'build', wood: 20, faith: 10 },
  farm:      { icon: '🌱', label: 'FARM', kind: 'build', wood: 15 },
  drum:      { icon: '🥁', label: 'DRUMS', kind: 'build', wood: 20, faith: 15 },
  speaker:   { icon: '🔊', label: 'SPEAKER', kind: 'build', wood: 25, faith: 20 },
  stage:     { icon: '🎪', label: 'STAGE', kind: 'build', wood: 40, faith: 30 },
  eqtower:   { icon: '📶', label: 'EQ TOWER', kind: 'build', wood: 30, faith: 40 },
  monument:  { icon: '💎', label: 'MONUMENT', kind: 'build', wood: 80, faith: 100 },
};

// ------------------------------------------------------------
//  The four ages — each unlocks tools and adds a music layer.
// ------------------------------------------------------------
const AGES = [
  {
    num: 'Ⅰ', name: 'STONE GROOVE',
    tools: ['select', 'harvest', 'lightning', 'hut', 'totem'],
    ambient: [['thump', 0.12]],
    fog: 0x141a38, sun: 0xffc79a, hemi: 0.5,
    advance: {
      food: 30, wood: 20, faith: 25,
      needs: { hut: 1, totem: 1 },
      hint: 'Build 1 hut + 1 totem',
    },
  },
  {
    num: 'Ⅱ', name: 'BRONZE BEAT',
    tools: ['select', 'harvest', 'music', 'lightning', 'plague', 'hut', 'totem', 'house', 'farm', 'drum'],
    ambient: [['thump', 0.12], ['boom', 0.1]],
    fog: 0x18183a, sun: 0xffd2a0, hemi: 0.55,
    advance: {
      food: 60, wood: 50, faith: 60,
      needs: { farm: 1, drum: 1 },
      hint: 'Build 1 farm + 1 drum circle',
    },
  },
  {
    num: 'Ⅲ', name: 'ELECTRIC',
    tools: ['select', 'harvest', 'music', 'lightning', 'plague', 'meteor', 'hut', 'house', 'farm', 'drum', 'speaker'],
    ambient: [['thump', 0.12], ['boom', 0.1], ['chime', 0.09]],
    fog: 0x121c40, sun: 0xffe0b8, hemi: 0.6,
    advance: {
      food: 100, wood: 90, faith: 120,
      needs: { speaker: 1, house: 2 },
      hint: 'Build 1 speaker + 2 houses',
    },
  },
  {
    num: 'Ⅳ', name: 'NEON',
    tools: ['select', 'harvest', 'music', 'lightning', 'plague', 'meteor', 'house', 'farm', 'drum', 'speaker', 'stage', 'eqtower', 'monument'],
    ambient: [['thump', 0.12], ['boom', 0.1], ['chime', 0.09], ['nova', 0.08], ['voxo', 0.08]],
    fog: 0x1a1030, sun: 0xffb8e0, hemi: 0.65,
    advance: null,
  },
];
for (const a of AGES) {
  a.fogC = new THREE.Color(a.fog);
  a.sunC = new THREE.Color(a.sun);
}

export class GodMode {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 800);
    this.camera.position.set(0, 55, 78);
    this.bursts = new BurstPool(this.scene);
    this.tool = 'select';
    this.age = 1;
    this.won = false;
    this.faith = 40;
    this.food = 12;
    this.wood = 15;
    this.villagers = [];
    this.farms = [];
    this.houseList = [];       // anything that raises the population cap
    this.stages = [];          // drum circles + stages (music gathering spots)
    this.trees = [];
    this.berries = [];
    this.meteors = [];
    this.plagues = [];
    this.scorches = [];
    this.built = {};           // building counts per tool id
    this._tick = 0;
    this._spawned = 0;
    this.musicBless = 0;
    this.musicHandles = null;
    this.ambientHandles = [];
    this._built = false;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
  }

  // ============================================================
  //  BUILD — island, props, starting camp
  // ============================================================

  _build() {
    const s = this.scene;
    s.environment = this.ctx.engine.envTex;
    s.environmentIntensity = 0.45;
    s.background = new THREE.Color(0x0d1024);
    s.fog = new THREE.FogExp2(0x141a38, 0.0075);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec3 vDir; void main(){ vDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: /* glsl */`
          uniform float uTime;
          varying vec3 vDir;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
          void main(){
            vec3 d = normalize(vDir);
            vec3 top = vec3(0.05, 0.05, 0.18);
            vec3 hor = vec3(0.55, 0.22, 0.32);
            vec3 col = mix(hor, top, pow(clamp(d.y, 0.0, 1.0), 0.55));
            col += vec3(1.0, 0.6, 0.3) * pow(max(dot(d, normalize(vec3(-0.4, 0.12, -1.0))), 0.0), 6.0) * 0.5;
            float st = step(0.9988, hash(floor(d.xz * 320.0) + floor(d.y * 320.0)));
            col += vec3(0.9) * st * (0.5 + 0.5 * sin(uTime * 2.0 + hash(d.xy * 51.0) * 30.0)) * smoothstep(0.05, 0.4, d.y);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }));
    this.skyMat = sky.material;
    s.add(sky);

    this.sun = new THREE.DirectionalLight(0xffc79a, 2.2);
    this.sun.position.set(-40, 55, -70);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.far = 300;
    this.sun.shadow.bias = -0.0004;
    s.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0x8899ff, 0x2a1e30, 0.5);
    s.add(this.hemi);

    // terrain
    const SIZE = 220, SEG = 110;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color(), grass = new THREE.Color(0x55915c), dry = new THREE.Color(0x8aa060),
      sand = new THREE.Color(0xcdb87e);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      const n = fbm(x * 0.06 + 80, z * 0.06, 3) * 0.5 + 0.5;
      if (h < WATER_Y + 1.4) c.copy(sand);
      else c.copy(grass).lerp(dry, n);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    this.terrain.receiveShadow = true;
    s.add(this.terrain);

    const water = new THREE.Mesh(
      new THREE.CircleGeometry(400, 48),
      new THREE.MeshPhysicalMaterial({
        color: 0x0a2a3a, roughness: 0.15, metalness: 0.1,
        transparent: true, opacity: 0.92,
      }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    s.add(water);

    // aoe cursor ring + build ghost
    this.cursorRing = new THREE.Mesh(
      new THREE.TorusGeometry(3, 0.12, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd76e, transparent: true, opacity: 0.8 }));
    this.cursorRing.rotation.x = Math.PI / 2;
    this.cursorRing.visible = false;
    s.add(this.cursorRing);

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 2.6, 3.2),
      new THREE.MeshBasicMaterial({ color: 0x7cff9d, transparent: true, opacity: 0.3, depthWrite: false }));
    this.ghost.visible = false;
    s.add(this.ghost);

    this._buildNature();
    this._buildCampfire(new THREE.Vector3(2, 0, -2));

    // the tribe begins: one hut, a handful of Sprunkis
    this._addBuilding('hut', new THREE.Vector3(7, 0, 3), true);
    for (let i = 0; i < 6; i++) this._spawnVillager();

    this._built = true;
  }

  _buildNature() {
    // choppable trees
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.9 });
    const folMat = new THREE.MeshStandardMaterial({ color: 0x3f9152, roughness: 0.85 });
    for (let i = 0; i < 24; i++) {
      const a = rand(Math.PI * 2), r = rand(16, 52);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = heightAt(x, z);
      if (h < WATER_Y + 1.5) continue;
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.9, 7), trunkMat);
      trunk.position.y = 0.95;
      trunk.castShadow = true;
      const fol = new THREE.Mesh(new THREE.SphereGeometry(1.05, 10, 8), folMat);
      fol.position.y = 2.4;
      fol.castShadow = true;
      g.add(trunk, fol);
      g.position.set(x, h, z);
      const sc = rand(0.8, 1.3);
      g.scale.setScalar(sc);
      this.scene.add(g);
      this.trees.push({ group: g, pos: g.position, alive: true, respawn: 0, baseScale: sc });
    }
    // berry bushes — the stone-age pantry
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x2e7a3e, roughness: 0.9 });
    const berryMat = new THREE.MeshStandardMaterial({ color: 0xd8385a, emissive: 0x701020, emissiveIntensity: 0.4 });
    for (const [bx, bz] of [[-8, 6], [12, -9], [-4, -12]]) {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(rand(0.5, 0.8), 10, 8), bushMat);
        b.position.set(rand(-0.7, 0.7), 0.4, rand(-0.7, 0.7));
        b.castShadow = true;
        g.add(b);
      }
      for (let i = 0; i < 7; i++) {
        const berry = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), berryMat);
        berry.position.set(rand(-1, 1), rand(0.3, 0.9), rand(-1, 1));
        g.add(berry);
      }
      g.position.set(bx, heightAt(bx, bz), bz);
      this.scene.add(g);
      this.berries.push({ pos: g.position });
    }
  }

  _buildCampfire(p) {
    const g = new THREE.Group();
    const logMat = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 6), logMat);
      log.rotation.z = Math.PI / 2.6;
      log.rotation.y = (i / 4) * Math.PI;
      log.position.y = 0.22;
      g.add(log);
    }
    const flame = makeLightCone(0xff8c3a, 0.5, 0.42, 1.3);
    flame.rotation.x = Math.PI;      // point up
    flame.position.y = 0.95;
    g.add(flame);
    this.fireFlame = flame;
    this.fireLight = new THREE.PointLight(0xff9040, 30, 14, 2);
    this.fireLight.position.y = 1.2;
    g.add(this.fireLight);
    g.position.copy(p);
    g.position.y = heightAt(p.x, p.z);
    this.scene.add(g);
    this.campfire = { pos: g.position };
  }

  // ============================================================
  //  BUILDINGS
  // ============================================================

  _addBuilding(kind, p, free = false) {
    const y = heightAt(p.x, p.z);
    const g = new THREE.Group();
    g.position.set(p.x, y, p.z);
    g.rotation.y = rand(Math.PI * 2);
    const wall = new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.6 });

    switch (kind) {
      case 'hut': {
        const tent = new THREE.Mesh(
          new THREE.ConeGeometry(1.7, 2.3, 7),
          new THREE.MeshStandardMaterial({ color: 0xa8845a, roughness: 0.9 }));
        tent.position.y = 1.15;
        tent.castShadow = tent.receiveShadow = true;
        g.add(tent);
        this.houseList.push({ group: g, pos: g.position.clone(), cap: 2 });
        break;
      }
      case 'totem': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 2.6, 8),
          new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.85 }));
        pole.position.y = 1.3;
        pole.castShadow = true;
        const face = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.4),
          new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xaa6010, emissiveIntensity: 0.5 }));
        face.position.y = 2.2;
        g.add(pole, face);
        this.stages.push({ group: g, pos: g.position.clone(), ring: null, cones: [] });
        break;
      }
      case 'house': {
        const box = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 3), wall);
        box.position.y = 1.2;
        box.castShadow = box.receiveShadow = true;
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(2.9, 1.7, 4),
          new THREE.MeshStandardMaterial({ color: pick([0xb0524f, 0x5a7fb5, 0x7aa06a]), roughness: 0.75 }));
        roof.position.y = 3.2;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.1),
          new THREE.MeshStandardMaterial({ color: 0x39362e, emissive: 0xffb35c, emissiveIntensity: 1.4 }));
        win.position.set(0, 1.4, 1.55);
        g.add(box, roof, win);
        this.houseList.push({ group: g, pos: g.position.clone(), cap: 3 });
        break;
      }
      case 'farm': {
        const soil = new THREE.Mesh(new THREE.CircleGeometry(3.4, 20),
          new THREE.MeshStandardMaterial({ color: 0x5d4230, roughness: 1 }));
        soil.rotation.x = -Math.PI / 2;
        soil.position.y = 0.06;
        soil.receiveShadow = true;
        g.add(soil);
        const cropMat = new THREE.MeshStandardMaterial({ color: 0x74c94d, roughness: 0.8 });
        for (let i = 0; i < 9; i++) {
          const crop = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 6), cropMat);
          const a = (i / 9) * Math.PI * 2;
          crop.position.set(Math.cos(a) * rand(0.8, 2.4), 0.32, Math.sin(a) * rand(0.8, 2.4));
          crop.castShadow = true;
          g.add(crop);
        }
        this.farms.push({ group: g, pos: g.position.clone() });
        break;
      }
      case 'drum': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.3, 18),
          new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.8 }));
        base.position.y = 0.15;
        base.castShadow = base.receiveShadow = true;
        g.add(base);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          const dr = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.8, 12),
            new THREE.MeshStandardMaterial({ color: 0xb0524f, roughness: 0.7 }));
          dr.position.set(Math.cos(a) * 1.3, 0.7, Math.sin(a) * 1.3);
          dr.castShadow = true;
          g.add(dr);
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.06, 8, 36),
          new THREE.MeshStandardMaterial({ color: 0xffb35c, emissive: 0xff8c3a, emissiveIntensity: 1.2 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.34;
        g.add(ring);
        this.stages.push({ group: g, pos: g.position.clone(), ring, cones: [] });
        break;
      }
      case 'speaker': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 3.2, 8), dark);
        pole.position.y = 1.6;
        pole.castShadow = true;
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 0.9),
          new THREE.MeshStandardMaterial({ color: 0x141220, roughness: 0.55 }));
        box.position.y = 3.4;
        box.castShadow = true;
        const cone1 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 16),
          new THREE.MeshStandardMaterial({ color: 0x2a2440, emissive: 0x7c6cff, emissiveIntensity: 1.2 }));
        cone1.rotation.x = Math.PI / 2;
        cone1.position.set(0, 3.55, 0.48);
        g.add(pole, box, cone1);
        this.stages.push({ group: g, pos: g.position.clone(), ring: cone1.material ? null : null, cones: [] });
        break;
      }
      case 'stage': {
        const plat = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 0.5, 22),
          new THREE.MeshPhysicalMaterial({ color: 0x1c1530, roughness: 0.35, clearcoat: 0.6 }));
        plat.position.y = 0.25;
        plat.castShadow = plat.receiveShadow = true;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.08, 8, 40),
          new THREE.MeshStandardMaterial({ color: 0x7c6cff, emissive: 0x7c6cff, emissiveIntensity: 2 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.52;
        const cones = [];
        for (const side of [-1, 1]) {
          const cone = makeLightCone(side < 0 ? 0xff4d6d : 0x4dd8ff, 0.0, 1.6, 7);
          cone.position.set(side * 1.6, 4, 0);
          g.add(cone);
          cones.push(cone);
        }
        g.add(plat, ring);
        this.stages.push({ group: g, pos: g.position.clone(), ring, cones });
        break;
      }
      case 'eqtower': {
        for (let i = 0; i < 6; i++) {
          const cube = new THREE.Mesh(new THREE.BoxGeometry(0.9 - i * 0.08, 0.7, 0.9 - i * 0.08),
            new THREE.MeshStandardMaterial({
              color: 0x141220,
              emissive: new THREE.Color().setHSL(0.62 + i * 0.06, 0.9, 0.5),
              emissiveIntensity: 1.6, roughness: 0.4,
            }));
          cube.position.y = 0.4 + i * 0.78;
          cube.castShadow = true;
          g.add(cube);
        }
        this.eqTowers = (this.eqTowers ?? 0) + 1;
        break;
      }
      case 'monument': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 0.8, 8),
          new THREE.MeshPhysicalMaterial({ color: 0x1c1530, roughness: 0.3, clearcoat: 0.8 }));
        base.position.y = 0.4;
        base.castShadow = base.receiveShadow = true;
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.7, 0),
          new THREE.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 2.6, roughness: 0.2 }));
        crystal.position.y = 3;
        crystal.castShadow = true;
        const halo = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.08, 10, 48),
          new THREE.MeshStandardMaterial({ color: 0xffd76e, emissive: 0xffd76e, emissiveIntensity: 2.4 }));
        halo.rotation.x = Math.PI / 2;
        halo.position.y = 3;
        g.add(base, crystal, halo);
        this.monument = { group: g, crystal, halo };
        break;
      }
    }
    this.scene.add(g);
    this.built[kind] = (this.built[kind] ?? 0) + 1;
    if (!free) {
      this.ctx.audio.sfx('pop');
      this.bursts.spawn(g.position.clone().add(new THREE.Vector3(0, 1, 0)),
        { count: 40, colors: [0xffffff, 0xb6ff8e], speed: 3 });
    }
    if (kind === 'monument' && !this.won) this._win();
    this._statsUI();
    return g;
  }

  // ============================================================
  //  VILLAGERS — spawn, jobs, death
  // ============================================================

  _spawnVillager(nearPos = null) {
    const spec = STUDIO_CAST[Math.floor(rand(STUDIO_CAST.length))];
    this._spawned++;
    const rig = createSprunki(spec, { scale: 0.92 });
    rig.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const base = nearPos ?? (this.houseList[0]?.pos ?? this.campfire.pos);
    const a = rand(Math.PI * 2);
    rig.group.position.set(
      clamp(base.x + Math.cos(a) * 3, -ISLAND_R, ISLAND_R), 0,
      clamp(base.z + Math.sin(a) * 3, -ISLAND_R, ISLAND_R));
    rig.group.position.y = heightAt(rig.group.position.x, rig.group.position.z);
    this.scene.add(rig.group);
    const v = {
      spec, rig,
      hunger: rand(0.1, 0.4), joy: rand(0.5, 0.8), health: 1,
      sick: false, panic: 0, dead: false,
      job: 'vibe', workT: 0, carrying: false, jobTarget: null,
      target: rig.group.position.clone(), waitT: rand(1, 3),
    };
    this.villagers.push(v);
    this.bursts.spawn(rig.group.position.clone().add(new THREE.Vector3(0, 1, 0)),
      { count: 26, colors: [0xffffff, spec.color], speed: 2.5, gravity: -3 });
    this.ctx.audio.sfx('pop');

    // upgrade to the original 2D cutout once loaded
    loadSpriteManifest().then((man) => {
      const files = man?.[spec.id];
      if (!files?.idle || v.dead) return null;
      return createSpriteRig(spec, files, { keys: ['idle', 'idle2', 'anim', 'anim2'] }).then((srig) => {
        if (v.dead || v.rig !== rig) return;
        srig.group.scale.setScalar(0.92);
        srig.group.position.copy(rig.group.position);
        srig.group.rotation.copy(rig.group.rotation);
        srig.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        srig.cameraRef = this.camera;
        if (v.sick) srig.setTint('sick');
        this.scene.add(srig.group);
        this.scene.remove(rig.group);
        v.rig = srig;
      });
    }).catch(() => {});
    return v;
  }

  _kill(v, cause) {
    if (v.dead) return;
    v.dead = true;
    this.ctx.ui.toast(`${v.spec.name} has perished (${cause})`);
    const rig = v.rig;
    this.ctx.engine.addTween((t) => {
      rig.group.rotation.z = t * Math.PI / 2;
      rig.group.scale.setScalar(0.92 * (1 - t * 0.6));
    }, 1.4, {
      onDone: () => {
        this.scene.remove(rig.group);
        this.villagers = this.villagers.filter((x) => x !== v);
        if (rig.isSprite) {
          rig.mats.forEach((m) => m.dispose?.());
        } else {
          rig.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
          Object.values(rig.mats).forEach((m) => m.dispose?.());
        }
        const grave = new THREE.Group();
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.8, 0.16),
          new THREE.MeshStandardMaterial({ color: 0x8a8f9a, roughness: 0.9 }));
        slab.position.y = 0.4;
        const top = new THREE.Mesh(
          new THREE.CylinderGeometry(0.25, 0.25, 0.16, 12, 1, false, 0, Math.PI),
          slab.material);
        top.rotation.z = Math.PI / 2;
        top.rotation.y = Math.PI / 2;
        top.position.y = 0.8;
        grave.add(slab, top);
        grave.position.copy(rig.group.position);
        grave.position.y = heightAt(rig.group.position.x, rig.group.position.z);
        grave.rotation.y = rand(Math.PI * 2);
        this.scene.add(grave);
      },
    });
  }

  /** Universim-style: the colony assigns its own workers. */
  _assignJobs() {
    const alive = this.villagers.filter((v) => !v.dead && v.panic <= 0);
    if (!alive.length) return;
    // hysteresis: stand down when stocked, only re-hire once clearly below
    if (this.wood >= 120) this._woodSat = true;
    else if (this.wood < 90) this._woodSat = false;
    if (this.food >= 150) this._foodSat = true;
    else if (this.food < 110) this._foodSat = false;
    const wantWood = this._woodSat ? 0 : Math.ceil(alive.length * 0.3);
    const wantFood = this._foodSat ? 0 : Math.ceil(alive.length * 0.35);
    let wood = alive.filter((v) => v.job === 'wood').length;
    let food = alive.filter((v) => v.job === 'food').length;
    for (const v of alive) {
      if (v.job === 'wood' && wood > wantWood) { v.job = 'vibe'; v.workT = 0; wood--; }
      if (v.job === 'food' && food > wantFood) { v.job = 'vibe'; v.workT = 0; food--; }
    }
    for (const v of alive) {
      if (wood < wantWood && v.job === 'vibe') { v.job = 'wood'; v.jobTarget = null; v.workT = 0; wood++; }
      else if (food < wantFood && v.job === 'vibe') { v.job = 'food'; v.jobTarget = null; v.workT = 0; food++; }
    }
  }

  _nearestTree(p) {
    let best = null, bd = Infinity;
    for (const t of this.trees) {
      if (!t.alive) continue;
      const d = p.distanceTo(t.pos);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  _foodSpots() {
    return [...this.farms.map((f) => f.pos), ...this.berries.map((b) => b.pos)];
  }

  _nearestOf(p, spots) {
    let best = null, bd = Infinity;
    for (const s of spots) {
      const d = p.distanceTo(s);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ============================================================
  //  AGES
  // ============================================================

  get ageDef() { return AGES[this.age - 1]; }

  _canAdvance() {
    const a = this.ageDef.advance;
    if (!a) return { ok: false, why: 'Final age' };
    for (const [k, n] of Object.entries(a.needs)) {
      if ((this.built[k] ?? 0) < n) return { ok: false, why: a.hint };
    }
    if (this.food < a.food || this.wood < a.wood || this.faith < a.faith) {
      return { ok: false, why: `Needs ${a.food}🌾 ${a.wood}🪵 ${a.faith}✦` };
    }
    return { ok: true };
  }

  _advanceAge() {
    const chk = this._canAdvance();
    if (!chk.ok) {
      this.ctx.ui.toast(`Cannot advance: ${chk.why}`);
      this.ctx.audio.sfx('lose', { gain: 0.4 });
      return;
    }
    const a = this.ageDef.advance;
    this.food -= a.food; this.wood -= a.wood; this.faith -= a.faith;
    this.age++;
    const def = this.ageDef;
    this.ctx.audio.sfx('win');
    this.ctx.engine.pulse(1.2, 0.3);
    this.ctx.ui.toast(`✨ AGE ${def.num} — THE ${def.name} AGE ✨`, 5000);
    this.bursts.spawn(this.campfire.pos.clone().add(new THREE.Vector3(0, 3, 0)),
      { count: 140, colors: [0xffd76e, 0xff4d6d, 0x7c6cff, 0x4dd8ff], speed: 8, life: 1.8 });
    for (const v of this.villagers) if (!v.dead) v.joy = clamp(v.joy + 0.25, 0, 1);
    if (!this.ageDef.tools.includes(this.tool)) this.tool = 'select';
    this._advT = performance.now();
    this._buildToolbar();
    this._setAmbient();
    this._statsUI();
  }

  _win() {
    this.won = true;
    this.musicBless = 18;
    this.faith += 100;
    this.ctx.audio.sfx('win');
    this.ctx.engine.pulse(1.6, 0.5);
    this.ctx.ui.toast('💎 THE NEON MONUMENT RISES — SPRUNKI CIVILIZATION COMPLETE! 💎', 8000);
    const p = this.monument.group.position;
    for (let i = 0; i < 4; i++) {
      this.bursts.spawn(p.clone().add(new THREE.Vector3(rand(-3, 3), 3 + i, rand(-3, 3))),
        { count: 90, colors: [0xffd76e, 0xff4d6d, 0x7c6cff, 0x4dd8ff, 0xffffff], speed: 9, life: 2 });
    }
    this._winMusic();
  }

  _winMusic() {
    this.musicHandles?.forEach((h) => h?.stop());
    this.musicHandles = [
      this.ctx.audio.playLoopRaw('thump', 0.35),
      this.ctx.audio.playLoopRaw('nova', 0.3),
      this.ctx.audio.playLoopRaw('voxo', 0.28),
    ];
  }

  /** The island's song grows with every age. */
  _setAmbient() {
    for (const h of this.ambientHandles) h?.stop();
    this.ambientHandles = this.ageDef.ambient.map(([id, gain]) =>
      this.ctx.audio.playLoopRaw(id, gain));
  }

  // ============================================================
  //  UI — dynamic toolbar & stats
  // ============================================================

  _buildToolbar() {
    const bar = document.getElementById('god-toolbar');
    bar.innerHTML = '';
    for (const id of this.ageDef.tools) {
      const t = TOOLS[id];
      const btn = document.createElement('button');
      btn.className = 'gt' + (t.kind ? ` ${t.kind}` : '');
      btn.dataset.tool = id;
      const cost = [t.wood ? `${t.wood}🪵` : '', t.faith ? `${t.faith}✦` : ''].filter(Boolean).join(' ');
      btn.innerHTML = `${t.icon}<i>${cost || t.label}</i>`;
      btn.title = t.label + (cost ? ` (${cost})` : '');
      bar.appendChild(btn);
    }
    const adv = this.ageDef.advance;
    if (adv) {
      const next = AGES[this.age];
      const btn = document.createElement('button');
      btn.className = 'gt advance';
      btn.dataset.tool = 'advance';
      btn.innerHTML = `⏫<i>AGE ${next.num}</i>`;
      btn.title = `Advance to the ${next.name} age — ${adv.food}🌾 ${adv.wood}🪵 ${adv.faith}✦ · ${adv.hint}`;
      bar.appendChild(btn);
    }
    bar.querySelector(`[data-tool="${this.tool}"]`)?.classList.add('active');
  }

  _statsUI() {
    const alive = this.villagers.filter((v) => !v.dead);
    document.getElementById('gs-pop').textContent = String(alive.length);
    document.getElementById('gs-food').textContent = String(Math.floor(this.food));
    document.getElementById('gs-wood').textContent = String(Math.floor(this.wood));
    const joy = alive.length ? alive.reduce((s, v) => s + v.joy, 0) / alive.length : 0;
    document.getElementById('gs-joy').textContent = `${Math.round(joy * 100)}%`;
    document.getElementById('gs-faith').textContent = String(Math.floor(this.faith));
    const def = this.ageDef;
    document.getElementById('gs-age').textContent = `${def.num} ${def.name}`;
  }

  // ============================================================
  //  ENTER / EXIT
  // ============================================================

  enter() {
    if (!this._built) this._build();
    const { engine, audio } = this.ctx;
    engine.setScene(this.scene, this.camera);
    engine.grade.uniforms.uVignette.value = 1.0;
    document.getElementById('hud-god').classList.remove('hidden');

    this.controls = this.controls ?? new OrbitControls(this.camera, engine.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(0, 2, 0);
    this.controls.minDistance = 18;
    this.controls.maxDistance = 130;
    this.controls.maxPolarAngle = 1.38;
    this.controls.enablePan = false;
    this.controls.enabled = true;

    this._setAmbient();
    if (this.won) this._winMusic();

    this._onToolClick = (e) => {
      const btn = e.target.closest('.gt');
      if (!btn) return;
      // the toolbar is rebuilt on age-advance; swallow the second click of a
      // double-click on AGE UP so it can't arm (or re-advance) whatever lands there
      if (performance.now() - (this._advT ?? 0) < 400) return;
      if (btn.dataset.tool === 'advance') { this._advanceAge(); return; }
      this.tool = btn.dataset.tool;
      document.querySelectorAll('.gt').forEach((b) => b.classList.toggle('active', b === btn));
      this.ctx.audio.sfx('click');
    };
    document.getElementById('god-toolbar').addEventListener('click', this._onToolClick);

    const canvas = engine.renderer.domElement;
    this._pDown = null;
    this._onPointerDown = (e) => {
      if (e.button !== 0) { this._pDown = null; return; }
      this._pDown = { x: e.clientX, y: e.clientY };
    };
    this._onPointerUp = (e) => {
      if (e.button !== 0) { this._pDown = null; return; }
      if (!this._pDown) return;
      const moved = Math.hypot(e.clientX - this._pDown.x, e.clientY - this._pDown.y);
      this._pDown = null;
      if (moved < 6) this._groundClick(e);
    };
    this._onPointerMove = (e) => {
      this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    };
    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('pointermove', this._onPointerMove);

    // always re-enter unarmed
    this.tool = 'select';
    this._buildToolbar();
    this._statsUI();
    this.ctx.ui.toast(this.age === 1
      ? 'A small tribe gathers around a fire. Guide them through the ages.'
      : 'They believe in you. Do not disappoint them. Or do.');
  }

  exit() {
    document.getElementById('hud-god').classList.add('hidden');
    document.getElementById('god-toolbar').removeEventListener('click', this._onToolClick);
    const canvas = this.ctx.engine.renderer.domElement;
    canvas.removeEventListener('pointerdown', this._onPointerDown);
    canvas.removeEventListener('pointerup', this._onPointerUp);
    canvas.removeEventListener('pointermove', this._onPointerMove);
    this.controls.enabled = false;
    for (const h of this.ambientHandles) h?.stop();
    this.ambientHandles = [];
    this.musicHandles?.forEach((h) => h?.stop());
    this.musicHandles = null;
    this.musicBless = 0;
  }

  // ============================================================
  //  INTERACTION
  // ============================================================

  _groundPoint() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain);
    return hits[0]?.point ?? null;
  }

  _pay(t) {
    const missing = [];
    if (t.wood && this.wood < t.wood) missing.push(`${t.wood}🪵`);
    if (t.faith && this.faith < t.faith) missing.push(`${t.faith}✦`);
    if (missing.length) {
      this.ctx.ui.toast(`Not enough resources (${missing.join(' ')})`);
      this.ctx.audio.sfx('lose', { gain: 0.4 });
      return false;
    }
    this.wood -= t.wood ?? 0;
    this.faith -= t.faith ?? 0;
    this._statsUI();
    return true;
  }

  _groundClick(e) {
    this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    const tool = this.tool;
    const t = TOOLS[tool];

    if (tool === 'select') {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      let best = null, bd = Infinity;
      for (const v of this.villagers) {
        if (v.dead) continue;
        const d = this.raycaster.ray.distanceToPoint(
          v.rig.group.position.clone().add(new THREE.Vector3(0, 1, 0)));
        if (d < 1.2 && d < bd) { bd = d; best = v; }
      }
      if (best) {
        const jobName = { wood: 'lumberjack', food: 'gatherer', vibe: 'vibe keeper' }[best.job] ?? best.job;
        this.ctx.ui.toast(
          `${best.spec.name} — ${jobName} · hunger ${Math.round(best.hunger * 100)}% · joy ${Math.round(best.joy * 100)}%` +
          `${best.sick ? ' · SICK' : ''}`);
      }
      return;
    }

    const p = this._groundPoint();
    if (!p) return;
    const onLand = heightAt(p.x, p.z) > WATER_Y + 1.2 && Math.hypot(p.x, p.z) < ISLAND_R;

    switch (tool) {
      case 'harvest': {
        if (!this.farms.length && !this.berries.length) { this.ctx.ui.toast('Nothing to bless yet'); return; }
        if (!this._pay(t)) return;
        this.ctx.audio.sfx('bless');
        const spots = this._foodSpots();
        for (const f of spots) {
          this.food += 3;
          this.bursts.spawn(f.clone().add(new THREE.Vector3(0, 1.5, 0)),
            { count: 50, colors: [0xffd76e, 0xb6ff8e, 0xfff3c4], speed: 3, gravity: -2 });
        }
        for (const v of this.villagers) v.joy = clamp(v.joy + 0.1, 0, 1);
        this._statsUI();
        this.ctx.ui.toast('The harvest overflows!');
        break;
      }
      case 'music': {
        if (!this._pay(t)) return;
        this.ctx.audio.sfx('bless');
        this.musicBless = 14;
        this.musicHandles?.forEach((h) => h?.stop());
        this.musicHandles = [
          this.ctx.audio.playLoopRaw('thump', 0.4),
          this.ctx.audio.playLoopRaw('chime', 0.35),
          this.ctx.audio.playLoopRaw('nova', 0.3),
        ];
        this.ctx.ui.toast('BLESSING OF MUSIC — the island dances!');
        break;
      }
      case 'lightning': {
        if (!this._pay(t)) return;
        this._strikeLightning(p);
        break;
      }
      case 'meteor': {
        if (!this._pay(t)) return;
        this._launchMeteor(p);
        break;
      }
      case 'plague': {
        if (!this._pay(t)) return;
        this._castPlague(p);
        break;
      }
      default: {
        if (t?.kind !== 'build') return;
        if (tool === 'monument' && this.built.monument) { this.ctx.ui.toast('The monument already stands'); return; }
        if (!onLand) { this.ctx.ui.toast('Cannot build there'); return; }
        if (!this._pay(t)) return;
        this._addBuilding(tool, p);
        break;
      }
    }
  }

  // ============================================================
  //  DIVINE INTERVENTIONS (unchanged powers)
  // ============================================================

  _strikeLightning(p) {
    const { audio } = this.ctx;
    audio.sfx('zap');
    setTimeout(() => audio.sfx('thunder'), 220);
    const pts = [];
    let x = p.x, z = p.z;
    const top = 60;
    for (let i = 0; i <= 8; i++) {
      const y = top - (top - heightAt(p.x, p.z)) * (i / 8);
      pts.push(new THREE.Vector3(x, y, z));
      x += rand(-2.2, 2.2) * (i < 7 ? 1 : 0);
      z += rand(-2.2, 2.2) * (i < 7 ? 1 : 0);
    }
    const bolt = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xeef4ff, transparent: true, opacity: 1 }));
    this.scene.add(bolt);
    const flash = new THREE.PointLight(0xbfd4ff, 800, 60, 1.6);
    flash.position.copy(p).add(new THREE.Vector3(0, 6, 0));
    this.scene.add(flash);
    this.ctx.engine.pulse(1.4);
    this.ctx.engine.addTween((t) => {
      bolt.material.opacity = 1 - t;
      flash.intensity = 800 * (1 - t);
    }, 0.5, {
      onDone: () => { this.scene.remove(bolt, flash); bolt.geometry.dispose(); bolt.material.dispose(); },
    });
    this._scorch(p, 2.2);
    this.bursts.spawn(p.clone().add(new THREE.Vector3(0, 0.5, 0)),
      { count: 60, colors: [0xffffff, 0xbfd4ff, 0xffd76e], speed: 7 });
    for (const v of this.villagers) {
      if (v.dead) continue;
      const d = v.rig.group.position.distanceTo(p);
      if (d < 3.2) { v.health = 0; this._kill(v, 'smitten'); }
      else if (d < 14) { v.panic = 4; v.joy = clamp(v.joy - 0.25, 0, 1); }
    }
  }

  _launchMeteor(p) {
    this.ctx.audio.sfx('meteor');
    const start = p.clone().add(new THREE.Vector3(rand(-30, 30), 75, rand(-30, 30)));
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.6, 0),
      new THREE.MeshStandardMaterial({
        color: 0x3a2a20, emissive: 0xff5a1e, emissiveIntensity: 2.5, roughness: 0.7,
      }));
    rock.position.copy(start);
    const glow = new THREE.PointLight(0xff7a2e, 300, 40, 1.8);
    rock.add(glow);
    this.scene.add(rock);
    this.meteors.push({ mesh: rock, from: start, to: p.clone(), t: 0, dur: 1.15 });
  }

  _impactMeteor(m) {
    const p = m.to;
    this.scene.remove(m.mesh);
    m.mesh.geometry.dispose();
    m.mesh.material.dispose();
    this.ctx.audio.sfx('boomhit');
    this.ctx.engine.pulse(1.6, 0.3);
    this._scorch(p, 5);
    this.bursts.spawn(p.clone().add(new THREE.Vector3(0, 1, 0)),
      { count: 160, colors: [0xff5a1e, 0xffb02e, 0x774433, 0xffffff], speed: 11, gravity: -9, life: 1.7 });
    const ringGeo = new THREE.TorusGeometry(1, 0.35, 8, 40);
    const ring = new THREE.Mesh(ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffa054, transparent: true, opacity: 0.85 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(p).add(new THREE.Vector3(0, 0.4, 0));
    this.scene.add(ring);
    this.ctx.engine.addTween((t) => {
      ring.scale.setScalar(1 + t * 14);
      ring.material.opacity = 0.85 * (1 - t);
    }, 0.9, { onDone: () => { this.scene.remove(ring); ringGeo.dispose(); ring.material.dispose(); } });
    for (const v of this.villagers) {
      if (v.dead) continue;
      const d = v.rig.group.position.distanceTo(p);
      if (d < 6.5) { v.health = 0; this._kill(v, 'meteor'); }
      else if (d < 20) { v.panic = 5; v.joy = clamp(v.joy - 0.35, 0, 1); }
    }
  }

  _castPlague(p) {
    this.ctx.audio.sfx('plague');
    const geo = new THREE.BufferGeometry();
    const N = 240;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = rand(Math.PI * 2), r = Math.sqrt(Math.random()) * 8;
      positions[i * 3] = p.x + Math.cos(a) * r;
      positions[i * 3 + 1] = heightAt(p.x, p.z) + rand(0.3, 3.5);
      positions[i * 3 + 2] = p.z + Math.sin(a) * r;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const cloud = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x6dbb2e, size: 0.5, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.scene.add(cloud);
    this.plagues.push({ cloud, pos: p.clone(), r: 8, life: 12 });
    this.ctx.ui.toast('A sickness spreads…');
  }

  _scorch(p, r) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(r, 24),
      new THREE.MeshBasicMaterial({ color: 0x14100c, transparent: true, opacity: 0.75, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, heightAt(p.x, p.z) + 0.05, p.z);
    this.scene.add(m);
    this.scorches.push(m);
    if (this.scorches.length > 14) {
      const old = this.scorches.shift();
      this.scene.remove(old);
      old.geometry.dispose();
      old.material.dispose();
    }
  }

  // ============================================================
  //  SIM
  // ============================================================

  _simTick() {
    const cap = 4 + this.houseList.reduce((s, h) => s + h.cap, 0);
    let joySum = 0, alive = 0;

    this._assignJobs();

    for (const v of this.villagers) {
      if (v.dead) continue;
      v.hunger = clamp(v.hunger + 0.018, 0, 1);
      if (v.sick) {
        v.health -= 0.045;
        v.joy = clamp(v.joy - 0.04, 0, 1);
        if (Math.random() < 0.07) { v.sick = false; v.rig.setTint('normal'); }
      }
      if (v.hunger >= 1) v.health -= 0.05;
      if (v.health <= 0) { this._kill(v, v.sick ? 'plague' : 'starvation'); continue; }
      if (!v.sick) v.health = clamp(v.health + 0.02, 0, 1);
      alive++;
      // joy: music blessing lifts everyone; vibe keepers generate their own
      v.joy = clamp(v.joy
        + (this.musicBless > 0 ? 0.06 : -0.008)
        + (v.job === 'vibe' ? 0.02 : 0)
        - (v.hunger > 0.8 ? 0.03 : 0), 0, 1);
      joySum += v.joy;
      if (v.joy > 0.6 && this.faith < 300) this.faith += 1;
    }
    // EQ towers hum pure faith — passive income stops at the 300 cap
    if (this.faith < 300) this.faith = Math.min(this.faith + (this.eqTowers ?? 0), 300);

    if (alive > 0 && alive < cap && this.food > alive * 0.4 && (joySum / alive) > 0.55 && Math.random() < 0.45) {
      const nv = this._spawnVillager();
      this.ctx.ui.toast(`${nv.spec.name} was born! ⬤ ${alive + 1}`);
    }
    this._statsUI();
  }

  // ============================================================
  //  PER-FRAME
  // ============================================================

  update(dt) {
    if (!this._built) return;
    const t = this.ctx.engine.time;
    this.skyMat.uniforms.uTime.value = t;
    this.controls.update();

    this._tick += dt;
    if (this._tick > 1.6) { this._tick = 0; this._simTick(); }

    // age palette drift
    const def = this.ageDef;
    const k = clamp(dt * 1.5, 0, 1);
    this.scene.fog.color.lerp(def.fogC, k);
    this.sun.color.lerp(def.sunC, k);
    this.hemi.intensity = lerp(this.hemi.intensity, def.hemi, k);

    // campfire flicker
    if (this.fireLight) {
      this.fireLight.intensity = 24 + Math.sin(t * 9) * 5 + Math.sin(t * 23) * 3;
      this.fireFlame.material.uniforms.uTime.value = t;
      this.fireFlame.scale.y = 1 + Math.sin(t * 7) * 0.12;
    }

    if (this.musicBless > 0) {
      this.musicBless -= dt;
      if (this.musicBless <= 0 && !this.won) {
        this.musicHandles?.forEach((h) => h?.stop());
        this.musicHandles = null;
      }
    }

    // cursor preview
    const aoe = { lightning: 2.6, meteor: 6.5, plague: 8 }[this.tool];
    const isBuild = TOOLS[this.tool]?.kind === 'build';
    const gp = (aoe || isBuild) ? this._groundPoint() : null;
    this.cursorRing.visible = !!(gp && aoe);
    this.ghost.visible = !!(gp && isBuild);
    if (gp && aoe) {
      this.cursorRing.position.set(gp.x, gp.y + 0.15, gp.z);
      this.cursorRing.scale.setScalar(aoe / 3);
      this.cursorRing.material.color.set(this.tool === 'plague' ? 0x6dbb2e : this.tool === 'meteor' ? 0xff7a2e : 0xbfd4ff);
    }
    if (gp && isBuild) {
      const cost = TOOLS[this.tool];
      this.ghost.position.set(gp.x, gp.y + 1.3, gp.z);
      const ok = heightAt(gp.x, gp.z) > WATER_Y + 1.2 && Math.hypot(gp.x, gp.z) < ISLAND_R
        && this.wood >= (cost.wood ?? 0) && this.faith >= (cost.faith ?? 0);
      this.ghost.material.color.set(ok ? 0x7cff9d : 0xff5a5a);
    }

    // trees: respawn cycle
    for (const tree of this.trees) {
      if (tree.alive) continue;
      tree.respawn -= dt;
      if (tree.respawn <= 0) {
        tree.alive = true;
        tree.group.visible = true;
        tree.group.rotation.z = 0;
        const target = tree.baseScale;
        tree.group.scale.setScalar(0.01);
        this.ctx.engine.addTween((tt) => tree.group.scale.setScalar(Math.max(0.01, target * tt)), 1.2);
      }
    }

    // meteors
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t += dt;
      const kk = Math.min(1, m.t / m.dur);
      m.mesh.position.lerpVectors(m.from, m.to, kk * kk);
      m.mesh.rotation.x += dt * 7; m.mesh.rotation.y += dt * 5;
      if (Math.random() < 0.7) {
        this.bursts.spawn(m.mesh.position, { count: 3, colors: [0xff7a2e, 0xffb02e], speed: 1, gravity: 1, life: 0.5, size: 0.2 });
      }
      if (kk >= 1) { this.meteors.splice(i, 1); this._impactMeteor(m); }
    }

    // plague clouds
    for (let i = this.plagues.length - 1; i >= 0; i--) {
      const pl = this.plagues[i];
      pl.life -= dt;
      pl.cloud.material.opacity = 0.5 * clamp(pl.life / 3, 0, 1);
      pl.cloud.rotation.y += dt * 0.3;
      if (pl.life <= 0) {
        this.scene.remove(pl.cloud);
        pl.cloud.geometry.dispose();
        pl.cloud.material.dispose();
        this.plagues.splice(i, 1);
        continue;
      }
      for (const v of this.villagers) {
        if (v.dead || v.sick) continue;
        if (v.rig.group.position.distanceTo(pl.pos) < pl.r) {
          v.sick = true;
          v.rig.setTint('sick');
        }
      }
    }

    // villagers
    const beat = this.ctx.audio.beatPos;
    for (const v of this.villagers) {
      if (v.dead) continue;
      this._updateVillager(v, dt, beat);
    }

    // stage / drum FX
    for (const st of this.stages) {
      const on = this.musicBless > 0 || this.won;
      if (st.ring) st.ring.material.emissiveIntensity = on ? 2 + Math.sin(t * 6) * 1.5 : 1.2;
      for (const cone of st.cones) {
        cone.material.uniforms.uOpacity.value = on ? 0.2 : 0;
        cone.material.uniforms.uTime.value = t;
        cone.rotation.z = Math.sin(t * 1.3 + st.pos.x) * 0.4;
      }
    }
    if (this.monument) {
      this.monument.crystal.rotation.y += dt * 0.8;
      this.monument.halo.rotation.z += dt * 0.4;
      this.monument.crystal.position.y = 3 + Math.sin(t * 1.4) * 0.2;
    }
    if (this.musicBless > 0) this.ctx.engine.pulse(this.ctx.audio.getEnergy().bass * 0.25, 0.1);

    this.bursts.update(dt);
  }

  _updateVillager(v, dt, beat) {
    const pos = v.rig.group.position;
    let anim = 'idle';

    if (v.panic > 0) {
      v.panic -= dt;
      anim = 'panic';
      if (!v._fleeDir || Math.random() < 0.02) {
        const a = rand(Math.PI * 2);
        v._fleeDir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      }
      pos.addScaledVector(v._fleeDir, 6 * dt);
      v.rig.group.rotation.y = Math.atan2(v._fleeDir.x, v._fleeDir.z);
    } else if (this.musicBless > 0 && this.stages.length && v.hunger < 0.85) {
      // everybody parties at the nearest gathering spot
      let nearest = this.stages[0], nd = Infinity;
      for (const st of this.stages) {
        const d = pos.distanceTo(st.pos);
        if (d < nd) { nd = d; nearest = st; }
      }
      if (nd > 6) { this._walkTo(v, nearest.pos, 4, dt); anim = 'walk'; }
      else anim = 'dance';
    } else if (v.hunger > 0.62 && this.food >= 1) {
      // eat at the nearest food spot (farm, berries or the campfire pot)
      const spot = this._nearestOf(pos, [...this._foodSpots(), this.campfire.pos]);
      if (spot && pos.distanceTo(spot) > 2.4) { this._walkTo(v, spot, 3, dt); anim = 'walk'; }
      else {
        anim = 'work';
        v._eatT = (v._eatT ?? 0) + dt;
        if (v._eatT > 1.6) { v._eatT = 0; this.food -= 1; v.hunger = clamp(v.hunger - 0.55, 0, 1); }
      }
    } else if (v.job === 'wood') {
      // lumberjack: find a tree, chop it down
      if (!v.jobTarget || !v.jobTarget.alive) {
        v.jobTarget = this._nearestTree(pos);
        v.workT = 0;
      }
      const tree = v.jobTarget;
      if (!tree) { v.job = 'vibe'; }
      else if (pos.distanceTo(tree.pos) > 2.2) { this._walkTo(v, tree.pos, 2.8, dt); anim = 'walk'; }
      else {
        anim = 'work';
        v.workT += dt;
        tree.group.rotation.z = Math.sin(v.workT * 14) * 0.02;   // chop shake
        if (v.workT > 3.5) {
          v.workT = 0;
          tree.alive = false;
          tree.respawn = rand(35, 50);
          this.wood += 2;
          v.jobTarget = null;
          const grp = tree.group;
          this.ctx.engine.addTween((tt) => { grp.rotation.z = tt * 1.35; }, 0.8, {
            onDone: () => { grp.visible = false; },
          });
          this.bursts.spawn(tree.pos.clone().add(new THREE.Vector3(0, 1.5, 0)),
            { count: 20, colors: [0x6b4a33, 0x3f9152], speed: 3, gravity: -6, life: 0.9 });
          this._statsUI();
        }
      }
    } else if (v.job === 'food') {
      // gatherer: work the nearest farm or berry bush
      const spot = this._nearestOf(pos, this._foodSpots());
      if (!spot) { v.job = 'vibe'; }
      else if (pos.distanceTo(spot) > 2.4) { this._walkTo(v, spot, 2.8, dt); anim = 'walk'; }
      else {
        anim = 'work';
        v.workT += dt;
        if (v.workT > 4) {
          v.workT = 0;
          this.food += 2;
          this.bursts.spawn(spot.clone().add(new THREE.Vector3(0, 1, 0)),
            { count: 10, colors: [0xffd76e, 0xb6ff8e], speed: 1.6, gravity: -3, life: 0.7 });
          this._statsUI();
        }
      }
    } else {
      // vibe keeper: hang out at a gathering spot and keep the groove alive
      const spots = this.stages.length ? this.stages.map((s) => s.pos) : [this.campfire.pos];
      const spot = this._nearestOf(pos, spots);
      if (spot && pos.distanceTo(spot) > 5) { this._walkTo(v, spot, 2.2, dt); anim = 'walk'; }
      else if (spot && pos.distanceTo(spot) < 5) { anim = 'dance'; }
      else {
        v.waitT -= dt;
        const d = Math.hypot(v.target.x - pos.x, v.target.z - pos.z);
        if (d > 1.2) { this._walkTo(v, v.target, v.sick ? 1.2 : 2.4, dt); anim = 'walk'; }
        else if (v.waitT <= 0) {
          const a = rand(Math.PI * 2), r = rand(4, 26);
          v.target.set(clamp(pos.x + Math.cos(a) * r, -50, 50), 0, clamp(pos.z + Math.sin(a) * r, -50, 50));
          v.waitT = rand(2, 6);
        }
      }
    }

    pos.x = clamp(pos.x, -ISLAND_R + 4, ISLAND_R - 4);
    pos.z = clamp(pos.z, -ISLAND_R + 4, ISLAND_R - 4);
    pos.y = damp(pos.y, heightAt(pos.x, pos.z), 12, dt);
    v.rig.update(dt, { anim, beat, energy: 0.7, speed: 2.5 });
  }

  _walkTo(v, target, speed, dt) {
    const pos = v.rig.group.position;
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const d = Math.hypot(dx, dz) || 1;
    pos.x += (dx / d) * speed * dt;
    pos.z += (dz / d) * speed * dt;
    v.rig.group.rotation.y = Math.atan2(dx, dz);
  }
}
