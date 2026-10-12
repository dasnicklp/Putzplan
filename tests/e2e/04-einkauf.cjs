// Einkaufsliste: schnell eintragen, Mengen, Bereiche im Laden, doppelt, abhaken, aufräumen mit Rückgängig,
// Vorschläge, mehrere auf einmal, Teilen (Android), zweites Gerät, ältere App-Version
module.exports = async ({ browser, ok, settle, phone, newHousehold, join, stored, api, BASE, sleep }) => {
  const a = await phone(browser);
  const code = await newHousehold(a);
  await a.click('[data-tab=shop]');
  ok(await a.isVisible('#shopInput') && !(await a.isVisible('#fab')), 'Liste: Eingabefeld, kein +');
  for (const x of ['2 Milch', 'Orangensaft', 'Bananen', 'Klopapier', 'Reis', '500 g Mehl', 'Zahnpasta', 'Kerzen', 'Tiefkühlpizza']) {
    await a.fill('#shopInput', x); await a.press('#shopInput', 'Enter');
  }
  ok(await a.evaluate(() => document.activeElement.id) === 'shopInput', 'Fokus bleibt im Feld');
  const cat = Object.fromEntries((await stored(a, 'shop')).map((i) => [i.name, i.cat + (i.qty ? ' / ' + i.qty : '')]));
  ok(cat.Milch === 'Kühlregal / 2' && cat.Orangensaft === 'Getränke' && cat.Reis === 'Vorrat' && cat.Mehl === 'Vorrat / 500 g' && cat.Zahnpasta === 'Drogerie'
    && cat.Kerzen === 'Sonstiges' && cat.Tiefkühlpizza === 'Tiefkühl' && cat.Bananen === 'Obst & Gemüse' && cat.Klopapier === 'Haushalt', 'Bereiche und Mengen erkannt');
  ok(await a.textContent('#shopBadge') === '9', 'Zahl am Reiter');
  await a.fill('#shopInput', 'milch'); await a.press('#shopInput', 'Enter');
  ok((await a.textContent('#toast')).includes('steht schon drauf'), 'Doppelt erkannt');

  // Abhaken und aufräumen
  const items = await stored(a, 'shop');
  const idOf = (n) => items.find((i) => i.name === n).id;
  await a.click(`[data-shop-toggle="${idOf('Milch')}"]`);
  await a.click(`[data-shop-toggle="${idOf('Reis')}"]`);
  ok((await a.textContent('#view')).includes('Im Wagen · 2') && await a.textContent('#shopBadge') === '7', 'Abgehakt: „Im Wagen“');
  await a.click('[data-shop-clear]');
  ok((await stored(a, 'shop')).length === 7, 'Erledigte entfernt');
  await a.click('#toast button');
  ok((await stored(a, 'shop')).length === 9, 'Rückgängig: wieder da');
  await a.click('[data-shop-clear]');
  const sugg = await a.locator('[data-sugg]').allTextContents();
  ok(sugg.some((s) => s.includes('Milch')) && sugg.some((s) => s.includes('Reis')), 'Vorschläge aus dem Verlauf');
  await a.click('[data-sugg="Reis"]');
  ok((await stored(a, 'shop')).some((i) => i.name === 'Reis' && !i.done), 'Vorschlag setzt wieder auf die Liste');

  // Bearbeiten
  await a.click(`[data-shop-edit="${idOf('Kerzen')}"]`);
  await a.fill('#sQty', '1 Pack'); await a.click('#sCatPick [data-scat="Haushalt"]');
  await a.click('#shopForm button[type=submit]');
  ok((await stored(a, 'shop')).some((i) => i.name === 'Kerzen' && i.cat === 'Haushalt' && i.qty === '1 Pack'), 'Bearbeiten speichert');

  // Mehrere auf einmal, Teilen
  await a.fill('#shopInput', 'Eier, Butter, 1,5 l Apfelsaft'); await a.press('#shopInput', 'Enter');
  ok((await stored(a, 'shop')).some((i) => i.name === 'Apfelsaft' && i.qty === '1,5 l'), 'Komma-Liste („1,5 l“ bleibt ganz)');
  await a.goto(BASE + '?text=' + encodeURIComponent('- Brot\n- Käse'));
  await a.waitForSelector('#app:not([hidden])'); await sleep(200);
  ok((await stored(a, 'shop')).some((i) => i.name === 'Käse') && !a.url().includes('text='), 'Geteilter Text landet auf der Liste');

  // Zweites Gerät und ältere App-Version
  await settle(a);
  const b = await phone(browser);
  await join(b, code);
  ok((await stored(b, 'shop')).some((i) => i.name === 'Kerzen'), 'Zweites Gerät sieht die Liste');
  const before = (await stored(a, 'shop')).length;
  const r = await api('/api/sync', { tasks: [], notes: [] }, code);
  ok(r.data.shop.filter((i) => !i.deleted).length === before, 'Ältere App ohne Einkaufsliste löscht nichts');
};
