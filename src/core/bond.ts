import {
  ArchBrick,
  ArchType,
  BlendSettings,
  BomResult,
  BondPattern,
  BondResult,
  BrickCut,
  BrickInstance,
  BrickSpec,
  CourseLayout,
  JointSettings,
  WallSpec,
} from './types';
import { hashU32, mulberry32, pickBatch } from './rng';

interface Piece {
  x0: number;
  x1: number;
  cut: BrickCut;
  orientation: 'stretcher' | 'header';
}

interface Interval {
  x0: number;
  x1: number;
}

const STANDARD_CUTS: { cut: BrickCut; len: (b: BrickSpec) => number }[] = [
  { cut: 'full', len: (b) => b.length },
  { cut: 'three-quarter', len: (b) => b.threeQuarter },
  { cut: 'half', len: (b) => Math.round(b.length / 2) },
  { cut: 'two-inch', len: (b) => b.twoInch },
];

function courseOrientation(pattern: BondPattern, course: number): 'stretcher' | 'header' {
  switch (pattern) {
    case 'stretcher-header':
      return course % 2 === 0 ? 'stretcher' : 'header';
    case 'three-stretcher':
      return course % 4 === 3 ? 'header' : 'stretcher';
    case 'flemish':
      return 'stretcher'; // 梅花丁皮内交替, 由序列生成器处理
    case 'english-cross':
      return 'stretcher';
  }
}

/** 标准切砖候选长度 */
function closerCandidates(brick: BrickSpec): number[] {
  return [brick.threeQuarter, Math.round(brick.length / 2), brick.twoInch];
}

function nearestCut(len: number, brick: BrickSpec): BrickCut {
  let best: BrickCut = 'two-inch';
  let bestD = Infinity;
  for (const c of STANDARD_CUTS) {
    const d = Math.abs(c.len(brick) - len);
    if (d < bestD) {
      bestD = d;
      best = c.cut;
    }
  }
  return best;
}

/**
 * 在区间 [x0,x1] 内按给定砌法铺一皮砖。
 * 策略: 枚举端头配砖(七分头/半砖/二寸头), 选端头残段最接近标准切砖的组合,
 * 微差(<=6mm)均摊到灰缝, 保证清单里只有标准切砖类别。
 */
function fillInterval(
  iv: Interval,
  course: number,
  pattern: BondPattern,
  brick: BrickSpec,
  jw: number,
  cornerStart: boolean,
  cornerEnd: boolean,
): Piece[] {
  const width = iv.x1 - iv.x0;
  if (width < brick.twoInch) return [];

  const pieces: Piece[] = [];
  const orient = courseOrientation(pattern, course);

  if (pattern === 'flemish') {
    return fillFlemish(iv, course, brick, jw, cornerStart);
  }

  const unitLen = orient === 'stretcher' ? brick.length : brick.width;
  const pitch = unitLen + jw;
  const cands = closerCandidates(brick);
  // 英式十字: 偶数皮半砖错位起步; 一顺一丁转角: 七分头起步
  const offsetStart =
    pattern === 'english-cross' && course % 2 === 1
      ? [Math.round(brick.length / 2), brick.threeQuarter, brick.twoInch]
      : cornerStart
        ? cands
        : [0, ...cands];

  let best: { cStart: number; n: number; cEnd: number; score: number } | null = null;
  for (const cStart of offsetStart) {
    // n 块整砖 + 两端配砖, 缝数 = n+1 (两端都有配砖) 或 n (一端零配砖)
    for (let n = 0; n < 200; n++) {
      const joints = (cStart > 0 ? 1 : 0) + n + 1; // 末端至少留配砖位
      const cEnd = width - cStart - n * unitLen - joints * jw;
      if (cEnd < brick.twoInch - 30) {
        if (n === 0) continue;
        break;
      }
      if (cEnd > brick.length + 30) continue;
      const cut = nearestCut(cEnd, brick);
      const stdLen = STANDARD_CUTS.find((c) => c.cut === cut)!.len(brick);
      const score = Math.abs(cEnd - stdLen) + (cStart === 0 ? 0 : 0.5);
      if (!best || score < best.score) best = { cStart, n, cEnd, score };
    }
  }

  if (!best) {
    // 兜底: 整块切到区间宽
    return [
      { x0: iv.x0, x1: iv.x1, cut: nearestCut(width, brick), orientation: orient },
    ];
  }

  let cursor = iv.x0;
  const gap = width - (best.cStart > 0 ? best.cStart + jw : 0) - best.n * unitLen - best.cEnd - (best.n + 1) * jw;
  // gap 为负表示缝需要压缩, 均摊
  const extraJoints = best.n + 1 + (best.cStart > 0 ? 1 : 0);
  const jwAdj = jw + gap / Math.max(1, extraJoints);

  if (best.cStart > 0) {
    pieces.push({ x0: cursor, x1: cursor + best.cStart, cut: nearestCut(best.cStart, brick), orientation: orient });
    cursor += best.cStart + jwAdj;
  }
  for (let i = 0; i < best.n; i++) {
    pieces.push({ x0: cursor, x1: cursor + unitLen, cut: 'full', orientation: orient });
    cursor += unitLen + (i < best.n - 1 || best.cEnd > 0 ? jwAdj : 0);
  }
  if (best.cEnd > 0) {
    if (pieces.length > 0) cursor = iv.x1 - best.cEnd;
    pieces.push({
      x0: cursor,
      x1: iv.x1,
      cut: nearestCut(best.cEnd, brick),
      orientation: orient,
    });
  }
  void cornerEnd;
  return pieces;
}

/** 梅花丁: 皮内顺丁交替, 转角七分头起步 */
function fillFlemish(
  iv: Interval,
  course: number,
  brick: BrickSpec,
  jw: number,
  cornerStart: boolean,
): Piece[] {
  const pieces: Piece[] = [];
  let cursor = iv.x0;
  let first = true;
  // 转角处七分头(顺砌切砖)压角, 随后丁顺交替
  if (cornerStart) {
    pieces.push({ x0: cursor, x1: cursor + brick.threeQuarter, cut: 'three-quarter', orientation: 'stretcher' });
    cursor += brick.threeQuarter + jw;
    first = false;
  }
  let nextHeader = true; // 梅花丁: 丁头在前
  while (cursor < iv.x1 - brick.twoInch) {
    const u = nextHeader ? brick.width : brick.length;
    const remain = iv.x1 - cursor;
    if (remain < u + jw + brick.twoInch - 20) {
      // 残段配砖
      const cut = nearestCut(remain, brick);
      pieces.push({ x0: cursor, x1: iv.x1, cut, orientation: nextHeader ? 'header' : 'stretcher' });
      break;
    }
    pieces.push({ x0: cursor, x1: cursor + u, cut: 'full', orientation: nextHeader ? 'header' : 'stretcher' });
    cursor += u + jw;
    nextHeader = !nextHeader;
    first = false;
  }
  void course;
  void first;
  return pieces;
}

/** 求某皮在洞口/拱券之外的可砌区间 */
function courseIntervals(
  wall: WallSpec,
  y0: number,
  y1: number,
): Interval[] {
  let ivs: Interval[] = [{ x0: 0, x1: wall.length }];
  const yMid = (y0 + y1) / 2;
  for (const op of wall.openings) {
    const rectTop = op.y + op.height;
    const inRect = yMid >= op.y && yMid < rectTop;
    const inArchZone =
      op.arch !== 'none' && yMid >= rectTop && yMid < rectTop + op.archRise + 5;
    if (!inRect && !inArchZone) continue;

    let cutL = op.x;
    let cutR = op.x + op.width;
    if (inArchZone && op.arch === 'semicircular') {
      const cx = op.x + op.width / 2;
      const cy = rectTop;
      const r = op.width / 2;
      const dy = yMid - cy;
      if (dy >= r) continue;
      const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
      cutL = cx - dx;
      cutR = cx + dx;
    }
    const next: Interval[] = [];
    for (const iv of ivs) {
      if (cutR <= iv.x0 || cutL >= iv.x1) {
        next.push(iv);
      } else {
        if (cutL - iv.x0 >= brick_min_len(wall)) next.push({ x0: iv.x0, x1: cutL });
        if (iv.x1 - cutR >= brick_min_len(wall)) next.push({ x0: cutR, x1: iv.x1 });
      }
    }
    ivs = next;
  }
  return ivs;
}

function brick_min_len(wall: WallSpec): number {
  void wall;
  return 40;
}

/** 生成拱券楔形砖(极坐标表示, 平拱=大半径小扇角) */
function buildArches(wall: WallSpec, brick: BrickSpec, jw: number): ArchBrick[] {
  const out: ArchBrick[] = [];
  let idx = 0;
  for (const op of wall.openings) {
    if (op.arch === 'none') continue;
    const midX = op.x + op.width / 2;
    const springY = op.y + op.height;
    const ring = brick.length; // 拱环厚一砖(丁砌径向)
    const aj = op.archJoint || jw;

    if (op.arch === 'semicircular') {
      const rInner = op.width / 2;
      const rOuter = rInner + ring;
      const rMid = (rInner + rOuter) / 2;
      const n = Math.max(5, Math.round((Math.PI * rMid) / (brick.height + aj)));
      const pitch = Math.PI / n;
      const gap = aj / rMid;
      for (let i = 0; i < n; i++) {
        const a0 = i * pitch + gap / 2;
        const a1 = (i + 1) * pitch - gap / 2;
        out.push({
          wallId: wall.id,
          openingId: op.id,
          type: 'semicircular',
          cx: midX,
          cy: springY,
          rInner,
          rOuter,
          a0,
          a1,
          rng: 0,
          isNew: false,
          batchIndex: 0,
        });
        idx++;
      }
    } else {
      // 平拱: 拱脚在洞口两角, 扇心在拱脚线以下, 拱高=archRise
      const rise = Math.max(12, op.archRise);
      const halfSpan = op.width / 2;
      const R = (halfSpan * halfSpan) / rise; // 几何: R²=(R-rise)²+halfSpan²
      const rOuter = R;
      const rInner = R - rise;
      const halfAngle = Math.atan2(halfSpan, R - rise);
      const rMid = (rInner + rOuter) / 2;
      const n = Math.max(3, Math.round((2 * halfAngle * rMid) / (brick.height + aj)));
      const pitch = (2 * halfAngle) / n;
      const gap = aj / rMid;
      for (let i = 0; i < n; i++) {
        const a0 = Math.PI / 2 - halfAngle + i * pitch + gap / 2;
        const a1 = Math.PI / 2 - halfAngle + (i + 1) * pitch - gap / 2;
        out.push({
          wallId: wall.id,
          openingId: op.id,
          type: 'flat',
          cx: midX,
          cy: springY - (R - rise),
          rInner,
          rOuter,
          a0,
          a1,
          rng: 0,
          isNew: false,
          batchIndex: 0,
        });
        idx++;
      }
    }
  }
  return out;
}

/** 单墙排砖 */
export function buildWallBond(
  wall: WallSpec,
  brick: BrickSpec,
  joint: JointSettings,
  blend: BlendSettings,
  seedSalt = 0,
): BondResult {
  const jw = joint.width;
  const pitch = brick.height + jw;
  const nCourses = Math.floor((wall.height + jw) / pitch);
  const bricks: BrickInstance[] = [];
  const courses: CourseLayout[] = [];
  const jointXPerCourse: number[][] = [];

  const rng = mulberry32(hashU32(hashU32(wall.id.length * 7919 + seedSalt) ^ blend.seed));
  const oldWeights = blend.oldBatches.map((b) => b.weight);
  const newWeights = blend.newBatches.map((b) => b.weight);

  for (let c = 0; c < nCourses; c++) {
    const y0 = c * pitch;
    const y1 = y0 + brick.height;
    const ivs = courseIntervals(wall, y0, y1);
    const layout: CourseLayout = {
      index: c,
      y0,
      y1,
      orientation: courseOrientation(wall.bond, c),
      segments: [],
    };
    const jxs: number[] = [];
    for (const iv of ivs) {
      const pieces = fillInterval(
        iv,
        c,
        wall.bond,
        brick,
        jw,
        wall.cornerStart,
        wall.cornerEnd,
      );
      for (const p of pieces) {
        const r = rng();
        const isNew = r < blend.newRatio;
        const batches = isNew ? blend.newBatches : blend.oldBatches;
        const weights = isNew ? newWeights : oldWeights;
        const batchIndex = batches.length ? pickBatch(weights, rng()) : 0;
        bricks.push({
          x0: p.x0,
          y0,
          x1: p.x1,
          y1,
          course: c,
          cut: p.cut,
          orientation: p.orientation,
          wallId: wall.id,
          rng: r,
          isNew,
          batchIndex,
        });
        layout.segments.push({ x0: p.x0, x1: p.x1, cut: p.cut });
      }
      for (let i = 1; i < pieces.length; i++) jxs.push((pieces[i - 1].x1 + pieces[i].x0) / 2);
    }
    courses.push(layout);
    jointXPerCourse.push(jxs);
  }

  // 通缝检测: 相邻皮竖缝位置重合(容差 = 半缝宽), 连续重合皮数>=2 即标出
  const straightJoints: BondResult['straightJoints'] = [];
  for (let c = 0; c < nCourses - 1; c++) {
    for (const x of jointXPerCourse[c]) {
      const match = jointXPerCourse[c + 1].some((x2) => Math.abs(x2 - x) <= Math.max(6, jw * 0.6));
      if (match) {
        const existing = straightJoints.find(
          (s) => Math.abs(s.x - x) < jw && s.y1 === c * pitch,
        );
        if (existing) {
          existing.y1 = (c + 2) * pitch;
          existing.courses += 1;
        } else {
          straightJoints.push({ x, y0: c * pitch, y1: (c + 2) * pitch, courses: 2 });
        }
      }
    }
  }

  const archBricks = buildArches(wall, brick, jw);
  for (const a of archBricks) {
    const r = rng();
    a.rng = r;
    a.isNew = r < blend.newRatio;
    const batches = a.isNew ? blend.newBatches : blend.oldBatches;
    const weights = a.isNew ? newWeights : oldWeights;
    a.batchIndex = batches.length ? pickBatch(weights, rng()) : 0;
  }

  const bom = tallyBom(bricks, archBricks, wall, brick, joint, courses);
  return { bricks, archBricks, straightJoints, courses, bom };
}

export function buildProjectBond(
  walls: WallSpec[],
  brick: BrickSpec,
  joint: JointSettings,
  blend: BlendSettings,
): Record<string, BondResult> {
  const out: Record<string, BondResult> = {};
  walls.forEach((w, i) => {
    out[w.id] = buildWallBond(w, brick, joint, blend, i * 131 + 17);
  });
  return out;
}

export function aggregateBom(results: BondResult[]): BomResult {
  const sum: BomResult = {
    full: 0,
    threeQuarter: 0,
    half: 0,
    twoInch: 0,
    arch: 0,
    mortarVolume: 0,
    mortarArea: 0,
    brickVolume: 0,
    totalBricks: 0,
  };
  for (const r of results) {
    sum.full += r.bom.full;
    sum.threeQuarter += r.bom.threeQuarter;
    sum.half += r.bom.half;
    sum.twoInch += r.bom.twoInch;
    sum.arch += r.bom.arch;
    sum.mortarVolume += r.bom.mortarVolume;
    sum.mortarArea += r.bom.mortarArea;
    sum.brickVolume += r.bom.brickVolume;
    sum.totalBricks += r.bom.totalBricks;
  }
  return sum;
}

/**
 * 清单统计 + 灰浆用量。
 * 灰浆体积 = 水平灰床(缝宽×墙厚×累计长) + 竖向头缝(缝宽×墙厚×砖高累计)
 *          + 缝形截面修正(凹缝扣减/凸缝增加, 作用于墙面缝条)
 */
function tallyBom(
  bricks: BrickInstance[],
  archBricks: ArchBrick[],
  wall: WallSpec,
  brick: BrickSpec,
  joint: JointSettings,
  courses: CourseLayout[],
): BomResult {
  const bom: BomResult = {
    full: 0,
    threeQuarter: 0,
    half: 0,
    twoInch: 0,
    arch: archBricks.length,
    mortarVolume: 0,
    mortarArea: 0,
    brickVolume: 0,
    totalBricks: 0,
  };
  for (const b of bricks) {
    if (b.cut === 'full') bom.full++;
    else if (b.cut === 'three-quarter') bom.threeQuarter++;
    else if (b.cut === 'half') bom.half++;
    else if (b.cut === 'two-inch') bom.twoInch++;
    const faceLen = b.x1 - b.x0;
    bom.brickVolume += faceLen * (b.y1 - b.y0) * wall.thickness;
  }
  bom.totalBricks =
    bom.full + bom.threeQuarter + bom.half + bom.twoInch + bom.arch;

  // 水平灰床: 每皮之间有砖覆盖的长度
  let bedLen = 0;
  let headLen = 0;
  for (const c of courses) {
    for (const seg of c.segments) bedLen += seg.x1 - seg.x0;
  }
  // 头缝: 每块砖一条竖缝, 长度按砖高
  headLen = bricks.length * brick.height;
  const jw = joint.width;
  const bedVol = bedLen * jw * wall.thickness;
  const headVol = headLen * jw * wall.thickness;

  // 缝形在墙表面的截面修正(单位 mm² 折算成 mm³ 条带)
  const faceAdj = faceProfileAdjust(joint); // 每 mm 缝长的面积修正 mm²
  const profileVol = (bedLen + headLen) * faceAdj;

  // 拱券灰浆(环向缝近似)
  let archMortar = 0;
  for (const a of archBricks) {
    const rMid = (a.rInner + a.rOuter) / 2;
    archMortar += (a.a1 - a.a0) * 0 + joint.width * wall.thickness * rMid * (a.a1 - a.a0) * 0.08;
  }

  bom.mortarVolume = (bedVol + headVol + profileVol + archMortar) * 1e-9;
  bom.mortarArea = (bedLen + headLen) * 1e-6;
  return bom;
}

/** 缝形截面相对平缝的面积修正(mm², 每 mm 缝长)。凹为负, 凸为正 */
function faceProfileAdjust(joint: JointSettings): number {
  const w = joint.width;
  const d = joint.depth;
  switch (joint.profile) {
    case 'flush':
      return 0;
    case 'concave':
      // 凹圆缝近似弓形: 扣减约 2/3 × 宽 × 深
      return -(2 / 3) * w * d;
    case 'raked':
      // 斜缝(上口刮深): 三角形近似
      return -0.5 * w * (d + joint.rakeSlope);
    case 'convex':
      // 凸缝半圆鼓出
      return 0.5 * w * d;
  }
}

export function archLabel(t: ArchType): string {
  return t === 'flat' ? '平拱' : t === 'semicircular' ? '半圆拱' : '无拱';
}
