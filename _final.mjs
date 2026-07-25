import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:7557/corpora/cmrwkqawi000e7eyfa3pflf0j/graph', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(6000);
await p.screenshot({ path: '/tmp/graph3d-verify.png' });
const c = await p.locator('canvas').count();
await b.close();
console.log(JSON.stringify({ canvasCount: c }));
