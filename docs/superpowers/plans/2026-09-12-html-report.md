# HTML Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `html` as an output format that writes a single self-contained report showing which model ran each subagent and how long it took.

**Architecture:** Two new modules. `src/core/insights.js` derives interpretive sentences as pure functions over a `Session`. `src/core/html.js` renders a document. `report.js` re-exports `toHtml`; `cli.js` gains one format entry and one dispatch branch. No adapter or model changes.

**Tech Stack:** Node 18.19+, ES modules, zero dependencies. Tests use `node:test` and `node:assert/strict` via `pnpm run test`.

**Spec:** `docs/superpowers/specs/2026-09-12-html-report-design.md`

## Global Constraints

- **No dependencies.** Runtime or development. Nothing may be added.
- **Node >= 18.19**, ES modules, two-space indent, comments explain why not what.
- **The output must contain no `<script`, no `http://`, no `https://`.** This is a test, not a guideline.
- **No JavaScript in the generated document.** CSS only.
- **Every subagent row shows its model as text**, never colour alone.
- **All task text must be HTML-escaped.** Descriptions come from disk and may contain `<`, `&`, or quotes.
- **The validated palette is fixed** (see Task 3). Do not add a fourth colour: no fourth hue passes the all-pairs CVD check against these three. Anything outside the three named families renders neutral grey with its name in the chip.
- **Determinism.** `toHtml` takes an injected `now` so tests do not depend on the clock.
- Run `pnpm run verify` before every commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/insights.js` | Create. Four threshold rules, each `(session) => string \| null`, plus `insightsFor(session) => string[]`. |
| `src/core/html.js` | Create. `toHtml(sessions, { now }) => string`. Rendering and CSS only. |
| `src/core/report.js` | Modify. Re-export `toHtml`. |
| `src/cli.js` | Modify. Add `html` to `DATA_FORMATS` and one branch in `renderData`. |
| `test/insights.test.js` | Create. Per-rule threshold tests. |
| `test/html.test.js` | Create. Structural and constraint assertions. |

---

### Task 1: Insight rules

**Files:**
- Create: `src/core/insights.js`
- Test: `test/insights.test.js`

**Interfaces:**
- Consumes: `Session` and `AgentRun` from `src/core/model.js`. `AgentRun` has `model`, `role`, `task`, `durationSeconds`, `startedAt`, `finishedAt`.
- Produces: `insightsFor(session) => string[]` (0 to 4 sentences, fixed order), and named exports `leadingRole`, `modelRoleConcentration`, `dominantSubagent`, `theException`, `outsideSubagents` for direct testing.

- [ ] **Step 1: Write the failing test**

```js
// test/insights.test.js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AgentRun, Session } from '../src/core/model.js';
import {
  dominantSubagent,
  insightsFor,
  leadingRole,
  modelRoleConcentration,
  outsideSubagents,
  theException,
} from '../src/core/insights.js';

/** Build a run with a known duration, in minutes for readability. */
function run(task, model, startMin, durSec) {
  const startedAt = new Date(Date.UTC(2026, 7, 14, 13, 34, 55) + startMin * 60000);
  return new AgentRun({
    provider: 'claude-code',
    sessionId: 's1',
    agentId: `a-${startMin}`,
    model,
    task,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + durSec * 1000),
  });
}

/** The real shape of session 3a372c2d: haiku implements, sonnet reviews, opus once. */
function sddSession() {
  return new Session({
    provider: 'claude-code',
    sessionId: 's1',
    agents: [
      run('Implement Task 1: plan workflow', 'haiku', 0, 88),
      run('Review Task 1 (spec + quality)', 'sonnet', 2, 214),
      run('Implement Task 2: apply workflow', 'haiku', 6, 79),
      run('Review Task 2 (spec + quality)', 'sonnet', 8, 116),
      run('Implement Task 3: AGENTS.md section', 'haiku', 10, 75),
      run('Review Task 3 (spec + quality)', 'sonnet', 12, 73),
      run('Implement Task 4: verify on PR #26', 'sonnet', 14, 254),
      run('Final whole-branch review', 'opus', 20, 635),
    ],
  });
}

describe('leadingRole', () => {
  it('picks the role with the most runs', () => {
    // 4 implement, 4 review -> tie, broken alphabetically
    assert.equal(leadingRole(sddSession()), 'implement');
  });

  it('returns null when there are no runs', () => {
    assert.equal(leadingRole(new Session({ sessionId: 's0' })), null);
  });
});

describe('modelRoleConcentration', () => {
  it('reports the model that did most of the leading role', () => {
    const text = modelRoleConcentration(sddSession());
    assert.match(text, /[Ii]mplementation ran on haiku in 3 of 4/);
  });

  it('stays silent below three runs of the leading role', () => {
    const small = new Session({
      sessionId: 's1',
      agents: [run('Implement one', 'haiku', 0, 60), run('Review one', 'sonnet', 2, 60)],
    });
    assert.equal(modelRoleConcentration(small), null);
  });

  it('stays silent when no model reaches two thirds', () => {
    const mixed = new Session({
      sessionId: 's1',
      agents: [
        run('Implement a', 'haiku', 0, 60),
        run('Implement b', 'sonnet', 2, 60),
        run('Implement c', 'opus', 4, 60),
      ],
    });
    assert.equal(modelRoleConcentration(mixed), null);
  });
});

describe('dominantSubagent', () => {
  it('names the longest subagent and its share', () => {
    const text = dominantSubagent(sddSession());
    assert.match(text, /Final whole-branch review/);
    assert.match(text, /4[0-9]%/); // 635 of 1534 seconds
  });

  it('stays silent below four timed subagents', () => {
    const three = new Session({
      sessionId: 's1',
      agents: [run('a', 'haiku', 0, 10), run('b', 'haiku', 1, 10), run('c', 'haiku', 2, 600)],
    });
    assert.equal(dominantSubagent(three), null);
  });

  it('stays silent when the longest is under a quarter of the time', () => {
    const even = new Session({
      sessionId: 's1',
      agents: [
        run('a', 'haiku', 0, 100), run('b', 'haiku', 2, 100),
        run('c', 'haiku', 4, 100), run('d', 'haiku', 6, 110),
      ],
    });
    assert.equal(even, even); // guard against typos below
    assert.equal(dominantSubagent(even), null);
  });
});

describe('theException', () => {
  it('names the single run that broke the pattern', () => {
    const text = theException(sddSession());
    assert.match(text, /One implementation ran on sonnet/);
    assert.match(text, /other three ran on haiku/);
  });

  it('stays silent when every run of the role used the same model', () => {
    const uniform = new Session({
      sessionId: 's1',
      agents: [
        run('Implement a', 'haiku', 0, 60),
        run('Implement b', 'haiku', 2, 60),
        run('Implement c', 'haiku', 4, 60),
      ],
    });
    assert.equal(theException(uniform), null);
  });
});

describe('outsideSubagents', () => {
  it('reports the share of elapsed time with no subagent running', () => {
    const text = outsideSubagents(sddSession());
    assert.match(text, /\d+% of elapsed time fell outside any subagent/);
  });

  it('stays silent when subagent time exceeds elapsed time', () => {
    // Overlapping runs: the gap is meaningless, so say nothing.
    const overlapping = new Session({
      sessionId: 's1',
      agents: [run('a', 'haiku', 0, 600), run('b', 'sonnet', 1, 600)],
    });
    assert.equal(outsideSubagents(overlapping), null);
  });
});

describe('insightsFor', () => {
  it('returns the qualifying sentences in a fixed order', () => {
    const lines = insightsFor(sddSession());
    assert.ok(lines.length >= 3);
    assert.match(lines[0], /[Ii]mplementation ran on haiku/);
  });

  it('returns nothing for a session that crosses no threshold', () => {
    const quiet = new Session({ sessionId: 's0', agents: [run('a', 'haiku', 0, 60)] });
    assert.deepEqual(insightsFor(quiet), []);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/insights.test.js`
Expected: FAIL. Cannot find module `../src/core/insights.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/core/insights.js
/**
 * Interpretive sentences derived from a session.
 *
 * Every rule here is arithmetic a reader can recompute from the table beside
 * it. None of them is a judgement: "opus took 41% of subagent time" belongs
 * here, "the routing was wasteful" does not. Each rule has a declared
 * threshold and returns null below it, because a report that pads itself with
 * weak observations teaches the reader to skip the whole block.
 */

import { tally } from './model.js';

const CONCENTRATION_MIN_RUNS = 3;
const CONCENTRATION_SHARE = 2 / 3;
const DOMINANT_MIN_TIMED = 4;
const DOMINANT_SHARE = 0.25;
const OUTSIDE_SHARE = 0.1;

/** Runs that have a usable duration. */
function timed(session) {
  return session.agents.filter((a) => typeof a.durationSeconds === 'number');
}

function subagentSeconds(session) {
  return timed(session).reduce((sum, a) => sum + a.durationSeconds, 0);
}

/** Earliest start to latest finish. Null unless both ends are known. */
function elapsedSeconds(session) {
  const starts = session.agents.map((a) => a.startedAt).filter(Boolean);
  const ends = session.agents.map((a) => a.finishedAt).filter(Boolean);
  if (!starts.length || !ends.length) return null;
  const span = (Math.max(...ends) - Math.min(...starts)) / 1000;
  return span > 0 ? span : null;
}

/** The role with the most runs. Ties break alphabetically so output is stable. */
export function leadingRole(session) {
  const counts = tally(session.agents.map((a) => a.role || 'unknown'));
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  const top = Math.max(...entries.map(([, n]) => n));
  return entries.filter(([, n]) => n === top).map(([role]) => role).sort()[0];
}

function leadingRuns(session) {
  const role = leadingRole(session);
  return role ? { role, runs: session.agents.filter((a) => (a.role || 'unknown') === role) } : null;
}

/** The model that dominates the leading role, or null. */
function dominantModelOf(runs) {
  const counts = tally(runs.map((a) => a.model || 'unknown'));
  const [model, count] = Object.entries(counts)[0] || [];
  if (!model) return null;
  return count / runs.length >= CONCENTRATION_SHARE ? { model, count } : null;
}

export function modelRoleConcentration(session) {
  const leading = leadingRuns(session);
  if (!leading || leading.runs.length < CONCENTRATION_MIN_RUNS) return null;
  const dominant = dominantModelOf(leading.runs);
  if (!dominant) return null;
  const noun = leading.role === 'unknown' ? 'Work' : capitalise(leading.role);
  return `${noun} ran on ${dominant.model} in ${dominant.count} of ${leading.runs.length} tasks.`;
}

export function dominantSubagent(session) {
  const runs = timed(session);
  if (runs.length < DOMINANT_MIN_TIMED) return null;
  const total = subagentSeconds(session);
  if (!total) return null;
  const longest = runs.reduce((a, b) => (b.durationSeconds > a.durationSeconds ? b : a));
  const share = longest.durationSeconds / total;
  if (share < DOMINANT_SHARE) return null;
  return (
    `One subagent, ${longest.task || longest.agentId}, took ` +
    `${formatDuration(longest.durationSeconds)}, ${Math.round(share * 100)}% of all subagent time.`
  );
}

export function theException(session) {
  const leading = leadingRuns(session);
  if (!leading || leading.runs.length < CONCENTRATION_MIN_RUNS) return null;
  const dominant = dominantModelOf(leading.runs);
  if (!dominant) return null;
  const others = leading.runs.filter((a) => (a.model || 'unknown') !== dominant.model);
  if (others.length !== 1) return null;
  const noun = leading.role === 'unknown' ? 'run' : leading.role;
  return (
    `One ${noun} ran on ${others[0].model || 'an unrecorded model'} where the other ` +
    `${numberWord(dominant.count)} ran on ${dominant.model}.`
  );
}

export function outsideSubagents(session) {
  const elapsed = elapsedSeconds(session);
  const busy = subagentSeconds(session);
  if (!elapsed || !busy) return null;
  // Summed duration above elapsed means they overlapped; the gap is meaningless.
  if (busy > elapsed) return null;
  const share = (elapsed - busy) / elapsed;
  if (share < OUTSIDE_SHARE) return null;
  return `${Math.round(share * 100)}% of elapsed time fell outside any subagent.`;
}

/** Every qualifying sentence, in a fixed order so reports stay comparable. */
export function insightsFor(session) {
  return [
    modelRoleConcentration(session),
    dominantSubagent(session),
    theException(session),
    outsideSubagents(session),
  ].filter(Boolean);
}

function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function numberWord(n) {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six'][n] || String(n);
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/insights.test.js`
Expected: PASS, every case.

- [ ] **Step 5: Run the whole suite, then commit**

```bash
pnpm run verify
git add src/core/insights.js test/insights.test.js
git commit -m "Derive interpretive sentences from a session

Four rules, each arithmetic rather than judgement, each with a declared
threshold, each returning null below it. A session that crosses nothing
produces no sentences at all."
```

---

### Task 2: Document shell and constraints

**Files:**
- Create: `src/core/html.js`
- Create: `test/html.test.js`

**Interfaces:**
- Consumes: `insightsFor` from Task 1; `Session` from `src/core/model.js`.
- Produces: `toHtml(sessions, { now } = {}) => string`, and `escapeHtml(text) => string`. Task 3 adds the timeline to the same file and relies on both.

- [ ] **Step 1: Write the failing test**

```js
// test/html.test.js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AgentRun, Session } from '../src/core/model.js';
import { escapeHtml, toHtml } from '../src/core/html.js';

const NOW = new Date('2026-08-14T14:30:00.000Z');

function run(task, model, startMin, durSec) {
  const startedAt = new Date(Date.UTC(2026, 7, 14, 13, 34, 55) + startMin * 60000);
  return new AgentRun({
    provider: 'claude-code',
    sessionId: 's1',
    agentId: `a-${startMin}`,
    model,
    task,
    startedAt,
    finishedAt: durSec === null ? null : new Date(startedAt.getTime() + durSec * 1000),
  });
}

function session(agents = []) {
  return new Session({
    provider: 'claude-code',
    sessionId: '3a372c2d-5be3-43b6-a7d5-29cc9e032cd7',
    project: 'my-repo',
    agents,
  });
}

describe('escapeHtml', () => {
  it('escapes the characters that would break out of text', () => {
    assert.equal(escapeHtml('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');
  });

  it('handles nothing', () => {
    assert.equal(escapeHtml(null), '');
  });
});

describe('toHtml constraints', () => {
  const html = toHtml([session([run('Implement Task 1', 'haiku', 0, 88)])], { now: NOW });

  it('produces one complete document', () => {
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<\/html>\s*$/);
  });

  it('contains no script tag', () => {
    assert.doesNotMatch(html, /<script/i);
  });

  it('references nothing over the network', () => {
    assert.doesNotMatch(html, /https?:\/\//);
  });

  it('names the session and the project', () => {
    assert.match(html, /3a372c2d-5be3-43b6-a7d5-29cc9e032cd7/);
    assert.match(html, /my-repo/);
  });

  it('carries a print stylesheet, because a shared report gets printed', () => {
    assert.match(html, /@media print/);
  });

  it('opens and closes its tags evenly', () => {
    const opens = (html.match(/<(div|section|span|p|h1|h2|table|tr|td)\b/g) || []).length;
    const closes = (html.match(/<\/(div|section|span|p|h1|h2|table|tr|td)>/g) || []).length;
    assert.equal(opens, closes);
  });
});

describe('toHtml escaping', () => {
  it('escapes a task description that looks like markup', () => {
    const nasty = toHtml([session([run('<script>alert(1)</script>', 'haiku', 0, 10)])], { now: NOW });
    assert.doesNotMatch(nasty, /<script/i);
    assert.match(nasty, /&lt;script&gt;/);
  });
});

describe('toHtml insights', () => {
  it('omits the paragraph when nothing crosses a threshold', () => {
    const html = toHtml([session([run('Implement one thing', 'haiku', 0, 60)])], { now: NOW });
    assert.doesNotMatch(html, /class="lead"/);
  });
});

describe('toHtml empty sessions', () => {
  it('says a session dispatched nothing instead of drawing an empty chart', () => {
    const html = toHtml([session([])], { now: NOW });
    assert.match(html, /No subagents recorded/i);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/html.test.js`
Expected: FAIL. Cannot find module `../src/core/html.js`.

- [ ] **Step 3: Write the implementation**

Create `src/core/html.js` with the document shell. The timeline body is a stub returning an empty string; Task 3 fills it in.

```js
// src/core/html.js
/**
 * Self-contained HTML report.
 *
 * One file, no JavaScript, no network references. Everything a reader needs
 * travels with the document, so it works from a USB stick and can be sent to
 * someone who will never install this tool.
 *
 * Colour is deliberately never the only signal: every row names its model in
 * text. That matters for readers who cannot separate the hues and for anyone
 * printing in greyscale, and it is also what lets the palette stop at three
 * colours (see PALETTE below).
 */

import { insightsFor } from './insights.js';

/**
 * Validated against the dataviz six checks, all-pairs, in both modes.
 * A fourth hue was tried four ways and none passed against these three, so the
 * palette stops here and every other model renders neutral with its name in
 * the chip. Do not add a colour without re-running the validator.
 */
const PALETTE = {
  haiku: { dark: '#199e70', light: '#1baf7a' },
  sonnet: { dark: '#c98500', light: '#eda100' },
  opus: { dark: '#9085e9', light: '#4a3aa7' },
};
const NEUTRAL = { dark: '#6e7681', light: '#8a8172' };

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Task text comes off disk and may contain anything. */
export function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function colourFor(model) {
  return PALETTE[String(model || '').toLowerCase()] || NEUTRAL;
}

function renderInsights(session) {
  const lines = insightsFor(session);
  if (!lines.length) return '';
  return (
    '<p class="lead">' + lines.map((l) => escapeHtml(l)).join(' ') + '</p>'
  );
}

/** Filled in by Task 3. */
function renderTimeline() {
  return '';
}

function renderSession(session, now) {
  const head =
    `<h2>${escapeHtml(session.sessionId)}</h2>` +
    `<p class="ident">${escapeHtml(session.project || '')} · ` +
    `${escapeHtml(session.provider)} · ${session.agentCount} subagents</p>`;

  if (!session.agentCount) {
    return `<section>${head}<p class="empty">No subagents recorded for this session.</p></section>`;
  }
  return `<section>${head}${renderInsights(session)}${renderTimeline(session, now)}</section>`;
}

export function toHtml(sessions, { now = new Date() } = {}) {
  const body = sessions.map((s) => renderSession(s, now)).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<title>agent-observer report</title><style>${STYLES}</style></head>` +
    `<body>${body}</body></html>`;
}

const STYLES = `
:root { --bg:#0d1117; --panel:#161b22; --ink:#e2e8f0; --muted:#64748b; }
body { margin:0; padding:28px; background:var(--bg); color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
h2 { font-size:17px; margin:0 0 2px; }
.ident { font-size:11px; color:var(--muted); font-family:ui-monospace,monospace; margin:0 0 14px; }
.lead { font-size:13px; line-height:1.6; background:rgba(56,189,248,.06);
  border-left:2px solid #38bdf8; padding:10px 13px; border-radius:0 6px 6px 0; }
.empty { font-size:12px; color:var(--muted); }
@media print {
  body { background:#fff; color:#1a1a19; }
  .lead { background:#f5f5f4; border-left-color:#57534e; }
  .ident, .empty { color:#57534e; }
}
`;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/html.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite, then commit**

```bash
pnpm run verify
git add src/core/html.js test/html.test.js
git commit -m "Add the HTML report shell

One document, no JavaScript, nothing fetched over the network, and a
print stylesheet because a report meant for sending is a report someone
will put in a PDF. Task descriptions are escaped: they come off disk and
a description containing markup must not become markup."
```

---

### Task 3: The timeline

**Files:**
- Modify: `src/core/html.js` (replace the `renderTimeline` stub)
- Modify: `test/html.test.js` (add the timeline cases)

**Interfaces:**
- Consumes: `escapeHtml`, `PALETTE`, `NEUTRAL`, `colourFor` from Task 2.
- Produces: no new exports. The rendered markup gains `class="row"`, `class="chip"`, and `class="bar"` with inline `left` and `width` percentages, which the tests parse.

- [ ] **Step 1: Write the failing test**

Append to `test/html.test.js`:

```js
describe('toHtml timeline', () => {
  // Two runs: one 60s at the start, one 180s starting 4 minutes in.
  // Span is from 0s to 420s, so widths are 60/420 and 180/420.
  const html = toHtml(
    [session([run('Implement Task 1', 'haiku', 0, 60), run('Review Task 1', 'sonnet', 4, 180)])],
    { now: NOW },
  );

  function bars(markup) {
    return [...markup.matchAll(/class="bar[^"]*"[^>]*style="left:([\d.]+)%;width:([\d.]+)%/g)]
      .map((m) => ({ left: Number(m[1]), width: Number(m[2]) }));
  }

  it('draws one bar per subagent', () => {
    assert.equal(bars(html).length, 2);
  });

  it('sizes each bar in proportion to its duration', () => {
    const [first, second] = bars(html);
    // 180s is three times 60s, so the second bar is three times as wide.
    assert.ok(Math.abs(second.width / first.width - 3) < 0.05);
  });

  it('positions each bar by its start time', () => {
    const [first, second] = bars(html);
    assert.equal(first.left, 0);
    // Starts 240s into a 420s span.
    assert.ok(Math.abs(second.left - (240 / 420) * 100) < 0.5);
  });

  it('names the model in text, not only in colour', () => {
    assert.match(html, /class="chip"[^>]*>haiku</);
    assert.match(html, /class="chip"[^>]*>sonnet</);
  });

  it('shows the task description', () => {
    assert.match(html, /Implement Task 1/);
    assert.match(html, /Review Task 1/);
  });
});

describe('toHtml timeline edge cases', () => {
  it('draws a running subagent up to now, marked as running', () => {
    const html = toHtml(
      [session([run('Implement Task 1', 'haiku', 0, 60), run('Fix findings', 'sonnet', 4, null)])],
      { now: NOW },
    );
    assert.match(html, /class="bar running"/);
    assert.match(html, /running/i);
  });

  it('renders an unrecorded model as unknown rather than as a colour', () => {
    const html = toHtml([session([run('Explore', null, 0, 60)])], { now: NOW });
    assert.match(html, /class="chip"[^>]*>unknown</);
  });

  it('keeps inherit as the recorded value it is', () => {
    const html = toHtml([session([run('Explore', 'inherit', 0, 60)])], { now: NOW });
    assert.match(html, /class="chip"[^>]*>inherit</);
  });

  it('falls back to a list when no duration is known at all', () => {
    const html = toHtml(
      [session([run('A', 'haiku', 0, null), run('B', 'sonnet', 2, null)])],
      { now: NOW },
    );
    assert.doesNotMatch(html, /class="track"/);
    assert.match(html, /class="fallback"/);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/html.test.js`
Expected: FAIL. `bars(html).length` is 0 because `renderTimeline` returns an empty string.

- [ ] **Step 3: Write the implementation**

Replace the `renderTimeline` stub in `src/core/html.js`:

```js
/** Earliest start and latest end across a session, treating now as the end of a running run. */
function span(session, now) {
  const starts = session.agents.map((a) => a.startedAt).filter(Boolean);
  if (!starts.length) return null;
  const ends = session.agents.map((a) => a.finishedAt || now).filter(Boolean);
  const from = Math.min(...starts);
  const to = Math.max(...ends);
  return to > from ? { from, to, seconds: (to - from) / 1000 } : null;
}

function renderRow(agent, bounds, now) {
  const model = agent.model || 'unknown';
  const colour = colourFor(model);
  const running = !agent.finishedAt;
  const startedAt = agent.startedAt ? agent.startedAt.getTime() : bounds.from;
  const endsAt = agent.finishedAt ? agent.finishedAt.getTime() : now.getTime();

  const left = ((startedAt - bounds.from) / (bounds.to - bounds.from)) * 100;
  const width = Math.max(0.4, ((endsAt - startedAt) / (bounds.to - bounds.from)) * 100);

  const duration = agent.durationSeconds === null || agent.durationSeconds === undefined
    ? 'running'
    : formatDuration(agent.durationSeconds);

  return (
    `<div class="row">` +
    `<div class="name" title="${escapeHtml(agent.task)}">${escapeHtml(agent.task)}</div>` +
    `<div class="chip" style="color:${colour.dark};border-color:${colour.dark}">` +
    `${escapeHtml(model)}</div>` +
    `<div class="track"><div class="bar${running ? ' running' : ''}" ` +
    `style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;background:${colour.dark}"></div></div>` +
    `<div class="dur">${escapeHtml(duration)}</div>` +
    `</div>`
  );
}

function renderTimeline(session, now) {
  const bounds = span(session, now);
  // No usable time information: list the runs rather than invent a chart.
  if (!bounds) {
    return (
      '<ul class="fallback">' +
      session.sortedAgents()
        .map((a) => `<li>${escapeHtml(a.task)} — ${escapeHtml(a.model || 'unknown')}</li>`)
        .join('') +
      '</ul>'
    );
  }
  return session.sortedAgents().map((a) => renderRow(a, bounds, now)).join('');
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
}
```

Add to `STYLES`:

```css
.row { display:flex; align-items:center; gap:9px; height:24px; font-size:11px; }
.name { width:200px; flex:0 0 200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.chip { flex:0 0 58px; text-align:center; font-size:9px; font-weight:700; padding:2px 0;
  border:1px solid; border-radius:4px; font-family:ui-monospace,monospace; }
.track { position:relative; flex:1; height:11px; background:rgba(30,41,59,.5); border-radius:6px; }
.bar { position:absolute; height:11px; border-radius:6px; }
.bar.running { opacity:.65;
  background-image:repeating-linear-gradient(90deg,transparent 0 5px,rgba(0,0,0,.35) 5px 10px); }
.dur { flex:0 0 52px; text-align:right; color:var(--muted);
  font-family:ui-monospace,monospace; font-size:10px; }
.fallback { font-size:12px; padding-left:18px; }
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/html.test.js`
Expected: PASS, including the proportionality and position cases.

- [ ] **Step 5: Run the whole suite, then commit**

```bash
pnpm run verify
git add src/core/html.js test/html.test.js
git commit -m "Draw the timeline

Bars are positioned by start time and sized by duration, which is the
thing the table could never show: in a real session one review outweighs
three implementations put together.

A run with no end time is drawn to now and striped, because a bar cannot
be proportional to something that has not finished. When no duration is
known at all there is no chart, only a list."
```

---

### Task 4: Wire it into the CLI and document it

**Files:**
- Modify: `src/core/report.js` (re-export)
- Modify: `src/cli.js` (`DATA_FORMATS`, `renderData`)
- Modify: `test/cli.test.js` (end-to-end case)
- Modify: `README.md`, `skills/agent-observer/SKILL.md`, `commands/subagent-report.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `toHtml` from Task 2 and Task 3.
- Produces: `--format html` accepted by `current`, `session`, `sessions`, `tree`, `timeline` and `export`.

- [ ] **Step 1: Write the failing test**

Append to the `cli end to end` describe block in `test/cli.test.js`:

```js
  it('writes an HTML report for a session', async () => {
    const { code, stdout } = await runCli(['session', 'aaaaaaaa', '--format', 'html']);
    assert.equal(code, EXIT_OK);
    assert.match(stdout, /^<!doctype html>/i);
    assert.match(stdout, /Implement Task 1/);
    assert.doesNotMatch(stdout, /<script/i);
  });

  it('offers html in the format list', async () => {
    const { stdout } = await runCli([]);
    assert.match(stdout, /html/);
  });
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/cli.test.js`
Expected: FAIL. `--format html` is rejected as an unknown format.

- [ ] **Step 3: Write the implementation**

In `src/core/report.js`, add the re-export beside the other formats:

```js
export { toHtml } from './html.js';
```

In `src/cli.js`, add `'html'` to `DATA_FORMATS`:

```js
const DATA_FORMATS = ['json', 'ndjson', 'csv', 'markdown', 'html'];
```

And a branch in `renderData`:

```js
    case 'html':
      return report.toHtml(sessions);
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/cli.test.js`
Expected: PASS.

- [ ] **Step 5: Update the documentation**

In `README.md`, add `html` to the `--format` row of the filters table and add this after the filters examples:

```markdown
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
```

In `skills/agent-observer/SKILL.md`, add `html` to the format list in the flags
paragraph. In `commands/subagent-report.md`, add `html` to the formats named in
the pass-through section.

Add to `CHANGELOG.md` under `## [Unreleased]`:

```markdown
### Added

- `--format html` writes a self-contained report: a timeline of which model ran
  each subagent and for how long, with a short paragraph naming what the routing
  did. One file, no JavaScript, no network references, and a print stylesheet.
  The palette is three colours because no fourth passed the colourblind
  separation check against them; every row names its model in text regardless.
```

- [ ] **Step 6: Verify against real data, not only fixtures**

```bash
node bin/agent-observer.js session 3a372c2d --format html -o /tmp/report.html
```

Open it. Confirm the timeline is legible, the opus bar visibly dominates, the
interpretive paragraph reads as arithmetic rather than opinion, and the print
preview is readable on white.

- [ ] **Step 7: Run the whole suite, then commit**

```bash
pnpm run verify
git add src/core/report.js src/cli.js test/cli.test.js README.md skills commands CHANGELOG.md
git commit -m "Offer the HTML report from every command

The command still chooses the session and the format still chooses how
it is drawn, so html needs no flag of its own: current, session and
export all reach it."
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: architecture and
constraints to Tasks 2 and 3, the interpretive paragraph to Task 1, edge cases
to Task 3, scope semantics to Task 4, testing throughout. The multi-session
index of session cards is **not** covered by these tasks: `toHtml` renders each
session in sequence, which satisfies the spec's "one section per session, each
scaled to its own span", but the summary index above them is deferred. It is
additive and needs no interface change, so it is a follow-up rather than a gap
that blocks this work.

**Placeholders.** None. Every step carries the code or command it needs.

**Type consistency.** `toHtml(sessions, { now })` is used identically in Tasks 2,
3 and 4. `escapeHtml`, `colourFor`, `PALETTE` and `NEUTRAL` are defined in Task 2
and consumed in Task 3 under those exact names. `formatDuration` appears in both
`insights.js` and `html.js` as a private helper in each; that duplication is
deliberate, since exporting a formatter from an insights module to a renderer
would couple them for four lines.
