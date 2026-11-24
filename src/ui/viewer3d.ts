import { h } from './dom';
import { store } from '../store/appStore';
import { BrickRenderer } from '../renderer/renderer';
import { SoftwareRenderer } from '../renderer/softwareRenderer';

export interface ViewerHandle {
  renderer: BrickRenderer | SoftwareRenderer | null;
  canvas: HTMLCanvasElement;
  setBrushMode: (m: 'none' | 'weather' | 'repair' | 'measure') => void;
  refresh: () => void;
  rebuild: () => void;
}

export function createViewer3d(
  root: HTMLElement,
  opts: { showFps?: boolean; brush?: boolean } = {},
): ViewerHandle {
  const canvas = h('canvas', {}) as HTMLCanvasElement;
  const hud = h('div', { class: 'hud' }) as HTMLElement;
  const tools = h('div', { class: 'tools' }) as HTMLElement;
  root.replaceChildren(h('div', { style: { position: 'relative', width: '100%', height: '100%' } }, canvas, hud, tools));

  const handle: ViewerHandle = { renderer: null, canvas, setBrushMode: (m) => (brushMode = m), refresh: () => {}, rebuild: () => {} };
  let renderer: BrickRenderer | SoftwareRenderer | null = null;
  let brushMode: 'none' | 'weather' | 'repair' | 'measure' = 'none';

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = root.clientWidth;
    const hgt = root.clientHeight;
    canvas.width = Math.max(64, Math.floor(w * dpr));
    canvas.height = Math.max(64, Math.floor(hgt * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hgt}px`;
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(root);

  BrickRenderer.isSupported().then(async (gpuOk) => {
    const onFps = (fps: number, info: string) => {
      if (opts.showFps) {
        const mark = fps >= 45 ? 'good-text' : fps >= 24 ? 'warn-text' : '';
        hud.innerHTML = `帧率 <b class="${mark}">${fps.toFixed(1)} FPS</b><br>${info}<br>滚轮推拉 · 拖拽旋转`;
      }
    };
    if (gpuOk) {
      try {
        const r = new BrickRenderer(canvas, { onFps });
        await r.init(store.project, store.bondCache);
        renderer = r;
        handle.renderer = r;
        const firstWall = store.selectedWallId ?? store.allWalls()[0]?.id;
        if (firstWall) r.focusOnWall(firstWall);
        handle.refresh = () => {
          r.project = store.project;
          r.bonds = store.bondCache;
          r.rebuildWalls();
        };
        bindBrush(r);
        return;
      } catch (e) {
        console.warn('WebGPU 初始化失败, 回退软件渲染', e);
      }
    }
    // 软件回退
    hud.innerHTML = '当前环境 WebGPU 不可用(如远程桌面), 已启用 <b>Canvas2D 软件回退</b><br>高度场与缝深逻辑与 GPU 完全一致';
    const sw = new SoftwareRenderer(canvas, store.project, store.bondCache, { onFps });
    const firstWall = store.selectedWallId ?? store.allWalls()[0]?.id;
    if (firstWall) sw.focusOnWall(firstWall);
    sw.start();
    renderer = sw;
    handle.renderer = sw;
    handle.refresh = () => {
      sw.project = store.project;
      sw.bonds = store.bondCache;
      sw.rebuildWalls();
    };
    bindBrush(sw);
  });

  function bindBrush(r: BrickRenderer | SoftwareRenderer) {
    if (!opts.brush) return;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    let painting = false;
    const apply = (e: MouseEvent) => {
      const hit = r.pickWall(e.clientX, e.clientY);
      if (!hit) return;
      const wl = (store.project.weathering[hit.wallId] ??= { stamps: [], repairs: [] });
      const radius = 140;
      if (brushMode === 'weather') {
        wl.stamps.push({ x: hit.x, y: hit.y, r: radius, strength: 1 });
        r.refreshWeathering(hit.wallId);
        store.updateRender(() => {});
      } else if (brushMode === 'repair') {
        wl.repairs.push({ x: hit.x, y: hit.y, r: radius });
        r.refreshWeathering(hit.wallId);
        store.updateRender(() => {});
      } else if (brushMode === 'measure') {
        window.dispatchEvent(new CustomEvent('brick-pick', { detail: hit }));
      }
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (brushMode === 'none') return;
      painting = true;
      apply(e);
    });
    canvas.addEventListener('pointermove', (e) => { if (painting) apply(e); });
    window.addEventListener('pointerup', () => (painting = false));
  }

  return handle;
}
