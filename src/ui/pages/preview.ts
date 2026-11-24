import { h, panel, sliderField, button, toggleField } from '../dom';
import { store } from '../../store/appStore';
import { createViewer3d, ViewerHandle } from '../viewer3d';
import { CpuHeightField } from '../../core/heightField';

export function previewPage(): HTMLElement {
  const stage = h('div', { class: 'stage' }) as HTMLElement;
  let viewer: ViewerHandle;
  requestAnimationFrame(() => { viewer = createViewer3d(stage, { showFps: true, brush: true }); });

  const p = store.project;
  let brush: 'none' | 'weather' | 'repair' | 'measure' = 'none';
  let compareRepair = false;

  const pickInfo = h('div', { class: 'muted' }, '选择「量测点」后在墙面点击, 显示该点高度场信息');
  window.addEventListener('brick-pick', ((e: Event) => {
    const detail = (e as CustomEvent).detail as { wallId: string; x: number; y: number };
    const bond = store.currentBond(detail.wallId);
    if (!bond) return;
    const hf = new CpuHeightField(store.project, detail.wallId, bond.bricks);
    const s = hf.sample(detail.x, detail.y);
    pickInfo.innerHTML = `拾取点 (${detail.x.toFixed(0)}, ${detail.y.toFixed(0)}) mm<br>` +
      `高度 h=<b style="color:var(--accent2)">${s.h.toFixed(2)} mm</b> · ` +
      `${s.isMortar ? '灰缝内' : '砖面'} · ${s.isNew ? '新砖' : '旧砖'}`;
  }) as EventListener);

  const side = h('aside', { class: 'sidebar' },
    panel('镜头预设',
      button('贴墙 0.5m(验收视角)', () => {
        const w = store.allWalls().find((x) => x.id === store.selectedWallId) ?? store.allWalls()[0];
        viewer?.renderer?.focusOnWall(w.id);
        viewer?.renderer?.setNearHalfMeter(w.length * 0.3, w.height * 0.55);
      }, 'primary'),
      button('整墙远眺(看花墙)', () => {
        const w = store.allWalls().find((x) => x.id === store.selectedWallId) ?? store.allWalls()[0];
        viewer?.renderer?.focusOnWall(w.id);
      }),
      h('div', { class: 'muted' }, '滚轮推拉、拖拽旋转; 斜视角可在墙面轮廓线上看到灰缝凹凸'),
    ),
    panel('新旧砖混排',
      sliderField('新砖掺量', p.blend.newRatio, 0, 1, 0.05,
        (v) => store.update((pp) => (pp.blend.newRatio = v)), ''),
      sliderField('随机种子', p.blend.seed, 1, 999999, 1,
        (v) => store.update((pp) => (pp.blend.seed = v)), ''),
      button('换一版混排(随机种子)', () => store.update((pp) => (pp.blend.seed = Math.floor(Math.random() * 999999) + 1))),
      h('div', { class: 'muted' }, '种子决定每块砖新旧归属与批次, 同种子可复现; 远看是否“花”取决于掺量与批次色偏'),
    ),
    panel('风化酥碱 / 补砖',
      button('酥碱刷(砖面掉层)', () => { brush = 'weather'; viewer?.setBrushMode('weather'); }),
      button('补砖刷(修复)', () => { brush = 'repair'; viewer?.setBrushMode('repair'); }),
      button('量测点', () => { brush = 'measure'; viewer?.setBrushMode('measure'); }),
      button('停笔', () => { brush = 'none'; viewer?.setBrushMode('none'); }),
      sliderField('酥碱掉层深度', p.render.weatheringDepth, 1, 15, 0.5,
        (v) => store.updateRender((pp) => (pp.render.weatheringDepth = v)), ' mm'),
      toggleField('修复前后对比(隐藏补砖)', compareRepair, (v) => {
        compareRepair = v;
        // 对比模式: 临时把 repairs 清空渲染(不改数据), 再恢复
        const wId = store.selectedWallId!;
        if (v) {
          const saved = store.project.weathering[wId]?.repairs ?? [];
          (pickInfo as HTMLElement & { _saved?: unknown })._saved = saved;
          if (store.project.weathering[wId]) store.project.weathering[wId].repairs = [];
        } else {
          const saved = (pickInfo as HTMLElement & { _saved?: { x: number; y: number; r: number }[] })._saved;
          if (saved && store.project.weathering[wId]) store.project.weathering[wId].repairs = saved;
        }
        viewer?.renderer?.refreshWeathering(wId);
      }),
      button('清空本墙风化层', () => {
        const wId = store.selectedWallId!;
        store.updateRender((pp) => { pp.weathering[wId] = { stamps: [], repairs: [] }; });
        viewer?.renderer?.refreshWeathering(wId);
      }, 'danger'),
      pickInfo,
    ),
    panel('细分显示',
      toggleField('高亮通缝', p.render.highlightStraightJoints, (v) =>
        store.updateRender((pp) => (pp.render.highlightStraightJoints = v))),
      h('div', { class: 'muted' }, '自适应细分按瓦片屏幕边长驱动, 相邻瓦片共享边强制同级(无裂缝), 等级切换带 geomorph(无跳变)'),
    ),
  );

  return h('div', { style: { display: 'flex', width: '100%', minHeight: 0 } }, side, stage);
}
