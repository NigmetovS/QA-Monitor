import { test, expect } from '@playwright/test';

// Демонстрационные бизнес-сценарии на локальном демо-магазине.
// Для клиента замените их сценариями его staging-окружения (с разрешения).
// [demo-shop] в названии — id, под которым результаты попадают в отчёты.
test.describe('Демо-магазин (сценарии покупки) [demo-shop]', () => {
  test('Главная страница открывается', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Demo Shop' })).toBeVisible();
  });

  test('Товар добавляется в корзину', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
  });

  test('Форма заказа проверяет email', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Checkout' }).click();
    await expect(page.getByText('Email is required')).toBeVisible();
  });

  test('Заказ оформляется', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill('demo@example.com');
    await page.getByRole('button', { name: 'Checkout' }).click();
    await expect(page.getByRole('status')).toHaveText('Order received');
  });
});
