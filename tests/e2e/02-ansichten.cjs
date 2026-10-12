// Reiter und Ansichten: vier Reiter, Umschalter, alter gemerkter Reiter, Woche, Monat, Filter, Bilanz, Update-Prüfung
module.exports = async ({ browser, ok, phone, newHousehold, BASE, day, sleep }) => {
  const a = await phone(browser);
  await a.goto(BASE);
  await a.evaluate(() => localStorage.setItem('putzplan.tab', 'week')); // so hat es Version 1.6 gespeichert
  await a.reload();
  await newHousehold(a);
  const tabs = (await a.locator('.tabbar button').allTextContents()).map((t) => t.trim());
  const cut = await a.$$eval('.tabbar button', (bs) => bs.filter((b) => b.scrollWidth > b.clientWidth + 1).length);
  ok(tabs.join('|') === 'Putzen|Einkauf|Notizen|Zuhause|Einstellungen' && !cut, 'Fünf Reiter, nichts abgeschnitten (360 px)');
  ok(await a.getAttribute('[data-view=week]', 'aria-pressed') === 'true' && await a.isVisible('.wstrip'), 'Alter Reiter „Woche“ wird übernommen');

  // Aufgaben für die Woche anlegen
  await a.evaluate((d) => {
    const now = Date.now();
    const mk = (title, due, assignee) => ({ id: uid(), title, due, category: 'Küche', minutes: 10, assignee, repeat: 'none', every: 1, done: false, doneAt: null, createdAt: now, updatedAt: now, deleted: false });
    tasks.push(mk('Heute A', d[0], 'nick'), mk('Heute B', d[0], 'partner'), mk('Morgen', d[1], null), mk('Alt', d[2], null));
    save();
  }, [day(0), day(1), day(-3)]);

  // Woche: Tagesleiste
  ok((await a.locator('.wday').count()) === 7 && await a.getAttribute('.wday.sel', 'data-day') === day(0), 'Woche: 7 Tage, heute ausgewählt');
  if (await a.$(`.wday[data-day="${day(1)}"]`)) { // morgen liegt in dieser Woche (außer sonntags)
    await a.click(`.wday[data-day="${day(1)}"]`);
    ok((await a.textContent('#view')).includes('Morgen'), 'Anderer Tag zeigt dessen Aufgaben');
  }
  ok((await a.textContent('#view')).includes('Überfällig'), 'Überfälliges wird gezeigt');
  const r1 = await a.textContent('#range');
  await a.click('#next');
  ok((await a.textContent('#range')) !== r1 && (await a.getAttribute('.wday.sel', 'data-day')) > day(0), 'Nächste Woche: ' + await a.textContent('#range'));
  await a.click('#today');
  ok(await a.getAttribute('.wday.sel', 'data-day') === day(0), '„Heute“ springt zurück');

  // Monat
  await a.click('[data-view=month]');
  ok((await a.locator('.cell').count()) >= 28 && await a.isVisible('#navBar'), 'Monatsraster');
  // Filter
  await a.click('[data-view=today]');
  await a.click('[data-filter=partner]');
  const titles = await a.locator('#view .ttl').allTextContents();
  ok(titles.includes('Heute B') && !titles.includes('Heute A'), 'Filter nach Person');
  await a.click('[data-filter=all]');
  ok(!(await a.isVisible('#navBar')) && await a.isVisible('#fab'), 'Heute: ohne Wochen-Navigation, mit +');
  // Bilanz
  await a.click('[data-view=stats]');
  ok(!(await a.isVisible('#filters')) && !(await a.isVisible('#fab')) && (await a.locator('.bal h3').allTextContents()).some((h) => h.startsWith('Wochenbilanz')), 'Bilanz ohne Filter und +');
  // Gemerkte Ansicht nach Neuladen
  await a.click('[data-view=week]');
  await a.reload(); await a.waitForSelector('#app:not([hidden])');
  ok(await a.getAttribute('[data-view=week]', 'aria-pressed') === 'true', 'Ansicht bleibt nach Neuladen');

  // Zuhause: Kacheln springen an die passende Stelle
  await a.click('[data-tab=home]');
  ok((await a.locator('.tile').count()) === 4 && (await a.textContent('.tile[data-go=today] b')) === '3', 'Zuhause: vier Kacheln, 3 offen (2 heute, 1 überfällig)');
  await a.click('.tile[data-go=list]');
  ok(await a.getAttribute('[data-tab=shop]', 'aria-current') === 'page' && await a.getAttribute('[data-sview=list]', 'aria-pressed') === 'true', 'Kachel „Liste“ öffnet die Einkaufsliste');
  await a.click('[data-tab=home]'); await a.click('.tile[data-go=stats]');
  ok(await a.getAttribute('[data-view=stats]', 'aria-pressed') === 'true', 'Kachel „Serie“ öffnet die Bilanz');

  // Einstellungen: Version und Update-Prüfung
  await a.click('[data-tab=settings]');
  ok((await a.locator('[data-setview]').allTextContents()).join('|') === 'Haushalt|Mitteilungen|Verbinden|App', 'Einstellungen: vier Bereiche');
  const segCut = await a.$$eval('#setSeg button', (bs) => bs.filter((b) => b.scrollWidth > b.clientWidth + 1).length);
  ok(!segCut, 'Beschriftung passt (360 px)');
  ok(await a.isVisible('#namesForm') && await a.isVisible('#orderList') && await a.isVisible('#awayBody') && !(await a.isVisible('#pushBox')) && !(await a.isVisible('#sCode')), 'Haushalt: Namen, Urlaub, Laden-Reihenfolge, sonst nichts');
  await a.click('[data-setview=push]');
  ok(await a.isVisible('#pushBox') && !(await a.isVisible('#namesForm')), 'Mitteilungen');
  await a.click('[data-setview=link]');
  ok(await a.isVisible('#sCode') && await a.isVisible('#calBox') && await a.isVisible('#voiceBox'), 'Verbinden: Code, Kalender, Sprachassistent');
  await a.click('[data-setview=app]');
  ok(await a.isVisible('#btnCheckUpdate') && await a.isVisible('#btnBackup') && await a.isVisible('#btnLogout'), 'App: Version, Sicherung, Abmelden');
  await a.reload(); await a.waitForSelector('#app:not([hidden])');
  ok(await a.getAttribute('[data-setview=app]', 'aria-pressed') === 'true', 'Bereich bleibt gemerkt');
  const v = await a.textContent('#sVersion');
  await a.click('#btnCheckUpdate');
  await a.waitForFunction(() => !document.querySelector('#updateInfo').textContent.includes('Suche'));
  const info = await a.textContent('#updateInfo');
  ok(info.includes('aktuellste Version: ' + v), 'version.json passt zur App-Version ' + v);
  await sleep(10);
};
