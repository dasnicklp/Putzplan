// Rezepte: Mengen erkennen und umrechnen, anlegen, Portionen, auf die Liste (zusammengefasst), Import-Formate, Import, Export
const fs = require('fs');
module.exports = async ({ browser, ok, settle, phone, newHousehold, join, stored, api, BASE, sleep }) => {
  const a = await phone(browser, { acceptDownloads: true });
  const code = await newHousehold(a);

  const parsed = await a.evaluate(() => ['2 EL Olivenöl', '1 Prise Salz', '2 Zehen Knoblauch', '½ Bund Petersilie', '1 Lauch', '2-3 Kartoffeln', '1 Pck. Vanillezucker']
    .map((x) => { const r = splitQty(x); return r.qty + '|' + r.name; }).join(' / '));
  ok(parsed === '2 EL|Olivenöl / 1 Prise|Salz / 2 Zehen|Knoblauch / ½ Bund|Petersilie / 1|Lauch / 2-3|Kartoffeln / 1 Pck.|Vanillezucker', 'Mengen erkannt');
  const calc = await a.evaluate(() => JSON.stringify({
    scale: [['500 ml Milch', 2], ['250 g Mehl', 4], ['½ Bund Petersilie', 2], ['2-3 Kartoffeln', 2], ['Salz', 3]].map(([l, f]) => scaleLine(l, f)),
    add: [['1 l', '1000 ml'], ['500 g', '1 kg'], ['6', '2'], ['1 l', '2 Becher']].map(([x, y]) => addQty(x, y)),
  }));
  ok(calc === JSON.stringify({ scale: ['1 l Milch', '1 kg Mehl', '1 Bund Petersilie', '4-6 Kartoffeln', 'Salz'], add: ['2 l', '1,5 kg', '8', '1 l + 2 Becher'] }), 'Umrechnen und Zusammenfassen: ' + calc);

  await a.click('[data-tab=shop]');
  await a.fill('#shopInput', '1 l Milch'); await a.press('#shopInput', 'Enter');
  await a.click('[data-sview=recipes]');
  ok(await a.textContent('#pageTitle') === 'Rezepte' && await a.isVisible('#fab'), 'Rezepte: Titel und +');
  await a.click('[data-example-recipe]');
  await a.click('#fab'); await sleep(120);
  await a.fill('#rTitle', 'Pfannkuchen'); await a.fill('#rServ', '2');
  await a.fill('#rIngr', '250 g Mehl\n500 ml Milch\n3 Eier\n1 Prise Salz\n- Butter');
  await a.fill('#rSteps', 'Verrühren, ausbacken.');
  await a.fill('#rLink', 'https://example.com/p');
  await a.click('#recipeForm button[type=submit]');
  ok((await a.locator('[data-recipe] .ttl').allTextContents()).join('|') === 'Pfannkuchen|Spaghetti Bolognese', 'Rezepte alphabetisch');

  // Ansehen: Vorauswahl, Portionen, auf die Liste
  await a.click('[data-recipe] >> nth=0');
  const pressed = await a.$$eval('#rvIngr .pack-row', (bs) => bs.map((b) => b.getAttribute('aria-pressed')).join(','));
  ok(pressed === 'true,false,true,false,true', 'Salz und Gelistetes (Milch) abgewählt');
  await a.click('#rvMore'); await a.click('#rvMore');
  ok((await a.textContent('#rvIngr')).includes('6 Eier') && (await a.textContent('#rvIngr')).includes('1 l Milch'), 'Für 4 Portionen umgerechnet');
  await a.click('[data-ing="1"]');
  await a.click('#rvAdd');
  const by = Object.fromEntries((await stored(a, 'shop')).map((i) => [i.name, i]));
  ok(by.Mehl.qty === '500 g' && by.Mehl.from === 'Pfannkuchen' && by.Eier.qty === '6' && !by.Salz, 'Zutaten auf der Liste, mit Rezeptname');
  ok(by.Milch.qty === '2 l', 'Milch zusammengerechnet: ' + by.Milch.qty);
  ok(await a.getAttribute('[data-sview=list]', 'aria-pressed') === 'true' && (await a.textContent('#view')).includes('für Pfannkuchen'), 'Danach die Liste mit „für Pfannkuchen“');

  // Import-Formate
  const formats = {
    german: '{"rezepte":[{"titel":"Rührei","portionen":"2 Personen","zutaten":[{"menge":4,"name":"Eier"},{"menge":20,"einheit":"g","name":"Butter"}],"zubereitung":["Verquirlen","Stocken lassen"]}]}',
    schema: JSON.stringify({ '@graph': [{ '@type': 'WebPage', name: 'x' }, { '@type': 'Recipe', name: 'Suppe &amp; Brot', recipeYield: ['4'], recipeIngredient: ['200 g Linsen'], recipeInstructions: [{ '@type': 'HowToStep', text: '<p>Kochen.</p>' }] }] }),
    chat: 'Hier:\n```json\n{"title":"Salat","ingredients":"1 Gurke\\n2 Tomaten"}\n```',
    broken: '{"title": "x" "servings": 2}',
  };
  const res = await a.evaluate((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => { try { return [k, parseRecipeImport(v)]; } catch (e) { return [k, 'ERR']; } })), formats);
  ok(res.german[0].ingredients === '4 Eier\n20 g Butter' && res.german[0].steps === '1. Verquirlen\n2. Stocken lassen' && res.german[0].servings === 2, 'Import: deutsche Felder');
  ok(res.schema[0].title === 'Suppe & Brot' && res.schema[0].servings === 4 && res.schema[0].steps === '1. Kochen.', 'Import: schema.org');
  ok(res.chat[0].title === 'Salat', 'Import: JSON aus einem Chat');
  ok(res.broken === 'ERR', 'Import: kaputtes JSON gibt einen Fehler');

  // Import-Fenster, Ersetzen, Export
  await a.click('[data-sview=recipes]');
  await a.click('[data-recipe-import]');
  await a.fill('#impText', JSON.stringify([{ title: 'pfannkuchen', servings: 4, ingredients: ['500 g Mehl'] }, { title: 'Toast' }]));
  await sleep(400);
  ok((await a.textContent('#impPreview')).includes('ersetzt das vorhandene') && (await a.textContent('#impGo')) === '2 importieren', 'Vorschau warnt vor Ersetzen');
  await a.click('#impGo');
  const recs = await stored(a, 'recipes');
  ok(recs.length === 3 && recs.find((r) => r.title === 'pfannkuchen').servings === 4, 'Importiert, gleicher Name ersetzt');
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('[data-recipe-export]')]);
  const exp = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(exp.recipes.length === 3 && await a.evaluate((t) => parseRecipeImport(t).length, JSON.stringify(exp)) === 3, 'Export lässt sich wieder importieren');

  // Zweites Gerät, ältere App-Version
  await settle(a);
  const b = await phone(browser);
  await join(b, code);
  ok((await stored(b, 'recipes')).length === 3, 'Zweites Gerät hat die Rezepte');
  const r = await api('/api/sync', { tasks: [], shop: [] }, code);
  ok(r.data.recipes.filter((x) => !x.deleted).length === 3, 'Ältere App ohne Rezepte löscht nichts');
  await a.goto(BASE + '?text=' + encodeURIComponent(formats.schema));
  await a.waitForSelector('#app:not([hidden])'); await sleep(200);
  ok(!(await a.isHidden('#importSheet')), 'Geteiltes JSON öffnet den Import');
};
