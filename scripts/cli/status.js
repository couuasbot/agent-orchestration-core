#!/usr/bin/env node
/**
 * Render /aos status for the active root contract.
 * Reads snapshot, extracts aos_contract + DoD checklist from task.details.
 * Prints a short human summary + JSON payload.
 */
const fs = require('fs');
const path = require('path');

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function asArray(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  return [x];
}

function main() {
  const ws = process.env.WORKSPACE_ROOT || '/home/ubuntu/.openclaw/workspace-god';
  const snapPath = path.join(ws, '.aos', 'workflow-snapshot.json');
  const taskIdArg = process.argv.slice(2).find(a => a.startsWith('--taskId='));
  const taskId = taskIdArg ? taskIdArg.split('=')[1] : null;

  if (!fs.existsSync(snapPath)) {
    console.log(JSON.stringify({ status: 'error', message: `snapshot not found at ${snapPath}` }));
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const tasks = snap.tasks || {};

  let root = null;
  if (taskId && tasks[taskId]) {
    root = tasks[taskId];
  } else {
    // find most recent contract root
    const roots = [];
    for (const [id, t] of Object.entries(tasks)) {
      const d = typeof t.details === 'string' ? safeParse(t.details) : null;
      if (d && d.aos_contract) roots.push({ id, t, updatedAt: t.updatedAt || t.createdAt || '' });
    }
    roots.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (roots[0]) root = roots[0].t, root._taskId = roots[0].id;
  }

  if (!root) {
    console.log('No active /aos contract root found.');
    console.log(JSON.stringify({ status: 'ok', found: false }));
    return;
  }
  const rootId = root.taskId || root._taskId;
  const details = typeof root.details === 'string' ? safeParse(root.details) : null;
  const c = details && details.aos_contract ? details.aos_contract : {};
  const dod = asArray(c.dod);

  // Prefer event-sourced contract aggregate (projection) if present; fallback to artifact file.
  let agg = null;
  try {
    if (root.contractAggregate && typeof root.contractAggregate === 'object') {
      agg = root.contractAggregate;
    } else {
      const rootArtifactsDir = root.artifactsDir || (root.taskId ? path.join(ws, 'artifacts', 'aos-tasks', root.taskId.slice(1)) : null);
      if (rootArtifactsDir) {
        const p = path.join(rootArtifactsDir, 'contract_status.json');
        if (fs.existsSync(p)) agg = JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    }
  } catch {}

  const dodStatus = (agg && agg.dodStatus && typeof agg.dodStatus === 'object')
    ? agg.dodStatus
    : ((c.dodStatus && typeof c.dodStatus === 'object') ? c.dodStatus : {});

  // simple derived progress
  const items = dod.map((text, i) => {
    const key = String(i);
    const st = dodStatus[key] || dodStatus[text] || 'pending';
    return { i, text, status: st };
  });
  const doneCount = items.filter(x => String(x.status).toLowerCase() === 'pass' || String(x.status).toLowerCase() === 'done').length;

  const summary = {
    taskId: rootId,
    title: root.title,
    state: root.state,
    goal: c.goal || null,
    mode: c.mode || null,
    dod: items,
    progress: { done: doneCount, total: items.length },
    next: c.next || null,
    blocked: c.blocked || null,
    updatedAt: root.updatedAt
  };

  // Human
  console.log(`[AOS] ${rootId} ${root.title} — state=${root.state}`);
  if (summary.goal) console.log(`Goal: ${summary.goal}`);
  if (items.length) {
    console.log('DoD:');
    for (const it of items) console.log(`- [${String(it.status)}] ${it.text}`);
  }
  if (summary.blocked) console.log(`Blocked: ${summary.blocked}`);
  if (summary.next) console.log(`Next: ${summary.next}`);

  console.log(JSON.stringify({ status: 'ok', found: true, summary }, null, 2));
}

main();
