import { describe, it, expect } from "vitest";
import { evaluateUpgrade } from "./pluginUpgrade";

describe("市场升级判定", () => {
  it("发布版本更高 → 可以升级", () => {
    const decision = evaluateUpgrade("1.0.0", "1.1.0");
    expect(decision.available).toBe(true);
    expect(decision.reason).toBe("available");
  });

  it("版本相同 → 不用升级", () => {
    const decision = evaluateUpgrade("1.0.0", "1.0.0");
    expect(decision.available).toBe(false);
    expect(decision.reason).toBe("same-version");
  });

  it("装的是更新的版本 → 不用降级", () => {
    const decision = evaluateUpgrade("2.0.0", "1.9.9");
    expect(decision.available).toBe(false);
    expect(decision.reason).toBe("installed-newer");
  });

  it("当前没装 → 算可安装", () => {
    const decision = evaluateUpgrade("", "1.0.0");
    expect(decision.available).toBe(true);
  });

  it("发布记录没有版本 → 判不了", () => {
    const decision = evaluateUpgrade("1.0.0", "");
    expect(decision.available).toBe(false);
    expect(decision.reason).toBe("unknown-version");
  });

  it("版本号不是 semver 且两边不同 → 允许更新", () => {
    const decision = evaluateUpgrade("nightly", "nightly-2");
    expect(decision.available).toBe(true);
  });

  it("版本号不是 semver 且两边相同 → 不用更新", () => {
    const decision = evaluateUpgrade("nightly", "nightly");
    expect(decision.available).toBe(false);
    expect(decision.reason).toBe("same-version");
  });

  it("预发布版本比正式版本低", () => {
    expect(evaluateUpgrade("1.0.0", "1.0.0-beta.1").available).toBe(false);
    expect(evaluateUpgrade("1.0.0-beta.1", "1.0.0").available).toBe(true);
  });
});
