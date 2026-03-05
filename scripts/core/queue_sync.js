const fs = require('fs');
const path = require('path');

const { getWorkspaceRoot } = require('../lib/workspace');
const { atomicWriteFile } = require('../lib/util');
const { getTasksState } = require('../lib/state');

const WORKSPACE_ROOT = getWorkspaceRoot();
const QUEUE_FILE = path.join(WORKSPACE_ROOT, 'tasks', 'QUEUE.md');

function render(tasks) {
  const groups = {
    'Ready': [],
    'In Progress': [],
    'Review': [],
    'Inbox': [],
    'Done': [],
    'Failed': []
  };

  for (const t of tasks.values()) {
    const s = groups[t.state] ? t.state : 'Inbox';
    groups[s].push(t);
  }

  // stable order (createdAt asc)
  for (const k of Object.keys(groups)) {
    groups[k].sort((a,b) => String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  }

  const lines = [];
  lines.push('# TASKS');

  function section(name, items) {
    lines.push(`\n## ${name}`);
    if (!items.length) {
      lines.push('- [ ] (No tasks)');
      return;
    }
    for (const t of items) {
      const checked = (name === 'Done') ? 'x' : ' ';
      const tags = [];
      if (name === 'Ready') tags.push('#ready');
      if (name === 'In Progress') tags.push('#in-progress');
      if (name === 'Failed') tags.push('#failed');
      if (name === 'Review') tags.push('#review');
      const roleTag = t.roleHint ? `@${t.roleHint}` : '';
      const reviewerTag = t.reviewerHint ? `@rev:${t.reviewerHint}` : '';
      const lane = String(t.lane || '').toLowerCase();
      const laneTag = lane === 'ops' || lane === 'operations' ? '#ops' : '#exec';
      lines.push(`- [${checked}] ${t.title || t.taskId} ${t.taskId} ${roleTag} ${reviewerTag} ${laneTag} ${tags.join(' ')}`.replace(/\s+/g,' ').trim());
    }
  }

  section('Ready', groups['Ready']);
  section('In Progress', groups['In Progress']);
  section('Review', groups['Review']);
  section('Inbox', groups['Inbox']);
  section('Failed', groups['Failed']);
  section('Done', groups['Done']);

  lines.push('');
  return lines.join('\n');
}

function syncQueue() {
  const tasks = getTasksState();

  const out = render(tasks);
  fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
  atomicWriteFile(QUEUE_FILE, out);
  console.log('QUEUE_PROJECTED');
}

syncQueue();
