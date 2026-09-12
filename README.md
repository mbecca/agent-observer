# agent-observer

See which subagents your coding agent ran, with which model, for which task.

Orchestrators like [Superpowers](https://github.com/obra/superpowers) route work
across models: a cheap one to implement, a stronger one to review, the strongest
for a final pass. Whether that actually happened is a separate question from
whether it was planned. Claude Code writes a metadata file for every subagent it
dispatches, recording the model that really ran it. This reads those files.

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

**As a command line tool:**

```bash
npm install -g agent-observer
```

**From source:**

```bash
git clone https://github.com/mbecca/agent-observer.git
cd agent-observer
node bin/agent-observer.js current
```

## Use

```bash
agent-observer current          # the session you are in, or the most recent one
agent-observer tree             # how that session was orchestrated
agent-observer sessions         # every session that dispatched subagents
agent-observer session <id>     # one session, by id or unambiguous prefix
agent-observer models           # model usage across sessions
agent-observer timeline         # a flat, time-ordered stream
agent-observer watch            # new dispatches as they happen
agent-observer export           # machine-readable output
agent-observer adapters         # what each adapter can observe here
agent-observer doctor           # why you are seeing nothing
```

A session report:

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
| `-f, --format <fmt>` | `table`, `tree`, `timeline`, `summary`, `json`, `ndjson`, `csv`, `markdown`. |
| `-o, --output <file>` | Write to a file instead of stdout. |
| `--no-color` | No ANSI escapes. Also honours `NO_COLOR`. |

```bash
agent-observer models --since 30d
agent-observer sessions --project my-repo --format markdown
agent-observer export --role review --format csv -o reviews.csv
```

## In Claude Code

Installed as a plugin, ask in plain language:

> What subagents did you use, and which model ran each one?

The bundled skill runs the tool and reports from its output rather than from
memory, which is the point. There is also a slash command:

```
/subagent-report
/subagent-report --tree
/subagent-report --models --since 7d
```

## How it works

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

```bash
npm test              # Node's built-in test runner
npm run lint          # parse every file
npm run validate-plugin
npm run check-version
npm run verify        # all of the above
```

No dependencies, runtime or development. Tests run against fixture directories
written in the real on-disk shape rather than against mocks.

Releasing is tag-driven:

```bash
npm version minor
node scripts/sync-version.mjs
# add a CHANGELOG.md entry
git commit -am "Release v0.2.0" && git push --follow-tags
```

CI verifies on Windows, Linux and macOS across Node 18, 20, 22 and 24. The
release workflow refuses to publish unless the tag, `package.json`,
`plugin.json`, `marketplace.json`, `src/version.js` and the changelog all agree.

## Licence

MIT. See [LICENSE](LICENSE).
