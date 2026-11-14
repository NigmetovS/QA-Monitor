
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type {
  Reporter,
  TestCase,
  TestResult
} from '@playwright/test/reporter';

class SupabaseReporter implements Reporter {
  private records: Array<{
    site_id: string;
    test_name: string;
    status: 'passed' | 'failed' | 'skipped';
    duration_ms: number;
    error_message: string | null;
  }> = [];

  onTestEnd(test: TestCase, result: TestResult) {
    const finalAttempt =
      result.status === 'passed' ||
      result.status === 'skipped' ||
      result.retry >= test.retries;

    if (!finalAttempt) return;

    const match = test.titlePath()
      .join(' ')
      .match(/\[([^\]]+)\]/);

    if (!match) return;

    this.records.push({
      site_id: match[1],
      test_name: test.title,
      status: result.status === 'passed'
        ? 'passed'
        : result.status === 'skipped'
          ? 'skipped'
          : 'failed',
      duration_ms: result.duration,
      error_message: result.errors
        .map(error => error.message || String(error))
        .join('\n')
        .slice(0, 2000) || null
    });
  }

  async onEnd() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      console.log('Supabase credentials missing');
      return;
    }

    if (this.records.length === 0) {
      console.log('No site checks to save');
      return;
    }

    const supabase = createClient(url, key);

    const { error } = await supabase
      .from('checks')
      .insert(this.records);

    if (error) {
      console.error(
        'Supabase insert error:',
        error.message
      );
      return;
    }

    console.log(
      `Supabase: saved ${this.records.length} checks`
    );
  }
}

export default SupabaseReporter;
