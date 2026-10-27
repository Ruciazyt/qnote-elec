/**
 * AI 对话里的图片附件 —— 主进程与渲染层共用的类型与工具
 *
 * ## 存什么
 *
 * 附件存成 `{ mime, data, name? }`：
 *   · mime —— image/png / image/jpeg / image/gif / image/webp
 *   · data —— base64 正文，**不带** `data:` 前缀
 *   · name —— 原始文件名，只用于界面上显示，不参与任何协议
 *
 * 为什么不直接存 data URL：前缀是 mime 的冗余，每张图都要多存十几个字符，
 * 而渲染层要显示缩略图时自己拼一下就行（`aiImageDataUrl`）。
 *
 * ## 发给模型时用哪种块格式
 *
 * 只有一种：`{ type: 'image_url', image_url: { url: 'data:<mime>;base64,<data>' } }`
 *
 * 这不是随便挑的 —— 两种协议对这个块的解释正好相反，必须挑两边都能吃的那个：
 *
 *   · **OpenAI 兼容**（ChatOpenAI）：`image_url` 是它自己的原生格式，
 *     base64 data URL 直接透传给上游网关。
 *   · **Anthropic**（ChatAnthropic）：它不认 `image_url` 这个名字，
 *     但 LangChain 的 `_formatImage` 会把 data URL 解析成
 *     `{ type: 'base64', media_type, data }` 再交给 Anthropic SDK。
 *
 * 反过来不成立：LangChain 那个「标准块」
 *（`{ type:'image', source_type:'base64', data, mime_type }`）在 Anthropic 侧
 * 会被 yield 两次（`_formatContentBlocks` 先按标准块转一次，又落进
 * `contentPart.type === 'image'` 分支再转一次），同一张图发两遍、
 * 第二遍的 media_type 还退化成 image/jpeg。所以不用它。
 */

/** 一张图片附件 */
export interface AiImageAttachment {
  /** image/png | image/jpeg | image/gif | image/webp */
  mime: string;
  /** base64 正文（**不含** `data:` 前缀） */
  data: string;
  /** 原始文件名，仅用于展示 */
  name?: string;
}

/**
 * 允许的 MIME
 *
 * 这四个是 OpenAI 与 Anthropic 都接受的交集 —— 传别的（比如 image/bmp、
 * image/svg+xml）要么被上游拒，要么被当纯文本丢掉。
 */
export const AI_IMAGE_ALLOWED_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

/** 单次提问最多带几张图 */
export const AI_IMAGE_MAX_COUNT = 4;

/**
 * 单张图片的 base64 长度上限
 *
 * 取 4.5M 字符 ≈ 3.4MB 二进制。Anthropic 单图上限 5MB，这里留了余量；
 * OpenAI 上限 20MB，不构成约束。真正决定体积的是渲染层那张 1568px 的缩略图，
 * 这个上限只是兜底 —— 防止绕开渲染层塞进来一张巨图把请求撑爆。
 */
export const AI_IMAGE_MAX_DATA_CHARS = 4_500_000;

/** 内容块 —— 与 LangChain 的 MessageContentComplex 对齐（这里只声明用到的两种） */
export type AiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/**
 * 把 base64 正文拼成 data URL
 *
 * 注意别在这里插换行 —— Anthropic 侧解析 data URL 用的是
 * `/^data:(\w+\/\w+);base64,([A-Za-z0-9+/]+=*)$/`，中间有空白就匹配不上。
 */
export function aiImageDataUrl(image: AiImageAttachment): string {
  return `data:${image.mime};base64,${image.data}`;
}

/** 解析 data URL → 附件；格式不对返回 null */
export function parseAiImageDataUrl(dataUrl: string): AiImageAttachment | null {
  const match = /^data:(\w+\/\w+);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl.trim());
  if (!match) return null;
  return { mime: match[1].toLowerCase(), data: match[2] };
}

/**
 * 校验并清洗一批附件
 *
 * 渲染层已经把图缩到 1568px 了，但 IPC 通道是外部输入 —— 主进程不能假设
 * 传进来的东西都合法。逐张检查：数量、MIME、base64 长度。
 *
 * 不合法的那张直接丢掉，而不是整批报错：用户一次拖进来 5 张，
 * 其中一张是 svg，没有理由让另外 4 张也发不出去。
 */
export function normalizeAiImages(raw: unknown): AiImageAttachment[] {
  if (!Array.isArray(raw)) return [];

  const result: AiImageAttachment[] = [];
  for (const item of raw) {
    if (result.length >= AI_IMAGE_MAX_COUNT) break;
    if (!item || typeof item !== 'object') continue;

    const candidate = item as Partial<AiImageAttachment>;
    const mime = typeof candidate.mime === 'string' ? candidate.mime.trim().toLowerCase() : '';
    const data = typeof candidate.data === 'string' ? candidate.data.trim() : '';

    if (!mime || !data) continue;
    if (!AI_IMAGE_ALLOWED_MIMES.includes(mime as any)) continue;
    // base64 只认这些字符；带空白/换行的一律丢掉
    if (!/^[A-Za-z0-9+/]+=*$/.test(data)) continue;
    if (data.length > AI_IMAGE_MAX_DATA_CHARS) continue;

    result.push({
      mime,
      data,
      name: typeof candidate.name === 'string' ? candidate.name : undefined,
    });
  }
  return result;
}

/** 附件 → 落库用的 JSON 字符串 */
export function serializeAiImages(images: AiImageAttachment[]): string {
  if (!images || images.length === 0) return '';
  return JSON.stringify(
    images.map((image) => ({
      mime: image.mime,
      data: image.data,
      ...(image.name ? { name: image.name } : {}),
    }))
  );
}

/** 落库的 JSON → 附件；结构不对就当没有 */
export function parseAiImages(raw: unknown): AiImageAttachment[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeAiImages(parsed);
  } catch {
    return [];
  }
}

/**
 * 图片 → 模型能吃的 content 块
 *
 * 图片排在文本前面：Anthropic 官方建议图片先于文本，MiniMax 的多模态示例
 * 也是这个顺序。顺序反过来两边都认，但按建议来省得踩坑。
 */
export function aiImageContentBlocks(images: AiImageAttachment[]): AiContentBlock[] {
  return images.map((image) => ({
    type: 'image_url' as const,
    image_url: { url: aiImageDataUrl(image) },
  }));
}

/**
 * 用户这一轮的完整 content
 *
 * 有图 → 返回块数组；没图 → 返回纯文本字符串。
 *
 * 没图时特意退回字符串而不是块数组：纯文本走字符串是所有 provider 都最稳的
 * 路径（Anthropic 对 content 数组里的空文本块会当成一次额外的输入）。
 */
export function buildUserContent(
  text: string,
  images: AiImageAttachment[]
): string | AiContentBlock[] {
  const trimmed = (text || '').trim();
  if (!images || images.length === 0) return trimmed;

  const blocks: AiContentBlock[] = aiImageContentBlocks(images);
  if (trimmed) blocks.push({ type: 'text', text: trimmed });
  return blocks;
}

/**
 * 从 content 里抽出纯文本
 *
 * content 可能是字符串，也可能是块数组（带图时）。压缩器、token 估算、
 * 会话预览都只认文本 —— 它们必须能处理「一条只有图没有字」的消息，
 * 不能因为 content 不是字符串就当成空内容。
 */
export function aiContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    if ((block as any).type === 'text' && typeof (block as any).text === 'string') {
      parts.push((block as any).text);
    }
  }
  return parts.join('\n');
}
