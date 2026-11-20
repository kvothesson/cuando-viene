"""Arma los datos del mundo para Cuándo viene.

Entrada (datos/crudo/, no se sube al repo):
  paises.geojson               Natural Earth 1:50m, países (dominio público)
  geonames/cities15000.zip     GeoNames, ciudades de más de 15.000 habitantes (CC BY 4.0)
  geonames/admin1.txt          GeoNames, nombres de provincias y regiones

Salida:
  datos/mundo.json             contorno de los países (sin Argentina: esa la dibuja mapa.json con más detalle)
  datos/paises.json            código -> nombre en castellano, solo países con ciudades
  datos/husos.json             huso horario -> país (para adivinar el país del visitante sin rastrearlo)
  datos/capitales.json         capitales de país y de provincia: pesan más al elegir qué ciudades tienen página
  datos/ciudades/<PAIS>.json   ciudades de cada país para el buscador
  nube/ciudades.json           todas las ciudades, para que el robot ubique cada fecha

Uso: python herramientas/armar_mundo.py
"""
import json
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CRUDO = RAIZ / "datos" / "crudo"
ESCALA = 100  # 2 decimales, cerca de 1 km
SIN_DIBUJAR = {"AR", "FK", "GS", "AQ"}  # Argentina y sus islas van con el mapa propio; la Antártida no hace falta
GRANDE = 300_000  # desde acá se guardan también los otros nombres de la ciudad ("Ciudad de México", "Nueva York")
# GeoNames nombra en inglés a varias capitales: acá va cómo se muestran
EN_CASTELLANO = {
    "Mexico City": "Ciudad de México", "Havana": "La Habana", "New York City": "Nueva York", "London": "Londres",
    "Lisbon": "Lisboa", "Rome": "Roma", "Milan": "Milán", "Naples": "Nápoles", "Florence": "Florencia", "Venice": "Venecia",
    "Turin": "Turín", "Munich": "Múnich", "Cologne": "Colonia", "Vienna": "Viena", "Prague": "Praga", "Warsaw": "Varsovia",
    "Moscow": "Moscú", "Athens": "Atenas", "Brussels": "Bruselas", "Geneva": "Ginebra", "Copenhagen": "Copenhague",
    "Stockholm": "Estocolmo", "Dublin": "Dublín", "Paris": "París", "Marseille": "Marsella", "Tokyo": "Tokio",
    "Beijing": "Pekín", "Seville": "Sevilla", "Saragossa": "Zaragoza", "Panama": "Ciudad de Panamá", "Guatemala City": "Ciudad de Guatemala",
    "Sao Paulo": "San Pablo", "São Paulo": "San Pablo", "Philadelphia": "Filadelfia", "Edinburgh": "Edimburgo", "Zurich": "Zúrich",
    "Berlin": "Berlín", "Hamburg": "Hamburgo", "Frankfurt am Main": "Fráncfort", "Amsterdam": "Ámsterdam", "The Hague": "La Haya",
    "Antwerp": "Amberes", "Bucharest": "Bucarest", "Budapest": "Budapest", "Istanbul": "Estambul", "Cairo": "El Cairo",
    "Jerusalem": "Jerusalén", "Montreal": "Montreal", "Asunción": "Asunción",
}


def norm(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower().strip()


def latino(s):
    if not (3 <= len(s) <= 40) or "/" in s or s.isupper():
        return False
    for c in s:
        if c.isalpha():
            if not unicodedata.name(c, "").startswith("LATIN"):
                return False
        elif c not in " -'.":
            return False
    return True


def guardar(ruta, obj):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    return ruta.stat().st_size / 1024


# ---------------- países ----------------
def anillos(geom):
    return list(geom["coordinates"]) if geom["type"] == "Polygon" else [a for pol in geom["coordinates"] for a in pol]


def codificar(anillo):
    pts = []
    for lon, lat in anillo:
        p = (round(lon * ESCALA), round(lat * ESCALA))
        if not pts or pts[-1] != p:
            pts.append(p)
    if len(pts) < 4:
        return None, 0
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    ancho, alto = max(xs) - min(xs), max(ys) - min(ys)
    if ancho < 8 and alto < 8:  # islotes de menos de ~8 km
        return None, 0
    plano = [pts[0][0], pts[0][1]]
    for a, b in zip(pts, pts[1:]):
        plano += [b[0] - a[0], b[1] - a[1]]
    return plano, ancho * alto


def paises():
    datos = json.loads((CRUDO / "paises.geojson").read_text(encoding="utf8"))
    capa, nombres = [], {"AR": "Argentina"}
    for f in datos["features"]:
        p = f["properties"]
        cc = p.get("ISO_A2_EH") if p.get("ISO_A2_EH") not in (None, "-99") else p.get("ISO_A2")
        if not cc or cc == "-99":
            cc = ""
        if cc:
            nombres[cc] = p.get("NAME_ES") or p["NAME"]
        if cc in SIN_DIBUJAR:
            continue
        rs, mayor, caja = [], 0, None
        for a in anillos(f["geometry"]):
            r, area = codificar(a)
            if not r:
                continue
            rs.append(r)
            if area > mayor:  # la caja del pedazo más grande: Francia sin la Guayana
                mayor = area
                xs = [x / ESCALA for x, _ in ((q[0], q[1]) for q in [(round(lo * ESCALA), round(la * ESCALA)) for lo, la in a])]
                ys = [la for _, la in a]
                caja = [round(min(lo for lo, _ in a), 2), round(min(ys), 2), round(max(lo for lo, _ in a), 2), round(max(ys), 2)]
        if rs:
            capa.append({"c": cc, "b": caja, "r": rs})
    return capa, nombres


# ---------------- ciudades ----------------
def ciudades():
    regiones = {}
    for linea in (CRUDO / "geonames" / "admin1.txt").read_text(encoding="utf8").splitlines():
        t = linea.split("\t")
        if len(t) >= 2:
            regiones[t[0]] = t[1]
    z = zipfile.ZipFile(CRUDO / "geonames" / "cities15000.zip")
    filas = []
    for linea in z.read("cities15000.txt").decode("utf8").strip().split("\n"):
        t = linea.split("\t")
        nombre, ascii_, otros, lat, lon, cc, adm, pob, tz = t[1], t[2], t[3], float(t[4]), float(t[5]), t[8], t[10], int(t[14] or 0), t[17]
        candidatos = [ascii_] + (otros.split(",") if pob >= GRANDE else [])
        if nombre in EN_CASTELLANO:  # se muestra en castellano y el nombre original queda para buscar
            candidatos.insert(0, nombre)
            nombre = EN_CASTELLANO[nombre]
        vistos, alts = {norm(nombre)}, []
        for a in candidatos:
            k = norm(a)
            if k and k not in vistos and latino(a):
                vistos.add(k)
                alts.append(a)
        filas.append({"cap": t[7] in ("PPLC", "PPLA"), "n": nombre, "cc": cc, "reg": regiones.get(f"{cc}.{adm}", ""), "lat": round(lat, 2), "lon": round(lon, 2),
                      "pob": pob, "tz": tz, "alts": alts[:220]})
    filas.sort(key=lambda f: -f["pob"])
    return filas


if __name__ == "__main__":
    capa, nombres = paises()
    print(f"mundo.json: {guardar(RAIZ / 'datos/mundo.json', {'escala': ESCALA, 'paises': capa}):.0f} KB, {len(capa)} países")

    filas = ciudades()
    por_pais = defaultdict(list)
    for f in filas:
        por_pais[f["cc"]].append([f["n"], f["reg"] if f["reg"] != f["n"] else "", f["lat"], f["lon"]] + ([f["alts"]] if f["alts"] else []))
    total = 0
    for cc, lista in por_pais.items():
        if cc != "AR":  # Argentina usa localidades.json, que llega hasta el barrio
            total += guardar(RAIZ / "datos" / "ciudades" / f"{cc}.json", lista)
    print(f"ciudades/: {total:.0f} KB en {len(por_pais) - 1} archivos")

    con_ciudades = {cc: nombres.get(cc, cc) for cc in por_pais if cc in nombres}
    print(f"paises.json: {guardar(RAIZ / 'datos/paises.json', dict(sorted(con_ciudades.items(), key=lambda kv: norm(kv[1])))):.0f} KB, {len(con_ciudades)} países")

    por_huso = defaultdict(Counter)
    for f in filas:
        por_huso[f["tz"]][f["cc"]] += f["pob"]
    print(f"husos.json: {guardar(RAIZ / 'datos/husos.json', {tz: c.most_common(1)[0][0] for tz, c in sorted(por_huso.items())}):.0f} KB")

    capitales = defaultdict(list)
    for f in filas:
        if f["cap"]:
            capitales[f["cc"]].append(f["n"])
    print(f"capitales.json: {guardar(RAIZ / 'datos/capitales.json', dict(sorted(capitales.items()))):.0f} KB")

    husos = sorted(por_huso)
    robot = {"husos": husos, "ciudades": [[f["n"], f["cc"], f["lat"], f["lon"], husos.index(f["tz"]), f["pob"]] + ([f["alts"]] if f["alts"] else []) for f in filas]}
    print(f"nube/ciudades.json: {guardar(RAIZ / 'nube/ciudades.json', robot):.0f} KB, {len(filas)} ciudades")
