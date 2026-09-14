/**
 * agent-observer as an OpenCode server plugin.
 *
 * Add "agent-observer" to the "plugin" list in opencode.json. The plugin adds
 * the agent-observer skill and the /subagent-report command, both of which run
 * the bundled CLI with Node, and tells that CLI which session it runs in.
 *
 * Only the default export may exist here; see hooks.js.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyConfig, applySessionEnv } from './hooks.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function server() {
  return {
    config: async (config) => applyConfig(config, packageRoot),
    'shell.env': async (input, output) => applySessionEnv(input, output),
  };
}

export default { id: 'agent-observer', server };
