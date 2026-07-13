import { test, expect } from '@playwright/test';

test('visualization page loads', async ({ page }) => {
  await page.goto('/visualization/ep1');
  await expect(page.locator('text=NanoSparks')).toBeVisible();
});
