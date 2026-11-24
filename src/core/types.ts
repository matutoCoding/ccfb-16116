// 核心领域模型 —— 所有长度单位均为毫米(mm)，角度为度

export type BondPattern = 'stretcher-header' | 'flemish' | 'three-stretcher' | 'english-cross';
export const BOND_LABELS: Record<BondPattern, string> = {
  'stretcher-header': '一顺一丁',
  flemish: '梅花丁',
  'three-stretcher': '三顺一丁',
  'english-cross': '英式十字',
};

export type JointProfile = 'flush' | 'concave' | 'raked' | 'convex';
export const JOINT_LABELS: Record<JointProfile, string> = {
  flush: '平缝',
  concave: '凹圆缝',
  raked: '斜缝(刮缝)',
  convex: '凸缝',
};

export type ArchType = 'none' | 'flat' | 'semicircular';

export type BrickCut = 'full' | 'three-quarter' | 'half' | 'two-inch' | 'arch';

export interface BrickSpec {
  /** 标准整砖尺寸 长×宽×高 */
  length: number;
  width: number;
  height: number;
  /** 七分头长度(默认 3/4 砖长)、二寸头长度(约 60mm) */
  threeQuarter: number;
  twoInch: number;
}

export interface JointSettings {
  /** 灰缝宽度(水平缝与竖缝共用) */
  width: number;
  profile: JointProfile;
  /** 缝深/缝高, mm, 正数。凹缝为凹入深度, 凸缝为凸出高度 */
  depth: number;
  /** 斜缝(raked)的倾斜: 上口比下口多压入量 */
  rakeSlope: number;
}

export interface OpeningSpec {
  id: string;
  /** 洞口左下角相对墙段左下角 */
  x: number;
  y: number;
  width: number;
  height: number;
  arch: ArchType;
  /** 拱券升起高度(平拱一般 12~24, 半圆拱=半跨) */
  archRise: number;
  /** 拱砖环向灰缝宽 */
  archJoint: number;
  label?: string;
}

export interface PilasterSpec {
  id: string;
  x: number;
  width: number;
  /** 凸出墙面的厚度 */
  projection: number;
  height: number;
}

export interface WallSpec {
  id: string;
  name: string;
  /** 墙段左下角在立面坐标系中的位置 */
  x: number;
  y: number;
  length: number;
  height: number;
  /** 墙厚(一砖墙 240 / 半砖 115) */
  thickness: number;
  /** 在水平面上的朝向角, 度; 转角处相邻墙段取 90° */
  angle: number;
  openings: OpeningSpec[];
  pilasters: PilasterSpec[];
  /** 该墙段是否为转角端头墙(端头自动配七分头) */
  cornerStart: boolean;
  cornerEnd: boolean;
  bond: BondPattern;
}

export interface ElevationSpec {
  id: string;
  name: string;
  /** 轴线号序列(标注用) */
  axes: { id: string; x: number }[];
  /** 标高序列 */
  levels: { name: string; y: number }[];
  walls: WallSpec[];
}

export interface BlendSettings {
  /** 新砖掺量比例 0~1 */
  newRatio: number;
  /** 随机种子 */
  seed: number;
  /** 旧砖批次色偏集合(按批次抽) */
  oldBatches: BatchColor[];
  newBatches: BatchColor[];
}

export interface BatchColor {
  /** 相对基准色的色相偏移 度 */
  hue: number;
  /** 饱和度倍率 */
  sat: number;
  /** 明度倍率 */
  light: number;
  /** 该批次被抽中的权重 */
  weight: number;
}

export interface WeatheringLayer {
  /** 酥碱/风化区域, 以墙面 mm 坐标存储的圆刷记录 */
  stamps: { x: number; y: number; r: number; strength: number }[];
  /** 修复(补砖)区域, 与风化记录叠加, 值 1 表示已补 */
  repairs: { x: number; y: number; r: number }[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  brick: BrickSpec;
  joint: JointSettings;
  blend: BlendSettings;
  elevations: ElevationSpec[];
  /** 每面墙的风化层, key = wallId */
  weathering: Record<string, WeatheringLayer>;
  /** 渲染设置 */
  render: {
    maxLod: number;
    tileMm: number;
    showVerticalJoints: boolean;
    highlightStraightJoints: boolean;
    weatheringDepth: number;
  };
}

export interface BrickInstance {
  /** 砖块包围盒(墙面二维) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  course: number;
  cut: BrickCut;
  /** 顺砖/丁砖: 顺砖贴长面, 丁砖贴短面 */
  orientation: 'stretcher' | 'header';
  wallId: string;
  /** 随机数(由种子+序号确定性生成), 驱动色差/起伏 */
  rng: number;
  isNew: boolean;
  batchIndex: number;
}

export interface ArchBrick {
  wallId: string;
  openingId: string;
  type: ArchType;
  /** 拱脚中心 */
  cx: number;
  cy: number;
  /** 内半径/外半径 */
  rInner: number;
  rOuter: number;
  /** 起始角、结束角、单块角度宽(含缝) */
  a0: number;
  a1: number;
  rng: number;
  isNew: boolean;
  batchIndex: number;
}

export interface BondResult {
  bricks: BrickInstance[];
  archBricks: ArchBrick[];
  /** 通缝(上下皮竖缝重合)位置, mm 坐标 + 涉及皮数 */
  straightJoints: { x: number; y0: number; y1: number; courses: number }[];
  /** 每皮砖布局(供设计图绘制) */
  courses: CourseLayout[];
  bom: BomResult;
}

export interface CourseLayout {
  index: number;
  y0: number;
  y1: number;
  orientation: 'stretcher' | 'header';
  segments: { x0: number; x1: number; cut: BrickCut }[];
}

export interface BomResult {
  full: number;
  threeQuarter: number;
  half: number;
  twoInch: number;
  arch: number;
  /** 灰浆体积, m³ */
  mortarVolume: number;
  /** 灰浆与砖面接触面积(按缝形截面), m² */
  mortarArea: number;
  brickVolume: number;
  /** 校验: 画面可见砖块总数(与各项之和一致) */
  totalBricks: number;
}
