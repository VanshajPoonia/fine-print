// Reading pictures of pages, for scanned PDFs and the DocuSign pages the extension sends, with
// Tesseract through tesseract.js. It runs in a worker in this tab, so the pictures never leave
// it. Its files come from jsDelivr, pinned like pdf.js and mammoth; scripts/ocr.mjs measures it.

const CDN = 'https://cdn.jsdelivr.net/npm';

export const TESSERACT = {
  module: `${CDN}/tesseract.js@5.1.1/dist/tesseract.esm.min.js`,
  workerPath: `${CDN}/tesseract.js@5.1.1/dist/worker.min.js`,
  corePath: `${CDN}/tesseract.js-core@5.1.1`,
  langPath: `${CDN}/@tesseract.js-data/eng@1.0.0/4.0.0_best_int`,
  mb: 7,
};

/**
 * One English reader for many pages. `Tesseract` is the tesseract.js module: from npm in Node,
 * from jsDelivr in the browser. `onLoad` hears download progress, `read`'s `onProgress` a page's.
 */
export async function reader(Tesseract, options = {}, onLoad) {
  let report = (m) => { if (m.status?.startsWith('loading')) onLoad?.(m.progress); };
  const worker = await Tesseract.createWorker('eng', 1, { ...options, logger: (m) => report(m) });
  return {
    async read(image, onProgress) {
      report = (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress); };
      return joinLines((await worker.recognize(image)).data.text);
    },
    stop: () => worker.terminate(),
  };
}

/** Double-spaced lines come back as separate paragraphs. Join one that runs on in lower case. */
export const joinLines = (text) => text.replace(/([^.;:?!\s])[ \t]*\n\s*\n(?=[ \t]*[a-z(])/g, '$1\n');

let loading = null;

/** In the browser: tesseract.js from jsDelivr, loaded the first time someone reads a scan. */
export function loadReader(onLoad) {
  loading ??= (async () => {
    const { default: Tesseract } = await import(TESSERACT.module);
    const { workerPath, corePath, langPath } = TESSERACT;
    return reader(Tesseract, { workerPath, corePath, langPath }, onLoad);
  })().catch((err) => { loading = null; throw err; });
  return loading;
}
