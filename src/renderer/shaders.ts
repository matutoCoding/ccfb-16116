// WebGPU 着色器:
//  - compute: 每瓦块按屏幕边长求自适应细分等级(CPU侧做时间平滑, 防推拉跳变)
//  - 渲染: 每墙一次 indexed draw, 顶点阶段按实例查 LOD 生成网格,
//    共享边强制与邻居同级 → 无裂缝; 高度/位置 geomorph → 无跳变
//  - 解析高度场(非法线贴图): 砖面起伏 + 四种缝形 + 酥碱掉层全部真实位移

export const SHADER = /* wgsl */ `

struct Camera {
  viewProj: mat4x4f,
  camPos: vec4f,           // xyz 相机位置, w 画布宽度像素
  viewport: vec4f,         // x 画布宽, y 画布高, z 焦距(px/mm@1mm), w 未用
};
@group(0) @binding(0) var<uniform> cam: Camera;

struct WallUniform {
  model: mat4x4f,
  invModel: mat4x4f,
  wallId: vec4f,           // x=wallIndex, y=tileCountX, z=tileCountY, w=tileMm
  extents: vec4f,          // xy=墙长/高, z=墙厚, w=maxLod
  joint: vec4f,            // x=缝宽 y=缝深 z=rakeSlope w=profile(0平1凹2斜3凸)
  brick: vec4f,            // x=长 y=宽 z=高 w=weatherDepth
  color0: vec4f,           // 旧砖基准色 rgb
  color1: vec4f,           // 新砖基准色 rgb
};
@group(1) @binding(0) var<uniform> wall: WallUniform;

struct BrickS {
  x0: f32, y0: f32, x1: f32, y1: f32,
  rng: f32, id: f32, isNew: f32, batch: f32,
};
@group(1) @binding(1) var<storage, read> bricks: array<BrickS>;
@group(1) @binding(2) var<storage, read> courseIndex: array<u32>;
@group(1) @binding(3) var<storage, read> stamps: array<vec4f>;
@group(1) @binding(4) var<storage, read> repairs: array<vec4f>;
@group(1) @binding(5) var<storage, read> stampCount: array<u32>; // x=风化数 y=修复数

struct TileS {
  origin: vec2f,
  lodF: f32,                // 平滑后的连续 LOD
  _pad: f32,
};
@group(1) @binding(6) var<storage, read_write> tileLod: array<TileS>;
@group(1) @binding(7) var<storage, read> tiles: array<TileS>;

// ---------- 确定性哈希 ----------
fn hash21(n: u32) -> f32 {
  var x = n;
  x = (x ^ (x >> 16u)) * 73244475u;
  x = (x ^ (x >> 16u)) * 73244475u;
  x = x ^ (x >> 16u);
  return f32(x) / 4294967295.0;
}

// ---------- 砖查找: 当前皮+上下相邻皮中取边距最小者(水平缝归属稳定) ----------
fn findBrick(lx: f32, ly: f32) -> i32 {
  let nCourses = arrayLength(&courseIndex) - 1u;
  if (nCourses == 0u) { return -1; }
  var row = 0u;
  for (var i = 0u; i < nCourses; i++) {
    if (ly <= bricks[courseIndex[i]].y1) { row = i; break; }
    row = i;
  }
  var best = -1;
  var bestD = 1e9;
  let r0 = max(0, i32(row) - 1);
  let r1 = min(i32(nCourses) - 1, i32(row) + 1);
  for (var r = r0; r <= r1; r++) {
    let pick = nearestInCourse(u32(r), lx, ly);
    if (pick >= 0) {
      let d = edgeDist(bricks[pick], lx, ly);
      if (d < bestD) { bestD = d; best = pick; }
    }
  }
  return best;
}

fn nearestInCourse(row: u32, lx: f32, ly: f32) -> i32 {
  var a = courseIndex[row];
  let bEnd = courseIndex[row + 1u];
  var b = bEnd;
  loop {
    if (a >= b) { break; }
    let mid = (a + b) / 2u;
    let br = bricks[mid];
    if (lx < br.x0) { b = mid; }
    else if (lx > br.x1) { a = mid + 1u; }
    else { return i32(mid); }
  }
  var li = min(a, bEnd - 1u);
  var ri = max(courseIndex[row], b - 1u);
  let dl = edgeDist(bricks[li], lx, ly);
  let dr = edgeDist(bricks[ri], lx, ly);
  return i32(select(ri, li, dl <= dr));
}

fn edgeDist(b: BrickS, x: f32, y: f32) -> f32 {
  let dx = max(max(b.x0 - x, 0.0), x - b.x1);
  let dy = max(max(b.y0 - y, 0.0), y - b.y1);
  let outside = sqrt(dx * dx + dy * dy);
  if (outside > 0.0) { return outside; }
  return min(min(x - b.x0, b.x1 - x), min(y - b.y0, b.y1 - y));
}

// ---------- 缝形截面(与 CPU 同构): t∈[0,1], 0=砖边 1=缝中 ----------
fn jointProfile(t: f32) -> f32 {
  let p = i32(wall.joint.w);
  let d = wall.joint.y;
  if (p == 0) { return 0.0; }
  if (p == 1) {
    let u = 1.0 - t;                            // 砖边 u=1, 缝中心 u=0
    return -d * (1.0 - u * u);                 // 凹圆: 砖边 0, 中心 -d
  }
  if (p == 2) {
    return -d * (0.55 + 0.45 * t) - wall.joint.z * t; // 斜缝
  }
  let u = 1.0 - t;
  return d * (1.0 - u * u);                   // 凸缝: 砖边 0, 中心 +d
}

fn weatherAt(x: f32, y: f32) -> vec2f {
  var wth = 0.0;
  let ns = stampCount[0];
  for (var i = 0u; i < ns; i++) {
    let s = stamps[i];
    let q = distance(vec2f(x, y), s.xy) / s.z;
    if (q < 1.0) { wth = max(wth, s.w * (1.0 - q * q)); }
  }
  var repaired = 0.0;
  let nr = stampCount[1];
  for (var i = 0u; i < nr; i++) {
    let r = repairs[i];
    if (distance(vec2f(x, y), r.xy) < r.z) { repaired = 1.0; }
  }
  if (repaired > 0.0) { wth *= 0.15; }
  return vec2f(wth, repaired);
}

fn brickSurface(b: BrickS, x: f32, y: f32) -> f32 {
  let seed = u32(b.id) * 2654435761u;
  let n1 = hash21(seed & 0xffffu) - 0.5;
  let n2 = hash21(seed ^ u32(x * 1.7 + y * 0.9)) - 0.5;
  let sag = min(6.0, (x - b.x0) * 0.05) + min(6.0, (b.x1 - x) * 0.05)
          + min(5.0, (y - b.y0) * 0.08) + min(5.0, (b.y1 - y) * 0.08);
  var h = n1 * 1.6 + n2 * 0.7 - sag * 0.35;
  h = h - weatherAt(x, y).x * wall.brick.w;  // 酥碱: 砖面整体往里掉一层
  return h;
}

struct HF { h: f32, brickId: i32, mortar: f32 };

fn heightField(lx: f32, ly: f32) -> HF {
  let bi = findBrick(lx, ly);
  if (bi < 0) { return HF(-4.0, -1, 1.0); }
  let b = bricks[bi];
  let jw = wall.joint.x;
  let ed = edgeDist(b, lx, ly);
  let brickH = brickSurface(b, lx, ly);
  if (ed >= jw * 0.5) {
    return HF(brickH, bi, 0.0);
  }
  // t: 0=砖面(ed=jw/2), 1=缝中线(ed=0)
  let t = clamp(1.0 - ed / (jw * 0.5), 0.0, 1.0);
  // 缝形为主, 砖面起伏按 (1-t)² 衰减 → 缝中心严格等于设定缝深/缝高(与 CPU 同构)
  let h = jointProfile(t) + brickH * (1.0 - t) * (1.0 - t);
  return HF(h, bi, select(0.0, 1.0, t > 0.5));
}

// ---------- compute: 屏幕边长 → 连续 LOD ----------
@compute @workgroup_size(64)
fn tileLodCs(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= arrayLength(&tileLod)) { return; }
  let tm = tiles[idx];
  let tileMm = wall.wallId.w;
  let wp = wall.model * vec4f(tm.origin + vec2f(tileMm * 0.5), 0.0, 1.0);
  let dist = distance(wp.xyz, cam.camPos.xyz);
  // 透视: 屏幕像素 ≈ 焦距(px/mm) * 物理尺寸 / 距离
  let screenPx = cam.viewport.z * tileMm / max(dist, 1.0);
  let target = clamp(log2(max(screenPx / 24.0, 1.0)), 0.0, wall.extents.w);
  // 视锥外目标为 0; 时间指数平滑(系数 viewport.w), 镜头推拉时细分缓变不跳
  if (clip.w <= 0.1 || any(abs(ndc) > vec2f(1.8))) { target = 0.0; }
  let prev = tileLod[idx].lodF;
  if (prev <= 0.0001) { prev = target; }
  let k = clamp(cam.viewport.w, 0.02, 1.0);
  tileLod[idx].lodF = prev + (target - prev) * k;
}

// ---------- 顶点: 实例=瓦片, 按瓦片 LOD 生成细分网格 ----------
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec3f,
  @location(1) brickId: f32,
  @location(2) mortar: f32,
};

@vertex
fn vsMain(@builtin(vertex_index) vi: u32,
          @builtin(instance_index) ii: u32) -> VSOut {
  let maxL = u32(wall.extents.w);
  let nMax = 1u << maxL;
  let gxMax = vi % (nMax + 1u);
  let gyMax = vi / (nMax + 1u);
  if (gxMax > nMax || gyMax > nMax) {
    var dead: VSOut;
    dead.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    dead.local = vec3f(0.0); dead.brickId = -10.0; dead.mortar = 0.0;
    return dead;
  }

  let tcx = u32(wall.wallId.y);
  let tcy = u32(wall.wallId.z);
  let tilesN = tcx * tcy;
  let tx = ii % tcx;
  let ty = ii / tcx;
  let tileIdx = ii;
  let lodF = tileLod[tileIdx].lodF;

  // 邻居钳制: 共享边与四邻同级(取较大等级), 保证裂缝两侧网格对齐
  var edgeL = u32(ceil(lodF));
  let nL = tx > 0u ? tileLod[tileIdx - 1u].lodF : 0.0;
  let nR = tx + 1u < tcx ? tileLod[tileIdx + 1u].lodF : 0.0;
  let nD = ty > 0u ? tileLod[tileIdx - tcx].lodF : 0.0;
  let nU = ty + 1u < tcy ? tileLod[tileIdx + tcx].lodF : 0.0;
  let needX = (gxMax == 0u && tx > 0u) || (gxMax == nMax && tx + 1u < tcx);
  let needY = (gyMax == 0u && ty > 0u) || (gyMax == nMax && ty + 1u < tcy);
  if (needX) { edgeL = max(edgeL, u32(ceil(max(nL, nR)))); }
  if (needY) { edgeL = max(edgeL, u32(ceil(max(nD, nU)))); }
  edgeL = min(edgeL, maxL);
  let interiorL = min(u32(ceil(lodF)), maxL);

  // 该顶点所属的有效细分等级: 边界顶点随 edgeL, 内部随 interiorL
  let onBoundX = gxMax == 0u || gxMax == nMax;
  let onBoundY = gyMax == 0u || gyMax == nMax;
  var level = interiorL;
  if (onBoundX || onBoundY) { level = edgeL; }
  let nLvl = 1u << level;
  // 将 maxL 网格顶点吸附到 level 网格(不是该级的顶点 → 塌缩到父节点, 与 geomorph 配合)
  let mask = nMax / nLvl;
  let ax = (gxMax / mask) * mask;
  let ay = (gyMax / mask) * mask;
  let fx = f32(ax) / f32(nMax);
  let fy = f32(ay) / f32(nMax);

  let tileMm = wall.wallId.w;
  let tm = tiles[tileIdx];
  let lx = tm.origin.x + fx * tileMm;
  let ly = tm.origin.y + fy * tileMm;

  // geomorph: 内部顶点在连续LOD区间内向粗一级位置/高度插值(等级切换无跳变);
  // 边界顶点 morphT=0, 位置与邻居瓦片严格相同 → 无裂缝
  let coarseLevel = max(level, 1u) - 1u;
  let nCoarse = 1u << coarseLevel;
  let cMask = nMax / nCoarse;
  let cx = tm.origin.x + f32((gxMax / cMask) * cMask) / f32(nMax) * tileMm;
  let cy = tm.origin.y + f32((gyMax / cMask) * cMask) / f32(nMax) * tileMm;
  let morphT = clamp(f32(level) - lodF, 0.0, 1.0);
  if (onBoundX || onBoundY) { morphT = 0.0; }
  let hfFine = heightField(lx, ly);
  let hfCoarse = heightField(cx, cy);
  let px = mix(cx, lx, 1.0 - morphT);
  let py = mix(cy, ly, 1.0 - morphT);
  let ph = mix(hfCoarse.h, hfFine.h, 1.0 - morphT);

  let world = wall.model * vec4f(px, py, ph, 1.0);
  var o: VSOut;
  o.pos = cam.viewProj * world;
  o.local = vec3f(lx, ly, hfFine.h);
  o.brickId = f32(hfFine.brickId);
  o.mortar = hfFine.mortar;
  return o;
}

// ---------- 片元 ----------
fn brickColor(b: BrickS) -> vec3f {
  let base = select(wall.color1.rgb, wall.color0.rgb, b.isNew < 0.5);
  let v = hash21(u32(b.id) * 40503u + u32(b.batch) * 97u) - 0.5;
  let v2 = hash21(u32(b.rng * 65535.0)) - 0.5;
  var c = base * (1.0 + v * 0.16 + v2 * 0.06);
  let wth = weatherAt((b.x0 + b.x1) * 0.5, (b.y0 + b.y1) * 0.5);
  c = mix(c, c * vec3f(0.7, 0.66, 0.58), wth.x * 0.75);
  if (wth.y > 0.5) { c = mix(c, wall.color1.rgb * 0.96, 0.55); }
  return clamp(c, vec3f(0.02), vec3f(1.0));
}

@fragment
fn fsMain(in: VSOut) -> @location(0) vec4f {
  if (in.brickId < -5.0) { discard; }
  let eps = 1.5;
  let hL = heightField(in.local.x - eps, in.local.y).h;
  let hR = heightField(in.local.x + eps, in.local.y).h;
  let hD = heightField(in.local.x, in.local.y - eps).h;
  let hU = heightField(in.local.x, in.local.y + eps).h;
  let n = normalize(vec3f(hL - hR, hD - hU, 2.0 * eps));
  let light = normalize(vec3f(-0.45, 0.55, 0.75));
  let diff = clamp(dot(n, light) * 0.65 + 0.45, 0.0, 1.0);
  var albedo: vec3f;
  if (in.brickId < 0.0) {
    albedo = vec3f(0.3, 0.27, 0.24);
  } else {
    let b = bricks[i32(in.brickId)];
    albedo = brickColor(b);
    if (in.mortar > 0.5) {
      albedo = mix(albedo, vec3f(0.35, 0.32, 0.29), 0.78);
    }
  }
  let grain = hash21(u32(in.local.x * 3.1 + in.local.y * 7.7)) - 0.5;
  albedo = albedo * (1.0 + grain * 0.05);
  return vec4f(albedo * diff, 1.0);
}
`;

export const ARCH_SHADER = /* wgsl */ `
struct Camera { viewProj: mat4x4f, camPos: vec4f, viewport: vec4f };
@group(0) @binding(0) var<uniform> cam: Camera;
struct WallM { model: mat4x4f, _inv: mat4x4f };
@group(2) @binding(0) var<uniform> wm: WallM;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) isNew: f32,
  @location(1) mortar: f32,
};
@vertex
fn vs(@location(0) p: vec3f, @location(1) isNew: f32, @location(2) mortar: f32) -> VSOut {
  var o: VSOut;
  o.pos = cam.viewProj * (wm.model * vec4f(p, 1.0));
  o.isNew = isNew; o.mortar = mortar;
  return o;
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let oldC = vec3f(0.55, 0.16, 0.12);
  let newC = vec3f(0.78, 0.28, 0.2);
  var c = select(newC, oldC, in.isNew < 0.5);
  if (in.mortar > 0.5) { c = vec3f(0.35, 0.32, 0.29); }
  return vec4f(c * 0.97, 1.0);
}
`;
