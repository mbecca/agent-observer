import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { EXIT_ERROR, EXIT_NO_DATA, EXIT_OK, applyFilters, main, parseArgs } from '../src/cli.js';
import { AgentRun, Session } from '../src/core/model.js';
import { captureIo, makeTempDir, removeDir, withEnv, writeClaudeFixture } from './helpers.js';

describe('parseArgs', () => {
  it('reads the command and its positional argument', () => {
    const args = parseArgs(['session', 'abc123']);
    assert.equal(args.command, 'session');
    assert.deepEqual(args.positional, ['abc123']);
  });

  it('accepts a flag value as a separate token or after an equals sign', () => {
    assert.equal(parseArgs(['sessions', '--format', 'json']).format, 'json');
    assert.equal(parseArgs(['sessions', '--format=json']).format, 'json');
    assert.equal(parseArgs(['sessions', '-f', 'csv']).format, 'csv');
  });

  it('reads boolean flags', () => {
    const args = parseArgs(['sessions', '--no-color', '--show-ids', '--all']);
    assert.equal(args.noColor, true);
    assert.equal(args.showIds, true);
    assert.equal(args.all, true);
  });

  it('defaults the adapter to auto', () => {
    assert.equal(parseArgs(['sessions']).adapter, 'auto');
    assert.equal(parseArgs(['sessions', '--adapter', 'claude-code']).adapter, 'claude-code');
  });

  it('rejects an unknown option by name', () => {
    assert.throws(() => parseArgs(['sessions', '--bogus']), /Unknown option '--bogus'/);
  });

  it('rejects an unknown format and names the valid ones', () => {
    assert.throws(() => parseArgs(['sessions', '--format', 'yaml']), /Unknown format 'yaml'/);
  });

  it('rejects a flag with no value', () => {
    assert.throws(() => parseArgs(['sessions', '--project']), /needs a value/);
  });

  it('rejects a non-numeric limit and interval', () => {
    assert.throws(() => parseArgs(['sessions', '--limit', 'many']), /positive number/);
    assert.throws(() => parseArgs(['sessions', '--limit', '0']), /positive number/);
    assert.throws(() => parseArgs(['watch', '--interval', '-1']), /positive number/);
  });
});

describe('applyFilters', () => {
  const build = () => [
    new Session({
      provider: 'claude-code',
      sessionId: 'old-session',
      project: 'alpha',
      projectPath: '/work/alpha',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      agents: [
        new AgentRun({ agentId: 'a1', model: 'haiku', task: 'Implement thing' }),
        new AgentRun({ agentId: 'a2', model: 'opus', task: 'Review thing' }),
      ],
    }),
    new Session({
      provider: 'claude-code',
      sessionId: 'new-session',
      project: 'beta',
      projectPath: '/work/beta',
      updatedAt: new Date(Date.now() - 60_000),
      agents: [new AgentRun({ agentId: 'b1', model: 'sonnet', task: 'Fix thing' })],
    }),
    new Session({ provider: 'codex', sessionId: 'empty-session', project: 'gamma', agents: [] }),
  ];

  const base = { all: false, project: null, since: null, model: null, role: null, limit: null };

  it('hides sessions with no recorded subagents', () => {
    const result = applyFilters(build(), base);
    assert.deepEqual(
      result.map((s) => s.sessionId),
      ['new-session', 'old-session'],
    );
  });

  it('includes empty sessions when --all is given', () => {
    const result = applyFilters(build(), { ...base, all: true });
    assert.equal(result.length, 3);
  });

  it('sorts by most recent activity', () => {
    assert.equal(applyFilters(build(), base)[0].sessionId, 'new-session');
  });

  it('filters by project name or path', () => {
    assert.equal(applyFilters(build(), { ...base, project: 'alpha' }).length, 1);
    assert.equal(applyFilters(build(), { ...base, project: '/work/beta' }).length, 1);
    assert.equal(applyFilters(build(), { ...base, project: 'nothing' }).length, 0);
  });

  it('filters by age with a duration', () => {
    const recent = applyFilters(build(), { ...base, since: '1d' });
    assert.deepEqual(
      recent.map((s) => s.sessionId),
      ['new-session'],
    );
  });

  it('rejects an unparsable --since value', () => {
    assert.throws(() => applyFilters(build(), { ...base, since: 'soonish' }), /Use 7d, 12h, 30m/);
  });

  it('keeps only matching subagents when filtering by model', () => {
    const result = applyFilters(build(), { ...base, model: 'opus' });
    assert.equal(result.length, 1);
    assert.equal(result[0].agentCount, 1);
    assert.equal(result[0].agents[0].model, 'opus');
  });

  it('filters by role', () => {
    const result = applyFilters(build(), { ...base, role: 'fix' });
    assert.equal(result.length, 1);
    assert.equal(result[0].sessionId, 'new-session');
  });

  it('drops a session whose subagents all fail the filter', () => {
    assert.equal(applyFilters(build(), { ...base, model: 'gemini' }).length, 0);
  });

  it('caps the result with --limit', () => {
    assert.equal(applyFilters(build(), { ...base, limit: 1 }).length, 1);
  });

  it('leaves the original sessions untouched', () => {
    const sessions = build();
    applyFilters(sessions, { ...base, model: 'opus' });
    assert.equal(sessions[0].agentCount, 2);
  });
});

describe('cli end to end', () => {
  let root;
  const fixtureEnv = () => ({
    CLAUDE_CONFIG_DIR: root,
    CLAUDE_CODE_SESSION_ID: null,
    CLAUDE_SESSION_ID: null,
    CODEX_HOME: root, // no sessions/ dir here, so the Codex adapter stays quiet
    AGENT_OBSERVER_EVENTS: null,
    NO_COLOR: '1',
  });

  before(() => {
    root = makeTempDir();
    writeClaudeFixture(root, {
      'aaaaaaaa-1111-2222-3333-444444444444': {
        project: 'C--work-demo',
        cwd: '/work/demo',
        agents: [
          { id: 'agent-1', model: 'haiku', description: 'Implement Task 1', startedAt: '2026-08-14T13:34:55.000Z', finishedAt: '2026-08-14T13:36:23.000Z' },
          { id: 'agent-2', model: 'sonnet', description: 'Review Task 1', startedAt: '2026-08-14T13:36:52.000Z', finishedAt: '2026-08-14T13:40:26.000Z' },
          { id: 'agent-3', model: 'opus', description: 'Final whole-branch review', startedAt: '2026-08-14T13:55:11.000Z', finishedAt: '2026-08-14T14:05:46.000Z' },
        ],
      },
    });
  });

  after(() => removeDir(root));

  const runCli = async (argv) => {
    const capture = captureIo();
    const code = await withEnv(fixtureEnv(), () => main(argv, capture.io));
    return { code: await code, stdout: capture.stdout, stderr: capture.stderr };
  };

  it('prints help with no command and exits cleanly', async () => {
    const { code, stdout } = await runCli([]);
    assert.equal(code, EXIT_OK);
    assert.match(stdout, /Usage: agent-observer/);
    assert.match(stdout, /agent-observer tree/);
  });

  it('prints the version', async () => {
    const { code, stdout } = await runCli(['--version']);
    assert.equal(code, EXIT_OK);
    assert.match(stdout, /^agent-observer \d+\.\d+\.\d+$/);
  });

  it('rejects an unknown command with a non-zero exit code', async () => {
    const { code, stderr } = await runCli(['bogus']);
    assert.equal(code, EXIT_ERROR);
    assert.match(stderr, /Unknown command 'bogus'/);
  });

  it('reports an unknown option without a stack trace', async () => {
    const { code, stderr } = await runCli(['sessions', '--nope']);
    assert.equal(code, EXIT_ERROR);
    assert.match(stderr, /Unknown option/);
    assert.doesNotMatch(stderr, /at /);
  });

  it('lists sessions', async () => {
    const { code, stdout } = await runCli(['sessions']);
    assert.equal(code, EXIT_OK);
    assert.match(stdout, /aaaaaaaa-1111-2222-3333-444444444444/);
    assert.match(stdout, /demo/);
    assert.match(stdout, /1 session\(s\), 3 subagent\(s\)/);
  });

  it('reports the current session when the environment names it', async () => {
    const capture = captureIo();
    const code = await withEnv(
      { ...fixtureEnv(), CLAUDE_CODE_SESSION_ID: 'aaaaaaaa-1111-2222-3333-444444444444' },
      () => main(['current'], capture.io),
    );
    assert.equal(await code, EXIT_OK);
    assert.match(capture.stdout, /Implement Task 1/);
    assert.match(capture.stdout, /Final whole-branch review/);
  });

  it('renders a tree', async () => {
    const { code, stdout } = await runCli(['tree']);
    assert.equal(code, EXIT_OK);
    assert.match(stdout, /Task 1/);
    assert.match(stdout, /opus/);
  });

  it('resolves a session by prefix', async () => {
    const { code, stdout } = await runCli(['session', 'aaaaaaaa']);
    assert.equal(code, EXIT_OK);
    assert.match(stdout, /subagents 3/);
  });

  it('exits with the no-data code for an unknown session', async () => {
    const { code, stderr } = await runCli(['session', 'ffffffff']);
    assert.equal(code, EXIT_NO_DATA);
    assert.match(stderr, /No session matching/);
  });

  it('emits valid JSON for export', async () => {
    const { code, stdout } = await runCli(['export', '--format', 'json']);
    assert.equal(code, EXIT_OK);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed[0].agent_count, 3);
    assert.deepEqual(parsed[0].models, { haiku: 1, opus: 1, sonnet: 1 });
  });

  it('emits one parsable event per line for ndjson', async () => {
    const { stdout } = await runCli(['export', '--format', 'ndjson']);
    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 3);
    for (const line of lines) assert.equal(JSON.parse(line).session_id, 'aaaaaaaa-1111-2222-3333-444444444444');
  });

  it('aggregates model usage', async () => {
    const { stdout } = await runCli(['models', '--format', 'json']);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.sessions, 1);
    assert.deepEqual(parsed.models, { haiku: 1, opus: 1, sonnet: 1 });
    assert.deepEqual(parsed.roles, { implement: 1, review: 2 });
  });

  it('filters by model on the command line', async () => {
    const { stdout } = await runCli(['export', '--model', 'opus', '--format', 'ndjson']);
    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).model, 'opus');
  });

  it('describes every adapter, including ones with no data', async () => {
    const { code, stdout } = await runCli(['adapters']);
    assert.equal(code, EXIT_OK);
    assert.match(stdout, /Claude Code/);
    assert.match(stdout, /OpenAI Codex CLI/);
    assert.match(stdout, /Generic/);
  });

  it('runs doctor and counts what it found', async () => {
    const { code, stdout } = await runCli(['doctor']);
    assert.equal(code, EXIT_OK);
    assert.match(stdout, /Total: 1 session\(s\), 3 subagent\(s\)/);
  });

  it('returns the no-data code, and an empty array, when nothing matches', async () => {
    const { code, stdout } = await runCli(['export', '--model', 'gemini', '--format', 'json']);
    assert.equal(code, EXIT_NO_DATA);
    assert.equal(stdout.trim(), '[]');
  });

  it('explains where it looked when there is no data at all', async () => {
    const empty = makeTempDir();
    try {
      const capture = captureIo();
      const code = await withEnv(
        { CLAUDE_CONFIG_DIR: empty, CODEX_HOME: empty, AGENT_OBSERVER_EVENTS: empty, NO_COLOR: '1' },
        () => main(['sessions'], capture.io),
      );
      assert.equal(await code, EXIT_NO_DATA);
      assert.match(capture.stdout, /agent-observer doctor/);
    } finally {
      removeDir(empty);
    }
  });
});
