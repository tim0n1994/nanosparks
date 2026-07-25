import { chromium } from 'playwright';
const URL = 'http://localhost:7557/corpora/cmrwkqawi000e7eyfa3pflf0j/graph';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(5500);
const canvas = page.locator('canvas').first();
const box = await canvas.boundingBox();

// Find a bright node pixel via toDataURL sampling (RGB average over small grid).
const hit = await canvas.evaluate((c) => {
  const w = c.width, h = c.height;
  // draw the webgl canvas onto a 2d canvas to read pixels
  const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
  const ctx = tmp.getContext('2d');
  try { ctx.drawImage(c, 0, 0); } catch (e) { return null; }
  const data = ctx.getImageData(0, 0, w, h).data;
  // sample a coarse grid, pick the brightest non-background point
  let best = null, bestBright = 60;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const i = (y*w + x)*4;
      const r=data[i],g=data[i+1],b=data[i+2];
      const bright = r+g+b;
      if (bright > bestBright) { bestBright = bright; best = { x, y, r, g, b }; }
    }
  }
  return best;
});
let popover = false;
if (hit) {
  // map canvas-internal px to page coords (canvas may be scaled by CSS)
  const scaleX = box.width / (await canvas.evaluate(c=>c.width));
  const scaleY = box.height / (await canvas.evaluate(c=>c.height));
  const px = box.x + hit.x*scaleX, py = box.y + hit.y*scaleY;
  await page.mouse.click(px, py);
  await page.waitForTimeout(900);
  popover = (await page.locator('text=以此提问').count()) > 0;
  await page.screenshot({ path: '/tmp/graph3d-nodehit.png' });
}
await browser.close();
console.log(JSON.stringify({ hitFound: !!hit, hit, popover }));
