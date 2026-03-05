#!/usr/bin/env node

// Apply an AOS_PLAN produced by COO into concrete TASK_CREATE events.
//
// Policy:
// - Scan tasks projection for Done tasks whose result.json declares an AOS_PLAN.
// - For each planned task spec, create the task via task_create.js.
// - Idempotency: maintain a local checkpoint file under .aos/effectors/plan_apply.state.json
//   keyed by `${sourceTaskId}::${sourceRunId}`.
//
// This is an effector (side-effect) script; it may write new events.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { getWorkspaceRoot } = require('../lib/workspace');
const { getTasksState } = require('../lib/state');
const { atomicWriteFile, taskKeyFromId } = require('../lib/util');

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function loadState(statePath) {
  if (!fs.existsSync(statePath)) return { schemaVersion: 1, applied: {} };
  try {
    const obj = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!obj || typeof obj !== 'object') throw new Error('bad');
    if (!obj.applied || typeof obj.applied !== 'object') obj.applied = {};
    if (!obj.schemaVersion) obj.schemaVersion = 1;
    return obj;
  } catch (_) {
    return { schemaVersion: 1, applied: {} };
  }
}

function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  atomicWriteFile(statePath, JSON.stringify(state, null, 2) + '\n');
}

function safeJsonRead(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function normalizePlan(obj) {
  if (!obj || typeof obj !== 'object') return null;
  // Accept a few shapes to keep COO prompt flexible.
  // Shape A: { kind: 'AOS_PLAN', tasks: [...] }
  // Shape B: { type: 'AOS_PLAN', tasks: [...] }
  // Shape C: { plan: { tasks: [...] } }
  const kind = String(obj.kind || obj.type || '').toUpperCase();
  if (kind === 'AOS_PLAN' && Array.isArray(obj.tasks)) {
    return { tasks: obj.tasks };
  }
  if (obj.plan && Array.isArray(obj.plan.tasks)) {
    return { tasks: obj.plan.tasks };
  }
  return null;
}

function runTaskCreate({ taskId, title, details, roleHint, priority, lane, reviewerHint, slaMinutes, dedupeKey }) {
  const workspaceRoot = getWorkspaceRoot();
  const script = path.join(workspaceRoot, 'skills', 'aos', 'scripts', 'core', 'task_create.js');

  const args = [
    script,
    `--taskId=${taskId}`,
    `--title=${(title || taskId).replace(/\n/g, ' ')}`,
    `--details=${(details || '').replace(/\n/g, '\\n')}`,
    `--roleHint=${roleHint || 'cto'}`,
    `--priority=${priority || 'P1'}`,
    `--lane=${lane || 'execution'}`,
    `--slaMinutes=${Number.isFinite(Number(slaMinutes)) ? Number(slaMinutes) : 60}`,
  ];
  if (reviewerHint) args.push(`--reviewerHint=${reviewerHint}`);
  if (dedupeKey) args.push(`--dedupeKey=${dedupeKey}`);

  const p = spawnSync('node', args, { encoding: 'utf8' });
  if (p.status !== 0) {
    return { ok: false, stdout: p.stdout || '', stderr: p.stderr || '' };
  }
  try {
    return { ok: true, out: JSON.parse((p.stdout || '').trim() || '{}') };
  } catch (_) {
    return { ok: true, out: { raw: p.stdout || '' } };
  }
}

function main() {
  const maxSource = Number(arg('maxSource', '5'));
  const maxCreate = Number(arg('maxCreate', '10'));

  const workspaceRoot = getWorkspaceRoot();
  const statePath = path.join(workspaceRoot, '.aos', 'effectors', 'plan_apply.state.json');
  const st = loadState(statePath);

  const tasks = getTasksState();
  const candidates = [];
  for (const t of tasks.values()) {
    if (t.state !== 'Done') continue;
    if (!t.resultPath) continue;
    if (!fs.existsSync(t.resultPath)) continue;
    // We only auto-apply plans from COO by default.
    if (String(t.roleHint || '').toLowerCase() !== 'coo') continue;
    const runId = (t.lastDispatch && t.lastDispatch.runId) ? t.lastDispatch.runId : '';
    const key = `${t.taskId}::${runId || t.resultPath}`;
    if (st.applied[key]) continue;
    candidates.push({ task: t, runId, key });
  }

  // Most recent first
  candidates.sort((a, b) => String(b.task.updatedAt || '').localeCompare(String(a.task.updatedAt || '')));

  const applied = [];
  const created = [];
  const errors = [];

  for (const c of candidates.slice(0, maxSource)) {
    const obj = safeJsonRead(c.task.resultPath);
    const plan = normalizePlan(obj);
    if (!plan) continue;

    let createdCount = 0;
    for (let i = 0; i < plan.tasks.length && createdCount < maxCreate; i++) {
      const spec = plan.tasks[i] || {};
      const baseKey = taskKeyFromId(c.task.taskId);
      const genId = `#${baseKey}__${String(c.runId || 'plan').replace(/[^a-zA-Z0-9._-]+/g, '_')}__${i + 1}`;

      const taskId = (typeof spec.taskId === 'string' && spec.taskId.startsWith('#')) ? spec.taskId : genId;
      const dedupeKey = `plan_apply::${c.task.taskId}::${c.runId || 'n/a'}::${taskId}`;

      const res = runTaskCreate({
        taskId,
        title: spec.title || spec.intent || spec.name || taskId,
        details: spec.details || spec.description || '',
        roleHint: spec.roleHint || spec.role || 'cto',
        priority: spec.priority || 'P1',
        lane: spec.lane || 'execution',
        // Default to auto-reviewer so merges go through deterministic merge path via task_review.js
        // (autopilot routes success->Review when reviewerHint is set).
        reviewerHint: spec.reviewerHint || 'aos-auto',
        slaMinutes: spec.slaMinutes || spec.sla || 60,
        dedupeKey
      });

      if (!res.ok) {
        errors.push({ source: c.task.taskId, taskId, error: 'task_create failed', stdout: res.stdout, stderr: res.stderr });
        continue;
      }

      created.push({ source: c.task.taskId, fromRunId: c.runId || null, taskId });
      createdCount += 1;
    }

    st.applied[c.key] = { at: new Date().toISOString(), resultPath: c.task.resultPath };
    applied.push({ taskId: c.task.taskId, runId: c.runId || null, key: c.key, created: createdCount });
  }

  saveState(statePath, st);

  console.log(JSON.stringify({
    status: 'ok',
    scanned: candidates.length,
    applied,
    created,
    errors
  }, null, 2));
}

main();
