#!/usr/bin/env node
/**
 * Aggregate child verification/evidence tasks for a contract root into a single status file.
 *
 * Why: We avoid inventing new control-plane state (no editing QUEUE.md, no new DB).
 * Short-term: write derived status into root artifacts (auditable, reproducible).
 *
 * Output file: <root.artifactsDir>/contract_status.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { appendEvent } = require('/home/ubuntu/.openclaw/workspace-god/skills/aos/scripts/lib/event_log');

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function exists(p) {
  try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function listPngs(dir) {
  try {
    return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png')).map(f => path.join(dir, f));
  } catch { return []; }
}

function main() {
  const ws = process.env.WORKSPACE_ROOT || '/home/ubuntu/.openclaw/workspace-god';
  const snapPath = path.join(ws, '.aos', 'workflow-snapshot.json');
  const taskIdArg = process.argv.slice(2).find(a => a.startsWith('--taskId='));
  const rootTaskId = taskIdArg ? taskIdArg.split('=')[1] : null;
  if (!exists(snapPath)) {
    console.error(JSON.stringify({ status: 'error', message: `snapshot not found at ${snapPath}` }));
    process.exit(1);
  }
  const snap = readJson(snapPath);
  const tasks = snap.tasks || {};

  let root = null;
  if (rootTaskId) root = tasks[rootTaskId] || null;
  if (!root) {
    // pick most recent contract root
    const roots = [];
    for (const [id, t] of Object.entries(tasks)) {
      const d = typeof t.details === 'string' ? safeParse(t.details) : null;
      if (d && d.aos_contract) roots.push({ id, t, updatedAt: t.updatedAt || t.createdAt || '' });
    }
    roots.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (roots[0]) root = roots[0].t, root._taskId = roots[0].id;
  }

  if (!root) {
    console.log(JSON.stringify({ status: 'ok', found: false }));
    return;
  }
  const rid = root.taskId || root._taskId;
  const rootDetails = typeof root.details === 'string' ? safeParse(root.details) : null;
  const contract = (rootDetails && rootDetails.aos_contract) ? rootDetails.aos_contract : {};
  const dod = Array.isArray(contract.dod) ? contract.dod : [];

  const children = [];
  for (const [id, t] of Object.entries(tasks)) {
    if (!t.details || typeof t.details !== 'string') continue;
    const d = safeParse(t.details);
    if (!d || d.parent !== rid) continue;
    children.push({ taskId: id, title: t.title, state: t.state, lane: t.lane, details: d, resultPath: t.resultPath, artifactsDir: t.artifactsDir, updatedAt: t.updatedAt });
  }

  // Build DoD status
  const dodStatus = {};
  const evidence = {};

  for (let i = 0; i < dod.length; i++) {
    dodStatus[String(i)] = 'pending';
    evidence[String(i)] = [];
  }

  for (const c of children) {
    const idx = (typeof c.details.dodIndex === 'number') ? c.details.dodIndex : null;
    if (idx === null) continue;

    // default: DONE child => pass; Review/In Progress => pending; Failed => fail
    const st = String(c.state || '').toLowerCase();
    if (st === 'done') dodStatus[String(idx)] = 'pass';
    else if (st === 'failed') dodStatus[String(idx)] = 'fail';

    // gather evidence
    const ev = [];
    if (c.resultPath && exists(c.resultPath)) ev.push(c.resultPath);

    // special-case screenshots: look for screenshots/*.png in latest run dir
    if (String(c.details.dodText || '').includes('截图') || String(dod[idx] || '').includes('截图')) {
      // attempt to find pngs under any run dir under artifactsDir
      if (c.artifactsDir && exists(c.artifactsDir)) {
        try {
          const entries = fs.readdirSync(c.artifactsDir).filter(x => x.startsWith('run_')).sort().reverse();
          for (const run of entries) {
            const sdir = path.join(c.artifactsDir, run, 'screenshots');
            const pngs = listPngs(sdir);
            if (pngs.length) { ev.push(...pngs); break; }
          }
        } catch {}
      }
      // If we found pngs, mark pass even if task state isn't Done (evidence-driven)
      if (ev.some(p => p.endsWith('.png'))) dodStatus[String(idx)] = 'pass';
    }

    evidence[String(idx)].push(...ev);
  }

  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootTaskId: rid,
    goal: contract.goal || null,
    mode: contract.mode || null,
    dod,
    dodStatus,
    evidence,
    children: children.map(c => ({ taskId: c.taskId, state: c.state, title: c.title, dodIndex: c.details.dodIndex, updatedAt: c.updatedAt }))
  };

  const rootArtifactsDir = root.artifactsDir || path.join(ws, 'artifacts', 'aos-tasks', String(rid).slice(1));
  const outPath = path.join(rootArtifactsDir, 'contract_status.json');
  fs.mkdirSync(rootArtifactsDir, { recursive: true });
  const outJson = JSON.stringify(out, null, 2);
  fs.writeFileSync(outPath, outJson);

  // Also emit an event so the aggregate becomes part of the source-of-truth log.
  // Dedupe by content hash to keep it idempotent.
  const contentHash = crypto.createHash('sha256').update(JSON.stringify({
    rootTaskId: rid,
    dod: out.dod,
    dodStatus: out.dodStatus,
    evidence: out.evidence
  })).digest('hex').slice(0, 16);

  const evt = appendEvent({
    type: 'AOS_CONTRACT_AGGREGATE',
    agent: 'god',
    payload: {
      taskId: rid,
      generatedAt: out.generatedAt,
      dod: out.dod,
      dodStatus: out.dodStatus,
      evidence: out.evidence,
      dedupeKey: `contract_aggregate::${rid}::${contentHash}`
    }
  });

  console.log(JSON.stringify({ status: 'ok', found: true, rootTaskId: rid, outPath, dodStatus, eventAppended: !!evt }, null, 2));
}

main();
