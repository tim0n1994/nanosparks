import { test, expect } from '@playwright/test';

/**
 * V1/T-V1-3: reader L0 structure panel e2e.
 *
 * Requires a seeded, completed conversation. Set E2E_CONVERSATION_ID to a real
 * conversation id (with turns + thought units) to exercise the full path:
 * open reader → 结构 region → swimlane/argument click → player seeks.
 * Skips automatically when no fixture is configured.
 */
const CONVERSATION_ID = process.env.E2E_CONVERSATION_ID;

test.describe.skipIf(!CONVERSATION_ID)('Reader L0 structure (V1)', () => {
  test('structure panel renders and swimlane click seeks the player', async ({ page }) => {
    await page.goto(`/read/${CONVERSATION_ID}`);

    // Expand the 结构 section.
    const toggle = page.getByRole('button', { expanded: false }).first();
    await expect(toggle).toBeVisible();
    await toggle.click();

    // A speaker lane block must be present and clickable.
    const firstBlock = page.locator('section button[title]').first();
    await expect(firstBlock).toBeVisible();
    await firstBlock.click();

    // Player element exists and its currentTime advanced off zero.
    const player = page.locator('#reader-player') as unknown as { evaluate: (fn: (el: HTMLAudioElement) => number) => Promise<number> };
    await expect.poll(async () => player.evaluate((el) => el.currentTime)).toBeGreaterThan(0);
  });
});
