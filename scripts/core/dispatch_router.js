const { appendEvent } = require('../lib/event_log');
const { validateEventInput } = require('../lib/validation');

// Usage:
//   node dispatch_router.js --type=TYPE --agent=AGENT --payload='{"k":"v"}'

const args = process.argv.slice(2);
let type = '';
let agent = 'god';
let payload = {};

for (const a of args) {
  if (a.startsWith('--type=')) type = a.split('=').slice(1).join('=');
  if (a.startsWith('--agent=')) agent = a.split('=').slice(1).join('=');
  if (a.startsWith('--payload=')) {
    try {
      payload = JSON.parse(a.split('=').slice(1).join('='));
    } catch (_) {
      console.error(JSON.stringify({ status: 'error', message: 'Error parsing payload JSON' }));
      process.exit(1);
    }
  }
}

if (!type) {
  console.error(JSON.stringify({ status: 'error', message: '--type is required' }));
  process.exit(1);
}

const v = validateEventInput({ type, agent, payload });
if (!v.ok) {
  // Record an explicit event for auditing/alerting. Avoid recursion by appending directly.
  let validationEvent = null;
  try {
    validationEvent = appendEvent({
      type: 'VALIDATION_ERROR',
      agent: 'god',
      payload: {
        kind: 'event',
        intendedType: String(type).toUpperCase(),
        intendedAgent: agent,
        errors: v.errors,
        schema: v.schema || null,
        taskId: payload && typeof payload.taskId === 'string' ? payload.taskId : undefined,
        runId: payload && typeof payload.runId === 'string' ? payload.runId : undefined
      }
    });
  } catch (_) {}

  console.log(JSON.stringify({
    status: 'validation_error',
    message: 'Event failed validation; wrote VALIDATION_ERROR',
    errors: v.errors,
    schema: v.schema || null,
    validationEvent
  }));
  process.exit(2);
}

try {
  const res = appendEvent({ type, payload, agent });
  console.log(JSON.stringify(res));
} catch (e) {
  console.error(JSON.stringify({ status: 'error', message: e.message, code: e.code || 'ERR' }));
  process.exit(1);
}
