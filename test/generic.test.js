import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { GenericAdapter } from '../src/adapters/generic.js';
import { CodexAdapter } from '../src/adapters/codex.js';
import { toNdjson } from '../src/core/report.js';
import { ClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { makeTempDir, removeDir, withEnv, writeClaudeFixture, writeEventsFixture } from './helpers.js';

const EVENTS = [
  {
    schema_version: '1.0',
    provider: 'my-agent',
    session_id: 'run-1',
    agent_id: 'worker-1',
    project: 'demo',
    agent_type: 'worker',
    model: 'gpt-5.3-codex',
    task: 'Implement the parser',
    status: 'completed',
    started_at: '2026-09-01T10:00:00.000Z',
    finished_at: '2026-09-01T10:04:00.000Z',
  },
  {
    schema_version: '1.0',
    provider: 'my-agent',
    session_id: 'run-1',
    agent_id: 'worker-2',
    project: 'demo',
    agent_type: 'worker',
    model: 'gemini-2.5-pro',
    task: 'Review the parser',
    status: 'completed',
    started_at: '2026-09-01T10:05:00.000Z',
    finished_at: '2026-09-01T10:07:00.000Z',
  },
];

describe('GenericAdapter', () => {
  let dir;
  let file;

  before(() => {
    dir = makeTempDir();
    file = writeEventsFixture(path.join(dir, 'events', 'run-1.jsonl'), EVENTS);
  });

  after(() => removeDir(dir));

  it('reads events from a single file', () => {
    const sessions = new GenericAdapter(file).sessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].agentCount, 2);
  });

  it('reads events from a directory of files', () => {
    const sessions = new GenericAdapter(path.join(dir, 'events')).sessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, 'run-1');
  });

  it('groups events from any provider into one session', () => {
    const session = new GenericAdapter(file).sessions()[0];
    assert.equal(session.provider, 'my-agent');
    assert.equal(session.project, 'demo');
    assert.deepEqual(session.modelCounts(), { 'gemini-2.5-pro': 1, 'gpt-5.3-codex': 1 });
  });

  it('infers roles for an agent that did not supply them', () => {
    const session = new GenericAdapter(file).sessions()[0];
    assert.deepEqual(
      session.sortedAgents().map((a) => a.role),
      ['implement', 'review'],
    );
  });

  it('derives session start and end from its events', () => {
    const session = new GenericAdapter(file).sessions()[0];
    assert.equal(session.startedAt.toISOString(), '2026-09-01T10:00:00.000Z');
    assert.equal(session.updatedAt.toISOString(), '2026-09-01T10:07:00.000Z');
  });

  it('skips an unparsable line instead of failing the file', () => {
    const messy = path.join(dir, 'messy.jsonl');
    fs.writeFileSync(messy, `${JSON.stringify(EVENTS[0])}\n{ broken\n\n${JSON.stringify(EVENTS[1])}\n`);
    assert.equal(new GenericAdapter(messy).sessions()[0].agentCount, 2);
  });

  it('honours AGENT_OBSERVER_EVENTS', () => {
    withEnv({ AGENT_OBSERVER_EVENTS: file }, () => {
      assert.equal(new GenericAdapter().sessions().length, 1);
    });
  });

  it('reports unavailable when the events path does not exist', () => {
    const cap = new GenericAdapter(path.join(dir, 'nope')).capability();
    assert.equal(cap.available, false);
    assert.match(cap.note, /AGENT_OBSERVER_EVENTS/);
  });

  it('round-trips Claude Code output back through the generic adapter', () => {
    // The common event format is the interop contract: whatever one adapter
    // exports, the generic adapter must be able to read back unchanged.
    const claudeRoot = makeTempDir();
    const roundTrip = path.join(dir, 'roundtrip.jsonl');
    try {
      writeClaudeFixture(claudeRoot, {
        'dddddddd-0000-0000-0000-000000000000': {
          project: 'C--x',
          agents: [
            {
              id: 'agent-r1',
              model: 'haiku',
              description: 'Implement Task 1',
              startedAt: '2026-08-14T13:34:55.000Z',
              finishedAt: '2026-08-14T13:36:23.000Z',
            },
          ],
        },
      });

      const original = new ClaudeCodeAdapter(claudeRoot).sessions();
      fs.writeFileSync(roundTrip, toNdjson(original) + '\n');

      const reread = new GenericAdapter(roundTrip).sessions();
      assert.equal(reread.length, 1);
      assert.equal(reread[0].sessionId, original[0].sessionId);
      assert.equal(reread[0].agentCount, 1);
      assert.equal(reread[0].agents[0].model, 'haiku');
      assert.equal(reread[0].agents[0].role, 'implement');
      assert.equal(
        reread[0].agents[0].startedAt.toISOString(),
        original[0].agents[0].startedAt.toISOString(),
      );
    } finally {
      removeDir(claudeRoot);
    }
  });
});

describe('CodexAdapter', () => {
  let root;

  before(() => {
    root = makeTempDir();
    const sessionsDir = path.join(root, 'sessions', '2026', '09');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, 'rollout-abc.jsonl'),
      [
        JSON.stringify({
          payload: {
            id: 'codex-session-1',
            cwd: '/home/dev/demo',
            model: 'gpt-5.3-codex',
            timestamp: '2026-09-01T09:00:00.000Z',
          },
        }),
        JSON.stringify({ payload: { type: 'message' } }),
      ].join('\n'),
    );
  });

  after(() => removeDir(root));

  it('reads the session id, model and project from a rollout', () => {
    const sessions = new CodexAdapter(root).sessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, 'codex-session-1');
    assert.equal(sessions[0].project, 'demo');
    assert.equal(sessions[0].agents[0].model, 'gpt-5.3-codex');
  });

  it('states plainly that per-subagent model routing is not observable', () => {
    const cap = new CodexAdapter(root).capability();
    assert.equal(cap.available, true);
    assert.ok(cap.missing.includes('per-subagent model'));
    assert.match(cap.note, /do not record per-subagent metadata/);
  });

  it('reports unavailable when there is no sessions directory', () => {
    const empty = makeTempDir();
    try {
      assert.equal(new CodexAdapter(empty).capability().available, false);
      assert.deepEqual(new CodexAdapter(empty).sessions(), []);
    } finally {
      removeDir(empty);
    }
  });
});
