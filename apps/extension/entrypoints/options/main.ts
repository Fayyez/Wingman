import { send } from '../../src/content/runtime';
import { STORAGE_KEYS } from '../../src/messages';

const debug = document.getElementById('debug') as HTMLInputElement;
const status = document.getElementById('forget-status')!;

void chrome.storage.local.get(STORAGE_KEYS.debugPanel).then((got) => {
  debug.checked = got[STORAGE_KEYS.debugPanel] === true;
});
debug.addEventListener('change', () => {
  void chrome.storage.local.set({ [STORAGE_KEYS.debugPanel]: debug.checked });
});
document.getElementById('forget')!.addEventListener('click', async () => {
  if (!confirm('Delete all chats, messages and memory stored by Wingman in this browser?')) return;
  const r = await send({ type: 'store.wipeAll' });
  status.textContent = r.ok ? 'Done.' : `Failed: ${r.error.message}`;
});
