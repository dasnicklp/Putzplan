# Putzplan

Gemeinsamer Putzplan für zwei Personen als Web-App (PWA). Läuft auf iPhone und Android über den Homescreen, ohne App Store und ohne Benutzerkonto.

- Wochenansicht und Monatsansicht
- Aufgaben mit Fälligkeit, Kategorie, Zeitaufwand und Zuweisung
- Erledigt-Haken, wöchentliche oder monatliche Wiederholung
- Filter nach Person, Wochenbilanz (wer hat wie viel erledigt), Titelvorschläge beim Eintragen
- Wischen nach links/rechts wechselt Woche bzw. Monat
- Beide Geräte sind über einen 6-stelligen Haushaltscode verbunden und gleichen sich automatisch ab, auch die Namen

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
.github/workflows/deploy-worker.yml   veröffentlicht das Backend automatisch bei Änderungen auf main
```

Namen ändert ihr direkt in der App unter ⚙︎. Oben im `<script>`-Teil von `docs/index.html` stehen außerdem Backend-Adresse, Kategorien (mit Symbolen) und das Abfrage-Intervall.
