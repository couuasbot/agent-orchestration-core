const { appendEvent } = require('./lib/event_log');
const { validateEventInput } = require('./lib/validation');

// Usage: node dispatch_router.js --type=TYPE --agent=AGENT --payload='JSON_STRING'
const args = process.argv.slice(2);
let type = 'INFO';
let agent = 'god';
let payload = {};

for (const arg of args) {
  if (arg.startsWith('--type=')) type = arg.split('=').slice(1).join('=');
  if (arg.startsWith('--agent=')) agent = arg.split('=').slice(1).join('=');
  if (arg.startsWith('--payload=')) {
    try {
      payload = JSON.parse(arg.split('=').slice(1).join('='));
    } catch (e) {
      console.error(JSON.stringify({ status: 'error', message: 'Error parsing payload JSON' }));
      process.exit(1);
    }
  }
}

if (!type) {
  console.error(JSON.stringify({ status: 'error', message: '--type is required' }));
  process.exit(1);
}

// Schema-backed validation (lightweight, no external deps)
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
        // best-effort hints for operators
        taskId: payload && typeof payload.taskId === 'string' ? payload.taskId : undefined,
        runId: payload && typeof payload.runId === 'string' ? payload.runId : undefined
      }
    });
  } catch (_) {
    // If even that fails, fall through with a CLI error.
  }

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
