// Zuhause: Pinnwand (mit „Wer bist du?“), Geburtstage, Anschaffungen, Geräte mit Wartung, Demnächst; zweites Gerät
module.exports = async ({ browser, ok, settle, phone, newHousehold, join, stored, api, day, sleep }) => {
  const a = await phone(browser);
  const code = await newHousehold(a);
  await a.click('[data-tab=home]');
  ok((await a.locator('[data-hview]').allTextContents()).join('|') === 'Übersicht|Geburtstage|Wünsche|Geräte', 'Zuhause: vier Bereiche');
  const segCut = await a.$$eval('#homeSeg button', (bs) => bs.filter((b) => b.scrollWidth > b.clientWidth + 1).length);
  ok(!segCut, 'Beschriftung passt (360 px)');

  // Pinnwand: erst „Wer bist du?“
  ok(await a.isVisible('[data-me="nick"]') && await a.isDisabled('#boardInput'), 'Pinnwand fragt erst, wer schreibt');
  await a.click('[data-me="nick"]');
  await a.fill('#boardInput', 'Paket kommt heute'); await a.press('#boardInput', 'Enter');
  const msgs = await stored(a, 'board');
  ok(msgs.length === 1 && msgs[0].from === 'nick' && (await a.textContent('#boardList')).includes('Paket kommt heute'), 'Nachricht steht auf der Pinnwand');
  await a.click(`[data-msg-del="${msgs[0].id}"]`);
  ok(!(await stored(a, 'board')).length, 'Nachricht entfernt');
  await a.click('#toast button');
  ok((await stored(a, 'board')).length === 1, 'Rückgängig');

  // Geburtstage
  await a.click('[data-hview=bdays]');
  ok(await a.textContent('#pageTitle') === 'Geburtstage' && await a.getAttribute('#fab', 'aria-label') === 'Neuer Geburtstag', 'Geburtstage: Titel und +');
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  await a.click('#fab'); await sleep(100);
  await a.fill('#gf_name', 'Mama');
  await a.fill('#gf_day', String(tmr.getDate()));
  await a.selectOption('#gf_month', String(tmr.getMonth() + 1));
  await a.fill('#gf_year', String(tmr.getFullYear() - 60));
  await a.fill('#gf_note', 'Gin, Buch');
  await a.click('#genForm button[type=submit]');
  ok((await a.textContent('#homeBody')).includes('morgen · wird 60'), 'Geburtstag: morgen, wird 60');
  await a.click('#fab'); await sleep(100);
  await a.fill('#gf_name', 'Tim'); await a.fill('#gf_day', '1'); await a.selectOption('#gf_month', '1');
  await a.click('#genForm button[type=submit]');
  ok((await a.locator('[data-bday] .ttl').allTextContents())[0].includes('Mama'), 'Sortiert nach dem nächsten Termin');
  await a.click('#fab'); await sleep(100);
  await a.click('#genForm button[type=submit]');
  ok(!(await a.isHidden('#formSheet')), 'Pflichtfeld fehlt: Fenster bleibt offen');
  await a.click('#gfCancel');

  // Anschaffungen
  await a.click('[data-hview=wishes]');
  for (const [t, prio] of [['Akku-Staubsauger', 'high'], ['Stehlampe', 'low']]) {
    await a.click('#fab'); await sleep(100);
    await a.fill('#gf_title', t); await a.fill('#gf_price', '250 €'); await a.selectOption('#gf_prio', prio);
    await a.click('#genForm button[type=submit]');
  }
  ok((await a.locator('#homeBody h2').allTextContents()).join('|') === 'Bald|Irgendwann', 'Nach Dringlichkeit gruppiert');
  const lamp = (await stored(a, 'wishes')).find((w) => w.title === 'Stehlampe');
  await a.click(`[data-wish-done="${lamp.id}"]`);
  ok((await a.locator('#homeBody h2').allTextContents()).includes('Gekauft'), 'Gekauft');

  // Geräte und Wartung
  await a.click('[data-hview=devices]');
  await a.click('#fab'); await sleep(100);
  await a.fill('#gf_name', 'Kaffeemaschine');
  await a.fill('#gf_warranty', day(20));
  await a.fill('#gf_link', 'https://example.com/anleitung.pdf');
  await a.click('#genForm button[type=submit]');
  ok((await a.textContent('#homeBody')).includes('⚠ Garantie bis'), 'Garantie läuft bald ab: Warnzeichen');
  ok(await a.getAttribute('#homeBody a', 'href') === 'https://example.com/anleitung.pdf', 'Link zur Anleitung');
  const dev = (await stored(a, 'devices'))[0];
  await a.click(`[data-maint="${dev.id}"]`);
  ok(await a.inputValue('#fTitle') === 'Kaffeemaschine: ' && await a.inputValue('#fRepeat') === 'm1', 'Wartung: Aufgabe vorbereitet (monatlich)');
  await a.fill('#fTitle', 'Kaffeemaschine: entkalken');
  await a.click('#taskForm button[type=submit]');
  ok((await a.textContent('#homeBody')).includes('🔧 entkalken'), 'Wartung steht am Gerät');
  ok((await stored(a, 'tasks')).some((t) => t.title === 'Kaffeemaschine: entkalken' && t.repeat === 'monthly'), 'Als wiederkehrende Aufgabe angelegt');

  // Übersicht: Demnächst, Heute-Banner
  await a.click('[data-hview=overview]');
  const up = await a.textContent('#homeBody');
  ok(up.includes('Mama morgen') && up.includes('Garantie Kaffeemaschine') && up.includes('Akku-Staubsauger'), 'Demnächst: Geburtstag, Garantie, Anschaffung');
  await a.click('[data-tab=clean]'); await a.click('[data-view=today]');
  ok((await a.textContent('#view')).includes('🎂 Morgen: Mama wird 60'), 'Heute-Ansicht erinnert an den Geburtstag');

  // Zweites Gerät
  await settle(a);
  const b = await phone(browser);
  await join(b, code);
  ok((await stored(b, 'board')).length === 1 && (await stored(b, 'bdays')).length === 2 && (await stored(b, 'wishes')).length === 2 && (await stored(b, 'devices')).length === 1, 'Alles auch auf dem anderen Gerät');
  const r = await api('/api/sync', { tasks: [], shop: [] }, code);
  ok(r.data.bdays.length === 2 && r.data.devices.length === 1, 'Ältere App ohne diese Bereiche löscht nichts');
};
