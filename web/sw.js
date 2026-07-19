// 앱 셸 캐시 (오프라인 설치용). CDN(모델·WASM)은 네트워크 통과 — 첫 실행은 온라인 필요.
const CACHE = "posture-guard-v5";
const SHELL = [
  "./", "./index.html", "./js/app.js", "./js/core.js", "./js/reward.js", "./manifest.webmanifest",
  "./assets/fairy/cheokcheok-atlas.png",
  "./assets/fairy/idle.gif", "./assets/fairy/alert.gif", "./assets/fairy/encourage.gif",
  "./assets/fairy/praise.gif", "./assets/fairy/angry.gif", "./assets/fairy/reward.gif",
  "./assets/fairy/hurt_neck.gif", "./assets/fairy/hurt_back.gif", "./assets/fairy/hurt_pelvis.gif",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
});
self.addEventListener("fetch", (e) => {
  if (new URL(e.request.url).origin !== location.origin) return; // CDN은 그대로
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
