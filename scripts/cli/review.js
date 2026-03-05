#!/usr/bin/env node
/**
 * /aos review
 * Gather evidence for the active (or specified) contract root.
 * Output a JSON plan with evidence files and suggested captions.
 *
 * This script does NOT send messages itself (sending is done by supervisor via message tool).
 */
const fs = require('fs');
const path = require('path');

function arg(name, def = null) {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
}

function exists(p) {
  try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; }
}

function safeReadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function main() {
  const ws = process.env.WORKSPACE_ROOT || '/home/ubuntu/.openclaw/workspace-god';
  const taskId = arg('taskId', null);

  const snapPath = path.join(ws, '.aos', 'workflow-snapshot.json');
  if (!exists(snapPath)) {
    console.log(JSON.stringify({ status: 'error', message: 'snapshot not found', snapPath }, null, 2));
    process.exit(1);
  }
  const snap = safeReadJson(snapPath);
  const tasks = snap.tasks || {};

  let rootId = taskId;
  if (!rootId) {
    // choose latest contract root by updatedAt
    const roots = [];
    for (const [id, t] of Object.entries(tasks)) {
      if (typeof t.details !== 'string') continue;
      try {
        const d = JSON.parse(t.details);
        if (d && d.aos_contract) roots.push({ id, updatedAt: t.updatedAt || t.createdAt || '' });
      } catch {}
    }
    roots.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    rootId = roots[0]?.id || null;
  }

  if (!rootId || !tasks[rootId]) {
    console.log(JSON.stringify({ status: 'ok', found: false, message: 'no contract root found' }, null, 2));
    return;
  }

  const root = tasks[rootId];
  const rootArtifactsDir = root.artifactsDir || path.join(ws, 'artifacts', 'aos-tasks', rootId.slice(1));
  const statusPath = path.join(rootArtifactsDir, 'contract_status.json');

  // Prefer event-sourced contract aggregate (projection) if present; fallback to artifact file.
  const agg = (root.contractAggregate && typeof root.contractAggregate === 'object')
    ? root.contractAggregate
    : (exists(statusPath) ? safeReadJson(statusPath) : null);

  const dod = agg?.dod || [];
  const dodStatus = agg?.dodStatus || {};
  const evidence = agg?.evidence || {};

  // Build a send plan; for images, pre-copy to allowlisted media directory.
  const mediaBase = '/home/ubuntu/.openclaw/media/aos-review';
  const mediaDir = path.join(mediaBase, rootId.slice(1));
  try { fs.mkdirSync(mediaDir, { recursive: true }); } catch {}

  const items = [];
  for (let i = 0; i < dod.length; i++) {
    const idx = String(i);
    const ev = Array.isArray(evidence[idx]) ? evidence[idx] : [];
    const unique = [...new Set(ev)].filter(p => typeof p === 'string' && exists(p));
    for (const p of unique) {
      const ext = path.extname(p).toLowerCase();
      const isImg = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
      let sendPath = p;
      if (isImg) {
        const base = path.basename(p);
        const target = path.join(mediaDir, `${idx}-${base}`);
        try { fs.copyFileSync(p, target); sendPath = target; } catch {}
      }
      items.push({
        dodIndex: i,
        dodText: dod[i],
        status: dodStatus[idx] || 'unknown',
        path: p,
        sendPath,
        kind: isImg ? 'image' : 'file',
        caption: `DoD[${i}] ${dod[i]} (${dodStatus[idx] || 'unknown'})\nsource: ${p}`
      });
    }
  }

  console.log(JSON.stringify({
    status: 'ok',
    found: true,
    rootTaskId: rootId,
    contractStatusPath: statusPath,
    mediaDir,
    dod,
    dodStatus,
    items
  }, null, 2));
}

main();
