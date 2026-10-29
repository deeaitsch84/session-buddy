import { describe, expect, it } from 'vitest';
import { agentSessionFromUrl, applyTitlePrefix, fromChromeCookie, sessionForGroup, type Session } from '../src/sessions';

const sessions: Session[] = [
  { id: '1', name: 'Admin', color: 'red' },
  { id: '2', name: 'User', color: 'blue' },
];

describe('sessions', () => {
  it('relinks a restored group by name and color', () => {
    expect(sessionForGroup(sessions, 'User', 'blue')?.id).toBe('2');
    expect(sessionForGroup(sessions, 'User', 'red')).toBeUndefined();
    expect(sessionForGroup(sessions, undefined, 'red')).toBeUndefined();
  });

  it('prefixes titles idempotently and handles rename/removal', () => {
    expect(applyTitlePrefix('Home', 'Admin')).toBe('[Admin] Home');
    expect(applyTitlePrefix('[Admin] Home', 'Admin')).toBe('[Admin] Home');
    expect(applyTitlePrefix('[Admin] Home', 'Boss', 'Admin')).toBe('[Boss] Home');
    expect(applyTitlePrefix('[Admin] Home', null, 'Admin')).toBe('Home');
  });

  it('converts chrome cookies', () => {
    const c = fromChromeCookie({
      name: 'a', value: 'b', domain: '.X.com', path: '/', hostOnly: false, session: false, expirationDate: 10,
    });
    expect(c).toEqual({ name: 'a', value: 'b', domain: 'x.com', path: '/', hostOnly: false, expires: 10000 });
    expect(fromChromeCookie({ name: 'a', value: 'b', domain: 'x.com', path: '/', hostOnly: true, session: true }).expires).toBeUndefined();
  });
});

describe('agentSessionFromUrl', () => {
  it('resolves the session by name and strips the fragment', () => {
    expect(agentSessionFromUrl('https://app.x/a?q=1#sb=Admin&k=t0k', sessions, 't0k')).toEqual({
      session: sessions[0],
      url: 'https://app.x/a?q=1',
    });
    expect(agentSessionFromUrl('https://app.x/#sb=user%20&k=t0k', sessions, 't0k')?.session.id).toBe('2');
    expect(agentSessionFromUrl('https://app.x/#sb=ADMIN&k=t0k', sessions, 't0k')?.session.id).toBe('1');
  });

  it('ignores wrong or missing tokens, unknown sessions and non-http urls', () => {
    expect(agentSessionFromUrl('https://app.x/#sb=Admin&k=nope', sessions, 't0k')).toBeNull();
    expect(agentSessionFromUrl('https://app.x/#sb=Admin', sessions, 't0k')).toBeNull();
    expect(agentSessionFromUrl('https://app.x/#sb=Admin&k=', sessions, '')).toBeNull();
    expect(agentSessionFromUrl('https://app.x/#sb=Boss&k=t0k', sessions, 't0k')).toBeNull();
    expect(agentSessionFromUrl('chrome://x/#sb=Admin&k=t0k', sessions, 't0k')).toBeNull();
  });
});
