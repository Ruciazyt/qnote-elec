import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElectronStub } from "@/test/electron-stub";
import AppsPage from "./AppsPage";

const MARKET_APP = {
  id: "app_1",
  name: "行程地图",
  description: "别人做的应用",
  author: "someone",
  manifest: JSON.stringify({ name: "行程地图", command: "node server.mjs" }),
  repoUrl: "",
  tags: "",
  pulls: 0,
  createdAt: 0,
  updatedAt: 0,
};

const IMPORTED = {
  id: 9,
  name: "行程地图",
  path: "D:\\apps\\travel-map",
  status: "ready",
  manifestText: MARKET_APP.manifest,
  command: "node server.mjs",
  origin: "market",
};

function setup(projects: unknown[] = []) {
  let imported = false;
  const appListProjects = vi.fn(async () => (imported ? [IMPORTED] : projects));
  const appRuntimeStates = vi.fn(async () => []);
  const cloudGetConfig = vi.fn(async () => ({ backend: "local", catalog: null, lastCheck: null }));
  const cloudListApps = vi.fn(async () => ({
    ok: true,
    data: { apps: [MARKET_APP], total: 1 },
  }));
  const appPickProjectDir = vi.fn(async () => "D:\\apps\\travel-map");
  const dialogOpen = vi.fn(async () => ({ ok: true }));
  const appImportFromMarket = vi.fn(async () => {
    imported = true;
    return { ok: true, project: IMPORTED };
  });

  window.electron = createElectronStub({
    appListProjects,
    appRuntimeStates,
    cloudGetConfig,
    cloudListApps,
    appPickProjectDir,
    appImportFromMarket,
    dialogOpen,
    cloudMarkPulled: vi.fn(async () => true),
    onAppProjectsChanged: vi.fn(() => () => {}),
    onAppRuntimeChanged: vi.fn(() => () => {}),
    onAppLog: vi.fn(() => () => {}),
    onAppPreviewError: vi.fn(() => () => {}),
    onDialogMessage: vi.fn(() => () => {}),
    appLogs: vi.fn(async () => []),
    appPreviewBounds: vi.fn(async () => undefined),
    setNativeViewCover: vi.fn(async () => undefined),
  });

  return { appListProjects, appImportFromMarket, dialogOpen };
}

describe("应用管理页", () => {
  it("没有「本机项目」这个 tab", async () => {
    setup();
    render(<AppsPage />);

    await waitFor(() => expect(screen.getByText("应用管理")).toBeInTheDocument());
    expect(screen.queryByText("本机项目")).toBeNull();
    expect(
      screen.getByRole("button", { name: /应用市场/ })
    ).toBeInTheDocument();
  });

  it("市场里拉到的项目落到左侧的项目列表里，并被选中", async () => {
    setup();
    render(<AppsPage />);

    await waitFor(() => expect(screen.getByText("应用管理")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /应用市场/ }));

    await waitFor(() => expect(screen.getByText("行程地图")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "获取" }));

    await waitFor(() => {
      const items = screen
        .getAllByText("行程地图")
        .map((el) => el.closest("button"))
        .filter((el): el is HTMLButtonElement => Boolean(el));
      expect(
        items.some((el) => el.getAttribute("aria-current") === "true")
      ).toBe(true);
    });
  });
});

describe("发布走独立弹框窗口", () => {
  const PROJECT = {
    id: 1,
    name: "iChain Dev Console",
    path: "D:\\lenovo\\gsc\\ichain-dev-console",
    status: "ready",
    command: "node server.mjs",
    manifestText: JSON.stringify({
      name: "iChain Dev Console",
      command: "node server.mjs",
      preview: "http://127.0.0.1:7788/",
    }),
  };

  it("点发布把清单交给弹框窗口，清单里的回环地址已换成端口", async () => {
    const stub = setup([PROJECT]);
    render(<AppsPage />);

    await waitFor(() =>
      expect(screen.getByText("iChain Dev Console")).toBeInTheDocument()
    );
    await userEvent.click(screen.getByText("iChain Dev Console"));
    await userEvent.click(screen.getByRole("button", { name: "发布到应用市场" }));

    await waitFor(() => expect(stub.dialogOpen).toHaveBeenCalled());
    const context = stub.dialogOpen.mock.calls[0][0];
    expect(context.type).toBe("publish");
    expect(context.payload.manifest).not.toContain("127.0.0.1");
    expect(JSON.parse(context.payload.manifest).preview).toBe(7788);
  });
});
