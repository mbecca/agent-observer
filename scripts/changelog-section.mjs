#!/usr/bin/env node
/**
 * Print one version's section of CHANGELOG.md, for the GitHub release body.
 *
 *   node scripts/changelog-section.mjs 0.1.0
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] || '').replace(/^v/, '');

if (!version) {
  console.error('Usage: node scripts/changelog-section.mjs <version>');
  process.exit(1);
}

const changelog = readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
const lines = changelog.split('\n');

const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const heading = new RegExp(`^##\\s*\\[?${escaped}\\]?`);

const start = lines.findIndex((line) => heading.test(line));
if (start === -1) {
  // Not fatal: a release can still go out, it just gets a generic body.
  console.log(`Release ${version}.\n\nSee CHANGELOG.md for details.`);
  process.exit(0);
}

const rest = lines.slice(start + 1);
const end = rest.findIndex((line) => /^##\s/.test(line));
const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();

console.log(body || `Release ${version}.`);
