#!/usr/bin/env node
/**
 * Test runner.
 *
 * `node --test <dir>` changed behaviour across Node majors and shell globbing
 * differs between bash, PowerShell and cmd.exe. Collecting the files here and
 * passing them explicitly makes `npm test` behave identically everywhere.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(repoRoot, 'test');

const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(testDir, name));

if (!files.length) {
  console.error('No test files found in ' + testDir);
  process.exit(1);
}

const args = ['--test', ...process.argv.slice(2), ...files];
const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: repoRoot });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
