/* 税务师刷题助手 Service Worker：离线缓存（PWA）
 *
 * ██ 自动更新机制（重要）██
 * 每次发布新题库/新功能时：
 *   1. 在 app.js 的 APP_VERSION 行更新版本号（如 '2026-08-16' 改成 '2026-08-17'）
 *   2. 重新上传整个 _deploy 文件夹到 GitHub
 *   3. 手机端刷新一次 → 本文件检测到 app.js 变了 → 自动清旧缓存、加载新版
 *
 * 不需要手动清手机缓存。
 */
'use strict';

const CACHE_VERSION = 'taxapp-v2';   // 缓存版本：改了才会整包刷新（一般不用动）

const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './questions.js',
  './knowledge_cards.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

// 激活：清理旧版本缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 请求：缓存优先 + 网络回退（离线可用）
// 但 app.js / questions.js / knowledge_cards.js 这类"可能更新"的文件：
//   有网时先问服务器，若服务器版本不同（hash 变化）→ 用新版并更新缓存
//   没网时回退缓存（离线可用）
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 需要"有网就检查更新"的文件
  const dynamicFiles = ['./app.js', './questions.js', './knowledge_cards.js', './index.html'];
  const isDynamic = dynamicFiles.some((f) => url.pathname.endsWith(f));

  if (isDynamic) {
    event.respondWith(
      fetch(req).then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          return resp;
        }
        return caches.match(req);
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 静态文件：缓存优先
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return resp;
      }).catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 404, statusText: 'Offline' });
      });
    })
  );
});

// 页面加载后：通知页面检查并应用更新
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
