#!/usr/bin/env node

// Full Heartbeat pipeline (AOS v3.1):
// queue_sync -> autopilot -> execute_actions -> spawn_runner -> harvest -> plan_apply -> auto_review -> notifier
//
// This script is designed for operator use or an external cron.

const path = require('path');
const { spawnSync } = require('child_process');

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function main() {
  const workspaceRoot = require('../lib/workspace').getWorkspaceRoot();

  const hb = path.join(workspaceRoot, 'skills/aos/scripts/effectors/heartbeat_run.js');
  const spawner = path.join(workspaceRoot, 'skills/aos/scripts/effectors/spawn_runner.js');
  const aggregate = path.join(workspaceRoot, 'skills/aos/scripts/effectors/aggregate.js');
  const contractComplete = path.join(workspaceRoot, 'skills/aos/scripts/effectors/contract_complete.js');
  const planApply = path.join(workspaceRoot, 'skills/aos/scripts/effectors/plan_apply.js');
  const autoReview = path.join(workspaceRoot, 'skills/aos/scripts/effectors/auto_review.js');
  const learnApply = path.join(workspaceRoot, 'skills/aos/scripts/effectors/learn_apply.js');
  const notifier = path.join(workspaceRoot, 'skills/aos/scripts/effectors/notifier.js');

  const hbArgs = process.argv.slice(2).filter(a => !a.startsWith('--spawnMax=') && !a.startsWith('--notifyMax='));
  const spawnMax = arg('spawnMax', '1');
  const notifyMax = arg('notifyMax', '5');

  const r1 = spawnSync('node', [hb, ...hbArgs], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (r1.status !== 0) {
    console.error(r1.stdout || '');
    console.error(r1.stderr || '');
    process.exit(2);
  }

  // Fulfill spawn requests (may be slow)
  const r2 = spawnSync('node', [spawner, `--max=${spawnMax}`], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

  // Optional: Harvest after spawn (collect result.json quickly without spawning more)
  const harvest = String(arg('harvest', 'true')).toLowerCase() === 'true';
  let rHarvest = null;
  if (harvest) {
    rHarvest = spawnSync('node', [hb, ...hbArgs, '--maxTotalSpawns=0'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  }

  // Aggregate DoD results (idempotent)
  const rAggregate = spawnSync('node', [aggregate], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

  // Close contract if DoD passes (idempotent)
  const rContract = spawnSync('node', [contractComplete], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

  // Apply COO plans -> create concrete tasks (idempotent)
  const rPlan = spawnSync('node', [planApply], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

  // Auto-review eligible Review tasks (idempotent by projection)
  const rAuto = spawnSync('node', [autoReview], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

  // Convert failures into durable lessons (idempotent)
  const rLearn = spawnSync('node', [learnApply], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

  // Send notifications (if configured)
  const r3 = spawnSync('node', [notifier, `--max=${notifyMax}`], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });

  console.log(JSON.stringify({
    status: 'ok',
    heartbeat: r1.stdout ? safeJson(r1.stdout) : null,
    spawn: r2.stdout ? safeJson(r2.stdout) : null,
    harvest: rHarvest && rHarvest.stdout ? safeJson(rHarvest.stdout) : null,
    aggregate: rAggregate.stdout ? safeJson(rAggregate.stdout) : null,
    contractComplete: rContract.stdout ? safeJson(rContract.stdout) : null,
    planApply: rPlan.stdout ? safeJson(rPlan.stdout) : null,
    autoReview: rAuto.stdout ? safeJson(rAuto.stdout) : null,
    learnApply: rLearn.stdout ? safeJson(rLearn.stdout) : null,
    notify: r3.stdout ? safeJson(r3.stdout) : null
  }, null, 2));

  function safeJson(s) {
    try { return JSON.parse(String(s).trim()); } catch (_) { return { raw: String(s) }; }
  }
}

main();
