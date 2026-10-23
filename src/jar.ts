export interface StoredCookie {
  name: string;
  value: string;
  path: string;
  domain: string; // lowercase, no leading dot
  hostOnly: boolean;
  httpOnly?: boolean; // hidden from document.cookie
  expires?: number; // epoch ms
}

export function parseSetCookie(header: string, requestHost: string, now = Date.now()): StoredCookie | null {
  const [pair = '', ...attrs] = header.split(';').map((s) => s.trim());
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const cookie: StoredCookie = {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    path: '/',
    domain: requestHost.toLowerCase(),
    hostOnly: true,
  };
  for (const attr of attrs) {
    const i = attr.indexOf('=');
    const key = (i < 0 ? attr : attr.slice(0, i)).toLowerCase();
    const val = i < 0 ? '' : attr.slice(i + 1);
    if (key === 'domain' && val) {
      cookie.domain = val.replace(/^\./, '').toLowerCase();
      cookie.hostOnly = false;
    } else if (key === 'path' && val.startsWith('/')) {
      cookie.path = val;
    } else if (key === 'httponly') {
      cookie.httpOnly = true;
    } else if (key === 'max-age') {
      cookie.expires = now + Number(val) * 1000;
    } else if (key === 'expires' && cookie.expires === undefined) {
      const t = Date.parse(val);
      if (!Number.isNaN(t)) cookie.expires = t;
    }
  }
  return cookie;
}

function domainMatches(c: StoredCookie, host: string): boolean {
  host = host.toLowerCase();
  return c.hostOnly ? host === c.domain : host === c.domain || host.endsWith('.' + c.domain);
}

function pathMatches(c: StoredCookie, path: string): boolean {
  return path === c.path || path.startsWith(c.path.endsWith('/') ? c.path : c.path + '/');
}

/** Keyed by "domain|path|name". */
export type Jar = Record<string, StoredCookie>;

export function setCookie(jar: Jar, c: StoredCookie, now = Date.now()): void {
  const key = `${c.domain}|${c.path}|${c.name}`;
  if (c.expires !== undefined && c.expires <= now) delete jar[key];
  else jar[key] = c;
}

/** `path` undefined ignores path matching (needed for static DNR rules). */
export function cookieHeaderFor(jar: Jar, host: string, path?: string, now = Date.now()): string {
  return Object.values(jar)
    .filter(
      (c) =>
        (c.expires === undefined || c.expires > now) &&
        domainMatches(c, host) &&
        (path === undefined || pathMatches(c, path)),
    )
    .sort((a, b) => b.path.length - a.path.length)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}
