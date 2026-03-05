#!/usr/bin/env node

/**
 * AOS CLI Router (v3.1)
 * Unified entry point for all /aos subcommands.
 *
 * Usage:
 *   node router.js <subcommand> [args...]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WORKSPACE_ROOT = path.resolve(__dirname, '../../../');
const SKILLS_DIR = path.join(WORKSPACE_ROOT, 'skills', 'aos', 'scripts');

function run(scriptPath, args) {
  console.log(`[AOS] Running: ${path.basename(scriptPath)} ${args.join(' ')}`);
  const p = spawnSync('node', [scriptPath, ...args], { stdio: 'inherit' });
  process.exit(p.status);
}

function main() {
  const args = process.argv.slice(2);
  const subcmd = args[0] || 'status'; // default to status if empty
  const subargs = args.slice(1);

  switch (subcmd) {
    case 'auto':
      // TODO: Implement auto logic (create contract + heartbeat)
      // For now, map to create_contract_root if args present, else help
      if (subargs.length > 0) {
         // This is complex: requires creating task then running loop.
         // Let's defer to a dedicated orchestrator script or just task_create + heartbeat for now.
         console.log("Auto mode not fully implemented in router yet. Use /aos task + /aos start.");
         process.exit(1);
      }
      break;

    case 'status':
      run(path.join(SKILLS_DIR, 'cli', 'status.js'), subargs);
      break;

    case 'sprint':
      run(path.join(SKILLS_DIR, 'cli', 'sprint.js'), subargs);
      break;

    case 'review':
      run(path.join(SKILLS_DIR, 'cli', 'review.js'), subargs);
      break;

    case 'task':
      // Auto-generate taskId and format args for task_create.js
      // Input: ["Some", "task", "title"]
      // Output: task_create.js --taskId=#auto_... --title="Some task title"
      
      const title = subargs.join(' ');
      if (!title) {
        console.error("Error: Task title required.");
        process.exit(1);
      }

      const now = new Date();
      const timestamp = now.toISOString().replace(/[-T:.Z]/g, '').slice(0, 14); // YYYYMMDDHHmmss
      const autoId = `#task_${timestamp}`;
      
      console.log(`[AOS] Creating task: ${autoId} "${title}"`);
      
      run(path.join(SKILLS_DIR, 'core', 'task_create.js'), [
        `--taskId=${autoId}`,
        `--title=${title}`,
        `--roleHint=cto`,
        `--lane=execution`
      ]);
      break;

    case 'doctor':
      run(path.join(SKILLS_DIR, 'core', 'aos_doctor.js'), subargs);
      break;

    case 'start':
      run(path.join(SKILLS_DIR, 'effectors', 'heartbeat_full.js'), subargs);
      break;

    case 'stop':
      console.log("Stop not implemented.");
      break;

    case 'help':
      console.log(`
AOS v3.1 CLI
Usage: /aos <command> [args]

Commands:
  status   - Show system dashboard
  sprint   - Show sprint progress / cycle
  review   - Review pending tasks
  task     - Create a new task (manual)
  doctor   - Run health checks
  start    - Manually trigger heartbeat cycle
      `);
      break;

    default:
      // Treat as "auto" (natural language requirement)
      console.log(`Unknown command '${subcmd}'. Treating as NL requirement...`);
      // TODO: Implement default auto behavior
      break;
  }
}

main();
