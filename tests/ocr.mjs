// Reads pictures of contract text with Tesseract through src/ocr.js, the code the app runs on
// scanned pages. The pictures are drawn here from text we know: a few double-spaced lines, and
// the whole cross-border sample as a single-spaced page, whose cards must match the clean text's.
// The first run downloads Tesseract's English model (3 MB) into tests/.cache/tesseract.

import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { reader, TESSERACT } from '../src/ocr.js';
import { segment } from '../src/segment.js';
import { withRules } from '../src/scan.js';
import { cardTitles, wrap } from './cards.mjs';

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
const draw = (lines, size, step) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1700" height="${120 + lines.length * step}">
  <rect width="100%" height="100%" fill="#fff"/>
  ${lines.map((l, i) => `<text x="60" y="${80 + i * step}" font-family="Times New Roman, Times, serif" font-size="${size}" fill="#111">${esc(l)}</text>`).join('\n  ')}
</svg>`)).greyscale().png().toBuffer();
const image = await draw(LINES, 30, 60);

const cachePath = fileURLToPath(new URL('./.cache/tesseract/', import.meta.url));
mkdirSync(cachePath, { recursive: true });
const loads = [];
const { read, stop } = await reader(Tesseract, { langPath: TESSERACT.langPath, cachePath }, (p) => loads.push(p));
const progress = [];
const text = await read(image, (p) => progress.push(p));
const sample = readFileSync(new URL('../data/samples/crossborder.txt', import.meta.url), 'utf8');
const page = await read(await draw(wrap(sample, 100).split('\n'), 26, 34));
await stop();

const words = (s) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const want = words(LINES.join(' '));
const got = new Set(words(text));
const missing = want.filter((w) => !got.has(w));
check('Tesseract reads the drawn contract lines, word for word', missing.length <= 1, `missing: ${missing.join(', ')}\n      read: ${text}`);
check('it reports progress while it reads the page', progress.length > 0 && progress.at(-1) === 1, JSON.stringify(progress));
const flags = new Set(withRules(text, segment(text), [], { crossBorder: true }).map((h) => h.flag));
check('the cross-border checks find the same clauses in the text it read', flags.has('killfee') && flags.has('scope'), `${[...flags].join(', ')}\n      read: ${text}`);
const clean = cardTitles(sample), scanned = cardTitles(page);
check('a page of the cross-border sample gives the same cards as its clean text, details included', JSON.stringify(clean) === JSON.stringify(scanned), `clean:   ${clean.join(' | ')}\n      scanned: ${scanned.join(' | ')}`);

console.log(failed ? `\n${failed} FAILED` : '\nall OCR checks pass');
process.exit(failed ? 1 : 0);
