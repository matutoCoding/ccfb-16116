import { BondResult, Project } from '../core/types';
import { buildProjectBond } from '../core/bond';
import { idb } from './idb';
import { defaultProject } from '../core/defaultProject';

export type PageId =
  | 'elevation'
  | 'bond'
  | 'joint'
  | 'preview'
  | 'bom'
  | 'settings';

export const PAGE_TITLES: Record<PageId, string> = {
  elevation: '项目立面',
  bond: '排砖设计',
  joint: '缝形工艺',
  preview: '近看预览',
  bom: '材料清单',
  settings: '设置',
};

type Listener = () => void;

class AppStore {
  project: Project = defaultProject();
  bondCache: Record<string, BondResult> = {};
  page: PageId = 'elevation';
  selectedWallId: string | null = null;
  selectedElevationId: string | null = null;
  dirty = false;
  ready = false;
  private listeners = new Set<Listener>();
  private saveTimer: number | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
    this.dirty = true;
    this.scheduleSave();
  }

  /** 结构性修改(排砖/立面/配比) → 重算排砖 */
  update(mutator: (p: Project) => void, rebuild = true) {
    mutator(this.project);
    if (rebuild) this.rebuildBond();
    this.emit();
  }

  /** 纯渲染参数修改, 不重算排砖 */
  updateRender(mutator: (p: Project) => void) {
    mutator(this.project);
    this.emit();
  }

  rebuildBond() {
    const walls = this.project.elevations.flatMap((e) => e.walls);
    this.bondCache = buildProjectBond(walls, this.project.brick, this.project.joint, this.project.blend);
  }

  allWalls() {
    return this.project.elevations.flatMap((e) => e.walls);
  }

  currentBond(wallId: string): BondResult | undefined {
    return this.bondCache[wallId];
  }

  goto(page: PageId) {
    this.page = page;
    this.emit();
  }

  selectWall(wallId: string) {
    this.selectedWallId = wallId;
    const elev = this.project.elevations.find((e) => e.walls.some((w) => w.id === wallId));
    if (elev) this.selectedElevationId = elev.id;
    this.emit();
  }

  private scheduleSave() {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void idb.save(this.project).then(() => {
        this.dirty = false;
        this.listeners.forEach((fn) => fn());
      });
    }, 600);
  }

  async saveNow() {
    await idb.save(this.project);
    this.dirty = false;
    this.emit();
  }

  async loadProject(id: string) {
    const p = await idb.load(id);
    if (p) {
      this.project = p;
      this.selectedElevationId = p.elevations[0]?.id ?? null;
      this.selectedWallId = p.elevations[0]?.walls[0]?.id ?? null;
      this.rebuildBond();
      this.ready = true;
      this.emit();
    }
  }

  async init() {
    const last = idb.lastOpenedId();
    if (last) {
      const p = await idb.load(last);
      if (p) {
        this.project = p;
      }
    }
    this.selectedElevationId = this.project.elevations[0]?.id ?? null;
    this.selectedWallId = this.project.elevations[0]?.walls[0]?.id ?? null;
    this.rebuildBond();
    this.ready = true;
    this.emit();
  }

  newProject() {
    this.project = defaultProject();
    this.selectedElevationId = this.project.elevations[0].id;
    this.selectedWallId = this.project.elevations[0].walls[0].id;
    this.rebuildBond();
    this.emit();
  }

  resetSample() {
    this.project = defaultProject();
    this.rebuildBond();
    this.emit();
  }
}

export const store = new AppStore();
