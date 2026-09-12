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
