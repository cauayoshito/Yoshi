/* Service worker do YOSHI BET — cache-first para estáticos, rede para a API */
const CACHE = "yoshibet-v2";
const PRECACHE = [
  "/",
  "/index.html",
  "/css/style.css",
  "/css/game.css",
  "/js/i18n.js",
  "/js/twemoji-map.js",
  "/js/data.js",
  "/js/app.js",
  "/js/game.js",
  "/js/sound.js",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // API sempre pela rede (dados vivos: saldo, spins, odds)
  if (url.pathname.startsWith("/api/")) return;

  // estáticos: cache-first com atualização em segundo plano
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
