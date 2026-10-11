# Putzplan

Gemeinsamer Putzplan für zwei Personen als Web-App (PWA). Läuft auf iPhone und Android über den Homescreen, ohne App Store und ohne Benutzerkonto.

- Wochenansicht und Monatsansicht
- Aufgaben mit Fälligkeit, Kategorie, Zeitaufwand und Zuweisung
- Erledigt-Haken, wöchentliche oder monatliche Wiederholung
- Beide Geräte sind über einen 6-stelligen Haushaltscode verbunden und gleichen sich automatisch ab

**Einrichtung:** siehe [SETUP.md](SETUP.md).

## Aufbau

```
docs/      App (statisch, wird vom Worker mit ausgeliefert)
  index.html            die ganze App: Oberfläche, Logik, Sync
  sw.js                 Offline-Cache
  manifest.webmanifest  Name und Icons für die Installation
worker/    Backend (Cloudflare Worker + D1-Datenbank)
  src/index.js          API: Haushalt anlegen, Code prüfen, Aufgaben synchronisieren
  wrangler.toml         Worker-Name, Datenbank-Verknüpfung, Ordner der App
.github/workflows/deploy-worker.yml   veröffentlicht App und Backend automatisch bei Änderungen auf main
```

**App-Adresse:** <https://putzplan-api.n-kudenholdt2000.workers.dev/>

Anpassen ohne Programmieren: oben im `<script>`-Teil von `docs/index.html` stehen Namen, Kategorien und das Abfrage-Intervall.
