// Generates the Meridian Tower C-103 Level 03 coordination sheet (Rev B) as SVG.
// Output: sheet-c103-revB.svg, sheet.js (window.PT_SHEET for mockups), meridian.json (geometry for seeding).
// Run: node assets/meridian/build-sheet.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const W = 1400, H = 990;
const NUMS = Array.from({ length: 9 }, (_, i) => ({ id: String(i + 1), x: 120 + i * 120 }));
const LETTERS = 'ABCDEFGH'.split('').map((id, j) => ({ id, y: 120 + j * 105 }));
const gx = n => NUMS[n - 1].x;
const gy = l => LETTERS['ABCDEFGH'.indexOf(l)].y;

const C = { grid: '#A3ABB6', arch: '#4B5563', struct: '#5F7FA8', mep: '#3E9488', ink: '#1F2937', paper: '#FFFFFF' };
const MONO = `font-family="IBM Plex Mono, DejaVu Sans Mono, monospace"`;
const t = (x, y, s, size = 9, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" ${MONO} ${extra}>${s}</text>`;

// ---------- Grid ----------
let grid = `<g id="grid" stroke="${C.grid}" stroke-width="0.8" stroke-dasharray="18 4 3 4" fill="none">`;
for (const n of NUMS) grid += `<line x1="${n.x}" y1="92" x2="${n.x}" y2="883"/>`;
for (const l of LETTERS) grid += `<line x1="92" y1="${l.y}" x2="1108" y2="${l.y}"/>`;
grid += `</g><g id="grid-bubbles" fill="${C.paper}" stroke="${C.ink}" stroke-width="1">`;
for (const n of NUMS) grid += `<circle cx="${n.x}" cy="75" r="14"/><circle cx="${n.x}" cy="900" r="14"/>`;
for (const l of LETTERS) grid += `<circle cx="75" cy="${l.y}" r="14"/><circle cx="1125" cy="${l.y}" r="14"/>`;
grid += `</g><g fill="${C.ink}" text-anchor="middle" dominant-baseline="central">`;
for (const n of NUMS) grid += t(n.x, 75, n.id, 12, 'font-weight="600"') + t(n.x, 900, n.id, 12, 'font-weight="600"');
for (const l of LETTERS) grid += t(75, l.y, l.id, 12, 'font-weight="600"') + t(1125, l.y, l.id, 12, 'font-weight="600"');
grid += `</g>`;

// ---------- Architecture ----------
let arch = `<g id="layer-arch" stroke="${C.arch}" fill="none">`;
// curtain wall along grid A with mullions
arch += `<line x1="${gx(1)}" y1="${gy('A') - 10}" x2="${gx(9)}" y2="${gy('A') - 10}" stroke-width="1.2"/>`;
arch += `<line x1="${gx(1)}" y1="${gy('A') - 4}" x2="${gx(9)}" y2="${gy('A') - 4}" stroke-width="1.2"/>`;
for (let x = gx(1); x <= gx(9); x += 30) arch += `<line x1="${x}" y1="${gy('A') - 13}" x2="${x}" y2="${gy('A') - 1}" stroke-width="1"/>`;
// solid perimeter walls
arch += `<path d="M${gx(1) - 8} ${gy('A') - 10} V${gy('H') + 8} H${gx(9) + 8} V${gy('A') - 10}" stroke-width="6" stroke-linejoin="miter"/>`;
// core D–F / 5–7 with double walls
const core = { x1: gx(5), y1: gy('D'), x2: gx(7), y2: gy('F') };
arch += `<rect x="${core.x1}" y="${core.y1}" width="${core.x2 - core.x1}" height="${core.y2 - core.y1}" stroke-width="7"/>`;
arch += `<rect x="${core.x1 + 10}" y="${core.y1 + 10}" width="${core.x2 - core.x1 - 20}" height="${core.y2 - core.y1 - 20}" stroke-width="1"/>`;
// lift shafts + stair
for (const [x, y] of [[core.x1 + 22, core.y1 + 22], [core.x1 + 92, core.y1 + 22]]) {
  arch += `<rect x="${x}" y="${y}" width="58" height="58" stroke-width="1.4"/><path d="M${x} ${y}L${x + 58} ${y + 58}M${x + 58} ${y}L${x} ${y + 58}" stroke-width="0.8"/>`;
}
for (let i = 0; i < 10; i++) arch += `<line x1="${core.x1 + 22}" y1="${core.y1 + 110 + i * 8}" x2="${core.x1 + 130}" y2="${core.y1 + 110 + i * 8}" stroke-width="0.7"/>`;
// partitions with doors
const wall = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="3"/>`;
arch += wall(gx(1), gy('E') + 40, gx(4) - 30, gy('E') + 40) + wall(gx(4) + 30, gy('E') + 40, gx(5), gy('E') + 40);
arch += `<path d="M${gx(4) - 30} ${gy('E') + 40} A30 30 0 0 1 ${gx(4)} ${gy('E') + 10}" stroke-width="0.8"/>`;
arch += wall(gx(7), gy('B') + 30, gx(9), gy('B') + 30) + wall(gx(8), gy('B') + 30, gx(8), gy('D') - 20);
arch += wall(gx(7) + 60, gy('G'), gx(9), gy('G'));
arch += `</g><g fill="${C.arch}" text-anchor="middle">`;
arch += t(gx(2) + 60, gy('B') + 40, 'OPEN OFFICE 3.01', 10, 'font-weight="500" letter-spacing="0.5"');
arch += t(gx(8), gy('A') + 55, 'MEETING 3.02', 10, 'font-weight="500" letter-spacing="0.5"');
arch += t(gx(6) + 55, gy('E') + 62, 'CORE C1', 10, 'font-weight="500" letter-spacing="0.5"');
arch += t(gx(8) - 20, gy('G') + 55, 'PLANT 3.04', 10, 'font-weight="500" letter-spacing="0.5"');
arch += t(gx(2) + 60, gy('G') + 55, 'OPEN OFFICE 3.05', 10, 'font-weight="500" letter-spacing="0.5"');
arch += t(gx(2), gy('A') - 22, 'CW-1 CURTAIN WALL', 8, '');
arch += `</g>`;

// ---------- Structure ----------
let struct = `<g id="layer-struct">`;
struct += `<defs><pattern id="hatch-pour" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="${C.struct}" stroke-width="0.8" opacity="0.6"/></pattern></defs>`;
struct += `<g stroke="${C.struct}" stroke-width="3.5" opacity="0.75">`;
for (const n of NUMS) struct += `<line x1="${n.x}" y1="${gy('A')}" x2="${n.x}" y2="${gy('H')}"/>`;
for (const l of LETTERS) struct += `<line x1="${gx(1)}" y1="${l.y}" x2="${gx(9)}" y2="${l.y}"/>`;
struct += `</g><g fill="${C.struct}">`;
for (const n of NUMS) for (const l of LETTERS) struct += `<rect x="${n.x - 7}" y="${l.y - 7}" width="14" height="14"/>`;
struct += `</g>`;
// slab pour zone 3B: F–G / 2–3
const pour = { x1: gx(2) + 6, y1: gy('F') + 6, x2: gx(3) - 6, y2: gy('G') - 6 };
struct += `<rect x="${pour.x1}" y="${pour.y1}" width="${pour.x2 - pour.x1}" height="${pour.y2 - pour.y1}" fill="url(#hatch-pour)" stroke="${C.struct}" stroke-width="1.2" stroke-dasharray="6 3"/>`;
// web opening provision WO-2 on B-14 near D/4
struct += `<circle cx="${gx(4)}" cy="${gy('D') - 23}" r="7" fill="${C.paper}" stroke="${C.struct}" stroke-width="1.2"/>`;
struct += `<g fill="${C.struct}">`;
struct += t(gx(4) - 9, gy('C') + 22, 'B-14', 9, `font-weight="600" transform="rotate(-90 ${gx(4) - 9} ${gy('C') + 22})" text-anchor="middle"`);
struct += t(gx(2) - 9, gy('D') + 52, 'B-12', 9, `font-weight="600" transform="rotate(-90 ${gx(2) - 9} ${gy('D') + 52})" text-anchor="middle"`);
struct += t(gx(6) - 9, gy('B') + 52, 'B-16', 9, `font-weight="600" transform="rotate(-90 ${gx(6) - 9} ${gy('B') + 52})" text-anchor="middle"`);
struct += t(gx(4) + 60, gy('C') - 6, 'B-31', 9, 'font-weight="600" text-anchor="middle"');
struct += t(gx(4) + 12, gy('D') - 20, 'WO-2 Ø450', 7.5, '');
struct += t((pour.x1 + pour.x2) / 2, (pour.y1 + pour.y2) / 2 + 3, 'POUR 3B', 10, 'font-weight="600" text-anchor="middle"');
struct += `</g></g>`;

// ---------- MEP ----------
let mep = `<g id="layer-mep" stroke="${C.mep}" fill="none">`;
const ductY = Math.round((gy('C') + gy('D')) / 2) - 1; // 381
mep += `<line x1="150" y1="${ductY - 8}" x2="760" y2="${ductY - 8}" stroke-width="1.6"/><line x1="150" y1="${ductY + 8}" x2="760" y2="${ductY + 8}" stroke-width="1.6"/>`;
for (let x = 170; x < 760; x += 40) mep += `<path d="M${x} ${ductY - 8} L${x + 16} ${ductY + 8}" stroke-width="0.7"/>`;
// branches + diffusers
for (const bx of [300, 560]) {
  mep += `<line x1="${bx - 5}" y1="${ductY + 8}" x2="${bx - 5}" y2="${ductY + 75}" stroke-width="1.2"/><line x1="${bx + 5}" y1="${ductY + 8}" x2="${bx + 5}" y2="${ductY + 75}" stroke-width="1.2"/>`;
  mep += `<rect x="${bx - 12}" y="${ductY + 75}" width="24" height="24" stroke-width="1.2"/><path d="M${bx - 12} ${ductY + 75}l24 24m0 -24l-24 24" stroke-width="0.8"/>`;
}
// second duct SD-2 along E/F band west of core
const d2 = gy('E') + 52;
mep += `<line x1="150" y1="${d2 - 6}" x2="${gx(5) - 14}" y2="${d2 - 6}" stroke-width="1.4"/><line x1="150" y1="${d2 + 6}" x2="${gx(5) - 14}" y2="${d2 + 6}" stroke-width="1.4"/>`;
// plumbing (dashed)
mep += `<path d="M${gx(7) + 30} ${gy('F') + 20} H${gx(9) - 20} V${gy('H') - 20}" stroke-width="1.2" stroke-dasharray="7 4"/>`;
// electrical riser ER-2 at E/7 (on core wall)
mep += `<rect x="${gx(7) - 4}" y="${gy('E') - 14}" width="30" height="28" stroke-width="1.6" fill="#E7F3F1"/>`;
mep += `<path d="M${gx(7) - 4} ${gy('E') - 14}l30 28" stroke-width="0.9"/>`;
mep += `</g><g fill="${C.mep}">`;
mep += t(560, ductY - 14, 'SD-3 600×400 SA', 9, 'font-weight="600"');
mep += t(160, d2 + 22, 'SD-2 500×300 SA', 9, 'font-weight="600"');
mep += t(gx(7) + 32, gy('E') - 20, 'ER-2', 9, 'font-weight="600"');
mep += `</g>`;

// ---------- Title block ----------
const TB = { x: 1160, y: 30, w: 210, h: 930 };
let tb = `<g id="titleblock" ${MONO} fill="${C.ink}">`;
tb += `<rect x="${TB.x}" y="${TB.y}" width="${TB.w}" height="${TB.h}" fill="none" stroke="${C.ink}" stroke-width="1.2"/>`;
const row = (y) => `<line x1="${TB.x}" y1="${y}" x2="${TB.x + TB.w}" y2="${y}" stroke="${C.ink}" stroke-width="0.8"/>`;
// north arrow
tb += `<circle cx="${TB.x + 105}" cy="95" r="34" fill="none" stroke="${C.ink}" stroke-width="1"/><path d="M${TB.x + 105} 63 L${TB.x + 117} 112 L${TB.x + 105} 104 L${TB.x + 93} 112 Z" fill="${C.ink}"/>`;
tb += `<text x="${TB.x + 105}" y="54" font-size="11" text-anchor="middle" font-weight="600">N</text>`;
tb += row(150);
tb += `<text x="${TB.x + 12}" y="172" font-size="8" fill="#6B7280">LEGEND</text>`;
[['ARCHITECTURE', C.arch], ['STRUCTURE', C.struct], ['MECHANICAL / ELEC', C.mep]].forEach(([l, c], i) => {
  tb += `<line x1="${TB.x + 12}" y1="${190 + i * 18}" x2="${TB.x + 40}" y2="${190 + i * 18}" stroke="${c}" stroke-width="3"/><text x="${TB.x + 48}" y="${193 + i * 18}" font-size="8.5">${l}</text>`;
});
tb += row(250);
tb += `<text x="${TB.x + 12}" y="272" font-size="8" fill="#6B7280">REVISIONS</text>`;
[['B', '06.11.26', 'MEP ROUTING REVISED'], ['A', '02.10.26', 'ISSUED FOR COORD.']].forEach(([r, d, s], i) => {
  const y = 292 + i * 18;
  tb += `<text x="${TB.x + 12}" y="${y}" font-size="8.5" font-weight="600">${r}</text><text x="${TB.x + 28}" y="${y}" font-size="8.5">${d}</text><text x="${TB.x + 84}" y="${y}" font-size="7.5">${s}</text>`;
});
tb += row(340);
tb += `<text x="${TB.x + 12}" y="362" font-size="8" fill="#6B7280">STATUS</text><rect x="${TB.x + 12}" y="372" width="${TB.w - 24}" height="26" fill="none" stroke="${C.ink}" stroke-width="1"/><text x="${TB.x + 105}" y="389" font-size="10" font-weight="600" text-anchor="middle">FOR COORDINATION</text>`;
tb += row(420);
tb += `<text x="${TB.x + 12}" y="442" font-size="8" fill="#6B7280">ARCHITECT</text><text x="${TB.x + 12}" y="460" font-size="9.5" font-weight="600">PARK &amp; VALE ARCHITECTS</text>`;
tb += `<text x="${TB.x + 12}" y="486" font-size="8" fill="#6B7280">CONTRACTOR</text><text x="${TB.x + 12}" y="504" font-size="9.5" font-weight="600">HALDEN CONSTRUCTION</text>`;
tb += row(530);
tb += `<text x="${TB.x + 12}" y="552" font-size="8" fill="#6B7280">PROJECT</text><text x="${TB.x + 12}" y="578" font-size="17" font-weight="600">MERIDIAN TOWER</text>`;
tb += `<text x="${TB.x + 12}" y="610" font-size="8" fill="#6B7280">DRAWING</text><text x="${TB.x + 12}" y="630" font-size="11" font-weight="600">LEVEL 03</text><text x="${TB.x + 12}" y="646" font-size="11" font-weight="600">COORDINATION PLAN</text>`;
tb += row(670);
tb += `<text x="${TB.x + 12}" y="690" font-size="8" fill="#6B7280">SCALE</text><text x="${TB.x + 12}" y="708" font-size="10">1:100 @ A1</text>`;
tb += `<text x="${TB.x + 110}" y="690" font-size="8" fill="#6B7280">DATE</text><text x="${TB.x + 110}" y="708" font-size="10">06.11.26</text>`;
tb += row(730);
tb += `<text x="${TB.x + 12}" y="752" font-size="8" fill="#6B7280">DRAWING NO.</text><text x="${TB.x + 12}" y="800" font-size="34" font-weight="600">C-103</text>`;
tb += `<line x1="${TB.x + 140}" y1="730" x2="${TB.x + 140}" y2="820" stroke="${C.ink}" stroke-width="0.8"/><text x="${TB.x + 150}" y="752" font-size="8" fill="#6B7280">REV</text><text x="${TB.x + 175}" y="800" font-size="34" font-weight="600" text-anchor="middle">B</text>`;
tb += row(820);
tb += `<text x="${TB.x + 12}" y="842" font-size="7.5" fill="#6B7280">DO NOT SCALE. ALL DIMENSIONS IN MM.</text><text x="${TB.x + 12}" y="856" font-size="7.5" fill="#6B7280">FICTIONAL DEMO DRAWING.</text>`;
tb += `</g>`;

const inner = `<rect width="${W}" height="${H}" fill="${C.paper}"/>
<rect x="20" y="20" width="${W - 40}" height="${H - 40}" fill="none" stroke="${C.ink}" stroke-width="1.5"/>
${grid}${struct}${arch}${mep}${tb}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${inner}</svg>`;

// Geometry shared with seeding and mockups (normalized 0..1 where noted)
const norm = (x, y) => [+(x / W).toFixed(4), +(y / H).toFixed(4)];
const geometry = {
  sheet: { number: 'C-103', title: 'Level 03 Coordination Plan', revision: 'B', width: W, height: H },
  gridlines: { numbers: NUMS, letters: LETTERS },
  pins: {
    'RFI-001': { at: norm(gx(4), ductY), grid: 'C–D/4', title: 'Supply duct SD-3 crosses Beam B-14' },
    'RFI-002': { at: norm(gx(7) + 4, gy('E')), grid: 'E/7', title: 'Electrical riser ER-2 penetration through core wall' },
    'RFI-003': { at: norm((pour.x1 + pour.x2) / 2, (pour.y1 + pour.y2) / 2 - 18), grid: 'F–G/2–3', title: 'Slab pour 3B: honeycombing at edge' },
    'RFI-004': { at: norm(gx(2), gy('A') - 7), grid: 'A/1–3', title: 'Curtain wall bracket spacing at grid A' },
  },
  // Proposal v1 for RFI-001: SD-3 dips south to cross B-14 at web opening WO-2 near D/4
  routes: {
    'RFI-001/v1': [[390, ductY], [430, ductY], [452, gy('D') - 23], [508, gy('D') - 23], [530, ductY], [580, ductY]].map(([x, y]) => norm(x, y)),
  },
};

writeFileSync(join(OUT, 'sheet-c103-revB.svg'), svg);
writeFileSync(join(OUT, 'meridian.json'), JSON.stringify(geometry, null, 2));
writeFileSync(join(OUT, 'sheet.js'), `// generated by build-sheet.mjs\nwindow.PT_SHEET = ${JSON.stringify({ width: W, height: H, inner, geometry })};\n`);
writeFileSync(join(OUT, '..', '..', 'packages', 'shared', 'src', 'sheet.generated.ts'),
  `// generated by assets/meridian/build-sheet.mjs. Do not edit.\nexport const SHEET_INNER = ${JSON.stringify(inner)};\n`);
console.log('wrote sheet-c103-revB.svg, meridian.json, sheet.js, packages/shared/src/sheet.generated.ts');
