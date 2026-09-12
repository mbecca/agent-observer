/** Small cross-platform helpers shared by core and adapters. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseTimestamp } from './model.js';

/** Whether to emit ANSI colour, honouring NO_COLOR and FORCE_COLOR. */
export function supportsColor(stream = process.stdout) {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR) return true;
  if (!stream || !stream.isTTY) return false;
  return process.env.TERM !== 'dumb';
}

export function homeDir() {
  return os.homedir();
}

/**
 * Last segment of a path, treating both `/` and `\` as separators whatever the
 * host platform is.
 *
 * `path.basename` uses only the separator of the platform it runs on, so on
 * Linux it returns the whole of `C:\Users\dev\my-repo` unchanged. Paths here are
 * read out of an agent's own files and may have been recorded on a different
 * operating system: a `.claude` directory shared between machines, or WSL
 * reading the Windows one. Splitting on both is the only correct answer.
 */
export function baseName(target) {
  if (!target) return '';
  const trimmed = String(target).replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

/** Load a small JSON file, returning null instead of throwing. */
export function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Parse a newline-delimited JSON file, skipping unparsable lines. */
export function readJsonl(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const records = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (record && typeof record === 'object' && !Array.isArray(record)) records.push(record);
    } catch {
      // A partially written final line is normal while an agent is running.
    }
  }
  return records;
}

/**
 * Return the first and last non-empty lines without loading the whole file.
 *
 * Agent transcripts run to hundreds of KB; only the two ends carry the
 * timestamps we need, so read a window from each end.
 */
export function firstLastLine(file, windowBytes = 262144) {
  let handle;
  try {
    handle = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(handle);
    if (size === 0) return [null, null];

    const headSize = Math.min(size, windowBytes);
    const head = Buffer.alloc(headSize);
    fs.readSync(handle, head, 0, headSize, 0);
    const first = head.toString('utf8').split('\n').find((line) => line.trim()) ?? null;

    let tailText;
    if (size > windowBytes) {
      const tail = Buffer.alloc(windowBytes);
      fs.readSync(handle, tail, 0, windowBytes, size - windowBytes);
      // The first line of the tail window is probably truncated mid-record.
      tailText = tail.toString('utf8').split('\n').slice(1).join('\n');
    } else {
      tailText = head.toString('utf8');
    }
    const tailLines = tailText.split('\n').filter((line) => line.trim());
    const last = tailLines.length ? tailLines[tailLines.length - 1] : null;

    return [first ? first.trim() : null, last ? last.trim() : null];
  } catch {
    return [null, null];
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {
        /* already closed */
      }
    }
  }
}

/** Read the first `bytes` of a file as text, or null when unreadable. */
export function readHead(file, bytes = 65536) {
  let handle;
  try {
    handle = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(handle);
    const length = Math.min(size, bytes);
    if (length === 0) return null;
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, 0);
    return buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {
        /* already closed */
      }
    }
  }
}

/** Count non-empty lines, or null when the file cannot be read. */
export function countLines(file) {
  try {
    let total = 0;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (line.trim()) total += 1;
    }
    return total;
  } catch {
    return null;
  }
}

export function mtime(file) {
  try {
    return fs.statSync(file).mtime;
  } catch {
    return null;
  }
}

/** List immediate subdirectory entries, or [] when the path is unreadable. */
export function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: path.join(dir, entry.name) }));
  } catch {
    return [];
  }
}

/** Recursively collect files matching a predicate on the file name. */
export function walkFiles(dir, matches, depth = 8) {
  const found = [];
  if (depth < 0) return found;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkFiles(full, matches, depth - 1));
    } else if (entry.isFile() && matches(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

export function isDir(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/** Parse `--since` as a duration (`7d`, `12h`, `30m`) or an absolute date. */
export function parseSince(value) {
  const text = String(value).trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)([mhdw])$/.exec(text);
  if (match) {
    const amount = Number(match[1]);
    const unitMs = { m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 }[match[2]];
    return new Date(Date.now() - amount * unitMs);
  }
  const parsed = parseTimestamp(value);
  if (!parsed) {
    throw new Error(`Could not read '${value}' as a time. Use 7d, 12h, 30m or an ISO date.`);
  }
  return parsed;
}

export function humanDuration(seconds) {
  if (seconds === null || seconds === undefined) return '-';
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(total / 3600)}h${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m`;
}

const TIME_ONLY = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };

/** Format a Date in the machine's local timezone. */
export function localTime(value, withDate = false) {
  if (!value) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  if (!withDate) return time;
  const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  return `${date} ${time}`;
}

/** Local date and time down to the minute, for compact table columns. */
export function localMinute(value) {
  if (!value) return '-';
  return localTime(value, true).slice(0, 16);
}

export function truncate(text, width) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (width <= 1 || flat.length <= width) return flat;
  return flat.slice(0, width - 1) + '…';
}

export function pad(text, width) {
  const value = String(text ?? '');
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

export function terminalWidth(fallback = 100) {
  const columns = process.stdout && process.stdout.columns;
  return Math.max(60, columns || fallback);
}

export { TIME_ONLY };
