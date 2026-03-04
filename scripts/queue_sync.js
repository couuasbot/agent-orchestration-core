const fs = require('fs');
const path = require('path');

// Configuration - relative to workspace root
const WORKSPACE_ROOT = process.cwd();
const QUEUE_FILE = path.join(WORKSPACE_ROOT, 'tasks', 'QUEUE.md');
const EVENTS_FILE = path.join(WORKSPACE_ROOT, 'workflow-events.jsonl');

/**
 * 1. Read workflow-events.jsonl to find completed tasks.
 * 2. Read tasks/QUEUE.md.
 * 3. Update checkboxes ([ ] -> [x]) for completed tasks.
 */

function syncQueue() {
  if (!fs.existsSync(EVENTS_FILE)) {
    console.log('No events file found. Skipping sync.');
    return;
  }
  if (!fs.existsSync(QUEUE_FILE)) {
    console.log('No QUEUE.md found. Skipping sync.');
    return;
  }

  // 1. Parse Events
  const eventsContent = fs.readFileSync(EVENTS_FILE, 'utf8');
  const events = eventsContent.trim().split('\n').map(line => {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(e => e !== null);

  const completedTaskIds = new Set();
  
  events.forEach(e => {
    if (e.type === 'TASK_COMPLETE' && e.payload && e.payload.taskId) {
      completedTaskIds.add(e.payload.taskId);
    }
  });

  // 2. Parse & Update QUEUE.md
  let queueContent = fs.readFileSync(QUEUE_FILE, 'utf8');
  const lines = queueContent.split('\n');
  let updatedCount = 0;

  const newLines = lines.map(line => {
    // Regex to match: "- [ ] Task description #task-id"
    // Capture groups: 1=Indent, 2=Checkbox content (space), 3=Description, 4=Tags
    const taskRegex = /^(\s*- \[)( )(\].*?)(#[\w-]+)(.*)$/;
    const match = line.match(taskRegex);

    if (match) {
      const taskId = match[4]; // e.g., #task-123
      if (completedTaskIds.has(taskId)) {
        // Task is completed in events but open in file
        updatedCount++;
        // Replace "[ ]" with "[x]"
        return `${match[1]}x${match[3]}${taskId}${match[5]}`; // Construct the line with [x]
      }
    }
    return line;
  });

  if (updatedCount > 0) {
    fs.writeFileSync(QUEUE_FILE, newLines.join('\n'), 'utf8');
    console.log(`Successfully synced ${updatedCount} tasks in QUEUE.md.`);
  } else {
    console.log('No pending updates for QUEUE.md.');
  }
}

syncQueue();
