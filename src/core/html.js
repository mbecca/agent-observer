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
  // A chart needs at least one finished run to be proportional to anything.
  // With none, `span` would still produce bounds by treating `now` as every
  // end, drawing bars whose lengths mean nothing.
  const anyFinished = session.agents.some((a) => a.finishedAt);
  const bounds = anyFinished ? span(session, now) : null;
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
@media print {
  body { background:#fff; color:#1a1a19; }
  .lead { background:#f5f5f4; border-left-color:#57534e; }
  .ident, .empty { color:#57534e; }
}
`;
