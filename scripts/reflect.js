const fs = require('fs');
const path = require('path');

// Configuration
const WORKSPACE_ROOT = process.cwd();
const MEMORY_DIR = path.join(WORKSPACE_ROOT, 'memory'); // Relative to where skill is run
const PATTERNS_FILE = path.join(MEMORY_DIR, 'patterns.md');
const CORRECTIONS_FILE = path.join(MEMORY_DIR, 'corrections.md');

// Helper: Ensure files exist
function ensureFiles() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  if (!fs.existsSync(PATTERNS_FILE)) fs.writeFileSync(PATTERNS_FILE, '# Core Patterns (Hot Memory)\n\n');
  if (!fs.existsSync(CORRECTIONS_FILE)) fs.writeFileSync(CORRECTIONS_FILE, '# Recent Corrections & Lessons\n\n');
}

// Action: RECALL
function recall(query) {
  ensureFiles();
  let results = [];
  
  // 1. Search Patterns (High Priority)
  const patterns = fs.readFileSync(PATTERNS_FILE, 'utf8').split('\n');
  patterns.forEach(line => {
    if (line.trim() && line.toLowerCase().includes(query.toLowerCase())) {
      results.push(`[PATTERN] ${line.trim()}`);
    }
  });

  // 2. Search Corrections (Recent Context)
  const corrections = fs.readFileSync(CORRECTIONS_FILE, 'utf8').split('\n');
  const recentCorrections = corrections.slice(-50); // Only check last 50 lines
  recentCorrections.forEach(line => {
    if (line.trim() && line.toLowerCase().includes(query.toLowerCase())) {
      results.push(`[LESSON] ${line.trim()}`);
    }
  });

  if (results.length > 0) {
    console.log(results.join('\n'));
  } else {
    console.log("No specific patterns found. Proceed with standard protocol.");
  }
}

// Action: LEARN
function learn(lesson) {
  ensureFiles();
  const timestamp = new Date().toISOString().split('T')[0];
  const entry = `- [${timestamp}] ${lesson}\n`;
  
  try {
    fs.appendFileSync(CORRECTIONS_FILE, entry, 'utf8');
    console.log(`[LEARNED] Logged lesson to corrections.md: "${lesson}"`);
  } catch (e) {
    console.error(`Error logging lesson: ${e.message}`);
    process.exit(1);
  }
}

// CLI Argument Parsing
const args = process.argv.slice(2);
let action = '';
let query = '';
let lesson = '';

args.forEach(arg => {
  if (arg.startsWith('--action=')) action = arg.split('=')[1];
  if (arg.startsWith('--query=')) query = arg.split('=')[1]; // For recall
  if (arg.startsWith('--lesson=')) lesson = arg.split('=')[1]; // For learn
});

if (action === 'recall') {
  if (!query) { console.error('Error: --query is required for recall'); process.exit(1); }
  recall(query);
} else if (action === 'learn') {
  if (!lesson) { console.error('Error: --lesson is required for learn'); process.exit(1); }
  learn(lesson);
} else {
  console.log('Usage: node reflect.js --action=recall --query="deploy" | node reflect.js --action=learn --lesson="Always check disk space"');
}
