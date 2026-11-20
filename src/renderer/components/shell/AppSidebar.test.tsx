import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createElectronStub } from "@/test/electron-stub";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider } from "../ui/sidebar";
import type { PluginRecord } from "@shared/plugin/pluginTypes";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

function plugin(overrides: Partial<PluginRecord>): PluginRecord {
  return {
    localId: 1,
    id: "local.web",
    name: "web",
    version: "1.0.0",
    publisher: "local",
    path: "D:\\plugins\\web",
    status: "ready",
    origin: "local",
    enabled: true,
    ...overrides,
  };
}

function setup(plugins: PluginRecord[]) {
  window.electron = createElectronStub({
    pluginList: vi.fn(async () => plugins),
    pluginRuntimeStates: vi.fn(async () => []),
    onPluginPluginsChanged: vi.fn(() => () => {}),
    onPluginRuntimeChanged: vi.fn(() => () => {}),
  });
}

function renderSidebar() {
  return render(
    <SidebarProvider>
      <MemoryRouter initialEntries={["/"]}>
        <AppSidebar />
      </MemoryRouter>
    </SidebarProvider>
  );
}

describe("侧栏插件入口", () => {
  it("启用的插件按 contributes.sidebar 生成入口", async () => {
    setup([
      plugin({
        contributes: { sidebar: [{ id: "web", title: "网页面板" }] },
      }),
    ]);

    renderSidebar();

    await waitFor(() => expect(screen.getByText("网页面板")).toBeInTheDocument());
  });

  it("禁用的插件不生成入口", async () => {
    setup([
      plugin({
        enabled: false,
        contributes: { sidebar: [{ id: "web", title: "网页面板" }] },
      }),
    ]);

    renderSidebar();

    await waitFor(() => expect(screen.getByText("插件")).toBeInTheDocument());
    expect(screen.queryByText("网页面板")).toBeNull();
  });

  it("入口指向插件页并带上插件 id", async () => {
    setup([
      plugin({
        contributes: { sidebar: [{ id: "web", title: "网页面板" }] },
      }),
    ]);

    renderSidebar();

    await waitFor(() => expect(screen.getByText("网页面板")).toBeInTheDocument());
    const link = screen.getByText("网页面板").closest("a");
    expect(link?.getAttribute("href")).toBe("/plugins?plugin=local.web");
  });
});
