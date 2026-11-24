// 浏览器端到端验证(本机远程会话无 GPU, 自动走 Canvas2D 软件回退)
import { chromium } from 'playwright';

const errors = [];
const pageErrors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const tabs = await page.locator('nav.tabs button').allTextContents();
console.log('标签页:', tabs.join(' | '));

// 近看预览(软件回退渲染)
await page.locator('nav.tabs button', { hasText: '近看预览' }).click();
await page.waitForTimeout(3000);
const hud = await page.locator('.hud').textContent().catch(() => '');
console.log('预览HUD:', hud?.replace(/\s+/g, ' ').trim().slice(0, 160));
const fps = hud?.match(/([\d.]+)\s*FPS/);
console.log('软件回退 FPS:', fps ? fps[1] : '未取到');

// 0.5m 贴墙镜头
await page.locator('button', { hasText: '贴墙 0.5m' }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'test/shot-near.png' });
await page.locator('button', { hasText: '整墙远眺' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'test/shot-far.png' });

// 调掺砖比例
await page.locator('input[type="range"]').first().evaluate((el) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '0.6');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(800);

// 逐页检查并截图
const shots = [
  ['项目立面', 'test/shot-elevation.png'],
  ['排砖设计', 'test/shot-bond.png'],
  ['缝形工艺', 'test/shot-joint.png'],
  ['材料清单', 'test/shot-bom.png'],
  ['设置', 'test/shot-settings.png'],
];
for (const [name, file] of shots) {
  await page.locator('nav.tabs button', { hasText: name }).click({ force: true }).catch(async () => {
    await page.waitForTimeout(300);
    await page.locator('nav.tabs button', { hasText: name }).click({ force: true });
  });
  await page.waitForTimeout(1000);
  const panels = await page.locator('.panel').count();
  await page.screenshot({ path: file });
  console.log(`[${name}] 面板=${panels} 截图=${file}`);
}

// 清单数字校验
await page.locator('nav.tabs button', { hasText: '材料清单' }).click({ force: true });
await page.waitForTimeout(800);
const bomTotal = await page.locator('table.bom tfoot td').nth(1).textContent();
console.log('清单砖块合计:', bomTotal);

// IndexedDB
const idbOk = await page.evaluate(async () =>
  (await indexedDB.databases()).some((d) => d.name === 'brick-studio-db'));
console.log('IndexedDB 已建库:', idbOk);

console.log('\nconsole errors:', errors.length ? errors.slice(0, 8).join(' | ') : '(无)');
console.log('page errors:', pageErrors.length ? pageErrors.slice(0, 8).join(' | ') : '(无)');
await browser.close();
process.exit(pageErrors.length ? 1 : 0);
