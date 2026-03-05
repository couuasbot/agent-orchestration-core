#!/usr/bin/env node
/**
 * /aos sprint
 * One closed-loop step:
 *  1) queue_sync (Sense precondition)
 *  2) heartbeat_full (spawn/harvest/plan_apply/auto_review)
 *  3) aggregate DoD evidence (derived)
 *  4) contract_complete if DoD all pass
 */
const { execSync } = require('child_process');

function sh(cmd) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });
}

function arg(name, def = null) {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
}

function main() {
  const taskId = arg('taskId', null);
  const maxConcurrency = arg('maxConcurrency', '2');
  const opsConcurrency = arg('opsConcurrency', '2');
  const slaMinutes = arg('slaMinutes', '240');
  const maxTotalSpawns = arg('maxTotalSpawns', '3');
  const spawnMax = arg('spawnMax', '2');
  const notifyMax = arg('notifyMax', '5');

  const ws = process.env.WORKSPACE_ROOT || '/home/ubuntu/.openclaw/workspace-god';
  const highlights = [];

  let hbOut = '';
  let aggOut = '';
  let ccOut = '';
  let exit = 0;

  try {
    sh(`cd ${ws} && node skills/aos/scripts/core/queue_sync.js`);
    highlights.push('queue_sync: ok');

    hbOut = sh(
      `cd ${ws} && node skills/aos/scripts/effectors/heartbeat_full.js ` +
      `--maxConcurrency=${maxConcurrency} --opsConcurrency=${opsConcurrency} --slaMinutes=${slaMinutes} ` +
      `--maxTotalSpawns=${maxTotalSpawns} --spawnMax=${spawnMax} --notifyMax=${notifyMax}`
    );
    highlights.push('heartbeat_full (incl. aggregate/contract_complete): ok');

  } catch (e) {
    exit = 1;
    highlights.push(`error: ${String(e.message || e)}`);
  }

  const res = {
    command: 'aos sprint',
    exit,
    highlights,
    outputs: {
      heartbeat_full: hbOut ? hbOut.slice(0, 6000) : null,
      aggregate: aggOut ? aggOut.trim() : null,
      contract_complete: ccOut ? ccOut.trim() : null
    }
  };

  console.log(JSON.stringify(res, null, 2));
}

main();
