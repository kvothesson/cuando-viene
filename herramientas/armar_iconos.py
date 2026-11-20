"""Dibuja los íconos de Cuándo viene (para el aviso y la pestaña).

  motor/icono.png     192 px, una entrada de teatro amarilla con "CV" (se ve en la notificación)
  motor/insignia.png   96 px, la misma entrada en blanco sobre transparente (la barra de Android la pinta de un color)

Es una entrada y no un signo de pregunta: suelto en una notificación, "¿?" se lee como algo desconocido o un error.

Uso: python herramientas/armar_iconos.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
FUENTE = str(RAIZ / "motor" / "fuentes" / "ArchivoBlack-Regular.ttf")
AMARILLO, OSCURO = "#ffcc33", "#14110f"
S = 4  # se dibuja grande y se achica, para bordes suaves


def entrada(lado, color, fondo, con_letras):
    """Una entrada con muescas a los costados y línea de corte. fondo=None deja transparente."""
    u = lado / 192 * S
    im = Image.new("RGBA", (lado * S, lado * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if fondo:
        d.rounded_rectangle([0, 0, lado * S - 1, lado * S - 1], radius=40 * u, fill=fondo)
    hueco = fondo or (0, 0, 0, 0)
    x0, y0, x1, y1 = 22 * u, 52 * u, 170 * u, 140 * u
    d.rounded_rectangle([x0, y0, x1, y1], radius=12 * u, fill=color)
    r = 13 * u
    for cx in (x0, x1):  # las muescas
        d.ellipse([cx - r, 96 * u - r, cx + r, 96 * u + r], fill=hueco)
    px, y = 122 * u, y0 + 10 * u
    while y < y1 - 8 * u:  # la línea de corte
        d.rounded_rectangle([px - 2 * u, y, px + 2 * u, y + 7 * u], radius=2 * u, fill=hueco)
        y += 13 * u
    if con_letras:
        f = ImageFont.truetype(FUENTE, int(44 * u))
        a, b, c, e = d.textbbox((0, 0), "CV", font=f)
        d.text((78 * u - (c - a) / 2 - a, 96 * u - (e - b) / 2 - b), "CV", font=f, fill=fondo)
    return im.resize((lado, lado), Image.LANCZOS)


entrada(192, AMARILLO, OSCURO, True).save(RAIZ / "motor" / "icono.png", optimize=True)
entrada(96, "#ffffff", None, False).save(RAIZ / "motor" / "insignia.png", optimize=True)
print("íconos listos")
