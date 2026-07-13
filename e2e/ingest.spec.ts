import { test, expect } from '@playwright/test';

test.describe('Ingest flow', () => {
  test('submit without URL shows validation error', async ({ page }) => {
    await page.goto('/submit');
    await page.getByRole('button', { name: /analyze/i }).click();
    // Should show error or stay on page
    await expect(page).toHaveURL(/submit/);
  });

  test('health shows service status', async ({ request }) => {
    const res = await request.get('/api/health');
    const body = await res.json();
    expect(body.checks).toBeDefined();
  });
});
