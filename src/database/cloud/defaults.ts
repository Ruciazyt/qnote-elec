
export const DEFAULT_CLOUD_ENDPOINT = "https://qnote-catalog.810945981.workers.dev";

export function resolveDefaultEndpoint(): string {
  const fromEnv = process.env.QNOTE_CLOUD_ENDPOINT?.trim();
  if (fromEnv) return normalizeEndpoint(fromEnv);
  return normalizeEndpoint(DEFAULT_CLOUD_ENDPOINT);
}

export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}
