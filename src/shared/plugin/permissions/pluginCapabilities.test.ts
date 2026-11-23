import { describe, it, expect } from "vitest";
import {
  describeCapabilityEntries,
  grantKeysForCapabilities,
  dataGrantKey,
} from "./pluginCapabilities";
import type { PluginCapabilities } from "../manifest/pluginTypes";

describe("插件能力与授权项的对应", () => {
  it("没声明能力时没有授权项", () => {
    let missing: PluginCapabilities | undefined;
    expect(grantKeysForCapabilities(missing)).toEqual([]);
    expect(grantKeysForCapabilities({})).toEqual([]);
  });

  it("进程与网络能力各算一项", () => {
    const keys = grantKeysForCapabilities({
      process: { spawn: true, env: ["QNOTE_MANAGED"] },
      network: ["127.0.0.1:*"],
    });
    expect(keys).toEqual(["process.spawn", "process.env", "network"]);
  });

  it("声明成 read 的数据能力只生成读一项", () => {
    expect(
      grantKeysForCapabilities({ qnote: { notes: "read", todos: "read" } })
    ).toEqual(["qnote.notes.read", "qnote.todos.read"]);
  });

  it("声明成 write 的数据能力生成读与写两项", () => {
    expect(grantKeysForCapabilities({ qnote: { notes: "write" } })).toEqual([
      "qnote.notes.read",
      "qnote.notes.write",
    ]);
  });

  it("AI 只有读一项，没有写入", () => {
    expect(grantKeysForCapabilities({ qnote: { ai: "write" } })).toEqual([
      "qnote.ai.read",
    ]);
  });

  it("每一项都有中文说明与分组", () => {
    const entries = describeCapabilityEntries({
      process: { spawn: true },
      qnote: { notes: "read" },
    });
    expect(entries).toEqual([
      { key: "process.spawn", area: "进程", detail: "启动子进程" },
      { key: "qnote.notes.read", area: "QNote 数据", detail: "读取笔记" },
    ]);
  });

  it("数据能力的授权项键按 area 与 access 拼", () => {
    expect(dataGrantKey("notes", "read")).toBe("qnote.notes.read");
    expect(dataGrantKey("clipboard", "read")).toBe("qnote.clipboard.read");
    expect(dataGrantKey("ai", "read")).toBe("qnote.ai.read");
  });
});
