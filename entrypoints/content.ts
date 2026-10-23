import { applyTitlePrefix } from '../src/sessions';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  main() {
    // Relay between the page-world hook (CustomEvents on the shared DOM) and the background.
    document.addEventListener('sb:cookie-write', (e) => {
      const header = (e as CustomEvent).detail;
      if (typeof header === 'string') chrome.runtime.sendMessage({ type: 'cookieWrite', header }).catch(() => {});
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'cookies') document.dispatchEvent(new CustomEvent('sb:cookies', { detail: JSON.stringify(msg.cookies) }));
    });

    if (window !== window.top) return;

    let current: string | null = null;
    let observer: MutationObserver | undefined;

    function apply(name: string | null) {
      const previous = current;
      current = name;
      const next = applyTitlePrefix(document.title, name, previous);
      if (next !== document.title) {
        observer?.disconnect();
        document.title = next;
        observe();
      }
    }

    function observe() {
      const el = document.querySelector('title');
      if (!el) return;
      observer ??= new MutationObserver(() => apply(current));
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    }

    // <title> may not exist yet at document_start.
    document.addEventListener('DOMContentLoaded', () => {
      observe();
      apply(current);
    });
    chrome.runtime.sendMessage({ type: 'getTabSession' }).then((r) => apply(r?.name ?? null)).catch(() => {});
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'session') apply(msg.name);
    });
  },
});
