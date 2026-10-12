// Startpaket, eigene Wiederholung, abwechselnd, verschieben, Konfetti, Serie, Zuletzt geputzt, Urlaub, Zahl am App-Symbol
module.exports = async ({ browser, ok, phone, newHousehold, stored, api, day, sleep }) => {
  const a = await phone(browser);
  await a.context().addInitScript(() => {
    window.__badges = [];
    navigator.setAppBadge = (n) => { window.__badges.push(n); return Promise.resolve(); };
    navigator.clearAppBadge = () => { window.__badges.push(0); return Promise.resolve(); };
  });
  const code = await newHousehold(a);

  // Startpaket
  ok(await a.isVisible('.starter [data-open-pack]'), 'Ohne Aufgaben: Startpaket angeboten');
  await a.click('.starter [data-open-pack]');
  ok((await a.locator('.pack-row').count()) === 15, '15 Vorschläge');
  await a.click('[data-pack="14"]'); await a.click('[data-pack="7"]');
  await a.click('#packAdd');
  let ts = await stored(a, 'tasks');
  const muell = ts.find((t) => t.title === 'Müll rausbringen');
  ok(ts.length === 13 && ts.find((t) => t.title === 'Bad putzen').assignee === 'nick' && ts.find((t) => t.title === 'Toilette putzen').assignee === 'partner'
    && muell.repeat === 'days' && muell.every === 3 && muell.fromDone && muell.rotate, '13 Aufgaben, abwechselnd zugewiesen');

  // Eigene Wiederholung: alle 4 Tage ab Erledigung, abwechselnd
  await a.click('[data-view=today]');
  await a.click('#fab'); await sleep(120);
  await a.fill('#fTitle', 'Kräuter gießen');
  await a.selectOption('#fWho', 'nick');
  await a.selectOption('#fRepeat', 'custom');
  await a.fill('#fEvery', '4'); await a.click('#fFromDone'); await a.click('#fRotate');
  await a.click('#taskForm button[type=submit]');
  const k = (await stored(a, 'tasks')).find((t) => t.title === 'Kräuter gießen');
  ok(k.repeat === 'days' && k.every === 4 && k.fromDone && k.rotate, 'Alle 4 Tage, ab Erledigung, abwechselnd');
  await a.click(`.check[data-id="${k.id}"]`);
  const next = (await stored(a, 'tasks')).find((t) => t.title === 'Kräuter gießen' && !t.done);
  ok(next.due === day(4) && next.assignee === 'partner', 'Nächster Termin in 4 Tagen, andere Person');

  // Verschieben
  const first = (await stored(a, 'tasks')).find((t) => !t.done && t.due === day(0));
  await a.click(`.later[data-id="${first.id}"]`);
  ok((await a.textContent('#laterOpts button >> nth=0')).startsWith('Morgen'), 'Verschieben: Morgen zuerst');
  await a.click('#laterOpts button >> nth=0');
  ok((await stored(a, 'tasks')).find((t) => t.id === first.id).due === day(1), 'Auf morgen verschoben');

  // Alles für heute erledigen: Konfetti
  for (let i = 0; i < 30; i++) {
    const open = (await stored(a, 'tasks')).filter((t) => !t.done && t.due <= day(0));
    if (!open.length) break;
    await a.click(`.check[data-id="${open[0].id}"]`); await sleep(60);
  }
  ok(await a.locator('.confetti').count() === 1 && (await a.textContent('#toast')).includes('Alles erledigt'), 'Konfetti, wenn alles erledigt ist');

  // Serie
  await a.evaluate((days) => {
    const now = Date.now();
    days.forEach((d, i) => tasks.push({ id: 'st' + i, title: 'Alt ' + i, due: d, category: 'Bad', minutes: 5, assignee: null, repeat: 'none', done: true, doneAt: now - (i + 1) * 864e5, createdAt: now, updatedAt: now, deleted: false }));
    save();
  }, [day(-1), day(-2), day(-3)]);
  ok((await a.textContent('#view')).includes('🔥 4 Putztage in Folge'), 'Serie: 4 Tage');

  // Zuletzt geputzt
  await a.click('[data-view=stats]');
  const lc = (await a.locator('.lc-row').allTextContents()).map((r) => r.replace(/\s+/g, ' '));
  ok(lc.length === 5 && lc.some((r) => r.includes('✓ heute')) && lc.some((r) => r.includes('noch nie')), 'Zuletzt geputzt pro Bereich');
  const badges = await a.evaluate(() => window.__badges);
  ok(badges.some((n) => n > 0) && badges[badges.length - 1] === 0, 'Zahl am App-Symbol: ' + badges.slice(-3).join(','));

  // Urlaub
  await a.click('[data-tab=home]');
  await a.fill('#awayDate', day(10));
  await a.click('#btnAwayStart');
  ts = await stored(a, 'tasks');
  const sauger = ts.find((t) => t.title === 'Staubsaugen' && !t.done);
  ok(!ts.some((t) => !t.done && t.due < day(10)) && sauger.due >= day(10) && sauger.due < day(17), 'Urlaub: alles hinter den Urlaub geschoben, Rhythmus bleibt');
  await sleep(800);
  const s = (await api('/api/sync', { tasks: [] }, code)).data.settings;
  ok(s.away && s.away.until === day(10) && s.names, 'Urlaub beim Server, Namen bleiben');
  await a.click('#btnAwayEnd');
  ok((await a.textContent('#awayBody')).includes('Urlaub eintragen'), 'Urlaub beendet');
};
