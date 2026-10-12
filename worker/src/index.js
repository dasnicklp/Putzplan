// Putzplan-Backend (Cloudflare Worker + D1)
// - Liefert außerdem die App (docs/) als statische Dateien aus, siehe [assets] in wrangler.toml
// - Zugang über einen 6-stelligen Haushaltscode, kein Konto
// - Sync: Geräte schicken Aufgaben, Notizen, Einkaufsliste, Vorrat, Rezepte, Essensplan, Pinnwand, Geburtstage, Wünsche und Geräte, der Server führt sie zusammen (neueste Änderung gewinnt pro Eintrag)
// - Nach 5 falschen Codes von einer IP wird diese IP 15 Minuten gesperrt
// - Mitteilungen: Geräte melden sich für Web Push an. Ein Zeitplan (alle 15 Minuten) schickt einmal am Tag die offenen Aufgaben
//   und Geburtstage, sonntags den Wochenrückblick. Pinnwand-Nachrichten und neue Sachen auf der Liste gehen sofort an das andere Handy.

const ORIGINS = [
  'https://dasnicklp.github.io',
  'http://localhost:8765', 'http://127.0.0.1:8765',
];
const MAX_BODY = 1024 * 1024;
const MAX_TASKS = 2000;
const MAX_NOTES = 1000;
const MAX_SHOP = 1000;
const MAX_RECIPES = 300;
const MAX_MEALS = 500;
const ARCHIVE_MS = 180 * 864e5; // erledigte Aufgaben nach einem halben Jahr aufräumen (nur „Zuletzt geputzt“ merkt sich das Letzte pro Bereich)
const MEAL_KEEP_DAYS = 60;      // Essensplan: vergangene Tage nach 60 Tagen löschen
const BOARD_KEEP_DAYS = 30;     // Pinnwand: Nachrichten nach 30 Tagen löschen
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
  return { ...b, name, cat: clampStr(x.cat, 40), status: ['ok', 'low', 'out'].includes(x.status) ? x.status : 'ok' };
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
  return { ...b, name, month, day, year: intIn(x.year, 1900, 2100, null), remind: intIn(x.remind, 0, 60, 7), note: clampStr(x.note, 1000) };
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
};

// Gemeinsame Einstellungen (Namen, Urlaub): als Ganzes, die neuere Änderung gewinnt
function cleanSettings(s) {
  if (!s || typeof s !== 'object' || !Number.isFinite(s.updatedAt)) return null;
  const n = s.names && typeof s.names === 'object' ? s.names : {};
  const away = s.away && isDate(s.away.until) ? { until: s.away.until } : null; // Urlaub: zurück am
  // Reihenfolge der Bereiche im Laden (so, wie man durch den eigenen Supermarkt läuft)
  const shopOrder = Array.isArray(s.shopOrder) ? s.shopOrder.slice(0, 20).map((c) => clampStr(c, 40)).filter(Boolean) : [];
  return { names: { nick: clampStr(n.nick, 30), partner: clampStr(n.partner, 30) }, away, shopOrder, updatedAt: s.updatedAt };
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

function reminderFor(data, person, today) {
  const away = data.settings && data.settings.away;
  const open = away && away.until > today ? [] : (data.tasks || []) // im Urlaub keine Aufgaben
    .filter((t) => !t.deleted && !t.done && t.due && t.due <= today && (!person || !t.assignee || t.assignee === person))
    .sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title, 'de'));
  const bdays = birthdayLines(data, today);
  if (!open.length && !bdays.length) return null;
  if (!open.length) return { title: bdays.length === 1 ? 'Geburtstag' : 'Geburtstage', body: bdays.join('\n'), count: 0, tag: 'putzplan-today' };
  const late = open.filter((t) => t.due < today).length;
  const list = open.slice(0, 4).map((t) => t.title).join(', ') + (open.length > 4 ? ` und ${open.length - 4} weitere` : '');
  return {
    title: open.length === 1 ? 'Heute steht 1 Aufgabe an' : `Heute stehen ${open.length} Aufgaben an`,
    body: list + (late ? ` (${late} überfällig)` : '') + (bdays.length ? '\n' + bdays.join('\n') : ''),
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

  // Öffentlicher Schlüssel für die Push-Anmeldung im Browser
  if (path === '/api/push/key') return json(req, { publicKey: (await getVapid(env)).pub });

  const auth = await authenticate(req, env);
  if (auth.error) return auth.error;

  // Code prüfen (wird beim Verbinden benutzt)
  if (path === '/api/join' && req.method === 'POST') return json(req, { ok: true });

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
