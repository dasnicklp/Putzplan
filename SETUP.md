# Haushalt-App einrichten

(Bis Version 2.1 hieß die App „Putzplan“; Worker, Datenbank und Repo heißen weiter so.)

Du brauchst **kein Terminal und kein Node.js**. Das Backend veröffentlicht eine GitHub Action automatisch.
Für dich bleiben ein paar Klicks im Browser, etwa 10 Minuten.

**Status:** Alles eingerichtet. Die App läuft unter zwei Adressen mit denselben Daten:

- **<https://putzplan-api.n-kudenholdt2000.workers.dev/>** – empfohlen, vor allem auf Android. Eigene Adresse, daher lässt sie sich neben anderen Apps auf `dasnicklp.github.io` (z. B. Fokus) installieren.
- <https://dasnicklp.github.io/Putzplan/> – GitHub Pages, funktioniert weiterhin (z. B. für ein bereits eingerichtetes iPhone).

1. Cloudflare-Account anlegen
2. Cloudflare-Schlüssel als GitHub-Secret hinterlegen
3. Repo öffentlich machen und GitHub Pages einschalten
4. Backend veröffentlichen und Adresse eintragen
5. App auf beiden Handys installieren

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

## 3. Repo öffentlich machen und GitHub Pages einschalten

GitHub Pages gibt es im kostenlosen GitHub-Tarif nur für öffentliche Repos.
Öffentlich ist nur der Code. Im Repo liegen keine Passwörter oder Tokens (der Cloudflare-Token steckt in den Secrets), und eure Aufgaben sind über den Haushaltscode geschützt.

**Öffentlich machen:** Repo **Putzplan** → **Settings** → **General** → ganz unten *Danger Zone* → **Change visibility** → **Change to public** → bestätigen.

**Pages einschalten:** Repo **Putzplan** → **Settings** → **Pages**

- *Source*: **Deploy from a branch**
- *Branch*: **main**, Ordner **/docs** → **Save**

## 4. App und Backend veröffentlichen

Erledigt. Die Action „App und Backend veröffentlichen“ läuft bei jeder Änderung auf `main` von selbst: Der Cloudflare-Worker liefert das Backend (`/api/…`) und die App (Ordner `docs/`) aus und prüft am Ende, dass beides antwortet.

(Selbst starten geht auch: Repo → **Actions** → **App und Backend veröffentlichen** → **Run workflow**, Branch `main`. Die Adresse steht danach in der Zusammenfassung des Laufs.)

## 5. App auf den Handys installieren

Die App-Adresse ist **<https://putzplan-api.n-kudenholdt2000.workers.dev/>**.

(Die GitHub-Pages-Adresse `https://dasnicklp.github.io/Putzplan/` geht auch, teilt sich aber die Domain mit Fokus. Chrome auf Android installiert dann nur eine der beiden Apps.)

**Wichtig:** Erst installieren, dann den Code eingeben. Auf dem iPhone hat die Homescreen-App einen eigenen Speicher, getrennt von Safari.

**Android (du):**

1. Adresse in **Chrome** öffnen.
2. Menü ⋮ → **App installieren** (oder „Zum Startbildschirm hinzufügen“).
3. App vom Startbildschirm öffnen → **Neuen Haushalt anlegen** → den 6-stelligen Code notieren.

**iPhone (deine Freundin):**

1. Adresse in **Safari** öffnen (nicht Chrome, nur Safari kann das).
2. Teilen-Symbol (Quadrat mit Pfeil) → **Zum Home-Bildschirm** → Hinzufügen.
3. App vom Home-Bildschirm öffnen → Code eingeben → **Verbinden**.

Änderungen erscheinen auf dem anderen Gerät nach spätestens etwa 12 Sekunden, solange die App offen ist, und sofort beim Öffnen. Der Code steht jederzeit in der App im Reiter „Einstellungen“.

**Mitteilungen (optional):** In der App im Reiter „Einstellungen“ unter „Mitteilungen“ wählen, wem das Handy gehört, Uhrzeit und Arten einstellen (täglich, Wochenrückblick, Pinnwand, Einkaufsliste), dann „Mitteilungen einschalten“ und erlauben. Das macht jedes Handy für sich. In Cloudflare ist dafür nichts einzurichten, der Worker legt seine Schlüssel selbst an. Auf dem iPhone geht das nur in der App vom Home-Bildschirm (ab iOS 16.4).

**Kassenbon scannen:** nutzt Workers AI (Binding `AI` in `wrangler.toml`), im kostenlosen Tageskontingent von Cloudflare. Nichts einzurichten. Ob es online klappt, zeigt der Workflow „Bon-Scan prüfen“ (Actions → Run workflow).

**Kalender-Abo und Sprachassistent (optional):** In der App unter „Einstellungen“. Die Links erzeugt der Worker selbst (Tabelle `links`), in Cloudflare ist nichts einzurichten.

---

## Später: Änderungen veröffentlichen

Alles, was auf `main` landet, geht automatisch raus:

- **App** (`docs/`) und **Backend** (`worker/`): Die Action „App und Backend veröffentlichen“ läuft von selbst, GitHub Pages aktualisiert sich parallel. Nach 1–2 Minuten ist alles online.
- Die Handys holen die neue Version beim nächsten Öffnen, oder sofort über den Reiter „Einstellungen“ → „Nach Update suchen“.

Namen anpassen: in der App im Reiter „Einstellungen“ → „Namen speichern“. Gilt automatisch für beide Geräte.

## Wenn etwas nicht geht

| Meldung | Ursache / Lösung |
|---|---|
| Action rot: „Secrets … fehlen“ | Schritt 2 wiederholen, Namen genau so schreiben. |
| Action rot: „workers.dev subdomain“ | Schritt 1, Punkt 2: in Cloudflare *Workers & Pages* öffnen und Subdomain wählen. |
| Action rot: „Authentication error“ / „D1“ | Token hat zu wenig Rechte: D1 · Edit ergänzen (Schritt 2). |
| App: „Keine Verbindung zum Server“ | `API_BASE` in `docs/index.html` noch nicht eingetragen oder Worker nicht veröffentlicht. |
| App: „Den Code kenne ich nicht“ | Tippfehler. Code steht auf dem anderen Gerät im Reiter „Einstellungen“. |
| App: „Zu viele Fehlversuche“ | Nach 5 falschen Codes ist die Internetverbindung 15 Minuten gesperrt (Schutz vor Raten). Warten. |
| App zeigt alte Version | App ganz schließen und neu öffnen. |

## Kosten

Bei zwei Personen bleibt alles im kostenlosen Rahmen von Cloudflare (100 000 Anfragen pro Tag) und GitHub.

## Ohne GitHub Action (manuell, optional)

Mit Node.js im Ordner `worker`: `npm install`, `npx wrangler login`, `npx wrangler d1 create putzplan` (ID in `wrangler.toml` eintragen), `npx wrangler deploy`. Die ausgegebene Adresse in `docs/index.html` bei `API_BASE` eintragen.
