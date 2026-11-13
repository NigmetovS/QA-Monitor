
import 'dotenv/config';
import type {
  Reporter,
  FullResult,
  TestCase,
  TestResult
} from '@playwright/test/reporter';

class TelegramReporter implements Reporter {
  private passed = 0;
  private failed = 0;
  private skipped = 0;
  private errors: string[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    // Считаем только окончательный результат теста
    if (result.retry < test.retries &&
        result.status !== 'passed') {
      return;
    }

    if (result.status === 'passed') {
      this.passed++;
    } else if (result.status === 'skipped') {
      this.skipped++;
    } else {
      this.failed++;
      this.errors.push(test.title);
    }
  }

  async onEnd(result: FullResult) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      console.log('Telegram: token or chat ID missing');
      return;
    }

    const status =
      result.status === 'passed' && this.failed === 0
        ? '✅ QA Monitor: тесты прошли'
        : '🚨 QA Monitor: обнаружены ошибки';

    const message = [
      status,
      '',
      `Успешно: ${this.passed}`,
      `Ошибок: ${this.failed}`,
      `Пропущено: ${this.skipped}`,
      '',
      ...this.errors.slice(0, 5)
    ].join('\n');

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: message
          }),
          signal: AbortSignal.timeout(10000)
        }
      );

      if (response.ok) {
        console.log('Telegram notification sent');
      } else {
        console.error(
          'Telegram error:',
          response.status
        );
      }
    } catch (error) {
      console.error('Telegram connection error:', error);
    }
  }
}

export default TelegramReporter;
