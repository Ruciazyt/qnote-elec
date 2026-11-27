import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElectronStub } from "@/test/electron-stub";
import ToolsSection from "./ToolsSection";

const TOOLS = [
  {
    name: "get_todos",
    title: "读取待办",
    description: "获取用户的 Todo 列表",
    group: "待办",
    kind: "read" as const,
    enabled: true,
  },
  {
    name: "save_note",
    title: "保存笔记",
    description: "把内容写进笔记",
    group: "笔记",
    kind: "write" as const,
    enabled: false,
  },
  {
    name: "gitlab_list_projects",
    title: "列出项目",
    description: "列出 GitLab 项目",
    group: "GitLab",
    kind: "read" as const,
    enabled: true,
    note: "未配置",
  },
];

function setup(overrides: Record<string, unknown> = {}) {
  const listBuiltinTools = vi.fn(async () => TOOLS);
  const setBuiltinToolEnabled = vi.fn(async () => ({ success: true }));
  const getGitlabConfig = vi.fn(async () => ({
    baseUrl: "https://gitlab.example.com",
    allowedProjects: ["group/app"],
    readOnly: false,
    expectedVersion: "19.2",
    hasToken: true,
    tokenHint: "••••abcd",
    configured: true,
  }));
  const saveGitlabConfig = vi.fn(async () => ({ success: true, hasToken: true }));
  const clearGitlabConfig = vi.fn(async () => ({ success: true }));
  window.electron = createElectronStub({
    listBuiltinTools,
    setBuiltinToolEnabled,
    getGitlabConfig,
    saveGitlabConfig,
    clearGitlabConfig,
    ...overrides,
  });
  return { listBuiltinTools, setBuiltinToolEnabled, getGitlabConfig, saveGitlabConfig };
}

describe("工具页签", () => {
  it("按分组列出内置工具", async () => {
    setup();
    render(<ToolsSection />);

    await waitFor(() => expect(screen.getByText("读取待办")).toBeTruthy());
    expect(screen.getByText("待办")).toBeTruthy();
    expect(screen.getByText("保存笔记")).toBeTruthy();
    expect(screen.getByText("get_todos")).toBeTruthy();
  });

  it("关掉单个工具会走 IPC", async () => {
    const stub = setup();
    render(<ToolsSection />);

    await waitFor(() => expect(screen.getByText("读取待办")).toBeTruthy());
    await userEvent.click(screen.getByRole("switch", { name: "停用读取待办" }));

    await waitFor(() =>
      expect(stub.setBuiltinToolEnabled).toHaveBeenCalledWith("get_todos", false)
    );
  });

  it("打开单个工具会走 IPC", async () => {
    const stub = setup();
    render(<ToolsSection />);

    await waitFor(() => expect(screen.getByText("保存笔记")).toBeTruthy());
    await userEvent.click(screen.getByRole("switch", { name: "启用保存笔记" }));

    await waitFor(() =>
      expect(stub.setBuiltinToolEnabled).toHaveBeenCalledWith("save_note", true)
    );
  });

  it("分组开关会逐个切换组内工具", async () => {
    const stub = setup();
    render(<ToolsSection />);

    await waitFor(() => expect(screen.getByText("读取待办")).toBeTruthy());
    await userEvent.click(screen.getByRole("switch", { name: "停用待办全部工具" }));

    await waitFor(() =>
      expect(stub.setBuiltinToolEnabled).toHaveBeenCalledWith("get_todos", false)
    );
  });

  it("点分组标题能收起和展开", async () => {
    setup();
    render(<ToolsSection />);

    await waitFor(() => expect(screen.getByText("读取待办")).toBeTruthy());
    expect(screen.getByRole("switch", { name: "停用读取待办" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "收起待办" }));

    await waitFor(() =>
      expect(screen.getByText("读取待办").closest("[aria-hidden='true']")).not.toBeNull()
    );
    expect(screen.queryByRole("switch", { name: "停用读取待办" })).toBeNull();
    expect(screen.getByRole("button", { name: "展开待办" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "展开待办" }));
    await waitFor(() =>
      expect(screen.getByText("读取待办").closest("[aria-hidden='true']")).toBeNull()
    );
    expect(screen.getByRole("switch", { name: "停用读取待办" })).toBeTruthy();
  });

  it("全部收起会把所有分组折起来", async () => {
    setup();
    render(<ToolsSection />);

    await waitFor(() => expect(screen.getByText("读取待办")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "全部收起" }));

    await waitFor(() =>
      expect(screen.getByText("读取待办").closest("[aria-hidden='true']")).not.toBeNull()
    );
    expect(screen.getByText("保存笔记").closest("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByRole("button", { name: "全部展开" })).toBeTruthy();
  });

  it("折叠状态会写进本地存储", async () => {
    setup();
    render(<ToolsSection />);

    await waitFor(() => expect(screen.getByText("读取待办")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "收起待办" }));

    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem("skills-tools-collapsed-groups") || "[]")
      ).toEqual(["待办"])
    );
  });

  it("未配置的工具会标出未配置", async () => {
    setup();
    render(<ToolsSection />);

    await waitFor(() => expect(screen.getByText("列出项目")).toBeTruthy());
    expect(screen.getByText("未配置")).toBeTruthy();
  });

  it("配置按钮能打开弹窗并回填 GitLab 配置", async () => {
    const stub = setup();
    render(<ToolsSection />);

    await waitFor(() => expect(screen.getByText("列出项目")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "配置 GitLab" }));

    await waitFor(() => expect(screen.getByLabelText("实例地址")).toBeTruthy());
    expect((screen.getByLabelText("实例地址") as HTMLInputElement).value).toBe(
      "https://gitlab.example.com"
    );
    expect((screen.getByLabelText("允许的项目（可选）") as HTMLInputElement).value).toBe(
      "group/app"
    );
    expect(screen.getByText("当前令牌：••••abcd")).toBeTruthy();
    expect(stub.getGitlabConfig).toHaveBeenCalled();
  });

  it("保存配置会把表单值传给 IPC", async () => {
    const stub = setup();
    render(<ToolsSection />);

    await waitFor(() => expect(screen.getByText("列出项目")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "配置 GitLab" }));
    await waitFor(() => expect(screen.getByLabelText("实例地址")).toBeTruthy());

    const baseUrl = screen.getByLabelText("实例地址");
    await userEvent.clear(baseUrl);
    await userEvent.type(baseUrl, "https://git.internal");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(stub.saveGitlabConfig).toHaveBeenCalled());
    expect(stub.saveGitlabConfig.mock.calls[0][0]).toMatchObject({
      baseUrl: "https://git.internal",
      allowedProjects: ["group/app"],
      readOnly: false,
      expectedVersion: "19.2",
    });
  });
});
