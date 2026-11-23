// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import knexFactory, { type Knex } from "knex";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "2.0.0-test",
    isPackaged: false,
  },
}));

import { PluginManager } from "../runtime/pluginManager";
import { PluginHostApi } from "./hostApi";
import { syncPluginGrants, setPluginGrant } from "../permissions/pluginGrants";
import { setToolContext } from "../../ai/toolContext";
import { aiService } from "../../ai/aiService";
import { configManager } from "../../system/config";
import type { FileWriter } from "../../notes/fileWriter";
import type { PluginManifest } from "../../../../shared/plugin/manifest/pluginTypes";
import type { RpcSession } from "./rpcServer";

const PLUGIN_ID = "demo.my-plugin";

const MANIFEST: PluginManifest = {
  id: PLUGIN_ID,
  name: "小工具",
  version: "1.0.0",
  publisher: "demo",
  engines: { qnote: "^2.0.0" },
  runtime: { command: "node index.js" },
  capabilities: {
    process: { spawn: true },
    qnote: {
      notes: "write",
      todos: "write",
      clipboard: "read",
      ai: "read",
    },
  },
};

async function createSchema(DB: Knex): Promise<void> {
  await DB.schema.createTable("plugin", (table) => {
    table.increments("local_id").primary();
    table.text("id").notNullable().unique();
    table.text("name").notNullable();
    table.text("version").notNullable().defaultTo("0.0.1");
    table.text("publisher").notNullable().defaultTo("");
    table.text("description");
    table.text("path").notNullable().unique();
    table.string("status").notNullable().defaultTo("missing-manifest");
    table.text("manifest_text");
    table.text("command");
    table.text("preview");
    table.text("error");
    table.text("runtime_json");
    table.text("capabilities_json");
    table.text("contributes_json");
    table.string("origin").notNullable().defaultTo("local");
    table.integer("enabled").notNullable().defaultTo(1);
    table.string("confirmed_manifest_hash").notNullable().defaultTo("");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("created_at").defaultTo(DB.fn.now());
    table.timestamp("updated_at").defaultTo(DB.fn.now());
  });
  await DB.schema.createTable("plugin_setting", (table) => {
    table.text("plugin_id").notNullable();
    table.text("key").notNullable();
    table.text("value");
    table.primary(["plugin_id", "key"]);
  });
  await DB.schema.createTable("plugin_grant", (table) => {
    table.text("plugin_id").notNullable();
    table.text("capability").notNullable();
    table.integer("granted").notNullable().defaultTo(0);
    table.timestamp("granted_at");
    table.primary(["plugin_id", "capability"]);
  });
  await DB.schema.createTable("todo", (table) => {
    table.increments("id").primary();
    table.text("title").notNullable();
    table.text("notes");
    table.string("priority").defaultTo("medium");
    table.timestamp("due_date");
    table.boolean("completed").defaultTo(false);
    table.timestamp("completed_at");
    table.timestamp("created_at").defaultTo(DB.fn.now());
    table.timestamp("updated_at").defaultTo(DB.fn.now());
    table.text("attachments").defaultTo("[]");
    table.timestamp("archived_at");
  });
  await DB.schema.createTable("note", (table) => {
    table.increments("id").primary();
    table.text("content").notNullable();
    table.string("type").defaultTo("text");
    table.text("content_hash");
    table.text("ocr_result");
    table.timestamp("created_at").defaultTo(DB.fn.now());
    table.timestamp("updated_at").defaultTo(DB.fn.now());
  });
}

describe("宿主 API 面的权限判定", () => {
  let DB: Knex;
  let manager: PluginManager;
  let api: PluginHostApi;
  let session: RpcSession;
  let noteRoot: string;

  beforeEach(async () => {
    DB = knexFactory({
      client: "sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await createSchema(DB);

    manager = new PluginManager(DB);
    manager.setHostVersion("2.0.0");
    api = new PluginHostApi(manager);

    noteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-plugin-notes-"));
    fs.writeFileSync(path.join(noteRoot, "方案.md"), "# 方案", "utf-8");
    setToolContext({
      DB,
      notes: { getFilePath: async () => noteRoot } as unknown as FileWriter,
    });

    await syncPluginGrants(DB, PLUGIN_ID, MANIFEST.capabilities);

    session = {
      pluginId: PLUGIN_ID,
      token: "token",
      manifest: MANIFEST,
      createdAt: Date.now(),
      connected: true,
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await manager.dispose();
    await DB.destroy();
    fs.rmSync(noteRoot, { recursive: true, force: true });
  });

  function withCapabilities(
    capabilities: PluginManifest["capabilities"]
  ): void {
    session = { ...session, manifest: { ...MANIFEST, capabilities } };
  }

  describe("声明之外的能力一律拒绝", () => {
    it("没声明笔记权限时读笔记被拒", async () => {
      withCapabilities({ process: { spawn: true } });
      await expect(
        api.handlePluginCall(session, "qnote.notes.get", { path: "方案.md" })
      ).rejects.toThrow(/没有声明访问笔记的权限/);
    });

    it("越权被拒不弹窗，但会记进插件日志", async () => {
      withCapabilities({ process: { spawn: true } });
      await expect(
        api.handlePluginCall(session, "qnote.notes.get", { path: "方案.md" })
      ).rejects.toThrow(/没有声明访问笔记的权限/);

      const logs = manager.getLogs(PLUGIN_ID);
      expect(
        logs.some(
          (line) =>
            line.stream === "stderr" &&
            line.text.includes("没有声明访问笔记的权限") &&
            line.text.includes("qnote.notes.get")
        )
      ).toBe(true);
    });

    it("没声明待办权限时新建待办被拒", async () => {
      withCapabilities({ process: { spawn: true } });
      await expect(
        api.handlePluginCall(session, "qnote.todos.create", { title: "买菜" })
      ).rejects.toThrow(/没有声明访问待办的权限/);
    });

    it("没声明待办写权限时改待办被拒", async () => {
      withCapabilities({ qnote: { todos: "read" } });
      await expect(
        api.handlePluginCall(session, "qnote.todos.update", { id: 1 })
      ).rejects.toThrow(/只有待办的只读权限/);
    });

    it("没声明剪贴板权限时读剪贴板被拒", async () => {
      withCapabilities({ process: { spawn: true } });
      await expect(
        api.handlePluginCall(session, "qnote.clipboard.list", {})
      ).rejects.toThrow(/没有声明访问剪贴板的权限/);
    });

    it("没声明 AI 权限时调 AI 被拒", async () => {
      withCapabilities({ process: { spawn: true } });
      await expect(
        api.handlePluginCall(session, "qnote.ai.chat", { message: "在吗" })
      ).rejects.toThrow(/没有声明访问AI的权限/);
    });
  });

  describe("授权被撤销后对应调用立刻失败", () => {
    it("撤销读笔记后，qnote.notes.get 立刻失败并记进插件日志", async () => {
      await setPluginGrant(DB, PLUGIN_ID, "qnote.notes.read", false);

      await expect(
        api.handlePluginCall(session, "qnote.notes.get", { path: "方案.md" })
      ).rejects.toThrow(/已被撤销/);

      const logs = manager.getLogs(PLUGIN_ID);
      expect(
        logs.some(
          (line) =>
            line.stream === "stderr" && line.text.includes("权限「读取笔记」已被撤销")
        )
      ).toBe(true);
    });

    it("撤销写待办后，qnote.todos.create 立刻失败", async () => {
      await setPluginGrant(DB, PLUGIN_ID, "qnote.todos.write", false);
      await expect(
        api.handlePluginCall(session, "qnote.todos.create", { title: "买菜" })
      ).rejects.toThrow(/已被撤销/);
    });

    it("撤销写笔记后，qnote.notes.create 立刻失败", async () => {
      await setPluginGrant(DB, PLUGIN_ID, "qnote.notes.write", false);
      await expect(
        api.handlePluginCall(session, "qnote.notes.create", {
          title: "新笔记",
          content: "正文",
        })
      ).rejects.toThrow(/已被撤销/);
    });

    it("撤销读剪贴板后，qnote.clipboard.list 立刻失败", async () => {
      await setPluginGrant(DB, PLUGIN_ID, "qnote.clipboard.read", false);
      await expect(
        api.handlePluginCall(session, "qnote.clipboard.list", {})
      ).rejects.toThrow(/已被撤销/);
    });

    it("撤销 AI 后，qnote.ai.chat 立刻失败", async () => {
      await setPluginGrant(DB, PLUGIN_ID, "qnote.ai.read", false);
      await expect(
        api.handlePluginCall(session, "qnote.ai.chat", { message: "在吗" })
      ).rejects.toThrow(/已被撤销/);
    });

    it("恢复授权后调用又能通过", async () => {
      await setPluginGrant(DB, PLUGIN_ID, "qnote.notes.read", false);
      await expect(
        api.handlePluginCall(session, "qnote.notes.get", { path: "方案.md" })
      ).rejects.toThrow(/已被撤销/);

      await setPluginGrant(DB, PLUGIN_ID, "qnote.notes.read", true);
      const result = await api.handlePluginCall(session, "qnote.notes.get", {
        path: "方案.md",
      });
      expect(result).toMatchObject({ relPath: "方案.md", content: "# 方案" });
    });
  });

  describe("有权限时正常取数", () => {
    it("qnote.notes.get 读出笔记正文", async () => {
      const result = await api.handlePluginCall(session, "qnote.notes.get", {
        path: "方案.md",
      });
      expect(result).toMatchObject({ relPath: "方案.md", content: "# 方案" });
    });

    it("qnote.notes.create 建出新笔记", async () => {
      const result = (await api.handlePluginCall(
        session,
        "qnote.notes.create",
        { title: "会议纪要", content: "今天讨论了插件授权" }
      )) as { relPath: string };
      expect(result.relPath).toContain("会议纪要");
      expect(fs.existsSync(path.join(noteRoot, result.relPath))).toBe(true);
    });

    it("qnote.notes.update 改写既有笔记", async () => {
      const result = (await api.handlePluginCall(
        session,
        "qnote.notes.update",
        { path: "方案.md", content: "改过了" }
      )) as { relPath: string };
      expect(result.relPath).toBe("方案.md");
      expect(fs.readFileSync(path.join(noteRoot, "方案.md"), "utf-8")).toBe(
        "改过了"
      );
    });

    it("qnote.todos.create 写进待办表", async () => {
      const result = (await api.handlePluginCall(
        session,
        "qnote.todos.create",
        { title: "买菜", priority: "high" }
      )) as { id: number; title: string };
      expect(result.title).toBe("买菜");

      const row = await DB("todo").where("id", result.id).first();
      expect(row.title).toBe("买菜");
      expect(row.priority).toBe("high");
    });

    it("qnote.todos.update 改待办状态", async () => {
      await DB("todo").insert({ title: "旧待办", priority: "medium" });
      const row = await DB("todo").first();

      await api.handlePluginCall(session, "qnote.todos.update", {
        id: row.id,
        title: "新待办",
        completed: true,
      });

      const updated = await DB("todo").where("id", row.id).first();
      expect(updated.title).toBe("新待办");
      expect(Number(updated.completed)).toBe(1);
    });

    it("qnote.clipboard.list 读出剪贴板历史", async () => {
      await DB("note").insert({ content: "复制的一段文字", type: "text" });
      const result = (await api.handlePluginCall(
        session,
        "qnote.clipboard.list",
        { limit: 5 }
      )) as { count: number; items: { content: string }[] };
      expect(result.count).toBe(1);
      expect(result.items[0].content).toBe("复制的一段文字");
    });

    it("qnote.ai.chat 走主进程已有的 AI 服务", async () => {
      const send = vi
        .spyOn(aiService, "sendMessage")
        .mockResolvedValue({ content: "在的", model: "gpt-4o-mini" });
      vi.spyOn(configManager, "getAiConfig").mockResolvedValue({
        provider: "openai",
        apiKey: "test-key",
        model: "gpt-4o-mini",
        baseUrl: "",
      });

      const result = (await api.handlePluginCall(session, "qnote.ai.chat", {
        message: "在吗",
      })) as { content: string };

      expect(result.content).toBe("在的");
      expect(send).toHaveBeenCalledTimes(1);
      const messages = send.mock.calls[0][0];
      expect(messages).toEqual([{ role: "user", content: "在吗" }]);
    });

    it("qnote.ai.chat 没配 API Key 时报的是配置问题，不是权限问题", async () => {
      vi.spyOn(configManager, "getAiConfig").mockResolvedValue({
        provider: "openai",
        apiKey: "",
        model: "gpt-4o-mini",
        baseUrl: "",
      });

      await expect(
        api.handlePluginCall(session, "qnote.ai.chat", { message: "在吗" })
      ).rejects.toThrow(/请先在设置中配置 AI API Key/);
    });
  });
});
