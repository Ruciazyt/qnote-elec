import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createElectronStub } from "@/test/electron-stub";
import PluginsPage from "./PluginsPage";

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
  }),
  repoUrl: "",
  tags: "",
  pulls: 0,
  createdAt: 0,
  updatedAt: 0,
};

const IMPORTED = {
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

function renderPage(initialEntries: string[] = ["/plugins"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <PluginsPage />
    </MemoryRouter>
  );
}

function setup(plugins: unknown[] = []) {
  let imported = false;
  const pluginList = vi.fn(async () => (imported ? [IMPORTED] : plugins));
  const pluginRuntimeStates = vi.fn(async () => []);
  const cloudGetConfig = vi.fn(async () => ({ backend: "local", catalog: null, lastCheck: null }));
  const cloudListApps = vi.fn(async () => ({
    ok: true,
    data: { apps: [MARKET_PLUGIN], total: 1 },
  }));
  const pluginPickDir = vi.fn(async () => "D:\\plugins\\travel-map");
  const dialogOpen = vi.fn(async () => ({ ok: true }));
  const pluginImportFromMarket = vi.fn(async () => {
    imported = true;
    return { ok: true, plugin: IMPORTED };
  });

  window.electron = createElectronStub({
    pluginList,
    pluginRuntimeStates,
    cloudGetConfig,
    cloudListApps,
    pluginPickDir,
    pluginImportFromMarket,
    dialogOpen,
    cloudMarkPulled: vi.fn(async () => true),
    cloudGetApp: vi.fn(async () => ({
      ok: true,
      data: { id: "app_1", name: "行程地图", bundle: "" },
    })),
    onPluginPluginsChanged: vi.fn(() => () => {}),
    onPluginRuntimeChanged: vi.fn(() => () => {}),
    onPluginLog: vi.fn(() => () => {}),
    onPluginPreviewError: vi.fn(() => () => {}),
    onPluginPreviewLoaded: vi.fn(() => () => {}),
    onDialogMessage: vi.fn(() => () => {}),
    pluginLogs: vi.fn(async () => []),
    pluginPreviewBounds: vi.fn(async () => undefined),
  });

  return { pluginList, pluginImportFromMarket, dialogOpen };
}

describe("插件管理页", () => {
  it("没有「本机插件」这个 tab", async () => {
    setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("插件管理")).toBeInTheDocument());
    expect(screen.queryByText("本机插件")).toBeNull();
    expect(
      screen.getByRole("button", { name: /插件市场/ })
    ).toBeInTheDocument();
  });

  it("「插件管理」和「插件市场」是两个按钮，各自切到自己的面板", async () => {
    setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("插件管理")).toBeInTheDocument());
    const manage = screen.getByRole("button", { name: /插件管理/ });
    const market = screen.getByRole("button", { name: /插件市场/ });

    expect(manage).toHaveAttribute("aria-pressed", "true");
    expect(market).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(market);
    await waitFor(() => expect(market).toHaveAttribute("aria-pressed", "true"));
    expect(manage).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("行程地图")).toBeInTheDocument();

    await userEvent.click(manage);
    await waitFor(() => expect(manage).toHaveAttribute("aria-pressed", "true"));
    expect(market).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("行程地图")).toBeNull();
  });

  it("市场里拉到的插件落到左侧的插件列表里，并被选中", async () => {
    setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("插件管理")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /插件市场/ }));

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
  const PLUGIN = {
    localId: 3,
    id: "local.ichain",
    name: "iChain Dev Console",
    version: "1.2.0",
    publisher: "local",
    path: "D:\\lenovo\\gsc\\ichain-dev-console",
    status: "ready",
    origin: "local",
    enabled: true,
    command: "node server.mjs",
    manifestText: JSON.stringify({
      id: "local.ichain",
      name: "iChain Dev Console",
      version: "1.2.0",
      publisher: "local",
      engines: { qnote: "^2.0.0" },
      runtime: {
        command: "node server.mjs",
        preview: { type: "port", port: 7788 },
      },
    }),
  };

  it("点发布把清单交给弹框窗口", async () => {
    const stub = setup([PLUGIN]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("iChain Dev Console")).toBeInTheDocument()
    );
    await userEvent.click(screen.getByText("iChain Dev Console"));
    await userEvent.click(screen.getByRole("button", { name: "发布到插件市场" }));

    await waitFor(() => expect(stub.dialogOpen).toHaveBeenCalled());
    const context = stub.dialogOpen.mock.calls[0][0];
    expect(context.type).toBe("publish");
    expect(context.payload.pluginId).toBe("local.ichain");
    expect(JSON.parse(context.payload.manifest).runtime.preview).toEqual({
      type: "port",
      port: 7788,
    });
  });
});

describe("侧栏入口", () => {
  const WEB = {
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

  it("带 plugin 参数进来时选中对应插件", async () => {
    setup([WEB]);
    renderPage(["/plugins?plugin=local.web"]);

    await waitFor(() => expect(screen.getAllByText("web").length).toBeGreaterThan(0));
    await waitFor(() => {
      const items = screen
        .getAllByText("web")
        .map((el) => el.closest("button"))
        .filter((el): el is HTMLButtonElement => Boolean(el));
      expect(
        items.some((el) => el.getAttribute("aria-current") === "true")
      ).toBe(true);
    });
  });
});
