/**
 * Generic adapter for any agent that emits the common event format.
 *
 * This is the interop path: an agent, or a wrapper around one, writes one JSON
 * object per line in the schema documented in docs/event-format.md, and
 * agent-observer renders it with every format the Claude Code adapter gets.
 *
 * The search path is $AGENT_OBSERVER_EVENTS when set, otherwise
 * ~/.agent-observer/events. A single file works as well as a directory.
 */

import os from 'node:os';
import path from 'node:path';

import { AgentRun, Capability, Session } from '../core/model.js';
import { homeDir, isDir, isFile, mtime, readJsonl, walkFiles } from '../core/util.js';

export const ENV_VAR = 'AGENT_OBSERVER_EVENTS';

export function defaultEventsPath() {
  const override = process.env[ENV_VAR];
  if (override) return override.startsWith('~') ? path.join(os.homedir(), override.slice(1)) : override;
  return path.join(homeDir(), '.agent-observer', 'events');
}

/** Reads newline-delimited common-format events from disk. */
export class GenericAdapter {
  static adapterName = 'generic';
  static displayName = 'Generic (common event format)';

  constructor(eventsPath) {
    this.name = GenericAdapter.adapterName;
    this.displayName = GenericAdapter.displayName;
    this.path = eventsPath || defaultEventsPath();
  }

  capability() {
    const available = isFile(this.path) || isDir(this.path);
    return new Capability({
      provider: this.name,
      displayName: this.displayName,
      available,
      root: this.path,
      observes: available ? ['whatever the emitting agent records'] : [],
      missing: [],
      note:
        `Point ${ENV_VAR} at a .jsonl file or a directory of them to ingest events ` +
        'from any agent.',
    });
  }

  isAvailable() {
    return this.capability().available;
  }

  #eventFiles() {
    if (isFile(this.path)) return [this.path];
    if (!isDir(this.path)) return [];
    return walkFiles(this.path, (name) => name.endsWith('.jsonl') || name.endsWith('.ndjson')).sort();
  }

  sessions() {
    const grouped = new Map();

    for (const file of this.#eventFiles()) {
      for (const record of readJsonl(file)) {
        const run = AgentRun.fromEvent(record);
        if (!run.sourcePath) run.sourcePath = file;

        let session = grouped.get(run.sessionId);
        if (!session) {
          session = new Session({
            provider: run.provider || this.name,
            sessionId: run.sessionId,
            project: record.project ?? null,
            projectPath: record.project_path ?? null,
            sourcePath: file,
          });
          grouped.set(run.sessionId, session);
        }
        session.agents.push(run);
      }
    }

    const result = [...grouped.values()];
    for (const session of result) {
      const starts = session.agents.map((a) => a.startedAt).filter(Boolean);
      const ends = session.agents.map((a) => a.finishedAt || a.startedAt).filter(Boolean);
      session.startedAt = starts.length
        ? new Date(Math.min(...starts))
        : mtime(session.sourcePath || '');
      session.updatedAt = ends.length ? new Date(Math.max(...ends)) : session.startedAt;
    }

    return result.sort(
      (a, b) =>
        (b.updatedAt ? b.updatedAt.getTime() : 0) - (a.updatedAt ? a.updatedAt.getTime() : 0),
    );
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
