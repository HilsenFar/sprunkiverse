// ============================================================
//  GOD MODE — grow a Sprunki society on a floating island.
//  Bless them (harvest, music) or smite them (lightning,
//  meteors, plague). Faith is your currency.
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

const COSTS = { harvest: 20, music: 25, lightning: 15, meteor: 50, plague: 30, house: 30, farm: 20, stage: 40 };
const SYL_A = ['Bli', 'Splo', 'Wum', 'Ziz', 'Pom', 'Gru', 'Twe', 'Flo', 'Ska', 'Dru'];
const SYL_B = ['p', 'nk', 'bo', 'zz', 'mi', 'ra', 'sh', 'do'];
const HEADS = ['dome', 'cube', 'cone', 'tall', 'wide', 'bulb'];
const ACCS = ['headphones', 'antenna', 'mohawk', 'horns', 'visor', 'halo', 'spikes', 'none'];
const DANCES = ['headbang', 'clap', 'jitter', 'slowsway', 'wobble', 'wave', 'diva', 'sing'];

function randomSpec(i) {
  const hue = Math.random();
  const color = new THREE.Color().setHSL(hue, 0.62, 0.55).getHex();
  const accent = new THREE.Color().setHSL((hue + 0.12) % 1, 0.85, 0.72).getHex();
  return {
    id: `villager${i}`, name: pick(SYL_A) + pick(SYL_B).toUpperCase(),
    color, accent, head: pick(HEADS), acc: pick(ACCS), dance: pick(DANCES),
  };
}

export class GodMode {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 800);
    this.camera.position.set(0, 55, 78);
    this.bursts = new BurstPool(this.scene);
    this.tool = 'select';
    this.faith = 60;
    this.food = 8;
    this.villagers = [];
    this.farms = [];
    this.houseList = [];
    this.stages = [];
    this.meteors = [];
    this.plagues = [];
    this.scorches = [];
    this._tick = 0;
    this._spawned = 0;
    this.musicBless = 0;      // seconds remaining
    this.musicHandles = null;
    this._built = false;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
  }

  // ---------------- build ----------------

  _build() {
    const s = this.scene;
    s.environment = this.ctx.engine.envTex;
    s.environmentIntensity = 0.45;
    s.background = new THREE.Color(0x0d1024);
    s.fog = new THREE.FogExp2(0x141a38, 0.0075);

    // eternal golden-hour sky dome
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

    const sun = new THREE.DirectionalLight(0xffc79a, 2.2);
    sun.position.set(-40, 55, -70);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.far = 300;
    sun.shadow.bias = -0.0004;
    s.add(sun);
    s.add(new THREE.HemisphereLight(0x8899ff, 0x2a1e30, 0.5));

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

    // water
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

    // starting society
    this._addHouse(new THREE.Vector3(6, 0, 4));
    this._addHouse(new THREE.Vector3(-4, 0, -9));
    this._addFarm(new THREE.Vector3(-8, 0, 6));
    this.food = 14;
    for (let i = 0; i < 8; i++) this._spawnVillager();

    this._built = true;
  }

  _addHouse(p) {
    const g = new THREE.Group();
    const y = heightAt(p.x, p.z);
    g.position.set(p.x, y, p.z);
    g.rotation.y = rand(Math.PI * 2);
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 2.4, 3),
      new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.8 }));
    wall.position.y = 1.2;
    wall.castShadow = wall.receiveShadow = true;
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(2.9, 1.7, 4),
      new THREE.MeshStandardMaterial({ color: pick([0xb0524f, 0x5a7fb5, 0x7aa06a]), roughness: 0.75 }));
    roof.position.y = 3.2;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x39362e, emissive: 0xffb35c, emissiveIntensity: 1.4 }));
    win.position.set(0, 1.4, 1.55);
    g.add(wall, roof, win);
    this.scene.add(g);
    this.houseList.push({ group: g, pos: g.position.clone() });
  }

  _addFarm(p) {
    const g = new THREE.Group();
    const y = heightAt(p.x, p.z);
    g.position.set(p.x, y, p.z);
    const soil = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 20),
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
    this.scene.add(g);
    this.farms.push({ group: g, pos: g.position.clone() });
  }

  _addStage(p) {
    const g = new THREE.Group();
    const y = heightAt(p.x, p.z);
    g.position.set(p.x, y, p.z);
    const plat = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3.4, 0.5, 22),
      new THREE.MeshPhysicalMaterial({ color: 0x1c1530, roughness: 0.35, clearcoat: 0.6 }));
    plat.position.y = 0.25;
    plat.castShadow = plat.receiveShadow = true;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.05, 0.08, 8, 40),
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
    this.scene.add(g);
    this.stages.push({ group: g, pos: g.position.clone(), ring, cones });
  }

  _spawnVillager(nearPos = null) {
    // villagers are members of the real Sprunki cast
    const spec = STUDIO_CAST[Math.floor(rand(STUDIO_CAST.length))] ?? randomSpec(this._spawned);
    this._spawned++;
    const rig = createSprunki(spec, { scale: 0.92 });
    rig.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const base = nearPos ?? pick(this.houseList).pos;
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
    // topple + fade, then gravestone
    const rig = v.rig;
    this.ctx.engine.addTween((t) => {
      rig.group.rotation.z = t * Math.PI / 2;
      rig.group.scale.setScalar(0.92 * (1 - t * 0.6));
    }, 1.4, {
      onDone: () => {
        this.scene.remove(rig.group);
        this.villagers = this.villagers.filter((x) => x !== v);
        if (rig.isSprite) {
          rig.mats.forEach((m) => m.dispose?.());   // geometry is shared with the template cache
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

  // ---------------- enter / exit ----------------

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

    this.ambient = audio.playLoopRaw('drift', 0.14);

    this._onToolClick = (e) => {
      const btn = e.target.closest('.gt');
      if (!btn) return;
      this.tool = btn.dataset.tool;
      document.querySelectorAll('.gt').forEach((b) => b.classList.toggle('active', b === btn));
      this.ctx.audio.sfx('click');
    };
    document.getElementById('god-toolbar').addEventListener('click', this._onToolClick);

    const canvas = engine.renderer.domElement;
    this._pDown = null;
    this._onPointerDown = (e) => { this._pDown = { x: e.clientX, y: e.clientY }; };
    this._onPointerUp = (e) => {
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

    // always re-enter unarmed — a remembered meteor tool is a bad surprise
    this.tool = 'select';
    document.querySelectorAll('.gt').forEach((b) =>
      b.classList.toggle('active', b.dataset.tool === 'select'));
    this._statsUI();
    this.ctx.ui.toast('They believe in you. Do not disappoint them. Or do.');
  }

  exit() {
    document.getElementById('hud-god').classList.add('hidden');
    document.getElementById('god-toolbar').removeEventListener('click', this._onToolClick);
    const canvas = this.ctx.engine.renderer.domElement;
    canvas.removeEventListener('pointerdown', this._onPointerDown);
    canvas.removeEventListener('pointerup', this._onPointerUp);
    canvas.removeEventListener('pointermove', this._onPointerMove);
    this.controls.enabled = false;
    this.ambient?.stop();
    this.musicHandles?.forEach((h) => h.stop());
    this.musicHandles = null;
    this.musicBless = 0;
  }

  // ---------------- interaction ----------------

  _groundPoint() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain);
    return hits[0]?.point ?? null;
  }

  _spend(cost) {
    if (this.faith < cost) {
      this.ctx.ui.toast(`Not enough faith (${cost}✦ needed)`);
      this.ctx.audio.sfx('lose', { gain: 0.4 });
      return false;
    }
    this.faith -= cost;
    this._statsUI();
    return true;
  }

  _groundClick(e) {
    this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    const tool = this.tool;

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
        this.ctx.ui.toast(
          `${best.spec.name} — hunger ${Math.round(best.hunger * 100)}% · joy ${Math.round(best.joy * 100)}%` +
          `${best.sick ? ' · SICK' : ''}`);
      }
      return;
    }

    const p = this._groundPoint();
    if (!p) return;
    const onLand = heightAt(p.x, p.z) > WATER_Y + 1.2 && Math.hypot(p.x, p.z) < ISLAND_R;

    switch (tool) {
      case 'harvest': {
        if (!this.farms.length) { this.ctx.ui.toast('Build a farm first'); return; }
        if (!this._spend(COSTS.harvest)) return;
        this.ctx.audio.sfx('bless');
        for (const f of this.farms) {
          this.food += 3;
          this.bursts.spawn(f.pos.clone().add(new THREE.Vector3(0, 1.5, 0)),
            { count: 50, colors: [0xffd76e, 0xb6ff8e, 0xfff3c4], speed: 3, gravity: -2 });
        }
        for (const v of this.villagers) v.joy = clamp(v.joy + 0.1, 0, 1);
        this.ctx.ui.toast('The harvest overflows!');
        break;
      }
      case 'music': {
        if (!this._spend(COSTS.music)) return;
        this.ctx.audio.sfx('bless');
        this.musicBless = 14;
        this.musicHandles?.forEach((h) => h.stop());
        this.musicHandles = [
          this.ctx.audio.playLoopRaw('thump', 0.4),
          this.ctx.audio.playLoopRaw('chime', 0.35),
          this.ctx.audio.playLoopRaw('nova', 0.3),
        ];
        this.ctx.ui.toast('BLESSING OF MUSIC — the island dances!');
        break;
      }
      case 'lightning': {
        if (!this._spend(COSTS.lightning)) return;
        this._strikeLightning(p);
        break;
      }
      case 'meteor': {
        if (!this._spend(COSTS.meteor)) return;
        this._launchMeteor(p);
        break;
      }
      case 'plague': {
        if (!this._spend(COSTS.plague)) return;
        this._castPlague(p);
        break;
      }
      case 'house': case 'farm': case 'stage': {
        if (!onLand) { this.ctx.ui.toast('Cannot build there'); return; }
        if (!this._spend(COSTS[tool])) return;
        if (tool === 'house') this._addHouse(p);
        if (tool === 'farm') this._addFarm(p);
        if (tool === 'stage') this._addStage(p);
        this.ctx.audio.sfx('pop');
        this.bursts.spawn(p.clone().add(new THREE.Vector3(0, 1, 0)),
          { count: 40, colors: [0xffffff, 0xb6ff8e], speed: 3 });
        this._statsUI();
        break;
      }
    }
  }

  // ---------------- divine interventions ----------------

  _strikeLightning(p) {
    const { audio } = this.ctx;
    audio.sfx('zap');
    setTimeout(() => audio.sfx('thunder'), 220);

    // jagged bolt
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
    // shockwave ring
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

  // ---------------- sim ----------------

  _simTick() {
    const cap = 4 + this.houseList.length * 3;
    let joySum = 0, alive = 0;

    // farms grow a little food on their own; blessings dump a lot
    this.food += this.farms.length * 0.4;

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
      if (!v.sick) v.health = clamp(v.health + 0.02, 0, 1);   // slow natural recovery
      alive++;                                                // count survivors only
      // joy drifts by circumstance
      v.joy = clamp(v.joy + (this.musicBless > 0 ? 0.06 : -0.008) - (v.hunger > 0.8 ? 0.03 : 0), 0, 1);
      joySum += v.joy;
      if (v.joy > 0.6) this.faith += 1;
    }

    // growth
    if (alive > 0 && alive < cap && this.food > alive * 0.4 && (joySum / alive) > 0.55 && Math.random() < 0.45) {
      const nv = this._spawnVillager();
      this.ctx.ui.toast(`${nv.spec.name} was born! ⬤ ${alive + 1}`);
    }
    this._statsUI();
  }

  _statsUI() {
    const alive = this.villagers.filter((v) => !v.dead);
    document.getElementById('gs-pop').textContent = String(alive.length);
    document.getElementById('gs-food').textContent = String(Math.floor(this.food));
    const joy = alive.length ? alive.reduce((s, v) => s + v.joy, 0) / alive.length : 0;
    document.getElementById('gs-joy').textContent = `${Math.round(joy * 100)}%`;
    document.getElementById('gs-faith').textContent = String(Math.floor(this.faith));
  }

  // ---------------- per-frame ----------------

  update(dt) {
    if (!this._built) return;
    const t = this.ctx.engine.time;
    this.skyMat.uniforms.uTime.value = t;
    this.controls.update();

    this._tick += dt;
    if (this._tick > 1.6) { this._tick = 0; this._simTick(); }

    if (this.musicBless > 0) {
      this.musicBless -= dt;
      if (this.musicBless <= 0) {
        this.musicHandles?.forEach((h) => h.stop());
        this.musicHandles = null;
      }
    }

    // cursor preview
    const aoe = { lightning: 2.6, meteor: 6.5, plague: 8, harvest: 0, music: 0 }[this.tool];
    const isBuild = ['house', 'farm', 'stage'].includes(this.tool);
    const gp = (aoe || isBuild) ? this._groundPoint() : null;
    this.cursorRing.visible = !!(gp && aoe);
    this.ghost.visible = !!(gp && isBuild);
    if (gp && aoe) {
      this.cursorRing.position.set(gp.x, gp.y + 0.15, gp.z);
      this.cursorRing.scale.setScalar(aoe / 3);
      this.cursorRing.material.color.set(this.tool === 'plague' ? 0x6dbb2e : this.tool === 'meteor' ? 0xff7a2e : 0xbfd4ff);
    }
    if (gp && isBuild) {
      this.ghost.position.set(gp.x, gp.y + 1.3, gp.z);
      const ok = heightAt(gp.x, gp.z) > WATER_Y + 1.2 && Math.hypot(gp.x, gp.z) < ISLAND_R && this.faith >= COSTS[this.tool];
      this.ghost.material.color.set(ok ? 0x7cff9d : 0xff5a5a);
    }

    // meteors
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      m.mesh.position.lerpVectors(m.from, m.to, k * k);
      m.mesh.rotation.x += dt * 7; m.mesh.rotation.y += dt * 5;
      if (Math.random() < 0.7) {
        this.bursts.spawn(m.mesh.position, { count: 3, colors: [0xff7a2e, 0xffb02e], speed: 1, gravity: 1, life: 0.5, size: 0.2 });
      }
      if (k >= 1) { this.meteors.splice(i, 1); this._impactMeteor(m); }
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
      const pos = v.rig.group.position;
      let anim = 'idle';

      if (v.panic > 0) {
        v.panic -= dt;
        anim = 'panic';
        // flee from island center of last strike — just scatter
        if (!v._fleeDir || Math.random() < 0.02) {
          const a = rand(Math.PI * 2);
          v._fleeDir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        }
        pos.addScaledVector(v._fleeDir, 6 * dt);
        v.rig.group.rotation.y = Math.atan2(v._fleeDir.x, v._fleeDir.z);
      } else if (this.musicBless > 0 && this.stages.length) {
        // gather at the nearest stage and dance
        let nearest = this.stages[0];
        let nd = Infinity;
        for (const st of this.stages) {
          const d = pos.distanceTo(st.pos);
          if (d < nd) { nd = d; nearest = st; }
        }
        if (nd > 6) { this._walkTo(v, nearest.pos, 4, dt); anim = 'walk'; }
        else anim = 'dance';
      } else if (v.hunger > 0.6 && this.food >= 1 && this.farms.length) {
        let nearest = this.farms[0], nd = Infinity;
        for (const f of this.farms) {
          const d = pos.distanceTo(f.pos);
          if (d < nd) { nd = d; nearest = f; }
        }
        if (nd > 2.4) { this._walkTo(v, nearest.pos, 3, dt); anim = 'walk'; }
        else {
          anim = 'work';
          v._eatT = (v._eatT ?? 0) + dt;
          if (v._eatT > 1.6) { v._eatT = 0; this.food -= 1; v.hunger = clamp(v.hunger - 0.55, 0, 1); }
        }
      } else if (this.musicBless > 0) {
        anim = 'dance';
      } else {
        // wander
        v.waitT -= dt;
        const d = Math.hypot(v.target.x - pos.x, v.target.z - pos.z);
        if (d > 1.2) { this._walkTo(v, v.target, v.sick ? 1.2 : 2.4, dt); anim = 'walk'; }
        else if (v.waitT <= 0) {
          const a = rand(Math.PI * 2), r = rand(4, 26);
          v.target.set(clamp(pos.x + Math.cos(a) * r, -50, 50), 0, clamp(pos.z + Math.sin(a) * r, -50, 50));
          v.waitT = rand(2, 6);
        }
      }

      pos.x = clamp(pos.x, -ISLAND_R + 4, ISLAND_R - 4);
      pos.z = clamp(pos.z, -ISLAND_R + 4, ISLAND_R - 4);
      pos.y = damp(pos.y, heightAt(pos.x, pos.z), 12, dt);
      v.rig.update(dt, { anim, beat, energy: 0.7, speed: 2.5 });
    }

    // stage FX during music blessing
    for (const st of this.stages) {
      const on = this.musicBless > 0;
      st.ring.material.emissiveIntensity = on ? 2 + Math.sin(t * 6) * 1.5 : 1.2;
      for (const cone of st.cones) {
        cone.material.uniforms.uOpacity.value = on ? 0.2 : 0;
        cone.material.uniforms.uTime.value = t;
        cone.rotation.z = Math.sin(t * 1.3 + st.pos.x) * 0.4;
      }
    }
    if (this.musicBless > 0) this.ctx.engine.pulse(this.ctx.audio.getEnergy().bass * 0.25, 0.1);

    this.bursts.update(dt);
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
