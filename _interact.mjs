import { chromium } from 'playwright';
const URL = 'http://localhost:7557/corpora/cmrwkqawi000e7eyfa3pflf0j/graph';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(5500);

// 1) rotate the scene by dragging (proves orbit controls active)
const canvas = page.locator('canvas').first();
const box = await canvas.boundingBox();
await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
await page.mouse.down();
await page.mouse.move(box.x + box.width/2 + 120, box.y + box.height/2 + 40, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/graph3d-rotated.png' });

// 2) click a node center-ish to trigger the evidence popover
await page.mouse.click(box.x + box.width*0.55, box.y + box.height*0.5);
await page.waitForTimeout(800);
const popover = await page.locator('text=以此提问').count();
await page.screenshot({ path: '/tmp/graph3d-clicked.png' });

// 3) mobile viewport
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/graph3d-mobile.png' });

// 4) switch to list view (fallback)
await page.getByRole('button', { name: '列表' }).click();
await page.waitForTimeout(600);
const listItems = await page.locator('button:has(span.truncate)').count();
await page.screenshot({ path: '/tmp/graph3d-list.png' });

await browser.close();
console.log(JSON.stringify({ popoverVisible: popover > 0, listItems }));
