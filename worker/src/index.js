// Putzplan-Backend (Cloudflare Worker + D1)
// - Liefert außerdem die App (docs/) als statische Dateien aus, siehe [assets] in wrangler.toml
// - Zugang über einen 6-stelligen Haushaltscode, kein Konto
// - Sync: Geräte schicken Aufgaben und Notizen, der Server führt sie zusammen (neueste Änderung gewinnt pro Eintrag)
// - Nach 5 falschen Codes von einer IP wird diese IP 15 Minuten gesperrt

const ORIGINS = [
  'https://dasnicklp.github.io',
  'http://localhost:8765', 'http://127.0.0.1:8765',
];
const MAX_BODY = 1024 * 1024;
const MAX_TASKS = 2000;
const MAX_NOTES = 1000;
const MAX_DATA = 1500 * 1024; // D1 erlaubt ca. 2 MB pro Zeile
const TOMBSTONE_MS = 60 * 864e5; // gelöschte Aufgaben 60 Tage merken, damit andere Geräte sie auch löschen
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60000;
const CATEGORIES = ['Küche', 'Bad', 'Wohnzimmer', 'Wäsche', 'Sonstiges'];

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
  ]);
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
    repeat: ['weekly', 'monthly'].includes(t.repeat) ? t.repeat : 'none',
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

// Gemeinsame Einstellungen (z. B. Namen): als Ganzes, die neuere Änderung gewinnt
function cleanSettings(s) {
  if (!s || typeof s !== 'object' || !Number.isFinite(s.updatedAt)) return null;
  const n = s.names && typeof s.names === 'object' ? s.names : {};
  return { names: { nick: clampStr(n.nick, 30), partner: clampStr(n.partner, 30) }, updatedAt: s.updatedAt };
}

// Pro Eintrag (Aufgabe oder Notiz) gewinnt die neuere Änderung. Alte Löschmarkierungen fallen weg.
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
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max);
}

// Lesen, zusammenführen, schreiben. Bei gleichzeitigem Schreiben wird wiederholt (optimistische Sperre).
async function sync(env, id, incoming, incomingNotes, incomingSettings) {
  for (let i = 0; i < 6; i++) {
    const row = await env.DB.prepare('SELECT data, updated_at FROM households WHERE id = ?').bind(id).first();
    if (!row) return null;
    const cur = JSON.parse(row.data);
    const merged = mergeItems(cur.tasks || [], incoming, MAX_TASKS);
    const notes = mergeItems(cur.notes || [], incomingNotes, MAX_NOTES);
    let settings = cur.settings || null;
    if (incomingSettings && (!settings || incomingSettings.updatedAt > settings.updatedAt)) settings = incomingSettings;
    const out = { tasks: merged, notes, settings };
    // Gespeichert wird nur, was es gibt (alte Datensätze ohne Notizen bleiben unverändert)
    const stored = { tasks: merged };
    if (notes.length || cur.notes) stored.notes = notes;
    if (settings) stored.settings = settings;
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

async function handle(req, env) {
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

  const auth = await authenticate(req, env);
  if (auth.error) return auth.error;

  // Code prüfen (wird beim Verbinden benutzt)
  if (path === '/api/join' && req.method === 'POST') return json(req, { ok: true });

  if (path === '/api/sync' && req.method === 'POST') {
    const body = await readJson(req);
    const incoming = (Array.isArray(body.tasks) ? body.tasks.slice(0, MAX_TASKS) : []).map(cleanTask).filter(Boolean);
    const incomingNotes = (Array.isArray(body.notes) ? body.notes.slice(0, MAX_NOTES) : []).map(cleanNote).filter(Boolean);
    const out = await sync(env, auth.id, incoming, incomingNotes, cleanSettings(body.settings));
    if (!out) return json(req, { error: 'unknown' }, 404);
    if (out.tooBig) return json(req, { error: 'too_big' }, 413);
    return json(req, { tasks: out.tasks, notes: out.notes, settings: out.settings, serverTime: Date.now() });
  }

  return json(req, { error: 'not found' }, 404);
}

export default {
  async fetch(req, env) {
    try { return await handle(req, env); }
    catch (e) {
      if (e && e.tooBig) return json(req, { error: 'too_big' }, 413);
      return json(req, { error: 'server', detail: String(e && e.message || e) }, 500);
    }
  },
};
