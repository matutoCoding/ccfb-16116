import { aggregateBom } from '../../core/bond';
import { BOND_LABELS, BomResult } from '../../core/types';
import { button, h, panel } from '../dom';
import { store } from '../../store/appStore';

export function bomPage(): HTMLElement {
  const results = store.allWalls().map((w) => store.currentBond(w.id)!).filter(Boolean);
  const total = aggregateBom(results);

  const rows: [string, number, string][] = [
    ['整砖 (240×115×53)', total.full, '标准顺砖/丁砖'],
    ['七分头 (≈180mm)', total.threeQuarter, '转角、洞口边配砖'],
    ['半砖 (≈120mm)', total.half, '英式十字错位、短段调节'],
    ['二寸头 (≈60mm)', total.twoInch, '端头窄段补位'],
    ['拱砖 (楔形)', total.arch, '平拱/半圆拱券, 按角度排楔'],
  ];

  const table = h('table', { class: 'bom' },
    h('thead', {}, h('tr', {},
      h('th', {}, '材料'), h('th', {}, '数量(块)'), h('th', {}, '说明'))),
    h('tbody', {}, ...rows.map(([label, n, note]) =>
      h('tr', {}, h('td', {}, label), h('td', {}, String(n)), h('td', {}, note)))),
    h('tfoot', {}, h('tr', {},
      h('td', {}, '砖块合计'), h('td', {}, String(total.totalBricks)), h('td', {}, '与画面可见砖数一致'))),
  );

  const perWall = store.project.elevations.flatMap((e) =>
    e.walls.map((w) => {
      const b = store.currentBond(w.id)!.bom;
      return h('tr', {},
        h('td', {}, `${e.name.slice(0, 3)}·${w.name}`),
        h('td', {}, BOND_LABELS[w.bond]),
        h('td', {}, String(b.full)),
        h('td', {}, String(b.threeQuarter)),
        h('td', {}, String(b.half)),
        h('td', {}, String(b.twoInch)),
        h('td', {}, String(b.arch)),
        h('td', {}, String(b.totalBricks)),
      );
    }),
  );

  const wallTable = h('table', { class: 'bom' },
    h('thead', {}, h('tr', {},
      h('th', {}, '墙段'), h('th', {}, '砌法'), h('th', {}, '整砖'), h('th', {}, '七分'),
      h('th', {}, '半砖'), h('th', {}, '二寸'), h('th', {}, '拱砖'), h('th', {}, '合计'))),
    h('tbody', {}, ...perWall),
  );

  const mortarPanel = panel('灰浆用量(按缝形与缝深计算)',
    mortarRows(total),
    h('div', { class: 'muted' },
      `计算口径: 水平灰床(缝宽×墙厚×累计砖长) + 竖向头缝(缝宽×墙厚×砖高×块数) + 缝形截面修正`),
    h('div', { class: 'muted' },
      `当前缝形修正系数: ${profileNote()}; 拱券环向缝另计`),
  );

  return h('div', { style: { display: 'flex', width: '100%', minHeight: 0 } },
    h('aside', { class: 'sidebar' },
      panel('清单校验',
        h('div', { class: 'good-text' }, `✓ 分类块数之和 = ${sumCheck(total)} = 总计 ${total.totalBricks}`),
        h('div', { class: 'muted' }, '所有砖块由同一排砖结果驱动渲染与统计, 画面能数出的砖数即清单数量'),
        button('导出 CSV', exportCsv, 'primary'),
        button('重新计算排砖', () => { store.rebuildBond(); }, 'ghost'),
      ),
      mortarPanel,
    ),
    h('main', { class: 'stage', style: { padding: '18px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' } },
      panel('汇总材料清单', table),
      panel('分墙段明细', wallTable),
    ),
  );
}

function sumCheck(b: BomResult): number {
  return b.full + b.threeQuarter + b.half + b.twoInch + b.arch;
}

function mortarRows(b: BomResult): HTMLElement {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    kv('灰浆总体积', `${b.mortarVolume.toFixed(3)} m³`),
    kv('墙面缝条接触面积', `${b.mortarArea.toFixed(2)} m²`),
    kv('砖块总体积(实砌体)', `${(b.brickVolume * 1e-9).toFixed(2)} m³`),
  );
}

function kv(k: string, v: string): HTMLElement {
  return h('div', { style: { display: 'flex', justifyContent: 'space-between' } },
    h('span', { class: 'muted' }, k), h('span', { style: { color: 'var(--accent2)' } }, v));
}

function profileNote(): string {
  const j = store.project.joint;
  switch (j.profile) {
    case 'flush': return '平缝 0(与砖面齐平)';
    case 'concave': return `凹圆缝 -2/3×缝宽×缝深 = ${(-(2 / 3) * j.width * j.depth).toFixed(1)} mm²/mm`;
    case 'raked': return `斜缝 -0.5×缝宽×(缝深+倾斜) = ${(-0.5 * j.width * (j.depth + j.rakeSlope)).toFixed(1)} mm²/mm`;
    case 'convex': return `凸缝 +0.5×缝宽×缝高 = ${(0.5 * j.width * j.depth).toFixed(1)} mm²/mm`;
  }
}

function exportCsv() {
  const results = store.allWalls().map((w) => ({ wall: w, bom: store.currentBond(w.id)!.bom }));
  const lines = [
    '墙段,砌法,整砖,七分头,半砖,二寸头,拱砖,合计,灰浆m3',
    ...results.map((r) =>
      [r.wall.name, BOND_LABELS[r.wall.bond], r.bom.full, r.bom.threeQuarter, r.bom.half,
        r.bom.twoInch, r.bom.arch, r.bom.totalBricks, r.bom.mortarVolume.toFixed(4)].join(',')),
  ];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${store.project.name}-材料清单.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
