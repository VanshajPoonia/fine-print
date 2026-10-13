import { FLAGS, BY_ID, LEVELS } from './flags.js';
import { RULES_BY_ID } from './rules.js';
import { scan } from './scan.js';
import { matches } from './segment.js';
import { fileToText } from './extract.js';
import * as model from './model.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const info = (id) => BY_ID[id] ?? RULES_BY_ID[id];

const heads = fetch('data/heads.json').then((r) => r.json());
let lawyer = null; // the CUAD sample's lawyer highlights, while its text is unchanged
let lawyerText = null;

$('#size').textContent = `${model.SIZE_MB} MB`;

// ---------- getting the contract in --------------------------------------------------------

const setText = (t) => {
  $('#text').value = t;
  $('#scan').disabled = !t.trim();
};

$('#text').addEventListener('input', () => {
  $('#scan').disabled = !$('#text').value.trim();
  document.querySelectorAll('[data-sample]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
});

document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', async () => {
  document.querySelectorAll('[data-sample]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  if (b.dataset.sample === 'freelance') {
    setText(await (await fetch('data/samples/freelance.txt')).text());
  } else {
    const c = await (await fetch('data/samples/cuad.json')).json();
    lawyer = c.lawyer;
    lawyerText = c.text;
    setText(c.text);
    $('#status').textContent = `${c.name}: a real agreement from an SEC filing, one of the 102 contracts held back from training. Lawyers' answers will be shown next to Fine Print's.`;
  }
}));

const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
$('#file').addEventListener('change', (e) => { if (e.target.files[0]) readFile(e.target.files[0]); });

async function readFile(file) {
  $('#status').textContent = `Reading ${file.name}…`;
  try {
    const t = await fileToText(file);
    if (!t.trim()) throw new Error('No text found. If it is a scanned PDF, it is a picture of text, and Fine Print cannot read pictures yet.');
    setText(t);
    document.querySelectorAll('[data-sample]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    $('#status').textContent = `${file.name}: ${t.split(/\s+/).length.toLocaleString()} words, read on this device.`;
  } catch (err) {
    $('#status').textContent = err.message;
  }
}

// ---------- scanning ----------------------------------------------------------------------

$('#scan').addEventListener('click', async () => {
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
    const result = await scan(text, embed, await heads, (p) => { bar.value = p; $('#status').textContent = `Reading every clause… ${Math.round(p * 100)}%`; });
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    $('#status').textContent = `Read ${result.segs.length} clauses in ${secs} s on this device (${model.backend() === 'webgpu' ? 'GPU' : 'CPU'}). Nothing was uploaded.`;
    render(text, result, text === lawyerText ? lawyer : null);
  } catch (err) {
    console.error(err);
    $('#status').textContent = `Something went wrong: ${err.message}`;
  } finally {
    bar.hidden = true;
    $('#scan').disabled = false;
  }
});

// ---------- the report --------------------------------------------------------------------

/** Clause number at the start of a piece, for "(section 4.1)" in the reply. */
const sectionOf = (t) => t.match(/^(?:section\s+|article\s+|clause\s+)?(\(?[0-9]+(?:\.[0-9]+)*\)?|\([a-z]\))[.)]?\s/i)?.[1];

function render(text, { segs, hits }, lawyerMarks) {
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
    const ours = new Set(cards.filter((c) => !c.f.cuad ? false : true).map((c) => c.id));
    const both = lawyerFlags.filter((f) => ours.has(f));
    const missed = lawyerFlags.filter((f) => !ours.has(f));
    const extra = [...ours].filter((f) => !lawyerFlags.includes(f));
    const name = (f) => BY_ID[f].title.toLowerCase();
    $('#lawyers').innerHTML = `
      <h3>Against the lawyers' answers</h3>
      <p>In this contract, CUAD's lawyers marked clauses in <strong>${lawyerFlags.length}</strong> of Fine Print's categories. Fine Print found <strong>${both.length}</strong> of them.</p>
      <ul>
        ${missed.length ? `<li>Missed: ${missed.map(name).join('; ')}.</li>` : ''}
        ${extra.length ? `<li>Flagged, but the lawyers did not mark: ${extra.map(name).join('; ')}.</li>` : ''}
      </ul>`;
    $('#lawyers').hidden = false;
  } else {
    $('#lawyers').hidden = true;
  }

  $('#flags').innerHTML = cards.length ? cards.map((c, k) => {
    const top = c.hs[0];
    const seg = segs[top.seg];
    const more = c.hs.length - 1;
    const strength = top.rule ? 'Found by a rule' : top.sure > 0.5 ? 'Strong match' : 'Possible match';
    const lawyerTag = lawyerMarks && !top.rule
      ? (agrees(top) ? '<span class="tag agree">Lawyers marked this too</span>' : '<span class="tag extra">Lawyers did not mark this</span>')
      : '';
    return `<li class="flag ${c.f.level}" style="animation-delay:${k * 40}ms">
      <div class="flag-top"><h3>${esc(c.f.title)}${top.note ? `: ${esc(top.note)}` : ''}</h3><span class="level">${LEVELS[c.f.level].label}</span></div>
      <blockquote>${esc(seg.text)}</blockquote>
      <dl>
        <dt>What it means</dt><dd>${esc(c.f.means)}</dd>
        <dt>What to ask for</dt><dd>${esc(c.f.ask)}</dd>
      </dl>
      <div class="flag-foot">
        <label><input type="checkbox" data-reply="${c.id}" ${c.f.level === 'info' ? '' : 'checked'}> Include in my reply</label>
        <span>${strength}</span>
        ${lawyerTag}
        <button class="link" data-show="${top.seg}">Show in contract</button>
        ${more ? `<span>and ${more} more place${more > 1 ? 's' : ''}</span>` : ''}
      </div>
    </li>`;
  }).join('') : '<li class="empty">Fine Print did not flag anything. That is not the same as "safe": read it anyway, and check the payment terms yourself.</li>';

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
  $('#report').scrollIntoView({ behavior: 'smooth', block: 'start' });
  current = { segs, cards };
}

let current = null;

$('#flags').addEventListener('click', (e) => {
  const b = e.target.closest('[data-show]');
  if (!b) return;
  $('#contract-wrap').open = true;
  const m = $(`#seg-${b.dataset.show}`);
  m.scrollIntoView({ behavior: 'smooth', block: 'center' });
  m.classList.add('flash');
  setTimeout(() => m.classList.remove('flash'), 1600);
});

// ---------- the reply ---------------------------------------------------------------------

$('#reply').addEventListener('click', () => {
  const chosen = new Set([...document.querySelectorAll('[data-reply]:checked')].map((x) => x.dataset.reply));
  const items = current.cards.filter((c) => chosen.has(c.id)).map((c, i) => {
    const sec = sectionOf(current.segs[c.hs[0].seg].text);
    const [head, ...rest] = c.f.reply.split(': ');
    const body = rest.length ? `${head}${sec ? ` (section ${sec})` : ''}: ${rest.join(': ')}` : `${sec ? `Section ${sec}: ` : ''}${c.f.reply}`;
    return `${i + 1}. ${body}`;
  });
  $('#reply-text').value = items.length
    ? `Hi [name],\n\nThanks for sending the agreement over; I'm looking forward to the project. Before I sign, I'd like to suggest a few changes:\n\n${items.join('\n\n')}\n\nHappy to talk any of these through.\n\nBest,\n[your name]`
    : 'Tick "Include in my reply" on the clauses you want to raise.';
  $('#reply-dialog').showModal();
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
