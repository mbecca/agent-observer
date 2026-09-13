# agent-observer

![Agent Observer. See every agent, every model, every task. A dark dashboard showing agents on the left, the models they ran on in the middle, and on the right a real session report: ten subagents with the model, type, duration and task of each, and a tally of six sonnet, three haiku and one opus.](docs/banner.png)

See which subagents your coding agent ran, with which model, for which task.

Orchestrators route work across models: a cheap one to implement, a stronger one
to review, the strongest for a final pass. Whether that actually happened is a
separate question from whether it was planned.

Agents and harnesses run these workflows by dispatching subagents, each with its
own task and often its own model. Where an agent records what it dispatched,
this reads that record. [Claude Code](https://code.claude.com) and
[Superpowers](https://github.com/obra/superpowers) are the examples used above,
not the scope. The core knows nothing about either, and any agent can be read
the same way, through its own adapter or through the
[common event format](docs/event-format.md).

```bash
agent-observer tree 3a372c2d
```

```
Session 3a372c2d-5be3-43b6-a7d5-29cc9e032cd7
  project  C:\Users\dev\work\my-repo
  provider claude-code   subagents 10

  ├─ Task 1: plan workflow
  │  ├─ + Implement Task 1: plan workflow ....... haiku
  │  └─ ? Review Task 1 (spec + quality) ........ sonnet
  │
  ├─ Task 2: apply workflow
  │  ├─ + Implement Task 2: apply workflow ...... haiku
  │  └─ ? Review Task 2 (spec + quality) ........ sonnet
  │
  ├─ Task 3: AGENTS.md section
  │  ├─ + Implement Task 3: AGENTS.md section ... haiku
  │  └─ ? Review Task 3 (spec + quality) ........ sonnet
  │
  └─ Task 4: verify on PR #26
     ├─ + Implement Task 4: verify on PR #26 .... sonnet
     ├─ ? Final whole-branch review ............. opus
     ├─ * Fix final-review findings ............. sonnet
     └─ ? Scoped re-review of the fix wave ...... sonnet
```

## Install

No runtime dependencies. Node 18.19 or newer, on Windows, Linux or macOS.

**As a Claude Code plugin**, which also installs a skill and a slash command:

```
/plugin marketplace add mbecca/agent-observer
/plugin install agent-observer@agent-observer-marketplace
```

**As a command line tool**, from the npm registry with whichever client you use:

```bash
npm install -g agent-observer
pnpm add -g agent-observer
```

**From source:**

```bash
git clone https://github.com/mbecca/agent-observer.git
cd agent-observer
node bin/agent-observer.js current
```

### Updating

The plugin does not update itself. Both steps are needed:

```
/plugin marketplace update agent-observer-marketplace
/reload-plugins
```

The first fetches the new version. Without the second, the session keeps the
skill and the script it already loaded, so nothing appears to change.

Claude Code caches each version in its own directory, so `--version` tells you
what is actually loaded rather than what was published:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/agent-observer.js" --version
```

Installed from the registry instead:

```bash
npm update -g agent-observer
pnpm update -g agent-observer
```

## Use

```bash
agent-observer current          # the session you are in, as a table
agent-observer tree             # the same subagents, drawn as a tree of tasks
agent-observer session <id>     # another session, by id or unambiguous prefix
agent-observer sessions         # every session that dispatched subagents
agent-observer models           # model usage across sessions
agent-observer timeline         # a flat, time-ordered stream
agent-observer watch            # new dispatches as they happen
agent-observer export           # machine-readable output
agent-observer adapters         # what each adapter can observe here
agent-observer doctor           # why you are seeing nothing
```

The first three are the same report with different defaults. **The command
chooses the session, `--format` chooses how it is drawn**, so `current --format
tree` and `tree` print the same thing. `tree` and `session` take a session id;
`current` never does, because it is always the session you are in.

`agent-observer session 3a372c2d`, which is also what `current` prints for the
session you are in:

```
Session 3a372c2d-5be3-43b6-a7d5-29cc9e032cd7
  provider claude-code   subagents 10
  started  2026-08-14 13:34:55

  #   TIME     MODEL  TYPE            TOOK    TASK
  1   13:34:55 haiku  general-purpose 1m28s   Implement Task 1: plan workflow
  2   13:36:52 sonnet general-purpose 3m34s   Review Task 1 (spec + quality)
  3   13:41:02 haiku  general-purpose 1m19s   Implement Task 2: apply workflow
  4   13:42:53 sonnet general-purpose 1m56s   Review Task 2 (spec + quality)
  5   13:45:19 haiku  general-purpose 1m15s   Implement Task 3: AGENTS.md section
  6   13:47:01 sonnet general-purpose 1m13s   Review Task 3 (spec + quality)
  7   13:49:04 sonnet general-purpose 4m14s   Implement Task 4: verify on PR #26
  8   13:55:11 opus   general-purpose 10m35s  Final whole-branch review
  9   14:07:23 sonnet general-purpose 10m29s  Fix final-review findings
  10  14:18:34 sonnet general-purpose 4m54s   Scoped re-review of the fix wave

  Models
    sonnet  6   ######
    haiku   3   ###
    opus    1   #
```

### Filters

Every command takes them.

| Flag | Effect |
|---|---|
| `--since 7d` | Sessions active in the last 7 days. Also `12h`, `30m`, an ISO date. |
| `--project <text>` | Sessions whose project name or path contains the text. |
| `--model <text>` | Only subagents whose model matches. |
| `--role <role>` | `implement`, `review`, `fix`, `test`, `plan`, `explore`, `document`. |
| `--limit <n>` | At most this many sessions. |
| `--all` | Include sessions that dispatched no subagents. |
| `--adapter <name>` | `claude-code`, `codex`, `generic`, `auto`, `all`. |
| `-f, --format <fmt>` | `table`, `tree`, `timeline`, `summary`, `json`, `ndjson`, `csv`, `markdown`, `html`. |
| `-o, --output <file>` | Write to a file instead of stdout. |
| `--no-color` | No ANSI escapes. Also honours `NO_COLOR`. |

```bash
agent-observer models --since 30d
agent-observer sessions --project my-repo --format markdown
agent-observer export --role review --format csv -o reviews.csv
```

### HTML report

`--format html` writes a single self-contained page: a timeline showing which
model ran each subagent and for how long, plus a short paragraph naming what the
routing did. No JavaScript, nothing fetched over the network, and it prints.

```bash
agent-observer current --format html -o report.html
agent-observer session 3a372c2d --format html -o report.html
agent-observer export --format html -o all-sessions.html
```

The report contains real task descriptions, exactly as `--format markdown` does.
Read it before sending it to anyone.

## In Claude Code

Installed as a plugin, ask in plain language:

> What subagents did you use, and which model ran each one?

The bundled skill runs the tool and reports from its output rather than from
memory, which is the point. There is also a slash command:

```
/agent-observer:subagent-report
/agent-observer:subagent-report tree
/agent-observer:subagent-report models --since 7d
/agent-observer:subagent-report session 3a372c2d
```

Both take the same arguments as the command line tool above, so there is one
vocabulary to learn rather than three. The older flag spellings, `--tree`,
`--models`, `--all`, `--timeline`, `--json`, still work.

Plugin commands are namespaced, and the bare `/subagent-report` works too as
long as nothing else has claimed that name. The skill is
`/agent-observer:agent-observer`.

## How the Claude Code adapter works

Each adapter reads one agent's own files. This is what the first one does; the
shape differs per agent, which is exactly why the core never sees it.

Claude Code records every dispatched subagent:

```
~/.claude/projects/<encoded-project-path>/
  <session-id>.jsonl              the session transcript
  <session-id>/
    subagents/
      agent-<id>.meta.json        {agentType, description, toolUseId,
                                   spawnDepth, model}
      agent-<id>.jsonl            that subagent's own transcript
```

The `.meta.json` gives the model, type, task and spawn depth. The sibling
transcript gives the start and end times and the turn count. The project path
comes from the transcript's own `cwd`, because the encoded directory name
flattens every separator to a hyphen and cannot be reversed reliably.

Set `CLAUDE_CONFIG_DIR` if your Claude Code data lives somewhere else.

## Other agents

The core knows nothing about Claude. Adapters translate each agent's files into
one shared model.

| Adapter | Status |
|---|---|
| `claude-code` | Full support: model, type, task, depth, timing, turns. |
| `codex` | Session model only. Codex rollouts record no per-subagent metadata, and the adapter says so rather than guessing. |
| `generic` | Reads the [common event format](docs/event-format.md) from any agent. |

To make any other agent observable, emit one JSON object per line and point the
generic adapter at it:

```bash
export AGENT_OBSERVER_EVENTS=~/my-agent/events
agent-observer sessions --adapter generic
```

Run `agent-observer adapters` to see what each can and cannot observe on your
machine. To add a real adapter, see [docs/writing-an-adapter.md](docs/writing-an-adapter.md).

## As a library

```js
import { ClaudeCodeAdapter, renderTree, Painter } from 'agent-observer';

const sessions = new ClaudeCodeAdapter().sessions();
console.log(renderTree(sessions[0], new Painter(false)));
console.log(sessions[0].modelCounts()); // { sonnet: 6, haiku: 3, opus: 1 }
```

## What it does not do

- It does not report token usage or cost. Claude Code does not record either in
  the subagent metadata.
- It does not tell you which model *should* have run a task. It reports what did.
- It does not read subagent transcripts for content, only their timestamps and
  line count.

## Development

The project uses [pnpm](https://pnpm.io), pinned through `packageManager` so
everyone runs the same version. `corepack enable` is enough to get it.

```bash
pnpm install             # resolves to nothing; proves the lockfile is in sync
pnpm run test            # Node's built-in test runner
pnpm run lint            # parse every file
pnpm run validate-plugin
pnpm run check-version
pnpm run check-docs
pnpm run verify          # all of the above
```

No dependencies, runtime or development. Tests run against fixture directories
written in the real on-disk shape rather than against mocks.

This project is developed with the [Superpowers](https://github.com/obra/superpowers)
skills, which is fitting: it exists to report how orchestrators route models
across subagents, so it is built by one. [CLAUDE.md](CLAUDE.md) tells a coding
agent which skill to use at which point, and [AGENTS.md](AGENTS.md) states the
same workflow for agents that do not have the plugin. See
[CONTRIBUTING.md](CONTRIBUTING.md) to get started.

CI verifies on Windows, Linux and macOS across Node 18, 20, 22 and 24.

Releasing is tag-driven, and the release workflow refuses to publish unless the
tag, `package.json`, `plugin.json`, `marketplace.json`, `src/version.js` and the
changelog all agree:

```bash
node scripts/sync-version.mjs 0.2.0
# move the Unreleased changelog entries under a 0.2.0 heading
pnpm run verify
git commit -am "Release v0.2.0"
git tag -a v0.2.0 -m "Release v0.2.0"   # -a matters: --follow-tags skips lightweight tags
git push --follow-tags
```

Bump the version for anything a user would notice, including a change to
`SKILL.md`. Claude Code caches the plugin by version, so a fix pushed without a
bump never reaches an installed copy and `/plugin marketplace update` reports
success while changing nothing. [docs/releasing.md](docs/releasing.md) has the
full process and how to choose the number.

## Licence

MIT. See [LICENSE](LICENSE).
