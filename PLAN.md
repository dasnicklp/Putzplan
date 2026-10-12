# Putzplan – Plan und Entscheidungen

## Ziel
Eine PWA für zwei Personen (Nick: Android/Windows, Freundin: iPhone). Installation über den Homescreen, kein App Store, keine Benutzerkonten.

## Architektur

```
Browser (Android / iPhone)  ──HTTPS──>  Cloudflare Worker  ──>  D1 (SQLite)
                                          /api/*  → worker/src/index.js
                                          sonst   → Dateien aus docs/ (Static Assets)
                          (zusätzlich: GitHub Pages liefert docs/ aus und ruft den Worker per CORS auf)
```

Aufbau nach dem Muster der Fokus-App (`dasnicklp/fokus-app`): eine `index.html` ohne Build-Schritt, Service Worker „Netzwerk zuerst“, Worker mit Bearer-Code und „neueste Änderung gewinnt“.

| Teil | Entscheidung | Begründung |
|---|---|---|
| Frontend | Eine `docs/index.html` mit HTML/CSS/JS, kein Build | Wie Fokus; nur eine Datei zum Anpassen |
| Hosting | Hauptadresse: der Worker liefert `docs/` als Static Assets mit aus. Zusätzlich GitHub Pages (`main`, `/docs`) | Eigene Domain für Putzplan: Chrome auf Android installierte Putzplan und Fokus auf derselben github.io-Domain nicht nebeneinander |
| Backend | Cloudflare Worker + D1 | Wie Fokus, Free-Tarif reicht |
| Haushalt | 6-stelliger Code, als `Authorization: Bearer <code>` gesendet, serverseitig nur als SHA-256 gespeichert | Kein Login; Code liegt im `localStorage` |
| Schutz | 5 falsche Codes pro IP → 15 Minuten Sperre | 6 Ziffern sind sonst in Kürze durchprobierbar |
| Speicher | Ein JSON-Datensatz pro Haushalt, optimistische Sperre über `updated_at` | Wie Fokus; bei zwei Personen ausreichend |
| Sync | `POST /api/sync` beim Öffnen, bei Änderungen und alle 12 s solange die App sichtbar ist | Einfach, robust |
| Konflikte | Pro Aufgabe gewinnt die neuere Änderung (`updatedAt`), Löschen als Markierung (60 Tage) | Damit Löschungen auch auf dem anderen Gerät ankommen |
| Offline | Letzter Stand im `localStorage`, App-Dateien im Service-Worker-Cache | App startet auch ohne Netz |

## API

| Methode | Route | Zweck |
|---|---|---|
| POST | `/api/household` | Neuen Haushalt anlegen, gibt einmalig den Code zurück |
| POST | `/api/join` | Code prüfen (200 / 401 / 429) |
| GET | `/api/push/key` | Öffentlicher Schlüssel für die Push-Anmeldung (VAPID, wird beim ersten Mal erzeugt und in D1 gespeichert) |
| POST | `/api/push/subscribe` | Gerät für die tägliche Erinnerung anmelden: Push-Adresse, Person, Uhrzeit, Zeitzone |
| POST | `/api/push/unsubscribe` | Abmelden |
| POST | `/api/push/test` | Sofort eine Erinnerung schicken |
| POST | `/api/sync` | Aufgaben, Notizen, Einkaufsliste, Rezepte und Einstellungen senden, zusammengeführten Stand zurückbekommen |

## Aufgabe (Datenmodell)

`id, title, due (YYYY-MM-DD), category, minutes, assignee ('nick' | 'partner' | null), repeat ('none' | 'weekly' | 'monthly'), done, doneAt, createdAt, updatedAt, deleted`

## Umgesetzt (Phase 1)

1. Wochenansicht (Standard) mit Umschalter zur Monatsansicht, vor/zurück, „Heute“, Überfällig-Liste
2. Aufgaben anlegen, bearbeiten, löschen: Titel, Fälligkeit, Kategorie, Minuten, Zuweisung
3. Erledigt per Antippen; Summe offener Minuten pro Tag und Woche
4. Wiederholung (einfach): Beim Erledigen entsteht die nächste Aufgabe (+7 Tage bzw. +1 Monat)
5. iPhone: Safe-Areas, 16 px in Eingabefeldern (kein Zoom), `100dvh`, Apple-Touch-Icon, Homescreen-Hinweis

## Umgesetzt (Phase 2)

- Filter nach Person (Alle / Person 1 / Person 2 / Offen), pro Gerät gemerkt
- Wochenbilanz: erledigte Minuten und Anzahl pro Person (nach Erledigt-Zeitpunkt)
- Namen in der App änderbar, über den Server synchronisiert (`settings` im Haushalts-Datensatz, neuere Änderung gewinnt)
- Kategorie-Symbole, Farben pro Person, kompakte leere Tage
- Titelvorschläge; bekannter Titel übernimmt Kategorie, Minuten, Zuweisung, Wiederholung
- Wischen für vorige/nächste Woche bzw. Monat, kurze Vibration beim Erledigen (Android)
- Wiederholung: überfällige Aufgaben springen beim Erledigen auf einen Termin ab heute; kein doppelter Folgetermin

## Umgesetzt (Phase 3)

- Tab-Leiste unten: Heute · Woche · Monat · Bilanz · Haushalt (letzter Reiter wird pro Gerät gemerkt)
- Heute: Überfällig, heute, morgen
- Bilanz: aktuelle Woche, gestapelte Minuten pro Person für 8 Kalenderwochen (Antippen zeigt Werte), Gesamt mit Anteil, Minuten nach Kategorie
- Haushalt: Code, Synchronisation, Namen, Version/Update, Abmelden (vorher Einstellungs-Overlay)
- Personenfarben Blau `#2a78d6`/`#3987e5` und Orange `#eb6834`/`#d95926` (hell/dunkel), mit dem dataviz-Validator geprüft: auch bei Farbschwäche klar unterscheidbar (vorher Blau/Lila, das fiel bei Rot-Grün-Schwäche durch)

## Umgesetzt (Phase 4)

- Woche: Tagesleiste mit 7 Tagen nebeneinander (Wochentag, Datum, Anzahl offener Aufgaben bzw. ✓), darunter die Aufgaben des gewählten Tags, danach Überfälliges; beim Wochenwechsel bleibt der Wochentag ausgewählt

## Umgesetzt (Phase 5)

- Reiter „Notizen“: gemeinsame Notizen (`id, title, body, cat, pinned, createdAt, updatedAt, deleted`), synchronisiert wie Aufgaben (neuere Änderung gewinnt pro Notiz, Löschmarkierung 60 Tage)
- Kategorien nach dem Muster der Fokus-App: eine pro Notiz, ergeben sich aus den Notizen selbst, Filter-Chips (Alle / Kategorien / Ohne Kategorie), „＋ Neu“, gleiche Schreibweise wird zusammengeführt; Vorschläge Putztipps, Info, Ideen (seit 1.7 „Einkaufen“ nicht mehr, dafür gibt es die Einkaufsliste)
- Ältere App-Versionen ohne Notizen löschen beim Synchronisieren keine Notizen (Server behält sie)

## Umgesetzt (Phase 6)

- Reiter unten von sechs auf vier verschlankt: **Putzen** (oben umschaltbar Heute · Woche · Monat · Bilanz), **Einkauf**, **Notizen**, **Haushalt**. Ein gemerkter alter Reiter (z. B. „Woche“) wird beim ersten Start übernommen.
- Gemeinsame Einkaufsliste (`id, name, qty, cat, done, doneAt, createdAt, updatedAt, deleted`), synchronisiert wie Aufgaben und Notizen
  - Eingabefeld oben: Enter fügt hinzu, „2 Milch“ / „500 g Mehl“ trennt die Menge ab; doppelter Eintrag wird erkannt
  - Automatische Einordnung nach Bereichen im Laden (Stichwörter, Treffer am Wortende zählen mehr; sonst wie beim letzten Mal)
  - Abhaken schiebt den Eintrag nach „Im Wagen“; „Erledigte entfernen“ räumt auf
  - Vorschläge aus dem Verlauf der letzten 60 Tage, häufigste zuerst; Zahl offener Einträge am Reiter
- Ältere App-Versionen ohne Einkaufsliste löschen beim Synchronisieren nichts (Server behält sie)

## Umgesetzt (Phase 7, 1.8.0)

- **Erinnerungen per Web Push:** Gerät meldet sich im Reiter „Haushalt“ an (Person, Uhrzeit). Ein Cron-Trigger (alle 15 Minuten) schickt einmal am Tag die offenen Aufgaben bis heute (Person plus nicht zugewiesene), nur wenn etwas ansteht, bis 3 Stunden nachgeholt. Inhalt verschlüsselt nach RFC 8291 (aes128gcm), signiert mit VAPID; das Schlüsselpaar erzeugt der Worker selbst und legt es in D1 ab (Tabelle `config`), Anmeldungen in `push_subs`. Nur bekannte Push-Dienste (Google, Apple, Mozilla, Microsoft) werden angeschrieben. iPhone: nur in der Homescreen-App, ab iOS 16.4
- **Zahl am App-Symbol** (Badging API): offene Aufgaben bis heute; Windows/Mac und iPhone (mit erlaubten Mitteilungen), Android zeigt stattdessen einen Punkt bei Mitteilungen
- **Wiederholung:** `repeat` ('days' | 'weekly' | 'monthly') mit `every` (alle N) und `fromDone` (ab dem Erledigen statt im festen Rhythmus)
- **Abwechselnd zuweisen** (`rotate`): der Folgetermin geht an die andere Person
- **Verschieben** über den ↷-Knopf an jeder offenen Aufgabe
- **Zuletzt geputzt** pro Bereich in der Bilanz; fällig (⚠), wenn länger her als der kürzeste Rhythmus dort, höchstens 14 Tage
- **Serie** (Putztage in Folge alles erledigt) und Konfetti bei der letzten Aufgabe des Tages (nicht bei „Bewegung reduzieren“)
- **Urlaubsmodus** (`settings.away.until` = Tag der Rückkehr): Offenes rutscht hinter den Urlaub, wiederkehrende Aufgaben im Rhythmus; Erinnerungen und Zähler pausieren
- **Startpaket** mit 15 typischen Aufgaben, wahlweise abwechselnd zugewiesen
- **Einkaufsliste:** mehrere Einträge per Komma oder Zeilen (auch beim Einfügen), Teilen-Ziel im Manifest (Android)

## Umgesetzt (Phase 8, 1.9.0)

- **Rezepte** im Reiter „Einkauf“ (Umschalter Liste · Rezepte, damit es bei vier Reitern bleibt): `id, title, servings, ingredients (eine Zutat pro Zeile), steps, link, createdAt, updatedAt, deleted`, synchronisiert wie Notizen
- Rezept ansehen: Portionen ± rechnet die Mengen am Zeilenanfang um (auch ½, 1/2, Spannen wie 2-3); Zutaten auswählen (Salz, Pfeffer, Wasser und schon gelistete sind abgewählt); „Auf die Einkaufsliste“
- Einträge aus Rezepten tragen `from` (Rezeptname, „für Lasagne“); steht die Zutat schon drauf, werden die Mengen zusammengefasst („500 g + 200 g“) statt ersetzt
- Mengenerkennung kennt jetzt auch EL, TL, Prise, Zehen, Scheiben, Dose, Bund, Bruchzahlen
- Suche ab 6 Rezepten; Beispielrezept zum Ausprobieren

## Umgesetzt (Phase 9, 1.10.0)

- Rezept-Import als JSON (einfügen, Datei, oder über „Teilen“ auf Android) mit Vorschau; erkennt einzelne Rezepte, Listen, `{recipes: […]}`, deutsche Feldnamen, Zutaten als Objekte, schema.org `Recipe` (auch `@graph`, `HowToStep`, `HowToSection`, `recipeYield`), ```json-Rahmen und eingebettetes `application/ld+json`
- Gleicher Name ersetzt das vorhandene Rezept; Schutz vor zu großen Datenmengen (Server-Grenze ca. 1,5 MB)
- Export im selben Format (auf dem Handy über das Teilen-Menü, sonst als Download)

## Umgesetzt (Phase 10, 2.0.0)

- **Aufräumen:** Der Server entfernt erledigte Aufgaben, die älter als 180 Tage sind, und vergangene Essenspläne nach 60 Tagen. Für „Zuletzt geputzt“ bleibt pro Bereich das zuletzt Erledigte in `history.lastByCat`. Wird es trotzdem eng, fallen zuerst Gelöschtes und Erledigtes weg, nie offene Einträge.
- **Rückgängig:** Löschen (Aufgabe, Notiz, Rezept, Eintrag, Gericht) und „Erledigte entfernen“ ohne Rückfrage, dafür mit „Rückgängig“ in der Meldung
- **Sicherung:** alles als eine Datei (`type: backup`); Einspielen ergänzt Fehlendes und holt Gelöschtes zurück, Vorhandenes bleibt
- **Checklisten** in Aufgaben (`checklist: [{id, text, done}]`, bis 30 Punkte), abhaken direkt an der Aufgabe; sind alle abgehakt, bietet die Meldung „Aufgabe erledigen“ an; der Folgetermin startet mit leerer Checkliste
- **Essensplan** (`meals: [{id, date, title, recipeId, servings, shopped}]`) im Reiter „Einkauf“: Woche mit Navigation, Rezepte oder freie Gerichte pro Tag, Wocheneinkauf rechnet alle Zutaten auf die Portionen um und fasst gleiche zusammen; „Heute gibt's …“ unter Putzen
- **Tests im Repo** (`tests/`, 8 Dateien, über 100 Prüfungen) und GitHub-Workflow; die Veröffentlichung wartet auf grüne Tests
- Sync im Worker auf eine Liste der Sammlungen umgestellt (`COLLECTIONS`), damit neue Bereiche nur eine Zeile brauchen

## Später möglich

- Eigene Kategorien für Aufgaben, Erinnerung an einzelne Aufgaben zu einer Uhrzeit
