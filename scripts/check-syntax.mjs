#!/usr/bin/env node
/**
 * Parse every source, script and test file.
 *
 * This is the project's lint step. With no dependencies there is no ESLint, but
 * a syntax error must never reach a release. `node --check` parses each file as
 * ESM (package.json sets "type": "module") without executing it, so entry
 * points and test files are safe to check.
 */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collect(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries.sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...collect(full));
    else if (name.endsWith('.js') || name.endsWith('.mjs')) found.push(full);
  }
  return found;
}

const files = ['bin', 'src', 'scripts', 'test'].flatMap((dir) =>
  collect(path.join(repoRoot, dir)),
);

if (!files.length) {
  console.error('No JavaScript files found to check.');
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const relative = path.relative(repoRoot, file).split(path.sep).join('/');
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) {
    console.log(`ok   ${relative}`);
  } else {
    failures += 1;
    console.error(`FAIL ${relative}`);
    console.error((result.stderr || '').trim());
  }
}

if (failures) {
  console.error(`\n${failures} file(s) failed to parse.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} files parse cleanly.`);
