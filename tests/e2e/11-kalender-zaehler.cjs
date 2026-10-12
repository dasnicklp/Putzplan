// Version 3.1: Termine, Haltbarkeit im Vorrat, „Was können wir kochen?“, Zähler mit Verbrauch pro Monat,
// WLAN-QR-Code, Kalender-Abo (iCalendar) und „auf die Liste“ per Sprachassistent; zweites Gerät
const jsQR = require('jsqr');

// QR-Matrix wie eine Kamera lesen: Bild mit Ruhezone bauen und dekodieren
function readQr(m) {
  const sc = 4, q = 4, n = (m.length + 2 * q) * sc, px = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const my = Math.floor(y / sc) - q, mx = Math.floor(x / sc) - q;
    const dark = my >= 0 && mx >= 0 && my < m.length && mx < m.length && m[my][mx];
    const i = (y * n + x) * 4; px[i] = px[i + 1] = px[i + 2] = dark ? 0 : 255; px[i + 3] = 255;
  }
  const r = jsQR(px, n, n);
  return r && r.data;
}

module.exports = async ({ browser, ok, settle, phone, newHousehold, join, stored, api, day, sleep }) => {
  const a = await phone(browser);
  const code = await newHousehold(a);
  await a.click('[data-tab=home]');

  // Termine
  await a.click('[data-hview=cal]');
  await a.click('#fab'); await a.click('#pickList [data-pick="0"]'); await sleep(100);
  ok(await a.textContent('#gfTitle') === 'Neuer Termin' && await a.inputValue('#gf_date') === day(0), 'Neuer Termin, heute vorausgewählt');
  await a.fill('#gf_title', 'Zahnarzt'); await a.fill('#gf_date', day(1)); await a.fill('#gf_time', '15:00');
  await a.selectOption('#gf_who', 'nick');
  await a.click('#genForm button[type=submit]');
  await a.click('#fab'); await a.click('#pickList [data-pick="0"]'); await sleep(100);
  await a.fill('#gf_title', 'Sperrmüll'); await a.fill('#gf_date', day(9));
  await a.click('#genForm button[type=submit]');
  const body = await a.textContent('#homeBody');
  ok(body.indexOf('Morgen') < body.indexOf('Zahnarzt') && body.indexOf('Zahnarzt') < body.indexOf('Sperrmüll') && body.includes('15:00'), 'Termine nach Tag sortiert, mit Uhrzeit');
  ok((await stored(a, 'events')).find((e) => e.title === 'Zahnarzt').who === 'nick', 'Für wen gespeichert');
  await a.click('[data-hview=overview]');
  ok((await a.textContent('#homeBody')).includes('📅 Morgen 15:00: Zahnarzt'), 'Demnächst: Termin');
  await a.click('[data-tab=clean]'); await a.click('[data-view=today]');
  ok((await a.textContent('#view')).includes('📅 Morgen 15:00: Zahnarzt'), 'Heute-Ansicht nennt den Termin');

  // Vorrat: Mindesthaltbarkeit
  await a.click('[data-tab=shop]'); await a.click('[data-sview=pantry]');
  await a.fill('#shopInput', 'Joghurt, Nudeln, Zwiebel, Tomaten'); await a.press('#shopInput', 'Enter');
  const jog = (await stored(a, 'pantry')).find((p) => p.name === 'Joghurt');
  await a.click(`[data-pantry="${jog.id}"]`); await sleep(100);
  await a.fill('#gf_best', day(1));
  await a.click('#genForm button[type=submit]');
  ok((await a.textContent('#view')).includes('läuft morgen ab') && (await stored(a, 'pantry')).find((p) => p.name === 'Joghurt').best === day(1), 'Haltbarkeit eingetragen: läuft morgen ab');
  await a.click('[data-tab=home]'); await a.click('[data-hview=overview]');
  ok((await a.textContent('#homeBody')).includes('⏳ Joghurt läuft morgen ab'), 'Demnächst: läuft ab');
  await a.click('#homeBody [data-go="pantry"]');
  ok(await a.textContent('#pageTitle') === 'Vorrat', 'Antippen springt in den Vorrat');
  await a.click(`[data-pst="${jog.id}"][data-st="out"]`);
  await a.click('[data-sview=list]');
  await a.click(`[data-shop-toggle="${(await stored(a, 'shop')).find((i) => i.name === 'Joghurt').id}"]`);
  const j2 = (await stored(a, 'pantry')).find((p) => p.name === 'Joghurt');
  ok(j2.status === 'ok' && j2.best === '', 'Neu gekauft: wieder da, altes Datum gelöscht');

  // Was können wir kochen?
  const tom = (await stored(a, 'pantry')).find((p) => p.name === 'Tomaten');
  await a.click('[data-sview=pantry]'); await a.click(`[data-pst="${tom.id}"][data-st="low"]`);
  await a.evaluate(() => {
    const now = Date.now(), r = (id, title, ingredients) => ({ id, title, servings: 2, ingredients, steps: '', link: '', createdAt: now, updatedAt: now, deleted: false });
    recipes.push(r('r1', 'Tomatensoße', '500 g Nudeln\n3 Tomaten\n1 Zwiebeln (gewürfelt)\nSalz'), r('r2', 'Pfannkuchen', '250 g Mehl\n500 ml Milch'), r('r3', 'Zwiebelkuchen', '4 Zwiebeln, in Ringen\n100 g Speck'));
    save();
  });
  await a.click('[data-sview=recipes]');
  await a.click('[data-cook]');
  const cards = await a.locator('[data-recipe]').allTextContents();
  ok(cards.length === 2 && cards[0].includes('Tomatensoße') && cards[0].includes('alles da') && cards[1].includes('1 von 2 da') && cards[1].includes('Fehlt: Speck'),
    'Kochen: Tomatensoße (alles da, Tomaten knapp zählt), Zwiebelkuchen (fehlt Speck), Pfannkuchen nicht');
  await a.click('[data-cook]');
  ok((await a.locator('[data-recipe]').count()) === 3, 'Zurück zu allen Rezepten');

  // Zähler
  await a.click('[data-tab=home]'); await a.click('[data-hview=devices]');
  ok(await a.textContent('#pageTitle') === 'Geräte & Zähler', 'Titel: Geräte & Zähler');
  await a.click('#fab'); await a.click('#pickList [data-pick="1"]'); await sleep(100);
  await a.fill('#gf_name', 'Strom'); await a.fill('#gf_number', '1ESY123');
  await a.click('#genForm button[type=submit]');
  const meter = (await stored(a, 'meters'))[0];
  ok(meter && meter.unit === 'kWh' && meter.remind === true, 'Zähler angelegt (kWh, Erinnerung an)');
  await a.click('[data-tab=home]'); await a.click('[data-hview=overview]');
  ok((await a.textContent('#homeBody')).includes('Zählerstand Strom ablesen'), 'Demnächst: noch nie abgelesen');
  await a.click('[data-hview=devices]');
  await a.evaluate((id) => {
    const now = Date.now();
    [['2026-01-01', 1000], ['2026-02-01', 1310], ['2026-03-01', 1590]].forEach(([date, value], i) => readings.push({ id: 'rd' + i, meter: id, date, value, createdAt: now, updatedAt: now, deleted: false }));
    save();
  }, meter.id);
  await a.click(`[data-read="${meter.id}"]`); await sleep(100);
  await a.fill('#gf_value', '2.030,5'); await a.fill('#gf_date', '2026-04-15');
  await a.click('#genForm button[type=submit]');
  const rs = await stored(a, 'readings');
  ok(rs.length === 4 && rs.some((r) => r.value === 2030.5 && r.date === '2026-04-15'), 'Ablesung mit Komma eingetragen: 2030,5');
  const use = await a.evaluate((id) => monthlyUse(meterReadings(id)).map((x) => `${x.m}:${Math.round(x.v)}`).join(' '), meter.id);
  ok(use === '2026-01:310 2026-02:280 2026-03:303', 'Verbrauch pro Monat (nur ganze Monate): ' + use);
  ok(await a.locator('.chart .bar').count() === 3 && (await a.textContent(`#cap-${meter.id}`)).includes('Ø 298 kWh pro Monat (3 Monate)'), 'Diagramm: 3 Säulen, Durchschnitt');
  await a.click('.chart .bar-g >> nth=0');
  ok(await a.textContent(`#cap-${meter.id}`) === 'Januar 2026: 310 kWh', 'Antippen zeigt den Monatswert');
  ok((await a.textContent('.meter-now')).includes('2.030,5 kWh'), 'Letzter Stand angezeigt');
  await a.click('.meter details summary');
  await a.click('[data-read-del="rd0"]');
  ok((await stored(a, 'readings')).length === 3 && await a.locator('.meter details[open]').count() === 1, 'Ablesung gelöscht, Liste bleibt offen');
  await a.click('#toast button');

  // WLAN für Gäste
  await a.click('[data-hview=overview]');
  await a.click('[data-wifi]'); await sleep(100);
  await a.fill('#gf_ssid', 'Unser;WLAN'); await a.fill('#gf_pass', 'ge:heim"1');
  await a.click('#genForm button[type=submit]');
  await a.waitForSelector('#wifiSheet:not([hidden])');
  ok(await a.locator('#wifiQr svg').count() === 1 && (await a.textContent('#wifiInfo')).includes('ge:heim"1'), 'QR-Code und Passwort angezeigt');
  const matrix = await a.evaluate(() => qrMatrix(wifiText(settings.wifi)));
  const read = readQr(matrix);
  ok(read === 'WIFI:T:WPA;S:Unser\\;WLAN;P:ge\\:heim\\"1;;', 'QR-Code lesbar: ' + read);
  await a.click('#wifiClose');

  // Kalender-Abo
  await a.click('[data-tab=settings]');
  await a.waitForSelector('#calLinks [data-copy]');
  const calUrl = await a.getAttribute('#calLinks [data-copy]', 'data-copy');
  ok(/\/api\/cal\/[\w-]{24}\.ics$/.test(calUrl) && (await a.getAttribute('#calLinks a.primary', 'href')).startsWith('webcal://'), 'Kalender-Link (webcal)');
  await a.evaluate(() => { const now = Date.now(); bdays.push({ id: 'b1', name: 'Mama', month: 3, day: 14, year: 1966, remind: 7, note: '', createdAt: now, updatedAt: now, deleted: false }); save(); });
  await settle(a);
  let ics = await (await fetch(calUrl)).text();
  const zahn = ics.split('BEGIN:VEVENT').find((e) => e.includes('Zahnarzt')) || '';
  ok(ics.startsWith('BEGIN:VCALENDAR') && zahn.includes(`DTSTART:${day(1).replace(/-/g, '')}T150000`) && zahn.includes('SUMMARY:📅 Zahnarzt (Nick)'), 'Termin im Kalender, 15 Uhr');
  ok(/DTSTART;VALUE=DATE:19660314[\s\S]*RRULE:FREQ=YEARLY[\s\S]*SUMMARY:🎂 Mama/.test(ics), 'Geburtstag jährlich');
  ok(!ics.includes('🧽') && ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'Ohne Putzaufgaben; Zeilen höchstens 75 Bytes');
  await a.evaluate(() => { const now = Date.now(); tasks.push({ id: 't1', title: 'Bad putzen', due: keyOf(new Date()), category: 'Bad', minutes: 20, assignee: 'partner', repeat: 'none', done: false, doneAt: null, createdAt: now, updatedAt: now, deleted: false }); save(); });
  await settle(a);
  await a.click('#cTasks');
  await a.waitForFunction(() => document.querySelector('#calLinks [data-copy]') && document.querySelector('#calLinks [data-copy]').dataset.copy.endsWith('?t=1'));
  ics = await (await fetch(await a.getAttribute('#calLinks [data-copy]', 'data-copy'))).text();
  ok(ics.includes('SUMMARY:🧽 Bad putzen (Freundin)'), 'Mit Putzaufgaben');
  ok((await fetch(calUrl.replace(/\/cal\/[\w-]+/, '/cal/AAAAAAAAAAAAAAAAAAAAAAAA'))).status === 404, 'Falscher Link: nichts');

  // Sprachassistent
  await a.selectOption('#pWho', 'nick');
  await a.waitForFunction(() => document.querySelector('#voiceLinks [data-copy]') && document.querySelector('#voiceLinks [data-copy]').dataset.copy.endsWith('?w=nick'));
  const addUrl = await a.getAttribute('#voiceLinks [data-copy]', 'data-copy');
  const form = new FormData(); form.append('t', '2 Liter Milch und Eier');
  let r = await fetch(addUrl, { method: 'POST', body: form });
  ok(r.status === 200 && (await r.text()) === '2 Liter Milch und Eier stehen jetzt auf der Einkaufsliste.', 'Kurzbefehl (Formular): Antwort zum Vorlesen');
  r = await fetch(addUrl + '&t=eier');
  ok((await r.text()) === 'Eier stand schon drauf.', 'Doppelt: steht schon drauf');
  await settle(a); await settle(a);
  const shop = await stored(a, 'shop');
  const milk = shop.find((i) => i.name === 'Milch' && !i.done);
  ok(milk && milk.qty === '2 Liter' && milk.cat === 'Kühlregal' && shop.find((i) => i.name === 'Eier').cat !== '', 'App ergänzt Menge und Bereich: ' + (milk ? `${milk.qty} / ${milk.cat}` : '—'));
  r = await fetch(addUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: 'Kaffee' }) });
  ok((await r.text()).startsWith('Kaffee steht'), 'Auch als JSON');
  ok((await fetch(addUrl.replace(/\/add\/[\w-]+/, '/add/AAAAAAAAAAAAAAAAAAAAAAAA'))).status === 404, 'Falscher Link: abgelehnt');
  await a.click('#voiceLinks #addReset');
  await a.waitForFunction((old) => document.querySelector('#voiceLinks [data-copy]') && document.querySelector('#voiceLinks [data-copy]').dataset.copy !== old, addUrl);
  ok((await fetch(addUrl + '&t=Brot')).status === 404, 'Neuer Link: der alte geht nicht mehr');

  // Zweites Gerät, ältere App
  await settle(a);
  const b = await phone(browser);
  await join(b, code);
  ok((await stored(b, 'events')).length === 2 && (await stored(b, 'meters')).length === 1 && (await stored(b, 'readings')).length === 4
    && (await b.evaluate(() => settings.wifi.ssid)) === 'Unser;WLAN', 'Alles auch auf dem anderen Gerät (inkl. WLAN)');
  const old = await api('/api/sync', { tasks: [], shop: [] }, code);
  ok(old.data.events.length === 2 && old.data.readings.length === 4, 'Ältere App ohne diese Bereiche löscht nichts');
};
