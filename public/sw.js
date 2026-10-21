// Minimal service worker so KRO5 can be installed to the home screen.
// It does not cache anything: every request goes to the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
