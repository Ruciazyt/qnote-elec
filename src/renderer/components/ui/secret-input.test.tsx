import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SecretInput } from "./secret-input";

const writeText = vi.fn().mockResolvedValue(undefined);

describe("密钥输入框", () => {
  it("默认是密码形态，点眼睛后显示明文", () => {
    render(
      <SecretInput id="tok" value="qnrelay_abc" onChange={() => {}} />
    );
    const input = screen.getByLabelText("显示内容").closest("div")
      ?.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("password");

    fireEvent.click(screen.getByLabelText("显示内容"));
    const shown = document.querySelector("#tok") as HTMLInputElement;
    expect(shown.type).toBe("text");
  });

  it("复制按钮把值写进剪贴板", async () => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <SecretInput id="tok" value="qnrelay_abc" onChange={() => {}} />
    );
    fireEvent.click(screen.getByLabelText("复制内容"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("qnrelay_abc");
    });
  });

  it("没内容时复制按钮禁用", () => {
    render(<SecretInput id="tok" value="" onChange={() => {}} />);
    const btn = screen.getByLabelText("复制内容") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("输入变化时回调新值", () => {
    const onChange = vi.fn();
    render(<SecretInput id="tok" value="" onChange={onChange} />);
    fireEvent.change(document.querySelector("#tok") as HTMLInputElement, {
      target: { value: "new-secret" },
    });
    expect(onChange).toHaveBeenCalledWith("new-secret");
  });
});
