// ============================================================
//  SPRUNKI WARS — a real-time strategy skirmish that fuses the
//  two RTS reference games from G:\RTS-Projekt:
//
//   • Age of Empires II  → a DATA-DRIVEN economy: workers gather,
//     buildings train units, and every unit/building is a plain
//     data record the generic sim reads (UNITS / BUILDINGS below),
//     exactly the "everything that can be data, IS data" pattern.
//   • Red Alert 3        → open FACTION WAR: two armies, a live AI
//     opponent that mines, trains and sends escalating attack
//     waves, and a base you must level to win.
//
//  The Sprunki twist: your army are the classic characters; the
//  enemy faction THE STATIC are the same characters run through
//  the rig's existing 'corrupt'/'void' tint. Gather ♪ BEATS, build
//  a band, and tear down the enemy Main Stage.
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, lerp, damp, rand, pick, fbm, BurstPool, IS_TOUCH } from '../core/utils.js';
import { createSprunki, CHAR_BY_ID, makeCustomSpec } from '../characters.js';

const PLAYER = 'player';
const ENEMY = 'enemy';
const BOUND_X = 92;      // battlefield half-width (XZ clamp)
const BOUND_Z = 90;
const UNIT_CAP = 60;     // per-faction hard cap (perf + pacing)

// ------------------------------------------------------------
//  Unit roster — pure data (AoE2 lesson). `char` maps to a
//  Sprunki spec in characters.js; the sim never hard-codes stats.
// ------------------------------------------------------------
const UNITS = {
  roadie:    { name: 'ROADIE',    char: 'tunner', role: 'worker',   cost: 50,  build: 4,  hp: 70,  speed: 8.5, dmg: 5,  range: 1.8, cd: 1.1, aggro: 0,  r: 0.7, icon: '🎚️' },
  thumper:   { name: 'THUMPER',   char: 'thump',  role: 'melee',    cost: 75,  build: 6,  hp: 190, speed: 7.5, dmg: 16, range: 2.0, cd: 0.85, aggro: 17, r: 0.85, icon: '🥁' },
  wobbler:   { name: 'WOBBLER',   char: 'wobb',   role: 'ranged',   cost: 90,  build: 7,  hp: 90,  speed: 7,   dmg: 13, range: 15, cd: 1.15, aggro: 19, r: 0.7, proj: 0xffe28a, icon: '🌊' },
  chorister: { name: 'CHORISTER', char: 'chime',  role: 'healer',   cost: 100, build: 8,  hp: 100, speed: 7.5, dmg: 0,  range: 0,  cd: 0,    aggro: 0,  r: 0.7, heal: 14, healR: 11, healCd: 1.1, icon: '💠' },
  diva:      { name: 'DIVA',      char: 'voxo',   role: 'artillery',cost: 150, build: 11, hp: 80,  speed: 5,   dmg: 46, range: 24, cd: 2.5, aggro: 26, r: 0.8, proj: 0xffd9e8, aoe: 4.5, icon: '🎤' },
};

// ------------------------------------------------------------
//  Buildings — also data. `trains` lists producible unit keys.
// ------------------------------------------------------------
const BUILDINGS = {
  stage:  { name: 'MAIN STAGE', hp: 2200, r: 5.5, trains: ['roadie'], depot: true, isMain: true, barY: 8.5 },
  studio: { name: 'STUDIO',     hp: 750,  r: 3.6, trains: ['thumper', 'wobbler', 'chorister', 'diva'], cost: 150, barY: 6 },
};

const FACTION = {
  [PLAYER]: { color: 0x35e0ff, name: 'YOUR BAND', tint: null },
  [ENEMY]:  { color: 0xff4d6d, name: 'THE STATIC', tint: 'corrupt' },
};

const CARRY = 12;          // beats a roadie hauls per trip
const MINE_RATE = 11;      // beats mined per second while at a node

export class WarsMode {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 1400);
    this.camera.position.set(0, 84, 118);
    this.camera.userData.baseFov = 48;
    this.bursts = new BurstPool(this.scene);

    this.entities = new THREE.Group();   // all unit + building groups (raycast target)
    this.scene.add(this.entities);
    this.bars = new THREE.Group();       // screen-facing health bars (decoupled from facing)
    this.scene.add(this.bars);

    this.units = [];
    this.buildings = [];
    this.nodes = [];
    this.projectiles = [];
    this.selected = new Set();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.keys = new Set();

    this._built = false;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._statT = 0;
  }

  // ============================================================
  //  BUILD — static world (once)
  // ============================================================
  _build() {
    const s = this.scene;
    s.environment = this.ctx.engine.envTex;
    s.environmentIntensity = 0.4;
    s.background = new THREE.Color(0x090b16);
    s.fog = new THREE.FogExp2(0x0b0e1e, 0.0042);

    this.sun = new THREE.DirectionalLight(0xdfe6ff, 2.1);
    this.sun.position.set(-50, 90, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.far = 360;
    this.sun.shadow.bias = -0.0004;
    s.add(this.sun);
    s.add(new THREE.HemisphereLight(0x9fb0ff, 0x241a30, 0.55));

    // battlefield: player half glows cyan, enemy half red, neutral middle
    const SIZE = 230, SEG = 90;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(0x1b2030), cyan = new THREE.Color(0x123a44), red = new THREE.Color(0x3a1622);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, fbm(x * 0.03, z * 0.03, 3) * 0.9);
      const n = fbm(x * 0.08 + 40, z * 0.08, 3) * 0.5 + 0.5;
      c.copy(base).lerp(new THREE.Color(0x14182a), n);
      const side = clamp((z - 30) / 55, 0, 1);       // toward player
      const eside = clamp((-z - 30) / 55, 0, 1);      // toward enemy
      c.lerp(cyan, side * 0.6).lerp(red, eside * 0.6);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }));
    this.ground.receiveShadow = true;
    s.add(this.ground);

    // command markers (move = cyan ring, attack = red ring)
    this.moveMark = this._ringMark(0x35e0ff);
    this.atkMark = this._ringMark(0xff4d6d);

    // build ghost for placing studios
    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(6, 4, 6),
      new THREE.MeshBasicMaterial({ color: 0x7cffbd, transparent: true, opacity: 0.28, depthWrite: false }));
    this.ghost.visible = false;
    s.add(this.ghost);

    this._built = true;
  }

  _ringMark(color) {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.16, 8, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    m.rotation.x = Math.PI / 2;
    m.visible = false;
    m.userData.t = 0;
    this.scene.add(m);
    return m;
  }

  // ============================================================
  //  MATCH SETUP — dynamic state (enter + restart)
  // ============================================================
  _startMatch() {
    // wipe any previous match
    for (const u of this.units) this._disposeEntity(u);
    for (const b of this.buildings) this._disposeEntity(b);
    for (const n of this.nodes) { this.scene.remove(n.group); this._disposeObj(n.group); }
    for (const p of this.projectiles) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    this.units.length = 0; this.buildings.length = 0;
    this.nodes.length = 0; this.projectiles.length = 0;
    this.selected.clear();

    this.beats = { [PLAYER]: 260, [ENEMY]: 260 };
    this.dmgMul = { [PLAYER]: 1, [ENEMY]: 1 };
    this.ampBought = false;
    this.over = null;
    this.time = 0;
    this.place = null;
    this._aiTick = 3;
    this._waveTimer = 40;

    // resource nodes: two per base + three contested in the middle
    this._addNode(new THREE.Vector3(-26, 0, 68));
    this._addNode(new THREE.Vector3(26, 0, 68));
    this._addNode(new THREE.Vector3(-26, 0, -68));
    this._addNode(new THREE.Vector3(26, 0, -68));
    this._addNode(new THREE.Vector3(0, 0, 0));
    this._addNode(new THREE.Vector3(-42, 0, 6));
    this._addNode(new THREE.Vector3(42, 0, -6));

    // bases (mirrored)
    for (const [fac, zc] of [[PLAYER, 74], [ENEMY, -74]]) {
      const main = this._addBuilding(fac, 'stage', new THREE.Vector3(0, 0, zc));
      this._addBuilding(fac, 'studio', new THREE.Vector3(fac === PLAYER ? -22 : 22, 0, zc - Math.sign(zc) * 4));
      main.rally = new THREE.Vector3(0, 0, zc - Math.sign(zc) * 12);
      // starting force
      for (let i = 0; i < 4; i++) this._spawnUnit(fac, 'roadie', new THREE.Vector3(rand(-8, 8), 0, zc - Math.sign(zc) * 10));
      for (let i = 0; i < 2; i++) this._spawnUnit(fac, 'thumper', new THREE.Vector3(rand(-10, 10), 0, zc - Math.sign(zc) * 16));
    }
    this._mainOf = {
      [PLAYER]: this.buildings.find((b) => b.faction === PLAYER && b.def.isMain),
      [ENEMY]: this.buildings.find((b) => b.faction === ENEMY && b.def.isMain),
    };
  }

  _addNode(pos) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const stackMat = new THREE.MeshStandardMaterial({ color: 0x0e1420, roughness: 0.5, metalness: 0.4 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: 0x6fc9ff, emissiveIntensity: 2.4, roughness: 0.4 });
    for (let i = 0; i < 3; i++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.2 - i * 0.3, 1.1, 2.2 - i * 0.3), stackMat);
      box.position.y = 0.6 + i * 1.15; box.castShadow = true;
      g.add(box);
      const cone = new THREE.Mesh(new THREE.CircleGeometry(0.6 - i * 0.08, 18), glowMat);
      cone.position.set(0, 0.6 + i * 1.15, (2.2 - i * 0.3) / 2 + 0.01);
      g.add(cone);
    }
    this.scene.add(g);
    this.nodes.push({ group: g, amount: 1600, glowMat, _b: rand(10) });
  }

  // ============================================================
  //  ENTITIES
  // ============================================================
  _spawnUnit(faction, key, pos) {
    if (this.units.filter((u) => u.faction === faction && u.alive).length >= UNIT_CAP) return null;
    const def = UNITS[key];
    const spec = CHAR_BY_ID[def.char] ?? makeCustomSpec(key, def.name, 'beat', 0);
    const rig = createSprunki(spec, { scale: def.r > 0.8 ? 1.05 : 0.95 });
    if (FACTION[faction].tint) rig.setTint(FACTION[faction].tint);
    const g = rig.group;
    g.position.copy(pos); g.position.y = 0;
    this.entities.add(g);

    const u = {
      faction, key, def, rig, group: g, alive: true,
      hp: def.hp, maxHp: def.hp,
      vel: new THREE.Vector3(),
      moveTo: null, attackMove: false, target: null, gather: null,
      carry: 0, mineT: 0, cd: rand(0, def.cd), healCd: def.healCd ?? 0,
      heading: faction === PLAYER ? 0 : Math.PI,
      hitFlash: 0, anim: 'idle',
    };
    g.userData.owner = u;

    // selection ring (flat under feet) + faction footpad
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(def.r + 0.5, 0.09, 6, 24),
      new THREE.MeshBasicMaterial({ color: FACTION[faction].color, transparent: true, opacity: 0.95 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; ring.visible = false;
    g.add(ring);
    u.ring = ring;
    u.bar = this._makeBar(faction, 1.5);
    u.barY = 2.5;
    this.units.push(u);
    return u;
  }

  _addBuilding(faction, key, pos) {
    const def = BUILDINGS[key];
    const g = new THREE.Group();
    g.position.copy(pos);
    const col = FACTION[faction].color;
    const shell = new THREE.MeshStandardMaterial({ color: 0x10131f, roughness: 0.6, metalness: 0.3 });
    const neon = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.2, roughness: 0.4 });

    if (def.isMain) {
      const plat = new THREE.Mesh(new THREE.CylinderGeometry(def.r + 1, def.r + 1.6, 1.4, 28), shell);
      plat.position.y = 0.7; plat.castShadow = true; plat.receiveShadow = true; g.add(plat);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(11, 6, 1.8), shell);
      wall.position.set(0, 4, -Math.sign(pos.z) * (def.r - 1)); wall.castShadow = true; g.add(wall);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, 0.3), neon);
      sign.position.set(0, 6.2, -Math.sign(pos.z) * (def.r - 1.8)); g.add(sign);
      for (const sx of [-1, 1]) {
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4, 2.4), shell);
        cab.position.set(sx * (def.r - 0.5), 2.7, 0); cab.castShadow = true; g.add(cab);
        const cone = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), neon);
        cone.position.set(sx * (def.r - 0.5), 3.4, 1.21); cone.rotation.y = 0; g.add(cone);
      }
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), shell);
      box.position.y = 2; box.castShadow = true; box.receiveShadow = true; g.add(box);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3), neon);
      door.position.set(0, 1.6, 3.01 * -Math.sign(pos.z)); door.rotation.y = pos.z > 0 ? Math.PI : 0; g.add(door);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 6), shell);
      ant.position.set(0, 5.5, 0); g.add(ant);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), neon);
      tip.position.set(0, 7, 0); g.add(tip);
    }
    this.entities.add(g);

    const b = {
      faction, key, def, group: g, isBuilding: true, alive: true,
      hp: def.hp, maxHp: def.hp,
      queue: [], building: null, progress: 0,
      rally: new THREE.Vector3(pos.x, 0, pos.z - Math.sign(pos.z || 1) * 10),
    };
    g.userData.owner = b;
    b.bar = this._makeBar(faction, 3);
    b.barY = def.barY;
    this.buildings.push(b);
    return b;
  }

  _makeBar(faction, width) {
    const grp = new THREE.Group();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width * 0.11 + 0.05),
      new THREE.MeshBasicMaterial({ color: 0x0a0c16, transparent: true, opacity: 0.85, depthTest: false }));
    bg.renderOrder = 20; grp.add(bg);
    const fillGeo = new THREE.PlaneGeometry(width, width * 0.11 - 0.02);
    fillGeo.translate(width / 2, 0, 0);      // pivot at left edge
    const fill = new THREE.Mesh(fillGeo,
      new THREE.MeshBasicMaterial({ color: FACTION[faction].color, transparent: true, depthTest: false }));
    fill.position.set(-width / 2, 0, 0.01); fill.renderOrder = 21;
    grp.add(fill);
    grp.userData = { fill, width, mat: fill.material };
    this.bars.add(grp);
    return grp;
  }

  _disposeEntity(o) {
    this.entities.remove(o.group);
    if (o.bar) { this.bars.remove(o.bar); this._disposeObj(o.bar); }
    if (o.isBuilding) {
      // building meshes use per-instance geometries — safe to dispose all
      this._disposeObj(o.group);
    } else {
      // unit rig geometries are the SHARED module-level `G` set — never dispose
      // those; only the per-unit ring + the rig's per-instance materials
      if (o.ring) { o.ring.geometry.dispose(); o.ring.material.dispose(); }
      if (o.rig?.mats) for (const k in o.rig.mats) o.rig.mats[k].dispose?.();
    }
  }

  _disposeObj(root) {
    root.traverse((m) => {
      if (!m.isMesh) return;
      m.geometry?.dispose?.();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x?.dispose?.());
    });
  }

  // ============================================================
  //  ENTER / EXIT
  // ============================================================
  enter() {
    if (!this._built) this._build();
    this._startMatch();
    const { engine } = this.ctx;
    engine.setScene(this.scene, this.camera);
    engine.grade.uniforms.uVignette.value = 1.05;
    document.getElementById('hud-wars').classList.remove('hidden');
    document.getElementById('wars-result').classList.add('hidden');

    this.controls = this.controls ?? new OrbitControls(this.camera, engine.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 52);
    this.controls.minDistance = 40;
    this.controls.maxDistance = 210;
    this.controls.maxPolarAngle = 1.28;
    this.controls.enablePan = false;
    // RTS mouse map: left = select/box, right = command, MIDDLE-drag = orbit
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null };
    this.controls.enabled = true;

    this._bindInput();
    this._buildToolbar();
    this._statsUI();

    // war-drum ambience (null-safe: buffers may not be ready yet)
    const a = this.ctx.audio;
    this.ambient = [a.playLoopRaw?.('thump', 0.09), a.playLoopRaw?.('boom', 0.07)].filter(Boolean);

    this.ctx.ui.toast('SPRUNKI WARS — gather ♪, build a band, level THE STATIC\'s Main Stage.', 4200);
  }

  exit() {
    document.getElementById('hud-wars').classList.add('hidden');
    this._unbindInput();
    if (this.controls) this.controls.enabled = false;
    for (const h of this.ambient ?? []) h?.stop?.(0.4);
    this.ambient = [];
  }

  // ============================================================
  //  INPUT
  // ============================================================
  _bindInput() {
    const canvas = this.ctx.engine.renderer.domElement;
    this._down = null; this._dragging = false;
    const box = document.getElementById('wars-select-box');

    this._onDown = (e) => {
      if (e.button === 1) return;                 // middle → let OrbitControls orbit
      this._down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button, touch: e.pointerType === 'touch' };
    };
    this._onMove = (e) => {
      this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      if (this.place) return;
      if (!this._down || this._down.button !== 0 || this._down.touch) return;
      const dx = e.clientX - this._down.x, dy = e.clientY - this._down.y;
      if (!this._dragging && Math.hypot(dx, dy) > 8) this._dragging = true;
      if (this._dragging) {
        const x = Math.min(e.clientX, this._down.x), y = Math.min(e.clientY, this._down.y);
        box.style.cssText = `display:block;left:${x}px;top:${y}px;width:${Math.abs(dx)}px;height:${Math.abs(dy)}px`;
      }
    };
    this._onUp = (e) => {
      if (e.button === 1 || !this._down) { this._down = null; return; }
      box.style.display = 'none';
      const d = this._down; this._down = null;
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (this._dragging) { this._dragging = false; this._boxSelect(d.x, d.y, e.clientX, e.clientY); return; }
      if (moved > 8) return;
      if (this.place) { this._placeBuilding(e); return; }
      if (d.button === 2) { this._command(e); return; }
      if (d.touch) { this._touchTap(e); return; }
      this._selectClick(e);
    };
    this._onCtx = (e) => e.preventDefault();
    this._onKey = (e) => {
      this.keys.add(e.code);
      if (e.code === 'Escape' && this.place) { this._cancelPlace(); e.stopPropagation(); }
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);

    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('contextmenu', this._onCtx);
    addEventListener('keydown', this._onKey);
    addEventListener('keyup', this._onKeyUp);

    this._onToolClick = (e) => {
      const btn = e.target.closest('.gt'); if (!btn) return;
      this.ctx.audio.sfx('click');
      if (btn.dataset.build) { this._beginPlace(btn.dataset.build); return; }
      if (btn.dataset.tech) { this._buyTech(btn.dataset.tech); return; }
      if (btn.dataset.unit) this._train(btn.dataset.unit);
    };
    document.getElementById('wars-toolbar').addEventListener('click', this._onToolClick);
    document.getElementById('wars-restart').onclick = () => { this.ctx.audio.sfx('click'); this._startMatch(); this._buildToolbar(); this._statsUI(); document.getElementById('wars-result').classList.add('hidden'); };
  }

  _unbindInput() {
    const canvas = this.ctx.engine.renderer.domElement;
    canvas.removeEventListener('pointerdown', this._onDown);
    canvas.removeEventListener('pointermove', this._onMove);
    canvas.removeEventListener('pointerup', this._onUp);
    canvas.removeEventListener('contextmenu', this._onCtx);
    removeEventListener('keydown', this._onKey);
    removeEventListener('keyup', this._onKeyUp);
    document.getElementById('wars-toolbar').removeEventListener('click', this._onToolClick);
    this.keys.clear();
  }

  // ---- picking helpers ----
  _ndc(cx, cy) { return this.pointer.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1); }

  _pickEntity(cx, cy) {
    this.raycaster.setFromCamera(this._ndc(cx, cy), this.camera);
    const hits = this.raycaster.intersectObjects(this.entities.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.owner) o = o.parent;
      if (o && o.userData.owner.alive) return o.userData.owner;
    }
    return null;
  }

  _pickGround(cx, cy) {
    this.raycaster.setFromCamera(this._ndc(cx, cy), this.camera);
    const h = this.raycaster.intersectObject(this.ground, false)[0];
    return h ? h.point : null;
  }

  _selectClick(e) {
    const ent = this._pickEntity(e.clientX, e.clientY);
    if (!e.shiftKey) this._clearSelection();
    if (ent && ent.faction === PLAYER && !ent.isBuilding) {
      this.selected.add(ent); ent.ring.visible = true;
    }
    this._statsUI();
  }

  _touchTap(e) {
    const ent = this._pickEntity(e.clientX, e.clientY);
    if (ent && ent.faction === PLAYER && !ent.isBuilding && this.selected.size === 0) {
      this.selected.add(ent); ent.ring.visible = true; this._statsUI(); return;
    }
    if (this.selected.size > 0) { this._command(e); return; }
    if (ent && ent.faction === PLAYER && !ent.isBuilding) { this.selected.add(ent); ent.ring.visible = true; this._statsUI(); }
  }

  _clearSelection() {
    for (const u of this.selected) if (u.ring) u.ring.visible = false;
    this.selected.clear();
  }

  _boxSelect(x0, y0, x1, y1) {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    this._clearSelection();
    for (const u of this.units) {
      if (u.faction !== PLAYER || !u.alive) continue;
      this._tmp.copy(u.group.position); this._tmp.y = 1.2;
      this._tmp.project(this.camera);
      const sx = (this._tmp.x * 0.5 + 0.5) * innerWidth;
      const sy = (-this._tmp.y * 0.5 + 0.5) * innerHeight;
      if (this._tmp.z < 1 && sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
        this.selected.add(u); u.ring.visible = true;
      }
    }
    this._statsUI();
  }

  _command(e) {
    if (this.selected.size === 0) return;
    const ent = this._pickEntity(e.clientX, e.clientY);
    if (ent && ent.faction === ENEMY) {
      // attack order
      for (const u of this.selected) { u.target = ent; u.moveTo = null; u.attackMove = false; u.gather = null; }
      this._flashMark(this.atkMark, ent.group.position);
      this.ctx.audio.sfx('click');
      return;
    }
    if (ent && ent.faction === PLAYER && ent.isBuilding && ent.def.depot) {
      // right-click own depot with roadies → resume gathering the nearest node
      let sent = false;
      for (const u of this.selected) if (u.def.role === 'worker') { u.gather = this._nearestNode(u.group.position); u.moveTo = null; u.target = null; sent = true; }
      if (sent) { this._flashMark(this.moveMark, ent.group.position); this.ctx.audio.sfx('click'); return; }
    }
    const p = this._pickGround(e.clientX, e.clientY);
    if (!p) return;
    if (ent && ent.faction === PLAYER && !ent.isBuilding) return; // clicked a friendly unit: no-op
    // node under cursor? send workers to mine it
    const node = this._nodeAt(p);
    for (const u of this.selected) {
      u.target = null;
      if (node && u.def.role === 'worker') { u.gather = node; u.moveTo = null; }
      else { u.moveTo = p.clone(); u.attackMove = u.def.role !== 'worker'; u.gather = null; }
    }
    this._flashMark(this.moveMark, node ? node.group.position : p);
    this.ctx.audio.sfx('click');
  }

  _flashMark(mark, pos) { mark.position.set(pos.x, 0.1, pos.z); mark.visible = true; mark.userData.t = 0.7; mark.scale.setScalar(1); }

  // ============================================================
  //  PRODUCTION / ECONOMY
  // ============================================================
  _train(key) {
    if (this.over) return;
    const def = UNITS[key];
    const b = this._pickTrainer(PLAYER, key);
    if (!b) { this.ctx.ui.toast('Build a STUDIO to train that unit.'); return; }
    if (this.units.filter((u) => u.faction === PLAYER && u.alive).length + this._queued(PLAYER) >= UNIT_CAP) {
      this.ctx.ui.toast('Army at maximum.'); return;
    }
    if (this.beats[PLAYER] < def.cost) { this.ctx.ui.toast(`Need ${def.cost} ♪ for ${def.name}.`); return; }
    this.beats[PLAYER] -= def.cost;
    b.queue.push(key);
    this._statsUI();
  }

  _pickTrainer(faction, key) {
    const cand = this.buildings.filter((b) => b.faction === faction && b.alive && b.def.trains.includes(key));
    if (!cand.length) return null;
    return cand.reduce((a, b) => ((b.queue.length + (b.building ? 1 : 0)) < (a.queue.length + (a.building ? 1 : 0)) ? b : a));
  }

  _queued(faction) {
    let n = 0;
    for (const b of this.buildings) if (b.faction === faction) n += b.queue.length + (b.building ? 1 : 0);
    return n;
  }

  _buyTech(tech) {
    if (tech !== 'amp' || this.ampBought || this.over) return;
    const cost = 200;
    if (this.beats[PLAYER] < cost) { this.ctx.ui.toast('Need 200 ♪ for AMP UP.'); return; }
    this.beats[PLAYER] -= cost;
    this.ampBought = true;
    this.dmgMul[PLAYER] = 1.3;
    this.ctx.audio.sfx('bless');
    this.ctx.ui.toast('AMP UP — every unit in your band hits 30% harder.');
    this._buildToolbar(); this._statsUI();
  }

  _beginPlace(key) {
    if (this.over) return;
    const def = BUILDINGS[key];
    if (this.beats[PLAYER] < def.cost) { this.ctx.ui.toast(`Need ${def.cost} ♪ for ${def.name}.`); return; }
    this.place = key;
    this.ghost.visible = true;
    this.ctx.ui.toast('Click your half of the field to raise the STUDIO. (Esc cancels)');
  }

  _cancelPlace() { this.place = null; this.ghost.visible = false; }

  _placeBuilding(e) {
    const p = this._pickGround(e.clientX, e.clientY);
    const key = this.place;
    if (!p) return;
    if (p.z < 20) { this.ctx.ui.toast('Build on your own half (nearer your Main Stage).'); return; }
    const def = BUILDINGS[key];
    if (this.beats[PLAYER] < def.cost) { this._cancelPlace(); return; }
    this.beats[PLAYER] -= def.cost;
    const b = this._addBuilding(PLAYER, key, new THREE.Vector3(clamp(p.x, -BOUND_X, BOUND_X), 0, clamp(p.z, 24, BOUND_Z)));
    this.bursts.spawn(b.group.position.clone().setY(2), { count: 40, colors: [0x35e0ff, 0x7cffbd], speed: 6, life: 1 });
    this.ctx.audio.sfx('pop');
    this._cancelPlace(); this._statsUI();
  }

  _updateBuilding(b, dt) {
    if (!b.alive) return;
    if (!b.building && b.queue.length) { b.building = b.queue.shift(); b.progress = 0; }
    if (b.building) {
      b.progress += dt / UNITS[b.building].build;
      if (b.progress >= 1) {
        const key = b.building; b.building = null; b.progress = 0;
        const off = new THREE.Vector3(rand(-3, 3), 0, 0).add(b.rally);
        const u = this._spawnUnit(b.faction, key, new THREE.Vector3(clamp(off.x, -BOUND_X, BOUND_X), 0, clamp(off.z, -BOUND_Z, BOUND_Z)));
        if (u) {
          this.bursts.spawn(u.group.position.clone().setY(1.5), { count: 20, colors: [FACTION[b.faction].color], speed: 4, life: 0.7 });
          if (b.faction === PLAYER) this.ctx.audio.sfx('pop');
          if (u.def.role === 'worker') u.gather = this._nearestNode(u.group.position);
          else if (b.faction === PLAYER) { u.moveTo = b.rally.clone(); }
          else { u.moveTo = b.rally.clone(); }
        }
      }
    }
  }

  // ============================================================
  //  TARGETING
  // ============================================================
  _nearestNode(pos) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) { const d = pos.distanceToSquared(n.group.position); if (d < bd) { bd = d; best = n; } }
    return best;
  }

  _nodeAt(p) {
    for (const n of this.nodes) if (p.distanceTo(n.group.position) < 4) return n;
    return null;
  }

  _nearestDepot(faction, pos) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (b.faction !== faction || !b.alive || !b.def.depot) continue;
      const d = pos.distanceToSquared(b.group.position); if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  _nearestEnemy(u, maxDist) {
    const from = u.group.position;
    let best = null, bd = maxDist * maxDist;
    for (const o of this.units) {
      if (o.faction === u.faction || !o.alive) continue;
      const d = from.distanceToSquared(o.group.position); if (d < bd) { bd = d; best = o; }
    }
    for (const b of this.buildings) {
      if (b.faction === u.faction || !b.alive) continue;
      const d = from.distanceToSquared(b.group.position); if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  _gap(a, b) { return a.group.position.distanceTo(b.group.position) - a.def.r - b.def.r; }

  // ============================================================
  //  COMBAT
  // ============================================================
  _damage(target, dmg, fromFaction) {
    if (!target.alive) return;
    target.hp -= dmg * (this.dmgMul[fromFaction] ?? 1);
    target.hitFlash = 0.12;
    if (target.hp <= 0) {
      target.hp = 0;
      if (target.isBuilding) this._destroyBuilding(target);
      else this._killUnit(target);
    }
  }

  _killUnit(u) {
    u.alive = false;
    this.bursts.spawn(u.group.position.clone().setY(1.2), {
      count: 26, colors: [FACTION[u.faction].color, 0xffffff], speed: 6, life: 0.9, gravity: -9,
    });
    this._disposeEntity(u);
    this.selected.delete(u);
  }

  _destroyBuilding(b) {
    b.alive = false;
    this.ctx.audio.sfx('boomhit');
    this.bursts.spawn(b.group.position.clone().setY(3), {
      count: 90, colors: [FACTION[b.faction].color, 0xffd76e, 0xffffff], speed: 12, life: 1.6, up: 6,
    });
    this._disposeEntity(b);
    if (b.def.isMain) this._win(b.faction === PLAYER ? ENEMY : PLAYER);
  }

  _fireProjectile(u, target) {
    const from = u.group.position.clone().setY(1.4);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(u.def.aoe ? 0.5 : 0.3, 10, 8),
      new THREE.MeshStandardMaterial({ color: u.def.proj, emissive: u.def.proj, emissiveIntensity: 3 }));
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, target, faction: u.faction, dmg: u.def.dmg, aoe: u.def.aoe ?? 0, speed: u.def.aoe ? 34 : 46,
    });
    if (u.def.aoe && u.faction === PLAYER) this.ctx.audio.sfx('meteor', { gain: 0.5 });
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const alive = p.target.alive;
      const dest = alive ? p.target.group.position : p.mesh.position;
      this._tmp.copy(dest).setY(1.4).sub(p.mesh.position);
      const dist = this._tmp.length();
      if (!alive || dist < 1.2) {
        if (alive) {
          if (p.aoe > 0) {
            const c = p.target.group.position;
            for (const o of [...this.units, ...this.buildings]) {
              if (o.faction === p.faction || !o.alive) continue;
              if (o.group.position.distanceTo(c) <= p.aoe + o.def.r) this._damage(o, p.dmg, p.faction);
            }
            this.bursts.spawn(c.clone().setY(1), { count: 34, colors: [p.mesh.material.color.getHex(), 0xffffff], speed: 8, life: 0.8 });
          } else {
            this._damage(p.target, p.dmg, p.faction);
          }
        }
        this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
        continue;
      }
      this._tmp.multiplyScalar(Math.min(1, (p.speed * dt) / dist));
      p.mesh.position.add(this._tmp);
    }
  }

  // ============================================================
  //  UNIT SIM
  // ============================================================
  _updateUnit(u, dt) {
    if (!u.alive) return;
    const def = u.def;
    let moveTarget = null, moving = false, anim = 'idle';
    u.cd -= dt;

    // ---- workers ----
    if (def.role === 'worker') {
      if (u.gather && u.gather.amount <= 0) u.gather = this._nearestNode(u.group.position);
      if (!u.gather && !u.moveTo) u.gather = this._nearestNode(u.group.position);
      if (u.moveTo) {
        moveTarget = u.moveTo; moving = true;
        if (u.group.position.distanceTo(u.moveTo) < 1.6) u.moveTo = null;
      } else if (u.gather) {
        if (u.carry >= CARRY) {
          const depot = this._nearestDepot(u.faction, u.group.position);
          if (depot) {
            moveTarget = depot.group.position; moving = true;
            if (this._gap(u, depot) < 1.6) { this.beats[u.faction] += u.carry; u.carry = 0; if (u.faction === PLAYER) this.ctx.audio.sfx('pickup', { gain: 0.4 }); }
          }
        } else {
          const np = u.gather.group.position;
          if (u.group.position.distanceTo(np) > 3) { moveTarget = np; moving = true; }
          else {
            anim = 'work';
            const take = Math.min(MINE_RATE * dt, CARRY - u.carry, u.gather.amount);
            u.carry += take; u.gather.amount -= take;
          }
        }
      }
    } else {
      // ---- healer ----
      if (def.role === 'healer') {
        u.healCd -= dt;
        let patient = null, worst = 0;
        for (const o of this.units) {
          if (o.faction !== u.faction || !o.alive || o === u) continue;
          const miss = o.maxHp - o.hp;
          if (miss > worst && u.group.position.distanceTo(o.group.position) <= def.healR) { worst = miss; patient = o; }
        }
        if (patient && u.healCd <= 0) {
          patient.hp = Math.min(patient.maxHp, patient.hp + def.heal); u.healCd = def.healCd;
          this.bursts.spawn(patient.group.position.clone().setY(1.6), { count: 10, colors: [0x9dffce, 0xffffff], speed: 3, life: 0.6, gravity: 2 });
          anim = 'sing';
        }
        if (u.moveTo) { moveTarget = u.moveTo; moving = true; if (u.group.position.distanceTo(u.moveTo) < 1.6) u.moveTo = null; }
        else if (patient && u.group.position.distanceTo(patient.group.position) > def.healR * 0.8) { moveTarget = patient.group.position; moving = true; }
        else if (anim !== 'sing') anim = 'idle';
      } else {
        // ---- combatants ----
        let tgt = (u.target && u.target.alive) ? u.target : null;
        if (!tgt && def.aggro > 0) tgt = this._nearestEnemy(u, def.aggro);
        if (!tgt && u.moveTo && def.aggro > 0) tgt = this._nearestEnemy(u, def.aggro);
        if (tgt) {
          const gap = this._gap(u, tgt);
          if (gap <= def.range) {
            // in range → attack
            this._faceTo(u, tgt.group.position, dt);
            if (u.cd <= 0) {
              u.cd = def.cd;
              if (def.proj) this._fireProjectile(u, tgt);
              else { this._damage(tgt, def.dmg, u.faction); this.bursts.spawn(tgt.group.position.clone().setY(1.4), { count: 6, colors: [FACTION[u.faction].color], speed: 3, life: 0.35 }); }
            }
            anim = 'work';
          } else { moveTarget = tgt.group.position; moving = true; }
        } else if (u.moveTo) {
          moveTarget = u.moveTo; moving = true;
          if (u.group.position.distanceTo(u.moveTo) < 1.8) { u.moveTo = null; }
        }
      }
    }

    // ---- steering ----
    const desired = this._tmp2.set(0, 0, 0);
    if (moving && moveTarget) {
      desired.copy(moveTarget).sub(u.group.position); desired.y = 0;
      const d = desired.length();
      if (d > 0.001) desired.multiplyScalar(def.speed / d);
    }
    // separation from neighbours
    let sepx = 0, sepz = 0;
    for (const o of this.units) {
      if (o === u || !o.alive) continue;
      const dx = u.group.position.x - o.group.position.x;
      const dz = u.group.position.z - o.group.position.z;
      const rr = def.r + o.def.r + 0.35;
      const dd = dx * dx + dz * dz;
      if (dd < rr * rr && dd > 0.0001) { const inv = 1 / Math.sqrt(dd); sepx += dx * inv; sepz += dz * inv; }
    }
    desired.x += sepx * def.speed * 0.5;
    desired.z += sepz * def.speed * 0.5;

    u.vel.x = damp(u.vel.x, desired.x, 10, dt);
    u.vel.z = damp(u.vel.z, desired.z, 10, dt);
    u.group.position.x = clamp(u.group.position.x + u.vel.x * dt, -BOUND_X, BOUND_X);
    u.group.position.z = clamp(u.group.position.z + u.vel.z * dt, -BOUND_Z, BOUND_Z);

    const spd = Math.hypot(u.vel.x, u.vel.z);
    if (spd > 0.4) { this._faceTo(u, this._tmp.copy(u.group.position).add(u.vel), dt); if (anim === 'idle') anim = 'walk'; }
    u.anim = anim;

    // hit flash tint
    if (u.hitFlash > 0) { u.hitFlash -= dt; }
    u.rig.update(dt, { anim, speed: spd, beat: this.time * 2 });
  }

  _faceTo(u, worldPos, dt) {
    const a = Math.atan2(worldPos.x - u.group.position.x, worldPos.z - u.group.position.z);
    let diff = a - u.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    u.heading += diff * Math.min(1, dt * 12);
    u.group.rotation.y = u.heading;
  }

  // ============================================================
  //  ENEMY AI — mines, trains, escalates (RA3 waves)
  // ============================================================
  _enemyAI(dt) {
    const diff = 1 + this.time / 130;
    // AI economy assist (a standard RTS-AI bonus so THE STATIC keeps pressure)
    this.beats[ENEMY] += 3.5 * diff * dt;
    this.dmgMul[ENEMY] = 1 + this.time / 300;

    this._aiTick -= dt;
    if (this._aiTick <= 0) {
      this._aiTick = 2.2;
      const mine = this._mainOf[ENEMY];
      if (!mine || !mine.alive) return;
      const army = this.units.filter((u) => u.faction === ENEMY && u.alive);
      const workers = army.filter((u) => u.def.role === 'worker').length;
      const queued = this._queued(ENEMY);
      if (army.length + queued < UNIT_CAP) {
        if (workers < 6 && this.beats[ENEMY] >= UNITS.roadie.cost) {
          this.beats[ENEMY] -= UNITS.roadie.cost;
          this._pickTrainer(ENEMY, 'roadie')?.queue.push('roadie');
        } else {
          const roll = Math.random();
          const key = roll < 0.42 ? 'thumper' : roll < 0.7 ? 'wobbler' : roll < 0.86 ? 'diva' : 'chorister';
          const st = this._pickTrainer(ENEMY, key);
          if (st && this.beats[ENEMY] >= UNITS[key].cost) { this.beats[ENEMY] -= UNITS[key].cost; st.queue.push(key); }
        }
      }
      // ensure idle enemy workers are mining
      for (const u of army) if (u.def.role === 'worker' && !u.gather && !u.moveTo) u.gather = this._nearestNode(u.group.position);
    }

    // attack waves
    this._waveTimer -= dt;
    if (this._waveTimer <= 0) {
      this._waveTimer = Math.max(20, 42 - this.time / 12);
      const strike = this.units.filter((u) => u.faction === ENEMY && u.alive && u.def.role !== 'worker' && !u.target);
      const target = this._mainOf[PLAYER];
      if (strike.length >= 3 && target && target.alive) {
        for (const u of strike) { u.moveTo = target.group.position.clone(); u.attackMove = true; }
      }
    }
  }

  // ============================================================
  //  HUD
  // ============================================================
  _buildToolbar() {
    const bar = document.getElementById('wars-toolbar');
    const btn = (d, icon, label, sub) => `<button class="gt" ${d}><span>${icon}</span><i>${label}</i><i class="cost">${sub}</i></button>`;
    let html = btn('data-unit="roadie"', UNITS.roadie.icon, 'ROADIE', '50♪');
    html += '<div class="gt-sep"></div>';
    html += btn('data-unit="thumper"', UNITS.thumper.icon, 'THUMPER', '75♪');
    html += btn('data-unit="wobbler"', UNITS.wobbler.icon, 'WOBBLER', '90♪');
    html += btn('data-unit="chorister"', UNITS.chorister.icon, 'CHORIST', '100♪');
    html += btn('data-unit="diva"', UNITS.diva.icon, 'DIVA', '150♪');
    html += '<div class="gt-sep"></div>';
    html += btn('data-build="studio"', '🏭', 'STUDIO', '150♪');
    if (!this.ampBought) html += btn('data-tech="amp" class="advance"', '📢', 'AMP UP', '200♪');
    bar.innerHTML = html;
  }

  _statsUI() {
    const pop = this.units.filter((u) => u.faction === PLAYER && u.alive).length;
    const epop = this.units.filter((u) => u.faction === ENEMY && u.alive).length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('ws-beats', Math.floor(this.beats?.[PLAYER] ?? 0));
    set('ws-pop', `${pop}/${UNIT_CAP}`);
    set('ws-sel', this.selected.size ? `${this.selected.size} sel` : '—');
    set('ws-enemy', epop);
  }

  // ============================================================
  //  WIN / LOSE
  // ============================================================
  _win(who) {
    if (this.over) return;
    this.over = who;
    const win = who === PLAYER;
    this.ctx.audio.sfx(win ? 'win' : 'lose');
    const box = document.getElementById('wars-result');
    box.querySelector('#wr-title').textContent = win ? 'VICTORY' : 'DEFEAT';
    box.querySelector('#wr-title').style.color = win ? '#7cffbd' : '#ff4d6d';
    box.querySelector('#wr-sub').textContent = win
      ? 'THE STATIC is silenced. The stage is yours.'
      : 'Your Main Stage went dark. The Static plays on.';
    box.classList.remove('hidden');
    this.ctx.engine.pulse(1.2, 0.6);
  }

  // ============================================================
  //  MAIN UPDATE
  // ============================================================
  update(dt) {
    if (!this._built) return;
    this.time += dt;

    // camera pan (WASD / arrows) — RTS scroll across the field
    this._panCamera(dt);

    if (!this.over) {
      for (const b of this.buildings) this._updateBuilding(b, dt);
      for (const u of this.units) this._updateUnit(u, dt);
      this._updateProjectiles(dt);
      this._enemyAI(dt);
      // reap dead
      if (this._reapT === undefined) this._reapT = 0;
      this._reapT += dt;
      if (this._reapT > 0.5) { this._reapT = 0; this.units = this.units.filter((u) => u.alive); this.buildings = this.buildings.filter((b) => b.alive); }
    } else {
      // idle animation only
      for (const u of this.units) if (u.alive) u.rig.update(dt, { anim: 'idle' });
    }

    // health bars: face camera, follow entity, scale fill
    for (const list of [this.units, this.buildings]) {
      for (const o of list) {
        if (!o.alive || !o.bar) continue;
        o.bar.position.set(o.group.position.x, o.barY, o.group.position.z);
        o.bar.quaternion.copy(this.camera.quaternion);
        const frac = clamp(o.hp / o.maxHp, 0, 1);
        o.bar.userData.fill.scale.x = Math.max(0.001, frac);
        const dim = (!o.isBuilding && o.def.role === 'worker' && frac > 0.999);
        o.bar.visible = !dim;
        o.bar.userData.mat.color.set(o.hitFlash > 0 ? 0xffffff : FACTION[o.faction].color);
      }
    }

    // node pulse
    for (const n of this.nodes) {
      n._b += dt;
      const glow = n.amount > 0 ? 2 + Math.sin(n._b * 2) * 0.6 : 0.2;
      n.glowMat.emissiveIntensity = glow;
      n.group.visible = n.amount > 0;
    }

    // command marks fade
    for (const m of [this.moveMark, this.atkMark]) {
      if (!m.visible) continue;
      m.userData.t -= dt;
      m.scale.multiplyScalar(1 + dt * 1.4);
      m.material.opacity = clamp(m.userData.t, 0, 1);
      if (m.userData.t <= 0) m.visible = false;
    }

    // studio placement ghost follows cursor
    if (this.place) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const h = this.raycaster.intersectObject(this.ground, false)[0];
      if (h) { this.ghost.position.set(h.point.x, 2, h.point.z); this.ghost.material.color.set(h.point.z < 20 ? 0xff4d6d : 0x7cffbd); }
    }

    this.bursts.update(dt);
    if (this.controls) this.controls.update();

    this._statT += dt;
    if (this._statT > 0.25) { this._statT = 0; this._statsUI(); }
  }

  _panCamera(dt) {
    const k = this.keys;
    let fx = 0, fz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    if (!fx && !fz) return;
    // forward on XZ from camera facing
    this._tmp.set(0, 0, 0); this.camera.getWorldDirection(this._tmp); this._tmp.y = 0; this._tmp.normalize();
    this._tmp2.set(this._tmp.z, 0, -this._tmp.x); // right
    const spd = 70 * dt * (this.controls.getDistance() / 110);
    const dx = (this._tmp.x * -fz + this._tmp2.x * fx) * spd;
    const dz = (this._tmp.z * -fz + this._tmp2.z * fx) * spd;
    const cx = clamp(this.controls.target.x + dx, -BOUND_X, BOUND_X);
    const cz = clamp(this.controls.target.z + dz, -BOUND_Z, BOUND_Z);
    const ddx = cx - this.controls.target.x, ddz = cz - this.controls.target.z;
    this.controls.target.x = cx; this.controls.target.z = cz;
    this.camera.position.x += ddx; this.camera.position.z += ddz;
  }
}
