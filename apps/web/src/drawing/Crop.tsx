import { useRef, useState, type PointerEvent } from 'react';
import type { PinStatus, Point } from '@pinthread/shared';
import { RouteLines } from './SheetCanvas';
import { SheetArt, useSheet } from './sheet';
import { Icon } from '../lib/icons';

const MARKER: Record<PinStatus, string> = { open: '#2563EB', review: '#D97706', blocked: '#DC2626', complete: '#16A34A' };

function cropBox(SHEET_W: number, SHEET_H: number, at: Point, route: Point[] | null | undefined, w: number, aspect: number) {
  let cx = at[0] * SHEET_W, cy = at[1] * SHEET_H;
  if (route && route.length > 1) {
    const xs = route.map(p => p[0] * SHEET_W), ys = route.map(p => p[1] * SHEET_H);
    cx = (Math.min(...xs) + Math.max(...xs)) / 2; cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  const h = w / aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function PinGlyph({ at, status, k }: { at: Point; status: PinStatus; k: number }) {
  const { w: SHEET_W, h: SHEET_H } = useSheet();
  const x = at[0] * SHEET_W, y = at[1] * SHEET_H;
  return (
    <g transform={`translate(${x - 17 * k} ${y - 44 * k}) scale(${k})`}>
      <path d="M17 42.5S4 28.6 4 17a13 13 0 0 1 26 0c0 11.6-13 25.5-13 25.5z" fill={MARKER[status]} stroke="#fff" strokeWidth="2" />
    </g>
  );
}

/** Static crop of the sheet around a pin (brief, cards). */
export function Crop({ at, status, route, ghost, width = 230, aspect = 1.9 }: { at: Point; status: PinStatus; route?: Point[] | null; ghost?: Point[] | null; width?: number; aspect?: number }) {
  const view = useSheet();
  // Uploaded drawings are laid out wider than the demo sheet's units, so show a little more context.
  const b = cropBox(view.w, view.h, at, route, width * (view.sheet.source === 'image' ? 1.3 : 1), aspect);
  return (
    <div className="crop">
      <svg viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} preserveAspectRatio="xMidYMid slice" style={{ aspectRatio: String(aspect) }}>
        <SheetArt view={view} />
        {ghost && <RouteLines route={ghost} ghost />}
        {route && <RouteLines route={route} />}
        <PinGlyph at={at} status={status} k={b.w / 400} />
      </svg>
    </div>
  );
}

/** Redline editor: tap to add points, drag to adjust. Coordinates are normalized to the sheet. */
export function RedlineEditor({ at, route, onChange, ghost }: { at: Point; route: Point[]; onChange: (r: Point[]) => void; ghost?: Point[] | null }) {
  const view = useSheet();
  const { w: SHEET_W, h: SHEET_H } = view;
  const [span, setSpan] = useState(view.sheet.source === 'image' ? 340 : 260);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const moved = useRef(false);
  const b = cropBox(SHEET_W, SHEET_H, at, null, span, 1.45);
  const toSheet = (e: PointerEvent): Point | null => {
    const s = svg.current;
    if (!s) return null;
    const pt = s.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = s.getScreenCTM();
    if (!m) return null;
    const q = pt.matrixTransform(m.inverse());
    return [+(q.x / SHEET_W).toFixed(4), +(q.y / SHEET_H).toFixed(4)];
  };
  const k = span / 1000;
  return (
    <div className="redline">
      <svg ref={svg} viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} preserveAspectRatio="xMidYMid meet"
        onPointerDown={e => { moved.current = false; if (drag.current === null) (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
        onPointerMove={e => {
          if (drag.current === null) return;
          const p = toSheet(e);
          if (!p) return;
          moved.current = true;
          onChange(route.map((q, i) => (i === drag.current ? p : q)));
        }}
        onPointerUp={e => {
          if (drag.current !== null) { drag.current = null; return; }
          if (moved.current || route.length >= 64) return;
          const p = toSheet(e);
          if (p) onChange([...route, p]);
        }}>
        <SheetArt view={view} />
        {ghost && <RouteLines route={ghost} ghost />}
        <PinGlyph at={at} status="open" k={k * 1.6} />
        {route.length > 1 && <RouteLines route={route} />}
        {route.map(([x, y], i) => (
          <circle key={i} cx={x * SHEET_W} cy={y * SHEET_H} r={8 * k} fill="#fff" stroke="var(--redline)" strokeWidth={2.4 * k} style={{ cursor: 'grab' }}
            onPointerDown={e => { e.stopPropagation(); drag.current = i; (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); }} />
        ))}
      </svg>
      <div className="redline-tools">
        <button type="button" className="tool" onClick={() => setSpan(s => Math.max(140, s - 60))} aria-label="Zoom in"><Icon name="plus" /></button>
        <button type="button" className="tool" onClick={() => setSpan(s => Math.min(view.sheet.source === 'image' ? 900 : 520, s + 60))} aria-label="Zoom out"><Icon name="minus" /></button>
        <button type="button" className="tool" onClick={() => onChange(route.slice(0, -1))} disabled={!route.length} aria-label="Undo last point"><Icon name="undo" /></button>
        <button type="button" className="tool" onClick={() => onChange([])} disabled={!route.length} aria-label="Clear route"><Icon name="x" /></button>
      </div>
      <div className="redline-hint">{route.length ? `${route.length} point${route.length > 1 ? 's' : ''} · drag to adjust` : 'Tap the drawing to start the route'}</div>
    </div>
  );
}
