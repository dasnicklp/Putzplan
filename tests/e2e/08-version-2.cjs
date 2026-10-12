// Version 2: Checklisten, Rückgängig, Essensplan mit Wocheneinkauf, Sicherung, Aufräumen alter Aufgaben
const fs = require('fs');
module.exports = async ({ browser, ok, settle, phone, newHousehold, join, stored, api, day, sleep }) => {
  const a = await phone(browser, { acceptDownloads: true });
  const code = await newHousehold(a);

  // Checkliste in einer Aufgabe
  await a.click('#fab'); await sleep(120);
  await a.fill('#fTitle', 'Bad putzen');
  await a.selectOption('#fRepeat', 'w1');
  await a.fill('#fChecklist', 'Spiegel\n- Waschbecken\nFugen');
  await a.click('#taskForm button[type=submit]');
  let t = (await stored(a, 'tasks'))[0];
  ok(t.checklist.length === 3 && t.checklist[1].text === 'Waschbecken' && t.checklist.every((c) => !c.done), 'Checkliste gespeichert');
  ok((await a.locator('.cl-item').count()) === 3 && (await a.textContent('#view')).includes('☑ 0/3'), 'Punkte stehen an der Aufgabe');
  await a.click('.cl-item >> nth=0'); await a.click('.cl-item >> nth=1');
  ok((await a.textContent('#view')).includes('☑ 2/3'), 'Abhaken zählt mit');
  await a.click(`.tbody[data-id="${t.id}"]`);
  await a.fill('#fChecklist', 'Spiegel\nWaschbecken\nFugen\nAbfluss');
  await a.click('#taskForm button[type=submit]');
  t = (await stored(a, 'tasks'))[0];
  ok(t.checklist.length === 4 && t.checklist[0].done && t.checklist[1].done && !t.checklist[3].done, 'Bearbeiten behält die Haken');
  await a.click('.cl-item >> nth=2'); await a.click('.cl-item >> nth=3');
  ok((await a.textContent('#toast button')) === 'Aufgabe erledigen', 'Alles abgehakt: Knopf „Aufgabe erledigen“');
  await a.click('#toast button');
  const after = await stored(a, 'tasks');
  const nxt = after.find((x) => !x.done);
  ok(after.find((x) => x.id === t.id).done && nxt && nxt.checklist.length === 4 && nxt.checklist.every((c) => !c.done), 'Erledigt; nächster Termin mit leerer Checkliste');

  // Löschen mit Rückgängig
  await a.evaluate((id) => openSheet(id), nxt.id); // liegt nächste Woche, nicht unter Heute
  await a.click('#btnDelete');
  ok(!(await stored(a, 'tasks')).some((x) => x.id === nxt.id), 'Aufgabe gelöscht, ohne Rückfrage');
  await a.click('#toast button');
  ok((await stored(a, 'tasks')).some((x) => x.id === nxt.id), 'Rückgängig holt sie zurück');

  // Essensplan
  await a.evaluate(() => {
    const now = Date.now();
    recipes.push({ id: 'r1', title: 'Bolognese', servings: 4, ingredients: '500 g Hackfleisch\n1 Zwiebel\nSalz', steps: '', link: '', createdAt: now, updatedAt: now, deleted: false });
    recipes.push({ id: 'r2', title: 'Chili', servings: 2, ingredients: '250 g Hackfleisch\n1 Dose Bohnen', steps: '', link: '', createdAt: now, updatedAt: now, deleted: false });
    save();
  });
  await a.click('[data-tab=shop]');
  await a.fill('#shopInput', 'Zwiebel'); await a.press('#shopInput', 'Enter');
  await a.click('[data-sview=plan]');
  ok(await a.textContent('#pageTitle') === 'Essensplan' && (await a.locator('[data-meal-add]').count()) === 7 && !(await a.isVisible('#fab')), 'Essensplan: 7 Tage');
  await a.click(`[data-meal-add="${day(0)}"]`);
  await a.click('#mLess'); await a.click('#mMore'); // bleibt 2
  await a.click('[data-pick-recipe="r1"]');
  await a.click(`[data-meal-add="${day(0)}"]`);
  await a.fill('#mealText', 'Pizza bestellen'); await a.press('#mealText', 'Enter');
  // Chili an einem Tag dieser Woche (Plan zeigt die Woche ab Montag)
  const wk = await a.evaluate(() => [...Array(7)].map((_, i) => addDays(mealWeek, i)));
  const other = wk.find((d) => d !== day(0));
  await a.click(`[data-meal-add="${other}"]`);
  await a.click('[data-pick-recipe="r2"]');
  const ms = await stored(a, 'meals');
  ok(ms.length === 3 && ms.find((m) => m.recipeId === 'r1').servings === 2 && ms.some((m) => m.title === 'Pizza bestellen' && !m.recipeId), 'Gerichte eingetragen (Rezept und frei)');
  ok((await a.textContent('[data-plan-shop]')).includes('2 Gerichte'), 'Knopf für den Wocheneinkauf');
  await a.click('[data-plan-shop]');
  const rows = (await a.locator('#psList .pack-row').allTextContents()).map((r) => r.replace(/\s+/g, ' ').replace(/^✓ /, '').trim());
  const press = await a.$$eval('#psList .pack-row', (bs) => bs.map((b) => b.getAttribute('aria-pressed')));
  const hack = rows.findIndex((r) => r.includes('Hackfleisch'));
  ok(rows[hack].startsWith('500 g Hackfleisch') && rows[hack].includes('Bolognese, Chili'), 'Hackfleisch zusammengerechnet: ' + rows[hack]);
  ok(press[rows.findIndex((r) => r.includes('Salz'))] === 'false' && press[rows.findIndex((r) => r.includes('Zwiebel'))] === 'false', 'Salz und Gelistetes abgewählt');
  await a.click('#psAdd');
  const shop = await stored(a, 'shop');
  ok(shop.find((i) => i.name === 'Hackfleisch').qty === '500 g' && shop.find((i) => i.name === 'Hackfleisch').from === 'Essensplan'
    && shop.find((i) => i.name === 'Bohnen').from === 'Chili', 'Auf der Liste mit Herkunft');
  ok((await stored(a, 'meals')).filter((m) => m.recipeId).every((m) => m.shopped), 'Gerichte als eingekauft markiert');
  await a.click('[data-tab=clean]'); await a.click('[data-view=today]');
  ok((await a.textContent('#view')).includes("Heute gibt's: Bolognese, Pizza bestellen"), 'Heute-Ansicht zeigt das Essen');

  // Sicherung speichern, Dinge löschen, Sicherung einspielen
  await a.click('[data-tab=settings]');
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#btnBackup')]);
  const file = await dl.path();
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(backup.type === 'backup' && backup.recipes.length === 2 && backup.meals.length === 3, 'Sicherung enthält alles');
  await a.evaluate(() => { recipes.forEach((r) => { r.deleted = true; touch(r); }); meals.forEach((m) => { m.deleted = true; touch(m); }); save(); });
  await settle(a);
  await a.setInputFiles('#restoreFile', file);
  await a.waitForFunction(() => document.querySelector('#restoreInfo').textContent.includes('wiederhergestellt'));
  ok((await stored(a, 'recipes')).length === 2 && (await stored(a, 'meals')).length === 3, 'Gelöschtes kommt zurück: ' + await a.textContent('#restoreInfo'));
  await settle(a);
  const b = await phone(browser);
  await join(b, code);
  ok((await stored(b, 'recipes')).length === 2 && (await stored(b, 'meals')).length === 3, 'Auch auf dem anderen Gerät');

  // Aufräumen: erledigte Aufgaben älter als ein halbes Jahr verschwinden, „Zuletzt geputzt“ merkt sie sich
  const old = Date.now() - 200 * 864e5;
  const r = await api('/api/sync', { tasks: [{ id: 'alt1', title: 'Fenster putzen', due: '2020-01-01', category: 'Wohnzimmer', minutes: 30, assignee: 'partner', repeat: 'none', done: true, doneAt: old, createdAt: old, updatedAt: old, deleted: false },
    { id: 'wz', title: 'Staubsaugen', due: day(3), category: 'Wohnzimmer', minutes: 20, assignee: null, repeat: 'none', done: false, doneAt: null, createdAt: old, updatedAt: Date.now(), deleted: false }],
    meals: [{ id: 'm-alt', date: '2020-01-01', title: 'Alt', servings: 2, createdAt: old, updatedAt: old, deleted: false }] }, code);
  ok(!r.data.tasks.some((x) => x.id === 'alt1') && r.data.history.lastByCat.Wohnzimmer.title === 'Fenster putzen', 'Alte Aufgabe aufgeräumt, zuletzt Erledigtes gemerkt');
  ok(!r.data.meals.some((m) => m.id === 'm-alt'), 'Alter Essensplan aufgeräumt');
  await settle(a);
  await a.click('[data-tab=clean]'); await a.click('[data-view=stats]');
  ok((await a.textContent('.lc-row:has-text("Wohnzimmer")')).includes('vor 200 Tagen'), '„Zuletzt geputzt“ nutzt die gemerkten Daten');
  const r2 = await api('/api/sync', { tasks: [], notes: [], shop: [], recipes: [] }, code);
  ok(r2.data.meals.filter((m) => !m.deleted).length === 3, 'Ältere App ohne Essensplan löscht nichts');
};
