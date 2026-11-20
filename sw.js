// Recibe el aviso (llega sin texto) y va a buscar el mensaje al robot.
const API = "https://cuando-viene.kvothesson.workers.dev";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => e.waitUntil((async () => {
  let ms = [];
  try {
    const sub = await self.registration.pushManager.getSubscription();
    const r = await fetch(API + "/push/pendiente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    ms = (await r.json()).mensajes || [];
  } catch (err) {}
  if (!ms.length) ms = [{ titulo: "Hay una fecha nueva cerca tuyo", cuerpo: "Tocá para verla.", url: self.registration.scope }];
  for (const m of ms) await self.registration.showNotification(m.titulo, { body: m.cuerpo, data: { url: m.url }, tag: m.url });
})()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow((e.notification.data && e.notification.data.url) || self.registration.scope));
});
