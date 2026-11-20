// OCR on the scanned test pages from scripts/scans.mjs, through transformers.js.
//
//   node scripts/scans.mjs                    make the pages (once)
//   node scripts/ocr.mjs run <engine>         read them: florence, trocr or docling
//   node scripts/ocr.mjs score <engine>       score tests/.cache/scans/ocr-<engine>.json
//   PAGES=freelance-.*-1 node scripts/ocr.mjs run trocr     only pages matching a pattern (score too)
//
// Engines:
//   florence  Florence-2-base-ft, "<OCR>" on the whole page (int8, 265 MB)
//   trocr     TrOCR-small-printed (q8, 64 MB), one text line at a time: the page is deskewed
//             and cut into lines and word groups first (src/ocr.js, what the app runs)
//   docling   granite-docling-258M, the whole page in tiles (about 260 MB)
//
// Scoring, per kind of scan:
//   CER     character error rate against each page's true text (edits / characters), also
//           ignoring case, since some models only write capital letters
//   flags   of the flags ClauseGuard raises on the true text, how many it still raises on
//           the OCR text, and how many new ones appear. Rules and the trained heads both count.
// Any other engine's output can be scored the same way if it is saved in that file's shape:
// { "<page>.jpg": { "text": "...", "secs": 1.2 } }.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as tf from '@huggingface/transformers';
import { segment } from '../src/segment.js';
import { embedder } from '../src/embed.js';
import { hitsFor, withRules } from '../src/scan.js';
import { readPage, reader } from '../src/ocr.js';

const DIR = new URL('../tests/.cache/scans/', import.meta.url);
const [cmd, engine] = process.argv.slice(2);
const outFile = new URL(`ocr-${engine}.json`, DIR);

// ---------- reading pages ----------------------------------------------------------------

async function engineFor(name) {
  const sharp = (await import('sharp')).default;
  if (name === 'florence') {
    const id = 'onnx-community/Florence-2-base-ft';
    const model = await tf.Florence2ForConditionalGeneration.from_pretrained(id, { dtype: { embed_tokens: 'int8', vision_encoder: 'int8', encoder_model: 'int8', decoder_model_merged: 'int8' } });
    const processor = await tf.AutoProcessor.from_pretrained(id);
    return async (file) => {
      const img = await tf.RawImage.read(file);
      const inputs = await processor(img, processor.construct_prompts('<OCR>'));
      const ids = await model.generate({ ...inputs, max_new_tokens: 1024 });
      return processor.post_process_generation(processor.batch_decode(ids, { skip_special_tokens: false })[0], '<OCR>', img.size)['<OCR>'];
    };
  }
  if (name === 'trocr') {
    const recognise = await reader(tf);
    return async (file) => {
      const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
      return readPage({ g: new Uint8Array(data), w: info.width, h: info.height }, recognise);
    };
  }
  if (name === 'docling') {
    const id = 'onnx-community/granite-docling-258M-ONNX';
    const processor = await tf.AutoProcessor.from_pretrained(id);
    const model = await tf.AutoModelForVision2Seq.from_pretrained(id, { dtype: { embed_tokens: 'int8', vision_encoder: 'int8', decoder_model_merged: 'q4' } });
    return async (file) => {
      const image = (await tf.RawImage.read(file)).rgb();
      const prompt = processor.apply_chat_template([{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: 'Convert this page to docling.' }] }], { add_generation_prompt: true });
      const inputs = await processor(prompt, [image], { do_image_splitting: true });
      const ids = await model.generate({ ...inputs, max_new_tokens: 2048 });
      const raw = processor.batch_decode(ids.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: false })[0];
      // DocTags: one element per block, with location tokens. Keep the words, a block per line.
      return raw.replace(/<loc_\d+>/g, '').replace(/<\/[a-z_\d]+>/g, '\n').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim();
    };
  }
  throw new Error(`unknown engine ${name}`);
}

if (cmd === 'run') {
  const read = await engineFor(engine);
  const only = new RegExp(process.env.PAGES ?? '.');
  const out = existsSync(outFile) ? JSON.parse(readFileSync(outFile)) : {};
  for (const f of readdirSync(DIR).filter((x) => /-(scan|photo)-\d+\.jpg$/.test(x) && only.test(x)).sort()) {
    const t0 = Date.now();
    out[f] = { text: await read(fileURLToPath(new URL(f, DIR))), secs: (Date.now() - t0) / 1000 };
    writeFileSync(outFile, JSON.stringify(out));
    console.log(`${f}  ${out[f].secs.toFixed(0)} s`);
  }
  process.exit(0);
}

// ---------- scoring --------------------------------------------------------------------

if (cmd !== 'score' || !existsSync(outFile)) {
  console.log('usage: node scripts/ocr.mjs run <florence|trocr|docling>, then node scripts/ocr.mjs score <engine>');
  process.exit(1);
}
const truth = JSON.parse(readFileSync(new URL('truth.json', DIR)));
const scoreOnly = new RegExp(process.env.PAGES ?? '.');
const out = Object.fromEntries(Object.entries(JSON.parse(readFileSync(outFile))).filter(([k]) => scoreOnly.test(k)));

const norm = (s) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

function edits(a, b) {
  let prev = Uint32Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

const heads = JSON.parse(readFileSync(new URL('../data/heads.json', import.meta.url)));
const embed = await embedder(tf, 'gemma');
async function flags(text) {
  const segs = segment(text);
  const model = hitsFor(await embed(segs.map((s) => s.text)), heads);
  return new Set(withRules(text, segs, model, { crossBorder: true }).map((h) => h.flag));
}

for (const kind of ['scan', 'photo']) {
  let errs = 0, errsCase = 0, chars = 0, secs = 0, pages = 0, kept = 0, wanted = 0, extra = 0;
  for (const [doc, truePages] of Object.entries(truth)) {
    const read = [];
    truePages.forEach((t, i) => {
      const page = out[`${doc}-${kind}-${i + 1}.jpg`];
      if (!page) return;
      errs += edits(norm(page.text), norm(t));
      errsCase += edits(norm(page.text).toLowerCase(), norm(t).toLowerCase());
      chars += norm(t).length;
      secs += page.secs;
      pages++;
      read.push(page.text);
    });
    // Flags are compared on whole contracts only.
    if (read.length !== truePages.length) continue;
    const want = await flags(truePages.join('\n'));
    const got = await flags(read.join('\n'));
    wanted += want.size;
    kept += [...want].filter((f) => got.has(f)).length;
    extra += [...got].filter((f) => !want.has(f)).length;
  }
  if (!pages) continue;
  const fl = wanted ? `flags kept ${kept}/${wanted}, new ${extra}` : 'flags: needs every page of a contract';
  const pc = (n) => `${((100 * n) / chars).toFixed(1).padStart(5)}%`;
  console.log(`${engine.padEnd(9)} ${kind.padEnd(5)} ${String(pages).padStart(2)} pages   CER ${pc(errs)} (ignoring case ${pc(errsCase)})   ${(secs / pages).toFixed(0).padStart(4)} s a page   ${fl}`);
}
