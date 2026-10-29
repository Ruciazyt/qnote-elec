/**
 * bead 素材的 SVG 像素工作台
 *
 * 这类"描成矢量的像素图"里，每个像素就是一个 `M x y h w v h h -w z` 矩形，
 * 可以无损地拆回像素网格做逐点修改，改完再按颜色分层重新合并输出 SVG。
 * 直接手改 SVG 的 d 字符串在 1000+ 个矩形下不可行，这层网格是必要的中间表示。
 *
 * 提供的函数：
 *   parseSvg / rasterize  SVG -> 像素网格
 *   toSvg                 像素网格 -> SVG（逐行贪心合并同色段）
 *   renderPng             像素网格 -> PNG（棋盘格底 + 可选像素网格线）
 *   runs                  打印逐行连续色块，避免手数像素错位
 */
import zlib from 'node:zlib';
import fs from 'node:fs';

export const W = 64, H = 68;

export function parseSvg(text) {
  const layers = [];
  const re = /<path\s+fill="(#[0-9a-fA-F]{6})"\s+d="([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) {
    const color = m[1];
    const rects = [];
    const rre = /M(\d+)\s+(\d+)h(\d+)v(\d+)h-(\d+)z/g;
    let r;
    while ((r = rre.exec(m[2]))) {
      const [, x, y, w, h, w2] = r.map(Number);
      if (w !== w2) throw new Error(`矩形宽度不自洽: M${x} ${y}h${w}v${h}h-${w2}z`);
      rects.push({ x, y, w, h });
    }
    layers.push({ color, rects });
  }
  return layers;
}

export const same = (a, b) =>
  (a === null && b === null) || (a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);

export function rasterize(list, w = W, h = H) {
  const grid = new Array(w * h).fill(null);
  for (const { color, rects } of list) {
    const rgb = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
    for (const { x, y, w: rw, h: rh } of rects) {
      for (let dy = 0; dy < rh; dy++) for (let dx = 0; dx < rw; dx++) grid[(y + dy) * w + (x + dx)] = rgb;
    }
  }
  return grid;
}

/** 像素网格 -> SVG */
export function toSvg(g, path, w = W, h = H) {
  const byColor = new Map();
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const c = g[y * w + x];
      let x2 = x;
      while (x2 + 1 < w && same(g[y * w + x2 + 1], c)) x2++;
      const hex = '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
      if (!byColor.has(hex)) byColor.set(hex, []);
      byColor.get(hex).push(`M${x} ${y}h${x2 - x + 1}v1h-${x2 - x + 1}z`);
      x = x2 + 1;
    }
  }
  const body = [...byColor].map(([hex, rs]) => `  <path fill="${hex}" d="${rs.join('')}"/>`).join('\n');
  fs.writeFileSync(path,
`<svg xmlns="http://www.w3.org/2000/svg" width="${w * 4}" height="${h * 4}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" shape-rendering="crispEdges">
  <rect width="${w}" height="${h}" fill="#ffffff"/>
${body}
</svg>
`);
  return { layers: byColor.size, rects: [...byColor.values()].reduce((n, r) => n + r.length, 0) };
}

/* ---- PNG ---- */
function crc32(buf) {
  let c;
  const t = (crc32.table ||= (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const tb = Buffer.from(type, 'ascii'); const cb = Buffer.alloc(4);
  cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([len, tb, data, cb]);
}
export function encodePng(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** 渲染放大图。grid=true 时每个源像素加细网格线，便于逐格数 */
export function renderPng(g, dest, { scale = 8, x0 = 0, y0 = 0, x1 = W, y1 = H, grid = false } = {}) {
  const cw = (x1 - x0) * scale, ch = (y1 - y0) * scale;
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const sx = x0 + Math.floor(x / scale), sy = y0 + Math.floor(y / scale);
      const chk = (Math.floor(sx / 4) + Math.floor(sy / 4)) % 2 === 0;
      const c = sy < H && sx < W ? g[sy * W + sx] : null;
      const base = c || [chk ? 0x9a : 0x6e, chk ? 0x9a : 0x6e, chk ? 0xa0 : 0x74];
      const k = grid && (x % scale === 0 || y % scale === 0) ? 0.55 : 1;
      const i = (y * cw + x) * 4;
      out[i] = Math.round(base[0] * k);
      out[i + 1] = Math.round(base[1] * k);
      out[i + 2] = Math.round(base[2] * k);
      out[i + 3] = 255;
    }
  }
  fs.writeFileSync(dest, encodePng(out, cw, ch));
  console.log('wrote', dest, `${cw}x${ch}`);
  return dest;
}

/** 并排对照：[左...] [右...]，分隔条为深灰。
 *  注意：透明像素会被跳过（露出分隔条的深灰底）。
 *  而 parseSvg 只吃 <path>，SVG 自带的 <rect> 白底不会进网格，
 *  想对照整图请先自己把 null 填成白底再传进来。
 *  x0/y0 省略时按 0 处理 —— 之前写成 `opts.x0 + ...` 会在省略时算出 NaN 下标，整张图全黑。 */
export function comparePng(pairs, dest, opts = {}) {
  const { scale = 8, gap = 6 } = opts;
  const x0 = opts.x0 ?? 0, y0 = opts.y0 ?? 0;
  const cw = (opts.x1 ?? W - x0) * scale, ch = (opts.y1 ?? H - y0) * scale;
  const pw = pairs.length * cw + (pairs.length + 1) * gap, ph = ch + gap * 2;
  const buf = new Uint8Array(pw * ph * 4);
  for (let i = 0; i < pw * ph; i++) { buf[i * 4] = 0x50; buf[i * 4 + 1] = 0x50; buf[i * 4 + 2] = 0x58; buf[i * 4 + 3] = 255; }
  pairs.forEach((g, k) => {
    const ox = gap + k * (cw + gap);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const c = g[(y0 + Math.floor(y / scale)) * W + (x0 + Math.floor(x / scale))];
      if (!c) continue;
      const i = ((y + gap) * pw + ox + x) * 4;
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
    }
  });
  fs.writeFileSync(dest, encodePng(buf, pw, ph));
  console.log('wrote', dest, `${pw}x${ph}`);
  return dest;
}

/** 打印逐行连续色块 */
export function runs(g, y0, y1, x0, x1) {
  const hex = (c) => (c ? '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('') : 'transparent');
  const out = [];
  for (let y = y0; y < y1; y++) {
    const rs = [];
    let cur = g[y * W + x0], start = x0;
    for (let x = x0 + 1; x <= x1; x++) {
      const c = x < x1 ? g[y * W + x] : null;
      if (!same(c, cur)) { rs.push(`${start}-${x - 1}:${hex(cur).replace('#', '')}`); cur = c; start = x; }
    }
    out.push('y=' + String(y).padStart(2) + '  ' + rs.join('  '));
  }
  console.log(out.join('\n'));
  return out;
}