import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import plugin from '../opencode/plugin.js';
import * as pluginModule from '../opencode/plugin.js';
import {
  COMMAND_NAME,
  SESSION_ENV_VAR,
  applyConfig,
  applySessionEnv,
  readCommand,
  toForwardSlashes,
} from '../opencode/hooks.js';
import { SESSION_ENV_VAR as ADAPTER_SESSION_ENV_VAR } from '../src/adapters/opencode.js';
import { makeTempDir, removeDir } from './helpers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('OpenCode plugin module', () => {
  it('exports only a V1 default with the plugin id and a server function', () => {
    assert.deepEqual(Object.keys(pluginModule), ['default']);
    assert.equal(plugin.id, 'agent-observer');
    assert.equal(typeof plugin.server, 'function');
  });

  it('returns config and shell.env hooks from server', async () => {
    const hooks = await plugin.server({}, {});
    assert.equal(typeof hooks.config, 'function');
    assert.equal(typeof hooks['shell.env'], 'function');

    const config = {};
    await hooks.config(config);
    assert.deepEqual(config.skills.paths, [path.join(repoRoot, 'skills')]);
    assert.ok(config.command[COMMAND_NAME].template);
  });

  it('uses the same session variable the adapter reads', () => {
    assert.equal(SESSION_ENV_VAR, ADAPTER_SESSION_ENV_VAR);
  });
});

describe('OpenCode plugin hooks', () => {
  it('turns a Windows path into forward slashes on any platform', () => {
    assert.equal(toForwardSlashes('C:\\Users\\dev\\agent-observer'), 'C:/Users/dev/agent-observer');
    assert.equal(toForwardSlashes('/home/dev/agent-observer'), '/home/dev/agent-observer');
  });

  it('adds the skills directory once, keeping paths already there', () => {
    const config = { skills: { paths: ['/elsewhere/skills'] } };
    applyConfig(config, repoRoot);
    applyConfig(config, repoRoot);
    assert.deepEqual(config.skills.paths, ['/elsewhere/skills', path.join(repoRoot, 'skills')]);
  });

  it('builds the command from the shipped command file with an absolute CLI path', () => {
    const config = {};
    applyConfig(config, repoRoot);
    const command = config.command[COMMAND_NAME];

    assert.doesNotMatch(command.template, /\$\{CLAUDE_PLUGIN_ROOT\}/);
    assert.doesNotMatch(command.template, /^---/);
    assert.match(command.template, /\$ARGUMENTS/);
    assert.match(command.description, /subagents/);

    const cli = `${toForwardSlashes(repoRoot)}/bin/agent-observer.js`;
    assert.ok(command.template.includes(cli), `template should name ${cli}`);
    assert.ok(fs.existsSync(cli));
  });

  it('leaves a user-defined command exactly as it was', () => {
    const mine = { template: 'my own report', description: 'mine' };
    const config = { command: { [COMMAND_NAME]: mine } };
    applyConfig(config, repoRoot);
    assert.equal(config.command[COMMAND_NAME], mine);
    assert.deepEqual(mine, { template: 'my own report', description: 'mine' });
  });

  it('reads a command file with CRLF line endings and no description', () => {
    const dir = makeTempDir();
    try {
      const file = path.join(dir, 'x.md');
      fs.writeFileSync(file, '---\r\nallowed-tools: Bash\r\n---\r\n\r\nRun node "${CLAUDE_PLUGIN_ROOT}/bin/x.js" $ARGUMENTS\r\n');
      const command = readCommand(file, 'C:\\pkg');
      assert.equal(command.template, 'Run node "C:/pkg/bin/x.js" $ARGUMENTS');
      assert.equal('description' in command, false);
    } finally {
      removeDir(dir);
    }
  });

  it('still registers the skills path when the command file cannot be read', () => {
    const dir = makeTempDir();
    try {
      // A packageRoot with no commands/ directory at all: readCommand throws
      // trying to read a file that is not there. That must not stop the
      // skills path from being registered, and must not throw out of
      // OpenCode's config hook.
      const config = {};
      assert.doesNotThrow(() => applyConfig(config, dir));
      assert.deepEqual(config.skills.paths, [path.join(dir, 'skills')]);
      assert.equal(config.command[COMMAND_NAME], undefined);
    } finally {
      removeDir(dir);
    }
  });

  it('exports the session id to shell commands only when there is one', () => {
    const withId = { env: {} };
    applySessionEnv({ cwd: '/x', sessionID: 'ses_abc' }, withId);
    assert.deepEqual(withId.env, { OPENCODE_SESSION_ID: 'ses_abc' });

    for (const input of [{ cwd: '/x' }, { cwd: '/x', sessionID: '' }, {}]) {
      const output = { env: {} };
      applySessionEnv(input, output);
      assert.deepEqual(output.env, {});
    }
  });
});
