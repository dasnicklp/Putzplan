// Haushalt anlegen, Aufgabe eintragen und erledigen, zweites Gerät verbinden, Abgleich, falscher Code
module.exports = async ({ browser, ok, settle, phone, newHousehold, join, stored, day, sleep }) => {
  const a = await phone(browser);
  await a.goto(require('../lib.cjs').BASE);
  ok(await a.isVisible('#setup') && await a.$eval('#joinCode', (e) => getComputedStyle(e).fontSize) === '16px', 'Startseite, Eingabefeld 16 px (kein Zoom auf dem iPhone)');
  const code = await newHousehold(a);
  ok(/^\d{6}$/.test(code), 'Haushalt angelegt: Code mit 6 Ziffern');

  // Aufgabe über das Formular, wöchentlich
  await a.click('#fab'); await sleep(120);
  await a.fill('#fTitle', 'Bad wischen');
  await a.selectOption('#fCat', 'Bad');
  await a.fill('#fMin', '20');
  await a.selectOption('#fWho', 'nick');
  await a.selectOption('#fRepeat', 'w1');
  await a.click('#taskForm button[type=submit]');
  let t = (await stored(a, 'tasks'))[0];
  ok(t && t.title === 'Bad wischen' && t.due === day(0) && t.repeat === 'weekly' && t.minutes === 20 && t.assignee === 'nick', 'Aufgabe gespeichert (heute, wöchentlich, 20 Min, Nick)');
  ok((await a.textContent('#view')).includes('Bad wischen'), 'Aufgabe erscheint unter Heute');

  // Erledigen erzeugt den nächsten Termin
  await a.click(`.check[data-id="${t.id}"]`);
  const tasks = await stored(a, 'tasks');
  ok(tasks.length === 2 && tasks.some((x) => x.done) && tasks.some((x) => !x.done && x.due === day(7)), 'Erledigt, nächster Termin in 7 Tagen');
  ok((await a.textContent('#toast')).includes('Nächster Termin'), 'Hinweis auf den nächsten Termin');

  // Zweites Gerät
  await settle(a);
  const b = await phone(browser);
  await join(b, code);
  ok((await stored(b, 'tasks')).length === 2, 'Zweites Gerät hat beide Aufgaben');
  await b.click('#fab'); await sleep(120);
  await b.fill('#fTitle', 'Müll raus');
  await b.click('#taskForm button[type=submit]');
  await settle(b);
  await settle(a);
  ok((await stored(a, 'tasks')).some((x) => x.title === 'Müll raus'), 'Änderung von Gerät B kommt bei A an');

  // Namen gelten für beide
  await a.click('[data-tab=settings]');
  await a.fill('#sName2', 'Lena');
  await a.click('#namesForm button[type=submit]');
  await settle(a);
  await settle(b);
  await b.click('[data-tab=clean]');
  ok((await b.textContent('#filters')).includes('Lena'), 'Name kommt auf dem anderen Gerät an');

  // Falscher Code
  const c = await phone(browser);
  await c.goto(require('../lib.cjs').BASE);
  await c.fill('#joinCode', code === '000000' ? '000001' : '000000');
  await c.click('#joinForm button[type=submit]');
  await c.waitForFunction(() => document.querySelector('#joinErr').textContent.includes('kenne'));
  ok(true, 'Falscher Code: verständliche Meldung');
};
