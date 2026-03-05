#!/usr/bin/env node
/**
 * Complete a contract root when derived DoD status is all-pass.
 * This enforces: DoD auto-pass => DONE (ask only when uncertain).
 *
 * It appends TASK_COMPLETE(DONE) using root.lastDispatch.runId.
 */
const fs = require('fs');
const path = require('path');
const { appendEvent } = require('/home/ubuntu/.openclaw/workspace-god/skills/aos/scripts/lib/event_log');

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

function main() {
  const ws = process.env.WORKSPACE_ROOT || '/home/ubuntu/.openclaw/workspace-god';
  const snapPath = path.join(ws, '.aos', 'workflow-snapshot.json');
  const taskIdArg = process.argv.slice(2).find(a => a.startsWith('--taskId='));
  const taskId = taskIdArg ? taskIdArg.split('=')[1] : null;
  if (!taskId) {
    console.error(JSON.stringify({ status: 'error', message: 'missing --taskId=#...' }));
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const t = snap.tasks && snap.tasks[taskId];
  if (!t) {
    console.error(JSON.stringify({ status: 'error', message: 'task not found in snapshot', taskId }));
    process.exit(1);
  }
  const artifactsDir = t.artifactsDir || path.join(ws, 'artifacts', 'aos-tasks', taskId.slice(1));
  const statusPath = path.join(artifactsDir, 'contract_status.json');

  // Prefer event-sourced aggregate on the task projection; fallback to artifact file.
  let dodStatus = null;
  if (t.contractAggregate && typeof t.contractAggregate === 'object') {
    dodStatus = t.contractAggregate.dodStatus || {};
  } else if (fs.existsSync(statusPath)) {
    const st = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    dodStatus = st.dodStatus || {};
  } else {
    console.error(JSON.stringify({ status: 'error', message: 'no contract aggregate found; run aggregate first', statusPath }));
    process.exit(1);
  }
  const vals = Object.values(dodStatus).map(x => String(x).toLowerCase());
  const allPass = vals.length > 0 && vals.every(v => v === 'pass' || v === 'done');
  if (!allPass) {
    console.log(JSON.stringify({ status: 'ok', completed: false, reason: 'dod_not_all_pass', dodStatus }));
    return;
  }

  const runId = (t.lastDispatch && t.lastDispatch.runId) ? t.lastDispatch.runId : `run_contract_${Date.now()}`;

  const evt = appendEvent({
    type: 'TASK_COMPLETE',
    agent: 'god',
    payload: {
      taskId,
      runId,
      status: 'DONE',
      artifactsBaseDir: artifactsDir,
      dedupeKey: `contract_complete::${taskId}::${runId}`
    }
  });

  console.log(JSON.stringify({ status: 'ok', completed: true, taskId, runId, event: evt }, null, 2));
}

main();
