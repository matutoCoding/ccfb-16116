// CPU 侧高度场 —— 与 WGSL heightField() 严格同构, 用于任意位置剖缝测量(验收用)
import { BrickInstance, JointSettings, Project } from './types';
import { hashU32 } from './rng';

export interface HeightSample {
  /** 墙面法向高度, mm。砖面≈0, 缝凹入为负 */
  h: number;
  brickId: number;
  isMortar: boolean;
  isNew: boolean;
}

interface FlatBrick {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  rng: number;
  id: number;
  isNew: boolean;
  batch: number;
}

export class CpuHeightField {
  private bricks: FlatBrick[] = [];
  private byCourse: { y0: number; y1: number; ids: number[] }[] = [];
  private joint: JointSettings;
  private weatherDepth: number;
  /** 每墙风化/修复 stamp 集合 */
  private stamps: { x: number; y: number; r: number; s: number }[] = [];
  private repairs: { x: number; y: number; r: number }[] = [];

  constructor(project: Project, wallId: string, bricks: BrickInstance[]) {
    this.joint = project.joint;
    this.weatherDepth = project.render.weatheringDepth;
    const w = project.weathering[wallId];
    if (w) {
      this.stamps = w.stamps.map((s) => ({ x: s.x, y: s.y, r: s.r, s: s.strength }));
      this.repairs = w.repairs.map((r) => ({ ...r }));
    }
    bricks.forEach((b, id) => {
      this.bricks.push({
        x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1,
        rng: b.rng, id, isNew: b.isNew, batch: b.batchIndex,
      });
    });
    this.bricks.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    let cur: { y0: number; y1: number; ids: number[] } | null = null;
    for (const b of this.bricks) {
      if (!cur || Math.abs(cur.y0 - b.y0) > 1) {
        cur = { y0: b.y0, y1: b.y1, ids: [] };
        this.byCourse.push(cur);
      }
      cur.ids.push(b.id);
    }
  }

  /** 点到砖矩形最近边的距离(内部为到最近边的距离, 外部同样非负) */
  private edgeDistance(b: FlatBrick, x: number, y: number): number {
    const dx = Math.max(b.x0 - x, 0, x - b.x1);
    const dy = Math.max(b.y0 - y, 0, y - b.y1);
    const outside = Math.hypot(dx, dy);
    if (outside > 0) return outside;
    return Math.min(x - b.x0, b.x1 - x, y - b.y0, b.y1 - y);
  }

  /** 缝形截面解析值, t∈[0,1]: 0=砖边 1=缝中心。与 WGSL jointProfile 同构 */
  jointProfile(t: number): number {
    const j = this.joint;
    const d = j.depth;
    switch (j.profile) {
      case 'flush': return 0;
      case 'concave': {
        // t=0 砖边(u²=1)→0; t=1 缝中心(u=0)→-d
        const u = 1 - t;
        return -d * (1 - u * u);
      }
      case 'raked':
        // 上口(t=1 一侧)压得深: 线性倾斜 + 浅弧
        return -d * (0.55 + 0.45 * t) - j.rakeSlope * t;
      case 'convex': {
        const u = 1 - t;
        return d * (1 - u * u);
      }
    }
  }

  private weatherAt(x: number, y: number): { w: number; repaired: boolean } {
    let w = 0;
    for (const s of this.stamps) {
      const dx = x - s.x, dy = y - s.y;
      const q = Math.sqrt(dx * dx + dy * dy) / s.r;
      if (q < 1) w = Math.max(w, s.s * (1 - q * q));
    }
    let repaired = false;
    for (const r of this.repairs) {
      const dx = x - r.x, dy = y - r.y;
      if (Math.sqrt(dx * dx + dy * dy) < r.r) { repaired = true; break; }
    }
    if (repaired) w *= 0.15; // 补砖恢复 85%
    return { w, repaired };
  }

  sample(x: number, y: number): HeightSample {
    const jw = this.joint.width;
    const found = this.findNearestBrick(x, y);
    if (!found) {
      return { h: -4, brickId: -1, isMortar: true, isNew: false };
    }
    const { b, edgeDist } = found;
    const brickH = this.brickHeight(b, x, y);
    if (edgeDist >= jw / 2) {
      return { h: brickH, brickId: b.id, isMortar: false, isNew: b.isNew };
    }
    // t: 0=砖面(edgeDist=jw/2), 1=缝中线(edgeDist=0)
    const t = THREE.clamp(1 - edgeDist / (jw / 2), 0, 1);
    // 缝形为主, 砖面起伏按 (1-t)² 衰减 → 缝中心严格等于设定缝深/缝高
    const h = this.jointProfile(t) + brickH * (1 - t) * (1 - t);
    return { h, brickId: b.id, isMortar: t > 0.5, isNew: b.isNew };
  }

  /**
   * 找最近砖: 先按 y 定位候选皮(当前皮+上下相邻皮, 覆盖水平灰缝),
   * 各皮内二分/最近邻, 再取边距最小者。缝中心到上下砖边距相等, 归属稳定。
   */
  private findNearestBrick(x: number, y: number): { b: FlatBrick; edgeDist: number } | null {
    if (!this.byCourse.length) return null;
    let row = 0;
    for (let i = 0; i < this.byCourse.length; i++) {
      const c = this.byCourse[i];
      if (y <= c.y1) { row = i; break; }
      row = i;
    }
    const candidates: number[] = [];
    for (const r of [row - 1, row, row + 1]) {
      if (r >= 0 && r < this.byCourse.length) candidates.push(r);
    }
    let best: { b: FlatBrick; edgeDist: number } | null = null;
    for (const r of candidates) {
      const pick = this.nearestInCourse(r, x, y);
      if (pick && (!best || pick.edgeDist < best.edgeDist)) best = pick;
    }
    return best;
  }

  private nearestInCourse(row: number, x: number, y: number): { b: FlatBrick; edgeDist: number } | null {
    const ids = this.byCourse[row].ids;
    if (!ids.length) return null;
    let lo = 0, hi = ids.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const b = this.bricks[ids[mid]];
      if (x < b.x0) hi = mid - 1;
      else if (x > b.x1) lo = mid + 1;
      else return { b, edgeDist: this.edgeDistance(b, x, y) };
    }
    const cand: FlatBrick[] = [];
    if (lo < ids.length) cand.push(this.bricks[ids[lo]]);
    if (hi >= 0) cand.push(this.bricks[ids[hi]]);
    let best = cand[0];
    let bestD = this.edgeDistance(best, x, y);
    for (const c of cand.slice(1)) {
      const d = this.edgeDistance(c, x, y);
      if (d < bestD) { best = c; bestD = d; }
    }
    return { b: best, edgeDist: bestD };
  }

  private brickHeight(b: FlatBrick, x: number, y: number): number {
    const seed = hashU32(b.id * 2654435761);
    const n1 = ((seed & 0xffff) / 0xffff) - 0.5;
    const n2 = ((hashU32(seed ^ (x * 1.7 + y * 0.9)) & 0xffff) / 0xffff) - 0.5;
    const w = b.x1 - b.x0, hh = b.y1 - b.y0;
    const edgeSag =
      Math.min(6, (x - b.x0) * 0.05) +
      Math.min(6, (b.x1 - x) * 0.05) +
      Math.min(5, (y - b.y0) * 0.08) +
      Math.min(5, (b.y1 - y) * 0.08);
    let h = n1 * 1.6 + n2 * 0.7 - edgeSag * 0.35;
    void w; void hh;
    const { w: weather } = this.weatherAt(x, y);
    if (weather > 0) h -= weather * this.weatherDepth; // 酥碱: 砖面往里掉一层
    return h;
  }

  /** 沿水平或竖直方向取一条剖面, 步长 1mm */
  profileLine(axis: 'h' | 'v', fixed: number, from: number, to: number): { t: number; h: number; mortar: boolean }[] {
    const out: { t: number; h: number; mortar: boolean }[] = [];
    const step = to >= from ? 1 : -1;
    for (let t = from; step > 0 ? t <= to : t >= to; t += step) {
      const s = axis === 'h' ? this.sample(t, fixed) : this.sample(fixed, t);
      out.push({ t, h: s.h, mortar: s.isMortar });
    }
    return out;
  }
}

// 避免再引一个工具文件造成循环依赖
const THREE = { clamp: (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v)) };
