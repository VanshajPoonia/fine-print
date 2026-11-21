import { BY_ID, LEVELS } from './flags.js';
import { RULES_BY_ID } from './rules.js';
import { PACK_BY_ID } from './crossborder.js';
import { scan, withRules } from './scan.js';
import { matches } from './segment.js';
import { fileToText, pdfPages, imagePage } from './extract.js';
import { loadReader, TESSERACT } from './ocr.js';
import { parties, fill, sectionAt, onFee, counterProposal, combinedEmail } from './letters.js';
import { contractFee } from './money.js';
import * as model from './model.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const info = (id) => BY_ID[id] ?? RULES_BY_ID[id] ?? PACK_BY_ID[id];

const heads = fetch('data/heads.json').then((r) => r.json());
let lawyer = null; // the CUAD sample's lawyer highlights, while its text is unchanged
let lawyerText = null;
let fromNote = ''; // where the text came from (the extension, the scan reader), while it is unchanged

$('#size').textContent = `${model.SIZE_MB} MB`;

// ---------- cross-border checks ------------------------------------------------------------

// Remembered on this device only. Defaults to on.
const XB_KEY = 'clauseguard-crossborder';
try { $('#xb').checked = localStorage.getItem(XB_KEY) !== 'off'; } catch { $('#xb').checked = true; }
const crossBorder = () => $('#xb').checked;

$('#xb').addEventListener('change', () => {
  try { localStorage.setItem(XB_KEY, crossBorder() ? 'on' : 'off'); } catch (err) { console.warn('Could not remember the cross-border setting', err); }
  // The rules are cheap, so an open report updates without reading the contract again.
  if (current) render(current.text, { segs: current.segs, hits: withRules(current.text, current.segs, current.model, { crossBorder: crossBorder() }) }, current.lawyerMarks, { scroll: false });
});

// ---------- getting the contract in --------------------------------------------------------

const setText = (t) => {
  $('#text').value = t;
  $('#scan').disabled = !t.trim();
};

$('#text').addEventListener('input', () => {
  $('#scan').disabled = !$('#text').value.trim();
  fromNote = '';
  dropScan();
  document.querySelectorAll('[data-sample]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
});

document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', async () => {
  dropScan();
  fromNote = '';
  document.querySelectorAll('[data-sample]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  if (b.dataset.sample === 'cuad') {
    const c = await (await fetch('data/samples/cuad.json')).json();
    lawyer = c.lawyer;
    lawyerText = c.text;
    setText(c.text);
    $('#status').textContent = `${c.name}: a real agreement from an SEC filing, one of the 102 contracts held back from training. Lawyers' answers will be shown next to ClauseGuard's.`;
  } else {
    setText(await (await fetch(`data/samples/${b.dataset.sample}.txt`)).text());
    if (b.dataset.sample === 'crossborder' && !crossBorder()) $('#xb').click();
    $('#status').textContent = '';
  }
}));

const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
$('#file').addEventListener('change', (e) => { if (e.target.files[0]) readFile(e.target.files[0]); });

// Pictures of pages have no text to read. ClauseGuard's own reader can try, and the only other
// ways it suggests run on the device too.
const SCAN_HELP = 'If you have the original document, use that. Or copy the text with your device\'s own text recognition, such as Live Text in Preview on a Mac or in Photos on an iPhone, and paste it here.';
const READER_NOTE = `ClauseGuard can read them on this device with Tesseract, a text reader that downloads about ${TESSERACT.mb} MB once.`;

let scans = null; // pages waiting to be read: { file, pageTexts, numbers } or { images }

function offerScan(job, msg) {
  scans = job;
  $('#ocr').hidden = false;
  $('#status').textContent = msg;
}

function dropScan() {
  scans = null;
  $('#ocr').hidden = true;
}

async function readFile(file) {
  dropScan();
  fromNote = '';
  $('#status').textContent = `Reading ${file.name}…`;
  try {
    const { text: t, pages, pageTexts, scanned = [] } = await fileToText(file);
    document.querySelectorAll('[data-sample]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    if (pages && scanned.length) {
      const all = scanned.length === pages;
      if (!all) setText(t);
      const which = all
        ? `${file.name} is a scanned PDF: pictures of its pages, with no text inside.`
        : `${file.name}: page${scanned.length > 1 ? 's' : ''} ${scanned.join(', ')} ${scanned.length > 1 ? 'look' : 'looks'} scanned, with no text inside. The other pages were read.`;
      offerScan({ file, pageTexts, numbers: scanned }, `${which} ${READER_NOTE} ${SCAN_HELP}`);
      return;
    }
    if (!t.trim()) throw new Error('No text found in this file.');
    setText(t);
    $('#status').textContent = `${file.name}: ${t.split(/\s+/).length.toLocaleString()} words, read on this device.`;
  } catch (err) {
    $('#status').textContent = err.message;
  }
}

async function* pictures(list) {
  for (const [i, src] of list.entries()) yield imagePage(src, i + 1);
}

$('#ocr').addEventListener('click', async () => {
  const job = scans;
  if (!job) return;
  const bar = $('#bar');
  $('#ocr').hidden = true;
  $('#scan').disabled = true;
  bar.hidden = false;
  bar.value = 0;
  try {
    const { read } = await loadReader((p) => { bar.value = p; $('#status').textContent = `Loading the text reader… ${Math.round(p * 100)}%`; });
    const texts = [...(job.pageTexts ?? [])];
    const total = job.images?.length ?? job.numbers.length;
    const pages = job.images ? pictures(job.images) : pdfPages(await job.file.arrayBuffer(), job.numbers);
    let k = 0;
    for await (const page of pages) {
      const before = k++;
      $('#status').textContent = `Reading scanned page ${k} of ${total} on this device…`;
      texts[page.n - 1] = await read(page.canvas, (p) => { bar.value = (before + p) / total; });
    }
    scans = null;
    setText(texts.join('\n\n'));
    fromNote = `${fromNote}Read ${total} scanned page${total > 1 ? 's' : ''} on this device. A scan can still be misread, so check the text. `;
    run();
  } catch (err) {
    console.error(err);
    $('#status').textContent = `Could not read the scanned pages: ${err.message}`;
    $('#ocr').hidden = false;
    $('#scan').disabled = !$('#text').value.trim();
  } finally {
    bar.hidden = true;
  }
});

// ---------- scanning ----------------------------------------------------------------------

async function run() {
  const text = $('#text').value;
  const bar = $('#bar');
  $('#scan').disabled = true;
  bar.hidden = false;
  bar.value = 0;
  try {
    $('#status').textContent = 'Loading the model (once; it is cached after this)…';
    const embed = await model.load((p) => { bar.value = p; $('#status').textContent = `Downloading EmbeddingGemma… ${Math.round(p * 100)}%`; });
    const t0 = performance.now();
    $('#status').textContent = 'Reading every clause…';
    const result = await scan(text, embed, await heads, (p) => { bar.value = p; $('#status').textContent = `Reading every clause… ${Math.round(p * 100)}%`; }, { crossBorder: crossBorder() });
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    $('#status').textContent = `${fromNote}Read ${result.segs.length} clauses in ${secs} s on this device (${model.backend() === 'webgpu' ? 'GPU' : 'CPU'}). Nothing was uploaded.`;
    render(text, result, text === lawyerText ? lawyer : null);
  } catch (err) {
    console.error(err);
    $('#status').textContent = `Something went wrong: ${err.message}`;
  } finally {
    bar.hidden = true;
    $('#scan').disabled = false;
  }
}

$('#scan').addEventListener('click', run);

// ---------- from the browser extension ------------------------------------------------------

// The extension opens this page with ?job=… and its bridge script (extension/bridge.js) passes
// the contract in, inside this tab. Only messages from this same window are accepted.
if (new URLSearchParams(location.search).has('job')) {
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin || e.data?.type !== 'clauseguard:contract') return;
    fromExtension(e.data.contract);
  });
  window.postMessage({ type: 'clauseguard:ready' }, location.origin);
  $('#status').textContent = 'Waiting for the contract from the ClauseGuard extension…';
}

function fromExtension(c) {
  if (!c) {
    $('#status').textContent = 'The contract from the extension is no longer here. Click the extension again.';
    return;
  }
  const from = `From ${c.source}${c.title ? `, "${c.title}"` : ''}`;
  if (c.text) {
    setText(c.text);
    fromNote = `${from}. `;
    run();
  } else {
    fromNote = `${from}. `;
    offerScan({ images: c.images }, `${from}: ${c.images.length} page${c.images.length > 1 ? 's' : ''}, shown as pictures. ${READER_NOTE} Or, in DocuSign, use Other actions, then Download, and drop the PDF in here.`);
  }
}

// ---------- the report --------------------------------------------------------------------

let current = null;

function render(text, { segs, hits, model: modelHits = current?.model }, lawyerMarks, { scroll = true } = {}) {
  // One card per flag, with every clause that tripped it.
  const groups = new Map();
  for (const h of hits) (groups.get(h.flag) ?? groups.set(h.flag, []).get(h.flag)).push(h);
  const cards = [...groups.entries()].map(([id, hs]) => {
    hs.sort((a, b) => (b.sure ?? 1) - (a.sure ?? 1));
    return { id, f: info(id), hs };
  }).sort((a, b) => LEVELS[a.f.level].order - LEVELS[b.f.level].order || (b.hs[0].sure ?? 1) - (a.hs[0].sure ?? 1));

  const n = { red: 0, amber: 0, info: 0 };
  cards.forEach((c) => n[c.f.level]++);
  $('#headline').textContent = n.red
    ? `${n.red} thing${n.red > 1 ? 's' : ''} to push back on before you sign.`
    : n.amber ? 'Nothing alarming. A few things to negotiate.' : 'Nothing here that usually costs freelancers money.';
  $('#counts').innerHTML = ['red', 'amber', 'info'].filter((l) => n[l]).map((l) => `<span class="${l}">${n[l]} ${LEVELS[l].label.toLowerCase()}${l === 'red' && n[l] > 1 ? 's' : ''}</span>`).join('');

  // Lawyer comparison (CUAD sample only).
  const agrees = (h) => lawyerMarks?.some((m) => m.flag === h.flag && matches(segs[h.seg], m));
  if (lawyerMarks) {
    const lawyerFlags = [...new Set(lawyerMarks.map((m) => m.flag))];
    const ours = new Set(cards.filter((c) => c.f.cuad).map((c) => c.id));
    const both = lawyerFlags.filter((f) => ours.has(f));
    const missed = lawyerFlags.filter((f) => !ours.has(f));
    const extra = [...ours].filter((f) => !lawyerFlags.includes(f));
    const name = (f) => BY_ID[f].title.toLowerCase();
    $('#lawyers').innerHTML = `
      <h3>Against the lawyers' answers</h3>
      <p>In this contract, CUAD's lawyers marked clauses in <strong>${lawyerFlags.length}</strong> of ClauseGuard's categories. ClauseGuard found <strong>${both.length}</strong> of them.</p>
      <ul>
        ${missed.length ? `<li>Missed: ${missed.map(name).join('; ')}.</li>` : ''}
        ${extra.length ? `<li>Flagged, but the lawyers did not mark: ${extra.map(name).join('; ')}.</li>` : ''}
      </ul>`;
    $('#lawyers').hidden = false;
  } else {
    $('#lawyers').hidden = true;
  }

  const names = parties(text);
  const fee = contractFee(segs);
  $('#flags').innerHTML = cards.length ? cards.map((c, k) => {
    const top = c.hs[0];
    const seg = segs[top.seg];
    const more = c.hs.length - 1;
    const strength = PACK_BY_ID[c.id] ? 'Cross-border rule' : top.rule ? 'Found by a rule' : top.sure > 0.5 ? 'Strong match' : 'Possible match';
    const lawyerTag = lawyerMarks && !top.rule
      ? (agrees(top) ? '<span class="tag agree">Lawyers marked this too</span>' : '<span class="tag extra">Lawyers did not mark this</span>')
      : '';
    return `<li class="flag ${c.f.level}" style="animation-delay:${k * 40}ms">
      <div class="flag-top"><h3>${esc(c.f.title)}${top.note ? `: ${esc(top.note)}` : ''}</h3><span class="level">${LEVELS[c.f.level].label}</span></div>
      <blockquote>${esc(seg.text)}</blockquote>
      <dl>
        <dt>What it means</dt><dd>${esc(c.f.means)}</dd>
        <dt>What to ask for</dt><dd>${esc(c.f.ask)}</dd>
        <dt>Wording to suggest</dt><dd class="better">${esc(fill(c.f.better, names, top.note))}</dd>
        ${onFee(c.id, fee) ? `<dd class="small">${esc(onFee(c.id, fee))}</dd>` : ''}
      </dl>
      <div class="flag-foot">
        <label><input type="checkbox" data-reply="${c.id}" ${c.f.level === 'info' ? '' : 'checked'}> Include in my reply</label>
        <button class="link" data-counter="${c.id}">Write a counter-proposal</button>
        <span>${strength}</span>
        ${lawyerTag}
        <button class="link" data-show="${top.seg}">Show in contract</button>
        ${more ? `<span>and ${more} more place${more > 1 ? 's' : ''}</span>` : ''}
      </div>
    </li>`;
  }).join('') : '<li class="empty">ClauseGuard did not flag anything. That is not the same as "safe": read it anyway, and check the payment terms yourself.</li>';

  // The marked-up contract.
  const level = new Map();
  for (const h of hits) {
    const l = info(h.flag).level;
    if (!level.has(h.seg) || LEVELS[l].order < LEVELS[level.get(h.seg)].order) level.set(h.seg, l);
  }
  let html = '', pos = 0;
  segs.forEach((s, i) => {
    if (!level.has(i)) return;
    html += esc(text.slice(pos, s.start));
    const titles = hits.filter((h) => h.seg === i).map((h) => info(h.flag).title).join(', ');
    html += `<mark id="seg-${i}" class="${level.get(i)}" title="${esc(titles)}">${esc(text.slice(s.start, s.end))}</mark>`;
    pos = s.end;
  });
  $('#contract').innerHTML = html + esc(text.slice(pos));

  $('#report').hidden = false;
  if (scroll) $('#report').scrollIntoView({ behavior: 'smooth', block: 'start' });
  current = { text, segs, model: modelHits, cards, names, fee, lawyerMarks };
}

$('#flags').addEventListener('click', (e) => {
  const counter = e.target.closest('[data-counter]');
  if (counter) {
    const c = current.cards.find((x) => x.id === counter.dataset.counter);
    showEmail(`Counter-proposal: ${c.f.title.toLowerCase()}`, counterProposal(item(c), current.names, current.fee));
    return;
  }
  const b = e.target.closest('[data-show]');
  if (!b) return;
  $('#contract-wrap').open = true;
  const m = $(`#seg-${b.dataset.show}`);
  m.scrollIntoView({ behavior: 'smooth', block: 'center' });
  m.classList.add('flash');
  setTimeout(() => m.classList.remove('flash'), 1600);
});

// ---------- the emails --------------------------------------------------------------------

const item = (c) => ({ f: c.f, seg: current.segs[c.hs[0].seg].text, sec: sectionAt(current.segs, c.hs[0].seg), note: c.hs[0].note });

function showEmail(title, text) {
  $('#reply-title').textContent = title;
  $('#reply-text').value = text;
  $('#reply-dialog').showModal();
}

$('#reply').addEventListener('click', () => {
  const chosen = new Set([...document.querySelectorAll('[data-reply]:checked')].map((x) => x.dataset.reply));
  const items = current.cards.filter((c) => chosen.has(c.id)).map(item);
  showEmail('Your reply: one email for all of them', items.length ? combinedEmail(items, current.names, current.fee) : 'Tick "Include in my reply" on the clauses you want to raise.');
});

$('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#reply-text').value);
    $('#copy').textContent = 'Copied';
  } catch {
    $('#reply-text').select();
    $('#copy').textContent = 'Press Ctrl/Cmd+C';
  }
  setTimeout(() => { $('#copy').textContent = 'Copy'; }, 1500);
});

// The service worker also adds cross-origin isolation headers (see sw.js), which only take
// effect on a page it served. So on the very first visit, reload once it is in control.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then(async () => {
    if (self.crossOriginIsolated) return;
    let tried = false;
    try { tried = sessionStorage.getItem('isolate-reload') === '1'; sessionStorage.setItem('isolate-reload', '1'); } catch { tried = true; }
    if (tried) return;
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) location.reload();
    else navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  }).catch(() => {});
}
