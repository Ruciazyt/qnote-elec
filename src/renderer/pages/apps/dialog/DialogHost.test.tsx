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
        manifest: '{"name":"iChain Dev Console","preview":7788}',
      },
    });

    render(<DialogHost />);

    await waitFor(() =>
      expect(screen.getByText("发布到应用市场")).toBeInTheDocument()
    );
    expect(screen.getByDisplayValue("iChain Dev Console")).toBeInTheDocument();
  });

  it("启动确认类型：渲染命令与风险提示", async () => {
    setup({
      type: "start-confirm",
      payload: {
        projectId: 9,
        name: "行程地图",
        commandLine: "node server.mjs",
        manifestHash: "abc123",
        risk: { level: "safe", findings: [] },
      },
    });

    render(<DialogHost />);

    await waitFor(() =>
      expect(screen.getByText("确认运行这个应用")).toBeInTheDocument()
    );
    expect(screen.getByText("node server.mjs")).toBeInTheDocument();
  });

  it("取消时把动作发回主窗口", async () => {
    const stub = setup({
      type: "publish",
      payload: { name: "iChain Dev Console", description: "", manifest: "{}" },
    });

    render(<DialogHost />);

    await waitFor(() =>
      expect(screen.getByText("发布到应用市场")).toBeInTheDocument()
    );
    screen.getByRole("button", { name: "取消" }).click();

    expect(stub.dialogSend).toHaveBeenCalledWith({ action: "cancelled" });
  });

  it("上下文没到就先什么都不渲染", async () => {
    setup(null);
    render(<DialogHost />);
    expect(screen.queryByText("发布到应用市场")).toBeNull();
  });
});
