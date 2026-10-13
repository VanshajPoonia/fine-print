// CUAD in, labelled clauses out. Used by scripts/train.mjs and tests/eval.mjs.
//
// CUAD (Contract Understanding Atticus Dataset, CC BY 4.0) is 510 real commercial contracts
// from SEC filings, with every clause in 41 categories highlighted by lawyers and law students.
// We use its official split: 408 contracts to learn from, 102 held out for testing.
// The 408 are split once more, by a hash of the title, into contracts the classifier is
// fitted on and contracts its thresholds are chosen on. The 102 are only ever used to test.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { segment, matches } from '../src/segment.js';
import { FLAGS } from '../src/flags.js';
import { MODELS } from '../src/embed.js';

export const CACHE = new URL('../tests/.cache/', import.meta.url);
const DIR = new URL('cuad/', CACHE);
const ZIP = 'https://github.com/TheAtticusProject/cuad/raw/main/data.zip';

export function fetchCuad() {
  if (existsSync(new URL('test.json', DIR))) return;
  mkdirSync(DIR, { recursive: true });
  const zip = new URL('cuad-data.zip', CACHE).pathname;
  console.log('downloading CUAD (18 MB) ...');
  execFileSync('curl', ['-sL', '--retry', '5', '-C', '-', '-o', zip, ZIP], { stdio: 'inherit' });
  execFileSync('unzip', ['-o', '-q', zip, '-d', DIR.pathname]);
}

const hash = (s) => createHash('sha1').update(s).digest().readUInt32BE(0);

/** @returns {{title:string, text:string, spans:Record<string,{start:number,end:number}[]>}[]} */
export function contracts(split) {
  fetchCuad();
  const file = split === 'test' ? 'test.json' : 'train_separate_questions.json';
  const data = JSON.parse(readFileSync(new URL(file, DIR)));
  let list = data.data.map((c) => {
    const p = c.paragraphs[0];
    const spans = {};
    for (const q of p.qas) {
      const cat = q.question.match(/related to "(.+?)"/)[1];
      for (const a of q.answers) (spans[cat] ??= []).push({ start: a.answer_start, end: a.answer_start + a.text.length });
    }
    return { title: c.title, text: p.context, spans };
  });
  if (split === 'fit') list = list.filter((c) => hash(c.title) % 7 !== 0);
  if (split === 'val') list = list.filter((c) => hash(c.title) % 7 === 0);
  return list;
}

/** Lawyer highlights for one of our flags (some flags merge two CUAD categories). */
export const spansFor = (contract, flag) => flag.cuad.flatMap((cat) => contract.spans[cat] ?? []);

/**
 * Every clause of every contract, with the flags the lawyers' highlights give it.
 * `keepNegatives` < 1 keeps only that share of the clauses that carry no flag at all. Used
 * for fitting and for choosing thresholds, never for the test set, which is always complete.
 */
export function pieces(list, { keepNegatives = 1 } = {}) {
  const out = [];
  for (const c of list) {
    segment(c.text).forEach((seg, i) => {
      const labels = FLAGS.filter((f) => spansFor(c, f).some((s) => matches(seg, s))).map((f) => f.id);
      if (!labels.length && keepNegatives < 1 && (hash(`${c.title}#${i}`) % 1000) / 1000 >= keepNegatives) return;
      // `w`: how many clauses this one stands for, so a sample still counts false alarms fairly.
      out.push({ contract: c.title, start: seg.start, end: seg.end, text: seg.text, labels, w: labels.length ? 1 : 1 / keepNegatives });
    });
  }
  return out;
}

/** Embeds `texts` once per model and keeps the result in tests/.cache. */
export async function embedCached(name, key, texts, embed) {
  const m = MODELS[key];
  const tag = `${key}-${m.file ?? 'model'}-${m.dtype}`; // vectors from another build of the model never match
  const file = new URL(`emb-${tag}-${name}.bin`, CACHE);
  const sig = hash(texts.join('\u0000')).toString(16);
  const meta = new URL(`emb-${tag}-${name}.json`, CACHE);
  if (existsSync(file) && existsSync(meta) && JSON.parse(readFileSync(meta)).sig === sig) {
    const buf = readFileSync(file);
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const d = all.length / texts.length;
    return texts.map((_, i) => all.subarray(i * d, (i + 1) * d));
  }
  const t0 = Date.now();
  let last = 0;
  const vecs = await embed(texts, (done) => {
    if (Date.now() - last < 15000 && done < texts.length) return;
    last = Date.now();
    const rate = done / ((Date.now() - t0) / 1000);
    console.log(`  ${name}: ${done}/${texts.length} clauses, ${rate.toFixed(0)}/s, ~${Math.round((texts.length - done) / rate / 60)} min left`);
  });
  const all = new Float32Array(vecs.length * vecs[0].length);
  vecs.forEach((v, i) => all.set(v, i * v.length));
  writeFileSync(file, Buffer.from(all.buffer));
  writeFileSync(meta, JSON.stringify({ sig, n: texts.length }));
  return vecs;
}
