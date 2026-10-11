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
| POST | `/api/sync` | Aufgaben senden, zusammengeführten Stand zurückbekommen |

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

## Später möglich

- **Push-Erinnerungen** (z. B. „Heute ist Bad dran“): Die Fokus-App hat dafür schon VAPID-Push und einen Cron-Zeitplaner, das lässt sich übernehmen. Auf dem iPhone nur in der Homescreen-App.
- Statistik (wer hat wie viel Zeit geputzt), eigene Kategorien, komplexere Wiederholungen.
