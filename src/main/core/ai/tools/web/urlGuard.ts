import { lookup } from "node:dns/promises";
import * as net from "node:net";

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => Number(part));
  if (nums.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [a, b] = nums;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const host = address.toLowerCase().split("%")[0];
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

export function isPrivateAddress(address: string): boolean {
  const host = address.trim().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (net.isIP(host) === 4) return isPrivateIpv4(host);
  if (net.isIP(host) === 6) return isPrivateIpv6(host);
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  return false;
}

export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("不是合法的 URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("只允许 http/https 链接");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isPrivateHostname(hostname)) {
    throw new Error(`目标地址 ${parsed.hostname} 是本机/内网地址，出于安全考虑不抓取`);
  }
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`目标地址 ${parsed.hostname} 是内网地址，出于安全考虑不抓取`);
    }
    return parsed;
  }

  let addresses: Array<{ address: string }> = [];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return parsed;
  }
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      throw new Error(
        `目标域名 ${hostname} 解析到内网地址 ${entry.address}，出于安全考虑不抓取`
      );
    }
  }
  return parsed;
}
