const { appendEvent } = require('../lib/event_log');
const { taskKeyFromId } = require('../lib/util');
const path = require('path');
const { getWorkspaceRoot } = require('../lib/workspace');

const WORKSPACE_ROOT = getWorkspaceRoot();

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function main() {
  const taskId = arg('taskId');
  const title = arg('title');
  const details = arg('details');
  const roleHint = arg('roleHint', 'cto');
  const priority = arg('priority', 'P1');
  const lane = arg('lane', 'execution'); // execution | ops
  const reviewerHint = arg('reviewerHint', ''); // optional reviewer role/name
  const slaMinutes = Number(arg('slaMinutes', '60'));
  const dedupeKey = arg('dedupeKey', '');

  if (!taskId || !taskId.startsWith('#')) {
    console.error(JSON.stringify({ status: 'error', message: '--taskId must start with #' }));
    process.exit(1);
  }

  const key = taskKeyFromId(taskId);
  const artifactsDir = path.join(WORKSPACE_ROOT, 'artifacts', 'aos-tasks', key);

  const create = appendEvent({
    type: 'TASK_CREATE',
    agent: 'god',
    payload: { taskId, title, details, roleHint, priority, lane, reviewerHint: reviewerHint || undefined, slaMinutes, artifactsDir, dedupeKey }
  });

  const state = appendEvent({
    type: 'TASK_STATE',
    agent: 'god',
    payload: { taskId, state: 'Ready', dedupeKey: dedupeKey ? `${dedupeKey}::ready` : '' }
  });

  console.log(JSON.stringify({ status: 'ok', create, state, artifactsDir }));
}

main();
