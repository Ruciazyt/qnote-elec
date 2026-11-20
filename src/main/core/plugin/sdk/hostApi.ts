import { RPC_ERROR } from "../../../../shared/plugin/sdk/protocol";
import { checkCapability } from "../capabilities";
import type { PluginRpcHost, RpcSession } from "./rpcServer";
import type { PluginManager } from "../pluginManager";
import { getToolContext } from "../../ai/toolContext";
import { NoteStore } from "../../notes/noteStore";

export class HostApiError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
    this.name = "HostApiError";
  }
}

function denied(message: string): HostApiError {
  return new HostApiError(RPC_ERROR.denied, message);
}

export class PluginHostApi implements PluginRpcHost {
  constructor(private readonly manager: PluginManager) {}

  async handlePluginCall(
    session: RpcSession,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case "qnote.plugin.info":
        return {
          id: session.pluginId,
          name: session.manifest.name,
          version: session.manifest.version,
          publisher: session.manifest.publisher,
        };

      case "qnote.notify": {
        const level = String(params.level ?? "info");
        const message = String(params.message ?? "");
        if (!message) throw denied("通知内容不能为空");
        this.manager.notifyPlugin(session.pluginId, level, message);
        return { ok: true };
      }

      case "qnote.log": {
        const level = String(params.level ?? "info");
        const message = String(params.message ?? "");
        this.manager.logFromPlugin(session.pluginId, level, message);
        return { ok: true };
      }

      case "qnote.settings.get":
        return await this.getSetting(session, String(params.key ?? ""));

      case "qnote.settings.set":
        await this.setSetting(
          session,
          String(params.key ?? ""),
          params.value
        );
        return { ok: true };

      case "qnote.commands.list":
        return { items: this.manager.listCommands() };

      case "qnote.commands.execute":
        return await this.manager.executeCommand(String(params.command ?? ""));

      case "qnote.todos.list":
        return await this.listTodos(session, params);

      case "qnote.notes.list":
        return await this.listNotes(session, params);

      default:
        throw new HostApiError(
          RPC_ERROR.methodNotFound,
          `没有这个接口：${method}`
        );
    }
  }

  onPluginEvent(): void {
  }

  private declaredSettings(session: RpcSession): Set<string> {
    return new Set(
      (session.manifest.contributes?.settings ?? []).map((item) => item.key)
    );
  }

  private async getSetting(
    session: RpcSession,
    key: string
  ): Promise<{ value: unknown }> {
    if (!key) throw denied("设置项的 key 不能为空");
    if (!this.declaredSettings(session).has(key)) {
      throw denied(`这个插件没有声明设置项 ${key}`);
    }
    const row = await this.manager.DB("plugin_setting")
      .where("plugin_id", session.pluginId)
      .where("key", key)
      .first();
    const declared = session.manifest.contributes?.settings?.find(
      (item) => item.key === key
    );
    return { value: row ? row.value : (declared?.default ?? null) };
  }

  private async setSetting(
    session: RpcSession,
    key: string,
    value: unknown
  ): Promise<void> {
    if (!key) throw denied("设置项的 key 不能为空");
    if (!this.declaredSettings(session).has(key)) {
      throw denied(`这个插件没有声明设置项 ${key}`);
    }
    const declared = session.manifest.contributes?.settings?.find(
      (item) => item.key === key
    );
    if (declared) {
      if (declared.type === "number" && typeof value !== "number") {
        throw denied(`设置项 ${key} 要的是数字`);
      }
      if (declared.type === "boolean" && typeof value !== "boolean") {
        throw denied(`设置项 ${key} 要的是布尔值`);
      }
      if (declared.type === "string" && typeof value !== "string") {
        throw denied(`设置项 ${key} 要的是字符串`);
      }
    }
    const text = value === null || value === undefined ? null : String(value);
    const existing = await this.manager.DB("plugin_setting")
      .where("plugin_id", session.pluginId)
      .where("key", key)
      .first();
    if (existing) {
      await this.manager.DB("plugin_setting")
        .where("plugin_id", session.pluginId)
        .where("key", key)
        .update({ value: text });
      return;
    }
    await this.manager.DB("plugin_setting").insert({
      plugin_id: session.pluginId,
      key,
      value: text,
    });
  }

  private async listTodos(
    session: RpcSession,
    params: Record<string, unknown>
  ): Promise<{ count: number; items: unknown[] }> {
    const decision = checkCapability(session.manifest.capabilities, {
      kind: "data",
      area: "todos",
      access: "read",
    });
    if (!decision.allowed) throw denied(decision.reason ?? "没有权限");

    const limit = Math.min(Math.max(Number(params.limit ?? 20) || 20, 1), 100);
    const rows = await this.manager.DB("todo")
      .select("id", "title", "notes", "priority", "completed", "due_date", "created_at")
      .whereNull("archived_at")
      .orderBy("created_at", "desc")
      .limit(limit);
    return { count: rows.length, items: rows };
  }

  private async listNotes(
    session: RpcSession,
    params: Record<string, unknown>
  ): Promise<{ count: number; items: unknown[]; root?: string }> {
    const decision = checkCapability(session.manifest.capabilities, {
      kind: "data",
      area: "notes",
      access: "read",
    });
    if (!decision.allowed) throw denied(decision.reason ?? "没有权限");

    let root: string;
    try {
      root = await getToolContext().notes?.getFilePath();
    } catch {
      throw denied("笔记功能还没初始化");
    }
    if (!root) throw denied("用户还没有设置笔记保存目录");

    const limit = Math.min(Math.max(Number(params.limit ?? 50) || 50, 1), 500);
    const store = new NoteStore();
    const all = await store.scanFiles(root, {
      maxDirs: 2000,
      maxFiles: 5000,
      deadlineMs: 5000,
    });
    const items = all.slice(0, limit).map((note) => ({
      relPath: note.relPath,
      name: note.name,
      type: note.type,
      ext: note.ext,
      size: note.size,
      mtime: note.mtime,
    }));
    return { count: items.length, items, root };
  }
}
