// Browsers without WebGPU run a different build of EmbeddingGemma (see src/embed.js). This
// checks how often it makes the same call as the build the tests measure, on test clauses:
// every clause the lawyers highlighted under one of our flags, plus 2,000 others at random.
//
//   node scripts/fallback.mjs

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as tf from '@huggingface/transformers';
import { contracts, pieces, embedCached } from './data.mjs';
import { embedder } from '../src/embed.js';
import { hitsFor } from '../src/scan.js';

const heads = JSON.parse(readFileSync(new URL('../data/heads.json', import.meta.url)));
const all = pieces(contracts('test'));
const T = await embedCached('test', 'gemma', all.map((p) => p.text), null);

const rank = (i) => createHash('sha1').update(`fallback#${i}`).digest().readUInt32BE(0);
const others = all.map((p, i) => i).filter((i) => !all[i].labels.length).sort((a, b) => rank(a) - rank(b)).slice(0, 2000);
const sample = [...all.map((p, i) => i).filter((i) => all[i].labels.length), ...others];

const t0 = Date.now();
const embed = await embedder(tf, 'gemma', { file: 'model_no_gather' });
const N = await embed(sample.map((i) => all[i].text));
console.log(`embedded ${sample.length} clauses with the no-gather build in ${((Date.now() - t0) / 60000).toFixed(1)} min`);

const key = (h) => `${h.seg}:${h.flag}`;
const a = new Set(hitsFor(sample.map((i) => T[i]), heads).map(key));
const b = new Set(hitsFor(N, heads).map(key));
let cos = 0;
sample.forEach((i, k) => { let s = 0; for (let d = 0; d < T[i].length; d++) s += T[i][d] * N[k][d]; cos += s; });
const decisions = sample.length * Object.keys(heads.flags).length;
const differ = [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;
const clauses = new Set([...a, ...b].filter((x) => a.has(x) !== b.has(x)).map((x) => x.split(':')[0])).size;

console.log(`mean cosine between the two builds' vectors: ${(cos / sample.length).toFixed(4)}`);
console.log(`flags raised: ${a.size} by the measured build, ${b.size} by the fallback`);
console.log(`decisions that differ: ${differ} of ${decisions} (${((100 * differ) / decisions).toFixed(2)}%), on ${clauses} of ${sample.length} clauses`);
