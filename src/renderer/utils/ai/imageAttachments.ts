
import {
  AI_IMAGE_ALLOWED_MIMES,
  parseAiImageDataUrl,
  type AiImageAttachment,
} from "@shared/ai/aiImages";

export const AI_IMAGE_MAX_DIMENSION = 1568;

const JPEG_QUALITY = 0.9;

const OUTPUT_MIME: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
  "image/gif": "image/png",
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = src;
  });
}

export function dataUrlToAttachment(
  dataUrl: string,
  name?: string
): AiImageAttachment | null {
  const cleaned = dataUrl.replace(/\s+/g, "");
  const parsed = parseAiImageDataUrl(cleaned);
  if (!parsed) return null;
  return { ...parsed, name };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

export async function normalizeImageAttachment(
  image: AiImageAttachment
): Promise<AiImageAttachment> {
  const allowed = (AI_IMAGE_ALLOWED_MIMES as readonly string[]).includes(image.mime);
  const dataUrl = `data:${image.mime};base64,${image.data}`;

  let img: HTMLImageElement;
  try {
    img = await loadImage(dataUrl);
  } catch {
    return image;
  }

  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  if (!naturalWidth || !naturalHeight) return image;

  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > AI_IMAGE_MAX_DIMENSION ? AI_IMAGE_MAX_DIMENSION / longest : 1;
  const needsResize = scale < 1;

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

export async function filesToAttachments(
  files: File[]
): Promise<AiImageAttachment[]> {
  const results = await Promise.all(files.map((file) => fileToAttachment(file)));
  return results.filter((item): item is AiImageAttachment => item !== null);
}
