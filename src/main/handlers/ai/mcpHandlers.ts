import { BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent } from "electron";
import { log } from "../../core/system/log";
import { mcpManager } from "../../core/ai/mcp/manager";
import type { McpServerInput } from "../../../shared/ai/mcp";

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerMcpHandlers() {
  ipcMain.handle("mcp-list-servers", async () => {
    return mcpManager.listServers();
  });

  ipcMain.handle(
    "mcp-save-server",
    async (_event: IpcMainInvokeEvent, input: McpServerInput) => {
      try {
        const server = await mcpManager.saveServer(input);
        return { success: true, server };
      } catch (err) {
        log.error("[mcp] 保存服务器配置失败", err);
        return { success: false, error: reason(err) };
      }
    }
  );

  ipcMain.handle(
    "mcp-delete-server",
    async (_event: IpcMainInvokeEvent, id: string) => {
      try {
        const deleted = await mcpManager.deleteServer(id);
        return { success: deleted };
      } catch (err) {
        log.error("[mcp] 删除服务器失败", err);
        return { success: false, error: reason(err) };
      }
    }
  );

  ipcMain.handle(
    "mcp-connect-server",
    async (_event: IpcMainInvokeEvent, id: string) => {
      try {
        const server = await mcpManager.connect(id);
        return { success: server.status === "connected", server, error: server.error };
      } catch (err) {
        log.error("[mcp] 连接服务器失败", err);
        return { success: false, error: reason(err) };
      }
    }
  );

  ipcMain.handle(
    "mcp-disconnect-server",
    async (_event: IpcMainInvokeEvent, id: string) => {
      try {
        const server = await mcpManager.disconnect(id);
        return { success: true, server };
      } catch (err) {
        log.error("[mcp] 断开服务器失败", err);
        return { success: false, error: reason(err) };
      }
    }
  );

  ipcMain.handle(
    "mcp-set-server-enabled",
    async (_event: IpcMainInvokeEvent, id: string, enabled: boolean) => {
      try {
        const server = await mcpManager.setServerEnabled(id, enabled);
        return { success: true, server };
      } catch (err) {
        log.error("[mcp] 切换服务器状态失败", err);
        return { success: false, error: reason(err) };
      }
    }
  );

  ipcMain.handle(
    "mcp-list-tools",
    async (_event: IpcMainInvokeEvent, id: string) => {
      return mcpManager.listTools(id);
    }
  );

  ipcMain.handle("mcp-get-project", async () => {
    return mcpManager.getProjectState();
  });

  ipcMain.handle(
    "mcp-pick-project-dir",
    async (event: IpcMainInvokeEvent) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win ?? null, {
          title: "选择项目目录",
          properties: ["openDirectory"],
        });
        if (result.canceled || !result.filePaths[0]) {
          return { success: true, canceled: true, project: mcpManager.getProjectState() };
        }
        const project = await mcpManager.setProjectDir(result.filePaths[0]);
        return { success: true, canceled: false, project };
      } catch (err) {
        log.error("[mcp] 选择项目目录失败", err);
        return { success: false, error: reason(err) };
      }
    }
  );

  ipcMain.handle(
    "mcp-set-project-dir",
    async (_event: IpcMainInvokeEvent, dir: string | null) => {
      try {
        const project = await mcpManager.setProjectDir(dir);
        return { success: true, project };
      } catch (err) {
        log.error("[mcp] 设置项目目录失败", err);
        return { success: false, error: reason(err) };
      }
    }
  );

  ipcMain.handle("mcp-reload", async () => {
    try {
      const servers = await mcpManager.reload();
      return { success: true, servers, project: mcpManager.getProjectState() };
    } catch (err) {
      log.error("[mcp] 重新加载失败", err);
      return { success: false, error: reason(err) };
    }
  });
}
