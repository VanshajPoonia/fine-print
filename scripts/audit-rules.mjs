// Prints a random, reproducible sample of what each cross-border rule flags in CUAD's 102
// held-out contracts, so a person can judge whether each flag is the right kind of clause.
// Most of these rules have no CUAD category, so this reading is their only check on real
// contracts. CUAD is US commercial contracts, so read each one as an Indian freelancer would.
//
//   node scripts/audit-rules.mjs [rule] [how many per rule, default 15]
//   SEED=101 node scripts/audit-rules.mjs     another random sample

import { contracts } from './data.mjs';
import { segment } from '../src/segment.js';
import { ruleHits } from '../src/scan.js';
import { PACK } from '../src/crossborder.js';

const only = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : null;
const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 15);

const byRule = Object.fromEntries(PACK.map((r) => [r.id, []]));
for (const c of contracts('test')) {
  const segs = segment(c.text);
  for (const h of ruleHits(c.text, segs, PACK)) byRule[h.flag].push({ contract: c.title, note: h.note, text: segs[h.seg].text });
}

let seed = Number(process.env.SEED ?? 7);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (const r of PACK) {
  if (only && r.id !== only) continue;
  const hits = byRule[r.id];
  for (let i = hits.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [hits[i], hits[j]] = [hits[j], hits[i]]; }
  console.log(`\n=== ${r.id}: ${r.title} (${hits.length} flags in total, ${Math.min(N, hits.length)} at random)\n`);
  hits.slice(0, N).forEach((h, k) => console.log(`#${k + 1} [${h.note}] ${h.contract.slice(0, 40)}\n    ${h.text.slice(0, 420)}\n`));
}
