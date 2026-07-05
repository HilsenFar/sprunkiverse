// ============================================================
//  SEA-SPRUNKIES — a living aquarium. You watch. That's it.
//  Flocking sea-sprunkies, bubbles, kelp, volumetric shafts.
// ============================================================
import * as THREE from 'three';
import { clamp, lerp, rand, pick, DriftField, makeLightCone } from '../core/utils.js';
import { CHARACTERS, createSeaSprunki } from '../characters.js';
import { loadSpriteManifest, createSpriteRig } from '../sprites3d.js';

const TANK = { x: 46, y: 24, z: 30 };   // swim volume half-extents-ish

export class AquariumMode {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 400);
    this.fish = [];
    this.kelp = [];
    this._bubbleT = 0;
    this._built = false;
  }

  _build() {
    const s = this.scene;
    s.environment = this.ctx.engine.envTex;
    s.environmentIntensity = 0.25;
    s.background = new THREE.Color(0x03141f);
    s.fog = new THREE.FogExp2(0x04202f, 0.022);

    s.add(new THREE.HemisphereLight(0x7fc4e8, 0x032030, 0.9));
    const sun = new THREE.DirectionalLight(0xbfe8ff, 1.6);
    sun.position.set(10, 40, 8);
    s.add(sun);

    // sand floor
    const floorGeo = new THREE.PlaneGeometry(160, 120, 40, 30);
    floorGeo.rotateX(-Math.PI / 2);
    const fpos = floorGeo.attributes.position;
    for (let i = 0; i < fpos.count; i++) {
      fpos.setY(i, Math.sin(fpos.getX(i) * 0.3) * 0.5 + Math.cos(fpos.getZ(i) * 0.4) * 0.5);
    }
    floorGeo.computeVertexNormals();
    const floor = new THREE.Mesh(floorGeo,
      new THREE.MeshStandardMaterial({ color: 0xc9b287, roughness: 0.95 }));
    floor.position.y = -TANK.y / 2 - 2;
    s.add(floor);

    // rocks + treasure
    for (let i = 0; i < 10; i++) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rand(1, 3.4), 0),
        new THREE.MeshStandardMaterial({ color: 0x3f4a55, roughness: 0.9 }));
      rock.position.set(rand(-45, 45), -TANK.y / 2 - 1.2, rand(-28, 28));
      rock.rotation.set(rand(3), rand(3), rand(3));
      s.add(rock);
    }
    const chest = new THREE.Group();
    const chestMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.7 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 1.6), chestMat);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.6, 12, 1, false, 0, Math.PI), chestMat);
    lid.rotation.z = Math.PI / 2;
    lid.rotation.y = Math.PI / 2;
    lid.position.y = 0.7;
    lid.rotation.x = -0.5;
    const glowIn = new THREE.PointLight(0xffd76e, 30, 8, 2);
    glowIn.position.y = 1;
    const gold = new THREE.Mesh(
      new THREE.SphereGeometry(0.65, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd76e, emissive: 0xffb02e, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.7 }));
    gold.position.y = 0.7;
    gold.scale.y = 0.5;
    chest.add(base, lid, gold, glowIn);
    chest.position.set(8, -TANK.y / 2 - 1.1, 4);
    chest.rotation.y = -0.6;
    s.add(chest);

    // kelp — swaying cylinders
    const kelpMat = new THREE.MeshStandardMaterial({ color: 0x2e8f5a, roughness: 0.7 });
    for (let i = 0; i < 22; i++) {
      const h = rand(7, 16);
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, h, 6, 6), kelpMat);
      k.geometry.translate(0, h / 2, 0);
      k.position.set(rand(-46, 46), -TANK.y / 2 - 1.6, rand(-26, 26));
      s.add(k);
      this.kelp.push({ mesh: k, seed: rand(10), h });
    }

    // volumetric light shafts from above
    for (let i = 0; i < 5; i++) {
      const cone = makeLightCone(0x9fd8ff, 0.07, rand(3, 6), 42);
      cone.position.set(rand(-34, 34), TANK.y / 2 + 8, rand(-16, 16));
      cone.rotation.x = Math.PI;               // wide end down
      cone.rotation.z = rand(-0.12, 0.12);
      s.add(cone);
    }

    // bubbles + plankton
    this.bubbles = new DriftField(s, {
      count: 500, box: { x: 90, y: TANK.y + 16, z: 60 }, center: new THREE.Vector3(0, 0, 0),
      size: 0.16, color: 0xbfe8ff, opacity: 0.45, rise: 2.2, wobble: 1.6,
    });
    this.plankton = new DriftField(s, {
      count: 700, box: { x: 100, y: TANK.y + 10, z: 70 }, center: new THREE.Vector3(0, 0, 0),
      size: 0.05, color: 0x9fd8ff, opacity: 0.3, rise: 0.1, wobble: 0.6,
    });

    // the sea-sprunkies
    for (let i = 0; i < 14; i++) {
      const base = pick(CHARACTERS);
      const spec = { ...base, id: `sea${i}` };
      const rig = createSeaSprunki(spec, { scale: rand(0.7, 1.25) });
      rig.group.position.set(rand(-TANK.x / 2, TANK.x / 2), rand(-TANK.y / 2, TANK.y / 2), rand(-TANK.z / 2, TANK.z / 2));
      this.scene.add(rig.group);
      this.fish.push({
        rig,
        baseId: base.id,
        scale: rand(0.5, 0.9),
        vel: new THREE.Vector3(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).normalize().multiplyScalar(rand(2, 4)),
        speed: rand(2.2, 4.2),
        seed: rand(100),
      });
    }
    // upgrade the school to the original cutouts, drifting like a paper mobile
    loadSpriteManifest().then((man) => {
      for (const f of this.fish) {
        const files = man?.[f.baseId];
        if (!files?.idle) continue;
        createSpriteRig({ id: f.baseId }, files, { keys: ['idle', 'idle2'] }).then((rig) => {
          rig.group.scale.setScalar(f.scale);
          rig.group.position.copy(f.rig.group.position);
          rig.cameraRef = this.camera;
          this.scene.add(rig.group);
          this.scene.remove(f.rig.group);
          f.rig = rig;
        }).catch(() => {});
      }
    }).catch(() => {});
    this._built = true;
  }

  enter() {
    if (!this._built) this._build();
    const { engine, audio } = this.ctx;
    engine.setScene(this.scene, this.camera);
    engine.grade.uniforms.uVignette.value = 1.25;
    document.getElementById('hud-aqua').classList.remove('hidden');
    this.ambient = audio.playLoopRaw('drift', 0.18);
    this.voxo = audio.playLoopRaw('voxo', 0.06);
    this.camAngle = 0;
  }

  exit() {
    document.getElementById('hud-aqua').classList.add('hidden');
    this.ambient?.stop();
    this.voxo?.stop();
  }

  update(dt) {
    if (!this._built) return;
    const t = this.ctx.engine.time;

    // slow cinematic drift — the observer's camera
    this.camAngle += dt * 0.045;
    const r = 42 + Math.sin(t * 0.11) * 8;
    this.camera.position.set(
      Math.sin(this.camAngle) * r,
      Math.sin(t * 0.07) * 6 + 2,
      Math.cos(this.camAngle) * r);
    this.camera.lookAt(0, Math.sin(t * 0.05) * 3, 0);

    // flocking-ish: cohesion to center, separation, wander
    const center = new THREE.Vector3(0, 0, 0);
    for (const f of this.fish) {
      const p = f.rig.group.position;
      const steer = new THREE.Vector3();

      // stay in tank
      steer.add(new THREE.Vector3(
        -p.x * Math.max(0, Math.abs(p.x) / (TANK.x / 2) - 0.7) * 0.15,
        -p.y * Math.max(0, Math.abs(p.y) / (TANK.y / 2) - 0.7) * 0.3,
        -p.z * Math.max(0, Math.abs(p.z) / (TANK.z / 2) - 0.7) * 0.15));
      // gentle wander
      steer.x += Math.sin(t * 0.6 + f.seed) * 0.05;
      steer.y += Math.cos(t * 0.5 + f.seed * 1.7) * 0.03;
      steer.z += Math.cos(t * 0.7 + f.seed * 0.7) * 0.05;
      // mild cohesion
      steer.addScaledVector(center.clone().sub(p), 0.0015);
      // separation
      for (const o of this.fish) {
        if (o === f) continue;
        const d = p.distanceTo(o.rig.group.position);
        if (d < 2.2 && d > 0.001) {
          steer.addScaledVector(p.clone().sub(o.rig.group.position).divideScalar(d), (2.2 - d) * 0.06);
        }
      }

      f.vel.addScaledVector(steer, dt * 60);
      f.vel.y = clamp(f.vel.y, -1.6, 1.6);
      f.vel.setLength(f.speed);
      p.addScaledVector(f.vel, dt);

      // face swim direction (cutouts billboard toward the camera instead)
      const yaw = Math.atan2(f.vel.x, f.vel.z);
      const pitch = clamp(-f.vel.y / f.speed, -0.5, 0.5);
      f.rig.group.rotation.y = yaw;
      f.rig.group.rotation.x = pitch * (f.rig.isSprite ? 0.4 : 1);
      if (f.rig.isSprite) f.rig.update(dt, { anim: 'idle' });
      else f.rig.update(dt, f.speed * 0.5);
    }

    // kelp sway
    for (const k of this.kelp) {
      k.mesh.rotation.z = Math.sin(t * 0.8 + k.seed) * 0.16;
      k.mesh.rotation.x = Math.cos(t * 0.6 + k.seed * 2) * 0.1;
    }

    this.bubbles.update(dt, t);
    this.plankton.update(dt, t);

    // occasional bubble blip
    this._bubbleT -= dt;
    if (this._bubbleT <= 0) {
      this._bubbleT = rand(1.5, 5);
      this.ctx.audio.sfx('bubble');
    }
  }
}
