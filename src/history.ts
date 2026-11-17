import fs from 'node:fs';
import path from 'node:path';
import type { SiteStatus, SiteSnapshot } from '../reporters/collector';

export const STATE_DIR = path.join(process.cwd(), '.monitor-state');
const STATE_FILE = path.join(STATE_DIR, 'status.json');
const HISTORY_FILE = path.join(STATE_DIR, 'history.json');
const KEEP_DAYS = 30;

export type MonitorState = {
  sites: Record<string, SiteStatus>;
  lastSummaryDate?: string;
};

export type HistoryEntry = {
  at: string;
  sites: Record<string, { s: SiteStatus; ms?: number }>;
};

function readJson<T>(file: string, fallback: T): T {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as T : fallback;
  } catch (error) {
    console.error(`Не удалось прочитать ${file}:`, error);
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

export function readState(): MonitorState {
  const raw = readJson<Record<string, unknown>>(STATE_FILE, {});
  // Старый формат: { "site-id": "up" | "down" }
  if (!raw.sites) return { sites: raw as Record<string, SiteStatus> };
  return raw as MonitorState;
}

export function saveState(state: MonitorState) {
  writeJson(STATE_FILE, state);
}

export function readHistory(): HistoryEntry[] {
  return readJson<HistoryEntry[]>(HISTORY_FILE, []);
}

export function appendHistory(snapshots: SiteSnapshot[], now = new Date()): HistoryEntry[] {
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  const history = readHistory().filter(e => new Date(e.at).getTime() >= cutoff);

  const entry: HistoryEntry = { at: now.toISOString(), sites: {} };
  for (const snap of snapshots) entry.sites[snap.id] = { s: snap.status, ms: snap.responseMs };
  history.push(entry);

  writeJson(HISTORY_FILE, history);
  return history;
}

export type SiteStats = { uptime: number | null; avgMs: number | null; checks: number; incidents: number };

/** Аптайм считает «degraded» как работающий сайт, «down» — как простой. */
export function siteStats(history: HistoryEntry[], siteId: string, hours: number, now = new Date()): SiteStats {
  const from = now.getTime() - hours * 3_600_000;
  const points = history.filter(e => new Date(e.at).getTime() >= from && e.sites[siteId]).map(e => e.sites[siteId]);

  if (points.length === 0) return { uptime: null, avgMs: null, checks: 0, incidents: 0 };

  const ok = points.filter(p => p.s !== 'down').length;
  const times = points.map(p => p.ms).filter((ms): ms is number => typeof ms === 'number');
  let incidents = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i].s === 'down' && (i === 0 || points[i - 1].s !== 'down')) incidents++;
  }

  return {
    uptime: (ok / points.length) * 100,
    avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    checks: points.length,
    incidents
  };
}
