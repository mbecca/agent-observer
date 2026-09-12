#!/usr/bin/env node
/**
 * Validate the Claude Code plugin and marketplace manifests before release.
 *
 * `claude plugin validate` is the authority, but it needs Claude Code installed.
 * These checks run anywhere, catch the mistakes that actually break an install
 * (a missing skill file, a bad path, a name that is not kebab-case), and keep
 * CI honest on a runner with no Claude Code on it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

function readJson(relative) {
  const full = path.join(repoRoot, relative);
  if (!existsSync(full)) {
    fail(`${relative} is missing.`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(full, 'utf8'));
  } catch (error) {
    fail(`${relative} is not valid JSON: ${error.message}`);
    return null;
  }
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// -- plugin.json -----------------------------------------------------------

const plugin = readJson('.claude-plugin/plugin.json');
if (plugin) {
  if (!plugin.name) fail('plugin.json has no name.');
  else if (!KEBAB.test(plugin.name)) fail(`plugin.json name '${plugin.name}' is not kebab-case.`);

  if (!plugin.version) fail('plugin.json has no version.');
  else if (!/^\d+\.\d+\.\d+/.test(plugin.version)) {
    fail(`plugin.json version '${plugin.version}' is not semver.`);
  }
  if (!plugin.description) fail('plugin.json has no description.');

  // Component paths must point at something that exists, or the install is
  // silently missing half the plugin.
  for (const field of ['skills', 'commands', 'agents', 'hooks', 'mcpServers']) {
    const value = plugin[field];
    if (value === undefined) continue;
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (typeof entry !== 'string') continue;
      const target = path.join(repoRoot, entry);
      if (!existsSync(target)) fail(`plugin.json ${field} points at missing path '${entry}'.`);
    }
  }
  notes.push(`plugin ${plugin.name}@${plugin.version}`);
}

// -- skills ----------------------------------------------------------------

const skillsDir = path.join(repoRoot, 'skills');
if (!existsSync(skillsDir)) {
  fail('skills/ directory is missing.');
} else {
  const skills = readdirSync(skillsDir).filter((name) =>
    statSync(path.join(skillsDir, name)).isDirectory(),
  );
  if (!skills.length) fail('skills/ contains no skill directories.');

  for (const skill of skills) {
    const skillFile = path.join(skillsDir, skill, 'SKILL.md');
    if (!existsSync(skillFile)) {
      fail(`skills/${skill} has no SKILL.md.`);
      continue;
    }
    const text = readFileSync(skillFile, 'utf8');
    if (!text.startsWith('---')) {
      fail(`skills/${skill}/SKILL.md does not start with YAML frontmatter.`);
      continue;
    }
    const end = text.indexOf('\n---', 3);
    if (end === -1) {
      fail(`skills/${skill}/SKILL.md frontmatter is not closed.`);
      continue;
    }
    const frontmatter = text.slice(3, end);
    const name = /^name:\s*(.+)$/m.exec(frontmatter);
    const description = /^description:\s*(.+)$/m.exec(frontmatter);
    if (!name) fail(`skills/${skill}/SKILL.md frontmatter has no name.`);
    else if (name[1].trim() !== skill) {
      fail(`skills/${skill}/SKILL.md name '${name[1].trim()}' does not match its directory.`);
    }
    if (!description) fail(`skills/${skill}/SKILL.md frontmatter has no description.`);
    else if (description[1].trim().length < 20) {
      fail(`skills/${skill}/SKILL.md description is too short to trigger reliably.`);
    }
    notes.push(`skill ${skill}`);
  }
}

// -- commands --------------------------------------------------------------

const commandsDir = path.join(repoRoot, 'commands');
if (existsSync(commandsDir)) {
  const commands = readdirSync(commandsDir).filter((name) => name.endsWith('.md'));
  if (!commands.length) fail('commands/ exists but contains no .md files.');
  for (const command of commands) {
    const text = readFileSync(path.join(commandsDir, command), 'utf8');
    if (!text.startsWith('---')) {
      fail(`commands/${command} does not start with YAML frontmatter.`);
    } else if (!/^description:\s*\S/m.test(text.slice(0, text.indexOf('\n---', 3)))) {
      fail(`commands/${command} frontmatter has no description.`);
    }
    notes.push(`command /${command.replace(/\.md$/, '')}`);
  }
}

// -- marketplace.json ------------------------------------------------------

const marketplace = readJson('.claude-plugin/marketplace.json');
if (marketplace) {
  if (!marketplace.name) fail('marketplace.json has no name.');
  else if (!KEBAB.test(marketplace.name)) {
    fail(`marketplace.json name '${marketplace.name}' is not kebab-case.`);
  }

  // Anthropic reserves these; using one makes the marketplace unusable.
  const RESERVED = [
    'claude-code-marketplace',
    'claude-code-plugins',
    'claude-plugins-official',
    'claude-plugins-community',
    'anthropic-marketplace',
    'anthropic-plugins',
    'anthropic-agent-skills',
  ];
  if (RESERVED.includes(marketplace.name)) {
    fail(`marketplace.json name '${marketplace.name}' is reserved by Anthropic.`);
  }

  if (!marketplace.owner || !marketplace.owner.name) {
    fail('marketplace.json owner needs a name.');
  }
  if (!Array.isArray(marketplace.plugins) || !marketplace.plugins.length) {
    fail('marketplace.json lists no plugins.');
  } else {
    for (const entry of marketplace.plugins) {
      if (!entry.name) fail('A marketplace plugin entry has no name.');
      if (!entry.source) fail(`Marketplace entry '${entry.name}' has no source.`);
      if (typeof entry.source === 'string' && entry.source.startsWith('.')) {
        const target = path.join(repoRoot, entry.source);
        if (!existsSync(target)) {
          fail(`Marketplace entry '${entry.name}' points at missing path '${entry.source}'.`);
        }
      }
    }
    notes.push(`marketplace ${marketplace.name} (${marketplace.plugins.length} plugin(s))`);
  }
}

// -- report ----------------------------------------------------------------

for (const note of notes) console.log(`ok   ${note}`);

if (problems.length) {
  console.error('');
  for (const problem of problems) console.error(`FAIL ${problem}`);
  console.error(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}

console.log('\nPlugin and marketplace manifests are valid.');
