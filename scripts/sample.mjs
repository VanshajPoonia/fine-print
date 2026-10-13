// Picks the "real contract, with the lawyers' answers" sample for the app: one of the 102
// held-out test contracts (never trained on), with the lawyers' highlights for our flags.
//
//   node scripts/sample.mjs [title substring]
//
// Without an argument it picks a mid-length contract where the lawyers marked many of our
// flags, so the comparison in the app has something to show either way.

import { writeFileSync } from 'node:fs';
import { contracts, spansFor } from './data.mjs';
import { FLAGS } from '../src/flags.js';

const want = process.argv[2];
const list = contracts('test');
const scored = list.map((c) => ({ c, flags: FLAGS.filter((f) => spansFor(c, f).length).length }))
  .filter(({ c }) => (want ? c.title.includes(want) : c.text.length > 8000 && c.text.length < 30000))
  .sort((a, b) => b.flags - a.flags);
const { c } = scored[0];

const lawyer = FLAGS.flatMap((f) => spansFor(c, f).map((s) => ({ flag: f.id, start: s.start, end: s.end })));
// CUAD titles look like "TUNIUCORP_03_06_2014-EX-10-COOPERATION AGREEMENT".
const tc = (x) => x.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
const m = c.title.match(/^(.+?)_(?:\d{1,2}_\d{1,2}_)?(\d{4})\d*.*?-EX-[\d.]+-(.+)$/);
const name = m ? `${tc(m[1].replace(/_/g, ' '))}: ${tc(m[3])} (${m[2]})` : c.title;
writeFileSync(new URL('../data/samples/cuad.json', import.meta.url), JSON.stringify({ name, title: c.title, text: c.text, lawyer }));
console.log(`${c.title}\n  ${c.text.length} characters, lawyers marked ${new Set(lawyer.map((l) => l.flag)).size} of our 14 flags: ${[...new Set(lawyer.map((l) => l.flag))].join(', ')}`);
