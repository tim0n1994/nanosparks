import { chromium } from 'playwright';
const URL = 'http://localhost:7557/corpora/cmrwkqawi000e7eyfa3pflf0j/graph';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: '/tmp/graph3d-final.png', fullPage: false });
await browser.close();
console.log('shot saved');
