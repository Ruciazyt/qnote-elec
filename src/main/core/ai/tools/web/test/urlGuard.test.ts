// @vitest-environment node
/* eslint-disable sonarjs/no-hardcoded-ip -- 这里列的都是网段样例，用来找出内网拦截规则的边界，不是真实地址 */
import { describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { assertPublicUrl, isPrivateAddress } from "../urlGuard";
import { fetchText } from "../searchEngine";

describe("抓取地址的安全校验", () => {
  it("内网与回环地址都要拦下", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
  });

  it("本地地址与本地协议都拒绝", async () => {
    await expect(assertPublicUrl("http://127.0.0.1:7799/")).rejects.toThrow(/内网|回环/);
    await expect(assertPublicUrl("http://localhost/")).rejects.toThrow(/内网|回环/);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow();
  });

  it("抓取本机监听的服务会被挡住", async () => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("LEAKED-INTERNAL-CONTENT");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(
        fetchText(`http://127.0.0.1:${port}/`, { timeoutMs: 3000 })
      ).rejects.toThrow(/内网|回环/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
