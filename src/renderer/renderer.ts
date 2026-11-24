import { BondResult, Project, WallSpec } from '../core/types';
import { SHADER, ARCH_SHADER } from './shaders';
import { Mat4, mat4, vec3 } from './math';
import { buildArchGeometry } from './archMesh';

export interface RenderCallbacks {
  onFps?: (fps: number, lodInfo: string) => void;
}

interface WallGpu {
  wall: WallSpec;
  bindGroup: GPUBindGroup;
  uniform: ArrayBuffer;
  tileBuffer: GPUBuffer;
  tileLodBuffer: GPUBuffer;
  brickBuffer: GPUBuffer;
  courseBuffer: GPUBuffer;
  stampBuffer: GPUBuffer;
  repairBuffer: GPUBuffer;
  countBuffer: GPUBuffer;
  tileCountX: number;
  tileCountY: number;
  instanceCount: number;
  indexCount: number;
  modelMatrix?: Mat4;
  archVertexBuffer?: GPUBuffer;
  archIndexBuffer?: GPUBuffer;
  archIndexCount?: number;
  archBindGroup?: GPUBindGroup;
  archUniformBuffer?: GPUBuffer;
}

const BRICK_STRIDE = 32;
const TILE_STRIDE = 16;

export class BrickRenderer {
  device!: GPUDevice;
  context!: GPUCanvasContext;
  format!: GPUTextureFormat;
  pipeline!: GPURenderPipeline;
  archPipeline!: GPURenderPipeline;
  computePipeline!: GPUComputePipeline;
  camBGL!: GPUBindGroupLayout;
  wallBGL!: GPUBindGroupLayout;
  camUniform!: GPUBuffer;
  camBindGroup!: GPUBindGroup;
  indexBuffer!: GPUBuffer;
  vertexCountMaxLod = 0;
  walls: WallGpu[] = [];
  project!: Project;
  bonds: Record<string, BondResult> = {};
  canvas: HTMLCanvasElement;
  cb: RenderCallbacks;

  // 轨道相机(世界 mm 坐标)
  target: [number, number, number] = [0, 5000, 0];
  yaw = 0;
  pitch = 0.12;
  distance = 14000;
  fovY = Math.PI / 4.5;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  private fpsAcc = 0;
  private fpsFrames = 0;
  private lastT = performance.now();
  private raf = 0;
  private disposed = false;
  private focusWall: string | null = null;

  constructor(canvas: HTMLCanvasElement, cb: RenderCallbacks = {}) {
    this.canvas = canvas;
    this.cb = cb;
  }

  static async isSupported(): Promise<boolean> {
    return !!navigator.gpu && (await navigator.gpu.requestAdapter()) != null;
  }

  async init(project: Project, bonds: Record<string, BondResult>): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('未找到 WebGPU 适配器');
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    const module = this.device.createShaderModule({ code: SHADER });
    this.camUniform = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 显式绑定组布局, compute 与 render 共用
    this.camBGL = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    this.wallBGL = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 7, visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.camBindGroup = this.device.createBindGroup({
      layout: this.camBGL,
      entries: [{ binding: 0, resource: { buffer: this.camUniform } }],
    });

    const mainLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.camBGL, this.wallBGL] });
    this.pipeline = this.device.createRenderPipeline({
      layout: mainLayout,
      vertex: { module, entryPoint: 'vsMain', buffers: [] },
      fragment: { module, entryPoint: 'fsMain', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });
    this.computePipeline = this.device.createComputePipeline({
      layout: mainLayout,
      compute: { module, entryPoint: 'tileLodCs' },
    });
    this.archPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: this.device.createShaderModule({ code: ARCH_SHADER }),
        entryPoint: 'vs',
        buffers: [{
          arrayStride: 20,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32' },
            { shaderLocation: 2, offset: 16, format: 'float32' },
          ],
        }],
      },
      fragment: {
        module: this.device.createShaderModule({ code: ARCH_SHADER }),
        entryPoint: 'fs',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
    });

    this.project = project;
    this.bonds = bonds;
    this.buildSharedIndexBuffer();
    this.rebuildWalls();
    this.attachControls();
    this.frame();
  }

  private buildSharedIndexBuffer() {
    const maxL = this.project.render.maxLod;
    const nMax = 1 << maxL;
    const vertsPerTile = (nMax + 1) * (nMax + 1);
    this.vertexCountMaxLod = vertsPerTile;
    const indicesPerTile = nMax * nMax * 6;
    const maxTiles = 2048;
    const data = new Uint32Array(indicesPerTile * maxTiles);
    for (let t = 0; t < maxTiles; t++) {
      const base = t * indicesPerTile;
      const vBase = t * vertsPerTile;
      let k = 0;
      for (let y = 0; y < nMax; y++) {
        for (let x = 0; x < nMax; x++) {
          const a = vBase + y * (nMax + 1) + x;
          const b = a + 1;
          const c = a + nMax + 1;
          const d = c + 1;
          data[base + k++] = a; data[base + k++] = c; data[base + k++] = b;
          data[base + k++] = b; data[base + k++] = c; data[base + k++] = d;
        }
      }
    }
    this.indexBuffer = this.device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, data);
  }

  // ---------------- 资源构建 ----------------
  rebuildWalls() {
    for (const w of this.walls) this.disposeWall(w);
    this.walls = [];
    const tileMm = this.project.render.tileMm;
    for (const wall of this.project.elevations.flatMap((e) => e.walls)) {
      this.walls.push(this.buildWall(wall, tileMm));
    }
  }

  private disposeWall(w: WallGpu) {
    [w.tileBuffer, w.tileLodBuffer, w.brickBuffer, w.courseBuffer, w.stampBuffer,
      w.repairBuffer, w.countBuffer, w.archVertexBuffer, w.archIndexBuffer]
      .filter(Boolean).forEach((b) => b!.destroy());
  }

  private buildWall(wall: WallSpec, tileMm: number): WallGpu {
    const device = this.device;
    const bond = this.bonds[wall.id];
    const p = this.project;
    const tileCountX = Math.ceil(wall.length / tileMm);
    const tileCountY = Math.ceil(wall.height / tileMm);
    const instanceCount = tileCountX * tileCountY;

    // 砖 storage
    const brickData = new Float32Array(bond.bricks.length * 8);
    bond.bricks.forEach((b, i) => {
      brickData.set([b.x0, b.y0, b.x1, b.y1, b.rng, i, b.isNew ? 1 : 0, b.batchIndex], i * 8);
    });
    const brickBuffer = device.createBuffer({
      size: Math.max(16, brickData.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    if (brickData.length) device.queue.writeBuffer(brickBuffer, 0, brickData);

    // 皮索引(每皮首砖偏移)
    const courseOffsets = new Uint32Array(bond.courses.length + 1);
    let cursor = 0;
    bond.courses.forEach((c, i) => {
      courseOffsets[i] = cursor;
      cursor += c.segments.length;
    });
    courseOffsets[bond.courses.length] = bond.bricks.length;
    const courseBuffer = device.createBuffer({
      size: Math.max(16, courseOffsets.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(courseBuffer, 0, courseOffsets);

    // 瓦片
    const tileData = new Float32Array(instanceCount * 4);
    for (let ty = 0; ty < tileCountY; ty++) {
      for (let tx = 0; tx < tileCountX; tx++) {
        const i = ty * tileCountX + tx;
        tileData.set([tx * tileMm, ty * tileMm, 0, 0], i * 4);
      }
    }
    const tileBuffer = device.createBuffer({
      size: tileData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(tileBuffer, 0, tileData);
    const tileLodBuffer = device.createBuffer({
      size: tileData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // 风化层
    const wl = p.weathering[wall.id] ?? { stamps: [], repairs: [] };
    const stampData = new Float32Array(Math.max(1, wl.stamps.length) * 4);
    wl.stamps.forEach((s, i) => stampData.set([s.x, s.y, s.r, s.strength], i * 4));
    const repairData = new Float32Array(Math.max(1, wl.repairs.length) * 4);
    wl.repairs.forEach((r, i) => repairData.set([r.x, r.y, r.r, 0], i * 4));
    const stampBuffer = device.createBuffer({ size: stampData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const repairBuffer = device.createBuffer({ size: repairData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(stampBuffer, 0, stampData);
    device.queue.writeBuffer(repairBuffer, 0, repairData);
    const countBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(countBuffer, 0, new Uint32Array([wl.stamps.length, wl.repairs.length, 0, 0]));

    // 墙 uniform (mat4×2=128 + vec4×6=96 = 224, 对齐到 256)
    const uniform = new ArrayBuffer(256);
    const wallUniformBuffer = device.createBuffer({
      size: uniform.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
      layout: this.wallBGL,
      entries: [
        { binding: 0, resource: { buffer: wallUniformBuffer } },
        { binding: 1, resource: { buffer: brickBuffer } },
        { binding: 2, resource: { buffer: courseBuffer } },
        { binding: 3, resource: { buffer: stampBuffer } },
        { binding: 4, resource: { buffer: repairBuffer } },
        { binding: 5, resource: { buffer: countBuffer } },
        { binding: 6, resource: { buffer: tileLodBuffer } },
        { binding: 7, resource: { buffer: tileBuffer } },
      ],
    });
    // compute 与 render 共用同一绑定组(显式布局一致)
    const computeBg = bindGroup;

    const gpu: WallGpu = {
      wall,
      bindGroup,
      uniform,
      tileBuffer,
      tileLodBuffer,
      brickBuffer,
      courseBuffer,
      stampBuffer,
      repairBuffer,
      countBuffer,
      tileCountX,
      tileCountY,
      instanceCount,
      indexCount: (1 << p.render.maxLod) ** 2 * 6,
    };
    (gpu as WallGpu & { uniformBuffer: GPUBuffer }).uniformBuffer = wallUniformBuffer;
    (gpu as WallGpu & { computeBindGroup: GPUBindGroup }).computeBindGroup = computeBg;

    this.writeWallUniform(gpu);
    this.buildArch(gpu, bond);
    return gpu;
  }

  /** 仅刷新某墙的风化层(刷酥碱/补砖时调用, 不重建全部资源) */
  refreshWeathering(wallId: string) {
    const gpu = this.walls.find((w) => w.wall.id === wallId);
    if (!gpu) return;
    const wl = this.project.weathering[wallId] ?? { stamps: [], repairs: [] };
    const stampData = new Float32Array(Math.max(1, wl.stamps.length) * 4);
    wl.stamps.forEach((s, i) => stampData.set([s.x, s.y, s.r, s.strength], i * 4));
    const repairData = new Float32Array(Math.max(1, wl.repairs.length) * 4);
    wl.repairs.forEach((r, i) => repairData.set([r.x, r.y, r.r, 0], i * 4));
    if (stampData.byteLength <= gpu.stampBuffer.size) {
      this.device.queue.writeBuffer(gpu.stampBuffer, 0, stampData);
      this.device.queue.writeBuffer(gpu.repairBuffer, 0, repairData);
      this.device.queue.writeBuffer(gpu.countBuffer, 0, new Uint32Array([wl.stamps.length, wl.repairs.length, 0, 0]));
    } else {
      this.rebuildWalls();
    }
  }

  private writeWallUniform(gpu: WallGpu) {
    const p = this.project;
    const wall = gpu.wall;
    const f = new Float32Array(gpu.uniform);
    const model = mat4.mul(
      mat4.translate(wall.x, wall.y, 0),
      mat4.rotateZ((wall.angle * Math.PI) / 180),
    );
    f.set(mat4.flat(model), 0);
    f.set(mat4.flat(mat4.invert(model)), 16);
    f.set([0, gpu.tileCountX, gpu.tileCountY, p.render.tileMm], 32);
    f.set([wall.length, wall.height, wall.thickness, p.render.maxLod], 36);
    const profileIdx = p.joint.profile === 'flush' ? 0 : p.joint.profile === 'concave' ? 1 : p.joint.profile === 'raked' ? 2 : 3;
    f.set([p.joint.width, p.joint.depth, p.joint.rakeSlope, profileIdx], 40);
    f.set([p.brick.length, p.brick.width, p.brick.height, p.render.weatheringDepth], 44);
    f.set([0.55, 0.16, 0.12, 1], 48); // 旧砖基准
    f.set([0.78, 0.28, 0.2, 1], 52);  // 新砖基准
    const buf = (gpu as WallGpu & { uniformBuffer: GPUBuffer }).uniformBuffer;
    this.device.queue.writeBuffer(buf, 0, gpu.uniform);
  }

  private buildArch(gpu: WallGpu, bond: BondResult) {
    if (!bond.archBricks.length) return;
    const { positions, indices } = buildArchGeometry(bond.archBricks, this.project.joint.width);
    const vb = this.device.createBuffer({ size: Math.max(16, positions.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vb, 0, positions);
    const ib = this.device.createBuffer({ size: Math.max(16, indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(ib, 0, indices);
    gpu.archVertexBuffer = vb;
    gpu.archIndexBuffer = ib;
    gpu.archIndexCount = indices.length;
    const model = mat4.mul(
      mat4.translate(gpu.wall.x, gpu.wall.y, 2),
      mat4.rotateZ((gpu.wall.angle * Math.PI) / 180),
    );
    gpu.modelMatrix = model;
    const ub = this.device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(ub, 0, mat4.flat(model));
    gpu.archUniformBuffer = ub;
    gpu.archBindGroup = this.device.createBindGroup({
      layout: this.archPipeline.getBindGroupLayout(2),
      entries: [{ binding: 0, resource: { buffer: ub } }],
    });
  }

  // ---------------- 相机 ----------------
  get camPos(): vec3 {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
  }

  focusOnWall(wallId: string) {
    this.focusWall = wallId;
    const w = this.walls.find((x) => x.wall.id === wallId);
    if (w) {
      this.target = [w.wall.x + w.wall.length / 2, w.wall.y + w.wall.height / 2, 0];
      this.distance = Math.max(w.wall.length, w.wall.height) * 0.9;
      this.pitch = 0.05;
    }
  }

  setNearHalfMeter(x: number, y: number) {
    // 镜头贴到墙前 500mm
    this.target = [x, y, 0];
    this.distance = 500;
    this.pitch = 0;
    this.yaw = 0;
  }

  private attachControls() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointerup', (e) => {
      this.dragging = false;
      c.releasePointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw -= dx * 0.005;
      this.pitch = Math.max(-0.4, Math.min(0.9, this.pitch + dy * 0.005));
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0012);
      this.distance = Math.max(400, Math.min(40000, this.distance * factor));
    }, { passive: false });
  }

  /** 屏幕像素 → 墙面 mm 坐标(射线与 z=0 平面求交, 再按墙 angle 逆变换) */
  pickWall(clientX: number, clientY: number): { wallId: string; x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const aspect = rect.width / rect.height;
    const tan = Math.tan(this.fovY / 2);
    const eye = this.camPos;
    const forward = vec3.normalize(vec3.sub(this.target, eye));
    const right = vec3.normalize(vec3.cross(forward, [0, 1, 0]));
    const up = vec3.cross(right, forward);
    const dir = vec3.normalize([
      forward[0] + right[0] * nx * tan * aspect + up[0] * ny * tan,
      forward[1] + right[1] * nx * tan * aspect + up[1] * ny * tan,
      forward[2] + right[2] * nx * tan * aspect + up[2] * ny * tan,
    ]);
    for (const g of this.walls) {
      const wall = g.wall;
      const a = (wall.angle * Math.PI) / 180;
      const normal: vec3 = [Math.sin(a), 0, Math.cos(a)];
      const origin: vec3 = [wall.x, wall.y, 0];
      const denom = vec3.dot(dir, normal);
      if (Math.abs(denom) < 1e-6) continue;
      const t = vec3.dot(vec3.sub(origin, eye), normal) / denom;
      if (t < 0) continue;
      const hit: vec3 = vec3.add(eye, vec3.scale(dir, t));
      const rel = vec3.sub(hit, origin);
      const lx = vec3.dot(rel, [Math.cos(a), 0, -Math.sin(a)]);
      const ly = rel[1];
      if (lx >= 0 && lx <= wall.length && ly >= 0 && ly <= wall.height) {
        return { wallId: wall.id, x: lx, y: ly };
      }
    }
    return null;
  }

  // ---------------- 主循环 ----------------
  private frame = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;

    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const view = mat4.lookAt(this.camPos, this.target, [0, 1, 0]);
    const proj = mat4.perspective(this.fovY, aspect, 50, 100000);
    const viewProj = mat4.mul(proj, view);
    const focalPx = this.canvas.clientHeight / 2 / Math.tan(this.fovY / 2);
    // Camera: viewProj(64) + camPos(16) + viewport(16), viewport.w = LOD 时间平滑系数
    const smoothK = 1 - Math.exp(-dt * 8);
    const camData = new Float32Array(20);
    camData.set(mat4.flat(viewProj), 0);
    camData.set([...this.camPos, this.canvas.clientWidth], 16);
    camData.set([this.canvas.clientWidth, this.canvas.clientHeight, focalPx, smoothK], 16 + 4);
    this.device.queue.writeBuffer(this.camUniform, 0, camData);

    const encoder = this.device.createCommandEncoder();

    // compute pass: GPU 按屏幕边长求每瓦片连续 LOD(含时间平滑), 写入 tileLod
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.camBindGroup);
    for (const g of this.walls) {
      computePass.setBindGroup(1, g.bindGroup);
      computePass.dispatchWorkgroups(Math.ceil(g.instanceCount / 64));
    }
    computePass.end();

    const depth = this.device.createTexture({
      size: [Math.max(1, this.canvas.clientWidth), Math.max(1, this.canvas.clientHeight)],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.09, g: 0.085, b: 0.08, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.camBindGroup);
    for (const g of this.walls) {
      pass.setBindGroup(1, g.bindGroup);
      pass.setIndexBuffer(this.indexBuffer, 'uint32');
      pass.drawIndexed(g.indexCount, g.instanceCount, 0, 0, 0);
      if (g.archIndexCount && g.archVertexBuffer && g.archIndexBuffer && g.archBindGroup) {
        pass.setPipeline(this.archPipeline);
        pass.setBindGroup(0, this.camBindGroup);
        pass.setBindGroup(2, g.archBindGroup);
        pass.setVertexBuffer(0, g.archVertexBuffer);
        pass.setIndexBuffer(g.archIndexBuffer, 'uint32');
        pass.drawIndexed(g.archIndexCount, 1);
        pass.setPipeline(this.pipeline);
      }
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    depth.destroy();

    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      const fps = this.fpsFrames / this.fpsAcc;
      const lods = this.walls
        .map((g) => `${g.wall.name.slice(0, 4)} ${g.tileCountX}×${g.tileCountY}瓦/细分${this.project.render.maxLod}级`)
        .join(' | ');
      this.cb.onFps?.(fps, `compute 自适应细分 · ${lods}`);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.walls.forEach((w) => this.disposeWall(w));
    this.indexBuffer?.destroy();
    this.camUniform?.destroy();
  }
}
