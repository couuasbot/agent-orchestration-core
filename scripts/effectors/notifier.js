#!/usr/bin/env node

// Send chat notifications for NOTIFY_REQUEST events using OpenClaw CLI,
// then record NOTIFY_SENT (deduped) into the event log.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { getWorkspaceRoot } = require('../lib/workspace');
const { acquireLock, releaseLock } = require('../lib/lock');
const { safeJsonParse } = require('../lib/util');
const { appendEvent } = require('../lib/event_log');

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function loadDedupeIndex() {
  const root = getWorkspaceRoot();
  const p = path.join(root, '.aos', 'dedupe-index.json');
  try {
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    return obj && obj.entries ? obj : { entries: {} };
  } catch (_) {
    return { entries: {} };
  }
}

function formatMessage(req) {
  const kind = req.kind || 'notify';
  if (kind === 'spawn') {
    return `[AOS] spawn ${req.taskId} -> @${req.role || ''} (${req.lane || 'execution'})\nrunId=${req.runId}\n${req.title || ''}`.trim();
  }
  if (kind === 'review_request') {
    return `[AOS] ${req.taskId} awaiting review (${req.lane || 'execution'})\nrunId=${req.runId}\nSummary: ${req.summary || ''}`.trim();
  }
  if (kind === 'complete') {
    return `[AOS] ${req.taskId} ${req.status || ''} (${req.lane || 'execution'})\nrunId=${req.runId}\n${req.summary || req.reason || ''}`.trim();
  }
  if (kind === 'stale_fail') {
    return `[AOS] ${req.taskId} FAILED (stale)\nrunId=${req.runId}\n${req.reason || ''}`.trim();
  }
  return `[AOS] ${kind}: ${req.taskId || ''} ${req.runId || ''} ${req.reason || ''}`.trim();
}

function main() {
  const root = getWorkspaceRoot();
  const channel = arg('channel', process.env.AOS_NOTIFY_CHANNEL || '');
  const target = arg('target', process.env.AOS_NOTIFY_TARGET || '');
  const max = Number(arg('max', '5'));
  const dryRun = String(arg('dryRun', process.env.AOS_NOTIFY_DRYRUN || '')).toLowerCase() === 'true';

  const lockPath = path.join(root, '.aos', 'notifier.lock');
  let lock = null;
  try {
    lock = acquireLock(lockPath, { staleMs: 10 * 60 * 1000 });
  } catch (e) {
    if (e && e.code === 'LOCKED') {
      console.log(JSON.stringify({ status: 'ok', message: 'notifier locked; noop' }));
      return;
    }
    throw e;
  }

  try {
    const logPath = path.join(root, 'workflow-events.jsonl');
    const { loadCheckpoint, saveCheckpoint, iterateJsonlFromOffset } = require('../lib/effector_checkpoint');

    const dedupe = loadDedupeIndex();
    const sent = [];

    const ck = loadCheckpoint('notifier');

    const { newOffset } = iterateJsonlFromOffset(logPath, ck.offset, {
      maxLines: 100000,
      onEvent: ({ event }) => {
        if (sent.length >= max) return { stop: true };
        if (String(event.type || '').toUpperCase() !== 'NOTIFY_REQUEST') return;

        const p = event.payload || {};
        const dedupeKey = p.dedupeKey;
        if (!dedupeKey) return;

        const composite = `NOTIFY_SENT::${dedupeKey}`;
        if (dedupe.entries && dedupe.entries[composite]) return;

        const text = formatMessage(p);

        if (!channel || !target) {
          appendEvent({
            type: 'NOTIFY_SKIPPED',
            agent: 'god',
            payload: {
              ...p,
              requestDedupeKey: dedupeKey,
              reason: 'missing --channel/--target (or env AOS_NOTIFY_CHANNEL/AOS_NOTIFY_TARGET)',
              dedupeKey: `notify_skipped::${dedupeKey}`
            }
          });
          sent.push({ dedupeKey, ok: false, skipped: true });
          return;
        }

        if (dryRun) {
          sent.push({ dedupeKey, ok: true, dryRun: true, message: text });
        } else {
          const r = spawnSync('openclaw', [
            'message', 'send',
            '--channel', channel,
            '--target', target,
            '--message', text,
            '--json'
          ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });

          if (r.status !== 0) {
            appendEvent({
              type: 'NOTIFY_FAILED',
              agent: 'god',
              payload: {
                ...p,
                requestDedupeKey: dedupeKey,
                stderr: (r.stderr || '').slice(0, 2000),
                exitCode: r.status,
                dedupeKey: `notify_failed::${dedupeKey}`
              }
            });
            sent.push({ dedupeKey, ok: false, exitCode: r.status });
            return;
          }

          sent.push({ dedupeKey, ok: true });
        }

        appendEvent({
          type: 'NOTIFY_SENT',
          agent: 'god',
          payload: {
            kind: p.kind,
            taskId: p.taskId,
            runId: p.runId,
            lane: p.lane,
            status: p.status,
            dedupeKey
          }
        });

        if (sent.length >= max) return { stop: true };
      }
    });

    saveCheckpoint('notifier', newOffset);

    console.log(JSON.stringify({ status: 'ok', sentCount: sent.length, sent, checkpointOffset: newOffset }, null, 2));
  } finally {
    releaseLock(lock);
  }
}

main();
