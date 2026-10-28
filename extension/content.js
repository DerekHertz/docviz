// Injected on demand (and on every page when the highlight chip is enabled).
// Knows nothing about models: it splits the page into sections, places card
// iframes, and shows progress. Cards render inside extension iframes so page
// CSS and CSP can't touch them.
(() => {
  if (window.__docviz) return;
  window.__docviz = true;

  const CARD_URL = chrome.runtime.getURL('card.html');
  const EXT_ORIGIN = new URL(CARD_URL).origin;
  const MAX_SECTIONS = 60;
  const MAX_SECTION_CHARS = 8000;
  const MIN_SECTION_CHARS = 120;

  const anchors = new Map(); // sectionId -> heading element
  const hosts = new Map(); // card key -> { host, iframe }

  // ---------- extraction ----------

  const HEADINGS = 'h1,h2,h3,h4';
  const CHROME = 'nav,aside,footer,[role=navigation],[role=complementary],[aria-hidden=true]';

  function visible(el) {
    return el.getClientRects().length > 0 && !el.closest(CHROME) && !el.closest('.docviz-host');
  }

  function pickRoot() {
    const candidates = ['main article', 'article', 'main', '[role=main]', '.markdown-body', '#content', '.content', '.documentation'];
    for (const sel of candidates) {
      for (const el of document.querySelectorAll(sel)) {
        if ([...el.querySelectorAll(HEADINGS)].filter(visible).length >= 2) return el;
      }
    }
    return document.body;
  }

  const level = (h) => Number(h.tagName[1]);

  function clean(text) {
    return text.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  }

  function extract() {
    anchors.clear();
    const root = pickRoot();
    const all = [...root.querySelectorAll(HEADINGS)].filter(visible);
    const page = { url: location.href, title: document.title };

    if (!all.length) {
      const text = clean(root.innerText || '').slice(0, MAX_SECTION_CHARS * 2);
      if (text.length < MIN_SECTION_CHARS) return { page, sections: [] };
      const first = root.querySelector('p, pre, li') || root.firstElementChild;
      anchors.set('s0', first);
      return { page, sections: [{ id: 's0', heading: document.title, text }] };
    }

    // Split at the shallowest sub-heading level that repeats, so an h2 section
    // carries its h3s instead of shattering into fragments.
    const counts = { 2: 0, 3: 0, 4: 0 };
    all.forEach((h) => { if (counts[level(h)] !== undefined) counts[level(h)]++; });
    const splitAt = [2, 3, 4].find((l) => counts[l] >= 2) || 4;
    const bounds = all.filter((h) => level(h) <= splitAt);

    const sections = [];
    bounds.forEach((h, i) => {
      const range = document.createRange();
      range.setStartAfter(h);
      if (bounds[i + 1]) range.setEndBefore(bounds[i + 1]);
      else range.setEndAfter(root.lastChild || root);
      const text = clean(range.toString());
      if (text.length < MIN_SECTION_CHARS) return;
      const id = `s${i}`;
      anchors.set(id, h);
      sections.push({ id, heading: clean(h.textContent).slice(0, 200), text: text.slice(0, MAX_SECTION_CHARS) });
    });
    return { page, sections: sections.slice(0, MAX_SECTIONS) };
  }

  // ---------- card frames ----------

  function frame(key) {
    const host = document.createElement('div');
    host.className = 'docviz-host';
    const iframe = document.createElement('iframe');
    iframe.src = `${CARD_URL}?key=${encodeURIComponent(key)}`;
    iframe.title = 'docviz diagram';
    iframe.setAttribute('allowtransparency', 'true');
    iframe.style.cssText = 'display:block;width:100%;height:150px;border:0;background:transparent;color-scheme:normal;';
    host.appendChild(iframe);
    hosts.set(key, { host, iframe });
    return host;
  }

  function insert(key, sectionId) {
    const anchor = anchors.get(sectionId);
    if (!anchor) return;
    const host = frame(key);
    host.style.cssText = 'margin:10px 0 18px;max-width:900px;clear:both;';
    // Keep cards for the same section in order after the heading.
    let after = anchor;
    while (after.nextElementSibling?.classList.contains('docviz-host')) after = after.nextElementSibling;
    after.insertAdjacentElement('afterend', host);
  }

  let popoverKey = null;
  function popover(key, rect) {
    closePopover();
    const host = frame(key);
    const width = Math.min(620, window.innerWidth - 24);
    const r = rect || { left: window.innerWidth / 2 - width / 2 + scrollX, bottom: scrollY + 80 };
    const left = Math.max(scrollX + 12, Math.min(r.left, scrollX + window.innerWidth - width - 12));
    host.style.cssText = `position:absolute;z-index:2147483646;top:${r.bottom + 8}px;left:${left}px;width:${width}px;` +
      'border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);';
    document.body.appendChild(host);
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    popoverKey = key;
  }
  function closePopover() {
    if (popoverKey) remove(popoverKey);
    popoverKey = null;
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });

  function remove(key) {
    hosts.get(key)?.host.remove();
    hosts.delete(key);
    if (key === popoverKey) popoverKey = null;
  }

  function clear() {
    for (const key of [...hosts.keys()]) if (key !== popoverKey) remove(key);
  }

  function scrollToCard(key) {
    const h = hosts.get(key);
    if (!h) return;
    h.host.scrollIntoView({ behavior: 'smooth', block: 'center' });
    h.host.animate([{ outline: '3px solid #d97757', outlineOffset: '4px' }, { outline: '3px solid transparent', outlineOffset: '4px' }], { duration: 1400 });
  }

  // Cards report their height; only trust our own extension frames.
  addEventListener('message', (e) => {
    if (e.origin !== EXT_ORIGIN || e.data?.docviz !== 'resize') return;
    const h = hosts.get(e.data.key);
    if (h && e.source === h.iframe.contentWindow) h.iframe.style.height = `${Math.ceil(e.data.height)}px`;
  });

  // ---------- toast ----------

  let toastEl = null;
  let toastTimer = null;
  function toast(text, tone) {
    if (!toastEl) {
      const host = document.createElement('div');
      host.className = 'docviz-host';
      host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        div{font:13px/1.4 system-ui,sans-serif;padding:9px 14px;border-radius:10px;background:#1f1e1d;color:#f5f4ef;
            box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:360px;transition:opacity .3s}
        div.error{background:#8a2a1c} div.hide{opacity:0}
      </style><div></div>`;
      document.documentElement.appendChild(host);
      toastEl = root.querySelector('div');
    }
    toastEl.textContent = text;
    toastEl.className = tone === 'error' ? 'error' : '';
    clearTimeout(toastTimer);
    if (tone === 'done' || tone === 'error') toastTimer = setTimeout(() => toastEl.classList.add('hide'), tone === 'error' ? 7000 : 3500);
  }

  // ---------- selection + optional chip ----------

  function selection() {
    const sel = getSelection();
    const text = sel?.toString() || '';
    if (!text.trim() || !sel.rangeCount) return { text: '' };
    const r = sel.getRangeAt(0).getBoundingClientRect();
    return { text, rect: { left: r.left + scrollX, bottom: r.bottom + scrollY } };
  }

  let chip = null;
  function hideChip() { chip?.remove(); chip = null; }
  chrome.storage.local.get('chip').then(({ chip: enabled }) => {
    if (!enabled) return;
    addEventListener('mouseup', (e) => {
      if (chip?.contains(e.target)) return;
      setTimeout(() => {
        hideChip();
        const sel = selection();
        if (sel.text.trim().length < 20) return;
        chip = document.createElement('button');
        chip.className = 'docviz-host';
        chip.textContent = '◆ Visualize';
        chip.style.cssText = `position:absolute;z-index:2147483646;top:${sel.rect.bottom + 6}px;left:${sel.rect.left}px;` +
          'font:600 12px system-ui,sans-serif;padding:5px 10px;border-radius:999px;border:0;background:#d97757;color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)';
        chip.addEventListener('mousedown', (ev) => ev.preventDefault());
        chip.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'chip:visualize', text: sel.text, rect: sel.rect });
          hideChip();
        });
        document.body.appendChild(chip);
      }, 0);
    });
    addEventListener('scroll', hideChip, { passive: true });
  });

  // ---------- messages from the service worker ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'extract': sendResponse(extract()); break;
      case 'selection': sendResponse(selection()); break;
      case 'insert': insert(msg.key, msg.sectionId); sendResponse(true); break;
      case 'popover': popover(msg.key, msg.rect); sendResponse(true); break;
      case 'remove': remove(msg.key); sendResponse(true); break;
      case 'clear': clear(); sendResponse(true); break;
      case 'scroll': scrollToCard(msg.key); sendResponse(true); break;
      case 'toast': toast(msg.text, msg.tone); sendResponse(true); break;
      default: return false;
    }
    return false;
  });
})();
