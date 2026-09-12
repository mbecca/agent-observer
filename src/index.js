/**
 * agent-observer: see which subagents your coding agent ran, and with which model.
 *
 * The package is split in two:
 *
 *   core/      an agent-agnostic model, filters and renderers. Knows nothing
 *              about Claude, Codex or any other product.
 *   adapters/  one module per agent, translating that agent's local files into
 *              the core model. An adapter reports only what it can observe.
 *
 * Importing this module gives you the same data the CLI renders, so you can
 * build a dashboard or a hook on top without shelling out.
 */

export { VERSION } from './version.js';

export {
  AgentRun,
  Capability,
  EVENT_SCHEMA_VERSION,
  ROLES,
  STATUS_COMPLETED,
  STATUS_SPAWNED,
  STATUS_UNKNOWN,
  Session,
  inferRole,
  parseTimestamp,
  tally,
} from './core/model.js';

export {
  Painter,
  aggregateModels,
  aggregateRoles,
  groupIntoWaves,
  renderCapabilities,
  renderModels,
  renderSession,
  renderSessionsTable,
  renderSummary,
  renderTimeline,
  renderTree,
  toCsv,
  toJson,
  toMarkdown,
  toNdjson,
} from './core/report.js';

export {
  ADAPTER_CLASSES,
  ClaudeCodeAdapter,
  CodexAdapter,
  GenericAdapter,
  adapterNames,
  allAdapters,
  availableAdapters,
  getAdapter,
  resolveAdapters,
} from './adapters/index.js';

export { applyFilters, gather, main as runCli } from './cli.js';
