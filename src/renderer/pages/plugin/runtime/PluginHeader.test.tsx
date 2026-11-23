import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PluginHeader } from "./PluginHeader";
import type { PluginRecord } from "@shared/plugin/manifest/pluginTypes";

const PLUGIN: PluginRecord = {
  localId: 1,
  id: "local.ichain",
  name: "iChain Dev Console",
  version: "1.2.0",
  publisher: "local",
  path: "D:\\lenovo\\gsc\\ichain-dev-console",
  status: "ready",
  origin: "local",
  enabled: true,
  command: "node server.mjs",
};

function renderHeader(overrides: Partial<Parameters<typeof PluginHeader>[0]> = {}) {
  return render(
    <PluginHeader
      plugin={PLUGIN}
      runtime={undefined}
      previewAddress={undefined}
      onPublish={vi.fn()}
      onStart={vi.fn()}
      onStop={vi.fn()}
      onEditManifest={vi.fn()}
      onOpenFolder={vi.fn()}
      onRemove={vi.fn()}
      onToggleEnabled={vi.fn()}
      {...overrides}
    />
  );
}

describe("插件头部", () => {
  it("发布按钮排在启动按钮之前", () => {
    renderHeader();

    const buttons = screen.getAllByRole("button");
    const publish = screen.getByRole("button", { name: "发布到插件市场" });
    const start = screen.getByRole("button", { name: /启动/ });

    expect(buttons.indexOf(publish)).toBeGreaterThanOrEqual(0);
    expect(buttons.indexOf(publish)).toBeLessThan(buttons.indexOf(start));
  });

  it("展示名称、版本与状态徽标", () => {
    renderHeader();

    expect(screen.getByText("iChain Dev Console")).toBeInTheDocument();
    expect(screen.getByText("v1.2.0")).toBeInTheDocument();
    expect(screen.getByText("可用")).toBeInTheDocument();
  });

  it("版本不兼容时徽标单独提示", () => {
    renderHeader({
      plugin: { ...PLUGIN, status: "incompatible", error: "这个插件要求 QNote ^3.0.0" },
    });

    expect(screen.getByText("版本不兼容")).toBeInTheDocument();
  });

  it("禁用的插件不能启动", () => {
    renderHeader({ plugin: { ...PLUGIN, enabled: false } });

    expect(screen.getByRole("button", { name: /启动/ })).toBeDisabled();
  });

  it("有刷新预览按钮并触发回调", () => {
    const onRefreshPreview = vi.fn();
    renderHeader({
      plugin: { ...PLUGIN, preview: "http://127.0.0.1:7800/" },
      previewAddress: "http://127.0.0.1:7800/",
      onRefreshPreview,
    });

    screen.getByRole("button", { name: "刷新预览" }).click();
    expect(onRefreshPreview).toHaveBeenCalled();
  });

  it("点发布走 onPublish", async () => {
    const onPublish = vi.fn();
    renderHeader({ onPublish });

    screen.getByRole("button", { name: "发布到插件市场" }).click();
    expect(onPublish).toHaveBeenCalled();
  });

  it("点启用/禁用走 onToggleEnabled", () => {
    const onToggleEnabled = vi.fn();
    renderHeader({ onToggleEnabled });

    screen.getByRole("button", { name: "禁用" }).click();
    expect(onToggleEnabled).toHaveBeenCalledWith(false);
  });
});
