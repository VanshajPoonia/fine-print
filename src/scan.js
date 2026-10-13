// Contract text -> flagged clauses. Runs in the browser; the same functions are what the
// test suite measures (with vectors from the same model, prompt and quantisation).

import { segment } from './segment.js';
import { FLAGS, LEVELS } from './flags.js';
import { RULES } from './rules.js';

export function predict(w, b, x) {
  let z = b;
  for (let t = 0; t < x.length; t++) z += w[t] * x[t];
  return 1 / (1 + Math.exp(-z));
}

/** Which flags each clause's vector trips, given the trained heads. */
export function hitsFor(vecs, heads) {
  const hits = [];
  vecs.forEach((v, i) => {
    for (const f of FLAGS) {
      const h = heads.flags[f.id];
      if (!h) continue;
      const p = predict(h.w, h.b, v);
      // `sure` is how far past its threshold the clause is, 0 to 1. Shown as "strong" or
      // "possible" in the app, so a borderline match reads as one.
      if (p >= h.t) hits.push({ seg: i, flag: f.id, p, sure: (p - h.t) / (1 - h.t) });
    }
  });
  return hits;
}

/** Rule matches, attached to the clause they fall in. */
export function ruleHits(text, segs) {
  const out = [];
  for (const r of RULES) {
    for (const m of r.find(text)) {
      const i = segs.findIndex((s) => m.start < s.end && m.end > s.start);
      if (i !== -1 && !out.some((h) => h.seg === i && h.flag === r.id)) out.push({ seg: i, flag: r.id, rule: true, note: m.note });
    }
  }
  return out;
}

/**
 * @param {string} text
 * @param {(texts:string[], onBatch?:(n:number)=>void)=>Promise<Float32Array[]>} embed
 */
export async function scan(text, embed, heads, onProgress) {
  const segs = segment(text);
  const vecs = await embed(segs.map((s) => s.text), (n) => onProgress?.(n / segs.length));
  return { segs, hits: [...hitsFor(vecs, heads), ...ruleHits(text, segs)] };
}

export const levelOrder = (level) => LEVELS[level].order;
