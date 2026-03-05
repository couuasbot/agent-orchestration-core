#!/usr/bin/env node

// Report effector pending queues with details (AOS v3.1).
// Reads workflow-events.jsonl + snapshot projection to produce:
// - spawn pending (AOS_SPAWN_REQUEST not followed by AOS_SPAWNED/SKIPPED)
// - notify pending (NOTIFY_REQUEST not followed by NOTIFY_SENT/FAILED/SKIPPED)

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { getWorkspaceRoot } = require('../lib/workspace');
const { getTasksState } = require('../lib/state');

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function toMs(iso) {
  const n = Date.parse(String(iso || ''));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const workspaceRoot = arg('workspaceRoot', getWorkspaceRoot());
  const windowHours = Math.min(24 * 14, Math.max(1, Number(arg('windowHours', '48'))));
  const cutoffMs = Date.now() - windowHours * 3600 * 1000;
  const maxLines = Math.max(1000, Number(arg('maxLines', '300000')));

  const logPath = path.join(workspaceRoot, 'workflow-events.jsonl');
  if (!fs.existsSync(logPath)) {
    console.log(JSON.stringify({ status: 'error', message: 'workflow-events.jsonl not found', logPath }));
    process.exit(1);
  }

  const tasksMap = new Map([...getTasksState(workspaceRoot).values()].map(t => [t.taskId, t]));

  const spawnReq = new Map(); // key -> payload
  const spawnDone = new Set();
  const spawnSkipped = new Set();

  const notifyReq = new Map(); // dedupeKey -> payload
  const notifyDone = new Set();

  const keyTR = (taskId, runId) => `${String(taskId || '')}::${String(runId || '')}`;

  const rl = readline.createInterface({
    input: fs.createReadStream(logPath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  let lines = 0;
  for await (const line of rl) {
    lines += 1;
    if (lines > maxLines) break;
    if (!line) continue;

    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const tsMs = toMs(e.timestamp);
    if (tsMs && tsMs < cutoffMs) continue;

    const type = String(e.type || '').toUpperCase();
    const p = e.payload || {};

    if (type === 'AOS_SPAWN_REQUEST') {
      const k = keyTR(p.taskId, p.runId);
      if (!spawnReq.has(k)) spawnReq.set(k, { ...p, timestamp: e.timestamp });
    }
    if (type === 'AOS_SPAWNED') {
      spawnDone.add(keyTR(p.taskId, p.runId));
    }
    if (type === 'AOS_SPAWN_SKIPPED') {
      spawnSkipped.add(keyTR(p.taskId, p.runId));
    }

    if (type === 'NOTIFY_REQUEST') {
      if (p.dedupeKey && !notifyReq.has(String(p.dedupeKey))) notifyReq.set(String(p.dedupeKey), { ...p, timestamp: e.timestamp });
    }
    if (type === 'NOTIFY_SENT') {
      if (p.dedupeKey) notifyDone.add(String(p.dedupeKey));
    }
    if (type === 'NOTIFY_FAILED' || type === 'NOTIFY_SKIPPED') {
      if (p.requestDedupeKey) notifyDone.add(String(p.requestDedupeKey));
    }
  }

  const spawnPending = [];
  for (const [k, p] of spawnReq.entries()) {
    if (spawnDone.has(k) || spawnSkipped.has(k)) continue;

    const [taskId, runId] = k.split('::');
    const t = tasksMap.get(taskId);

    // Only show actionable pending requests
    if (!t || t.state !== 'In Progress' || !t.lastDispatch || t.lastDispatch.runId !== runId) continue;

    spawnPending.push({
      taskId,
      runId,
      role: p.role || null,
      lane: p.lane || null,
      artifactsDir: p.artifactsDir || null,
      at: p.timestamp || null
    });
  }

  const notifyPending = [];
  for (const [dedupeKey, p] of notifyReq.entries()) {
    if (notifyDone.has(dedupeKey)) continue;
    notifyPending.push({
      dedupeKey,
      kind: p.kind || null,
      taskId: p.taskId || null,
      runId: p.runId || null,
      lane: p.lane || null,
      at: p.timestamp || null
    });
  }

  console.log(JSON.stringify({
    status: 'ok',
    workspaceRoot,
    windowHours,
    scannedLines: lines,
    spawn: { pendingCount: spawnPending.length, pending: spawnPending },
    notify: { pendingCount: notifyPending.length, pending: notifyPending }
  }, null, 2));
}

main().catch(e => {
  console.error(JSON.stringify({ status: 'error', message: e.message }));
  process.exit(1);
});
