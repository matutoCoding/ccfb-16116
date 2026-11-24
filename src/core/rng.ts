// 确定性随机数(mulberry32) —— 种子可复现, 保证清单与画面对应
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashU32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** 按权重抽批次, r 为 [0,1) 随机数 */
export function pickBatch(
  weights: number[],
  r: number,
): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let p = r * total;
  for (let i = 0; i < weights.length; i++) {
    p -= weights[i];
    if (p < 0) return i;
  }
  return weights.length - 1;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
