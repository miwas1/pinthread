// Renders the illustrative site photos used by the demo seed. Run: node assets/field/build-photos.cjs
// Writes apps/web/public/field/*.jpg and packages/shared/src/field.generated.ts (base64 thumbnails for Nexconn image messages).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const W = 960, H = 540;
const tag = (t) => `<rect x="18" y="${H - 50}" width="${t.length * 11 + 28}" height="32" rx="6" fill="rgba(17,24,39,.66)"/><text x="32" y="${H - 28}" font-size="17" fill="#fff" font-family="DejaVu Sans Mono, monospace">${t}</text>`;
const PHOTOS = {
  img_0742: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7d848b"/><stop offset="1" stop-color="#b6bbbf"/></linearGradient>
    <linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef1f3"/><stop offset=".45" stop-color="#c7cdd2"/><stop offset="1" stop-color="#959da3"/></linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#56616d"/><stop offset=".5" stop-color="#7a8795"/><stop offset="1" stop-color="#4d5762"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#c)"/><rect width="${W}" height="60" fill="#6c7378"/>
    ${[90, 300, 640, 860].map(x => `<line x1="${x}" y1="60" x2="${x}" y2="190" stroke="#4f555b" stroke-width="5"/>`).join('')}
    <path d="M400 0h190l-22 ${H}h-146z" fill="url(#b)"/><path d="M400 0h190v34H400z" fill="#46505a"/><path d="M420 ${H - 34}h146v34H420z" fill="#46505a"/>
    <path d="M0 190h432v168H0z" fill="url(#d)"/>${[80, 200, 320].map(x => `<line x1="${x}" y1="190" x2="${x}" y2="358" stroke="#8b9399" stroke-width="4"/>`).join('')}
    <path d="M420 190l22-6v180l-22-6z" fill="#7b848a"/><path d="M570 200h390v156H570z" fill="url(#d)" opacity=".5"/>
    <path d="M466 250l70 70M536 250l-70 70" stroke="#e5357b" stroke-width="12" stroke-linecap="round"/>
    <circle cx="501" cy="285" r="62" fill="none" stroke="#e5357b" stroke-width="7" stroke-dasharray="14 10"/>
    <text x="606" y="430" font-size="26" fill="#f5f5f5" font-family="DejaVu Sans, sans-serif" font-weight="bold">B-14</text>${tag('IMG_0742 · L03 · 07:42')}</svg>`,
  img_0611: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9a49b"/><stop offset="1" stop-color="#8d887f"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="#cfd4d8"/><path d="M0 120h${W}v300H0z" fill="url(#s)"/><path d="M0 420h${W}v120H0z" fill="#6f6a62"/>
    ${Array.from({ length: 38 }, (_, i) => { const x = 140 + (i * 97) % 640, y = 300 + (i * 53) % 110, r = 6 + (i * 7) % 15; return `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * .7}" fill="#4a463f"/>`; }).join('')}
    ${[200, 330, 460, 590, 720].map(x => `<line x1="${x}" y1="330" x2="${x + 18}" y2="410" stroke="#7a3f22" stroke-width="7"/>`).join('')}
    <ellipse cx="460" cy="350" rx="260" ry="82" fill="none" stroke="#e5357b" stroke-width="8" stroke-dasharray="18 12"/>
    <rect x="690" y="150" width="220" height="38" rx="4" fill="#f2c94c"/>${Array.from({ length: 21 }, (_, i) => `<line x1="${700 + i * 10}" y1="150" x2="${700 + i * 10}" y2="${i % 5 ? 162 : 172}" stroke="#333" stroke-width="2"/>`).join('')}
    ${tag('IMG_0611 · Pour 3B · 16:02')}</svg>`,
  img_0815: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#bfc3c6"/><path d="M380 0h420v${H}H380z" fill="#9ea2a5"/>
    ${Array.from({ length: 9 }, (_, i) => `<line x1="380" y1="${i * 60}" x2="800" y2="${i * 60 + 4}" stroke="#8f9396" stroke-width="2"/>`).join('')}
    <rect x="520" y="180" width="170" height="130" fill="#3d4146"/><rect x="510" y="170" width="190" height="150" fill="none" stroke="#c0392b" stroke-width="10"/>
    <path d="M0 210h560v34H0zM0 262h560v34H0z" fill="#5b8fa8"/>${[60, 160, 260, 360, 460].map(x => `<rect x="${x}" y="196" width="10" height="114" fill="#3f6a80"/>`).join('')}
    <circle cx="605" cy="245" r="96" fill="none" stroke="#e5357b" stroke-width="7" stroke-dasharray="14 10"/>
    <text x="720" y="160" font-size="22" fill="#2b2f33" font-family="DejaVu Sans, sans-serif" font-weight="bold">ER-2</text>${tag('IMG_0815 · Core C1 · 09:15')}</svg>`,
};
(async () => {
  const outDir = path.join(ROOT, 'apps/web/public/field');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const thumbs = {};
  for (const [name, svg] of Object.entries(PHOTOS)) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.setContent(`<body style="margin:0">${svg}</body>`);
    await page.screenshot({ path: path.join(outDir, `${name}.jpg`), type: 'jpeg', quality: 82 });
    await page.setViewportSize({ width: 240, height: 135 });
    await page.setContent(`<body style="margin:0"><div style="width:240px;height:135px">${svg.replace('<svg ', '<svg width="240" height="135" ')}</div></body>`);
    const buf = await page.screenshot({ type: 'jpeg', quality: 55 });
    thumbs[name] = { url: `/field/${name}.jpg`, thumb: buf.toString('base64'), width: W, height: H };
    console.log(name, 'thumb bytes', buf.length);
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'packages/shared/src/field.generated.ts'),
    `// generated by assets/field/build-photos.cjs. Do not edit.\nexport const FIELD_PHOTOS: Record<string, { url: string; thumb: string; width: number; height: number }> = ${JSON.stringify(thumbs)};\n`);
})();
