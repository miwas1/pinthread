import meridian from '../../../assets/meridian/meridian.json';
import type { Point } from './types';

export const SHEET = meridian.sheet;
export const MERIDIAN = meridian;

const SNAP = 18; // sheet units: within this distance a pin is "on" a gridline

function axisRef(v: number, lines: { id: string; at: number }[]): string {
  const near = lines.find(l => Math.abs(l.at - v) <= SNAP);
  if (near) return near.id;
  const before = [...lines].reverse().find(l => l.at < v);
  const after = lines.find(l => l.at > v);
  if (before && after) return `${before.id}–${after.id}`;
  return (before ?? after)!.id;
}

/** Grid reference for a normalized sheet point, e.g. "C–D/4". Letters (rows) first, then numbers (columns). */
export function gridRef([nx, ny]: Point): string {
  const x = nx * SHEET.width, y = ny * SHEET.height;
  const nums = meridian.gridlines.numbers.map(n => ({ id: n.id, at: n.x }));
  const lets = meridian.gridlines.letters.map(l => ({ id: l.id, at: l.y }));
  return `${axisRef(y, lets)}/${axisRef(x, nums)}`;
}

/** True when the point lies on the drawing area (not the title block or margins). */
export function isOnDrawing([nx, ny]: Point): boolean {
  const x = nx * SHEET.width, y = ny * SHEET.height;
  return x >= 60 && x <= 1140 && y >= 60 && y <= 930;
}
