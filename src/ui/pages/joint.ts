import { CpuHeightField } from '../../core/heightField';
import { JOINT_LABELS, JointProfile, JointSettings } from '../../core/types';
import { h, numberField, panel, selectField, sliderField } from '../dom';
import { store } from '../../store/appStore';
import { profileDefaultDepth } from '../../core/defaultProject';

export function jointPage(): HTMLElement {
  const project = store.project;
  const j = project.joint;
  const wall = store.allWalls().find((w) => w.id === store.selectedWallId) ?? store.allWalls()[0];
  const bond = store.currentBond(wall.id)!;
  const field = new CpuHeightField(project, wall.id, bond.bricks);

  const sectionCanvas = h('canvas', { width: 560, height: 260 }) as HTMLCanvasElement;
  const measureCanvas = h('canvas', { width: 560, height: 300 }) as HTMLCanvasElement;

  // 截面扫描参数(墙面 mm 坐标)。默认竖直剖一条水平灰缝, fixed=缝中心
  const scan = { axis: 'v' as 'h' | 'v' };
  const c0 = bond.courses[2] ?? bond.courses[0];
  const c1 = bond.courses[3] ?? c0;
  let fixed = c0.segments[0] ? c0.segments[0].x0 + (c0.segments[0].x1 - c0.segments[0].x0) / 2 : 200;
  let from = Math.max(0, c0.y1 - 6);
  let to = Math.min(wall.height, c1.y0 + 6);

  function drawGenericSection() {
    const ctx = sectionCanvas.getContext('2d')!;
    const W = sectionCanvas.width, H = sectionCanvas.height;
    ctx.fillStyle = '#17140f';
    ctx.fillRect(0, 0, W, H);
    // 用解析截面画一条横跨 3 条灰缝的示意图
    const span = project.brick.length * 2 + j.width * 3;
    const samples: number[] = [];
    for (let x = 0; x <= span; x += 2) samples.push(profileSchematic(j, x, span));
    const minH = Math.min(...samples, -j.depth - 1);
    const maxH = 3;
    const px = (W - 60) / span;
    const py = (H - 70) / (maxH - minH);
    const Y = (hh: number) => 30 + (maxH - hh) * py;
    // 零位线(砖面基准)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(30, Y(0)); ctx.lineTo(W - 20, Y(0)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#a89c8b'; ctx.font = '11px sans-serif';
    ctx.fillText('砖面基准 0', W - 90, Y(0) - 5);
    // 截面填充
    ctx.beginPath();
    ctx.moveTo(30, Y(samples[0]));
    samples.forEach((s, i) => ctx.lineTo(30 + i * 2 * px, Y(s)));
    ctx.lineTo(30 + span * px, Y(-8));
    ctx.lineTo(30, Y(-8));
    ctx.closePath();
    ctx.fillStyle = 'rgba(200,97,60,0.25)';
    ctx.fill();
    ctx.strokeStyle = '#d9a05b'; ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach((s, i) => {
      const X = 30 + i * 2 * px;
      if (i === 0) ctx.moveTo(X, Y(s)); else ctx.lineTo(X, Y(s));
    });
    ctx.stroke();
    // 深度标注
    if (j.profile !== 'flush') {
      const deepest = j.profile === 'convex' ? j.depth : -j.depth;
      const xMark = 30 + span / 2 * px;
      ctx.strokeStyle = '#7ea86b'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xMark, Y(0)); ctx.lineTo(xMark, Y(deepest)); ctx.stroke();
      ctx.fillStyle = '#7ea86b';
      ctx.fillText(`设定缝${j.profile === 'convex' ? '高' : '深'} ${j.depth.toFixed(1)} mm`, xMark + 8, (Y(0) + Y(deepest)) / 2);
    }
    ctx.fillStyle = '#a89c8b';
    ctx.fillText(`${JOINT_LABELS[j.profile]} · 缝宽 ${j.width} mm`, 30, H - 18);
  }

  function drawMeasuredSection() {
    const ctx = measureCanvas.getContext('2d')!;
    const W = measureCanvas.width, H = measureCanvas.height;
    ctx.fillStyle = '#17140f';
    ctx.fillRect(0, 0, W, H);
    const data = field.profileLine(scan.axis, fixed, from, to);
    const hs = data.map((d) => d.h);
    const minH = Math.min(...hs) - 1;
    const maxH = Math.max(...hs) + 1;
    const span = to - from;
    const px = (W - 70) / span;
    const py = (H - 80) / (maxH - minH);
    const X = (t: number) => 35 + (t - from) * px;
    const Y = (hh: number) => 25 + (maxH - hh) * py;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(30, Y(0)); ctx.lineTo(W - 15, Y(0)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    data.forEach((d, i) => {
      if (i === 0) ctx.moveTo(X(d.t), Y(d.h)); else ctx.lineTo(X(d.t), Y(d.h));
    });
    ctx.strokeStyle = '#d9a05b'; ctx.lineWidth = 1.8;
    ctx.stroke();
    // 灰缝区段底色
    ctx.fillStyle = 'rgba(120,110,95,0.18)';
    let inMortar = false;
    let mStart = 0;
    data.forEach((d, i) => {
      if (d.mortar && !inMortar) { inMortar = true; mStart = d.t; }
      if (!d.mortar && inMortar) {
        inMortar = false;
        ctx.fillRect(X(mStart), 20, X(d.t) - X(mStart), H - 55);
      }
    });
    // 量测: 每条缝的最深点 vs 设定深度
    const measurements = measureJoints(data, j);
    ctx.fillStyle = '#a89c8b'; ctx.font = '11px sans-serif';
    measurements.forEach((m, i) => {
      const color = Math.abs(m.measured - (j.profile === 'convex' ? j.depth : -j.depth)) <= 1 ? '#7ea86b' : '#d9a05b';
      ctx.fillStyle = color;
      ctx.fillText(`缝${i + 1}: 实测 ${m.measured.toFixed(2)}mm @t=${m.at.toFixed(0)}`, 40 + (i % 3) * 170, H - 38 + Math.floor(i / 3) * 15);
    });
    ctx.fillStyle = '#a89c8b';
    ctx.fillText(`剖面: ${scan.axis === 'h' ? '水平' : '竖直'}扫描, ${scan.axis === 'h' ? 'Y' : 'X'}=${fixed.toFixed(0)}mm, 区间 ${from}~${to}mm (步长1mm)`, 35, H - 8);
    ctx.strokeStyle = '#7ea86b';
    ctx.strokeText(`验收判据: |实测缝深 - 设定${j.depth}mm| ≤ 1mm`, 35, 16);
  }

  drawGenericSection();
  drawMeasuredSection();

  return h('div', { style: { display: 'flex', width: '100%', minHeight: 0 } },
    h('aside', { class: 'sidebar' },
      panel('灰缝参数',
        sliderField('灰缝宽度', j.width, 6, 16, 0.5, (v) => store.update((p) => (p.joint.width = v)), ' mm'),
        selectField('缝形', j.profile,
          (Object.keys(JOINT_LABELS) as JointProfile[]).map((p): [JointProfile, string] => [p, JOINT_LABELS[p]]),
          (v) => store.update((p) => {
            p.joint.profile = v;
            p.joint.depth = profileDefaultDepth(v);
          })),
        j.profile === 'flush' ? h('div', { class: 'muted' }, '平缝与砖面齐平, 缝深为 0') :
          sliderField(j.profile === 'convex' ? '缝凸出高度' : '缝凹入深度', j.depth, 1, 12, 0.5,
            (v) => store.update((p) => (p.joint.depth = v)), ' mm'),
        j.profile === 'raked' ? sliderField('斜缝上口倾斜', j.rakeSlope, 0, 8, 0.5,
          (v) => store.update((p) => (p.joint.rakeSlope = v)), ' mm') : h('span'),
      ),
      panel('剖缝位置(任意位置)',
        selectField('扫描方向', scan.axis, [['h', '水平剖(看竖缝)'], ['v', '竖直剖(看水平缝)']],
          (v) => { scan.axis = v; drawMeasuredSection(); }),
        numberField(scan.axis === 'h' ? 'Y 坐标' : 'X 坐标', fixed, (v) => { fixed = v; drawMeasuredSection(); }, { min: 0, max: wall.height, unit: 'mm' }),
        numberField('起点', from, (v) => { from = v; drawMeasuredSection(); }, { min: 0, max: wall.length }),
        numberField('终点', to, (v) => { to = v; drawMeasuredSection(); }, { min: 100, max: wall.length }),
        h('div', { class: 'muted' }, '剖面数据来自与 GPU 同构的 CPU 高度场, 1mm 步长采样, 即“剖开量”的结果'),
      ),
    ),
    h('main', { class: 'stage', style: { padding: '18px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' } },
      panel('缝形截面示意(解析公式)', h('div', { class: 'cross-section' }, sectionCanvas)),
      panel('实墙任意位置剖缝测量', h('div', { class: 'cross-section' }, measureCanvas)),
    ),
  );
}

function profileSchematic(j: JointSettings, x: number, span: number): number {
  // 在示意区间内均匀布置 3 条缝
  const pitch = span / 3;
  const local = x % pitch;
  const half = j.width / 2;
  const center = pitch / 2;
  const d = Math.abs(local - center);
  if (d >= half) return 0;
  const t = 1 - d / half;
  switch (j.profile) {
    case 'flush': return 0;
    case 'concave': { const u = 1 - t; return -j.depth * (1 - u * u); }
    case 'raked': return -j.depth * (0.55 + 0.45 * t) - j.rakeSlope * t;
    case 'convex': { const u = 1 - t; return j.depth * (1 - u * u); }
  }
}

function measureJoints(
  data: { t: number; h: number; mortar: boolean }[],
  j: JointSettings,
): { at: number; measured: number }[] {
  const out: { at: number; measured: number }[] = [];
  let cur: { at: number; h: number } | null = null;
  for (const d of data) {
    if (d.mortar) {
      const target = j.profile === 'convex' ? j.depth : -j.depth;
      if (!cur || (j.profile === 'convex' ? d.h > cur.h : d.h < cur.h)) {
        cur = { at: d.t, h: d.h };
      }
    } else if (cur) {
      out.push({ at: cur.at, measured: cur.h });
      cur = null;
    }
  }
  if (cur) out.push({ at: cur.at, measured: cur.h });
  return out.slice(0, 9);
}
