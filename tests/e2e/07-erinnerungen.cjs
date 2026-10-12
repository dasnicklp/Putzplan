// Erinnerungen (Web Push): ein nachgebauter Push-Dienst nimmt die Nachrichten an, prüft die VAPID-Signatur und entschlüsselt sie (RFC 8291).
// Braucht den Worker mit --test-scheduled und --var ALLOW_LOCAL_PUSH:1.
const http = require('http');
const { webcrypto: wc } = require('crypto');
const enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString('base64url');
const ub = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const hkdf = async (salt, ikm, info, len) => new Uint8Array(await wc.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info },
  await wc.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8));

module.exports = async ({ browser, ok, phone, newHousehold, api, BASE, day, sleep }) => {
  // Gerät mit Schlüsselpaar wie ein Browser
  const kp = await wc.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await wc.subtle.exportKey('raw', kp.publicKey));
  const auth = wc.getRandomValues(new Uint8Array(16));
  const got = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = new Uint8Array(Buffer.concat(chunks));
    try {
      const m = /^vapid t=([^,]+), k=(.+)$/.exec(req.headers.authorization);
      const [h, p, sig] = m[1].split('.');
      const vkey = await wc.subtle.importKey('raw', ub(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const valid = await wc.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vkey, ub(sig), enc.encode(h + '.' + p));
      const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
      const asKey = await wc.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(await wc.subtle.deriveBits({ name: 'ECDH', public: asKey }, kp.privateKey, 256));
      const ikm = await hkdf(auth, shared, Buffer.concat([enc.encode('WebPush: info\0'), uaPub, asPub]), 32);
      const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
      const pt = new Uint8Array(await wc.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await wc.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
      got.push({ url: req.url, valid, claims: JSON.parse(Buffer.from(p, 'base64url')), encoding: req.headers['content-encoding'], data: JSON.parse(Buffer.from(pt.slice(0, pt.lastIndexOf(2))).toString()) });
      res.writeHead(201); res.end();
    } catch (e) { got.push({ url: req.url, error: String(e) }); res.writeHead(400); res.end(); }
  });
  await new Promise((r) => server.listen(9999, '127.0.0.1', r));
  try {
    const { data: { code } } = await api('/api/household', {});
    const now = Date.now();
    const t = (id, title, due, assignee, done = false) => ({ id, title, due, category: 'Bad', minutes: 10, assignee, repeat: 'none', done, doneAt: done ? now : null, createdAt: now, updatedAt: now, deleted: false });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    await api('/api/sync', { tasks: [t('a', 'Bad putzen', today, 'nick'), t('b', 'Müll', '2020-01-01', null), t('c', 'Fenster', today, 'partner'), t('d', 'Fertig', today, 'nick', true)] }, code);
    const { data: { publicKey } } = await api('/api/push/key');
    ok(ub(publicKey).length === 65, 'Öffentlicher Server-Schlüssel');
    const sub = { endpoint: 'http://127.0.0.1:9999/push/a', keys: { p256dh: b64u(uaPub), auth: b64u(auth) } };
    ok((await api('/api/push/subscribe', { subscription: { ...sub, endpoint: 'https://evil.example.com/x' }, time: '08:00' }, code)).status === 400, 'Fremde Push-Adresse abgelehnt');
    const hm = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    ok((await api('/api/push/subscribe', { subscription: sub, person: 'nick', time: hm, tz: 'Europe/Berlin' }, code)).status === 200, 'Gerät angemeldet');
    await api('/api/push/test', { endpoint: sub.endpoint }, code);
    const g = got[0] || {};
    ok(g.valid && g.claims.aud === 'http://127.0.0.1:9999' && g.encoding === 'aes128gcm', 'Signatur gültig, verschlüsselt');
    ok(g.data && g.data.count === 2 && g.data.body.includes('Bad putzen') && g.data.body.includes('Müll') && !g.data.body.includes('Fenster'), 'Inhalt: nur Nick und nicht Zugewiesenes');
    await (await fetch(new URL('/__scheduled?cron=*/15+*+*+*+*', BASE))).text(); await sleep(800);
    ok(got.length === 2, 'Zeitplan schickt die Tageserinnerung');
    await (await fetch(new URL('/__scheduled?cron=*/15+*+*+*+*', BASE))).text(); await sleep(800);
    ok(got.length === 2, 'Kein zweites Mal am selben Tag');
    ok((await api('/api/push/unsubscribe', { endpoint: sub.endpoint }, code)).status === 200
      && (await api('/api/push/test', { endpoint: sub.endpoint }, code)).status === 404, 'Abgemeldet');

    // Oberfläche: Anmeldung im Browser nachgebildet (Headless-Chromium hat keinen echten Push-Dienst)
    const p = await phone(browser);
    await p.context().grantPermissions(['notifications'], { origin: BASE });
    await p.context().addInitScript(() => {
      let fake = null;
      const enc64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      PushManager.prototype.getSubscription = async () => fake;
      PushManager.prototype.subscribe = async (opts) => {
        const k = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
        const json = { endpoint: 'http://127.0.0.1:9999/push/ui', keys: { p256dh: enc64(await crypto.subtle.exportKey('raw', k.publicKey)), auth: enc64(crypto.getRandomValues(new Uint8Array(16))) } };
        fake = { endpoint: json.endpoint, options: opts, toJSON: () => json, unsubscribe: async () => { fake = null; return true; } };
        return fake;
      };
    });
    await newHousehold(p);
    await p.click('[data-tab=home]');
    await p.selectOption('#pWho', 'partner'); await p.selectOption('#pTime', '07:30');
    await p.click('#btnPushOn');
    await p.waitForSelector('#btnPushTest:not([hidden])');
    ok((await p.textContent('#pushInfo')).includes('07:30'), 'Eingeschaltet für 07:30');
    const n = got.length;
    await p.click('#btnPushTest'); await sleep(800);
    ok(got.length === n + 1 && got[n].url === '/push/ui', 'Test-Knopf: Nachricht kommt beim Push-Dienst an');
    await p.click('#btnPushOff'); await sleep(300);
    ok(await p.isVisible('#btnPushOn'), 'Ausgeschaltet');
    await sleep(10);
    void day;
  } finally {
    server.close();
  }
};
