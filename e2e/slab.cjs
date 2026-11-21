// Exception path (PRODUCT_SPEC: slab inspection) + raising a fresh issue, on one device using the role switcher.
// Usage: BASE_URL=http://localhost:8787 node e2e/slab.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const step = s => console.log(`→ ${s}`);
const photo = path.join(__dirname, '../apps/web/public/field/img_0611.jpg');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const status = (text, timeout = 10000) => page.locator('.room-head .status', { hasText: text }).waitFor({ timeout });
  const switchTo = async name => {
    await page.locator('.me .avbtn').click();
    await page.getByRole('menuitem', { name: new RegExp(name) }).click();
    await page.waitForSelector('.conn[data-status="connected"]', { timeout: 15000 });
    await page.locator('.avbtn .who b', { hasText: name }).waitFor();
  };
  const approve = async () => {
    await page.getByTestId('approve').click();
    await page.getByRole('button', { name: /Confirm approval/ }).click();
  };
  try {
    step('Start as Site lead, open the slab hold');
    await page.goto(`${BASE}/demo`);
    await page.getByRole('button', { name: /Start as Site lead/ }).click();
    await page.waitForSelector('.conn[data-status="connected"]', { timeout: 15000 });
    await page.locator('.issue', { hasText: 'Slab pour 3B' }).click();
    await status('Blocked · Hold by Structural');

    step('Site lead posts corrective evidence');
    await page.getByRole('button', { name: /Add evidence/ }).click();
    await page.locator('.dropzone input[type=file]').setInputFiles(photo);
    await page.getByPlaceholder(/Core test results/).fill('Core test results: 42 MPa. Repair per MS-07 ready.');
    await page.getByRole('button', { name: /Post evidence/ }).click();
    await page.getByText(/posted corrective evidence/).waitFor({ timeout: 10000 });
    await page.locator('.outstanding', { hasText: 'assess the evidence' }).waitFor();
    await page.screenshot({ path: path.join(OUT, 'slab-1-evidence.png') });

    step('Structural clears the hold and approves');
    await switchTo('Dana Okafor');
    await status('Blocked');
    await page.getByRole('button', { name: /Clear hold/ }).click();
    await page.getByPlaceholder(/Core results acceptable/).fill('Core results acceptable. Proceed with MS-07.');
    await page.getByRole('button', { name: /^Clear hold$/ }).last().click();
    await status('Waiting for you and Architect');
    await approve();
    await status('Waiting for Architect');

    step('Architect approves → Review complete');
    await switchTo('Lena Park');
    await status('Waiting for you');
    await approve();
    await status('Review complete');
    await page.locator('button.pin[data-pin="RFI-003"].complete').waitFor({ state: 'attached' });
    await page.screenshot({ path: path.join(OUT, 'slab-2-complete.png') });

    step('Raise a fresh issue from a blank spot');
    await page.getByRole('button', { name: 'Fit sheet' }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'New issue' }).click();
    const sheet = await page.locator('.sheet-content').boundingBox();
    await page.mouse.click(sheet.x + sheet.width * 0.72, sheet.y + sheet.height * 0.82);
    await page.getByPlaceholder(/Sprinkler main/).fill('Sprinkler main clashes with cable tray');
    await page.getByPlaceholder(/What do you need/).fill('Which service drops at G/8? Tray and main are at the same level.');
    await page.getByRole('button', { name: /^Raise issue$/ }).click();
    await page.locator('.room-head .ref', { hasText: 'RFI-005' }).waitFor({ timeout: 10000 });
    await page.getByText(/Ask a question or post a proposal|raised RFI-005/).first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'slab-3-new-issue.png') });
    if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
    console.log('✓ slab + new issue flow passed');
  } catch (e) {
    console.error('✗ failed:', e.message);
    await page.screenshot({ path: path.join(OUT, 'slab-fail.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
