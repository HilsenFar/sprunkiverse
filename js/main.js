// ============================================================
//  JASON'S SPRUNKIVERSE — boot, menu, mode switching
// ============================================================
import * as THREE from 'three';
import { IS_TOUCH } from './core/utils.js';
import { Engine } from './core/engine.js';
import { AudioEngine } from './audio.js';
import { CHARACTERS, CHARACTERS_EXTRA, JASON_SPEC, renderPortraits } from './characters.js';
import { WorldMode } from './modes/world.js';
import { GodMode } from './modes/god.js';
import { AquariumMode } from './modes/aquarium.js';
import { MixerMode } from './modes/mixer.js';

const $ = (id) => document.getElementById(id);

const HELP = {
  menu: [
    '<b>SPRUNKI WORLD</b> — open-world life as JASON: explore, talk, run missions.',
    '<b>GOD MODE</b> — raise a society. Bless it. Or not.',
    '<b>SEA-SPRUNKIES</b> — an aquarium. Interaction is forbidden (there is none).',
    '<b>STUDIO</b> — the real Sprunki stage: 20 original sounds, dark phases, secret combos.',
  ],
  world: [
    '<b>WASD</b> move · <b>SHIFT</b> run · <b>SPACE</b> jump · <b>drag</b> to orbit camera · <b>scroll</b> zoom.',
    '<b>E</b> — talk to a nearby Sprunki. They each have a schedule: work, lunch, evening show, sleep.',
    'Take <b>missions</b> from OREN, SKY, DURPLE and MR. TREE — earn fame ★.',
    'In a <b>beat battle</b>, hit pads <b>1–4</b> exactly on the golden ring.',
    'The stage comes alive after sunset. BLACK only appears at night…',
  ],
  god: [
    '<b>Drag</b> to orbit · <b>scroll</b> zoom · pick a tool, click the island.',
    'Your tribe works on its own: <b>gatherers</b> bring food, <b>lumberjacks</b> chop trees for wood, <b>vibe keepers</b> dance faith into existence.',
    '<b>Advance through 4 ages</b> — Stone Groove → Bronze Beat → Electric → Neon. Each age unlocks buildings & powers, and adds an instrument to the island\'s song.',
    '<b>⏫ AGE UP</b> costs food + wood + faith and requires key buildings (hover the button).',
    '<b>Wrath</b> (lightning → plague → meteor) unlocks as you progress. Win by raising the <b>💎 Neon Monument</b>.',
  ],
  aqua: [
    'There is nothing to do.',
    'That is the point.',
    'Breathe. Watch the Sea-Sprunkies. They are fine.',
  ],
  mixer: [
    '<b>Drag a card onto the stage</b> (or click / keys <b>1–0</b>) — 20 sounds: beats · effects · melodies · voices.',
    'New sounds wait for their next phrase and enter <b>from the top</b> · hit <b>⟳ SYNC</b> to snap everyone together now.',
    '<b>Click</b> a performer to mute · <b>double-click</b> to remove · <b>drag empty space</b> to orbit.',
    '<b>PHASES Ⅰ–Ⅳ</b> (or key <b>P</b>) drag the whole mix darker — every loop is re-composed per phase.',
    'Put <b>BLACK</b> on stage and horror mode takes over. Add <b>OWAKCX</b> too… if you dare.',
    'A certain <b>combo of four</b> unlocks SPRUNK MODE…',
  ],
};

// ---------------- boot ----------------

const engine = new Engine($('stage'));
const audio = new AudioEngine();

// phones start on MED — they can always dial it up
if (IS_TOUCH) {
  engine.setQuality('medium');
  document.querySelectorAll('#quality-select button').forEach((b) =>
    b.classList.toggle('active', b.dataset.q === 'medium'));
}

const ui = {
  portraits: new Map(),
  kits: [],
  toast(msg, dur = 2400) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(ui._toastT);
    ui._toastT = setTimeout(() => el.classList.remove('show'), dur);
  },
};

const ctx = { engine, audio, ui };
const modes = {};
let currentMode = null;
let currentName = 'menu';

function setLoad(frac, msg) {
  $('loadbar-fill').style.width = `${Math.round(frac * 100)}%`;
  if (msg) $('load-status').textContent = msg;
}

async function boot() {
  setLoad(0.15, 'building the sprunkiverse…');
  await new Promise((r) => setTimeout(r, 30));

  // optional custom loop kits (user audio dropped into assets/loops)
  try {
    const resp = await fetch('assets/loops/kits.json');
    if (resp.ok) ui.kits = (await resp.json()).kits ?? [];
  } catch { /* no kits — classic only */ }

  setLoad(0.3, 'painting portraits…');
  await new Promise((r) => setTimeout(r, 30));
  ui.portraits = renderPortraits([...CHARACTERS, ...CHARACTERS_EXTRA, JASON_SPEC]);

  setLoad(0.45, 'tuning instruments…');
  $('load-status').textContent = 'ready when you are';
  $('loading-block').classList.add('hidden');
  $('enter-btn').classList.remove('hidden');

  $('enter-btn').onclick = async () => {
    $('enter-btn').classList.add('hidden');
    $('loading-block').classList.remove('hidden');
    await audio.init((f, id) => setLoad(0.45 + f * 0.55, `synthesizing ${id}…`));
    setLoad(1, 'done');
    $('overlay').classList.add('fade');
    showMenu();
  };
}

// ---------------- mode switching ----------------

function getMode(name) {
  if (!modes[name]) {
    modes[name] = {
      world: () => new WorldMode(ctx),
      god: () => new GodMode(ctx),
      aqua: () => new AquariumMode(ctx),
      mixer: () => new MixerMode(ctx),
    }[name]();
  }
  return modes[name];
}

function selectMode(name) {
  if (currentMode) currentMode.exit();
  currentMode = getMode(name);
  currentName = name;
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('help-panel').classList.add('hidden');
  currentMode.enter();
}

function showMenu() {
  if (currentMode) { currentMode.exit(); currentMode = null; }
  currentName = 'menu';
  $('hud').classList.add('hidden');
  $('help-panel').classList.add('hidden');
  $('menu').classList.remove('hidden');
}

document.querySelectorAll('.mode-card').forEach((card) => {
  card.onclick = () => selectMode(card.dataset.mode);
});
$('btn-back').onclick = showMenu;

// quality
document.querySelectorAll('#quality-select button').forEach((btn) => {
  btn.onclick = () => {
    engine.setQuality(btn.dataset.q);
    document.querySelectorAll('#quality-select button').forEach((b) =>
      b.classList.toggle('active', b === btn));
  };
});

// help
function showHelp() {
  $('help-title').textContent = {
    menu: 'THE SPRUNKIVERSE', world: 'SPRUNKI WORLD', god: 'GOD MODE',
    aqua: 'SEA-SPRUNKIES', mixer: 'STUDIO',
  }[currentName] ?? 'HOW TO PLAY';
  $('help-list').innerHTML = (HELP[currentName] ?? HELP.menu).map((l) => `<li>${l}</li>`).join('');
  $('help-panel').classList.remove('hidden');
}
$('btn-help').onclick = showHelp;
$('help-close').onclick = () => $('help-panel').classList.add('hidden');

addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (!$('help-panel').classList.contains('hidden')) { $('help-panel').classList.add('hidden'); return; }
    if (currentMode) showMenu();
  }
});

// ---------------- main loop ----------------

const clock = new THREE.Clock();
engine.renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  currentMode?.update(dt);
  engine.update(dt);
});

// debug / automation hook
window.__SPRUNKIVERSE__ = {
  engine, audio, ui, modes, selectMode, showMenu,
  get mode() { return currentMode; },
  get modeName() { return currentName; },
};

boot();
