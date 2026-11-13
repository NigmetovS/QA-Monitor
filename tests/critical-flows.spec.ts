import { test, expect } from '@playwright/test';

// Replace these demonstration scenarios with authorized client flows.
test('Homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Demo Shop' })).toBeVisible();
});

test('Product can be added to cart', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText('1');
});

test('Order form validates required email', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Checkout' }).click();
  await expect(page.getByText('Email is required')).toBeVisible();
});

test('Order can be submitted', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('demo@example.com');
  await page.getByRole('button', { name: 'Checkout' }).click();
  await expect(page.getByRole('status')).toHaveText('Order received');
});
