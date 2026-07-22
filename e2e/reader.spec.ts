import { test, expect } from '@playwright/test';

test.describe('Reader page (A3)', () => {
  test('home page has submit box as first screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('input[type="url"]')).toBeVisible();
    await expect(page.locator('button:has-text("读掉它")')).toBeVisible();
  });

  test('submit page loads with input box', async ({ page }) => {
    await page.goto('/submit');
    await expect(page.locator('input[type="url"]')).toBeVisible();
  });

  test('reader shows not-found for invalid conversation id', async ({ page }) => {
    const response = await page.goto('/read/nonexistent-id');
    expect(response?.status()).toBe(404);
  });

  test('public page shows not-found for invalid slug', async ({ page }) => {
    const response = await page.goto('/p/nonexistent-slug');
    expect(response?.status()).toBe(404);
  });
});
