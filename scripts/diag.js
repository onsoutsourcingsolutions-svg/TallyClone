// Prints + saves a diagnostic report (diag.txt) so failures can be seen from anywhere.
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { execSync } from 'node:child_process';

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const ok = (b) => (b ? 'YES' : 'NO ');

log('=== IndAS Ledger diagnostics ===');
log('time     : ' + new Date().toString());
log('platform : ' + process.platform + ' ' + os.release());
log('node     : ' + process.version + ' at ' + process.execPath);
try { log('npm      : ' + execSync('npm -v', { timeout: 15000 }).toString().trim()); }
catch (e) { log('npm      : ERROR - ' + e.message.split('\n')[0]); }
log('cwd      : ' + process.cwd());
let w = false; try { fs.accessSync('.', fs.constants.W_OK); w = true; } catch (_) {}
log('folder   : writable? ' + ok(w) + '  (if NO -> the zip was not extracted: right-click -> Extract All)');
log('dist app : built? ' + ok(fs.existsSync('dist/index.html')));
let dw = false; try { fs.mkdirSync('data', { recursive: true }); fs.accessSync('data', fs.constants.W_OK); dw = true; } catch (_) {}
log('data dir : writable? ' + ok(dw));
try {
  const sqlite = await import('node:sqlite');
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec('CREATE TABLE t(a)');
  log('sqlite   : WORKS (built-in database is available)');
} catch (e) {
  log('sqlite   : NOT available under this node - ' + e.message.split('\n')[0]);
  log('           needs Node v22.5+ (v22.5, v23, v24...). Check node version above.');
}
// can we bind & reach a local port?
await new Promise((resolve) => {
  const srv = http.createServer((req, res) => res.end('ok'));
  srv.on('error', (e) => { log('port 8080: cannot listen - ' + e.code + ' (another program uses it?)'); resolve(); });
  srv.listen(8080, '0.0.0.0', () => {
    http.get('http://localhost:8080', (res) => {
      res.resume();
      log('port 8080: server CAN listen and localhost CAN connect - OK');
      srv.close(() => resolve());
    }).on('error', () => { log('port 8080: can listen but connect failed - unusual'); srv.close(() => resolve()); });
  });
});
fs.writeFileSync('diag.txt', lines.join('\n'));
log('');
log('Report saved as diag.txt in this folder - send that file for help.');
