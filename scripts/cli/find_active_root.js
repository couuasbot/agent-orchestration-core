#!/usr/bin/env node
/**
 * Find the most recent task that looks like an /aos <nl> root contract.
 * Heuristic: task.details is JSON and contains { aos_contract: {...} }.
 * Prints JSON: {status, taskId, title, updatedAt}
 */
const fs = require('fs');
const path = require('path');

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function main() {
  const ws = process.env.WORKSPACE_ROOT || '/home/ubuntu/.openclaw/workspace-god';
  const snapPath = path.join(ws, '.aos', 'workflow-snapshot.json');
  if (!fs.existsSync(snapPath)) {
    console.log(JSON.stringify({ status: 'error', message: `snapshot not found at ${snapPath}` }));
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const tasks = snap.tasks || {};

  const roots = [];
  for (const [taskId, t] of Object.entries(tasks)) {
    const d = typeof t.details === 'string' ? safeParse(t.details) : null;
    if (!d || typeof d !== 'object') continue;
    if (!d.aos_contract || typeof d.aos_contract !== 'object') continue;
    roots.push({ taskId, title: t.title || '', updatedAt: t.updatedAt || t.createdAt || '' });
  }

  roots.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const top = roots[0];
  if (!top) {
    console.log(JSON.stringify({ status: 'ok', found: false }));
    return;
  }
  console.log(JSON.stringify({ status: 'ok', found: true, ...top }));
}

main();
