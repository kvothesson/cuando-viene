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
    const svg = $("mapa"), radio = $("radio"), kmn = $("kmn");
    const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const ponerKm = () => { kmn.value = radio.value; radio.setAttribute("aria-valuetext", radio.value + " kilómetros"); };
    const gMundo = el("g"), gTierra = el("g"), gSobre = el("g");
    svg.append(gMundo, gTierra, gSobre);

    const vista = { cx: -63.5, cy: 44.7, w: 30 };
    // Lo último que elegiste (país, ciudad, radio) queda guardado en tu navegador y vale en todas las páginas
    function recordar() { guardar(Object.assign(yo ? { lat: yo.lat, lon: yo.lon, nombre: yo.nombre } : {}, { cc: yo ? yo.cc : paisSel, km: +radio.value })); }
    let upp = 1, yo = null, deptos = [], localidades = null, paisSel = "AR", mundo = [], verPendiente = "";
    const porPais = {}, selPais = $("pais");
    let grandes = null, nombresPais = {};
    const setGrandes = {}; // por país, los nombres de sus ciudades grandes

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
      if (yo) gSobre.append(el("circle", { cx: yo.lon, cy: py(yo.lat), r: 6 * upp, class: "yo" }));
      // primero las lejanas y al final las que entran en tu radio, así quedan arriba de todo
      const enRadio = (f) => !!yo && f.lat != null && km(yo, f) <= +radio.value;
      for (const f of fechas.slice().sort((a, b) => enRadio(a) - enRadio(b))) {
        if (f.lat == null) continue;
        const [, m, d] = f.fecha.split("-");
        const a = el("a", { href: f.link || "#", target: "_blank", rel: "noopener", class: "show" + (f.agotado ? " agotado" : "") + (enRadio(f) ? " dentro" : "") });
        const x = f.lon, y = py(f.lat);
        a.append(
          el("circle", { cx: x, cy: y, r: 7 * upp, class: "pin" }),
          el("text", { x: x + 11 * upp, y: y + 4 * upp, "font-size": letra }, `${+d} ${MESES[m - 1]} · ${f.ciudad}`)
        );
        gSobre.append(a);
      }
    }

    // ---------- lista de fechas ----------
    function pintarFechas() {
      const caja = $("fechas");
      caja.replaceChildren();
      if (!fechas.length) { caja.append(html("p", "nota", "Por ahora no hay fechas anunciadas.")); return; }
      const lim = +radio.value;
      // con un lugar elegido, primero las que entran en tu radio
      const cerca = (f) => (yo && f.lat != null && km(yo, f) <= lim ? 0 : 1);
      const orden = yo ? fechas.map((f, i) => [cerca(f), i, f]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]) : fechas;
      const cuantas = orden.filter((f) => cerca(f) === 0).length;
      const donde = $("donde");
      donde.textContent = !yo ? "" : cuantas ? `· ${cuantas} a menos de ${lim} km de ${yo.nombre}` : `· ninguna a menos de ${lim} km de ${yo.nombre}`;
      donde.className = cuantas ? "hay" : "nohay";
      for (const f of orden) {
        const [, m, d] = f.fecha.split("-");
        const fila = html("div", cerca(f) === 0 ? "fecha cercana" : "fecha");
        fila.setAttribute("role", "listitem");
        const irA = () => {
          encuadrarCirculo(f, 45, 0.2); // el mapa va a donde es la función
          // y se ven los nombres de las ciudades de ese país
          const pc = f.pais || paisEn(f.lat, f.lon);
          if (pc && pc !== paisSel && !yo) { paisSel = pc; localidades = null; if (selPais) selPais.value = pc; cargarLocalidades().then(pintarSobre); }
        };
        if (f.lat != null) fila.addEventListener("click", (e) => { if (!e.target.closest("a,button")) irA(); });
        const diaLargo = `${+d} de ${MESES_LARGO[m - 1]} de ${f.fecha.slice(0, 4)}`;
        const dia = html("time", "dia");
        dia.dateTime = f.fecha;
        const dN = html("b", "", String(+d)), dM = html("small", "", MESES[m - 1]);
        dN.setAttribute("aria-hidden", "true"); dM.setAttribute("aria-hidden", "true");
        dia.append(dN, dM, html("span", "oculto", diaLargo));
        const info = html("div");
        const desde = f.precio && !f.agotado ? " · desde " + (!f.moneda || f.moneda === "ARS" ? "$ " : "") + Math.round(f.precio).toLocaleString("es-AR") + (f.moneda && f.moneda !== "ARS" ? " " + f.moneda : "") : "";
        const meta = html("div", "meta", f.ciudad + (f.hora ? " · " + f.hora + " h" : "") + desde);
        if (yo && f.lat != null) {
          const k = Math.round(km(yo, f));
          meta.append(" · ", html("span", k <= lim ? "cerca" : "lejos", k <= lim ? `a ${k} km de vos` : `a ${k} km`));
        }
        const lugar = html("div", "lugar", f.lugar || f.ciudad);
        if (f.agotado) lugar.append(" ", html("span", "sello", "Agotado"));
        const acciones = html("div", "acciones");
        info.append(lugar, meta, acciones);
        if (f.link) {
          const link = html("a", "", f.agotado ? "Ver igual →" : "Entradas →");
          link.href = f.link; link.target = "_blank"; link.rel = "noopener";
          link.setAttribute("aria-label", `${f.agotado ? "Ver la venta, figura agotado" : "Entradas"}: ${f.ciudad}, ${diaLargo}. Se abre en otra pestaña`);
          link.addEventListener("click", () => medir("entradas", f.ciudad));
          acciones.append(link);
        }
        if (f.lat != null) {
          const vm = html("button", "vermapa", "Ver en el mapa");
          vm.type = "button";
          vm.setAttribute("aria-label", `Ver ${f.ciudad} en el mapa`);
          vm.addEventListener("click", irA);
          acciones.append(vm);
        }
        fila.append(dia, info);
        caja.append(fila);
      }
    }

    // ---------- tu punto ----------
    function ponerYo(lat, lon, nombre, sinEncuadrar, cc) {
      yo = { lat, lon, nombre: nombre || "", cc: cc || paisSel }; // siempre el centro de una localidad
      recordar();
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
    radio.addEventListener("input", () => { ponerKm(); pintarSobre(); pintarFechas(); armarCalendario(); });
    radio.addEventListener("change", () => { medir("radio", radio.value <= 30 ? "hasta 30" : radio.value <= 80 ? "31 a 80" : radio.value <= 200 ? "81 a 200" : "más de 200"); encuadrarRadio(); recordar(); });

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
    // La rueda sola baja la página; con Ctrl (o el gesto de pellizco del panel táctil) acerca el mapa
    svg.addEventListener("wheel", (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
    $("mas").onclick = () => zoom(0.6);
    $("menos").onclick = () => zoom(1 / 0.6);
    $("todo").onclick = pais;
    window.addEventListener("resize", aplicar);

    // ---------- buscador de localidades ----------
    const dir = $("dir"), lista = $("sugerencias");
    let opciones = [], activa = -1;
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
      // Orden: coincidencia exacta, después la que empieza igual, después la que lo contiene.
      // A igual coincidencia, primero las ciudades grandes. Las de otros países suben solo si coinciden bien.
      const da = (l, fn) => fn(l.k) || (l.ks ? l.ks.some(fn) : false); // también por sus otros nombres
      const tipo = (l) => (l.k === q || (l.ks && l.ks.includes(q)) ? 3 : da(l, (k) => k.startsWith(q)) ? 2 : da(l, (k) => k.includes(q)) ? 1 : 0);
      const esGrande = (l) => !!(setGrandes[l.cc] && setGrandes[l.cc].has(l.k));
      const cand = [];
      for (const l of localidades) { const t = tipo(l); if (t) cand.push([t * 10 + (esGrande(l) ? 3 : 1), l]); }
      if (grandes) for (const l of grandes) {
        if (l.cc === paisSel) continue;
        const t = q.length >= 5 ? tipo(l) : tipo({ k: l.k }); // con pocas letras, solo por su nombre principal
        if (t > 1 || (t === 1 && q.length >= 4)) cand.push([t * 10 + (t === 3 ? 2 : 0.5), l]);
      }
      let res = cand.sort((a, b) => b[0] - a[0]).slice(0, 8).map((x) => x[1]);
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
        b.type = "button"; b.tabIndex = -1; b.id = "sug-" + lista.children.length;
        b.setAttribute("role", "option"); b.setAttribute("aria-selected", "false");
        b.append(html("small", "", " " + [l.dep, l.prov, l.cc !== paisSel ? nombresPais[l.cc] : ""].filter((x) => x && x !== l.n).join(", ")));
        b.onclick = () => elegir(l);
        lista.append(b);
      }
      opciones = res; activa = -1;
      dir.setAttribute("aria-expanded", res.length ? "true" : "false");
      dir.removeAttribute("aria-activedescendant");
      $("sug-estado").textContent = res.length ? `${res.length} ${res.length === 1 ? "sugerencia" : "sugerencias"}. Flechas para recorrer, Enter para elegir.` : "Sin sugerencias.";
      if (!res.length) lista.append(html("p", "nota", paisSel === "AR" ? "No la encuentro. Escribí tu localidad o barrio, o tocá el mapa." : "No la encuentro. Probá con la ciudad grande más cercana o tocá el mapa."));
      return res;
    }
    function elegir(l, sinEncuadrar) {
      if (l.cc && l.cc !== paisSel) { paisSel = l.cc; localidades = null; if (selPais) selPais.value = l.cc; cargarLocalidades().then(pintarSobre); } // ciudad de otro país: el país cambia solo
      dir.value = l.n; lista.replaceChildren(); opciones = []; activa = -1; dir.setAttribute("aria-expanded", "false"); dir.removeAttribute("aria-activedescendant"); ponerYo(l.lat, l.lon, l.n, sinEncuadrar, l.cc); medir("localidad", l.n + ", " + (l.cc === "AR" ? l.prov || "AR" : l.cc)); }
    // Un toque en el mapa se cambia por la ciudad o localidad más cercana:
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
    function cargarGrandes() {
      if (grandes) return Promise.resolve();
      return fetch(base + "datos/grandes.json").then((r) => r.json()).then((d) => {
        grandes = d.map((l) => ({ n: l[0], dep: "", prov: "", cc: l[1], lat: l[2], lon: l[3], k: sinTildes(l[0]), ks: (l[4] || []).map(sinTildes) }));
        for (const l of grandes) (setGrandes[l.cc] = setGrandes[l.cc] || new Set()).add(l.k);
      }).catch(() => { grandes = []; });
    }
    const todo = () => Promise.all([cargarLocalidades(), cargarGrandes()]);
    dir.addEventListener("focus", todo);
    dir.addEventListener("input", () => { cargarLocalidades().then(sugerir); if (!grandes) cargarGrandes().then(sugerir); });
    function cerrarLista() { lista.replaceChildren(); opciones = []; activa = -1; dir.setAttribute("aria-expanded", "false"); dir.removeAttribute("aria-activedescendant"); }
    function marcar(i) {
      const bs = lista.querySelectorAll('[role="option"]');
      if (!bs.length) return;
      activa = (i + bs.length) % bs.length;
      bs.forEach((b, k) => b.setAttribute("aria-selected", k === activa ? "true" : "false"));
      dir.setAttribute("aria-activedescendant", bs[activa].id);
      bs[activa].scrollIntoView({ block: "nearest" });
    }
    dir.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (opciones.length) marcar(activa + 1); else todo().then(sugerir); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (opciones.length) marcar(activa - 1); }
      else if (e.key === "Escape") cerrarLista();
      else if (e.key === "Enter") {
        if (activa >= 0 && opciones[activa]) elegir(opciones[activa]);
        else todo().then(() => { const r = sugerir(); if (r[0]) elegir(r[0]); });
      }
    });
    document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".busca")) cerrarLista(); });

    // ---------- aviso en este dispositivo ----------
    function claveBytes(s) {
      const b = atob((s + "===".slice((s.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
      return Uint8Array.from(b, (c) => c.charCodeAt(0));
    }
    async function avisarAca() {
      const msg = $("msg");
      if (!yo) { msg.textContent = "Primero elegí tu ciudad en el buscador de arriba."; dir.focus(); return; }
      if (!cfg.api || !vapid) { msg.textContent = "No pude conectar con el servicio de avisos. Probá en un rato."; return; }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        msg.textContent = "Este navegador no admite avisos. En iPhone, primero agregá la página a la pantalla de inicio."; return;
      }
      try {
        if ((await Notification.requestPermission()) !== "granted") { msg.textContent = "Sin permiso de notificaciones no puedo avisarte acá."; return; }
        const reg = await navigator.serviceWorker.register(base + "sw.js");
        await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveBytes(vapid) }));
        const r = await fetch(cfg.api + "/push/alta", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sub: sub.toJSON(), artista: cfg.artista, lat: yo.lat, lon: yo.lon, km: +radio.value, loc: yo.nombre }) });
        if (!r.ok) throw new Error("alta " + r.status);
        msg.textContent = `Listo. Te llega una notificación en ${aparato} cuando haya una fecha a menos de ${radio.value} km de ${yo.nombre}. Si cambiás la ciudad o el radio, tocá el botón de nuevo.`;
        try { localStorage.setItem("cuandoviene-aviso-" + cfg.artista, "1"); } catch (e) {}
        estadoAviso(true);
        medir("aviso", yo.nombre);
      } catch (e) { msg.textContent = "No pude activar el aviso (" + ((e && e.message) || e) + "). Probá de nuevo en un rato."; }
    }
    $("suscribir").onclick = avisarAca;
    // Por Telegram: se pide un enlace de un solo uso y se abre el chat con el bot
    if ($("telegram")) $("telegram").onclick = async () => {
      const msg = $("msg");
      if (!yo) { msg.textContent = "Primero elegí tu ciudad en el buscador de arriba."; dir.focus(); return; }
      msg.textContent = "Abriendo Telegram…";
      try {
        const r = await fetch(cfg.api + "/telegram/pedido", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artista: cfg.artista, lat: yo.lat, lon: yo.lon, km: +radio.value, loc: yo.nombre }) });
        const d = await r.json();
        if (!r.ok || !d.link) throw new Error("pedido " + r.status);
        medir("telegram", yo.nombre);
        // En el celular se abre la app. En la compu esa página solo sabe abrir la app de escritorio,
        // así que se ofrecen las tres salidas: la app, Telegram Web o pegarle el código al bot.
        const codigo = d.link.split("start=")[1], bot = d.link.split("t.me/")[1].split("?")[0];
        const web = "https://web.telegram.org/k/#?tgaddr=" + encodeURIComponent(`tg://resolve?domain=${bot}&start=${codigo}`);
        const enlace = (texto, href) => { const a = html("a", "", texto); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; };
        const celu = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (celu) { // se abre la app sola
          msg.replaceChildren("Se abre Telegram: tocá “Iniciar” y listo. ", enlace("Abrir de nuevo", d.link));
          location.href = d.link;
        } else { // en la compu: dos botones, según cómo uses Telegram
          const fila = html("span", "enlaces");
          fila.append(enlace("Abrir Telegram Web", web), enlace("Tengo la app instalada", d.link));
          msg.replaceChildren("Último paso: abrí Telegram y tocá “Iniciar”.", fila);
          fila.firstChild.focus();
        }
      } catch (e) { msg.textContent = "No pude armar el enlace de Telegram. Probá de nuevo en un rato."; }
    };
    // ¿Este dispositivo ya está anotado? Entonces se puede actualizar o dar de baja.
    // Cada botón dice por dónde llega el aviso: este aparato, o Telegram
    const aparato = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "este celular" : "esta compu";
    function estadoAviso(on) {
      const b = $("suscribir"), baja = $("baja");
      b.textContent = on ? "✓ Activo en " + aparato : "Avisame en " + aparato;
      b.setAttribute("aria-label", on ? `El aviso está activo en ${aparato}. Tocá para actualizar la ciudad y el radio` : `Avisame con una notificación en ${aparato}`);
      if (baja) { baja.hidden = !on; baja.textContent = "Dejar de avisarme en " + aparato; }
    }
    estadoAviso(false);
    async function miCasilla() {
      try { const reg = await navigator.serviceWorker.getRegistration(new URL(base, location.href).href); return reg ? await reg.pushManager.getSubscription() : null; } catch (e) { return null; }
    }
    let anotado = false;
    try { anotado = localStorage.getItem("cuandoviene-aviso-" + cfg.artista) === "1"; } catch (e) {}
    if (anotado && "serviceWorker" in navigator) miCasilla().then((s) => { if (s) estadoAviso(true); });
    if ($("baja")) $("baja").onclick = async () => {
      const s = await miCasilla();
      if (s && cfg.api) await fetch(cfg.api + "/push/baja", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: s.endpoint, artista: cfg.artista }) }).catch(() => {});
      try { localStorage.removeItem("cuandoviene-aviso-" + cfg.artista); } catch (e) {}
      estadoAviso(false);
      $("msg").textContent = "Listo. Ya no te aviso en " + aparato + ".";
      $("suscribir").focus();
    };

    // ---------- radio: botones, número escrito o barra ----------
    const acotar = (v) => Math.min(500, Math.max(10, Math.round(v) || 10));
    function fijarKm(v) { radio.value = acotar(v); radio.dispatchEvent(new Event("input")); radio.dispatchEvent(new Event("change")); }
    // pasos más largos a medida que el radio crece, así no hay que tocar cien veces
    const salto = (v, sube) => { const p = (sube ? v : v - 1) < 50 ? 5 : (sube ? v : v - 1) < 100 ? 10 : (sube ? v : v - 1) < 250 ? 25 : 50; return sube ? Math.floor(v / p) * p + p : Math.ceil(v / p) * p - p; };
    function boton(id, sube) {
      const b = $(id); if (!b) return;
      let t = null, r = null;
      const uno = () => fijarKm(salto(+radio.value, sube));
      const soltar = () => { clearTimeout(t); clearInterval(r); t = r = null; };
      b.addEventListener("click", (e) => { if (e.detail === 0) uno(); }); // teclado y lectores de pantalla
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.focus(); uno(); t = setTimeout(() => { r = setInterval(uno, 110); }, 450); }); // mantener apretado repite
      ["pointerup", "pointerleave", "pointercancel", "blur"].forEach((ev) => b.addEventListener(ev, soltar));
    }
    boton("km-menos", false); boton("km-mas", true);
    kmn.addEventListener("change", () => fijarKm(+kmn.value));
    kmn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fijarKm(+kmn.value); kmn.blur(); } });

    // ---------- mapa con teclado ----------
    svg.addEventListener("keydown", (e) => {
      const paso = vista.w * 0.12;
      if (e.key === "ArrowLeft") vista.cx -= paso; else if (e.key === "ArrowRight") vista.cx += paso;
      else if (e.key === "ArrowUp") vista.cy -= paso; else if (e.key === "ArrowDown") vista.cy += paso;
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); return zoom(0.6); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); return zoom(1 / 0.6); }
      else if (e.key === "Home" || e.key === "0") { e.preventDefault(); return pais(); }
      else return;
      e.preventDefault(); aplicar();
    });

    // ---------- fechas al día, desde el robot ----------
    if (cfg.api) fetch(cfg.api + "/fechas/" + cfg.artista).then((r) => r.json()).then((d) => {
      if (!d || !Array.isArray(d.fechas)) return;
      fechas = ordenar(d.fechas); vapid = d.vapid || "";
      if (d.telegram && $("telegram")) $("telegram").hidden = false;
      pintarSobre(); pintarFechas();
    }).catch(() => {});

    // ---------- arranque: país y lugar ----------
    // Manda la página: la de una ciudad o un país arranca parada ahí y lo deja elegido.
    // Si no, vale lo último que elegiste. Y si es tu primera vez, el país se adivina por el
    // huso horario del navegador: no se consulta ningún servicio ni se rastrea a nadie.
    const previo = leer() || {};
    if (previo.km) radio.value = previo.km;
    ponerKm();
    pintarFechas();
    Promise.all([
      fetch(base + "datos/paises.json").then((r) => r.json()).catch(() => ({ AR: "Argentina" })),
      previo.cc ? null : fetch(base + "datos/husos.json").then((r) => r.json()).catch(() => null),
    ]).then(([nombres, husos]) => {
      nombresPais = nombres;
      if (selPais) {
        for (const [cc, n] of Object.entries(nombres)) { const o = document.createElement("option"); o.value = cc; o.textContent = n; selPais.append(o); }
        selPais.onchange = () => {
          dir.value = ""; lista.replaceChildren();
          if (yo && yo.cc !== selPais.value) { yo = null; $("donde").textContent = ""; pintarFechas(); }
          cambiarPais(selPais.value, true).then(recordar);
        };
      }
      let cc = previo.cc || "AR";
      if (!previo.cc && husos) { try { cc = husos[Intl.DateTimeFormat().resolvedOptions().timeZone] || "AR"; } catch (e) {} }
      if (!nombres[cc]) cc = "AR";
      const f = cfg.foco || {}, fcc = f.cc && nombres[f.cc] ? f.cc : "";
      const tengo = typeof previo.lat === "number";
      const elegir0 = (lat, lon, nombre, pais, sinEncuadrar) => {
        paisSel = pais; if (selPais) selPais.value = pais;
        ponerYo(lat, lon, nombre, sinEncuadrar, pais); dir.value = nombre || "";
        cargarLocalidades().then(pintarSobre);
      };
      if (typeof f.lat === "number" && f.nombre) elegir0(f.lat, f.lon, f.nombre, fcc || cc);           // página de una ciudad
      else if (fcc) {                                                                               // página de un país
        if (tengo && previo.cc === fcc) { elegir0(previo.lat, previo.lon, previo.nombre, fcc, true); verPais(fcc); }
        else cambiarPais(fcc, true).then(recordar);
      }
      else if (tengo) elegir0(previo.lat, previo.lon, previo.nombre, cc);                             // lo último que elegiste
      else cambiarPais(cc, true);
      armarCalendario();
    });

    return { ponerYo, pais, cambiarPais, elegirPorNombre: (q, cc) => (cc && cc !== paisSel ? cambiarPais(cc, false) : cargarLocalidades()).then(() => { dir.value = q; const r = sugerir(); if (r[0]) elegir(r[0]); return r[0] || null; }) };
  };
})();
