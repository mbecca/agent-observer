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
 * colours (see SLOTS below).
 */

import { insightsFor, modelRoleConcentration, theException } from './insights.js';

/**
 * Validated against the dataviz six checks, all-pairs, in both modes. Any two
 * models can sit in adjacent rows, so all-pairs is the gate that applies. A
 * fourth hue was tried against these three and none passed, so there are only
 * three colours. Do not add one without re-running the validator.
 *
 * Each slot belongs to a model family, matched as a substring so
 * `claude-sonnet-4-5` and a bare `sonnet` share a colour, as in the terminal.
 * A slot whose family is absent from a document is lent to another model
 * (see modelLooks), so a report of only non-Claude models is not grey.
 */
const SLOTS = [
  { family: 'haiku', dark: '#199e70', light: '#1baf7a' },
  { family: 'sonnet', dark: '#c98500', light: '#eda100' },
  { family: 'opus', dark: '#9085e9', light: '#4a3aa7' },
];

/** Recorded values that do not name a model, so they never take a colour. */
const NOT_A_MODEL = new Set(['unknown', 'inherit']);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Task text comes off disk and may contain anything. */
export function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function familySlot(model) {
  const name = model.toLowerCase();
  return SLOTS.find((slot) => name.includes(slot.family)) || null;
}

/**
 * Decide how every model in the document is drawn, once, so a model keeps one
 * look across all of its sessions.
 *
 * Families keep their own slot. The slots left free go to the other models,
 * most subagents first and then by name, so the same data always draws the
 * same way. A model left without a slot is drawn hatched in ink, and a value
 * that names no model is drawn as an outline. Nothing is grey: a grey model
 * reads as a missing one.
 *
 * Returns a lookup from model name to `{ colour }` or `{ treatment }`.
 */
function modelLooks(sessions) {
  const taken = new Set();
  const counts = new Map();
  for (const session of sessions) {
    for (const agent of session.agents) {
      const model = agent.model || 'unknown';
      if (NOT_A_MODEL.has(model.toLowerCase())) continue;
      const slot = familySlot(model);
      if (slot) taken.add(slot);
      else counts.set(model, (counts.get(model) || 0) + 1);
    }
  }

  const free = SLOTS.filter((slot) => !taken.has(slot));
  const lent = new Map(
    [...counts]
      .sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : a > b ? 1 : 0))
      .map(([model], i) => [model, free[i] || null]),
  );

  return (model) => {
    if (NOT_A_MODEL.has(model.toLowerCase())) return { treatment: 'none' };
    const slot = familySlot(model) || lent.get(model);
    return slot ? { colour: slot.dark } : { treatment: 'other' };
  };
}

function renderInsights(session) {
  const lines = insightsFor(session);
  if (!lines.length) return '';
  const lead = '<p class="lead">' + lines.map((l) => escapeHtml(l)).join(' ') + '</p>';
  // Rules 1 and 3 lean on role, which is inferred from task text rather than
  // recorded by the agent. Say so in small print whenever either one spoke.
  const leansOnRole = modelRoleConcentration(session) !== null || theException(session) !== null;
  const note = leansOnRole
    ? '<p class="note">Roles are inferred from task descriptions; the agent does not record them.</p>'
    : '';
  return lead + note;
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

function renderRow(agent, bounds, now, looks) {
  const model = agent.model || 'unknown';
  const { colour, treatment } = looks(model);
  const running = !agent.finishedAt;
  const startedAt = agent.startedAt ? agent.startedAt.getTime() : bounds.from;
  const endsAt = agent.finishedAt ? agent.finishedAt.getTime() : now.getTime();

  const left = ((startedAt - bounds.from) / (bounds.to - bounds.from)) * 100;
  const width = Math.max(0.4, ((endsAt - startedAt) / (bounds.to - bounds.from)) * 100);

  // `running` (no finishedAt) is the only case that reads as "running"; a
  // finished run whose duration is unusable (e.g. finishedAt before
  // startedAt) is over, just not measurable, so it shows a dash instead.
  const duration = running
    ? 'running'
    : (agent.durationSeconds === null || agent.durationSeconds === undefined
      ? '—'
      : formatDuration(agent.durationSeconds));

  // A coloured model carries its hue inline; hatched and outlined ones take it
  // from a class, so the print stylesheet can swap their ink.
  const chip = colour
    ? `<div class="chip" style="color:${colour};border-color:${colour}">`
    : `<div class="chip ${treatment}">`;
  const barClass = `bar${treatment ? ` ${treatment}` : ''}${running ? ' running' : ''}`;
  const barFill = colour ? `;background:${colour}` : '';

  return (
    `<div class="row">` +
    `<div class="name" title="${escapeHtml(agent.task)}">${escapeHtml(agent.task)}</div>` +
    `${chip}${escapeHtml(model)}</div>` +
    `<div class="track"><div class="${barClass}" ` +
    `style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%${barFill}"></div></div>` +
    `<div class="dur">${escapeHtml(duration)}</div>` +
    `</div>`
  );
}

function renderTimeline(session, now, looks) {
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
  return session.sortedAgents().map((a) => renderRow(a, bounds, now, looks)).join('');
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
}

function renderSession(session, now, looks) {
  const count = session.agentCount;
  const head =
    `<h2>${escapeHtml(session.sessionId)}</h2>` +
    `<p class="ident">${escapeHtml(session.project || '')} · ` +
    `${escapeHtml(session.provider)} · ${count} subagent${count === 1 ? '' : 's'}</p>`;

  if (!session.agentCount) {
    return `<section>${head}<p class="empty">No subagents recorded for this session.</p></section>`;
  }
  return `<section>${head}${renderInsights(session)}${renderTimeline(session, now, looks)}</section>`;
}

export function toHtml(sessions, { now = new Date() } = {}) {
  const looks = modelLooks(sessions);
  const body = sessions.map((s) => renderSession(s, now, looks)).join('');
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
.note { font-size:10px; color:var(--muted); margin:4px 0 14px; }
.row { display:flex; align-items:center; gap:9px; height:24px; font-size:11px; }
.name { width:200px; flex:0 0 200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.chip { flex:0 0 58px; text-align:center; font-size:9px; font-weight:700; padding:2px 0;
  border:1px solid; border-radius:4px; font-family:ui-monospace,monospace; }
.track { position:relative; flex:1; height:11px; background:rgba(30,41,59,.5); border-radius:6px; }
.bar { position:absolute; height:11px; border-radius:6px; }
.bar.running { opacity:.65;
  background-image:repeating-linear-gradient(90deg,transparent 0 5px,rgba(0,0,0,.35) 5px 10px); }
/* A model with no colour left: hatched in ink. After .running so the hatch,
   which says which model this is, survives on a running bar too. */
.chip.other { color:var(--ink); border-color:var(--ink); }
.bar.other { background-color:color-mix(in srgb, var(--ink) 30%, transparent);
  background-image:repeating-linear-gradient(135deg,var(--ink) 0 2px,transparent 2px 6px); }
/* inherit and unknown name no model: an outline, with nothing filled in. */
.chip.none { color:var(--ink); border:1px dashed var(--ink); }
.bar.none { box-sizing:border-box; border:1px dashed var(--ink); }
.dur { flex:0 0 52px; text-align:right; color:var(--muted);
  font-family:ui-monospace,monospace; font-size:10px; }
.fallback { font-size:12px; padding-left:18px; }
@media print {
  :root { --ink:#1a1a19; }
  body { background:#fff; color:#1a1a19; }
  .lead { background:#f5f5f4; border-left-color:#57534e; }
  .ident, .empty, .note { color:#57534e; }
  /* Bars, tracks and chips are CSS backgrounds/borders, which browsers omit
     from a print job by default; without this the timeline prints blank. */
  .track, .bar, .chip { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .name { white-space:normal; }
}
`;
