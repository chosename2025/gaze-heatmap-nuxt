import * as z from "zod";
import puppeteer from "puppeteer";
import { createCanvas, loadImage } from "canvas";

const renderWebPageSchema = z.object({
  url: z.string(),
  width: z.number(),
  height: z.number(),
  points: z.array(z.object({
    x: z.number(),
    y: z.number(),
  })).optional(),
});

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function createHeatmapOverlay(points: Array<{x: number, y: number}>, width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'lighter';

  const radius = 30;
  const maxPointsPerPixel = 5;

  const intensityMap = new Float32Array(width * height);

  points.forEach(point => {
    const x0 = Math.max(0, Math.floor(point.x - radius));
    const x1 = Math.min(width, Math.floor(point.x + radius));
    const y0 = Math.max(0, Math.floor(point.y - radius));
    const y1 = Math.min(height, Math.floor(point.y + radius));

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = point.x - x;
        const dy = point.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < radius) {
          const intensity = (1 - distance / radius) * 0.4;
          const index = y * width + x;
          intensityMap[index] = Math.min(intensityMap[index] + intensity, maxPointsPerPixel);
        }
      }
    }
  });

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let i = 0, j = 0; i < intensityMap.length; i++, j += 4) {
    const intensity = Math.min(intensityMap[i], 1);
    if (intensity > 0) {
      const hue = (1 - intensity) * (240 / 360);
      const [r, g, b] = hslToRgb(hue, 1, 0.5);
      data[j] = r;
      data[j + 1] = g;
      data[j + 2] = b;
      data[j + 3] = intensity * 180;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const blurredCanvas = createCanvas(width, height);
  const bCtx = blurredCanvas.getContext('2d');
  bCtx.drawImage(canvas, 0, 0);

  return blurredCanvas.toBuffer();
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { url, width, height, points } = renderWebPageSchema.parse(body);
  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-ipc-flooding-protection',
      '--memory-pressure-off',
      '--max_old_space_size=4096',
    ],
    headless: true,
    timeout: 60000,
    protocolTimeout: 60000,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 0});
    await page.goto(url, { waitUntil: 'networkidle0' });
    
    const screenshotBuffer = await page.screenshot({ encoding: "binary", fullPage: true });
    
    const screenshotImage = await loadImage(screenshotBuffer as Buffer);
    const actualWidth = screenshotImage.width;
    const actualHeight = screenshotImage.height;
    
    const heatmapBuffer = points ? createHeatmapOverlay(points, actualWidth, actualHeight) : null;
    
    const canvas = createCanvas(actualWidth, actualHeight);
    const ctx = canvas.getContext('2d');
    
    const heatmapImage = heatmapBuffer ? await loadImage(heatmapBuffer) : null;
    
    ctx.drawImage(screenshotImage, 0, 0);
    if (heatmapImage) {
      ctx.drawImage(heatmapImage, 0, 0);
    }
    
    const finalScreenshot = canvas.toBuffer('image/png');
    
    await browser.close();
    
    return { screenshot: finalScreenshot.toString('base64'), fullPage: true };
  } catch (error) {
    await browser.close();
    throw createError({
      statusCode: 500,
      message: "Failed to capture screenshot",
    });
  }
});