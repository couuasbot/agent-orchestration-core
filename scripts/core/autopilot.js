const fs = require('fs');
const path = require('path');

const { getWorkspaceRoot } = require('../lib/workspace');
const { taskKeyFromId, safeJsonParse } = require('../lib/util');
const { getTasksState } = require('../lib/state');
const { validateResultObject } = require('../lib/validation');
const { acquireAutopilotLock, releaseAutopilotLock } = require('../lib/autopilot_lock');
const { execSync, spawnSync } = require('child_process');

const WORKSPACE_ROOT = getWorkspaceRoot();

function recallPatterns(query, taskId, runId) {
  // SECURITY: avoid shell interpolation; use spawnSync with argv.
  // QUALITY: collect both [PATTERN] + [LESSON] lines.
  try {
    const reflectPath = path.join(WORKSPACE_ROOT, 'skills/aos/scripts/core/reflect.js');
    const p = spawnSync('node', [
      reflectPath,
      '--action=recall',
      `--query=${String(query || '')}`,
      `--taskId=${String(taskId || '')}`,
      `--runId=${String(runId || '')}`
    ], { encoding: 'utf8' });

    const out = `${p.stdout || ''}\n${p.stderr || ''}`;
    const patterns = [];
    const lessons = [];

    for (const line of out.split('\n')) {
      const t = line.trim();
      if (t.startsWith('[PATTERN]')) patterns.push(t.replace(/^\[PATTERN\]\s*/, ''));
      if (t.startsWith('[LESSON]')) lessons.push(t.replace(/^\[LESSON\]\s*/, ''));
      if (patterns.length + lessons.length >= 6) break; // cap total injected bullets
    }

    return { patterns: patterns.slice(0, 3), lessons: lessons.slice(0, 3) };
  } catch (e) {
    console.error(`Recall failed for ${taskId}: ${e.message}`);
    return { patterns: [], lessons: [] };
  }
}

function arg(name, def) {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function laneOf(t) {
  const l = String(t.lane || '').toLowerCase();
  if (l === 'ops' || l === 'operations') return 'ops';
  return 'execution';
}

function artifactsBaseDirFor(taskId, baseDirFromTask) {
  const key = taskKeyFromId(taskId);
  return baseDirFromTask || path.join(WORKSPACE_ROOT, 'artifacts', 'aos-tasks', key);
}

function runDirFor(baseDir, runId) {
  // Scheme B: isolate per-run artifacts under <base>/<runId>/
  return runId ? path.join(baseDir, runId) : baseDir;
}

function readResultJson({ taskId, artifactsBaseDir, runId }) {
  const baseDir = artifactsBaseDirFor(taskId, artifactsBaseDir);
  const dir = runDirFor(baseDir, runId);
  const resultPath = path.join(dir, 'result.json');

  if (!fs.existsSync(resultPath)) return { exists: false, baseDir, dir, resultPath };

  const txt = fs.readFileSync(resultPath, 'utf8');
  const obj = safeJsonParse(txt);
  return { exists: true, baseDir, dir, resultPath, obj };
}

function minutesBetween(isoA, isoB) {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 60000);
}

function reviewRequestAction({ t, rr, runId, proposedStatus, reason }) {
  return {
    action: 'review_request',
    lane: laneOf(t),
    taskId: t.taskId,
    runId,
    reviewerHint: t.reviewerHint || null,
    resultPath: rr.resultPath,
    artifactsBaseDir: rr.baseDir,
    artifactsDir: rr.dir,
    proposedStatus: proposedStatus || null,
    notify: 'review',
    summary: rr.obj.summary || '',
    reason: reason || null
  };
}

function completeAction({ t, rr, runId }) {
  const status = String(rr.obj.status || '').toLowerCase();
  const reviewGate = t.reviewerHint && String(t.reviewerHint).trim();

  if (status === 'success') {
    // Scheme C (review-gated): success results go to Review if reviewerHint is set.
    if (reviewGate) {
      return reviewRequestAction({ t, rr, runId, proposedStatus: 'DONE', reason: null });
    }
    return {
      action: 'complete',
      lane: laneOf(t),
      taskId: t.taskId,
      runId,
      resultPath: rr.resultPath,
      artifactsBaseDir: rr.baseDir,
      artifactsDir: rr.dir,
      status: 'DONE',
      notify: 'success',
      summary: rr.obj.summary || ''
    };
  }

  // failure path
  const failureReason = rr.obj.error?.message || rr.obj.summary || 'runner reported failure';
  if (reviewGate) {
    // Scheme C: failures also require review; reviewer decides final status / re-dispatch.
    return reviewRequestAction({ t, rr, runId, proposedStatus: 'FAILED', reason: failureReason });
  }

  return {
    action: 'complete',
    lane: laneOf(t),
    taskId: t.taskId,
    runId,
    resultPath: rr.resultPath,
    artifactsBaseDir: rr.baseDir,
    artifactsDir: rr.dir,
    status: 'FAILED',
    notify: 'failure',
    reason: failureReason
  };
}

function buildRunnerMessage({ t, runId, runArtifactsDir, wisdom }) {
  // Keep this contract in sync with schemas/result.schema.json
  const resultSchemaHint = {
    taskId: t.taskId,
    runId,
    status: 'success|failure',
    summary: '...',
    outputs: ['...'],
    error: { message: '...', stack: '...' }
  };

  const wisdomBullets = [];
  if (wisdom && Array.isArray(wisdom.patterns)) {
    for (const p of wisdom.patterns) wisdomBullets.push(`- [PATTERN] ${p}`);
  }
  if (wisdom && Array.isArray(wisdom.lessons)) {
    for (const l of wisdom.lessons) wisdomBullets.push(`- [LESSON] ${l}`);
  }

  const wisdomSection = wisdomBullets.length > 0
    ? [
        '',
        '### 🧠 Collective Wisdom (AOS Memory)',
        'These are critical lessons/patterns learned from previous tasks. Treat them as constraints unless you have a strong reason:',
        ...wisdomBullets.slice(0, 6),
        ''
      ].join('\n')
    : '';

  return [
    `You are running task ${t.taskId}.`,
    wisdomSection,
    '',
    '### 🔒 SANDBOX MODE ACTIVE',
    'You are a READ-ONLY generator. You DO NOT have permission to edit the codebase directly.',
    'Your job is to generate the solution files in your current working directory (artifacts).',
    '',
    'RULES:',
    '1. READ any file you need from the workspace.',
    '2. WRITE your solution files ONLY under the run artifacts directory shown below.',
    '   - You may use absolute paths, but they MUST resolve under the runArtifactsDir.',
    '3. DO NOT use `edit` or `write` on paths outside the runArtifactsDir (especially not under repos/).',
    '4. The Reviewer will verify your work. If approved, the system (God) will merge it.',
    '',
    `Lane: ${laneOf(t)}`,
    `Title: ${t.title}`,
    t.details ? `Details: ${t.details}` : '',
    `runId: ${runId}`,
    '',
    'Output contract (MUST):',
    `1) Write JSON to: ${path.join(runArtifactsDir, 'result.json')}`,
    `2) Write human summary to: ${path.join(runArtifactsDir, 'summary.md')}`,
    '',
    'result.json schema (MUST include taskId + runId):',
    JSON.stringify(resultSchemaHint),
    'To APPLY changes to the codebase, add a "merge" array:',
    JSON.stringify({ merge: [{ source: "local.ts", target: "repos/app/src/real.ts" }] }),
    '',
    'Restrictions:',
    '- Do NOT edit workflow-events.jsonl or tasks/QUEUE.md',
    '- Write only under the artifacts directory above.',
    ''
  ].filter(Boolean).join('\n');
}

function main() {
  const lockTtlMs = Number(arg('lockTtlMs', String(10 * 60 * 1000)));

  // Concurrency: two lanes
  const execConcurrency = Number(arg('maxConcurrency', '3')); // Increased default for parallel collab
  const opsConcurrency = Number(arg('opsConcurrency', '2'));
  const defaultSlaMinutes = Number(arg('slaMinutes', '60'));
  const maxTotalSpawns = Number(arg('maxTotalSpawns', '5')); // Increased spawn burst limit

  const lockPath = path.join(WORKSPACE_ROOT, '.aos', 'autopilot.lock');

  let lockHandle = null;
  let meta = {
    schemaVersion: 1,
    at: new Date().toISOString(),
    lock: {
      path: lockPath,
      ttlMs: lockTtlMs,
      acquired: false,
      recoveredStale: false,
      previous: null
    }
  };

  try {
    try {
      lockHandle = acquireAutopilotLock(lockPath, { ttlMs: lockTtlMs });
      meta.lock.acquired = true;
      meta.lock.recoveredStale = !!lockHandle.recoveredStale;
      meta.lock.previous = lockHandle.previous || null;
    } catch (e) {
      if (e && e.code === 'LOCKED') {
        meta.lock.acquired = false;
        meta.lock.heldBy = e.existing || null;
        console.log(JSON.stringify({ meta, actions: [{ action: 'noop', reason: 'autopilot_locked' }] }));
        return;
      }
      throw e;
    }

    // Sense hard-precondition: always refresh the human-facing projection first.
    // Decision-making still uses the snapshot/event projection (NOT QUEUE.md).
    try {
      execSync(`node "${path.join(WORKSPACE_ROOT, 'skills/aos/scripts/core/queue_sync.js')}"`, { stdio: 'pipe' });
    } catch (_) {
      // Best-effort; do not block orchestration.
    }

    const tasks = getTasksState();

    const all = [...tasks.values()].map(t => {
      if (!t.lane) t.lane = laneOf(t);
      return t;
    });

    const inProgress = all.filter(t => t.state === 'In Progress');
    const inProgressExec = inProgress.filter(t => laneOf(t) === 'execution');
    const inProgressOps = inProgress.filter(t => laneOf(t) === 'ops');

    const actions = [];

    // Reliability: prioritize completion/mismatch/validation/stale before spawning.
    if (inProgress.length) {
      // oldest first
      inProgress.sort((a, b) => String(a.inProgressAt || '').localeCompare(String(b.inProgressAt || '')));

      // 1) Complete any task with a valid (runId-matching) result.json
      for (const t of inProgress) {
        const runId = t.lastDispatch?.runId || null;
        const artifactsBaseDir = artifactsBaseDirFor(t.taskId, t.artifactsDir);
        const rr = readResultJson({ taskId: t.taskId, artifactsBaseDir, runId });

        if (rr.exists) {
          if (!rr.obj) {
            actions.push({
              action: 'validation_error',
              kind: 'result_parse',
              lane: laneOf(t),
              taskId: t.taskId,
              runId,
              expectedRunId: runId,
              reportedRunId: null,
              resultPath: rr.resultPath,
              artifactsBaseDir: rr.baseDir,
              artifactsDir: rr.dir,
              schema: null,
              errors: [{ path: '', message: 'result.json is not valid JSON' }],
              reason: 'result.json parse failed'
            });
            return console.log(JSON.stringify({ meta, actions }));
          }

          // Validate result.json schema first (before runId checks) so we can surface malformed output.
          const vr = validateResultObject(rr.obj);
          if (!vr.ok) {
            actions.push({
              action: 'validation_error',
              kind: 'result',
              lane: laneOf(t),
              taskId: t.taskId,
              runId,
              expectedRunId: runId,
              reportedRunId: rr.obj && rr.obj.runId ? rr.obj.runId : null,
              resultPath: rr.resultPath,
              artifactsBaseDir: rr.baseDir,
              artifactsDir: rr.dir,
              schema: vr.schema || null,
              errors: vr.errors,
              reason: 'result.json failed schema validation'
            });
            return console.log(JSON.stringify({ meta, actions }));
          }

          // Scheme A (strong binding): require result.json.runId == current runId
          const reportedRunId = rr.obj.runId || null;
          if (runId && reportedRunId !== runId) {
            actions.push({
              action: 'mismatch_flag',
              lane: laneOf(t),
              taskId: t.taskId,
              runId,
              expectedRunId: runId,
              reportedRunId,
              resultPath: rr.resultPath,
              artifactsBaseDir: rr.baseDir,
              artifactsDir: rr.dir,
              reason: 'result.json runId does not match current DISPATCH.runId'
            });
            return console.log(JSON.stringify({ meta, actions }));
          }

          actions.push(completeAction({ t, rr, runId }));
          // Keep single-step completion per run (reduces cascade risk)
          return console.log(JSON.stringify({ meta, actions }));
        }
      }

      // 2) No results yet -> stale-fail the first task that exceeds SLA
      for (const t of inProgress) {
        const sla = Number(t.slaMinutes || defaultSlaMinutes || 60);
        const ageMin = t.inProgressAt ? minutesBetween(t.inProgressAt, new Date().toISOString()) : 0;
        if (ageMin > sla) {
          const runId = t.lastDispatch?.runId || null;
          const artifactsBaseDir = artifactsBaseDirFor(t.taskId, t.artifactsDir);
          actions.push({
            action: 'stale_fail',
            lane: laneOf(t),
            taskId: t.taskId,
            runId,
            status: 'FAILED',
            notify: 'failure',
            reason: `SLA exceeded: ${ageMin}min > ${sla}min`,
            inProgressAt: t.inProgressAt,
            artifactsBaseDir
          });
          return console.log(JSON.stringify({ meta, actions }));
        }
      }
    }

    // 3) Spawn ready tasks if per-lane capacity permits (two-lane concurrency)
    const ready = all.filter(t => t.state === 'Ready');
    if (!ready.length) {
      actions.push({ action: 'noop', reason: 'no_ready' });
      return console.log(JSON.stringify({ meta, actions }));
    }

    // Stable order (createdAt asc)
    ready.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    const readyExec = ready.filter(t => laneOf(t) === 'execution');
    const readyOps = ready.filter(t => laneOf(t) === 'ops');

    const execSlots = Math.max(0, execConcurrency - inProgressExec.length);
    const opsSlots = Math.max(0, opsConcurrency - inProgressOps.length);

    let remainingSpawns = Math.max(0, maxTotalSpawns);

    function spawnOne(t) {
      const artifactsBaseDir = artifactsBaseDirFor(t.taskId, t.artifactsDir);
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const runArtifactsDir = runDirFor(artifactsBaseDir, runId);
      
      // AOS D: On-Demand Wisdom Injection
      // 1. Recall only for attempts > 1 (failure context) OR high priority OR flagged complex
      const isRetry = (t.attempts || 0) > 0;
      const isPriority = (t.priority === 'P0' || t.title.toLowerCase().includes('!'));
      const shouldRecall = isRetry || isPriority;
      
      let wisdom = { patterns: [], lessons: [] };
      if (shouldRecall) {
        wisdom = recallPatterns(t.title, t.taskId, runId);
      }

      const runnerMessage = buildRunnerMessage({ t, runId, runArtifactsDir, wisdom });
      const dedupeBase = `dispatch::${t.taskId}::${runId}`;

      actions.push({
        action: 'spawn',
        lane: laneOf(t),
        taskId: t.taskId,
        title: t.title || t.taskId,
        role: t.roleHint || 'cto',
        runId,
        dedupeBase,
        artifactsBaseDir,
        artifactsDir: runArtifactsDir,
        slaMinutes: Number(t.slaMinutes || defaultSlaMinutes || 60),
        runnerMessage
      });
      // remainingSpawns is not used in loop condition above anymore
    }

    // Spawn up to available slots in execution lane
    for (const t of readyExec) {
      if (actions.filter(a => a.lane === 'execution').length < execSlots && actions.length < maxTotalSpawns) {
        spawnOne(t);
      } else {
        break;
      }
    }

    // Spawn up to available slots in ops lane
    for (const t of readyOps) {
      if (actions.filter(a => a.lane === 'ops').length < opsSlots && actions.length < maxTotalSpawns) {
        spawnOne(t);
      } else {
        break;
      }
    }

    if (!actions.length) actions.push({ action: 'noop', reason: 'capacity_full' });
    console.log(JSON.stringify({ meta, actions }));
  } finally {
    releaseAutopilotLock(lockHandle);
  }
}

main();
