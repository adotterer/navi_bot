// Minimal service worker — exists only to satisfy the browser's installability criteria for
// "Add to Home Screen" on Android/Chrome. Deliberately does no caching and never intercepts
// requests: this site's content changes on demand (the regenerate button), and a caching service
// worker would risk showing stale matchup guides.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // no-op: every request falls through to the network normally
