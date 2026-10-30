/* Service worker do site: deixa o sistema e o painel instaláveis como aplicativo.
   Sempre busca a versão nova na rede; o cache só é usado quando a internet cai
   (para abrir a tela e mostrar o aviso de "sem conexão"). Nada do Supabase passa por aqui. */
const CACHE = 'site-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || Response.error())));
});
