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
