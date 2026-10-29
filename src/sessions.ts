import type { StoredCookie } from './jar';

export const GROUP_COLORS = ['blue', 'red', 'green', 'yellow', 'purple', 'pink', 'cyan', 'orange', 'grey'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export const COLOR_HEX: Record<GroupColor, string> = {
  blue: '#1a73e8',
  red: '#d93025',
  green: '#188038',
  yellow: '#f9ab00',
  purple: '#9334e6',
  pink: '#d01884',
  cyan: '#007b83',
  orange: '#e8710a',
  grey: '#5f6368',
};

export interface Session {
  id: string;
  name: string;
  color: GroupColor;
}

/** Re-links a restored tab group to its session by name and color. */
export function sessionForGroup(sessions: Session[], title: string | undefined, color: string): Session | undefined {
  return sessions.find((s) => s.name === title && s.color === color);
}

export function prefixFor(name: string): string {
  return `[${name}] `;
}

export function applyTitlePrefix(title: string, name: string | null, previousName: string | null = null): string {
  let base = title;
  for (const n of [previousName, name]) {
    if (n && base.startsWith(prefixFor(n))) base = base.slice(prefixFor(n).length);
  }
  return name ? prefixFor(name) + base : base;
}

export interface ChromeCookieLike {
  name: string;
  value: string;
  domain: string;
  path: string;
  hostOnly: boolean;
  httpOnly?: boolean;
  session: boolean;
  expirationDate?: number;
}

export function fromChromeCookie(c: ChromeCookieLike): StoredCookie {
  return {
    name: c.name,
    value: c.value,
    path: c.path,
    domain: c.domain.replace(/^\./, '').toLowerCase(),
    hostOnly: c.hostOnly,
    httpOnly: c.httpOnly || undefined,
    expires: c.session || c.expirationDate === undefined ? undefined : c.expirationDate * 1000,
  };
}

/**
 * Agent trigger: a URL whose fragment is `sb=<session name>&k=<agent token>` puts its tab into that session.
 * Names match case-insensitively.
 * Returns the session and the URL without the fragment.
 */
// shortcut: the whole fragment is dropped, so hash-routed SPAs land on their start route; keep other params if that bites.
export function agentSessionFromUrl(url: string, sessions: Session[], token: string): { session: Session; url: string } | null {
  if (!token || !/^https?:/.test(url)) return null;
  const u = new URL(url);
  const params = new URLSearchParams(u.hash.slice(1));
  if (params.get('k') !== token) return null;
  const name = params.get('sb')?.trim().toLowerCase();
  const session = sessions.find((s) => s.name.trim().toLowerCase() === name);
  if (!session) return null;
  u.hash = '';
  return { session, url: u.href };
}
