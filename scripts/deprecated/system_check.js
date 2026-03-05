const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { getWorkspaceRoot } = require('./lib/workspace');

const WORKSPACE_ROOT = getWorkspaceRoot();
const QUEUE_FILE = path.join(WORKSPACE_ROOT, 'tasks', 'QUEUE.md');
const SYNC_SCRIPT = path.join(WORKSPACE_ROOT, 'skills', 'aos', 'scripts', 'queue_sync.js');

function run() {
  console.log(`[AOS Check] ${new Date().toISOString()}`);

  // 1) Project queue
  try {
    execSync(`node "${SYNC_SCRIPT}"`, { stdio: 'pipe' });
  } catch (e) {
    console.error(`[AOS Check] queue_sync failed: ${e.message}`);
  }

  // 2) Source of truth: snapshot projection (NOT QUEUE.md)
  const tasks = require('./lib/state').getTasksState();
  const ready = [...tasks.values()].filter(t => t.state === 'Ready');

  if (ready.length) {
    console.log('AOS_WAKE_UP_NEEDED');
  } else {
    console.log('[AOS Check] No ready tasks.');
  }
}

run();
