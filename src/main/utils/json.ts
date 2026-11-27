export function isValidJson(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;

  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
