// Fast checks with no model: the segmenter and the rule-based flags.
import { readFileSync } from 'node:fs';
import { segment, matches } from '../src/segment.js';
import { RULES_BY_ID } from '../src/rules.js';
import { ruleHits } from '../src/scan.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`);
};
const texts = (t) => segment(t).map((s) => s.text);

// --- segmenter ------------------------------------------------------------------------

{
  // CUAD style: one line, numbered clauses, abbreviations.
  const t = 'Exhibit 10.1 1. Definitions 1.1 "Company" means Acme Holdings Inc. and its affiliates, including Acme Co. Ltd. of Hong Kong. 1.2 "Term" has the meaning in Section 9.2 of this Agreement. 2. Non-Competition. Distributor shall not sell competing products in the Territory. Payment is due within 30 days. See Exhibit A. The rest follows.';
  const s = texts(t);
  check('abbreviations do not end a clause ("Inc.", "Co.", "Ltd.")', s.some((x) => x.includes('Acme Holdings Inc. and its affiliates, including Acme Co. Ltd. of Hong Kong.')), JSON.stringify(s));
  check('a numbered clause starts a new piece mid-line', s.some((x) => x.startsWith('1.2 "Term"')), JSON.stringify(s));
  check('"Section 9.2" is not cut at its full stop', s.some((x) => x.includes('in Section 9.2 of this Agreement.')), JSON.stringify(s));
  check('a short heading travels with its clause', s.some((x) => x.startsWith('2. Non-Competition. Distributor shall not')), JSON.stringify(s));
}

{
  // Pasted/PDF style: hard-wrapped lines inside a paragraph, blank lines between paragraphs.
  const t = 'The Contractor shall not, during the term of this Agreement, provide\nservices to any competitor of the Company.\n\n3.2 The Company may terminate this Agreement at any time\nupon five days written notice.';
  const s = texts(t);
  check('a hard-wrapped line is joined back into its sentence', s[0] === 'The Contractor shall not, during the term of this Agreement, provide services to any competitor of the Company.', JSON.stringify(s));
  check('a numbered paragraph after a blank line is its own piece', s[1]?.startsWith('3.2 The Company may terminate'), JSON.stringify(s));
}

{
  const long = `${'The Licensee shall indemnify the Licensor against all losses arising from any breach, '.repeat(6)}and pay its costs; ${'the Licensor shall give prompt notice of any claim and reasonable assistance in its defence, '.repeat(5)}at the Licensee's expense.`;
  const s = segment(long);
  check('a very long sentence is split, preferring "; "', s.length >= 2 && s.every((x) => x.end - x.start <= 800) && s[0].text.endsWith('costs;'), JSON.stringify(s.map((x) => x.end - x.start)));
}

{
  const t = 'First clause here, long enough to stand alone as a piece. Second clause here, also long enough to stand alone.';
  const s = segment(t);
  check('offsets point back into the original text', s.every((x) => t.slice(x.start, x.end).replace(/\s+/g, ' ') === x.text));
  check('a highlight inside a piece matches it', matches(s[0], { start: 6, end: 20 }));
  check('a highlight in the next piece does not', !matches(s[0], { start: s[1].start + 2, end: s[1].end }));
}

// --- rules ----------------------------------------------------------------------------

const ids = (text) => ruleHits(text, segment(text)).map((h) => h.flag + (h.note ? `:${h.note}` : ''));

check('net 60 is slow', ids('Invoices are payable net 60.').includes('slowpay:60 days'));
check('"within ninety (90) days of receipt of ... invoice" is slow', ids('The Company will pay each invoice within ninety (90) days of receipt of a correct invoice.').includes('slowpay:90 days'));
check('"within 45 business days after the date of invoice" is slow', ids('Payment will be made within 45 business days after the date of the invoice.').includes('slowpay:45 days'));
check('net 30 is not flagged', !ids('Invoices are payable net 30.').length);
check('"cure within thirty (30) days" is not about payment', !ids('fails to cure the breach within thirty (30) days of written notice.').length);
check('"within 60 days of the expense" is not about invoices', !ids('receipts are submitted within sixty (60) days of the expense being incurred.').length);
check('"to the Company\'s sole satisfaction"', ids("Deliverables are accepted only when completed to the Company's sole satisfaction.").includes('satisfaction'));
check('"unlimited revisions"', ids('The fee includes unlimited revisions.').includes('revisions'));
check('"two rounds of revisions" is fine', !ids('The fee includes two rounds of revisions.').length);

const sample = readFileSync(new URL('../data/samples/freelance.txt', import.meta.url), 'utf8');
const found = new Set(ids(sample).map((x) => x.split(':')[0]));
check('the sample contract trips all three rules', ['slowpay', 'satisfaction', 'revisions'].every((r) => found.has(r)), [...found].join(', '));
check('every rule has advice to show', Object.values(RULES_BY_ID).every((r) => r.means && r.ask && r.title));

console.log(failed ? `\n${failed} FAILED` : '\nall unit checks pass');
process.exit(failed ? 1 : 0);
