# HTML report export

**Status:** approved, ready for an implementation plan
**Date:** 2026-09-12

## Problem

`agent-observer` already knows how long every subagent ran and which model ran
it. No current output communicates the shape of that. In session `3a372c2d` a
single opus review took longer than the three haiku implementations combined,
and one implementation ran on a stronger model than its three siblings. Both
facts sit in the `TOOK` column today and neither is legible there.

A chart makes both obvious. A table does not.

## Decision

Add `html` as an output format. `agent-observer <command> --format html` writes
a single self-contained HTML file.

### What was rejected, and why

**A live web UI backed by an HTTP server**, the original request, phrased as
`current --ui`. Rejected for three reasons:

1. The live-ness the name promises does not exist in the data. The adapter reads
   files Claude Code writes when a subagent is dispatched and when it finishes.
   There is no in-flight progress, no token count, no cost. A ten-minute
   subagent is a bar that does not move for ten minutes.
2. The project has no dependencies and no network code, and `CLAUDE.md` makes
   that a rule. A server plus a frontend would plausibly exceed the 2343 lines
   of core that exist today, for a secondary mode.
3. The tool reads `~/.claude`, which holds real task descriptions. Opening a
   port introduces security decisions the project does not currently have.

A static export gets most of the value at a fraction of the cost. If the live
view is genuinely missed afterwards, that is a separate decision made with
evidence.

**New flags for scoping.** See below.

## Scope: which sessions a report covers

No new flags. The existing rule applies: the command chooses the session, the
format chooses how it is drawn.

```bash
agent-observer current --format html           # the session you are in
agent-observer session 3a372c2d --format html  # that session
agent-observer export --format html            # every session
```

`--all` was proposed for "every session" and rejected: it already means "include
sessions that dispatched no subagents". One flag with two meanings is the same
defect as `--tree` versus `tree`, fixed in 0.2.0.

Changing `export` so that no id means "current session" was also rejected. Today
it means every session, and `export --format json` consumers depend on that.
That change would be major, not minor.

## Architecture

Two new modules, because the HTML renderer is larger than every existing
renderer combined and `src/core/report.js` already carries all of them.

| Module | Responsibility |
|---|---|
| `src/core/html.js` | `toHtml(sessions) -> string`. Rendering only. |
| `src/core/insights.js` | Derives the interpretive sentences. Pure functions. |

`report.js` re-exports `toHtml`, as it does for `toCsv` and `toMarkdown`.
`cli.js` gains `html` in its format list and one dispatch branch. No adapter
changes. No core model changes.

## Constraints

These are requirements, and each one is a test.

- **One file, no network.** CSS inline. No external fonts, no CDN, no images.
  The output must contain no `<script` and no network references: no script,
  stylesheet, image or other resource loaded from a URL. (Task text on disk
  may itself contain a URL; that is printed as escaped text and fetches
  nothing.)
- **No JavaScript.** The report is for reading and sharing, not operating.
- **Colour is never the only signal.** Every row carries the model name as a
  text chip, for readers who cannot separate green from amber and for anyone
  printing in greyscale.
- **It prints.** A `@media print` block flattens the dark ground to light.

## Visual design

Dark dashboard, matching the project banner. Confirmed against three
alternatives during brainstorming; a terminal-native treatment and a light
editorial report were both rejected as less striking.

Structure, top to bottom:

1. Title and session identity.
2. A KPI row: subagents, duration, turns, distinct models, share of elapsed time
   outside any subagent.
3. The interpretive paragraph, described below.
4. The timeline: one row per subagent, each with task name, model chip,
   proportional bar positioned by start time, and duration.
5. Model and role tallies.

For a multi-session report, an index of session cards followed by one section
per session. **Each session's timeline is scaled to its own span.** A shared
axis across sessions from different days is meaningless and must not be built.

The KPI row and the interpretive paragraph are **per session**, computed inside
each section. There is no cross-session aggregate: the sessions in one export
may be months apart and share nothing.

The document is written to stdout unless `--output` is given. HTML on stdout is
large but not an error; `-o report.html` is the expected use and already works
for every format.

### Terms used below

- **Elapsed time**: the earliest start to the latest finish among a session's
  subagents.
- **Subagent time**: the sum of every known subagent duration.
- **Now**: the moment the report is rendered. Used only to draw a bar for a
  subagent that has not finished.

## The interpretive paragraph

The highest-value and highest-risk part. The project's rule is to report what
happened and never infer, so these sentences follow four rules:

1. **Arithmetic, never judgement.** "opus ran once and took 26% of subagent
   time" is checkable. "the routing was wasteful" is an opinion and is out.
2. **Every sentence shows its numbers**, so a reader can recompute them against
   the table below it.
3. **Every rule has a declared threshold**, in code.
4. **Silence is a valid output.** A session that crosses no threshold produces
   no paragraph, and the block is omitted rather than padded.

### Rules

Emitted in this fixed order. Each is a pure function returning a string or
`null`.

| Rule | Condition | Example |
|---|---|---|
| Model-role concentration | A role has 3+ runs and one model accounts for 2/3 or more of them. Evaluated only for the **leading role**, the one with the most runs, ties broken alphabetically. That cap keeps the paragraph at four sentences. | "Implementation ran on haiku in 3 of 4 tasks." |
| Dominant subagent | 4+ subagents have known durations and the longest is 25% or more of subagent time, and every run has a known duration. | "One subagent, the final whole-branch review, took 10m35s, 26% of all subagent time." |
| The exception | The leading role qualified for rule 1 and exactly one of its runs used a different model. Same role as rule 1, never a different one. | "One implementation ran on sonnet where the other three ran on haiku." |
| Work outside subagents | Elapsed time and subagent time are both known, subagent time does not exceed elapsed, the gap is 10% or more of elapsed, and every run has a known duration. | "16% of elapsed time fell outside any subagent." |

### Honesty notes carried into the report

- **Role is inferred** from the task description; Claude Code does not record
  it. Two of the four rules lean on role, so the report says this in small print
  rather than leaving it implicit.
- **Rule 4 assumes subagents ran sequentially.** Summed duration exceeding
  elapsed time means they overlapped, in which case the gap is meaningless and
  the sentence is suppressed.

## Edge cases

| Case | Behaviour |
|---|---|
| Subagent still running | No end time, so no proportional bar. Striped bar from its start to now, labelled as running. |
| Model is `inherit` | A real recorded value, but not a model. Dashed outline chip reading `inherit`, dashed empty bar. Never takes a colour. |
| Model is absent | Dashed outline chip reading `unknown`, dashed empty bar. Never coloured as a known model. |
| Model id carries a family name | Matched as a substring, as the terminal does: `claude-sonnet-4-5` takes the sonnet colour. |
| Model outside the three families | Borrows a colour whose family is absent from the document: most subagents first, then by name, in slot order haiku, sonnet, opus. One colour per model across the whole document. |
| More such models than free colours | The rest are hatched in ink. Nothing is ever grey, because a grey model reads as a missing one. |
| Session with no subagents | Says so. No empty timeline. |
| No duration known for any subagent | No timeline. An ordered list instead. A chart is not invented over absent data. |
| Long task descriptions | Truncated with an ellipsis, full text in the `title` attribute, which needs no JavaScript. |

## Testing

**No snapshot of the whole document.** A 20 KB golden file is approved blind in
review, which stops it being a test.

Structural assertions on the output instead:

- Every task name and every model name appears in the document.
- Each bar's width is proportional to its duration: parse the inline style and
  compare the ratio against the known seconds.
- The output contains no `<script`, no `http://` and no `https://`, which turns
  the constraints above into CI failures.
- Tags open and close evenly.

`insights.js` is tested separately as pure functions: one fixture that crosses
each threshold, one that falls short and returns `null`, and a one-subagent
session that returns nothing at all.

## Out of scope

- A live view or any HTTP server.
- JavaScript of any kind: no hover detail, no filtering, no collapsing.
- Opening the file in a browser. The command writes and stops; opening needs a
  per-platform command and turns a pure writer into something with side effects.
- Any redaction mode. The report carries real task descriptions, exactly as
  `--format markdown` already does. The command's documentation will say so.

## Release

A new output format is a minor version. Nothing existing changes behaviour.

## Delivered and deferred

This branch delivers `--format html` for a single session: title and session
identity, the interpretive paragraph (all four rules, with the role-inferred
note in small print whenever a role-leaning rule fires), and the timeline —
one row per subagent with task name, model chip, proportional bar, and
duration, or the ordered-list fallback when no run has a usable duration. The
document is one self-contained file with a print stylesheet, no script, and no
network reference of any kind.

Deferred to a follow-up:

- The KPI row (subagents, duration, turns, distinct models, share of elapsed
  time outside any subagent).
- Model and role tallies.
- The multi-session index of session cards.
- A report date and a visible document title.
- Using the validated light palette in print via CSS variables, rather than
  the fixed print colours used today.
- A cap on a stale running subagent stretching the axis to now: a run with no
  end long after the session's last timestamp currently draws a bar spanning
  the whole gap.
- The leading-role-only limitation: rules 1 and 3 only ever look at the role
  with the most runs. On real data the paragraph can describe review routing
  while the implementation that ran on a stronger model goes unmentioned,
  because it lost the tie for "leading role" to review.
