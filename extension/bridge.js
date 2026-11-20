// Runs only on ClauseGuard's own page. When the extension opened it with ?job=…, this passes
// the contract from the extension's memory into the page, inside this tab.
const job = new URLSearchParams(location.search).get('job');
if (job) {
  const contract = chrome.runtime.sendMessage({ type: 'clauseguard:job', id: job });
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.type !== 'clauseguard:ready') return;
    window.postMessage({ type: 'clauseguard:contract', contract: await contract }, location.origin);
  });
}
