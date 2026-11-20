"""Arma las páginas de Cuándo viene con las fechas ya escritas en el HTML (para buscadores).

Lee artistas.json, le pide las fechas vigentes al robot y escribe:
  <artista>/index.html            una página por artista, desde plantilla.html
  <artista>/<ciudad>/index.html   una por cada ciudad con fecha ("Lucho Mellera en Madrid")
  index.html                      la portada con todos los artistas
  sitemap.xml                     direcciones para sumar al sitemap de kvothesson.com

Las páginas de ciudades que ya no tienen fecha se borran solas.

Uso: python herramientas/armar_paginas.py
"""
import hashlib
import html
import json
import shutil
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

RAIZ = Path(__file__).resolve().parent.parent
API = "https://cuando-viene.kvothesson.workers.dev"
SITIO = "https://kvothesson.com/cuando-viene/"
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
PAISES = json.loads((RAIZ / "datos" / "paises.json").read_text(encoding="utf8"))
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


def slug_de(texto):
    s = "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn").lower()
    return "-".join("".join(c if c.isalnum() else " " for c in s).split())


def dia_mes(f, largo=False, anio_hoy=None):
    a, m, d = f["fecha"].split("-")
    if not largo:
        return f"{int(d)} {MESES[int(m) - 1]}"
    return f"{int(d)} de {MESES_LARGO[int(m) - 1]}" + (f" de {a}" if anio_hoy is not None and int(a) != anio_hoy else "")


def inicio_iso(f):
    """Fecha y hora con el desfase del lugar, si se conoce su huso."""
    if not f.get("hora"):
        return f["fecha"]
    local = f"{f['fecha']}T{f['hora']}:00"
    try:
        d = datetime.fromisoformat(local).replace(tzinfo=ZoneInfo(f["tz"]))
        return d.isoformat()
    except Exception:
        return local


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


def resumen_artista(a, fechas, anio_hoy):
    n = a["nombre"]
    if not fechas:
        return f"<p>{e(n)} no tiene fechas anunciadas por ahora. Dejá el aviso activado y te enterás apenas publique una.</p>"

    def lista(fs):
        return "; ".join(f'<a href="{slug_de(f["ciudad"])}/">{e(f["ciudad"])}</a> ({dia_mes(f, True, anio_hoy)}{", agotado" if f["agotado"] else ""})' for f in fs)

    base = a.get("pais", "AR")
    aca = [f for f in fechas if f.get("pais") == base]
    afuera = [f for f in fechas if f.get("pais") != base]
    p = [f"<p>{e(n)} tiene {len(fechas)} {'fecha anunciada' if len(fechas) == 1 else 'fechas anunciadas'}"
         + (f" con {e(a['show'])}" if a.get("show") else "") + ".</p>"]
    nombre_base = PAISES.get(base, base)
    p.append(f"<p><strong>En {e(nombre_base)}:</strong> {lista(aca)}.</p>" if aca else f"<p>En este momento no tiene fechas en {e(nombre_base)}.</p>")
    if afuera:
        paises = sorted({PAISES.get(f.get("pais"), "") for f in afuera} - {""})
        p.append(f"<p><strong>En otros países{' (' + ', '.join(paises) + ')' if paises else ''}:</strong> {lista(afuera)}.</p>")
    return "".join(p)


def resumen_ciudad(a, ciudad, fs, anio_hoy):
    n, pais = a["nombre"], PAISES.get(fs[0].get("pais"), "")
    partes = []
    for f in fs:
        donde = f" en {e(f['lugar'])}" if f.get("lugar") else ""
        hora = f" a las {f['hora']}" if f.get("hora") else ""
        estado = " Figura agotado." if f["agotado"] else (f' <a href="{e(f["link"])}" target="_blank" rel="noopener">Ver entradas</a>.' if f.get("link") else "")
        partes.append(f"<p>{e(n)} se presenta en {e(ciudad)}{', ' + e(pais) if pais else ''} el {dia_mes(f, True, anio_hoy)}{hora}{donde}.{estado}</p>")
    partes.append(f'<p>Si suma funciones en {e(ciudad)} o cerca, te avisamos. <a href="../">Ver todas las fechas de {e(n)}</a>.</p>')
    return "".join(partes)


def jsonld(a, fechas, t):
    eventos = []
    for f in fechas:
        ev = {
            "@context": "https://schema.org", "@type": t["evento"],
            "name": f"{a['nombre']} en {f['ciudad']}", "startDate": inicio_iso(f),
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


def escribir(destino, plantilla, valores):
    out = plantilla
    for k, v in valores.items():
        out = out.replace("{{" + k + "}}", v)
    assert "{{" not in out, "quedó una marca sin reemplazar"
    destino.mkdir(parents=True, exist_ok=True)
    (destino / "index.html").write_text(out, encoding="utf8")


def paginas(a, plantilla, version):
    fechas = pedir(a["slug"])["fechas"]
    t = TIPOS.get(a.get("tipo"), TIPOS["comediante"])
    ahora = datetime.now(timezone.utc) - timedelta(hours=3)
    anios = sorted({f["fecha"][:4] for f in fechas}) or [str(ahora.year)]
    prox = ", ".join(f"{f['ciudad']} ({dia_mes(f)})" for f in fechas[:3])
    fu = a.get("fuentes", {})
    comunes = {
        "NOMBRE": e(a["nombre"]), "SLUG": a["slug"], "ACENTO": a.get("acento", "#ffcc33"), "UNA_FECHA": t["una_fecha"], "API": API, "V": version,
        "FUENTES": " y ".join(x for x in ["su agenda oficial" if fu.get("oficial") else "", "páginas públicas de entradas" if fu.get("pogo") else ""] if x) or "páginas públicas",
        "FECHAS_HTML": fechas_html(fechas),
        "FECHAS_JSON": json.dumps(fechas, ensure_ascii=False).replace("</", "<\\/"),
        "ACTUALIZADO": f"{ahora.day} de {MESES_LARGO[ahora.month - 1]} de {ahora.year}",
    }
    urls = [f"{SITIO}{a['slug']}/"]
    escribir(RAIZ / a["slug"], plantilla, {
        **comunes, "BASE": "../", "FOCO": "null", "URL": urls[0],
        "TITULO": e(f"¿Cuándo viene {a['nombre']}? Fechas {' y '.join(anios)} y entradas"),
        "H1": f"¿Cuándo viene <span>{e(a['nombre'])}</span>?",
        "H2": f"{e(a['nombre'])}: fechas y entradas",
        "DESCRIPCION": e((f"Próximas fechas de {a['nombre']}: {prox}. " if prox else f"{a['nombre']} todavía no anunció fechas. ")
                         + f"Mirá cuál te queda cerca en el mapa y recibí un aviso gratis cuando anuncie {t['una_fecha']} cerca tuyo."),
        "RESUMEN_HTML": resumen_artista(a, fechas, ahora.year), "JSONLD": jsonld(a, fechas, t),
    })

    # una página por ciudad con fecha
    por_ciudad = {}
    for f in fechas:
        por_ciudad.setdefault(slug_de(f["ciudad"]), []).append(f)
    for cs, fs in por_ciudad.items():
        ciudad, f0 = fs[0]["ciudad"], fs[0]
        url = f"{SITIO}{a['slug']}/{cs}/"
        urls.append(url)
        cuando = dia_mes(f0, True, ahora.year) + (f" y {len(fs) - 1} {'fecha' if len(fs) == 2 else 'fechas'} más" if len(fs) > 1 else "")
        escribir(RAIZ / a["slug"] / cs, plantilla, {
            **comunes, "BASE": "../../", "URL": url,
            "FOCO": json.dumps({"lat": f0["lat"], "lon": f0["lon"], "cc": f0.get("pais") or ""}) if f0.get("lat") is not None else "null",
            "TITULO": e(f"{a['nombre']} en {ciudad}: fecha, entradas y aviso"),
            "H1": f"<span>{e(a['nombre'])}</span> en {e(ciudad)}",
            "H2": f"{e(a['nombre'])} en {e(ciudad)}",
            "DESCRIPCION": e(f"{a['nombre']} en {ciudad}: {cuando}" + (f", {f0['lugar']}" if f0.get("lugar") else "")
                             + (". Figura agotado" if all(x["agotado"] for x in fs) else "") + f". Entradas y aviso gratis si anuncia {t['una_fecha']} cerca tuyo."),
            "RESUMEN_HTML": resumen_ciudad(a, ciudad, fs, ahora.year), "JSONLD": jsonld(a, fs, t),
        })
    # ciudades que ya no tienen fecha: su página se va
    for d in (RAIZ / a["slug"]).iterdir():
        if d.is_dir() and d.name not in por_ciudad and [x.name for x in d.iterdir()] == ["index.html"]:
            shutil.rmtree(d)
    return len(fechas), prox, urls


def portada(artistas, datos, version):
    tarjetas = "".join(
        f'<a class="tarjeta" href="{a["slug"]}/" style="--acento:{a.get("acento", "#ffcc33")}"><b>{e(a["nombre"])}</b>'
        f'<span>{n} {"fecha" if n == 1 else "fechas"}{": " + e(prox) if prox else ""}</span></a>'
        for a, (n, prox, _) in zip(artistas, datos))
    (RAIZ / "index.html").write_text(f'''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cuándo viene: fechas de tus artistas cerca tuyo, con aviso gratis</title>
<meta name="description" content="Elegí un artista y tu ciudad, en cualquier país: te mostramos sus fechas en el mapa y te avisamos gratis cuando anuncie un show cerca tuyo. Sin cuenta y sin mail.">
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
  <p class="bajada">Elegí un artista y tu ciudad, en cualquier país. Te mostramos sus fechas en el mapa y te avisamos apenas anuncie un show cerca tuyo. Gratis y sin cuenta.</p>
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
        datos.append(paginas(a, plantilla, version))
        print(f"{a['slug']}: {datos[-1][0]} fechas, {len(datos[-1][2]) - 1} páginas de ciudad")
    portada(artistas, datos, version)
    hoy = datetime.now().strftime("%Y-%m-%d")
    urls = [SITIO] + [u for d in datos for u in d[2]]
    (RAIZ / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                      + "".join(f"  <url><loc>{u}</loc><lastmod>{hoy}</lastmod></url>\n" for u in urls) + "</urlset>\n", encoding="utf8")
    print(f"portada y sitemap listos: {len(urls)} direcciones")
