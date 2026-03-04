const fs = require('fs');
const path = require('path');

function nowMs() { return Date.now(); }

function readLock(lockPath) {
  try {
    const txt = fs.readFileSync(lockPath, 'utf8');
    const obj = JSON.parse(txt);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch (_) {
    return null;
  }
}

function writeLock(fd, obj) {
  fs.writeFileSync(fd, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * Acquire a global autopilot mutex.
 * Lock file content includes: pid, startTs, ttlMs.
 * - If lock exists and is not stale -> throws LOCKED
 * - If lock exists and is stale -> removes and reacquires (recoveredStale=true)
 */
function acquireAutopilotLock(lockPath, { ttlMs = 10 * 60 * 1000 } = {}) {
  const dir = path.dirname(lockPath);
  fs.mkdirSync(dir, { recursive: true });

  try {
    const fd = fs.openSync(lockPath, 'wx');
    const lock = { pid: process.pid, startTs: new Date().toISOString(), ttlMs: Number(ttlMs) };
    writeLock(fd, lock);
    return { fd, lockPath, lock, recoveredStale: false, previous: null };
  } catch (e) {
    if (!e || e.code !== 'EEXIST') throw e;

    const existing = readLock(lockPath);
    if (existing && existing.startTs && Number.isFinite(existing.ttlMs)) {
      const start = new Date(existing.startTs).getTime();
      const staleAt = start + Number(existing.ttlMs);
      if (Number.isFinite(start) && nowMs() > staleAt) {
        // stale -> recover
        try { fs.unlinkSync(lockPath); } catch (_) {}
        const fd = fs.openSync(lockPath, 'wx');
        const lock = { pid: process.pid, startTs: new Date().toISOString(), ttlMs: Number(ttlMs) };
        writeLock(fd, lock);
        return { fd, lockPath, lock, recoveredStale: true, previous: existing };
      }
    } else {
      // Fallback: use mtime if unparsable
      try {
        const st = fs.statSync(lockPath);
        if (nowMs() - st.mtimeMs > ttlMs) {
          try { fs.unlinkSync(lockPath); } catch (_) {}
          const fd = fs.openSync(lockPath, 'wx');
          const lock = { pid: process.pid, startTs: new Date().toISOString(), ttlMs: Number(ttlMs) };
          writeLock(fd, lock);
          return { fd, lockPath, lock, recoveredStale: true, previous: existing };
        }
      } catch (_) {}
    }

    const err = new Error(`Autopilot lock is held: ${lockPath}`);
    err.code = 'LOCKED';
    err.existing = existing;
    throw err;
  }
}

function releaseAutopilotLock(h) {
  if (!h) return;
  try { fs.closeSync(h.fd); } catch (_) {}
  try { fs.unlinkSync(h.lockPath); } catch (_) {}
}

module.exports = { acquireAutopilotLock, releaseAutopilotLock };
