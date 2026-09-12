# Writing an adapter

An adapter translates one coding agent's local files into the shared model in
`src/core/model.js`. It is the only place in the codebase that knows what a
particular agent is.

## The one rule

**Report only what you can observe.** If the agent does not write which model
ran a subagent, leave `model` null and say so in `capability().missing`. Do not
infer a model from a plan, a skill file, or what the agent said it would do. The
entire value of this tool is that it reads what happened rather than what was
intended.

## The shape

```js
export class MyAgentAdapter {
  static adapterName = 'my-agent';   // the --adapter value
  static displayName = 'My Agent';

  constructor(root) {
    this.name = MyAgentAdapter.adapterName;
    this.displayName = MyAgentAdapter.displayName;
    this.root = root || defaultRoot();
  }

  capability() { /* -> Capability */ }
  isAvailable() { return this.capability().available; }
  sessions() { /* -> Session[], newest first */ }
  session(id) { /* -> Session | null, accepting an id prefix */ }
  currentSession() { /* -> Session | null */ }
}
```

Register it in `src/adapters/index.js` by adding the class to `ADAPTER_CLASSES`.
Nothing else changes: every command, filter and output format works immediately.

## Capability

`capability()` is how a user finds out why an agent shows nothing. Fill in all
of it:

```js
new Capability({
  provider: this.name,
  displayName: this.displayName,
  available: isDir(this.sessionsDir),
  root: this.sessionsDir,
  observes: ['subagent model', 'task description'],
  missing: ['token usage', 'cost'],
  note: 'Set MY_AGENT_HOME if the data lives elsewhere.',
});
```

`missing` is not an apology. It is the honest answer to "why can't I see this?".

## Robustness

Adapters run against files another program is writing right now.

- A half-written final line is normal. Skip it, do not throw.
- A corrupt metadata file must not lose the whole session.
- A path that does not exist is a missing capability, not an error.
- Never hold a file open; other processes on Windows will fail to write.

`src/core/util.js` has the helpers for this: `readJson`, `readJsonl`,
`firstLastLine`, `readHead`, `countLines`, `walkFiles`. They all return null or
an empty array rather than throwing.

## Timestamps

Prefer a timestamp recorded inside the agent's own transcript over a file's
modification time. An mtime changes when anything touches the file, so it
answers "when was this last written", not "when did this run". Fall back to
mtime only when there is nothing better, as the Claude Code adapter does.

## Testing

Write a fixture directory in the real on-disk shape and point the adapter at it.
`test/helpers.js` has `makeTempDir`, `writeClaudeFixture` and `writeEventsFixture`
to copy from. Test against files, not mocks: the on-disk layout is the thing that
can break, and a mock will happily agree with a wrong assumption.

Cover at minimum:

- a normal session parses with the right models, tasks and ordering
- a missing root reports unavailable instead of throwing
- a corrupt record is skipped and the rest still load
- `capability()` names what the agent cannot record

## If the agent records nothing useful

Then the adapter's job is to say so. Look at `src/adapters/codex.js`: it reports
the session model it can see, returns no subagent rows, and its `note` explains
that rollouts carry no per-subagent metadata and points at the generic adapter as
the way forward. That is a complete, correct adapter.
