import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElectronStub } from "@/test/electron-stub";
import { AppPreviewPane } from "./AppPreviewPane";
import type { AppProject } from "@shared/apps/appTypes";

const PROJECT: AppProject = {
  id: 1,
  name: "行程地图",
  path: "D:\\apps\\travel-map",
  status: "ready",
  command: "node server.mjs",
  preview: "http://127.0.0.1:7800/",
};

type ErrorPayload = { projectId?: number; url: string; message: string };

let errorCb: ((payload: ErrorPayload) => void) | null = null;
let loadedCb: ((payload: { projectId?: number }) => void) | null = null;
let appPreviewLoad: ReturnType<typeof vi.fn>;
let appPreviewVisible: ReturnType<typeof vi.fn>;

function setup() {
  errorCb = null;
  loadedCb = null;
  appPreviewLoad = vi.fn(async () => ({
    ok: true,
    url: "http://127.0.0.1:7800/",
    display: "http://127.0.0.1:7800/",
  }));
  appPreviewVisible = vi.fn(async () => undefined);

  window.electron = createElectronStub({
    appPreviewLoad,
    appPreviewVisible,
    appPreviewBounds: vi.fn(async () => undefined),
    onAppPreviewError: vi.fn((cb: (payload: ErrorPayload) => void) => {
      errorCb = cb;
      return () => {};
    }),
    onAppPreviewLoaded: vi.fn((cb: (payload: { projectId?: number }) => void) => {
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
    render(<AppPreviewPane project={PROJECT} active />);

    await act(async () => {
      errorCb?.({
        projectId: 1,
        url: "http://127.0.0.1:7800/",
        message: "连接被拒绝 —— 服务可能还没启动",
      });
    });

    expect(screen.getByText("预览加载失败")).toBeInTheDocument();
    expect(screen.getByText(/连接被拒绝/)).toBeInTheDocument();
    expect(appPreviewVisible).toHaveBeenCalledWith(false);
  });

  it("点刷新会重新加载预览", async () => {
    render(<AppPreviewPane project={PROJECT} active />);

    await act(async () => {
      errorCb?.({
        projectId: 1,
        url: "http://127.0.0.1:7800/",
        message: "连接被拒绝 —— 服务可能还没启动",
      });
    });

    await userEvent.click(screen.getByRole("button", { name: /刷新预览/ }));

    await waitFor(() => expect(appPreviewLoad).toHaveBeenCalledTimes(2));
    expect(appPreviewLoad).toHaveBeenLastCalledWith(1);
  });

  it("加载成功后错误提示消失，原生视图重新显示", async () => {
    render(<AppPreviewPane project={PROJECT} active />);

    await act(async () => {
      errorCb?.({
        projectId: 1,
        url: "http://127.0.0.1:7800/",
        message: "连接被拒绝 —— 服务可能还没启动",
      });
    });
    expect(screen.getByText("预览加载失败")).toBeInTheDocument();

    await act(async () => {
      loadedCb?.({ projectId: 1 });
    });

    expect(screen.queryByText("预览加载失败")).toBeNull();
    expect(appPreviewVisible).toHaveBeenCalledWith(true);
  });

  it("没有配置预览时给出提示而不是错误", async () => {
    render(<AppPreviewPane project={{ ...PROJECT, preview: undefined }} active />);

    expect(screen.getByText("该项目没有配置预览页面")).toBeInTheDocument();
    expect(screen.queryByText("预览加载失败")).toBeNull();
  });
});
