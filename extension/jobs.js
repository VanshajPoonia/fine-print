// Shared by the popup and the service worker.

// ClauseGuard's page, plus the local server from `npm start` for testing.
export const APP = 'https://vanshajpoonia.github.io/fine-print/';
export const APP_PAGES = [APP, 'http://localhost:8000/'];

// A picked-up contract waits this long for ClauseGuard's page to ask for it.
export const JOB_TTL_MS = 10 * 60 * 1000;

/** The best of what each frame found: the longest text, else the most page pictures, else why not. */
export function pick(found) {
  const ok = found.filter((f) => f && !f.error);
  const text = ok.filter((f) => f.text).sort((a, b) => b.text.length - a.text.length)[0];
  if (text) return text;
  const pages = ok.filter((f) => f.images?.length).sort((a, b) => b.images.length - a.images.length)[0];
  return pages ?? found.find((f) => f?.error) ?? null;
}
