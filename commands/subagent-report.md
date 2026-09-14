---
description: Report the subagents this session dispatched, with the model and task for each.
argument-hint: "[current|tree|sessions|models|timeline|adapters|doctor|session <id>] [--since 7d] [--format md]"
allowed-tools: Bash
---

Report subagent activity using the bundled agent-observer tool.

Arguments given: `$ARGUMENTS`

## Building the command

**Pass the arguments straight through.** They are the tool's own arguments, so
whatever the user typed is usually already correct. The tool's commands are
`current`, `session <id>`, `sessions`, `tree`, `models`, `timeline`, `watch`,
`export`, `adapters` and `doctor`, and its flags are `--since`, `--project`,
`--model`, `--role`, `--limit`, `--format` and `--output`.

Three cases need translating first:

- **Nothing given** becomes `current`.
- **Something that looks like a session id** on its own, a UUID, a hex prefix,
  or an id such as `ses_…`, becomes `session <that id>`.
- **An older flag form**, from before these arguments matched the tool's own:
  `--current` is `current`, `--tree` is `tree`, `--models` is `models`,
  `--all` is `sessions`, `--timeline` is `timeline`, and `--json` is
  `export --format json`. Accept them, and use the plain name in what you run.

Do not invent flags. If an argument matches nothing above, run the tool with
`--help` and show the user what is available rather than guessing.

## Running it

Always add `--no-color`, so no escape codes leak into your reply:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/agent-observer.js" <command> --no-color
```

`watch` runs until interrupted. If the user asks for it, say that it blocks and
let them run it themselves rather than starting it here.

## Reporting back

Show the output, then add one or two sentences on what the routing shows: which
models handled implementation, which handled review, and anything that looks
unintended.

Check the session id in the header before you report. A session that dispatched
nothing says so, and that is a real answer, so report it as one rather than
looking for another session to fill the silence. When the tool falls back to a
different session it prints a line saying so; repeat that caveat.

If nothing is found at all, run `doctor` and report what it says rather than
guessing at a cause.
