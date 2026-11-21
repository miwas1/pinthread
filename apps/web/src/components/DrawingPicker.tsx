import { useEffect, useRef, useState } from 'react';
import { ACCEPT, fromCanvas, fromImage, isPdf, openPdf, type PdfHandle, type PreparedDrawing } from '../lib/drawing';
import { uploadFile } from '../lib/api';
import { Icon } from '../lib/icons';
import { Spinner } from './ui';

export interface PickedDrawing extends PreparedDrawing { fileName: string; page: number | null; pages: number | null }

/** Upload both images of a prepared drawing. Progress covers the full-size file. */
export async function uploadDrawing(d: PreparedDrawing, onProgress?: (f: number) => void) {
  const full = await uploadFile(d.full, onProgress);
  const thumb = await uploadFile(d.thumb).catch(() => null); // a missing thumbnail only affects the projects list
  return { fileId: full.id, thumbFileId: thumb?.id ?? null };
}

/**
 * Drop zone for one drawing sheet: PDF (choose the page), PNG or JPG. Calls onChange with the prepared images,
 * or null while nothing usable is selected.
 */
export function DrawingPicker({ onChange, onFile, compact }: { onChange: (d: PickedDrawing | null) => void; onFile?: (name: string) => void; compact?: boolean }) {
  const [phase, setPhase] = useState<'idle' | 'reading' | 'ready' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState<PickedDrawing | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const pdf = useRef<PdfHandle | null>(null);
  const fileName = useRef('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => { pdf.current?.destroy(); }, []);
  useEffect(() => { if (!picked) { setPreview(null); return; } const u = URL.createObjectURL(picked.thumb); setPreview(u); return () => URL.revokeObjectURL(u); }, [picked]);

  const done = (d: PickedDrawing) => { setPicked(d); setPhase('ready'); onChange(d); };
  const fail = (e: unknown) => { setErr(e instanceof Error ? e.message : 'That file could not be read.'); setPhase('error'); setPicked(null); onChange(null); };

  const renderPage = async (n: number) => {
    if (!pdf.current) return;
    setPhase('reading'); onChange(null);
    try { done({ ...(await fromCanvas(await pdf.current.render(n))), fileName: fileName.current, page: n, pages: pdf.current.pages }); }
    catch (e) { fail(e); }
  };

  const take = async (file: File | undefined) => {
    if (!file) return;
    pdf.current?.destroy(); pdf.current = null;
    fileName.current = file.name;
    onFile?.(file.name);
    setPhase('reading'); setErr(''); onChange(null);
    try {
      if (isPdf(file)) {
        pdf.current = await openPdf(file);
        await renderPage(1);
      } else if (/^image\//.test(file.type)) {
        done({ ...(await fromImage(file)), fileName: file.name, page: null, pages: null });
      } else {
        throw new Error('Upload a PDF, PNG or JPG drawing.');
      }
    } catch (e) { fail(e); }
  };

  return (
    <div className={`dpick ${compact ? 'compact' : ''}`}>
      {phase !== 'ready' && (
        <label className={`dpick-drop ${over ? 'over' : ''}`}
          onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files?.[0]); }}>
          <input ref={input} type="file" accept={ACCEPT} onChange={e => { void take(e.target.files?.[0]); e.target.value = ''; }} />
          {phase === 'reading'
            ? <span className="dpick-msg"><Spinner /> Preparing the drawing…</span>
            : <span className="dpick-msg"><span className="dpick-ico"><Icon name="file" size="lg" /></span><b>Drop a drawing here, or choose a file</b><span className="faint small">PDF, PNG or JPG. For a multi-page PDF you pick the sheet.</span></span>}
        </label>
      )}
      {phase === 'error' && <div className="form-error" role="alert"><Icon name="info" size="sm" />{err}</div>}
      {phase === 'ready' && picked && (
        <div className="dpick-ready">
          <div className="dpick-thumb">{preview && <img src={preview} alt="Drawing preview" />}</div>
          <div className="col grow" style={{ gap: 6, minWidth: 0 }}>
            <b className="dpick-name" title={picked.fileName}>{picked.fileName}</b>
            <span className="faint small">{picked.width.toLocaleString()} × {picked.height.toLocaleString()} px{picked.pages ? ` · page ${picked.page} of ${picked.pages}` : ''}</span>
            <div className="row wrap" style={{ gap: 6, marginTop: 2 }}>
              {picked.pages && picked.pages > 1 && (
                <span className="pager" role="group" aria-label="PDF page">
                  <button type="button" className="tool sm" disabled={picked.page! <= 1} onClick={() => void renderPage(picked.page! - 1)} aria-label="Previous page"><Icon name="back" size="sm" /></button>
                  <select value={picked.page!} onChange={e => void renderPage(Number(e.target.value))} aria-label="Page">
                    {Array.from({ length: picked.pages }, (_, i) => <option key={i} value={i + 1}>Page {i + 1}</option>)}
                  </select>
                  <button type="button" className="tool sm" disabled={picked.page! >= picked.pages} onClick={() => void renderPage(picked.page! + 1)} aria-label="Next page"><Icon name="chevron" size="sm" /></button>
                </span>
              )}
              <button type="button" className="btn btn-outline sm" onClick={() => input.current?.click()}>Choose another file</button>
              <input ref={input} type="file" accept={ACCEPT} hidden onChange={e => { void take(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
