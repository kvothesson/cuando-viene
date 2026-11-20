"""Arma las páginas de Cuándo viene con las fechas ya escritas en el HTML (para Google).

Lee artistas.json, le pide las fechas vigentes al robot y escribe:
  <slug>/index.html   una página por artista, desde plantilla.html
  index.html          la portada con todos los artistas
  sitemap.xml         direcciones para sumar al sitemap de kvothesson.com

Uso: python herramientas/armar_paginas.py
"""
import hashlib
import html
import json
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
API = "https://cuando-viene.kvothesson.workers.dev"
SITIO = "https://kvothesson.com/cuando-viene/"
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
PAISES = {"AR": "Argentina", "UY": "Uruguay", "CL": "Chile", "PE": "Perú", "CO": "Colombia", "ES": "España", "MX": "México",
          "PY": "Paraguay", "EC": "Ecuador", "BO": "Bolivia", "US": "Estados Unidos", "CR": "Costa Rica"}
# Cómo se le dice a cada cosa según el tipo de artista
TIPOS = {
    "comediante": {"una_fecha": "una función", "evento": "ComedyEvent", "quien": "Person"},
    "banda": {"una_fecha": "un recital", "evento": "MusicEvent", "quien": "MusicGroup"},
    "musico": {"una_fecha": "un recital", "evento": "MusicEvent", "quien": "Person"},
}
e = html.escape


def pedir(slug):
    req = urllib.request.Request(f"{API}/fechas/{slug}", headers={"User-Agent": "cuando-viene-armador/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def dia_mes(f, largo=False):
    a, m, d = f["fecha"].split("-")
    return f"{int(d)} de {MESES_LARGO[int(m) - 1]}" if largo else f"{int(d)} {MESES[int(m) - 1]}"


def fechas_html(fechas):
    if not fechas:
        return '<p class="nota">Por ahora no hay fechas anunciadas.</p>'
    out = []
    for f in fechas:
        a, m, d = f["fecha"].split("-")
        sello = ' <span class="sello">Agotado</span>' if f["agotado"] else ""
        hora = f" · {f['hora']} h" if f.get("hora") else ""
        link = f'<a href="{e(f["link"])}" target="_blank" rel="noopener">{"Ver igual" if f["agotado"] else "Entradas"} →</a>' if f.get("link") else ""
        out.append(f'<div class="fecha"><div class="dia"><b>{int(d)}</b><small>{MESES[int(m) - 1]}</small></div>'
                   f'<div><div class="lugar">{e(f.get("lugar") or f["ciudad"])}{sello}</div>'
                   f'<div class="meta">{e(f["ciudad"])}{hora}</div>{link}</div></div>')
    return "".join(out)


def resumen_html(a, fechas, anio_hoy):
    n = a["nombre"]
    if not fechas:
        return f"<p>{e(n)} no tiene fechas anunciadas por ahora. Dejá el aviso activado y te enterás apenas publique una.</p>"

    def lista(fs):
        partes = []
        for f in fs:
            anio = f" de {f['fecha'][:4]}" if int(f["fecha"][:4]) != anio_hoy else ""
            partes.append(f"{e(f['ciudad'])} ({dia_mes(f, True)}{anio}{', agotado' if f['agotado'] else ''})")
        return "; ".join(partes)

    ar = [f for f in fechas if f.get("pais") == "AR"]
    afuera = [f for f in fechas if f.get("pais") != "AR"]
    p = [f"<p>{e(n)} tiene {len(fechas)} {'fecha anunciada' if len(fechas) == 1 else 'fechas anunciadas'}"
         + (f" con {e(a['show'])}" if a.get("show") else "") + ".</p>"]
    if ar:
        p.append(f"<p><strong>En Argentina:</strong> {lista(ar)}.</p>")
    else:
        p.append("<p>En este momento no tiene fechas en Argentina.</p>")
    if afuera:
        paises = sorted({PAISES.get(f.get("pais"), "") for f in afuera} - {""})
        p.append(f"<p><strong>Fuera del país{' (' + ', '.join(paises) + ')' if paises else ''}:</strong> {lista(afuera)}.</p>")
    return "".join(p)


def jsonld(a, fechas, t):
    eventos = []
    for f in fechas:
        ini = f["fecha"] + (f"T{f['hora']}:00-03:00" if f.get("hora") and f.get("pais") == "AR" else "")
        ev = {
            "@context": "https://schema.org", "@type": t["evento"],
            "name": f"{a['nombre']} en {f['ciudad']}", "startDate": ini,
            "eventStatus": "https://schema.org/EventScheduled",
            "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
            "location": {"@type": "Place", "name": f.get("lugar") or f["ciudad"],
                         "address": {"@type": "PostalAddress", "addressLocality": f["ciudad"], "addressCountry": f.get("pais") or ""}},
            "performer": {"@type": t["quien"], "name": a["nombre"]},
        }
        if f.get("link"):
            ev["offers"] = {"@type": "Offer", "url": f["link"],
                            "availability": "https://schema.org/SoldOut" if f["agotado"] else "https://schema.org/InStock"}
        eventos.append(ev)
    return json.dumps(eventos, ensure_ascii=False).replace("</", "<\\/")


def pagina(a, plantilla, version):
    d = pedir(a["slug"])
    fechas = d["fechas"]
    t = TIPOS.get(a.get("tipo"), TIPOS["comediante"])
    ahora = datetime.now(timezone.utc) - timedelta(hours=3)
    anios = sorted({f["fecha"][:4] for f in fechas}) or [str(ahora.year)]
    prox = ", ".join(f"{f['ciudad']} ({dia_mes(f)})" for f in fechas[:3])
    fu = a.get("fuentes", {})
    fuentes = " y ".join(x for x in ["su agenda oficial" if fu.get("oficial") else "", "páginas públicas de entradas" if fu.get("pogo") else ""] if x)
    valores = {
        "TITULO": e(f"¿Cuándo viene {a['nombre']}? Fechas {' y '.join(anios)} y entradas"),
        "DESCRIPCION": e((f"Próximas fechas de {a['nombre']}: {prox}. " if prox else f"{a['nombre']} todavía no anunció fechas. ")
                         + f"Mirá cuál te queda cerca en el mapa y recibí un aviso gratis cuando anuncie {t['una_fecha']} cerca tuyo."),
        "URL": f"{SITIO}{a['slug']}/", "NOMBRE": e(a["nombre"]), "SLUG": a["slug"], "ACENTO": a.get("acento", "#ffcc33"),
        "UNA_FECHA": t["una_fecha"], "API": API, "V": version, "FUENTES": fuentes or "páginas públicas",
        "FECHAS_HTML": fechas_html(fechas), "RESUMEN_HTML": resumen_html(a, fechas, ahora.year),
        "JSONLD": jsonld(a, fechas, t),
        "FECHAS_JSON": json.dumps(fechas, ensure_ascii=False).replace("</", "<\\/"),
        "ACTUALIZADO": f"{ahora.day} de {MESES_LARGO[ahora.month - 1]} de {ahora.year}",
    }
    out = plantilla
    for k, v in valores.items():
        out = out.replace("{{" + k + "}}", v)
    assert "{{" not in out, "quedó una marca sin reemplazar"
    (RAIZ / a["slug"]).mkdir(exist_ok=True)
    (RAIZ / a["slug"] / "index.html").write_text(out, encoding="utf8")
    return len(fechas), prox


def portada(artistas, datos, version):
    tarjetas = "".join(
        f'<a class="tarjeta" href="{a["slug"]}/" style="--acento:{a.get("acento", "#ffcc33")}"><b>{e(a["nombre"])}</b>'
        f'<span>{n} {"fecha" if n == 1 else "fechas"}{": " + e(prox) if prox else ""}</span></a>'
        for a, (n, prox) in zip(artistas, datos))
    (RAIZ / "index.html").write_text(f'''<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cuándo viene: fechas de tus artistas cerca tuyo, con aviso gratis</title>
<meta name="description" content="Elegí un artista y tu localidad: te mostramos sus fechas en el mapa y te avisamos gratis cuando anuncie un show cerca tuyo. Sin cuenta y sin mail.">
<link rel="canonical" href="{SITIO}">
<meta name="theme-color" content="#14110f">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="motor/cuando.css?v={version}">
</head>
<body>
<header>
  <span class="marquesina">Cuándo viene</span>
  <h1>¿Cuándo viene <span>a tu ciudad</span>?</h1>
  <p class="bajada">Elegí un artista y tu localidad. Te mostramos sus fechas en el mapa y te avisamos apenas anuncie un show cerca tuyo. Gratis y sin cuenta.</p>
</header>
<section class="texto"><div class="tarjetas">{tarjetas}</div></section>
<footer>Páginas de fans, no oficiales. · <a href="https://kvothesson.com/">kvothesson.com</a></footer>
</body>
</html>
''', encoding="utf8")


if __name__ == "__main__":
    artistas = json.loads((RAIZ / "artistas.json").read_text(encoding="utf8"))
    plantilla = (RAIZ / "plantilla.html").read_text(encoding="utf8")
    # la versión cambia solo si cambia el motor, así el navegador no vuelve a bajarlo cada día
    version = hashlib.md5((RAIZ / "motor/cuando.js").read_bytes() + (RAIZ / "motor/cuando.css").read_bytes()).hexdigest()[:8]
    datos = []
    for a in artistas:
        datos.append(pagina(a, plantilla, version))
        print(f"{a['slug']}: {datos[-1][0]} fechas")
    portada(artistas, datos, version)
    hoy = datetime.now().strftime("%Y-%m-%d")
    urls = [SITIO] + [f"{SITIO}{a['slug']}/" for a in artistas]
    (RAIZ / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                      + "".join(f"  <url><loc>{u}</loc><lastmod>{hoy}</lastmod></url>\n" for u in urls) + "</urlset>\n", encoding="utf8")
    print("portada y sitemap listos")
