import { chromium, devices } from 'playwright';

const URL = 'http://localhost:7557/corpora/cmrwkqawi000e7eyfa3pflf0j/graph';
const OUT = '/tmp/graph3d';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
// let the 3D force sim settle + lazy import resolve
await page.waitForTimeout(6000);

// canvas present + non-blank pixel check
const canvas = page.locator('canvas').first();
const present = await canvas.count();
let nonBlank = false, pxSample = 0;
if (present) {
  const box = await canvas.boundingBox();
  const result = await canvas.evaluate((c) => {
    try {
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return { gl: false };
      const w = c.width, h = c.height;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let colored = 0;
      for (let i = 0; i < buf.length; i += 4) {
        const r = buf[i], g = buf[i+1], b = buf[i+2];
        // not pure background (the page bg is dark zinc; graph nodes are bright)
        if (r > 60 || g > 60 || b > 60) colored++;
      }
      return { gl: true, w, h, colored };
    } catch (e) { return { gl: false, err: String(e) }; }
  });
  nonBlank = result.gl && result.colored > 0;
  pxSample = result.colored ?? 0;
  void box;
}

await page.screenshot({ path: `${OUT}-desktop.png`, fullPage: false });

// mobile viewport
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}-mobile.png`, fullPage: false });

await browser.close();
console.log(JSON.stringify({ canvasPresent: !!present, nonBlank, pxSample, consoleErrors: errs.slice(0,5) }, null, 2));
