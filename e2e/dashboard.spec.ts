import { test, expect } from '@playwright/test';

test('dashboard page loads', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveTitle(/NanoSparks/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('submit page loads and has form', async ({ page }) => {
  await page.goto('/submit');
  await expect(page.getByRole('heading', { name: 'Analyze a Channel' })).toBeVisible();
  await expect(page.locator('input[placeholder*="YouTube"]')).toBeVisible();
});
