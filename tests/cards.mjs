// Card titles as the report shows them: one per flag, its title and what its first clause
// found, such as "Non-compete reaches too far: 12 months after the contract ends, anywhere in
// the world". Rules only, so no model is needed. Shared by tests/unit.mjs and tests/ocr.mjs.
import { segment } from '../src/segment.js';
import { withRules } from '../src/scan.js';
import { RULES_BY_ID } from '../src/rules.js';
import { PACK_BY_ID } from '../src/crossborder.js';

export function cardTitles(text) {
  const titles = new Map();
  for (const h of withRules(text, segment(text), [], { crossBorder: true })) {
    const f = PACK_BY_ID[h.flag] ?? RULES_BY_ID[h.flag];
    if (!titles.has(h.flag)) titles.set(h.flag, `${f.title}${h.note ? `: ${h.note}` : ''}`);
  }
  return [...titles.values()].sort();
}

/** Hard-wraps each paragraph at `width` characters, as a PDF's text layer or a scan does. */
export const wrap = (text, width = 95) => text.split('\n').map((para) => {
  const lines = [];
  let line = '';
  for (const word of para.split(/\s+/).filter(Boolean)) {
    if (line && line.length + word.length + 1 > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  return [...lines, line].join('\n');
}).join('\n');
