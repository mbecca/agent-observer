---
name: agent-observer
description: Use when the user asks which subagents ran, what model each subagent or task used, how a session was orchestrated, or wants a report of subagent activity. Triggers on questions like "what subagents did you use?", "which model ran each task?", "show me the subagent report", "how did Superpowers orchestrate this?", "qué subagentes usaste?", "qué modelo usó cada agente?".
---

# Agent Observer

Reports which subagents a coding-agent session dispatched, with which model, for
which task, read from the agent's own on-disk metadata.

## Why read the metadata instead of answering from memory

Claude Code writes a `.meta.json` file for every subagent it dispatches,
recording the model that actually ran it. An assistant's recollection of what it
delegated is not evidence; that file is. **Always run the tool. Never answer
these questions from the conversation.**

## Running it

The plugin bundles the tool, so run it with Node from the plugin root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/agent-observer.js" <command>
```

If the user installed it globally with `npm install -g agent-observer`, the
shorter `agent-observer <command>` works too. The same commands work on Windows,
Linux and macOS; no shell-specific syntax is needed.

## Choosing a command

| The user asks | Run |
|---|---|
| "what subagents did you use?" / "in this session" | `current` |
| "how was this orchestrated?" / "show the tree" | `tree` |
| "which models did each task use?" | `models` |
| "show me every session" | `sessions` |
| "what about session abc123?" | `session abc123` |
| "when did each one run?" | `timeline` |
| a machine-readable dump | `export --format json` |
| "why is it showing nothing?" | `doctor` |

Useful flags: `--since 7d`, `--project <text>`, `--model <text>`,
`--role implement|review|fix|test|plan|explore|document`, `--limit <n>`,
`--format table|tree|timeline|json|ndjson|csv|markdown|html`.

Add `--no-color` whenever you intend to quote the output back to the user, so no
escape codes leak into your reply.

## Reading the output

- **Model per row** is what actually ran, not what a skill or plan asked for.
- **Role** is inferred from the task description, so treat it as a label, not a
  fact from the agent.
- **`inherit`** means the subagent used the session's model; it is a real
  recorded value, not missing data.
- **Duration and turns** come from the subagent's transcript. A subagent with no
  transcript yet shows as `spawned` with no end time.

## Reporting back

Summarise in prose what the routing shows, then include the table or tree. Call
out the pattern, for example cheap models for implementation and stronger ones
for review, and note anything that contradicts what the orchestrator claimed.

If the tool reports no activity, say so plainly. A session that dispatched no
subagents produces no rows, and that is a real answer rather than a failure. Do
not go looking for another session to fill the silence. Run `doctor` before
suggesting anything is broken.

**Check the session id in the header before you report.** When the session you
are in dispatched nothing, `current` says "No subagents recorded for this
session"; answer that the session used none. When it cannot find the session at
all it falls back to the most recent one and prints a line saying so. Repeat
that caveat to the user rather than presenting another session's work as this
one's.

## Other agents

`--adapter` selects which agent's data to read: `claude-code` (full support),
`codex` (session model only, no per-subagent attribution), `opencode` (full
support, read from its SQLite database; needs a Node with `node:sqlite`,
version 22 or newer), `generic` (any agent that emits the common event
format), `auto` for everything with data, or `all`.

Run `adapters` to show what each one can and cannot observe here. When an agent
does not record subagent models, say that outright rather than guessing.
