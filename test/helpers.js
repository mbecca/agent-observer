/** Shared fixture builders for the test suite. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
