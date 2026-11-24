// 交互链路: 酥碱刷/补砖/量测/掺量/种子 → 数据与高度场变化
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

await page.locator('nav.tabs button', { hasText: '近看预览' }).click({ force: true });
await page.waitForTimeout(2000);

// 选酥碱刷, 在画布上拖一笔
await page.locator('button', { hasText: '酥碱刷' }).click();
const box = await page.locator('canvas').boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.mouse.down();
for (let i = 0; i < 6; i++) {
  await page.mouse.move(box.x + box.width * (0.45 + i * 0.02), box.y + box.height * 0.5);
  await page.waitForTimeout(60);
}
await page.mouse.up();
await page.waitForTimeout(400);

// 补砖刷
await page.locator('button', { hasText: '补砖刷' }).click();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.waitForTimeout(400);

// 量测点
await page.locator('button', { hasText: '量测点' }).click();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.waitForTimeout(400);
const pickText = await page.locator('.panel').filter({ hasText: '量测点' }).innerText().catch(() => '');
const hasHeight = /高度 h=/.test(pickText);
console.log('量测点返回高度场:', hasHeight);

// IndexedDB 里风化层落库
const saved = await page.evaluate(async () => {
  const open = indexedDB.open('brick-studio-db');
  return new Promise((resolve) => {
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('projects', 'readonly');
      const req = tx.objectStore('projects').getAll();
      req.onsuccess = () => {
        const p = req.result[0];
        const w = Object.values(p.weathering)[0] || { stamps: [], repairs: [] };
        resolve({ stamps: w.stamps.length, repairs: w.repairs.length, seed: p.blend.seed, ratio: p.blend.newRatio });
      };
    };
  });
});
console.log('IndexedDB 风化/补砖记录:', JSON.stringify(saved));

// 改种子与掺量
await page.locator('button', { hasText: '换一版混排' }).click();
await page.waitForTimeout(500);
const after = await page.evaluate(async () => {
  const open = indexedDB.open('brick-studio-db');
  return new Promise((r) => { open.onsuccess = () => {
    const tx = open.result.transaction('projects', 'readonly');
    const req = tx.objectStore('projects').getAll();
    req.onsuccess = () => r({ seed: req.result[0].blend.seed });
  }; });
});
console.log('换种子后:', JSON.stringify(after), '种子已变化:', after.seed !== saved.seed);

console.log('page errors:', errors.length ? errors.join(' | ') : '(无)');
await browser.close();
process.exit(errors.length || !hasHeight || saved.stamps === 0 ? 1 : 0);
