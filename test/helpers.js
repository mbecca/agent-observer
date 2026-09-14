/** Shared fixture builders for the test suite. */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** Create a throwaway directory that the caller is responsible for removing. */
export function makeTempDir(prefix = 'agent-observer-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/**
 * Build a fake Claude Code config directory.
 *
 * `sessions` maps a session id to `{ project, cwd, agents: [...] }`, where each
 * agent is `{ id, agentType, description, model, spawnDepth, toolUseId,
 * startedAt, finishedAt, turns }`. Everything is written in the real on-disk
 * shape so the adapter is exercised end to end, not against a mock.
 */
export function writeClaudeFixture(root, sessions) {
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });

  for (const [sessionId, spec] of Object.entries(sessions)) {
    const projectDir = path.join(projectsDir, spec.project || 'C--fixture-project');
    fs.mkdirSync(projectDir, { recursive: true });

    if (spec.cwd) {
      // The adapter reads `cwd` out of the session transcript, so give it one
      // with a leading record that has no cwd, as real transcripts often do.
      const transcript = [
        JSON.stringify({ type: 'summary', summary: 'fixture' }),
        JSON.stringify({ type: 'user', cwd: spec.cwd, timestamp: '2026-01-01T10:00:00.000Z' }),
      ].join('\n');
      fs.writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), transcript + '\n');
    }

    const subagentsDir = path.join(projectDir, sessionId, 'subagents');
    fs.mkdirSync(subagentsDir, { recursive: true });

    for (const agent of spec.agents || []) {
      const base = path.join(subagentsDir, agent.id);
      fs.writeFileSync(
        `${base}.meta.json`,
        JSON.stringify({
          agentType: agent.agentType ?? 'general-purpose',
          description: agent.description ?? null,
          toolUseId: agent.toolUseId ?? `toolu_${agent.id}`,
          spawnDepth: agent.spawnDepth ?? 1,
          model: agent.model ?? 'sonnet',
        }),
      );

      if (agent.startedAt) {
        const turns = agent.turns ?? 2;
        const lines = [];
        for (let index = 0; index < turns; index += 1) {
          const isLast = index === turns - 1;
          lines.push(
            JSON.stringify({
              type: index === 0 ? 'user' : 'assistant',
              timestamp: isLast ? agent.finishedAt || agent.startedAt : agent.startedAt,
            }),
          );
        }
        fs.writeFileSync(`${base}.jsonl`, lines.join('\n') + '\n');
      }
    }
  }
  return root;
}

/** Write newline-delimited common-format events for the generic adapter. */
export function writeEventsFixture(file, events) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  return file;
}

/** Run a block with temporary environment variables, always restoring them. */
export function withEnv(vars, block) {
  const saved = new Map();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === null || value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return block();
  } finally {
    for (const [key, value] of saved.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Collect everything the CLI writes instead of sending it to the terminal. */
export function captureIo() {
  const out = [];
  const errors = [];
  return {
    io: {
      write: (text) => out.push(text),
      warn: (text) => errors.push(text),
    },
    get stdout() {
      return out.join('\n');
    },
    get stderr() {
      return errors.join('\n');
    },
  };
}

/** Node 18 and 20 have no node:sqlite; OpenCode fixtures skip there. */
export function hasNodeSqlite() {
  try {
    require('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a real opencode.db in `dir` with exactly the tables and columns the
 * OpenCode adapter reads, inserting rows shaped like real OpenCode data.
 */
export function writeOpencodeFixture(dir, { projects = [], sessions = [], messages = [], parts = [] }) {
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = path.join(dir, 'opencode.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      worktree TEXT,
      name TEXT,
      time_created INTEGER,
      time_updated INTEGER
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      parent_id TEXT,
      directory TEXT,
      title TEXT,
      agent TEXT,
      model TEXT,
      cost REAL,
      tokens_input INTEGER,
      tokens_output INTEGER,
      tokens_reasoning INTEGER,
      tokens_cache_read INTEGER,
      tokens_cache_write INTEGER,
      time_created INTEGER,
      time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      session_id TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT
    );
  `);

  const insertProject = db.prepare(
    'INSERT INTO project (id, worktree, name, time_created, time_updated) VALUES (?, ?, ?, ?, ?)',
  );
  for (const p of projects) {
    insertProject.run(p.id, p.worktree ?? null, p.name ?? null, p.time_created ?? null, p.time_updated ?? null);
  }

  const insertSession = db.prepare(
    `INSERT INTO session
      (id, project_id, parent_id, directory, title, agent, model, cost,
       tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
       time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const s of sessions) {
    insertSession.run(
      s.id,
      s.project_id ?? null,
      s.parent_id ?? null,
      s.directory ?? null,
      s.title ?? null,
      s.agent ?? null,
      s.model ? JSON.stringify(s.model) : null,
      s.cost ?? null,
      s.tokens_input ?? null,
      s.tokens_output ?? null,
      s.tokens_reasoning ?? null,
      s.tokens_cache_read ?? null,
      s.tokens_cache_write ?? null,
      s.time_created ?? null,
      s.time_updated ?? null,
    );
  }

  const insertMessage = db.prepare(
    'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
  );
  for (const m of messages) {
    insertMessage.run(m.id, m.session_id, m.time_created ?? null, m.time_updated ?? null, m.data ? JSON.stringify(m.data) : null);
  }

  const insertPart = db.prepare(
    'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const p of parts) {
    const dataText = typeof p.data === 'string' ? p.data : JSON.stringify(p.data);
    insertPart.run(p.id, p.message_id ?? null, p.session_id, p.time_created ?? null, p.time_updated ?? null, dataText);
  }

  db.close();
  return dbPath;
}

export function opencodeTaskPart({ id, sessionId, messageId, status, start, end, description, subagentType, childSessionId, modelId, providerId }) {
  const state = {
    status,
    time: end !== undefined ? { start, end } : { start },
    input: { description, prompt: 'ignored prompt text', subagent_type: subagentType },
    metadata: { sessionId: childSessionId, model: { modelID: modelId, providerID: providerId } },
  };
  return { id, message_id: messageId, session_id: sessionId, data: { type: 'tool', tool: 'task', state } };
}
