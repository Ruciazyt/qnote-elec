
export interface AiImageAttachment {
  mime: string;
  data: string;
  name?: string;
}

export const AI_IMAGE_ALLOWED_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export const AI_IMAGE_MAX_COUNT = 4;

export const AI_IMAGE_MAX_DATA_CHARS = 4_500_000;

export type AiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export function aiImageDataUrl(image: AiImageAttachment): string {
  return `data:${image.mime};base64,${image.data}`;
}

export function parseAiImageDataUrl(dataUrl: string): AiImageAttachment | null {
  const match = /^data:(\w+\/\w+);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl.trim());
  if (!match) return null;
  return { mime: match[1].toLowerCase(), data: match[2] };
}

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

export function aiImageContentBlocks(images: AiImageAttachment[]): AiContentBlock[] {
  return images.map((image) => ({
    type: 'image_url' as const,
    image_url: { url: aiImageDataUrl(image) },
  }));
}

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
