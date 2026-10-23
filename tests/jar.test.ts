import { describe, expect, it } from 'vitest';
import { cookieHeaderFor, parseSetCookie, setCookie, type Jar } from '../src/jar';

describe('jar', () => {
  it('keeps host-only cookies per host', () => {
    const jar: Jar = {};
    setCookie(jar, parseSetCookie('sid=a', 'staging.x.com')!);
    expect(cookieHeaderFor(jar, 'staging.x.com')).toBe('sid=a');
    expect(cookieHeaderFor(jar, 'demo.x.com')).toBe('');
  });

  it('shares domain cookies with subdomains', () => {
    const jar: Jar = {};
    setCookie(jar, parseSetCookie('sid=a; Domain=.x.com', 'staging.x.com')!);
    expect(cookieHeaderFor(jar, 'demo.x.com')).toBe('sid=a');
    expect(cookieHeaderFor(jar, 'evilx.com')).toBe('');
  });

  it('honours path and deletion via Max-Age=0', () => {
    const jar: Jar = {};
    setCookie(jar, parseSetCookie('a=1; Path=/app', 'h.com')!);
    expect(cookieHeaderFor(jar, 'h.com', '/')).toBe('');
    expect(cookieHeaderFor(jar, 'h.com', '/app/x')).toBe('a=1');
    setCookie(jar, parseSetCookie('a=; Path=/app; Max-Age=0', 'h.com')!);
    expect(cookieHeaderFor(jar, 'h.com', '/app')).toBe('');
  });
});
