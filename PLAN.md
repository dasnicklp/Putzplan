# Putzplan – Plan

## Ziel
Eine PWA für zwei Personen (Nick: Android/Windows, Freundin: iPhone). Installation über den Homescreen, kein App Store, keine Benutzerkonten.

## Architektur

```
Browser (Android / iPhone)  ──HTTPS──>  Cloudflare Worker (API)  ──>  D1 (SQLite)
  GitHub Pages (docs/)                    worker/src/index.js          worker/schema.sql
```

| Teil | Technik | Begründung |
|---|---|---|
| Frontend | Statisches HTML/CSS/JS, **ohne Build-Schritt** | Kein npm/Bundler nötig, direkt auf GitHub Pages lauffähig |
| Hosting Frontend | GitHub Pages, Quelle: Branch `main`, Ordner `/docs` | Keine Workflow-Datei nötig |
| Backend | Cloudflare Worker + D1 | Wie bei der Fokus-App, kostenloser Tarif reicht |
| Haushalt | 6-stelliger Code, serverseitig nur als SHA-256-Hash gespeichert | Kein Login; Code wird im `localStorage` des Geräts gemerkt |
| Sync | Laden beim Öffnen, Polling alle 12 s solange die App sichtbar ist, zusätzlich beim Zurückkehren in die App | Einfach, robust, für 2 Personen völlig ausreichend |
| Offline | Letzter Stand wird lokal gecacht und angezeigt | Service Worker cacht die statischen Dateien |

## Projektstruktur

```
putzplan/
├─ README.md                  Kurzbeschreibung
├─ SETUP.md                   Manuelle Schritte (Cloudflare, D1, Deploy, Pages)
├─ PLAN.md                    dieses Dokument
├─ docs/                      -> GitHub Pages (Frontend)
│  ├─ index.html              App-Shell, Meta-Tags für iOS (Homescreen, Safe-Areas)
│  ├─ styles.css              Layout, Wochen-/Monatsansicht, Safe-Areas, Dark Mode
│  ├─ app.js                  Ansichten, Formulare, Erledigt-Logik, Polling
│  ├─ api.js                  Aufrufe an den Worker, Code-Verwaltung
│  ├─ config.js               API_BASE = Worker-URL (einzige Stelle zum Anpassen)
│  ├─ sw.js                   Service Worker (Offline-Cache)
│  ├─ manifest.webmanifest    Name, Icons, Farben für Installation
│  └─ icons/                  icon-192.png, icon-512.png, apple-touch-icon.png (180 px)
└─ worker/
   ├─ src/index.js            API-Routen, CORS, Code-Prüfung
   ├─ schema.sql              D1-Tabellen: households, tasks
   ├─ wrangler.toml           Worker-Name, D1-Binding
   └─ package.json            nur wrangler als Dev-Abhängigkeit
```

## Datenmodell (D1)

- `households(id TEXT PK, code_hash TEXT UNIQUE, created_at)`
- `tasks(id TEXT PK, household_id, title, due_date TEXT (YYYY-MM-DD), category TEXT, minutes INTEGER, assignee TEXT ('nick' | 'partner' | NULL), done INTEGER, done_at, recurrence TEXT NULL ('weekly' | 'monthly'), created_at, updated_at, deleted INTEGER)`

Kategorien: Küche, Bad, Wohnzimmer, Wäsche, Sonstiges (fest in der App, leicht erweiterbar).

## API (Worker)

Auth-Header `X-Household-Code` bei allen Routen außer dem Erstellen/Beitreten.

| Methode | Route | Zweck |
|---|---|---|
| POST | `/api/household` | Neuen Haushalt anlegen, gibt einmalig den Code zurück |
| POST | `/api/join` | Code prüfen (200 / 404) |
| GET | `/api/tasks` | Alle Aufgaben des Haushalts |
| POST | `/api/tasks` | Aufgabe anlegen |
| PATCH | `/api/tasks/:id` | Ändern, erledigt markieren |
| DELETE | `/api/tasks/:id` | Soft-Delete |

Konflikte: letzter Schreibvorgang gewinnt (`updated_at`). Bei 2 Personen unkritisch.

## Features (Phase 1, MVP)

1. **Wochenansicht** (Standard) mit Umschalter zur **Monatsansicht**; Navigation vor/zurück, "Heute"-Button
2. **Aufgabe anlegen/bearbeiten**: Titel, Fälligkeit, Kategorie, Minuten, Zuweisung (Nick / Freundin / offen)
3. **Erledigt** per Antippen, Anzeige durchgestrichen; Summe der Minuten pro Woche sichtbar
4. **Wiederkehrend (einfache Variante)**: Beim Erledigen einer Aufgabe mit Wiederholung wird automatisch die nächste Fälligkeit (+7 Tage / +1 Monat) angelegt. Kein Regelwerk, kein Kalender-Import. Lässt sich bei Bedarf wieder entfernen.

## iPhone-Details (fest eingeplant)

- `viewport-fit=cover`, `env(safe-area-inset-*)` für Notch und Home-Indikator
- Eingabefelder mit `font-size: 16px` → kein Zoom beim Antippen
- `100dvh` statt `100vh` (Safari-Leisten)
- `apple-mobile-web-app-capable`, `apple-touch-icon` (PNG, 180×180), eigene Statusleisten-Farbe
- Installation: Teilen → "Zum Home-Bildschirm" (Hinweis in der App, solange nicht installiert)
- Tap-Ziele mindestens 44 px

## Umsetzungsreihenfolge

1. Worker + Schema, lokal getestet mit `wrangler dev` (lokale D1)
2. Frontend: Shell, Code-Eingabe, Wochenansicht, Aufgaben, Erledigt
3. Monatsansicht, Polling, Service Worker, Manifest, Icons
4. Wiederkehrende Aufgaben (einfache Variante)
5. README, SETUP.md, Prüfung im Browser (Mobile-Viewport)

## Nicht im Umfang (später möglich)

Push-Benachrichtigungen (auf iOS nur mit Homescreen-App, Aufwand höher), Fotos, Statistiken, mehrere Haushalte pro Gerät, komplexe Wiederholungsregeln.
