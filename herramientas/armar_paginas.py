"""Arma las páginas de Cuándo viene con todo ya escrito en el HTML (para buscadores).

Lee artistas.json, le pide las fechas vigentes al robot y escribe, por artista:
  <artista>/index.html            "¿Cuándo viene X?"
  <artista>/<país>/index.html     "¿Cuándo viene X a Argentina?": países con fecha, el suyo y los que ya visitó
  <artista>/<ciudad>/index.html   con fecha: "X en Madrid" · sin fecha: "¿Cuándo viene X a Rosario?" con la más cercana
  <artista>/tarjeta.png           imagen para compartir
más index.html (portada) y sitemap.xml.

Las páginas sin fecha tienen tope (las ciudades más grandes de cada país que importa): cada una
responde algo propio, la fecha más cercana y a cuántos km. Las que dejan de corresponder se borran solas.

Uso: python herramientas/armar_paginas.py
"""
import hashlib
import html
import json
import math
import shutil
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # sin Pillow no hay tarjeta, el resto sale igual
    Image = None

RAIZ = Path(__file__).resolve().parent.parent
API = "https://cuando-viene.kvothesson.workers.dev"
SITIO = "https://kvothesson.com/cuando-viene/"
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
PAISES = json.loads((RAIZ / "datos" / "paises.json").read_text(encoding="utf8"))
MUNDO = json.loads((RAIZ / "nube" / "ciudades.json").read_text(encoding="utf8"))["ciudades"]  # [nombre, país, lat, lon, huso, población], de mayor a menor
CAPITALES = json.loads((RAIZ / "datos" / "capitales.json").read_text(encoding="utf8"))
# Cuántas ciudades sin fecha se escriben por país
TOPE_PROPIO, TOPE_CON_FECHA, TOPE_VISITADO = 20, 5, 3
# Cómo se le dice a cada cosa según el tipo de artista
TIPOS = {
    "comediante": {"una_fecha": "una función", "evento": "ComedyEvent", "quien": "Person"},
    "banda": {"una_fecha": "un recital", "evento": "MusicEvent", "quien": "MusicGroup"},
    "musico": {"una_fecha": "un recital", "evento": "MusicEvent", "quien": "Person"},
}
e = html.escape
DESCRIPCION = ("Elegí un artista y tu ciudad, en cualquier país: te mostramos sus fechas en el mapa y te avisamos gratis "
               "cuando anuncie un show cerca tuyo. Sin cuenta y sin mail.")


def pedir(slug):
    req = urllib.request.Request(f"{API}/fechas/{slug}", headers={"User-Agent": "cuando-viene-armador/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def slug_de(texto):
    s = "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn").lower()
    return "-".join("".join(c if c.isalnum() else " " for c in s).split())


def km(a, b):
    r = math.radians
    h = math.sin(r(b["lat"] - a["lat"]) / 2) ** 2 + math.cos(r(a["lat"])) * math.cos(r(b["lat"])) * math.sin(r(b["lon"] - a["lon"]) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def miles(n):
    return f"{round(n):,}".replace(",", ".")


def dia_mes(f, largo=False, anio_hoy=None):
    a, m, d = f["fecha"].split("-")
    if not largo:
        return f"{int(d)} {MESES[int(m) - 1]}"
    return f"{int(d)} de {MESES_LARGO[int(m) - 1]}" + (f" de {a}" if anio_hoy is not None and int(a) != anio_hoy else "")


def precio_txt(f):
    if not f.get("precio") or f.get("agotado"):
        return ""
    return f"desde $ {miles(f['precio'])}" if f.get("moneda") in ("ARS", "", None) else f"desde {miles(f['precio'])} {f['moneda']}"


def inicio_iso(f):
    """Fecha y hora con el desfase del lugar, si se conoce su huso."""
    if not f.get("hora"):
        return f["fecha"]
    local = f"{f['fecha']}T{f['hora']}:00"
    try:
        return datetime.fromisoformat(local).replace(tzinfo=ZoneInfo(f["tz"])).isoformat()
    except Exception:
        return local


# ---------------- pedazos de HTML ----------------
def fechas_html(fechas):
    if not fechas:
        return '<p class="nota">Por ahora no hay fechas anunciadas.</p>'
    out = []
    for f in fechas:
        a, m, d = f["fecha"].split("-")
        sello = ' <span class="sello">Agotado</span>' if f["agotado"] else ""
        extra = "".join(f" · {x}" for x in [f"{f['hora']} h" if f.get("hora") else "", precio_txt(f)] if x)
        link = f'<a href="{e(f["link"])}" target="_blank" rel="noopener">{"Ver igual" if f["agotado"] else "Entradas"} →</a>' if f.get("link") else ""
        out.append(f'<div class="fecha" role="listitem"><time class="dia" datetime="{f["fecha"]}"><b>{int(d)}</b><small>{MESES[int(m) - 1]}</small></time>'
                   f'<div><div class="lugar">{e(f.get("lugar") or f["ciudad"])}{sello}</div>'
                   f'<div class="meta">{e(f["ciudad"])}{extra}</div>{link}</div></div>')
    return "".join(out)


def migas_html(migas):
    partes = [f'<a href="{e(u)}">{e(n)}</a>' for n, u in migas[:-1]] + [f"<span>{e(migas[-1][0])}</span>"]
    return '<nav class="migas" aria-label="Estás en">' + " › ".join(partes) + "</nav>"


def datos_estructurados(a, fechas, t, migas):
    cosas = []
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
            if f.get("precio") and f.get("moneda"):
                ev["offers"].update({"price": f["precio"], "priceCurrency": f["moneda"]})
        cosas.append(ev)
    cosas.append({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(migas)]})
    return json.dumps(cosas, ensure_ascii=False).replace("</", "<\\/")


def lista_fechas(fs, anio_hoy, enlace=None, desde=None):
    """'La Plata (12 de diciembre, agotado, a 300 km)' separadas por punto y coma."""
    partes = []
    for f in fs:
        nombre = f'<a href="{enlace(f)}">{e(f["ciudad"])}</a>' if enlace else e(f["ciudad"])
        extra = [dia_mes(f, True, anio_hoy)] + (["agotado"] if f["agotado"] else []) + ([f"a {miles(km(desde, f))} km"] if desde and f.get("lat") is not None else [])
        partes.append(f"{nombre} ({', '.join(extra)})")
    return "; ".join(partes)


def enlaces_html(a, rel, paises, ciudades):
    """Links cruzados: países y ciudades del artista. rel = cómo llegar a la carpeta del artista."""
    if not paises and not ciudades:
        return ""
    p = "".join(f'<a href="{rel}{s}/">{e(n)}</a>' for s, n in paises)
    c = "".join(f'<a href="{rel}{s}/">{e(n)}</a>' for s, n in ciudades)
    return (f"<h2>{e(a['nombre'])} por país y ciudad</h2>" + (f'<p class="chips">{p}</p>' if p else "") + (f'<p class="chips">{c}</p>' if c else ""))


# ---------------- tarjeta para compartir ----------------
def tarjeta(a, fechas, destino):
    if Image is None:
        return False
    fuente = RAIZ / "motor" / "fuentes" / "ArchivoBlack-Regular.ttf"
    if not fuente.exists():
        return False
    letra = lambda n: ImageFont.truetype(str(fuente), n)
    acento = a.get("acento", "#ffcc33")
    im = Image.new("RGB", (1200, 630), "#14110f")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 1200, 14], fill=acento)
    d.rectangle([70, 70, 70 + 300, 70 + 46], fill=acento)
    d.text((86, 78), "CUÁNDO VIENE", font=letra(26), fill="#14110f")
    tam = 110
    while tam > 50 and d.textlength(a["nombre"], font=letra(tam)) > 1060:
        tam -= 6
    d.text((70, 150), "¿Cuándo viene", font=letra(54), fill="#f3ece2")
    d.text((70, 215), a["nombre"] + "?", font=letra(tam), fill=acento)
    y = 215 + tam + 50
    for f in fechas[:3]:
        d.text((70, y), f"{dia_mes(f)}  ·  {f['ciudad']}" + ("  ·  agotado" if f["agotado"] else ""), font=letra(40), fill="#f3ece2" if not f["agotado"] else "#a99c8b")
        y += 58
    if not fechas:
        d.text((70, y), "Todavía sin fechas: activá el aviso", font=letra(40), fill="#a99c8b")
    d.text((70, 560), "Fechas en el mapa y aviso gratis  ·  kvothesson.com/cuando-viene", font=letra(24), fill="#a99c8b")
    destino.parent.mkdir(parents=True, exist_ok=True)
    im.save(destino, optimize=True)
    return True


# ---------------- escritura ----------------
def escribir(destino, plantilla, valores):
    out = plantilla
    for k, v in valores.items():
        out = out.replace("{{" + k + "}}", v)
    assert "{{" not in out, "quedó una marca sin reemplazar"
    destino.mkdir(parents=True, exist_ok=True)
    (destino / "index.html").write_text(out, encoding="utf8")


def paginas(a, plantilla, version):
    datos = pedir(a["slug"])
    fechas, n = datos["fechas"], a["nombre"]
    t = TIPOS.get(a.get("tipo"), TIPOS["comediante"])
    ahora = datetime.now(timezone.utc) - timedelta(hours=3)
    hoy_anio = ahora.year
    anios = sorted({f["fecha"][:4] for f in fechas}) or [str(hoy_anio)]
    prox = ", ".join(f"{f['ciudad']} ({dia_mes(f)})" for f in fechas[:3])
    fu = a.get("fuentes", {})
    raiz_a = f"{SITIO}{a['slug']}/"
    con_coord = [f for f in fechas if f.get("lat") is not None]

    # qué países y ciudades tienen página
    base = a.get("pais", "AR")
    con_fecha = list(dict.fromkeys(f["pais"] for f in fechas if f.get("pais")))
    paises = [cc for cc in dict.fromkeys([base] + con_fecha + datos.get("paises", [])) if cc in PAISES]
    slug_pais = {cc: slug_de(PAISES[cc]) for cc in paises}
    usados = set(slug_pais.values())

    def unico(s):
        while s in usados:
            s += "-ciudad"
        usados.add(s)
        return s

    con = {}  # ciudades con fecha: nombre -> {slug, fechas}
    for f in fechas:
        if f["ciudad"] not in con:
            con[f["ciudad"]] = {"slug": unico(slug_de(f["ciudad"])), "fechas": []}
        con[f["ciudad"]]["fechas"].append(f)
    sin = []  # ciudades sin fecha: las más grandes de cada país que importa
    for cc in paises:
        tope, puestas = (TOPE_PROPIO if cc == base else TOPE_CON_FECHA if cc in con_fecha else TOPE_VISITADO), 0
        caps = set(CAPITALES.get(cc, []))
        # las capitales de provincia pesan triple: Mendoza antes que su suburbio más poblado
        for c in sorted((c for c in MUNDO if c[1] == cc), key=lambda c: -c[5] * (3 if c[0] in caps else 1)):
            if puestas >= tope:
                break
            p = {"nombre": c[0], "cc": cc, "lat": c[2], "lon": c[3]}
            if c[0] in con or any(f.get("pais") == cc and km(p, f) < 30 for f in con_coord) or slug_de(c[0]) in usados:
                continue  # ahí ya hay fecha, o el nombre se pisa con otra página
            if any(q["cc"] == cc and km(p, q) < 40 for q in sin):
                continue  # pegada a una ciudad más grande que ya tiene página (Avellaneda con Buenos Aires)
            p["slug"] = unico(slug_de(c[0]))
            sin.append(p)
            puestas += 1

    chips_paises = [(slug_pais[cc], PAISES[cc]) for cc in paises]
    chips_ciudades = [(v["slug"], k) for k, v in con.items()] + [(p["slug"], p["nombre"]) for p in sin]
    og = f'<meta property="og:image" content="{raiz_a}tarjeta.png">\n<meta name="twitter:card" content="summary_large_image">' if tarjeta(a, fechas, RAIZ / a["slug"] / "tarjeta.png") else ""
    comunes = {
        "NOMBRE": e(n), "SLUG": a["slug"], "ACENTO": a.get("acento", "#ffcc33"), "UNA_FECHA": t["una_fecha"], "API": API, "V": version, "OG": og,
        "FUENTES": " y ".join(x for x in ["su agenda oficial" if fu.get("oficial") else "", "páginas públicas de entradas" if fu.get("pogo") else ""] if x) or "páginas públicas",
        "FECHAS_HTML": fechas_html(fechas),
        "FECHAS_JSON": json.dumps(fechas, ensure_ascii=False).replace("</", "<\\/"),
        "ACTUALIZADO": f"{ahora.day} de {MESES_LARGO[ahora.month - 1]} de {ahora.year}",
    }
    aviso = f"Dejá el aviso activado y te enterás apenas anuncie {t['una_fecha']} cerca tuyo."
    urls, vigentes = [raiz_a], set()
    miga0, miga1 = ("Cuándo viene", SITIO), (n, raiz_a)

    # --- el artista ---
    if fechas:
        aca = [f for f in fechas if f.get("pais") == base]
        afuera = [f for f in fechas if f.get("pais") != base]
        enl = lambda f: con[f["ciudad"]]["slug"] + "/"
        res = [f"<p>{e(n)} tiene {len(fechas)} {'fecha anunciada' if len(fechas) == 1 else 'fechas anunciadas'}" + (f" con {e(a['show'])}" if a.get("show") else "") + ".</p>"]
        res.append(f"<p><strong>En {e(PAISES.get(base, base))}:</strong> {lista_fechas(aca, hoy_anio, enl)}.</p>" if aca else f"<p>En este momento no tiene fechas en {e(PAISES.get(base, base))}.</p>")
        if afuera:
            res.append(f"<p><strong>En otros países:</strong> {lista_fechas(afuera, hoy_anio, enl)}.</p>")
        resumen = "".join(res)
    else:
        resumen = f"<p>{e(n)} no tiene fechas anunciadas por ahora. {aviso}</p>"
    escribir(RAIZ / a["slug"], plantilla, {
        **comunes, "BASE": "../", "FOCO": "null", "URL": raiz_a,
        "TITULO": e(f"¿Cuándo viene {n}? Fechas {' y '.join(anios)} y entradas"),
        "H1": f"¿Cuándo viene <span>{e(n)}</span>?", "H2": f"{e(n)}: fechas y entradas",
        "DESCRIPCION": e((f"Próximas fechas de {n}: {prox}. " if prox else f"{n} todavía no anunció fechas. ")
                         + f"Mirá cuál te queda cerca en el mapa y recibí un aviso gratis cuando anuncie {t['una_fecha']} cerca tuyo."),
        "RESUMEN_HTML": resumen, "MIGAS": migas_html([miga0, miga1]),
        "ENLACES_HTML": enlaces_html(a, "", chips_paises, chips_ciudades),
        "JSONLD": datos_estructurados(a, fechas, t, [miga0, miga1]),
    })

    def mas_cerca(p, cuantas=3):
        return sorted(con_coord, key=lambda f: km(p, f))[:cuantas]

    # --- un país ---
    for cc in paises:
        pais, s = PAISES[cc], slug_pais[cc]
        fs = [f for f in fechas if f.get("pais") == cc]
        url = f"{raiz_a}{s}/"
        urls.append(url); vigentes.add(s)
        enl = lambda f: "../" + con[f["ciudad"]]["slug"] + "/"
        if fs:
            desc = f"{n} en {pais}: " + ", ".join(f"{f['ciudad']} ({dia_mes(f)}{', agotado' if f['agotado'] else ''})" for f in fs[:4]) + f". Entradas y aviso gratis si suma {t['una_fecha']}."
            res = f"<p>{e(n)} tiene {len(fs)} {'fecha' if len(fs) == 1 else 'fechas'} en {e(pais)}: {lista_fechas(fs, hoy_anio, enl)}.</p><p>{aviso}</p>"
        else:
            otras = fechas[:3]
            desc = f"{n} no tiene fechas anunciadas en {pais} por ahora." + (f" Próximas en otros países: {', '.join(f['ciudad'] + ' (' + dia_mes(f) + ')' for f in otras)}." if otras else "") + " Activá el aviso gratis."
            res = f"<p>{e(n)} no tiene fechas anunciadas en {e(pais)} por ahora.</p>" + (f"<p>Sus próximas fechas: {lista_fechas(otras, hoy_anio, enl)}.</p>" if otras else "") + f"<p>{aviso}</p>"
        migas = [miga0, miga1, (pais, url)]
        del_pais = [(v["slug"], k) for k, v in con.items() if v["fechas"][0].get("pais") == cc] + [(p["slug"], p["nombre"]) for p in sin if p["cc"] == cc]
        escribir(RAIZ / a["slug"] / s, plantilla, {
            **comunes, "BASE": "../../", "URL": url, "FOCO": json.dumps({"cc": cc}),
            "TITULO": e(f"¿Cuándo viene {n} a {pais}? Fechas y entradas"),
            "H1": f"¿Cuándo viene <span>{e(n)}</span> a {e(pais)}?", "H2": f"{e(n)} en {e(pais)}",
            "DESCRIPCION": e(desc), "RESUMEN_HTML": res, "MIGAS": migas_html(migas),
            "ENLACES_HTML": enlaces_html(a, "../", [x for x in chips_paises if x[0] != s], del_pais),
            "JSONLD": datos_estructurados(a, fs, t, migas),
        })

    # --- una ciudad con fecha ---
    for ciudad, v in con.items():
        fs, f0, cs = v["fechas"], v["fechas"][0], v["slug"]
        url = f"{raiz_a}{cs}/"
        urls.append(url); vigentes.add(cs)
        cc = f0.get("pais") or ""
        pais = PAISES.get(cc, "")
        cuando = dia_mes(f0, True, hoy_anio) + (f" y {len(fs) - 1} {'fecha' if len(fs) == 2 else 'fechas'} más" if len(fs) > 1 else "")
        partes = []
        for f in fs:
            donde = f" en {e(f['lugar'])}" if f.get("lugar") else ""
            hora = f" a las {f['hora']}" if f.get("hora") else ""
            px = f" Entradas {precio_txt(f)}." if precio_txt(f) else ""
            estado = " Figura agotado." if f["agotado"] else (f'{px} <a href="{e(f["link"])}" target="_blank" rel="noopener">Ver entradas</a>.' if f.get("link") else px)
            partes.append(f"<p>{e(n)} se presenta en {e(ciudad)}{', ' + e(pais) if pais else ''} el {dia_mes(f, True, hoy_anio)}{hora}{donde}.{estado}</p>")
        partes.append(f"<p>Si suma funciones en {e(ciudad)} o cerca, te avisamos.</p>")
        migas = [miga0, miga1] + ([(pais, f"{raiz_a}{slug_pais[cc]}/")] if cc in slug_pais else []) + [(ciudad, url)]
        foco = {"lat": f0["lat"], "lon": f0["lon"], "cc": cc, "nombre": ciudad} if f0.get("lat") is not None else None
        escribir(RAIZ / a["slug"] / cs, plantilla, {
            **comunes, "BASE": "../../", "URL": url, "FOCO": json.dumps(foco, ensure_ascii=False),
            "TITULO": e(f"{n} en {ciudad}: fecha, entradas y aviso"),
            "H1": f"<span>{e(n)}</span> en {e(ciudad)}", "H2": f"{e(n)} en {e(ciudad)}",
            "DESCRIPCION": e(f"{n} en {ciudad}: {cuando}" + (f", {f0['lugar']}" if f0.get("lugar") else "")
                             + (". Figura agotado" if all(x["agotado"] for x in fs) else (f". Entradas {precio_txt(f0)}" if precio_txt(f0) else ""))
                             + f". Aviso gratis si anuncia {t['una_fecha']} cerca tuyo."),
            "RESUMEN_HTML": "".join(partes), "MIGAS": migas_html(migas),
            "ENLACES_HTML": enlaces_html(a, "../", chips_paises, [x for x in chips_ciudades if x[0] != cs]),
            "JSONLD": datos_estructurados(a, fs, t, migas),
        })

    # --- una ciudad sin fecha: la respuesta es la fecha más cercana ---
    for p in sin:
        ciudad, cc, cs = p["nombre"], p["cc"], p["slug"]
        pais = PAISES[cc]
        url = f"{raiz_a}{cs}/"
        urls.append(url); vigentes.add(cs)
        cerca = mas_cerca(p)
        enl = lambda f: "../" + con[f["ciudad"]]["slug"] + "/"
        if cerca:
            f1 = cerca[0]
            la = f"{f1['ciudad']}, a {miles(km(p, f1))} km, el {dia_mes(f1, True, hoy_anio)}" + (" (agotado)" if f1["agotado"] else "")
            desc = f"{n} todavía no anunció fecha en {ciudad}. La más cercana: {la}. Activá el aviso gratis y te enterás apenas la anuncie."
            res = (f"<p>{e(n)} todavía no anunció {t['una_fecha']} en {e(ciudad)}, {e(pais)}.</p>"
                   f"<p><strong>Las fechas más cercanas a {e(ciudad)}:</strong> {lista_fechas(cerca, hoy_anio, enl, p)}.</p>"
                   f"<p>El mapa ya está parado en {e(ciudad)}: elegí hasta cuántos km te sirve viajar y activá el aviso.</p>")
        else:
            desc = f"{n} todavía no anunció fecha en {ciudad} ni en ningún otro lugar. Activá el aviso gratis y te enterás apenas la anuncie."
            res = f"<p>{e(n)} todavía no anunció {t['una_fecha']} en {e(ciudad)}, {e(pais)}, y por ahora no tiene fechas en ningún lado.</p><p>{aviso}</p>"
        migas = [miga0, miga1, (pais, f"{raiz_a}{slug_pais[cc]}/"), (ciudad, url)]
        escribir(RAIZ / a["slug"] / cs, plantilla, {
            **comunes, "BASE": "../../", "URL": url,
            "FOCO": json.dumps({"lat": p["lat"], "lon": p["lon"], "cc": cc, "nombre": ciudad}, ensure_ascii=False),
            "TITULO": e(f"¿Cuándo viene {n} a {ciudad}?"),
            "H1": f"¿Cuándo viene <span>{e(n)}</span> a {e(ciudad)}?", "H2": f"{e(n)} en {e(ciudad)}",
            "DESCRIPCION": e(desc), "RESUMEN_HTML": res, "MIGAS": migas_html(migas),
            "ENLACES_HTML": enlaces_html(a, "../", chips_paises, [x for x in chips_ciudades if x[0] != cs]),
            "JSONLD": datos_estructurados(a, [], t, migas),
        })

    # páginas que ya no corresponden: se van
    for d in (RAIZ / a["slug"]).iterdir():
        if d.is_dir() and d.name not in vigentes and [x.name for x in d.iterdir()] == ["index.html"]:
            shutil.rmtree(d)
    return len(fechas), prox, urls


def portada(artistas, datos, version):
    tarjetas = "".join(
        f'<a class="tarjeta" href="{a["slug"]}/" style="--acento:{a.get("acento", "#ffcc33")}"><b>{e(a["nombre"])}</b>'
        f'<span>{n} {"fecha" if n == 1 else "fechas"}{": " + e(prox) if prox else ""}</span></a>'
        for a, (n, prox, _) in zip(artistas, datos))
    lista = "".join(
        f'<a href="{a["slug"]}/">{e(a["nombre"])}, {e(a.get("tipo", "artista"))}'
        f'{" (" + e(a["show"]) + ")" if a.get("show") else ""}: {n} {"fecha" if n == 1 else "fechas"}</a>'
        for a, (n, _, _) in zip(artistas, datos))
    org = {"@type": "Organization", "name": "Kvothesson", "url": "https://kvothesson.com/"}
    ld = json.dumps([
        {"@context": "https://schema.org", "@type": "WebApplication", "name": "Cuándo viene", "url": SITIO,
         "description": DESCRIPCION, "inLanguage": "es", "applicationCategory": "EntertainmentApplication",
         "operatingSystem": "Web", "isAccessibleForFree": True,
         "offers": {"@type": "Offer", "price": 0, "priceCurrency": "ARS"}, "author": org, "publisher": org},
        {"@context": "https://schema.org", "@type": "ItemList", "name": "Artistas en Cuándo viene",
         "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": a["nombre"], "url": f"{SITIO}{a['slug']}/"}
                             for i, a in enumerate(artistas)]},
    ], ensure_ascii=False).replace("</", "<\\/")
    (RAIZ / "index.html").write_text(f'''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cuándo viene: fechas de tus artistas cerca tuyo, con aviso gratis</title>
<meta name="description" content="{DESCRIPCION}">
<link rel="canonical" href="{SITIO}">
<meta property="og:type" content="website">
<meta property="og:title" content="Cuándo viene: fechas de tus artistas cerca tuyo">
<meta property="og:description" content="{DESCRIPCION}">
<meta property="og:url" content="{SITIO}">
<meta property="og:locale" content="es_AR">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#14110f">
<link rel="icon" type="image/png" href="motor/icono.png?v=2">
<script type="application/ld+json">{ld}</script>
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
<section class="texto"><div class="tarjetas">{tarjetas}</div>
  <h2>¿Qué es Cuándo viene?</h2>
  <p>Una página gratis para fans que quieren saber cuándo viene su artista a su ciudad. Leemos la agenda oficial de cada artista y otras agendas de shows cada 30 minutos, y mostramos las fechas en un mapa propio, en cualquier país.</p>
  <h2>¿Cómo me entero cuando venga a mi ciudad?</h2>
  <p>Entrá a la página del artista, elegí tu ciudad, mové la distancia hasta donde te sirva viajar y activá el aviso en el celular, en la compu o por Telegram. Cuando anuncia una fecha dentro de ese radio, te llega una notificación con el link a las entradas.</p>
  <p>No hace falta cuenta ni mail. Solo usamos la ciudad que elegís: no pedimos ni guardamos tu dirección ni tu ubicación.</p>
  <h2>Artistas</h2>
  <div class="chips">{lista}</div>
</section>
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
        print(f"{a['slug']}: {datos[-1][0]} fechas, {len(datos[-1][2])} páginas")
    portada(artistas, datos, version)
    hoy = datetime.now().strftime("%Y-%m-%d")
    urls = [SITIO] + [u for d in datos for u in d[2]]
    (RAIZ / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                      + "".join(f"  <url><loc>{u}</loc><lastmod>{hoy}</lastmod></url>\n" for u in urls) + "</urlset>\n", encoding="utf8")
    print(f"portada y sitemap listos: {len(urls)} direcciones")
