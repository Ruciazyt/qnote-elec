import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProjectHeader } from "./AppProjectHeader";
import type { AppProject } from "@shared/apps/appTypes";

const PROJECT: AppProject = {
  id: 1,
  name: "iChain Dev Console",
  path: "D:\\lenovo\\gsc\\ichain-dev-console",
  status: "ready",
  command: "node server.mjs",
};

function renderHeader() {
  return render(
    <AppProjectHeader
      project={PROJECT}
      runtime={undefined}
      previewUrl={undefined}
      onPublish={vi.fn()}
      onStart={vi.fn()}
      onStop={vi.fn()}
      onEditManifest={vi.fn()}
      onOpenFolder={vi.fn()}
      onRemove={vi.fn()}
    />
  );
}

describe("项目头部", () => {
  it("发布按钮排在启动按钮之前", () => {
    renderHeader();

    const buttons = screen.getAllByRole("button");
    const publish = screen.getByRole("button", { name: "发布到应用市场" });
    const start = screen.getByRole("button", { name: /启动/ });

    expect(buttons.indexOf(publish)).toBeGreaterThanOrEqual(0);
    expect(buttons.indexOf(publish)).toBeLessThan(buttons.indexOf(start));
  });

  it("有刷新预览按钮并触发回调", () => {
    const onRefreshPreview = vi.fn();
    render(
      <AppProjectHeader
        project={{ ...PROJECT, preview: "http://127.0.0.1:7800/" }}
        runtime={undefined}
        previewUrl="http://127.0.0.1:7800/"
        onPublish={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onEditManifest={vi.fn()}
        onOpenFolder={vi.fn()}
        onRemove={vi.fn()}
        onRefreshPreview={onRefreshPreview}
      />
    );

    screen.getByRole("button", { name: "刷新预览" }).click();
    expect(onRefreshPreview).toHaveBeenCalled();
  });

  it("点发布走 onPublish", async () => {
    const onPublish = vi.fn();
    render(
      <AppProjectHeader
        project={PROJECT}
        runtime={undefined}
        previewUrl={undefined}
        onPublish={onPublish}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onEditManifest={vi.fn()}
        onOpenFolder={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    screen.getByRole("button", { name: "发布到应用市场" }).click();
    expect(onPublish).toHaveBeenCalled();
  });
});
