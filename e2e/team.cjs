// Team product flow against a running PinThread: sign up, create a project from a PDF, invite a second account,
// raise → propose → approve on the uploaded sheet, publish a new revision, add a sheet, export the register.
// Usage: BASE_URL=http://localhost:8787 DRAWING=path/to/set.pdf REVISION=path/to/revB.pdf node e2e/team.cjs
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const OUT = path.join(__dirname, 'out');
const DRAWING = process.env.DRAWING;
const REVISION = process.env.REVISION || DRAWING;
if (!DRAWING) { console.error('Set DRAWING to a PDF/PNG/JPG drawing (a 2-page PDF exercises the page picker).'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const step = s => console.log(`→ ${s}`);
const run = Date.now().toString(36);

async function signup(page, name, email) {
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel(/Company/).fill('Test Co');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
}

(async () => {
  const browser = await chromium.launch();
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const desk2 = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const phoneCtx = await browser.newContext({ ...devices['iPhone 14'] });
  const alice = await desk.newPage();
  const errors = [];
  alice.on('pageerror', e => errors.push(`alice: ${e.message}`));
  try {
    step('Landing (desktop + phone)');
    await alice.goto(BASE);
    await alice.waitForSelector('.chathero .sys-decision');
    await alice.waitForTimeout(2600);
    await shot(alice, 't01-landing');
    const ph = await phoneCtx.newPage();
    await ph.goto(BASE);
    await ph.waitForTimeout(2600);
    await shot(ph, 't01-landing-phone');

    step('Sign up as Alice');
    await alice.getByRole('link', { name: 'Get started' }).click();
    await alice.waitForURL(/\/signup/);
    await shot(alice, 't02-signup');
    await signup(alice, 'Alice Moreno', `alice.${run}@example.com`);
    await alice.waitForURL(/\/app$/);
    await alice.getByText('Start your first project').waitFor();
    await shot(alice, 't03-projects-empty');

    step('Create a project from a PDF (page 1)');
    await alice.getByRole('link', { name: 'New project' }).first().click();
    await alice.getByLabel('Project name').fill('Harbour Point, Levels 2–3');
    await alice.locator('.dpick-drop input[type=file]').setInputFiles(DRAWING);
    await alice.locator('.dpick-ready').waitFor({ timeout: 30000 });
    await alice.getByLabel('Sheet number').fill('M-201');
    await alice.getByLabel('Sheet title').fill('Level 02 Mechanical layout');
    await alice.getByLabel('Revision').fill('A');
    await shot(alice, 't04-new-project');
    await alice.getByRole('button', { name: 'Create project' }).click();
    await alice.waitForURL(/\/p\/[a-z0-9]+/, { timeout: 30000 });
    await alice.waitForSelector('.sheetwrap.src-image');
    await alice.waitForSelector('.conn[data-status="connected"]', { timeout: 15000 });
    await alice.waitForTimeout(800);
    await shot(alice, 't05-workspace-new');
    const projectUrl = alice.url().split('?')[0];

    step('Invite a structural engineer');
    await alice.getByRole('button', { name: /^Team/ }).click();
    await alice.getByRole('radio', { name: /Structural engineer/ }).click();
    await alice.getByRole('button', { name: /Create invite link/ }).click();
    const link = (await alice.locator('.linkbox').textContent()).trim();
    await shot(alice, 't06-team-invite');
    await alice.keyboard.press('Escape');

    step('Bob opens the invite, signs up and joins');
    const bob = await desk2.newPage();
    bob.on('pageerror', e => errors.push(`bob: ${e.message}`));
    await bob.goto(link);
    await bob.getByRole('link', { name: 'Create an account to join' }).waitFor();
    await shot(bob, 't07-invite-signed-out');
    await bob.getByRole('link', { name: 'Create an account to join' }).click();
    await signup(bob, 'Bob Ng', `bob.${run}@example.com`);
    await bob.getByRole('button', { name: /Join as Bob Ng/ }).click();
    await bob.waitForURL(/\/p\//);
    await bob.waitForSelector('.conn[data-status="connected"]', { timeout: 15000 });

    step('Alice raises an issue on the uploaded sheet with Bob as reviewer');
    await alice.reload();
    await alice.waitForSelector('.conn[data-status="connected"]', { timeout: 15000 });
    await alice.getByRole('button', { name: 'New issue' }).first().click();
    const content = await alice.locator('.sheet-content').boundingBox();
    await alice.mouse.click(content.x + content.width * 0.42, content.y + content.height * 0.4);
    await alice.getByPlaceholder(/Sprinkler main/).fill('SD-3 duct clashes with the transfer beam');
    await alice.getByPlaceholder(/What do you need/).fill('SD-3 runs into the beam between B and C. Can it drop below, or do we need a web opening?');
    await alice.getByPlaceholder('e.g. C–D/4').fill('B–C/2');
    await alice.locator('.picker', { hasText: 'Bob Ng' }).locator('input').check(); // Structural is a default reviewer for MEP issues
    await shot(alice, 't08-raise');
    await alice.getByRole('button', { name: 'Raise issue' }).click();
    await alice.waitForSelector('.room-head', { timeout: 15000 });

    step('Alice proposes a reroute');
    await alice.locator('.composer').getByRole('button', { name: /proposal/i }).click();
    const svg = alice.locator('.redline > svg');
    await svg.waitFor();
    const b = await svg.boundingBox();
    for (const [fx, fy] of [[0.15, 0.45], [0.4, 0.45], [0.48, 0.62], [0.7, 0.62], [0.85, 0.45]]) await alice.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
    await alice.getByPlaceholder(/Drop SD-3/).fill('Drop SD-3 200 mm below the beam soffit between B and C, rejoin after grid C.');
    await alice.getByRole('button', { name: /Post proposal v1/ }).click();
    await alice.locator('.room-head .status', { hasText: 'Waiting for Structural' }).waitFor({ timeout: 10000 });
    await alice.waitForTimeout(600);
    await shot(alice, 't09-proposal');

    step('Bob gets the alert and approves');
    await bob.locator('.issue', { hasText: 'SD-3 duct clashes' }).waitFor({ timeout: 15000 });
    await bob.locator('.issue', { hasText: 'SD-3 duct clashes' }).click();
    await bob.locator('[data-testid=approve]').click();
    await bob.locator('[data-testid=approve]', { hasText: 'Confirm' }).click();
    await bob.locator('.room-head .status', { hasText: 'Review complete' }).waitFor({ timeout: 10000 });
    await alice.locator('.room-head .status', { hasText: 'Review complete' }).waitFor({ timeout: 15000 });
    await alice.waitForTimeout(600);
    await shot(alice, 't10-complete');
    await shot(bob, 't10-complete-bob');

    step('Alice publishes Rev B: the approval no longer counts');
    await alice.locator('.topbar .sheetbtn').click();
    await alice.getByRole('menuitem', { name: /new revision/ }).click();
    await alice.locator('.dpick-drop input[type=file]').setInputFiles(REVISION);
    await alice.locator('.dpick-ready').waitFor({ timeout: 30000 });
    await shot(alice, 't11-revision');
    await alice.getByRole('button', { name: /Publish Rev B/ }).click();
    await alice.locator('.room-head .status', { hasText: 'Waiting for Structural' }).waitFor({ timeout: 15000 });
    await alice.waitForTimeout(500);
    await shot(alice, 't12-after-revision');

    step('Alice adds page 2 of the PDF as a second sheet');
    await alice.locator('.topbar .sheetbtn').click();
    await alice.getByRole('menuitem', { name: /Add a sheet/ }).click();
    await alice.locator('.modal .dpick-drop input[type=file]').setInputFiles(DRAWING);
    await alice.locator('.modal .dpick-ready').waitFor({ timeout: 30000 });
    await alice.locator('.modal .pager select').selectOption('2');
    await alice.locator('.modal .dpick-ready', { hasText: 'page 2 of 2' }).waitFor({ timeout: 30000 });
    await alice.getByLabel('Sheet number').fill('M-202');
    await alice.getByLabel('Sheet title').fill('Level 03 Mechanical layout');
    await alice.getByRole('button', { name: 'Add sheet' }).click();
    await alice.locator('.topbar .sheetbtn', { hasText: 'M-202' }).waitFor({ timeout: 15000 });
    await alice.waitForTimeout(600);
    await shot(alice, 't13-second-sheet');

    step('Export the register');
    const [dl] = await Promise.all([alice.waitForEvent('download'), alice.getByRole('button', { name: /Export register/ }).click()]);
    const pdfPath = path.join(OUT, 'team-register.pdf');
    await dl.saveAs(pdfPath);
    console.log(`  register: ${fs.statSync(pdfPath).size} bytes`);

    step('Projects dashboard');
    await alice.goto(`${BASE}/app`);
    await alice.locator('.pcard').first().waitFor();
    await alice.waitForTimeout(500);
    await shot(alice, 't14-projects');

    step('Phone: Bob opens the project');
    const bobPhone = await phoneCtx.newPage();
    await phoneCtx.addCookies(await desk2.cookies());
    await bobPhone.goto(projectUrl);
    await bobPhone.waitForSelector('.conn[data-status="connected"]', { timeout: 20000 });
    await bobPhone.waitForTimeout(800);
    await shot(bobPhone, 't15-phone-workspace');

    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
    console.log('✓ team flow passed');
  } catch (e) {
    console.error('✗', e.message);
    await shot(alice, 'tfail-alice').catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
