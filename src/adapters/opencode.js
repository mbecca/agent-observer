/**
 * OpenCode adapter.
 *
 * OpenCode stores everything in a single SQLite database (`opencode.db`, WAL
 * mode) under its data directory: a `session` row per session (top-level or
 * nested), a `message` row per turn, and a `part` row per piece of a message.
 * A subagent dispatch is a `part` whose `data` is a completed/errored/running
 * `task` tool call; its `metadata.sessionId` names the child session that
 * actually ran, and that child session's own `model`, `cost` and token counts
 * are the ground truth for what happened, independent of what the dispatching
 * session asked for.
 *
 * `node:sqlite` is still experimental (absent on Node 18 and 20, and noisy
 * about it on the versions that have it), so this adapter loads it lazily and
 * swallows only its own warning; everything else about the module works the
 * same as any other adapter.
 */

import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { AgentRun, Capability, STATUS_COMPLETED, STATUS_SPAWNED, Session } from '../core/model.js';
import { baseName, isFile } from '../core/util.js';
import { normaliseModel } from './models.js';

export const PROVIDER = 'opencode';

const DB_FILE = 'opencode.db';

/**
 * OpenCode sets no session variable itself. agent-observer's OpenCode plugin
 * exports this one to shell commands from the session they run in.
 */
export const SESSION_ENV_VAR = 'OPENCODE_SESSION_ID';

/** Node emits this once per process the first time node:sqlite is touched. */
const EXPERIMENTAL_WARNING_RE = /SQLite is an experimental feature/i;

/**
 * Tables and the columns this adapter actually reads from each. Used only to
 * recognise the schema; unlisted columns (cost, tokens, title, ...) are read
 * with `SELECT *` and treated as absent when a row does not have them, so an
 * older or newer OpenCode does not need every column to match exactly.
 */
const REQUIRED_SCHEMA = {
  project: ['id'],
  session: ['id', 'parent_id', 'directory', 'model'],
  message: ['id', 'session_id'],
  part: ['id', 'session_id', 'data'],
};

/** `$XDG_DATA_HOME/opencode`, else `~/.local/share/opencode`. */
export function defaultRoot() {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return path.join(xdg, 'opencode');
  return path.join(os.homedir(), '.local', 'share', 'opencode');
}

/**
 * Load node:sqlite, dropping only its own experimental-feature warning.
 *
 * Restores `process.emitWarning` in a `finally` so a warning from anything
 * else loaded in the same tick is never swallowed.
 */
export function defaultLoadSqlite() {
  const require = createRequire(import.meta.url);
  const original = process.emitWarning;
  process.emitWarning = function emitWarning(warning, ...rest) {
    const message = typeof warning === 'string' ? warning : warning && warning.message;
    if (message && EXPERIMENTAL_WARNING_RE.test(message)) return undefined;
    return original.call(process, warning, ...rest);
  };
  try {
    return require('node:sqlite');
  } finally {
    process.emitWarning = original;
  }
}

/** Reads subagent dispatches recorded by OpenCode. */
export class OpencodeAdapter {
  static adapterName = 'opencode';
  static displayName = 'OpenCode';

  constructor(root, options = {}) {
    this.name = OpencodeAdapter.adapterName;
    this.displayName = OpencodeAdapter.displayName;
    this.root = root || defaultRoot();
    this.loadSqlite = options.loadSqlite || defaultLoadSqlite;
  }

  get dbPath() {
    return path.join(this.root, DB_FILE);
  }

  /** Open the database read-only, or report why that was not possible. */
  #open() {
    if (!isFile(this.dbPath)) return { db: null, problem: 'missing-file' };

    let DatabaseSync;
    try {
      ({ DatabaseSync } = this.loadSqlite());
    } catch {
      return { db: null, problem: 'no-sqlite' };
    }

    try {
      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      return { db, problem: null };
    } catch {
      return { db: null, problem: 'open-failed' };
    }
  }

  capability() {
    const { db, problem } = this.#open();

    if (problem === 'missing-file') {
      return new Capability({
        provider: this.name,
        displayName: this.displayName,
        available: false,
        root: this.root,
        observes: [],
        note: `No OpenCode database found at ${this.dbPath}.`,
      });
    }
    if (problem === 'no-sqlite') {
      return new Capability({
        provider: this.name,
        displayName: this.displayName,
        available: false,
        root: this.root,
        observes: [],
        note:
          'Reading OpenCode data needs a Node version that ships node:sqlite ' +
          '(Node 22 or newer). This Node does not have it.',
      });
    }
    if (problem === 'open-failed') {
      return new Capability({
        provider: this.name,
        displayName: this.displayName,
        available: false,
        root: this.root,
        observes: [],
        note: `Could not open the OpenCode database at ${this.dbPath}.`,
      });
    }

    try {
      if (!schemaRecognised(db)) {
        return new Capability({
          provider: this.name,
          displayName: this.displayName,
          available: false,
          root: this.root,
          observes: [],
          note:
            `The database at ${this.dbPath} does not have the tables and columns ` +
            'this adapter expects. It may be from a different OpenCode version.',
        });
      }

      return new Capability({
        provider: this.name,
        displayName: this.displayName,
        available: true,
        root: this.root,
        observes: [
          'subagent model',
          'subagent type',
          'task description',
          'status',
          'start and end time',
          'turn count',
          'tokens and cost (in extra)',
        ],
        missing: [],
        note: null,
      });
    } finally {
      db.close();
    }
  }

  isAvailable() {
    return this.capability().available;
  }

  /** Every top-level session that dispatched at least one task, newest first. */
  sessions() {
    const { db, problem } = this.#open();
    if (problem) return [];

    try {
      if (!schemaRecognised(db)) return [];
      return readSessions(db, this.dbPath).sort((a, b) => sessionStamp(b) - sessionStamp(a));
    } finally {
      db.close();
    }
  }

  session(sessionId) {
    const all = this.sessions();
    const exact = all.find((s) => s.sessionId === sessionId);
    if (exact) return exact;
    const prefixed = all.filter((s) => s.sessionId.startsWith(sessionId));
    return prefixed.length === 1 ? prefixed[0] : null;
  }

  /**
   * The top-level session the environment names, if any.
   *
   * A shell command run by a subagent carries the subagent's own session id,
   * so a known id is resolved to its top-level session. An id the database
   * does not know is returned as given, so the caller can tell the user it
   * had to fall back.
   */
  currentSessionId() {
    const raw = (process.env[SESSION_ENV_VAR] || '').trim();
    if (!raw) return null;
    const top = this.#topLevelSession(raw);
    return top ? top.sessionId : raw;
  }

  /**
   * The session named by the environment, else the newest one under cwd, else
   * the newest one.
   *
   * A named session that dispatched nothing comes back empty: "this session
   * used no subagents" is the true answer, and another session's subagents
   * would not be.
   */
  currentSession() {
    const raw = (process.env[SESSION_ENV_VAR] || '').trim();
    const all = this.sessions();

    if (raw) {
      const top = this.#topLevelSession(raw);
      if (top) return all.find((s) => s.sessionId === top.sessionId) || top;
    }

    if (!all.length) return null;

    const cwd = path.resolve(process.cwd()).toLowerCase();
    const local = all.find(
      (s) => s.projectPath && path.resolve(s.projectPath).toLowerCase() === cwd,
    );
    return local || all[0];
  }

  /**
   * Follow `parent_id` up from `sessionId` to its top-level session, returned
   * as a Session with no agents. Null when the id, or any ancestor, is not in
   * the database, when the chain loops, or when the database cannot be read.
   */
  #topLevelSession(sessionId) {
    const { db, problem } = this.#open();
    if (problem) return null;

    try {
      if (!schemaRecognised(db)) return null;
      const byId = db.prepare('SELECT * FROM session WHERE id = ?');
      const seen = new Set();
      let row = byId.get(sessionId);
      while (row && row.parent_id && !seen.has(row.id)) {
        seen.add(row.id);
        row = byId.get(row.parent_id);
      }
      if (!row || row.parent_id) return null;

      const project = row.project_id
        ? db.prepare('SELECT * FROM project WHERE id = ?').get(row.project_id)
        : null;
      const projectPath = row.directory || (project && project.worktree) || null;

      return new Session({
        provider: PROVIDER,
        sessionId: row.id,
        project: (project && project.name) || (projectPath ? baseName(projectPath) : null),
        projectPath,
        startedAt: asDate(row.time_created),
        updatedAt: asDate(row.time_updated),
        agents: [],
        sourcePath: this.dbPath,
      });
    } catch {
      return null;
    } finally {
      db.close();
    }
  }
}

/** True when every required table has every column this adapter reads. */
function schemaRecognised(db) {
  for (const [table, columns] of Object.entries(REQUIRED_SCHEMA)) {
    if (!hasTable(db, table)) return false;
    const present = tableColumns(db, table);
    if (!present) return false;
    for (const column of columns) {
      if (!present.has(column)) return false;
    }
  }
  return true;
}

function hasTable(db, table) {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    return Boolean(row);
  } catch {
    return false;
  }
}

function tableColumns(db, table) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return new Set(rows.map((row) => row.name));
  } catch {
    return null;
  }
}

/** Parse a JSON column, returning null instead of throwing on a bad row. */
function parseJsonColumn(value) {
  if (value === null || value === undefined) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function asDate(epochMs) {
  if (epochMs === null || epochMs === undefined) return null;
  const date = new Date(Number(epochMs));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Read every top-level session that (directly or through nesting) dispatched a task. */
function readSessions(db, dbPath) {
  const projectsById = new Map();
  for (const row of db.prepare('SELECT * FROM project').all()) {
    projectsById.set(row.id, row);
  }

  const sessionsById = new Map();
  for (const row of db.prepare('SELECT * FROM session').all()) {
    sessionsById.set(row.id, row);
  }

  const turnsBySession = new Map();
  for (const row of db.prepare('SELECT session_id, COUNT(*) AS turns FROM message GROUP BY session_id').all()) {
    turnsBySession.set(row.session_id, Number(row.turns));
  }

  const taskPartsBySession = new Map();
  for (const row of db.prepare('SELECT * FROM part').all()) {
    const data = parseJsonColumn(row.data);
    if (!data || data.type !== 'tool' || data.tool !== 'task') continue;
    const list = taskPartsBySession.get(row.session_id) || [];
    list.push({ part: row, data });
    taskPartsBySession.set(row.session_id, list);
  }

  const sessions = [];
  for (const root of sessionsById.values()) {
    if (root.parent_id) continue; // only top-level sessions become a Session

    const agents = [];
    const seen = new Set();
    collectTasks(root.id, 0, null, {
      rootId: root.id,
      sessionsById,
      taskPartsBySession,
      turnsBySession,
      dbPath,
      agents,
      seen,
    });
    if (!agents.length) continue;

    const project = root.project_id ? projectsById.get(root.project_id) : null;
    const projectPath = root.directory || (project && project.worktree) || null;

    const starts = agents.map((a) => a.startedAt).filter(Boolean);
    const ends = agents.map((a) => a.finishedAt || a.startedAt).filter(Boolean);

    sessions.push(
      new Session({
        provider: PROVIDER,
        sessionId: root.id,
        project: (project && project.name) || (projectPath ? baseName(projectPath) : null),
        projectPath,
        startedAt: starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : asDate(root.time_created),
        updatedAt: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : asDate(root.time_updated),
        agents,
        sourcePath: dbPath,
      }),
    );
  }
  return sessions;
}

/**
 * Walk the dispatch tree starting at `sessionId`, which is at dispatch depth
 * `depth` (0 for the root session itself). Every task part found in it becomes
 * an AgentRun at `depth + 1`; when that task's child session itself dispatched
 * further tasks, recurse into it at `depth + 1` so those land at `depth + 2`,
 * and so on. `seen` guards against a cycle in malformed data.
 */
function collectTasks(sessionId, depth, dispatchingAgentId, ctx) {
  if (ctx.seen.has(sessionId)) return;
  ctx.seen.add(sessionId);

  const parts = ctx.taskPartsBySession.get(sessionId) || [];
  for (const { part, data } of parts) {
    const state = data.state || {};
    const input = state.input || {};
    const metadata = state.metadata || {};
    const time = state.time || {};

    const childSessionId = metadata.sessionId || null;
    const child = childSessionId ? ctx.sessionsById.get(childSessionId) : null;
    const childModel = child ? parseJsonColumn(child.model) : null;

    const startedAt = asDate(time.start);
    const finishedAt = asDate(time.end);

    const extra = {};
    if (child) {
      if (childModel && childModel.providerID !== undefined) extra.providerID = childModel.providerID;
      if (childModel && childModel.variant !== undefined) extra.variant = childModel.variant;
      if (child.cost !== undefined && child.cost !== null) extra.cost = child.cost;
      const tokens = {};
      if (child.tokens_input !== undefined && child.tokens_input !== null) tokens.input = child.tokens_input;
      if (child.tokens_output !== undefined && child.tokens_output !== null) tokens.output = child.tokens_output;
      if (child.tokens_reasoning !== undefined && child.tokens_reasoning !== null) tokens.reasoning = child.tokens_reasoning;
      if (child.tokens_cache_read !== undefined && child.tokens_cache_read !== null) tokens.cacheRead = child.tokens_cache_read;
      if (child.tokens_cache_write !== undefined && child.tokens_cache_write !== null) tokens.cacheWrite = child.tokens_cache_write;
      if (Object.keys(tokens).length) extra.tokens = tokens;
    }
    if (state.status === 'error') extra.outcome = 'error';

    const modelId = metadata.model && metadata.model.modelID ? metadata.model.modelID : childModel && childModel.id;

    ctx.agents.push(
      new AgentRun({
        provider: PROVIDER,
        sessionId: ctx.rootId,
        agentId: childSessionId || part.id,
        parentAgentId: dispatchingAgentId,
        agentType: input.subagent_type ?? (child ? child.agent ?? null : null),
        model: normaliseModel(modelId),
        task: input.description ?? null,
        status: finishedAt ? STATUS_COMPLETED : STATUS_SPAWNED,
        spawnDepth: depth + 1,
        startedAt,
        finishedAt,
        turns: childSessionId && ctx.sessionsById.has(childSessionId) ? ctx.turnsBySession.get(childSessionId) ?? 0 : null,
        toolUseId: part.id,
        sourcePath: ctx.dbPath,
        extra,
      }),
    );

    if (childSessionId && ctx.sessionsById.has(childSessionId)) {
      collectTasks(childSessionId, depth + 1, childSessionId, ctx);
    }
  }
}

function sessionStamp(session) {
  const stamp = session.updatedAt || session.startedAt;
  return stamp ? stamp.getTime() : 0;
}
