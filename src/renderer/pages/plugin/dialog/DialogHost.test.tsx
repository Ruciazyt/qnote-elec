import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createElectronStub } from "@/test/electron-stub";
import { DialogHost } from "./DialogHost";

function setup(context: unknown) {
  const dialogSend = vi.fn();
  const onDialogContext = vi.fn(() => () => {});

  window.electron = createElectronStub({
    dialogGetContext: vi.fn(async () => context),
    onDialogContext,
    dialogSend,
    pluginBuildBundle: vi.fn(async () => ({
      ok: true,
      bundle: "Ym9ndW5sZQ==",
      fileCount: 12,
      bytes: 2048,
      skipped: ["node_modules"],
      tooLarge: false,
    })),
    cloudPublishApp: vi.fn(async () => ({
      ok: true,
      data: { id: "app_1", name: "iChain Dev Console" },
    })),
  });

  return { dialogSend, onDialogContext };
}

describe("弹框窗口", () => {
  it("发布类型：渲染发布表单，并带上清单", async () => {
    setup({
      type: "publish",
      payload: {
        name: "iChain Dev Console",
        description: "本地编排台",
        manifest: '{"id":"local.ichain","name":"iChain Dev Console"}',
        pluginId: "local.ichain",
      },
    });

    render(<DialogHost />);

    await waitFor(() =>
      expect(screen.getByText("发布到插件市场")).toBeInTheDocument()
    );
    expect(screen.getByDisplayValue("iChain Dev Console")).toBeInTheDocument();
  });

  it("启动确认类型：渲染命令与风险提示", async () => {
    setup({
      type: "start-confirm",
      payload: {
        pluginId: "market.travel-map",
        name: "行程地图",
        commandLine: "node server.mjs",
        manifestHash: "abc123",
        origin: "market",
        risk: { level: "none", findings: [] },
      },
    });

    render(<DialogHost />);

    await waitFor(() =>
      expect(screen.getByText("确认运行这个插件")).toBeInTheDocument()
    );
    expect(screen.getByText("node server.mjs")).toBeInTheDocument();
  });

  it("启动确认类型：把声明的权限列出来", async () => {
    setup({
      type: "start-confirm",
      payload: {
        pluginId: "market.travel-map",
        name: "行程地图",
        commandLine: "node server.mjs",
        manifestHash: "abc123",
        origin: "market",
        risk: { level: "none", findings: [] },
        capabilities: {
          process: { spawn: true },
          qnote: { notes: "read", clipboard: "none" },
        },
      },
    });

    render(<DialogHost />);

    await waitFor(() =>
      expect(screen.getByText("确认运行这个插件")).toBeInTheDocument()
    );
    expect(screen.getByText("启动子进程")).toBeInTheDocument();
    expect(screen.getByText("读取笔记")).toBeInTheDocument();
  });

  it("启动确认类型：没声明权限就说没声明", async () => {
    setup({
      type: "start-confirm",
      payload: {
        pluginId: "market.travel-map",
        name: "行程地图",
        commandLine: "node server.mjs",
        manifestHash: "abc123",
        origin: "market",
        risk: { level: "none", findings: [] },
      },
    });

    render(<DialogHost />);

    await waitFor(() =>
      expect(screen.getByText("这个插件没有声明任何权限")).toBeInTheDocument()
    );
  });

  it("取消时把动作发回主窗口", async () => {
    const stub = setup({
      type: "publish",
      payload: {
        name: "iChain Dev Console",
        description: "",
        manifest: "{}",
        pluginId: "local.ichain",
      },
    });

    render(<DialogHost />);

    await waitFor(() =>
      expect(screen.getByText("发布到插件市场")).toBeInTheDocument()
    );
    screen.getByRole("button", { name: "取消" }).click();

    expect(stub.dialogSend).toHaveBeenCalledWith({ action: "cancelled" });
  });

  it("上下文没到就先什么都不渲染", async () => {
    setup(null);
    render(<DialogHost />);
    expect(screen.queryByText("发布到插件市场")).toBeNull();
  });
});
