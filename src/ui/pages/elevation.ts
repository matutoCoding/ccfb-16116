import { ArchType, ElevationSpec, OpeningSpec, WallSpec } from '../../core/types';
import { drawElevation } from '../draw2d';
import { button, h, numberField, panel, selectField } from '../dom';
import { store } from '../../store/appStore';

function uid(p: string) { return `${p}-${Math.random().toString(36).slice(2, 8)}`; }

export function elevationPage(): HTMLElement {
  const project = store.project;
  const elevId = store.selectedElevationId ?? project.elevations[0].id;
  const elev = project.elevations.find((e) => e.id === elevId) ?? project.elevations[0];
  const wallId = store.selectedWallId ?? elev.walls[0]?.id;
  const wall = elev.walls.find((w) => w.id === wallId) ?? elev.walls[0];

  const canvas = h('canvas', {}) as HTMLCanvasElement;
  const wrap = h('div', { class: 'canvas2d-wrap' }, canvas);
  requestAnimationFrame(() => {
    const size = { w: Math.max(640, wrap.clientWidth - 4), h: Math.max(480, wrap.clientHeight - 4) };
    canvas.width = size.w; canvas.height = size.h;
    const ctx = canvas.getContext('2d')!;
    drawElevation(ctx, project, elev, size, store.bondCache);
  });

  const wallList = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    ...project.elevations.flatMap((e) => [
      h('div', { class: 'section-title' }, e.name),
      ...e.walls.map((w) =>
        h('div', {
          class: `list-item ${w.id === wall?.id ? 'selected' : ''}`,
          onclick: () => store.selectWall(w.id),
        }, h('span', { class: 'nm' }, w.name), h('span', { class: 'muted' }, `${(w.length / 1000).toFixed(1)}m`)),
      ),
    ]),
  );

  const wallEditor = wall ? panel('墙段参数',
    numberField('长度 mm', wall.length, (v) => store.update((p) => { findWall(p, wall.id)!.length = v; }), { min: 500, max: 30000 }),
    numberField('高度 mm', wall.height, (v) => store.update((p) => { findWall(p, wall.id)!.height = v; }), { min: 1000, max: 20000 }),
    numberField('墙厚 mm', wall.thickness, (v) => store.update((p) => { findWall(p, wall.id)!.thickness = v; }), { min: 115, max: 490, step: 5 }),
    numberField('朝向角 °', wall.angle, (v) => store.update((p) => { findWall(p, wall.id)!.angle = v; }), { min: 0, max: 359, step: 90 }),
    h('label', { class: 'field toggle' }, h('span', {}, '转角端头'),
      h('input', { type: 'checkbox', checked: wall.cornerStart, onchange: (e: Event) => store.update((p) => { findWall(p, wall.id)!.cornerStart = (e.target as HTMLInputElement).checked; }) })),
    button('删除该墙段', () => {
      store.update((p) => {
        const e2 = p.elevations.find((x) => x.walls.some((w2) => w2.id === wall.id))!;
        e2.walls = e2.walls.filter((w2) => w2.id !== wall.id);
      });
    }, 'danger'),
  ) : h('div');

  const opEditor = wall ? panel('门窗洞口',
    ...wall.openings.map((op) => openingCard(wall, op)),
    button('+ 添加洞口', () => store.update((p) => {
      const w2 = findWall(p, wall.id)!;
      w2.openings.push({ id: uid('op'), x: 1000, y: 1000, width: 1200, height: 1500, arch: 'flat', archRise: 15, archJoint: 8 });
    }), 'primary'),
  ) : h('div');

  const pilasterEditor = wall ? panel('壁柱',
    ...wall.pilasters.map((pi) => h('div', { class: 'list-item' },
      h('span', { class: 'nm' }, `x=${pi.x} 宽${pi.width} 凸${pi.projection}`),
      button('删', () => store.update((p) => {
        const w2 = findWall(p, wall.id)!;
        w2.pilasters = w2.pilasters.filter((x) => x.id !== pi.id);
      }), 'danger'),
    )),
    button('+ 添加壁柱', () => store.update((p) => {
      const w2 = findWall(p, wall.id)!;
      w2.pilasters.push({ id: uid('pi'), x: 500, width: 365, projection: 120, height: w2.height });
    }), 'primary'),
  ) : h('div');

  const elevSwitch = panel('立面切换',
    selectField('立面', elev.id, project.elevations.map((e): [string, string] => [e.id, e.name]),
      (v) => { store.selectedElevationId = v; store.goto('elevation'); }),
    h('div', { class: 'muted' },
      `轴线 ${elev.axes.map((a) => a.id).join(' ')} · 标高 ${elev.levels.map((l) => l.name).join(' ')}`),
  );

  return h('div', { style: { display: 'flex', width: '100%', minHeight: 0 } },
    h('aside', { class: 'sidebar' }, elevSwitch, panel('墙段列表', wallList), wallEditor, opEditor, pilasterEditor),
    h('main', { class: 'stage', style: { position: 'relative' } }, wrap),
  );
}

function openingCard(wall: WallSpec, op: OpeningSpec): HTMLElement {
  const upd = (fn: (o: OpeningSpec) => void) => store.update((p) => {
    const o = findWall(p, wall.id)!.openings.find((x) => x.id === op.id)!;
    fn(o);
  });
  return h('div', { class: 'list-item', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
    h('div', { class: 'muted' }, op.label ?? '洞口'),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } },
      miniNum('X', op.x, (v) => upd((o) => (o.x = v))),
      miniNum('Y', op.y, (v) => upd((o) => (o.y = v))),
      miniNum('宽', op.width, (v) => upd((o) => (o.width = v))),
      miniNum('高', op.height, (v) => upd((o) => (o.height = v))),
    ),
    selectField('拱券', op.arch, [['none', '无拱(平口)'], ['flat', '平拱'], ['semicircular', '半圆砖拱券']] as [ArchType, string][],
      (v) => upd((o) => {
        o.arch = v;
        if (v === 'semicircular') o.archRise = o.width / 2;
        if (v === 'flat') o.archRise = 15;
      })),
    op.arch !== 'none' ? numberField('拱升起 mm', op.archRise, (v) => upd((o) => (o.archRise = v)), { min: 10, max: 2000 }) : h('span'),
    button('删除洞口', () => store.update((p) => {
      findWall(p, wall.id)!.openings = findWall(p, wall.id)!.openings.filter((x) => x.id !== op.id);
    }), 'danger'),
  );
}

function miniNum(label: string, value: number, onChange: (v: number) => void): HTMLElement {
  return h('label', { class: 'field' },
    h('span', { style: { flex: '0 0 24px' } }, label),
    h('input', { type: 'number', value, onchange: (e: Event) => onChange(Number((e.target as HTMLInputElement).value)) }),
  );
}

function findWall(p: { elevations: ElevationSpec[] }, id: string): WallSpec | undefined {
  return p.elevations.flatMap((e) => e.walls).find((w) => w.id === id);
}
