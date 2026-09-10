import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { api } from './api.js';
import { activeCompanyId, getCompany } from './db.js';
import { BUILD_TAG } from '../version.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const app = express();

app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', api);

// serve built client (if any) — in development Vite serves the UI instead
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, {
    setHeaders(res, p) { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); },
  }));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (req, res) => {
    res.send(`<body style="background:#000;color:#d4af37;font-family:sans-serif;padding:40px">
      <h2>O.N.S. OUTSOURCING SOLUTIONS</h2>
      <p>The web app has not been built yet. Run  <b>npm run build</b>  in this folder,
      or (easier) start it with  <b>start-windows.bat</b> / <b>start-mac-linux.sh</b>.</p></body>`);
  });
}

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) {
        const a = ni.address;
        const priv = /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(a);
        out.push({ addr: a, private: priv });
      }
    }
  }
  out.sort((x, y) => (x.private === y.private ? 0 : x.private ? -1 : 1));
  return out;
}

function showBanner(port) {
  const co = (() => { try { const id = activeCompanyId(); if (!id) return null; const c = getCompany(id); return c ? c.name : null; } catch (_) { return null; } })();
  const title = (co || 'O.N.S. OUTSOURCING SOLUTIONS').toUpperCase();
  const width = 62; // inner box width
  const pad = Math.max(2, Math.floor((width - title.length - 2) / 2));
  const line = '  ║' + ' '.repeat(width) + '║';
  const titleLine = '  ║' + ' '.repeat(pad) + title + ' '.repeat(width - title.length - pad) + '║';
  const banner = [];
  banner.push('');
  banner.push('  ╔' + '═'.repeat(width) + '╗');
  banner.push(line);
  banner.push(titleLine);
  const sub = '◆ accounting suite — your books';
  const cen = (t) => { const p = Math.max(2, Math.floor((width - t.length) / 2)); return '  ║' + ' '.repeat(p) + t + ' '.repeat(Math.max(0, width - t.length - p)) + '║'; };
  banner.push(cen(sub));
  banner.push(cen('version ' + BUILD_TAG));
  banner.push(line);
  banner.push('  ╚' + '═'.repeat(width) + '╝');
  banner.push('');
  banner.push('  ✔ Server is RUNNING now.');
  banner.push(`    On THIS computer:    http://localhost:${port}`);
  for (const lan of lanAddresses()) {
    banner.push(`    On your PHONE (same Wi-Fi): http://${lan.addr}:${port}`);
  }
  banner.push('');
  banner.push('  Phone can\'t connect? Allow Node.js through the Windows');
  banner.push('  Firewall (Private networks) — or disable "AP isolation".');
  banner.push('');
  banner.push('  Press Ctrl+C (or close this window) to STOP the app.');
  banner.push('');
  for (const line of banner) console.log(line);
  // QR code for the first LAN address (scan with phone camera)
  (async () => {
    try {
      const lan = lanAddresses().find((l) => l.private) || lanAddresses()[0];
      if (lan) {
        const { default: QR } = await import('qrcode');
        const url = `http://${lan.addr}:${port}`;
        const qr = await QR.toString(url, { type: 'terminal', small: true });
        console.log('  Scan from your phone to open the app:');
        console.log(qr.split('\n').map((l) => '  ' + l).join('\n'));
      }
    } catch (_) { /* QR is a nice-to-have */ }
  })();
}

// If 8080 is already taken by another program, silently try the next ports
const basePort = Number(process.env.PORT || 8080);
function attempt(port) {
  const srv = app.listen(port, '0.0.0.0', () => showBanner(port));
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && port < basePort + 10) {
      console.log(`  Port ${port} is busy — trying ${port + 1} …`);
      attempt(port + 1);
    } else {
      console.error('  Could not start the server:', e.message);
      process.exit(1);
    }
  });
}
attempt(basePort);
