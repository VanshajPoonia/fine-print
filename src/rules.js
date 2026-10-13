// Freelancer problems that CUAD has no category for, so there is nothing to train or test a
// model on. These are plain pattern checks, shown in the app as "found by a rule", and
// tested in tests/unit.mjs. Nothing here is counted in the model's measured results.

const WORDS = { thirty: 30, forty: 40, 'forty-five': 45, sixty: 60, seventy: 70, 'seventy-five': 75, ninety: 90, 'one hundred twenty': 120, 'one hundred and twenty': 120 };

const days = (s) => {
  const n = s.match(/\d+/);
  if (n) return Number(n[0]);
  return WORDS[s.toLowerCase().trim()] ?? null;
};

export const RULES = [
  {
    id: 'slowpay',
    level: 'amber',
    title: 'Slow payment',
    means: 'You wait this long after invoicing to be paid. Net 30 is the usual ceiling for freelancers; past that, you are financing their project.',
    ask: 'Net 14 or net 30, a deposit up front (30 to 50% is common), and a late fee on overdue invoices.',
    reply: "Payment terms: could we move to net [30], with a [30]% deposit before work starts and a late fee on overdue invoices?",
    find(text) {
      const re = /\b(?:net\s*\(?(\d{2,3})\)?|within\s+((?:[a-z-]+(?:\s+(?:hundred(?:\s+and)?|and)\s+[a-z-]+)?\s*)?\(?\d{0,3}\)?)\s*(?:calendar\s+|business\s+)?days?\s+(?:of|after|following|from)\s+(?:the\s+)?(?:receipt|date|submission|approval|acceptance)[^.]{0,40}?invoice)/gi;
      const out = [];
      for (const m of text.matchAll(re)) {
        const n = days(m[1] ?? m[2] ?? '');
        if (n && n > 30) out.push({ start: m.index, end: m.index + m[0].length, note: `${n} days` });
      }
      return out;
    },
  },
  {
    id: 'satisfaction',
    level: 'amber',
    title: 'Paid only if they are satisfied',
    means: 'Acceptance, and so payment, depends on their opinion of the work rather than on a definition of done. A client can keep saying "not yet".',
    ask: 'Written acceptance criteria agreed up front, and work counts as accepted if they have not raised a specific problem within 5 to 10 business days.',
    reply: "Acceptance: could we agree written acceptance criteria up front, with work counted as accepted if no specific issue is raised within [5] business days?",
    find(text) {
      const re = /\b(?:to\s+(?:the\s+)?(?:client|company|customer)['’]s\s+(?:sole\s+|complete\s+|full\s+)?satisfaction|in\s+(?:its|the\s+(?:client|company)['’]s)\s+sole\s+(?:and\s+absolute\s+)?discretion[^.]{0,80}?(?:accept|approv)|satisfactory\s+to\s+(?:the\s+)?(?:client|company))/gi;
      return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
    },
  },
  {
    id: 'revisions',
    level: 'red',
    title: 'Unlimited revisions',
    means: 'There is no limit on rounds of changes, so the fixed fee can stretch to cover any amount of work.',
    ask: 'Two or three rounds of revisions included, then an hourly rate for more.',
    reply: "Revisions: my fee includes [two] rounds of revisions; further rounds would be billed at [rate] per hour.",
    find(text) {
      const re = /\b(?:unlimited|any\s+number\s+of|as\s+many)\s+(?:rounds?\s+of\s+)?(?:revisions?|changes|modifications|edits|iterations)\b|\b(?:revisions?|changes)\s+(?:as|until)\s+(?:requested|necessary|required)\s+(?:by\s+the\s+(?:client|company)\s+)?until\b/gi;
      return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
    },
  },
];

export const RULES_BY_ID = Object.fromEntries(RULES.map((r) => [r.id, r]));
