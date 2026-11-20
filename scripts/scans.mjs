// Makes scanned-looking test pages from contracts whose text we know, for scripts/ocr.mjs.
//
//   node scripts/scans.mjs
//
// Each contract is typeset into a PDF (Times, 11 pt, US Letter), rendered to 200 dpi
// greyscale with poppler's pdftoppm, then made to look scanned in two ways: "scan" (slight
// tilt and blur, like a flatbed) and "photo" (more tilt, noise, lower resolution and heavy
// JPEG, like a phone picture). The page images and an image-only PDF of each go into
// tests/.cache/scans/, with the true text of every page next to them.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = new URL('../tests/.cache/scans/', import.meta.url);
const ROOT = new URL('../', import.meta.url);

const DOCS = {
  freelance: readFileSync(new URL('data/samples/freelance.txt', ROOT), 'utf8'),
  crossborder: readFileSync(new URL('data/samples/crossborder.txt', ROOT), 'utf8'),
  fair: readFileSync(new URL('tests/fixtures/fair.txt', ROOT), 'utf8'),
  // A real contract from CUAD's held-out set: the first 9,000 characters, cut at a sentence.
  cuad: (() => { const t = JSON.parse(readFileSync(new URL('data/samples/cuad.json', ROOT))).text; return t.slice(0, t.indexOf('. ', 9000) + 1); })(),
};

// Rough Times-Roman widths in thousandths of an em, close enough to wrap lines.
const width = (s) => [...s].reduce((w, c) => w + (c === ' ' ? 250 : /[ijlt.,;:'!|]/.test(c) ? 278 : /[frI()\-"]/.test(c) ? 333 : /[mwMW]/.test(c) ? 800 : /[A-Z]/.test(c) ? 690 : 480), 0);
const ascii = (s) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7e\n]/g, ' ');

const PAGE = { w: 612, h: 792, margin: 72, size: 11, lead: 14 };

/** Splits text into pages of wrapped lines. */
function layout(text) {
  const max = (PAGE.w - 2 * PAGE.margin) * 1000 / PAGE.size * 0.97;
  const lines = [];
  for (const para of ascii(text).split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (width(next) > max && cur) { lines.push(cur); cur = word; } else cur = next;
    }
    lines.push(cur);
  }
  const per = Math.floor((PAGE.h - 2 * PAGE.margin) / PAGE.lead);
  const pages = [];
  for (let i = 0; i < lines.length; i += per) pages.push(lines.slice(i, i + per));
  return pages.filter((p) => p.some((l) => l.trim()));
}

/** A minimal PDF: text pages in Times-Roman, or one JPEG per page. */
function pdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  for (const p of pages) {
    let stream, res;
    if (p.jpeg) {
      objs.push({ dict: `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode`, data: p.jpeg });
      res = `<< /XObject << /Im0 ${objs.length} 0 R >> >>`;
      stream = `q ${PAGE.w} 0 0 ${PAGE.h} 0 0 cm /Im0 Do Q`;
    } else {
      res = '<< /Font << /F1 3 0 R >> >>';
      const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
      stream = `BT /F1 ${PAGE.size} Tf ${PAGE.lead} TL ${PAGE.margin} ${PAGE.h - PAGE.margin} Td ${p.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
    }
    objs.push({ dict: '<<', data: Buffer.from(stream, 'latin1') });
    const content = objs.length;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources ${res} /Contents ${content} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    const body = typeof o === 'string'
      ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')
      : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.dict} /Length ${o.data.length} >>\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    offsets.push(pos);
    parts.push(body);
    pos += body.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  return Buffer.concat([...parts, Buffer.from(xref, 'latin1')]);
}

// A fixed seed, so every run makes the same pages.
let seed = 11;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

async function degrade(png, kind) {
  const img = sharp(png).greyscale();
  const { width: w, height: h } = await img.metadata();
  const angle = (kind === 'photo' ? 1.2 : 0.4) * (rand() < 0.5 ? -1 : 1);
  const scale = kind === 'photo' ? 0.75 : 1;
  let raw = await img.rotate(angle, { background: '#ffffff' }).resize(Math.round(w * scale)).blur(kind === 'photo' ? 0.9 : 0.5).raw().toBuffer({ resolveWithObject: true });
  if (kind === 'photo') {
    // Grain, and a little uneven light across the page.
    const { data, info } = raw;
    for (let i = 0; i < data.length; i++) {
      const x = i % info.width;
      data[i] = Math.max(0, Math.min(255, data[i] - 18 * (x / info.width) + (rand() - 0.5) * 50));
    }
    raw = { data, info };
  }
  const { data, info } = raw;
  const jpeg = await sharp(data, { raw: info }).jpeg({ quality: kind === 'photo' ? 45 : 80 }).toBuffer();
  return { jpeg, width: info.width, height: info.height };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const truth = {};
for (const [name, text] of Object.entries(DOCS)) {
  const pages = layout(text);
  const file = fileURLToPath(new URL(`${name}.pdf`, OUT));
  writeFileSync(file, pdf(pages));
  execFileSync('pdftoppm', ['-r', '200', '-gray', '-png', file, fileURLToPath(new URL(`${name}-p`, OUT))]);
  const pngs = readdirSync(OUT).filter((f) => f.startsWith(`${name}-p`) && f.endsWith('.png')).sort();
  for (const kind of ['scan', 'photo']) {
    const imgs = [];
    for (const [i, f] of pngs.entries()) {
      const d = await degrade(readFileSync(new URL(f, OUT)), kind);
      writeFileSync(new URL(`${name}-${kind}-${i + 1}.jpg`, OUT), d.jpeg);
      imgs.push(d);
    }
    writeFileSync(new URL(`${name}-${kind}.pdf`, OUT), pdf(imgs));
  }
  pngs.forEach((f) => rmSync(new URL(f, OUT)));
  truth[name] = pages.map((p) => p.join('\n'));
  console.log(`${name}: ${pages.length} pages`);
}
writeFileSync(new URL('truth.json', OUT), JSON.stringify(truth));
console.log(`wrote ${fileURLToPath(OUT)}`);
