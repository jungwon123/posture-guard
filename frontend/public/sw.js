// 앱 셸 캐시 (Vite 빌드용) — JS 번들은 해시가 붙어 바뀌므로 프리캐시하지 않고 network-first.
// 안정적인 에셋(요정 이미지·매니페스트)만 미리 캐시. CDN(모델·WASM)은 그대로 통과.
const CACHE = "cheokchu-v2";
const SHELL = [
  "./", "./manifest.webmanifest",
  "./assets/fairy/cheokcheok-atlas.png",
  "./assets/fairy/idle.gif", "./assets/fairy/alert.gif", "./assets/fairy/encourage.gif",
  "./assets/fairy/praise.gif", "./assets/fairy/angry.gif", "./assets/fairy/reward.gif",
  "./assets/fairy/hurt_neck.gif", "./assets/fairy/hurt_back.gif", "./assets/fairy/hurt_pelvis.gif",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});
self.addEventListener("fetch", (e) => {
  if (new URL(e.request.url).origin !== location.origin) return; // CDN 등은 통과
  e.respondWith(
    fetch(e.request)
      .then((res) => { const c = res.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); return res; })
      .catch(() => caches.match(e.request))
  );
});
