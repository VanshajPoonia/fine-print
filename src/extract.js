// PDF, DOCX or plain text -> one string, all in the browser. The two parsers are loaded
// only when a file of that type is dropped in.

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const MAMMOTH = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';

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
  return pages.join('\n\n');
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

export async function fileToText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return pdfText(await file.arrayBuffer());
  if (name.endsWith('.docx')) return docxText(await file.arrayBuffer());
  if (name.endsWith('.doc')) throw new Error('Old .doc files cannot be read here. Save it as .docx or PDF and try again.');
  return file.text();
}
