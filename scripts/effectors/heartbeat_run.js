#!/usr/bin/env node

// One-shot Heartbeat runner (AOS v3.1):
// 1) Sense: refresh QUEUE.md (human view)
// 2) Autopilot: compute deterministic actions
// 3) Effect: execute actions into workflow-events.jsonl

const path = require('path');
const { spawnSync } = require('child_process');

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function runNode(script, argv = []) {
  const p = spawnSync('node', [script, ...argv], { encoding: 'utf8' });
  return p;
}

function main() {
  const workspaceRoot = require('../lib/workspace').getWorkspaceRoot();

  const queueSync = path.join(workspaceRoot, 'skills/aos/scripts/core/queue_sync.js');
  const autopilot = path.join(workspaceRoot, 'skills/aos/scripts/core/autopilot.js');
  const execActions = path.join(workspaceRoot, 'skills/aos/scripts/effectors/execute_actions.js');

  // 1) Sense (human projection)
  runNode(queueSync);

  // 2) Autopilot
  const ap = runNode(autopilot, process.argv.slice(2));
  if (ap.status !== 0) {
    console.error(JSON.stringify({ status: 'error', step: 'autopilot', stdout: ap.stdout, stderr: ap.stderr }));
    process.exit(2);
  }

  let apObj = null;
  try { apObj = JSON.parse((ap.stdout || '').trim()); } catch (e) {
    console.error(JSON.stringify({ status: 'error', step: 'autopilot_parse', error: e.message, stdout: ap.stdout }));
    process.exit(3);
  }

  // 3) Execute actions
  const ea = spawnSync('node', [execActions], { input: JSON.stringify(apObj), encoding: 'utf8' });
  if (ea.status !== 0) {
    console.error(JSON.stringify({ status: 'error', step: 'execute_actions', stdout: ea.stdout, stderr: ea.stderr }));
    process.exit(4);
  }

  console.log(JSON.stringify({ status: 'ok', autopilot: apObj.meta || null, actions: apObj.actions || [], effector: JSON.parse(ea.stdout) }, null, 2));
}

main();
