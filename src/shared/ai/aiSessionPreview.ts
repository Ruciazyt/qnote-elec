
export const SESSION_PREVIEW_MAX = 80;

export function buildSessionPreview(
  text: string | null | undefined,
  max: number = SESSION_PREVIEW_MAX
): string {
  const cleaned = String(text ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<think>[\s\S]*$/i, " ")
    .replace(/<\/?think>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}
