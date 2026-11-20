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
        precio: num(of.price), moneda: of.priceCurrency || "", // precio "desde", cuando la fuente lo trae
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

// Formas de decirle a una ciudad que no figuran en ninguna base
const APODOS = { caba: "buenos aires", "capital federal": "buenos aires", "ciudad de buenos aires": "buenos aires", "ciudad autonoma de buenos aires": "buenos aires" };
// Terminaciones de dos letras que no dicen de qué país es un sitio
const SIN_PAIS = new Set(["CO", "FM", "TV", "IO", "ME", "AI", "LY", "GG", "TO", "CC", "WS", "NU", "EU"]);
function paisDelLink(link) {
  try {
    const t = new URL(link).hostname.split(".").pop().toUpperCase();
    return t.length === 2 && !SIN_PAIS.has(t) ? (t === "UK" ? "GB" : t) : "";
  } catch { return ""; }
}

// Índice de ciudades del mundo por nombre (y por sus otros nombres). Ya vienen de mayor a menor población.
// mundo = contenido de nube/ciudades.json: { husos: [...], ciudades: [[nombre, país, lat, lon, huso, población, otros?]] }
let indice = null;
function ciudadesPorNombre(mundo) {
  if (indice) return indice;
  indice = new Map();
  for (const c of mundo.ciudades) for (const n of [c[0], ...(c[6] || [])]) {
    const k = sinTildes(n), l = indice.get(k);
    if (l) { if (!l.includes(c)) l.push(c); } else indice.set(k, [c]);
  }
  return indice;
}
function husoCercano(p, mundo) {
  let mejor = null, dm = Infinity;
  for (const c of mundo.ciudades) {
    const d = (c[2] - p.lat) ** 2 + ((c[3] - p.lon) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
    if (d < dm) { dm = d; mejor = c; }
  }
  return mejor ? mundo.husos[mejor[4]] : "";
}

// Le pone coordenadas, país y huso horario a un evento que solo trae el nombre de la ciudad.
// loc = datos/localidades.json (Argentina, hasta el pueblo) · mundo = nube/ciudades.json · base = país del artista
// Cuando el nombre se repite en varios países decide, en orden: el país del link de entradas,
// el país del artista y, si no, la ciudad más grande.
export function ubicar(ev, loc, mundo, base) {
  if (ev.lat != null && ev.lon != null) {
    if (!ev.tz && mundo) ev.tz = husoCercano(ev, mundo);
    return ev;
  }
  let k = sinTildes(ev.ciudad);
  k = APODOS[k] || k;
  const cand = (mundo && ciudadesPorNombre(mundo).get(k)) || [];
  const pista = paisDelLink(ev.link);
  const pueblo = () => {
    const l = loc.localidades.filter((x) => sinTildes(x[0]) === k);
    return l.find((x) => sinTildes(x[1]) === k) || l[0]; // primero la que da nombre a su partido
  };
  let c = pista && cand.find((x) => x[1] === pista);
  if (!c && (pista === "AR" || (!pista && base === "AR")) && !cand.some((x) => x[1] === "AR")) {
    const l = pueblo();
    if (l) { ev.pais = "AR"; ev.lat = l[3]; ev.lon = l[4]; ev.tz = "America/Argentina/Buenos_Aires"; return ev; }
  }
  const porLink = !!c;
  c = c || (base && cand.find((x) => x[1] === base)) || cand[0];
  if (c) {
    ev.pais = c[1]; ev.lat = c[2]; ev.lon = c[3]; ev.tz = mundo.husos[c[4]];
    // Sin link que lo confirme y con otra ciudad parecida en tamaño en otro país: unir() lo revisa con la gira
    if (!porLink && cand.some((x) => x[1] !== c[1] && x[5] * 8 >= c[5])) ev._otras = cand;
    return ev;
  }
  const l = pueblo();
  if (l) { ev.pais = "AR"; ev.lat = l[3]; ev.lon = l[4]; ev.tz = "America/Argentina/Buenos_Aires"; }
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
export function unir(pogo, oficial, loc, mundo, base) {
  const res = pogo.map((e) => ({ ...e }));
  for (const o of oficial) {
    ubicar(o, loc, mundo, base);
    const p = res.find((e) => mismo(e, o));
    if (!p) { res.push({ ...o }); continue; }
    if (o.hora) p.hora = o.hora;
    if (!p.lugar) p.lugar = o.lugar;
    if (!p.link) p.link = o.link;
    p.agotado = p.agotado || o.agotado ? 1 : 0;
    p.agotado = o.agotado; // la oficial sabe mejor
    p.fuentes = [...new Set([...p.fuentes, ...o.fuentes])];
  }
  for (const e of res) ubicar(e, loc, mundo, base);
  // Nombre repetido en varios países (Valencia, Córdoba): gana el país donde está girando esos días
  const dia = (e) => Date.parse(e.fecha + "T12:00:00Z") / 86400e3;
  for (const e of res) {
    if (!e._otras) continue;
    const vecinas = res.filter((x) => x !== e && !x._otras && x.pais && Math.abs(dia(x) - dia(e)) <= 10 && e._otras.some((c) => c[1] === x.pais))
      .sort((a, b) => Math.abs(dia(a) - dia(e)) - Math.abs(dia(b) - dia(e)));
    if (vecinas[0] && vecinas[0].pais !== e.pais) {
      const c = e._otras.find((x) => x[1] === vecinas[0].pais);
      e.pais = c[1]; e.lat = c[2]; e.lon = c[3]; e.tz = mundo.husos[c[4]];
    }
  }
  for (const e of res) delete e._otras;
  return res.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
}
