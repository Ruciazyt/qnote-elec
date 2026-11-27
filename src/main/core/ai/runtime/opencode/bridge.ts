import type { AiImageAttachment } from "../../../../../shared/ai/aiImages";
import { DEFAULT_MODELS, type NormalizedProvider } from "../../types";
import { resolveBaseUrl } from "../../providers";
import type { OpencodePartInput } from "./protocol";
import type { OpencodeProviderEntry } from "./workspace";

export const QNOTE_PROVIDER_ID = "qnote";

export interface OpencodeProviderConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export function toOpencodeProvider(
  config: OpencodeProviderConfig
): OpencodeProviderEntry {
  const normalized: NormalizedProvider =
    config.provider === "claude" ? "claude" : "openai";
  return {
    id: QNOTE_PROVIDER_ID,
    npm:
      normalized === "claude"
        ? "@ai-sdk/anthropic"
        : "@ai-sdk/openai-compatible",
    name: "QNote",
    apiKey: config.apiKey,
    baseURL: resolveBaseUrl(config.baseUrl, normalized),
    model: config.model?.trim() || DEFAULT_MODELS[normalized],
  };
}

export interface OpencodePartsInput {
  message: string;
  images?: AiImageAttachment[];
  memoryBlock?: string;
  skillMessages?: Array<{ role: "system" | "user"; content: string }> | null;
}

export function buildOpencodeParts(input: OpencodePartsInput): OpencodePartInput[] {
  const parts: OpencodePartInput[] = [];

  if (input.memoryBlock) {
    parts.push({ type: "text", text: input.memoryBlock });
  }

  for (const skill of input.skillMessages ?? []) {
    if (skill.content) parts.push({ type: "text", text: skill.content });
  }

  for (const image of input.images ?? []) {
    parts.push({
      type: "file",
      mime: image.mime,
      filename: image.name,
      url: `data:${image.mime};base64,${image.data}`,
    });
  }

  parts.push({ type: "text", text: (input.message || "").trim() });
  return parts;
}
