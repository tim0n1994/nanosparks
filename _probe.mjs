import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto('http://localhost:7557/', { waitUntil: 'domcontentloaded' });
const shape = await page.evaluate(async () => {
  try {
    const m = await import('/_next/runtime/3d-force-graph'); // likely 404, but try the bundler path instead
    return { viaNext: Object.keys(m) };
  } catch (e) {
    return { viaNextErr: String(e) };
  }
});
// Try the real way: use a bare import resolved by the bundler inside app code is hard; instead probe window after loading graph page.
const page2 = await (await browser.newContext()).newPage();
await page2.goto('http://localhost:7557/corpora/cmrwkqawi000e7eyfa3pflf0j/graph', { waitUntil: 'networkidle' });
await page2.waitForTimeout(4000);
const probe = await page2.evaluate(async () => {
  const container = document.querySelector('div[class*="h-full w-full"]');
  const info = { containerFound: !!container, containerChildren: container ? container.childElementCount : -1, containerHTML: container ? container.innerHTML.slice(0,200) : '' };
  // try importing the lib as the app does
  try {
    const mod = await import('3d-force-graph');
    info.modKeys = Object.keys(mod);
    info.defaultType = typeof mod.default;
  } catch (e) { info.importErr = String(e); }
  return info;
});
await browser.close();
console.log(JSON.stringify({ shape, probe }, null, 2));
