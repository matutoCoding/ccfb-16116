import { BondResult, ElevationSpec, OpeningSpec, Project, WallSpec } from '../core/types';

export interface DrawStyle {
  scale: number; // px per mm
  ox: number;
  oy: number;
}

export function worldToScreen(style: DrawStyle, x: number, y: number): [number, number] {
  return [style.ox + x * style.scale, style.oy - y * style.scale];
}

export function mmToPx(style: DrawStyle, mm: number): number {
  return mm * style.scale;
}

/** 自适应缩放: 把 (wMm,hMm) 的图装进像素宽高 */
export function fitStyle(wMm: number, hMm: number, pxW: number, pxH: number, pad = 40): DrawStyle {
  const scale = Math.min((pxW - pad * 2) / wMm, (pxH - pad * 2) / hMm);
  return {
    scale,
    ox: (pxW - wMm * scale) / 2,
    oy: (pxH + hMm * scale) / 2,
  };
}

export function drawGrid(ctx: CanvasRenderingContext2D, style: DrawStyle, wMm: number, hMm: number, step = 1000) {
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= wMm; x += step) {
    const [sx] = worldToScreen(style, x, 0);
    ctx.beginPath();
    ctx.moveTo(sx, style.oy);
    ctx.lineTo(sx, style.oy - hMm * style.scale);
    ctx.stroke();
  }
  for (let y = 0; y <= hMm; y += step) {
    const [, sy] = worldToScreen(style, 0, y);
    ctx.beginPath();
    ctx.moveTo(style.ox, sy);
    ctx.lineTo(style.ox + wMm * style.scale, sy);
    ctx.stroke();
  }
}

export function drawAxesAndLevels(
  ctx: CanvasRenderingContext2D,
  style: DrawStyle,
  elev: ElevationSpec,
  hMm: number,
) {
  ctx.fillStyle = '#8fa3b8';
  ctx.strokeStyle = '#5b7186';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  for (const ax of elev.axes) {
    const [sx] = worldToScreen(style, ax.x, 0);
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(sx, style.oy + 16);
    ctx.lineTo(sx, style.oy - hMm * style.scale - 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(sx, style.oy + 22, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(ax.id, sx, style.oy + 26);
  }
  ctx.textAlign = 'left';
  for (const lv of elev.levels) {
    const [, sy] = worldToScreen(style, 0, lv.y);
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(style.ox - 14, sy);
    ctx.lineTo(style.ox + elev.walls.reduce((m, w) => Math.max(m, w.x + w.length), 0) * style.scale + 10, sy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(lv.name, style.ox - 70, sy + 4);
  }
}

export function drawOpening(ctx: CanvasRenderingContext2D, style: DrawStyle, op: OpeningSpec) {
  const [x, yTop] = worldToScreen(style, op.x, op.y + op.height);
  const w = mmToPx(style, op.width);
  const h = mmToPx(style, op.height);
  ctx.fillStyle = 'rgba(12,10,8,0.92)';
  ctx.fillRect(x, yTop, w, h);
  ctx.strokeStyle = '#6b5d4d';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, yTop, w, h);
  if (op.arch !== 'none') {
    ctx.beginPath();
    if (op.arch === 'semicircular') {
      const r = mmToPx(style, op.width / 2);
      ctx.arc(x + w / 2, yTop, r, Math.PI, 0);
    } else {
      const rise = mmToPx(style, op.archRise);
      ctx.moveTo(x, yTop);
      ctx.quadraticCurveTo(x + w / 2, yTop - rise * 1.6, x + w, yTop);
    }
    ctx.strokeStyle = '#c8a06b';
    ctx.stroke();
  }
  if (op.label) {
    ctx.fillStyle = '#a89c8b';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(op.label, x + w / 2, yTop + h - 6);
    ctx.textAlign = 'left';
  }
}

export function drawPilaster(
  ctx: CanvasRenderingContext2D,
  style: DrawStyle,
  p: WallSpec['pilasters'][number],
) {
  const [x, yTop] = worldToScreen(style, p.x, p.height);
  const w = mmToPx(style, p.width);
  ctx.fillStyle = 'rgba(120,80,55,0.28)';
  ctx.fillRect(x, yTop, w, mmToPx(style, p.height));
  ctx.strokeStyle = '#8a6a4f';
  ctx.strokeRect(x, yTop, w, mmToPx(style, p.height));
}

export function drawWallOutline(ctx: CanvasRenderingContext2D, style: DrawStyle, wall: WallSpec) {
  const [x, yTop] = worldToScreen(style, wall.x, wall.height);
  ctx.strokeStyle = '#b8a892';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, yTop, mmToPx(style, wall.length), mmToPx(style, wall.height));
}

/** 排砖图: 按 BondResult 逐块画, 切砖/新砖/通缝分色 */
export function drawBond(
  ctx: CanvasRenderingContext2D,
  style: DrawStyle,
  wall: WallSpec,
  bond: BondResult,
  opts: { showNew?: boolean; showStraight?: boolean; showCuts?: boolean } = {},
) {
  const oldColor = '#7a3526';
  const newColor = '#b45a3c';
  const cutStroke = '#e0b36b';
  for (const b of bond.bricks) {
    const [x, yTop] = worldToScreen(style, wall.x + b.x0, b.y1);
    const w = mmToPx(style, b.x1 - b.x0);
    const h = mmToPx(style, b.y1 - b.y0);
    if (w < 0.4 || h < 0.4) continue;
    ctx.fillStyle = opts.showNew === false ? oldColor : b.isNew ? newColor : oldColor;
    ctx.fillRect(x, yTop, Math.max(0.6, w - 0.5), Math.max(0.6, h - 0.5));
    if (opts.showCuts && b.cut !== 'full') {
      ctx.strokeStyle = cutStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, yTop + 0.5, Math.max(0.6, w - 1), Math.max(0.6, h - 1));
    }
  }
  // 拱砖
  for (const a of bond.archBricks) {
    ctx.beginPath();
    ctx.arc(
      style.ox + (wall.x + a.cx) * style.scale,
      style.oy - a.cy * style.scale,
      (a.rInner + a.rOuter) / 2 * style.scale,
      -a.a1, -a.a0,
    );
    ctx.strokeStyle = '#d9a05b';
    ctx.lineWidth = (a.rOuter - a.rInner) * style.scale;
    ctx.stroke();
  }
  // 通缝
  if (opts.showStraight) {
    ctx.strokeStyle = '#ff5d5d';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    for (const s of bond.straightJoints) {
      const [sx, syTop] = worldToScreen(style, wall.x + s.x, s.y1);
      const syBot = syTop + mmToPx(style, s.y1 - s.y0);
      ctx.beginPath();
      ctx.moveTo(sx, syTop);
      ctx.lineTo(sx, syBot);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

export function drawElevation(
  ctx: CanvasRenderingContext2D,
  project: Project,
  elev: ElevationSpec,
  size: { w: number; h: number },
  bonds?: Record<string, BondResult>,
) {
  const wMm = elev.walls.reduce((m, w) => Math.max(m, w.x + w.length), 0);
  const hMm = elev.walls.reduce((m, w) => Math.max(m, w.y + w.height), 0);
  const style = fitStyle(wMm, hMm, size.w, size.h);
  ctx.clearRect(0, 0, size.w, size.h);
  drawGrid(ctx, style, wMm, hMm);
  drawAxesAndLevels(ctx, style, elev, hMm);
  for (const wall of elev.walls) {
    if (bonds && bonds[wall.id]) {
      drawBond(ctx, style, wall, bonds[wall.id], { showNew: true, showStraight: true, showCuts: true });
    } else {
      const [x, yTop] = worldToScreen(style, wall.x, wall.height);
      ctx.fillStyle = 'rgba(124,58,40,0.35)';
      ctx.fillRect(x, yTop, mmToPx(style, wall.length), mmToPx(style, wall.height));
    }
    for (const p of wall.pilasters) drawPilaster(ctx, style, p);
    for (const op of wall.openings) drawOpening(ctx, style, op);
    drawWallOutline(ctx, style, wall);
  }
  return style;
}
