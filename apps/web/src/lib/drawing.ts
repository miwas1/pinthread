// Turn a dropped drawing (PDF, PNG, JPG, WebP) into an image the server stores, plus a small thumbnail.
// PDFs are rendered in the browser with pdf.js, one page per sheet.

export interface PreparedDrawing { full: Blob; thumb: Blob; width: number; height: number }

const MAX_LONG_SIDE = 6000;
const MAX_PIXELS = 16_000_000; // stays inside every browser's canvas limit (iOS Safari: 16.7 MP)
const MAX_UPLOAD = 24 * 1024 * 1024;

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const ACCEPT = '.pdf,application/pdf,image/png,image/jpeg,image/webp';

async function pdfjs() {
  const lib = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  lib.GlobalWorkerOptions.workerSrc = worker;
  return lib;
}

export interface PdfHandle { pages: number; render(page: number): Promise<HTMLCanvasElement>; destroy(): void }

export async function openPdf(file: File): Promise<PdfHandle> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  return {
    pages: doc.numPages,
    async render(n: number) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const k = Math.min(MAX_LONG_SIDE / Math.max(base.width, base.height), Math.sqrt(MAX_PIXELS / (base.width * base.height)));
      const viewport = page.getViewport({ scale: k });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      return canvas;
    },
    destroy() { void doc.destroy(); },
  };
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not encode the drawing.'))), type, q));

function scaled(src: CanvasImageSource, w: number, h: number, long: number) {
  const k = Math.min(1, long / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Encode a rendered canvas: PNG keeps linework crisp; fall back to JPEG if it is too big. */
export async function fromCanvas(canvas: HTMLCanvasElement): Promise<PreparedDrawing> {
  let full = await toBlob(canvas, 'image/png');
  if (full.size > MAX_UPLOAD) full = await toBlob(canvas, 'image/jpeg', 0.9);
  if (full.size > MAX_UPLOAD) throw new Error('This page is too detailed to upload. Try exporting it at a lower resolution.');
  const thumb = await toBlob(scaled(canvas, canvas.width, canvas.height, 720), 'image/jpeg', 0.82);
  return { full, thumb, width: canvas.width, height: canvas.height };
}

export async function fromImage(file: File): Promise<PreparedDrawing> {
  const bmp = await createImageBitmap(file).catch(() => { throw new Error("That image couldn't be read. Upload a PDF, PNG or JPG."); });
  const { width, height } = bmp;
  const thumb = await toBlob(scaled(bmp, width, height, 720), 'image/jpeg', 0.82);
  const tooBig = Math.max(width, height) > MAX_LONG_SIDE * 1.5 || width * height > MAX_PIXELS * 1.5;
  if ((file.type === 'image/png' || file.type === 'image/jpeg') && file.size <= MAX_UPLOAD && !tooBig) {
    return { full: file, thumb, width, height };
  }
  const k = Math.min(1, MAX_LONG_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  return fromCanvas(scaled(bmp, width, height, Math.max(width, height) * k));
}

/** Suggest sheet number and title from a file name like "A-101 Level 03 Plan.pdf". */
export function guessSheet(name: string): { number: string; title: string } {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
  const m = base.match(/^([A-Z]{1,3}[-\s.]?\d{2,4}(?:\.\d+)?)\s*[-–—]?\s*(.*)$/i);
  if (m) return { number: m[1].toUpperCase().replace(/\s/, '-'), title: m[2] || 'Plan' };
  return { number: '', title: base.slice(0, 80) };
}
