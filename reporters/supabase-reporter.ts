import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { loadSites, type Site } from '../src/sites';
import { toRecord, type CheckRecord } from './collector';

/** Сохраняет каждую проверку в таблицу checks (схема — supabase/schema.sql). */
class SupabaseReporter implements Reporter {
  private sites: Site[] = [];
  private records: CheckRecord[] = [];

  onBegin() {
    try { this.sites = loadSites(); } catch { /* ошибку покажет monitor-reporter */ }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const record = toRecord(test, result, this.sites);
    if (record) this.records.push(record);
  }

  async onEnd() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      console.log('Supabase не настроен — история проверок не сохраняется');
      return;
    }
    if (this.records.length === 0) return;

    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const base = this.records.map(r => ({
      site_id: r.siteId,
      test_name: r.title,
      status: r.status,
      duration_ms: r.durationMs,
      error_message: r.error
    }));

    const extended = this.records.map((r, i) => ({
      ...base[i],
      site_name: r.siteName,
      url: r.url,
      http_status: r.metrics.http_status ?? null,
      response_ms: r.metrics.response_ms ?? null,
      ssl_days_left: r.metrics.ssl_days_left ?? null,
      warnings: r.warnings.length ? r.warnings.join('\n') : null,
      run_id: process.env.GITHUB_RUN_ID ?? null
    }));

    let { error } = await supabase.from('checks').insert(extended);

    // Таблица ещё в старом формате — сохраняем то, что можем, и подсказываем миграцию.
    if (error && (error.code === 'PGRST204' || /column/i.test(error.message))) {
      console.warn('Supabase: нет новых колонок. Выполните supabase/schema.sql в SQL Editor.');
      ({ error } = await supabase.from('checks').insert(base));
    }

    if (error) {
      console.error('Supabase insert error:', error.message);
      return;
    }
    console.log(`Supabase: сохранено проверок — ${this.records.length}`);
  }
}

export default SupabaseReporter;
