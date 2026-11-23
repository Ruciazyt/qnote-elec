// @vitest-environment node
import { describe, it, expect } from "vitest";

import {
  checkPluginDependencies,
  formatDependencyIssues,
  parseDependencySpec,
} from "./pluginDependencies";

describe("插件依赖解析", () => {
  it("只有 id 的写法解析出 id，不带版本范围", () => {
    const spec = parseDependencySpec("a.b");
    expect(spec).not.toBeNull();
    expect(spec!.id).toBe("a.b");
    expect(spec!.range).toBeUndefined();
  });

  it("带版本范围的写法拆成 id 与范围", () => {
    const spec = parseDependencySpec("a.b@^1.0.0");
    expect(spec).not.toBeNull();
    expect(spec!.id).toBe("a.b");
    expect(spec!.range).toBe("^1.0.0");
  });

  it("写法不对的依赖解析不出来", () => {
    expect(parseDependencySpec("")).toBeNull();
    expect(parseDependencySpec("nodots")).toBeNull();
    expect(parseDependencySpec("a.b@")).toBeNull();
  });

  it("依赖都在且版本满足时放行", () => {
    const installed = new Map([
      ["a.b", "1.2.0"],
      ["c.d", "2.0.0"],
    ]);
    const report = checkPluginDependencies(["a.b@^1.0.0", "c.d"], installed);
    expect(report.ok).toBe(true);
    expect(report.issues.length).toBe(0);
  });

  it("依赖缺失时报出缺哪个", () => {
    const report = checkPluginDependencies(["a.b@^1.0.0"], new Map());
    expect(report.ok).toBe(false);
    expect(report.issues.length).toBe(1);
    expect(report.issues[0].reason).toBe("missing");
    expect(report.issues[0].spec.id).toBe("a.b");
  });

  it("版本不满足时报出现装版本与要求的范围", () => {
    const report = checkPluginDependencies(
      ["a.b@^2.0.0"],
      new Map([["a.b", "1.0.0"]])
    );
    expect(report.ok).toBe(false);
    expect(report.issues[0].reason).toBe("version");
    expect(report.issues[0].installedVersion).toBe("1.0.0");
  });

  it("错误提示里指明缺哪个插件，并给出手动去市场安装的指引", () => {
    const report = checkPluginDependencies(["a.b"], new Map());
    const message = formatDependencyIssues(report.issues);
    expect(message).toContain("a.b");
    expect(message).toContain("插件市场");
    expect(message).toContain("手动");
  });

  it("版本不满足时的提示里带上了范围与当前版本", () => {
    const report = checkPluginDependencies(
      ["a.b@^2.0.0"],
      new Map([["a.b", "1.0.0"]])
    );
    const message = formatDependencyIssues(report.issues);
    expect(message).toContain("a.b");
    expect(message).toContain("^2.0.0");
    expect(message).toContain("1.0.0");
  });
});
