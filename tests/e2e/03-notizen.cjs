// Notizen: anlegen, Kategorien (auch neue, gleiche Schreibweise), Filter, anheften, löschen mit Rückgängig
module.exports = async ({ browser, ok, phone, newHousehold, stored, sleep }) => {
  const a = await phone(browser);
  await newHousehold(a);
  await a.click('[data-tab=notes]');
  ok(await a.getAttribute('#fab', 'aria-label') === 'Neue Notiz', 'Notizen: + legt eine Notiz an');
  const add = async (title, body, cat, opts = {}) => {
    await a.click('#fab'); await sleep(120);
    await a.fill('#nTitle', title); await a.fill('#nBody', body);
    if (cat && opts.newCat) { await a.click('[data-pcat="__new"]'); await a.fill('#nCatNew', cat); await a.press('#nCatNew', 'Enter'); }
    else if (cat) await a.click(`#nCatPick [data-pcat="${cat}"]`);
    if (opts.pin) await a.click('#nPin');
    await a.click('#noteForm button[type=submit]'); await sleep(150);
  };
  await add('Kalk im Bad', 'Zitronensäure', 'Putztipps');
  await add('Garten', 'Rasen mähen', 'Draußen', { newCat: true });
  await add('WLAN', 'Passwort am Router', '', { pin: true });
  await add('Backofen', 'Natron', 'putztipps', { newCat: true }); // andere Schreibweise
  const order = (await a.locator('.note .ttl').allTextContents()).map((t) => t.trim());
  ok(order[0] === '📌 WLAN', 'Angeheftete Notiz steht oben');
  const filters = await a.locator('[data-ncat]').allTextContents();
  ok(filters.join('|') === 'Alle|Draußen|Putztipps|Ohne Kategorie', 'Kategorien zusammengeführt: ' + filters.join(', '));
  await a.click('[data-ncat="Putztipps"]');
  ok((await a.locator('.note').count()) === 2, 'Filter zeigt nur Putztipps');
  await a.click('[data-ncat="*"]');

  // Löschen und Rückgängig
  const id = (await stored(a, 'notes')).find((n) => n.title === 'Garten').id;
  await a.click(`[data-note="${id}"]`);
  await a.click('#nDelete');
  ok(!(await stored(a, 'notes')).some((n) => n.id === id), 'Gelöscht, ohne Rückfrage');
  await a.click('#toast button');
  ok((await stored(a, 'notes')).some((n) => n.id === id && n.title === 'Garten'), '„Rückgängig“ holt die Notiz zurück');
};
