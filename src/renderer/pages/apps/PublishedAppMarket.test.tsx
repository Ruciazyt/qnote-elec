import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElectronStub } from "@/test/electron-stub";
import { PublishedAppMarket } from "./PublishedAppMarket";
import type { AppProject } from "@shared/apps/appTypes";

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

const IMPORTED: AppProject = {
  id: 9,
  name: "行程地图",
  path: "D:\\apps\\travel-map",
  status: "ready",
  manifestText: MARKET_APP.manifest,
  command: "node server.mjs",
  origin: "market",
};

function setup() {
  const cloudListApps = vi.fn(async () => ({
    ok: true,
    data: { apps: [MARKET_APP], total: 1 },
  }));
  const appPickProjectDir = vi.fn(async () => "D:\\apps\\travel-map");
  const appImportFromMarket = vi.fn(async () => ({ ok: true, project: IMPORTED }));
  const cloudMarkPulled = vi.fn(async () => true);
  const cloudGetApp = vi.fn(async () => ({
    ok: true,
    data: { id: "app_1", name: "行程地图", bundle: "Ym9ndW5sZQ==" },
  }));

  window.electron = createElectronStub({
    cloudListApps,
    appPickProjectDir,
    appImportFromMarket,
    cloudMarkPulled,
    cloudGetApp,
  });

  return { cloudListApps, appPickProjectDir, appImportFromMarket };
}

describe("应用市场", () => {
  it("市场里只有获取，没有发布入口", async () => {
    setup();
    render(<PublishedAppMarket backend="catalog" />);

    await waitFor(() => expect(screen.getByText("行程地图")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /发布/ })).toBeNull();
  });

  it("清单里的预览是端口号时也要带过去（端口化之后清单里存的是数字）", async () => {
    const stub = setup();
    const app = {
      ...MARKET_APP,
      manifest: JSON.stringify({
        name: "行程地图",
        command: "node server.mjs",
        preview: 7800,
      }),
    };
    stub.cloudListApps.mockResolvedValue({
      ok: true,
      data: { apps: [app], total: 1 },
    });

    render(<PublishedAppMarket backend="catalog" />);

    await waitFor(() => expect(screen.getByText("行程地图")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "获取" }));

    await waitFor(() => expect(stub.appImportFromMarket).toHaveBeenCalled());
    expect(stub.appImportFromMarket.mock.calls[0][1]).toMatchObject({
      preview: 7800,
    });
  });

  it("获取成功后把项目交出去 —— 交给左侧的项目列表", async () => {
    const stub = setup();
    const onImported = vi.fn();
    render(<PublishedAppMarket backend="catalog" onImported={onImported} />);

    await waitFor(() => expect(screen.getByText("行程地图")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "获取" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(IMPORTED));
    expect(stub.appImportFromMarket).toHaveBeenCalled();
  });
});
