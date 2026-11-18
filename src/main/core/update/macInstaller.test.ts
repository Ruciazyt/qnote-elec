// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildInstallScript,
  isMacBundleUnsigned,
  shellQuote,
} from "./macInstaller";

const baseOptions = {
  archivePath: "/Users/test/Library/Caches/qnote-update/QNote-1.13.0-mac-arm64.zip",
  bundlePath: "/Applications/QNote.app",
  appName: "QNote.app",
  logPath: "/Users/test/Library/Application Support/QNote/qnote-mac-updater/install.log",
  scriptPath: "/Users/test/Library/Application Support/QNote/qnote-mac-updater/install.sh",
  pid: 4242,
  waitSeconds: 120,
};

describe("mac 安装脚本", () => {
  it("路径含空格与单引号时正确转义", () => {
    expect(shellQuote("/Applications/My App's/QNote.app")).toBe(
      "'/Applications/My App'\\''s/QNote.app'"
    );
  });

  it("脚本按等待退出、解包、换包、重启的顺序执行", () => {
    const script = buildInstallScript(baseOptions);

    const waitIndex = script.indexOf("kill -0");
    const extractIndex = script.indexOf("ditto -x -k");
    const backupIndex = script.indexOf('mv "$BUNDLE" "$BACKUP"');
    const swapIndex = script.indexOf('mv "$NEW_APP" "$BUNDLE"');
    const relaunchIndex = script.indexOf('open "$BUNDLE"');

    expect(waitIndex).toBeGreaterThan(-1);
    expect(waitIndex).toBeLessThan(extractIndex);
    expect(extractIndex).toBeLessThan(backupIndex);
    expect(backupIndex).toBeLessThan(swapIndex);
    expect(swapIndex).toBeLessThan(relaunchIndex);
  });

  it("换包失败时回滚旧版本", () => {
    const script = buildInstallScript(baseOptions);

    expect(script).toContain('mv "$BACKUP" "$BUNDLE"');
    expect(script).toContain("执行回滚");
  });

  it("清理隔离属性并做 ad-hoc 重签", () => {
    const script = buildInstallScript(baseOptions);

    expect(script).toContain("xattr -dr com.apple.quarantine");
    expect(script).toContain("codesign --force --deep --sign -");
  });

  it("写入归档路径、bundle 路径与进程号", () => {
    const script = buildInstallScript(baseOptions);

    expect(script).toContain(baseOptions.archivePath);
    expect(script).toContain(baseOptions.bundlePath);
    expect(script).toContain("APP_PID=4242");
  });

  it("bundle 缺少 CodeResources 时判为未签名", () => {
    expect(isMacBundleUnsigned("/nonexistent/QNote.app")).toBe(true);
  });

  it("脚本内路径一律使用正斜杠", () => {
    const script = buildInstallScript({
      ...baseOptions,
      logPath: "C:\\Users\\test\\AppData\\Roaming\\QNote\\install.log",
    });

    expect(script).not.toMatch(/[A-Za-z]:\\\\/);
    expect(script).toContain("/Users/test/AppData/Roaming/QNote");
  });

  it("脚本使用绝对路径调用系统命令，不依赖 PATH", () => {
    const script = buildInstallScript(baseOptions);

    expect(script).toContain("/usr/bin/ditto");
    expect(script).toContain("/usr/bin/codesign");
    expect(script).toContain("/usr/bin/xattr");
    expect(script).toContain("/usr/bin/open");
    expect(script).toContain("/bin/kill -0");
  });
});
