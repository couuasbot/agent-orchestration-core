const fs = require('fs');

function nowMs() { return Date.now(); }

/**
 * Acquire an exclusive lock by creating a lockfile.
 * - If lock exists and is fresh -> throws
 * - If lock exists and is stale -> removes and retries
 */
function acquireLock(lockPath, { staleMs = 10 * 60 * 1000 } = {}) {
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    return { fd, lockPath, acquiredAtMs: nowMs() };
  } catch (e) {
    if (e && e.code !== 'EEXIST') throw e;

    // Lock exists: check staleness
    try {
      const st = fs.statSync(lockPath);
      const ageMs = nowMs() - st.mtimeMs;
      if (ageMs > staleMs) {
        fs.unlinkSync(lockPath);
        const fd = fs.openSync(lockPath, 'wx');
        fs.writeFileSync(fd, String(process.pid));
        return { fd, lockPath, acquiredAtMs: nowMs(), recoveredStale: true };
      }
    } catch (_) {
      // If stat/unlink fails, fall through
    }

    const err = new Error(`Lock is held: ${lockPath}`);
    err.code = 'LOCKED';
    throw err;
  }
}

function releaseLock(lock) {
  if (!lock) return;
  try { fs.closeSync(lock.fd); } catch (_) {}
  try { fs.unlinkSync(lock.lockPath); } catch (_) {}
}

module.exports = { acquireLock, releaseLock };
