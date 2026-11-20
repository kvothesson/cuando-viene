// Recibe el aviso (llega sin texto) y va a buscar el mensaje al robot.
const API = "https://cuando-viene.kvothesson.workers.dev";
const ACA = self.registration.scope; // .../cuando-viene/
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => e.waitUntil((async () => {
  let ms = [];
  try {
    const sub = await self.registration.pushManager.getSubscription();
    const r = await fetch(API + "/push/pendiente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    ms = (await r.json()).mensajes || [];
  } catch (err) {}
  if (!ms.length) ms = [{ titulo: "🎟 Hay una fecha nueva cerca tuyo", cuerpo: "Tocá para verla.", url: ACA, mapa: ACA }];
  for (const m of ms) await self.registration.showNotification(m.titulo, {
    body: m.cuerpo,
    icon: ACA + "motor/icono.png",       // el cuadrado amarillo: se reconoce de un vistazo
    badge: ACA + "motor/insignia.png",   // lo que queda en la barra del celular
    image: m.imagen || undefined,        // la tarjeta del artista, en grande donde el sistema la muestra
    requireInteraction: true,            // no se va sola: queda hasta que la tocás o la cerrás
    vibrate: [200, 100, 200, 100, 400],
    tag: m.marca || m.url, renotify: true, // una por fecha: si se repite, reemplaza a la anterior y vuelve a sonar
    actions: [{ action: "entradas", title: "Ver entradas" }, { action: "mapa", title: "Ver en el mapa" }],
    data: { url: m.url, mapa: m.mapa || ACA },
  });
})()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  e.waitUntil(self.clients.openWindow((e.action === "mapa" ? d.mapa : d.url) || ACA));
});
