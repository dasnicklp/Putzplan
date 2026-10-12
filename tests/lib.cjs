// Gemeinsame Hilfen für die Tests: Handy-Browser öffnen, Haushalt anlegen, Daten lesen
const BASE = process.env.BASE || 'http://127.0.0.1:8787/';
const PHONE = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const pageErrors = []; // JavaScript-Fehler aller Seiten; run.cjs prüft sie nach jedem Test

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Datum in n Tagen (lokal), z. B. day(0) = heute
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return keyOf(d); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Neues „Handy“ (eigener Browser-Kontext = eigener Speicher)
async function phone(browser, opts = {}) {
  const ctx = await browser.newContext({ ...PHONE, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  return page;
}

// Neuen Haushalt anlegen, gibt den Code zurück
async function newHousehold(page) {
  await page.goto(BASE);
  await page.click('#btnNew');
  await page.waitForSelector('#setupCode:not([hidden])');
  const code = (await page.textContent('#newCode')).replace(/\s/g, '');
  await page.click('#btnNewDone');
  await page.waitForSelector('#app:not([hidden])');
  return code;
}

async function join(page, code) {
  await page.goto(BASE);
  await page.fill('#joinCode', code);
  await page.click('#joinForm button[type=submit]');
  await page.waitForSelector('#app:not([hidden])');
  await page.evaluate(() => sync());
  await sleep(400);
}

// Gespeicherte Liste aus dem Gerät (ohne Gelöschtes)
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem('putzplan.' + k) || '[]').filter((x) => !x.deleted), key);

// Direkter Aufruf der API (wie ein Gerät)
async function api(path, body, code) {
  const r = await fetch(new URL(path, BASE), {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + code, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}

module.exports = { BASE, PHONE, pageErrors, day, keyOf, sleep, phone, newHousehold, join, stored, api };
