// Measures the cross-border rules (src/crossborder.js). No model needed.
//
//   node tests/crossborder.mjs
//
// 1. Hand-written clauses (tests/fixtures/crossborder.mjs): the dev set the rules were
//    written against, and a fresh set written afterwards. Then payment clauses in Indian
//    freelance phrasing: a set the rules were tuned on and a set only ever measured.
// 2. Two whole contracts: the app's cross-border sample, and a fair one that should trip nothing.
// 3. CUAD's 102 held-out contracts, for the three rules a CUAD category covers. CUAD is
//    US commercial contracts, so these numbers say how well a rule finds the clause, not
//    whether a freelancer should worry about it.

import { readFileSync } from 'node:fs';
import { DEV, FRESH, INDIA_TUNE, INDIA_REPORT } from './fixtures/crossborder.mjs';
import { PACK, PACK_BY_ID } from '../src/crossborder.js';
import { segment, matches } from '../src/segment.js';
import { ruleHits } from '../src/scan.js';

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const runs = (id, t) => PACK_BY_ID[id].find(t, segment(t)).length > 0;

function score(set) {
  const rows = {};
  for (const [id, { fire, pass }] of Object.entries(set)) {
    rows[id] = {
      found: fire.filter((t) => runs(id, t)).length, fire: fire.length,
      alarms: pass.filter((t) => runs(id, t)).length, pass: pass.length,
      missed: fire.filter((t) => !runs(id, t)), wrong: pass.filter((t) => runs(id, t)),
    };
  }
  return rows;
}

let failed = 0;
const fail = (msg) => { failed++; console.log(`FAIL  ${msg}`); };

console.log('1. Hand-written clauses: found = flagged when it should be, false alarms = flagged when it should not be\n');
console.log(`${'rule'.padEnd(12)} ${'dev found'.padStart(10)} ${'dev false'.padStart(10)} ${'fresh found'.padStart(12)} ${'fresh false'.padStart(12)}`);
const dev = score(DEV);
const fresh = score(FRESH);
const sum = (rows, k) => Object.values(rows).reduce((a, r) => a + r[k], 0);
for (const r of PACK) {
  const d = dev[r.id], f = fresh[r.id];
  console.log(`${r.id.padEnd(12)} ${`${d.found}/${d.fire}`.padStart(10)} ${`${d.alarms}/${d.pass}`.padStart(10)} ${`${f.found}/${f.fire}`.padStart(12)} ${`${f.alarms}/${f.pass}`.padStart(12)}`);
}
console.log(`${'all'.padEnd(12)} ${`${sum(dev, 'found')}/${sum(dev, 'fire')}`.padStart(10)} ${`${sum(dev, 'alarms')}/${sum(dev, 'pass')}`.padStart(10)} ${`${sum(fresh, 'found')}/${sum(fresh, 'fire')}`.padStart(12)} ${`${sum(fresh, 'alarms')}/${sum(fresh, 'pass')}`.padStart(12)}`);
console.log(`\nfresh set: found ${pct(sum(fresh, 'found'), sum(fresh, 'fire'))} of the clauses that should be flagged, false alarms on ${pct(sum(fresh, 'alarms'), sum(fresh, 'pass'))} of the ones that should not`);
for (const [id, f] of Object.entries(fresh)) {
  for (const t of f.missed) console.log(`  fresh MISSED ${id}: ${t}`);
  for (const t of f.wrong) console.log(`  fresh EXTRA  ${id}: ${t}`);
}

// The dev set is a regression check: every clause there is one the rules were made to get right.
for (const [id, d] of Object.entries(dev)) {
  for (const t of d.missed) fail(`dev ${id} missed: ${t}`);
  for (const t of d.wrong) fail(`dev ${id} false alarm: ${t}`);
}
// The fresh set gets a floor, not a target.
if (sum(fresh, 'found') / sum(fresh, 'fire') < 0.8) fail('fresh set: under 80% found');
if (sum(fresh, 'alarms') / sum(fresh, 'pass') > 0.1) fail('fresh set: over 10% false alarms');

console.log('\n1b. Payment checks in Indian freelance phrasing (Upwork-style terms, agency subcontracts)\n');
console.log(`${'rule'.padEnd(12)} ${'tune found'.padStart(11)} ${'tune false'.padStart(11)} ${'report found'.padStart(13)} ${'report false'.padStart(13)}`);
const tune = score(INDIA_TUNE);
const report = score(INDIA_REPORT);
for (const id of Object.keys(INDIA_TUNE)) {
  const a = tune[id], b = report[id];
  console.log(`${id.padEnd(12)} ${`${a.found}/${a.fire}`.padStart(11)} ${`${a.alarms}/${a.pass}`.padStart(11)} ${`${b.found}/${b.fire}`.padStart(13)} ${`${b.alarms}/${b.pass}`.padStart(13)}`);
}
console.log(`${'all'.padEnd(12)} ${`${sum(tune, 'found')}/${sum(tune, 'fire')}`.padStart(11)} ${`${sum(tune, 'alarms')}/${sum(tune, 'pass')}`.padStart(11)} ${`${sum(report, 'found')}/${sum(report, 'fire')}`.padStart(13)} ${`${sum(report, 'alarms')}/${sum(report, 'pass')}`.padStart(13)}`);
for (const [id, r] of Object.entries(report)) {
  for (const t of r.missed) console.log(`  report MISSED ${id}: ${t}`);
  for (const t of r.wrong) console.log(`  report EXTRA  ${id}: ${t}`);
}
// The tune set is a regression check. The report set, never tuned on, gets a floor.
for (const [id, r] of Object.entries(tune)) {
  for (const t of r.missed) fail(`Indian tune ${id} missed: ${t}`);
  for (const t of r.wrong) fail(`Indian tune ${id} false alarm: ${t}`);
}
if (sum(report, 'found') / sum(report, 'fire') < 0.6) fail('Indian report set: under 60% found');
if (sum(report, 'alarms') / sum(report, 'pass') > 0.1) fail('Indian report set: over 10% false alarms');

console.log('\n2. Whole contracts\n');
const ids = (file) => {
  const text = readFileSync(new URL(file, import.meta.url), 'utf8');
  return new Set(ruleHits(text, segment(text), PACK).map((h) => h.flag));
};
const sample = ids('../data/samples/crossborder.txt');
const want = ['realise', 'nolatefee', 'currency', 'fees', 'ipearly', 'forum', 'scope', 'killfee'];
console.log(`  cross-border sample: ${[...sample].join(', ')}`);
if (want.some((x) => !sample.has(x)) || sample.size !== want.length) fail(`cross-border sample should trip exactly: ${want.join(', ')}`);
const fair = ids('./fixtures/fair.txt');
console.log(`  fair contract: ${fair.size ? [...fair].join(', ') : 'nothing'}`);
if (fair.size) fail('the fair contract should trip none of the cross-border rules');

console.log('\n3. CUAD, 102 held-out contracts\n');
const { contracts } = await import('../scripts/data.mjs');
const test = contracts('test');
const CUAD = { ipearly: 'Ip Ownership Assignment', scope: 'Non-Compete', forum: 'Governing Law' };
const perRule = Object.fromEntries(PACK.map((r) => [r.id, { contracts: 0, hits: 0, right: 0, spans: 0, found: 0 }]));
for (const c of test) {
  const segs = segment(c.text);
  const hits = ruleHits(c.text, segs, PACK);
  for (const r of PACK) {
    const mine = hits.filter((h) => h.flag === r.id).map((h) => segs[h.seg]);
    const row = perRule[r.id];
    if (mine.length) row.contracts++;
    row.hits += mine.length;
    const cat = CUAD[r.id];
    if (!cat) continue;
    const spans = c.spans[cat] ?? [];
    row.spans += spans.length;
    row.found += spans.filter((s) => mine.some((seg) => matches(seg, s))).length;
    row.right += mine.filter((seg) => spans.some((s) => matches(seg, s))).length;
  }
}
console.log(`${'rule'.padEnd(12)} ${'contracts flagged'.padStart(18)} ${'flags'.padStart(6)}   against lawyers' highlights`);
for (const r of PACK) {
  const x = perRule[r.id];
  const vs = CUAD[r.id] ? `"${CUAD[r.id]}": found ${x.found}/${x.spans} (${pct(x.found, x.spans)}), flags on one ${x.right}/${x.hits} (${pct(x.right, x.hits)})` : 'no CUAD category';
  console.log(`${r.id.padEnd(12)} ${`${x.contracts}/${test.length}`.padStart(18)} ${String(x.hits).padStart(6)}   ${vs}`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall cross-border checks pass');
process.exit(failed ? 1 : 0);
