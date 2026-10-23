import type { GroupColor } from './sessions';

export type Message =
  | { type: 'getState' }
  | { type: 'createSession'; name: string; color: GroupColor }
  | { type: 'updateSession'; id: string; name: string; color: GroupColor }
  | { type: 'deleteSession'; id: string }
  | { type: 'clearCookies'; id: string }
  | { type: 'assignTab'; tabId: number; sessionId: string | null }
  | { type: 'importLogin'; tabId: number; sessionId: string }
  | { type: 'focusTab'; tabId: number }
  | { type: 'getTabSession' }
  | { type: 'cookieWrite'; header: string };
