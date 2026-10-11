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
