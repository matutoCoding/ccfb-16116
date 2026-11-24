import {
  BlendSettings,
  BondPattern,
  JointProfile,
  Project,
  WallSpec,
} from './types';

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultBlend(): BlendSettings {
  return {
    newRatio: 0.25,
    seed: 20261125,
    oldBatches: [
      { hue: -8, sat: 0.85, light: 0.78, weight: 3 },
      { hue: 4, sat: 0.95, light: 0.7, weight: 2 },
      { hue: -14, sat: 0.7, light: 0.62, weight: 1 },
    ],
    newBatches: [
      { hue: 6, sat: 1.05, light: 0.92, weight: 2 },
      { hue: 2, sat: 1.0, light: 0.86, weight: 1 },
    ],
  };
}

export function defaultProject(): Project {
  return {
    id: uid('proj'),
    name: '三号老厂房更新 · 清水墙样板',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    brick: {
      length: 240,
      width: 115,
      height: 53,
      threeQuarter: 180,
      twoInch: 60,
    },
    joint: {
      width: 10,
      profile: 'concave',
      depth: 4,
      rakeSlope: 3,
    },
    blend: defaultBlend(),
    elevations: [southElevation(), eastElevation()],
    weathering: {},
    render: {
      maxLod: 4,
      tileMm: 240,
      showVerticalJoints: true,
      highlightStraightJoints: true,
      weatheringDepth: 6,
    },
  };
}

/** 南立面: 三层, 轴线①-④, 双开间窗洞 + 大门洞平拱, 端部壁柱 */
function southElevation(): Project['elevations'][number] {
  const walls: WallSpec[] = [];
  const H = 10800;
  const bond: BondPattern = 'stretcher-header';
  walls.push({
    id: uid('wall'),
    name: '南立面主墙(①-④轴)',
    x: 0,
    y: 0,
    length: 9600,
    height: H,
    thickness: 240,
    angle: 0,
    cornerStart: true,
    cornerEnd: true,
    bond,
    openings: [
      {
        id: uid('op'), x: 900, y: 0, width: 1800, height: 2400,
        arch: 'flat', archRise: 18, archJoint: 8, label: '大门 M1',
      },
      {
        id: uid('op'), x: 4200, y: 900, width: 1500, height: 1800,
        arch: 'semicircular', archRise: 750, archJoint: 8, label: '一层窗 C1',
      },
      {
        id: uid('op'), x: 7200, y: 900, width: 1500, height: 1800,
        arch: 'semicircular', archRise: 750, archJoint: 8, label: '一层窗 C2',
      },
      {
        id: uid('op'), x: 1500, y: 4200, width: 1500, height: 1800,
        arch: 'flat', archRise: 15, archJoint: 8, label: '二层窗 C3',
      },
      {
        id: uid('op'), x: 4800, y: 4200, width: 1500, height: 1800,
        arch: 'flat', archRise: 15, archJoint: 8, label: '二层窗 C4',
      },
      {
        id: uid('op'), x: 1500, y: 7800, width: 1500, height: 1800,
        arch: 'flat', archRise: 15, archJoint: 8, label: '三层窗 C5',
      },
      {
        id: uid('op'), x: 4800, y: 7800, width: 1500, height: 1800,
        arch: 'flat', archRise: 15, archJoint: 8, label: '三层窗 C6',
      },
    ],
    pilasters: [
      { id: uid('pi'), x: 0, width: 365, projection: 120, height: H },
      { id: uid('pi'), x: 9235, width: 365, projection: 120, height: H },
    ],
  });

  return {
    id: uid('elev'),
    name: '①-④轴 南立面',
    axes: [
      { id: '①', x: 0 },
      { id: '②', x: 3200 },
      { id: '③', x: 6400 },
      { id: '④', x: 9600 },
    ],
    levels: [
      { name: '±0.000', y: 0 },
      { name: '+3.600', y: 3600 },
      { name: '+7.200', y: 7200 },
      { name: '+10.800', y: 10800 },
    ],
    walls,
  };
}

/** 东立面: 转角 90° 墙段 + 壁柱, 半圆拱窗 */
function eastElevation(): Project['elevations'][number] {
  const H = 10800;
  const wall: WallSpec = {
    id: uid('wall'),
    name: '东立面山墙(④-A轴)',
    x: 0,
    y: 0,
    length: 6000,
    height: H,
    thickness: 240,
    angle: 90,
    cornerStart: true,
    cornerEnd: false,
    bond: 'flemish',
    openings: [
      {
        id: uid('op'), x: 2250, y: 900, width: 1500, height: 1800,
        arch: 'semicircular', archRise: 750, archJoint: 8, label: '东山窗 C7',
      },
      {
        id: uid('op'), x: 2250, y: 4500, width: 1500, height: 1800,
        arch: 'flat', archRise: 15, archJoint: 8, label: '二层窗 C8',
      },
      {
        id: uid('op'), x: 2250, y: 8100, width: 1500, height: 1800,
        arch: 'flat', archRise: 15, archJoint: 8, label: '三层窗 C9',
      },
    ],
    pilasters: [
      { id: uid('pi'), x: 0, width: 365, projection: 120, height: H },
    ],
  };
  return {
    id: uid('elev'),
    name: '④-A轴 东立面',
    axes: [
      { id: '④', x: 0 },
      { id: '/1', x: 3000 },
      { id: 'A', x: 6000 },
    ],
    levels: [
      { name: '±0.000', y: 0 },
      { name: '+3.600', y: 3600 },
      { name: '+7.200', y: 7200 },
      { name: '+10.800', y: 10800 },
    ],
    walls: [wall],
  };
}

export function emptyWeathering() {
  return { stamps: [], repairs: [] };
}

export function profileDefaultDepth(p: JointProfile): number {
  switch (p) {
    case 'flush': return 0;
    case 'concave': return 4;
    case 'raked': return 6;
    case 'convex': return 3;
  }
}
