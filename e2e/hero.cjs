// Two-device hero flow (PRODUCT_SPEC "The live demo", steps 1–4) against a running PinThread.
// Usage: BASE_URL=http://localhost:8787 node e2e/hero.cjs   (screenshots + PDF land in e2e/out/)
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const step = (s) => console.log(`→ ${s}`);
const QUESTION = `Does the dashed line show the new route? (${Date.now() % 10000})`;

(async () => {
  const browser = await chromium.launch();
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const phoneCtx = await browser.newContext({ ...devices['iPhone 14'] });
  const mep = await desk.newPage();
  const errors = [];
  for (const p of [mep]) p.on('pageerror', e => errors.push(`desktop: ${e.message}`));
  try {
    step('Landing → Start as MEP lead');
    await mep.goto(BASE);
    await mep.getByRole('button', { name: /Start as MEP lead/ }).click();
    await mep.waitForSelector('.room-head', { timeout: 20000 });
    await mep.waitForSelector('.conn[data-status="connected"]', { timeout: 15000 });
    await mep.waitForTimeout(700);
    await shot(mep, '01-desktop-open');

    step('1. Propose the reroute (draw route, approve for MEP)');
    await mep.locator('.composer').getByRole('button', { name: /proposal/i }).click();
    const svg = mep.locator('.redline > svg');
    await svg.waitFor();
    const box = await svg.boundingBox();
    for (const [fx, fy] of [[0.12, 0.5], [0.34, 0.5], [0.42, 0.66], [0.6, 0.66], [0.68, 0.5], [0.9, 0.5]]) {
      await mep.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    }
    await mep.getByPlaceholder(/Drop SD-3/).fill('Drop SD-3 150 mm and cross B-14 through existing web opening WO-2 near D/4. Rejoin the main after the beam.');
    await mep.getByPlaceholder(/\+\$1,200/).fill('+$1,200 est. (2 fittings)');
    await shot(mep, '02-desktop-composer');
    await mep.getByRole('button', { name: /Post proposal v1/ }).click();
    await mep.locator('.room-head .status', { hasText: 'Waiting for Structural' }).waitFor({ timeout: 10000 });
    await mep.locator('button.pin[data-pin="RFI-001"].review').waitFor({ state: 'attached' });
    await mep.waitForTimeout(600);
    await shot(mep, '03-desktop-waiting');

    step('2. Follow the alert on the phone (join as Structural)');
    const session = await mep.evaluate(() => JSON.parse(sessionStorage.getItem('pt.session')));
    const phone = await phoneCtx.newPage();
    phone.on('pageerror', e => errors.push(`phone: ${e.message}`));
    await phone.goto(session.joinLinks.struct);
    await phone.getByRole('button', { name: /Join as Dana/ }).click();
    await phone.waitForSelector('.room-head', { timeout: 20000 });
    await phone.waitForSelector('.conn[data-status="connected"]', { timeout: 15000 });
    await phone.locator('.room-head .status', { hasText: 'Waiting for you' }).waitFor({ timeout: 10000 });
    await phone.waitForTimeout(800);
    await shot(phone, '04-phone-review');

    step('Phone asks a question → desktop receives it live → desktop replies → phone receives');
    const box2 = phone.getByLabel('Message RFI-001');
    await box2.fill(QUESTION);
    await box2.press('Enter');
    await mep.getByText(QUESTION).waitFor({ timeout: 10000 });
    const reply = 'Yes. It dips 150 under the main and crosses at WO-2, clear of the D/4 column.';
    await mep.getByLabel('Message RFI-001').fill(reply);
    await mep.getByLabel('Message RFI-001').press('Enter');
    await phone.getByText(reply).waitFor({ timeout: 10000 });
    await shot(mep, '05-desktop-chat');

    step('3. Approve on the phone (tap, confirm) → both pins green');
    const approve = phone.getByTestId('approve');
    await approve.click();
    await phone.getByRole('button', { name: /Confirm approval of v1/ }).waitFor();
    await approve.click();
    await approve.click({ timeout: 1000 }).catch(() => {}); // a repeated tap must not create a second approval
    const t0 = Date.now();
    await Promise.all([
      phone.locator('button.pin[data-pin="RFI-001"].complete').waitFor({ state: 'attached', timeout: 10000 }),
      mep.locator('button.pin[data-pin="RFI-001"].complete').waitFor({ state: 'attached', timeout: 10000 }),
    ]);
    console.log(`   both devices green in ${Date.now() - t0} ms`);
    await mep.locator('.card.decision').waitFor({ timeout: 10000 });
    await phone.waitForTimeout(500);
    await shot(phone, '06-phone-complete');
    await shot(mep, '07-desktop-complete');

    step('4. Refresh both, still green; export the register');
    await Promise.all([mep.reload(), phone.reload()]);
    await mep.locator('button.pin[data-pin="RFI-001"].complete').waitFor({ state: 'attached', timeout: 15000 });
    await phone.locator('button.pin[data-pin="RFI-001"].complete').waitFor({ state: 'attached', timeout: 15000 });
    const hash = (await mep.locator('.card.decision .ref', { hasText: 'Record' }).first().textContent()).replace('Record ', '').trim();
    const [download] = await Promise.all([mep.waitForEvent('download'), mep.getByRole('button', { name: /Export register/ }).click()]);
    const pdfPath = path.join(OUT, 'register.pdf');
    await download.saveAs(pdfPath);
    const pdfParse = require(path.join(__dirname, '../apps/server/node_modules/pdf-parse/lib/pdf-parse.js'));
    const text = (await pdfParse(fs.readFileSync(pdfPath))).text;
    for (const s of ['RFI Register', 'Marco Ruiz', 'Dana Okafor', 'REVIEW COMPLETE', `Record ${hash}`, 'Drop SD-3 150 mm']) {
      if (!text.includes(s)) throw new Error(`PDF is missing "${s}"`);
    }
    console.log(`   PDF matches record ${hash}`);
    const approvals = await mep.evaluate(async () => {
      const s = JSON.parse(sessionStorage.getItem('pt.session'));
      const st = await (await fetch(`/api/projects/${s.projectId}/state`, { headers: { Authorization: `Bearer ${s.session}` } })).json();
      const hero = st.pins.find(p => p.number === 'RFI-001');
      const rec = await (await fetch(`/api/pins/${hero.id}`, { headers: { Authorization: `Bearer ${s.session}` } })).json();
      return rec.signoffs.filter(x => x.verdict === 'approve').length;
    });
    if (approvals !== 2) throw new Error(`Expected exactly 2 approvals, found ${approvals}`);
    await mep.waitForTimeout(400);
    await shot(mep, '08-desktop-after-export');
    if (errors.length) throw new Error(`Page errors:\n${errors.join('\n')}`);
    console.log('✓ hero flow passed');
  } catch (e) {
    console.error('✗ hero flow failed:', e.message);
    for (const [i, p] of [mep, ...phoneCtx.pages()].entries()) await p.screenshot({ path: path.join(OUT, `fail-${i}.png`) }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
