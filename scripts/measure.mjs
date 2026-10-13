// One way of scoring every approach, so the numbers in the README compare like with like.
//
// For each flag:
//   found        lawyer-highlighted clauses where at least one matching piece was flagged
//   flagged      pieces flagged; `right` of them match a lawyer highlight for that flag
//   contracts    does the scan say "this contract has one" when the lawyers found one?
// Overlapping highlights for the same flag are merged first (several flags merge two CUAD
// categories, and a renewal clause is often highlighted under both of them).

import { matches } from '../src/segment.js';
import { FLAGS } from '../src/flags.js';
import { spansFor } from './data.mjs';

function merged(spans) {
  const s = [...spans].sort((a, b) => a.start - b.start);
  const out = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

/**
 * Precomputes, per flag, which pieces each lawyer highlight matches, so a threshold sweep
 * is cheap. If `ps` is a sample, each piece's weight `w` says how many it stands for.
 */
export function index(list, ps) {
  const byContract = new Map();
  ps.forEach((p, i) => (byContract.get(p.contract) ?? byContract.set(p.contract, []).get(p.contract)).push(i));
  const out = {};
  for (const f of FLAGS) {
    const spans = [];
    const has = new Set();
    for (const c of list) {
      const idx = byContract.get(c.title) ?? [];
      for (const s of merged(spansFor(c, f))) {
        spans.push({ contract: c.title, pieces: idx.filter((i) => matches(ps[i], s)) });
        has.add(c.title);
      }
    }
    out[f.id] = { spans, contractsWithFlag: has, label: ps.map((p) => p.labels.includes(f.id)) };
  }
  out.contracts = list.map((c) => c.title);
  return out;
}

/** @param hit (pieceIndex) => boolean, for one flag */
export function score(ix, flagId, ps, hit) {
  const { spans, contractsWithFlag, label } = ix[flagId];
  let found = 0, flagged = 0, right = 0;
  const flaggedContracts = new Set();
  for (const s of spans) if (s.pieces.some(hit)) found++;
  for (let i = 0; i < ps.length; i++) {
    if (!hit(i)) continue;
    flagged += ps[i].w ?? 1;
    if (label[i]) right++;
    flaggedContracts.add(ps[i].contract);
  }
  let both = 0;
  for (const c of flaggedContracts) if (contractsWithFlag.has(c)) both++;
  return {
    spans: spans.length, found, flagged, right,
    contracts: ix.contracts.length, lawyerContracts: contractsWithFlag.size, flaggedContracts: flaggedContracts.size, bothContracts: both,
  };
}

export const f1 = (r) => {
  const rec = r.spans ? r.found / r.spans : 0;
  const prec = r.flagged ? r.right / r.flagged : 0;
  return rec + prec ? (2 * rec * prec) / (rec + prec) : 0;
};

/** The threshold on `probs` with the best F1 (clauses found vs. pieces flagged correctly). */
export function bestThreshold(ix, flagId, ps, probs) {
  const cands = [...new Set(probs.map((p) => Math.round(p * 1000) / 1000))].sort((a, b) => a - b);
  let best = { t: 1, f: -1 };
  for (const t of cands) {
    const f = f1(score(ix, flagId, ps, (i) => probs[i] >= t));
    if (f > best.f) best = { t, f };
  }
  return best.t;
}

export function total(rows) {
  const t = { spans: 0, found: 0, flagged: 0, right: 0, contracts: 0, lawyerContracts: 0, flaggedContracts: 0, bothContracts: 0 };
  for (const r of rows) for (const k in t) t[k] += r[k];
  t.contracts = rows[0]?.contracts ?? 0;
  return t;
}
