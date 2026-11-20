# Cuándo viene

Fechas de tus artistas en un mapa, con aviso gratis cuando anuncien un show cerca tuyo.
En vivo: https://kvothesson.com/cuando-viene/

Páginas de fans, no oficiales. Sin cuenta, sin mail y sin guardar direcciones: solo la localidad que elegís.

## Cómo está armado

- `artistas.json`: un artista por entrada (nombre, tipo, color y de dónde se leen sus fechas).
- `plantilla.html` + `motor/`: la página y el mapa, dibujado por código con datos abiertos. No usa servicios de mapas.
- `herramientas/armar_paginas.py`: escribe las páginas con todo ya en el HTML: una por artista, una por país y una por ciudad (con fecha, o sin fecha con la más cercana), más la tarjeta para compartir. Corre solo una vez por día.
- `herramientas/armar_datos.py`: achica los datos de provincias, partidos y localidades.
- `herramientas/armar_mundo.py`: arma el contorno de los países, las ciudades de cada país para el buscador y la lista que usa el robot para ubicar fechas en cualquier lugar.
- `nube/`: el robot en Cloudflare. Lee las fechas cada 30 minutos, arma el calendario por localidad y manda las notificaciones.
- `sw.js`: recibe las notificaciones en el navegador.

## Sumar un artista

1. Agregar su entrada en `artistas.json`.
2. Si su página oficial tiene un formato nuevo, escribirle un lector en `nube/fuentes.js`.
3. `cd nube && npx cf deploy --secrets-file .secretos.json`
4. `python herramientas/armar_paginas.py`

## Datos

- Argentina (provincias, partidos y localidades): datos.gob.ar.
- Países: Natural Earth, dominio público.
- Ciudades del mundo: [GeoNames](https://www.geonames.org/), CC BY 4.0.
