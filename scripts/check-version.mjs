#!/usr/bin/env node
/**
 * Fail when the version is not identical in every place that declares it.
 *
 * A plugin whose manifest version disagrees with the npm package silently
 * installs the wrong thing, so this runs in CI before any release can publish.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));

const sources = [];

sources.push(['package.json', readJson('package.json').version]);
sources.push(['.claude-plugin/plugin.json', readJson('.claude-plugin/plugin.json').version]);

const marketplace = readJson('.claude-plugin/marketplace.json');
const entry = marketplace.plugins.find((plugin) => plugin.name === 'agent-observer');
if (!entry) {
  console.error('marketplace.json has no agent-observer entry.');
  process.exit(1);
}
sources.push(['.claude-plugin/marketplace.json (plugin entry)', entry.version]);

const versionMatch = /export const VERSION = '([^']+)'/.exec(read('src/version.js'));
if (!versionMatch) {
  console.error('src/version.js does not export a VERSION literal.');
  process.exit(1);
}
sources.push(['src/version.js', versionMatch[1]]);

const changelog = read('CHANGELOG.md');
const changelogMatch = /^##\s*\[?(\d+\.\d+\.\d+)\]?/m.exec(changelog);
if (!changelogMatch) {
  console.error('CHANGELOG.md has no released version heading.');
  process.exit(1);
}
sources.push(['CHANGELOG.md (latest entry)', changelogMatch[1]]);

const expected = sources[0][1];
const mismatches = sources.filter(([, version]) => version !== expected);

for (const [where, version] of sources) {
  console.log(`${version === expected ? 'ok  ' : 'BAD '} ${version}  ${where}`);
}

if (mismatches.length) {
  console.error(`\nVersion mismatch. package.json says ${expected}.`);
  process.exit(1);
}

// A release tag, when present, must match too.
const tag = process.env.RELEASE_TAG || '';
if (tag) {
  const tagVersion = tag.replace(/^refs\/tags\//, '').replace(/^v/, '');
  if (tagVersion !== expected) {
    console.error(`\nTag ${tag} does not match version ${expected}.`);
    process.exit(1);
  }
  console.log(`ok   ${tagVersion}  release tag`);
}

console.log(`\nAll version declarations agree: ${expected}`);
