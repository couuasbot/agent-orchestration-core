#!/usr/bin/env node

// Learn effector: translate failures/rejections/merge failures into durable lessons.
// Writes to memory/aos/corrections.md via reflect.js --action=learn.
//
// Idempotency:
// - checkpoint file via effector_checkpoint offset
// - additionally keep a small local applied set in .aos/effectors/learn_apply.state.json

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { getWorkspaceRoot } = require('../lib/workspace');
const { atomicWriteFile, safeJsonParse } = require('../lib/util');

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function loadState(p) {
  if (!fs.existsSync(p)) return { schemaVersion: 1, applied: {} };
  try {
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!obj || typeof obj !== 'object') throw new Error('bad');
    if (!obj.applied || typeof obj.applied !== 'object') obj.applied = {};
    if (!obj.schemaVersion) obj.schemaVersion = 1;
    return obj;
  } catch (_) {
    return { schemaVersion: 1, applied: {} };
  }
}

function saveState(p, st) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  atomicWriteFile(p, JSON.stringify(st, null, 2) + '\n');
}

function runLearn({ lesson, taskId, runId }) {
  const root = getWorkspaceRoot();
  const reflect = path.join(root, 'skills', 'aos', 'scripts', 'reflect.js');
  const args = ['node', reflect, '--action=learn', `--lesson=${lesson}`];
  if (taskId) args.push(`--taskId=${taskId}`);
  if (runId) args.push(`--runId=${runId}`);

  const p = spawnSync(args[0], args.slice(1), { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  return { code: p.status, stdout: p.stdout || '', stderr: p.stderr || '' };
}

function normalizeLesson(e) {
  const type = String(e.type || '').toUpperCase();
  const p = e.payload || {};

  if (type === 'TASK_COMPLETE' && String(p.status || '').toUpperCase() === 'FAILED') {
    const msg = p.reason || p.output || 'task failed';
    return { lesson: `Task ${p.taskId} failed: ${String(msg).slice(0, 300)}`, taskId: p.taskId, runId: p.runId };
  }

  if (type === 'TASK_REVIEW' && String(p.decision || '').toLowerCase() === 'rejected') {
    const msg = p.notes || 'review rejected';
    return { lesson: `Task ${p.taskId} review rejected: ${String(msg).slice(0, 300)}`, taskId: p.taskId, runId: p.runId };
  }

  if (type === 'VALIDATION_ERROR') {
    const kind = p.kind || 'validation';
    const msg = Array.isArray(p.errors) ? p.errors.map(x => x.message).filter(Boolean).slice(0, 3).join('; ') : 'validation error';
    const tid = p.taskId || p.intendedTaskId || '';
    const rid = p.runId || '';
    return { lesson: `Validation error (${kind}) for ${tid || p.intendedType || 'event'}: ${String(msg).slice(0, 300)}`, taskId: tid || undefined, runId: rid || undefined };
  }

  if (type === 'AOS_MERGE_FAILED') {
    const msg = p.message || p.error || 'merge failed';
    return { lesson: `Merge failed for ${p.taskId || ''} ${p.runId || ''}: ${String(msg).slice(0, 300)}`, taskId: p.taskId, runId: p.runId };
  }

  return null;
}

function main() {
  const max = Number(arg('max', '5'));

  const root = getWorkspaceRoot();
  const logPath = path.join(root, 'workflow-events.jsonl');

  const statePath = path.join(root, '.aos', 'effectors', 'learn_apply.state.json');
  const st = loadState(statePath);

  const { loadCheckpoint, saveCheckpoint, iterateJsonlFromOffset } = require('../lib/effector_checkpoint');
  const ck = loadCheckpoint('learn_apply');

  const learned = [];
  const skipped = [];
  const errors = [];

  const { newOffset } = iterateJsonlFromOffset(logPath, ck.offset, {
    maxLines: 200000,
    onEvent: ({ event }) => {
      if (learned.length >= max) return { stop: true };

      const l = normalizeLesson(event);
      if (!l) return;

      const key = `learn::${String(event.id || '') || (event.timestamp + '::' + event.type)}::${l.taskId || ''}::${l.runId || ''}`;
      if (st.applied[key]) {
        skipped.push({ key, reason: 'already_applied' });
        return;
      }

      // Avoid learning from our own learn events (extra safety)
      if (String(event.type || '').toUpperCase() === 'AOS_LEARN') return;

      const res = runLearn(l);
      if (res.code !== 0) {
        errors.push({ key, taskId: l.taskId, runId: l.runId, error: 'reflect learn failed', stderr: res.stderr.slice(0, 500) });
        return;
      }

      st.applied[key] = { at: new Date().toISOString(), taskId: l.taskId || null, runId: l.runId || null };
      learned.push({ key, ...l });
    }
  });

  saveCheckpoint('learn_apply', newOffset);
  saveState(statePath, st);

  console.log(JSON.stringify({ status: 'ok', learnedCount: learned.length, learned, skippedCount: skipped.length, errorCount: errors.length, errors }, null, 2));
}

main();
