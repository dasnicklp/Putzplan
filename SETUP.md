# Putzplan einrichten

Das musst du einmal selbst machen. Insgesamt etwa 20 Minuten. Du brauchst dafür deinen Windows-PC.

Übersicht:

1. Code auf `main` bringen (GitHub)
2. Backend auf Cloudflare veröffentlichen
3. Backend-Adresse in die App eintragen
4. GitHub Pages einschalten
5. App auf beiden Handys installieren

---

## 0. Einmalig installieren

- **Node.js** (Version „LTS“) von <https://nodejs.org> installieren. Danach ein neues Terminal öffnen (PowerShell).
- **Git** hast du schon, falls nicht: <https://git-scm.com>.
- **Cloudflare-Account** (kostenlos): <https://dash.cloudflare.com/sign-up>. Der Free-Tarif reicht.

## 1. Code auf `main` bringen

Der Code liegt im Branch `claude/vigilant-fermat-233lby`. GitHub Pages veröffentlicht von `main`.

Auf GitHub: Repo **Putzplan** → Banner „Compare & pull request“ (oder Reiter *Pull requests* → *New*) → Branch `claude/vigilant-fermat-233lby` nach `main` → **Merge**.

Dann lokal holen:

```powershell
git clone https://github.com/dasnicklp/Putzplan.git
cd Putzplan
```

(Wenn du das Repo schon hast: `git checkout main` und `git pull`.)

## 2. Backend auf Cloudflare veröffentlichen

```powershell
cd worker
npm install
npx wrangler login
```

Es öffnet sich der Browser, dort bei Cloudflare zustimmen.

Datenbank anlegen:

```powershell
npx wrangler d1 create putzplan
```

Die Ausgabe enthält eine Zeile `database_id = "…"`. Diese ID in `worker/wrangler.toml` statt `HIER-DATENBANK-ID-EINTRAGEN` einsetzen.

Veröffentlichen:

```powershell
npx wrangler deploy
```

Falls Wrangler nach einer *workers.dev-Subdomain* fragt: einen Namen wählen (z. B. `dasnicklp`).
Am Ende steht die Adresse, z. B. `https://putzplan-api.dasnicklp.workers.dev`. **Diese Adresse brauchst du gleich.**

Prüfen: Die Adresse mit `/api` dahinter im Browser öffnen. Es muss `{"ok":true,"name":"putzplan-api"}` erscheinen.

Die Tabellen in der Datenbank legt der Worker beim ersten Aufruf selbst an. Du musst kein SQL ausführen.

## 3. Backend-Adresse in die App eintragen

Datei `docs/index.html` öffnen (z. B. mit Notepad oder VS Code) und nach `API_BASE` suchen:

```js
const API_BASE = 'https://putzplan-api.DEIN-NAME.workers.dev';
```

Deine Adresse aus Schritt 2 einsetzen (ohne `/` am Ende).

Direkt darunter kannst du den Namen deiner Freundin eintragen:

```js
const PEOPLE = { nick: 'Nick', partner: 'Freundin' };
```

Speichern und hochladen:

```powershell
cd ..
git add docs/index.html worker/wrangler.toml
git commit -m "Backend-Adresse eintragen"
git push
```

## 4. GitHub Pages einschalten

Auf GitHub: Repo **Putzplan** → **Settings** → **Pages**

- *Source*: **Deploy from a branch**
- *Branch*: **main**, Ordner **/docs** → **Save**

Nach 1–2 Minuten steht oben die Adresse, z. B. `https://dasnicklp.github.io/Putzplan/`.

## 5. App auf den Handys installieren

**Wichtig:** Erst installieren, dann den Code eingeben. Auf dem iPhone hat die Homescreen-App einen eigenen Speicher, getrennt von Safari.

**Android (du):**

1. Adresse in **Chrome** öffnen.
2. Menü ⋮ → **App installieren** (oder „Zum Startbildschirm hinzufügen“).
3. App vom Startbildschirm öffnen → **Neuen Haushalt anlegen**.
4. Den 6-stelligen Code notieren.

**iPhone (deine Freundin):**

1. Adresse in **Safari** öffnen (nicht Chrome, nur Safari kann das).
2. Teilen-Symbol (Quadrat mit Pfeil) → **Zum Home-Bildschirm** → Hinzufügen.
3. App vom Home-Bildschirm öffnen → Code eingeben → **Verbinden**.

Fertig. Änderungen erscheinen auf dem anderen Gerät nach spätestens etwa 12 Sekunden, solange die App offen ist, und sofort beim Öffnen.

Der Code steht jederzeit in der App unter ⚙︎ (Einstellungen).

---

## Später: Änderungen veröffentlichen

- **App (Frontend)** geändert: `git push` reicht. GitHub Pages aktualisiert sich in 1–2 Minuten, die Handys holen die neue Version beim nächsten Öffnen.
- **Worker (Backend)** geändert: im Ordner `worker` `npx wrangler deploy`.

## Wenn etwas nicht geht

| Meldung | Ursache / Lösung |
|---|---|
| „Keine Verbindung zum Server“ | `API_BASE` in `docs/index.html` falsch oder Worker nicht veröffentlicht. Adresse + `/api` im Browser testen. |
| „Den Code kenne ich nicht“ | Tippfehler. Code steht auf dem anderen Gerät unter ⚙︎. |
| „Zu viele Fehlversuche“ | Nach 5 falschen Codes ist die Internetverbindung 15 Minuten gesperrt (Schutz vor Raten). Warten. |
| App zeigt alte Version | App ganz schließen und neu öffnen. |
| Eigene Domain statt github.io | Domain in `worker/src/index.js` bei `ORIGINS` ergänzen und neu deployen. |

## Kosten

Bei zwei Personen bleibt alles im kostenlosen Rahmen von Cloudflare (100 000 Anfragen pro Tag) und GitHub Pages.

## Lokal testen (optional)

```powershell
cd worker
npx wrangler dev --port 8787
```

In einem zweiten Terminal im Ordner `docs`: `npx serve -l 8765` (oder `python -m http.server 8765`). Dafür `API_BASE` vorübergehend auf `http://127.0.0.1:8787` setzen und im Browser `http://127.0.0.1:8765` öffnen.
