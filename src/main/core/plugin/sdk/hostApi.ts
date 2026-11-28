import { RPC_ERROR } from "../../../../shared/plugin/sdk/protocol";
import {
  checkCapability,
  grantKeyForRequest,
  type CapabilityRequest,
} from "../permissions/capabilities";
import { describeCapabilityEntries } from "../../../../shared/plugin/permissions/pluginCapabilities";
import { isGrantActive } from "../permissions/pluginGrants";
import type { PluginSettingContribution } from "../../../../shared/plugin/manifest/pluginTypes";
import type { PluginRpcHost, RpcSession } from "./rpcServer";
import type { PluginManager } from "../runtime/pluginManager";
import {
  chatWithAi,
  createNote,
  createTodo,
  getNote,
  listClipboard,
  listNotes,
  listTodos,
  resolveNoteRoot,
  updateNote,
  updateTodo,
} from "./hostServices";

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

function coerceSettingValue(
  declared: PluginSettingContribution | undefined,
  raw: unknown
): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return raw;
  const type = declared?.type;
  if (type === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  }
  if (type === "number") {
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  }
  return raw;
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

      case "qnote.todos.create":
        return await this.createTodo(session, params);

      case "qnote.todos.update":
        return await this.updateTodo(session, params);

      case "qnote.notes.list":
        return await this.listNotes(session, params);

      case "qnote.notes.get":
        return await this.getNote(session, params);

      case "qnote.notes.create":
        return await this.createNote(session, params);

      case "qnote.notes.update":
        return await this.updateNote(session, params);

      case "qnote.clipboard.list":
        return await this.listClipboard(session, params);

      case "qnote.ai.chat":
        return await this.chat(session, params);

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

  private async requireCapability(
    session: RpcSession,
    request: CapabilityRequest,
    method: string
  ): Promise<void> {
    const declared = await this.manager.currentCapabilities(session.pluginId);
    const decision = checkCapability(
      declared ?? session.manifest.capabilities,
      request
    );
    if (!decision.allowed) {
      const reason = decision.reason ?? "没有权限";
      this.manager.logFromPlugin(
        session.pluginId,
        "error",
        `${reason}，拒绝调用 ${method}`
      );
      throw denied(reason);
    }

    const grantKey = grantKeyForRequest(request);
    const active = await isGrantActive(
      this.manager.DB,
      session.pluginId,
      grantKey
    );
    if (active) return;

    const label =
      describeCapabilityEntries(session.manifest.capabilities).find(
        (entry) => entry.key === grantKey
      )?.detail ?? grantKey;
    this.manager.logFromPlugin(
      session.pluginId,
      "error",
      `权限「${label}」已被撤销，拒绝调用 ${method}`
    );
    throw denied(`这个插件的「${label}」权限已被撤销`);
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HostApiError) throw err;
      throw new HostApiError(
        RPC_ERROR.internal,
        err instanceof Error ? err.message : String(err)
      );
    }
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
    const raw = row ? row.value : (declared?.default ?? null);
    return { value: coerceSettingValue(declared, raw) };
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
    await this.requireCapability(
      session,
      { kind: "data", area: "todos", access: "read" },
      "qnote.todos.list"
    );
    return await this.run(() => listTodos(this.manager.DB, params));
  }

  private async createTodo(
    session: RpcSession,
    params: Record<string, unknown>
  ): Promise<{ id: number; title: string }> {
    await this.requireCapability(
      session,
      { kind: "data", area: "todos", access: "write" },
      "qnote.todos.create"
    );
    return await this.run(() => createTodo(this.manager.DB, params));
  }

  private async updateTodo(
    session: RpcSession,
    params: Record<string, unknown>
  ): Promise<{ id: number; updated: boolean }> {
    await this.requireCapability(
      session,
      { kind: "data", area: "todos", access: "write" },
      "qnote.todos.update"
    );
    return await this.run(() => updateTodo(this.manager.DB, params));
  }

  private async listNotes(
    session: RpcSession,
    params: Record<string, unknown>
  ): Promise<{ count: number; items: unknown[]; root?: string }> {
    await this.requireCapability(
      session,
      { kind: "data", area: "notes", access: "read" },
      "qnote.notes.list"
    );
    return await this.run(async () => {
      const root = await resolveNoteRoot();
      return await listNotes(root, params);
    });
  }

  private async getNote(
    session: RpcSession,
    params: Record<string, unknown>
  ): Promise<{ relPath: string; name: string; type: string; content: string }> {
    await this.requireCapability(
      session,
      { kind: "data", area: "notes", access: "read" },
      "qnote.notes.get"
    );
    return await this.run(async () => {
      const root = await resolveNoteRoot();
      return await getNote(root, String(params.path ?? ""));
    });
  }

  private async createNote(
    session: RpcSession,
    params: Record<string, unknown>
  ): Promise<unknown> {
    await this.requireCapability(
      session,
      { kind: "data", area: "notes", access: "write" },
      "qnote.notes.create"
    );
    return await this.run(async () => {
      const root = await resolveNoteRoot();
      return await createNote(root, params);
    });
  }

  private async updateNote(
    session: RpcSession,
    params: Record<string, unknown>
  ): Promise<unknown> {
    await this.requireCapability(
      session,
      { kind: "data", area: "notes", access: "write" },
      "qnote.notes.update"
    );
    return await this.run(async () => {
      const root = await resolveNoteRoot();
      return await updateNote(root, params);
    });
  }

  private async listClipboard(
    session: RpcSession,
    params: Record<string, unknown>
  ): Promise<{ count: number; items: unknown[] }> {
    await this.requireCapability(
      session,
      { kind: "data", area: "clipboard", access: "read" },
      "qnote.clipboard.list"
    );
    return await this.run(() => listClipboard(this.manager.DB, params));
  }

  private async chat(
    session: RpcSession,
    params: Record<string, unknown>
  ): Promise<{ content: string; model?: string; usage?: unknown }> {
    await this.requireCapability(
      session,
      { kind: "data", area: "ai", access: "read" },
      "qnote.ai.chat"
    );
    return await this.run(() => chatWithAi(params));
  }
}
