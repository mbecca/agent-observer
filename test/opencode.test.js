import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { OpencodeAdapter } from '../src/adapters/opencode.js';
import {
  hasNodeSqlite,
  makeTempDir,
  opencodeTaskPart as taskPart,
  removeDir,
  writeOpencodeFixture as buildFixtureDb,
} from './helpers.js';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const hasSqlite = hasNodeSqlite();

describe('OpencodeAdapter', { skip: !hasSqlite && 'node:sqlite is not available on this Node version' }, () => {
  let dir;
  let adapter;

  const ROOT_A = 'sess-aaaa1111';
  const ROOT_B = 'sess-bbbb2222';
  const ROOT_C = 'sess-cccc3333'; // dispatches nothing: must not appear
  const CHILD_A1 = 'child-a1-explore';
  const CHILD_A2 = 'child-a2-build';
  const CHILD_A2_1 = 'child-a2-1-nested';
  const CHILD_A3_ERROR = 'child-a3-error';
  const CHILD_A4_RUNNING = 'child-a4-running';
  const CHILD_B1 = 'child-b1-explore';

  dir = makeTempDir();
  after(() => removeDir(dir));
  buildFixtureDb(dir, {
    projects: [
      { id: 'proj1', worktree: 'C:\\Users\\dev\\proj-a', name: 'proj-a' },
      { id: 'proj2', worktree: '/home/dev/proj-b', name: null },
    ],
    sessions: [
      {
        id: ROOT_A,
        project_id: 'proj1',
        parent_id: null,
        directory: 'C:\\Users\\dev\\proj-a',
        agent: 'build',
        model: { id: 'claude-sonnet-4-5', providerID: 'anthropic', variant: 'default' },
        time_created: 2_000_000_000_000,
        time_updated: 2_000_001_000_000,
      },
      {
        id: CHILD_A1,
        project_id: 'proj1',
        parent_id: ROOT_A,
        directory: 'C:\\Users\\dev\\proj-a',
        agent: 'explore',
        model: { id: 'gpt-5.4', providerID: 'github-copilot', variant: 'default' },
        cost: 0.021,
        tokens_input: 1000,
        tokens_output: 200,
        tokens_reasoning: 50,
        tokens_cache_read: 10,
        tokens_cache_write: 5,
      },
      {
        id: CHILD_A2,
        project_id: 'proj1',
        parent_id: ROOT_A,
        agent: 'build',
        model: { id: 'claude-sonnet-4-5-20250929', providerID: 'anthropic', variant: 'default' },
        cost: 0.5,
      },
      {
        id: CHILD_A2_1,
        project_id: 'proj1',
        parent_id: CHILD_A2,
        agent: 'explore',
        model: { id: 'haiku', providerID: 'anthropic' },
        cost: 0.001,
      },
      {
        id: CHILD_A3_ERROR,
        project_id: 'proj1',
        parent_id: ROOT_A,
        agent: 'general',
        model: { id: 'gpt-5.4', providerID: 'github-copilot' },
      },
      {
        id: CHILD_A4_RUNNING,
        project_id: 'proj1',
        parent_id: ROOT_A,
        agent: 'general',
        model: { id: 'gpt-5.4', providerID: 'github-copilot' },
      },
      {
        id: ROOT_B,
        project_id: 'proj2',
        parent_id: null,
        directory: '/home/dev/proj-b',
        agent: 'build',
        model: { id: 'gpt-5', providerID: 'openai' },
        time_created: 1_000_000_000_000,
        time_updated: 1_000_000_100_000,
      },
      {
        id: CHILD_B1,
        project_id: 'proj2',
        parent_id: ROOT_B,
        agent: 'explore',
        model: { id: 'gpt-5', providerID: 'openai' },
      },
      {
        id: ROOT_C,
        project_id: 'proj1',
        parent_id: null,
        directory: 'C:\\Users\\dev\\proj-c',
        agent: 'build',
        model: { id: 'gpt-5', providerID: 'openai' },
      },
    ],
    messages: [
      { id: 'm1', session_id: CHILD_A1 },
      { id: 'm2', session_id: CHILD_A1 },
      { id: 'm3', session_id: CHILD_A1 },
      { id: 'm4', session_id: CHILD_A2 },
      { id: 'm5', session_id: CHILD_A2_1 },
      { id: 'm6', session_id: CHILD_A3_ERROR },
      { id: 'm7', session_id: CHILD_B1 },
      { id: 'm8', session_id: CHILD_B1 },
    ],
    parts: [
      taskPart({
        id: 'prt-a1',
        sessionId: ROOT_A,
        messageId: 'msg-a1',
        status: 'completed',
        start: 2_000_000_010_000,
        end: 2_000_000_060_000,
        description: 'Explore config',
        subagentType: 'explore',
        childSessionId: CHILD_A1,
        modelId: 'gpt-5.4',
        providerId: 'github-copilot',
      }),
      taskPart({
        id: 'prt-a2',
        sessionId: ROOT_A,
        messageId: 'msg-a2',
        status: 'completed',
        start: 2_000_000_070_000,
        end: 2_000_000_200_000,
        description: 'Implement feature',
        subagentType: 'build',
        childSessionId: CHILD_A2,
        modelId: 'claude-sonnet-4-5',
        providerId: 'anthropic',
      }),
      taskPart({
        id: 'prt-a2-1',
        sessionId: CHILD_A2, // dispatched BY the child session: nested
        messageId: 'msg-a2-1',
        status: 'completed',
        start: 2_000_000_080_000,
        end: 2_000_000_150_000,
        description: 'Investigate helper',
        subagentType: 'explore',
        childSessionId: CHILD_A2_1,
        modelId: 'haiku',
        providerId: 'anthropic',
      }),
      taskPart({
        id: 'prt-a3',
        sessionId: ROOT_A,
        messageId: 'msg-a3',
        status: 'error',
        start: 2_000_000_210_000,
        end: 2_000_000_220_000,
        description: 'Run migration',
        subagentType: 'general',
        childSessionId: CHILD_A3_ERROR,
        modelId: 'gpt-5.4',
        providerId: 'github-copilot',
      }),
      taskPart({
        id: 'prt-a4',
        sessionId: ROOT_A,
        messageId: 'msg-a4',
        status: 'running',
        start: 2_000_000_230_000,
        end: undefined,
        description: 'Long crawl',
        subagentType: 'general',
        childSessionId: CHILD_A4_RUNNING,
        modelId: 'gpt-5.4',
        providerId: 'github-copilot',
      }),
      // Not a task dispatch: must be ignored rather than crashing the reader.
      { id: 'prt-text', session_id: ROOT_A, message_id: 'msg-text', data: { type: 'text', text: 'hello' } },
      // Malformed JSON: must skip this row, not the whole session.
      { id: 'prt-broken', session_id: ROOT_A, message_id: 'msg-broken', data: '{ not json' },
      taskPart({
        id: 'prt-b1',
        sessionId: ROOT_B,
        messageId: 'msg-b1',
        status: 'completed',
        start: 1_000_000_010_000,
        end: 1_000_000_050_000,
        description: 'Older task',
        subagentType: 'explore',
        childSessionId: CHILD_B1,
        modelId: 'gpt-5',
        providerId: 'openai',
      }),
    ],
  });
  adapter = new OpencodeAdapter(dir);

  it('is available with a database in the real on-disk shape', () => {
    const cap = adapter.capability();
    assert.equal(cap.available, true);
    assert.ok(cap.observes.includes('subagent model'));
    assert.equal(cap.root, dir);
  });

  it('normalises a Claude model id passed through metadata to its family', () => {
    const session = adapter.session(ROOT_A);
    const build = session.agents.find((a) => a.toolUseId === 'prt-a2');
    assert.equal(build.model, 'sonnet');
    assert.equal(build.agentType, 'build');
    assert.equal(build.task, 'Implement feature');
    assert.equal(build.startedAt.getTime(), 2_000_000_070_000);
    assert.equal(build.finishedAt.getTime(), 2_000_000_200_000);
    assert.equal(build.agentId, CHILD_A2);
  });

  it('keeps a non-Claude model id as-is', () => {
    const session = adapter.session(ROOT_A);
    const explore = session.agents.find((a) => a.toolUseId === 'prt-a1');
    assert.equal(explore.model, 'gpt-5.4');
    assert.equal(explore.agentType, 'explore');
    assert.equal(explore.task, 'Explore config');
    assert.equal(explore.startedAt.getTime(), 2_000_000_010_000);
    assert.equal(explore.finishedAt.getTime(), 2_000_000_060_000);
  });

  it('marks an errored task completed, with the outcome recorded in extra', () => {
    const session = adapter.session(ROOT_A);
    const errored = session.agents.find((a) => a.toolUseId === 'prt-a3');
    assert.equal(errored.status, 'completed');
    assert.equal(errored.extra.outcome, 'error');
    assert.ok(errored.finishedAt instanceof Date);
  });

  it('reports a still-running task as spawned with no finish time', () => {
    const session = adapter.session(ROOT_A);
    const running = session.agents.find((a) => a.toolUseId === 'prt-a4');
    assert.equal(running.status, 'spawned');
    assert.equal(running.finishedAt, null);
    assert.ok(running.startedAt instanceof Date);
  });

  it('counts turns from the child session\'s own messages', () => {
    const session = adapter.session(ROOT_A);
    const explore = session.agents.find((a) => a.toolUseId === 'prt-a1');
    assert.equal(explore.turns, 3);
    const running = session.agents.find((a) => a.toolUseId === 'prt-a4');
    assert.equal(running.turns, 0);
  });

  it('returns null for turns when the child session was never observed', () => {
    // Build a minimal database with a child session reference that has no
    // matching session row (unobserved child).
    const unobservedDir = makeTempDir();
    try {
      buildFixtureDb(unobservedDir, {
        projects: [{ id: 'p1', worktree: '/work' }],
        sessions: [
          {
            id: 'root-sess',
            project_id: 'p1',
            parent_id: null,
            directory: '/work',
            agent: 'build',
            model: { id: 'claude-opus', providerID: 'anthropic' },
            time_created: 1_000_000_000_000,
          },
          // Note: no child session row for 'child-unobs'
        ],
        messages: [],
        parts: [
          taskPart({
            id: 'prt-unobs',
            sessionId: 'root-sess',
            messageId: 'msg-unobs',
            status: 'completed',
            start: 1_000_000_010_000,
            end: 1_000_000_020_000,
            description: 'Task with unobserved child',
            subagentType: 'explore',
            childSessionId: 'child-unobs',
            modelId: 'gpt-4',
            providerId: 'openai',
          }),
        ],
      });

      const unobservedAdapter = new OpencodeAdapter(unobservedDir);
      const session = unobservedAdapter.session('root-sess');
      assert.ok(session);
      assert.equal(session.agentCount, 1);
      const task = session.agents[0];
      assert.equal(task.turns, null);
      assert.equal(task.model, 'gpt-4'); // from task metadata
    } finally {
      removeDir(unobservedDir);
    }
  });

  it('handles malformed JSON in child session model column gracefully', () => {
    // Build a database where a child session's model column has bad JSON.
    const malformedDir = makeTempDir();
    try {
      const { DatabaseSync } = require('node:sqlite');
      const dbPath = path.join(malformedDir, 'opencode.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
        CREATE TABLE session (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          parent_id TEXT,
          directory TEXT,
          model TEXT
        );
        CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT);
        CREATE TABLE part (
          id TEXT PRIMARY KEY,
          message_id TEXT,
          session_id TEXT,
          data TEXT
        );
      `);

      const insertProject = db.prepare(
        'INSERT INTO project (id, worktree) VALUES (?, ?)',
      );
      insertProject.run('p1', '/work');

      const insertSession = db.prepare(
        'INSERT INTO session (id, project_id, parent_id, directory, model) VALUES (?, ?, ?, ?, ?)',
      );
      // Parent session
      insertSession.run('root-sess', 'p1', null, '/work', JSON.stringify({ id: 'claude-opus' }));
      // Child session with malformed model JSON
      insertSession.run('child-malformed', 'p1', 'root-sess', '/work', '{ broken json ');

      const insertPart = db.prepare(
        'INSERT INTO part (id, message_id, session_id, data) VALUES (?, ?, ?, ?)',
      );
      insertPart.run(
        'prt-malformed',
        'msg-malformed',
        'root-sess',
        JSON.stringify({
          type: 'tool',
          tool: 'task',
          state: {
            status: 'completed',
            time: { start: 1_000_000_010_000, end: 1_000_000_020_000 },
            input: { description: 'Task with bad model JSON', subagent_type: 'explore' },
            metadata: { sessionId: 'child-malformed', model: { modelID: 'haiku', providerID: 'anthropic' } },
          },
        }),
      );
      db.close();

      const malformedAdapter = new OpencodeAdapter(malformedDir);
      const session = malformedAdapter.session('root-sess');
      assert.ok(session);
      assert.equal(session.agentCount, 1);
      const task = session.agents[0];
      // Model comes from task metadata when child session's model is malformed
      assert.equal(task.model, 'haiku');
      // Provider is not set since we couldn't parse the malformed model JSON
      assert.equal(task.extra.providerID, undefined);
    } finally {
      removeDir(malformedDir);
    }
  });

  it('groups a nested dispatch under the root session at depth 2 with its parent recorded', () => {
    const session = adapter.session(ROOT_A);
    const direct = session.agents.find((a) => a.toolUseId === 'prt-a2');
    const nested = session.agents.find((a) => a.toolUseId === 'prt-a2-1');
    assert.equal(direct.spawnDepth, 1);
    assert.equal(direct.parentAgentId, null);
    assert.equal(nested.spawnDepth, 2);
    assert.equal(nested.parentAgentId, CHILD_A2);
    assert.equal(nested.sessionId, ROOT_A);
    assert.equal(nested.model, 'haiku');
  });

  it('carries provider, variant, cost and tokens from the child session into extra', () => {
    const session = adapter.session(ROOT_A);
    const explore = session.agents.find((a) => a.toolUseId === 'prt-a1');
    assert.equal(explore.extra.providerID, 'github-copilot');
    assert.equal(explore.extra.variant, 'default');
    assert.equal(explore.extra.cost, 0.021);
    assert.deepEqual(explore.extra.tokens, {
      input: 1000,
      output: 200,
      reasoning: 50,
      cacheRead: 10,
      cacheWrite: 5,
    });
  });

  it('skips a malformed part row without losing the rest of the session', () => {
    const session = adapter.session(ROOT_A);
    // 5 real task dispatches (a1, a2, a2-1, a3, a4); the text part and the
    // broken-JSON part must not appear or crash the read.
    assert.equal(session.agentCount, 5);
  });

  it('excludes a top-level session that dispatched nothing', () => {
    const sessions = adapter.sessions();
    assert.ok(!sessions.some((s) => s.sessionId === ROOT_C));
  });

  it('sorts sessions newest first', () => {
    const sessions = adapter.sessions();
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].sessionId, ROOT_A);
    assert.equal(sessions[1].sessionId, ROOT_B);
  });

  it('resolves a session by unambiguous id prefix', () => {
    assert.equal(adapter.session('sess-aaaa').sessionId, ROOT_A);
    assert.equal(adapter.session('does-not-exist'), null);
  });

  it('takes the project name and path from the project and session rows', () => {
    const a = adapter.session(ROOT_A);
    assert.equal(a.projectPath, 'C:\\Users\\dev\\proj-a');
    assert.equal(a.project, 'proj-a');

    const b = adapter.session(ROOT_B);
    assert.equal(b.projectPath, '/home/dev/proj-b');
    assert.equal(b.project, 'proj-b'); // project.name was null: falls back to basename
  });

  it('reports unavailable, without throwing, when there is no database', () => {
    const empty = makeTempDir();
    try {
      const missing = new OpencodeAdapter(empty);
      const cap = missing.capability();
      assert.equal(cap.available, false);
      assert.ok(cap.note);
      assert.deepEqual(missing.sessions(), []);
    } finally {
      removeDir(empty);
    }
  });

  it('reports unavailable, mentioning node:sqlite, when the loader throws', () => {
    const broken = new OpencodeAdapter(dir, {
      loadSqlite: () => {
        throw new Error('node:sqlite not built in');
      },
    });
    const cap = broken.capability();
    assert.equal(cap.available, false);
    assert.match(cap.note, /node:sqlite/);
    assert.deepEqual(broken.sessions(), []);
  });

  it('reports unavailable, naming the schema, when a required table is missing', () => {
    const schemaDir = makeTempDir();
    try {
      const { DatabaseSync } = require('node:sqlite');
      const dbPath = path.join(schemaDir, 'opencode.db');
      const db = new DatabaseSync(dbPath);
      // No part table: this adapter cannot read subagent dispatches at all.
      db.exec(`
        CREATE TABLE project (id TEXT PRIMARY KEY);
        CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, model TEXT);
        CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT);
      `);
      db.close();

      const oldSchema = new OpencodeAdapter(schemaDir);
      const cap = oldSchema.capability();
      assert.equal(cap.available, false);
      assert.match(cap.note, /schema|table|column/i);
      assert.deepEqual(oldSchema.sessions(), []);
    } finally {
      removeDir(schemaDir);
    }
  });

  it('falls back to the newest session when cwd matches none of them', () => {
    const current = adapter.currentSession();
    assert.equal(current.sessionId, ROOT_A);
  });

  it('prints no ExperimentalWarning while loading and reading', () => {
    const adapterPath = path.join(repoRoot, 'src', 'adapters', 'opencode.js');
    const adapterUrl = pathToFileURL(adapterPath).href;
    const scriptPath = path.join(dir, 'check-warning.mjs');
    const dbDirLiteral = JSON.stringify(dir);
    fs.writeFileSync(
      scriptPath,
      [
        `import { OpencodeAdapter } from ${JSON.stringify(adapterUrl)};`,
        `const adapter = new OpencodeAdapter(${dbDirLiteral});`,
        'adapter.capability();',
        'adapter.sessions();',
        "console.log('ok');",
      ].join('\n'),
    );

    const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /ExperimentalWarning|experimental feature/i);
  });
});
