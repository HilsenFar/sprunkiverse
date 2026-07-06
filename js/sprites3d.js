// ============================================================
//  Original Sprunki sprites → 3D.
//  Loads the actual 2D vector costumes (Scratch, CC BY-SA 2.0,
//  characters by NyankoBfLol) and extrudes their exact shapes
//  into layered papercraft-style 3D meshes. Costume pairs give
//  the authentic Scratch flip-book animation; the anim??? set
//  is the real horror mode, swapped in at phase Ⅲ+.
// ============================================================
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { clamp, lerp } from './core/utils.js';

const svgLoader = new SVGLoader();
// scaled against the full Scratch canvas — characters fill ~70-85% of it,
// so this lands their visible height around the old 1.8
const TARGET_H = 2.3;

let manifest = null;
export async function loadSpriteManifest() {
  if (manifest !== null) return manifest;
  try {
    const r = await fetch('assets/sprunki/sprites.json');
    manifest = r.ok ? await r.json() : {};
  } catch {
    manifest = {};
  }
  return manifest;
}

const groupCache = new Map();   // url -> Promise<THREE.Group>

function parseColor(style, key, fallback) {
  const v = style[key];
  if (!v || v === 'none') return null;
  if (typeof v === 'string' && v.startsWith('url(')) return new THREE.Color(fallback);
  try { return new THREE.Color().setStyle(v); } catch { return new THREE.Color(fallback); }
}

/** Build an extruded 3D group from one costume SVG. */
function buildGroup(url) {
  if (groupCache.has(url)) return groupCache.get(url);
  const promise = (async () => {
    const text = await (await fetch(url)).text();
    const data = svgLoader.parse(text);

    // measure the drawing to scale depth/layer offsets sensibly
    const bb = new THREE.Box2();
    for (const path of data.paths) {
      for (const sub of path.subPaths) {
        for (const p of sub.getPoints()) bb.expandByPoint(p);
      }
    }
    const size = bb.getSize(new THREE.Vector2());
    const H = Math.max(size.y, 1);
    const depth = H * 0.14;
    const layerStep = H * 0.006;

    // some costumes carry a baked-in canvas-sized background rectangle —
    // extruding it puts a giant flat slab in front of the camera; skip those
    const totalArea = Math.max(size.x * size.y, 1);
    const isBackdrop = (path) => {
      let pts = 0;
      const pbb = new THREE.Box2();
      for (const sub of path.subPaths) {
        const p = sub.getPoints();
        pts += p.length;
        for (const q of p) pbb.expandByPoint(q);
      }
      const ps = pbb.getSize(new THREE.Vector2());
      return pts <= 14 && ps.x >= size.x * 0.92 && ps.y >= size.y * 0.92
        && ps.x * ps.y >= totalArea * 0.85;
    };

    const g = new THREE.Group();
    let layer = 0;
    for (const path of data.paths) {
      if (isBackdrop(path)) { layer++; continue; }
      const style = path.userData.style ?? {};
      const fill = parseColor(style, 'fill', '#888888');
      if (fill) {
        const opacity = (style.fillOpacity ?? 1) * (style.opacity ?? 1);
        // Scratch touch-rects & other near-invisible fills: don't extrude them —
        // they'd cast opaque shadows and inflate the tap hitbox
        if (opacity < 0.05) { layer++; continue; }
        // bright fills get almost no self-glow so white characters don't bloom out
        const lum = 0.299 * fill.r + 0.587 * fill.g + 0.114 * fill.b;
        const em = 0.14 * (1 - lum * 0.85);
        const mat = new THREE.MeshPhysicalMaterial({
          color: fill, roughness: 0.6, metalness: 0,
          clearcoat: 0.3, clearcoatRoughness: 0.55,
          emissive: fill, emissiveIntensity: em,
          side: THREE.DoubleSide,
          transparent: opacity < 1, opacity,
        });
        mat.userData.baseColor = fill.clone();
        mat.userData.baseEmissive = em;
        for (const shape of SVGLoader.createShapes(path)) {
          try {
            const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 7 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.z = layer * layerStep;
            mesh.castShadow = true;
            g.add(mesh);
          } catch { /* skip malformed sub-shape */ }
        }
        layer++;
      }
      const stroke = parseColor(style, 'stroke', '#000000');
      if (stroke && (style.strokeWidth ?? 0) > 0) {
        const mat = new THREE.MeshBasicMaterial({ color: stroke, side: THREE.DoubleSide });
        mat.userData.baseColor = stroke.clone();
        for (const sub of path.subPaths) {
          const geo = SVGLoader.pointsToStroke(sub.getPoints(), style);
          if (!geo) continue;
          const front = new THREE.Mesh(geo, mat);
          front.position.z = depth + layer * layerStep + H * 0.002;
          const back = new THREE.Mesh(geo, mat);
          back.position.z = -H * 0.002;
          g.add(front, back);
        }
        layer++;
      }
    }
    if (!g.children.length) throw new Error('empty svg');

    // normalise using the FULL drawing bounds (incl. the invisible Scratch
    // canvas rect present in nearly every costume) — every frame of a
    // character then shares one scale, so flip-book swaps never pop in size
    const s = TARGET_H / Math.max(size.y, 0.001);
    const wrap = new THREE.Group();
    wrap.add(g);
    g.scale.set(s, -s, s);   // flip SVG y-down
    g.position.set(
      -s * (bb.min.x + bb.max.x) / 2,   // centre x
      s * bb.max.y,                     // canvas bottom → feet at y=0
      -s * (depth / 2));                // centre the extrusion depth
    return wrap;
  })();
  // a failed load (e.g. a flaky connection) must not pin the rejection —
  // drop it so the next request retries
  promise.catch(() => groupCache.delete(url));
  groupCache.set(url, promise);
  return promise;
}

/**
 * Rig-compatible wrapper around the original 2D costumes.
 * API matches createSprunki: { group, spec, update, setTint } + setPhaseLook.
 */
export async function createSpriteRig(spec, files, { keys = null } = {}) {
  // keys lets non-Studio modes load only the costumes they need
  const wanted = keys
    ? Object.fromEntries(Object.entries(files).filter(([k]) => keys.includes(k)))
    : files;
  const urls = [...new Set(Object.values(wanted).filter(Boolean))];
  const templates = new Map();
  await Promise.all(urls.map(async (u) => templates.set(u, await buildGroup(u))));

  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);

  // clone per rig (several villagers can be the same character);
  // geometry stays shared, materials are cloned so tints are per-rig
  const clones = new Map();
  for (const [url, template] of templates) {
    const matMap = new Map();
    const clone = template.clone(true);
    clone.traverse((o) => {
      if (!o.isMesh) return;
      if (!matMap.has(o.material)) {
        const nm = o.material.clone();
        nm.userData.baseColor = o.material.userData.baseColor?.clone();
        nm.userData.baseEmissive = o.material.userData.baseEmissive;
        matMap.set(o.material, nm);
      }
      o.material = matMap.get(o.material);
    });
    clone.visible = false;
    clones.set(url, clone);
    inner.add(clone);
  }
  const variant = (key) => (wanted[key] ? clones.get(wanted[key]) : null);

  const mats = [];
  inner.traverse((o) => { if (o.isMesh && !mats.includes(o.material)) mats.push(o.material); });

  const rig = {
    group: root, spec, inner, mats, isSprite: true,
    _t: Math.random() * 10, _frame: 0, _fc: -1,
    _mode: 'idle', _phaseLook: 1,
    tint: 'normal',
    height: TARGET_H,
  };

  rig._apply = () => {
    const horror = rig._phaseLook >= 3 && variant('horror');
    const pair = horror
      ? [variant('horror'), variant('horror2') ?? variant('horror')]
      : rig._mode === 'perform'
        ? [variant('anim') ?? variant('idle'), variant('anim2') ?? variant('idle2') ?? variant('idle')]
        : [variant('idle'), variant('idle2') ?? variant('idle')];
    const cur = pair[rig._frame % 2] ?? pair[0];
    for (const grp of clones.values()) grp.visible = (grp === cur);
  };

  rig.setPhaseLook = (p) => {
    rig._phaseLook = p;
    rig._apply();
  };

  rig.setTint = (mode) => {
    if (rig.tint === mode) return;
    rig.tint = mode;
    const mix = {
      muted: [new THREE.Color(0x555a66), 0.7],
      dusk: [new THREE.Color(0x1c1830), 0.35],
      corrupt: [new THREE.Color(0x140508), 0.3],   // horror costume does most of the work
      void: [new THREE.Color(0x030304), 0.6],
      sick: [new THREE.Color(0x3fae4a), 0.5],
      gold: [new THREE.Color(0xffd76e), 0.5],
    }[mode];
    for (const m of mats) {
      if (!m.userData.baseColor) continue;
      m.color.copy(m.userData.baseColor);
      if (mix) m.color.lerp(mix[0], mix[1]);
      if (m.emissive) {
        m.emissive.copy(m.color);
        m.emissiveIntensity = mode === 'muted' ? 0.04 : (m.userData.baseEmissive ?? 0.12);
      }
    }
    rig._apply();
  };

  rig.update = (dt, state = {}) => {
    const { anim = 'idle', beat = 0, speed = 0 } = state;
    rig._t += dt;
    const t = rig._t;
    const playing = anim === 'dance' || anim === 'sing';
    // face follows the character's OWN sound; beat-pulse fallback when
    // no per-channel level is available (world stage, ambience)
    const lv = state.level ?? (playing ? Math.pow(1 - (beat % 1), 2) * 0.7 : 0);
    const perform = (playing && lv > 0.05) || anim === 'talk';
    rig._mode = perform ? 'perform' : 'idle';

    // flip-book cadence per activity
    const rising = lv > 0.18 && (rig._lastLv ?? 0) <= 0.18;
    rig._lastLv = lv;
    let frameClock;
    if (anim === 'talk') frameClock = Math.floor(t * 4);
    else if (perform) frameClock = Math.floor(beat * 2);
    else if (anim === 'walk') frameClock = Math.floor((rig._walk ?? 0) / Math.PI);
    else frameClock = Math.floor(t * 1.7);
    if (rising || frameClock !== rig._fc) {
      rig._fc = frameClock;
      rig._frame++;
      rig._apply();
    }

    // paper-doll body language
    let bob = 0, squash = 1, sway = 0, lean = 0;
    switch (anim) {
      case 'walk': {
        rig._walk = (rig._walk ?? 0) + dt * (3 + speed * 0.9);
        const w = rig._walk * Math.PI;
        sway = Math.sin(w) * 0.13;                       // the waddle
        bob = Math.abs(Math.sin(w)) * 0.06;
        lean = 0.09;
        break;
      }
      case 'work': lean = 0.3; bob = Math.abs(Math.sin(t * 5)) * 0.04; break;
      case 'sleep': sway = 0.42; squash = 0.95; bob = Math.sin(t * 1.1) * 0.01; break;
      case 'panic': sway = Math.sin(t * 16) * 0.12; bob = Math.abs(Math.sin(t * 10)) * 0.05; break;
      case 'greet': sway = Math.sin(t * 7) * 0.1; bob = 0.03; break;
      case 'talk': bob = Math.abs(Math.sin(t * 6)) * 0.015; break;
      case 'dance': case 'sing':
        bob = lv * 0.14;
        squash = 1 + lv * 0.08;
        sway = Math.sin(beat * Math.PI) * 0.05;
        break;
      default:
        bob = Math.sin(t * 1.6) * 0.02;
        if (rig.tint === 'muted') squash = 0.97;
    }
    const k = clamp(dt * 10, 0, 1);
    inner.position.y = lerp(inner.position.y, bob, k);
    inner.scale.y = lerp(inner.scale.y, squash, k);
    inner.scale.x = inner.scale.z = lerp(inner.scale.x, 1 / Math.sqrt(inner.scale.y), k);
    inner.rotation.z = lerp(inner.rotation.z, sway, k);
    inner.rotation.x = lerp(inner.rotation.x, lean, k);

    // paper cutouts always show their face — y-billboard toward the camera,
    // compensating whatever heading the mode gave the root group
    if (rig.cameraRef) {
      const cp = rig.cameraRef.position;
      const yaw = Math.atan2(cp.x - root.position.x, cp.z - root.position.z);
      let target = yaw - root.rotation.y;
      while (target > Math.PI) target -= Math.PI * 2;
      while (target < -Math.PI) target += Math.PI * 2;
      inner.rotation.y = lerp(inner.rotation.y, target, clamp(dt * 8, 0, 1));
    }
  };

  rig._apply();
  return rig;
}
