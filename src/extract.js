// PDF, DOCX or plain text -> one string, all in the browser. The two parsers are loaded
// only when a file of that type is dropped in.

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const MAMMOTH = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';

/** Page numbers (from 1) with almost no text: pictures of pages, as in a scan. */
export const scannedPages = (pages) => pages.flatMap((t, i) => (t.replace(/\s+/g, '').length < 20 ? [i + 1] : []));

async function pdfText(buf) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    let s = '';
    let lastY = null;
    for (const it of items) {
      const y = it.transform?.[5];
      // A big jump down the page is a new paragraph; a small one is a wrapped line.
      if (lastY !== null && y !== undefined && lastY - y > 20) s += '\n';
      s += it.str + (it.hasEOL ? '\n' : '');
      if (y !== undefined) lastY = y;
    }
    pages.push(s);
  }
  return { text: pages.join('\n\n'), pages: pages.length, pageTexts: pages, scanned: scannedPages(pages) };
}

/** Draws the given PDF pages (numbered from 1) at 200 dpi, the resolution scripts/ocr.mjs measured. */
export async function* pdfPages(buf, numbers) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  for (const n of numbers) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 200 / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    yield { n, canvas };
  }
}

/** A page picture (a data URL, as the extension sends them), scaled up to about 200 dpi if smaller. */
export async function imagePage(src, n) {
  const bmp = await createImageBitmap(await (await fetch(src)).blob());
  const scale = Math.max(1, 1700 / bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { n, canvas };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(el);
  });
}

async function docxText(buf) {
  if (!window.mammoth) await loadScript(MAMMOTH);
  const { value } = await window.mammoth.extractRawText({ arrayBuffer: buf });
  return value;
}

/** @returns {Promise<{text: string, pages?: number, pageTexts?: string[], scanned?: number[]}>} */
export async function fileToText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return pdfText(await file.arrayBuffer());
  if (name.endsWith('.docx')) return { text: await docxText(await file.arrayBuffer()) };
  if (name.endsWith('.doc')) throw new Error('Old .doc files cannot be read here. Save it as .docx or PDF and try again.');
  return { text: await file.text() };
}
