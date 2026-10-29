import { cookieHeaderFor, parseSetCookie, setCookie, type Jar, type StoredCookie } from '../src/jar';
import type { Message } from '../src/messages';
import { pageHook } from '../src/pagehook';
import {
  agentSessionFromUrl,
  COLOR_HEX,
  fromChromeCookie,
  sessionForGroup,
  type GroupColor,
  type Session,
} from '../src/sessions';

// jars[sessionId][host] -> Jar (one jar per host)
type Jars = Record<string, Record<string, Jar>>;

export default defineBackground(() => {
  const tabSession = new Map<number, string>();
  let sessions: Session[] = [];
  let jars: Jars = {};
  let agentToken = '';

  const sessionById = (id: string | undefined) => sessions.find((s) => s.id === id);
  const tabsOf = (sessionId: string) => [...tabSession].filter(([, s]) => s === sessionId).map(([t]) => t);

  /** Cookies the page may see through document.cookie (no HttpOnly), for one host of a session. */
  const visibleCookies = (sessionId: string, host: string): StoredCookie[] =>
    Object.values(jars[sessionId]?.[host] ?? {}).filter((c) => !c.httpOnly);

  const persist = () =>
    chrome.storage.local.set({ sessions, jars, tabSession: Object.fromEntries(tabSession) });

  // Rule ids must fit int32, so allocate sequentially instead of deriving them from tab ids.
  let queue: Promise<unknown> = Promise.resolve();
  const syncRules = (tabId: number) => {
    const run = queue.then(() => doSyncRules(tabId));
    queue = run.catch((e) => console.error('[session-buddy] syncRules failed', e));
    return run;
  };

  async function doSyncRules(tabId: number) {
    const session = tabSession.get(tabId);
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const removeRuleIds = existing.filter((r) => r.condition.tabIds?.includes(tabId)).map((r) => r.id);
    let nextId = existing.reduce((max, r) => Math.max(max, r.id), 0) + 1;
    const addRules: chrome.declarativeNetRequest.Rule[] = [];
    if (session) {
      const all = Object.values(chrome.declarativeNetRequest.ResourceType);
      addRules.push({
        id: nextId++,
        priority: 1,
        condition: { tabIds: [tabId], resourceTypes: all },
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Cookie', operation: 'remove' }],
          responseHeaders: [{ header: 'Set-Cookie', operation: 'remove' }],
        },
      } as chrome.declarativeNetRequest.Rule);
      for (const [host, jar] of Object.entries(jars[session] ?? {})) {
        const value = cookieHeaderFor(jar, host);
        if (!value) continue;
        addRules.push({
          id: nextId++,
          priority: 2,
          condition: { tabIds: [tabId], requestDomains: [host], resourceTypes: all },
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'Cookie', operation: 'set', value }],
          },
        } as chrome.declarativeNetRequest.Rule);
      }
    }
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
  }

  async function updateBadge(tabId: number) {
    const s = sessionById(tabSession.get(tabId));
    await chrome.action.setBadgeText({ tabId, text: s ? s.name.slice(0, 3) : '' }).catch(() => {});
    if (s) await chrome.action.setBadgeBackgroundColor({ tabId, color: COLOR_HEX[s.color] }).catch(() => {});
  }

  async function notifyTitle(tabId: number) {
    const s = sessionById(tabSession.get(tabId));
    await chrome.tabs.sendMessage(tabId, { type: 'session', name: s?.name ?? null }).catch(() => {});
  }

  async function applyGroup(tabId: number) {
    const s = sessionById(tabSession.get(tabId));
    try {
      const tab = await chrome.tabs.get(tabId);
      // Leave tabs in foreign groups alone, e.g. the tab group a browser agent works in.
      if (tab.groupId !== -1) {
        const g = await chrome.tabGroups.get(tab.groupId);
        if (!sessionForGroup(sessions, g.title, g.color)) return;
      }
      if (!s) {
        if (tab.groupId !== -1) await chrome.tabs.ungroup(tabId);
        return;
      }
      const groups = await chrome.tabGroups.query({ windowId: tab.windowId, title: s.name, color: s.color });
      const groupId = await chrome.tabs.group(
        groups[0] ? { tabIds: tabId, groupId: groups[0].id } : { tabIds: tabId },
      );
      if (!groups[0]) await chrome.tabGroups.update(groupId, { title: s.name, color: s.color });
    } catch (e) {
      console.warn('[session-buddy] grouping failed', e);
    }
  }

  async function refreshTab(tabId: number) {
    await Promise.all([syncRules(tabId), updateBadge(tabId), notifyTitle(tabId), applyGroup(tabId)]);
  }

  async function assign(tabId: number, sessionId: string | null, reload = true) {
    if (sessionId && sessionById(sessionId)) tabSession.set(tabId, sessionId);
    else tabSession.delete(tabId);
    await refreshTab(tabId);
    await persist();
    if (reload) await chrome.tabs.reload(tabId).catch(() => {});
    rebuildMenus();
  }

  // Context menu: "New tab in session X" for pages and links.
  function rebuildMenus() {
    chrome.contextMenus.removeAll(() => {
      if (!sessions.length) return;
      chrome.contextMenus.create({ id: 'new', title: 'Neuer Tab in Session', contexts: ['page', 'link'] });
      for (const s of sessions)
        chrome.contextMenus.create({ id: `new:${s.id}`, parentId: 'new', title: s.name, contexts: ['page', 'link'] });
    });
  }

  chrome.contextMenus.onClicked.addListener(async (info) => {
    const id = String(info.menuItemId);
    if (!id.startsWith('new:')) return;
    const url = info.linkUrl ?? info.pageUrl;
    const tab = await chrome.tabs.create({ url: 'about:blank' });
    if (tab.id === undefined) return;
    await assign(tab.id, id.slice(4), false);
    if (url) await chrome.tabs.update(tab.id, { url });
  });

  // Re-link tabs after startup: tab ids change, so match restored groups by name and color.
  async function reconcile() {
    const tabs = await chrome.tabs.query({});
    const ids = new Set(tabs.map((t) => t.id));
    for (const id of [...tabSession.keys()]) if (!ids.has(id) || !sessionById(tabSession.get(id))) tabSession.delete(id);
    for (const tab of tabs) {
      if (tab.id === undefined || tabSession.has(tab.id) || tab.groupId === -1) continue;
      const group = await chrome.tabGroups.get(tab.groupId).catch(() => undefined);
      const s = group && sessionForGroup(sessions, group.title, group.color);
      if (s) tabSession.set(tab.id, s.id);
    }
    await Promise.all([...tabSession.keys()].map((id) => Promise.all([syncRules(id), updateBadge(id), notifyTitle(id)])));
    await persist();
  }

  const loaded = (async () => {
    const d = await chrome.storage.local.get(['sessions', 'jars', 'tabSession', 'agentToken']);
    sessions = (d.sessions as Session[] | undefined) ?? [];
    jars = (d.jars as Jars | undefined) ?? {};
    agentToken = (d.agentToken as string | undefined) ?? crypto.randomUUID();
    if (!d.agentToken) await chrome.storage.local.set({ agentToken });
    // storage.session is wiped on browser restart / extension reload, as are tab ids and session rules.
    const alive = await chrome.storage.session.get('alive');
    if (!alive.alive) {
      await chrome.storage.session.set({ alive: true });
    } else {
      for (const [k, v] of Object.entries((d.tabSession as Record<string, string> | undefined) ?? {}))
        tabSession.set(Number(k), v);
    }
    await reconcile();
    rebuildMenus();
  })();

  async function getState() {
    const tabs = await chrome.tabs.query({});
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    return {
      sessions,
      agentToken,
      activeTabId: active?.id ?? null,
      activeSessionId: active?.id !== undefined ? (tabSession.get(active.id) ?? null) : null,
      tabs: tabs
        .filter((t) => t.id !== undefined && tabSession.has(t.id))
        .map((t) => ({ id: t.id!, sessionId: tabSession.get(t.id!)!, title: t.title ?? '', url: t.url ?? '', favIconUrl: t.favIconUrl ?? '', windowId: t.windowId })),
    };
  }

  async function handle(msg: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
    await loaded;
    switch (msg.type) {
      case 'getState':
        return getState();
      case 'getTabSession': {
        const tabId = sender.tab?.id;
        return { name: sessionById(tabId === undefined ? undefined : tabSession.get(tabId))?.name ?? null };
      }
      case 'createSession': {
        const name = msg.name.trim();
        if (!name) return;
        sessions.push({ id: crypto.randomUUID(), name, color: msg.color });
        await persist();
        rebuildMenus();
        return;
      }
      case 'updateSession': {
        const s = sessionById(msg.id);
        const name = msg.name.trim();
        if (!s || !name) return;
        // Rename the session's groups in place; afterwards they would no longer match it and count as foreign.
        const groups = await chrome.tabGroups.query({ title: s.name, color: s.color });
        s.name = name;
        s.color = msg.color;
        await Promise.all(groups.map((g) => chrome.tabGroups.update(g.id, { title: name, color: msg.color })));
        await persist();
        await Promise.all(tabsOf(s.id).map(refreshTab));
        rebuildMenus();
        return;
      }
      case 'deleteSession': {
        const ids = tabsOf(msg.id);
        sessions = sessions.filter((s) => s.id !== msg.id);
        delete jars[msg.id];
        ids.forEach((t) => tabSession.delete(t));
        await Promise.all(ids.map(refreshTab));
        await persist();
        await Promise.all(ids.map((t) => chrome.tabs.reload(t).catch(() => {})));
        rebuildMenus();
        return;
      }
      case 'clearCookies': {
        delete jars[msg.id];
        const ids = tabsOf(msg.id);
        await Promise.all(ids.map(syncRules));
        await persist();
        await Promise.all(ids.map((t) => chrome.tabs.reload(t).catch(() => {})));
        return;
      }
      case 'cookieWrite': {
        const tabId = sender.tab?.id;
        const sessionId = tabId === undefined ? undefined : tabSession.get(tabId);
        if (tabId === undefined || !sessionId || !sender.url || typeof msg.header !== 'string') return;
        const host = new URL(sender.url).hostname;
        const c = parseSetCookie(msg.header, host);
        if (!c) return;
        setCookie(((jars[sessionId] ??= {})[host] ??= {}), c);
        await persist();
        await syncRules(tabId);
        return;
      }
      case 'assignTab':
        return assign(msg.tabId, msg.sessionId);
      case 'importLogin': {
        const tab = await chrome.tabs.get(msg.tabId);
        if (!tab.url?.startsWith('http')) return;
        const host = new URL(tab.url).hostname;
        const cookies = await chrome.cookies.getAll({ url: tab.url });
        const jar = ((jars[msg.sessionId] ??= {})[host] ??= {});
        for (const c of cookies) setCookie(jar, fromChromeCookie(c));
        await assign(msg.tabId, msg.sessionId);
        return;
      }
      case 'focusTab': {
        const tab = await chrome.tabs.update(msg.tabId, { active: true });
        if (tab) await chrome.windows.update(tab.windowId, { focused: true });
        return;
      }
    }
  }

  chrome.webNavigation.onCommitted.addListener(async (details) => {
    await loaded;
    const sessionId = tabSession.get(details.tabId);
    if (!sessionId || !/^https?:/.test(details.url)) return;
    const host = new URL(details.url).hostname;
    await chrome.scripting
      .executeScript({
        target: { tabId: details.tabId, frameIds: [details.frameId] },
        world: 'MAIN',
        injectImmediately: true,
        func: pageHook,
        args: [{ sessionId, cookies: visibleCookies(sessionId, host) }],
      })
      .catch((e) => console.warn('[session-buddy] page hook failed', e));
  });

  // Agent trigger (e.g. claude-in-chrome): opening `<url>#sb=<session name>&k=<agent token>` puts the tab into that session.
  const onAgentUrl = async (details: { tabId: number; frameId: number; url: string }) => {
    if (details.frameId !== 0) return;
    await loaded;
    const hit = agentSessionFromUrl(details.url, sessions, agentToken);
    if (!hit) return;
    await assign(details.tabId, hit.session.id, false);
    await chrome.tabs.update(details.tabId, { url: hit.url });
  };
  chrome.webNavigation.onBeforeNavigate.addListener(onAgentUrl);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(onAgentUrl);

  chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
    handle(msg, sender).then(sendResponse, (e) => {
      console.error('[session-buddy]', e);
      sendResponse({ error: String(e) });
    });
    return true;
  });

  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      const session = tabSession.get(details.tabId);
      if (!session) return;
      const host = new URL(details.url).hostname;
      const raw = (details.responseHeaders ?? []).filter((h) => h.name.toLowerCase() === 'set-cookie');
      if (!raw.length) return;
      const jar = ((jars[session] ??= {})[host] ??= {});
      for (const h of raw) {
        const c = h.value ? parseSetCookie(h.value, host) : null;
        if (c) setCookie(jar, c);
      }
      persist();
      syncRules(details.tabId);
      // Keep the page's in-memory copy in sync for responses that arrive after the hook was injected.
      const frameHost = new URL((details as { documentUrl?: string }).documentUrl ?? details.url).hostname;
      chrome.tabs
        .sendMessage(details.tabId, { type: 'cookies', cookies: visibleCookies(session, frameHost) }, { frameId: details.frameId })
        .catch(() => {});
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders', 'extraHeaders'],
  );

  // Tabs opened from a session tab (target=_blank etc.) inherit the session.
  chrome.tabs.onCreated.addListener(async (tab) => {
    await loaded;
    const s = tab.openerTabId !== undefined ? tabSession.get(tab.openerTabId) : undefined;
    if (tab.id !== undefined && s && !tabSession.has(tab.id)) await assign(tab.id, s);
  });

  chrome.tabs.onRemoved.addListener(async (tabId) => {
    await loaded;
    if (tabSession.delete(tabId)) {
      syncRules(tabId);
      persist();
    }
  });
});
