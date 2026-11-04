// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  APP_MANIFEST_FILENAME,
  buildCommandLine,
  parseManifestText,
} from "./appManifest";

/**
 * 项目清单解析
 *
 * 清单是用户自己写的 JSON，出错方式五花八门。这里锁的是「哪些输入被接受、
 * 哪些被拒绝、拒绝时给的提示是否指向真正的问题」——
 * 提示写错了，用户会去改错的地方。
 *
 * 纯函数，不碰文件系统，也不需要 mock electron。
 */

describe("清单解析 parseManifestText", () => {
  it("接受一份合法清单", () => {
    const result = parseManifestText(
      JSON.stringify({
        name: "我的项目",
        description: "一个演示项目",
        command: "node server.js",
        args: ["--port", "3000"],
        cwd: "D:\\work\\demo",
        env: { NODE_ENV: "development" },
        preview: "http://127.0.0.1:5173",
      })
    );

    expect(result.manifest).toEqual({
      name: "我的项目",
      description: "一个演示项目",
      command: "node server.js",
      args: ["--port", "3000"],
      cwd: "D:\\work\\demo",
      env: { NODE_ENV: "development" },
      preview: "http://127.0.0.1:5173",
    });
    expect(result.error).toBeUndefined();
  });

  it("JSON 语法错误时给出可读提示，并保留原文", () => {
    const raw = "{ name: '少了引号' }";
    const result = parseManifestText(raw);

    expect(result.manifest).toBeNull();
    expect(result.error).toContain(APP_MANIFEST_FILENAME);
    expect(result.error).toContain("不是合法的 JSON");
    expect(result.raw).toBe(raw);
  });

  it("顶层不是对象时报错（数组与 null 都不行）", () => {
    expect(parseManifestText("[]").error).toContain("顶层必须是一个对象");
    expect(parseManifestText("null").error).toContain("顶层必须是一个对象");
    expect(parseManifestText('"一段文字"').error).toContain("顶层必须是一个对象");
  });

  it("command 与 preview 至少要填一个", () => {
    const result = parseManifestText(JSON.stringify({ name: "只有名字" }));

    expect(result.manifest).toBeNull();
    expect(result.error).toContain("至少要填一个");
  });

  it("只填 preview 也算合法（纯预览型项目）", () => {
    const result = parseManifestText(JSON.stringify({ preview: "http://127.0.0.1:5173" }));

    expect(result.manifest).toEqual({ preview: "http://127.0.0.1:5173" });
  });

  it("字段类型不对时逐个报错", () => {
    expect(parseManifestText(JSON.stringify({ command: 123 })).error).toContain(
      "command 必须是字符串"
    );
    expect(parseManifestText(JSON.stringify({ name: 42 })).error).toContain(
      "name 必须是字符串"
    );
    expect(parseManifestText(JSON.stringify({ preview: [] })).error).toContain(
      "preview 必须是字符串"
    );
    expect(parseManifestText(JSON.stringify({ cwd: {} })).error).toContain(
      "cwd 必须是字符串"
    );
    expect(parseManifestText(JSON.stringify({ args: "不是数组" })).error).toContain(
      "args 必须是字符串数组"
    );
    expect(parseManifestText(JSON.stringify({ env: [] })).error).toContain(
      "env 必须是一个对象"
    );
  });

  it("args 里混进非字符串就整份拒绝", () => {
    const result = parseManifestText(JSON.stringify({ command: "node x.js", args: ["ok", 7] }));

    expect(result.manifest).toBeNull();
    expect(result.error).toContain("args 必须是字符串数组");
  });

  it("env 的值必须能转成字符串（数字与布尔可以）", () => {
    const ok = parseManifestText(
      JSON.stringify({ command: "node x.js", env: { PORT: 3000, DEBUG: true } })
    );
    expect(ok.manifest?.env).toEqual({ PORT: "3000", DEBUG: "true" });

    const bad = parseManifestText(
      JSON.stringify({ command: "node x.js", env: { NESTED: { a: 1 } } })
    );
    expect(bad.manifest).toBeNull();
    expect(bad.error).toContain("env.NESTED 必须是字符串");
  });

  it("所有字符串去掉首尾空白", () => {
    const result = parseManifestText(
      JSON.stringify({
        name: "  名字  ",
        command: "  node server.js  ",
        cwd: "  D:\\work  ",
      })
    );

    expect(result.manifest?.name).toBe("名字");
    expect(result.manifest?.command).toBe("node server.js");
    expect(result.manifest?.cwd).toBe("D:\\work");
  });

  it("空字符串当没填（而不是报错）", () => {
    const result = parseManifestText(
      JSON.stringify({ command: "node x.js", name: "   ", cwd: "  ", preview: "" })
    );

    expect(result.manifest).toEqual({ command: "node x.js" });
    expect(result.error).toBeUndefined();
  });

  it("command 为空串时报错（不能当成没填）", () => {
    const result = parseManifestText(JSON.stringify({ command: "   " }));

    expect(result.manifest).toBeNull();
    expect(result.error).toContain("command 不能为空");
  });

  it("command 过长时拒绝（防止命令行被撑爆）", () => {
    const result = parseManifestText(JSON.stringify({ command: "x".repeat(2001) }));

    expect(result.manifest).toBeNull();
    expect(result.error).toContain("command 太长了");
  });

  it("未知字段直接丢弃，不让老清单失效", () => {
    const result = parseManifestText(
      JSON.stringify({ command: "node x.js", futureField: "以后加的", another: 1 })
    );

    expect(result.manifest).toEqual({ command: "node x.js" });
  });

  it("args 里空串被丢掉，全空则不写 args 字段", () => {
    const withEmpty = parseManifestText(
      JSON.stringify({ command: "node x.js", args: ["  ", "--flag"] })
    );
    expect(withEmpty.manifest?.args).toEqual(["--flag"]);

    const allEmpty = parseManifestText(JSON.stringify({ command: "node x.js", args: ["", "  "] }));
    expect(allEmpty.manifest).toEqual({ command: "node x.js" });
  });
});

describe("命令行拼装 buildCommandLine", () => {
  it("不带 args 时就是 command 本身", () => {
    expect(buildCommandLine({ command: "node server.js" })).toBe("node server.js");
  });

  it("普通参数原样拼接", () => {
    expect(buildCommandLine({ command: "node server.js", args: ["--port", "3000"] })).toBe(
      "node server.js --port 3000"
    );
  });

  it("带空格的参数加引号（否则会被 shell 拆成几个）", () => {
    expect(
      buildCommandLine({ command: "node server.js", args: ["--title", "我的 应用"] })
    ).toBe('node server.js --title "我的 应用"');
  });

  it("参数里的双引号被转义", () => {
    expect(buildCommandLine({ command: "node x.js", args: ['say "hi"'] })).toBe(
      'node x.js "say \\"hi\\""'
    );
  });

  it("没有 command 时不产出多余空格", () => {
    expect(buildCommandLine({})).toBe("");
    expect(buildCommandLine({ args: ["--flag"] })).toBe("--flag");
  });
});
