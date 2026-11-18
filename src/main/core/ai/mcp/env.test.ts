import { describe, expect, it } from "vitest";
import { expandArgs, expandRecord, expandTemplate } from "./env";

const lookup = (values: Record<string, string>) => (name: string) => values[name];

describe("expandTemplate", () => {
  it("没有变量时原样返回", () => {
    const result = expandTemplate("plain text", lookup({}));
    expect(result.ok).toBe(true);
    expect(result.value).toBe("plain text");
  });

  it("替换掉环境变量", () => {
    const result = expandTemplate("token is ${TOKEN}", lookup({ TOKEN: "abc" }));
    expect(result.ok).toBe(true);
    expect(result.value).toBe("token is abc");
  });

  it("带默认值时变量缺失也能展开", () => {
    const result = expandTemplate("${HOST:-127.0.0.1}", lookup({}));
    expect(result.ok).toBe(true);
    expect(result.value).toBe("127.0.0.1");
  });

  it("变量值为空串时也走默认值", () => {
    const result = expandTemplate("${HOST:-fallback}", lookup({ HOST: "" }));
    expect(result.ok).toBe(true);
    expect(result.value).toBe("fallback");
  });

  it("变量缺失时报出变量名且不回显取值", () => {
    const result = expandTemplate("Bearer ${MISSING_TOKEN}", lookup({}));
    expect(result.ok).toBe(false);
    expect(result.missing).toBe("MISSING_TOKEN");
    expect(result.value).toBe("");
  });
});

describe("expandRecord", () => {
  it("逐项展开", () => {
    const result = expandRecord(
      { Authorization: "Bearer ${TOKEN}" },
      lookup({ TOKEN: "t" })
    );
    expect(result.ok).toBe(true);
    expect(result.value.Authorization).toBe("Bearer t");
  });

  it("任意一项缺失就整体失败", () => {
    const result = expandRecord(
      { A: "${ONE}", B: "${TWO}" },
      lookup({ ONE: "1" })
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toBe("TWO");
  });

  it("空配置返回空对象", () => {
    const result = expandRecord(undefined, lookup({}));
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({});
  });
});

describe("expandArgs", () => {
  it("逐项展开参数", () => {
    const result = expandArgs(["--dir", "${ROOT}"], lookup({ ROOT: "D:/work" }));
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(["--dir", "D:/work"]);
  });

  it("参数里变量缺失时报错", () => {
    const result = expandArgs(["--dir", "${ROOT}"], lookup({}));
    expect(result.ok).toBe(false);
    expect(result.missing).toBe("ROOT");
  });
});
