import { test, expect } from '@playwright/test';

test('share page is publicly accessible', async ({ page }) => {
  await page.goto('/share/demo-share-123');
  await expect(page.locator('text=NanoSparks')).toBeVisible();
});
