
export function contentHash(content: string): string {
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
