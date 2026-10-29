/**
 * 图片附件的缩放与编码 —— 渲染层专用
 *
 * ## 为什么要在发送前缩图
 *
 * 一张 4K 截图原样 base64 化有 5~10MB，塞进请求体既慢又贵：
 * 多模态模型按「缩放后的 tile 数」计费，超大图会被切成几十个 tile，
 * 一次提问能烧掉几千 token。缩到 1568px（OpenAI / Anthropic 都推荐的
 * 上限）之后，token 成本降一个量级，肉眼看不出差别。
 *
 * ## 缩放策略
 *
 *   · 长边超过 1568px 才缩；本来就不大的图**不重新编码** ——
 *     重新编码一次就是一次有损操作，白白掉画质。
 *   · 输出格式跟着来源走：png 仍出 png（截图的文字要清晰），
 *     jpeg 仍出 jpeg（照片用 png 会体积暴涨），webp 仍出 webp。
 *   · gif 缩放后只能出 png（canvas 不支持编码 gif），
 *     代价是丢动画 —— 但一张动图被缩小后本来就没什么可看的。
 */

import {
  AI_IMAGE_ALLOWED_MIMES,
  parseAiImageDataUrl,
  type AiImageAttachment,
} from "@shared/aiImages";

/** 长边上限（像素） */
export const AI_IMAGE_MAX_DIMENSION = 1568;

/** JPEG 输出质量 */
const JPEG_QUALITY = 0.9;

/** 来源 MIME → 缩放后的输出 MIME。gif 没有对应编码，退到 png */
const OUTPUT_MIME: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
  "image/gif": "image/png",
};

/** 加载图片元素 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = src;
  });
}

/**
 * data URL → 附件
 *
 * data URL 里可能带 base64 的换行/空白（少数来源会这么干），
 * 正则要求严格，这里先清洗一遍再解析。
 */
export function dataUrlToAttachment(
  dataUrl: string,
  name?: string
): AiImageAttachment | null {
  const cleaned = dataUrl.replace(/\s+/g, "");
  const parsed = parseAiImageDataUrl(cleaned);
  if (!parsed) return null;
  return { ...parsed, name };
}

/** File → base64 data URL */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * 缩放并（必要时）重新编码一张图
 *
 * 已经是允许的 MIME 且尺寸不大 → 原样返回，不碰像素。
 */
export async function normalizeImageAttachment(
  image: AiImageAttachment
): Promise<AiImageAttachment> {
  const allowed = (AI_IMAGE_ALLOWED_MIMES as readonly string[]).includes(image.mime);
  const dataUrl = `data:${image.mime};base64,${image.data}`;

  let img: HTMLImageElement;
  try {
    img = await loadImage(dataUrl);
  } catch {
    // 解码失败就按原样返回 —— 让主进程那道校验去拒它
    return image;
  }

  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  if (!naturalWidth || !naturalHeight) return image;

  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > AI_IMAGE_MAX_DIMENSION ? AI_IMAGE_MAX_DIMENSION / longest : 1;
  const needsResize = scale < 1;

  // 尺寸合适且格式被允许 —— 不重新编码，避免白白掉画质
  if (!needsResize && allowed) return image;

  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;

  const outMime = OUTPUT_MIME[image.mime] ?? "image/png";
  if (outMime === "image/jpeg") {
    // JPEG 没有透明通道，不铺底的话透明区域会变黑
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);

  let outDataUrl: string;
  try {
    outDataUrl = canvas.toDataURL(outMime, JPEG_QUALITY);
  } catch {
    return image;
  }
  const parsed = dataUrlToAttachment(outDataUrl, image.name);
  if (!parsed) return image;

  return parsed;
}

/**
 * File → 附件（读文件 → 缩放）
 */
export async function fileToAttachment(
  file: File
): Promise<AiImageAttachment | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const attachment = dataUrlToAttachment(dataUrl, file.name);
    if (!attachment) return null;
    return await normalizeImageAttachment(attachment);
  } catch {
    return null;
  }
}

/**
 * 一批 File → 一批附件（跳过读不出来的）
 */
export async function filesToAttachments(
  files: File[]
): Promise<AiImageAttachment[]> {
  const results = await Promise.all(files.map((file) => fileToAttachment(file)));
  return results.filter((item): item is AiImageAttachment => item !== null);
}
