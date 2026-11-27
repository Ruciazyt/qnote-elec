// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import {
  computeExpectedSignature,
  decodeSigningKey,
  generateSigningToken,
  verifyWebhookSignature,
  SIGNING_TOKEN_PREFIX,
} from "../signature";

function sign(
  key: Buffer,
  messageId: string,
  timestamp: string,
  body: Buffer
): string {
  const signed = Buffer.concat([
    Buffer.from(`${messageId}.${timestamp}.`, "utf8"),
    body,
  ]);
  return `v1,${createHmac("sha256", key).update(signed).digest("base64")}`;
}

const KEY = randomBytes(32);
const TOKEN = `${SIGNING_TOKEN_PREFIX}${KEY.toString("base64")}`;

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe("GitLab webhook 签名校验", () => {
  it("生成的密钥是 whsec_ + 32 字节 base64", () => {
    const token = generateSigningToken();
    expect(token.startsWith(SIGNING_TOKEN_PREFIX)).toBe(true);
    const key = decodeSigningKey(token);
    expect(key).not.toBeNull();
    expect(key!.length).toBe(32);
  });

  it("密钥格式不对就拒", () => {
    expect(decodeSigningKey("not-a-signing-token")).toBeNull();
    expect(decodeSigningKey("")).toBeNull();
  });

  it("签名对的放行", () => {
    const body = Buffer.from('{"object_kind":"note"}', "utf8");
    const id = "msg-1";
    const ts = nowSeconds();
    const result = verifyWebhookSignature({
      signingToken: TOKEN,
      messageId: id,
      timestamp: ts,
      signatureHeader: sign(KEY, id, ts, body),
      rawBody: body,
    });
    expect(result.ok).toBe(true);
  });

  it("body 被改过就拒", () => {
    const body = Buffer.from('{"object_kind":"note"}', "utf8");
    const id = "msg-2";
    const ts = nowSeconds();
    const signature = sign(KEY, id, ts, body);
    const tampered = Buffer.from('{"object_kind":"issue"}', "utf8");
    const result = verifyWebhookSignature({
      signingToken: TOKEN,
      messageId: id,
      timestamp: ts,
      signatureHeader: signature,
      rawBody: tampered,
    });
    expect(result.ok).toBe(false);
  });

  it("签名不匹配就拒", () => {
    const body = Buffer.from("{}", "utf8");
    const id = "msg-3";
    const ts = nowSeconds();
    const other = randomBytes(32);
    const result = verifyWebhookSignature({
      signingToken: TOKEN,
      messageId: id,
      timestamp: ts,
      signatureHeader: sign(other, id, ts, body),
      rawBody: body,
    });
    expect(result.ok).toBe(false);
  });

  it("签名头里有多个候选时逐个比", () => {
    const body = Buffer.from("{}", "utf8");
    const id = "msg-4";
    const ts = nowSeconds();
    const other = randomBytes(32);
    const header = `${sign(other, id, ts, body)} ${sign(KEY, id, ts, body)}`;
    const result = verifyWebhookSignature({
      signingToken: TOKEN,
      messageId: id,
      timestamp: ts,
      signatureHeader: header,
      rawBody: body,
    });
    expect(result.ok).toBe(true);
  });

  it("时间戳超窗口就拒（防重放）", () => {
    const body = Buffer.from("{}", "utf8");
    const id = "msg-5";
    const ts = String(Math.floor(Date.now() / 1000) - 3600);
    const result = verifyWebhookSignature({
      signingToken: TOKEN,
      messageId: id,
      timestamp: ts,
      signatureHeader: sign(KEY, id, ts, body),
      rawBody: body,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("时间戳");
  });

  it("缺头就拒", () => {
    const body = Buffer.from("{}", "utf8");
    const ts = nowSeconds();
    expect(
      verifyWebhookSignature({
        signingToken: TOKEN,
        messageId: "",
        timestamp: ts,
        signatureHeader: "v1,abc",
        rawBody: body,
      }).ok
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        signingToken: TOKEN,
        messageId: "msg-6",
        timestamp: ts,
        signatureHeader: "",
        rawBody: body,
      }).ok
    ).toBe(false);
  });

  it("算出来的签名与手算的一致", () => {
    const body = Buffer.from("{}", "utf8");
    const id = "msg-7";
    const ts = "1795676165";
    expect(computeExpectedSignature(KEY, id, ts, body)).toBe(
      sign(KEY, id, ts, body)
    );
  });
});
