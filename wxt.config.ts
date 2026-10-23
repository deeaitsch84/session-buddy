import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Session Buddy',
    permissions: [
      'declarativeNetRequest',
      'declarativeNetRequestWithHostAccess',
      'webRequest',
      'tabs',
      'tabGroups',
      'storage',
      'contextMenus',
      'cookies',
      'scripting',
      'webNavigation',
    ],
    host_permissions: ['<all_urls>'],
  },
});
