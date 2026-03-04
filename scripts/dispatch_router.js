const fs = require('fs');
const path = require('path');

// Configuration - relative to workspace root
const WORKSPACE_ROOT = process.cwd();
const EVENTS_FILE = path.join(WORKSPACE_ROOT, 'workflow-events.jsonl');

// Helper: Get current ISO timestamp
const getTimestamp = () => new Date().toISOString();

/**
 * Append an event to the workflow log.
 * @param {string} type - Event type (e.g., 'DISPATCH', 'AGENT_RESPONSE', 'TASK_COMPLETE')
 * @param {object} payload - The event data
 * @param {string} agent - The agent triggering the event (default: god)
 */
function logEvent(type, payload, agent = 'god') {
  const event = {
    id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: getTimestamp(),
    type: type.toUpperCase(),
    agent: agent,
    payload: payload
  };

  const line = JSON.stringify(event) + '\n';
  
  try {
    fs.appendFileSync(EVENTS_FILE, line, 'utf8');
    console.log(JSON.stringify({ status: 'success', eventId: event.id, message: 'Event logged successfully' }));
  } catch (err) {
    console.error(JSON.stringify({ status: 'error', message: err.message }));
    process.exit(1);
  }
}

// CLI Argument Parsing
// Usage: node dispatch_router.js --type=TYPE --agent=AGENT --payload='JSON_STRING'
const args = process.argv.slice(2);
let type = 'INFO';
let agent = 'god';
let payload = {};

args.forEach(arg => {
  if (arg.startsWith('--type=')) type = arg.split('=')[1];
  if (arg.startsWith('--agent=')) agent = arg.split('=')[1];
  if (arg.startsWith('--payload=')) {
    try {
      payload = JSON.parse(arg.split('=').slice(1).join('='));
    } catch (e) {
      console.error('Error parsing payload JSON');
      process.exit(1);
    }
  }
});

if (!type) {
  console.error('Error: --type is required');
  process.exit(1);
}

logEvent(type, payload, agent);
