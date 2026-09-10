// Auto-open the app in the default browser once the server is actually listening.
import http from 'node:http';
import { exec } from 'node:child_process';

const port = Number(process.env.PORT || 8080);
const url = `http://localhost:${port}`;
const start = Date.now();

function launch() {
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : (process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`);
  exec(cmd, () => process.exit(0));
}

function poll() {
  const req = http.get(url, { timeout: 900 }, (res) => { res.resume(); launch(); });
  req.on('error', () => {
    if (Date.now() - start > 20000) {
      console.log('\n  The server did not become ready in 20s.');
      console.log('  Open this URL manually once the window shows the banner:\n    ' + url + '\n');
      process.exit(1);
    }
    setTimeout(poll, 600);
  });
  req.on('timeout', () => req.destroy());
}
poll();
