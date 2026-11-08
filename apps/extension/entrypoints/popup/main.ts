import { send } from '../../src/content/runtime';
import type { AuthStatus } from '../../src/messages';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function render(s: AuthStatus) {
  $('signed-in').hidden = !s.signedIn;
  $('signed-out').hidden = s.signedIn;
  $('email').textContent = s.email ?? '(unknown)';
  $('dev').hidden = !s.devLogin;
  $('google').hidden = !s.googleEnabled;
  $('api').textContent = s.apiUrl;
}

async function refresh() {
  const r = await send({ type: 'auth.status' });
  if (r.ok) render(r.data);
  else $('err').textContent = r.error.message;
}

$('dev').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('err').textContent = '';
  const r = await send({ type: 'auth.devLogin', email: $<HTMLInputElement>('dev-email').value });
  if (r.ok) render(r.data);
  else $('err').textContent = r.error.message;
});
$('google').addEventListener('click', async () => {
  $('err').textContent = '';
  const r = await send({ type: 'auth.google' });
  if (r.ok) render(r.data);
  else $('err').textContent = r.error.message;
});
$('signout').addEventListener('click', async () => {
  const r = await send({ type: 'auth.signOut' });
  if (r.ok) render(r.data);
});

void refresh();
