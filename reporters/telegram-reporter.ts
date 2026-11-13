
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Reporter,
  FullResult,
  TestCase,
  TestResult
} from '@playwright/test/reporter';

type SiteStatus = 'up' | 'down';
type StatusStore = Record<string, SiteStatus>;

const STATE_FILE = path.join(
  process.cwd(),
  '.monitor-state',
  'status.json'
);

class TelegramReporter implements Reporter {
  private results = new Map<string, SiteStatus>();
  private pending = new Map<string, SiteStatus>();
  private errors = new Map<string, string[]>();

  onTestEnd(test: TestCase, result: TestResult) {
    // Playwright может повторять упавшие тесты.
    // Учитываем только окончательный результат.
    const finalAttempt =
      result.status === 'passed' ||
      result.status === 'skipped' ||
      result.retry >= test.retries;

    if (!finalAttempt) return;
    if (result.status === 'skipped') return;

    const match = test.titlePath()
      .join(' ')
      .match(/\[([^\]]+)\]/);

    // Тесты без [site-id] пока не участвуют
    // в мониторинге отдельных сайтов.
    if (!match) return;

    const siteId = match[1];
    const status: SiteStatus =
      result.status === 'passed' ? 'up' : 'down';

    if (status === 'down') {
      this.results.set(siteId, 'down');

      const messages = this.errors.get(siteId) || [];
      messages.push(test.title);
      this.errors.set(siteId, messages);
    } else if (!this.results.has(siteId)) {
      this.results.set(siteId, 'up');
    }
  }

  private readState(): StatusStore {
    try {
      if (!fs.existsSync(STATE_FILE)) return {};

      return JSON.parse(
        fs.readFileSync(STATE_FILE, 'utf8')
      ) as StatusStore;
    } catch (error) {
      console.error('Cannot read monitor state:', error);
      return {};
    }
  }

  private saveState(state: StatusStore) {
    fs.mkdirSync(path.dirname(STATE_FILE), {
      recursive: true
    });

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(state, null, 2)
    );
  }

  private async notify(message: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      console.warn('Telegram credentials missing');
      return;
    }

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

      if (!response.ok) {
        console.error(
          'Telegram error:',
          response.status,
          await response.text()
        );
      } else {
        console.log('Telegram notification sent');
      }
    } catch (error) {
      console.error('Telegram connection error:', error);
    }
  }

  async onEnd(result: FullResult) {
    // При неполном запуске не записываем
    // недостоверные статусы сайтов.
    if (result.status === 'interrupted') {
      console.warn('Monitoring interrupted');
      return;
    }

    const previous = this.readState();
    const next = { ...previous };

    for (const [siteId, current] of this.results) {
      const old = previous[siteId];

      if (old === 'up' && current === 'down') {
        const details = (this.errors.get(siteId) || [])
          .slice(0, 5)
          .join('\n');

        await this.notify(
          `🚨 QA Monitor: SITE DOWN\n\n` +
          `Сайт: ${siteId}\n` +
          `Проблемы:\n${details}`
        );
      }

      if (old === 'down' && current === 'up') {
        await this.notify(
          `✅ QA Monitor: SITE RECOVERED\n\n` +
          `Сайт: ${siteId}\n` +
          `Все проверки прошли успешно.`
        );
      }

      if (!old) {
        console.log(
          `Initial status: ${siteId} = ${current}`
        );

        // Неизвестный сайт, который сразу упал,
        // тоже должен вызвать предупреждение.
        if (current === 'down') {
          await this.notify(
            `🚨 QA Monitor: SITE DOWN\n\n` +
            `Сайт: ${siteId}\n` +
            `Ошибка при первой проверке.`
          );
        }
      }

      next[siteId] = current;
    }

    this.saveState(next);
    console.log('Monitor state saved');
  }
}

export default TelegramReporter;
