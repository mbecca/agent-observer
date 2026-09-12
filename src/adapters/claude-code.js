/**
 * Claude Code adapter.
 *
 * Claude Code records every dispatched subagent on disk:
 *
 *   <config>/projects/<encoded-project-path>/
 *     <session-id>.jsonl              main session transcript
 *     <session-id>/
 *       subagents/
 *         agent-<id>.meta.json        {agentType, description, toolUseId,
 *                                      spawnDepth, model}
 *         agent-<id>.jsonl            that subagent's own transcript
 *
 * The .meta.json is the ground truth for which model actually ran each task,
 * which is the whole point: it does not depend on what the orchestrator claims
 * it did. Timing comes from the sibling transcript's first and last timestamp,
 * falling back to file modification times.
 */

import os from 'node:os';
import path from 'node:path';

import {
  AgentRun,
  Capability,
  STATUS_COMPLETED,
  STATUS_SPAWNED,
  Session,
  parseTimestamp,
} from '../core/model.js';
import {
  baseName,
  countLines,
  firstLastLine,
  homeDir,
  isDir,
  isFile,
  listDirs,
  mtime,
  readHead,
  readJson,
  walkFiles,
} from '../core/util.js';

export const PROVIDER = 'claude-code';

/** Set by Claude Code inside a running session. Checked in order. */
export const SESSION_ENV_VARS = ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_RE = /"timestamp"\s*:\s*"([^"]+)"/;
const CWD_RE = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const META_SUFFIX = '.meta.json';
/** How much of a session transcript to scan for the project's `cwd`. */
const CWD_WINDOW_BYTES = 65536;
const KNOWN_META_KEYS = new Set(['agentType', 'description', 'toolUseId', 'spawnDepth', 'model']);

/** Claude Code's config directory, honouring CLAUDE_CONFIG_DIR. */
export function defaultRoot() {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override) return expandHome(override);
  return path.join(homeDir(), '.claude');
}

function expandHome(target) {
  if (target.startsWith('~')) return path.join(os.homedir(), target.slice(1));
  return target;
}

/** Reads subagent metadata written by Claude Code. */
export class ClaudeCodeAdapter {
  static adapterName = 'claude-code';
  static displayName = 'Claude Code';

  constructor(root) {
    this.name = ClaudeCodeAdapter.adapterName;
    this.displayName = ClaudeCodeAdapter.displayName;
    this.root = root ? expandHome(root) : defaultRoot();
  }

  get projectsDir() {
    return path.join(this.root, 'projects');
  }

  capability() {
    const available = isDir(this.projectsDir);
    return new Capability({
      provider: this.name,
      displayName: this.displayName,
      available,
      root: available ? this.projectsDir : this.root,
      observes: available
        ? [
            'subagent model',
            'subagent type',
            'task description',
            'spawn depth',
            'start and end time',
            'turn count',
          ]
        : [],
      missing: ['token usage', 'cost', 'explicit parent agent id'],
      note: available
        ? null
        : 'No projects directory found. Set CLAUDE_CONFIG_DIR if Claude Code stores ' +
          'its data elsewhere.',
    });
  }

  isAvailable() {
    return this.capability().available;
  }

  /** Every session that dispatched at least one subagent, newest first. */
  sessions() {
    if (!isDir(this.projectsDir)) return [];
    const found = [];
    for (const project of listDirs(this.projectsDir)) {
      found.push(...this.#sessionsInProject(project.path, project.name));
    }
    return found.sort((a, b) => sessionStamp(b) - sessionStamp(a));
  }

  #sessionsInProject(projectPath, encodedName) {
    const sessions = [];
    let resolvedCwd;

    for (const entry of listDirs(projectPath)) {
      const subagentsDir = path.join(entry.path, 'subagents');
      if (!isDir(subagentsDir)) continue;

      const sessionId = entry.name;
      if (resolvedCwd === undefined) {
        resolvedCwd = readCwd(path.join(projectPath, `${sessionId}.jsonl`));
      }

      const agents = this.#readSubagents(subagentsDir, sessionId);
      if (!agents.length) continue;

      const starts = agents.map((a) => a.startedAt).filter(Boolean);
      const ends = agents.map((a) => a.finishedAt || a.startedAt).filter(Boolean);
      const projectPathValue = resolvedCwd || decodeProjectDir(encodedName);

      sessions.push(
        new Session({
          provider: this.name,
          sessionId,
          project: projectLabel(projectPathValue, encodedName),
          projectPath: projectPathValue,
          startedAt: starts.length ? new Date(Math.min(...starts)) : mtime(entry.path),
          updatedAt: ends.length ? new Date(Math.max(...ends)) : mtime(entry.path),
          agents,
          sourcePath: entry.path,
        }),
      );
    }
    return sessions;
  }

  /** Walk a subagents/ tree, tolerating nesting for deeper spawns. */
  #readSubagents(subagentsDir, sessionId) {
    return walkFiles(subagentsDir, (name) => name.endsWith(META_SUFFIX))
      .map((file) => this.#readMeta(file, sessionId))
      .filter(Boolean);
  }

  #readMeta(metaPath, sessionId) {
    const meta = readJson(metaPath);
    if (!meta) return null;

    const agentId = path.basename(metaPath).slice(0, -META_SUFFIX.length);
    const transcript = metaPath.slice(0, -META_SUFFIX.length) + '.jsonl';
    const { startedAt, finishedAt, turns } = transcriptTiming(transcript);

    return new AgentRun({
      provider: this.name,
      sessionId,
      agentId,
      agentType: meta.agentType ?? null,
      model: normaliseModel(meta.model),
      task: meta.description ?? null,
      status: finishedAt ? STATUS_COMPLETED : STATUS_SPAWNED,
      spawnDepth: meta.spawnDepth ?? null,
      startedAt: startedAt || mtime(metaPath),
      finishedAt,
      turns,
      toolUseId: meta.toolUseId ?? null,
      sourcePath: metaPath,
      extra: extraFields(meta),
    });
  }

  session(sessionId) {
    const all = this.sessions();
    const exact = all.find((s) => s.sessionId === sessionId);
    if (exact) return exact;
    const prefixed = all.filter((s) => s.sessionId.startsWith(sessionId));
    return prefixed.length === 1 ? prefixed[0] : null;
  }

  /** The id of the session we are running inside, if any. */
  currentSessionId() {
    for (const name of SESSION_ENV_VARS) {
      const value = (process.env[name] || '').trim();
      if (UUID_RE.test(value)) return value;
    }
    return null;
  }

  /**
   * The running session, else the newest one under the current directory.
   *
   * Inside Claude Code the environment names the session outright. Run from a
   * plain shell there is no such signal, so fall back to the most recently
   * updated session whose project matches cwd, and only then to the newest
   * session anywhere.
   */
  currentSession() {
    const all = this.sessions();
    if (!all.length) return null;

    const sessionId = this.currentSessionId();
    if (sessionId) {
      const match = all.find((s) => s.sessionId === sessionId);
      if (match) return match;
    }

    const cwd = path.resolve(process.cwd()).toLowerCase();
    const local = all.find(
      (s) => s.projectPath && path.resolve(s.projectPath).toLowerCase() === cwd,
    );
    return local || all[0];
  }
}

/** Keep unrecognised metadata so new Claude Code fields are not lost. */
function extraFields(meta) {
  const extra = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!KNOWN_META_KEYS.has(key)) extra[key] = value;
  }
  return extra;
}

/**
 * Trim a model id down to its family when it is a full API id, so that
 * `claude-haiku-4-5-20251001` and a bare `haiku` group together in reports.
 * `inherit` is left as-is because it is a real, distinct answer.
 */
export function normaliseModel(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const lowered = text.toLowerCase();
  for (const family of ['haiku', 'sonnet', 'opus', 'fable']) {
    if (lowered.includes(family)) return family;
  }
  return text;
}

/** First/last timestamp and turn count from a subagent transcript. */
function transcriptTiming(file) {
  if (!isFile(file)) return { startedAt: null, finishedAt: null, turns: null };

  const [firstLine, lastLine] = firstLastLine(file);
  const startedAt = extractTimestamp(firstLine);
  let finishedAt = extractTimestamp(lastLine) || mtime(file);
  if (startedAt && finishedAt && finishedAt < startedAt) finishedAt = mtime(file);
  return { startedAt, finishedAt, turns: countLines(file) };
}

/**
 * Pull a timestamp out of a transcript line without full JSON parsing.
 * Transcript lines are large, and a regex is immune to a final line that is
 * still being written.
 */
function extractTimestamp(line) {
  if (!line) return null;
  const match = TIMESTAMP_RE.exec(line);
  return match ? parseTimestamp(match[1]) : null;
}

/**
 * The project's real path, taken from the session transcript's head.
 *
 * Scans a window rather than only the first line: a transcript often opens with
 * a summary or metadata record that carries no `cwd`, and the field appears a
 * few records in. This is the only reliable source, because the directory name
 * encoding is lossy.
 */
function readCwd(transcriptPath) {
  if (!isFile(transcriptPath)) return null;
  const head = readHead(transcriptPath, CWD_WINDOW_BYTES);
  if (!head) return null;
  const match = CWD_RE.exec(head);
  if (!match) return null;
  try {
    const value = JSON.parse('"' + match[1] + '"');
    return value && typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort reversal of Claude Code's project directory encoding.
 *
 * Path separators and the drive colon are all flattened to `-`, so the encoding
 * is lossy: a real hyphen in a folder name is indistinguishable from a
 * separator. Used only when the session transcript does not give us cwd.
 */
export function decodeProjectDir(encoded) {
  if (!encoded) return encoded;
  const drive = /^([A-Za-z])--/.exec(encoded);
  if (drive) {
    const rest = encoded.slice(drive[0].length).split('-').join(path.sep);
    return `${drive[1].toUpperCase()}:${path.sep}${rest}`;
  }
  if (encoded.startsWith('-')) return '/' + encoded.slice(1).split('-').join('/');
  return encoded;
}

/** Short, recognisable project name for table columns. */
function projectLabel(projectPath, encodedName) {
  if (projectPath) {
    // The recorded cwd may use the other platform's separator, so this cannot
    // use path.basename.
    const base = baseName(projectPath);
    if (base) return base;
  }
  const parts = encodedName.split('-').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : encodedName;
}

function sessionStamp(session) {
  const stamp = session.updatedAt || session.startedAt;
  return stamp ? stamp.getTime() : 0;
}
