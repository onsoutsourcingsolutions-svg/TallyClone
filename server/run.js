// Bootstraps server/index.js on any modern Node (>= 22.5):
// probes whether the --experimental-sqlite flag is needed/accepted, then spawns.
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const probe = spawnSync(process.execPath, ['--experimental-sqlite', '--version'], { encoding: 'utf8', timeout: 10000 });
const flagOk = probe.status === 0;
const args = flagOk ? ['--experimental-sqlite', 'server/index.js'] : ['server/index.js'];

const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
