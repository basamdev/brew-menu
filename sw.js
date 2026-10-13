const CACHE_NAME = 'zayed-v133';
const APP_SHELL_PATHS = /\.(html|css|js)$/i;
const FIREBASE_SDK_URLS = [
    'https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js',
    'https://www.gstatic.com/firebasejs/12.17.0/firebase-analytics.js'
];
// Relative paths — the app is served from a subfolder (e.g. /brew-coffee/),
// so root-absolute paths like '/index.html' would 404 and break install.
const STATIC_ASSETS = [
    './manifest.json',
    './images/zayed-logo.png',
    './images/Brew-logo.png',
    './images/smart-serve-logo.png',
    './assets/icon-192.png',
    './assets/icon-512.png',
    './assets/icon-512-maskable.png',
    './assets/apple-touch-icon.png',
    './assets/logo.svg',
    './images/flag-kurdistan.svg'
];

self.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            // Cache each asset individually so one missing file doesn't abort
            // the whole install (which is what cache.addAll does).
            return Promise.all(STATIC_ASSETS.map(function (url) {
                return cache.add(url).catch(function (err) {
                    console.warn('[sw] skip caching', url, err);
                });
            })).then(function () {
                return Promise.all(FIREBASE_SDK_URLS.map(function (url) {
                    return cache.add(url).catch(function (err) {
                        console.warn('[sw] skip firebase sdk', url, err);
                    });
                }));
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    // Delete old caches as part of activation.
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (key) { return key !== CACHE_NAME; })
                    .map(function (key) { return caches.delete(key); })
            );
        }).catch(function (e) {
            console.warn('[sw] cache cleanup issue:', e);
        })
    );

    // Best-effort: take control of already-open pages. clients.claim() can
    // either throw synchronously or reject during the worker swap with
    // "Only the active worker can claim clients" — both are harmless, so we
    // swallow them quietly instead of logging a scary warning.
    try {
        var claimed = self.clients.claim();
        if (claimed && typeof claimed.catch === 'function') {
            claimed.catch(function () {});
        }
    } catch (e) { /* ignore */ }
});

self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET') return;

    var url = new URL(request.url);

    // Never intercept media or range requests. The browser needs to handle
    // <video>/<audio> with native HTTP range requests (206 Partial Content);
    // routing them through the service worker cache breaks playback.
    if (request.headers.has('range') || /\.(mp4|webm|ogg|ogv|mov|m4v|m4a|mp3)$/i.test(url.pathname)) {
        return;
    }

    // Images (item photos, category images, icons) — cache-first so they keep
    // working offline after being seen once, including cross-origin (opaque)
    // ones like flaticon icons or any image URL pasted in the admin.
    var isImage = request.destination === 'image' || /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(url.pathname);
    if (isImage) {
        event.respondWith(
            caches.match(request).then(function (cached) {
                if (cached) return cached;
                return fetch(request).then(function (response) {
                    if (response && (response.ok || response.type === 'opaque')) {
                        var clone = response.clone();
                        caches.open(CACHE_NAME).then(function (c) { c.put(request, clone); });
                    }
                    return response;
                }).catch(function () {
                    return cached || new Response('', { status: 503, statusText: 'Offline' });
                });
            })
        );
        return;
    }

    // Firebase SDK — cache-first so admin works offline after one online visit.
    if (url.hostname === 'www.gstatic.com' && /firebasejs/.test(url.pathname)) {
        event.respondWith(
            caches.match(request).then(function (cached) {
                var networkFetch = fetch(request).then(function (response) {
                    if (response && response.ok) {
                        var clone = response.clone();
                        caches.open(CACHE_NAME).then(function (c) { c.put(request, clone); });
                    }
                    return response;
                });
                return cached || networkFetch.catch(function () {
                    return new Response('// offline', { status: 503, statusText: 'Offline' });
                });
            })
        );
        return;
    }

    // Skip caching for other external API/font resources (not images).
    if (url.hostname.includes('cdnjs') || url.hostname.includes('firestore.googleapis.com') || url.hostname.includes('firebase') || url.hostname.includes('googleapis') || url.hostname.includes('gstatic')) {
        // Just fetch without caching
        event.respondWith(fetch(request));
        return;
    }

    // Network-first for the app shell (HTML/CSS/JS) so code/style changes show
    // up immediately. Falls back to cache only when offline.
    var isSameOrigin = url.origin === self.location.origin;
    if (isSameOrigin && (request.mode === 'navigate' || APP_SHELL_PATHS.test(url.pathname))) {
        event.respondWith(
            fetch(request, { cache: 'no-store' }).then(function (response) {
                if (response && response.ok) {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) { cache.put(request, clone); });
                }
                return response;
            }).catch(function () {
                return caches.match(request).then(function (cached) {
                    if (cached) return cached;
                    if (request.mode === 'navigate') {
                        return caches.match('./index.html').then(function (fallback) {
                            return fallback || caches.match('./admin.html');
                        });
                    }
                    return new Response('', { status: 503, statusText: 'Offline' });
                });
            })
        );
        return;
    }

    event.respondWith(
        caches.match(request).then(function (cached) {
            if (cached) return cached;
            return fetch(request).then(function (response) {
                if (response.ok && response.status !== 206 && (url.origin === self.location.origin || url.hostname.includes('fonts'))) {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) { cache.put(request, clone); });
                }
                return response;
            }).catch(function () {
                if (request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
                return new Response('', { status: 503, statusText: 'Offline' });
            });
        })
    );
});

