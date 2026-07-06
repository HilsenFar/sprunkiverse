// Jason's Sprunkiverse service worker.
// Bump VERSION on EVERY deploy (it is what makes clients pick up a
// consistent new build atomically). Stale-while-revalidate on code/data
// is the safety net if a deploy ever forgets the bump.
const VERSION = 'sprunkiverse-v5';

// strict shell — install fails (and the old version keeps serving) if any of
// these is missing, so list only files that always ship
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/main.js',
  './js/audio.js',
  './js/characters.js',
  './js/sprites3d.js',
  './js/core/utils.js',
  './js/core/engine.js',
  './js/modes/world.js',
  './js/modes/god.js',
  './js/modes/mixer.js',
  './js/modes/aquarium.js',
  './js/modes/wars.js',
  './assets/sprunki/sprites.json',
  './assets/sprunki/sounds/sounds.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

// best-effort bulk (install succeeds even if some fail): the three.js modules
// the import map pulls, plus every sprite/sound the manifests list — this is
// what makes the installed app fully playable offline
const CDN = [
  'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js',
  './assets/sprunki/backdrop_backdrop.svg',
  './assets/sprunki/backdrop_backdropevil.svg',
  './assets/sprunki/backdrop_scary-dark.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // cache:'reload' bypasses the HTTP cache so a bumped version can never
    // freeze stale files into the new cache
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));

    const bulk = [...CDN];
    const collect = (node) => {
      if (typeof node === 'string') {
        if (/\.(svg|png|mp3)$/.test(node)) bulk.push('./' + node.replace(/^\.?\//, ''));
      } else if (node && typeof node === 'object') {
        Object.values(node).forEach(collect);
      }
    };
    try { collect(await (await cache.match('./assets/sprunki/sprites.json')).json()); } catch {}
    try { collect(await (await cache.match('./assets/sprunki/sounds/sounds.json')).json()); } catch {}
    await Promise.allSettled(bulk.map(async (u) => {
      if (await cache.match(u)) return;
      const res = await fetch(u);
      if (res.ok) await cache.put(u, res);
    }));
    // no skipWaiting: the new version takes over on the next launch, so a
    // running game is never handed a different build's caches mid-session
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isShellNav = (url) => url.pathname === '/' || url.pathname.endsWith('/index.html');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // navigations: network first so a new deploy lands immediately; only a real
  // shell navigation may refresh the cached shell (a navigated-to .svg/.mp3
  // must never overwrite it); cached shell serves offline launches
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && isShellNav(url)) {
            const copy = res.clone();
            e.waitUntil(caches.open(VERSION).then((c) => c.put('./index.html', copy)));
          }
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // media + CDN modules: effectively immutable — cache first
  if (url.origin !== location.origin || /\.(svg|png|mp3|wav|jpg|webp)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(VERSION).then((c) => c.put(req, copy)));
        }
        return res;
      })),
    );
    return;
  }

  // code & data (js/css/json): stale-while-revalidate — instant loads, and
  // even a deploy that forgot the VERSION bump heals on the following visit
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const refresh = fetch(req)
      .then(async (res) => {
        if (res.ok) {
          const copy = res.clone();
          await caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => null);
    e.waitUntil(refresh);
    return cached ?? (await refresh) ?? Response.error();
  })());
});
