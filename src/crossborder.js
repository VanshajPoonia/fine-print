// Cross-border checks for freelancers in India with clients in the US or EU. Pattern rules,
// like src/rules.js, each with plain-words advice and wording to propose instead.
// `{client}` and `{me}` in `better` become the contract's own names for the two sides.
// tests/crossborder.mjs measures them on written fixtures and on CUAD's held-out contracts.

const NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, eighteen: 18, twenty: 20, 'twenty-four': 24, thirty: 30, 'thirty-six': 36, forty: 40, 'forty-five': 45,
  sixty: 60, ninety: 90, 'one hundred twenty': 120, 'one hundred and twenty': 120, 'one hundred eighty': 180, 'one hundred and eighty': 180,
};
const num = (s) => {
  const d = s.match(/\d+/);
  return d ? Number(d[0]) : NUM[s.toLowerCase().replace(/\s+/g, ' ').trim()] ?? null;
};

// Each rule looks at one clause at a time. `segs` comes from src/segment.js.
const each = (segs, test) => segs.flatMap((s, i) => {
  const r = test(s.text, segs[i - 1]?.text ?? '');
  return r ? [{ start: s.start, end: s.end, ...(r === true ? {} : r) }] : [];
});

const PAYS = /\b(?:invoice[sd]?|fees?|payments?|pay|paid|payable|compensation|remuneration)\b/i;
const MONEY = /(?:[$€£₹]\s?\d|\b(?:USD|EUR|GBP|INR|US\$)\s?\d|\d[\d,.]*\s?(?:dollars|euros?|pounds|rupees|USD|EUR|GBP|INR)\b)/i;
const PAYING = /\b(?:shall|will|must|agrees?\s+to)\s+(?:\w+\s+)?(?:pay|settle)\b|\b(?:payable|paid|due|remit|remits|receive|receives)\b|\bpayment\s+(?:of|for|is|will|shall)\b/i;
const CURRENCY = /[$€£₹]|\b(?:USD|EUR|GBP|INR|CAD|AUD|SGD|CHF|AED|dollars?|euros?|pounds?\s+sterling|rupees?|sterling)\b/i;
const FEE = '(?:(?:bank|wire|transfer|transaction|remittance|conversion|currency|platform|paypal|payment|processing|intermediary|swift|foreign\\s+exchange)\\s+(?:or\\s+|and\\s+|\\/\\s*)?)+(?:charges?|fees?|costs?)\\b';
const DEADLINE = /\bnet\s*\(?\d{1,3}\)?(?!\s*%)|\bwithin\s+[^.;]{0,40}?\b(?:days?|weeks?|months?)\b|\b\d{1,3}\)?\s+(?:calendar\s+|business\s+)?days\s+(?:of|after|from|following)\b|\b(?:due|payable|paid)\s+(?:up)?on\s+receipt\b|\b(?:in\s+advance|before\s+work\s+(?:starts|begins))\b|\b(?:on\s+or\s+before|no\s+later\s+than|not\s+later\s+than)\b|\bby\s+the\s+\d{1,2}(?:st|nd|rd|th)\b|\bprior\s+to\s+the\s+\w+\s+(?:business\s+|calendar\s+)?day\b|\b(?:payable|due|paid)\s+within\b|\bwithin\s+\[/i;
const LATE = /\blate\s+(?:payment\s+)?(?:fees?|charges?|interest)|\binterest\b[^.;]{0,80}\b(?:overdue|late|past\s+due|unpaid|outstanding)|\b(?:overdue|late|past\s+due|unpaid|outstanding)\b[^.;]{0,80}\b(?:interest|late\s+fee|surcharge)|\b(?:service|finance)\s+charge|\b(?:suspend|stop|pause)\s+(?:work|the\s+services|services|performance)/i;

// Where the payment terms are, so absence checks have a clause to point at.
// Scored, so the card quotes a clause about paying fees, not a definition, a table of contents
// or a penalty. No clause scores high enough: nothing to point at, so no flag.
function paymentClause(segs, needDeadline = false) {
  let best = null, top = 0;
  for (const s of segs) {
    const t = s.text;
    if (!PAYS.test(t) || !PAYING.test(t) || (needDeadline && !DEADLINE.test(t))) continue;
    const score = (/\b(?:payments?|fees?|compensation|remuneration|rates?)\b/i.test(t) ? 1 : 0) + (/\binvoice/i.test(t) ? 3 : 0) + (MONEY.test(t) ? 2 : 0) + (/\b(?:shall|will|agrees?\s+to)\s+pay\b|\bpayable\b/i.test(t) ? 2 : 0) + (DEADLINE.test(t) ? 1 : 0)
      - (/["”]\s*(?:shall\s+)?means?\b|\.{5,}/.test(t) ? 6 : 0)
      - (/\b(?:indemnif\w*|damages|award|penalt\w*|liquidated|cancellation\s+fee|termination\s+fee|refund|reimburse\w*)\b/i.test(t) ? 4 : 0)
      - (/\b(?:tax(?:es)?|expenses|freight|costs)\b/i.test(t) ? 3 : 0);
    if (score > top) { best = s; top = score; }
  }
  return best;
}

const at = (s, extra = {}) => (s ? [{ start: s.start, end: s.end, ...extra }] : []);

// Places a dispute can be sent to, for the note on the card. India comes first so an
// Indian forum is never mistaken for a foreign one.
const INDIA = /\b(?:India|Indian|Bengaluru|Bangalore|Mumbai|Delhi|New\s+Delhi|Chennai|Hyderabad|Pune|Kolkata|Ahmedabad|Gurugram|Gurgaon|Noida|Jaipur|Chandigarh|Kochi|Indore|Lucknow)\b/i;
const PLACE = new RegExp(`(?<![A-Za-z])(${[
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois',
  'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana',
  'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
  'District of Columbia', 'Wilmington', 'San Francisco', 'Los Angeles', 'Seattle', 'Chicago', 'Boston', 'Austin',
  'United States', 'U\\.S\\.A?\\.?', 'USA', 'England(?: and Wales)?', 'United Kingdom', 'Scotland', 'London', 'Ireland', 'Dublin', 'Germany', 'Berlin', 'Munich',
  'France', 'Paris', 'Netherlands', 'Amsterdam', 'Belgium', 'Brussels', 'Spain', 'Madrid', 'Italy', 'Milan', 'Sweden', 'Stockholm', 'Denmark', 'Finland',
  'Norway', 'Poland', 'Austria', 'Vienna', 'Portugal', 'Lisbon', 'Estonia', 'Luxembourg', 'Switzerland', 'Zurich', 'Geneva', 'Singapore', 'Hong Kong',
  'Dubai', 'United Arab Emirates', 'Canada', 'Ontario', 'Toronto', 'British Columbia', 'Australia', 'New South Wales', 'Sydney', 'Israel', 'Japan', 'China',
  'PRC', "People's Republic of China", 'Taiwan', 'Korea', 'Mexico', 'Brazil', 'Colombia', 'Chile', 'Argentina', 'South Africa', 'Puerto Rico', 'Bermuda',
  'Cayman Islands', 'British Virgin Islands', 'Philippines', 'Malaysia', 'Thailand', 'Indonesia', 'Vietnam', 'Saudi Arabia', 'Qatar',
].join('|')})(?![A-Za-z])`, 'i');
const BODY = /\b(American\s+Arbitration\s+Association|AAA|ICDR|JAMS|International\s+Chamber\s+of\s+Commerce|ICC|LCIA|London\s+Court\s+of\s+International\s+Arbitration|SIAC|DIS|Netherlands\s+Arbitration\s+Institute)\b/;
const HOME = /\b(?:the\s+)?(?:company|client|customer)['’]s\s+(?:home\s+(?:state|country|jurisdiction)|principal\s+place\s+of\s+business|place\s+of\s+(?:incorporation|business))/i;

export const PACK = [
  {
    id: 'nodeadline',
    level: 'amber',
    title: 'No date for getting paid',
    supersedes: [],
    means: 'The contract says what you are paid but not when. A client can then take as long as they like. Since 1 October 2026, RBI rules want money for exported services in India within nine months of the invoice, so an open-ended wait can also leave you asking your bank for an extension.',
    ask: 'A fixed number of days after each invoice, 15 or 30 is common, and a deposit before work starts.',
    better: '{client} will pay each invoice in full within 15 days of the invoice date.',
    reply: 'Payment date: could we add that each invoice is paid within [15] days of the invoice date?',
    why: 'At the moment the agreement does not say when invoices are due, and a clear date keeps things simple on both sides.',
    find(text, segs) {
      if (!PAYS.test(text) || !(MONEY.test(text) || /\b(?:invoices?|rates?|retainer)\b/i.test(text))) return [];
      if (segs.some((s) => PAYS.test(s.text) && DEADLINE.test(s.text))) return [];
      return at(paymentClause(segs), { note: 'no due date' });
    },
  },
  {
    id: 'nolatefee',
    level: 'amber',
    title: 'Nothing happens if they pay late',
    supersedes: [],
    means: 'There is a due date but no late fee, no interest and no right to pause work. From another country, chasing a late invoice is slow and costly, so a late fee is often the only leverage you have.',
    ask: 'Interest on overdue invoices, 1.5% a month is common, and the right to pause work when an invoice is more than 15 days late.',
    better: 'Invoices not paid by the due date carry interest at 1.5% per month until paid. If an invoice is more than 15 days overdue, {me} may pause work until it is paid, and delivery dates move by the same number of days.',
    reply: 'Late payment: could we add interest of [1.5]% a month on overdue invoices, and let me pause work if an invoice is more than [15] days late?',
    why: 'Working across borders, a late invoice is hard for me to chase, so I ask every client for a simple late-payment term.',
    find(text, segs) {
      if (LATE.test(text)) return [];
      return at(paymentClause(segs, true), { note: 'no late fee' });
    },
  },
  {
    id: 'realise',
    level: 'amber',
    title: 'Payment could take longer than RBI allows',
    supersedes: ['slowpay'],
    means: 'Payment waits on something you do not control, or comes very late. Since 1 October 2026, RBI rules say money for exported services must reach India within nine months of the invoice date (twelve if invoiced in rupees). Your bank can extend that, but only if you ask and give reasons.',
    ask: 'A fixed due date counted from your invoice, not from their customer paying, a launch or a holdback period.',
    better: '{client} will pay each invoice within 30 days of the invoice date. Payment does not depend on {client} being paid by its own customers, on any launch date, or on any holdback.',
    reply: 'Payment timing: could each invoice be due [30] days from the invoice date, whatever else happens? Under Indian rules, payment for exported services has to reach me within nine months of the invoice.',
    why: 'Indian rules require me to receive payment for exported services within nine months of the invoice, so I need a due date that does not depend on other events.',
    find(text, segs) {
      return each(segs, (t) => {
        if (/\bpay[- ](?:when|if)[- ]paid\b|\b(?:upon|after|following|until|within\s+[^.;]{0,30}\s+(?:of|after))\s+(?:its\s+|the\s+(?:company|client|customer)['’]s\s+)?receipt\s+of\s+(?:the\s+)?(?:corresponding\s+|related\s+)?payments?\s+from\s+(?:its|the|their)\s+(?:own\s+)?(?:client|customer|end[- ]client)s?\b|\bonly\s+(?:after|once|when|if)\s+(?:the\s+)?(?:company|client|customer)\s+(?:has\s+been|is)\s+paid\b|\b(?:receives|has\s+received|is\s+paid)\s+(?:payment\s+)?(?:from|by)\s+(?:its|the|their)\s+(?:own\s+)?(?:client|customer|end[- ]client|distributor)s?\b/i.test(t)) return { note: 'paid when they are paid' };
        if (PAYS.test(t) && /\b(?:retain|retains|retained|withhold|withholds|withheld|hold\s+back|holds\s+back)\b[^.;]{0,60}?\b\d{1,2}\s*\)?\s*(?:%|percent)/i.test(t)) return { note: 'part of the fee held back' };
        if (/\b(?:payable|paid|due)\s+(?:only\s+)?(?:up)?on\s+(?:the\s+)?(?:public\s+|official\s+|commercial\s+)?(?:(?:product|app|website|site|campaign)\s+)?(?:launch|go-?live|publication|release|first\s+sale)\b|\b(?:payable|paid|due)\s+(?:only\s+)?(?:(?:up)?on|when|after|once)\s+(?:the\s+)?(?:company|client|customer)(?:['’]s\s+receipt\s+of|\s+(?:closes|raises|receives|completes))\s+(?:its\s+|a\s+|the\s+)?(?:[a-z]+\s+){0,2}(?:funding|financing|investment|revenue|round)/i.test(t)) return { note: 'paid on an event they control' };
        if (!PAYS.test(t)) return null;
        const d = t.match(/\bnet\s*\(?(\d{3})\)?|\bwithin\s+((?:[a-z-]+(?:\s+(?:hundred(?:\s+and)?|and)\s+[a-z-]+)*\s*)?\(?\d{0,3}\)?)\s*(?:calendar\s+|business\s+|working\s+)?(days?|months?)\b/i);
        if (!d) return null;
        const n = num(d[1] ?? d[2] ?? '');
        const months = !d[1] && /month/i.test(d[3]);
        const days = months ? n * 30 : n;
        return days && days > 270 ? { note: months ? `${n} months` : `${n} days` } : null;
      });
    },
  },
  {
    id: 'ipearly',
    level: 'red',
    title: 'They own the work before they pay for it',
    supersedes: ['ip'],
    means: '"Hereby assigns", "upon creation" and "work made for hire" make them the owner the moment the work exists, paid or not. If they never pay, you have no ownership left to hold back. "Will assign" is a promise to transfer later, but here too nothing ties it to being paid. "Work made for hire" is a US idea that often does not fit a contractor outside the US, which is why clients add an assignment as well.',
    ask: 'Ownership of the final deliverables passes only when you are paid in full. Until then they get a licence to use the work for review.',
    better: 'Upon receipt of payment in full of all fees under this Agreement, {me} assigns to {client} all right, title and interest in the final deliverables. Until then, {client} has a non-exclusive licence to use the deliverables for review and testing only. {me} keeps all pre-existing materials and know-how, and grants {client} a licence to use any that are part of the deliverables.',
    reply: 'Ownership: I am happy for ownership of the final deliverables to pass to you once all fees are paid in full. Until then you would have a licence to use the work for review.',
    why: 'The wording "{note}" means ownership can pass before any invoice is paid. I would like it to pass once the fees are paid in full, which is the usual arrangement for freelance work.',
    find(text, segs) {
      // A contract that ties ownership to payment anywhere is fine, even if the
      // assignment itself sits in another clause.
      if (/\b(?:title|ownership|rights?|assignment)\b[^.;]{0,100}\b(?:pass|passes|transfer|transfers|vest|vests|take\s+effect|takes\s+effect|effective)\b[^.;]{0,60}\b(?:upon|on|after|following|once|subject\s+to)\b[^.;]{0,40}\b(?:payment\s+in\s+full|full\s+payment|final\s+payment|paid\s+in\s+full)/i.test(text)) return [];
      return each(segs, (t) => {
        if (/\b(?:upon|after|following|subject\s+to|conditional\s+(?:up)?on|once|when)\s+(?:the\s+)?(?:receipt\s+of\s+)?(?:full|final|complete)\s+payment|\b(?:paid|payment)\s+in\s+full\b/i.test(t)) return null;
        const ipContext = /\b(?:intellectual\s+property|copyrights?|right,?\s+title,?\s+and\s+interest|work\s+product|deliverables|inventions?|works?\s+of\s+authorship|materials|artwork|designs?|software|source\s+code|technology|improvements)\b|\ball\s+(?:its\s+|their\s+|of\s+its\s+)?rights\s+(?:in|it\s+may\s+acquire)\b/i.test(t);
        if (/\bworks?[\s-]+(?:made[\s-]+)?for[\s-]+hire\b/i.test(t)) return { note: 'work made for hire' };
        if (!ipContext) return null;
        if (/\bupon\s+(?:its\s+|their\s+)?creation\b/i.test(t)) return { note: 'upon creation' };
        if (/\b(?:title|ownership)\s+(?:to|of|in)\b[^.;]{0,80}\b(?:pass(?:es)?|transfers?|vests?)\b[^.;]{0,40}\b(?:up)?on\s+(?:its\s+|their\s+)?(?:delivery|completion|submission)\b/i.test(t)) return { note: 'passes on delivery' };
        const verb = t.match(/\bhereby\s+(?:irrevocably\s+|unconditionally\s+)*(?:sells?,?\s+)?(?:assigns?|transfers?|conveys?)\b/i)
          ?? t.match(/\b(?:will|shall|agrees?\s+to)\s+(?:promptly\s+|irrevocably\s+)?assign\b/i);
        if (verb) return { note: verb[0].toLowerCase().replace(/\s+/g, ' ') };
        const owns = t.match(/\b(?:shall|will)\s+(?:become|be\s+(?:deemed\s+(?:to\s+be\s+)?)?)(?:the\s+)?(?:sole\s+and\s+exclusive\s+|exclusive\s+|sole\s+)?property\s+of\b|\bdeemed\s+to\s+be\s+(?:the\s+)?(?:[\w’']+\s+)?(?:sole\s+and\s+exclusive\s+|exclusive\s+|sole\s+)?property\b|\b(?:shall|will)\s+be\s+(?:solely\s+|exclusively\s+)?owned\s+by\b|\b(?:shall|will)\s+(?:solely\s+|exclusively\s+)?own\s+(?:and\s+retain\s+)?all\s+right/i);
        if (owns) return { note: owns[0].toLowerCase().replace(/\s+/g, ' ') };
        return null;
      });
    },
  },
  {
    id: 'forum',
    level: 'amber',
    title: 'Disputes are settled abroad',
    supersedes: ['law'],
    means: 'A dispute would be decided under another country\'s law, or in courts or arbitration far from you. Hiring a lawyer there and travelling costs more than most unpaid invoices, so in practice a client could stop paying with little risk.',
    ask: 'Online arbitration or mediation with video hearings, a seat in India or a neutral place, and the right to bring small payment claims in your own courts.',
    better: 'Any dispute will first go to mediation by video call. If it is not settled within 30 days, it will be decided by arbitration under the rules of [an agreed institution], held online with no need to travel, in English. Either party may bring a claim for unpaid fees in the courts where the other party is based.',
    reply: 'Disputes: since we are in different countries, could disputes go to online mediation first and then online arbitration, rather than {note}?',
    why: 'Because we are in different countries, {note} would make any dispute very costly for me.',
    find(text, segs) {
      return each(segs, (t) => {
        const arb = /\barbitrat\w*|\barbitral\b/i.test(t);
        const courts = arb || /\b(?:exclusive|non-exclusive|personal)\s+jurisdiction|\bsubmits?\s+(?:itself\s+)?to\s+the\s+(?:\w+\s+){0,2}jurisdiction|\bjurisdiction\s+of\s+(?:the\s+)?(?:\w+\s+){0,3}courts?\b|\bplace\s+of\s+jurisdiction|\bvenue\b|\bcourts?\s+(?:of|in|located|sitting|situated)\b|\b(?:federal|state|district|superior)\s+courts?\b/i.test(t);
        const law = /\bgoverned\s+(?:[\w,]+\s+){0,6}by\b|\b(?:construed|interpreted|resolved|enforced)\s+(?:in\s+accordance\s+with|under|according\s+to)\b|\bgoverning\s+law\b|\bapplication\s+of\s+the\s+laws?\s+of\b|\blaws?\s+of\s+[^.;]{0,40}\s+(?:shall\s+|will\s+)?(?:govern|apply|prevail)\b/i.test(t);
        if (!courts && !law) return null;
        if (INDIA.test(t)) return null;
        let place = t.match(PLACE)?.[1]?.replace(/\s+/g, ' ');
        if (/^(?:United|Netherlands)/.test(place ?? '')) place = `the ${place}`;
        const body = arb ? t.match(BODY)?.[1] : undefined;
        if (HOME.test(t)) return { note: courts ? 'their home courts' : 'their home law' };
        if (arb && (place || body)) return { note: `arbitration ${place ? `in ${place}` : `under ${body}`}` };
        if (!place) return null;
        if (courts) return { note: `courts in ${place}` };
        return { note: `the law of ${place}` };
      });
    },
  },
  {
    id: 'currency',
    level: 'info',
    title: 'Which currency, at whose rate',
    supersedes: [],
    means: 'The fee does not say which currency, or they pick the exchange rate. "$" alone can mean US, Canadian, Australian or Singapore dollars. A rate they choose can quietly cut what you receive.',
    ask: 'Name the currency with its code, such as USD or EUR, and invoice in that currency so no one has to convert.',
    better: 'All fees are stated and invoiced in [USD]. {client} will pay the invoiced amount in that currency.',
    reply: 'Currency: could we state all fees in [USD] and pay invoices in that currency?',
    why: 'Naming the currency avoids any doubt about {note}.',
    find(text, segs) {
      const rate = each(segs, (t) => (/\b(?:exchange\s+|conversion\s+)?rate\s+(?:determined|selected|chosen|set|used|applied|quoted)\s+by\s+(?:the\s+)?(?:company|client|customer|agency|its\s+bank)|\bat\s+the\s+(?:company|client|customer|agency)['’]s\s+(?:then[- ]prevailing\s+|prevailing\s+|standard\s+)?(?:exchange|conversion)\s+rate/i.test(t) && /\b(?:conver|exchange|currenc|euros?|dollars?|rupees?|pounds?|INR|EUR|USD|GBP)/i.test(t) ? { note: 'the exchange rate they choose' } : null));
      if (rate.length) return rate;
      if (!CURRENCY.test(text)) {
        const s = segs.find((x) => PAYS.test(x.text) && /\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\b|\b\d{4,}\b(?!\s*(?:%|percent))/.test(x.text.replace(/\b(?:19|20)\d{2}\b/g, '')));
        if (s) return at(s, { note: 'no currency named' });
      }
      if (/\$\s?\d/.test(text) && !/\b(?:USD|CAD|AUD|SGD|NZD|HKD)\b|\b(?:US|U\.S\.|C|A|S|NZ|HK)\s?\$|\b(?:U\.S\.|US|United\s+States|American|Canadian|Australian|Singapore)\s+dollars?\b/i.test(text)) {
        return at(segs.find((s) => /\$\s?\d/.test(s.text) && PAYS.test(s.text)) ?? segs.find((s) => /\$\s?\d/.test(s.text)), { note: 'which dollars' });
      }
      return [];
    },
  },
  {
    id: 'fees',
    level: 'amber',
    title: 'Transfer fees or tax come out of your pay',
    supersedes: [],
    means: 'Bank, transfer or platform fees, or tax withheld, come off what you receive. An international wire can lose a few percent to fees on the way. Tax withholding can often be avoided: US clients usually need only a W-8BEN form, and other countries take a tax residency certificate under their treaty with India.',
    ask: 'They pay the full invoice amount and their own bank\'s fees. If they say they must withhold tax, ask which treaty form would let them pay in full.',
    better: '{client} will pay each invoice in full, without deducting bank, transfer or platform fees, and bears its own bank\'s charges. No tax will be withheld where {me} provides the tax residency documents that the applicable tax treaty requires.',
    reply: 'Fees and tax: could invoices be paid in full, with each side covering its own bank\'s fees? If withholding tax comes up, I can provide a W-8BEN or tax residency certificate.',
    why: 'As written, {note} would come out of the fee, and on an international payment that adds up quickly.',
    find(text, segs) {
      return each(segs, (t) => {
        if (new RegExp(`${FEE}[^.;]{0,80}?\\b(?:borne|paid|deducted|absorbed|for\\s+the\\s+account)\\s+(?:by|of|from)\\s+(?:the\\s+)?(?:contractor|consultant|freelancer|service\\s+provider|supplier|vendor|developer|designer|you|payee)\\b|${FEE}[^.;]{0,40}?\\bdeducted\\s+from\\s+(?:the\\s+)?(?:amounts?|payments?|fees?|invoices?)|\\b(?:net\\s+of|less)\\s+(?:all\\s+|any\\s+)?(?:applicable\\s+)?${FEE}`, 'i').test(t)) return { note: 'transfer fees' };
        if (/(?<!\b(?:not|never)\s)\b(?:deduct|withhold)(?:s|ed|ing)?\s+(?:from\s+(?:any\s+)?(?:payments?|amounts?)\s+)?(?:any\s+|all\s+)?(?:applicable\s+)?(?:withholding\s+)?tax(?:es)?\b|\bsubject\s+to\s+(?:any\s+)?(?:applicable\s+)?withholding\s+tax/i.test(t)) return { note: 'withholding tax' };
        return null;
      });
    },
  },
  {
    id: 'scope',
    level: 'red',
    title: 'Non-compete reaches too far',
    supersedes: ['noncompete'],
    means: 'It limits your work after this contract ends, across a wide region or a whole industry. Indian courts rarely enforce a non-compete after a contract ends, but this contract may be decided under another country\'s law, and a client can still use it to hold back payment or threaten a claim.',
    ask: 'Remove it. If they insist, limit it to a short list of named direct competitors, for the length of the project only, and ask to be paid for the restriction.',
    better: 'During the term of this Agreement only, {me} will not provide the same services to the companies named in Schedule [X]. Nothing in this Agreement stops {me} from working for any other client.',
    reply: 'Non-compete: I work with clients in several countries, so I cannot agree to a restriction that covers {note}. Could we limit it to named direct competitors for the length of the project?',
    why: 'As written it covers {note}, which would stop me taking work I rely on.',
    find(text, segs) {
      return each(segs, (t) => {
        if (!/\bnon-?compet\w*|\bnot\s+(?:to\s+)?compete\b|\b(?:shall|will|may)\s+not\b[^.;]{0,80}\b(?:compet\w*|engage\s+in|be\s+engaged\s+in|provide\s+(?:[a-z-]+\s+){0,4}services?\s+(?:to|for)|work\s+for|write\s+for|accept\s+(?:work|engagements?|projects?)\s+from|be\s+employed\s+by|perform\s+(?:[a-z-]+\s+){0,3}services\s+for)\b/i.test(t)) return null;
        if (/\bsolicit/i.test(t) && !/\bcompet/i.test(t)) return null;
        const parts = [];
        const after = t.match(/\b((?:[a-z-]+\s+)?\(?\d{1,2}\)?|[a-z-]+)\s+(months?|years?)\s+(?:thereafter|after(?=\s*[,;)])|(?:after|following|from)\s+(?:the\s+|its\s+|such\s+)?(?:date\s+of\s+)?(?:termination|expiration|expiry|end|completion|delivery)|after\s+(?:this\s+agreement|the\s+(?:agreement|term|engagement|services|project))\s+(?:ends|terminates|expires))/i);

        if (after) {
          const n = num(after[1]);
          if (n) parts.push(`${n} ${/year/i.test(after[2]) ? (n > 1 ? 'years' : 'year') : (n > 1 ? 'months' : 'month')} after the contract ends`);
        }
        const where = t.match(/\b(worldwide|anywhere\s+in\s+the\s+world|throughout\s+the\s+world|globally|North\s+America|the\s+United\s+States|Europe|the\s+European\s+Union|the\s+Territory|anywhere\s+in\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
        if (where) parts.push(where[1].replace(/\s+/g, ' '));
        const broad = /\bany\s+(?:other\s+)?(?:business|company|person|entity|client|customer|competitor|competing|third\s+party|organi[sz]ation|publication|agency|brand)\b/i.test(t) && !/\bnamed\b|\blisted\s+in\b|\bschedule\b/i.test(t);
        if (!parts.length && !broad) return null;
        if (!parts.length) parts.push('any business in the field');
        return { note: parts.join(', ') };
      });
    },
  },
  {
    id: 'killfee',
    level: 'red',
    title: 'Cancelled work goes unpaid',
    supersedes: ['walkaway'],
    means: 'If the contract ends early, you are paid only for finished, accepted work, or nothing at all. Work in progress at that point goes unpaid, and from abroad you have little way to argue about it.',
    ask: 'Payment for all work done up to the end date, at the agreed rate, plus a kill fee of 25 to 50% of the remaining fee if they cancel without cause.',
    better: 'If {client} ends this Agreement for any reason other than {me}\'s uncured breach, {client} will pay, within 15 days, for all work done up to the end date, any expenses already incurred, and a cancellation fee of 25% of the fees for the remaining work.',
    reply: 'Cancellation: if the project ends early, could I be paid for all work done up to that date, plus a kill fee of [25]% of the remaining fee?',
    why: 'As written, if the project ends early, {note}, so I could do weeks of work and not be paid for it.',
    find(text, segs) {
      return each(segs, (t, prev) => {
        if (!/\b(?:terminat\w+|cancel\w*|end\s+this\s+agreement|early\s+end)\b/i.test(`${prev} ${t}`)) return null;
        if (/\b(?:pay|compensate)\s+(?:the\s+[a-z]+\s+)?only\s+for\s+(?:the\s+)?(?:[a-z-]+\s+){0,2}(?:deliverables|work|services|milestones)[^.;]{0,60}?\b(?:accepted|approved|delivered\s+and\s+accepted|completed\s+and\s+accepted)\b/i.test(t)) return { note: 'only accepted work is paid' };
        if (/\bno\s+(?:further\s+)?(?:payments?|compensation|fees?|amounts?)\s+(?:shall\s+be|will\s+be|is|are)\s+(?:due|payable|owed|owing)|\b(?:not|no\s+longer)\s+be\s+(?:entitled|liable)\s+(?:to|for)\s+(?:any\s+)?(?:further\s+)?(?:payments?|compensation|fees?)|\bshall\s+have\s+no\s+(?:further\s+)?(?:obligation|liability)\s+to\s+(?:pay|make\s+(?:any\s+)?payments?)|\bforfeit\w*\s+(?:any|all)\s+(?:unpaid\s+|outstanding\s+)?(?:fees?|payments?|compensation)|\bowes?\s+nothing\b|\bnothing\s+(?:is|will\s+be|shall\s+be)\s+(?:owed|payable|due)\b|\bwithout\s+(?:any\s+)?(?:further\s+)?(?:payment|compensation)\s+(?:to|of)\s+(?:the\s+)?(?:contractor|consultant|freelancer|developer|designer)/i.test(t)) return { note: 'nothing is owed for work in progress' };
        return null;
      });
    },
  },
];

export const PACK_BY_ID = Object.fromEntries(PACK.map((r) => [r.id, r]));
