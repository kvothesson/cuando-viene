// Robot de Cuándo viene: lee las fechas de cada artista, las sirve a la página,
// arma el calendario filtrado por localidad y manda las notificaciones.
import LOC from "../datos/localidades.json";
import MUNDO from "./ciudades.json"; // ciudades del mundo, para ubicar las fechas de afuera
import ARTISTAS from "../artistas.json"; // sumar un artista = sumar una entrada ahí
import { leerPogo, leerAgenda, unir, mismo, km } from "./fuentes.js";

// Lectores de páginas oficiales: cada formato nuevo suma el suyo en fuentes.js
const LECTORES = { agenda: leerAgenda };
const EVENTOS = ["visita", "localidad", "radio", "aviso", "calendario", "entradas", "telegram"];
const AGENTE = "cuando-viene/1.0 (+https://kvothesson.com/cuando-viene/)";
const SITIO = "https://kvothesson.com/cuando-viene/";
const EMPUJES = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com|[a-z0-9.-]+\.push\.apple\.com)$/;
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const ahora = () => new Date().toISOString();
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra } });
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function huella(s) { return b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).slice(0, 32); }
function cuando(f) {
  const d = new Date(f.fecha + "T12:00:00Z");
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}${f.hora ? " " + f.hora : ""}`;
}

// ---------------- leer las fuentes ----------------
async function bajar(url) {
  const r = await fetch(url, { headers: { "User-Agent": AGENTE, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}
async function anotar(env, clave, ok, detalle) {
  const antes = clave.startsWith("fuente:") ? await env.DB.prepare("SELECT ok FROM estado WHERE clave=?").bind(clave).first() : null;
  if (antes && !!antes.ok !== !!ok) await avisarDueno(env, ok ? `✅ Volvió a leerse ${escT(clave)} (${escT(detalle)}).` : `⚠️ Dejó de leerse ${escT(clave)}: ${escT(detalle)}`);
  await env.DB.prepare(
    "INSERT INTO estado (clave, ok, detalle, ts, ultimo_ok) VALUES (?1, ?2, ?3, ?4, CASE WHEN ?2=1 THEN ?4 END) " +
    "ON CONFLICT(clave) DO UPDATE SET ok=?2, detalle=?3, ts=?4, ultimo_ok=CASE WHEN ?2=1 THEN ?4 ELSE ultimo_ok END"
  ).bind(clave, ok ? 1 : 0, String(detalle).slice(0, 200), ahora()).run();
}

async function revisar(env) {
  const hoy = hoyAR(), resumen = [];
  for (const a of ARTISTAS) {
    let pogo = [], oficial = [], alguna = false;
    const fu = a.fuentes || {};
    if (fu.pogo) try {
      pogo = leerPogo(await bajar(fu.pogo)); alguna = true;
      await anotar(env, `fuente:${a.slug}:pogo`, true, pogo.length + " fechas");
    } catch (e) { await anotar(env, `fuente:${a.slug}:pogo`, false, e.message); }
    if (fu.oficial) try {
      const leerOf = LECTORES[fu.oficial.lector];
      const html = await bajar(fu.oficial.url);
      oficial = leerOf(html, hoy);
      // si la página cambió de forma no hay ninguna fecha legible, ni pasada ni futura
      if (!oficial.length && !leerOf(html, "2000-01-01").length) throw new Error("no encontré fechas: ¿cambió la página?");
      alguna = true;
      await anotar(env, `fuente:${a.slug}:oficial`, true, oficial.length + " fechas");
    } catch (e) { await anotar(env, `fuente:${a.slug}:oficial`, false, e.message); }
    if (!alguna) { resumen.push({ artista: a.slug, error: "ninguna fuente respondió" }); continue; }

    const vistas = unir(pogo, oficial, LOC, MUNDO, a.pais || "AR").filter((e) => e.fecha >= hoy);
    const { results: filas } = await env.DB.prepare("SELECT * FROM fechas WHERE artista=? AND fecha>=?").bind(a.slug, hoy).all();
    let nuevas = 0;
    for (const e of vistas) {
      const f = filas.find((x) => mismo(x, e));
      if (f) {
        await env.DB.prepare("UPDATE fechas SET hora=?, lugar=?, link=?, agotado=?, lat=COALESCE(?,lat), lon=COALESCE(?,lon), pais=?, tz=?, precio=COALESCE(?,precio), moneda=COALESCE(?,moneda), fuentes=?, ultima_vez=? WHERE id=?")
          .bind(e.hora || f.hora, e.lugar || f.lugar, e.link || f.link, e.agotado, e.lat, e.lon, e.pais || f.pais, e.tz || f.tz || "", e.precio ?? null, e.moneda || null, e.fuentes.join("+"), ahora(), f.id).run();
        continue;
      }
      await env.DB.prepare("INSERT INTO fechas (artista, fecha, hora, lugar, ciudad, pais, lat, lon, tz, link, agotado, precio, moneda, fuentes, visto, ultima_vez) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(a.slug, e.fecha, e.hora, e.lugar, e.ciudad, e.pais, e.lat, e.lon, e.tz || "", e.link, e.agotado, e.precio ?? null, e.moneda || null, e.fuentes.join("+"), ahora(), ahora()).run();
      nuevas++;
      if (e.lat != null) await encolar(env, a, e);
    }
    resumen.push({ artista: a.slug, pogo: pogo.length, oficial: oficial.length, vigentes: vistas.length, nuevas });
  }
  await anotar(env, "corrida", true, JSON.stringify(resumen));
  return resumen;
}

// ---------------- notificaciones del navegador ----------------
// Se marca a quién le toca; el envío sale de a tandas porque el plan gratis limita los pedidos por corrida.
async function encolar(env, a, e) {
  const msj = JSON.stringify({
    // Que se entienda de un vistazo: quién, dónde, cuándo. La distancia la agrega /push/pendiente para cada uno.
    titulo: `🎟 ${a.nombre} viene a ${e.ciudad}`,
    cuerpo: `${cuando(e)}${e.lugar ? " · " + e.lugar : ""}`,
    agotado: e.agotado ? 1 : 0, artista: a.slug,
    url: e.link || SITIO + a.slug + "/", lat: e.lat, lon: e.lon,
  });
  const porLon = 111.2 * Math.max(0.1, Math.cos((e.lat * Math.PI) / 180));
  const r = await env.DB.prepare("UPDATE push SET pendiente=?, enviar=1, intentos=0 WHERE artista=? AND abs(lat-?)*111.2<=km AND abs(lon-?)*?<=km")
    .bind(msj, a.slug, e.lat, e.lon, porLon).run();
  const t = await env.DB.prepare("UPDATE tg SET pendiente=?, enviar=1 WHERE artista=? AND abs(lat-?)*111.2<=km AND abs(lon-?)*?<=km")
    .bind(msj, a.slug, e.lat, e.lon, porLon).run();
  return (r.meta.changes || 0) + (t.meta.changes || 0);
}

let jwtCache = {};
async function vapid(env, aud) {
  const c = jwtCache[aud];
  if (c && c.exp > Date.now() / 1000 + 600) return c.jwt;
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const cuerpo = enc({ typ: "JWT", alg: "ES256" }) + "." + enc({ aud, exp, sub: "mailto:contacto@kvothesson.com" });
  const firma = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(cuerpo));
  const jwt = cuerpo + "." + b64u(firma);
  jwtCache[aud] = { jwt, exp };
  return jwt;
}
async function empujar(env, endpoint) {
  const jwt = await vapid(env, new URL(endpoint).origin);
  const r = await fetch(endpoint, { method: "POST", headers: { TTL: "86400", Urgency: "high", Authorization: `vapid t=${jwt}, k=${env.VAPID_PUB}` } });
  return r.status;
}
async function despachar(env, tope = 40) {
  const { results } = await env.DB.prepare("SELECT id, endpoint, lat, lon, km, pendiente, intentos FROM push WHERE enviar=1 LIMIT ?").bind(tope).all();
  let enviados = 0, bajas = 0, fuera = 0;
  for (const s of results) {
    let m = null;
    try { m = JSON.parse(s.pendiente); } catch {}
    if (!m || km(s, m) > s.km) { // el recorte fino: el círculo y no el cuadrado
      await env.DB.prepare("UPDATE push SET enviar=0, pendiente=NULL WHERE id=?").bind(s.id).run(); fuera++; continue;
    }
    let st = 0;
    try { st = await empujar(env, s.endpoint); } catch {}
    if (st === 404 || st === 410) { await env.DB.prepare("DELETE FROM push WHERE id=?").bind(s.id).run(); bajas++; }
    else if (st >= 200 && st < 300) { await env.DB.prepare("UPDATE push SET enviar=0, ultimo_envio=? WHERE id=?").bind(ahora(), s.id).run(); enviados++; }
    else await env.DB.prepare("UPDATE push SET intentos=intentos+1, enviar=CASE WHEN intentos>=4 THEN 0 ELSE 1 END WHERE id=?").bind(s.id).run();
  }
  return { enviados, bajas, fuera };
}

// ---------------- Telegram: el aviso que no depende del aparato ----------------
// De cada persona se guarda el número de su chat con el bot, la ciudad elegida y el radio.
const escT = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
async function tg(env, metodo, cuerpo) {
  if (!env.TG_TOKEN) return { ok: false, status: 0 };
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    return { ok: r.ok, status: r.status };
  } catch { return { ok: false, status: 0 }; }
}
const decir = (env, chat, texto, botones) => tg(env, "sendMessage", Object.assign(
  { chat_id: chat, text: texto, parse_mode: "HTML", disable_web_page_preview: true },
  botones ? { reply_markup: { inline_keyboard: [botones.map(([t, u]) => ({ text: t, url: u }))] } } : {}));
async function avisarDueno(env, texto) {
  const d = await env.DB.prepare("SELECT detalle FROM estado WHERE clave='dueno'").first();
  if (d && d.detalle) await decir(env, d.detalle, texto);
}
// Manda los avisos pendientes de Telegram, de a tandas
async function despacharTg(env, tope = 15) {
  if (!env.TG_TOKEN) return { enviados: 0, bajas: 0, fuera: 0 };
  const { results } = await env.DB.prepare("SELECT id, chat, lat, lon, km, loc, pendiente FROM tg WHERE enviar=1 LIMIT ?").bind(tope).all();
  let enviados = 0, bajas = 0, fuera = 0;
  for (const s of results) {
    let m = null;
    try { m = JSON.parse(s.pendiente); } catch {}
    if (!m || km(s, m) > s.km) { await env.DB.prepare("UPDATE tg SET enviar=0, pendiente=NULL WHERE id=?").bind(s.id).run(); fuera++; continue; }
    const pagina = SITIO + (m.artista ? m.artista + "/" : "");
    const texto = `<b>${escT(m.titulo)}</b>\n${escT(m.cuerpo)}\nA ${Math.round(km(s, m))} km${s.loc ? " de " + escT(s.loc) : ""}.${m.agotado ? "\nFigura agotado." : ""}`;
    const r = await decir(env, s.chat, texto, [[m.agotado ? "Ver igual" : "Ver entradas", m.url || pagina], ["Ver en el mapa", pagina]]);
    if (r.status === 403) { await env.DB.prepare("DELETE FROM tg WHERE chat=?").bind(s.chat).run(); bajas++; } // bloqueó al bot
    else if (r.ok) { await env.DB.prepare("UPDATE tg SET enviar=0, pendiente=NULL, ultimo_contacto=? WHERE id=?").bind(ahora(), s.id).run(); enviados++; }
  }
  return { enviados, bajas, fuera };
}
// "Sigo mirando": si pasan 75 días sin novedades, un mensaje corto. Así el silencio no se confunde con una falla.
async function sigoVivo(env) {
  const hace = new Date(Date.now() - 75 * 86400e3).toISOString();
  const { results } = await env.DB.prepare("SELECT id, chat, artista, km, loc FROM tg WHERE enviar=0 AND (ultimo_contacto IS NULL OR ultimo_contacto<?) LIMIT 15").bind(hace).all();
  for (const s of results) {
    const a = ARTISTAS.find((x) => x.slug === s.artista);
    const r = await decir(env, s.chat, `👋 Sigo mirando la agenda de ${escT(a ? a.nombre : s.artista)}. Todavía no anunció nada a menos de ${s.km} km de ${escT(s.loc || "tu ciudad")}. Apenas aparezca, te escribo.`);
    if (r.status === 403) await env.DB.prepare("DELETE FROM tg WHERE chat=?").bind(s.chat).run();
    else if (r.ok) await env.DB.prepare("UPDATE tg SET ultimo_contacto=? WHERE id=?").bind(ahora(), s.id).run();
  }
}
// Lo que la gente le escribe al bot
async function telegramEntrante(env, up) {
  const msg = up && up.message;
  if (!msg || !msg.text || !msg.chat || msg.chat.type !== "private") return;
  const chat = String(msg.chat.id), [orden, arg] = msg.text.trim().split(/\s+/, 2);
  const cmd = orden.toLowerCase().replace(/@.*$/, "");
  if (cmd === "/start" && arg) {
    const p = await env.DB.prepare("SELECT * FROM tg_pedido WHERE codigo=?").bind(arg).first();
    const a = p && ARTISTAS.find((x) => x.slug === p.artista);
    if (!a) return decir(env, chat, `Ese enlace ya venció. Volvé a <a href="${SITIO}">la página</a>, elegí tu ciudad y tocá “Por Telegram” de nuevo.`);
    await env.DB.prepare("INSERT INTO tg (chat, artista, lat, lon, km, loc, creado, ultimo_contacto) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(chat, artista) DO UPDATE SET lat=excluded.lat, lon=excluded.lon, km=excluded.km, loc=excluded.loc, ultimo_contacto=excluded.ultimo_contacto")
      .bind(chat, a.slug, p.lat, p.lon, p.km, p.loc, ahora(), ahora()).run();
    await env.DB.prepare("DELETE FROM tg_pedido WHERE codigo=?").bind(arg).run();
    return decir(env, chat, `✅ Listo. Te escribo por acá apenas <b>${escT(a.nombre)}</b> anuncie una fecha a menos de <b>${p.km} km de ${escT(p.loc || "tu ciudad")}</b>.\n\nNo depende de tu celular ni de tu navegador: mientras tengas Telegram, te llega. Si pasan un par de meses sin novedades, te mando un “sigo mirando”.\n\n/estado para ver qué tenés activado · /baja para dejar de recibir`);
  }
  if (cmd === "/start") return decir(env, chat, `Hola. Te aviso cuando tu artista anuncia un show cerca tuyo.\n\nPara activarlo, entrá a <a href="${SITIO}">kvothesson.com/cuando-viene</a>, elegí tu ciudad y hasta cuántos km irías, y tocá “Por Telegram”.`);
  if (cmd === "/estado") {
    const { results } = await env.DB.prepare("SELECT artista, km, loc FROM tg WHERE chat=? ORDER BY artista").bind(chat).all();
    if (!results.length) return decir(env, chat, `No tenés ningún aviso activado. Entrá a <a href="${SITIO}">kvothesson.com/cuando-viene</a> para activar uno.`);
    return decir(env, chat, "Tenés activado:\n" + results.map((r) => { const a = ARTISTAS.find((x) => x.slug === r.artista); return `• <b>${escT(a ? a.nombre : r.artista)}</b>, a menos de ${r.km} km de ${escT(r.loc || "tu ciudad")}`; }).join("\n") + "\n\n/baja para dejar de recibir");
  }
  if (cmd === "/baja") {
    await env.DB.prepare("DELETE FROM tg WHERE chat=?").bind(chat).run();
    return decir(env, chat, "Listo, no te escribo más. No quedó guardado nada tuyo. Si querés volver, activalo de nuevo desde la página.");
  }
  if (cmd === "/dueno" && env.CLAVE && arg === env.CLAVE) { // el dueño recibe acá los avisos de que algo se rompió
    await env.DB.prepare("INSERT INTO estado (clave, ok, detalle, ts) VALUES ('dueno', 1, ?1, ?2) ON CONFLICT(clave) DO UPDATE SET detalle=?1, ts=?2").bind(chat, ahora()).run();
    return decir(env, chat, "Anotado. Te aviso por acá si una fuente deja de leerse y cuando vuelva.");
  }
  return decir(env, chat, "No entendí eso. Probá /estado o /baja.");
}

// ---------------- calendario ----------------
const escIcs = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
function doblar(l) { // líneas de hasta 75 bytes
  const b = new TextEncoder().encode(l);
  if (b.length <= 75) return l;
  const dec = new TextDecoder(); let out = "", i = 0, largo = 75;
  while (i < b.length) {
    let fin = Math.min(b.length, i + largo);
    while (fin < b.length && (b[fin] & 0xc0) === 0x80) fin--; // no cortar una letra por la mitad
    out += (i ? "\r\n " : "") + dec.decode(b.slice(i, fin)); i = fin; largo = 74;
  }
  return out;
}
function calendario(a, fechas, loc, radio) {
  const sello = ahora().replace(/[-:]|\.\d+/g, "");
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cuando viene//kvothesson.com//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escIcs(a.nombre + (loc ? " cerca de " + loc : ""))}`,
    `X-WR-CALDESC:${escIcs(`Fechas de ${a.nombre} a menos de ${radio} km${loc ? " de " + loc : ""}. Cuándo viene, página de fans.`)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  for (const f of fechas) {
    const d = f.fecha.replace(/-/g, "");
    L.push("BEGIN:VEVENT", `UID:${a.slug}-${f.id}@cuando-viene.kvothesson.com`, `DTSTAMP:${sello}`);
    if (f.hora && f.tz) { // hora local del lugar, con su huso: el calendario la convierte para quien la mira
      const ini = new Date(`${f.fecha}T${f.hora}:00Z`), fin = new Date(ini.getTime() + 2 * 3600e3);
      const z = (x) => x.toISOString().replace(/[-:]|\.\d+|Z/g, "");
      L.push(`DTSTART;TZID=${f.tz}:${z(ini)}`, `DTEND;TZID=${f.tz}:${z(fin)}`);
    } else {
      const sig = new Date(new Date(f.fecha + "T12:00:00Z").getTime() + 86400e3).toISOString().slice(0, 10).replace(/-/g, "");
      L.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${sig}`);
    }
    L.push(`SUMMARY:${escIcs(`${a.nombre} en ${f.ciudad}${f.agotado ? " (agotado)" : ""}`)}`,
      `LOCATION:${escIcs([f.lugar, f.ciudad].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${escIcs((f.agotado ? "Figura agotado. " : "") + (f.link ? "Entradas: " + f.link : "") + "\n" + SITIO + a.slug + "/")}`);
    if (f.link) L.push(`URL:${f.link}`);
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(doblar).join("\r\n") + "\r\n";
}

async function vigentes(env, slug) {
  const hace = new Date(Date.now() - 3 * 86400e3).toISOString(); // si dejó de aparecer en las fuentes, se cae sola
  const { results } = await env.DB.prepare("SELECT id, fecha, hora, lugar, ciudad, pais, lat, lon, tz, link, agotado, precio, moneda, visto FROM fechas WHERE artista=? AND fecha>=? AND ultima_vez>=? ORDER BY fecha, hora")
    .bind(slug, hoyAR(), hace).all();
  return results;
}
const punto = (u) => {
  const lat = +u.searchParams.get("lat"), lon = +u.searchParams.get("lon"), radio = Math.round(+u.searchParams.get("km"));
  return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && radio >= 5 && radio <= 2000 ? { lat, lon, radio } : null;
};

// ---------------- tablero de métricas ----------------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
async function panel(env) {
  const desde = new Date(Date.now() - 30 * 86400e3 - 3 * 3600e3).toISOString().slice(0, 10);
  const q = (sql, ...v) => env.DB.prepare(sql).bind(...v).all().then((r) => r.results);
  const totales = await q("SELECT artista, ev, sum(n) n FROM metricas WHERE dia>=? GROUP BY artista, ev ORDER BY artista, ev", desde);
  const dias = await q("SELECT dia, artista, ev, sum(n) n FROM metricas WHERE dia>=? GROUP BY dia, artista, ev ORDER BY dia DESC, artista, ev", desde);
  const claves = await q("SELECT artista, ev, clave, sum(n) n FROM metricas WHERE dia>=? AND clave<>'' GROUP BY artista, ev, clave ORDER BY artista, ev, n DESC", desde);
  const anotados = await q("SELECT artista, count(*) n FROM push GROUP BY artista");
  const tabla = (cab, filas) => `<table><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr>${filas.map((f) => `<tr>${f.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
  const top = {};
  for (const c of claves) { const k = c.artista + " · " + c.ev; (top[k] = top[k] || []).length < 15 && top[k].push([c.clave, c.n]); }
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Cuándo viene · métricas</title>
<style>body{font:15px system-ui;background:#14110f;color:#f3ece2;max-width:900px;margin:auto;padding:16px}table{border-collapse:collapse;margin:8px 0 24px}td,th{border:1px solid #3a332b;padding:4px 10px;text-align:left}th{color:#a99c8b}h2{color:#ffcc33}</style>
<h1>Cuándo viene · últimos 30 días</h1>
<h2>Dispositivos con aviso activo</h2>${tabla(["artista", "anotados"], anotados.map((r) => [r.artista, r.n]))}
<h2>Totales</h2>${tabla(["artista", "evento", "veces"], totales.map((r) => [r.artista, r.ev, r.n]))}
${Object.entries(top).map(([k, f]) => `<h2>${esc(k)}</h2>${tabla(["valor", "veces"], f)}`).join("")}
<h2>Por día</h2>${tabla(["día", "artista", "evento", "veces"], dias.map((r) => [r.dia, r.artista, r.ev, r.n]))}`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

// ---------------- pedidos ----------------
async function pedido(req, env, ctx) {
  const u = new URL(req.url), p = u.pathname;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  let m;

  if ((m = p.match(/^\/fechas\/([a-z0-9-]+)$/)) && req.method === "GET") {
    const a = ARTISTAS.find((x) => x.slug === m[1]);
    if (!a) return json({ error: "no conozco a ese artista" }, 404);
    const corrida = await env.DB.prepare("SELECT ts FROM estado WHERE clave='corrida'").first();
    // países donde alguna vez se le vio una fecha: sirven para armar sus páginas por país
    const vistos = await env.DB.prepare("SELECT DISTINCT pais FROM fechas WHERE artista=? AND pais<>''").bind(a.slug).all();
    return json({ artista: a.slug, nombre: a.nombre, actualizado: corrida ? corrida.ts : null, vapid: env.VAPID_PUB, telegram: !!(env.TG_TOKEN && env.TG_BOT), paises: vistos.results.map((r) => r.pais), fechas: await vigentes(env, a.slug) }, 200, { "Cache-Control": "public, max-age=300" });
  }

  if ((m = p.match(/^\/cal\/([a-z0-9-]+)\.ics$/)) && req.method === "GET") {
    const a = ARTISTAS.find((x) => x.slug === m[1]), pt = punto(u);
    if (!a || !pt) return new Response("Falta el artista o el punto (lat, lon, km).", { status: 400, headers: CORS });
    const cerca = (await vigentes(env, a.slug)).filter((f) => f.lat != null && km(pt, f) <= pt.radio);
    return new Response(calendario(a, cerca, (u.searchParams.get("loc") || "").slice(0, 60), pt.radio), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=3600", ...CORS } });
  }

  if (p === "/push/alta" && req.method === "POST") {
    const b = await req.json().catch(() => null), s = b && b.sub, a = b && ARTISTAS.find((x) => x.slug === b.artista);
    let host = ""; try { const e = new URL(s.endpoint); if (e.protocol === "https:") host = e.hostname; } catch {}
    const lat = +(b || {}).lat, lon = +(b || {}).lon, radio = Math.round(+(b || {}).km);
    if (!a || !EMPUJES.test(host) || s.endpoint.length > 1000 || !isFinite(lat) || !isFinite(lon) || !(radio >= 5 && radio <= 2000)) return json({ error: "datos incompletos" }, 400);
    const id = await huella(s.endpoint + "|" + a.slug);
    await env.DB.prepare("INSERT INTO push (id, endpoint, artista, lat, lon, km, loc, creado) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lat=excluded.lat, lon=excluded.lon, km=excluded.km, loc=excluded.loc")
      .bind(id, s.endpoint, a.slug, lat, lon, radio, String(b.loc || "").slice(0, 60), ahora()).run();
    return json({ ok: true, id });
  }
  if (p === "/push/baja" && req.method === "POST") {
    const b = await req.json().catch(() => null);
    if (!b || !b.endpoint || !b.artista) return json({ error: "datos incompletos" }, 400);
    await env.DB.prepare("DELETE FROM push WHERE id=?").bind(await huella(b.endpoint + "|" + b.artista)).run();
    return json({ ok: true });
  }
  // El aviso llega sin texto (así no hace falta cifrar nada); el navegador viene a buscarlo acá.
  if (p === "/push/pendiente" && req.method === "POST") {
    const b = await req.json().catch(() => null);
    if (!b || !b.endpoint) return json({ error: "datos incompletos" }, 400);
    const { results } = await env.DB.prepare("SELECT id, pendiente, lat, lon, loc FROM push WHERE endpoint=? AND pendiente IS NOT NULL LIMIT 5").bind(b.endpoint).all();
    const msjs = [];
    for (const r of results) { try { 
        const x = JSON.parse(r.pendiente);
        const cerca = x.lat != null ? `A ${Math.round(km(r, x))} km${r.loc ? " de " + r.loc : ""}. ` : "";
        const pagina = SITIO + (x.artista ? x.artista + "/" : "");
        msjs.push({
          titulo: x.titulo, cuerpo: `${x.cuerpo}\n${cerca}${x.agotado ? "Figura agotado." : "Tocá para ver las entradas."}`,
          url: x.url, mapa: pagina, imagen: x.artista ? pagina + "tarjeta.png" : "", marca: (x.artista || "") + "|" + x.titulo + "|" + x.cuerpo,
        });
      } catch {} }
    if (results.length) ctx.waitUntil(env.DB.prepare("UPDATE push SET pendiente=NULL WHERE endpoint=? AND enviar=0").bind(b.endpoint).run());
    return json({ mensajes: msjs });
  }

  // Métricas propias: contadores por día y por artista. Sin cookies ni nada que identifique a nadie.
  if (p === "/evento" && req.method === "POST") {
    const b = await req.json().catch(() => null);
    const a = b && ARTISTAS.find((x) => x.slug === b.a);
    if (!a || !EVENTOS.includes(b.ev)) return json({ error: "evento desconocido" }, 400);
    await env.DB.prepare("INSERT INTO metricas (dia, artista, ev, clave, n) VALUES (?,?,?,?,1) ON CONFLICT(dia, artista, ev, clave) DO UPDATE SET n=n+1")
      .bind(hoyAR(), a.slug, b.ev, String(b.k || "").slice(0, 40)).run();
    return json({ ok: true });
  }
  if (p === "/panel") {
    if (!env.CLAVE || u.searchParams.get("clave") !== env.CLAVE) return json({ error: "sin permiso" }, 403);
    return panel(env);
  }

  // Telegram: la página pide un enlace de un solo uso con la ciudad y el radio adentro
  if (p === "/telegram/pedido" && req.method === "POST") {
    const b = await req.json().catch(() => null), a = b && ARTISTAS.find((x) => x.slug === b.artista);
    const lat = +(b || {}).lat, lon = +(b || {}).lon, radio = Math.round(+(b || {}).km);
    if (!env.TG_BOT || !a || !isFinite(lat) || !isFinite(lon) || !(radio >= 5 && radio <= 2000)) return json({ error: "datos incompletos" }, 400);
    const codigo = b64u(crypto.getRandomValues(new Uint8Array(15)));
    await env.DB.prepare("INSERT INTO tg_pedido (codigo, artista, lat, lon, km, loc, creado) VALUES (?,?,?,?,?,?,?)").bind(codigo, a.slug, lat, lon, radio, String(b.loc || "").slice(0, 60), ahora()).run();
    ctx.waitUntil(env.DB.prepare("DELETE FROM tg_pedido WHERE creado<?").bind(new Date(Date.now() - 86400e3).toISOString()).run());
    return json({ link: `https://t.me/${env.TG_BOT}?start=${codigo}` });
  }
  if (p === "/telegram/entrante" && req.method === "POST") {
    if (!env.TG_SECRETO || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TG_SECRETO) return json({ error: "sin permiso" }, 403);
    await telegramEntrante(env, await req.json().catch(() => null));
    return json({ ok: true });
  }

  if (p === "/salud") {
    const { results } = await env.DB.prepare("SELECT clave, ok, detalle, ts, ultimo_ok FROM estado ORDER BY clave").all();
    const viejo = new Date(Date.now() - 6 * 3600e3).toISOString();
    const fuentes = results.filter((r) => r.clave.startsWith("fuente:"));
    const corrida = results.find((r) => r.clave === "corrida");
    const problemas = fuentes.filter((r) => !r.ok || !r.ultimo_ok || r.ultimo_ok < viejo).map((r) => `${r.clave}: ${r.detalle}`);
    if (!corrida || corrida.ts < viejo) problemas.push("el robot no corre desde " + (corrida ? corrida.ts : "nunca"));
    const anotados = await env.DB.prepare("SELECT count(*) n FROM push").first();
    return json({ ok: !problemas.length, problemas, ultima_corrida: corrida ? corrida.ts : null, fuentes, anotados: anotados.n });
  }

  if (p.startsWith("/admin/")) {
    if (!env.CLAVE || u.searchParams.get("clave") !== env.CLAVE) return json({ error: "sin permiso" }, 403);
    if (p === "/admin/revisar") return json({ resumen: await revisar(env), envio: await despachar(env) });
    if (p === "/admin/prueba") { // simula una fecha nueva en una ciudad, sin guardarla
      const a = ARTISTAS.find((x) => x.slug === u.searchParams.get("artista")) || ARTISTAS[0];
      const e = { fecha: hoyAR(), hora: "21:00", lugar: "Teatro de prueba", ciudad: u.searchParams.get("ciudad") || "Prueba", lat: +u.searchParams.get("lat"), lon: +u.searchParams.get("lon"), link: "", agotado: 0 };
      const marcados = await encolar(env, a, e);
      return json({ marcados, envio: await despachar(env), telegram: await despacharTg(env) });
    }
  }
  return json({ servicio: "cuando-viene", sitio: SITIO }, p === "/" ? 200 : 404);
}

export default {
  async fetch(req, env, ctx) {
    try { return await pedido(req, env, ctx); }
    catch (e) { return json({ error: "falló el robot", detalle: String(e && e.message || e).slice(0, 200) }, 500); }
  },
  // Corre cada minuto: los avisos pendientes salen enseguida; las fuentes se leen cada 30.
  async scheduled(ev, env, ctx) {
    const min = new Date(ev.scheduledTime).getUTCMinutes();
    const t = new Date(ev.scheduledTime);
    if (min % 30 === 0) await revisar(env);
    await despachar(env, 25);
    await despacharTg(env);
    if (t.getUTCHours() === 15 && min === 15) await sigoVivo(env); // una vez por día, al mediodía de Argentina
  },
};
