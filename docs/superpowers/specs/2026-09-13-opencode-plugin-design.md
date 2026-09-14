# OpenCode plugin

**Status:** approved, ready for an implementation plan
**Date:** 2026-09-13

## Problem

Inside OpenCode, agent-observer is only usable after `npm install -g
agent-observer` plus a hand-written `command` entry in `opencode.json`. Claude
Code users get a plugin that brings a skill and a slash command; OpenCode users
get neither, and the hand-written command they end up with drifts from the one
this repository ships.

There is also a correctness bug on that path. `current` asks each adapter in
turn and takes the first session any of them returns. The Claude Code adapter
comes first, and with no session variable in the environment it falls back to
the newest Claude Code session under the current directory. Run from inside
OpenCode, `current` can therefore present a Claude Code session as the one the
user is in. `findCurrent` in `src/cli.js` says it prefers "an adapter that
knows it outright", but the code does not do that.

## Decision

Ship an OpenCode server plugin from the same npm package. A user adds
`"plugin": ["agent-observer"]` to `opencode.json`, restarts OpenCode, and gets
the `agent-observer` skill and the `/subagent-report` command, both running the
bundled CLI with Node. The plugin also tells the CLI which OpenCode session it
is running in, so `current` stops guessing.

### What was rejected, and why

**Importing the core into the plugin and running it in-process.** OpenCode runs
plugins inside its bundled Bun (1.3.14 in OpenCode 1.18.30), and there
`require('node:sqlite')` fails with "No such built-in module". The OpenCode
adapter depends on `node:sqlite`, so the plugin could not read the data it
exists to read. Adding a `bun:sqlite` driver to the adapter was also rejected:
a second SQLite driver to test and maintain, for users who have OpenCode but no
Node 22.

**A native OpenCode tool** (`agent_observer`) instead of a skill. More code,
likely a dependency on `@opencode-ai/plugin`, and it does not match what the
Claude Code plugin offers.

**A separate `opencode/` copy of the skill and command.** Two copies of the same
instructions drift. The plugin reuses the files Claude Code already uses.

**Rewriting bash commands** in a `tool.execute.before` hook so that
`agent-observer …` becomes `node "<path>" …`. It would let the instructions stay
identical to the global install, but it silently changes commands the model
runs, which is hard to debug and surprising to a user reading the log.

**A separate npm package** such as `opencode-agent-observer`. One package, one
version, one release.

## Runtime requirement

The plugin runs the CLI as `node <package>/bin/agent-observer.js`, so Node must
be on `PATH`. Reading OpenCode data needs Node 22 or newer, because of
`node:sqlite`. This is documented, not worked around. With an older Node,
`doctor` already explains why the OpenCode adapter is unavailable.

## Components

### `opencode/plugin.js` (new)

Plain ESM JavaScript, no imports beyond `node:` built-ins, no dependency on
`@opencode-ai/plugin`. It lives outside `src/`, because it is OpenCode-specific
and `src/core/` must know nothing about any agent.

Default export, the V1 module shape OpenCode's loader reads:

```js
export default { id: 'agent-observer', server };
```

`server(input, options)` resolves the package root from `import.meta.url` and
returns two hooks.

**`config(config)`**, which mutates OpenCode's live merged config:

- Adds `<package>/skills` to `config.skills.paths`, creating `skills` and
  `paths` if absent, and never adding the same path twice.
- Registers `config.command['subagent-report']`, built from
  `commands/subagent-report.md`:
  - `template` is the file body with its frontmatter removed, and every
    `${CLAUDE_PLUGIN_ROOT}` replaced by the package root.
  - `description` is the frontmatter `description`.
  - `$ARGUMENTS` is left untouched; OpenCode uses the same placeholder.
- If `config.command['subagent-report']` already exists, leaves it alone. User
  configuration wins.

The hook logic lives in a sibling `opencode/hooks.js`, which the tests import.
`plugin.js` exports nothing but its default: when a module's default is not a
V1 plugin, OpenCode calls every export as a legacy plugin and throws on any
that is not a function. `hooks.js` must not import the adapters, so the plugin
never loads `node:sqlite` inside Bun.

The package root is written with forward slashes (`C:/Users/…`), which Node
accepts on Windows and which survive bash, PowerShell and cmd quoting alike. The
conversion is a string replacement, not `path.posix`, so a Windows path is
normalised correctly on any platform.

**`shell.env(input, output)`**: when `input.sessionID` is a non-empty string,
sets `output.env.OPENCODE_SESSION_ID` to it. Otherwise sets nothing. OpenCode
calls this hook for the shell tool with the session the command runs in.

The variable is named to mirror `CLAUDE_CODE_SESSION_ID`. If OpenCode ever sets
such a variable itself, it would mean the same thing.

### `src/adapters/opencode.js`

Adds `currentSessionId()`, returning the trimmed `OPENCODE_SESSION_ID` or null.

`currentSession()` becomes:

1. With an id, resolve it to its top-level session by following `parent_id`.
   A shell command run by a subagent carries the subagent's own session id, and
   `sessions()` lists only top-level sessions.
2. If that top-level session dispatched tasks, return it.
3. If it exists but dispatched nothing, return it as an empty `Session`. "This
   session used no subagents" is the true answer.
4. If the id is not in the database, or the database cannot be read, fall back
   to the current heuristic: newest session under cwd, else newest overall.
   `currentSessionId()` still returns the id, so `findCurrent` reports
   `exact: false` and the CLI prints its existing fallback warning.

With no id, behaviour is unchanged.

### `src/cli.js` `findCurrent`

Two passes over the resolved adapters, each wrapped in the existing
per-adapter `try/catch`:

1. Adapters whose `currentSessionId()` returns a value. The first that returns
   a session wins.
2. Every adapter, as today.

No adapter or product is named. Inside Claude Code the result is unchanged,
because the Claude Code adapter already wins the first pass.

### `skills/agent-observer/SKILL.md`

"Running it" keeps the `${CLAUDE_PLUGIN_ROOT}` form for Claude Code and adds
one paragraph: outside Claude Code, as in OpenCode, the CLI is
`bin/agent-observer.js` two directories above this skill's own directory, and is
run with `node`, version 22 or newer for OpenCode data. The exact wording
depends on how OpenCode presents the skill directory to the model, which the
first plan task establishes.

### Packaging and validation

- `package.json`: add `opencode/` to `files`, and `"./server":
  "./opencode/plugin.js"` to `exports`. `"."` and the other exports are
  unchanged. Add `opencode` to `keywords`.
- `scripts/validate-plugin.mjs`: fail when `exports["./server"]` is missing,
  points at a file that does not exist, or at a file not covered by `files`.
- `README.md`: an "As an OpenCode plugin" install section with the one-line
  config, the Node 22 requirement, the OpenCode version tested, how to update,
  and a note that a hand-written `subagent-report` command in `opencode.json`
  shadows the plugin's and should be removed.
- `CHANGELOG.md`: entries under Unreleased.

A release needs a version bump, since `SKILL.md` changes. Releasing is not part
of this work.

## Testing

Fixtures on disk in the real shape, no mocks, Node's built-in runner.

`test/opencode-plugin.test.js` (new), importing `opencode/plugin.js` directly:

- `config` adds the skills path, and adds it once when called twice.
- The registered command's template contains no `${CLAUDE_PLUGIN_ROOT}`, keeps
  `$ARGUMENTS`, and names an absolute forward-slash path to a
  `bin/agent-observer.js` that exists.
- `description` comes from the command file's frontmatter.
- An existing `subagent-report` command is left exactly as it was.
- `shell.env` sets `OPENCODE_SESSION_ID` from `sessionID`, and sets nothing
  when `sessionID` is absent or empty.
- The path normalisation turns a Windows path into forward slashes when the
  test runs on Linux or macOS.

`test/opencode.test.js`, guarded like the existing tests of that adapter on a
Node that has `node:sqlite`:

- `currentSessionId` reads the environment, trimmed, and is null when unset.
- A named session wins over a newer session under cwd.
- A child session id resolves to its top-level session.
- A named session with no tasks comes back empty, not replaced.
- An unknown id falls back to the cwd heuristic.

`test/cli.test.js`:

- With both Claude Code and OpenCode fixtures present and only
  `OPENCODE_SESSION_ID` set, `current` reports the OpenCode session.
- With `CLAUDE_CODE_SESSION_ID` set, the Claude Code session wins as before.
- An unknown `OPENCODE_SESSION_ID` prints the fallback warning.

`pnpm run validate-plugin` catches a broken `./server` export.

## Verification against real OpenCode

Tests do not prove OpenCode loads the plugin. Three checks do, none of which
touch the user's own `opencode.json`:

1. **Probe, before any code.** A temporary config, passed through
   `OPENCODE_CONFIG`, loads a minimal throwaway plugin from this repository by
   path. It establishes that OpenCode 1.18.30 resolves `exports["./server"]`,
   that a command added in the `config` hook appears, that a pushed skills path
   is discovered, that `shell.env` receives `sessionID`, and how the `skill`
   tool shows a skill's directory to the model. If any of these differs from
   this spec, stop and revise the spec before implementing.
2. **The packed tarball.** `pnpm pack`, install the `.tgz` into a temporary
   directory, and load it as a plugin from there. This proves `files` publishes
   `opencode/` and the skill.
3. **Real data.** `pnpm run verify`, then `doctor` and `sessions`, and
   `/subagent-report` run inside OpenCode against a session that dispatched
   subagents.

## Risks

- `shell.env` and the V1 plugin module shape are OpenCode APIs that may change.
  The README states the version tested.
- A user's own `subagent-report` command shadows the plugin's. This is
  deliberate, and documented.
- The skill instruction relies on the model resolving a path relative to the
  skill directory. The probe checks that OpenCode shows that directory, and the
  real-data check confirms a model follows it.
