import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { loadSites, type Site } from '../src/sites';
import { appendHistory, readState, saveState, siteStats, type HistoryEntry } from '../src/history';
import { buildStatusPage } from '../src/status-page';
import { escapeHtml as h, runUrl, sendTelegram } from '../src/telegram';
import { summarize, toRecord, type CheckRecord, type SiteSnapshot, type SiteStatus } from './collector';

const STATUS_PAGE = path.join(process.cwd(), 'status-page', 'index.html');
// Час (UTC) ежедневной сводки. 3 = 08:00 по Казахстану (UTC+5).
const SUMMARY_HOUR_UTC = Number(process.env.SUMMARY_HOUR_UTC ?? 3);
const ICON: Record<SiteStatus, string> = { up: '✅', degraded: '⚠️', down: '🚨' };

/**
 * Главный репортёр мониторинга:
 *  - считает статус каждого сайта (работает / замечания / не работает);
 *  - шлёт в Telegram только смену статуса (без повторов при каждой проверке);
 *  - раз в сутки шлёт сводку;
 *  - собирает статус-страницу status-page/index.html для клиента.
 */
class MonitorReporter implements Reporter {
  private sites: Site[] = [];
  private records: CheckRecord[] = [];

  onBegin() {
    try {
      this.sites = loadSites();
    } catch (error) {
      console.error('Не удалось загрузить список сайтов:', error);
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const record = toRecord(test, result, this.sites);
    if (record) this.records.push(record);
  }

  async onEnd(result: FullResult) {
    // При прерванном запуске статусы недостоверны — ничего не сохраняем.
    if (result.status === 'interrupted') {
      console.warn('Мониторинг прерван, состояние не обновлено');
      return;
    }

    const now = new Date();
    const snapshots = summarize(this.records);
    const history = appendHistory(snapshots, now);
    const state = readState();
    const link = runUrl();

    for (const snap of snapshots) {
      const previous = state.sites[snap.id];
      // Первый запуск для сайта: сообщаем только о проблемах.
      const changed = previous ? previous !== snap.status : snap.status !== 'up';
      if (changed) await sendTelegram(alertMessage(snap, previous, link));
      state.sites[snap.id] = snap.status;
    }

    const today = now.toISOString().slice(0, 10);
    const summaryEnabled = process.env.CI && process.env.DAILY_SUMMARY !== 'off';
    if (summaryEnabled && now.getUTCHours() >= SUMMARY_HOUR_UTC && state.lastSummaryDate !== today && snapshots.length) {
      if (await sendTelegram(summaryMessage(snapshots, history, now, link))) {
        state.lastSummaryDate = today;
      }
    }

    saveState(state);

    fs.mkdirSync(path.dirname(STATUS_PAGE), { recursive: true });
    fs.writeFileSync(STATUS_PAGE, buildStatusPage(snapshots, history, { runUrl: link, now }));
    console.log(`Статус-страница: ${path.relative(process.cwd(), STATUS_PAGE)}`);
  }
}

function alertMessage(snap: SiteSnapshot, previous: SiteStatus | undefined, link: string | null): string {
  const lines: string[] = [];

  if (snap.status === 'down') lines.push(`🚨 <b>Сайт не работает: ${h(snap.name)}</b>`);
  else if (snap.status === 'degraded') lines.push(`⚠️ <b>Замечания по сайту: ${h(snap.name)}</b>`);
  else lines.push(`✅ <b>Сайт снова работает: ${h(snap.name)}</b>`);

  lines.push(h(snap.url));
  if (previous) lines.push(`Было: ${ICON[previous]} → стало: ${ICON[snap.status]}`);

  if (snap.problems.length) {
    lines.push('', '<b>Проблемы:</b>', ...snap.problems.slice(0, 5).map(p => `• ${h(p.slice(0, 300))}`));
  }
  if (snap.warnings.length) {
    lines.push('', ...snap.warnings.slice(0, 5).map(w => `• ${h(w)}`));
  }

  const facts: string[] = [];
  if (snap.httpStatus) facts.push(`HTTP ${snap.httpStatus}`);
  if (snap.responseMs !== undefined) facts.push(`ответ ${snap.responseMs} мс`);
  if (snap.sslDaysLeft !== undefined) facts.push(`SSL ${snap.sslDaysLeft} дн.`);
  if (facts.length) lines.push('', facts.join(' · '));

  if (link) lines.push('', `<a href="${h(link)}">Отчёт, скриншоты и видео</a>`);
  return lines.join('\n');
}

function summaryMessage(snapshots: SiteSnapshot[], history: HistoryEntry[], now: Date, link: string | null): string {
  const lines = ['📊 <b>QA Monitor — сводка за сутки</b>', ''];
  let incidents = 0;

  for (const snap of snapshots) {
    const s = siteStats(history, snap.id, 24, now);
    incidents += s.incidents;
    const parts = [
      s.uptime === null ? 'нет данных' : `аптайм ${s.uptime === 100 ? '100' : s.uptime.toFixed(1)}%`,
      s.avgMs !== null ? `ср. ${s.avgMs} мс` : null,
      snap.sslDaysLeft !== undefined ? `SSL ${snap.sslDaysLeft} дн.` : null
    ].filter(Boolean);
    lines.push(`${ICON[snap.status]} <b>${h(snap.name)}</b> — ${parts.join(' · ')}`);
  }

  lines.push('', incidents ? `Инцидентов за сутки: ${incidents}` : 'Инцидентов за сутки не было.');
  if (link) lines.push(`<a href="${h(link)}">Последний запуск</a>`);
  return lines.join('\n');
}

export default MonitorReporter;
