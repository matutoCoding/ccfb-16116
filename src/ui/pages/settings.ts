import { idb } from '../../store/idb';
import { h, numberField, panel, button, sliderField } from '../dom';
import { store } from '../../store/appStore';

export function settingsPage(): HTMLElement {
  const p = store.project;
  return h('div', { style: { display: 'flex', width: '100%', minHeight: 0 } },
    h('aside', { class: 'sidebar' },
      panel('砖规格(标准红砖)',
        numberField('砖长 mm', p.brick.length, (v) => store.update((pp) => (pp.brick.length = v)), { min: 190, max: 300 }),
        numberField('砖宽 mm', p.brick.width, (v) => store.update((pp) => (pp.brick.width = v)), { min: 90, max: 150 }),
        numberField('砖高 mm', p.brick.height, (v) => store.update((pp) => (pp.brick.height = v)), { min: 40, max: 70 }),
        numberField('七分头 mm', p.brick.threeQuarter, (v) => store.update((pp) => (pp.brick.threeQuarter = v)), { min: 120, max: 220 }),
        numberField('二寸头 mm', p.brick.twoInch, (v) => store.update((pp) => (pp.brick.twoInch = v)), { min: 40, max: 90 }),
        h('div', { class: 'muted' }, '默认 240×115×53; 修改规格后全部墙段重新排砖并刷新清单'),
      ),
      panel('渲染细分',
        sliderField('最大细分等级', p.render.maxLod, 2, 6, 1,
          (v) => store.updateRender((pp) => (pp.render.maxLod = v)), ' 级'),
        sliderField('瓦片尺寸', p.render.tileMm, 120, 480, 12,
          (v) => store.updateRender((pp) => (pp.render.tileMm = v)), ' mm'),
        h('div', { class: 'muted' }, '瓦片越小、等级越高, 近看缝截面越精细, 顶点开销越大; compute 按屏幕边长自适应选择等级'),
      ),
      panel('项目',
        h('label', { class: 'field' }, h('span', {}, '项目名'),
          h('input', { value: p.name, onchange: (e: Event) => store.updateRender((pp) => (pp.name = (e.target as HTMLInputElement).value)) })),
        button('立即保存到 IndexedDB', () => store.saveNow(), 'primary'),
        button('恢复出厂样板项目', () => { if (confirm('将重置为三层老厂房样板, 当前修改丢失')) store.resetSample(); }, 'danger'),
      ),
    ),
    h('main', { class: 'stage', style: { padding: '18px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' } },
      panel('IndexedDB 中已存项目', projectList()),
      panel('技术说明',
        h('div', { class: 'muted', style: { lineHeight: '1.9' } },
          '· 排砖引擎(CPU): 四种砌法 + 端头配砖贪心匹配 + 通缝检测 + 楔形拱券, 确定性种子随机。',
          h('br'),
          '· 高度场: 解析函数(砖面起伏/缝形截面/酥碱掉层), CPU 与 WGSL 同构, 剖面测量即渲染几何。',
          h('br'),
          '· WebGPU: compute 求每瓦片屏幕 LOD, storage buffer 驱动; 共享边邻居钳制防裂缝, geomorph 防跳变。',
          h('br'),
          '· 持久化: 项目整体存 IndexedDB(brick-studio-db / projects), 编辑防抖 600ms 自动保存。',
        ),
      ),
    ),
  );
}

function projectList(): HTMLElement {
  const host = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    h('div', { class: 'muted' }, '加载中…'));
  void idb.list().then((list) => {
    host.replaceChildren(...list.map((pr) =>
      h('div', { class: 'list-item' },
        h('span', { class: 'nm' },
          h('div', {}, pr.name),
          h('div', { class: 'muted' }, `更新于 ${new Date(pr.updatedAt).toLocaleString()}`)),
        pr.id === store.project.id ? h('span', { class: 'badge good' }, '当前') :
          button('打开', () => store.loadProject(pr.id)),
        button('副本', () => idb.duplicate(pr).then(() => store.goto('settings'))),
        button('删除', () => {
          if (confirm(`删除项目「${pr.name}」?`)) void idb.remove(pr.id).then(() => store.goto('settings'));
        }, 'danger'),
      ),
    ));
    if (!list.length) host.replaceChildren(h('div', { class: 'muted' }, '暂无其他已保存项目'));
  });
  return host;
}
