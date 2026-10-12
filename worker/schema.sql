-- Wird beim ersten Aufruf automatisch angelegt (siehe src/index.js, init()).
-- Nur zur Dokumentation und für manuelles Nachsehen.
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,          -- SHA-256 des Haushaltscodes
  data TEXT NOT NULL,           -- JSON: { "tasks": [...] }
  updated_at INTEGER NOT NULL   -- für die optimistische Sperre
);
CREATE TABLE IF NOT EXISTS attempts (
  ip TEXT PRIMARY KEY,          -- Hash der IP, für die Fehlversuch-Sperre
  fails INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS config (
  k TEXT PRIMARY KEY,           -- z. B. 'vapid': Schlüssel für Push (wird automatisch erzeugt)
  v TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,    -- Push-Adresse des Geräts
  household TEXT NOT NULL,      -- Haushalts-ID
  p256dh TEXT NOT NULL, auth TEXT NOT NULL,  -- Schlüssel des Geräts zum Verschlüsseln
  person TEXT NOT NULL,         -- 'nick', 'partner' oder '' (alle)
  time TEXT NOT NULL,           -- Uhrzeit HH:MM
  tz TEXT NOT NULL,             -- Zeitzone des Geräts
  last_sent TEXT NOT NULL DEFAULT '',  -- Datum der letzten Erinnerung
  created INTEGER NOT NULL,
  opts TEXT NOT NULL DEFAULT '{}',     -- Mitteilungs-Arten: daily, weekly, msgs, shop
  last_weekly TEXT NOT NULL DEFAULT '' -- Datum des letzten Wochenrückblicks
);
