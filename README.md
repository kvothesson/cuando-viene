# Cuándo viene

Fechas de tus artistas en un mapa, con aviso gratis cuando anuncien un show cerca tuyo.
En vivo: https://kvothesson.com/cuando-viene/

Páginas de fans, no oficiales. Sin cuenta, sin mail y sin guardar direcciones: solo la localidad que elegís.

## Cómo está armado

- `artistas.json`: un artista por entrada (nombre, tipo, color y de dónde se leen sus fechas).
- `plantilla.html` + `motor/`: la página y el mapa, dibujado por código con límites oficiales de datos.gob.ar. No usa servicios de mapas.
- `herramientas/armar_paginas.py`: escribe una página por artista con las fechas ya en el HTML. Corre solo una vez por día.
- `herramientas/armar_datos.py`: achica los datos de provincias, partidos y localidades.
- `nube/`: el robot en Cloudflare. Lee las fechas cada 30 minutos, arma el calendario por localidad y manda las notificaciones.
- `sw.js`: recibe las notificaciones en el navegador.

## Sumar un artista

1. Agregar su entrada en `artistas.json`.
2. Si su página oficial tiene un formato nuevo, escribirle un lector en `nube/fuentes.js`.
3. `cd nube && npx cf deploy --secrets-file .secretos.json`
4. `python herramientas/armar_paginas.py`
