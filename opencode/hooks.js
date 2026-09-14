/**
 * The logic behind agent-observer's OpenCode plugin hooks.
 *
 * Kept apart from plugin.js because OpenCode treats every export of a plugin
 * module that is not a V1 default as a plugin of its own. This file must not
 * import the adapters: the plugin runs inside OpenCode's Bun, which has no
 * node:sqlite.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const COMMAND_NAME = 'subagent-report';

/** Must match SESSION_ENV_VAR in src/adapters/opencode.js; a test pins them. */
export const SESSION_ENV_VAR = 'OPENCODE_SESSION_ID';

/** Node accepts forward slashes on Windows, and they survive every shell's quoting. */
export function toForwardSlashes(p) {
  return p.replace(/\\/g, '/');
}

/**
 * An OpenCode command built from a Claude Code command file: the body becomes
 * the template, with the plugin root spelled out, and the frontmatter
 * description is kept.
 */
export function readCommand(file, packageRoot) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const frontmatter = match ? match[1] : '';
  const body = match ? match[2] : text;

  const command = {
    template: body.split('${CLAUDE_PLUGIN_ROOT}').join(toForwardSlashes(packageRoot)).trim(),
  };
  const description = /^description:\s*(.+)$/m.exec(frontmatter);
  if (description) command.description = description[1].trim().replace(/^["']|["']$/g, '');
  return command;
}

/** Register the bundled skills and command in OpenCode's live config. */
export function applyConfig(config, packageRoot) {
  const skillsDir = path.join(packageRoot, 'skills');
  config.skills = config.skills || {};
  config.skills.paths = config.skills.paths || [];
  if (!config.skills.paths.includes(skillsDir)) config.skills.paths.push(skillsDir);

  config.command = config.command || {};
  if (!config.command[COMMAND_NAME]) {
    // A missing or unreadable command file must not take down the whole
    // config hook: OpenCode would then load neither the skill nor the
    // command, when the skill alone is perfectly usable.
    try {
      config.command[COMMAND_NAME] = readCommand(
        path.join(packageRoot, 'commands', `${COMMAND_NAME}.md`),
        packageRoot,
      );
    } catch {
      // Leave the command unregistered; skills are already registered above.
    }
  }
}

/** Tell the CLI which OpenCode session a shell command runs in. */
export function applySessionEnv(input, output) {
  const sessionId = input && typeof input.sessionID === 'string' ? input.sessionID : '';
  if (sessionId) output.env[SESSION_ENV_VAR] = sessionId;
}
