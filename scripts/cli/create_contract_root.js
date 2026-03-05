#!/usr/bin/env node
/**
 * Create a root "closed-loop contract" task for /aos <nl>.
 * Short-term storage: embed contract into TASK_CREATE.details as JSON under `aos_contract`.
 * Also auto-creates ops-lane verification tasks mapped from DoD items.
 *
 * Output: JSON {status, rootTaskId, created:[...]}.
 */
const { spawnSync } = require('child_process');

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function nowId() {
  // yyyymmdd_hhmmss
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const s = `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return s;
}

function parseList(s) {
  if (!s) return [];
  // allow JSON array or | separated
  if (s.trim().startsWith('[')) {
    try {
      const a = JSON.parse(s);
      return Array.isArray(a) ? a.map(String) : [];
    } catch {
      return [];
    }
  }
  return s.split('|').map(x => x.trim()).filter(Boolean);
}

function taskCreate(params) {
  const script = '/home/ubuntu/.openclaw/workspace-god/skills/aos/scripts/core/task_create.js';
  const argv = ['node', script, ...params];
  const p = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8' });
  if (p.status !== 0) {
    return { ok: false, status: p.status, stdout: p.stdout, stderr: p.stderr };
  }
  try {
    return { ok: true, out: JSON.parse(p.stdout.trim()) };
  } catch {
    return { ok: true, out: { raw: p.stdout.trim() } };
  }
}

function buildOpsVerifyTask(dodItem, idx, rootTaskId) {
  const text = String(dodItem || '').trim();
  const lower = text.toLowerCase();

  // Minimal templates; keep generic but useful.
  if (lower.includes('截图') || lower.includes('screenshot')) {
    return {
      title: 'Verify DoD: Screenshots baseline + after (desktop/mobile/tablet)',
      details: {
        parent: rootTaskId,
        kind: 'verify',
        dodIndex: idx,
        dodText: text,
        instructions: [
          'Ensure dashboard web is reachable on localhost (default: http://127.0.0.1:5174/).',
          'Capture full-page screenshots for: desktop(1920x1080), mobile(390x844), tablet(768x1024).',
          'Persist artifacts under runArtifactsDir/screenshots/ with clear filenames.',
          'If baseline does not exist yet, create baseline set; otherwise create after set and a short diff note.'
        ]
      }
    };
  }

  if (lower.includes('移动') || lower.includes('断点') || lower.includes('breakpoint') || lower.includes('responsive')) {
    return {
      title: 'Verify DoD: Mobile/tablet breakpoints (390/768) layout sanity',
      details: {
        parent: rootTaskId,
        kind: 'verify',
        dodIndex: idx,
        dodText: text,
        instructions: [
          'Verify key pages at 390x844 and 768x1024.',
          'Look for horizontal overflow, clipped sidebars, inaccessible buttons.',
          'Produce before/after screenshots and a checklist of fixes applied.'
        ]
      }
    };
  }

  if (lower.includes('字体') || lower.includes('间距') || lower.includes('typography') || lower.includes('spacing') || lower.includes('token')) {
    return {
      title: 'Verify DoD: Typography + spacing consistency (tokens applied)',
      details: {
        parent: rootTaskId,
        kind: 'verify',
        dodIndex: idx,
        dodText: text,
        instructions: [
          'Check that design tokens CSS is imported by the web app entry (or root stylesheet).',
          'Confirm key components/pages use tokens (no random px scatter in core layout).',
          'Include screenshots demonstrating consistent headings/body spacing.'
        ]
      }
    };
  }

  // fallback
  return {
    title: `Verify DoD: ${text}`,
    details: {
      parent: rootTaskId,
      kind: 'verify',
      dodIndex: idx,
      dodText: text,
      instructions: [
        'Produce objective evidence under artifacts (files, screenshots, logs).',
        'If objective verification is not possible, summarize what is uncertain and ask for human review.'
      ]
    }
  };
}

function main() {
  const nl = arg('nl');
  const goal = arg('goal');
  const mode = arg('mode', 'auto-safe');
  const title = arg('title', goal ? `AOS Contract: ${goal}` : 'AOS Contract');
  const dod = parseList(arg('dod'));
  const priority = arg('priority', 'P1');
  const slaMinutes = arg('slaMinutes', '240');

  if (!nl && !goal) {
    console.error(JSON.stringify({ status: 'error', message: 'missing --nl or --goal' }));
    process.exit(1);
  }

  const rootTaskId = `#auto_${nowId()}`;
  const contract = {
    mode,
    goal: goal || nl,
    dod,
    risks: [
      'auto-safe: ask on unclear acceptance or risky repo paths (.github/workflows, auth, prod config)'
    ],
    verifyPlan: [],
    evidence: {},
    dodStatus: {},
    next: 'pending_plan',
    blocked: null
  };

  const details = {
    aos_contract: contract,
    nl_requirement: nl || goal,
    createdBy: 'skills/aos/scripts/create_contract_root.js'
  };

  const created = [];

  // Root contract task assigned to COO for planning
  const root = taskCreate([
    `--taskId=${rootTaskId}`,
    `--title=${title}`,
    `--details=${JSON.stringify(details)}`,
    '--roleHint=coo',
    `--priority=${priority}`,
    '--lane=execution',
    `--slaMinutes=${slaMinutes}`,
    `--dedupeKey=contract::${rootTaskId}`
  ]);

  if (!root.ok) {
    console.error(JSON.stringify({ status: 'error', message: 'root task create failed', root }));
    process.exit(1);
  }
  created.push({ kind: 'root', taskId: rootTaskId, out: root.out });

  // Auto-create ops verification tasks from DoD
  for (let i = 0; i < dod.length; i++) {
    const vt = buildOpsVerifyTask(dod[i], i, rootTaskId);
    const verifyTaskId = `#${rootTaskId.slice(1)}_verify_${String(i+1).padStart(2,'0')}`;
    const res = taskCreate([
      `--taskId=${verifyTaskId}`,
      `--title=${vt.title}`,
      `--details=${JSON.stringify(vt.details)}`,
      '--roleHint=cto',
      '--priority=P1',
      '--lane=ops',
      '--slaMinutes=120',
      `--dedupeKey=contract::${rootTaskId}::verify::${i}`
    ]);
    if (!res.ok) {
      created.push({ kind: 'verify', taskId: verifyTaskId, ok: false, error: res });
    } else {
      created.push({ kind: 'verify', taskId: verifyTaskId, ok: true, out: res.out });
    }
  }

  console.log(JSON.stringify({ status: 'ok', rootTaskId, created }, null, 2));
}

main();
