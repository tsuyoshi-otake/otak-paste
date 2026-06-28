import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

const testDir = path.join(process.cwd(), 'out', 'test');
if (!fs.existsSync(testDir)) {
  console.error(`Test output directory not found: ${testDir}`);
  process.exit(1);
}

const testFiles = walk(testDir);
if (testFiles.length === 0) {
  console.error('No compiled test files found.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
