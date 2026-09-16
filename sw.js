const CACHE_NAME =
  "ftv-hub-static-v1";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",

  "./css/style.css",

  "./img/ftv-hub-logo.png",
  "./img/ftv-hub-favicon.png",
  "./img/ftv-hub-apple-touch-icon.png",
  "./img/ftv-hub-icon-192.png",
  "./img/ftv-hub-icon-512.png",
  "./img/mikasa-loader.png"
];

/*
 * Instala apenas arquivos estáticos.
 */
self.addEventListener(
  "install",
  event => {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then(cache =>
          cache.addAll(
            STATIC_ASSETS
          )
        )
    );

    self.skipWaiting();
  }
);

/*
 * Remove versões antigas do cache.
 */
self.addEventListener(
  "activate",
  event => {
    event.waitUntil(
      caches
        .keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(
                key =>
                  key !== CACHE_NAME
              )
              .map(
                key =>
                  caches.delete(key)
              )
          )
        )
    );

    self.clients.claim();
  }
);

/*
 * Estratégia:
 *
 * /api/*
 * → SEMPRE rede.
 *
 * Navegação / HTML
 * → rede primeiro.
 *
 * Arquivos estáticos
 * → cache primeiro.
 */
self.addEventListener(
  "fetch",
  event => {
    const request =
      event.request;

    const url =
      new URL(request.url);

    if (
      request.method !== "GET"
    ) {
      return;
    }

    /*
     * Nunca cacheia API.
     */
    if (
      url.pathname.startsWith(
        "/api/"
      )
    ) {
      return;
    }

    /*
     * HTML / navegação:
     * rede primeiro.
     */
    if (
      request.mode === "navigate"
    ) {
      event.respondWith(
        fetch(request)
          .then(response => {
            const copy =
              response.clone();

            caches
              .open(CACHE_NAME)
              .then(cache =>
                cache.put(
                  "./index.html",
                  copy
                )
              );

            return response;
          })
          .catch(() =>
            caches.match(
              "./index.html"
            )
          )
      );

      return;
    }

    /*
     * CSS, JS e imagens:
     * cache primeiro, rede como fallback.
     */
    event.respondWith(
      caches
        .match(request)
        .then(cached => {
          if (cached) {
            return cached;
          }

          return fetch(request);
        })
    );
  }
);