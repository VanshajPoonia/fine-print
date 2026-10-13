// Contract text -> clause-sized pieces, each with its offsets in the original text so the
// app can highlight exactly what was flagged.
//
// Two very different inputs have to come out the same way:
//   - text pasted or pulled from a PDF/DOCX: real paragraphs, but lines hard-wrapped
//     mid-sentence;
//   - CUAD, which the model is trained and tested on: every contract is one long line with
//     all whitespace collapsed, so the only structure left is sentences and section numbers.
// So newlines are treated as hints, and sentence/section boundaries do the real work.

const MIN = 40; // shorter pieces (headings, "1.", "Section 5") are glued onto the next one
const MAX = 800; // longer pieces are split, preferring "; " between sub-clauses

// Words that end in a full stop without ending a sentence.
const ABBREV = new Set([
  'inc', 'ltd', 'co', 'corp', 'llc', 'l.l.c', 'plc', 'no', 'nos', 'sec', 'secs', 'art', 'arts', 'u.s', 'u.k', 'e.g', 'i.e',
  'vs', 'v', 'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'approx', 'dept', 'ex', 'exh', 'para', 'paras', 'pp', 'cf', 'al',
  'viz', 'n.a', 's.a', 'b.v', 'n.v', 'pty', 'fig', 'vol', 'ref', 'attn', 'ave', 'blvd', 'rd', 'ste', 'p.o', 'a.m', 'p.m',
  'etc', 'incl', 'est', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sept', 'sep', 'oct', 'nov', 'dec', 'cal', 'civ', 'stat',
]);

// "1.", "2.1.", "(a).", "iv.", "A." are numbering or initials, not the end of a sentence.
const NUMBERING = /^(?:\(?[0-9]+(?:\.[0-9]+)*\)?|\(?[a-z]\)?|\(?[ivxlc]+\)?|[A-Z])$/i;

// Where a new clause starts after a newline.
const LINE_START = /^[ \t]*(?:\(?[0-9]+(?:\.[0-9]+)*[.)]?\s|\([a-z]{1,4}\)\s|[•\-*]\s|(?:section|article|clause|schedule|exhibit)\s+[0-9a-z]+\b|[A-Z][A-Z ,&'-]{4,}$)/i;

// Where a new clause starts mid-line: "... last clause. 12.3 Next clause" / "... Section 4 ...".
const INLINE_SECTION = /\s(?=(?:[0-9]{1,2}(?:\.[0-9]{1,2})+\.?|[0-9]{1,2}\.)\s+[A-Z(])/g;

function cuts(text) {
  const at = new Set([0, text.length]);

  // Newlines: a blank line always ends a piece; a single newline only when the line
  // before ended a sentence or the next line starts like a heading or a numbered clause.
  for (const m of text.matchAll(/\n/g)) {
    const i = m.index;
    const before = text.slice(Math.max(0, i - 200), i).trimEnd();
    const nextLine = text.slice(i + 1, text.indexOf('\n', i + 1) === -1 ? undefined : text.indexOf('\n', i + 1));
    const blank = /^\s*$/.test(nextLine);
    if (blank || /[.;:?!]["')\]]*$/.test(before) || LINE_START.test(nextLine)) at.add(i + 1);
  }

  // Sentence ends.
  for (const m of text.matchAll(/[.?!]["'”’)\]]*(?=\s+["'“‘(]?[A-Z0-9(])/g)) {
    const end = m.index + m[0].length;
    const word = text.slice(0, m.index + 1).match(/(\S+)$/)[1].replace(/^["'“‘(]+/, '');
    const bare = word.replace(/[.?!]+$/, '').toLowerCase();
    if (text[m.index] === '.' && (ABBREV.has(bare) || NUMBERING.test(word.replace(/\.$/, '')))) continue;
    at.add(end);
  }

  // Numbered clauses that start mid-line.
  for (const m of text.matchAll(INLINE_SECTION)) at.add(m.index + 1);

  return [...at].sort((a, b) => a - b);
}

function trimmed(text, start, end) {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return [start, end];
}

function splitLong(text, start, end) {
  if (end - start <= MAX) return [[start, end]];
  const piece = text.slice(start, end);
  // Best split point near the middle, in order of preference: "; " then ", " then any space.
  const mid = piece.length / 2;
  let best = -1;
  for (const re of [/;\s/g, /,\s/g, /\s/g]) {
    for (const m of piece.matchAll(re)) {
      const i = m.index + 1;
      if (i < MIN * 2 || piece.length - i < MIN * 2) continue;
      if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
    }
    if (best !== -1) break;
  }
  if (best === -1) return [[start, end]];
  const [a1, a2] = trimmed(text, start, start + best);
  const [b1, b2] = trimmed(text, start + best, end);
  return [...splitLong(text, a1, a2), ...splitLong(text, b1, b2)];
}

/** @returns {{start:number, end:number, text:string}[]} */
export function segment(text) {
  const c = cuts(text);
  const spans = [];
  for (let i = 0; i < c.length - 1; i++) {
    const [s, e] = trimmed(text, c[i], c[i + 1]);
    if (e > s) spans.push([s, e]);
  }

  // Glue short pieces (headings, bare numbers) onto the piece after them. A heading like
  // "Non-Competition." is one of the strongest hints there is, so it should travel with
  // its clause rather than be classified alone.
  const merged = [];
  let carry = null;
  for (const [s, e] of spans) {
    const start = carry ?? s;
    if (e - start < MIN) { carry = start; continue; }
    merged.push([start, e]);
    carry = null;
  }
  if (carry !== null) {
    if (merged.length) merged[merged.length - 1][1] = spans[spans.length - 1][1];
    else merged.push([carry, spans[spans.length - 1][1]]);
  }

  return merged
    .flatMap(([s, e]) => splitLong(text, s, e))
    .map(([start, end]) => ({ start, end, text: text.slice(start, end).replace(/\s+/g, ' ') }));
}

/** Characters shared by [a1, a2) and [b1, b2). */
export const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/**
 * The rule used everywhere a piece is matched to a lawyer's highlight: they overlap by at
 * least half of whichever is shorter. A one-line highlight inside a long piece counts, and so
 * does a short piece inside a long highlight.
 */
export const matches = (seg, span) => overlap(seg.start, seg.end, span.start, span.end) >= 0.5 * Math.min(seg.end - seg.start, span.end - span.start);
