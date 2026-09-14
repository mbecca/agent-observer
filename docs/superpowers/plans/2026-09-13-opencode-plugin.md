# OpenCode Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship agent-observer as an OpenCode server plugin from the same npm package, so `"plugin": ["agent-observer"]` brings the skill and `/subagent-report`, and make `current` report the OpenCode session it runs in instead of guessing.

**Architecture:** A dependency-free `opencode/plugin.js` (V1 module, default export only) whose `config` hook registers the existing `skills/` directory and builds the `subagent-report` command from `commands/subagent-report.md`, and whose `shell.env` hook exports `OPENCODE_SESSION_ID`. The OpenCode adapter reads that variable, and `findCurrent` in the CLI tries adapters that know their session outright before guessing.

**Tech Stack:** Node.js ESM, zero dependencies, `node:test`, `node:sqlite` (Node 22+) for OpenCode fixtures, OpenCode 1.18.30 for real verification.

**Spec:** `docs/superpowers/specs/2026-09-13-opencode-plugin-design.md`

## Global Constraints

- No dependencies, runtime or development. No import of `@opencode-ai/plugin`.
- `src/core/` must not name any agent or product. OpenCode-specific code lives in `src/adapters/opencode.js` and `opencode/`.
- An adapter reports only what it can observe; never infer a session or model.
- Tests use fixtures written to disk in the real shape, never mocks. OpenCode fixtures need `node:sqlite` and skip on Node 18 and 20.
- Package manager is pnpm: `pnpm run …`, never `npm run`.
- The environment variable is exactly `OPENCODE_SESSION_ID`.
- The plugin id is exactly `agent-observer`; the command name is exactly `subagent-report`.
- The package root written into the command template uses forward slashes.
- A user-defined `subagent-report` command in OpenCode config is never overwritten.
- Commit messages carry no `Co-Authored-By` or `Claude-Session` trailer.
- Model choice when dispatching (from `CLAUDE.md`): implementation tasks on a fast cheap model, per-task review on a standard model, the final whole-branch review on the most capable model.

---

## File Structure

| File | Responsibility |
|---|---|
| `opencode/plugin.js` (create) | The module OpenCode loads. Default export `{ id, server }` only. |
| `opencode/hooks.js` (create) | Pure, testable logic behind the hooks: path normalisation, command file parsing, config mutation, session env. |
| `src/adapters/opencode.js` (modify) | `currentSessionId()`, named-session resolution through `parent_id`, empty session. |
| `src/cli.js` (modify) | `findCurrent` two-pass ordering. |
| `test/helpers.js` (modify) | Gains the OpenCode SQLite fixture builder, moved from `test/opencode.test.js`. |
| `test/opencode.test.js` (modify) | Uses the moved builder; new current-session tests. |
| `test/cli.test.js` (modify) | Current-session selection across adapters. |
| `test/opencode-plugin.test.js` (create) | Plugin module shape and hook behaviour. |
| `scripts/check-syntax.mjs` (modify) | Also parses `opencode/`. |
| `scripts/validate-plugin.mjs` (modify) | Checks the `./server` export exists and is published. |
| `package.json` (modify) | `exports["./server"]`, `files`, `keywords`. |
| `skills/agent-observer/SKILL.md` (modify) | How to run the CLI outside Claude Code. |
| `README.md`, `CHANGELOG.md` (modify) | Install, update and changelog entries. |

`hooks.js` is split from `plugin.js` because OpenCode treats every export of a module that is not a V1 default as a legacy plugin, and throws when one is not a function. `plugin.js` therefore exports nothing but its default, and tests reach the logic through `hooks.js`.

---

### Task 0: Probe OpenCode's plugin loading (throwaway, gate)

Nothing from this task is committed. It exists to confirm the spec's assumptions against OpenCode 1.18.30 before any code is written. **If any expected result below does not hold, stop, report the finding, and revise the spec with the user before Task 1.**

**Files:** all under the session scratchpad, referred to below as `$PROBE`. Do not touch `~/.config/opencode/`.

- [ ] **Step 1: Create the probe package**

`$PROBE/pkg/package.json`:

```json
{
  "name": "ao-probe",
  "version": "0.0.0",
  "type": "module",
  "main": "./library.js",
  "exports": {
    ".": "./library.js",
    "./server": "./server.js"
  }
}
```

`$PROBE/pkg/library.js`, shaped like `src/index.js` (a non-function export), so loading it as a plugin fails loudly:

```js
export const NOT_A_PLUGIN = 'library entry was loaded as a plugin';
export function helper() {
  return NOT_A_PLUGIN;
}
```

`$PROBE/pkg/server.js` (replace `LOG` with the absolute path of `$PROBE/log.ndjson`, forward slashes):

```js
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG = 'C:/…/log.ndjson';
const here = path.dirname(fileURLToPath(import.meta.url));
const log = (entry) => appendFileSync(LOG, JSON.stringify({ at: Date.now(), ...entry }) + '\n');

async function server() {
  log({ event: 'server' });
  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      config.skills.paths.push(path.join(here, 'skills'));
      config.command = config.command || {};
      config.command['ao-probe'] = { description: 'probe command', template: 'Reply with exactly: PROBE-OK' };
      log({ event: 'config', hadUserSubagentReport: Boolean(config.command['subagent-report']) });
    },
    'shell.env': async (input, output) => {
      log({ event: 'shell.env', input });
      if (input.sessionID) output.env.AO_PROBE_SESSION = input.sessionID;
    },
  };
}

export default { id: 'ao-probe', server };
```

`$PROBE/pkg/skills/ao-probe/SKILL.md`:

```markdown
---
name: ao-probe
description: Probe skill used to check how OpenCode loads plugin skills. Load it only when asked to.
---

# Probe

This skill exists only to be loaded by a test.
```

- [ ] **Step 2: Create an isolated config home**

`$PROBE/config/opencode/opencode.json` (absolute forward-slash path to `$PROBE/pkg`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["C:/…/pkg"]
}
```

Every `opencode` command in this task runs with `XDG_CONFIG_HOME` set to `$PROBE/config`, from inside `$PROBE`, so the user's own `opencode.json` (which defines `subagent-report` and loads Superpowers) is not merged in. Auth lives in the data directory, which is left alone, so models still work.

- [ ] **Step 3: Check isolation and loading**

Run: `XDG_CONFIG_HOME="$PROBE/config" opencode debug config`
Expected: exit 0; the output lists the probe plugin and does **not** contain `subagent-report` or `superpowers`.

Then read `$PROBE/log.ndjson`.
Expected: a `server` line and a `config` line with `"hadUserSubagentReport": false`. Record whether a directory path spec loaded `./server` (log present, no error) or `main` (an error mentioning "Plugin export is not a function" in `opencode debug config --print-logs`).

- [ ] **Step 4: Check the skill is discovered**

Run: `XDG_CONFIG_HOME="$PROBE/config" opencode debug skill`
Expected: `ao-probe` is listed, with its location under `$PROBE/pkg/skills`.

- [ ] **Step 5: Check the command, `shell.env`, and the skill directory the model sees**

Run: `XDG_CONFIG_HOME="$PROBE/config" opencode run --command ao-probe`
Expected: the reply contains `PROBE-OK`.

Run:

```bash
XDG_CONFIG_HOME="$PROBE/config" opencode run --auto --format json \
  'Use the skill tool to load the ao-probe skill. Then run this bash command: node -e "console.log(process.env.AO_PROBE_SESSION)"'
```

Expected: the skill tool result shows the skill's directory (record the exact wording, for example "Base directory for this skill: …"); the bash output prints an id starting with `ses`; `log.ndjson` has a `shell.env` line whose `input.sessionID` equals that id.

- [ ] **Step 6: Check a packed tarball installs and loads through `./server`**

```bash
cd "$PROBE/pkg" && npm pack --pack-destination "$PROBE"
```

Replace the plugin entry with `"ao-probe@file:C:/…/ao-probe-0.0.0.tgz"`, clear `log.ndjson`, and rerun `opencode debug config`.
Expected: OpenCode installs it and the log has `server` and `config` lines. If the `file:` spec is rejected, record the error; Task 7 then verifies by extracting the tarball and loading the directory instead.

- [ ] **Step 7: Report**

Write down, for the controller: (a) directory spec resolved `./server` or `main`; (b) tarball spec worked or not; (c) exact skill-directory wording; (d) `shell.env` received `sessionID`; (e) config isolation worked. If (a) was `main`, the spec must be revised before continuing, because a checkout loaded by path would hit `src/index.js`.

---

### Task 1: Move the OpenCode fixture builder into the shared helpers

The CLI tests in Task 3 need the same SQLite fixture the adapter tests build. Move it, change nothing about what it writes.

**Files:**
- Modify: `test/helpers.js`
- Modify: `test/opencode.test.js:1-138`

**Interfaces:**
- Produces: `hasNodeSqlite(): boolean`, `writeOpencodeFixture(dir, { projects, sessions, messages, parts }): string` (creates `dir` if needed, returns the `opencode.db` path), `opencodeTaskPart({ id, sessionId, messageId, status, start, end, description, subagentType, childSessionId, modelId, providerId }): object`, all exported from `test/helpers.js`.

- [ ] **Step 1: Add the builders to `test/helpers.js`**

Add `import { createRequire } from 'node:module';` to the imports if absent, plus `const require = createRequire(import.meta.url);` below them. Then append the function bodies of `detectSqlite`, `buildFixtureDb` and `taskPart` from `test/opencode.test.js`, renamed and exported:

```js
/** Node 18 and 20 have no node:sqlite; OpenCode fixtures skip there. */
export function hasNodeSqlite() {
  try {
    require('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a real opencode.db in `dir` with exactly the tables and columns the
 * OpenCode adapter reads, inserting rows shaped like real OpenCode data.
 */
export function writeOpencodeFixture(dir, { projects = [], sessions = [], messages = [], parts = [] }) {
  fs.mkdirSync(dir, { recursive: true });
  // …the body of buildFixtureDb, unchanged from `const { DatabaseSync } = …` to `return dbPath;`
}

export function opencodeTaskPart({ id, sessionId, messageId, status, start, end, description, subagentType, childSessionId, modelId, providerId }) {
  // …the body of taskPart, unchanged
}
```

Copy the bodies verbatim; the `// …` lines above mark where they go, not code to write. Keep whatever `fs`/`path` imports `helpers.js` already has, adding either one if missing.

- [ ] **Step 2: Use them from `test/opencode.test.js`**

Delete `detectSqlite`, `buildFixtureDb`, `taskPart` and the `createRequire`/`require` lines that only they used (keep `require` if any remaining test still calls it; `grep -n "require(" test/opencode.test.js` tells you). Change the helpers import and the call sites:

```js
import {
  hasNodeSqlite,
  makeTempDir,
  opencodeTaskPart as taskPart,
  removeDir,
  withEnv,
  writeOpencodeFixture as buildFixtureDb,
} from './helpers.js';

const hasSqlite = hasNodeSqlite();
```

- [ ] **Step 3: Run the tests**

Run: `pnpm run test`
Expected: PASS, the same number of tests as before the move.

- [ ] **Step 4: Commit**

```bash
git add test/helpers.js test/opencode.test.js
git commit -m "Share the OpenCode SQLite fixture builder between test files"
```

---

### Task 2: OpenCode adapter reads the session it runs in

**Files:**
- Modify: `src/adapters/opencode.js` (near the top-level constants, and `currentSession()` at ~line 207)
- Test: `test/opencode.test.js`

**Interfaces:**
- Consumes: `withEnv` from `test/helpers.js`; the existing fixture ids `ROOT_A` (newest, dispatches), `ROOT_B` (older, dispatches), `ROOT_C` (dispatches nothing, directory `C:\Users\dev\proj-c`, project `proj1` named `proj-a`), `CHILD_B1` (child of `ROOT_B`), `CHILD_A2_1` (grandchild of `ROOT_A`).
- Produces: `export const SESSION_ENV_VAR = 'OPENCODE_SESSION_ID'` from `src/adapters/opencode.js`; `OpencodeAdapter#currentSessionId(): string | null` returning the **top-level** session id when the named id is in the database, the raw id when it is not, and null when the variable is unset or blank.

- [ ] **Step 1: Write the failing tests**

Inside the `describe('OpencodeAdapter', …)` block, after the existing `falls back to the newest session…` test. Also wrap that existing test's body in `withEnv({ OPENCODE_SESSION_ID: null }, () => { … })`, so it does not break when the suite runs inside OpenCode with the plugin loaded.

```js
  it('has no current session id when the environment names none', () => {
    withEnv({ OPENCODE_SESSION_ID: null }, () => {
      assert.equal(adapter.currentSessionId(), null);
    });
    withEnv({ OPENCODE_SESSION_ID: '   ' }, () => {
      assert.equal(adapter.currentSessionId(), null);
    });
  });

  it('prefers the session the environment names over a newer one', () => {
    withEnv({ OPENCODE_SESSION_ID: ` ${ROOT_B} ` }, () => {
      assert.equal(adapter.currentSessionId(), ROOT_B);
      assert.equal(adapter.currentSession().sessionId, ROOT_B);
    });
  });

  it('resolves a subagent session id to its top-level session', () => {
    withEnv({ OPENCODE_SESSION_ID: CHILD_B1 }, () => {
      assert.equal(adapter.currentSessionId(), ROOT_B);
      assert.equal(adapter.currentSession().sessionId, ROOT_B);
    });
    withEnv({ OPENCODE_SESSION_ID: CHILD_A2_1 }, () => {
      assert.equal(adapter.currentSession().sessionId, ROOT_A);
    });
  });

  it('returns a named session that dispatched nothing as empty, not another session', () => {
    withEnv({ OPENCODE_SESSION_ID: ROOT_C }, () => {
      const current = adapter.currentSession();
      assert.equal(current.sessionId, ROOT_C);
      assert.equal(current.agents.length, 0);
      assert.equal(current.provider, 'opencode');
      assert.equal(current.projectPath, 'C:\\Users\\dev\\proj-c');
      assert.equal(current.project, 'proj-a');
    });
  });

  it('falls back to the newest session, keeping the raw id, when the named id is unknown', () => {
    withEnv({ OPENCODE_SESSION_ID: 'ses_not_in_this_database' }, () => {
      assert.equal(adapter.currentSessionId(), 'ses_not_in_this_database');
      assert.equal(adapter.currentSession().sessionId, ROOT_A);
    });
  });

  it('keeps the raw id and finds no session when there is no database', () => {
    const empty = makeTempDir();
    try {
      const bare = new OpencodeAdapter(empty);
      withEnv({ OPENCODE_SESSION_ID: ROOT_A }, () => {
        assert.equal(bare.currentSessionId(), ROOT_A);
        assert.equal(bare.currentSession(), null);
      });
    } finally {
      removeDir(empty);
    }
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/opencode.test.js`
Expected: FAIL, `adapter.currentSessionId is not a function`.

- [ ] **Step 3: Implement**

In `src/adapters/opencode.js`, next to the other module constants:

```js
/**
 * OpenCode sets no session variable itself. agent-observer's OpenCode plugin
 * exports this one to shell commands from the session they run in.
 */
export const SESSION_ENV_VAR = 'OPENCODE_SESSION_ID';
```

Replace the doc comment and body of `currentSession()` and add the two methods below inside the class:

```js
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
```

Check the file already imports `Session` and `baseName`, and defines `PROVIDER` and `asDate` (it does in 0.4.0: `readSessions` uses all four).

- [ ] **Step 4: Run the tests**

Run: `node --test test/opencode.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/opencode.js test/opencode.test.js
git commit -m "Read the current OpenCode session from OPENCODE_SESSION_ID"
```

---

### Task 3: `current` prefers an adapter that knows its session

**Files:**
- Modify: `src/cli.js` (`findCurrent`, ~line 278)
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `OpencodeAdapter#currentSessionId()` from Task 2; `hasNodeSqlite`, `writeOpencodeFixture`, `opencodeTaskPart` from Task 1.
- Produces: `findCurrent(args)` with unchanged return shape `{ session, requestedId, exact } | null`.

- [ ] **Step 1: Isolate the existing end-to-end tests**

In `test/cli.test.js`, add `OPENCODE_SESSION_ID: null,` to the object returned by `fixtureEnv()` in `describe('cli end to end')`, so those tests do not pick up a real session id when run inside OpenCode.

- [ ] **Step 2: Write the failing tests**

Add `hasNodeSqlite, opencodeTaskPart, writeOpencodeFixture` to the helpers import, then add a new block at the end of the file:

```js
describe('current across agents', { skip: !hasNodeSqlite() && 'node:sqlite is not available on this Node version' }, () => {
  const CLAUDE_ID = 'dddddddd-1111-2222-3333-444444444444';
  const OPENCODE_ID = 'ses_opencode_root';
  let root;

  before(() => {
    root = makeTempDir();
    writeClaudeFixture(root, {
      [CLAUDE_ID]: {
        project: 'C--work-demo',
        cwd: '/work/demo',
        agents: [{ id: 'agent-1', model: 'haiku', description: 'Claude Code implementation', startedAt: '2026-08-14T13:34:55.000Z', finishedAt: '2026-08-14T13:36:23.000Z' }],
      },
    });
    writeOpencodeFixture(path.join(root, 'opencode'), {
      sessions: [
        { id: OPENCODE_ID, parent_id: null, directory: '/work/other', agent: 'build', model: { id: 'gpt-5', providerID: 'openai' }, time_created: 1_000_000_000_000, time_updated: 1_000_000_100_000 },
        { id: 'ses_opencode_child', parent_id: OPENCODE_ID, agent: 'explore', model: { id: 'gpt-5', providerID: 'openai' } },
      ],
      parts: [
        opencodeTaskPart({ id: 'prt-1', sessionId: OPENCODE_ID, messageId: 'msg-1', status: 'completed', start: 1_000_000_010_000, end: 1_000_000_060_000, description: 'OpenCode exploration', subagentType: 'explore', childSessionId: 'ses_opencode_child', modelId: 'gpt-5', providerId: 'openai' }),
      ],
    });
  });

  after(() => removeDir(root));

  const runCurrent = async (vars) => {
    const capture = captureIo();
    const code = await withEnv(
      {
        CLAUDE_CONFIG_DIR: root,
        CODEX_HOME: root,
        XDG_DATA_HOME: root,
        AGENT_OBSERVER_EVENTS: null,
        CLAUDE_CODE_SESSION_ID: null,
        CLAUDE_SESSION_ID: null,
        OPENCODE_SESSION_ID: null,
        NO_COLOR: '1',
        ...vars,
      },
      () => main(['current'], capture.io),
    );
    return { code: await code, stdout: capture.stdout };
  };

  it('reports the OpenCode session the environment names, not a guessed Claude Code one', async () => {
    const { code, stdout } = await runCurrent({ OPENCODE_SESSION_ID: OPENCODE_ID });
    assert.equal(code, EXIT_OK);
    assert.match(stdout, new RegExp(OPENCODE_ID));
    assert.match(stdout, /OpenCode exploration/);
    assert.doesNotMatch(stdout, /Claude Code implementation/);
  });

  it('keeps reporting the Claude Code session when that is the one named', async () => {
    const { code, stdout } = await runCurrent({ CLAUDE_CODE_SESSION_ID: CLAUDE_ID, OPENCODE_SESSION_ID: OPENCODE_ID });
    assert.equal(code, EXIT_OK);
    assert.match(stdout, /Claude Code implementation/);
  });

  it('warns when the named OpenCode session is unknown and it falls back', async () => {
    const { code, stdout } = await runCurrent({ OPENCODE_SESSION_ID: 'ses_unknown' });
    assert.equal(code, EXIT_OK);
    assert.match(stdout, /has no recorded subagents/);
  });
});
```

`before`, `path`, `EXIT_OK`, `main`, `captureIo`, `makeTempDir`, `removeDir`, `withEnv` and `writeClaudeFixture` are already imported by this file; add any that are not.

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test test/cli.test.js`
Expected: the first new test FAILS (stdout shows `Claude Code implementation`); the other two PASS.

- [ ] **Step 4: Implement**

Replace `findCurrent` in `src/cli.js`:

```js
export function findCurrent(args) {
  const adapters = resolveAdapters(args.adapter);
  const named = adapters.filter((adapter) => {
    try {
      return Boolean(adapter.currentSessionId && adapter.currentSessionId());
    } catch {
      return false;
    }
  });
  const ordered = [...named, ...adapters.filter((adapter) => !named.includes(adapter))];

  for (const adapter of ordered) {
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
```

Keep its existing doc comment; it already describes this behaviour.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.js test/cli.test.js
git commit -m "Prefer the adapter that knows the current session over one that guesses"
```

---

### Task 4: The OpenCode plugin module

**Files:**
- Create: `opencode/hooks.js`
- Create: `opencode/plugin.js`
- Create: `test/opencode-plugin.test.js`
- Modify: `scripts/check-syntax.mjs` (the `['bin', 'src', 'scripts', 'test']` list)

**Interfaces:**
- Produces, from `opencode/hooks.js`: `COMMAND_NAME = 'subagent-report'`, `SESSION_ENV_VAR = 'OPENCODE_SESSION_ID'`, `toForwardSlashes(p: string): string`, `readCommand(file: string, packageRoot: string): { template: string, description?: string }`, `applyConfig(config: object, packageRoot: string): void`, `applySessionEnv(input: { sessionID?: string }, output: { env: object }): void`.
- Produces, from `opencode/plugin.js`: `export default { id: 'agent-observer', server }`, where `server(input, options)` resolves to `{ config(config), 'shell.env'(input, output) }`.

`hooks.js` repeats the variable name rather than importing it from `src/adapters/opencode.js`, so the plugin never loads the adapter (and `node:sqlite`) inside OpenCode's Bun. The test pins the two constants together.

- [ ] **Step 1: Write the failing tests**

`test/opencode-plugin.test.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import plugin from '../opencode/plugin.js';
import * as pluginModule from '../opencode/plugin.js';
import {
  COMMAND_NAME,
  SESSION_ENV_VAR,
  applyConfig,
  applySessionEnv,
  readCommand,
  toForwardSlashes,
} from '../opencode/hooks.js';
import { SESSION_ENV_VAR as ADAPTER_SESSION_ENV_VAR } from '../src/adapters/opencode.js';
import { makeTempDir, removeDir } from './helpers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('OpenCode plugin module', () => {
  it('exports only a V1 default with the plugin id and a server function', () => {
    assert.deepEqual(Object.keys(pluginModule), ['default']);
    assert.equal(plugin.id, 'agent-observer');
    assert.equal(typeof plugin.server, 'function');
  });

  it('returns config and shell.env hooks from server', async () => {
    const hooks = await plugin.server({}, {});
    assert.equal(typeof hooks.config, 'function');
    assert.equal(typeof hooks['shell.env'], 'function');

    const config = {};
    await hooks.config(config);
    assert.deepEqual(config.skills.paths, [path.join(repoRoot, 'skills')]);
    assert.ok(config.command[COMMAND_NAME].template);
  });

  it('uses the same session variable the adapter reads', () => {
    assert.equal(SESSION_ENV_VAR, ADAPTER_SESSION_ENV_VAR);
  });
});

describe('OpenCode plugin hooks', () => {
  it('turns a Windows path into forward slashes on any platform', () => {
    assert.equal(toForwardSlashes('C:\\Users\\dev\\agent-observer'), 'C:/Users/dev/agent-observer');
    assert.equal(toForwardSlashes('/home/dev/agent-observer'), '/home/dev/agent-observer');
  });

  it('adds the skills directory once, keeping paths already there', () => {
    const config = { skills: { paths: ['/elsewhere/skills'] } };
    applyConfig(config, repoRoot);
    applyConfig(config, repoRoot);
    assert.deepEqual(config.skills.paths, ['/elsewhere/skills', path.join(repoRoot, 'skills')]);
  });

  it('builds the command from the shipped command file with an absolute CLI path', () => {
    const config = {};
    applyConfig(config, repoRoot);
    const command = config.command[COMMAND_NAME];

    assert.doesNotMatch(command.template, /\$\{CLAUDE_PLUGIN_ROOT\}/);
    assert.doesNotMatch(command.template, /^---/);
    assert.match(command.template, /\$ARGUMENTS/);
    assert.match(command.description, /subagents/);

    const cli = `${toForwardSlashes(repoRoot)}/bin/agent-observer.js`;
    assert.ok(command.template.includes(cli), `template should name ${cli}`);
    assert.ok(fs.existsSync(cli));
  });

  it('leaves a user-defined command exactly as it was', () => {
    const mine = { template: 'my own report', description: 'mine' };
    const config = { command: { [COMMAND_NAME]: mine } };
    applyConfig(config, repoRoot);
    assert.equal(config.command[COMMAND_NAME], mine);
    assert.deepEqual(mine, { template: 'my own report', description: 'mine' });
  });

  it('reads a command file with CRLF line endings and no description', () => {
    const dir = makeTempDir();
    try {
      const file = path.join(dir, 'x.md');
      fs.writeFileSync(file, '---\r\nallowed-tools: Bash\r\n---\r\n\r\nRun node "${CLAUDE_PLUGIN_ROOT}/bin/x.js" $ARGUMENTS\r\n');
      const command = readCommand(file, 'C:\\pkg');
      assert.equal(command.template, 'Run node "C:/pkg/bin/x.js" $ARGUMENTS');
      assert.equal('description' in command, false);
    } finally {
      removeDir(dir);
    }
  });

  it('exports the session id to shell commands only when there is one', () => {
    const withId = { env: {} };
    applySessionEnv({ cwd: '/x', sessionID: 'ses_abc' }, withId);
    assert.deepEqual(withId.env, { OPENCODE_SESSION_ID: 'ses_abc' });

    for (const input of [{ cwd: '/x' }, { cwd: '/x', sessionID: '' }, {}]) {
      const output = { env: {} };
      applySessionEnv(input, output);
      assert.deepEqual(output.env, {});
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/opencode-plugin.test.js`
Expected: FAIL, `Cannot find module …/opencode/plugin.js`.

- [ ] **Step 3: Implement `opencode/hooks.js`**

```js
/**
 * The logic behind agent-observer's OpenCode plugin hooks.
 *
 * Kept apart from plugin.js because OpenCode treats every export of a plugin
 * module that is not a V1 default as a plugin of its own. This file must not
 * import the adapters: the plugin runs inside OpenCode's Bun, which has no
 * node:sqlite.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const COMMAND_NAME = 'subagent-report';

/** Must match SESSION_ENV_VAR in src/adapters/opencode.js; a test pins them. */
export const SESSION_ENV_VAR = 'OPENCODE_SESSION_ID';

/** Node accepts forward slashes on Windows, and they survive every shell's quoting. */
export function toForwardSlashes(p) {
  return p.replace(/\\/g, '/');
}

/**
 * An OpenCode command built from a Claude Code command file: the body becomes
 * the template, with the plugin root spelled out, and the frontmatter
 * description is kept.
 */
export function readCommand(file, packageRoot) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const frontmatter = match ? match[1] : '';
  const body = match ? match[2] : text;

  const command = {
    template: body.split('${CLAUDE_PLUGIN_ROOT}').join(toForwardSlashes(packageRoot)).trim(),
  };
  const description = /^description:\s*(.+)$/m.exec(frontmatter);
  if (description) command.description = description[1].trim().replace(/^["']|["']$/g, '');
  return command;
}

/** Register the bundled skills and command in OpenCode's live config. */
export function applyConfig(config, packageRoot) {
  const skillsDir = path.join(packageRoot, 'skills');
  config.skills = config.skills || {};
  config.skills.paths = config.skills.paths || [];
  if (!config.skills.paths.includes(skillsDir)) config.skills.paths.push(skillsDir);

  config.command = config.command || {};
  if (!config.command[COMMAND_NAME]) {
    config.command[COMMAND_NAME] = readCommand(
      path.join(packageRoot, 'commands', `${COMMAND_NAME}.md`),
      packageRoot,
    );
  }
}

/** Tell the CLI which OpenCode session a shell command runs in. */
export function applySessionEnv(input, output) {
  const sessionId = input && typeof input.sessionID === 'string' ? input.sessionID : '';
  if (sessionId) output.env[SESSION_ENV_VAR] = sessionId;
}
```

- [ ] **Step 4: Implement `opencode/plugin.js`**

```js
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
```

- [ ] **Step 5: Lint the new directory**

In `scripts/check-syntax.mjs`, change `['bin', 'src', 'scripts', 'test']` to `['bin', 'src', 'scripts', 'test', 'opencode']`.

- [ ] **Step 6: Run the checks**

Run: `node --test test/opencode-plugin.test.js && pnpm run lint`
Expected: PASS, and the lint output lists `ok   opencode/hooks.js` and `ok   opencode/plugin.js`.

- [ ] **Step 7: Commit**

```bash
git add opencode/ test/opencode-plugin.test.js scripts/check-syntax.mjs
git commit -m "Add an OpenCode server plugin that registers the skill and command"
```

---

### Task 5: Publish the plugin entrypoint and validate it

**Files:**
- Modify: `package.json`
- Modify: `scripts/validate-plugin.mjs` (new section before `// -- report`)

**Interfaces:**
- Consumes: `opencode/plugin.js` from Task 4.
- Produces: `package.json` `exports["./server"] === "./opencode/plugin.js"`, `files` includes `"opencode/"`.

- [ ] **Step 1: Add the validation first**

In `scripts/validate-plugin.mjs`, before `// -- report ---…`:

```js
// -- OpenCode plugin entrypoint --------------------------------------------

// OpenCode resolves an npm plugin through exports["./server"]. A missing or
// unpublished entry installs a package that silently loads nothing.
const pkg = readJson('package.json');
if (pkg) {
  const serverEntry = pkg.exports && pkg.exports['./server'];
  if (typeof serverEntry !== 'string') {
    fail('package.json exports has no "./server" entry for the OpenCode plugin.');
  } else {
    const relative = serverEntry.replace(/^\.\//, '');
    if (!existsSync(path.join(repoRoot, relative))) {
      fail(`package.json exports "./server" points at missing file '${serverEntry}'.`);
    }
    const published = (pkg.files || []).some((entry) => {
      const prefix = entry.replace(/^\.\//, '');
      return prefix.endsWith('/') ? relative.startsWith(prefix) : relative === prefix;
    });
    if (!published) fail(`package.json files does not publish '${serverEntry}'.`);
    notes.push(`opencode plugin ${serverEntry}`);
  }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm run validate-plugin`
Expected: FAIL, `package.json exports has no "./server" entry for the OpenCode plugin.`

- [ ] **Step 3: Update `package.json`**

Add `"./server": "./opencode/plugin.js"` as the last entry of `exports`, `"opencode/"` after `"commands/"` in `files`, and `"opencode"` after `"claude-code"` in `keywords`. Change `description` to `"See which subagents your coding agent ran, with which model, for which task. Works with Claude Code and OpenCode out of the box."`.

- [ ] **Step 4: Run it to verify it passes, then prove the unpublished case fails**

Run: `pnpm run validate-plugin`
Expected: PASS, with `ok   opencode plugin ./opencode/plugin.js`.

Temporarily remove `"opencode/"` from `files`, run `pnpm run validate-plugin`, expect `FAIL package.json files does not publish './opencode/plugin.js'.`, then restore it and rerun to PASS.

- [ ] **Step 5: Check the packed contents**

Run: `pnpm pack --pack-destination "$TMPDIR_OF_YOUR_CHOICE"` then `tar -tzf <that .tgz>`
Expected: the listing contains `package/opencode/plugin.js`, `package/opencode/hooks.js`, `package/skills/agent-observer/SKILL.md`, `package/commands/subagent-report.md` and `package/bin/agent-observer.js`. Delete the tarball afterwards; do not commit it.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/validate-plugin.mjs
git commit -m "Publish the OpenCode plugin entrypoint and validate it"
```

---

### Task 6: Document the plugin

**Files:**
- Modify: `skills/agent-observer/SKILL.md` ("Running it")
- Modify: `README.md` ("Install", "Updating", "Other agents")
- Modify: `CHANGELOG.md` (`## [Unreleased]`)

- [ ] **Step 1: `SKILL.md`**

In "Running it", after the paragraph that ends "no shell-specific syntax is needed.", add (adjust only the quoted wording of how OpenCode shows the directory, to what Task 0 recorded):

````markdown
Outside Claude Code, as in OpenCode, `${CLAUDE_PLUGIN_ROOT}` is not set. The
tool is then `bin/agent-observer.js` two directories above this skill's own
directory, which OpenCode shows when it loads the skill. Run it with Node,
version 22 or newer for OpenCode data, quoting the path and using forward
slashes:

```bash
node "<skill directory>/../../bin/agent-observer.js" <command>
```
````

- [ ] **Step 2: `README.md` install**

After the Claude Code plugin block (the one ending `/plugin install agent-observer@agent-observer-marketplace` and its closing fence), add:

````markdown
**As an OpenCode plugin**, which also installs the skill and the
`/subagent-report` command. Add it to the `plugin` list in `opencode.json`,
globally or per project, and restart OpenCode:

```json
{
  "plugin": ["agent-observer"]
}
```

The plugin runs the tool with the Node on your `PATH`, which must be version 22
or newer to read OpenCode's database. It also passes the id of the session you
are in, so `current` reports that session rather than guessing. Tested with
OpenCode 1.18.30.

A `subagent-report` command you already defined in `opencode.json` takes
precedence over the plugin's. Remove it to use the one the plugin ships.
````

In "Updating", after the npm/pnpm update block, add:

````markdown
As an OpenCode plugin, pin a version or restart OpenCode to pick up a new one:

```json
{
  "plugin": ["agent-observer@0.5.0"]
}
```
````

Use the version the next release will carry; if the release is not yet decided, use the current `package.json` version and let `docs/releasing.md`'s steps update it.

In "Other agents", append to the `opencode` row's description: ` Installed as an OpenCode plugin, it reads the session you are in.`

- [ ] **Step 3: `CHANGELOG.md`**

Under `## [Unreleased]`:

```markdown
### Added

- An OpenCode plugin, shipped in the same npm package. Adding `"agent-observer"`
  to the `plugin` list in `opencode.json` installs the `agent-observer` skill
  and the `/subagent-report` command, both running the bundled tool with Node,
  with no global install. A `subagent-report` command already defined in
  `opencode.json` is left in place and takes precedence.
- The OpenCode adapter reads the session it runs in from `OPENCODE_SESSION_ID`,
  which the plugin sets, resolving a subagent's session to its top-level
  session.

### Fixed

- `current` could report a Claude Code session when run from inside another
  agent, because the Claude Code adapter was asked first and guessed. Adapters
  that know the running session are now asked before any that guess.
```

- [ ] **Step 4: Run the checks**

Run: `pnpm run verify`
Expected: PASS, including `check-docs` and `validate-plugin`.

- [ ] **Step 5: Commit**

```bash
git add skills/agent-observer/SKILL.md README.md CHANGELOG.md
git commit -m "Document installing agent-observer as an OpenCode plugin"
```

---

### Task 7: Verify against real OpenCode and real data

Not a code task. Reuse the isolated config approach from Task 0 so the user's `opencode.json` is never read or changed.

- [ ] **Step 1: Full verification**

Run: `pnpm run verify`
Expected: every step passes. Read the output; do not infer from the exit code alone.

- [ ] **Step 2: Real data**

Run: `node bin/agent-observer.js doctor` and `node bin/agent-observer.js sessions`
Expected: `doctor` reports the OpenCode adapter available on Node 24; `sessions` lists real Claude Code and OpenCode sessions.

- [ ] **Step 3: Load the packed package in OpenCode**

`pnpm pack` into the scratchpad. Load it the way Task 0 established works: the `agent-observer@file:<tgz>` spec, or else the extracted `package/` directory as a path spec. Use an isolated config home whose `opencode.json` contains only that `plugin` entry.

Run: `XDG_CONFIG_HOME=<isolated> opencode debug skill`
Expected: `agent-observer` listed, located inside the installed package.

Run: `XDG_CONFIG_HOME=<isolated> opencode debug config --print-logs 2>&1 | grep -i "agent-observer"`
Expected: the plugin loads with no error.

- [ ] **Step 4: Run the command and the skill inside OpenCode**

In a project directory where OpenCode has a session that dispatched subagents (or first run one that dispatches a `task`, for example `opencode run --auto 'Use the task tool with the explore subagent to list the files in this directory, then stop.'`):

Run: `XDG_CONFIG_HOME=<isolated> opencode run --auto --command subagent-report current`
Expected: the reply contains a table whose header names an OpenCode session id (`ses…`) with provider `opencode`, not a Claude Code session, and no fallback warning.

Run: `XDG_CONFIG_HOME=<isolated> opencode run --auto 'Which subagents did you use in this session, and with which model?'` in a session that dispatched one.
Expected: the model loads the `agent-observer` skill and runs `node ".../bin/agent-observer.js" current`, and the report shows that session.

- [ ] **Step 5: Report**

Give the user the actual output of each step. If any expectation failed, use superpowers:systematic-debugging before changing code.

---

## After the plan

- superpowers:requesting-code-review for the whole branch, on the most capable model.
- superpowers:finishing-a-development-branch. The PR description includes the `agent-observer session <id> --format markdown --no-color` table for the session that built it, per `CLAUDE.md`, and no test-run counts.
- Releasing (a version bump is required because `SKILL.md` changed) follows `docs/releasing.md` and is a separate maintainer step.
- Tell the user their hand-written `command.subagent-report` in `~/.config/opencode/opencode.json` will shadow the plugin's, and offer to remove it; do not edit it unasked.
