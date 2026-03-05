const fs = require('fs');
const path = require('path');

const { getWorkspaceRoot } = require('./lib/workspace');

const WORKSPACE_ROOT = getWorkspaceRoot();
// Unified memory landing zone (so memory_search can find it via workspace "memory/" extraPaths)
const MEMORY_DIR = path.join(WORKSPACE_ROOT, 'memory', 'aos');
const PATTERNS_FILE = path.join(MEMORY_DIR, 'patterns.md');
const CORRECTIONS_FILE = path.join(MEMORY_DIR, 'corrections.md');

function ensureFileWithHeader(filePath, header) {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, header, 'utf8');
    return;
  }
  const st = fs.statSync(filePath);
  if (st.size === 0) {
    fs.writeFileSync(filePath, header, 'utf8');
  }
}

function ensureFiles() {
  ensureFileWithHeader(PATTERNS_FILE, '# Core Patterns (Hot Memory)\n\n');
  ensureFileWithHeader(CORRECTIONS_FILE, '# Recent Corrections & Lessons\n\n');
}

function recall(query) {
  ensureFiles();
  const q = String(query).toLowerCase();
  const results = [];

  const patterns = fs.readFileSync(PATTERNS_FILE, 'utf8').split('\n');
  for (const line of patterns) {
    if (line.trim() && line.toLowerCase().includes(q)) results.push(`[PATTERN] ${line.trim()}`);
  }

  const corrections = fs.readFileSync(CORRECTIONS_FILE, 'utf8').split('\n');
  const recent = corrections.slice(-200);
  for (const line of recent) {
    if (line.trim() && line.toLowerCase().includes(q)) results.push(`[LESSON] ${line.trim()}`);
  }

  if (results.length) console.log(results.join('\n'));
  else console.log('No specific patterns found. Proceed with standard protocol.');
}

function learn(lesson) {
  ensureFiles();
  const timestamp = new Date().toISOString().split('T')[0];
  const entry = `- [${timestamp}] ${lesson}\n`;
  fs.appendFileSync(CORRECTIONS_FILE, entry, 'utf8');
  console.log(JSON.stringify({ status: 'ok', learned: lesson }));
}

const args = process.argv.slice(2);
let action = '';
let query = '';
let lesson = '';

for (const arg of args) {
  if (arg.startsWith('--action=')) action = arg.split('=').slice(1).join('=');
  if (arg.startsWith('--query=')) query = arg.split('=').slice(1).join('=');
  if (arg.startsWith('--lesson=')) lesson = arg.split('=').slice(1).join('=');
}

if (action === 'recall') {
  if (!query) { console.error('Error: --query is required for recall'); process.exit(1); }
  recall(query);
} else if (action === 'learn') {
  if (!lesson) { console.error('Error: --lesson is required for learn'); process.exit(1); }
  learn(lesson);
} else {
  console.log('Usage: node reflect.js --action=recall --query="deploy" | node reflect.js --action=learn --lesson="Always check disk space"');
}
