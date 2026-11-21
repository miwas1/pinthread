import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import type { PinSummary, Point } from '@pinthread/shared';
import { PinMarker, STATUS_LABEL } from '../components/ui';
import { Icon } from '../lib/icons';
import { SheetArt, useSheet } from './sheet';

export interface CanvasHandle { focusPin(id: string, scale?: number): void; fit(): void; zoomIn(): void; zoomOut(): void }
export interface Layers { arch: boolean; struct: boolean; mep: boolean }

const SheetSvg = memo(function SheetSvg() {
  const view = useSheet();
  return <svg className="sheet" viewBox={`0 0 ${view.w} ${view.h}`}><SheetArt view={view} /></svg>;
});

export function RouteLines({ route, ghost }: { route: Point[]; ghost?: boolean }) {
  const { w: SHEET_W, h: SHEET_H } = useSheet();
  if (route.length < 2) return null;
  const pts = route.map(([x, y]) => `${x * SHEET_W},${y * SHEET_H}`).join(' ');
  const [sx, sy] = [route[0][0] * SHEET_W, route[0][1] * SHEET_H];
  const [ex, ey] = [route.at(-1)![0] * SHEET_W, route.at(-1)![1] * SHEET_H];
  const [px, py] = [route.at(-2)![0] * SHEET_W, route.at(-2)![1] * SHEET_H];
  const a = Math.atan2(ey - py, ex - px), L = 11;
  const col = ghost ? '#9AA2AE' : 'var(--redline)';
  return (
    <g>
      <polyline points={pts} fill="none" stroke="#fff" strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.9} />
      <polyline points={pts} fill="none" stroke={col} strokeWidth={3.2} strokeDasharray="9 6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={sx} cy={sy} r={4.5} fill={col} stroke="#fff" strokeWidth={1.5} />
      <path d={`M${ex} ${ey} L${ex - L * Math.cos(a - 0.45)} ${ey - L * Math.sin(a - 0.45)} L${ex - L * Math.cos(a + 0.45)} ${ey - L * Math.sin(a + 0.45)} Z`} fill={col} stroke="#fff" strokeWidth={1} />
    </g>
  );
}

interface Props {
  pins: PinSummary[];
  selectedId: string | null;
  labelFor: (p: PinSummary) => string;
  onSelect: (id: string) => void;
  routes: { route: Point[]; ghost?: boolean }[];
  layers: Layers;
  placing: boolean;
  onPlace: (p: Point) => void;
  bottomInset?: number;
  unread?: Record<string, number>;
  pulseId?: string | null;
  draft?: Point | null;
  compactLabels?: boolean;
}

export const SheetCanvas = forwardRef<CanvasHandle, Props>(function SheetCanvas(p, ref) {
  const { w: SHEET_W, h: SHEET_H, sheet } = useSheet();
  const tz = useRef<ReactZoomPanPinchRef>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const down = useRef<{ x: number; y: number } | null>(null);

  const applyScale = useCallback((scale: number) => {
    const el = content.current;
    if (!el) return;
    el.style.setProperty('--inv', String(1 / scale));
    el.dataset.zoom = scale >= 0.6 ? 'near' : scale >= 0.32 ? 'mid' : 'far';
  }, []);

  const focusAt = useCallback((x: number, y: number, scale: number, ms = 450) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r || !tz.current) return;
    const visH = r.height - (p.bottomInset ?? 0);
    tz.current.setTransform(r.width / 2 - x * scale, Math.max(60, visH / 2) - y * scale, scale, ms, 'easeOut');
  }, [p.bottomInset]);

  /** Fit the whole sheet on screen. Instant on open: animations started while the canvas mounts get cancelled. */
  const fit = useCallback((animate = true) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    const s = Math.min(r.width / SHEET_W, (r.height - (p.bottomInset ?? 0)) / SHEET_H) * 0.94;
    focusAt(SHEET_W / 2, SHEET_H / 2, s, animate ? 450 : 0);
  }, [focusAt, p.bottomInset, SHEET_W, SHEET_H]);

  // Opening a sheet (or switching to another one) fits it to the screen, unless a pin is about to be focused.
  useEffect(() => { if (!p.selectedId) requestAnimationFrame(() => fit(false)); }, [sheet.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    focusPin(id, scale) {
      const pin = p.pins.find(x => x.id === id);
      if (!pin) return;
      const cur = tz.current?.instance.transformState.scale ?? 1;
      focusAt(pin.x * SHEET_W, pin.y * SHEET_H, scale ?? Math.max(cur, 1.25));
    },
    fit: () => fit(true),
    zoomIn: () => tz.current?.zoomIn(0.45, 250),
    zoomOut: () => tz.current?.zoomOut(0.45, 250),
  }), [p.pins, focusAt, fit, SHEET_W, SHEET_H]);

  useEffect(() => { applyScale(tz.current?.instance.transformState.scale ?? 1); }, [applyScale]);

  const hidden = (['arch', 'struct', 'mep'] as const).filter(k => !p.layers[k]).map(k => `hide-${k}`).join(' ');

  const onPointerDown = (e: React.PointerEvent) => { down.current = { x: e.clientX, y: e.clientY }; };
  const onClickPlace = (e: React.MouseEvent) => {
    if (!p.placing || !content.current) return;
    const d = down.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // a pan, not a tap
    const r = content.current.getBoundingClientRect();
    p.onPlace([+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.height).toFixed(4)]);
  };

  return (
    <div className={`sheetwrap ${hidden} ${p.placing ? 'placing' : ''} src-${sheet.source}`} ref={wrap}>
      <TransformWrapper ref={tz} minScale={0.2} maxScale={6} initialScale={0.6} limitToBounds={false} centerOnInit={false}
        doubleClick={{ mode: 'zoomIn', step: 0.7 }} wheel={{ step: 0.12 }} pinch={{ step: 5 }} panning={{ velocityDisabled: true }}
        onTransformed={(_r, s) => applyScale(s.scale)} onInit={() => requestAnimationFrame(() => { if (!p.selectedId) fit(false); })}>
        <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: SHEET_W, height: SHEET_H }}>
          <div ref={content} className="sheet-content" style={{ width: SHEET_W, height: SHEET_H }} onPointerDown={onPointerDown} onClick={onClickPlace}>
            <SheetSvg />
            <svg className="overlay" viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}>
              {p.routes.map((r, i) => <RouteLines key={i} route={r.route} ghost={r.ghost} />)}
            </svg>
            {p.pins.map(pin => {
              const sel = pin.id === p.selectedId;
              const label = p.labelFor(pin);
              const unread = p.unread?.[pin.id] ?? 0;
              return (
                <button key={pin.id} type="button" className={`pin ${pin.state.status} ${sel ? 'sel' : ''} ${p.pulseId === pin.id ? 'pulse' : ''}`}
                  style={{ left: pin.x * SHEET_W, top: pin.y * SHEET_H }} data-pin={pin.number}
                  aria-label={`${pin.number}: ${pin.title}. ${label}`} aria-pressed={sel}
                  onClick={e => { e.stopPropagation(); if (!p.placing) p.onSelect(pin.id); }}>
                  {sel && <span className="halo" />}
                  <PinMarker status={pin.state.status} />
                  {unread > 0 && <span className="badge">{unread}</span>}
                  <span className="label"><span className="id">{pin.number}</span><span className="st">{sel && !p.compactLabels ? label : STATUS_LABEL[pin.state.status]}</span></span>
                </button>
              );
            })}
            {p.draft && (
              <span className="pin open newpin" style={{ left: p.draft[0] * SHEET_W, top: p.draft[1] * SHEET_H }}>
                <PinMarker status="open" /><span className="label"><span className="id">New</span><span className="st">Setting up…</span></span>
              </span>
            )}
          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
});

export function ZoomStack({ canvas, selectedId }: { canvas: React.RefObject<CanvasHandle | null>; selectedId: string | null }) {
  return (
    <div className="zoom">
      <button onClick={() => canvas.current?.zoomIn()} aria-label="Zoom in"><Icon name="plus" /></button>
      <button onClick={() => canvas.current?.zoomOut()} aria-label="Zoom out"><Icon name="minus" /></button>
      <button onClick={() => canvas.current?.fit()} aria-label="Fit sheet"><Icon name="fit" /></button>
      <button onClick={() => selectedId && canvas.current?.focusPin(selectedId, 1.45)} aria-label="Zoom to pin" disabled={!selectedId}><Icon name="target" /></button>
    </div>
  );
}
