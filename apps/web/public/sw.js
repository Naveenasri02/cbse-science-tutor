const CACHE_NAME = 'matify-chat-v2'

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(['/', '/index.html']))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)

  // Skip WebSocket, chrome-extension, non-GET
  if (e.request.method !== 'GET' || url.protocol === 'ws:' || url.protocol === 'wss:') return

  // Navigation — network first, offline fallback
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    )
    return
  }

  // Static assets (JS, CSS, fonts, images) — stale-while-revalidate
  if (/\.(js|css|woff2?|ttf|png|svg|ico|webp)(\?|$)/.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => {
          const fetched = fetch(e.request).then(resp => {
            if (resp.ok) cache.put(e.request, resp.clone())
            return resp
          }).catch(() => cached)
          return cached || fetched
        })
      )
    )
    return
  }

  // Everything else — network first
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  )
})
