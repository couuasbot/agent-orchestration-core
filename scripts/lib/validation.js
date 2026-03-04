const fs = require('fs');
const path = require('path');

const { getWorkspaceRoot } = require('./workspace');

function loadSchema(relPath) {
  const root = getWorkspaceRoot();
  const p = path.join(root, 'skills', 'agent-orchestration-system', relPath);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

const EVENT_SCHEMA = loadSchema('schemas/event.schema.json');
const RESULT_SCHEMA = loadSchema('schemas/result.schema.json');

function err(path, message) {
  return { path, message };
}

function isObject(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}

function validateEventInput({ type, agent, payload }) {
  const errors = [];
  if (!type || typeof type !== 'string') errors.push(err('type', 'must be a non-empty string'));
  if (!agent || typeof agent !== 'string') errors.push(err('agent', 'must be a non-empty string'));
  if (!isObject(payload)) errors.push(err('payload', 'must be a JSON object'));

  if (isObject(payload)) {
    if ('dedupeKey' in payload && typeof payload.dedupeKey !== 'string') errors.push(err('payload.dedupeKey', 'must be a string'));
    if ('taskId' in payload && typeof payload.taskId !== 'string') errors.push(err('payload.taskId', 'must be a string'));
    if ('runId' in payload && typeof payload.runId !== 'string') errors.push(err('payload.runId', 'must be a string'));

    const upperType = String(type || '').toUpperCase();

    // Light type-specific guards for core AOS flow
    if (upperType === 'TASK_STATE') {
      if (!payload.taskId || typeof payload.taskId !== 'string') errors.push(err('payload.taskId', 'is required for TASK_STATE'));
      if (!payload.state || typeof payload.state !== 'string') errors.push(err('payload.state', 'is required for TASK_STATE'));
    }

    if (upperType === 'DISPATCH') {
      if (!payload.taskId || typeof payload.taskId !== 'string') errors.push(err('payload.taskId', 'is required for DISPATCH'));
      if (!payload.runId || typeof payload.runId !== 'string') errors.push(err('payload.runId', 'is required for DISPATCH'));
      if ('artifactsBaseDir' in payload && typeof payload.artifactsBaseDir !== 'string') errors.push(err('payload.artifactsBaseDir', 'must be a string'));
    }

    if (upperType === 'AGENT_RESULT') {
      if (!payload.taskId || typeof payload.taskId !== 'string') errors.push(err('payload.taskId', 'is required for AGENT_RESULT'));
      if (!payload.runId || typeof payload.runId !== 'string') errors.push(err('payload.runId', 'is required for AGENT_RESULT'));
      if (!payload.resultPath || typeof payload.resultPath !== 'string') errors.push(err('payload.resultPath', 'is required for AGENT_RESULT'));
    }

    if (upperType === 'TASK_COMPLETE') {
      if (!payload.taskId || typeof payload.taskId !== 'string') errors.push(err('payload.taskId', 'is required for TASK_COMPLETE'));
      if (!payload.status || typeof payload.status !== 'string') errors.push(err('payload.status', 'is required for TASK_COMPLETE'));
    }
  }

  return { ok: errors.length === 0, errors, schema: EVENT_SCHEMA ? EVENT_SCHEMA.$id : null };
}

function validateResultObject(obj) {
  const errors = [];
  if (!isObject(obj)) return { ok: false, errors: [err('', 'result.json must be a JSON object')], schema: RESULT_SCHEMA ? RESULT_SCHEMA.$id : null };

  if (!obj.taskId || typeof obj.taskId !== 'string') errors.push(err('taskId', 'is required and must be a string'));
  if (!obj.runId || typeof obj.runId !== 'string') errors.push(err('runId', 'is required and must be a string'));
  if (!obj.status || typeof obj.status !== 'string') errors.push(err('status', 'is required and must be a string'));

  const st = String(obj.status || '').toLowerCase();
  if (obj.status && st !== 'success' && st !== 'failure') errors.push(err('status', 'must be "success" or "failure"'));

  if ('summary' in obj && typeof obj.summary !== 'string') errors.push(err('summary', 'must be a string'));
  if ('outputs' in obj && !Array.isArray(obj.outputs)) errors.push(err('outputs', 'must be an array of strings'));
  if (Array.isArray(obj.outputs)) {
    for (let i = 0; i < obj.outputs.length; i++) {
      if (typeof obj.outputs[i] !== 'string') errors.push(err(`outputs[${i}]`, 'must be a string'));
    }
  }

  if ('error' in obj && !isObject(obj.error) && obj.error !== null) errors.push(err('error', 'must be an object or null'));
  if (isObject(obj.error)) {
    if ('message' in obj.error && typeof obj.error.message !== 'string') errors.push(err('error.message', 'must be a string'));
    if ('stack' in obj.error && typeof obj.error.stack !== 'string') errors.push(err('error.stack', 'must be a string'));
  }

  return { ok: errors.length === 0, errors, schema: RESULT_SCHEMA ? RESULT_SCHEMA.$id : null };
}

module.exports = { validateEventInput, validateResultObject };
