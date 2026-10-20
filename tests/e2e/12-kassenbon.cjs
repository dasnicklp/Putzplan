// Kassenbon scannen: Foto oder PDF → Server (in den Tests ein festes Beispiel statt KI) → prüfen → Vorrat und Einkaufsliste
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

  // PDF-Bon mit Text (wie ein eBon aus der Supermarkt-App): die App liest den Text und schickt nur ihn
  const pdfPage = await browser.newPage();
  const pdfOf = async (html) => {
    await pdfPage.setContent(`<body style="margin:8px;font:14px monospace">${html}</body>`);
    const f = path.join(os.tmpdir(), `bon-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(f, await pdfPage.pdf({ width: '80mm', height: '150mm' }));
    return f;
  };
  const textPdf = await pdfOf(['REWE Markt GmbH', 'BIO VOLLM 3,5%      1,19 B', 'BANANEN LOSE        1,49 B', 'SUMME EUR           2,68'].map((t) => `<div>${t}</div>`).join(''));
  const scanFile = async (f) => {
    sent = null;
    await a.setInputFiles('#receiptFile', f);
    await a.waitForFunction(() => document.querySelector('#rcList [data-rc]') || document.querySelector('#rcInfo.bad'), null, { timeout: 15000 });
    return sent && JSON.parse(sent);
  };
  let body = await scanFile(textPdf);
  ok(body && !body.image && /BIO VOLLM 3,5%\s+1,19 B\nBANANEN LOSE/.test(body.text || ''), 'PDF mit Text: Text zeilenweise gesendet, kein Bild');
  ok(await a.locator('#rcList [data-rc]').count() === 4, 'PDF mit Text: Artikel zur Kontrolle');
  await a.click('#rcCancel');

  // Eingescannte PDF (nur ein Bild, kein Text): die App schickt die Seite als Foto
  const scanImg = await a.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 900;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000'; g.font = '32px monospace'; g.fillText('KAFFEE  4,99', 40, 80);
    return c.toDataURL('image/png');
  });
  const imagePdf = await pdfOf(`<img src="${scanImg}" style="width:100%">`);
  body = await scanFile(imagePdf);
  ok(body && !body.text && /^data:image\/jpeg;base64,/.test(body.image || '') && body.image.length < 900000, 'Eingescannte PDF: als Bild gesendet');
  ok(await a.locator('#rcList [data-rc]').count() === 4, 'Eingescannte PDF: Artikel zur Kontrolle');
  await a.click('#rcCancel');

  // Kaputte PDF: verständlicher Hinweis
  const badPdf = path.join(os.tmpdir(), `bon-${Date.now()}-kaputt.pdf`);
  fs.writeFileSync(badPdf, '%PDF-1.4 kaputt');
  await scanFile(badPdf);
  ok((await a.textContent('#rcInfo')).includes('PDF ließ sich nicht öffnen'), 'Kaputte PDF: Hinweis');
  await a.click('#rcCancel');
  [textPdf, imagePdf, badPdf].forEach((f) => fs.unlinkSync(f));

  // Server: falsches Bild oder zu wenig Text abgelehnt, Tageslimit
  ok((await api('/api/receipt', { image: 'kein Bild' }, code)).status === 400, 'Kein Bild: abgelehnt');
  ok((await api('/api/receipt', { text: 'Summe 2,68' }, code)).status === 400, 'Zu wenig Text: abgelehnt');
  const tiny = 'data:image/png;base64,' + 'A'.repeat(200);
  let last = 0;
  for (let i = 0; i < 25; i++) last = (await api('/api/receipt', { image: tiny }, code)).status;
  ok(last === 429, 'Tageslimit pro Haushalt');
  ok((await api('/api/receipt', { image: tiny }, '000000')).status === 401, 'Ohne gültigen Code: abgelehnt');
  fs.unlinkSync(file);
};
