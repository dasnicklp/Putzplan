// Putzplan-Backend (Cloudflare Worker + D1)
// - Liefert außerdem die App (docs/) als statische Dateien aus, siehe [assets] in wrangler.toml
// - Zugang über einen 6-stelligen Haushaltscode, kein Konto
// - Sync: Geräte schicken Aufgaben, Notizen, Einkaufsliste, Vorrat, Rezepte, Essensplan, Pinnwand, Geburtstage, Wünsche und Geräte, der Server führt sie zusammen (neueste Änderung gewinnt pro Eintrag)
// - Nach 5 falschen Codes von einer IP wird diese IP 15 Minuten gesperrt
// - Mitteilungen: Geräte melden sich für Web Push an. Ein Zeitplan (alle 15 Minuten) schickt einmal am Tag die offenen Aufgaben,
//   Termine, Geburtstage, ablaufende Lebensmittel und am Monatsersten die Zählerstände, sonntags den Wochenrückblick.
//   Pinnwand-Nachrichten und neue Sachen auf der Liste gehen sofort an das andere Handy.
// - Geheime Links (ohne Haushaltscode): Kalender-Abo (/api/cal/…ics) und „auf die Liste“ für Siri & Co. (/api/add/…)

const ORIGINS = [
  'https://dasnicklp.github.io',
  'http://localhost:8765', 'http://127.0.0.1:8765',
];
const MAX_BODY = 1024 * 1024; // auch für das Foto eines Kassenbons (die App verkleinert es vorher)
const MAX_SCANS = 25; // Kassenbons pro Haushalt und Tag (das kostenlose KI-Kontingent reicht für weit mehr)
const MAX_TASKS = 2000;
const MAX_NOTES = 1000;
const MAX_SHOP = 1000;
const MAX_RECIPES = 300;
const MAX_MEALS = 500;
const ARCHIVE_MS = 180 * 864e5; // erledigte Aufgaben nach einem halben Jahr aufräumen (nur „Zuletzt geputzt“ merkt sich das Letzte pro Bereich)
const MEAL_KEEP_DAYS = 60;      // Essensplan: vergangene Tage nach 60 Tagen löschen
const BOARD_KEEP_DAYS = 30;     // Pinnwand: Nachrichten nach 30 Tagen löschen
const EVENT_KEEP_DAYS = 30;     // Termine: 30 Tage nach dem Termin löschen
const SHOP_NOTIFY_MS = 30 * 60000; // neue Sachen auf der Liste innerhalb von 30 Minuten in einer Mitteilung sammeln
const MAX_DATA = 1500 * 1024; // D1 erlaubt ca. 2 MB pro Zeile
const TOMBSTONE_MS = 60 * 864e5; // gelöschte Aufgaben 60 Tage merken, damit andere Geräte sie auch löschen
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60000;
const CATEGORIES = ['Küche', 'Bad', 'Wohnzimmer', 'Wäsche', 'Sonstiges'];
const MAX_SUBS = 10; // Push-Anmeldungen pro Haushalt
const PUSH_SUB = 'https://putzplan-api.n-kudenholdt2000.workers.dev/'; // Kontakt-Angabe für die Push-Dienste (VAPID)
// Push-Dienste der Browser: nur dorthin schickt der Worker Nachrichten
const PUSH_HOSTS = /(^|\.)(googleapis\.com|push\.apple\.com|mozilla\.com|mozaws\.net|notify\.windows\.com)$/;

const enc = new TextEncoder();
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Erlaubt: die eigene Adresse (App wird vom Worker ausgeliefert) und die Einträge in ORIGINS
const allowedOrigin = (req, o) => ORIGINS.includes(o) || o === new URL(req.url).origin;

function corsHeaders(req) {
  const o = req.headers.get('Origin');
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (o && allowedOrigin(req, o)) h['Access-Control-Allow-Origin'] = o;
  return h;
}
const json = (req, data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(req) } });

/* ------------------------------------------------------------------ */
/* Datenbank                                                           */
/* ------------------------------------------------------------------ */
let ready = false;
async function init(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS households (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS attempts (ip TEXT PRIMARY KEY, fails INTEGER NOT NULL, locked_until INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS usage (k TEXT PRIMARY KEY, n INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS links (token TEXT PRIMARY KEY, household TEXT NOT NULL, kind TEXT NOT NULL, created INTEGER NOT NULL)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, household TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
      person TEXT NOT NULL, time TEXT NOT NULL, tz TEXT NOT NULL, last_sent TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL)`),
  ]);
  // Spalten aus späteren Versionen nachrüsten (Fehler = gibt es schon)
  for (const sql of ["ALTER TABLE push_subs ADD COLUMN opts TEXT NOT NULL DEFAULT '{}'", "ALTER TABLE push_subs ADD COLUMN last_weekly TEXT NOT NULL DEFAULT ''"]) {
    try { await env.DB.prepare(sql).run(); } catch (e) { /* schon vorhanden */ }
  }
  ready = true;
}

// Haushalts-ID = Hash des Codes, der Klartext-Code wird nie gespeichert
const householdId = (code) => sha256hex('putzplan:' + code);

async function isLocked(env, ipKey) {
  const row = await env.DB.prepare('SELECT locked_until FROM attempts WHERE ip = ?').bind(ipKey).first();
  return !!row && row.locked_until > Date.now();
}
async function recordFail(env, ipKey) {
  await env.DB.prepare(`INSERT INTO attempts (ip, fails, locked_until) VALUES (?1, 1, 0)
      ON CONFLICT(ip) DO UPDATE SET
        locked_until = CASE WHEN fails + 1 >= ?2 THEN ?3 ELSE locked_until END,
        fails = CASE WHEN fails + 1 >= ?2 THEN 0 ELSE fails + 1 END`)
    .bind(ipKey, MAX_FAILS, Date.now() + LOCK_MS).run();
}
async function clearFails(env, ipKey) {
  await env.DB.prepare('DELETE FROM attempts WHERE ip = ?').bind(ipKey).run();
}

/* ------------------------------------------------------------------ */
/* Aufgaben: Eingabe prüfen und zusammenführen                         */
/* ------------------------------------------------------------------ */
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clampStr = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

function cleanTask(t) {
  if (!t || typeof t !== 'object') return null;
  if (typeof t.id !== 'string' || !/^[\w-]{1,64}$/.test(t.id)) return null;
  if (!Number.isFinite(t.updatedAt)) return null;
  const deleted = t.deleted === true;
  const title = clampStr(t.title, 200);
  if (!deleted && !title) return null;
  return {
    id: t.id,
    title,
    due: isDate(t.due) ? t.due : '',
    category: CATEGORIES.includes(t.category) ? t.category : 'Sonstiges',
    minutes: Number.isInteger(t.minutes) && t.minutes >= 0 && t.minutes <= 1440 ? t.minutes : 0,
    assignee: ['nick', 'partner'].includes(t.assignee) ? t.assignee : null,
    repeat: ['days', 'weekly', 'monthly'].includes(t.repeat) ? t.repeat : 'none',
    every: Number.isInteger(t.every) && t.every >= 1 && t.every <= 365 ? t.every : 1, // alle N Tage/Wochen/Monate
    fromDone: t.fromDone === true, // nächster Termin ab dem Erledigen statt ab dem Fälligkeitstag
    rotate: t.rotate === true,     // Zuweisung wechselt bei jedem Erledigen
    checklist: Array.isArray(t.checklist) ? t.checklist.slice(0, 30).map((c) => (c && typeof c === 'object' && typeof c.id === 'string'
      && /^[\w-]{1,24}$/.test(c.id) && clampStr(c.text, 120) ? { id: c.id, text: clampStr(c.text, 120), done: c.done === true } : null)).filter(Boolean) : [],
    done: t.done === true,
    doneAt: Number.isFinite(t.doneAt) ? t.doneAt : null,
    createdAt: Number.isFinite(t.createdAt) ? t.createdAt : t.updatedAt,
    updatedAt: t.updatedAt,
    deleted,
  };
}

function cleanNote(n) {
  if (!n || typeof n !== 'object') return null;
  if (typeof n.id !== 'string' || !/^[\w-]{1,64}$/.test(n.id)) return null;
  if (!Number.isFinite(n.updatedAt)) return null;
  const deleted = n.deleted === true;
  const title = clampStr(n.title, 200), body = typeof n.body === 'string' ? n.body.slice(0, 5000) : '';
  if (!deleted && !title && !body.trim()) return null;
  return {
    id: n.id,
    title,
    body,
    cat: clampStr(n.cat, 40),
    pinned: n.pinned === true,
    createdAt: Number.isFinite(n.createdAt) ? n.createdAt : n.updatedAt,
    updatedAt: n.updatedAt,
    deleted,
  };
}

function cleanShopItem(it) {
  if (!it || typeof it !== 'object') return null;
  if (typeof it.id !== 'string' || !/^[\w-]{1,64}$/.test(it.id)) return null;
  if (!Number.isFinite(it.updatedAt)) return null;
  const deleted = it.deleted === true;
  const name = clampStr(it.name, 100);
  if (!deleted && !name) return null;
  return {
    id: it.id,
    name,
    qty: clampStr(it.qty, 60),
    from: clampStr(it.from, 100), // Rezept, für das der Eintrag auf der Liste steht
    cat: clampStr(it.cat, 40),
    done: it.done === true,
    doneAt: Number.isFinite(it.doneAt) ? it.doneAt : null,
    createdAt: Number.isFinite(it.createdAt) ? it.createdAt : it.updatedAt,
    updatedAt: it.updatedAt,
    deleted,
  };
}

function cleanRecipe(r) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || !/^[\w-]{1,64}$/.test(r.id)) return null;
  if (!Number.isFinite(r.updatedAt)) return null;
  const deleted = r.deleted === true;
  const title = clampStr(r.title, 200);
  if (!deleted && !title) return null;
  const link = clampStr(r.link, 500);
  return {
    id: r.id,
    title,
    servings: Number.isInteger(r.servings) && r.servings >= 1 && r.servings <= 50 ? r.servings : 2,
    ingredients: typeof r.ingredients === 'string' ? r.ingredients.slice(0, 5000) : '', // eine Zutat pro Zeile
    steps: typeof r.steps === 'string' ? r.steps.slice(0, 10000) : '',
    link: /^https?:\/\//i.test(link) ? link : '',
    createdAt: Number.isFinite(r.createdAt) ? r.createdAt : r.updatedAt,
    updatedAt: r.updatedAt,
    deleted,
  };
}

// Essensplan: ein Gericht an einem Tag, aus einem Rezept oder frei („Pizza bestellen“)
function cleanMeal(m) {
  if (!m || typeof m !== 'object') return null;
  if (typeof m.id !== 'string' || !/^[\w-]{1,64}$/.test(m.id)) return null;
  if (!Number.isFinite(m.updatedAt)) return null;
  const deleted = m.deleted === true;
  const title = clampStr(m.title, 200);
  if (!deleted && (!isDate(m.date) || !title)) return null;
  return {
    id: m.id,
    date: isDate(m.date) ? m.date : '',
    title,
    recipeId: typeof m.recipeId === 'string' && /^[\w-]{1,64}$/.test(m.recipeId) ? m.recipeId : '',
    servings: Number.isInteger(m.servings) && m.servings >= 1 && m.servings <= 50 ? m.servings : 2,
    shopped: m.shopped === true, // Zutaten schon auf die Einkaufsliste gesetzt
    createdAt: Number.isFinite(m.createdAt) ? m.createdAt : m.updatedAt,
    updatedAt: m.updatedAt,
    deleted,
  };
}

// Gemeinsame Felder: id, Zeitstempel, Löschmarkierung
function baseItem(x) {
  if (!x || typeof x !== 'object') return null;
  if (typeof x.id !== 'string' || !/^[\w-]{1,64}$/.test(x.id)) return null;
  if (!Number.isFinite(x.updatedAt)) return null;
  return { id: x.id, createdAt: Number.isFinite(x.createdAt) ? x.createdAt : x.updatedAt, updatedAt: x.updatedAt, deleted: x.deleted === true };
}
const person = (p) => (['nick', 'partner'].includes(p) ? p : '');
const httpLink = (l) => { l = clampStr(l, 500); return /^https?:\/\//i.test(l) ? l : ''; };
const intIn = (v, lo, hi, def) => (Number.isInteger(v) && v >= lo && v <= hi ? v : def);

// Vorrat: was zu Hause ist (da / wird knapp / leer)
function cleanPantry(x) {
  const b = baseItem(x); if (!b) return null;
  const name = clampStr(x.name, 100);
  if (!b.deleted && !name) return null;
  return { ...b, name, cat: clampStr(x.cat, 40), status: ['ok', 'low', 'out'].includes(x.status) ? x.status : 'ok', best: isDate(x.best) ? x.best : '' }; // best = mindestens haltbar bis
}
// Pinnwand: kurze Nachricht an den anderen
function cleanBoard(x) {
  const b = baseItem(x); if (!b) return null;
  const text = clampStr(x.text, 500);
  if (!b.deleted && !text) return null;
  return { ...b, text, from: person(x.from) };
}
// Geburtstag: Tag und Monat, Jahr optional (für das Alter), Erinnerung N Tage vorher
function cleanBday(x) {
  const b = baseItem(x); if (!b) return null;
  const name = clampStr(x.name, 100);
  const month = intIn(x.month, 1, 12, 0), day = intIn(x.day, 1, 31, 0);
  if (!b.deleted && (!name || !month || !day)) return null;
  return { ...b, name, month, day, year: intIn(x.year, 1900, 2100, null), remind: intIn(x.remind, 0, 60, 7), note: clampStr(x.note, 1000), cat: clampStr(x.cat, 40) }; // cat = Kategorie, z. B. Familie
}
// Anschaffung: größere Sachen, die ihr kaufen wollt
function cleanWish(x) {
  const b = baseItem(x); if (!b) return null;
  const title = clampStr(x.title, 200);
  if (!b.deleted && !title) return null;
  return { ...b, title, price: clampStr(x.price, 30), prio: ['high', 'mid', 'low'].includes(x.prio) ? x.prio : 'mid', link: httpLink(x.link),
    note: clampStr(x.note, 1000), done: x.done === true, doneAt: Number.isFinite(x.doneAt) ? x.doneAt : null };
}
// Gerät: Kaufdatum, Garantie, Link zur Anleitung
function cleanDevice(x) {
  const b = baseItem(x); if (!b) return null;
  const name = clampStr(x.name, 100);
  if (!b.deleted && !name) return null;
  return { ...b, name, bought: isDate(x.bought) ? x.bought : '', warranty: isDate(x.warranty) ? x.warranty : '', link: httpLink(x.link), note: clampStr(x.note, 1000) };
}

// Termin: Tag, Uhrzeit optional, für wen (leer = beide)
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function cleanEvent(x) {
  const b = baseItem(x); if (!b) return null;
  const title = clampStr(x.title, 200);
  if (!b.deleted && (!title || !isDate(x.date))) return null;
  return { ...b, title, date: isDate(x.date) ? x.date : '', time: isTime(x.time) ? x.time : '', who: person(x.who), note: clampStr(x.note, 1000) };
}
// Zähler (Strom, Gas, Wasser) und Ablesungen. Ablesungen sind eigene Einträge, damit beide Handys gleichzeitig eintragen können.
function cleanMeter(x) {
  const b = baseItem(x); if (!b) return null;
  const name = clampStr(x.name, 60);
  if (!b.deleted && !name) return null;
  return { ...b, name, unit: clampStr(x.unit, 10), number: clampStr(x.number, 40), remind: x.remind !== false };
}
function cleanReading(x) {
  const b = baseItem(x); if (!b) return null;
  const ok = typeof x.meter === 'string' && /^[\w-]{1,64}$/.test(x.meter) && isDate(x.date) && Number.isFinite(x.value) && x.value >= 0 && x.value < 1e10;
  if (!b.deleted && !ok) return null;
  return { ...b, meter: ok ? x.meter : '', date: ok ? x.date : '', value: ok ? x.value : 0 };
}

// Alle Listen, die synchronisiert werden: Prüffunktion und Höchstzahl
const COLLECTIONS = {
  tasks: [cleanTask, MAX_TASKS],
  notes: [cleanNote, MAX_NOTES],
  shop: [cleanShopItem, MAX_SHOP],
  recipes: [cleanRecipe, MAX_RECIPES],
  meals: [cleanMeal, MAX_MEALS],
  pantry: [cleanPantry, 500],
  board: [cleanBoard, 300],
  bdays: [cleanBday, 300],
  wishes: [cleanWish, 300],
  devices: [cleanDevice, 200],
  events: [cleanEvent, 500],
  meters: [cleanMeter, 20],
  readings: [cleanReading, 3000],
};

// Gemeinsame Einstellungen (Namen, Urlaub): als Ganzes, die neuere Änderung gewinnt
function cleanSettings(s) {
  if (!s || typeof s !== 'object' || !Number.isFinite(s.updatedAt)) return null;
  const n = s.names && typeof s.names === 'object' ? s.names : {};
  const away = s.away && isDate(s.away.until) ? { until: s.away.until } : null; // Urlaub: zurück am
  // Reihenfolge der Bereiche im Laden (so, wie man durch den eigenen Supermarkt läuft)
  const shopOrder = Array.isArray(s.shopOrder) ? s.shopOrder.slice(0, 20).map((c) => clampStr(c, 40)).filter(Boolean) : [];
  // WLAN für Gäste (für den QR-Code)
  const w = s.wifi && typeof s.wifi === 'object' ? s.wifi : null;
  const wifi = w && clampStr(w.ssid, 64) ? { ssid: clampStr(w.ssid, 64), pass: typeof w.pass === 'string' ? w.pass.slice(0, 64) : '',
    type: ['WPA', 'WEP', 'nopass'].includes(w.type) ? w.type : 'WPA', hidden: w.hidden === true } : null;
  return { names: { nick: clampStr(n.nick, 30), partner: clampStr(n.partner, 30) }, away, shopOrder, wifi, updatedAt: s.updatedAt };
}

// Pro Eintrag gewinnt die neuere Änderung. Alte Löschmarkierungen fallen weg.
// Wird es zu viel, fallen zuerst Gelöschtes und Erledigtes weg, nie offene Einträge vor diesen.
function mergeItems(current, incoming, max) {
  const map = new Map();
  for (const t of current) map.set(t.id, t);
  for (const t of incoming) {
    const old = map.get(t.id);
    if (!old || t.updatedAt > old.updatedAt) map.set(t.id, t);
  }
  const cutoff = Date.now() - TOMBSTONE_MS;
  return [...map.values()]
    .filter((t) => !(t.deleted && t.updatedAt < cutoff))
    .sort((a, b) => (active(b) - active(a)) || b.updatedAt - a.updatedAt)
    .slice(0, max);
}
const active = (t) => (t.deleted || t.done ? 0 : 1);

// Aufräumen: erledigte Aufgaben älter als ein halbes Jahr und vergangene Essenspläne entfernen.
// Für „Zuletzt geputzt“ bleibt pro Bereich das zuletzt Erledigte in history.lastByCat.
// Schickt ein Gerät die alten Einträge noch einmal, werden sie hier einfach wieder entfernt.
function archive(out, history) {
  const h = { lastByCat: { ...((history && history.lastByCat) || {}) } };
  const cutoff = Date.now() - ARCHIVE_MS;
  out.tasks = out.tasks.filter((t) => {
    if (!(t.done && !t.deleted && t.doneAt && t.doneAt < cutoff)) return true;
    const last = h.lastByCat[t.category];
    if (!last || last.doneAt < t.doneAt) h.lastByCat[t.category] = { title: t.title, doneAt: t.doneAt, assignee: t.assignee };
    return false;
  });
  const oldDay = new Date(Date.now() - MEAL_KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  out.meals = out.meals.filter((m) => m.deleted || m.date >= oldDay);
  const oldMsg = Date.now() - BOARD_KEEP_DAYS * 864e5;
  out.board = out.board.filter((m) => m.deleted || m.createdAt >= oldMsg);
  out.wishes = out.wishes.filter((w) => !(w.done && !w.deleted && w.doneAt && w.doneAt < cutoff));
  const oldEvent = new Date(Date.now() - EVENT_KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  out.events = out.events.filter((e) => e.deleted || e.date >= oldEvent);
  // Ablesungen fallen weg, wenn ihr Zähler ganz vergessen ist (gelöschte Zähler werden 60 Tage gemerkt, so klappt „Rückgängig“)
  const meters = new Set(out.meters.map((m) => m.id));
  out.readings = out.readings.filter((r) => r.deleted || meters.has(r.meter));
  return Object.keys(h.lastByCat).length ? h : null;
}

// Lesen, zusammenführen, schreiben. Bei gleichzeitigem Schreiben wird wiederholt (optimistische Sperre).
// me = wer dieses Gerät benutzt ('nick' / 'partner' / ''), für Mitteilungen an das andere Handy
async function sync(env, id, incoming, incomingSettings, me) {
  for (let i = 0; i < 6; i++) {
    const row = await env.DB.prepare('SELECT data, updated_at FROM households WHERE id = ?').bind(id).first();
    if (!row) return null;
    const cur = JSON.parse(row.data);
    // Was ist neu? (für Mitteilungen: neue Pinnwand-Nachrichten, neue Sachen auf der Liste)
    const known = (k) => new Set((cur[k] || []).map((x) => x.id));
    const knownBoard = known('board'), knownShop = known('shop');
    const newBoard = incoming.board.filter((m) => !m.deleted && !knownBoard.has(m.id));
    const newShop = incoming.shop.filter((x) => !x.deleted && !x.done && !knownShop.has(x.id));
    let notify = cur.notify || null, shopNote = null;
    if (newShop.length) {
      const prev = notify && notify.shop;
      const fresh = !(prev && prev.from === me && Date.now() - prev.at < SHOP_NOTIFY_MS);
      const names = [...(fresh ? [] : prev.names), ...newShop.map((x) => x.name)].slice(-20);
      notify = { ...(notify || {}), shop: { from: me, names, at: Date.now() } };
      shopNote = { names, first: fresh };
    }
    const out = {};
    for (const [k, [, max]] of Object.entries(COLLECTIONS)) out[k] = mergeItems(cur[k] || [], incoming[k] || [], max);
    const history = archive(out, cur.history);
    let settings = cur.settings || null;
    if (incomingSettings && (!settings || incomingSettings.updatedAt > settings.updatedAt)) settings = incomingSettings;
    out.settings = settings;
    out.history = history;
    // Gespeichert wird nur, was es gibt (alte Datensätze ohne Notizen, Einkaufsliste usw. bleiben unverändert)
    const stored = { tasks: out.tasks };
    for (const k of Object.keys(COLLECTIONS)) if (k !== 'tasks' && (out[k].length || cur[k])) stored[k] = out[k];
    if (settings) stored.settings = settings;
    if (history) stored.history = history;
    if (notify) stored.notify = notify;
    out.added = { board: newBoard, shop: shopNote };
    const data = JSON.stringify(stored);
    if (data === row.data) return out; // nichts geändert, nichts schreiben
    if (data.length > MAX_DATA) return { tooBig: true };
    const v = Math.max(Date.now(), row.updated_at + 1);
    const r = await env.DB.prepare('UPDATE households SET data = ?, updated_at = ? WHERE id = ? AND updated_at = ?')
      .bind(data, v, id, row.updated_at).run();
    if (r.meta.changes === 1) return out;
  }
  throw new Error('Konflikt beim Speichern');
}

/* ------------------------------------------------------------------ */
/* Push-Erinnerungen (Web Push: VAPID-Signatur, Inhalt verschlüsselt   */
/* nach RFC 8291 „aes128gcm“)                                          */
/* ------------------------------------------------------------------ */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// Schlüsselpaar des Servers: beim ersten Bedarf erzeugt und in D1 gespeichert, danach immer dasselbe
let vapid = null;
async function getVapid(env) {
  if (vapid) return vapid;
  let row = await env.DB.prepare("SELECT v FROM config WHERE k = 'vapid'").first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    await env.DB.prepare("INSERT OR IGNORE INTO config (k, v) VALUES ('vapid', ?)").bind(JSON.stringify(jwk)).run();
    row = await env.DB.prepare("SELECT v FROM config WHERE k = 'vapid'").first(); // falls zwei Aufrufe gleichzeitig anlegen
  }
  const jwk = JSON.parse(row.v);
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  vapid = { key, pub: b64u(concat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y))) };
  return vapid;
}

async function vapidHeader(env, endpoint) {
  const { key, pub } = await getVapid(env);
  const part = (o) => b64u(enc.encode(JSON.stringify(o)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: PUSH_SUB });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${pub}`;
}

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

async function encryptPush(sub, text) {
  const uaPub = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(enc.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  return concat(head, asPub, ct);
}

// Schickt eine Nachricht an ein Gerät. Abgemeldete Geräte (404/410) werden gelöscht.
async function sendPush(env, sub, data) {
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(env, sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '43200',
      Urgency: 'normal',
    },
    body: await encryptPush(sub, JSON.stringify(data)),
  });
  if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
  return r.status;
}

// Mitteilungs-Arten pro Gerät (Spalte opts): täglich, Wochenrückblick, Pinnwand, neue Sachen auf der Liste
function subOpts(s) {
  let o = {};
  try { o = JSON.parse(s.opts || '{}'); } catch (e) { /* Standard */ }
  return { daily: o.daily !== false, weekly: o.weekly !== false, msgs: o.msgs !== false, shop: o.shop === true };
}
const shownNames = (data) => {
  const n = (data && data.settings && data.settings.names) || {};
  return { nick: n.nick || 'Nick', partner: n.partner || 'Freundin' };
};

// Sofort-Mitteilungen an die anderen Geräte des Haushalts (nicht an das Gerät, das es geschickt hat)
async function notifyOthers(env, id, out, me, device) {
  const { board, shop } = out.added || {};
  if (!(board && board.length) && !shop) return;
  const who = me ? shownNames(out)[me] : 'Jemand';
  const { results } = await env.DB.prepare('SELECT * FROM push_subs WHERE household = ?').bind(id).all();
  for (const s of results) {
    if (s.endpoint === device || (me && s.person === me)) continue;
    const o = subOpts(s);
    try {
      if (o.msgs) for (const m of board) await sendPush(env, s, { title: `📌 ${who}`, body: m.text, tag: 'putzplan-board-' + m.id, url: './?go=board' });
      if (o.shop && shop) await sendPush(env, s, { title: `🛒 ${who} hat etwas auf die Liste gesetzt`, body: shop.names.join(', '), tag: 'putzplan-shop', renotify: shop.first, url: './?go=list' });
    } catch (e) { /* nächstes Gerät */ }
  }
}

const validTz = (tz) => { try { new Intl.DateTimeFormat('de', { timeZone: tz }); return true; } catch (e) { return false; } };
// Datum und Minuten seit Mitternacht in der Zeitzone des Geräts
function localNow(tz, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: validTz(tz) ? tz : 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(now);
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, min: Number(g('hour')) * 60 + Number(g('minute')), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')) };
}

// Inhalt der täglichen Erinnerung: offene Aufgaben bis heute (für die Person plus nicht zugewiesene). null = nichts zu tun.
// Geburtstage heute, morgen und N Tage vorher (N pro Geburtstag einstellbar)
function birthdayLines(data, today) {
  const t = Date.parse(today + 'T00:00:00Z'), y = Number(today.slice(0, 4));
  const lines = [];
  for (const b of data.bdays || []) {
    if (b.deleted) continue;
    let next = Date.UTC(y, b.month - 1, b.day), year = y;
    if (next < t) { next = Date.UTC(y + 1, b.month - 1, b.day); year = y + 1; }
    const d = Math.round((next - t) / 864e5);
    const when = d === 0 ? 'Heute' : d === 1 ? 'Morgen' : d === b.remind ? `In ${d} Tagen` : null;
    if (when) lines.push({ d, text: `🎂 ${when}: ${b.name}${b.year ? ` wird ${year - b.year}` : ''}` });
  }
  return lines.sort((a, b) => a.d - b.d).map((l) => l.text);
}

const plusDays = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// Termine heute und morgen
function eventLines(data, today) {
  const tomorrow = plusDays(today, 1);
  return (data.events || []).filter((e) => !e.deleted && (e.date === today || e.date === tomorrow))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .map((e) => `📅 ${e.date === today ? 'Heute' : 'Morgen'}${e.time ? ' ' + e.time : ''}: ${e.title}`);
}
// Vorrat: läuft heute oder morgen ab
function expiryLines(data, today) {
  const tomorrow = plusDays(today, 1);
  const list = (data.pantry || []).filter((p) => !p.deleted && p.status !== 'out' && (p.best === today || p.best === tomorrow));
  const day = (d) => list.filter((p) => p.best === d).map((p) => p.name).join(', ');
  return [day(today) && `⏳ Läuft heute ab: ${day(today)}`, day(tomorrow) && `⏳ Läuft morgen ab: ${day(tomorrow)}`].filter(Boolean);
}
// Am Monatsersten: Zählerstände ablesen (wenn in den letzten 20 Tagen nicht abgelesen)
function meterLines(data, today) {
  if (!today.endsWith('-01')) return [];
  const since = plusDays(today, -20);
  const due = (data.meters || []).filter((m) => !m.deleted && m.remind
    && !(data.readings || []).some((r) => !r.deleted && r.meter === m.id && r.date >= since));
  return due.length ? [`📟 Zählerstände ablesen: ${due.map((m) => m.name).join(', ')}`] : [];
}

function reminderFor(data, person, today) {
  const away = data.settings && data.settings.away;
  const open = away && away.until > today ? [] : (data.tasks || []) // im Urlaub keine Aufgaben
    .filter((t) => !t.deleted && !t.done && t.due && t.due <= today && (!person || !t.assignee || t.assignee === person))
    .sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title, 'de'));
  const bdays = birthdayLines(data, today);
  const extra = [...eventLines(data, today), ...bdays, ...expiryLines(data, today), ...meterLines(data, today)];
  if (!open.length && !extra.length) return null;
  if (!open.length) {
    const title = extra.length === bdays.length ? (bdays.length === 1 ? 'Geburtstag' : 'Geburtstage') : 'Heute im Haushalt';
    return { title, body: extra.join('\n'), count: 0, tag: 'putzplan-today' };
  }
  const late = open.filter((t) => t.due < today).length;
  const list = open.slice(0, 4).map((t) => t.title).join(', ') + (open.length > 4 ? ` und ${open.length - 4} weitere` : '');
  return {
    title: open.length === 1 ? 'Heute steht 1 Aufgabe an' : `Heute stehen ${open.length} Aufgaben an`,
    body: list + (late ? ` (${late} überfällig)` : '') + (extra.length ? '\n' + extra.join('\n') : ''),
    count: open.length,
    tag: 'putzplan-today',
  };
}

// Wochenrückblick (sonntags): was in den letzten 7 Tagen erledigt wurde, wer wie lange, was nächste Woche ansteht
function weeklyFor(data, today, now) {
  const since = now.getTime() - 7 * 864e5;
  const tasks = (data.tasks || []).filter((t) => !t.deleted);
  const done = tasks.filter((t) => t.done && t.doneAt >= since);
  const end = new Date(Date.parse(today + 'T00:00:00Z') + 7 * 864e5).toISOString().slice(0, 10);
  const next = tasks.filter((t) => !t.done && t.due && t.due > today && t.due <= end).length;
  if (!done.length && !next) return null;
  const n = shownNames(data);
  const min = { nick: 0, partner: 0 };
  for (const t of done) if (t.assignee) min[t.assignee] += t.minutes || 0;
  const fmt = (m) => (m >= 60 ? `${String(Math.round(m / 6) / 10).replace('.', ',')} Std.` : `${m} Min.`);
  const parts = [`${done.length} ${done.length === 1 ? 'Aufgabe' : 'Aufgaben'} erledigt`];
  if (min.nick || min.partner) parts.push(`${n.nick} ${fmt(min.nick)}`, `${n.partner} ${fmt(min.partner)}`);
  return { title: 'Wochenrückblick', body: parts.join(' · ') + `\nNächste Woche: ${next} ${next === 1 ? 'Aufgabe' : 'Aufgaben'}`, tag: 'putzplan-weekly' };
}

// Zeitplan: alle 15 Minuten. Jedes Gerät bekommt höchstens eine Erinnerung pro Tag, ab seiner Uhrzeit (bis 3 Stunden später nachgeholt).
async function runReminders(env, now = new Date()) {
  await init(env);
  const { results } = await env.DB.prepare('SELECT * FROM push_subs').all();
  const households = new Map();
  let sent = 0;
  const load = async (hh) => {
    if (!households.has(hh)) {
      const row = await env.DB.prepare('SELECT data FROM households WHERE id = ?').bind(hh).first();
      households.set(hh, row ? JSON.parse(row.data) : null);
    }
    return households.get(hh);
  };
  for (const s of results) {
    const o = subOpts(s);
    const { date, min, wd } = localNow(s.tz, now);
    const [h, m] = s.time.split(':').map(Number);
    const daily = o.daily && s.last_sent !== date && min >= h * 60 + m && min < h * 60 + m + 180;
    const weekly = o.weekly && wd === 0 && min >= 19 * 60 && s.last_weekly !== date; // sonntags ab 19 Uhr
    if (!daily && !weekly) continue;
    const data = await load(s.household);
    if (!data) { await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint).run(); continue; }
    const msgs = [];
    if (daily) {
      await env.DB.prepare('UPDATE push_subs SET last_sent = ? WHERE endpoint = ?').bind(date, s.endpoint).run();
      msgs.push(reminderFor(data, s.person, date));
    }
    if (weekly) {
      await env.DB.prepare('UPDATE push_subs SET last_weekly = ? WHERE endpoint = ?').bind(date, s.endpoint).run();
      msgs.push(weeklyFor(data, date, now));
    }
    for (const msg of msgs.filter(Boolean)) {
      try { await sendPush(env, s, msg); sent++; } catch (e) { /* nächstes Gerät */ }
    }
  }
  return sent;
}

function cleanSub(body) {
  const sub = body && body.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000 || !sub.keys) return null;
  let url;
  try { url = new URL(sub.endpoint); } catch (e) { return null; }
  const { p256dh, auth } = sub.keys;
  if (typeof p256dh !== 'string' || !/^[\w-]{80,100}$/.test(p256dh) || typeof auth !== 'string' || !/^[\w-]{16,30}$/.test(auth)) return null;
  const time = typeof body.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ? body.time : '08:00';
  const tz = typeof body.tz === 'string' && body.tz.length <= 64 && validTz(body.tz) ? body.tz : 'Europe/Berlin';
  const o = body.opts && typeof body.opts === 'object' ? body.opts : {};
  const opts = JSON.stringify({ daily: o.daily !== false, weekly: o.weekly !== false, msgs: o.msgs !== false, shop: o.shop === true });
  return { endpoint: sub.endpoint, host: url.hostname, https: url.protocol === 'https:', p256dh, auth, time, tz, person: person(body.person), opts };
}

/* ------------------------------------------------------------------ */
/* Geheime Links: Kalender-Abo und „auf die Liste“ (Siri, Google, …)   */
/* Der Link enthält einen langen Zufallswert statt des Haushaltscodes. */
/* ------------------------------------------------------------------ */
const LINK_KINDS = ['cal', 'add'];
async function getLink(env, id, kind, reset) {
  if (reset) await env.DB.prepare('DELETE FROM links WHERE household = ? AND kind = ?').bind(id, kind).run();
  const row = await env.DB.prepare('SELECT token FROM links WHERE household = ? AND kind = ?').bind(id, kind).first();
  if (row) return row.token;
  const token = b64u(crypto.getRandomValues(new Uint8Array(18)));
  await env.DB.prepare('INSERT INTO links (token, household, kind, created) VALUES (?, ?, ?, ?)').bind(token, id, kind, Date.now()).run();
  return token;
}
async function linkHousehold(env, token, kind) {
  if (!/^[\w-]{24}$/.test(token)) return null;
  const row = await env.DB.prepare('SELECT household FROM links WHERE token = ? AND kind = ?').bind(token, kind).first();
  return row ? row.household : null;
}

// Kalender (iCalendar, RFC 5545): Termine, Geburtstage (jährlich), Garantie-Ende; auf Wunsch Putzaufgaben und Essensplan
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFold(line) { // Zeilen höchstens 75 Bytes, Fortsetzung mit Leerzeichen (UTF-8-Zeichen nicht zerschneiden)
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const icsDate = (k) => k.replace(/-/g, '');
function buildCalendar(data, opts, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const today = now.toISOString().slice(0, 10), from = plusDays(today, -30);
  const n = shownNames(data);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Haushalt//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Haushalt', 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const ev = (uid, props) => lines.push('BEGIN:VEVENT', `UID:${uid}@haushalt`, `DTSTAMP:${stamp}`, ...props, 'END:VEVENT');
  const allDay = (k) => [`DTSTART;VALUE=DATE:${icsDate(k)}`, `DTEND;VALUE=DATE:${icsDate(plusDays(k, 1))}`];
  const live = (k) => (data[k] || []).filter((x) => !x.deleted);
  for (const e of live('events')) {
    if (e.date < from) continue;
    const who = e.who ? ` (${n[e.who]})` : '';
    let when = allDay(e.date);
    if (e.time) { // ohne Zeitzone = Ortszeit des Kalenders, eine Stunde lang
      const start = Date.parse(`${e.date}T${e.time}:00Z`), end = new Date(start + 3600e3).toISOString();
      when = [`DTSTART:${icsDate(e.date)}T${e.time.replace(':', '')}00`, `DTEND:${icsDate(end.slice(0, 10))}T${end.slice(11, 16).replace(':', '')}00`];
    }
    ev('event-' + e.id, [...when, `SUMMARY:${icsText('📅 ' + e.title + who)}`, ...(e.note ? [`DESCRIPTION:${icsText(e.note)}`] : [])]);
  }
  for (const b of live('bdays')) {
    const y = b.year || 2000, k = `${y}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`;
    if (!isDate(k) || Number.isNaN(Date.parse(k))) continue;
    ev('bday-' + b.id, [...allDay(k), 'RRULE:FREQ=YEARLY', `SUMMARY:${icsText('🎂 ' + b.name)}`, 'TRANSP:TRANSPARENT',
      ...(b.year ? [`DESCRIPTION:${icsText('Geboren ' + b.year)}`] : [])]);
  }
  for (const d of live('devices')) {
    if (d.warranty && d.warranty >= from) ev('warranty-' + d.id, [...allDay(d.warranty), `SUMMARY:${icsText('⚠ Garantie endet: ' + d.name)}`, 'TRANSP:TRANSPARENT']);
  }
  if (opts.tasks) {
    for (const t of live('tasks')) {
      if (t.done || !t.due || t.due < from) continue;
      ev('task-' + t.id, [...allDay(t.due), `SUMMARY:${icsText('🧽 ' + t.title + (t.assignee ? ` (${n[t.assignee]})` : ''))}`, 'TRANSP:TRANSPARENT']);
    }
  }
  if (opts.meals) {
    for (const m of live('meals')) {
      if (m.date >= from) ev('meal-' + m.id, [...allDay(m.date), `SUMMARY:${icsText('🍽 ' + m.title)}`, 'TRANSP:TRANSPARENT']);
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

// „Milch, Eier und Butter“ → einzelne Einträge auf der Einkaufsliste (Bereich und Menge ergänzt die App)
async function addByVoice(env, id, text, who) {
  const names = String(text || '').slice(0, 300).split(/\r?\n|[,;]| und | sowie /i)
    .map((x) => x.trim().replace(/[.!?]+$/, '')).filter(Boolean).slice(0, 10)
    .map((x) => (x[0].toUpperCase() + x.slice(1)).slice(0, 100));
  if (!names.length) return { names: [], exists: [] };
  const row = await env.DB.prepare('SELECT data FROM households WHERE id = ?').bind(id).first();
  if (!row) return null;
  const cur = JSON.parse(row.data);
  const key = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const open = new Map((cur.shop || []).filter((i) => !i.deleted).map((i) => [key(i.name), i]));
  const now = Date.now(), items = [], exists = [];
  names.forEach((name, i) => {
    const old = open.get(key(name));
    if (old && !old.done) { exists.push(old.name); return; }
    // Abgehakt: wieder auf die Liste (gleicher Eintrag), sonst neu
    items.push(old ? { ...old, done: false, doneAt: null, updatedAt: Math.max(now, old.updatedAt + 1) }
      : { id: 'v' + now.toString(36) + i + Math.random().toString(36).slice(2, 7), name, qty: '', from: '', cat: '', done: false, doneAt: null, createdAt: now, updatedAt: now, deleted: false });
    open.set(key(name), { name, done: false });
  });
  if (!items.length) return { names: [], exists };
  const incoming = Object.fromEntries(Object.keys(COLLECTIONS).map((k) => [k, []]));
  incoming.shop = items.map(cleanShopItem).filter(Boolean);
  const out = await sync(env, id, incoming, null, who);
  return { names: items.map((x) => x.name), exists, out };
}
const listText = (a) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' und ' + a[a.length - 1] : a[0] || '');

/* ------------------------------------------------------------------ */
/* Kassenbon lesen (Workers AI): Foto/PDF-Text rein, Artikel raus     */
/* ------------------------------------------------------------------ */
const RECEIPT_RULES = `Liste alle gekauften Artikel auf. Schreibe abgekürzte Bezeichnungen als normale deutsche Wörter aus, so wie man sie auf einen Einkaufszettel schreibt
(z. B. "BIO VOLLM.3,5%" -> "Vollmilch", "GOUDA JG.SCHB." -> "Gouda", "BANANEN LOSE" -> "Bananen", "SPUELM.ZITR" -> "Spülmittel").
Kauft jemand etwas mehrfach, gib die Anzahl als qty an.
Lass Pfand, Leergut, Tüten, Rabatte, Coupons, Summen, Steuern und Zahlungsangaben weg.
Antworte nur mit JSON in dieser Form, ohne weiteren Text:
{"store": "Name des Ladens", "items": [{"name": "Vollmilch", "qty": "2"}]}`;
const RECEIPT_PROMPT = `Das Bild zeigt einen Kassenbon aus einem deutschen Supermarkt oder einer Drogerie.\n${RECEIPT_RULES}`;
// PDF-Bons (z. B. eBons aus der Supermarkt-App): die App schickt den Text, den sie aus der PDF gelesen hat
const RECEIPT_TEXT_PROMPT = `Unten steht der Text eines Kassenbons aus einem deutschen Supermarkt oder einer Drogerie (aus einer PDF, Spalten durch Leerzeichen getrennt).\n${RECEIPT_RULES}\n\nText des Bons:\n`;
// Was kein Artikel ist (falls das Modell es trotzdem aufführt)
const NOT_ITEM = /pfand|leergut|t(ü|ue)te|tragetasche|summe|gesamt|zwischensumme|r(ü|ue)ckgeld|mwst|steuer|rabatt|coupon|payback|kartenzahlung|ec-?karte|bar\b|gegeben|netto|brutto|bonus/i;
// Modelle in dieser Reihenfolge; das erste, das antwortet, wird gemerkt (für Fotos und für Text getrennt)
const VISION_MODELS = [
  ['@cf/meta/llama-4-scout-17b-16e-instruct', 'parts'],
  ['@cf/google/gemma-3-12b-it', 'parts'],
  ['@cf/mistralai/mistral-small-3.1-24b-instruct', 'parts'],
  ['@cf/meta/llama-3.2-11b-vision-instruct', 'image'],
];
const TEXT_MODELS = [
  ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'text'],
  ['@cf/meta/llama-4-scout-17b-16e-instruct', 'text'],
  ['@cf/mistralai/mistral-small-3.1-24b-instruct', 'text'],
  ['@cf/meta/llama-3.1-8b-instruct-fast', 'text'],
];
const goodModel = {};
async function askModel(env, model, kind, data) {
  const input = kind === 'text' ? { messages: [{ role: 'user', content: RECEIPT_TEXT_PROMPT + data }], max_tokens: 1500, temperature: 0.1 }
    : kind === 'parts' ? { messages: [{ role: 'user', content: [{ type: 'text', text: RECEIPT_PROMPT }, { type: 'image_url', image_url: { url: data } }] }], max_tokens: 1500, temperature: 0.1 }
    : { messages: [{ role: 'user', content: RECEIPT_PROMPT }], image: data, max_tokens: 1500, temperature: 0.1 };
  try { return await env.AI.run(model, input); }
  catch (e) {
    // Llama 3.2 Vision verlangt einmalig die Zustimmung zur Lizenz
    if (/agree/i.test(String(e && e.message))) { await env.AI.run(model, { prompt: 'agree' }).catch(() => {}); return env.AI.run(model, input); }
    throw e;
  }
}
function parseReceipt(out) {
  let text = out && (out.response ?? out.result ?? out);
  if (text && typeof text === 'object') text = JSON.stringify(text);
  text = String(text || '');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  let data = null;
  try { data = JSON.parse(text.slice(a, b + 1)); } catch (e) { /* vielleicht nur eine Liste */ }
  if (!data) { const x = text.indexOf('['), y = text.lastIndexOf(']'); try { data = { items: JSON.parse(text.slice(x, y + 1)) }; } catch (e) { return null; } }
  const seen = new Set(), items = [];
  for (const it of Array.isArray(data.items) ? data.items : []) {
    const name = clampStr(typeof it === 'string' ? it : it && (it.name || it.artikel || it.item), 60).replace(/\s+/g, ' ');
    if (!name || NOT_ITEM.test(name) || /^[\d.,\s€-]+$/.test(name)) continue;
    const key = name.toLowerCase();
    const qty = clampStr(String((it && (it.qty ?? it.menge ?? it.anzahl)) ?? ''), 20).replace(/^1$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ name: name[0].toUpperCase() + name.slice(1), qty: qty === '0' ? '' : qty });
    if (items.length >= 60) break;
  }
  return { store: clampStr(data.store || data.laden || '', 60), items };
}
// { image } (Foto als data-URL) oder { text } (aus einer PDF)
async function readReceipt(env, { image, text }) {
  if (env.FAKE_RECEIPT === '1') { // nur in den Tests: festes Beispiel, inkl. Dingen, die herausgefiltert werden
    return parseReceipt({ response: 'Hier: {"store":"Testmarkt","items":[{"name":"Vollmilch","qty":"2"},{"name":"bananen","qty":"1"},{"name":"Spülmittel"},{"name":"Pfand"},{"name":"Vollmilch","qty":"2"},{"name":"Summe"},{"name":"Kaffee"}]}' });
  }
  if (!env.AI) return { error: 'ai' };
  const src = text ? 'text' : 'image', list = text ? TEXT_MODELS : VISION_MODELS, good = goodModel[src];
  const tried = [];
  for (const m of good ? [good, ...list.filter((x) => x !== good)] : list) {
    const [model, kind] = m;
    try {
      const r = parseReceipt(await askModel(env, model, kind, text || image));
      if (r) { goodModel[src] = m; return { ...r, model }; }
      tried.push(model + ': keine Liste');
    } catch (e) { tried.push(model + ': ' + String(e && e.message || e).slice(0, 200)); }
  }
  return { error: 'ai', tried };
}

/* ------------------------------------------------------------------ */
/* HTTP-API                                                            */
/* ------------------------------------------------------------------ */
async function readJson(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) { const e = new Error('too_big'); e.tooBig = true; throw e; }
  return text ? JSON.parse(text) : {};
}

// Gibt die Haushalts-ID zurück, oder eine Fehlerantwort
async function authenticate(req, env) {
  const ipKey = await sha256hex('ip:' + (req.headers.get('CF-Connecting-IP') || 'local'));
  if (await isLocked(env, ipKey)) return { error: json(req, { error: 'locked' }, 429) };
  const m = /^Bearer\s+(\d{6})$/.exec(req.headers.get('Authorization') || '');
  const id = m ? await householdId(m[1]) : null;
  const exists = id && await env.DB.prepare('SELECT 1 FROM households WHERE id = ?').bind(id).first();
  if (!exists) {
    await recordFail(env, ipKey);
    return { error: json(req, { error: 'code' }, 401) };
  }
  await clearFails(env, ipKey);
  return { id };
}

async function handle(req, env, ctx) {
  const path = new URL(req.url).pathname;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  const origin = req.headers.get('Origin');
  if (origin && !allowedOrigin(req, origin)) return json(req, { error: 'origin' }, 403);

  await init(env);

  if (path === '/' || path === '/api') return json(req, { ok: true, name: 'putzplan-api' });

  // Neuen Haushalt anlegen: gibt den Code einmal zurück
  if (path === '/api/household' && req.method === 'POST') {
    for (let i = 0; i < 5; i++) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
      const id = await householdId(code);
      const r = await env.DB.prepare("INSERT OR IGNORE INTO households (id, data, updated_at) VALUES (?, '{\"tasks\":[]}', ?)")
        .bind(id, Date.now()).run();
      if (r.meta.changes === 1) return json(req, { code });
    }
    return json(req, { error: 'server' }, 500);
  }

  // Nur für Tests (lokal mit --var ALLOW_LOCAL_PUSH:1): Zeitplan zu einem bestimmten Zeitpunkt ausführen
  if (path === '/api/push/run' && req.method === 'POST' && env.ALLOW_LOCAL_PUSH === '1') {
    const body = await readJson(req);
    return json(req, { sent: await runReminders(env, body.now ? new Date(body.now) : new Date()) });
  }

  // Kalender-Abo: /api/cal/<token>.ics?t=1&m=1 (t = Putzaufgaben, m = Essensplan)
  const cal = /^\/api\/cal\/([\w-]+)\.ics$/.exec(path);
  if (cal && (req.method === 'GET' || req.method === 'HEAD')) {
    const hh = await linkHousehold(env, cal[1], 'cal');
    const row = hh && await env.DB.prepare('SELECT data FROM households WHERE id = ?').bind(hh).first();
    if (!row) return new Response('Diesen Kalender gibt es nicht (mehr).', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    const q = new URL(req.url).searchParams;
    const body = buildCalendar(JSON.parse(row.data), { tasks: q.get('t') === '1', meals: q.get('m') === '1' });
    return new Response(req.method === 'HEAD' ? null : body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Disposition': 'inline; filename="haushalt.ics"' } });
  }

  // Auf die Einkaufsliste (Siri-Kurzbefehl, HTTP-Shortcuts): /api/add/<token>?w=nick, Text als t (Adresse, Formular, JSON oder reiner Text)
  const add = /^\/api\/add\/([\w-]+)$/.exec(path);
  if (add && (req.method === 'GET' || req.method === 'POST')) {
    const txt = (s, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders(req) } });
    const hh = await linkHousehold(env, add[1], 'add');
    if (!hh) return txt('Dieser Link ist nicht mehr gültig. Bitte in der App unter Einstellungen einen neuen kopieren.', 404);
    const q = new URL(req.url).searchParams;
    let text = q.get('t') || q.get('text') || '';
    if (!text && req.method === 'POST') {
      const type = req.headers.get('Content-Type') || '';
      if (/json/.test(type)) { const b = await readJson(req); text = String(b.t || b.text || ''); }
      else if (/form/.test(type)) { const f = await req.formData(); text = String(f.get('t') || f.get('text') || ''); }
      else text = (await req.text()).slice(0, 1000);
    }
    const who = person(q.get('w'));
    const r = await addByVoice(env, hh, text, who);
    if (!r) return txt('Diesen Haushalt gibt es nicht mehr.', 404);
    if (r.out && r.out.added && r.out.added.shop && ctx) ctx.waitUntil(notifyOthers(env, hh, r.out, who, ''));
    if (!r.names.length && !r.exists.length) return txt('Ich habe nichts verstanden. Bitte nochmal.', 400);
    const parts = [];
    if (r.names.length) parts.push(`${listText(r.names)} ${r.names.length === 1 ? 'steht' : 'stehen'} jetzt auf der Einkaufsliste.`);
    if (r.exists.length) parts.push(`${listText(r.exists)} ${r.exists.length === 1 ? 'stand' : 'standen'} schon drauf.`);
    return txt(parts.join(' '));
  }

  // Öffentlicher Schlüssel für die Push-Anmeldung im Browser
  if (path === '/api/push/key') return json(req, { publicKey: (await getVapid(env)).pub });

  const auth = await authenticate(req, env);
  if (auth.error) return auth.error;

  // Code prüfen (wird beim Verbinden benutzt)
  if (path === '/api/join' && req.method === 'POST') return json(req, { ok: true });

  // Geheimen Link holen (oder mit reset: true einen neuen erzeugen, der alte gilt dann nicht mehr)
  if (path === '/api/link' && req.method === 'POST') {
    const body = await readJson(req);
    if (!LINK_KINDS.includes(body.kind)) return json(req, { error: 'kind' }, 400);
    return json(req, { token: await getLink(env, auth.id, body.kind, body.reset === true) });
  }

  if (path === '/api/sync' && req.method === 'POST') {
    const body = await readJson(req);
    const incoming = {};
    for (const [k, [clean, max]] of Object.entries(COLLECTIONS)) incoming[k] = (Array.isArray(body[k]) ? body[k].slice(0, max) : []).map(clean).filter(Boolean);
    const me = person(body.me);
    const out = await sync(env, auth.id, incoming, cleanSettings(body.settings), me);
    if (!out) return json(req, { error: 'unknown' }, 404);
    if (out.tooBig) return json(req, { error: 'too_big' }, 413);
    const { added, ...rest } = out;
    if (added && (added.board.length || added.shop) && ctx) ctx.waitUntil(notifyOthers(env, auth.id, out, me, String(body.device || '')));
    return json(req, { ...rest, serverTime: Date.now() });
  }

  // Kassenbon lesen: { image: 'data:image/jpeg;base64,…' } oder { text: '…' } (aus einer PDF) → { store, items: [{ name, qty }] }
  if (path === '/api/receipt' && req.method === 'POST') {
    const body = await readJson(req);
    const img = String(body.image || ''), text = clampStr(body.text, 20000);
    if (body.text !== undefined) { if (text.replace(/\s/g, '').length < 20) return json(req, { error: 'text' }, 400); }
    else if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]{100,}$/.test(img)) return json(req, { error: 'image' }, 400);
    const day = new Date().toISOString().slice(0, 10), key = `scan:${auth.id}:${day}`;
    const used = await env.DB.prepare('SELECT n FROM usage WHERE k = ?').bind(key).first();
    if (used && used.n >= MAX_SCANS) return json(req, { error: 'limit' }, 429);
    await env.DB.prepare('INSERT INTO usage (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1').bind(key).run();
    await env.DB.prepare("DELETE FROM usage WHERE k LIKE 'scan:%' AND k NOT LIKE ?").bind(`scan:%:${day}`).run(); // alte Tage vergessen
    const r = await readReceipt(env, text ? { text } : { image: img });
    if (r.error) return json(req, { error: r.error, ...(body.debug ? { tried: r.tried } : {}) }, 503);
    if (!r.items.length) return json(req, { error: 'empty', ...(body.debug ? { model: r.model } : {}) }, 422);
    return json(req, { store: r.store, items: r.items, ...(body.debug ? { model: r.model } : {}) });
  }

  // Gerät für Erinnerungen anmelden (oder Einstellungen ändern)
  if (path === '/api/push/subscribe' && req.method === 'POST') {
    const sub = cleanSub(await readJson(req));
    const local = env.ALLOW_LOCAL_PUSH === '1' && (sub && (sub.host === '127.0.0.1' || sub.host === 'localhost'));
    if (!sub || !(local || (sub.https && PUSH_HOSTS.test(sub.host)))) return json(req, { error: 'subscription' }, 400);
    await env.DB.prepare(`INSERT INTO push_subs (endpoint, household, p256dh, auth, person, time, tz, created, opts) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(endpoint) DO UPDATE SET household = ?2, p256dh = ?3, auth = ?4, person = ?5, time = ?6, tz = ?7, opts = ?9`)
      .bind(sub.endpoint, auth.id, sub.p256dh, sub.auth, sub.person, sub.time, sub.tz, Date.now(), sub.opts).run();
    // Höchstens MAX_SUBS Geräte pro Haushalt, die ältesten fliegen raus
    await env.DB.prepare(`DELETE FROM push_subs WHERE household = ?1 AND endpoint NOT IN
        (SELECT endpoint FROM push_subs WHERE household = ?1 ORDER BY created DESC LIMIT ?2)`).bind(auth.id, MAX_SUBS).run();
    return json(req, { ok: true });
  }

  if (path === '/api/push/unsubscribe' && req.method === 'POST') {
    const body = await readJson(req);
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND household = ?').bind(String(body.endpoint || ''), auth.id).run();
    return json(req, { ok: true });
  }

  // Test: schickt sofort die heutige Erinnerung (oder einen Hinweis, wenn nichts ansteht)
  if (path === '/api/push/test' && req.method === 'POST') {
    const body = await readJson(req);
    const s = await env.DB.prepare('SELECT * FROM push_subs WHERE endpoint = ? AND household = ?').bind(String(body.endpoint || ''), auth.id).first();
    if (!s) return json(req, { error: 'not subscribed' }, 404);
    const row = await env.DB.prepare('SELECT data FROM households WHERE id = ?').bind(auth.id).first();
    const msg = reminderFor(JSON.parse(row.data), s.person, localNow(s.tz).date)
      || { title: 'Test erfolgreich', body: `So meldet sich die Haushalt-App jeden Tag um ${s.time} Uhr, wenn etwas ansteht.`, tag: 'putzplan-test' };
    const status = await sendPush(env, s, msg);
    return json(req, { ok: status >= 200 && status < 300, status }, status >= 200 && status < 300 ? 200 : 502);
  }

  return json(req, { error: 'not found' }, 404);
}

export default {
  async fetch(req, env, ctx) {
    try { return await handle(req, env, ctx); }
    catch (e) {
      if (e && e.tooBig) return json(req, { error: 'too_big' }, 413);
      return json(req, { error: 'server', detail: String(e && e.message || e) }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  },
};
