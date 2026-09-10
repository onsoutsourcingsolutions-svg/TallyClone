// server/unzip.js — tiny zip reader/extractor (no external packages).
// Used ONLY by the in-app updater to unpack the self-update package
// (ONS-Books-PC-Package.zip). Supports the two methods that package
// uses: store (0) and deflate (8). Refuses unsafe paths.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const LFH = 0x04034b50; // "PK\x03\x04" local file header
const CDH = 0x02014b50; // "PK\x01\x02" central directory header
const EOCD = 0x06054b50; // "PK\x05\x06" end of central directory

export function zipEntries(buf) {
  // find end-of-central-directory record (scan backwards, allows trailing data)
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid package (no zip end record).');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let off = buf.readUInt32LE(eocd + 16);
  if (off + cdSize > buf.length) throw new Error('Package index is corrupt.');
  const entries = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(off) !== CDH) throw new Error('Package index is corrupt.');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name, dir: name.endsWith('/'), data: localData(buf, localOff, method, compSize) });
    off = off + 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function localData(buf, lho, method, compSize) {
  if (buf.readUInt32LE(lho) !== LFH) throw new Error('Package data is corrupt.');
  const nameLen = buf.readUInt16LE(lho + 26);
  const extraLen = buf.readUInt16LE(lho + 28);
  const start = lho + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + compSize);
  if (method === 0) return Buffer.from(raw); // stored
  if (method === 8) return zlib.inflateRawSync(raw); // deflate
  throw new Error('Package uses an unsupported compression method (' + method + ').');
}

// Extract every entry of buf into dest, skipping paths listed in `skip`
// (compared as exact path or folder prefix, e.g. "data"). Returns the
// relative paths of the files that were written (directories excluded).
export function extractZip(buf, dest, { skip = [] } = {}) {
  const root = path.resolve(dest);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const written = [];
  outer: for (const e of zipEntries(buf)) {
    const parts = e.name.split('/').filter((p) => p !== '' && p !== '.');
    if (parts.length === 0) continue;
    if (parts.some((p) => p === '..') || /^[a-zA-Z]:/.test(parts[0])) {
      throw new Error('Package contains an unsafe path: ' + e.name);
    }
    const rel = parts.join('/');
    for (const s of skip) {
      if (rel === s || rel.startsWith(s + '/')) continue outer;
    }
    const out = path.join(root, rel);
    if (out !== root && !out.startsWith(root + path.sep)) {
      throw new Error('Package contains an unsafe path: ' + e.name);
    }
    if (e.dir) { fs.mkdirSync(out, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.data);
    written.push(rel);
  }
  return written;
}
