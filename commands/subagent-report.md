---
description: Report the subagents this session dispatched, with the model and task for each.
argument-hint: "[session-id|--all|--tree|--models|--since 7d]"
allowed-tools: Bash
---

Report subagent activity using the bundled agent-observer tool.

Arguments given: `$ARGUMENTS`

Pick the command from those arguments:

- empty, or `--current` -> `current`
- `--tree` -> `tree`
- `--models` -> `models`
- `--all` -> `sessions`
- `--timeline` -> `timeline`
- `--json` -> `export --format json`
- anything that looks like a session id -> `session <that id>`

Pass through any `--since`, `--project`, `--model`, `--role` or `--limit` flags
the user supplied.

Run it with `--no-color` so the output quotes cleanly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/agent-observer.js" <command> --no-color
```

Then show the output and add one or two sentences on what the model routing
shows: which models handled implementation, which handled review, and anything
that looks unintended. If nothing is found, run `doctor` and report what it says
rather than guessing at a cause.
