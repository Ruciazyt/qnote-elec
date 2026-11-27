import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SIGNING_TOKEN_PREFIX = "whsec_";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface VerifySignatureInput {
  signingToken: string;
  messageId: string;
  timestamp: string;
  signatureHeader: string;
  rawBody: Buffer;
  toleranceSeconds?: number;
}

export interface VerifySignatureResult {
  ok: boolean;
  reason: string;
}

export function generateSigningToken(): string {
  return `${SIGNING_TOKEN_PREFIX}${randomBytes(32).toString("base64")}`;
}

export function decodeSigningKey(signingToken: string): Buffer | null {
  const trimmed = signingToken.trim();
  if (!trimmed.startsWith(SIGNING_TOKEN_PREFIX)) return null;
  const encoded = trimmed.slice(SIGNING_TOKEN_PREFIX.length);
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  return key.length > 0 ? key : null;
}

export function computeExpectedSignature(
  key: Buffer,
  messageId: string,
  timestamp: string,
  rawBody: Buffer
): string {
  const signed = Buffer.concat([
    Buffer.from(`${messageId}.${timestamp}.`, "utf8"),
    rawBody,
  ]);
  const digest = createHmac("sha256", key).update(signed).digest("base64");
  return `v1,${digest}`;
}

export function verifyWebhookSignature(
  input: VerifySignatureInput
): VerifySignatureResult {
  const key = decodeSigningKey(input.signingToken);
  if (!key) {
    return { ok: false, reason: "签名密钥格式不对（应为 whsec_ + base64）" };
  }
  if (!input.messageId) {
    return { ok: false, reason: "缺 webhook-id 头" };
  }
  if (!input.signatureHeader) {
    return { ok: false, reason: "缺 webhook-signature 头" };
  }
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "webhook-timestamp 头不合法" };
  }
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(Date.now() / 1000 - timestamp) > tolerance) {
    return { ok: false, reason: "webhook 时间戳超出容忍窗口" };
  }

  const expected = computeExpectedSignature(
    key,
    input.messageId,
    input.timestamp,
    input.rawBody
  );
  for (const candidate of input.signatureHeader.split(" ").filter(Boolean)) {
    if (safeEqual(candidate, expected)) {
      return { ok: true, reason: "签名校验通过" };
    }
  }
  return { ok: false, reason: "签名不匹配" };
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
