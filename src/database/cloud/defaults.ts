
import * as fs from "node:fs";
import type {
  CatalogConfig,
  CatalogDefaults,
} from "../../shared/cloud/cloudTypes";
import { getCatalogCredentialsPath } from "../../main/utils/paths";

const BUILTIN_CATALOG_BASE_URL = "https://ap-northeast-1.data.tidbcloud.com";
const BUILTIN_CATALOG_APP_ID = "dataapp-bPMzJOGk";

export interface CatalogCredentialFile {
  publicKey?: unknown;
  privateKey?: unknown;
}

export function readCatalogCredentialFile(
  filePath: string = getCatalogCredentialsPath()
): { publicKey: string; privateKey: string } {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath, "utf8")
    ) as CatalogCredentialFile;
    return {
      publicKey:
        typeof parsed.publicKey === "string" ? parsed.publicKey.trim() : "",
      privateKey:
        typeof parsed.privateKey === "string" ? parsed.privateKey.trim() : "",
    };
  } catch {
    return { publicKey: "", privateKey: "" };
  }
}

export function resolveDefaultCatalogConfig(): CatalogConfig | null {
  const file = readCatalogCredentialFile();
  const baseUrl = normalizeCatalogBaseUrl(
    process.env.QNOTE_CATALOG_BASE_URL ?? BUILTIN_CATALOG_BASE_URL
  );
  const appId = (process.env.QNOTE_CATALOG_APP_ID ?? BUILTIN_CATALOG_APP_ID).trim();
  const publicKey = (
    process.env.QNOTE_CATALOG_PUBLIC_KEY ?? file.publicKey
  ).trim();
  const privateKey = (
    process.env.QNOTE_CATALOG_PRIVATE_KEY ?? file.privateKey
  ).trim();

  if (!baseUrl || !appId || !publicKey || !privateKey) return null;
  return { baseUrl, appId, publicKey, privateKey };
}

export function resolveCatalogDefaults(): CatalogDefaults {
  return {
    baseUrl: normalizeCatalogBaseUrl(
      process.env.QNOTE_CATALOG_BASE_URL ?? BUILTIN_CATALOG_BASE_URL
    ),
    appId: (process.env.QNOTE_CATALOG_APP_ID ?? BUILTIN_CATALOG_APP_ID).trim(),
  };
}

export function normalizeCatalogBaseUrl(input: string): string {
  let url = input.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  while (url.endsWith("/")) url = url.slice(0, -1);
  return url;
}

export function sanitizeCatalogConfig(input: unknown): CatalogConfig | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Partial<CatalogConfig>;
  const baseUrl =
    typeof obj.baseUrl === "string" ? normalizeCatalogBaseUrl(obj.baseUrl) : "";
  const appId = typeof obj.appId === "string" ? obj.appId.trim() : "";
  const publicKey =
    typeof obj.publicKey === "string" ? obj.publicKey.trim() : "";
  const privateKey =
    typeof obj.privateKey === "string" ? obj.privateKey.trim() : "";
  if (!baseUrl || !appId || !publicKey || !privateKey) return null;
  return { baseUrl, appId, publicKey, privateKey };
}
