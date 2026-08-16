/* 税务师刷题助手 Service Worker：离线缓存（PWA）
 * 缓存所有静态资源：页面/样式/脚本/题库/知识卡/图标
 * 更新机制：CACHE_VERSION 变化 → 安装时清旧缓存，激活后刷新页面
 */
'use strict';

const CACHE_VERSION = 'taxapp-v1';
const CACHE_NAME = CACHE_VERSION;

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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

// 激活：清理旧版本缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 请求：缓存优先 + 网络回退（离线可用）
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        // 只缓存同源成功响应
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return resp;
      }).catch(() => {
        // 离线且未缓存：返回 index.html（SPA 壳）
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 404, statusText: 'Offline' });
      });
    })
  );
});
