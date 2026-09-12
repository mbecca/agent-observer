/**
 * OpenAI Codex CLI adapter.
 *
 * Codex stores session rollouts under ~/.codex/sessions as newline-delimited
 * JSON. Those rollouts record the session's own model, but they do not carry
 * per-subagent metadata the way Claude Code's .meta.json files do.
 *
 * So this adapter reports the sessions it can see and states plainly, through
 * `capability()`, that per-subagent model attribution is unavailable. It does
 * not infer subagents from tool calls: an adapter that cannot observe something
 * must say so rather than manufacture it.
 */

import os from 'node:os';
import path from 'node:path';

import { AgentRun, Capability, STATUS_UNKNOWN, Session, parseTimestamp } from '../core/model.js';
import { baseName, homeDir, isDir, mtime, readJsonl, walkFiles } from '../core/util.js';

export const PROVIDER = 'codex';

export function defaultRoot() {
  const override = process.env.CODEX_HOME;
  if (override) return override.startsWith('~') ? path.join(os.homedir(), override.slice(1)) : override;
  return path.join(homeDir(), '.codex');
}

/** Best-effort read of Codex CLI session rollouts. */
export class CodexAdapter {
  static adapterName = 'codex';
  static displayName = 'OpenAI Codex CLI';

  constructor(root) {
    this.name = CodexAdapter.adapterName;
    this.displayName = CodexAdapter.displayName;
    this.root = root || defaultRoot();
  }

  get sessionsDir() {
    return path.join(this.root, 'sessions');
  }

  capability() {
    const available = isDir(this.sessionsDir);
    return new Capability({
      provider: this.name,
      displayName: this.displayName,
      available,
      root: available ? this.sessionsDir : this.root,
      observes: available ? ['session id', 'session model', 'start time'] : [],
      missing: ['per-subagent model', 'subagent task description', 'spawn depth'],
      note:
        'Codex rollouts do not record per-subagent metadata, so model routing ' +
        'inside a session cannot be attributed. Emit common-format events and use ' +
        'the generic adapter if you need that detail.',
    });
  }

  isAvailable() {
    return this.capability().available;
  }

  #rolloutFiles() {
    if (!isDir(this.sessionsDir)) return [];
    return walkFiles(this.sessionsDir, (name) => name.endsWith('.jsonl')).sort();
  }

  sessions() {
    return this.#rolloutFiles()
      .map((file) => this.#readRollout(file))
      .filter(Boolean)
      .sort(
        (a, b) =>
          (b.updatedAt ? b.updatedAt.getTime() : 0) - (a.updatedAt ? a.updatedAt.getTime() : 0),
      );
  }

  #readRollout(file) {
    let meta = null;
    for (const record of readJsonl(file)) {
      const payload =
        record.payload && typeof record.payload === 'object' ? record.payload : record;
      if (payload.id || payload.cwd || payload.model) {
        meta = payload;
        break;
      }
    }
    if (!meta) return null;

    const sessionId = String(meta.id || path.basename(file).replace(/\.jsonl$/, ''));
    const startedAt = parseTimestamp(meta.timestamp) || mtime(file);
    const agents = [];

    // The session's own model is the one thing Codex does record.
    if (meta.model) {
      agents.push(
        new AgentRun({
          provider: this.name,
          sessionId,
          agentId: 'root',
          agentType: 'session',
          model: String(meta.model),
          role: 'unknown',
          task: meta.instructions || 'Codex session',
          status: STATUS_UNKNOWN,
          spawnDepth: 0,
          startedAt,
          finishedAt: mtime(file),
          sourcePath: file,
        }),
      );
    }

    return new Session({
      provider: this.name,
      sessionId,
      project: meta.cwd ? baseName(meta.cwd) : null,
      projectPath: meta.cwd ?? null,
      startedAt,
      updatedAt: mtime(file),
      agents,
      sourcePath: file,
    });
  }

  session(sessionId) {
    const all = this.sessions();
    const exact = all.find((s) => s.sessionId === sessionId);
    if (exact) return exact;
    const prefixed = all.filter((s) => s.sessionId.startsWith(sessionId));
    return prefixed.length === 1 ? prefixed[0] : null;
  }

  currentSession() {
    const all = this.sessions();
    return all.length ? all[0] : null;
  }
}
