import { describe, it, expect } from "vitest";
import {
  PLUGIN_MANIFEST_FILENAME,
  buildPluginCommandLine,
  isValidPluginId,
  parsePluginManifest,
  parseSemver,
  satisfiesRange,
} from "./pluginManifest";

function base(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "demo.my-plugin",
    name: "演示插件",
    version: "1.0.0",
    publisher: "demo",
    engines: { qnote: "^2.0.0" },
    runtime: { command: "node server.js" },
    ...extra,
  };
}

describe("清单解析 parsePluginManifest", () => {
  it("接受一份合法清单", () => {
    const result = parsePluginManifest(
      JSON.stringify(
        base({
          description: "一个演示插件",
          runtime: {
            command: "node server.js",
            args: ["--port", "3000"],
            cwd: ".",
            env: { NODE_ENV: "production" },
            preview: { type: "port", port: 5173 },
          },
          capabilities: { process: { spawn: true } },
        })
      )
    );

    expect(result.error).toBeUndefined();
    expect(result.manifest?.id).toBe("demo.my-plugin");
    expect(result.manifest?.version).toBe("1.0.0");
    expect(result.manifest?.runtime.command).toBe("node server.js");
    expect(result.manifest?.runtime.preview).toEqual({ type: "port", port: 5173 });
    expect(result.manifest?.capabilities?.process?.spawn).toBe(true);
  });

  it("JSON 语法错误时给出可读提示，并保留原文", () => {
    const raw = "{ name: '少了引号' }";
    const result = parsePluginManifest(raw);

    expect(result.manifest).toBeNull();
    expect(result.error).toContain(PLUGIN_MANIFEST_FILENAME);
    expect(result.error).toContain("不是合法的 JSON");
    expect(result.raw).toBe(raw);
  });

  it("顶层不是对象时报错", () => {
    expect(parsePluginManifest("[]").error).toContain("顶层必须是一个对象");
    expect(parsePluginManifest("null").error).toContain("顶层必须是一个对象");
  });

  it("必填项缺一个就报错，并指出缺哪个", () => {
    expect(parsePluginManifest(JSON.stringify({ ...base(), id: undefined })).error).toContain(
      "id 是必填项"
    );
    expect(parsePluginManifest(JSON.stringify({ ...base(), name: undefined })).error).toContain(
      "name 是必填项"
    );
    expect(
      parsePluginManifest(JSON.stringify({ ...base(), version: undefined })).error
    ).toContain("version 是必填项");
    expect(
      parsePluginManifest(JSON.stringify({ ...base(), publisher: undefined })).error
    ).toContain("publisher 是必填项");
    expect(
      parsePluginManifest(JSON.stringify({ ...base(), engines: undefined })).error
    ).toContain("engines 是必填项");
  });

  it("id 必须是 publisher.name 格式", () => {
    expect(parsePluginManifest(JSON.stringify(base({ id: "nodots" }))).error).toContain(
      "publisher.name"
    );
    expect(parsePluginManifest(JSON.stringify(base({ id: "a..b" }))).error).toContain(
      "publisher.name"
    );
    expect(parsePluginManifest(JSON.stringify(base({ id: "Demo.Plugin" }))).error).toContain(
      "publisher.name"
    );
    expect(isValidPluginId("demo.my-plugin")).toBe(true);
    expect(isValidPluginId("demo.my_plugin")).toBe(false);
  });

  it("version 必须是语义化版本", () => {
    expect(parsePluginManifest(JSON.stringify(base({ version: "1.0" }))).error).toContain(
      "语义化版本"
    );
    expect(parsePluginManifest(JSON.stringify(base({ version: "1.0.0" }))).error).toBeUndefined();
  });

  it("command 与 preview 至少要填一个", () => {
    const result = parsePluginManifest(
      JSON.stringify(base({ runtime: { command: undefined } }))
    );
    expect(result.manifest).toBeNull();
    expect(result.error).toContain("至少要填一个");
  });

  it("只填 preview 也算合法（纯预览型插件）", () => {
    const result = parsePluginManifest(
      JSON.stringify(base({ runtime: { preview: { type: "path", path: "index.html" } } }))
    );
    expect(result.manifest).not.toBeNull();
    expect(result.manifest?.runtime.command).toBeUndefined();
  });

  it("preview 只认对象形式", () => {
    expect(
      parsePluginManifest(
        JSON.stringify(base({ runtime: { preview: 5173 } }))
      ).error
    ).toContain("runtime.preview");
    expect(
      parsePluginManifest(
        JSON.stringify(base({ runtime: { preview: { type: "port", port: 5173 } } }))
      ).error
    ).toBeUndefined();
    expect(
      parsePluginManifest(
        JSON.stringify(base({ runtime: { preview: { type: "port", port: 0 } } }))
      ).error
    ).toContain("runtime.preview");
  });

  it("字段类型不对时逐个报错", () => {
    const runtime = (value: unknown) =>
      parsePluginManifest(JSON.stringify(base({ runtime: value }))).error ?? "";
    expect(runtime({ command: 123 })).toContain("runtime.command 必须是字符串");
    expect(runtime({ command: "x", args: "不是数组" })).toContain("runtime.args");
    expect(runtime({ command: "x", env: [] })).toContain("runtime.env");
    expect(runtime({ command: "x", cwd: {} })).toContain("runtime.cwd");
  });

  it("env 的值必须能转成字符串（数字与布尔可以）", () => {
    const ok = parsePluginManifest(
      JSON.stringify(base({ runtime: { command: "node x.js", env: { PORT: 3000, DEBUG: true } } }))
    );
    expect(ok.manifest?.runtime.env).toEqual({ PORT: "3000", DEBUG: "true" });

    const bad = parsePluginManifest(
      JSON.stringify(base({ runtime: { command: "node x.js", env: { NESTED: { a: 1 } } } }))
    );
    expect(bad.manifest).toBeNull();
    expect(bad.error).toContain("runtime.env.NESTED 必须是字符串");
  });

  it("capabilities 里出现未知的能力名就拒绝", () => {
    const result = parsePluginManifest(
      JSON.stringify(base({ capabilities: { telepathy: true } }))
    );
    expect(result.manifest).toBeNull();
    expect(result.error).toContain("不是已知的能力名");
  });

  it("capabilities.qnote 的取值只能是 none/read/write", () => {
    const bad = parsePluginManifest(
      JSON.stringify(base({ capabilities: { qnote: { notes: "delete" } } }))
    );
    expect(bad.manifest).toBeNull();
    expect(bad.error).toContain("capabilities.qnote.notes");

    const ok = parsePluginManifest(
      JSON.stringify(base({ capabilities: { qnote: { notes: "read", clipboard: "read" } } }))
    );
    expect(ok.error).toBeUndefined();
  });

  it("contributes 里的命令缺 title 就报错", () => {
    const bad = parsePluginManifest(
      JSON.stringify(base({ contributes: { commands: [{ command: "x.y" }] } }))
    );
    expect(bad.manifest).toBeNull();
    expect(bad.error).toContain("缺少 title");
  });

  it("command 为空串时报错，过长也拒绝", () => {
    expect(
      parsePluginManifest(JSON.stringify(base({ runtime: { command: "   " } }))).error
    ).toContain("runtime.command 不能为空");
    expect(
      parsePluginManifest(JSON.stringify(base({ runtime: { command: "x".repeat(2001) } })))
        .error
    ).toContain("runtime.command 太长了");
  });

  it("未知字段直接丢弃，不让老清单失效", () => {
    const result = parsePluginManifest(
      JSON.stringify(base({ runtime: { command: "node x.js", futureField: "以后加的" } }))
    );
    expect(result.manifest?.runtime.command).toBe("node x.js");
    expect((result.manifest?.runtime as Record<string, unknown>).futureField).toBeUndefined();
  });
});

describe("命令行拼装 buildPluginCommandLine", () => {
  it("不带 args 时就是 command 本身", () => {
    expect(buildPluginCommandLine({ command: "node server.js" })).toBe("node server.js");
  });

  it("普通参数原样拼接", () => {
    expect(
      buildPluginCommandLine({ command: "node server.js", args: ["--port", "3000"] })
    ).toBe("node server.js --port 3000");
  });

  it("带空格的参数加引号", () => {
    expect(
      buildPluginCommandLine({ command: "node server.js", args: ["--title", "我的 应用"] })
    ).toBe('node server.js --title "我的 应用"');
  });

  it("没有 command 时不产出多余空格", () => {
    expect(buildPluginCommandLine({})).toBe("");
  });
});

describe("版本与版本范围", () => {
  it("能解析语义化版本", () => {
    expect(parseSemver("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("v1.2.3")).not.toBeNull();
  });

  it("^ 只在主版本内浮动", () => {
    expect(satisfiesRange("2.0.5", "^2.0.0")).toBe(true);
    expect(satisfiesRange("2.1.0", "^2.0.0")).toBe(true);
    expect(satisfiesRange("3.0.0", "^2.0.0")).toBe(false);
    expect(satisfiesRange("1.9.9", "^2.0.0")).toBe(false);
  });

  it("^0.x 只在次版本内浮动", () => {
    expect(satisfiesRange("0.2.9", "^0.2.0")).toBe(true);
    expect(satisfiesRange("0.3.0", "^0.2.0")).toBe(false);
  });

  it("~ 只在次版本内浮动", () => {
    expect(satisfiesRange("1.2.9", "~1.2.0")).toBe(true);
    expect(satisfiesRange("1.3.0", "~1.2.0")).toBe(false);
  });

  it("比较符与多选", () => {
    expect(satisfiesRange("2.1.0", ">=2.0.0")).toBe(true);
    expect(satisfiesRange("1.9.0", ">=2.0.0")).toBe(false);
    expect(satisfiesRange("2.0.0", "^1.0.0 || ^2.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", "*")).toBe(true);
  });

  it("裸版本号按范围理解，通配写法也算", () => {
    expect(satisfiesRange("1.5.0", "1")).toBe(true);
    expect(satisfiesRange("2.0.0", "1")).toBe(false);
    expect(satisfiesRange("1.2.9", "1.2")).toBe(true);
    expect(satisfiesRange("1.3.0", "1.2")).toBe(false);
    expect(satisfiesRange("1.9.9", "1.x")).toBe(true);
    expect(satisfiesRange("2.0.0", "1.x")).toBe(false);
    expect(satisfiesRange("1.2.9", "1.2.x")).toBe(true);
    expect(satisfiesRange("1.3.0", "1.2.x")).toBe(false);
    expect(satisfiesRange("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.4", "1.2.3")).toBe(false);
  });

  it("预发布版本要有同元组的预发布锚点才匹配", () => {
    expect(satisfiesRange("1.5.0-beta.1", "^1.0.0")).toBe(false);
    expect(satisfiesRange("1.0.0-beta.1", "^1.0.0")).toBe(false);
    expect(satisfiesRange("1.0.0-beta.1", "^1.0.0-alpha")).toBe(true);
    expect(satisfiesRange("1.0.0-beta.1", ">=1.0.0-alpha <2.0.0")).toBe(true);
    expect(satisfiesRange("1.0.0", "^1.0.0")).toBe(true);
  });
});
