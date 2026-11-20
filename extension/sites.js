// Injected into the tab you are looking at, only when you click the extension. Finds the
// contract's text, or pictures of its pages, and returns them to the popup. The only
// requests it makes go to the site you are on, the same ones its own download button makes.

(() => {
  const S = (globalThis.clauseguardSites ??= {});

  /** "/document/d/ID/edit" or "/document/u/1/d/ID/edit" -> the document's base path. */
  S.docsBase = (pathname) => pathname.match(/^\/document\/(?:u\/\d+\/)?d\/[\w-]+/)?.[0] ?? null;

  /** Big, upright, page-shaped pictures: how viewers that draw pages as images show them. */
  S.pageLike = (w, h) => w >= 500 && h >= 600 && h / w > 1.15 && h / w < 1.6;

  /** Text from Google Docs' basic HTML view, one paragraph per line. */
  S.blocksText = (root) => [...root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li')]
    .map((el) => el.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

  // Google Docs draws text on a canvas, so the page itself has no text to read. Its
  // plain-text export does: a same-origin request that redirects to a signed download
  // link. If that is blocked, the basic HTML view has the same text.
  async function googleDocs() {
    const base = S.docsBase(location.pathname);
    if (!base) return { error: 'Open a Google Docs document, not Sheets or Slides, and click again.' };
    const title = document.title.replace(/\s+-\s+Google Docs$/, '');
    try {
      const r = await fetch(`${base}/export?format=txt`);
      const text = r.ok ? (await r.text()).replace(/^﻿/, '') : '';
      if (text.trim()) return { source: 'Google Docs', title, text };
    } catch (err) {
      console.warn('ClauseGuard: the text export failed, trying the basic view', err);
    }
    const r = await fetch(`${base}/mobilebasic`);
    if (r.ok) {
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const text = S.blocksText(doc.querySelector('.doc-content') ?? doc.body);
      if (text.trim()) return { source: 'Google Docs', title, text };
    }
    return { error: 'Google Docs would not share this document\'s text. If the owner turned off downloading and copying, ClauseGuard cannot read it either. Ask them for a PDF.' };
  }

  // Viewers built on PDF.js and similar keep a hidden text layer over each page.
  function textLayers() {
    const text = [...document.querySelectorAll('.textLayer, [class*="text-layer"], [class*="textLayer"]')]
      .map((el) => el.innerText.trim()).filter(Boolean).join('\n\n');
    return text.length > 400 ? text : null;
  }

  const asDataUrl = (blob) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });

  // DocuSign shows most documents as one picture per page. These are read by the page's
  // own origin with its own sign-in, exactly as the viewer loads them.
  async function pageImages() {
    const els = [...document.querySelectorAll('img, canvas')]
      .filter((el) => S.pageLike(el.naturalWidth || el.width, el.naturalHeight || el.height));
    const out = [];
    for (const el of els.slice(0, 40)) {
      try {
        if (el.tagName === 'CANVAS') out.push(el.toDataURL('image/jpeg', 0.92));
        else out.push(await asDataUrl(await (await fetch(el.currentSrc || el.src, { credentials: 'include' })).blob()));
      } catch (err) {
        console.warn('ClauseGuard: could not read one page image', err);
      }
    }
    return out;
  }

  globalThis.clauseguardGrab = async () => {
    const selected = String(globalThis.getSelection?.() ?? '').trim();
    if (selected.length > 200) return { source: 'your selection', title: document.title, text: selected };
    if (location.hostname === 'docs.google.com') return googleDocs();
    const layer = textLayers();
    if (layer) return { source: location.hostname, title: document.title, text: layer };
    if (/(^|\.)docusign\.(net|com)$/.test(location.hostname)) {
      const images = await pageImages();
      if (images.length) return { source: 'DocuSign', title: document.title, images };
      return { error: 'DocuSign is not showing the pages as pictures ClauseGuard can reach. Scroll through every page and try again, or use Other actions, then Download, and drop the PDF into ClauseGuard.' };
    }
    // Any other page: its visible text, from the top frame only, so a busy sidebar never wins.
    const text = window === window.top ? document.body?.innerText.trim() ?? '' : '';
    if (text.length > 1000) return { source: location.hostname, title: document.title, text };
    return { error: 'No contract text found on this page. Select the contract\'s text and click again.' };
  };
})();
