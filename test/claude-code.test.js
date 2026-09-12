import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ClaudeCodeAdapter, decodeProjectDir, normaliseModel } from '../src/adapters/claude-code.js';
import { makeTempDir, removeDir, withEnv, writeClaudeFixture } from './helpers.js';

/** Mirrors the Superpowers SDD run that motivated this tool. */
const SDD_AGENTS = [
  { id: 'agent-a01', model: 'haiku', description: 'Implement Task 1: plan workflow', startedAt: '2026-08-14T13:34:55.000Z', finishedAt: '2026-08-14T13:36:23.000Z', turns: 14 },
  { id: 'agent-a02', model: 'sonnet', description: 'Review Task 1 (spec + quality)', startedAt: '2026-08-14T13:36:52.000Z', finishedAt: '2026-08-14T13:40:26.000Z', turns: 9 },
  { id: 'agent-a03', model: 'haiku', description: 'Implement Task 2: apply workflow', startedAt: '2026-08-14T13:41:02.000Z', finishedAt: '2026-08-14T13:42:21.000Z', turns: 11 },
  { id: 'agent-a04', model: 'opus', description: 'Final whole-branch review', startedAt: '2026-08-14T13:55:11.000Z', finishedAt: '2026-08-14T14:05:46.000Z', turns: 31 },
  { id: 'agent-a05', model: 'sonnet', description: 'Fix final-review findings', startedAt: '2026-08-14T14:07:23.000Z', finishedAt: '2026-08-14T14:17:52.000Z', turns: 22 },
];

describe('ClaudeCodeAdapter', () => {
  let root;

  before(() => {
    root = makeTempDir();
    writeClaudeFixture(root, {
      '3a372c2d-5be3-43b6-a7d5-29cc9e032cd7': {
        project: 'C--Users-dev-work-my-repo',
        cwd: 'C:\\Users\\dev\\work\\my-repo',
        agents: SDD_AGENTS,
      },
      '8a0e262b-3e68-401e-8e9e-1d5c8f0e1341': {
        project: 'C--Users-dev-other',
        agents: [
          {
            id: 'agent-b01',
            model: 'sonnet',
            agentType: 'Explore',
            description: 'Explore config',
            startedAt: '2026-08-10T09:00:00.000Z',
            finishedAt: '2026-08-10T09:02:00.000Z',
            turns: 4,
          },
        ],
      },
    });
  });

  after(() => removeDir(root));

  it('finds every session that dispatched subagents', () => {
    const sessions = new ClaudeCodeAdapter(root).sessions();
    assert.equal(sessions.length, 2);
  });

  it('reads model, type, task and spawn depth from the metadata', () => {
    const session = new ClaudeCodeAdapter(root).session('3a372c2d-5be3-43b6-a7d5-29cc9e032cd7');
    const agents = session.sortedAgents();
    assert.equal(agents.length, 5);
    assert.deepEqual(
      agents.map((a) => a.model),
      ['haiku', 'sonnet', 'haiku', 'opus', 'sonnet'],
    );
    assert.equal(agents[0].agentType, 'general-purpose');
    assert.equal(agents[0].task, 'Implement Task 1: plan workflow');
    assert.equal(agents[0].spawnDepth, 1);
    assert.equal(agents[0].toolUseId, 'toolu_agent-a01');
  });

  it('orders subagents by their transcript start time', () => {
    const session = new ClaudeCodeAdapter(root).session('3a372c2d');
    assert.deepEqual(
      session.sortedAgents().map((a) => a.agentId),
      ['agent-a01', 'agent-a02', 'agent-a03', 'agent-a04', 'agent-a05'],
    );
  });

  it('derives duration and turn count from the transcript', () => {
    const session = new ClaudeCodeAdapter(root).session('3a372c2d');
    const first = session.sortedAgents()[0];
    assert.equal(first.durationSeconds, 88);
    assert.equal(first.turns, 14);
    assert.equal(first.status, 'completed');
  });

  it('infers roles so model routing is visible per task type', () => {
    const session = new ClaudeCodeAdapter(root).session('3a372c2d');
    assert.deepEqual(
      session.sortedAgents().map((a) => a.role),
      ['implement', 'review', 'implement', 'review', 'fix'],
    );
  });

  it('tallies models for the session', () => {
    const session = new ClaudeCodeAdapter(root).session('3a372c2d');
    assert.deepEqual(session.modelCounts(), { haiku: 2, sonnet: 2, opus: 1 });
  });

  it('takes the project path from the transcript, not the encoded directory', () => {
    const session = new ClaudeCodeAdapter(root).session('3a372c2d');
    // The encoded name C--Users-dev-work-my-repo cannot be decoded to
    // my-repo, because the hyphen is ambiguous. The transcript's cwd can.
    assert.equal(session.projectPath, 'C:\\Users\\dev\\work\\my-repo');
    assert.equal(session.project, 'my-repo');
  });

  it('falls back to decoding the directory name when there is no transcript', () => {
    const session = new ClaudeCodeAdapter(root).session('8a0e262b');
    assert.ok(session.projectPath.includes('Users'));
    assert.equal(session.agents[0].agentType, 'Explore');
  });

  it('resolves a session by unambiguous prefix', () => {
    const adapter = new ClaudeCodeAdapter(root);
    assert.ok(adapter.session('3a372c2d'));
    assert.equal(adapter.session('nonexistent'), null);
  });

  it('sorts sessions by most recent activity first', () => {
    const sessions = new ClaudeCodeAdapter(root).sessions();
    assert.equal(sessions[0].sessionId, '3a372c2d-5be3-43b6-a7d5-29cc9e032cd7');
  });

  it('reports what it can and cannot observe', () => {
    const cap = new ClaudeCodeAdapter(root).capability();
    assert.equal(cap.available, true);
    assert.ok(cap.observes.includes('subagent model'));
    assert.ok(cap.missing.includes('token usage'));
  });

  it('reports unavailable, with a hint, when there is no projects directory', () => {
    const empty = makeTempDir();
    try {
      const cap = new ClaudeCodeAdapter(empty).capability();
      assert.equal(cap.available, false);
      assert.match(cap.note, /CLAUDE_CONFIG_DIR/);
      assert.deepEqual(new ClaudeCodeAdapter(empty).sessions(), []);
    } finally {
      removeDir(empty);
    }
  });

  it('honours CLAUDE_CONFIG_DIR', () => {
    withEnv({ CLAUDE_CONFIG_DIR: root }, () => {
      assert.equal(new ClaudeCodeAdapter().sessions().length, 2);
    });
  });

  it('picks the current session from the environment', () => {
    withEnv(
      {
        CLAUDE_CODE_SESSION_ID: '8a0e262b-3e68-401e-8e9e-1d5c8f0e1341',
        CLAUDE_SESSION_ID: null,
      },
      () => {
        const current = new ClaudeCodeAdapter(root).currentSession();
        assert.equal(current.sessionId, '8a0e262b-3e68-401e-8e9e-1d5c8f0e1341');
      },
    );
  });

  it('falls back to the newest session when the environment says nothing', () => {
    withEnv({ CLAUDE_CODE_SESSION_ID: null, CLAUDE_SESSION_ID: null }, () => {
      const current = new ClaudeCodeAdapter(root).currentSession();
      assert.equal(current.sessionId, '3a372c2d-5be3-43b6-a7d5-29cc9e032cd7');
    });
  });

  it('ignores a malformed session id in the environment', () => {
    withEnv({ CLAUDE_CODE_SESSION_ID: 'not-a-uuid', CLAUDE_SESSION_ID: null }, () => {
      assert.equal(new ClaudeCodeAdapter(root).currentSessionId(), null);
    });
  });

  it('skips a session whose subagents directory is empty', () => {
    const sparse = makeTempDir();
    try {
      const dir = path.join(sparse, 'projects', 'C--x', 'aaaaaaaa-0000-0000-0000-000000000000', 'subagents');
      fs.mkdirSync(dir, { recursive: true });
      assert.deepEqual(new ClaudeCodeAdapter(sparse).sessions(), []);
    } finally {
      removeDir(sparse);
    }
  });

  it('survives a corrupt metadata file instead of throwing', () => {
    const broken = makeTempDir();
    try {
      const dir = path.join(broken, 'projects', 'C--x', 'bbbbbbbb-0000-0000-0000-000000000000', 'subagents');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'agent-bad.meta.json'), '{ not json');
      fs.writeFileSync(
        path.join(dir, 'agent-good.meta.json'),
        JSON.stringify({ agentType: 'general-purpose', description: 'Fine', model: 'sonnet' }),
      );
      const sessions = new ClaudeCodeAdapter(broken).sessions();
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].agentCount, 1);
      assert.equal(sessions[0].agents[0].task, 'Fine');
    } finally {
      removeDir(broken);
    }
  });

  it('marks a subagent with no transcript as still spawned', () => {
    // A subagent that has been dispatched but has not written a transcript yet
    // is in flight: report it as spawned rather than inventing an end time.
    const running = makeTempDir();
    try {
      writeClaudeFixture(running, {
        'cccccccc-0000-0000-0000-000000000000': {
          project: 'C--x',
          agents: [{ id: 'agent-inflight', model: 'haiku', description: 'Implement Task 9' }],
        },
      });
      const session = new ClaudeCodeAdapter(running).sessions()[0];
      assert.equal(session.agents[0].status, 'spawned');
      assert.equal(session.agents[0].turns, null);
      assert.equal(session.agents[0].finishedAt, null);
      // The spawn time still comes from the metadata file's own mtime.
      assert.ok(session.agents[0].startedAt instanceof Date);
    } finally {
      removeDir(running);
    }
  });
});

describe('normaliseModel', () => {
  it('trims a full API id down to its family so reports group correctly', () => {
    assert.equal(normaliseModel('claude-haiku-4-5-20251001'), 'haiku');
    assert.equal(normaliseModel('claude-opus-5'), 'opus');
    assert.equal(normaliseModel('claude-sonnet-5'), 'sonnet');
  });

  it('passes a bare family name through', () => {
    assert.equal(normaliseModel('haiku'), 'haiku');
  });

  it('keeps inherit, which is a real answer rather than a missing one', () => {
    assert.equal(normaliseModel('inherit'), 'inherit');
  });

  it('returns null for a missing or empty value', () => {
    assert.equal(normaliseModel(undefined), null);
    assert.equal(normaliseModel(''), null);
    assert.equal(normaliseModel('   '), null);
    assert.equal(normaliseModel(42), null);
  });

  it('leaves an unknown model id untouched', () => {
    assert.equal(normaliseModel('gpt-5.3-codex'), 'gpt-5.3-codex');
  });
});

describe('decodeProjectDir', () => {
  it('rebuilds a Windows path from an encoded directory name', () => {
    const decoded = decodeProjectDir('C--Users-dev-project');
    assert.match(decoded, /^C:[\\/]Users/);
  });

  it('rebuilds a POSIX path from a leading dash', () => {
    assert.equal(decodeProjectDir('-home-dev-project'), '/home/dev/project');
  });

  it('returns the input unchanged when it is not an encoded path', () => {
    assert.equal(decodeProjectDir('plain'), 'plain');
    assert.equal(decodeProjectDir(''), '');
  });
});
