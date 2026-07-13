import { test, expect } from '@playwright/test';

test('submit page has form', async ({ page }) => {
  await page.goto('/submit');
  await expect(page.locator('input[type="url"]')).toBeVisible();
  await expect(page.locator('text=Analyze Channel')).toBeVisible();
});
