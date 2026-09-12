/**
 * Renderers turning sessions into text, tables, trees and machine formats.
 *
 * Every renderer takes the agent-agnostic model from `core/model.js`, so a new
 * adapter gets all output formats for free.
 */

import {
  humanDuration,
  localMinute,
  localTime,
  pad,
  supportsColor,
  terminalWidth,
  truncate,
} from './util.js';

const RESET = '\u001b[0m';
const STYLES = {
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  magenta: '\u001b[35m',
  blue: '\u001b[34m',
  red: '\u001b[31m',
  grey: '\u001b[90m',
};

/**
 * Colour per model family, matched as a substring so `claude-haiku-4-5` and a
 * bare `haiku` land on the same colour.
 */
const MODEL_COLORS = [
  ['haiku', 'green'],
  ['sonnet', 'yellow'],
  ['opus', 'magenta'],
  ['fable', 'cyan'],
  ['gpt', 'blue'],
  ['gemini', 'blue'],
  ['inherit', 'grey'],
];

const ROLE_MARKS = {
  implement: '+',
  review: '?',
  fix: '*',
  test: '!',
  plan: '>',
  explore: '~',
  document: '=',
  unknown: '.',
};

/** Applies ANSI styling, or passes text through when colour is off. */
export class Painter {
  constructor(enabled) {
    this.enabled = enabled === undefined ? supportsColor() : Boolean(enabled);
  }

  paint(text, ...styles) {
    if (!this.enabled || !styles.length) return text;
    const prefix = styles.map((s) => STYLES[s] || '').join('');
    return prefix ? prefix + text + RESET : text;
  }

  model(name) {
    const label = name || 'unknown';
    if (!this.enabled) return label;
    const lowered = label.toLowerCase();
    for (const [needle, style] of MODEL_COLORS) {
      if (lowered.includes(needle)) return this.paint(label, style);
    }
    return this.paint(label, 'grey');
  }
}

function sessionHeader(session, p) {
  const lines = [p.paint(`Session ${session.sessionId}`, 'bold', 'cyan')];
  const location = session.projectPath || session.project;
  if (location) lines.push(p.paint(`  project  ${location}`, 'dim'));
  lines.push(p.paint(`  provider ${session.provider}   subagents ${session.agentCount}`, 'dim'));
  if (session.startedAt) {
    lines.push(p.paint(`  started  ${localTime(session.startedAt, true)}`, 'dim'));
  }
  lines.push('');
  return lines.join('\n');
}

/** Detailed, chronological table of one session's subagents. */
export function renderSession(session, p, { showIds = false, width } = {}) {
  const out = [sessionHeader(session, p)];
  const agents = session.sortedAgents();
  if (!agents.length) {
    out.push(p.paint('  No subagents recorded for this session.', 'dim'));
    return out.join('\n');
  }

  const total = width || terminalWidth();
  const modelWidth = Math.max(5, ...agents.map((a) => (a.model || 'unknown').length));
  const typeWidth = Math.min(22, Math.max(4, ...agents.map((a) => (a.agentType || '-').length)));
  const taskWidth = Math.max(24, total - (6 + 9 + modelWidth + typeWidth + 9 + 4));

  out.push(
    p.paint(
      `  ${pad('#', 4)}${pad('TIME', 9)}${pad('MODEL', modelWidth + 1)}` +
        `${pad('TYPE', typeWidth + 1)}${pad('TOOK', 8)}TASK`,
      'bold',
    ),
  );

  agents.forEach((agent, index) => {
    const model = agent.model || 'unknown';
    out.push(
      `  ${pad(String(index + 1), 4)}${pad(localTime(agent.startedAt), 9)}` +
        `${p.model(model)}${' '.repeat(modelWidth + 1 - model.length)}` +
        `${pad(truncate(agent.agentType || '-', typeWidth), typeWidth + 1)}` +
        `${pad(humanDuration(agent.durationSeconds), 8)}` +
        `${truncate(agent.task, taskWidth)}`,
    );
    if (showIds) out.push(p.paint(`      ${agent.agentId}`, 'dim'));
  });

  out.push('');
  out.push(renderSummary(session, p));
  return out.join('\n');
}

/** Model and role tallies for a single session. */
export function renderSummary(session, p) {
  const out = [p.paint('  Models', 'bold')];
  const models = session.modelCounts();
  const nameWidth = Math.max(6, ...Object.keys(models).map((m) => m.length));
  for (const [model, count] of Object.entries(models)) {
    const bar = '#'.repeat(Math.min(count, 40));
    out.push(`    ${p.model(pad(model, nameWidth))}  ${pad(String(count), 4)}${p.paint(bar, 'dim')}`);
  }
  out.push('');
  out.push(p.paint('  Roles', 'bold'));
  for (const [role, count] of Object.entries(session.roleCounts())) {
    out.push(`    ${pad(role, 12)} ${pad(String(count), 4)}`);
  }
  return out.join('\n');
}

/** One row per session, with a per-model breakdown column. */
export function renderSessionsTable(sessions, p) {
  if (!sessions.length) return p.paint('No sessions with subagents found.', 'dim');

  const models = [
    ...new Set(sessions.flatMap((s) => s.agents.map((a) => a.model || 'unknown'))),
  ].sort();
  const idWidth = Math.min(36, Math.max(10, ...sessions.map((s) => s.sessionId.length)));
  const projectBudget = terminalWidth() - idWidth - 18 - 8 - 10 * models.length;
  const projectWidth = Math.min(
    Math.max(7, ...sessions.map((s) => projectLabel(s).length)),
    Math.max(12, projectBudget),
  );

  let head = `${pad('SESSION', idWidth)}  ${pad('PROJECT', projectWidth)}  ${pad('UPDATED', 16)}  ${pad('AGENTS', 6)}`;
  for (const model of models) head += `  ${pad(truncate(model, 8), 8)}`;
  const out = [p.paint(head, 'bold')];

  for (const session of sessions) {
    const counts = session.modelCounts();
    let row =
      `${pad(truncate(session.sessionId, idWidth), idWidth)}  ` +
      `${pad(truncate(projectLabel(session), projectWidth), projectWidth)}  ` +
      `${pad(localMinute(session.updatedAt || session.startedAt), 16)}  ` +
      `${pad(String(session.agentCount), 6)}`;
    for (const model of models) {
      const count = counts[model] || 0;
      const cell = pad(String(count), 8);
      row += '  ' + (count ? p.model(cell) : p.paint(cell, 'dim'));
    }
    out.push(row);
  }

  const totals = aggregateModels(sessions);
  const totalAgents = sessions.reduce((sum, s) => sum + s.agentCount, 0);
  const breakdown = Object.entries(totals)
    .map(([m, c]) => `${m} ${c}`)
    .join(', ');
  out.push('');
  out.push(
    p.paint(
      `${sessions.length} session(s), ${totalAgents} subagent(s): ${breakdown || 'none'}`,
      'dim',
    ),
  );
  return out.join('\n');
}

function projectLabel(session) {
  return session.project || session.projectPath || '-';
}

/**
 * Orchestration tree, grouping each implement/review/fix wave under a task.
 *
 * Waves are inferred from role transitions in chronological order: a new wave
 * starts when an implement/plan/explore role follows a review, fix or test.
 */
export function renderTree(session, p) {
  const out = [sessionHeader(session, p)];
  const agents = session.sortedAgents();
  if (!agents.length) {
    out.push(p.paint('  No subagents recorded for this session.', 'dim'));
    return out.join('\n');
  }

  const waves = groupIntoWaves(agents);
  const longest = Math.max(...agents.map((a) => (a.task || '').length));
  const labelWidth = Math.min(Math.max(longest, 20), Math.max(24, terminalWidth() - 34));

  waves.forEach((wave, waveIndex) => {
    const isLast = waveIndex === waves.length - 1;
    out.push(`  ${p.paint(isLast ? '└─' : '├─', 'dim')} ${p.paint(waveTitle(wave, waveIndex + 1), 'bold')}`);
    const gutter = isLast ? '   ' : '  │';
    wave.forEach((agent, agentIndex) => {
      const leaf = agentIndex === wave.length - 1 ? '└─' : '├─';
      const label = truncate(agent.task || agent.agentType || agent.agentId, labelWidth);
      const dots = '.'.repeat(Math.max(3, labelWidth - label.length + 3));
      out.push(
        `${gutter}  ${p.paint(leaf, 'dim')} ${p.paint(ROLE_MARKS[agent.role] || '.', 'dim')} ` +
          `${label} ${p.paint(dots, 'dim')} ${p.model(agent.model || 'unknown')}`,
      );
    });
    if (!isLast) out.push('  │');
  });

  out.push('');
  out.push(renderSummary(session, p));
  return out.join('\n');
}

/** Split a chronological run list into task waves. */
export function groupIntoWaves(agents) {
  const openers = new Set(['implement', 'plan', 'explore']);
  const closers = new Set(['review', 'fix', 'test']);
  const waves = [];
  let current = [];
  let seenCloser = false;

  for (const agent of agents) {
    const role = agent.role || 'unknown';
    if (current.length && openers.has(role) && seenCloser) {
      waves.push(current);
      current = [];
      seenCloser = false;
    }
    current.push(agent);
    if (closers.has(role)) seenCloser = true;
  }
  if (current.length) waves.push(current);
  return waves;
}

/** Name a wave after its opening task, trimmed of boilerplate. */
export function waveTitle(wave, index) {
  let task = (wave[0].task || '').trim();
  if (!task) return `Wave ${index}`;
  for (const prefix of ['Implement ', 'Implementing ', 'Plan ', 'Explore ']) {
    if (task.startsWith(prefix)) {
      task = task.slice(prefix.length);
      break;
    }
  }
  return truncate(task, 64) || `Wave ${index}`;
}

/** Flat, time-ordered event stream across one or many sessions. */
export function renderTimeline(sessions, p) {
  const rows = [];
  for (const session of sessions) {
    for (const agent of session.sortedAgents()) rows.push([agent, session]);
  }
  rows.sort((a, b) => a[0].sortKey - b[0].sortKey);
  if (!rows.length) return p.paint('No subagent activity found.', 'dim');

  const multi = new Set(rows.map(([, s]) => s.sessionId)).size > 1;
  const taskWidth = Math.max(24, terminalWidth() - (multi ? 52 : 42));

  return rows
    .map(([agent, session]) => {
      const prefix = multi ? `${p.paint(session.sessionId.slice(0, 8), 'dim')}  ` : '';
      return (
        `${prefix}${localTime(agent.startedAt, true)}  ` +
        `${p.model(pad(agent.model || 'unknown', 10))}  ` +
        `${p.paint(pad(agent.role || 'unknown', 9), 'dim')}  ` +
        `${truncate(agent.task, taskWidth)}`
      );
    })
    .join('\n');
}

export function aggregateModels(sessions) {
  const counts = new Map();
  for (const session of sessions) {
    for (const [model, count] of Object.entries(session.modelCounts())) {
      counts.set(model, (counts.get(model) || 0) + count);
    }
  }
  return Object.fromEntries(
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

export function aggregateRoles(sessions) {
  const counts = new Map();
  for (const session of sessions) {
    for (const [role, count] of Object.entries(session.roleCounts())) {
      counts.set(role, (counts.get(role) || 0) + count);
    }
  }
  return Object.fromEntries(
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

/** Model usage across every session, with a share bar. */
export function renderModels(sessions, p) {
  const models = aggregateModels(sessions);
  const total = Object.values(models).reduce((sum, n) => sum + n, 0);
  if (!total) return p.paint('No subagent activity found.', 'dim');

  const nameWidth = Math.max(...Object.keys(models).map((m) => m.length));
  const out = [p.paint(`Model usage across ${sessions.length} session(s)`, 'bold'), ''];
  for (const [model, count] of Object.entries(models)) {
    const share = count / total;
    const bar = '#'.repeat(Math.round(share * 40));
    out.push(
      `  ${p.model(pad(model, nameWidth))} ${pad(String(count), 5)}` +
        `${pad((share * 100).toFixed(1) + '%', 8)}${p.paint(bar, 'dim')}`,
    );
  }
  out.push('');
  out.push(p.paint(`  total ${total} subagent(s)`, 'dim'));

  const roles = aggregateRoles(sessions);
  if (Object.keys(roles).length) {
    out.push('');
    out.push(p.paint('Roles', 'bold'));
    for (const [role, count] of Object.entries(roles)) {
      out.push(`  ${pad(role, 12)} ${pad(String(count), 5)}`);
    }
  }
  return out.join('\n');
}

/** What each adapter can observe here, including what it cannot. */
export function renderCapabilities(capabilities, p) {
  const out = [];
  for (const cap of capabilities) {
    const mark = cap.available ? p.paint('available', 'green') : p.paint('not found', 'dim');
    out.push(`${p.paint(cap.displayName, 'bold')}  ${mark}`);
    if (cap.root) out.push(p.paint(`  root      ${cap.root}`, 'dim'));
    if (cap.observes.length) out.push(`  observes  ${cap.observes.join(', ')}`);
    if (cap.missing.length) out.push(p.paint(`  missing   ${cap.missing.join(', ')}`, 'dim'));
    if (cap.note) out.push(p.paint(`  note      ${cap.note}`, 'dim'));
    out.push('');
  }
  return out.join('\n').trimEnd();
}

export function toJson(sessions, indent = 2) {
  return JSON.stringify(sessions.map((s) => s.toJSON()), null, indent);
}

/** One common-format event per line: the interop format for other tools. */
export function toNdjson(sessions) {
  const lines = [];
  for (const session of sessions) {
    for (const agent of session.sortedAgents()) {
      lines.push(JSON.stringify({ ...agent.toEvent(), project: session.project }));
    }
  }
  return lines.join('\n');
}

export const CSV_COLUMNS = [
  'provider',
  'session_id',
  'project',
  'agent_id',
  'agent_type',
  'model',
  'role',
  'status',
  'spawn_depth',
  'started_at',
  'finished_at',
  'duration_seconds',
  'turns',
  'task',
];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function toCsv(sessions) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const session of sessions) {
    for (const agent of session.sortedAgents()) {
      const event = { ...agent.toEvent(), project: session.project };
      rows.push(CSV_COLUMNS.map((column) => csvCell(event[column])).join(','));
    }
  }
  return rows.join('\n');
}

export { toHtml } from './html.js';

/** Markdown report, for pasting into a pull request or an issue. */
export function toMarkdown(sessions) {
  const out = [];
  for (const session of sessions) {
    out.push(`## Session \`${session.sessionId}\``, '');
    if (session.project) out.push(`- **Project:** ${session.project}`);
    out.push(`- **Provider:** ${session.provider}`);
    out.push(`- **Subagents:** ${session.agentCount}`, '');
    if (session.agents.length) {
      out.push('| # | Time | Model | Role | Type | Task |');
      out.push('|---|------|-------|------|------|------|');
      session.sortedAgents().forEach((agent, index) => {
        out.push(
          `| ${index + 1} | ${localTime(agent.startedAt)} | \`${agent.model || 'unknown'}\` | ` +
            `${agent.role || 'unknown'} | ${agent.agentType || '-'} | ` +
            `${(agent.task || '').replace(/\|/g, '\\|')} |`,
        );
      });
      const breakdown = Object.entries(session.modelCounts())
        .map(([m, c]) => `${m} ${c}`)
        .join(', ');
      out.push('', `**Models:** ${breakdown}`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}
