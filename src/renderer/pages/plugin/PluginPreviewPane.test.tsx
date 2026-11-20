import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElectronStub } from "@/test/electron-stub";
import { PluginPreviewPane } from "./PluginPreviewPane";
import type { PluginRecord } from "@shared/plugin/pluginTypes";

const PLUGIN: PluginRecord = {
  localId: 7,
  id: "local.travel-map",
  name: "行程地图",
  version: "1.0.0",
  publisher: "local",
  path: "D:\\plugins\\travel-map",
  status: "ready",
  origin: "local",
  enabled: true,
  command: "node server.mjs",
  preview: "7800",
};

type ErrorPayload = { localId?: number; url: string; message: string };

let errorCb: ((payload: ErrorPayload) => void) | null = null;
let loadedCb: ((payload: { localId?: number }) => void) | null = null;
let pluginPreviewLoad: ReturnType<typeof vi.fn>;
let pluginPreviewVisible: ReturnType<typeof vi.fn>;

function setup() {
  errorCb = null;
  loadedCb = null;
  pluginPreviewLoad = vi.fn(async () => ({
    ok: true,
    url: "http://127.0.0.1:7800/",
    display: "http://127.0.0.1:7800/",
  }));
  pluginPreviewVisible = vi.fn(async () => undefined);

  window.electron = createElectronStub({
    pluginPreviewLoad,
    pluginPreviewVisible,
    pluginPreviewBounds: vi.fn(async () => undefined),
    onPluginPreviewError: vi.fn((cb: (payload: ErrorPayload) => void) => {
      errorCb = cb;
      return () => {};
    }),
    onPluginPreviewLoaded: vi.fn((cb: (payload: { localId?: number }) => void) => {
      loadedCb = cb;
      return () => {};
    }),
  });
}

describe("预览面板", () => {
  beforeEach(() => {
    setup();
  });

  it("加载失败时把原因显示在页面里，并收起原生视图", async () => {
    render(<PluginPreviewPane plugin={PLUGIN} active />);

    await act(async () => {
      errorCb?.({
        localId: 7,
        url: "http://127.0.0.1:7800/",
        message: "连接被拒绝 —— 服务可能还没启动",
      });
    });

    expect(screen.getByText("预览加载失败")).toBeInTheDocument();
    expect(screen.getByText(/连接被拒绝/)).toBeInTheDocument();
    expect(pluginPreviewVisible).toHaveBeenCalledWith(false);
  });

  it("预览用本地号加载，不是业务 id", async () => {
    render(<PluginPreviewPane plugin={PLUGIN} active />);

    await waitFor(() => expect(pluginPreviewLoad).toHaveBeenCalled());
    expect(pluginPreviewLoad).toHaveBeenLastCalledWith(7);
  });

  it("点刷新会重新加载预览", async () => {
    render(<PluginPreviewPane plugin={PLUGIN} active />);

    await act(async () => {
      errorCb?.({
        localId: 7,
        url: "http://127.0.0.1:7800/",
        message: "连接被拒绝 —— 服务可能还没启动",
      });
    });

    await userEvent.click(screen.getByRole("button", { name: /刷新预览/ }));

    await waitFor(() => expect(pluginPreviewLoad).toHaveBeenCalledTimes(2));
    expect(pluginPreviewLoad).toHaveBeenLastCalledWith(7);
  });

  it("加载成功后错误提示消失，原生视图重新显示", async () => {
    render(<PluginPreviewPane plugin={PLUGIN} active />);

    await act(async () => {
      errorCb?.({
        localId: 7,
        url: "http://127.0.0.1:7800/",
        message: "连接被拒绝 —— 服务可能还没启动",
      });
    });
    expect(screen.getByText("预览加载失败")).toBeInTheDocument();

    await act(async () => {
      loadedCb?.({ localId: 7 });
    });

    expect(screen.queryByText("预览加载失败")).toBeNull();
    expect(pluginPreviewVisible).toHaveBeenCalledWith(true);
  });

  it("别的插件的预览事件不影响当前插件", async () => {
    render(<PluginPreviewPane plugin={PLUGIN} active />);

    await act(async () => {
      errorCb?.({
        localId: 99,
        url: "http://127.0.0.1:9999/",
        message: "别的插件出错了",
      });
    });

    expect(screen.queryByText("预览加载失败")).toBeNull();
  });

  it("没有配置预览时给出提示而不是错误", async () => {
    render(<PluginPreviewPane plugin={{ ...PLUGIN, preview: undefined }} active />);

    expect(screen.getByText("这个插件没有配置预览页面")).toBeInTheDocument();
    expect(screen.queryByText("预览加载失败")).toBeNull();
  });
});
