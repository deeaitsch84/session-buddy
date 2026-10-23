import type { StoredCookie } from './jar';

export interface HookInit {
  sessionId: string;
  cookies: StoredCookie[];
}

/**
 * Injected into the page (MAIN world) via chrome.scripting.executeScript, so it is serialized
 * with toString(): it must stay fully self-contained (no imports or module-level helpers).
 * Isolates localStorage by key prefix and document.cookie by an in-page copy of the session jar.
 */
export function pageHook(init: HookInit): void {
  if ((window as any).__sbHooked) return;
  Object.defineProperty(window, '__sbHooked', { value: true });

  // --- localStorage: every key is stored under a per-session prefix ---
  let real: Storage | null = null;
  try {
    real = window.localStorage;
  } catch {
    real = null;
  }
  if (real) {
    const store = real;
    const prefix = '__sb:' + init.sessionId + ':';
    const owned = (): string[] => {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k !== null && k.startsWith(prefix)) keys.push(k.slice(prefix.length));
      }
      return keys;
    };
    const methods: Record<string, unknown> = {
      getItem: (k: unknown) => store.getItem(prefix + String(k)),
      setItem: (k: unknown, v: unknown) => store.setItem(prefix + String(k), String(v)),
      removeItem: (k: unknown) => store.removeItem(prefix + String(k)),
      clear: () => owned().forEach((k) => store.removeItem(prefix + k)),
      key: (i: unknown) => owned()[Number(i)] ?? null,
    };
    const proxy = new Proxy({} as Record<string, unknown>, {
      get(_t, p) {
        if (typeof p === 'symbol') return p === Symbol.toStringTag ? 'Storage' : undefined;
        if (p === 'length') return owned().length;
        if (Object.prototype.hasOwnProperty.call(methods, p)) return methods[p];
        const v = store.getItem(prefix + p);
        return v === null ? undefined : v;
      },
      set(_t, p, v) {
        if (typeof p === 'string') store.setItem(prefix + p, String(v));
        return true;
      },
      deleteProperty(_t, p) {
        if (typeof p === 'string') store.removeItem(prefix + p);
        return true;
      },
      has(_t, p) {
        return typeof p === 'string' && (Object.prototype.hasOwnProperty.call(methods, p) || store.getItem(prefix + p) !== null);
      },
      ownKeys: () => owned(),
      getOwnPropertyDescriptor(_t, p) {
        if (typeof p !== 'string') return undefined;
        const v = store.getItem(prefix + p);
        return v === null ? undefined : { value: v, enumerable: true, configurable: true, writable: true };
      },
    });
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => proxy });
  }

  // --- document.cookie: backed by an in-page copy of the session jar ---
  let cookies: StoredCookie[] = init.cookies.slice();
  const host = location.hostname.toLowerCase();
  const matches = (c: StoredCookie): boolean => {
    const domainOk = c.hostOnly ? host === c.domain : host === c.domain || host.endsWith('.' + c.domain);
    const dir = c.path.endsWith('/') ? c.path : c.path + '/';
    const pathOk = location.pathname === c.path || location.pathname.startsWith(dir);
    return domainOk && pathOk && (c.expires === undefined || c.expires > Date.now());
  };
  const defaultPath = (): string => {
    const i = location.pathname.lastIndexOf('/');
    return i <= 0 ? '/' : location.pathname.slice(0, i);
  };

  const write = (raw: string): void => {
    if (/;\s*httponly/i.test(raw)) return;
    const withPath = /;\s*path=/i.test(raw) ? raw : raw + '; Path=' + defaultPath();
    const [pair = '', ...attrs] = withPath.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    if (eq <= 0) return;
    const c: StoredCookie = {
      name: pair.slice(0, eq),
      value: pair.slice(eq + 1),
      path: '/',
      domain: host,
      hostOnly: true,
    };
    for (const attr of attrs) {
      const i = attr.indexOf('=');
      const key = (i < 0 ? attr : attr.slice(0, i)).toLowerCase();
      const val = i < 0 ? '' : attr.slice(i + 1);
      if (key === 'domain' && val) {
        c.domain = val.replace(/^\./, '').toLowerCase();
        c.hostOnly = false;
      } else if (key === 'path' && val.startsWith('/')) c.path = val;
      else if (key === 'max-age') c.expires = Date.now() + Number(val) * 1000;
      else if (key === 'expires' && c.expires === undefined) {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) c.expires = t;
      }
    }
    cookies = cookies.filter((o) => !(o.name === c.name && o.domain === c.domain && o.path === c.path));
    if (c.expires === undefined || c.expires > Date.now()) cookies.push(c);
    document.dispatchEvent(new CustomEvent('sb:cookie-write', { detail: withPath }));
  };

  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () =>
      cookies
        .filter(matches)
        .sort((a, b) => b.path.length - a.path.length)
        .map((c) => c.name + '=' + c.value)
        .join('; '),
    set: (v: unknown) => write(String(v)),
  });

  document.addEventListener('sb:cookies', (e) => {
    try {
      cookies = JSON.parse(String((e as CustomEvent).detail));
    } catch {
      /* ignore malformed updates */
    }
  });
}
