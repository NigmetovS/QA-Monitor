
import { test, expect } from '@playwright/test';

const WEBSITE_URL =
  process.env.MONITOR_URL || 'https://example.com';

test('Website is available', async ({ page }) => {
  const response = await page.goto(WEBSITE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(400);
});

test('Homepage renders correctly', async ({ page }) => {
  await page.goto(WEBSITE_URL);

  await expect(page.locator('body')).toBeVisible();

  const text = await page.locator('body').innerText();

  expect(text.trim().length).toBeGreaterThan(0);
});

test('Website responds within 10 seconds', async ({ page }) => {
  const start = Date.now();

  await page.goto(WEBSITE_URL, {
    waitUntil: 'domcontentloaded'
  });

  const duration = Date.now() - start;

  console.log(`Response time: ${duration} ms`);

  expect(duration).toBeLessThan(10000);
});
