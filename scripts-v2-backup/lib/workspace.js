const path = require('path');

/**
 * Resolve the OpenClaw workspace root in a way that works reliably under cron.
 * Priority:
 * 1) AOS_WORKSPACE_ROOT env
 * 2) OPENCLAW_WORKSPACE env
 * 3) derive from this file location: <workspace>/skills/agent-orchestration-system/scripts/lib
 */
function getWorkspaceRoot() {
  return (
    process.env.AOS_WORKSPACE_ROOT ||
    process.env.OPENCLAW_WORKSPACE ||
    path.resolve(__dirname, '..', '..', '..', '..')
  );
}

module.exports = { getWorkspaceRoot };
