const { appendEvent } = require('./lib/event_log');
const { getTasksState } = require('./lib/state');

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function fail(message, extra = {}) {
  console.error(JSON.stringify({ status: 'error', message, ...extra }));
  process.exit(1);
}

function main() {
  const taskId = arg('taskId');
  const runId = arg('runId');
  const reviewer = arg('reviewer');
  const decisionRaw = arg('decision');
  const notes = arg('notes', '');
  const finalStatusArg = arg('finalStatus', ''); // DONE|FAILED (optional; if omitted, derived from result.json)
  const nextStateArg = arg('nextState', ''); // Ready|Inbox|Failed|Review (optional; default Ready on reject)
  const dedupeKey = arg('dedupeKey', '');

  if (!taskId || !taskId.startsWith('#')) fail('--taskId must start with #');
  if (!runId) fail('--runId is required');
  if (!reviewer) fail('--reviewer is required (e.g., boss)');
  if (!decisionRaw) fail('--decision is required: approved|rejected');

  const decision = String(decisionRaw).toLowerCase();
  if (decision !== 'approved' && decision !== 'rejected') fail('--decision must be approved|rejected');

  // Best-effort: fetch current task projection so we can include resultPath on approve.
  const tasks = getTasksState();
  const t = tasks.get(taskId);
  const resultPath = t && t.resultPath ? t.resultPath : arg('resultPath', '');
  const artifactsBaseDir = t && t.artifactsDir ? t.artifactsDir : arg('artifactsBaseDir', '');

  // Derive final status from result.json if caller didn't specify.
  let derivedFinalStatus = '';
  if (resultPath) {
    try {
      const obj = JSON.parse(require('fs').readFileSync(resultPath, 'utf8'));
      const st = String(obj.status || '').toLowerCase();
      if (st === 'success') derivedFinalStatus = 'DONE';
      if (st === 'failure') derivedFinalStatus = 'FAILED';
    } catch (_) {}
  }

  const reviewDedupe = dedupeKey || `review::${taskId}::${runId}::${decision}::${reviewer}`;

  // Decide final status / next state
  let finalStatus = String(finalStatusArg || derivedFinalStatus || '').toUpperCase();
  if (finalStatus && finalStatus !== 'DONE' && finalStatus !== 'FAILED') {
    fail('--finalStatus must be DONE|FAILED');
  }

  let nextState = String(nextStateArg || '').trim();
  if (nextState) {
    // normalize common values
    const ns = nextState.toLowerCase();
    if (ns === 'ready') nextState = 'Ready';
    else if (ns === 'inbox') nextState = 'Inbox';
    else if (ns === 'failed') nextState = 'Failed';
    else if (ns === 'review') nextState = 'Review';
  }

  const reviewEvt = appendEvent({
    type: 'TASK_REVIEW',
    agent: 'god',
    payload: {
      taskId,
      runId,
      reviewer,
      decision,
      notes: notes || undefined,
      finalStatus: decision === 'approved' ? (finalStatus || undefined) : undefined,
      nextState: decision === 'rejected' ? (nextState || undefined) : undefined,
      dedupeKey: reviewDedupe
    }
  });

  if (decision === 'approved') {
    if (!resultPath) fail('approve requires task.resultPath (or pass --resultPath)', { taskId, runId });
    if (!finalStatus) fail('approve requires --finalStatus=DONE|FAILED or derivable from result.json', { taskId, runId, resultPath });

    const completeEvt = appendEvent({
      type: 'TASK_COMPLETE',
      agent: 'god',
      payload: {
        taskId,
        runId,
        status: finalStatus,
        resultPath,
        artifactsBaseDir: artifactsBaseDir || undefined,
        dedupeKey: `review_complete::${taskId}::${runId}::${finalStatus}`
      }
    });

    console.log(JSON.stringify({ status: 'ok', review: reviewEvt, complete: completeEvt }));
    return;
  }

  // rejected: default move back to Ready for re-dispatch (or caller-chosen nextState)
  const targetState = nextState || 'Ready';
  const stateEvt = appendEvent({
    type: 'TASK_STATE',
    agent: 'god',
    payload: {
      taskId,
      state: targetState,
      dedupeKey: `review_reject::${taskId}::${runId}::${String(targetState).toLowerCase()}`
    }
  });

  console.log(JSON.stringify({ status: 'ok', review: reviewEvt, state: stateEvt }));
}

main();
