export const CSS = `
:host { all: initial; }
.w { --bg:#ffffff; --fg:#111b21; --muted:#667781; --line:#e9edef; --card:#f7f8fa; --accent:#00a884; --accent-fg:#fff; --danger:#d9534f;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--fg); }
.w[data-theme='dark'] { --bg:#111b21; --fg:#e9edef; --muted:#8696a0; --line:#2a3942; --card:#1f2c33; --accent:#00a884; --danger:#f2766f; }
@media (prefers-color-scheme: dark) { .w[data-theme='auto'] { --bg:#111b21; --fg:#e9edef; --muted:#8696a0; --line:#2a3942; --card:#1f2c33; --danger:#f2766f; } }
* { box-sizing: border-box; }
button { font: inherit; color: inherit; cursor: pointer; }
.fab { position: fixed; z-index: 2147483646; width: 40px; height: 40px; border-radius: 50%; border: none; background: var(--accent); color: var(--accent-fg);
  font-weight: 700; font-size: 18px; box-shadow: 0 2px 8px rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; }
.fab:hover { filter: brightness(1.08); }
.chip-cmd { position: fixed; z-index: 2147483646; display: none; background: var(--danger); color: #fff; border-radius: 12px; padding: 2px 10px; font-weight: 600; font-size: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
.chip-cmd.on { display: block; }
.panel { position: fixed; z-index: 2147483647; top: 0; right: 0; bottom: 0; width: 320px; display: none; flex-direction: column; background: var(--bg);
  border-left: 1px solid var(--line); box-shadow: -2px 0 12px rgba(0,0,0,.2); }
.panel.open { display: flex; }
.head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); font-weight: 700; }
.head .sp { flex: 1; }
.x { border: none; background: transparent; font-size: 16px; color: var(--muted); padding: 2px 6px; border-radius: 4px; }
.x:hover { background: var(--card); }
.scroll { flex: 1; overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; flex-wrap: wrap; gap: 6px; }
.seg, .tw { border: 1px solid var(--line); background: var(--card); border-radius: 14px; padding: 3px 10px; font-size: 12px; }
.seg[aria-pressed='true'] { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.tw:hover, .seg:hover { border-color: var(--accent); }
.vibe { color: var(--muted); font-size: 12px; font-style: italic; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.card .tag { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.card .txt { white-space: pre-wrap; word-break: break-word; font-size: 14px; }
.act { border: 1px solid var(--line); background: var(--bg); border-radius: 6px; padding: 3px 10px; font-size: 12px; }
.act.pri { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.guide { border-left: 3px solid var(--accent); padding: 4px 10px; background: var(--card); border-radius: 4px; }
.skel { height: 64px; border-radius: 10px; background: linear-gradient(90deg, var(--card) 25%, var(--line) 50%, var(--card) 75%); background-size: 200% 100%; animation: sh 1.2s infinite linear; }
@keyframes sh { to { background-position: -200% 0; } }
.err { border: 1px solid var(--danger); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.foot { padding: 8px 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
.empty { color: var(--muted); }
.lbl { font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: .04em; }
.toast { color: var(--accent); font-size: 12px; min-height: 16px; }
`;
