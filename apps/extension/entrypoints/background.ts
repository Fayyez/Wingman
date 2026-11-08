import { defineBackground } from 'wxt/utils/define-background';
import { DexieConversationStore } from '@wingman/core';
import { createBackground, type KV } from '../src/background/core';
import { isRequest, SUGGEST_PORT } from '../src/messages';
import { API_URL, DEV_LOGIN, GOOGLE_CLIENT_ID } from '../src/config';

const area = (a: chrome.storage.StorageArea): KV => ({
  get: async (k) => (await a.get(k))[k],
  set: (k, v) => a.set({ [k]: v }),
  remove: (k) => a.remove(k),
});

async function googleIdToken(): Promise<string> {
  const redirect = chrome.identity.getRedirectURL();
  const nonce = crypto.randomUUID();
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      response_type: 'id_token',
      redirect_uri: redirect,
      scope: 'openid email profile',
      nonce,
      prompt: 'select_account',
    });
  const result = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const frag = result ? new URL(result).hash.slice(1) : '';
  const idToken = new URLSearchParams(frag).get('id_token');
  if (!idToken) throw new Error('Google sign-in did not return an ID token');
  return idToken;
}

export default defineBackground(() => {
  const bg = createBackground({
    store: new DexieConversationStore('wingman'),
    session: area(chrome.storage.session),
    local: area(chrome.storage.local),
    fetch: (...a) => fetch(...a),
    apiUrl: API_URL,
    version: chrome.runtime.getManifest().version,
    devLogin: DEV_LOGIN,
    googleClientId: GOOGLE_CLIENT_ID,
    googleIdToken: GOOGLE_CLIENT_ID ? googleIdToken : undefined,
    openSignIn: async () => {
      try {
        await chrome.action.openPopup();
      } catch {
        await chrome.tabs.create({ url: chrome.runtime.getURL('/popup.html') });
      }
    },
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !isRequest(msg)) return false;
    void bg.handle(msg).then(sendResponse);
    return true;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== SUGGEST_PORT || port.sender?.id !== chrome.runtime.id) return;
    bg.onSuggestPort(port);
  });
});
