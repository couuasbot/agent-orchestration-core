const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE_ROOT = process.cwd(); // Dynamic root
const QUEUE_FILE = path.join(WORKSPACE_ROOT, 'tasks', 'QUEUE.md');
// Assume script is located relative to CWD when run via node
// Adjust this path based on where you place the skill folder
const SYNC_SCRIPT = path.join(WORKSPACE_ROOT, 'skills', 'agent-orchestration-core', 'scripts', 'queue_sync.js');

function run() {
  try {
    console.log(`[AOS Check] Starting at ${new Date().toISOString()}`);

    // 1. Sync Queue
    if (fs.existsSync(SYNC_SCRIPT)) {
      console.log(`[AOS Check] Syncing queue via ${SYNC_SCRIPT}...`);
      try {
        const output = execSync(`node "${SYNC_SCRIPT}"`, { encoding: 'utf8' });
        console.log(`[AOS Check] Sync Output: ${output.trim()}`);
      } catch (e) {
        console.error(`[AOS Check] Sync Failed: ${e.message}`);
        // Don't exit, try to read anyway
      }
    } else {
      console.error(`[AOS Check] Sync script not found at ${SYNC_SCRIPT}`);
    }

    // 2. Check for Ready Tasks
    if (fs.existsSync(QUEUE_FILE)) {
      const content = fs.readFileSync(QUEUE_FILE, 'utf8');
      // Look for lines that have "[ ]" AND "#ready" (case insensitive)
      const lines = content.split('\n');
      const readyTasks = lines.filter(line => {
        const lower = line.toLowerCase();
        return lower.includes('[ ]') && lower.includes('#ready');
      });
      
      if (readyTasks.length > 0) {
        console.log(`[AOS Check] FOUND ${readyTasks.length} READY TASKS.`);
        console.log('AOS_WAKE_UP_NEEDED'); // Key signal for Cron
      } else {
        console.log('[AOS Check] No ready tasks found. Sleeping.');
      }
    } else {
      console.error(`[AOS Check] QUEUE file not found at ${QUEUE_FILE}`);
    }
  } catch (e) {
    console.error('[AOS Check] Fatal Error:', e);
    process.exit(1);
  }
}

run();
