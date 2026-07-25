import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.setContent(`<img id="i" src="file:///tmp/graph3d-desktop.png"><canvas id="c"></canvas>`);
await page.locator('#i').waitFor({ state: 'visible' });
await page.waitForFunction(() => (document.getElementById('i').naturalWidth || 0) > 0);
const stats = await page.evaluate(() => {
  const img = document.getElementById('i');
  const c = document.getElementById('c');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let colored = 0, total = 0;
  for (let y = 0; y < c.height; y += 3) {
    for (let x = 0; x < c.width; x += 3) {
      const i = (y*c.width + x)*4;
      total++;
      if (d[i]>90||d[i+1]>90||d[i+2]>90) colored++;
    }
  }
  return { w: c.width, h: c.height, sampled: total, colored, coloredPct: +(colored/total*100).toFixed(2) };
});
await browser.close();
console.log(JSON.stringify(stats));
