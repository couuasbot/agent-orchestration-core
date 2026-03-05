const fs = require('fs');
const path = require('path');

const { getWorkspaceRoot } = require('./workspace');
const { acquireLock, releaseLock } = require('./lock');
const { safeJsonParse, atomicWriteFile } = require('./util');

function getEventLogPath() {
  const root = getWorkspaceRoot();
  return path.join(root, 'workflow-events.jsonl');
}

function getAosDir() {
  const root = getWorkspaceRoot();
  return path.join(root, '.aos');
}

function getDedupeIndexPath() {
  return path.join(getAosDir(), 'dedupe-index.json');
}

function readTailLines(filePath, maxLines = 200) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  return lines.slice(Math.max(0, lines.length - maxLines));
}

function makeEvent({ type, payload, agent }) {
  return {
    schemaVersion: 1,
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    type: String(type || 'INFO').toUpperCase(),
    agent: agent || 'god',
    payload: payload || {}
  };
}

function sleepMs(ms) {
  // Synchronous sleep without timers (works in Node): Atomics.wait
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function loadDedupeIndex() {
  const p = getDedupeIndexPath();
  if (!fs.existsSync(p)) {
    return { schemaVersion: 1, updatedAt: new Date().toISOString(), maxEntries: 50000, entries: {}, order: [] };
  }
  try {
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!obj || typeof obj !== 'object') throw new Error('bad index');
    if (!obj.entries || typeof obj.entries !== 'object') obj.entries = {};
    if (!Array.isArray(obj.order)) obj.order = Object.keys(obj.entries);
    if (!Number.isFinite(obj.maxEntries)) obj.maxEntries = 50000;
    if (!obj.schemaVersion) obj.schemaVersion = 1;
    return obj;
  } catch (_) {
    // Corrupt index -> start fresh (event log remains source of truth)
    return { schemaVersion: 1, updatedAt: new Date().toISOString(), maxEntries: 50000, entries: {}, order: [] };
  }
}

function saveDedupeIndex(index) {
  const dir = path.dirname(getDedupeIndexPath());
  fs.mkdirSync(dir, { recursive: true });
  index.updatedAt = new Date().toISOString();
  atomicWriteFile(getDedupeIndexPath(), JSON.stringify(index, null, 2) + '\n');
}

function pruneIndex(index) {
  const maxEntries = Number(index.maxEntries || 50000);
  if (index.order.length <= maxEntries) return;

  // Drop oldest 10% (or at least 100) to avoid frequent rewrites.
  const drop = Math.max(100, Math.floor(maxEntries * 0.1));
  const toDrop = index.order.splice(0, drop);
  for (const k of toDrop) delete index.entries[k];
}

/**
 * Append one event (exclusive locked).
 * Supports idempotency via payload.dedupeKey:
 *   - Primary: dedupe index (O(1))
 *   - Fallback: recent tail scan if index missing/corrupt
 */
function appendEvent({
  type,
  payload = {},
  agent = 'god',
  lockStaleMs = 10 * 60 * 1000,
  dedupeWindowLines = 400,
  lockRetries = 20
}) {
  const eventsFile = getEventLogPath();
  const lockPath = `${eventsFile}.lock`;

  let lock = null;
  for (let attempt = 0; attempt < lockRetries; attempt++) {
    try {
      lock = acquireLock(lockPath, { staleMs: lockStaleMs });
      break;
    } catch (e) {
      if (e && e.code === 'LOCKED' && attempt < lockRetries - 1) {
        const base = 50;
        const jitter = Math.floor(Math.random() * 150);
        sleepMs(base + jitter);
        continue;
      }
      throw e;
    }
  }

  try {
    // Ensure file exists
    if (!fs.existsSync(eventsFile)) fs.writeFileSync(eventsFile, '', 'utf8');

    const upperType = String(type || 'INFO').toUpperCase();
    const dedupeKey = payload && payload.dedupeKey ? String(payload.dedupeKey) : '';

    if (dedupeKey) {
      const compositeKey = `${upperType}::${dedupeKey}`;

      // Primary dedupe: index
      const index = loadDedupeIndex();
      if (index.entries[compositeKey]) {
        return { status: 'duplicate', message: 'Event deduped (index)', dedupeKey };
      }

      // Fallback dedupe: tail scan (source-of-truth check)
      const tail = readTailLines(eventsFile, dedupeWindowLines);
      for (const line of tail) {
        const e = safeJsonParse(line);
        if (!e) continue;
        const eType = (e.type || '').toUpperCase();
        const eKey = e.payload && e.payload.dedupeKey ? String(e.payload.dedupeKey) : '';
        if (eType === upperType && eKey === dedupeKey) {
          // Repair index so subsequent lookups are O(1)
          index.entries[compositeKey] = { eventId: e.id || null, ts: e.timestamp || null };
          index.order.push(compositeKey);
          pruneIndex(index);
          saveDedupeIndex(index);
          return { status: 'duplicate', message: 'Event deduped (tail)', dedupeKey };
        }
      }

      // Not a duplicate -> append and record in index
      const event = makeEvent({ type: upperType, payload, agent });
      fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n', 'utf8');

      index.entries[compositeKey] = { eventId: event.id, ts: event.timestamp };
      index.order.push(compositeKey);
      pruneIndex(index);
      saveDedupeIndex(index);

      return { status: 'success', eventId: event.id };
    }

    // No dedupeKey -> append directly
    const event = makeEvent({ type: upperType, payload, agent });
    fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n', 'utf8');
    return { status: 'success', eventId: event.id };
  } finally {
    releaseLock(lock);
  }
}

module.exports = { getEventLogPath, appendEvent, makeEvent };
