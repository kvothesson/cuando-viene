-- Fechas de cada artista, juntadas de sus fuentes
CREATE TABLE IF NOT EXISTS fechas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artista TEXT NOT NULL,
  fecha TEXT NOT NULL,        -- AAAA-MM-DD
  hora TEXT,                  -- HH:MM, hora local del lugar
  lugar TEXT, ciudad TEXT, pais TEXT,
  lat REAL, lon REAL,
  tz TEXT,                    -- huso horario del lugar, por ejemplo Europe/Madrid
  link TEXT,
  agotado INTEGER DEFAULT 0,
  precio REAL, moneda TEXT,   -- precio "desde", si la fuente lo trae
  fuentes TEXT,               -- pogo, oficial o pogo+oficial
  visto TEXT,                 -- cuándo la vio el robot por primera vez
  ultima_vez TEXT             -- última corrida en que siguió apareciendo
);
CREATE INDEX IF NOT EXISTS fechas_idx ON fechas(artista, fecha);

-- Navegadores anotados para recibir avisos. Sin datos personales: solo la localidad elegida y el radio.
CREATE TABLE IF NOT EXISTS push (
  id TEXT PRIMARY KEY,        -- huella de la dirección de aviso + artista
  endpoint TEXT NOT NULL,     -- dirección que da el navegador para mandarle avisos
  artista TEXT NOT NULL,
  lat REAL NOT NULL, lon REAL NOT NULL,   -- centro de la localidad elegida
  km INTEGER NOT NULL,
  loc TEXT,                   -- nombre de la localidad
  creado TEXT,
  pendiente TEXT,             -- aviso que el navegador todavía no vino a buscar
  enviar INTEGER DEFAULT 0,
  intentos INTEGER DEFAULT 0,
  ultimo_envio TEXT
);
CREATE INDEX IF NOT EXISTS push_enviar ON push(enviar);
CREATE INDEX IF NOT EXISTS push_artista ON push(artista, lat);
CREATE INDEX IF NOT EXISTS push_endpoint ON push(endpoint);

-- Salud del robot: una fila por fuente y una por la última corrida
CREATE TABLE IF NOT EXISTS estado (
  clave TEXT PRIMARY KEY,
  ok INTEGER, detalle TEXT, ts TEXT, ultimo_ok TEXT
);

-- Métricas propias: un contador por día, artista, evento y valor. Nada que identifique a una persona.
CREATE TABLE IF NOT EXISTS metricas (
  dia TEXT NOT NULL,          -- AAAA-MM-DD, hora argentina
  artista TEXT NOT NULL,
  ev TEXT NOT NULL,           -- visita, localidad, radio, aviso, calendario, entradas
  clave TEXT NOT NULL DEFAULT '',  -- localidad elegida, tramo de radio o ciudad de la fecha
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, artista, ev, clave)
);

-- Avisos por Telegram: el chat con el bot, la ciudad elegida y el radio. Se borra con /baja.
CREATE TABLE IF NOT EXISTS tg (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat TEXT NOT NULL,         -- número del chat con el bot
  artista TEXT NOT NULL,
  lat REAL NOT NULL, lon REAL NOT NULL, km INTEGER NOT NULL, loc TEXT,
  creado TEXT,
  pendiente TEXT, enviar INTEGER DEFAULT 0,
  ultimo_contacto TEXT,       -- para el "sigo mirando"
  UNIQUE (chat, artista)
);
CREATE INDEX IF NOT EXISTS tg_enviar ON tg(enviar);
-- Enlaces de un solo uso entre la página y el bot. Duran un día.
CREATE TABLE IF NOT EXISTS tg_pedido (
  codigo TEXT PRIMARY KEY, artista TEXT, lat REAL, lon REAL, km INTEGER, loc TEXT, creado TEXT
);
