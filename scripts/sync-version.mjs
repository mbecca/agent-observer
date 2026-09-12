#!/usr/bin/env node
/**
 * Propagate one version to every manifest that declares it.
 *
 * Run it after `npm version`, or let the release workflow run it to point the
 * marketplace entry at the tag that was just published.
 *
 *   node scripts/sync-version.mjs              # take the version from package.json
 *   node scripts/sync-version.mjs 0.2.0        # set this version everywhere
 *   node scripts/sync-version.mjs 0.2.0 --marketplace-ref v0.2.0
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

const refIndex = args.indexOf('--marketplace-ref');
const marketplaceRef = refIndex === -1 ? null : args[refIndex + 1];
const positional = args.filter((arg, index) => {
  if (arg.startsWith('--')) return false;
  if (refIndex !== -1 && index === refIndex + 1) return false;
  return true;
});

const full = (relative) => path.join(repoRoot, relative);
const readJson = (relative) => JSON.parse(readFileSync(full(relative), 'utf8'));

function writeJson(relative, data) {
  writeFileSync(full(relative), JSON.stringify(data, null, 2) + '\n');
}

const packageJson = readJson('package.json');
const version = positional[0] || packageJson.version;

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`'${version}' is not a semantic version.`);
  process.exit(1);
}

const changed = [];

if (packageJson.version !== version) {
  packageJson.version = version;
  writeJson('package.json', packageJson);
  changed.push('package.json');
}

const plugin = readJson('.claude-plugin/plugin.json');
if (plugin.version !== version) {
  plugin.version = version;
  writeJson('.claude-plugin/plugin.json', plugin);
  changed.push('.claude-plugin/plugin.json');
}

const marketplace = readJson('.claude-plugin/marketplace.json');
let marketplaceChanged = false;
if (marketplace.version !== version) {
  marketplace.version = version;
  marketplaceChanged = true;
}
for (const entry of marketplace.plugins) {
  if (entry.version !== version) {
    entry.version = version;
    marketplaceChanged = true;
  }
  // Only a git-shaped source carries a ref; a relative source has none.
  if (marketplaceRef && entry.source && typeof entry.source === 'object') {
    if (entry.source.ref !== marketplaceRef) {
      entry.source.ref = marketplaceRef;
      marketplaceChanged = true;
    }
  }
}
if (marketplaceChanged) {
  writeJson('.claude-plugin/marketplace.json', marketplace);
  changed.push('.claude-plugin/marketplace.json');
}

const versionFile = 'src/version.js';
const source = readFileSync(full(versionFile), 'utf8');
const updated = source.replace(
  /export const VERSION = '[^']*'/,
  `export const VERSION = '${version}'`,
);
if (updated !== source) {
  writeFileSync(full(versionFile), updated);
  changed.push(versionFile);
}

if (changed.length) {
  for (const file of changed) console.log(`updated ${file} -> ${version}`);
  console.log('\nAdd a CHANGELOG.md entry for this version before tagging.');
} else {
  console.log(`Everything already declares ${version}.`);
}
