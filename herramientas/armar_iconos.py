"""Dibuja los íconos de Cuándo viene (para el aviso y la pestaña).

  motor/icono.png     192 px, cuadrado amarillo con "¿?" (se ve en la notificación)
  motor/insignia.png   96 px, "¿?" blanco sobre transparente (la barra de Android lo pinta de un color)

Uso: python herramientas/armar_iconos.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
FUENTE = str(RAIZ / "motor" / "fuentes" / "ArchivoBlack-Regular.ttf")


def centrado(d, caja, texto, tam, color):
    f = ImageFont.truetype(FUENTE, tam)
    x0, y0, x1, y1 = d.textbbox((0, 0), texto, font=f)
    d.text(((caja - (x1 - x0)) / 2 - x0, (caja - (y1 - y0)) / 2 - y0), texto, font=f, fill=color)


icono = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
d = ImageDraw.Draw(icono)
d.rounded_rectangle([0, 0, 191, 191], radius=40, fill="#ffcc33")
centrado(d, 192, "¿?", 112, "#14110f")
icono.save(RAIZ / "motor" / "icono.png", optimize=True)

insignia = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
centrado(ImageDraw.Draw(insignia), 96, "¿?", 70, "#ffffff")
insignia.save(RAIZ / "motor" / "insignia.png", optimize=True)
print("íconos listos")
