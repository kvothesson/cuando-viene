# Backlog de Cuándo viene

Lo que falta, en orden. Cada punto dice qué es, por qué importa y cómo se sabe que está hecho.

## Ahora

### 1. Que el artista pueda poner esto en su propia página

**Qué:** una versión para incrustar. El artista pega dos líneas en su sitio y aparece el mapa con sus fechas, el buscador de ciudad y el aviso.

**Por qué:** es la mejor forma de crecer sin promoción. El público ya está en la página del artista, y a él le resuelve algo que hoy no tiene: avisarle a cada persona solo de la fecha que le queda cerca.

**Cómo se usaría:**

```html
<div data-cuando-viene="lucho-mellera"></div>
<script async src="https://kvothesson.com/cuando-viene/incrustar.js"></script>
```

O, para quien no puede cargar scripts (Wix, Linktree, algunos WordPress), un marco directo:

```html
<iframe src="https://kvothesson.com/cuando-viene/lucho-mellera/?incrustado"
        title="Fechas de Lucho Mellera cerca tuyo" loading="lazy"
        style="width:100%;height:640px;border:0"></iframe>
```

**Cómo se arma:**

- Un modo `?incrustado` en la página que ya existe: saca el título, las migas y el texto para buscadores, y deja solo el tablero. No hay una segunda página que mantener.
- `incrustar.js` es chico: busca los `data-cuando-viene`, crea el marco y le ajusta el alto solo.
- Opciones por atributo: `data-color` (el color de marca del artista), `data-tema="claro"`, `data-pais` y `data-ciudad` para arrancar parado en un lugar.
- Una página `/incrustar/` donde se elige el artista y el color, se ve la vista previa y se copia el código.

**Lo que hay que resolver:**

- Los navegadores no dejan pedir permiso de notificaciones desde un marco de otro sitio. Dentro del marco, "Avisame en este celular" tiene que abrir la página completa en otra pestaña con la ciudad y el radio ya puestos. "Por Telegram" funciona igual, porque es un enlace.
- La página incrustada no debe competir en buscadores con la original: lleva `noindex`.
- Las métricas tienen que distinguir de qué sitio vino cada uso, para poder mostrarle al artista cuánto se usa en el suyo.

**Hecho cuando:** una página de prueba en otro dominio muestra el tablero con dos líneas pegadas, se puede elegir ciudad, y el aviso por Telegram queda activado sin salir de ahí.

### 2. No contar las visitas propias

**Qué:** abrir la página una vez con `?soyyo` y que ese navegador deje de sumar a las métricas.

**Por qué:** hoy casi todo lo medido son pruebas, y no se puede separar del público real.

**Hecho cuando:** con la marca puesta, el tablero no cambia al navegar.

### 3. Mostrar si Telegram ya está activo

**Qué:** hoy la página sabe si este aparato tiene el aviso, pero no si la persona ya activó Telegram. El botón dice siempre "Por Telegram".

**Cómo:** al volver del bot, la página puede preguntarle al robot si ese enlace se usó, y recordarlo en el navegador.

**Hecho cuando:** después de tocar "Iniciar" en el bot, el botón pasa a decir "✓ Activo por Telegram".

### 4. Rosario antes que Rosales

**Qué:** en Argentina el buscador ordena por coincidencia y no por tamaño de la localidad, porque los datos oficiales no traen población.

**Cómo:** cruzar las localidades con el censo y guardar la población en `localidades.json`.

**Hecho cuando:** "san" muestra primero las ciudades grandes.

### 5. Poner al día la explicación de la arquitectura

Falta Telegram: qué se guarda (el número del chat con el bot) y el recorrido del aviso por ahí.

## Pronto

### 6. Segundo artista

Nico de Tracy. Es la prueba de que sumar uno es de verdad una entrada en `artistas.json`. Si su agenda tiene otro formato, necesita su lector en `nube/fuentes.js`.

### 7. Avisar cuando se liberan entradas

Hoy solo se avisa por fechas nuevas. Si una fecha agotada vuelve a tener entradas, o suman una función en la misma ciudad, es justo lo que alguien cerca quiere saber.

### 8. Mail como tercer canal

Para quien no usa Telegram. Tiene tope de 100 por día en el plan gratis, así que va por orden de llegada y la página lo dice cuando el cupo se llena.

### 9. Revisar las páginas por ciudad en Google

El 20 de noviembre de 2026 había 15 páginas de ciudad "rastreadas, sin indexar". Mirar de nuevo a mediados de diciembre. Si siguen afuera, bajar el tope de ciudades sin fecha.

### 10. Probar con un lector de pantalla de verdad

La estructura está revisada, pero nadie lo escuchó con TalkBack ni con NVDA. Anotar lo que suene mal y corregirlo.

### 11. Que el robot avise solo cuando algo se rompe

El aviso al dueño por Telegram ya existe (`/dueno`). Falta activarlo y sumar un chequeo: si el robot no corrió en 6 horas, que también avise.

### 12. Regenerar las páginas cuando cambia una fecha

Hoy se reescriben una vez por día. Al abrir la página las fechas están al día igual, pero la copia que lee Google puede tener hasta 24 horas de atraso.

## Después

- **Pedí tu artista.** Un botón que suma un voto por artista, sin datos personales, para decidir a quién sumar.
- **Otros idiomas.** Inglés y portugués, cuando haya artistas que giren por ahí.
- **Ciudades chicas del resto del mundo.** Hoy, sin elegir país, se encuentran las de más de 100.000 habitantes.
- **Más de 57.000 avisos por día.** Es el techo del despacho en el plan gratis. Antes de llegar hay que repartir el envío en varias tandas en paralelo.
- **Calendario.** Se sacó de la página porque no avisa y Google tarda un día en mostrar la fecha. El robot conserva `/cal/` por si vuelve como extra.

## Riesgos que ningún punto de arriba resuelve

- **Si el artista anuncia solo en redes**, no hay fuente que leer hasta que alguien lo cargue en una página.
- **Si las fuentes cambian de formato**, el robot deja de leer hasta que se arregle el lector. Tener dos fuentes por artista baja el riesgo, no lo elimina.
- **Si Cloudflare o GitHub cambian el plan gratis**, hay que mudar piezas.
