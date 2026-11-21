import { MERIDIAN } from './geometry';
import type { Point, Sheet } from './types';

/** Long side, in canvas units, that uploaded sheets are laid out at. Pins and routes are stored normalized (0..1). */
export const IMAGE_SHEET_UNITS = 1400;

/** Canvas size of a sheet in drawing units. The built-in vector sheet uses its own units; uploads keep their aspect ratio. */
export function sheetBox(s: Pick<Sheet, 'source' | 'width' | 'height'>): { w: number; h: number } {
  if (s.source === 'vector') return { w: MERIDIAN.sheet.width, h: MERIDIAN.sheet.height };
  const ratio = s.height / Math.max(1, s.width);
  return ratio <= 1
    ? { w: IMAGE_SHEET_UNITS, h: Math.round(IMAGE_SHEET_UNITS * ratio) }
    : { w: Math.round(IMAGE_SHEET_UNITS / ratio), h: IMAGE_SHEET_UNITS };
}

export const isNormalized = ([x, y]: Point) => x >= 0 && x <= 1 && y >= 0 && y <= 1;

/** "Priya Shah" → "PS"; "dana" → "DA". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts.at(-1)![0]).toUpperCase();
}
