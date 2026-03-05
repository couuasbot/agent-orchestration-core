#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { getWorkspaceRoot } = require('./lib/workspace');
const { getEventLogPath } = require('./lib/event_log');
const { getTasksState } = require('./lib/state');

const ROOT = getWorkspaceRoot();
const AOS_DIR = path.join(ROOT, '.aos');
const SNAPSHOT_PATH = path.join(AOS_DIR, 'workflow-snapshot.json');
const DEDUPE_INDEX_PATH = path.join(AOS_DIR, 'dedupe-index.json');

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return 'n/a';
  const units = ['B','KB','MB','GB'];
  let x = n;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function fmtDate(iso) {
  if (!iso) return 'n/a';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString();
}

function minutesBetween(isoA, isoB) {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 60000);
}

function listInProgress(tasks) {
  return [...tasks.values()].filter(t => t.state === 'In Progress');
}

function listReview(tasks) {
  return [...tasks.values()].filter(t => t.state === 'Review');
}

function main() {
  const logPath = getEventLogPath();

  let logSize = 0;
  let logLines = null;
  if (exists(logPath)) {
    try { logSize = fs.statSync(logPath).size; } catch {}
    // For large logs, line counting is expensive; only count when size < 20MB
    if (logSize < 20 * 1024 * 1024) {
      try {
        const content = fs.readFileSync(logPath, 'utf8');
        logLines = content.split('\n').filter(Boolean).length;
      } catch {}
    }
  }

  const snap = exists(SNAPSHOT_PATH) ? readJson(SNAPSHOT_PATH) : null;
  const idx = exists(DEDUPE_INDEX_PATH) ? readJson(DEDUPE_INDEX_PATH) : null;

  // Ensure task projection is usable (also refreshes snapshot).
  let tasks;
  try {
    tasks = getTasksState();
  } catch (e) {
    tasks = new Map();
  }

  const nowIso = new Date().toISOString();
  const inProg = listInProgress(tasks);
  const inReview = listReview(tasks);

  const snapOffset = snap && Number.isFinite(snap.offset) ? snap.offset : null;
  const snapLagBytes = (snapOffset != null) ? (logSize - snapOffset) : null;

  const idxEntries = idx && idx.entries && typeof idx.entries === 'object' ? Object.keys(idx.entries).length : null;
  const idxUpdatedAt = idx && idx.updatedAt ? idx.updatedAt : null;

  const lines = [];
  lines.push('# AOS Doctor Report');
  lines.push('');
  lines.push(`- **Workspace:** ${ROOT}`);
  lines.push(`- **Generated:** ${nowIso}`);

  lines.push('');
  lines.push('## Event Log');
  lines.push('');
  lines.push(`- **Path:** ${logPath}`);
  lines.push(`- **Exists:** ${exists(logPath) ? 'yes' : 'no'}`);
  lines.push(`- **Size:** ${fmtBytes(logSize)}${logLines != null ? ` (${logLines} lines)` : ''}`);

  lines.push('');
  lines.push('## Snapshot (Incremental Projection)');
  lines.push('');
  lines.push(`- **Path:** ${SNAPSHOT_PATH}`);
  lines.push(`- **Exists:** ${exists(SNAPSHOT_PATH) ? 'yes' : 'no'}`);
  if (snap) {
    lines.push(`- **UpdatedAt:** ${fmtDate(snap.updatedAt)}`);
    lines.push(`- **Offset:** ${snap.offset}`);
    lines.push(`- **Lag vs log:** ${snapLagBytes != null ? fmtBytes(snapLagBytes) : 'n/a'}`);
    lines.push(`- **Tasks in snapshot:** ${snap.tasks ? Object.keys(snap.tasks).length : 'n/a'}`);
  } else {
    lines.push('- **Status:** missing or unreadable');
  }

  lines.push('');
  lines.push('## Dedupe Index');
  lines.push('');
  lines.push(`- **Path:** ${DEDUPE_INDEX_PATH}`);
  lines.push(`- **Exists:** ${exists(DEDUPE_INDEX_PATH) ? 'yes' : 'no'}`);
  if (idx) {
    lines.push(`- **UpdatedAt:** ${fmtDate(idxUpdatedAt)}`);
    lines.push(`- **Entries:** ${idxEntries != null ? idxEntries : 'n/a'}`);
    lines.push(`- **MaxEntries:** ${idx.maxEntries || 'n/a'}`);
  } else {
    lines.push('- **Status:** missing or unreadable');
  }

  lines.push('');
  lines.push('## Task Projection');
  lines.push('');
  lines.push(`- **Total tasks:** ${tasks.size}`);
  lines.push(`- **In Progress:** ${inProg.length}`);
  lines.push(`- **Review:** ${inReview.length}`);

  if (inProg.length) {
    lines.push('');
    lines.push('### In Progress Details');
    lines.push('');
    for (const t of inProg) {
      const runId = t.lastDispatch?.runId || 'n/a';
      const ageMin = t.inProgressAt ? minutesBetween(t.inProgressAt, nowIso) : null;
      const sla = t.slaMinutes || 'n/a';
      const baseDir = t.lastDispatch?.artifactsBaseDir || t.artifactsDir || 'n/a';
      const runDir = (baseDir !== 'n/a' && runId !== 'n/a') ? path.join(baseDir, runId) : 'n/a';
      const resultPath = (runDir !== 'n/a') ? path.join(runDir, 'result.json') : 'n/a';

      lines.push(`- **${t.taskId}** — ${t.title}`);
      lines.push(`  - role: ${t.roleHint || 'n/a'} | runId: ${runId}`);
      lines.push(`  - inProgressAt: ${fmtDate(t.inProgressAt)} | age: ${ageMin != null ? `${ageMin}m` : 'n/a'} | SLA: ${sla}m`);
      lines.push(`  - artifactsBaseDir: ${baseDir}`);
      lines.push(`  - expectedRunDir: ${runDir}`);
      lines.push(`  - expectedResult: ${resultPath} (${exists(resultPath) ? 'exists' : 'missing'})`);
    }
  }

  if (inReview.length) {
    lines.push('');
    lines.push('### Review Queue');
    lines.push('');
    for (const t of inReview) {
      lines.push(`- **${t.taskId}** — ${t.title} (@${t.roleHint || 'n/a'})`);
      lines.push(`  - updatedAt: ${fmtDate(t.updatedAt)}`);
      lines.push(`  - lastDispatch.runId: ${t.lastDispatch?.runId || 'n/a'}`);
      lines.push(`  - resultPath: ${t.resultPath || 'n/a'}`);
    }
  }

  // Health verdicts
  lines.push('');
  lines.push('## Health Verdicts');
  lines.push('');

  const verdicts = [];
  if (!exists(logPath)) verdicts.push('❌ Event log missing');
  if (!snap) verdicts.push('⚠️ Snapshot missing/unreadable (projection will be slower; may still function)');
  if (!idx) verdicts.push('⚠️ Dedupe index missing/unreadable (idempotency will fallback to tail scan)');
  if (snapLagBytes != null && snapLagBytes > 0) verdicts.push(`⚠️ Snapshot is behind event log by ${fmtBytes(snapLagBytes)} (will catch up on next run)`);
  if (inProg.length) verdicts.push(`⚠️ ${inProg.length} task(s) In Progress`);
  if (inReview.length) verdicts.push(`⚠️ ${inReview.length} task(s) in Review (manual attention likely required)`);

  if (!verdicts.length) verdicts.push('✅ No obvious issues detected.');
  for (const v of verdicts) lines.push(`- ${v}`);

  lines.push('');
  console.log(lines.join('\n'));
}

main();
