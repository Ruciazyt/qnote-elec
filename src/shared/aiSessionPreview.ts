/**
 * AI 会话列表预览
 *
 * 主进程（生成 preview）、数据库迁移（回填）、渲染进程（展示前兜底清洗）
 * 三处共用同一套规则，避免各自实现一份正则后行为漂移。
 */

/** 预览最大长度 — 列表里只有 line-clamp-2，超过两行的部分本来也看不到 */
export const SESSION_PREVIEW_MAX = 80;

/**
 * 把消息正文清洗成一行预览
 *
 * ## 为什么要剥掉 <think>
 *
 * 部分模型会把推理过程混在正文里一起返回，直接展示会泄漏内部思考，
 * 而且长度远超预览该有的样子（会话列表里曾整屏都是 <think>…</think>）。
 * 流被截断时可能没有闭合标签，所以兜底匹配到字符串结尾。
 *
 * ## 谁的内容该进预览
 *
 * 只取**用户**的消息。早期版本取的是助手回复，于是列表里全是模型的
 * 客套话和工具调用描述，扫一眼根本看不出这条会话在聊什么 —— 用户
 * 自己说过什么才是识别会话的锚点。
 */
export function buildSessionPreview(
  text: string | null | undefined,
  max: number = SESSION_PREVIEW_MAX
): string {
  const cleaned = String(text ?? "")
    // 闭合的推理块
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    // 流被截断导致没闭合的推理块 —— 一直吃到结尾
    .replace(/<think>[\s\S]*$/i, " ")
    // 落单的闭合标签
    .replace(/<\/?think>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}
