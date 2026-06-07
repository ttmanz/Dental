// Dental Assistant Pro — Service Worker
// Strategy: cache-first for app shell; network-first for API calls.
const CACHE  = 'dental-pro-v4'
const SHELL  = ['/', '/calendar.html', 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap']
const API_RX = /\/api\//

// ── Install: pre-cache the app shell ─────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {}))
  )
  self.skipWaiting()
})

// ── Activate: drop old caches ─────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// ── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Non-GET requests (API mutations) — always network, queue if offline
  if (request.method !== 'GET') {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'offline', queued: true }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    )
    return
  }

  // API reads — network first, serve stale on failure
  if (API_RX.test(url.pathname)) {
    e.respondWith(
      fetch(request)
        .then(res => {
          // Cache successful API GET responses for offline fallback
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(request, clone))
          return res
        })
        .catch(() => caches.match(request).then(r => r || offlineResponse()))
    )
    return
  }

  // App shell + static assets — cache first, network fallback
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        // Refresh in background
        fetch(request).then(res => {
          caches.open(CACHE).then(c => c.put(request, res))
        }).catch(() => {})
        return cached
      }
      return fetch(request)
        .then(res => {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(request, clone))
          return res
        })
        .catch(() => caches.match('/').then(r => r || offlineResponse()))
    })
  )
})

function offlineResponse() {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Offline</title>
    <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#F7F4EF}
    .box{text-align:center;padding:40px}.icon{font-size:64px}.title{font-size:24px;font-weight:700;color:#2C2A27;margin-top:16px}
    .sub{color:#9C9890;margin-top:8px}</style></head>
    <body><div class="box"><div class="icon">🦷</div>
    <div class="title">You're offline</div>
    <div class="sub">Dental Assistant Pro is loading from cache.<br>AI charting is still available.</div>
    </div></body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}

// ── Background sync for queued offline mutations ───────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'dental-sync') {
    e.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'sync-ready' }))
      )
    )
  }
})

// ── Push notifications (reminder alerts) ──────────────────────────────────
self.addEventListener('push', e => {
  const data = e.data?.json() || {}
  e.waitUntil(
    self.registration.showNotification(data.title || 'Dental Assistant Pro', {
      body: data.body || 'You have an update.',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag:  data.tag || 'dental-notification',
      data: { url: data.url || '/' }
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      const target = e.notification.data?.url || '/'
      const existing = list.find(c => c.url === target && 'focus' in c)
      if (existing) return existing.focus()
      return clients.openWindow(target)
    })
  )
})
