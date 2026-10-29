# Session Buddy

Chrome-Extension (Manifest V3), um in mehreren Tabs gleichzeitig mit verschiedenen Accounts auf derselben Website eingeloggt zu sein. Jeder Tab kann einer Session zugeordnet werden. Tabs einer Session sind per Tab-Gruppe (Name und Farbe), Badge und Titel-Präfix `[Name]` markiert.

## Installation

```sh
npm install
npm run build
```

Danach in `chrome://extensions` den Entwicklermodus aktivieren, „Entpackte Erweiterung laden“ wählen und `.output/chrome-mv3` auswählen. `npm run dev` startet WXT mit Hot Reload.

## Bedienung

- **Session anlegen** im Popup (Name und Farbe).
- **Tab zuweisen**: Popup → „Diesen Tab zuweisen“, oder Rechtsklick auf Seite/Link → „Neuer Tab in Session“. Der Tab wird neu geladen. Tabs, die aus einem Session-Tab geöffnet werden, erben die Session.
- **Login übernehmen**: kopiert die aktuellen Browser-Cookies der Seite in die Session.
- **Leeren** löscht alle Cookies einer Session, **Löschen** entfernt die Session.
- Tabs ohne Session verhalten sich wie gewohnt.

## Agenten (z. B. claude-in-chrome)

Ein Browser-Agent legt einen Tab in eine Session, indem er eine URL mit dem Anhang `#sb=<Session-Name>&k=<Token>` öffnet, z. B. `https://app.example.com/#sb=super%20admin&k=…`. Session Buddy entfernt den Anhang und lädt den Tab mit den Cookies der Session neu. Der Name wird ohne Groß-/Kleinschreibung verglichen; unbekannte Namen oder ein falscher Token werden ignoriert.

Den Token zeigt das Popup unter „Agent-Zugriff“. Er verhindert, dass beliebige Webseiten per Link Tabs in eine Session schieben. Tabs in fremden Tab-Gruppen (etwa der Gruppe des Agenten) bleiben in ihrer Gruppe und bekommen nur Badge und Titel-Präfix.

## Funktionsweise

- Pro Session gibt es pro Host einen eigenen Cookie-Jar (`chrome.storage.local`).
- Für Session-Tabs entfernt `declarativeNetRequest` den `Cookie`-Header und `Set-Cookie` der Antworten und setzt den Cookie-Header aus dem Jar. `webRequest` liest `Set-Cookie` mit und füllt den Jar.
- Beim Laden jedes Frames wird ein Hook in die Seite injiziert. Er überschreibt `document.cookie` (HttpOnly-Cookies bleiben unsichtbar) und `localStorage` (Schlüssel-Prefix pro Session).
- Nach einem Browser-Neustart werden die Tabs über ihre wiederhergestellte Tab-Gruppe (Name und Farbe) der Session wieder zugeordnet. Deshalb Sessions mit eindeutiger Name-Farbe-Kombination anlegen und die Gruppen nicht umbenennen.

## Bekannte Einschränkungen

- **Unverschlüsselt**: Cookies und Sessions liegen im Klartext in `chrome.storage.local`.
- **Nicht getrennt**: IndexedDB, Cache Storage, `sessionStorage`-Zugriffe von Service Workern und Requests von Service Workern (ohne Tab-ID).
- **Ein Jar pro Host**: Domain-Cookies (`Domain=.example.com`) werden nicht zwischen Subdomains geteilt. SSO-Flows über mehrere Hosts (`auth.x.com` → `app.x.com`) funktionieren daher nicht.
- **Race beim Laden**: Der Hook wird beim Navigations-Commit injiziert. Sehr früh laufende Seiten-Skripte können vor ihm `document.cookie` oder `localStorage` lesen.
- `localStorage`-Zugriffe über `Storage.prototype.getItem.call(localStorage, …)` umgehen den Proxy. Andere Tabs ohne Session sehen die Prefix-Schlüssel der Sessions in `localStorage`.
- Cookies aus einer Redirect-Antwort (z. B. Login mit 302) fehlen im direkt folgenden Request; erst ab dem nächsten Request sind sie gesetzt.
- Agent-Tabs liegen nicht in einer Session-Gruppe und verlieren ihre Session daher nach einem Browser-Neustart. Beim ersten Aufruf mit `#sb=` geht der allererste Request noch mit den normalen Browser-Cookies raus.
- Der Titel-Präfix kann das Seitentitel-Verhalten von Single-Page-Apps beeinflussen.
- Breite Rechte (`<all_urls>`, `cookies`, `webRequest` u. a.) machen die Extension nur für den privaten Gebrauch geeignet, nicht für den Chrome Web Store.

## Entwicklung

```sh
npm test            # Vitest
npx tsc --noEmit    # Typecheck
```
