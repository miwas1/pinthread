// Renders design mockups to PNG. Usage: node design/render.cjs [name ...]
const { chromium } = require('playwright');
const path = require('path');
const PAGES = [
  { name: '00-sheet', file: '../../assets/meridian/sheet-c103-revB.svg', w: 1400, h: 990 },
  { name: '01-landing', w: 1440, h: 900 },
  { name: '02-workspace-desktop', w: 1440, h: 900 },
  { name: '03-mobile-review', w: 390, h: 844, mobile: true },
  { name: '04-mobile-complete', w: 390, h: 844, mobile: true },
  { name: '05-proposal-composer', w: 1440, h: 900 },
  { name: '06-register-pdf', w: 794, h: 1123 },
  { name: '07-components', w: 1440, h: 1330 },
];
(async () => {
  const only = process.argv.slice(2);
  const browser = await chromium.launch();
  for (const p of PAGES.filter(p => !only.length || only.includes(p.name))) {
    const ctx = await browser.newContext({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: 2, isMobile: !!p.mobile, hasTouch: !!p.mobile });
    const page = await ctx.newPage();
    const file = path.resolve(__dirname, 'mockups', p.file || `${p.name}.html`);
    await page.goto('file://' + file, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.resolve(__dirname, 'screens', `${p.name}.png`) });
    console.log('rendered', p.name);
    await ctx.close();
  }
  await browser.close();
})();
