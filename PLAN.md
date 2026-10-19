# Haushalt (früher Putzplan) – Plan und Entscheidungen

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

## Umgesetzt (Phase 11, 2.1.0)

- Fünf Reiter: Putzen · Einkauf · Notizen · **Zuhause** · **Einstellungen**
- Zuhause: Überblick-Kacheln (heute offen, Einkaufsliste, Essen heute, Serie; Antippen springt hin), Namen, Urlaub, Startpaket
- Einstellungen: Haushaltscode und Synchronisation, Erinnerungen (pro Gerät), Sicherung, App-Version und Update, Abmelden
- Beschriftung unten 11 px (unter 350 px Breite 10 px), damit „Einstellungen“ auch auf kleinen Handys passt

## Umgesetzt (Phase 12, 2.2.0)

- Anzeigename der App „Haushalt“ statt „Putzplan“ (Titel, Home-Bildschirm, Startseite, Mitteilungen, Dateinamen). Adresse, Worker, Datenbank, Speicher-Schlüssel und die Kennung `app: 'Putzplan'` in Sicherungen bleiben unverändert, damit nichts neu eingerichtet werden muss

## Umgesetzt (Phase 13, 3.0.0)

- **Vorrat** (`pantry: {name, cat, status: ok|low|out}`) im Reiter Einkauf: „Knapp“/„Leer“ setzt den Eintrag auf die Einkaufsliste (`from: 'Vorrat'`), Abhaken beim Einkauf setzt ihn wieder auf „Da“; Rezepte und Wocheneinkauf wählen Vorhandenes ab
- **Zuhause** mit Übersicht (Kacheln, **Pinnwand** `board: {text, from}`, Demnächst), **Geburtstage** (`bdays: {name, day, month, year?, remind, note}`), **Wünsche** (`wishes: {title, price, prio, link, note, done}`), **Geräte** (`devices: {name, bought, warranty, link, note}`; „Wartung planen“ legt eine monatliche Aufgabe „Gerät: …“ an)
- **Einstellungen**: zusätzlich Namen, Urlaub, Startpaket, **Laden-Reihenfolge** (`settings.shopOrder`) und „Dieses Handy gehört“ (`putzplan.me`, pro Gerät)
- **Mitteilungen** pro Gerät (`push_subs.opts`): täglich (jetzt mit Geburtstagen), **Wochenrückblick** sonntags ab 19 Uhr (`last_weekly`), **Pinnwand** und **neue Sachen auf der Liste** sofort beim Sync an die anderen Geräte (nicht an das eigene: per Person und per Push-Adresse); neue Listeneinträge werden 30 Minuten lang in einer Mitteilung gesammelt
- **Kurzbefehle** im Manifest (`?go=list|task|board|pantry`); Tipp auf eine Mitteilung springt an die passende Stelle
- Client: alle synchronisierten Listen in einer Tabelle (`SYNCED`), Server: Pinnwand nach 30 Tagen und gekaufte Wünsche nach 180 Tagen aufgeräumt
- Testzugang `POST /api/push/run` (nur lokal mit `ALLOW_LOCAL_PUSH`) für Zeitplan-Tests; 10 Testdateien, rund 160 Prüfungen

## Umgesetzt (Phase 14, 3.1.0)

- **Kalender** unter Zuhause (ersetzt „Geburtstage“): **Termine** (`events: {title, date, time?, who, note}`, nach 30 Tagen aufgeräumt) und Geburtstage; „+“ fragt, was angelegt wird
- **Kalender-Abo** (iCalendar): `GET /api/cal/<token>.ics` mit Terminen, Geburtstagen (jährlich), Garantie-Enden, auf Wunsch `t=1` Putzaufgaben und `m=1` Essensplan; geheimer Link statt Haushaltscode (Tabelle `links`), neu erzeugbar
- **Sprachassistent**: `GET|POST /api/add/<token>?w=nick` mit Text `t` (Adresse, Formular, JSON oder reiner Text) setzt Sachen auf die Liste und antwortet mit einem Satz zum Vorlesen (Siri-Kurzbefehl); Bereich und Menge ergänzt die App beim nächsten Sync
- **Vorrat**: Mindesthaltbarkeit (`pantry.best`), „läuft bald ab“ im Vorrat, unter Demnächst, im Heute-Banner und in der täglichen Mitteilung; neu gekauft löscht das alte Datum
- **„Was können wir kochen?“** bei den Rezepten: sortiert nach Zutaten im Vorrat (auch „Knapp“), zeigt, was fehlt; Zutaten passen jetzt auch mit Mehrzahl und Zusätzen („2 Zwiebeln (gewürfelt)“ ↔ „Zwiebel“)
- **Zähler** unter Geräte (`meters: {name, unit, number, remind}`, `readings: {meter, date, value}`): Verbrauch pro Monat als Säulendiagramm (nur ganz abgedeckte Monate), Erinnerung am Monatsersten
- **WLAN für Gäste** (`settings.wifi`): QR-Code im WIFI-Format, eigener QR-Generator in der App (geprüft mit jsQR)
- Tägliche Mitteilung zusätzlich mit Terminen (heute/morgen), Ablaufendem und Zählerständen; 11 Testdateien, rund 200 Prüfungen

## Umgesetzt (3.2.0)

- Einstellungen in vier Bereiche geteilt (oben umschaltbar, wird gemerkt): Haushalt, Mitteilungen, Verbinden, App
- Handbuch `docs/handbuch.html` (Funktionen, Einrichtung, Kalender-Abo, Siri, Fragen), verlinkt in Einstellungen → App und auf dem Startbildschirm

## Umgesetzt (3.3.0)

- Essensplan wie die Wochenansicht beim Putzen: Tagesleiste mit Anzahl, gewählter Tag darunter, „Diese Woche“ als Liste, Wischen wechselt die Woche

## Umgesetzt (3.4.0)

- **Kassenbon scannen** im Vorrat: Foto wird in der App verkleinert (JPEG, unter 900 KB), `POST /api/receipt` lässt es von Workers AI lesen (Binding `AI`, mehrere Vision-Modelle der Reihe nach, das erste funktionierende wird gemerkt), Pfand/Summen/Doppeltes werden herausgefiltert; Prüffenster, dann in den Vorrat (neu oder wieder „Da“) und passende Einträge auf der Liste abhaken. 25 Bons pro Haushalt und Tag (Tabelle `usage`)
- Tests laufen mit `wrangler dev --env test` (ohne KI, festes Beispiel über `FAKE_RECEIPT`); die echte KI prüft der Workflow „Bon-Scan prüfen“ (von Hand, mit `tests/fixtures/kassenbon.jpg`)

## Umgesetzt (3.5.0)

- Geburtstage mit Kategorie (Feld `cat`, frei mit Vorschlägen Familie, Freunde, Arbeit, Schreibweise wird angeglichen), Filter über den Geburtstagen im Kalender
- Einkaufsliste und Vorrat: Bereiche „Snacks süß“ 🍫 und „Snacks salzig“ 🥨 hinter „Vorrat“, eigene Stichwörter; eine gespeicherte Laden-Reihenfolge bekommt neue Bereiche hinter ihrem Vorgänger. Einmal pro Gerät werden Einträge unter „Vorrat“, die nach Stichwort Snacks sind, umsortiert

## Später möglich

- Eigene Kategorien für Aufgaben, Erinnerung an einzelne Aufgaben zu einer Uhrzeit
