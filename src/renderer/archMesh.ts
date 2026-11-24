import { ArchBrick } from '../core/types';

// 拱券楔形砖几何: 每块拱砖 = 内外弧+两侧径向边的扇环四边形, 带少量内凹细分
// 顶点: [x, y, z(高度), isNew, mortar]
export interface ArchGeometry {
  positions: Float32Array;
  indices: Uint32Array;
}

export function buildArchGeometry(arches: ArchBrick[], jointWidth: number): ArchGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const sub = 3; // 每边细分数, 让弧面平滑

  for (const a of arches) {
    const base = positions.length / 5;
    // (sub+1)×(sub+1) 网格, 径向从 rInner→rOuter, 角度 a0→a1
    for (let j = 0; j <= sub; j++) {
      const v = j / sub;
      const r = a.rInner + (a.rOuter - a.rInner) * v;
      for (let i = 0; i <= sub; i++) {
        const u = i / sub;
        const ang = a.a0 + (a.a1 - a.a0) * u;
        const x = a.cx + r * Math.cos(ang);
        const y = a.cy + r * Math.sin(ang);
        // 砖面轻微起伏, 边缘(灰缝处)内凹, 与主墙缝语言一致
        const edge = Math.min(u, 1 - u, v, 1 - v);
        const seam = edge < 0.18 ? -jointWidth * 0.25 * (1 - edge / 0.18) : 0;
        const bulge = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.8;
        positions.push(x, y, seam + bulge, a.isNew ? 1 : 0, edge < 0.18 ? 1 : 0);
      }
    }
    for (let j = 0; j < sub; j++) {
      for (let i = 0; i < sub; i++) {
        const p0 = base + j * (sub + 1) + i;
        const p1 = p0 + 1;
        const p2 = p0 + sub + 1;
        const p3 = p2 + 1;
        indices.push(p0, p2, p1, p1, p2, p3);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

export const ARCH_SHADER = /* wgsl */ `
struct Camera { viewProj: mat4x4f, camPos: vec4f, viewport: vec4f };
@group(0) @binding(0) var<uniform> cam: Camera;
struct WallM { model: mat4x4f };
@group(2) @binding(0) var<uniform> wm: WallM;

struct VSIn { @location(0) p: vec3f, @location(1) isNew: f32, @location(2) mortar: f32 };
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) v: vec3f,
  @location(1) isNew: f32,
  @location(2) mortar: f32,
};
@vertex
fn vs(in: VSIn) -> VSOut {
  var o: VSOut;
  let wp = wm.model * vec4f(in.p, 1.0);
  o.pos = cam.viewProj * wp;
  o.v = in.p; o.isNew = in.isNew; o.mortar = in.mortar;
  return o;
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let oldC = vec3f(0.55, 0.16, 0.12);
  let newC = vec3f(0.78, 0.28, 0.2);
  var c = select(newC, oldC, in.isNew < 0.5);
  if (in.mortar > 0.5) { c = vec3f(0.35, 0.32, 0.29); }
  return vec4f(c * 0.95, 1.0);
}
`;
