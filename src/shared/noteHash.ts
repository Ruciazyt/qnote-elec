/**
 * 笔记内容指纹
 *
 * 剪贴板去重（写入时）和历史数据回填（迁移时）必须算出同一个值，否则
 * 回填出来的 content_hash 和新写入的对不上，索引就等于没建。
 */

/**
 * 计算内容的完整指纹（FNV-1a，64bit）
 *
 * ## 为什么要存哈希而不是直接查 content
 *
 * 去重原本是 `where("content", data.content)`，而 content 是 TEXT 且存着
 * 图片的 base64（单条几百 KB 起）。SQLite 无法给 TEXT 建可用的等值索引，
 * 每次剪贴板事件都会全表扫描，把所有历史图片的字节都读一遍。
 *
 * 存一列有索引的定长哈希后，等值查找走索引，只回读命中的那一行。
 *
 * ## 必须是全量
 *
 * 早先剪贴板监听里的 simpleHash 只取前 10000 字符，那是用来"判断图变没变"
 * 的宽松指纹，不适合当主键 —— 两条内容不同但前 10000 字符相同的笔记会被
 * 误判成重复而丢弃。contentHash 走全量字符，语义等价于原来的全等比较。
 *
 * 哈希碰撞由调用方的 content 精确比较兜底，见 clipboardListener.saveToDatabase。
 */
export function contentHash(content: string): string {
  // 两条 32bit 轨道拼成一个 64bit 指纹，降低碰撞率
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }

  return ((h1 >>> 0).toString(16).padStart(8, "0")) +
    ((h2 >>> 0).toString(16).padStart(8, "0"));
}
