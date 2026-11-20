// Lectores de fechas. Funciones puras: reciben el HTML y devuelven eventos.
// Evento: { fecha "AAAA-MM-DD", hora "HH:MM" o "", lugar, ciudad, pais, lat, lon, link, agotado 0|1, fuentes [] }

export const sinTildes = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const MES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
const num = (x) => (typeof x === "number" && isFinite(x) ? x : x && isFinite(+x) ? +x : null);
const dos = (n) => String(n).padStart(2, "0");

export function km(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// pogo.ar: cada página de artista trae sus eventos en JSON-LD (schema.org)
export function leerPogo(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let d;
    try { d = JSON.parse(m[1]); } catch { continue; }
    for (const x of [].concat(d)) {
      if (!x || !/Event$/.test(x["@type"] || "") || !/^\d{4}-\d\d-\d\d/.test(x.startDate || "")) continue;
      if (/Cancel/i.test(x.eventStatus || "")) continue;
      const loc = x.location || {}, dir = loc.address || {}, geo = loc.geo || {}, of = [].concat(x.offers || [])[0] || {};
      out.push({
        fecha: x.startDate.slice(0, 10),
        hora: (x.startDate.match(/T(\d\d:\d\d)/) || [])[1] || "",
        lugar: loc.name || "", ciudad: dir.addressLocality || "", pais: dir.addressCountry || "",
        lat: num(geo.latitude), lon: num(geo.longitude),
        link: of.url || x.url || "",
        agotado: /SoldOut/i.test(of.availability || "") ? 1 : 0,
        fuentes: ["pogo"],
      });
    }
  }
  return out;
}

// Agenda escrita a mano en una página (la oficial de Lucho Mellera):
//   "21 Nov." | "Neuquén - **Agotado**" | "21:00hs - Estadio Ruca Che" | Tickets | Mapa, con el año como título suelto
export function leerAgenda(html, hoy) {
  const texto = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<a\b[^>]*?href="([^"]*)"[^>]*>/g, "|@$1|")
    .replace(/<[^>]+>/g, "|")
    .replace(/&#0?38;|&amp;/g, "&").replace(/&nbsp;|&#160;/g, " ").replace(/&#8211;|&ndash;/g, "-");
  const t = texto.split("|").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  const esFecha = (s) => { const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?$/); return m && MES[m[2].toLowerCase()] ? [+m[1], MES[m[2].toLowerCase()]] : null; };
  const esAnio = (s) => /^20\d\d$/.test(s);
  let anio = +hoy.slice(0, 4), mesAnt = 0, conTitulo = false;
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (esAnio(t[i])) { anio = +t[i]; conTitulo = true; mesAnt = 0; continue; }
    const f = esFecha(t[i]);
    if (!f) continue;
    const [dia, mes] = f;
    if (!conTitulo && mesAnt && mes < mesAnt) anio++; // pasó de diciembre a enero sin título
    mesAnt = mes;
    const ev = { fecha: `${anio}-${dos(mes)}-${dos(dia)}`, hora: "", lugar: "", ciudad: "", pais: "", lat: null, lon: null, link: "", agotado: 0, fuentes: ["oficial"] };
    let ultimoLink = "";
    for (let j = i + 1; j < Math.min(t.length, i + 9); j++) {
      const s = t[j];
      if (esFecha(s) || esAnio(s)) break;
      if (s[0] === "@") { ultimoLink = s.slice(1); continue; }
      if (/agotad/i.test(s)) ev.agotado = 1;
      const h = s.match(/^(\d{1,2}):(\d\d)\s*hs\.?\s*-\s*(.+)$/i);
      if (h) { ev.hora = `${dos(h[1])}:${h[2]}`; ev.lugar = h[3].trim(); continue; }
      if (/^tickets?$|^entradas$/i.test(s)) { if (!ev.link) ev.link = ultimoLink; continue; }
      if (!ev.ciudad) ev.ciudad = s.split(/\s+-\s+/)[0].replace(/\*/g, "").trim();
    }
    if (ev.ciudad && ev.fecha >= hoy) out.push(ev);
  }
  return out;
}

// Ciudades de afuera donde suelen girar: la agenda oficial no trae coordenadas
const AFUERA = {
  montevideo: ["UY", -34.9, -56.16], "punta del este": ["UY", -34.96, -54.95], lima: ["PE", -12.05, -77.04],
  "santiago de chile": ["CL", -33.45, -70.67], santiago: ["CL", -33.45, -70.67], bogota: ["CO", 4.71, -74.07],
  medellin: ["CO", 6.25, -75.56], madrid: ["ES", 40.42, -3.7], barcelona: ["ES", 41.39, 2.17], valencia: ["ES", 39.47, -0.38],
  "ciudad de mexico": ["MX", 19.43, -99.13], cdmx: ["MX", 19.43, -99.13], monterrey: ["MX", 25.69, -100.32],
  guadalajara: ["MX", 20.66, -103.35], asuncion: ["PY", -25.28, -57.63], quito: ["EC", -0.18, -78.47],
  guayaquil: ["EC", -2.17, -79.92], "la paz": ["BO", -16.5, -68.15], "santa cruz de la sierra": ["BO", -17.78, -63.18],
  miami: ["US", 25.76, -80.19], "san jose": ["CR", 9.93, -84.08], "buenos aires": ["AR", -34.6, -58.38], caba: ["AR", -34.6, -58.38],
  "capital federal": ["AR", -34.6, -58.38],
};

// Le pone coordenadas a un evento que solo trae el nombre de la ciudad.
// loc = contenido de datos/localidades.json
export function ubicar(ev, loc) {
  if (ev.lat != null && ev.lon != null) return ev;
  const k = sinTildes(ev.ciudad);
  if (AFUERA[k]) { [ev.pais, ev.lat, ev.lon] = AFUERA[k]; return ev; }
  const cand = loc.localidades.filter((l) => sinTildes(l[0]) === k);
  if (cand.length) {
    const l = cand.find((c) => sinTildes(c[1]) === k) || cand[0]; // primero la que da nombre a su partido
    ev.pais = "AR"; ev.lat = l[3]; ev.lon = l[4];
  }
  return ev;
}

// ¿Dos eventos son la misma función?
export function mismo(a, b) {
  if (a.fecha !== b.fecha) return false;
  if (a.hora && b.hora && a.hora !== b.hora) return false;
  if (sinTildes(a.ciudad) === sinTildes(b.ciudad)) return true;
  return a.lat != null && b.lat != null && km(a, b) < 40;
}

// Junta las fuentes. Pogo pone el teatro exacto; la oficial manda en horario y agotado.
export function unir(pogo, oficial, loc) {
  const res = pogo.map((e) => ({ ...e }));
  for (const o of oficial) {
    ubicar(o, loc);
    const p = res.find((e) => mismo(e, o));
    if (!p) { res.push({ ...o }); continue; }
    if (o.hora) p.hora = o.hora;
    if (!p.lugar) p.lugar = o.lugar;
    if (!p.link) p.link = o.link;
    p.agotado = p.agotado || o.agotado ? 1 : 0;
    p.agotado = o.agotado; // la oficial sabe mejor
    p.fuentes = [...new Set([...p.fuentes, ...o.fuentes])];
  }
  for (const e of res) ubicar(e, loc);
  return res.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
}
