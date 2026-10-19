// Vorrat: eintragen, knapp/leer setzt auf die Liste, Kaufen füllt auf, Rezepte wählen Vorhandenes ab; Laden-Reihenfolge; Kurzbefehle
module.exports = async ({ browser, ok, phone, newHousehold, stored, settle, BASE, sleep }) => {
  const a = await phone(browser);
  await newHousehold(a);
  await a.click('[data-tab=shop]');
  ok((await a.locator('[data-sview]').allTextContents()).join('|') === 'Liste|Vorrat|Rezepte|Essen', 'Einkauf: Liste, Vorrat, Rezepte, Essen');
  await a.click('[data-sview=pantry]');
  ok(await a.textContent('#pageTitle') === 'Vorrat' && (await a.getAttribute('#shopInput', 'placeholder')).includes('Was habt ihr da'), 'Vorrat: eigene Eingabezeile');
  await a.fill('#shopInput', 'Spülmittel, Kaffee, Nudeln, Olivenöl'); await a.press('#shopInput', 'Enter');
  let pan = await stored(a, 'pantry');
  ok(pan.length === 4 && pan.every((p) => p.status === 'ok') && pan.find((p) => p.name === 'Kaffee').cat === 'Vorrat', 'Vier Sachen im Vorrat, Bereiche erkannt');
  await a.fill('#shopInput', 'kaffee'); await a.press('#shopInput', 'Enter');
  ok((await stored(a, 'pantry')).length === 4, 'Doppelt wird nicht angelegt');

  // Snacks süß und salzig
  await a.fill('#shopInput', 'Gummibärchen, Zartbitterschokolade, Salzstangen, Erdnüsse'); await a.press('#shopInput', 'Enter');
  pan = await stored(a, 'pantry');
  const catOf = (n) => pan.find((p) => p.name === n).cat;
  ok(catOf('Gummibärchen') === 'Snacks süß' && catOf('Zartbitterschokolade') === 'Snacks süß' && catOf('Salzstangen') === 'Snacks salzig' && catOf('Erdnüsse') === 'Snacks salzig', 'Snacks süß und salzig erkannt');
  const pheads = (await a.locator('#view h2').allTextContents()).join('|');
  ok(pheads.includes('🥫 Vorrat|🍫 Snacks süß|🥨 Snacks salzig'), 'Vorrat: Snacks als eigene Bereiche hinter Vorrat');
  // Bis 3.4 lagen Chips & Co. unter „Vorrat“: einmal umsortieren, danach bleibt eine Änderung von Hand
  await a.evaluate(() => { const now = Date.now(); localStorage.removeItem('putzplan.snacks'); shop.push({ id: 's-chips', name: 'Chips', qty: '', from: '', cat: 'Vorrat', done: false, doneAt: null, createdAt: now, updatedAt: now, deleted: false }); save(); });
  await settle(a);
  ok((await stored(a, 'shop')).find((i) => i.id === 's-chips').cat === 'Snacks salzig', 'Alte Chips unter „Vorrat“ umsortiert');
  await a.evaluate(() => { const i = shop.find((x) => x.id === 's-chips'); i.cat = 'Vorrat'; touch(i); save(); });
  await settle(a);
  ok((await stored(a, 'shop')).find((i) => i.id === 's-chips').cat === 'Vorrat', 'Nur einmal: von Hand zurückgestellt bleibt es');
  await a.evaluate(() => { const c = shop.find((x) => x.id === 's-chips'); c.deleted = true; touch(c); for (const p of pantry) if (/^(Gummi|Zart|Salz|Erd)/.test(p.name)) { p.deleted = true; touch(p); } save(); });

  // Leer -> auf die Liste
  const kaffee = pan.find((p) => p.name === 'Kaffee');
  await a.click(`[data-pst="${kaffee.id}"][data-st="out"]`);
  let shop = await stored(a, 'shop');
  ok(shop.some((i) => i.name === 'Kaffee' && i.from === 'Vorrat' && !i.done), '„Leer“ setzt Kaffee auf die Liste');
  ok((await a.textContent('#toast')).includes('Einkaufsliste'), 'Hinweis');
  await a.click(`[data-pst="${kaffee.id}"][data-st="low"]`);
  ok((await stored(a, 'shop')).filter((i) => i.name === 'Kaffee').length === 1, 'Nicht doppelt auf der Liste');

  // Gekauft -> wieder da
  await a.click('[data-sview=list]');
  const item = (await stored(a, 'shop')).find((i) => i.name === 'Kaffee');
  await a.click(`[data-shop-toggle="${item.id}"]`);
  ok((await stored(a, 'pantry')).find((p) => p.name === 'Kaffee').status === 'ok', 'Abgehakt: im Vorrat wieder „Da“');

  // Rezept: Vorhandenes abgewählt
  await a.evaluate(() => { const now = Date.now(); recipes.push({ id: 'r1', title: 'Pasta', servings: 2, ingredients: '250 g Nudeln\n2 EL Olivenöl\n1 Zucchini', steps: '', link: '', createdAt: now, updatedAt: now, deleted: false }); save(); });
  await a.click('[data-sview=recipes]');
  await a.click('[data-recipe="r1"]');
  const pressed = await a.$$eval('#rvIngr .pack-row', (bs) => bs.map((b) => b.getAttribute('aria-pressed')).join(','));
  ok(pressed === 'false,false,true' && (await a.textContent('#rvIngr')).includes('im Vorrat'), 'Rezept: Nudeln und Öl im Vorrat, nur Zucchini gewählt');
  await a.click('#rvClose');

  // Laden-Reihenfolge
  await a.click('[data-tab=settings]');
  const first = async () => (await a.locator('#orderList .order-row span').first().textContent()).trim();
  ok((await first()).includes('Obst & Gemüse'), 'Reihenfolge: zuerst Obst & Gemüse');
  ok((await a.locator('#orderList .order-row span').allTextContents()).length === 11, 'Elf Bereiche, mit den Snacks');
  await a.click('#orderList [data-ord="2"][data-dir="-1"]'); await a.click('#orderList [data-ord="1"][data-dir="-1"]');
  ok((await first()).includes('Kühlregal'), 'Kühlregal nach oben geschoben');
  await a.click('[data-tab=shop]'); await a.click('[data-sview=list]');
  await a.fill('#shopInput', 'Bananen, Milch'); await a.press('#shopInput', 'Enter');
  const heads = await a.locator('#view h2').allTextContents();
  ok(heads[0].includes('Kühlregal') && heads[1].includes('Obst'), 'Liste in eurer Reihenfolge: ' + heads.slice(0, 2).join(', '));
  // Gespeicherte Reihenfolge von vor 3.5 (ohne Snacks): die kommen hinter „Vorrat“, nicht ans Ende
  const ord = await a.evaluate(() => { settings.shopOrder = ['Getränke', 'Vorrat', 'Obst & Gemüse', 'Brot & Backwaren', 'Kühlregal', 'Tiefkühl', 'Drogerie', 'Haushalt', 'Sonstiges']; return shopOrder(); });
  ok(ord.slice(0, 4).join('|') === 'Getränke|Vorrat|Snacks süß|Snacks salzig' && ord.length === 11, 'Alte Reihenfolge: Snacks hinter Vorrat');

  // Kurzbefehle (App-Symbol)
  await a.click('[data-tab=clean]');
  await a.goto(BASE + '?go=list'); await a.waitForSelector('#app:not([hidden])'); await sleep(150);
  ok(await a.getAttribute('[data-tab=shop]', 'aria-current') === 'page' && await a.getAttribute('[data-sview=list]', 'aria-pressed') === 'true' && !a.url().includes('go='), 'Kurzbefehl „Einkaufsliste“');
  await a.goto(BASE + '?go=task'); await a.waitForSelector('#app:not([hidden])'); await sleep(150);
  ok(!(await a.isHidden('#taskSheet')), 'Kurzbefehl „Neue Aufgabe“');
  await a.click('#btnCancel');
  await a.goto(BASE + '?go=board'); await a.waitForSelector('#app:not([hidden])'); await sleep(150);
  ok(await a.getAttribute('[data-tab=home]', 'aria-current') === 'page' && await a.isVisible('#boardBox'), 'Kurzbefehl „Pinnwand“');
  const man = await (await fetch(new URL('/manifest.webmanifest', BASE))).json();
  ok(man.shortcuts.length === 4 && man.name === 'Haushalt', 'Manifest mit vier Kurzbefehlen');
};
