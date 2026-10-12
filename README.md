# Haushalt

Gemeinsame Haushalts-App für zwei Personen als Web-App (PWA): Putzplan, Einkaufsliste, Rezepte, Essensplan und Notizen. Läuft auf iPhone und Android über den Homescreen, ohne App Store und ohne Benutzerkonto.

- Vier Reiter unten: Putzen (umschaltbar Heute · Woche · Monat · Bilanz), Einkauf (Liste · Vorrat · Rezepte · Essen), Notizen, Zuhause (Übersicht mit Pinnwand · Geburtstage · Wünsche · Geräte), Einstellungen
- Rezepte: Zutaten untereinander eintragen, Portionen umrechnen, ausgewählte Zutaten mit einem Tipp auf die Einkaufsliste; Import und Export als JSON (siehe unten)
- Vorrat: was zu Hause ist; „Knapp“/„Leer“ setzt es auf die Einkaufsliste, Abhaken beim Einkauf füllt wieder auf, Rezepte wählen Vorhandenes ab
- Pinnwand für Nachrichten aneinander, Geburtstage mit Erinnerung, Anschaffungen, Geräte mit Garantie, Anleitung und Wartung
- Mitteilungen: täglich (Aufgaben, Geburtstage), Wochenrückblick am Sonntag, Pinnwand und neue Sachen auf der Liste sofort ans andere Handy
- Eigene Laden-Reihenfolge, Kurzbefehle am App-Symbol (Android)
- Essensplan: Rezepte oder freie Gerichte auf Wochentage legen, alle Zutaten der Woche zusammengefasst auf die Einkaufsliste
- Checklisten in Aufgaben (z. B. Spiegel, Waschbecken, Fugen); Löschen mit „Rückgängig“; Komplett-Sicherung als Datei
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

Bis Version 2.1 hieß die App „Putzplan“. Technische Namen (Repo, Worker `putzplan-api`, Datenbank `putzplan`, Speicher-Schlüssel) bleiben, damit Adresse, Daten und Installationen gleich bleiben.

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
  src/index.js          API: Haushalt anlegen, Code prüfen, alles synchronisieren, Erinnerungen, Aufräumen
  wrangler.toml         Worker-Name, Datenbank-Verknüpfung, Ordner der App
tests/     Ende-zu-Ende-Tests (Playwright gegen den lokalen Worker)
.github/workflows/tests.yml           Tests bei jedem Push und vor jeder Veröffentlichung
.github/workflows/deploy-worker.yml   veröffentlicht App und Backend auf main, nur wenn die Tests bestehen
```

## Tests

Die Tests öffnen die App in einem echten Chromium (Handy-Größe), mit zwei „Geräten“ und einem nachgebauten Push-Dienst. Auf GitHub laufen sie automatisch. Lokal:

```bash
cd worker && npm ci && npx wrangler dev --port 8787 --ip 127.0.0.1 --test-scheduled --var ALLOW_LOCAL_PUSH:1
# in einem zweiten Terminal:
cd tests && npm ci && npx playwright install chromium && npm test
npm test -- rezept   # nur Tests, deren Dateiname „rezept“ enthält
```

Unter „Einstellungen“ stehen Haushaltscode, Namen, Mitteilungen („Dieses Handy gehört“), Urlaub, Laden-Reihenfolge, Startpaket, Sicherung, installierte Version und „Nach Update suchen“.

**Neue Version veröffentlichen:** Versionsnummer an zwei Stellen erhöhen, `APP_VERSION` in `docs/index.html` und `version` in `docs/version.json` (dort auch Datum und Neuerungen eintragen).

Oben im `<script>`-Teil von `docs/index.html` stehen außerdem Backend-Adresse, Kategorien (mit Symbolen) und das Abfrage-Intervall.
