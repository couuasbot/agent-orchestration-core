const fs = require('fs');
const path = require('path');

const { appendEvent } = require('../lib/event_log');
const { getWorkspaceRoot } = require('../lib/workspace');

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function fail(message, extra = {}) {
  console.error(JSON.stringify({ status: 'error', message, ...extra }));
  process.exit(1);
}

function safeResolveWithin(rootDir, p) {
  const resolved = path.resolve(rootDir, p);
  const rootResolved = path.resolve(rootDir);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    return null;
  }
  return resolved;
}

function main() {
  const WORKSPACE_ROOT = getWorkspaceRoot();
  const taskId = arg('taskId');
  const runId = arg('runId');
  const resultPathArg = arg('resultPath');
  const artifactsDirArg = arg('artifactsDir'); // optional: explicit run artifacts dir

  if (!taskId || !taskId.startsWith('#')) fail('--taskId must start with #');
  if (!runId) fail('--runId is required');
  if (!resultPathArg) fail('--resultPath is required');

  const resultPath = path.resolve(resultPathArg);
  if (!fs.existsSync(resultPath)) fail('result.json not found', { resultPath });

  let result = null;
  try {
    result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch (e) {
    fail('result.json is not valid JSON', { resultPath, error: e.message });
  }

  const merge = Array.isArray(result.merge) ? result.merge : [];
  if (!merge.length) {
    console.log(JSON.stringify({ status: 'ok', merged: 0, message: 'No merge manifest; nothing to merge.' }));
    return;
  }

  // Establish run artifacts root
  const runArtifactsDir = artifactsDirArg
    ? path.resolve(artifactsDirArg)
    : path.dirname(resultPath);

  // Safety: merge targets may only land under workspace/repos/
  const reposRoot = path.join(WORKSPACE_ROOT, 'repos');

  const mergedFiles = [];
  const errors = [];

  for (const [i, item] of merge.entries()) {
    const source = item && typeof item.source === 'string' ? item.source : '';
    const targetRaw = item && typeof item.target === 'string' ? item.target : '';

    // Back-compat: runner prompts historically used target like "repos/app/...".
    // Normalize to a path relative to reposRoot.
    const target = String(targetRaw).replace(/^\.?[\\/]*repos[\\/]+/i, '');

    if (!source || !target) {
      errors.push({ index: i, message: 'merge item must include source + target' });
      continue;
    }

    // Source must be within runArtifactsDir
    const sourceAbs = safeResolveWithin(runArtifactsDir, source);
    if (!sourceAbs) {
      errors.push({ index: i, message: 'source escapes run artifacts dir', source, runArtifactsDir });
      continue;
    }

    // Target must be within reposRoot
    const targetAbs = safeResolveWithin(reposRoot, target);
    if (!targetAbs) {
      errors.push({ index: i, message: 'target escapes repos/ root (blocked)', target, reposRoot });
      continue;
    }

    if (!fs.existsSync(sourceAbs)) {
      errors.push({ index: i, message: 'source file not found', sourceAbs });
      continue;
    }

    // Copy
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    fs.copyFileSync(sourceAbs, targetAbs);

    const dedupeKey = `merge::${taskId}::${runId}::${path.relative(reposRoot, targetAbs)}`;
    appendEvent({
      type: 'AOS_MERGE',
      agent: 'god',
      payload: {
        taskId,
        runId,
        source: path.relative(runArtifactsDir, sourceAbs),
        target: path.relative(WORKSPACE_ROOT, targetAbs),
        status: 'success',
        dedupeKey
      }
    });

    mergedFiles.push({ source: sourceAbs, target: targetAbs });
  }

  if (errors.length) {
    // Record a single merge-failed event for operators.
    appendEvent({
      type: 'AOS_MERGE_FAILED',
      agent: 'god',
      payload: {
        taskId,
        runId,
        errors,
        dedupeKey: `merge_failed::${taskId}::${runId}`
      }
    });

    fail('merge encountered errors', { merged: mergedFiles.length, errors });
  }

  console.log(JSON.stringify({ status: 'ok', merged: mergedFiles.length }));
}

main();
