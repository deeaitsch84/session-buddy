// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { pageHook } from '../src/pagehook';

class FakeStorage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

let raw: FakeStorage;
let doc: EventTarget & { cookie?: string };
let events: string[];

function setup(sessionId: string, cookies: any[] = [], path = '/app/page') {
  const win: any = { localStorage: raw };
  doc = new EventTarget();
  events = [];
  doc.addEventListener('sb:cookie-write', (e) => events.push((e as CustomEvent).detail));
  Object.assign(globalThis, { window: win, document: doc, location: { hostname: 'staging.x.com', pathname: path } });
  pageHook({ sessionId, cookies });
  return win;
}

beforeEach(() => {
  raw = new FakeStorage();
});

describe('pageHook localStorage', () => {
  it('isolates keys per session on the same storage', () => {
    const a = setup('A').localStorage;
    a.setItem('token', 'aaa');
    a.other = 'x';
    const b = setup('B').localStorage;
    expect(b.getItem('token')).toBeNull();
    b.setItem('token', 'bbb');
    expect(setup('A').localStorage.getItem('token')).toBe('aaa');
    expect(a.other).toBe('x');
    expect(Object.keys(a).sort()).toEqual(['other', 'token']);
    expect(raw.length).toBe(3);
  });

  it('clear only removes keys of the own session', () => {
    setup('A').localStorage.setItem('k', '1');
    const b = setup('B').localStorage;
    b.setItem('k', '2');
    b.clear();
    expect(b.length).toBe(0);
    expect(setup('A').localStorage.getItem('k')).toBe('1');
  });
});

describe('pageHook document.cookie', () => {
  const jarCookie = { name: 'sid', value: '1', path: '/', domain: 'staging.x.com', hostOnly: true };

  it('reads the session cookies and writes to the in-page copy and relay', () => {
    setup('A', [jarCookie]);
    expect(doc.cookie).toBe('sid=1');
    doc.cookie = 'theme=dark';
    expect(doc.cookie).toBe('theme=dark; sid=1');
    expect(events).toEqual(['theme=dark; Path=/app']);
  });

  it('removes expired cookies and ignores HttpOnly writes', () => {
    setup('A', [jarCookie]);
    doc.cookie = 'sid=; Path=/; Max-Age=0';
    expect(doc.cookie).toBe('');
    doc.cookie = 'x=1; HttpOnly';
    expect(events).toHaveLength(1);
  });

  it('accepts updates pushed from the background', () => {
    setup('A');
    doc.dispatchEvent(new CustomEvent('sb:cookies', { detail: JSON.stringify([jarCookie]) }));
    expect(doc.cookie).toBe('sid=1');
  });
});
