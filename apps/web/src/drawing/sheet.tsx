import { createContext, memo, useContext, useMemo, type ReactNode } from 'react';
import { MERIDIAN, SHEET_INNER, sheetBox, type Sheet } from '@pinthread/shared';

/** The sheet being shown, with its size in drawing units. Pins and routes are normalized (0..1) against w × h. */
export interface SheetView { sheet: Sheet; w: number; h: number }

const Ctx = createContext<SheetView | null>(null);

export function SheetProvider({ sheet, children }: { sheet: Sheet; children: ReactNode }) {
  const value = useMemo(() => ({ sheet, ...sheetBox(sheet) }), [sheet]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSheet(): SheetView {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSheet outside SheetProvider');
  return v;
}

/** The built-in demo sheet (C-103 Level 03, Rev B). */
export const DEMO_SHEET: Sheet = {
  id: 'demo', number: MERIDIAN.sheet.number, title: MERIDIAN.sheet.title, revision: MERIDIAN.sheet.revision, source: 'vector',
  imageUrl: null, width: MERIDIAN.sheet.width, height: MERIDIAN.sheet.height, revisions: [],
};

/** Sheet artwork as SVG children in drawing units: the vector demo sheet, or the uploaded drawing. */
export const SheetArt = memo(function SheetArt({ view }: { view: SheetView }) {
  if (view.sheet.source === 'vector' || !view.sheet.imageUrl) return <g dangerouslySetInnerHTML={{ __html: SHEET_INNER }} />;
  return <image href={view.sheet.imageUrl} x={0} y={0} width={view.w} height={view.h} preserveAspectRatio="none" />;
}, (a, b) => a.view.sheet.imageUrl === b.view.sheet.imageUrl && a.view.sheet.source === b.view.sheet.source && a.view.w === b.view.w);
