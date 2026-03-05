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

  const reviewDedupe = dedupeKey || `review::${taskId}::${runId}::${decision}::${reviewer}`;

  const reviewEvt = appendEvent({
    type: 'TASK_REVIEW',
    agent: 'god',
    payload: {
      taskId,
      runId,
      reviewer,
      decision,
      notes: notes || undefined,
      dedupeKey: reviewDedupe
    }
  });

  if (decision === 'approved') {
    if (!resultPath) fail('approve requires task.resultPath (or pass --resultPath)', { taskId, runId });

    const completeEvt = appendEvent({
      type: 'TASK_COMPLETE',
      agent: 'god',
      payload: {
        taskId,
        runId,
        status: 'DONE',
        resultPath,
        artifactsBaseDir: artifactsBaseDir || undefined,
        dedupeKey: `review_complete::${taskId}::${runId}::DONE`
      }
    });

    console.log(JSON.stringify({ status: 'ok', review: reviewEvt, complete: completeEvt }));
    return;
  }

  // rejected: move back to Ready for re-dispatch
  const stateEvt = appendEvent({
    type: 'TASK_STATE',
    agent: 'god',
    payload: {
      taskId,
      state: 'Ready',
      dedupeKey: `review_reject::${taskId}::${runId}::ready`
    }
  });

  console.log(JSON.stringify({ status: 'ok', review: reviewEvt, state: stateEvt }));
}

main();
