import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { makeTempDir, removeDir, writeClaudeFixture } from './helpers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(repoRoot, 'bin', 'agent-observer.js');

/**
 * `watch` is a long-running loop, so it is tested as a real process: start it,
 * give it time to poll, then terminate. Signal handling differs between Windows
 * and POSIX, so the assertions are about what it printed and that it stopped,
 * not about a particular exit code.
 */
function runWatch(root, { runMs = 2500, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, 'watch', '--interval', '1', '--no-color'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: root,
        CODEX_HOME: root,
        XDG_DATA_HOME: root,
        AGENT_OBSERVER_EVENTS: path.join(root, 'no-events'),
        NO_COLOR: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const hardKill = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('watch did not stop when asked'));
    }, timeoutMs);

    const stopTimer = setTimeout(() => child.kill('SIGINT'), runMs);

    child.on('error', (error) => {
      clearTimeout(hardKill);
      clearTimeout(stopTimer);
      reject(error);
    });

    child.on('exit', () => {
      clearTimeout(hardKill);
      clearTimeout(stopTimer);
      resolve({ stdout, stderr });
    });
  });
}

describe('watch', () => {
  let root;

  before(() => {
    root = makeTempDir();
    writeClaudeFixture(root, {
      'eeeeeeee-0000-0000-0000-000000000000': {
        project: 'C--work-demo',
        cwd: '/work/demo',
        agents: [
          {
            id: 'agent-w1',
            model: 'haiku',
            description: 'Implement Task 1',
            startedAt: '2026-08-14T13:34:55.000Z',
            finishedAt: '2026-08-14T13:36:23.000Z',
          },
        ],
      },
    });
  });

  after(() => removeDir(root));

  it('starts, announces itself, and stops when interrupted', async () => {
    const { stdout, stderr } = await runWatch(root);
    assert.match(stdout, /Watching for subagent activity/);
    assert.equal(stderr.trim(), '');
  });

  it('does not replay subagents that already existed when it started', async () => {
    // The first poll seeds the seen-set. Printing its results would flood the
    // terminal with history the moment you run it.
    const { stdout } = await runWatch(root);
    assert.doesNotMatch(stdout, /Implement Task 1/);
  });
});
