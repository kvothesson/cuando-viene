/* Cuándo viene: mapa propio dibujado por código, sin servicios externos.
   Uso: CuandoViene({ base: "../", fechas: [{fecha, lugar, ciudad, lat, lon, link}] }) */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const rad = (x) => (x * Math.PI) / 180;
  const deg = (x) => (x * 180) / Math.PI;
  // Mercator, en "grados": x = longitud, y crece hacia el sur
  const py = (lat) => -deg(Math.log(Math.tan(Math.PI / 4 + rad(Math.max(-85, Math.min(85, lat))) / 2)));
  const ilat = (y) => deg(2 * Math.atan(Math.exp(rad(-y))) - Math.PI / 2);
  const $ = (id) => document.getElementById(id);
  const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // true si a y b difieren en una sola letra (cambiada, de más o de menos)
  function casi(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, fallas = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++fallas > 1) return false;
      if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
    }
    return fallas + (a.length - i) + (b.length - j) <= 1;
  }
  function km(a, b) {
    const dLa = rad(b.lat - a.lat), dLo = rad(b.lon - a.lon);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  function destino(p, d, rumbo) {
    const s = d / 6371, t = rad(rumbo), f1 = rad(p.lat), l1 = rad(p.lon);
    const f2 = Math.asin(Math.sin(f1) * Math.cos(s) + Math.cos(f1) * Math.sin(s) * Math.cos(t));
    const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(s) * Math.cos(f1), Math.cos(s) - Math.sin(f1) * Math.sin(f2));
    return { lat: deg(f2), lon: deg(l2) };
  }
  function el(nombre, attrs, texto) {
    const e = document.createElementNS(NS, nombre);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (texto != null) e.textContent = texto;
    return e;
  }
  function html(nombre, clase, texto) {
    const e = document.createElement(nombre);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function guardar(v) { try { localStorage.setItem("cuandoviene", JSON.stringify(v)); } catch (e) {} }
  function leer() { try { return JSON.parse(localStorage.getItem("cuandoviene")); } catch (e) { return null; } }

  window.CuandoViene = function (cfg) {
    const base = cfg.base || "";
    const hoy = new Date().toLocaleDateString("sv");
    const ordenar = (l) => l.filter((f) => f.fecha >= hoy).sort((a, b) => (a.fecha + (a.hora || "")).localeCompare(b.fecha + (b.hora || "")));
    let fechas = ordenar(cfg.fechas || []), vapid = cfg.vapid || "";
    // Métricas propias y anónimas. En local no se mandan, salvo con ?metricas
    const mide = cfg.api && (!/^(localhost|127\.|\[::1\])/.test(location.hostname) || /[?&]metricas/.test(location.search));
    const medidos = new Set();
    function medir(ev, k, unaVez) {
      if (!mide || (unaVez && medidos.has(ev))) return;
      medidos.add(ev);
      try { fetch(cfg.api + "/evento", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: cfg.artista, ev, k: k || "" }) }).catch(() => {}); } catch (e) {}
    }
    medir("visita", "", true);
    const svg = $("mapa"), radio = $("radio"), kmv = $("kmv");
    const gMundo = el("g"), gTierra = el("g"), gSobre = el("g");
    svg.append(gMundo, gTierra, gSobre);

    const vista = { cx: -63.5, cy: 44.7, w: 30 };
    let upp = 1, yo = null, deptos = [], localidades = null, paisSel = "AR", mundo = [], verPendiente = "";
    const porPais = {}, selPais = $("pais");

    // ---------- vista ----------
    function tam() { const r = svg.getBoundingClientRect(); return { w: r.width || 600, h: r.height || 400, r }; }
    function aplicar() {
      const t = tam();
      vista.w = Math.min(400, Math.max(0.12, vista.w));
      const h = (vista.w * t.h) / t.w;
      upp = vista.w / t.w;
      svg.setAttribute("viewBox", `${vista.cx - vista.w / 2} ${vista.cy - h / 2} ${vista.w} ${h}`);
      svg.classList.toggle("cerca", vista.w < 14);
      pintarSobre();
    }
    function encuadrar(x0, y0, x1, y1, margen) {
      const t = tam();
      vista.cx = (x0 + x1) / 2; vista.cy = (y0 + y1) / 2;
      vista.w = Math.max(x1 - x0, ((y1 - y0) * t.w) / t.h) * (1 + margen);
      aplicar();
    }
    function verPais(cc) {
      if (cc === "AR") return encuadrar(-73.6, py(-21.7), -53.6, py(-55.1), 0.06);
      const p = mundo.find((x) => x.c === cc);
      if (!p) { verPendiente = cc; return; } // todavía no llegó el mapa del mundo
      verPendiente = "";
      encuadrar(p.b[0], py(p.b[3]), p.b[2], py(p.b[1]), 0.12);
    }
    const pais = () => verPais(paisSel);
    function encuadrarCirculo(p, r, margen) {
      const n = destino(p, r, 0), s = destino(p, r, 180), e = destino(p, r, 90), o = destino(p, r, 270);
      encuadrar(o.lon, py(n.lat), e.lon, py(s.lat), margen);
    }
    function aMapa(cx, cy) {
      const t = tam(), h = (vista.w * t.h) / t.w;
      return { x: vista.cx - vista.w / 2 + (cx - t.r.left) * upp, y: vista.cy - h / 2 + (cy - t.r.top) * upp };
    }
    function zoom(factor, cx, cy) {
      const t = tam();
      const p = cx == null ? { x: vista.cx, y: vista.cy } : aMapa(cx, cy);
      const antes = vista.w;
      vista.w = Math.min(400, Math.max(0.12, vista.w * factor));
      const f = vista.w / antes;
      vista.cx = p.x + (vista.cx - p.x) * f; vista.cy = p.y + (vista.cy - p.y) * f;
      aplicar();
    }

    // ---------- tierra ----------
    function camino(capa, escala) {
      let d = "";
      for (const it of capa) for (const r of it.r) {
        let lon = r[0], lat = r[1];
        d += `M${(lon / escala).toFixed(3)} ${py(lat / escala).toFixed(3)}`;
        for (let i = 2; i < r.length; i += 2) {
          lon += r[i]; lat += r[i + 1];
          d += `L${(lon / escala).toFixed(3)} ${py(lat / escala).toFixed(3)}`;
        }
        d += "Z";
      }
      return d;
    }
    fetch(base + "datos/mapa.json").then((r) => r.json()).then((m) => {
      const dp = camino(m.provincias, m.escala);
      gTierra.append(
        el("path", { d: dp, class: "tierra" }),
        el("path", { d: camino(m.departamentos, m.escala), class: "deptos" }),
        el("path", { d: dp, class: "provs" })
      );
      deptos = m.departamentos.map((d) => ({ n: d.n, x: d.c[0], y: py(d.c[1]) }));
      pintarSobre();
    });

    // El resto del mundo: contornos de países. Argentina va encima, con su detalle.
    fetch(base + "datos/mundo.json").then((r) => r.json()).then((m) => {
      gMundo.append(el("path", { d: camino(m.paises, m.escala), class: "mundo" }));
      mundo = m.paises.map((p) => {
        const anillos = p.r.map((r) => {
          let lon = r[0], lat = r[1];
          const a = [[lon / m.escala, lat / m.escala]];
          for (let i = 2; i < r.length; i += 2) { lon += r[i]; lat += r[i + 1]; a.push([lon / m.escala, lat / m.escala]); }
          return a;
        });
        const caja = [180, 90, -180, -90];
        for (const a of anillos) for (const [x, y] of a) { if (x < caja[0]) caja[0] = x; if (x > caja[2]) caja[2] = x; if (y < caja[1]) caja[1] = y; if (y > caja[3]) caja[3] = y; }
        return { c: p.c, b: p.b, caja, anillos };
      });
      if (verPendiente) verPais(verPendiente);
    }).catch(() => {});
    // ¿En qué país cae un punto del mapa?
    function paisEn(lat, lon) {
      for (const p of mundo) {
        if (!p.c || lon < p.caja[0] || lon > p.caja[2] || lat < p.caja[1] || lat > p.caja[3]) continue;
        for (const a of p.anillos) {
          let dentro = false;
          for (let i = 0, j = a.length - 1; i < a.length; j = i++)
            if ((a[i][1] > lat) !== (a[j][1] > lat) && lon < ((a[j][0] - a[i][0]) * (lat - a[i][1])) / (a[j][1] - a[i][1]) + a[i][0]) dentro = !dentro;
          if (dentro) return p.c;
        }
      }
      return lon > -74 && lon < -53 && lat > -56 && lat < -21 ? "AR" : "";
    }

    // ---------- lo que va encima: radio, nombres, fechas, vos ----------
    function pintarSobre() {
      gSobre.replaceChildren();
      const t = tam(), h = (vista.w * t.h) / t.w;
      const x0 = vista.cx - vista.w / 2, y0 = vista.cy - h / 2;
      const letra = 12 * upp;
      if (yo) {
        const pts = [];
        for (let a = 0; a < 360; a += 5) { const p = destino(yo, +radio.value, a); pts.push(p.lon.toFixed(3) + "," + py(p.lat).toFixed(3)); }
        gSobre.append(el("polygon", { points: pts.join(" "), class: "radio" }));
      }
      if (vista.w < 5) {
        const dentro = deptos.filter((d) => d.x > x0 && d.x < x0 + vista.w && d.y > y0 && d.y < y0 + h);
        const puestos = [], alto = letra * 1.1;
        if (dentro.length <= 90) for (const d of dentro) {
          // no encimar nombres: se saltea el que pisa a uno ya puesto
          const ancho = d.n.length * letra * 0.5;
          if (puestos.some((p) => Math.abs(p.x - d.x) < (p.a + ancho) / 2 && Math.abs(p.y - d.y) < alto)) continue;
          puestos.push({ x: d.x, y: d.y, a: ancho });
          gSobre.append(el("text", { x: d.x, y: d.y, class: "depto", "font-size": letra * 0.85 }, d.n));
        }
      }
      if (vista.w < 14 && paisSel !== "AR" && localidades) { // fuera de Argentina: nombres de ciudades, las más grandes primero
        const puestos = []; let n = 0;
        for (const l of localidades) {
          const x = l.lon, y = py(l.lat);
          if (x < x0 || x > x0 + vista.w || y < y0 || y > y0 + h) continue;
          const ancho = l.n.length * letra * 0.5;
          if (puestos.some((p) => Math.abs(p.x - x) < (p.a + ancho) / 2 && Math.abs(p.y - y) < letra * 1.2)) continue;
          puestos.push({ x, y, a: ancho });
          gSobre.append(el("text", { x, y, class: "depto", "font-size": letra * 0.85 }, l.n));
          if (++n >= 30) break;
        }
      }
      for (const f of fechas) {
        if (f.lat == null) continue;
        const [, m, d] = f.fecha.split("-");
        const a = el("a", { href: f.link || "#", target: "_blank", rel: "noopener", class: f.agotado ? "show agotado" : "show" });
        const x = f.lon, y = py(f.lat);
        a.append(
          el("circle", { cx: x, cy: y, r: 7 * upp, class: "pin" }),
          el("text", { x: x + 11 * upp, y: y + 4 * upp, "font-size": letra }, `${+d} ${MESES[m - 1]} · ${f.ciudad}`)
        );
        gSobre.append(a);
      }
      if (yo) gSobre.append(el("circle", { cx: yo.lon, cy: py(yo.lat), r: 6 * upp, class: "yo" }));
    }

    // ---------- lista de fechas ----------
    function pintarFechas() {
      const caja = $("fechas");
      caja.replaceChildren();
      if (!fechas.length) { caja.append(html("p", "nota", "Por ahora no hay fechas anunciadas.")); return; }
      const lim = +radio.value;
      for (const f of fechas) {
        const [, m, d] = f.fecha.split("-");
        const fila = html("div", "fecha");
        const dia = html("div", "dia");
        dia.append(html("b", "", String(+d)), html("small", "", MESES[m - 1]));
        const info = html("div");
        const meta = html("div", "meta", f.ciudad + (f.hora ? " · " + f.hora + " h" : ""));
        if (yo && f.lat != null) {
          const k = Math.round(km(yo, f));
          meta.append(" · ", html("span", k <= lim ? "cerca" : "lejos", k <= lim ? `a ${k} km de vos` : `a ${k} km`));
        }
        const lugar = html("div", "lugar", f.lugar || f.ciudad);
        if (f.agotado) lugar.append(" ", html("span", "sello", "Agotado"));
        info.append(lugar, meta);
        if (f.link) {
          const link = html("a", "", f.agotado ? "Ver igual →" : "Entradas →");
          link.href = f.link; link.target = "_blank"; link.rel = "noopener";
          link.addEventListener("click", () => medir("entradas", f.ciudad));
          info.append(link);
        }
        fila.append(dia, info);
        caja.append(fila);
      }
    }

    // ---------- tu punto ----------
    function ponerYo(lat, lon, nombre, sinEncuadrar, cc) {
      yo = { lat, lon, nombre: nombre || "", cc: cc || paisSel }; // siempre el centro de una localidad
      $("donde").textContent = nombre ? "Estás en " + nombre : "";
      guardar({ lat: yo.lat, lon: yo.lon, nombre: yo.nombre, cc: yo.cc, km: +radio.value });
      if (!sinEncuadrar) encuadrarRadio(); else pintarSobre();
      pintarFechas(); armarCalendario();
    }
    // ---------- calendario: una dirección con tu localidad y tu radio, nada se guarda ----------
    function armarCalendario() {
      const caja = $("calendario");
      if (!caja || !cfg.api) return;
      caja.hidden = !yo;
      if (!yo) return;
      const q = `lat=${yo.lat}&lon=${yo.lon}&km=${radio.value}&loc=${encodeURIComponent(yo.nombre)}`;
      const feed = cfg.api.replace(/^https?:/, "webcal:") + `/cal/${cfg.artista}.ics?${q}`;
      $("cal-google").href = "https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(feed);
      $("cal-otro").href = feed;
    }
    for (const id of ["cal-google", "cal-otro"]) if ($(id)) $(id).addEventListener("click", () => medir("calendario", id === "cal-google" ? "google" : "otro"));
    function encuadrarRadio() {
      if (!yo) return;
      encuadrarCirculo(yo, +radio.value, 0.25);
    }
    radio.addEventListener("input", () => { kmv.textContent = radio.value; pintarSobre(); pintarFechas(); armarCalendario(); });
    radio.addEventListener("change", () => { medir("radio", radio.value <= 30 ? "hasta 30" : radio.value <= 80 ? "31 a 80" : radio.value <= 200 ? "81 a 200" : "más de 200"); encuadrarRadio(); if (yo) guardar({ lat: yo.lat, lon: yo.lon, nombre: yo.nombre, cc: yo.cc, km: +radio.value }); });

    // ---------- mover el mapa ----------
    const dedos = new Map();
    let movido = 0, pellizco = 0;
    svg.addEventListener("pointerdown", (e) => {
      dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (dedos.size === 1) movido = 0;
      if (dedos.size === 2) { const [a, b] = [...dedos.values()]; pellizco = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    window.addEventListener("pointermove", (e) => {
      const p = dedos.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      movido += Math.abs(dx) + Math.abs(dy);
      if (dedos.size === 1) { vista.cx -= dx * upp; vista.cy -= dy * upp; aplicar(); }
      else if (dedos.size === 2) {
        const [a, b] = [...dedos.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pellizco > 0 && dist > 0) zoom(pellizco / dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pellizco = dist;
      }
    });
    function soltar(e) {
      if (!dedos.has(e.pointerId)) return;
      const eraUno = dedos.size === 1;
      dedos.delete(e.pointerId);
      if (e.type === "pointerup" && eraUno && movido < 8 && !(e.target.closest && e.target.closest("a"))) {
        const p = aMapa(e.clientX, e.clientY);
        elegirCercana(ilat(p.y), p.x, true);
      }
    }
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    svg.addEventListener("wheel", (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
    $("mas").onclick = () => zoom(0.6);
    $("menos").onclick = () => zoom(1 / 0.6);
    $("todo").onclick = pais;
    window.addEventListener("resize", aplicar);

    // ---------- buscador de localidades ----------
    const dir = $("dir"), lista = $("sugerencias");
    // Argentina llega hasta el barrio; el resto del mundo, ciudades de más de 15.000 habitantes.
    // Cada país es un archivo aparte: se baja solo el que hace falta.
    function cargarLocalidades() {
      const cc = paisSel;
      if (porPais[cc]) { localidades = porPais[cc]; return Promise.resolve(); }
      const p = cc === "AR"
        ? fetch(base + "datos/localidades.json").then((r) => r.json()).then((d) => d.localidades.map((l) => ({ n: l[0], dep: l[1], prov: d.provincias[l[2]], lat: l[3], lon: l[4], k: sinTildes(l[0]), cc })))
        : fetch(base + "datos/ciudades/" + cc + ".json").then((r) => r.json()).then((d) => d.map((l) => ({ n: l[0], dep: "", prov: l[1], lat: l[2], lon: l[3], k: sinTildes(l[0]), ks: (l[4] || []).map(sinTildes), cc })));
      return p.then((l) => { porPais[cc] = l; }, () => { porPais[cc] = []; }).then(() => { if (paisSel === cc) localidades = porPais[cc]; });
    }
    function cambiarPais(cc, mover) {
      paisSel = cc; localidades = null;
      if (selPais) selPais.value = cc;
      if (mover) verPais(cc);
      return cargarLocalidades().then(pintarSobre);
    }
    function sugerir() {
      const q = sinTildes(dir.value.trim());
      lista.replaceChildren();
      if (q.length < 2 || !localidades) return [];
      const empieza = [], contiene = [];
      const da = (l, fn) => fn(l.k) || (l.ks ? l.ks.some(fn) : false); // también por sus otros nombres
      for (const l of localidades) {
        if (da(l, (k) => k.startsWith(q))) empieza.push(l); else if (da(l, (k) => k.includes(q))) contiene.push(l);
        if (empieza.length >= 8) break;
      }
      let res = empieza.concat(contiene).slice(0, 8);
      if (!res.length) {
        // escribieron una dirección entera: se busca la localidad adentro del texto
        const limpio = " " + q.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
        res = localidades.filter((l) => l.k.length >= 4 && limpio.includes(" " + l.k + " "))
          .sort((a, b) => b.k.length - a.k.length).slice(0, 8);
        if (!res.length) {
          // error de tipeo: una letra de más, de menos o cambiada
          const palabras = limpio.trim().split(" ").filter((w) => w.length >= 4).concat(limpio.trim());
          res = localidades.filter((l) => palabras.some((w) => casi(w, l.k))).slice(0, 8);
        }
      }
      for (const l of res) {
        const b = html("button", "", l.n);
        b.type = "button";
        b.append(html("small", "", " " + [l.dep, l.prov].filter((x) => x && x !== l.n).join(", ")));
        b.onclick = () => elegir(l);
        lista.append(b);
      }
      if (!res.length) lista.append(html("p", "nota", paisSel === "AR" ? "No la encuentro. Escribí tu localidad o barrio, o tocá el mapa." : "No la encuentro. Probá con la ciudad más cercana o tocá el mapa."));
      return res;
    }
    function elegir(l, sinEncuadrar) { dir.value = l.n; lista.replaceChildren(); ponerYo(l.lat, l.lon, l.n, sinEncuadrar, l.cc); medir("localidad", l.n + ", " + (l.cc === "AR" ? l.prov || "AR" : l.cc)); }
    // Un punto cualquiera (toque en el mapa o GPS) se cambia por su localidad más cercana:
    // el punto exacto nunca se guarda ni sale del dispositivo.
    function elegirCercana(lat, lon, sinEncuadrar) {
      const cc = paisEn(lat, lon) || paisSel;
      if (cc !== paisSel) { paisSel = cc; localidades = null; if (selPais) selPais.value = cc; }
      return cargarLocalidades().then(() => {
        const p = { lat, lon };
        let mejor = null, dm = Infinity;
        for (const l of localidades) { const d = km(p, l); if (d < dm) { dm = d; mejor = l; } }
        if (mejor) elegir(mejor, sinEncuadrar);
      });
    }
    dir.addEventListener("focus", cargarLocalidades);
    dir.addEventListener("input", () => cargarLocalidades().then(sugerir));
    dir.addEventListener("keydown", (e) => { if (e.key === "Enter") cargarLocalidades().then(() => { const r = sugerir(); if (r[0]) elegir(r[0]); }); });
    $("ubicame").onclick = () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((p) => elegirCercana(p.coords.latitude, p.coords.longitude),() => { $("donde").textContent = "No pude leer tu ubicación. Buscá tu localidad o tocá el mapa."; });
    };

    // ---------- aviso en este dispositivo ----------
    function claveBytes(s) {
      const b = atob((s + "===".slice((s.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
      return Uint8Array.from(b, (c) => c.charCodeAt(0));
    }
    async function avisarAca() {
      const msg = $("msg");
      if (!yo) { msg.textContent = "Primero elegí tu localidad."; return; }
      if (!cfg.api || !vapid) { msg.textContent = "No pude conectar con el servicio de avisos. Probá en un rato."; return; }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        msg.textContent = "Este navegador no admite avisos. En iPhone, primero agregá la página a la pantalla de inicio. Si no, usá el calendario."; return;
      }
      try {
        if ((await Notification.requestPermission()) !== "granted") { msg.textContent = "Sin permiso de notificaciones no puedo avisarte acá. Podés usar el calendario."; return; }
        const reg = await navigator.serviceWorker.register(base + "sw.js");
        await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveBytes(vapid) }));
        const r = await fetch(cfg.api + "/push/alta", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sub: sub.toJSON(), artista: cfg.artista, lat: yo.lat, lon: yo.lon, km: +radio.value, loc: yo.nombre }) });
        if (!r.ok) throw new Error("alta " + r.status);
        msg.textContent = `Listo. Te aviso en este dispositivo cuando haya una fecha a menos de ${radio.value} km de ${yo.nombre}.`;
        $("suscribir").textContent = "Actualizar mi aviso";
        medir("aviso", yo.nombre);
      } catch (e) { msg.textContent = "No pude activar el aviso (" + ((e && e.message) || e) + "). Probá de nuevo o usá el calendario."; }
    }
    $("suscribir").onclick = avisarAca;

    // ---------- fechas al día, desde el robot ----------
    if (cfg.api) fetch(cfg.api + "/fechas/" + cfg.artista).then((r) => r.json()).then((d) => {
      if (!d || !Array.isArray(d.fechas)) return;
      fechas = ordenar(d.fechas); vapid = d.vapid || "";
      pintarSobre(); pintarFechas();
    }).catch(() => {});

    // ---------- arranque: país y lugar ----------
    // El país se adivina por el huso horario del navegador: no se consulta ningún servicio ni se rastrea a nadie.
    const previo = leer();
    const hayPrevio = previo && typeof previo.lat === "number";
    pintarFechas();
    Promise.all([
      fetch(base + "datos/paises.json").then((r) => r.json()).catch(() => ({ AR: "Argentina" })),
      hayPrevio && previo.cc ? null : fetch(base + "datos/husos.json").then((r) => r.json()).catch(() => null),
    ]).then(([nombres, husos]) => {
      if (selPais) {
        for (const [cc, n] of Object.entries(nombres)) { const o = document.createElement("option"); o.value = cc; o.textContent = n; selPais.append(o); }
        selPais.onchange = () => { dir.value = ""; lista.replaceChildren(); cambiarPais(selPais.value, true); };
      }
      let cc = "AR";
      if (hayPrevio && previo.cc) cc = previo.cc;
      else if (husos) { try { cc = husos[Intl.DateTimeFormat().resolvedOptions().timeZone] || "AR"; } catch (e) {} }
      if (!nombres[cc]) cc = "AR";
      if (hayPrevio) {
        if (previo.km) { radio.value = previo.km; kmv.textContent = radio.value; }
        paisSel = cc; if (selPais) selPais.value = cc;
        ponerYo(previo.lat, previo.lon, previo.nombre, false, cc);
        cargarLocalidades().then(pintarSobre);
      } else {
        cambiarPais((cfg.foco && cfg.foco.cc && nombres[cfg.foco.cc]) ? cfg.foco.cc : cc, !cfg.foco);
        if (cfg.foco) encuadrarCirculo(cfg.foco, 250, 0.2); // página de una ciudad: arranca mirando ahí
        armarCalendario();
      }
    });

    return { ponerYo, pais, cambiarPais, elegirPorNombre: (q, cc) => (cc && cc !== paisSel ? cambiarPais(cc, false) : cargarLocalidades()).then(() => { dir.value = q; const r = sugerir(); if (r[0]) elegir(r[0]); return r[0] || null; }) };
  };
})();
