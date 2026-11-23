import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElectronStub } from "@/test/electron-stub";
import { PluginPermissionsPanel } from "./PluginPermissionsPanel";
import type { PluginRecord } from "@shared/plugin/manifest/pluginTypes";

const PLUGIN: PluginRecord = {
  localId: 1,
  id: "local.web",
  name: "web",
  version: "1.0.0",
  publisher: "local",
  path: "D:\\plugins\\web",
  status: "ready",
  origin: "local",
  enabled: true,
};

const WITH_CAPABILITIES: PluginRecord = {
  ...PLUGIN,
  capabilities: {
    process: { spawn: true },
    network: ["127.0.0.1:*"],
    qnote: { notes: "read" },
  },
};

function renderPanel(
  plugin: PluginRecord = PLUGIN,
  overrides: Record<string, unknown> = {}
) {
  window.electron = createElectronStub({
    pluginListGrants: vi.fn().mockResolvedValue([]),
    pluginSetGrant: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  });
  return render(<PluginPermissionsPanel plugin={plugin} />);
}

describe("插件权限面板", () => {
  it("列出清单里声明的权限", () => {
    renderPanel(WITH_CAPABILITIES);

    expect(screen.getByText("启动子进程")).toBeInTheDocument();
    expect(screen.getByText("访问网络 127.0.0.1:*")).toBeInTheDocument();
    expect(screen.getByText("读取笔记")).toBeInTheDocument();
  });

  it("没声明权限时说明是最小权限", () => {
    renderPanel(PLUGIN);

    expect(screen.getByText("这个插件没有声明任何权限")).toBeInTheDocument();
  });

  it("每项权限都能单独撤销，撤销后立刻显示为已撤销", async () => {
    const user = userEvent.setup();
    const setGrant = vi.fn().mockResolvedValue({ ok: true });
    renderPanel(WITH_CAPABILITIES, { pluginSetGrant: setGrant });

    await user.click(screen.getByRole("button", { name: "撤销权限：读取笔记" }));

    expect(setGrant).toHaveBeenCalledWith("local.web", "qnote.notes.read", false);
    await waitFor(() => {
      expect(screen.getByText("已撤销")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "恢复权限：读取笔记" })
    ).toBeInTheDocument();
  });

  it("撤销过的权限可以恢复", async () => {
    const user = userEvent.setup();
    const setGrant = vi.fn().mockResolvedValue({ ok: true });
    renderPanel(WITH_CAPABILITIES, {
      pluginSetGrant: setGrant,
      pluginListGrants: vi.fn().mockResolvedValue([
        {
          pluginId: "local.web",
          capability: "qnote.notes.read",
          granted: false,
        },
      ]),
    });

    await waitFor(() => {
      expect(screen.getByText("已撤销")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "恢复权限：读取笔记" }));

    expect(setGrant).toHaveBeenCalledWith("local.web", "qnote.notes.read", true);
    await waitFor(() => {
      expect(screen.getAllByText("已授权").length).toBeGreaterThan(0);
    });
    expect(
      screen.getByRole("button", { name: "撤销权限：读取笔记" })
    ).toBeInTheDocument();
  });

  it("宿主拒绝时保留原来的授权状态", async () => {
    const user = userEvent.setup();
    renderPanel(WITH_CAPABILITIES, {
      pluginSetGrant: vi.fn().mockResolvedValue({ ok: false, error: "插件不存在" }),
    });

    await user.click(screen.getByRole("button", { name: "撤销权限：读取笔记" }));

    await waitFor(() => {
      expect(screen.getAllByText("已授权").length).toBeGreaterThan(0);
    });
  });
});
