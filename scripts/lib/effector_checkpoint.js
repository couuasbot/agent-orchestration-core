const fs = require('fs');
const path = require('path');

const { getWorkspaceRoot } = require('./workspace');
const { atomicWriteFile, safeJsonParse } = require('./util');

function getEffectorsDir() {
  return path.join(getWorkspaceRoot(), '.aos', 'effectors');
}

function getCheckpointPath(name) {
  const safe = String(name || 'effector').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return path.join(getEffectorsDir(), `${safe}.checkpoint.json`);
}

function loadCheckpoint(name) {
  const p = getCheckpointPath(name);
  if (!fs.existsSync(p)) return { schemaVersion: 1, updatedAt: null, offset: 0 };
  try {
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!obj || typeof obj !== 'object') throw new Error('bad');
    if (!Number.isFinite(obj.offset) || obj.offset < 0) obj.offset = 0;
    if (!obj.schemaVersion) obj.schemaVersion = 1;
    return obj;
  } catch (_) {
    return { schemaVersion: 1, updatedAt: null, offset: 0 };
  }
}

function saveCheckpoint(name, offset) {
  fs.mkdirSync(getEffectorsDir(), { recursive: true });
  const p = getCheckpointPath(name);
  const obj = { schemaVersion: 1, updatedAt: new Date().toISOString(), offset: Number(offset) || 0 };
  atomicWriteFile(p, JSON.stringify(obj, null, 2) + '\n');
}

/**
 * Iterate JSONL file from startOffset, calling onEvent for each complete line.
 * onEvent signature: ({ event, rawLine, offsetAfterLine }) => { stop?: boolean }
 * Returns: { newOffset, lines }
 */
function iterateJsonlFromOffset(filePath, startOffset, { maxLines = 20000, onEvent }) {
  if (!fs.existsSync(filePath)) return { newOffset: 0, lines: 0 };

  const st = fs.statSync(filePath);
  const size = st.size;
  if (!Number.isFinite(startOffset) || startOffset < 0) startOffset = 0;
  if (startOffset > size) startOffset = 0; // truncated/rotated

  const fd = fs.openSync(filePath, 'r');
  let cursor = startOffset;
  let safeOffset = startOffset;
  let carry = Buffer.alloc(0);
  let lines = 0;

  try {
    const CHUNK = 64 * 1024;
    const buf = Buffer.alloc(CHUNK);

    while (lines < maxLines) {
      const bytes = fs.readSync(fd, buf, 0, CHUNK, cursor);
      if (bytes === 0) break;
      cursor += bytes;

      const incoming = buf.subarray(0, bytes);
      const combined = carry.length ? Buffer.concat([carry, incoming]) : incoming;

      // Find last newline in the combined buffer
      const lastNL = combined.lastIndexOf(0x0A); // '\n'
      if (lastNL === -1) {
        // No complete line yet, keep buffering.
        carry = combined;
        continue;
      }

      const complete = combined.subarray(0, lastNL); // exclude final '\n'
      carry = combined.subarray(lastNL + 1);

      const text = complete.toString('utf8');
      const parts = text.split('\n');

      // Update safeOffset to cursor minus carry length (bytes beyond last newline)
      safeOffset = cursor - carry.length;

      // Compute per-line offsets so we can stop early without skipping unseen lines.
      const processedLen = lastNL + 1; // bytes up to and including the last '\n'
      const processedStart = safeOffset - processedLen;
      let offsetAfterLine = processedStart;

      for (const rawLine of parts) {
        lines += 1;
        // Each line in parts is terminated by a '\n' in the file (because we cut at lastNL)
        offsetAfterLine += Buffer.byteLength(rawLine, 'utf8') + 1;

        if (rawLine) {
          const event = safeJsonParse(rawLine);
          if (event) {
            const res = onEvent({ event, rawLine, offsetAfterLine });
            if (res && res.stop) {
              return { newOffset: offsetAfterLine, lines };
            }
          }
        }

        if (lines >= maxLines) break;
      }
    }

    // EOF: if carry has a final line without newline, process it and advance offset.
    if (carry.length && lines < maxLines) {
      const rawLine = carry.toString('utf8');
      const event = safeJsonParse(rawLine);
      const finalOffset = cursor;
      if (event) {
        lines += 1;
        const res = onEvent({ event, rawLine, offsetAfterLine: finalOffset });
        if (res && res.stop) {
          return { newOffset: finalOffset, lines };
        }
      }
      safeOffset = finalOffset;
    }

    return { newOffset: safeOffset, lines };
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
  }
}

module.exports = {
  loadCheckpoint,
  saveCheckpoint,
  iterateJsonlFromOffset
};
