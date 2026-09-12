/**
 * Agent-agnostic data model.
 *
 * Nothing in this module knows what Claude, Codex or any other agent is.
 * Adapters translate their own on-disk formats into these structures, and every
 * renderer and command works purely against them.
 */

/**
 * Version of the common event schema emitted by `export` and `--format json`.
 * Bump the minor when adding fields, the major when removing or renaming any.
 */
export const EVENT_SCHEMA_VERSION = '1.0';

/**
 * Roles the core recognises. Adapters may set a role explicitly; when they do
 * not, `inferRole` guesses one from the task description.
 */
export const ROLES = [
  'implement',
  'review',
  'fix',
  'test',
  'plan',
  'explore',
  'document',
  'unknown',
];

export const STATUS_SPAWNED = 'spawned';
export const STATUS_COMPLETED = 'completed';
export const STATUS_UNKNOWN = 'unknown';

/**
 * Ordered role patterns. Order matters: "Fix final-review findings" is a fix,
 * not a review, and the leading verb settles it.
 */
const ROLE_PATTERNS = [
  ['review', /\b(re-?review|reviewing|review|audit|critique|inspect)\b/],
  ['fix', /\b(fix|fixes|fixing|repair|resolve|address|remediate)\b/],
  ['test', /\b(test|tests|testing|verify|verification|validate)\b/],
  ['implement', /\b(implement|implementing|build|create|add|write|port|refactor|apply)\b/],
  ['plan', /\b(plan|planning|design|spec|brainstorm|architect)\b/],
  ['explore', /\b(explore|search|find|locate|investigate|research|scan|evaluate)\b/],
  ['document', /\b(document|documentation|readme|changelog|docs)\b/],
];

/** Best-effort role for a task description. */
export function inferRole(task, agentType) {
  const haystack = [task, agentType].filter(Boolean).join(' ').toLowerCase();
  if (!haystack.trim()) return 'unknown';

  // The leading verb is the strongest signal; check it on its own first.
  const lead = haystack.split(':')[0];
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (new RegExp('^\\W*' + pattern.source).test(lead)) return role;
  }
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (pattern.test(haystack)) return role;
  }
  return 'unknown';
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : null;
}

/**
 * One subagent dispatched by a session.
 *
 * Only `provider`, `sessionId` and `agentId` are guaranteed. Every other field
 * is null when the underlying agent does not record it: an adapter must never
 * invent data it cannot observe.
 */
export class AgentRun {
  constructor(fields = {}) {
    this.provider = fields.provider || 'unknown';
    this.sessionId = fields.sessionId || 'unknown';
    this.agentId = fields.agentId || 'unknown';
    this.parentAgentId = fields.parentAgentId ?? null;
    this.agentType = fields.agentType ?? null;
    this.model = fields.model ?? null;
    this.task = fields.task ?? null;
    this.role = fields.role ?? inferRole(this.task, this.agentType);
    this.status = fields.status || STATUS_UNKNOWN;
    this.spawnDepth = fields.spawnDepth ?? null;
    this.startedAt = fields.startedAt ?? null;
    this.finishedAt = fields.finishedAt ?? null;
    this.turns = fields.turns ?? null;
    this.toolUseId = fields.toolUseId ?? null;
    this.sourcePath = fields.sourcePath ?? null;
    this.extra = fields.extra || {};
  }

  get durationSeconds() {
    if (!this.startedAt || !this.finishedAt) return null;
    const delta = (this.finishedAt.getTime() - this.startedAt.getTime()) / 1000;
    return delta >= 0 ? delta : null;
  }

  /** Chronological ordering that keeps undated runs together at the end. */
  get sortKey() {
    return this.startedAt ? this.startedAt.getTime() : Number.MAX_SAFE_INTEGER;
  }

  /** Serialise to the common event format shared by every adapter. */
  toEvent() {
    return {
      schema_version: EVENT_SCHEMA_VERSION,
      provider: this.provider,
      session_id: this.sessionId,
      agent_id: this.agentId,
      parent_agent_id: this.parentAgentId,
      agent_type: this.agentType,
      model: this.model,
      role: this.role,
      task: this.task,
      status: this.status,
      spawn_depth: this.spawnDepth,
      started_at: toIso(this.startedAt),
      finished_at: toIso(this.finishedAt),
      duration_seconds: this.durationSeconds,
      turns: this.turns,
      tool_use_id: this.toolUseId,
      source_path: this.sourcePath,
      extra: Object.keys(this.extra).length ? this.extra : null,
    };
  }

  /** Inverse of `toEvent`, tolerant of missing optional keys. */
  static fromEvent(data = {}) {
    return new AgentRun({
      provider: data.provider,
      sessionId: data.session_id,
      agentId: data.agent_id || data.id,
      parentAgentId: data.parent_agent_id,
      agentType: data.agent_type,
      model: data.model,
      role: data.role,
      task: data.task || data.description,
      status: data.status,
      spawnDepth: data.spawn_depth,
      startedAt: parseTimestamp(data.started_at || data.timestamp),
      finishedAt: parseTimestamp(data.finished_at),
      turns: data.turns,
      toolUseId: data.tool_use_id,
      sourcePath: data.source_path,
      extra: data.extra || {},
    });
  }
}

/** A top-level agent session and the subagents it dispatched. */
export class Session {
  constructor(fields = {}) {
    this.provider = fields.provider || 'unknown';
    this.sessionId = fields.sessionId || 'unknown';
    this.project = fields.project ?? null;
    this.projectPath = fields.projectPath ?? null;
    this.startedAt = fields.startedAt ?? null;
    this.updatedAt = fields.updatedAt ?? null;
    this.agents = fields.agents || [];
    this.sourcePath = fields.sourcePath ?? null;
  }

  get agentCount() {
    return this.agents.length;
  }

  sortedAgents() {
    return [...this.agents].sort(
      (a, b) => a.sortKey - b.sortKey || a.agentId.localeCompare(b.agentId),
    );
  }

  modelCounts() {
    return tally(this.agents.map((a) => a.model || 'unknown'));
  }

  roleCounts() {
    return tally(this.agents.map((a) => a.role || 'unknown'));
  }

  toJSON() {
    return {
      schema_version: EVENT_SCHEMA_VERSION,
      provider: this.provider,
      session_id: this.sessionId,
      project: this.project,
      project_path: this.projectPath,
      started_at: toIso(this.startedAt),
      updated_at: toIso(this.updatedAt),
      agent_count: this.agentCount,
      models: this.modelCounts(),
      roles: this.roleCounts(),
      source_path: this.sourcePath,
      agents: this.sortedAgents().map((a) => a.toEvent()),
    };
  }
}

/**
 * What an adapter can and cannot observe on this machine. Reported verbatim by
 * `agent-observer adapters` so users can see why an agent shows no data instead
 * of assuming the tool is broken.
 */
export class Capability {
  constructor(fields = {}) {
    this.provider = fields.provider;
    this.displayName = fields.displayName;
    this.available = Boolean(fields.available);
    this.root = fields.root ?? null;
    this.observes = fields.observes || [];
    this.missing = fields.missing || [];
    this.note = fields.note ?? null;
  }

  toJSON() {
    return {
      provider: this.provider,
      display_name: this.displayName,
      available: this.available,
      root: this.root,
      observes: this.observes,
      missing: this.missing,
      note: this.note,
    };
  }
}

/** Count occurrences, returned highest-first then alphabetically. */
export function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return Object.fromEntries(
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

/** Parse an ISO-8601 timestamp or epoch number into a Date, or null. */
export function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    // Heuristic: values below ~1e11 are seconds, above are milliseconds.
    const ms = value < 1e11 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== 'string') return null;

  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}
