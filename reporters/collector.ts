import type { TestCase, TestResult } from '@playwright/test/reporter';
import type { Site } from '../src/sites';

export type SiteStatus = 'up' | 'degraded' | 'down';

export type CheckRecord = {
  siteId: string;
  siteName: string;
  url: string;
  title: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  error: string | null;
  metrics: Record<string, number>;
  warnings: string[];
};

export type SiteSnapshot = {
  id: string;
  name: string;
  url: string;
  status: SiteStatus;
  responseMs?: number;
  httpStatus?: number;
  sslDaysLeft?: number;
  problems: string[];
  warnings: string[];
  checks: Array<{ title: string; status: CheckRecord['status']; error: string | null }>;
};

const ANSI = /\u001b\[[0-9;]*m/g;

export function cleanError(message: string): string {
  return message.replace(ANSI, '').replace(/^Error:\s*/, '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 3).join(' · ');
}

/** Учитываем только окончательную попытку теста (Playwright может повторять упавшие). */
export function isFinalAttempt(test: TestCase, result: TestResult): boolean {
  return result.status === 'passed' || result.status === 'skipped' || result.retry >= test.retries;
}

export function toRecord(test: TestCase, result: TestResult, sites: Site[]): CheckRecord | null {
  if (!isFinalAttempt(test, result)) return null;

  // id сайта берётся из [квадратных скобок] в названии describe.
  const suiteTitle = test.titlePath().find(part => /\[[^\]]+\]/.test(part));
  const match = suiteTitle?.match(/\[([^\]]+)\]/);
  if (!suiteTitle || !match) return null;

  const siteId = match[1];
  const site = sites.find(s => s.id === siteId);
  const baseURL = (test.parent.project()?.use as { baseURL?: string } | undefined)?.baseURL ?? '';

  const annotations = result.annotations ?? test.annotations;
  const metrics: Record<string, number> = {};
  const warnings: string[] = [];
  for (const a of annotations) {
    if (a.type.startsWith('metric:') && a.description !== undefined) {
      metrics[a.type.slice('metric:'.length)] = Number(a.description);
    }
    if (a.type === 'warning' && a.description) warnings.push(a.description);
  }

  const error = result.errors.map(e => cleanError(e.message || String(e.value ?? e))).filter(Boolean).join(' | ');

  return {
    siteId,
    siteName: site?.name ?? suiteTitle.replace(/\s*\[[^\]]+\]\s*/, '').trim(),
    url: site?.url ?? baseURL,
    title: test.title,
    status: result.status === 'passed' ? 'passed' : result.status === 'skipped' ? 'skipped' : 'failed',
    durationMs: result.duration,
    error: error ? error.slice(0, 2000) : null,
    metrics,
    warnings
  };
}

export function summarize(records: CheckRecord[]): SiteSnapshot[] {
  const bySite = new Map<string, SiteSnapshot>();

  for (const r of records) {
    let snap = bySite.get(r.siteId);
    if (!snap) {
      snap = { id: r.siteId, name: r.siteName, url: r.url, status: 'up', problems: [], warnings: [], checks: [] };
      bySite.set(r.siteId, snap);
    }

    snap.checks.push({ title: r.title, status: r.status, error: r.error });
    if (r.metrics.response_ms !== undefined) snap.responseMs = r.metrics.response_ms;
    if (r.metrics.http_status !== undefined) snap.httpStatus = r.metrics.http_status;
    if (r.metrics.ssl_days_left !== undefined) snap.sslDaysLeft = r.metrics.ssl_days_left;
    snap.warnings.push(...r.warnings);
    if (r.status === 'failed') snap.problems.push(r.error ? `${r.title}: ${r.error}` : r.title);
  }

  for (const snap of bySite.values()) {
    const ran = snap.checks.filter(c => c.status !== 'skipped');
    if (ran.length === 0) continue;
    snap.status = snap.problems.length ? 'down' : snap.warnings.length ? 'degraded' : 'up';
  }

  return [...bySite.values()].filter(s => s.checks.some(c => c.status !== 'skipped'));
}
