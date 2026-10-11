# Putzplan

Gemeinsamer Putzplan für zwei Personen als Web-App (PWA). Läuft auf iPhone und Android über den Homescreen, ohne App Store und ohne Benutzerkonto.

- Wochenansicht und Monatsansicht
- Aufgaben mit Fälligkeit, Kategorie, Zeitaufwand und Zuweisung
- Erledigt-Haken, wöchentliche oder monatliche Wiederholung
- Beide Geräte sind über einen 6-stelligen Haushaltscode verbunden und gleichen sich automatisch ab

**Einrichtung:** siehe [SETUP.md](SETUP.md).

## Aufbau

```
docs/      App (statisch, wird von GitHub Pages ausgeliefert)
  index.html            die ganze App: Oberfläche, Logik, Sync
  sw.js                 Offline-Cache
  manifest.webmanifest  Name und Icons für die Installation
worker/    Backend (Cloudflare Worker + D1-Datenbank)
  src/index.js          API: Haushalt anlegen, Code prüfen, Aufgaben synchronisieren
  wrangler.toml         Worker-Name und Datenbank-Verknüpfung
```

Anpassen ohne Programmieren: oben im `<script>`-Teil von `docs/index.html` stehen Backend-Adresse, Namen, Kategorien und das Abfrage-Intervall.
