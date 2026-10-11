# Putzplan einrichten

Du brauchst **kein Terminal und kein Node.js**. Das Backend veröffentlicht eine GitHub Action automatisch.
Für dich bleiben ein paar Klicks im Browser, etwa 10 Minuten.

1. Cloudflare-Account anlegen
2. Cloudflare-Schlüssel als GitHub-Secret hinterlegen
3. GitHub Pages einschalten
4. Claude Bescheid sagen → Claude startet das Deployment und trägt die Adresse ein
5. App auf beiden Handys installieren

---

## 1. Cloudflare-Account anlegen

1. Auf <https://dash.cloudflare.com/sign-up> registrieren (kostenlos) und die E-Mail bestätigen.
2. Links im Menü **Workers & Pages** einmal öffnen. Falls Cloudflare dort nach einer *workers.dev-Subdomain* fragt, einen Namen wählen (z. B. `dasnicklp`). Ohne diese Subdomain schlägt das Veröffentlichen fehl.

## 2. Cloudflare-Schlüssel als GitHub-Secret hinterlegen

**Account-ID kopieren:** In Cloudflare bei **Workers & Pages** steht rechts „Account ID“ → kopieren.
(Alternativ: Sie steht in der Browser-Adresse, `dash.cloudflare.com/<Account-ID>/…`.)

**API-Token erstellen:**

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

## 3. GitHub Pages einschalten

Repo **Putzplan** → **Settings** → **Pages**

- *Source*: **Deploy from a branch**
- *Branch*: **main**, Ordner **/docs** → **Save**

## 4. Claude Bescheid sagen

Schreib „fertig“. Claude startet dann die Action, liest die Worker-Adresse aus, trägt sie in die App ein und prüft, dass alles erreichbar ist.

(Selbst starten geht auch: Repo → **Actions** → **Backend veröffentlichen** → **Run workflow**, Branch `main`. Die Adresse steht danach in der Zusammenfassung des Laufs.)

## 5. App auf den Handys installieren

Die App-Adresse ist `https://dasnicklp.github.io/Putzplan/` (sie steht auch unter Settings → Pages).

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

- **App** (`docs/`): GitHub Pages aktualisiert sich in 1–2 Minuten, die Handys holen die neue Version beim nächsten Öffnen.
- **Backend** (`worker/`): Die Action „Backend veröffentlichen“ läuft von selbst.

Namen anpassen: In `docs/index.html` oben im Skript `PEOPLE = { nick: 'Nick', partner: 'Freundin' }`.

## Wenn etwas nicht geht

| Meldung | Ursache / Lösung |
|---|---|
| Action rot: „Secrets … fehlen“ | Schritt 2 wiederholen, Namen genau so schreiben. |
| Action rot: „workers.dev subdomain“ | Schritt 1, Punkt 2: in Cloudflare *Workers & Pages* öffnen und Subdomain wählen. |
| Action rot: „Authentication error“ / „D1“ | Token hat zu wenig Rechte: D1 · Edit ergänzen (Schritt 2). |
| App: „Keine Verbindung zum Server“ | `API_BASE` in `docs/index.html` noch nicht eingetragen oder Worker nicht veröffentlicht. |
| App: „Den Code kenne ich nicht“ | Tippfehler. Code steht auf dem anderen Gerät unter ⚙︎. |
| App: „Zu viele Fehlversuche“ | Nach 5 falschen Codes ist die Internetverbindung 15 Minuten gesperrt (Schutz vor Raten). Warten. |
| App zeigt alte Version | App ganz schließen und neu öffnen. |

## Kosten

Bei zwei Personen bleibt alles im kostenlosen Rahmen von Cloudflare (100 000 Anfragen pro Tag) und GitHub.

## Ohne GitHub Action (manuell, optional)

Mit Node.js im Ordner `worker`: `npm install`, `npx wrangler login`, `npx wrangler d1 create putzplan` (ID in `wrangler.toml` eintragen), `npx wrangler deploy`. Die ausgegebene Adresse in `docs/index.html` bei `API_BASE` eintragen.
