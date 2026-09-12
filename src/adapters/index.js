/**
 * Adapter registry.
 *
 * Adding support for a new agent means writing a class with the same shape as
 * the ones below (capability, sessions, session, currentSession) and listing it
 * here. Nothing else in the codebase needs to change.
 */

import { ClaudeCodeAdapter } from './claude-code.js';
import { CodexAdapter } from './codex.js';
import { GenericAdapter } from './generic.js';

/** Order matters: `--adapter auto` picks every one that has data. */
export const ADAPTER_CLASSES = [ClaudeCodeAdapter, CodexAdapter, GenericAdapter];

export function allAdapters() {
  return ADAPTER_CLASSES.map((Cls) => new Cls());
}

export function adapterNames() {
  return ADAPTER_CLASSES.map((Cls) => Cls.adapterName);
}

export function getAdapter(name) {
  const Cls = ADAPTER_CLASSES.find((candidate) => candidate.adapterName === name);
  return Cls ? new Cls() : null;
}

export function availableAdapters() {
  return allAdapters().filter((adapter) => adapter.isAvailable());
}

/**
 * Turn an `--adapter` value into the adapters to query. `auto` means every
 * adapter that has data on this machine; `all` means every adapter regardless.
 */
export function resolveAdapters(name = 'auto') {
  if (!name || name === 'auto') return availableAdapters();
  if (name === 'all') return allAdapters();
  const adapter = getAdapter(name);
  return adapter ? [adapter] : [];
}

export { ClaudeCodeAdapter, CodexAdapter, GenericAdapter };
