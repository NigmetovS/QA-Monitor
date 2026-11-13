
import { test, expect } from '@playwright/test';
import sitesConfig from '../sites.json';

type Site = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
};

const sites = (sitesConfig.sites as Site[])
  .filter(site => site.enabled);

for (const site of sites) {
  test.describe(`${site.name} [${site.id}]`, () => {

    test('Website is available', async ({ page }) => {
      const response = await page.goto(site.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      expect(response).not.toBeNull();
      expect(response!.status()).toBeLessThan(400);
    });

    test('Homepage renders correctly', async ({ page }) => {
      await page.goto(site.url, {
        waitUntil: 'domcontentloaded'
      });

      await expect(page.locator('body')).toBeVisible();

      const text = await page.locator('body').innerText();

      expect(text.trim().length).toBeGreaterThan(0);
    });

    test('Website responds within 10 seconds', async ({ page }) => {
      const start = Date.now();

      await page.goto(site.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const duration = Date.now() - start;

      console.log(`${site.name}: ${duration} ms`);

      expect(duration).toBeLessThan(10000);
    });

  });
}
