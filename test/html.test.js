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

describe('toHtml escaping', () => {
  it('escapes a task description that looks like markup', () => {
    const nasty = toHtml([session([run('<script>alert(1)</script>', 'haiku', 0, 10)])], { now: NOW });
    assert.doesNotMatch(nasty, /<script/i);
    assert.match(nasty, /&lt;script&gt;/);
  });
});

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
