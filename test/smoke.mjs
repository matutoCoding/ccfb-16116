// 引擎层冒烟测试(不依赖 WebGPU): 排砖/配砖/通缝/拱券/缝深测量/清单对账
// 运行: node test/smoke.mjs
import { defaultProject } from '../src/core/defaultProject.ts';
import { buildProjectBond, aggregateBom } from '../src/core/bond.ts';
import { CpuHeightField } from '../src/core/heightField.ts';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✘ ${name} ${detail}`); }
}

const project = defaultProject();
const walls = project.elevations.flatMap((e) => e.walls);
console.log(`样板项目: ${walls.length} 面墙, ${project.elevations.length} 个立面`);
const bonds = buildProjectBond(walls, project.brick, project.joint, project.blend);

// 1. 每面墙都有排砖结果且无越界砖
for (const w of walls) {
  const b = bonds[w.id];
  check(`${w.name}: 砖块数>0`, b.bricks.length > 100, `实际 ${b.bricks.length}`);
  const outOfBounds = b.bricks.some((x) => x.x0 < -1 || x.x1 > w.length + 1 || x.y1 > w.height + 1);
  check(`${w.name}: 砖块不越界`, !outOfBounds);
  // 同皮砖不重叠
  const byCourse = new Map();
  for (const br of b.bricks) {
    if (!byCourse.has(br.course)) byCourse.set(br.course, []);
    byCourse.get(br.course).push(br);
  }
  let overlap = false;
  for (const [, list] of byCourse) {
    list.sort((a, b2) => a.x0 - b2.x0);
    for (let i = 1; i < list.length; i++) if (list[i].x0 < list[i - 1].x1 - 0.5) overlap = true;
  }
  check(`${w.name}: 同皮无重叠`, !overlap);
}

// 2. 四种砌法都能排
const patterns = ['stretcher-header', 'flemish', 'three-stretcher', 'english-cross'];
for (const pat of patterns) {
  const probe = { ...walls[0], id: `probe-${pat}`, openings: [], pilasters: [], cornerStart: true, bond: pat };
  const r = bonds[probe.id] ?? buildProjectBond([probe], project.brick, project.joint, project.blend)[probe.id];
  check(`砌法 ${pat} 可排砖`, r.bricks.length > 50);
}

// 3. 配砖只出现标准类别
const allowed = new Set(['full', 'three-quarter', 'half', 'two-inch']);
for (const w of walls) {
  const bad = bonds[w.id].bricks.filter((b) => !allowed.has(b.cut));
  check(`${w.name}: 切砖类别标准`, bad.length === 0);
}

// 4. 拱券: 楔形砖数量与几何
const archWall = walls[0];
const arch = bonds[archWall.id];
check('大门平拱生成拱砖', arch.archBricks.some((a) => a.type === 'flat'));
check('半圆拱生成拱砖', arch.archBricks.some((a) => a.type === 'semicircular'));
for (const a of arch.archBricks) {
  check('拱砖为楔形(rOuter>rInner)', a.rOuter > a.rInner);
  check('拱砖角度区间合法', a.a1 > a.a0 && a.a0 >= -0.1 && a.a1 <= Math.PI + 0.1);
}

// 5. 清单对账: 分类之和 = 总数 = 画面砖数(同一数据源)
const total = aggregateBom(Object.values(bonds));
const sum = total.full + total.threeQuarter + total.half + total.twoInch + total.arch;
check('清单分类之和=总计', sum === total.totalBricks, `${sum} vs ${total.totalBricks}`);
const rawCount = Object.values(bonds).reduce((s, b) => s + b.bricks.length + b.archBricks.length, 0);
check('清单总数=砖实例总数(画面对账)', total.totalBricks === rawCount, `${total.totalBricks} vs ${rawCount}`);
check('灰浆体积为正且量级合理(m³)', total.mortarVolume > 0.5 && total.mortarVolume < 50, total.mortarVolume.toFixed(3));

// 6. 缝深测量: 凹圆缝, 实测最深 vs 设定 4mm, 误差≤1mm(验收判据)
project.joint.profile = 'concave';
project.joint.depth = 4;
const rebuilt = buildProjectBond(walls, project.brick, project.joint, project.blend);
const w0 = walls[0];
const hf = new CpuHeightField(project, w0.id, rebuilt[w0.id].bricks);
// 水平灰缝中线 = 上皮砖底 + 半缝宽; 在一块整砖中部取竖剖面
const c2 = rebuilt[w0.id].courses[2];
const c3 = rebuilt[w0.id].courses[3];
const seg = c2.segments[0];
const sampleX = seg.x0 + (seg.x1 - seg.x0) / 2;
// 水平灰缝真正中心 = 上皮砖底与下皮砖顶的中点(缝宽由排砖间距决定)
const seamY = (c2.y1 + c3.y0) / 2;
const line = hf.profileLine('v', sampleX, seamY - 8, seamY + 8);
const deepest = Math.min(...line.map((p) => p.h));
check(`凹圆缝实测缝深 |${deepest.toFixed(2)}| vs 设定4mm, 误差≤1mm`,
  Math.abs(Math.abs(deepest) - 4) <= 1, `实测 ${deepest.toFixed(2)}mm`);
// 解析缝形中心值(验收基准, 与 WGSL jointProfile 同构)
const profileAtCenter = hf.jointProfile(1);
check(`凹圆缝解析缝深=${profileAtCenter.toFixed(2)} 严格等于 -4mm`, profileAtCenter === -4);

// 凸缝高度
project.joint.profile = 'convex';
project.joint.depth = 3;
const rebuilt2 = buildProjectBond(walls, project.brick, project.joint, project.blend);
const hf2 = new CpuHeightField(project, w0.id, rebuilt2[w0.id].bricks);
// 亚毫米扫描整条缝取峰值(真实量测方式), 避免缝中心两砖归属抖动
const seamY2 = (rebuilt2[w0.id].courses[2].y1 + rebuilt2[w0.id].courses[3].y0) / 2;
const fineScan = [];
for (let yy = seamY2 - 6; yy <= seamY2 + 6; yy += 0.25) {
  fineScan.push(hf2.sample(sampleX, yy).h);
}
const highest = Math.max(...fineScan);
check(`凸缝解析缝高=${hf2.jointProfile(1).toFixed(2)} 严格等于 +3mm`, hf2.jointProfile(1) === 3);
check(`凸缝亚毫米扫描峰值 ${highest.toFixed(2)} vs 设定3mm, 误差≤1mm`,
  Math.abs(highest - 3) <= 1, `峰值 ${highest.toFixed(2)}mm`);

// 7. 通缝检测能产出结果或确认无通缝(结构字段存在)
for (const w of walls) {
  const r = rebuilt[w.id];
  check(`${w.name}: 通缝字段结构合法`, Array.isArray(r.straightJoints));
}

// 8. 种子可复现: 同种子两次排砖 rng 一致
const r1 = buildProjectBond([walls[0]], project.brick, project.joint, project.blend)[walls[0].id];
const r2 = buildProjectBond([walls[0]], project.brick, project.joint, project.blend)[walls[0].id];
check('同种子排砖完全可复现', r1.bricks.every((b, i) => b.rng === r2.bricks[i].rng && b.isNew === r2.bricks[i].isNew));
const blend2 = { ...project.blend, seed: project.blend.seed + 1 };
const r3 = buildProjectBond([walls[0]], project.brick, project.joint, blend2)[walls[0].id];
const newRatio1 = r1.bricks.filter((b) => b.isNew).length / r1.bricks.length;
const newRatio3 = r3.bricks.filter((b) => b.isNew).length / r3.bricks.length;
check(`新砖掺量接近设定 ${project.blend.newRatio}`, Math.abs(newRatio1 - project.blend.newRatio) < 0.08, `${newRatio1.toFixed(3)}`);
check('换种子改变混排', r3.bricks.some((b, i) => b.isNew !== r1.bricks[i].isNew));

// 9. 酥碱掉层: 刷过区域高度比未刷区域低
project.joint.profile = 'concave';
project.weathering[w0.id] = {
  stamps: [{ x: 500, y: 3000, r: 300, strength: 1 }],
  repairs: [],
};
const hf3 = new CpuHeightField(project, w0.id, rebuilt[w0.id].bricks);
const sWeather = hf3.sample(500, 3000);
const sClean = hf3.sample(2000, 3000);
check('酥碱区砖面低于完好区', sWeather.h < sClean.h - 2, `${sWeather.h.toFixed(2)} vs ${sClean.h.toFixed(2)}`);

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
