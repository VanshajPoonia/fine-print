// Reads a picture of contract text with Tesseract through src/ocr.js, the code the app runs
// on scanned pages. The picture is drawn here, double-spaced, from text we know.
// The first run downloads Tesseract's English model (3 MB) into tests/.cache/tesseract.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { reader, TESSERACT } from '../src/ocr.js';
import { segment } from '../src/segment.js';
import { withRules } from '../src/scan.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`);
};

const LINES = [
  '5.2 The Client may terminate this Agreement at any time on seven (7) days\' written notice.',
  'On termination, the Client will pay only for Deliverables it has accepted in writing.',
  '4.1 For twelve (12) months after its termination, the Developer shall not provide',
  'software development services to any business that offers a fitness app, anywhere in the world.',
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1700" height="${120 + LINES.length * 60}">
  <rect width="100%" height="100%" fill="#fff"/>
  ${LINES.map((l, i) => `<text x="60" y="${100 + i * 60}" font-family="Times New Roman, Times, serif" font-size="30" fill="#111">${esc(l)}</text>`).join('\n  ')}
</svg>`;
const image = await sharp(Buffer.from(svg)).greyscale().png().toBuffer();

const cachePath = fileURLToPath(new URL('./.cache/tesseract/', import.meta.url));
mkdirSync(cachePath, { recursive: true });
const loads = [];
const { read, stop } = await reader(Tesseract, { langPath: TESSERACT.langPath, cachePath }, (p) => loads.push(p));
const progress = [];
const text = await read(image, (p) => progress.push(p));
await stop();

const words = (s) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const want = words(LINES.join(' '));
const got = new Set(words(text));
const missing = want.filter((w) => !got.has(w));
check('Tesseract reads the drawn contract lines, word for word', missing.length <= 1, `missing: ${missing.join(', ')}\n      read: ${text}`);
check('it reports progress while it reads the page', progress.length > 0 && progress.at(-1) === 1, JSON.stringify(progress));
const flags = new Set(withRules(text, segment(text), [], { crossBorder: true }).map((h) => h.flag));
check('the cross-border checks find the same clauses in the text it read', flags.has('killfee') && flags.has('scope'), `${[...flags].join(', ')}\n      read: ${text}`);

console.log(failed ? `\n${failed} FAILED` : '\nall OCR checks pass');
process.exit(failed ? 1 : 0);
