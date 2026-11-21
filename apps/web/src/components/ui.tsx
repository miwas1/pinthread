import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Person, PinStatus } from '@pinthread/shared';
import { Icon } from '../lib/icons';

export const STATUS_LABEL: Record<PinStatus, string> = { open: 'Open', review: 'In review', blocked: 'Blocked', complete: 'Review complete' };

export function Glyph({ status }: { status: PinStatus }) {
  return (
    <svg className="glyph" viewBox="0 0 14 14" aria-hidden>
      {status === 'open' && <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2" />}
      {status === 'review' && <><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M7 2a5 5 0 0 0 0 10z" fill="currentColor" /></>}
      {status === 'blocked' && <><path d="M4.9 1.5h4.2l3.4 3.4v4.2l-3.4 3.4H4.9L1.5 9.1V4.9z" fill="currentColor" /><path d="M4.5 7h5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></>}
      {status === 'complete' && <><circle cx="7" cy="7" r="6" fill="currentColor" /><path d="M4.2 7.2l2 2 3.8-4" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>}
    </svg>
  );
}

export function StatusChip({ status, text, large }: { status: PinStatus; text?: string; large?: boolean }) {
  return <span className={`status ${status} ${large ? 'lg' : ''}`}><Glyph status={status} />{text ?? STATUS_LABEL[status]}</span>;
}

const STATUS_COLOR: Record<PinStatus, string> = { open: 'var(--open)', review: 'var(--review)', blocked: 'var(--blocked)', complete: 'var(--complete)' };

export function PinMarker({ status }: { status: PinStatus }) {
  const c = STATUS_COLOR[status];
  return (
    <svg className="marker" viewBox="0 0 34 44" aria-hidden>
      {status === 'blocked'
        ? <path d="M11.6 4h10.8l7.6 7.6v10.8l-3 3L17 42.5 7.9 25.4l-3.9-3V11.6z" fill={c} stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
        : <path d="M17 42.5S4 28.6 4 17a13 13 0 0 1 26 0c0 11.6-13 25.5-13 25.5z" fill={c} stroke="#fff" strokeWidth="2" />}
      {status === 'open' && <circle cx="17" cy="17" r="5.6" fill="none" stroke="#fff" strokeWidth="2.6" />}
      {status === 'review' && <><circle cx="17" cy="17" r="5.6" fill="none" stroke="#fff" strokeWidth="2.4" /><path d="M17 11.4a5.6 5.6 0 0 0 0 11.2z" fill="#fff" /></>}
      {status === 'blocked' && <path d="M11.5 17h11" stroke="#fff" strokeWidth="3" strokeLinecap="round" />}
      {status === 'complete' && <path d="M11.2 17.4l4 4 7.6-8" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export function Avatar({ p, mark, size }: { p: Pick<Person, 'initials' | 'role' | 'name'> | null | undefined; mark?: 'ok' | 'wait'; size?: 'sm' | 'lg' }) {
  if (!p) return <span className={`av bot ${size ?? ''}`} title="PinThread">PT</span>;
  return (
    <span className={`av ${p.role} ${size ?? ''}`} title={p.name}>
      {p.initials}
      {mark && <span className={`mark ${mark}`}>{mark === 'ok' && <svg viewBox="0 0 10 10"><path d="M2 5.2l2 2 4-4.4" /></svg>}</span>}
    </span>
  );
}

export const ROLE_TAG: Record<string, string> = { site: 'site', mep: 'mep', struct: 'struct', arch: 'arch', elec: 'mep' };

// ------------------------------------------------------------------ toasts

interface Toast { id: number; text: ReactNode; tone: 'ok' | 'info' | 'warn'; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts(ts => [...ts.slice(-1), { ...t, id }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), t.action ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.tone === 'info' ? 'light' : ''} ${t.tone === 'warn' ? 'warn' : ''}`}>
            {t.tone === 'ok' && <span className="ok"><Icon name="check" size="sm" /></span>}
            {t.tone === 'info' && <span style={{ color: 'var(--text-2)' }}><Icon name="at" size="sm" /></span>}
            <span className="grow">{t.text}</span>
            {t.action && <button className="btn btn-ink sm" onClick={() => { t.action!.run(); setToasts(ts => ts.filter(x => x.id !== t.id)); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------ modal

export function Modal({ title, sub, onClose, children, footer, wide, icon }: {
  title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; icon?: ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="mh">
          {icon}
          <div className="grow"><div className="mh-title">{title}</div>{sub && <div className="ref" style={{ marginTop: 4 }}>{sub}</div>}</div>
          <button className="tool" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="mbody">{children}</div>
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden />;
}
