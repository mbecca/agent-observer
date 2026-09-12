#!/usr/bin/env node
/**
 * Verify the contributor documentation stays intact.
 *
 * CLAUDE.md and AGENTS.md are how a coding agent learns the rules of this
 * repository, and they cross-reference each other and the docs directory. A
 * broken link there is worse than a broken link elsewhere: it silently drops a
 * rule an agent was supposed to follow.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const checked = [];

/** Files that must exist, because something else depends on them. */
const REQUIRED = [
  ['CLAUDE.md', 'Claude Code loads this automatically; it carries the project rules.'],
  ['AGENTS.md', 'The same rules for agents without Superpowers.'],
  ['CONTRIBUTING.md', 'The human entry point.'],
  ['docs/event-format.md', 'The interop contract other tools build against.'],
  ['docs/writing-an-adapter.md', 'Referenced by AGENTS.md and CONTRIBUTING.md.'],
  ['docs/releasing.md', 'The release process, including why a version bump is mandatory.'],
  ['README.md', null],
  ['CHANGELOG.md', null],
  ['LICENSE', null],
];

for (const [file, why] of REQUIRED) {
  if (existsSync(path.join(repoRoot, file))) {
    checked.push(`ok   ${file}`);
  } else {
    problems.push(`${file} is missing.${why ? ' ' + why : ''}`);
  }
}

/** Collect markdown files, skipping anything not tracked as documentation. */
function markdownFiles(dir, depth = 4) {
  const found = [];
  if (depth < 0) return found;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    // Skip version control and local agent/editor working directories.
    // These hold local working files, not shipped documentation.
    if (name === 'node_modules' || name === '.git' || name === '.superpowers' || name === '.claude' || name === '.worktrees') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...markdownFiles(full, depth - 1));
    else if (name.endsWith('.md')) found.push(full);
  }
  return found;
}

// Relative links only: external URLs are not this script's business, and
// anchors alone (#section) always resolve to the current file.
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

for (const file of markdownFiles(repoRoot)) {
  const relative = path.relative(repoRoot, file).split(path.sep).join('/');
  const text = readFileSync(file, 'utf8');
  let match;
  while ((match = LINK_RE.exec(text))) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const withoutAnchor = target.split('#')[0];
    if (!withoutAnchor) continue;
    const resolved = path.resolve(path.dirname(file), withoutAnchor);
    if (!existsSync(resolved)) {
      problems.push(`${relative} links to '${target}', which does not exist.`);
    }
  }
}

/**
 * CLAUDE.md must keep naming the Superpowers skills, because that is the
 * mechanism by which a contributing agent is told to use them.
 */
const claudeMd = existsSync(path.join(repoRoot, 'CLAUDE.md'))
  ? readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8')
  : '';
const EXPECTED_SKILLS = [
  'superpowers:brainstorming',
  'superpowers:writing-plans',
  'superpowers:subagent-driven-development',
  'superpowers:test-driven-development',
  'superpowers:systematic-debugging',
  'superpowers:verification-before-completion',
  'superpowers:requesting-code-review',
];
const missingSkills = EXPECTED_SKILLS.filter((skill) => !claudeMd.includes(skill));
if (missingSkills.length) {
  problems.push(`CLAUDE.md no longer names: ${missingSkills.join(', ')}.`);
} else {
  checked.push(`ok   CLAUDE.md names all ${EXPECTED_SKILLS.length} expected skills`);
}

/**
 * Every `/agent-observer:x` the docs mention must be a command or skill this
 * plugin actually ships, and every command shipped must be documented.
 *
 * The README once advertised `/subagent-report`, which is only the shorthand
 * form. Plugin commands are namespaced as `/plugin:command`, and the bare name
 * resolves only while nothing else has claimed it.
 */
const shipped = new Set();
for (const dir of ['commands', 'skills']) {
  const full = path.join(repoRoot, dir);
  if (!existsSync(full)) continue;
  for (const name of readdirSync(full)) {
    if (dir === 'commands' && name.endsWith('.md')) shipped.add(name.replace(/\.md$/, ''));
    if (dir === 'skills' && statSync(path.join(full, name)).isDirectory()) shipped.add(name);
  }
}

const documented = new Set();
for (const file of markdownFiles(repoRoot)) {
  const text = readFileSync(file, 'utf8');
  const relative = path.relative(repoRoot, file).split(path.sep).join('/');
  for (const match of text.matchAll(/\/agent-observer:([a-z0-9-]+)/g)) {
    documented.add(match[1]);
    if (!shipped.has(match[1])) {
      problems.push(`${relative} documents /agent-observer:${match[1]}, which this plugin does not ship.`);
    }
  }
}

const readme = existsSync(path.join(repoRoot, 'README.md'))
  ? readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
  : '';
for (const name of shipped) {
  if (!readme.includes(name)) {
    problems.push(`commands/ or skills/ ships '${name}', which the README never mentions.`);
  }
}
if (shipped.size) {
  checked.push(`ok   ${shipped.size} shipped command(s) and skill(s) match the docs`);
}

for (const line of checked) console.log(line);

if (problems.length) {
  console.error('');
  for (const problem of problems) console.error(`FAIL ${problem}`);
  console.error(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}

console.log('\nContributor documentation is intact.');
