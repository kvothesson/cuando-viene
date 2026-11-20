"""Achica los datos oficiales de georef (datos.gob.ar) para la web.

Entrada:  datos/crudo/provincias.geojson, departamentos.geojson, localidades.json
Salida:   datos/mapa.json         limites de provincias y departamentos
          datos/localidades.json  buscador de localidades (punto a ~1 km)

Uso: python herramientas/armar_datos.py
"""
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CRUDO = RAIZ / "datos" / "crudo"
ESCALA = 1000  # 3 decimales, unos 100 m


def anillos(geom):
    if geom["type"] == "Polygon":
        return list(geom["coordinates"])
    return [a for pol in geom["coordinates"] for a in pol]


def codificar(anillo):
    """Lista plana de enteros: primer punto absoluto, el resto en diferencias."""
    pts = []
    for lon, lat in anillo:
        p = (round(lon * ESCALA), round(lat * ESCALA))
        if not pts or pts[-1] != p:
            pts.append(p)
    if len(pts) < 4:
        return None
    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    # afuera: Antartida e islas lejanas del Atlantico Sur (quedan las Malvinas)
    if max(lats) < -56 * ESCALA or min(lons) > -50 * ESCALA:
        return None
    # afuera: islotes de menos de ~1 km
    if max(lons) - min(lons) < 12 and max(lats) - min(lats) < 12:
        return None
    plano = [pts[0][0], pts[0][1]]
    for a, b in zip(pts, pts[1:]):
        plano += [b[0] - a[0], b[1] - a[1]]
    return plano


def capa(archivo, con_centro):
    datos = json.loads((CRUDO / archivo).read_text(encoding="utf8"))
    salida = []
    for f in datos["features"]:
        rs = [r for r in (codificar(a) for a in anillos(f["geometry"])) if r]
        if not rs:
            continue
        p = f["properties"]
        item = {"n": p["nombre"], "r": rs}
        if con_centro:
            c = p["centroide"]
            item["c"] = [round(c["lon"], 2), round(c["lat"], 2)]
        salida.append(item)
    return salida


def localidades():
    datos = json.loads((CRUDO / "localidades.json").read_text(encoding="utf8"))
    provs, filas, vistos = [], [], set()
    for x in datos["localidades"]:
        prov = x["provincia"]["nombre"]
        if prov not in provs:
            provs.append(prov)
        dep = x["departamento"]["nombre"] or ""
        clave = (x["nombre"], dep, prov)
        if clave in vistos:
            continue
        vistos.add(clave)
        c = x["centroide"]
        filas.append([x["nombre"], dep, provs.index(prov), round(c["lat"], 2), round(c["lon"], 2)])
    filas.sort(key=lambda f: f[0])
    return {"provincias": provs, "localidades": filas}


def guardar(nombre, obj):
    ruta = RAIZ / "datos" / nombre
    ruta.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    print(f"{nombre}: {ruta.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    guardar("mapa.json", {"escala": ESCALA,
                          "provincias": capa("provincias.geojson", False),
                          "departamentos": capa("departamentos.geojson", True)})
    loc = localidades()
    guardar("localidades.json", loc)
    print(len(loc["localidades"]), "localidades")
