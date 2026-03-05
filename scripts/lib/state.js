const fs = require('fs');
const path = require('path');

const { getWorkspaceRoot } = require('./workspace');
const { getEventLogPath } = require('./event_log');
const { safeJsonParse, atomicWriteFile } = require('./util');

const WORKSPACE_ROOT = getWorkspaceRoot();
const AOS_DIR = path.join(WORKSPACE_ROOT, '.aos');
const SNAPSHOT_PATH = path.join(AOS_DIR, 'workflow-snapshot.json');

function loadEvents() {
  // Full load (legacy)
  const p = getEventLogPath();
  if (!fs.existsSync(p)) return [];
  const content = fs.readFileSync(p, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  const events = [];
  for (const line of lines) {
    const e = safeJsonParse(line);
    if (!e) continue;

    // Normalize legacy lines (may miss id/timestamp/schemaVersion)
    if (!e.id) e.id = `legacy_${events.length}`;
    if (!e.timestamp) e.timestamp = new Date(0).toISOString();
    if (!e.schemaVersion) e.schemaVersion = 0;
    if (e.type) e.type = String(e.type).toUpperCase();

    events.push(e);
  }
  return events;
}

function defaultTask(taskId) {
  return {
    taskId,
    title: taskId,
    details: '',
    roleHint: 'cto',
    priority: 'P1',
    lane: 'execution',
    slaMinutes: 60,
    state: 'Inbox',
    createdAt: null,
    updatedAt: null,
    inProgressAt: null,
    lastDispatch: null,
    attempts: 0,
    artifactsDir: null, // base artifacts dir (NOT per-run)
    resultPath: null,
    lastError: null,

    // Review / audit
    reviewerHint: null, // optional: who should review before DONE is accepted
    lastReview: null,   // { at, reviewer, decision, runId, notes }
    reviewCount: 0
  };
}

function touch(t, ts) {
  t.updatedAt = ts;
  if (!t.createdAt) t.createdAt = ts;
}

function applyEvent(tasks, e) {
  const ts = e.timestamp;
  const type = e.type;
  const p = e.payload || {};

  if (type === 'TASK_CREATE') {
    const id = p.taskId;
    if (!id) return;
    const t = tasks.get(id) || defaultTask(id);
    t.title = p.title || t.title;
    t.details = p.details || t.details;
    t.roleHint = p.roleHint || t.roleHint;
    t.priority = p.priority || t.priority;
    t.lane = p.lane || t.lane || 'execution';
    if (p.reviewerHint) t.reviewerHint = p.reviewerHint;
    t.slaMinutes = Number(p.slaMinutes || t.slaMinutes || 60);
    t.artifactsDir = p.artifactsDir || t.artifactsDir;
    t.state = 'Inbox';
    touch(t, ts);
    tasks.set(id, t);
    return;
  }

  if (type === 'TASK_STATE') {
    const id = p.taskId;
    if (!id) return;
    const t = tasks.get(id) || defaultTask(id);
    if (p.title && !t.title) t.title = p.title;
    t.state = p.state || t.state;
    if (p.lane) t.lane = p.lane;
    if (p.reviewerHint) t.reviewerHint = p.reviewerHint;
    if (t.state === 'In Progress' && !t.inProgressAt) t.inProgressAt = ts;
    // If moved out of In Progress explicitly, clear the timer anchor.
    if (t.state !== 'In Progress') t.inProgressAt = null;
    touch(t, ts);
    tasks.set(id, t);
    return;
  }

  if (type === 'DISPATCH') {
    const id = p.taskId;
    if (!id) return;
    const t = tasks.get(id) || defaultTask(id);
    t.title = p.intent || t.title;
    t.roleHint = p.role || t.roleHint;

    // Prefer base artifacts dir if provided
    if (p.artifactsBaseDir) t.artifactsDir = p.artifactsBaseDir;

    t.state = t.state === 'Ready' ? 'In Progress' : (t.state || 'In Progress');
    // Reliability: treat each DISPATCH as a new attempt boundary; refresh inProgressAt.
    t.inProgressAt = ts;
    t.attempts += 1;
    t.lastDispatch = {
      at: ts,
      role: p.role || null,
      runId: p.runId || null,
      artifactsBaseDir: p.artifactsBaseDir || t.artifactsDir || null
    };
    touch(t, ts);
    tasks.set(id, t);
    return;
  }

  if (type === 'AGENT_RESULT') {
    const id = p.taskId;
    if (!id) return;
    const t = tasks.get(id) || defaultTask(id);
    t.resultPath = p.resultPath || t.resultPath;
    if (p.artifactsBaseDir) t.artifactsDir = p.artifactsBaseDir;
    t.lastError = p.error || null;
    touch(t, ts);
    tasks.set(id, t);
    return;
  }

  if (type === 'TASK_COMPLETE') {
    const id = p.taskId;
    if (!id) return;
    const t = tasks.get(id) || defaultTask(id);
    const status = String(p.status || '').toUpperCase();
    if (status === 'DONE') t.state = 'Done';
    else if (status === 'FAILED') t.state = 'Failed';
    else t.state = 'Done';
    t.inProgressAt = null;
    t.resultPath = p.resultPath || t.resultPath;
    if (p.artifactsBaseDir) t.artifactsDir = p.artifactsBaseDir;
    touch(t, ts);
    tasks.set(id, t);
    return;
  }

  if (type === 'TASK_REVIEW') {
    const id = p.taskId;
    if (!id) return;
    const t = tasks.get(id) || defaultTask(id);
    t.lastReview = {
      at: ts,
      reviewer: p.reviewer || null,
      decision: p.decision || null,
      runId: p.runId || null,
      notes: p.notes || null
    };
    t.reviewCount = Number(t.reviewCount || 0) + 1;
    touch(t, ts);
    tasks.set(id, t);
    return;
  }

  // Ignore other types (INFO/NOTIFY_SENT/etc) for task projection
}

function reduceTasks(events) {
  const tasks = new Map();
  for (const e of events) applyEvent(tasks, e);
  return tasks;
}

function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return null;
  try {
    const obj = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    if (!obj || typeof obj !== 'object') return null;
    if (!Number.isFinite(obj.offset)) return null;
    if (!obj.tasks || typeof obj.tasks !== 'object') obj.tasks = {};
    return obj;
  } catch (_) {
    return null;
  }
}

function saveSnapshot({ offset, tasks }) {
  fs.mkdirSync(AOS_DIR, { recursive: true });
  const out = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    logPath: getEventLogPath(),
    offset,
    tasks
  };
  atomicWriteFile(SNAPSHOT_PATH, JSON.stringify(out, null, 2) + '\n');
}

function normalizeEvent(e, idx) {
  if (!e) return null;
  if (!e.id) e.id = `legacy_${idx}`;
  if (!e.timestamp) e.timestamp = new Date(0).toISOString();
  if (!e.schemaVersion) e.schemaVersion = 0;
  if (e.type) e.type = String(e.type).toUpperCase();
  return e;
}

function readNewEventsSinceOffset(filePath, startOffset) {
  if (!fs.existsSync(filePath)) return { events: [], newOffset: 0 };

  const st = fs.statSync(filePath);
  const size = st.size;
  if (!Number.isFinite(startOffset) || startOffset < 0) startOffset = 0;

  if (startOffset > size) {
    // Log truncated/rotated; force full rebuild
    startOffset = 0;
  }

  if (startOffset === size) return { events: [], newOffset: startOffset };

  const fd = fs.openSync(filePath, 'r');
  try {
    const len = size - startOffset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, startOffset);

    // Process only up to the last newline to avoid partial line reads.
    const lastNL = buf.lastIndexOf(0x0A); // '\n'
    if (lastNL === -1) {
      // No complete lines
      return { events: [], newOffset: startOffset };
    }

    const completeBuf = buf.subarray(0, lastNL); // exclude last '\n'
    const text = completeBuf.toString('utf8');
    const lines = text.split('\n').filter(Boolean);

    const events = [];
    for (let i = 0; i < lines.length; i++) {
      const e = safeJsonParse(lines[i]);
      if (!e) continue;
      events.push(normalizeEvent(e, i));
    }

    const newOffset = startOffset + lastNL + 1; // include '\n'
    return { events, newOffset };
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
  }
}

/**
 * Load projected tasks using snapshot + incremental log scan.
 * - Uses byte offset to avoid O(N) full log parse.
 * - Handles partial last line safely.
 */
function getTasksState({ useSnapshot = true, updateSnapshot = true } = {}) {
  const logPath = getEventLogPath();

  let snapshot = null;
  let tasksMap = new Map();
  let offset = 0;

  if (useSnapshot) {
    snapshot = loadSnapshot();
    if (snapshot && snapshot.tasks) {
      try {
        for (const [taskId, t] of Object.entries(snapshot.tasks)) {
          tasksMap.set(taskId, t);
        }
        offset = snapshot.offset || 0;
      } catch (_) {
        tasksMap = new Map();
        offset = 0;
      }
    }
  }

  let { events: newEvents, newOffset } = readNewEventsSinceOffset(logPath, offset);

  // If we started from 0 (no snapshot), but newOffset didn't advance and file exists,
  // fall back to full parse for correctness.
  if (!snapshot && offset === 0 && newOffset === 0 && fs.existsSync(logPath)) {
    const events = loadEvents();
    tasksMap = reduceTasks(events);
    // Best-effort: set offset to end-of-file
    try { newOffset = fs.statSync(logPath).size; } catch (_) {}
  } else {
    for (const e of newEvents) applyEvent(tasksMap, e);
  }

  if (updateSnapshot) {
    const tasksObj = Object.fromEntries(tasksMap.entries());
    saveSnapshot({ offset: newOffset, tasks: tasksObj });
  }

  return tasksMap;
}

module.exports = { loadEvents, reduceTasks, getTasksState };
