// RFI register PDF. Built from the same decision records as the app (buildPinRecord), so drawing, thread and PDF agree.
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { MERIDIAN, ROLE_INFO, SHEET_INNER, type PinRecord } from '@pinthread/shared';
import type { ProjectRow } from './repo';

const C = { ink: '#111827', mute: '#4B5563', faint: '#6B7280', line: '#C3C9D2', soft: '#F4F5F7', redline: '#D61F69',
  status: { open: '#1D4ED8', review: '#92400E', blocked: '#B42318', complete: '#166534' } as Record<string, string> };
const W = MERIDIAN.sheet.width, H = MERIDIAN.sheet.height;
const STATUS_TEXT: Record<string, string> = { open: 'OPEN', review: 'IN REVIEW', blocked: 'BLOCKED', complete: 'REVIEW COMPLETE' };
const fmt = (s: string | null) => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '';
const clean = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/≤/g, '<=').replace(/✓/g, '');

function cropSvg(rec: PinRecord, w: number, h: number) {
  const cur = rec.proposals.find(p => p.current);
  const route = cur?.route ?? null;
  let cx = rec.x * W, cy = rec.y * H;
  if (route) {
    const xs = route.map(p => p[0] * W), ys = route.map(p => p[1] * H);
    cx = (Math.min(...xs) + Math.max(...xs)) / 2; cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  const vw = 240, vh = vw * (h / w);
  let ov = '';
  if (route) {
    const pts = route.map(([x, y]) => `${x * W},${y * H}`).join(' ');
    ov += `<polyline points="${pts}" fill="none" stroke="#ffffff" stroke-width="5" stroke-linejoin="round"/>`;
    ov += `<polyline points="${pts}" fill="none" stroke="${C.redline}" stroke-width="2.4" stroke-dasharray="7 5" stroke-linejoin="round"/>`;
  }
  const px = rec.x * W, py = rec.y * H;
  const col = { open: '#2563EB', review: '#D97706', blocked: '#DC2626', complete: '#16A34A' }[rec.state.status];
  ov += `<path transform="translate(${px - 8.5} ${py - 22}) scale(0.5)" d="M17 42.5S4 28.6 4 17a13 13 0 0 1 26 0c0 11.6-13 25.5-13 25.5z" fill="${col}" stroke="#fff" stroke-width="2"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cx - vw / 2} ${cy - vh / 2} ${vw} ${vh}" width="${w}" height="${h}">${SHEET_INNER}${ov}</svg>`;
}

function glyph(doc: PDFKit.PDFDocument, status: string, x: number, y: number, color: string) {
  doc.save().lineWidth(1.4).strokeColor(color).fillColor(color);
  if (status === 'blocked') {
    const r = 4.2, pts = Array.from({ length: 8 }, (_, i) => [x + r * Math.cos(Math.PI / 8 + (i * Math.PI) / 4), y + r * Math.sin(Math.PI / 8 + (i * Math.PI) / 4)]);
    doc.polygon(...(pts as [number, number][])).fill();
  } else if (status === 'complete') {
    doc.circle(x, y, 4.2).fill();
    doc.strokeColor('#fff').lineWidth(1.2).moveTo(x - 2, y).lineTo(x - 0.5, y + 1.6).lineTo(x + 2.2, y - 1.6).stroke();
  } else {
    doc.circle(x, y, 3.6).stroke();
    if (status === 'review') doc.path(`M ${x} ${y - 3.6} A 3.6 3.6 0 0 0 ${x} ${y + 3.6} Z`).fill();
  }
  doc.restore();
}

export async function registerPdf(project: ProjectRow, pins: PinRecord[], exportedBy: { name: string; role: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 50, left: 40, right: 40 }, bufferPages: true, info: { Title: `RFI Register - ${project.name}`, Author: 'PinThread' } });
  const chunks: Buffer[] = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise<Buffer>(r => doc.on('end', () => r(Buffer.concat(chunks))));
  const L = 40, R = 555, CW = R - L;

  // Header
  doc.save().translate(L, 38).scale(1.25);
  doc.path('M12 2.5a6.5 6.5 0 0 1 6.5 6.5c0 4.6-6.5 10.6-6.5 10.6S5.5 13.6 5.5 9A6.5 6.5 0 0 1 12 2.5z').fill(C.ink);
  doc.circle(12, 9, 2.4).fill('#fff');
  doc.path('M12 19.6c2.4 2.5 6.6 2.5 9.4.4').lineWidth(2.1).lineCap('round').stroke('#16A34A');
  doc.restore();
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(19).text('RFI Register', L + 38, 40);
  doc.font('Helvetica').fontSize(9.5).fillColor(C.mute).text(`${project.name}  ·  ${project.sheet_number} ${project.sheet_title}  ·  Rev ${project.revision}`, L + 38, 63);
  const now = new Date();
  doc.fontSize(8.5).text(`Exported ${fmt(now.toISOString())}\nby ${exportedBy.name} (${exportedBy.role})`, R - 180, 42, { width: 180, align: 'right' });
  doc.moveTo(L, 84).lineTo(R, 84).lineWidth(1.6).stroke(C.ink);

  // Summary
  const counts = { all: pins.length, complete: 0, review: 0, blocked: 0, open: 0 } as Record<string, number>;
  pins.forEach(p => { counts[p.state.status]++; });
  const cells: [string, number][] = [['Issues', counts.all], ['Review complete', counts.complete], ['In review', counts.review], ['Blocked', counts.blocked], ['Open', counts.open]];
  const cw = CW / cells.length;
  doc.lineWidth(0.8).roundedRect(L, 96, CW, 40, 4).stroke(C.line);
  cells.forEach(([label, n], i) => {
    if (i) doc.moveTo(L + cw * i, 96).lineTo(L + cw * i, 136).stroke(C.line);
    doc.fillColor(C.ink).font('Courier-Bold').fontSize(15).text(String(n), L + cw * i + 9, 102);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.mute).text(label, L + cw * i + 9, 121);
  });
  let y = 150;

  for (const rec of pins) {
    const cur = rec.proposals.find(p => p.current) ?? null;
    const curSignoffs = rec.signoffs.filter(s => s.proposalId === cur?.id && s.verdict !== 'withdrawn');
    const history = rec.signoffs.filter(s => s.proposalId !== cur?.id && s.verdict === 'approve');
    const needed = 250 + curSignoffs.length * 16 + (rec.state.status !== 'complete' ? 34 : 0) + rec.holds.length * 30;
    if (y + needed > 790) { doc.addPage(); y = 40; }
    const top = y;
    const color = C.status[rec.state.status];

    // Record header
    doc.save().roundedRect(L, y, CW, 26, 4).fill(C.soft).restore();
    doc.fillColor(C.ink).font('Courier-Bold').fontSize(10).text(rec.number, L + 10, y + 8);
    doc.font('Helvetica-Bold').fontSize(10.5).text(clean(rec.title), L + 70, y + 8, { width: 300, lineBreak: false, ellipsis: true });
    const st = STATUS_TEXT[rec.state.status];
    doc.font('Courier-Bold').fontSize(8.5);
    const sw = doc.widthOfString(st) + 26;
    doc.lineWidth(1.2).roundedRect(R - sw - 8, y + 5, sw, 16, 3).stroke(color);
    glyph(doc, rec.state.status, R - sw + 2, y + 13, color);
    doc.fillColor(color).text(st, R - sw + 10, y + 9.5);
    y += 34;

    // Crop
    const cropW = 230, cropH = 132;
    doc.save().roundedRect(L, y, cropW, cropH, 4).clip();
    SVGtoPDF(doc, cropSvg(rec, cropW, cropH), L, y, { width: cropW, height: cropH, preserveAspectRatio: 'xMidYMid slice', fontCallback: (_f: string, bold: boolean) => (bold ? 'Courier-Bold' : 'Courier') });
    doc.restore();
    doc.lineWidth(0.8).roundedRect(L, y, cropW, cropH, 4).stroke(C.line);
    if (cur?.route) {
      doc.save().moveTo(L, y + cropH + 9).lineTo(L + 16, y + cropH + 9).lineWidth(2).dash(3, { space: 2 }).stroke(C.redline).restore();
      doc.font('Helvetica').fontSize(7.5).fillColor(C.faint).text(`${rec.state.status === 'complete' ? 'Accepted' : 'Proposed'} route v${cur.version}  ·  ${rec.gridRef}, Rev ${project.revision}`, L + 20, y + cropH + 5);
    }

    // Fields
    const fx = L + cropW + 16, fw = R - fx;
    let fy = y;
    const field = (k: string, v: string, mono = false) => {
      doc.font('Helvetica').fontSize(8.5).fillColor(C.faint).text(k, fx, fy, { width: 70 });
      doc.font(mono ? 'Courier' : 'Helvetica').fontSize(8.5).fillColor(C.ink).text(clean(v), fx + 74, fy, { width: fw - 74 });
      fy = Math.max(doc.y, fy + 11) + 3;
    };
    field('Sheet / rev', `${project.sheet_number}  Rev ${project.revision}`, true);
    field('Grid', rec.gridRef, true);
    field('Discipline', `${rec.discipline.toUpperCase()}  ·  ${rec.severity[0].toUpperCase()}${rec.severity.slice(1)}`);
    field('Raised', `${rec.raisedBy.name}, ${fmt(rec.createdAt)}`);
    field('Question', rec.question);
    fy += 4;
    doc.font('Courier-Bold').fontSize(7.5).fillColor(C.faint).text(cur ? (rec.state.status === 'complete' ? `ACCEPTED PROPOSAL  ·  V${cur.version}` : `CURRENT PROPOSAL  ·  V${cur.version}  (NOT YET ACCEPTED)`) : 'NO PROPOSAL YET', fx, fy);
    fy = doc.y + 3;
    if (cur) {
      doc.font('Helvetica').fontSize(8.5).fillColor(C.ink).text(clean(cur.summary), fx, fy, { width: fw });
      const impacts = [cur.costImpact && `Cost ${cur.costImpact}`, cur.scheduleImpact && `Schedule ${cur.scheduleImpact}`].filter(Boolean).join('  ·  ');
      if (impacts) doc.fillColor(C.mute).text(clean(impacts), fx, doc.y + 1, { width: fw });
      doc.fillColor(C.faint).text(`Proposed by ${cur.author.name} (${ROLE_INFO[cur.author.role].title})`, fx, doc.y + 1, { width: fw });
      fy = doc.y;
    }
    y = Math.max(y + cropH + (cur?.route ? 18 : 8), fy + 8);

    // Sign-offs
    if (curSignoffs.length || rec.reviewers.length) {
      const cols = [0, 135, 240, 330, 365, 400];
      const hdr = ['REVIEWER', 'ROLE', 'DECISION', 'PROP.', 'REV', 'TIME (UTC)'];
      doc.font('Courier-Bold').fontSize(7).fillColor(C.mute);
      hdr.forEach((h, i) => doc.text(h, L + 4 + cols[i], y));
      y += 11;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).stroke(C.line);
      y += 4;
      for (const r of rec.reviewers) {
        const s = curSignoffs.find(x => x.reviewer.userId === r.userId);
        const decision = s ? (s.verdict === 'approve' ? 'Approved' : 'Change requested') : 'Waiting';
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text(r.name, L + 4 + cols[0], y, { width: 145, lineBreak: false });
        doc.font('Helvetica').fontSize(8.5).fillColor(C.mute).text(ROLE_INFO[r.role].title, L + 4 + cols[1], y, { width: 100, lineBreak: false });
        doc.fillColor(s?.verdict === 'approve' ? C.status.complete : s ? C.status.review : C.faint).text(decision, L + 4 + cols[2], y);
        doc.font('Courier').fillColor(C.ink).text(s ? `v${s.version}` : '-', L + 4 + cols[3], y).text(s ? s.revision : '-', L + 4 + cols[4], y).text(s ? fmt(s.at).replace(' UTC', '') : '-', L + 4 + cols[5], y, { width: CW - cols[5] - 8, lineBreak: false });
        y += 15;
      }
      if (history.length) {
        doc.font('Helvetica').fontSize(7.5).fillColor(C.faint).text(`Earlier approvals (superseded versions): ${history.map(h => `${h.reviewer.name} on v${h.version}`).join(', ')}`, L + 4, y, { width: CW - 8 });
        y = doc.y + 4;
      }
    }

    // Holds
    for (const h of rec.holds) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(h.status === 'active' ? C.status.blocked : C.mute)
        .text(`Hold by ${h.placedBy.name} (${ROLE_INFO[h.placedBy.role].label}), ${fmt(h.createdAt)}${h.status === 'cleared' ? `, cleared by ${h.clearedBy?.name} ${fmt(h.clearedAt)}` : ''}`, L + 4, y, { width: CW - 8 });
      doc.font('Helvetica').fillColor(C.ink).text(clean(`"${h.reason}" To clear: ${h.clearCondition}.${h.evidence.length ? ` Evidence: ${h.evidence.map(e => e.caption).join('; ')}` : ''}`), L + 4, doc.y + 1, { width: CW - 8 });
      y = doc.y + 6;
    }

    // Outstanding
    if (rec.state.status !== 'complete' && rec.state.outstanding) {
      doc.font('Helvetica-Bold').fontSize(8.5);
      const text = clean(`Outstanding: ${rec.state.outstanding}.`);
      const th = doc.heightOfString(text, { width: CW - 20 });
      doc.save().lineWidth(1.1).dash(3, { space: 2 }).roundedRect(L, y, CW, th + 12, 4).stroke(C.status.blocked).restore();
      doc.fillColor(C.status.blocked).text(text, L + 10, y + 6, { width: CW - 20 });
      y += th + 18;
    }

    doc.font('Courier').fontSize(7.5).fillColor(C.mute).text(`Record ${rec.recordHash}`, L + 4, y);
    doc.font('Helvetica').fontSize(7.5).fillColor(C.faint).text('Matches the hash shown on the pin in PinThread.', L + 90, y);
    y += 14;
    doc.lineWidth(0.8).roundedRect(L - 0.5, top - 0.5, CW + 1, y - top + 1, 5).stroke(C.line);
    y += 14;
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // allow writing the footer inside the bottom margin
    doc.moveTo(L, 800).lineTo(R, 800).lineWidth(0.6).stroke(C.line);
    doc.font('Helvetica').fontSize(7.5).fillColor(C.faint)
      .text('Generated by PinThread from the decision record. Drawing, thread and this register share one source.', L, 806, { width: 400, lineBreak: false });
    doc.font('Courier').text(`Page ${i + 1} of ${range.count}`, R - 80, 806, { width: 80, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
