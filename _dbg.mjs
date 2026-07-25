import { chromium } from 'playwright';
const URL = 'http://localhost:7557/corpora/cmrwkqawi000e7eyfa3pflf0j/graph';
const API = 'http://localhost:7557/api/corpora/cmrwkqawi000e7eyfa3pflf0j/graph';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const logs = [];
page.on('console', m => logs.push(m.type()+': '+m.text()));
page.on('pageerror', e => logs.push('PAGEERR: '+String(e)));
page.on('requestfailed', r => logs.push('REQFAIL: '+r.url()+' '+r.failure()?.errorText));

const apiRes = await page.goto(API).then(r => r?.status());
const apiBody = await page.content();

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(5000);
const bodyText = (await page.locator('body').innerText()).slice(0, 600);
const canvasCount = await page.locator('canvas').count();
const divs = await page.locator('div').count();
await page.screenshot({ path: '/tmp/graph3d-dbg.png' });
await browser.close();
console.log('API status:', apiRes);
console.log('canvas count:', canvasCount, 'div count:', divs);
console.log('--- page text ---'); console.log(bodyText);
console.log('--- logs ---'); console.log(logs.slice(0,12).join('\n'));
