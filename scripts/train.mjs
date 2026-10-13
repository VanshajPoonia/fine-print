// Trains the 14 flag heads that ship in data/heads.json.
//
//   npm run train              EmbeddingGemma (what ships)
//   MODEL=bge npm run train    bge-small, for comparison (writes data/heads-bge.json)
//
// 1. The 350 "fit" contracts: every flagged clause, plus 10% of the ordinary ones.
// 2. One logistic-regression head per flag learns from the lawyers' highlights.
// 3. Each head's threshold is chosen on the 58 "val" contracts: every flagged clause, plus
//    30% of the ordinary ones, weighted so the false-alarm count is what the full set gives.
// The 102 test contracts are never touched here.

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { contracts, pieces, embedCached } from './data.mjs';
import { index, bestThreshold } from './measure.mjs';
import { fit, predict } from './linear.mjs';
import { MODELS } from '../src/embed.js';
import { FLAGS } from '../src/flags.js';

const round = (x) => Number(x.toPrecision(4));

// Ordinary clauses (no flag) vastly outnumber flagged ones. Fitting learns enough from 10%
// of them; thresholds are chosen on 30%, each one counted as 1/0.3 of a clause so false
// alarms still weigh what they would on the full set.
export const FIT_NEGATIVES = 0.1;
export const VAL_NEGATIVES = 0.3;

export async function trainHeads(key, embed) {
  const fitP = pieces(contracts('fit'), { keepNegatives: FIT_NEGATIVES });
  const valList = contracts('val');
  const valP = pieces(valList, { keepNegatives: VAL_NEGATIVES });
  const X = await embedCached('fit', key, fitP.map((p) => p.text), embed);
  const V = await embedCached('val', key, valP.map((p) => p.text), embed);

  const t0 = Date.now();
  const Y = fitP.map((p) => FLAGS.map((f) => (p.labels.includes(f.id) ? 1 : 0)));
  const { W, b } = fit(X, Y);

  const ix = index(valList, valP);
  const flags = {};
  FLAGS.forEach((f, j) => {
    const w = Array.from(W[j], round);
    const probs = V.map((v) => predict(w, b[j], v));
    flags[f.id] = { t: bestThreshold(ix, f.id, valP, probs), b: round(b[j]), w };
  });
  console.log(`  heads fitted on ${fitP.length} clauses, thresholds chosen on ${valP.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  const m = MODELS[key];
  return { model: m.id, dtype: m.dtype, prefix: m.prefix, data: 'CUAD v1 (CC BY 4.0), official train split', flags };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tf = await import('@huggingface/transformers');
  const { embedder } = await import('../src/embed.js');
  const key = process.env.MODEL || 'gemma';
  const heads = await trainHeads(key, await embedder(tf, key));
  const out = key === 'gemma' ? 'heads.json' : `heads-${key}.json`;
  writeFileSync(new URL(`../data/${out}`, import.meta.url), JSON.stringify(heads));
  console.log(`wrote data/${out}`);
}
