// Fast checks with no model: the segmenter, the rule-based flags, the emails and the extension.
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { segment, matches } from '../src/segment.js';
import { FLAGS } from '../src/flags.js';
import { RULES, RULES_BY_ID } from '../src/rules.js';
import { PACK } from '../src/crossborder.js';
import { ruleHits, supersede, rulesFor, withRules } from '../src/scan.js';
import { scannedPages } from '../src/extract.js';
import { TESSERACT, reader, joinLines } from '../src/ocr.js';
import { parties, fill, quote, sectionAt, counterProposal, combinedEmail, DISCLAIMER } from '../src/letters.js';

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

check('PDF pages with no text are picked out as scanned', JSON.stringify(scannedPages(['1. Services The Contractor will design...', '  \n ', 'Page 3', 'A full page of contract text here.'])) === '[2,3]');

// --- reading scanned pages -------------------------------------------------------------

{
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const core = JSON.parse(readFileSync(new URL('../node_modules/tesseract.js-core/package.json', import.meta.url)));
  const urls = [TESSERACT.module, TESSERACT.workerPath, TESSERACT.corePath, TESSERACT.langPath];
  check('Tesseract\'s files all come from jsDelivr at exact versions', urls.every((u) => /^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+(?:\/|$)/.test(u)), urls.join(' '));
  check('and the same versions the tests run in Node', urls[0].includes(`tesseract.js@${pkg.devDependencies['tesseract.js']}/`) && urls[2].endsWith(`tesseract.js-core@${core.version}`), `${pkg.devDependencies['tesseract.js']} ${core.version}`);
}
{
  const seen = [];
  const fake = {
    async createWorker(lang, oem, opts) {
      opts.logger({ status: 'loading language traineddata', progress: 0.5 });
      return {
        recognize: async () => { opts.logger({ status: 'recognizing text', progress: 1 }); return { data: { text: 'one\n\ntwo' } }; },
        terminate: async () => {},
      };
    },
  };
  const r = await reader(fake, {}, (p) => seen.push(`load ${p}`));
  const text = await r.read('page', (p) => seen.push(`read ${p}`));
  check('the reader reports loading and reading progress separately', seen.join() === 'load 0.5,read 1', seen.join());
  check('and joins a sentence that runs on across a blank line', text === 'one\ntwo', JSON.stringify(text));
}
check('a new paragraph after a full stop stays a new paragraph', joinLines('It ends here.\n\nNext one starts.') === 'It ends here.\n\nNext one starts.' && joinLines('shall not provide\n\nsoftware services') === 'shall not provide\nsoftware services');

// --- cross-border pack ----------------------------------------------------------------

check('cross-border rules run only when asked for', rulesFor().length === RULES.length && rulesFor({ crossBorder: true }).length === RULES.length + PACK.length);
{
  const hits = [{ seg: 1, flag: 'noncompete', p: 0.9 }, { seg: 4, flag: 'noncompete', p: 0.8 }, { seg: 1, flag: 'scope', rule: true }];
  const kept = supersede(hits, rulesFor({ crossBorder: true })).map((h) => `${h.seg}:${h.flag}`);
  check('a narrower rule replaces the model flag on the same clause only', kept.join() === '4:noncompete,1:scope', kept.join());
}
{
  const xb = readFileSync(new URL('../data/samples/crossborder.txt', import.meta.url), 'utf8');
  const segs = segment(xb);
  const on = new Set(withRules(xb, segs, [], { crossBorder: true }).map((h) => h.flag));
  const off = new Set(withRules(xb, segs, [], { crossBorder: false }).map((h) => h.flag));
  check('the cross-border sample trips the pack when it is on', ['ipearly', 'forum', 'realise', 'scope', 'killfee'].every((f) => on.has(f)), [...on].join(', '));
  check('and none of it when it is off', PACK.every((r) => !off.has(r.id)), [...off].join(', '));
}

// --- emails ---------------------------------------------------------------------------

const freelance = readFileSync(new URL('../data/samples/freelance.txt', import.meta.url), 'utf8');
const xbText = readFileSync(new URL('../data/samples/crossborder.txt', import.meta.url), 'utf8');
check('names come from the contract\'s definitions', JSON.stringify(parties(freelance)) === '{"client":"the Company","me":"the Contractor"}' && JSON.stringify(parties(xbText)) === '{"client":"the Client","me":"the Developer"}', JSON.stringify([parties(freelance), parties(xbText)]));
check('names fall back to the Client and the Contractor', JSON.stringify(parties('No definitions here.')) === '{"client":"the Client","me":"the Contractor"}');
check('a name that starts a sentence is capitalised', fill('{client} pays. Then {me} delivers to {client}.', parties(xbText)) === 'The Client pays. Then the Developer delivers to the Client.');
{
  const segs = segment(xbText);
  const i = segs.findIndex((x) => x.text.startsWith('The Client will pay each undisputed invoice'));
  check('a sentence inside a clause gets that clause\'s section number', sectionAt(segs, i) === '2.2', `${i} ${sectionAt(segs, i)}`);
}
check('a long clause is quoted up to a word boundary', (() => { const q = quote(`4.1 ${'word '.repeat(100)}`); return q.endsWith('word…') && q.length <= 301 && !q.startsWith('4.1'); })());

const all = [...FLAGS, ...RULES, ...PACK];
check('every flag and rule has the parts an email needs', all.every((f) => f.why && f.better && f.reply), all.filter((f) => !(f.why && f.better && f.reply)).map((f) => f.id).join(', '));
{
  const names = parties(xbText);
  const left = all.flatMap((f) => [f.why, f.better, f.reply].map((s) => fill(s, names, 'a note'))).filter((s) => /\{\w+\}/.test(s));
  check('no template is left with an unfilled {placeholder}', !left.length, left.join(' | '));
}
{
  const xbSegs = segment(xbText);
  const hit = withRules(xbText, xbSegs, [], { crossBorder: true }).find((h) => h.flag === 'scope');
  const email = counterProposal({ f: PACK.find((r) => r.id === 'scope'), seg: xbSegs[hit.seg].text, note: hit.note }, parties(xbText));
  check('a counter-proposal names the section and quotes the clause', email.includes('section 4.1') && email.includes('"During the term of this Agreement and for twelve (12) months after'), email);
  check('it fills in what the clause says and the contract\'s names', email.includes('12 months after the contract ends') && email.includes('the Developer will not provide the same services'), email);
  check('it says it is not legal advice', email.startsWith(DISCLAIMER) && DISCLAIMER.includes('Not legal advice'));
  const items = withRules(xbText, xbSegs, [], { crossBorder: true }).slice(0, 3).map((h) => ({ f: PACK.find((r) => r.id === h.flag) ?? RULES_BY_ID[h.flag], seg: xbSegs[h.seg].text, note: h.note }));
  const combined = combinedEmail(items, parties(xbText));
  check('the combined email numbers every item and suggests wording for each', [1, 2, 3].every((i) => combined.includes(`\n${i}. `)) && combined.split('Suggested wording:').length === 4 && combined.startsWith(DISCLAIMER), combined);
}

// --- browser extension ----------------------------------------------------------------

const ext = (f) => new URL(`../extension/${f}`, import.meta.url);
const manifest = JSON.parse(readFileSync(ext('manifest.json')));
{
  const files = [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap((c) => c.js), ...Object.values(manifest.icons), 'sites.js', 'jobs.js', 'popup.js'];
  check('the extension is Manifest V3 and every file it names exists', manifest.manifest_version === 3 && files.every((f) => existsSync(ext(f))), files.filter((f) => !existsSync(ext(f))).join(', '));
  check('it asks for no broad access: activeTab, scripting and storage only', JSON.stringify(manifest.permissions.sort()) === '["activeTab","scripting","storage"]' && !manifest.host_permissions && !manifest.optional_host_permissions);
  check('its only content script runs on ClauseGuard\'s own page', manifest.content_scripts.every((c) => c.matches.every((m) => /^(https:\/\/vanshajpoonia\.github\.io\/fine-print\/|http:\/\/localhost:8000\/)\*$/.test(m))));
  check('its store description fits in 132 characters and says not legal advice', manifest.description.length <= 132 && /not legal advice/i.test(manifest.description), String(manifest.description.length));
  check('the popup says not legal advice', /Not legal advice/.test(readFileSync(ext('popup.html'), 'utf8')));
}
{
  const sandbox = {};
  vm.runInNewContext(readFileSync(ext('sites.js'), 'utf8'), sandbox);
  const S = sandbox.clauseguardSites;
  check('Google Docs paths give the document\'s export base', S.docsBase('/document/d/1aB_c-9/edit') === '/document/d/1aB_c-9' && S.docsBase('/document/u/1/d/XyZ/edit?tab=t.0') === '/document/u/1/d/XyZ' && S.docsBase('/spreadsheets/d/XyZ/edit') === null);
  check('page pictures are told apart from icons and banners', S.pageLike(816, 1056) && S.pageLike(1275, 1650) && !S.pageLike(1200, 300) && !S.pageLike(64, 64));
}
{
  const { pick } = await import('../extension/jobs.js');
  const t = (n) => ({ text: 'x'.repeat(n) });
  check('the longest text wins over shorter text and over pictures', pick([t(10), { images: ['a', 'b'] }, t(50), null]).text.length === 50);
  check('pictures win over an error, and an error is kept when nothing was found', pick([{ error: 'no' }, { images: ['a'] }]).images.length === 1 && pick([{ error: 'no' }, null]).error === 'no');
}
{
  let listener;
  const store = { 'job:0f0e9c2a-1b2c-4d5e-8f90-123456789abc': { text: 'contract' } };
  const chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } }, storage: { session: { get: async (k) => ({ [k]: store[k] }) } } };
  const code = readFileSync(ext('background.js'), 'utf8').replace(/^import .*$/m, `const { APP_PAGES } = { APP_PAGES: ${JSON.stringify((await import('../extension/jobs.js')).APP_PAGES)} };`);
  vm.runInNewContext(code, { chrome });
  const ask = (url) => new Promise((resolve) => { if (!listener({ type: 'clauseguard:job', id: '0f0e9c2a-1b2c-4d5e-8f90-123456789abc' }, { url }, resolve)) resolve('refused'); });
  check('the service worker hands a contract only to ClauseGuard\'s page', (await ask('https://vanshajpoonia.github.io/fine-print/?job=x'))?.text === 'contract' && (await ask('https://evil.example/fine-print/')) === 'refused');
}

console.log(failed ? `\n${failed} FAILED` : '\nall unit checks pass');
process.exit(failed ? 1 : 0);
