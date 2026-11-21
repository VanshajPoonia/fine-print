// Amounts of money in a contract, read and written back the contract's own way: "USD 14,000",
// "$18,000", "₹1,40,000", "Rs. 2.5 lakh", "14,000 US dollars". The emails use them to turn
// "25% of the fee" into a number.

const PREFIX = String.raw`(?<pre>US\$|USD|INR|Rs\.?|₹|EUR|€|GBP|£|CAD|AUD|SGD|\$)(?<gap>\s?)`;
const NUMBER = String.raw`(?<num>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const SCALE = String.raw`(?:\s*(?<scale>lakhs?|lacs?|crores?))?`;
const SUFFIX = String.raw`\s*(?<suf>US\s+dollars|U\.S\.\s+dollars|dollars|Indian\s+rupees|rupees|euros?|pounds|USD|INR|EUR|GBP)\b`;
const AMOUNTS = [new RegExp(`${PREFIX}${NUMBER}${SCALE}`, 'gi'), new RegExp(`${NUMBER}${SCALE}${SUFFIX}`, 'gi')];
const MULTIPLY = { lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7 };

/** Every amount in `text`, with how it was written so a new amount can be written the same way. */
export function amounts(text) {
  const found = [];
  for (const re of AMOUNTS) {
    for (const m of text.matchAll(re)) {
      const { pre = '', gap = '', num, scale, suf } = m.groups;
      if (found.some((a) => m.index < a.end && m.index + m[0].length > a.index)) continue;
      found.push({
        value: Number(num.replace(/,/g, '')) * (MULTIPLY[scale?.toLowerCase()] ?? 1),
        prefix: pre + gap,
        suffix: suf ? ` ${suf.replace(/\s+/g, ' ')}` : '',
        indian: /\d,\d{2},\d{3}/.test(num) || !!scale || /^(?:INR|Rs\.?|₹)$/i.test(pre) || /rupees/i.test(suf ?? ''),
        index: m.index,
        end: m.index + m[0].length,
      });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** `share` of an amount, written like the amount: 0.25 of "₹1,40,000" is "₹35,000". */
export function format(amount, share = 1) {
  const v = amount.value * share;
  const digits = new Intl.NumberFormat(amount.indian ? 'en-IN' : 'en-US', { maximumFractionDigits: Number.isInteger(v) ? 0 : 2, minimumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v);
  return `${amount.prefix}${digits}${amount.suffix}`;
}

const FEE = /\b(?:fees?|price|compensation|remuneration|consideration|retainer|pay|paid|payable)\b/i;
const NOT_FEE = /\b(?:insurance|liabilit\w*|indemn\w*|damages|penalt\w*|expenses?|reimburse\w*|deposit|interest|late\s+fee|cancellation\s+fee|kill\s+fee)\b/i;
const TOTAL = /\b(?:total|fixed|flat|lump[- ]sum|project\s+fee|contract\s+(?:price|value)|whole\s+project|for\s+the\s+(?:services|project|work))\b/i;
const RATE = /^\s*(?:\(|,)?\s*(?:per|an?|each|every|\/)\s*(?:hour|hr|day|week|month|year|annum|word|page|article|video|unit|sprint)\b/i;

/**
 * The contract's total fee: an amount in a clause about paying fees, not about insurance,
 * liability, expenses or penalties, and not a rate per hour or month. Null if there is none.
 * @param {{text: string}[]} segs  clauses from src/segment.js
 */
export function contractFee(segs) {
  let best = null;
  for (const s of segs) {
    if (!FEE.test(s.text) || NOT_FEE.test(s.text)) continue;
    for (const a of amounts(s.text)) {
      if (!a.value || RATE.test(s.text.slice(a.end, a.end + 20))) continue;
      const rank = (TOTAL.test(s.text) ? 2 : 1) * 1e12 + a.value;
      if (!best || rank > best.rank) best = { ...a, rank };
    }
  }
  if (!best) return null;
  const { rank, ...fee } = best;
  return fee;
}
