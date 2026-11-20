import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElectronStub } from "@/test/electron-stub";
import { CloudStorageCard } from "./CloudStorageCard";

function setup(overrides: Record<string, unknown> = {}) {
  const cloudGetConfig = vi.fn(async () => ({
    backend: "catalog",
    catalog: {
      baseUrl: "https://ap-northeast-1.data.tidbcloud.com",
      appId: "dataapp-bPMzJOGk",
      publicKey: "public-key",
      privateKey: "private-key",
    },
    lastCheck: null,
  }));
  const cloudSaveConfig = vi.fn(async () => ({
    ok: true,
    data: { backend: "catalog", catalog: null, lastCheck: null },
  }));
  const cloudTestConnection = vi.fn(async () => ({
    ok: true,
    detail: "已连接公共目录",
  }));

  window.electron = createElectronStub({
    cloudGetConfig,
    cloudSaveConfig,
    cloudTestConnection,
    ...overrides,
  });

  return { cloudGetConfig, cloudSaveConfig, cloudTestConnection };
}

describe("云端存储卡片", () => {
  it("不显示公共目录的凭据字段", async () => {
    setup();
    render(<CloudStorageCard />);

    await waitFor(() =>
      expect(screen.getAllByText("公共目录").length).toBeGreaterThan(0)
    );

    expect(screen.queryByText("站点地址")).toBeNull();
    expect(screen.queryByText("App ID")).toBeNull();
    expect(screen.queryByText("Public Key")).toBeNull();
    expect(screen.queryByText("Private Key")).toBeNull();
    expect(screen.queryByPlaceholderText(/Public Key/)).toBeNull();
    expect(screen.queryByPlaceholderText(/Private Key/)).toBeNull();
    expect(screen.queryByText(/Private Key 只存在本机/)).toBeNull();
  });

  it("保存时不再回传凭据", async () => {
    const stub = setup();
    render(<CloudStorageCard />);

    await waitFor(() =>
      expect(screen.getAllByText("公共目录").length).toBeGreaterThan(0)
    );
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(stub.cloudSaveConfig).toHaveBeenCalled());
    expect(stub.cloudSaveConfig.mock.calls[0][0]).toEqual({ backend: "catalog" });
  });

  it("测试连接时不再回传凭据", async () => {
    const stub = setup();
    render(<CloudStorageCard />);

    await waitFor(() =>
      expect(screen.getAllByText("公共目录").length).toBeGreaterThan(0)
    );
    await userEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => expect(stub.cloudTestConnection).toHaveBeenCalled());
    expect(stub.cloudTestConnection.mock.calls[0][0]).toEqual({});
  });
});
