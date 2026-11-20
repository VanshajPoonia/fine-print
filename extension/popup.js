// Reads the contract from the tab you are on, keeps it in this browser's memory
// (chrome.storage.session, never synced or saved to disk), and opens ClauseGuard to check it.
import { APP, JOB_TTL_MS, pick } from './jobs.js';

const $ = (s) => document.querySelector(s);
const say = (msg) => { $('#status').textContent = msg; };

$('#go').addEventListener('click', async () => {
  $('#go').disabled = true;
  say('Reading the contract on this page…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const target = { tabId: tab.id, allFrames: true };
    await chrome.scripting.executeScript({ target, files: ['sites.js'] });
    const results = await chrome.scripting.executeScript({ target, func: () => globalThis.clauseguardGrab() });
    const found = pick(results.map((r) => r.result));
    if (!found || found.error) {
      say(found?.error ?? 'No contract found on this page.');
      return;
    }
    const all = await chrome.storage.session.get(null);
    const stale = Object.keys(all).filter((k) => k.startsWith('job:') && Date.now() - all[k].at > JOB_TTL_MS);
    if (stale.length) await chrome.storage.session.remove(stale);
    const id = crypto.randomUUID();
    await chrome.storage.session.set({ [`job:${id}`]: { ...found, at: Date.now() } });
    await chrome.tabs.create({ url: `${APP}?job=${id}` });
    window.close();
  } catch (err) {
    say(/cannot access|cannot be scripted|chrome:\/\//i.test(err.message)
      ? 'Chrome does not let extensions read this kind of page.'
      : `Something went wrong: ${err.message}`);
  } finally {
    $('#go').disabled = false;
  }
});
