// ============================================================
//  SPRUNKI WORLD — open world mode
//  Terrain island · day/night cycle · village · 10 NPCs with
//  daily schedules & agendas · missions · beat battles
// ============================================================
import * as THREE from 'three';
import {
  clamp, lerp, damp, rand, pick, fbm, IS_TOUCH,
  BurstPool, DriftField, makeLightCone, easeOutCubic,
} from '../core/utils.js';
import { CHARACTERS, JASON_SPEC, CHAR_BY_ID, createSprunki } from '../characters.js';
import { loadSpriteManifest, createSpriteRig } from '../sprites3d.js';
import { BEAT } from '../audio.js';

const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const DAY_LENGTH = 240;          // seconds per full day
const WATER_Y = -3;
const PLAY_RADIUS = 150;

// ---------------- terrain height field (analytic) ----------------

function heightAt(x, z) {
  const d = Math.hypot(x, z);
  const base = fbm(x * 0.009, z * 0.009, 4) * 11 + fbm(x * 0.035 + 7.3, z * 0.035 - 2.1, 3) * 1.6 + 2.5;
  let h = lerp(1.2, base, sstep(24, 62, d));       // flat village plateau
  h -= Math.pow(sstep(118, 195, d), 1.5) * 30;     // island falloff into the sea
  return h;
}

// ---------------- schedules / missions data ----------------

const WORK = {
  thump: { poi: 'rocks', act: 'work' },
  snapp: { poi: 'stall1', act: 'talk' },
  tika:  { poi: 'grove', act: 'work' },
  boom:  { poi: 'bench', act: 'sleep' },
  wobb:  { poi: 'stall2', act: 'work' },
  chime: { poi: 'bell',  act: 'sing' },
  nova:  { poi: 'stage', act: 'sing' },
  drift: { poi: 'field', act: 'work' },
  voxo:  { poi: 'stage', act: 'sing' },
  echo:  { poi: 'plaza', act: 'idle' },
};

const MISSIONS = {
  lostbeat: {
    giver: 'thump', title: 'THE LOST BEATS', fame: 10,
    desc: 'Three of my beat-orbs rolled off into the wild. Follow the red beams and bring them back!',
    remind: 'The orbs glow red — you can see their beams from the plaza. Go get them!',
    complete: 'MY BEATS! The ground shall shake again. You are alright, JASON.',
    progress: (m) => `Beat-orbs: ${m.count}/3`,
  },
  delivery: {
    giver: 'chime', title: 'A MELODY FOR DURPLE', fame: 8,
    desc: 'I wrote Durple a tiny melody-crystal for the battle. Deliver it? They are at the stage!',
    remind: 'Durple needs that melody-crystal before evening!',
    complete: '(DURPLE) A melody? For ME? …it is actually beautiful. Tell Sky… thanks.',
    progress: () => 'Bring the crystal to DURPLE',
  },
  battle: {
    giver: 'nova', title: 'BEAT BATTLE: DURPLE', fame: 15,
    desc: 'You? Battle ME? Adorable. Hit the pads on the beat — score 65% or you are just noise.',
    remind: 'Ready to lose? Talk to me and we go again.',
    complete: '…I lost?! Ugh. Respect, JASON. RESPECT.',
    progress: () => 'Defeat DURPLE in a beat battle',
  },
  harvest: {
    giver: 'drift', title: 'HARVEST HANDS', fame: 8,
    desc: 'The golden crops are ready, friend. Gather five of them from my field, nice and slow.',
    remind: 'Five golden crops. The field hums east of the plaza.',
    complete: 'The field thanks you. The drone of the earth grows warmer.',
    progress: (m) => `Golden crops: ${m.count}/5`,
  },
};

// ============================================================

export class WorldMode {
  constructor(ctx) {
    this.ctx = ctx;                 // { engine, audio, ui }
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 900);
    this.dayT = 0.34;
    this.keys = {};
    this.camYaw = Math.PI;          // behind player looking at stage
    this.camPitch = 0.3;
    this.camDist = 7.5;
    this.bursts = new BurstPool(this.scene);
    this.fame = 0;
    this.missions = Object.fromEntries(Object.keys(MISSIONS).map((k) => [k, { state: 'available', count: 0 }]));
    this.activeMissionId = null;
    this.battle = null;
    this.dialogueNpc = null;
    this._ambT = 0;
    this._built = false;
  }

  // ---------------- build ----------------

  _build() {
    const s = this.scene;
    s.environment = this.ctx.engine.envTex;
    s.environmentIntensity = 0.35;
    s.fog = new THREE.FogExp2(0x9db8dd, 0.006);

    this._buildSky(s);
    this._buildTerrain(s);
    this._buildWater(s);
    this._buildVillage(s);
    this._buildNature(s);
    this._buildNPCs(s);
    this._buildPlayer(s);
    this._buildMissionProps(s);

    this.fireflies = new DriftField(s, {
      count: 160, box: { x: 90, y: 6, z: 90 }, center: new THREE.Vector3(0, 4, 0),
      size: 0.14, color: 0xaaff88, opacity: 0, rise: 0.05, wobble: 1.2,
    });
    this._upgradeNpcSprites();
    this._built = true;
  }

  /** Hot-swap the villagers to the original 2D costumes as they load. */
  async _upgradeNpcSprites() {
    try {
      this._spriteFiles = await loadSpriteManifest();
    } catch { return; }
    for (const npc of this.npcs) {
      const files = this._spriteFiles?.[npc.spec.id];
      if (!files?.idle) continue;
      createSpriteRig(npc.spec, files, { keys: ['idle', 'idle2', 'anim', 'anim2'] })
        .then((rig) => {
          const old = npc.rig;
          rig.group.position.copy(old.group.position);
          rig.group.rotation.copy(old.group.rotation);
          rig.group.visible = old.group.visible;
          rig.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
          rig.cameraRef = this.camera;
          this.scene.add(rig.group);
          this.scene.remove(old.group);
          npc.rig = rig;
        })
        .catch(() => { /* keep procedural */ });
    }
  }

  _buildSky(s) {
    this.sunDir = new THREE.Vector3(0, 1, 0.3).normalize();
    const uniforms = {
      uSunDir: { value: this.sunDir },
      uDayMix: { value: 1 },
      uDusk: { value: 0 },
      uTime: { value: 0 },
    };
    this.skyU = uniforms;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(700, 32, 20),
      new THREE.ShaderMaterial({
        uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */`
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */`
          uniform vec3 uSunDir;
          uniform float uDayMix, uDusk, uTime;
          varying vec3 vDir;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          void main() {
            vec3 dir = normalize(vDir);
            float elev = clamp(dir.y, -0.2, 1.0);
            vec3 dayCol = mix(vec3(0.72, 0.84, 0.98), vec3(0.16, 0.4, 0.85), pow(max(elev, 0.0), 0.6));
            vec3 nightCol = mix(vec3(0.05, 0.07, 0.16), vec3(0.01, 0.015, 0.05), pow(max(elev, 0.0), 0.5));
            vec3 col = mix(nightCol, dayCol, uDayMix);
            // dusk band near the sun's horizon direction
            vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-4);
            float band = pow(max(dot(dir, sunFlat), 0.0), 3.0) * (1.0 - abs(dir.y)) * uDusk;
            col += vec3(1.0, 0.42, 0.18) * band * 0.85;
            // sun
            float sd = max(dot(dir, uSunDir), 0.0);
            col += vec3(1.0, 0.92, 0.75) * (pow(sd, 900.0) * 5.0 + pow(sd, 48.0) * 0.32) * max(uDayMix, 0.03);
            // moon (opposite the sun)
            float md = max(dot(dir, -uSunDir), 0.0);
            col += vec3(0.75, 0.82, 1.0) * pow(md, 1400.0) * 2.2 * (1.0 - uDayMix);
            // stars
            float st = step(0.9992, hash(floor(dir.xz * 400.0) + floor(dir.y * 400.0)));
            float tw = 0.6 + 0.4 * sin(uTime * 2.0 + hash(dir.xz.xy * 91.0) * 40.0);
            col += vec3(0.9, 0.95, 1.0) * st * tw * (1.0 - uDayMix) * smoothstep(0.0, 0.25, dir.y);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    sky.frustumCulled = false;
    s.add(sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70;
    sc.near = 10; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    s.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbdd4ff, 0x3d4a33, 0.55);
    s.add(this.hemi);
  }

  _buildTerrain(s) {
    const SIZE = 440, SEG = 150;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color(), grass = new THREE.Color(0x4a8a50), dry = new THREE.Color(0x7da05a),
      sand = new THREE.Color(0xcdb87e), rock = new THREE.Color(0x757a85);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      const n = fbm(x * 0.05 + 40, z * 0.05, 3) * 0.5 + 0.5;
      if (h < WATER_Y + 1.6) c.copy(sand);
      else if (h > 8.5) c.copy(rock).lerp(dry, clamp(1 - (h - 8.5) / 5, 0, 1) * 0.5);
      else c.copy(grass).lerp(dry, n);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0,
    }));
    this.terrain.receiveShadow = true;
    s.add(this.terrain);
  }

  _buildWater(s) {
    const uniforms = {
      uTime: { value: 0 },
      uDay: { value: 1 },
    };
    this.waterU = uniforms;
    const geo = new THREE.PlaneGeometry(900, 900, 48, 48);
    geo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      fog: false,
      vertexShader: /* glsl */`
        uniform float uTime;
        varying vec3 vWorld;
        void main() {
          vec3 p = position;
          p.y += sin(p.x * 0.08 + uTime * 1.1) * 0.22 + cos(p.z * 0.07 + uTime * 0.8) * 0.22;
          vec4 w = modelMatrix * vec4(p, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime, uDay;
        varying vec3 vWorld;
        void main() {
          vec3 view = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(view.y, 0.0), 3.0);
          vec3 deep = vec3(0.015, 0.10, 0.16) * (0.25 + uDay * 0.75);
          vec3 shal = vec3(0.05, 0.32, 0.38) * (0.2 + uDay * 0.8);
          vec3 skyc = mix(vec3(0.04, 0.06, 0.13), vec3(0.62, 0.78, 0.95), uDay);
          vec3 col = mix(deep, shal, 0.35) + skyc * fres * 0.55;
          float glint = pow(max(sin(vWorld.x * 2.1 + uTime * 2.0) * sin(vWorld.z * 1.7 - uTime * 1.6), 0.0), 24.0);
          col += vec3(1.0) * glint * 0.25 * (0.15 + uDay);
          gl_FragColor = vec4(col, 0.93);
        }
      `,
    }));
    water.position.y = WATER_Y;
    s.add(water);
  }

  _buildVillage(s) {
    // plaza
    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(15, 40),
      new THREE.MeshStandardMaterial({ color: 0x6b6678, roughness: 0.85 }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 1.28;
    plaza.receiveShadow = true;
    s.add(plaza);

    // ----- stage -----
    const stage = new THREE.Group();
    stage.position.set(0, 1.2, -20);
    const plat = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5.5, 0.7, 28),
      new THREE.MeshPhysicalMaterial({ color: 0x1c1530, roughness: 0.35, clearcoat: 0.6 }));
    plat.position.y = 0.35;
    plat.castShadow = plat.receiveShadow = true;
    stage.add(plat);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(5.1, 0.09, 10, 48),
      new THREE.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 2.5 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.72;
    stage.add(ring);
    this.stageRing = ring;
    // speakers
    for (const side of [-1, 1]) {
      const sp = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 2.6, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x141220, roughness: 0.6 }));
      sp.position.set(5.6 * side, 1.3, 0.6);
      sp.castShadow = true;
      stage.add(sp);
      const conemat = new THREE.MeshStandardMaterial({ color: 0x2a2440, emissive: 0x7c6cff, emissiveIntensity: 0.6, roughness: 0.4 });
      for (const yy of [0.7, 1.9]) {
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 20), conemat);
        cone.rotation.x = Math.PI / 2;
        cone.position.set(5.6 * side, yy, 1.22);
        stage.add(cone);
      }
    }
    // stage lights (cones + spots)
    this.stageCones = [];
    this.stageSpots = [];
    const lightCols = [0xff4d6d, 0x7c6cff, 0x4dd8ff];
    for (let i = 0; i < 3; i++) {
      const px = (i - 1) * 3.4;
      const cone = makeLightCone(lightCols[i], 0.13, 2.4, 9);
      cone.position.set(px, 9.2, 0);
      cone.rotation.x = 0.12;
      stage.add(cone);
      this.stageCones.push(cone);
      const spot = new THREE.SpotLight(lightCols[i], 0, 26, 0.5, 0.5, 1.6);
      spot.position.set(px, 9.4, 0);
      spot.target.position.set(px * 0.5, 0, 2);
      stage.add(spot, spot.target);
      this.stageSpots.push(spot);
    }
    s.add(stage);
    this.stagePos = new THREE.Vector3(0, 1.2, -20);

    // ----- houses -----
    this.houses = [];
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.8 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.7 });
    this.windowMat = new THREE.MeshStandardMaterial({
      color: 0x33302a, emissive: 0xffb35c, emissiveIntensity: 0, roughness: 0.4,
    });
    const roofCols = [0xb0524f, 0x5a7fb5, 0x7aa06a, 0xb08a4f, 0x9a6ab5];
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + 0.31;
      // leave the stage sector clear
      if (Math.abs(((ang + Math.PI) % (Math.PI * 2)) - Math.PI * 1.5) < 0.5) continue;
      const r = 27 + (i % 3) * 6;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const y = heightAt(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = -ang - Math.PI / 2; // face the plaza
      const w = 4 + (i % 2), d = 3.6, hgt = 2.8;
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), wallMat);
      box.position.y = hgt / 2;
      box.castShadow = box.receiveShadow = true;
      g.add(box);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(w, d) * 0.78, 1.9, 4),
        new THREE.MeshStandardMaterial({ color: roofCols[i % roofCols.length], roughness: 0.75 }));
      roof.position.y = hgt + 0.95;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      g.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.12), doorMat);
      door.position.set(0, 0.8, d / 2 + 0.04);
      g.add(door);
      for (const side of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.1), this.windowMat);
        win.position.set(side * w * 0.28, 1.7, d / 2 + 0.04);
        g.add(win);
      }
      s.add(g);
      const doorWorld = new THREE.Vector3(0, 0, d / 2 + 1.1).applyMatrix4(
        new THREE.Matrix4().makeRotationY(g.rotation.y)).add(g.position);
      this.houses.push({ group: g, door: doorWorld });
    }

    // ----- lamps -----
    this.lampMat = new THREE.MeshStandardMaterial({
      color: 0x777, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4,
    });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.6 });
    this.lampLights = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      const x = Math.cos(a) * 16.5, z = Math.sin(a) * 16.5;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.1, 8), postMat);
      post.position.set(x, 1.2 + 1.55, z);
      post.castShadow = true;
      s.add(post);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), this.lampMat);
      bulb.position.set(x, 1.2 + 3.15, z);
      s.add(bulb);
      if (i % 3 === 0) {
        const pl = new THREE.PointLight(0xffc37a, 0, 20, 1.8);
        pl.position.copy(bulb.position);
        s.add(pl);
        this.lampLights.push(pl);
      }
    }

    // ----- POIs -----
    this.pois = {
      plaza: new THREE.Vector3(0, 1.2, 2),
      stage: new THREE.Vector3(0, 1.2, -13),
      bell: new THREE.Vector3(0, 1.2, 16),
      stall1: new THREE.Vector3(-11, 1.2, 8),
      stall2: new THREE.Vector3(11, 1.2, 8),
      bench: new THREE.Vector3(-16, 1.25, -6),
      field: new THREE.Vector3(38, heightAt(38, 22), 22),
      rocks: new THREE.Vector3(-34, heightAt(-34, 30), 30),
      grove: new THREE.Vector3(30, heightAt(30, -34), -34),
    };

    // bell post
    const bell = new THREE.Group();
    bell.position.copy(this.pois.bell);
    const bpost = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 3.4, 8), postMat);
    bpost.position.y = 1.7; bpost.castShadow = true;
    const bcap = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xd8b34a, metalness: 0.85, roughness: 0.3 }));
    bcap.position.y = 3.3; bcap.scale.y = 1.2; bcap.castShadow = true;
    bell.add(bpost, bcap);
    s.add(bell);

    // market stalls
    for (const key of ['stall1', 'stall2']) {
      const p = this.pois[key];
      const st = new THREE.Group();
      st.position.copy(p).add(new THREE.Vector3(0, 0, -1.2));
      const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1), wallMat);
      counter.position.y = 0.45; counter.castShadow = true;
      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 0.12, 1.6),
        new THREE.MeshStandardMaterial({ color: key === 'stall1' ? 0xff8c42 : 0xc44dff, roughness: 0.7 }));
      canopy.position.y = 2.1;
      canopy.rotation.x = 0.12;
      const poles = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 6), postMat);
      poles.position.set(-1.3, 1.05, 0.6);
      const poles2 = poles.clone(); poles2.position.x = 1.3;
      st.add(counter, canopy, poles, poles2);
      s.add(st);
    }

    // bench
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.7), doorMat);
    bench.position.copy(this.pois.bench).add(new THREE.Vector3(0, 0.45, 0));
    bench.castShadow = true;
    s.add(bench);

    // crop field — instanced rows
    const cropGeo = new THREE.ConeGeometry(0.22, 0.7, 7);
    const cropMat = new THREE.MeshStandardMaterial({ color: 0x74c94d, roughness: 0.8 });
    const crops = new THREE.InstancedMesh(cropGeo, cropMat, 54);
    const dummy = new THREE.Object3D();
    let ci = 0;
    for (let rx = 0; rx < 9; rx++) {
      for (let rz = 0; rz < 6; rz++) {
        const x = this.pois.field.x - 6 + rx * 1.5, z = this.pois.field.z - 4 + rz * 1.6;
        dummy.position.set(x, heightAt(x, z) + 0.32, z);
        dummy.scale.setScalar(rand(0.7, 1.15));
        dummy.rotation.y = rand(Math.PI * 2);
        dummy.updateMatrix();
        crops.setMatrixAt(ci++, dummy.matrix);
      }
    }
    crops.castShadow = true;
    s.add(crops);

    // rock pile at 'rocks'
    for (let i = 0; i < 5; i++) {
      const r = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rand(0.5, 1.2), 0),
        new THREE.MeshStandardMaterial({ color: 0x757a85, roughness: 0.9 }));
      const p = this.pois.rocks;
      r.position.set(p.x + rand(-2, 2), 0, p.z + rand(-2, 2));
      r.position.y = heightAt(r.position.x, r.position.z) + 0.3;
      r.castShadow = r.receiveShadow = true;
      this.scene.add(r);
    }
  }

  _buildNature(s) {
    // trees — instanced trunks + two foliage blobs
    const N = 80;
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.9 });
    const folGeo = new THREE.SphereGeometry(1.15, 10, 8);
    const folMat = new THREE.MeshStandardMaterial({ color: 0x3f9152, roughness: 0.85 });
    const folMat2 = new THREE.MeshStandardMaterial({ color: 0xef9bc4, roughness: 0.85 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
    const fols = new THREE.InstancedMesh(folGeo, folMat, N);
    const fols2 = new THREE.InstancedMesh(folGeo, folMat2, Math.floor(N / 4));
    const dummy = new THREE.Object3D();
    let fi2 = 0;
    for (let i = 0; i < N; i++) {
      let x, z, h, tries = 0;
      do {
        const a = rand(Math.PI * 2), r = rand(42, 145);
        x = Math.cos(a) * r; z = Math.sin(a) * r;
        h = heightAt(x, z);
        tries++;
      } while ((h < WATER_Y + 2.2 || h > 9) && tries < 20);
      const sc = rand(0.8, 1.6);
      dummy.position.set(x, h + 1.1 * sc, z);
      dummy.scale.setScalar(sc);
      dummy.rotation.y = rand(Math.PI * 2);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      const pink = i % 4 === 0 && fi2 < fols2.count;
      dummy.position.y = h + (2.2 + 0.7) * sc;
      dummy.scale.setScalar(sc * rand(1, 1.35));
      dummy.updateMatrix();
      if (pink) fols2.setMatrixAt(fi2++, dummy.matrix);
      else fols.setMatrixAt(i, dummy.matrix);
      if (!pink) continue;
      // fill the unused main-foliage slot far underground
      dummy.position.set(0, -100, 0); dummy.scale.setScalar(0.001); dummy.updateMatrix();
      fols.setMatrixAt(i, dummy.matrix);
    }
    trunks.castShadow = fols.castShadow = fols2.castShadow = true;
    s.add(trunks, fols, fols2);

    // scattered rocks
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a7f8a, roughness: 0.95 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 24);
    for (let i = 0; i < 24; i++) {
      const a = rand(Math.PI * 2), r = rand(50, 140);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      dummy.position.set(x, heightAt(x, z) + 0.2, z);
      dummy.scale.setScalar(rand(0.4, 1.4));
      dummy.rotation.set(rand(3), rand(3), rand(3));
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.castShadow = true;
    s.add(rocks);
  }

  _buildNPCs(s) {
    this.npcs = CHARACTERS.map((spec, i) => {
      const rig = createSprunki(spec);
      rig.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const home = this.houses[i % this.houses.length];
      const homeOffset = rand(Math.PI * 2);
      rig.group.position.copy(home.door);
      rig.group.position.y = heightAt(home.door.x, home.door.z);
      s.add(rig.group);
      return {
        spec, rig, home,
        offA: (i / CHARACTERS.length) * Math.PI * 2,
        offR: 1.5 + (i % 3),
        state: 'idle',
        target: home.door.clone(),
        lineIdx: 0,
        paused: false,
      };
    });
  }

  _buildPlayer(s) {
    this.player = createSprunki({ ...JASON_SPEC }, { scale: 1.05 });
    this.player.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.player.group.position.set(0, 1.2, 6);
    s.add(this.player.group);
    this.playerVelY = 0;
    this.grounded = true;

    // name tag light — subtle hero accent
    const glow = new THREE.PointLight(0xffd76e, 1.2, 4, 2);
    glow.position.y = 2.4;
    this.player.group.add(glow);
    this.playerGlow = glow;
  }

  _buildMissionProps(s) {
    // beat orbs (mission: lostbeat)
    this.orbs = [];
    const orbSpots = [[62, -14], [-52, 58], [24, 74]];
    for (const [x, z] of orbSpots) {
      const y = heightAt(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 18, 14),
        new THREE.MeshStandardMaterial({ color: 0xe23b3b, emissive: 0xe23b3b, emissiveIntensity: 3 }));
      orb.position.y = 1;
      g.add(orb);
      const beam = makeLightCone(0xff5555, 0.1, 1.6, 60);
      beam.position.y = 30.5;
      beam.rotation.x = Math.PI;      // wide end at ground
      g.add(beam);
      g.visible = false;
      s.add(g);
      this.orbs.push({ group: g, orb, taken: false });
    }

    // golden crops (mission: harvest)
    this.goldCrops = [];
    for (let i = 0; i < 5; i++) {
      const x = this.pois.field.x - 6 + rand(0, 13), z = this.pois.field.z - 4 + rand(0, 9);
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(0.26, 0.85, 7),
        new THREE.MeshStandardMaterial({ color: 0xffd76e, emissive: 0xffb02e, emissiveIntensity: 1.6 }));
      m.position.set(x, heightAt(x, z) + 0.4, z);
      m.visible = false;
      s.add(m);
      this.goldCrops.push({ mesh: m, taken: false });
    }

    // delivery crystal above player's head when carrying
    this.crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28, 0),
      new THREE.MeshStandardMaterial({ color: 0x4dd8ff, emissive: 0x4dd8ff, emissiveIntensity: 2.6 }));
    this.crystal.visible = false;
    this.player.group.add(this.crystal);
    this.crystal.position.y = 2.7;
  }

  // ---------------- enter / exit ----------------

  enter() {
    if (!this._built) this._build();
    const { engine, audio, ui } = this.ctx;
    engine.setScene(this.scene, this.camera);
    engine.grade.uniforms.uVignette.value = 0.85;
    document.getElementById('hud-world').classList.remove('hidden');

    // ambience — always-running quiet loops keep the beat clock alive
    this.amb = {
      chime: audio.playLoopRaw('chime', 0.05),
      thump: audio.playLoopRaw('thump', 0.0001),
      boom: audio.playLoopRaw('boom', 0.0001),
    };

    this._onKeyDown = (e) => this._keyDown(e);
    this._onKeyUp = (e) => { this.keys[e.code] = false; };
    // camera orbit via pointer events — works for mouse AND touch, and
    // ignores pointers that start on the joystick/buttons (their target ≠ canvas)
    this._onPointerDown = (e) => {
      if (e.target.id === 'stage' && !this._drag) {
        this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
    };
    this._onPointerMove = (e) => {
      if (!this._drag || e.pointerId !== this._drag.id) return;
      this.camYaw -= (e.clientX - this._drag.x) * 0.005;
      this.camPitch = clamp(this.camPitch + (e.clientY - this._drag.y) * 0.004, 0.05, 1.25);
      this._drag.x = e.clientX;
      this._drag.y = e.clientY;
    };
    this._onPointerUp = (e) => {
      if (this._drag && e.pointerId === this._drag.id) this._drag = null;
    };
    this._onWheel = (e) => { this.camDist = clamp(this.camDist + e.deltaY * 0.005, 4, 15); };
    this._onVis = () => {
      if (document.hidden && this.battle) {
        this._endBattle(false);
        this.ctx.ui.toast('Battle interrupted — talk to DURPLE for a rematch');
      }
    };
    addEventListener('keydown', this._onKeyDown);
    addEventListener('keyup', this._onKeyUp);
    addEventListener('pointerdown', this._onPointerDown);
    addEventListener('pointermove', this._onPointerMove);
    addEventListener('pointerup', this._onPointerUp);
    addEventListener('pointercancel', this._onPointerUp);
    addEventListener('wheel', this._onWheel);
    document.addEventListener('visibilitychange', this._onVis);
    this._setupTouch();

    this._updateMissionUI();
    this._updateFameUI();
    ui.toast('Welcome to the island, JASON');
  }

  exit() {
    document.getElementById('hud-world').classList.add('hidden');
    this.keys = {};
    this._drag = null;
    this._closeDialogue();
    if (this.battle) this._endBattle(false, true);
    for (const h of Object.values(this.amb ?? {})) h?.stop();
    this.amb = null;
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener('keyup', this._onKeyUp);
    removeEventListener('pointerdown', this._onPointerDown);
    removeEventListener('pointermove', this._onPointerMove);
    removeEventListener('pointerup', this._onPointerUp);
    removeEventListener('pointercancel', this._onPointerUp);
    removeEventListener('wheel', this._onWheel);
    document.removeEventListener('visibilitychange', this._onVis);
    document.getElementById('touch-controls').classList.add('hidden');
  }

  /** Phone controls: left-thumb joystick, right-thumb jump & talk. */
  _setupTouch() {
    if (!IS_TOUCH) return;
    const tc = document.getElementById('touch-controls');
    tc.classList.remove('hidden');
    const joyEl = document.getElementById('joystick');
    const knob = document.getElementById('joy-knob');
    this.joy = { x: 0, y: 0, active: false, id: null, cx: 0, cy: 0 };
    const R = 42;
    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const track = (e) => {
      if (e.pointerId !== this.joy.id) return;
      let dx = e.clientX - this.joy.cx, dy = e.clientY - this.joy.cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      this.joy.x = dx / R;
      this.joy.y = dy / R;
      setKnob(dx, dy);
    };
    joyEl.onpointerdown = (e) => {
      joyEl.setPointerCapture(e.pointerId);
      const rect = joyEl.getBoundingClientRect();
      this.joy.id = e.pointerId;
      this.joy.active = true;
      this.joy.cx = rect.left + rect.width / 2;
      this.joy.cy = rect.top + rect.height / 2;
      track(e);
    };
    joyEl.onpointermove = track;
    const end = (e) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy.id = null;
      this.joy.active = false;
      this.joy.x = this.joy.y = 0;
      setKnob(0, 0);
    };
    joyEl.onpointerup = end;
    joyEl.onpointercancel = end;
    document.getElementById('btn-interact').onclick = () => this._tryInteract();
    document.getElementById('btn-jump').onclick = () => { this._touchJump = true; };
  }

  _keyDown(e) {
    this.keys[e.code] = true;
    if (this.battle) {
      const lane = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
      if (lane !== undefined) this._battleHit(lane);
      return;
    }
    if (e.code === 'KeyE') this._tryInteract();
  }

  // ---------------- dialogue & missions ----------------

  _nearestNpc() {
    let best = null, bd = 3.2;
    for (const npc of this.npcs) {
      if (!npc.rig.group.visible) continue;
      const d = npc.rig.group.position.distanceTo(this.player.group.position);
      if (d < bd) { bd = d; best = npc; }
    }
    return best;
  }

  _tryInteract() {
    if (this.dialogueNpc) return;
    const npc = this._nearestNpc();
    if (!npc) return;
    this.dialogueNpc = npc;
    npc.paused = true;
    this.ctx.audio.sfx('talk');

    const id = npc.spec.id;
    const dlg = document.getElementById('dialogue');
    const accept = document.getElementById('dlg-accept');
    document.getElementById('dlg-name').textContent = npc.spec.name;
    document.getElementById('dlg-portrait').src =
      this._spriteFiles?.[id]?.idle ?? this.ctx.ui.portraits.get(id) ?? '';
    accept.classList.add('hidden');
    let text = null;

    // deliver crystal to nova
    if (id === 'nova' && this.missions.delivery.state === 'active') {
      this._completeMission('delivery');
      text = MISSIONS.delivery.complete;
    }

    // mission giver logic
    const mid = Object.keys(MISSIONS).find((k) => MISSIONS[k].giver === id);
    if (!text && mid) {
      const m = this.missions[mid];
      const def = MISSIONS[mid];
      if (m.state === 'available') {
        text = def.desc;
        accept.classList.remove('hidden');
        accept.onclick = () => { this._acceptMission(mid); };
      } else if (m.state === 'ready') {
        this._completeMission(mid);
        text = def.complete;
      } else if (m.state === 'active') {
        text = mid === 'battle' ? def.remind : def.remind;
        if (mid === 'battle') {
          accept.textContent = 'BATTLE!';
          accept.classList.remove('hidden');
          accept.onclick = () => { this._closeDialogue(); this._startBattle(); };
        }
      }
    }
    if (!text) {
      text = npc.spec.lines[npc.lineIdx % npc.spec.lines.length];
      npc.lineIdx++;
    }
    document.getElementById('dlg-text').textContent = text;
    accept.textContent = accept.textContent || 'ACCEPT';
    dlg.classList.remove('hidden');
    document.getElementById('dlg-close').onclick = () => this._closeDialogue();
  }

  _closeDialogue() {
    document.getElementById('dialogue').classList.add('hidden');
    document.getElementById('dlg-accept').textContent = 'ACCEPT';
    if (this.dialogueNpc) { this.dialogueNpc.paused = false; this.dialogueNpc = null; }
  }

  _acceptMission(mid) {
    const m = this.missions[mid];
    m.state = 'active';
    this.activeMissionId = mid;
    this.ctx.audio.sfx('pickup');
    this._closeDialogue();
    if (mid === 'lostbeat') this.orbs.forEach((o) => { o.group.visible = !o.taken; });
    if (mid === 'harvest') this.goldCrops.forEach((c) => { c.mesh.visible = !c.taken; });
    if (mid === 'delivery') this.crystal.visible = true;
    if (mid === 'battle') this._startBattle();
    this._updateMissionUI();
    this.ctx.ui.toast(`MISSION: ${MISSIONS[mid].title}`);
  }

  _completeMission(mid) {
    const m = this.missions[mid];
    if (m.state === 'done') return;
    m.state = 'done';
    if (this.activeMissionId === mid) this.activeMissionId = null;
    this.fame += MISSIONS[mid].fame;
    if (mid === 'delivery') this.crystal.visible = false;
    this.ctx.audio.sfx('win');
    this.bursts.spawn(this.player.group.position.clone().add(new THREE.Vector3(0, 2, 0)),
      { count: 80, colors: [0xffd76e, 0xffffff, 0x7c6cff], speed: 4 });
    this._updateFameUI();
    this._updateMissionUI();
    this.ctx.ui.toast(`MISSION COMPLETE  +${MISSIONS[mid].fame} ★`);
    if (Object.values(this.missions).every((mm) => mm.state === 'done')) {
      setTimeout(() => {
        this.ctx.ui.toast('★ VILLAGE LEGEND — the island sings your name! ★', 5000);
        this.player.setTint('gold');
        this.ctx.audio.sfx('win');
      }, 1600);
    }
  }

  _updateMissionUI() {
    const tracker = document.getElementById('mission-tracker');
    const mid = this.activeMissionId
      ?? Object.keys(this.missions).find((k) => this.missions[k].state === 'active' || this.missions[k].state === 'ready');
    if (!mid) { tracker.classList.add('hidden'); return; }
    const def = MISSIONS[mid], m = this.missions[mid];
    tracker.classList.remove('hidden');
    document.getElementById('mt-title').textContent = def.title;
    document.getElementById('mt-desc').textContent = m.state === 'ready'
      ? `Return to ${CHAR_BY_ID[def.giver].name}!` : def.remind;
    document.getElementById('mt-progress').textContent = def.progress(m);
  }

  _updateFameUI() {
    document.getElementById('fame').textContent = `★ ${this.fame}`;
  }

  // ---------------- beat battle ----------------

  _startBattle() {
    const { audio } = this.ctx;
    this.amb.thump.setGain(0.55);
    this.amb.boom.setGain(0.5);
    this.amb.chime.setGain(0.3);
    const startBeat = Math.ceil(audio.beatPos / 4) * 4 + 4;
    const cues = [];
    for (let i = 0; i < 16; i++) {
      cues.push({ beat: startBeat + i, lane: Math.floor(rand(4)), hit: false, ring: null, judged: false });
    }
    this.battle = { cues, score: 0, startBeat, over: false };
    document.getElementById('battle').classList.remove('hidden');
    document.getElementById('battle-score').textContent = '0';
    document.getElementById('battle-msg').textContent = 'HIT THE PADS ON THE BEAT — GET READY…';
    document.querySelectorAll('#battle .pad').forEach((pad) => {
      pad.onclick = () => this._battleHit(+pad.dataset.lane);
    });
  }

  _battleHit(lane) {
    const b = this.battle;
    if (!b || b.over) return;
    const nowBeat = this.ctx.audio.beatPos;
    let best = null, bd = 0.55;
    for (const c of b.cues) {
      if (c.lane !== lane || c.judged) continue;
      const d = Math.abs(nowBeat - c.beat);
      if (d < bd) { bd = d; best = c; }
    }
    const pad = document.querySelector(`#battle .pad[data-lane="${lane}"]`);
    pad.classList.add('hit');
    setTimeout(() => pad.classList.remove('hit'), 90);
    if (!best) return;
    const dSec = bd * BEAT;
    let pts = 0, label = 'MISS', color = '#ff4d6d';
    if (dSec < 0.11) { pts = 100; label = 'PERFECT!'; color = '#ffd76e'; }
    else if (dSec < 0.26) { pts = 60; label = 'GOOD'; color = '#4dd8ff'; }
    if (pts > 0) {
      best.judged = true; best.hit = true;
      best.ring?.remove(); best.ring = null;
      b.score += pts;
      document.getElementById('battle-score').textContent = String(b.score);
      this.ctx.audio.sfx('click');
    }
    const fb = document.createElement('div');
    fb.className = 'pad-feedback';
    fb.textContent = label;
    fb.style.color = color;
    pad.appendChild(fb);
    setTimeout(() => fb.remove(), 650);
  }

  _updateBattle() {
    const b = this.battle;
    if (!b) return;
    const audio = this.ctx.audio;
    const nowBeat = audio.beatPos;
    const lead = 2.0; // beats of ring shrink

    for (const c of b.cues) {
      const dt = c.beat - nowBeat;
      if (!c.ring && !c.judged && dt <= lead && dt > -0.5) {
        const pad = document.querySelector(`#battle .pad[data-lane="${c.lane}"]`);
        const ring = document.createElement('div');
        ring.className = 'ring';
        pad.appendChild(ring);
        c.ring = ring;
      }
      if (c.ring) {
        const p = clamp(dt / lead, -0.2, 1);
        const s = 1 + p * 1.4;
        c.ring.style.transform = `scale(${s})`;
        c.ring.style.opacity = String(clamp(1.2 - p, 0, 1));
      }
      if (!c.judged && nowBeat - c.beat > 0.5) {
        c.judged = true;
        c.ring?.remove(); c.ring = null;
      }
    }

    if (nowBeat > b.startBeat + 16.5 && !b.over) {
      b.over = true;
      const pct = b.score / 1600;
      const win = pct >= 0.65;
      document.getElementById('battle-msg').textContent =
        win ? `YOU WIN — ${Math.round(pct * 100)}%! DURPLE IS SPEECHLESS` : `${Math.round(pct * 100)}% — DURPLE SMIRKS. TRY AGAIN!`;
      this.ctx.audio.sfx(win ? 'win' : 'lose');
      if (win && this.missions.battle.state === 'active') this._completeMission('battle');
      setTimeout(() => this._endBattle(win), 2200);
    }
  }

  _endBattle(_win, silent = false) {
    document.querySelectorAll('#battle .ring, #battle .pad-feedback').forEach((el) => el.remove());
    document.getElementById('battle').classList.add('hidden');
    this.battle = null;
    if (!silent && this.amb) {
      this.amb.thump.setGain(0.0001);
      this.amb.boom.setGain(0.0001);
      this.amb.chime.setGain(0.05);
    }
  }

  // ---------------- per-frame update ----------------

  update(dt) {
    if (!this._built) return;
    const { engine, audio } = this.ctx;
    const t = engine.time;

    // ----- day cycle -----
    this.dayT = (this.dayT + dt / DAY_LENGTH) % 1;
    const dayT = this.dayT;
    const elev = Math.sin(((dayT - 0.25) / 0.5) * Math.PI);   // >0 during day
    const dayMix = clamp(elev * 2.4, 0, 1);
    const dusk = clamp(1 - Math.abs(elev) * 3.2, 0, 1);
    const theta = ((dayT - 0.25) / 0.5) * Math.PI;
    this.sunDir.set(Math.cos(theta), Math.max(Math.sin(theta), -0.35), 0.35).normalize();

    this.skyU.uDayMix.value = dayMix;
    this.skyU.uDusk.value = dusk;
    this.skyU.uTime.value = t;
    this.waterU.uTime.value = t;
    this.waterU.uDay.value = dayMix;

    const p = this.player.group.position;
    this.sun.position.copy(p).addScaledVector(this.sunDir, 120);
    this.sun.target.position.copy(p);
    this.sun.intensity = lerp(0.02, 2.7, dayMix) + dusk * 0.5;
    this.sun.color.setHSL(0.09, dusk * 0.75, lerp(0.62, 0.72, dayMix));
    this.hemi.intensity = lerp(0.12, 0.6, dayMix);
    this.scene.fog.color.setHSL(0.6, lerp(0.35, 0.28, dayMix), lerp(0.05, 0.72, dayMix));
    this.scene.fog.density = lerp(0.011, 0.006, dayMix);

    const night = 1 - dayMix;
    this.windowMat.emissiveIntensity = night * 2.2;
    this.lampMat.emissiveIntensity = night * 2.6;
    for (const l of this.lampLights) l.intensity = night * 40;
    this.fireflies.points.material.opacity = night * 0.5;
    this.fireflies.update(dt, t);
    this.playerGlow.intensity = 0.5 + night * 2;

    // clock UI
    const hour = Math.floor(dayT * 24), min = Math.floor((dayT * 24 % 1) * 60);
    document.getElementById('day-clock').textContent =
      `${dayMix > 0.25 ? '☀' : '☾'} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

    // ----- stage show (evening) -----
    const evening = dayT > 0.7 && dayT < 0.95;
    const energy = audio.getEnergy();
    const beat = audio.beatPos;
    for (let i = 0; i < this.stageCones.length; i++) {
      const cone = this.stageCones[i];
      cone.material.uniforms.uTime.value = t;
      cone.material.uniforms.uOpacity.value = evening ? 0.1 + energy.bass * 0.22 : 0.02;
      cone.rotation.z = Math.sin(t * 0.7 + i * 2.1) * 0.35;
      this.stageSpots[i].intensity = evening ? 60 + energy.bass * 260 : 0;
    }
    this.stageRing.material.emissiveIntensity = 1.2 + energy.bass * 4;

    // ----- ambience gains (throttled) -----
    this._ambT += dt;
    if (this.amb && this._ambT > 0.2 && !this.battle) {
      this._ambT = 0;
      const distStage = p.distanceTo(this.stagePos);
      const att = Math.pow(clamp(1 - distStage / 80, 0, 1), 2);
      this.amb.thump.setGain(evening ? 0.5 * att : 0.0001);
      this.amb.boom.setGain(evening ? 0.4 * att : 0.0001);
      this.amb.chime.setGain(evening ? 0.35 * att : 0.04 + att * 0.06);
    }
    if (evening && energy.bass > 0.45) engine.pulse(energy.bass * 0.15);

    // ----- player movement -----
    const inputLocked = !!this.dialogueNpc || !!this.battle;
    let mx = 0, mz = 0;
    if (!inputLocked) {
      if (this.keys.KeyW || this.keys.ArrowUp) mz -= 1;
      if (this.keys.KeyS || this.keys.ArrowDown) mz += 1;
      if (this.keys.KeyA || this.keys.ArrowLeft) mx -= 1;
      if (this.keys.KeyD || this.keys.ArrowRight) mx += 1;
      if (this.joy?.active) { mx += this.joy.x; mz += this.joy.y; }
    }
    const mag = Math.min(1, Math.hypot(mx, mz));
    const moving = mag > 0.12;
    const run = this.keys.ShiftLeft || this.keys.ShiftRight || mag > 0.94;
    const speed = (run ? 10.5 : 6.2) * (moving ? mag : 0);
    if (moving) {
      const ang = Math.atan2(mx, mz) + this.camYaw;
      const dirX = Math.sin(ang), dirZ = Math.cos(ang);
      p.x = clamp(p.x + dirX * speed * dt, -PLAY_RADIUS, PLAY_RADIUS);
      p.z = clamp(p.z + dirZ * speed * dt, -PLAY_RADIUS, PLAY_RADIUS);
      const targetRot = Math.atan2(dirX, dirZ);
      let dr = targetRot - this.player.group.rotation.y;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      this.player.group.rotation.y += dr * clamp(dt * 10, 0, 1);
    }
    // jump
    if ((this.keys.Space || this._touchJump) && this.grounded && !inputLocked) {
      this.playerVelY = 7.5;
      this.grounded = false;
    }
    this._touchJump = false;
    const groundY = heightAt(p.x, p.z);
    if (!this.grounded) {
      this.playerVelY -= 22 * dt;
      p.y += this.playerVelY * dt;
      if (p.y <= groundY) { p.y = groundY; this.grounded = true; this.playerVelY = 0; }
    } else {
      p.y = damp(p.y, groundY, 14, dt);
    }
    this.player.update(dt, {
      anim: !this.grounded ? 'panic'
        : moving ? 'walk'
        : (evening && p.distanceTo(this.stagePos) < 14 && !inputLocked) ? 'dance'
        : this.dialogueNpc ? 'talk' : 'idle',
      speed: moving ? speed : 0,
      beat, energy: energy.level,
    });
    this.crystal.rotation.y += dt * 2.5;
    this.crystal.position.y = 2.7 + Math.sin(t * 2.4) * 0.12;

    // ----- camera -----
    const cy = Math.sin(this.camPitch), ch = Math.cos(this.camPitch);
    const camTarget = new THREE.Vector3(
      p.x + Math.sin(this.camYaw) * ch * this.camDist,
      p.y + 1.2 + cy * this.camDist,
      p.z + Math.cos(this.camYaw) * ch * this.camDist);
    // keep camera above terrain
    camTarget.y = Math.max(camTarget.y, heightAt(camTarget.x, camTarget.z) + 0.6);
    this.camera.position.x = damp(this.camera.position.x, camTarget.x, 10, dt);
    this.camera.position.y = damp(this.camera.position.y, camTarget.y, 10, dt);
    this.camera.position.z = damp(this.camera.position.z, camTarget.z, 10, dt);
    this.camera.lookAt(p.x, p.y + 1.7, p.z);

    // ----- NPCs -----
    for (const npc of this.npcs) this._updateNpc(npc, dt, dayT, beat, energy.level);

    // ----- interact prompt -----
    const prompt = document.getElementById('interact-prompt');
    const near = (!this.dialogueNpc && !this.battle) ? this._nearestNpc() : null;
    if (near) {
      prompt.innerHTML = `Press <b>E</b> to talk to ${near.spec.name}`;
      prompt.classList.remove('hidden');
    } else prompt.classList.add('hidden');

    // ----- mission pickups -----
    if (this.missions.lostbeat.state === 'active') {
      for (const o of this.orbs) {
        if (o.taken) continue;
        o.orb.position.y = 1 + Math.sin(t * 2.2 + o.group.position.x) * 0.2;
        o.orb.rotation.y += dt;
        if (o.group.position.distanceTo(p) < 2.4) {
          o.taken = true;
          o.group.visible = false;
          const m = this.missions.lostbeat;
          m.count++;
          this.ctx.audio.sfx('pickup');
          this.bursts.spawn(o.group.position.clone().add(new THREE.Vector3(0, 1, 0)),
            { count: 40, colors: [0xff5555, 0xffaa88] });
          if (m.count >= 3) { m.state = 'ready'; this.ctx.ui.toast('All beat-orbs found! Return to OREN'); }
          else this.ctx.ui.toast(`Beat-orb ${m.count}/3`);
          this._updateMissionUI();
        }
      }
    }
    if (this.missions.harvest.state === 'active') {
      for (const c of this.goldCrops) {
        if (c.taken) continue;
        c.mesh.rotation.y += dt * 1.5;
        if (c.mesh.position.distanceTo(p) < 2) {
          c.taken = true;
          c.mesh.visible = false;
          const m = this.missions.harvest;
          m.count++;
          this.ctx.audio.sfx('pickup');
          this.bursts.spawn(c.mesh.position, { count: 30, colors: [0xffd76e, 0xfff3c4] });
          if (m.count >= 5) { m.state = 'ready'; this.ctx.ui.toast('Harvest done! Return to MR. TREE'); }
          else this.ctx.ui.toast(`Golden crops ${m.count}/5`);
          this._updateMissionUI();
        }
      }
    }

    this._updateBattle();
    this.bursts.update(dt);
  }

  _updateNpc(npc, dt, dayT, beat, energy) {
    const { rig } = npc;
    const id = npc.spec.id;

    // --- schedule → target + activity ---
    let target, act;
    const isNight = dayT > 0.92 || dayT < 0.1;
    if (id === 'echo') {
      // ECHO only exists between dusk and deep night
      const out = dayT > 0.72 || dayT < 0.06;
      rig.group.visible = out;
      if (!out) return;
      target = this.pois.plaza.clone().add(new THREE.Vector3(
        Math.sin(npc.offA + this.ctx.engine.time * 0.13) * 9, 0,
        Math.cos(npc.offA + this.ctx.engine.time * 0.13) * 9));
      act = 'dance';
    } else if (isNight) {
      target = npc.home.door; act = 'sleep';
    } else if (dayT < 0.18) {
      target = this._poiSpot('plaza', npc); act = 'idle';
    } else if (dayT < 0.45) {
      target = this._poiSpot(WORK[id].poi, npc); act = WORK[id].act;
    } else if (dayT < 0.55) {
      target = this._poiSpot('plaza', npc); act = 'talk';
    } else if (dayT < 0.7) {
      target = this._poiSpot(WORK[id].poi, npc); act = WORK[id].act;
    } else {
      target = this._poiSpot('stage', npc); act = 'dance';
    }

    // sleeping villagers vanish indoors
    if (id !== 'echo') {
      const atHome = rig.group.position.distanceTo(npc.home.door) < 1.6;
      rig.group.visible = !(act === 'sleep' && atHome && id !== 'boom');
    }

    if (npc.paused) {
      rig.lookTarget = this.player.group.position;
      const dx = this.player.group.position.x - rig.group.position.x;
      const dz = this.player.group.position.z - rig.group.position.z;
      rig.group.rotation.y = Math.atan2(dx, dz);
      rig.update(dt, { anim: 'talk', beat, energy });
      return;
    }

    // --- steering ---
    const pos = rig.group.position;
    const d = Math.hypot(target.x - pos.x, target.z - pos.z);
    if (d > 1.4) {
      const dirX = (target.x - pos.x) / d, dirZ = (target.z - pos.z) / d;
      const sp = 2.7;
      pos.x += dirX * sp * dt;
      pos.z += dirZ * sp * dt;
      rig.group.rotation.y = Math.atan2(dirX, dirZ);
      act = 'walk';
    }
    pos.y = damp(pos.y, heightAt(pos.x, pos.z), 12, dt);
    rig.update(dt, { anim: act, beat: beat + npc.offA, speed: 2.7, energy });
  }

  _poiSpot(poi, npc) {
    const base = this.pois[poi] ?? this.pois.plaza;
    return new THREE.Vector3(
      base.x + Math.cos(npc.offA) * npc.offR, base.y,
      base.z + Math.sin(npc.offA) * npc.offR);
  }
}
