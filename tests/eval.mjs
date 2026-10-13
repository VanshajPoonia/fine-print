// Runs the real model over CUAD's 102 held-out contracts and reproduces the README's table.
//
//   npm test                 EmbeddingGemma, q4 (what ships)
//   MODEL=bge npm test       bge-small, for comparison
//
// Three ways of finding the 14 kinds of clause, all scored the same way (scripts/measure.mjs):
//   1. Ctrl+F: hand-written keyword patterns, no model at all.
//   2. Zero-shot: how close each clause's embedding is to a one-sentence description of the
//      flag. Thresholds chosen on the validation contracts.
//   3. Trained heads (what ships): a logistic regression per flag, fitted on the lawyers'
//      highlights in 350 contracts, thresholds chosen on 58 others.
// The heads are re-fitted here from the cached embeddings, and checked against
// data/heads.json, so the shipped weights are provably the ones this process produces.

import { readFileSync, existsSync } from 'node:fs';
import * as tf from '@huggingface/transformers';
import { contracts, pieces, embedCached } from '../scripts/data.mjs';
import { index, score, bestThreshold, total, f1 } from '../scripts/measure.mjs';
import { trainHeads, VAL_NEGATIVES } from '../scripts/train.mjs';
import { embedder, MODELS } from '../src/embed.js';
import { FLAGS } from '../src/flags.js';
import { predict } from '../src/scan.js';

const KEY = process.env.MODEL || 'gemma';
const m = MODELS[KEY];
console.log(`model: ${m.id} (${m.dtype})\n`);

const testList = contracts('test');
const testP = pieces(testList);
const valList = contracts('val');
const valP = pieces(valList, { keepNegatives: VAL_NEGATIVES });
console.log(`${testList.length} test contracts, ${testP.length} clauses, ${testP.filter((p) => p.labels.length).length} of them highlighted by lawyers under one of the 14 flags\n`);

const embed = await embedder(tf, KEY);
const T = await embedCached('test', KEY, testP.map((p) => p.text), embed);
const V = await embedCached('val', KEY, valP.map((p) => p.text), embed);
const heads = await trainHeads(KEY, embed);

const shippedFile = new URL(`../data/${KEY === 'gemma' ? 'heads.json' : `heads-${KEY}.json`}`, import.meta.url);
if (existsSync(shippedFile)) {
  const shipped = JSON.parse(readFileSync(shippedFile));
  const same = FLAGS.every((f) => shipped.flags[f.id].t === heads.flags[f.id].t && shipped.flags[f.id].w.every((x, i) => x === heads.flags[f.id].w[i]));
  console.log(same ? '  data/heads.json matches the heads trained here\n' : '  WARNING: data/heads.json differs from the heads trained here (run npm run train)\n');
}

const ixT = index(testList, testP);
const ixV = index(valList, valP);

// 1. Ctrl+F. Written from what each kind of clause usually says, before looking at the test set.
const KEYWORDS = {
  ip: /\bassign(?:s|ment)?\b[^.]{0,80}\b(?:right,? title and interest|intellectual property)|\bworks? made for hire\b/i,
  noncompete: /\bnon-?compet|\bnot\b[^.]{0,40}\bcompete\b|\bcompeting (?:business|product)/i,
  exclusive: /\bexclusive(?:ly)?\b/i,
  uncapped: /\bunlimited liability\b|\bliability\b[^.]{0,60}\bshall not be (?:limited|subject to)/i,
  nosue: /\bcovenant not to sue\b|\bnot\b[^.]{0,30}\b(?:challenge|contest)\b/i,
  walkaway: /\bterminat\w*\b[^.]{0,60}\b(?:for convenience|for any reason|without cause|at any time)\b/i,
  penalty: /\bliquidated damages\b|\bpenalt(?:y|ies)\b/i,
  nosolicit: /\bsolicit\b|\bhire\b[^.]{0,40}\bemployees?\b/i,
  renewal: /\b(?:automatic(?:ally)?|successive)\b[^.]{0,40}\brenew|\brenew\w*\b[^.]{0,40}\b(?:automatic(?:ally)?|successive)\b/i,
  gag: /\bdisparag/i,
  insurance: /\binsurance\b/i,
  audit: /\baudit/i,
  cap: /\b(?:aggregate|total|maximum|cumulative) liability\b|\bin no event shall\b[^.]{0,80}\bliability\b[^.]{0,40}\bexceed/i,
  law: /\bgoverned by\b|\bgoverning law\b|\bconstrued in accordance with the laws\b/i,
};

// 2. Zero-shot.
const descs = await embed(FLAGS.map((f) => f.describe));
const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

const rows = { keywords: [], zeroshot: [], heads: [] };
const examples = {};
for (const [j, f] of FLAGS.entries()) {
  rows.keywords.push(score(ixT, f.id, testP, (i) => KEYWORDS[f.id].test(testP[i].text)));

  const zt = bestThreshold(ixV, f.id, valP, V.map((v) => cos(v, descs[j])));
  rows.zeroshot.push(score(ixT, f.id, testP, (i) => cos(T[i], descs[j]) >= zt));

  const h = heads.flags[f.id];
  const probs = T.map((v) => predict(h.w, h.b, v));
  const hit = (i) => probs[i] >= h.t;
  rows.heads.push(score(ixT, f.id, testP, hit));

  // Keep a few real misses and false alarms to read (the write-up quotes from these).
  const misses = ixT[f.id].spans.filter((s) => !s.pieces.some(hit)).slice(0, 2)
    .map((s) => (s.pieces[0] !== undefined ? testP[s.pieces[0]].text : '(highlight spans two clauses)'));
  const alarms = testP.map((p, i) => i).filter((i) => hit(i) && !testP[i].labels.includes(f.id))
    .sort((a, b) => probs[b] - probs[a]).slice(0, 2).map((i) => `${probs[i].toFixed(2)}  ${testP[i].text}`);
  examples[f.id] = { misses, alarms };
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const line = (name, r) => console.log(
  `${name.padEnd(26)} clauses found ${String(r.found).padStart(4)}/${r.spans} (${pct(r.found, r.spans).padStart(4)})   ` +
  `flags right ${pct(r.right, r.flagged).padStart(4)}   false alarms per contract ${((r.flagged - r.right) / r.contracts).toFixed(1).padStart(5)}   ` +
  `contracts: found ${pct(r.bothContracts, r.lawyerContracts).padStart(4)}, right ${pct(r.bothContracts, r.flaggedContracts).padStart(4)}   F1 ${f1(r).toFixed(2)}`,
);

console.log('\nper flag, trained heads:');
FLAGS.forEach((f, j) => line(`  ${f.id}`, rows.heads[j]));

console.log('\nall 14 flags together:');
const all = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, total(v)]));
line('Ctrl+F keywords', all.keywords);
line('zero-shot similarity', all.zeroshot);
line('trained heads (shipped)', all.heads);

console.log('\nsome misses and false alarms (trained heads):');
for (const f of FLAGS) {
  for (const t of examples[f.id].misses) console.log(`  MISSED ${f.id}: ${t.slice(0, 220)}`);
  for (const t of examples[f.id].alarms) console.log(`  EXTRA  ${f.id}: ${t.slice(0, 220)}`);
}

const pass = f1(all.heads) > f1(all.keywords) && f1(all.heads) > f1(all.zeroshot);
console.log(pass ? '\nPASS (trained heads beat both baselines)' : '\nFAIL');
process.exit(pass ? 0 : 1);
