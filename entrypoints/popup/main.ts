import type { Message } from '../../src/messages';
import { COLOR_HEX, GROUP_COLORS, type GroupColor, type Session } from '../../src/sessions';

interface State {
  sessions: Session[];
  agentToken: string;
  activeTabId: number | null;
  activeSessionId: string | null;
  tabs: { id: number; sessionId: string; title: string; url: string; favIconUrl: string; windowId: number }[];
}

const send = <T = unknown>(msg: Message): Promise<T> => chrome.runtime.sendMessage(msg);

const ICONS = {
  import: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M4.5 7 8 10.5 11.5 7M3 13h10"/></svg>',
  clear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
  delete: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

const setColor = (e: HTMLElement, c: GroupColor) => e.style.setProperty('--c', COLOR_HEX[c]);

function swatches(selected: GroupColor, onPick: (c: GroupColor) => void): HTMLElement {
  const box = el('div', { className: 'swatches' });
  for (const c of GROUP_COLORS) {
    const b = el('button', { type: 'button', className: `swatch${c === selected ? ' sel' : ''}`, title: c });
    setColor(b, c);
    b.addEventListener('click', () => onPick(c));
    box.append(b);
  }
  return box;
}

function iconButton(icon: string, label: string, onclick: () => void, cls = 'ghost'): HTMLButtonElement {
  const b = el('button', { className: cls, title: label, ariaLabel: label });
  b.innerHTML = icon;
  b.append(label);
  b.addEventListener('click', onclick);
  return b;
}

/** Icon-only two-step button: the first click arms it (shows "Sicher?"), the second one confirms. */
function confirmButton(icon: string, label: string, onConfirm: () => void, tooltip: string): HTMLButtonElement {
  const b = el('button', { className: 'ghost icon danger', title: tooltip, ariaLabel: label });
  b.innerHTML = icon;
  b.addEventListener('click', () => {
    if (b.classList.contains('confirm')) return onConfirm();
    b.classList.add('confirm');
    b.append(el('span', { textContent: 'Sicher?' }));
    setTimeout(() => {
      b.classList.remove('confirm');
      b.querySelector('span')?.remove();
    }, 3000);
  });
  return b;
}

let newColor: GroupColor = 'blue';
let expandedColors: string | null = null;
// undefined = follow the active tab's session; '' = everything collapsed.
let openId: string | undefined;

async function act(msg: Message) {
  await send(msg);
  await render();
}

async function render() {
  const state = await send<State>({ type: 'getState' });
  const active = state.sessions.find((s) => s.id === state.activeSessionId);
  document.getElementById('current')!.textContent = active
    ? `Dieser Tab läuft in „${active.name}“`
    : 'Dieser Tab nutzt die normalen Browser-Cookies';

  (document.getElementById('agent-hash') as HTMLInputElement).value = `#sb=<Session-Name>&k=${state.agentToken}`;

  const open = openId ?? state.activeSessionId ?? '';
  const root = document.getElementById('sessions')!;
  root.replaceChildren();
  if (!state.sessions.length)
    root.append(
      el('div', { className: 'empty' }, el('b', { textContent: 'Noch keine Sessions' }), 'Lege unten eine an und weise ihr diesen Tab zu.'),
    );

  for (const s of state.sessions) {
    const isActive = state.activeSessionId === s.id;
    const isOpen = open === s.id;
    const sessionTabs = state.tabs.filter((t) => t.sessionId === s.id);
    const card = el('div', { className: `card${isActive ? ' current' : ''}${isOpen ? ' open' : ''}` });
    setColor(card, s.color);

    const dot = el('button', { className: 'dot', title: 'Farbe ändern' });
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      openId = s.id;
      expandedColors = expandedColors === s.id ? null : s.id;
      render();
    });
    const name = el('input', { className: 'name', value: s.name, spellcheck: false });
    name.addEventListener('click', (e) => e.stopPropagation());
    name.addEventListener('change', () => {
      if (name.value.trim() && name.value !== s.name)
        act({ type: 'updateSession', id: s.id, name: name.value, color: s.color });
    });
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());
    const badge = el('span', {
      className: `badge${isActive ? ' on' : ''}`,
      textContent: `${sessionTabs.length} ${sessionTabs.length === 1 ? 'Tab' : 'Tabs'}`,
    });
    const chevron = el('span', { className: 'chevron', textContent: '›' });
    const head = el('div', { className: 'head', title: isOpen ? 'Zuklappen' : 'Aufklappen' }, dot, name, badge, chevron);
    head.addEventListener('click', () => {
      openId = isOpen ? '' : s.id;
      expandedColors = null;
      render();
    });
    card.append(head);

    if (!isOpen) {
      root.append(card);
      continue;
    }

    const body = el('div', { className: 'body' });
    if (expandedColors === s.id)
      body.append(
        swatches(s.color, (color) => {
          expandedColors = null;
          act({ type: 'updateSession', id: s.id, name: s.name, color });
        }),
      );

    const tabId = state.activeTabId;
    if (tabId !== null)
      body.append(
        el('button', {
          className: `assign${isActive ? '' : ' primary'}`,
          textContent: isActive ? 'Tab aus Session entfernen' : 'Diesen Tab zuweisen',
          onclick: () => act({ type: 'assignTab', tabId, sessionId: isActive ? null : s.id }),
        }),
      );

    const footer = el('div', { className: 'footer' });
    if (tabId !== null) {
      const imp = iconButton(ICONS.import, 'Login übernehmen', () => act({ type: 'importLogin', tabId, sessionId: s.id }));
      imp.title = 'Übernimmt die aktuellen Browser-Cookies dieser Seite in die Session';
      footer.append(imp);
    }
    footer.append(
      el('span', { className: 'spacer' }),
      confirmButton(ICONS.clear, 'Leeren', () => act({ type: 'clearCookies', id: s.id }), 'Cookies der Session leeren'),
      confirmButton(ICONS.delete, 'Löschen', () => act({ type: 'deleteSession', id: s.id }), 'Session löschen'),
    );
    body.append(footer);

    const list = el('div', { className: 'tabs' });
    if (!sessionTabs.length) list.append(el('div', { className: 'none', textContent: 'Noch keine Tabs in dieser Session.' }));
    for (const t of sessionTabs) {
      const fav = t.favIconUrl ? el('img', { src: t.favIconUrl, alt: '' }) : el('span', { className: 'fav' });
      list.append(
        el(
          'button',
          {
            className: `tab${t.id === state.activeTabId ? ' here' : ''}`,
            title: t.url,
            onclick: async () => {
              await send({ type: 'focusTab', tabId: t.id });
              window.close();
            },
          },
          fav,
          el('span', { textContent: t.title || t.url }),
        ),
      );
    }
    body.append(list);
    card.append(body);
    root.append(card);
  }
}

const newColors = document.getElementById('new-colors')!;
function renderNewColors() {
  newColors.replaceChildren(
    ...swatches(newColor, (c) => {
      newColor = c;
      renderNewColors();
    }).children,
  );
}
renderNewColors();

const agentHash = document.getElementById('agent-hash') as HTMLInputElement;
agentHash.addEventListener('focus', () => agentHash.select());
const agentCopy = document.getElementById('agent-copy')!;
agentCopy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(agentHash.value);
  agentCopy.textContent = 'Kopiert';
  setTimeout(() => (agentCopy.textContent = 'Kopieren'), 1500);
});

document.getElementById('create')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-name') as HTMLInputElement;
  await send({ type: 'createSession', name: name.value, color: newColor });
  name.value = '';
  const next = GROUP_COLORS[(GROUP_COLORS.indexOf(newColor) + 1) % GROUP_COLORS.length]!;
  newColor = next;
  renderNewColors();
  await render();
});

render();
