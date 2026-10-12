// Kassenbon scannen: Foto → Server (in den Tests ein festes Beispiel statt KI) → prüfen → Vorrat und Einkaufsliste
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async ({ browser, ok, phone, newHousehold, stored, api }) => {
  const a = await phone(browser);
  const code = await newHousehold(a);

  // Ein Foto wie vom Handy (großes Bild, die App verkleinert es vor dem Senden)
  const png = await a.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 3000;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000'; g.font = '48px monospace';
    ['TESTMARKT', 'BIO VOLLM 3,5%  2x 1,19', 'BANANEN LOSE   1,49', 'SPUELM ZITR    0,95', 'PFAND          0,25', 'SUMME          5,07'].forEach((t, i) => g.fillText(t, 60, 120 + i * 80));
    return c.toDataURL('image/png').split(',')[1];
  });
  const file = path.join(os.tmpdir(), `bon-${Date.now()}.png`);
  fs.writeFileSync(file, Buffer.from(png, 'base64'));

  // Vorher: Kaffee im Vorrat leer (steht auf der Liste), Bananen und Brot auf der Liste
  await a.click('[data-tab=shop]');
  await a.fill('#shopInput', 'Bananen, Brot'); await a.press('#shopInput', 'Enter');
  await a.click('[data-sview=pantry]');
  await a.fill('#shopInput', 'Kaffee'); await a.press('#shopInput', 'Enter');
  const kaffee = (await stored(a, 'pantry'))[0];
  await a.click(`[data-pst="${kaffee.id}"][data-st="out"]`);
  ok(await a.isVisible('[data-scan]'), 'Vorrat: Knopf „Kassenbon scannen“');

  // Bild wählen: Fenster mit den erkannten Artikeln
  let sent = null;
  a.on('request', (r) => { if (r.url().endsWith('/api/receipt')) sent = r.postData(); });
  await a.setInputFiles('#receiptFile', file);
  await a.waitForSelector('#rcList [data-rc]');
  const img = sent && JSON.parse(sent).image;
  ok(img && img.startsWith('data:image/jpeg;base64,') && img.length < 900000, `Foto verkleinert gesendet (${Math.round((img || '').length / 1024)} KB)`);
  const rows = await a.locator('#rcList [data-rc]').allTextContents();
  ok(rows.length === 4 && !rows.some((r) => /Pfand|Summe/.test(r)), 'Erkannt: 4 Artikel, ohne Pfand, Summe und Doppeltes');
  const row = (n) => rows.find((r) => r.includes(n)) || '';
  ok(row('Vollmilch').includes('× 2') && row('Vollmilch').includes('neu im Vorrat · Kühlregal'), 'Vollmilch × 2, neu, Bereich erkannt');
  ok(row('Kaffee').includes('wird wieder „Da“') && row('Bananen').includes('auf der Liste abgehakt'), 'Kaffee wird aufgefüllt, Bananen auf der Liste abgehakt');
  await a.click('#rcList [data-rc="2"]'); // Spülmittel abwählen
  ok(await a.textContent('#rcAdd') === '3 Sachen in den Vorrat', 'Abwählen');
  await a.click('#rcAdd');

  const pan = await stored(a, 'pantry'), shop = await stored(a, 'shop');
  ok(pan.length === 3 && pan.find((p) => p.name === 'Kaffee').status === 'ok' && pan.some((p) => p.name === 'Vollmilch') && !pan.some((p) => p.name === 'Spülmittel'), 'Vorrat: Vollmilch und Bananen neu, Kaffee wieder da, Spülmittel nicht');
  ok(shop.find((i) => i.name === 'Bananen').done && shop.find((i) => i.name === 'Kaffee').done && !shop.find((i) => i.name === 'Brot').done, 'Liste: Bananen und Kaffee abgehakt, Brot nicht');
  ok((await a.textContent('#toast')).includes('2 neu im Vorrat') && (await a.textContent('#toast')).includes('1 aufgefüllt'), 'Hinweis: ' + await a.textContent('#toast'));

  // Server: falsches Bild abgelehnt, Tageslimit
  ok((await api('/api/receipt', { image: 'kein Bild' }, code)).status === 400, 'Kein Bild: abgelehnt');
  const tiny = 'data:image/png;base64,' + 'A'.repeat(200);
  let last = 0;
  for (let i = 0; i < 25; i++) last = (await api('/api/receipt', { image: tiny }, code)).status;
  ok(last === 429, 'Tageslimit pro Haushalt');
  ok((await api('/api/receipt', { image: tiny }, '000000')).status === 401, 'Ohne gültigen Code: abgelehnt');
  fs.unlinkSync(file);
};
