import { test, expect } from '@playwright/test';

test('homepage has title and navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/NanoSparks/);
  await expect(page.locator('text=Turn podcasts into')).toBeVisible();
  await expect(page.locator('text=Analyze a Channel')).toBeVisible();
});
