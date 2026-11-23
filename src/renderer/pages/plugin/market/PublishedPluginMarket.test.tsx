import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElectronStub } from "@/test/electron-stub";
import { PublishedPluginMarket } from "./PublishedPluginMarket";
import type { PluginRecord } from "@shared/plugin/manifest/pluginTypes";

const MARKET_PLUGIN = {
  id: "app_1",
  name: "行程地图",
  description: "别人做的插件",
  author: "someone",
  manifest: JSON.stringify({
    id: "market.travel-map",
    name: "行程地图",
    version: "1.3.0",
    publisher: "someone",
    engines: { qnote: "^2.0.0" },
    runtime: {
      command: "node server.mjs",
      preview: { type: "port", port: 7800 },
    },
    capabilities: { process: { spawn: true } },
  }),
  repoUrl: "",
  tags: "",
  pulls: 0,
  createdAt: 0,
  updatedAt: 0,
};

const IMPORTED: PluginRecord = {
  localId: 9,
  id: "market.travel-map",
  name: "行程地图",
  version: "1.3.0",
  publisher: "someone",
  path: "D:\\plugins\\travel-map",
  status: "ready",
  manifestText: MARKET_PLUGIN.manifest,
  command: "node server.mjs",
  origin: "market",
  enabled: true,
};

function setup() {
  const cloudListApps = vi.fn(async () => ({
    ok: true,
    data: { apps: [MARKET_PLUGIN], total: 1 },
  }));
  const pluginPickDir = vi.fn(async () => "D:\\plugins\\travel-map");
  const pluginImportFromMarket = vi.fn(async () => ({ ok: true, plugin: IMPORTED }));
  const cloudMarkPulled = vi.fn(async () => true);
  const cloudGetApp = vi.fn(async () => ({
    ok: true,
    data: { id: "app_1", name: "行程地图", bundle: "Ym9ndW5sZQ==" },
  }));

  window.electron = createElectronStub({
    cloudListApps,
    pluginPickDir,
    pluginImportFromMarket,
    cloudMarkPulled,
    cloudGetApp,
  });

  return {
    cloudListApps,
    pluginPickDir,
    pluginImportFromMarket,
    cloudMarkPulled,
    cloudGetApp,
  };
}

describe("插件市场", () => {
  it("市场里只有获取，没有发布入口", async () => {
    setup();
    render(<PublishedPluginMarket backend="catalog" />);

    await waitFor(() => expect(screen.getByText("行程地图")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /发布/ })).toBeNull();
  });

  it("把整份清单传给导入接口，预览是端口对象", async () => {
    const stub = setup();
    render(<PublishedPluginMarket backend="catalog" />);

    await waitFor(() => expect(screen.getByText("行程地图")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "获取" }));

    await waitFor(() => expect(stub.pluginImportFromMarket).toHaveBeenCalled());
    const payload = stub.pluginImportFromMarket.mock.calls[0][1];
    expect(payload).toMatchObject({
      id: "market.travel-map",
      name: "行程地图",
      version: "1.3.0",
      publisher: "someone",
      runtime: {
        command: "node server.mjs",
        preview: { type: "port", port: 7800 },
      },
    });
  });

  it("获取成功后把插件交出去 —— 交给左侧的插件列表", async () => {
    const stub = setup();
    const onImported = vi.fn();
    render(<PublishedPluginMarket backend="catalog" onImported={onImported} />);

    await waitFor(() => expect(screen.getByText("行程地图")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "获取" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(IMPORTED));
    expect(stub.pluginImportFromMarket).toHaveBeenCalled();
  });

  it("条目上的版本与依赖会显示出来", async () => {
    const cloudListApps = vi.fn(async () => ({
      ok: true,
      data: {
        apps: [
          {
            ...MARKET_PLUGIN,
            id: "app_2",
            name: "带依赖的插件",
            version: "2.0.0",
            dependencies: [{ id: "a.b" }, { id: "c.d", range: "^1.0.0" }],
            manifest: JSON.stringify({
              id: "market.with-deps",
              name: "带依赖的插件",
            }),
          },
        ],
        total: 1,
      },
    }));

    window.electron = createElectronStub({ cloudListApps });
    render(<PublishedPluginMarket backend="catalog" />);

    await waitFor(() => expect(screen.getByText("带依赖的插件")).toBeInTheDocument());
    expect(screen.getByText("v2.0.0")).toBeInTheDocument();
    expect(screen.getByText("依赖 a.b、c.d")).toBeInTheDocument();
  });

  it("老条目没有版本与依赖 —— 不显示空标签", async () => {
    setup();
    render(<PublishedPluginMarket backend="catalog" />);

    await waitFor(() => expect(screen.getByText("行程地图")).toBeInTheDocument());
    expect(screen.getByText("v1.3.0")).toBeInTheDocument();
    expect(screen.queryByText(/依赖/)).toBeNull();
  });

  it("本机装的是同一个版本 —— 显示已装版本，不给升级", async () => {
    const pluginList = vi.fn(async () => [IMPORTED]);
    window.electron = createElectronStub({ ...setup(), pluginList });
    render(<PublishedPluginMarket backend="catalog" />);

    await waitFor(() => expect(screen.getByText("行程地图")).toBeInTheDocument());
    expect(await screen.findByText("已安装 v1.3.0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "升级" })).toBeNull();
  });

  it("市场上有更新版本 —— 给升级按钮，点了走升级接口", async () => {
    const pluginList = vi.fn(async () => [
      { ...IMPORTED, version: "1.0.0" },
    ]);
    const pluginUpgradeFromMarket = vi.fn(async () => ({
      ok: true,
      plugin: IMPORTED,
    }));
    window.electron = createElectronStub({
      ...setup(),
      pluginList,
      pluginUpgradeFromMarket,
    });
    render(<PublishedPluginMarket backend="catalog" />);

    await waitFor(() => expect(screen.getByText("行程地图")).toBeInTheDocument());
    const upgrade = await screen.findByRole("button", { name: "升级" });
    await userEvent.click(upgrade);

    await waitFor(() =>
      expect(pluginUpgradeFromMarket).toHaveBeenCalled()
    );
    expect(pluginUpgradeFromMarket.mock.calls[0][0]).toBe("market.travel-map");
    expect(pluginUpgradeFromMarket.mock.calls[0][1]).toMatchObject({
      id: "market.travel-map",
      version: "1.3.0",
    });
  });
});
