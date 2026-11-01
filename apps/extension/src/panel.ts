import { whatsappWeb } from '@wingman/platform-adapters';

const { DEFAULT_WA_CONFIG, parseMessages, q1, sanitizeFixture } = whatsappWeb;
type WhatsAppWebAdapter = InstanceType<typeof whatsappWeb.WhatsAppWebAdapter>;

const CSS = `
:host { all: initial; }
.root { position: fixed; left: 8px; bottom: 8px; z-index: 2147483647; width: 360px; max-height: 70vh;
  display: flex; flex-direction: column; font: 12px/1.35 system-ui, sans-serif;
  background: #fff; color: #111; border: 1px solid #888; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,.4); }
@media (prefers-color-scheme: dark) { .root { background: #1f2c33; color: #e9edef; border-color: #667781; } button { background:#2a3942; color:#e9edef; } }
.head { display: flex; align-items: center; gap: 6px; padding: 4px 8px; cursor: pointer; font-weight: 600; }
.body { overflow: auto; padding: 4px 8px 8px; }
.collapsed .body { display: none; }
.chip { display: none; background: #d9534f; color: #fff; border-radius: 10px; padding: 1px 8px; font-weight: 600; }
.chip.on { display: inline-block; }
h4 { margin: 8px 0 2px; font-size: 11px; text-transform: uppercase; opacity: .7; }
button { font: inherit; margin: 2px 4px 2px 0; padding: 2px 6px; border: 1px solid #888; border-radius: 4px; background: #eee; color: #111; cursor: pointer; }
.ok { color: #1a9a4a; } .bad { color: #d9534f; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 11px/1.3 ui-monospace, monospace; }
.log { max-height: 140px; overflow: auto; border: 1px solid #8884; padding: 2px 4px; }
`;

export interface Panel {
  log(line: string): void;
  setCommandMode(active: boolean): void;
  refresh(): void;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

export function createPanel(adapter: WhatsAppWebAdapter): Panel {
  const host = document.createElement('div');
  host.id = 'wingman-spike-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
<div class="root collapsed" id="root">
  <div class="head" id="head"><span>Wingman (spike)</span><span class="chip" id="chip">Wingman command, Enter won't send</span><span style="margin-left:auto" id="tog">▲</span></div>
  <div class="body">
    <div id="cfg"></div>
    <div><button id="b-self">Self-test</button><button id="b-ins">Insert test text</button><button id="b-fix">Download sanitized fixture</button><button id="b-diag">Copy diagnostics</button></div>
    <h4>Self-test</h4><div id="checks"></div>
    <h4>Active chat</h4><div id="chat"></div>
    <h4>Last 8 messages</h4><pre id="msgs"></pre>
    <h4>Last insert</h4><div id="ins">none</div>
    <h4>Event log</h4><div class="log"><pre id="log"></pre></div>
  </div>
</div>`;
  (document.body ?? document.documentElement).appendChild(host);
  const $ = <T extends HTMLElement>(id: string) => root.getElementById(id) as T;
  const lines: string[] = [];

  const log = (line: string) => {
    lines.push(`${new Date().toLocaleTimeString()} ${line}`);
    if (lines.length > 50) lines.shift();
    const el = $('log');
    el.textContent = lines.join('\n');
    el.parentElement!.scrollTop = el.parentElement!.scrollHeight;
  };

  const readMessages = () => {
    const main = q1(document, DEFAULT_WA_CONFIG.main);
    return main ? parseMessages(main, DEFAULT_WA_CONFIG).messages : [];
  };

  const refresh = () => {
    const health = adapter.selfTest();
    $('cfg').textContent =
      `config v${health.configVersion} · verified: ${DEFAULT_WA_CONFIG.verified}`;
    $('checks').innerHTML = health.checks
      .map(
        (c) =>
          `<div class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} ${esc(c.name)}${c.detail ? ' — ' + esc(c.detail) : ''}</div>`,
      )
      .join('');
    const chat = adapter.getActiveChat();
    $('chat').textContent = chat ? `${chat.title} · ${chat.chatKey}` : 'none';
    $('msgs').textContent =
      readMessages()
        .slice(-8)
        .map((m) => `${m.dir} ${m.kind} ${m.ts ?? '-'} ${trunc(m.text.replace(/\n/g, ' '), 60)}`)
        .join('\n') || '(none)';
    const li = adapter.lastInsert;
    $('ins').textContent = li ? `${li.strategy} ok=${li.ok}` : 'none';
  };

  $('head').addEventListener('click', () => {
    const r = $('root');
    r.classList.toggle('collapsed');
    $('tog').textContent = r.classList.contains('collapsed') ? '▲' : '▼';
  });
  $('b-self').addEventListener('click', () => {
    refresh();
    log('self-test rerun');
  });
  $('b-ins').addEventListener('click', () => {
    void adapter.insertDraft('wingman test 👋 (not sent)', 'replace').then((ok) => {
      log(`insertDraft ok=${ok}`);
      refresh();
    });
  });
  $('b-fix').addEventListener('click', () => {
    const main = document.querySelector('#main');
    if (!main) return log('fixture: #main not found');
    const blob = new Blob([sanitizeFixture(main)], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wa-fixture-${new Date().toISOString().replace(/[:.]/g, '-')}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    log('fixture downloaded');
  });
  $('b-diag').addEventListener('click', () => {
    const msgs = readMessages();
    const diag = {
      selfTest: adapter.selfTest(),
      counts: {
        messages: msgs.length,
        incoming: msgs.filter((m) => m.dir === 'in').length,
        outgoing: msgs.filter((m) => m.dir === 'out').length,
      },
      lastInsert: adapter.lastInsert,
    };
    void navigator.clipboard.writeText(JSON.stringify(diag, null, 2)).then(
      () => log('diagnostics copied'),
      () => log('clipboard write failed'),
    );
  });

  refresh();
  return { log, refresh, setCommandMode: (a) => $('chip').classList.toggle('on', a) };
}
