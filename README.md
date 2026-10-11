# Putzplan

Gemeinsamer Putzplan für zwei Personen als Web-App (PWA). Läuft auf iPhone und Android über den Homescreen, ohne App Store und ohne Benutzerkonto.

- Vier Reiter unten: Putzen (umschaltbar Heute · Woche · Monat · Bilanz), Einkauf (umschaltbar Liste · Rezepte), Notizen, Haushalt
- Rezepte: Zutaten untereinander eintragen, Portionen umrechnen, ausgewählte Zutaten mit einem Tipp auf die Einkaufsliste; Import und Export als JSON (siehe unten)
- Gemeinsame Einkaufsliste: schnell eintippen („2 Milch“), automatisch nach Bereichen im Laden sortiert, Abhaken, Vorschläge aus dem Verlauf
- Gemeinsame Notizen mit Kategorien (Filter, eigene Kategorien, Anheften)
- Heute-Ansicht (Überfälliges, heute, morgen), Monatsansicht und Wochenansicht mit den 7 Tagen nebeneinander, darunter die Aufgaben des gewählten Tags
- Bilanz: zuletzt geputzt pro Bereich, wer hat wie viel erledigt, über 8 Wochen und nach Kategorie
- Aufgaben mit Fälligkeit, Kategorie, Zeitaufwand und Zuweisung
- Erledigt-Haken; Wiederholung täglich, wöchentlich, alle 2 Wochen, monatlich, alle 3 Monate oder alle N Tage, wahlweise ab dem Erledigen
- Abwechselnd zuweisen: nach dem Erledigen ist die andere Person dran
- Verschieben mit einem Tipp (morgen, übermorgen, Wochenende, nächste Woche)
- Tägliche Erinnerung per Mitteilung (Web Push), Zahl offener Aufgaben am App-Symbol
- Urlaubsmodus, Startpaket mit typischen Putzaufgaben, Serie und Konfetti, wenn alles erledigt ist
- Einkaufsliste: mehrere Einträge auf einmal (Komma oder Zeilen), auf Android über „Teilen → Putzplan“
- Filter nach Person, Wochenbilanz (wer hat wie viel erledigt), Titelvorschläge beim Eintragen
- Wischen nach links/rechts wechselt Woche bzw. Monat
- Beide Geräte sind über einen 6-stelligen Haushaltscode verbunden und gleichen sich automatisch ab, auch die Namen

**App öffnen:** <https://putzplan-api.n-kudenholdt2000.workers.dev/> (alternativ <https://dasnicklp.github.io/Putzplan/>, gleiche Daten)

**Einrichtung:** siehe [SETUP.md](SETUP.md).

## Rezepte importieren

Im Reiter „Einkauf“ → „Rezepte“ → „Importieren“: JSON einfügen oder eine Datei wählen. Vor dem Übernehmen zeigt die App, was sie erkannt hat. Ein Rezept mit gleichem Namen wird ersetzt.

```json
{
  "recipes": [
    {
      "title": "Pfannkuchen",
      "servings": 2,
      "ingredients": ["250 g Mehl", "500 ml Milch", "3 Eier", "1 Prise Salz"],
      "steps": ["Alles glatt rühren.", "10 Minuten quellen lassen.", "In Butter ausbacken."],
      "link": "https://…"
    }
  ]
}
```

- Nur `title` ist Pflicht. Statt der Liste geht auch ein einzelnes Rezept-Objekt oder ein Array von Rezepten.
- `ingredients` und `steps` dürfen auch Text mit Zeilenumbrüchen sein; Zutaten auch als Objekte `{ "menge": 250, "einheit": "g", "name": "Mehl" }`.
- Deutsche Feldnamen gehen auch: `titel`, `portionen`, `zutaten`, `zubereitung`, `quelle`.
- Das Rezept-Format von Rezeptseiten (schema.org `Recipe`, z. B. `recipeIngredient`, `recipeInstructions`) wird erkannt, ebenso JSON mit ```json-Rahmen oder Text drumherum (z. B. aus einem Chat).
- „Exportieren“ erzeugt genau dieses Format, zum Sichern oder Weitergeben.
- Tipp: Einen Chat-Assistenten bitten „Gib mir das Rezept als JSON mit title, servings, ingredients und steps“ und die Antwort einfügen.

## Aufbau

```
docs/      App (statisch; ausgeliefert vom Worker und zusätzlich von GitHub Pages)
  index.html            die ganze App: Oberfläche, Logik, Sync
  sw.js                 Offline-Cache
  manifest.webmanifest  Name und Icons für die Installation
worker/    Backend (Cloudflare Worker + D1-Datenbank)
  src/index.js          API: Haushalt anlegen, Code prüfen, Aufgaben/Einkaufsliste/Rezepte/Notizen synchronisieren, Erinnerungen
  wrangler.toml         Worker-Name, Datenbank-Verknüpfung, Ordner der App
.github/workflows/deploy-worker.yml   veröffentlicht App und Backend automatisch bei Änderungen auf main
```

Namen ändert ihr direkt in der App im Reiter „Haushalt“. Dort steht auch die installierte Version, und „Nach Update suchen“ zeigt die aktuellste.

**Neue Version veröffentlichen:** Versionsnummer an zwei Stellen erhöhen, `APP_VERSION` in `docs/index.html` und `version` in `docs/version.json` (dort auch Datum und Neuerungen eintragen).

Oben im `<script>`-Teil von `docs/index.html` stehen außerdem Backend-Adresse, Kategorien (mit Symbolen) und das Abfrage-Intervall.
