# Putzplan einrichten

Du brauchst **kein Terminal und kein Node.js**. Eine GitHub Action veröffentlicht App und Backend automatisch auf Cloudflare.
Der Cloudflare-Worker liefert die App gleich mit aus, deshalb braucht es kein GitHub Pages und das Repo kann privat bleiben.

**Status:** Schritte 1–3 sind erledigt. Die App läuft unter
**<https://putzplan-api.n-kudenholdt2000.workers.dev/>** – weiter mit Schritt 4.

1. Cloudflare-Account
2. Cloudflare-Schlüssel als GitHub-Secret hinterlegen
3. Action starten
4. App auf beiden Handys installieren

---

## 1. Cloudflare-Account

**Schon vorhanden (z. B. durch die Fokus-App):** Nichts zu tun, einfach denselben Account benutzen. Putzplan läuft als eigener Worker `putzplan-api` mit eigener Datenbank `putzplan` und berührt bestehende Worker und Datenbanken nicht. Beide Apps teilen sich nur das kostenlose Kontingent, das reicht locker.

**Noch keiner:**

1. Auf <https://dash.cloudflare.com/sign-up> registrieren (kostenlos) und die E-Mail bestätigen.
2. Links im Menü **Workers & Pages** einmal öffnen. Falls Cloudflare dort nach einer *workers.dev-Subdomain* fragt, einen Namen wählen (z. B. `dasnicklp`). Ohne diese Subdomain schlägt das Veröffentlichen fehl.

## 2. Cloudflare-Schlüssel als GitHub-Secret hinterlegen

**Account-ID kopieren:** In Cloudflare bei **Workers & Pages** steht rechts „Account ID“ → kopieren.
(Alternativ: Sie steht in der Browser-Adresse, `dash.cloudflare.com/<Account-ID>/…`.)

**API-Token erstellen:**

Einen **neuen** Token anlegen. Vorhandene Tokens (z. B. von der Fokus-App) nicht ändern oder neu erzeugen.

1. <https://dash.cloudflare.com/profile/api-tokens> → **Create Token**
2. Vorlage **Edit Cloudflare Workers** → **Use template**
3. Unter *Permissions* auf **+ Add more** und eine Zeile ergänzen: **Account** · **D1** · **Edit**
4. *Account Resources*: dein Account. *Zone Resources*: so lassen (All zones).
5. **Continue to summary** → **Create Token** → Token kopieren (wird nur einmal angezeigt).

**In GitHub eintragen:** Repo **Putzplan** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, zweimal:

| Name | Wert |
|---|---|
| `CLOUDFLARE_API_TOKEN` | der Token |
| `CLOUDFLARE_ACCOUNT_ID` | die Account-ID |

Den Token bitte **nicht** in den Chat kopieren. In den Secrets ist er sicher, Claude braucht ihn nicht zu sehen.

## 3. Action starten

Läuft bei jeder Änderung auf `main` von selbst. Von Hand: Repo → **Actions** → **App und Backend veröffentlichen** → **Run workflow**, Branch `main`.
Die Action legt beim ersten Lauf die Datenbank an, veröffentlicht alles und prüft am Ende, dass App und Backend antworten. Die Adresse steht in der Zusammenfassung des Laufs.

## 4. App auf den Handys installieren

Die App-Adresse ist **<https://putzplan-api.n-kudenholdt2000.workers.dev/>**.

**Wichtig:** Erst installieren, dann den Code eingeben. Auf dem iPhone hat die Homescreen-App einen eigenen Speicher, getrennt von Safari.

**Android (du):**

1. Adresse in **Chrome** öffnen.
2. Menü ⋮ → **App installieren** (oder „Zum Startbildschirm hinzufügen“).
3. App vom Startbildschirm öffnen → **Neuen Haushalt anlegen** → den 6-stelligen Code notieren.

**iPhone (deine Freundin):**

1. Adresse in **Safari** öffnen (nicht Chrome, nur Safari kann das).
2. Teilen-Symbol (Quadrat mit Pfeil) → **Zum Home-Bildschirm** → Hinzufügen.
3. App vom Home-Bildschirm öffnen → Code eingeben → **Verbinden**.

Änderungen erscheinen auf dem anderen Gerät nach spätestens etwa 12 Sekunden, solange die App offen ist, und sofort beim Öffnen. Der Code steht jederzeit in der App unter ⚙︎.

---

## Später: Änderungen veröffentlichen

Alles, was auf `main` landet, geht automatisch raus:

- App (`docs/`) und Backend (`worker/`): Die Action „App und Backend veröffentlichen“ läuft von selbst, nach etwa einer Minute ist alles online.
- Die Handys holen die neue Version beim nächsten Öffnen der App.

Namen anpassen: In `docs/index.html` oben im Skript `PEOPLE = { nick: 'Nick', partner: 'Freundin' }`.

## Wenn etwas nicht geht

| Meldung | Ursache / Lösung |
|---|---|
| Action rot: „Secrets … fehlen“ | Schritt 2 wiederholen, Namen genau so schreiben. |
| Action rot: „workers.dev subdomain“ | Schritt 1, Punkt 2: in Cloudflare *Workers & Pages* öffnen und Subdomain wählen. |
| Action rot: „Authentication error“ / „D1“ | Token hat zu wenig Rechte: D1 · Edit ergänzen (Schritt 2). |
| App: „Keine Verbindung zum Server“ | Kein Internet, oder die letzte Action ist rot (Repo → Actions). |
| App: „Den Code kenne ich nicht“ | Tippfehler. Code steht auf dem anderen Gerät unter ⚙︎. |
| App: „Zu viele Fehlversuche“ | Nach 5 falschen Codes ist die Internetverbindung 15 Minuten gesperrt (Schutz vor Raten). Warten. |
| App zeigt alte Version | App ganz schließen und neu öffnen. |

## Kosten

Bei zwei Personen bleibt alles im kostenlosen Rahmen von Cloudflare (100 000 Anfragen pro Tag) und GitHub.

## Ohne GitHub Action (manuell, optional)

Mit Node.js im Ordner `worker`: `npm install`, `npx wrangler login`, `npx wrangler d1 create putzplan` (ID in `wrangler.toml` eintragen), `npx wrangler deploy`.

Lokal testen: im Ordner `worker` `npx wrangler dev --port 8787`, dann <http://127.0.0.1:8787> öffnen (App und Backend mit lokaler Datenbank).

## GitHub Pages statt Cloudflare (optional)

Geht nur, wenn das Repo öffentlich ist (oder mit bezahltem GitHub-Tarif). Dann Settings → Pages → Branch `main`, Ordner `/docs`. Die App erkennt `github.io` selbst und spricht dann den Worker unter seiner vollen Adresse an.
