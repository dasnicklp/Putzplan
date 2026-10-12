// Startet alle Tests in e2e/ nacheinander mit einem Chromium.
// Voraussetzung: der Worker läuft lokal, siehe README.md („Tests“).
//   node run.cjs            alle Tests
//   node run.cjs rezept     nur Tests, deren Dateiname „rezept“ enthält
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const lib = require('./lib.cjs');

(async () => {
  try {
    const r = await fetch(new URL('/api', lib.BASE));
    if (!(await r.text()).includes('putzplan-api')) throw new Error();
  } catch (e) {
    console.error(`Kein Worker unter ${lib.BASE}. Erst im Ordner worker/ starten:\n  npx wrangler dev --port 8787 --ip 127.0.0.1 --test-scheduled --var ALLOW_LOCAL_PUSH:1`);
    process.exit(2);
  }
  const filter = process.argv[2] || '';
  const files = fs.readdirSync(path.join(__dirname, 'e2e')).filter((f) => f.endsWith('.cjs') && f.includes(filter)).sort();
  // Volles Chromium (nicht die abgespeckte Headless-Variante): nur das hat Mitteilungen und Push wie ein echtes Handy
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: 'chromium' });
  let failed = 0, passed = 0;
  for (const f of files) {
    console.log(`\n▶ ${f}`);
    let fails = 0;
    const ok = (cond, msg) => {
      console.log(`  ${cond ? '✓' : '✗ FEHLER:'} ${msg}`);
      if (cond) passed++; else fails++;
    };
    lib.pageErrors.length = 0;
    const t0 = Date.now();
    try {
      await require(path.join(__dirname, 'e2e', f))({ browser, ok, ...lib });
    } catch (e) {
      ok(false, 'Abbruch: ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join(' | '));
    }
    if (lib.pageErrors.length) ok(false, 'JavaScript-Fehler in der Seite: ' + lib.pageErrors.join(' | '));
    for (const c of browser.contexts()) await c.close();
    console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    failed += fails;
  }
  await browser.close();
  console.log(failed ? `\n${failed} Fehler, ${passed} bestanden` : `\nAlle ${passed} Prüfungen bestanden`);
  process.exit(failed ? 1 : 0);
})();
