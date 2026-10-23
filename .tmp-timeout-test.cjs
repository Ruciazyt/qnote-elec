// 用真实的 createChatModel（编译后的 dist 产物）验证超时生效。
// mock 服务端只发 chunk、绝不结束 —— 复现线上「上游接受请求但响应不结束」的情况。
const http = require("http");
const {
  createChatModel,
  DEFAULT_REQUEST_TIMEOUT_MS,
  VALIDATE_REQUEST_TIMEOUT_MS,
  VALIDATE_MAX_RETRIES,
} = require("./dist/main/utils/ai/providers.js");

function makeServer(mode) {
  return http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      if (mode === "no-response") return; // 连响应头都不发，连接保持
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      res.write(
        'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m",' +
          '"choices":[{"index":0,"delta":{"content":"he"},"finish_reason":null}]}\n\n',
      );
      if (mode === "complete") {
        res.write("data: [DONE]\n\n");
        res.end();
      }
      // stall: 写完 chunk 后永不 end()
    });
  });
}

async function probe(label, options, mode) {
  const model = createChatModel(
    {
      provider: "openai",
      apiKey: "sk-test",
      model: "m",
      baseUrl: `http://127.0.0.1:${currentPort}/v1`,
    },
    50,
    options,
  );
  const t0 = Date.now();
  const outcome = await Promise.race([
    model
      .invoke([{ role: "user", content: "Hello" }])
      .then(() => "resolved")
      .catch((e) => "rejected(" + (e.name || "Error") + ")"),
    new Promise((r) => setTimeout(() => r("HANG(10s 未失败)"), 10000)),
  ]);
  console.log(`${label.padEnd(34)} -> ${outcome.padEnd(28)} 耗时 ${Date.now() - t0}ms`);
}

let port;
let currentPort;
(async () => {
  console.log(
    `默认超时=${DEFAULT_REQUEST_TIMEOUT_MS}ms 验证超时=${VALIDATE_REQUEST_TIMEOUT_MS}ms 验证重试=${VALIDATE_MAX_RETRIES}\n`,
  );

  const cases = [
    ["上游正常收尾 [DONE]", "complete"],
    ["上游完全不响应", "no-response"],
    ["上游发一半流后断气", "stall"],
  ];
  for (const [label, mode] of cases) {
    const srv = makeServer(mode);
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    currentPort = srv.address().port;
    console.log(`--- ${label} (端口 ${currentPort}) ---`);
    await probe(label, { timeoutMs: 3000, maxRetries: 0 }, mode);
    srv.closeAllConnections?.();
    srv.close();
    console.log("");
  }
  process.exit(0);
})();
