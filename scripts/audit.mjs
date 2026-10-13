// Prints a random, reproducible sample of the shipped model's "false alarms" on the test set:
// clauses it flagged that the lawyers did not highlight under that flag. Each one is shown
// with the flag's definition, so a reader can judge for themselves whether it really is one.
//
//   node scripts/audit.mjs [how many, default 40]
//
// Used for the write-up: CUAD's annotators often highlight one instance of a clause type per
// contract, so some "false alarms" are real clauses of that kind. This does not change any
// number in tests/eval.mjs, which counts every one of them as wrong.

import { readFileSync } from 'node:fs';
import * as tf from '@huggingface/transformers';
import { contracts, pieces, embedCached } from './data.mjs';
import { embedder } from '../src/embed.js';
import { BY_ID } from '../src/flags.js';
import { hitsFor } from '../src/scan.js';

const N = Number(process.argv[2] || 40);
const heads = JSON.parse(readFileSync(new URL('../data/heads.json', import.meta.url)));
const testP = pieces(contracts('test'));
const T = await embedCached('test', 'gemma', testP.map((p) => p.text), await embedder(tf, 'gemma'));

const alarms = hitsFor(T, heads).filter((h) => !testP[h.seg].labels.includes(h.flag));
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let i = alarms.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [alarms[i], alarms[j]] = [alarms[j], alarms[i]]; }

console.log(`${alarms.length} false alarms in total; ${Math.min(N, alarms.length)} at random:\n`);
alarms.slice(0, N).forEach((h, k) => {
  const p = testP[h.seg];
  console.log(`#${k + 1}  [${h.flag}] ${BY_ID[h.flag].title}   (also highlighted by lawyers as: ${p.labels.join(', ') || 'nothing'})`);
  console.log(`    ${p.text.slice(0, 400)}\n`);
});
