const fs = require('fs');
const path = require('path');

function taskKeyFromId(taskId) {
  const raw = String(taskId || '').replace(/^#/, '');
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function safeJsonParse(line) {
  try { return JSON.parse(line); } catch (_) { return null; }
}

function atomicWriteFile(targetPath, content) {
  const dir = path.dirname(targetPath);
  const tmp = path.join(dir, `.${path.basename(targetPath)}.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, targetPath);
}

module.exports = { taskKeyFromId, safeJsonParse, atomicWriteFile };
