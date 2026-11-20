// Hands a contract the popup picked up to ClauseGuard's page when it asks. The contract waits
// in chrome.storage.session: this browser's memory only, never synced, gone when Chrome closes.
import { APP_PAGES } from './jobs.js';

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'clauseguard:job' || !/^[0-9a-f-]{36}$/.test(msg.id ?? '')) return false;
  if (!APP_PAGES.some((page) => sender.url?.startsWith(page))) return false;
  const key = `job:${msg.id}`;
  chrome.storage.session.get(key).then((r) => reply(r[key] ?? null));
  return true;
});
