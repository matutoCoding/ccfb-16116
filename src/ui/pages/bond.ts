import { BOND_LABELS, BondPattern, WallSpec } from '../../core/types';
import { drawBond, drawElevation, fitStyle, worldToScreen } from '../draw2d';
import { button, h, panel, selectField, toggleField } from '../dom';
import { store } from '../../store/appStore';

export function bondPage(): HTMLElement {
  const project = store.project;
  const wall = pickWall();
  const bond = wall ? store.currentBond(wall.id) : undefined;

  const canvas = h('canvas', {}) as HTMLCanvasElement;
  const wrap = h('div', { class: 'canvas2d-wrap' }, canvas);
  let showStraight = project.render.highlightStraightJoints;
  let showCuts = true;
  let zoomRegion: { x0: number; y0: number; x1: number; y1: number } | null = null;

  requestAnimationFrame(() => render());

  function render() {
    if (!wall || !bond) return;
    const W = Math.max(700, wrap.clientWidth - 8);
    const H = Math.max(500, wrap.clientHeight - 8);
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#17140f';
    ctx.fillRect(0, 0, W, H);
    const region = zoomRegion ?? { x0: 0, y0: 0, x1: wall.length, y1: wall.height };
    const style = fitStyle(region.x1 - region.x0, region.y1 - region.y0, W, H, 60);
    style.ox -= region.x0 * style.scale;
    style.oy += region.y0 * style.scale;
    drawBond(ctx, style, { ...wall, x: 0, y: 0 }, shiftBond(bond, region), {
      showNew: true, showStraight, showCuts,
    });
    // 比例尺
    const barMm = niceBar((region.x1 - region.x0) / 6);
    const barPx = barMm * style.scale;
    ctx.strokeStyle = '#d9a05b'; ctx.fillStyle = '#d9a05b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(20, H - 24); ctx.lineTo(20 + barPx, H - 24); ctx.stroke();
    ctx.font = '11px sans-serif';
    ctx.fillText(`${barMm} mm`, 24, H - 30);
    // 图例
    ctx.fillStyle = '#a89c8b';
    ctx.fillText('■ 旧砖', 20, 24);
    ctx.fillStyle = '#b45a3c';
    ctx.fillText('■ 新砖(按批次混排)', 70, 24);
    ctx.fillStyle = '#e0b36b';
    ctx.fillText('▢ 配砖(七分头/二寸头)', 190, 24);
    if (showStraight) {
      ctx.fillStyle = '#ff5d5d';
      ctx.fillText('┇ 通缝位置', 340, 24);
    }
  }

  canvas.addEventListener('dblclick', (e) => {
    if (!wall) return;
    const rect = canvas.getBoundingClientRect();
    const region = zoomRegion ?? { x0: 0, y0: 0, x1: wall.length, y1: wall.height };
    const style = fitStyle(region.x1 - region.x0, region.y1 - region.y0, canvas.width, canvas.height, 60);
    style.ox -= region.x0 * style.scale;
    style.oy += region.y0 * style.scale;
    const [wx, wy] = screenToWorld(style, e.clientX - rect.left, e.clientY - rect.top);
    const span = Math.max(wall.length, wall.height) / 8;
    zoomRegion = { x0: wx - span, y0: wy - span, x1: wx + span, y1: wy + span };
    render();
  });

  const cutCounts = bond ? {
    threeQuarter: bond.bom.threeQuarter,
    twoInch: bond.bom.twoInch,
    half: bond.bom.half,
    arch: bond.bom.arch,
  } : null;

  const side = h('aside', { class: 'sidebar' },
    panel('墙段选择', wallSelector()),
    wall ? panel('砌法',
      selectField('砌法', wall.bond,
        (Object.keys(BOND_LABELS) as BondPattern[]).map((b): [BondPattern, string] => [b, BOND_LABELS[b]]),
        (v) => store.update((p) => {
          const w2 = findWall(p, wall.id);
          if (w2) w2.bond = v;
        })),
      h('div', { class: 'muted' }, bondDescription(wall.bond)),
    ) : h('div'),
    panel('图纸标注',
      toggleField('通缝位置', showStraight, (v) => { showStraight = v; render(); }),
      toggleField('配砖描边', showCuts, (v) => { showCuts = v; render(); }),
      button('复位视图', () => { zoomRegion = null; render(); }),
      h('div', { class: 'muted' }, '双击图纸可放大局部, 观察端头配砖与上下皮错缝'),
    ),
    bond && cutCounts ? panel('本墙配砖统计',
      statRow('整砖', bond.bom.full),
      statRow('七分头', cutCounts.threeQuarter),
      statRow('半砖', cutCounts.half),
      statRow('二寸头', cutCounts.twoInch),
      statRow('拱砖(楔形)', cutCounts.arch),
      h('hr', { style: { border: '0', borderTop: '1px solid var(--line)' } }),
      statRow('合计', bond.bom.totalBricks, true),
      h('div', { class: bond.straightJoints.length ? 'warn-text' : 'good-text' },
        bond.straightJoints.length
          ? `检出 ${bond.straightJoints.length} 处通缝(已在图中红虚线标出)`
          : '未检出上下皮通缝'),
    ) : h('div'),
  );

  return h('div', { style: { display: 'flex', width: '100%', minHeight: 0 } }, side, h('main', { class: 'stage' }, wrap));
}

function shiftBond(bond: NonNullable<ReturnType<typeof store.currentBond>>, region: { x0: number; y0: number }) {
  // drawBond 内部用 wall.x 偏移; 这里直接返回原 bond, region 通过 style 平移实现
  void region;
  return bond;
}

function screenToWorld(style: { scale: number; ox: number; oy: number }, sx: number, sy: number): [number, number] {
  return [(sx - style.ox) / style.scale, (style.oy - sy) / style.scale];
}

function niceBar(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

function statRow(label: string, n: number, bold = false): HTMLElement {
  return h('div', { style: { display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 700 : 400 } },
    h('span', { class: 'muted' }, label), h('span', {}, `${n} 块`));
}

function bondDescription(b: BondPattern): string {
  switch (b) {
    case 'stretcher-header': return '一皮顺砖一皮丁砖交替, 转角丁砖层自动配七分头, 整体性最好, 老厂房最常见。';
    case 'flemish': return '同一皮内顺丁相间, 墙面纹理活泼; 梅花丁对配砖尺寸要求高, 端头七分头起步。';
    case 'three-stretcher': return '三皮顺砖夹一皮丁砖, 施工快、通长裂缝风险略高, 靠丁砖层拉结。';
    case 'english-cross': return '英式十字: 顺砖层半砖错位, 竖缝形成十字图案, 外观工整, 端头半砖/七分头调节。';
  }
}

function wallSelector(): HTMLElement {
  const cur = store.selectedWallId;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    ...store.project.elevations.flatMap((e) =>
      e.walls.map((w) => h('div', {
        class: `list-item ${w.id === cur ? 'selected' : ''}`,
        onclick: () => store.selectWall(w.id),
      }, h('span', { class: 'nm' }, w.name), h('span', { class: 'badge' }, BOND_LABELS[w.bond]))),
    ),
  );
}

function pickWall(): WallSpec | undefined {
  const all = store.allWalls();
  return all.find((w) => w.id === store.selectedWallId) ?? all[0];
}

function findWall(p: { elevations: { walls: WallSpec[] }[] }, id: string): WallSpec | undefined {
  return p.elevations.flatMap((e) => e.walls).find((w) => w.id === id);
}

void drawElevation; void worldToScreen; void button;
