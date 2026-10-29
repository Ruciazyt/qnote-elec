/**
 * 随机 id 生成
 *
 * ## 为什么不用 Math.random()
 *
 * Math.random() 是伪随机数发生器，输出可预测 —— 拿它当"唯一 id"或"口令"，
 * 在理论上可以被推算出来。SonarCloud 按 S2245 把这类调用记成安全热点，
 * 质量门禁里的 Security Rating 会因为它掉档（AGENTS.md 第 4 节说的就是这类红线）。
 *
 * 这里要的确实是不可测，所以用 crypto。
 *
 * 用 getRandomValues 而不是 randomUUID：前者不受安全上下文限制，
 * 后者在非安全上下文里根本不存在，用它就得留一条 Math.random 兜底分支。
 */

/** 生成指定字节数的随机十六进制串 */
export function randomHex(byteLength = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 取 [0, maxExclusive) 区间的随机整数 */
export function randomInt(maxExclusive: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % maxExclusive;
}
