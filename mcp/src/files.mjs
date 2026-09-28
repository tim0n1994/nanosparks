import { constants, openSync, closeSync, fstatSync, readSync, writeFileSync, mkdirSync, lstatSync, renameSync, unlinkSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_FILE, PolicyError, canonical, validateSnapshot } from './policy.mjs';

export function readBounded(path, max = MAX_FILE, privateFile = false) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > max || (privateFile && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) throw new PolicyError('FILE_POLICY');
    const bytes = Buffer.alloc(max + 1);
    // The descriptor pins the inode. The bounded buffer also handles concurrent file growth.
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > max) throw new PolicyError('FILE_POLICY');
    return bytes.subarray(0, size).toString('utf8');
  } finally { closeSync(fd); }
}
export function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new PolicyError('DIRECTORY_POLICY');
}
export function atomicPrivateFile(path, text, mode = 0o600) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(temp, path); } catch (e) { unlinkSync(temp); throw e; }
}
export function publishSnapshot(dir, snapshot) {
  privateDirectory(dir);
  const text = canonical(snapshot);
  if (Buffer.byteLength(text) > MAX_FILE) throw new PolicyError('SNAPSHOT_TOO_LARGE');
  const path = join(dir, `${snapshot.hash}.json`);
  try {
    const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o400);
    try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  } catch (error) {
    if (error.code !== 'EEXIST' || readBounded(path, MAX_FILE, true) !== text) throw new PolicyError('SNAPSHOT_COLLISION');
  }
  atomicPrivateFile(join(dir, 'current'), snapshot.hash);
}
export function loadSnapshot(dir, config, retainedHash) {
  privateDirectory(dir);
  const id = retainedHash ?? readBounded(join(dir, 'current'), 64, true);
  if (!/^[0-9a-f]{64}$/.test(id)) throw new PolicyError('INVALID_SNAPSHOT');
  const snapshot = validateSnapshot(JSON.parse(readBounded(join(dir, `${id}.json`), MAX_FILE, true)), config);
  if (snapshot.hash !== id) throw new PolicyError('INVALID_SNAPSHOT');
  return snapshot;
}
