/** Command line interface for agent-observer. */

import fs from 'node:fs';

import { adapterNames, allAdapters, resolveAdapters } from './adapters/index.js';
import { EVENT_SCHEMA_VERSION, Session } from './core/model.js';
import * as report from './core/report.js';
import { Painter } from './core/report.js';
import { localTime, pad, parseSince, supportsColor } from './core/util.js';
import { VERSION } from './version.js';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_NO_DATA = 2;

const TEXT_FORMATS = ['table', 'tree', 'timeline', 'summary'];
const DATA_FORMATS = ['json', 'ndjson', 'csv', 'markdown', 'html'];
const ALL_FORMATS = [...TEXT_FORMATS, ...DATA_FORMATS];

const COMMANDS = [
  ['current', 'Report the session you are in, or the most recent one.'],
  ['session <id>', 'Report one session by id or id prefix.'],
  ['sessions', 'List every session that dispatched subagents.'],
  ['tree [id]', "Show a session's orchestration as a tree."],
  ['models', 'Aggregate model usage across sessions.'],
  ['timeline [id]', 'Flat, time-ordered stream of subagent activity.'],
  ['watch', 'Print new subagent dispatches as they happen.'],
  ['export [id]', 'Write machine-readable output.'],
  ['adapters', 'Show what each adapter can observe here.'],
  ['doctor', 'Diagnose why no data is showing up.'],
];

const FLAGS_WITH_VALUE = new Set([
  '--adapter',
  '--format',
  '-f',
  '--project',
  '--since',
  '--model',
  '--role',
  '--limit',
  '--output',
  '-o',
  '--interval',
  '--session',
]);

const BOOLEAN_FLAGS = new Set(['--no-color', '--show-ids', '--all', '--help', '-h', '--version']);

/** Minimal argv parser: no dependencies, and the same on every platform. */
export function parseArgs(argv) {
  const args = {
    command: null,
    positional: [],
    adapter: 'auto',
    format: null,
    noColor: false,
    showIds: false,
    all: false,
    project: null,
    since: null,
    model: null,
    role: null,
    limit: null,
    output: null,
    interval: 2,
    session: null,
    help: false,
    version: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('-')) {
      if (args.command === null) args.command = token;
      else args.positional.push(token);
      continue;
    }

    let flag = token;
    let value = null;
    const equals = token.indexOf('=');
    if (equals > 1) {
      flag = token.slice(0, equals);
      value = token.slice(equals + 1);
    }

    if (BOOLEAN_FLAGS.has(flag)) {
      if (flag === '--no-color') args.noColor = true;
      else if (flag === '--show-ids') args.showIds = true;
      else if (flag === '--all') args.all = true;
      else if (flag === '--help' || flag === '-h') args.help = true;
      else if (flag === '--version') args.version = true;
      continue;
    }

    if (!FLAGS_WITH_VALUE.has(flag)) {
      throw new Error(`Unknown option '${flag}'. Run 'agent-observer --help'.`);
    }
    if (value === null) {
      index += 1;
      value = argv[index];
      if (value === undefined) throw new Error(`Option '${flag}' needs a value.`);
    }

    switch (flag) {
      case '--adapter':
        args.adapter = value;
        break;
      case '--format':
      case '-f':
        if (!ALL_FORMATS.includes(value)) {
          throw new Error(`Unknown format '${value}'. Choose one of: ${ALL_FORMATS.join(', ')}.`);
        }
        args.format = value;
        break;
      case '--project':
        args.project = value;
        break;
      case '--since':
        args.since = value;
        break;
      case '--model':
        args.model = value;
        break;
      case '--role':
        args.role = value;
        break;
      case '--limit':
        args.limit = Number(value);
        if (!Number.isFinite(args.limit) || args.limit < 1) {
          throw new Error(`--limit needs a positive number, got '${value}'.`);
        }
        break;
      case '--output':
      case '-o':
        args.output = value;
        break;
      case '--interval':
        args.interval = Number(value);
        if (!Number.isFinite(args.interval) || args.interval <= 0) {
          throw new Error(`--interval needs a positive number, got '${value}'.`);
        }
        break;
      case '--session':
        args.session = value;
        break;
      default:
        break;
    }
  }

  return args;
}

export function helpText() {
  const lines = [
    'agent-observer - see which subagents your coding agent ran, with which model,',
    '                 for which task.',
    '',
    'Usage: agent-observer <command> [options]',
    '',
    'Commands:',
  ];
  for (const [name, description] of COMMANDS) {
    lines.push(`  ${pad(name, 16)}${description}`);
  }
  lines.push(
    '',
    'Options:',
    `  ${pad('--adapter <name>', 22)}Agent to read: ${adapterNames().join(', ')}, auto, all.`,
    `  ${pad('-f, --format <fmt>', 22)}${ALL_FORMATS.join(', ')}.`,
    `  ${pad('--project <text>', 22)}Only sessions whose project matches this text.`,
    `  ${pad('--since <when>', 22)}Only sessions active since 7d, 12h, 30m or an ISO date.`,
    `  ${pad('--model <text>', 22)}Only subagents whose model matches this text.`,
    `  ${pad('--role <role>', 22)}implement, review, fix, test, plan, explore, document.`,
    `  ${pad('--limit <n>', 22)}Show at most this many sessions.`,
    `  ${pad('-o, --output <file>', 22)}Write to a file instead of stdout.`,
    `  ${pad('--show-ids', 22)}Show subagent ids in the session table.`,
    `  ${pad('--interval <sec>', 22)}Poll interval for watch (default 2).`,
    `  ${pad('--no-color', 22)}Disable ANSI colour.`,
    `  ${pad('-h, --help', 22)}Show this help.`,
    `  ${pad('--version', 22)}Show the version.`,
    '',
    'Examples:',
    '  agent-observer current',
    '  agent-observer tree',
    '  agent-observer sessions --since 7d',
    '  agent-observer models --project my-repo',
    '  agent-observer export --format ndjson -o runs.ndjson',
  );
  return lines.join('\n');
}

// -- data gathering --------------------------------------------------------

/** Collect sessions from the selected adapters and apply every filter. */
export function gather(args, { warn = defaultWarn } = {}) {
  const sessions = [];
  for (const adapter of resolveAdapters(args.adapter)) {
    try {
      sessions.push(...adapter.sessions());
    } catch (error) {
      // One broken adapter must not sink the rest.
      warn(`adapter '${adapter.name}' failed: ${error.message}`);
    }
  }
  return applyFilters(sessions, args);
}

export function applyFilters(sessions, args) {
  let result = [...sessions];

  // A session with no recorded subagents has nothing to report on. Adapters
  // still surface them (Codex records the session but not its subagents), so
  // hide them unless --all asks for the full picture.
  if (!args.all) result = result.filter((s) => s.agentCount > 0);

  if (args.project) {
    const needle = args.project.toLowerCase();
    result = result.filter(
      (s) =>
        (s.project || '').toLowerCase().includes(needle) ||
        (s.projectPath || '').toLowerCase().includes(needle),
    );
  }

  if (args.since) {
    const cutoff = parseSince(args.since);
    result = result.filter((s) => {
      const stamp = s.updatedAt || s.startedAt;
      return stamp && stamp >= cutoff;
    });
  }

  if (args.model || args.role) {
    const modelNeedle = args.model ? args.model.toLowerCase() : null;
    const roleNeedle = args.role ? args.role.toLowerCase() : null;
    result = result
      .map((session) => {
        let agents = session.agents;
        if (modelNeedle) {
          agents = agents.filter((a) => (a.model || '').toLowerCase().includes(modelNeedle));
        }
        if (roleNeedle) agents = agents.filter((a) => (a.role || '') === roleNeedle);
        return agents.length
          ? new Session({
              provider: session.provider,
              sessionId: session.sessionId,
              project: session.project,
              projectPath: session.projectPath,
              startedAt: session.startedAt,
              updatedAt: session.updatedAt,
              agents,
              sourcePath: session.sourcePath,
            })
          : null;
      })
      .filter(Boolean);
  }

  result.sort((a, b) => {
    const left = a.updatedAt || a.startedAt;
    const right = b.updatedAt || b.startedAt;
    return (right ? right.getTime() : 0) - (left ? left.getTime() : 0);
  });

  return args.limit ? result.slice(0, args.limit) : result;
}

/**
 * The running session, preferring an adapter that knows it outright.
 *
 * Returns the session together with the id the environment named, so the caller
 * can tell the user when it had to fall back to a different one. Silently
 * reporting another session's subagents as "current" is the one failure mode
 * this tool must not have.
 */
export function findCurrent(args) {
  for (const adapter of resolveAdapters(args.adapter)) {
    try {
      const session = adapter.currentSession();
      if (!session) continue;
      const requestedId = adapter.currentSessionId ? adapter.currentSessionId() : null;
      return { session, requestedId, exact: !requestedId || requestedId === session.sessionId };
    } catch {
      // Try the next adapter.
    }
  }
  return null;
}

export function findSession(args, sessionId) {
  for (const adapter of resolveAdapters(args.adapter)) {
    try {
      const session = adapter.session(sessionId);
      if (session) return session;
    } catch {
      // Try the next adapter.
    }
  }
  return null;
}

// -- output ----------------------------------------------------------------

function defaultWarn(message) {
  process.stderr.write(`warning: ${message}\n`);
}

function emit(text, args, write) {
  if (args.output) {
    fs.writeFileSync(args.output, text.replace(/\n+$/, '') + '\n', 'utf8');
    write(`Wrote ${args.output}`);
    return;
  }
  write(text);
}

export function renderData(sessions, format) {
  switch (format) {
    case 'json':
      return report.toJson(sessions);
    case 'ndjson':
      return report.toNdjson(sessions);
    case 'csv':
      return report.toCsv(sessions);
    case 'markdown':
      return report.toMarkdown(sessions);
    case 'html':
      return report.toHtml(sessions);
    default:
      throw new Error(`Unknown data format: ${format}`);
  }
}

function painterFor(args) {
  if (args.noColor || args.output) return new Painter(false);
  return new Painter(supportsColor());
}

function isDataFormat(format) {
  return DATA_FORMATS.includes(format);
}

// -- commands --------------------------------------------------------------

function renderOneSession(session, args, write) {
  // The user named this session, so an empty one is an answer, not noise. The
  // hide-empty rule exists for listings only.
  const sessions = applyFilters([session], { ...args, all: true });
  if (!sessions.length) {
    write('That session has nothing matching those filters.');
    return EXIT_NO_DATA;
  }
  const format = args.format || 'table';
  if (isDataFormat(format)) {
    emit(renderData(sessions, format), args, write);
  } else if (format === 'tree') {
    emit(report.renderTree(sessions[0], painterFor(args)), args, write);
  } else if (format === 'timeline') {
    emit(report.renderTimeline(sessions, painterFor(args)), args, write);
  } else {
    emit(
      report.renderSession(sessions[0], painterFor(args), { showIds: args.showIds }),
      args,
      write,
    );
  }
  return EXIT_OK;
}

function cmdCurrent(args, io) {
  // `current` is by definition the session you are in, so an id cannot apply.
  // Say so: swallowing the argument looks like it was honoured.
  const ignoredId = args.positional[0];
  if (ignoredId) {
    io.warn(
      `current takes no session id; '${ignoredId}' ignored. ` +
        `Use 'agent-observer session ${ignoredId}' to report that session.`,
    );
  }

  const found = findCurrent(args);
  if (!found) return noData(args, io.write);

  if (!found.exact && !isDataFormat(args.format)) {
    const p = painterFor(args);
    io.write(
      p.paint(
        `Session ${found.requestedId} has no recorded subagents. ` +
          'Showing the most recent session that does:',
        'dim',
      ),
    );
    io.write('');
  }
  return renderOneSession(found.session, args, io.write);
}

function cmdSession(args, io) {
  const sessionId = args.positional[0];
  if (!sessionId) {
    io.warn("'session' needs a session id. Run 'agent-observer sessions' to list them.");
    return EXIT_ERROR;
  }
  const session = findSession(args, sessionId);
  if (!session) {
    io.warn(`No session matching '${sessionId}'. Run 'agent-observer sessions' to list them.`);
    return EXIT_NO_DATA;
  }
  return renderOneSession(session, args, io.write);
}

function cmdSessions(args, io) {
  const sessions = gather(args, io);
  if (!sessions.length) return noData(args, io.write);

  const format = args.format || 'table';
  if (isDataFormat(format)) emit(renderData(sessions, format), args, io.write);
  else if (format === 'timeline')
    emit(report.renderTimeline(sessions, painterFor(args)), args, io.write);
  else emit(report.renderSessionsTable(sessions, painterFor(args)), args, io.write);
  return EXIT_OK;
}

function cmdTree(args, io) {
  const sessionId = args.positional[0];
  let session;
  if (sessionId) {
    session = findSession(args, sessionId);
    if (!session) {
      io.warn(`No session matching '${sessionId}'.`);
      return EXIT_NO_DATA;
    }
  } else {
    const found = findCurrent(args);
    if (!found) return noData(args, io.write);
    if (!found.exact && !isDataFormat(args.format)) {
      io.write(
        painterFor(args).paint(
          `Session ${found.requestedId} has no recorded subagents. ` +
            'Showing the most recent session that does:',
          'dim',
        ),
      );
      io.write('');
    }
    session = found.session;
  }
  return renderOneSession(session, { ...args, format: args.format || 'tree' }, io.write);
}

function cmdModels(args, io) {
  const sessions = gather(args, io);
  if (!sessions.length) return noData(args, io.write);

  const format = args.format || 'summary';
  if (format === 'json') {
    emit(
      JSON.stringify(
        {
          schema_version: EVENT_SCHEMA_VERSION,
          sessions: sessions.length,
          models: report.aggregateModels(sessions),
          roles: report.aggregateRoles(sessions),
        },
        null,
        2,
      ),
      args,
      io.write,
    );
  } else if (isDataFormat(format)) {
    emit(renderData(sessions, format), args, io.write);
  } else {
    emit(report.renderModels(sessions, painterFor(args)), args, io.write);
  }
  return EXIT_OK;
}

function cmdTimeline(args, io) {
  const sessionId = args.positional[0];
  let sessions;
  if (sessionId) {
    const session = findSession(args, sessionId);
    sessions = session ? applyFilters([session], args) : [];
  } else {
    sessions = gather(args, io);
  }
  if (!sessions.length) return noData(args, io.write);

  const format = args.format || 'timeline';
  if (isDataFormat(format)) emit(renderData(sessions, format), args, io.write);
  else emit(report.renderTimeline(sessions, painterFor(args)), args, io.write);
  return EXIT_OK;
}

function cmdExport(args, io) {
  const sessionId = args.positional[0];
  let sessions;
  if (sessionId) {
    const session = findSession(args, sessionId);
    sessions = session ? applyFilters([session], args) : [];
  } else {
    sessions = gather(args, io);
  }
  if (!sessions.length) return noData(args, io.write);
  emit(renderData(sessions, args.format || 'json'), args, io.write);
  return EXIT_OK;
}

/**
 * Poll for newly recorded subagents and print each as it appears.
 *
 * Polling beats filesystem events here: it behaves identically on Windows and
 * Linux, needs no dependency, and a couple of seconds of latency is fine for a
 * view of work that takes minutes.
 */
async function cmdWatch(args, io) {
  const p = painterFor(args);
  const seen = new Set();
  io.write(p.paint('Watching for subagent activity. Ctrl-C to stop.', 'dim'));

  let firstPass = true;
  let running = true;
  let wake = null;
  const stop = () => {
    running = false;
    // Cut the current sleep short so Ctrl-C returns immediately rather than
    // after the rest of the poll interval.
    if (wake) wake();
  };
  process.once('SIGINT', stop);

  while (running) {
    let sessions;
    if (args.session) {
      const session = findSession(args, args.session);
      sessions = session ? [session] : [];
    } else {
      sessions = gather(args, io);
    }

    const fresh = [];
    for (const session of sessions) {
      for (const agent of session.sortedAgents()) {
        const key = `${session.sessionId}|${agent.agentId}|${agent.status}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push([agent, session]);
      }
    }

    if (!firstPass) {
      fresh.sort((a, b) => a[0].sortKey - b[0].sortKey);
      for (const [agent, session] of fresh) {
        io.write(
          `${p.paint(session.sessionId.slice(0, 8), 'dim')}  ` +
            `${localTime(agent.startedAt)}  ` +
            `${p.model(pad(agent.model || 'unknown', 8))}  ` +
            `${p.paint(pad(agent.status, 9), 'dim')}  ` +
            `${agent.task || agent.agentType || agent.agentId}`,
        );
      }
    }
    firstPass = false;

    if (!running) break;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.max(500, args.interval * 1000));
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = null;
  }

  process.removeListener('SIGINT', stop);
  return EXIT_OK;
}

function cmdAdapters(args, io) {
  const capabilities = [];
  for (const adapter of allAdapters()) {
    try {
      capabilities.push(adapter.capability());
    } catch (error) {
      io.warn(`${adapter.name}: ${error.message}`);
    }
  }
  if (isDataFormat(args.format)) {
    emit(JSON.stringify(capabilities, null, 2), args, io.write);
  } else {
    emit(report.renderCapabilities(capabilities, painterFor(args)), args, io.write);
  }
  return EXIT_OK;
}

/** Explain, step by step, what the tool can and cannot see. */
function cmdDoctor(args, io) {
  const p = painterFor(args);
  const lines = [p.paint(`agent-observer ${VERSION}`, 'bold'), ''];
  lines.push(`Node        ${process.version}`);
  lines.push(`Platform    ${process.platform} ${process.arch}`);
  lines.push(`Home        ${process.env.HOME || process.env.USERPROFILE || '-'}`);
  lines.push('');

  let totalSessions = 0;
  let totalAgents = 0;

  for (const adapter of allAdapters()) {
    const cap = adapter.capability();
    lines.push(
      `${p.paint(cap.displayName, 'bold')}  ` +
        (cap.available ? p.paint('ok', 'green') : p.paint('no data', 'dim')),
    );
    lines.push(p.paint(`  root ${cap.root || '-'}`, 'dim'));

    if (cap.available) {
      let sessions = [];
      try {
        sessions = adapter.sessions();
      } catch (error) {
        lines.push(p.paint(`  error ${error.message}`, 'red'));
      }
      const agents = sessions.reduce((sum, s) => sum + s.agentCount, 0);
      totalSessions += sessions.length;
      totalAgents += agents;
      lines.push(`  ${sessions.length} session(s), ${agents} subagent(s)`);
    } else if (cap.note) {
      lines.push(p.paint(`  ${cap.note}`, 'dim'));
    }
    lines.push('');
  }

  lines.push(`Total: ${totalSessions} session(s), ${totalAgents} subagent(s)`);
  if (!totalAgents) {
    lines.push('');
    lines.push(
      p.paint(
        'No subagents recorded yet. A session only appears here once it has ' +
          'dispatched at least one subagent.',
        'dim',
      ),
    );
  }
  emit(lines.join('\n'), args, io.write);
  return EXIT_OK;
}

function noData(args, write) {
  if (isDataFormat(args.format)) {
    write(args.format === 'json' ? '[]' : '');
    return EXIT_NO_DATA;
  }
  write("No subagent activity found. Run 'agent-observer doctor' to see what is being searched.");
  return EXIT_NO_DATA;
}

const HANDLERS = {
  current: cmdCurrent,
  session: cmdSession,
  sessions: cmdSessions,
  tree: cmdTree,
  models: cmdModels,
  timeline: cmdTimeline,
  watch: cmdWatch,
  export: cmdExport,
  adapters: cmdAdapters,
  doctor: cmdDoctor,
};

/**
 * Run the CLI. `io` is injectable so tests can capture output instead of
 * writing to the terminal.
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const write = io.write || ((text) => process.stdout.write(text + '\n'));
  const warn = io.warn || defaultWarn;
  const channel = { write, warn };

  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    warn(`error: ${error.message}`);
    return EXIT_ERROR;
  }

  if (args.version) {
    write(`agent-observer ${VERSION}`);
    return EXIT_OK;
  }
  if (args.help || !args.command) {
    write(helpText());
    return EXIT_OK;
  }

  const handler = HANDLERS[args.command];
  if (!handler) {
    warn(`Unknown command '${args.command}'.`);
    write(helpText());
    return EXIT_ERROR;
  }

  try {
    return await handler(args, channel);
  } catch (error) {
    if (error && error.code === 'EPIPE') return EXIT_OK;
    warn(`error: ${error.message}`);
    return EXIT_ERROR;
  }
}
