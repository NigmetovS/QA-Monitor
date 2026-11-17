import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

// Универсальные сценарии интернет-магазина, настраиваемые без кода.
// Запускаются только если задан конфиг: переменная ECOMMERCE_JSON (секрет GitHub)
// или файл, путь к которому в ECOMMERCE_CONFIG. Формат:
// { "shops": [{ "id": "shop", "name": "Магазин", "url": "https://...",
//   "searchQuery": "корм для кошек", "allowCart": false, "whatsapp": true }] }
//
// Только с письменного разрешения владельца сайта. Сценарии не оформляют
// заказы и не оплачивают; добавление в корзину — только при allowCart: true.

type Shop = {
  id: string;
  name: string;
  url: string;
  searchQuery?: string;
  allowCart?: boolean;
  whatsapp?: boolean;
  /** Селекторы, если общие эвристики не подходят для сайта. */
  selectors?: { search?: string; product?: string; addToCart?: string; cartCount?: string };
};

function loadShops(): Shop[] {
  const raw = process.env.ECOMMERCE_JSON?.trim()
    || (process.env.ECOMMERCE_CONFIG && fs.readFileSync(process.env.ECOMMERCE_CONFIG, 'utf8'));
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.shops;
}

const SEARCH = [
  'input[type="search"]', 'input[name="q"]', 'input[name="query"]', 'input[name="search"]',
  'input[name*="search" i]', 'input[placeholder*="поиск" i]', 'input[placeholder*="найти" i]'
].join(', ');
const PRICE = /\d[\d\s ]*\s?(₸|тг|тенге|KZT)/i;

async function firstVisible(page: Page, selector: string) {
  const all = page.locator(selector);
  const count = await all.count();
  for (let i = 0; i < count; i++) if (await all.nth(i).isVisible()) return all.nth(i);
  return null;
}

for (const shop of loadShops()) {
  test.describe(`${shop.name} [${shop.id}]`, () => {
    test('Главная: открывается, есть цены', async ({ page }) => {
      const response = await page.goto(shop.url, { waitUntil: 'domcontentloaded' });
      expect(response?.status() ?? 0, 'HTTP-статус главной').toBeLessThan(400);
      await expect(page.locator('body')).toContainText(PRICE, { timeout: 15_000 });
    });

    if (shop.searchQuery) {
      test(`Поиск: «${shop.searchQuery}» находит товары`, async ({ page }) => {
        await page.goto(shop.url, { waitUntil: 'domcontentloaded' });
        const input = await firstVisible(page, shop.selectors?.search || SEARCH);
        expect(input, 'Поле поиска не найдено').not.toBeNull();
        await input!.fill(shop.searchQuery!);
        await input!.press('Enter');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).not.toContainText(/ничего не найдено|нет результатов|ничего не нашлось/i, { timeout: 10_000 });
        await expect(page.locator('body')).toContainText(PRICE, { timeout: 15_000 });
      });
    }

    if (shop.allowCart && shop.selectors?.product && shop.selectors?.addToCart) {
      test('Корзина: товар добавляется', async ({ page }) => {
        await page.goto(shop.url, { waitUntil: 'domcontentloaded' });
        await page.locator(shop.selectors!.product!).first().click();
        await page.locator(shop.selectors!.addToCart!).first().click();
        if (shop.selectors!.cartCount) {
          await expect(page.locator(shop.selectors!.cartCount!).first()).not.toHaveText(/^\s*0?\s*$/, { timeout: 10_000 });
        }
      });
    }

    if (shop.whatsapp) {
      test('WhatsApp: ссылка с номером магазина', async ({ page }) => {
        await page.goto(shop.url, { waitUntil: 'domcontentloaded' });
        const href = await page.locator('a[href*="wa.me"], a[href*="whatsapp"]').first().getAttribute('href');
        expect(href, 'Ссылка WhatsApp не найдена').toBeTruthy();
        expect(href!, 'В ссылке WhatsApp нет номера').toMatch(/\d{10,}/);
      });
    }
  });
}
