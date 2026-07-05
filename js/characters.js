// ============================================================
//  Procedural Sprunki factory — the classic cast interpreted
//  in 3D: bodies, faces, signature heads & accessories, a full
//  procedural animation rig, and portrait rendering.
// ============================================================
import * as THREE from 'three';
import { clamp, lerp } from './core/utils.js';

// ---------------- the cast ----------------
// The 10 world NPCs keep their internal loop ids (thump, chime, …)
// but ARE the Sprunki characters — names, looks, personalities.

export const CHARACTERS = [
  { id: 'thump', name: 'OREN', cat: 'beat', color: 0xff7a1a, accent: 0xffd9b0, head: 'trafficcone', acc: 'none', dance: 'headbang',
    agenda: 'The beat. There is nothing else. Only the beat.',
    lines: ['Bmm-tss. Bmm-tss. You feel that?', 'I was BORN a beat. The cone? Cosmetic.', 'The ground should shake. Always.'] },
  { id: 'snapp', name: 'RADDY', cat: 'beat', color: 0xe8262b, accent: 0xff9daa, head: 'dome', acc: 'antennae', dance: 'clap',
    agenda: 'Knows everyone. Claps about it.',
    lines: ['Did you hear about Durple and the battle? EVERYONE has.', 'Clap on 2 and 4. Rule one of life.', 'I saw Black by the water at midnight. Spooky!'] },
  { id: 'tika', name: 'CLUKR', cat: 'beat', color: 0xc9ced6, accent: 0x8fd4ff, head: 'tube', acc: 'visor', dance: 'jitter',
    agenda: 'Runs on hi-hats and three batteries.',
    lines: ['tk-tk-tk-tk. Sorry. Firmware.', 'My head is a can. My heart is a shaker.', 'I never sleep. I quantize.'] },
  { id: 'boom', name: 'BRUD', cat: 'melody', color: 0x7a4e2c, accent: 0xd9a066, head: 'block', acc: 'none', dance: 'slowsway',
    agenda: 'Naps by the bench. Dreams in sub frequencies.',
    lines: ['...low end... is a lifestyle...', '...shhh... the bass is sleeping...', '...you walk loud. respect the sub...'] },
  { id: 'wobb', name: 'GARNOLD', cat: 'effect', color: 0xd9a520, accent: 0xffe28a, head: 'wide', acc: 'spikes', dance: 'wobble',
    agenda: 'Rugged gold. Slightly unstable filters.',
    lines: ['WUB. Wub-wub. You understand my research?', 'One day the whole island will WOBBLE!', 'Gold does not rust. It RESONATES.'] },
  { id: 'chime', name: 'SKY', cat: 'melody', color: 0x69b7e8, accent: 0xd6f0ff, head: 'dome', acc: 'none', dance: 'wave', bigSmile: true,
    agenda: 'Writes tiny melodies for everyone she meets.',
    lines: ['I wrote you a melody! It goes: ding ding di-ding!', 'Every Sprunki has a song inside. Even Brud!', 'Smile! Music works better when you smile!'] },
  { id: 'nova', name: 'DURPLE', cat: 'melody', color: 0x5a2d8a, accent: 0xc9a0ff, head: 'pointy', acc: 'none', dance: 'diva',
    agenda: 'Undefeated in beat battles. Wants a challenger.',
    lines: ['You? Battle ME? Adorable. Let\'s go.', 'Tall head. Taller talent.', 'Nobody has out-played me. Nobody.'] },
  { id: 'drift', name: 'MR. TREE', cat: 'melody', color: 0x6a4a2a, accent: 0x4a9a3a, head: 'treecrown', acc: 'none', dance: 'sway',
    agenda: 'Is a tree. Grows crops in chords.',
    lines: ['I am a tree. This surprises people.', 'Crops grow better with pad chords. Proven fact.', 'The field hums in A minor today.'] },
  { id: 'voxo', name: 'WENDA', cat: 'voice', color: 0xf0f0f4, accent: 0xffd9e8, head: 'tall', acc: 'halo', dance: 'sing',
    agenda: 'Dreams of a solo career. Practices at the stage.',
    lines: ['Ahhh~ ohhh~ did you hear that vibrato?', 'One day: WENDA — LIVE AT THE PLAZA. Sold out!', 'My voice is an instrument. The best one.'] },
  { id: 'echo', name: 'BLACK', cat: 'effect', color: 0x0a0a0e, accent: 0xf2f2ff, head: 'dome', acc: 'horns', dance: 'float', eyes: 'glow',
    agenda: 'Appears at dusk. Do not put them on stage. Or do.',
    lines: ['...hello... hello... hello...', '...the night remembers every song...', '...put me on the stage... see what happens...'] },
];

// Studio-only cast members — complete the 20-sound Sprunki lineup.
export const CHARACTERS_EXTRA = [
  { id: 'funbot', name: 'FUN BOT', cat: 'beat', color: 0x9aa2b0, accent: 0x4dffd8, head: 'screen', acc: 'antenna', dance: 'jitter' },
  { id: 'tunner', name: 'TUNNER', cat: 'beat', color: 0x6a7a8a, accent: 0xff6a4d, head: 'tube', acc: 'none', dance: 'slowsway' },
  { id: 'owakcx', name: 'OWAKCX', cat: 'effect', color: 0xb7e84d, accent: 0x2a2a30, head: 'dome', acc: 'catears', dance: 'jitter', eyes: 'glow' },
  { id: 'jevin', name: 'JEVIN', cat: 'effect', color: 0x3a4a6a, accent: 0x8fb4ff, head: 'cone', acc: 'none', dance: 'wobble' },
  { id: 'sun', name: 'MR. SUN', cat: 'effect', color: 0xffd94d, accent: 0xffb02e, head: 'sunhead', acc: 'none', dance: 'diva' },
  { id: 'simon', name: 'SIMON', cat: 'melody', color: 0xf2d24b, accent: 0xfff0b0, head: 'cube', acc: 'antenna', dance: 'wave' },
  { id: 'vineria', name: 'VINERIA', cat: 'voice', color: 0x63b45a, accent: 0xc9f0b8, head: 'dome', acc: 'longhair', dance: 'sing' },
  { id: 'gray', name: 'GRAY', cat: 'voice', color: 0x8a8a92, accent: 0xc9c9d4, head: 'tall', acc: 'none', dance: 'slowsway' },
  { id: 'mara', name: 'PINKI', cat: 'voice', color: 0xe86aa0, accent: 0xffc9e0, head: 'dome', acc: 'ponytail', dance: 'clap' },
  { id: 'lime', name: 'MR. FUN', cat: 'voice', color: 0xd8d2c4, accent: 0x4dffd8, head: 'screen', acc: 'none', dance: 'jitter' },
];

export const JASON_SPEC = {
  id: 'jason', name: 'JASON', cat: 'hero', color: 0xdde2f2, accent: 0xffd76e,
  head: 'dome', acc: 'headphones', dance: 'diva',
};

export const CHAR_BY_ID = Object.fromEntries(
  [...CHARACTERS, ...CHARACTERS_EXTRA, JASON_SPEC].map((c) => [c.id, c]));

// Studio row order — Incredibox style: beats · effects · melodies · voices
export const STUDIO_CAST = [
  'thump', 'snapp', 'tika', 'funbot', 'tunner',        // BEATS
  'wobb', 'echo', 'owakcx', 'jevin', 'sun',            // EFFECTS
  'chime', 'nova', 'drift', 'boom', 'simon',           // MELODIES
  'voxo', 'vineria', 'gray', 'mara', 'lime',           // VOICES
].map((id) => CHAR_BY_ID[id]);

// ---------------- generated performers for custom loop kits ----------------

const CAT_COLORS = {
  beat: [0xe23b3b, 0xff8c42, 0xffd166],
  bass: [0x7b4dff, 0xc44dff],
  effect: [0xcfd6e4, 0x8fb4ff],
  melody: [0x4dd8ff, 0x4ddf91, 0x4d7dff],
  voice: [0xff6fa5, 0xffb1c9],
  fx: [0xcfd6e4, 0xb8ffe0],
};
const GEN_HEADS = ['dome', 'cube', 'cone', 'tall', 'wide', 'bulb'];
const GEN_ACCS = ['headphones', 'antenna', 'mohawk', 'horns', 'visor', 'halo', 'spikes', 'none'];
const GEN_DANCES = ['headbang', 'clap', 'jitter', 'wobble', 'wave', 'diva', 'sing', 'slowsway'];

/** Deterministic character spec for a custom kit loop. */
export function makeCustomSpec(id, name, cat, i) {
  const palette = CAT_COLORS[cat] ?? CAT_COLORS.fx;
  const color = palette[i % palette.length];
  const accent = new THREE.Color(color).offsetHSL(0.09, 0.05, 0.22).getHex();
  const seed = i * 7 + name.length;
  return {
    id, name, cat, color, accent,
    head: GEN_HEADS[seed % GEN_HEADS.length],
    acc: GEN_ACCS[(seed * 3 + i) % GEN_ACCS.length],
    dance: GEN_DANCES[(seed * 5 + i * 2) % GEN_DANCES.length],
  };
}

// ---------------- shared geometries ----------------

const G = {
  body: new THREE.CapsuleGeometry(0.32, 0.52, 6, 16),
  headDome: new THREE.SphereGeometry(0.42, 24, 18),
  headCube: new THREE.BoxGeometry(0.66, 0.6, 0.62),
  headCone: new THREE.ConeGeometry(0.42, 0.72, 20),
  headTall: new THREE.CapsuleGeometry(0.3, 0.42, 6, 16),
  headBulb: new THREE.SphereGeometry(0.4, 24, 18),
  trafficCone: new THREE.ConeGeometry(0.46, 0.92, 20),
  coneBand: new THREE.TorusGeometry(0.3, 0.05, 8, 22),
  screenBox: new THREE.BoxGeometry(0.72, 0.58, 0.5),
  screenFace: new THREE.BoxGeometry(0.56, 0.4, 0.05),
  pixel: new THREE.BoxGeometry(0.09, 0.12, 0.04),
  tubeHead: new THREE.CylinderGeometry(0.34, 0.34, 0.78, 18),
  pointy: new THREE.ConeGeometry(0.42, 1.05, 20),
  block: new THREE.BoxGeometry(0.74, 0.66, 0.66),
  crownBall: new THREE.SphereGeometry(0.32, 12, 10),
  ray: new THREE.ConeGeometry(0.09, 0.32, 6),
  arm: new THREE.CapsuleGeometry(0.09, 0.36, 4, 10),
  leg: new THREE.CapsuleGeometry(0.11, 0.22, 4, 10),
  eye: new THREE.SphereGeometry(0.085, 12, 10),
  pupil: new THREE.SphereGeometry(0.042, 10, 8),
  mouth: new THREE.SphereGeometry(0.09, 12, 8),
  torus: new THREE.TorusGeometry(0.44, 0.055, 10, 24),
  earcup: new THREE.SphereGeometry(0.13, 12, 10),
  antenna: new THREE.CylinderGeometry(0.02, 0.02, 0.42, 6),
  tip: new THREE.SphereGeometry(0.07, 10, 8),
  spike: new THREE.ConeGeometry(0.07, 0.22, 8),
  visor: new THREE.BoxGeometry(0.56, 0.14, 0.1),
  halo: new THREE.TorusGeometry(0.3, 0.035, 8, 24),
  ponytail: new THREE.CapsuleGeometry(0.11, 0.5, 4, 8),
  hair: new THREE.CapsuleGeometry(0.09, 0.6, 4, 8),
  earCone: new THREE.ConeGeometry(0.15, 0.3, 8),
  fin: new THREE.ConeGeometry(0.3, 0.7, 4),
  sideFin: new THREE.ConeGeometry(0.14, 0.4, 4),
};

function bodyMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.38, metalness: 0.0,
    clearcoat: 0.85, clearcoatRoughness: 0.3,
  });
}
function accentMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 2.2, roughness: 0.4,
  });
}

// ---------------- rig ----------------

export function createSprunki(spec, { scale = 1 } = {}) {
  const mats = {
    body: bodyMaterial(spec.color),
    accent: accentMaterial(spec.accent),
    white: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }),
    eye: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.25 }),
    pupil: new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1420, roughness: 0.6 }),
  };
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);

  const legH = 0.36;
  const M = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
  };

  // legs (pivot at hip)
  const mkLeg = (side) => {
    const piv = new THREE.Group();
    piv.position.set(0.15 * side, legH, 0);
    const leg = M(G.leg, mats.body);
    leg.position.y = -0.2;
    piv.add(leg);
    inner.add(piv);
    return piv;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  // body
  const body = M(G.body, mats.body);
  body.position.y = legH + 0.55;
  inner.add(body);

  // arms (pivot at shoulder)
  const mkArm = (side) => {
    const piv = new THREE.Group();
    piv.position.set(0.36 * side, legH + 0.78, 0);
    const arm = M(G.arm, mats.body);
    arm.position.y = -0.24;
    piv.add(arm);
    piv.rotation.z = side * 0.22;
    inner.add(piv);
    return piv;
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // ---------------- head ----------------
  const headGrp = new THREE.Group();
  headGrp.position.y = legH + 1.28;
  inner.add(headGrp);

  switch (spec.head) {
    case 'trafficcone': {
      const head = M(G.trafficCone, mats.body);
      head.position.y = 0.14;
      headGrp.add(head);
      const band = M(G.coneBand, mats.white);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.18;
      band.scale.setScalar(0.98);
      headGrp.add(band);
      break;
    }
    case 'screen': {
      const head = M(G.screenBox, mats.dark);
      headGrp.add(head);
      const face = M(G.screenFace, mats.accent);
      face.position.z = 0.26;
      headGrp.add(face);
      for (const side of [-1, 1]) {
        const px = M(G.pixel, mats.dark);
        px.position.set(0.13 * side, 0.05, 0.3);
        headGrp.add(px);
      }
      break;
    }
    case 'tube': {
      const head = M(G.tubeHead, mats.body);
      headGrp.add(head);
      break;
    }
    case 'pointy': {
      const head = M(G.pointy, mats.body);
      head.position.y = 0.22;
      headGrp.add(head);
      break;
    }
    case 'block': {
      const head = M(G.block, mats.body);
      headGrp.add(head);
      break;
    }
    case 'sunhead': {
      const head = M(G.headDome, mats.body);
      headGrp.add(head);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const ray = M(G.ray, mats.accent);
        ray.position.set(Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0);
        ray.rotation.z = a - Math.PI / 2;
        headGrp.add(ray);
      }
      break;
    }
    case 'treecrown': {
      const crownMat = new THREE.MeshStandardMaterial({ color: spec.accent, roughness: 0.8 });
      const trunk = M(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 10), mats.body);
      trunk.position.y = -0.05;
      headGrp.add(trunk);
      for (const [x, y, z, s] of [[0, 0.42, 0, 1.2], [-0.28, 0.28, 0.06, 0.85], [0.28, 0.3, -0.04, 0.9], [0, 0.34, -0.26, 0.8]]) {
        const ball = M(G.crownBall, crownMat);
        ball.position.set(x, y, z);
        ball.scale.setScalar(s);
        headGrp.add(ball);
      }
      break;
    }
    default: {
      const HEAD_GEO = { dome: G.headDome, cube: G.headCube, cone: G.headCone, tall: G.headTall, wide: G.headDome, bulb: G.headBulb };
      const head = M(HEAD_GEO[spec.head] ?? G.headDome, mats.body);
      if (spec.head === 'dome') head.scale.set(1, 0.9, 1);
      if (spec.head === 'wide') head.scale.set(1.25, 0.8, 1);
      if (spec.head === 'bulb') head.scale.set(1, 1.12, 1);
      if (spec.head === 'cone') head.position.y = 0.1;
      headGrp.add(head);
    }
  }

  // ---------------- face (faces +Z) ----------------
  const face = new THREE.Group();
  headGrp.add(face);
  const glowEyes = spec.eyes === 'glow';
  const baseEyeInt = glowEyes ? 2.4 : 0.35;
  mats.eye.emissiveIntensity = baseEyeInt;

  const eyeL = M(G.eye, mats.eye), eyeR = M(G.eye, mats.eye);
  const cyclops = spec.head === 'bulb';
  const eyeZ = spec.head === 'screen' ? 0.34 : spec.head === 'tube' ? 0.32 : 0.34;
  if (cyclops) {
    eyeL.position.set(0, 0.08, 0.36);
    eyeL.scale.setScalar(1.5);
    face.add(eyeL);
  } else if (spec.head !== 'screen') {
    eyeL.position.set(-0.15, 0.05, eyeZ);
    eyeR.position.set(0.15, 0.05, eyeZ);
    if (glowEyes) { eyeL.scale.setScalar(1.25); eyeR.scale.setScalar(1.25); }
    face.add(eyeL, eyeR);
  }
  const pupils = [];
  const addPupil = (eye, s = 1) => {
    const p = M(G.pupil, mats.pupil);
    const ps = s * (glowEyes ? 0.15 : 1);
    p.position.set(0, 0.01, 0.075 * s);
    p.scale.setScalar(ps);
    p.userData.baseScale = ps;
    eye.add(p);
    pupils.push(p);
  };
  if (spec.head !== 'screen') {
    addPupil(eyeL, cyclops ? 1.4 : 1);
    if (!cyclops) addPupil(eyeR);
  }

  const mouth = M(G.mouth, mats.dark);
  const mouthBaseX = spec.bigSmile ? 1.9 : 1;
  const mouthBaseY = spec.bigSmile ? 0.85 : 0.55;
  mouth.position.set(0, spec.bigSmile ? -0.13 : -0.16, 0.36);
  mouth.scale.set(mouthBaseX, mouthBaseY, 0.5);
  if (spec.head === 'screen') mouth.visible = false;
  face.add(mouth);

  // ---------------- accessory ----------------
  const A = (geo, mat) => { const m = M(geo, mat); headGrp.add(m); return m; };
  switch (spec.acc) {
    case 'headphones': {
      const band = A(G.torus, mats.dark);
      band.rotation.z = Math.PI / 2; band.scale.setScalar(0.95);
      const cL = A(G.earcup, mats.accent); cL.position.set(-0.42, 0, 0);
      const cR = A(G.earcup, mats.accent); cR.position.set(0.42, 0, 0);
      break;
    }
    case 'antenna': {
      const st = A(G.antenna, mats.dark); st.position.y = 0.55;
      const tip = A(G.tip, mats.accent); tip.position.y = 0.78;
      break;
    }
    case 'antennae': {
      for (const side of [-1, 1]) {
        const st = A(G.antenna, mats.dark);
        st.position.set(0.16 * side, 0.5, 0);
        st.rotation.z = -side * 0.25;
        const tip = A(G.tip, mats.accent);
        tip.position.set(0.22 * side, 0.72, 0);
      }
      break;
    }
    case 'mohawk': {
      for (let i = 0; i < 4; i++) {
        const s = A(G.spike, mats.accent);
        s.position.set(0, 0.42 - Math.abs(i - 1.5) * 0.05, 0.22 - i * 0.15);
        s.rotation.x = (i - 1.5) * -0.35;
        s.scale.setScalar(1.4 - Math.abs(i - 1.5) * 0.2);
      }
      break;
    }
    case 'horns': {
      for (const side of [-1, 1]) {
        const h = A(G.spike, mats.accent);
        h.position.set(0.26 * side, 0.34, 0);
        h.rotation.z = -side * 0.6;
        h.scale.setScalar(1.3);
      }
      break;
    }
    case 'visor': {
      const v = A(G.visor, mats.accent);
      v.position.set(0, 0.05, 0.33);
      break;
    }
    case 'halo': {
      const h = A(G.halo, mats.accent);
      h.position.y = 0.62;
      h.rotation.x = Math.PI / 2;
      break;
    }
    case 'spikes': {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const s = A(G.spike, mats.accent);
        s.position.set(Math.cos(a) * 0.3, 0.35, Math.sin(a) * 0.3);
        s.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
      }
      break;
    }
    case 'ponytail': {
      const p = A(G.ponytail, mats.accent);
      p.position.set(0, 0.28, -0.38);
      p.rotation.x = 0.85;
      break;
    }
    case 'longhair': {
      for (const [x, z, rz] of [[-0.34, 0, 0.15], [0.34, 0, -0.15], [0, -0.32, 0]]) {
        const h = A(G.hair, mats.accent);
        h.position.set(x, -0.05, z);
        h.rotation.z = rz;
      }
      break;
    }
    case 'catears': {
      for (const side of [-1, 1]) {
        const ear = A(G.earCone, mats.body);
        ear.position.set(0.24 * side, 0.42, 0);
        ear.rotation.z = -side * 0.25;
      }
      break;
    }
  }

  root.scale.setScalar(scale);

  // ------------- animation state -------------
  const rig = {
    group: root, spec, inner, headGrp, face, mouth, pupils,
    armL, armR, legL, legR,
    mats,
    _t: Math.random() * 10,
    _walkPhase: Math.random() * 10,
    _blink: Math.random() * 4,
    height: 1.8 * scale,
    tint: 'normal',
  };

  rig.setTint = (mode) => {
    if (rig.tint === mode) return;
    rig.tint = mode;
    const base = new THREE.Color(spec.color);
    const accent = new THREE.Color(spec.accent);
    const eyes = (color, emissive, intensity, pupilScale = 1, pupilColor = 0x101018) => {
      mats.eye.color.set(color);
      mats.eye.emissive.set(emissive);
      mats.eye.emissiveIntensity = intensity;
      mats.pupil.color.set(pupilColor);
      for (const p of pupils) p.scale.setScalar(p.userData.baseScale * pupilScale);
    };
    if (mode === 'muted') {
      mats.body.color.copy(base).lerp(new THREE.Color(0x555a66), 0.75);
      mats.accent.emissiveIntensity = 0.1;
    } else if (mode === 'sick') {
      mats.body.color.copy(base).lerp(new THREE.Color(0x3fae4a), 0.65);
      mats.accent.emissiveIntensity = 0.4;
    } else if (mode === 'gold') {
      mats.body.color.set(0xffd76e);
      mats.accent.emissiveIntensity = 3.5;
    } else if (mode === 'dusk') {
      // phase II — the joy drains out
      mats.body.color.copy(base).lerp(new THREE.Color(0x1c1830), 0.45);
      mats.accent.color.copy(accent).lerp(new THREE.Color(0x6a5aa8), 0.4);
      mats.accent.emissive.copy(mats.accent.color);
      mats.accent.emissiveIntensity = 1.3;
      eyes(0xd8d8e8, 0xd8d8e8, Math.max(0.25, baseEyeInt * 0.5), 0.85);
    } else if (mode === 'corrupt') {
      // phase III — something is wrong with them
      mats.body.color.copy(base).lerp(new THREE.Color(0x0a0508), 0.78);
      mats.accent.color.set(0xff2a2a);
      mats.accent.emissive.set(0xff2a2a);
      mats.accent.emissiveIntensity = 2.4;
      eyes(0x140505, 0xff2222, 2.6, 0.7, 0x2a0505);
    } else if (mode === 'void') {
      // phase IV — hollow silhouettes with burning white eyes
      mats.body.color.set(0x050507);
      mats.accent.color.set(0x9fb4ff);
      mats.accent.emissive.set(0x9fb4ff);
      mats.accent.emissiveIntensity = 0.6;
      eyes(0xffffff, 0xffffff, 3.5, 0.3, 0xffffff);
    } else {
      mats.body.color.copy(base);
      mats.accent.color.copy(accent);
      mats.accent.emissive.copy(accent);
      mats.accent.emissiveIntensity = 2.2;
      eyes(0xffffff, 0xffffff, baseEyeInt, 1);
    }
  };

  /**
   * state: { anim, beat, speed, energy }
   * anim: idle | walk | dance | sing | work | sleep | panic | greet | talk
   */
  rig.update = (dt, state = {}) => {
    const { anim = 'idle', beat = 0, speed = 0, energy = 0.5, level } = state;
    rig._t += dt;
    const t = rig._t;

    // blink
    rig._blink -= dt;
    if (rig._blink < 0) rig._blink = 2.4 + Math.random() * 3;
    const blink = rig._blink < 0.12 ? 0.1 : 1;
    for (const p of pupils) p.scale.y = blink * (p.scale.x);

    // defaults each frame (poses lerp toward targets)
    let bobY = 0, squash = 1, headNod = 0, headTilt = 0, headYaw = 0;
    let armLx = 0, armRx = 0, armLz = -0.22, armRz = 0.22;
    let legLx = 0, legRx = 0, leanX = 0;
    let mouthScale = 1;

    const beatPh = beat % 1;
    const beatPulse = Math.pow(1 - beatPh, 2);           // 1 at beat, decays

    switch (anim) {
      case 'walk': {
        rig._walkPhase += dt * (4.5 + speed * 1.4);
        const w = rig._walkPhase;
        legLx = Math.sin(w) * 0.75;
        legRx = -Math.sin(w) * 0.75;
        armLx = -Math.sin(w) * 0.55;
        armRx = Math.sin(w) * 0.55;
        bobY = Math.abs(Math.sin(w)) * 0.05;
        leanX = 0.08;
        break;
      }
      case 'dance': {
        const style = spec.dance;
        const b2 = beat * Math.PI;
        bobY = beatPulse * 0.16 * (0.5 + energy);
        squash = 1 + beatPulse * 0.1;
        if (style === 'headbang') { headNod = Math.sin(b2 * 2) * 0.5; armLz = -1.6; armRz = 1.6; }
        else if (style === 'clap') { armLz = -0.5 - beatPulse * 1.1; armRz = 0.5 + beatPulse * 1.1; armLx = armRx = -0.9; }
        else if (style === 'jitter') { headTilt = Math.sin(t * 14) * 0.12; bobY += Math.abs(Math.sin(t * 12)) * 0.03; armLz = -0.8; armRz = 0.9; }
        else if (style === 'slowsway') { headTilt = Math.sin(b2 * 0.5) * 0.25; leanX = Math.sin(b2 * 0.5) * 0.1; }
        else if (style === 'wobble') { headYaw = Math.sin(b2) * 0.4; leanX = Math.sin(b2 * 2) * 0.12; armLz = -1.2 + Math.sin(b2 * 2) * 0.4; armRz = 1.2 + Math.sin(b2 * 2) * 0.4; }
        else if (style === 'wave') { armLx = Math.sin(b2) * 0.9 - 0.4; armRx = Math.sin(b2 + Math.PI) * 0.9 - 0.4; headTilt = Math.sin(b2 * 0.5) * 0.15; }
        else if (style === 'diva') { bobY = beatPulse * 0.22; armLz = -2.4; armRz = 2.4; headNod = beatPulse * 0.2; }
        else if (style === 'sing') { armLz = -2.1; armRz = 2.1; mouthScale = 1.6 + Math.sin(b2 * 2) * 0.5; headNod = -0.12; }
        else if (style === 'float') { bobY = 0.1 + Math.sin(t * 1.8) * 0.08; headYaw = Math.sin(t * 0.9) * 0.3; armLz = -0.9; armRz = 0.9; }
        else { headNod = Math.sin(b2) * 0.2; }
        // face sync: the mouth opens with the character's OWN sound
        if (level !== undefined) {
          mouthScale = Math.max(mouthScale, 1 + level * 1.4);
          bobY *= 0.45 + level * 0.9;
        }
        break;
      }
      case 'sing': {
        mouthScale = 1.5 + Math.sin(beat * Math.PI * 2) * 0.45;
        armLz = -1.9; armRz = 1.9;
        bobY = beatPulse * 0.07;
        headNod = -0.1;
        break;
      }
      case 'work': {
        leanX = 0.35;
        armRx = -0.6 + Math.sin(t * 5) * 0.7;
        armLx = -0.2;
        bobY = Math.abs(Math.sin(t * 5)) * 0.02;
        break;
      }
      case 'sleep': {
        leanX = 0.5;
        headNod = 0.55;
        squash = 0.96;
        mouthScale = 0.7 + Math.sin(t * 1.2) * 0.15;
        break;
      }
      case 'panic': {
        armLz = -2.6 + Math.sin(t * 20) * 0.3;
        armRz = 2.6 - Math.sin(t * 20 + 1) * 0.3;
        headTilt = Math.sin(t * 16) * 0.2;
        bobY = Math.abs(Math.sin(t * 10)) * 0.06;
        break;
      }
      case 'greet': {
        armRz = 2.6 + Math.sin(t * 7) * 0.35;
        headTilt = 0.12;
        break;
      }
      case 'talk': {
        mouthScale = 1.1 + Math.abs(Math.sin(t * 9)) * 0.5;
        headNod = Math.sin(t * 3) * 0.05;
        armLz = -0.4; armRz = 0.5;
        break;
      }
      default: { // idle
        bobY = Math.sin(t * 1.7) * 0.02;
        headYaw = Math.sin(t * 0.5) * 0.12;
        armLx = Math.sin(t * 1.7) * 0.05;
        armRx = -Math.sin(t * 1.7) * 0.05;
      }
    }

    // breathing on top of everything
    squash *= 1 + Math.sin(t * 2.1) * 0.012;

    const L = (cur, target) => lerp(cur, target, clamp(dt * 10, 0, 1));
    inner.position.y = L(inner.position.y, bobY);
    inner.scale.y = L(inner.scale.y, squash);
    inner.scale.x = inner.scale.z = L(inner.scale.x, 1 / Math.sqrt(squash));
    inner.rotation.x = L(inner.rotation.x, leanX);
    headGrp.rotation.x = L(headGrp.rotation.x, headNod);
    headGrp.rotation.z = L(headGrp.rotation.z, headTilt);
    headGrp.rotation.y = L(headGrp.rotation.y, headYaw);
    armL.rotation.x = L(armL.rotation.x, armLx);
    armR.rotation.x = L(armR.rotation.x, armRx);
    armL.rotation.z = L(armL.rotation.z, armLz);
    armR.rotation.z = L(armR.rotation.z, armRz);
    legL.rotation.x = L(legL.rotation.x, legLx);
    legR.rotation.x = L(legR.rotation.x, legRx);
    mouth.scale.x = L(mouth.scale.x, mouthScale * mouthBaseX);
    mouth.scale.y = L(mouth.scale.y, mouthScale * mouthBaseY);
  };

  return rig;
}

// ---------------- sea-sprunki (aquarium) ----------------

export function createSeaSprunki(spec, { scale = 1 } = {}) {
  const mats = {
    body: bodyMaterial(spec.color),
    accent: accentMaterial(spec.accent),
    eye: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 }),
    pupil: new THREE.MeshStandardMaterial({ color: 0x101018 }),
  };
  const root = new THREE.Group();

  const body = new THREE.Mesh(G.headDome, mats.body);
  body.scale.set(1, 0.92, 1.15);
  root.add(body);

  const tail = new THREE.Group();
  tail.position.z = -0.42;
  const tailFin = new THREE.Mesh(G.fin, mats.body);
  tailFin.rotation.x = -Math.PI / 2;
  tailFin.position.z = -0.3;
  tailFin.scale.set(1, 1, 0.25);
  tail.add(tailFin);
  root.add(tail);

  for (const side of [-1, 1]) {
    const f = new THREE.Mesh(G.sideFin, mats.accent);
    f.position.set(0.4 * side, -0.05, 0);
    f.rotation.z = side * Math.PI / 2.3;
    f.scale.set(1, 1, 0.3);
    root.add(f);
  }
  const crest = new THREE.Mesh(G.sideFin, mats.accent);
  crest.position.set(0, 0.42, -0.05);
  crest.rotation.x = -0.4;
  crest.scale.set(1, 1.3, 0.3);
  root.add(crest);

  const eyeL = new THREE.Mesh(G.eye, mats.eye);
  const eyeR = new THREE.Mesh(G.eye, mats.eye);
  eyeL.position.set(-0.16, 0.06, 0.38);
  eyeR.position.set(0.16, 0.06, 0.38);
  root.add(eyeL, eyeR);
  for (const e of [eyeL, eyeR]) {
    const p = new THREE.Mesh(G.pupil, mats.pupil);
    p.position.z = 0.075;
    e.add(p);
  }
  const mouth = new THREE.Mesh(G.mouth, mats.pupil);
  mouth.position.set(0, -0.14, 0.4);
  mouth.scale.set(1, 0.5, 0.4);
  root.add(mouth);

  root.scale.setScalar(scale);

  const rig = { group: root, spec, _t: Math.random() * 10 };
  rig.update = (dt, speed = 1) => {
    rig._t += dt;
    const t = rig._t;
    tail.rotation.y = Math.sin(t * (5 + speed * 3)) * 0.55;
    root.rotation.z = Math.sin(t * 1.4) * 0.08;
    body.scale.y = 0.92 + Math.sin(t * 2.2) * 0.02;
  };
  return rig;
}

// ---------------- portraits ----------------

/** Render a head-shot for every spec → Map(id → dataURL). */
export function renderPortraits(specs, size = 160) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d1c);
  scene.add(new THREE.HemisphereLight(0x9aa4ff, 0x1a1030, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(1.5, 2.5, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7c6cff, 3.5);
  rim.position.set(-2, 1.5, -2.5);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
  camera.position.set(0, 1.35, 2.15);
  camera.lookAt(0, 1.12, 0);

  const map = new Map();
  for (const spec of specs) {
    const rig = createSprunki(spec);
    scene.add(rig.group);
    rig.update(0.1, { anim: 'idle' });
    renderer.render(scene, camera);
    map.set(spec.id, renderer.domElement.toDataURL('image/png'));
    scene.remove(rig.group);
  }
  renderer.dispose();
  return map;
}
