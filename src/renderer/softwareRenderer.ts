import { BondResult, Project, WallSpec } from '../core/types';
import { CpuHeightField } from '../core/heightField';

/**
 * 软件回退渲染器: WebGPU 不可用时用 Canvas2D 逐像素绘制。
 * 与 WebGPU 走同一个 CpuHeightField(同构高度场), 近看缝深同样精确。
 * 相机: 目标墙局部坐标居中, distance 决定缩放(模拟透视), yaw 控制转角墙旋转。
 */
export class SoftwareRenderer {
  canvas: HTMLCanvasElement;
  project: Project;
  bonds: Record<string, BondResult>;
  fields = new Map<string, CpuHeightField>();
  targetWallId: string;
  target: [number, number] = [0, 0];
  yaw = 0;
  distance = 14000;
  private raf = 0;
  private disposed = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private cb: { onFps?: (fps: number, info: string) => void };
  private fpsAcc = 0;
  private fpsFrames = 0;
  private lastT = performance.now();
  private off: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, project: Project, bonds: Record<string, BondResult>, cb: { onFps?: (fps: number, info: string) => void } = {}) {
    this.canvas = canvas;
    this.project = project;
    this.bonds = bonds;
    this.cb = cb;
    this.off = document.createElement('canvas');
    const first = this.project.elevations.flatMap((e) => e.walls)[0];
    this.targetWallId = first.id;
    this.rebuildFields();
    this.attach();
  }

  private rebuildFields() {
    this.fields.clear();
    for (const w of this.project.elevations.flatMap((e) => e.walls)) {
      this.fields.set(w.id, new CpuHeightField(this.project, w.id, this.bonds[w.id].bricks));
    }
  }

  focusOnWall(wallId: string) {
    const w = this.wallById(wallId);
    if (!w) return;
    this.targetWallId = wallId;
    this.target = [w.length / 2, w.height / 2];
    this.distance = Math.max(w.length, w.height) * 0.95;
    this.yaw = 0;
  }

  setNearHalfMeter(x: number, y: number) {
    this.target = [x, y];
    this.distance = 500;
    this.yaw = 0;
  }

  refreshWeathering(wallId: string) {
    this.fields.set(wallId, new CpuHeightField(this.project, wallId, this.bonds[wallId].bricks));
  }

  rebuildWalls() {
    this.rebuildFields();
  }

  private wallById(id: string): WallSpec | undefined {
    return this.project.elevations.flatMap((e) => e.walls).find((w) => w.id === id);
  }

  private attach() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointerup', (e) => { this.dragging = false; c.releasePointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.yaw = Math.max(-1.2, Math.min(1.2, this.yaw + dx * 0.004));
      // 平移目标(按当前缩放换算)
      const s = this.currentScale();
      this.target = [
        Math.max(0, this.target[0] - dx / s),
        Math.max(0, this.target[1] + dy / s),
      ];
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = Math.max(350, Math.min(40000, this.distance * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
  }

  /** 像素/mm: 距离越近越大。以 500mm 贴墙时约 1.4 px/mm 为基准 */
  private currentScale(): number {
    const H = this.canvas.clientHeight || 800;
    return (H * 0.82) / this.distance;
  }

  start() {
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.render();
      const now = performance.now();
      const dt = (now - this.lastT) / 1000;
      this.lastT = now;
      this.fpsAcc += dt; this.fpsFrames++;
      if (this.fpsAcc >= 0.5) {
        this.cb.onFps?.(this.fpsFrames / this.fpsAcc, '软件回退(Canvas2D) · 高度场逐像素');
        this.fpsAcc = 0; this.fpsFrames = 0;
      }
    };
    loop();
  }

  private render() {
    const ctx = this.canvas.getContext('2d')!;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    ctx.fillStyle = '#17140f';
    ctx.fillRect(0, 0, W, H);

    const wall = this.wallById(this.targetWallId);
    if (!wall) return;
    const field = this.fields.get(wall.id);
    if (!field) return;

    const scale = this.currentScale();
    // 视野覆盖的墙面 mm 范围
    const viewWmm = W / scale, viewHmm = H / scale;
    const x0 = Math.max(0, this.target[0] - viewWmm / 2);
    const x1 = Math.min(wall.length, x0 + viewWmm);
    const y1 = Math.min(wall.height, this.target[1] + viewHmm / 2);
    const y0 = Math.max(0, y1 - viewHmm);
    const bw = Math.max(2, Math.round((x1 - x0) * scale));
    const bh = Math.max(2, Math.round((y1 - y0) * scale));

    // 限制总像素量保帧率(软件回退仅作无 GPU 环境演示)
    const maxPx = 480 * 320;
    const ds = Math.max(1, Math.sqrt((bw * bh) / maxPx));
    const rw = Math.max(2, Math.round(bw / ds)), rh = Math.max(2, Math.round(bh / ds));
    const img = ctx.createImageData(rw, rh);
    const data = img.data;
    const mmPxX = (x1 - x0) / rw, mmPxY = (y1 - y0) / rh;
    const oldC = [124, 56, 40], newC = [182, 92, 62], mortarC = [88, 80, 72];
    // 先算高度网格, 再用网格差分求法线(每像素仅 1 次高度场采样)
    const eps = Math.max(1.5, mmPxX, mmPxY);
    const hGrid = new Float32Array(rw * rh);
    const mortGrid = new Uint8Array(rw * rh);
    const newGrid = new Uint8Array(rw * rh);
    for (let py = 0; py < rh; py++) {
      const ly = y1 - (py + 0.5) * mmPxY;
      for (let pxx = 0; pxx < rw; pxx++) {
        const lx = x0 + (pxx + 0.5) * mmPxX;
        const s = field.sample(lx, ly);
        const i = py * rw + pxx;
        hGrid[i] = s.h;
        mortGrid[i] = s.isMortar ? 1 : 0;
        newGrid[i] = s.isNew ? 1 : 0;
      }
    }
    for (let py = 0; py < rh; py++) {
      for (let pxx = 0; pxx < rw; pxx++) {
        const i = py * rw + pxx;
        const hL = hGrid[Math.max(0, pxx - 1) + py * rw];
        const hR = hGrid[Math.min(rw - 1, pxx + 1) + py * rw];
        const hD = hGrid[pxx + Math.max(0, py - 1) * rw];
        const hU = hGrid[pxx + Math.min(rh - 1, py + 1) * rw];
        const diff = Math.max(0.3, Math.min(1, 0.62 + (hL - hR) * 0.05 + (hD - hU) * 0.05));
        let base = newGrid[i] ? newC : oldC;
        let shade = diff;
        if (mortGrid[i]) { base = mortarC; shade = 0.85; }
        const idx = i * 4;
        data[idx] = base[0] * shade;
        data[idx + 1] = base[1] * shade;
        data[idx + 2] = base[2] * shade;
        data[idx + 3] = 255;
      }
    }
    void eps;
    if (this.off.width < rw) this.off.width = rw;
    if (this.off.height < rh) this.off.height = rh;
    this.off.getContext('2d')!.putImageData(img, 0, 0, 0, 0, rw, rh);

    // 屏幕位置: 目标点居中
    const screenCX = W / 2, screenCY = H / 2;
    const left = screenCX + (x0 - this.target[0]) * scale;
    const top = screenCY + (this.target[1] - y1) * scale;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if (Math.abs(this.yaw) > 0.01) {
      ctx.translate(screenCX, screenCY);
      ctx.transform(Math.cos(this.yaw), Math.sin(this.yaw) * 0.0, -Math.sin(this.yaw), Math.cos(this.yaw), 0, 0);
      ctx.translate(-screenCX, -screenCY);
    }
    ctx.drawImage(this.off, 0, 0, rw, rh, left, top, bw, bh);
    ctx.restore();

    // 信息标注
    ctx.fillStyle = 'rgba(217,160,91,0.9)';
    ctx.font = '12px sans-serif';
    ctx.fillText(`${wall.name} · 视宽 ${(viewWmm / 1000).toFixed(2)}m · 距墙 ${(this.distance / 1000).toFixed(2)}m`, 14, H - 14);
  }

  pickWall(clientX: number, clientY: number): { wallId: string; x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.currentScale();
    const lx = this.target[0] + (clientX - rect.left - rect.width / 2) / scale;
    const ly = this.target[1] - (clientY - rect.top - rect.height / 2) / scale;
    const wall = this.wallById(this.targetWallId)!;
    return { wallId: wall.id, x: Math.max(0, Math.min(wall.length, lx)), y: Math.max(0, Math.min(wall.height, ly)) };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
  }
}
