#!/usr/bin/env node
/**
 * One-command local dev stack (Windows / macOS / Linux):
 *   node tools/dev.mjs            # fake LLM (no API key needed)
 *   node tools/dev.mjs --real     # use real LLM providers (keys from .env / env)
 *   node tools/dev.mjs --no-build # skip rebuilding the extension
 *   node tools/dev.mjs --port 8000 --api-port 8000
 *
 * Steps: preflight -> Postgres in Docker on a FREE host port (reuses a running one) -> .env ->
 * deps -> migrations -> extension build -> API server. Ctrl+C stops the API; Postgres keeps running.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'services', 'api');
const COMPOSE = ['compose', '-f', path.join(ROOT, 'infra', 'docker-compose.yml')];
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const REAL = flag('--real');
const API_PORT = Number(opt('--api-port', 8000));

const log = (m) => console.log(`\n\x1b[36m[wingman]\x1b[0m ${m}`);
const die = (m) => {
  console.error(`\n\x1b[31m[wingman] ERROR:\x1b[0m ${m}`);
  process.exit(1);
};

function run(cmd, cmdArgs, { cwd = ROOT, env = {}, quiet = false, allowFail = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd,
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : 'inherit',
  });
  if (r.status !== 0 && !allowFail) die(`command failed: ${cmd} ${cmdArgs.join(' ')}\n${r.stderr ?? ''}`);
  return r;
}

const portInUse = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
    s.setTimeout(800, () => (s.destroy(), resolve(false)));
  });

function readEnvFile() {
  const f = path.join(ROOT, '.env');
  return existsSync(f) ? readFileSync(f, 'utf8').split(/\r?\n/) : [];
}
function setEnvVar(key, value) {
  const lines = readEnvFile().filter((l) => !l.startsWith(`${key}=`));
  lines.push(`${key}=${value}`);
  writeFileSync(path.join(ROOT, '.env'), lines.filter((l, i, a) => l || i < a.length - 1).join('\n') + '\n');
}

// ---- 1. preflight ----
log('Checking tools');
for (const [cmd, hint] of [
  ['node', 'install Node 22'],
  ['pnpm', 'npm i -g pnpm'],
  ['uv', 'https://docs.astral.sh/uv/'],
  ['docker', 'install Docker Desktop'],
]) {
  if (run(cmd, ['--version'], { quiet: true, allowFail: true }).status !== 0) die(`'${cmd}' not found (${hint})`);
}
if (run('docker', ['info'], { quiet: true, allowFail: true }).status !== 0)
  die('Docker is installed but not running. Start Docker Desktop, wait until it says "running", and retry.');

// ---- 2. Postgres on a free host port ----
log('Starting Postgres');
let hostPort;
const ps = run('docker', [...COMPOSE, 'port', 'postgres', '5432'], { quiet: true, allowFail: true });
const running = ps.status === 0 && /:(\d+)\s*$/m.exec(ps.stdout ?? '');
if (running) {
  hostPort = Number(running[1]);
  log(`Postgres container already running on host port ${hostPort}, reusing it`);
} else {
  hostPort = Number(opt('--port', 0)) || 5432;
  while (await portInUse(hostPort)) {
    log(`Port ${hostPort} is already used by another program (maybe a Windows Postgres), trying ${hostPort + 1}`);
    hostPort += 1;
    if (hostPort > 5460) die('no free port found between 5432 and 5460');
  }
}
run('docker', [...COMPOSE, 'up', '-d', '--wait', 'postgres'], { env: { POSTGRES_HOST_PORT: String(hostPort) } });

const DATABASE_URL = `postgresql+asyncpg://wingman:wingman@localhost:${hostPort}/wingman`;
setEnvVar('DATABASE_URL', DATABASE_URL);
log(`DATABASE_URL -> localhost:${hostPort} (saved to .env)`);

const check = run('docker', [...COMPOSE, 'exec', '-T', 'postgres', 'psql', '-U', 'wingman', '-d', 'wingman', '-c', 'select 1'], {
  quiet: true,
  allowFail: true,
});
if (check.status !== 0) die(`Postgres container is up but login fails inside it:\n${check.stderr}\nTry: docker compose -f infra/docker-compose.yml down -v   (deletes the local dev DB) and rerun.`);

// ---- 3. dependencies + migrations ----
log('Installing dependencies');
run('pnpm', ['install', '--frozen-lockfile'], { allowFail: false });
run('uv', ['sync'], { cwd: API_DIR });

log('Running database migrations');
const mig = run('uv', ['run', 'alembic', 'upgrade', 'head'], { cwd: API_DIR, env: { DATABASE_URL }, quiet: true, allowFail: true });
if (mig.status !== 0) {
  console.error(mig.stderr);
  die(
    /password authentication failed/i.test(mig.stderr ?? '')
      ? `Postgres rejected wingman/wingman on port ${hostPort}. Another Postgres is probably answering on that port, or an old Docker volume has a different password.\nFix: docker compose -f infra/docker-compose.yml down -v   then rerun this script.`
      : 'migration failed (see above)',
  );
}
console.log(mig.stdout || 'migrations up to date');

// ---- 4. extension ----
const API_URL = `http://localhost:${API_PORT}`;
if (!flag('--no-build')) {
  log('Building the Chrome extension');
  run('pnpm', ['--filter', '@wingman/extension', 'build'], { env: { WXT_API_URL: API_URL, WXT_DEV_LOGIN: 'true' } });
}

// ---- 5. API server ----
if (await portInUse(API_PORT)) die(`API port ${API_PORT} is already in use. Stop the other program or use --api-port 8001 (then rebuild the extension with the same port).`);
log(`Starting API on ${API_URL} (${REAL ? 'REAL LLM providers' : 'fake LLM, no API key needed'})`);
const api = spawn('uv', ['run', 'uvicorn', 'app.main:create_app', '--factory', '--port', String(API_PORT)], {
  cwd: API_DIR,
  env: { ...process.env, DATABASE_URL, APP_ENV: 'dev', ...(REAL ? {} : { LLM_MODE: 'fake' }) },
  shell: process.platform === 'win32',
  stdio: 'inherit',
});
for (let i = 0; i < 60; i++) {
  if (await fetch(`${API_URL}/healthz`).then((r) => r.ok).catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 500));
}
const ext = path.join(ROOT, 'apps', 'extension', '.output', 'chrome-mv3');
console.log(`
\x1b[32m=== Wingman is running ===\x1b[0m
 API:        ${API_URL}/healthz
 Postgres:   localhost:${hostPort}
 Extension:  ${ext}

 Load it once in Chrome:
   1. chrome://extensions  ->  Developer mode ON  ->  Load unpacked  ->  pick the folder above
   2. Click the Wingman toolbar icon -> Dev login -> any email
   3. Open https://web.whatsapp.com , open a chat, click the green W (or Alt+W)

 Press Ctrl+C to stop the API (Postgres keeps running; stop it with: docker compose -f infra/docker-compose.yml down)
`);
const stop = () => (api.kill(), process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', (code) => process.exit(code ?? 0));
