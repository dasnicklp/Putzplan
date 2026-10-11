# Putzplan

Gemeinsamer Putzplan für zwei Personen als Web-App (PWA). Läuft auf iPhone und Android über den Homescreen, ohne App Store und ohne Benutzerkonto.

- Reiter unten: Heute, Woche, Monat, Notizen, Bilanz, Haushalt
- Gemeinsame Notizen mit Kategorien (Filter, eigene Kategorien, Anheften)
- Heute-Ansicht (Überfälliges, heute, morgen), Monatsansicht und Wochenansicht mit den 7 Tagen nebeneinander, darunter die Aufgaben des gewählten Tags
- Bilanz: wer hat wie viel erledigt, über 8 Wochen und nach Kategorie
- Aufgaben mit Fälligkeit, Kategorie, Zeitaufwand und Zuweisung
- Erledigt-Haken, wöchentliche oder monatliche Wiederholung
- Filter nach Person, Wochenbilanz (wer hat wie viel erledigt), Titelvorschläge beim Eintragen
- Wischen nach links/rechts wechselt Woche bzw. Monat
- Beide Geräte sind über einen 6-stelligen Haushaltscode verbunden und gleichen sich automatisch ab, auch die Namen

**App öffnen:** <https://putzplan-api.n-kudenholdt2000.workers.dev/> (alternativ <https://dasnicklp.github.io/Putzplan/>, gleiche Daten)

**Einrichtung:** siehe [SETUP.md](SETUP.md).

## Aufbau

```
docs/      App (statisch; ausgeliefert vom Worker und zusätzlich von GitHub Pages)
  index.html            die ganze App: Oberfläche, Logik, Sync
  sw.js                 Offline-Cache
  manifest.webmanifest  Name und Icons für die Installation
worker/    Backend (Cloudflare Worker + D1-Datenbank)
  src/index.js          API: Haushalt anlegen, Code prüfen, Aufgaben synchronisieren
  wrangler.toml         Worker-Name, Datenbank-Verknüpfung, Ordner der App
.github/workflows/deploy-worker.yml   veröffentlicht App und Backend automatisch bei Änderungen auf main
```

Namen ändert ihr direkt in der App im Reiter „Haushalt“. Dort steht auch die installierte Version, und „Nach Update suchen“ zeigt die aktuellste.

**Neue Version veröffentlichen:** Versionsnummer an zwei Stellen erhöhen, `APP_VERSION` in `docs/index.html` und `version` in `docs/version.json` (dort auch Datum und Neuerungen eintragen).

Oben im `<script>`-Teil von `docs/index.html` stehen außerdem Backend-Adresse, Kategorien (mit Symbolen) und das Abfrage-Intervall.
