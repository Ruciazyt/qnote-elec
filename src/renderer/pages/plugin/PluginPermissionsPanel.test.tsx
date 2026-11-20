import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PluginPermissionsPanel } from "./PluginPermissionsPanel";
import type { PluginRecord } from "@shared/plugin/pluginTypes";

const PLUGIN: PluginRecord = {
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

describe("插件权限面板", () => {
  it("列出清单里声明的权限", () => {
    render(
      <PluginPermissionsPanel
        plugin={{
          ...PLUGIN,
          capabilities: {
            process: { spawn: true },
            network: ["127.0.0.1:*"],
            qnote: { notes: "read" },
          },
        }}
      />
    );

    expect(screen.getByText("启动子进程")).toBeInTheDocument();
    expect(screen.getByText("访问网络 127.0.0.1:*")).toBeInTheDocument();
    expect(screen.getByText("读取笔记")).toBeInTheDocument();
  });

  it("没声明权限时说明是最小权限", () => {
    render(<PluginPermissionsPanel plugin={PLUGIN} />);

    expect(screen.getByText("这个插件没有声明任何权限")).toBeInTheDocument();
  });
});
