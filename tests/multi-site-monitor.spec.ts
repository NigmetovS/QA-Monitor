import tls from 'node:tls';
import { test, expect } from '@playwright/test';
import { loadSites, DEFAULT_SLOW_MS, SSL_WARN_DAYS } from '../src/sites';

// Метрики и предупреждения передаются репортёрам через аннотации:
//   metric:<имя>  — число (время ответа, HTTP-код, дни до конца SSL)
//   warning       — сайт работает, но есть деградация (медленно, SSL скоро истекает)
function metric(name: string, value: number) {
  test.info().annotations.push({ type: `metric:${name}`, description: String(value) });
}

function warning(text: string) {
  test.info().annotations.push({ type: 'warning', description: text });
}

function certificateDaysLeft(host: string, port: number): Promise<{ days: number; authorized: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const error = socket.authorizationError ? String(socket.authorizationError) : undefined;
      socket.end();
      if (!cert?.valid_to) return reject(new Error('Сертификат не получен'));
      const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
      resolve({ days, authorized, error });
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('Таймаут TLS-соединения')); });
    socket.on('error', reject);
  });
}

for (const site of loadSites()) {
  test.describe(`${site.name} [${site.id}]`, () => {

    test('Сайт доступен и отвечает', async ({ page }) => {
      const slowMs = site.slowMs ?? DEFAULT_SLOW_MS;
      const start = Date.now();
      const response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const elapsed = Date.now() - start;

      expect(response, 'Нет HTTP-ответа').not.toBeNull();
      metric('http_status', response!.status());
      metric('response_ms', elapsed);

      expect(response!.status(), `HTTP ${response!.status()}`).toBeLessThan(400);

      const text = (await page.locator('body').innerText()).trim();
      expect(text.length, 'Пустая страница').toBeGreaterThan(0);

      if (site.expectText) {
        await expect(page.getByText(site.expectText).first(), `На странице нет текста «${site.expectText}»`).toBeVisible();
      }

      if (elapsed > slowMs) {
        warning(`Медленный ответ: ${elapsed} мс (порог ${slowMs} мс)`);
      }
    });

    if (site.url.startsWith('https://')) {
      test('SSL-сертификат действителен', async () => {
        const url = new URL(site.url);
        const cert = await certificateDaysLeft(url.hostname, Number(url.port) || 443);
        metric('ssl_days_left', cert.days);

        expect(cert.authorized, `Сертификат недействителен: ${cert.error}`).toBe(true);
        expect(cert.days, 'Сертификат истёк').toBeGreaterThanOrEqual(0);

        if (cert.days < SSL_WARN_DAYS) {
          warning(`SSL-сертификат истекает через ${cert.days} дн.`);
        }
      });
    }
  });
}
