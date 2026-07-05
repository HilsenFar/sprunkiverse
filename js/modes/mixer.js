// ============================================================
//  STUDIO — the classic Sprunki stage.
//  Ten synced loops, seven slots, one secret combo.
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { clamp, lerp, rand, easeOutBack, BurstPool, DriftField, makeLightCone } from '../core/utils.js';
import { STUDIO_CAST, createSprunki, makeCustomSpec, renderPortraits } from '../characters.js';
import { loadSpriteManifest, createSpriteRig } from '../sprites3d.js';
import { LOOP_LEN } from '../audio.js';

const SLOTS = 7;
const EQ_COLS = 26, EQ_ROWS = 11;
const SPRUNK_COMBO = ['thump', 'chime', 'tika', 'snapp'];   // Oren · Sky · Clukr · Raddy
const classicEntries = () =>
  STUDIO_CAST.map((spec) => ({ id: spec.id, name: spec.name, cat: spec.cat, spec }));
const isCastKit = (kitId) => kitId === 'classic' || kitId === 'sprunki';

// Phases — each one drags sound & vision darker, Sprunki-style.
const PHASES = [
  { name: 'PHASE I — NEON', tint: 'normal',
    fog: 0x05060d, fogD: 0.03, hemi: 0.3, hemiCol: 0x8a92ff,
    cones: [0xff4d6d, 0x7c6cff, 0x4dd8ff, 0xffd76e], dust: 0x9aa4ff,
    eqHue: 0.62, eqSpan: 0.35, dim: 1,
    portalHue: 0.7, portalDrift: 0.015,
    sat: 1.1, contrast: 1.05, vig: 1.0, grain: 0.032, ca: 0.0004, bloom: 0, key: 320 },
  { name: 'PHASE II — DUSK', tint: 'dusk',
    fog: 0x080512, fogD: 0.037, hemi: 0.2, hemiCol: 0x6a5aa8,
    cones: [0xb44dff, 0x5a3fd8, 0x2f6fd8, 0x8a4dc9], dust: 0x7a6ac9,
    eqHue: 0.72, eqSpan: 0.16, dim: 0.78,
    portalHue: 0.78, portalDrift: 0.008,
    sat: 0.92, contrast: 1.08, vig: 1.25, grain: 0.05, ca: 0.0012, bloom: 0.06, key: 210 },
  { name: 'PHASE III — CORRUPT', tint: 'corrupt',
    fog: 0x0d0206, fogD: 0.048, hemi: 0.12, hemiCol: 0x8a2020,
    cones: [0xff1f1f, 0x8a0f2a, 0xd84a12, 0x5a0a0a], dust: 0x8a2a2a,
    eqHue: 0.97, eqSpan: 0.06, dim: 0.55,
    portalHue: 0.99, portalDrift: 0.003,
    sat: 0.7, contrast: 1.13, vig: 1.5, grain: 0.068, ca: 0.002, bloom: 0.16, key: 120 },
  { name: 'PHASE IV — VOID', tint: 'void',
    fog: 0x010102, fogD: 0.065, hemi: 0.05, hemiCol: 0x3a0a12,
    cones: [0x9a0a0a, 0x2a0208, 0x6a0505, 0xdfe4ff], dust: 0x5a0a0a,
    eqHue: 0.99, eqSpan: 0.02, dim: 0.32,
    portalHue: 0.0, portalDrift: 0.001,
    sat: 0.42, contrast: 1.2, vig: 1.75, grain: 0.1, ca: 0.003, bloom: 0.26, key: 55 },
];
for (const P of PHASES) {
  P.fogC = new THREE.Color(P.fog);
  P.hemiC = new THREE.Color(P.hemiCol);
  P.coneC = P.cones.map((c) => new THREE.Color(c));
  P.dustC = new THREE.Color(P.dust);
}

export class MixerMode {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 200);
    this.camera.position.set(0, 3.6, 11.8);
    this.slots = new Array(SLOTS).fill(null);   // {id, rig, muted}
    this.bursts = new BurstPool(this.scene);
    this.raycaster = new THREE.Raycaster();
    this.sprunk = 0;                            // seconds remaining
    this.sprunkHandle = null;
    this._lastBeat = -1;
    this._clickT = null;
    this._built = false;
    this.phase = 1;
    this._strobe = 0;
    this._preHorror = null;
    // active kit: 'sprunki' = original recordings, 'classic' = synth, else kits.json id
    this.kitId = 'sprunki';
    this.entries = classicEntries();
    this._kitEntries = new Map();               // kitId -> entries with generated specs
    this._kitPortraits = new Map();             // kitId -> Map(id -> dataURL)
    this._kitBusy = false;
    this._sprites = null;                       // original 2D costume manifest (once loaded)
    this._active = false;                       // true while this mode owns the session
  }

  /** BLACK on a cast kit owns the phase — manual phase controls are locked. */
  _horrorLocked() {
    return isCastKit(this.kitId) && this.slots.some((sl) => sl?.id === 'echo' && !sl.muted);
  }

  // ---------------- build ----------------

  _build() {
    const s = this.scene;
    s.environment = this.ctx.engine.envTex;
    s.environmentIntensity = 0.3;
    s.background = new THREE.Color(0x05060d);
    s.fog = new THREE.FogExp2(0x05060d, 0.03);

    s.add(new THREE.HemisphereLight(0x8a92ff, 0x0a0714, 0.3));

    // key light with shadows
    const key = new THREE.SpotLight(0xffffff, 320, 40, 0.7, 0.45, 1.8);
    key.position.set(0, 13, 10);
    key.target.position.set(0, 0, -2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0003;
    s.add(key, key.target);
    this.keyLight = key;
    this.hemi = s.children.find((o) => o.isHemisphereLight);

    // mirror floor + dark glass overlay = wet stage
    const mirror = new Reflector(new THREE.CircleGeometry(16, 48), {
      textureWidth: 1024, textureHeight: 1024,
      color: 0x889099, clipBias: 0.003,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -0.02;
    s.add(mirror);
    const glass = new THREE.Mesh(
      new THREE.CircleGeometry(16, 48),
      new THREE.MeshPhysicalMaterial({
        color: 0x0a0b16, transparent: true, opacity: 0.72,
        roughness: 0.25, clearcoat: 1,
      }));
    glass.rotation.x = -Math.PI / 2;
    glass.receiveShadow = true;
    s.add(glass);

    // stage line-up — the classic Sprunki row, subtle floor markers only
    this.pedestals = [];
    const pedGeo = new THREE.CylinderGeometry(0.85, 0.92, 0.07, 26);
    const pedMat = new THREE.MeshPhysicalMaterial({ color: 0x141225, roughness: 0.35, clearcoat: 0.8 });
    for (let i = 0; i < SLOTS; i++) {
      const x = (i - (SLOTS - 1) / 2) * 1.85;
      const z = 3.0 - Math.abs(i - (SLOTS - 1) / 2) * 0.22;   // barely-curved row
      const ped = new THREE.Mesh(pedGeo, pedMat);
      ped.position.set(x, 0.035, z);
      ped.castShadow = ped.receiveShadow = true;
      s.add(ped);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.88, 0.045, 8, 40),
        new THREE.MeshStandardMaterial({ color: 0x2a2450, emissive: 0x7c6cff, emissiveIntensity: 0.4 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 0.09, z);
      s.add(ring);
      this.pedestals.push({ pos: new THREE.Vector3(x, 0.08, z), ring });
    }

    // giant back ring portal
    this.portal = new THREE.Mesh(
      new THREE.TorusGeometry(8.6, 0.16, 12, 80),
      new THREE.MeshBasicMaterial({ color: 0x7c6cff }));
    this.portal.position.set(0, 6.5, -14.5);
    s.add(this.portal);

    // THE original mod backdrops — gray room (Ⅰ–Ⅱ), red wall with eyes (Ⅲ),
    // the eye in the dark (Ⅳ) — rasterized crisp from the extracted assets
    this.backdropMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 16.2),
      new THREE.MeshBasicMaterial({ color: 0x6a6a70, fog: false, toneMapped: false }));
    this.backdropMesh.position.set(0, 7.4, -15.4);
    s.add(this.backdropMesh);
    this.backdropTexs = [null, null, null, null];
    const bdFiles = [
      'backdrop_backdrop.svg', 'backdrop_backdrop.svg',
      'backdrop_backdropevil.svg', 'backdrop_scary-dark.png',
    ];
    bdFiles.forEach((file, i) => {
      if (i > 0 && bdFiles[i] === bdFiles[i - 1]) return;   // share phase Ⅰ/Ⅱ texture
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const w = 2048;
        c.width = w;
        c.height = Math.round((img.height / img.width) * w) || 768;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        for (let k = i; k < 4; k++) {
          if (bdFiles[k] === file) this.backdropTexs[k] = tex;
        }
        this._applyBackdrop();
      };
      img.src = `assets/sprunki/${file}`;
    });

    // EQ wall
    const box = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    this.eq = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), EQ_COLS * EQ_ROWS);
    // LED-strip proportions: keep the reactive wall low so the mod's own
    // backdrop wall reads clearly behind the lineup
    this.eq.scale.set(0.9, 0.45, 1);
    this.eq.position.y = -0.15;
    const dummy = new THREE.Object3D();
    const dark = new THREE.Color(0x0a0b16);
    let idx = 0;
    for (let cx = 0; cx < EQ_COLS; cx++) {
      for (let ry = 0; ry < EQ_ROWS; ry++) {
        dummy.position.set((cx - (EQ_COLS - 1) / 2) * 0.52, 0.6 + ry * 0.52, -13.8);
        dummy.updateMatrix();
        this.eq.setMatrixAt(idx, dummy.matrix);
        this.eq.setColorAt(idx, dark);
        idx++;
      }
    }
    s.add(this.eq);

    // light cones + colored spots
    this.cones = [];
    this.spots = [];
    const cols = [0xff4d6d, 0x7c6cff, 0x4dd8ff, 0xffd76e];
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 4.4;
      const cone = makeLightCone(cols[i], 0.12, 2.6, 11);
      cone.position.set(x, 10.4, -3);
      s.add(cone);
      this.cones.push(cone);
      const spot = new THREE.SpotLight(cols[i], 120, 30, 0.55, 0.5, 1.7);
      spot.position.set(x, 10.6, -3);
      spot.target.position.set(x * 0.4, 0, 1);
      s.add(spot, spot.target);
      this.spots.push(spot);
    }

    this.dust = new DriftField(s, {
      count: 700, box: { x: 30, y: 14, z: 24 }, center: new THREE.Vector3(0, 7, -2),
      size: 0.05, color: 0x9aa4ff, opacity: 0.3, rise: 0.12, wobble: 0.5,
    });

    this._built = true;
  }

  _buildRoster() {
    const roster = document.getElementById('roster');
    roster.innerHTML = '';
    const portraits = isCastKit(this.kitId)
      ? this.ctx.ui.portraits
      : (this._kitPortraits.get(this.kitId) ?? new Map());
    let prevCat = null;
    this.entries.forEach((entry, i) => {
      if (prevCat !== null && entry.cat !== prevCat) {
        const gap = document.createElement('span');
        gap.className = 'cat-gap';
        roster.appendChild(gap);
      }
      prevCat = entry.cat;
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = entry.id;
      card.style.setProperty('--card-color', `#${entry.spec.color.toString(16).padStart(6, '0')}`);
      // the classic cast shows the actual original 2D sprites on the cards
      const img = (isCastKit(this.kitId) && this._sprites?.[entry.id]?.idle)
        ? this._sprites[entry.id].idle
        : portraits.get(entry.id) ?? '';
      card.innerHTML = `
        ${i < 10 ? `<span class="key-hint">${(i + 1) % 10}</span>` : ''}
        <span class="cdot"></span>
        <img alt="${entry.name}" src="${img}" draggable="false" ${img.endsWith('.svg') ? 'style="object-fit:contain;padding:3px"' : ''}>
        <span class="cname">${entry.name}</span>`;
      this._wireCard(card, entry);
      roster.appendChild(card);
      if (this.slots.some((sl) => sl?.id === entry.id)) card.classList.add('on-stage');
    });
  }

  /** Incredibox-style: click OR drag a card onto the stage. */
  _wireCard(card, entry) {
    card.onpointerdown = (e) => {
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY };
      let ghost = null;
      const cleanup = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', cancel);
        card.classList.remove('dragging');
        ghost?.remove();
      };
      const move = (ev) => {
        if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 10) {
          ghost = card.cloneNode(true);
          ghost.classList.add('drag-ghost');
          document.body.appendChild(ghost);
          card.classList.add('dragging');
        }
        if (ghost) {
          ghost.style.left = `${ev.clientX}px`;
          ghost.style.top = `${ev.clientY}px`;
        }
      };
      const up = (ev) => {
        const dragged = !!ghost;
        cleanup();
        if (dragged) {
          const rosterTop = document.getElementById('roster').getBoundingClientRect().top;
          if (ev.clientY < rosterTop - 10) this.toggleCharacter(entry.id);   // dropped on stage
        } else {
          this.toggleCharacter(entry.id);                                    // plain click
        }
      };
      const cancel = () => cleanup();   // interrupted drag: no toggle, no stuck ghost
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', cancel);
    };
  }

  _buildPhaseSelect() {
    const wrap = document.getElementById('phase-select');
    if (wrap.childElementCount) return;
    const cols = ['#ffd76e', '#8a6aff', '#ff3030', '#7a0a14'];
    ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'].forEach((num, i) => {
      const btn = document.createElement('button');
      btn.textContent = num;
      btn.dataset.phase = String(i + 1);
      btn.title = PHASES[i].name;
      btn.style.setProperty('--pc', cols[i]);
      btn.classList.toggle('active', i + 1 === this.phase);
      btn.onclick = () => {
        if (this._horrorLocked()) {
          this.ctx.ui.toast('BLACK controls the dark — remove them first');
          return;
        }
        this.setPhase(i + 1);
      };
      wrap.appendChild(btn);
    });
  }

  /** Show the original mod backdrop matching the current phase. */
  _applyBackdrop() {
    if (!this.backdropMesh) return;
    const tex = this.backdropTexs[this.phase - 1] ?? this.backdropTexs[0];
    const mat = this.backdropMesh.material;
    if (mat.map !== tex) {
      mat.map = tex ?? null;
      mat.color.set(tex ? 0xffffff : 0x6a6a70);
      mat.needsUpdate = true;
    }
  }

  setPhase(p, instant = false) {
    p = Math.max(1, Math.min(4, p));
    if (p === this.phase && !instant) return;
    const goingDark = p > this.phase;
    this.phase = p;
    const { audio, engine, ui } = this.ctx;
    audio.setPhase(p);
    if (!instant) {
      audio.sfx(goingDark ? 'phasedown' : 'phaseup');
      // blackout dip while the world re-shapes itself
      engine.addTween((t) => {
        engine.grade.uniforms.uLift.value = -0.75 * Math.sin(Math.PI * Math.min(1, t));
      }, 1.1, { onDone: () => { engine.grade.uniforms.uLift.value = 0; } });
      ui.toast(PHASES[p - 1].name, 2800);
    }
    for (const sl of this.slots) {
      if (!sl?.rig) continue;
      sl.rig.setTint(sl.muted ? 'muted' : PHASES[p - 1].tint);
      sl.rig.setPhaseLook?.(p);         // original horror costumes at phase Ⅲ+
    }
    this._applyBackdrop();              // the mod's own wall for this phase
    document.querySelectorAll('#phase-select button').forEach((b) =>
      b.classList.toggle('active', +b.dataset.phase === p));
  }

  _buildKitSelect() {
    const wrap = document.getElementById('kit-select');
    if (wrap.childElementCount) return;
    const kits = [
      { id: 'sprunki', name: 'SPRUNKI' },
      { id: 'classic', name: 'SYNTH' },
      ...(this.ctx.ui.kits ?? []),
    ];
    for (const k of kits) {
      const btn = document.createElement('button');
      btn.textContent = k.name;
      btn.dataset.kit = k.id;
      btn.classList.toggle('active', k.id === this.kitId);
      btn.onclick = () => this._switchKit(k.id);
      wrap.appendChild(btn);
    }
    // SYNC — snap every playing loop back to the top, together
    const sync = document.createElement('button');
    sync.textContent = '⟳ SYNC';
    sync.className = 'sync-btn';
    sync.title = 'Restart all playing loops from the top, together';
    sync.onclick = () => {
      if (this.ctx.audio.resync()) {
        this.ctx.audio.sfx('click');
        this.ctx.ui.toast('Everyone from the top — SYNCED');
      } else {
        this.ctx.ui.toast('Nothing is playing yet');
      }
    };
    wrap.appendChild(sync);
    wrap.classList.toggle('hidden', kits.length < 2);
  }

  async _switchKit(kitId) {
    if (this._kitBusy || kitId === this.kitId) return;
    this._kitBusy = true;
    const { audio, ui } = this.ctx;
    try {
      // BLACK leaves with the stage — release the horror lock properly
      if (this._preHorror !== null) {
        const back = this._preHorror;
        this._preHorror = null;
        if (this.phase >= 3) this.setPhase(back, true);
      }
      this.clearStage();
      this._endSprunk();
      if (kitId === 'classic') {
        await audio.setKit(null);
        if (!this._active) return;                 // player left mid-switch
        this.entries = classicEntries();
      } else if (kitId === 'sprunki') {
        const firstLoad = !audio._origCache;
        if (firstLoad) ui.toast('Loading the original Sprunki sounds…');
        const ok = await audio.setOriginalKit((f) => {
          if (firstLoad) ui.toast(`Original sounds — ${Math.round(f * 100)}%`);
        });
        if (!this._active) { await audio.setKit(null); return; }   // hand the session back clean
        this.entries = classicEntries();
        if (!ok) {
          ui.toast('Original sounds unavailable — using synth');
          await audio.setKit(null);
          kitId = 'classic';
        } else if (firstLoad) {
          ui.toast('THE ORIGINAL SOUNDS — straight from the mod');
        }
      } else {
        const def = (ui.kits ?? []).find((k) => k.id === kitId);
        if (!def) return;
        const firstLoad = !this._kitEntries.has(kitId);
        if (firstLoad) ui.toast(`Loading ${def.name}…`);
        const raw = await audio.setKit(def, (f, name) => {
          if (firstLoad) ui.toast(`Loading ${def.name} — ${name} (${Math.round(f * 100)}%)`);
        });
        if (!this._active) { await audio.setKit(null); return; }   // player left mid-switch
        if (!this._kitEntries.has(kitId)) {
          const entries = raw.map((e, i) => ({ ...e, spec: makeCustomSpec(e.id, e.name, e.cat, i) }));
          this._kitEntries.set(kitId, entries);
          this._kitPortraits.set(kitId, renderPortraits(entries.map((e) => e.spec)));
        }
        this.entries = this._kitEntries.get(kitId);
        if (!this.entries.length) {
          ui.toast('No loops in that kit fit the beat grid');
          await audio.setKit(null);
          this.entries = classicEntries();
          kitId = 'classic';
        } else {
          ui.toast(`${def.name} ready — ${this.entries.length} loops @ ${def.bpm} BPM`);
        }
      }
      this.kitId = kitId;
      this._buildRoster();
      document.querySelectorAll('#kit-select button').forEach((b) =>
        b.classList.toggle('active', b.dataset.kit === kitId));
    } finally {
      this._kitBusy = false;
    }
  }

  // ---------------- stage management ----------------

  toggleCharacter(id) {
    if (this._kitBusy) return;   // audio session is mid-switch — no stage edits
    const slotIdx = this.slots.findIndex((sl) => sl?.id === id);
    if (slotIdx >= 0) { this._remove(slotIdx); return; }
    const free = this.slots.findIndex((sl) => sl === null);
    if (free < 0) { this.ctx.ui.toast('Stage is full — remove someone first'); return; }
    this._add(id, free);
  }

  _add(id, slotIdx) {
    const spec = this.entries.find((e) => e.id === id)?.spec;
    if (!spec) return;
    // sound first — the character materialises milliseconds later
    const slot = { id, rig: null, muted: false, spawnTween: null };
    this.slots[slotIdx] = slot;
    this.ctx.audio.play(id);
    this.ctx.audio.sfx('pop');
    const pos = this.pedestals[slotIdx].pos;
    this.bursts.spawn(pos.clone().add(new THREE.Vector3(0, 1.4, 0)),
      { count: 30, colors: [spec.color, spec.accent, 0xffffff], speed: 3 });
    document.querySelector(`.card[data-id="${id}"]`)?.classList.add('on-stage');
    this.ctx.ui.toast(`${spec.name} joined the mix`);

    const finish = (rig) => {
      if (this.slots[slotIdx] !== slot) return;      // removed while loading
      rig.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.charId = id; } });
      rig.cameraRef = this.camera;                   // cutouts keep facing the orbiting camera
      rig.group.position.copy(pos);
      rig.group.lookAt(this.camera.position.x * 0.3, pos.y, this.camera.position.z);
      rig.group.scale.setScalar(0.001);
      this.scene.add(rig.group);
      slot.spawnTween = this.ctx.engine.addTween(
        (t) => rig.group.scale.setScalar(Math.max(0.001, t)), 0.55, { ease: easeOutBack });
      slot.rig = rig;
      if (this.phase > 1) {
        rig.setTint(PHASES[this.phase - 1].tint);
        rig.setPhaseLook?.(this.phase);
      }
    };
    // the classic cast uses the original 2D costumes extruded to 3D; fallback: procedural
    const files = isCastKit(this.kitId) ? this._sprites?.[id] : null;
    if (files?.idle) {
      createSpriteRig(spec, files).then(finish).catch(() => finish(createSprunki(spec)));
    } else {
      finish(createSprunki(spec));
    }
  }

  _remove(slotIdx) {
    const sl = this.slots[slotIdx];
    if (!sl) return;
    this.ctx.audio.stop(sl.id);
    sl.spawnTween?.cancel();
    const rig = sl.rig;
    if (rig) {
      const from = rig.group.scale.x;
      this.ctx.engine.addTween((t) => rig.group.scale.setScalar(Math.max(0.001, from * (1 - t))), 0.3, {
        onDone: () => this.scene.remove(rig.group),
      });
    }
    this.slots[slotIdx] = null;
    document.querySelector(`.card[data-id="${sl.id}"]`)?.classList.remove('on-stage');
  }

  _toggleMute(slotIdx) {
    const sl = this.slots[slotIdx];
    if (!sl) return;
    sl.muted = this.ctx.audio.toggleMute(sl.id);
    sl.rig?.setTint(sl.muted ? 'muted' : PHASES[this.phase - 1].tint);
  }

  clearStage() {
    for (let i = 0; i < SLOTS; i++) this._remove(i);
  }

  // ---------------- input ----------------

  _slotFromEvent(e) {
    const p = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    const meshes = [];
    for (const sl of this.slots) if (sl?.rig) sl.rig.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const hit = this.raycaster.intersectObjects(meshes)[0];
    if (!hit) return -1;
    const id = hit.object.userData.charId;
    return this.slots.findIndex((sl) => sl?.id === id);
  }

  _handleTap(e) {
    const idx = this._slotFromEvent(e);
    if (idx < 0) return;
    // single = mute, double = remove
    if (this._clickT !== null) {
      clearTimeout(this._clickT);
      this._clickT = null;
      if (this._clickIdx === idx) { this._remove(idx); return; }
      this._toggleMute(this._clickIdx);   // resolve the older pending tap first
    }
    this._clickIdx = idx;
    this._clickT = setTimeout(() => { this._clickT = null; this._toggleMute(idx); }, 260);
  }

  // ---------------- enter / exit ----------------

  enter() {
    this._active = true;
    if (!this._built) this._build();
    if (!this._sprites) {
      loadSpriteManifest().then((m) => {
        this._sprites = m;
        if (isCastKit(this.kitId)) this._buildRoster();   // swap cards to the real 2D sprites
      });
    }
    this._buildRoster();
    this._buildKitSelect();
    this._buildPhaseSelect();
    if (this.phase > 1) this.ctx.audio.setPhase(this.phase);   // re-apply after exit reset
    // restore the previously chosen kit's audio session (cache makes this instant)
    if (this.kitId !== 'classic') {
      const target = this.kitId;
      this.kitId = 'classic';
      this._switchKit(target);
    }
    const { engine } = this.ctx;
    engine.setScene(this.scene, this.camera);
    engine.grade.uniforms.uVignette.value = 1.15;
    document.getElementById('hud-mixer').classList.remove('hidden');

    this.controls = this.controls ?? new OrbitControls(this.camera, engine.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 2.2, 0);
    this.controls.minDistance = 6;
    this.controls.maxDistance = 18;
    this.controls.maxPolarAngle = 1.5;
    this.controls.minPolarAngle = 0.6;
    this.controls.enablePan = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.enabled = true;

    // pointer taps with a drag guard so orbiting never mutes/removes performers
    this._pDown = null;
    this._onPointerDown = (e) => { this._pDown = { x: e.clientX, y: e.clientY }; };
    this._onPointerUp = (e) => {
      if (!this._pDown) return;
      const moved = Math.hypot(e.clientX - this._pDown.x, e.clientY - this._pDown.y);
      this._pDown = null;
      if (moved < 6) this._handleTap(e);
    };
    engine.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    engine.renderer.domElement.addEventListener('pointerup', this._onPointerUp);
    this._onKey = (e) => {
      if (e.repeat) return;
      if (!document.getElementById('help-panel').classList.contains('hidden')) return;
      if (e.code === 'KeyP') {
        if (this._horrorLocked()) this.ctx.ui.toast('BLACK controls the dark — remove them first');
        else this.setPhase(this.phase % 4 + 1);
        return;
      }
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9 }[e.code];
      if (n !== undefined && this.entries[n]) this.toggleCharacter(this.entries[n].id);
    };
    addEventListener('keydown', this._onKey);
    this.ctx.ui.toast('Click a card to start the mix');
  }

  exit() {
    this._active = false;
    document.getElementById('hud-mixer').classList.add('hidden');
    const canvas = this.ctx.engine.renderer.domElement;
    canvas.removeEventListener('pointerdown', this._onPointerDown);
    canvas.removeEventListener('pointerup', this._onPointerUp);
    removeEventListener('keydown', this._onKey);
    if (this._clickT) { clearTimeout(this._clickT); this._clickT = null; }
    this.controls.enabled = false;
    this.clearStage();
    this._endSprunk();
    this.ctx.audio.setKit(null);   // other modes always run on the classic 112 BPM session
    // hand the post pipeline back in daylight condition
    const { engine, audio } = this.ctx;
    audio.setPhase(1);
    engine.bloomExtra = 0;
    engine._satBase = 1.1;
    engine.grade.uniforms.uContrast.value = 1.05;
    engine.grade.uniforms.uCA.value = 0.0007;
    engine.grade.uniforms.uLift.value = 0;
    engine.setQuality(engine.quality);   // restores grain & bloom base
  }

  // ---------------- SPRUNK MODE ----------------

  /**
   * The authentic Sprunki mechanic: BLACK on stage drags everything
   * into horror mode (phase Ⅲ). BLACK together with OWAKCX → phase Ⅳ.
   * Removing them restores the phase you were in before.
   */
  _checkHorror() {
    if (!isCastKit(this.kitId)) return;
    const on = (id) => this.slots.some((sl) => sl?.id === id && !sl.muted);
    const black = on('echo');
    if (black) {
      const target = on('owakcx') ? 4 : 3;
      if (this._preHorror === null && this.phase < 3) this._preHorror = this.phase;
      if (this.phase !== target) {
        this.setPhase(target);
        this.ctx.ui.toast(target === 4 ? 'BLACK & OWAKCX — THE VOID OPENS' : 'BLACK HAS ENTERED — HORROR MODE', 3200);
      }
    } else if (this._preHorror !== null) {
      const back = this._preHorror;
      this._preHorror = null;
      if (this.phase >= 3) this.setPhase(back);
    }
  }

  _checkSprunk() {
    if (!isCastKit(this.kitId)) return;   // the secret combo lives with the classic cast
    const activeUnmuted = new Set(
      this.slots.filter((sl) => sl && !sl.muted).map((sl) => sl.id));
    const combo = SPRUNK_COMBO.every((id) => activeUnmuted.has(id));
    if (combo && this.sprunk <= 0 && !this._sprunkCooldown) {
      this.sprunk = LOOP_LEN * 2;
      this._sprunkCooldown = true;
      // the synthesized bonus lead lives on the 112 BPM synth grid — over the
      // original 100 BPM recordings we celebrate with fanfare + visuals instead
      if (this.kitId === 'classic') {
        this.sprunkHandle = this.ctx.audio.playLoopRaw('bonus', 0.5);
      } else {
        this.sprunkHandle = null;
        this.ctx.audio.sfx('win');
      }
      document.getElementById('bonus-banner').classList.remove('hidden');
      this.ctx.engine.pulse(1.2, 0.5);
      this.ctx.ui.toast('★ SECRET COMBO — SPRUNK MODE ★', 3500);
      for (const ped of this.pedestals) {
        this.bursts.spawn(ped.pos.clone().add(new THREE.Vector3(0, 2.4, 0)),
          { count: 40, colors: [0xffd76e, 0xff4d6d, 0x7c6cff, 0x4dd8ff], speed: 5 });
      }
    }
    if (!combo) this._sprunkCooldown = false;
    if (this.sprunk > 0 && !combo) this._endSprunk();
  }

  _endSprunk() {
    if (this.sprunk <= 0 && !this.sprunkHandle) return;
    this.sprunk = 0;
    this.sprunkHandle?.stop();
    this.sprunkHandle = null;
    document.getElementById('bonus-banner').classList.add('hidden');
    this.controls.autoRotateSpeed = 0.35;
  }

  // ---------------- per-frame ----------------

  update(dt) {
    if (!this._built) return;
    const { engine, audio } = this.ctx;
    const t = engine.time;
    this.controls.update();

    // ---- phase morph: everything glides toward the current phase's palette ----
    const cfg = PHASES[this.phase - 1];
    const k = clamp(dt * 2.2, 0, 1);
    this.scene.fog.color.lerp(cfg.fogC, k);
    this.scene.background.lerp(cfg.fogC, k);
    this.scene.fog.density = lerp(this.scene.fog.density, cfg.fogD, k);
    this.hemi.intensity = lerp(this.hemi.intensity, cfg.hemi, k);
    this.hemi.color.lerp(cfg.hemiC, k);
    this.keyLight.intensity = lerp(this.keyLight.intensity, cfg.key, k);
    this.dust.points.material.color.lerp(cfg.dustC, k);
    const g = engine.grade.uniforms;
    engine._satBase = lerp(engine._satBase, cfg.sat, k);
    g.uContrast.value = lerp(g.uContrast.value, cfg.contrast, k);
    g.uVignette.value = lerp(g.uVignette.value, cfg.vig, k);
    g.uGrain.value = lerp(g.uGrain.value, cfg.grain, k);
    g.uCA.value = lerp(g.uCA.value, cfg.ca, k);
    engine.bloomExtra = lerp(engine.bloomExtra, cfg.bloom, k);
    // void phase: irregular cold strobe
    if (this.phase === 4 && Math.random() < dt * 0.55) {
      this._strobe = 1;
      engine.pulse(0.18);
    }
    this._strobe = Math.max(0, this._strobe - dt * 6);

    const energy = audio.getEnergy();
    const beat = audio.beatPos;
    const beatFrac = beat % 1;
    const pulse = Math.pow(1 - beatFrac, 2.2);
    const playing = audio.playing;

    // beat kick on the downbeat
    const beatInt = Math.floor(beat);
    if (playing && beatInt !== this._lastBeat) {
      this._lastBeat = beatInt;
      engine.pulse(0.16 + energy.bass * 0.3, this.sprunk > 0 ? 0.12 : 0);
    }

    // characters dance
    for (let i = 0; i < SLOTS; i++) {
      const sl = this.slots[i];
      const ring = this.pedestals[i].ring;
      if (sl) {
        const level = (playing && !sl.muted) ? audio.getChannelLevel(sl.id) : 0;
        sl.rig?.update(dt, {
          anim: sl.muted || !playing ? 'idle' : 'dance',
          beat, energy: energy.level, level,
        });
        const col = new THREE.Color(this.entries.find((e) => e.id === sl.id)?.spec.color ?? 0x7c6cff);
        if (this.phase >= 3) col.lerp(new THREE.Color(0xff1f1f), 0.65);
        ring.material.emissive.copy(col);
        ring.material.emissiveIntensity = (sl.muted ? 0.15 : 0.8 + pulse * 2.6 * (playing ? 1 : 0)) * cfg.dim;
      } else {
        ring.material.emissive.set(this.phase >= 3 ? 0x8a0f1a : 0x7c6cff);
        ring.material.emissiveIntensity = (0.35 + Math.sin(t * 2 + i) * 0.15) * cfg.dim;
      }
    }

    // EQ wall
    const spectrum = audio.getSpectrum();
    if (spectrum) {
      const col = new THREE.Color();
      const dark = new THREE.Color(this.phase >= 3 ? 0x050205 : 0x0a0b16);
      let idx = 0;
      for (let cx = 0; cx < EQ_COLS; cx++) {
        const bin = Math.floor(Math.pow(2, (cx / EQ_COLS) * 7.5)) + 2;   // ~2..350
        const v = (spectrum[Math.min(bin, spectrum.length - 1)] / 255) * 1.15;
        for (let ry = 0; ry < EQ_ROWS; ry++) {
          const lit = ry / EQ_ROWS < v;
          if (lit) {
            const peak = ry / EQ_ROWS > v - 0.12;
            col.setHSL((cfg.eqHue + cx / EQ_COLS * cfg.eqSpan + t * 0.02 * cfg.dim) % 1, 0.9,
              (peak ? 0.72 : 0.45) * cfg.dim);
            this.eq.setColorAt(idx, col);
          } else {
            this.eq.setColorAt(idx, dark);
          }
          idx++;
        }
      }
      this.eq.instanceColor.needsUpdate = true;
    }

    // portal hue drift + light cones
    this.portal.material.color.setHSL(
      (cfg.portalHue + t * cfg.portalDrift + energy.bass * 0.05 * cfg.dim) % 1,
      0.85, (0.5 + energy.bass * 0.2) * cfg.dim);
    for (let i = 0; i < this.cones.length; i++) {
      const cone = this.cones[i];
      cone.material.uniforms.uTime.value = t;
      cone.material.uniforms.uColor.value.lerp(cfg.coneC[i], k);
      const strobeBoost = i === 3 ? this._strobe : 0;
      cone.material.uniforms.uOpacity.value =
        (playing ? 0.08 + energy.mid * 0.22 + pulse * 0.06 : 0.05) * (0.4 + cfg.dim * 0.6) + strobeBoost * 0.25;
      cone.rotation.z = Math.sin(t * (0.6 - this.phase * 0.08) + i * 1.7) * 0.4;
      this.spots[i].color.lerp(cfg.coneC[i], k);
      this.spots[i].intensity =
        ((playing ? 70 + energy.level * 320 : 40) * cfg.dim) + strobeBoost * 900;
    }

    // horror + SPRUNK MODE lifecycle
    this._checkHorror();
    this._checkSprunk();
    if (this.sprunk > 0) {
      this.sprunk -= dt;
      this.controls.autoRotateSpeed = 1.4;
      if (Math.random() < dt * 4) {
        this.bursts.spawn(new THREE.Vector3(rand(-7, 7), rand(5, 9), rand(-8, 0)),
          { count: 24, colors: [0xffd76e, 0xff4d6d, 0x7c6cff, 0x4dd8ff], speed: 3, gravity: -4 });
      }
      if (this.sprunk <= 0) this._endSprunk();
    }

    this.dust.update(dt, t);
    this.bursts.update(dt);
  }
}
