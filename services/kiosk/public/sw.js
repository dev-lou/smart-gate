/**
 * Smart Gate Kiosk — Service Worker v2
 * ======================================
 * Provides full offline support for the tablet PWA.
 *
 * 🛡️ v2 Features:
 *   - Caches app shell (/, manifest, icons)
 *   - Caches ONNX AI models for offline face recognition
 *   - Caches MediaPipe WASM binaries
 *   - Caches CDN assets (jsDelivr, Hugging Face, Google Storage)
 *   - Network-first strategy for fresh data, cache fallback offline
 *   - Auto-versioning: new cache per install, old caches deleted
 */

const CACHE_PREFIX = "smart-gate-kiosk";

// 🛡️ Static assets to cache on install
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

// 🛡️ AI model URLs to cache for offline face recognition + detection
// These are fetched in the `fetch` handler and cached on first access
const MODEL_URLS = [
  // ArcFace ONNX model (Hugging Face - WePrompt/buffalo_sc)
  "huggingface.co/WePrompt/buffalo_sc",
  // MediaPipe face detector (Google Storage)
  "storage.googleapis.com/mediapipe-models",
  // ONNX Runtime Web WASM + JS
  "cdn.jsdelivr.net/npm/onnxruntime-web",
  // MediaPipe Tasks Vision WASM
  "cdn.jsdelivr.net/npm/@mediapipe/tasks-vision",
];

// ─── Install ────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  const cacheName = `${CACHE_PREFIX}-${Date.now()}`;

  event.waitUntil(
    caches.open(cacheName).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );

  // Store the cache name for the activate handler
  self.skipWaiting();
});

// ─── Activate ───────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith(CACHE_PREFIX))
          // Keep only the MOST RECENT cache (delete others)
          .sort()
          .slice(0, -1)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// ─── Fetch ──────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") return;

  const url = event.request.url;

  // 🛡️ Cache AI model files aggressively (cache-first for CDN assets)
  // This enables fully offline face recognition after initial load
  if (MODEL_URLS.some((modelUrl) => url.includes(modelUrl))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(`${CACHE_PREFIX}-models`).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests: network-first, fall back to cached app shell
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          if (name.startsWith(CACHE_PREFIX)) {
            const cache = await caches.open(name);
            const match = await cache.match("/");
            if (match) return match;
          }
        }
        return new Response("Offline", { status: 503 });
      })
    );
    return;
  }

  // All other GET requests: network-first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          // 🛡️ Cache CDN assets for offline use
          if (
            url.startsWith(self.location.origin) ||
            url.includes("storage.googleapis.com") ||
            url.includes("cdn.jsdelivr.net") ||
            url.includes("huggingface.co")
          ) {
            const clone = response.clone();
            caches.open(`${CACHE_PREFIX}-assets`).then((cache) => {
              cache.put(event.request, clone);
            });
          }
        }
        return response;
      })
      .catch(async () => {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          if (name.startsWith(CACHE_PREFIX)) {
            const cache = await caches.open(name);
            const match = await cache.match(event.request);
            if (match) return match;
          }
        }
        return new Response("Not found", { status: 404 });
      })
  );
});
